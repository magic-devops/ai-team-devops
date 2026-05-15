// Package pusher 将本地待推送变更通过 POST /api/v1/sync/push 上送 Manager。
package pusher

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"go.uber.org/zap"

	httpx "github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/transport/http"
)

// PushItem 与 Manager SyncPushIn 对齐。
type PushItem struct {
	Module         string                 `json:"module"`
	Action         string                 `json:"action"`
	Record         map[string]interface{} `json:"record"`
	IdempotencyKey string                 `json:"idempotency_key,omitempty"`
}

// Result 单次 flush 摘要。
type Result struct {
	Sent   int `json:"sent"`
	Failed int `json:"failed"`
}

// Pusher 读取 push_queue.jsonl 并上送。
type Pusher struct {
	log  *zap.Logger
	http *httpx.Client
	path string
}

func New(log *zap.Logger, http *httpx.Client, projectPath string) *Pusher {
	return &Pusher{
		log:  log,
		http: http,
		path: filepath.Join(projectPath, ".sop-runtime", "sync", "push_queue.jsonl"),
	}
}

// Enqueue 追加一条待推送记录（离线安全）。
func (p *Pusher) Enqueue(item PushItem) error {
	if err := os.MkdirAll(filepath.Dir(p.path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(p.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	b, err := json.Marshal(item)
	if err != nil {
		return err
	}
	_, err = f.Write(append(b, '\n'))
	return err
}

// FlushOnce 发送队列中全部条目；成功则从队列移除。
func (p *Pusher) FlushOnce(ctx context.Context) (*Result, error) {
	raw, err := os.ReadFile(p.path)
	if err != nil {
		if os.IsNotExist(err) {
			return &Result{}, nil
		}
		return nil, err
	}
	lines := splitLines(raw)
	var items []PushItem
	for _, line := range lines {
		if len(line) == 0 {
			continue
		}
		var it PushItem
		if err := json.Unmarshal(line, &it); err != nil {
			p.log.Warn("push queue bad line", zap.Error(err))
			continue
		}
		items = append(items, it)
	}
	if len(items) == 0 {
		return &Result{}, nil
	}

	res := &Result{}
	var pending []PushItem
	for _, it := range items {
		body := map[string]any{
			"module": it.Module,
			"action": it.Action,
			"record": it.Record,
		}
		if it.IdempotencyKey != "" {
			body["idempotency_key"] = it.IdempotencyKey
		}
		if it.Action == "" {
			it.Action = "upsert"
			body["action"] = "upsert"
		}
		if err := p.http.Do(ctx, "POST", "/api/v1/sync/push", body, nil); err != nil {
			p.log.Warn("sync push fail", zap.String("module", it.Module), zap.Error(err))
			res.Failed++
			pending = append(pending, it)
			continue
		}
		res.Sent++
	}
	if err := p.rewriteQueue(pending); err != nil {
		return res, err
	}
	if res.Sent > 0 {
		p.log.Info("sync push flush", zap.Int("sent", res.Sent), zap.Int("failed", res.Failed))
	}
	return res, nil
}

func (p *Pusher) rewriteQueue(items []PushItem) error {
	if len(items) == 0 {
		_ = os.Remove(p.path)
		return nil
	}
	b := []byte{}
	for _, it := range items {
		line, err := json.Marshal(it)
		if err != nil {
			return err
		}
		b = append(b, line...)
		b = append(b, '\n')
	}
	return os.WriteFile(p.path, b, 0o644)
}

func splitLines(raw []byte) [][]byte {
	var out [][]byte
	start := 0
	for i, c := range raw {
		if c == '\n' {
			out = append(out, raw[start:i])
			start = i + 1
		}
	}
	if start < len(raw) {
		out = append(out, raw[start:])
	}
	return out
}

// PushDirect 立即上送单条（不经队列）。
func (p *Pusher) PushDirect(ctx context.Context, item PushItem) error {
	body := map[string]any{
		"module": item.Module,
		"action": item.Action,
		"record": item.Record,
	}
	if item.Action == "" {
		body["action"] = "upsert"
	}
	if item.IdempotencyKey != "" {
		body["idempotency_key"] = item.IdempotencyKey
	}
	if err := p.http.Do(ctx, "POST", "/api/v1/sync/push", body, nil); err != nil {
		return fmt.Errorf("sync push: %w", err)
	}
	return nil
}
