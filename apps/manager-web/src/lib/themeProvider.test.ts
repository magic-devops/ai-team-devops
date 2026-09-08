import { describe, expect, it, vi } from "vitest";
import { theme as antdTheme } from "antd";
import { readThemeSnapshot, resolvedAntdTheme, SopThemeProvider } from "./themeProvider";

function withThemeEnvironment(dark: boolean, run: () => void): void {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousComputedStyle = globalThis.getComputedStyle;
  const computed = {
    getPropertyValue: (name: string) => ({
      "--app-bg": dark ? "#070b14" : "#f5f7fb",
      "--surface": dark ? "#0e1521" : "#ffffff",
      "--surface-raised": dark ? "#182135" : "#ffffff",
      "--surface-muted": dark ? "#192437" : "#f7f9fc",
      "--border": dark ? "rgba(122,139,163,0.28)" : "#d9e1ec",
      "--brand": dark ? "#38bdf8" : "#0f766e",
      "--text": dark ? "#eef4fb" : "#172033",
      "--muted": dark ? "#9aa8ba" : "#637188",
      "--muted-strong": dark ? "#c1cad7" : "#46556b",
      "--brand-softer": dark ? "rgba(56,189,248,0.09)" : "rgba(15,118,110,0.07)",
    })[name] ?? "",
  } as CSSStyleDeclaration;

  const matchMedia = vi.fn().mockReturnValue({
    matches: dark,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: {} },
  });
  globalThis.getComputedStyle = vi.fn().mockReturnValue(computed);
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    globalThis.getComputedStyle = previousComputedStyle;
  }
}

describe("SopThemeProvider", () => {
  it("maps light preferences to AntD default algorithm and CSS variable tokens", () => {
    withThemeEnvironment(false, () => {
      const config = resolvedAntdTheme("light");

      expect(config.algorithm).toBe(antdTheme.defaultAlgorithm);
      expect(config.token?.colorText).toBe("#172033");
      expect(config.token?.colorBgContainer).toBe("#ffffff");
      expect(config.components?.Table?.headerBg).toBe("#f7f9fc");
    });
  });

  it("maps dark and dark-resolved system preferences to AntD dark algorithm", () => {
    withThemeEnvironment(true, () => {
      const darkConfig = resolvedAntdTheme("dark");
      const systemConfig = resolvedAntdTheme("system");
      const snapshot = readThemeSnapshot();

      expect(darkConfig.algorithm).toBe(antdTheme.darkAlgorithm);
      expect(systemConfig.algorithm).toBe(antdTheme.darkAlgorithm);
      expect(snapshot).toEqual({ preference: "system", resolvedDark: true });
      expect(darkConfig.token?.colorText).toBe("#eef4fb");
      expect(darkConfig.token?.colorBgContainer).toBe("#0e1521");
      expect(darkConfig.components?.Table?.headerBg).toBe("#192437");
    });
  });

  it("subscribes to explicit sop-theme and system color-scheme changes", () => {
    const source = String(SopThemeProvider);

    expect(source).toContain('"sop-theme"');
    expect(source).toContain('"change"');
    expect(source).toContain("matchMedia");
    expect(source).toContain("readThemeSnapshot");
    expect(source).toContain("resolvedDark");
  });
});
