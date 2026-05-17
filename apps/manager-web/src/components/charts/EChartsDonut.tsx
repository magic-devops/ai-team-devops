import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { chartPalette, readCssVar } from "../../lib/charts/cssVars";
import { EChartsPanel } from "./EChartsPanel";

export function EChartsDonut({
  title,
  data,
  height = 220,
  onFailed,
}: {
  title?: string;
  data?: Record<string, number>;
  height?: number;
  onFailed?: () => void;
}) {
  const option = useMemo<EChartsOption | null>(() => {
    const entries = Object.entries(data ?? {}).filter(([, v]) => v > 0);
    if (!entries.length) return null;
    const seriesData = entries.map(([name, value]) => ({ name, value }));
    return {
      color: chartPalette(),
      title: title
        ? {
            text: title,
            left: "center",
            top: 8,
            textStyle: { fontSize: 13, color: readCssVar("--text") },
          }
        : undefined,
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      legend: {
        orient: "vertical",
        right: 8,
        top: "middle",
        textStyle: { color: readCssVar("--muted-strong"), fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          radius: ["42%", "68%"],
          center: title ? ["38%", "55%"] : ["40%", "50%"],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: readCssVar("--surface", "#fff"), borderWidth: 2 },
          label: { show: false },
          emphasis: { label: { show: true, fontSize: 12, fontWeight: "bold" } },
          data: seriesData,
        },
      ],
    };
  }, [data, title]);

  if (!option) return null;
  return <EChartsPanel option={option} height={height} onFailed={onFailed} />;
}
