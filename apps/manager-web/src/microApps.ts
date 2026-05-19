import type { NavGroupKey, NavItem } from "./navigation";

export type MicroAppId = "main-admin" | "ai-foundation" | "ai-rd-center" | "ai-data-center" | "ai-ops-center";
export type MicroAppMode = "native" | "wujie";
export type MicroAppStatus = "ready" | "migrating" | "planned";

export type MicroAppCapability = {
  name: string;
  scope: string;
  kpi: string;
  maturity: "standard" | "advanced" | "leading";
};

export type MicroAppWorkflow = {
  phase: string;
  detail: string;
  metric: string;
};

export type MicroAppAction = {
  title: string;
  owner: string;
  due: string;
  priority: "P0" | "P1" | "P2";
  targetKey: string;
};

export type MicroAppDefinition = {
  id: MicroAppId;
  name: string;
  shortName: string;
  route: string;
  basePath: string;
  description: string;
  owner: string;
  mode: MicroAppMode;
  status: MicroAppStatus;
  envKey: string;
  prodUrl: string;
  devUrl: string;
  groups: readonly NavGroupKey[];
  primaryKeys: readonly string[];
  highlights: readonly string[];
  capabilities: readonly MicroAppCapability[];
  workflows: readonly MicroAppWorkflow[];
  actions: readonly MicroAppAction[];
};

const MAIN_ADMIN_KEYS = [
  "dashboard",
  "dashboardCockpit",
  "projects",
  "projectPortfolio",
  "projectBusinesses",
  "projectTenants",
  "tenantUsers",
  "projectMembers",
  "organization",
  "orgTenantUsers",
  "orgBusinesses",
  "orgProjectMembers",
  "orgRolePolicy",
  "orgAccessReview",
  "systemMap",
  "microAppGovernance",
  "pageRegistry",
  "moduleManifest",
  "capabilityGovernance",
  "moduleActionCatalog",
  "settings",
  "settingsAccount",
  "settingsRuntime",
  "settingsProfiles",
] as const;

const AI_FOUNDATION_KEYS = [
  "intelligence",
  "knowledgeBase",
  "ragSearch",
  "aiMemory",
  "ruleCenter",
  "reflectionDistill",
  "workerOps",
  "syncOps",
  "eventStream",
  "usageOps",
  "platforms",
  "platformTools",
  "cliTools",
  "mcpHub",
  "agentRegistry",
  "agentRuns",
  "agentRunsWorkbench",
  "modelOps",
  "platformOps",
  "agentOps",
  "agentOpsRuns",
  "agentOpsHeartbeat",
  "agentOpsProfiles",
  "agentOpsRetry",
  "llmGateway",
  "llmGatewayRoutes",
  "llmGatewayCost",
  "llmGatewayThrottle",
  "knowledgeGraph",
  "knowledgeGraphBuild",
  "knowledgeGraphQuery",
  "knowledgeGraphLineage",
  "a2aGateway",
  "a2aWorkbench",
  "a2aRegistry",
  "a2aNegotiate",
  "a2aDispatch",
  "a2aEvidence",
  "marketplace",
  "marketplaceCatalog",
  "marketplaceInstalled",
  "marketplaceRatings",
  "skillsHub",
  "skillsCatalog",
  "skillsRepos",
] as const;

const AI_RD_KEYS = [
  "requirements",
  "productRequirementsWorkbench",
  "requirementPool",
  "requirementReview",
  "requirementGeneration",
  "requirementBatch",
  "tasks",
  "taskExecution",
  "taskBoard",
  "taskSprints",
  "taskDependencies",
  "taskScheduler",
  "issues",
  "issuesTracker",
  "devFlow",
  "devFlowWorkbench",
  "orchestration",
  "orchestrationStudio",
  "workflows",
  "workflowTemplates",
  "workflowInstances",
  "workflowEvents",
  "workflowSignals",
  "workflowBulkOps",
  "copilot",
  "copilotChat",
  "copilotCommands",
  "copilotToolPlan",
  "vibe",
  "vibeWorkspace",
  "globalSearch",
  "searchWorkbench",
  "specs",
  "designDocs",
] as const;

const AI_DATA_KEYS = [
  "analytics",
  "analyticsOverview",
  "analyticsBlueprint",
  "analyticsReports",
  "reportAssets",
  "reportSubscription",
  "reportActionTasks",
  "analyticsCatalog",
  "dataAssets",
  "dataMetricsTags",
  "dataServices",
  "dataQuality",
  "dataDevelopment",
  "analyticsLineage",
  "dataExchange",
  "analyticsNlq",
  "dataSources",
  "dataIngest",
  "dataIngestWorkbench",
  "dataIngestConnectors",
  "dataIngestSchema",
  "dataIngestCdc",
  "dataIngestBatch",
  "dataQualityCenter",
  "dataQualityWorkbench",
  "dataQualityRules",
  "dataQualityRuns",
  "dataQualityAlerts",
  "dataQualityReports",
  "metricsCenter",
  "metricsWorkbench",
  "metricsCatalog",
  "metricsSemantic",
  "metricsApiPublish",
  "metricsMonitor",
  "tagService",
  "tagWorkbench",
  "tagCatalog",
  "tagRules",
  "tagOntology",
  "tagApi",
  "dataDev",
  "dataDevSql",
  "dataDevSpark",
  "dataDevFlink",
  "dataDevSchedules",
] as const;

const AI_OPS_KEYS = [
  "notify",
  "notifyConnectors",
  "notifyChannels",
  "notifyOutbound",
  "notifyInbound",
  "notifyMessages",
  "webhooks",
  "audit",
  "auditChain",
  "auditEvents",
  "auditModuleActions",
  "auditApprovals",
  "settingsSso",
  "settingsBilling",
  "settingsObservability",
  "envOps",
  "envOpsWorkbench",
  "opsCenter",
  "opsCenterPipeline",
  "opsCenterRca",
  "opsCenterRunbook",
  "opsCenterSelfHeal",
  "opsCenterWorkbench",
] as const;

export const MICRO_APPS: readonly MicroAppDefinition[] = [
  {
    id: "main-admin",
    name: "主应用 · 基础管理",
    shortName: "基础管理",
    route: "#/apps/main-admin",
    basePath: "#/",
    description: "统一承载账号、权限、组织、项目、服务与平台模块治理，是所有子应用的登录态和能力控制面。",
    owner: "Platform Admin",
    mode: "native",
    status: "ready",
    envKey: "VITE_SUB_APP_MAIN_ADMIN_URL",
    prodUrl: "/",
    devUrl: "/",
    groups: ["overview", "portfolio", "governance", "system"],
    primaryKeys: MAIN_ADMIN_KEYS,
    highlights: ["租户与账号治理", "组织权限与角色策略", "项目与服务管理", "页面能力与权限矩阵"],
    capabilities: [
      { name: "账号与租户控制面", scope: "登录态、租户、用户、项目成员与服务账号统一管理", kpi: "账号治理覆盖 100%", maturity: "leading" },
      { name: "权限与角色策略", scope: "角色、页面、动作、能力码和访问评审闭环", kpi: "高危权限复核 7 天内完成", maturity: "advanced" },
      { name: "组织与项目运营", scope: "组织架构、业务线、项目组合与人员授权矩阵", kpi: "组织数据同步成功率 99.9%", maturity: "advanced" },
      { name: "模块治理", scope: "页面注册、模块清单、子应用边界和运行状态治理", kpi: "模块归属准确率 100%", maturity: "standard" },
    ],
    workflows: [
      { phase: "接入", detail: "创建租户、业务、项目与服务账号", metric: "开户时长 < 10 分钟" },
      { phase: "授权", detail: "角色策略、权限矩阵、页面能力码绑定", metric: "权限变更全审计" },
      { phase: "运营", detail: "组织项目看板、成员盘点、服务治理", metric: "异常授权自动提示" },
      { phase: "复核", detail: "访问评审、过期权限回收、模块边界巡检", metric: "复核闭环率 95%+" },
    ],
    actions: [
      { title: "梳理跨租户高危权限", owner: "Platform Admin", due: "本周", priority: "P0", targetKey: "orgAccessReview" },
      { title: "补齐模块动作目录", owner: "Capability Owner", due: "3 天内", priority: "P1", targetKey: "moduleActionCatalog" },
      { title: "校准项目服务账号归属", owner: "Ops Admin", due: "本月", priority: "P1", targetKey: "projectMembers" },
    ],
  },
  {
    id: "ai-foundation",
    name: "智能基础服务",
    shortName: "基础服务",
    route: "#/apps/ai-foundation",
    basePath: "#/ai-foundation",
    description: "沉淀开发环境、CLI 工具、知识库、记忆、技能、插件、模型、Agent、MCP/A2A 等可复用 AI 底座能力。",
    owner: "AI Platform",
    mode: "wujie",
    status: "migrating",
    envKey: "VITE_SUB_APP_AI_FOUNDATION_URL",
    prodUrl: "/subapps/ai-foundation/",
    devUrl: "http://127.0.0.1:5181/",
    groups: ["ai", "ecosystem"],
    primaryKeys: AI_FOUNDATION_KEYS,
    highlights: ["CLI 与开发环境", "知识/记忆/规则/RAG", "技能插件与资产市场", "Agent/MCP/A2A/模型治理"],
    capabilities: [
      { name: "开发环境与 CLI", scope: "环境模板、CLI 工具、MCP 工具链和执行沙箱", kpi: "工具可用率 99.5%", maturity: "advanced" },
      { name: "知识记忆与规则", scope: "知识库、RAG、记忆沉淀、规则中心和反思蒸馏", kpi: "命中率提升 20%+", maturity: "leading" },
      { name: "技能插件市场", scope: "技能仓库、插件发布、安装评分和版本治理", kpi: "资产复用率 60%+", maturity: "standard" },
      { name: "Agent 与模型治理", scope: "Agent 注册、运行、心跳、模型网关、成本和限流", kpi: "失败重试闭环率 95%+", maturity: "advanced" },
    ],
    workflows: [
      { phase: "资产接入", detail: "登记工具、技能、插件、模型与 Agent", metric: "资产元数据完整率 95%+" },
      { phase: "能力编排", detail: "绑定知识、规则、工具计划与运行画像", metric: "编排复用 30%+" },
      { phase: "运行治理", detail: "心跳、重试、限流、成本与质量监控", metric: "异常 MTTR < 30 分钟" },
      { phase: "沉淀复用", detail: "执行记录转知识、记忆、技能与最佳实践", metric: "沉淀采纳率 40%+" },
    ],
    actions: [
      { title: "建立 Agent 运行画像基线", owner: "AI Platform", due: "本周", priority: "P0", targetKey: "agentRunsWorkbench" },
      { title: "补齐模型网关成本阈值", owner: "Model Ops", due: "3 天内", priority: "P1", targetKey: "llmGatewayCost" },
      { title: "梳理技能市场上架标准", owner: "Ecosystem", due: "本月", priority: "P2", targetKey: "skillsCatalog" },
    ],
  },
  {
    id: "ai-rd-center",
    name: "智能研发中心",
    shortName: "研发中心",
    route: "#/apps/ai-rd-center",
    basePath: "#/ai-rd",
    description: "覆盖需求、方案、任务、AI 开发、任务下发、调度、监控、质量评审与研发运维的一栈式平台。",
    owner: "Engineering AI",
    mode: "wujie",
    status: "migrating",
    envKey: "VITE_SUB_APP_AI_RD_CENTER_URL",
    prodUrl: "/subapps/ai-rd-center/",
    devUrl: "http://127.0.0.1:5182/",
    groups: ["product", "delivery", "ai"],
    primaryKeys: AI_RD_KEYS,
    highlights: ["需求到任务闭环", "AI 开发与工具计划", "DAG 调度与 Agent Feed", "质量卡点与交付审计"],
    capabilities: [
      { name: "需求与方案治理", scope: "需求池、智能评审、批量生成、方案文档和规格沉淀", kpi: "需求拆解准确率 90%+", maturity: "advanced" },
      { name: "任务与执行调度", scope: "任务看板、Sprint、依赖、任务下发和调度中心", kpi: "阻塞任务下降 30%", maturity: "leading" },
      { name: "AI 开发工作流", scope: "Copilot、Vibe、工具计划、全局搜索和开发流", kpi: "AI 任务首轮通过率 75%+", maturity: "advanced" },
      { name: "质量评审与运维", scope: "工作流实例、事件、信号、批量操作和交付审计", kpi: "质量卡点覆盖 100%", maturity: "standard" },
    ],
    workflows: [
      { phase: "需求", detail: "需求池进入评审、批量生成和优先级治理", metric: "评审周期 < 2 天" },
      { phase: "方案", detail: "规格、方案、设计文档和上下文包生成", metric: "方案复用率 35%+" },
      { phase: "执行", detail: "任务拆分、Agent 下发、调度、监控和依赖消解", metric: "自动化执行占比 50%+" },
      { phase: "验收", detail: "质量评审、事件归档、发布运维和复盘沉淀", metric: "缺陷逃逸率下降 25%" },
    ],
    actions: [
      { title: "完善需求到任务拆解策略", owner: "Product AI", due: "本周", priority: "P0", targetKey: "requirementGeneration" },
      { title: "配置 AI 开发调度泳道", owner: "Engineering AI", due: "3 天内", priority: "P1", targetKey: "orchestrationStudio" },
      { title: "补齐质量评审触发条件", owner: "QA Ops", due: "本月", priority: "P1", targetKey: "workflowSignals" },
    ],
  },
  {
    id: "ai-data-center",
    name: "智能数据中心",
    shortName: "数据中心",
    route: "#/apps/ai-data-center",
    basePath: "#/ai-data",
    description: "覆盖数据源、数据接入、元数据、数据开发、调度中心、任务运维、指标、标签与数据服务。",
    owner: "Data Platform",
    mode: "wujie",
    status: "migrating",
    envKey: "VITE_SUB_APP_AI_DATA_CENTER_URL",
    prodUrl: "/subapps/ai-data-center/",
    devUrl: "http://127.0.0.1:5183/",
    groups: ["data"],
    primaryKeys: AI_DATA_KEYS,
    highlights: ["数据源与接入", "元数据与血缘", "数据开发与调度运维", "指标标签与数据服务"],
    capabilities: [
      { name: "数据源与接入", scope: "数据源、连接器、Schema、CDC、批处理和入湖治理", kpi: "接入成功率 99%+", maturity: "advanced" },
      { name: "元数据与血缘", scope: "资产目录、血缘、数据治理模块和影响分析", kpi: "核心资产血缘覆盖 90%+", maturity: "leading" },
      { name: "数据开发与调度", scope: "SQL、Spark、Flink、调度、任务运维和发布", kpi: "调度准点率 98%+", maturity: "standard" },
      { name: "指标标签与服务", scope: "指标目录、语义层、API 发布、监控、标签和数据服务", kpi: "指标一致性 95%+", maturity: "advanced" },
    ],
    workflows: [
      { phase: "接入", detail: "连接数据源、采集元数据、配置 CDC/批处理", metric: "Schema 漂移自动告警" },
      { phase: "治理", detail: "血缘、质量规则、资产归属和数据分级", metric: "治理问题闭环率 90%+" },
      { phase: "开发", detail: "SQL/Spark/Flink 开发、调度和任务运维", metric: "失败自动诊断覆盖 80%+" },
      { phase: "服务", detail: "指标、标签、报表、NLQ 和 API 发布", metric: "服务 SLA 99.5%" },
    ],
    actions: [
      { title: "补齐核心数据源接入健康检查", owner: "Data Platform", due: "本周", priority: "P0", targetKey: "dataIngestWorkbench" },
      { title: "建立指标口径冲突看板", owner: "Metric Owner", due: "3 天内", priority: "P1", targetKey: "metricsWorkbench" },
      { title: "扩展质量规则模板库", owner: "Data Gov", due: "本月", priority: "P2", targetKey: "dataQualityRules" },
    ],
  },
  {
    id: "ai-ops-center",
    name: "智能运营中心",
    shortName: "运营中心",
    route: "#/apps/ai-ops-center",
    basePath: "#/ai-ops",
    description: "统一商业计费、安全审计、企业 SSO、消息通信、环境运维和自愈 Runbook 等运营治理能力。",
    owner: "Operations",
    mode: "wujie",
    status: "migrating",
    envKey: "VITE_SUB_APP_AI_OPS_CENTER_URL",
    prodUrl: "/subapps/ai-ops-center/",
    devUrl: "http://127.0.0.1:5184/",
    groups: ["governance", "system", "ecosystem"],
    primaryKeys: AI_OPS_KEYS,
    highlights: ["商业计费与回款", "安全审计与动作审批", "企业 SSO 与审计留痕", "通信集成与智能运维"],
    capabilities: [
      { name: "商业计费与运营", scope: "套餐、用量、账单、成本归集和商业运营报表", kpi: "账单差错率 < 0.1%", maturity: "standard" },
      { name: "安全审计与审批", scope: "审计链、事件、模块动作、高危审批和证据留存", kpi: "高危动作审计 100%", maturity: "leading" },
      { name: "企业 SSO 与配置", scope: "SSO、运行配置、观测配置和组织级安全策略", kpi: "SSO 接入时长 < 1 天", maturity: "advanced" },
      { name: "通信与智能运维", scope: "通知、Webhook、环境运维、自愈 Runbook 和 RCA", kpi: "故障 MTTR 下降 30%", maturity: "advanced" },
    ],
    workflows: [
      { phase: "配置", detail: "SSO、计费、通知、Webhook 和观测基础配置", metric: "配置变更全留痕" },
      { phase: "审计", detail: "审计链、事件归集、动作审批和风险识别", metric: "风险事件分钟级发现" },
      { phase: "运营", detail: "账单、用量、消息触达、SLA 和服务健康", metric: "运营巡检自动化 80%+" },
      { phase: "自愈", detail: "RCA、Runbook、流水线、回滚和自愈策略", metric: "自愈成功率 70%+" },
    ],
    actions: [
      { title: "补齐高危动作审批策略", owner: "Security Ops", due: "本周", priority: "P0", targetKey: "auditApprovals" },
      { title: "配置 Webhook 重试与签名校验", owner: "Integration Ops", due: "3 天内", priority: "P1", targetKey: "webhooks" },
      { title: "建立自愈 Runbook 分级", owner: "SRE", due: "本月", priority: "P1", targetKey: "opsCenterRunbook" },
    ],
  },
];

const APP_BY_ID = new Map(MICRO_APPS.map((app) => [app.id, app]));
const KEY_TO_APP = new Map<MicroAppId, Set<string>>(MICRO_APPS.map((app) => [app.id, new Set(app.primaryKeys)]));

export const DEFAULT_MICRO_APP_ID: MicroAppId = "main-admin";

export function getMicroApp(id: MicroAppId): MicroAppDefinition {
  return APP_BY_ID.get(id) ?? MICRO_APPS[0];
}

export function getMicroAppRuntimeUrl(app: MicroAppDefinition): string {
  const env = import.meta.env as Record<string, string | boolean | undefined>;
  const configured = env[app.envKey];
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  return app.prodUrl;
}

export function getMicroAppIdForNavItem(item: Pick<NavItem, "key" | "parentKey" | "group">): MicroAppId {
  const routeKeyMap: Record<string, MicroAppId> = {
    microAppMainAdmin: "main-admin",
    microAppAiFoundation: "ai-foundation",
    microAppAiRdCenter: "ai-rd-center",
    microAppAiDataCenter: "ai-data-center",
    microAppAiOpsCenter: "ai-ops-center",
  };
  if (routeKeyMap[item.key]) return routeKeyMap[item.key];
  for (const app of MICRO_APPS) {
    const keys = KEY_TO_APP.get(app.id);
    if (keys?.has(item.key) || (item.parentKey && keys?.has(item.parentKey))) return app.id;
  }
  if (item.group === "product" || item.group === "delivery") return "ai-rd-center";
  if (item.group === "data") return "ai-data-center";
  if (item.group === "ai" || item.group === "ecosystem") return "ai-foundation";
  if (item.group === "governance" || item.group === "system") return "ai-ops-center";
  return DEFAULT_MICRO_APP_ID;
}

export function filterNavByMicroApp(appId: MicroAppId, items: readonly NavItem[]): NavItem[] {
  return items.filter((item) => getMicroAppIdForNavItem(item) === appId);
}

export function getMicroAppIdFromHash(hash: string, items: readonly NavItem[]): MicroAppId | null {
  const app = MICRO_APPS.find((entry) => hash.startsWith(entry.route));
  if (app) return app.id;
  const item = [...items]
    .sort((a, b) => b.path.length - a.path.length)
    .find((entry) => !entry.external && entry.path.startsWith("#") && hash.startsWith(entry.path));
  return item ? getMicroAppIdForNavItem(item) : null;
}
