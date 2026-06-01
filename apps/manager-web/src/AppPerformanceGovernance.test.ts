import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

describe("app shell performance governance", () => {
  const appSource = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  const commandPaletteSource = readFileSync(resolve(root, "src/components/CommandPalette.tsx"), "utf8");
  const systemMapSource = readFileSync(resolve(root, "subapps/ai-ops-center/src/pages/SystemMap.tsx"), "utf8");
  const zh = JSON.parse(readFileSync(resolve(root, "src/i18n/zh-CN.json"), "utf8"));

  it("loads the global AI command palette only when opened", () => {
    expect(appSource).toContain("CommandPaletteLazy");
    expect(appSource).toContain('lazy(() => import("./components/CommandPalette")');
    expect(appSource).toContain("commandOpen ? (");
    expect(appSource).toContain("<Suspense fallback={null}>");
    expect(commandPaletteSource).toContain("export function CommandPalette");
    expect(commandPaletteSource).toContain("api.copilotCommands");
    expect(commandPaletteSource).toContain("api.workspaceSearch");
  });

  it("shows build chunk load scope so first-screen and deferred risks are not mixed", () => {
    expect(systemMapSource).toContain("performanceInitialOversize");
    expect(systemMapSource).toContain("performanceDeferredOversize");
    expect(systemMapSource).toContain("performanceLoadScope");
    expect(systemMapSource).toContain("performanceLoadScopeValue");
    expect(zh.page.systemMap.performanceLoadScopeValue.initial).toBe("首屏");
    expect(zh.page.systemMap.performanceLoadScopeValue["deferred-visualization"]).toBe("延迟图谱");
  });
});
