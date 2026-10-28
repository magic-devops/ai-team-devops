import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { reflectionTranslations } from "../i18n/reflections";
import { ReflectionDetail } from "../../subapps/ai-foundation/src/pages/intelligence/reflections/ReflectionDetail";
import { reflectionDetailFixture } from "./reflectionFixtures";
import { safeEventReturn } from "./eventReceipts";
import { safeReflectionReturn } from "./reflectionRoute";
import { projectSessionKey } from "./projectPortfolio";
afterEach(() => vi.unstubAllGlobals());
describe("reflection presentation and safe return", () => {
  it.each(["zh-CN", "en-US", "ja-JP"] as const)("renders actual exact statements as text in %s without raw JSON or false acceptance", async (language) => {
    await i18n.changeLanguage(language);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const detail = reflectionDetailFixture();
    detail.statement.title = "<script>claim</script>";
    const event = JSON.parse(detail.source.event_json); event.data.title = detail.statement.title;
    detail.source.event_json = JSON.stringify(event);
    detail.source.digest = createHash("sha256").update(detail.source.event_json, "utf8").digest("hex");
    detail.selection_reference.source_digest = detail.source.digest;
    client.setQueryData(["reflection-exact", "P", projectSessionKey(), "R"], detail);
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ReflectionDetail, { projectId: "P", reflectionId: "R", onAdopt: () => {}, canNavigate: () => true, onNavigate: () => {} })));
    expect(html).toContain("&lt;script&gt;claim&lt;/script&gt;");
    expect(html).toContain(reflectionTranslations[language].claimWarning);
    expect(html).not.toContain("reflections.");
    expect(html).not.toContain("specversion");
    expect(html).not.toContain("<script>");
    client.clear();
  });
  it("covers identical translation keys in all supported languages", () => {
    for (const lang of ["en-US", "ja-JP"] as const) {
      expect(Object.keys(reflectionTranslations[lang]).sort()).toEqual(Object.keys(reflectionTranslations["zh-CN"]).sort());
      for (const key of Object.keys(reflectionTranslations[lang])) expect(i18n.getFixedT(lang)("reflections." + key)).not.toBe("reflections." + key);
    }
  });
  it.each([
    "https://example.test", "#/intelligence/distill?project_id=P", "#/intelligence/reflections?project_id=Q", "#/intelligence/reflections?project_id=P&project_id=P", "#/intelligence/reflections?project_id=P&unknown=1", "#/intelligence/reflections?project_id=P&reflection_receipt=R%5Cpath", "#/intelligence/reflections?project_id=P&reflection_receipt=R%C2%85", "#/intelligence/reflections?project_id=P&event_return=loop", "#/intelligence/reflections?project_id=P&reflection_return=loop",
  ])("rejects unsafe or nested reflection return %s", (href) => {
    expect(safeReflectionReturn(href, "P")).toBeNull();
    expect(safeEventReturn("#/intelligence/events?project_id=P&reflection_return=" + encodeURIComponent(href), "P")).toBeNull();
  });
});
