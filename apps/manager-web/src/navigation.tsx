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
  FileCode,
  FileText,
  FolderKanban,
  Gauge,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  Library,
  ListChecks,
  Network,
  Package,
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

const DashboardPage = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const ProjectsPage = lazy(() => import("./pages/Projects").then((m) => ({ default: m.Projects })));
const RequirementsPage = lazy(() => import("./pages/Requirements").then((m) => ({ default: m.Requirements })));
const TasksPage = lazy(() => import("./pages/Tasks").then((m) => ({ default: m.Tasks })));
const WorkflowsPage = lazy(() => import("./pages/Workflows").then((m) => ({ default: m.Workflows })));
const OrganizationPage = lazy(() => import("./pages/Organization").then((m) => ({ default: m.Organization })));
const NotifyPage = lazy(() => import("./pages/Notify").then((m) => ({ default: m.Notify })));
const AuditPage = lazy(() => import("./pages/Audit").then((m) => ({ default: m.Audit })));
const CopilotPage = lazy(() => import("./pages/Copilot").then((m) => ({ default: m.Copilot })));
const IntelligencePage = lazy(() => import("./pages/Intelligence").then((m) => ({ default: m.Intelligence })));
const MarketplacePage = lazy(() => import("./pages/Marketplace").then((m) => ({ default: m.Marketplace })));
const PlatformsPage = lazy(() => import("./pages/Platforms").then((m) => ({ default: m.Platforms })));
const SystemMapPage = lazy(() => import("./pages/SystemMap").then((m) => ({ default: m.SystemMap })));
const IssuesWorkbenchPage = lazy(() => import("./pages/delivery/IssuesWorkbench").then((m) => ({ default: m.IssuesWorkbench })));
const SpecsWorkbenchPage = lazy(() => import("./pages/intelligence/SpecsWorkbench").then((m) => ({ default: m.SpecsWorkbench })));
const DesignDocsWorkbenchPage = lazy(() =>
  import("./pages/intelligence/DesignDocsWorkbench").then((m) => ({ default: m.DesignDocsWorkbench })),
);
const SkillsHubPage = lazy(() => import("./pages/ecosystem/SkillsHub").then((m) => ({ default: m.SkillsHub })));
const DevFlowWorkbenchPage = lazy(() => import("./pages/delivery/DevFlowWorkbench").then((m) => ({ default: m.DevFlowWorkbench })));
const VibeWorkbenchPage = lazy(() => import("./pages/ai/VibeWorkbench").then((m) => ({ default: m.VibeWorkbench })));
const GlobalSearchWorkbenchPage = lazy(() => import("./pages/ai/GlobalSearchWorkbench").then((m) => ({ default: m.GlobalSearchWorkbench })));
const CliToolsWorkbenchPage = lazy(() => import("./pages/ecosystem/CliToolsWorkbench").then((m) => ({ default: m.CliToolsWorkbench })));
const EnvOpsWorkbenchPage = lazy(() => import("./pages/system/EnvOpsWorkbench").then((m) => ({ default: m.EnvOpsWorkbench })));
const OrchestrationStudioPage = lazy(() => import("./pages/delivery/OrchestrationStudio").then((m) => ({ default: m.OrchestrationStudio })));
const WebhooksWorkbenchPage = lazy(() => import("./pages/ecosystem/WebhooksWorkbench").then((m) => ({ default: m.WebhooksWorkbench })));
const DataSourcesWorkbenchPage = lazy(() =>
  import("./pages/intelligence/DataSourcesWorkbench").then((m) => ({ default: m.DataSourcesWorkbench })),
);
const LineageWorkbenchPage = lazy(() =>
  import("./pages/data/LineageWorkbench").then((m) => ({ default: m.LineageWorkbench })),
);
const AnalyticsOverviewWorkbenchPage = lazy(() =>
  import("./pages/data/AnalyticsOverviewWorkbench").then((m) => ({ default: m.AnalyticsOverviewWorkbench })),
);
const AnalyticsNlqWorkbenchPage = lazy(() =>
  import("./pages/data/AnalyticsNlqWorkbench").then((m) => ({ default: m.AnalyticsNlqWorkbench })),
);
const DataGovernanceHubPage = lazy(() =>
  import("./pages/data/governance/DataGovernanceHub").then((m) => ({ default: m.DataGovernanceHub })),
);
const DataGovernanceModulePage = lazy(() =>
  import("./pages/data/governance/DataGovernanceModulePage").then((m) => ({ default: m.DataGovernanceModulePage })),
);
const AnalyticsBlueprintWorkbenchPage = lazy(() =>
  import("./pages/data/AnalyticsBlueprintWorkbench").then((m) => ({ default: m.AnalyticsBlueprintWorkbench })),
);
const DataExchangeWorkbenchPage = lazy(() =>
  import("./pages/data/DataExchangeWorkbench").then((m) => ({ default: m.DataExchangeWorkbench })),
);
const IntelligenceHubPage = lazy(() =>
  import("./pages/intelligence/IntelligenceHub").then((m) => ({ default: m.IntelligenceHub })),
);
const AnalyticsReportsWorkbenchPage = lazy(() =>
  import("./pages/data/AnalyticsReportsWorkbench").then((m) => ({ default: m.AnalyticsReportsWorkbench })),
);
const PlatformsHubPage = lazy(() =>
  import("./pages/ecosystem/PlatformsHub").then((m) => ({ default: m.PlatformsHub })),
);
const SkillsHubLandingPage = lazy(() =>
  import("./pages/ecosystem/SkillsHubLanding").then((m) => ({ default: m.SkillsHubLanding })),
);
const CopilotHubPage = lazy(() => import("./pages/ai/CopilotHub").then((m) => ({ default: m.CopilotHub })));
const AuditHubPage = lazy(() => import("./pages/governance/AuditHub").then((m) => ({ default: m.AuditHub })));
const SystemMapHubPage = lazy(() => import("./pages/governance/SystemMapHub").then((m) => ({ default: m.SystemMapHub })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const ProjectsHubPage = lazy(() => import("./pages/portfolio/ProjectsHub").then((m) => ({ default: m.ProjectsHub })));
const OrganizationHubPage = lazy(() =>
  import("./pages/portfolio/OrganizationHub").then((m) => ({ default: m.OrganizationHub })),
);
const RequirementsHubPage = lazy(() =>
  import("./pages/product/RequirementsHub").then((m) => ({ default: m.RequirementsHub })),
);
const TasksHubPage = lazy(() => import("./pages/delivery/TasksHub").then((m) => ({ default: m.TasksHub })));
const WorkflowsHubPage = lazy(() => import("./pages/delivery/WorkflowsHub").then((m) => ({ default: m.WorkflowsHub })));
const SettingsHubPage = lazy(() => import("./pages/system/SettingsHub").then((m) => ({ default: m.SettingsHub })));
const DashboardHubPage = lazy(() =>
  import("./pages/overview/DashboardHub").then((m) => ({ default: m.DashboardHub })),
);
const DevFlowHubPage = lazy(() => import("./pages/delivery/DevFlowHub").then((m) => ({ default: m.DevFlowHub })));
const IssuesHubPage = lazy(() => import("./pages/delivery/IssuesHub").then((m) => ({ default: m.IssuesHub })));
const MarketplaceHubPage = lazy(() =>
  import("./pages/ecosystem/MarketplaceHub").then((m) => ({ default: m.MarketplaceHub })),
);
const NotifyHubPage = lazy(() => import("./pages/ecosystem/NotifyHub").then((m) => ({ default: m.NotifyHub })));
const OrchestrationHubPage = lazy(() =>
  import("./pages/delivery/OrchestrationHub").then((m) => ({ default: m.OrchestrationHub })),
);
const EnvOpsHubPage = lazy(() => import("./pages/system/EnvOpsHub").then((m) => ({ default: m.EnvOpsHub })));
const AnalyticsDataHubPage = lazy(() =>
  import("./pages/data/AnalyticsDataHub").then((m) => ({ default: m.AnalyticsDataHub })),
);
const SearchHubPage = lazy(() => import("./pages/ai/SearchHub").then((m) => ({ default: m.SearchHub })));
const VibeHubPage = lazy(() => import("./pages/ai/VibeHub").then((m) => ({ default: m.VibeHub })));

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
export const PINNED_NAV_KEYS = ["dashboard", "requirements", "tasks", "copilot"] as const;

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
  specs: "ai-knowledge",
  designDocs: "ai-knowledge",
  dataSources: "ai-knowledge",
  workerOps: "ai-runtime-ops",
  syncOps: "ai-runtime-ops",
  usageOps: "ai-runtime-ops",
  platforms: "agent-platform",
  platformTools: "agent-platform",
  mcpHub: "agent-platform",
  agentRegistry: "agent-platform",
  modelOps: "agent-platform",
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
  moduleManifest: "module-governance",
  capabilityGovernance: "module-governance",
  moduleActionCatalog: "module-governance",
  settings: "runtime-config",
  settingsAccount: "runtime-config",
  settingsRuntime: "runtime-config",
  settingsSso: "runtime-config",
  settingsBilling: "runtime-config",
  settingsProfiles: "runtime-config",
  settingsObservability: "runtime-config",
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
  { key: "dashboard", path: "#/dashboard", el: pageElement(DashboardHubPage), group: "overview", icon: LayoutDashboard, category: "overview-command", capability: "overview.dashboard", shortcut: "g d", description: "运营指挥治理中心：全局指标、风险与跨域入口", submodules: subnav("dashboard", "executive_overview", "platform_blueprint", "risk_board", "technology_upgrade", "next_actions") },
  { key: "dashboardCockpit", path: "#/dashboard/cockpit", el: pageElement(DashboardPage), group: "overview", icon: LayoutDashboard, category: "overview-command", capability: "overview.dashboard.cockpit", description: "完整运营驾驶舱：趋势、蓝图与行动项" },
  { key: "projects", path: "#/projects", el: pageElement(ProjectsHubPage), group: "portfolio", icon: FolderKanban, category: "project-lifecycle", capability: "portfolio.projects", description: "项目组合治理中心：组合、成员与 AI 交付套件", submodules: subnav("projects", "portfolio", "businesses", "tenants", "tenant_users", "project_members", "delivery-kit") },
  { key: "projectPortfolio", path: "#/projects/portfolio", el: pageElement(ProjectsPage, { initialTab: "portfolio", focused: true }), group: "portfolio", icon: FolderKanban, category: "project-lifecycle", capability: "portfolio.projects.portfolio" },
  { key: "projectBusinesses", path: "#/projects/businesses", el: pageElement(ProjectsPage, { initialTab: "business", focused: true }), group: "portfolio", icon: Building2, category: "project-lifecycle", capability: "portfolio.projects.businesses" },
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
  { key: "organization", path: "#/organization", el: pageElement(OrganizationHubPage), group: "portfolio", icon: Building2, category: "org-governance", capability: "portfolio.organization", description: "组织权限治理中心：成员、业务线、项目成员与角色策略", submodules: subnav("organization", "tenant_users", "business_lines", "project_members", "role_policy") },
  { key: "orgTenantUsers", path: "#/organization/users", el: pageElement(OrganizationPage, { initialTab: "users", focused: true }), group: "portfolio", icon: UserCogIcon, category: "org-governance", capability: "portfolio.organization.tenant-users" },
  { key: "orgBusinesses", path: "#/organization/businesses", el: pageElement(OrganizationPage, { initialTab: "businesses", focused: true }), group: "portfolio", icon: Building2, category: "org-governance", capability: "portfolio.organization.businesses" },
  { key: "orgProjectMembers", path: "#/organization/project-members", el: pageElement(OrganizationPage, { initialTab: "projectMembers", focused: true }), group: "portfolio", icon: UsersIcon, category: "org-governance", capability: "portfolio.organization.project-members" },
  { key: "orgRolePolicy", path: "#/organization/role-policy", el: pageElement(OrganizationPage, { initialTab: "rolePolicy", focused: true }), group: "portfolio", icon: ShieldCheck, category: "org-governance", capability: "portfolio.organization.role-policy" },
  { key: "requirements", path: "#/requirements", el: pageElement(RequirementsHubPage), group: "product", icon: Library, category: "requirement-intake", capability: "product.requirements", shortcut: "g r", description: "需求治理中心：需求池、智能评审与拆任务", submodules: subnav("requirements", "requirement_pool", "smart_review", "task_generation", "batch_governance") },
  { key: "requirementPool", path: "#/requirements/pool", el: pageElement(RequirementsPage, { initialMode: "pool", focused: true }), group: "product", icon: Library, category: "requirement-intake", capability: "product.requirements.pool" },
  { key: "requirementReview", path: "#/requirements/review", el: pageElement(RequirementsPage, { initialMode: "review", focused: true }), group: "product", icon: SearchCheck, category: "requirement-ai-governance", capability: "product.requirements.review" },
  { key: "requirementGeneration", path: "#/requirements/generation", el: pageElement(RequirementsPage, { initialMode: "generation", focused: true }), group: "product", icon: SparklesIcon, category: "requirement-ai-governance", capability: "product.requirements.generation" },
  { key: "requirementBatch", path: "#/requirements/batch", el: pageElement(RequirementsPage, { initialMode: "batch", focused: true }), group: "product", icon: Rows3, category: "requirement-ai-governance", capability: "product.requirements.batch" },
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
  { key: "dataMetricsTags", path: "#/analytics/catalog/metrics", el: pageElement(DataGovernanceModulePage, { domain: "metrics" }), group: "data", icon: BarChart3, category: "data-asset-governance", capability: "data.analytics.catalog.metrics", description: "指标口径、标签规则与语义目录", submodules: subnav("dataMetricsTags", "metric_definitions", "tag_rules", "ownership") },
  { key: "dataServices", path: "#/analytics/catalog/services", el: pageElement(DataGovernanceModulePage, { domain: "services" }), group: "data", icon: Cpu, category: "data-asset-governance", capability: "data.analytics.catalog.services", description: "数据服务发布、健康与消费者治理", submodules: subnav("dataServices", "service_catalog", "publishing", "health") },
  { key: "dataQuality", path: "#/analytics/catalog/quality", el: pageElement(DataGovernanceModulePage, { domain: "quality" }), group: "data", icon: ShieldCheck, category: "data-asset-governance", capability: "data.analytics.catalog.quality", description: "质量规则、告警处置与修复任务", submodules: subnav("dataQuality", "alerts", "notify", "fix_tasks") },
  { key: "dataDevelopment", path: "#/analytics/catalog/development", el: pageElement(DataGovernanceModulePage, { domain: "development" }), group: "data", icon: GitBranch, category: "data-engineering-ops", capability: "data.analytics.catalog.development", description: "开发模板、调度、Agent Feed 与 Runbook", submodules: subnav("dataDevelopment", "templates", "schedules", "agent_feed", "evidence", "runbook") },
  { key: "analyticsLineage", path: "#/analytics/lineage", el: pageElement(LineageWorkbenchPage), group: "data", icon: Network, capability: "data.analytics.lineage", submodules: subnav("analyticsLineage", "lineage_graph", "impact_analysis", "dataset_relation") },
  { key: "dataExchange", path: "#/analytics/exchange", el: pageElement(DataExchangeWorkbenchPage), group: "data", icon: Database, category: "data-engineering-ops", capability: "data.exchange", submodules: subnav("dataExchange", "export_jobs", "import_jobs", "preview_merge", "archive") },
  { key: "analyticsNlq", path: "#/analytics/nlq", el: pageElement(AnalyticsNlqWorkbenchPage), group: "data", icon: SearchCheck, capability: "data.analytics.nlq", submodules: subnav("analyticsNlq", "natural_query", "semantic_context", "save_report") },
  { key: "copilot", path: "#/copilot", el: pageElement(CopilotHubPage), group: "ai", icon: Bot, category: "ai-command", capability: "ai.copilot", description: "AI 助手治理中心：会话、命令与工具计划入口", submodules: subnav("copilot", "chat", "commands", "tool_plan", "plan_to_tasks") },
  { key: "copilotChat", path: "#/copilot/chat", el: pageElement(CopilotPage), group: "ai", icon: Bot, category: "ai-command", capability: "ai.copilot.chat", shortcut: "g c" },
  { key: "copilotCommands", path: "#/copilot/commands", el: pageElement(CopilotPage), group: "ai", icon: Command, category: "ai-command", capability: "ai.copilot.commands" },
  { key: "copilotToolPlan", path: "#/copilot/tool-plan", el: pageElement(CopilotPage), group: "ai", icon: Network, category: "ai-command", capability: "ai.copilot.tool-plan" },
  { key: "vibe", path: "#/vibe", el: pageElement(VibeHubPage), group: "ai", icon: TerminalIcon, category: "ai-command", capability: "ai.vibe", badge: "new", description: "Vibe Coding 治理中心：会话、模板与 CLI/LLM 执行入口", submodules: subnav("vibe", "workspace", "templates", "terminal") },
  { key: "vibeWorkspace", path: "#/vibe/workspace", el: pageElement(VibeWorkbenchPage, { focused: true }), group: "ai", icon: TerminalIcon, category: "ai-command", capability: "ai.vibe.workspace" },
  { key: "globalSearch", path: "#/search", el: pageElement(SearchHubPage), group: "ai", icon: SearchCheck, category: "ai-command", capability: "ai.search", description: "全局检索治理中心：关键词与语义索引健康", submodules: subnav("search", "workbench", "semantic", "keyword") },
  { key: "searchWorkbench", path: "#/search/workbench", el: pageElement(GlobalSearchWorkbenchPage, { focused: true }), group: "ai", icon: SearchCheck, category: "ai-command", capability: "ai.search.workbench" },
  { key: "intelligence", path: "#/intelligence", el: pageElement(IntelligenceHubPage), group: "ai", icon: Brain, category: "ai-knowledge", capability: "ai.intelligence", description: "智能与知识治理中心：知识、记忆、规则与运行时运维入口", submodules: subnav("intelligence", "knowledge", "rag", "memory", "rules", "worker", "sync", "usage") },
  { key: "knowledgeBase", path: "#/intelligence/kb", el: pageElement(IntelligencePage, { initialTab: "kb", focused: true }), group: "ai", icon: Library, category: "ai-knowledge", capability: "ai.intelligence.knowledge" },
  { key: "ragSearch", path: "#/intelligence/rag", el: pageElement(IntelligencePage, { initialTab: "rag", focused: true }), group: "ai", icon: SearchCheck, category: "ai-knowledge", capability: "ai.intelligence.rag" },
  { key: "aiMemory", path: "#/intelligence/memory", el: pageElement(IntelligencePage, { initialTab: "mem", focused: true }), group: "ai", icon: Brain, category: "ai-knowledge", capability: "ai.intelligence.memory" },
  { key: "ruleCenter", path: "#/intelligence/rules", el: pageElement(IntelligencePage, { initialTab: "rules", focused: true }), group: "ai", icon: ShieldCheck, category: "ai-knowledge", capability: "ai.intelligence.rules" },
  { key: "specs", path: "#/intelligence/specs", el: pageElement(SpecsWorkbenchPage), group: "ai", icon: FileCode, category: "ai-knowledge", capability: "ai.intelligence.specs", badge: "new" },
  { key: "designDocs", path: "#/intelligence/design-docs", el: pageElement(DesignDocsWorkbenchPage), group: "ai", icon: BookOpen, category: "ai-knowledge", capability: "ai.intelligence.design-docs", badge: "new" },
  { key: "dataSources", path: "#/intelligence/datasources", el: pageElement(DataSourcesWorkbenchPage), group: "ai", icon: Database, category: "ai-knowledge", capability: "ai.intelligence.datasources", badge: "new", description: "远端数据库与向量库连接配置" },
  { key: "workerOps", path: "#/intelligence/worker", el: pageElement(IntelligencePage, { initialTab: "worker", focused: true }), group: "ai", icon: Cpu, category: "ai-runtime-ops", capability: "ai.intelligence.worker" },
  { key: "syncOps", path: "#/intelligence/sync", el: pageElement(IntelligencePage, { initialTab: "sync", focused: true }), group: "ai", icon: GitBranch, category: "ai-runtime-ops", capability: "ai.intelligence.sync" },
  { key: "usageOps", path: "#/intelligence/usage", el: pageElement(IntelligencePage, { initialTab: "usage", focused: true }), group: "ai", icon: BarChart3, category: "ai-runtime-ops", capability: "ai.intelligence.usage" },
  { key: "platforms", path: "#/platforms", el: pageElement(PlatformsHubPage), group: "ecosystem", icon: Cpu, category: "agent-platform", capability: "ecosystem.platforms", description: "Agent 平台治理中心：CLI 探活、MCP、Agent 注册与模型运维", submodules: subnav("platforms", "tool_profiles", "mcp_hub", "agents", "models", "a2a") },
  { key: "platformTools", path: "#/platforms/tools", el: pageElement(PlatformsPage), group: "ecosystem", icon: TerminalIcon, category: "agent-platform", capability: "ecosystem.platforms.tools" },
  { key: "cliTools", path: "#/platforms/cli", el: pageElement(CliToolsWorkbenchPage, { focused: true }), group: "ecosystem", icon: TerminalIcon, category: "agent-platform", capability: "ecosystem.platforms.cli", badge: "new" },
  { key: "mcpHub", path: "#/platforms/mcp", el: pageElement(PlatformsPage), group: "ecosystem", icon: Blocks, category: "agent-platform", capability: "ecosystem.platforms.mcp" },
  { key: "agentRegistry", path: "#/platforms/agents", el: pageElement(PlatformsPage), group: "ecosystem", icon: Bot, category: "agent-platform", capability: "ecosystem.platforms.agents" },
  { key: "modelOps", path: "#/platforms/models", el: pageElement(PlatformsPage), group: "ecosystem", icon: Brain, category: "agent-platform", capability: "ecosystem.platforms.models" },
  { key: "marketplace", path: "#/marketplace", el: pageElement(MarketplaceHubPage), group: "ecosystem", icon: Blocks, category: "asset-market", capability: "ecosystem.marketplace", description: "资产市场治理中心：包目录、安装态与签名分布", submodules: subnav("marketplace", "catalog", "installed", "rating", "signature") },
  { key: "marketplaceCatalog", path: "#/marketplace/catalog", el: pageElement(MarketplacePage), group: "ecosystem", icon: Blocks, category: "asset-market", capability: "ecosystem.marketplace.catalog" },
  { key: "marketplaceInstalled", path: "#/marketplace/installed", el: pageElement(MarketplacePage), group: "ecosystem", icon: Check, category: "asset-market", capability: "ecosystem.marketplace.installed" },
  { key: "marketplaceRatings", path: "#/marketplace/ratings", el: pageElement(MarketplacePage), group: "ecosystem", icon: SparklesIcon, category: "asset-market", capability: "ecosystem.marketplace.ratings" },
  { key: "skillsHub", path: "#/skills-hub", el: pageElement(SkillsHubLandingPage), group: "ecosystem", icon: SparklesIcon, category: "asset-market", capability: "ecosystem.skills-hub", badge: "new", description: "技能中心：目录、仓库同步与已安装技能治理", submodules: subnav("skillsHub", "skills", "repos", "installed") },
  { key: "skillsCatalog", path: "#/skills-hub/skills", el: pageElement(SkillsHubPage, { initialTab: "skills", focused: true }), group: "ecosystem", icon: SparklesIcon, category: "asset-market", capability: "ecosystem.skills-hub.skills" },
  { key: "skillsRepos", path: "#/skills-hub/repos", el: pageElement(SkillsHubPage, { initialTab: "repos", focused: true }), group: "ecosystem", icon: Blocks, category: "asset-market", capability: "ecosystem.skills-hub.repos" },
  { key: "notify", path: "#/notify", el: pageElement(NotifyHubPage), group: "ecosystem", icon: BellRing, category: "communication-integration", capability: "ecosystem.notify", description: "通信集成治理中心：渠道、消息流与连接器", submodules: subnav("notify", "channels", "outbound", "inbound", "action_conversion") },
  { key: "notifyChannels", path: "#/notify/channels", el: pageElement(NotifyPage), group: "ecosystem", icon: BellRing, category: "communication-integration", capability: "ecosystem.notify.channels" },
  { key: "notifyOutbound", path: "#/notify/outbound", el: pageElement(NotifyPage), group: "ecosystem", icon: ArrowRight, category: "communication-integration", capability: "ecosystem.notify.outbound" },
  { key: "notifyInbound", path: "#/notify/inbound", el: pageElement(NotifyPage), group: "ecosystem", icon: ClipboardList, category: "communication-integration", capability: "ecosystem.notify.inbound" },
  { key: "notifyConnectors", path: "#/notify/connectors", el: pageElement(NotifyPage), group: "ecosystem", icon: Network, category: "communication-integration", capability: "ecosystem.notify.connectors" },
  { key: "webhooks", path: "#/notify/webhooks", el: pageElement(WebhooksWorkbenchPage, { focused: true }), group: "ecosystem", icon: BellRing, category: "communication-integration", capability: "ecosystem.notify.webhooks", badge: "new" },
  { key: "audit", path: "#/audit", el: pageElement(AuditHubPage), group: "governance", icon: ShieldCheck, category: "security-audit", capability: "governance.audit", description: "安全审计治理中心：哈希链、事件、模块动作与审批", submodules: subnav("audit", "hash_chain", "events", "module_actions", "approvals", "export") },
  { key: "auditChain", path: "#/audit/chain", el: pageElement(AuditPage), group: "governance", icon: ShieldCheck, category: "security-audit", capability: "governance.audit.chain" },
  { key: "auditEvents", path: "#/audit/events", el: pageElement(AuditPage), group: "governance", icon: BellRing, category: "security-audit", capability: "governance.audit.events" },
  { key: "auditModuleActions", path: "#/audit/module-actions", el: pageElement(AuditPage), group: "governance", icon: Command, category: "security-audit", capability: "governance.audit.module-actions" },
  { key: "auditApprovals", path: "#/audit/approvals", el: pageElement(AuditPage), group: "governance", icon: Check, category: "security-audit", capability: "governance.audit.approvals" },
  { key: "systemMap", path: "#/system-map", el: pageElement(SystemMapHubPage), group: "governance", icon: Rows3, category: "module-governance", capability: "governance.system-map", description: "模块治理中心：页面注册、能力矩阵与 Legacy 承接", submodules: subnav("systemMap", "registry", "manifest", "capabilities", "actions", "migration") },
  { key: "pageRegistry", path: "#/system-map/registry", el: pageElement(SystemMapPage), group: "governance", icon: Rows3, category: "module-governance", capability: "governance.system-map.registry" },
  { key: "moduleManifest", path: "#/system-map/manifest", el: pageElement(SystemMapPage), group: "governance", icon: FileText, category: "module-governance", capability: "governance.system-map.manifest" },
  { key: "capabilityGovernance", path: "#/system-map/capabilities", el: pageElement(SystemMapPage), group: "governance", icon: ShieldCheck, category: "module-governance", capability: "governance.system-map.capabilities" },
  { key: "moduleActionCatalog", path: "#/system-map/actions", el: pageElement(SystemMapPage), group: "governance", icon: Command, category: "module-governance", capability: "governance.system-map.actions" },
  { key: "settings", path: "#/settings", el: pageElement(SettingsHubPage), group: "system", icon: SettingsIcon, category: "runtime-config", capability: "system.settings", description: "系统配置治理中心：账户、运行态、SSO、计费与观测", submodules: subnav("settings", "account", "runtime", "sso", "billing", "profiles", "observability") },
  { key: "settingsAccount", path: "#/settings/account", el: pageElement(SettingsPage), group: "system", icon: UserCogIcon, category: "runtime-config", capability: "system.settings.account" },
  { key: "settingsRuntime", path: "#/settings/runtime", el: pageElement(SettingsPage), group: "system", icon: Cpu, category: "runtime-config", capability: "system.settings.runtime" },
  { key: "settingsSso", path: "#/settings/sso", el: pageElement(SettingsPage), group: "system", icon: ShieldCheck, category: "runtime-config", capability: "system.settings.sso" },
  { key: "settingsBilling", path: "#/settings/billing", el: pageElement(SettingsPage), group: "system", icon: BarChart3, category: "runtime-config", capability: "system.settings.billing" },
  { key: "settingsProfiles", path: "#/settings/profiles", el: pageElement(SettingsPage), group: "system", icon: CopyIcon, category: "runtime-config", capability: "system.settings.profiles" },
  { key: "settingsObservability", path: "#/settings/observability", el: pageElement(SettingsPage), group: "system", icon: SearchCheck, category: "runtime-config", capability: "system.settings.observability" },
  { key: "envOps", path: "#/ops/env", el: pageElement(EnvOpsHubPage), group: "system", icon: Container, category: "runtime-config", capability: "system.env-ops", badge: "new", description: "环境运维治理中心：探活、Profile 与工具链可用性", submodules: subnav("envOps", "workbench", "docker", "profiles") },
  { key: "envOpsWorkbench", path: "#/ops/env/workbench", el: pageElement(EnvOpsWorkbenchPage, { focused: true }), group: "system", icon: Container, category: "runtime-config", capability: "system.env-ops.workbench" },
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
