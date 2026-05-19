import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Cpu, ListChecks, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchStats } from "../shared/workbenchUi";

const MODULES = [
  { id: "runs", path: "#/ai/agent-ops/workbench", icon: ListChecks, label: "运行列表", desc: "所有 Agent 运行记录与状态" },
  { id: "heartbeat", path: "#/ai/agent-ops/heartbeat", icon: Activity, label: "心跳监控", desc: "实时心跳与存活检测" },
  { id: "profiles", path: "#/ai/agent-ops/profiles", icon: Cpu, label: "能力画像", desc: "Agent 成功率与性能分析" },
  { id: "retry", path: "#/ai/agent-ops/retry", icon: RefreshCw, label: "失败重试", desc: "失败任务重试与恢复策略" },
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
        title={t("page.agentOps.hubTitle", "Agent 运行中心")}
        description={t("page.agentOps.hubDesc", "Agent 运行生命周期管理：运行列表、心跳监控、能力画像与失败重试")}
        actions={<RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />}
        metrics={
          <WorkbenchStats items={[
            { label: "总运行数", value: s.total ?? 0 },
            { label: "运行中", value: s.running ?? 0 },
            { label: "成功率", value: `${s.success_rate ?? 0}%`, trend: "up" },
            { label: "平均耗时(s)", value: s.avg_duration_s ?? 0 },
          ]} />
        }
      />
      <Card title="功能模块">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MODULES.map(({ id, path, icon: Icon, label, desc }) => (
            <a key={id} href={path} className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]">
              <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]"><Icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold text-[var(--text)]">{label}<ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" /></span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{desc}</span>
              </span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
