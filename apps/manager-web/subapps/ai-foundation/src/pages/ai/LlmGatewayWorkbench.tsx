import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Drawer, Form, Input, InputNumber, Segmented, Select, Space, Steps, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
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

const DEFAULT_ROUTE_FORM = { name: "", task_type: "general", model_id: "", priority: 0, fallback_model_id: "", enabled: true };
const DEFAULT_DECISION_FORM = { task_type: "code", estimated_prompt_tokens: 4000, estimated_completion_tokens: 1200, required_quality: "balanced", allow_fallback: true };
const DEFAULT_THROTTLE_FORM = { model_id: "", rpm_limit: 60, tpm_limit: 100000, enabled: true };
const DEFAULT_USAGE_FORM = { model_id: "", prompt_tokens: 1000, completion_tokens: 500, cost_usd: 0.01, latency_ms: 800, task_type: "general" };
const DEFAULT_ATTRIBUTION_FORM = { min_cost_usd: 0, dry_run: true, create_tasks: false, assigned_to: "AI Platform", dev_tool: "codex", note: "" };
const DEFAULT_EVAL_FORM = {
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
};
const DEFAULT_AUDIT_FORM = {
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
};
const DEFAULT_POLICY_FORM = {
  enabled: true,
  daily_budget_usd: 100,
  block_on_budget: true,
  require_provider_health: true,
  max_provider_latency_ms: 5000,
  max_provider_error_rate: 0.5,
  cost_anomaly_threshold_usd: 1,
};
const DEFAULT_PROVIDER_HEALTH_FORM = { model_id: "", status: "healthy", latency_ms: 800, error_rate: 0, note: "" };

export function LlmGatewayWorkbench({ focused: _focused, initialTab = "health" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const qc = useQueryClient();
  const [routeForm] = Form.useForm();
  const [policyAntForm] = Form.useForm();
  const [providerHealthForm] = Form.useForm();
  const [throttleForm] = Form.useForm();
  const [decisionForm] = Form.useForm();
  const [usageAntForm] = Form.useForm();
  const [attributionAntForm] = Form.useForm();
  const [evalAntForm] = Form.useForm();
  const [auditAntForm] = Form.useForm();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showRouteDrawer, setShowRouteDrawer] = useState(false);
  const [showPolicyDrawer, setShowPolicyDrawer] = useState(false);
  const [showProviderDrawer, setShowProviderDrawer] = useState(false);
  const [showThrottleDrawer, setShowThrottleDrawer] = useState(false);
  const [showDecisionDrawer, setShowDecisionDrawer] = useState(false);
  const [showUsageDrawer, setShowUsageDrawer] = useState(false);
  const [showAttributionDrawer, setShowAttributionDrawer] = useState(false);
  const [showEvalDrawer, setShowEvalDrawer] = useState(false);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
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
  const [rForm, setRForm] = useState(DEFAULT_ROUTE_FORM);
  const [dForm, setDForm] = useState(DEFAULT_DECISION_FORM);
  const [tForm, setTForm] = useState(DEFAULT_THROTTLE_FORM);
  const [usageForm, setUsageForm] = useState(DEFAULT_USAGE_FORM);
  const [attributionForm, setAttributionForm] = useState(DEFAULT_ATTRIBUTION_FORM);
  const [evalForm, setEvalForm] = useState(DEFAULT_EVAL_FORM);
  const [auditForm, setAuditForm] = useState(DEFAULT_AUDIT_FORM);
  const [policyForm, setPolicyForm] = useState(DEFAULT_POLICY_FORM);
  const [providerForm, setProviderForm] = useState(DEFAULT_PROVIDER_HEALTH_FORM);

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
    const next = {
      enabled: Boolean(policy.enabled),
      daily_budget_usd: Number(policy.daily_budget_usd ?? 100),
      block_on_budget: Boolean(policy.block_on_budget),
      require_provider_health: Boolean(policy.require_provider_health),
      max_provider_latency_ms: Number(policy.max_provider_latency_ms ?? 5000),
      max_provider_error_rate: Number(policy.max_provider_error_rate ?? 0.5),
      cost_anomaly_threshold_usd: Number(policy.cost_anomaly_threshold_usd ?? 1),
    };
    setPolicyForm(next);
    policyAntForm.setFieldsValue(next);
  }, [policyAntForm, policyQ.data?.policy]);

  const createRoute = useMutation({
    mutationFn: (draft: typeof DEFAULT_ROUTE_FORM = rForm) => api.llmRouteCreate(draft),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["llmRoutes"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
      setShowRouteDrawer(false);
      setRForm(DEFAULT_ROUTE_FORM);
      routeForm.resetFields();
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
    mutationFn: (draft: typeof DEFAULT_DECISION_FORM = dForm) => api.llmDecision(draft),
    onSuccess: (data, draft = dForm) => {
      setDForm(draft);
      setDecisionResult(data);
      setShowDecisionDrawer(false);
    },
  });
  const policyEvaluate = useMutation({
    mutationFn: (draft: typeof DEFAULT_DECISION_FORM = dForm) => api.llmPolicyEvaluate(draft),
    onSuccess: (data, draft = dForm) => {
      setDForm(draft);
      setPolicyDecisionResult(data);
      setShowDecisionDrawer(false);
    },
  });
  const updatePolicy = useMutation({
    mutationFn: (draft: typeof DEFAULT_POLICY_FORM = policyForm) => api.llmGatewayPolicyUpdate(draft),
    onSuccess: (_, draft = policyForm) => {
      setPolicyForm(draft);
      setShowPolicyDrawer(false);
      void qc.invalidateQueries({ queryKey: ["llmGatewayPolicies"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
    },
  });
  const recordProviderHealth = useMutation({
    mutationFn: (draft: typeof DEFAULT_PROVIDER_HEALTH_FORM = providerForm) => api.llmProviderHealthRecord(draft),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["llmProviderHealth"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
      setShowProviderDrawer(false);
      setProviderForm(DEFAULT_PROVIDER_HEALTH_FORM);
      providerHealthForm.resetFields();
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
    mutationFn: (draft: typeof DEFAULT_ATTRIBUTION_FORM = attributionForm) => api.llmCostAttributionRun({
      min_cost_usd: draft.min_cost_usd,
      dry_run: draft.dry_run,
      persist: true,
      create_tasks: draft.create_tasks,
      assigned_to: draft.assigned_to,
      dev_tool: draft.dev_tool,
      note: draft.note,
    }),
    onSuccess: (data, draft = attributionForm) => {
      setAttributionForm(draft);
      setCostAttributionResult(data);
      setShowAttributionDrawer(false);
      if (!draft.dry_run) {
        void qc.invalidateQueries({ queryKey: ["llmCostAttributionRuns"] });
      }
    },
  });
  const modelEval = useMutation({
    mutationFn: (draft: typeof DEFAULT_EVAL_FORM = evalForm) => {
      let cases: any[] = [];
      let actualOutputs: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(draft.cases_json || "[]");
        cases = Array.isArray(parsed) ? parsed : [];
      } catch {
        cases = [];
      }
      try {
        const parsed = JSON.parse(draft.actual_outputs_json || "{}");
        actualOutputs = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        actualOutputs = {};
      }
      return api.llmModelEvalRun({
        model_ids: draft.model_ids.split(",").map((item) => item.trim()).filter(Boolean),
        cases,
        actual_outputs: actualOutputs,
        min_score: draft.min_score,
        dry_run: draft.dry_run,
        persist: true,
        create_tasks: draft.create_tasks,
        assigned_to: draft.assigned_to,
        dev_tool: draft.dev_tool,
        note: draft.note,
      });
    },
    onSuccess: (data, draft = evalForm) => {
      setEvalForm(draft);
      setModelEvalResult(data);
      setShowEvalDrawer(false);
      if (!draft.dry_run) {
        void qc.invalidateQueries({ queryKey: ["llmModelEvalRuns"] });
      }
    },
  });
  const promptAudit = useMutation({
    mutationFn: ({ draft, dryRun }: { draft: typeof DEFAULT_AUDIT_FORM; dryRun: boolean }) => api.llmPromptAuditRun({ ...draft, dry_run: dryRun, persist: true }),
    onSuccess: (data, variables) => {
      setAuditForm(variables.draft);
      setPromptAuditResult(data);
      setShowAuditDrawer(false);
      if (!variables.dryRun) {
        void qc.invalidateQueries({ queryKey: ["llmPromptAuditRuns"] });
      }
    },
  });
  const createThrottle = useMutation({
    mutationFn: (draft: typeof DEFAULT_THROTTLE_FORM = tForm) => api.llmThrottleCreate(draft),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["llmThrottle"] });
      void qc.invalidateQueries({ queryKey: ["llmGatewayHealth"] });
      setShowThrottleDrawer(false);
      setTForm(DEFAULT_THROTTLE_FORM);
      throttleForm.resetFields();
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
    mutationFn: (draft: typeof DEFAULT_USAGE_FORM = usageForm) => api.llmRecordCost(draft),
    onSuccess: (_, draft = usageForm) => {
      setUsageForm(draft);
      setShowUsageDrawer(false);
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
  const routeColumns: ColumnsType<any> = [
    {
      title: "路由名称",
      dataIndex: "name",
      render: (_value, route) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--text)]">{route.name}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{route.id}</p>
        </div>
      ),
    },
    {
      title: "任务类型",
      dataIndex: "task_type",
      width: 130,
      render: (value) => <Tag color="blue">{value || "general"}</Tag>,
    },
    {
      title: "模型",
      dataIndex: "model_id",
      render: (_value, route) => (
        <div className="min-w-0 font-mono text-xs">
          <p className="truncate text-[var(--text)]">{route.model_id}</p>
          <p className="mt-1 truncate text-[var(--muted)]">fallback: {route.fallback_model_id || "-"}</p>
        </div>
      ),
    },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 110,
      render: (enabled, route) => (
        <Space size={4} wrap>
          <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "禁用"}</Tag>
          <Tag>{route.priority ?? 0}</Tag>
        </Space>
      ),
    },
    {
      title: "操作",
      width: 90,
      render: (_value, route) => (
        <button onClick={() => deleteRoute.mutate(route.id)} className="text-xs text-red-500 hover:underline">删除</button>
      ),
    },
  ];
  const providerColumns: ColumnsType<any> = [
    {
      title: "模型",
      dataIndex: "model_id",
      render: (value) => <span className="font-mono text-xs">{value}</span>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (value) => {
        const status = String(value || "healthy");
        const color = ["healthy", "ok", "active"].includes(status.toLowerCase()) ? "green" : status === "degraded" ? "gold" : "red";
        return <Tag color={color}>{status}</Tag>;
      },
    },
    {
      title: "延迟",
      dataIndex: "latency_ms",
      width: 110,
      render: (value) => `${value ?? 0}ms`,
    },
    {
      title: "错误率",
      dataIndex: "error_rate",
      width: 110,
      render: (value) => value ?? 0,
    },
    {
      title: "备注",
      dataIndex: "note",
      render: (value) => <span className="line-clamp-1 text-xs text-[var(--muted)]">{value || "-"}</span>,
    },
  ];
  const throttleColumns: ColumnsType<any> = [
    {
      title: "模型 ID",
      dataIndex: "model_id",
      render: (value) => <span className="font-mono text-xs">{value}</span>,
    },
    {
      title: "RPM",
      dataIndex: "rpm_limit",
      width: 120,
    },
    {
      title: "TPM",
      dataIndex: "tpm_limit",
      width: 140,
      render: (value) => Number(value ?? 0).toLocaleString(),
    },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 110,
      render: (enabled) => <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "禁用"}</Tag>,
    },
    {
      title: "操作",
      width: 90,
      render: (_value, item) => (
        <button onClick={() => deleteThrottle.mutate(item.id)} className="text-xs text-red-500 hover:underline">删除</button>
      ),
    },
  ];

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

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
        <Segmented
          value={tab}
          onChange={(value) => {
            setTab(value as Tab);
            setShowRouteDrawer(false);
            setShowThrottleDrawer(false);
            setShowDecisionDrawer(false);
            setShowUsageDrawer(false);
            setShowAttributionDrawer(false);
            setShowEvalDrawer(false);
            setShowAuditDrawer(false);
          }}
          options={tabs.map((item) => ({
            label: item.key === "routes" ? `${item.label} (${routes.length})` : item.label,
            value: item.key,
          }))}
        />
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
            <Button
              type="primary"
              loading={updatePolicy.isPending}
              onClick={() => {
                policyAntForm.setFieldsValue(policyForm);
                setShowPolicyDrawer(true);
              }}
            >
              编辑策略
            </Button>
          }>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">每日预算</div>
                <div className="mt-1 text-2xl font-semibold">${policyForm.daily_budget_usd}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">Provider 健康阈值</div>
                <div className="mt-1 text-sm font-semibold">{policyForm.max_provider_latency_ms}ms · 错误率 {Math.round(Number(policyForm.max_provider_error_rate) * 100)}%</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full px-2 py-1 ${policyForm.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>策略 {policyForm.enabled ? "启用" : "停用"}</span>
              <span className={`rounded-full px-2 py-1 ${policyForm.block_on_budget ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>预算阻断 {policyForm.block_on_budget ? "开启" : "关闭"}</span>
              <span className={`rounded-full px-2 py-1 ${policyForm.require_provider_health ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>Provider 健康 {policyForm.require_provider_health ? "强制" : "提示"}</span>
              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[var(--muted)]">成本异常 ≥ ${policyForm.cost_anomaly_threshold_usd}</span>
            </div>
            <div className="mt-4 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">
              当前策略：预算 ${policy.daily_budget_usd ?? 0}，Provider 延迟阈值 {policy.max_provider_latency_ms ?? 0}ms，错误率阈值 {policy.max_provider_error_rate ?? 0}，成本异常阈值 ${policy.cost_anomaly_threshold_usd ?? 0}。
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="Provider 健康上报" actions={
            <div className="flex flex-wrap gap-2">
              <RefreshButton onClick={() => void providerHealthQ.refetch()} pending={providerHealthQ.isFetching} />
              <Button
                type="primary"
                loading={recordProviderHealth.isPending}
                onClick={() => {
                  providerHealthForm.setFieldsValue(providerForm);
                  setShowProviderDrawer(true);
                }}
              >
                上报健康
              </Button>
            </div>
          }>
            <Table
              rowKey={(item) => item.id || item.model_id}
              size="small"
              columns={providerColumns}
              dataSource={providerHealth}
              loading={providerHealthQ.isLoading || providerHealthQ.isFetching}
              pagination={false}
              scroll={{ x: 720 }}
              locale={{ emptyText: "暂无 Provider 健康上报" }}
            />
          </WorkbenchPanel>
        </div>
      )}

      {tab === "routes" && (
        <WorkbenchPanel title="模型路由规则" actions={
          <div className="flex gap-2">
            <RefreshButton onClick={() => void routesQ.refetch()} pending={routesQ.isFetching} />
            <Button
              type="primary"
              onClick={() => {
                routeForm.setFieldsValue(rForm);
                setShowRouteDrawer(true);
              }}
            >
              新建路由
            </Button>
          </div>
        }>
          <Table
            rowKey="id"
            size="small"
            columns={routeColumns}
            dataSource={routes}
            loading={routesQ.isLoading || routesQ.isFetching}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ x: 860 }}
            locale={{ emptyText: "暂无路由规则" }}
          />
        </WorkbenchPanel>
      )}

      {tab === "decision" && (
        <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <WorkbenchPanel title="调用前路由决策" actions={
            <Button
              type="primary"
              onClick={() => {
                decisionForm.setFieldsValue(dForm);
                setShowDecisionDrawer(true);
              }}
            >
              发起决策
            </Button>
          }>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">任务类型</p>
                <p className="mt-1 font-mono text-sm font-semibold">{dForm.task_type || "general"}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">质量策略</p>
                <p className="mt-1 text-sm font-semibold">{dForm.required_quality} · fallback {dForm.allow_fallback ? "允许" : "关闭"}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">预计 Prompt</p>
                <p className="mt-1 text-xl font-semibold">{dForm.estimated_prompt_tokens}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">预计 Completion</p>
                <p className="mt-1 text-xl font-semibold">{dForm.estimated_completion_tokens}</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">
              决策会同时参考路由规则、Provider 健康、预算策略、限流和 fallback 配置；策略评估适合上线前拦截，基础决策适合调试模型选择。
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
        <WorkbenchPanel title="成本统计" actions={
          <Space wrap>
            <RefreshButton onClick={() => void costQ.refetch()} pending={costQ.isFetching} />
            <Button
              type="primary"
              onClick={() => {
                usageAntForm.setFieldsValue(usageForm);
                setShowUsageDrawer(true);
              }}
            >
              记录调用
            </Button>
          </Space>
        }>
          <div className="grid gap-4 sm:grid-cols-3 mb-4">
            {[{ label: "总费用($)", value: costQ.data?.total_cost_usd ?? 0 }, { label: "总 Token", value: costQ.data?.total_tokens ?? 0 }, { label: "统计周期", value: "7d" }].map((item) => (
              <div key={item.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
                <p className="text-2xl font-bold text-[var(--text)]">{item.value}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{item.label}</p>
              </div>
            ))}
          </div>
          <div className="mb-4 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">
            最近记录模板：{usageForm.model_id || "未选择模型"} · {usageForm.task_type} · {usageForm.prompt_tokens + usageForm.completion_tokens} tokens · ${usageForm.cost_usd}。
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
            <Button
              type="primary"
              loading={costAttribution.isPending}
              onClick={() => {
                attributionAntForm.setFieldsValue(attributionForm);
                setShowAttributionDrawer(true);
              }}
            >
              运行归因
            </Button>
          }>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">运行模式</p>
                <p className="mt-1 text-sm font-semibold">{attributionForm.dry_run ? "预览，不落库" : "执行并保存"}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">任务化</p>
                <p className="mt-1 text-sm font-semibold">{attributionForm.create_tasks ? "生成治理任务" : "仅分析"}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">成本过滤</p>
                <p className="mt-1 text-sm font-semibold">≥ ${attributionForm.min_cost_usd}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">执行人/工具</p>
                <p className="mt-1 truncate text-sm font-semibold">{attributionForm.assigned_to} · {attributionForm.dev_tool}</p>
              </div>
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
            <Button
              type="primary"
              loading={modelEval.isPending}
              onClick={() => {
                evalAntForm.setFieldsValue(evalForm);
                setShowEvalDrawer(true);
              }}
            >
              运行评测
            </Button>
          }>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 sm:col-span-2">
                <p className="text-xs text-[var(--muted)]">候选模型</p>
                <p className="mt-1 truncate font-mono text-sm font-semibold">{evalForm.model_ids || "使用路由主模型和 fallback"}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">通过阈值</p>
                <p className="mt-1 text-xl font-semibold">{evalForm.min_score}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">运行模式</p>
                <p className="mt-1 text-sm font-semibold">{evalForm.dry_run ? "预览，不落库" : evalForm.create_tasks ? "执行并生成任务" : "执行并保存结果"}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">负责人</p>
                <p className="mt-1 truncate text-sm font-semibold">{evalForm.assigned_to}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">用例 JSON</p>
                <p className="mt-1 text-sm font-semibold">{evalForm.cases_json.length} chars</p>
              </div>
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
            <Button
              type="primary"
              loading={promptAudit.isPending}
              onClick={() => {
                auditAntForm.setFieldsValue(auditForm);
                setShowAuditDrawer(true);
              }}
            >
              发起审计
            </Button>
          }>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-xs text-[var(--muted)]">任务/模型</p>
                  <p className="mt-1 truncate text-sm font-semibold">{auditForm.task_type} · {auditForm.model_id}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-xs text-[var(--muted)]">调用角色</p>
                  <p className="mt-1 text-sm font-semibold">{auditForm.user_role}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-xs text-[var(--muted)]">Token 上限</p>
                  <p className="mt-1 text-xl font-semibold">{auditForm.max_prompt_tokens}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-xs text-[var(--muted)]">敏感信息策略</p>
                  <p className="mt-1 text-sm font-semibold">PII {auditForm.allow_pii ? "允许" : "阻断"} · Secret {auditForm.allow_secrets ? "允许" : "阻断"}</p>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs font-semibold text-[var(--muted-strong)]">Prompt 预览</p>
                <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">{auditForm.prompt}</p>
              </div>
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
            <Button
              type="primary"
              onClick={() => {
                throttleForm.setFieldsValue(tForm);
                setShowThrottleDrawer(true);
              }}
            >
              新建限流
            </Button>
          </div>
        }>
          <Table
            rowKey="id"
            size="small"
            columns={throttleColumns}
            dataSource={throttles}
            loading={throttleQ.isLoading || throttleQ.isFetching}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ x: 680 }}
            locale={{ emptyText: "暂无限流策略" }}
          />
        </WorkbenchPanel>
      )}

      <Drawer
        title="发起调用决策"
        width={560}
        open={showDecisionDrawer}
        onClose={() => setShowDecisionDrawer(false)}
        destroyOnClose
        extra={
          <Space wrap>
            <Button onClick={() => setShowDecisionDrawer(false)}>取消</Button>
            <Button
              loading={decision.isPending}
              onClick={() => {
                void decisionForm.validateFields().then((values) => {
                  const draft = { ...DEFAULT_DECISION_FORM, ...dForm, ...values };
                  setDForm(draft);
                  decision.mutate(draft);
                });
              }}
            >
              基础决策
            </Button>
            <Button
              type="primary"
              loading={policyEvaluate.isPending}
              onClick={() => {
                void decisionForm.validateFields().then((values) => {
                  const draft = { ...DEFAULT_DECISION_FORM, ...dForm, ...values };
                  setDForm(draft);
                  policyEvaluate.mutate(draft);
                });
              }}
            >
              策略评估
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Steps size="small" current={0} items={[{ title: "调用画像" }, { title: "策略护栏" }, { title: "模型选择" }]} />
          <Form
            form={decisionForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={dForm}
            onValuesChange={(_, values) => setDForm((form) => ({ ...form, ...values }))}
          >
            <Form.Item name="task_type" label="任务类型" rules={[{ required: true, message: "请输入任务类型" }]}>
              <Input placeholder="code_review" />
            </Form.Item>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="estimated_prompt_tokens" label="预计 Prompt tokens">
                <InputNumber min={0} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="estimated_completion_tokens" label="预计 Completion tokens">
                <InputNumber min={0} precision={0} className="w-full" />
              </Form.Item>
            </div>
            <Form.Item name="required_quality" label="质量要求">
              <Select
                options={[
                  { label: "fast", value: "fast" },
                  { label: "balanced", value: "balanced" },
                  { label: "high", value: "high" },
                ]}
              />
            </Form.Item>
            <Form.Item name="allow_fallback" label="允许 fallback" valuePropName="checked">
              <Switch />
            </Form.Item>
            {(decision.error || policyEvaluate.error) ? <Alert type="error" showIcon message={((decision.error || policyEvaluate.error) as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="记录模型调用"
        width={560}
        open={showUsageDrawer}
        onClose={() => setShowUsageDrawer(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowUsageDrawer(false)}>取消</Button>
            <Button type="primary" loading={recordCost.isPending} onClick={() => usageAntForm.submit()} disabled={!usageForm.model_id.trim()}>
              记录调用
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Steps size="small" current={0} items={[{ title: "模型" }, { title: "Token" }, { title: "成本" }]} />
          <Form
            form={usageAntForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={usageForm}
            onValuesChange={(_, values) => setUsageForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => recordCost.mutate({ ...DEFAULT_USAGE_FORM, ...usageForm, ...values })}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="model_id" label="模型 ID" rules={[{ required: true, message: "请输入模型 ID" }]}>
                <Input placeholder="gpt-5" />
              </Form.Item>
              <Form.Item name="task_type" label="任务类型">
                <Input placeholder="general" />
              </Form.Item>
              <Form.Item name="prompt_tokens" label="Prompt tokens">
                <InputNumber min={0} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="completion_tokens" label="Completion tokens">
                <InputNumber min={0} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="cost_usd" label="费用 USD">
                <InputNumber min={0} step={0.001} className="w-full" />
              </Form.Item>
              <Form.Item name="latency_ms" label="延迟 ms">
                <InputNumber min={0} precision={0} className="w-full" />
              </Form.Item>
            </div>
            {recordCost.error ? <Alert type="error" showIcon message={(recordCost.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="运行成本归因"
        width={600}
        open={showAttributionDrawer}
        onClose={() => setShowAttributionDrawer(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowAttributionDrawer(false)}>取消</Button>
            <Button type="primary" loading={costAttribution.isPending} onClick={() => attributionAntForm.submit()}>
              运行归因
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Steps size="small" current={0} items={[{ title: "过滤" }, { title: "执行方式" }, { title: "任务化" }]} />
          <Form
            form={attributionAntForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={attributionForm}
            onValuesChange={(_, values) => setAttributionForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => costAttribution.mutate({ ...DEFAULT_ATTRIBUTION_FORM, ...attributionForm, ...values })}
          >
            <Form.Item name="min_cost_usd" label="最小成本过滤 USD">
              <InputNumber min={0} step={0.001} className="w-full" />
            </Form.Item>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="dry_run" label="预览模式" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="create_tasks" label="同步生成治理任务" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="assigned_to" label="负责人">
                <Input />
              </Form.Item>
              <Form.Item name="dev_tool" label="执行工具">
                <Input />
              </Form.Item>
            </div>
            <Form.Item name="note" label="备注">
              <Input.TextArea rows={3} placeholder="可填写本次归因目的或排查上下文" />
            </Form.Item>
            {costAttribution.error ? <Alert type="error" showIcon message={(costAttribution.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="运行模型评测"
        width={720}
        open={showEvalDrawer}
        onClose={() => setShowEvalDrawer(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowEvalDrawer(false)}>取消</Button>
            <Button type="primary" loading={modelEval.isPending} onClick={() => evalAntForm.submit()}>
              运行评测
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Steps size="small" current={0} items={[{ title: "候选模型" }, { title: "用例" }, { title: "结果治理" }]} />
          <Alert type="info" showIcon message="建议先预览评测，再执行落库或生成治理任务。" />
          <Form
            form={evalAntForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={evalForm}
            onValuesChange={(_, values) => setEvalForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => modelEval.mutate({ ...DEFAULT_EVAL_FORM, ...evalForm, ...values })}
          >
            <Form.Item name="model_ids" label="候选模型，逗号分隔">
              <Input placeholder="gpt-5-mini, claude-sonnet" />
            </Form.Item>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="min_score" label="通过阈值">
                <InputNumber min={0} max={100} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="dry_run" label="预览模式" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="create_tasks" label="同步生成治理任务" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="assigned_to" label="负责人">
                <Input />
              </Form.Item>
              <Form.Item name="dev_tool" label="执行工具">
                <Input />
              </Form.Item>
            </div>
            <Form.Item
              name="cases_json"
              label="评测用例 JSON"
              rules={[{
                validator: (_, value) => {
                  try {
                    const parsed = JSON.parse(value || "[]");
                    return Array.isArray(parsed) ? Promise.resolve() : Promise.reject(new Error("请输入 JSON 数组"));
                  } catch {
                    return Promise.reject(new Error("请输入有效 JSON"));
                  }
                },
              }]}
            >
              <Input.TextArea rows={10} className="font-mono text-xs" />
            </Form.Item>
            <Form.Item
              name="actual_outputs_json"
              label="实际输出 JSON"
              rules={[{
                validator: (_, value) => {
                  try {
                    const parsed = JSON.parse(value || "{}");
                    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Promise.resolve() : Promise.reject(new Error("请输入 JSON 对象"));
                  } catch {
                    return Promise.reject(new Error("请输入有效 JSON"));
                  }
                },
              }]}
            >
              <Input.TextArea rows={5} className="font-mono text-xs" placeholder='{"case-1":{"gpt-5-mini":"..."}}' />
            </Form.Item>
            <Form.Item name="note" label="备注">
              <Input.TextArea rows={3} />
            </Form.Item>
            {modelEval.error ? <Alert type="error" showIcon message={(modelEval.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="发起 Prompt 审计"
        width={720}
        open={showAuditDrawer}
        onClose={() => setShowAuditDrawer(false)}
        destroyOnClose
        extra={
          <Space wrap>
            <Button onClick={() => setShowAuditDrawer(false)}>取消</Button>
            <Button
              loading={promptAudit.isPending}
              onClick={() => {
                void auditAntForm.validateFields().then((values) => {
                  const draft = { ...DEFAULT_AUDIT_FORM, ...auditForm, ...values };
                  setAuditForm(draft);
                  promptAudit.mutate({ draft, dryRun: true });
                });
              }}
            >
              预览审计
            </Button>
            <Button
              type="primary"
              loading={promptAudit.isPending}
              onClick={() => {
                void auditAntForm.validateFields().then((values) => {
                  const draft = { ...DEFAULT_AUDIT_FORM, ...auditForm, ...values };
                  setAuditForm(draft);
                  promptAudit.mutate({ draft, dryRun: false });
                });
              }}
            >
              审计并任务化
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Steps size="small" current={0} items={[{ title: "Prompt" }, { title: "敏感策略" }, { title: "治理任务" }]} />
          <Form
            form={auditAntForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={auditForm}
            onValuesChange={(_, values) => setAuditForm((form) => ({ ...form, ...values }))}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="task_type" label="任务类型">
                <Input placeholder="code" />
              </Form.Item>
              <Form.Item name="model_id" label="模型 ID">
                <Input placeholder="gpt-5" />
              </Form.Item>
              <Form.Item name="user_role" label="调用角色">
                <Input placeholder="agent" />
              </Form.Item>
              <Form.Item name="max_prompt_tokens" label="最大 Prompt tokens">
                <InputNumber min={1} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="assigned_to" label="负责人">
                <Input />
              </Form.Item>
              <Form.Item name="dev_tool" label="执行工具">
                <Input />
              </Form.Item>
              <Form.Item name="allow_pii" label="允许已授权 PII" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="allow_secrets" label="允许托管密钥引用" valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
            <Form.Item name="prompt" label="待审计 Prompt" rules={[{ required: true, message: "请输入待审计 Prompt" }]}>
              <Input.TextArea rows={10} className="font-mono text-xs" placeholder="审计时只保存 hash 与脱敏预览，不落库原文。" />
            </Form.Item>
            {promptAudit.error ? <Alert type="error" showIcon message={(promptAudit.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="编辑生产策略"
        width={600}
        open={showPolicyDrawer}
        onClose={() => setShowPolicyDrawer(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowPolicyDrawer(false)}>取消</Button>
            <Button type="primary" loading={updatePolicy.isPending} onClick={() => policyAntForm.submit()}>
              保存策略
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Steps
            size="small"
            current={0}
            items={[
              { title: "预算护栏" },
              { title: "Provider 健康" },
              { title: "成本治理" },
            ]}
          />
          <Alert
            type="info"
            showIcon
            message="生产策略会影响所有模型调用前决策"
            description="建议保持预算阻断和 Provider 健康校验开启，避免不可控成本和异常 Provider 继续承接任务。"
          />
          <Form
            form={policyAntForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={policyForm}
            onValuesChange={(_, values) => setPolicyForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => updatePolicy.mutate({ ...DEFAULT_POLICY_FORM, ...policyForm, ...values })}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="enabled" label="启用模型网关策略" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="block_on_budget" label="超预算直接阻断" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="require_provider_health" label="强制 Provider 健康" valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="daily_budget_usd" label="每日预算 USD">
                <InputNumber min={0} step={1} className="w-full" />
              </Form.Item>
              <Form.Item name="max_provider_latency_ms" label="最大延迟 ms">
                <InputNumber min={0} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="max_provider_error_rate" label="最大错误率">
                <InputNumber min={0} max={1} step={0.01} className="w-full" />
              </Form.Item>
              <Form.Item name="cost_anomaly_threshold_usd" label="成本异常阈值 USD">
                <InputNumber min={0} step={0.01} className="w-full" />
              </Form.Item>
            </div>
            {updatePolicy.error ? <Alert type="error" showIcon message={(updatePolicy.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="上报 Provider 健康"
        width={560}
        open={showProviderDrawer}
        onClose={() => setShowProviderDrawer(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowProviderDrawer(false)}>取消</Button>
            <Button type="primary" loading={recordProviderHealth.isPending} onClick={() => providerHealthForm.submit()} disabled={!providerForm.model_id.trim()}>
              上报健康
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Steps
            size="small"
            current={0}
            items={[
              { title: "选择模型" },
              { title: "健康指标" },
              { title: "策略联动" },
            ]}
          />
          <Form
            form={providerHealthForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={providerForm}
            onValuesChange={(_, values) => setProviderForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => recordProviderHealth.mutate({ ...DEFAULT_PROVIDER_HEALTH_FORM, ...providerForm, ...values })}
          >
            <Form.Item name="model_id" label="模型 ID" rules={[{ required: true, message: "请输入模型 ID" }]}>
              <Input placeholder="gpt-5" />
            </Form.Item>
            <Form.Item name="status" label="健康状态">
              <Select
                options={[
                  { label: "healthy", value: "healthy" },
                  { label: "degraded", value: "degraded" },
                  { label: "down", value: "down" },
                ]}
              />
            </Form.Item>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="latency_ms" label="延迟 ms">
                <InputNumber min={0} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="error_rate" label="错误率">
                <InputNumber min={0} max={1} step={0.01} className="w-full" />
              </Form.Item>
            </div>
            <Form.Item name="note" label="备注">
              <Input placeholder="例如 provider region degraded" />
            </Form.Item>
            {recordProviderHealth.error ? <Alert type="error" showIcon message={(recordProviderHealth.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="新建模型路由"
        width={560}
        open={showRouteDrawer}
        onClose={() => setShowRouteDrawer(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowRouteDrawer(false)}>取消</Button>
            <Button type="primary" loading={createRoute.isPending} onClick={() => routeForm.submit()} disabled={!rForm.name.trim() || !rForm.model_id.trim()}>
              创建路由
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Steps
            size="small"
            current={0}
            items={[
              { title: "任务类型" },
              { title: "模型路由" },
              { title: "Fallback" },
            ]}
          />
          <Form
            form={routeForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={rForm}
            onValuesChange={(_, values) => setRForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => createRoute.mutate({ ...DEFAULT_ROUTE_FORM, ...rForm, ...values })}
          >
            <Form.Item name="name" label="路由名称" rules={[{ required: true, message: "请输入路由名称" }]}>
              <Input placeholder="Code review default route" />
            </Form.Item>
            <Form.Item name="task_type" label="任务类型">
              <Input placeholder="code_review" />
            </Form.Item>
            <Form.Item name="model_id" label="主模型 ID" rules={[{ required: true, message: "请输入主模型 ID" }]}>
              <Input placeholder="gpt-5" />
            </Form.Item>
            <Form.Item name="fallback_model_id" label="备用模型 ID">
              <Input placeholder="gpt-5-mini" />
            </Form.Item>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="priority" label="优先级">
                <InputNumber precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="enabled" label="启用路由" valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
            {createRoute.error ? <Alert type="error" showIcon message={(createRoute.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="新建限流策略"
        width={520}
        open={showThrottleDrawer}
        onClose={() => setShowThrottleDrawer(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowThrottleDrawer(false)}>取消</Button>
            <Button type="primary" loading={createThrottle.isPending} onClick={() => throttleForm.submit()} disabled={!tForm.model_id.trim()}>
              创建限流
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Steps
            size="small"
            current={0}
            items={[
              { title: "选择模型" },
              { title: "设置阈值" },
              { title: "调用保护" },
            ]}
          />
          <Form
            form={throttleForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={tForm}
            onValuesChange={(_, values) => setTForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => createThrottle.mutate({ ...DEFAULT_THROTTLE_FORM, ...tForm, ...values })}
          >
            <Form.Item name="model_id" label="模型 ID" rules={[{ required: true, message: "请输入模型 ID" }]}>
              <Input placeholder="gpt-5" />
            </Form.Item>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="rpm_limit" label="RPM 限制">
                <InputNumber min={1} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="tpm_limit" label="TPM 限制">
                <InputNumber min={1} precision={0} className="w-full" />
              </Form.Item>
            </div>
            <Form.Item name="enabled" label="启用限流" valuePropName="checked">
              <Switch />
            </Form.Item>
            {createThrottle.error ? <Alert type="error" showIcon message={(createThrottle.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="llm-gateway"
        title="AI 模型网关助手"
        context={{ routes_count: routes.length, summary }}
        initialPrompt="分析当前模型路由、成本、限流和 fallback 风险，给出优化策略" />
    </div>
  );
}
