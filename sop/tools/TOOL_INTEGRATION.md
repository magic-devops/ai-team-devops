# AI 开发工具集成规范

> 版本: v1.1 | 更新: 2026-05-13
> 本规范适用于所有主流 AI 编码工具，确保 sop 体系在任何工具中均可高效运行。

## 支持的工具

| 工具 | 类型 | 配置文件 | 规则/上下文机制 |
|------|------|---------|----------------|
| **Codex CLI** | CLI / App / IDE | `AGENTS.md` + `.codex/config.toml` + `.codex/hooks.json` | AGENTS.md 自动注入上下文，hooks 执行生命周期守卫 |
| **Claude Code** | CLI | `.claude/settings.json` + `CLAUDE.md` | CLAUDE.md 自动注入上下文 |
| **opencode** | TUI/CLI | `opencode.json` | system prompt + rules |
| **Cursor** | IDE | `.cursorrules` / `.cursor/rules/` | Rules for AI |
| **Trae** | IDE | `.trae/rules.md` | 项目规则 |
| **Qoder** | IDE | `.qoder/context.md` | 上下文注入 |
| **Windsurf** | IDE | `.windsurfrules` | 全局/项目规则 |

## 通用原则

所有工具共享同一套规范文件（`sop/`），通过各工具的配置文件指向规范：

```
项目根目录
├── CLAUDE.md              # Claude Code 主入口
├── AGENTS.md              # Codex 主入口
├── .codex/
│   ├── config.toml        # Codex 模型 / 沙箱 / approval / hooks feature
│   └── hooks.json         # Codex 生命周期 hooks
├── opencode.json          # opencode 配置
├── .cursorrules           # Cursor 规则（软链或复制）
├── .trae/rules.md         # Trae 规则
├── .ai-memory/            # 共享记忆（所有工具共用）
└── memory/                # 共享状态（所有工具共用）
```

## 统一控制平面

sop 是统一 AI 能力控制平面，不把策略散落在每个工具配置里：

- 标准能力定义在 `sop/tools/AI_CAPABILITY_CONTROL_PLANE.md`。
- 标准能力注册模板在 `sop/tools/AI_CAPABILITY_REGISTRY.json`，初始化后复制为 `.ai-memory/ai_capabilities.json`。
- Hook 策略集中在 `sop/tools/sop_ai_hook.py`，Codex / Claude / CLI wrapper / IDE 降级适配只负责事件映射。
- Web 后台、Vibe Coding、Agent 编排、MCP、A2A 都应读取同一份状态、规则和能力注册表。

新增 AI 开发工具时，先判断它支持哪些原生能力：规则入口、hooks、MCP、非交互 CLI、审批流、沙箱。然后只写 adapter，不复制策略。

## Codex CLI 配置

Codex CLI 是 OpenAI 本地编码 Agent，推荐与 sop 的 `AGENTS.md`、共享记忆和 hook 审计一起使用：

```bash
npm install -g @openai/codex
# 或
brew install --cask codex

codex
codex exec "按 AGENTS.md 规约完成一次健康检查"
```

`.codex/config.toml` 推荐最小配置：

```toml
model = "gpt-5.5"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[features]
hooks = true
codex_hooks = true

[sandbox_workspace_write]
network_access = false
```

`AGENTS.md` 保持与 `CLAUDE.md` 同源，至少包含启动检查、核心原则、构建命令和安全约束。`init-ai-project.sh` 会在缺失时生成，不覆盖已有人工维护版本。Codex 0.130.0 本地 feature 列表中 `hooks` 已为 stable；官方 hooks 文档仍展示 `codex_hooks`，模板同时写入两项以兼容新旧命名。

### Codex hooks 能力映射

| 事件 | sop 用法 | 注意事项 |
|------|---------|----------|
| `SessionStart` | 注入启动检查上下文，提醒读取 `memory/current_state.json` 与规则库 | matcher 可匹配 `startup` / `resume` / `clear` |
| `UserPromptSubmit` | 记录用户回合审计，后续可扩展 prompt 分类与任务绑定 | matcher 当前不生效 |
| `PreToolUse` | 在工具执行前拦截危险 Bash / 写入类动作 | 作为守卫，不替代最小权限和人工 review |
| `PermissionRequest` | Codex 请求权限时二次策略判断 | 用于外部审批 UI 或团队安全策略 |
| `PostToolUse` | 记录工具执行，后续可追加 lint/test 摘要 | 可对 `Bash`、`apply_patch`、MCP 工具名做 matcher |
| `Stop` | 会话结束时更新 `memory/current_state.json.updated_at` | 适合快照、交接、演进提醒 |

Hook 命令会收到 JSON stdin；脚本输出 JSON 可影响上下文、警告或拒绝执行。Codex 会提示审查新安装或修改过的 hook，因为 hook 可在沙箱外运行，团队必须只信任仓库内可读、可审计、无外部下载执行的脚本。

## opencode 配置

```json
// opencode.json（项目根目录）
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-7",
  "providers": {
    "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}" },
    "openai":    { "apiKey": "${OPENAI_API_KEY}" },
    "google":    { "apiKey": "${GOOGLE_API_KEY}" }
  },
  "system": "读取 CLAUDE.md 了解项目规约。包名 com.magic.*，APP 默认 Superpower。失败时 <reflect> 分析，最多重试3次。",
  "rules": [
    "memory/current_state.json 存在时，启动前先读取了解当前状态",
    "commit 格式: type(scope): desc [T-id]",
    "禁止硬编码密钥，所有敏感配置从环境变量读取",
    "完成任务后输出置信度 0-1，< 0.70 时主动说明不确定点"
  ],
  "context": [
    { "type": "file", "path": "CLAUDE.md" },
    { "type": "file", "path": "memory/current_state.json", "optional": true },
    { "type": "file", "path": ".ai-memory/rules/RULES.md", "optional": true }
  ]
}
```

## Cursor 配置

```markdown
<!-- .cursorrules -->
# AI 开发规约（Cursor）

## 项目约定
- 包名: com.magic.{app}，默认 app=superpower
- API 基础路径: /api/v1/
- 时间字段: MySQL 用 gmt_created/gmt_modified，LanceDB 用 created_at/updated_at

## 核心规则
1. 只写解决问题所需的最少代码
2. 失败时分析根因换思路，不重复同一方案
3. 完成后说明置信度和不确定点
4. 禁止硬编码密钥

## 启动检查
读取 memory/current_state.json 了解当前状态和待处理任务。

## 规范加载（按需）
- Java 后端: sop/specs/backend/JAVA_SPEC.md
- 数据库: sop/specs/database/DATABASE_SPEC.md
- 安全: sop/specs/security/SECURITY_SPEC.md
- 多 Agent: sop/specs/agents-collab/MULTI_AGENT_COLLAB_SPEC.md
```

## Trae / Qoder / Windsurf 配置

```markdown
<!-- .trae/rules.md 或 .windsurfrules -->
# 项目开发规约

包名 com.magic.*，APP 默认 Superpower。
时间字段 MySQL 用 gmt_created/gmt_modified，API 响应用 createdAt/updatedAt。
失败时换思路重试，最多3次，第3次失败上报。
完成任务后说明置信度。
规范文档在 sop/ 目录，按需加载对应规范文件。
```

## init-ai-project.sh 生成的配置文件

运行 `bash sop/tools/init-ai-project.sh <name>` 自动生成所有工具配置。

## 跨工具共享记忆

所有工具共用 `.ai-memory/` 和 `memory/` 目录，实现状态共享：
- 在 Codex CLI / Claude Code 中开始的任务，可以在 Cursor 中继续
- 规则库 `.ai-memory/rules/RULES.md` 对所有工具可见
- `memory/current_state.json` 记录最新项目状态
