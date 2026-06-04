import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

describe("navigation information architecture", () => {
  const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
  const projectsSource = readFileSync(resolve(root, "subapps/main-admin/src/pages/Projects.tsx"), "utf8");
  const projectsRouteSource = readFileSync(resolve(root, "subapps/main-admin/src/pages/projects/deliveryKitNav.ts"), "utf8");
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const systemModuleContractSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/SystemModuleContractPanel.tsx"), "utf8");

  it("keeps project portfolio and business-line governance from competing in the main menu", () => {
    expect(navigationSource).toContain('subnav("projects", "portfolio", "tenants", "tenant_users", "project_members", "delivery-kit")');
    expect(navigationSource).toContain('key: "projectBusinesses"');
    expect(navigationSource).toContain('hidden: true, parentKey: "projects"');
    expect(projectsRouteSource).toContain('seg === "businesses"');
    expect(projectsSource).not.toContain('{ key: "business", icon: Building2 }');
  });

  it("groups manifest capabilities and actions under one module contract entry", () => {
    expect(navigationSource).toContain('subnav("systemMap", "registry", "contract", "readiness", "performance", "three-code-isolation", "source-scan", "baseline-compare", "governance-tasks", "migration")');
    expect(navigationSource).toContain('key: "moduleContract"');
    expect(navigationSource).toContain('path: "#/system-map/contract"');
    expect(navigationSource).toContain('hidden: true, parentKey: "moduleContract"');
    expect(systemMapSource).toContain('"module-contract"');
    expect(systemMapSource).toContain('value: "module-contract"');
    expect(systemMapSource).toContain('type ContractPanel = "manifest" | "capabilities" | "actions"');
    expect(systemMapSource).toContain('const showOverview = section === "overview"');
    expect(systemMapSource).toContain('const showRegistry = section === "registry"');
    expect(systemMapSource).toContain('const showPerformance = section === "performance"');
    expect(systemMapSource).toContain("SystemModuleContractPanel");
    expect(systemModuleContractSource).toContain('activePanel === "capabilities"');
    expect(systemModuleContractSource).toContain("contractPanel.actionsTitle");
  });

  it("keeps data ingest professional routes focused instead of reusing one generic tab", () => {
    expect(navigationSource).toContain('key: "dataIngest"');
    expect(navigationSource).toContain('path: "#/data/ingest"');
    expect(navigationSource).toContain('subnav("data/ingest", "connectors", "schema", "cdc", "batch")');
    expect(navigationSource).toContain('path: "#/data/ingest/connectors"');
    expect(navigationSource).toContain('initialTab: "connectors"');
    expect(navigationSource).toContain('path: "#/data/ingest/schema"');
    expect(navigationSource).toContain('initialTab: "schemas"');
    expect(navigationSource).toContain('path: "#/data/ingest/cdc"');
    expect(navigationSource).toContain('initialTab: "runs"');
    expect(navigationSource).toContain('path: "#/data/ingest/batch"');
    expect(navigationSource).toContain('initialTab: "jobs"');
  });

  it("keeps agent run operations split between focused AgentOps and platform SLO governance", () => {
    const agentRunsSource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ai/AgentRunsWorkbench.tsx"), "utf8");
    expect(navigationSource).toContain('key: "agentRuns"');
    expect(navigationSource).toContain('Agent 运行中心：运行列表、心跳、能力画像、SLO 与再平衡任务化');
    expect(navigationSource).toContain('key: "agentOpsRuns", path: "#/ai/agent-ops/runs", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "runs" })');
    expect(navigationSource).toContain('key: "agentOpsHeartbeat", path: "#/ai/agent-ops/heartbeat", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "heartbeat" })');
    expect(navigationSource).toContain('key: "agentOpsProfiles", path: "#/ai/agent-ops/profiles", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "profiles" })');
    expect(navigationSource).toContain('key: "agentOpsRetry", path: "#/ai/agent-ops/retry", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "retry" })');
    expect(agentRunsSource).toContain('type AgentRunsTab = "runs" | "heartbeat" | "profiles" | "retry"');
    expect(agentRunsSource).toContain('tab === "heartbeat"');
    expect(agentRunsSource).toContain('tab === "retry"');
    expect(navigationSource).toContain('key: "evidence", path: "#/tasks/agent-feed"');
    expect(navigationSource).toContain('key: "slo_rebalance", path: "#/platforms/agent-runs"');
  });

  it("keeps task scheduler subroutes focused on real Agent feed and quality governance panels", () => {
    const tasksSource = readFileSync(resolve(root, "subapps/ai-rd-center/src/pages/Tasks.tsx"), "utf8");
    expect(navigationSource).toContain('"tasks.agent_feed": "#/tasks/agent-feed"');
    expect(navigationSource).toContain('"tasks.bulk_governance": "#/tasks/quality-governance"');
    expect(navigationSource).toContain('key: "taskAgentFeed", path: "#/tasks/agent-feed", el: pageElement(TasksPage, { initialTab: "scheduler", focused: true, initialSchedulerPanel: "agent" })');
    expect(navigationSource).toContain('key: "taskQualityGovernance", path: "#/tasks/quality-governance", el: pageElement(TasksPage, { initialTab: "scheduler", focused: true, initialSchedulerPanel: "quality" })');
    expect(navigationSource).toContain('key: "taskSchedulerEvents", path: "#/tasks/scheduler-events", el: pageElement(TasksPage, { initialTab: "scheduler", focused: true, initialSchedulerPanel: "events" })');
    expect(navigationSource).not.toContain('"tasks.agent_feed": "#/tasks?tab=scheduler&panel=agent-feed"');
    expect(navigationSource).not.toContain('"tasks.bulk_governance": "#/tasks?tab=scheduler&panel=bulk-governance"');
    expect(tasksSource).toContain('type SchedulerPanel = "ops" | "insights" | "agent" | "quality" | "events"');
    expect(tasksSource).toContain("readSchedulerPanelFromHash");
    expect(tasksSource).toContain('const focusedSchedulerPanel = focused && tab === "scheduler" && schedulerPanel !== "ops"');
    expect(tasksSource).toContain("showSchedulerPlanning ? (");
  });

  it("keeps LLM gateway focused routes from rendering as one generic tab-heavy workbench", () => {
    const llmGatewaySource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ai/LlmGatewayWorkbench.tsx"), "utf8");
    expect(navigationSource).toContain('key: "llmGatewayPolicy", path: "#/ai/llm-gateway/policy", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "policy" })');
    expect(navigationSource).toContain('key: "llmGatewayAttribution", path: "#/ai/llm-gateway/attribution", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "attribution" })');
    expect(navigationSource).toContain('key: "llmGatewayEval", path: "#/ai/llm-gateway/eval", el: pageElement(LlmGatewayWorkbenchPage, { focused: true, initialTab: "eval" })');
    expect(llmGatewaySource).toContain("const TAB_KEYS: Tab[]");
    expect(llmGatewaySource).toContain('const tabLabel = (key: Tab) => t(`page.llmGateway.tabs.${key}`)');
    expect(llmGatewaySource).toContain("focused ? (");
    expect(llmGatewaySource).toContain('t("page.llmGateway.focusedHint")');
    expect(llmGatewaySource).not.toContain('label: "健康治理"');
    expect(llmGatewaySource).not.toContain('title="模型网关"');
  });

  it("keeps A2A protocol routes focused on professional modules instead of one generic switchboard", () => {
    const a2aSource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ecosystem/A2aWorkbench.tsx"), "utf8");
    expect(navigationSource).toContain('key: "a2aGateway", path: "#/ecosystem/a2a"');
    expect(navigationSource).toContain('subnav("ecosystem/a2a", "registry", "negotiate", "sla", "windows", "dispatch", "evidence")');
    expect(navigationSource).toContain('key: "a2aRegistry", path: "#/ecosystem/a2a/registry", el: pageElement(A2aWorkbenchPage, { focused: true, initialTab: "registry" })');
    expect(navigationSource).toContain('key: "a2aDispatch", path: "#/ecosystem/a2a/dispatch", el: pageElement(A2aWorkbenchPage, { focused: true, initialTab: "dispatches" })');
    expect(a2aSource).toContain("const TAB_KEYS: Tab[]");
    expect(a2aSource).toContain("page.a2aGateway.tabs.");
    expect(a2aSource).toContain('t("page.a2aGateway.focusedHint")');
    expect(a2aSource).toContain('focused ? (');
    expect(a2aSource).not.toContain('title={focused ? activeMeta.title : "A2A 网关"}');
    expect(a2aSource).not.toContain('{ label: "协议健康", value: "health" }');
  });

  it("keeps knowledge graph routes focused on build query lineage and profile modules", () => {
    const knowledgeGraphSource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ai/KnowledgeGraphWorkbench.tsx"), "utf8");
    expect(navigationSource).toContain('key: "knowledgeGraph", path: "#/ai/knowledge-graph"');
    expect(navigationSource).toContain('subnav("ai/knowledge-graph", "build", "query", "lineage", "profile")');
    expect(navigationSource).toContain('key: "knowledgeGraphBuild", path: "#/ai/knowledge-graph/build", el: pageElement(KnowledgeGraphWorkbenchPage, { focused: true, initialTab: "build" })');
    expect(navigationSource).toContain('key: "knowledgeGraphProfile", path: "#/ai/knowledge-graph/profile", el: pageElement(KnowledgeGraphWorkbenchPage, { focused: true, initialTab: "profile" })');
    expect(knowledgeGraphSource).toContain('export function KnowledgeGraphWorkbench({ focused = false');
    expect(knowledgeGraphSource).toContain("page.knowledgeGraph.tabs.");
    expect(knowledgeGraphSource).toContain('t("page.knowledgeGraph.focusedHint")');
    expect(knowledgeGraphSource).toContain('focused ? (');
    expect(knowledgeGraphSource).not.toContain("focused: _focused");
    expect(knowledgeGraphSource).not.toContain('title="知识图谱"');
  });

  it("keeps settings as a light hub with focused runtime configuration routes", () => {
    expect(navigationSource).toContain('key: "settings"');
    expect(navigationSource).toContain('系统配置治理中心：账户、运行态、SSO、计费、部署、存储与观测');
    expect(navigationSource).toContain('key: "management_entries", path: "#/settings/workspace"');
    expect(navigationSource).toContain('key: "settingsStorage", path: "#/settings/storage"');
    expect(navigationSource).toContain('key: "settingsAppearance", path: "#/settings/appearance"');
    expect(navigationSource).toContain('pageElement(SettingsPage, { initialModule: "storage", focused: true })');
  });

  it("keeps data source management split into connection metadata and security governance routes", () => {
    expect(navigationSource).toContain('key: "dataSources"');
    expect(navigationSource).toContain('数据源管理：连接目录、SecretRef、元数据发现、安全治理与 Schema Registry 同步');
    expect(navigationSource).toContain('key: "dataSourcesSecurity", path: "#/data/sources/security"');
    expect(navigationSource).toContain('pageElement(DataSourcesWorkbenchPage, { focused: true, initialView: "security" })');
  });

  it("keeps intelligence as a light hub while focused pages own the detailed work", () => {
    expect(navigationSource).toContain("智能与知识中枢：知识资产、检索记忆、规则蒸馏、运行治理、规约方案和数据上下文分流入口");
    expect(navigationSource).toContain('key: "knowledge_assets", path: "#/intelligence/kb"');
    expect(navigationSource).toContain('key: "retrieval_memory", path: "#/intelligence/rag"');
    expect(navigationSource).toContain('key: "rules_distill", path: "#/intelligence/rules"');
    expect(navigationSource).toContain('key: "runtime_ops", path: "#/intelligence/worker"');
    expect(navigationSource).toContain('key: "spec_designs", path: "#/intelligence/specs"');
    expect(navigationSource).toContain('key: "data_context", path: "#/data/sources"');
    expect(navigationSource).not.toContain('subnav("intelligence", "knowledge", "rag", "memory", "rules", "distill", "specs", "design_docs", "datasources", "worker", "sync", "events", "usage")');
  });

  it("keeps marketplace catalog installed and rating signature routes focused", () => {
    const marketplaceSource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/Marketplace.tsx"), "utf8");
    expect(navigationSource).toContain('key: "marketplaceCatalog", path: "#/marketplace/catalog", el: pageElement(MarketplacePage, { initialModule: "catalog" })');
    expect(navigationSource).toContain('key: "marketplaceInstalled", path: "#/marketplace/installed", el: pageElement(MarketplacePage, { initialModule: "installed" })');
    expect(navigationSource).toContain('key: "marketplaceRatings", path: "#/marketplace/ratings", el: pageElement(MarketplacePage, { initialModule: "ratings" })');
    expect(marketplaceSource).toContain('type MarketModule = "catalog" | "installed" | "ratings"');
    expect(marketplaceSource).toContain('function RatingSignatureWorkbench');
    expect(marketplaceSource).toContain('signatureFilter');
    expect(marketplaceSource).toContain('ratingRows');
  });

  it("keeps report assets subscription and action task routes focused", () => {
    const reportsSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/AnalyticsReportsWorkbench.tsx"), "utf8");
    const analyticsSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/Analytics.tsx"), "utf8");
    expect(navigationSource).toContain('key: "reportAssets", path: "#/analytics/reports/assets", el: pageElement(AnalyticsReportsWorkbenchPage, { initialView: "assets" })');
    expect(navigationSource).toContain('key: "reportSubscription", path: "#/analytics/reports/subscription", el: pageElement(AnalyticsReportsWorkbenchPage, { initialView: "subscription" })');
    expect(navigationSource).toContain('key: "reportActionTasks", path: "#/analytics/reports/action-tasks", el: pageElement(AnalyticsReportsWorkbenchPage, { initialView: "actionTasks" })');
    expect(reportsSource).toContain('type ReportsView = "overview" | "assets" | "subscription" | "actionTasks"');
    expect(reportsSource).toContain('reportsView={view}');
    expect(analyticsSource).toContain('export type ReportsView = "overview" | "assets" | "subscription" | "actionTasks"');
    expect(analyticsSource).toContain('const showReportAssets');
    expect(analyticsSource).toContain('const showReportSubscription');
    expect(analyticsSource).toContain('const showReportActionTasks');
  });

  it("keeps audit chain events module actions and approvals routes focused", () => {
    const auditSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/Audit.tsx"), "utf8");
    expect(navigationSource).toContain('key: "auditChain", path: "#/audit/chain", el: pageElement(AuditPage, { initialModule: "chain" })');
    expect(navigationSource).toContain('key: "auditEvents", path: "#/audit/events", el: pageElement(AuditPage, { initialModule: "events" })');
    expect(navigationSource).toContain('key: "auditModuleActions", path: "#/audit/module-actions", el: pageElement(AuditPage, { initialModule: "actions" })');
    expect(navigationSource).toContain('key: "auditApprovals", path: "#/audit/approvals", el: pageElement(AuditPage, { initialModule: "approvals" })');
    expect(auditSource).toContain('type AuditModule = "chain" | "events" | "actions" | "approvals" | "record"');
    expect(auditSource).toContain('type AuditProps = { initialModule?: AuditModule }');
    expect(auditSource).toContain('module === "actions" || module === "approvals"');
    expect(auditSource).toContain('module === "approvals"');
  });

  it("keeps data quality metrics and tag service subroutes from sharing generic tabs", () => {
    const dataQualitySource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/DataQualityWorkbench.tsx"), "utf8");
    const metricsSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/MetricsWorkbench.tsx"), "utf8");
    expect(navigationSource).toContain('key: "dataQualityReports", path: "#/data/quality/reports", el: pageElement(DataQualityWorkbenchPage, { focused: true, initialTab: "reports" })');
    expect(navigationSource).toContain('key: "metricsSemantic", path: "#/data/metrics/semantic", el: pageElement(MetricsWorkbenchPage, { focused: true, initialTab: "semantic" })');
    expect(navigationSource).toContain('key: "metricsMonitor", path: "#/data/metrics/monitor", el: pageElement(MetricsWorkbenchPage, { focused: true, initialTab: "monitor" })');
    expect(navigationSource).toContain('key: "tagApi", path: "#/data/tags/api", el: pageElement(TagWorkbenchPage, { focused: true, initialTab: "profiles" })');
    expect(dataQualitySource).toContain('type Tab = "rules" | "runs" | "alerts" | "reports"');
    expect(dataQualitySource).toContain('tab === "reports"');
    expect(metricsSource).toContain('type Tab = "catalog" | "semantic" | "published" | "monitor"');
    expect(metricsSource).toContain('tab === "monitor"');
  });

  it("keeps ops center as a light hub with focused production ops modules", () => {
    expect(navigationSource).toContain('key: "opsCenter", path: "#/system/ops-center"');
    expect(navigationSource).toContain('subnav("system/ops-center", "pipeline", "alerts", "rca", "runbook", "self-heal")');
    expect(navigationSource).toContain('key: "opsCenterPipeline", path: "#/system/ops-center/pipeline"');
    expect(navigationSource).toContain('key: "opsCenterAlerts", path: "#/system/ops-center/alerts"');
    expect(navigationSource).toContain('key: "opsCenterRca", path: "#/system/ops-center/rca"');
    expect(navigationSource).toContain('key: "opsCenterRunbook", path: "#/system/ops-center/runbook"');
    expect(navigationSource).toContain('key: "opsCenterSelfHeal", path: "#/system/ops-center/self-heal"');
  });

  it("keeps submodule quick links aligned with implemented routes instead of default camel-case hashes", () => {
    expect(navigationSource).toContain("const SUBMODULE_ROUTE_OVERRIDES");
    expect(navigationSource).toContain('SUBMODULE_ROUTE_OVERRIDES[`${pageKey}.${key}`]');
    expect(navigationSource).toContain('"analyticsReports.report_assets": "#/analytics/reports/assets"');
    expect(navigationSource).toContain('"analyticsReports.report_subscription": "#/analytics/reports/subscription"');
    expect(navigationSource).toContain('"analyticsReports.action_tasks": "#/analytics/reports/action-tasks"');
    expect(navigationSource).toContain('"marketplace.rating": "#/marketplace/ratings"');
    expect(navigationSource).toContain('"marketplace.signature": "#/marketplace/ratings"');
    expect(navigationSource).toContain('key: "skillsInstalled", path: "#/skills-hub/installed", el: pageElement(SkillsHubPage, { initialTab: "installed", focused: true })');
    expect(navigationSource).toContain('"audit.hash_chain": "#/audit/chain"');
    expect(navigationSource).toContain('"audit.module_actions": "#/audit/module-actions"');
    expect(navigationSource).toContain('"systemMap.registry": "#/system-map/registry"');
    expect(navigationSource).toContain('"systemMap.governance-tasks": "#/system-map/governance-tasks"');
    expect(navigationSource).toContain('"devFlow.pipeline": "#/dev-flow/workbench"');
    expect(navigationSource).not.toContain('path: `#/${pageKey}/${key}`');
  });
});
