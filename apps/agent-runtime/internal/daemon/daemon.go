// Package daemon 是 sop-agentd 的主循环装配点。
// 子模块：reporter / puller / watcher / outbox sender / ipc / mcp / a2a。
package daemon

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/config"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/puller"
	httpx "github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/transport/http"
)

type Daemon struct {
	log        *zap.Logger
	cfg        *config.Config
	http       *httpx.Client
	outbox     *outbox.Outbox
	puller     *puller.Puller
	agentID    string
	version    string
	cancelRun  context.CancelFunc
	pidOwned   bool
	flushMutex sync.Mutex
}

func New(log *zap.Logger, cfg *config.Config, version string) (*Daemon, error) {
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
	return &Daemon{
		log: log, cfg: cfg, http: cli, outbox: ob, puller: pl,
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

	defer d.shutdown()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(d.cfg.SocketPath), 0755); err != nil {
		return err
	}
	listener, err := listenIPC(d.cfg.SocketPath)
	if err != nil {
		return fmt.Errorf("listen IPC: %w", err)
	}
	if err := writePID(d.cfg.PIDFile); err != nil {
		_ = listener.Close()
		return fmt.Errorf("write pid: %w", err)
	}
	d.pidOwned = true
	runContext, cancel := context.WithCancel(ctx)
	defer cancel()
	d.cancelRun = cancel
	g, groupContext := errgroup.WithContext(runContext)
	g.Go(func() error { return d.serveIPC(groupContext, listener) })
	g.Go(func() error { return d.heartbeatLoop(groupContext) })
	g.Go(func() error { return d.outboxSenderLoop(groupContext) })
	g.Go(func() error { return d.pullerLoop(groupContext) })
	if err := g.Wait(); err != nil && runContext.Err() == nil {
		d.log.Error("daemon error", zap.Error(err))
		return err
	}
	return nil
}

func (d *Daemon) shutdown() {
	d.log.Info("sop-agentd stopping")
	if d.outbox != nil {
		_ = d.outbox.Close()
	}
	if d.pidOwned {
		content, err := os.ReadFile(d.cfg.PIDFile)
		if err == nil && strings.TrimSpace(string(content)) == strconv.Itoa(os.Getpid()) {
			_ = os.Remove(d.cfg.PIDFile)
		}
	}
}

func (d *Daemon) heartbeatLoop(ctx context.Context) error {
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	hb := func() {
		depth, err := d.outbox.Depth(ctx)
		if err != nil {
			d.log.Warn("heartbeat queue stats", zap.Error(err))
			return
		}
		payload := map[string]any{
			"agent_id":  d.agentID,
			"version":   d.version,
			"hostname":  hostname(),
			"os":        runtime.GOOS,
			"arch":      runtime.GOARCH,
			"telemetry": map[string]any{"outbox_depth": depth},
		}
		event := outbox.NewEvent("sop.agent.heartbeat", d.agentID, payload)
		frozen, err := outbox.Freeze(event, d.currentProjectID())
		if err == nil {
			_, err = d.outbox.Enqueue(ctx, frozen)
		}
		if err != nil && ctx.Err() == nil {
			d.log.Warn("heartbeat enqueue", zap.Error(err))
		}
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
	d.refreshAuthFromDisk()
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

// refreshAuthFromDisk 重新读取 agent.toml 与 ~/.sop/credentials（login/pair 后无需重启）。
func (d *Daemon) refreshAuthFromDisk() {
	cfg, err := config.Load()
	if err != nil {
		d.log.Warn("reload config", zap.Error(err))
		return
	}
	if d.http != nil {
		d.http.SetConfiguration(cfg.Manager.URL, cfg.Manager.ProjectID, cfg.Auth.Bearer, cfg.Auth.APIKey)
	}
}

func (d *Daemon) runSyncCycle(ctx context.Context, modules string) (map[string]any, error) {
	d.refreshAuthFromDisk()
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
	d.flushOutboxOnce(ctx)
	stats, err := d.outbox.Stats(ctx)
	if err != nil {
		return out, err
	}
	out["outbox_pending"] = stats.Pending
	out["outbox_dead_letter"] = stats.DeadLetter
	out["outbox_acked"] = stats.Acked
	return out, nil
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
