# AI 开发工具集成规范

> 版本: v1.0 | 更新: 2026-05-12
> 本规范适用于所有主流 AI 编码工具，确保 sop 体系在任何工具中均可高效运行。

## 支持的工具

| 工具 | 类型 | 配置文件 | 规则/上下文机制 |
|------|------|---------|----------------|
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
├── opencode.json          # opencode 配置
├── .cursorrules           # Cursor 规则（软链或复制）
├── .trae/rules.md         # Trae 规则
├── .ai-memory/            # 共享记忆（所有工具共用）
└── memory/                # 共享状态（所有工具共用）
```

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
- 在 Claude Code 中开始的任务，可以在 Cursor 中继续
- 规则库 `.ai-memory/rules/RULES.md` 对所有工具可见
- `memory/current_state.json` 记录最新项目状态
