package outbox_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
)

func TestQueueUsesSharedSchemaVersionOne(t *testing.T) {
	path := filepath.Join(t.TempDir(), "queue.sqlite")
	ob := openOutbox(t, path)
	_ = ob
	var version int
	if err := openDatabase(t, path).QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 1 {
		t.Fatalf("queue schema=%d; durable shared state schema1 required", version)
	}
}

func TestExhaustionRetainsTheOriginalDurablePayload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "queue.sqlite")
	ob := openOutbox(t, path)
	e := outbox.NewEvent("sop.audit", "owned", map[string]any{"proof": "original"})
	in, err := outbox.Freeze(e, "P")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ob.Enqueue(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	if _, err := ob.Retry(context.Background(), e.ID, 1, 0, outbox.Failure{Code: "transport", Message: "offline", Retryable: true}); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := openDatabase(t, path).QueryRow("SELECT count(*) FROM events WHERE id=?", e.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("last durable event copy lost at exhaustion: count=%d", count)
	}
}

func TestSameIDChangedPayloadIsAnExplicitConflict(t *testing.T) {
	ob := openOutbox(t, filepath.Join(t.TempDir(), "queue.sqlite"))
	e := outbox.NewEvent("sop.audit", "owned", map[string]any{"proof": "original"})
	in, err := outbox.Freeze(e, "P")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ob.Enqueue(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	e.Data["proof"] = "different"
	changed, err := outbox.Freeze(e, "P")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ob.Enqueue(context.Background(), changed); err == nil {
		t.Fatal("changed same-ID payload was silently accepted")
	}
}

func TestNonemptyLegacyQueueNeedsExplicitScopeMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.sqlite")
	db := openDatabase(t, path)
	_, err := db.Exec("CREATE TABLE events(id TEXT PRIMARY KEY,type TEXT NOT NULL,subject TEXT,payload TEXT NOT NULL,retries INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL); INSERT INTO events VALUES('original','sop.audit','','{}',2,3,4)")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	ob, err := outbox.Open(path)
	if ob != nil {
		_ = ob.Close()
	}
	if err == nil {
		t.Fatal("nonempty v0 automatically opened without operator project binding")
	}
	var payload string
	if err := openDatabase(t, path).QueryRow("SELECT payload FROM events WHERE id='original'").Scan(&payload); err != nil || payload != "{}" {
		t.Fatalf("legacy original changed: %q %v", payload, err)
	}
}
