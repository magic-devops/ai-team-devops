import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enUS from "../i18n/en-US.json";
import jaJP from "../i18n/ja-JP.json";
import zhCN from "../i18n/zh-CN.json";
import { ProductRequirementsShell } from "../../subapps/ai-rd-center/src/pages/product/ProductRequirementsShell";

const translation = vi.hoisted(() => ({
  t: (key: string, _options?: Record<string, unknown>) => key,
  i18n: { language: "zh-CN", resolvedLanguage: "zh-CN" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => translation,
}));

const phases = ["pool", "review", "generation", "batch"] as const;

function render(phase: (typeof phases)[number], completionRate = 90) {
  return renderToStaticMarkup(
    createElement(ProductRequirementsShell, {
      phase,
      total: 10,
      ready: 7,
      completed: 9,
      completionRate,
      children: createElement("button", { type: "button" }, "Actual phase action"),
    }),
  );
}

function navigationLinks(html: string) {
  const nav = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
  return [...nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    attributes: match[1],
    content: match[2],
  }));
}

describe("requirement workbench factual stage navigation", () => {
  beforeEach(() => {
    translation.t = (key: string) => key;
    translation.i18n.language = "zh-CN";
    translation.i18n.resolvedLanguage = "zh-CN";
  });

  it.each(phases)("marks only the selected %s route as current", (phase) => {
    const links = navigationLinks(render(phase));
    expect(links).toHaveLength(4);
    expect(links.map((link) => link.attributes.match(/href="([^"]+)"/)?.[1]))
      .toEqual(phases.map((key) => `#/requirements/${key}`));
    const current = links.filter((link) => link.attributes.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0].attributes).toContain(`href="#/requirements/${phase}"`);
    expect(current[0].content).toContain(`page.requirements.mode.${phase}.title`);
    expect(render(phase)).toContain(`page.requirements.mode.${phase}.hint`);
    expect(render(phase)).toContain("Actual phase action");
  });

  it.each([29, 30, 90, 100])(
    "does not claim generation or batch completion from aggregate completion %s",
    (completionRate) => {
      const html = render("review", completionRate);
      const links = navigationLinks(html);
      expect(links).toHaveLength(4);
      // Nine completed requirements are not evidence of these navigation stages completing.
      for (const link of links) {
        expect(link.content).not.toContain("lucide-circle-check");
        expect(link.content).not.toContain("text-emerald");
        expect(link.attributes).not.toContain('aria-disabled="true"');
      }
      expect(html).toContain("page.requirements.hubReady");
      expect(html).toContain("page.requirements.kit.recordedCompleted");
      expect(html).toContain("page.requirements.kit.recordedCompletionRate");
      const facts = html.match(/<dl\b[^>]*>[\s\S]*?<\/dl>/)?.[0] ?? "";
      expect(facts).toContain(">10</dd>");
      expect(facts).toContain(">7 / 10</dd>");
      expect(facts).toContain(">9</dd>");
      expect(facts).toContain(`>${completionRate}%</dd>`);
    },
  );

  it("keeps all phase routes available for an empty pool without implying any completion", () => {
    const html = renderToStaticMarkup(
      createElement(ProductRequirementsShell, {
        phase: "pool", total: 0, ready: 0, completed: 0, completionRate: 0,
        children: createElement("button", { type: "button" }, "Capture requirement"),
      }),
    );
    expect(navigationLinks(html)).toHaveLength(4);
    expect(html).toContain("Capture requirement");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("lucide-circle-check");
  });

  it.each([
    ["initial load", { total: 0, ready: 0, completed: 0, completionRate: 0 }],
    ["failed read with stale aggregates", { total: 10, ready: 7, completed: 9, completionRate: 90 }],
  ] as const)("marks every unavailable fact unknown during %s", (_state, facts) => {
    const html = renderToStaticMarkup(createElement(ProductRequirementsShell, {
      phase: "generation", ...facts, factsReady: false,
      children: createElement("button", { type: "button" }, "Actual phase action"),
    }));
    const values = html.match(/<dl\b[^>]*>[\s\S]*?<\/dl>/)?.[0] ?? "";
    expect([...values.matchAll(/>—<\/dd>/g)]).toHaveLength(4);
    expect(values).not.toContain(">0</dd>");
    expect(values).not.toContain(">10</dd>");
    expect(values).not.toContain(">7 / 10</dd>");
    expect(values).not.toContain(">9</dd>");
    expect(values).not.toContain(">90%</dd>");
    expect(navigationLinks(html)).toHaveLength(4);
    expect(html).toContain("Actual phase action");
  });

  it.each([
    ["zh-CN", "需求治理工作台", "需求总数", "含验收标准", "登记完成", "登记完成率"],
    ["en-US", "Requirements workbench", "Total requirements", "With acceptance criteria", "Marked completed", "Marked completion rate"],
    ["ja-JP", "要件ワークベンチ", "要件数", "受け入れ条件あり", "完了に設定", "完了設定率"],
  ])("renders local labels for %s without falling back to Chinese", async (locale, ...labels) => {
    const instance = createInstance();
    await instance.init({
      lng: locale,
      fallbackLng: "zh-CN",
      interpolation: { escapeValue: false },
      resources: {
        "zh-CN": { translation: zhCN },
        "en-US": { translation: enUS },
        "ja-JP": { translation: jaJP },
      },
    });
    translation.t = (key, options) => String(instance.t(key, options));
    translation.i18n.language = locale;
    translation.i18n.resolvedLanguage = locale;
    const html = render("generation");
    for (const label of labels) expect(html).toContain(label);
    const facts = html.match(/<dl\b[^>]*>[\s\S]*?<\/dl>/)?.[0] ?? "";
    if (locale !== "zh-CN") {
      expect(facts).not.toContain("需求总数");
      expect(facts).not.toContain("含验收标准");
      expect(facts).not.toContain("完成率");
    }
    expect(navigationLinks(html).filter((link) => link.attributes.includes('aria-current="page"')))
      .toHaveLength(1);
  });
});
