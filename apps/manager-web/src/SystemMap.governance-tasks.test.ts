import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("SystemMap governance task operations", () => {
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const taskPanelSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/SystemGovernanceTasksPanel.tsx"), "utf8");
  const apiSource = readFileSync(resolve(root, "src/lib/api.ts"), "utf8");
  const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
  const zhSource = readFileSync(resolve(root, "src/i18n/zh-CN.json"), "utf8");

  it("connects the governance task panel to the real backend API", () => {
    expect(apiSource).toContain("systemPagesGovernanceTasks");
    expect(apiSource).toContain("systemPagesGovernanceTasksBulkUpdate");
    expect(apiSource).toContain("/api/v1/system/pages/governance-tasks");
    expect(apiSource).toContain("/api/v1/system/pages/governance-tasks/bulk-update");
    expect(systemMapSource).toContain("api.systemPagesGovernanceTasks");
    expect(systemMapSource).toContain("api.systemPagesGovernanceTasksBulkUpdate");
    expect(systemMapSource).toContain("SystemGovernanceTasksPanel");
  });

  it("keeps governance task operations as an independent reusable panel", () => {
    expect(taskPanelSource).toContain("export function SystemGovernanceTasksPanel");
    expect(taskPanelSource).toContain('from "antd"');
    expect(taskPanelSource).toContain("<Segmented");
    expect(taskPanelSource).toContain("<Select");
    expect(taskPanelSource).toContain("<Table");
    expect(taskPanelSource).toContain("source_label");
    expect(taskPanelSource).toContain("source_route");
    expect(taskPanelSource).toContain("task_url");
    expect(taskPanelSource).toContain("rowSelection");
    expect(taskPanelSource).toContain("selectedRowKeys");
    expect(taskPanelSource).toContain("summary.bulk_actions");
  });

  it("supports safe bulk handling for selected governance tasks", () => {
    expect(systemMapSource).toContain("governanceTasksBulkUpdate");
    expect(systemMapSource).toContain("onBulkUpdate");
    expect(taskPanelSource).toContain("bulkStatus");
    expect(taskPanelSource).toContain("bulkPriority");
    expect(taskPanelSource).toContain("bulkAssignee");
    expect(taskPanelSource).toContain("applyGovernanceTaskBulkUpdate");
    expect(taskPanelSource).toContain("bulkResult");
  });

  it("preserves a dedicated menu unit for governance tasks", () => {
    expect(navigationSource).toContain('key: "systemMapGovernanceTasks"');
    expect(navigationSource).toContain('path: "#/system-map/governance-tasks"');
    expect(navigationSource).toContain('capability: "governance.system-map.governance-tasks"');
    expect(navigationSource).toContain('initialSection: "tasks"');
  });

  it("keeps SystemMap subroutes focused instead of rendering one heavy page", () => {
    expect(systemMapSource).toContain("type SystemMapSection");
    expect(systemMapSource).toContain("systemMapFocusedNav");
    expect(systemMapSource).toContain("showRegistry");
    expect(systemMapSource).toContain("showReadiness");
    expect(systemMapSource).toContain("showIsolation");
    expect(navigationSource).toContain('key: "pageRegistry"');
    expect(navigationSource).toContain('initialSection: "registry"');
    expect(navigationSource).toContain('initialSection: "manifest"');
    expect(navigationSource).toContain('initialSection: "capabilities"');
    expect(navigationSource).toContain('path: "#/system-map/migration"');
    expect(navigationSource).toContain('initialSection: "migration"');
  });

  it("ships localized product labels for the task operations unit", () => {
    const zh = JSON.parse(zhSource);
    expect(zh.nav.systemMapGovernanceTasks).toBe("治理任务化");
    expect(zh.page.systemMap.governanceTasksTitle).toBe("治理任务运营");
    expect(zh.page.systemMap.governanceTasksOpen).toBe("未完成");
    expect(zh.page.systemMap.governanceTasksSource).toBe("任务来源");
    expect(zh.page.systemMap.openTaskCenter).toBe("打开任务中心");
    expect(zh.page.systemMap.applyGovernanceTaskBulkUpdate).toBe("批量更新");
    expect(zh.page.systemMap.governanceTaskBulkResult).toBe("计划 {{planned}} 个，已更新 {{updated}} 个，跳过 {{skipped}} 个。");
  });
});
