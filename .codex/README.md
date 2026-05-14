# Codex CLI 项目配置（`.codex/`）

## 是否应提交到 Git

**应提交**

- `config.toml`：模型、沙箱、审批策略（勿写 API Key）。
- `hooks.json`：事件 → `hooks/sop_hook.py` → **`ai-sop-ops/sop_ai_hook.py`**（`sop_hook.py` 内解析仓库根）。
- `hooks/sop_hook.py`：薄适配层。

**勿提交**

- `log/`、`sessions/`、`auth*`、`history*`（见 `.gitignore`）。

首次或修改 hook 后，在 Codex 中需通过「信任项目 hook」类流程。

## 延伸阅读

`ai-sop-ops/AI_CAPABILITY_CONTROL_PLANE.md`、`ai-sop/integrations/INTEGRATIONS.md` 第 1 节。
