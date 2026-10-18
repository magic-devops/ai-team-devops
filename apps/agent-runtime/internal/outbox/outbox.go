// Package outbox owns the single durable local event queue shared with the Python CLI.
package outbox

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/oklog/ulid/v2"
	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

type Outbox struct {
	db   *sql.DB
	path string
}

const columns = `id,type,subject,event_json,digest,intended_project_id,binding_state,expected_tenant_id,expected_project_id,expected_producer_id,manager_origin,state,revision,attempts,next_at_ms,created_at_ms,updated_at_ms,last_attempt_at_ms,last_error_code,last_error_message,last_error_retryable,dead_at_ms,receipt_id,receipt_outcome,remote_stored_at,processing_state,remote_receipt_json,acked_at_ms`

var metadataColumns = strings.ReplaceAll(strings.ReplaceAll(columns, "remote_receipt_json", "NULL"), "event_json", "''")

type scanner interface{ Scan(...any) error }

func scanRecord(s scanner) (Record, error) {
	var r Record
	err := s.Scan(&r.ID, &r.Type, &r.Subject, &r.EventJSON, &r.Digest, &r.IntendedProjectID, &r.BindingState, &r.ExpectedTenantID, &r.ExpectedProjectID, &r.ExpectedProducerID, &r.ManagerOrigin, &r.State, &r.Revision, &r.Attempts, &r.NextAtMS, &r.CreatedAtMS, &r.UpdatedAtMS, &r.LastAttemptAtMS, &r.LastErrorCode, &r.LastErrorMessage, &r.LastErrorRetryable, &r.DeadAtMS, &r.ReceiptID, &r.ReceiptOutcome, &r.RemoteStoredAt, &r.ProcessingState, &r.RemoteReceiptJSON, &r.AckedAtMS)
	if errors.Is(err, sql.ErrNoRows) {
		return r, fail("event_not_found", "event does not exist")
	}
	return r, err
}
func connect(path string, readOnly bool) (*sql.DB, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	uri := filepath.ToSlash(abs)
	if !strings.HasPrefix(uri, "/") {
		uri = "/" + uri
	}
	dsn := url.URL{Scheme: "file", Path: uri}
	params := url.Values{}
	if readOnly {
		params.Set("mode", "ro")
		params["_pragma"] = []string{"busy_timeout(5000)"}
	} else {
		params["_pragma"] = []string{"busy_timeout(5000)", "journal_mode(WAL)", "synchronous(FULL)", "foreign_keys(ON)"}
		params.Set("_txlock", "immediate")
	}
	dsn.RawQuery = params.Encode()
	db, err := sql.Open("sqlite", dsn.String())
	if err == nil {
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)
	}
	return db, err
}

type schemaReader interface {
	QueryRow(string, ...any) *sql.Row
	Query(string, ...any) (*sql.Rows, error)
}

func inspectSchema(db schemaReader) (version, count int, err error) {
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return
	}
	if version != 0 && version != 1 {
		return version, 0, fail("migration_required", "unsupported queue schema version")
	}
	if version == 1 {
		return
	}
	rows, e := db.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
	if e != nil {
		return 0, 0, e
	}
	tables := []string{}
	for rows.Next() {
		var name string
		if e = rows.Scan(&name); e != nil {
			break
		}
		tables = append(tables, name)
	}
	if e == nil {
		e = rows.Err()
	}
	_ = rows.Close()
	if e != nil {
		return 0, 0, e
	}
	if len(tables) == 0 {
		return
	}
	if len(tables) != 1 || tables[0] != "events" {
		return 0, 0, fail("migration_required", "unknown legacy tables")
	}
	rows, e = db.Query("PRAGMA table_info(events)")
	if e != nil {
		return 0, 0, e
	}
	expected := map[string]bool{"id": true, "type": true, "subject": true, "payload": true, "retries": true, "next_at": true, "created_at": true}
	n := 0
	for rows.Next() {
		var cid, notnull, pk int
		var name, typ string
		var defaultValue any
		if e = rows.Scan(&cid, &name, &typ, &notnull, &defaultValue, &pk); e != nil {
			break
		}
		if !expected[name] {
			e = fail("migration_required", "unknown legacy schema")
			break
		}
		n++
	}
	if e == nil {
		e = rows.Err()
	}
	_ = rows.Close()
	if e != nil {
		return 0, 0, e
	}
	if n != len(expected) {
		return 0, 0, fail("migration_required", "unknown legacy schema")
	}
	err = db.QueryRow("SELECT count(*) FROM events").Scan(&count)
	return
}
func Open(path string) (*Outbox, error) {
	version := 0
	if info, err := os.Stat(path); err == nil {
		if info.IsDir() {
			return nil, fmt.Errorf("queue path is a directory")
		}
		ro, e := connect(path, true)
		if e != nil {
			return nil, e
		}
		snapshot, e := ro.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
		if e != nil {
			_ = ro.Close()
			return nil, e
		}
		v, count, e := inspectSchema(snapshot)
		_ = snapshot.Rollback()
		_ = ro.Close()
		if e != nil {
			return nil, e
		}
		version = v
		if version == 0 && count > 0 {
			return nil, fail("migration_required", "nonempty legacy queue needs explicit intended project migration")
		}
		if version != 0 && version != 1 {
			return nil, fail("migration_required", "unsupported queue schema version")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, err
	}
	db, err := connect(path, false)
	if err != nil {
		return nil, err
	}
	if version == 0 {
		tx, e := db.BeginTx(context.Background(), nil)
		if e != nil {
			db.Close()
			return nil, e
		}
		defer tx.Rollback()
		v, count, e := inspectSchema(tx)
		if e == nil && v == 0 && count > 0 {
			e = fail("migration_required", "legacy queue became nonempty")
		}
		if e == nil && v == 0 {
			_, e = tx.Exec("DROP TABLE IF EXISTS events")
			if e == nil {
				_, e = tx.Exec(schemaSQL)
			}
			if e == nil {
				_, e = tx.Exec("PRAGMA user_version=1")
			}
		}
		if e == nil {
			e = tx.Commit()
		}
		if e != nil {
			db.Close()
			return nil, e
		}
	}
	return &Outbox{db, path}, nil
}
func (o *Outbox) Close() error { return o.db.Close() }
func NewEvent(eventType, subject string, data map[string]any) Event {
	if data == nil {
		data = map[string]any{}
	}
	return Event{"1.0", ulid.Make().String(), eventType, "sop-agentd", subject, time.Now().UTC().Format(time.RFC3339Nano), "application/json", data}
}
func Freeze(e Event, projectID string) (EnqueueInput, error) {
	raw, err := json.Marshal(e)
	if err != nil {
		return EnqueueInput{}, err
	}
	in := EnqueueInput{ID: e.ID, EventJSON: string(raw), Digest: Digest(string(raw)), IntendedProjectID: projectID}
	_, err = ValidateFrozen(in)
	return in, err
}
func (o *Outbox) Get(ctx context.Context, id string) (Record, error) {
	return scanRecord(o.db.QueryRowContext(ctx, "SELECT "+columns+" FROM events WHERE id=?", id))
}
func getTx(ctx context.Context, tx *sql.Tx, id string) (Record, error) {
	return scanRecord(tx.QueryRowContext(ctx, "SELECT "+columns+" FROM events WHERE id=?", id))
}
func execCAS(ctx context.Context, tx *sql.Tx, query string, args ...any) error {
	r, err := tx.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	n, err := r.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return fail("revision_conflict", "queue CAS did not update exactly one row")
	}
	return nil
}
func bump(ctx context.Context, tx *sql.Tx) error {
	return execCAS(ctx, tx, "UPDATE queue_meta SET generation=generation+1 WHERE singleton=1")
}
func (o *Outbox) Enqueue(ctx context.Context, in EnqueueInput) (MutationResult, error) {
	e, err := ValidateFrozen(in)
	if err != nil {
		return MutationResult{}, err
	}
	if in.Scope != nil {
		if err = in.Scope.Validate(); err != nil {
			return MutationResult{}, err
		}
		if in.Scope.ProjectID != in.IntendedProjectID {
			return MutationResult{}, fail("scope_mismatch", "verified project differs from intended project")
		}
	}
	tx, err := o.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback()
	old, err := getTx(ctx, tx, in.ID)
	if err == nil {
		if old.Digest != in.Digest || old.EventJSON != in.EventJSON || old.IntendedProjectID != in.IntendedProjectID {
			return MutationResult{}, fail("event_id_conflict", "event ID already has different original bytes/project")
		}
		if in.Scope != nil && old.Scope() != nil && *in.Scope != *old.Scope() {
			return MutationResult{}, fail("scope_mismatch", "event ID already bound to another producer")
		}
		return result(old, true), nil
	}
	if ErrorCode(err) != "event_not_found" {
		return MutationResult{}, err
	}
	now := time.Now().UnixMilli()
	binding := "unbound"
	var tid, pid, producer, origin any
	if in.Scope != nil {
		binding = "bound"
		tid = in.Scope.TenantID
		pid = in.Scope.ProjectID
		producer = in.Scope.ProducerID
		origin = in.Scope.ManagerOrigin
	}
	err = execCAS(ctx, tx, `INSERT INTO events(id,type,subject,event_json,digest,intended_project_id,binding_state,expected_tenant_id,expected_project_id,expected_producer_id,manager_origin,state,revision,attempts,next_at_ms,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',1,0,?,?,?)`, in.ID, e.Type, e.Subject, in.EventJSON, in.Digest, in.IntendedProjectID, binding, tid, pid, producer, origin, now, now, now)
	if err == nil {
		err = bump(ctx, tx)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		return MutationResult{}, err
	}
	return MutationResult{in.ID, in.Digest, "pending", 1, false}, nil
}
func (o *Outbox) PendingBatch(ctx context.Context, limit int) ([]Record, error) {
	if limit < 1 || limit > 50 {
		return nil, fail("payload_invalid", "batch limit must be1..50")
	}
	rows, err := o.db.QueryContext(ctx, "SELECT "+columns+" FROM events WHERE state='pending' AND next_at_ms<=? ORDER BY next_at_ms,created_at_ms,id LIMIT ?", time.Now().UnixMilli(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Record{}
	for rows.Next() {
		r, e := scanRecord(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func casResult(ctx context.Context, tx *sql.Tx, id string) (MutationResult, error) {
	if err := bump(ctx, tx); err != nil {
		return MutationResult{}, err
	}
	r, err := getTx(ctx, tx, id)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return MutationResult{}, err
	}
	return result(r, false), nil
}
func requirePending(r Record, revision int64) error {
	if r.Revision != revision {
		return fail("revision_conflict", "queue revision changed")
	}
	if r.State != "pending" {
		return fail("invalid_state", "event is not pending")
	}
	return nil
}
func (o *Outbox) Bind(ctx context.Context, id string, revision int64, scope Scope) (MutationResult, error) {
	if err := scope.Validate(); err != nil {
		return MutationResult{}, err
	}
	tx, err := o.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback()
	r, err := getTx(ctx, tx, id)
	if err != nil {
		return MutationResult{}, err
	}
	if scope.ProjectID != r.IntendedProjectID {
		return MutationResult{}, fail("scope_mismatch", "identity project differs from original intended project")
	}
	if r.Scope() != nil {
		if *r.Scope() != scope {
			return MutationResult{}, fail("scope_mismatch", "event already has another immutable binding")
		}
		return result(r, true), nil
	}
	if err = requirePending(r, revision); err != nil {
		return MutationResult{}, err
	}
	err = execCAS(ctx, tx, `UPDATE events SET binding_state='bound',expected_tenant_id=?,expected_project_id=?,expected_producer_id=?,manager_origin=?,revision=revision+1,updated_at_ms=? WHERE id=? AND revision=? AND state='pending'`, scope.TenantID, scope.ProjectID, scope.ProducerID, scope.ManagerOrigin, time.Now().UnixMilli(), id, revision)
	if err != nil {
		return MutationResult{}, err
	}
	return casResult(ctx, tx, id)
}
func bounded(value string, limit int) string {
	r := []rune(value)
	if len(r) > limit {
		return string(r[:limit])
	}
	return value
}
func (o *Outbox) Retry(ctx context.Context, id string, revision int64, maxRetries int, f Failure) (MutationResult, error) {
	tx, err := o.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback()
	r, err := getTx(ctx, tx, id)
	if err != nil {
		return MutationResult{}, err
	}
	if err = requirePending(r, revision); err != nil {
		return MutationResult{}, err
	}
	now := time.Now().UnixMilli()
	state := "pending"
	var dead any
	delay := int64(300000)
	if r.Attempts < 8 {
		delay = int64(1) << (r.Attempts + 1)
		delay *= 1000
	}
	if !f.Retryable || r.Attempts >= int64(maxRetries) {
		state = "dead_letter"
		dead = now
	}
	err = execCAS(ctx, tx, `UPDATE events SET state=?,attempts=attempts+1,next_at_ms=?,updated_at_ms=?,last_attempt_at_ms=?,last_error_code=?,last_error_message=?,last_error_retryable=?,dead_at_ms=?,revision=revision+1 WHERE id=? AND state='pending' AND revision=?`, state, now+delay, now, now, bounded(f.Code, 128), bounded(f.Message, 1000), f.Retryable, dead, id, revision)
	if err != nil {
		return MutationResult{}, err
	}
	return casResult(ctx, tx, id)
}
func (o *Outbox) Ack(ctx context.Context, id string, revision int64, receipt RemoteReceipt) (MutationResult, error) {
	tx, err := o.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback()
	r, err := getTx(ctx, tx, id)
	if err != nil {
		return MutationResult{}, err
	}
	if err = receipt.Validate(r.ID, r.Digest); err != nil {
		return MutationResult{}, err
	}
	if r.State == "acked" {
		if r.ReceiptID == nil || *r.ReceiptID != *receipt.ReceiptID {
			return MutationResult{}, fail("receipt_invalid", "different receipt for acknowledged event")
		}
		return result(r, true), nil
	}
	if err = requirePending(r, revision); err != nil {
		return MutationResult{}, err
	}
	if r.Scope() == nil {
		return MutationResult{}, fail("scope_mismatch", "unbound event cannot be acknowledged")
	}
	raw, err := json.Marshal(receipt)
	if err != nil {
		return MutationResult{}, err
	}
	now := time.Now().UnixMilli()
	err = execCAS(ctx, tx, `UPDATE events SET state='acked',receipt_id=?,receipt_outcome=?,remote_stored_at=?,processing_state=?,remote_receipt_json=?,acked_at_ms=?,updated_at_ms=?,revision=revision+1 WHERE id=? AND state='pending' AND revision=?`, *receipt.ReceiptID, receipt.Outcome, *receipt.StoredAt, receipt.Processing.State, string(raw), now, now, id, revision)
	if err != nil {
		return MutationResult{}, err
	}
	return casResult(ctx, tx, id)
}
func (o *Outbox) Depth(ctx context.Context) (int, error) {
	var n int
	err := o.db.QueryRowContext(ctx, "SELECT count(*) FROM events WHERE state='pending'").Scan(&n)
	return n, err
}

func MigrateLegacy(ctx context.Context, path, intendedProjectID string) (MigrationResult, error) {
	var out MigrationResult
	if intendedProjectID == "" || utf8.RuneCountInString(intendedProjectID) > 64 {
		return out, fail("scope_mismatch", "operator must supply original intended project")
	}
	if _, err := os.Stat(path); err != nil {
		return out, fail("migration_required", "legacy database does not exist")
	}
	ro, err := connect(path, true)
	if err != nil {
		return out, err
	}
	snapshot, err := ro.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		_ = ro.Close()
		return out, err
	}
	version, _, err := inspectSchema(snapshot)
	var exists int
	if err == nil {
		err = snapshot.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='events'").Scan(&exists)
	}
	_ = snapshot.Rollback()
	_ = ro.Close()
	if err != nil {
		return out, err
	}
	if version != 0 || exists != 1 {
		return out, fail("migration_required", "explicit migration requires a known legacy queue")
	}
	db, err := connect(path, false)
	if err != nil {
		return out, err
	}
	defer db.Close()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	v, _, err := inspectSchema(tx)
	if err != nil {
		return out, err
	}
	if v != 0 {
		return out, fail("migration_required", "unsupported legacy schema")
	}
	if _, err = tx.ExecContext(ctx, "ALTER TABLE events RENAME TO legacy_events"); err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, schemaSQL); err != nil {
		return out, err
	}
	type legacy struct {
		id, typ, subject, payload string
		retries, next, created    int64
	}
	last := int64(math.MinInt64)
	first := true
	for {
		operator := ">"
		if first {
			operator = ">="
		}
		rows, e := tx.QueryContext(ctx, "SELECT rowid,id,type,COALESCE(subject,''),payload,retries,next_at,created_at FROM legacy_events WHERE rowid"+operator+"? ORDER BY rowid LIMIT 256", last)
		if e != nil {
			return out, e
		}
		batch := []legacy{}
		for rows.Next() {
			var row legacy
			if e = rows.Scan(&last, &row.id, &row.typ, &row.subject, &row.payload, &row.retries, &row.next, &row.created); e != nil {
				rows.Close()
				return out, e
			}
			batch = append(batch, row)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return out, e
		}
		if len(batch) == 0 {
			break
		}
		first = false
		for _, old := range batch {
			if old.next > math.MaxInt64/1000 || old.next < math.MinInt64/1000 || old.created > math.MaxInt64/1000 || old.created < math.MinInt64/1000 {
				return out, fail("migration_required", "legacy timestamp overflows milliseconds")
			}
			in := EnqueueInput{ID: old.id, EventJSON: old.payload, Digest: Digest(old.payload), IntendedProjectID: intendedProjectID}
			ev, e := ValidateFrozen(in)
			state := "pending"
			var code, message, retryable, dead any
			if e != nil || ev.Type != old.typ || ev.Subject != old.subject {
				state = "dead_letter"
				code = "legacy_event_invalid"
				message = "Original legacy envelope is invalid/incomplete; inspect original bytes"
				retryable = false
				dead = time.Now().UnixMilli()
				out.DeadLetter++
			}
			e = execCAS(ctx, tx, `INSERT INTO events(id,type,subject,event_json,digest,intended_project_id,binding_state,state,revision,attempts,next_at_ms,created_at_ms,updated_at_ms,last_error_code,last_error_message,last_error_retryable,dead_at_ms) VALUES(?,?,?,?,?,?,'unbound',?,1,?,?,?,?,?,?,?,?)`, old.id, old.typ, old.subject, old.payload, in.Digest, intendedProjectID, state, old.retries, old.next*1000, old.created*1000, time.Now().UnixMilli(), code, message, retryable, dead)
			if e != nil {
				return out, e
			}
			out.Migrated++
		}
	}
	if _, err = tx.ExecContext(ctx, "DROP TABLE legacy_events; PRAGMA user_version=1"); err != nil {
		return out, err
	}
	if err = bump(ctx, tx); err != nil {
		return out, err
	}
	err = tx.Commit()
	return out, err
}
