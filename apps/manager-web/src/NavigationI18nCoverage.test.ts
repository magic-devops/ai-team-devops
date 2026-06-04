import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
const commandPaletteSource = readFileSync(resolve(root, "src/components/CommandPalette.tsx"), "utf8");
const menuManagementSource = readFileSync(resolve(root, "src/pages/admin/MenuManagement.tsx"), "utf8");
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
      expect(messages.page.menuManagement.description).toBeTruthy();
      expect(messages.page.menuManagement.searchPlaceholder).toBeTruthy();
      expect(messages.page.menuManagement.backendStatus).toBeTruthy();
      expect(messages.page.menuManagement.issueError).toBeTruthy();
      expect(messages.page.menuManagement.issueWarning).toBeTruthy();
    }
    expect(commandPaletteSource).toContain("page.${item.key}.description");
    expect(menuManagementSource).toContain('t("page.menuManagement.issueError")');
    expect(menuManagementSource).toContain('t("page.menuManagement.issueWarning")');
    expect(navigationSource).not.toContain('key: "menuManagement", path: "#/admin/menu", el: pageElement(MenuManagementPage), group: "governance", icon: Rows3, category: "module-governance", capability: "governance.menu-management", badge: "new", description:');
  });
});
