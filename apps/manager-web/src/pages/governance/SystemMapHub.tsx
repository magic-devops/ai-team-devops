import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Command, FileText, Rows3, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchStats } from "../shared/workbenchUi";

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  registry: Rows3,
  manifest: FileText,
  capabilities: ShieldCheck,
  actions: Command,
};

const DOMAIN_I18N: Record<string, string> = {
  registry: "nav.pageRegistry",
  manifest: "nav.moduleManifest",
  capabilities: "nav.capabilityGovernance",
  actions: "nav.moduleActionCatalog",
};

export function SystemMapHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["systemPagesHub"], queryFn: api.systemPagesHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const stackLayers = hubQ.data?.stack_layers ?? [];

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.systemMap.hubTitle")}
        description={t("page.systemMap.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.systemMap.hubReact"), value: summary.react_pages ?? 0 },
              { label: t("page.systemMap.hubLegacy"), value: summary.legacy_pages ?? 0 },
              { label: t("page.systemMap.hubMaturity"), value: `${summary.avg_maturity ?? 0}%` },
              { label: t("page.systemMap.hubIssues"), value: summary.validation_issues ?? 0 },
            ]}
          />
        }
      />
      {stackLayers.length ? (
        <Card title={t("page.systemMap.stackTitle")}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stackLayers.slice(0, 8).map((layer: { id: string; name: string; avg_maturity: number; react_count: number; total: number }) => (
              <div key={layer.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text)]">{layer.name}</span>
                  <span className="text-xs font-semibold text-[var(--brand)]">{layer.avg_maturity}%</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  React {layer.react_count} · {t("page.systemMap.totalShort")} {layer.total}
                </p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      <Card title={t("page.systemMap.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? Rows3;
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
