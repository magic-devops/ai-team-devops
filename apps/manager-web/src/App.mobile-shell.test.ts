import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("mobile console shell", () => {
  const appSource = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  const cssSource = readFileSync(resolve(root, "src/index.css"), "utf8");

  it("exposes a mobile drawer navigation surface", () => {
    expect(appSource).toContain('data-testid="mobile-nav-toggle"');
    expect(appSource).toContain('data-testid="mobile-nav-drawer"');
    expect(appSource).toContain('data-testid="mobile-nav-search"');
    expect(appSource).toContain('data-testid="mobile-nav-filtered-micro-apps"');
    expect(appSource).toContain("mobileNavOpen");
    expect(appSource).toContain("mobileNavKeyword");
    expect(appSource).toContain("mobileNavTerm");
  });

  it("exposes a mobile action bar for core intelligent workflows", () => {
    expect(appSource).toContain('data-testid="mobile-action-bar"');
    expect(appSource).toContain("mobileCoreActions");
    expect(appSource).toContain('#/copilot');
    expect(appSource).toContain('label: navLabel("copilot")');
    expect(appSource).toContain("#/notify/inbound");
  });

  it("defines compact responsive card/table rules for mobile workbenches", () => {
    expect(cssSource).toContain(".hermes-mobile-compact");
    expect(cssSource).toContain("[data-mobile-compact]");
    expect(cssSource).toContain(".ant-table");
  });
});
