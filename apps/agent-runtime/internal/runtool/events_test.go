package runtool

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRuntimeEventChild(t *testing.T) {
	if os.Getenv("SOP_RUNTIME_EVENT_CHILD") != "1" {
		return
	}
	fmt.Fprintln(os.Stdout, "hello 世界")
	fmt.Fprintln(os.Stderr, "error line")
	time.Sleep(10 * time.Second)
	os.Exit(0)
}

func TestRunEventsProducesOutputBeforeCompletionAndConfirmsStop(t *testing.T) {
	t.Setenv("SOP_RUNTIME_EVENT_CHILD", "1")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := make(chan ToolEvent, 20)
	done := make(chan Response, 1)
	go func() {
		done <- RunEvents(ctx, t.TempDir(), Request{Argv: []string{os.Args[0], "-test.run=^TestRuntimeEventChild$"}, TimeoutSeconds: 20}, func(event ToolEvent) { events <- event })
	}()
	found := false
	for !found {
		select {
		case event := <-events:
			found = event.Event == "tool.output" && strings.Contains(event.Text, "hello 世界")
		case <-time.After(5 * time.Second):
			t.Fatal("live output was not emitted")
		}
	}
	select {
	case <-done:
		t.Fatal("output was only available after exit")
	default:
	}
	cancel()
	select {
	case result := <-done:
		if !result.ProcessTreeStopped || !result.WaitCompleted || !result.OutputEOF {
			t.Fatalf("missing physical stop proof: %#v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancellation did not stop the command")
	}
}

func TestEventWriterPreservesSplitUTF8AndHidesWholeOversizeLine(t *testing.T) {
	var events []ToolEvent
	writer := &eventWriter{stream: "stdout", emit: func(event ToolEvent) { events = append(events, event) }}
	raw := []byte("hello 世界\n")
	for _, value := range raw {
		_, _ = writer.Write([]byte{value})
	}
	_, _ = writer.Write([]byte("secret-prefix" + strings.Repeat("x", maxEventLineBytes)))
	_, _ = writer.Write([]byte("secret-suffix\nafter\n"))
	writer.flush(true)
	if len(events) != 3 || events[0].Text != string(raw) || !events[1].Truncated || strings.Contains(events[1].Text, "secret") || events[2].Text != "after\n" {
		t.Fatalf("unexpected bounded complete lines: %#v", events)
	}
}
