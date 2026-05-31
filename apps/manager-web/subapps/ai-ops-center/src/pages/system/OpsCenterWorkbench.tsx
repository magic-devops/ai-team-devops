import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Form, Input, Select, Segmented, Space, Steps, Switch } from "antd";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

type Tab = "pipelines" | "alert-sources" | "rca" | "runbooks" | "self-heal";

const OPS_CENTER_TAB_ROUTES: Record<string, Tab> = {
  pipeline: "pipelines",
  pipelines: "pipelines",
  alerts: "alert-sources",
  "alert-sources": "alert-sources",
  rca: "rca",
  runbook: "runbooks",
  runbooks: "runbooks",
  "self-heal": "self-heal",
};

const OPS_CENTER_TAB_META: Record<Tab, { href: string; label: string; shortLabel: string; desc: string; output: string }> = {
  pipelines: {
    href: "#/system/ops-center/pipeline",
    label: "部署流水线",
    shortLabel: "流水线",
    desc: "发布、执行器、外部回调和发布证据。",
    output: "输出：受控发布记录、执行证据、自愈诊断",
  },
  "alert-sources": {
    href: "#/system/ops-center/alerts",
    label: "告警源治理",
    shortLabel: "告警源",
    desc: "生产告警采集、降噪、SLO 预测和策略联动。",
    output: "输出：标准化告警、降噪策略、SLO 升级任务",
  },
  rca: {
    href: "#/system/ops-center/rca",
    label: "根因分析",
    shortLabel: "RCA",
    desc: "智能归因、RCA 创建、验证计划和闭环关闭。",
    output: "输出：根因候选、RCA 记录、治理任务",
  },
  runbooks: {
    href: "#/system/ops-center/runbook",
    label: "Runbook",
    shortLabel: "Runbook",
    desc: "版本治理、差异对比、执行证据和审计归档。",
    output: "输出：可执行手册、版本证据、审计记录",
  },
  "self-heal": {
    href: "#/system/ops-center/self-heal",
    label: "自愈策略",
    shortLabel: "自愈",
    desc: "信号评估、护栏审批、自动修复和回滚留证。",
    output: "输出：自愈决策、护栏动作、验证证据",
  },
};

function readOpsCenterTabFromHash(fallback: Tab): Tab {
  const hash = window.location.hash || "";
  const [, routeTab] = hash.match(/^#\/system\/ops-center\/([^/?#]+)/) || [];
  return OPS_CENTER_TAB_ROUTES[routeTab || ""] || fallback;
}

function updateOpsCenterHash(tab: Tab) {
  const href = OPS_CENTER_TAB_META[tab].href;
  if (window.location.hash !== href) {
    window.history.replaceState(null, "", href);
  }
}

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

function actionStateClass(state?: string) {
  if (state === "approval_required" || state === "rolled_back") return "bg-red-50 text-red-700";
  if (state === "approved" || state === "applied") return "bg-amber-50 text-amber-700";
  if (state === "verified") return "bg-green-50 text-green-700";
  return "bg-slate-50 text-slate-700";
}

function parseJsonPayload(value: string) {
  const text = value.trim();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

export function OpsCenterWorkbench({ focused: _focused, initialTab = "pipelines" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(() => readOpsCenterTabFromHash(initialTab));
  const [showForm, setShowForm] = useState(false);
  const [pForm, setPForm] = useState({ name: "", environment: "staging", steps: "" });
  const [rcaForm, setRcaForm] = useState({ incident_id: "", root_cause: "", impact: "", resolution: "" });
  const [rcaCreateDrawerOpen, setRcaCreateDrawerOpen] = useState(false);
  const [rcaInsightFilter, setRcaInsightFilter] = useState({ run_id: "", trace_id: "", correlation_id: "", limit: "100", priority: "P1", assigned_to: "Ops Agent", dev_tool: "codex" });
  const [rcaInsightDrawerOpen, setRcaInsightDrawerOpen] = useState(false);
  const [rcaInsightResult, setRcaInsightResult] = useState<any>(null);
  const [rcaInsightTasksResult, setRcaInsightTasksResult] = useState<any>(null);
  const [rcaInsightCreateResult, setRcaInsightCreateResult] = useState<any>(null);
  const [rcaVerifyResult, setRcaVerifyResult] = useState<any>(null);
  const [alertSourceForm, setAlertSourceForm] = useState({
    name: "",
    source_type: "prometheus",
    endpoint: "",
    auth_ref: "",
    labels: "environment=production\nteam=sre",
    sample_payload: "{\"alerts\":[{\"labels\":{\"alertname\":\"ApiErrorRateHigh\",\"severity\":\"critical\",\"service\":\"api\"},\"annotations\":{\"description\":\"5xx above threshold\"},\"status\":{\"state\":\"active\"}}]}",
    timeout_s: "5",
    enabled: true,
  });
  const [alertSourceDrawerOpen, setAlertSourceDrawerOpen] = useState(false);
  const [alertSourceResult, setAlertSourceResult] = useState<any>(null);
  const [alertNoisePolicyForm, setAlertNoisePolicyForm] = useState({
    name: "生产告警降噪策略",
    group_by: "service,alertname,source_id",
    min_rca_severity: "high",
    suppress_severities: "info,low",
    note: "按服务和告警名分组，低优先级只观察，高风险进入 RCA。",
    enabled: true,
  });
  const [alertSilenceForm, setAlertSilenceForm] = useState({
    name: "维护窗口静默",
    matchers: "environment=staging",
    starts_at: "",
    ends_at: "",
    reason: "维护窗口或非生产环境降噪",
    owner: "Ops Lead",
    enabled: true,
  });
  const [alertNoiseConfigDrawer, setAlertNoiseConfigDrawer] = useState<"policy" | "silence" | null>(null);
  const [alertNoiseResult, setAlertNoiseResult] = useState<any>(null);
  const [alertStrategyResult, setAlertStrategyResult] = useState<any>(null);
  const [alertStrategyCompareResult, setAlertStrategyCompareResult] = useState<any>(null);
  const [alertSloResult, setAlertSloResult] = useState<any>(null);
  const [alertSloEscalationResult, setAlertSloEscalationResult] = useState<any>(null);
  const [alertSloEscalationForm, setAlertSloEscalationForm] = useState({
    enabled: true,
    min_risk_level: "high",
    min_breach_probability: "0.35",
    max_targets: "5",
    cooldown_minutes: "60",
    actions: "create_task,im_notify",
    priority: "P1",
    assigned_to: "Ops Agent",
    dev_tool: "codex",
    owner: "Ops Lead",
    note: "高风险 SLO 预测自动升级为任务和 IM 风险简报。",
  });
  const [alertSloEscalationDrawerOpen, setAlertSloEscalationDrawerOpen] = useState(false);
  const [alertStrategyCanaryResult, setAlertStrategyCanaryResult] = useState<any>(null);
  const [alertStrategyCanaryForm, setAlertStrategyCanaryForm] = useState({
    policy_id: "",
    candidate_id: "",
    traffic_percent: "10",
    refresh_inputs: true,
    created_by: "Ops Lead",
    note: "基于策略 A/B 对比、SLO 风险和升级记录生成灰度准入审计。",
  });
  const [alertStrategyCanaryDrawerOpen, setAlertStrategyCanaryDrawerOpen] = useState(false);
  const [opsStrategyLinkageResult, setOpsStrategyLinkageResult] = useState<any>(null);
  const [opsStrategyLinkageForm, setOpsStrategyLinkageForm] = useState({
    actions: "create_task,im_notify",
    max_items: "8",
    priority: "P1",
    assigned_to: "Ops Agent",
    dev_tool: "codex",
    note: "联动策略灰度审计、SLO 升级、Runbook、自愈、任务和 IM 通知。",
  });
  const [opsStrategyLinkageDrawerOpen, setOpsStrategyLinkageDrawerOpen] = useState(false);
  const [rbForm, setRbForm] = useState({ id: "", name: "", steps: "", tags: "", owner: "Ops Lead", change_note: "" });
  const [runbookEditorDrawerOpen, setRunbookEditorDrawerOpen] = useState(false);
  const [selectedRunbookId, setSelectedRunbookId] = useState("");
  const [runbookDiffResult, setRunbookDiffResult] = useState<any>(null);
  const [runbookEvidenceResult, setRunbookEvidenceResult] = useState<any>(null);
  const [shForm, setShForm] = useState({ trigger_condition: "", action: "", enabled: true });
  const [selfHealPolicyDrawerOpen, setSelfHealPolicyDrawerOpen] = useState(false);
  const [signalText, setSignalText] = useState("cpu=95\nerror_rate=3\nlatency_ms=1200\nenvironment=staging\nservice=api");
  const [selfHealSignalDrawerOpen, setSelfHealSignalDrawerOpen] = useState(false);
  const [healResult, setHealResult] = useState<any>(null);
  const [healTasksResult, setHealTasksResult] = useState<any>(null);
  const [healActionResult, setHealActionResult] = useState<any>(null);
  const [imResult, setImResult] = useState<any>(null);
  const [imChannels, setImChannels] = useState<string[]>([]);

  const summaryQ = useQuery({ queryKey: ["opsCenterSummary"], queryFn: api.opsCenterSummary, enabled: authed });
  const pipQ = useQuery({ queryKey: ["opsPipelines"], queryFn: api.opsPipelines, enabled: authed });
  const rcaQ = useQuery({ queryKey: ["opsRca"], queryFn: api.opsRca, enabled: authed && tab === "rca" });
  const alertSourcesQ = useQuery({ queryKey: ["opsAlertSources"], queryFn: api.opsAlertSources, enabled: authed && tab === "alert-sources" });
  const externalAlertsQ = useQuery({ queryKey: ["opsExternalAlerts"], queryFn: () => api.opsExternalAlerts({ limit: 100 }), enabled: authed && tab === "alert-sources" });
  const alertNoiseQ = useQuery({ queryKey: ["opsAlertNoisePolicies"], queryFn: api.opsAlertNoisePolicies, enabled: authed && tab === "alert-sources" });
  const alertNoiseHistoryQ = useQuery({ queryKey: ["opsAlertNoiseEvaluations"], queryFn: () => api.opsAlertNoiseEvaluations(20), enabled: authed && tab === "alert-sources" });
  const alertStrategyQ = useQuery({ queryKey: ["opsAlertStrategyRecommendations"], queryFn: () => api.opsAlertStrategyRecommendations({ limit: 20 }), enabled: authed && tab === "alert-sources" });
  const alertStrategyCompareRunsQ = useQuery({ queryKey: ["opsAlertStrategyCompareRuns"], queryFn: () => api.opsAlertStrategyCompareRuns(12), enabled: authed && tab === "alert-sources" });
  const alertSloPredictionRunsQ = useQuery({ queryKey: ["opsAlertSloPredictionRuns"], queryFn: () => api.opsAlertSloPredictionRuns(12), enabled: authed && tab === "alert-sources" });
  const alertSloEscalationPolicyQ = useQuery({ queryKey: ["opsAlertSloEscalationPolicy"], queryFn: api.opsAlertSloEscalationPolicy, enabled: authed && tab === "alert-sources" });
  const alertSloEscalationRunsQ = useQuery({ queryKey: ["opsAlertSloEscalationRuns"], queryFn: () => api.opsAlertSloEscalationRuns(12), enabled: authed && tab === "alert-sources" });
  const alertStrategyCanaryAuditsQ = useQuery({ queryKey: ["opsAlertStrategyCanaryAudits"], queryFn: () => api.opsAlertStrategyCanaryAudits(12), enabled: authed && tab === "alert-sources" });
  const opsStrategyLinkageRunsQ = useQuery({ queryKey: ["opsStrategyLinkageRuns"], queryFn: () => api.opsStrategyLinkageRuns(12), enabled: authed && tab === "alert-sources" });
  const rbQ = useQuery({ queryKey: ["opsRunbooks"], queryFn: api.opsRunbooks, enabled: authed && tab === "runbooks" });
  const rbVersionsQ = useQuery({
    queryKey: ["opsRunbookVersions", selectedRunbookId],
    queryFn: () => api.opsRunbookVersions(selectedRunbookId),
    enabled: authed && tab === "runbooks" && Boolean(selectedRunbookId),
  });
  const rbEvidenceQ = useQuery({
    queryKey: ["opsRunbookEvidence", selectedRunbookId],
    queryFn: () => api.opsRunbookEvidence({ runbook_id: selectedRunbookId || undefined, limit: 100 }),
    enabled: authed && tab === "runbooks",
  });
  const shQ = useQuery({ queryKey: ["opsSelfHeal"], queryFn: api.opsSelfHeal, enabled: authed && tab === "self-heal" });
  const evalQ = useQuery({ queryKey: ["opsSelfHealEvaluations"], queryFn: () => api.opsSelfHealEvaluations(20), enabled: authed && tab === "self-heal" });
  const actionsQ = useQuery({ queryKey: ["opsSelfHealActions"], queryFn: () => api.opsSelfHealActions("", 50), enabled: authed && tab === "self-heal" });
  const channelsQ = useQuery({ queryKey: ["notifyChannels"], queryFn: api.notifyChannels, enabled: authed });
  const enabledChannels = useMemo(() => (channelsQ.data ?? []).filter((ch: any) => ch.enabled), [channelsQ.data]);
  const latestStrategyCompare = alertStrategyCompareResult ?? alertStrategyCompareRunsQ.data?.items?.[0] ?? null;
  const latestSloPrediction = alertSloResult ?? alertSloPredictionRunsQ.data?.items?.[0] ?? null;
  const latestSloEscalation = alertSloEscalationResult ?? alertSloEscalationRunsQ.data?.items?.[0] ?? null;
  const latestStrategyCanary = alertStrategyCanaryResult ?? alertStrategyCanaryAuditsQ.data?.items?.[0] ?? null;
  const latestOpsStrategyLinkage = opsStrategyLinkageResult ?? opsStrategyLinkageRunsQ.data?.items?.[0] ?? null;
  const activeTabMeta = OPS_CENTER_TAB_META[tab];

  useEffect(() => {
    const onHashChange = () => {
      const next = readOpsCenterTabFromHash(initialTab);
      setTab(next);
      setShowForm(false);
    };
    window.addEventListener("hashchange", onHashChange);
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [initialTab]);

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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opsRca"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
      setShowForm(false);
      setRcaCreateDrawerOpen(false);
      setRcaForm({ incident_id: "", root_cause: "", impact: "", resolution: "" });
    },
  });
  const resolveRca = useMutation({
    mutationFn: (id: string) => api.opsRcaResolve(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsRca"] }),
  });
  const loadRcaVerificationPlan = useMutation({
    mutationFn: (id: string) => api.opsRcaVerificationPlan(id),
    onSuccess: (data) => setRcaVerifyResult(data),
  });
  const verifyRca = useMutation({
    mutationFn: (item: any) => api.opsRcaVerify(item.id, {
      verifier: "SRE",
      close_on_pass: true,
      note: "OpsCenter 工作台验证关闭",
      checks: {
        service_status: "healthy",
        metrics_status: "healthy",
        pipeline_status: "healthy",
        runbook_status: (item.selected_runbook_ids ?? item.recommended_runbooks ?? []).length > 0 ? "passed" : "pending",
        evidence_url: `ops-center://rca/${item.incident_id || item.id}/verification`,
        resolution: item.resolution || "已完成处置并通过 OpsCenter 自动验证。",
      },
    }),
    onSuccess: (data) => {
      setRcaVerifyResult(data);
      void qc.invalidateQueries({ queryKey: ["opsRca"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const analyzeRcaInsights = useMutation({
    mutationFn: () => api.opsRcaInsights({
      run_id: rcaInsightFilter.run_id,
      trace_id: rcaInsightFilter.trace_id,
      correlation_id: rcaInsightFilter.correlation_id,
      limit: Number(rcaInsightFilter.limit || 100),
    }),
    onSuccess: (data) => {
      setRcaInsightResult(data);
      setRcaInsightTasksResult(null);
      setRcaInsightCreateResult(null);
      setRcaVerifyResult(null);
    },
  });
  const createRcaInsightTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.opsRcaInsightTasks({
      run_id: rcaInsightFilter.run_id,
      trace_id: rcaInsightFilter.trace_id,
      correlation_id: rcaInsightFilter.correlation_id,
      limit: Number(rcaInsightFilter.limit || 100),
      dry_run: dryRun,
      priority: rcaInsightFilter.priority,
      assigned_to: rcaInsightFilter.assigned_to,
      dev_tool: rcaInsightFilter.dev_tool,
    }),
    onSuccess: (data, dryRun) => {
      setRcaInsightTasksResult(data);
      if (!dryRun) {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
      }
    },
  });
  const createRcaFromInsight = useMutation({
    mutationFn: (candidate: any) => api.opsRcaInsightCreateRca({
      run_id: rcaInsightFilter.run_id,
      trace_id: rcaInsightFilter.trace_id,
      correlation_id: rcaInsightFilter.correlation_id,
      limit: Number(rcaInsightFilter.limit || 100),
      candidate_id: candidate.id,
      owner: rcaInsightFilter.assigned_to,
      selected_runbook_ids: (candidate.recommended_runbooks ?? []).slice(0, 3).map((runbook: any) => runbook.id).filter(Boolean),
      note: `created from ${candidate.kind}`,
    }),
    onSuccess: (data) => {
      setRcaInsightCreateResult(data);
      void qc.invalidateQueries({ queryKey: ["opsRca"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const createAlertSource = useMutation({
    mutationFn: () => api.opsAlertSourceCreate({
      name: alertSourceForm.name,
      source_type: alertSourceForm.source_type,
      endpoint: alertSourceForm.endpoint,
      auth_ref: alertSourceForm.auth_ref,
      enabled: alertSourceForm.enabled,
      labels: parseSignals(alertSourceForm.labels),
      sample_payload: parseJsonPayload(alertSourceForm.sample_payload),
      timeout_s: Number(alertSourceForm.timeout_s || 5),
    }),
    onSuccess: (data) => {
      setAlertSourceResult({ type: "created", ...data });
      void qc.invalidateQueries({ queryKey: ["opsAlertSources"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
      setShowForm(false);
      setAlertSourceDrawerOpen(false);
    },
  });
  const syncAlertSources = useMutation({
    mutationFn: () => api.opsAlertSourceSync({ persist: true, limit: 100 }),
    onSuccess: (data) => {
      setAlertSourceResult({ type: "sync", ...data });
      void qc.invalidateQueries({ queryKey: ["opsAlertSources"] });
      void qc.invalidateQueries({ queryKey: ["opsExternalAlerts"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const testAlertSource = useMutation({
    mutationFn: (item: any) => api.opsAlertSourceTest(item.id, { use_endpoint: Boolean(item.endpoint) }),
    onSuccess: (data) => setAlertSourceResult({ type: "test", ...data }),
  });
  const toggleAlertSource = useMutation({
    mutationFn: (item: any) => api.opsAlertSourceToggle(item.id, { enabled: !item.enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opsAlertSources"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const deleteAlertSource = useMutation({
    mutationFn: (id: string) => api.opsAlertSourceDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opsAlertSources"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const createAlertNoisePolicy = useMutation({
    mutationFn: () => api.opsAlertNoisePolicyCreate({
      name: alertNoisePolicyForm.name,
      enabled: alertNoisePolicyForm.enabled,
      group_by: alertNoisePolicyForm.group_by.split(",").map(item => item.trim()).filter(Boolean),
      min_rca_severity: alertNoisePolicyForm.min_rca_severity,
      suppress_severities: alertNoisePolicyForm.suppress_severities.split(",").map(item => item.trim()).filter(Boolean),
      note: alertNoisePolicyForm.note,
      labels: {},
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opsAlertNoisePolicies"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
      setAlertNoiseConfigDrawer(null);
    },
  });
  const toggleAlertNoisePolicy = useMutation({
    mutationFn: (item: any) => api.opsAlertNoisePolicyToggle(item.id, { enabled: !item.enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opsAlertNoisePolicies"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
      setAlertNoiseConfigDrawer(null);
    },
  });
  const deleteAlertNoisePolicy = useMutation({
    mutationFn: (id: string) => api.opsAlertNoisePolicyDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opsAlertNoisePolicies"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const evaluateAlertNoise = useMutation({
    mutationFn: (persist: boolean) => api.opsAlertNoiseEvaluate({ persist, limit: 100 }),
    onSuccess: (data) => {
      setAlertNoiseResult(data);
      void qc.invalidateQueries({ queryKey: ["opsAlertNoisePolicies"] });
      void qc.invalidateQueries({ queryKey: ["opsAlertNoiseEvaluations"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const generateAlertStrategy = useMutation({
    mutationFn: () => api.opsAlertStrategyRecommend({ persist: true, limit: 20 }),
    onSuccess: (data) => {
      setAlertStrategyResult(data);
      void qc.invalidateQueries({ queryKey: ["opsAlertStrategyRecommendations"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const updateAlertStrategyRecommendation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "apply" | "dismiss" | "reopen" }) =>
      api.opsAlertStrategyRecommendationAction(id, { action, actor: "Ops Lead", note: `OpsCenter ${action}` }),
    onSuccess: (data) => {
      setAlertStrategyResult(data);
      void qc.invalidateQueries({ queryKey: ["opsAlertStrategyRecommendations"] });
      void qc.invalidateQueries({ queryKey: ["opsAlertNoisePolicies"] });
      void qc.invalidateQueries({ queryKey: ["opsAlertNoiseEvaluations"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const compareAlertStrategy = useMutation({
    mutationFn: () => {
      const currentGroupBy = alertNoisePolicyForm.group_by.split(",").map(item => item.trim()).filter(Boolean);
      const currentSuppress = alertNoisePolicyForm.suppress_severities.split(",").map(item => item.trim()).filter(Boolean);
      return api.opsAlertStrategyCompare({
        persist: true,
        limit: 200,
        variants: [
          {
            id: "current-form",
            name: `${alertNoisePolicyForm.name || "当前表单策略"} · 表单版本`,
            enabled: alertNoisePolicyForm.enabled,
            group_by: currentGroupBy.length ? currentGroupBy : ["service", "alertname", "source_id"],
            min_rca_severity: alertNoisePolicyForm.min_rca_severity,
            suppress_severities: currentSuppress.length ? currentSuppress : ["info", "low"],
            labels: { source: "ops_center_ui" },
            note: alertNoisePolicyForm.note,
          },
          {
            id: "strict-high-only",
            name: "严格高危优先策略",
            enabled: true,
            group_by: ["service", "alertname", "source_id", "environment"],
            min_rca_severity: "critical",
            suppress_severities: ["info", "low", "medium"],
            labels: { source: "ops_center_ui", mode: "strict" },
            note: "告警风暴时优先保护 RCA 队列。",
          },
        ],
      });
    },
    onSuccess: (data) => {
      setAlertStrategyCompareResult(data);
      void qc.invalidateQueries({ queryKey: ["opsAlertStrategyCompareRuns"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const predictAlertSlo = useMutation({
    mutationFn: () => api.opsAlertSloPrediction({ persist: true, window_hours: 24, limit: 500 }),
    onSuccess: (data) => {
      setAlertSloResult(data);
      void qc.invalidateQueries({ queryKey: ["opsAlertSloPredictionRuns"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const saveAlertSloEscalationPolicy = useMutation({
    mutationFn: () => api.opsAlertSloEscalationPolicyUpdate({
      enabled: alertSloEscalationForm.enabled,
      min_risk_level: alertSloEscalationForm.min_risk_level,
      min_breach_probability: Number(alertSloEscalationForm.min_breach_probability) || 0,
      max_targets: Number(alertSloEscalationForm.max_targets) || 5,
      cooldown_minutes: Number(alertSloEscalationForm.cooldown_minutes) || 0,
      actions: alertSloEscalationForm.actions.split(",").map(item => item.trim()).filter(Boolean),
      channels: imChannels,
      owner: alertSloEscalationForm.owner,
      note: alertSloEscalationForm.note,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opsAlertSloEscalationPolicy"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
      setAlertSloEscalationDrawerOpen(false);
    },
  });
  const runAlertSloEscalation = useMutation({
    mutationFn: (dryRun: boolean) => api.opsAlertSloEscalationRun({
      dry_run: dryRun,
      priority: alertSloEscalationForm.priority,
      assigned_to: alertSloEscalationForm.assigned_to,
      dev_tool: alertSloEscalationForm.dev_tool,
      channels: imChannels,
      window_hours: 24,
      force: false,
      note: alertSloEscalationForm.note,
    }),
    onSuccess: (data) => {
      setAlertSloEscalationResult(data);
      void qc.invalidateQueries({ queryKey: ["opsAlertSloEscalationRuns"] });
      void qc.invalidateQueries({ queryKey: ["opsAlertSloPredictionRuns"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const runAlertStrategyCanaryAudit = useMutation({
    mutationFn: () => api.opsAlertStrategyCanaryAudit({
      policy_id: alertStrategyCanaryForm.policy_id,
      candidate_id: alertStrategyCanaryForm.candidate_id,
      traffic_percent: Number(alertStrategyCanaryForm.traffic_percent) || 10,
      refresh_inputs: alertStrategyCanaryForm.refresh_inputs,
      persist: true,
      created_by: alertStrategyCanaryForm.created_by,
      note: alertStrategyCanaryForm.note,
    }),
    onSuccess: (data) => {
      setAlertStrategyCanaryResult(data);
      void qc.invalidateQueries({ queryKey: ["opsAlertStrategyCanaryAudits"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
      setAlertStrategyCanaryDrawerOpen(false);
    },
  });
  const updateAlertStrategyCanary = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "start" | "rollback" | "archive" | "reopen" }) =>
      api.opsAlertStrategyCanaryAction(id, { action, actor: alertStrategyCanaryForm.created_by, note: alertStrategyCanaryForm.note }),
    onSuccess: (data) => {
      setAlertStrategyCanaryResult(data.item);
      void qc.invalidateQueries({ queryKey: ["opsAlertStrategyCanaryAudits"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const runOpsStrategyLinkage = useMutation({
    mutationFn: (dryRun: boolean) => api.opsStrategyLinkageRun({
      dry_run: dryRun,
      actions: opsStrategyLinkageForm.actions.split(",").map(item => item.trim()).filter(Boolean),
      max_items: Number(opsStrategyLinkageForm.max_items) || 8,
      priority: opsStrategyLinkageForm.priority,
      assigned_to: opsStrategyLinkageForm.assigned_to,
      dev_tool: opsStrategyLinkageForm.dev_tool,
      channels: imChannels,
      note: opsStrategyLinkageForm.note,
    }),
    onSuccess: (data) => {
      setOpsStrategyLinkageResult(data);
      void qc.invalidateQueries({ queryKey: ["opsStrategyLinkageRuns"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const createAlertSilence = useMutation({
    mutationFn: () => api.opsAlertSilenceCreate({
      name: alertSilenceForm.name,
      matchers: parseSignals(alertSilenceForm.matchers),
      starts_at: alertSilenceForm.starts_at,
      ends_at: alertSilenceForm.ends_at,
      reason: alertSilenceForm.reason,
      owner: alertSilenceForm.owner,
      enabled: alertSilenceForm.enabled,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opsAlertNoisePolicies"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const toggleAlertSilence = useMutation({
    mutationFn: (item: any) => api.opsAlertSilenceToggle(item.id, { enabled: !item.enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opsAlertNoisePolicies"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const deleteAlertSilence = useMutation({
    mutationFn: (id: string) => api.opsAlertSilenceDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opsAlertNoisePolicies"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const saveRb = useMutation({
    mutationFn: () => {
      const body = {
        name: rbForm.name,
        steps: rbForm.steps.split("\n").map(s => s.trim()).filter(Boolean),
        tags: rbForm.tags.split(",").map(s => s.trim()).filter(Boolean),
        owner: rbForm.owner || "Ops Lead",
        change_note: rbForm.change_note,
      };
      return rbForm.id ? api.opsRunbookUpdate(rbForm.id, body) : api.opsRunbookCreate(body);
    },
    onSuccess: (data) => {
      const id = data?.id || rbForm.id;
      void qc.invalidateQueries({ queryKey: ["opsRunbooks"] });
      if (id) {
        setSelectedRunbookId(id);
        void qc.invalidateQueries({ queryKey: ["opsRunbookVersions", id] });
      }
      setShowForm(false);
      setRunbookEditorDrawerOpen(false);
      setRbForm({ id: "", name: "", steps: "", tags: "", owner: "Ops Lead", change_note: "" });
    },
  });
  const deleteRb = useMutation({
    mutationFn: (id: string) => api.opsRunbookDelete(id),
    onSuccess: (_, id) => {
      if (selectedRunbookId === id) setSelectedRunbookId("");
      void qc.invalidateQueries({ queryKey: ["opsRunbooks"] });
    },
  });
  const runbookVersionAction = useMutation({
    mutationFn: ({ runbookId, versionId, action }: { runbookId: string; versionId: string; action: "promote" | "archive" | "restore" }) =>
      api.opsRunbookVersionAction(runbookId, versionId, { action, actor: "Ops Lead", note: `OpsCenter ${action}` }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ["opsRunbooks"] });
      void qc.invalidateQueries({ queryKey: ["opsRunbookVersions", vars.runbookId] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const compareRunbookVersions = useMutation({
    mutationFn: ({ runbookId, baseVersionId, targetVersionId }: { runbookId: string; baseVersionId: string; targetVersionId: string }) =>
      api.opsRunbookVersionDiff(runbookId, baseVersionId, targetVersionId),
    onSuccess: (data) => setRunbookDiffResult(data),
  });
  const backfillRunbookEvidence = useMutation({
    mutationFn: (runbookId?: string) => api.opsRunbookEvidenceBackfill({
      runbook_ids: runbookId ? [runbookId] : [],
      include_resolved: true,
      persist: true,
      actor: "Ops Agent",
      note: runbookId ? "Runbook 详情自动回填" : "Runbook 全量自动回填",
      limit: 100,
    }),
    onSuccess: (data) => {
      setRunbookEvidenceResult(data);
      void qc.invalidateQueries({ queryKey: ["opsRunbookEvidence"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const updateRunbookEvidence = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "acknowledge" | "archive" | "reopen" }) =>
      api.opsRunbookEvidenceAction(id, { action, actor: "Ops Lead", note: `OpsCenter ${action}` }),
    onSuccess: (data) => {
      setRunbookEvidenceResult(data);
      void qc.invalidateQueries({ queryKey: ["opsRunbookEvidence"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const createSh = useMutation({
    mutationFn: () => api.opsSelfHealCreate(shForm),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opsSelfHeal"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
      setShowForm(false);
      setSelfHealPolicyDrawerOpen(false);
      setShForm({ trigger_condition: "", action: "", enabled: true });
    },
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
      setHealActionResult(null);
      void qc.invalidateQueries({ queryKey: ["opsSelfHealEvaluations"] });
      void qc.invalidateQueries({ queryKey: ["opsSelfHealActions"] });
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
  const approveAction = useMutation({
    mutationFn: (id: string) => api.opsSelfHealActionApprove(id, { approver: "Ops Lead", note: "控制台审批通过" }),
    onSuccess: (data) => {
      setHealActionResult(data);
      void qc.invalidateQueries({ queryKey: ["opsSelfHealActions"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const applyAction = useMutation({
    mutationFn: (id: string) => api.opsSelfHealActionApply(id, { operator: "Ops Agent", result: { command_exit_code: 0, source: "ops-center-workbench" } }),
    onSuccess: (data) => {
      setHealActionResult(data);
      void qc.invalidateQueries({ queryKey: ["opsSelfHealActions"] });
      void qc.invalidateQueries({ queryKey: ["opsSelfHeal"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const verifyAction = useMutation({
    mutationFn: (id: string) => api.opsSelfHealActionVerify(id, { verifier: "SRE", verification: { status: "healthy", source: "ops-center-workbench" } }),
    onSuccess: (data) => {
      setHealActionResult(data);
      void qc.invalidateQueries({ queryKey: ["opsSelfHealActions"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const rollbackAction = useMutation({
    mutationFn: (id: string) => api.opsSelfHealActionRollback(id, { operator: "Ops Lead", evidence: { reason: "人工回滚演练", command_exit_code: 0, source: "ops-center-workbench" } }),
    onSuccess: (data) => {
      setHealActionResult(data);
      void qc.invalidateQueries({ queryKey: ["opsSelfHealActions"] });
      void qc.invalidateQueries({ queryKey: ["opsCenterSummary"] });
    },
  });
  const imBriefing = useMutation({
    mutationFn: (dryRun: boolean) => api.opsCenterImBriefing({ dry_run: dryRun, channels: imChannels }),
    onSuccess: (data, dryRun) => {
      setImResult(data);
      if (!dryRun) {
        void qc.invalidateQueries({ queryKey: ["notifyMessages"] });
        void qc.invalidateQueries({ queryKey: ["notifySummary"] });
      }
    },
  });

  if (!authed) return <NeedLogin />;

  const TABS: { id: Tab; label: string; count: number | null }[] = [
    { id: "pipelines", label: OPS_CENTER_TAB_META.pipelines.shortLabel, count: pipQ.data?.items?.length ?? 0 },
    { id: "alert-sources", label: OPS_CENTER_TAB_META["alert-sources"].shortLabel, count: alertSourcesQ.data?.items?.length ?? 0 },
    { id: "rca", label: OPS_CENTER_TAB_META.rca.shortLabel, count: rcaQ.data?.items?.length ?? null },
    { id: "runbooks", label: OPS_CENTER_TAB_META.runbooks.shortLabel, count: rbQ.data?.items?.length ?? null },
    { id: "self-heal", label: OPS_CENTER_TAB_META["self-heal"].shortLabel, count: shQ.data?.items?.length ?? null },
  ];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title="智能运维中心"
        description="部署流水线、生产告警源、根因分析、Runbook 与自愈策略"
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
            { label: "外部告警", value: summaryQ.data?.summary?.external_open_alerts ?? 0, trend: (summaryQ.data?.summary?.external_high_alerts ?? 0) > 0 ? "down" : "neutral" },
            { label: "自愈命中", value: summaryQ.data?.summary?.self_heal_matched ?? 0 },
            { label: "审批队列", value: summaryQ.data?.summary?.self_heal_approval_queue ?? 0, trend: (summaryQ.data?.summary?.self_heal_approval_queue ?? 0) > 0 ? "down" : "neutral" },
          ]} />
        }
      >
        <WorkbenchPanel title="IM 深度集成" actions={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => imBriefing.mutate(true)} disabled={imBriefing.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览 IM 简报</button>
            <button onClick={() => imBriefing.mutate(false)} disabled={imBriefing.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">发送到 IM</button>
          </div>
        }>
          <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <p className="text-sm font-semibold">运维风险与自愈审批会自动形成 IM 简报</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">简报包含失败流水线、未关闭 RCA、Runbook 缺口、自愈审批和任务化入口，可投递到已启用 IM 通道。</p>
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
                <p className="mt-2 text-[11px] text-[var(--muted)]">{imChannels.length ? `手动选择 ${imChannels.length} 个通道` : "未选择时按 ops_center_risk 或 approval_required 事件自动匹配通道。"}</p>
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
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">{imResult?.briefing?.content ?? "点击预览后展示 OpsCenter 运行简报内容。"}</pre>
            </div>
          </div>
        </WorkbenchPanel>

        <div className="opsCenterModuleQuickSummary mb-4 grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--brand)]">OpsCenter</span>
              <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--muted-strong)]">{activeTabMeta.output}</span>
            </div>
            <h2 className="mt-3 text-lg font-semibold text-[var(--text)]">{activeTabMeta.label}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">{activeTabMeta.desc}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col lg:items-end">
            <button type="button" onClick={() => setAiOpen(true)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]">
              AI 分析当前模块
            </button>
            <a href="#/system/ops-center" className="rounded-lg border border-[var(--border)] px-3 py-2 text-center text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]">
              返回运维总览
            </a>
          </div>
        </div>

        <div className="opsCenterModeSwitch mb-4 overflow-x-auto pb-1">
          <Segmented
            block
            value={tab}
            onChange={(value) => {
              const next = value as Tab;
              setTab(next);
              setShowForm(false);
              updateOpsCenterHash(next);
            }}
            options={TABS.map((item) => ({
              value: item.id,
              label: (
                <span className="inline-flex min-w-max items-center gap-1 px-1">
                  <span>{item.label}</span>
                  {item.count !== null ? <span className="rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{item.count}</span> : null}
                </span>
              ),
            }))}
          />
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

        {tab === "alert-sources" && (
          <>
          <div className="grid gap-4 xl:grid-cols-[minmax(420px,0.9fr)_minmax(520px,1.1fr)]">
            <WorkbenchPanel title="生产告警源" actions={
              <div className="flex flex-wrap gap-2">
                <RefreshButton onClick={() => { void alertSourcesQ.refetch(); void externalAlertsQ.refetch(); void alertNoiseQ.refetch(); void alertNoiseHistoryQ.refetch(); void alertStrategyQ.refetch(); void alertStrategyCompareRunsQ.refetch(); void alertSloPredictionRunsQ.refetch(); void alertSloEscalationPolicyQ.refetch(); void alertSloEscalationRunsQ.refetch(); void alertStrategyCanaryAuditsQ.refetch(); void opsStrategyLinkageRunsQ.refetch(); }} pending={alertSourcesQ.isFetching || externalAlertsQ.isFetching || alertNoiseQ.isFetching || alertNoiseHistoryQ.isFetching || alertStrategyQ.isFetching || alertStrategyCompareRunsQ.isFetching || alertSloPredictionRunsQ.isFetching || alertSloEscalationPolicyQ.isFetching || alertSloEscalationRunsQ.isFetching || alertStrategyCanaryAuditsQ.isFetching || opsStrategyLinkageRunsQ.isFetching} />
                <button onClick={() => syncAlertSources.mutate()} disabled={syncAlertSources.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">同步告警</button>
                <button onClick={() => setAlertSourceDrawerOpen(true)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white">+ 告警源</button>
              </div>
            }>
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">源数量</p><p className="text-lg font-semibold">{alertSourcesQ.data?.summary?.sources ?? 0}</p></div>
                <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">启用</p><p className="text-lg font-semibold">{alertSourcesQ.data?.summary?.enabled_sources ?? 0}</p></div>
                <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">开放告警</p><p className="text-lg font-semibold">{alertSourcesQ.data?.summary?.open_alerts ?? 0}</p></div>
                <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">健康分</p><p className="text-lg font-semibold">{alertSourcesQ.data?.summary?.health_score ?? 100}</p></div>
              </div>

              <div className="mt-4 space-y-3">
                {(alertSourcesQ.data?.items ?? []).length === 0 && <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-center text-sm text-[var(--muted)]">暂无告警源，先配置 Prometheus/Grafana/Datadog/Webhook 或通用 JSON 源。</p>}
                {(alertSourcesQ.data?.items ?? []).map((item: any) => (
                  <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{item.name}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{item.source_type} · {item.endpoint || "sample/manual payload"}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${item.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{item.enabled ? "启用" : "停用"}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--muted-strong)]">
                      {Object.entries(item.labels ?? {}).map(([key, value]) => <span key={key} className="rounded-full bg-[var(--surface-muted)] px-2 py-1">{key}: {String(value)}</span>)}
                      {item.auth_ref && <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1">密钥已托管</span>}
                      {item.sample_payload_status && <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1">样例已配置</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => testAlertSource.mutate(item)} disabled={testAlertSource.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">测试</button>
                      <button onClick={() => toggleAlertSource.mutate(item)} disabled={toggleAlertSource.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">{item.enabled ? "停用" : "启用"}</button>
                      <button onClick={() => deleteAlertSource.mutate(item.id)} disabled={deleteAlertSource.isPending} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 disabled:opacity-50">删除</button>
                    </div>
                  </div>
                ))}
                {(syncAlertSources.error || testAlertSource.error || toggleAlertSource.error || deleteAlertSource.error) && (
                  <p className="text-xs text-red-600">{((syncAlertSources.error || testAlertSource.error || toggleAlertSource.error || deleteAlertSource.error) as Error).message}</p>
                )}
              </div>
            </WorkbenchPanel>

            <WorkbenchPanel title="告警同步与 RCA 输入">
              <div className="space-y-4">
                {alertSourceResult ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">最近动作：{alertSourceResult.type}</p>
                      <span className={`rounded px-2 py-0.5 text-xs ${alertSourceResult.ok === false ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{alertSourceResult.ok === false ? "failed" : "ok"}</span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">来源</p><p className="text-sm font-semibold">{alertSourceResult.summary?.sources ?? alertSourceResult.source_name ?? "-"}</p></div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">告警</p><p className="text-sm font-semibold">{alertSourceResult.summary?.alerts ?? alertSourceResult.alerts?.length ?? 0}</p></div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">失败</p><p className="text-sm font-semibold">{alertSourceResult.summary?.failed ?? 0}</p></div>
                    </div>
                    {alertSourceResult.error && <p className="mt-2 text-xs text-red-600">{alertSourceResult.error}</p>}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-center text-sm text-[var(--muted)]">测试或同步后会展示标准化结果；持久化告警会自动进入 RCA 智能归因。</div>
                )}

                <div>
                  <p className="mb-2 text-sm font-semibold">最近同步告警</p>
                  <div className="space-y-2">
                    {(externalAlertsQ.data?.items ?? []).length === 0 && <p className="rounded-lg bg-[var(--surface-muted)] p-4 text-center text-sm text-[var(--muted)]">暂无已同步外部告警</p>}
                    {(externalAlertsQ.data?.items ?? []).slice(0, 12).map((alert: any) => (
                      <div key={`${alert.source_id}-${alert.id}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">{alert.title}</p>
                          <span className={`rounded px-2 py-0.5 text-xs ${severityClass(alert.severity)}`}>{alert.severity} · {alert.status}</span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">{alert.source} / {alert.detail || alert.dataset || "-"}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">告警降噪策略</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">按标签分组、折叠重复、抑制低优先级，并把可行动组送入 RCA。</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setAlertNoiseConfigDrawer("policy")} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">新增策略</button>
                        <button onClick={() => setAlertNoiseConfigDrawer("silence")} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">新增静默</button>
                        <button onClick={() => generateAlertStrategy.mutate()} disabled={generateAlertStrategy.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">
                          {generateAlertStrategy.isPending ? "生成中..." : "智能推荐"}
                        </button>
                      <button onClick={() => evaluateAlertNoise.mutate(false)} disabled={evaluateAlertNoise.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览降噪</button>
                      <button onClick={() => evaluateAlertNoise.mutate(true)} disabled={evaluateAlertNoise.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">应用评估</button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">策略</p><p className="text-lg font-semibold">{alertNoiseQ.data?.summary?.enabled_policies ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">静默</p><p className="text-lg font-semibold">{alertNoiseQ.data?.summary?.enabled_silences ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">可行动组</p><p className="text-lg font-semibold">{alertNoiseResult?.summary?.actionable_incidents ?? alertNoiseQ.data?.summary?.latest_actionable_incidents ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">降噪率</p><p className="text-lg font-semibold">{Math.round(((alertNoiseResult?.summary?.noise_reduction_ratio ?? alertNoiseQ.data?.summary?.latest_noise_reduction_ratio ?? 0) as number) * 100)}%</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">推荐</p><p className="text-lg font-semibold">{alertStrategyQ.data?.summary?.recommendations ?? alertStrategyResult?.summary?.recommendations ?? 0}</p></div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">可应用</p><p className="text-lg font-semibold">{alertStrategyQ.data?.summary?.applyable ?? alertStrategyResult?.summary?.applyable ?? 0}</p></div>
                  </div>
                  <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">策略智能推荐</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">基于开放告警、重复分组、降噪率和历史健康分，推荐可应用的策略或静默。</p>
                      </div>
                      {alertStrategyResult?.persisted !== undefined ? <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-xs">最近保存 {alertStrategyResult.persisted} 条</span> : null}
                    </div>
                    <div className="mt-3 grid gap-2 xl:grid-cols-2">
                      {(alertStrategyQ.data?.items ?? []).length === 0 ? (
                        <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无策略推荐，先同步告警并点击智能推荐。</p>
                      ) : (alertStrategyQ.data?.items ?? []).slice(0, 6).map((item: any) => (
                        <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">{item.title}</p>
                              <p className="mt-1 text-xs text-[var(--muted)]">{item.reason}</p>
                            </div>
                            <span className={`rounded px-2 py-0.5 text-[11px] ${severityClass(item.priority)}`}>{item.priority}</span>
                          </div>
                          <p className="mt-2 text-xs text-[var(--muted-strong)]">{item.impact}</p>
                          <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                            <span className="rounded bg-[var(--surface-muted)] px-2 py-1">{item.operation}</span>
                            <span className="rounded bg-[var(--surface-muted)] px-2 py-1">置信度 {Math.round((item.confidence ?? 0) * 100)}%</span>
                            <span className="rounded bg-[var(--surface-muted)] px-2 py-1">{item.review_status || item.status || "open"}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.operation !== "review" && item.review_status !== "applied" ? (
                              <button onClick={() => updateAlertStrategyRecommendation.mutate({ id: item.id, action: "apply" })} disabled={updateAlertStrategyRecommendation.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1 text-xs text-white disabled:opacity-50">应用</button>
                            ) : null}
                            {item.review_status === "dismissed" ? (
                              <button onClick={() => updateAlertStrategyRecommendation.mutate({ id: item.id, action: "reopen" })} disabled={updateAlertStrategyRecommendation.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50">重新打开</button>
                            ) : (
                              <button onClick={() => updateAlertStrategyRecommendation.mutate({ id: item.id, action: "dismiss" })} disabled={updateAlertStrategyRecommendation.isPending || item.review_status === "applied"} className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50">忽略</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-[var(--muted-strong)]">策略效果 A/B 对比</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">把当前表单策略、严格高危策略和后端基线放到同一批告警上比较。</p>
                        </div>
                        <button onClick={() => compareAlertStrategy.mutate()} disabled={compareAlertStrategy.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">
                          {compareAlertStrategy.isPending ? "对比中..." : "对比策略效果"}
                        </button>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">候选策略</p>
                          <p className="text-lg font-semibold">{latestStrategyCompare?.summary?.variants ?? alertStrategyCompareRunsQ.data?.summary?.latest_variants ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">赢家提升</p>
                          <p className="text-lg font-semibold">{latestStrategyCompare?.summary?.winner_score_delta ?? alertStrategyCompareRunsQ.data?.summary?.latest_winner_score_delta ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">最佳降噪</p>
                          <p className="text-lg font-semibold">{Math.round(((latestStrategyCompare?.summary?.best_noise_reduction_ratio ?? alertStrategyCompareRunsQ.data?.summary?.latest_best_noise_reduction_ratio ?? 0) as number) * 100)}%</p>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {(latestStrategyCompare?.items ?? []).length === 0 ? (
                          <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无对比记录，保存或调整策略表单后点击对比。</p>
                        ) : (latestStrategyCompare?.items ?? []).slice(0, 4).map((item: any) => (
                          <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium">{item.name}</p>
                              <div className="flex flex-wrap gap-1 text-[11px]">
                                {item.winner ? <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">推荐赢家</span> : null}
                                <span className="rounded bg-[var(--surface-muted)] px-2 py-0.5">健康 {item.health_score}</span>
                                <span className="rounded bg-[var(--surface-muted)] px-2 py-0.5">Δ {item.score_delta}</span>
                              </div>
                            </div>
                            <p className="mt-1 text-xs text-[var(--muted)]">RCA 组 {item.actionable_incidents} / 折叠 {item.deduped_alerts} / 抑制 {item.suppressed_alerts} / 降噪 {Math.round((item.noise_reduction_ratio ?? 0) * 100)}%</p>
                            <p className="mt-1 text-xs text-[var(--muted-strong)]">{item.recommendation}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-[var(--muted-strong)]">跨源 SLO 预测</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">按告警源与服务预测 24 小时 SLO 风险，联动 RCA、Runbook 和策略治理。</p>
                        </div>
                        <button onClick={() => predictAlertSlo.mutate()} disabled={predictAlertSlo.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">
                          {predictAlertSlo.isPending ? "预测中..." : "预测 SLO"}
                        </button>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">风险对象</p>
                          <p className="text-lg font-semibold">{latestSloPrediction?.summary?.risk_targets ?? alertSloPredictionRunsQ.data?.summary?.latest_risk_targets ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">平均分</p>
                          <p className="text-lg font-semibold">{latestSloPrediction?.summary?.avg_slo_score ?? alertSloPredictionRunsQ.data?.summary?.latest_avg_slo_score ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">最大概率</p>
                          <p className="text-lg font-semibold">{Math.round(((latestSloPrediction?.summary?.breach_probability ?? alertSloPredictionRunsQ.data?.summary?.latest_breach_probability ?? 0) as number) * 100)}%</p>
                        </div>
                      </div>
                      <div className="mt-3 max-h-72 space-y-2 overflow-auto">
                        {(latestSloPrediction?.items ?? []).length === 0 ? (
                          <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无 SLO 预测记录，先同步告警源并点击预测。</p>
                        ) : (latestSloPrediction?.items ?? []).slice(0, 8).map((item: any) => (
                          <div key={`${item.source_id}-${item.service}`} className="rounded-lg border border-[var(--border)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium">{item.source_name} / {item.service}</p>
                              <span className={`rounded px-2 py-0.5 text-[11px] ${severityClass(item.risk_level === "watch" ? "medium" : item.risk_level)}`}>{item.risk_level}</span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--muted)]">SLO {item.predicted_slo_score} / breach {Math.round((item.breach_probability ?? 0) * 100)}% / open {item.open_alerts} / high {item.high_alerts} / critical {item.critical_alerts}</p>
                            <p className="mt-1 text-xs text-[var(--muted-strong)]">{(item.recommendations ?? [])[0]}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">告警 SLO 自动升级</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">把跨源 SLO 预测中的高风险对象自动升级为治理任务和 IM 风险简报，保留运行记录。</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setAlertSloEscalationDrawerOpen(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">配置策略</button>
                        <button onClick={() => runAlertSloEscalation.mutate(true)} disabled={runAlertSloEscalation.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览升级</button>
                        <button onClick={() => runAlertSloEscalation.mutate(false)} disabled={runAlertSloEscalation.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">执行升级</button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">最近候选</p>
                        <p className="text-lg font-semibold">{latestSloEscalation?.summary?.candidates ?? alertSloEscalationRunsQ.data?.summary?.latest_candidates ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">已建任务</p>
                        <p className="text-lg font-semibold">{latestSloEscalation?.summary?.created ?? alertSloEscalationRunsQ.data?.summary?.latest_created ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">Critical</p>
                        <p className="text-lg font-semibold">{latestSloEscalation?.summary?.critical ?? alertSloEscalationRunsQ.data?.summary?.latest_critical ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">最大概率</p>
                        <p className="text-lg font-semibold">{Math.round(((latestSloEscalation?.summary?.max_breach_probability ?? alertSloEscalationRunsQ.data?.summary?.latest_max_breach_probability ?? 0) as number) * 100)}%</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-[var(--muted-strong)]">当前升级策略</p>
                          <span className={`rounded px-2 py-0.5 text-[11px] ${alertSloEscalationPolicyQ.data?.item?.enabled === false ? "bg-gray-100 text-gray-500" : "bg-green-50 text-green-700"}`}>
                            {alertSloEscalationPolicyQ.data?.item?.enabled === false ? "停用" : "启用"}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">最低风险</p>
                            <p className="text-sm font-semibold">{alertSloEscalationPolicyQ.data?.item?.min_risk_level ?? alertSloEscalationForm.min_risk_level}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">违约阈值</p>
                            <p className="text-sm font-semibold">{Math.round(((alertSloEscalationPolicyQ.data?.item?.min_breach_probability ?? Number(alertSloEscalationForm.min_breach_probability || 0)) as number) * 100)}%</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">最大对象</p>
                            <p className="text-sm font-semibold">{alertSloEscalationPolicyQ.data?.item?.max_targets ?? alertSloEscalationForm.max_targets}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">冷却窗口</p>
                            <p className="text-sm font-semibold">{alertSloEscalationPolicyQ.data?.item?.cooldown_minutes ?? alertSloEscalationForm.cooldown_minutes} 分钟</p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-[var(--muted)]">动作：{(alertSloEscalationPolicyQ.data?.item?.actions ?? alertSloEscalationForm.actions.split(",")).join(", ")} / Owner：{alertSloEscalationPolicyQ.data?.item?.owner ?? alertSloEscalationForm.owner}</p>
                      </div>
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">升级结果</p>
                        {(latestSloEscalation?.items ?? []).length === 0 ? (
                          <p className="mt-2 rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无升级运行记录，先预测 SLO 后预览或执行升级。</p>
                        ) : (
                          <div className="mt-2 max-h-72 space-y-2 overflow-auto">
                            {(latestSloEscalation?.items ?? []).slice(0, 8).map((item: any) => (
                              <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-medium">{item.source_name} / {item.service}</p>
                                  <span className={`rounded px-2 py-0.5 text-[11px] ${severityClass(item.risk_level)}`}>{item.risk_level}</span>
                                </div>
                                <p className="mt-1 text-xs text-[var(--muted)]">SLO {item.predicted_slo_score} / breach {Math.round((item.breach_probability ?? 0) * 100)}% / open {item.open_alerts}</p>
                                <p className="mt-1 text-xs text-[var(--muted-strong)]">{(item.recommendations ?? [])[0] || "按策略升级处置。"}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {latestSloEscalation?.delivery_plan ? (
                          <p className="mt-2 text-[11px] text-[var(--muted)]">IM 目标：{latestSloEscalation.delivery_plan.target_count ?? 0} / 已发送：{latestSloEscalation.summary?.sent ?? 0}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">策略灰度应用审计</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">汇总策略 A/B 对比、SLO 风险、自动升级记录和灰度护栏，形成可审批的准入结论。</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setAlertStrategyCanaryDrawerOpen(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">配置审计</button>
                        <button onClick={() => runAlertStrategyCanaryAudit.mutate()} disabled={runAlertStrategyCanaryAudit.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">
                          {runAlertStrategyCanaryAudit.isPending ? "审计中..." : "生成灰度审计"}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">准入分</p>
                        <p className="text-lg font-semibold">{latestStrategyCanary?.summary?.readiness_score ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_readiness_score ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">结论</p>
                        <p className="text-lg font-semibold">{latestStrategyCanary?.summary?.decision ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_decision ?? "-"}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">建议流量</p>
                        <p className="text-lg font-semibold">{latestStrategyCanary?.summary?.recommended_percent ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_recommended_percent ?? 0}%</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">运行中</p>
                        <p className="text-lg font-semibold">{alertStrategyCanaryAuditsQ.data?.summary?.running ?? 0}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">审计配置摘要</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">策略来源</p>
                            <p className="text-sm font-semibold">{alertStrategyCanaryForm.policy_id || "自动选择"}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">候选策略</p>
                            <p className="text-sm font-semibold">{alertStrategyCanaryForm.candidate_id || "A/B 胜出"}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">灰度流量</p>
                            <p className="text-sm font-semibold">{alertStrategyCanaryForm.traffic_percent}%</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">审批人</p>
                            <p className="text-sm font-semibold">{alertStrategyCanaryForm.created_by}</p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-[var(--muted)]">{alertStrategyCanaryForm.refresh_inputs ? "审计会刷新策略对比和 SLO 风险。" : "审计复用当前已生成证据。"}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(["approve", "start", "rollback", "archive", "reject", "reopen"] as const).map(action => (
                            <button
                              key={action}
                              onClick={() => latestStrategyCanary?.id && updateAlertStrategyCanary.mutate({ id: latestStrategyCanary.id, action })}
                              disabled={!latestStrategyCanary?.id || updateAlertStrategyCanary.isPending}
                              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50"
                            >
                              {action}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-[var(--muted-strong)]">审计证据</p>
                          {latestStrategyCanary?.audit_status ? <span className={`rounded px-2 py-0.5 text-[11px] ${actionStateClass(latestStrategyCanary.audit_status)}`}>{latestStrategyCanary.audit_status}</span> : null}
                        </div>
                        {!latestStrategyCanary ? (
                          <p className="mt-2 rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无灰度审计记录，先执行策略对比和 SLO 预测后生成审计。</p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                              <p className="text-sm font-medium">{latestStrategyCanary.candidate?.name ?? "候选策略"}</p>
                              <p className="mt-1 text-xs text-[var(--muted)]">health {latestStrategyCanary.candidate?.health_score ?? 0} / delta {latestStrategyCanary.candidate?.score_delta ?? 0} / RCA {latestStrategyCanary.candidate?.actionable_delta ?? 0}</p>
                            </div>
                            {(latestStrategyCanary.items ?? []).map((item: any) => (
                              <div key={item.kind} className="rounded-lg border border-[var(--border)] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-medium">{item.title}</p>
                                  <span className={`rounded px-2 py-0.5 text-[11px] ${item.status === "fail" ? "bg-red-50 text-red-700" : item.status === "review" ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>{item.status}</span>
                                </div>
                                <p className="mt-1 text-xs text-[var(--muted)]">{item.detail}</p>
                              </div>
                            ))}
                            {(latestStrategyCanary.blocked_reasons ?? latestStrategyCanary.review_reasons ?? []).length > 0 ? (
                              <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                                <p className="text-xs font-semibold text-[var(--muted-strong)]">准入说明</p>
                                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-[var(--muted)]">
                                  {[...(latestStrategyCanary.blocked_reasons ?? []), ...(latestStrategyCanary.review_reasons ?? [])].slice(0, 4).map((item: string) => <li key={item}>{item}</li>)}
                                </ul>
                              </div>
                            ) : null}
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                                <p className="text-xs font-semibold text-[var(--muted-strong)]">护栏</p>
                                <p className="mt-1 text-xs text-[var(--muted)]">{(latestStrategyCanary.guardrails ?? [])[0] ?? "按策略护栏灰度。"}</p>
                              </div>
                              <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                                <p className="text-xs font-semibold text-[var(--muted-strong)]">回滚触发</p>
                                <p className="mt-1 text-xs text-[var(--muted)]">{(latestStrategyCanary.rollback_triggers ?? [])[0] ?? "异常时回滚。"}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">跨模块运维策略联动</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">把灰度审计、SLO 升级、Runbook、自愈、任务和 IM 通知串成可执行联动包。</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setOpsStrategyLinkageDrawerOpen(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">配置联动</button>
                        <button onClick={() => runOpsStrategyLinkage.mutate(true)} disabled={runOpsStrategyLinkage.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览联动</button>
                        <button onClick={() => runOpsStrategyLinkage.mutate(false)} disabled={runOpsStrategyLinkage.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">执行联动</button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">联动项</p>
                        <p className="text-lg font-semibold">{latestOpsStrategyLinkage?.summary?.linkage_items ?? opsStrategyLinkageRunsQ.data?.summary?.latest_items ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">模块数</p>
                        <p className="text-lg font-semibold">{latestOpsStrategyLinkage?.summary?.modules ?? opsStrategyLinkageRunsQ.data?.summary?.latest_modules ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">高风险</p>
                        <p className="text-lg font-semibold">{latestOpsStrategyLinkage?.summary?.high_risk ?? opsStrategyLinkageRunsQ.data?.summary?.latest_high_risk ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">已建任务</p>
                        <p className="text-lg font-semibold">{latestOpsStrategyLinkage?.summary?.created ?? opsStrategyLinkageRunsQ.data?.summary?.latest_created ?? 0}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">联动配置摘要</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">动作</p>
                            <p className="text-sm font-semibold">{opsStrategyLinkageForm.actions}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">最大联动项</p>
                            <p className="text-sm font-semibold">{opsStrategyLinkageForm.max_items}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">优先级</p>
                            <p className="text-sm font-semibold">{opsStrategyLinkageForm.priority}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs text-[var(--muted)]">负责人</p>
                            <p className="text-sm font-semibold">{opsStrategyLinkageForm.assigned_to}</p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-[var(--muted)]">工具：{opsStrategyLinkageForm.dev_tool}。IM 通道沿用本页已选择通道，执行联动会创建任务并发送风险简报。</p>
                      </div>
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="text-xs font-semibold text-[var(--muted-strong)]">联动结果</p>
                        {(latestOpsStrategyLinkage?.items ?? []).length === 0 ? (
                          <p className="mt-2 rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无联动运行记录，先完成策略灰度审计或 SLO 升级后预览联动。</p>
                        ) : (
                          <div className="mt-2 max-h-72 space-y-2 overflow-auto">
                            {(latestOpsStrategyLinkage?.items ?? []).slice(0, 8).map((item: any) => (
                              <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-medium">{item.title}</p>
                                  <span className={`rounded px-2 py-0.5 text-[11px] ${severityClass(item.risk_level === "watch" ? "medium" : item.risk_level)}`}>{item.module} / {item.risk_level}</span>
                                </div>
                                <p className="mt-1 text-xs text-[var(--muted)]">{(item.recommendations ?? [])[0] ?? "按联动策略推进。"}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {latestOpsStrategyLinkage?.delivery_plan ? (
                          <p className="mt-2 text-[11px] text-[var(--muted)]">IM 目标：{latestOpsStrategyLinkage.delivery_plan.target_count ?? 0} / 已发送：{latestOpsStrategyLinkage.summary?.sent ?? 0}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[var(--muted-strong)]">策略目录</p>
                      {(alertNoiseQ.data?.items ?? []).length === 0 && <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无策略，保存后评估结果会记录为降噪历史。</p>}
                      {(alertNoiseQ.data?.items ?? []).slice(0, 4).map((item: any) => (
                        <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">{item.name}</p>
                            <span className={`rounded px-2 py-0.5 text-[11px] ${item.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{item.enabled ? "启用" : "停用"}</span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--muted)]">分组：{(item.group_by ?? []).join(", ")} / RCA 阈值：{item.min_rca_severity}</p>
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => toggleAlertNoisePolicy.mutate(item)} className="text-xs text-[var(--brand)]">{item.enabled ? "停用" : "启用"}</button>
                            <button onClick={() => deleteAlertNoisePolicy.mutate(item.id)} className="text-xs text-red-600">删除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[var(--muted-strong)]">静默规则</p>
                      {(alertNoiseQ.data?.silences ?? []).length === 0 && <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">暂无静默规则。</p>}
                      {(alertNoiseQ.data?.silences ?? []).slice(0, 4).map((item: any) => (
                        <div key={item.id} className="rounded-lg border border-[var(--border)] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">{item.name}</p>
                            <span className={`rounded px-2 py-0.5 text-[11px] ${item.enabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{item.enabled ? "启用" : "停用"}</span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--muted)]">匹配：{Object.entries(item.matchers ?? {}).map(([key, value]) => `${key}=${String(value)}`).join(", ") || "-"}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">{item.reason || "-"}</p>
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => toggleAlertSilence.mutate(item)} className="text-xs text-[var(--brand)]">{item.enabled ? "停用" : "启用"}</button>
                            <button onClick={() => deleteAlertSilence.mutate(item.id)} className="text-xs text-red-600">删除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {alertNoiseResult?.groups?.length ? (
                    <div className="mt-4 rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs font-semibold text-[var(--muted-strong)]">最近降噪结果</p>
                      <div className="mt-2 max-h-56 overflow-auto space-y-2">
                        {alertNoiseResult.groups.slice(0, 8).map((group: any) => (
                          <div key={group.id} className="rounded bg-[var(--surface)] p-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{group.title}</span>
                              <span className={severityClass(group.max_severity)}>{group.max_severity} / {group.recommended_action}</span>
                            </div>
                            <p className="mt-1 text-[var(--muted)]">{group.group_key} / {group.count} 条，抑制 {group.suppressed_count}，折叠 {group.deduped_count}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {(createAlertNoisePolicy.error || createAlertSilence.error || evaluateAlertNoise.error || generateAlertStrategy.error || updateAlertStrategyRecommendation.error || compareAlertStrategy.error || predictAlertSlo.error || saveAlertSloEscalationPolicy.error || runAlertSloEscalation.error) && (
                    <p className="mt-3 text-xs text-red-600">{((createAlertNoisePolicy.error || createAlertSilence.error || evaluateAlertNoise.error || generateAlertStrategy.error || updateAlertStrategyRecommendation.error || compareAlertStrategy.error || predictAlertSlo.error || saveAlertSloEscalationPolicy.error || runAlertSloEscalation.error) as Error).message}</p>
                  )}
                </div>
              </div>
            </WorkbenchPanel>
          </div>
          <Drawer
            title="配置生产告警源"
            open={alertSourceDrawerOpen}
            onClose={() => setAlertSourceDrawerOpen(false)}
            width="min(640px, 100vw)"
          >
            <div className="alertSourceFocusedDrawer space-y-5">
              <Steps
                size="small"
                current={alertSourceForm.sample_payload.trim() ? 2 : (alertSourceForm.endpoint.trim() || alertSourceForm.auth_ref.trim()) ? 1 : 0}
                items={[
                  { title: "来源" },
                  { title: "连接" },
                  { title: "样例" },
                ]}
              />
              <Form layout="vertical" requiredMark={false} onFinish={() => createAlertSource.mutate()}>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">来源身份</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="告警源名称" required>
                      <Input
                        value={alertSourceForm.name}
                        onChange={e => setAlertSourceForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="production-prometheus"
                      />
                    </Form.Item>
                    <Form.Item label="来源类型">
                      <Select
                        value={alertSourceForm.source_type}
                        onChange={value => setAlertSourceForm(f => ({ ...f, source_type: value }))}
                        options={["prometheus", "grafana", "datadog", "webhook", "generic_json", "manual"].map(type => ({ label: type, value: type }))}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item label="启用同步">
                    <Switch
                      checked={alertSourceForm.enabled}
                      onChange={checked => setAlertSourceForm(f => ({ ...f, enabled: checked }))}
                    />
                    <span className="ml-2 text-xs text-[var(--muted)]">启用后参与同步和 RCA 智能归因。</span>
                  </Form.Item>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">连接与密钥</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px]">
                    <Form.Item label="Endpoint">
                      <Input
                        value={alertSourceForm.endpoint}
                        onChange={e => setAlertSourceForm(f => ({ ...f, endpoint: e.target.value }))}
                        placeholder="https://alerts.example.com/api"
                      />
                    </Form.Item>
                    <Form.Item label="超时秒">
                      <Input
                        type="number"
                        min={1}
                        value={alertSourceForm.timeout_s}
                        onChange={e => setAlertSourceForm(f => ({ ...f, timeout_s: e.target.value }))}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item label="密钥引用">
                    <Input
                      value={alertSourceForm.auth_ref}
                      onChange={e => setAlertSourceForm(f => ({ ...f, auth_ref: e.target.value }))}
                      placeholder="env://PROM_TOKEN"
                    />
                  </Form.Item>
                  <p className="text-xs text-[var(--muted)]">只保存 SecretRef，不保存明文密钥。</p>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">标签与样例</p>
                  <Form.Item label="标签">
                    <Input.TextArea
                      autoSize={{ minRows: 3, maxRows: 5 }}
                      value={alertSourceForm.labels}
                      onChange={e => setAlertSourceForm(f => ({ ...f, labels: e.target.value }))}
                      placeholder="environment=production"
                    />
                  </Form.Item>
                  <Form.Item label="样例 payload JSON">
                    <Input.TextArea
                      autoSize={{ minRows: 6, maxRows: 10 }}
                      value={alertSourceForm.sample_payload}
                      onChange={e => setAlertSourceForm(f => ({ ...f, sample_payload: e.target.value }))}
                      placeholder="用于无外网或 Webhook dry-run 测试"
                    />
                  </Form.Item>
                </div>

                <Space className="mt-4" wrap>
                  <Button type="primary" htmlType="submit" loading={createAlertSource.isPending} disabled={!alertSourceForm.name.trim()}>
                    保存告警源
                  </Button>
                  <Button onClick={() => setAlertSourceDrawerOpen(false)}>取消</Button>
                </Space>
                {createAlertSource.error && <p className="mt-3 text-xs text-red-600">{(createAlertSource.error as Error).message}</p>}
              </Form>
            </div>
          </Drawer>
          <Drawer
            title={alertNoiseConfigDrawer === "silence" ? "配置告警静默" : "配置降噪策略"}
            open={Boolean(alertNoiseConfigDrawer)}
            onClose={() => setAlertNoiseConfigDrawer(null)}
            width="min(640px, 100vw)"
          >
            <div className="alertNoiseFocusedDrawer space-y-5">
              <Steps
                size="small"
                current={alertNoiseConfigDrawer === "silence" ? 1 : 2}
                items={[
                  { title: "规则" },
                  { title: "范围" },
                  { title: "生效" },
                ]}
              />
              {alertNoiseConfigDrawer === "silence" ? (
                <Form layout="vertical" requiredMark={false} onFinish={() => createAlertSilence.mutate()}>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">静默范围</p>
                    <Form.Item className="mt-3" label="静默名称" required>
                      <Input
                        value={alertSilenceForm.name}
                        onChange={e => setAlertSilenceForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="维护窗口静默"
                      />
                    </Form.Item>
                    <Form.Item label="匹配器">
                      <Input.TextArea
                        autoSize={{ minRows: 4, maxRows: 7 }}
                        value={alertSilenceForm.matchers}
                        onChange={e => setAlertSilenceForm(f => ({ ...f, matchers: e.target.value }))}
                        placeholder="environment=staging"
                      />
                    </Form.Item>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">窗口与责任人</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Form.Item label="开始时间">
                        <Input
                          value={alertSilenceForm.starts_at}
                          onChange={e => setAlertSilenceForm(f => ({ ...f, starts_at: e.target.value }))}
                          placeholder="ISO 时间，可空"
                        />
                      </Form.Item>
                      <Form.Item label="结束时间">
                        <Input
                          value={alertSilenceForm.ends_at}
                          onChange={e => setAlertSilenceForm(f => ({ ...f, ends_at: e.target.value }))}
                          placeholder="ISO 时间，可空"
                        />
                      </Form.Item>
                    </div>
                    <Form.Item label="原因">
                      <Input
                        value={alertSilenceForm.reason}
                        onChange={e => setAlertSilenceForm(f => ({ ...f, reason: e.target.value }))}
                        placeholder="维护窗口或非生产环境降噪"
                      />
                    </Form.Item>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Form.Item label="Owner">
                        <Input
                          value={alertSilenceForm.owner}
                          onChange={e => setAlertSilenceForm(f => ({ ...f, owner: e.target.value }))}
                        />
                      </Form.Item>
                      <Form.Item label="启用静默">
                        <Switch
                          checked={alertSilenceForm.enabled}
                          onChange={checked => setAlertSilenceForm(f => ({ ...f, enabled: checked }))}
                        />
                      </Form.Item>
                    </div>
                  </div>

                  <Space className="mt-4" wrap>
                    <Button type="primary" htmlType="submit" loading={createAlertSilence.isPending} disabled={!alertSilenceForm.name.trim()}>
                      保存静默
                    </Button>
                    <Button onClick={() => setAlertNoiseConfigDrawer(null)}>取消</Button>
                  </Space>
                  {createAlertSilence.error && <p className="mt-3 text-xs text-red-600">{(createAlertSilence.error as Error).message}</p>}
                </Form>
              ) : (
                <Form layout="vertical" requiredMark={false} onFinish={() => createAlertNoisePolicy.mutate()}>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">策略规则</p>
                    <Form.Item className="mt-3" label="策略名称" required>
                      <Input
                        value={alertNoisePolicyForm.name}
                        onChange={e => setAlertNoisePolicyForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="生产告警降噪策略"
                      />
                    </Form.Item>
                    <Form.Item label="分组字段">
                      <Input
                        value={alertNoisePolicyForm.group_by}
                        onChange={e => setAlertNoisePolicyForm(f => ({ ...f, group_by: e.target.value }))}
                        placeholder="service,alertname,source_id"
                      />
                    </Form.Item>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">降噪动作</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Form.Item label="RCA 阈值">
                        <Select
                          value={alertNoisePolicyForm.min_rca_severity}
                          onChange={value => setAlertNoisePolicyForm(f => ({ ...f, min_rca_severity: value }))}
                          options={["critical", "high", "medium", "low", "info"].map(item => ({ label: item, value: item }))}
                        />
                      </Form.Item>
                      <Form.Item label="抑制级别">
                        <Input
                          value={alertNoisePolicyForm.suppress_severities}
                          onChange={e => setAlertNoisePolicyForm(f => ({ ...f, suppress_severities: e.target.value }))}
                          placeholder="info,low"
                        />
                      </Form.Item>
                    </div>
                    <Form.Item label="策略说明">
                      <Input.TextArea
                        autoSize={{ minRows: 3, maxRows: 5 }}
                        value={alertNoisePolicyForm.note}
                        onChange={e => setAlertNoisePolicyForm(f => ({ ...f, note: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="启用策略">
                      <Switch
                        checked={alertNoisePolicyForm.enabled}
                        onChange={checked => setAlertNoisePolicyForm(f => ({ ...f, enabled: checked }))}
                      />
                    </Form.Item>
                  </div>

                  <Space className="mt-4" wrap>
                    <Button type="primary" htmlType="submit" loading={createAlertNoisePolicy.isPending} disabled={!alertNoisePolicyForm.name.trim()}>
                      保存策略
                    </Button>
                    <Button onClick={() => setAlertNoiseConfigDrawer(null)}>取消</Button>
                  </Space>
                  {createAlertNoisePolicy.error && <p className="mt-3 text-xs text-red-600">{(createAlertNoisePolicy.error as Error).message}</p>}
                </Form>
              )}
            </div>
          </Drawer>
          <Drawer
            title="配置 SLO 自动升级"
            open={alertSloEscalationDrawerOpen}
            onClose={() => setAlertSloEscalationDrawerOpen(false)}
            width="min(680px, 100vw)"
          >
            <div className="alertSloEscalationFocusedDrawer space-y-5">
              <Steps
                size="small"
                current={1}
                items={[
                  { title: "阈值" },
                  { title: "动作" },
                  { title: "证据" },
                ]}
              />
              <Form layout="vertical" requiredMark={false} onFinish={() => saveAlertSloEscalationPolicy.mutate()}>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">升级阈值</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="最低风险">
                      <Select
                        value={alertSloEscalationForm.min_risk_level}
                        onChange={value => setAlertSloEscalationForm(f => ({ ...f, min_risk_level: value }))}
                        options={["critical", "high", "watch", "healthy"].map(item => ({ label: item, value: item }))}
                      />
                    </Form.Item>
                    <Form.Item label="违约概率阈值">
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step="0.05"
                        value={alertSloEscalationForm.min_breach_probability}
                        onChange={e => setAlertSloEscalationForm(f => ({ ...f, min_breach_probability: e.target.value }))}
                        placeholder="0.35"
                      />
                    </Form.Item>
                    <Form.Item label="最大升级对象">
                      <Input
                        type="number"
                        min={1}
                        value={alertSloEscalationForm.max_targets}
                        onChange={e => setAlertSloEscalationForm(f => ({ ...f, max_targets: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="冷却分钟">
                      <Input
                        type="number"
                        min={0}
                        value={alertSloEscalationForm.cooldown_minutes}
                        onChange={e => setAlertSloEscalationForm(f => ({ ...f, cooldown_minutes: e.target.value }))}
                      />
                    </Form.Item>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">动作与责任人</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="动作">
                      <Input
                        value={alertSloEscalationForm.actions}
                        onChange={e => setAlertSloEscalationForm(f => ({ ...f, actions: e.target.value }))}
                        placeholder="create_task,im_notify"
                      />
                    </Form.Item>
                    <Form.Item label="优先级">
                      <Select
                        value={alertSloEscalationForm.priority}
                        onChange={value => setAlertSloEscalationForm(f => ({ ...f, priority: value }))}
                        options={["P0", "P1", "P2", "P3"].map(item => ({ label: item, value: item }))}
                      />
                    </Form.Item>
                    <Form.Item label="负责人">
                      <Input
                        value={alertSloEscalationForm.assigned_to}
                        onChange={e => setAlertSloEscalationForm(f => ({ ...f, assigned_to: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="执行工具">
                      <Input
                        value={alertSloEscalationForm.dev_tool}
                        onChange={e => setAlertSloEscalationForm(f => ({ ...f, dev_tool: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="Owner">
                      <Input
                        value={alertSloEscalationForm.owner}
                        onChange={e => setAlertSloEscalationForm(f => ({ ...f, owner: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="启用策略">
                      <Switch
                        checked={alertSloEscalationForm.enabled}
                        onChange={checked => setAlertSloEscalationForm(f => ({ ...f, enabled: checked }))}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item label="说明">
                    <Input.TextArea
                      autoSize={{ minRows: 3, maxRows: 5 }}
                      value={alertSloEscalationForm.note}
                      onChange={e => setAlertSloEscalationForm(f => ({ ...f, note: e.target.value }))}
                    />
                  </Form.Item>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-sm font-semibold">执行证据</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">保存只更新策略；预览和执行会复用当前表单参数、IM 通道和 24 小时预测窗口。</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">最近候选</p>
                      <p className="text-sm font-semibold">{latestSloEscalation?.summary?.candidates ?? alertSloEscalationRunsQ.data?.summary?.latest_candidates ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">已建任务</p>
                      <p className="text-sm font-semibold">{latestSloEscalation?.summary?.created ?? alertSloEscalationRunsQ.data?.summary?.latest_created ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">IM 通道</p>
                      <p className="text-sm font-semibold">{imChannels.length}</p>
                    </div>
                  </div>
                </div>

                <Space className="mt-4" wrap>
                  <Button type="primary" htmlType="submit" loading={saveAlertSloEscalationPolicy.isPending}>
                    保存策略
                  </Button>
                  <Button onClick={() => runAlertSloEscalation.mutate(true)} loading={runAlertSloEscalation.isPending}>
                    预览升级
                  </Button>
                  <Button danger onClick={() => runAlertSloEscalation.mutate(false)} loading={runAlertSloEscalation.isPending}>
                    执行升级
                  </Button>
                  <Button onClick={() => setAlertSloEscalationDrawerOpen(false)}>取消</Button>
                </Space>
                {(saveAlertSloEscalationPolicy.error || runAlertSloEscalation.error) && (
                  <p className="mt-3 text-xs text-red-600">{((saveAlertSloEscalationPolicy.error || runAlertSloEscalation.error) as Error).message}</p>
                )}
              </Form>
            </div>
          </Drawer>
          <Drawer
            title="配置策略灰度审计"
            open={alertStrategyCanaryDrawerOpen}
            onClose={() => setAlertStrategyCanaryDrawerOpen(false)}
            width="min(680px, 100vw)"
          >
            <div className="alertStrategyCanaryFocusedDrawer space-y-5">
              <Steps
                size="small"
                current={1}
                items={[
                  { title: "候选" },
                  { title: "灰度" },
                  { title: "审批" },
                ]}
              />
              <Form layout="vertical" requiredMark={false} onFinish={() => runAlertStrategyCanaryAudit.mutate()}>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">候选策略</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="基准策略">
                      <Select
                        value={alertStrategyCanaryForm.policy_id}
                        onChange={value => setAlertStrategyCanaryForm(f => ({ ...f, policy_id: value }))}
                        options={[
                          { label: "自动选择候选策略", value: "" },
                          ...(alertNoiseQ.data?.items ?? []).map((item: any) => ({ label: item.name, value: item.id })),
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="候选策略">
                      <Select
                        value={alertStrategyCanaryForm.candidate_id}
                        onChange={value => setAlertStrategyCanaryForm(f => ({ ...f, candidate_id: value }))}
                        options={[
                          { label: "使用 A/B 胜出策略", value: "" },
                          ...(latestStrategyCompare?.items ?? []).slice(0, 8).map((item: any) => ({ label: item.name, value: item.id })),
                        ]}
                      />
                    </Form.Item>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">灰度参数</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="灰度流量">
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={alertStrategyCanaryForm.traffic_percent}
                        onChange={e => setAlertStrategyCanaryForm(f => ({ ...f, traffic_percent: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="审批人">
                      <Input
                        value={alertStrategyCanaryForm.created_by}
                        onChange={e => setAlertStrategyCanaryForm(f => ({ ...f, created_by: e.target.value }))}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item label="审计备注">
                    <Input.TextArea
                      autoSize={{ minRows: 3, maxRows: 5 }}
                      value={alertStrategyCanaryForm.note}
                      onChange={e => setAlertStrategyCanaryForm(f => ({ ...f, note: e.target.value }))}
                    />
                  </Form.Item>
                  <Form.Item label="刷新输入证据">
                    <Switch
                      checked={alertStrategyCanaryForm.refresh_inputs}
                      onChange={checked => setAlertStrategyCanaryForm(f => ({ ...f, refresh_inputs: checked }))}
                    />
                    <span className="ml-2 text-xs text-[var(--muted)]">重新计算策略对比和 SLO 风险。</span>
                  </Form.Item>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-sm font-semibold">审批证据</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">准入分</p>
                      <p className="text-sm font-semibold">{latestStrategyCanary?.summary?.readiness_score ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_readiness_score ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">建议流量</p>
                      <p className="text-sm font-semibold">{latestStrategyCanary?.summary?.recommended_percent ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_recommended_percent ?? 0}%</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">结论</p>
                      <p className="text-sm font-semibold">{latestStrategyCanary?.summary?.decision ?? alertStrategyCanaryAuditsQ.data?.summary?.latest_decision ?? "-"}</p>
                    </div>
                  </div>
                </div>

                <Space className="mt-4" wrap>
                  <Button type="primary" htmlType="submit" loading={runAlertStrategyCanaryAudit.isPending}>
                    生成灰度审计
                  </Button>
                  <Button onClick={() => setAlertStrategyCanaryDrawerOpen(false)}>取消</Button>
                </Space>
                {runAlertStrategyCanaryAudit.error && <p className="mt-3 text-xs text-red-600">{(runAlertStrategyCanaryAudit.error as Error).message}</p>}
              </Form>
            </div>
          </Drawer>
          <Drawer
            title="配置跨模块联动"
            open={opsStrategyLinkageDrawerOpen}
            onClose={() => setOpsStrategyLinkageDrawerOpen(false)}
            width="min(680px, 100vw)"
          >
            <div className="opsStrategyLinkageFocusedDrawer space-y-5">
              <Steps
                size="small"
                current={1}
                items={[
                  { title: "范围" },
                  { title: "动作" },
                  { title: "证据" },
                ]}
              />
              <Form layout="vertical" requiredMark={false} onFinish={() => runOpsStrategyLinkage.mutate(true)}>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">联动范围</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="动作">
                      <Input
                        value={opsStrategyLinkageForm.actions}
                        onChange={e => setOpsStrategyLinkageForm(f => ({ ...f, actions: e.target.value }))}
                        placeholder="create_task,im_notify"
                      />
                    </Form.Item>
                    <Form.Item label="最大联动项">
                      <Input
                        type="number"
                        min={1}
                        value={opsStrategyLinkageForm.max_items}
                        onChange={e => setOpsStrategyLinkageForm(f => ({ ...f, max_items: e.target.value }))}
                      />
                    </Form.Item>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <p className="text-sm font-semibold">任务与投递</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Form.Item label="优先级">
                      <Select
                        value={opsStrategyLinkageForm.priority}
                        onChange={value => setOpsStrategyLinkageForm(f => ({ ...f, priority: value }))}
                        options={["P0", "P1", "P2", "P3"].map(item => ({ label: item, value: item }))}
                      />
                    </Form.Item>
                    <Form.Item label="负责人">
                      <Input
                        value={opsStrategyLinkageForm.assigned_to}
                        onChange={e => setOpsStrategyLinkageForm(f => ({ ...f, assigned_to: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="执行工具">
                      <Input
                        value={opsStrategyLinkageForm.dev_tool}
                        onChange={e => setOpsStrategyLinkageForm(f => ({ ...f, dev_tool: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="IM 通道">
                      <Input value={`${imChannels.length} 个已选通道`} disabled />
                    </Form.Item>
                  </div>
                  <Form.Item label="联动说明">
                    <Input.TextArea
                      autoSize={{ minRows: 3, maxRows: 5 }}
                      value={opsStrategyLinkageForm.note}
                      onChange={e => setOpsStrategyLinkageForm(f => ({ ...f, note: e.target.value }))}
                    />
                  </Form.Item>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-sm font-semibold">联动证据</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">预览不会落库；执行会创建治理任务并按 Notify 计划发送风险简报。</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">联动项</p>
                      <p className="text-sm font-semibold">{latestOpsStrategyLinkage?.summary?.linkage_items ?? opsStrategyLinkageRunsQ.data?.summary?.latest_items ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">高风险</p>
                      <p className="text-sm font-semibold">{latestOpsStrategyLinkage?.summary?.high_risk ?? opsStrategyLinkageRunsQ.data?.summary?.latest_high_risk ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-xs text-[var(--muted)]">已建任务</p>
                      <p className="text-sm font-semibold">{latestOpsStrategyLinkage?.summary?.created ?? opsStrategyLinkageRunsQ.data?.summary?.latest_created ?? 0}</p>
                    </div>
                  </div>
                </div>

                <Space className="mt-4" wrap>
                  <Button type="primary" htmlType="submit" loading={runOpsStrategyLinkage.isPending}>
                    预览联动
                  </Button>
                  <Button danger onClick={() => runOpsStrategyLinkage.mutate(false)} loading={runOpsStrategyLinkage.isPending}>
                    执行联动
                  </Button>
                  <Button onClick={() => setOpsStrategyLinkageDrawerOpen(false)}>取消</Button>
                </Space>
                {runOpsStrategyLinkage.error && <p className="mt-3 text-xs text-red-600">{(runOpsStrategyLinkage.error as Error).message}</p>}
              </Form>
            </div>
          </Drawer>
          </>
        )}

        {tab === "rca" && (
          <WorkbenchPanel title="根因分析" actions={
            <div className="flex gap-2">
              <RefreshButton onClick={() => void rcaQ.refetch()} pending={rcaQ.isFetching} />
              <Button type="primary" size="small" onClick={() => setRcaCreateDrawerOpen(true)}>新建 RCA</Button>
            </div>
          }>
            <Drawer
              title="新建 RCA"
              open={rcaCreateDrawerOpen}
              onClose={() => setRcaCreateDrawerOpen(false)}
              width="min(620px, 100vw)"
            >
              <div className="rcaCreateFocusedDrawer space-y-5">
                <Steps
                  size="small"
                  current={rcaForm.incident_id && rcaForm.root_cause ? 1 : 0}
                  items={[
                    { title: "事件" },
                    { title: "根因" },
                    { title: "闭环" },
                  ]}
                />
                <Form layout="vertical" requiredMark={false} onFinish={() => createRca.mutate()}>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">事件信息</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Form.Item label="事件 ID" required>
                        <Input value={rcaForm.incident_id} onChange={e => setRcaForm(f => ({ ...f, incident_id: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="影响范围">
                        <Input value={rcaForm.impact} onChange={e => setRcaForm(f => ({ ...f, impact: e.target.value }))} />
                      </Form.Item>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">根因与处置</p>
                    <Form.Item className="mt-3" label="根因描述" required>
                      <Input.TextArea
                        autoSize={{ minRows: 3, maxRows: 5 }}
                        value={rcaForm.root_cause}
                        onChange={e => setRcaForm(f => ({ ...f, root_cause: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="解决方案">
                      <Input.TextArea
                        autoSize={{ minRows: 3, maxRows: 5 }}
                        value={rcaForm.resolution}
                        onChange={e => setRcaForm(f => ({ ...f, resolution: e.target.value }))}
                      />
                    </Form.Item>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-semibold">创建后闭环</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">RCA 创建后会进入列表，可继续生成验证计划、执行验证关闭，并与 Runbook 和任务中心形成治理证据。</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">事件</p>
                        <p className="truncate text-sm font-semibold">{rcaForm.incident_id || "-"}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">影响</p>
                        <p className="truncate text-sm font-semibold">{rcaForm.impact || "待补充"}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">状态</p>
                        <p className="text-sm font-semibold">{rcaForm.root_cause ? "可创建" : "待补根因"}</p>
                      </div>
                    </div>
                  </div>

                  <Space className="mt-4" wrap>
                    <Button type="primary" htmlType="submit" loading={createRca.isPending} disabled={!rcaForm.incident_id || !rcaForm.root_cause}>
                      创建 RCA
                    </Button>
                    <Button onClick={() => setRcaCreateDrawerOpen(false)}>取消</Button>
                  </Space>
                  {createRca.error && <p className="mt-3 text-xs text-red-600">{(createRca.error as Error).message}</p>}
                </Form>
              </div>
            </Drawer>
            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">智能根因归因</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">聚合 Trace、数据质量告警、计费提醒、失败流水线和未关闭 RCA，生成可任务化的根因候选。</p>
                </div>
                <Space wrap>
                  <span className={`rounded-full px-2 py-1 text-xs ${severityClass((rcaInsightResult?.candidates ?? [])[0]?.severity)}`}>
                    {(rcaInsightResult?.summary?.candidates ?? 0) || "待分析"} 候选
                  </span>
                  <Button size="small" onClick={() => setRcaInsightDrawerOpen(true)}>配置归因</Button>
                </Space>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Agent Run", rcaInsightFilter.run_id || "全部运行"],
                  ["Trace", rcaInsightFilter.trace_id || "自动聚合"],
                  ["Correlation", rcaInsightFilter.correlation_id || "自动聚合"],
                  ["采样/任务", `${rcaInsightFilter.limit} / ${rcaInsightFilter.priority}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-[var(--surface-muted)] p-3">
                    <p className="text-[11px] uppercase text-[var(--muted)]">{label}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-[var(--text)]">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => analyzeRcaInsights.mutate()} disabled={analyzeRcaInsights.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                  {analyzeRcaInsights.isPending ? "分析中..." : "生成归因"}
                </button>
                <button onClick={() => createRcaInsightTasks.mutate(true)} disabled={createRcaInsightTasks.isPending || !rcaInsightResult} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm disabled:opacity-50">预览任务</button>
                <button onClick={() => createRcaInsightTasks.mutate(false)} disabled={createRcaInsightTasks.isPending || !rcaInsightResult} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm disabled:opacity-50">创建任务</button>
              </div>
              {analyzeRcaInsights.error && <p className="mt-2 text-xs text-red-600">{(analyzeRcaInsights.error as Error).message}</p>}
              {createRcaInsightTasks.error && <p className="mt-2 text-xs text-red-600">{(createRcaInsightTasks.error as Error).message}</p>}
              {rcaInsightResult && (
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
                  <div className="space-y-3">
                    {(rcaInsightResult.candidates ?? []).map((item: any) => (
                      <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{item.title}</p>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${severityClass(item.severity)}`}>{item.severity} / {Math.round(Number(item.confidence || 0) * 100)}%</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.root_cause}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(item.evidence ?? []).slice(0, 4).map((ev: any, idx: number) => (
                            <span key={`${item.id}-ev-${idx}`} className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[11px] text-[var(--muted-strong)]">{ev.type}: {ev.label || ev.status || "-"}</span>
                          ))}
                        </div>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[var(--muted)]">
                          {(item.recommendations ?? []).slice(0, 3).map((rec: string) => <li key={rec}>{rec}</li>)}
                        </ul>
                        {(item.recommended_runbooks ?? []).length > 0 && (
                          <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-2">
                            <p className="text-[11px] font-semibold uppercase text-[var(--muted)]">推荐 Runbook</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(item.recommended_runbooks ?? []).slice(0, 3).map((runbook: any) => (
                                <span key={runbook.id || runbook.name} className="rounded-full bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--muted-strong)]">
                                  {runbook.name || runbook.id} / {runbook.match_score}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {item.kind !== "healthy_baseline" && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() => createRcaFromInsight.mutate(item)}
                              disabled={createRcaFromInsight.isPending}
                              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] disabled:opacity-50"
                            >
                              生成 RCA
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <p className="text-xs font-semibold uppercase text-[var(--muted)]">归因摘要</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      {Object.entries(rcaInsightResult.summary ?? {}).map(([key, value]) => (
                        <div key={key} className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">
                          <p className="text-[10px] uppercase text-[var(--muted)]">{key}</p>
                          <p className="mt-1 font-semibold text-[var(--text)]">{String(value)}</p>
                        </div>
                      ))}
                    </div>
                    {rcaInsightTasksResult && (
                      <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
                        <p className="font-semibold text-[var(--text)]">{rcaInsightTasksResult.dry_run ? "任务预览" : "已创建任务"}：{rcaInsightTasksResult.summary?.created ?? rcaInsightTasksResult.summary?.planned ?? 0}</p>
                        <div className="mt-2 space-y-2">
                          {(rcaInsightTasksResult.tasks ?? rcaInsightTasksResult.items ?? []).slice(0, 4).map((task: any) => (
                            <p key={task.id || task.title} className="rounded bg-[var(--surface)] px-2 py-1 text-[var(--muted-strong)]">{task.title}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {rcaInsightCreateResult && (
                      <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
                        <p className="font-semibold text-[var(--text)]">已生成 RCA：{rcaInsightCreateResult.item?.incident_id}</p>
                        <p className="mt-1 text-[var(--muted)]">{rcaInsightCreateResult.item?.root_cause}</p>
                      </div>
                    )}
                    {createRcaFromInsight.error && <p className="mt-2 text-xs text-red-600">{(createRcaFromInsight.error as Error).message}</p>}
                  </div>
                </div>
              )}
            </div>
            <Drawer
              title="配置智能根因归因"
              open={rcaInsightDrawerOpen}
              onClose={() => setRcaInsightDrawerOpen(false)}
              width="min(680px, 100vw)"
            >
              <div className="rcaInsightFocusedDrawer space-y-5">
                <Steps
                  size="small"
                  current={rcaInsightTasksResult ? 2 : rcaInsightResult ? 1 : 0}
                  items={[
                    { title: "归因范围" },
                    { title: "生成候选" },
                    { title: "任务闭环" },
                  ]}
                />
                <Form layout="vertical" requiredMark={false} onFinish={() => analyzeRcaInsights.mutate()}>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">归因范围</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">留空时聚合当前作用域的 Trace、流水线、告警、计费和未关闭 RCA。</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Form.Item label="Agent Run ID">
                        <Input value={rcaInsightFilter.run_id} onChange={e => setRcaInsightFilter(f => ({ ...f, run_id: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="Trace ID">
                        <Input value={rcaInsightFilter.trace_id} onChange={e => setRcaInsightFilter(f => ({ ...f, trace_id: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="Correlation ID">
                        <Input value={rcaInsightFilter.correlation_id} onChange={e => setRcaInsightFilter(f => ({ ...f, correlation_id: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="采样数量">
                        <Input
                          type="number"
                          min={1}
                          value={rcaInsightFilter.limit}
                          onChange={e => setRcaInsightFilter(f => ({ ...f, limit: e.target.value }))}
                        />
                      </Form.Item>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">任务化参数</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Form.Item label="优先级">
                        <Select
                          value={rcaInsightFilter.priority}
                          onChange={value => setRcaInsightFilter(f => ({ ...f, priority: value }))}
                          options={["P0", "P1", "P2", "P3"].map(item => ({ label: item, value: item }))}
                        />
                      </Form.Item>
                      <Form.Item label="负责人">
                        <Input value={rcaInsightFilter.assigned_to} onChange={e => setRcaInsightFilter(f => ({ ...f, assigned_to: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="执行工具">
                        <Input value={rcaInsightFilter.dev_tool} onChange={e => setRcaInsightFilter(f => ({ ...f, dev_tool: e.target.value }))} />
                      </Form.Item>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-semibold">归因证据</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">先生成候选，再按当前任务参数预览或创建治理任务。</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">候选</p>
                        <p className="text-sm font-semibold">{rcaInsightResult?.summary?.candidates ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">高风险</p>
                        <p className="text-sm font-semibold">{rcaInsightResult?.summary?.high_risk ?? rcaInsightResult?.summary?.critical ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">任务</p>
                        <p className="text-sm font-semibold">{rcaInsightTasksResult?.summary?.created ?? rcaInsightTasksResult?.summary?.planned ?? 0}</p>
                      </div>
                    </div>
                  </div>

                  <Space className="mt-4" wrap>
                    <Button type="primary" htmlType="submit" loading={analyzeRcaInsights.isPending}>
                      生成归因
                    </Button>
                    <Button onClick={() => createRcaInsightTasks.mutate(true)} disabled={!rcaInsightResult} loading={createRcaInsightTasks.isPending}>
                      预览任务
                    </Button>
                    <Button danger onClick={() => createRcaInsightTasks.mutate(false)} disabled={!rcaInsightResult} loading={createRcaInsightTasks.isPending}>
                      创建任务
                    </Button>
                    <Button onClick={() => setRcaInsightDrawerOpen(false)}>取消</Button>
                  </Space>
                  {analyzeRcaInsights.error && <p className="mt-3 text-xs text-red-600">{(analyzeRcaInsights.error as Error).message}</p>}
                  {createRcaInsightTasks.error && <p className="mt-3 text-xs text-red-600">{(createRcaInsightTasks.error as Error).message}</p>}
                </Form>
              </div>
            </Drawer>
            {rcaVerifyResult && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">RCA 验证闭环：{rcaVerifyResult.incident_id || rcaVerifyResult.item?.incident_id}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">评分 {rcaVerifyResult.plan?.score ?? rcaVerifyResult.score ?? 0}，状态 {rcaVerifyResult.plan?.status ?? rcaVerifyResult.status ?? rcaVerifyResult.verification?.status}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${(rcaVerifyResult.plan?.status ?? rcaVerifyResult.status) === "passed" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                    {rcaVerifyResult.item?.status || rcaVerifyResult.plan?.status || rcaVerifyResult.status}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-3">
                  {(rcaVerifyResult.plan?.checks ?? rcaVerifyResult.checks ?? []).map((check: any) => (
                    <div key={check.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-[var(--text)]">{check.title}</p>
                        <span className={check.status === "passed" ? "text-green-700" : check.status === "failed" ? "text-red-700" : "text-amber-700"}>{check.status}</span>
                      </div>
                      <p className="mt-1 leading-5 text-[var(--muted)]">{check.recommendation}</p>
                    </div>
                  ))}
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
                    {r.source === "ops_center_rca_insight" && (
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--muted-strong)]">
                        <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1">智能归因</span>
                        <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1">{r.severity} / {Math.round(Number(r.confidence || 0) * 100)}%</span>
                        {(r.selected_runbook_ids ?? []).slice(0, 3).map((id: string) => <span key={id} className="rounded-full bg-[var(--surface-muted)] px-2 py-1">Runbook: {id}</span>)}
                      </div>
                    )}
                    {(r.verification_status || r.verified_at) && (
                      <p className="mt-2 text-[11px] text-[var(--muted)]">最近验证：{r.verification_status || "watch"} / {r.verification_score ?? 0} / {r.verified_by || "-"}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => loadRcaVerificationPlan.mutate(r.id)} disabled={loadRcaVerificationPlan.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-50">验证计划</button>
                      {r.status === "open" && <button onClick={() => verifyRca.mutate(r)} disabled={verifyRca.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">验证并关闭</button>}
                      {r.status === "open" && <button onClick={() => resolveRca.mutate(r.id)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--brand)]">手动关闭</button>}
                    </div>
                    {(loadRcaVerificationPlan.error || verifyRca.error) && <p className="mt-2 text-xs text-red-600">{((loadRcaVerificationPlan.error || verifyRca.error) as Error).message}</p>}
	                </div>
              ))}
            </div>
          </WorkbenchPanel>
        )}

        {tab === "runbooks" && (
          <WorkbenchPanel title="Runbook 版本治理" actions={
            <div className="flex flex-wrap gap-2">
              <RefreshButton onClick={() => { void rbQ.refetch(); void rbEvidenceQ.refetch(); if (selectedRunbookId) void rbVersionsQ.refetch(); }} pending={rbQ.isFetching || rbVersionsQ.isFetching || rbEvidenceQ.isFetching} />
              <button
                onClick={() => backfillRunbookEvidence.mutate(selectedRunbookId || undefined)}
                disabled={backfillRunbookEvidence.isPending}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)] disabled:opacity-50"
              >
                {backfillRunbookEvidence.isPending ? "回填中..." : "自动回填证据"}
              </button>
              <button
                onClick={() => { setRbForm({ id: "", name: "", steps: "", tags: "", owner: "Ops Lead", change_note: "" }); setRunbookEditorDrawerOpen(true); }}
                className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90"
              >
                + 新建
              </button>
            </div>
          }>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {[
                ["Runbook", rbQ.data?.summary?.runbooks ?? rbQ.data?.total ?? 0],
                ["版本数", rbQ.data?.summary?.versions ?? 0],
                ["激活版本", rbQ.data?.summary?.active_versions ?? 0],
                ["治理健康", rbQ.data?.summary?.health_score ?? 100],
                ["执行证据", rbEvidenceQ.data?.summary?.records ?? 0],
                ["证据覆盖", `${rbEvidenceQ.data?.summary?.coverage_score ?? 100}%`],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-[11px] uppercase text-[var(--muted)]">{label}</p>
                  <p className="mt-1 text-2xl font-semibold">{String(value)}</p>
                </div>
              ))}
            </div>
            <Drawer
              title={rbForm.id ? "编辑 Runbook 版本" : "新建 Runbook"}
              open={runbookEditorDrawerOpen}
              onClose={() => setRunbookEditorDrawerOpen(false)}
              width="min(700px, 100vw)"
            >
              <div className="runbookEditorFocusedDrawer space-y-5">
                <Steps
                  size="small"
                  current={rbForm.name && rbForm.steps ? 1 : 0}
                  items={[
                    { title: "身份" },
                    { title: "步骤" },
                    { title: "版本" },
                  ]}
                />
                <Form layout="vertical" requiredMark={false} onFinish={() => saveRb.mutate()}>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">Runbook 身份</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Form.Item label="Runbook 名称" required>
                        <Input value={rbForm.name} onChange={e => setRbForm(f => ({ ...f, name: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="负责人">
                        <Input value={rbForm.owner} onChange={e => setRbForm(f => ({ ...f, owner: e.target.value }))} />
                      </Form.Item>
                      <Form.Item label="标签">
                        <Input value={rbForm.tags} onChange={e => setRbForm(f => ({ ...f, tags: e.target.value }))} placeholder="incident,api" />
                      </Form.Item>
                      <Form.Item label="变更说明">
                        <Input value={rbForm.change_note} onChange={e => setRbForm(f => ({ ...f, change_note: e.target.value }))} />
                      </Form.Item>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <p className="text-sm font-semibold">执行步骤</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">每行一个步骤，保存后生成不可变版本快照。</p>
                    <Form.Item className="mt-3" label="操作步骤" required>
                      <Input.TextArea
                        autoSize={{ minRows: 5, maxRows: 8 }}
                        value={rbForm.steps}
                        onChange={e => setRbForm(f => ({ ...f, steps: e.target.value }))}
                      />
                    </Form.Item>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-semibold">版本证据</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">保存后会刷新 Runbook 列表与版本历史；编辑已有 Runbook 时会生成新版本，便于差异对比、恢复和归档。</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">模式</p>
                        <p className="text-sm font-semibold">{rbForm.id ? "新版本" : "首版本"}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">步骤数</p>
                        <p className="text-sm font-semibold">{rbForm.steps.split("\n").filter(Boolean).length}</p>
                      </div>
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                        <p className="text-xs text-[var(--muted)]">当前版本数</p>
                        <p className="text-sm font-semibold">{rbVersionsQ.data?.total ?? 0}</p>
                      </div>
                    </div>
                  </div>

                  <Space className="mt-4" wrap>
                    <Button type="primary" htmlType="submit" loading={saveRb.isPending} disabled={!rbForm.name}>
                      {rbForm.id ? "保存并生成版本" : "创建首个版本"}
                    </Button>
                    <Button onClick={() => { setRunbookEditorDrawerOpen(false); setRbForm({ id: "", name: "", steps: "", tags: "", owner: "Ops Lead", change_note: "" }); }}>
                      取消
                    </Button>
                  </Space>
                  {saveRb.error && <p className="mt-3 text-xs text-red-600">{(saveRb.error as Error).message}</p>}
                </Form>
              </div>
            </Drawer>
            <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(460px,1.1fr)]">
              <div className="space-y-3">
                {(rbQ.data?.items ?? []).length === 0 && <p className="py-8 text-center text-sm text-[var(--muted)]">暂无 Runbook</p>}
                {(rbQ.data?.items ?? []).map((r: any) => (
                  <div key={r.id} className={`rounded-xl border p-4 ${selectedRunbookId === r.id ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-sm">{r.name}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">v{r.active_version_no ?? 1} / {r.steps?.length ?? 0} 步 / {r.owner || "Ops Lead"}</p>
                      </div>
                      <span className="rounded-full bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--muted-strong)]">{r.status || "active"}</span>
                    </div>
                    {r.tags?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{r.tags.map((t: string) => <span key={t} className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-xs text-[var(--brand)]">{t}</span>)}</div>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => { setSelectedRunbookId(r.id); setRunbookDiffResult(null); }} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs">版本治理</button>
                      <button onClick={() => backfillRunbookEvidence.mutate(r.id)} disabled={backfillRunbookEvidence.isPending} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs disabled:opacity-50">回填证据</button>
                      <button
                        onClick={() => {
                          setRbForm({ id: r.id, name: r.name || "", steps: (r.steps || []).join("\n"), tags: (r.tags || []).join(", "), owner: r.owner || "Ops Lead", change_note: "" });
                          setSelectedRunbookId(r.id);
                          setRunbookEditorDrawerOpen(true);
                        }}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs"
                      >
                        编辑生成新版本
                      </button>
                      <button onClick={() => deleteRb.mutate(r.id)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-600">删除</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                {!selectedRunbookId ? (
                  <p className="py-8 text-center text-sm text-[var(--muted)]">选择左侧 Runbook 查看版本历史、差异和发布操作。</p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">版本历史</p>
                        <p className="text-xs text-[var(--muted)]">不可变快照、激活版本、归档和历史恢复。</p>
                      </div>
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-xs">{rbVersionsQ.data?.total ?? 0} 个版本</span>
                    </div>
                    {(rbVersionsQ.data?.items ?? []).slice(0, 8).map((version: any, index: number, arr: any[]) => (
                      <div key={version.id} className="rounded-lg border border-[var(--border)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">v{version.version_no} · {version.snapshot?.name}</p>
                            <p className="text-xs text-[var(--muted)]">{version.created_by || "-"} / {version.created_at || "-"} / {version.checksum?.slice(0, 10)}</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[11px] ${version.status === "active" ? "bg-green-50 text-green-700" : version.status === "archived" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{version.status}</span>
                        </div>
                        <p className="mt-2 text-xs text-[var(--muted)]">步骤：{version.snapshot?.steps?.length ?? 0} / 标签：{(version.snapshot?.tags ?? []).join(", ") || "-"}</p>
                        {version.change_note ? <p className="mt-1 text-xs text-[var(--muted-strong)]">说明：{version.change_note}</p> : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            disabled={version.status === "active" || runbookVersionAction.isPending}
                            onClick={() => runbookVersionAction.mutate({ runbookId: selectedRunbookId, versionId: version.id, action: "promote" })}
                            className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
                          >
                            恢复为当前
                          </button>
                          <button
                            disabled={version.status === "active" || version.status === "archived" || runbookVersionAction.isPending}
                            onClick={() => runbookVersionAction.mutate({ runbookId: selectedRunbookId, versionId: version.id, action: "archive" })}
                            className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
                          >
                            归档
                          </button>
                          {arr[index + 1] ? (
                            <button
                              disabled={compareRunbookVersions.isPending}
                              onClick={() => compareRunbookVersions.mutate({ runbookId: selectedRunbookId, baseVersionId: arr[index + 1].id, targetVersionId: version.id })}
                              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
                            >
                              对比上一版
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    {runbookDiffResult?.diff ? (
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
                        <p className="font-semibold">版本差异</p>
                        <p className="mt-1 text-[var(--muted)]">名称变化：{runbookDiffResult.diff.name_changed ? "是" : "否"}；步骤变化：{runbookDiffResult.diff.summary?.changed_steps ?? 0}；新增标签：{runbookDiffResult.diff.added_tags?.join(", ") || "-"}</p>
                        <div className="mt-2 max-h-36 overflow-auto space-y-1">
                          {(runbookDiffResult.diff.changed_steps ?? []).slice(0, 10).map((step: any) => (
                            <p key={step.index} className="rounded bg-[var(--surface)] p-2">#{step.index}：{step.base || "-"} → {step.target || "-"}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold">执行证据回填</p>
                          <p className="mt-1 text-[var(--muted)]">自动关联 RCA 验证、自愈执行和流水线恢复记录。</p>
                        </div>
                        <span className="rounded-full bg-[var(--surface)] px-2 py-1">{rbEvidenceQ.data?.summary?.missing_evidence ?? 0} 项缺口</span>
                      </div>
                      {runbookEvidenceResult?.summary ? (
                        <p className="mt-2 rounded bg-[var(--surface)] p-2 text-[var(--muted-strong)]">
                          最近回填：{runbookEvidenceResult.summary.records ?? 0} 条，覆盖率 {runbookEvidenceResult.summary.coverage_score ?? 100}%，已保存 {runbookEvidenceResult.persisted ?? 0} 条。
                        </p>
                      ) : null}
                      <div className="mt-3 max-h-64 overflow-auto space-y-2">
                        {(rbEvidenceQ.data?.items ?? []).length === 0 ? (
                          <p className="py-4 text-center text-[var(--muted)]">暂无执行证据，点击自动回填从 RCA 与自愈记录中归集。</p>
                        ) : (rbEvidenceQ.data?.items ?? []).slice(0, 8).map((record: any) => (
                          <div key={record.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="font-semibold">{record.runbook_name || record.runbook_id} · v{record.version_no ?? 1}</p>
                                <p className="mt-1 text-[var(--muted)]">覆盖率 {record.coverage_score ?? 0}% / 来源 {(record.sources ?? []).length} / {record.review_status || "open"}</p>
                              </div>
                              <span className={`rounded-full px-2 py-1 ${record.status === "complete" ? "bg-green-50 text-green-700" : record.status === "partial" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{record.status}</span>
                            </div>
                            {(record.missing_evidence ?? []).length > 0 ? (
                              <p className="mt-2 text-[var(--muted)]">缺口：{record.missing_evidence.map((item: any) => item.title || item.id).join("、")}</p>
                            ) : (
                              <p className="mt-2 text-green-700">证据链已完整，可作为执行审计归档。</p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(record.collected_evidence ?? []).slice(0, 5).map((item: any) => (
                                <span key={`${record.id}-${item.id}`} className="rounded bg-[var(--surface-muted)] px-2 py-1">{item.title || item.id}</span>
                              ))}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                onClick={() => updateRunbookEvidence.mutate({ id: record.id, action: "acknowledge" })}
                                disabled={updateRunbookEvidence.isPending || record.review_status === "acknowledged"}
                                className="rounded-lg border border-[var(--border)] px-3 py-1 disabled:opacity-50"
                              >
                                确认
                              </button>
                              <button
                                onClick={() => updateRunbookEvidence.mutate({ id: record.id, action: record.review_status === "archived" ? "reopen" : "archive" })}
                                disabled={updateRunbookEvidence.isPending}
                                className="rounded-lg border border-[var(--border)] px-3 py-1 disabled:opacity-50"
                              >
                                {record.review_status === "archived" ? "重新打开" : "归档"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {(rbVersionsQ.data?.events ?? []).length ? (
                      <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
                        <p className="font-semibold">治理审计</p>
                        <div className="mt-2 max-h-32 overflow-auto space-y-1">
                          {rbVersionsQ.data.events.slice(0, 8).map((event: any) => (
                            <p key={event.id} className="text-[var(--muted)]">{event.created_at} / {event.event_type} / {event.actor || "-"}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </WorkbenchPanel>
        )}

        {tab === "self-heal" && (
          <div className="grid gap-4 xl:grid-cols-[minmax(420px,1fr)_minmax(420px,1fr)]">
            <WorkbenchPanel title="策略目录与信号评估" actions={
              <div className="flex gap-2">
                <RefreshButton onClick={() => { void shQ.refetch(); void evalQ.refetch(); void actionsQ.refetch(); }} pending={shQ.isFetching || evalQ.isFetching || actionsQ.isFetching} />
                <Button size="small" onClick={() => setSelfHealSignalDrawerOpen(true)}>配置信号</Button>
                <Button type="primary" size="small" onClick={() => setSelfHealPolicyDrawerOpen(true)}>新建策略</Button>
              </div>
            }>
              <Drawer
                title="新建自愈策略"
                open={selfHealPolicyDrawerOpen}
                onClose={() => setSelfHealPolicyDrawerOpen(false)}
                width="min(620px, 100vw)"
              >
                <div className="selfHealPolicyFocusedDrawer space-y-5">
                  <Steps
                    size="small"
                    current={shForm.trigger_condition && shForm.action ? 1 : 0}
                    items={[
                      { title: "触发" },
                      { title: "动作" },
                      { title: "护栏" },
                    ]}
                  />
                  <Form layout="vertical" requiredMark={false} onFinish={() => createSh.mutate()}>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                      <p className="text-sm font-semibold">触发条件</p>
                      <Form.Item className="mt-3" label="条件表达式" required>
                        <Input
                          value={shForm.trigger_condition}
                          onChange={e => setShForm(f => ({ ...f, trigger_condition: e.target.value }))}
                          placeholder="cpu > 90"
                        />
                      </Form.Item>
                    </div>

                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                      <p className="text-sm font-semibold">自愈动作</p>
                      <Form.Item className="mt-3" label="动作命令/API" required>
                        <Input
                          value={shForm.action}
                          onChange={e => setShForm(f => ({ ...f, action: e.target.value }))}
                          placeholder="restart_service api"
                        />
                      </Form.Item>
                      <Form.Item label="启用策略">
                        <Switch checked={shForm.enabled} onChange={checked => setShForm(f => ({ ...f, enabled: checked }))} />
                      </Form.Item>
                    </div>

                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <p className="text-sm font-semibold">护栏说明</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">策略创建后会参与信号评估；高风险动作仍会进入审批、应用、验证和回滚队列。</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">状态</p>
                          <p className="text-sm font-semibold">{shForm.enabled ? "启用" : "禁用"}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">策略数</p>
                          <p className="text-sm font-semibold">{shQ.data?.items?.length ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">动作队列</p>
                          <p className="text-sm font-semibold">{actionsQ.data?.items?.length ?? 0}</p>
                        </div>
                      </div>
                    </div>

                    <Space className="mt-4" wrap>
                      <Button type="primary" htmlType="submit" loading={createSh.isPending} disabled={!shForm.trigger_condition || !shForm.action}>
                        创建策略
                      </Button>
                      <Button onClick={() => setSelfHealPolicyDrawerOpen(false)}>取消</Button>
                    </Space>
                    {createSh.error && <p className="mt-3 text-xs text-red-600">{(createSh.error as Error).message}</p>}
                  </Form>
                </div>
              </Drawer>

              <Drawer
                title="配置自愈评估信号"
                open={selfHealSignalDrawerOpen}
                onClose={() => setSelfHealSignalDrawerOpen(false)}
                width="min(680px, 100vw)"
              >
                <div className="selfHealSignalFocusedDrawer space-y-5">
                  <Steps
                    size="small"
                    current={healTasksResult ? 2 : healResult ? 1 : 0}
                    items={[
                      { title: "信号" },
                      { title: "评估" },
                      { title: "任务" },
                    ]}
                  />
                  <Form layout="vertical" requiredMark={false} onFinish={() => evaluateSh.mutate()}>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                      <p className="text-sm font-semibold">运行信号</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">每行一个 key=value，支持 cpu、error_rate、latency_ms、environment、service 等字段。</p>
                      <Form.Item className="mt-3" label="信号输入" required>
                        <Input.TextArea
                          className="font-mono text-xs"
                          autoSize={{ minRows: 6, maxRows: 10 }}
                          value={signalText}
                          onChange={e => setSignalText(e.target.value)}
                          placeholder={"cpu=95\nerror_rate=3\nlatency_ms=1200\nenvironment=staging"}
                        />
                      </Form.Item>
                    </div>

                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <p className="text-sm font-semibold">评估证据</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">信号数</p>
                          <p className="text-sm font-semibold">{Object.keys(parseSignals(signalText)).length}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">命中</p>
                          <p className="text-sm font-semibold">{healResult?.summary?.matched ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">待审批</p>
                          <p className="text-sm font-semibold">{healResult?.summary?.needs_approval ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                          <p className="text-xs text-[var(--muted)]">任务</p>
                          <p className="text-sm font-semibold">{healTasksResult?.items?.length ?? 0}</p>
                        </div>
                      </div>
                    </div>

                    <Space className="mt-4" wrap>
                      <Button type="primary" htmlType="submit" loading={evaluateSh.isPending}>
                        评估自愈决策
                      </Button>
                      <Button onClick={() => createHealTasks.mutate(true)} loading={createHealTasks.isPending}>
                        预览治理任务
                      </Button>
                      <Button danger onClick={() => createHealTasks.mutate(false)} loading={createHealTasks.isPending}>
                        生成治理任务
                      </Button>
                      <Button onClick={() => setSelfHealSignalDrawerOpen(false)}>取消</Button>
                    </Space>
                    {evaluateSh.isError ? <p className="mt-3 text-xs text-red-600">{(evaluateSh.error as Error).message}</p> : null}
                  </Form>
                </div>
              </Drawer>

              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["信号数", Object.keys(parseSignals(signalText)).length],
                    ["策略数", shQ.data?.items?.length ?? 0],
                    ["最近命中", healResult?.summary?.matched ?? 0],
                    ["待审批", healResult?.summary?.needs_approval ?? 0],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg bg-[var(--surface-muted)] p-3">
                      <p className="text-[11px] uppercase text-[var(--muted)]">{label}</p>
                      <p className="mt-1 text-lg font-semibold">{String(value)}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="primary" onClick={() => evaluateSh.mutate()} loading={evaluateSh.isPending}>
                    评估自愈决策
                  </Button>
                  <Button onClick={() => createHealTasks.mutate(true)} loading={createHealTasks.isPending}>
                    预览治理任务
                  </Button>
                  <Button onClick={() => createHealTasks.mutate(false)} loading={createHealTasks.isPending}>
                    生成治理任务
                  </Button>
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

            <WorkbenchPanel title="生产护栏动作队列">
              <div className="space-y-3">
                {(actionsQ.data?.items ?? []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-center text-sm text-[var(--muted)]">
                    暂无自愈动作。执行评估后会生成 preview 或 approval_required 状态的动作。
                  </div>
                ) : null}
                {(actionsQ.data?.items ?? []).map((item: any) => (
                  <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{item.trigger_condition}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{item.action}</p>
                      </div>
                      <span className={`rounded px-2 py-0.5 text-xs ${actionStateClass(item.state)}`}>{item.state} · {item.risk_level}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">审批：{item.requires_approval ? item.approved_by || "待审批" : "无需审批"}</div>
                      <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">回滚：{item.rollback_required ? item.rollback_command || "需人工回滚" : "无需回滚"}</div>
                      <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">验证：{item.verified_by || "待验证"}</div>
                      <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">审计：{item.audit_payload?.state || item.state}</div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.state === "approval_required" ? <button onClick={() => approveAction.mutate(item.id)} disabled={approveAction.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">审批通过</button> : null}
                      {item.state === "preview" || item.state === "approved" ? <button onClick={() => applyAction.mutate(item.id)} disabled={applyAction.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">应用动作</button> : null}
                      {item.state === "applied" ? <button onClick={() => verifyAction.mutate(item.id)} disabled={verifyAction.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-green-700 disabled:opacity-50">验证通过</button> : null}
                      {(item.state === "applied" || item.state === "verified") && item.rollback_required ? <button onClick={() => rollbackAction.mutate(item.id)} disabled={rollbackAction.isPending} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 disabled:opacity-50">回滚并留证</button> : null}
                    </div>
                  </div>
                ))}
                {healActionResult?.action ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="text-sm font-semibold">最新审计载荷</p>
                    <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5">{JSON.stringify(healActionResult.action.audit_payload ?? healActionResult.action, null, 2)}</pre>
                  </div>
                ) : null}
              </div>
            </WorkbenchPanel>
          </div>
        )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="ops-center" title="AI 智能助手" initialPrompt="分析当前运维状态，建议优化自愈策略" />
      </WorkbenchShell>
    </div>
  );
}
