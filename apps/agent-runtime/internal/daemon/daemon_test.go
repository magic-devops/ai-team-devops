package daemon

import (
	"context"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/config"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/pusher"
	httpx "github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/transport/http"
)

func TestDeliverRejectsUnsupportedEventAsRetriable(t *testing.T) {
	d := &Daemon{log: zap.NewNop()}
	err := d.deliver(context.Background(), outbox.Event{Type: "sop.unsupported"})
	if err == nil || !strings.Contains(err.Error(), "unsupported event type") {
		t.Fatalf("expected unsupported event error, got %v", err)
	}
}

func TestSyncPushPropagatesFallbackOutboxAppendError(t *testing.T) {
	project := t.TempDir()
	ob, err := outbox.Open(project + "/outbox.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	if err := ob.Close(); err != nil {
		t.Fatal(err)
	}

	cli := httpx.New("http://127.0.0.1:1", "project", "", "", time.Second, true, 0)
	d := &Daemon{
		log:    zap.NewNop(),
		cfg:    &config.Config{ProjectPath: project},
		http:   cli,
		outbox: ob,
		pusher: pusher.New(zap.NewNop(), cli, project),
	}
	resp := d.dispatchIPC(context.Background(), IPCRequest{
		V:    1,
		Op:   "sync.push",
		Data: map[string]any{"module": "tasks", "action": "upsert", "record": map[string]any{"id": "T-1"}},
	})
	if resp.OK {
		t.Fatalf("expected append error response, got %#v", resp)
	}
	if resp.Error == "" {
		t.Fatalf("expected append error detail, got %#v", resp)
	}
}
