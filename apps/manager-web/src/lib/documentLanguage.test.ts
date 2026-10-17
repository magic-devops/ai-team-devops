import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("document reading language", () => {
  it("keeps the document language aligned with actual i18next language changes", async () => {
    const root = { lang: "en" };
    vi.stubGlobal("document", { documentElement: root });
    const { default: i18n } = await import("../i18n");
    for (const language of ["zh-CN", "en-US", "ja-JP", "zh-CN"]) {
      await i18n.changeLanguage(language);
      expect(root.lang).toBe(language);
    }
  });
});
