import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../../../../src/i18n/en-US.json";
import ja from "../../../../../src/i18n/ja-JP.json";
import zh from "../../../../../src/i18n/zh-CN.json";

const source = readFileSync(new URL("./AnalyticsNlqWorkbench.tsx", import.meta.url), "utf8");

describe("AnalyticsNlqWorkbench", () => {
  it("renders NLQ engine metadata, fallback reason and metric cards", () => {
    expect(source).toContain("nlqEngineLabel");
    expect(source).toContain("nlqFallbackReason");
    expect(source).toContain("nlqProviderErrors");
    expect(source).toContain("nlqMetricCards");
    expect(source).toContain("provider_errors");
  });

  it("keeps NLQ fallback copy localized", () => {
    for (const locale of [zh, en, ja]) {
      expect(locale.page.analytics.nlqEngineLabel).toBeTruthy();
      expect(locale.page.analytics.nlqEngines.rules).toBeTruthy();
      expect(locale.page.analytics.nlqFallback.llm_gateway_unavailable).toBeTruthy();
      expect(locale.page.analytics.nlqFallback.llm_provider_failed).toBeTruthy();
      expect(locale.page.analytics.nlqMetricCards).toBeTruthy();
    }
  });
});
