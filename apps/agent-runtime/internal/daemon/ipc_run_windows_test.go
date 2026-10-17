//go:build windows

package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/config"
	"go.uber.org/zap"
)

func nativeTestConfig(t *testing.T) *config.Config {
	t.Helper()
	project := t.TempDir()
	t.Setenv("PROJECT_PATH", project)
	t.Setenv("USERPROFILE", project)
	t.Setenv("HOME", project)
	t.Setenv("SOP_AGENTD_PIPE", "")
	t.Setenv("SOP_AGENTD_SOCK", "")
	return &config.Config{ProjectPath: project, SocketPath: filepath.Join(project, ".sop-runtime", "agentd.sock"),
		PIDFile:     filepath.Join(project, ".sop-runtime", "agentd.pid"),
		Manager:     config.Manager{URL: "http://127.0.0.1:1"},
		Reliability: config.Reliability{OutboxPath: ".sop-runtime/outbox.sqlite", BatchSize: 10, TimeoutSeconds: 1}}
}

func nativeCall(cfg *config.Config, request IPCRequest) (IPCResponse, error) {
	var response IPCResponse
	endpoint, err := pipeName(cfg.SocketPath)
	if err != nil {
		return response, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	conn, err := winio.DialPipeContext(ctx, endpoint)
	if err != nil {
		return response, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(time.Second))
	frame, err := json.Marshal(request)
	if err != nil {
		return response, err
	}
	if _, err = conn.Write(append(frame, '\n')); err != nil {
		return response, err
	}
	frame, err = bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return response, err
	}
	err = json.Unmarshal(frame, &response)
	return response, err
}

func TestRealNativeRunRejectsWrongScopeThenACKStopsAndCleansOwnedPID(t *testing.T) {
	cfg := nativeTestConfig(t)
	d, err := New(zap.NewNop(), cfg, "native-lifecycle-test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cfg.PIDFile); !os.IsNotExist(err) {
		t.Fatalf("New registered PID before IPC bind: %v", err)
	}
	outer, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- d.Run(outer) }()
	var health IPCResponse
	ready := false
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); {
		health, err = nativeCall(cfg, IPCRequest{V: 1, Op: "health"})
		if err == nil && health.OK {
			ready = true
			break
		}
		select {
		case err := <-done:
			t.Fatalf("Run exited before health: %v", err)
		default:
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !ready {
		t.Fatalf("native daemon not ready: %v", err)
	}
	if health.Result["instance_id"] != d.agentID || health.Result["project_path"] != cfg.ProjectPath || health.Result["pid"] != float64(os.Getpid()) {
		t.Fatalf("health identity: %#v", health)
	}
	for _, data := range []map[string]any{
		{"instance_id": "old-instance", "project_path": cfg.ProjectPath},
		{"instance_id": d.agentID, "project_path": filepath.Join(cfg.ProjectPath, "other")},
	} {
		response, err := nativeCall(cfg, IPCRequest{V: 1, Op: "daemon.stop", Data: data})
		if err != nil || response.OK {
			t.Fatalf("wrong stop scope accepted: %#v %v", response, err)
		}
		select {
		case err := <-done:
			t.Fatalf("wrong stop shut daemon down: %v", err)
		default:
		}
	}
	second, err := New(zap.NewNop(), cfg, "second-instance")
	if err != nil {
		t.Fatal(err)
	}
	if err := second.Run(outer); err == nil {
		t.Fatal("duplicate listener bind did not return an error")
	}
	if _, err := os.Stat(cfg.PIDFile); err != nil {
		t.Fatalf("duplicate instance removed active PID: %v", err)
	}
	response, err := nativeCall(cfg, IPCRequest{V: 1, Op: "daemon.stop", Data: map[string]any{"instance_id": d.agentID, "project_path": cfg.ProjectPath}})
	if err != nil || !response.OK {
		t.Fatalf("missing actual stop ACK: %#v %v", response, err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("ACK did not exit real Run")
	}
	if _, err := os.Stat(cfg.PIDFile); !os.IsNotExist(err) {
		t.Fatalf("owned PID marker remains after shutdown: %v", err)
	}
	if _, err := d.outbox.Depth(context.Background()); err == nil {
		t.Fatal("Run returned before closing outbox")
	}
}

func TestShutdownCannotRemoveAReplacementProcessPID(t *testing.T) {
	cfg := nativeTestConfig(t)
	d, err := New(zap.NewNop(), cfg, "test")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(cfg.PIDFile), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cfg.PIDFile, []byte("789012345"), 0600); err != nil {
		t.Fatal(err)
	}
	d.pidOwned = true
	d.shutdown()
	content, err := os.ReadFile(cfg.PIDFile)
	if err != nil || string(content) != "789012345" {
		t.Fatalf("replacement marker changed: %q %v", content, err)
	}
}

func TestRealNativeRunClosesAcceptedPartialFrameBeforeReturning(t *testing.T) {
	cfg := nativeTestConfig(t)
	d, err := New(zap.NewNop(), cfg, "native-shutdown-test")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- d.Run(ctx) }()
	endpoint, err := pipeName(cfg.SocketPath)
	if err != nil {
		t.Fatal(err)
	}
	var conn net.Conn
	for until := time.Now().Add(2 * time.Second); time.Now().Before(until); {
		dialCtx, dialCancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		conn, err = winio.DialPipeContext(dialCtx, endpoint)
		dialCancel()
		if err == nil {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte("{")); err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("Run did not stop")
	}
	_ = conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	one := make([]byte, 1)
	if _, err := conn.Read(one); !errors.Is(err, io.EOF) {
		t.Fatalf("Run returned before its accepted connection closed: %v", err)
	}
}
