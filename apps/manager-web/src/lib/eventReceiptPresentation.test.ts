import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { eventReceiptTranslations } from "../i18n/event-receipts";
const root = resolve(import.meta.dirname, "../..");
describe("event receipt presentation contracts", () => {
  it("inherits only real palette tokens and stacks controls at 680px", () => {
    const css = readFileSync(
      resolve(
        root,
        "subapps/ai-foundation/src/pages/intelligence/events/event-receipts.css",
      ),
      "utf8",
    );
    const base = readFileSync(resolve(root, "src/index.css"), "utf8");
    const defined = new Set(
      [...base.matchAll(/(--[a-z-]+)\s*:/g)].map((match) => match[1]),
    );
    for (const match of css.matchAll(/var\((--[a-z-]+)/g))
      expect(defined.has(match[1]), match[1]).toBe(true);
    expect(css).toMatch(/@media\s*\(max-width:\s*680px\)/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/flex-direction:\s*column/);
  });
  it.each(["zh-CN", "en-US", "ja-JP"] as const)(
    "registers every receipt state and recovery string in %s",
    (language) => {
      expect(Object.keys(eventReceiptTranslations[language]).sort()).toEqual(
        Object.keys(eventReceiptTranslations["zh-CN"]).sort(),
      );
      for (const key of Object.keys(eventReceiptTranslations[language]))
        expect(i18n.getFixedT(language)("eventReceipts." + key)).not.toBe(
          "eventReceipts." + key,
        );
    },
  );
  it("replaces only the existing event tab and keeps the former event JSON cache query out of the page", () => {
    const source = readFileSync(
      resolve(root, "subapps/ai-foundation/src/pages/Intelligence.tsx"),
      "utf8",
    );
    expect(source).toContain("<EventReceiptWorkbench");
    expect(source).not.toContain('queryKey: ["events"]');
    for (const name of [
      "kb",
      "rag",
      "mem",
      "rules",
      "worker",
      "sync",
      "db",
      "usage",
    ])
      expect(source).toContain('tab === "' + name + '"');
  });
});
