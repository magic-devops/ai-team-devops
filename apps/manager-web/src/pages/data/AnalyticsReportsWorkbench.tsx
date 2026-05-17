import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiAssistButton, AiAssistDrawer } from "../../components/ai/AiAssistDrawer";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { Analytics } from "../Analytics";
import { api } from "../../lib/api";
import { getProjectId, getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("../../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function AnalyticsReportsWorkbench() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [aiOpen, setAiOpen] = useState(false);

  const summaryQ = useQuery({
    queryKey: ["analyticsReportsSummary"],
    queryFn: api.analyticsReportsSummary,
    enabled: authed && hasProject,
  });
  const chartsQ = useQuery({
    queryKey: ["analyticsReportsCharts"],
    queryFn: api.analyticsReportsCharts,
    enabled: authed && hasProject,
  });

  const summary = summaryQ.data?.summary ?? {};

  if (!authed) return <NeedLogin />;
  if (!hasProject) return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={t("page.analyticsReports.title")}
        description={t("page.analyticsReports.workbenchDesc")}
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton
              onClick={() => {
                void summaryQ.refetch();
                void chartsQ.refetch();
              }}
              pending={summaryQ.isFetching || chartsQ.isFetching}
            />
          </>
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.analytics.reportTotal"), value: summary.total ?? 0 },
              { label: t("page.analytics.reportPublished"), value: summary.published ?? 0 },
              { label: t("page.analytics.reportDraft"), value: summary.draft ?? 0 },
              { label: t("page.analytics.reportNotified"), value: summary.notified ?? 0 },
              { label: t("page.analytics.reportPinned"), value: summary.pinned ?? 0 },
              {
                label: t("page.analytics.subscriptionHealth"),
                value: t(`page.analytics.subscriptionHealthValue.${summary.subscription_health ?? "inactive"}`),
              },
            ]}
          />
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.keys(pieToRecord(chartsQ.data?.by_status)).length ? (
            <WorkbenchPanel title={t("page.analyticsReports.chartStatus")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_status)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(chartsQ.data?.by_tag)).length ? (
            <WorkbenchPanel title={t("page.analyticsReports.chartTags")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_tag)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(chartsQ.data?.by_owner)).length ? (
            <WorkbenchPanel title={t("page.analyticsReports.chartOwners")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_owner)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
      </WorkbenchShell>

      {summaryQ.error ? <ErrorBlock message={(summaryQ.error as Error).message} /> : null}
      <Analytics section="reports" reportsLayout="module" />

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module="data.analytics.reports"
        context={{ summary }}
        initialPrompt={t("page.analyticsReports.aiPrefill")}
      />
    </div>
  );
}
