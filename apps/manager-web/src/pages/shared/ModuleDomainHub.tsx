import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Suspense, lazy, type ReactNode } from "react";
import { Card } from "../../components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "./WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "./workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("../../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

export type HubDomainLink = { id: string; path: string };

export function ModuleDomainHub({
  title,
  description,
  queryKey,
  queryFn,
  metrics,
  domains,
  domainIcons,
  domainLabel,
  charts,
  stackLayers,
  stackTitle,
  domainsTitle,
  actions,
  enabled = true,
}: {
  title: string;
  description: string;
  queryKey: string;
  queryFn: () => Promise<{ ok?: boolean; summary?: Record<string, unknown>; domains?: HubDomainLink[]; stack_layers?: Array<Record<string, unknown>> }>;
  metrics: Array<{ label: string; value: string | number }>;
  domains: HubDomainLink[];
  domainIcons: Record<string, LucideIcon>;
  domainLabel: (id: string) => string;
  charts?: Array<{ title: string; data?: Array<{ name: string; value: number }> }>;
  stackLayers?: Array<{ id: string; name: string; maturity?: number; hint?: string }>;
  stackTitle?: string;
  domainsTitle: string;
  actions?: ReactNode;
  enabled?: boolean;
}) {
  const authed = Boolean(getToken());
  const hubQ = useQuery({
    queryKey: [queryKey],
    queryFn,
    enabled: authed && enabled,
  });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const layers = stackLayers ?? (hubQ.data?.stack_layers as typeof stackLayers) ?? [];

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={title}
        description={description}
        actions={
          <>
            {actions}
            <RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />
          </>
        }
        metrics={<WorkbenchStats items={metrics} />}
      >
        {charts?.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {charts.map((panel) =>
              Object.keys(pieToRecord(panel.data)).length ? (
                <WorkbenchPanel key={panel.title} title={panel.title}>
                  <Suspense fallback={<LoadingBlock />}>
                    <EChartsDonutLazy data={pieToRecord(panel.data)} height={200} />
                  </Suspense>
                </WorkbenchPanel>
              ) : null,
            )}
          </div>
        ) : null}
      </WorkbenchShell>

      {layers.length && stackTitle ? (
        <Card title={stackTitle}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {layers.map((layer) => (
              <div key={layer.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text)]">{layer.name}</span>
                  {layer.maturity != null ? (
                    <span className="text-xs font-semibold text-[var(--brand)]">{layer.maturity}%</span>
                  ) : null}
                </div>
                {layer.hint ? <p className="mt-1 text-xs text-[var(--muted)]">{layer.hint}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title={domainsTitle}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain) => {
            const Icon = domainIcons[domain.id] ?? ArrowRight;
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
                    {domainLabel(domain.id)}
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
