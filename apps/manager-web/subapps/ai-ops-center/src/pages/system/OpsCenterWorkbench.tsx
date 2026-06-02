import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Segmented } from "antd";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";
const OpsCenterAlertSourcesPanel = lazy(() => import("./ops-center/OpsCenterAlertSourcesPanel").then((m) => ({ default: m.OpsCenterAlertSourcesPanel })));
const OpsCenterRcaPanel = lazy(() => import("./ops-center/OpsCenterRcaPanel").then((m) => ({ default: m.OpsCenterRcaPanel })));
const OpsCenterRunbooksPanel = lazy(() => import("./ops-center/OpsCenterRunbooksPanel").then((m) => ({ default: m.OpsCenterRunbooksPanel })));
const OpsCenterSelfHealPanel = lazy(() => import("./ops-center/OpsCenterSelfHealPanel").then((m) => ({ default: m.OpsCenterSelfHealPanel })));

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
  const [selfHealActionDrawerOpen, setSelfHealActionDrawerOpen] = useState(false);
  const [selectedHealActionId, setSelectedHealActionId] = useState("");
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

  const selfHealActions = useMemo(() => actionsQ.data?.items ?? [], [actionsQ.data?.items]);
  const selectedHealAction = useMemo(
    () => selfHealActions.find((item: any) => String(item.id) === selectedHealActionId) ?? null,
    [selectedHealActionId, selfHealActions],
  );

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
          <Suspense fallback={<div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">加载告警源治理...</div>}>
          <OpsCenterAlertSourcesPanel
            alertSourcesQ={alertSourcesQ}
            externalAlertsQ={externalAlertsQ}
            alertNoiseQ={alertNoiseQ}
            alertNoiseHistoryQ={alertNoiseHistoryQ}
            alertStrategyQ={alertStrategyQ}
            alertStrategyCompareRunsQ={alertStrategyCompareRunsQ}
            alertSloPredictionRunsQ={alertSloPredictionRunsQ}
            alertSloEscalationPolicyQ={alertSloEscalationPolicyQ}
            alertSloEscalationRunsQ={alertSloEscalationRunsQ}
            alertStrategyCanaryAuditsQ={alertStrategyCanaryAuditsQ}
            opsStrategyLinkageRunsQ={opsStrategyLinkageRunsQ}
            alertSourceForm={alertSourceForm}
            setAlertSourceForm={setAlertSourceForm}
            alertSourceDrawerOpen={alertSourceDrawerOpen}
            setAlertSourceDrawerOpen={setAlertSourceDrawerOpen}
            alertSourceResult={alertSourceResult}
            createAlertSource={createAlertSource}
            syncAlertSources={syncAlertSources}
            testAlertSource={testAlertSource}
            toggleAlertSource={toggleAlertSource}
            deleteAlertSource={deleteAlertSource}
            alertNoisePolicyForm={alertNoisePolicyForm}
            setAlertNoisePolicyForm={setAlertNoisePolicyForm}
            alertSilenceForm={alertSilenceForm}
            setAlertSilenceForm={setAlertSilenceForm}
            alertNoiseConfigDrawer={alertNoiseConfigDrawer}
            setAlertNoiseConfigDrawer={setAlertNoiseConfigDrawer}
            alertNoiseResult={alertNoiseResult}
            createAlertNoisePolicy={createAlertNoisePolicy}
            toggleAlertNoisePolicy={toggleAlertNoisePolicy}
            deleteAlertNoisePolicy={deleteAlertNoisePolicy}
            evaluateAlertNoise={evaluateAlertNoise}
            createAlertSilence={createAlertSilence}
            toggleAlertSilence={toggleAlertSilence}
            deleteAlertSilence={deleteAlertSilence}
            alertStrategyResult={alertStrategyResult}
            generateAlertStrategy={generateAlertStrategy}
            updateAlertStrategyRecommendation={updateAlertStrategyRecommendation}
            compareAlertStrategy={compareAlertStrategy}
            latestStrategyCompare={latestStrategyCompare}
            predictAlertSlo={predictAlertSlo}
            latestSloPrediction={latestSloPrediction}
            alertSloEscalationForm={alertSloEscalationForm}
            setAlertSloEscalationForm={setAlertSloEscalationForm}
            alertSloEscalationDrawerOpen={alertSloEscalationDrawerOpen}
            setAlertSloEscalationDrawerOpen={setAlertSloEscalationDrawerOpen}
            saveAlertSloEscalationPolicy={saveAlertSloEscalationPolicy}
            runAlertSloEscalation={runAlertSloEscalation}
            latestSloEscalation={latestSloEscalation}
            alertStrategyCanaryForm={alertStrategyCanaryForm}
            setAlertStrategyCanaryForm={setAlertStrategyCanaryForm}
            alertStrategyCanaryDrawerOpen={alertStrategyCanaryDrawerOpen}
            setAlertStrategyCanaryDrawerOpen={setAlertStrategyCanaryDrawerOpen}
            runAlertStrategyCanaryAudit={runAlertStrategyCanaryAudit}
            updateAlertStrategyCanary={updateAlertStrategyCanary}
            latestStrategyCanary={latestStrategyCanary}
            opsStrategyLinkageForm={opsStrategyLinkageForm}
            setOpsStrategyLinkageForm={setOpsStrategyLinkageForm}
            opsStrategyLinkageDrawerOpen={opsStrategyLinkageDrawerOpen}
            setOpsStrategyLinkageDrawerOpen={setOpsStrategyLinkageDrawerOpen}
            runOpsStrategyLinkage={runOpsStrategyLinkage}
            latestOpsStrategyLinkage={latestOpsStrategyLinkage}
            imChannels={imChannels}
          />
          </Suspense>
        )}
        {tab === "rca" && (
          <Suspense fallback={<div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">加载 RCA 治理...</div>}>
            <OpsCenterRcaPanel
              rcaQ={rcaQ}
              rcaForm={rcaForm}
              setRcaForm={setRcaForm}
              rcaCreateDrawerOpen={rcaCreateDrawerOpen}
              setRcaCreateDrawerOpen={setRcaCreateDrawerOpen}
              createRca={createRca}
              rcaInsightFilter={rcaInsightFilter}
              setRcaInsightFilter={setRcaInsightFilter}
              rcaInsightDrawerOpen={rcaInsightDrawerOpen}
              setRcaInsightDrawerOpen={setRcaInsightDrawerOpen}
              rcaInsightResult={rcaInsightResult}
              analyzeRcaInsights={analyzeRcaInsights}
              createRcaInsightTasks={createRcaInsightTasks}
              rcaInsightTasksResult={rcaInsightTasksResult}
              createRcaFromInsight={createRcaFromInsight}
              rcaInsightCreateResult={rcaInsightCreateResult}
              rcaVerifyResult={rcaVerifyResult}
              loadRcaVerificationPlan={loadRcaVerificationPlan}
              verifyRca={verifyRca}
              resolveRca={resolveRca}
            />
          </Suspense>
        )}
        {tab === "runbooks" && (
          <Suspense fallback={<div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">加载 Runbook 治理...</div>}>
            <OpsCenterRunbooksPanel
              rbQ={rbQ}
              rbVersionsQ={rbVersionsQ}
              rbEvidenceQ={rbEvidenceQ}
              selectedRunbookId={selectedRunbookId}
              setSelectedRunbookId={setSelectedRunbookId}
              rbForm={rbForm}
              setRbForm={setRbForm}
              runbookEditorDrawerOpen={runbookEditorDrawerOpen}
              setRunbookEditorDrawerOpen={setRunbookEditorDrawerOpen}
              runbookDiffResult={runbookDiffResult}
              setRunbookDiffResult={setRunbookDiffResult}
              runbookEvidenceResult={runbookEvidenceResult}
              saveRb={saveRb}
              deleteRb={deleteRb}
              runbookVersionAction={runbookVersionAction}
              compareRunbookVersions={compareRunbookVersions}
              backfillRunbookEvidence={backfillRunbookEvidence}
              updateRunbookEvidence={updateRunbookEvidence}
            />
          </Suspense>
        )}
        {tab === "self-heal" && (
          <Suspense fallback={<div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">加载自愈治理...</div>}>
            <OpsCenterSelfHealPanel
              shQ={shQ}
              evalQ={evalQ}
              actionsQ={actionsQ}
              shForm={shForm}
              setShForm={setShForm}
              selfHealPolicyDrawerOpen={selfHealPolicyDrawerOpen}
              setSelfHealPolicyDrawerOpen={setSelfHealPolicyDrawerOpen}
              signalText={signalText}
              setSignalText={setSignalText}
              selfHealSignalDrawerOpen={selfHealSignalDrawerOpen}
              setSelfHealSignalDrawerOpen={setSelfHealSignalDrawerOpen}
              healResult={healResult}
              healTasksResult={healTasksResult}
              healActionResult={healActionResult}
              selfHealActionDrawerOpen={selfHealActionDrawerOpen}
              setSelfHealActionDrawerOpen={setSelfHealActionDrawerOpen}
              setSelectedHealActionId={setSelectedHealActionId}
              createSh={createSh}
              evaluateSh={evaluateSh}
              createHealTasks={createHealTasks}
              applySh={applySh}
              toggleSh={toggleSh}
              deleteSh={deleteSh}
              approveAction={approveAction}
              applyAction={applyAction}
              verifyAction={verifyAction}
              rollbackAction={rollbackAction}
              selfHealActions={selfHealActions}
              selectedHealAction={selectedHealAction}
            />
          </Suspense>
        )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="ops-center" title="AI 智能助手" initialPrompt="分析当前运维状态，建议优化自愈策略" />
      </WorkbenchShell>
    </div>
  );
}
