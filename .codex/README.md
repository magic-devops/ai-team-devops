# Codex CLI 项目配置（`.codex/`）

## 是否应提交到 Git

**应提交**

- `config.toml`：模型、沙箱、审批策略（勿写 API Key）。
- `hooks.json`：事件 → `hooks/sop_hook.py` → `sop/tools/sop_ai_hook.py`。
- `hooks/sop_hook.py`：薄适配层，保持路径稳定。

**勿提交**

- `log/`、`sessions/`、`auth*`、`history*`（见 `.gitignore`）。

首次或修改 hook 后，在 Codex 中需通过「信任项目 hook」类流程。

## 延伸阅读

`sop/tools/AI_CAPABILITY_CONTROL_PLANE.md`、`sop/integrations/INTEGRATIONS.md` 第 1 节。
