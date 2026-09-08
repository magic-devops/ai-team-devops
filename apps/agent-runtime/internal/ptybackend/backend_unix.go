//go:build !windows

package ptybackend

import (
	"context"
	"os"
	"os/exec"
	"syscall"
	"time"

	"github.com/creack/pty"
)

func Start(req StartRequest) (Session, error) {
	cmd := exec.Command(req.Argv[0], req.Argv[1:]...)
	cmd.Dir = req.Root
	size := &pty.Winsize{Cols: uint16(dimOr(req.Cols, 120)), Rows: uint16(dimOr(req.Rows, 30))}
	file, err := pty.StartWithSize(cmd, size)
	if err != nil {
		return nil, err
	}
	return &unixSession{cmd: cmd, file: file, timeoutSeconds: req.TimeoutSeconds}, nil
}

type unixSession struct {
	cmd            *exec.Cmd
	file           *os.File
	timeoutSeconds int
}

func (s *unixSession) Read(p []byte) (int, error) {
	return s.file.Read(p)
}

func (s *unixSession) Write(p []byte) (int, error) {
	return s.file.Write(p)
}

func (s *unixSession) Close() error {
	if s.cmd.Process != nil {
		_ = syscall.Kill(-s.cmd.Process.Pid, syscall.SIGKILL)
		_ = s.cmd.Process.Kill()
	}
	return s.file.Close()
}

func (s *unixSession) Resize(cols, rows int) error {
	return pty.Setsize(s.file, &pty.Winsize{Cols: uint16(dimOr(cols, 120)), Rows: uint16(dimOr(rows, 30))})
}

func (s *unixSession) Wait(ctx context.Context) (int, error) {
	done := make(chan error, 1)
	go func() { done <- s.cmd.Wait() }()
	waitCtx := ctx
	var cancel context.CancelFunc
	if s.timeoutSeconds > 0 {
		waitCtx, cancel = context.WithTimeout(ctx, time.Duration(s.timeoutSeconds)*time.Second)
		defer cancel()
	}
	select {
	case err := <-done:
		if err == nil {
			return 0, nil
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
				return status.ExitStatus(), nil
			}
		}
		return -1, err
	case <-waitCtx.Done():
		if s.cmd.Process != nil {
			_ = syscall.Kill(-s.cmd.Process.Pid, syscall.SIGKILL)
			_ = s.cmd.Process.Kill()
		}
		return -1, waitCtx.Err()
	}
}

func (s *unixSession) PID() int {
	if s.cmd.Process == nil {
		return 0
	}
	return s.cmd.Process.Pid
}

func (s *unixSession) Backend() string {
	return "creack/pty"
}

func dimOr(value, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}
