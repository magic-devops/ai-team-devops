import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, ShieldCheck, UserCog, Users } from "lucide-react";
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
  users: "nav.orgTenantUsers",
  businesses: "nav.orgBusinesses",
  "project-members": "nav.orgProjectMembers",
  "role-policy": "nav.orgRolePolicy",
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  users: UserCog,
  businesses: Building2,
  "project-members": Users,
  "role-policy": ShieldCheck,
};

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function OrganizationHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["organizationHub"], queryFn: api.organizationHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const rolePie = pieToRecord(hubQ.data?.charts?.by_user_role);

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.organization.hubTitle")}
        description={t("page.organization.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.organization.hubUsers"), value: summary.users_total ?? 0 },
              { label: t("page.organization.hubActiveUsers"), value: summary.users_active ?? 0 },
              { label: t("page.organization.hubBusinesses"), value: summary.businesses_total ?? 0 },
              { label: t("page.organization.hubProjects"), value: summary.projects_active ?? 0 },
              { label: t("page.organization.hubMembers"), value: summary.project_members_total ?? 0 },
            ]}
          />
        }
      >
        {Object.keys(rolePie).length ? (
          <WorkbenchPanel title={t("page.organization.hubRoleChart")}>
            <Suspense fallback={<LoadingBlock />}>
              <EChartsDonutLazy data={rolePie} height={200} />
            </Suspense>
          </WorkbenchPanel>
        ) : null}
      </WorkbenchShell>

      <Card title={t("page.organization.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? Building2;
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
