import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("SystemMap Graph Loop productization control room", () => {
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const apiSource = readFileSync(resolve(root, "src/lib/api.ts"), "utf8");
  const zhSource = readFileSync(resolve(root, "src/i18n/zh-CN.json"), "utf8");

  it("wires the v3 Graph Loop API surface through the frontend client", () => {
    expect(apiSource).toContain("graphLoopRuns");
    expect(apiSource).toContain("graphLoopDetail");
    expect(apiSource).toContain("graphLoopEvents");
    expect(apiSource).toContain("graphLoopTransition");
    expect(apiSource).toContain("graphLoopInterruptDecision");
    expect(apiSource).toContain("graphLoopReplay");
    expect(apiSource).toContain("graphLoopExport");
    expect(apiSource).toContain("/api/v1/graph-loop/slo");
  });

  it("turns the productization route into an executable Graph Loop workbench", () => {
    expect(systemMapSource).toContain("graphLoopRunRows");
    expect(systemMapSource).toContain("graphLoopNodes");
    expect(systemMapSource).toContain("graphLoopEdges");
    expect(systemMapSource).toContain("pendingGraphInterrupts");
    expect(systemMapSource).toContain('const activeGraphRunId = selectedGraphRunId || String((graphLoopRunsQ.data?.items ?? [])[0]?.run_id || "");');
    expect(systemMapSource).not.toContain("selectedGraphRunId || String((graphLoopRunsQ.data?.items ?? [])[0]?.run_id || graphLoopQ.data?.summary?.run_id");
    expect(systemMapSource).toContain("createGraphLoopRun");
    expect(systemMapSource).toContain("transitionGraphLoopRun");
    expect(systemMapSource).toContain("decideGraphLoopInterrupt");
    expect(systemMapSource).toContain("replayGraphLoopRun");
    expect(systemMapSource).toContain("exportGraphLoopRun");
  });

  it("keeps permission and CLI evidence visible in the focused workbench", () => {
    expect(systemMapSource).toContain("canExecuteGraphLoop");
    expect(systemMapSource).toContain("canApproveGraphLoop");
    expect(systemMapSource).toContain("productizationCommands.slice(0, 10)");
    expect(systemMapSource).toContain("graphLoopActionResult");
    expect(systemMapSource).toContain("policyMode");
  });

  it("ships localized Graph Loop SLO metric labels", () => {
    const zh = JSON.parse(zhSource);
    expect(zh.page.systemMap.graphLoopSlo).toBe("运行 SLO");
  });
});
