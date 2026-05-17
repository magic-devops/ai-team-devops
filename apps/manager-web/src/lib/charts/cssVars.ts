/** 从 CSS 变量读取主题色，供 ECharts / G6 与 Tailwind 主题一致 */
export function readCssVar(name: string, fallback = "#64748b"): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function chartPalette(): string[] {
  return [
    readCssVar("--brand", "#2563eb"),
    readCssVar("--chart-2", "#0ea5e9"),
    readCssVar("--chart-3", "#22c55e"),
    readCssVar("--chart-4", "#f59e0b"),
    readCssVar("--chart-5", "#a855f7"),
    readCssVar("--chart-6", "#ef4444"),
  ];
}
