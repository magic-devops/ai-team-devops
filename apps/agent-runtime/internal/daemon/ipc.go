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
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/pusher"
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
		depth, _ := d.outbox.Depth(ctx)
		hasBearer := d.cfg.Auth.Bearer != ""
		hasKey := d.cfg.Auth.APIKey != ""
		return IPCResponse{OK: true, Result: map[string]any{
			"agent_id":     d.agentID,
			"instance_id":  d.agentID,
			"pid":          os.Getpid(),
			"project_path": d.cfg.ProjectPath,
			"version":      d.version,
			"outbox_depth": depth,
			"project_id":   d.cfg.Manager.ProjectID,
			"has_bearer":   hasBearer,
			"has_api_key":  hasKey,
			"manager_url":  d.cfg.Manager.URL,
		}}
	case "event":
		e := outbox.NewEvent("sop."+req.Name, stringOr(req.Data, "subject", ""), req.Data)
		if err := d.outbox.Append(ctx, e); err != nil {
			return IPCResponse{OK: false, Error: err.Error()}
		}
		return IPCResponse{OK: true, ID: e.ID}
	case "task.update":
		if d.pusher == nil {
			return IPCResponse{OK: false, Error: "pusher not initialized"}
		}
		record := map[string]any{"id": req.Name}
		for k, v := range req.Data {
			record[k] = v
		}
		item := pusher.PushItem{Module: "tasks", Action: "upsert", Record: record}
		_ = d.pusher.Enqueue(item)
		e := outbox.NewEvent("sop.sync.push", req.Name, map[string]any{
			"module": "tasks", "action": "upsert", "record": record,
		})
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
		modules := stringOr(req.Data, "modules", "")
		cycle, err := d.runSyncCycle(ctx, modules)
		if err != nil {
			return IPCResponse{OK: false, Error: err.Error()}
		}
		total, _ := cycle["pull_total"].(int)
		cursor, _ := cycle["cursor"].(string)
		return IPCResponse{OK: true, Result: map[string]any{
			"queued":  true,
			"summary": fmt.Sprintf("pull=%d push_sent=%v cursor=%s", total, cycle["push_sent"], cursor),
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
	case "sync.push":
		if d.pusher == nil {
			return IPCResponse{OK: false, Error: "pusher not initialized"}
		}
		module := stringOr(req.Data, "module", "tasks")
		action := stringOr(req.Data, "action", "upsert")
		record, _ := req.Data["record"].(map[string]any)
		if record == nil {
			record = map[string]any{}
			for k, v := range req.Data {
				if k == "module" || k == "action" || k == "idempotency_key" {
					continue
				}
				record[k] = v
			}
		}
		item := pusher.PushItem{Module: module, Action: action, Record: record}
		if k := stringOr(req.Data, "idempotency_key", ""); k != "" {
			item.IdempotencyKey = k
		}
		if err := d.pusher.Enqueue(item); err != nil {
			return IPCResponse{OK: false, Error: err.Error()}
		}
		if err := d.pusher.PushDirect(ctx, item); err != nil {
			e := outbox.NewEvent("sop.sync.push", stringOr(record, "id", ""), map[string]any{
				"module": module, "action": action, "record": record,
			})
			if err := d.outbox.Append(ctx, e); err != nil {
				return IPCResponse{OK: false, Error: err.Error()}
			}
			return IPCResponse{OK: true, ID: e.ID, Result: map[string]any{"queued": true}}
		}
		return IPCResponse{OK: true, Result: map[string]any{"sent": true}}
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
