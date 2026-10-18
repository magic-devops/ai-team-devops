package outbox_test

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
)

func pythonRuntime(t *testing.T) (string, string, string) {
	t.Helper()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	python := os.Getenv("SOP_TEST_PYTHON")
	if python == "" {
		python = filepath.Join(root, ".venv", "Scripts", "python.exe")
		if _, err = os.Stat(python); err != nil {
			python = filepath.Join(root, ".venv", "bin", "python")
		}
	}
	if _, err = os.Stat(python); err != nil {
		t.Skip("shared SDK interop requires workspace Python; set SOP_TEST_PYTHON")
	}
	return python, root, filepath.Join(root, "apps", "agent-runtime", "internal", "outbox", "testdata", "interop.py")
}
func pythonCommand(t *testing.T, operation, path string, args ...string) *exec.Cmd {
	t.Helper()
	python, root, script := pythonRuntime(t)
	all := append([]string{script, operation, path}, args...)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, python, all...)
	cmd.Env = append(os.Environ(), "PYTHONUTF8=1", "PYTHONIOENCODING=utf-8", "PYTHONDONTWRITEBYTECODE=1", "PYTHONPATH="+filepath.Join(root, "packages", "sop-sdk-python"))
	return cmd
}
func pythonJSON(t *testing.T, operation, path string, args ...string) map[string]json.RawMessage {
	t.Helper()
	raw, err := pythonCommand(t, operation, path, args...).CombinedOutput()
	if err != nil {
		t.Fatalf("real Python %s: %v\n%s", operation, err, raw)
	}
	var value map[string]json.RawMessage
	if err = json.Unmarshal(raw, &value); err != nil {
		t.Fatalf("Python JSON: %v %s", err, raw)
	}
	return value
}
func TestActualPythonGoSharedSQLiteOriginalAndRequeueReceipts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared.sqlite")
	created := pythonJSON(t, "enqueue", path)
	var wire struct{ ID, EventJSON, Digest string }
	var fields map[string]string
	if err := json.Unmarshal(created["input"], &fields); err != nil {
		t.Fatal(err)
	}
	wire.ID = fields["id"]
	wire.EventJSON = fields["event_json"]
	wire.Digest = fields["digest"]
	ob := openOutbox(t, path)
	record, err := ob.Get(context.Background(), wire.ID)
	if err != nil || record.EventJSON != wire.EventJSON || record.Digest != wire.Digest {
		t.Fatal("Go did not inspect exact Python original")
	}
	if _, err = outbox.ValidateFrozen(outbox.EnqueueInput{ID: wire.ID, EventJSON: wire.EventJSON, Digest: wire.Digest, IntendedProjectID: "P"}); err != nil {
		t.Fatalf("Go rejected a valid frozen Python event: %v", err)
	}
	var pythonPage struct {
		NextCursor *string `json:"next_cursor"`
	}
	_ = json.Unmarshal(created["page"], &pythonPage)
	goNext, err := ob.List(context.Background(), outbox.ListInput{Limit: 1, Cursor: *pythonPage.NextCursor})
	if err != nil || len(goNext.Items) != 1 {
		t.Fatalf("Python cursor not Go-readable %#v %v", goNext, err)
	}
	goPage, err := ob.List(context.Background(), outbox.ListInput{Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	_ = pythonJSON(t, "list", path, *goPage.NextCursor)
	dead, err := ob.Retry(context.Background(), record.ID, record.Revision, 0, outbox.Failure{Code: "offline", Retryable: true})
	if err != nil {
		t.Fatal(err)
	}
	reason := "人工\nrequeue Ω"
	fromPython := pythonJSON(t, "requeue", path, record.ID, strconv.FormatInt(dead.Revision, 10), reason, "shared-key")
	var originalRevision int64
	_ = json.Unmarshal(fromPython["revision"], &originalRevision)
	replayed, err := ob.Requeue(context.Background(), outbox.RequeueInput{ID: record.ID, ExpectedRevision: dead.Revision, Reason: reason, IdempotencyKey: "shared-key"})
	if err != nil || !replayed.Replayed || replayed.Revision != originalRevision {
		t.Fatalf("Go did not replay Python original receipt %#v %v", replayed, err)
	}
	againDead, err := ob.Retry(context.Background(), record.ID, originalRevision, 0, outbox.Failure{Code: "offline", Retryable: true})
	if err != nil {
		t.Fatal(err)
	}
	newAck, err := ob.Requeue(context.Background(), outbox.RequeueInput{ID: record.ID, ExpectedRevision: againDead.Revision, Reason: "Go reason", IdempotencyKey: "go-key"})
	if err != nil {
		t.Fatal(err)
	}
	oldPython := pythonJSON(t, "requeue", path, record.ID, strconv.FormatInt(dead.Revision, 10), reason, "shared-key")
	var oldRevision int64
	_ = json.Unmarshal(oldPython["revision"], &oldRevision)
	if oldRevision != originalRevision || newAck.Revision == oldRevision {
		t.Fatal("old cross-language requeue returned current result")
	}
	reverse := input(t, "from-go")
	enqueue(t, ob, reverse)
	inspected := pythonJSON(t, "inspect", path, reverse.ID)
	var originalJSON string
	_ = json.Unmarshal(inspected["event_json"], &originalJSON)
	if originalJSON != reverse.EventJSON {
		t.Fatal("Python reconstructed Go original bytes")
	}
	conflict := pythonJSON(t, "conflict", path, reverse.ID)
	if string(conflict["error_code"]) != `"event_id_conflict"` {
		t.Fatal("Python did not reject changed Go original ID")
	}
	_ = pythonJSON(t, "bind", path, reverse.ID, "1")
	if _, err = ob.Bind(context.Background(), reverse.ID, 1, scope()); err != nil {
		t.Fatalf("Go did not recognize Python same binding: %v", err)
	}
}
func TestActualPythonGoConcurrentCASHasOneWinner(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared.sqlite")
	ob := openOutbox(t, path)
	in := input(t, "race")
	enqueue(t, ob, in)
	cmd := pythonCommand(t, "race", path, in.ID, "1")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() || scanner.Text() != "READY" {
		t.Fatal("Python fixture did not become ready")
	}
	done := make(chan error, 1)
	go func() {
		_, err := ob.Retry(context.Background(), in.ID, 1, 0, outbox.Failure{Code: "go-race", Retryable: true})
		done <- err
	}()
	_, _ = stdin.Write([]byte("GO\n"))
	_ = stdin.Close()
	if !scanner.Scan() {
		t.Fatal("Python CAS result missing")
	}
	var py map[string]any
	if err = json.Unmarshal([]byte(scanner.Text()), &py); err != nil {
		t.Fatal(err)
	}
	goErr := <-done
	if err = cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	pythonWon := py["error_code"] == nil
	goWon := goErr == nil
	if pythonWon == goWon {
		t.Fatalf("expected exactly one real process winner: Python=%#v Go=%v", py, goErr)
	}
	if goErr != nil && !strings.Contains(goErr.Error(), "revision_conflict") {
		t.Fatal(goErr)
	}
	record, err := ob.Get(context.Background(), in.ID)
	if err != nil || record.Revision != 2 || record.Attempts != 1 || record.State != "dead_letter" {
		t.Fatalf("cross-process CAS lost update %#v %v", record, err)
	}
}

func TestActualPythonGoFreshConcurrentOpen(t *testing.T) {
	for i := 0; i < 4; i++ {
		t.Run(strconv.Itoa(i), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "fresh.sqlite")
			cmd := pythonCommand(t, "fresh_race", path)
			stdin, err := cmd.StdinPipe()
			if err != nil {
				t.Fatal(err)
			}
			stdout, err := cmd.StdoutPipe()
			if err != nil {
				t.Fatal(err)
			}
			var stderr strings.Builder
			cmd.Stderr = &stderr
			if err = cmd.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() {
				if cmd.ProcessState == nil {
					_ = cmd.Process.Kill()
					_ = cmd.Wait()
				}
			}()
			scanner := bufio.NewScanner(stdout)
			if !scanner.Scan() || scanner.Text() != "READY" {
				t.Fatalf("Python readiness: %v %s", scanner.Err(), stderr.String())
			}
			type opened struct {
				ob  *outbox.Outbox
				err error
			}
			done := make(chan opened, 1)
			go func() { ob, err := outbox.Open(path); done <- opened{ob, err} }()
			_, _ = stdin.Write([]byte("GO\n"))
			_ = stdin.Close()
			pyLine := ""
			if scanner.Scan() {
				pyLine = scanner.Text()
			}
			goResult := <-done
			if goResult.ob != nil {
				defer goResult.ob.Close()
			}
			pyErr := cmd.Wait()
			if goResult.err != nil || pyErr != nil {
				t.Fatalf("Go=%v Python=%v %s", goResult.err, pyErr, stderr.String())
			}
			var pyStats outbox.Stats
			if err = json.Unmarshal([]byte(pyLine), &pyStats); err != nil {
				t.Fatal(err)
			}
			goStats, err := goResult.ob.Stats(context.Background())
			if err != nil || goStats.QueueID != pyStats.QueueID || goStats.Generation != pyStats.Generation {
				t.Fatalf("one fresh queue identity required: Go=%#v Python=%#v err=%v", goStats, pyStats, err)
			}
		})
	}
}
