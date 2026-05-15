// Package daemon 是 sop-agentd 的主循环装配点。
// 子模块：reporter / puller / watcher / outbox sender / ipc / mcp / a2a。
package daemon

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/oklog/ulid/v2"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/config"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/puller"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/pusher"
	httpx "github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/transport/http"
)

type Daemon struct {
	log     *zap.Logger
	cfg     *config.Config
	http    *httpx.Client
	outbox  *outbox.Outbox
	puller  *puller.Puller
	pusher  *pusher.Pusher
	agentID string
	version string
}

func New(log *zap.Logger, cfg *config.Config, version string) (*Daemon, error) {
	if err := writePID(cfg.PIDFile); err != nil {
		return nil, fmt.Errorf("write pid: %w", err)
	}
	ob, err := outbox.Open(filepath.Join(cfg.ProjectPath, cfg.Reliability.OutboxPath))
	if err != nil {
		return nil, fmt.Errorf("open outbox: %w", err)
	}
	cli := httpx.New(
		cfg.Manager.URL, cfg.Manager.ProjectID, cfg.Auth.Bearer, cfg.Auth.APIKey,
		time.Duration(cfg.Reliability.TimeoutSeconds)*time.Second,
		cfg.Auth.VerifySSL, cfg.Reliability.MaxRetries,
	)
	pl := puller.New(log, cli, cfg.ProjectPath)
	pu := pusher.New(log, cli, cfg.ProjectPath)
	return &Daemon{
		log: log, cfg: cfg, http: cli, outbox: ob, puller: pl, pusher: pu,
		agentID: ulid.Make().String(), version: version,
	}, nil
}

func (d *Daemon) Run(ctx context.Context) error {
	d.log.Info("sop-agentd starting",
		zap.String("version", d.version),
		zap.String("project_path", d.cfg.ProjectPath),
		zap.String("manager", d.cfg.Manager.URL),
		zap.String("project_id", d.cfg.Manager.ProjectID),
	)

	g, ctx := errgroup.WithContext(ctx)
	g.Go(func() error { return d.serveIPC(ctx) })
	g.Go(func() error { return d.heartbeatLoop(ctx) })
	g.Go(func() error { return d.outboxSenderLoop(ctx) })
	g.Go(func() error { return d.pullerLoop(ctx) })
	g.Go(func() error { return d.pusherLoop(ctx) })
	// 后续：g.Go(d.watcherLoop) / d.wsLoop / d.mcpHub / d.a2aNode

	defer d.shutdown()
	if err := g.Wait(); err != nil && ctx.Err() == nil {
		d.log.Error("daemon error", zap.Error(err))
		return err
	}
	return nil
}

func (d *Daemon) shutdown() {
	d.log.Info("sop-agentd stopping")
	_ = d.outbox.Close()
	_ = os.Remove(d.cfg.PIDFile)
}

func (d *Daemon) heartbeatLoop(ctx context.Context) error {
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	hb := func() {
		depth, _ := d.outbox.Depth(ctx)
		payload := map[string]any{
			"agent_id":   d.agentID,
			"project_id": d.cfg.Manager.ProjectID,
			"tenant_id":  d.cfg.Manager.TenantID,
			"version":    d.version,
			"hostname":   hostname(),
			"os":         runtime.GOOS,
			"arch":       runtime.GOARCH,
			"telemetry":  map[string]any{"outbox_depth": depth},
		}
		// M9 完成后改成 /api/v1/agents/heartbeat；当前先用通用事件接口（写入 outbox 由 sender 推送）
		_ = d.outbox.Append(ctx, outbox.NewEvent("sop.agent.heartbeat", d.agentID, payload))
	}
	hb()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
			hb()
		}
	}
}

func (d *Daemon) outboxSenderLoop(ctx context.Context) error {
	tick := time.NewTicker(1 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
			d.flushOutboxOnce(ctx)
		}
	}
}

// pullerLoop 定时从 Manager 拉取结构化变更（默认 5 分钟；需 project_id + bearer/apikey）。
func (d *Daemon) pullerLoop(ctx context.Context) error {
	if d.cfg.Manager.ProjectID == "" {
		d.log.Info("sync puller idle: project_id 未配置（sop login --pair）")
		return nil
	}
	tick := time.NewTicker(5 * time.Minute)
	defer tick.Stop()
	d.runPullOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
			d.runPullOnce(ctx)
		}
	}
}

func (d *Daemon) runPullOnce(ctx context.Context) {
	if d.puller == nil {
		return
	}
	res, err := d.puller.PullOnce(ctx, "")
	if err != nil {
		d.log.Warn("sync pull", zap.Error(err))
		return
	}
	d.log.Debug("sync pull ok", zap.Int("total", res.Total), zap.String("cursor", res.Cursor))
}

// pusherLoop 定时 flush push_queue.jsonl（默认 30 秒）。
func (d *Daemon) pusherLoop(ctx context.Context) error {
	if d.cfg.Manager.ProjectID == "" {
		return nil
	}
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
			d.runPushOnce(ctx)
		}
	}
}

func (d *Daemon) runPushOnce(ctx context.Context) {
	if d.pusher == nil {
		return
	}
	if _, err := d.pusher.FlushOnce(ctx); err != nil {
		d.log.Warn("sync push flush", zap.Error(err))
	}
}

func (d *Daemon) runSyncCycle(ctx context.Context, modules string) (map[string]any, error) {
	out := map[string]any{}
	if d.puller != nil {
		res, err := d.puller.PullOnce(ctx, modules)
		if err != nil {
			return nil, err
		}
		out["pull_total"] = res.Total
		out["cursor"] = res.Cursor
		out["snapshot_path"] = res.SnapshotPath
		out["merged"] = res.Merged
	}
	if d.pusher != nil {
		pr, err := d.pusher.FlushOnce(ctx)
		if err != nil {
			return out, err
		}
		out["push_sent"] = pr.Sent
		out["push_failed"] = pr.Failed
	}
	d.flushOutboxOnce(ctx)
	return out, nil
}

func (d *Daemon) flushOutboxOnce(ctx context.Context) {
	batch, err := d.outbox.PendingBatch(ctx, d.cfg.Reliability.BatchSize)
	if err != nil {
		d.log.Warn("outbox pending", zap.Error(err))
		return
	}
	if len(batch) == 0 {
		return
	}
	for _, e := range batch {
		err := d.deliver(ctx, e)
		if err != nil {
			d.log.Warn("outbox deliver fail", zap.String("id", e.ID), zap.Error(err))
			dropped, rerr := d.outbox.Retry(ctx, e.ID, d.cfg.Reliability.MaxRetries)
			if rerr != nil {
				d.log.Error("outbox retry update", zap.Error(rerr))
			}
			if dropped {
				_ = outbox.AppendDLQ(filepath.Join(d.cfg.ProjectPath, d.cfg.Reliability.DLQPath), e)
				d.log.Warn("event moved to DLQ", zap.String("id", e.ID), zap.String("type", e.Type))
			}
			continue
		}
		_ = d.outbox.Ack(ctx, e.ID)
	}
}

// deliver 是占位实现：未来 M9 改为统一 /api/v1/events:ingest。
// 现阶段只对若干已存在路由做最小映射，其他事件先直接 Ack（避免长期积压）。
func (d *Daemon) deliver(ctx context.Context, e outbox.Event) error {
	switch e.Type {
	case "sop.task.status_changed":
		taskID := e.Subject
		if taskID == "" {
			return nil
		}
		body := map[string]any{}
		for k, v := range e.Data {
			body[k] = v
		}
		return d.http.Do(ctx, "PATCH", "/api/v1/tasks/"+taskID, body, nil)
	case "sop.issue.opened":
		body := map[string]any{}
		for k, v := range e.Data {
			body[k] = v
		}
		body["project_id"] = d.cfg.Manager.ProjectID
		return d.http.Do(ctx, "POST", "/api/v1/issues", body, nil)
	case "sop.agent.heartbeat":
		// 没有专用端点前，仅探活 Manager 即视为成功
		return d.http.Do(ctx, "GET", "/api/v1/health", nil, nil)
	case "sop.sync.push":
		body := map[string]any{}
		for k, v := range e.Data {
			body[k] = v
		}
		return d.http.Do(ctx, "POST", "/api/v1/sync/push", body, nil)
	default:
		// 未实现的事件类型：暂时静默 Ack，避免长期堆积（M9 切到统一 ingest 端点后会全量上送）
		d.log.Debug("event silently acked (no route yet)", zap.String("type", e.Type))
		return nil
	}
}

// Doctor 自检：配置 + Manager + outbox 路径。
func Doctor(ctx context.Context) error {
	log := zap.NewNop()
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cli := httpx.New(cfg.Manager.URL, cfg.Manager.ProjectID, cfg.Auth.Bearer, cfg.Auth.APIKey,
		5*time.Second, cfg.Auth.VerifySSL, 0)
	var h map[string]any
	if err := cli.Do(ctx, "GET", "/api/v1/health", nil, &h); err != nil {
		log.Warn("health", zap.Error(err))
		fmt.Printf("✗ manager %s: %v\n", cfg.Manager.URL, err)
		return err
	}
	fmt.Printf("✓ manager %s ok (mode=%v)\n", cfg.Manager.URL, h["admin_mode"])
	fmt.Printf("  project_id=%s tenant_id=%s\n", cfg.Manager.ProjectID, cfg.Manager.TenantID)
	return nil
}

func writePID(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(fmt.Sprintf("%d", os.Getpid())), 0o644)
}

func hostname() string {
	h, _ := os.Hostname()
	return h
}
