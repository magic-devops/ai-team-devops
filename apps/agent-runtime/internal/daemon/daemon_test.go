package daemon

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/config"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
	httpx "github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/transport/http"
	"go.uber.org/zap"
)

func eventDaemon(t *testing.T, handler http.HandlerFunc) (*Daemon, *outbox.Outbox) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	project := t.TempDir()
	for key, value := range map[string]string{"USERPROFILE": project, "HOME": project, "PROJECT_PATH": project, "PROJECT_ID": "P", "MANAGER_URL": server.URL, "SOP_BEARER_TOKEN": "owned-token"} {
		t.Setenv(key, value)
	}
	_ = os.Getenv("PROJECT_PATH")
	ob, err := outbox.Open(filepath.Join(project, "outbox.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ob.Close() })
	cfg := &config.Config{ProjectPath: project, Manager: config.Manager{URL: server.URL, ProjectID: "P"}, Reliability: config.Reliability{BatchSize: 50, MaxRetries: 6}}
	return &Daemon{log: zap.NewNop(), cfg: cfg, outbox: ob, http: httpx.New(server.URL, "P", "owned-token", "", time.Second, true, 0)}, ob
}
func queued(t *testing.T, ob *outbox.Outbox, typ string) outbox.EnqueueInput {
	t.Helper()
	in, err := outbox.Freeze(outbox.NewEvent(typ, "subject", map[string]any{"proof": "原文 & < >"}), "P")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ob.Enqueue(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	return in
}
func identity(w http.ResponseWriter) {
	_ = json.NewEncoder(w).Encode(map[string]any{"tenant_id": "T", "project_id": "P", "producer_id": "U"})
}
func receiptResponse(id, digest string) map[string]any {
	return map[string]any{"id": id, "digest": digest, "outcome": "stored", "receipt_id": "receipt-" + id, "stored_at": "2026-10-18T00:00:00Z", "error": nil, "processing": map[string]any{"state": "pending", "revision": 1, "handler": nil, "operation_id": nil, "attempts": 0, "updated_at": "2026-10-18T00:00:00Z", "processed_at": nil, "reason_code": "handler_not_configured", "retryable": false, "result": nil}}
}
func TestGenericAndHeartbeatPostOriginalBytesAndAckDurableReceipt(t *testing.T) {
	var received []frozenWire
	d, ob := eventDaemon(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/events:identity" {
			identity(w)
			return
		}
		if r.Method != "POST" || r.URL.Path != "/api/v1/events:ingest" {
			t.Errorf("unexpected route%s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
			return
		}
		var body ingestRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.ExpectedTenantID != "T" || body.ExpectedProjectID != "P" || body.ExpectedProducerID != "U" {
			t.Error("missing original verified scope")
		}
		received = append(received, body.Events...)
		results := []any{}
		for _, e := range body.Events {
			results = append(results, receiptResponse(e.ID, e.Digest))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"tenant_id": "T", "project_id": "P", "producer": map[string]any{"kind": "user", "id": "U"}, "as_of": "2026-10-18T00:00:00Z", "results": results})
	})
	first := queued(t, ob, "sop.custom.fact")
	second := queued(t, ob, "sop.agent.heartbeat")
	d.flushOutboxOnce(context.Background())
	if len(received) != 2 {
		t.Fatalf("events not really posted: %#v", received)
	}
	original := map[string]outbox.EnqueueInput{first.ID: first, second.ID: second}
	for _, event := range received {
		in := original[event.ID]
		if event.EventJSON != in.EventJSON || event.Digest != in.Digest {
			t.Fatal("original event bytes were reconstructed")
		}
		record, err := ob.Get(context.Background(), event.ID)
		if err != nil || record.State != "acked" || record.ProcessingState == nil || *record.ProcessingState != "pending" {
			t.Fatalf("handoff/processing conflated %#v %v", record, err)
		}
	}
}
func TestHealthOnlySuccessNeverAcknowledgesHeartbeat(t *testing.T) {
	var calls atomic.Int32
	d, ob := eventDaemon(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/health" {
			calls.Add(1)
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		http.Error(w, "no durable receipt", 503)
	})
	in := queued(t, ob, "sop.agent.heartbeat")
	d.flushOutboxOnce(context.Background())
	record, err := ob.Get(context.Background(), in.ID)
	if err != nil || record.State != "pending" || record.EventJSON != in.EventJSON {
		t.Fatalf("health success dropped event: %#v %v", record, err)
	}
	if calls.Load() != 0 {
		t.Fatal("event sender still used public health as a delivery route")
	}
}
func TestMalformedReceiptBatchNeverAcksAnyOriginal(t *testing.T) {
	for _, mode := range []string{"unknown", "duplicate", "digest", "empty", "missing_revision", "null_retryable", "bad_updated_at", "rejected_null_retryable"} {
		t.Run(mode, func(t *testing.T) {
			d, ob := eventDaemon(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/v1/events:identity" {
					identity(w)
					return
				}
				if mode == "empty" {
					_, _ = w.Write([]byte(`{}`))
					return
				}
				var body ingestRequest
				_ = json.NewDecoder(r.Body).Decode(&body)
				results := []any{}
				for _, e := range body.Events {
					results = append(results, receiptResponse(e.ID, e.Digest))
				}
				switch mode {
				case "unknown":
					results = append(results, receiptResponse("unknown", body.Events[0].Digest))
				case "duplicate":
					results = append(results, results[0])
				case "digest":
					results[0].(map[string]any)["digest"] = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
				case "missing_revision":
					delete(results[0].(map[string]any)["processing"].(map[string]any), "revision")
				case "null_retryable":
					results[0].(map[string]any)["processing"].(map[string]any)["retryable"] = nil
				case "bad_updated_at":
					results[0].(map[string]any)["processing"].(map[string]any)["updated_at"] = "not-a-time"
				case "rejected_null_retryable":
					first := results[0].(map[string]any)
					first["outcome"] = "rejected"
					first["receipt_id"] = nil
					first["stored_at"] = nil
					first["processing"] = nil
					first["error"] = map[string]any{"code": "busy", "message": "bad field", "retryable": nil}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"tenant_id": "T", "project_id": "P", "producer": map[string]any{"kind": "user", "id": "U"}, "as_of": "2026-10-18T00:00:00Z", "results": results})
			})
			a := queued(t, ob, "sop.fact")
			b := queued(t, ob, "sop.fact")
			d.flushOutboxOnce(context.Background())
			for _, id := range []string{a.ID, b.ID} {
				r, _ := ob.Get(context.Background(), id)
				if r.State != "pending" {
					t.Fatalf("malformed batch acked %s", id)
				}
			}
		})
	}
}
func TestMissingKnownReceiptRetainsOnlyMissingOriginal(t *testing.T) {
	var missing string
	d, ob := eventDaemon(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/events:identity" {
			identity(w)
			return
		}
		var body ingestRequest
		_ = json.NewDecoder(r.Body).Decode(&body)
		missing = body.Events[1].ID
		_ = json.NewEncoder(w).Encode(map[string]any{"tenant_id": "T", "project_id": "P", "producer": map[string]any{"kind": "user", "id": "U"}, "as_of": "2026-10-18T00:00:00Z", "results": []any{receiptResponse(body.Events[0].ID, body.Events[0].Digest)}})
	})
	a := queued(t, ob, "sop.fact")
	b := queued(t, ob, "sop.fact")
	d.flushOutboxOnce(context.Background())
	for _, id := range []string{a.ID, b.ID} {
		r, _ := ob.Get(context.Background(), id)
		want := "acked"
		if id == missing {
			want = "pending"
		}
		if r.State != want {
			t.Fatalf("per-ID handoff got%s want%s", r.State, want)
		}
	}
}
func TestCredentialChangeCannotRebindOriginalQueue(t *testing.T) {
	d, ob := eventDaemon(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/events:identity" {
			_ = json.NewEncoder(w).Encode(map[string]any{"tenant_id": "T", "project_id": "P", "producer_id": "new-user"})
			return
		}
		t.Error("wrong user sent previously bound event")
		http.Error(w, "not allowed", 403)
	})
	in := queued(t, ob, "sop.fact")
	_, err := ob.Bind(context.Background(), in.ID, 1, outbox.Scope{TenantID: "T", ProjectID: "P", ProducerID: "original-user", ManagerOrigin: d.http.BaseURL()})
	if err != nil {
		t.Fatal(err)
	}
	d.flushOutboxOnce(context.Background())
	r, _ := ob.Get(context.Background(), in.ID)
	if r.State != "pending" || r.ExpectedProducerID == nil || *r.ExpectedProducerID != "original-user" {
		t.Fatal("old queue reassigned to new credentials")
	}
}
func TestOldBareWriteOpsCannotCreateSecondQueue(t *testing.T) {
	d, ob := eventDaemon(t, func(w http.ResponseWriter, r *http.Request) { t.Error("bare legacy operation reached network") })
	for _, op := range []string{"event", "task.update", "issue.report", "sync.push"} {
		response := d.dispatchIPC(context.Background(), IPCRequest{V: 1, Op: op, Data: map[string]any{"expected_version": 0}})
		if response.OK || response.ErrorCode != "event_frozen_required" {
			t.Fatalf("legacy route did not reject: %#v", response)
		}
	}
	s, err := ob.Stats(context.Background())
	if err != nil || s.Pending != 0 {
		t.Fatalf("legacy writes queued: %#v %v", s, err)
	}
}

func TestCancelledIngestKeepsBoundOriginalWithoutConsumingRetry(t *testing.T) {
	arrived := make(chan struct{})
	releaseServer := make(chan struct{})
	defer close(releaseServer)
	d, ob := eventDaemon(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/events:identity" {
			identity(w)
			return
		}
		// Bounded owned server lifetime; cancellation is asserted on the real client below.
		close(arrived)
		<-releaseServer
	})
	in := queued(t, ob, "sop.fact")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { d.flushOutboxOnce(ctx); close(done) }()
	select {
	case <-arrived:
	case <-time.After(time.Second):
		t.Fatal("real ingest did not start")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancelled real ingest blocked shutdown")
	}
	row, err := ob.Get(context.Background(), in.ID)
	if err != nil || row.State != "pending" || row.Attempts != 0 || row.BindingState != "bound" || row.EventJSON != in.EventJSON {
		t.Fatalf("cancel rewrote/consumed original %#v %v", row, err)
	}
}
func TestRejectedAndBusinessFailedResultsKeepDifferentLocalStates(t *testing.T) {
	rejectedID := ""
	d, ob := eventDaemon(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/events:identity" {
			identity(w)
			return
		}
		var body ingestRequest
		_ = json.NewDecoder(r.Body).Decode(&body)
		results := []any{}
		for i, event := range body.Events {
			item := receiptResponse(event.ID, event.Digest)
			if i == 0 {
				rejectedID = event.ID
				item["outcome"] = "rejected"
				item["receipt_id"] = nil
				item["stored_at"] = nil
				item["processing"] = nil
				item["error"] = map[string]any{"code": "event_digest_conflict", "message": "same ID conflict", "retryable": false}
			} else {
				p := item["processing"].(map[string]any)
				p["state"] = "failed"
				p["reason_code"] = "expected_version_required"
			}
			results = append(results, item)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"tenant_id": "T", "project_id": "P", "producer": map[string]any{"kind": "user", "id": "U"}, "as_of": "2026-10-18T00:00:00Z", "results": results})
	})
	a := queued(t, ob, "sop.task.update")
	b := queued(t, ob, "sop.task.update")
	d.flushOutboxOnce(context.Background())
	for _, id := range []string{a.ID, b.ID} {
		row, err := ob.Get(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if id == rejectedID {
			if row.State != "dead_letter" || row.ReceiptID != nil {
				t.Fatalf("rejected falsely acked %#v", row)
			}
		} else if row.State != "acked" || row.ProcessingState == nil || *row.ProcessingState != "failed" {
			t.Fatalf("business failure conflated with local handoff %#v", row)
		}
	}
}
