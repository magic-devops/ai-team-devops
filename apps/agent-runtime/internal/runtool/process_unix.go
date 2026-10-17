//go:build !windows

package runtool

import (
	"os/exec"
	"syscall"
	"time"
)

func prepareCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func attachCommand(_ *exec.Cmd) error {
	return nil
}

func terminateCommand(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	_ = syscall.Kill(-pid, syscall.SIGKILL)
	_ = cmd.Process.Kill()
}

func cleanupCommand(_ *exec.Cmd) {}

func commandTreeStopped(cmd *exec.Cmd) bool {
	until := time.Now().Add(3 * time.Second)
	for time.Now().Before(until) {
		if syscall.Kill(-cmd.Process.Pid, 0) == syscall.ESRCH {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}

func processBackend() string { return "posix_process_group" }
