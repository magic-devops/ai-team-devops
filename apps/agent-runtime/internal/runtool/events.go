package runtool

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const maxEventLineBytes = 16 * 1024
const maxEventStreamBytes = 256 * 1024

type ToolEvent struct {
	Event      string    `json:"event"`
	SourceSeq  int       `json:"source_seq,omitempty"`
	Stream     string    `json:"stream,omitempty"`
	Text       string    `json:"text,omitempty"`
	ObservedAt string    `json:"observed_at,omitempty"`
	Truncated  bool      `json:"truncated,omitempty"`
	Final      bool      `json:"final,omitempty"`
	Result     *Response `json:"result,omitempty"`
}

type eventWriter struct {
	pending   []byte
	dropping  bool
	total     int
	exhausted bool
	records   int
	stream    string
	emit      func(ToolEvent)
	summary   limitedBuffer
}

func (w *eventWriter) Write(p []byte) (int, error) {
	n := len(p)
	_, _ = w.summary.Write(p)
	for len(p) > 0 {
		end := bytes.IndexByte(p, '\n')
		complete := end >= 0
		if !complete {
			end = len(p) - 1
		}
		part := p[:end+1]
		if !w.dropping {
			if len(w.pending)+len(part) > maxEventLineBytes {
				w.dropping = true
				w.pending = nil
			} else {
				w.pending = append(w.pending, part...)
			}
		}
		p = p[end+1:]
		if complete {
			w.flush(false)
		}
	}
	return n, nil
}

func (w *eventWriter) flush(final bool) {
	if len(w.pending) == 0 && !w.dropping {
		return
	}
	text := strings.ToValidUTF8(string(w.pending), "�")
	truncated := w.dropping
	if w.dropping {
		text = "[output line omitted: size limit]\n"
	}
	w.pending = nil
	w.dropping = false
	if w.exhausted {
		return
	}
	if w.total+len(text) > maxEventStreamBytes || w.records >= 1024 {
		text = "[output omitted: stream size limit]\n"
		truncated = true
		w.exhausted = true
	}
	w.total += len(text)
	w.records++
	w.emit(ToolEvent{Event: "tool.output", Stream: w.stream, Text: text, Truncated: truncated, Final: final})
}

// RunEvents drains both pipes through bounded complete-line writers. Completion
// is emitted only after Wait has drained output and the controlled tree is empty.
func RunEvents(ctx context.Context, root string, req Request, callback func(ToolEvent)) Response {
	started := time.Now()
	var mu sync.Mutex
	seq := 0
	emit := func(event ToolEvent) {
		mu.Lock()
		defer mu.Unlock()
		if event.Event == "tool.output" {
			seq++
			event.SourceSeq = seq
		}
		event.ObservedAt = time.Now().UTC().Format(time.RFC3339Nano)
		callback(event)
	}
	finish := func(resp Response) Response {
		resp.StdinSHA256 = req.StdinSHA256
		resp.DurationMS = time.Since(started).Milliseconds()
		emit(ToolEvent{Event: "tool.completed", Result: &resp})
		return resp
	}
	if err := validateStdin(req); err != nil {
		return finish(failure(err))
	}
	workspace, err := validRoot(root)
	if err != nil {
		return finish(failure(err))
	}
	if len(req.Argv) == 0 || strings.TrimSpace(req.Argv[0]) == "" {
		return finish(failure(fmt.Errorf("argv is required")))
	}
	// Builtin file operations are atomic; emit their bounded final output explicitly.
	if response, handled := runBuiltin(workspace, req.Argv); handled {
		if response.Stdout != "" {
			emit(ToolEvent{Event: "tool.output", Stream: "stdout", Text: response.Stdout, SourceSeq: 1, Final: true})
		}
		response.ProcessTreeStopped = true
		response.WaitCompleted = true
		response.OutputEOF = true
		return finish(response)
	}
	command := exec.Command(req.Argv[0], req.Argv[1:]...)
	command.Dir = workspace
	if req.StdinText != "" {
		// Child input is independent of the JSONL controller/cancellation pipe.
		command.Stdin = strings.NewReader(req.StdinText)
	}
	prepareCommand(command)
	stdout := &eventWriter{stream: "stdout", emit: emit, summary: limitedBuffer{limit: maxOutputBytes}}
	stderr := &eventWriter{stream: "stderr", emit: emit, summary: limitedBuffer{limit: maxOutputBytes}}
	command.Stdout = stdout
	command.Stderr = stderr
	if err := command.Start(); err != nil {
		return finish(failure(err))
	}
	if err := attachCommand(command); err != nil {
		terminateCommand(command)
		_ = command.Wait()
		cleanupCommand(command)
		return finish(failure(err))
	}
	defer cleanupCommand(command)
	emit(ToolEvent{Event: "tool.started"})
	wait := make(chan error, 1)
	go func() { wait <- command.Wait() }()
	timer := time.NewTimer(timeoutFromRequest(req.TimeoutSeconds))
	defer timer.Stop()
	var cause string
	select {
	case err = <-wait:
	case <-ctx.Done():
		cause = ctx.Err().Error()
		terminateCommand(command)
		err = <-wait
	case <-timer.C:
		cause = "command timed out"
		terminateCommand(command)
		err = <-wait
	}
	// A command may exit leaving descendants behind. Do not certify only its PID.
	terminateCommand(command)
	treeStopped := commandTreeStopped(command)
	stdout.flush(true)
	stderr.flush(true)
	result := Response{OK: err == nil && cause == "", ExitCode: exitCode(err), Stdout: stdout.summary.String(), Stderr: stderr.summary.String(),
		Error: cause, ProcessTreeStopped: treeStopped, WaitCompleted: true, OutputEOF: true, Backend: processBackend(), StdinSHA256: req.StdinSHA256}
	if result.OK && !treeStopped {
		result.OK = false
		result.Error = "controlled process tree stop could not be confirmed"
	}
	return finish(result)
}
