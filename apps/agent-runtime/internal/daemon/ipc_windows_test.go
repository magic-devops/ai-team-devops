//go:build windows

package daemon

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNativePipeSharedVectors(t *testing.T) {
	var vectors struct {
		Vectors []struct {
			Name   string `json:"name"`
			Socket string `json:"socket_path"`
			Pipe   string `json:"pipe"`
		} `json:"vectors"`
	}
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "sop-sdk-python", "tests", "fixtures", "native_ipc_vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			got, err := pipeName(vector.Socket)
			if err != nil {
				t.Fatal(err)
			}
			if got != vector.Pipe {
				t.Fatalf("pipe = %q, want %q", got, vector.Pipe)
			}
		})
	}
}

func TestNativePipeRelativePathUsesCWD(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	relative := filepath.Join("项目_ΟΣ_İ", ".sop-runtime", "agentd.sock")
	first, err := pipeName(relative)
	if err != nil {
		t.Fatal(err)
	}
	second, err := pipeName(filepath.Join(root, relative))
	if err != nil || first != second {
		t.Fatalf("relative namespace differs: %q %q %v", first, second, err)
	}
}

func TestListenIPCOnlyAcceptsLocalPipeOverride(t *testing.T) {
	endpoint := fmt.Sprintf(`\\.\pipe\sop-go-fixture-%d-%d`, os.Getpid(), time.Now().UnixNano())
	t.Setenv("SOP_AGENTD_PIPE", endpoint)
	listener, err := listenIPC(filepath.Join(t.TempDir(), "agentd.sock"))
	if err != nil {
		t.Fatal(err)
	}
	if listener.Addr().String() != endpoint {
		t.Fatalf("pipe override ignored: %s", listener.Addr())
	}
	_ = listener.Close()
	for _, bad := range []string{`\\remote\pipe\name`, `\\.\pipe\`, `\\.\pipe\folder\name`, "\\\\.\\pipe\\bad\nname"} {
		t.Setenv("SOP_AGENTD_PIPE", bad)
		if listener, err := listenIPC(filepath.Join(t.TempDir(), "agentd.sock")); err == nil {
			_ = listener.Close()
			t.Fatalf("invalid pipe override accepted: %q", bad)
		}
	}
}
