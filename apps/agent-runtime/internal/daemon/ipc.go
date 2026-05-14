// Package daemon - IPC: 项目内 AI hook / CLI 通过 Unix Socket 与 agentd 通信。
package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"time"

	"go.uber.org/zap"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
)

// IPCRequest: { "v":1, "op":"...", "name":"...", "data":{...} }
type IPCRequest struct {
	V    int            `json:"v"`
	Op   string         `json:"op"`
	Name string         `json:"name,omitempty"`
	Data map[string]any `json:"data,omitempty"`
}

type IPCResponse struct {
	OK      bool           `json:"ok"`
	Op      string         `json:"op,omitempty"`
	ID      string         `json:"id,omitempty"`
	Error   string         `json:"error,omitempty"`
	Result  map[string]any `json:"result,omitempty"`
}

func (d *Daemon) serveIPC(ctx context.Context) error {
	if err := os.MkdirAll(filepath.Dir(d.cfg.SocketPath), 0o755); err != nil {
		return err
	}
	_ = os.Remove(d.cfg.SocketPath)
	ln, err := net.Listen("unix", d.cfg.SocketPath)
	if err != nil {
		return err
	}
	defer ln.Close()
	_ = os.Chmod(d.cfg.SocketPath, 0o600)
	d.log.Info("ipc listening", zap.String("socket", d.cfg.SocketPath))

	go func() { <-ctx.Done(); _ = ln.Close() }()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) || ctx.Err() != nil {
				return nil
			}
			d.log.Warn("ipc accept", zap.Error(err))
			continue
		}
		go d.handleIPCConn(ctx, conn)
	}
}

func (d *Daemon) handleIPCConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	reader := bufio.NewReader(conn)
	line, err := reader.ReadBytes('\n')
	if err != nil {
		return
	}
	var req IPCRequest
	if err := json.Unmarshal(line, &req); err != nil {
		writeIPC(conn, IPCResponse{OK: false, Error: "invalid json"})
		return
	}
	resp := d.dispatchIPC(ctx, req)
	writeIPC(conn, resp)
}

func writeIPC(conn net.Conn, r IPCResponse) {
	b, _ := json.Marshal(r)
	_, _ = conn.Write(append(b, '\n'))
}

func (d *Daemon) dispatchIPC(ctx context.Context, req IPCRequest) IPCResponse {
	switch req.Op {
	case "health":
		depth, _ := d.outbox.Depth(ctx)
		return IPCResponse{OK: true, Result: map[string]any{
			"agent_id":     d.agentID,
			"version":      d.version,
			"outbox_depth": depth,
		}}
	case "event":
		e := outbox.NewEvent("sop."+req.Name, stringOr(req.Data, "subject", ""), req.Data)
		if err := d.outbox.Append(ctx, e); err != nil {
			return IPCResponse{OK: false, Error: err.Error()}
		}
		return IPCResponse{OK: true, ID: e.ID}
	case "task.update":
		e := outbox.NewEvent("sop.task.status_changed", req.Name, req.Data)
		if err := d.outbox.Append(ctx, e); err != nil {
			return IPCResponse{OK: false, Error: err.Error()}
		}
		return IPCResponse{OK: true, ID: e.ID}
	case "issue.report":
		e := outbox.NewEvent("sop.issue.opened", "", req.Data)
		if err := d.outbox.Append(ctx, e); err != nil {
			return IPCResponse{OK: false, Error: err.Error()}
		}
		return IPCResponse{OK: true, ID: e.ID}
	case "sync.trigger":
		// 同步任务交给 Puller 主循环；这里仅打标记
		d.log.Info("sync.trigger requested", zap.Any("data", req.Data))
		return IPCResponse{OK: true, Result: map[string]any{"queued": true}}
	default:
		return IPCResponse{OK: false, Error: "unknown op: " + req.Op}
	}
}

// 辅助：宽松类型断言。
func stringOr(m map[string]any, key, fallback string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return fallback
}
