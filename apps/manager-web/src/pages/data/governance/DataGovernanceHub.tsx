import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Database, Download, GitBranch, Layers3, Library, SearchCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "../../../components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../../../components/PageStates";
import { api } from "../../../lib/api";
import { getToken } from "../../../lib/authStorage";
import { WorkbenchShell } from "../../shared/WorkbenchShell";
import { WorkbenchStats } from "../../shared/workbenchUi";
import { GOVERNANCE_DOMAIN_I18N, GOVERNANCE_DOMAIN_ORDER, type CatalogPanel, type GovernanceDomainCard } from "./types";

const DOMAIN_ICONS: Record<CatalogPanel, typeof Database> = {
  assets: Database,
  metrics: Library,
  services: Sparkles,
  quality: SearchCheck,
  development: GitBranch,
};

function metricValue(summary: Record<string, unknown>, keys: string[]): string | number {
  for (const key of keys) {
    const v = summary[key];
    if (v !== undefined && v !== null && v !== "") {
      if (typeof v === "number" || typeof v === "string") return v;
      return String(v);
    }
  }
  return "—";
}

export function DataGovernanceHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({
    queryKey: ["analyticsGovernanceHub"],
    queryFn: api.analyticsGovernanceHub,
    enabled: authed,
  });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = (hubQ.data?.domains ?? []) as GovernanceDomainCard[];
  const stackLayers = hubQ.data?.stack_layers ?? [];

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.dataGovernance.hubTitle")}
        description={t("page.dataGovernance.hubDesc")}
        actions={
          <>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
              href={api.analyticsExportCsvUrl()}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="h-4 w-4" />
              {t("page.analytics.exportCsv")}
            </a>
            <RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />
          </>
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.analytics.assets"), value: summary.assets ?? 0 },
              { label: t("page.analytics.metrics"), value: summary.metrics ?? 0 },
              { label: t("page.analytics.tags"), value: summary.tags ?? 0 },
              { label: t("page.analytics.dataServices"), value: summary.services ?? 0 },
              { label: t("page.analytics.devTemplates"), value: summary.dev_templates ?? 0 },
              { label: t("page.analytics.qualityBlocked"), value: summary.quality_blocked ?? 0 },
            ]}
          />
        }
      />

      <Card title={t("page.dataGovernance.stackTitle")}>
        <p className="mb-4 text-sm text-[var(--muted)]">{t("page.dataGovernance.stackDesc")}</p>
        <div className="grid gap-3 lg:grid-cols-4">
          {stackLayers.map((layer: { id: string; title: string; items: string[]; engines: string[] }) => (
            <div
              key={layer.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4"
            >
              <div className="flex items-center gap-2 text-[var(--brand)]">
                <Layers3 className="h-4 w-4" />
                <h3 className="text-sm font-semibold text-[var(--text)]">{layer.title}</h3>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-[var(--muted-strong)]">
                {(layer.items ?? []).map((item: string) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
              <p className="mt-3 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                {(layer.engines ?? []).join(" · ")}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {GOVERNANCE_DOMAIN_ORDER.map((domainId) => {
          const domain = domains.find((d) => d.id === domainId);
          const meta = GOVERNANCE_DOMAIN_I18N[domainId];
          const Icon = DOMAIN_ICONS[domainId];
          const ds = domain?.summary ?? {};
          return (
            <a
              key={domainId}
              href={domain?.path ?? `#/analytics/catalog/${domainId === "metrics" ? "metrics" : domainId === "development" ? "development" : domainId}`}
              className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--brand)] hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  <Icon className="h-5 w-5" />
                </div>
                <ArrowRight className="h-4 w-4 text-[var(--muted)] transition group-hover:text-[var(--brand)]" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-[var(--text)]">{t(meta.title)}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{t(meta.desc)}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[var(--surface-muted)] px-3 py-2">
                  <p className="text-[10px] uppercase text-[var(--muted)]">{t("page.dataGovernance.primaryMetric")}</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-[var(--text)]">
                    {metricValue(ds, ["total", "metrics", "alerts", "templates", "published"])}
                  </p>
                </div>
                <div className="rounded-xl bg-[var(--surface-muted)] px-3 py-2">
                  <p className="text-[10px] uppercase text-[var(--muted)]">{t("page.dataGovernance.secondaryMetric")}</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-[var(--text)]">
                    {metricValue(ds, ["quality_blocked", "open_alerts", "published", "schedules", "tags"])}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {(domain?.capabilities ?? []).slice(0, 4).map((cap) => (
                  <span
                    key={cap}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] text-[var(--muted-strong)]"
                  >
                    {cap.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
