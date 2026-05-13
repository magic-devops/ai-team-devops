# 外部工具快速集成指南

> 版本: v1.1 | 更新: 2026-05-13

## 集成概览

| 工具 | 类型 | 集成方式 | 状态 |
|------|------|---------|------|
| OpenAI Codex CLI | AI 编码工具 | AGENTS.md + .codex/config.toml + hooks.json | ✅ 已集成 |
| obra/superpowers | Claude Code 增强 | hooks + commands | ✅ 已集成 |
| sst/opencode | AI 编码工具 | opencode.json | ✅ 已集成 |
| openclaw | AI 编码工具 | .cursorrules 兼容 | ✅ 兼容 |
| LanceDB | 向量数据库 | lancedb_ops.py | ✅ 已集成 |
| MCP servers | 工具协议 | .claude/settings.json | ✅ 已集成 |
| Google A2A | Agent 协议 | agents/A2A_SPEC.md | ✅ 规范已定义 |

## 1. OpenAI Codex CLI 集成

Codex CLI 使用 `AGENTS.md` 读取项目规约，`.codex/config.toml` 管理模型 / 沙箱 / approval，`.codex/hooks.json` 管理生命周期 hook。

```bash
npm install -g @openai/codex
codex
codex exec "读取 AGENTS.md 后检查项目健康状态"
```

默认 hook 覆盖：

```
.codex/
├── config.toml
├── hooks.json
└── hooks/
    └── sop_hook.py      # 启动上下文、危险命令拦截、活动日志、Stop 状态同步
```

Codex hook 可以在沙箱外运行，首次启用或修改后需要在 Codex 中人工审查并信任。

所有 AI 工具适配都应遵循统一控制平面：[AI_CAPABILITY_CONTROL_PLANE.md](../tools/AI_CAPABILITY_CONTROL_PLANE.md)。

## 2. obra/superpowers 集成

superpowers 提供 Claude Code hooks 和 commands 增强模式，本项目已完整实现：

```
.claude/
├── commands/          # /plan /review /test /commit /debug /standup /evolve
└── hooks/
    ├── pre-tool-call.sh   # 安全检查（阻止危险命令、检测硬编码密钥）
    ├── post-tool-call.sh  # 状态更新（自动更新 updated_at、审计日志）
    └── stop.sh            # 会话结束快照 + 提示 /evolve
```

**扩展 superpowers 命令**：
```bash
# 在 .claude/commands/ 添加自定义命令
cat > .claude/commands/my-command.md << 'CMD'
# /my-command - 自定义命令
执行步骤：...
CMD
```

## 3. sst/opencode 集成

```json
// opencode.json（已由 init-ai-project.sh 生成）
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-7",
  "providers": { "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}" } },
  "context": [
    { "type": "file", "path": "CLAUDE.md" },
    { "type": "file", "path": "memory/current_state.json", "optional": true }
  ]
}
```

**多模型配置**：
```json
{
  "providers": {
    "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}" },
    "openai":    { "apiKey": "${OPENAI_API_KEY}" },
    "google":    { "apiKey": "${GOOGLE_API_KEY}" },
    "ollama":    { "baseUrl": "http://localhost:11434" }
  }
}
```

## 4. openclaw / 其他工具集成

openclaw 和其他兼容 `.cursorrules` 的工具，直接使用已生成的配置：

```bash
# 同步规范到所有工具
bash sop/tools/sync-rules.sh

# 生成的文件：
# .cursorrules / .windsurfrules / .trae/rules.md / .qoder/context.md
```

## 5. MCP Servers 配置

在 `.claude/settings.json` 的 `mcpServers` 中添加：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "git": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-git", "--repository", "."]
    },
    "lancedb": {
      "command": "python3",
      "args": ["sop/integrations/mcp_lancedb_server.py"],
      "description": "LanceDB 语义搜索 MCP Server"
    },
    "knowledge": {
      "command": "python3",
      "args": ["sop/integrations/mcp_knowledge_server.py"],
      "description": "知识库查询 MCP Server"
    }
  }
}
```

## 6. LanceDB 知识库集成

```bash
# 索引 custom/ 目录到知识库
python sop/knowledge/lancedb_ops.py index-custom

# 在任务开始前查询相关上下文
python sop/knowledge/lancedb_ops.py context "实现支付功能"

# 语义搜索历史任务
python sop/knowledge/lancedb_ops.py search tasks "JWT 认证"
```

## 7. A2A 协议集成

```bash
# 启动 Agent 服务（每个 Agent 独立进程）
python sop/integrations/agents/orchestrator.py --port 8000 &
python sop/integrations/agents/coder_backend.py --port 8001 &
python sop/integrations/agents/reviewer.py --port 8003 &

# 查看 Agent Card
curl http://localhost:8001/.well-known/agent.json
```

## 快速集成脚本

```bash
# 一键安装所有集成依赖
bash sop/tools/install-integrations.sh
```
