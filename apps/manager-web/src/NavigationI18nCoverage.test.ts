import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
const navItemKeys = Array.from(navigationSource.matchAll(/^\s*\{ key: "([^"]+)", path:/gm)).map((match) => match[1]);

describe("navigation i18n coverage", () => {
  for (const locale of ["zh-CN", "en-US", "ja-JP"] as const) {
    it(`translates every registered navigation item in ${locale}`, () => {
      const messages = JSON.parse(readFileSync(resolve(root, `src/i18n/${locale}.json`), "utf8"));
      const missing = navItemKeys.filter((key) => !messages.nav?.[key]);
      expect(missing).toEqual([]);
    });
  }

  it("keeps Menu Management page chrome localized", () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP"] as const) {
      const messages = JSON.parse(readFileSync(resolve(root, `src/i18n/${locale}.json`), "utf8"));
      expect(messages.nav.menuManagement).toBeTruthy();
      expect(messages.page.menuManagement.title).toBeTruthy();
      expect(messages.page.menuManagement.searchPlaceholder).toBeTruthy();
      expect(messages.page.menuManagement.backendStatus).toBeTruthy();
    }
  });
});
