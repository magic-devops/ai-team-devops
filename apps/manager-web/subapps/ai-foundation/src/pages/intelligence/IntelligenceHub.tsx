import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Brain, Cpu, Database, FileCode, Gauge, GitBranch, Library, Search, ShieldCheck, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  knowledge: Library,
  rag: Search,
  memory: Brain,
  rules: ShieldCheck,
  distill: Sparkles,
  specs: FileCode,
  "design-docs": FileCode,
  datasources: Database,
  worker: Cpu,
  sync: GitBranch,
  events: Activity,
  usage: Gauge,
};

const DOMAIN_I18N: Record<string, string> = {
  knowledge: "nav.knowledgeBase",
  rag: "nav.ragSearch",
  memory: "nav.aiMemory",
  rules: "nav.ruleCenter",
  distill: "nav.reflectionDistill",
  specs: "nav.specs",
  "design-docs": "nav.designDocs",
  datasources: "nav.dataSources",
  worker: "nav.workerOps",
  sync: "nav.syncOps",
  events: "nav.eventStream",
  usage: "nav.usageOps",
};

export function IntelligenceHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({
    queryKey: ["intelligenceHub"],
    queryFn: api.intelligenceHub,
    enabled: authed,
  });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const stackLayers = hubQ.data?.stack_layers ?? [];

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.intelligence.hubTitle")}
        description={t("page.intelligence.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.intelligence.workerTotal"), value: summary.worker_total ?? 0 },
              { label: t("page.intelligence.workerActive"), value: summary.worker_active ?? 0 },
              { label: t("page.intelligence.syncModules"), value: summary.sync_modules ?? 0 },
              { label: t("page.intelligence.syncRecords"), value: summary.sync_records ?? 0 },
              { label: t("page.intelligence.usageAlerts"), value: summary.usage_alerts_open ?? 0 },
              { label: t("page.intelligence.memoryBackend"), value: String(summary.memory_backend ?? "—") },
            ]}
          />
        }
      />

      {stackLayers.length ? (
        <Card title={t("page.intelligence.stackTitle")}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stackLayers.map((layer: { id: string; name: string; maturity: number }) => (
              <div key={layer.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text)]">{layer.name}</span>
                  <span className="text-xs font-semibold text-[var(--brand)]">{layer.maturity}%</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title={t("page.intelligence.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? Brain;
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
