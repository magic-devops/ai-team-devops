import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";

type Tab = "health" | "policy" | "routes" | "decision" | "drill" | "cost" | "attribution" | "eval" | "audit" | "throttle";

const tabs: Array<{ key: Tab; label: string }> = [
  { key: "health", label: "健康治理" },
  { key: "policy", label: "生产策略" },
  { key: "routes", label: "路由规则" },
  { key: "decision", label: "调用决策" },
  { key: "drill", label: "Fallback 演练" },
  { key: "cost", label: "成本统计" },
  { key: "attribution", label: "成本归因" },
  { key: "eval", label: "模型评测" },
  { key: "audit", label: "Prompt 审计" },
  { key: "throttle", label: "限流策略" },
];

function badgeClass(level: string) {
  if (level === "critical" || level === "high" || level === "blocked" || level === "down" || level === "unhealthy") return "bg-red-50 text-red-700 ring-red-100";
  if (level === "medium" || level === "degraded") return "bg-amber-50 text-amber-700 ring-amber-100";
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
  const [policyDecisionResult, setPolicyDecisionResult] = useState<any>(null);
  const [fallbackDrillResult, setFallbackDrillResult] = useState<any>(null);
  const [costAnomalyResult, setCostAnomalyResult] = useState<any>(null);
  const [costAttributionResult, setCostAttributionResult] = useState<any>(null);
  const [modelEvalResult, setModelEvalResult] = useState<any>(null);
  const [promptAuditResult, setPromptAuditResult] = useState<any>(null);
  const [imResult, setImResult] = useState<any>(null);
  const [imChannels, setImChannels] = useState<string[]>([]);
  const [rForm, setRForm] = useState({ name: "", task_type: "general", model_id: "", priority: 0, fallback_model_id: "", enabled: true });
  const [dForm, setDForm] = useState({ task_type: "code", estimated_prompt_tokens: 4000, estimated_completion_tokens: 1200, required_quality: "balanced", allow_fallback: true });
  const [tForm, setTForm] = useState({ model_id: "", rpm_limit: 60, tpm_limit: 100000, enabled: true });
  const [usageForm, setUsageForm] = useState({ model_id: "", prompt_tokens: 1000, completion_tokens: 500, cost_usd: 0.01, latency_ms: 800, task_type: "general" });
  const [attributionForm, setAttributionForm] = useState({ min_cost_usd: 0, dry_run: true, create_tasks: false, assigned_to: "AI Platform", dev_tool: "codex", note: "" });
  const [evalForm, setEvalForm] = useState({
    model_ids: "gpt-5-mini, claude-sonnet",
    min_score: 75,
    dry_run: true,
    create_tasks: false,
    assigned_to: "AI Platform",
    dev_tool: "codex",
    note: "",
    cases_json: JSON.stringify([
      {
        id: "code-review",
        name: "代码评审输出",
        task_type: "code",
        prompt: "请评审一段服务端代码，输出安全、结构化、可执行的修改建议。",
        expected_keywords: ["安全", "结构化", "建议"],
        completion_tokens: 700,
        latency_slo_ms: 3000,
        budget_usd: 0.05,
        weight: 1,
      },
      {
        id: "ops-analysis",
        name: "运维根因分析",
        task_type: "analysis",
        prompt: "根据告警、Trace 和部署记录分析根因，并给出下一步处置。",
        expected_keywords: ["根因", "证据", "处置"],
        completion_tokens: 900,
        latency_slo_ms: 4000,
        budget_usd: 0.08,
        weight: 1.2,
      },
    ], null, 2),
    actual_outputs_json: "{}",
  });
  const [auditForm, setAuditForm] = useState({
    prompt: "请审计这个模型调用 Prompt 是否存在敏感信息、越权指令或上下文过长风险。",
    task_type: "code",
    model_id: "gpt-5",
    user_role: "agent",
    max_prompt_tokens: 8000,
    allow_pii: false,
    allow_secrets: false,
    actions: ["create_task"],
    assigned_to: "AI Platform",
    dev_tool: "codex",
  });
  const [policyForm, setPolicyForm] = useState({
    enabled: true,
    daily_budget_usd: 100,
    block_on_budget: true,
    require_provider_health: true,
    max_provider_latency_ms: 5000,
    max_provider_error_rate: 0.5,
    cost_anomaly_threshold_usd: 1,
  });
  const [providerForm, setProviderForm] = useState({ model_id: "", status: "healthy", latency_ms: 800, error_rate: 0, note: "" });

  const healthQ = useQuery({ queryKey: ["llmGatewayHealth"], queryFn: api.llmGatewayHealth, enabled: authed });
  const summaryQ = useQuery({ queryKey: ["llmGatewaySummary"], queryFn: api.llmGatewaySummary, enabled: authed });
  const routesQ = useQuery({ queryKey: ["llmRoutes"], queryFn: api.llmRoutes, enabled: authed });
  const policyQ = useQuery({ queryKey: ["llmGatewayPolicies"], queryFn: api.llmGatewayPolicies, enabled: authed && ["policy", "decision", "drill", "health"].includes(tab) });
  const providerHealthQ = useQuery({ queryKey: ["llmProviderHealth"], queryFn: api.llmProviderHealth, enabled: authed && ["policy", "decision", "drill", "health"].includes(tab) });
  const costQ = useQuery({ queryKey: ["llmCostStats"], queryFn: () => api.llmCostStats(), enabled: authed && (tab === "cost" || tab === "drill" || tab === "attribution") });
  const costAttributionRunsQ = useQuery({ queryKey: ["llmCostAttributionRuns"], queryFn: () => api.llmCostAttributionRuns(20), enabled: authed && (tab === "attribution" || tab === "health") });
  const modelEvalRunsQ = useQuery({ queryKey: ["llmModelEvalRuns"], queryFn: () => api.llmModelEvalRuns(20), enabled: authed && (tab === "eval" || tab === "health") });
  const promptAuditRunsQ = useQuery({ queryKey: ["llmPromptAuditRuns"], queryFn: () => api.llmPromptAuditRuns(20), enabled: authed && (tab === "audit" || tab === "health") });
  const throttleQ = useQuery({ queryKey: ["llmThrottle"], queryFn: api.llmThrottle, enabled: authed && (tab === "throttle" || tab === "decision" || tab === "health" || tab === "drill") });
  const channelsQ = useQuery({ queryKey: ["notifyChannels"], queryFn: api.notifyChannels, enabled: authed });
  const enabledChannels = useMemo(() => (channelsQ.data ?? []).filter((ch: any) => ch.enabled), [channelsQ.data]);

  useEffect(() => {
    const policy = policyQ.data?.policy;
    if (!policy) return;
    setPolicyForm({
      enabled: Boolean(policy.enabled),
      daily_budget_usd: Number(policy.daily_budget_usd ?? 100),
      block_on_budget: Boolean(policy.block_on_budget),
      require_provider_health: Boolean(policy.require_provider_health),
      max_provider_latency_ms: Number(policy.max_provider_latency_ms ?? 5000),
      max_provider_error_rate: Number(policy.max_provider_error_rate ?? 0.5),
      cost_anomaly_threshold_usd: Number(policy.cost_anomaly_threshold_usd ?? 1),
    });
  }, [policyQ.data?.policy]);

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
  const policyEvaluate = useMutation({
    mutationFn: () => api.llmPolicyEvaluate(dForm),
    onSuccess: (data) => setPolicyDecisionResult(data),
  });
  const updatePolicy = useMutation({
    mutationFn: () => api.llmGatewayPolicyUpdate(policyForm),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["llmGatewayPolicies"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
    },
  });
  const recordProviderHealth = useMutation({
    mutationFn: () => api.llmProviderHealthRecord(providerForm),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["llmProviderHealth"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
      setProviderForm((form) => ({ ...form, note: "" }));
    },
  });
  const fallbackDrill = useMutation({
    mutationFn: api.llmFallbackDrill,
    onSuccess: (data) => setFallbackDrillResult(data),
  });
  const costAnomalyTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.llmCostAnomalyTasks({ dry_run: dryRun, assigned_to: "AI Platform", dev_tool: "codex" }),
    onSuccess: (data) => setCostAnomalyResult(data),
  });
  const costAttribution = useMutation({
    mutationFn: () => api.llmCostAttributionRun({
      min_cost_usd: attributionForm.min_cost_usd,
      dry_run: attributionForm.dry_run,
      persist: true,
      create_tasks: attributionForm.create_tasks,
      assigned_to: attributionForm.assigned_to,
      dev_tool: attributionForm.dev_tool,
      note: attributionForm.note,
    }),
    onSuccess: (data) => {
      setCostAttributionResult(data);
      if (!attributionForm.dry_run) {
        void qc.invalidateQueries({ queryKey: ["llmCostAttributionRuns"] });
      }
    },
  });
  const modelEval = useMutation({
    mutationFn: () => {
      let cases: any[] = [];
      let actualOutputs: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(evalForm.cases_json || "[]");
        cases = Array.isArray(parsed) ? parsed : [];
      } catch {
        cases = [];
      }
      try {
        const parsed = JSON.parse(evalForm.actual_outputs_json || "{}");
        actualOutputs = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        actualOutputs = {};
      }
      return api.llmModelEvalRun({
        model_ids: evalForm.model_ids.split(",").map((item) => item.trim()).filter(Boolean),
        cases,
        actual_outputs: actualOutputs,
        min_score: evalForm.min_score,
        dry_run: evalForm.dry_run,
        persist: true,
        create_tasks: evalForm.create_tasks,
        assigned_to: evalForm.assigned_to,
        dev_tool: evalForm.dev_tool,
        note: evalForm.note,
      });
    },
    onSuccess: (data) => {
      setModelEvalResult(data);
      if (!evalForm.dry_run) {
        void qc.invalidateQueries({ queryKey: ["llmModelEvalRuns"] });
      }
    },
  });
  const promptAudit = useMutation({
    mutationFn: (dryRun: boolean) => api.llmPromptAuditRun({ ...auditForm, dry_run: dryRun, persist: true }),
    onSuccess: (data, dryRun) => {
      setPromptAuditResult(data);
      if (!dryRun) {
        void qc.invalidateQueries({ queryKey: ["llmPromptAuditRuns"] });
      }
    },
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
      void qc.invalidateQueries({ queryKey: ["llmCostAttributionRuns"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewaySummary"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
    },
  });
  const governanceTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.llmGatewayGovernanceTasks({ dry_run: dryRun, assigned_to: "AI Platform", dev_tool: "codex" }),
    onSuccess: (data) => setTaskResult(data),
  });
  const imBriefing = useMutation({
    mutationFn: (dryRun: boolean) => api.llmGatewayImBriefing({ dry_run: dryRun, channels: imChannels }),
    onSuccess: (data, dryRun) => {
      setImResult(data);
      if (!dryRun) {
        void qc.invalidateQueries({ queryKey: ["notifyMessages"] });
        void qc.invalidateQueries({ queryKey: ["notifySummary"] });
      }
    },
  });

  if (!authed) return <NeedLogin />;

  const summary = healthQ.data?.summary ?? summaryQ.data?.summary ?? {};
  const policy = policyQ.data?.policy ?? policyForm;
  const providerHealth = providerHealthQ.data?.items ?? [];
  const routes = routesQ.data?.items ?? [];
  const throttles = throttleQ.data?.items ?? [];
  const risks = summary.risks ?? [];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title="模型网关"
        description="统一 LLM 路由、调用前决策、成本归因、限流策略与 fallback 治理"
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton onClick={() => { void routesQ.refetch(); void summaryQ.refetch(); void healthQ.refetch(); void policyQ.refetch(); void providerHealthQ.refetch(); }} pending={routesQ.isFetching || healthQ.isFetching || policyQ.isFetching || providerHealthQ.isFetching} />
          </>
        }
        metrics={
          <WorkbenchStats items={[
            { label: "网关健康分", value: summary.health_score ?? 0, trend: (summary.health_score ?? 0) >= 80 ? "up" : "down" },
            { label: "总请求数", value: summary.total_requests ?? 0 },
            { label: "预算护栏($)", value: policy.daily_budget_usd ?? 0 },
            { label: "活跃路由", value: summary.active_routes ?? routes.filter((r: any) => r.enabled).length },
            { label: "Provider 健康", value: providerHealth.filter((item: any) => ["healthy", "ok", "active"].includes(String(item.status || "").toLowerCase())).length },
          ]} />
        }
      />

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {tabs.map((item) => (
          <button key={item.key} onClick={() => { setTab(item.key); setShowForm(false); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === item.key ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
            {item.key === "routes" ? `${item.label} (${routes.length})` : item.label}
          </button>
        ))}
      </div>

      {tab === "health" && (
        <div className="space-y-4">
        <WorkbenchPanel title="IM 深度集成" actions={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => imBriefing.mutate(true)} disabled={imBriefing.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览 IM 简报</button>
            <button onClick={() => imBriefing.mutate(false)} disabled={imBriefing.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">发送到 IM</button>
          </div>
        }>
          <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <p className="text-sm font-semibold">模型路由、限流、成本风险会生成 IM 运行简报</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">简报包含健康分、缺 fallback 路由、未限流模型、平均延迟和治理入口，便于平台团队在 IM 中快速处理。</p>
              <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium">投递通道</span>
                  <button type="button" onClick={() => setImChannels([])} className="text-[var(--brand)]">自动推荐</button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {enabledChannels.length === 0 ? <span className="text-xs text-[var(--muted)]">暂无启用通道，先到通信集成配置。</span> : null}
                  {enabledChannels.map((ch: any) => (
                    <label key={ch.name} className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={imChannels.includes(ch.name)}
                        onChange={(e) => setImChannels((prev) => e.target.checked ? [...prev, ch.name] : prev.filter((name) => name !== ch.name))}
                      />
                      <span>{ch.name}</span>
                      <span className="text-[var(--muted)]">{ch.type}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-[var(--muted)]">{imChannels.length ? `手动选择 ${imChannels.length} 个通道` : "未选择时按 llm_gateway_risk 事件自动匹配通道。"}</p>
              </div>
              {imResult?.delivery_plan ? (
                <div className="mt-3 grid gap-2 text-xs">
                  <span>目标通道：{imResult.delivery_plan.targets?.length ?? 0}</span>
                  <span>投递状态：{imResult.delivery_plan.ready ? "可发送" : imResult.delivery_plan.recommendation}</span>
                  <span>事件策略：{imResult.delivery_plan.audit?.event || "-"} / {imResult.delivery_plan.selection_mode || "-"}</span>
                  {(imResult.delivery_plan.missing_channels ?? []).length ? <span>缺失通道：{imResult.delivery_plan.missing_channels.join(", ")}</span> : null}
                  {(imResult.delivery_plan.blocked_channels ?? []).length ? <span>阻断通道：{imResult.delivery_plan.blocked_channels.map((item: any) => `${item.name}:${item.reason}`).join(", ")}</span> : null}
                  <span>最近动作：{imResult.dry_run ? "预览" : "发送"}</span>
                </div>
              ) : null}
            </div>
            <div className="rounded-lg bg-[var(--surface-muted)] p-3">
              <p className="text-sm font-semibold">{imResult?.briefing?.title ?? "IM 简报预览"}</p>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">{imResult?.briefing?.content ?? "点击预览后展示 LLM Gateway 运行简报内容。"}</pre>
            </div>
          </div>
        </WorkbenchPanel>

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
        </div>
      )}

      {tab === "policy" && (
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <WorkbenchPanel title="生产策略控制" actions={
            <button onClick={() => updatePolicy.mutate()} disabled={updatePolicy.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {updatePolicy.isPending ? "保存中..." : "保存策略"}
            </button>
          }>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                <input type="checkbox" checked={policyForm.enabled} onChange={(event) => setPolicyForm((form) => ({ ...form, enabled: event.target.checked }))} />
                启用模型网关策略
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                <input type="checkbox" checked={policyForm.block_on_budget} onChange={(event) => setPolicyForm((form) => ({ ...form, block_on_budget: event.target.checked }))} />
                超预算直接阻断
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                <input type="checkbox" checked={policyForm.require_provider_health} onChange={(event) => setPolicyForm((form) => ({ ...form, require_provider_health: event.target.checked }))} />
                强制 Provider 健康
              </label>
              <input className="input-base" type="number" step="0.01" placeholder="每日预算 USD" value={policyForm.daily_budget_usd} onChange={(event) => setPolicyForm((form) => ({ ...form, daily_budget_usd: Number(event.target.value) }))} />
              <input className="input-base" type="number" placeholder="最大延迟 ms" value={policyForm.max_provider_latency_ms} onChange={(event) => setPolicyForm((form) => ({ ...form, max_provider_latency_ms: Number(event.target.value) }))} />
              <input className="input-base" type="number" step="0.01" min="0" max="1" placeholder="最大错误率" value={policyForm.max_provider_error_rate} onChange={(event) => setPolicyForm((form) => ({ ...form, max_provider_error_rate: Number(event.target.value) }))} />
              <input className="input-base" type="number" step="0.01" placeholder="成本异常阈值 USD" value={policyForm.cost_anomaly_threshold_usd} onChange={(event) => setPolicyForm((form) => ({ ...form, cost_anomaly_threshold_usd: Number(event.target.value) }))} />
            </div>
            <div className="mt-4 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">
              当前策略：预算 ${policy.daily_budget_usd ?? 0}，Provider 延迟阈值 {policy.max_provider_latency_ms ?? 0}ms，错误率阈值 {policy.max_provider_error_rate ?? 0}，成本异常阈值 ${policy.cost_anomaly_threshold_usd ?? 0}。
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="Provider 健康上报" actions={<RefreshButton onClick={() => void providerHealthQ.refetch()} pending={providerHealthQ.isFetching} />}>
            <div className="grid gap-3 sm:grid-cols-5">
              <input className="input-base sm:col-span-2" placeholder="模型 ID *" value={providerForm.model_id} onChange={(event) => setProviderForm((form) => ({ ...form, model_id: event.target.value }))} />
              <select className="input-base" value={providerForm.status} onChange={(event) => setProviderForm((form) => ({ ...form, status: event.target.value }))}>
                <option value="healthy">healthy</option>
                <option value="degraded">degraded</option>
                <option value="down">down</option>
              </select>
              <input className="input-base" type="number" placeholder="延迟 ms" value={providerForm.latency_ms} onChange={(event) => setProviderForm((form) => ({ ...form, latency_ms: Number(event.target.value) }))} />
              <input className="input-base" type="number" step="0.01" min="0" max="1" placeholder="错误率" value={providerForm.error_rate} onChange={(event) => setProviderForm((form) => ({ ...form, error_rate: Number(event.target.value) }))} />
              <input className="input-base sm:col-span-4" placeholder="备注" value={providerForm.note} onChange={(event) => setProviderForm((form) => ({ ...form, note: event.target.value }))} />
              <button onClick={() => recordProviderHealth.mutate()} disabled={!providerForm.model_id || recordProviderHealth.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">上报健康</button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4">模型</th><th className="pb-2 pr-4">状态</th><th className="pb-2 pr-4">延迟</th><th className="pb-2 pr-4">错误率</th><th className="pb-2">备注</th>
                </tr></thead>
                <tbody>
                  {providerHealth.length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-[var(--muted)]">暂无 Provider 健康上报</td></tr> : null}
                  {providerHealth.map((item: any) => (
                    <tr key={item.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)]">
                      <td className="py-2 pr-4 font-mono text-xs">{item.model_id}</td>
                      <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(item.status)}`}>{item.status}</span></td>
                      <td className="py-2 pr-4">{item.latency_ms ?? 0}ms</td>
                      <td className="py-2 pr-4">{item.error_rate ?? 0}</td>
                      <td className="py-2 text-xs text-[var(--muted)]">{item.note || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              <div className="flex flex-wrap gap-2">
                <button onClick={() => decision.mutate()} disabled={decision.isPending} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm disabled:opacity-50">
                  {decision.isPending ? "决策中..." : "基础决策"}
                </button>
                <button onClick={() => policyEvaluate.mutate()} disabled={policyEvaluate.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                  {policyEvaluate.isPending ? "评估中..." : "策略评估"}
                </button>
              </div>
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="决策包">
            {!decisionResult && !policyDecisionResult ? <p className="text-sm text-[var(--muted)]">生成决策后将展示选中模型、Provider 健康、预算护栏、限流状态、fallback、风险和成本估算。</p> : null}
            {policyDecisionResult ? (
              <div className="mb-4 space-y-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">策略评估 · {policyDecisionResult.decision?.selected_model_id || "未选择模型"}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{policyDecisionResult.decision?.reason}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(policyDecisionResult.decision?.risk_level || policyDecisionResult.decision?.status)}`}>{policyDecisionResult.decision?.status} · {policyDecisionResult.decision?.policy_decision?.decision}</span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">fallback：{policyDecisionResult.decision?.fallback_applied ? "是" : "否"}</div>
                    <div className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">预算投影：${policyDecisionResult.decision?.policy_decision?.budget?.projected_cost_usd ?? 0}</div>
                    <div className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">规则：{(policyDecisionResult.decision?.policy_decision?.matched_rules ?? []).join(", ") || "-"}</div>
                  </div>
                </div>
                <pre className="max-h-[300px] overflow-auto rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5">{JSON.stringify(policyDecisionResult, null, 2)}</pre>
              </div>
            ) : null}
            {decisionResult ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">基础决策 · {decisionResult.decision?.selected_model_id || "未选择模型"}</p>
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

      {tab === "drill" && (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <WorkbenchPanel title="Fallback 接管演练" actions={
            <button onClick={() => fallbackDrill.mutate()} disabled={fallbackDrill.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {fallbackDrill.isPending ? "演练中..." : "执行演练"}
            </button>
          }>
            {!fallbackDrillResult ? <p className="text-sm text-[var(--muted)]">演练会逐条检查主模型、备用模型、Provider 健康和限流接管状态。</p> : null}
            {fallbackDrillResult ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                    <p className="text-2xl font-bold">{fallbackDrillResult.summary?.total_routes ?? 0}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">总路由</p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                    <p className="text-2xl font-bold text-emerald-700">{fallbackDrillResult.summary?.ready ?? 0}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">可接管</p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                    <p className="text-2xl font-bold text-red-700">{fallbackDrillResult.summary?.unready ?? 0}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">待修复</p>
                  </div>
                </div>
                {(fallbackDrillResult.items ?? []).map((item: any) => (
                  <div key={item.route_id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{item.route_name || item.route_id}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{item.primary_model_id || "-"} → {item.fallback_model_id || "-"}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(item.status === "ready" ? "low" : "high")}`}>{item.status}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.recommendation}</p>
                    {(item.issues ?? []).length ? <p className="mt-2 text-xs text-red-600">问题：{item.issues.join(", ")}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </WorkbenchPanel>

          <WorkbenchPanel title="成本异常任务化" actions={
            <div className="flex flex-wrap gap-2">
              <button onClick={() => costAnomalyTasks.mutate(true)} disabled={costAnomalyTasks.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览任务</button>
              <button onClick={() => costAnomalyTasks.mutate(false)} disabled={costAnomalyTasks.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">生成任务</button>
            </div>
          }>
            <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">
              阈值：单模型平均调用成本 ≥ ${policy.cost_anomaly_threshold_usd ?? 0} 时生成治理任务。当前统计费用 ${costQ.data?.total_cost_usd ?? 0}，请求模型数 {(costQ.data?.breakdown ?? []).length}。
            </div>
            {costAnomalyResult ? (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                    <p className="text-2xl font-bold">{costAnomalyResult.summary?.models ?? 0}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">模型数</p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                    <p className="text-2xl font-bold text-amber-700">{costAnomalyResult.summary?.anomalies ?? 0}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">异常数</p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                    <p className="text-2xl font-bold">{costAnomalyResult.created?.length ?? 0}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">已生成</p>
                  </div>
                </div>
                {(costAnomalyResult.items ?? []).length === 0 ? <p className="text-sm text-[var(--muted)]">暂无达到阈值的成本异常任务。</p> : null}
                {(costAnomalyResult.items ?? []).map((item: any) => (
                  <div key={item.source_report_id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                    <p className="font-semibold">{item.priority} · {item.title}</p>
                    <p className="mt-1 whitespace-pre-wrap leading-5 text-[var(--muted)]">{item.description}</p>
                  </div>
                ))}
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

      {tab === "attribution" && (
        <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
          <WorkbenchPanel title="跨 Provider 成本归因" actions={
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setAttributionForm((form) => ({ ...form, dry_run: true, create_tasks: false }))} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">预览模式</button>
              <button onClick={() => setAttributionForm((form) => ({ ...form, dry_run: false }))} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">落库模式</button>
              <button onClick={() => costAttribution.mutate()} disabled={costAttribution.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">
                {costAttribution.isPending ? "分析中..." : attributionForm.dry_run ? "运行归因预览" : "执行归因"}
              </button>
            </div>
          }>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="input-base" type="number" step="0.001" placeholder="最小成本过滤 USD" value={attributionForm.min_cost_usd} onChange={(event) => setAttributionForm((form) => ({ ...form, min_cost_usd: Number(event.target.value) }))} />
              <input className="input-base" placeholder="负责人" value={attributionForm.assigned_to} onChange={(event) => setAttributionForm((form) => ({ ...form, assigned_to: event.target.value }))} />
              <input className="input-base" placeholder="执行工具" value={attributionForm.dev_tool} onChange={(event) => setAttributionForm((form) => ({ ...form, dev_tool: event.target.value }))} />
              <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                <input type="checkbox" checked={attributionForm.create_tasks} onChange={(event) => setAttributionForm((form) => ({ ...form, create_tasks: event.target.checked }))} />
                执行时同步生成治理任务
              </label>
              <textarea className="input-base min-h-20 sm:col-span-2" placeholder="归因备注，可选" value={attributionForm.note} onChange={(event) => setAttributionForm((form) => ({ ...form, note: event.target.value }))} />
            </div>
            <div className="mt-4 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">
              当前成本统计：总费用 ${costQ.data?.total_cost_usd ?? 0}，总 tokens {costQ.data?.total_tokens ?? 0}，模型数 {(costQ.data?.breakdown ?? []).length}。归因会按 Provider、模型、任务类型、Agent/任务来源拆分费用和成本占比。
            </div>
            {costAttributionResult ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  {[
                    { label: "总费用($)", value: costAttributionResult.summary?.total_cost_usd ?? 0 },
                    { label: "Provider", value: costAttributionResult.summary?.providers ?? 0 },
                    { label: "预算占比", value: `${costAttributionResult.summary?.budget_ratio ?? 0}%` },
                    { label: "任务建议", value: costAttributionResult.summary?.tasks_planned ?? 0 },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                      <p className="text-xl font-semibold">{item.value}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{item.label}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {(costAttributionResult.findings ?? []).length === 0 ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">暂无明显成本归因风险。</p> : null}
                  {(costAttributionResult.findings ?? []).map((finding: any, index: number) => (
                    <div key={`${finding.title}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{finding.title}</p>
                          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{finding.recommendation}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(finding.level)}`}>{finding.level}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </WorkbenchPanel>

          <div className="space-y-4">
            <WorkbenchPanel title="Provider 成本分布" actions={<RefreshButton onClick={() => void costAttributionRunsQ.refetch()} pending={costAttributionRunsQ.isFetching} />}>
              {(costAttributionResult?.providers ?? []).length === 0 ? <p className="text-sm text-[var(--muted)]">运行归因后展示 Provider 费用、占比、平均成本和延迟。</p> : null}
              <div className="space-y-2">
                {(costAttributionResult?.providers ?? []).map((item: any) => (
                  <div key={item.provider} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{item.provider}</span>
                      <span className="text-sm font-semibold">${item.cost_usd} · {item.cost_share}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                      <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.min(100, Number(item.cost_share ?? 0))}%` }} />
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">请求 {item.requests} · Tokens {item.tokens} · 平均成本 ${item.avg_cost_usd} · 平均延迟 {item.avg_latency_ms}ms</p>
                  </div>
                ))}
              </div>
            </WorkbenchPanel>

            <WorkbenchPanel title="模型 / 任务类型 / 来源">
              <div className="grid gap-3 lg:grid-cols-3">
                <div>
                  <p className="mb-2 text-xs font-semibold text-[var(--muted-strong)]">模型 Top</p>
                  <div className="space-y-2">
                    {(costAttributionResult?.models ?? []).slice(0, 6).map((item: any) => (
                      <div key={item.model_id} className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">
                        <p className="truncate font-mono">{item.model_id}</p>
                        <p className="mt-1 text-[var(--muted)]">${item.cost_usd} · {item.cost_share}%</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-[var(--muted-strong)]">任务类型</p>
                  <div className="space-y-2">
                    {(costAttributionResult?.task_types ?? []).slice(0, 6).map((item: any) => (
                      <div key={item.task_type} className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">
                        <p className="truncate font-semibold">{item.task_type}</p>
                        <p className="mt-1 text-[var(--muted)]">${item.cost_usd} · {item.requests} 次</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-[var(--muted-strong)]">执行来源</p>
                  <div className="space-y-2">
                    {(costAttributionResult?.sources ?? []).slice(0, 6).map((item: any) => (
                      <div key={item.source} className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">
                        <p className="truncate font-mono">{item.source}</p>
                        <p className="mt-1 text-[var(--muted)]">${item.cost_usd} · {item.tokens} tokens</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </WorkbenchPanel>

            <WorkbenchPanel title="归因历史">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                  <p className="text-xl font-semibold">{costAttributionRunsQ.data?.summary?.runs ?? 0}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">运行数</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                  <p className="text-xl font-semibold">${costAttributionRunsQ.data?.summary?.latest_total_cost_usd ?? 0}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">最近费用</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                  <p className="text-xl font-semibold">{costAttributionRunsQ.data?.summary?.latest_budget_ratio ?? 0}%</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">最近预算</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                  <p className="text-xl font-semibold">{costAttributionRunsQ.data?.summary?.latest_top_provider || "-"}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">Top Provider</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {(costAttributionRunsQ.data?.items ?? []).length === 0 ? <p className="text-sm text-[var(--muted)]">暂无持久化归因历史。</p> : null}
                {(costAttributionRunsQ.data?.items ?? []).slice(0, 6).map((item: any) => (
                  <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono">{item.id}</span>
                      <span className={`rounded-full px-2 py-0.5 ring-1 ${badgeClass((item.summary?.findings ?? 0) ? "medium" : "low")}`}>{item.summary?.findings ?? 0} findings</span>
                    </div>
                    <p className="mt-1 text-[var(--muted)]">${item.summary?.total_cost_usd ?? 0} · {item.summary?.top_provider || "-"} · {item.created_at}</p>
                  </div>
                ))}
              </div>
            </WorkbenchPanel>
          </div>
        </div>
      )}

      {tab === "eval" && (
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <WorkbenchPanel title="模型评测 Suite" actions={
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setEvalForm((form) => ({ ...form, dry_run: true, create_tasks: false }))} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">预览模式</button>
              <button onClick={() => setEvalForm((form) => ({ ...form, dry_run: false }))} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">落库模式</button>
              <button onClick={() => modelEval.mutate()} disabled={modelEval.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">
                {modelEval.isPending ? "评测中..." : evalForm.dry_run ? "运行评测预览" : "执行评测"}
              </button>
            </div>
          }>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="input-base sm:col-span-2" placeholder="候选模型，逗号分隔；留空则使用路由主模型和 fallback" value={evalForm.model_ids} onChange={(event) => setEvalForm((form) => ({ ...form, model_ids: event.target.value }))} />
              <input className="input-base" type="number" min="0" max="100" placeholder="通过阈值" value={evalForm.min_score} onChange={(event) => setEvalForm((form) => ({ ...form, min_score: Number(event.target.value) }))} />
              <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                <input type="checkbox" checked={evalForm.create_tasks} onChange={(event) => setEvalForm((form) => ({ ...form, create_tasks: event.target.checked }))} />
                执行时同步生成治理任务
              </label>
              <input className="input-base" placeholder="负责人" value={evalForm.assigned_to} onChange={(event) => setEvalForm((form) => ({ ...form, assigned_to: event.target.value }))} />
              <input className="input-base" placeholder="执行工具" value={evalForm.dev_tool} onChange={(event) => setEvalForm((form) => ({ ...form, dev_tool: event.target.value }))} />
              <textarea className="input-base min-h-40 font-mono text-xs sm:col-span-2" value={evalForm.cases_json} onChange={(event) => setEvalForm((form) => ({ ...form, cases_json: event.target.value }))} />
              <textarea className="input-base min-h-24 font-mono text-xs sm:col-span-2" placeholder='实际输出 JSON，可选：{"case-1":{"gpt-5-mini":"..."}}' value={evalForm.actual_outputs_json} onChange={(event) => setEvalForm((form) => ({ ...form, actual_outputs_json: event.target.value }))} />
              <textarea className="input-base min-h-16 sm:col-span-2" placeholder="评测备注，可选" value={evalForm.note} onChange={(event) => setEvalForm((form) => ({ ...form, note: event.target.value }))} />
            </div>
            <div className="mt-4 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">
              评测会综合输出质量、Prompt 安全、Provider 健康、限流、成本效率和延迟 SLO。未提供实际输出时使用模型能力画像和当前策略做离线基线评测；提供实际输出时会按 expected_keywords 计算命中率。
            </div>
          </WorkbenchPanel>

          <div className="space-y-4">
            <WorkbenchPanel title="模型评测结果" actions={<RefreshButton onClick={() => void modelEvalRunsQ.refetch()} pending={modelEvalRunsQ.isFetching} />}>
              {!modelEvalResult ? <p className="text-sm text-[var(--muted)]">运行评测后展示最佳模型、平均分、风险发现、模型排名和用例明细。</p> : null}
              {modelEvalResult ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-4">
                    {[
                      { label: "最佳模型", value: modelEvalResult.summary?.best_model || "-" },
                      { label: "最佳分", value: modelEvalResult.summary?.best_score ?? 0 },
                      { label: "平均分", value: modelEvalResult.summary?.avg_score ?? 0 },
                      { label: "任务建议", value: modelEvalResult.summary?.tasks_planned ?? 0 },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                        <p className="truncate text-lg font-semibold">{item.value}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{item.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {(modelEvalResult.findings ?? []).length === 0 ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">模型评测通过，暂无需要任务化的风险。</p> : null}
                    {(modelEvalResult.findings ?? []).map((finding: any, index: number) => (
                      <div key={`${finding.title}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{finding.title}</p>
                            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{finding.recommendation}</p>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(finding.level)}`}>{finding.level}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {(modelEvalResult.models ?? []).map((item: any) => (
                      <div key={item.model_id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-mono text-sm">{item.model_id}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{item.provider} · 成本 ${item.estimated_cost_usd} · tokens {item.estimated_tokens}</p>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(item.status === "risk" ? "high" : item.status === "watch" ? "medium" : "low")}`}>{item.status} · {item.score}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                          <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.min(100, Number(item.score ?? 0))}%` }} />
                        </div>
                        {(item.missing_keywords ?? []).length ? <p className="mt-2 text-xs text-amber-700">缺失关键词：{item.missing_keywords.join(", ")}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </WorkbenchPanel>

            <WorkbenchPanel title="用例明细与历史">
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--muted-strong)]">用例评测</p>
                  {(modelEvalResult?.items ?? []).length === 0 ? <p className="text-sm text-[var(--muted)]">暂无用例结果。</p> : null}
                  {(modelEvalResult?.items ?? []).slice(0, 8).map((item: any) => (
                    <div key={`${item.case_id}-${item.model_id}`} className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{item.case_name} · {item.model_id}</span>
                        <span className={`rounded-full px-2 py-0.5 ring-1 ${badgeClass(item.status === "blocked" ? "high" : item.status === "watch" ? "medium" : "low")}`}>{item.score}</span>
                      </div>
                      <p className="mt-1 text-[var(--muted)]">质量 {item.quality_score} · 安全 {item.safety_score} · 成本 {item.cost_score} · 延迟 {item.latency_score}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--muted-strong)]">评测历史</p>
                  {(modelEvalRunsQ.data?.items ?? []).length === 0 ? <p className="text-sm text-[var(--muted)]">暂无持久化评测历史。</p> : null}
                  {(modelEvalRunsQ.data?.items ?? []).slice(0, 8).map((item: any) => (
                    <div key={item.id} className="rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono">{item.id}</span>
                        <span>{item.summary?.best_score ?? 0}</span>
                      </div>
                      <p className="mt-1 text-[var(--muted)]">{item.summary?.best_model || "-"} · {item.summary?.models ?? 0} 模型 · {item.created_at}</p>
                    </div>
                  ))}
                </div>
              </div>
            </WorkbenchPanel>
          </div>
        </div>
      )}

      {tab === "audit" && (
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <WorkbenchPanel title="Prompt 审计控制台" actions={
            <div className="flex flex-wrap gap-2">
              <button onClick={() => promptAudit.mutate(true)} disabled={promptAudit.isPending || !auditForm.prompt.trim()} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览审计</button>
              <button onClick={() => promptAudit.mutate(false)} disabled={promptAudit.isPending || !auditForm.prompt.trim()} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">审计并任务化</button>
            </div>
          }>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input-base" placeholder="任务类型" value={auditForm.task_type} onChange={(event) => setAuditForm((form) => ({ ...form, task_type: event.target.value }))} />
                <input className="input-base" placeholder="模型 ID" value={auditForm.model_id} onChange={(event) => setAuditForm((form) => ({ ...form, model_id: event.target.value }))} />
                <input className="input-base" placeholder="调用角色" value={auditForm.user_role} onChange={(event) => setAuditForm((form) => ({ ...form, user_role: event.target.value }))} />
                <input className="input-base" type="number" placeholder="最大 Prompt tokens" value={auditForm.max_prompt_tokens} onChange={(event) => setAuditForm((form) => ({ ...form, max_prompt_tokens: Number(event.target.value) }))} />
                <input className="input-base" placeholder="负责人" value={auditForm.assigned_to} onChange={(event) => setAuditForm((form) => ({ ...form, assigned_to: event.target.value }))} />
                <input className="input-base" placeholder="执行工具" value={auditForm.dev_tool} onChange={(event) => setAuditForm((form) => ({ ...form, dev_tool: event.target.value }))} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                  <input type="checkbox" checked={auditForm.allow_pii} onChange={(event) => setAuditForm((form) => ({ ...form, allow_pii: event.target.checked }))} />
                  允许已授权 PII
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                  <input type="checkbox" checked={auditForm.allow_secrets} onChange={(event) => setAuditForm((form) => ({ ...form, allow_secrets: event.target.checked }))} />
                  允许托管密钥引用
                </label>
              </div>
              <textarea
                className="input-base min-h-[220px] w-full font-mono text-xs leading-5"
                value={auditForm.prompt}
                onChange={(event) => setAuditForm((form) => ({ ...form, prompt: event.target.value }))}
                placeholder="粘贴待调用模型的 Prompt，审计时只保存 hash 与脱敏预览，不落库原文。"
              />
              <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">
                审计项覆盖明文密钥、Bearer Token、PII、提示词注入、上下文过长和代码上下文结构化质量；真实执行会把高风险发现生成任务中心治理任务。
              </div>
            </div>
          </WorkbenchPanel>

          <div className="space-y-4">
            <WorkbenchPanel title="审计结果">
              {!promptAuditResult ? <p className="text-sm text-[var(--muted)]">执行审计后展示决策、评分、风险发现、脱敏预览和任务化结果。</p> : null}
              {promptAuditResult ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-4">
                    {[
                      { label: "决策", value: promptAuditResult.decision ?? "-" },
                      { label: "评分", value: promptAuditResult.summary?.score ?? 0 },
                      { label: "发现", value: promptAuditResult.summary?.findings ?? 0 },
                      { label: "已生成", value: promptAuditResult.created ?? 0 },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                        <p className="text-xl font-semibold">{item.value}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{item.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <p className="text-xs font-semibold text-[var(--muted-strong)]">脱敏预览</p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">{promptAuditResult.prompt_profile?.redacted_preview || "-"}</pre>
                  </div>
                  {(promptAuditResult.items ?? []).length === 0 ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Prompt 审计通过，未发现高风险项。</p> : null}
                  {(promptAuditResult.items ?? []).map((item: any) => (
                    <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{item.title}</p>
                          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.recommendation}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(item.severity)}`}>{item.severity}</span>
                      </div>
                      <p className="mt-2 rounded bg-[var(--surface-muted)] px-2 py-1 font-mono text-[11px] text-[var(--muted)]">{item.kind} · {item.evidence}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </WorkbenchPanel>

            <WorkbenchPanel title="审计历史">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                  <p className="text-2xl font-semibold">{promptAuditRunsQ.data?.summary?.runs ?? 0}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">运行数</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                  <p className="text-2xl font-semibold text-red-700">{promptAuditRunsQ.data?.summary?.blocked ?? 0}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">阻断</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                  <p className="text-2xl font-semibold">{promptAuditRunsQ.data?.summary?.latest_score ?? 0}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">最近评分</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {(promptAuditRunsQ.data?.items ?? []).length === 0 ? <p className="text-sm text-[var(--muted)]">暂无持久化审计历史。</p> : null}
                {(promptAuditRunsQ.data?.items ?? []).slice(0, 8).map((item: any) => (
                  <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{item.prompt_profile?.task_type || "general"} · {item.prompt_profile?.model_id || "-"}</span>
                      <span className={`rounded-full px-2 py-0.5 ring-1 ${badgeClass(item.decision)}`}>{item.decision}</span>
                    </div>
                    <p className="mt-1 text-[var(--muted)]">发现 {item.summary?.findings ?? 0} · 评分 {item.summary?.score ?? 0} · {item.created_at}</p>
                  </div>
                ))}
              </div>
            </WorkbenchPanel>
          </div>
        </div>
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
