// Package config 加载 .sop-runtime/agent.toml + 全局 ~/.sop/config.toml + env。
// 与 sop_sdk.config 保持字段一致。
package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
)

type Manager struct {
	URL       string `toml:"url"`
	ProjectID string `toml:"project_id"`
	TenantID  string `toml:"tenant_id"`
}

type Auth struct {
	Method     string `toml:"method"`       // apikey | bearer | mtls
	APIKeyRef  string `toml:"api_key_ref"`  // keyring://... / env://... / file://...
	APIKey     string // 运行时解析
	Bearer     string // 运行时解析（SOP_BEARER_TOKEN / ~/.sop/credentials）
	VerifySSL  bool   `toml:"verify_ssl"`
}

type Transport struct {
	WS         bool     `toml:"ws"`
	GRPC       bool     `toml:"grpc"`
	MCPServers []string `toml:"mcp_servers"`
	A2APort    int      `toml:"a2a_port"`
}

type Reliability struct {
	OutboxPath      string `toml:"outbox_path"`
	BatchSize       int    `toml:"batch_size"`
	MaxRetries      int    `toml:"max_retries"`
	DLQPath         string `toml:"dlq_path"`
	TimeoutSeconds  int    `toml:"timeout_seconds"`
}

type Security struct {
	NonceWindowSeconds int  `toml:"nonce_window_seconds"`
	SignBody           bool `toml:"sign_body"`
}

type Config struct {
	ProjectPath string      // 运行时
	SocketPath  string      // 运行时
	PIDFile     string      // 运行时
	LogDir      string      // 运行时
	Manager     Manager     `toml:"manager"`
	Auth        Auth        `toml:"auth"`
	Transport   Transport   `toml:"transport"`
	Reliability Reliability `toml:"reliability"`
	Security    Security    `toml:"security"`
}

func defaults() *Config {
	return &Config{
		Manager: Manager{URL: "http://localhost:8765", TenantID: "t-default"},
		Auth:    Auth{Method: "apikey", VerifySSL: true},
		Transport: Transport{
			WS: true, GRPC: false, A2APort: 7741,
			MCPServers: []string{"lancedb", "knowledge", "tasks", "files"},
		},
		Reliability: Reliability{
			OutboxPath: ".sop-runtime/outbox.sqlite",
			BatchSize:  50, MaxRetries: 6, DLQPath: ".sop-runtime/dlq",
			TimeoutSeconds: 30,
		},
		Security: Security{NonceWindowSeconds: 300, SignBody: true},
	}
}

// Load 按优先级合并：env > project agent.toml > global ~/.sop/config.toml > defaults
func Load() (*Config, error) {
	cfg := defaults()
	home, _ := os.UserHomeDir()
	if home != "" {
		_ = mergeFromFile(cfg, filepath.Join(home, ".sop", "config.toml"))
	}

	projectPath := os.Getenv("PROJECT_PATH")
	if projectPath == "" {
		wd, _ := os.Getwd()
		projectPath = wd
	}
	absPath, _ := filepath.Abs(projectPath)
	cfg.ProjectPath = absPath

	_ = mergeFromFile(cfg, filepath.Join(absPath, ".sop-runtime", "agent.toml"))

	// env 覆盖
	if v := os.Getenv("MANAGER_URL"); v != "" {
		cfg.Manager.URL = v
	}
	if v := os.Getenv("PROJECT_ID"); v != "" {
		cfg.Manager.ProjectID = v
	}
	if v := os.Getenv("TENANT_ID"); v != "" {
		cfg.Manager.TenantID = v
	}

	// 解析 api_key_ref / bearer
	if cfg.Auth.APIKey == "" {
		cfg.Auth.APIKey = resolveAPIKey(cfg.Auth.APIKeyRef)
	}
	if v := os.Getenv("SOP_BEARER_TOKEN"); v != "" {
		cfg.Auth.Bearer = v
	} else if v := os.Getenv("MANAGER_SOP_TOKEN"); v != "" {
		cfg.Auth.Bearer = v
	} else if v := resolveBearerFromFile(filepath.Join(home, ".sop", "credentials")); v != "" {
		cfg.Auth.Bearer = v
	}

	// 运行时路径
	cfg.SocketPath = filepath.Join(absPath, ".sop-runtime", "agentd.sock")
	cfg.PIDFile = filepath.Join(absPath, ".sop-runtime", "agentd.pid")
	cfg.LogDir = filepath.Join(absPath, ".sop-runtime", "logs")

	if cfg.Manager.URL == "" {
		return nil, errors.New("manager.url 未配置")
	}
	return cfg, nil
}

func mergeFromFile(cfg *Config, path string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	_, err := toml.DecodeFile(path, cfg)
	return err
}

func resolveBearerFromFile(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "SOP_BEARER_TOKEN=") {
			return strings.TrimSpace(strings.TrimPrefix(line, "SOP_BEARER_TOKEN="))
		}
	}
	return ""
}

func resolveAPIKey(ref string) string {
	if ref == "" {
		return os.Getenv("MANAGER_API_KEY")
	}
	switch {
	case len(ref) > 6 && ref[:6] == "env://":
		return os.Getenv(ref[6:])
	case len(ref) > 7 && ref[:7] == "file://":
		b, err := os.ReadFile(ref[7:])
		if err != nil {
			return ""
		}
		return string(b)
	case len(ref) > 10 && ref[:10] == "keyring://":
		// Go 端 keyring 集成留待 M10；当前回退到环境变量。
		return os.Getenv("MANAGER_API_KEY")
	}
	return ""
}
