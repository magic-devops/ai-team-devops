import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { chartPalette, readCssVar } from "../../lib/charts/cssVars";
import { EChartsPanel } from "./EChartsPanel";

export type BarSeries = { name: string; data: number[] };

/** 柱状/折线混合图：用于活动趋势或多序列对比 */
export function EChartsBar({
  categories,
  series,
  height = 240,
  stacked = false,
  asLine = false,
  onFailed,
}: {
  categories: string[];
  series: BarSeries[];
  height?: number;
  stacked?: boolean;
  asLine?: boolean;
  onFailed?: () => void;
}) {
  const option = useMemo(() => {
    if (!categories.length || !series.length) return null;
    const muted = readCssVar("--muted", "#94a3b8");
    return {
      color: chartPalette(),
      tooltip: { trigger: "axis" },
      legend: {
        bottom: 0,
        textStyle: { color: readCssVar("--muted-strong"), fontSize: 11 },
      },
      grid: { left: 48, right: 16, top: 24, bottom: 48 },
      xAxis: {
        type: "category",
        data: categories,
        axisLine: { lineStyle: { color: muted } },
        axisLabel: { fontSize: 10, rotate: categories.length > 8 ? 30 : 0 },
      },
      yAxis: {
        type: "value",
        axisLine: { lineStyle: { color: muted } },
        splitLine: { lineStyle: { color: readCssVar("--border", "#e2e8f0") } },
      },
      series: series.map((s) => ({
        name: s.name,
        type: asLine ? "line" : "bar",
        stack: stacked && !asLine ? "total" : undefined,
        smooth: asLine,
        showSymbol: asLine,
        emphasis: { focus: "series" },
        data: s.data,
      })),
    } as EChartsOption;
  }, [categories, series, stacked, asLine]);

  if (!option) return null;
  return <EChartsPanel option={option} height={height} onFailed={onFailed} />;
}
