import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

describe("navigation information architecture", () => {
  const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
  const projectsSource = readFileSync(resolve(root, "subapps/main-admin/src/pages/Projects.tsx"), "utf8");
  const projectsRouteSource = readFileSync(resolve(root, "subapps/main-admin/src/pages/projects/deliveryKitNav.ts"), "utf8");
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");

  it("keeps project portfolio and business-line governance from competing in the main menu", () => {
    expect(navigationSource).toContain('subnav("projects", "portfolio", "tenants", "tenant_users", "project_members", "delivery-kit")');
    expect(navigationSource).toContain('key: "projectBusinesses"');
    expect(navigationSource).toContain('hidden: true, parentKey: "projects"');
    expect(projectsRouteSource).toContain('seg === "businesses"');
    expect(projectsSource).not.toContain('{ key: "business", icon: Building2 }');
  });

  it("groups manifest capabilities and actions under one module contract entry", () => {
    expect(navigationSource).toContain('subnav("systemMap", "registry", "contract", "readiness", "three-code-isolation", "source-scan", "baseline-compare", "governance-tasks", "migration")');
    expect(navigationSource).toContain('key: "moduleContract"');
    expect(navigationSource).toContain('path: "#/system-map/contract"');
    expect(navigationSource).toContain('hidden: true, parentKey: "moduleContract"');
    expect(systemMapSource).toContain('"module-contract"');
    expect(systemMapSource).toContain('value: "module-contract"');
    expect(systemMapSource).toContain('type ContractPanel = "manifest" | "capabilities" | "actions"');
    expect(systemMapSource).toContain('const showOverview = section === "overview"');
    expect(systemMapSource).toContain('const showRegistry = section === "registry"');
    expect(systemMapSource).toContain('activeContractPanel === "capabilities"');
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
});
