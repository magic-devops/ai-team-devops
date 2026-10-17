import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";

const EChartsBurndownLazy = lazy(() =>
  import("../../components/charts/EChartsBurndown").then((m) => ({
    default: m.EChartsBurndown,
  })),
);

type Point = { day: number; remaining: number };

export type BurndownData = {
  ideal: Point[];
  actual: Point[];
  stats?: {
    total_tasks?: number;
    completed?: number;
    remaining?: number;
    completion_rate?: number;
  };
  span_days?: number;
  elapsed_days?: number;
  history_available?: boolean;
};

/** 燃尽图：默认 ECharts，失败时回退 SVG 轻量版 */
export function SprintBurndownChart({ data }: { data?: BurndownData | null }) {
  const { t } = useTranslation();
  const [lite, setLite] = useState(false);
  if (!data) return null;
  if (!data.ideal?.length)
    return (
      <p className="text-xs text-[var(--muted)]">
        {t("delivery.burndownDates")}
      </p>
    );

  if (!lite) {
    return (
      <>
        <p className="mb-3 text-xs text-[var(--muted)]">
          {data.history_available === false
            ? t("delivery.burndownSnapshot")
            : ""}
        </p>
        <Suspense fallback={<BurndownLite data={data} />}>
          <EChartsBurndownLazy data={data} onFailed={() => setLite(true)} />
        </Suspense>
      </>
    );
  }

  return <BurndownLite data={data} />;
}

function BurndownLite({ data }: { data: BurndownData }) {
  const { t } = useTranslation();

  const maxDay = Math.max(
    data.span_days ?? 0,
    ...data.ideal.map((p) => p.day),
    ...data.actual.map((p) => p.day),
    1,
  );
  const maxRem = Math.max(
    1,
    ...data.ideal.map((p) => p.remaining),
    ...data.actual.map((p) => p.remaining),
    Number(data.stats?.total_tasks ?? 0),
  );

  const toX = (day: number) => `${(day / maxDay) * 100}%`;
  const toY = (rem: number) => `${100 - (rem / maxRem) * 100}%`;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-strong)]">
        <span>{t("page.devFlow.burndownLegend")}</span>
        <span className="tabular-nums">
          {t("page.devFlow.burndownRemaining")}: {data.stats?.remaining ?? "—"}{" "}
          / {data.stats?.total_tasks ?? "—"}
        </span>
      </div>
      <div className="relative h-36 w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)]">
        <svg
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <polyline
            fill="none"
            stroke="var(--muted)"
            strokeWidth="0.6"
            strokeDasharray="2 2"
            points={data.ideal
              .map(
                (p) =>
                  `${(p.day / maxDay) * 100},${100 - (p.remaining / maxRem) * 100}`,
              )
              .join(" ")}
          />
          <polyline
            fill="none"
            stroke="var(--brand)"
            strokeWidth="1.2"
            points={data.actual
              .map(
                (p) =>
                  `${(p.day / maxDay) * 100},${100 - (p.remaining / maxRem) * 100}`,
              )
              .join(" ")}
          />
        </svg>
        {data.actual.map((p, i) => (
          <span
            key={`a-${i}`}
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--brand)]"
            style={{ left: toX(p.day), top: toY(p.remaining) }}
            title={`Day ${p.day}: ${p.remaining}`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-[var(--muted)]">
        <span>0</span>
        <span>
          {t("page.devFlow.burndownDay")} {data.elapsed_days ?? 0} /{" "}
          {data.span_days ?? maxDay}
        </span>
        <span>{maxDay}</span>
      </div>
    </div>
  );
}
