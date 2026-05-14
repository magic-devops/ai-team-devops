# 路线图

> 详细架构演进见 [`docs/architecture/EVOLUTION.md`](docs/architecture/EVOLUTION.md)
> v2 总体架构见 [`docs/architecture/OVERVIEW.md`](docs/architecture/OVERVIEW.md)

## ✅ v1.0 — 已完成

- 多 Agent 协作规范（Orchestrator/Planner/Worker/Reviewer）
- Hermes 增强（CoT 推理、自我反思、置信度自评）
- LanceDB 语义记忆（任务/规则/知识库）
- Web 管理后台（需求/任务/问题/Sprint/搜索）
- 多工具支持（Codex CLI/Claude Code/opencode/Cursor/Trae/Windsurf）
- 完整规范库（Java/前端/数据库/安全/CI-CD/测试）
- A2A 协议集成、MCP Server
- 自我进化机制（规则提取 + 知识蒸馏）

## ✅ v1.1 — 已完成

- Web 后台模块化（27个页面，routers/ + pages/ 独立文件）
- 模型管理（多模型配置、角色模型指定）
- Agent 编排（工作流定义、工具选择、版本管理）
- Docker 环境管理（环境检查、预设组件一键启动）
- 技能仓库（Git 仓库同步、安装/卸载/版本管理）
- Vibe Coding（界面化调用 codex/claude/opencode/aider）
- 消息通知（钉钉/企业微信/Slack Webhook）
- CLI 工具管理（Codex CLI/openclaw/workbuddy/Hermes-agent 封装）
- Codex hooks 完整集成 + API 版本化（`/api/v1/`）
- P9 模块化单元化约定

## 🚧 v2.0-dev — 进行中（2026 H1）

### ✅ 已落地（本仓库当前状态）

- **M1 目录骨架**：`apps/manager`、`apps/agent-runtime`、`packages/sop-cli`、`packages/sop-sdk-python`、`apis/`、`plugins/`、`docs/architecture/` 全部就位
- **M1 兼容外壳**：`apps/manager` 透传 `sop/web/`；新增 Dockerfile / Compose（single + saas）
- **M1 架构文档**（7 份）：OVERVIEW / MODULES / AI_FIRST / PROTOCOLS / SECURITY / DEPLOY / EVOLUTION
- **M2 Schema-First**：OpenAPI 3.1（`apis/openapi/openapi.yaml`）+ gRPC proto + AsyncAPI 3 + buf 配置
- **M3 统一 CLI** `sop`：init / login / status / agentd / task / rule / sync / doctor / llm
- **M3 项目 SDK** `sop-sdk`：HTTP 客户端 + HMAC/Bearer 鉴权 + keyring 解析 + 本地 agentd IPC
- **M4 sop-agentd Go 骨架**：心跳 + outbox（SQLite WAL）+ DLQ + HMAC 签名 HTTP + Unix socket IPC
- **M5 LLM Gateway**：`/api/v1/llm/{chat,embeddings,models,routing,health}`，Anthropic/OpenAI/Ollama 多 Provider，提示缓存，Fallback，按 task_type 自动路由
- **M5 RAG 流水线**：`/api/v1/rag/{search,index,health}`，VectorStore 抽象 + Lance/Qdrant adapter + chunk + hybrid 检索
- **M7 可观测**：`/metrics`（Prometheus）+ 指标中间件 + LLM 调用结构化日志
- **M9 协议**：`/ws/events`（WebSocket 推送，CloudEvents 1.0）+ `/api/v1/events:ingest`（agentd outbox 终点）
- **M10 安全**：HMAC + ts + nonce 服务端中间件（默认宽松，`SOP_HMAC_ENFORCE=1` 强制）
- **M11 Copilot**：`/api/v1/copilot/{ask,classify,summarize,suggest}` — ⌘K 命令面板 / 自动分类 / 周报摘要 / 行动建议
- **M11 插件系统**：基于 Python `entry_points` 的 `sop.plugins` 加载器（routers + lifecycle）
- **新 MCP server**：`sop.tasks` / `sop.llm` 与已有 `sop.lancedb` 协同
- **工具脚本同步**：`bootstrap-dev.sh`（一键 v2 环境）/ `init-ai-project.sh` 新增 agent.toml + mcp.json / `health-check.sh` 覆盖新端点 / `manager_client.py` 走 SDK + 升级签名为 ts+nonce 模式
- **M6 治理框架**：`docs/architecture/REFACTOR_PLAN.md` + `routers/env/` 子包（新增功能落点）+ `docker_env.py` 顶部 @ai_safe_edit 拆分指引
- **M7 进阶**：`routers/observability.py`（OTel Trace/Metric/Log + 结构化 JSON 日志 + traceparent header）
- **M7 审计链**：`routers/audit_chain.py`（SHA-256 哈希链 + 日级 anchor + `/verify`）
- **M8 工作流**：`routers/workflow.py`（Engine 抽象，内存退化 + Temporal 适配器；内置 Sprint/Review/Bug 三个长流程）
- **M10 列加密**：`routers/crypto_box.py`（AES-256-GCM + KEK 抽象：env/file/AWS-KMS + token 化 + lookup hash）
- **M10 Key 轮换**：`routers/key_rotation.py`（create/list/rotate/revoke/expiring/_cron/expire）
- **M10 WORM**：`routers/audit_worm.py`（本地 append-only + chattr +a + S3 Object Lock 后端）
- **M11 市场**：`routers/marketplace.py`（多 registry 索引 + 签名校验安装 + 评分聚合）
- **M11 反思蒸馏**：`routers/reflection_distill.py`（按 category 分组 → LLM 提案规则 → 阈值自动入库）
- **M12 SSO**：`routers/sso.py`（OIDC PKCE + JIT provisioning + 多 IdP + SAML 元数据 + Casbin ABAC + fallback ABAC）
- **M12 新前端**：`apps/web-next`（Vite + React 18 + TS + Tailwind + i18next 中/英/日 + TanStack Query；8 个页面：驾驶舱/项目/任务/工作流/市场/审计/Copilot/设置）
- **生产编排**：`docker-compose.saas.yml` 增加 Prometheus + Grafana + Loki + Tempo + Temporal + Temporal-UI（按 profile 启停）

### 🚀 剩余里程碑

- **M6 切薄第二阶段**：执行 `docker_env.py` 6 文件物理拆分（按 `REFACTOR_PLAN.md` 表格）；`orchestration.py` / `vibe.py` 同步
- **M7 链路深化**：自动注入 trace context 到 LLM 调用；Tempo dashboards
- **M8 真正部署 Temporal**：把 docker-compose `workflow` profile 实测；把内置 Sprint/Review/Bug 流改写为 Temporal `@workflow.defn` 类
- **M9 MCP Hub**：内置 `sop.workflows` / `sop.marketplace` / `sop.audit` MCP server
- **M11 蒸馏闭环**：定时任务调 `/api/v1/reflections/distill?dry_run=false`；UI 显示待审核提案
- **M12 SSO 实战**：联通 Okta / Azure AD / Auth0 至少 1 家做 E2E；前端登录页对接
- **M12 SAML 完整**：装 `python3-saml` 并实现签名验证

## 🔮 v3.0 — 远期（2027 H2）

- v1 deprecated 接口全部下线
- 旧 Babel-standalone 前端退役
- gRPC 默认开启
- 规范自动生成（代码库逆向）
- 跨团队规范共享市场（联邦）
- AI 规范合规自动检测
- 深度集成 Jira / Linear / GitHub Issues / Notion

## 参与贡献

欢迎认领任何 **🚀 剩余里程碑** 或 **🔮 远期** 的功能！在 [Issues](https://github.com/magic-devops/ai-team-devops/issues) 中留言。

**联系作者**：superhero · zyc2012518@gmail.com · 微信: super_hero_88
