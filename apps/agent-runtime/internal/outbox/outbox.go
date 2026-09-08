//go:build cgo

// Package outbox 实现"幂等 + 持久化 + DLQ"事件投递。
// 存储用 SQLite WAL；事件用 ULID 做幂等键；失败入 DLQ。
package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3" // sqlite3 driver
	"github.com/oklog/ulid/v2"
)

// Event 是 outbox 中的最小信息单元（CloudEvents 子集）。
type Event struct {
	ID      string         `json:"id"`
	Type    string         `json:"type"`
	Subject string         `json:"subject,omitempty"`
	Time    time.Time      `json:"time"`
	Data    map[string]any `json:"data,omitempty"`
}

type Outbox struct {
	db   *sql.DB
	path string
}

func Open(path string) (*Outbox, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite3", path+"?_journal=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS events (
			id          TEXT PRIMARY KEY,
			type        TEXT NOT NULL,
			subject     TEXT,
			payload     TEXT NOT NULL,
			retries     INTEGER NOT NULL DEFAULT 0,
			next_at     INTEGER NOT NULL DEFAULT 0,
			created_at  INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS ix_events_next ON events(next_at);
	`); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Outbox{db: db, path: path}, nil
}

func (o *Outbox) Close() error { return o.db.Close() }

// NewEvent 生成一个 ULID 作为幂等键。
func NewEvent(eventType, subject string, data map[string]any) Event {
	return Event{
		ID:      ulid.Make().String(),
		Type:    eventType,
		Subject: subject,
		Time:    time.Now().UTC(),
		Data:    data,
	}
}

func (o *Outbox) Append(ctx context.Context, e Event) error {
	payload, err := json.Marshal(e)
	if err != nil {
		return err
	}
	_, err = o.db.ExecContext(ctx, `
		INSERT INTO events(id,type,subject,payload,retries,next_at,created_at)
		VALUES(?,?,?,?,0,?,?)
		ON CONFLICT(id) DO NOTHING
	`, e.ID, e.Type, e.Subject, string(payload), time.Now().Unix(), time.Now().Unix())
	return err
}

// PendingBatch 获取下一批可发送事件（按 next_at 排序）。
func (o *Outbox) PendingBatch(ctx context.Context, limit int) ([]Event, error) {
	rows, err := o.db.QueryContext(ctx, `
		SELECT id,type,subject,payload FROM events
		WHERE next_at <= ?
		ORDER BY next_at ASC, created_at ASC
		LIMIT ?
	`, time.Now().Unix(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Event, 0, limit)
	for rows.Next() {
		var id, t, subject, payload string
		if err := rows.Scan(&id, &t, &subject, &payload); err != nil {
			return nil, err
		}
		var e Event
		if err := json.Unmarshal([]byte(payload), &e); err != nil {
			continue
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (o *Outbox) Ack(ctx context.Context, id string) error {
	_, err := o.db.ExecContext(ctx, `DELETE FROM events WHERE id=?`, id)
	return err
}

// Retry 增加重试计数，按指数退避更新 next_at；超过 maxRetries 则进 DLQ（这里删除并由调用方处理）。
func (o *Outbox) Retry(ctx context.Context, id string, maxRetries int) (bool, error) {
	var retries int
	if err := o.db.QueryRowContext(ctx, `SELECT retries FROM events WHERE id=?`, id).Scan(&retries); err != nil {
		return false, err
	}
	retries++
	if retries > maxRetries {
		_, _ = o.db.ExecContext(ctx, `DELETE FROM events WHERE id=?`, id)
		return true, nil
	}
	delay := time.Duration(1<<retries) * time.Second
	if delay > 5*time.Minute {
		delay = 5 * time.Minute
	}
	_, err := o.db.ExecContext(ctx, `UPDATE events SET retries=?, next_at=? WHERE id=?`,
		retries, time.Now().Add(delay).Unix(), id)
	return false, err
}

// Depth 当前积压事件数（用于心跳上报）。
func (o *Outbox) Depth(ctx context.Context) (int, error) {
	var n int
	err := o.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM events`).Scan(&n)
	return n, err
}

// AppendDLQ 把不可投递事件落盘到 DLQ 目录（JSONL）。
func AppendDLQ(dir string, e Event) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(dir, fmt.Sprintf("%s.jsonl", time.Now().UTC().Format("2006-01"))),
		os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	b, _ := json.Marshal(e)
	_, err = f.Write(append(b, '\n'))
	return err
}
