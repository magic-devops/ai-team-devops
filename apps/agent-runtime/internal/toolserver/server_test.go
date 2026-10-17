package toolserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/ptybackend"
)

func TestToolServerRunTool(t *testing.T) {
	root := t.TempDir()
	server, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	input := strings.NewReader(nativeRequest(t, "1", "run_tool", map[string]any{"argv": nativeToolProcessArgv(t, "cwd"), "timeout_seconds": 5}) + "\n")
	var output bytes.Buffer
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	events := decodeEvents(t, output.String())
	if len(events) != 1 || !events[0].OK || events[0].Event != "tool.completed" {
		t.Fatalf("unexpected events: %#v", events)
	}
	result, valid := events[0].Data.(map[string]any)
	if !valid || result["ok"] != true || result["exit_code"] != float64(0) || strings.TrimSpace(fmt.Sprint(result["stdout"])) != root || result["error"] != nil {
		t.Fatalf("underlying command did not execute in root: %#v", events[0].Data)
	}
}

func TestToolServerWorkspaceFileOps(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := strings.NewReader(strings.Join([]string{
		`{"id":"1","op":"workspace.file.write","data":{"path":"a.txt","expected_sha256":"missing","content":"hello"}}`,
		`{"id":"2","op":"workspace.file.read","data":{"path":"a.txt"}}`,
		"",
	}, "\n"))
	var output bytes.Buffer
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	events := decodeEvents(t, output.String())
	if len(events) != 2 || !events[0].OK || !events[1].OK {
		t.Fatalf("unexpected events: %#v", events)
	}
}

func TestToolServerWorkspaceFileListLimitDefaultsPath(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := strings.NewReader(`{"id":"1","op":"workspace.file.list","data":{"limit":1}}` + "\n")
	var output bytes.Buffer
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	events := decodeEvents(t, output.String())
	if len(events) != 1 || !events[0].OK {
		t.Fatalf("unexpected events: %#v", events)
	}
	if strings.Contains(output.String(), "path is required") {
		t.Fatalf("limit-only list treated limit as path: %s", output.String())
	}
}

func TestToolServerRejectsDuplicateTerminalSessionID(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := strings.NewReader(strings.Join([]string{
		nativeRequest(t, "t1", "terminal.spawn", map[string]any{"session_id": "same", "argv": nativeToolProcessArgv(t, "hold"), "timeout_seconds": 5}),
		nativeRequest(t, "t2", "terminal.spawn", map[string]any{"session_id": "same", "argv": nativeToolProcessArgv(t, "hold"), "timeout_seconds": 5}),
		nativeRequest(t, "c1", "terminal.close", map[string]any{"session_id": "same"}),
		"",
	}, "\n"))
	var output lockedOutput
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	assertNativeTerminalStarted(t, decodeEvents(t, output.String()), "t1")
	assertTerminalClosed(t, server, decodeEvents(t, output.String()), "c1")
	if !strings.Contains(output.String(), "terminal session already exists") {
		t.Fatalf("expected duplicate session rejection, got %s", output.String())
	}
}

func TestToolServerCapsTerminalSessions(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server.maxSessions = 1
	input := strings.NewReader(strings.Join([]string{
		nativeRequest(t, "t1", "terminal.spawn", map[string]any{"session_id": "one", "argv": nativeToolProcessArgv(t, "hold"), "timeout_seconds": 5}),
		nativeRequest(t, "t2", "terminal.spawn", map[string]any{"session_id": "two", "argv": nativeToolProcessArgv(t, "hold"), "timeout_seconds": 5}),
		nativeRequest(t, "c1", "terminal.close", map[string]any{"session_id": "one"}),
		"",
	}, "\n"))
	var output lockedOutput
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	assertNativeTerminalStarted(t, decodeEvents(t, output.String()), "t1")
	assertTerminalClosed(t, server, decodeEvents(t, output.String()), "c1")
	if !strings.Contains(output.String(), "terminal session limit reached: 1") {
		t.Fatalf("expected session cap rejection, got %s", output.String())
	}
}

func TestToolServerTerminalStartsNativePTY(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := strings.NewReader(strings.Join([]string{
		nativeRequest(t, "t1", "terminal.spawn", map[string]any{"session_id": "s1", "argv": nativeToolProcessArgv(t, "hold"), "timeout_seconds": 5}),
		nativeRequest(t, "c1", "terminal.close", map[string]any{"session_id": "s1"}),
		"",
	}, "\n"))
	var output lockedOutput
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	assertNativeTerminalStarted(t, decodeEvents(t, output.String()), "t1")
	assertTerminalClosed(t, server, decodeEvents(t, output.String()), "c1")
}

func decodeEvents(t *testing.T, raw string) []Event {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(raw), "\n")
	events := make([]Event, 0, len(lines))
	for _, line := range lines {
		var event Event
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("bad json line %q: %v", line, err)
		}
		events = append(events, event)
	}
	return events
}

func TestToolServerNativeProcess(t *testing.T) {
	switch os.Getenv("SOP_TOOLSERVER_NATIVE_PROCESS") {
	case "cwd":
		cwd, err := os.Getwd()
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprint(os.Stdout, cwd)
		os.Exit(0)
	case "hold":
		time.Sleep(10 * time.Second)
		os.Exit(0)
	}
}

func nativeToolProcessArgv(t *testing.T, mode string) []string {
	t.Helper()
	t.Setenv("SOP_TOOLSERVER_NATIVE_PROCESS", mode)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return []string{executable, "-test.run=^TestToolServerNativeProcess$"}
}

func nativeRequest(t *testing.T, id, operation string, data any) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"id": id, "op": operation, "data": data})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func assertNativeTerminalStarted(t *testing.T, events []Event, id string) {
	t.Helper()
	backend := "creack/pty"
	if runtime.GOOS == "windows" {
		backend = "conpty"
	}
	for _, event := range events {
		if event.ID != id || event.Event != "terminal.started" {
			continue
		}
		data, valid := event.Data.(map[string]any)
		if !event.OK || !valid || data["native_pty"] != true || data["backend"] != backend {
			t.Fatalf("expected real %s terminal startup: %#v", backend, event)
		}
		return
	}
	t.Fatalf("native terminal never started: %#v", events)
}

// Terminal output can arrive from its reader after Serve closes the session.
type lockedOutput struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (out *lockedOutput) Write(raw []byte) (int, error) {
	out.mu.Lock()
	defer out.mu.Unlock()
	return out.buffer.Write(raw)
}

func (out *lockedOutput) String() string {
	out.mu.Lock()
	defer out.mu.Unlock()
	return out.buffer.String()
}

func assertTerminalClosed(t *testing.T, server *Server, events []Event, id string) {
	t.Helper()
	found := false
	for _, event := range events {
		if event.ID != id {
			continue
		}
		if !event.OK || event.Event != "terminal.closed" || event.Error != "" {
			t.Fatalf("native session close failed: %#v", event)
		}
		found = true
	}
	if !found {
		t.Fatalf("native session close was not acknowledged: %#v", events)
	}
	server.mu.Lock()
	remaining := len(server.sessions)
	server.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("Serve retained %d terminal sessions after close", remaining)
	}
}

// The native integration above covers actual ConPTY. This narrow counter checks
// ownership before an asynchronous Wait finishes, without crashing the test host.
type countedNativeSession struct {
	ptybackend.Session
	closes int
}

func (session *countedNativeSession) Close() error {
	session.closes++
	return nil
}

func TestExplicitTerminalCloseReleasesIDBeforeWait(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server.maxSessions = 1
	first := &countedNativeSession{}
	previous := &terminalSession{id: "same", session: first, ready: true}
	server.sessions["same"] = previous
	server.closeTerminal(Request{ID: "close", Op: "terminal.close", Data: json.RawMessage(`{"session_id":"same"}`)}, func(Event) {})
	if err := server.reserveSessionID("same"); err != nil {
		t.Fatalf("closed terminal still owns its ID/capacity before Wait finishes: %v", err)
	}
	replacement := &terminalSession{id: "same", session: &countedNativeSession{}, ready: true}
	server.sessions["same"] = replacement
	server.deleteSessionIfSame("same", previous)
	if got, ok := server.session("same"); !ok || got != replacement {
		t.Fatal("old Wait removed a replacement session")
	}
	server.closeAll()
	if first.closes != 1 {
		t.Fatalf("old native session closed %d times", first.closes)
	}
}

func TestTerminalCleanupClosesEachNativeSessionOnce(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	native := &countedNativeSession{}
	server.sessions["same"] = &terminalSession{id: "same", session: native, ready: true}
	request := Request{ID: "close", Op: "terminal.close", Data: json.RawMessage(`{"session_id":"same"}`)}
	server.closeTerminal(request, func(Event) {})
	server.closeTerminal(request, func(Event) {})
	server.closeAll()
	if native.closes != 1 {
		t.Fatalf("native session closed %d times instead of once", native.closes)
	}
}
