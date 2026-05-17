import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiAssistButton, AiAssistDrawer } from "../../../components/ai/AiAssistDrawer";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../../../components/PageStates";
import { api } from "../../../lib/api";
import { getToken } from "../../../lib/authStorage";
import { Analytics, type CatalogPanel } from "../../Analytics";
import { WorkbenchShell } from "../../shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "../../shared/workbenchUi";
import { GOVERNANCE_DOMAIN_I18N } from "./types";

const EChartsDonutLazy = lazy(() =>
  import("../../../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

function stat(value: unknown): string | number {
  if (typeof value === "number" || typeof value === "string") return value;
  if (value === undefined || value === null) return "—";
  return String(value);
}

function domainMetrics(domain: CatalogPanel, summary: Record<string, unknown>, t: (k: string) => string) {
  if (domain === "assets") {
    return [
      { label: t("page.dataGovernance.metrics.assetTotal"), value: stat(summary.total) },
      { label: t("page.dataGovernance.metrics.assetActive"), value: stat(summary.active) },
      { label: t("page.analytics.qualityBlocked"), value: stat(summary.quality_blocked) },
      { label: t("page.dataGovernance.metrics.qualityAvg"), value: stat(summary.quality_avg) },
    ];
  }
  if (domain === "metrics") {
    return [
      { label: t("page.analytics.metrics"), value: stat(summary.metrics) },
      { label: t("page.analytics.tags"), value: stat(summary.tags) },
      { label: t("page.dataGovernance.metrics.domains"), value: stat(summary.domains) },
    ];
  }
  if (domain === "services") {
    return [
      { label: t("page.dataGovernance.metrics.serviceTotal"), value: stat(summary.total) },
      { label: t("page.dataGovernance.metrics.published"), value: stat(summary.published) },
      { label: t("page.dataGovernance.metrics.draft"), value: stat(summary.draft) },
    ];
  }
  if (domain === "quality") {
    return [
      { label: t("page.dataGovernance.metrics.alertTotal"), value: stat(summary.alerts) },
      { label: t("page.dataGovernance.metrics.alertOpen"), value: stat(summary.open_alerts) },
      { label: t("page.analytics.qualityBlocked"), value: stat(summary.quality_blocked) },
    ];
  }
  return [
    { label: t("page.dataGovernance.metrics.templates"), value: stat(summary.templates) },
    { label: t("page.dataGovernance.metrics.activeTemplates"), value: stat(summary.active_templates) },
    { label: t("page.dataGovernance.metrics.schedules"), value: stat(summary.schedules) },
  ];
}

function chartPanels(domain: CatalogPanel, charts: Record<string, Array<{ name: string; value: number }>>) {
  if (domain === "assets") {
    return [
      { titleKey: "page.dataGovernance.charts.byDomain", data: pieToRecord(charts.by_domain) },
      { titleKey: "page.dataGovernance.charts.byQuality", data: pieToRecord(charts.by_quality) },
    ];
  }
  if (domain === "metrics") {
    return [
      { titleKey: "page.dataGovernance.charts.metricsByDomain", data: pieToRecord(charts.metrics_by_domain) },
      { titleKey: "page.dataGovernance.charts.tagsByCategory", data: pieToRecord(charts.tags_by_category) },
    ];
  }
  if (domain === "services") {
    return [
      { titleKey: "page.dataGovernance.charts.byStatus", data: pieToRecord(charts.by_status) },
      { titleKey: "page.dataGovernance.charts.byType", data: pieToRecord(charts.by_type) },
    ];
  }
  if (domain === "quality") {
    return [{ titleKey: "page.dataGovernance.charts.bySeverity", data: pieToRecord(charts.by_severity) }];
  }
  return [
    { titleKey: "page.dataGovernance.charts.byEngine", data: pieToRecord(charts.templates_by_engine) },
    { titleKey: "page.dataGovernance.charts.templateStatus", data: pieToRecord(charts.templates_by_status) },
  ];
}

export function DataGovernanceModulePage({ domain }: { domain: CatalogPanel }) {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const [aiOpen, setAiOpen] = useState(false);
  const meta = GOVERNANCE_DOMAIN_I18N[domain];

  const summaryQ = useQuery({
    queryKey: ["analyticsGovernanceDomain", domain, "summary"],
    queryFn: () => api.analyticsGovernanceDomainSummary(domain),
    enabled: authed,
  });
  const chartsQ = useQuery({
    queryKey: ["analyticsGovernanceDomain", domain, "charts"],
    queryFn: () => api.analyticsGovernanceDomainCharts(domain),
    enabled: authed,
  });

  const summary = summaryQ.data?.summary ?? {};
  const charts = chartsQ.data?.charts ?? {};
  const panels = useMemo(() => chartPanels(domain, charts), [charts, domain]);

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={t(meta.title)}
        description={t(meta.desc)}
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
        metrics={<WorkbenchStats items={domainMetrics(domain, summary, t)} />}
      >
        <div className={`grid gap-4 ${panels.length > 1 ? "lg:grid-cols-2" : ""}`}>
          {summaryQ.error ? <ErrorBlock message={(summaryQ.error as Error).message} /> : null}
          {panels.map((panel) =>
            Object.keys(panel.data).length ? (
              <WorkbenchPanel key={panel.titleKey} title={t(panel.titleKey)}>
                <Suspense fallback={<LoadingBlock />}>
                  <EChartsDonutLazy data={panel.data} height={200} />
                </Suspense>
              </WorkbenchPanel>
            ) : null,
          )}
        </div>
      </WorkbenchShell>

      <Analytics section="catalog" initialCatalogPanel={domain} catalogLayout="module" />

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module={`data.governance.${domain}`}
        context={{ domain, summary }}
        initialPrompt={t(meta.aiPrefill)}
      />
    </div>
  );
}
