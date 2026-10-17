import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { describe, expect, it, vi } from "vitest";
import { DeliveryActivityAction } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryActivityAction";
import { deliveryTranslations } from "../i18n/delivery";
import { projectInboxTranslations } from "../i18n/delivery-project-inbox";
const i18n = createInstance();
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (...args: Parameters<typeof i18n.t>) => i18n.t(...args),
  }),
}));

describe("progress activity labels", () => {
  it.each([
    ["zh-CN", "冻结计划基线", "记录当前进度"],
    ["en-US", "Froze plan baseline", "Recorded current progress"],
    ["ja-JP", "計画基準を凍結", "現在の進捗を記録"],
  ] as const)(
    "renders both real activity actions in %s without exposing command IDs",
    async (language, baseline, record) => {
      await i18n.init({
        lng: language,
        initImmediate: false,
        resources: {
          [language]: {
            translation: {
              delivery: deliveryTranslations[language],
              deliveryProject: projectInboxTranslations[language],
            },
          },
        },
      });
      expect(
        renderToStaticMarkup(
          createElement(DeliveryActivityAction, { action: "baseline.create" }),
        ),
      ).toBe(`<strong>${baseline}</strong>`);
      expect(
        renderToStaticMarkup(
          createElement(DeliveryActivityAction, { action: "progress.record" }),
        ),
      ).toBe(`<strong>${record}</strong>`);
    },
  );
});
