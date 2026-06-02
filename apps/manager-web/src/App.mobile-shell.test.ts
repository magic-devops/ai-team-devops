import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("mobile console shell", () => {
  const appSource = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  const mobileNavDrawerSource = readFileSync(resolve(root, "src/components/MobileNavDrawer.tsx"), "utf8");
  const cssSource = readFileSync(resolve(root, "src/index.css"), "utf8");

  it("exposes a mobile drawer navigation surface", () => {
    expect(appSource).toContain("MobileNavDrawerLazy");
    expect(appSource).toContain('lazy(() => import("./components/MobileNavDrawer")');
    expect(appSource).toContain('data-testid="mobile-nav-toggle"');
    expect(mobileNavDrawerSource).toContain('data-testid="mobile-nav-drawer"');
    expect(mobileNavDrawerSource).toContain('data-testid="mobile-nav-search"');
    expect(mobileNavDrawerSource).toContain('data-testid="mobile-nav-filtered-micro-apps"');
    expect(appSource).toContain("mobileNavOpen");
    expect(appSource).toContain("mobileNavKeyword");
    expect(mobileNavDrawerSource).toContain("const term = keyword.trim().toLowerCase()");
  });

  it("exposes a mobile action bar for core intelligent workflows", () => {
    expect(appSource).toContain('data-testid="mobile-action-bar"');
    expect(appSource).toContain("mobileCoreActions");
    expect(appSource).toContain('#/copilot');
    expect(appSource).toContain('label: navLabel("copilot")');
    expect(appSource).toContain("#/notify/inbound");
  });

  it("keeps menu display customization simple through presets", () => {
    expect(appSource).toContain("menuDisplayPresets");
    expect(appSource).toContain("优先使用预设，需要时再细调。");
    expect(appSource).toContain('key: "simple"');
    expect(appSource).toContain('key: "work"');
    expect(appSource).toContain('key: "full"');
    expect(appSource).toContain('patchMenuPrefs(preset.patch)');
  });

  it("defines compact responsive card/table rules for mobile workbenches", () => {
    expect(cssSource).toContain(".hermes-mobile-compact");
    expect(cssSource).toContain("[data-mobile-compact]");
    expect(cssSource).toContain(".ant-table");
  });
});
