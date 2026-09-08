//go:build !windows

package daemon

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListenIPCRejectsExistingNonSocket(t *testing.T) {
	path := filepath.Join(shortSocketTempDir(t), "agentd.sock")
	if err := os.WriteFile(path, []byte("do-not-delete"), 0o644); err != nil {
		t.Fatal(err)
	}
	ln, err := listenIPC(path)
	if err == nil {
		_ = ln.Close()
		t.Fatal("expected existing non-socket rejection")
	}
	raw, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(raw) != "do-not-delete" {
		t.Fatalf("existing file changed: %q", raw)
	}
}

func TestListenIPCRejectsLiveSocket(t *testing.T) {
	path := filepath.Join(shortSocketTempDir(t), "agentd.sock")
	existing, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer existing.Close()

	ln, err := listenIPC(path)
	if err == nil {
		_ = ln.Close()
		t.Fatal("expected live socket rejection")
	}
	if !strings.Contains(err.Error(), "already serving") {
		t.Fatalf("expected live socket error, got %v", err)
	}
	conn, err := net.Dial("unix", path)
	if err != nil {
		t.Fatalf("original live socket was unlinked: %v", err)
	}
	_ = conn.Close()
}

func TestListenIPCRemovesStaleOwnedSocketAndSets0600(t *testing.T) {
	path := filepath.Join(shortSocketTempDir(t), "agentd.sock")
	stale, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	if err := stale.Close(); err != nil {
		t.Fatal(err)
	}

	ln, err := listenIPC(path)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("expected socket mode 0600, got %o", got)
	}
}

func shortSocketTempDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("/private/tmp", "sop-ipc-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}
