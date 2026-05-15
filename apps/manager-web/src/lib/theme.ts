/** 与 index.html 内联脚本共用键名，勿改。 */
export const THEME_STORAGE_KEY = "sop-ui-theme";

export type ThemePreference = "system" | "light" | "dark" | "ocean" | "sage" | "graphite";

export const THEME_OPTIONS: ThemePreference[] = ["system", "light", "dark", "ocean", "sage", "graphite"];

function parseStored(raw: string | null): ThemePreference {
  if (raw && (THEME_OPTIONS as string[]).includes(raw)) return raw as ThemePreference;
  return "system";
}

export function getThemePreference(): ThemePreference {
  try {
    return parseStored(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 当前是否应用暗色样式（含 system 解析结果）。 */
export function isDarkResolved(pref: ThemePreference): boolean {
  if (pref === "dark" || pref === "graphite") return true;
  if (pref === "light" || pref === "ocean" || pref === "sage") return false;
  return systemPrefersDark();
}

function paletteFor(pref: ThemePreference, dark: boolean): string {
  if (pref === "system") return dark ? "graphite" : "light";
  if (pref === "dark") return "graphite";
  return pref;
}

export function applyResolvedTheme(pref: ThemePreference): void {
  const dark = isDarkResolved(pref);
  const palette = paletteFor(pref, dark);
  document.documentElement.classList.toggle("dark", dark);
  document.body?.classList.toggle("dark", dark);
  document.documentElement.dataset.themePref = pref;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePalette = palette;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
  applyResolvedTheme(pref);
  window.dispatchEvent(new CustomEvent("sop-theme"));
}

/** 首屏前调用；system 时监听系统配色变化。 */
export function initTheme(): void {
  applyResolvedTheme(getThemePreference());
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => {
    if (getThemePreference() === "system") applyResolvedTheme("system");
  };
  mq.addEventListener("change", onMedia);
}
