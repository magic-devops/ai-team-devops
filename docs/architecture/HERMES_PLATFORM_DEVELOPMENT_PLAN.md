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

- 数据源管理支持 OceanBase、StarRocks、Hologres、Greenplum、OpenSearch、Spark、Flink、Flink CDC、Paimon、Lance；第一版独立 `#/data/sources` 工作台已覆盖连接目录、SecretRef、连接测试、元数据预览和同步到数据接入 Schema Registry。
- 数据开发覆盖采集、建模、指标、标签、质量、血缘、发布、监控。
- 多模态数据资产支持文档、图片、日志、代码、指标、向量索引。

### 4.2 指标/标签/问数

- 指标中心支持口径治理、负责人、版本、血缘、订阅、影响分析。
- 标签中心支持标签开发、画像、本体论、规则与模型共建。
- 智能问数支持 NLQ、LLM Gateway 优先调用、规则指标引擎兜底、引擎/置信度/降级原因可解释、报表生成、归因分析、报告转任务。

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
- P0-4 已完成源码扫描增强：SystemMap 三码隔离新增 `/isolation-audit/scan`、`/isolation-audit/scan/runs`、`/isolation-audit/scan/runs/compare`、`/isolation-audit/scan/runs/compare/tasks`、`/isolation-audit/scan/tasks`、`/governance-tasks` 与 `/governance-tasks/bulk-update`，扫描文件型 Router 的 `attach_scope`、`scope_matches` 与三码字段信号，并可通过前端、SDK、CLI 保存扫描快照、读取历史、智能对比基线、预览/生成源码加固任务、对比治理任务和 scoped 批量处置治理任务；模块治理菜单已拆成注册、Manifest、能力、完整度、三码隔离、源码扫描、基线对比、治理任务化等独立单元，治理任务运营看板统一追踪各专业治理单元生成的真实任务并支持按后端契约批量更新状态、优先级和负责人。
- IA-7 已完成菜单健康收口：A2A 工作台、注册表、能力协商、SLA、执行窗口、任务分发和执行证据等 focused 路由补齐 zh-CN/en-US/ja-JP 顶级导航文案，`/api/v1/system/pages/health` 达到 100/excellent 且 `missing_i18n`、`missing_sub_i18n` 清零。
- P1-1 已完成第一版：任务质量卡点中心支持策略配置、单任务质量预览、结构化评估、Agent report 自动评估与阻断回写，CLI/SDK 增加 `gates`、`evaluate` 调用。
- System Ops 灰度发布策略已完成第一版：`/api/v1/system/ops/deployment-canary-policies` 支持基于不可变部署包创建流量阶梯、指标阈值、观察窗口和自动推进配置，`start/advance/pause/resume/rollback/complete` 状态机按错误率与 P95 延迟执行指标卡点，完成后联动创建受控部署流水线并回写部署包 `canary_*` 元数据；Settings 环境 Profile 模块新增独立灰度发布策略工作区，支持创建策略、推进/回滚/完成、查看 gate 和事件证据。
- Enterprise SSO 风险订阅策略已完成第一版：`/api/v1/sso/providers/{provider}/risk-subscription` 支持启停、通道、最低风险等级、风险分阈值、频率、负责人、简报标题和低风险纳入配置；`/risk-subscription/test` 支持 dry-run 预览、强制发送、阈值触发、实际投递、历史留痕和 `last_sent_at` 回写；Settings 企业 SSO 模块新增独立订阅策略单元，形成风险报表、治理任务化、IM 通知和订阅运营的完整闭环。
- System Ops 发布回滚演练已完成第一版：`/api/v1/system/ops/deployment-rollback-drills` 支持基于不可变部署包创建回滚演练、dry-run 回滚预览流水线、稳定检查项、事件留痕和 `start/pass_check/fail_check/create_rollback_pipeline/complete/cancel` 状态机；完成前必须检查项全部通过，完成时可联动创建真实 rollback 流水线；Settings 环境 Profile 模块新增独立发布回滚演练单元，支持场景配置、检查项推进、风险阻断、演练完成和证据查看。
- System Ops 灰度 IM 风险通知已完成第一版：`/api/v1/system/ops/deployment-canary-policies/{policy_id}/im-briefing` 复用 Notify 通道与 `im_integration_core`，基于灰度状态、当前流量、指标 gate、阻断/回滚风险生成企业 IM 简报，支持 dry-run 预览、按 `canary_risk` 事件匹配通道、手选通道、实际发送和审计留痕；Settings 灰度策略详情新增独立 IM 风险通知区，可选择通道、配置标题/风险条数、预览目标通道并发送 IM。
- Task 41 Enterprise SSO 风险自动升级已完成第一版：`/api/v1/sso/providers/{provider}/risk-escalation` 与 `/risk-escalation/run` 支持启停、最低风险等级、风险分阈值、冷却窗口、任务/IM 动作编排、负责人、优先级、工具、通道和备注配置；运行时复用风险报表、治理任务化、Notify IM 投递计划和审计链，支持 dry-run 预览、force 绕过、冷却阻断、实际创建任务/发送 IM、`last_run_at/last_triggered_at` 回写和升级历史；Settings 企业 SSO 模块新增独立自动升级单元，可保存策略、预览升级、执行升级、查看动作结果和历史。
- Task 42 System Ops 发布回滚 Runbook 自动化已完成第一版：`/api/v1/system/ops/deployment-rollback-runbooks`、详情与 action 接口支持基于不可变部署包、可选回滚演练和流水线命令生成结构化回滚 Runbook；Runbook 步骤包含负责人、命令/API、证据、状态和 Agent consumption，支持 dry-run 回滚流水线预览、任务预览/落库、真实 rollback 流水线创建、就绪标记和归档；Settings 环境 Profile 模块新增独立 Runbook 自动化单元，可选择部署包、关联演练、配置触发原因/负责人/任务优先级/执行工具，生成 Runbook、预览治理任务、创建任务和创建真实回滚流水线。
- Task 43 System Ops 灰度指标源自动采集已完成第一版：`/api/v1/system/ops/deployment-canary-metric-sources`、详情与 `/deployment-canary-policies/{policy_id}/metric-collection` 支持 Prometheus/Grafana/Datadog 协议型来源以及 manual/synthetic 本地兜底，按配置采集错误率与 P95 延迟并生成 gate 结果；采集可 dry-run 预览，也可写入灰度策略 gate、失败阻断、通过后自动 start/advance；Settings 灰度策略详情新增独立指标源自动采集单元，可配置指标源类型、endpoint、查询语句、观测窗口、标签和兜底样本，支持保存来源、采集预览、应用 gate、采集并推进、查看最近样本和 gate 结果。
- Task 44 System Ops 跨环境执行审计已完成第一版：`/api/v1/system/ops/deployment-execution-audits`、详情与 `/tasks` 接口把部署包、流水线、灰度策略、回滚演练、回滚 Runbook、变更单和执行证据统一成跨环境发布审计记录；自动计算证据覆盖、必填缺口、风险分与风险等级，并可将失败/阻断状态、缺失证据和关注项预览或生成治理任务；Settings 环境 Profile 模块新增独立跨环境执行审计单元，可关联发布对象、记录执行状态/风险/证据、查看证据矩阵和最近审计记录，并一键任务化缺口。
- Task 45 Enterprise SSO 风险处置 Runbook 已完成第一版：`/api/v1/sso/providers/{provider}/risk-runbooks`、详情与 action 接口支持从 SSO 风险报表生成结构化处置步骤，串联风险快照、治理任务预览/落库、Notify IM 预览/发送、配置验证、步骤完成/失败和证据归档；Settings 企业 SSO 模块新增独立风险处置 Runbook 单元，可配置负责人、优先级、执行工具、通知通道和备注，查看最近 Runbook、步骤进度、任务数、风险分和处置事件。
- Task 46 System Ops 真实执行器增强已完成第一版：`/api/v1/system/ops/deployment-pipeline-executors` 与 `/deployment-pipelines/{run_id}/execute` 为一键部署流水线补齐受控执行器目录、dry-run 执行计划、本地非 shell 安全命令执行、超时、apply 开关、阶段状态回写、execution 记录和审计事件；Settings 一键部署流水线详情新增真实执行器单元，可选择执行器、命令、阶段、证据链接和执行说明，支持执行计划与受控运行。
- Task 47 System Ops 流水线自愈诊断已完成第一版：`/api/v1/system/ops/deployment-pipelines/{run_id}/remediation` 基于流水线状态、失败阶段、执行器失败/阻断和证据缺口自动生成自愈发现、Runbook 步骤和治理任务计划；支持 dry-run 预览、低风险纳入、优先级/负责人/执行工具配置、真实任务落库、事件与审计留痕；Settings 一键部署流水线详情新增独立自愈诊断单元，可预览诊断、查看发现和 Runbook，并一键生成治理任务。
- Task 48 System Ops 分布式执行目标已完成第一版：`/api/v1/system/ops/deployment-executor-targets`、`PUT /deployment-executor-targets/{target_id}` 与 `/action` 为一键部署流水线补齐 Webhook、GitHub Actions、GitLab CI、Jenkins、Kubernetes Job、Temporal Workflow 和远程 Agent 执行目标注册表；支持按 Profile 过滤、能力动作声明、密钥引用、并发/超时配置、配置检查、启停删除和审计留痕；流水线执行器目录自动合并目标，选择外部目标执行时生成 `queued` 外部编排请求、保留 apply 双开关和阶段运行态；Settings 真实执行器单元新增分布式执行目标管理区，可保存/测试/启停/删除目标并一键选为流水线执行器。
- Task 49 System Ops 外部执行回调状态同步已完成第一版：`/api/v1/system/ops/deployment-pipelines/{run_id}/executions/{execution_id}/callback` 支持外部编排器或远程 Agent 将 queued/running 执行记录回写为 running/succeeded/failed/blocked/cancelled；回调会更新 execution、external_request、外部运行 ID、证据链接、stdout/stderr、exit_code、阶段状态、流水线终态、审计事件和审计链；Settings 真实执行器单元新增外部执行回调区，可选择执行记录、登记外部运行 ID/证据/输出/元数据并同步状态，形成排队到终态的完整闭环。
- Task 50 System Ops 外部执行回调签名治理已完成第一版：分布式执行目标新增 `callback_secret_ref`、`require_callback_signature` 与 `callback_skew_seconds` 配置，外部编排请求带回调签名契约；回调入口按 HMAC-SHA256、timestamp、nonce 和时间窗校验，密钥仅通过 `env://SOP_DEPLOY_CALLBACK_SECRET` 等引用解析，不保存明文；Settings 分布式执行目标与外部回调区新增签名策略、时间窗、timestamp/nonce/signature 输入和目标卡片签名状态展示，支撑 Webhook、Temporal、CI/CD 与远程 Agent 安全回写。
- Task 51 OpsCenter 智能根因归因已完成第一版：`/api/v1/ops-center/rca/insights` 聚合 Trace 根因导航、数据质量告警、计费提醒、失败流水线和未关闭 RCA，输出根因候选、置信度、证据、建议动作和 Agent consumption；`/api/v1/ops-center/rca/insights/tasks` 可将候选根因 dry-run 预览或创建 `source=ops_center_rca_insight` 治理任务；OpsCenter 根因分析模块新增独立“智能根因归因”工作区，支持 run_id/trace_id/correlation_id 检索、多源告警摘要、候选根因证据查看和任务预览/落库。
- Task 52 OpsCenter RCA 自动入库与 Runbook 推荐已完成第一版：智能归因候选改为稳定 ID，按候选标题、根因、证据、建议动作与 Runbook 名称/标签/步骤做关键词匹配，返回推荐 Runbook、匹配分和命中词；新增 `/api/v1/ops-center/rca/insights/rca`，可从候选一键生成 `source=ops_center_rca_insight` RCA，持久化严重级别、置信度、证据、推荐/选中 Runbook、owner 和来源候选；OpsCenter 前端候选卡片展示推荐 Runbook、支持生成 RCA，并在 RCA 列表展示智能归因来源、置信度和绑定 Runbook。
- Task 53 OpsCenter RCA 自动验证闭环已完成第一版：新增 `/api/v1/ops-center/rca/{id}/verification-plan` 与 `/api/v1/ops-center/rca/{id}/verify`，按根因、处置方案、验证证据、服务健康、关联流水线恢复和 Runbook 绑定/执行状态生成关闭前检查清单；验证结果写入 RCA `verification_history`、`verification_status`、`verification_score`，满足通过条件时自动关闭 RCA；OpsCenter 根因分析模块新增验证计划、验证并关闭、最近验证状态和检查项展示，形成“归因 - 沉淀 - 验证 - 关闭”的复盘闭环。
- Task 54 OpsCenter 生产告警源适配已完成第一版：新增 `/api/v1/ops-center/alert-sources`、`/alert-sources/{id}/test`、`/alert-sources/{id}/toggle`、`/alert-sources/sync` 与 `/alerts`，支持 Prometheus、Grafana、Datadog、Webhook、通用 JSON 和 manual 源配置；密钥仅允许 `env://`、`vault://`、`secret://` 引用，Endpoint 限制 http/https；采集结果标准化为 Ops Alert 并持久化同步历史，自动进入 RCA 智能归因；OpsCenter 前端新增独立“告警源”工作区，支持配置、测试、启停、同步、查看最近告警和同步结果。
- Task 55 OpsCenter Runbook 版本治理已完成第一版：Runbook 创建和更新会自动生成不可变版本快照，新增 `/api/v1/ops-center/runbooks/{id}/versions`、`/versions/diff` 与 `/versions/{version_id}/action`，支持版本列表、差异对比、历史版本恢复、非激活版本归档和治理审计事件；OpsCenter 前端 Runbook 模块升级为版本治理工作台，展示版本健康、激活版本、checksum、变更说明、差异和恢复/归档操作，支撑 RCA 与自愈策略消费稳定 Runbook 版本。
- Task 56 OpsCenter 告警降噪策略已完成第一版：新增 `/api/v1/ops-center/alert-noise/policies`、`/alert-noise/evaluate`、`/alert-noise/evaluations` 与 `/alert-noise/silences`，支持按标签分组、重复告警折叠、低优先级抑制、维护静默和评估历史；RCA 智能归因读取降噪后的可行动告警，避免低价值告警直接制造 RCA 噪声；OpsCenter 告警源模块新增降噪策略工作台，可配置策略、静默、预览/应用评估、查看可行动组和降噪率。
- Task 57 OpsCenter Runbook 执行证据自动回填已完成第一版：新增 `/api/v1/ops-center/runbooks/evidence`、`/runbooks/evidence/backfill` 与 `/runbooks/evidence/{record_id}/action`，可从 RCA 验证历史、自愈 guarded action 和关联流水线恢复记录自动生成 Runbook 执行证据，计算覆盖率、必填缺口、来源链路和建议动作；OpsCenter Runbook 模块新增执行证据面板，支持选中 Runbook 自动回填、查看缺口、确认、归档和重新打开。
- Task 58 OpsCenter 告警策略智能推荐已完成第一版：新增 `/api/v1/ops-center/alert-noise/recommendations` 与 `/alert-noise/recommendations/{recommendation_id}/action`，基于开放告警、重复分组、降噪率、低优先级噪声和历史健康分生成策略/静默推荐，支持持久化、应用、忽略和重新打开；应用时复用现有降噪 policy 与 silence 模型，OpsCenter 告警源模块新增策略智能推荐面板，展示推荐原因、影响、置信度、可应用动作和最近保存结果。
- Task 59 OpsCenter 告警策略效果 A/B 对比与跨源 SLO 预测已完成第一版：新增 `/api/v1/ops-center/alert-noise/strategy-compare`、`/strategy-compare/runs`、`/slo-prediction` 与 `/slo-prediction/runs`，可对当前策略、表单候选和严格高危策略在同一批开放告警上做效果对比，输出赢家、健康分差值、可行动 RCA 变化和降噪率；跨源 SLO 预测按告警源/服务聚合高危告警、采集失败和降噪效果，输出预测 SLO 分、违约概率、风险等级和建议动作；OpsCenter 告警源模块新增 A/B 对比与 SLO 预测独立单元，并联动运行历史与 summary。
- Task 60 OpsCenter 告警 SLO 自动升级已完成第一版：新增 `/api/v1/ops-center/alert-noise/slo-escalation-policy`、`/slo-escalation/run` 与 `/slo-escalation/runs`，支持配置最低风险等级、违约概率阈值、最大升级对象、动作集、IM 通道和负责人；运行时复用跨源 SLO 预测，dry-run 可预览升级对象、任务和 IM 投递计划，真实执行会生成 `source=ops_center_alert_slo_escalation` 治理任务并记录 IM 发送结果；OpsCenter 告警源模块新增“告警 SLO 自动升级”独立单元，支持保存策略、预览升级、执行升级、查看最近升级和任务/IM 结果。
- Task 61 OpsCenter 策略灰度应用审计已完成第一版：新增 `/api/v1/ops-center/alert-noise/strategy-canary/audit`、`/strategy-canary/audits` 与 `/strategy-canary/audits/{audit_id}/action`，将策略 A/B 对比、跨源 SLO 风险、自动升级历史和策略目录合并为灰度准入评分、ready/needs_review/blocked 决策、护栏和回滚触发；审计记录支持批准、启动灰度、回滚、归档、拒绝和重新打开状态流；OpsCenter 告警源模块新增“策略灰度应用审计”独立单元，支持选择策略/候选、刷新输入、生成审计、查看证据和执行状态操作。
- Task 62 数据智能决策归因引擎已完成第一版：新增 `/api/v1/analytics/decision/overview`、`/decision/explain` 与 `/decision/tasks`，将洞察报告、归因驱动、高风险报告、证据、建议动作和 Agent consumption 统一成可解释决策 packet；支持按问题解释、报告筛选、证据开关、任务优先级/负责人/执行工具/数量配置，以及 `source=analytics_decision_attribution` 治理任务预览或落库；Analytics 洞察报告工作台新增独立“智能决策归因引擎”单元，避免只在报告运营里堆控件。
- Task 63 OpsCenter 跨模块运维策略联动已完成第一版：新增 `/api/v1/ops-center/strategy-linkage/runs` 与 `/strategy-linkage/run`，把策略灰度审计、SLO 自动升级、RCA、Runbook、自愈、发布流水线、任务中心和 Notify IM 简报串成可执行联动包；支持 dry-run 预览、真实执行落库、`source=ops_center_strategy_linkage` 治理任务生成、IM 投递计划和运行历史 summary；OpsCenter 告警源模块新增独立“跨模块运维策略联动”单元，支持优先级、负责人、执行工具、最大项数、动作集和通道配置，避免运维智能能力停留在单模块孤岛。
- Task 64 LLM Gateway Prompt 审计闭环已完成第一版：新增 `/api/v1/llm-gateway/prompt-audit/runs`、`/prompt-audit/run` 与 `/prompt-audit/tasks`，在模型调用前检测明文密钥、Bearer Token、PII、提示词注入、上下文过长和代码上下文结构化风险；审计只保存 prompt hash 与脱敏预览，不落库原文，并可生成 `source=llm_gateway_prompt_audit` 治理任务；模型网关前端新增独立“Prompt 审计”单元，支持任务类型、模型、调用角色、最大 token、PII/Secret 策略、负责人和执行工具配置，展示决策评分、风险发现、脱敏预览、任务化结果和审计历史。
- Task 65 Notify 报告订阅运行闭环已完成第一版：新增 `/api/v1/notify/report-subscriptions/runs` 与 `/report-subscriptions/run`，把报告订阅配置升级为可执行运行中心；支持报告类型、周期、通道筛选，dry-run 预览、force 纳入停用订阅、IM 简报摘要、通道投递计划、真实发送和运行历史留痕；Notify 前端新增独立“订阅运行中心”模块和 `#/notify/subscription-runs` 菜单入口，避免订阅配置与执行记录堆在同一页面。
- Task 66 LLM Gateway 跨 Provider 成本归因已完成第一版：新增 `/api/v1/llm-gateway/cost-attribution/runs`、`/cost-attribution/run` 与 `/cost-attribution/tasks`，按 Provider、模型、任务类型和调用来源聚合真实 usage ledger 成本，输出预算占比、集中度、高均价模型和 Agent consumption；支持 dry-run 预览、持久化运行历史和 `source=llm_gateway_cost_attribution` 治理任务生成；模型网关前端新增独立“成本归因”模块与 `#/ai/llm-gateway/attribution` 子路由，system/pages、导航和三语种文案同步登记。
- Task 67 LLM Gateway 模型评测闭环已完成第一版：新增 `/api/v1/llm-gateway/model-evals/runs`、`/model-evals/run` 与 `/model-evals/tasks`，支持候选模型、评测用例、期望关键词、实际输出、通过阈值、成本预算和延迟 SLO 配置；评测综合质量、Prompt 安全、Provider 健康、限流、成本效率与延迟评分输出模型排名、阻断用例、风险发现和 Agent consumption，并可生成 `source=llm_gateway_model_eval` 治理任务；模型网关前端新增独立“模型评测”模块与 `#/ai/llm-gateway/eval` 子路由，支撑模型路由和 fallback 的可复用评测依据。
- Task 68 数据源管理独立核心模块已完成第一版：新增 `/api/v1/db-config/connections/summary`、`/connections/{name}/metadata-preview` 与 `/connections/{name}/metadata-sync`，在不保存明文密码/连接串的前提下维护连接元数据、SecretRef、能力声明、健康分和元数据发现结果；metadata-sync 可创建/更新 Data Ingest 连接器并注册 Schema Registry。前端新增 `#/data/sources` 独立工作台，原 `#/intelligence/datasources` 保留兼容入口，system/pages、导航和 legacy db-config target 同步迁移。
- Task 69 元数据管理独立核心模块已完成第一版：新增 `/api/v1/metadata/summary`、`/assets`、`/fields`、`/lineage`、`/lineage/impact` 与 `/assets/{asset_id}/classify`，聚合 Analytics 资产治理、Data Ingest Schema Registry 和血缘图谱，支持资产/字段检索、敏感字段候选、分类治理、质量规则绑定、血缘影响和 Agent consumption。前端新增 `#/data/metadata` 独立工作台，并拆分 `#/data/metadata/overview`、`assets`、`fields`、`lineage` 子路由，避免元数据能力堆在数据资产治理大页。
- Task 134 前端性能加载范围治理增强已完成第一版：`/api/v1/system/pages/frontend-performance` 新增 `load_scope`、`initial_oversize` 与 `deferred_oversize`，把首屏主壳、路由懒载和延迟图谱包分开治理；SystemMap 性能治理页展示首屏超预算、延迟超预算和加载范围列，治理任务描述标注首屏阻塞/低频延迟加载影响；全局 AI 命令面板拆为 `CommandPalette` 懒加载组件，保持 AI 优先入口但不把低频命令搜索逻辑塞进 App 主壳。真实构建通过，当前严格口径性能治理分为 78/watch，`initial_oversize=1`、`deferred_oversize=1`，后续继续拆主壳 `index` 与 AntV 图谱运行时。
- Task 135 移动端导航抽屉主壳拆分已完成第一版：`App.tsx` 内联移动端微应用导航抽屉抽离为 `components/MobileNavDrawer.tsx`，通过 `React.lazy/Suspense` 仅在 `mobileNavOpen` 时加载；保留移动端搜索、微应用菜单过滤、AI 命令入口、Copilot 快捷入口、高频动作和空状态，并用 `App.mobile-shell` 与 `AppPerformanceGovernance` 契约测试防止体验回退。真实构建生成独立 `MobileNavDrawer` chunk；性能严格口径保持 78/watch，说明后续主壳治理重点转向导航注册与共享依赖拆分。
- Task 136 App 主壳首屏性能收口已完成第一版：Vite 将 `src/navigation.tsx`、`src/microApps.ts` 拆为 `navigation-registry` chunk，并将页面级 `lib/api.ts` 固定为 `api-client` chunk；新增 `lib/http.ts` 与 `lib/appShellApi.ts`，让 App、ProjectSelector 和 CommandPalette 只加载认证、作用域、菜单偏好、项目/业务线、命令搜索等主壳必需接口，页面专用 API 继续留给懒加载工作台。System Pages 性能治理识别 `navigation-registry` 为首屏 shell，并补契约测试防止主壳重新导入大 API 聚合。真实构建通过，`index` 从约 650.9KB 降到 486.24KB raw，性能严格口径提升到 86/good，`initial_oversize=0`，剩余风险仅为延迟图谱 `antv-vendor`。
- Task 137 图谱运行时用户主动加载体验收口已完成第一版：`LineageGraph` 和 `WorkflowDag` 默认展示轻量血缘分列/步骤链视图，只有用户点击“打开交互图谱/DAG”时才加载 AntV G6 交互画布；保留 `engine="antv"` 显式入口兼容强制交互图谱。System Pages 性能治理新增 `user-activated-visualization` 加载范围与 `user_activated_oversize` 指标，AntV 大包不再计入 `deferred_oversize`，SystemMap 三语种文案同步展示“用户打开图谱”。真实构建通过，`initial_oversize=0`、`deferred_oversize=0`、`user_activated_oversize=1`，性能分保持 86/good，说明默认页面体验已避免自动加载低频大图谱库。
- Task 138 生产就绪缺口任务化闭环已完成第一版：Manager 新增 `POST /api/v1/system/pages/production-readiness/tasks`，按 domain/stage/q/ids 过滤生产就绪矩阵，将 contract/runtime 阶段的真实缺口幂等生成 `source=system_page_production_readiness` 治理任务，任务描述包含运行数据、外部连接、异步 Worker、测试覆盖、部署证据、可观测和权限策略各维度状态与建议；治理任务看板新增“生产就绪”来源。SystemMap 生产就绪矩阵新增“预览生产任务/生成生产任务”两个高频操作和结果摘要，复用当前筛选条件，不增加复杂表单；三语种文案和前后端契约测试同步补齐。真实 smoke 显示 contract_complete 阶段 40 个模块可预览任务，生产任务 API dry-run 正常返回计划任务。
- Task 139 SystemMap 模块契约中心精简化已完成第一版：将 Manifest、能力权限、模块动作从 `SystemMap.tsx` 三段重复大块抽离为 `SystemModuleContractPanel` 独立组件；`#/system-map/contract` 作为唯一主入口，旧 `#/system-map/manifest`、`#/system-map/capabilities`、`#/system-map/actions` 保留深链但在同一契约中心内切换视图。移动端使用卡片流，桌面端保留紧凑信息密度，模块动作预览/执行、权限矩阵、Agent consumption 与运行历史仍保持真实可用；新增模块契约测试和导航 IA 测试，生产构建通过。
- Task 140 Settings 外观主题子模块按需加载已完成第一版：将外观主题卡片、主题偏好状态、`sop-theme` 监听和主题切换动作抽离为 `settings/SettingsAppearancePanel` 独立组件；`Settings.tsx` 通过 `React.lazy/Suspense` 仅在外观子路由加载该模块，父页面不再直接维护低频外观状态。主题切换仍调用真实 `setThemePreference` 并保持移动端响应式卡片；新增 Settings UX 契约测试，生产构建生成独立 `SettingsAppearancePanel` chunk。
- Task 141 Settings 账户会话子模块按需加载已完成第一版：将账户会话、用户/租户/项目作用域、未选项目提示、会话错误态和登出按钮抽离为 `settings/SettingsAccountPanel` 独立组件；`Settings.tsx` 仅保留真实 `api.logout`、`clearSession`、query invalidation 和登录跳转编排，并通过 `React.lazy/Suspense` 在账户子路由按需加载。目标测试和生产构建通过，生成独立 `SettingsAccountPanel` chunk。
- Task 142 Settings 管理入口子模块按需加载已完成第一版：将组织权限、智能中枢、Vibe、编排、搜索与统一登录等管理入口卡片抽离为 `settings/SettingsWorkspacePanel` 独立组件；`Settings.tsx` 仅在管理入口子路由通过 `React.lazy/Suspense` 加载该模块，父页面继续瘦身。入口仍为真实深链/登录跳转，桌面端使用紧凑响应式网格，移动端自然堆叠；Settings UX 契约测试和生产构建已验证，生成独立 `SettingsWorkspacePanel` chunk。
- Task 143 Settings 运行观测子模块按需加载已完成第一版：将 health、metrics、events、trace root cause、日志筛选和日志文件侧栏抽离为 `settings/SettingsRuntimePanel` 独立组件；`Settings.tsx` 只保留真实查询、筛选状态和模块编排，并在运行状态/日志观测子路由按需加载。运行与观测入口仍直连 `/api/v1/health`、`/metrics`、`/api/v1/events`、`/api/v1/system/ops/observability`，日志和 Trace 筛选保持可操作；Settings UX 契约测试、TypeScript 和生产构建已验证，生成独立 `SettingsRuntimePanel` chunk。
- Task 144 Settings 生产存储子模块按需加载已完成第一版：将 OceanBase/文件型 store 迁移计划、目标库信息、核心表/三码字段/索引指标、迁移文件、备份恢复 checklist 和 smoke checks 抽离为 `settings/SettingsStoragePanel` 独立组件；`Settings.tsx` 只保留真实查询、smoke mutation、结果状态和模块编排，并在生产存储子路由按需加载。生产存储仍能刷新迁移计划、运行 smoke、查看迁移文件和备份恢复清单；Settings UX 契约测试、TypeScript 和生产构建已验证，生成独立 `SettingsStoragePanel` chunk。
- Task 145 Settings 商业计费子模块按需加载已完成第一版：将订阅套餐、超额策略、权益试算、经营指标、账单草稿、CSV 导出、账单历史、状态流转、审计记录、收款登记、收款历史和分步抽屉抽离为 `settings/SettingsBillingPanel` 独立组件；`Settings.tsx` 只保留真实查询、draft 状态、mutation 编排和模块编排，并在商业计费子路由按需加载。商业计费仍能应用套餐、保存超额策略、权益试算、生成账单快照、导出 CSV、更新发票状态、查看审计和登记收款；Settings UX 契约测试、TypeScript 和生产构建已验证，生成独立 `SettingsBillingPanel` chunk。
- Task 146 Settings 企业 SSO 子模块按需加载已完成第一版：将 SSO Provider 配置、OIDC/SAML 模板、密钥脱敏输入、SCIM Token 轮换与测试、角色映射预览、风险报表、风险任务化、IM 简报、风险订阅、自动升级、处置 Runbook、Runbook 步骤流转和 SCIM 审计抽离为 `settings/SettingsSsoPanel` 独立组件；`Settings.tsx` 只保留真实查询、draft 状态、mutation 编排和模块编排，并在企业 SSO 子路由按需加载。企业 SSO 仍能保存/测试 Provider、轮换 SCIM Token、预览角色映射、生成风险任务、发送 IM、运行订阅、执行自动升级、生成处置 Runbook 和维护审计证据；Settings UX 契约测试、TypeScript 和生产构建已验证，生成独立 `SettingsSsoPanel` chunk。
- Task 147 Settings 环境 Profile 与部署发布子模块按需加载已完成第一版：将环境 Profile 草稿/模板/列表、部署包、审批、灰度策略、灰度指标源、灰度 IM、回滚演练、回滚 Runbook、跨环境执行审计、一键部署流水线、真实执行器、分布式执行目标、外部执行回调和流水线自愈诊断抽离为 `settings/SettingsProfilesPanel` 独立组件；`Settings.tsx` 只保留真实查询、draft 状态、mutation 编排、派生选择 ID 和模块编排，并在环境 Profile 子路由按需加载。部署发布仍能创建部署包、申请审批、执行灰度、采集指标、发送 IM、创建回滚演练/Runbook、登记执行审计、预览/创建流水线、执行/回调外部目标和生成自愈任务；Settings UX 契约测试、TypeScript 和生产构建已验证，生成独立 `SettingsProfilesPanel` chunk。
- Task 148 OpsCenter 告警源治理子模块按需加载已完成第一版：将生产告警源配置、测试、同步、外部告警列表、降噪策略、静默规则、降噪评估、策略推荐、A/B 对比、跨源 SLO 预测、SLO 自动升级、策略灰度审计和跨模块运维策略联动抽离为 `system/ops-center/OpsCenterAlertSourcesPanel` 独立组件；`OpsCenterWorkbench.tsx` 只保留真实查询、状态、mutation、IM 通道选择和 tab 编排，并在告警源治理子路由通过 `React.lazy/Suspense` 按需加载。告警源治理仍能完成配置、密钥引用、降噪、SLO、灰度准入、审批动作、任务化和 IM 联动，父页面不再承载整块超长 JSX；OpsCenter UX 契约测试、TypeScript 和生产构建已验证，生成独立 `OpsCenterAlertSourcesPanel` chunk。
- Task 149 OpsCenter RCA 治理子模块按需加载已完成第一版：将手工 RCA 创建、智能根因归因、归因任务化、智能归因生成 RCA、RCA 验证计划、验证并关闭和 RCA 列表证据抽离为 `system/ops-center/OpsCenterRcaPanel` 独立组件；`OpsCenterWorkbench.tsx` 只保留真实查询、状态、mutation 和 tab 编排，并在 RCA 子路由通过 `React.lazy/Suspense` 按需加载。RCA 模块仍能执行分析、预览/创建任务、生成 RCA、查看验证计划和关闭 RCA，父页面继续向轻量运维中枢收敛；OpsCenter UX 契约测试、TypeScript 和生产构建已验证，生成独立 `OpsCenterRcaPanel` chunk。
- Task 150 OpsCenter Runbook 治理子模块按需加载已完成第一版：将 Runbook 版本治理、首版创建、编辑生成新版本、版本差异对比、历史恢复/归档、执行证据自动回填、证据确认/归档/重开和治理审计抽离为 `system/ops-center/OpsCenterRunbooksPanel` 独立组件；`OpsCenterWorkbench.tsx` 只保留真实查询、状态、mutation 和 tab 编排，并在 Runbook 子路由通过 `React.lazy/Suspense` 按需加载。Runbook 模块仍能创建版本、对比差异、回填证据和维护审计闭环，父页面进一步收敛为轻量运维中枢；OpsCenter UX 契约测试、TypeScript 和生产构建已验证，生成独立 `OpsCenterRunbooksPanel` chunk。
- Task 151 OpsCenter 自愈治理子模块按需加载已完成第一版：将自愈策略创建、信号评估、决策结果、治理任务预览/生成、策略启停/删除/手动应用、生产护栏动作队列、审批/应用/验证/回滚和审计载荷抽离为 `system/ops-center/OpsCenterSelfHealPanel` 独立组件；`OpsCenterWorkbench.tsx` 只保留真实查询、状态、mutation、选中动作派生和 tab 编排，并在自愈子路由通过 `React.lazy/Suspense` 按需加载。自愈模块仍能完成策略治理、信号评估、任务化和护栏动作处置闭环，父页面进一步收敛为轻量运维中枢；OpsCenter UX 契约测试、TypeScript 和生产构建已验证，生成 19.08KB raw/4.32KB gzip 的 `OpsCenterSelfHealPanel` 独立 chunk，`OpsCenterWorkbench` 主 chunk 降到 36.70KB raw/10.02KB gzip。
- Task 152 导航 IA 子路由真实聚焦与菜单多语言收口已完成第一版：为 Marketplace 目录/已安装/评分签名、洞察报告总览/资产/订阅/转任务、Audit 链/事件/动作/审批、AgentOps 运行/心跳/画像/重试、数据质量报告、指标语义/监控和标签 API 等入口补齐真实 `initialModule`、`initialView`、`initialTab`，并通过 `SUBMODULE_ROUTE_OVERRIDES` 让模块卡片快捷入口跳向已实现路由而不是默认拼接出来的假 hash。Marketplace 新增评分与签名治理视图，Audit 将动作运行与审批队列拆成独立子模块，AgentRuns 新增心跳监控和失败重试视图，数据质量和指标中心补齐质量报告与监控视图；CommandPalette 优先读取 `page.<key>.description`，MenuManagement 健康状态补齐三语种文案，避免中文环境仍露英文 fallback。导航 IA/i18n 契约测试、TypeScript 和生产构建已验证。
- Task 153 全域页面交互分析控制面已完成第一版：新增 `/api/v1/pages/interaction-analysis`，按指标摘要、筛选搜索、主工作区、操作闭环、AI 上下文、CLI 映射、权限反馈、审计证据、响应式密度、键盘与状态等标准对页面注册表进行静态契约评分，输出统一 payload、风险缺口、quick actions、CLI、权限和审计边界；SDK 增加 `pages_interaction_analysis`，CLI 增加 `sop pages interaction-analysis --domain --status --q --limit --json`，SystemMap 全域闭环页新增交互评分、风险摘要表和可复制分析命令；`ai-sop/custom/design/README.md` 同步沉淀工作台交互分析标准，后续页面迁移以该控制面作为快速分析入口，并继续用 browser smoke 补足键盘、响应式、加载空错态的视觉证据。
- Task 154 页面交互缺口任务化闭环已完成第一版：新增 `POST /api/v1/pages/interaction-analysis/tasks`，将交互分析的 watch/risk 模块按 `source=system_page_interaction` 与 `source_report_id=interaction:<module_id>` 幂等预览或生成治理任务，任务描述包含 interaction score、gap、check evidence、required closure 和 visual smoke 边界；SDK 增加 `pages_interaction_tasks`，CLI 增加 `sop pages interaction-tasks --dry-run/--create --json`；SystemMap 全域闭环页的交互分析卡片新增预览/生成任务按钮、权限禁用和结果摘要，形成“快速分析 - 风险定位 - 任务生成 - 任务中心追踪”的同屏闭环。
