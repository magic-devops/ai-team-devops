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
});
