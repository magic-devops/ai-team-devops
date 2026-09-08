// sop-agentd: 项目侧守护进程
// 职责：心跳 + outbox + WebSocket + MCP Hub + A2A + IPC（Unix socket）
//
// 入口保持 < 80 行；具体逻辑在 internal/daemon/。
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/config"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/daemon"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/logging"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/runtool"
	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/toolserver"
	"github.com/spf13/cobra"
)

// Version 由 -ldflags 注入
var Version = "1.0.0"

func main() {
	root := &cobra.Command{
		Use:     "sop-agentd",
		Short:   "ai-team-devops 项目侧守护进程",
		Version: Version,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return run(cmd.Context())
		},
	}
	root.AddCommand(versionCmd())
	root.AddCommand(doctorCmd())
	root.AddCommand(runToolCmd())
	root.AddCommand(toolServerCmd())

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := root.ExecuteContext(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "✗ %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	log := logging.New()
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	d, err := daemon.New(log, cfg, Version)
	if err != nil {
		return fmt.Errorf("init daemon: %w", err)
	}
	return d.Run(ctx)
}

func versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "显示版本",
		Run: func(_ *cobra.Command, _ []string) {
			fmt.Println(Version)
		},
	}
}

func doctorCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "doctor",
		Short: "本地自检（配置/路径/Manager 连通性）",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return daemon.Doctor(cmd.Context())
		},
	}
}

func runToolCmd() *cobra.Command {
	var root string
	c := &cobra.Command{
		Use:   "run-tool --root PATH",
		Short: "执行 Hermes core 授权的一次性本地工具调用",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			var req runtool.Request
			if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
				req = runtool.Request{}
				writeRunToolResponse(runtool.Response{OK: false, ExitCode: -1, Error: "invalid json: " + err.Error()})
				return nil
			}
			writeRunToolResponse(runtool.Run(cmd.Context(), root, req))
			return nil
		},
	}
	c.Flags().StringVar(&root, "root", "", "workspace root")
	_ = c.MarkFlagRequired("root")
	return c
}

func writeRunToolResponse(resp runtool.Response) {
	raw, _ := json.Marshal(resp)
	fmt.Println(string(raw))
}

func toolServerCmd() *cobra.Command {
	var root string
	c := &cobra.Command{
		Use:   "tool-server --root PATH",
		Short: "启动 Hermes core 授权的 JSONL 长连接工具服务",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return toolserver.RunStdio(cmd.Context(), root)
		},
	}
	c.Flags().StringVar(&root, "root", "", "workspace root")
	_ = c.MarkFlagRequired("root")
	return c
}
