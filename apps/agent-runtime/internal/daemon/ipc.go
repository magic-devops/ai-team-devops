// Package daemon - IPC: 项目内 AI hook / CLI 通过 Unix Socket 与 agentd 通信。
package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
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
	OK             bool           `json:"ok"`
	Op             string         `json:"op,omitempty"`
	ID             string         `json:"id,omitempty"`
	Error          string         `json:"error,omitempty"`
	ErrorCode      string         `json:"error_code,omitempty"`
	Result         map[string]any `json:"result,omitempty"`
	stopAfterReply bool
}

func (d *Daemon) serveIPC(ctx context.Context, ln net.Listener) error {
	serveContext, cancel := context.WithCancel(ctx)
	var handlers sync.WaitGroup
	closeListener := context.AfterFunc(serveContext, func() { _ = ln.Close() })
	defer func() {
		cancel()
		_ = ln.Close()
		closeListener()
		handlers.Wait()
	}()
	d.log.Info("ipc listening", zap.String("socket", d.cfg.SocketPath))

	for {
		conn, err := ln.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) || serveContext.Err() != nil {
				return nil
			}
			d.log.Warn("ipc accept", zap.Error(err))
			continue
		}
		handlers.Add(1)
		go func() {
			defer handlers.Done()
			closeConnection := context.AfterFunc(serveContext, func() { _ = conn.Close() })
			defer closeConnection()
			d.handleIPCConn(serveContext, conn)
		}()
	}
}

func (d *Daemon) handleIPCConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	reader := bufio.NewReader(io.LimitReader(conn, 512*1024+1))
	line, err := reader.ReadBytes('\n')
	if err != nil || len(line) > 512*1024 {
		writeIPC(conn, IPCResponse{OK: false, ErrorCode: "payload_invalid", Error: "invalid or oversized IPC frame"})
		return
	}
	var req IPCRequest
	if err := outbox.DecodeStrict(line, &req); err != nil || req.V != 1 {
		writeIPC(conn, IPCResponse{OK: false, Error: "invalid json"})
		return
	}
	resp := d.dispatchIPC(ctx, req)
	if err := writeIPC(conn, resp); err == nil && resp.stopAfterReply && d.cancelRun != nil {
		d.cancelRun()
	}
}

func writeIPC(conn net.Conn, r IPCResponse) error {
	frame, err := json.Marshal(r)
	if err != nil {
		return err
	}
	frame = append(frame, '\n')
	for len(frame) > 0 {
		count, err := conn.Write(frame)
		if err != nil {
			return err
		}
		if count == 0 {
			return io.ErrShortWrite
		}
		frame = frame[count:]
	}
	return nil
}

func (d *Daemon) dispatchIPC(ctx context.Context, req IPCRequest) IPCResponse {
	d.refreshAuthFromDisk()
	switch req.Op {
	case "daemon.stop":
		if d.agentID == "" || stringOr(req.Data, "instance_id", "") != d.agentID ||
			stringOr(req.Data, "project_path", "") != d.cfg.ProjectPath {
			return IPCResponse{OK: false, Error: "daemon.stop requires the current instance_id and project_path"}
		}
		return IPCResponse{OK: true, Op: req.Op, Result: map[string]any{
			"stopping": true, "instance_id": d.agentID, "project_path": d.cfg.ProjectPath,
		}, stopAfterReply: true}
	case "health":
		result := map[string]any{"agent_id": d.agentID, "instance_id": d.agentID, "pid": os.Getpid(), "project_path": d.cfg.ProjectPath, "version": d.version, "project_id": d.currentProjectID(), "manager_url": d.cfg.Manager.URL, "legacy_files": d.legacyFiles()}
		hasBearer, hasKey := d.cfg.Auth.Bearer != "", d.cfg.Auth.APIKey != ""
		if d.http != nil {
			hasBearer, hasKey = d.http.AuthConfigured()
			result["manager_url"] = d.http.BaseURL()
		}
		result["has_bearer"] = hasBearer
		result["has_api_key"] = hasKey
		stats, err := d.outbox.Stats(ctx)
		if err != nil {
			result["outbox_error"] = err.Error()
		} else {
			result["outbox_depth"] = stats.Pending
			result["outbox"] = stats
		}
		return IPCResponse{OK: true, Op: req.Op, Result: result}
	case "event", "task.update", "issue.report", "sync.push":
		return IPCResponse{OK: false, Op: req.Op, ErrorCode: "event_frozen_required", Error: "freeze the original event ID/bytes/digest then use event.enqueue"}
	case "event.enqueue", "outbox.stats", "outbox.list", "outbox.inspect", "outbox.requeue":
		return d.queueIPC(ctx, req)
	case "sync.trigger":
		modules := stringOr(req.Data, "modules", "")
		cycle, err := d.runSyncCycle(ctx, modules)
		if err != nil {
			return IPCResponse{OK: false, Error: err.Error()}
		}
		total, _ := cycle["pull_total"].(int)
		cursor, _ := cycle["cursor"].(string)
		return IPCResponse{OK: true, Result: map[string]any{
			"queued":  true,
			"summary": fmt.Sprintf("pull=%d pending=%v cursor=%s", total, cycle["outbox_pending"], cursor),
			"cycle":   cycle,
		}}
	case "sync.pull":
		modules := stringOr(req.Data, "modules", "")
		res, err := d.puller.PullOnce(ctx, modules)
		if err != nil {
			return IPCResponse{OK: false, Error: err.Error()}
		}
		return IPCResponse{OK: true, Result: map[string]any{
			"total":         res.Total,
			"cursor":        res.Cursor,
			"previous":      res.Previous,
			"snapshot_path": res.SnapshotPath,
			"merged":        res.Merged,
		}}
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
