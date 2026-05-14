# Claude Code 项目配置（`.claude/`）

## 是否应提交到 Git

**应提交（团队共享）**

- `settings.json`：权限白名单与 hook，指向 `sop/tools/sop_ai_hook.py`（与 Codex 同一套策略）。
- `commands/`：斜杠命令模板（如 `/plan`、`/review`）。
- `hooks/stop.sh` 等：Stop 链第二段（`memory/snapshots/` 与提示）。

**勿提交**

- `settings.local.json`、日志、会话、缓存（见仓库根目录 `.gitignore`）。

## 与统一控制平面的关系

规约入口：`CLAUDE.md`、`AGENTS.md`。策略与审计：`sop/tools/sop_ai_hook.py`、可选 `.ai-memory/hook_policy.json`（模板 `sop/tools/hook_policy.example.json`）。架构说明：`sop/tools/AI_CAPABILITY_CONTROL_PLANE.md`。

## `hooks/*.sh` 说明

`pre-tool-call.sh` / `post-tool-call.sh` 为历史壳层示例；当前 **以 `settings.json` 中的 `sop_ai_hook.py` 为主**。若你在非 Claude Code 环境复用这些脚本，需自行保证调用方式与环境变量与工具一致。
