// Package puller 从 Manager /api/v1/sync/pull 增量拉取结构化变更并持久化游标。
package puller

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"go.uber.org/zap"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/syncstore"
	httpx "github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/transport/http"
)

const defaultModules = "tasks,requirements,issues,sprints,rules,specs,templates"

// State 持久化在 .sop-runtime/sync_state.json。
type State struct {
	Cursor     string `json:"cursor"`
	LastPullAt string `json:"last_pull_at"`
	LastTotal  int    `json:"last_total"`
}

// Result 单次拉取摘要。
type Result struct {
	OK           bool           `json:"ok"`
	Cursor       string         `json:"cursor"`
	Previous     string         `json:"previous_cursor"`
	Total        int            `json:"total"`
	SnapshotPath string         `json:"snapshot_path"`
	Merged       map[string]int `json:"merged,omitempty"`
}

type pullResponse struct {
	OK       bool                                `json:"ok"`
	Cursor   string                              `json:"cursor"`
	Previous string                              `json:"previous_cursor"`
	Total    int                                 `json:"total"`
	Changes  map[string][]map[string]interface{} `json:"changes"`
}

// Puller 负责游标拉取与本地快照。
type Puller struct {
	log         *zap.Logger
	http        *httpx.Client
	store       *syncstore.Store
	projectPath string
	statePath   string
	cacheDir    string
}

func New(log *zap.Logger, http *httpx.Client, projectPath string) *Puller {
	runtime := filepath.Join(projectPath, ".sop-runtime")
	return &Puller{
		log:         log,
		http:        http,
		store:       syncstore.New(projectPath),
		projectPath: projectPath,
		statePath:   filepath.Join(runtime, "sync_state.json"),
		cacheDir:    filepath.Join(runtime, "sync"),
	}
}

func (p *Puller) LoadState() (State, error) {
	var st State
	raw, err := os.ReadFile(p.statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return st, nil
		}
		return st, err
	}
	if err := json.Unmarshal(raw, &st); err != nil {
		return State{}, err
	}
	return st, nil
}

func (p *Puller) SaveState(st State) error {
	if err := os.MkdirAll(filepath.Dir(p.statePath), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p.statePath, b, 0o644)
}

// PullOnce 执行一次增量拉取；modules 为空时使用默认四模块。
func (p *Puller) PullOnce(ctx context.Context, modules string) (*Result, error) {
	if modules == "" {
		modules = defaultModules
	}
	st, err := p.LoadState()
	if err != nil {
		return nil, fmt.Errorf("load sync state: %w", err)
	}
	q := url.Values{}
	if st.Cursor != "" {
		q.Set("cursor", st.Cursor)
	}
	q.Set("modules", modules)
	path := "/api/v1/sync/pull?" + q.Encode()

	var resp pullResponse
	if err := p.http.Do(ctx, "GET", path, nil, &resp); err != nil {
		return nil, err
	}
	if !resp.OK {
		return nil, fmt.Errorf("sync pull not ok")
	}

	snapPath, err := p.saveSnapshot(&resp)
	if err != nil {
		p.log.Warn("sync snapshot", zap.Error(err))
	}

	merged, err := p.store.Merge(resp.Changes)
	if err != nil {
		p.log.Warn("sync store merge", zap.Error(err))
	}

	st.Cursor = resp.Cursor
	st.LastPullAt = time.Now().UTC().Format(time.RFC3339)
	st.LastTotal = resp.Total
	if err := p.SaveState(st); err != nil {
		return nil, fmt.Errorf("save sync state: %w", err)
	}

	p.log.Info("sync pull",
		zap.String("cursor", resp.Cursor),
		zap.Int("total", resp.Total),
		zap.String("snapshot", snapPath),
	)
	return &Result{
		OK:           true,
		Cursor:       resp.Cursor,
		Previous:     resp.Previous,
		Total:        resp.Total,
		SnapshotPath: snapPath,
		Merged:       merged,
	}, nil
}

func (p *Puller) saveSnapshot(resp *pullResponse) (string, error) {
	if err := os.MkdirAll(p.cacheDir, 0o755); err != nil {
		return "", err
	}
	latest := filepath.Join(p.cacheDir, "latest.json")
	b, err := json.MarshalIndent(resp, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(latest, b, 0o644); err != nil {
		return "", err
	}
	ts := time.Now().UTC().Format("20060102T150405Z")
	hist := filepath.Join(p.cacheDir, "pull_"+ts+".json")
	_ = os.WriteFile(hist, b, 0o644)
	return latest, nil
}
