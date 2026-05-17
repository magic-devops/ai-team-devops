import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, BellRing, Copy, GitBranch, Network, Rows3 } from "lucide-react";
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
  templates: "nav.workflowTemplates",
  instances: "nav.workflowInstances",
  events: "nav.workflowEvents",
  signals: "nav.workflowSignals",
  bulk_ops: "nav.workflowBulkOps",
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  templates: Copy,
  instances: Rows3,
  events: BellRing,
  signals: Network,
  bulk_ops: Activity,
};

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function WorkflowsHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["workflowsHub"], queryFn: api.workflowsHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const statusPie = pieToRecord(hubQ.data?.charts?.by_status);
  const typePie = pieToRecord(hubQ.data?.charts?.by_type);

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.workflows.hubTitle")}
        description={t("page.workflows.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.workflows.hubEngine"), value: String(summary.engine ?? "—") },
              { label: t("page.workflows.hubTotal"), value: summary.total ?? 0 },
            ]}
          />
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {Object.keys(statusPie).length ? (
            <WorkbenchPanel title={t("page.workflows.hubStatusChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={statusPie} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(typePie).length ? (
            <WorkbenchPanel title={t("page.workflows.hubTypeChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={typePie} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
      </WorkbenchShell>

      <Card title={t("page.workflows.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2">
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
