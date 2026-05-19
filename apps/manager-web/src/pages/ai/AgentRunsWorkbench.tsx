import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { NeedLogin, RefreshButton, SearchInput } from "../../components/PageStates";
import { AiAssistButton, AiAssistDrawer } from "../../components/ai/AiAssistDrawer";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  running: "bg-blue-50 text-blue-700",
  success: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  retrying: "bg-yellow-50 text-yellow-700",
};

export function AgentRunsWorkbench({ focused: _focused, initialTab = "runs" }: { focused?: boolean; initialTab?: "runs" | "profiles" }) {
  const authed = Boolean(getToken());
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"runs" | "profiles">(initialTab);

  const summaryQ = useQuery({ queryKey: ["agentRunsSummaryV2"], queryFn: api.agentRunsSummaryV2, enabled: authed });
  const runsQ = useQuery({ queryKey: ["agentRunsList", statusFilter], queryFn: () => api.agentRunsList("", statusFilter), enabled: authed });
  const profilesQ = useQuery({ queryKey: ["agentRunProfiles"], queryFn: api.agentRunProfiles, enabled: authed && tab === "profiles" });

  const heartbeat = useMutation({
    mutationFn: (id: string) => api.agentRunHeartbeat(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agentRunsList"] }),
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.agentRunStatus(id, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agentRunsList", statusFilter] }),
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
        {(["runs", "profiles"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
            {t === "runs" ? "运行列表" : "能力画像"}
          </button>
        ))}
      </div>

      {tab === "runs" && (
        <WorkbenchPanel title="运行记录" actions={
	          <div className="flex gap-2">
	            <SearchInput value={q} onChange={setQ} placeholder="搜索 Agent/Task ID..." />
	            <select className="input-base text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
	              {["pending", "running", "success", "failed", "retrying"].map(s => <option key={s}>{s}</option>)}
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
	                      {r.status === "failed" && <button onClick={() => updateStatus.mutate({ id: r.id, status: "retrying" })} className="text-xs text-yellow-600 hover:underline">重试</button>}
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
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="agent-runs" title="AI Agent 运行助手" initialPrompt="分析当前 Agent 运行记录，找出失败、超时和重试优化建议" />
    </div>
  );
}
