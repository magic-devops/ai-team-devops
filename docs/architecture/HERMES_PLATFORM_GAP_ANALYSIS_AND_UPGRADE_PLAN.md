# Hermes 平台差距分析与全面升级方案

> 版本: 2026.05  
> 日期: 2026-05-19  
> 状态: 完整差距分析 + 优先级排序 + 实施路线

---

## 一、已完成能力盘点（H0–H2 / D0）

| 域 | 已实现 |
|----|--------|
| 组织项目 | 租户/业务线/项目/成员/角色/权限/SSO |
| 产品需求 | 需求池、智能评审、拆任务、批量治理 |
| 研发交付 | 任务列表/看板/Sprint/依赖图/DAG调度/Agent Feed/Report |
| 工作流 | 模板/实例/事件/信号/批量运维 |
| 数据智能 | 数据蓝图、数据交换、血缘、NLQ、报告、指标概览 |
| AI 智能 | Copilot会话/命令/工具计划、知识库/RAG/记忆/规则/反思蒸馏 |
| 平台生态 | CLI/IDE/Agent注册、MCP管理、模型运维、Marketplace、Notify/Webhook |
| 安全治理 | 审计链/WORM、模块动作、审批、SystemMap |
| 系统运维 | SSO/Profile/计费/观测/EnvOps |

---

## 二、核心差距清单（按优先级）

### P0 — 阻塞核心闭环

| # | 差距 | 当前状态 | 影响 |
|---|------|----------|------|
| G-01 | **Agent 执行运行中心** — Agent run 表、心跳、能力画像、负载、成功率、失败重试 | 后端 `agents.py` 有基础注册，无 run 生命周期管理 | AI 自主开发闭环断裂 |
| G-02 | **数据质量中心** — 质量规则目录、质量运行、告警、异常归因、质量报告 | `data_analytics.py` 有骨架，无质量规则引擎 | 数据可信度无保障 |
| G-03 | **指标/标签/画像服务** — 指标语义层、标签目录、画像本体、数据 API 发布 | 前端 `dataMetricsTags` 菜单存在，后端无语义层 | 数据智能无法落地 |
| G-04 | **三码隔离完整性** — 所有 API 强制 tenant_code + business_code + project_id 校验 | 部分路由已有 scope middleware，未全覆盖 | 多租户安全风险 |
| G-05 | **OceanBase 主存储迁移** — 生产环境从 SQLite 切换到 OceanBase | 当前 SQLite 为主，OceanBase 仅文档规划 | 无法支撑企业级并发 |

### P1 — 核心功能补全

| # | 差距 | 当前状态 | 影响 |
|---|------|----------|------|
| G-06 | **智能数据接入** — Flink CDC 连接器、Schema Registry、实时接入控制面 | `data_exchange.py` 仅有批量导入导出 | 实时数据链路缺失 |
| G-07 | **数据开发工作台** — SQL/Spark/Flink 作业编辑、调度、版本管理 | 前端 `dataDevelopment` 菜单存在，无实际工作台 | 数据开发无法在平台内完成 |
| G-08 | **智能调度中心完整实现** — 优先级策略、事件唤醒、质量卡点完整闭环 | 调度骨架已有，质量卡点未完整实现 | Agent 无法自主取活 |
| G-09 | **企业微信/钉钉深度集成** — 消息入站转需求/任务、任务状态出站推送 | `notify.py` 有渠道框架，无 IM 深度集成 | 团队协作断层 |
| G-10 | **WorkBuddy/OpenClaw/Hermes Agent A2A 协议** — 标准 A2A 接入、能力画像、执行证据回写 | `platforms_api.py` 有注册，无 A2A 协议实现 | 外部 Agent 无法接入 |
| G-11 | **ABAC 字段级权限** — 字段级数据权限、行级过滤、动态策略 | 当前仅角色级权限 | 企业级数据安全不足 |
| G-12 | **LLM Gateway 完整实现** — 模型路由、成本控制、限流、fallback | `llm_gateway.py` 存在但功能薄弱 | AI 能力不稳定 |
| G-13 | **Graph RAG / 知识图谱** — 代码/需求/规约/运行证据统一知识图谱 | 当前仅向量 RAG，无图谱 | 复杂推理能力弱 |
| G-14 | **本体画像记忆** — 用户/项目/Agent 本体建模、长期记忆生命周期 | `memory_api.py` 有基础，无本体建模 | AI 上下文理解浅 |

### P2 — 体验与商业化

| # | 差距 | 当前状态 | 影响 |
|---|------|----------|------|
| G-15 | **自愈与智能运维** — 部署流水线、监控根因、Runbook、自动修复 | `system_ops.py` 有骨架，无自愈逻辑 | 运维仍需人工介入 |
| G-16 | **智能报表与归因** — 多维归因分析、智能洞察报告自动生成 | 报告页面存在，无 AI 归因引擎 | 数据洞察停留在展示层 |
| G-17 | **租户账单与用量套餐** — 按用量计费、套餐管理、超额告警 | `billing.py` 有骨架，无计费引擎 | 商业化无法落地 |
| G-18 | **OpenTelemetry 全链路观测** — 日志/指标/链路统一接入 Prometheus/Grafana/Loki | `observability.py` 有接口，无完整集成 | 生产问题排查困难 |
| G-19 | **移动端/响应式** — 移动端抽屉导航、手势交互 | 当前仅 PC 端 | 移动场景无法使用 |
| G-20 | **多模态数据开发** — 图像/音频/视频数据集管理、Lance 向量存储集成 | Lance 仅用于代码/文档检索 | 多模态 AI 能力缺失 |

---

## 三、菜单结构优化方案

### 3.1 当前问题

1. **数据域过于扁平** — `analytics` 下挂了 10+ 子项，首屏噪音大
2. **Agent 运行中心缺失** — `agentRuns` 菜单存在但页面是空壳
3. **数据开发工作台是假菜单** — `dataDevelopment` 有菜单无实现
4. **智能运维独立性不足** — 运维能力散落在 system/delivery 两域
5. **数据质量没有独立入口** — 质量是数据平台核心，不应只是 catalog 子项

### 3.2 优化后菜单结构（新增/调整项）

```
数据智能域 (data) — 重组
├── 数据接入中心 [NEW]          data.ingest
│   ├── 连接器管理               data.ingest.connectors
│   ├── Schema Registry          data.ingest.schema
│   ├── CDC 实时接入              data.ingest.cdc
│   └── 批量接入作业              data.ingest.batch
├── 数据开发工作台 [UPGRADE]     data.development
│   ├── SQL 编辑器               data.development.sql
│   ├── Spark/Flink 作业         data.development.jobs
│   ├── 调度管理                  data.development.schedules
│   └── 版本与发布               data.development.versions
├── 数据质量中心 [NEW]           data.quality
│   ├── 质量规则目录              data.quality.rules
│   ├── 质量运行记录              data.quality.runs
│   ├── 告警与处置               data.quality.alerts
│   └── 质量报告                  data.quality.reports
├── 指标中心 [NEW]               data.metrics
│   ├── 指标目录                  data.metrics.catalog
│   ├── 指标语义层               data.metrics.semantic
│   ├── 指标 API 发布             data.metrics.api
│   └── 指标监控                  data.metrics.monitor
├── 标签服务 [NEW]               data.tags
│   ├── 标签目录                  data.tags.catalog
│   ├── 标签规则                  data.tags.rules
│   ├── 画像本体                  data.tags.ontology
│   └── 标签 API                  data.tags.api
├── 智能问数 (已有，升级)        data.analytics.nlq
├── 数据血缘 (已有)              data.analytics.lineage
└── 数据交换 (已有)              data.exchange

AI 智能域 (ai) — 新增
├── Agent 运行中心 [NEW]         ai.agent-ops
│   ├── 运行列表                  ai.agent-ops.runs
│   ├── 心跳监控                  ai.agent-ops.heartbeat
│   ├── 能力画像                  ai.agent-ops.profiles
│   └── 失败重试                  ai.agent-ops.retry
├── 模型网关 [NEW]               ai.llm-gateway
│   ├── 模型路由                  ai.llm-gateway.routing
│   ├── 成本控制                  ai.llm-gateway.cost
│   └── 限流策略                  ai.llm-gateway.throttle
└── 知识图谱 [NEW]               ai.knowledge-graph
    ├── 图谱构建                  ai.knowledge-graph.build
    ├── 图谱查询                  ai.knowledge-graph.query
    └── 血缘关联                  ai.knowledge-graph.lineage

平台生态域 (ecosystem) — 新增
└── A2A 网关 [NEW]               ecosystem.a2a
    ├── 协议注册                  ecosystem.a2a.registry
    ├── 能力协商                  ecosystem.a2a.negotiation
    └── 执行证据                  ecosystem.a2a.evidence

系统运维域 (system) — 新增
└── 智能运维中心 [NEW]           system.ops-center
    ├── 部署流水线               system.ops-center.pipeline
    ├── 根因分析                  system.ops-center.rca
    ├── Runbook 管理              system.ops-center.runbook
    └── 自愈策略                  system.ops-center.self-heal
```

---

## 四、技术升级路线

### 4.1 存储层升级

```
当前: SQLite (开发) → 目标: OceanBase (生产主存储)

迁移策略:
1. OceanBase 兼容 MySQL 协议，修改 db_config.py 连接串即可切换
2. 三码列 (tenant_code, business_code, project_id) 加组合索引
3. 审计表启用 OceanBase WORM 特性
4. 向量存储: LanceDB (本地) → Milvus/Qdrant (生产)
5. OLAP: StarRocks 承接指标查询加速，Hologres 承接实时数仓
```

### 4.2 数据链路升级

```
批流一体架构:
业务库/API → Flink CDC → Paimon Lakehouse
                       → OceanBase (主数据)
                       → StarRocks (OLAP加速)
                       → Hologres (实时服务)

控制面: 统一在 data.ingest 模块管理连接器和作业
```

### 4.3 前端技术升级

```
当前: React + Ant Design + Tailwind + ECharts
升级:
- Ant Design X: AI 对话组件 (替换自研 CopilotChatPanel)
- CopilotKit: 前端 AI 能力集成框架
- ChatUI 3.0: 智能问数/报表的对话界面
- AntvG6: 知识图谱可视化 (已有 AntvGraphCanvas 基础)
- Qiankun/Wujie: 微前端支持大型模块独立部署
```

### 4.4 Agent/MCP 升级

```
当前: 基础注册 + 心跳
升级:
- A2A 协议: 标准化 Agent 间通信
- MCP Hub: 工具权限白名单 + 沙箱执行
- sop-agentd: 完整 Agent 生命周期管理
- Skill Marketplace: 技能发布/安装/评分
```

---

## 五、功能实现优先级与迭代计划

### H3 — Agent 执行运行中心（当前最高优先级）

**后端新增:**
- `routers/agent_runs.py`: run 表 CRUD、心跳更新、状态机、失败重试
- `routers/agent_ops.py`: 能力画像、负载统计、成功率计算

**前端新增:**
- `pages/ai/AgentOpsHub.tsx`: Agent 运行中心 Hub
- `pages/ai/AgentRunsWorkbench.tsx`: 运行列表、心跳监控
- `pages/ai/AgentProfilesWorkbench.tsx`: 能力画像管理

**数据模型:**
```sql
CREATE TABLE agent_runs (
  id VARCHAR(36) PRIMARY KEY,
  tenant_code VARCHAR(64) NOT NULL,
  business_code VARCHAR(64),
  project_id VARCHAR(36),
  agent_id VARCHAR(36) NOT NULL,
  task_id VARCHAR(36),
  status ENUM('pending','running','success','failed','retrying'),
  started_at DATETIME,
  finished_at DATETIME,
  heartbeat_at DATETIME,
  confidence FLOAT,
  artifact JSON,
  gate_results JSON,
  error_msg TEXT,
  retry_count INT DEFAULT 0,
  INDEX idx_scope (tenant_code, project_id, status)
);
```

### H4 — 数据质量中心

**后端新增:**
- `routers/data_quality.py`: 质量规则 CRUD、质量运行、告警、归因、报告

**前端新增:**
- `pages/data/DataQualityHub.tsx`: 质量中心 Hub
- `pages/data/QualityRulesWorkbench.tsx`: 规则目录
- `pages/data/QualityAlertsWorkbench.tsx`: 告警处置

### H5 — 指标/标签/画像服务

**后端新增:**
- `routers/metrics_service.py`: 指标语义层、指标 API 发布
- `routers/tag_service.py`: 标签目录、标签规则、画像本体

**前端新增:**
- `pages/data/MetricsCenterHub.tsx`
- `pages/data/TagServiceHub.tsx`

### H6 — 企业级安全与商业化

**后端升级:**
- `routers/auth_sql.py`: 扩展 ABAC 字段级权限
- `routers/billing.py`: 完整计费引擎、套餐管理

### H7 — 自愈与智能运维

**后端新增:**
- `routers/ops_center.py`: 部署流水线、根因分析、Runbook、自愈策略

**前端新增:**
- `pages/system/OpsCenterHub.tsx`

---

## 六、通信集成深度方案

### 企业微信/钉钉

```python
# routers/notify.py 扩展
# 入站: 消息 → 解析意图 → 创建需求/任务
# 出站: 任务状态变更 → 推送通知

class IMConnector:
    async def handle_inbound(self, msg: IMMessage) -> RequirementOrTask:
        intent = await llm_gateway.classify_intent(msg.content)
        if intent == "requirement":
            return await requirements.create(...)
        elif intent == "task_update":
            return await tasks.update(...)
    
    async def push_outbound(self, event: TaskEvent) -> None:
        await im_client.send_card(
            channel=event.project.im_channel,
            card=render_task_card(event)
        )
```

### WorkBuddy / OpenClaw / Hermes Agent (A2A)

```python
# routers/a2a_gateway.py (新增)
# 标准 A2A 协议: 注册 → 能力协商 → 任务分发 → 执行证据回写

class A2AProtocol:
    async def register_agent(self, agent: AgentManifest) -> str: ...
    async def negotiate_capability(self, task: Task) -> AgentMatch: ...
    async def dispatch_task(self, task: Task, agent_id: str) -> RunId: ...
    async def receive_evidence(self, run_id: str, evidence: Evidence) -> None: ...
```

---

## 七、智能化增强方案

### 7.1 全平台 AI Surface 补全

每个模块都需要支持以下 AI 能力入口：

| AI Surface | 位置 | 功能 |
|-----------|------|------|
| 页头 AI 按钮 | 所有模块页头 | 带入模块上下文的 Copilot 对话 |
| 智能填充 | 表单/编辑器 | AI 辅助填写需求/任务描述 |
| 智能分析 | 列表/看板 | 一键分析当前数据，生成洞察 |
| 智能建议 | 操作确认 | 操作前 AI 风险评估 |
| 自然语言查询 | 所有列表 | 用自然语言过滤/搜索数据 |

### 7.2 智能问数升级

```
当前: 基础 NLQ 查询
升级:
- 语义层: 业务指标/标签/维度统一语义注册
- 多轮对话: 支持追问和上下文保持
- 可视化推荐: AI 自动选择最合适的图表类型
- 归因分析: 指标异常自动归因
- 报告生成: 对话式生成智能报告
```

### 7.3 需求智能化升级

```
当前: 需求池 + 智能评审 + 拆任务
升级:
- 相似需求检测: 向量相似度 + 去重建议
- 智能验收标准: AI 自动生成可测试的验收条件
- 需求优先级建议: 基于业务价值/技术复杂度/依赖关系
- 需求到 DAG: 自动生成任务依赖图
- 多入口采集: IM消息/邮件/语音/文档 → 需求
```

---

## 八、数据开发平台完整方案

### 8.1 数据接入中心（新模块）

```
连接器类型:
- 数据库: MySQL/PostgreSQL/OceanBase/Oracle/MongoDB
- 消息队列: Kafka/RocketMQ/Pulsar
- 文件: S3/OSS/HDFS/FTP
- API: REST/GraphQL/WebSocket
- IM/业务系统: 企业微信/钉钉/Salesforce/自定义

接入模式:
- 全量批量: Spark 批处理
- 增量 CDC: Flink CDC 实时同步
- 实时流: Flink 流处理
- 混合: 批流一体 Paimon
```

### 8.2 数据开发工作台（升级）

```
功能:
- SQL 编辑器: 语法高亮/自动补全/执行计划/结果预览
- Spark 作业: Python/Scala 脚本编辑/提交/监控
- Flink 作业: SQL/DataStream API/状态管理
- 调度: Cron/依赖触发/事件触发
- 版本管理: Git 集成/变更历史/回滚
- AI 辅助: 自然语言转 SQL/代码补全/错误诊断
```

### 8.3 指标中心（新模块）

```
语义层设计:
- 原子指标: 基础计算逻辑 (如 GMV = sum(order_amount))
- 派生指标: 基于原子指标的组合 (如 日均GMV)
- 复合指标: 多指标计算 (如 转化率 = 成交/访问)
- 维度: 时间/地区/品类/渠道等
- 口径: 统一业务口径定义

API 发布:
- REST API: 标准指标查询接口
- GraphQL: 灵活指标组合查询
- SDK: Python/Java/Go 客户端
```

---

## 九、安全与合规增强

### 9.1 ABAC 字段级权限

```python
# 扩展 auth_sql.py
class FieldPermission:
    resource: str      # 资源类型 (requirement/task/metric)
    field: str         # 字段名
    condition: dict    # 条件 (如 {department: "finance"})
    action: str        # read/write/mask

# 数据脱敏: 敏感字段自动 mask
# 行级过滤: 基于用户属性动态过滤数据
# 动态策略: 基于时间/IP/设备的访问控制
```

### 9.2 审计增强

```
当前: 基础审计链 + WORM
升级:
- 操作录像: 高风险操作全程记录
- 异常检测: AI 识别异常访问模式
- 合规报告: SOC2/ISO27001 自动生成报告
- 数据血缘审计: 数据流转全链路追踪
```

---

## 十、实施建议

### 10.1 立即可做（本周）

1. **补全 Agent 运行中心后端** — 新增 `agent_runs.py` router，实现 run 生命周期
2. **前端 AgentOpsHub 页面** — 对应 navigation.tsx 中已有的 `agentRuns` 菜单项
3. **三码隔离全覆盖** — 审查所有 router，确保 scope middleware 全覆盖
4. **数据质量规则引擎** — 新增 `data_quality.py`，实现规则 CRUD 和运行

### 10.2 短期（2-4周）

1. 指标语义层 + 标签服务后端
2. 数据接入中心（连接器管理 + CDC 控制面）
3. 企业微信/钉钉 IM 深度集成
4. LLM Gateway 完整实现（路由/限流/成本）

### 10.3 中期（1-3月）

1. OceanBase 生产迁移
2. Flink CDC + Paimon 数据链路
3. Graph RAG + 知识图谱
4. A2A 协议完整实现
5. ABAC 字段级权限

### 10.4 长期（3-6月）

1. 自愈与智能运维
2. 多模态数据开发
3. 完整商业化计费
4. 移动端响应式
5. 机器学习/模型训练集成

---

## 十一、前后端模块化设计规范

### 后端新增模块命名规范

```
apps/manager/sop_manager/routers/
├── agent_runs.py          # H3: Agent 运行中心
├── agent_ops.py           # H3: Agent 运维
├── data_quality.py        # H4: 数据质量
├── metrics_service.py     # H5: 指标服务
├── tag_service.py         # H5: 标签服务
├── a2a_gateway.py         # P1: A2A 协议
├── ops_center.py          # H7: 智能运维
├── im_connector.py        # P1: IM 集成
└── llm_gateway_v2.py      # P1: LLM 网关升级
```

### 前端新增页面命名规范

```
apps/manager-web/src/pages/
├── ai/
│   ├── AgentOpsHub.tsx          # H3
│   ├── AgentRunsWorkbench.tsx   # H3
│   └── LlmGatewayWorkbench.tsx  # P1
├── data/
│   ├── DataIngestHub.tsx        # P1
│   ├── DataQualityHub.tsx       # H4
│   ├── MetricsCenterHub.tsx     # H5
│   └── TagServiceHub.tsx        # H5
├── ecosystem/
│   └── A2aGatewayWorkbench.tsx  # P1
└── system/
    └── OpsCenterHub.tsx         # H7
```

### 每个新模块必须包含

1. Hub 页面（治理中心入口，含统计卡片和子模块导航）
2. Workbench 页面（具体功能工作台）
3. navigation.tsx 注册（含 capability 码）
4. i18n 翻译（zh/en）
5. 后端 router（含三码校验）
6. system_pages.py 能力注册

---

## 十二、与平台定位的对齐验证

| 定位目标 | 当前覆盖 | 差距 |
|---------|---------|------|
| 人管需求/团队，AI 干活 | ✅ 需求工作台 + Agent Feed | ❌ Agent 运行中心不完整 |
| 智能化任务拆解分发 | ✅ DAG 调度 + 优先级 | ⚠️ 质量卡点未完整闭环 |
| AI 自主开发 | ⚠️ Agent 注册有，运行管理弱 | ❌ A2A 协议缺失 |
| 智能部署运维监控 | ⚠️ 骨架存在 | ❌ 自愈逻辑未实现 |
| 数据开发/分析/洞察 | ⚠️ 蓝图/血缘/NLQ 有 | ❌ 质量/指标/标签服务缺 |
| 智能决策 | ⚠️ 报告存在 | ❌ 归因引擎未实现 |
| 一栈式平台 | ✅ 9域菜单覆盖 | ⚠️ 部分模块是空壳 |
| 租户隔离 | ⚠️ 部分覆盖 | ❌ 未全覆盖所有 API |
| 企业微信/钉钉打通 | ⚠️ 渠道框架有 | ❌ 深度集成未实现 |
| WorkBuddy/OpenClaw 对接 | ⚠️ 注册有 | ❌ A2A 协议未实现 |

