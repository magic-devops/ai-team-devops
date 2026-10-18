package daemon

import (
	"context"
	"encoding/json"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func queueCall(d *Daemon, op string, data map[string]any) IPCResponse {
	return d.dispatchIPC(context.Background(), IPCRequest{V: 1, Op: op, Data: data})
}
func TestQueueIPCExactOriginalInspectListAndRequeue(t *testing.T) {
	d, ob := eventDaemon(t, func(w http.ResponseWriter, r *http.Request) { t.Error("local queue operation reached network") })
	event := outbox.NewEvent("sop.fact", "task", map[string]any{"text": "原文 < & >"})
	event.ID = "fixed-original"
	in, err := outbox.Freeze(event, "P")
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"id": in.ID, "event_json": in.EventJSON, "digest": in.Digest, "intended_project_id": "P"}
	first := queueCall(d, "event.enqueue", body)
	if !first.OK || first.ID != in.ID || first.Result["replayed"] != false {
		t.Fatalf("enqueue %#v", first)
	}
	second := queueCall(d, "event.enqueue", body)
	if !second.OK || second.Result["replayed"] != true {
		t.Fatalf("same original %#v", second)
	}
	inspect := queueCall(d, "outbox.inspect", map[string]any{"id": in.ID})
	if !inspect.OK || inspect.Result["event_json"] != in.EventJSON || inspect.Result["digest"] != in.Digest {
		t.Fatalf("inspect reconstructed original %#v", inspect)
	}
	page := queueCall(d, "outbox.list", nil)
	if !page.OK || page.Result["limit"] != json.Number("20") || page.Result["total"] != json.Number("1") {
		t.Fatalf("default page %#v", page)
	}
	items := page.Result["items"].([]any)
	metadata := items[0].(map[string]any)
	if _, exists := metadata["event_json"]; exists {
		t.Fatal("list leaked frozen event body")
	}
	body["event_json"] = in.EventJSON + " "
	body["digest"] = outbox.Digest(body["event_json"].(string))
	if changed := queueCall(d, "event.enqueue", body); changed.OK || changed.ErrorCode != "event_id_conflict" {
		t.Fatalf("changed original %#v", changed)
	}
	dead, err := ob.Retry(context.Background(), in.ID, 1, 0, outbox.Failure{Code: "offline", Retryable: true})
	if err != nil {
		t.Fatal(err)
	}
	intent := map[string]any{"id": in.ID, "expected_revision": dead.Revision, "reason": "恢复原文", "idempotency_key": "original-key"}
	restored := queueCall(d, "outbox.requeue", intent)
	replay := queueCall(d, "outbox.requeue", intent)
	if !restored.OK || !replay.OK || restored.Result["revision"] != replay.Result["revision"] || replay.Result["replayed"] != true {
		t.Fatalf("original requeue result %#v %#v", restored, replay)
	}
	row, _ := ob.Get(context.Background(), in.ID)
	if row.EventJSON != in.EventJSON || row.Digest != in.Digest || row.State != "pending" {
		t.Fatal("requeue changed original")
	}
}
func TestQueueIPCRejectsMalformedIntentAndReportsUnavailableStorage(t *testing.T) {
	d, ob := eventDaemon(t, func(w http.ResponseWriter, r *http.Request) { t.Error("invalid intent reached network") })
	cases := []struct {
		op   string
		data map[string]any
		code string
	}{
		{"outbox.list", map[string]any{"limit": true}, "payload_invalid"},
		{"outbox.list", map[string]any{"limit": 0}, "payload_invalid"},
		{"outbox.list", map[string]any{"limit": 51}, "payload_invalid"},
		{"outbox.list", map[string]any{"state": "unknown"}, "payload_invalid"},
		{"outbox.list", map[string]any{"cursor": nil}, "payload_invalid"},
		{"outbox.inspect", map[string]any{}, "payload_invalid"},
		{"outbox.inspect", map[string]any{"id": "absent"}, "event_not_found"},
		{"outbox.stats", map[string]any{"extra": true}, "payload_invalid"},
		{"outbox.requeue", map[string]any{"id": "E", "expected_revision": 1.5, "reason": "r", "idempotency_key": "k"}, "payload_invalid"},
		{"event.enqueue", map[string]any{"intended_project_id": "other"}, "scope_mismatch"},
	}
	for _, tc := range cases {
		response := queueCall(d, tc.op, tc.data)
		if response.OK || response.ErrorCode != tc.code {
			t.Fatalf("%s %#v => %#v", tc.op, tc.data, response)
		}
	}
	if err := ob.Close(); err != nil {
		t.Fatal(err)
	}
	stats := queueCall(d, "outbox.stats", nil)
	if stats.OK || stats.ErrorCode != "queue_error" {
		t.Fatalf("closed DB pretended zero queue %#v", stats)
	}
	health := queueCall(d, "health", nil)
	if health.Result["outbox_error"] == nil {
		t.Fatal("health hid storage error")
	}
	if _, exists := health.Result["outbox_depth"]; exists {
		t.Fatal("health reported fake zero depth")
	}
}
func TestLegacyJSONLIsInventoriedWithoutReplayOrDeletion(t *testing.T) {
	d, ob := eventDaemon(t, func(w http.ResponseWriter, r *http.Request) { t.Error("legacy files unexpectedly sent") })
	relative := ".sop-runtime/sync/push_queue.jsonl"
	path := filepath.Join(d.cfg.ProjectPath, relative)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	original := []byte("{old unresolved payload}\n")
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	response := queueCall(d, "health", nil)
	files := response.Result["legacy_files"].([]map[string]any)
	if len(files) != 1 || files[0]["migration_required"] != true {
		t.Fatalf("legacy metadata missing %#v", files)
	}
	d.flushOutboxOnce(context.Background())
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(original) {
		t.Fatal("historical original changed")
	}
	stats, err := ob.Stats(context.Background())
	if err != nil || stats.Pending != 0 || stats.Acked != 0 {
		t.Fatal("legacy JSONL became second event authority")
	}
}
