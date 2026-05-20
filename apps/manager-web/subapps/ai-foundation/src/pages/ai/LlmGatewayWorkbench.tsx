import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";

type Tab = "health" | "routes" | "decision" | "cost" | "throttle";

function badgeClass(level: string) {
  if (level === "critical" || level === "high" || level === "blocked") return "bg-red-50 text-red-700 ring-red-100";
  if (level === "medium") return "bg-amber-50 text-amber-700 ring-amber-100";
  return "bg-emerald-50 text-emerald-700 ring-emerald-100";
}

export function LlmGatewayWorkbench({ focused: _focused, initialTab = "health" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [taskResult, setTaskResult] = useState<any>(null);
  const [decisionResult, setDecisionResult] = useState<any>(null);
  const [rForm, setRForm] = useState({ name: "", task_type: "general", model_id: "", priority: 0, fallback_model_id: "", enabled: true });
  const [dForm, setDForm] = useState({ task_type: "code", estimated_prompt_tokens: 4000, estimated_completion_tokens: 1200, required_quality: "balanced", allow_fallback: true });
  const [tForm, setTForm] = useState({ model_id: "", rpm_limit: 60, tpm_limit: 100000, enabled: true });
  const [usageForm, setUsageForm] = useState({ model_id: "", prompt_tokens: 1000, completion_tokens: 500, cost_usd: 0.01, latency_ms: 800, task_type: "general" });

  const healthQ = useQuery({ queryKey: ["llmGatewayHealth"], queryFn: api.llmGatewayHealth, enabled: authed });
  const summaryQ = useQuery({ queryKey: ["llmGatewaySummary"], queryFn: api.llmGatewaySummary, enabled: authed });
  const routesQ = useQuery({ queryKey: ["llmRoutes"], queryFn: api.llmRoutes, enabled: authed });
  const costQ = useQuery({ queryKey: ["llmCostStats"], queryFn: () => api.llmCostStats(), enabled: authed && tab === "cost" });
  const throttleQ = useQuery({ queryKey: ["llmThrottle"], queryFn: api.llmThrottle, enabled: authed && (tab === "throttle" || tab === "decision" || tab === "health") });

  const createRoute = useMutation({
    mutationFn: () => api.llmRouteCreate(rForm),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["llmRoutes"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
      setShowForm(false);
    },
  });
  const deleteRoute = useMutation({
    mutationFn: (id: string) => api.llmRouteDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["llmRoutes"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewaySummary"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
    },
  });
  const decision = useMutation({
    mutationFn: () => api.llmDecision(dForm),
    onSuccess: (data) => setDecisionResult(data),
  });
  const createThrottle = useMutation({
    mutationFn: () => api.llmThrottleCreate(tForm),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["llmThrottle"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
      setShowForm(false);
    },
  });
  const deleteThrottle = useMutation({
    mutationFn: (id: string) => api.llmThrottleDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["llmThrottle"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
    },
  });
  const recordCost = useMutation({
    mutationFn: () => api.llmRecordCost(usageForm),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["llmCostStats"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewaySummary"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
    },
  });
  const governanceTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.llmGatewayGovernanceTasks({ dry_run: dryRun, assigned_to: "AI Platform", dev_tool: "codex" }),
    onSuccess: (data) => setTaskResult(data),
  });

  if (!authed) return <NeedLogin />;

  const summary = healthQ.data?.summary ?? summaryQ.data?.summary ?? {};
  const routes = routesQ.data?.items ?? [];
  const throttles = throttleQ.data?.items ?? [];
  const risks = summary.risks ?? [];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title="模型网关"
        description="统一 LLM 路由、调用前决策、成本控制、限流策略与 fallback 治理"
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton onClick={() => { void routesQ.refetch(); void summaryQ.refetch(); void healthQ.refetch(); }} pending={routesQ.isFetching || healthQ.isFetching} />
          </>
        }
        metrics={
          <WorkbenchStats items={[
            { label: "网关健康分", value: summary.health_score ?? 0, trend: (summary.health_score ?? 0) >= 80 ? "up" : "down" },
            { label: "总请求数", value: summary.total_requests ?? 0 },
            { label: "总费用($)", value: summary.total_cost_usd ?? 0 },
            { label: "活跃路由", value: summary.active_routes ?? routes.filter((r: any) => r.enabled).length },
          ]} />
        }
      />

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {(["health", "routes", "decision", "cost", "throttle"] as Tab[]).map((item) => (
          <button key={item} onClick={() => { setTab(item); setShowForm(false); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === item ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
            {item === "health" ? "健康治理" : item === "routes" ? `路由规则 (${routes.length})` : item === "decision" ? "调用决策" : item === "cost" ? "成本统计" : "限流策略"}
          </button>
        ))}
      </div>

      {tab === "health" && (
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <WorkbenchPanel title="网关健康与风险">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">健康分</div>
                <div className="mt-1 text-3xl font-semibold">{summary.health_score ?? 0}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">平均延迟</div>
                <div className="mt-1 text-3xl font-semibold">{summary.avg_latency_ms ?? 0}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">缺 fallback</div>
                <div className="mt-1 text-3xl font-semibold">{summary.route_coverage?.routes_without_fallback ?? 0}</div>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {risks.length === 0 ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">模型网关健康，暂无治理风险。</p> : null}
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

          <WorkbenchPanel title="治理任务化" actions={
            <div className="flex gap-2">
              <button onClick={() => governanceTasks.mutate(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">预览任务</button>
              <button onClick={() => governanceTasks.mutate(false)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white">生成任务</button>
            </div>
          }>
            <div className="space-y-2">
              {(summary.route_coverage?.unprotected_models ?? []).length === 0 ? <p className="text-sm text-[var(--muted)]">路由模型均已具备限流保护或暂无路由模型。</p> : null}
              {(summary.route_coverage?.unprotected_models ?? []).map((modelId: string) => (
                <div key={modelId} className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs">
                  未保护模型：<span className="font-mono">{modelId}</span>
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

      {tab === "routes" && (
        <WorkbenchPanel title="模型路由规则" actions={
          <div className="flex gap-2">
            <RefreshButton onClick={() => void routesQ.refetch()} pending={routesQ.isFetching} />
            <button onClick={() => setShowForm((value) => !value)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建路由</button>
          </div>
        }>
          {showForm && (
            <div className="mb-4 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input-base" placeholder="路由名称 *" value={rForm.name} onChange={(event) => setRForm((form) => ({ ...form, name: event.target.value }))} />
                <input className="input-base" placeholder="任务类型" value={rForm.task_type} onChange={(event) => setRForm((form) => ({ ...form, task_type: event.target.value }))} />
                <input className="input-base" placeholder="主模型 ID *" value={rForm.model_id} onChange={(event) => setRForm((form) => ({ ...form, model_id: event.target.value }))} />
                <input className="input-base" placeholder="备用模型 ID" value={rForm.fallback_model_id} onChange={(event) => setRForm((form) => ({ ...form, fallback_model_id: event.target.value }))} />
                <input className="input-base" type="number" placeholder="优先级" value={rForm.priority} onChange={(event) => setRForm((form) => ({ ...form, priority: Number(event.target.value) }))} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={rForm.enabled} onChange={(event) => setRForm((form) => ({ ...form, enabled: event.target.checked }))} />
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
                {routes.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-[var(--muted)]">暂无路由规则</td></tr> : null}
                {routes.map((route: any) => (
                  <tr key={route.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                    <td className="py-2 pr-4 font-medium">{route.name}</td>
                    <td className="py-2 pr-4"><span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{route.task_type}</span></td>
                    <td className="py-2 pr-4 font-mono text-xs">{route.model_id}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--muted)]">{route.fallback_model_id || "-"}</td>
                    <td className="py-2 pr-4">{route.priority}</td>
                    <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 text-xs ${route.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{route.enabled ? "启用" : "禁用"}</span></td>
                    <td className="py-2"><button onClick={() => deleteRoute.mutate(route.id)} className="text-xs text-red-500 hover:underline">删除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </WorkbenchPanel>
      )}

      {tab === "decision" && (
        <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <WorkbenchPanel title="调用前路由决策">
            <div className="space-y-3">
              <input className="input-base w-full" placeholder="任务类型" value={dForm.task_type} onChange={(event) => setDForm((form) => ({ ...form, task_type: event.target.value }))} />
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input-base" type="number" placeholder="预计 Prompt tokens" value={dForm.estimated_prompt_tokens} onChange={(event) => setDForm((form) => ({ ...form, estimated_prompt_tokens: Number(event.target.value) }))} />
                <input className="input-base" type="number" placeholder="预计 Completion tokens" value={dForm.estimated_completion_tokens} onChange={(event) => setDForm((form) => ({ ...form, estimated_completion_tokens: Number(event.target.value) }))} />
              </div>
              <select className="input-base w-full" value={dForm.required_quality} onChange={(event) => setDForm((form) => ({ ...form, required_quality: event.target.value }))}>
                <option value="fast">fast</option>
                <option value="balanced">balanced</option>
                <option value="high">high</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={dForm.allow_fallback} onChange={(event) => setDForm((form) => ({ ...form, allow_fallback: event.target.checked }))} />
                允许 fallback
              </label>
              <button onClick={() => decision.mutate()} disabled={decision.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                {decision.isPending ? "决策中..." : "生成调用决策"}
              </button>
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="决策包">
            {!decisionResult ? <p className="text-sm text-[var(--muted)]">生成决策后将展示选中模型、限流状态、fallback、风险和成本估算。</p> : null}
            {decisionResult ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{decisionResult.decision?.selected_model_id || "未选择模型"}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{decisionResult.decision?.reason}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(decisionResult.decision?.risk_level || decisionResult.decision?.status)}`}>{decisionResult.decision?.status} · {decisionResult.decision?.risk_level}</span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">fallback：{decisionResult.decision?.fallback_applied ? "是" : "否"}</div>
                    <div className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">预计 tokens：{decisionResult.decision?.cost?.estimated_tokens ?? 0}</div>
                    <div className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">预计成本：${decisionResult.decision?.cost?.estimated_cost_usd ?? 0}</div>
                  </div>
                </div>
                <pre className="max-h-[420px] overflow-auto rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5">{JSON.stringify(decisionResult, null, 2)}</pre>
              </div>
            ) : null}
          </WorkbenchPanel>
        </div>
      )}

      {tab === "cost" && (
        <WorkbenchPanel title="成本统计" actions={<RefreshButton onClick={() => void costQ.refetch()} pending={costQ.isFetching} />}>
          <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <p className="mb-3 text-sm font-semibold">记录一次模型调用</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <input className="input-base" placeholder="模型 ID" value={usageForm.model_id} onChange={(event) => setUsageForm((form) => ({ ...form, model_id: event.target.value }))} />
              <input className="input-base" type="number" placeholder="Prompt tokens" value={usageForm.prompt_tokens} onChange={(event) => setUsageForm((form) => ({ ...form, prompt_tokens: Number(event.target.value) }))} />
              <input className="input-base" type="number" placeholder="Completion tokens" value={usageForm.completion_tokens} onChange={(event) => setUsageForm((form) => ({ ...form, completion_tokens: Number(event.target.value) }))} />
              <input className="input-base" type="number" step="0.001" placeholder="费用" value={usageForm.cost_usd} onChange={(event) => setUsageForm((form) => ({ ...form, cost_usd: Number(event.target.value) }))} />
              <input className="input-base" type="number" placeholder="延迟 ms" value={usageForm.latency_ms} onChange={(event) => setUsageForm((form) => ({ ...form, latency_ms: Number(event.target.value) }))} />
              <button onClick={() => recordCost.mutate()} disabled={!usageForm.model_id} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">记录调用</button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 mb-4">
            {[{ label: "总费用($)", value: costQ.data?.total_cost_usd ?? 0 }, { label: "总 Token", value: costQ.data?.total_tokens ?? 0 }, { label: "统计周期", value: "7d" }].map((item) => (
              <div key={item.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
                <p className="text-2xl font-bold text-[var(--text)]">{item.value}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{item.label}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {(costQ.data?.breakdown ?? []).length === 0 ? <p className="py-8 text-center text-sm text-[var(--muted)]">暂无成本数据，模型调用后将在此显示</p> : null}
            {(costQ.data?.breakdown ?? []).map((item: any) => (
              <div key={item.model_id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="font-mono text-sm">{item.model_id}</p>
                <p className="mt-2 text-xs text-[var(--muted)]">请求 {item.requests} · Tokens {item.tokens} · 成本 ${item.cost_usd}</p>
              </div>
            ))}
          </div>
        </WorkbenchPanel>
      )}

      {tab === "throttle" && (
        <WorkbenchPanel title="限流策略" actions={
          <div className="flex gap-2">
            <RefreshButton onClick={() => void throttleQ.refetch()} pending={throttleQ.isFetching} />
            <button onClick={() => setShowForm((value) => !value)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建限流</button>
          </div>
        }>
          {showForm && (
            <div className="mb-4 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <input className="input-base" placeholder="模型 ID *" value={tForm.model_id} onChange={(event) => setTForm((form) => ({ ...form, model_id: event.target.value }))} />
                <input className="input-base" type="number" placeholder="RPM 限制" value={tForm.rpm_limit} onChange={(event) => setTForm((form) => ({ ...form, rpm_limit: Number(event.target.value) }))} />
                <input className="input-base" type="number" placeholder="TPM 限制" value={tForm.tpm_limit} onChange={(event) => setTForm((form) => ({ ...form, tpm_limit: Number(event.target.value) }))} />
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
                {throttles.length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-[var(--muted)]">暂无限流策略</td></tr> : null}
                {throttles.map((item: any) => (
                  <tr key={item.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                    <td className="py-2 pr-4 font-mono text-xs">{item.model_id}</td>
                    <td className="py-2 pr-4">{item.rpm_limit}</td>
                    <td className="py-2 pr-4">{item.tpm_limit?.toLocaleString()}</td>
                    <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 text-xs ${item.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{item.enabled ? "启用" : "禁用"}</span></td>
                    <td className="py-2"><button onClick={() => deleteThrottle.mutate(item.id)} className="text-xs text-red-500 hover:underline">删除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </WorkbenchPanel>
      )}

      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="llm-gateway"
        title="AI 模型网关助手"
        context={{ routes_count: routes.length, summary }}
        initialPrompt="分析当前模型路由、成本、限流和 fallback 风险，给出优化策略" />
    </div>
  );
}
