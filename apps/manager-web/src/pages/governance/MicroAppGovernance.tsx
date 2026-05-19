import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, Layers3, Network, ShieldCheck } from "lucide-react";
import { Card } from "../../components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchStats } from "../shared/workbenchUi";

type MicroAppRow = {
  id: string;
  name: string;
  owner: string;
  route: string;
  runtime_url: string;
  entry: string;
  mode: string;
  status: string;
  avg_maturity: number;
  module_count: number;
  domain_module_count: number;
  capability_count: number;
  responsibilities?: string[];
  modules?: Array<{
    id: string;
    name: string;
    path: string;
    maturity: number;
    capabilities?: string[];
  }>;
};

function statusClass(status: string) {
  if (status === "healthy") return "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300";
  if (status === "watch") return "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300";
  return "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300";
}

export function MicroAppGovernance() {
  const authed = Boolean(getToken());
  const appsQ = useQuery({ queryKey: ["systemPagesMicroApps"], queryFn: api.systemPagesMicroApps, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (appsQ.isLoading) return <LoadingBlock />;
  if (appsQ.error) return <ErrorBlock message={(appsQ.error as Error).message} />;

  const summary = appsQ.data?.summary ?? {};
  const apps: MicroAppRow[] = appsQ.data?.apps ?? [];

  return (
    <div className="space-y-5">
      <WorkbenchShell
        title="独立子应用管理"
        description="统一治理主应用与四个 Wujie 子应用的边界、入口、模块归属、能力覆盖、成熟度和 Agent 消费信息。"
        actions={<RefreshButton onClick={() => void appsQ.refetch()} pending={appsQ.isFetching} />}
        metrics={
          <WorkbenchStats
            items={[
              { label: "应用数", value: summary.total ?? apps.length },
              { label: "Wujie 子应用", value: summary.wujie ?? 0 },
              { label: "治理模块", value: summary.module_count ?? 0 },
              { label: "能力覆盖", value: summary.capability_count ?? 0 },
            ]}
          />
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {apps.map((app) => (
          <Card key={app.id} title={app.name}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]">
                    <Layers3 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text)]">{app.owner}</p>
                    <p className="mt-1 flex items-center gap-1 truncate font-mono text-xs text-[var(--brand)]">
                      <Network className="h-3.5 w-3.5 shrink-0" />
                      {app.runtime_url}
                    </p>
                  </div>
                </div>
                <span className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ${statusClass(app.status)}`}>
                  {app.status} · {app.avg_maturity}%
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                <div className="rounded-lg bg-[var(--surface-muted)] p-2">
                  <p className="text-lg font-bold text-[var(--text)]">{app.module_count}</p>
                  <p className="text-xs text-[var(--muted)]">核心模块</p>
                </div>
                <div className="rounded-lg bg-[var(--surface-muted)] p-2">
                  <p className="text-lg font-bold text-[var(--text)]">{app.domain_module_count}</p>
                  <p className="text-xs text-[var(--muted)]">领域页面</p>
                </div>
                <div className="rounded-lg bg-[var(--surface-muted)] p-2">
                  <p className="text-lg font-bold text-[var(--text)]">{app.capability_count}</p>
                  <p className="text-xs text-[var(--muted)]">能力项</p>
                </div>
                <div className="rounded-lg bg-[var(--surface-muted)] p-2">
                  <p className="truncate text-xs font-semibold text-[var(--text)]">{app.entry}</p>
                  <p className="text-xs text-[var(--muted)]">构建入口</p>
                </div>
              </div>

              {app.responsibilities?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {app.responsibilities.map((item) => (
                    <span key={item} className="rounded bg-[var(--surface-muted)] px-2 py-1 text-[11px] text-[var(--muted-strong)]">
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-2">
                {(app.modules ?? []).map((module) => (
                  <a
                    key={module.id}
                    href={module.path}
                    className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm hover:border-[var(--brand)]/40 hover:bg-[var(--brand-soft)]"
                  >
                    <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                    <span className="min-w-0 flex-1 truncate font-medium text-[var(--text)]">{module.name}</span>
                    <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">{module.maturity}%</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                  </a>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <a href={app.route} className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90">
                  进入管理入口
                  <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href={app.runtime_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm font-semibold text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                >
                  独立打开
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
