package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSocketEnvironmentIsRelativeToSelectedProject(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if err := os.MkdirAll(project, 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("USERPROFILE", root)
	t.Setenv("HOME", root)
	t.Setenv("PROJECT_PATH", project)
	t.Setenv("SOP_AGENTD_SOCK", "custom/../endpoint.sock")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SocketPath != filepath.Join(project, "endpoint.sock") {
		t.Fatalf("socket = %q, want selected project endpoint", cfg.SocketPath)
	}
}
