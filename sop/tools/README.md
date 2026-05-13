# sop/tools — 脚本与集成说明

**完整清单（Shell / Python / 配置 / 规范文档）**：[SCRIPTS.md](SCRIPTS.md)。

## 常用入口

| 入口 | 说明 |
|------|------|
| [install-integrations.sh](install-integrations.sh) | **推荐先执行**：按 `integrations-requirements.txt` 安装 FastAPI、LanceDB、pypdf 等；支持虚拟环境与 `--help` |
| [start-manager.sh](start-manager.sh) | 启动 Web 后台：`uvicorn main:app`（`PROJECT_PATH`、`PORT`） |
| [start-dashboard.sh](start-dashboard.sh) | 与 `start-manager.sh` 等价，同样启动 **`main:app`** |
| [init-ai-project.sh](init-ai-project.sh) | 初始化业务仓库的 AI 工具链文件 |
| [health-check.sh](health-check.sh) | 依赖与仓库健康检查 |
| [cleanup-legacy-runtime.sh](cleanup-legacy-runtime.sh) | 迁移到 `.sop-runtime` 后可选清理遗留 `sop/web/sop.db*` 等（默认 dry-run，`--apply` 执行） |
| [reset-admin.py](reset-admin.py) | 管理员创建 / 密码重置（SQLite，读 `sop/web/.env`） |
| [manager_client.py](manager_client.py) | 本地脚本调用 Manager API（API Key + HMAC，见文件头环境变量） |
| [sop_ai_hook.py](sop_ai_hook.py) | 统一 AI hook 策略引擎，各工具 adapter 调用 |

## 运维与同步

| 入口 | 说明 |
|------|------|
| [snapshot.sh](snapshot.sh) | LanceDB / 状态快照相关 |
| [sync-rules.sh](sync-rules.sh) | 规则同步到各工具可读位置 |

## 规范与注册表

| 入口 | 说明 |
|------|------|
| [AI_CAPABILITY_CONTROL_PLANE.md](AI_CAPABILITY_CONTROL_PLANE.md) | 统一 AI 能力控制平面 |
| [AI_CAPABILITY_REGISTRY.json](AI_CAPABILITY_REGISTRY.json) | 能力注册表模板 |
| [CODEX_CLI.md](CODEX_CLI.md) | Codex CLI / hooks / AGENTS.md |
| [TOOL_INTEGRATION.md](TOOL_INTEGRATION.md) | 多工具集成总览 |
| [MCP_INTEGRATION.md](MCP_INTEGRATION.md)、[LANCEDB_SETUP.md](LANCEDB_SETUP.md)、[AUTOMATION_TRIGGERS.md](AUTOMATION_TRIGGERS.md)、[CI_CD.md](CI_CD.md)、[GIT_WORKFLOW.md](GIT_WORKFLOW.md) | 专项说明 |

Web 操作说明：仓库根 **[docs/USER_MANUAL.md](../../docs/USER_MANUAL.md)**。
