import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Drawer, Form, Input, InputNumber, Segmented, Select, Space, Steps, Switch } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

type Tab = "health" | "registry" | "negotiate" | "sessions" | "sla" | "windows" | "dispatches" | "evidence";

const TAB_KEYS: Tab[] = ["health", "registry", "negotiate", "sessions", "sla", "windows", "dispatches", "evidence"];
const AGENT_TYPES = ["workbuddy", "openclaw", "hermes_agent", "custom"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];
const RETRYABLE_DISPATCH_STATUSES = new Set(["failed", "blocked", "cancelled", "retrying"]);
const DEFAULT_REG_FORM = {
  name: "",
  agent_type: "custom",
  endpoint: "",
  organization_code: "",
  trust_domain: "",
  capabilities: "code.review, test.automation",
};
const DEFAULT_NEG_FORM = {
  task_type: "code_review",
  task_description: "Review API security and SQL access risk",
  required_capabilities: "code.review, security.audit",
  priority: "P1",
};
const DEFAULT_SLA_POLICY_FORM = {
  default_sla_minutes: 30,
  due_soon_ratio: 0.8,
  p0: 15,
  p1: 30,
  p2: 60,
  p3: 120,
  auto_retry_enabled: false,
  max_auto_retries: 1,
  im_alert_enabled: true,
};
const DEFAULT_TRUST_POLICY_FORM = {
  stale_after_minutes: 30,
  min_success_rate: 0,
  max_load: 10,
  require_endpoint: false,
  allowed_agent_types: "",
  allowed_organization_codes: "",
  required_capabilities: "",
  enforce_on_negotiate: true,
  enforce_on_dispatch: false,
  enforce_on_pull: true,
};
const DEFAULT_WINDOW_POLICY_FORM = {
  stale_after_minutes: 15,
  due_soon_seconds: 300,
  max_auto_reassign: 1,
  action_mode: "guarded",
  require_preview_for_high_risk: false,
  auto_renew_enabled: true,
  auto_reassign_enabled: true,
  auto_expire_enabled: true,
};
const A2A_ROUTE_TABS: Record<string, Tab> = {
  workbench: "health",
  health: "health",
  registry: "registry",
  negotiate: "negotiate",
  sessions: "sessions",
  sla: "sla",
  windows: "windows",
  dispatch: "dispatches",
  dispatches: "dispatches",
  evidence: "evidence",
};
const A2A_TAB_PATHS: Record<Tab, string> = {
  health: "#/ecosystem/a2a/workbench",
  registry: "#/ecosystem/a2a/registry",
  negotiate: "#/ecosystem/a2a/negotiate",
  sessions: "#/ecosystem/a2a/negotiate?tab=sessions",
  sla: "#/ecosystem/a2a/sla",
  windows: "#/ecosystem/a2a/windows",
  dispatches: "#/ecosystem/a2a/dispatch",
  evidence: "#/ecosystem/a2a/evidence",
};
const A2A_TAB_META: Record<Tab, { titleKey: string; descriptionKey: string; focusKey: string }> = {
  health: {
    titleKey: "page.a2aGateway.tabs.health.title",
    descriptionKey: "page.a2aGateway.tabs.health.description",
    focusKey: "page.a2aGateway.tabs.health.focus",
  },
  registry: {
    titleKey: "page.a2aGateway.tabs.registry.title",
    descriptionKey: "page.a2aGateway.tabs.registry.description",
    focusKey: "page.a2aGateway.tabs.registry.focus",
  },
  negotiate: {
    titleKey: "page.a2aGateway.tabs.negotiate.title",
    descriptionKey: "page.a2aGateway.tabs.negotiate.description",
    focusKey: "page.a2aGateway.tabs.negotiate.focus",
  },
  sessions: {
    titleKey: "page.a2aGateway.tabs.sessions.title",
    descriptionKey: "page.a2aGateway.tabs.sessions.description",
    focusKey: "page.a2aGateway.tabs.sessions.focus",
  },
  sla: {
    titleKey: "page.a2aGateway.tabs.sla.title",
    descriptionKey: "page.a2aGateway.tabs.sla.description",
    focusKey: "page.a2aGateway.tabs.sla.focus",
  },
  windows: {
    titleKey: "page.a2aGateway.tabs.windows.title",
    descriptionKey: "page.a2aGateway.tabs.windows.description",
    focusKey: "page.a2aGateway.tabs.windows.focus",
  },
  dispatches: {
    titleKey: "page.a2aGateway.tabs.dispatches.title",
    descriptionKey: "page.a2aGateway.tabs.dispatches.description",
    focusKey: "page.a2aGateway.tabs.dispatches.focus",
  },
  evidence: {
    titleKey: "page.a2aGateway.tabs.evidence.title",
    descriptionKey: "page.a2aGateway.tabs.evidence.description",
    focusKey: "page.a2aGateway.tabs.evidence.focus",
  },
};

function tabFromHash(fallback: Tab): Tab {
  const hash = window.location.hash || A2A_TAB_PATHS[fallback];
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const queryTab = new URLSearchParams(query).get("tab") || "";
  if (A2A_ROUTE_TABS[queryTab]) return A2A_ROUTE_TABS[queryTab];
  const [, routeTab] = hash.match(/^#\/ecosystem\/a2a\/([^/?#]+)/) || [];
  return A2A_ROUTE_TABS[routeTab] || fallback;
}

function splitList(value: string) {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function badgeClass(level: string) {
  if (level === "critical" || level === "high") return "bg-red-50 text-red-700 ring-red-100";
  if (level === "medium") return "bg-amber-50 text-amber-700 ring-amber-100";
  if (level === "low") return "bg-slate-100 text-slate-600 ring-slate-200";
  return "bg-emerald-50 text-emerald-700 ring-emerald-100";
}

export function A2aWorkbench({ focused = false, initialTab = "health" }: { focused?: boolean; initialTab?: Tab }) {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [registerForm] = Form.useForm();
  const [negotiateForm] = Form.useForm();
  const [trustPolicyAntForm] = Form.useForm();
  const [slaPolicyAntForm] = Form.useForm();
  const [windowPolicyAntForm] = Form.useForm();
  const [tab, setTab] = useState<Tab>(() => tabFromHash(initialTab));
  const [showForm, setShowForm] = useState(false);
  const [showNegotiateDrawer, setShowNegotiateDrawer] = useState(false);
  const [showTrustPolicyDrawer, setShowTrustPolicyDrawer] = useState(false);
  const [showSlaPolicyDrawer, setShowSlaPolicyDrawer] = useState(false);
  const [showWindowPolicyDrawer, setShowWindowPolicyDrawer] = useState(false);
  const [regForm, setRegForm] = useState(DEFAULT_REG_FORM);
  const [negForm, setNegForm] = useState(DEFAULT_NEG_FORM);
  const [negResult, setNegResult] = useState<any>(null);
  const [credentialResult, setCredentialResult] = useState<any>(null);
  const [heartbeatTokens, setHeartbeatTokens] = useState<Record<string, string>>({});
  const [heartbeatResult, setHeartbeatResult] = useState<any>(null);
  const [trustTaskResult, setTrustTaskResult] = useState<any>(null);
  const [pullResult, setPullResult] = useState<any>(null);
  const [ackResult, setAckResult] = useState<any>(null);
  const [leaseResult, setLeaseResult] = useState<any>(null);
  const [reassignResult, setReassignResult] = useState<any>(null);
  const [progressResult, setProgressResult] = useState<any>(null);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [packetPreview, setPacketPreview] = useState<any>(null);
  const [taskResult, setTaskResult] = useState<any>(null);
  const [slaTaskResult, setSlaTaskResult] = useState<any>(null);
  const [windowTaskResult, setWindowTaskResult] = useState<any>(null);
  const [windowActionResult, setWindowActionResult] = useState<any>(null);
  const [slaEscalationResult, setSlaEscalationResult] = useState<any>(null);
  const [slaPolicyForm, setSlaPolicyForm] = useState(DEFAULT_SLA_POLICY_FORM);
  const [trustPolicyForm, setTrustPolicyForm] = useState(DEFAULT_TRUST_POLICY_FORM);
  const [windowPolicyForm, setWindowPolicyForm] = useState(DEFAULT_WINDOW_POLICY_FORM);
  const [imResult, setImResult] = useState<any>(null);
  const [imChannels, setImChannels] = useState<string[]>([]);

  const healthQ = useQuery({ queryKey: ["a2aHealth"], queryFn: api.a2aHealth, enabled: authed });
  const registryQ = useQuery({ queryKey: ["a2aRegistry"], queryFn: () => api.a2aRegistry(), enabled: authed });
  const trustQ = useQuery({ queryKey: ["a2aTrust"], queryFn: api.a2aTrust, enabled: authed && (tab === "health" || tab === "registry") });
  const trustPolicyQ = useQuery({ queryKey: ["a2aTrustPolicy"], queryFn: api.a2aTrustPolicy, enabled: authed && tab === "registry" });
  const dispatchQ = useQuery({ queryKey: ["a2aDispatches"], queryFn: () => api.a2aDispatches(), enabled: authed && (tab === "dispatches" || tab === "evidence") });
  const evidenceQ = useQuery({ queryKey: ["a2aEvidence"], queryFn: () => api.a2aEvidence(), enabled: authed && tab === "evidence" });
  const sessionsQ = useQuery({ queryKey: ["a2aSessions"], queryFn: api.a2aSessions, enabled: authed && (tab === "sessions" || tab === "negotiate") });
  const slaQ = useQuery({ queryKey: ["a2aSla"], queryFn: api.a2aSla, enabled: authed && (tab === "health" || tab === "sla" || tab === "dispatches") });
  const windowsQ = useQuery({ queryKey: ["a2aExecutionWindows"], queryFn: api.a2aExecutionWindows, enabled: authed && (tab === "health" || tab === "windows") });
  const slaPolicyQ = useQuery({ queryKey: ["a2aSlaPolicy"], queryFn: api.a2aSlaPolicy, enabled: authed && tab === "sla" });
  const windowPolicyQ = useQuery({ queryKey: ["a2aExecutionWindowPolicy"], queryFn: api.a2aExecutionWindowPolicy, enabled: authed && tab === "windows" });
  const selectedSessionQ = useQuery({
    queryKey: ["a2aSession", selectedSessionId],
    queryFn: () => api.a2aSession(selectedSessionId),
    enabled: authed && Boolean(selectedSessionId),
  });
  const channelsQ = useQuery({ queryKey: ["notifyChannels"], queryFn: api.notifyChannels, enabled: authed });

  const summary = healthQ.data?.summary ?? {};
  const agents = registryQ.data?.items ?? [];
  const risks = summary.risks ?? [];
  const topCapabilities = summary.capability_coverage?.top_capabilities ?? [];
  const activeMetaDef = A2A_TAB_META[tab];
  const activeMeta = {
    title: t(activeMetaDef.titleKey),
    description: t(activeMetaDef.descriptionKey),
    focus: t(activeMetaDef.focusKey),
  };
  const showGlobalMetrics = !focused || tab === "health";
  const enabledChannels = useMemo(() => (channelsQ.data ?? []).filter((ch: any) => ch.enabled), [channelsQ.data]);
  const switchTab = (next: Tab, updateHash = true) => {
    setTab(next);
    if (updateHash && window.location.hash !== A2A_TAB_PATHS[next]) window.location.hash = A2A_TAB_PATHS[next];
  };
  const tabOptions = useMemo(() => TAB_KEYS.map((key) => ({
    label: key === "registry" ? `${t("page.a2aGateway.tabLabels.registry")} (${agents.length})` : t(`page.a2aGateway.tabLabels.${key}`),
    value: key,
  })), [agents.length, t]);

  useEffect(() => {
    const sync = () => switchTab(tabFromHash(initialTab), false);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [initialTab]);

  useEffect(() => {
    const policy = slaPolicyQ.data;
    if (!policy) return;
    const next = {
      default_sla_minutes: Number(policy.default_sla_minutes ?? 30),
      due_soon_ratio: Number(policy.due_soon_ratio ?? 0.8),
      p0: Number(policy.priority_sla_minutes?.P0 ?? 15),
      p1: Number(policy.priority_sla_minutes?.P1 ?? 30),
      p2: Number(policy.priority_sla_minutes?.P2 ?? 60),
      p3: Number(policy.priority_sla_minutes?.P3 ?? 120),
      auto_retry_enabled: Boolean(policy.auto_retry_enabled),
      max_auto_retries: Number(policy.max_auto_retries ?? 1),
      im_alert_enabled: Boolean(policy.im_alert_enabled ?? true),
    };
    setSlaPolicyForm(next);
    slaPolicyAntForm.setFieldsValue(next);
  }, [slaPolicyAntForm, slaPolicyQ.data]);

  useEffect(() => {
    const policy = trustPolicyQ.data;
    if (!policy) return;
    const next = {
      stale_after_minutes: Number(policy.stale_after_minutes ?? 30),
      min_success_rate: Number(policy.min_success_rate ?? 0),
      max_load: Number(policy.max_load ?? 10),
      require_endpoint: Boolean(policy.require_endpoint),
      allowed_agent_types: (policy.allowed_agent_types ?? []).join(", "),
      allowed_organization_codes: (policy.allowed_organization_codes ?? []).join(", "),
      required_capabilities: (policy.required_capabilities ?? []).join(", "),
      enforce_on_negotiate: Boolean(policy.enforce_on_negotiate ?? true),
      enforce_on_dispatch: Boolean(policy.enforce_on_dispatch),
      enforce_on_pull: Boolean(policy.enforce_on_pull ?? true),
    };
    setTrustPolicyForm(next);
    trustPolicyAntForm.setFieldsValue(next);
  }, [trustPolicyAntForm, trustPolicyQ.data]);

  useEffect(() => {
    const policy = windowPolicyQ.data;
    if (!policy) return;
    const next = {
      stale_after_minutes: Number(policy.stale_after_minutes ?? 15),
      due_soon_seconds: Number(policy.due_soon_seconds ?? 300),
      max_auto_reassign: Number(policy.max_auto_reassign ?? 1),
      action_mode: String(policy.action_mode ?? "guarded"),
      require_preview_for_high_risk: Boolean(policy.require_preview_for_high_risk),
      auto_renew_enabled: Boolean(policy.auto_renew_enabled ?? true),
      auto_reassign_enabled: Boolean(policy.auto_reassign_enabled ?? true),
      auto_expire_enabled: Boolean(policy.auto_expire_enabled ?? true),
    };
    setWindowPolicyForm(next);
    windowPolicyAntForm.setFieldsValue(next);
  }, [windowPolicyAntForm, windowPolicyQ.data]);

  const agentById = useMemo(() => {
    const map = new Map<string, any>();
    agents.forEach((agent: any) => map.set(agent.id, agent));
    return map;
  }, [agents]);
  const trustById = useMemo(() => {
    const map = new Map<string, any>();
    (trustQ.data?.items ?? []).forEach((agent: any) => map.set(agent.id, agent));
    return map;
  }, [trustQ.data]);

  const register = useMutation({
    mutationFn: (draft: typeof DEFAULT_REG_FORM = regForm) => api.a2aRegister({
      ...draft,
      capabilities: splitList(draft.capabilities),
    }),
    onSuccess: (data) => {
      setCredentialResult(data);
      if (data.credential_token) {
        setHeartbeatTokens((prev) => ({ ...prev, [data.id]: data.credential_token }));
      }
      void qc.invalidateQueries({ queryKey: ["a2aRegistry"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
      void qc.invalidateQueries({ queryKey: ["a2aTrust"] });
      setShowForm(false);
      setRegForm(DEFAULT_REG_FORM);
      registerForm.resetFields();
    },
  });
  const updateTrustPolicy = useMutation({
    mutationFn: (draft: typeof DEFAULT_TRUST_POLICY_FORM = trustPolicyForm) => api.a2aTrustPolicyUpdate({
      stale_after_minutes: Number(draft.stale_after_minutes),
      min_success_rate: Number(draft.min_success_rate),
      max_load: Number(draft.max_load),
      require_endpoint: draft.require_endpoint,
      allowed_agent_types: splitList(draft.allowed_agent_types),
      allowed_organization_codes: splitList(draft.allowed_organization_codes),
      required_capabilities: splitList(draft.required_capabilities),
      enforce_on_negotiate: draft.enforce_on_negotiate,
      enforce_on_dispatch: draft.enforce_on_dispatch,
      enforce_on_pull: draft.enforce_on_pull,
    }),
    onSuccess: (_, draft = trustPolicyForm) => {
      setTrustPolicyForm(draft);
      setShowTrustPolicyDrawer(false);
      void qc.invalidateQueries({ queryKey: ["a2aTrustPolicy"] });
      void qc.invalidateQueries({ queryKey: ["a2aTrust"] });
    },
  });
  const trustTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.a2aTrustTasks({ dry_run: dryRun, assigned_to: "Agent Platform", dev_tool: "codex" }),
    onSuccess: (data, dryRun) => {
      setTrustTaskResult(data);
      if (!dryRun) void qc.invalidateQueries({ queryKey: ["a2aTrust"] });
    },
  });
  const deregister = useMutation({
    mutationFn: (id: string) => api.a2aDeregister(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["a2aRegistry"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
      void qc.invalidateQueries({ queryKey: ["a2aTrust"] });
    },
  });
  const pauseAgent = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.a2aAgentStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["a2aRegistry"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
      void qc.invalidateQueries({ queryKey: ["a2aTrust"] });
    },
  });
  const rotateCredential = useMutation({
    mutationFn: (id: string) => api.a2aRotateCredential(id),
    onSuccess: (data) => {
      setCredentialResult(data);
      if (data.credential_token) {
        setHeartbeatTokens((prev) => ({ ...prev, [data.id]: data.credential_token }));
      }
      void qc.invalidateQueries({ queryKey: ["a2aRegistry"] });
      void qc.invalidateQueries({ queryKey: ["a2aTrust"] });
    },
  });
  const heartbeat = useMutation({
    mutationFn: (agent: any) => api.a2aHeartbeat(agent.id, {
      credential_token: heartbeatTokens[agent.id] ?? "",
      status: "active",
      load: Number(agent.load ?? 0),
      success_rate: Number(agent.success_rate ?? 0.8),
      capabilities: agent.capabilities ?? [],
      telemetry: { source: "manager-web", checked_at: new Date().toISOString() },
    }),
    onSuccess: (data) => {
      setHeartbeatResult(data);
      void qc.invalidateQueries({ queryKey: ["a2aRegistry"] });
      void qc.invalidateQueries({ queryKey: ["a2aTrust"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
    },
  });
  const pullTasks = useMutation({
    mutationFn: (agent: any) => api.a2aPullTasks(agent.id, {
      credential_token: heartbeatTokens[agent.id] ?? "",
      limit: 5,
      capabilities: agent.capabilities ?? [],
      lease_seconds: 300,
      wait_seconds: 0,
    }),
    onSuccess: (data) => {
      setPullResult(data);
      void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
      void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
      void qc.invalidateQueries({ queryKey: ["a2aSla"] });
      void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
    },
  });
  const ackTask = useMutation({
    mutationFn: ({ agent, task, ack = "accepted" }: { agent: any; task: any; ack?: "accepted" | "rejected" }) => api.a2aAckTask(agent.id, {
      credential_token: heartbeatTokens[agent.id] ?? "",
      dispatch_id: task.dispatch_id,
      lease_id: task.lease_id,
      ack,
      message: ack === "accepted" ? "manager-web accepted lease" : "manager-web rejected lease",
    }),
    onSuccess: (data) => {
      setAckResult(data);
      void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
      void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
      void qc.invalidateQueries({ queryKey: ["a2aSla"] });
      void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
    },
  });
  const renewLease = useMutation({
    mutationFn: ({ agent, task }: { agent: any; task: any }) => api.a2aRenewLease(agent.id, {
      credential_token: heartbeatTokens[agent.id] ?? "",
      dispatch_id: task.dispatch_id,
      lease_id: task.lease_id,
      extend_seconds: 300,
    }),
    onSuccess: (data) => {
      setLeaseResult(data);
      void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
      void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
      void qc.invalidateQueries({ queryKey: ["a2aSla"] });
      void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
    },
  });
  const expireLeases = useMutation({
    mutationFn: api.a2aExpireLeases,
    onSuccess: (data) => {
      setLeaseResult(data);
      void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
      void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
      void qc.invalidateQueries({ queryKey: ["a2aSla"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
      void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
    },
  });
  const reportProgress = useMutation({
    mutationFn: ({ agent, task }: { agent: any; task: any }) => api.a2aProgress(agent.id, {
      credential_token: heartbeatTokens[agent.id] ?? "",
      dispatch_id: task.dispatch_id,
      status: "running",
      progress: 50,
      message: "manager-web progress smoke",
      artifact: { source: "manager-web", task_id: task.task_id },
    }),
    onSuccess: (data) => {
      setProgressResult(data);
      void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
      void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
      void qc.invalidateQueries({ queryKey: ["a2aSla"] });
      void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
    },
  });
  const negotiate = useMutation({
    mutationFn: (draft: typeof DEFAULT_NEG_FORM = negForm) => api.a2aNegotiate({
      task_type: draft.task_type,
      task_description: draft.task_description,
      required_capabilities: splitList(draft.required_capabilities),
      priority: draft.priority,
    }),
    onSuccess: (data, draft = negForm) => {
      setNegForm(draft);
      setNegResult(data);
      setSelectedSessionId(data.session_id ?? "");
      setShowNegotiateDrawer(false);
      void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
    },
  });
  const dispatch = useMutation({
    mutationFn: (agentId: string) => api.a2aDispatch({
      agent_id: agentId,
      task_id: `manual-${Date.now()}`,
      session_id: negResult?.session_id ?? "",
      payload: {
        source: "manager-web",
        session_id: negResult?.session_id ?? "",
        task_type: negForm.task_type,
        task_description: negForm.task_description,
        required_capabilities: splitList(negForm.required_capabilities),
        priority: negForm.priority,
        sla_minutes: negForm.priority === "P0" ? 15 : negForm.priority === "P1" ? 30 : 60,
      },
    }),
    onSuccess: (data) => {
      setPacketPreview(data.protocol_packet ?? null);
      void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
      void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
      void qc.invalidateQueries({ queryKey: ["a2aSla"] });
      void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
      if (data.session_id) {
        setSelectedSessionId(data.session_id);
        void qc.invalidateQueries({ queryKey: ["a2aSession", data.session_id] });
      }
      switchTab("dispatches");
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
      void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
      void qc.invalidateQueries({ queryKey: ["a2aSla"] });
      void qc.invalidateQueries({ queryKey: ["a2aSession"] });
      void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
    },
  });
  const previewPacket = useMutation({
    mutationFn: (dispatchId: string) => api.a2aDispatchPacket(dispatchId),
    onSuccess: (data) => setPacketPreview(data.packet),
  });
  const retryDispatch = useMutation({
    mutationFn: (dispatchId: string) => api.a2aRetryDispatch(dispatchId),
    onSuccess: (data) => {
      setPacketPreview(data.protocol_packet ?? null);
      void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
      void qc.invalidateQueries({ queryKey: ["a2aEvidence"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
      void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
      void qc.invalidateQueries({ queryKey: ["a2aSla"] });
      void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
      if (data.session_id) {
        setSelectedSessionId(data.session_id);
        void qc.invalidateQueries({ queryKey: ["a2aSession", data.session_id] });
      }
    },
  });
  const reassignDispatch = useMutation({
    mutationFn: ({ dispatchId, agentId }: { dispatchId: string; agentId: string }) => api.a2aReassignDispatch(dispatchId, {
      agent_id: agentId,
      reason: "manager-web fallback reassign",
    }),
    onSuccess: (data) => {
      setReassignResult(data);
      setPacketPreview(data.protocol_packet ?? null);
      void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
      void qc.invalidateQueries({ queryKey: ["a2aEvidence"] });
      void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
      void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
      void qc.invalidateQueries({ queryKey: ["a2aSla"] });
      void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
    },
  });
  const governanceTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.a2aGovernanceTasks({ dry_run: dryRun, assigned_to: "Agent Platform", dev_tool: "codex" }),
    onSuccess: (data) => {
      setTaskResult(data);
      if (!data.dry_run) void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
    },
  });
  const slaTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.a2aSlaTasks({ dry_run: dryRun, assigned_to: "Agent Platform", dev_tool: "codex" }),
    onSuccess: (data, dryRun) => {
      setSlaTaskResult(data);
      if (!dryRun) void qc.invalidateQueries({ queryKey: ["a2aSla"] });
    },
  });
  const windowTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.a2aExecutionWindowTasks({ dry_run: dryRun, assigned_to: "Agent Platform", dev_tool: "codex" }),
    onSuccess: (data, dryRun) => {
      setWindowTaskResult(data);
      if (!dryRun) {
        void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
        void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
      }
    },
  });
  const windowActions = useMutation({
    mutationFn: (dryRun: boolean) => api.a2aExecutionWindowActions({ dry_run: dryRun, renew_seconds: 300, max_actions: 20 }),
    onSuccess: (data, dryRun) => {
      setWindowActionResult(data);
      if (!dryRun) {
        void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
        void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
        void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
        void qc.invalidateQueries({ queryKey: ["a2aHealth"] });
      }
    },
  });
  const updateWindowPolicy = useMutation({
    mutationFn: (draft: typeof DEFAULT_WINDOW_POLICY_FORM = windowPolicyForm) => api.a2aExecutionWindowPolicyUpdate({
      stale_after_minutes: Number(draft.stale_after_minutes),
      due_soon_seconds: Number(draft.due_soon_seconds),
      max_auto_reassign: Number(draft.max_auto_reassign),
      action_mode: draft.action_mode,
      require_preview_for_high_risk: draft.require_preview_for_high_risk,
      auto_renew_enabled: draft.auto_renew_enabled,
      auto_reassign_enabled: draft.auto_reassign_enabled,
      auto_expire_enabled: draft.auto_expire_enabled,
    }),
    onSuccess: (_, draft = windowPolicyForm) => {
      setWindowPolicyForm(draft);
      setShowWindowPolicyDrawer(false);
      void qc.invalidateQueries({ queryKey: ["a2aExecutionWindowPolicy"] });
      void qc.invalidateQueries({ queryKey: ["a2aExecutionWindows"] });
    },
  });
  const updateSlaPolicy = useMutation({
    mutationFn: (draft: typeof DEFAULT_SLA_POLICY_FORM = slaPolicyForm) => api.a2aSlaPolicyUpdate({
      default_sla_minutes: Number(draft.default_sla_minutes),
      due_soon_ratio: Number(draft.due_soon_ratio),
      priority_sla_minutes: {
        P0: Number(draft.p0),
        P1: Number(draft.p1),
        P2: Number(draft.p2),
        P3: Number(draft.p3),
      },
      auto_retry_enabled: draft.auto_retry_enabled,
      max_auto_retries: Number(draft.max_auto_retries),
      im_alert_enabled: draft.im_alert_enabled,
    }),
    onSuccess: (_, draft = slaPolicyForm) => {
      setSlaPolicyForm(draft);
      setShowSlaPolicyDrawer(false);
      void qc.invalidateQueries({ queryKey: ["a2aSlaPolicy"] });
      void qc.invalidateQueries({ queryKey: ["a2aSla"] });
    },
  });
  const slaEscalations = useMutation({
    mutationFn: (dryRun: boolean) => api.a2aSlaEscalations({ dry_run: dryRun, channels: imChannels }),
    onSuccess: (data, dryRun) => {
      setSlaEscalationResult(data);
      if (!dryRun) {
        void qc.invalidateQueries({ queryKey: ["a2aSla"] });
        void qc.invalidateQueries({ queryKey: ["a2aDispatches"] });
        void qc.invalidateQueries({ queryKey: ["a2aSessions"] });
      }
    },
  });
  const imBriefing = useMutation({
    mutationFn: (dryRun: boolean) => api.a2aImBriefing({ dry_run: dryRun, channels: imChannels }),
    onSuccess: (data, dryRun) => {
      setImResult(data);
      if (!dryRun) {
        void qc.invalidateQueries({ queryKey: ["notifyMessages"] });
        void qc.invalidateQueries({ queryKey: ["notifySummary"] });
      }
    },
  });

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={focused ? activeMeta.title : t("page.a2aGateway.workbenchTitle")}
        description={focused ? activeMeta.description : t("page.a2aGateway.workbenchDesc")}
        actions={<><AiAssistButton onClick={() => setAiOpen(true)} />
          <RefreshButton onClick={() => { void registryQ.refetch(); void healthQ.refetch(); void trustQ.refetch(); void trustPolicyQ.refetch(); void dispatchQ.refetch(); void slaQ.refetch(); void windowsQ.refetch(); void windowPolicyQ.refetch(); }} pending={registryQ.isFetching || healthQ.isFetching || trustQ.isFetching || trustPolicyQ.isFetching || slaQ.isFetching || windowsQ.isFetching || windowPolicyQ.isFetching} /></>}
        metrics={showGlobalMetrics ? (
          <WorkbenchStats items={[
            { label: t("page.a2aGateway.metricHealth"), value: summary.health_score ?? 0, trend: (summary.health_score ?? 0) >= 80 ? "up" : "down" },
            { label: t("page.a2aGateway.metricRegistered"), value: summary.registered_agents ?? 0 },
            { label: t("page.a2aGateway.metricTrusted"), value: trustQ.data?.summary?.trusted_agents ?? 0, trend: "up" },
            { label: t("page.a2aGateway.metricSlaOverdue"), value: slaQ.data?.summary?.overdue ?? 0, trend: (slaQ.data?.summary?.overdue ?? 0) > 0 ? "down" : "up" },
            { label: t("page.a2aGateway.metricWindowRisk"), value: (windowsQ.data?.summary?.expired_leases ?? 0) + (windowsQ.data?.summary?.stale_progress ?? 0) + (windowsQ.data?.summary?.blocked ?? 0), trend: ((windowsQ.data?.summary?.expired_leases ?? 0) + (windowsQ.data?.summary?.stale_progress ?? 0) + (windowsQ.data?.summary?.blocked ?? 0)) > 0 ? "down" : "up" },
          ]} />
        ) : undefined}
      />

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
        {focused ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.a2aGateway.focusedTag")}</span>
              <span className="text-xs font-medium text-[var(--text)]">{activeMeta.focus}</span>
              <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.a2aGateway.focusedHint")}</span>
            </div>
            <a href="#/ecosystem/a2a" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.a2aGateway.backToHub")}</a>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Segmented
              className="min-w-max"
              options={tabOptions}
              value={tab}
              onChange={(value) => switchTab(value as Tab)}
            />
          </div>
        )}
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
              <p className="text-sm font-semibold">A2A 运行风险会自动生成企业 IM 卡片</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">卡片包含协议健康分、待证据回写、风险建议和治理任务 API，可投递到已启用的企业微信、钉钉、Slack 或 Webhook 通道。</p>
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
                <p className="mt-2 text-[11px] text-[var(--muted)]">{imChannels.length ? `手动选择 ${imChannels.length} 个通道` : "未选择时按 a2a_risk 事件自动匹配通道。"}</p>
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
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">{imResult?.briefing?.content ?? "点击预览后展示 A2A 协议运行简报内容。"}</pre>
            </div>
          </div>
        </WorkbenchPanel>

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
        </div>
      )}

      {tab === "registry" && (
        <WorkbenchPanel title="已注册 Agent" actions={
          <Button type="primary" onClick={() => setShowForm(true)}>注册 Agent</Button>
        }>
          <div className="mb-4 grid gap-3 sm:grid-cols-5">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-xs text-[var(--muted)]">可信 Agent</div>
              <div className="mt-1 text-2xl font-semibold">{trustQ.data?.summary?.trusted_agents ?? 0}</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-xs text-[var(--muted)]">策略准入</div>
              <div className="mt-1 text-2xl font-semibold">{trustQ.data?.summary?.policy_allowed_agents ?? 0}</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-xs text-[var(--muted)]">心跳新鲜</div>
              <div className="mt-1 text-2xl font-semibold">{trustQ.data?.summary?.fresh_agents ?? 0}</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-xs text-[var(--muted)]">掉线 Agent</div>
              <div className="mt-1 text-2xl font-semibold">{trustQ.data?.summary?.stale_agents ?? 0}</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-xs text-[var(--muted)]">信任健康</div>
              <div className="mt-1 text-2xl font-semibold">{trustQ.data?.summary?.health_score ?? 100}</div>
            </div>
          </div>
          <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">跨组织信任策略</p>
                <p className="mt-1 text-xs text-[var(--muted)]">准入 {trustQ.data?.summary?.policy_allowed_agents ?? 0} 个 · 阻断 {trustQ.data?.summary?.policy_blocked_agents ?? 0} 个 · 心跳阈值 {trustQ.data?.policy?.stale_after_minutes ?? trustPolicyForm.stale_after_minutes} 分钟</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => trustTasks.mutate(true)} disabled={trustTasks.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览治理任务</button>
                <button onClick={() => trustTasks.mutate(false)} disabled={trustTasks.isPending} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">生成治理任务</button>
                <Button
                  size="small"
                  loading={updateTrustPolicy.isPending}
                  onClick={() => {
                    trustPolicyAntForm.setFieldsValue(trustPolicyForm);
                    setShowTrustPolicyDrawer(true);
                  }}
                >
                  编辑策略
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[var(--muted)]">最低成功率 {Math.round(Number(trustPolicyForm.min_success_rate) * 100)}%</span>
              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[var(--muted)]">最大负载 {trustPolicyForm.max_load}</span>
              <span className={`rounded-full px-2 py-1 ${trustPolicyForm.require_endpoint ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>Endpoint {trustPolicyForm.require_endpoint ? "必填" : "可选"}</span>
              <span className={`rounded-full px-2 py-1 ${trustPolicyForm.enforce_on_negotiate ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>协商过滤 {trustPolicyForm.enforce_on_negotiate ? "开启" : "关闭"}</span>
              <span className={`rounded-full px-2 py-1 ${trustPolicyForm.enforce_on_pull ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>拉取阻断 {trustPolicyForm.enforce_on_pull ? "开启" : "关闭"}</span>
              <span className={`rounded-full px-2 py-1 ${trustPolicyForm.enforce_on_dispatch ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>分发阻断 {trustPolicyForm.enforce_on_dispatch ? "开启" : "关闭"}</span>
              {splitList(trustPolicyForm.allowed_agent_types).map((item) => <span key={`type-${item}`} className="rounded-full bg-[var(--brand-soft)] px-2 py-1 text-[var(--brand)]">类型 {item}</span>)}
              {splitList(trustPolicyForm.required_capabilities).map((item) => <span key={`cap-${item}`} className="rounded-full bg-[var(--brand-soft)] px-2 py-1 text-[var(--brand)]">能力 {item}</span>)}
            </div>
            {trustTaskResult ? (
              <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
                {trustTaskResult.dry_run ? "治理任务预览" : "治理任务已生成"} · {trustTaskResult.items?.length ?? 0} 条
              </div>
            ) : null}
          </div>
          {credentialResult?.credential_token ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-semibold">一次性凭证已签发：{credentialResult.name}</p>
              <p className="mt-1 break-all font-mono text-xs">{credentialResult.credential_token}</p>
            </div>
          ) : null}
          {heartbeatResult ? (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              心跳已更新：{heartbeatResult.name} · {heartbeatResult.heartbeat_count ?? 0} 次
            </div>
          ) : null}
          {pullResult ? (
            <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  任务拉取结果：{pullResult.total ?? 0} 条
                  {pullResult.long_poll ? <span className="ml-2 text-xs font-normal text-[var(--muted)]">等待 {pullResult.waited_seconds ?? 0}/{pullResult.wait_seconds ?? 0}s</span> : null}
                </p>
                <button
                  onClick={() => expireLeases.mutate()}
                  disabled={expireLeases.isPending}
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--brand)] hover:border-[var(--brand)] disabled:opacity-50"
                >
                  回收过期租约
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {(pullResult.items ?? []).map((task: any) => (
                  <div key={task.dispatch_id} className="rounded-md bg-[var(--surface-muted)] px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span><b>{task.task_id}</b> · {task.status} · {String(task.dispatch_id).slice(0, 12)}</span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => {
                            const agent = agents.find((item: any) => item.id === pullResult.agent_id);
                            if (agent) ackTask.mutate({ agent, task, ack: "accepted" });
                          }}
                          disabled={!task.lease_id || task.ack_status === "accepted" || ackTask.isPending}
                          className="text-[var(--brand)] hover:underline disabled:opacity-50"
                        >
                          确认任务
                        </button>
                        <button
                          onClick={() => {
                            const agent = agents.find((item: any) => item.id === pullResult.agent_id);
                            if (agent) renewLease.mutate({ agent, task });
                          }}
                          disabled={!task.lease_id || task.ack_status === "rejected" || renewLease.isPending}
                          className="text-[var(--brand)] hover:underline disabled:opacity-50"
                        >
                          续租 5 分钟
                        </button>
                        <button
                          onClick={() => {
                            const agent = agents.find((item: any) => item.id === pullResult.agent_id);
                            if (agent) ackTask.mutate({ agent, task, ack: "rejected" });
                          }}
                          disabled={!task.lease_id || task.ack_status === "accepted" || ackTask.isPending}
                          className="text-red-600 hover:underline disabled:opacity-50"
                        >
                          拒绝
                        </button>
                        <button
                          onClick={() => {
                            const agent = agents.find((item: any) => item.id === pullResult.agent_id);
                            if (agent) reportProgress.mutate({ agent, task });
                          }}
                          disabled={reportProgress.isPending}
                          className="text-[var(--brand)] hover:underline disabled:opacity-50"
                        >
                          上报 50% 进度
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 grid gap-1 text-[11px] text-[var(--muted)] sm:grid-cols-3">
                      <span>确认：{task.ack_status || "-"}</span>
                      <span className="break-all">租约：{task.lease_id || "-"}</span>
                      <span>到期：{task.lease_expires_at ? String(task.lease_expires_at).slice(0, 19).replace("T", " ") : "-"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {ackResult ? (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              任务已确认：{ackResult.dispatch_id} · {ackResult.ack_status} · {ackResult.status}
            </div>
          ) : null}
          {leaseResult ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {typeof leaseResult.expired === "number" ? `已回收过期租约：${leaseResult.expired} 个` : `租约已续期：${leaseResult.dispatch_id} · ${leaseResult.renew_count ?? 0} 次`}
            </div>
          ) : null}
          {progressResult ? (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              进度已回写：{progressResult.dispatch_id} · {progressResult.progress?.progress ?? 0}%
            </div>
          ) : null}
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
                <div className="mt-3 grid gap-2 rounded-lg bg-[var(--surface-muted)] p-2 text-xs text-[var(--muted)]">
                  <span>凭证：{agent.credential_status === "trusted" ? "可信" : "缺失"}</span>
                  <span>心跳：{trustById.get(agent.id)?.heartbeat_status ?? "unknown"}{typeof trustById.get(agent.id)?.heartbeat_lag_minutes === "number" ? ` · ${trustById.get(agent.id)?.heartbeat_lag_minutes} 分钟` : ""}</span>
                  <span>策略：{trustById.get(agent.id)?.trust_decision?.decision ?? "unknown"}{(trustById.get(agent.id)?.trust_decision?.matched_rules ?? []).length ? ` · ${(trustById.get(agent.id)?.trust_decision?.matched_rules ?? []).join(", ")}` : ""}</span>
                  <span>组织：{agent.organization_code || "-"} / {agent.trust_domain || "-"}</span>
                  <span>次数：{agent.heartbeat_count ?? 0}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(agent.capabilities ?? []).slice(0, 6).map((capability: string) => (
                    <span key={capability} className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-xs text-[var(--brand)]">{capability}</span>
                  ))}
                </div>
                <input
                  type="password"
                  className="input-base mt-3 w-full text-xs"
                  placeholder="Agent 凭证 token"
                  value={heartbeatTokens[agent.id] ?? ""}
                  onChange={(event) => setHeartbeatTokens((prev) => ({ ...prev, [agent.id]: event.target.value }))}
                />
                <div className="mt-3 flex gap-2">
                  <button onClick={() => pauseAgent.mutate({ id: agent.id, status: agent.status === "active" ? "paused" : "active" })} className="text-xs text-[var(--brand)] hover:underline">{agent.status === "active" ? "暂停" : "启用"}</button>
                  <button onClick={() => heartbeat.mutate(agent)} disabled={!heartbeatTokens[agent.id] || heartbeat.isPending} className="text-xs text-[var(--brand)] hover:underline disabled:opacity-50">心跳</button>
                  <button onClick={() => pullTasks.mutate(agent)} disabled={!heartbeatTokens[agent.id] || pullTasks.isPending} className="text-xs text-[var(--brand)] hover:underline disabled:opacity-50">拉取任务</button>
                  <button onClick={() => rotateCredential.mutate(agent.id)} disabled={rotateCredential.isPending} className="text-xs text-amber-600 hover:underline disabled:opacity-50">轮换凭证</button>
                  <button onClick={() => deregister.mutate(agent.id)} className="text-xs text-red-500 hover:underline">注销</button>
                </div>
              </div>
            ))}
          </div>
        </WorkbenchPanel>
      )}

      {tab === "negotiate" && (
        <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <WorkbenchPanel
            title="任务能力协商"
            actions={
              <Button
                type="primary"
                loading={negotiate.isPending}
                onClick={() => {
                  negotiateForm.setFieldsValue(negForm);
                  setShowNegotiateDrawer(true);
                }}
              >
                新建协商
              </Button>
            }
          >
            <div className="space-y-3">
              <Alert
                type="info"
                showIcon
                message="用任务目标自动匹配外部 Agent"
                description="填写一次任务类型、描述、能力和优先级，平台会按能力覆盖、成功率、负载、心跳和风险策略生成推荐与分发候选。"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="text-xs text-[var(--muted)]">任务类型</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{negForm.task_type || "-"}</div>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="text-xs text-[var(--muted)]">优先级 / SLA</div>
                  <div className="mt-1 text-sm font-semibold">{negForm.priority} · {negForm.priority === "P0" ? 15 : negForm.priority === "P1" ? 30 : 60} 分钟</div>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">所需能力</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {splitList(negForm.required_capabilities).length === 0 ? <span className="text-sm text-[var(--muted)]">未指定能力</span> : null}
                  {splitList(negForm.required_capabilities).map((capability) => (
                    <span key={capability} className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-xs text-[var(--brand)]">{capability}</span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
                {negForm.task_description || "暂无任务描述"}
              </div>
              {negResult?.session_id ? (
                <Button
                  size="small"
                  onClick={() => {
                    setSelectedSessionId(negResult.session_id);
                    switchTab("sessions");
                  }}
                >
                  查看最近协商时间线
                </Button>
              ) : null}
              {negotiate.error ? <Alert type="error" showIcon message={(negotiate.error as Error).message} /> : null}
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="匹配解释与分发">
            {!negResult ? <p className="text-sm text-[var(--muted)]">填写任务类型和能力后开始协商，系统会按能力覆盖、成功率、负载和风险给出推荐。</p> : null}
            {negResult ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm">
                  <p>{negResult.recommendation}</p>
                  {negResult.session_id ? (
                    <button type="button" onClick={() => { setSelectedSessionId(negResult.session_id); switchTab("sessions"); }} className="mt-2 font-mono text-xs text-[var(--brand)] hover:underline">
                      Session {negResult.session_id}
                    </button>
                  ) : null}
                </div>
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

      {tab === "sessions" && (
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <WorkbenchPanel title="协商会话">
            <div className="space-y-2">
              {(sessionsQ.data?.items ?? []).length === 0 ? <p className="text-sm text-[var(--muted)]">暂无协商会话，先在能力协商中发起一次匹配。</p> : null}
              {(sessionsQ.data?.items ?? []).map((session: any) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedSessionId(session.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${selectedSessionId === session.id ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--brand)]"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{session.task?.task_type || "A2A negotiation"}</p>
                      <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{session.id}</p>
                    </div>
                    <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted)]">{session.summary?.events ?? 0} 事件</span>
                  </div>
                  <p className="mt-2 text-xs text-[var(--muted)]">分发 {session.summary?.dispatches ?? 0} · 证据 {session.summary?.evidence ?? 0} · 重试 {session.summary?.retries ?? 0}</p>
                </button>
              ))}
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="协议时间线">
            {!selectedSessionId ? <p className="text-sm text-[var(--muted)]">选择一个协商会话查看完整 transcript。</p> : null}
            {selectedSessionQ.isLoading ? <p className="text-sm text-[var(--muted)]">加载时间线...</p> : null}
            {selectedSessionQ.data ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                  <p className="text-sm font-semibold">{selectedSessionQ.data.task?.task_type || "A2A negotiation"}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">优先级 {selectedSessionQ.data.task?.priority || "-"} · 需要能力 {(selectedSessionQ.data.task?.required_capabilities ?? []).join(", ") || "-"}</p>
                </div>
                {(selectedSessionQ.data.events ?? []).map((event: any, index: number) => (
                  <div key={event.id ?? `${event.type}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{index + 1}. {event.title || event.type}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{event.type} · {event.at?.slice(0, 19).replace("T", " ")}</p>
                      </div>
                      {event.status ? <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(event.status === "failed" ? "high" : "ok")}`}>{event.status}</span> : null}
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-[var(--muted)]">
                      {event.dispatch_id ? <span>Dispatch: <b className="font-mono text-[var(--text)]">{event.dispatch_id}</b></span> : null}
                      {event.agent_run_id ? <span>Run: <b className="font-mono text-[var(--text)]">{event.agent_run_id}</b></span> : null}
                      {event.retry_of_dispatch_id ? <span>Retry of: <b className="font-mono text-[var(--text)]">{event.retry_of_dispatch_id}</b></span> : null}
                      {typeof event.candidate_count === "number" ? <span>候选 Agent: {event.candidate_count}</span> : null}
                      {event.evidence_quality ? <span>证据质量: {event.evidence_quality.status} / {event.evidence_quality.score}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </WorkbenchPanel>
        </div>
      )}

      {tab === "sla" && (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <WorkbenchPanel title="外部 Agent SLA" actions={
            <div className="flex flex-wrap gap-2">
              <button onClick={() => slaTasks.mutate(true)} disabled={slaTasks.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览治理任务</button>
              <button onClick={() => slaTasks.mutate(false)} disabled={slaTasks.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">生成治理任务</button>
            </div>
          }>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">SLA 健康分</div>
                <div className="mt-1 text-2xl font-semibold">{slaQ.data?.summary?.health_score ?? 100}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">超时</div>
                <div className="mt-1 text-2xl font-semibold">{slaQ.data?.summary?.overdue ?? 0}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">即将超时</div>
                <div className="mt-1 text-2xl font-semibold">{slaQ.data?.summary?.due_soon ?? 0}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">缺证据</div>
                <div className="mt-1 text-2xl font-semibold">{slaQ.data?.summary?.missing_evidence ?? 0}</div>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {(slaQ.data?.items ?? []).length === 0 ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">当前没有 A2A 分发记录需要 SLA 治理。</p> : null}
              {(slaQ.data?.items ?? []).map((item: any) => (
                <div key={item.dispatch_id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{item.task_id || item.dispatch_id}</p>
                      <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">Dispatch {item.dispatch_id}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(item.risk_level)}`}>{item.sla_status}</span>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-[var(--muted)] sm:grid-cols-2">
                    <span>SLA：{item.sla_minutes} 分钟</span>
                    <span>已耗时：{item.elapsed_minutes} 分钟</span>
                    <span>超时：{item.minutes_overdue} 分钟</span>
                    <span>证据：{item.missing_evidence ? "未回写" : "已回写"}</span>
                    {item.agent_run_id ? <span className="font-mono">Run {String(item.agent_run_id).slice(0, 12)}</span> : null}
                    {item.session_id ? <button type="button" onClick={() => { setSelectedSessionId(item.session_id); switchTab("sessions"); }} className="text-left font-mono text-[var(--brand)] hover:underline">Session {String(item.session_id).slice(0, 12)}</button> : null}
                  </div>
                </div>
              ))}
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="SLA 治理任务">
            <div className="space-y-3">
              <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">
                当前策略按 Dispatch payload、优先级 SLA、默认 SLA 顺序计算；超过阈值标记即将超时，超过截止时间进入升级治理。
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">SLA 策略配置</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">默认 {slaPolicyForm.default_sla_minutes} 分钟 · 即将超时 {Math.round(Number(slaPolicyForm.due_soon_ratio) * 100)}% · P0 {slaPolicyForm.p0} 分钟</p>
                  </div>
                  <Button
                    size="small"
                    loading={updateSlaPolicy.isPending}
                    onClick={() => {
                      slaPolicyAntForm.setFieldsValue(slaPolicyForm);
                      setShowSlaPolicyDrawer(true);
                    }}
                  >
                    编辑策略
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[var(--muted)]">P1 {slaPolicyForm.p1} 分钟</span>
                  <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[var(--muted)]">P2 {slaPolicyForm.p2} 分钟</span>
                  <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[var(--muted)]">P3 {slaPolicyForm.p3} 分钟</span>
                  <span className={`rounded-full px-2 py-1 ${slaPolicyForm.auto_retry_enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>自动重试 {slaPolicyForm.auto_retry_enabled ? `开启 · ${slaPolicyForm.max_auto_retries} 次` : "关闭"}</span>
                  <span className={`rounded-full px-2 py-1 ${slaPolicyForm.im_alert_enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>IM 提醒 {slaPolicyForm.im_alert_enabled ? "开启" : "关闭"}</span>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">自动升级动作</p>
                  <div className="flex gap-2">
                    <button onClick={() => slaEscalations.mutate(true)} disabled={slaEscalations.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览动作</button>
                    <button onClick={() => slaEscalations.mutate(false)} disabled={slaEscalations.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">执行升级</button>
                  </div>
                </div>
                {slaEscalationResult ? (
                  <div className="mt-3 space-y-2">
                    {(slaEscalationResult.actions ?? []).length === 0 ? <p className="text-xs text-[var(--muted)]">当前没有需要升级的 SLA 风险。</p> : null}
                    {(slaEscalationResult.actions ?? []).map((item: any, index: number) => (
                      <div key={`${item.action}-${item.dispatch_id}-${index}`} className="rounded-md bg-[var(--surface-muted)] px-3 py-2 text-xs">
                        <span className="font-semibold">{item.action}</span> · {item.sla_status} · {String(item.dispatch_id).slice(0, 12)}
                      </div>
                    ))}
                    {(slaEscalationResult.applied ?? []).length ? <p className="text-xs text-[var(--brand)]">已执行 {slaEscalationResult.applied.length} 个升级动作</p> : null}
                  </div>
                ) : null}
              </div>
              {(slaQ.data?.risks ?? []).map((risk: any, index: number) => (
                <div key={`${risk.title}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{risk.title}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{risk.recommendation}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(risk.level)}`}>{risk.count ?? 0}</span>
                  </div>
                </div>
              ))}
              {slaTaskResult ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-sm font-semibold">{slaTaskResult.dry_run ? "任务预览" : "任务已生成"}</p>
                  <div className="mt-2 space-y-2">
                    {(slaTaskResult.items ?? []).length === 0 ? <p className="text-xs text-[var(--muted)]">当前没有需要任务化的 SLA 风险。</p> : null}
                    {(slaTaskResult.items ?? []).map((item: any) => (
                      <div key={item.source_report_id} className="rounded-md bg-[var(--surface-muted)] px-3 py-2 text-xs">
                        <span className="font-semibold">{item.priority}</span> · {item.title}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </WorkbenchPanel>
        </div>
      )}

      {tab === "windows" && (
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <WorkbenchPanel title="执行窗口审计" actions={
            <div className="flex flex-wrap gap-2">
              <button onClick={() => windowActions.mutate(true)} disabled={windowActions.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览自动动作</button>
              <button onClick={() => windowActions.mutate(false)} disabled={windowActions.isPending} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">执行自动动作</button>
              <button onClick={() => windowTasks.mutate(true)} disabled={windowTasks.isPending} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">预览治理任务</button>
              <button onClick={() => windowTasks.mutate(false)} disabled={windowTasks.isPending} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">生成治理任务</button>
            </div>
          }>
            <div className="mb-4 grid gap-3 sm:grid-cols-5">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">健康分</div>
                <div className="mt-1 text-2xl font-semibold">{windowsQ.data?.summary?.health_score ?? 100}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">过期租约</div>
                <div className="mt-1 text-2xl font-semibold">{windowsQ.data?.summary?.expired_leases ?? 0}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">进度停滞</div>
                <div className="mt-1 text-2xl font-semibold">{windowsQ.data?.summary?.stale_progress ?? 0}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">阻塞待重派</div>
                <div className="mt-1 text-2xl font-semibold">{windowsQ.data?.summary?.blocked ?? 0}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-xs text-[var(--muted)]">即将到期</div>
                <div className="mt-1 text-2xl font-semibold">{windowsQ.data?.summary?.due_soon ?? 0}</div>
              </div>
            </div>
            <div className="space-y-2">
              {(windowsQ.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-sm text-[var(--muted)]">当前没有活跃的 A2A 执行窗口。</p> : null}
              {(windowsQ.data?.items ?? []).map((item: any) => (
                <div key={item.dispatch_id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{item.task_id || item.dispatch_id}</p>
                      <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{item.dispatch_id}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${badgeClass(item.risk_level)}`}>{item.risk_level}</span>
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted)]">{item.window_status}</span>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-3">
                    <span>Agent：{agentById.get(item.agent_id)?.name ?? item.agent_id}</span>
                    <span>确认：{item.ack_status || "-"}</span>
                    <span>建议：{item.recommended_action}</span>
                    <span>租约到期：{item.lease_expires_at ? String(item.lease_expires_at).slice(0, 19).replace("T", " ") : "-"}</span>
                    <span>剩余分钟：{item.minutes_to_lease_expiry ?? "-"}</span>
                    <span>进度停滞：{item.progress_idle_minutes ?? "-"} 分钟</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.recommended_action === "renew" || item.recommended_action === "renew_or_reassign" ? (
                      <span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-xs text-[var(--brand)]">可在 Agent 注册页续租</span>
                    ) : null}
                    {item.candidate_agent_ids?.length ? (
                      <button
                        disabled={reassignDispatch.isPending}
                        onClick={() => reassignDispatch.mutate({ dispatchId: item.dispatch_id, agentId: item.candidate_agent_ids[0] })}
                        className="text-xs text-[var(--brand)] hover:underline disabled:opacity-50"
                      >
                        重派给候选 Agent
                      </button>
                    ) : null}
                    {item.window_status === "lease_expired" ? (
                      <button onClick={() => expireLeases.mutate()} disabled={expireLeases.isPending} className="text-xs text-amber-600 hover:underline disabled:opacity-50">回收过期租约</button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </WorkbenchPanel>
          <WorkbenchPanel title="自动动作与治理任务">
            <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">执行窗口策略</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">当前模式：{windowPolicyQ.data?.action_mode ?? windowPolicyForm.action_mode} · 停滞 {windowsQ.data?.summary?.stale_after_minutes ?? windowPolicyForm.stale_after_minutes} 分钟 · 到期 {windowsQ.data?.summary?.due_soon_seconds ?? windowPolicyForm.due_soon_seconds} 秒</p>
                </div>
                <Button
                  size="small"
                  loading={updateWindowPolicy.isPending}
                  onClick={() => {
                    windowPolicyAntForm.setFieldsValue(windowPolicyForm);
                    setShowWindowPolicyDrawer(true);
                  }}
                >
                  编辑策略
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[var(--muted)]">自动重派上限 {windowPolicyForm.max_auto_reassign}</span>
                <span className={`rounded-full px-2 py-1 ${windowPolicyForm.auto_renew_enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>自动续租 {windowPolicyForm.auto_renew_enabled ? "开启" : "关闭"}</span>
                <span className={`rounded-full px-2 py-1 ${windowPolicyForm.auto_reassign_enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>自动重派 {windowPolicyForm.auto_reassign_enabled ? "开启" : "关闭"}</span>
                <span className={`rounded-full px-2 py-1 ${windowPolicyForm.auto_expire_enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>自动回收 {windowPolicyForm.auto_expire_enabled ? "开启" : "关闭"}</span>
                <span className={`rounded-full px-2 py-1 ${windowPolicyForm.require_preview_for_high_risk ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>高风险预览 {windowPolicyForm.require_preview_for_high_risk ? "开启" : "关闭"}</span>
              </div>
            </div>
            {!windowActionResult ? <p className="text-sm text-[var(--muted)]">自动动作会保守处理执行窗口风险：即将到期或进度停滞的租约续租，阻塞/拒绝任务重派给候选 Agent，过期 pending 租约回收后重新开放拉取。</p> : null}
            {windowActionResult ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-sm">
                  {windowActionResult.dry_run ? "自动动作预览" : "自动动作已执行"} · 计划 {windowActionResult.actions?.length ?? 0} 个 · 已执行 {windowActionResult.applied?.length ?? 0} 个 · 已阻断 {windowActionResult.blocked?.length ?? 0} 个
                </div>
                {(windowActionResult.actions ?? []).length === 0 ? <p className="text-xs text-[var(--muted)]">当前没有可自动处理的执行窗口风险。</p> : null}
                {(windowActionResult.actions ?? []).map((item: any, index: number) => (
                  <div key={`${item.action}-${item.dispatch_id}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{item.action} · {item.window_status}</p>
                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full px-2 py-0.5 ring-1 ${badgeClass(item.risk_level)}`}>{item.risk_level}</span>
                        <span className={`rounded-full px-2 py-0.5 ring-1 ${item.allowed ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-red-50 text-red-700 ring-red-100"}`}>{item.allowed ? "allowed" : "blocked"}</span>
                      </div>
                    </div>
                    <div className="mt-2 grid gap-1 text-[var(--muted)]">
                      <span>Dispatch：{String(item.dispatch_id).slice(0, 18)}</span>
                      <span>Task：{item.task_id || "-"}</span>
                      {item.target_agent_id ? <span>目标 Agent：{agentById.get(item.target_agent_id)?.name ?? item.target_agent_id}</span> : null}
                      {item.extend_seconds ? <span>续租秒数：{item.extend_seconds}</span> : null}
                      <span>原因：{item.reason || "-"}</span>
                      <span>策略：{item.policy_decision?.decision ?? "-"}</span>
                      {item.block_reason ? <span className="text-red-600">阻断：{item.block_reason}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="my-4 border-t border-[var(--border)]" />
            {!windowTaskResult ? <p className="text-sm text-[var(--muted)]">执行窗口任务化会把过期租约、进度停滞和阻塞重派风险转成可跟踪任务。</p> : null}
            {windowTaskResult ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-[var(--surface-muted)] p-3 text-sm">
                  {windowTaskResult.dry_run ? "任务预览" : "任务已生成"} · {windowTaskResult.items?.length ?? 0} 条
                </div>
                {(windowTaskResult.items ?? []).map((item: any) => (
                  <div key={item.source_report_id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                    <p className="font-semibold">{item.priority} · {item.title}</p>
                    <p className="mt-1 whitespace-pre-line text-[var(--muted)]">{item.description}</p>
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
                  <th className="pb-2 pr-4">Agent</th><th className="pb-2 pr-4">任务</th><th className="pb-2 pr-4">Agent Run</th><th className="pb-2 pr-4">状态</th><th className="pb-2 pr-4">重试</th><th className="pb-2 pr-4">分发时间</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
                  {(dispatchQ.data?.items ?? []).length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-[var(--muted)]">暂无分发记录</td></tr> : null}
                  {(dispatchQ.data?.items ?? []).map((item: any) => (
                    <tr key={item.id} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-4">
                        <p className="text-xs font-medium">{agentById.get(item.agent_id)?.name ?? item.agent_id?.slice(0, 12)}</p>
                        <p className="font-mono text-[10px] text-[var(--muted)]">{item.agent_id}</p>
                      </td>
                      <td className="py-2 pr-4">{item.task_id}</td>
                      <td className="py-2 pr-4">
                        {item.agent_run_id ? (
                          <a href="#/ai/agent-ops/runs" className="font-mono text-[10px] text-[var(--brand)] hover:underline" title={item.agent_run_id}>{item.agent_run_id.slice(0, 12)}</a>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">未关联</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">{item.status}</td>
                      <td className="py-2 pr-4">
                        <div className="space-y-0.5 text-xs">
                          <span className={item.retry_count ? "text-[var(--text)]" : "text-[var(--muted)]"}>{item.retry_count ? `${item.retry_count} 次` : "-"}</span>
                          {item.retry_of_dispatch_id ? <p className="font-mono text-[10px] text-[var(--muted)]">from {String(item.retry_of_dispatch_id).slice(0, 8)}</p> : null}
                          {item.retry_dispatch_id ? <p className="font-mono text-[10px] text-[var(--brand)]">to {String(item.retry_dispatch_id).slice(0, 8)}</p> : null}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-xs text-[var(--muted)]">{item.dispatched_at?.slice(0, 19).replace("T", " ")}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => previewPacket.mutate(item.id)} className="text-xs text-[var(--brand)] hover:underline">协议包</button>
                          {!item.evidence_at ? <button onClick={() => evidence.mutate(item.id)} className="text-xs text-[var(--brand)] hover:underline">回写证据</button> : null}
                          {RETRYABLE_DISPATCH_STATUSES.has(String(item.status || "").toLowerCase()) ? (
                            <button
                              disabled={retryDispatch.isPending}
                              onClick={() => retryDispatch.mutate(item.id)}
                              className="text-xs text-amber-600 hover:underline disabled:opacity-50"
                            >
                              重试
                            </button>
                          ) : null}
                          {["blocked", "failed", "cancelled", "reassigned"].includes(String(item.status || "").toLowerCase()) ? (() => {
                            const targetAgent = agents.find((agent: any) => agent.id !== item.agent_id);
                            return targetAgent ? (
                              <button
                                disabled={reassignDispatch.isPending}
                                onClick={() => reassignDispatch.mutate({ dispatchId: item.id, agentId: targetAgent.id })}
                                className="text-xs text-[var(--brand)] hover:underline disabled:opacity-50"
                                title={`重派给 ${targetAgent.name || targetAgent.id}`}
                              >
                                重派
                              </button>
                            ) : null;
                          })() : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </WorkbenchPanel>
          <WorkbenchPanel title="协议包预览">
            {reassignResult ? (
              <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                已重派：{String(reassignResult.reassign_of_dispatch_id || "").slice(0, 12)} → {String(reassignResult.id || "").slice(0, 12)}
              </div>
            ) : null}
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
                    {item.agent_run_id ? <p className="mt-1 font-mono text-[10px] text-[var(--brand)]">Run {item.agent_run_id}</p> : null}
                    {item.retry_of_dispatch_id ? <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">Retry of {item.retry_of_dispatch_id}</p> : null}
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

      <Drawer
        title="编辑信任策略"
        width={640}
        open={showTrustPolicyDrawer}
        onClose={() => setShowTrustPolicyDrawer(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowTrustPolicyDrawer(false)}>取消</Button>
            <Button type="primary" loading={updateTrustPolicy.isPending} onClick={() => trustPolicyAntForm.submit()}>
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
              { title: "准入条件" },
              { title: "执行阶段" },
              { title: "治理任务" },
            ]}
          />
          <Alert
            type="info"
            showIcon
            message="信任策略会影响 Agent 协商、任务拉取和分发准入"
            description="建议按组织代码、能力和心跳新鲜度先收紧准入，再结合治理任务处理掉线或低成功率 Agent。"
          />
          <Form
            form={trustPolicyAntForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={trustPolicyForm}
            onValuesChange={(_, values) => setTrustPolicyForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => updateTrustPolicy.mutate({ ...DEFAULT_TRUST_POLICY_FORM, ...trustPolicyForm, ...values })}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Form.Item name="stale_after_minutes" label="心跳新鲜分钟">
                <InputNumber min={5} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="min_success_rate" label="最低成功率">
                <InputNumber min={0} max={1} step={0.01} className="w-full" />
              </Form.Item>
              <Form.Item name="max_load" label="最大负载">
                <InputNumber min={0} precision={0} className="w-full" />
              </Form.Item>
            </div>
            <Form.Item name="allowed_agent_types" label="允许 Agent 类型" tooltip="支持逗号、中文逗号或换行分隔">
              <Input placeholder="workbuddy, openclaw, hermes_agent" />
            </Form.Item>
            <Form.Item name="allowed_organization_codes" label="允许组织代码" tooltip="支持逗号、中文逗号或换行分隔">
              <Input placeholder="partner-a, partner-b" />
            </Form.Item>
            <Form.Item name="required_capabilities" label="必需能力" tooltip="支持逗号、中文逗号或换行分隔">
              <Input.TextArea rows={3} placeholder={"code.review, security.audit\ntest.automation"} />
            </Form.Item>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="require_endpoint" label="必须配置 Endpoint" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="enforce_on_negotiate" label="协商时过滤" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="enforce_on_pull" label="拉取时阻断" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="enforce_on_dispatch" label="分发时阻断" valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
            {updateTrustPolicy.error ? <Alert type="error" showIcon message={(updateTrustPolicy.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="编辑 SLA 策略"
        width={600}
        open={showSlaPolicyDrawer}
        onClose={() => setShowSlaPolicyDrawer(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowSlaPolicyDrawer(false)}>取消</Button>
            <Button type="primary" loading={updateSlaPolicy.isPending} onClick={() => slaPolicyAntForm.submit()}>
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
              { title: "设置阈值" },
              { title: "自动处置" },
              { title: "治理留痕" },
            ]}
          />
          <Alert
            type="info"
            showIcon
            message="SLA 策略会影响超时判断、自动升级和治理任务生成"
            description="建议生产环境先使用保守阈值和 IM 提醒，确认外部 Agent 稳定后再开启自动重试。"
          />
          <Form
            form={slaPolicyAntForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={slaPolicyForm}
            onValuesChange={(_, values) => setSlaPolicyForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => updateSlaPolicy.mutate({ ...DEFAULT_SLA_POLICY_FORM, ...slaPolicyForm, ...values })}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="default_sla_minutes" label="默认 SLA 分钟" rules={[{ required: true, message: "请输入默认 SLA" }]}>
                <InputNumber min={5} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="due_soon_ratio" label="即将超时阈值">
                <InputNumber min={0.1} max={0.95} step={0.05} className="w-full" />
              </Form.Item>
              <Form.Item name="p0" label="P0 SLA 分钟">
                <InputNumber min={5} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="p1" label="P1 SLA 分钟">
                <InputNumber min={5} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="p2" label="P2 SLA 分钟">
                <InputNumber min={5} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="p3" label="P3 SLA 分钟">
                <InputNumber min={5} precision={0} className="w-full" />
              </Form.Item>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="auto_retry_enabled" label="超时自动重试" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="im_alert_enabled" label="超时 IM 提醒" valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
            <Form.Item name="max_auto_retries" label="自动重试上限">
              <InputNumber min={0} max={5} precision={0} className="w-full" />
            </Form.Item>
            {updateSlaPolicy.error ? <Alert type="error" showIcon message={(updateSlaPolicy.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="编辑执行窗口策略"
        width={600}
        open={showWindowPolicyDrawer}
        onClose={() => setShowWindowPolicyDrawer(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowWindowPolicyDrawer(false)}>取消</Button>
            <Button type="primary" loading={updateWindowPolicy.isPending} onClick={() => windowPolicyAntForm.submit()}>
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
              { title: "窗口阈值" },
              { title: "自动动作" },
              { title: "风险护栏" },
            ]}
          />
          <Alert
            type="info"
            showIcon
            message="执行窗口策略控制租约续期、停滞检测和重派回收"
            description="保守模式适合生产环境，高风险预览可避免外部 Agent 异常时自动扩大影响面。"
          />
          <Form
            form={windowPolicyAntForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={windowPolicyForm}
            onValuesChange={(_, values) => setWindowPolicyForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => updateWindowPolicy.mutate({ ...DEFAULT_WINDOW_POLICY_FORM, ...windowPolicyForm, ...values })}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="stale_after_minutes" label="进度停滞阈值分钟">
                <InputNumber min={1} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="due_soon_seconds" label="租约即将到期秒数">
                <InputNumber min={30} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="max_auto_reassign" label="自动重派上限">
                <InputNumber min={0} max={10} precision={0} className="w-full" />
              </Form.Item>
              <Form.Item name="action_mode" label="动作模式">
                <Select
                  options={[
                    { label: "guarded", value: "guarded" },
                    { label: "preview", value: "preview" },
                    { label: "automatic", value: "automatic" },
                  ]}
                />
              </Form.Item>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="auto_renew_enabled" label="允许自动续租" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="auto_reassign_enabled" label="允许自动重派" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="auto_expire_enabled" label="允许自动回收" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="require_preview_for_high_risk" label="高风险先预览" valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
            {updateWindowPolicy.error ? <Alert type="error" showIcon message={(updateWindowPolicy.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="发起能力协商"
        width={600}
        open={showNegotiateDrawer}
        onClose={() => setShowNegotiateDrawer(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowNegotiateDrawer(false)}>取消</Button>
            <Button type="primary" loading={negotiate.isPending} onClick={() => negotiateForm.submit()} disabled={!negForm.task_type.trim()}>
              开始协商
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Steps
            size="small"
            current={0}
            items={[
              { title: "定义任务" },
              { title: "匹配 Agent" },
              { title: "分发取证" },
            ]}
          />
          <Alert
            type="info"
            showIcon
            message="协商结果会生成会话和候选 Agent"
            description="完成后可直接在右侧结果中分发任务，并自动生成协议包、SLA 信息和后续证据回写入口。"
          />
          <Form
            form={negotiateForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={negForm}
            onValuesChange={(_, values) => setNegForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => negotiate.mutate({ ...DEFAULT_NEG_FORM, ...values })}
          >
            <Form.Item name="task_type" label="任务类型" rules={[{ required: true, message: "请输入任务类型" }]}>
              <Input placeholder="code_review" />
            </Form.Item>
            <Form.Item name="task_description" label="任务描述">
              <Input.TextArea rows={4} placeholder="说明任务目标、输入范围、希望 Agent 返回的证据类型" />
            </Form.Item>
            <Form.Item name="required_capabilities" label="所需能力" tooltip="支持逗号、中文逗号或换行分隔">
              <Input.TextArea rows={3} placeholder={"code.review, security.audit\ntest.automation"} />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <Select options={PRIORITIES.map((item) => ({ label: item, value: item }))} />
            </Form.Item>
            {negotiate.error ? <Alert type="error" showIcon message={(negotiate.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <Drawer
        title="注册外部 Agent"
        width={560}
        open={showForm}
        onClose={() => setShowForm(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setShowForm(false)}>取消</Button>
            <Button type="primary" loading={register.isPending} onClick={() => registerForm.submit()} disabled={!regForm.name.trim()}>
              保存并签发凭证
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <Steps
            size="small"
            current={0}
            items={[
              { title: "配置 Agent" },
              { title: "签发凭证" },
              { title: "心跳接入" },
            ]}
          />
          <Alert
            type="info"
            showIcon
            message="注册后只展示一次凭证 token"
            description="请在外部 Agent 中保存该凭证，并通过心跳、拉取任务、确认租约和证据回写完成接入验证。"
          />
          <Form
            form={registerForm}
            layout="vertical"
            requiredMark="optional"
            initialValues={DEFAULT_REG_FORM}
            onValuesChange={(_, values) => setRegForm((form) => ({ ...form, ...values }))}
            onFinish={(values) => register.mutate({ ...DEFAULT_REG_FORM, ...values })}
          >
            <Form.Item name="name" label="Agent 名称" rules={[{ required: true, message: "请输入 Agent 名称" }]}>
              <Input placeholder="例如 WorkBuddy Security Reviewer" />
            </Form.Item>
            <Form.Item name="agent_type" label="Agent 类型">
              <Select
                options={AGENT_TYPES.map((item) => ({ label: item, value: item }))}
              />
            </Form.Item>
            <Form.Item name="endpoint" label="Endpoint URL">
              <Input placeholder="https://agent.example.com/a2a" />
            </Form.Item>
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item name="organization_code" label="组织代码">
                <Input placeholder="partner-a" />
              </Form.Item>
              <Form.Item name="trust_domain" label="信任域">
                <Input placeholder="external-dev" />
              </Form.Item>
            </div>
            <Form.Item name="capabilities" label="能力列表" tooltip="支持逗号、中文逗号或换行分隔">
              <Input.TextArea
                rows={4}
                placeholder={"code.review, security.audit\ntest.automation"}
              />
            </Form.Item>
            {register.error ? <Alert type="error" showIcon message={(register.error as Error).message} /> : null}
          </Form>
        </div>
      </Drawer>

      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="a2a-gateway" title="AI 智能助手" initialPrompt="分析 A2A 协议健康、能力覆盖、协商风险和治理任务建议" />
    </div>
  );
}
