/**
 * @ai_safe_edit
 *   - 新增页面：在 src/pages/ 加组件，并只在本文件追加 NavItem；同时补 i18n nav.<key> 与 page.<key>.title
 *   - 新能力：只注册 React 页面；旧 #/legacy/* 书签由 routeAliases 自动跳转
 *   - 新增业务域：扩展 NAV_GROUPS 和 i18n nav.group；新增 NAV_CATEGORIES 与 ITEM_CATEGORY 映射
 *   - 新增子菜单：父模块 submodules + parentKey 子项；子项必须传 focused 参数以驱动页面分区
 *   - badge/status：新增 NEW/BETA 仅用于 ≤2 个发布周期，过期需移除
 *   - capability：能力码格式 `<domain>.<module>.<submodule>.<action>`，必须与 system_pages.py 注册同步
 *
 * @schema_version 2026-05-17-v2
 *   字段 `badge` / `status` / `shortcut` / `description` 已稳定；改动需 bump 并提供 fallback。
 */
import { lazy, Suspense, type ComponentType, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  BellRing,
  Blocks,
  BookOpen,
  Bot,
  Brain,
  Building2,
  Container,
  Check,
  ClipboardList,
  Command,
  Copy as CopyIcon,
  Cpu,
  Database,
  ExternalLink,
  FileCode,
  FileSearch,
  FileText,
  FolderKanban,
  Gauge,
  GitBranch,
  KeyRound,
  Layers3,
  LayoutDashboard,
  Library,
  ListChecks,
  MessageSquareText,
  Network,
  Package,
  Palette,
  ArrowRight,
  SearchCheck,
  Rows3,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles as SparklesIcon,
  Terminal as TerminalIcon,
  UserCog as UserCogIcon,
  Users as UsersIcon,
  Wrench,
} from "lucide-react";

const DashboardPage = lazy(() => import("../subapps/main-admin/src/pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const MicroAppPortalPage = lazy(() => import("./pages/MicroAppPortal").then((m) => ({ default: m.MicroAppPortal })));
const HermesPortalPage = lazy(() => import("./pages/HermesPortal").then((m) => ({ default: m.HermesPortal })));
const ProjectsPage = lazy(() => import("../subapps/main-admin/src/pages/Projects").then((m) => ({ default: m.Projects })));
const RequirementsPage = lazy(() => import("../subapps/ai-rd-center/src/pages/Requirements").then((m) => ({ default: m.Requirements })));
const TasksPage = lazy(() => import("../subapps/ai-rd-center/src/pages/Tasks").then((m) => ({ default: m.Tasks })));
const WorkflowsPage = lazy(() => import("../subapps/ai-rd-center/src/pages/Workflows").then((m) => ({ default: m.Workflows })));
const OrganizationPage = lazy(() => import("../subapps/main-admin/src/pages/Organization").then((m) => ({ default: m.Organization })));
const NotifyPage = lazy(() => import("../subapps/ai-ops-center/src/pages/Notify").then((m) => ({ default: m.Notify })));
const AuditPage = lazy(() => import("../subapps/ai-ops-center/src/pages/Audit").then((m) => ({ default: m.Audit })));
const CopilotPage = lazy(() => import("../subapps/ai-rd-center/src/pages/Copilot").then((m) => ({ default: m.Copilot })));
const IntelligencePage = lazy(() => import("../subapps/ai-foundation/src/pages/Intelligence").then((m) => ({ default: m.Intelligence })));
const MarketplacePage = lazy(() => import("../subapps/ai-foundation/src/pages/Marketplace").then((m) => ({ default: m.Marketplace })));
const PlatformsPage = lazy(() => import("../subapps/ai-foundation/src/pages/Platforms").then((m) => ({ default: m.Platforms })));
const SystemMapPage = lazy(() => import("../subapps/ai-ops-center/src/pages/SystemMap").then((m) => ({ default: m.SystemMap })));
const IssuesWorkbenchPage = lazy(() => import("../subapps/ai-rd-center/src/pages/delivery/IssuesWorkbench").then((m) => ({ default: m.IssuesWorkbench })));
const SpecsWorkbenchPage = lazy(() => import("../subapps/ai-rd-center/src/pages/intelligence/SpecsWorkbench").then((m) => ({ default: m.SpecsWorkbench })));
const DesignDocsWorkbenchPage = lazy(() =>
  import("../subapps/ai-rd-center/src/pages/intelligence/DesignDocsWorkbench").then((m) => ({ default: m.DesignDocsWorkbench })),
);
const SkillsHubPage = lazy(() => import("../subapps/ai-foundation/src/pages/ecosystem/SkillsHub").then((m) => ({ default: m.SkillsHub })));
const DevFlowWorkbenchPage = lazy(() => import("../subapps/ai-rd-center/src/pages/delivery/DevFlowWorkbench").then((m) => ({ default: m.DevFlowWorkbench })));
const VibeWorkbenchPage = lazy(() => import("../subapps/ai-rd-center/src/pages/ai/VibeWorkbench").then((m) => ({ default: m.VibeWorkbench })));
const GlobalSearchWorkbenchPage = lazy(() => import("../subapps/ai-rd-center/src/pages/ai/GlobalSearchWorkbench").then((m) => ({ default: m.GlobalSearchWorkbench })));
const CliToolsWorkbenchPage = lazy(() => import("../subapps/ai-foundation/src/pages/ecosystem/CliToolsWorkbench").then((m) => ({ default: m.CliToolsWorkbench })));
const EnvOpsWorkbenchPage = lazy(() => import("../subapps/ai-ops-center/src/pages/system/EnvOpsWorkbench").then((m) => ({ default: m.EnvOpsWorkbench })));
const OrchestrationStudioPage = lazy(() => import("../subapps/ai-rd-center/src/pages/delivery/OrchestrationStudio").then((m) => ({ default: m.OrchestrationStudio })));
const WebhooksWorkbenchPage = lazy(() => import("../subapps/ai-ops-center/src/pages/ecosystem/WebhooksWorkbench").then((m) => ({ default: m.WebhooksWorkbench })));
const DataSourcesWorkbenchPage = lazy(() =>
  import("../subapps/ai-data-center/src/pages/intelligence/DataSourcesWorkbench").then((m) => ({ default: m.DataSourcesWorkbench })),
);
const MetadataManagementWorkbenchPage = lazy(() =>
  import("../subapps/ai-data-center/src/pages/data/MetadataManagementWorkbench").then((m) => ({ default: m.MetadataManagementWorkbench })),
);
const LineageWorkbenchPage = lazy(() =>
  import("../subapps/ai-data-center/src/pages/data/LineageWorkbench").then((m) => ({ default: m.LineageWorkbench })),
);
const AnalyticsOverviewWorkbenchPage = lazy(() =>
  import("../subapps/ai-data-center/src/pages/data/AnalyticsOverviewWorkbench").then((m) => ({ default: m.AnalyticsOverviewWorkbench })),
);
const AnalyticsNlqWorkbenchPage = lazy(() =>
  import("../subapps/ai-data-center/src/pages/data/AnalyticsNlqWorkbench").then((m) => ({ default: m.AnalyticsNlqWorkbench })),
);
const DataGovernanceHubPage = lazy(() =>
  import("../subapps/ai-data-center/src/pages/data/governance/DataGovernanceHub").then((m) => ({ default: m.DataGovernanceHub })),
);
const DataGovernanceModulePage = lazy(() =>
  import("../subapps/ai-data-center/src/pages/data/governance/DataGovernanceModulePage").then((m) => ({ default: m.DataGovernanceModulePage })),
);
const AnalyticsBlueprintWorkbenchPage = lazy(() =>
  import("../subapps/ai-data-center/src/pages/data/AnalyticsBlueprintWorkbench").then((m) => ({ default: m.AnalyticsBlueprintWorkbench })),
);
const DataExchangeWorkbenchPage = lazy(() =>
  import("../subapps/ai-data-center/src/pages/data/DataExchangeWorkbench").then((m) => ({ default: m.DataExchangeWorkbench })),
);
const IntelligenceHubPage = lazy(() =>
  import("../subapps/ai-foundation/src/pages/intelligence/IntelligenceHub").then((m) => ({ default: m.IntelligenceHub })),
);
const AnalyticsReportsWorkbenchPage = lazy(() =>
  import("../subapps/ai-data-center/src/pages/data/AnalyticsReportsWorkbench").then((m) => ({ default: m.AnalyticsReportsWorkbench })),
);
const PlatformsHubPage = lazy(() =>
  import("../subapps/ai-foundation/src/pages/ecosystem/PlatformsHub").then((m) => ({ default: m.PlatformsHub })),
);
const SkillsHubLandingPage = lazy(() =>
  import("../subapps/ai-foundation/src/pages/ecosystem/SkillsHubLanding").then((m) => ({ default: m.SkillsHubLanding })),
);
const CopilotHubPage = lazy(() => import("../subapps/ai-rd-center/src/pages/ai/CopilotHub").then((m) => ({ default: m.CopilotHub })));
const AuditHubPage = lazy(() => import("../subapps/ai-ops-center/src/pages/governance/AuditHub").then((m) => ({ default: m.AuditHub })));
const SystemMapHubPage = lazy(() => import("../subapps/ai-ops-center/src/pages/governance/SystemMapHub").then((m) => ({ default: m.SystemMapHub })));
const MicroAppGovernancePage = lazy(() =>
  import("../subapps/ai-ops-center/src/pages/governance/MicroAppGovernance").then((m) => ({ default: m.MicroAppGovernance })),
);
const MenuManagementPage = lazy(() => import("./pages/admin/MenuManagement").then((m) => ({ default: m.MenuManagement })));
const PermissionMatrixPage = lazy(() => import("./pages/admin/PermissionMatrix").then((m) => ({ default: m.PermissionMatrix })));
const MicroAppRegistryPage = lazy(() => import("./pages/admin/MicroAppRegistry").then((m) => ({ default: m.MicroAppRegistry })));
const SettingsPage = lazy(() => import("../subapps/ai-ops-center/src/pages/Settings").then((m) => ({ default: m.Settings })));
const ProjectsHubPage = lazy(() => import("../subapps/main-admin/src/pages/portfolio/ProjectsHub").then((m) => ({ default: m.ProjectsHub })));
const OrganizationHubPage = lazy(() =>
  import("../subapps/main-admin/src/pages/portfolio/OrganizationHub").then((m) => ({ default: m.OrganizationHub })),
);
const RequirementsHubPage = lazy(() =>
  import("../subapps/ai-rd-center/src/pages/product/RequirementsHub").then((m) => ({ default: m.RequirementsHub })),
);
const TasksHubPage = lazy(() => import("../subapps/ai-rd-center/src/pages/delivery/TasksHub").then((m) => ({ default: m.TasksHub })));
const WorkflowsHubPage = lazy(() => import("../subapps/ai-rd-center/src/pages/delivery/WorkflowsHub").then((m) => ({ default: m.WorkflowsHub })));
const SettingsHubPage = lazy(() => import("../subapps/ai-ops-center/src/pages/system/SettingsHub").then((m) => ({ default: m.SettingsHub })));
const DashboardHubPage = lazy(() =>
  import("../subapps/main-admin/src/pages/overview/DashboardHub").then((m) => ({ default: m.DashboardHub })),
);
const DevFlowHubPage = lazy(() => import("../subapps/ai-rd-center/src/pages/delivery/DevFlowHub").then((m) => ({ default: m.DevFlowHub })));
const IssuesHubPage = lazy(() => import("../subapps/ai-rd-center/src/pages/delivery/IssuesHub").then((m) => ({ default: m.IssuesHub })));
const MarketplaceHubPage = lazy(() =>
  import("../subapps/ai-foundation/src/pages/ecosystem/MarketplaceHub").then((m) => ({ default: m.MarketplaceHub })),
);
const NotifyHubPage = lazy(() => import("../subapps/ai-ops-center/src/pages/ecosystem/NotifyHub").then((m) => ({ default: m.NotifyHub })));
const OrchestrationHubPage = lazy(() =>
  import("../subapps/ai-rd-center/src/pages/delivery/OrchestrationHub").then((m) => ({ default: m.OrchestrationHub })),
);
const EnvOpsHubPage = lazy(() => import("../subapps/ai-ops-center/src/pages/system/EnvOpsHub").then((m) => ({ default: m.EnvOpsHub })));
const AnalyticsDataHubPage = lazy(() =>
  import("../subapps/ai-data-center/src/pages/data/AnalyticsDataHub").then((m) => ({ default: m.AnalyticsDataHub })),
);
const SearchHubPage = lazy(() => import("../subapps/ai-rd-center/src/pages/ai/SearchHub").then((m) => ({ default: m.SearchHub })));
const VibeHubPage = lazy(() => import("../subapps/ai-rd-center/src/pages/ai/VibeHub").then((m) => ({ default: m.VibeHub })));
// --- new modules ---
const AgentOpsHubPage = lazy(() => import("../subapps/ai-foundation/src/pages/ai/AgentOpsHub").then((m) => ({ default: m.AgentOpsHub })));
const LlmGatewayHubPage = lazy(() => import("../subapps/ai-foundation/src/pages/ai/LlmGatewayHub").then((m) => ({ default: m.LlmGatewayHub })));
const KnowledgeGraphHubPage = lazy(() => import("../subapps/ai-foundation/src/pages/ai/KnowledgeGraphHub").then((m) => ({ default: m.KnowledgeGraphHub })));
const A2aGatewayHubPage = lazy(() => import("../subapps/ai-foundation/src/pages/ecosystem/A2aGatewayHub").then((m) => ({ default: m.A2aGatewayHub })));
const OpsCenterHubPage = lazy(() => import("../subapps/ai-ops-center/src/pages/system/OpsCenterHub").then((m) => ({ default: m.OpsCenterHub })));
const DataIngestHubPage = lazy(() => import("../subapps/ai-data-center/src/pages/data/DataIngestHub").then((m) => ({ default: m.DataIngestHub })));
const DataQualityHubPage = lazy(() => import("../subapps/ai-data-center/src/pages/data/DataQualityHub").then((m) => ({ default: m.DataQualityHub })));
const MetricsCenterHubPage = lazy(() => import("../subapps/ai-data-center/src/pages/data/MetricsCenterHub").then((m) => ({ default: m.MetricsCenterHub })));
const TagServiceHubPage = lazy(() => import("../subapps/ai-data-center/src/pages/data/TagServiceHub").then((m) => ({ default: m.TagServiceHub })));
const DataDevWorkbenchPage = lazy(() => import("../subapps/ai-data-center/src/pages/data/DataDevWorkbench").then((m) => ({ default: m.DataDevWorkbench })));
const LlmGatewayWorkbenchPage = lazy(() => import("../subapps/ai-foundation/src/pages/ai/LlmGatewayWorkbench").then((m) => ({ default: m.LlmGatewayWorkbench })));
const KnowledgeGraphWorkbenchPage = lazy(() => import("../subapps/ai-foundation/src/pages/ai/KnowledgeGraphWorkbench").then((m) => ({ default: m.KnowledgeGraphWorkbench })));
const DataIngestWorkbenchPage = lazy(() => import("../subapps/ai-data-center/src/pages/data/DataIngestWorkbench").then((m) => ({ default: m.DataIngestWorkbench })));
const DataQualityWorkbenchPage = lazy(() => import("../subapps/ai-data-center/src/pages/data/DataQualityWorkbench").then((m) => ({ default: m.DataQualityWorkbench })));
const MetricsWorkbenchPage = lazy(() => import("../subapps/ai-data-center/src/pages/data/MetricsWorkbench").then((m) => ({ default: m.MetricsWorkbench })));
const TagWorkbenchPage = lazy(() => import("../subapps/ai-data-center/src/pages/data/TagWorkbench").then((m) => ({ default: m.TagWorkbench })));
const AgentRunsWorkbenchPage = lazy(() => import("../subapps/ai-foundation/src/pages/ai/AgentRunsWorkbench").then((m) => ({ default: m.AgentRunsWorkbench })));
const A2aWorkbenchPage = lazy(() => import("../subapps/ai-foundation/src/pages/ecosystem/A2aWorkbench").then((m) => ({ default: m.A2aWorkbench })));
const OpsCenterWorkbenchPage = lazy(() => import("../subapps/ai-ops-center/src/pages/system/OpsCenterWorkbench").then((m) => ({ default: m.OpsCenterWorkbench })));

function pageElement<P extends Record<string, unknown> = Record<string, never>>(
  Component: ComponentType<P>,
  props?: P,
): ReactElement {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-6 text-sm text-[var(--muted)]">
          Loading module...
        </div>
      }
    >
      <Component {...((props ?? {}) as P)} />
    </Suspense>
  );
}

export type NavGroupKey =
  | "overview"
  | "portfolio"
  | "product"
  | "delivery"
  | "data"
  | "ai"
  | "ecosystem"
  | "governance"
  | "system";

export type NavBadge = "new" | "beta" | "preview" | "alpha";
export type NavStatus = "stable" | "beta" | "deprecated";

export type NavItem = {
  key: string;
  path: string;
  el: ReactElement;
  group: NavGroupKey;
  icon: LucideIcon;
  category?: string;
  parentKey?: string;
  submodules?: readonly NavSubmodule[];
  legacy?: boolean;
  hidden?: boolean;
  external?: boolean;
  capability?: string;
  /** 视觉徽标（如 NEW/BETA），仅用于近 1-2 个发布周期 */
  badge?: NavBadge;
  /** 生命周期状态，过期模块标 deprecated 并准备移除 */
  status?: NavStatus;
  /** 描述：用于命令面板/Tooltip/AI prompt 上下文，默认走 i18n */
  description?: string;
  /** 键盘快捷键描述（仅展示，真实绑定见 useNavShortcuts） */
  shortcut?: string;
  /** 是否允许用户收藏（默认 true） */
  pinnable?: boolean;
};

export type NavSubmodule = {
  key: string;
  path?: string;
  capability?: string;
};

export type NavGroupDefinition = {
  key: NavGroupKey;
  i18nKey: `nav.group.${NavGroupKey}`;
  defaultCollapsed: boolean;
  capability: string;
  accent?: string;
};

/** 侧栏顶部固定高频入口（不受域折叠影响） */
export const PINNED_NAV_KEYS = ["hermesPortal", "dashboard", "requirements", "tasks"] as const;

export const NAV_GROUP_ACCENT: Record<NavGroupKey, string> = {
  overview: "var(--nav-accent-overview)",
  portfolio: "var(--nav-accent-portfolio)",
  product: "var(--nav-accent-product)",
  delivery: "var(--nav-accent-delivery)",
  data: "var(--nav-accent-data)",
  ai: "var(--nav-accent-ai)",
  ecosystem: "var(--nav-accent-ecosystem)",
  governance: "var(--nav-accent-governance)",
  system: "var(--nav-accent-system)",
};

export type NavCategoryDefinition = {
  key: string;
  group: NavGroupKey;
  i18nKey: `nav.category.${string}`;
  defaultCollapsed?: boolean;
};

export const NAV_GROUPS: readonly NavGroupDefinition[] = [
  { key: "overview", i18nKey: "nav.group.overview", defaultCollapsed: false, capability: "overview" },
  { key: "portfolio", i18nKey: "nav.group.portfolio", defaultCollapsed: false, capability: "portfolio" },
  { key: "product", i18nKey: "nav.group.product", defaultCollapsed: false, capability: "product" },
  { key: "delivery", i18nKey: "nav.group.delivery", defaultCollapsed: false, capability: "delivery" },
  { key: "data", i18nKey: "nav.group.data", defaultCollapsed: false, capability: "data" },
  { key: "ai", i18nKey: "nav.group.ai", defaultCollapsed: false, capability: "ai" },
  { key: "ecosystem", i18nKey: "nav.group.ecosystem", defaultCollapsed: false, capability: "ecosystem" },
  { key: "governance", i18nKey: "nav.group.governance", defaultCollapsed: false, capability: "governance" },
  { key: "system", i18nKey: "nav.group.system", defaultCollapsed: false, capability: "system" },
];

export const NAV_CATEGORIES: readonly NavCategoryDefinition[] = [
  { key: "overview-command", group: "overview", i18nKey: "nav.category.overviewCommand" },
  { key: "project-lifecycle", group: "portfolio", i18nKey: "nav.category.projectLifecycle" },
  { key: "org-governance", group: "portfolio", i18nKey: "nav.category.orgGovernance" },
  { key: "requirement-intake", group: "product", i18nKey: "nav.category.requirementIntake" },
  { key: "requirement-ai-governance", group: "product", i18nKey: "nav.category.requirementAiGovernance" },
  { key: "delivery-execution", group: "delivery", i18nKey: "nav.category.deliveryExecution" },
  { key: "dependency-scheduling", group: "delivery", i18nKey: "nav.category.dependencyScheduling" },
  { key: "workflow-orchestration", group: "delivery", i18nKey: "nav.category.workflowOrchestration" },
  { key: "data-strategy", group: "data", i18nKey: "nav.category.dataStrategy" },
  { key: "data-insight-reporting", group: "data", i18nKey: "nav.category.dataInsightReporting" },
  { key: "data-asset-governance", group: "data", i18nKey: "nav.category.dataAssetGovernance" },
  { key: "data-engineering-ops", group: "data", i18nKey: "nav.category.dataEngineeringOps", defaultCollapsed: true },
  { key: "ai-command", group: "ai", i18nKey: "nav.category.aiCommand" },
  { key: "ai-knowledge", group: "ai", i18nKey: "nav.category.aiKnowledge" },
  { key: "ai-runtime-ops", group: "ai", i18nKey: "nav.category.aiRuntimeOps", defaultCollapsed: true },
  { key: "agent-platform", group: "ecosystem", i18nKey: "nav.category.agentPlatform" },
  { key: "asset-market", group: "ecosystem", i18nKey: "nav.category.assetMarket" },
  { key: "communication-integration", group: "ecosystem", i18nKey: "nav.category.communicationIntegration" },
  { key: "security-audit", group: "governance", i18nKey: "nav.category.securityAudit" },
  { key: "module-governance", group: "governance", i18nKey: "nav.category.moduleGovernance" },
  { key: "runtime-config", group: "system", i18nKey: "nav.category.runtimeConfig" },
  { key: "smart-ops", group: "system", i18nKey: "nav.category.smartOps" },
  { key: "data-ingest", group: "data", i18nKey: "nav.category.dataIngest" },
  { key: "data-quality-center", group: "data", i18nKey: "nav.category.dataQualityCenter" },
  { key: "data-metrics-tags", group: "data", i18nKey: "nav.category.dataMetricsTags" },
  { key: "ai-agent-ops", group: "ai", i18nKey: "nav.category.aiAgentOps" },
  { key: "ai-model-ops", group: "ai", i18nKey: "nav.category.aiModelOps" },
  { key: "a2a-protocol", group: "ecosystem", i18nKey: "nav.category.a2aProtocol" },
];

export const DEFAULT_CATEGORY_COLLAPSE: Record<string, boolean> = Object.fromEntries(
  NAV_CATEGORIES.map((category) => [category.key, Boolean(category.defaultCollapsed)]),
) as Record<string, boolean>;

const NAV_CATEGORY_BY_KEY = Object.fromEntries(NAV_CATEGORIES.map((category) => [category.key, category]));

const ITEM_CATEGORY: Record<string, string> = {
  dashboard: "overview-command",
  dashboardCockpit: "overview-command",
  projects: "project-lifecycle",
  organization: "org-governance",
  requirements: "requirement-intake",
  requirementPool: "requirement-intake",
  requirementReview: "requirement-ai-governance",
  requirementGeneration: "requirement-ai-governance",
  requirementBatch: "requirement-ai-governance",
  tasks: "delivery-execution",
  taskDependencies: "dependency-scheduling",
  taskScheduler: "dependency-scheduling",
  issues: "delivery-execution",
  devFlow: "delivery-execution",
  devFlowWorkbench: "delivery-execution",
  issuesTracker: "delivery-execution",
  orchestration: "workflow-orchestration",
  orchestrationStudio: "workflow-orchestration",
  workflows: "workflow-orchestration",
  analytics: "data-insight-reporting",
  analyticsOverview: "data-insight-reporting",
  analyticsBlueprint: "data-strategy",
  analyticsReports: "data-insight-reporting",
  reportAssets: "data-insight-reporting",
  reportSubscription: "data-insight-reporting",
  reportActionTasks: "data-insight-reporting",
  analyticsCatalog: "data-asset-governance",
  dataAssets: "data-asset-governance",
  metadataManagement: "data-asset-governance",
  metadataOverview: "data-asset-governance",
  metadataAssets: "data-asset-governance",
  metadataFields: "data-asset-governance",
  metadataLineage: "data-asset-governance",
  dataMetricsTags: "data-asset-governance",
  dataServices: "data-asset-governance",
  dataQuality: "data-asset-governance",
  dataDevelopment: "data-engineering-ops",
  analyticsLineage: "data-asset-governance",
  dataExchange: "data-engineering-ops",
  analyticsNlq: "data-insight-reporting",
  copilot: "ai-command",
  copilotChat: "ai-command",
  copilotCommands: "ai-command",
  copilotToolPlan: "ai-command",
  vibe: "ai-command",
  vibeWorkspace: "ai-command",
  globalSearch: "ai-command",
  searchWorkbench: "ai-command",
  intelligence: "ai-knowledge",
  knowledgeBase: "ai-knowledge",
  ragSearch: "ai-knowledge",
  aiMemory: "ai-knowledge",
  ruleCenter: "ai-knowledge",
  reflectionDistill: "ai-knowledge",
  specs: "ai-knowledge",
  designDocs: "ai-knowledge",
  intelligenceDataSources: "ai-knowledge",
  dataSources: "data-ingest",
  dataSourcesOverview: "data-ingest",
  dataSourcesConnections: "data-ingest",
  dataSourcesMetadata: "data-ingest",
  dataSourcesSecurity: "data-ingest",
  workerOps: "ai-runtime-ops",
  syncOps: "ai-runtime-ops",
  eventStream: "ai-runtime-ops",
  usageOps: "ai-runtime-ops",
  platforms: "agent-platform",
  platformTools: "agent-platform",
  mcpHub: "agent-platform",
  agentRegistry: "agent-platform",
  agentRuns: "agent-platform",
  modelOps: "agent-platform",
  platformOps: "agent-platform",
  cliTools: "agent-platform",
  marketplace: "asset-market",
  marketplaceCatalog: "asset-market",
  marketplaceInstalled: "asset-market",
  marketplaceRatings: "asset-market",
  skillsHub: "asset-market",
  skillsCatalog: "asset-market",
  skillsRepos: "asset-market",
  notify: "communication-integration",
  notifyChannels: "communication-integration",
  notifyOutbound: "communication-integration",
  notifyInbound: "communication-integration",
  notifyConnectors: "communication-integration",
  notifyMessages: "communication-integration",
  notifySubscriptions: "communication-integration",
  notifySubscriptionRuns: "communication-integration",
  webhooks: "communication-integration",
  envOps: "runtime-config",
  envOpsWorkbench: "runtime-config",
  audit: "security-audit",
  auditChain: "security-audit",
  auditEvents: "security-audit",
  auditModuleActions: "security-audit",
  auditApprovals: "security-audit",
  systemMap: "module-governance",
  pageRegistry: "module-governance",
  moduleContract: "module-governance",
  moduleManifest: "module-governance",
  capabilityGovernance: "module-governance",
  moduleActionCatalog: "module-governance",
  menuManagement: "module-governance",
  permissionMatrix: "module-governance",
  microAppRegistry: "module-governance",
  settings: "runtime-config",
  settingsAccount: "runtime-config",
  settingsRuntime: "runtime-config",
  settingsWorkspace: "runtime-config",
  settingsSso: "runtime-config",
  settingsBilling: "runtime-config",
  settingsProfiles: "runtime-config",
  settingsObservability: "runtime-config",
  settingsStorage: "runtime-config",
  settingsAppearance: "runtime-config",
  projectPortfolio: "project-lifecycle",
  projectBusinesses: "project-lifecycle",
  projectTenants: "project-lifecycle",
  tenantUsers: "project-lifecycle",
  projectMembers: "project-lifecycle",
  projectDeliveryKit: "project-lifecycle",
  projectOnboarding: "project-lifecycle",
  projectOnboardingOverview: "project-lifecycle",
  projectOnboardingCommands: "project-lifecycle",
  projectOnboardingEnv: "project-lifecycle",
  projectOnboardingAgent: "project-lifecycle",
  projectOnboardingProfiles: "project-lifecycle",
  projectOnboardingContext: "project-lifecycle",
  projectTemplates: "project-lifecycle",
  projectTemplatesOverview: "project-lifecycle",
  projectTemplatesCatalog: "project-lifecycle",
  projectTemplatesClone: "project-lifecycle",
  projectTemplatesCapabilities: "project-lifecycle",
  projectGovernance: "project-lifecycle",
  projectGovernanceReview: "project-lifecycle",
  projectGovernanceOps: "project-lifecycle",
  projectGovernanceActions: "project-lifecycle",
  projectGovernancePrompt: "project-lifecycle",
  orgTenantUsers: "org-governance",
  orgBusinesses: "org-governance",
  orgProjectMembers: "org-governance",
  orgRolePolicy: "org-governance",
  workflowTemplates: "workflow-orchestration",
  workflowInstances: "workflow-orchestration",
  workflowEvents: "workflow-orchestration",
  workflowSignals: "workflow-orchestration",
  taskExecution: "delivery-execution",
  taskBoard: "delivery-execution",
  taskSprints: "delivery-execution",
  // new modules
  agentOps: "ai-agent-ops",
  agentOpsRuns: "ai-agent-ops",
  agentOpsHeartbeat: "ai-agent-ops",
  agentOpsProfiles: "ai-agent-ops",
  agentOpsRetry: "ai-agent-ops",
  llmGateway: "ai-model-ops",
  llmGatewayHealth: "ai-model-ops",
  llmGatewayPolicy: "ai-model-ops",
  llmGatewayRoutes: "ai-model-ops",
  llmGatewayDecision: "ai-model-ops",
  llmGatewayDrill: "ai-model-ops",
  llmGatewayCost: "ai-model-ops",
  llmGatewayAttribution: "ai-model-ops",
  llmGatewayEval: "ai-model-ops",
  llmGatewayAudit: "ai-model-ops",
  llmGatewayThrottle: "ai-model-ops",
  knowledgeGraph: "ai-knowledge",
  knowledgeGraphBuild: "ai-knowledge",
  knowledgeGraphQuery: "ai-knowledge",
  knowledgeGraphLineage: "ai-knowledge",
  knowledgeGraphProfile: "ai-knowledge",
  a2aGateway: "a2a-protocol",
  a2aRegistry: "a2a-protocol",
  a2aNegotiate: "a2a-protocol",
  a2aDispatch: "a2a-protocol",
  a2aEvidence: "a2a-protocol",
  opsCenter: "smart-ops",
  opsCenterPipeline: "smart-ops",
  opsCenterRca: "smart-ops",
  opsCenterRunbook: "smart-ops",
  opsCenterSelfHeal: "smart-ops",
  dataIngest: "data-ingest",
  dataIngestConnectors: "data-ingest",
  dataIngestSchema: "data-ingest",
  dataIngestCdc: "data-ingest",
  dataIngestBatch: "data-ingest",
  dataQualityCenter: "data-quality-center",
  dataQualityRules: "data-quality-center",
  dataQualityRuns: "data-quality-center",
  dataQualityAlerts: "data-quality-center",
  dataQualityReports: "data-quality-center",
  metricsCenter: "data-metrics-tags",
  metricsCatalog: "data-metrics-tags",
  metricsSemantic: "data-metrics-tags",
  metricsApiPublish: "data-metrics-tags",
  metricsMonitor: "data-metrics-tags",
  tagService: "data-metrics-tags",
  tagCatalog: "data-metrics-tags",
  tagRules: "data-metrics-tags",
  tagOntology: "data-metrics-tags",
  tagApi: "data-metrics-tags",
  dataDev: "data-engineering-ops",
};

export const GROUP_ORDER: NavGroupKey[] = NAV_GROUPS.map((group) => group.key);

export const DEFAULT_COLLAPSE: Record<NavGroupKey, boolean> = Object.fromEntries(
  NAV_GROUPS.map((group) => [group.key, group.defaultCollapsed]),
) as Record<NavGroupKey, boolean>;

function subnav(pageKey: string, ...keys: string[]): readonly NavSubmodule[] {
  return keys.map((key) => ({
    key,
    path: `#/${pageKey}/${key}`,
    capability: `${pageKey}.${key}`,
  }));
}

export const NAV: readonly NavItem[] = [
  { key: "hermesPortal", path: "#/portal", el: pageElement(HermesPortalPage), group: "overview", icon: Network, category: "overview-command", capability: "overview.portal.management.read", badge: "new", description: "门户管理：统一身份、统一上下文、统一菜单权限契约、统一微应用注册与运行治理" },
  { key: "microAppMainAdmin", path: "#/apps/main-admin", el: pageElement(MicroAppPortalPage, { appId: "main-admin" }), group: "overview", icon: LayoutDashboard, category: "overview-command", capability: "overview.apps.main-admin", badge: "new", description: "基础管理中心：账号、权限、组织、项目、服务、菜单契约与微应用注册治理" },
  { key: "microAppAiFoundation", path: "#/apps/ai-foundation", el: pageElement(MicroAppPortalPage, { appId: "ai-foundation" }), group: "ai", icon: Brain, category: "ai-command", capability: "ai.apps.foundation", badge: "new", description: "智能基础服务：开发环境、CLI、知识、记忆、技能、插件、Agent 与 MCP/A2A" },
  { key: "microAppAiRdCenter", path: "#/apps/ai-rd-center", el: pageElement(MicroAppPortalPage, { appId: "ai-rd-center" }), group: "delivery", icon: GitBranch, category: "delivery-execution", capability: "delivery.apps.rd-center", badge: "new", description: "智能研发中心：需求、方案、任务、AI 开发、调度、监控、质量评审与运维" },
  { key: "microAppAiDataCenter", path: "#/apps/ai-data-center", el: pageElement(MicroAppPortalPage, { appId: "ai-data-center" }), group: "data", icon: Database, category: "data-strategy", capability: "data.apps.data-center", badge: "new", description: "智能数据中心：数据源、接入、元数据、开发、调度、指标、标签与数据服务" },
  { key: "microAppAiOpsCenter", path: "#/apps/ai-ops-center", el: pageElement(MicroAppPortalPage, { appId: "ai-ops-center" }), group: "system", icon: ShieldCheck, category: "smart-ops", capability: "system.apps.ops-center", badge: "new", description: "智能运营中心：计费、安全审计、企业 SSO、通信集成与智能运维" },
  { key: "dashboard", path: "#/dashboard", el: pageElement(DashboardHubPage), group: "overview", icon: LayoutDashboard, category: "overview-command", capability: "overview.dashboard", shortcut: "g d", description: "运营指挥治理中心：全局指标、风险与跨域入口", submodules: subnav("dashboard", "executive_overview", "platform_blueprint", "risk_board", "technology_upgrade", "next_actions") },
  { key: "dashboardCockpit", path: "#/dashboard/cockpit", el: pageElement(DashboardPage), group: "overview", icon: LayoutDashboard, category: "overview-command", capability: "overview.dashboard.cockpit", description: "完整运营驾驶舱：趋势、蓝图与行动项" },
  { key: "projects", path: "#/projects", el: pageElement(ProjectsHubPage), group: "portfolio", icon: FolderKanban, category: "project-lifecycle", capability: "portfolio.projects", description: "项目组合治理中心：组合、业务线、成员与 AI 交付套件", submodules: subnav("projects", "portfolio", "tenants", "tenant_users", "project_members", "delivery-kit") },
  { key: "projectPortfolio", path: "#/projects/portfolio", el: pageElement(ProjectsPage, { initialTab: "portfolio", focused: true }), group: "portfolio", icon: FolderKanban, category: "project-lifecycle", capability: "portfolio.projects.portfolio" },
  { key: "projectBusinesses", path: "#/projects/businesses", el: pageElement(ProjectsPage, { initialTab: "business", focused: true }), group: "portfolio", icon: Building2, category: "project-lifecycle", capability: "portfolio.projects.businesses", hidden: true, parentKey: "projects", description: "业务线治理兼容入口，主菜单收敛到项目组合工作区" },
  { key: "projectTenants", path: "#/projects/tenants", el: pageElement(ProjectsPage, { initialTab: "tenants", focused: true }), group: "portfolio", icon: Building2, category: "project-lifecycle", capability: "portfolio.projects.tenants" },
  { key: "tenantUsers", path: "#/projects/users", el: pageElement(ProjectsPage, { initialTab: "users", focused: true }), group: "portfolio", icon: UserCogIcon, category: "project-lifecycle", capability: "portfolio.projects.tenant-users" },
  { key: "projectMembers", path: "#/projects/members", el: pageElement(ProjectsPage, { initialTab: "members", focused: true }), group: "portfolio", icon: UsersIcon, category: "project-lifecycle", capability: "portfolio.projects.members" },
  {
    key: "projectDeliveryKit",
    path: "#/projects/delivery-kit",
    el: pageElement(ProjectsPage, { initialTab: "templates", focused: true, templatePanel: "overview" }),
    group: "portfolio",
    icon: Package,
    category: "project-lifecycle",
    capability: "portfolio.projects.delivery-kit",
    badge: "new",
    description: "AI 交付套件：项目模板 → AI 接入 → 智能治理 一站式配置",
    submodules: [
      { key: "templates", path: "#/projects/templates/overview", capability: "portfolio.projects.templates" },
      { key: "onboarding", path: "#/projects/onboarding/overview", capability: "portfolio.projects.onboarding" },
      { key: "governance", path: "#/projects/governance/review", capability: "portfolio.projects.governance" },
    ],
  },
  {
    key: "projectOnboarding",
    path: "#/projects/onboarding",
    el: pageElement(ProjectsPage, { initialTab: "onboarding", focused: true, onboardingPanel: "overview" }),
    group: "portfolio",
    icon: TerminalIcon,
    category: "project-lifecycle",
    capability: "portfolio.projects.onboarding",
    hidden: true,
  },
  { key: "projectOnboardingOverview", path: "#/projects/onboarding/overview", el: pageElement(ProjectsPage, { initialTab: "onboarding", focused: true, onboardingPanel: "overview" }), group: "portfolio", icon: Gauge, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.onboarding.overview" },
  { key: "projectOnboardingCommands", path: "#/projects/onboarding/commands", el: pageElement(ProjectsPage, { initialTab: "onboarding", focused: true, onboardingPanel: "commands" }), group: "portfolio", icon: TerminalIcon, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.onboarding.commands" },
  { key: "projectOnboardingEnv", path: "#/projects/onboarding/env", el: pageElement(ProjectsPage, { initialTab: "onboarding", focused: true, onboardingPanel: "env" }), group: "portfolio", icon: KeyRound, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.onboarding.env" },
  { key: "projectOnboardingAgent", path: "#/projects/onboarding/agent", el: pageElement(ProjectsPage, { initialTab: "onboarding", focused: true, onboardingPanel: "agent" }), group: "portfolio", icon: FileCode, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.onboarding.agent-toml" },
  { key: "projectOnboardingProfiles", path: "#/projects/onboarding/profiles", el: pageElement(ProjectsPage, { initialTab: "onboarding", focused: true, onboardingPanel: "profiles" }), group: "portfolio", icon: Wrench, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.onboarding.tool-profiles" },
  { key: "projectOnboardingContext", path: "#/projects/onboarding/context", el: pageElement(ProjectsPage, { initialTab: "onboarding", focused: true, onboardingPanel: "context" }), group: "portfolio", icon: Network, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.onboarding.context-assets" },
  {
    key: "projectTemplates",
    path: "#/projects/templates",
    el: pageElement(ProjectsPage, { initialTab: "templates", focused: true, templatePanel: "overview" }),
    group: "portfolio",
    icon: CopyIcon,
    category: "project-lifecycle",
    capability: "portfolio.projects.templates",
    hidden: true,
  },
  { key: "projectTemplatesOverview", path: "#/projects/templates/overview", el: pageElement(ProjectsPage, { initialTab: "templates", focused: true, templatePanel: "overview" }), group: "portfolio", icon: Gauge, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.templates.overview" },
  { key: "projectTemplatesCatalog", path: "#/projects/templates/catalog", el: pageElement(ProjectsPage, { initialTab: "templates", focused: true, templatePanel: "catalog" }), group: "portfolio", icon: CopyIcon, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.templates.catalog" },
  { key: "projectTemplatesClone", path: "#/projects/templates/clone", el: pageElement(ProjectsPage, { initialTab: "templates", focused: true, templatePanel: "clone" }), group: "portfolio", icon: GitBranch, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.templates.clone" },
  { key: "projectTemplatesCapabilities", path: "#/projects/templates/capabilities", el: pageElement(ProjectsPage, { initialTab: "templates", focused: true, templatePanel: "capabilities" }), group: "portfolio", icon: ShieldCheck, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.templates.capabilities" },
  {
    key: "projectGovernance",
    path: "#/projects/governance",
    el: pageElement(ProjectsPage, { initialTab: "governance", focused: true, governancePanel: "review" }),
    group: "portfolio",
    icon: SparklesIcon,
    category: "project-lifecycle",
    capability: "portfolio.projects.governance",
    hidden: true,
  },
  { key: "projectGovernanceReview", path: "#/projects/governance/review", el: pageElement(ProjectsPage, { initialTab: "governance", focused: true, governancePanel: "review" }), group: "portfolio", icon: SearchCheck, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.governance.review" },
  { key: "projectGovernanceOps", path: "#/projects/governance/ops", el: pageElement(ProjectsPage, { initialTab: "governance", focused: true, governancePanel: "ops" }), group: "portfolio", icon: TerminalIcon, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.governance.ops" },
  { key: "projectGovernanceActions", path: "#/projects/governance/actions", el: pageElement(ProjectsPage, { initialTab: "governance", focused: true, governancePanel: "actions" }), group: "portfolio", icon: ListChecks, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.governance.actions" },
  { key: "projectGovernancePrompt", path: "#/projects/governance/prompt", el: pageElement(ProjectsPage, { initialTab: "governance", focused: true, governancePanel: "prompt" }), group: "portfolio", icon: FileText, category: "project-lifecycle", parentKey: "projectDeliveryKit", hidden: true, capability: "portfolio.projects.governance.prompt" },
  { key: "organization", path: "#/organization", el: pageElement(OrganizationHubPage), group: "portfolio", icon: Building2, category: "org-governance", capability: "portfolio.organization", description: "组织权限治理中心：成员、业务线、项目成员、角色策略与权限体检", submodules: subnav("organization", "tenant_users", "business_lines", "project_members", "role_policy", "access_review") },
  { key: "orgTenantUsers", path: "#/organization/users", el: pageElement(OrganizationPage, { initialTab: "users", focused: true }), group: "portfolio", icon: UserCogIcon, category: "org-governance", capability: "portfolio.organization.tenant-users" },
  { key: "orgBusinesses", path: "#/organization/businesses", el: pageElement(OrganizationPage, { initialTab: "businesses", focused: true }), group: "portfolio", icon: Building2, category: "org-governance", capability: "portfolio.organization.businesses" },
  { key: "orgProjectMembers", path: "#/organization/project-members", el: pageElement(OrganizationPage, { initialTab: "projectMembers", focused: true }), group: "portfolio", icon: UsersIcon, category: "org-governance", capability: "portfolio.organization.project-members" },
  { key: "orgRolePolicy", path: "#/organization/role-policy", el: pageElement(OrganizationPage, { initialTab: "rolePolicy", focused: true }), group: "portfolio", icon: ShieldCheck, category: "org-governance", capability: "portfolio.organization.role-policy" },
  { key: "orgAccessReview", path: "#/organization/access-review", el: pageElement(OrganizationPage, { initialTab: "accessReview", focused: true }), group: "portfolio", icon: ShieldCheck, category: "org-governance", capability: "portfolio.organization.access-review" },
  {
    key: "productRequirementsWorkbench",
    path: "#/requirements/pool",
    el: pageElement(RequirementsPage, { initialMode: "pool", focused: true }),
    group: "product",
    icon: Library,
    category: "requirement-intake",
    capability: "product.requirements.workbench",
    badge: "new",
    description: "需求治理工作台：需求池 → 智能评审 → 拆任务 → 批量治理",
    submodules: [
      { key: "pool", path: "#/requirements/pool", capability: "product.requirements.pool" },
      { key: "review", path: "#/requirements/review", capability: "product.requirements.review" },
      { key: "generation", path: "#/requirements/generation", capability: "product.requirements.generation" },
      { key: "batch", path: "#/requirements/batch", capability: "product.requirements.batch" },
    ],
  },
  { key: "requirements", path: "#/requirements", el: pageElement(RequirementsHubPage), group: "product", icon: Library, category: "requirement-intake", capability: "product.requirements", shortcut: "g r", description: "需求治理中心：需求池、智能评审与拆任务" },
  { key: "requirementPool", path: "#/requirements/pool", el: pageElement(RequirementsPage, { initialMode: "pool", focused: true }), group: "product", icon: Library, category: "requirement-intake", capability: "product.requirements.pool", hidden: true, parentKey: "productRequirementsWorkbench" },
  { key: "requirementReview", path: "#/requirements/review", el: pageElement(RequirementsPage, { initialMode: "review", focused: true }), group: "product", icon: SearchCheck, category: "requirement-ai-governance", capability: "product.requirements.review", hidden: true, parentKey: "productRequirementsWorkbench" },
  { key: "requirementGeneration", path: "#/requirements/generation", el: pageElement(RequirementsPage, { initialMode: "generation", focused: true }), group: "product", icon: SparklesIcon, category: "requirement-ai-governance", capability: "product.requirements.generation", hidden: true, parentKey: "productRequirementsWorkbench" },
  { key: "requirementBatch", path: "#/requirements/batch", el: pageElement(RequirementsPage, { initialMode: "batch", focused: true }), group: "product", icon: Rows3, category: "requirement-ai-governance", capability: "product.requirements.batch", hidden: true, parentKey: "productRequirementsWorkbench" },
  { key: "tasks", path: "#/tasks", el: pageElement(TasksHubPage), group: "delivery", icon: ClipboardList, category: "delivery-execution", capability: "delivery.tasks", shortcut: "g t", description: "任务执行治理中心：列表、看板、迭代与调度", submodules: subnav("tasks", "execution_table", "kanban", "dag_dependencies", "scheduler_center", "agent_feed", "bulk_governance") },
  { key: "taskExecution", path: "#/tasks/execution", el: pageElement(TasksPage, { initialTab: "list", focused: true }), group: "delivery", icon: ClipboardList, category: "delivery-execution", capability: "delivery.tasks.execution" },
  { key: "taskBoard", path: "#/tasks/board", el: pageElement(TasksPage, { initialTab: "board", focused: true }), group: "delivery", icon: LayoutDashboard, category: "delivery-execution", capability: "delivery.tasks.board" },
  { key: "taskSprints", path: "#/tasks/sprints", el: pageElement(TasksPage, { initialTab: "sprint", focused: true }), group: "delivery", icon: Rows3, category: "delivery-execution", capability: "delivery.tasks.sprints" },
  { key: "taskDependencies", path: "#/tasks/dependencies", el: pageElement(TasksPage, { initialTab: "deps", focused: true }), group: "delivery", icon: GitBranch, category: "dependency-scheduling", capability: "delivery.tasks.dependencies" },
  { key: "taskScheduler", path: "#/tasks/scheduler", el: pageElement(TasksPage, { initialTab: "scheduler", focused: true }), group: "delivery", icon: Network, category: "dependency-scheduling", capability: "delivery.tasks.scheduler", badge: "beta" },
  { key: "issues", path: "#/issues", el: pageElement(IssuesHubPage), group: "delivery", icon: AlertCircle, category: "delivery-execution", capability: "delivery.issues", badge: "new", description: "缺陷治理中心：问题规模、严重度与跟踪入口", submodules: subnav("issues", "tracker", "link_tasks", "severity_board") },
  { key: "issuesTracker", path: "#/issues/tracker", el: pageElement(IssuesWorkbenchPage, { focused: true }), group: "delivery", icon: AlertCircle, category: "delivery-execution", capability: "delivery.issues.tracker" },
  { key: "devFlow", path: "#/dev-flow", el: pageElement(DevFlowHubPage), group: "delivery", icon: GitBranch, category: "delivery-execution", capability: "delivery.dev-flow", badge: "new", description: "研发全流程治理中心：需求、任务、问题与迭代一站式入口", submodules: subnav("devFlow", "pipeline", "burndown", "templates") },
  { key: "devFlowWorkbench", path: "#/dev-flow/workbench", el: pageElement(DevFlowWorkbenchPage), group: "delivery", icon: GitBranch, category: "delivery-execution", capability: "delivery.dev-flow.workbench" },
  { key: "orchestration", path: "#/orchestration", el: pageElement(OrchestrationHubPage), group: "delivery", icon: Network, category: "workflow-orchestration", capability: "delivery.orchestration", badge: "new", description: "Agent 编排治理中心：工具链、工作流定义与 CLI 探活", submodules: subnav("orchestration", "studio", "tools", "workflows", "versions") },
  { key: "orchestrationStudio", path: "#/orchestration/studio", el: pageElement(OrchestrationStudioPage, { focused: true }), group: "delivery", icon: Network, category: "workflow-orchestration", capability: "delivery.orchestration.studio" },
  { key: "workflows", path: "#/workflows", el: pageElement(WorkflowsHubPage), group: "delivery", icon: GitBranch, category: "workflow-orchestration", capability: "delivery.workflows", description: "工作流编排治理中心：模板、实例、事件、信号与运行治理", submodules: subnav("workflows", "templates", "instances", "events", "signals", "bulk_ops") },
  { key: "workflowTemplates", path: "#/workflows/templates", el: pageElement(WorkflowsPage, { initialModule: "catalog", focused: true }), group: "delivery", icon: CopyIcon, category: "workflow-orchestration", capability: "delivery.workflows.templates" },
  { key: "workflowInstances", path: "#/workflows/instances", el: pageElement(WorkflowsPage, { initialModule: "instances", focused: true }), group: "delivery", icon: Rows3, category: "workflow-orchestration", capability: "delivery.workflows.instances" },
  { key: "workflowEvents", path: "#/workflows/events", el: pageElement(WorkflowsPage, { initialModule: "events", focused: true }), group: "delivery", icon: BellRing, category: "workflow-orchestration", capability: "delivery.workflows.events" },
  { key: "workflowSignals", path: "#/workflows/signals", el: pageElement(WorkflowsPage, { initialModule: "signals", focused: true }), group: "delivery", icon: Network, category: "workflow-orchestration", capability: "delivery.workflows.signals" },
  { key: "workflowBulkOps", path: "#/workflows/bulk_ops", el: pageElement(WorkflowsPage, { initialModule: "ops", focused: true }), group: "delivery", icon: Activity, category: "workflow-orchestration", capability: "delivery.workflows.bulk_ops" },
  { key: "analytics", path: "#/analytics", el: pageElement(AnalyticsDataHubPage), group: "data", icon: BarChart3, category: "data-insight-reporting", capability: "data.analytics", description: "数据智能治理中心：指标概览、资产治理、蓝图与洞察报告", submodules: subnav("analytics", "metrics_overview", "raw_metrics", "metric_export") },
  { key: "analyticsOverview", path: "#/analytics/overview", el: pageElement(AnalyticsOverviewWorkbenchPage), group: "data", icon: BarChart3, category: "data-insight-reporting", capability: "data.analytics.overview" },
  { key: "analyticsBlueprint", path: "#/analytics/blueprint", el: pageElement(AnalyticsBlueprintWorkbenchPage), group: "data", icon: Brain, category: "data-strategy", capability: "data.analytics.blueprint", badge: "new", submodules: subnav("analyticsBlueprint", "capability_map", "stack_matrix", "gap_tasks") },
  { key: "analyticsReports", path: "#/analytics/reports", el: pageElement(AnalyticsReportsWorkbenchPage), group: "data", icon: FileText, category: "data-insight-reporting", capability: "data.analytics.reports", description: "洞察报告资产、订阅与行动任务化运营", submodules: subnav("analyticsReports", "report_assets", "report_subscription", "action_tasks", "notification") },
  { key: "reportAssets", path: "#/analytics/reports/assets", el: pageElement(AnalyticsReportsWorkbenchPage), group: "data", icon: FileText, category: "data-insight-reporting", capability: "data.analytics.reports.assets" },
  { key: "reportSubscription", path: "#/analytics/reports/subscription", el: pageElement(AnalyticsReportsWorkbenchPage), group: "data", icon: BellRing, category: "data-insight-reporting", capability: "data.analytics.reports.subscription" },
  { key: "reportActionTasks", path: "#/analytics/reports/action-tasks", el: pageElement(AnalyticsReportsWorkbenchPage), group: "data", icon: ClipboardList, category: "data-insight-reporting", capability: "data.analytics.reports.action-tasks" },
  { key: "analyticsCatalog", path: "#/analytics/catalog", el: pageElement(DataGovernanceHubPage), group: "data", icon: LayoutDashboard, category: "data-asset-governance", capability: "data.analytics.catalog", description: "数据资产治理中心：四层能力栈与五大专业域入口", submodules: subnav("analyticsCatalog", "capability_stack", "domain_overview", "governance_export") },
  { key: "dataAssets", path: "#/analytics/catalog/assets", el: pageElement(DataGovernanceModulePage, { domain: "assets" }), group: "data", icon: Database, category: "data-asset-governance", capability: "data.analytics.catalog.assets", description: "资产目录、质量评估与治理任务", submodules: subnav("dataAssets", "asset_catalog", "quality_evaluate", "governance_tasks") },
  { key: "metadataManagement", path: "#/data/metadata", el: pageElement(MetadataManagementWorkbenchPage, { focused: true }), group: "data", icon: FileSearch, category: "data-asset-governance", capability: "data.metadata", badge: "new", description: "元数据管理：资产、字段、分类和血缘影响", submodules: subnav("data/metadata", "overview", "assets", "fields", "lineage") },
  { key: "metadataOverview", path: "#/data/metadata/overview", el: pageElement(MetadataManagementWorkbenchPage, { focused: true, initialView: "overview" }), group: "data", icon: FileSearch, category: "data-asset-governance", capability: "data.metadata.overview", hidden: true, parentKey: "metadataManagement" },
  { key: "metadataAssets", path: "#/data/metadata/assets", el: pageElement(MetadataManagementWorkbenchPage, { focused: true, initialView: "assets" }), group: "data", icon: Database, category: "data-asset-governance", capability: "data.metadata.assets", hidden: true, parentKey: "metadataManagement" },
  { key: "metadataFields", path: "#/data/metadata/fields", el: pageElement(MetadataManagementWorkbenchPage, { focused: true, initialView: "fields" }), group: "data", icon: FileSearch, category: "data-asset-governance", capability: "data.metadata.fields", hidden: true, parentKey: "metadataManagement" },
  { key: "metadataLineage", path: "#/data/metadata/lineage", el: pageElement(MetadataManagementWorkbenchPage, { focused: true, initialView: "lineage" }), group: "data", icon: Network, category: "data-asset-governance", capability: "data.metadata.lineage", hidden: true, parentKey: "metadataManagement" },
  { key: "dataMetricsTags", path: "#/analytics/catalog/metrics", el: pageElement(DataGovernanceModulePage, { domain: "metrics" }), group: "data", icon: BarChart3, category: "data-asset-governance", capability: "data.analytics.catalog.metrics", description: "指标口径、标签规则与语义目录", submodules: subnav("dataMetricsTags", "metric_definitions", "tag_rules", "ownership") },
  { key: "dataServices", path: "#/analytics/catalog/services", el: pageElement(DataGovernanceModulePage, { domain: "services" }), group: "data", icon: Cpu, category: "data-asset-governance", capability: "data.analytics.catalog.services", description: "数据服务发布、健康与消费者治理", submodules: subnav("dataServices", "service_catalog", "publishing", "health") },
  { key: "dataQuality", path: "#/analytics/catalog/quality", el: pageElement(DataGovernanceModulePage, { domain: "quality" }), group: "data", icon: ShieldCheck, category: "data-asset-governance", capability: "data.analytics.catalog.quality", description: "质量规则、告警处置与修复任务", submodules: subnav("dataQuality", "alerts", "notify", "fix_tasks") },
  { key: "dataDevelopment", path: "#/analytics/catalog/development", el: pageElement(DataGovernanceModulePage, { domain: "development" }), group: "data", icon: GitBranch, category: "data-engineering-ops", capability: "data.analytics.catalog.development", description: "开发模板、调度、Agent Feed 与 Runbook", submodules: subnav("dataDevelopment", "templates", "schedules", "agent_feed", "evidence", "runbook") },
  { key: "analyticsLineage", path: "#/analytics/lineage", el: pageElement(LineageWorkbenchPage), group: "data", icon: Network, capability: "data.analytics.lineage", submodules: subnav("analyticsLineage", "lineage_graph", "impact_analysis", "dataset_relation") },
  { key: "dataExchange", path: "#/analytics/exchange", el: pageElement(DataExchangeWorkbenchPage), group: "data", icon: Database, category: "data-engineering-ops", capability: "data.exchange", submodules: subnav("dataExchange", "export_jobs", "import_jobs", "preview_merge", "archive") },
  { key: "analyticsNlq", path: "#/analytics/nlq", el: pageElement(AnalyticsNlqWorkbenchPage), group: "data", icon: SearchCheck, capability: "data.analytics.nlq", submodules: subnav("analyticsNlq", "natural_query", "semantic_context", "save_report") },
  { key: "copilot", path: "#/copilot", el: pageElement(CopilotHubPage), group: "ai", icon: Bot, category: "ai-command", capability: "ai.copilot", description: "AI 助手治理中心：会话、命令与工具计划入口", submodules: subnav("copilot", "chat", "commands", "tool_plan", "plan_to_tasks") },
  { key: "copilotChat", path: "#/copilot/chat", el: pageElement(CopilotPage, { initialMode: "chat" }), group: "ai", icon: Bot, category: "ai-command", capability: "ai.copilot.chat", shortcut: "g c" },
  { key: "copilotCommands", path: "#/copilot/commands", el: pageElement(CopilotPage, { initialMode: "commands" }), group: "ai", icon: Command, category: "ai-command", capability: "ai.copilot.commands" },
  { key: "copilotToolPlan", path: "#/copilot/tool-plan", el: pageElement(CopilotPage, { initialMode: "tool-plan" }), group: "ai", icon: Network, category: "ai-command", capability: "ai.copilot.tool-plan" },
  { key: "vibe", path: "#/vibe", el: pageElement(VibeHubPage), group: "ai", icon: TerminalIcon, category: "ai-command", capability: "ai.vibe", badge: "new", description: "Vibe Coding 治理中心：会话、模板与 CLI/LLM 执行入口", submodules: subnav("vibe", "workspace", "templates", "terminal") },
  { key: "vibeWorkspace", path: "#/vibe/workspace", el: pageElement(VibeWorkbenchPage, { focused: true }), group: "ai", icon: TerminalIcon, category: "ai-command", capability: "ai.vibe.workspace" },
  { key: "globalSearch", path: "#/search", el: pageElement(SearchHubPage), group: "ai", icon: SearchCheck, category: "ai-command", capability: "ai.search", description: "全局检索治理中心：关键词与语义索引健康", submodules: subnav("search", "workbench", "semantic", "keyword") },
  { key: "searchWorkbench", path: "#/search/workbench", el: pageElement(GlobalSearchWorkbenchPage, { focused: true }), group: "ai", icon: SearchCheck, category: "ai-command", capability: "ai.search.workbench" },
  { key: "intelligence", path: "#/intelligence", el: pageElement(IntelligenceHubPage), group: "ai", icon: Brain, category: "ai-knowledge", capability: "ai.intelligence", description: "智能与知识治理中心：知识、记忆、规则、数据源与运行时运维入口", submodules: subnav("intelligence", "knowledge", "rag", "memory", "rules", "distill", "specs", "design_docs", "datasources", "worker", "sync", "events", "usage") },
  { key: "knowledgeBase", path: "#/intelligence/kb", el: pageElement(IntelligencePage, { initialTab: "kb", focused: true }), group: "ai", icon: Library, category: "ai-knowledge", capability: "ai.intelligence.knowledge" },
  { key: "ragSearch", path: "#/intelligence/rag", el: pageElement(IntelligencePage, { initialTab: "rag", focused: true }), group: "ai", icon: SearchCheck, category: "ai-knowledge", capability: "ai.intelligence.rag" },
  { key: "aiMemory", path: "#/intelligence/memory", el: pageElement(IntelligencePage, { initialTab: "mem", focused: true }), group: "ai", icon: Brain, category: "ai-knowledge", capability: "ai.intelligence.memory" },
  { key: "ruleCenter", path: "#/intelligence/rules", el: pageElement(IntelligencePage, { initialTab: "rules", focused: true }), group: "ai", icon: ShieldCheck, category: "ai-knowledge", capability: "ai.intelligence.rules" },
  { key: "reflectionDistill", path: "#/intelligence/distill", el: pageElement(IntelligencePage, { initialTab: "distill", focused: true }), group: "ai", icon: SparklesIcon, category: "ai-knowledge", capability: "ai.intelligence.distill" },
  { key: "specs", path: "#/intelligence/specs", el: pageElement(SpecsWorkbenchPage), group: "ai", icon: FileCode, category: "ai-knowledge", capability: "ai.intelligence.specs", badge: "new" },
  { key: "designDocs", path: "#/intelligence/design-docs", el: pageElement(DesignDocsWorkbenchPage), group: "ai", icon: BookOpen, category: "ai-knowledge", capability: "ai.intelligence.design-docs", badge: "new" },
  { key: "intelligenceDataSources", path: "#/intelligence/datasources", el: pageElement(DataSourcesWorkbenchPage, { focused: true, initialView: "overview" }), group: "ai", icon: Database, category: "ai-knowledge", capability: "ai.intelligence.datasources", hidden: true, parentKey: "intelligence", description: "数据源管理兼容入口，主入口已迁移到数据域" },
  { key: "workerOps", path: "#/intelligence/worker", el: pageElement(IntelligencePage, { initialTab: "worker", focused: true }), group: "ai", icon: Cpu, category: "ai-runtime-ops", capability: "ai.intelligence.worker" },
  { key: "syncOps", path: "#/intelligence/sync", el: pageElement(IntelligencePage, { initialTab: "sync", focused: true }), group: "ai", icon: GitBranch, category: "ai-runtime-ops", capability: "ai.intelligence.sync" },
  { key: "eventStream", path: "#/intelligence/events", el: pageElement(IntelligencePage, { initialTab: "events", focused: true }), group: "ai", icon: Activity, category: "ai-runtime-ops", capability: "ai.intelligence.events" },
  { key: "usageOps", path: "#/intelligence/usage", el: pageElement(IntelligencePage, { initialTab: "usage", focused: true }), group: "ai", icon: BarChart3, category: "ai-runtime-ops", capability: "ai.intelligence.usage" },
  { key: "platforms", path: "#/platforms", el: pageElement(PlatformsHubPage), group: "ecosystem", icon: Cpu, category: "agent-platform", capability: "ecosystem.platforms", description: "Agent 平台治理中心：CLI 探活、MCP、Agent 注册、运行中心、模型运维与运行治理", submodules: subnav("platforms", "tool_profiles", "mcp_hub", "agents", "agent_runs", "models", "ops", "a2a") },
  { key: "platformTools", path: "#/platforms/tools", el: pageElement(PlatformsPage, { initialModule: "tools", focused: true }), group: "ecosystem", icon: TerminalIcon, category: "agent-platform", capability: "ecosystem.platforms.tools" },
  { key: "cliTools", path: "#/platforms/cli", el: pageElement(CliToolsWorkbenchPage, { focused: true }), group: "ecosystem", icon: TerminalIcon, category: "agent-platform", capability: "ecosystem.platforms.cli", badge: "new" },
  { key: "mcpHub", path: "#/platforms/mcp", el: pageElement(PlatformsPage, { initialModule: "mcp", focused: true }), group: "ecosystem", icon: Blocks, category: "agent-platform", capability: "ecosystem.platforms.mcp" },
  { key: "agentRegistry", path: "#/platforms/agents", el: pageElement(PlatformsPage, { initialModule: "agents", focused: true }), group: "ecosystem", icon: Bot, category: "agent-platform", capability: "ecosystem.platforms.agents" },
  {
    key: "agentRuns",
    path: "#/platforms/agent-runs",
    el: pageElement(PlatformsPage, { initialModule: "agents", focused: true }),
    group: "ecosystem",
    icon: ListChecks,
    category: "agent-platform",
    capability: "ecosystem.platforms.agent-runs",
    description: "Agent 运行中心：运行列表、心跳、能力画像、SLO 与再平衡任务化",
    submodules: [
      { key: "run_list", path: "#/ai/agent-ops/runs", capability: "ai.agent-ops.runs" },
      { key: "heartbeat", path: "#/ai/agent-ops/heartbeat", capability: "ai.agent-ops.heartbeat" },
      { key: "capability_profiles", path: "#/ai/agent-ops/profiles", capability: "ai.agent-ops.profiles" },
      { key: "retry", path: "#/ai/agent-ops/retry", capability: "ai.agent-ops.retry" },
      { key: "evidence", path: "#/tasks?tab=scheduler&panel=agent-reports", capability: "ecosystem.platforms.agent-runs.evidence" },
      { key: "slo_rebalance", path: "#/platforms/agent-runs", capability: "ecosystem.platforms.agent-runs.slo_rebalance" },
    ],
  },
  { key: "modelOps", path: "#/platforms/models", el: pageElement(PlatformsPage, { initialModule: "models", focused: true }), group: "ecosystem", icon: Brain, category: "agent-platform", capability: "ecosystem.platforms.models" },
  { key: "platformOps", path: "#/platforms/ops", el: pageElement(PlatformsPage, { initialModule: "ops", focused: true }), group: "ecosystem", icon: ShieldCheck, category: "agent-platform", capability: "ecosystem.platforms.ops", badge: "new" },
  { key: "marketplace", path: "#/marketplace", el: pageElement(MarketplaceHubPage), group: "ecosystem", icon: Blocks, category: "asset-market", capability: "ecosystem.marketplace", description: "资产市场治理中心：包目录、安装态与签名分布", submodules: subnav("marketplace", "catalog", "installed", "rating", "signature") },
  { key: "marketplaceCatalog", path: "#/marketplace/catalog", el: pageElement(MarketplacePage), group: "ecosystem", icon: Blocks, category: "asset-market", capability: "ecosystem.marketplace.catalog" },
  { key: "marketplaceInstalled", path: "#/marketplace/installed", el: pageElement(MarketplacePage), group: "ecosystem", icon: Check, category: "asset-market", capability: "ecosystem.marketplace.installed" },
  { key: "marketplaceRatings", path: "#/marketplace/ratings", el: pageElement(MarketplacePage), group: "ecosystem", icon: SparklesIcon, category: "asset-market", capability: "ecosystem.marketplace.ratings" },
  { key: "skillsHub", path: "#/skills-hub", el: pageElement(SkillsHubLandingPage), group: "ecosystem", icon: SparklesIcon, category: "asset-market", capability: "ecosystem.skills-hub", badge: "new", description: "技能中心：目录、仓库同步与已安装技能治理", submodules: subnav("skillsHub", "skills", "repos", "installed") },
  { key: "skillsCatalog", path: "#/skills-hub/skills", el: pageElement(SkillsHubPage, { initialTab: "skills", focused: true }), group: "ecosystem", icon: SparklesIcon, category: "asset-market", capability: "ecosystem.skills-hub.skills" },
  { key: "skillsRepos", path: "#/skills-hub/repos", el: pageElement(SkillsHubPage, { initialTab: "repos", focused: true }), group: "ecosystem", icon: Blocks, category: "asset-market", capability: "ecosystem.skills-hub.repos" },
  { key: "notify", path: "#/notify", el: pageElement(NotifyHubPage), group: "ecosystem", icon: BellRing, category: "communication-integration", capability: "ecosystem.notify", description: "通信集成治理中心：渠道、消息流与连接器", submodules: subnav("notify", "connectors", "channels", "outbound", "inbound", "messages", "subscriptions", "subscription_runs", "action_conversion") },
  { key: "notifyConnectors", path: "#/notify/connectors", el: pageElement(NotifyPage, { initialModule: "connectors", focused: true }), group: "ecosystem", icon: Network, category: "communication-integration", capability: "ecosystem.notify.connectors" },
  { key: "notifyChannels", path: "#/notify/channels", el: pageElement(NotifyPage, { initialModule: "channels", focused: true }), group: "ecosystem", icon: BellRing, category: "communication-integration", capability: "ecosystem.notify.channels" },
  { key: "notifyOutbound", path: "#/notify/outbound", el: pageElement(NotifyPage, { initialModule: "outbound", focused: true }), group: "ecosystem", icon: ArrowRight, category: "communication-integration", capability: "ecosystem.notify.outbound" },
  { key: "notifyInbound", path: "#/notify/inbound", el: pageElement(NotifyPage, { initialModule: "inbound", focused: true }), group: "ecosystem", icon: ClipboardList, category: "communication-integration", capability: "ecosystem.notify.inbound" },
  { key: "notifyMessages", path: "#/notify/messages", el: pageElement(NotifyPage, { initialModule: "messages", focused: true }), group: "ecosystem", icon: MessageSquareText, category: "communication-integration", capability: "ecosystem.notify.messages" },
  { key: "notifySubscriptions", path: "#/notify/subscriptions", el: pageElement(NotifyPage, { initialModule: "subscriptions", focused: true }), group: "ecosystem", icon: BellRing, category: "communication-integration", capability: "ecosystem.notify.subscriptions" },
  { key: "notifySubscriptionRuns", path: "#/notify/subscription-runs", el: pageElement(NotifyPage, { initialModule: "subscriptionRuns", focused: true }), group: "ecosystem", icon: ListChecks, category: "communication-integration", capability: "ecosystem.notify.subscription-runs", badge: "new" },
  { key: "webhooks", path: "#/notify/webhooks", el: pageElement(WebhooksWorkbenchPage, { focused: true }), group: "ecosystem", icon: BellRing, category: "communication-integration", capability: "ecosystem.notify.webhooks", badge: "new" },
  { key: "audit", path: "#/audit", el: pageElement(AuditHubPage), group: "governance", icon: ShieldCheck, category: "security-audit", capability: "governance.audit", description: "安全审计治理中心：哈希链、事件、模块动作与审批", submodules: subnav("audit", "hash_chain", "events", "module_actions", "approvals", "export") },
  { key: "auditChain", path: "#/audit/chain", el: pageElement(AuditPage), group: "governance", icon: ShieldCheck, category: "security-audit", capability: "governance.audit.chain" },
  { key: "auditEvents", path: "#/audit/events", el: pageElement(AuditPage), group: "governance", icon: BellRing, category: "security-audit", capability: "governance.audit.events" },
  { key: "auditModuleActions", path: "#/audit/module-actions", el: pageElement(AuditPage), group: "governance", icon: Command, category: "security-audit", capability: "governance.audit.module-actions" },
  { key: "auditApprovals", path: "#/audit/approvals", el: pageElement(AuditPage), group: "governance", icon: Check, category: "security-audit", capability: "governance.audit.approvals" },
  { key: "systemMap", path: "#/system-map", el: pageElement(SystemMapHubPage), group: "governance", icon: Rows3, category: "module-governance", capability: "governance.system-map", description: "模块治理中心：页面注册、模块契约、完整度治理、三码隔离、源码扫描与基线对比", submodules: subnav("systemMap", "registry", "contract", "readiness", "three-code-isolation", "source-scan", "baseline-compare", "governance-tasks", "migration") },
  { key: "microAppGovernance", path: "#/micro-apps", el: pageElement(MicroAppGovernancePage), group: "governance", icon: Layers3, category: "module-governance", capability: "governance.micro-apps", badge: "new", description: "独立子应用管理：应用边界、门户入口、模块归属、能力覆盖与运行状态" },
  { key: "menuManagement", path: "#/admin/menu", el: pageElement(MenuManagementPage), group: "governance", icon: Rows3, category: "module-governance", capability: "governance.menu-management", badge: "new", description: "菜单管理：树形结构、能力码绑定、分组策略、可见性规则与健康检查" },
  { key: "permissionMatrix", path: "#/admin/permissions", el: pageElement(PermissionMatrixPage), group: "governance", icon: ShieldCheck, category: "module-governance", capability: "governance.permission-matrix", badge: "new", description: "权限矩阵：角色×能力码可视化，支持角色预览与批量策略配置" },
  { key: "microAppRegistry", path: "#/admin/micro-app-registry", el: pageElement(MicroAppRegistryPage), group: "governance", icon: Layers3, category: "module-governance", capability: "governance.micro-app-registry", badge: "new", description: "子应用注册管理：独立入口、菜单分组、SSO 权限契约与运行状态监控" },
  { key: "pageRegistry", path: "#/system-map/registry", el: pageElement(SystemMapPage, { focused: true, initialSection: "registry" }), group: "governance", icon: Rows3, category: "module-governance", capability: "governance.system-map.registry" },
  { key: "moduleContract", path: "#/system-map/contract", el: pageElement(SystemMapPage, { focused: true, initialSection: "module-contract" }), group: "governance", icon: FileText, category: "module-governance", capability: "governance.system-map.manifest" },
  { key: "moduleManifest", path: "#/system-map/manifest", el: pageElement(SystemMapPage, { focused: true, initialSection: "manifest" }), group: "governance", icon: FileText, category: "module-governance", capability: "governance.system-map.manifest", hidden: true, parentKey: "moduleContract" },
  { key: "capabilityGovernance", path: "#/system-map/capabilities", el: pageElement(SystemMapPage, { focused: true, initialSection: "capabilities" }), group: "governance", icon: ShieldCheck, category: "module-governance", capability: "governance.system-map.capabilities", hidden: true, parentKey: "moduleContract" },
  { key: "moduleReadinessGovernance", path: "#/system-map/readiness", el: pageElement(SystemMapPage, { focused: true, initialSection: "readiness" }), group: "governance", icon: ListChecks, category: "module-governance", capability: "governance.system-map.readiness" },
  { key: "threeCodeIsolationGovernance", path: "#/system-map/three-code-isolation", el: pageElement(SystemMapPage, { focused: true, initialSection: "isolation" }), group: "governance", icon: ShieldCheck, category: "module-governance", capability: "governance.system-map.three-code-isolation" },
  { key: "sourceIsolationScan", path: "#/system-map/source-scan", el: pageElement(SystemMapPage, { focused: true, initialSection: "source-scan" }), group: "governance", icon: SearchCheck, category: "module-governance", capability: "governance.system-map.source-scan" },
  { key: "isolationBaselineCompare", path: "#/system-map/baseline-compare", el: pageElement(SystemMapPage, { focused: true, initialSection: "baseline-compare" }), group: "governance", icon: GitBranch, category: "module-governance", capability: "governance.system-map.baseline-compare" },
  { key: "systemMapGovernanceTasks", path: "#/system-map/governance-tasks", el: pageElement(SystemMapPage, { focused: true, initialSection: "tasks" }), group: "governance", icon: ClipboardList, category: "module-governance", capability: "governance.system-map.governance-tasks" },
  { key: "moduleActionCatalog", path: "#/system-map/actions", el: pageElement(SystemMapPage, { focused: true, initialSection: "actions" }), group: "governance", icon: Command, category: "module-governance", capability: "governance.system-map.actions", hidden: true, parentKey: "moduleContract" },
  { key: "systemMapMigration", path: "#/system-map/migration", el: pageElement(SystemMapPage, { focused: true, initialSection: "migration" }), group: "governance", icon: GitBranch, category: "module-governance", capability: "governance.system-map.migration" },
  {
    key: "settings",
    path: "#/settings",
    el: pageElement(SettingsHubPage),
    group: "system",
    icon: SettingsIcon,
    category: "runtime-config",
    capability: "system.settings",
    description: "系统配置治理中心：账户、运行态、SSO、计费、部署、存储与观测",
    submodules: [
      { key: "account", path: "#/settings/account", capability: "system.settings.account" },
      { key: "runtime", path: "#/settings/runtime", capability: "system.settings.runtime" },
      { key: "management_entries", path: "#/settings/workspace", capability: "system.settings.workspace" },
      { key: "sso", path: "#/settings/sso", capability: "system.settings.sso" },
      { key: "billing", path: "#/settings/billing", capability: "system.settings.billing" },
      { key: "profiles", path: "#/settings/profiles", capability: "system.settings.profiles" },
      { key: "observability", path: "#/settings/observability", capability: "system.settings.observability" },
      { key: "storage", path: "#/settings/storage", capability: "system.settings.storage" },
      { key: "appearance", path: "#/settings/appearance", capability: "system.settings.appearance" },
    ],
  },
  { key: "settingsAccount", path: "#/settings/account", el: pageElement(SettingsPage, { initialModule: "account", focused: true }), group: "system", icon: UserCogIcon, category: "runtime-config", capability: "system.settings.account" },
  { key: "settingsRuntime", path: "#/settings/runtime", el: pageElement(SettingsPage, { initialModule: "runtime", focused: true }), group: "system", icon: Cpu, category: "runtime-config", capability: "system.settings.runtime" },
  { key: "settingsWorkspace", path: "#/settings/workspace", el: pageElement(SettingsPage, { initialModule: "workspace", focused: true }), group: "system", icon: ExternalLink, category: "runtime-config", capability: "system.settings.workspace" },
  { key: "settingsSso", path: "#/settings/sso", el: pageElement(SettingsPage, { initialModule: "sso", focused: true }), group: "system", icon: ShieldCheck, category: "runtime-config", capability: "system.settings.sso" },
  { key: "settingsBilling", path: "#/settings/billing", el: pageElement(SettingsPage, { initialModule: "billing", focused: true }), group: "system", icon: BarChart3, category: "runtime-config", capability: "system.settings.billing" },
  { key: "settingsProfiles", path: "#/settings/profiles", el: pageElement(SettingsPage, { initialModule: "profiles", focused: true }), group: "system", icon: CopyIcon, category: "runtime-config", capability: "system.settings.profiles" },
  { key: "settingsObservability", path: "#/settings/observability", el: pageElement(SettingsPage, { initialModule: "observability", focused: true }), group: "system", icon: SearchCheck, category: "runtime-config", capability: "system.settings.observability" },
  { key: "settingsStorage", path: "#/settings/storage", el: pageElement(SettingsPage, { initialModule: "storage", focused: true }), group: "system", icon: Database, category: "runtime-config", capability: "system.settings.storage" },
  { key: "settingsAppearance", path: "#/settings/appearance", el: pageElement(SettingsPage, { initialModule: "appearance", focused: true }), group: "system", icon: Palette, category: "runtime-config", capability: "system.settings.appearance" },
  { key: "envOps", path: "#/ops/env", el: pageElement(EnvOpsHubPage), group: "system", icon: Container, category: "runtime-config", capability: "system.env-ops", badge: "new", description: "环境运维治理中心：探活、Profile 与工具链可用性", submodules: subnav("envOps", "workbench", "docker", "profiles") },
  { key: "envOpsWorkbench", path: "#/ops/env/workbench", el: pageElement(EnvOpsWorkbenchPage, { focused: true }), group: "system", icon: Container, category: "runtime-config", capability: "system.env-ops.workbench" },
  // ── 智能运维中心 ──────────────────────────────────────────────────────────
  { key: "opsCenter", path: "#/system/ops-center", el: pageElement(OpsCenterHubPage), group: "system", icon: Wrench, category: "smart-ops", capability: "system.ops-center", badge: "new", description: "智能运维中心：部署流水线、告警源治理、根因分析、Runbook 与自愈策略", submodules: subnav("system/ops-center", "pipeline", "alerts", "rca", "runbook", "self-heal") },
  { key: "opsCenterPipeline", path: "#/system/ops-center/pipeline", el: pageElement(OpsCenterWorkbenchPage, { focused: true, initialTab: "pipelines" }), group: "system", icon: Wrench, category: "smart-ops", capability: "system.ops-center.pipeline", hidden: true, parentKey: "opsCenter" },
  { key: "opsCenterAlerts", path: "#/system/ops-center/alerts", el: pageElement(OpsCenterWorkbenchPage, { focused: true, initialTab: "alert-sources" }), group: "system", icon: Wrench, category: "smart-ops", capability: "system.ops-center.alerts", hidden: true, parentKey: "opsCenter" },
  { key: "opsCenterRca", path: "#/system/ops-center/rca", el: pageElement(OpsCenterWorkbenchPage, { focused: true, initialTab: "rca" }), group: "system", icon: Wrench, category: "smart-ops", capability: "system.ops-center.rca", hidden: true, parentKey: "opsCenter" },
  { key: "opsCenterRunbook", path: "#/system/ops-center/runbook", el: pageElement(OpsCenterWorkbenchPage, { focused: true, initialTab: "runbooks" }), group: "system", icon: Wrench, category: "smart-ops", capability: "system.ops-center.runbook", hidden: true, parentKey: "opsCenter" },
  { key: "opsCenterSelfHeal", path: "#/system/ops-center/self-heal", el: pageElement(OpsCenterWorkbenchPage, { focused: true, initialTab: "self-heal" }), group: "system", icon: Wrench, category: "smart-ops", capability: "system.ops-center.self-heal", hidden: true, parentKey: "opsCenter" },
  // ── AI Agent 运行中心 ─────────────────────────────────────────────────────
  { key: "agentOps", path: "#/ai/agent-ops", el: pageElement(AgentOpsHubPage), group: "ai", icon: Bot, category: "ai-agent-ops", capability: "ai.agent-ops", badge: "new", description: "Agent 运行中心：运行列表、心跳监控、能力画像与失败重试", submodules: subnav("ai/agent-ops", "runs", "heartbeat", "profiles", "retry") },
  { key: "agentOpsRuns", path: "#/ai/agent-ops/runs", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "runs" }), group: "ai", icon: Bot, category: "ai-agent-ops", capability: "ai.agent-ops.runs", hidden: true, parentKey: "agentOps" },
  { key: "agentOpsHeartbeat", path: "#/ai/agent-ops/heartbeat", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "runs" }), group: "ai", icon: Bot, category: "ai-agent-ops", capability: "ai.agent-ops.heartbeat", hidden: true, parentKey: "agentOps" },
  { key: "agentOpsProfiles", path: "#/ai/agent-ops/profiles", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "profiles" }), group: "ai", icon: Bot, category: "ai-agent-ops", capability: "ai.agent-ops.profiles", hidden: true, parentKey: "agentOps" },
  { key: "agentOpsRetry", path: "#/ai/agent-ops/retry", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "runs" }), group: "ai", icon: Bot, category: "ai-agent-ops", capability: "ai.agent-ops.retry", hidden: true, parentKey: "agentOps" },
  // ── LLM 模型网关 ──────────────────────────────────────────────────────────
  { key: "llmGatewayWorkbench", path: "#/ai/llm-gateway/workbench", el: pageElement(LlmGatewayWorkbenchPage, { focused: true }), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway.workbench", hidden: true, parentKey: "llmGateway" },
    { key: "llmGateway", path: "#/ai/llm-gateway", el: pageElement(LlmGatewayHubPage), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway", badge: "new", description: "模型网关：路由规则、调用决策、生产策略、Prompt 审计、成本统计、成本归因、模型评测与限流策略", submodules: subnav("ai/llm-gateway", "health", "policy", "routes", "decision", "drill", "cost", "attribution", "eval", "audit", "throttle") },
  { key: "llmGatewayHealth", path: "#/ai/llm-gateway/health", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "health" }), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway.health", hidden: true, parentKey: "llmGateway" },
  { key: "llmGatewayPolicy", path: "#/ai/llm-gateway/policy", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "policy" }), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway.policy", hidden: true, parentKey: "llmGateway" },
  { key: "llmGatewayRoutes", path: "#/ai/llm-gateway/routes", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "routes" }), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway.routes", hidden: true, parentKey: "llmGateway" },
  { key: "llmGatewayDecision", path: "#/ai/llm-gateway/decision", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "decision" }), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway.decision", hidden: true, parentKey: "llmGateway" },
  { key: "llmGatewayDrill", path: "#/ai/llm-gateway/drill", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "drill" }), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway.drill", hidden: true, parentKey: "llmGateway" },
  { key: "llmGatewayCost", path: "#/ai/llm-gateway/cost", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "cost" }), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway.cost", hidden: true, parentKey: "llmGateway" },
  { key: "llmGatewayAttribution", path: "#/ai/llm-gateway/attribution", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "attribution" }), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway.attribution", hidden: true, parentKey: "llmGateway" },
  { key: "llmGatewayEval", path: "#/ai/llm-gateway/eval", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "eval" }), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway.eval", hidden: true, parentKey: "llmGateway" },
  { key: "llmGatewayAudit", path: "#/ai/llm-gateway/audit", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "audit" }), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway.audit", hidden: true, parentKey: "llmGateway" },
  { key: "llmGatewayThrottle", path: "#/ai/llm-gateway/throttle", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "throttle" }), group: "ai", icon: Brain, category: "ai-model-ops", capability: "ai.llm-gateway.throttle", hidden: true, parentKey: "llmGateway" },
  // ── 知识图谱 ──────────────────────────────────────────────────────────────
  { key: "knowledgeGraphWorkbench", path: "#/ai/knowledge-graph/workbench", el: pageElement(KnowledgeGraphWorkbenchPage, { focused: true }), group: "ai", icon: Network, category: "ai-knowledge", capability: "ai.knowledge-graph.workbench", hidden: true, parentKey: "knowledgeGraph" },
    { key: "knowledgeGraph", path: "#/ai/knowledge-graph", el: pageElement(KnowledgeGraphHubPage), group: "ai", icon: Network, category: "ai-knowledge", capability: "ai.knowledge-graph", badge: "new", description: "知识图谱：构建、查询、血缘关联与实体画像", submodules: subnav("ai/knowledge-graph", "build", "query", "lineage", "profile") },
  { key: "knowledgeGraphBuild", path: "#/ai/knowledge-graph/build", el: pageElement(KnowledgeGraphWorkbenchPage, { focused: true, initialTab: "build" }), group: "ai", icon: Network, category: "ai-knowledge", capability: "ai.knowledge-graph.build", hidden: true, parentKey: "knowledgeGraph" },
  { key: "knowledgeGraphQuery", path: "#/ai/knowledge-graph/query", el: pageElement(KnowledgeGraphWorkbenchPage, { focused: true, initialTab: "query" }), group: "ai", icon: Network, category: "ai-knowledge", capability: "ai.knowledge-graph.query", hidden: true, parentKey: "knowledgeGraph" },
  { key: "knowledgeGraphLineage", path: "#/ai/knowledge-graph/lineage", el: pageElement(KnowledgeGraphWorkbenchPage, { focused: true, initialTab: "lineage" }), group: "ai", icon: Network, category: "ai-knowledge", capability: "ai.knowledge-graph.lineage", hidden: true, parentKey: "knowledgeGraph" },
  { key: "knowledgeGraphProfile", path: "#/ai/knowledge-graph/profile", el: pageElement(KnowledgeGraphWorkbenchPage, { focused: true, initialTab: "profile" }), group: "ai", icon: Network, category: "ai-knowledge", capability: "ai.knowledge-graph.profile", hidden: true, parentKey: "knowledgeGraph" },
  // ── A2A 网关 ──────────────────────────────────────────────────────────────
  { key: "a2aGateway", path: "#/ecosystem/a2a", el: pageElement(A2aGatewayHubPage), group: "ecosystem", icon: Blocks, category: "a2a-protocol", capability: "ecosystem.a2a", badge: "new", description: "A2A 协议网关：外部 Agent 注册、能力协商、任务分发与执行证据", submodules: subnav("ecosystem/a2a", "registry", "negotiate", "sla", "windows", "dispatch", "evidence") },
  { key: "a2aWorkbench", path: "#/ecosystem/a2a/workbench", el: pageElement(A2aWorkbenchPage, { focused: true }), group: "ecosystem", icon: Blocks, category: "a2a-protocol", capability: "ecosystem.a2a.workbench", hidden: true, parentKey: "a2aGateway" },
  { key: "a2aRegistry", path: "#/ecosystem/a2a/registry", el: pageElement(A2aWorkbenchPage, { focused: true, initialTab: "registry" }), group: "ecosystem", icon: Blocks, category: "a2a-protocol", capability: "ecosystem.a2a.registry", hidden: true, parentKey: "a2aGateway" },
  { key: "a2aNegotiate", path: "#/ecosystem/a2a/negotiate", el: pageElement(A2aWorkbenchPage, { focused: true, initialTab: "negotiate" }), group: "ecosystem", icon: Blocks, category: "a2a-protocol", capability: "ecosystem.a2a.negotiate", hidden: true, parentKey: "a2aGateway" },
  { key: "a2aSla", path: "#/ecosystem/a2a/sla", el: pageElement(A2aWorkbenchPage, { focused: true, initialTab: "sla" }), group: "ecosystem", icon: Blocks, category: "a2a-protocol", capability: "ecosystem.a2a.sla", hidden: true, parentKey: "a2aGateway" },
  { key: "a2aWindows", path: "#/ecosystem/a2a/windows", el: pageElement(A2aWorkbenchPage, { focused: true, initialTab: "windows" }), group: "ecosystem", icon: Blocks, category: "a2a-protocol", capability: "ecosystem.a2a.windows", hidden: true, parentKey: "a2aGateway" },
  { key: "a2aDispatch", path: "#/ecosystem/a2a/dispatch", el: pageElement(A2aWorkbenchPage, { focused: true, initialTab: "dispatches" }), group: "ecosystem", icon: Blocks, category: "a2a-protocol", capability: "ecosystem.a2a.dispatch", hidden: true, parentKey: "a2aGateway" },
  { key: "a2aEvidence", path: "#/ecosystem/a2a/evidence", el: pageElement(A2aWorkbenchPage, { focused: true, initialTab: "evidence" }), group: "ecosystem", icon: Blocks, category: "a2a-protocol", capability: "ecosystem.a2a.evidence", hidden: true, parentKey: "a2aGateway" },
  // ── 数据接入中心 ──────────────────────────────────────────────────────────
  { key: "dataSources", path: "#/data/sources", el: pageElement(DataSourcesWorkbenchPage, { focused: true }), group: "data", icon: Database, category: "data-ingest", capability: "data.sources", badge: "new", description: "数据源管理：连接目录、SecretRef、元数据发现、安全治理与 Schema Registry 同步", submodules: subnav("data/sources", "overview", "connections", "metadata", "security") },
  { key: "dataSourcesOverview", path: "#/data/sources/overview", el: pageElement(DataSourcesWorkbenchPage, { focused: true, initialView: "overview" }), group: "data", icon: Database, category: "data-ingest", capability: "data.sources.overview", hidden: true, parentKey: "dataSources" },
  { key: "dataSourcesConnections", path: "#/data/sources/connections", el: pageElement(DataSourcesWorkbenchPage, { focused: true, initialView: "connections" }), group: "data", icon: Database, category: "data-ingest", capability: "data.sources.connections", hidden: true, parentKey: "dataSources" },
  { key: "dataSourcesMetadata", path: "#/data/sources/metadata", el: pageElement(DataSourcesWorkbenchPage, { focused: true, initialView: "metadata" }), group: "data", icon: Database, category: "data-ingest", capability: "data.sources.metadata", hidden: true, parentKey: "dataSources" },
  { key: "dataSourcesSecurity", path: "#/data/sources/security", el: pageElement(DataSourcesWorkbenchPage, { focused: true, initialView: "security" }), group: "data", icon: ShieldCheck, category: "data-ingest", capability: "data.sources.security", hidden: true, parentKey: "dataSources" },
  { key: "dataIngest", path: "#/data/ingest", el: pageElement(DataIngestHubPage), group: "data", icon: Database, category: "data-ingest", capability: "data.ingest", badge: "new", description: "数据接入中心：连接器、Schema Registry、CDC 与批量作业", submodules: subnav("data/ingest", "connectors", "schema", "cdc", "batch") },
  { key: "dataIngestWorkbench", path: "#/data/ingest/workbench", el: pageElement(DataIngestWorkbenchPage, { focused: true }), group: "data", icon: Database, category: "data-ingest", capability: "data.ingest.workbench", hidden: true, parentKey: "dataIngest" },
  { key: "dataIngestConnectors", path: "#/data/ingest/connectors", el: pageElement(DataIngestWorkbenchPage, { focused: true, initialTab: "connectors" }), group: "data", icon: Database, category: "data-ingest", capability: "data.ingest.connectors", hidden: true, parentKey: "dataIngest" },
  { key: "dataIngestSchema", path: "#/data/ingest/schema", el: pageElement(DataIngestWorkbenchPage, { focused: true, initialTab: "schemas" }), group: "data", icon: Database, category: "data-ingest", capability: "data.ingest.schema", hidden: true, parentKey: "dataIngest" },
  { key: "dataIngestCdc", path: "#/data/ingest/cdc", el: pageElement(DataIngestWorkbenchPage, { focused: true, initialTab: "runs" }), group: "data", icon: Database, category: "data-ingest", capability: "data.ingest.cdc", hidden: true, parentKey: "dataIngest" },
  { key: "dataIngestBatch", path: "#/data/ingest/batch", el: pageElement(DataIngestWorkbenchPage, { focused: true, initialTab: "jobs" }), group: "data", icon: Database, category: "data-ingest", capability: "data.ingest.batch", hidden: true, parentKey: "dataIngest" },
  // ── 数据质量中心 ──────────────────────────────────────────────────────────
  { key: "dataQualityCenter", path: "#/data/quality", el: pageElement(DataQualityHubPage), group: "data", icon: ShieldCheck, category: "data-quality-center", capability: "data.quality", badge: "new", description: "数据质量中心：规则目录、运行记录、告警处置与质量报告", submodules: subnav("data/quality", "rules", "runs", "alerts", "reports") },
  { key: "dataQualityWorkbench", path: "#/data/quality/workbench", el: pageElement(DataQualityWorkbenchPage, { focused: true }), group: "data", icon: ShieldCheck, category: "data-quality-center", capability: "data.quality.workbench", hidden: true, parentKey: "dataQualityCenter" },
  { key: "dataQualityRules", path: "#/data/quality/rules", el: pageElement(DataQualityWorkbenchPage, { focused: true, initialTab: "rules" }), group: "data", icon: ShieldCheck, category: "data-quality-center", capability: "data.quality.rules", hidden: true, parentKey: "dataQualityCenter" },
  { key: "dataQualityRuns", path: "#/data/quality/runs", el: pageElement(DataQualityWorkbenchPage, { focused: true, initialTab: "runs" }), group: "data", icon: ShieldCheck, category: "data-quality-center", capability: "data.quality.runs", hidden: true, parentKey: "dataQualityCenter" },
  { key: "dataQualityAlerts", path: "#/data/quality/alerts", el: pageElement(DataQualityWorkbenchPage, { focused: true, initialTab: "alerts" }), group: "data", icon: ShieldCheck, category: "data-quality-center", capability: "data.quality.alerts", hidden: true, parentKey: "dataQualityCenter" },
  { key: "dataQualityReports", path: "#/data/quality/reports", el: pageElement(DataQualityWorkbenchPage, { focused: true, initialTab: "runs" }), group: "data", icon: ShieldCheck, category: "data-quality-center", capability: "data.quality.reports", hidden: true, parentKey: "dataQualityCenter" },
  // ── 指标中心 ──────────────────────────────────────────────────────────────
  { key: "metricsCenter", path: "#/data/metrics", el: pageElement(MetricsCenterHubPage), group: "data", icon: BarChart3, category: "data-metrics-tags", capability: "data.metrics", badge: "new", description: "指标中心：目录、语义层、API 发布与监控", submodules: subnav("data/metrics", "catalog", "semantic", "api-publish", "monitor") },
  { key: "metricsWorkbench", path: "#/data/metrics/workbench", el: pageElement(MetricsWorkbenchPage, { focused: true }), group: "data", icon: BarChart3, category: "data-metrics-tags", capability: "data.metrics.workbench", hidden: true, parentKey: "metricsCenter" },
  { key: "metricsCatalog", path: "#/data/metrics/catalog", el: pageElement(MetricsWorkbenchPage, { focused: true, initialTab: "catalog" }), group: "data", icon: BarChart3, category: "data-metrics-tags", capability: "data.metrics.catalog", hidden: true, parentKey: "metricsCenter" },
  { key: "metricsSemantic", path: "#/data/metrics/semantic", el: pageElement(MetricsWorkbenchPage, { focused: true, initialTab: "catalog" }), group: "data", icon: BarChart3, category: "data-metrics-tags", capability: "data.metrics.semantic", hidden: true, parentKey: "metricsCenter" },
  { key: "metricsApiPublish", path: "#/data/metrics/api-publish", el: pageElement(MetricsWorkbenchPage, { focused: true, initialTab: "published" }), group: "data", icon: BarChart3, category: "data-metrics-tags", capability: "data.metrics.api-publish", hidden: true, parentKey: "metricsCenter" },
  { key: "metricsMonitor", path: "#/data/metrics/monitor", el: pageElement(MetricsWorkbenchPage, { focused: true, initialTab: "published" }), group: "data", icon: BarChart3, category: "data-metrics-tags", capability: "data.metrics.monitor", hidden: true, parentKey: "metricsCenter" },
  // ── 标签服务 ──────────────────────────────────────────────────────────────
  { key: "tagService", path: "#/data/tags", el: pageElement(TagServiceHubPage), group: "data", icon: Library, category: "data-metrics-tags", capability: "data.tags", badge: "new", description: "标签服务：目录、规则、画像本体与标签 API", submodules: subnav("data/tags", "catalog", "rules", "ontology", "api") },
  { key: "tagWorkbench", path: "#/data/tags/workbench", el: pageElement(TagWorkbenchPage, { focused: true }), group: "data", icon: Library, category: "data-metrics-tags", capability: "data.tags.workbench", hidden: true, parentKey: "tagService" },
  { key: "tagCatalog", path: "#/data/tags/catalog", el: pageElement(TagWorkbenchPage, { focused: true, initialTab: "catalog" }), group: "data", icon: Library, category: "data-metrics-tags", capability: "data.tags.catalog", hidden: true, parentKey: "tagService" },
  { key: "tagRules", path: "#/data/tags/rules", el: pageElement(TagWorkbenchPage, { focused: true, initialTab: "rules" }), group: "data", icon: Library, category: "data-metrics-tags", capability: "data.tags.rules", hidden: true, parentKey: "tagService" },
  { key: "tagOntology", path: "#/data/tags/ontology", el: pageElement(TagWorkbenchPage, { focused: true, initialTab: "ontology" }), group: "data", icon: Library, category: "data-metrics-tags", capability: "data.tags.ontology", hidden: true, parentKey: "tagService" },
  { key: "tagApi", path: "#/data/tags/api", el: pageElement(TagWorkbenchPage, { focused: true, initialTab: "catalog" }), group: "data", icon: Library, category: "data-metrics-tags", capability: "data.tags.api", hidden: true, parentKey: "tagService" },
  // ── 数据开发工作台 ────────────────────────────────────────────────────────
  { key: "dataDev", path: "#/data/dev", el: pageElement(DataDevWorkbenchPage), group: "data", icon: FileCode, category: "data-engineering-ops", capability: "data.dev", badge: "new", description: "数据开发工作台：SQL 编辑器、Spark/Flink 作业与调度" },
  { key: "dataDevSql", path: "#/data/dev/sql_editor", el: pageElement(DataDevWorkbenchPage, { focused: true, initialTab: "sql_editor" }), group: "data", icon: FileCode, category: "data-engineering-ops", capability: "data.dev.sql-editor", hidden: true, parentKey: "dataDev" },
  { key: "dataDevSpark", path: "#/data/dev/spark_jobs", el: pageElement(DataDevWorkbenchPage, { focused: true, initialTab: "spark_jobs" }), group: "data", icon: FileCode, category: "data-engineering-ops", capability: "data.dev.spark-jobs", hidden: true, parentKey: "dataDev" },
  { key: "dataDevFlink", path: "#/data/dev/flink_jobs", el: pageElement(DataDevWorkbenchPage, { focused: true, initialTab: "flink_jobs" }), group: "data", icon: FileCode, category: "data-engineering-ops", capability: "data.dev.flink-jobs", hidden: true, parentKey: "dataDev" },
  { key: "dataDevSchedules", path: "#/data/dev/schedules", el: pageElement(DataDevWorkbenchPage, { focused: true, initialTab: "schedules" }), group: "data", icon: FileCode, category: "data-engineering-ops", capability: "data.dev.schedules", hidden: true, parentKey: "dataDev" },
  // ── Agent 运行 Workbench ──────────────────────────────────────────────────
  { key: "agentRunsWorkbench", path: "#/ai/agent-ops/workbench", el: pageElement(AgentRunsWorkbenchPage, { focused: true }), group: "ai", icon: Bot, category: "ai-agent-ops", capability: "ai.agent-ops.workbench", hidden: true, parentKey: "agentOps" },
  // ── 智能运维 Workbench ────────────────────────────────────────────────────
  { key: "opsCenterWorkbench", path: "#/system/ops-center/workbench", el: pageElement(OpsCenterWorkbenchPage, { focused: true }), group: "system", icon: Wrench, category: "smart-ops", capability: "system.ops-center.workbench", hidden: true, parentKey: "opsCenter" },
];

export type GroupedNav = {
  group: NavGroupDefinition;
  categories: GroupedNavCategory[];
};

export type GroupedNavCategory = {
  category: NavCategoryDefinition;
  items: NavItem[];
};

export type CapabilityGrant = {
  capability: string;
  visible?: boolean;
  allowed?: {
    read?: boolean;
    write?: boolean;
    admin?: boolean;
  };
  permission?: {
    read?: string[];
    write?: string[];
    admin?: string[];
  };
};

export function canReadNavItem(item: NavItem, role: string, grants: CapabilityGrant[] | undefined): boolean {
  if (!grants?.length || !item.capability) return true;
  const grant = grants.find((x) => x.capability === item.capability);
  if (!grant) return true;
  if (typeof grant.visible === "boolean") return grant.visible;
  if (typeof grant.allowed?.read === "boolean") return grant.allowed.read;
  return (grant.permission?.read ?? []).includes(role);
}

export function filterNavByRole(role: string, grants: CapabilityGrant[] | undefined): NavItem[] {
  return NAV.filter((item) => canReadNavItem(item, role, grants));
}

export function findActiveNavItem(hash: string, items: readonly NavItem[] = NAV): NavItem {
  return [...items]
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => !item.external && item.path.startsWith("#") && hash.startsWith(item.path)) ?? NAV[0];
}

export type NavBreadcrumb = {
  group: NavGroupDefinition;
  category?: NavCategoryDefinition;
  item: NavItem;
  parent?: NavItem;
};

export function buildNavBreadcrumb(
  hash: string,
  labelOf: (key: string) => string,
  items: readonly NavItem[] = NAV,
): NavBreadcrumb {
  const item = findActiveNavItem(hash, items);
  const group = NAV_GROUPS.find((g) => g.key === item.group) ?? NAV_GROUPS[0];
  const parent = item.parentKey ? items.find((x) => x.key === item.parentKey) : undefined;
  const categoryKey = item.category ?? ITEM_CATEGORY[item.key] ?? (parent ? ITEM_CATEGORY[parent.key] : undefined);
  const category = categoryKey ? NAV_CATEGORY_BY_KEY[categoryKey] : undefined;
  void labelOf;
  return { group, category, item, parent };
}

export function pinnedNavItems(items: readonly NavItem[]): NavItem[] {
  return PINNED_NAV_KEYS.map((key) => items.find((item) => item.key === key)).filter((item): item is NavItem => Boolean(item));
}

/** 按 key 查找 NavItem，供 AI/CLI/收藏/最近访问/键盘快捷键使用。 */
export function findNavByKey(key: string, items: readonly NavItem[] = NAV): NavItem | undefined {
  return items.find((item) => item.key === key);
}

/** 按能力码查找 NavItem，供能力门与导航联动。 */
export function findNavByCapability(capability: string, items: readonly NavItem[] = NAV): NavItem | undefined {
  return items.find((item) => item.capability === capability);
}

/** 按 keys 列表批量解析，过滤掉不存在/隐藏项，保持入参顺序。 */
export function resolveNavKeys(keys: readonly string[], items: readonly NavItem[] = NAV): NavItem[] {
  const seen = new Set<string>();
  const out: NavItem[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    const found = items.find((item) => item.key === key && !item.hidden);
    if (found) {
      seen.add(key);
      out.push(found);
    }
  }
  return out;
}

export type NavRegistryIssue = {
  level: "error" | "warn";
  code: string;
  key?: string;
  message: string;
};

/**
 * 校验导航注册表健康：
 *   - 路径重复
 *   - parentKey 指向不存在
 *   - 未注册到 ITEM_CATEGORY 的顶级模块
 *   - 缺少 capability
 * 主要供 SystemMap / 单测 / AI 自检使用。
 */
export function validateNavRegistry(items: readonly NavItem[] = NAV): NavRegistryIssue[] {
  const issues: NavRegistryIssue[] = [];
  const seenPath = new Map<string, string>();
  for (const item of items) {
    if (!item.capability) {
      issues.push({ level: "warn", code: "missing_capability", key: item.key, message: `${item.key} 缺少 capability` });
    }
    if (item.path && seenPath.has(item.path)) {
      issues.push({
        level: "error",
        code: "duplicate_path",
        key: item.key,
        message: `${item.key} 与 ${seenPath.get(item.path)} 路径冲突: ${item.path}`,
      });
    } else if (item.path) {
      seenPath.set(item.path, item.key);
    }
    if (item.parentKey && !items.some((x) => x.key === item.parentKey)) {
      issues.push({ level: "error", code: "missing_parent", key: item.key, message: `${item.key} 的 parentKey=${item.parentKey} 不存在` });
    }
    if (!item.parentKey && !item.hidden && !item.category && !ITEM_CATEGORY[item.key]) {
      issues.push({ level: "warn", code: "missing_category", key: item.key, message: `${item.key} 未在 ITEM_CATEGORY 注册分类，将落到 ${item.group}-general` });
    }
  }
  return issues;
}

export function groupNavItems(keyword: string, labelOf: (key: string) => string, items: readonly NavItem[] = NAV): GroupedNav[] {
  const normalized = keyword.trim().toLowerCase();
  const matchedParents = new Set(
    items
      .filter((item) => item.parentKey && normalized && labelOf(item.key).toLowerCase().includes(normalized))
      .map((item) => item.parentKey as string),
  );
  const byGroup = NAV_GROUPS.reduce(
    (acc, group) => {
      acc[group.key] = new Map<string, NavItem[]>();
      return acc;
    },
    {} as Record<NavGroupKey, Map<string, NavItem[]>>,
  );
  for (const item of items) {
    if (item.hidden) continue;
    if (item.parentKey) continue;
    const label = labelOf(item.key);
    if (normalized && !label.toLowerCase().includes(normalized) && !matchedParents.has(item.key)) continue;
    const categoryKey = item.category ?? ITEM_CATEGORY[item.key] ?? `${item.group}-general`;
    const rows = byGroup[item.group].get(categoryKey) ?? [];
    rows.push(item);
    byGroup[item.group].set(categoryKey, rows);
  }
  return NAV_GROUPS.map((group) => {
    const categories = [...byGroup[group.key].entries()]
      .map(([categoryKey, rows]) => ({
        category: NAV_CATEGORY_BY_KEY[categoryKey] ?? {
          key: categoryKey,
          group: group.key,
          i18nKey: `nav.category.${categoryKey}` as `nav.category.${string}`,
        },
        items: rows,
      }))
      .sort((a, b) => {
        const ai = NAV_CATEGORIES.findIndex((category) => category.key === a.category.key);
        const bi = NAV_CATEGORIES.findIndex((category) => category.key === b.category.key);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
      });
    return { group, categories };
  }).filter((entry) => entry.categories.length > 0);
}
