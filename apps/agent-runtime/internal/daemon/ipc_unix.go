//go:build !windows

package daemon

import (
	"errors"
	"fmt"
	"net"
	"os"
	"syscall"
	"time"
)

func listenIPC(path string) (net.Listener, error) {
	if err := prepareIPCSocketPath(path); err != nil {
		return nil, err
	}
	ln, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		_ = ln.Close()
		return nil, err
	}
	return ln, nil
}

func prepareIPCSocketPath(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !ownedByCurrentUser(info) {
		return fmt.Errorf("ipc path %q is not owned by current user", path)
	}
	if info.Mode()&os.ModeSocket == 0 {
		return fmt.Errorf("ipc path %q exists and is not a socket", path)
	}
	conn, err := net.DialTimeout("unix", path, 100*time.Millisecond)
	if err == nil {
		_ = conn.Close()
		return fmt.Errorf("ipc socket %q is already serving", path)
	}
	if !errors.Is(err, syscall.ECONNREFUSED) {
		return fmt.Errorf("ipc socket %q probe failed: %w", path, err)
	}
	current, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !os.SameFile(info, current) {
		return fmt.Errorf("ipc socket %q changed while probing", path)
	}
	if err := os.Remove(path); err != nil {
		return err
	}
	return nil
}

func ownedByCurrentUser(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	return stat.Uid == uint32(os.Geteuid())
}
