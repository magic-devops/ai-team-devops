//go:build !windows

package runtool

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestTimeoutKillsUnixProcessGroup(t *testing.T) {
	root := t.TempDir()
	childPath := filepath.Join(root, "child.pid")
	script := "sleep 30 & echo $! > child.pid; wait"
	resp := Run(context.Background(), root, Request{Argv: []string{"/bin/sh", "-c", script}, TimeoutSeconds: 1})
	if resp.OK || !strings.Contains(resp.Error, "timed out") {
		t.Fatalf("expected timeout, got %#v", resp)
	}
	raw, err := os.ReadFile(childPath)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !processExists(pid) {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("grandchild process %d survived timeout process-group kill", pid)
}

func processExists(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil
}
