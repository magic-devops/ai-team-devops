import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";
import { AiAssistButton, AiAssistDrawer } from "../../components/ai/AiAssistDrawer";
import { getToken } from "../../lib/authStorage";
import { NeedLogin, RefreshButton } from "../../components/PageStates";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

type Tab = "registry" | "negotiate" | "dispatches";
const AGENT_TYPES = ["workbuddy", "openclaw", "hermes_agent", "custom"];

export function A2aWorkbench({ focused: _focused, initialTab = "registry" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [regForm, setRegForm] = useState({ name: "", agent_type: "custom", endpoint: "", capabilities: "" });
  const [negForm, setNegForm] = useState({ task_type: "", task_description: "", required_capabilities: "" });
  const [negResult, setNegResult] = useState<any>(null);

  const summaryQ = useQuery({ queryKey: ["a2aSummary"], queryFn: api.a2aSummary, enabled: authed });
  const registryQ = useQuery({ queryKey: ["a2aRegistry"], queryFn: () => api.a2aRegistry(), enabled: authed });
  const dispatchQ = useQuery({ queryKey: ["a2aDispatches"], queryFn: () => api.a2aDispatches(), enabled: authed && tab === "dispatches" });

  const register = useMutation({
    mutationFn: () => api.a2aRegister({
      ...regForm,
      capabilities: regForm.capabilities.split(",").map(s => s.trim()).filter(Boolean),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["a2aRegistry"] }); setShowForm(false); },
  });
  const deregister = useMutation({
    mutationFn: (id: string) => api.a2aDeregister(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["a2aRegistry"] }),
  });
  const pauseAgent = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.a2aAgentStatus(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["a2aRegistry"] }),
  });
  const negotiate = useMutation({
    mutationFn: () => api.a2aNegotiate({
      task_type: negForm.task_type,
      task_description: negForm.task_description,
      required_capabilities: negForm.required_capabilities.split(",").map(s => s.trim()).filter(Boolean),
    }),
    onSuccess: (data) => setNegResult(data),
  });
  const dispatch = useMutation({
    mutationFn: (agentId: string) => api.a2aDispatch({ agent_id: agentId, task_id: `manual-${Date.now()}`, payload: { source: "manager-web", task_type: negForm.task_type } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["a2aDispatches"] }); setTab("dispatches"); },
  });
  const evidence = useMutation({
    mutationFn: (dispatchId: string) => api.a2aReceiveEvidence({ dispatch_id: dispatchId, status: "success", artifact: { note: "manual evidence from manager-web" }, confidence: 0.95 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["a2aDispatches"] }),
  });

  if (!authed) return <NeedLogin />;
  const s = summaryQ.data?.summary ?? {};
  const agents = registryQ.data?.items ?? [];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title="A2A 网关"
        description="标准 A2A 协议：外部 Agent 注册、能力协商与任务分发"
        actions={<><AiAssistButton onClick={() => setAiOpen(true)} />
              <RefreshButton onClick={() => { void registryQ.refetch(); void summaryQ.refetch(); }} pending={registryQ.isFetching} /></>}
        metrics={
          <WorkbenchStats items={[
            { label: "已注册 Agent", value: s.registered_agents ?? 0 },
            { label: "活跃", value: s.active ?? 0, trend: "up" },
            { label: "已分发任务", value: s.dispatched_tasks ?? 0 },
            { label: "证据回写", value: s.evidence_received ?? 0 },
          ]} />
        }
      />

      <div className="flex gap-1 border-b border-[var(--border)]">
        {(["registry", "negotiate", "dispatches"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
            {t === "registry" ? `Agent 注册 (${agents.length})` : t === "negotiate" ? "能力协商" : "分发记录"}
          </button>
        ))}
      </div>

      {tab === "registry" && (
        <WorkbenchPanel title="已注册 Agent" actions={
          <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 注册 Agent</button>
        }>
          {showForm && (
            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input-base" placeholder="Agent 名称 *" value={regForm.name} onChange={e => setRegForm(f => ({ ...f, name: e.target.value }))} />
                <select className="input-base" value={regForm.agent_type} onChange={e => setRegForm(f => ({ ...f, agent_type: e.target.value }))}>
                  {AGENT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <input className="input-base" placeholder="Endpoint URL" value={regForm.endpoint} onChange={e => setRegForm(f => ({ ...f, endpoint: e.target.value }))} />
                <input className="input-base" placeholder="能力列表 (逗号分隔)" value={regForm.capabilities} onChange={e => setRegForm(f => ({ ...f, capabilities: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => register.mutate()} disabled={!regForm.name || register.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                  {register.isPending ? "注册中..." : "注册"}
                </button>
                <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {agents.length === 0 && <p className="col-span-3 py-8 text-center text-sm text-[var(--muted)]">暂无注册 Agent</p>}
            {agents.map((a: any) => (
              <div key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-sm">{a.name}</p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">{a.agent_type}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${a.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{a.status}</span>
                </div>
                {a.capabilities?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.capabilities.slice(0, 4).map((c: string) => (
                      <span key={c} className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-xs text-[var(--brand)]">{c}</span>
                    ))}
                  </div>
                )}
	                <div className="mt-3 flex gap-2">
	                  <button onClick={() => pauseAgent.mutate({ id: a.id, status: a.status === "active" ? "paused" : "active" })} className="text-xs text-[var(--brand)] hover:underline">{a.status === "active" ? "暂停" : "启用"}</button>
	                  <button onClick={() => deregister.mutate(a.id)} className="text-xs text-red-500 hover:underline">注销</button>
	                </div>
              </div>
            ))}
          </div>
        </WorkbenchPanel>
      )}

      {tab === "negotiate" && (
        <WorkbenchPanel title="能力协商">
          <div className="space-y-3 max-w-lg">
            <input className="input-base w-full" placeholder="任务类型 * (如 code_review, data_analysis)" value={negForm.task_type} onChange={e => setNegForm(f => ({ ...f, task_type: e.target.value }))} />
            <input className="input-base w-full" placeholder="任务描述" value={negForm.task_description} onChange={e => setNegForm(f => ({ ...f, task_description: e.target.value }))} />
            <input className="input-base w-full" placeholder="所需能力 (逗号分隔)" value={negForm.required_capabilities} onChange={e => setNegForm(f => ({ ...f, required_capabilities: e.target.value }))} />
            <button onClick={() => negotiate.mutate()} disabled={!negForm.task_type || negotiate.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
              {negotiate.isPending ? "协商中..." : "开始协商"}
            </button>
          </div>
          {negResult && (
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <p className="text-sm font-semibold mb-3">匹配结果</p>
              {negResult.matches?.length === 0 && <p className="text-sm text-[var(--muted)]">无匹配 Agent</p>}
              {negResult.matches?.map((m: any, i: number) => (
                <div key={m.agent_id} className={`flex items-center justify-between py-2 ${i > 0 ? "border-t border-[var(--border)]" : ""}`}>
                  <span className="text-sm font-mono">{m.name || m.agent_id?.slice(0, 12)}</span>
	                  <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">置信度 {(m.confidence * 100).toFixed(0)}%</span>
	                  <button onClick={() => dispatch.mutate(m.agent_id)} className="ml-2 text-xs text-[var(--brand)] hover:underline">分发任务</button>
	                </div>
              ))}
            </div>
          )}
        </WorkbenchPanel>
      )}

	      {tab === "dispatches" && (
	        <WorkbenchPanel title="分发记录">
	          <div className="overflow-x-auto">
	            <table className="w-full text-sm">
	              <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
	                <th className="pb-2 pr-4">Agent</th><th className="pb-2 pr-4">任务</th><th className="pb-2 pr-4">状态</th><th className="pb-2 pr-4">分发时间</th><th className="pb-2">操作</th>
	              </tr></thead>
	              <tbody>
	                {(dispatchQ.data?.items ?? []).length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[var(--muted)]">暂无分发记录</td></tr>}
	                {(dispatchQ.data?.items ?? []).map((d: any) => (
	                  <tr key={d.id} className="border-b border-[var(--border)]">
	                    <td className="py-2 pr-4 font-mono text-xs">{d.agent_id?.slice(0, 12)}...</td>
	                    <td className="py-2 pr-4">{d.task_id}</td>
	                    <td className="py-2 pr-4">{d.status}</td>
	                    <td className="py-2 pr-4 text-xs text-[var(--muted)]">{d.dispatched_at?.slice(0, 19).replace("T", " ")}</td>
	                    <td className="py-2">{!d.evidence_at && <button onClick={() => evidence.mutate(d.id)} className="text-xs text-[var(--brand)] hover:underline">回写证据</button>}</td>
	                  </tr>
	                ))}
	              </tbody>
	            </table>
	          </div>
	        </WorkbenchPanel>
	      )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="a2a-gateway" title="AI 智能助手" initialPrompt="分析已注册 Agent 的能力分布，建议优化任务分发策略" />
    </div>
  );
}
