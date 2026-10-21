package runtool

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"strings"
	"testing"
	"time"
)

func TestChildReadsCompleteUTF8StdinAndReportsItsDigest(t *testing.T) {
	if os.Getenv("HERMES_STDIN_HELPER") == "1" {
		return
	}
	body := strings.Repeat("design正文\n", 12000)
	sum := sha256.Sum256([]byte(body))
	digest := hex.EncodeToString(sum[:])
	// The real Go test binary is the child: no external provider/network required.
	t.Setenv("HERMES_STDIN_HELPER", "1")
	var completed *Response
	RunEvents(context.Background(), t.TempDir(), Request{Argv: []string{os.Args[0], "-test.run=^TestStdinChildHelper$"},
		StdinText: body, StdinSHA256: digest}, func(event ToolEvent) {
		if event.Result != nil {
			completed = event.Result
		}
	})
	if completed == nil || !completed.OK || completed.StdinSHA256 != digest || !strings.Contains(completed.Stdout, digest) {
		t.Fatalf("full stdin was not delivered: %+v", completed)
	}
	if !completed.WaitCompleted || !completed.OutputEOF || !completed.ProcessTreeStopped {
		t.Fatal("stdin changed the physical completion proof")
	}
}

func TestStdinChildHelper(t *testing.T) {
	if os.Getenv("HERMES_STDIN_HELPER") != "1" {
		return
	}
	body, err := io.ReadAll(os.Stdin)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	_, _ = os.Stdout.WriteString(hex.EncodeToString(sum[:]) + "\n")
}

func TestInvalidOrOversizedStdinCannotSpawn(t *testing.T) {
	for _, req := range []Request{
		{Argv: []string{"must-not-execute"}, StdinText: "actual", StdinSHA256: strings.Repeat("0", 64)},
		{Argv: []string{"must-not-execute"}, StdinText: strings.Repeat("x", 512*1024+1)},
	} {
		started := false
		result := RunEvents(context.Background(), t.TempDir(), req, func(event ToolEvent) { started = started || event.Event == "tool.started" })
		if started || result.OK || !strings.Contains(result.Error, "stdin") {
			t.Fatalf("invalid input spawned: %+v", result)
		}
	}
}

func TestStdinCancellationStillWaitsForPhysicalTreeStop(t *testing.T) {
	if os.Getenv("HERMES_STDIN_HELPER") == "1" {
		return
	}
	t.Setenv("HERMES_STDIN_HELPER", "1")
	body := strings.Repeat("design", 10000)
	sum := sha256.Sum256([]byte(body))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := RunEvents(ctx, t.TempDir(), Request{Argv: []string{os.Args[0], "-test.run=^TestStdinBlockingChildHelper$"},
		StdinText: body, StdinSHA256: hex.EncodeToString(sum[:])}, func(event ToolEvent) {
		if event.Event == "tool.started" {
			cancel()
		}
	})
	if result.OK || !result.ProcessTreeStopped || !result.WaitCompleted || !result.OutputEOF {
		t.Fatalf("stdin bypassed physical cancellation evidence: %+v", result)
	}
}

func TestStdinBlockingChildHelper(t *testing.T) {
	if os.Getenv("HERMES_STDIN_HELPER") != "1" {
		return
	}
	_, _ = io.ReadAll(os.Stdin)
	time.Sleep(30 * time.Second)
}
