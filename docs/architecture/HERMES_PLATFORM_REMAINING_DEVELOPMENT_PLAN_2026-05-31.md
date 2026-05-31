# Hermes 平台剩余功能补全与前端优化开发计划

> 日期：2026-05-31
> 范围：Hermes Manager / Manager Web / Manager Worker / SystemMap 治理闭环
> 原则：体验交互好用优先，成熟组件使用优先，功能逐一完整实现并可验证。

## 1. 当前结论

当前平台已经不是页面和接口空白阶段。`/api/v1/system/pages/readiness` 已能证明 React 页面、API 契约、能力码、AI surface 与菜单治理的大部分注册完整；三码隔离审计也具备高分基线。后续重点不再是堆页面数量，而是把契约完整升级为生产可用：

- 真实运行数据：摘要、分页、状态回写、失败证据、运行 smoke。
- 外部集成：连接测试、SecretRef、Provider 健康、账单/回款/IM 真实通道。
- 异步执行：Worker、幂等键、失败重试、DLQ、任务状态和指标。
- 权限安全：字段 mask、行过滤、拒绝审计、跨 scope 拒绝测试。
- 前端体验：成熟组件、表单校验、步骤式执行、加载/空/错态、移动端表格策略、路由级懒加载。

## 2. M0 稳定性收口

### 已落地

- 修复 OpsCenter 跨模块策略联动任务重复创建问题：
  - `tasks.id` 改为毫秒时间戳加随机后缀，避免同毫秒连续创建多任务触发 SQLite primary key 冲突。
  - OpsCenter 策略联动任务按稳定 `source_report_id` 去重，同 scope 重复 apply 跳过已有治理任务。
  - 保留跨 scope 独立性，不把其他租户/项目的相同 `source_report_id` 误判为重复。
- 增加回归测试：
  - dry-run 不落库。
  - 同 scope 连续 apply 不增加重复任务。
  - 不同 scope 可以创建自己的同源治理任务。
- 新增生产就绪 API：
  - `/api/v1/system/pages/production-readiness`
  - 输出 `contract_complete / runtime_ready / production_ready` 三档。
  - 维度包含运行数据、外部连接、异步 Worker、测试覆盖、部署证据、监控信号、权限策略。
- 前端 SystemMap 接入生产就绪矩阵，并抽离为 `SystemProductionReadinessPanel` 独立模块，使用 Ant Design `Table / Segmented / Tag` 呈现筛选、阶段和维度。
- 新增体验与产品化治理矩阵：
  - `/api/v1/system/pages/experience-review`
  - `/api/v1/system/pages/experience-review/tasks`
  - 输出简洁度、自适配、成熟组件、权限管控、AI 可改造性、商业化六个维度。
  - SystemMap 详情区改为“体验治理 / 生产就绪 / 完整度”分段视图，默认先看体验治理，减少长页面堆叠。
  - 体验治理支持预览/生成 source=`system_page_experience` 治理任务，按 `source_report_id=experience:{module_id}` 幂等去重，并进入治理任务运营看板。
  - 体验治理新增优先处理队列和 AI 改造包，并抽离为 `SystemExperiencePriorityPanel` 独立模块：自动把 `complex/watch` 模块按体验分排序，展示最低维度、首条改造建议、移动端风险、权限缺口、AI 可改缺口、API/任务 API 和 Agent 字段；单模块可直接聚焦、预览或生成体验治理任务，避免在长表格里手工筛选，也避免继续膨胀 `SystemMap.tsx`。
- Worker `rag.warmup` 从 noop 改为真实调用 RAG health/search，可选 index docs；Redis 消费增加重试和 DLQ。
- Vite chunk 调整：把 `@antv` 和 `@ant-design/plots/charts/graphs` 合并到 `visualization-vendor`，降低 AntV/AntD 循环 chunk 风险。

### 待继续

- 给 OpsCenter 其他任务化入口复用同一套 `source_report_id` 幂等 helper。
- 把 production readiness gap 一键转成 SystemMap 治理任务。
- Worker DLQ 增加 Manager API 查询、重放和归档入口。

## 3. M1 从 contract complete 到 production ready

### 后端

- 扩展 SystemMap readiness：
  - 保留 `readiness` 作为契约完整矩阵。
  - 使用 `production-readiness` 作为生产就绪矩阵。
  - 增加可追踪 evidence：测试命令、部署版本、最近 smoke 时间、外部连接 health、Worker heartbeat。
- 对 37 个 legacy/migrating 页面建立承接任务：
  - 只迁移业务能力，不复制旧交互。
  - 承接任务统一进入 SystemMap 治理任务运营看板。
  - 每条任务必须有 `source_report_id` 和 scope 信息。

### 前端

- SystemMap 优先升级为治理控制台：
  - 顶部按体验治理、契约完整、运行可用、生产就绪分层。
  - 每个模块显示维度分、证据、缺口、推荐任务。
  - 表格同时提供桌面密集视图和移动端卡片/横向滚动。
  - `#/system-map/registry` 等子路由进入聚焦模式：Registry 只显示注册健康、菜单健康和页面注册列表，Manifest、能力、完整度、三码隔离、治理任务、动作目录和迁移 Backlog 分别进入自己的专业入口，避免一个页面承载全部治理能力。
  - `#/system-map/source-scan` 与 `#/system-map/baseline-compare` 不再复用同一个隔离大视图：源码扫描聚焦扫描项、加固任务、快照保存和历史；基线对比聚焦新增风险、已修复、评分差异和对比治理任务化，确保拆出来的菜单有真实功能闭环。
  - `#/system-map/manifest`、`#/system-map/capabilities`、`#/system-map/actions` 收敛到主菜单 `#/system-map/contract`，旧 URL 作为兼容入口保留但不再占据主菜单，避免模块契约、能力权限和动作目录三类相近治理入口造成选择负担。
  - `#/projects/businesses` 修复 hash 解析并作为兼容入口保留；项目主菜单优先展示 `#/projects/portfolio`，业务线治理从主 Tab 退到项目组合工作区和组织治理场景中，减少项目组合与业务线两个入口并列造成的重复感。
- 菜单和页面设计评估口径：
  - `simple`：首屏信息清晰、动作少、权限明确、移动端可用。
  - `watch`：功能可用但需要减少冗余、补响应式或补成熟组件。
  - `complex`：页面/API/动作过多，必须拆子路由或工作流抽屉。

## 4. M2 异步与执行底座

### manager-api

- 明确边界：
  - `apps/manager/sop_manager` 继续作为 FastAPI 代码真源。
  - `apps/manager-api` 只保留部署入口、README、健康检查和镜像/进程配置。
- 补部署 smoke：
  - OpenAPI 暴露。
  - `/health`、`/system/pages/readiness`、`/worker/health`。

### manager-worker

- 已完成第一步：
  - `rag.warmup` 真实执行。
  - Redis 消费失败支持 retry 和 DLQ。
  - 健康接口输出 received/completed/failed/retried/dlq 指标。
- 后续补齐：
  - Manager 端 DLQ 列表、重放、归档。
  - Worker 指标接 Prometheus。
  - `kb.index`、`memory.summarize` 增加幂等 payload hash。
  - 本地 pending job runner，避免无 Redis 时只能显示 pending。

### WorkflowOps

- 本地 profile 继续内存引擎。
- 生产 profile 必须暴露 Temporal/Redis/Worker 健康、降级原因和不可执行原因。
- 复杂操作采用“预览 -> 确认 -> 执行 -> 证据”模式。

## 5. M3 数据智能生产化

- 数据接入：
  - 真实数据库采样、字段统计、敏感字段扫描。
  - 连接密钥只保存 SecretRef。
  - CDC 游标增加延迟指标和失败恢复点。
- 数据质量：
  - 规则订阅、报告版本、告警通知策略。
  - 质量问题转治理任务必须按数据集、规则、窗口幂等。
- 指标与标签：
  - 指标 API 发布鉴权。
  - 标签画像批量构建、版本、调用审计。
- 元数据：
  - 字段级权限。
  - 血缘变更订阅。
  - 湖仓/OLAP 自动采样适配器。

## 6. M4 AI/Agent 生态深化

- A2A：
  - 保留注册、心跳、拉取、确认、续租、重派、SLA、执行窗口。
  - 新增外部 Agent conformance harness，验证 WorkBuddy、OpenClaw、Hermes Agent 接入。
- MCP/Agentd：
  - 工具沙箱执行策略。
  - 工具白名单审计。
  - 外部执行证据回写和失败重放。
- LLM Gateway：
  - Provider 账单导入。
  - 在线评测执行器。
  - 流式调用审计。
  - 项目成本中心分摊。
- Graph RAG/Memory：
  - 可替换图存储适配器。
  - 实体合并、证据权重、记忆保留期、脱敏。
  - 跨 scope 检索拒绝测试。

## 7. M5 企业安全、商业化与生产存储

- OceanBase：
  - 文件型 store 到数据库迁移。
  - 可执行迁移、回滚、备份恢复、三码索引验证。
- ABAC：
  - 字段 mask、行过滤、动态条件、拒绝审计。
  - API、导出、IM、Agent packet 统一脱敏。
- Billing：
  - 真实支付/回款渠道。
  - 催收节奏、超额审批、租户 quota enforcement。
- Observability：
  - API、Worker、Agent Run、LLM、数据作业、事件、审计链统一 trace/correlation id。
  - 接入 Prometheus/Grafana/Loki/Tempo profile。

## 8. 前端设计与交互任务

优先级从“看起来完整”改为“实际好用”：

1. 拆分超大工作台：
   - `Settings`：已完成专业子路由聚焦与移动端模块选择第一步，`#/settings/account/runtime/observability/profiles/sso/billing` 可直接进入对应模块；环境 Profile 编辑已从主页面内联大表单升级为 Ant Design `Drawer / Form / Input / Select / Steps / Button`，主页面保留状态、模板、列表和高频导出/激活动作，模板和列表行可直接打开聚焦配置抽屉；一键发布流水线创建/预览也已从主页面表单升级为 `Drawer / Form / Select / Switch / Steps / Button`，主工作区仅展示发布草稿摘要、最近流水线和执行证据；SSO 风险治理任务化、SSO 风险 IM 通知、SSO 自动升级策略和 SSO 风险处置 Runbook 均已从主页面 inline 表单升级为 `Drawer / Form / Input / Select / Switch / Steps / Button`，主页面只展示风险摘要、草稿摘要、最近 Runbook、步骤、运行结果和历史；商业计费的订阅计划、超额策略、审批阈值和收款登记也已收敛为 Ant Design `Drawer / Form / Input / Select / Steps / Button` 聚焦流程，主页面保留经营指标、风险提醒、配额、催收、账单和审计证据；下一步继续拆 OpsCenter 等复杂工作台。
   - `OpsCenterWorkbench`：已完成第一步模块化导航收敛，`#/system/ops-center/pipeline/alerts/rca/runbook/self-heal` 均可直达专业工作区；手写 tab 已升级为 Ant Design `Segmented`，并新增当前模块身份区、输出说明、AI 分析入口和返回运维总览动作，移动端以横向滚动承接模块切换；OpsCenter Hub 同步补齐“告警源治理”入口和开放告警指标；告警源创建/连接配置已从主页面 inline 表单迁入 Ant Design `Drawer / Form / Input / Select / Switch / Steps / Button`，主页面保留源指标、列表、同步、测试、启停和删除等高频动作；告警降噪策略与静默规则新增也已收敛为同一套 `Drawer / Form / Input / Select / Switch / Steps / Button` 聚焦流程，主页面只保留推荐、预览、应用、目录和启停删除；告警 SLO 自动升级参数已迁入 `Drawer / Form / Input / Select / Switch / Steps / Button`，主页面只展示当前升级策略、最近候选、执行结果、预览和执行入口；策略灰度应用审计参数也已迁入 `Drawer / Form / Input / Select / Switch / Steps / Button`，主页面只保留准入摘要、审批动作和审计证据；跨模块运维策略联动参数已迁入 `Drawer / Form / Input / Select / Steps / Button`，主页面只保留联动指标、配置摘要、预览/执行入口和联动结果；RCA 智能根因归因的 run/trace/correlation/limit、任务优先级、负责人和执行工具已迁入 `Drawer / Form / Input / Select / Steps / Button`，主页面只展示归因范围摘要、候选结果、任务结果和高频动作；手工 RCA 创建的事件 ID、影响范围、根因描述和解决方案已迁入 `Drawer / Form / Input / Steps / Button`，主页面只保留新建入口和 RCA 列表闭环；Runbook 首版创建与编辑生成新版本已迁入 `Drawer / Form / Input / TextArea / Steps / Button`，主页面只保留版本治理、证据回填、差异、版本动作和列表；自愈策略触发条件、动作、启用状态和评估信号也已迁入 `Drawer / Form / Input / TextArea / Switch / Steps / Button`，主自愈页面只保留摘要、评估/任务化入口、策略目录、决策结果和护栏动作队列；自愈护栏动作的审批、应用、验证、回滚已从每条卡片 inline 按钮收敛到 `Drawer / Steps / Button` 聚焦处置流，主页面只展示队列摘要、动作状态和“处理动作”入口。下一步继续做移动端截图检查和大工作台路由懒加载拆分。
   - `A2aWorkbench`：已完成第一步交互收敛，Hub 的 Agent 注册入口直达 `#/ecosystem/a2a/registry`，工作台内部按 `registry/negotiate/sla/windows/dispatch/evidence` 深链自动聚焦，并将手写 tab 改为 Ant Design `Segmented`，移动端横向滚动承接；Agent 注册已从页面内裸表单升级为 Ant Design `Drawer / Form / Select / Steps / Alert`，注册后一次性凭证提示独立展示；能力协商已升级为 Ant Design `Drawer / Form / Steps / Alert`，主页面只保留任务摘要、推荐结果、时间线入口和分发动作；信任策略、SLA 策略、执行窗口策略已统一升级为 `Drawer / Form / InputNumber / Switch / Steps / Alert`，主工作区只展示策略摘要和高频治理操作。
   - `LlmGatewayWorkbench`：已完成第一轮交互收敛，主导航改为 Ant Design `Segmented`，路由规则、Provider 健康、限流策略三张关键表改为 Ant Design `Table`，并保留 AI 助手入口；生产策略、Provider 健康上报、模型路由创建、限流创建、调用决策、模型调用记录、成本归因、模型评测和 Prompt 审计均已升级为 Ant Design `Drawer / Form / Input / InputNumber / Select / Switch / Steps / Alert`，主工作区只保留策略摘要、表格、结果、历史和高频治理动作；下一步继续做子路由懒加载拆分、移动端截图检查和剩余大工作台 OpsCenter/Settings 模块化。
   - `Copilot / AI 指挥台`：已修复并八次增强 `AI 指挥台 / AI 会话 / 命令中心 / 工具计划` 入口体验重复问题，并进一步完成模块化收敛、命令权限策略、审批队列和外部审批回调闭环；`#/copilot` 升级为总览态势 cockpit，并新增可点击四入口职责矩阵、“入口分工”和“推荐下一步”卡，明确指挥台只做态势与分流，会话输出 transcript、命令输出 dry-run/audit/approval、工具计划输出 plan/tasks；`#/copilot/chat` 聚焦持续会话、上下文注入、transcript、快捷追问、会话证据摘要、最近上下文回填和一键转工具计划；`#/copilot/commands` 聚焦命令目录、职责提示、分类统计、类型筛选、快捷筛选、移动端命令卡片、桌面表格、选中命令操作台、跳转、转计划、受控 dry-run 预览、审批队列、批准/驳回、外部回调入口、allowlist 执行证据和“先找能力 -> 再看风险 -> 最后留证”的执行路径；`#/copilot/tool-plan` 聚焦自然语言目标、交付推进/治理闭环/生产排障模板、计划生成、计划产出摘要、任务化预览/落库和证据闭环；工作区首屏新增按模式切换的专业身份区、职责边界、色彩语义、`Steps` 进度和 Action Dock：AI 会话优先接入上下文与快捷追问，命令中心优先搜索/筛选/分型/审批，工具计划优先选择目标模板并生成计划；移动端命令卡片直接提供查看/预览与转计划动作，让三个入口的视觉结构与操作路径明显区分；`CopilotModeActionDock`、`CopilotCommandMobileCards`、`CopilotCommandApprovalQueue` 和 `copilotTypes` 已抽为独立模块，命令中心主卡去掉重复搜索/筛选控件，只保留统计、当前筛选和命令列表；Manager `/api/v1/copilot/commands` 为每条命令返回 `policy.required_capability / risk_level / approval_required / approval_mode`，`/commands/execute` 对需确认命令创建幂等审批记录并返回 `approval_required` 状态，`/commands/approvals`、`/commands/approvals/{approval_id}/review` 与 `/commands/approvals/callback` 支持队列查询、人工批准/驳回、外部系统批准/驳回和回调幂等，批准后前端自动携带 `approval_id` 执行并回写审计证据；前端用 Ant Design `Popconfirm / Tag / Alert` 展示风险、能力码、审批流和执行证据，并保留 audit hash、结果 JSON 与计划证据；页面内部使用 Ant Design `Segmented / Steps / Switch / Input.Search / Input.TextArea / Table / Button / Alert / Empty`，后续继续补跨工具执行器和审批凭证校验。
   - `App`：已完成全局 App 壳层的移动端第一轮收敛，桌面端保持可折叠/可调宽侧栏、微应用域分组、快捷/收藏/最近入口和后端能力裁决菜单；移动端新增抽屉式微应用菜单、核心动作底栏、命令面板入口、AI 指挥台快捷入口和菜单搜索过滤，底部高频动作把 `AI 指挥台` 放到中间，减少移动端在全量菜单中查找成本；菜单显示设置新增 `简单 / 专业 / 完整` 三个预设，用户优先一键选择常用模式，需要时再细调密度、布局、效果和辅助信息。下一步继续做真实移动端截图检查、OpsCenter 剩余动作队列交互收敛和大工作台路由懒加载拆分。
2. 成熟组件优先：
   - 表单优先使用 Ant Design `Form / Input / Select / InputNumber / Switch / Alert / Drawer / Steps / Table`。
   - 避免裸 `input/select/textarea` 承担复杂校验。
   - LLM Gateway 后续继续把评测用例 JSON 模板沉淀为可复用用例库，并做路由级懒加载拆分，避免评测/审计能力挤占首屏主包。
3. 复杂操作统一步骤化：
   - 预览
   - 审批/确认
   - 执行
   - 证据回看
4. 所有表格必须具备：
   - loading
   - empty
   - error
   - filter
   - mobile 横向滚动或卡片视图
5. 图表必须具备表格替代视图。
6. 性能目标：
   - 路由级懒加载。
   - 图表库按需加载。
   - 首屏主 chunk 控制在可接受范围，持续消除循环 chunk。

## 9. 验收命令

后端：

```bash
PYTHONPATH=apps/manager python -m pytest apps/manager/sop_manager/routers/test_ops_center_core.py -q
PYTHONPATH=apps/manager python -m pytest apps/manager/sop_manager/routers/test_system_pages_portal.py -q
PYTHONPATH=apps/manager-worker python -m pytest apps/manager-worker/tests/test_handlers.py -q
python -m py_compile apps/manager/sop_manager/routers/ops_center.py apps/manager/sop_manager/routers/tasks.py apps/manager/sop_manager/routers/system_pages.py apps/manager/sop_manager/routers/worker_jobs.py
python -m py_compile apps/manager-worker/sop_worker/handlers.py apps/manager-worker/sop_worker/__main__.py
```

前端：

```bash
pnpm --dir apps/manager-web build
```

运行 smoke：

```bash
PYTHONPATH=apps/manager python - <<'PY'
from fastapi.testclient import TestClient
from sop_manager.main import app
c = TestClient(app)
for path in [
    "/api/v1/system/pages/readiness",
    "/api/v1/system/pages/production-readiness",
    "/api/v1/system/pages/experience-review",
    "/api/v1/system/pages/isolation-audit",
    "/api/v1/worker/health",
]:
    r = c.get(path)
    print(path, r.status_code)
PY
```

## 10. 发布标准

- 无新增跨 scope 泄露。
- 无硬编码密钥。
- 新增外部连接只保存 SecretRef。
- 治理任务必须幂等。
- 新增能力同步导航、i18n、System Pages、SDK/CLI。
- 前端不出现按钮文字溢出、表格遮挡、移动端关键操作不可见。
