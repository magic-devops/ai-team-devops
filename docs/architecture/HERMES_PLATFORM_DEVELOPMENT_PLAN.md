# Hermes 一栈式 AI 研发运维平台开发计划

> 目标：把“人管理需求与团队，AI/CLI/Agent 自主拆解、领取、开发、测试、部署、监控、优化”的闭环做成可商业化、可企业化、可扩展的一栈式平台。

## 1. 开发原则

1. 三码隔离优先：所有核心数据、任务、调度、知识、Agent 运行、数据资产都必须携带 `tenant_code`、`business_code`、`project_id`。
2. 能力先建模再开发：每个功能先沉淀为模块、子模块、动作、权限、审计、AI surfaces，再进入页面和 API。
3. AI 可读可执行：需求、任务、DAG、质量卡点、规约、知识、工具、MCP、A2A、运行反馈都要提供机器可消费接口。
4. 成熟技术优先：底层以 OceanBase 为主存，按场景接 StarRocks、Hologres、Greenplum、OpenSearch、Spark、Flink、Paimon、Lance 等。
5. Legacy 能力承接：历史 console 不作为兼容负担，但其业务能力要逐步迁入新平台模块，形成页面地图、迁移 Backlog、任务化、验收闭环。

## 2. P0：平台控制面地基

### 2.1 细粒度模块权限

- 后端能力目录输出模块、子模块、动作三级能力码。
- 前端统一 `useCapabilities` 展平模块/子模块/动作授权。
- 页面按钮、批量操作、AI 动作、调度动作按动作级能力码启停。
- 能力码格式统一为：`domain.module.submodule.action`。

验收标准：

- 同一角色在菜单、页面按钮、模块动作上的授权结果一致。
- SystemMap 能展示模块、子模块、动作与角色权限。
- 后续新模块只需注册能力目录即可接入权限控制。

### 2.2 统一租户/业务/项目上下文

- 前端顶栏和请求上下文支持当前租户、业务、项目切换。
- 后端 API 查询、写入、审计、事件、任务、Agent Feed 都注入三码。
- CLI/Agent 接入包输出三码上下文、鉴权配置和项目规约路径。

验收标准：

- 任务、需求、知识、数据资产、调度实例不跨租户/业务/项目泄露。
- Agent Feed 能按当前项目只拉取自己可执行的任务包。

### 2.3 审计与风险卡点

- 所有高风险动作进入模块动作运行记录、审计哈希链、事件流水。
- 高风险任务生成、部署、数据发布、模型配置、连接器配置支持审批阈值。
- Audit 页面提供运行证据、风险建议和审批队列。

验收标准：

- 每一次 AI/CLI/Agent 执行动作可追溯到操作者、上下文、输入、输出和审批结论。

## 3. P1：AI 自主开发闭环

### 3.1 智能需求到任务

- 需求池支持质量评审、相似合并、验收标准补全。
- 需求一键拆解任务，自动生成依赖、优先级、工具建议、Agent 建议。
- 需求状态与任务状态互相回写。

### 3.2 DAG 调度中心

- 调度计划支持 DAG 依赖、并发泳道、阻塞检测、事件唤醒、重试、取消、补偿。
- 质量卡点覆盖 spec 完整性、代码审查、测试、构建、部署、监控。
- Agent Feed 输出可执行任务包：上下文、规约、依赖、质量门、回报协议。

### 3.3 Agent/CLI 执行协议

- 标准动作：claim、heartbeat、report、artifact、block、handoff、finish。
- 支持 Codex、Claude、Cursor、Qoder、WorkBuddy、OpenClaw、Hermes Agent 快速接入。
- MCP/A2A 注册表支持工具发现、权限裁决、调用审计和失败重试。

验收标准：

- AI CLI 能从平台自主领取任务，按规约开发，并回传进度、产物、风险和质量结果。

## 4. P2：数据智能与知识治理

### 4.1 数据接入与开发

- 数据源管理支持 OceanBase、StarRocks、Hologres、Greenplum、OpenSearch、Spark、Flink、Flink CDC、Paimon、Lance。
- 数据开发覆盖采集、建模、指标、标签、质量、血缘、发布、监控。
- 多模态数据资产支持文档、图片、日志、代码、指标、向量索引。

### 4.2 指标/标签/问数

- 指标中心支持口径治理、负责人、版本、血缘、订阅、影响分析。
- 标签中心支持标签开发、画像、本体论、规则与模型共建。
- 智能问数支持 NLQ、报表生成、归因分析、报告转任务。

### 4.3 AI 知识库与记忆

- 项目知识、组织规范、个人/Agent 记忆、运行经验统一治理。
- RAG 检索结果可追溯来源、版本、权限和使用范围。
- 反思蒸馏进入规则提案和审核闭环。

验收标准：

- 数据问题能自动发现、告警、归因并转换为治理任务。
- AI 开发上下文能稳定引用需求、规约、知识、历史经验和数据洞察。

## 5. P3：通信集成与生态插件

- 企业微信、钉钉、飞书、Slack、邮件、Webhook 支持双向消息、审批、告警、任务创建。
- WorkBuddy、OpenClaw、Hermes Agent、MCP Server、A2A 专家组走统一连接器协议。
- Marketplace 支持插件安装、签名、评分、租户授权、版本升级、回滚。

验收标准：

- 外部消息可以进入平台成为需求/任务/告警。
- 平台任务、审批、报告、告警可以按策略分发到外部通信服务。

## 6. P4：企业级高可用与商业化

- 部署形态支持本地、SaaS、专有云、混合云。
- 支持 SSO、组织架构同步、RBAC/ABAC、密钥托管、审计导出、数据脱敏。
- 监控覆盖 API、队列、调度、Agent、模型、数据任务、连接器、成本与配额。
- 商业化支持套餐、用量、发票、付款、租户配额和经营报表。

验收标准：

- 单租户故障不影响其他租户。
- 核心链路具备可观测、可限流、可降级、可恢复能力。

## 7. 当前迭代任务

| 优先级 | 任务 | 前端 | 后端 | 验收 |
|---|---|---|---|---|
| P0-1 | 细粒度能力与动作权限 | `useCapabilities`、SystemMap 动作按钮 | `system/pages/capabilities` 子能力目录 | 按子模块/动作授权展示和禁用 |
| P0-2 | 三码上下文控制条 | 顶栏切换器、请求注入 | API 查询与写入注入三码 | 数据不串租户/业务/项目 |
| P0-3 | Agent Feed 强化 | Tasks 调度中心任务包预览 | claim/feed/report 协议增强 | AI CLI 可自主领取和回报 |
| P1-1 | 质量卡点中心 | 任务详情质量门展示 | spec/test/build/deploy gate | 未过卡点不可自动推进 |
| P1-2 | 通信连接器第一批 | Notify 通道配置升级 | 微信/钉钉/Webhook 适配层 | 入站转需求/任务，出站告警 |
| P2-1 | 数据智能资产目录 | 数据资产/指标/标签菜单 | 数据源、资产、血缘 API | 数据资产可检索、可治理 |

## 8. 下一步开发顺序

1. ~~P0-1～P0-3、P1-1～P1-2、P2-1～P2-17~~（见 §9 已启动记录）。
2. **IA-1～IA-2**：菜单 Pinned/面包屑/子路由 focused（见 [HERMES_PRODUCT_IA_MENU_SPEC.md](HERMES_PRODUCT_IA_MENU_SPEC.md)）。
3. **P1-3**：Workflows/Notify/Intelligence 子路由驱动 UI 分区（与 Requirements/Tasks 对齐）。
4. **P2-18**：CLI `sop pages` 写入 context prepare 产物，Agent 按 manifest 自动选模块开发。
5. **H3**：Agent 运行中心（run 表、画像、负载、成功率）。
6. **H4～H7**：数据质量中心、指标/标签服务、企业安全商业化、自愈运维。

## 8.1 产品菜单与 CLI 协同迭代

| ID | 任务 | 前端 | 后端/CLI | 验收 |
|----|------|------|----------|------|
| IA-1 | Pinned 快捷区、域色条、面包屑 | App.tsx、index.css | — | 首屏可见驾驶舱/需求/任务/Copilot |
| IA-2 | 子路由 focused 模式 | Requirements、Workflows… | pages validate 检查假菜单 | 点击子菜单进入对应分区 |
| IA-3 | 最近访问 + 角色默认折叠 | localStorage、角色模板 | capabilities 默认折叠策略 | 重域默认收起 |
| CLI-1 | context prepare 写入 pages manifest | — | context_api + sop context | Agent 可读模块边界 |
| CLI-2 | 多项目 manifest 清单 | — | sop context manifest | monorepo 多 project 接入 |

## 9. 已启动实现记录

- P0-1 已完成第一版：模块/子模块/动作能力码进入前端统一 Hook，并接入模块治理动作。
- P0-2 已完成第一版：前端顶栏升级为租户/业务/项目工作区选择器，统一注入 `X-Tenant-Code`、`X-Business-Code`、`X-Project-Id`、`X-Project-Code`，后端项目/业务/上下文接口返回标准 code 字段。
- P0-3 已完成第一版：任务调度中心支持 Agent 任务包领取租约、心跳续约、执行报告关闭租约，CLI/SDK 增加 `claim`、`heartbeat`、`claims` 调用，前端调度中心展示活跃 Agent 租约。
- P1-1 已完成第一版：任务质量卡点中心支持策略配置、单任务质量预览、结构化评估、Agent report 自动评估与阻断回写，CLI/SDK 增加 `gates`、`evaluate` 调用。
