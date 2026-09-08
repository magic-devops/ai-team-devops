//go:build !cgo

package outbox

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
)

type Event struct {
	ID      string         `json:"id"`
	Type    string         `json:"type"`
	Subject string         `json:"subject,omitempty"`
	Time    time.Time      `json:"time"`
	Data    map[string]any `json:"data,omitempty"`
}

type Outbox struct {
	mu   sync.Mutex
	path string
}

func Open(path string) (*Outbox, error) {
	return nil, fmt.Errorf("outbox sqlite requires CGO: rebuild without CGO_ENABLED=0 or provide a maintained pure-Go SQLite backend; refusing to touch %q", path)
}

func (o *Outbox) Close() error { return nil }

func NewEvent(eventType, subject string, data map[string]any) Event {
	return Event{
		ID:      ulid.Make().String(),
		Type:    eventType,
		Subject: subject,
		Time:    time.Now().UTC(),
		Data:    data,
	}
}

func (o *Outbox) Append(_ context.Context, e Event) error {
	return cgoRequiredError(o.path)
}

func (o *Outbox) PendingBatch(_ context.Context, limit int) ([]Event, error) {
	return nil, cgoRequiredError(o.path)
}

func (o *Outbox) Ack(_ context.Context, id string) error {
	return cgoRequiredError(o.path)
}

func (o *Outbox) Retry(_ context.Context, id string, maxRetries int) (bool, error) {
	return false, cgoRequiredError(o.path)
}

func (o *Outbox) Depth(_ context.Context) (int, error) {
	return 0, cgoRequiredError(o.path)
}

func AppendDLQ(dir string, e Event) error {
	return cgoRequiredError(dir)
}

func cgoRequiredError(path string) error {
	return fmt.Errorf("outbox sqlite requires CGO: rebuild without CGO_ENABLED=0 or provide a maintained pure-Go SQLite backend; refusing to touch %q", path)
}
