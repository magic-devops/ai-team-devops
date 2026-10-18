package outbox_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
func input(t *testing.T, id string) outbox.EnqueueInput {
	t.Helper()
	e := outbox.NewEvent("sop.audit", "T", map[string]any{"original": "中文 & < >"})
	e.ID = id
	in, err := outbox.Freeze(e, "P")
	if err != nil {
		t.Fatal(err)
	}
	return in
}
func enqueue(t *testing.T, ob *outbox.Outbox, in outbox.EnqueueInput) outbox.MutationResult {
	t.Helper()
	r, err := ob.Enqueue(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func scope() outbox.Scope {
	return outbox.Scope{TenantID: "T", ProjectID: "P", ProducerID: "U", ManagerOrigin: "http://manager"}
}
func receipt(in outbox.EnqueueInput) outbox.RemoteReceipt {
	id := "receipt-" + in.ID
	at := "2026-10-18T00:00:00Z"
	return outbox.RemoteReceipt{ID: in.ID, Digest: in.Digest, Outcome: "stored", ReceiptID: &id, StoredAt: &at, Processing: &outbox.Processing{State: "pending", Revision: 1, UpdatedAt: at}}
}
func TestSchemaBytesMatchNormativeSQL(t *testing.T) {
	norm, err := os.ReadFile("../../../../apis/sqlite/event_outbox_v1.sql")
	if err != nil {
		t.Fatal(err)
	}
	embedded, err := os.ReadFile("schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if string(norm) != string(embedded) {
		t.Fatal("packaged Go schema drifted from shared normative SQL")
	}
}
func TestDurableOriginalAndAckSurviveReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "中文 # & +", "outbox.sqlite")
	ob := openOutbox(t, path)
	in := input(t, "E")
	enqueue(t, ob, in)
	if r := enqueue(t, ob, in); !r.Replayed {
		t.Fatal("same original was not replayed")
	}
	if err := ob.Close(); err != nil {
		t.Fatal(err)
	}
	ob = openOutbox(t, path)
	r, err := ob.Get(context.Background(), "E")
	if err != nil || r.EventJSON != in.EventJSON {
		t.Fatalf("original lost: %#v %v", r, err)
	}
	bound, err := ob.Bind(context.Background(), "E", r.Revision, scope())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ob.Ack(context.Background(), "E", bound.Revision, receipt(in)); err != nil {
		t.Fatal(err)
	}
	if err = ob.Close(); err != nil {
		t.Fatal(err)
	}
	ob = openOutbox(t, path)
	r, err = ob.Get(context.Background(), "E")
	if err != nil || r.State != "acked" || r.EventJSON != in.EventJSON {
		t.Fatalf("acked original lost %#v %v", r, err)
	}
	if r := enqueue(t, ob, in); !r.Replayed || r.State != "acked" {
		t.Fatalf("acked original rebound: %#v", r)
	}
}
func TestRetryTransitionRollbackRetainsLastCopy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "q.sqlite")
	ob := openOutbox(t, path)
	in := input(t, "E")
	enqueue(t, ob, in)
	db := openDatabase(t, path)
	if _, err := db.Exec("CREATE TRIGGER reject_dead BEFORE UPDATE ON events WHEN NEW.state='dead_letter' BEGIN SELECT RAISE(ABORT,'injected transition failure');END"); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := ob.Retry(ctx, "E", 1, 0, outbox.Failure{Code: "offline", Retryable: true}); err == nil {
		t.Fatal("failed transition claimed success")
	}
	r, err := ob.Get(ctx, "E")
	if err != nil || r.State != "pending" || r.Revision != 1 || r.EventJSON != in.EventJSON {
		t.Fatalf("rollback lost original: %#v %v", r, err)
	}
	if _, err = db.Exec("DROP TRIGGER reject_dead"); err != nil {
		t.Fatal(err)
	}
	if _, err = ob.Retry(ctx, "E", 1, 0, outbox.Failure{Code: "offline", Retryable: true}); err != nil {
		t.Fatal(err)
	}
	_ = ob.Close()
	ob = openOutbox(t, path)
	r, err = ob.Get(ctx, "E")
	if err != nil || r.State != "dead_letter" || r.Digest != in.Digest {
		t.Fatalf("dead original not durable: %#v %v", r, err)
	}
}
func TestCancellationAndStaleCASDoNotMutate(t *testing.T) {
	ob := openOutbox(t, filepath.Join(t.TempDir(), "q.sqlite"))
	in := input(t, "E")
	enqueue(t, ob, in)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ob.Retry(ctx, "E", 1, 0, outbox.Failure{Code: "cancelled", Retryable: true}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel=%v", err)
	}
	bound, err := ob.Bind(context.Background(), "E", 1, scope())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ob.Retry(context.Background(), "E", 1, 0, outbox.Failure{Code: "stale", Retryable: true}); outbox.ErrorCode(err) != "revision_conflict" {
		t.Fatalf("stale=%v", err)
	}
	other := scope()
	other.ProducerID = "other"
	if _, err = ob.Bind(context.Background(), "E", bound.Revision, other); outbox.ErrorCode(err) != "scope_mismatch" {
		t.Fatalf("rebind=%v", err)
	}
	r, _ := ob.Get(context.Background(), "E")
	if r.Attempts != 0 || r.State != "pending" {
		t.Fatalf("cancel/stale changed state: %#v", r)
	}
}
func TestRequeuePreservesOriginalAndOldRequestResult(t *testing.T) {
	ob := openOutbox(t, filepath.Join(t.TempDir(), "q.sqlite"))
	in := input(t, "E")
	enqueue(t, ob, in)
	dead, err := ob.Retry(context.Background(), "E", 1, 0, outbox.Failure{Code: "offline", Retryable: true})
	if err != nil {
		t.Fatal(err)
	}
	request := outbox.RequeueInput{ID: "E", ExpectedRevision: dead.Revision, Reason: "operator\n说明", IdempotencyKey: "key"}
	first, err := ob.Requeue(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	bound, err := ob.Bind(context.Background(), "E", first.Revision, scope())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ob.Ack(context.Background(), "E", bound.Revision, receipt(in)); err != nil {
		t.Fatal(err)
	}
	again, err := ob.Requeue(context.Background(), request)
	if err != nil || !again.Replayed || again.Revision != first.Revision || again.State != "pending" {
		t.Fatalf("old request changed result: %#v %v", again, err)
	}
	request.Reason = "changed"
	if _, err = ob.Requeue(context.Background(), request); outbox.ErrorCode(err) != "idempotency_conflict" {
		t.Fatalf("changed key=%v", err)
	}
	r, _ := ob.Get(context.Background(), "E")
	if r.State != "acked" || r.EventJSON != in.EventJSON {
		t.Fatal("requeue changed original/terminal state")
	}
}
func TestMetadataPagesBindQueueGenerationAndExcludePayload(t *testing.T) {
	ob := openOutbox(t, filepath.Join(t.TempDir(), "q.sqlite"))
	enqueue(t, ob, input(t, "A"))
	enqueue(t, ob, input(t, "B"))
	page, err := ob.List(context.Background(), outbox.ListInput{Limit: 1})
	if err != nil || len(page.Items) != 1 || !page.HasMore || page.Total != 2 {
		t.Fatalf("page=%#v %v", page, err)
	}
	if _, exists := page.Items[0]["event_json"]; exists {
		t.Fatal("metadata returned original payload")
	}
	other := openOutbox(t, filepath.Join(t.TempDir(), "other.sqlite"))
	if _, err = other.List(context.Background(), outbox.ListInput{Limit: 1, Cursor: *page.NextCursor}); outbox.ErrorCode(err) != "cursor_invalid" {
		t.Fatalf("cross queue=%v", err)
	}
	enqueue(t, ob, input(t, "C"))
	if _, err = ob.List(context.Background(), outbox.ListInput{Limit: 1, Cursor: *page.NextCursor}); outbox.ErrorCode(err) != "cursor_stale" {
		t.Fatalf("stale=%v", err)
	}
}
func TestExplicitLegacyMigrationPreservesBytesAndQuarantinesIncomplete(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.sqlite")
	db := openDatabase(t, path)
	_, err := db.Exec("CREATE TABLE events(id TEXT PRIMARY KEY,type TEXT NOT NULL,subject TEXT,payload TEXT NOT NULL,retries INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);INSERT INTO events VALUES('old','sop.audit','','{\"id\":\"old\"}',2,3,4)")
	if err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	result, err := outbox.MigrateLegacy(context.Background(), path, "P")
	if err != nil || result.Migrated != 1 || result.DeadLetter != 1 {
		t.Fatalf("migration=%#v %v", result, err)
	}
	ob := openOutbox(t, path)
	r, err := ob.Get(context.Background(), "old")
	if err != nil || r.EventJSON != "{\"id\":\"old\"}" || r.Attempts != 2 || r.NextAtMS != 3000 || r.CreatedAtMS != 4000 || r.State != "dead_letter" || r.BindingState != "unbound" {
		t.Fatalf("legacy changed %#v %v", r, err)
	}
}
func TestFrozenStrictParsing(t *testing.T) {
	in := input(t, "E")
	bad := []string{`{"id":"E","id":"other"}`, `{"id":"\ud800"}`, `{"id":"E","data":{"number":1e999}}`, "\ufeff" + in.EventJSON}
	for _, raw := range bad {
		candidate := in
		candidate.EventJSON = raw
		candidate.Digest = outbox.Digest(raw)
		if _, err := outbox.ValidateFrozen(candidate); err == nil {
			t.Fatalf("invalid accepted: %q", raw)
		}
	}
	if _, err := outbox.ValidateFrozen(in); err != nil {
		t.Fatal(err)
	}
}
func TestAbruptExitRetainsFrozenEvent(t *testing.T) {
	const key = "SOP_QUEUE_CRASH_PATH"
	if path := os.Getenv(key); path != "" {
		ob, err := outbox.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = ob.Enqueue(context.Background(), input(t, "before-exit")); err != nil {
			t.Fatal(err)
		}
		os.Exit(0)
	}
	path := filepath.Join(t.TempDir(), "q.sqlite")
	cmd := exec.Command(os.Args[0], "-test.run=^TestAbruptExitRetainsFrozenEvent$")
	cmd.Env = append(os.Environ(), key+"="+path)
	if raw, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("child=%v %s", err, raw)
	}
	ob := openOutbox(t, path)
	r, err := ob.Get(context.Background(), "before-exit")
	if err != nil || r.State != "pending" {
		t.Fatalf("abrupt exit lost event: %#v %v", r, err)
	}
	var integrity string
	if err = openDatabase(t, path).QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		t.Fatalf("integrity=%s %v", integrity, err)
	}
}
func TestRequeueFingerprintSharedVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/queue_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Vectors []struct {
			ID               string `json:"id"`
			ExpectedRevision int64  `json:"expected_revision"`
			Reason           string `json:"reason"`
			SHA256           string `json:"sha256"`
		} `json:"vectors"`
	}
	if err = json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	for _, v := range data.Vectors {
		got := outbox.RequeueFingerprint(outbox.RequeueInput{ID: v.ID, ExpectedRevision: v.ExpectedRevision, Reason: v.Reason})
		if got != v.SHA256 {
			t.Fatalf("vector %q got%s want%s", v.ID, got, v.SHA256)
		}
	}
}
func TestRetryBackoffCapsAndWALReaderDoesNotLoseAppend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "q.sqlite")
	ob := openOutbox(t, path)
	in := input(t, "E")
	enqueue(t, ob, in)
	db := openDatabase(t, path)
	if _, err := db.Exec("UPDATE events SET attempts=63 WHERE id='E'"); err != nil {
		t.Fatal(err)
	}
	before := time.Now().UnixMilli()
	if _, err := ob.Retry(context.Background(), "E", 1, 100, outbox.Failure{Code: "offline", Retryable: true}); err != nil {
		t.Fatal(err)
	}
	r, _ := ob.Get(context.Background(), "E")
	if r.NextAtMS < before+300000 || r.NextAtMS > time.Now().UnixMilli()+300000 {
		t.Fatal("retry cap overflow")
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var count int
	_ = tx.QueryRow("SELECT count(*) FROM events").Scan(&count)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err = ob.Enqueue(ctx, input(t, "other")); err != nil {
		t.Fatalf("reader blocked append: %v", err)
	}
}

func TestFullEnvelopeRejectsNullStringFields(t *testing.T) {
	in := input(t, "E")
	in.EventJSON = strings.Replace(in.EventJSON, `"source":"sop-agentd"`, `"source":null`, 1)
	in.Digest = outbox.Digest(in.EventJSON)
	if _, err := outbox.ValidateFrozen(in); err == nil {
		t.Fatal("full envelope accepted null source instead of required string")
	}
}
func TestIgnoredSQLUpdateCannotClaimAck(t *testing.T) {
	path := filepath.Join(t.TempDir(), "q.sqlite")
	ob := openOutbox(t, path)
	in := input(t, "E")
	enqueue(t, ob, in)
	bound, err := ob.Bind(context.Background(), "E", 1, scope())
	if err != nil {
		t.Fatal(err)
	}
	db := openDatabase(t, path)
	if _, err = db.Exec("CREATE TRIGGER ignore_ack BEFORE UPDATE ON events WHEN NEW.state='acked' BEGIN SELECT RAISE(IGNORE);END"); err != nil {
		t.Fatal(err)
	}
	if _, err = ob.Ack(context.Background(), "E", bound.Revision, receipt(in)); err == nil {
		t.Fatal("ignored CAS update claimed successful ACK")
	}
	r, _ := ob.Get(context.Background(), "E")
	if r.State != "pending" {
		t.Fatal("failed ACK lost pending original")
	}
}

func TestTimestampGrammarMatchesSharedPythonContract(t *testing.T) {
	for _, tc := range []struct {
		value string
		valid bool
	}{{"2026-10-18t00:00:00z", true}, {"2026-10-18T00:00:00,1Z", false}, {"2026-10-18T00:00:00+24:00", false}, {"0000-10-18T00:00:00Z", false}} {
		t.Run(tc.value, func(t *testing.T) {
			e := outbox.NewEvent("sop.fact", "", nil)
			e.ID = "E"
			e.Time = tc.value
			raw, _ := json.Marshal(e)
			_, err := outbox.ValidateFrozen(outbox.EnqueueInput{ID: e.ID, EventJSON: string(raw), Digest: outbox.Digest(string(raw)), IntendedProjectID: "P"})
			if (err == nil) != tc.valid {
				t.Fatalf("timestamp acceptance=%v want%v: %v", err == nil, tc.valid, err)
			}
		})
	}
}

func TestUnknownEmptySchemaIsReadOnlyRejected(t *testing.T) {
	for _, schema := range []string{"CREATE TABLE events(custom_user_column TEXT)", "CREATE TABLE owned_user_data(value TEXT)"} {
		t.Run(schema, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "unknown.sqlite")
			db := openDatabase(t, path)
			if _, err := db.Exec(schema); err != nil {
				t.Fatal(err)
			}
			_ = db.Close()
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			ob, err := outbox.Open(path)
			if ob != nil {
				_ = ob.Close()
			}
			if err == nil || outbox.ErrorCode(err) != "migration_required" {
				t.Fatalf("unknown schema was overwritten/opened: %v", err)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("rejected unknown schema database bytes changed")
			}
		})
	}
}

func TestIgnoredSQLInsertCannotClaimDurability(t *testing.T) {
	for _, operation := range []string{"enqueue", "requeue"} {
		t.Run(operation, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "q.sqlite")
			ob := openOutbox(t, path)
			db := openDatabase(t, path)
			in := input(t, "E")
			if operation == "enqueue" {
				if _, err := db.Exec("CREATE TRIGGER ignore_enqueue BEFORE INSERT ON events BEGIN SELECT RAISE(IGNORE);END"); err != nil {
					t.Fatal(err)
				}
				if _, err := ob.Enqueue(context.Background(), in); err == nil {
					t.Fatal("ignored INSERT claimed durable enqueue")
				}
				stats, err := ob.Stats(context.Background())
				if err != nil || stats.Generation != 0 {
					t.Fatalf("failed enqueue mutated generation: %#v %v", stats, err)
				}
			} else {
				enqueue(t, ob, in)
				dead, err := ob.Retry(context.Background(), in.ID, 1, 0, outbox.Failure{Code: "offline", Retryable: true})
				if err != nil {
					t.Fatal(err)
				}
				before, _ := ob.Stats(context.Background())
				if _, err = db.Exec("CREATE TRIGGER ignore_receipt BEFORE INSERT ON queue_receipts BEGIN SELECT RAISE(IGNORE);END"); err != nil {
					t.Fatal(err)
				}
				if _, err = ob.Requeue(context.Background(), outbox.RequeueInput{ID: in.ID, ExpectedRevision: dead.Revision, Reason: "restore", IdempotencyKey: "key"}); err == nil {
					t.Fatal("ignored receipt INSERT claimed durable idempotent requeue")
				}
				row, _ := ob.Get(context.Background(), in.ID)
				after, _ := ob.Stats(context.Background())
				if row.State != "dead_letter" || row.Revision != dead.Revision || before.Generation != after.Generation {
					t.Fatal("failed receipt insert committed event mutation")
				}
			}
		})
	}
}

func TestExplicitMigrationRejectsUnknownOrMissingDatabaseWithoutChangingBytes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "unknown.sqlite")
	db := openDatabase(t, path)
	if _, err := db.Exec("CREATE TABLE events(user_payload TEXT)"); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	before, _ := os.ReadFile(path)
	if _, err := outbox.MigrateLegacy(context.Background(), path, "P"); outbox.ErrorCode(err) != "migration_required" {
		t.Fatalf("unknown migration allowed: %v", err)
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("rejected migration changed unknown database bytes")
	}
	missing := filepath.Join(t.TempDir(), "missing.sqlite")
	if _, err := outbox.MigrateLegacy(context.Background(), missing, "P"); outbox.ErrorCode(err) != "migration_required" {
		t.Fatalf("missing legacy input: %v", err)
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatal("missing migration input became a new database")
	}
}
