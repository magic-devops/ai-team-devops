import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton, SearchInput } from "@/components/PageStates";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  running: "bg-blue-50 text-blue-700",
  success: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  retrying: "bg-yellow-50 text-yellow-700",
  cancelled: "bg-slate-100 text-slate-600",
};

const TERMINAL_STATUSES = new Set(["success", "failed", "cancelled"]);
type AgentRunsTab = "runs" | "heartbeat" | "profiles" | "retry";

export function AgentRunsWorkbench({ focused: _focused, initialTab = "runs" }: { focused?: boolean; initialTab?: AgentRunsTab }) {
  const authed = Boolean(getToken());
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<AgentRunsTab>(initialTab);

  const summaryQ = useQuery({ queryKey: ["agentRunsSummaryV2"], queryFn: api.agentRunsSummaryV2, enabled: authed });
  const runsQ = useQuery({ queryKey: ["agentRunsList", statusFilter], queryFn: () => api.agentRunsList("", statusFilter), enabled: authed });
  const profilesQ = useQuery({ queryKey: ["agentRunProfiles"], queryFn: api.agentRunProfiles, enabled: authed && tab === "profiles" });

  const heartbeat = useMutation({
    mutationFn: (id: string) => api.agentRunHeartbeat(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agentRunsList"] }),
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.agentRunStatus(id, { status }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentRunsList"] }); void qc.invalidateQueries({ queryKey: ["agentRunsSummaryV2"] }); void qc.invalidateQueries({ queryKey: ["agentRunProfiles"] }); },
  });
  const retryRun = useMutation({
    mutationFn: (id: string) => api.agentRunRetry(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentRunsList"] }); void qc.invalidateQueries({ queryKey: ["agentRunsSummaryV2"] }); void qc.invalidateQueries({ queryKey: ["agentRunProfiles"] }); },
  });
  const cancelRun = useMutation({
    mutationFn: (id: string) => api.agentRunCancel(id, { reason: "manual cancel from AgentOps" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentRunsList"] }); void qc.invalidateQueries({ queryKey: ["agentRunsSummaryV2"] }); void qc.invalidateQueries({ queryKey: ["agentRunProfiles"] }); },
  });
  const createRun = useMutation({
    mutationFn: () => api.agentRunCreate({ agent_id: `manual-agent-${Date.now()}`, task_id: `manual-task-${Date.now()}`, meta: { source: "manager-web" } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentRunsList"] }); void qc.invalidateQueries({ queryKey: ["agentRunsSummaryV2"] }); },
  });
  const writeEvidence = useMutation({
    mutationFn: (id: string) => api.agentRunEvidence(id, { artifact: { note: "manual evidence" }, gate_results: { build: "passed" }, confidence: 0.96 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agentRunsList"] }),
  });
  const deleteRun = useMutation({
    mutationFn: (id: string) => api.agentRunDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agentRunsList"] }),
  });

  if (!authed) return <NeedLogin />;

  const s = summaryQ.data?.summary ?? {};
  const runs = (runsQ.data?.items ?? []).filter((r: any) => !q || r.agent_id?.includes(q) || r.task_id?.includes(q));
  const profiles = profilesQ.data?.profiles ?? [];
  const runningRuns = runs.filter((r: any) => r.status === "running");
  const retryRuns = runs.filter((r: any) => r.status === "failed" || r.status === "retrying");
  const agentTabs: Array<{ id: AgentRunsTab; label: string }> = [
    { id: "runs", label: t("page.agentRuns.tabs.runs") },
    { id: "heartbeat", label: t("page.agentRuns.tabs.heartbeat") },
    { id: "profiles", label: t("page.agentRuns.tabs.profiles") },
    { id: "retry", label: t("page.agentRuns.tabs.retry") },
  ];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title="Agent 运行中心"
        description="Agent 运行生命周期管理：运行列表、心跳监控与能力画像"
        actions={<><AiAssistButton onClick={() => setAiOpen(true)} /><RefreshButton onClick={() => { void runsQ.refetch(); void summaryQ.refetch(); }} pending={runsQ.isFetching} /></>}
        metrics={
          <WorkbenchStats items={[
            { label: "总运行数", value: s.total ?? 0 },
            { label: "运行中", value: s.running ?? 0, trend: "up" },
            { label: "成功率", value: `${s.success_rate ?? 0}%`, trend: "up" },
            { label: "平均耗时(s)", value: s.avg_duration_s ?? 0 },
          ]} />
        }
      />

      <div className="flex gap-1 border-b border-[var(--border)]">
        {agentTabs.map(item => (
          <button key={item.id} onClick={() => setTab(item.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === item.id ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === "runs" && (
        <WorkbenchPanel title="运行记录" actions={
	          <div className="flex gap-2">
	            <SearchInput value={q} onChange={setQ} placeholder="搜索 Agent/Task ID..." />
            <select className="input-base text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
	              {["pending", "running", "success", "failed", "retrying", "cancelled"].map(s => <option key={s}>{s}</option>)}
	            </select>
	            <button onClick={() => createRun.mutate()} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white">新建运行</button>
	          </div>
        }>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                <th className="pb-2 pr-4">Agent ID</th><th className="pb-2 pr-4">Task ID</th><th className="pb-2 pr-4">状态</th>
                <th className="pb-2 pr-4">置信度</th><th className="pb-2 pr-4">重试</th><th className="pb-2 pr-4">开始时间</th><th className="pb-2">操作</th>
              </tr></thead>
              <tbody>
                {runs.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[var(--muted)]">暂无运行记录</td></tr>}
                {runs.map((r: any) => (
                  <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                    <td className="py-2 pr-4 font-mono text-xs">{r.agent_id?.slice(0, 12)}...</td>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--muted)]">{r.task_id?.slice(0, 8) || "—"}</td>
                    <td className="py-2 pr-4"><span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status] ?? ""}`}>{r.status}</span></td>
                    <td className="py-2 pr-4">{r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : "—"}</td>
                    <td className="py-2 pr-4">{r.retry_count ?? 0}</td>
                    <td className="py-2 pr-4 text-xs text-[var(--muted)]">{r.started_at?.slice(0, 19).replace("T", " ")}</td>
                    <td className="py-2 flex gap-2">
	                      {r.status === "running" && <button onClick={() => heartbeat.mutate(r.id)} className="text-xs text-[var(--brand)] hover:underline">心跳</button>}
	                      {r.status === "pending" && <button onClick={() => updateStatus.mutate({ id: r.id, status: "running" })} className="text-xs text-[var(--brand)] hover:underline">开始</button>}
	                      {r.status === "running" && <button onClick={() => updateStatus.mutate({ id: r.id, status: "success" })} className="text-xs text-green-600 hover:underline">成功</button>}
	                      {r.status === "failed" && <button disabled={retryRun.isPending} onClick={() => retryRun.mutate(r.id)} className="text-xs text-yellow-600 hover:underline disabled:opacity-50">重试</button>}
	                      {!TERMINAL_STATUSES.has(String(r.status)) && <button disabled={cancelRun.isPending} onClick={() => cancelRun.mutate(r.id)} className="text-xs text-slate-600 hover:underline disabled:opacity-50">取消</button>}
	                      <button onClick={() => writeEvidence.mutate(r.id)} className="text-xs text-[var(--brand)] hover:underline">证据</button>
	                      <button onClick={() => deleteRun.mutate(r.id)} className="text-xs text-red-500 hover:underline">删除</button>
	                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </WorkbenchPanel>
      )}

      {tab === "heartbeat" && (
        <WorkbenchPanel title={t("page.agentRuns.heartbeatTitle")} actions={<RefreshButton onClick={() => { void runsQ.refetch(); void summaryQ.refetch(); }} pending={runsQ.isFetching} />}>
          <div className="grid gap-3 lg:grid-cols-2">
            {runningRuns.map((r: any) => (
              <div key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold text-[var(--text)]">{r.agent_id}</p>
                    <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{r.task_id || t("page.agentRuns.unboundTask")}</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{r.status}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-[var(--surface-raised)] p-2">
                    <p className="font-semibold text-[var(--text)]">{r.heartbeat_count ?? 0}</p>
                    <p className="text-[var(--muted)]">{t("page.agentRuns.heartbeatCount")}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-raised)] p-2">
                    <p className="font-semibold text-[var(--text)]">{r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : "—"}</p>
                    <p className="text-[var(--muted)]">{t("page.agentRuns.confidence")}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-raised)] p-2">
                    <p className="font-semibold text-[var(--text)]">{r.updated_at?.slice(11, 19) || "—"}</p>
                    <p className="text-[var(--muted)]">{t("page.agentRuns.lastUpdated")}</p>
                  </div>
                </div>
                <button onClick={() => heartbeat.mutate(r.id)} className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--brand)] hover:bg-[var(--brand-soft)]">{t("page.agentRuns.sendHeartbeat")}</button>
              </div>
            ))}
            {!runningRuns.length && <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)] lg:col-span-2">{t("page.agentRuns.emptyRunning")}</p>}
          </div>
        </WorkbenchPanel>
      )}

      {tab === "profiles" && (
        <WorkbenchPanel title="能力画像" actions={<RefreshButton onClick={() => void profilesQ.refetch()} pending={profilesQ.isFetching} />}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {profiles.length === 0 && <p className="col-span-3 py-8 text-center text-sm text-[var(--muted)]">暂无画像数据</p>}
            {profiles.map((p: any) => (
              <div key={p.agent_id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="font-mono text-xs text-[var(--muted)] mb-2">{p.agent_id}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-lg font-bold text-[var(--text)]">{p.total_runs}</p><p className="text-xs text-[var(--muted)]">总运行</p></div>
                  <div><p className="text-lg font-bold text-green-600">{p.success_rate}%</p><p className="text-xs text-[var(--muted)]">成功率</p></div>
                  <div><p className="text-lg font-bold text-[var(--text)]">{p.avg_duration_s}s</p><p className="text-xs text-[var(--muted)]">平均耗时</p></div>
                </div>
              </div>
            ))}
          </div>
        </WorkbenchPanel>
      )}

      {tab === "retry" && (
        <WorkbenchPanel title={t("page.agentRuns.retryTitle")} actions={<RefreshButton onClick={() => { void runsQ.refetch(); void summaryQ.refetch(); }} pending={runsQ.isFetching} />}>
          <div className="space-y-3">
            {retryRuns.map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-semibold text-[var(--text)]">{r.agent_id}</p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">{r.task_id || t("page.agentRuns.unboundTask")} · retry {r.retry_count ?? 0}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status] ?? ""}`}>{r.status}</span>
                  <button disabled={retryRun.isPending || r.status === "retrying"} onClick={() => retryRun.mutate(r.id)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">{t("page.agentRuns.retryAction")}</button>
                  <button onClick={() => writeEvidence.mutate(r.id)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--brand)]">{t("page.agentRuns.addEvidence")}</button>
                </div>
              </div>
            ))}
            {!retryRuns.length && <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">{t("page.agentRuns.emptyRetry")}</p>}
          </div>
        </WorkbenchPanel>
      )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="agent-runs" title="AI Agent 运行助手" initialPrompt="分析当前 Agent 运行记录，找出失败、超时和重试优化建议" />
    </div>
  );
}
