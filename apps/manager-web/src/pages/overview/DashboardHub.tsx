import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, Bot, ClipboardList, FolderKanban, GitBranch, LayoutDashboard, Library } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("../../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

const DOMAIN_I18N: Record<string, string> = {
  cockpit: "page.dashboard.hubCockpit",
  projects: "nav.projects",
  requirements: "nav.requirements",
  tasks: "nav.tasks",
  "dev-flow": "nav.devFlow",
  analytics: "nav.analytics",
  copilot: "nav.copilot",
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  cockpit: LayoutDashboard,
  projects: FolderKanban,
  requirements: Library,
  tasks: ClipboardList,
  "dev-flow": GitBranch,
  analytics: BarChart3,
  copilot: Bot,
};

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function DashboardHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["dashboardHub"], queryFn: api.dashboardHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const risks = (hubQ.data?.risks ?? []) as Array<{ title?: string; level?: string; target?: string }>;
  const taskPie = pieToRecord(hubQ.data?.charts?.task_status);
  const reqPie = pieToRecord(hubQ.data?.charts?.requirement_status);

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.dashboard.hubTitle")}
        description={t("page.dashboard.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("nav.projects"), value: summary.projects ?? 0 },
              { label: t("nav.requirements"), value: summary.requirements ?? 0 },
              { label: t("nav.tasks"), value: summary.tasks ?? 0 },
              { label: t("page.dashboard.hubDelivery"), value: `${summary.delivery_rate ?? 0}%` },
              { label: t("page.dashboard.hubRisks"), value: risks.length },
            ]}
          />
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {Object.keys(taskPie).length ? (
            <WorkbenchPanel title={t("page.dashboard.hubTaskChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={taskPie} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(reqPie).length ? (
            <WorkbenchPanel title={t("page.dashboard.hubReqChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={reqPie} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
      </WorkbenchShell>

      {risks.length ? (
        <Card title={t("page.dashboard.hubRiskBoard")}>
          <ul className="space-y-2">
            {risks.slice(0, 5).map((risk) => (
              <li key={String(risk.title)} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                <span className="text-sm text-[var(--text)]">{risk.title}</span>
                {risk.target ? (
                  <a href={risk.target} className="text-xs font-medium text-[var(--brand)]">
                    {t("dashboard.open")}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={t("page.dashboard.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? LayoutDashboard;
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
