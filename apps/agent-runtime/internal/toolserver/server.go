package toolserver

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/ptybackend"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/runtool"
)

const defaultMaxSessions = 64

type Request struct {
	ID   string          `json:"id"`
	Op   string          `json:"op"`
	Data json.RawMessage `json:"data,omitempty"`
}

type Event struct {
	ID    string `json:"id,omitempty"`
	OK    bool   `json:"ok"`
	Op    string `json:"op,omitempty"`
	Event string `json:"event,omitempty"`
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

type Server struct {
	root        string
	maxSessions int
	mu          sync.Mutex
	sessions    map[string]*terminalSession
}

func New(root string) (*Server, error) {
	valid, err := runtool.ValidRoot(root)
	if err != nil {
		return nil, err
	}
	return &Server{root: valid, maxSessions: defaultMaxSessions, sessions: map[string]*terminalSession{}}, nil
}

func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	enc := json.NewEncoder(out)
	var writeMu sync.Mutex
	emit := func(event Event) {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = enc.Encode(event)
	}
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			s.closeAll()
			return nil
		default:
		}
		var req Request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			emit(Event{OK: false, Error: "invalid json: " + err.Error()})
			continue
		}
		s.dispatch(ctx, req, emit)
	}
	s.closeAll()
	return scanner.Err()
}

func (s *Server) dispatch(ctx context.Context, req Request, emit func(Event)) {
	if strings.TrimSpace(req.ID) == "" {
		emit(Event{OK: false, Op: req.Op, Error: "id is required"})
		return
	}
	switch req.Op {
	case "run_tool":
		var data runtool.Request
		if err := json.Unmarshal(req.Data, &data); err != nil {
			emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: "invalid data: " + err.Error()})
			return
		}
		emit(Event{ID: req.ID, OK: true, Op: req.Op, Event: "tool.completed", Data: runtool.Run(ctx, s.root, data)})
	case "workspace.file.list":
		s.dispatchRun(ctx, req, "workspace-file-list", emit)
	case "workspace.file.read":
		s.dispatchRun(ctx, req, "workspace-file-read", emit)
	case "workspace.file.write":
		s.dispatchRun(ctx, req, "workspace-file-write", emit)
	case "git.status":
		emit(Event{ID: req.ID, OK: true, Op: req.Op, Event: "git.status", Data: runtool.Run(ctx, s.root, runtool.Request{Argv: []string{"git-status"}})})
	case "git.diff":
		var data struct {
			Paths []string `json:"paths,omitempty"`
		}
		_ = json.Unmarshal(req.Data, &data)
		argv := append([]string{"git-diff"}, data.Paths...)
		emit(Event{ID: req.ID, OK: true, Op: req.Op, Event: "git.diff", Data: runtool.Run(ctx, s.root, runtool.Request{Argv: argv})})
	case "terminal.spawn":
		s.spawnTerminal(ctx, req, emit)
	case "terminal.write":
		s.writeTerminal(req, emit)
	case "terminal.resize":
		s.resizeTerminal(req, emit)
	case "terminal.close":
		s.closeTerminal(req, emit)
	default:
		emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: "unknown op: " + req.Op})
	}
}

func (s *Server) dispatchRun(ctx context.Context, req Request, command string, emit func(Event)) {
	var data struct {
		Path           string `json:"path,omitempty"`
		ExpectedSHA256 string `json:"expected_sha256,omitempty"`
		Content        string `json:"content,omitempty"`
		Limit          int    `json:"limit,omitempty"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil && len(req.Data) > 0 {
		emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: "invalid data: " + err.Error()})
		return
	}
	argv := []string{command}
	switch command {
	case "workspace-file-list":
		path := data.Path
		if path == "" && data.Limit > 0 {
			path = "."
		}
		if path != "" {
			argv = append(argv, path)
		}
		if data.Limit > 0 {
			argv = append(argv, fmt.Sprintf("%d", data.Limit))
		}
	case "workspace-file-read":
		argv = append(argv, data.Path)
	case "workspace-file-write":
		argv = append(argv, data.Path, data.ExpectedSHA256, data.Content)
	}
	emit(Event{ID: req.ID, OK: true, Op: req.Op, Event: req.Op + ".completed", Data: runtool.Run(ctx, s.root, runtool.Request{Argv: argv})})
}

func (s *Server) spawnTerminal(ctx context.Context, req Request, emit func(Event)) {
	var data struct {
		SessionID      string   `json:"session_id"`
		Argv           []string `json:"argv"`
		Cols           int      `json:"cols,omitempty"`
		Rows           int      `json:"rows,omitempty"`
		TimeoutSeconds int      `json:"timeout_seconds,omitempty"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: "invalid data: " + err.Error()})
		return
	}
	if data.SessionID == "" {
		data.SessionID = req.ID
	}
	if len(data.Argv) == 0 || strings.TrimSpace(data.Argv[0]) == "" {
		emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: "argv must contain at least one command"})
		return
	}
	if err := s.reserveSessionID(data.SessionID); err != nil {
		emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: err.Error()})
		return
	}
	session, err := ptybackend.Start(ptybackend.StartRequest{
		Root:           s.root,
		Argv:           data.Argv,
		Cols:           data.Cols,
		Rows:           data.Rows,
		TimeoutSeconds: data.TimeoutSeconds,
	})
	if err != nil {
		s.removeReservedSession(data.SessionID)
		emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: err.Error()})
		return
	}
	ts := &terminalSession{id: data.SessionID, session: session, ready: true}
	s.mu.Lock()
	s.sessions[data.SessionID] = ts
	s.mu.Unlock()
	emit(Event{ID: req.ID, OK: true, Op: req.Op, Event: "terminal.started", Data: map[string]any{
		"session_id": data.SessionID,
		"pid":        session.PID(),
		"backend":    session.Backend(),
		"native_pty": true,
	}})
	go streamOutput(req.ID, session, emit)
	go func() {
		code, err := session.Wait(ctx)
		s.deleteSessionIfSame(data.SessionID, ts)
		emit(Event{ID: req.ID, OK: err == nil && code == 0, Op: req.Op, Event: "terminal.exited", Data: map[string]any{"session_id": data.SessionID, "exit_code": code}, Error: errorString(err)})
	}()
}

func (s *Server) reserveSessionID(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.sessions[id]; exists {
		return errors.New("terminal session already exists")
	}
	if len(s.sessions) >= s.maxSessions {
		return fmt.Errorf("terminal session limit reached: %d", s.maxSessions)
	}
	s.sessions[id] = &terminalSession{id: id}
	return nil
}

func (s *Server) removeReservedSession(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if session, exists := s.sessions[id]; exists && !session.ready {
		delete(s.sessions, id)
	}
}

func (s *Server) deleteSessionIfSame(id string, expected *terminalSession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if current, exists := s.sessions[id]; exists && current == expected {
		delete(s.sessions, id)
	}
}

func (s *Server) writeTerminal(req Request, emit func(Event)) {
	var data struct {
		SessionID string `json:"session_id"`
		Input     string `json:"input"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: "invalid data: " + err.Error()})
		return
	}
	session, ok := s.session(data.SessionID)
	if !ok {
		emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: "terminal session not found"})
		return
	}
	_, err := io.WriteString(session.session, data.Input)
	emit(Event{ID: req.ID, OK: err == nil, Op: req.Op, Event: "terminal.wrote", Error: errorString(err)})
}

func (s *Server) resizeTerminal(req Request, emit func(Event)) {
	var data struct {
		SessionID string `json:"session_id"`
		Cols      int    `json:"cols"`
		Rows      int    `json:"rows"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: "invalid data: " + err.Error()})
		return
	}
	session, ok := s.session(data.SessionID)
	if !ok {
		emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: "terminal session not found"})
		return
	}
	err := session.session.Resize(data.Cols, data.Rows)
	emit(Event{ID: req.ID, OK: err == nil, Op: req.Op, Event: "terminal.resized", Data: map[string]any{"session_id": data.SessionID, "cols": data.Cols, "rows": data.Rows}, Error: errorString(err)})
}

func (s *Server) closeTerminal(req Request, emit func(Event)) {
	var data struct {
		SessionID string `json:"session_id"`
	}
	_ = json.Unmarshal(req.Data, &data)
	session, ok := s.session(data.SessionID)
	if !ok {
		emit(Event{ID: req.ID, OK: false, Op: req.Op, Error: "terminal session not found"})
		return
	}
	err := session.session.Close()
	if err != nil && errors.Is(err, os.ErrClosed) {
		err = nil
	}
	emit(Event{ID: req.ID, OK: err == nil, Op: req.Op, Event: "terminal.closed", Data: map[string]any{"session_id": data.SessionID}, Error: errorString(err)})
}

func (s *Server) session(id string) (*terminalSession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[id]
	if !ok || !session.ready || session.session == nil {
		return nil, false
	}
	return session, ok
}

func (s *Server) closeAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, session := range s.sessions {
		if session.session != nil {
			_ = session.session.Close()
		}
		delete(s.sessions, id)
	}
}

type terminalSession struct {
	id      string
	session ptybackend.Session
	ready   bool
}

func streamOutput(id string, reader io.Reader, emit func(Event)) {
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			emit(Event{ID: id, OK: true, Event: "terminal.output", Data: map[string]any{"text": string(buf[:n])}})
		}
		if err != nil {
			return
		}
	}
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func RunStdio(ctx context.Context, root string) error {
	server, err := New(root)
	if err != nil {
		return err
	}
	return server.Serve(ctx, os.Stdin, os.Stdout)
}
