import type { NavGroupKey, NavItem } from "./navigation";

export type MicroAppId = "main-admin" | "ai-foundation" | "ai-rd-center" | "ai-data-center" | "ai-ops-center";
export type MicroAppMode = "native" | "wujie";
export type MicroAppStatus = "ready" | "migrating" | "planned";

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
  "specs",
  "designDocs",
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
  if (import.meta.env.PROD) return app.prodUrl;
  return "";
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
