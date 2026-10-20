import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Suspense, lazy, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { ProjectContextGate, ProjectScopeNotice } from "@/components/ProjectContextGate";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("@/components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);
const EChartsBarLazy = lazy(() =>
  import("@/components/charts/EChartsBar").then((m) => ({ default: m.EChartsBar })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function AnalyticsOverviewWorkbench() {
  return (
    <ProjectContextGate requireSelection>
      <ProjectAnalyticsOverview />
    </ProjectContextGate>
  );
}

function ProjectAnalyticsOverview() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const [showRaw, setShowRaw] = useState(false);

  const overview = useQuery({
    queryKey: ["analyticsOverview"],
    queryFn: api.analyticsOverview,
    enabled: authed,
  });
  const charts = useQuery({
    queryKey: ["analyticsCharts"],
    queryFn: api.analyticsCharts,
    enabled: authed,
  });

  const metrics = overview.data?.metrics ?? {};

  const saveReport = useMutation({
    mutationFn: () =>
      api.analyticsCreateReport({
        title: t("page.analytics.defaultReportTitle"),
        metrics_snapshot: metrics,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["analyticsReports"] });
      void qc.invalidateQueries({ queryKey: ["analyticsReportsSummary"] });
    },
  });

  const activitySeries = useMemo(() => {
    const trend = charts.data?.activity_trend;
    if (!trend?.days?.length) return null;
    return {
      categories: trend.days,
      series: (trend.series ?? []).map((s) => ({
        name: s.name === "tasks" ? t("page.analytics.tasks") : t("page.analytics.requirements"),
        data: s.data,
      })),
    };
  }, [charts.data, t]);

  if (!authed) return <NeedLogin />;
  const deniedSave = saveReport.isError && /\bHTTP (?:401|403|404)\b/.test(saveReport.error?.message ?? "");
  const error = overview.isError ? overview.error : charts.isError ? charts.error : deniedSave ? saveReport.error : null;
  if (error) {
    return (
      <ProjectScopeNotice
        message={error.message}
        onRetry={() => {
          saveReport.reset();
          void overview.refetch();
          void charts.refetch();
        }}
      />
    );
  }
  if (overview.isLoading || charts.isLoading) return <LoadingBlock />;

  return (
    <WorkbenchShell
      title={t("page.analytics.overview")}
      description={t("page.analytics.overviewDesc")}
      actions={
        <>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
            disabled={saveReport.isPending}
            onClick={() => saveReport.mutate()}
          >
            <Save className="h-4 w-4" />
            {t("page.analytics.saveSnapshot")}
          </button>
          <RefreshButton
            onClick={() => {
              void overview.refetch();
              void charts.refetch();
            }}
            pending={overview.isFetching || charts.isFetching}
          />
        </>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.analytics.tasks"), value: metrics.tasks_total ?? 0 },
            { label: t("page.analytics.requirements"), value: metrics.requirements_total ?? 0 },
            { label: t("page.analytics.issues"), value: metrics.issues_total ?? 0 },
            { label: t("page.analytics.reflections"), value: metrics.agent_reflections_sampled ?? 0 },
          ]}
        />
      }
    >
      {saveReport.isError ? <ErrorBlock message={saveReport.error.message} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <WorkbenchPanel title={t("page.analytics.taskStatusChart")}>
          <Suspense fallback={<LoadingBlock />}>
            <EChartsDonutLazy title={t("page.analytics.tasks")} data={pieToRecord(charts.data?.task_status)} height={220} />
          </Suspense>
        </WorkbenchPanel>
        <WorkbenchPanel title={t("page.analytics.issuePriorityChart")}>
          <Suspense fallback={<LoadingBlock />}>
            <EChartsDonutLazy title={t("page.analytics.issues")} data={pieToRecord(charts.data?.issue_priority)} height={220} />
          </Suspense>
        </WorkbenchPanel>
        {activitySeries ? (
          <WorkbenchPanel title={t("page.analytics.activityTrend")} className="lg:col-span-2">
            <Suspense fallback={<LoadingBlock />}>
              <EChartsBarLazy categories={activitySeries.categories} series={activitySeries.series} asLine height={240} />
            </Suspense>
          </WorkbenchPanel>
        ) : null}
      </div>

      <div className="mt-4">
        <button
          type="button"
          className="text-xs text-brand-600 underline dark:text-brand-400"
          onClick={() => setShowRaw((v) => !v)}
        >
          {showRaw ? t("page.analytics.hideRaw") : t("page.analytics.showRaw")}
        </button>
        {showRaw ? (
          <pre className="mt-2 overflow-auto rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">
            {JSON.stringify(metrics, null, 2)}
          </pre>
        ) : null}
      </div>
    </WorkbenchShell>
  );
}
