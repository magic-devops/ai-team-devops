import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("SystemMap interaction analysis productization", () => {
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const apiSource = readFileSync(resolve(root, "src/lib/api.ts"), "utf8");
  const zhSource = readFileSync(resolve(root, "src/i18n/zh-CN.json"), "utf8");
  const enSource = readFileSync(resolve(root, "src/i18n/en-US.json"), "utf8");
  const jaSource = readFileSync(resolve(root, "src/i18n/ja-JP.json"), "utf8");

  it("wires the interaction analysis API through the frontend client", () => {
    expect(apiSource).toContain("pagesInteractionAnalysis");
    expect(apiSource).toContain("/api/v1/pages/interaction-analysis");
    expect(apiSource).toContain("status");
    expect(apiSource).toContain("limit");
  });

  it("renders interaction scoring and risk analysis inside the productization workbench", () => {
    expect(systemMapSource).toContain("interactionAnalysisQ");
    expect(systemMapSource).toContain("pagesInteractionAnalysis");
    expect(systemMapSource).toContain("interactionScore");
    expect(systemMapSource).toContain("interactionRiskRows");
    expect(systemMapSource).toContain("interactionAnalysisHint");
    expect(systemMapSource).toContain("sop pages interaction-analysis");
  });

  it("keeps interaction labels localized in all supported locales", () => {
    const zh = JSON.parse(zhSource);
    const en = JSON.parse(enSource);
    const ja = JSON.parse(jaSource);

    expect(zh.page.systemMap.interactionAnalysis).toBe("全域交互分析");
    expect(en.page.systemMap.interactionScore).toBe("Interaction score");
    expect(ja.page.systemMap.interactionNoRisk).toBe("インタラクションリスクはありません");
  });
});
