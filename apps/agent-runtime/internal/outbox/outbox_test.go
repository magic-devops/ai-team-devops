package outbox_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
)

func openOutbox(t *testing.T, path string) *outbox.Outbox {
	t.Helper()
	ob, err := outbox.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ob.Close() })
	return ob
}

func openDatabase(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// Removing the real SQLite implementation from a CGO-disabled build must fail here.
func TestDurableIdempotentEventsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "space \u4e2d\u6587 # & +", "outbox.sqlite")
	ob := openOutbox(t, path)
	ctx := context.Background()
	e := outbox.NewEvent("sop.sync", "T-1", map[string]any{"body": "original"})
	if err := ob.Append(ctx, e); err != nil {
		t.Fatal(err)
	}
	e.Data["body"] = "replacement"
	if err := ob.Append(ctx, e); err != nil {
		t.Fatal(err)
	}
	if err := ob.Close(); err != nil {
		t.Fatal(err)
	}
	ob = openOutbox(t, path)
	got, err := ob.PendingBatch(ctx, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != e.ID || got[0].Data["body"] != "original" {
		t.Fatalf("reopened event lost its idempotent original payload: %#v", got)
	}
	if err := ob.Ack(ctx, e.ID); err != nil {
		t.Fatal(err)
	}
	if err := ob.Ack(ctx, e.ID); err != nil {
		t.Fatal(err)
	}
	if err := ob.Close(); err != nil {
		t.Fatal(err)
	}
	ob = openOutbox(t, path)
	if n, err := ob.Depth(ctx); err != nil || n != 0 {
		t.Fatalf("ack did not persist: %d %v", n, err)
	}
	header, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(header) < 16 || string(header[:16]) != "SQLite format 3\x00" {
		t.Fatal("outbox is not a SQLite database")
	}
}

func TestCancelledOperationsLeaveEventUnchanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outbox.sqlite")
	ob := openOutbox(t, path)
	e := outbox.NewEvent("sop.sync", "T-1", nil)
	if err := ob.Append(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := ob.Append(ctx, outbox.NewEvent("other", "T-2", nil)); !errors.Is(err, context.Canceled) {
		t.Fatalf("append error: %v", err)
	}
	if dropped, err := ob.Retry(ctx, e.ID, 0); dropped || !errors.Is(err, context.Canceled) {
		t.Fatalf("retry: dropped=%v err=%v", dropped, err)
	}
	if err := ob.Ack(ctx, e.ID); !errors.Is(err, context.Canceled) {
		t.Fatalf("ack error: %v", err)
	}
	got, err := ob.PendingBatch(context.Background(), 20)
	if err != nil || len(got) != 1 || got[0].ID != e.ID {
		t.Fatalf("cancellation changed queue: %#v %v", got, err)
	}
}

func TestRetryPersistsBackoffThenDropsAtLimit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outbox.sqlite")
	ob := openOutbox(t, path)
	ctx := context.Background()
	e := outbox.NewEvent("sop.sync", "T-1", nil)
	if err := ob.Append(ctx, e); err != nil {
		t.Fatal(err)
	}
	before := time.Now().Unix()
	if dropped, err := ob.Retry(ctx, e.ID, 1); dropped || err != nil {
		t.Fatalf("first retry: %v %v", dropped, err)
	}
	if err := ob.Close(); err != nil {
		t.Fatal(err)
	}
	ob = openOutbox(t, path)
	db := openDatabase(t, path)
	var retries int
	var next int64
	if err := db.QueryRow("SELECT retries,next_at FROM events WHERE id=?", e.ID).Scan(&retries, &next); err != nil {
		t.Fatal(err)
	}
	if retries != 1 || next < before+2 || next > time.Now().Unix()+2 {
		t.Fatalf("bad persisted backoff: retries=%d next=%d", retries, next)
	}
	got, err := ob.PendingBatch(ctx, 20)
	if err != nil || len(got) != 0 {
		t.Fatalf("delayed event is immediately due: %#v %v", got, err)
	}
	if dropped, err := ob.Retry(ctx, e.ID, 1); !dropped || err != nil {
		t.Fatalf("exhausted retry: %v %v", dropped, err)
	}
	if n, err := ob.Depth(ctx); err != nil || n != 0 {
		t.Fatalf("exhausted row remains: %d %v", n, err)
	}
}

func TestConcurrentRetriesDoNotLoseIncrements(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outbox.sqlite")
	a, b := openOutbox(t, path), openOutbox(t, path)
	e := outbox.NewEvent("sop.sync", "T-1", nil)
	if err := a.Append(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	const count = 12
	errs := make(chan error, count)
	var wg sync.WaitGroup
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ob := a
			if i%2 != 0 {
				ob = b
			}
			dropped, err := ob.Retry(context.Background(), e.ID, 20)
			if dropped && err == nil {
				err = errors.New("retry dropped too early")
			}
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var retries int
	if err := openDatabase(t, path).QueryRow("SELECT retries FROM events WHERE id=?", e.ID).Scan(&retries); err != nil {
		t.Fatal(err)
	}
	if retries != count {
		t.Fatalf("lost concurrent increments: got %d want %d", retries, count)
	}
}

func TestRetryFailureDoesNotClaimDroppedOrRemoveEvent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outbox.sqlite")
	ob := openOutbox(t, path)
	e := outbox.NewEvent("sop.sync", "T-1", nil)
	if err := ob.Append(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	db := openDatabase(t, path)
	if _, err := db.Exec("CREATE TRIGGER reject_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'cannot delete'); END"); err != nil {
		t.Fatal(err)
	}
	dropped, err := ob.Retry(context.Background(), e.ID, 0)
	if dropped || err == nil {
		t.Fatalf("failed delete reported success: dropped=%v err=%v", dropped, err)
	}
	var retries int
	if err := db.QueryRow("SELECT retries FROM events WHERE id=?", e.ID).Scan(&retries); err != nil {
		t.Fatal(err)
	}
	if retries != 0 {
		t.Fatalf("failed transaction changed retry count: %d", retries)
	}
}

func TestRetryBackoffCapsWithoutOverflow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outbox.sqlite")
	ob := openOutbox(t, path)
	e := outbox.NewEvent("sop.sync", "T-1", nil)
	if err := ob.Append(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	db := openDatabase(t, path)
	if _, err := db.Exec("UPDATE events SET retries=63 WHERE id=?", e.ID); err != nil {
		t.Fatal(err)
	}
	before := time.Now().Unix()
	if dropped, err := ob.Retry(context.Background(), e.ID, 100); dropped || err != nil {
		t.Fatalf("retry: %v %v", dropped, err)
	}
	var next int64
	if err := db.QueryRow("SELECT next_at FROM events WHERE id=?", e.ID).Scan(&next); err != nil {
		t.Fatal(err)
	}
	if next < before+300 || next > time.Now().Unix()+300 {
		t.Fatalf("backoff overflowed instead of capping: %d", next-before)
	}
}

func TestOpenRejectsDirectoryAsDatabase(t *testing.T) {
	path := t.TempDir()
	ob, err := outbox.Open(path)
	if ob != nil {
		_ = ob.Close()
	}
	if err == nil {
		t.Fatal("directory path unexpectedly opened")
	}
}

func TestExistingSQLiteEventsArePreserved(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outbox.sqlite")
	db := openDatabase(t, path)
	_, err := db.Exec(`CREATE TABLE events (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, subject TEXT,
        payload TEXT NOT NULL, retries INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    ); INSERT INTO events VALUES (
        'legacy-1','sop.sync','T-legacy',
        '{"id":"legacy-1","type":"sop.sync","subject":"T-legacy","time":"2026-10-18T00:00:00Z","data":{"source":"existing"}}',
        2,0,1
    );`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	ob := openOutbox(t, path)
	got, err := ob.PendingBatch(context.Background(), 20)
	if err != nil || len(got) != 1 || got[0].ID != "legacy-1" || got[0].Data["source"] != "existing" {
		t.Fatalf("existing event changed: %#v %v", got, err)
	}
}

func TestWALAllowsAppendWhileReaderIsOpen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outbox.sqlite")
	ob := openOutbox(t, path)
	db := openDatabase(t, path)
	var mode string
	if err := db.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" {
		t.Fatalf("expected WAL mode, got %q", mode)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRow("SELECT COUNT(*) FROM events").Scan(&count); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := ob.Append(ctx, outbox.NewEvent("sop.sync", "T-1", nil)); err != nil {
		t.Fatalf("reader blocked append: %v", err)
	}
	if err := tx.QueryRow("SELECT COUNT(*) FROM events").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("reader lost its snapshot: %d", count)
	}
	if n, err := ob.Depth(context.Background()); err != nil || n != 1 {
		t.Fatalf("append not persisted: %d %v", n, err)
	}
}

func TestPersistentEventSurvivesAbruptProcessExit(t *testing.T) {
	const childPath = "SOP_OUTBOX_CRASH_TEST_PATH"
	if path := os.Getenv(childPath); path != "" {
		ob, err := outbox.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := ob.Append(context.Background(), outbox.Event{ID: "before-exit", Type: "sop.sync", Time: time.Now().UTC()}); err != nil {
			t.Fatal(err)
		}
		// Exit without closing SQLite, as on a forcibly terminated daemon.
		os.Exit(0)
	}
	path := filepath.Join(t.TempDir(), "outbox.sqlite")
	cmd := exec.Command(os.Args[0], "-test.run=^TestPersistentEventSurvivesAbruptProcessExit$")
	cmd.Env = append(os.Environ(), childPath+"="+path)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("child: %v\n%s", err, output)
	}
	ob := openOutbox(t, path)
	got, err := ob.PendingBatch(context.Background(), 20)
	if err != nil || len(got) != 1 || got[0].ID != "before-exit" {
		t.Fatalf("event lost after abrupt exit: %#v %v", got, err)
	}
	var integrity string
	if err := openDatabase(t, path).QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		t.Fatalf("integrity: %q %v", integrity, err)
	}
}

func TestCancelledAppendWaitingForWriterLockDoesNotWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outbox.sqlite")
	ob := openOutbox(t, path)
	db := openDatabase(t, path)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec("INSERT INTO events VALUES ('lock','lock','','{}',0,0,0)"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	err = ob.Append(ctx, outbox.Event{ID: "cancelled-while-locked", Type: "sop.sync", Time: time.Now().UTC()})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("locked append cancellation: %v", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if n, err := ob.Depth(context.Background()); err != nil || n != 0 {
		t.Fatalf("cancelled append wrote data: %d %v", n, err)
	}
}
