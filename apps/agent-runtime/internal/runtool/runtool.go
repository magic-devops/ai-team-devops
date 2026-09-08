// Package runtool implements the authorized one-shot tool bridge used by
// Hermes core. The core authorizes invocation; this package enforces local
// filesystem boundaries and execution limits.
package runtool

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultTimeoutSeconds = 60
	maxTimeoutSeconds     = 3600
	maxOutputBytes        = 64 * 1024
)

const MaxOutputBytes = maxOutputBytes

type Request struct {
	Argv           []string `json:"argv"`
	TimeoutSeconds int      `json:"timeout_seconds,omitempty"`
}

type Response struct {
	OK         bool   `json:"ok"`
	ExitCode   int    `json:"exit_code"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMS int64  `json:"duration_ms"`
	Error      string `json:"error,omitempty"`
}

func Run(ctx context.Context, root string, req Request) Response {
	start := time.Now()
	resp := run(ctx, root, req)
	resp.DurationMS = time.Since(start).Milliseconds()
	return resp
}

func run(ctx context.Context, root string, req Request) Response {
	workspaceRoot, err := validRoot(root)
	if err != nil {
		return failure(err)
	}
	if len(req.Argv) == 0 || strings.TrimSpace(req.Argv[0]) == "" {
		return failure(errors.New("argv must contain at least one command"))
	}
	if resp, handled := runBuiltin(workspaceRoot, req.Argv); handled {
		return resp
	}

	timeout := timeoutFromRequest(req.TimeoutSeconds)
	cmd := exec.Command(req.Argv[0], req.Argv[1:]...)
	cmd.Dir = workspaceRoot
	prepareCommand(cmd)
	var stdout, stderr limitedBuffer
	stdout.limit = maxOutputBytes
	stderr.limit = maxOutputBytes
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return Response{
			OK:       false,
			ExitCode: -1,
			Stdout:   stdout.String(),
			Stderr:   stderr.String(),
			Error:    err.Error(),
		}
	}
	if err := attachCommand(cmd); err != nil {
		terminateCommand(cmd)
		_ = cmd.Wait()
		return Response{
			OK:       false,
			ExitCode: -1,
			Stdout:   stdout.String(),
			Stderr:   stderr.String(),
			Error:    err.Error(),
		}
	}
	defer cleanupCommand(cmd)
	wait := make(chan error, 1)
	go func() { wait <- cmd.Wait() }()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	err = nil
	select {
	case err = <-wait:
	case <-timer.C:
		terminateCommand(cmd)
		err = <-wait
		resp := Response{
			OK:       false,
			ExitCode: exitCode(err),
			Stdout:   stdout.String(),
			Stderr:   stderr.String(),
			Error:    fmt.Sprintf("command timed out after %s", timeout),
		}
		if resp.ExitCode == 0 {
			resp.ExitCode = -1
		}
		return resp
	case <-ctx.Done():
		terminateCommand(cmd)
		err = <-wait
		resp := Response{
			OK:       false,
			ExitCode: exitCode(err),
			Stdout:   stdout.String(),
			Stderr:   stderr.String(),
			Error:    ctx.Err().Error(),
		}
		if resp.ExitCode == 0 {
			resp.ExitCode = -1
		}
		return resp
	}

	resp := Response{
		OK:       err == nil,
		ExitCode: exitCode(err),
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
	}
	if err != nil {
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) {
			resp.Error = err.Error()
		}
	}
	return resp
}

func ValidRoot(root string) (string, error) {
	return validRoot(root)
}

func validRoot(root string) (string, error) {
	if strings.TrimSpace(root) == "" {
		return "", errors.New("root is required")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve root: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("invalid root: %w", err)
	}
	if !info.IsDir() {
		return "", errors.New("root must be a directory")
	}
	return filepath.Clean(abs), nil
}

func timeoutFromRequest(seconds int) time.Duration {
	if seconds <= 0 {
		seconds = defaultTimeoutSeconds
	}
	if seconds > maxTimeoutSeconds {
		seconds = maxTimeoutSeconds
	}
	return time.Duration(seconds) * time.Second
}

func failure(err error) Response {
	return Response{OK: false, ExitCode: -1, Error: err.Error()}
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}

type limitedBuffer struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.limit <= 0 {
		return len(p), nil
	}
	remaining := b.limit - b.buf.Len()
	if remaining <= 0 {
		b.truncated = true
		return len(p), nil
	}
	if len(p) > remaining {
		b.truncated = true
		_, _ = b.buf.Write(p[:remaining])
		return len(p), nil
	}
	_, _ = b.buf.Write(p)
	return len(p), nil
}

func (b *limitedBuffer) String() string {
	out := b.buf.String()
	if b.truncated {
		out += "\n[truncated]"
	}
	return out
}

func runBuiltin(root string, argv []string) (Response, bool) {
	switch argv[0] {
	case "workspace-file-list":
		return builtinList(root, argv[1:]), true
	case "workspace-file-read":
		return builtinRead(root, argv[1:]), true
	case "workspace-file-write":
		return builtinWrite(root, argv[1:]), true
	case "git-status":
		return run(context.Background(), root, Request{Argv: []string{"git", "status", "--short"}, TimeoutSeconds: 30}), true
	case "git-diff":
		args := []string{"git", "diff", "--"}
		if len(argv) > 1 {
			for _, path := range argv[1:] {
				if _, err := containedPath(root, path); err != nil {
					return failure(err), true
				}
				args = append(args, path)
			}
		}
		return run(context.Background(), root, Request{Argv: args, TimeoutSeconds: 30}), true
	default:
		return Response{}, false
	}
}

func builtinList(root string, args []string) Response {
	rel := "."
	if len(args) > 0 && strings.TrimSpace(args[0]) != "" {
		rel = args[0]
	}
	cleanRel, err := cleanRootPath(rel)
	if err != nil {
		return failure(err)
	}
	workspace, err := os.OpenRoot(root)
	if err != nil {
		return failure(fmt.Errorf("open root: %w", err))
	}
	defer workspace.Close()
	if info, err := workspace.Stat(cleanRel); err != nil {
		return failure(err)
	} else if !info.IsDir() {
		return failure(errors.New("path is not a directory"))
	}
	limit := 200
	if len(args) > 1 {
		if n, err := strconv.Atoi(args[1]); err == nil && n > 0 && n < limit {
			limit = n
		}
	}
	items := make([]map[string]any, 0)
	err = fs.WalkDir(workspace.FS(), cleanRel, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == cleanRel {
			return nil
		}
		if len(items) >= limit {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		info, _ := d.Info()
		size := int64(0)
		if info != nil {
			size = info.Size()
		}
		items = append(items, map[string]any{"path": filepath.ToSlash(path), "dir": d.IsDir(), "size": size})
		if d.IsDir() && strings.HasPrefix(d.Name(), ".git") {
			return filepath.SkipDir
		}
		return nil
	})
	if err != nil {
		return failure(err)
	}
	return jsonStdout(map[string]any{"items": items})
}

func builtinRead(root string, args []string) Response {
	if len(args) != 1 {
		return failure(errors.New("workspace-file-read requires path"))
	}
	cleanRel, err := cleanRootPath(args[0])
	if err != nil {
		return failure(err)
	}
	workspace, err := os.OpenRoot(root)
	if err != nil {
		return failure(fmt.Errorf("open root: %w", err))
	}
	defer workspace.Close()
	file, err := workspace.Open(cleanRel)
	if err != nil {
		return failure(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return failure(err)
	}
	if info.IsDir() {
		return failure(errors.New("path is a directory"))
	}
	raw, sum, tooLarge, err := readLimitedWithHash(file, maxOutputBytes)
	if err != nil {
		return failure(err)
	}
	payload := map[string]any{"content": string(raw), "sha256": sum}
	if tooLarge {
		payload["too_large"] = true
	}
	return jsonStdout(payload)
}

func builtinWrite(root string, args []string) Response {
	if len(args) < 3 {
		return failure(errors.New("workspace-file-write requires path expected_sha256 content"))
	}
	cleanRel, err := cleanRootPath(args[0])
	if err != nil {
		return failure(err)
	}
	expected := args[1]
	content := []byte(args[2])
	workspace, err := os.OpenRoot(root)
	if err != nil {
		return failure(fmt.Errorf("open root: %w", err))
	}
	defer workspace.Close()
	current, err := readRootFile(workspace, cleanRel)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return failure(err)
	}
	if expected == "" {
		return failure(errors.New("expected_sha256 is required"))
	}
	if errors.Is(err, os.ErrNotExist) {
		if expected != "missing" {
			return failure(errors.New("expected_sha256 mismatch: file is missing"))
		}
	} else if sha256Hex(current) != expected {
		return failure(errors.New("expected_sha256 mismatch"))
	}
	parent := filepath.ToSlash(filepath.Dir(cleanRel))
	if parent != "." {
		if err := workspace.MkdirAll(parent, 0o755); err != nil {
			return failure(err)
		}
	}
	file, err := workspace.OpenFile(cleanRel, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return failure(err)
	}
	if _, err := file.Write(content); err != nil {
		_ = file.Close()
		return failure(err)
	}
	if err := file.Close(); err != nil {
		return failure(err)
	}
	return jsonStdout(map[string]any{"path": filepath.ToSlash(cleanRel), "sha256": sha256Hex(content)})
}

func containedPath(root, rel string) (string, error) {
	cleanRel, err := cleanRootPath(rel)
	if err != nil {
		return "", err
	}
	path := filepath.Clean(filepath.Join(root, cleanRel))
	rootWithSep := root + string(os.PathSeparator)
	if path != root && !strings.HasPrefix(path, rootWithSep) {
		return "", errors.New("path escapes root")
	}
	return path, nil
}

func cleanRootPath(rel string) (string, error) {
	if strings.TrimSpace(rel) == "" {
		return "", errors.New("path is required")
	}
	if filepath.IsAbs(rel) {
		return "", errors.New("path must be relative to root")
	}
	cleanRel := filepath.Clean(rel)
	if cleanRel == "." {
		return ".", nil
	}
	if cleanRel == ".." || strings.HasPrefix(cleanRel, ".."+string(os.PathSeparator)) {
		return "", errors.New("path escapes root")
	}
	return filepath.ToSlash(cleanRel), nil
}

func readRootFile(root *os.Root, name string) ([]byte, error) {
	file, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, errors.New("path is a directory")
	}
	return io.ReadAll(file)
}

func readLimitedWithHash(r io.Reader, limit int) ([]byte, string, bool, error) {
	h := sha256.New()
	var out bytes.Buffer
	buf := make([]byte, 32*1024)
	tooLarge := false
	for {
		n, err := r.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			if _, werr := h.Write(chunk); werr != nil {
				return nil, "", false, werr
			}
			if out.Len() < limit {
				remaining := limit - out.Len()
				if len(chunk) > remaining {
					tooLarge = true
					_, _ = out.Write(chunk[:remaining])
				} else {
					_, _ = out.Write(chunk)
				}
			} else {
				tooLarge = true
			}
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, "", false, err
		}
	}
	return out.Bytes(), hex.EncodeToString(h.Sum(nil)), tooLarge, nil
}

func jsonStdout(v any) Response {
	raw, err := json.Marshal(v)
	if err != nil {
		return failure(err)
	}
	return Response{OK: true, ExitCode: 0, Stdout: string(raw)}
}

func sha256Hex(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
