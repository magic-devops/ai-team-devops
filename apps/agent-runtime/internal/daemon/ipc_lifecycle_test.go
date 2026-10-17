package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/config"
	"go.uber.org/zap"
)

func TestFailedNewCannotOverwriteAnotherProcessPID(t *testing.T) {
	root := t.TempDir()
	marker := filepath.Join(root, "agentd.pid")
	if err := os.WriteFile(marker, []byte("789012345"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{ProjectPath: root, PIDFile: marker}
	// The outbox path is an existing directory, so initialization must fail.
	if d, err := New(zap.NewNop(), cfg, "test"); err == nil {
		d.shutdown()
		t.Fatal("expected outbox initialization failure")
	}
	content, err := os.ReadFile(marker)
	if err != nil || string(content) != "789012345" {
		t.Fatalf("other PID marker changed: %q, %v", content, err)
	}
}

func TestStopRequestRequiresExactInstanceAndProject(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PROJECT_PATH", root)
	t.Setenv("USERPROFILE", root)
	t.Setenv("HOME", root)
	d := &Daemon{log: zap.NewNop(), cfg: &config.Config{ProjectPath: root}, agentID: "current-instance"}
	cases := []struct {
		name, instance, project string
		ok                      bool
	}{
		{"missing", "", "", false},
		{"old-instance", "old-instance", root, false},
		{"other-project", "current-instance", filepath.Join(root, "other"), false},
		{"exact", "current-instance", root, true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			result := d.dispatchIPC(context.Background(), IPCRequest{V: 1, Op: "daemon.stop", Data: map[string]any{"instance_id": test.instance, "project_path": test.project}})
			if result.OK != test.ok {
				t.Fatalf("stop response = %#v", result)
			}
		})
	}
}

func TestStopACKIsWrittenBeforeCancellationAndFailedWriteDoesNotStop(t *testing.T) {
	for _, receive := range []bool{true, false} {
		t.Run(map[bool]string{true: "read-ack", false: "broken-ack"}[receive], func(t *testing.T) {
			root := t.TempDir()
			t.Setenv("PROJECT_PATH", root)
			t.Setenv("USERPROFILE", root)
			t.Setenv("HOME", root)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			d := &Daemon{log: zap.NewNop(), cfg: &config.Config{ProjectPath: root}, agentID: "instance", cancelRun: cancel}
			server, client := net.Pipe()
			done := make(chan struct{})
			go func() { d.handleIPCConn(ctx, server); close(done) }()
			request, _ := json.Marshal(IPCRequest{V: 1, Op: "daemon.stop", Data: map[string]any{"instance_id": "instance", "project_path": root}})
			if _, err := client.Write(append(request, '\n')); err != nil {
				t.Fatal(err)
			}
			select {
			case <-ctx.Done():
				t.Fatal("cancelled before stop ACK was written")
			case <-time.After(20 * time.Millisecond):
			}
			if receive {
				frame, err := bufio.NewReader(client).ReadBytes('\n')
				if err != nil {
					t.Fatal(err)
				}
				var response IPCResponse
				if err := json.Unmarshal(frame, &response); err != nil || !response.OK {
					t.Fatalf("bad ACK: %s, %v", frame, err)
				}
				select {
				case <-ctx.Done():
				case <-time.After(time.Second):
					t.Fatal("valid ACK did not cancel Run context")
				}
			}
			_ = client.Close()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("connection handler did not finish")
			}
			if !receive && ctx.Err() != nil {
				t.Fatal("failed ACK write cancelled daemon")
			}
		})
	}
}

type shutdownConnection struct {
	net.Conn
	reading   chan struct{}
	closed    chan struct{}
	readOnce  sync.Once
	closeOnce sync.Once
}

func (c *shutdownConnection) Read(p []byte) (int, error) {
	c.readOnce.Do(func() { close(c.reading) })
	return c.Conn.Read(p)
}

func (c *shutdownConnection) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	return c.Conn.Close()
}

type shutdownListener struct {
	conn   net.Conn
	closed chan struct{}
	once   sync.Once
}

func (l *shutdownListener) Accept() (net.Conn, error) {
	if l.conn != nil {
		conn := l.conn
		l.conn = nil
		return conn, nil
	}
	<-l.closed
	return nil, net.ErrClosed
}

func (l *shutdownListener) Close() error {
	l.once.Do(func() { close(l.closed) })
	return nil
}

func (l *shutdownListener) Addr() net.Addr { return nil }

func TestServeIPCClosesAcceptedConnectionBeforeReturning(t *testing.T) {
	raw, client := net.Pipe()
	conn := &shutdownConnection{Conn: raw, reading: make(chan struct{}), closed: make(chan struct{})}
	defer client.Close()
	defer conn.Close()
	listener := &shutdownListener{conn: conn, closed: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	d := &Daemon{log: zap.NewNop(), cfg: &config.Config{}}
	done := make(chan error, 1)
	go func() { done <- d.serveIPC(ctx, listener) }()
	select {
	case <-conn.reading:
	case <-time.After(time.Second):
		t.Fatal("accepted handler never began reading")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("IPC service did not stop")
	}
	select {
	case <-conn.closed:
	default:
		t.Fatal("IPC service returned while an accepted connection remained open")
	}
}
