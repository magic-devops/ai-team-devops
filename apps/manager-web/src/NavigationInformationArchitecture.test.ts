import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { agentRunsHash, agentRunsTabs, parseAgentRunsRoute } from "./lib/canonicalAgentRuns";

const root = resolve(__dirname, "..");

describe("navigation information architecture", () => {
  const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
  const projectsSource = readFileSync(resolve(root, "subapps/main-admin/src/pages/Projects.tsx"), "utf8");
  const projectsRouteSource = readFileSync(resolve(root, "subapps/main-admin/src/pages/projects/deliveryKitNav.ts"), "utf8");
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const systemModuleContractSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/SystemModuleContractPanel.tsx"), "utf8");
  it("maps requirement routes to existing server capability identifiers", () => {
    const serverSource = readFileSync(resolve(root, "../manager/sop_manager/routers/system_pages.py"), "utf8");
    for (const [route, submodule] of [["pool", "requirement_pool"], ["review", "smart_review"], ["generation", "task_generation"], ["batch", "batch_governance"]]) {
      expect(serverSource).toContain(`("requirements", "${submodule}"): "#/requirements/${route}"`);
      expect(navigationSource).toContain(`path: "#/requirements/${route}", capability: "product.requirements.${submodule}"`);
    }
    expect(navigationSource).not.toContain('capability: "product.requirements.workbench"');
    expect(navigationSource).toMatch(/key: "productRequirementsWorkbench",[\s\S]*?capability: "product.requirements"/);
  });

  it("keeps project portfolio and business-line governance from competing in the main menu", () => {
    expect(navigationSource).toContain('subnav("projects", "portfolio", "tenants", "tenant_users", "project_members", "delivery-kit")');
    expect(navigationSource).toContain('key: "projectBusinesses"');
    expect(navigationSource).toContain('hidden: true, parentKey: "projects"');
    expect(projectsRouteSource).toContain('seg === "businesses"');
    expect(projectsSource).not.toContain('{ key: "business", icon: Building2 }');
  });

  it("groups manifest capabilities and actions under one module contract entry", () => {
    expect(navigationSource).toContain('subnav("systemMap", "productization", "registry", "contract", "readiness", "performance", "three-code-isolation", "source-scan", "baseline-compare", "governance-tasks", "migration")');
    expect(navigationSource).toContain('key: "systemMapProductization"');
    expect(navigationSource).toContain('capability: "governance.system-map.productization"');
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
    const dataIngestSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/DataIngestWorkbench.tsx"), "utf8");
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
    expect(dataIngestSource).toContain('export function DataIngestWorkbench({ focused = false');
    expect(dataIngestSource).toContain("const TAB_KEYS: Tab[]");
    expect(dataIngestSource).toContain("page.dataIngest.modules.");
    expect(dataIngestSource).toContain('t("page.dataIngest.focusedHint")');
    expect(dataIngestSource).toContain("TAB_HREF");
    expect(dataIngestSource).toContain("ColumnsType");
    expect(dataIngestSource).toContain("Popconfirm");
    expect(dataIngestSource).toContain("Table rowKey");
    expect(dataIngestSource).toContain('t("page.dataIngest.panels.connectors")');
    expect(dataIngestSource).toContain('t("page.dataIngest.aiTitle")');
    expect(dataIngestSource).not.toContain("focused: _focused");
    expect(dataIngestSource).not.toContain('title="AI 智能助手"');
  });

  it("keeps agent run operations split between focused AgentOps and platform SLO governance", () => {
    const agentRunsSource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ai/AgentRunsWorkbench.tsx"), "utf8");
    expect(navigationSource).toContain('key: "agentRuns"');
    expect(navigationSource).toContain('Agent 运行中心：运行列表、心跳、能力画像、SLO 与再平衡任务化');
    expect(navigationSource).toContain('key: "agentOpsRuns", path: "#/ai/agent-ops/runs", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "runs" })');
    expect(navigationSource).toContain('key: "agentOpsHeartbeat", path: "#/ai/agent-ops/heartbeat", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "heartbeat" })');
    expect(navigationSource).toContain('key: "agentOpsProfiles", path: "#/ai/agent-ops/profiles", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "profiles" })');
    expect(navigationSource).toContain('key: "agentOpsRetry", path: "#/ai/agent-ops/retry", el: pageElement(AgentRunsWorkbenchPage, { focused: true, initialTab: "retry" })');
    expect(agentRunsTabs).toEqual(["runs", "heartbeat", "profiles", "retry"]);
    for (const tab of agentRunsTabs) {
      const route = parseAgentRunsRoute(`#/ai/agent-ops/${tab}?project_id=P&q=T&cursor=opaque`);
      expect(route).toMatchObject({ tab, projectId: "P", q: "T", cursor: "opaque" });
      expect(parseAgentRunsRoute(agentRunsHash(route))).toEqual(route);
    }
    expect(agentRunsSource).toContain('export function AgentRunsWorkbench({ focused = false');
    expect(agentRunsSource).toContain("canonicalAgentRunsCopy(i18n.language)");
    expect(agentRunsSource).toContain("focused ? copy.tabs[route.tab] : copy.title");
    expect(agentRunsSource).toContain("ProjectContextGate requireSelection");
    expect(agentRunsSource).not.toContain("api.agentRun");
    expect(agentRunsSource).not.toContain("focused: _focused");
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

  it("uses one formal external work-order flow while retaining reachable former paths", () => {
    const a2aSource = readFileSync(resolve(root, "subapps/ai-foundation/src/pages/ecosystem/A2aWorkbench.tsx"), "utf8");
    expect(navigationSource).toContain('key: "a2aGateway", path: "#/ecosystem/a2a"');
    expect(navigationSource).toContain('subnav("ecosystem/a2a", "dispatch", "negotiate", "evidence")');
    expect(navigationSource).toContain('key: "a2aRegistry", path: "#/ecosystem/a2a/registry"');
    expect(a2aSource).toContain("ProjectContextGate requireSelection");
    expect(a2aSource).toContain("ExternalWorkOrderPanel");
    expect(a2aSource).not.toContain("manual-${Date.now()}");
    expect(a2aSource).not.toContain("a2aReceiveEvidence");
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
    const dataSourcesSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/intelligence/DataSourcesWorkbench.tsx"), "utf8");
    const metadataSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/MetadataManagementWorkbench.tsx"), "utf8");
    expect(navigationSource).toContain('key: "dataSources"');
    expect(navigationSource).toContain('数据源管理：连接目录、SecretRef、元数据发现、安全治理与 Schema Registry 同步');
    expect(navigationSource).toContain('key: "dataSourcesSecurity", path: "#/data/sources/security"');
    expect(navigationSource).toContain('pageElement(DataSourcesWorkbenchPage, { focused: true, initialView: "security" })');
    expect(dataSourcesSource).toContain('const VIEW_KEYS: DataSourceView[]');
    expect(dataSourcesSource).toContain("page.dataSources.modules.");
    expect(dataSourcesSource).toContain('t("page.dataSources.focusedHint")');
    expect(dataSourcesSource).toContain('t("page.dataSources.workbenchTitle")');
    expect(dataSourcesSource).toContain('t("page.dataSources.messages.saved")');
    expect(dataSourcesSource).toContain('t("page.dataSources.connections.panel")');
    expect(dataSourcesSource).toContain('t("page.dataSources.security.result")');
    expect(dataSourcesSource).toContain('t("page.dataSources.editor.createTitle")');
    expect(dataSourcesSource).toContain("Table rowKey");
    expect(dataSourcesSource).toContain("Popconfirm");
    expect(dataSourcesSource).not.toContain("确认删除该数据源？");
    expect(dataSourcesSource).toContain("VIEW_HREF");
    expect(navigationSource).toContain('key: "metadataManagement"');
    expect(navigationSource).toContain('submodules: subnav("data/metadata", "overview", "assets", "fields", "lineage")');
    expect(metadataSource).toContain("const VIEW_KEYS: MetadataView[]");
    expect(metadataSource).toContain("page.metadataManagement.modules.");
    expect(metadataSource).toContain('t("page.metadataManagement.focusedHint")');
    expect(metadataSource).toContain('t("page.metadataManagement.workbenchTitle")');
    expect(metadataSource).toContain("api.metadataGovernanceTasks");
    expect(metadataSource).toContain("useEffect");
    expect(metadataSource).toContain('t("page.metadataManagement.tasks.preview")');
    expect(metadataSource).toContain('t("page.metadataManagement.filters.reset")');
  });

  it("keeps metadata management split into focused asset field and lineage routes", () => {
    const metadataSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/MetadataManagementWorkbench.tsx"), "utf8");
    expect(navigationSource).toContain('key: "metadataManagement"');
    expect(navigationSource).toContain('元数据管理：资产、字段、分类和血缘影响');
    expect(navigationSource).toContain('key: "metadataFields", path: "#/data/metadata/fields"');
    expect(navigationSource).toContain('key: "metadataLineage", path: "#/data/metadata/lineage"');
    expect(navigationSource).toContain('pageElement(MetadataManagementWorkbenchPage, { focused: true, initialView: "assets" })');
    expect(metadataSource).toContain("page.metadataManagement.modules.");
    expect(metadataSource).toContain('t("page.metadataManagement.workbenchTitle")');
    expect(metadataSource).toContain('t("page.metadataManagement.focusedHint")');
    expect(metadataSource).toContain('api.metadataClassifyAsset');
    expect(metadataSource).toContain('api.metadataGovernanceTasks');
    expect(metadataSource).toContain('t("page.metadataManagement.assets.lineageAction")');
    expect(metadataSource).toContain('t("page.metadataManagement.classify.ownerPlaceholder")');
    expect(metadataSource).not.toContain("focused: _focused");
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
    const tagSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/TagWorkbench.tsx"), "utf8");
    const dataDevSource = readFileSync(resolve(root, "subapps/ai-data-center/src/pages/data/DataDevWorkbench.tsx"), "utf8");
    expect(navigationSource).toContain('key: "dataQualityReports", path: "#/data/quality/reports", el: pageElement(DataQualityWorkbenchPage, { focused: true, initialTab: "reports" })');
    expect(navigationSource).toContain('key: "dataQualityImpact", path: "#/data/quality/impact", el: pageElement(DataQualityWorkbenchPage, { focused: true, initialTab: "impact" })');
    expect(navigationSource).toContain('key: "dataQualityRca", path: "#/data/quality/rca", el: pageElement(DataQualityWorkbenchPage, { focused: true, initialTab: "rca" })');
    expect(navigationSource).toContain('key: "dataQualityForecast", path: "#/data/quality/forecast", el: pageElement(DataQualityWorkbenchPage, { focused: true, initialTab: "forecast" })');
    expect(navigationSource).toContain('key: "dataQualitySubscriptions", path: "#/data/quality/subscriptions", el: pageElement(DataQualityWorkbenchPage, { focused: true, initialTab: "subscriptions" })');
    expect(navigationSource).toContain('key: "metricsSemantic", path: "#/data/metrics/semantic", el: pageElement(MetricsWorkbenchPage, { focused: true, initialTab: "semantic" })');
    expect(navigationSource).toContain('key: "metricsMonitor", path: "#/data/metrics/monitor", el: pageElement(MetricsWorkbenchPage, { focused: true, initialTab: "monitor" })');
    expect(navigationSource).toContain('key: "metricsApprovals", path: "#/data/metrics/approvals", el: pageElement(MetricsWorkbenchPage, { focused: true, initialTab: "approvals" })');
    expect(navigationSource).toContain('key: "tagCatalog", path: "#/data/tags/catalog", el: pageElement(TagWorkbenchPage, { focused: true, initialTab: "catalog" })');
    expect(navigationSource).toContain('key: "tagRules", path: "#/data/tags/rules", el: pageElement(TagWorkbenchPage, { focused: true, initialTab: "rules" })');
    expect(navigationSource).toContain('key: "tagApi", path: "#/data/tags/api", el: pageElement(TagWorkbenchPage, { focused: true, initialTab: "profiles" })');
    expect(navigationSource).toContain('key: "tagGovernance", path: "#/data/tags/governance", el: pageElement(TagWorkbenchPage, { focused: true, initialTab: "governance" })');
    expect(navigationSource).toContain('key: "tagApprovals", path: "#/data/tags/approvals", el: pageElement(TagWorkbenchPage, { focused: true, initialTab: "approvals" })');
    expect(navigationSource).toContain('key: "dataDevSql", path: "#/data/dev/sql_editor", el: pageElement(DataDevWorkbenchPage, { focused: true, initialTab: "sql_editor" })');
    expect(navigationSource).toContain('key: "dataDevSpark", path: "#/data/dev/spark_jobs", el: pageElement(DataDevWorkbenchPage, { focused: true, initialTab: "spark_jobs" })');
    expect(navigationSource).toContain('key: "dataDevFlink", path: "#/data/dev/flink_jobs", el: pageElement(DataDevWorkbenchPage, { focused: true, initialTab: "flink_jobs" })');
    expect(navigationSource).toContain('key: "dataDevSchedules", path: "#/data/dev/schedules", el: pageElement(DataDevWorkbenchPage, { focused: true, initialTab: "schedules" })');
    expect(navigationSource).toContain('key: "dataDevAgentFeed", path: "#/data/dev/agent-feed", el: pageElement(DataDevWorkbenchPage, { focused: true, initialTab: "agent_feed" })');
    expect(navigationSource).toContain('key: "dataDevEvidence", path: "#/data/dev/evidence", el: pageElement(DataDevWorkbenchPage, { focused: true, initialTab: "evidence" })');
    expect(navigationSource).toContain('key: "dataDevRunbook", path: "#/data/dev/runbook", el: pageElement(DataDevWorkbenchPage, { focused: true, initialTab: "runbook" })');
    expect(dataQualitySource).toContain('type Tab = "rules" | "runs" | "alerts" | "reports" | "impact" | "rca" | "forecast" | "subscriptions"');
    expect(dataQualitySource).toContain('tab === "reports"');
    expect(dataQualitySource).toContain('tab === "impact"');
    expect(dataQualitySource).toContain('tab === "rca"');
    expect(dataQualitySource).toContain('tab === "forecast"');
    expect(dataQualitySource).toContain('tab === "subscriptions"');
    expect(dataQualitySource).toContain("api.dataQualityImpact");
    expect(dataQualitySource).toContain("api.dataQualityImpactTasks");
    expect(dataQualitySource).toContain("api.dataQualityRca");
    expect(dataQualitySource).toContain("api.dataQualityRcaTasks");
    expect(dataQualitySource).toContain("api.dataQualityForecast");
    expect(dataQualitySource).toContain("api.dataQualityForecastTasks");
    expect(dataQualitySource).toContain("api.dataQualitySubscriptions");
    expect(dataQualitySource).toContain("api.dataQualitySubscriptionRun");
    expect(dataQualitySource).toContain("const TAB_KEYS: Tab[]");
    expect(dataQualitySource).toContain("TAB_HREF");
    expect(dataQualitySource).toContain('export function DataQualityWorkbench({ focused = false');
    expect(dataQualitySource).toContain("page.dataQuality.modules.");
    expect(dataQualitySource).toContain('t("page.dataQuality.focusedHint")');
    expect(dataQualitySource).toContain('t("page.dataQuality.panels.rules")');
    expect(dataQualitySource).toContain("ColumnsType");
    expect(dataQualitySource).toContain("Popconfirm");
    expect(dataQualitySource).not.toContain("focused: _focused");
    expect(dataQualitySource).not.toContain('title="AI 智能助手"');
    expect(metricsSource).toContain('type Tab = "catalog" | "semantic" | "published" | "monitor" | "approvals"');
    expect(metricsSource).toContain('tab === "monitor"');
    expect(metricsSource).toContain("const TAB_KEYS: Tab[]");
    expect(metricsSource).toContain("TAB_HREF");
    expect(metricsSource).toContain('export function MetricsWorkbench({ focused = false');
    expect(metricsSource).toContain("page.metricsCenter.modules.");
    expect(metricsSource).toContain('t("page.metricsCenter.focusedHint")');
    expect(metricsSource).toContain('t("page.metricsCenter.panels.catalog")');
    expect(metricsSource).toContain('t("page.metricsCenter.tasks.preview")');
    expect(metricsSource).toContain("api.metricsGovernanceTasks");
    expect(metricsSource).toContain("api.metricApprovalCreate");
    expect(metricsSource).toContain("api.metricApprovalReview");
    expect(metricsSource).toContain("ColumnsType");
    expect(metricsSource).toContain("Popconfirm");
    expect(metricsSource).not.toContain("focused: _focused");
    expect(metricsSource).not.toContain('title="AI 智能助手"');
    expect(tagSource).toContain('type Tab = "catalog" | "rules" | "ontology" | "profiles" | "governance" | "approvals"');
    expect(tagSource).toContain("const TAB_KEYS: Tab[]");
    expect(tagSource).toContain("TAB_HREF");
    expect(tagSource).toContain('export function TagWorkbench({ focused = false');
    expect(tagSource).toContain("page.tagService.modules.");
    expect(tagSource).toContain('t("page.tagService.focusedHint")');
    expect(tagSource).toContain('t("page.tagService.panels.catalog")');
    expect(tagSource).toContain('t("page.tagService.panels.governance")');
    expect(tagSource).toContain("api.tagGovernanceTasks");
    expect(tagSource).toContain("api.tagApprovalCreate");
    expect(tagSource).toContain("api.tagApprovalReview");
    expect(tagSource).toContain("ColumnsType");
    expect(tagSource).toContain("Popconfirm");
    expect(tagSource).not.toContain("focused: _focused");
    expect(tagSource).not.toContain('title="AI 智能助手"');
    expect(dataDevSource).toContain('export function DataDevWorkbench({ focused = false');
    expect(dataDevSource).toContain("type FocusKey = Tab | LegacyTab");
    expect(dataDevSource).toContain("page.dataDev.modules.");
    expect(dataDevSource).toContain('t("page.dataDev.focusedHint")');
    expect(dataDevSource).toContain('t("page.dataDev.panels.templates")');
    expect(dataDevSource).toContain('t("page.dataDev.aiTitle")');
    expect(dataDevSource).toContain("const TAB_HREF");
    expect(dataDevSource).toContain("ColumnsType");
    expect(dataDevSource).toContain("Table rowKey");
    expect(dataDevSource).toContain("visibleTemplates");
    expect(dataDevSource).not.toContain("focused: _focused");
  });

  it("keeps ops center as a light hub with focused production ops modules", () => {
    const opsCenterSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/OpsCenterWorkbench.tsx"), "utf8");
    expect(navigationSource).toContain('key: "opsCenter", path: "#/system/ops-center"');
    expect(navigationSource).toContain('subnav("system/ops-center", "pipeline", "alerts", "rca", "runbook", "self-heal")');
    expect(navigationSource).toContain('key: "opsCenterPipeline", path: "#/system/ops-center/pipeline"');
    expect(navigationSource).toContain('key: "opsCenterAlerts", path: "#/system/ops-center/alerts"');
    expect(navigationSource).toContain('key: "opsCenterRca", path: "#/system/ops-center/rca"');
    expect(navigationSource).toContain('key: "opsCenterRunbook", path: "#/system/ops-center/runbook"');
    expect(navigationSource).toContain('key: "opsCenterSelfHeal", path: "#/system/ops-center/self-heal"');
    expect(opsCenterSource).toContain('export function OpsCenterWorkbench({ focused = false');
    expect(opsCenterSource).toContain("page.opsCenter.modules.");
    expect(opsCenterSource).toContain('t("page.opsCenter.focusedHint")');
    expect(opsCenterSource).toContain('!focused ? <div className="opsCenterModeSwitch');
    expect(opsCenterSource).not.toContain("focused: _focused");
    expect(opsCenterSource).not.toContain('title="智能运维中心"');
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
