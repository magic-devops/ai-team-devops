package outbox_test

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
)

func reflectionInput(t *testing.T, id string) outbox.EnqueueInput {
	t.Helper()
	event := outbox.NewEvent("sop.reflection.recorded", "", map[string]any{
		"schema_version": 1, "category": "testing", "title": "原件 é", "observation": "这是生产者陈述。",
	})
	event.ID = id
	in, err := outbox.Freeze(event, "P")
	if err != nil {
		t.Fatal(err)
	}
	return in
}

func reflectionReceipt(in outbox.EnqueueInput) outbox.RemoteReceipt {
	r := receipt(in)
	handler, targetKind := "reflection.record", "reflection"
	r.Processing.State = "processed"
	r.Processing.Handler = &handler
	r.Processing.Revision = 2
	r.Processing.Attempts = 1
	r.Processing.ProcessedAt = r.StoredAt
	r.Processing.Result = &outbox.EffectResult{Kind: "reflection_recorded", TargetKind: &targetKind, TargetID: r.ReceiptID}
	return r
}

func TestReflectionProcessedEffectAcknowledgementSurvivesReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "reflection.sqlite")
	ob := openOutbox(t, path)
	in := reflectionInput(t, "reflection-original")
	enqueue(t, ob, in)
	bound, err := ob.Bind(ctx, in.ID, 1, scope())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ob.Ack(ctx, in.ID, bound.Revision, reflectionReceipt(in)); err != nil {
		t.Fatalf("real reflection collection ACK rejected: %v", err)
	}
	if err = ob.Close(); err != nil {
		t.Fatal(err)
	}
	ob = openOutbox(t, path)
	r, err := ob.Get(ctx, in.ID)
	if err != nil || r.State != "acked" || r.EventJSON != in.EventJSON || r.ProcessingState == nil || *r.ProcessingState != "processed" {
		t.Fatalf("frozen reflection or its ACK lost on reopen: %#v, %v", r, err)
	}
	var actual outbox.RemoteReceipt
	if r.RemoteReceiptJSON == nil || json.Unmarshal([]byte(*r.RemoteReceiptJSON), &actual) != nil || actual.Processing.Result.Kind != "reflection_recorded" {
		t.Fatal("canonical reflection effect was not preserved")
	}
}

func TestReflectionEffectRejectsForgedTargetWithoutAcknowledgingOriginal(t *testing.T) {
	for _, name := range []string{"wrong-kind", "missing-kind", "wrong-id", "missing-target", "unknown-effect", "fact_recorded", "task_updated", "issue_created", "record_upserted", "record_deleted", "asset_materialized", "task_delivery_submitted", "wrong-handler", "missing-handler", "pending", "failed", "no-attempt", "no-processed-at", "invalid-processed-at"} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			ob := openOutbox(t, filepath.Join(t.TempDir(), "reflection.sqlite"))
			in := reflectionInput(t, "reflection-original")
			enqueue(t, ob, in)
			bound, err := ob.Bind(ctx, in.ID, 1, scope())
			if err != nil {
				t.Fatal(err)
			}
			r := reflectionReceipt(in)
			switch name {
			case "wrong-kind":
				value := "task"
				r.Processing.Result.TargetKind = &value
			case "missing-kind":
				r.Processing.Result.TargetKind = nil
			case "wrong-id":
				value := "different-receipt"
				r.Processing.Result.TargetID = &value
			case "missing-target":
				r.Processing.Result.TargetID = nil
			case "unknown-effect":
				r.Processing.Result.Kind = "reflection_recorded_typo"
			case "fact_recorded", "task_updated", "issue_created", "record_upserted", "record_deleted", "asset_materialized", "task_delivery_submitted":
				r.Processing.Result.Kind = name
			case "wrong-handler":
				value := "task.status"
				r.Processing.Handler = &value
			case "missing-handler":
				r.Processing.Handler = nil
			case "pending", "failed":
				r.Processing.State = name
			case "no-attempt":
				r.Processing.Attempts = 0
			case "no-processed-at":
				r.Processing.ProcessedAt = nil
			case "invalid-processed-at":
				value := "not-a-timestamp"
				r.Processing.ProcessedAt = &value
			}
			if _, err = ob.Ack(ctx, in.ID, bound.Revision, r); err == nil {
				t.Fatal("a mismatched reflection effect acknowledged the only original")
			}
			stored, err := ob.Get(ctx, in.ID)
			if err != nil || stored.State != "pending" || stored.EventJSON != in.EventJSON {
				t.Fatalf("rejected ACK changed original: %#v %v", stored, err)
			}
		})
	}
}

func reflectionPython(t *testing.T, operation, path string, args ...string) map[string]json.RawMessage {
	t.Helper()
	python, root, _ := pythonRuntime(t)
	script := filepath.Join(root, "apps", "agent-runtime", "internal", "outbox", "testdata", "reflection_ack.py")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	all := append([]string{script, operation, path}, args...)
	cmd := exec.CommandContext(ctx, python, all...)
	cmd.Env = append(os.Environ(), "PYTHONUTF8=1", "PYTHONIOENCODING=utf-8", "PYTHONDONTWRITEBYTECODE=1", "PYTHONPATH="+filepath.Join(root, "packages", "sop-sdk-python"))
	raw, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real Python reflection %s: %v\n%s", operation, err, raw)
	}
	var result map[string]json.RawMessage
	if err = json.Unmarshal(raw, &result); err != nil {
		t.Fatalf("Python reflection result is not JSON: %v", err)
	}
	return result
}

func TestActualPythonGoReflectionEffectAckKeepsBothOriginals(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "shared-reflection.sqlite")
	created := reflectionPython(t, "enqueue", path)
	var fields map[string]string
	if err := json.Unmarshal(created["input"], &fields); err != nil {
		t.Fatal(err)
	}
	in := outbox.EnqueueInput{ID: fields["id"], EventJSON: fields["event_json"], Digest: fields["digest"], IntendedProjectID: "P"}
	ob := openOutbox(t, path)
	bound, err := ob.Bind(ctx, in.ID, 1, scope())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ob.Ack(ctx, in.ID, bound.Revision, reflectionReceipt(in)); err != nil {
		t.Fatalf("Go rejected reflection created by the actual typed Python producer: %v", err)
	}
	inspected := reflectionPython(t, "inspect", path, in.ID)
	var row struct {
		State     string `json:"state"`
		EventJSON string `json:"event_json"`
	}
	if json.Unmarshal(inspected["record"], &row) != nil || row.State != "acked" || row.EventJSON != in.EventJSON {
		t.Fatal("Python did not observe exact Go-acknowledged reflection original")
	}
	fromGo := reflectionInput(t, "reflection-from-go")
	enqueue(t, ob, fromGo)
	if _, err = ob.Bind(ctx, fromGo.ID, 1, scope()); err != nil {
		t.Fatal(err)
	}
	proof, err := json.Marshal(reflectionReceipt(fromGo))
	if err != nil {
		t.Fatal(err)
	}
	_ = reflectionPython(t, "ack", path, fromGo.ID, string(proof))
	stored, err := ob.Get(ctx, fromGo.ID)
	if err != nil || stored.State != "acked" || stored.EventJSON != fromGo.EventJSON {
		t.Fatalf("Go did not observe actual Python ACK of its exact original: %#v %v", stored, err)
	}
}
