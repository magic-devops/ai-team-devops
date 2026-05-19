import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Blocks, Check, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("@/components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

const DOMAIN_I18N: Record<string, string> = {
  catalog: "nav.marketplaceCatalog",
  installed: "nav.marketplaceInstalled",
  ratings: "nav.marketplaceRatings",
  skills: "nav.skillsHub",
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  catalog: Blocks,
  installed: Check,
  ratings: Sparkles,
  skills: Sparkles,
};

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function MarketplaceHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["marketplaceHub"], queryFn: api.marketplaceHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const typePie = pieToRecord(hubQ.data?.charts?.by_type);
  const sigPie = pieToRecord(hubQ.data?.charts?.by_signature);

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.marketplace.hubTitle")}
        description={t("page.marketplace.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.marketplace.hubPackages"), value: summary.packages ?? 0 },
              { label: t("page.marketplace.hubInstalled"), value: summary.installed ?? 0 },
              { label: t("page.marketplace.hubSigned"), value: summary.signed_packages ?? 0 },
              { label: t("page.marketplace.hubRating"), value: summary.avg_rating ?? 0 },
            ]}
          />
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {Object.keys(typePie).length ? (
            <WorkbenchPanel title={t("page.marketplace.hubTypeChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={typePie} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(sigPie).length ? (
            <WorkbenchPanel title={t("page.marketplace.hubSigChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={sigPie} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
      </WorkbenchShell>

      <Card title={t("page.marketplace.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? Blocks;
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
