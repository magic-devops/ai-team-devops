# sop/tools — 脚本与集成说明

| 入口 | 说明 |
|------|------|
| [install-integrations.sh](install-integrations.sh) | **推荐先执行**：锁定 Python 依赖（FastAPI、LanceDB、pypdf 等），支持虚拟环境；见脚本头环境变量 |
| [start-manager.sh](start-manager.sh) | 启动 Web 后台：`uvicorn main:app`（完整路由与模块化 `routers/`） |
| [start-dashboard.sh](start-dashboard.sh) | 与 `start-manager` 相同目录，同样启动 **`main:app`**（与历史 `api:app` 对齐到主入口） |
| [init-ai-project.sh](init-ai-project.sh) | 初始化业务仓库的 AI 工具链文件 |
| [AI_CAPABILITY_CONTROL_PLANE.md](AI_CAPABILITY_CONTROL_PLANE.md) | 统一 AI Agent / CLI / IDE 能力控制平面规范 |
| [AI_CAPABILITY_REGISTRY.json](AI_CAPABILITY_REGISTRY.json) | 标准能力与工具适配注册表模板 |
| [CODEX_CLI.md](CODEX_CLI.md) | Codex CLI / hooks / AGENTS.md 集成规范 |
| [sop_ai_hook.py](sop_ai_hook.py) | 统一 AI hook 策略引擎，各工具 adapter 调用它 |
| [health-check.sh](health-check.sh) / [snapshot.sh](snapshot.sh) / [sync-rules.sh](sync-rules.sh) | 运维与规则同步 |

持久化 Python 片段与更多说明见 [SCRIPTS.md](SCRIPTS.md)。多工具配置见 [TOOL_INTEGRATION.md](TOOL_INTEGRATION.md)。

Web 操作说明：仓库根 **[docs/USER_MANUAL.md](../../docs/USER_MANUAL.md)**。
