//go:build windows

package ptybackend

import (
	"context"
	"strings"
	"time"

	"github.com/UserExistsError/conpty"
)

func Start(req StartRequest) (Session, error) {
	opts := []conpty.ConPtyOption{
		conpty.ConPtyWorkDir(req.Root),
		conpty.ConPtyDimensions(dimOr(req.Cols, 120), dimOr(req.Rows, 30)),
	}
	cpty, err := conpty.Start(commandLine(req.Argv), opts...)
	if err != nil {
		return nil, err
	}
	return &windowsSession{cpty: cpty, timeoutSeconds: req.TimeoutSeconds}, nil
}

type windowsSession struct {
	cpty           *conpty.ConPty
	timeoutSeconds int
}

func (s *windowsSession) Read(p []byte) (int, error) {
	return s.cpty.Read(p)
}

func (s *windowsSession) Write(p []byte) (int, error) {
	return s.cpty.Write(p)
}

func (s *windowsSession) Close() error {
	return s.cpty.Close()
}

func (s *windowsSession) Resize(cols, rows int) error {
	return s.cpty.Resize(dimOr(cols, 120), dimOr(rows, 30))
}

func (s *windowsSession) Wait(ctx context.Context) (int, error) {
	waitCtx := ctx
	var cancel context.CancelFunc
	if s.timeoutSeconds > 0 {
		waitCtx, cancel = context.WithTimeout(ctx, time.Duration(s.timeoutSeconds)*time.Second)
		defer cancel()
	}
	code, err := s.cpty.Wait(waitCtx)
	return int(code), err
}

func (s *windowsSession) PID() int {
	return 0
}

func (s *windowsSession) Backend() string {
	return "conpty"
}

func commandLine(argv []string) string {
	parts := make([]string, 0, len(argv))
	for _, arg := range argv {
		parts = append(parts, quoteWindowsArg(arg))
	}
	return strings.Join(parts, " ")
}

func quoteWindowsArg(arg string) string {
	if arg == "" {
		return `""`
	}
	if !strings.ContainsAny(arg, " \t\n\v\"") {
		return arg
	}
	var b strings.Builder
	b.WriteByte('"')
	backslashes := 0
	for _, r := range arg {
		switch r {
		case '\\':
			backslashes++
		case '"':
			b.WriteString(strings.Repeat(`\`, backslashes*2+1))
			b.WriteRune(r)
			backslashes = 0
		default:
			if backslashes > 0 {
				b.WriteString(strings.Repeat(`\`, backslashes))
				backslashes = 0
			}
			b.WriteRune(r)
		}
	}
	if backslashes > 0 {
		b.WriteString(strings.Repeat(`\`, backslashes*2))
	}
	b.WriteByte('"')
	return b.String()
}

func dimOr(value, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}
