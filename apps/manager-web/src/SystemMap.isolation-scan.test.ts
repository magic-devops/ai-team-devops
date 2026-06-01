import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("SystemMap isolation source scanner", () => {
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const sourceScanPanelSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/IsolationSourceScanPanel.tsx"), "utf8");
  const baselineComparePanelSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/IsolationBaselineComparePanel.tsx"), "utf8");
  const apiSource = readFileSync(resolve(root, "src/lib/api.ts"), "utf8");
  const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
  const zhSource = readFileSync(resolve(root, "src/i18n/zh-CN.json"), "utf8");

  it("exposes the isolation scan API contract in frontend code", () => {
    expect(apiSource).toContain("systemPagesIsolationScan");
    expect(apiSource).toContain("/api/v1/system/pages/isolation-audit/scan");
    expect(systemMapSource).toContain("api.systemPagesIsolationScan");
    expect(systemMapSource).toContain("systemPagesIsolationScan");
  });

  it("renders source-level scan metrics and recommendations", () => {
    expect(systemMapSource).toContain("IsolationSourceScanPanel");
    expect(sourceScanPanelSource).toContain("isolationSourceScan");
    expect(systemMapSource).toContain("isolationScannedFiles");
    expect(sourceScanPanelSource).toContain("isolationScanRecommendation");
    expect(sourceScanPanelSource).toContain("isolationNoScanIssues");
  });

  it("provides product controls for previewing and creating source scan tasks", () => {
    expect(apiSource).toContain("systemPagesIsolationScanTasks");
    expect(apiSource).toContain("/api/v1/system/pages/isolation-audit/scan/tasks");
    expect(systemMapSource).toContain("api.systemPagesIsolationScanTasks");
    expect(sourceScanPanelSource).toContain("includeProtectedIsolationScan");
    expect(sourceScanPanelSource).toContain("previewIsolationScanTasks");
    expect(sourceScanPanelSource).toContain("createIsolationScanTasks");
    expect(systemMapSource).toContain("isolationScanTaskResult");
  });

  it("persists source scan snapshots as a modular history unit", () => {
    expect(apiSource).toContain("systemPagesIsolationScanRuns");
    expect(apiSource).toContain("systemPagesIsolationScanRunCreate");
    expect(apiSource).toContain("/api/v1/system/pages/isolation-audit/scan/runs");
    expect(systemMapSource).toContain("api.systemPagesIsolationScanRuns");
    expect(systemMapSource).toContain("api.systemPagesIsolationScanRunCreate");
    expect(sourceScanPanelSource).toContain("saveIsolationScanRun");
    expect(sourceScanPanelSource).toContain("isolationScanRunHistory");
    expect(sourceScanPanelSource).toContain("<Table");
  });

  it("compares source scan snapshots with intelligent baseline insights", () => {
    expect(apiSource).toContain("systemPagesIsolationScanCompare");
    expect(apiSource).toContain("/api/v1/system/pages/isolation-audit/scan/runs/compare");
    expect(systemMapSource).toContain("api.systemPagesIsolationScanCompare");
    expect(sourceScanPanelSource).toContain("isolationScanCompare");
    expect(sourceScanPanelSource).toContain("IsolationBaselineComparePanel");
    expect(baselineComparePanelSource).toContain("isolationScanCompareTitle");
    expect(baselineComparePanelSource).toContain("<Progress");
    expect(baselineComparePanelSource).toContain("<Tag");
  });

  it("turns intelligent baseline differences into modular governance tasks", () => {
    expect(apiSource).toContain("systemPagesIsolationScanCompareTasks");
    expect(apiSource).toContain("/api/v1/system/pages/isolation-audit/scan/runs/compare/tasks");
    expect(systemMapSource).toContain("api.systemPagesIsolationScanCompareTasks");
    expect(sourceScanPanelSource).toContain("compareTaskResult");
    expect(sourceScanPanelSource).toContain("onPreviewCompareTasks");
    expect(sourceScanPanelSource).toContain("onCreateCompareTasks");
    expect(baselineComparePanelSource).toContain("previewIsolationScanCompareTasks");
    expect(baselineComparePanelSource).toContain("createIsolationScanCompareTasks");
    expect(baselineComparePanelSource).toContain("<Button");
  });

  it("keeps system governance menu grouped into clear modular units", () => {
    expect(navigationSource).toContain('subnav("systemMap", "registry", "contract", "readiness", "performance", "three-code-isolation", "source-scan", "baseline-compare", "governance-tasks", "migration")');
    expect(navigationSource).toContain('key: "moduleReadinessGovernance"');
    expect(navigationSource).toContain('capability: "governance.system-map.readiness"');
    expect(navigationSource).toContain('key: "threeCodeIsolationGovernance"');
    expect(navigationSource).toContain('capability: "governance.system-map.three-code-isolation"');
    expect(navigationSource).toContain('key: "sourceIsolationScan"');
    expect(navigationSource).toContain('initialSection: "source-scan"');
    expect(navigationSource).toContain('capability: "governance.system-map.source-scan"');
    expect(navigationSource).toContain('key: "isolationBaselineCompare"');
    expect(navigationSource).toContain('initialSection: "baseline-compare"');
    expect(navigationSource).toContain('capability: "governance.system-map.baseline-compare"');
    expect(navigationSource).toContain('key: "systemMapGovernanceTasks"');
    expect(navigationSource).toContain('capability: "governance.system-map.governance-tasks"');
    expect(navigationSource).toContain('key: "moduleContract"');
    expect(navigationSource).toContain('path: "#/system-map/contract"');
    expect(navigationSource).toContain('hidden: true, parentKey: "moduleContract"');
  });

  it("keeps the source scanner as a modular unit built from mature components", () => {
    expect(sourceScanPanelSource).toContain("export function IsolationSourceScanPanel");
    expect(baselineComparePanelSource).toContain("export function IsolationBaselineComparePanel");
    expect(sourceScanPanelSource).toContain('from "antd"');
    expect(baselineComparePanelSource).toContain('from "antd"');
    expect(sourceScanPanelSource).toContain("<Button");
    expect(sourceScanPanelSource).toContain("<Checkbox");
    expect(sourceScanPanelSource).toContain("<Table");
    expect(baselineComparePanelSource).toContain("<Progress");
    expect(baselineComparePanelSource).toContain("<Tag");
  });

  it("ships localized labels for the isolation source scanner", () => {
    const zh = JSON.parse(zhSource);
    expect(zh.page.systemMap.isolationSourceScan).toBe("源代码隔离扫描");
    expect(zh.page.systemMap.isolationScannedFiles).toBe("扫描文件");
    expect(zh.page.systemMap.isolationScanRecommendation).toBe("加固建议");
    expect(zh.page.systemMap.previewIsolationScanTasks).toBe("预览源码扫描任务");
    expect(zh.page.systemMap.createIsolationScanTasks).toBe("生成源码扫描任务");
    expect(zh.page.systemMap.saveIsolationScanRun).toBe("保存扫描快照");
    expect(zh.page.systemMap.isolationScanRunHistory).toBe("扫描快照历史");
    expect(zh.page.systemMap.isolationScanCompareTitle).toBe("智能基线对比");
    expect(zh.page.systemMap.isolationScanCompareResolved).toBe("已修复");
    expect(zh.page.systemMap.previewIsolationScanCompareTasks).toBe("预览对比治理任务");
    expect(zh.page.systemMap.createIsolationScanCompareTasks).toBe("生成对比治理任务");
  });
});
