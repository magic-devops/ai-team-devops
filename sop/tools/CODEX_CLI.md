# Codex CLI 集成规范

> 版本: v1.0 | 更新: 2026-05-13

## 目标

让 sop 项目在 Codex CLI / Codex App / Codex IDE 中获得一致的工程能力：

- `AGENTS.md` 作为 Codex 规约入口。
- `.codex/config.toml` 固化模型、沙箱、approval 与 hook feature。
- `.codex/hooks.json` 接入生命周期事件。
- `.codex/hooks/sop_hook.py` 作为 Codex adapter shim，调用 `sop/tools/sop_ai_hook.py` 统一策略引擎。

## 安装与启动

```bash
npm install -g @openai/codex
# 或
brew install --cask codex

codex
codex exec "读取 AGENTS.md，并按 sop 规约完成健康检查"
```

## 推荐配置

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

## Hook 策略

Codex 0.130.0 本地 feature 列表中 `hooks` 已为 stable；官方 hooks 文档仍展示 `codex_hooks`。模板同时写入两项以兼容新旧命名。
实际策略集中维护在 `sop/tools/sop_ai_hook.py`，`.codex/hooks.json` 只做 Codex 事件到 sop 标准事件的映射。

| Hook | sop 默认行为 | 扩展方向 |
|------|-------------|----------|
| `SessionStart` | 注入启动检查上下文 | 加载 Sprint、待办和最近事故摘要 |
| `UserPromptSubmit` | 记录活动日志 | 自动识别需求 / 缺陷 / 审查意图 |
| `PreToolUse` | 拦截危险命令 | 增加路径白名单、敏感文件写保护 |
| `PermissionRequest` | 对审批请求二次策略判断 | 接入企业审批或 ChatOps |
| `PostToolUse` | 记录工具执行 | 触发 lint/test 摘要、规则提取 |
| `Stop` | 更新时间状态 | 生成交接摘要、快照、演进建议 |

## 安全要求

- Hook 会在本地执行，必须当作高权限脚本审查。
- 禁止在 hook 中动态下载并执行脚本。
- 禁止在 hook 中输出密钥、token、cookie、私有证书。
- 默认 hook 不访问网络；需要联网时必须在 PR / 变更说明中解释目的。
- 修改 `.codex/hooks.json` 或 `.codex/hooks/` 后，团队成员需在 Codex 中重新审查并信任。

## 与 sop 记忆系统的关系

Hook 只负责轻量写入：

- `.ai-memory/activity.log`：记录 Codex 生命周期和工具事件。
- `memory/current_state.json.updated_at`：在 `Stop` 时刷新项目状态时间。

复杂记忆写入、知识蒸馏、规则生命周期升级仍由 `sop/knowledge/`、`/evolve` 和后续 Agent 编排流程处理。
