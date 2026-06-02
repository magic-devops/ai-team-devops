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
    expect(navigationSource).toContain('key: "agentRuns"');
    expect(navigationSource).toContain('Agent 运行中心：运行列表、心跳、能力画像、SLO 与再平衡任务化');
    expect(navigationSource).toContain('key: "run_list", path: "#/ai/agent-ops/runs"');
    expect(navigationSource).toContain('key: "heartbeat", path: "#/ai/agent-ops/heartbeat"');
    expect(navigationSource).toContain('key: "capability_profiles", path: "#/ai/agent-ops/profiles"');
    expect(navigationSource).toContain('key: "retry", path: "#/ai/agent-ops/retry"');
    expect(navigationSource).toContain('key: "evidence", path: "#/tasks?tab=scheduler&panel=agent-reports"');
    expect(navigationSource).toContain('key: "slo_rebalance", path: "#/platforms/agent-runs"');
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

  it("keeps ops center as a light hub with focused production ops modules", () => {
    expect(navigationSource).toContain('key: "opsCenter", path: "#/system/ops-center"');
    expect(navigationSource).toContain('subnav("system/ops-center", "pipeline", "alerts", "rca", "runbook", "self-heal")');
    expect(navigationSource).toContain('key: "opsCenterPipeline", path: "#/system/ops-center/pipeline"');
    expect(navigationSource).toContain('key: "opsCenterAlerts", path: "#/system/ops-center/alerts"');
    expect(navigationSource).toContain('key: "opsCenterRca", path: "#/system/ops-center/rca"');
    expect(navigationSource).toContain('key: "opsCenterRunbook", path: "#/system/ops-center/runbook"');
    expect(navigationSource).toContain('key: "opsCenterSelfHeal", path: "#/system/ops-center/self-heal"');
  });
});
