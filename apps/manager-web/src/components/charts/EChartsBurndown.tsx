import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { EChartsOption } from "echarts";
import { chartPalette, readCssVar } from "../../lib/charts/cssVars";
import type { BurndownData } from "../../pages/shared/SprintBurndownChart";
import { EChartsPanel } from "./EChartsPanel";
import { burndownChartObservations } from "../../lib/burndownHistory";

export function EChartsBurndown({
  data,
  height = 260,
  onFailed,
}: {
  data?: BurndownData | null;
  height?: number;
  onFailed?: () => void;
}) {
  const { t } = useTranslation();
  const option = useMemo<EChartsOption | null>(() => {
    if (!data?.ideal?.length) return null;
    const ideal = data.ideal.map((p) => [p.day, p.remaining]);
    const actual = burndownChartObservations(data.actual);
    const muted = readCssVar("--muted", "#94a3b8");
    const brand = chartPalette()[0]!;

    return {
      color: [muted, brand],
      tooltip: { trigger: "axis" },
      legend: {
        data: [t("page.charts.burndownIdeal"), t("page.charts.burndownActual")],
        bottom: 0,
        textStyle: { color: readCssVar("--muted-strong") },
      },
      grid: { left: 48, right: 16, top: 24, bottom: 48 },
      xAxis: {
        type: "value",
        min: 0,
        max: Math.max(
          1,
          ...data.ideal.map((p) => p.day),
          ...data.actual.map((p) => p.day),
        ),
        minInterval: 1,
        name: t("page.devFlow.burndownDay"),
        axisLine: { lineStyle: { color: muted } },
      },
      yAxis: {
        type: "value",
        name: t("page.devFlow.burndownRemaining"),
        axisLine: { lineStyle: { color: muted } },
        splitLine: { lineStyle: { color: readCssVar("--border", "#e2e8f0") } },
      },
      series: [
        {
          name: t("page.charts.burndownIdeal"),
          type: "line",
          smooth: false,
          showSymbol: false,
          lineStyle: { type: "dashed", width: 2 },
          data: ideal,
        },
        {
          name: t("page.charts.burndownActual"),
          type: "line",
          smooth: false,
          connectNulls: false,
          symbolSize: 8,
          data: actual,
        },
      ],
    };
  }, [data, t]);

  if (!option) return null;
  return <EChartsPanel option={option} height={height} onFailed={onFailed} />;
}
