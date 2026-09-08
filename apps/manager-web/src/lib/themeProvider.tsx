import { App as AntdApp, ConfigProvider, theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";
import type { PropsWithChildren, ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { getThemePreference, isDarkResolved, type ThemePreference } from "./theme";

type ThemeSnapshot = {
  preference: ThemePreference;
  resolvedDark: boolean;
};

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function readThemeSnapshot(): ThemeSnapshot {
  const preference = getThemePreference();
  return {
    preference,
    resolvedDark: isDarkResolved(preference),
  };
}

export function resolvedAntdTheme(pref: ThemePreference): ThemeConfig {
  const dark = isDarkResolved(pref);
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      borderRadius: 8,
      colorBgBase: cssVar("--app-bg", dark ? "#070b14" : "#f5f7fb"),
      colorBgContainer: cssVar("--surface", dark ? "#121b2a" : "#ffffff"),
      colorBgElevated: cssVar("--surface-raised", dark ? "#182135" : "#ffffff"),
      colorBorder: cssVar("--border", dark ? "rgba(122,139,163,0.28)" : "#d9e1ec"),
      colorInfo: dark ? "#60a5fa" : "#2563eb",
      colorPrimary: cssVar("--brand", dark ? "#38bdf8" : "#0f766e"),
      colorText: cssVar("--text", dark ? "#eef4fb" : "#172033"),
      colorTextSecondary: cssVar("--muted-strong", dark ? "#c1cad7" : "#46556b"),
      colorTextTertiary: cssVar("--muted", dark ? "#9aa8ba" : "#637188"),
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
    components: {
      Button: { controlHeight: 36 },
      Card: {
        colorBgContainer: cssVar("--surface-raised", dark ? "#182135" : "#ffffff"),
        colorBorderSecondary: cssVar("--border", dark ? "rgba(122,139,163,0.28)" : "#d9e1ec"),
      },
      Input: { controlHeight: 36 },
      Select: { controlHeight: 36 },
      Table: {
        cellPaddingBlock: 10,
        colorBgContainer: cssVar("--surface", dark ? "#0e1521" : "#ffffff"),
        headerBg: cssVar("--surface-muted", dark ? "#192437" : "#f7f9fc"),
        headerColor: cssVar("--muted-strong", dark ? "#c1cad7" : "#526176"),
        rowHoverBg: cssVar("--brand-softer", dark ? "rgba(56,189,248,0.09)" : "rgba(15,118,110,0.07)"),
      },
    },
  };
}

export function SopThemeProvider({ children }: PropsWithChildren): ReactElement {
  const [themeSnapshot, setThemeSnapshot] = useState(readThemeSnapshot);

  useEffect(() => {
    const update = () => setThemeSnapshot(readThemeSnapshot());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("sop-theme", update);
    media.addEventListener("change", update);
    return () => {
      window.removeEventListener("sop-theme", update);
      media.removeEventListener("change", update);
    };
  }, []);

  const theme = useMemo(
    () => resolvedAntdTheme(themeSnapshot.preference),
    [themeSnapshot.preference, themeSnapshot.resolvedDark],
  );

  return (
    <ConfigProvider theme={theme}>
      <AntdApp message={{ maxCount: 3 }}>{children}</AntdApp>
    </ConfigProvider>
  );
}
