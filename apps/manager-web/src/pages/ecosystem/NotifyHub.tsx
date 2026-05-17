import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BellRing, ClipboardList, Network } from "lucide-react";
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
  channels: "nav.notifyChannels",
  outbound: "nav.notifyOutbound",
  inbound: "nav.notifyInbound",
  connectors: "nav.notifyConnectors",
  webhooks: "nav.webhooks",
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  channels: BellRing,
  outbound: ArrowRight,
  inbound: ClipboardList,
  connectors: Network,
  webhooks: BellRing,
};

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export function NotifyHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["notifyHub"], queryFn: api.notifyHub, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const directionPie = pieToRecord(hubQ.data?.charts?.by_direction);
  const channelPie = pieToRecord(hubQ.data?.charts?.by_channel);

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.notify.hubTitle")}
        description={t("page.notify.hubDesc")}
        actions={<RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.notify.hubChannels"), value: summary.channels ?? 0 },
              { label: t("page.notify.hubEnabled"), value: summary.enabled ?? 0 },
              { label: t("page.notify.hubMessages"), value: summary.messages ?? 0 },
              { label: t("page.notify.hubFailures"), value: summary.failures ?? 0 },
            ]}
          />
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {Object.keys(directionPie).length ? (
            <WorkbenchPanel title={t("page.notify.hubDirectionChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={directionPie} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(channelPie).length ? (
            <WorkbenchPanel title={t("page.notify.hubChannelChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={channelPie} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
      </WorkbenchShell>

      <Card title={t("page.notify.domainsTitle")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain: { id: string; path: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? BellRing;
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
