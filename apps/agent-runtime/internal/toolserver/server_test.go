package toolserver

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestToolServerRunTool(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := strings.NewReader(`{"id":"1","op":"run_tool","data":{"argv":["pwd"],"timeout_seconds":5}}` + "\n")
	var output bytes.Buffer
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	events := decodeEvents(t, output.String())
	if len(events) != 1 || !events[0].OK || events[0].Event != "tool.completed" {
		t.Fatalf("unexpected events: %#v", events)
	}
}

func TestToolServerWorkspaceFileOps(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := strings.NewReader(strings.Join([]string{
		`{"id":"1","op":"workspace.file.write","data":{"path":"a.txt","expected_sha256":"missing","content":"hello"}}`,
		`{"id":"2","op":"workspace.file.read","data":{"path":"a.txt"}}`,
		"",
	}, "\n"))
	var output bytes.Buffer
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	events := decodeEvents(t, output.String())
	if len(events) != 2 || !events[0].OK || !events[1].OK {
		t.Fatalf("unexpected events: %#v", events)
	}
}

func TestToolServerWorkspaceFileListLimitDefaultsPath(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := strings.NewReader(`{"id":"1","op":"workspace.file.list","data":{"limit":1}}` + "\n")
	var output bytes.Buffer
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	events := decodeEvents(t, output.String())
	if len(events) != 1 || !events[0].OK {
		t.Fatalf("unexpected events: %#v", events)
	}
	if strings.Contains(output.String(), "path is required") {
		t.Fatalf("limit-only list treated limit as path: %s", output.String())
	}
}

func TestToolServerRejectsDuplicateTerminalSessionID(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := strings.NewReader(strings.Join([]string{
		`{"id":"t1","op":"terminal.spawn","data":{"session_id":"same","argv":["/bin/sh","-c","sleep 2"],"timeout_seconds":5}}`,
		`{"id":"t2","op":"terminal.spawn","data":{"session_id":"same","argv":["/bin/sh","-c","echo leaked"],"timeout_seconds":5}}`,
		"",
	}, "\n"))
	var output bytes.Buffer
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "terminal session already exists") {
		t.Fatalf("expected duplicate session rejection, got %s", output.String())
	}
}

func TestToolServerCapsTerminalSessions(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server.maxSessions = 1
	input := strings.NewReader(strings.Join([]string{
		`{"id":"t1","op":"terminal.spawn","data":{"session_id":"one","argv":["/bin/sh","-c","sleep 2"],"timeout_seconds":5}}`,
		`{"id":"t2","op":"terminal.spawn","data":{"session_id":"two","argv":["/bin/sh","-c","sleep 2"],"timeout_seconds":5}}`,
		"",
	}, "\n"))
	var output bytes.Buffer
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "terminal session limit reached: 1") {
		t.Fatalf("expected session cap rejection, got %s", output.String())
	}
}

func TestToolServerTerminalStartsNativePTY(t *testing.T) {
	server, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := strings.NewReader(`{"id":"t1","op":"terminal.spawn","data":{"session_id":"s1","argv":["/bin/sh","-c","printf hi"],"timeout_seconds":5}}` + "\n")
	var output bytes.Buffer
	if err := server.Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"event":"terminal.started"`) {
		t.Fatalf("expected terminal.started, got %s", output.String())
	}
	if !strings.Contains(output.String(), `"native_pty":true`) {
		t.Fatalf("expected native PTY startup, got %s", output.String())
	}
	if !strings.Contains(output.String(), `"backend":"creack/pty"`) {
		t.Fatalf("expected creack/pty backend, got %s", output.String())
	}
}

func decodeEvents(t *testing.T, raw string) []Event {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(raw), "\n")
	events := make([]Event, 0, len(lines))
	for _, line := range lines {
		var event Event
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("bad json line %q: %v", line, err)
		}
		events = append(events, event)
	}
	return events
}
