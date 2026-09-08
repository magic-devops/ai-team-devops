//go:build !windows

package runtool

import (
	"os/exec"
	"syscall"
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
