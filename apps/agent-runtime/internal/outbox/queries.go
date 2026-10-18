package outbox

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"
)

type queueCursor struct {
	V           int    `json:"v"`
	QueueID     string `json:"queue_id"`
	Generation  int64  `json:"generation"`
	State       string `json:"state"`
	Limit       int    `json:"limit"`
	CreatedAtMS int64  `json:"created_at_ms"`
	ID          string `json:"id"`
}

func (o *Outbox) List(ctx context.Context, in ListInput) (ListResult, error) {
	out := ListResult{Items: []map[string]any{}}
	if in.State == "" {
		in.State = "all"
	}
	if in.Limit == 0 {
		in.Limit = 20
	}
	if in.Limit < 1 || in.Limit > 50 || (in.State != "all" && in.State != "pending" && in.State != "dead_letter" && in.State != "acked") {
		return out, fail("payload_invalid", "invalid queue state/limit")
	}
	if len(in.Cursor) > 4096 {
		return out, fail("cursor_invalid", "cursor too long")
	}
	tx, err := o.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = tx.QueryRowContext(ctx, "SELECT queue_id,generation FROM queue_meta WHERE singleton=1").Scan(&out.QueueID, &out.Generation); err != nil {
		return out, err
	}
	cursor := queueCursor{}
	if in.Cursor != "" {
		raw, e := base64.RawURLEncoding.DecodeString(in.Cursor)
		if e != nil || DecodeStrict(raw, &cursor) != nil || cursor.V != 1 || cursor.ID == "" || cursor.QueueID != out.QueueID || cursor.State != in.State || cursor.Limit != in.Limit {
			return out, fail("cursor_invalid", "cursor belongs to another queue/filter/limit")
		}
		if cursor.Generation != out.Generation {
			return out, fail("cursor_stale", "queue changed; restart metadata window")
		}
	}
	filter := "1=1"
	args := []any{}
	if in.State != "all" {
		filter = "state=?"
		args = append(args, in.State)
	}
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM events WHERE "+filter, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	if in.Cursor != "" {
		filter += " AND (created_at_ms>? OR (created_at_ms=? AND id>?))"
		args = append(args, cursor.CreatedAtMS, cursor.CreatedAtMS, cursor.ID)
	}
	args = append(args, in.Limit+1)
	rows, err := tx.QueryContext(ctx, "SELECT "+metadataColumns+" FROM events WHERE "+filter+" ORDER BY created_at_ms,id LIMIT ?", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	records := []Record{}
	for rows.Next() {
		r, e := scanRecord(rows)
		if e != nil {
			return out, e
		}
		records = append(records, r)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	out.Limit = in.Limit
	out.HasMore = len(records) > in.Limit
	if out.HasMore {
		records = records[:in.Limit]
	}
	for _, r := range records {
		out.Items = append(out.Items, r.Metadata())
	}
	if out.HasMore {
		last := records[len(records)-1]
		raw, _ := json.Marshal(queueCursor{1, out.QueueID, out.Generation, in.State, in.Limit, last.CreatedAtMS, last.ID})
		next := base64.RawURLEncoding.EncodeToString(raw)
		out.NextCursor = &next
	}
	return out, nil
}
func (o *Outbox) Stats(ctx context.Context) (Stats, error) {
	var out Stats
	tx, err := o.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = tx.QueryRowContext(ctx, "SELECT queue_id,generation FROM queue_meta WHERE singleton=1").Scan(&out.QueueID, &out.Generation); err != nil {
		return out, err
	}
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(sum(state='pending'),0),COALESCE(sum(state='pending' AND next_at_ms<=?),0),COALESCE(sum(state='dead_letter'),0),COALESCE(sum(state='acked'),0),min(CASE WHEN state='pending' THEN created_at_ms END),max(acked_at_ms) FROM events`, time.Now().UnixMilli()).Scan(&out.Pending, &out.Due, &out.DeadLetter, &out.Acked, &out.OldestPendingAtMS, &out.LastAckAtMS)
	if err != nil {
		return out, err
	}
	var e LastError
	err = tx.QueryRowContext(ctx, "SELECT id,last_error_code,COALESCE(last_error_message,''),COALESCE(last_error_retryable,0),last_attempt_at_ms FROM events WHERE last_error_code IS NOT NULL ORDER BY last_attempt_at_ms DESC,id DESC LIMIT 1").Scan(&e.ID, &e.Code, &e.Message, &e.Retryable, &e.AtMS)
	if err == nil {
		out.LastError = &e
	} else if err != sql.ErrNoRows {
		return out, err
	}
	return out, nil
}
func RequeueFingerprint(in RequeueInput) string {
	var b bytes.Buffer
	b.WriteString("sop-outbox-requeue-v1\x00")
	frame := func(value string) {
		var size [4]byte
		binary.BigEndian.PutUint32(size[:], uint32(len([]byte(value))))
		b.Write(size[:])
		b.WriteString(value)
	}
	frame(in.ID)
	var revision [8]byte
	binary.BigEndian.PutUint64(revision[:], uint64(in.ExpectedRevision))
	b.Write(revision[:])
	frame(in.Reason)
	sum := sha256.Sum256(b.Bytes())
	return hex.EncodeToString(sum[:])
}
func (o *Outbox) Requeue(ctx context.Context, in RequeueInput) (MutationResult, error) {
	if in.ID == "" || utf8.RuneCountInString(in.ID) > 128 || in.ExpectedRevision < 1 || strings.TrimSpace(in.Reason) == "" || utf8.RuneCountInString(in.Reason) > 2000 || in.IdempotencyKey == "" || utf8.RuneCountInString(in.IdempotencyKey) > 128 || !utf8.ValidString(in.Reason) {
		return MutationResult{}, fail("payload_invalid", "invalid exact requeue intent")
	}
	tx, err := o.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback()
	fingerprint := RequeueFingerprint(in)
	var previous, original string
	err = tx.QueryRowContext(ctx, "SELECT request_digest,result_json FROM queue_receipts WHERE operation='requeue' AND idempotency_key=?", in.IdempotencyKey).Scan(&previous, &original)
	if err == nil {
		if previous != fingerprint {
			return MutationResult{}, fail("idempotency_conflict", "requeue key belongs to another request")
		}
		var ack MutationResult
		if e := DecodeStrict([]byte(original), &ack); e != nil {
			return ack, e
		}
		ack.Replayed = true
		return ack, nil
	}
	if err != sql.ErrNoRows {
		return MutationResult{}, err
	}
	r, err := getTx(ctx, tx, in.ID)
	if err != nil {
		return MutationResult{}, err
	}
	if r.Revision != in.ExpectedRevision {
		return MutationResult{}, fail("revision_conflict", "queue revision changed")
	}
	if r.State != "dead_letter" || r.LastErrorRetryable == nil || !*r.LastErrorRetryable {
		return MutationResult{}, fail("invalid_state", "only retryable dead letters may requeue")
	}
	now := time.Now().UnixMilli()
	err = execCAS(ctx, tx, `UPDATE events SET state='pending',attempts=0,next_at_ms=?,updated_at_ms=?,last_attempt_at_ms=NULL,last_error_code=NULL,last_error_message=NULL,last_error_retryable=NULL,dead_at_ms=NULL,revision=revision+1 WHERE id=? AND state='dead_letter' AND revision=?`, now, now, in.ID, in.ExpectedRevision)
	if err != nil {
		return MutationResult{}, err
	}
	ack := MutationResult{r.ID, r.Digest, "pending", r.Revision + 1, false}
	raw, _ := json.Marshal(ack)
	request, _ := json.Marshal(struct {
		ID               string `json:"id"`
		ExpectedRevision int64  `json:"expected_revision"`
		Reason           string `json:"reason"`
	}{in.ID, in.ExpectedRevision, in.Reason})
	err = execCAS(ctx, tx, "INSERT INTO queue_receipts(operation,idempotency_key,event_id,request_json,request_digest,result_json,created_at_ms) VALUES('requeue',?,?,?,?,?,?)", in.IdempotencyKey, in.ID, string(request), fingerprint, string(raw), now)
	if err != nil {
		return MutationResult{}, err
	}
	if err = bump(ctx, tx); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return MutationResult{}, err
	}
	return ack, nil
}
