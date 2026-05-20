import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

type Tab = "pipelines" | "rca" | "runbooks" | "self-heal";

function parseSignals(value: string) {
  const out: Record<string, unknown> = {};
  for (const line of value.split(/\n|,/)) {
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey?.trim();
    const rawValue = rest.join("=").trim();
    if (!key || rawValue === "") continue;
    const n = Number(rawValue);
    out[key] = Number.isFinite(n) && rawValue !== "" ? n : rawValue;
  }
  return out;
}

function severityClass(level?: string) {
  if (level === "critical") return "bg-red-50 text-red-700";
  if (level === "high") return "bg-orange-50 text-orange-700";
  if (level === "medium") return "bg-yellow-50 text-yellow-700";
  return "bg-green-50 text-green-700";
}

export function OpsCenterWorkbench({ focused: _focused, initialTab = "pipelines" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [pForm, setPForm] = useState({ name: "", environment: "staging", steps: "" });
  const [rcaForm, setRcaForm] = useState({ incident_id: "", root_cause: "", impact: "", resolution: "" });
  const [rbForm, setRbForm] = useState({ name: "", steps: "", tags: "" });
  const [shForm, setShForm] = useState({ trigger_condition: "", action: "", enabled: true });
  const [signalText, setSignalText] = useState("cpu=95\nerror_rate=3\nlatency_ms=1200\nenvironment=staging\nservice=api");
  const [healResult, setHealResult] = useState<any>(null);
  const [healTasksResult, setHealTasksResult] = useState<any>(null);

  const summaryQ = useQuery({ queryKey: ["opsCenterSummary"], queryFn: api.opsCenterSummary, enabled: authed });
  const pipQ = useQuery({ queryKey: ["opsPipelines"], queryFn: api.opsPipelines, enabled: authed });
  const rcaQ = useQuery({ queryKey: ["opsRca"], queryFn: api.opsRca, enabled: authed && tab === "rca" });
  const rbQ = useQuery({ queryKey: ["opsRunbooks"], queryFn: api.opsRunbooks, enabled: authed && tab === "runbooks" });
  const shQ = useQuery({ queryKey: ["opsSelfHeal"], queryFn: api.opsSelfHeal, enabled: authed && tab === "self-heal" });
  const evalQ = useQuery({ queryKey: ["opsSelfHealEvaluations"], queryFn: () => api.opsSelfHealEvaluations(20), enabled: authed && tab === "self-heal" });

  const createPip = useMutation({
    mutationFn: () => api.opsPipelineCreate({ name: pForm.name, environment: pForm.environment, steps: pForm.steps.split("\n").filter(Boolean) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["opsPipelines"] }); setShowForm(false); },
  });
  const triggerPip = useMutation({
    mutationFn: (id: string) => api.opsPipelineTrigger(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsPipelines"] }),
  });
  const finishPip = useMutation({
    mutationFn: (id: string) => api.opsPipelineStatus(id, { status: "success", duration_s: 60 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsPipelines"] }),
  });
  const deletePip = useMutation({
    mutationFn: (id: string) => api.opsPipelineDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsPipelines"] }),
  });
  const createRca = useMutation({
    mutationFn: () => api.opsRcaCreate(rcaForm),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["opsRca"] }); setShowForm(false); },
  });
  const resolveRca = useMutation({
    mutationFn: (id: string) => api.opsRcaResolve(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsRca"] }),
  });
  const createRb = useMutation({
    mutationFn: () => api.opsRunbookCreate({ name: rbForm.name, steps: rbForm.steps.split("\n").filter(Boolean), tags: rbForm.tags.split(",").map(s => s.trim()).filter(Boolean) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["opsRunbooks"] }); setShowForm(false); },
  });
  const deleteRb = useMutation({
    mutationFn: (id: string) => api.opsRunbookDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsRunbooks"] }),
  });
  const createSh = useMutation({
    mutationFn: () => api.opsSelfHealCreate(shForm),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["opsSelfHeal"] }); setShowForm(false); },
  });
  const applySh = useMutation({
    mutationFn: (id: string) => api.opsSelfHealApply(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsSelfHeal"] }),
  });
  const evaluateSh = useMutation({
    mutationFn: () => api.opsSelfHealEvaluate({ signals: parseSignals(signalText), persist: true }),
    onSuccess: (data) => {
      setHealResult(data);
      setHealTasksResult(null);
      void qc.invalidateQueries({ queryKey: ["opsSelfHealEvaluations"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const createHealTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.opsSelfHealTasks({
      signals: parseSignals(signalText),
      dry_run: dryRun,
      priority: "P1",
      assigned_to: "Ops Agent",
      dev_tool: "codex",
    }),
    onSuccess: (data) => {
      setHealTasksResult(data);
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const toggleSh = useMutation({
    mutationFn: (s: any) => api.opsSelfHealUpdate(s.id, { trigger_condition: s.trigger_condition, action: s.action, enabled: !s.enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsSelfHeal"] }),
  });
  const deleteSh = useMutation({
    mutationFn: (id: string) => api.opsSelfHealDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsSelfHeal"] }),
  });

  if (!authed) return <NeedLogin />;

  const TABS: { id: Tab; label: string }[] = [
    { id: "pipelines", label: `流水线 (${pipQ.data?.items?.length ?? 0})` },
    { id: "rca", label: "根因分析" },
    { id: "runbooks", label: "Runbook" },
    { id: "self-heal", label: "自愈策略" },
  ];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title="智能运维中心"
        description="部署流水线、根因分析、Runbook 与自愈策略"
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton onClick={() => { void summaryQ.refetch(); void pipQ.refetch(); }} pending={summaryQ.isFetching || pipQ.isFetching} />
          </>
        }
        metrics={
          <WorkbenchStats items={[
            { label: "健康分", value: summaryQ.data?.summary?.health_score ?? 100, trend: (summaryQ.data?.summary?.health_score ?? 100) < 80 ? "down" : "neutral" },
            { label: "失败流水线", value: summaryQ.data?.summary?.pipelines_failed ?? 0, trend: (summaryQ.data?.summary?.pipelines_failed ?? 0) > 0 ? "down" : "neutral" },
            { label: "未关闭 RCA", value: summaryQ.data?.summary?.rca_open ?? 0, trend: (summaryQ.data?.summary?.rca_open ?? 0) > 0 ? "down" : "neutral" },
            { label: "自愈命中", value: summaryQ.data?.summary?.self_heal_matched ?? 0 },
          ]} />
        }
      >
        <div className="flex gap-1 border-b border-[var(--border)] mb-4">
          {TABS.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setShowForm(false); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t.id ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "pipelines" && (
          <WorkbenchPanel title="部署流水线" actions={
            <div className="flex gap-2">
              <AiAssistButton onClick={() => setAiOpen(true)} />
              <RefreshButton onClick={() => void pipQ.refetch()} pending={pipQ.isFetching} />
              <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建</button>
            </div>
          }>
            {showForm && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="input-base" placeholder="流水线名称 *" value={pForm.name} onChange={e => setPForm(f => ({ ...f, name: e.target.value }))} />
                  <select className="input-base" value={pForm.environment} onChange={e => setPForm(f => ({ ...f, environment: e.target.value }))}>
                    {["dev", "staging", "production"].map(e => <option key={e}>{e}</option>)}
                  </select>
                </div>
                <textarea className="input-base w-full h-20 resize-none" placeholder="步骤（每行一个）" value={pForm.steps} onChange={e => setPForm(f => ({ ...f, steps: e.target.value }))} />
                <div className="flex gap-2">
                  <button onClick={() => createPip.mutate()} disabled={!pForm.name || createPip.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {createPip.isPending ? "创建中..." : "创建"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(pipQ.data?.items ?? []).length === 0 && <p className="col-span-3 py-8 text-center text-sm text-[var(--muted)]">暂无流水线</p>}
              {(pipQ.data?.items ?? []).map((p: any) => (
                <div key={p.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-sm">{p.name}</p>
                      <p className="text-xs text-[var(--muted)] mt-0.5">{p.environment}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${p.status === "running" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-500"}`}>{p.status}</span>
                  </div>
	                  <div className="mt-3 flex gap-2">
	                    {p.status !== "running" && <button onClick={() => triggerPip.mutate(p.id)} className="text-xs text-[var(--brand)] hover:underline">触发</button>}
	                    {p.status === "running" && <button onClick={() => finishPip.mutate(p.id)} className="text-xs text-green-600 hover:underline">完成</button>}
	                    <button onClick={() => deletePip.mutate(p.id)} className="text-xs text-red-500 hover:underline">删除</button>
	                  </div>
                </div>
              ))}
            </div>
          </WorkbenchPanel>
        )}

        {tab === "rca" && (
          <WorkbenchPanel title="根因分析" actions={
            <div className="flex gap-2">
              <RefreshButton onClick={() => void rcaQ.refetch()} pending={rcaQ.isFetching} />
              <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建</button>
            </div>
          }>
            {showForm && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="input-base" placeholder="事件 ID *" value={rcaForm.incident_id} onChange={e => setRcaForm(f => ({ ...f, incident_id: e.target.value }))} />
                  <input className="input-base" placeholder="影响范围" value={rcaForm.impact} onChange={e => setRcaForm(f => ({ ...f, impact: e.target.value }))} />
                </div>
                <textarea className="input-base w-full h-16 resize-none" placeholder="根因描述 *" value={rcaForm.root_cause} onChange={e => setRcaForm(f => ({ ...f, root_cause: e.target.value }))} />
                <textarea className="input-base w-full h-16 resize-none" placeholder="解决方案" value={rcaForm.resolution} onChange={e => setRcaForm(f => ({ ...f, resolution: e.target.value }))} />
                <div className="flex gap-2">
                  <button onClick={() => createRca.mutate()} disabled={!rcaForm.incident_id || !rcaForm.root_cause || createRca.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {createRca.isPending ? "创建中..." : "创建"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                </div>
              </div>
            )}
            <div className="space-y-3">
              {(rcaQ.data?.items ?? []).length === 0 && <p className="py-8 text-center text-sm text-[var(--muted)]">暂无根因分析记录</p>}
              {(rcaQ.data?.items ?? []).map((r: any) => (
                <div key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs text-[var(--muted)]">事件: {r.incident_id}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === "open" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{r.status}</span>
                  </div>
	                  <p className="text-sm font-medium">{r.root_cause}</p>
	                  {r.resolution && <p className="mt-1 text-xs text-[var(--muted)]">解决方案: {r.resolution}</p>}
	                  {r.status === "open" && <button onClick={() => resolveRca.mutate(r.id)} className="mt-2 text-xs text-[var(--brand)] hover:underline">标记已解决</button>}
	                </div>
              ))}
            </div>
          </WorkbenchPanel>
        )}

        {tab === "runbooks" && (
          <WorkbenchPanel title="Runbook 管理" actions={
            <div className="flex gap-2">
              <RefreshButton onClick={() => void rbQ.refetch()} pending={rbQ.isFetching} />
              <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建</button>
            </div>
          }>
            {showForm && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="input-base" placeholder="Runbook 名称 *" value={rbForm.name} onChange={e => setRbForm(f => ({ ...f, name: e.target.value }))} />
                  <input className="input-base" placeholder="标签 (逗号分隔)" value={rbForm.tags} onChange={e => setRbForm(f => ({ ...f, tags: e.target.value }))} />
                </div>
                <textarea className="input-base w-full h-24 resize-none" placeholder="操作步骤（每行一步）" value={rbForm.steps} onChange={e => setRbForm(f => ({ ...f, steps: e.target.value }))} />
                <div className="flex gap-2">
                  <button onClick={() => createRb.mutate()} disabled={!rbForm.name || createRb.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {createRb.isPending ? "创建中..." : "创建"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {(rbQ.data?.items ?? []).length === 0 && <p className="col-span-2 py-8 text-center text-sm text-[var(--muted)]">暂无 Runbook</p>}
              {(rbQ.data?.items ?? []).map((r: any) => (
                <div key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
	                  <p className="font-semibold text-sm">{r.name}</p>
	                  {r.tags?.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{r.tags.map((t: string) => <span key={t} className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-xs text-[var(--brand)]">{t}</span>)}</div>}
	                  <p className="mt-2 text-xs text-[var(--muted)]">{r.steps?.length ?? 0} 个步骤</p>
	                  <button onClick={() => deleteRb.mutate(r.id)} className="mt-3 text-xs text-red-500 hover:underline">删除</button>
	                </div>
              ))}
            </div>
          </WorkbenchPanel>
        )}

        {tab === "self-heal" && (
          <div className="grid gap-4 xl:grid-cols-[minmax(420px,1fr)_minmax(420px,1fr)]">
            <WorkbenchPanel title="策略目录与信号评估" actions={
              <div className="flex gap-2">
                <RefreshButton onClick={() => { void shQ.refetch(); void evalQ.refetch(); }} pending={shQ.isFetching || evalQ.isFetching} />
                <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建</button>
              </div>
            }>
              {showForm && (
                <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                  <input className="input-base w-full" placeholder="触发条件 * (如 cpu > 90)" value={shForm.trigger_condition} onChange={e => setShForm(f => ({ ...f, trigger_condition: e.target.value }))} />
                  <input className="input-base w-full" placeholder="自愈动作 * (如 restart_service api)" value={shForm.action} onChange={e => setShForm(f => ({ ...f, action: e.target.value }))} />
                  <div className="flex gap-2">
                    <button onClick={() => createSh.mutate()} disabled={!shForm.trigger_condition || !shForm.action || createSh.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                      {createSh.isPending ? "创建中..." : "创建"}
                    </button>
                    <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <textarea
                  className="input-base min-h-32 w-full font-mono text-xs"
                  value={signalText}
                  onChange={e => setSignalText(e.target.value)}
                  placeholder={"cpu=95\nerror_rate=3\nlatency_ms=1200\nenvironment=staging"}
                />
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => evaluateSh.mutate()} disabled={evaluateSh.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {evaluateSh.isPending ? "评估中..." : "评估自愈决策"}
                  </button>
                  <button onClick={() => createHealTasks.mutate(true)} disabled={createHealTasks.isPending} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">
                    预览治理任务
                  </button>
                  <button onClick={() => createHealTasks.mutate(false)} disabled={createHealTasks.isPending} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm text-[var(--brand)]">
                    生成治理任务
                  </button>
                </div>
                {evaluateSh.isError ? <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{(evaluateSh.error as Error).message}</p> : null}
              </div>

              <div className="mt-4 space-y-3">
                {(shQ.data?.items ?? []).length === 0 && <p className="py-8 text-center text-sm text-[var(--muted)]">暂无自愈策略</p>}
                {(shQ.data?.items ?? []).map((s: any) => (
                  <div key={s.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{s.trigger_condition}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">→ {s.action}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${s.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{s.enabled ? "启用" : "禁用"}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => applySh.mutate(s.id)} className="text-xs text-[var(--brand)] hover:underline">手动应用</button>
                      <button onClick={() => toggleSh.mutate(s)} className="text-xs text-[var(--brand)] hover:underline">{s.enabled ? "停用" : "启用"}</button>
                      <button onClick={() => deleteSh.mutate(s.id)} className="text-xs text-red-500 hover:underline">删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </WorkbenchPanel>

            <WorkbenchPanel title="自愈决策与任务化">
              <div className="space-y-4">
                {healResult ? (
                  <div className="grid gap-2 sm:grid-cols-4">
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">命中</p><p className="text-lg font-semibold">{healResult.summary?.matched ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">待审批</p><p className="text-lg font-semibold">{healResult.summary?.needs_approval ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">高风险</p><p className="text-lg font-semibold">{(healResult.summary?.critical ?? 0) + (healResult.summary?.high ?? 0)}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">策略数</p><p className="text-lg font-semibold">{healResult.summary?.policies ?? 0}</p></div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-center text-sm text-[var(--muted)]">输入信号并评估后，会展示命中的自愈决策。</div>
                )}

                <div className="space-y-3">
                  {(healResult?.decisions ?? []).map((d: any) => (
                    <div key={`${d.policy_id}-${d.trigger_condition}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{d.trigger_condition}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">{d.action}</p>
                        </div>
                        <span className={`rounded px-2 py-0.5 text-xs ${severityClass(d.risk_level)}`}>{d.risk_level} · {d.decision}</span>
                      </div>
                      <ol className="mt-3 space-y-1 text-xs text-[var(--muted-strong)]">
                        {(d.steps ?? []).map((step: any) => <li key={step.id}>- {step.title}</li>)}
                      </ol>
                    </div>
                  ))}
                </div>

                {healTasksResult ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-semibold">{healTasksResult.dry_run ? "治理任务预览" : "治理任务已生成"} · {healTasksResult.items?.length ?? 0}</p>
                    <div className="mt-3 space-y-2">
                      {(healTasksResult.items ?? []).slice(0, 5).map((item: any) => (
                        <div key={item.id ?? item.title} className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">{item.priority} · {item.assigned_to}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div>
                  <p className="mb-2 text-sm font-semibold">最近评估</p>
                  <div className="space-y-2">
                    {(evalQ.data?.items ?? []).slice(0, 5).map((item: any) => (
                      <div key={item.id} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
                        <span className="font-medium">{item.created_at?.slice(0, 19).replace("T", " ")}</span>
                        <span className="ml-2 text-[var(--muted)]">命中 {item.summary?.matched ?? 0}，待审批 {item.summary?.needs_approval ?? 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </WorkbenchPanel>
          </div>
        )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="ops-center" title="AI 智能助手" initialPrompt="分析当前运维状态，建议优化自愈策略" />
      </WorkbenchShell>
    </div>
  );
}
