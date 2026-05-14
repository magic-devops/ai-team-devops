# Claude Code 项目配置（`.claude/`）

## 是否应提交到 Git

**应提交（团队共享）**

- `settings.json`：权限白名单与 hook；hook 命令指向 **`sop_ai_hook_launcher.py`**（加载 **`../ai-sop-ops/sop_ai_hook.py`**）。
- `sop_ai_hook_launcher.py`：稳定入口（仓库根下 **`ai-sop-ops`** submodule 须已初始化）。
- `commands/`：斜杠命令模板（如 `/plan`、`/review`）。
- `hooks/stop.sh`：Stop 链第二段（`memory/snapshots/` 与 `/evolve` 提示；第一段为 `sop_ai_hook_launcher.py` → `ai-sop-ops/sop_ai_hook.py` 的 Stop）。

**Trae / Qoder / Windsurf（与 Cursor 规则对齐）**

- 仓库根 **`.trae/rules.md`**、**`.qoder/context.md`**：与 **`.cursorrules`** 同步（可执行 `bash ai-sop-ops/sync-rules.sh` 从模板刷新）。
- **`.windsurfrules`**：同上，供 Windsurf / Codeium 读取。

**勿提交**

- `settings.local.json`、日志、会话、缓存（见仓库根目录 `.gitignore`）。

## 与统一控制平面的关系

规约入口：`CLAUDE.md`、`AGENTS.md`。策略与审计：权威实现在 **`ai-sop-ops/sop_ai_hook.py`**；可选 `.ai-memory/hook_policy.json`（模板 **`ai-sop-ops/hook_policy.example.json`**）。架构说明：**`ai-sop-ops/AI_CAPABILITY_CONTROL_PLANE.md`**。

## `hooks/*.sh` 说明

仅 **`stop.sh`** 由 `settings.json` 的 Stop 链显式调用；策略与审计均在 **`sop_ai_hook_launcher.py` → `ai-sop-ops/sop_ai_hook.py`**。若在其他工具中需要壳层封装，请自行编写 hook 并调用同一引擎。
