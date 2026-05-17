import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, BookOpen, ClipboardList, GitBranch, Library, Rows3 } from "lucide-react";
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
  workbench: "page.devFlow.hubWorkbench",
  requirements: "nav.requirements",
  tasks: "nav.tasks",
  issues: "nav.issues",
  sprints: "nav.taskSprints",
  "design-docs": "nav.designDocs",
  workflows: "nav.workflows",
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  workbench: GitBranch,
  requirements: Library,
  tasks: ClipboardList,
  issues: AlertCircle,
  sprints: Rows3,
  "design-docs": BookOpen,
  workflows: GitBranch,
};

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function DevFlowHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["devFlowHub"], queryFn: api.devFlowHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const reqPie = pieToRecord(hubQ.data?.charts?.requirement_status);
  const taskPie = pieToRecord(hubQ.data?.charts?.task_status);

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.devFlow.hubTitle")}
        description={t("page.devFlow.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("nav.requirements"), value: summary.requirements_total ?? 0 },
              { label: t("nav.tasks"), value: summary.tasks_total ?? 0 },
              { label: t("page.devFlow.hubSprintTasks"), value: summary.tasks_sprint ?? 0 },
              { label: t("page.devFlow.hubOpenIssues"), value: summary.issues_open ?? 0 },
              { label: t("page.devFlow.hubCritical"), value: summary.issues_critical ?? 0 },
            ]}
          />
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {Object.keys(reqPie).length ? (
            <WorkbenchPanel title={t("page.devFlow.hubReqChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={reqPie} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(taskPie).length ? (
            <WorkbenchPanel title={t("page.devFlow.hubTaskChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={taskPie} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
      </WorkbenchShell>

      <Card title={t("page.devFlow.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? GitBranch;
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
