# 文档索引

## v2 架构文档（新增）

| 文档 | 说明 |
|------|------|
| [architecture/DATA_PLANE.md](architecture/DATA_PLANE.md) | SQL + 向量 + RAG 分层与扩展点 |
| [architecture/OVERVIEW.md](architecture/OVERVIEW.md) | 总体架构、三层 + 五通道、12 里程碑 |
| [architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md](architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md) | **多仓库**（ai-sop / ai-sop-ops）与 **manager-api + worker** 拆分设计 |
| [architecture/MODULES.md](architecture/MODULES.md) | 模块边界、命名约定、`@ai_safe_edit` 注释 |
| [architecture/AI_FIRST.md](architecture/AI_FIRST.md) | AI-First 设计手册：高效 / 学习 / 护栏 |
| [architecture/PROTOCOLS.md](architecture/PROTOCOLS.md) | REST / WS / MCP / A2A / gRPC / Webhook / EventBus 契约 |
| [architecture/SECURITY.md](architecture/SECURITY.md) | STRIDE / 鉴权 / 列加密 / 合规 |
| [architecture/DEPLOY.md](architecture/DEPLOY.md) | single / saas / enterprise 三档部署 |
| [architecture/EVOLUTION.md](architecture/EVOLUTION.md) | 长期演进 + 兼容承诺 + 弃用流程 |
| [architecture/REFACTOR_PLAN.md](architecture/REFACTOR_PLAN.md) | **大文件治理 + 新功能落点指引（AI 必读）** |
| [../apis/README.md](../apis/README.md) | OpenAPI / Proto / AsyncAPI 单一事实源说明 |
| [MIGRATE_AI_SOP_SUBMODULES.md](MIGRATE_AI_SOP_SUBMODULES.md) | **`ai-sop` / `ai-sop-ops` submodule**、克隆与环境变量 |
| [../apps/manager-web/README.md](../apps/manager-web/README.md) | **新前端 Vite + React 18 + TS 骨架** |
| [../apps/agent-runtime/README.md](../apps/agent-runtime/README.md) | sop-agentd 守护进程 |
| [../packages/sop-cli/README.md](../packages/sop-cli/README.md) | 统一 CLI `sop` 命令 |
| [../packages/sop-sdk-python/README.md](../packages/sop-sdk-python/README.md) | 项目侧 Python SDK |

## 用户手册与教程

| 文档 | 说明 |
|------|------|
| [TOOLS_AND_SCRIPTS.md](TOOLS_AND_SCRIPTS.md) | **脚本与工具统一指南**：`sop`、`make`、`build-sop.sh`、`sop-agentd`、`doctor` 故障排查 |
| [USER_MANUAL.md](USER_MANUAL.md) | Web 使用手册（§1.2 鉴权 / §1.3 `sop-ctl`） |
| [ORCHESTRATION_DEV_TOOLS.md](ORCHESTRATION_DEV_TOOLS.md) | Agent 编排、开发工具、受控安装 API 与新特性 |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | 系统架构（v1 背景） |
| [../README.md](../README.md) | 仓库总览与快速开始 |
| [../TUTORIAL.md](../TUTORIAL.md) | 详细教程 |
| [../ROADMAP.md](../ROADMAP.md) | 路线图（含 v2 里程碑状态） |
| [../ai-sop/QUICK_REF.md](../ai-sop/QUICK_REF.md) | AI 速查卡 |
| [../ai-sop/README.md](../ai-sop/README.md) | 规约仓说明（`magic-devops/ai-sop`） |
| [../apps/manager/README.md](../apps/manager/README.md) | Web 开发与 API 模块说明 |
| [../ai-sop-ops/README.md](../ai-sop-ops/README.md) | 脚本入口索引 |
| [../ai-sop-ops/DATA_AND_VECTOR.md](../ai-sop-ops/DATA_AND_VECTOR.md) | **数据平面权威**：DB_TYPE、VECTOR_DB_TYPE、OceanBase/Milvus/Qdrant |
| [../ai-sop-ops/SCRIPTS.md](../ai-sop-ops/SCRIPTS.md) | **完整清单**：Shell / Python / 配置与规范文档 |
| [../ai-sop-ops/AI_CAPABILITY_CONTROL_PLANE.md](../ai-sop-ops/AI_CAPABILITY_CONTROL_PLANE.md) | 统一 AI 能力控制平面规范 |
| [../ai-sop-ops/CODEX_CLI.md](../ai-sop-ops/CODEX_CLI.md) | Codex CLI、AGENTS.md 与 hooks 集成规范 |
