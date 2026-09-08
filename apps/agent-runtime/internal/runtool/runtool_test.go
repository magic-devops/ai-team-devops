package runtool

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestRunRejectsEmptyArgvAndInvalidRoot(t *testing.T) {
	resp := Run(context.Background(), t.TempDir(), Request{})
	if resp.OK || !strings.Contains(resp.Error, "argv") {
		t.Fatalf("expected argv error, got %#v", resp)
	}
	resp = Run(context.Background(), filepath.Join(t.TempDir(), "missing"), Request{Argv: []string{"echo"}})
	if resp.OK || !strings.Contains(resp.Error, "invalid root") {
		t.Fatalf("expected invalid root error, got %#v", resp)
	}
}

func TestRunExecutesWithinRoot(t *testing.T) {
	root := t.TempDir()
	resp := Run(context.Background(), root, Request{Argv: []string{"pwd"}, TimeoutSeconds: 5})
	if !resp.OK {
		t.Fatalf("expected success: %#v", resp)
	}
	if strings.TrimSpace(resp.Stdout) != root {
		t.Fatalf("expected pwd %q, got %q", root, resp.Stdout)
	}
}

func TestWorkspaceReadWriteRequiresExpectedHash(t *testing.T) {
	root := t.TempDir()
	resp := Run(context.Background(), root, Request{Argv: []string{"workspace-file-write", "notes/a.txt", "missing", "hello"}})
	if !resp.OK {
		t.Fatalf("write failed: %#v", resp)
	}
	read := Run(context.Background(), root, Request{Argv: []string{"workspace-file-read", "notes/a.txt"}})
	if !read.OK {
		t.Fatalf("read failed: %#v", read)
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(read.Stdout), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["content"] != "hello" || payload["sha256"] == "" {
		t.Fatalf("unexpected read payload: %#v", payload)
	}
	mismatch := Run(context.Background(), root, Request{Argv: []string{"workspace-file-write", "notes/a.txt", "bad", "bye"}})
	if mismatch.OK || !strings.Contains(mismatch.Error, "mismatch") {
		t.Fatalf("expected hash mismatch, got %#v", mismatch)
	}
	ok := Run(context.Background(), root, Request{Argv: []string{"workspace-file-write", "notes/a.txt", payload["sha256"], "bye"}})
	if !ok.OK {
		t.Fatalf("hash guarded write failed: %#v", ok)
	}
	raw, _ := os.ReadFile(filepath.Join(root, "notes", "a.txt"))
	if string(raw) != "bye" {
		t.Fatalf("unexpected file content: %q", raw)
	}
}

func TestWorkspaceFileListBlankPathDefaultsToRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	resp := Run(context.Background(), root, Request{Argv: []string{"workspace-file-list", "", "1"}})
	if !resp.OK {
		t.Fatalf("blank path list failed: %#v", resp)
	}
	if strings.Contains(resp.Error, "path is required") {
		t.Fatalf("blank path should default to root: %#v", resp)
	}
	var payload struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal([]byte(resp.Stdout), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected limit to be applied, got %#v", payload.Items)
	}
}

func TestWorkspacePathContainment(t *testing.T) {
	root := t.TempDir()
	resp := Run(context.Background(), root, Request{Argv: []string{"workspace-file-read", "../outside"}})
	if resp.OK || !strings.Contains(resp.Error, "escapes root") {
		t.Fatalf("expected containment error, got %#v", resp)
	}
	resp = Run(context.Background(), root, Request{Argv: []string{"workspace-file-read", filepath.Join(root, "abs")}})
	if resp.OK || !strings.Contains(resp.Error, "relative") {
		t.Fatalf("expected relative path error, got %#v", resp)
	}
}

func TestWorkspaceReadRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs elevated privileges on some Windows hosts")
	}
	root := t.TempDir()
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(outsideFile, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideFile, filepath.Join(root, "link.txt")); err != nil {
		t.Fatal(err)
	}
	resp := Run(context.Background(), root, Request{Argv: []string{"workspace-file-read", "link.txt"}})
	if resp.OK {
		t.Fatalf("expected symlink escape rejection, got %#v", resp)
	}
}

func TestWorkspaceWriteRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs elevated privileges on some Windows hosts")
	}
	root := t.TempDir()
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(outsideFile, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideFile, filepath.Join(root, "link.txt")); err != nil {
		t.Fatal(err)
	}
	resp := Run(context.Background(), root, Request{Argv: []string{"workspace-file-write", "link.txt", sha256Hex([]byte("secret")), "changed"}})
	if resp.OK {
		t.Fatalf("expected symlink escape rejection, got %#v", resp)
	}
	raw, err := os.ReadFile(outsideFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "secret" {
		t.Fatalf("outside file was modified: %q", raw)
	}
}

func TestWorkspaceListRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs elevated privileges on some Windows hosts")
	}
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "outside")); err != nil {
		t.Fatal(err)
	}
	resp := Run(context.Background(), root, Request{Argv: []string{"workspace-file-list", "outside"}})
	if resp.OK {
		t.Fatalf("expected symlink escape rejection, got %#v", resp)
	}
}

func TestWorkspaceReadTooLargeReturnsFullHash(t *testing.T) {
	root := t.TempDir()
	raw := []byte(strings.Repeat("a", MaxOutputBytes+37))
	if err := os.WriteFile(filepath.Join(root, "large.txt"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	resp := Run(context.Background(), root, Request{Argv: []string{"workspace-file-read", "large.txt"}})
	if !resp.OK {
		t.Fatalf("read failed: %#v", resp)
	}
	var payload struct {
		Content  string `json:"content"`
		SHA256   string `json:"sha256"`
		TooLarge bool   `json:"too_large"`
	}
	if err := json.Unmarshal([]byte(resp.Stdout), &payload); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if payload.SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatalf("expected full-file hash, got %#v", payload)
	}
	if !payload.TooLarge {
		t.Fatalf("expected too_large marker, got %#v", payload)
	}
	if len(payload.Content) != MaxOutputBytes {
		t.Fatalf("expected bounded content length %d, got %d", MaxOutputBytes, len(payload.Content))
	}
}

func TestNonzeroExitIsStructuredResult(t *testing.T) {
	resp := Run(context.Background(), t.TempDir(), Request{Argv: []string{"/bin/sh", "-c", "printf no && exit 1"}, TimeoutSeconds: 5})
	if resp.OK {
		t.Fatalf("expected ok false for nonzero exit: %#v", resp)
	}
	if resp.ExitCode != 1 {
		t.Fatalf("expected exit code 1, got %#v", resp)
	}
	if resp.Stdout != "no" {
		t.Fatalf("expected stdout to be preserved, got %#v", resp)
	}
	if resp.Error != "" {
		t.Fatalf("ordinary nonzero exit must not be infrastructure error: %#v", resp)
	}
}
