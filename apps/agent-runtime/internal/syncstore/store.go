// Package syncstore 将 Manager sync/pull 结果物化到本地 JSON，供离线读取与对账。
package syncstore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

var modules = []string{"tasks", "requirements", "issues", "sprints"}

// Store 维护各模块 id → record 映射（.sop-runtime/sync/entities/<module>.json）。
type Store struct {
	dir string
	mu  sync.Mutex
}

func New(projectPath string) *Store {
	return &Store{dir: filepath.Join(projectPath, ".sop-runtime", "sync", "entities")}
}

func (s *Store) path(module string) string {
	return filepath.Join(s.dir, module+".json")
}

func (s *Store) loadModule(module string) (map[string]map[string]interface{}, error) {
	out := map[string]map[string]interface{}{}
	raw, err := os.ReadFile(s.path(module))
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]map[string]interface{}{}, nil
	}
	return out, nil
}

func (s *Store) saveModule(module string, data map[string]map[string]interface{}) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path(module), b, 0o644)
}

// Merge 将 pull 变更 upsert 到本地实体库；返回各模块合并条数。
func (s *Store) Merge(changes map[string][]map[string]interface{}) (map[string]int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	counts := map[string]int{}
	for _, mod := range modules {
		rows, ok := changes[mod]
		if !ok || len(rows) == 0 {
			continue
		}
		cur, err := s.loadModule(mod)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			id, _ := row["id"].(string)
			if id == "" {
				continue
			}
			cur[id] = row
			counts[mod]++
		}
		if err := s.saveModule(mod, cur); err != nil {
			return nil, err
		}
	}
	return counts, nil
}

// Counts 返回各模块本地实体数量。
func (s *Store) Counts() (map[string]int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]int{}
	for _, mod := range modules {
		cur, err := s.loadModule(mod)
		if err != nil {
			return nil, err
		}
		out[mod] = len(cur)
	}
	return out, nil
}
