import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";

type Tab = "routes" | "cost" | "throttle";

export function LlmGatewayWorkbench({ focused: _focused, initialTab = "routes" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [rForm, setRForm] = useState({ name: "", task_type: "general", model_id: "", priority: 0, fallback_model_id: "", enabled: true });
  const [tForm, setTForm] = useState({ model_id: "", rpm_limit: 60, tpm_limit: 100000, enabled: true });
  const [usageForm, setUsageForm] = useState({ model_id: "", prompt_tokens: 1000, completion_tokens: 500, cost_usd: 0.01, latency_ms: 800, task_type: "general" });

  const summaryQ = useQuery({ queryKey: ["llmGatewaySummary"], queryFn: api.llmGatewaySummary, enabled: authed });
  const routesQ = useQuery({ queryKey: ["llmRoutes"], queryFn: api.llmRoutes, enabled: authed });
  const costQ = useQuery({ queryKey: ["llmCostStats"], queryFn: () => api.llmCostStats(), enabled: authed && tab === "cost" });
  const throttleQ = useQuery({ queryKey: ["llmThrottle"], queryFn: api.llmThrottle, enabled: authed && tab === "throttle" });

  const createRoute = useMutation({
    mutationFn: () => api.llmRouteCreate(rForm),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["llmRoutes"] }); setShowForm(false); },
  });
  const createThrottle = useMutation({
    mutationFn: () => api.llmThrottleCreate(tForm),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["llmThrottle"] }); setShowForm(false); },
  });
  const deleteRoute = useMutation({
    mutationFn: (id: string) => api.llmRouteDelete(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["llmRoutes"] }); void qc.invalidateQueries({ queryKey: ["llmGatewaySummary"] }); },
  });
  const recordCost = useMutation({
    mutationFn: () => api.llmRecordCost(usageForm),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["llmCostStats"] }); void qc.invalidateQueries({ queryKey: ["llmGatewaySummary"] }); },
  });
  const deleteThrottle = useMutation({
    mutationFn: (id: string) => api.llmThrottleDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["llmThrottle"] }),
  });

  if (!authed) return <NeedLogin />;
  const s = summaryQ.data?.summary ?? {};
  const routes = routesQ.data?.items ?? [];
  const throttles = throttleQ.data?.items ?? [];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title="模型网关"
        description="统一 LLM 路由、成本控制与限流策略管理"
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton onClick={() => { void routesQ.refetch(); void summaryQ.refetch(); }} pending={routesQ.isFetching} />
          </>
        }
        metrics={
          <WorkbenchStats items={[
            { label: "总请求数", value: s.total_requests ?? 0 },
            { label: "总 Token", value: s.total_tokens ?? 0 },
            { label: "总费用($)", value: s.total_cost_usd ?? 0 },
            { label: "活跃路由", value: s.active_routes ?? routes.filter((r: any) => r.enabled).length },
          ]} />
        }
      />

      <div className="flex gap-1 border-b border-[var(--border)]">
        {(["routes", "cost", "throttle"] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setShowForm(false); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
            {t === "routes" ? `路由规则 (${routes.length})` : t === "cost" ? "成本统计" : "限流策略"}
          </button>
        ))}
      </div>

      {tab === "routes" && (
        <WorkbenchPanel title="模型路由规则" actions={
          <div className="flex gap-2">
            <RefreshButton onClick={() => void routesQ.refetch()} pending={routesQ.isFetching} />
            <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建路由</button>
          </div>
        }>
          {showForm && (
            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input-base" placeholder="路由名称 *" value={rForm.name} onChange={e => setRForm(f => ({ ...f, name: e.target.value }))} />
                <input className="input-base" placeholder="任务类型 (如 code, analysis)" value={rForm.task_type} onChange={e => setRForm(f => ({ ...f, task_type: e.target.value }))} />
                <input className="input-base" placeholder="主模型 ID * (如 claude-3-5-sonnet)" value={rForm.model_id} onChange={e => setRForm(f => ({ ...f, model_id: e.target.value }))} />
                <input className="input-base" placeholder="备用模型 ID" value={rForm.fallback_model_id} onChange={e => setRForm(f => ({ ...f, fallback_model_id: e.target.value }))} />
                <input className="input-base" type="number" placeholder="优先级" value={rForm.priority} onChange={e => setRForm(f => ({ ...f, priority: Number(e.target.value) }))} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={rForm.enabled} onChange={e => setRForm(f => ({ ...f, enabled: e.target.checked }))} />
                  启用
                </label>
              </div>
              <div className="flex gap-2">
                <button onClick={() => createRoute.mutate()} disabled={!rForm.name || !rForm.model_id || createRoute.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                  {createRoute.isPending ? "创建中..." : "创建"}
                </button>
                <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
	                <th className="pb-2 pr-4">路由名称</th><th className="pb-2 pr-4">任务类型</th><th className="pb-2 pr-4">主模型</th><th className="pb-2 pr-4">备用模型</th><th className="pb-2 pr-4">优先级</th><th className="pb-2 pr-4">状态</th><th className="pb-2">操作</th>
              </tr></thead>
              <tbody>
	                {routes.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[var(--muted)]">暂无路由规则</td></tr>}
                {routes.map((r: any) => (
                  <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                    <td className="py-2 pr-4 font-medium">{r.name}</td>
                    <td className="py-2 pr-4"><span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{r.task_type}</span></td>
                    <td className="py-2 pr-4 font-mono text-xs">{r.model_id}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--muted)]">{r.fallback_model_id || "—"}</td>
	                    <td className="py-2 pr-4">{r.priority}</td>
	                    <td className="py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${r.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{r.enabled ? "启用" : "禁用"}</span></td>
	                    <td className="py-2"><button onClick={() => deleteRoute.mutate(r.id)} className="text-xs text-red-500 hover:underline">删除</button></td>
	                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </WorkbenchPanel>
      )}

      {tab === "cost" && (
	        <WorkbenchPanel title="成本统计" actions={<RefreshButton onClick={() => void costQ.refetch()} pending={costQ.isFetching} />}>
	          <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
	            <p className="mb-3 text-sm font-semibold">记录一次模型调用</p>
	            <div className="grid gap-3 sm:grid-cols-3">
	              <input className="input-base" placeholder="模型 ID" value={usageForm.model_id} onChange={e => setUsageForm(f => ({ ...f, model_id: e.target.value }))} />
	              <input className="input-base" type="number" placeholder="Prompt tokens" value={usageForm.prompt_tokens} onChange={e => setUsageForm(f => ({ ...f, prompt_tokens: Number(e.target.value) }))} />
	              <input className="input-base" type="number" placeholder="Completion tokens" value={usageForm.completion_tokens} onChange={e => setUsageForm(f => ({ ...f, completion_tokens: Number(e.target.value) }))} />
	              <input className="input-base" type="number" step="0.001" placeholder="费用" value={usageForm.cost_usd} onChange={e => setUsageForm(f => ({ ...f, cost_usd: Number(e.target.value) }))} />
	              <input className="input-base" type="number" placeholder="延迟 ms" value={usageForm.latency_ms} onChange={e => setUsageForm(f => ({ ...f, latency_ms: Number(e.target.value) }))} />
	              <button onClick={() => recordCost.mutate()} disabled={!usageForm.model_id} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">记录调用</button>
	            </div>
	          </div>
          <div className="grid gap-4 sm:grid-cols-3 mb-4">
            {[{ label: "总费用($)", value: costQ.data?.total_cost_usd ?? 0 }, { label: "总 Token", value: costQ.data?.total_tokens ?? 0 }, { label: "统计周期", value: "7d" }].map(item => (
              <div key={item.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
                <p className="text-2xl font-bold text-[var(--text)]">{item.value}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{item.label}</p>
              </div>
            ))}
          </div>
          {(costQ.data?.breakdown ?? []).length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--muted)]">暂无成本数据，模型调用后将在此显示</p>
          )}
        </WorkbenchPanel>
      )}

      {tab === "throttle" && (
        <WorkbenchPanel title="限流策略" actions={
          <div className="flex gap-2">
            <RefreshButton onClick={() => void throttleQ.refetch()} pending={throttleQ.isFetching} />
            <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建限流</button>
          </div>
        }>
          {showForm && (
            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <input className="input-base" placeholder="模型 ID *" value={tForm.model_id} onChange={e => setTForm(f => ({ ...f, model_id: e.target.value }))} />
                <input className="input-base" type="number" placeholder="RPM 限制" value={tForm.rpm_limit} onChange={e => setTForm(f => ({ ...f, rpm_limit: Number(e.target.value) }))} />
                <input className="input-base" type="number" placeholder="TPM 限制" value={tForm.tpm_limit} onChange={e => setTForm(f => ({ ...f, tpm_limit: Number(e.target.value) }))} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => createThrottle.mutate()} disabled={!tForm.model_id || createThrottle.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                  {createThrottle.isPending ? "创建中..." : "创建"}
                </button>
                <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
	                <th className="pb-2 pr-4">模型 ID</th><th className="pb-2 pr-4">RPM 限制</th><th className="pb-2 pr-4">TPM 限制</th><th className="pb-2 pr-4">状态</th><th className="pb-2">操作</th>
              </tr></thead>
              <tbody>
	                {throttles.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[var(--muted)]">暂无限流策略</td></tr>}
                {throttles.map((t: any) => (
                  <tr key={t.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                    <td className="py-2 pr-4 font-mono text-xs">{t.model_id}</td>
	                    <td className="py-2 pr-4">{t.rpm_limit}</td>
	                    <td className="py-2 pr-4">{t.tpm_limit?.toLocaleString()}</td>
	                    <td className="py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${t.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{t.enabled ? "启用" : "禁用"}</span></td>
	                    <td className="py-2"><button onClick={() => deleteThrottle.mutate(t.id)} className="text-xs text-red-500 hover:underline">删除</button></td>
	                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </WorkbenchPanel>
      )}

      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="llm-gateway"
        title="AI 模型网关助手"
        context={{ routes_count: routes.length, summary: s }}
        initialPrompt="分析当前模型路由配置，建议优化策略" />
    </div>
  );
}
