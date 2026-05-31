import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const source = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/system/OpsCenterWorkbench.tsx"), "utf8");

describe("OpsCenter workbench UX contract", () => {
  it("keeps OpsCenter modules routable and focused", () => {
    expect(source).toContain("OPS_CENTER_TAB_ROUTES");
    expect(source).toContain("readOpsCenterTabFromHash");
    expect(source).toContain("updateOpsCenterHash");
    expect(source).toContain("#/system/ops-center/pipeline");
    expect(source).toContain("#/system/ops-center/alerts");
    expect(source).toContain("#/system/ops-center/rca");
    expect(source).toContain("#/system/ops-center/runbook");
    expect(source).toContain("#/system/ops-center/self-heal");
  });

  it("uses a mature responsive module switch instead of hand-rolled tabs", () => {
    expect(source).toContain("Segmented");
    expect(source).toContain("opsCenterModeSwitch");
    expect(source).toContain("opsCenterModuleQuickSummary");
    expect(source).toContain("AI 分析当前模块");
    expect(source).not.toContain("border-b-2 transition ${tab === t.id");
  });
});
