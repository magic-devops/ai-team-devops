import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { deliveryDiscussionTranslations } from "../i18n/delivery-discussion";
const root = resolve(import.meta.dirname, "../..");
describe("discussion theme and language contracts", () => {
  it("uses only actual application color tokens so dark and named palettes are inherited", () => {
    const css = readFileSync(
      resolve(
        root,
        "subapps/ai-rd-center/src/pages/delivery/delivery-discussion.css",
      ),
      "utf8",
    );
    const theme = readFileSync(resolve(root, "src/index.css"), "utf8");
    const defined = new Set(
      [...theme.matchAll(/(--[a-z-]+)\s*:/g)].map((match) => match[1]),
    );
    const used = [...css.matchAll(/var\((--[a-z-]+)/g)].map(
      (match) => match[1],
    );
    expect(used.length).toBeGreaterThan(0);
    for (const token of used)
      expect(
        defined.has(token),
        `${token} must exist in the actual palette`,
      ).toBe(true);
    expect(css).toContain("var(--surface-raised)");
    expect(css).toContain("var(--border)");
  });
  it.each(["zh-CN", "en-US", "ja-JP"] as const)(
    "registers all recovery and source strings in %s",
    (language) => {
      expect(
        Object.keys(deliveryDiscussionTranslations[language]).sort(),
      ).toEqual(Object.keys(deliveryDiscussionTranslations["zh-CN"]).sort());
      for (const key of Object.keys(deliveryDiscussionTranslations[language]))
        expect(i18n.getFixedT(language)(`deliveryDiscussion.${key}`)).not.toBe(
          `deliveryDiscussion.${key}`,
        );
    },
  );
});
