import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Cpu, ListChecks, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";

const MODULES = [
  { id: "runs", path: "#/ai/agent-ops/workbench", icon: ListChecks },
  { id: "heartbeat", path: "#/ai/agent-ops/heartbeat", icon: Activity },
  { id: "profiles", path: "#/ai/agent-ops/profiles", icon: Cpu },
  { id: "retry", path: "#/ai/agent-ops/retry", icon: RefreshCw },
];

export function AgentOpsHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const q = useQuery({ queryKey: ["agentRunsSummary"], queryFn: api.agentRunsSummary, enabled: authed });

  if (!authed) return <NeedLogin />;
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock message={(q.error as Error).message} />;

  const s = (q.data as any)?.summary ?? {};

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.agentOps.hubTitle")}
        description={t("page.agentOps.hubDesc")}
        actions={<RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />}
        metrics={
          <WorkbenchStats items={[
            { label: t("page.agentRuns.metrics.total"), value: s.total ?? 0 },
            { label: t("page.agentRuns.metrics.running"), value: s.running ?? 0 },
            { label: t("page.agentRuns.metrics.successRate"), value: `${s.success_rate ?? 0}%`, trend: "up" },
            { label: t("page.agentRuns.metrics.avgDuration"), value: s.avg_duration_s ?? 0 },
          ]} />
        }
      />
      <Card title={t("page.agentOps.modulesTitle")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MODULES.map(({ id, path, icon: Icon }) => (
            <a key={id} href={path} className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]">
              <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]"><Icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold text-[var(--text)]">{t(`page.agentRuns.modules.${id}.title`)}<ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" /></span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{t(`page.agentRuns.modules.${id}.description`)}</span>
              </span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
