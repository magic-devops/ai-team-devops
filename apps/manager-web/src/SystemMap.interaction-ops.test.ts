import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("governance delivery interaction ops control room", () => {
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const devFlowSource = readFileSync(resolve(root, "subapps/ai-rd-center/src/pages/delivery/DevFlowWorkbench.tsx"), "utf8");
  const tasksSource = readFileSync(resolve(root, "subapps/ai-rd-center/src/pages/Tasks.tsx"), "utf8");
  const apiSource = readFileSync(resolve(root, "src/lib/api.ts"), "utf8");
  const zhSource = readFileSync(resolve(root, "src/i18n/zh-CN.json"), "utf8");
  const enSource = readFileSync(resolve(root, "src/i18n/en-US.json"), "utf8");
  const jaSource = readFileSync(resolve(root, "src/i18n/ja-JP.json"), "utf8");

  it("wires the interaction ops API surface through the frontend client", () => {
    expect(apiSource).toContain("pagesInteractionOps");
    expect(apiSource).toContain("pagesInteractionOpsTasks");
    expect(apiSource).toContain("pagesInteractionOpsMemory");
    expect(apiSource).toContain("pagesInteractionOpsExport");
    expect(apiSource).toContain("/api/v1/pages/interaction-ops/tasks");
    expect(apiSource).toContain("/api/v1/pages/interaction-ops/memory");
    expect(apiSource).toContain("/api/v1/pages/interaction-ops/export");
  });

  it("turns SystemMap productization into the main governance delivery control room", () => {
    expect(systemMapSource).toContain("interactionOpsQ");
    expect(systemMapSource).toContain("interactionOpsRows");
    expect(systemMapSource).toContain("interactionOpsTasks");
    expect(systemMapSource).toContain("interactionOpsMemory");
    expect(systemMapSource).toContain("interactionOpsExport");
    expect(systemMapSource).toContain("canWriteInteractionOps");
    expect(systemMapSource).toContain("canExportInteractionOps");
    expect(systemMapSource).toContain("risk lanes、execution lanes、evidence lanes");
    expect(systemMapSource).toContain("sop pages interaction-ops");
  });

  it("connects DevFlow and Tasks back to the same interaction ops lane", () => {
    expect(devFlowSource).toContain("devFlowInteractionOps");
    expect(devFlowSource).toContain("pagesInteractionOpsTasks");
    expect(devFlowSource).toContain("openGraphLoopControlRoom");
    expect(tasksSource).toContain("tasksInteractionOps");
    expect(tasksSource).toContain('value: "interaction_ops"');
    expect(tasksSource).toContain("pagesInteractionOpsMemory");
    expect(tasksSource).toContain("pagesInteractionOpsExport");
    expect(tasksSource).toContain("backfillInteractionOpsEvidence");
  });

  it("keeps interaction ops labels localized", () => {
    const zh = JSON.parse(zhSource);
    const en = JSON.parse(enSource);
    const ja = JSON.parse(jaSource);

    expect(zh.page.systemMap.interactionOpsControlRoom).toBe("治理交付控制室");
    expect(zh.page.devFlow.openGraphLoopControlRoom).toBe("打开 Graph Loop 控制室");
    expect(zh.page.tasks.sourceInteractionOps).toBe("治理交付控制室");
    expect(en.page.tasks.interactionOpsTitle).toBe("Governance delivery source analysis");
    expect(ja.page.systemMap.interactionOpsEmpty).toBe("治理デリバリーリスクはありません");
  });
});
