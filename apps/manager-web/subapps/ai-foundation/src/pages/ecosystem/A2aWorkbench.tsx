import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

type Tab = "health" | "registry" | "negotiate" | "dispatches" | "evidence";

const AGENT_TYPES = ["workbuddy", "openclaw", "hermes_agent", "custom"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];

function splitList(value: string) {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function badgeClass(level: string) {
  if (level === "critical" || level === "high") return "bg-red-50 text-red-700 ring-red-100";
  if (level === "medium") return "bg-amber-50 text-amber-700 ring-amber-100";
  if (level === "low") return "bg-slate-100 text-slate-600 ring-slate-200";
  return "bg-emerald-50 text-emerald-700 ring-emerald-100";
}

export function A2aWorkbench({ focused: _focused, initialTab = "health" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [regForm, setRegForm] = useState({ name: "", agent_type: "custom", endpoint: "", capabilities: "code.review, test.automation" });
  const [negForm, setNegForm] = useState({ task_type: "code_review", task_description: "Review API security and SQL access risk", required_capabilities: "code.review, security.audit", priority: "P1" });
  const [negResult, setNegResult] = useState<any>(null);
  const [packetPreview, setPacketPreview] = useState<any>(null);
  const [taskResult, setTaskResult] = useState<any>(null);

  const healthQ = useQuery({ queryKey: ["a2aHealth"], queryFn: api.a2aHealth, enabled: authed });
  const registryQ = useQuery({ queryKey: ["a2aRegistry"], queryFn: () => api.a2aRegistry(), enabled: authed });
  const dispatchQ = useQuery({ queryKey: ["a2aDispatches"], queryFn: () => api.a2aDispatches(), enabled: authed && (tab === "dispatches" || tab === "evidence") });
  const evidenceQ = useQuery({ queryKey: ["a2aEvidence"], queryFn: () => api.a2aEvidence(), enabled: authed && tab === "evidence" });

  const summary = healthQ.data?.summary ?? {};
  const agents = registryQ.data?.items ?? [];
  const risks = summary.risks ?? [];
  const topCapabilities = summary.capability_coverage?.top_capabilities ?? [];

  const agentById = useMemo(() => {
    const map = new Map<string, any>();
    agents.forEach((agent: any) => map.set(agent.id, agent));
    return map;
  }, [agents]);

  const register = useMutation({
    mutationFn: () => api.a2aRegister({
      ...regForm,
      capabilities: splitList(regForm.capabilities),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["a2aRegistry"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
      setShowForm(false);
    },
  });
  const deregister = useMutation({
    mutationFn: (id: string) => api.a2aDeregister(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["a2aRegistry"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
    },
  });
  const pauseAgent = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.a2aAgentStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["a2aRegistry"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
    },
  });
  const negotiate = useMutation({
    mutationFn: () => api.a2aNegotiate({
      task_type: negForm.task_type,
      task_description: negForm.task_description,
      required_capabilities: splitList(negForm.required_capabilities),
      priority: negForm.priority,
    }),
    onSuccess: (data) => setNegResult(data),
  });
  const dispatch = useMutation({
    mutationFn: (agentId: string) => api.a2aDispatch({
      agent_id: agentId,
      task_id: `manual-${Date.now()}`,
      payload: {
        source: "manager-web",
        task_type: negForm.task_type,
        task_description: negForm.task_description,
        required_capabilities: splitList(negForm.required_capabilities),
        priority: negForm.priority,
      },
    }),
    onSuccess: (data) => {
      setPacketPreview(data.protocol_packet ?? null);
      void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
      setTab("dispatches");
    },
  });
  const evidence = useMutation({
    mutationFn: (dispatchId: string) => api.a2aReceiveEvidence({
      dispatch_id: dispatchId,
      status: "success",
      artifact: { summary: "manual evidence from manager-web", links: [], files: [] },
      confidence: 0.95,
      quality_gate_results: [
        { id: "evidence.required", passed: true, detail: "manual evidence submitted" },
        { id: "confidence.minimum", passed: true, detail: "confidence 0.95" },
      ],
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
      void qc.invalidateQueries({ queryKey: ["a2aEvidence"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
    },
  });
  const previewPacket = useMutation({
    mutationFn: (dispatchId: string) => api.a2aDispatchPacket(dispatchId),
    onSuccess: (data) => setPacketPreview(data.packet),
  });
  const governanceTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.a2aGovernanceTasks({ dry_run: dryRun, assigned_to: "Agent Platform", dev_tool: "codex" }),
    onSuccess: (data) => {
      setTaskResult(data);
      if (!data.dry_run) void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
    },
  });

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title="A2A 网关"
        description="标准 A2A 协议：注册、能力协商、协议包分发、执行证据与治理任务"
        actions={<><AiAssistButton onClick={() => setAiOpen(true)} />
          <RefreshButton onClick={() => { void registryQ.refetch(); void healthQ.refetch(); void dispatchQ.refetch(); }} pending={registryQ.isFetching || healthQ.isFetching} /></>}
        metrics={
          <WorkbenchStats items={[
            { label: "协议健康分", value: summary.health_score ?? 0, trend: (summary.health_score ?? 0) >= 80 ? "up" : "down" },
            { label: "已注册 Agent", value: summary.registered_agents ?? 0 },
            { label: "活跃", value: summary.active ?? 0, trend: "up" },
            { label: "待证据回写", value: summary.pending_evidence ?? 0 },
          ]} />
        }
      />

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {(["health", "registry", "negotiate", "dispatches", "evidence"] as Tab[]).map((item) => (
          <button key={item} onClick={() => setTab(item)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === item ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
            {item === "health" ? "协议健康" : item === "registry" ? `Agent 注册 (${agents.length})` : item === "negotiate" ? "能力协商" : item === "dispatches" ? "任务分发" : "执行证据"}
          </button>
        ))}
      </div>

      {tab === "health" && (
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <WorkbenchPanel title="协议健康与风险">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">健康分</div>
                <div className="mt-1 text-3xl font-semibold">{summary.health_score ?? 0}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">证据回写</div>
                <div className="mt-1 text-3xl font-semibold">{summary.evidence_received ?? 0}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">失败执行</div>
                <div className="mt-1 text-3xl font-semibold">{summary.failed ?? 0}</div>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {risks.length === 0 ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">当前 A2A 协议运行健康，暂无治理风险。</p> : null}
              {risks.map((risk: any, index: number) => (
                <div key={`${risk.title}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{risk.title}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{risk.recommendation}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(risk.level)}`}>{risk.level}</span>
                  </div>
                </div>
              ))}
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="能力覆盖与治理任务" actions={
            <div className="flex gap-2">
              <button onClick={() => governanceTasks.mutate(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">预览任务</button>
              <button onClick={() => governanceTasks.mutate(false)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white">生成任务</button>
            </div>
          }>
            <div className="space-y-2">
              {topCapabilities.length === 0 ? <p className="text-sm text-[var(--muted)]">暂无能力画像，注册 Agent 后将展示覆盖情况。</p> : null}
              {topCapabilities.map((item: any) => (
                <div key={item.capability} className="flex items-center justify-between rounded-lg bg-[var(--surface-muted)] px-3 py-2">
                  <span className="font-mono text-xs">{item.capability}</span>
                  <span className="text-xs text-[var(--muted)]">{item.agents} Agent</span>
                </div>
              ))}
            </div>
            {taskResult ? (
              <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-sm font-semibold">{taskResult.dry_run ? "治理任务预览" : "治理任务已生成"}</p>
                <div className="mt-2 space-y-2">
                  {(taskResult.items ?? []).map((item: any) => (
                    <div key={item.source_report_id} className="rounded-md bg-[var(--surface-muted)] px-3 py-2 text-xs">
                      <span className="font-semibold">{item.priority}</span> · {item.title}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </WorkbenchPanel>
        </div>
      )}

      {tab === "registry" && (
        <WorkbenchPanel title="已注册 Agent" actions={
          <button onClick={() => setShowForm((value) => !value)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 注册 Agent</button>
        }>
          {showForm && (
            <div className="mb-4 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input-base" placeholder="Agent 名称 *" value={regForm.name} onChange={(event) => setRegForm((form) => ({ ...form, name: event.target.value }))} />
                <select className="input-base" value={regForm.agent_type} onChange={(event) => setRegForm((form) => ({ ...form, agent_type: event.target.value }))}>
                  {AGENT_TYPES.map((item) => <option key={item}>{item}</option>)}
                </select>
                <input className="input-base" placeholder="Endpoint URL" value={regForm.endpoint} onChange={(event) => setRegForm((form) => ({ ...form, endpoint: event.target.value }))} />
                <input className="input-base" placeholder="能力列表 (逗号分隔)" value={regForm.capabilities} onChange={(event) => setRegForm((form) => ({ ...form, capabilities: event.target.value }))} />
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
            {agents.length === 0 ? <p className="col-span-3 py-8 text-center text-sm text-[var(--muted)]">暂无注册 Agent</p> : null}
            {agents.map((agent: any) => (
              <div key={agent.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-sm">{agent.name}</p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">{agent.agent_type}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${agent.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{agent.status}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(agent.capabilities ?? []).slice(0, 6).map((capability: string) => (
                    <span key={capability} className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-xs text-[var(--brand)]">{capability}</span>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => pauseAgent.mutate({ id: agent.id, status: agent.status === "active" ? "paused" : "active" })} className="text-xs text-[var(--brand)] hover:underline">{agent.status === "active" ? "暂停" : "启用"}</button>
                  <button onClick={() => deregister.mutate(agent.id)} className="text-xs text-red-500 hover:underline">注销</button>
                </div>
              </div>
            ))}
          </div>
        </WorkbenchPanel>
      )}

      {tab === "negotiate" && (
        <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <WorkbenchPanel title="任务能力协商">
            <div className="space-y-3">
              <input className="input-base w-full" placeholder="任务类型 *" value={negForm.task_type} onChange={(event) => setNegForm((form) => ({ ...form, task_type: event.target.value }))} />
              <textarea className="input-base min-h-24 w-full" placeholder="任务描述" value={negForm.task_description} onChange={(event) => setNegForm((form) => ({ ...form, task_description: event.target.value }))} />
              <input className="input-base w-full" placeholder="所需能力 (逗号分隔)" value={negForm.required_capabilities} onChange={(event) => setNegForm((form) => ({ ...form, required_capabilities: event.target.value }))} />
              <select className="input-base w-full" value={negForm.priority} onChange={(event) => setNegForm((form) => ({ ...form, priority: event.target.value }))}>
                {PRIORITIES.map((item) => <option key={item}>{item}</option>)}
              </select>
              <button onClick={() => negotiate.mutate()} disabled={!negForm.task_type || negotiate.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                {negotiate.isPending ? "协商中..." : "开始协商"}
              </button>
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="匹配解释与分发">
            {!negResult ? <p className="text-sm text-[var(--muted)]">填写任务类型和能力后开始协商，系统会按能力覆盖、成功率、负载和风险给出推荐。</p> : null}
            {negResult ? (
              <div className="space-y-3">
                <p className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm">{negResult.recommendation}</p>
                {(negResult.matches ?? []).map((match: any) => (
                  <div key={match.agent_id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{match.name || match.agent_id}</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{match.reason}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(match.risk_level)}`}>{match.risk_level}</span>
                        <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{(match.confidence * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(match.matched_capabilities ?? []).map((capability: string) => <span key={capability} className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">{capability}</span>)}
                      {(match.missing_capabilities ?? []).map((capability: string) => <span key={capability} className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">缺 {capability}</span>)}
                    </div>
                    <button onClick={() => dispatch.mutate(match.agent_id)} className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--brand)]">分发并生成协议包</button>
                  </div>
                ))}
              </div>
            ) : null}
          </WorkbenchPanel>
        </div>
      )}

      {tab === "dispatches" && (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <WorkbenchPanel title="分发记录">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4">Agent</th><th className="pb-2 pr-4">任务</th><th className="pb-2 pr-4">状态</th><th className="pb-2 pr-4">分发时间</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
                  {(dispatchQ.data?.items ?? []).length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-[var(--muted)]">暂无分发记录</td></tr> : null}
                  {(dispatchQ.data?.items ?? []).map((item: any) => (
                    <tr key={item.id} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-4">
                        <p className="text-xs font-medium">{agentById.get(item.agent_id)?.name ?? item.agent_id?.slice(0, 12)}</p>
                        <p className="font-mono text-[10px] text-[var(--muted)]">{item.agent_id}</p>
                      </td>
                      <td className="py-2 pr-4">{item.task_id}</td>
                      <td className="py-2 pr-4">{item.status}</td>
                      <td className="py-2 pr-4 text-xs text-[var(--muted)]">{item.dispatched_at?.slice(0, 19).replace("T", " ")}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => previewPacket.mutate(item.id)} className="text-xs text-[var(--brand)] hover:underline">协议包</button>
                          {!item.evidence_at ? <button onClick={() => evidence.mutate(item.id)} className="text-xs text-[var(--brand)] hover:underline">回写证据</button> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </WorkbenchPanel>
          <WorkbenchPanel title="协议包预览">
            {!packetPreview ? <p className="text-sm text-[var(--muted)]">选择一条分发记录查看 Hermes A2A 协议包。</p> : null}
            {packetPreview ? <pre className="max-h-[520px] overflow-auto rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5">{JSON.stringify(packetPreview, null, 2)}</pre> : null}
          </WorkbenchPanel>
        </div>
      )}

      {tab === "evidence" && (
        <WorkbenchPanel title="执行证据与质量">
          <div className="grid gap-3 lg:grid-cols-2">
            {(evidenceQ.data?.items ?? []).length === 0 ? <p className="text-sm text-[var(--muted)]">暂无证据回写。</p> : null}
            {(evidenceQ.data?.items ?? []).map((item: any) => (
              <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{item.task_id}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{agentById.get(item.agent_id)?.name ?? item.agent_id}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(item.evidence_quality?.status === "complete" ? "ok" : "medium")}`}>质量 {item.evidence_quality?.score ?? 0}</span>
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">状态：{item.status} · 置信度：{Math.round((item.confidence ?? 0) * 100)}%</p>
                {item.evidence_quality?.missing?.length ? <p className="mt-2 text-xs text-amber-700">缺失：{item.evidence_quality.missing.join(", ")}</p> : null}
                <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--surface-muted)] p-2 text-[11px]">{JSON.stringify(item.artifact ?? {}, null, 2)}</pre>
              </div>
            ))}
          </div>
        </WorkbenchPanel>
      )}

      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="a2a-gateway" title="AI 智能助手" initialPrompt="分析 A2A 协议健康、能力覆盖、协商风险和治理任务建议" />
    </div>
  );
}
