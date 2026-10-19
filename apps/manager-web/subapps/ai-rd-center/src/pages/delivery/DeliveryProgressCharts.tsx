import { useCallback, useMemo, useState } from "react";
import { Alert, Empty } from "antd";
import type { EChartsOption } from "echarts";
import { useTranslation } from "react-i18next";
import { EChartsPanel } from "@/components/charts/EChartsPanel";
import { chartPalette, readCssVar } from "@/lib/charts/cssVars";
import {
  progressSeries,
  progressStates,
  type ProgressSeries,
} from "@/lib/deliveryProgress";
type DeliveryProgress = Pick<ProgressSeries, "days" | "ideal"> & {
  baseline: { id: string } | null;
};

export function progressChartOptions(
  data: DeliveryProgress,
  tr: (key: string) => string,
): { burndown: EChartsOption; flow: EChartsOption } {
  const points = progressSeries(data.days);
  const colors = chartPalette();
  const muted = readCssVar("--muted");
  // Use the chart runtime's empty-value marker; the API and shared series retain null.
  const chartData = (values: (number | null)[]) =>
    values.map((value) => value ?? "-");
  const common: EChartsOption = {
    animation: false,
    tooltip: {
      trigger: "axis",
      renderMode: "richText",
      confine: true,
      formatter: (params: unknown) => {
        const rows = (Array.isArray(params) ? params : [params]) as {
          axisValue?: string;
          seriesName?: string;
          value?: unknown;
        }[];
        return [
          `${rows[0]?.axisValue || ""} UTC`,
          ...rows
            .filter((row) => row.value != null && row.value !== "-")
            .map((row) => `${row.seriesName}: ${row.value} ${tr("tasks")}`),
        ].join("\n");
      },
    },
    grid: { left: 42, right: 16, top: 36, bottom: 64 },
    legend: {
      bottom: 0,
      type: "scroll",
      textStyle: { color: readCssVar("--muted-strong") },
      itemWidth: 12,
      itemHeight: 8,
    },
    xAxis: {
      type: "category",
      data: points.dates,
      boundaryGap: false,
      axisLabel: {
        formatter: (value: string | number) => String(value).slice(5),
        color: muted,
      },
      axisLine: { lineStyle: { color: readCssVar("--border") } },
    },
    yAxis: {
      type: "value",
      min: 0,
      minInterval: 1,
      name: tr("taskCount"),
      nameTextStyle: { color: muted },
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: readCssVar("--border") } },
    },
  };
  const idealByDate = new Map(
    data.ideal.map((point) => [point.date, point.remaining]),
  );
  return {
    burndown: {
      ...common,
      color: [colors[0]!, colors[4]!, muted],
      series: [
        {
          name: tr("actual"),
          type: "line",
          data: chartData(points.remaining),
          connectNulls: false,
          smooth: false,
          symbolSize: 6,
          lineStyle: { width: 2 },
        },
        ...(data.baseline
          ? [
              {
                name: tr("baselineRemaining"),
                type: "line" as const,
                data: chartData(points.baselineRemaining),
                connectNulls: false,
                smooth: false,
                symbolSize: 5,
                lineStyle: { width: 2 },
              },
            ]
          : []),
        ...(data.ideal.length
          ? [
              {
                name: tr("ideal"),
                type: "line" as const,
                data: chartData(
                  points.dates.map((date) => idealByDate.get(date) ?? null),
                ),
                connectNulls: false,
                smooth: false,
                symbol: "none",
                lineStyle: { width: 1, type: "dashed" as const },
              },
            ]
          : []),
      ],
    },
    flow: {
      ...common,
      color: [
        colors[2]!,
        colors[3]!,
        colors[4]!,
        colors[5]!,
        colors[0]!,
        muted,
      ],
      series: [...progressStates].reverse().map((state) => ({
        name: tr(`states.${state}`),
        type: "line",
        stack: "tasks",
        data: chartData(points.states[state]),
        connectNulls: false,
        smooth: false,
        symbolSize: 4,
        areaStyle: { opacity: 0.7 },
        lineStyle: { width: 1 },
      })),
    },
  };
}
export function DeliveryProgressCharts({
  data,
  onOpen,
}: {
  data: DeliveryProgress;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const options = useMemo(
    () => progressChartOptions(data, (key) => t(`deliveryProgress.${key}`)),
    [data, t],
  );
  const onFailed = useCallback(() => setFailed(true), []);
  const onPointClick = useCallback(
    (index: number) => {
      const id = data.days[index]?.observation_id;
      if (id) onOpen(id);
    },
    [data.days, onOpen],
  );
  return (
    <>
      {failed && (
        <Alert
          type="info"
          showIcon
          title={t("deliveryProgress.chartUnavailable")}
        />
      )}
      <div className="delivery-progress-chart-grid">
        {(["burndown", "flow"] as const).map((kind) => (
          <section
            key={kind}
            className="delivery-panel delivery-progress-chart"
          >
            <h2>{t(`deliveryProgress.${kind}`)}</h2>
            <p className="delivery-hint">
              {t(
                `deliveryProgress.${kind === "flow" ? "flowHint" : "completionHint"}`,
              )}
            </p>
            {data.days.some((day) => day.metrics) ? (
              <EChartsPanel
                option={options[kind]}
                height={264}
                onFailed={onFailed}
                onPointClick={onPointClick}
                ariaLabel={t(`deliveryProgress.${kind}`)}
              />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("deliveryProgress.noHistory")}
              />
            )}
            {kind === "burndown" && !data.ideal.length && (
              <small className="delivery-hint">
                {t("deliveryProgress.noDate")}
              </small>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
