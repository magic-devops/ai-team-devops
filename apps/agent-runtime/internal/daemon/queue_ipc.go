package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"unicode/utf8"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
)

func (d *Daemon) currentProjectID() string {
	if d.http != nil {
		return d.http.ProjectID()
	}
	return d.cfg.Manager.ProjectID
}
func resultMap(value any) map[string]any {
	raw, _ := json.Marshal(value)
	var result map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	_ = decoder.Decode(&result)
	return result
}
func decodeData(data map[string]any, value any) error {
	for _, v := range data {
		if v == nil {
			return fmt.Errorf("null queue fields are invalid")
		}
	}
	if data == nil {
		data = map[string]any{}
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return outbox.DecodeStrict(raw, value)
}
func queueResponse(req IPCRequest, value any, err error) IPCResponse {
	if err != nil {
		return IPCResponse{OK: false, Op: req.Op, ErrorCode: outbox.ErrorCode(err), Error: err.Error()}
	}
	return IPCResponse{OK: true, Op: req.Op, Result: resultMap(value)}
}
func (d *Daemon) queueIPC(ctx context.Context, req IPCRequest) IPCResponse {
	bad := func(err error) IPCResponse {
		return IPCResponse{OK: false, Op: req.Op, ErrorCode: "payload_invalid", Error: err.Error()}
	}
	switch req.Op {
	case "event.enqueue":
		var in outbox.EnqueueInput
		if err := decodeData(req.Data, &in); err != nil {
			return bad(err)
		}
		if in.IntendedProjectID == "" || in.IntendedProjectID != d.currentProjectID() {
			return queueResponse(req, nil, &outbox.QueueError{Code: "scope_mismatch", Message: "intended project differs from daemon configuration"})
		}
		ack, err := d.outbox.Enqueue(ctx, in)
		response := queueResponse(req, ack, err)
		if err == nil {
			response.ID = ack.ID
		}
		return response
	case "outbox.stats":
		var in struct{}
		if err := decodeData(req.Data, &in); err != nil {
			return bad(err)
		}
		stats, err := d.outbox.Stats(ctx)
		return queueResponse(req, stats, err)
	case "outbox.list":
		in := outbox.ListInput{State: "all", Limit: 20}
		if err := decodeData(req.Data, &in); err != nil {
			return bad(err)
		}
		if in.Limit < 1 || in.Limit > 50 || in.State == "" {
			return bad(fmt.Errorf("limit must be1..50 and state must be supported"))
		}
		page, err := d.outbox.List(ctx, in)
		return queueResponse(req, page, err)
	case "outbox.inspect":
		var in struct {
			ID string `json:"id"`
		}
		if err := decodeData(req.Data, &in); err != nil {
			return bad(err)
		}
		if in.ID == "" || utf8.RuneCountInString(in.ID) > 128 {
			return bad(fmt.Errorf("exact event ID required"))
		}
		record, err := d.outbox.Get(ctx, in.ID)
		return queueResponse(req, record, err)
	case "outbox.requeue":
		var in outbox.RequeueInput
		if err := decodeData(req.Data, &in); err != nil {
			return bad(err)
		}
		ack, err := d.outbox.Requeue(ctx, in)
		return queueResponse(req, ack, err)
	default:
		return bad(fmt.Errorf("unknown queue operation"))
	}
}

// Only bounded metadata is inventoried. Historical JSONL is never read as a send queue.
func (d *Daemon) legacyFiles() []map[string]any {
	result := []map[string]any{}
	for _, relative := range []string{".sop-runtime/sync/push_queue.jsonl", ".sop-runtime/events/outbox.jsonl"} {
		if info, err := os.Lstat(filepath.Join(d.cfg.ProjectPath, relative)); err == nil && info.Size() > 0 {
			result = append(result, map[string]any{"path": relative, "bytes": info.Size(), "migration_required": true})
		}
	}
	directory := filepath.Join(d.cfg.ProjectPath, ".sop-runtime/dlq")
	info, err := os.Lstat(directory)
	if err != nil {
		return result
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return append(result, map[string]any{"path": ".sop-runtime/dlq", "migration_required": true, "symlink": true})
	}
	file, err := os.Open(directory)
	if err != nil {
		return result
	}
	defer file.Close()
	entries, _ := file.ReadDir(50)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.Size() > 0 {
			result = append(result, map[string]any{"path": filepath.Join(".sop-runtime/dlq", entry.Name()), "bytes": info.Size(), "migration_required": true})
		}
	}
	return result
}
