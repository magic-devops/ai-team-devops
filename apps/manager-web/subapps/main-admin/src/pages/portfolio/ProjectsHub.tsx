import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, FolderKanban, Package, UserCog, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../../../../src/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../../../../../src/components/PageStates";
import { api } from "../../../../../src/lib/api";
import { getToken } from "../../../../../src/lib/authStorage";
import { WorkbenchShell } from "../../../../../src/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "../../../../../src/pages/shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("../../../../../src/components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

const DOMAIN_I18N: Record<string, string> = {
  portfolio: "nav.projectPortfolio",
  businesses: "nav.projectBusinesses",
  tenants: "nav.projectTenants",
  users: "nav.tenantUsers",
  members: "nav.projectMembers",
  delivery_kit: "nav.projectDeliveryKit",
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  portfolio: FolderKanban,
  businesses: Building2,
  tenants: Building2,
  users: UserCog,
  members: Users,
  delivery_kit: Package,
};

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function ProjectsHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["projectsHub"], queryFn: api.projectsHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const statusPie = pieToRecord(hubQ.data?.charts?.by_status);

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.projects.hubTitle")}
        description={t("page.projects.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.projects.hubTotal"), value: summary.total ?? 0 },
              { label: t("page.projects.hubActive"), value: summary.active ?? 0 },
              { label: t("page.projects.hubTemplates"), value: summary.templates ?? 0 },
              { label: t("page.projects.hubMembers"), value: summary.members ?? 0 },
              { label: t("page.projects.hubTasks"), value: summary.tasks ?? 0 },
              { label: t("page.projects.hubRisks"), value: summary.risks ?? 0 },
            ]}
          />
        }
      >
        {Object.keys(statusPie).length ? (
          <WorkbenchPanel title={t("page.projects.hubStatusChart")}>
            <Suspense fallback={<LoadingBlock />}>
              <EChartsDonutLazy data={statusPie} height={200} />
            </Suspense>
          </WorkbenchPanel>
        ) : null}
      </WorkbenchShell>

      <Card title={t("page.projects.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? FolderKanban;
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
