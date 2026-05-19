import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, Brain, Database, FileText, Network, SearchCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getProjectId, getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("@/components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

const DOMAIN_I18N: Record<string, string> = {
  overview: "page.analytics.hubOverview",
  catalog: "nav.analyticsCatalog",
  blueprint: "nav.analyticsBlueprint",
  reports: "nav.analyticsReports",
  exchange: "nav.dataExchange",
  lineage: "nav.analyticsLineage",
  nlq: "nav.analyticsNlq",
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  overview: BarChart3,
  catalog: Database,
  blueprint: Brain,
  reports: FileText,
  exchange: Database,
  lineage: Network,
  nlq: SearchCheck,
};

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function AnalyticsDataHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const hubQ = useQuery({
    queryKey: ["analyticsDataHub"],
    queryFn: api.analyticsDataHub,
    enabled: authed && hasProject,
  });

  if (!authed) return <NeedLogin />;
  if (!hasProject) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
        {t("page.projects.pickProject")}
      </div>
    );
  }
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const taskPie = pieToRecord(hubQ.data?.charts?.task_status);

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.analytics.hubTitle")}
        description={t("page.analytics.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("nav.tasks"), value: summary.tasks_total ?? 0 },
              { label: t("nav.requirements"), value: summary.requirements_total ?? 0 },
              { label: t("nav.issues"), value: summary.issues_total ?? 0 },
              { label: t("page.analytics.hubReflections"), value: summary.reflections ?? 0 },
            ]}
          />
        }
      >
        {Object.keys(taskPie).length ? (
          <WorkbenchPanel title={t("page.analytics.hubTaskChart")}>
            <Suspense fallback={<LoadingBlock />}>
              <EChartsDonutLazy data={taskPie} height={200} />
            </Suspense>
          </WorkbenchPanel>
        ) : null}
      </WorkbenchShell>

      <Card title={t("page.analytics.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? BarChart3;
            const labelKey = DOMAIN_I18N[domain.id];
            return (
              <a
                key={domain.id}
                href={domain.path}
                className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
              >
                <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-sm font-semibold text-[var(--text)]">
                    {labelKey ? t(labelKey) : domain.id}
                    <ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">{domain.path}</span>
                </span>
              </a>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
