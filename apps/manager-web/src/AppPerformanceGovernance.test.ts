import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

describe("app shell performance governance", () => {
  const appSource = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  const commandPaletteSource = readFileSync(resolve(root, "src/components/CommandPalette.tsx"), "utf8");
  const mobileNavDrawerSource = readFileSync(resolve(root, "src/components/MobileNavDrawer.tsx"), "utf8");
  const projectSelectorSource = readFileSync(resolve(root, "src/components/ProjectSelector.tsx"), "utf8");
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const viteSource = readFileSync(resolve(root, "vite.config.ts"), "utf8");
  const zh = JSON.parse(readFileSync(resolve(root, "src/i18n/zh-CN.json"), "utf8"));

  it("loads the global AI command palette only when opened", () => {
    expect(appSource).not.toContain('from "./lib/api"');
    expect(appSource).toContain('from "./lib/appShellApi"');
    expect(projectSelectorSource).not.toContain('from "../lib/api"');
    expect(projectSelectorSource).toContain('from "../lib/appShellApi"');
    expect(commandPaletteSource).not.toContain('from "../lib/api"');
    expect(commandPaletteSource).toContain('from "../lib/appShellApi"');
    expect(appSource).toContain("CommandPaletteLazy");
    expect(appSource).toContain('lazy(() => import("./components/CommandPalette")');
    expect(appSource).toContain("commandOpen ? (");
    expect(appSource).toContain("<Suspense fallback={null}>");
    expect(commandPaletteSource).toContain("export function CommandPalette");
    expect(commandPaletteSource).toContain("appShellApi.copilotCommands");
    expect(commandPaletteSource).toContain("appShellApi.workspaceSearch");
  });

  it("loads the mobile navigation drawer only on small-screen demand", () => {
    expect(appSource).toContain("MobileNavDrawerLazy");
    expect(appSource).toContain('lazy(() => import("./components/MobileNavDrawer")');
    expect(appSource).toContain("mobileNavOpen ? (");
    expect(mobileNavDrawerSource).toContain("export function MobileNavDrawer");
    expect(mobileNavDrawerSource).toContain('data-testid="mobile-nav-filtered-micro-apps"');
    expect(mobileNavDrawerSource).toContain("onOpenCommand");
  });

  it("shows build chunk load scope so first-screen and deferred risks are not mixed", () => {
    expect(systemMapSource).toContain("performanceInitialOversize");
    expect(systemMapSource).toContain("performanceDeferredOversize");
    expect(systemMapSource).toContain("performanceLoadScope");
    expect(systemMapSource).toContain("performanceLoadScopeValue");
    expect(zh.page.systemMap.performanceLoadScopeValue.initial).toBe("首屏");
    expect(zh.page.systemMap.performanceLoadScopeValue["deferred-visualization"]).toBe("延迟图谱");
  });

  it("keeps the navigation registry outside the main application chunk", () => {
    expect(viteSource).toContain("navigation-registry");
    expect(viteSource).toContain("api-client");
    expect(viteSource).toContain("/src/navigation.tsx");
    expect(viteSource).toContain("/src/microApps.ts");
  });
});
