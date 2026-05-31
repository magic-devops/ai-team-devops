import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, BadgeDollarSign, CloudCog, Database, ExternalLink, FileText, KeyRound, ListChecks, LogOut, MessageSquare, Network, PackageCheck, Palette, PlayCircle, Rocket, Search, Send, ServerCog, ShieldCheck, SlidersHorizontal, Terminal, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Drawer, Form, Input, Select, Space, Steps, Switch } from "antd";
import { Card } from "@/components/Card";
import { api } from "@/lib/api";
import { clearSession, getProjectId, getToken } from "@/lib/authStorage";
import { getThemePreference, setThemePreference, THEME_OPTIONS, type ThemePreference } from "@/lib/theme";
import { SettingsWorkbenchHeader } from "@/pages/admin/SettingsWorkbenchHeader";

type SettingsModule = "account" | "runtime" | "observability" | "workspace" | "profiles" | "storage" | "sso" | "appearance" | "billing";
type SsoRiskEscalationAction = "create_tasks" | "send_im";
type SsoRiskEscalationBooleanKey = "enabled" | "include_low" | "force";
type SsoRiskEscalationDraft = {
  enabled: boolean;
  actions: SsoRiskEscalationAction[];
  channels: string[];
  min_severity: string;
  score_threshold: string;
  priority: string;
  assigned_to: string;
  dev_tool: string;
  include_low: boolean;
  limit: string;
  cooldown_minutes: string;
  title: string;
  owner: string;
  notes: string;
  force: boolean;
};

const ssoRiskEscalationBooleanControls: Array<{ key: SsoRiskEscalationBooleanKey; label: string }> = [
  { key: "enabled", label: "ssoRiskEscalationEnabled" },
  { key: "include_low", label: "ssoRiskEscalationIncludeLow" },
  { key: "force", label: "ssoRiskEscalationForce" },
];

const ssoRiskEscalationActions: SsoRiskEscalationAction[] = ["create_tasks", "send_im"];

const inputClass = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";
const SETTINGS_ROUTE_MODULES: Record<string, SettingsModule> = {
  account: "account",
  runtime: "runtime",
  observability: "observability",
  workspace: "workspace",
  profiles: "profiles",
  storage: "storage",
  sso: "sso",
  appearance: "appearance",
  billing: "billing",
};
const SETTINGS_MODULE_PATHS: Partial<Record<SettingsModule, string>> = {
  account: "#/settings/account",
  runtime: "#/settings/runtime",
  observability: "#/settings/observability",
  profiles: "#/settings/profiles",
  sso: "#/settings/sso",
  billing: "#/settings/billing",
};

function readSettingsModuleFromHash(): SettingsModule {
  const hash = window.location.hash || "#/settings/account";
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const queryModule = new URLSearchParams(query).get("module") || "";
  if (SETTINGS_ROUTE_MODULES[queryModule]) return SETTINGS_ROUTE_MODULES[queryModule];
  const [, routeModule] = hash.match(/^#\/settings\/([^/?#]+)/) || [];
  return SETTINGS_ROUTE_MODULES[routeModule] || "account";
}

function settingsModuleHref(module: SettingsModule): string {
  return SETTINGS_MODULE_PATHS[module] || `#/settings/account?module=${module}`;
}

function currentRedirectTarget() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/?shell=1#/dashboard";
}

export function Settings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [themePref, setThemePref] = useState<ThemePreference>(() => getThemePreference());
  const [activeModule, setActiveModule] = useState<SettingsModule>(() => readSettingsModuleFromHash());
  const opsModuleActive = activeModule === "runtime" || activeModule === "observability";
  const token = getToken();
  const projectId = getProjectId();
  const me = useQuery({ queryKey: ["authMe"], queryFn: api.authMe, enabled: Boolean(token), retry: false });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, enabled: Boolean(token), retry: false });
  const billing = useQuery({ queryKey: ["billingSubscription"], queryFn: api.billingSubscription, enabled: Boolean(token), retry: false });
  const billingAlerts = useQuery({ queryKey: ["billingAlerts"], queryFn: api.billingAlerts, enabled: Boolean(token), retry: false });
  const billingSummary = useQuery({ queryKey: ["billingSummary"], queryFn: api.billingSummary, enabled: Boolean(token), retry: false });
  const billingOveragePolicy = useQuery({ queryKey: ["billingOveragePolicy"], queryFn: api.billingOveragePolicy, enabled: Boolean(token) && activeModule === "billing", retry: false });
  const billingDunning = useQuery({ queryKey: ["billingDunning"], queryFn: api.billingDunning, enabled: Boolean(token) && activeModule === "billing", retry: false });
  const ssoConfig = useQuery({ queryKey: ["ssoConfig"], queryFn: api.ssoConfig, enabled: Boolean(token), retry: false });
  const notifyChannels = useQuery({ queryKey: ["notifyChannelsForRiskBriefing"], queryFn: api.notifyChannels, enabled: Boolean(token) && (activeModule === "sso" || activeModule === "profiles"), retry: false });
  const opsProfiles = useQuery({ queryKey: ["opsProfiles"], queryFn: api.opsProfiles, enabled: Boolean(token), retry: false });
  const opsObservability = useQuery({ queryKey: ["opsObservability"], queryFn: api.opsObservability, enabled: Boolean(token), retry: false });
  const opsStorageMigrationPlan = useQuery({ queryKey: ["opsStorageMigrationPlan"], queryFn: api.opsStorageMigrationPlan, enabled: Boolean(token), retry: false });
  const invoice = useQuery({ queryKey: ["billingInvoice"], queryFn: () => api.billingInvoice(), enabled: Boolean(token), retry: false });
  const invoices = useQuery({ queryKey: ["billingInvoices"], queryFn: () => api.billingInvoices(20), enabled: Boolean(token), retry: false });
  const payments = useQuery({ queryKey: ["billingPayments"], queryFn: () => api.billingPayments("", 20), enabled: Boolean(token), retry: false });
  const [planDraft, setPlanDraft] = useState("starter");
  const [billingEmail, setBillingEmail] = useState("");
  const [paymentDraft, setPaymentDraft] = useState({ invoice_id: "", amount_usd: "", method: "manual", external_ref: "" });
  const [overageDraft, setOverageDraft] = useState({ mode: "approval_required", grace_percent: "5", approval_threshold_percent: "100", invoice_due_days: "14", suspend_after_days: "30" });
  const [entitlementDraft, setEntitlementDraft] = useState({ feature: "team_rbac", metric: "llm_tokens", delta: "1000", subject: "agent-run" });
  const [entitlementResult, setEntitlementResult] = useState<any>(null);
  const [auditInvoiceId, setAuditInvoiceId] = useState("");
  const [ssoDraft, setSsoDraft] = useState({
    provider: "okta",
    type: "oidc",
    issuer: "",
    client_id: "",
    client_secret: "",
    redirect_uri: "",
    scope: "openid profile email",
    metadata_url: "",
    sso_url: "",
    x509_cert: "",
    name_id_format: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    scim_enabled: false,
    tenant_domain_map: "example.com=t-default",
    role_map: "sop-admins=tenant_admin\nsop-devops=devops\n*=developer",
    enabled: true,
  });
  const [ssoTestResult, setSsoTestResult] = useState<any>(null);
  const [ssoPreviewDraft, setSsoPreviewDraft] = useState({ email: "admin@example.com", groups: "sop-admins,sop-devops" });
  const [ssoPreviewResult, setSsoPreviewResult] = useState<any>(null);
  const [scimTokenResult, setScimTokenResult] = useState<any>(null);
  const [scimTestDraft, setScimTestDraft] = useState({ userName: "scim.user@example.com", displayName: "SCIM User", groups: "sop-viewers", active: true, apply: false });
  const [scimTestResult, setScimTestResult] = useState<any>(null);
  const [ssoRiskTaskDraft, setSsoRiskTaskDraft] = useState({
    include_low: false,
    limit: "6",
    priority: "P1",
    assigned_to: "SecurityOps",
    dev_tool: "codex",
  });
  const [ssoRiskTaskResult, setSsoRiskTaskResult] = useState<any>(null);
  const [ssoRiskImDraft, setSsoRiskImDraft] = useState({ channels: [] as string[], include_low: false, limit: "6", title: "" });
  const [ssoRiskImResult, setSsoRiskImResult] = useState<any>(null);
  const [ssoRiskSubscriptionDraft, setSsoRiskSubscriptionDraft] = useState({
    enabled: true,
    channels: [] as string[],
    min_severity: "medium",
    score_threshold: "75",
    frequency: "daily",
    include_low: false,
    limit: "6",
    owner: "SecurityOps",
    title: "",
    force: false,
  });
  const [ssoRiskSubscriptionResult, setSsoRiskSubscriptionResult] = useState<any>(null);
  const [ssoRiskEscalationDraft, setSsoRiskEscalationDraft] = useState<SsoRiskEscalationDraft>({
    enabled: false,
    actions: ["create_tasks", "send_im"],
    channels: [] as string[],
    min_severity: "high",
    score_threshold: "70",
    priority: "P1",
    assigned_to: "SecurityOps",
    dev_tool: "codex",
    include_low: false,
    limit: "6",
    cooldown_minutes: "60",
    title: "",
    owner: "SecurityOps",
    notes: "",
    force: false,
  });
  const [ssoRiskEscalationResult, setSsoRiskEscalationResult] = useState<any>(null);
  const [ssoRiskRunbookDraft, setSsoRiskRunbookDraft] = useState({ include_low: false, limit: "6", priority: "P1", assigned_to: "SecurityOps", dev_tool: "codex", owner: "SecurityOps", channels: [] as string[], title: "", notes: "" });
  const [ssoRiskRunbookDetail, setSsoRiskRunbookDetail] = useState<any>(null);
  const selectedSsoProvider = ssoDraft.provider.trim();
  const selectedSsoProviderExists = Boolean((ssoConfig.data?.items || []).some((item: any) => item.name === selectedSsoProvider));
  const [profileDraft, setProfileDraft] = useState({
    name: "local-dev",
    mode: "local",
    database: "sqlite",
    manager_url: "http://localhost:8765",
    public_url: "http://localhost:8765",
    features: "billing=false,sso=false,worker=false,temporal=false",
    env: "ADMIN_MODE=single\nDB_TYPE=sqlite\nWORKFLOW_ENGINE=memory",
    notes: "",
  });
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [profileEnv, setProfileEnv] = useState<any>(null);
  const [profileBundle, setProfileBundle] = useState<any>(null);
  const [deploymentPackageDraft, setDeploymentPackageDraft] = useState({ version: "", channel: "manual", release_notes: "" });
  const [deploymentPackageDetail, setDeploymentPackageDetail] = useState<any>(null);
  const [deploymentApprovalDraft, setDeploymentApprovalDraft] = useState({ package_id: "", environment: "staging", requested_by: "", reviewers: "ops-lead", policy: "single", notes: "" });
  const [deploymentApprovalDetail, setDeploymentApprovalDetail] = useState<any>(null);
  const [deploymentCanaryDraft, setDeploymentCanaryDraft] = useState({ package_id: "", name: "production progressive rollout", environment: "staging", strategy: "linear", traffic_steps: "5,25,50,100", max_error_rate: "0.02", latency_p95_ms: "1000", min_observation_minutes: "10", auto_promote: false, created_by: "", notes: "", error_rate: "0.005", observed_latency_p95_ms: "320" });
  const [deploymentCanaryDetail, setDeploymentCanaryDetail] = useState<any>(null);
  const [deploymentCanaryMetricSourceDraft, setDeploymentCanaryMetricSourceDraft] = useState({ policy_id: "", name: "production canary prometheus", source_type: "manual", endpoint: "", error_rate_query: "sum(rate(http_requests_total{status=~\"5..\"}[5m])) / sum(rate(http_requests_total[5m]))", latency_p95_query: "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) * 1000", window_minutes: "10", enabled: true, sample_error_rate: "0.005", sample_latency_p95_ms: "320", labels: "service=manager\nenvironment=production", notes: "" });
  const [deploymentCanaryMetricSourceDetail, setDeploymentCanaryMetricSourceDetail] = useState<any>(null);
  const [deploymentCanaryMetricResult, setDeploymentCanaryMetricResult] = useState<any>(null);
  const [deploymentCanaryImDraft, setDeploymentCanaryImDraft] = useState({ channels: [] as string[], title: "", limit: "6" });
  const [deploymentCanaryImResult, setDeploymentCanaryImResult] = useState<any>(null);
  const [deploymentPipelineDraft, setDeploymentPipelineDraft] = useState({ package_id: "", environment: "staging", action: "preview", operator: "", dry_run: true, approval_required: true, notes: "" });
  const [deploymentPipelineDetail, setDeploymentPipelineDetail] = useState<any>(null);
  const [deploymentPipelineDrawerOpen, setDeploymentPipelineDrawerOpen] = useState(false);
  const [deploymentPipelineExecuteDraft, setDeploymentPipelineExecuteDraft] = useState({ executor_id: "dry-run", command_id: "", stage_id: "", dry_run: true, allow_apply: false, evidence_url: "", timeout_seconds: "30", note: "" });
  const [deploymentPipelineCallbackDraft, setDeploymentPipelineCallbackDraft] = useState({ execution_id: "", status: "succeeded", external_run_id: "", timestamp: "", nonce: "", signature: "", evidence_url: "", stdout: "", stderr: "", exit_code: "0", note: "", metadata: "source=manual-callback" });
  const [deploymentPipelineRemediationDraft, setDeploymentPipelineRemediationDraft] = useState({ include_low: false, priority: "P1", assigned_to: "ReleaseOps", dev_tool: "codex", note: "" });
  const [deploymentExecutorTargetDraft, setDeploymentExecutorTargetDraft] = useState({ id: "", name: "production orchestrator", target_type: "webhook", endpoint: "https://deploy.example.com/hooks/hermes", enabled: true, supports: "validate,verify,deploy,rollback", auth_ref: "secret://deploy/orchestrator", callback_secret_ref: "env://SOP_DEPLOY_CALLBACK_SECRET", require_callback_signature: true, callback_skew_seconds: "300", concurrency_limit: "1", timeout_seconds: "120", labels: "owner=ReleaseOps\nenvironment=production", notes: "" });
  const [deploymentRollbackDrillDraft, setDeploymentRollbackDrillDraft] = useState({ package_id: "", name: "release rollback drill", environment: "staging", scenario: "post_deploy_regression", operator: "", approval_required: true, create_pipeline: true, notes: "" });
  const [deploymentRollbackDrillDetail, setDeploymentRollbackDrillDetail] = useState<any>(null);
  const [deploymentRollbackRunbookDraft, setDeploymentRollbackRunbookDraft] = useState({ package_id: "", drill_id: "", name: "release rollback runbook", environment: "production", trigger: "manual", operator: "", approval_required: true, create_preview_pipeline: true, task_priority: "P1", assigned_to: "ReleaseOps", dev_tool: "codex", notes: "" });
  const [deploymentRollbackRunbookDetail, setDeploymentRollbackRunbookDetail] = useState<any>(null);
  const [deploymentExecutionAuditDraft, setDeploymentExecutionAuditDraft] = useState({ package_id: "", pipeline_run_id: "", canary_policy_id: "", rollback_drill_id: "", rollback_runbook_id: "", environment: "production", action: "deploy", status: "pending", actor: "", change_ticket: "", evidence_url: "", risk_level: "medium", priority: "P1", assigned_to: "ReleaseOps", dev_tool: "codex", include_low: false, notes: "", metadata: "owner=ReleaseOps\nservice=manager" });
  const [deploymentExecutionAuditDetail, setDeploymentExecutionAuditDetail] = useState<any>(null);
  const [storageSmokeResult, setStorageSmokeResult] = useState<any>(null);
  const [traceFilter, setTraceFilter] = useState({ run_id: "", trace_id: "", correlation_id: "", limit: "100" });
  const [logFilter, setLogFilter] = useState({ name: "sop.app.log", level: "", q: "", limit: "200" });
  const opsLogs = useQuery({
    queryKey: ["opsLogs", logFilter.name, logFilter.level, logFilter.q, logFilter.limit],
    queryFn: () => api.opsLogs(logFilter.name, Number(logFilter.limit || 200), logFilter.level, logFilter.q),
    enabled: Boolean(token) && opsModuleActive,
    retry: false,
  });
  const opsTraceSummary = useQuery({
    queryKey: ["opsTraceSummary", traceFilter.run_id, traceFilter.trace_id, traceFilter.correlation_id, traceFilter.limit],
    queryFn: () => api.opsTraceSummary({
      run_id: traceFilter.run_id,
      trace_id: traceFilter.trace_id,
      correlation_id: traceFilter.correlation_id,
      limit: Number(traceFilter.limit || 100),
    }),
    enabled: Boolean(token) && opsModuleActive,
    retry: false,
  });
  const deploymentPackages = useQuery({
    queryKey: ["opsDeploymentPackages", profileDraft.name],
    queryFn: () => api.opsDeploymentPackages(profileDraft.name.trim(), 20),
    enabled: Boolean(token) && activeModule === "profiles" && Boolean(profileDraft.name.trim()),
    retry: false,
  });
  const deploymentPipelines = useQuery({
    queryKey: ["opsDeploymentPipelines", profileDraft.name],
    queryFn: () => api.opsDeploymentPipelines({ profile: profileDraft.name.trim(), limit: 20 }),
    enabled: Boolean(token) && activeModule === "profiles" && Boolean(profileDraft.name.trim()),
    retry: false,
  });
  const deploymentPipelineExecutors = useQuery({
    queryKey: ["opsDeploymentPipelineExecutors", profileDraft.name],
    queryFn: () => api.opsDeploymentPipelineExecutors(profileDraft.name.trim()),
    enabled: Boolean(token) && activeModule === "profiles" && Boolean(profileDraft.name.trim()),
    retry: false,
  });
  const deploymentExecutorTargets = useQuery({
    queryKey: ["opsDeploymentExecutorTargets", profileDraft.name],
    queryFn: () => api.opsDeploymentExecutorTargets(profileDraft.name.trim()),
    enabled: Boolean(token) && activeModule === "profiles" && Boolean(profileDraft.name.trim()),
    retry: false,
  });
  const deploymentApprovals = useQuery({
    queryKey: ["opsDeploymentPackageApprovals", profileDraft.name],
    queryFn: () => api.opsDeploymentPackageApprovals({ profile: profileDraft.name.trim(), limit: 20 }),
    enabled: Boolean(token) && activeModule === "profiles" && Boolean(profileDraft.name.trim()),
    retry: false,
  });
  const deploymentCanaryPolicies = useQuery({
    queryKey: ["opsDeploymentCanaryPolicies", profileDraft.name],
    queryFn: () => api.opsDeploymentCanaryPolicies({ profile: profileDraft.name.trim(), limit: 20 }),
    enabled: Boolean(token) && activeModule === "profiles" && Boolean(profileDraft.name.trim()),
    retry: false,
  });
  const deploymentCanaryMetricSources = useQuery({
    queryKey: ["opsDeploymentCanaryMetricSources", profileDraft.name, deploymentCanaryDetail?.item?.id || ""],
    queryFn: () => api.opsDeploymentCanaryMetricSources({ profile: profileDraft.name.trim(), policy_id: deploymentCanaryDetail?.item?.id || "", limit: 20 }),
    enabled: Boolean(token) && activeModule === "profiles" && Boolean(profileDraft.name.trim()) && Boolean(deploymentCanaryDetail?.item?.id),
    retry: false,
  });
  const deploymentRollbackDrills = useQuery({
    queryKey: ["opsDeploymentRollbackDrills", profileDraft.name],
    queryFn: () => api.opsDeploymentRollbackDrills({ profile: profileDraft.name.trim(), limit: 20 }),
    enabled: Boolean(token) && activeModule === "profiles" && Boolean(profileDraft.name.trim()),
    retry: false,
  });
  const deploymentRollbackRunbooks = useQuery({
    queryKey: ["opsDeploymentRollbackRunbooks", profileDraft.name],
    queryFn: () => api.opsDeploymentRollbackRunbooks({ profile: profileDraft.name.trim(), limit: 20 }),
    enabled: Boolean(token) && activeModule === "profiles" && Boolean(profileDraft.name.trim()),
    retry: false,
  });
  const deploymentExecutionAudits = useQuery({
    queryKey: ["opsDeploymentExecutionAudits", profileDraft.name],
    queryFn: () => api.opsDeploymentExecutionAudits({ profile: profileDraft.name.trim(), limit: 20 }),
    enabled: Boolean(token) && activeModule === "profiles" && Boolean(profileDraft.name.trim()),
    retry: false,
  });
  const invoiceAudit = useQuery({
    queryKey: ["billingInvoiceAudit", auditInvoiceId],
    queryFn: () => api.billingInvoiceAudit(auditInvoiceId),
    enabled: Boolean(token) && activeModule === "billing" && Boolean(auditInvoiceId),
    retry: false,
  });
  const ssoScimAudit = useQuery({
    queryKey: ["ssoScimAudit", selectedSsoProvider],
    queryFn: () => api.ssoScimAudit(selectedSsoProvider, { limit: 50 }),
    enabled: Boolean(token) && activeModule === "sso" && Boolean(selectedSsoProvider) && selectedSsoProviderExists,
    retry: false,
  });
  const ssoRiskReport = useQuery({
    queryKey: ["ssoRiskReport", selectedSsoProvider],
    queryFn: () => api.ssoRiskReport(selectedSsoProvider),
    enabled: Boolean(token) && activeModule === "sso" && Boolean(selectedSsoProvider) && selectedSsoProviderExists,
    retry: false,
  });
  const ssoRiskSubscription = useQuery({
    queryKey: ["ssoRiskSubscription", selectedSsoProvider],
    queryFn: () => api.ssoRiskSubscription(selectedSsoProvider),
    enabled: Boolean(token) && activeModule === "sso" && Boolean(selectedSsoProvider) && selectedSsoProviderExists,
    retry: false,
  });
  const ssoRiskEscalation = useQuery({
    queryKey: ["ssoRiskEscalation", selectedSsoProvider],
    queryFn: () => api.ssoRiskEscalation(selectedSsoProvider),
    enabled: Boolean(token) && activeModule === "sso" && Boolean(selectedSsoProvider) && selectedSsoProviderExists,
    retry: false,
  });
  const ssoRiskRunbooks = useQuery({
    queryKey: ["ssoRiskRunbooks", selectedSsoProvider],
    queryFn: () => api.ssoRiskRunbooks(selectedSsoProvider, 20),
    enabled: Boolean(token) && activeModule === "sso" && Boolean(selectedSsoProvider) && selectedSsoProviderExists,
    retry: false,
  });

  useEffect(() => {
    const sync = () => setThemePref(getThemePreference());
    window.addEventListener("sop-theme", sync);
    return () => window.removeEventListener("sop-theme", sync);
  }, []);

  useEffect(() => {
    const sync = () => setActiveModule(readSettingsModuleFromHash());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    const subscription = ssoRiskSubscription.data?.subscription;
    if (!subscription) return;
    setSsoRiskSubscriptionDraft({
      enabled: Boolean(subscription.enabled),
      channels: Array.isArray(subscription.channels) ? subscription.channels : [],
      min_severity: String(subscription.min_severity || "medium"),
      score_threshold: String(subscription.score_threshold ?? 75),
      frequency: String(subscription.frequency || "daily"),
      include_low: Boolean(subscription.include_low),
      limit: String(subscription.limit ?? 6),
      owner: String(subscription.owner || "SecurityOps"),
      title: String(subscription.title || ""),
      force: false,
    });
  }, [ssoRiskSubscription.data?.subscription]);

  useEffect(() => {
    const policy = ssoRiskEscalation.data?.policy;
    if (!policy) return;
    setSsoRiskEscalationDraft({
      enabled: Boolean(policy.enabled),
      actions: Array.isArray(policy.actions) && policy.actions.length
        ? policy.actions.filter((action: string): action is SsoRiskEscalationAction => ssoRiskEscalationActions.includes(action as SsoRiskEscalationAction))
        : ["create_tasks"],
      channels: Array.isArray(policy.channels) ? policy.channels : [],
      min_severity: String(policy.min_severity || "high"),
      score_threshold: String(policy.score_threshold ?? 70),
      priority: String(policy.priority || "P1"),
      assigned_to: String(policy.assigned_to || "SecurityOps"),
      dev_tool: String(policy.dev_tool || "codex"),
      include_low: Boolean(policy.include_low),
      limit: String(policy.limit ?? 6),
      cooldown_minutes: String(policy.cooldown_minutes ?? 60),
      title: String(policy.title || ""),
      owner: String(policy.owner || "SecurityOps"),
      notes: String(policy.notes || ""),
      force: false,
    });
  }, [ssoRiskEscalation.data?.policy]);

  useEffect(() => {
    if (!billing.data) return;
    setPlanDraft(String(billing.data.subscription?.plan || "starter"));
    setBillingEmail(String(billing.data.subscription?.billing_email || me.data?.email || ""));
  }, [billing.data, me.data?.email]);

  useEffect(() => {
    const policy = billingOveragePolicy.data?.policy;
    if (!policy) return;
    setOverageDraft({
      mode: String(policy.mode || "approval_required"),
      grace_percent: String(policy.grace_percent ?? 5),
      approval_threshold_percent: String(policy.approval_threshold_percent ?? 100),
      invoice_due_days: String(policy.invoice_due_days ?? 14),
      suspend_after_days: String(policy.suspend_after_days ?? 30),
    });
  }, [billingOveragePolicy.data]);

  useEffect(() => {
    if (!token) {
      window.location.replace(`/login.html?redirect=${encodeURIComponent(currentRedirectTarget())}`);
    }
  }, [token]);

  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      clearSession();
      void qc.invalidateQueries();
      window.location.assign("/login.html");
    },
  });

  const updateBilling = useMutation({
    mutationFn: () =>
      api.billingUpdateSubscription({
        plan: planDraft,
        status: "active",
        billing_email: billingEmail,
        auto_apply_quota: true,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["billingSubscription"] });
      void qc.invalidateQueries({ queryKey: ["billingInvoice"] });
      void qc.invalidateQueries({ queryKey: ["usageSummary"] });
      void qc.invalidateQueries({ queryKey: ["usageQuota"] });
    },
  });

  const updateOveragePolicy = useMutation({
    mutationFn: () =>
      api.billingUpdateOveragePolicy({
        mode: overageDraft.mode,
        grace_percent: Number(overageDraft.grace_percent || 0),
        approval_threshold_percent: Number(overageDraft.approval_threshold_percent || 100),
        invoice_due_days: Number(overageDraft.invoice_due_days || 0),
        suspend_after_days: Number(overageDraft.suspend_after_days || 0),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["billingOveragePolicy"] });
      void qc.invalidateQueries({ queryKey: ["billingDunning"] });
    },
  });

  const checkEntitlement = useMutation({
    mutationFn: () =>
      api.billingEntitlementCheck({
        feature: entitlementDraft.feature,
        metric: entitlementDraft.metric,
        delta: Number(entitlementDraft.delta || 0),
        subject: entitlementDraft.subject,
      }),
    onSuccess: (data) => setEntitlementResult(data),
  });

  const snapshotInvoice = useMutation({
    mutationFn: () => api.billingSnapshotInvoice(String(invoice.data?.period || "")),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["billingInvoice"] });
      void qc.invalidateQueries({ queryKey: ["billingInvoices"] });
      void qc.invalidateQueries({ queryKey: ["billingInvoiceAudit"] });
    },
  });

  const updateInvoiceStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.billingUpdateInvoiceStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["billingInvoices"] });
      void qc.invalidateQueries({ queryKey: ["billingDunning"] });
      void qc.invalidateQueries({ queryKey: ["billingInvoiceAudit"] });
    },
  });

  const recordPayment = useMutation({
    mutationFn: () =>
      api.billingRecordPayment({
        invoice_id: paymentDraft.invoice_id,
        amount_usd: Number(paymentDraft.amount_usd || 0),
        method: paymentDraft.method,
        external_ref: paymentDraft.external_ref,
      }),
    onSuccess: () => {
      setPaymentDraft({ invoice_id: "", amount_usd: "", method: "manual", external_ref: "" });
      void qc.invalidateQueries({ queryKey: ["billingInvoices"] });
      void qc.invalidateQueries({ queryKey: ["billingPayments"] });
      void qc.invalidateQueries({ queryKey: ["billingAlerts"] });
      void qc.invalidateQueries({ queryKey: ["billingSummary"] });
      void qc.invalidateQueries({ queryKey: ["billingDunning"] });
      void qc.invalidateQueries({ queryKey: ["billingInvoiceAudit"] });
    },
  });

  const saveSso = useMutation({
    mutationFn: () => api.ssoUpsertProvider(ssoDraft.provider, {
      type: ssoDraft.type,
      issuer: ssoDraft.issuer,
      client_id: ssoDraft.client_id,
      client_secret: ssoDraft.client_secret,
      redirect_uri: ssoDraft.redirect_uri,
      scope: ssoDraft.scope,
      metadata_url: ssoDraft.metadata_url,
      sso_url: ssoDraft.sso_url,
      x509_cert: ssoDraft.x509_cert,
      name_id_format: ssoDraft.name_id_format,
      scim_enabled: ssoDraft.scim_enabled,
      tenant_domain_map: parseTextMap(ssoDraft.tenant_domain_map),
      role_map: parseTextMap(ssoDraft.role_map),
      enabled: ssoDraft.enabled,
    }),
    onSuccess: (data) => {
      setSsoDraft((v) => ({ ...v, client_secret: "" }));
      setSsoTestResult(data);
      void qc.invalidateQueries({ queryKey: ["ssoConfig"] });
      void qc.invalidateQueries({ queryKey: ["ssoScimAudit"] });
      void qc.invalidateQueries({ queryKey: ["ssoRiskReport"] });
    },
  });

  const deleteSso = useMutation({
    mutationFn: (provider: string) => api.ssoDeleteProvider(provider),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ssoConfig"] }),
  });

  const testSso = useMutation({
    mutationFn: (provider: string) => api.ssoTestProvider(provider),
    onSuccess: (data) => setSsoTestResult(data),
  });

  const previewSsoRole = useMutation({
    mutationFn: () =>
      api.ssoRolePreview(ssoDraft.provider, {
        email: ssoPreviewDraft.email,
        groups: splitTokens(ssoPreviewDraft.groups),
        tenant_domain_map: parseTextMap(ssoDraft.tenant_domain_map),
        role_map: parseTextMap(ssoDraft.role_map),
      }),
    onSuccess: (data) => setSsoPreviewResult(data),
  });

  const rotateScimToken = useMutation({
    mutationFn: () => api.ssoRotateScimToken(ssoDraft.provider, { enabled: ssoDraft.scim_enabled }),
    onSuccess: (data) => {
      setScimTokenResult(data);
      void qc.invalidateQueries({ queryKey: ["ssoConfig"] });
      void qc.invalidateQueries({ queryKey: ["ssoScimAudit"] });
      void qc.invalidateQueries({ queryKey: ["ssoRiskReport"] });
    },
  });

  const testScimUser = useMutation({
    mutationFn: () => api.ssoTestScimUser(ssoDraft.provider, {
      userName: scimTestDraft.userName,
      displayName: scimTestDraft.displayName,
      active: scimTestDraft.active,
      apply: scimTestDraft.apply,
      emails: [{ value: scimTestDraft.userName, primary: true, type: "work" }],
      groups: splitTokens(scimTestDraft.groups).map((value) => ({ display: value, value })),
    }),
    onSuccess: (data) => {
      setScimTestResult(data);
      void qc.invalidateQueries({ queryKey: ["ssoScimAudit"] });
      void qc.invalidateQueries({ queryKey: ["ssoRiskReport"] });
    },
  });

  const runSsoRiskTasks = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.ssoRiskTasks(ssoDraft.provider, {
        dry_run: dryRun,
        include_low: ssoRiskTaskDraft.include_low,
        limit: Number(ssoRiskTaskDraft.limit || 6),
        priority: ssoRiskTaskDraft.priority,
        assigned_to: ssoRiskTaskDraft.assigned_to,
        dev_tool: ssoRiskTaskDraft.dev_tool,
      }),
    onSuccess: (data, dryRun) => {
      setSsoRiskTaskResult(data);
      if (!dryRun) void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["ssoRiskReport"] });
    },
  });

  const runSsoRiskIm = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.ssoRiskImBriefing(ssoDraft.provider, {
        dry_run: dryRun,
        include_low: ssoRiskImDraft.include_low,
        limit: Number(ssoRiskImDraft.limit || 6),
        channels: ssoRiskImDraft.channels,
        event: "sso_risk",
        title: ssoRiskImDraft.title,
      }),
    onSuccess: (data, dryRun) => {
      setSsoRiskImResult(data);
      if (!dryRun) void qc.invalidateQueries({ queryKey: ["notifyMessages"] });
      void qc.invalidateQueries({ queryKey: ["ssoRiskReport"] });
    },
  });

  const saveSsoRiskSubscription = useMutation({
    mutationFn: () =>
      api.ssoUpsertRiskSubscription(ssoDraft.provider, {
        enabled: ssoRiskSubscriptionDraft.enabled,
        channels: ssoRiskSubscriptionDraft.channels,
        min_severity: ssoRiskSubscriptionDraft.min_severity,
        score_threshold: Number(ssoRiskSubscriptionDraft.score_threshold || 75),
        frequency: ssoRiskSubscriptionDraft.frequency,
        include_low: ssoRiskSubscriptionDraft.include_low,
        limit: Number(ssoRiskSubscriptionDraft.limit || 6),
        owner: ssoRiskSubscriptionDraft.owner,
        title: ssoRiskSubscriptionDraft.title,
        event: "sso_risk_subscription",
      }),
    onSuccess: (data) => {
      setSsoRiskSubscriptionResult(data);
      void qc.invalidateQueries({ queryKey: ["ssoRiskSubscription"] });
    },
  });

  const runSsoRiskSubscription = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.ssoTestRiskSubscription(ssoDraft.provider, {
        dry_run: dryRun,
        actor: ssoRiskSubscriptionDraft.owner || me.data?.username || me.data?.email || "security-admin",
        force: ssoRiskSubscriptionDraft.force,
      }),
    onSuccess: (data, dryRun) => {
      setSsoRiskSubscriptionResult(data);
      void qc.invalidateQueries({ queryKey: ["ssoRiskSubscription"] });
      void qc.invalidateQueries({ queryKey: ["ssoRiskReport"] });
      if (!dryRun) void qc.invalidateQueries({ queryKey: ["notifyMessages"] });
    },
  });

  const saveSsoRiskEscalation = useMutation({
    mutationFn: () =>
      api.ssoUpsertRiskEscalation(ssoDraft.provider, {
        enabled: ssoRiskEscalationDraft.enabled,
        min_severity: ssoRiskEscalationDraft.min_severity,
        score_threshold: Number(ssoRiskEscalationDraft.score_threshold || 70),
        actions: ssoRiskEscalationDraft.actions,
        channels: ssoRiskEscalationDraft.channels,
        priority: ssoRiskEscalationDraft.priority,
        assigned_to: ssoRiskEscalationDraft.assigned_to,
        dev_tool: ssoRiskEscalationDraft.dev_tool,
        include_low: ssoRiskEscalationDraft.include_low,
        limit: Number(ssoRiskEscalationDraft.limit || 6),
        cooldown_minutes: Number(ssoRiskEscalationDraft.cooldown_minutes || 0),
        title: ssoRiskEscalationDraft.title,
        owner: ssoRiskEscalationDraft.owner,
        notes: ssoRiskEscalationDraft.notes,
      }),
    onSuccess: (data) => {
      setSsoRiskEscalationResult(data);
      void qc.invalidateQueries({ queryKey: ["ssoRiskEscalation"] });
    },
  });

  const runSsoRiskEscalation = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.ssoRunRiskEscalation(ssoDraft.provider, {
        dry_run: dryRun,
        actor: ssoRiskEscalationDraft.owner || me.data?.username || me.data?.email || "security-admin",
        force: ssoRiskEscalationDraft.force,
      }),
    onSuccess: (data, dryRun) => {
      setSsoRiskEscalationResult(data);
      void qc.invalidateQueries({ queryKey: ["ssoRiskEscalation"] });
      void qc.invalidateQueries({ queryKey: ["ssoRiskReport"] });
      if (!dryRun) {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["notifyMessages"] });
      }
    },
  });

  const createSsoRiskRunbook = useMutation({
    mutationFn: () =>
      api.ssoCreateRiskRunbook(ssoDraft.provider, {
        include_low: ssoRiskRunbookDraft.include_low,
        limit: Number(ssoRiskRunbookDraft.limit || 6),
        priority: ssoRiskRunbookDraft.priority,
        assigned_to: ssoRiskRunbookDraft.assigned_to,
        dev_tool: ssoRiskRunbookDraft.dev_tool,
        owner: ssoRiskRunbookDraft.owner || me.data?.username || me.data?.email || "SecurityOps",
        channels: ssoRiskRunbookDraft.channels,
        title: ssoRiskRunbookDraft.title,
        notes: ssoRiskRunbookDraft.notes,
      }),
    onSuccess: (data) => {
      setSsoRiskRunbookDetail(data);
      void qc.invalidateQueries({ queryKey: ["ssoRiskRunbooks"] });
    },
  });

  const loadSsoRiskRunbook = useMutation({
    mutationFn: (runbookId: string) => api.ssoRiskRunbookDetail(ssoDraft.provider, runbookId),
    onSuccess: (data) => setSsoRiskRunbookDetail(data),
  });

  const applySsoRiskRunbookAction = useMutation({
    mutationFn: ({ action, dryRun = true, stepId = "" }: { action: string; dryRun?: boolean; stepId?: string }) =>
      api.ssoRiskRunbookAction(ssoDraft.provider, ssoRiskRunbookDetail?.item?.id || "", {
        action,
        dry_run: dryRun,
        step_id: stepId,
        actor: ssoRiskRunbookDraft.owner || me.data?.username || me.data?.email || "security-admin",
        note: ssoRiskRunbookDraft.notes,
        include_low: ssoRiskRunbookDraft.include_low,
        priority: ssoRiskRunbookDraft.priority,
        assigned_to: ssoRiskRunbookDraft.assigned_to,
        dev_tool: ssoRiskRunbookDraft.dev_tool,
        channels: ssoRiskRunbookDraft.channels,
        title: ssoRiskRunbookDraft.title,
      }),
    onSuccess: (data, vars) => {
      setSsoRiskRunbookDetail(data);
      void qc.invalidateQueries({ queryKey: ["ssoRiskRunbooks"] });
      void qc.invalidateQueries({ queryKey: ["ssoRiskReport"] });
      if (!vars.dryRun || vars.action === "mark_step_done" || vars.action === "mark_step_failed") {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["notifyMessages"] });
      }
    },
  });

  const saveProfile = useMutation({
    mutationFn: () => api.opsUpsertProfile(profileDraft.name, {
      name: profileDraft.name,
      mode: profileDraft.mode,
      database: profileDraft.database,
      manager_url: profileDraft.manager_url,
      public_url: profileDraft.public_url,
      features: parseBoolMap(profileDraft.features),
      env: parseEnvLines(profileDraft.env),
      notes: profileDraft.notes,
    }),
    onSuccess: () => {
      setProfileDrawerOpen(false);
      void qc.invalidateQueries({ queryKey: ["opsProfiles"] });
    },
  });

  const activateProfile = useMutation({
    mutationFn: (profile: string) => api.opsActivateProfile(profile),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsProfiles"] }),
  });

  const deleteProfile = useMutation({
    mutationFn: (profile: string) => api.opsDeleteProfile(profile),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsProfiles"] }),
  });

  const exportProfile = useMutation({
    mutationFn: (profile: string) => api.opsProfileEnv(profile),
    onSuccess: (data) => setProfileEnv(data),
  });

  const exportBundle = useMutation({
    mutationFn: (profile: string) => api.opsProfileBundle(profile),
    onSuccess: (data) => setProfileBundle(data),
  });

  const createDeploymentPackage = useMutation({
    mutationFn: () =>
      api.opsCreateDeploymentPackage(profileDraft.name, {
        version: deploymentPackageDraft.version,
        channel: deploymentPackageDraft.channel,
        release_notes: deploymentPackageDraft.release_notes,
        created_by: me.data?.username || me.data?.email || "ops-admin",
      }),
    onSuccess: (data) => {
      setDeploymentPackageDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPackages"] });
    },
  });

  const loadDeploymentPackage = useMutation({
    mutationFn: (packageId: string) => api.opsDeploymentPackageDetail(packageId),
    onSuccess: (data) => setDeploymentPackageDetail(data),
  });

  const selectedDeploymentPackageId = deploymentPipelineDraft.package_id || deploymentPackageDetail?.item?.id || deploymentPackages.data?.items?.[0]?.id || "";
  const selectedApprovalPackageId = deploymentApprovalDraft.package_id || deploymentPackageDetail?.item?.id || deploymentPackages.data?.items?.[0]?.id || "";
  const selectedCanaryPackageId = deploymentCanaryDraft.package_id || deploymentPackageDetail?.item?.id || deploymentPackages.data?.items?.[0]?.id || "";
  const selectedRollbackDrillPackageId = deploymentRollbackDrillDraft.package_id || deploymentPackageDetail?.item?.id || deploymentPackages.data?.items?.[0]?.id || "";
  const selectedRollbackRunbookPackageId = deploymentRollbackRunbookDraft.package_id || deploymentRollbackDrillDetail?.item?.package_id || deploymentPackageDetail?.item?.id || deploymentPackages.data?.items?.[0]?.id || "";
  const selectedCanaryPolicyId = deploymentCanaryMetricSourceDraft.policy_id || deploymentCanaryDetail?.item?.id || "";
  const selectedCanaryMetricSourceId = deploymentCanaryMetricSourceDetail?.item?.id || deploymentCanaryMetricSources.data?.items?.[0]?.id || "";
  const selectedExecutionAuditPackageId = deploymentExecutionAuditDraft.package_id || deploymentPipelineDetail?.item?.package_id || deploymentCanaryDetail?.item?.package_id || deploymentRollbackRunbookDetail?.item?.package_id || deploymentRollbackDrillDetail?.item?.package_id || deploymentPackageDetail?.item?.id || deploymentPackages.data?.items?.[0]?.id || "";
  const selectedExecutionAuditPipelineId = deploymentExecutionAuditDraft.pipeline_run_id || deploymentPipelineDetail?.item?.id || "";
  const selectedExecutionAuditCanaryId = deploymentExecutionAuditDraft.canary_policy_id || deploymentCanaryDetail?.item?.id || "";
  const selectedExecutionAuditDrillId = deploymentExecutionAuditDraft.rollback_drill_id || deploymentRollbackDrillDetail?.item?.id || "";
  const selectedExecutionAuditRunbookId = deploymentExecutionAuditDraft.rollback_runbook_id || deploymentRollbackRunbookDetail?.item?.id || "";

  const createDeploymentApproval = useMutation({
    mutationFn: () =>
      api.opsCreateDeploymentPackageApproval({
        package_id: selectedApprovalPackageId,
        environment: deploymentApprovalDraft.environment,
        requested_by: deploymentApprovalDraft.requested_by || me.data?.username || me.data?.email || "release-manager",
        reviewers: splitTokens(deploymentApprovalDraft.reviewers),
        policy: deploymentApprovalDraft.policy,
        notes: deploymentApprovalDraft.notes,
      }),
    onSuccess: (data) => {
      setDeploymentApprovalDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPackageApprovals"] });
    },
  });

  const loadDeploymentApproval = useMutation({
    mutationFn: (approvalId: string) => api.opsDeploymentPackageApprovalDetail(approvalId),
    onSuccess: (data) => setDeploymentApprovalDetail(data),
  });

  const applyDeploymentApprovalAction = useMutation({
    mutationFn: ({ approvalId, action }: { approvalId: string; action: string }) =>
      api.opsDeploymentPackageApprovalAction(approvalId, {
        action,
        actor: deploymentApprovalDraft.requested_by || me.data?.username || me.data?.email || "ops-admin",
        note: deploymentApprovalDraft.notes,
        create_pipeline: true,
      }),
    onSuccess: (data) => {
      setDeploymentApprovalDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPackageApprovals"] });
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPackages"] });
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelines"] });
    },
  });

  const createDeploymentCanaryPolicy = useMutation({
    mutationFn: () =>
      api.opsCreateDeploymentCanaryPolicy({
        package_id: selectedCanaryPackageId,
        name: deploymentCanaryDraft.name,
        environment: deploymentCanaryDraft.environment,
        strategy: deploymentCanaryDraft.strategy,
        traffic_steps: splitNumberTokens(deploymentCanaryDraft.traffic_steps),
        max_error_rate: Number(deploymentCanaryDraft.max_error_rate || 0.02),
        latency_p95_ms: Number(deploymentCanaryDraft.latency_p95_ms || 1000),
        min_observation_minutes: Number(deploymentCanaryDraft.min_observation_minutes || 10),
        auto_promote: deploymentCanaryDraft.auto_promote,
        created_by: deploymentCanaryDraft.created_by || me.data?.username || me.data?.email || "release-manager",
        notes: deploymentCanaryDraft.notes,
      }),
    onSuccess: (data) => {
      setDeploymentCanaryDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentCanaryPolicies"] });
    },
  });

  const loadDeploymentCanaryPolicy = useMutation({
    mutationFn: (policyId: string) => api.opsDeploymentCanaryPolicyDetail(policyId),
    onSuccess: (data) => setDeploymentCanaryDetail(data),
  });

  const applyDeploymentCanaryAction = useMutation({
    mutationFn: ({ policyId, action }: { policyId: string; action: string }) =>
      api.opsDeploymentCanaryPolicyAction(policyId, {
        action,
        actor: deploymentCanaryDraft.created_by || me.data?.username || me.data?.email || "ops-admin",
        note: deploymentCanaryDraft.notes,
        metrics: {
          error_rate: Number(deploymentCanaryDraft.error_rate || 0),
          latency_p95_ms: Number(deploymentCanaryDraft.observed_latency_p95_ms || 0),
        },
        create_pipeline: true,
      }),
    onSuccess: (data) => {
      setDeploymentCanaryDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentCanaryPolicies"] });
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPackages"] });
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelines"] });
    },
  });

  const createDeploymentCanaryMetricSource = useMutation({
    mutationFn: () =>
      api.opsCreateDeploymentCanaryMetricSource({
        policy_id: selectedCanaryPolicyId,
        name: deploymentCanaryMetricSourceDraft.name,
        source_type: deploymentCanaryMetricSourceDraft.source_type,
        endpoint: deploymentCanaryMetricSourceDraft.endpoint,
        error_rate_query: deploymentCanaryMetricSourceDraft.error_rate_query,
        latency_p95_query: deploymentCanaryMetricSourceDraft.latency_p95_query,
        window_minutes: Number(deploymentCanaryMetricSourceDraft.window_minutes || 10),
        enabled: deploymentCanaryMetricSourceDraft.enabled,
        sample_error_rate: Number(deploymentCanaryMetricSourceDraft.sample_error_rate || 0),
        sample_latency_p95_ms: Number(deploymentCanaryMetricSourceDraft.sample_latency_p95_ms || 0),
        labels: parseTextMap(deploymentCanaryMetricSourceDraft.labels),
        created_by: deploymentCanaryDraft.created_by || me.data?.username || me.data?.email || "release-manager",
        notes: deploymentCanaryMetricSourceDraft.notes,
      }),
    onSuccess: (data) => {
      setDeploymentCanaryMetricSourceDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentCanaryMetricSources"] });
    },
  });

  const loadDeploymentCanaryMetricSource = useMutation({
    mutationFn: (sourceId: string) => api.opsDeploymentCanaryMetricSourceDetail(sourceId),
    onSuccess: (data) => setDeploymentCanaryMetricSourceDetail(data),
  });

  const collectDeploymentCanaryMetrics = useMutation({
    mutationFn: ({ dryRun, applyToGate, advanceOnPass }: { dryRun: boolean; applyToGate: boolean; advanceOnPass: boolean }) =>
      api.opsDeploymentCanaryMetricCollection(selectedCanaryPolicyId, {
        dry_run: dryRun,
        source_id: selectedCanaryMetricSourceId,
        actor: deploymentCanaryDraft.created_by || me.data?.username || me.data?.email || "ops-admin",
        apply_to_gate: applyToGate,
        advance_on_pass: advanceOnPass,
      }),
    onSuccess: (data, vars) => {
      setDeploymentCanaryMetricResult(data);
      if (data?.policy || data?.item) setDeploymentCanaryDetail({ ok: true, item: data.item, policy: data.policy || deploymentCanaryDetail?.policy });
      void qc.invalidateQueries({ queryKey: ["opsDeploymentCanaryMetricSources"] });
      if (!vars.dryRun && vars.applyToGate) void qc.invalidateQueries({ queryKey: ["opsDeploymentCanaryPolicies"] });
    },
  });

  const runDeploymentCanaryIm = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.opsDeploymentCanaryPolicyImBriefing(deploymentCanaryDetail?.item?.id || "", {
        dry_run: dryRun,
        channels: deploymentCanaryImDraft.channels,
        event: "canary_risk",
        title: deploymentCanaryImDraft.title,
        limit: Number(deploymentCanaryImDraft.limit || 6),
      }),
    onSuccess: (data, dryRun) => {
      setDeploymentCanaryImResult(data);
      if (!dryRun) {
        void qc.invalidateQueries({ queryKey: ["opsDeploymentCanaryPolicies"] });
        void qc.invalidateQueries({ queryKey: ["notifyMessages"] });
      }
    },
  });

  const createDeploymentPipeline = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.opsCreateDeploymentPipeline({
        package_id: selectedDeploymentPackageId,
        profile: profileDraft.name,
        environment: deploymentPipelineDraft.environment,
        action: dryRun ? "preview" : deploymentPipelineDraft.action,
        operator: deploymentPipelineDraft.operator || me.data?.username || me.data?.email || "ops-admin",
        dry_run: dryRun,
        approval_required: deploymentPipelineDraft.approval_required,
        notes: deploymentPipelineDraft.notes,
      }),
    onSuccess: (data, dryRun) => {
      setDeploymentPipelineDetail(data);
      if (!dryRun) setDeploymentPipelineDrawerOpen(false);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelines"] });
    },
  });

  const loadDeploymentPipeline = useMutation({
    mutationFn: (runId: string) => api.opsDeploymentPipelineDetail(runId),
    onSuccess: (data) => setDeploymentPipelineDetail(data),
  });

  const applyDeploymentPipelineAction = useMutation({
    mutationFn: ({ runId, action }: { runId: string; action: string }) =>
      api.opsDeploymentPipelineAction(runId, {
        action,
        actor: deploymentPipelineDraft.operator || me.data?.username || me.data?.email || "ops-admin",
        message: deploymentPipelineDraft.notes,
      }),
    onSuccess: (data) => {
      setDeploymentPipelineDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelines"] });
    },
  });

  const executeDeploymentPipeline = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.opsDeploymentPipelineExecute(deploymentPipelineDetail?.item?.id || "", {
        executor_id: deploymentPipelineExecuteDraft.executor_id,
        command_id: deploymentPipelineExecuteDraft.command_id,
        stage_id: deploymentPipelineExecuteDraft.stage_id,
        actor: deploymentPipelineDraft.operator || me.data?.username || me.data?.email || "ops-admin",
        dry_run: dryRun,
        allow_apply: deploymentPipelineExecuteDraft.allow_apply,
        evidence_url: deploymentPipelineExecuteDraft.evidence_url,
        note: deploymentPipelineExecuteDraft.note || deploymentPipelineDraft.notes,
        timeout_seconds: Number(deploymentPipelineExecuteDraft.timeout_seconds || 30),
      }),
    onSuccess: (data) => {
      setDeploymentPipelineDetail(data);
      if (data.result?.id) {
        setDeploymentPipelineCallbackDraft((draft) => ({
          ...draft,
          execution_id: data.result.id,
          external_run_id: data.result.external_request?.id || draft.external_run_id,
          timestamp: String(Math.floor(Date.now() / 1000)),
          nonce: data.result.external_request?.id || draft.nonce,
        }));
      }
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelines"] });
    },
  });

  const callbackDeploymentPipelineExecution = useMutation({
    mutationFn: () =>
      api.opsDeploymentPipelineExecutionCallback(deploymentPipelineDetail?.item?.id || "", deploymentPipelineCallbackDraft.execution_id, {
        status: deploymentPipelineCallbackDraft.status,
        actor: deploymentPipelineDraft.operator || me.data?.username || me.data?.email || "external-orchestrator",
        external_run_id: deploymentPipelineCallbackDraft.external_run_id,
        timestamp: deploymentPipelineCallbackDraft.timestamp ? Number(deploymentPipelineCallbackDraft.timestamp) : null,
        nonce: deploymentPipelineCallbackDraft.nonce,
        signature: deploymentPipelineCallbackDraft.signature,
        evidence_url: deploymentPipelineCallbackDraft.evidence_url,
        stdout: deploymentPipelineCallbackDraft.stdout,
        stderr: deploymentPipelineCallbackDraft.stderr,
        exit_code: deploymentPipelineCallbackDraft.exit_code === "" ? null : Number(deploymentPipelineCallbackDraft.exit_code),
        note: deploymentPipelineCallbackDraft.note,
        metadata: parseTextMap(deploymentPipelineCallbackDraft.metadata),
      }),
    onSuccess: (data) => {
      setDeploymentPipelineDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelines"] });
    },
  });

  const saveDeploymentExecutorTarget = useMutation({
    mutationFn: () => {
      const body = {
        profile: profileDraft.name,
        name: deploymentExecutorTargetDraft.name,
        target_type: deploymentExecutorTargetDraft.target_type,
        endpoint: deploymentExecutorTargetDraft.endpoint,
        enabled: deploymentExecutorTargetDraft.enabled,
        supports: splitTokens(deploymentExecutorTargetDraft.supports),
        auth_ref: deploymentExecutorTargetDraft.auth_ref,
        callback_secret_ref: deploymentExecutorTargetDraft.callback_secret_ref,
        require_callback_signature: deploymentExecutorTargetDraft.require_callback_signature,
        callback_skew_seconds: Number(deploymentExecutorTargetDraft.callback_skew_seconds || 300),
        concurrency_limit: Number(deploymentExecutorTargetDraft.concurrency_limit || 1),
        timeout_seconds: Number(deploymentExecutorTargetDraft.timeout_seconds || 120),
        labels: parseTextMap(deploymentExecutorTargetDraft.labels),
        notes: deploymentExecutorTargetDraft.notes,
        actor: deploymentPipelineDraft.operator || me.data?.username || me.data?.email || "ops-admin",
      };
      return deploymentExecutorTargetDraft.id
        ? api.opsUpdateDeploymentExecutorTarget(deploymentExecutorTargetDraft.id, body)
        : api.opsCreateDeploymentExecutorTarget(body);
    },
    onSuccess: (data) => {
      const item = data.item || data.target || {};
      setDeploymentExecutorTargetDraft({
        id: item.id || "",
        name: item.name || "",
        target_type: item.target_type || "webhook",
        endpoint: item.endpoint || "",
        enabled: Boolean(item.enabled),
        supports: (item.supports || []).join(","),
        auth_ref: item.auth_ref || "",
        callback_secret_ref: item.callback_secret_ref || "",
        require_callback_signature: Boolean(item.require_callback_signature),
        callback_skew_seconds: String(item.callback_skew_seconds || 300),
        concurrency_limit: String(item.concurrency_limit || 1),
        timeout_seconds: String(item.timeout_seconds || 120),
        labels: mapToLines(item.labels),
        notes: item.notes || "",
      });
      setDeploymentPipelineExecuteDraft((draft) => ({ ...draft, executor_id: item.id || draft.executor_id }));
      void qc.invalidateQueries({ queryKey: ["opsDeploymentExecutorTargets"] });
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelineExecutors"] });
    },
  });

  const applyDeploymentExecutorTargetAction = useMutation({
    mutationFn: ({ targetId, action }: { targetId: string; action: string }) =>
      api.opsDeploymentExecutorTargetAction(targetId, {
        action,
        actor: deploymentPipelineDraft.operator || me.data?.username || me.data?.email || "ops-admin",
        note: deploymentExecutorTargetDraft.notes,
      }),
    onSuccess: (data, variables) => {
      if (variables.action !== "delete") {
        const item = data.item || {};
        setDeploymentExecutorTargetDraft({
          id: item.id || "",
          name: item.name || "",
          target_type: item.target_type || "webhook",
          endpoint: item.endpoint || "",
          enabled: Boolean(item.enabled),
          supports: (item.supports || []).join(","),
          auth_ref: item.auth_ref || "",
          callback_secret_ref: item.callback_secret_ref || "",
          require_callback_signature: Boolean(item.require_callback_signature),
          callback_skew_seconds: String(item.callback_skew_seconds || 300),
          concurrency_limit: String(item.concurrency_limit || 1),
          timeout_seconds: String(item.timeout_seconds || 120),
          labels: mapToLines(item.labels),
          notes: item.notes || "",
        });
      }
      void qc.invalidateQueries({ queryKey: ["opsDeploymentExecutorTargets"] });
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelineExecutors"] });
    },
  });

  const remediateDeploymentPipeline = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.opsDeploymentPipelineRemediation(deploymentPipelineDetail?.item?.id || "", {
        dry_run: dryRun,
        include_low: deploymentPipelineRemediationDraft.include_low,
        priority: deploymentPipelineRemediationDraft.priority,
        assigned_to: deploymentPipelineRemediationDraft.assigned_to,
        dev_tool: deploymentPipelineRemediationDraft.dev_tool,
        actor: deploymentPipelineDraft.operator || me.data?.username || me.data?.email || "ops-admin",
        note: deploymentPipelineRemediationDraft.note || deploymentPipelineDraft.notes,
      }),
    onSuccess: (data, dryRun) => {
      setDeploymentPipelineDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelines"] });
      if (!dryRun) void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const createDeploymentRollbackDrill = useMutation({
    mutationFn: () =>
      api.opsCreateDeploymentRollbackDrill({
        package_id: selectedRollbackDrillPackageId,
        profile: profileDraft.name,
        name: deploymentRollbackDrillDraft.name,
        environment: deploymentRollbackDrillDraft.environment,
        scenario: deploymentRollbackDrillDraft.scenario,
        operator: deploymentRollbackDrillDraft.operator || me.data?.username || me.data?.email || "release-manager",
        approval_required: deploymentRollbackDrillDraft.approval_required,
        create_pipeline: deploymentRollbackDrillDraft.create_pipeline,
        notes: deploymentRollbackDrillDraft.notes,
      }),
    onSuccess: (data) => {
      setDeploymentRollbackDrillDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentRollbackDrills"] });
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelines"] });
    },
  });

  const loadDeploymentRollbackDrill = useMutation({
    mutationFn: (drillId: string) => api.opsDeploymentRollbackDrillDetail(drillId),
    onSuccess: (data) => setDeploymentRollbackDrillDetail(data),
  });

  const applyDeploymentRollbackDrillAction = useMutation({
    mutationFn: ({ drillId, action, checkId = "" }: { drillId: string; action: string; checkId?: string }) =>
      api.opsDeploymentRollbackDrillAction(drillId, {
        action,
        actor: deploymentRollbackDrillDraft.operator || me.data?.username || me.data?.email || "ops-admin",
        note: deploymentRollbackDrillDraft.notes,
        check_id: checkId,
        create_pipeline: true,
      }),
    onSuccess: (data) => {
      setDeploymentRollbackDrillDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentRollbackDrills"] });
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelines"] });
    },
  });

  const createDeploymentRollbackRunbook = useMutation({
    mutationFn: () =>
      api.opsCreateDeploymentRollbackRunbook({
        package_id: selectedRollbackRunbookPackageId,
        profile: profileDraft.name,
        drill_id: deploymentRollbackRunbookDraft.drill_id || deploymentRollbackDrillDetail?.item?.id || "",
        name: deploymentRollbackRunbookDraft.name,
        environment: deploymentRollbackRunbookDraft.environment,
        trigger: deploymentRollbackRunbookDraft.trigger,
        operator: deploymentRollbackRunbookDraft.operator || me.data?.username || me.data?.email || "release-manager",
        approval_required: deploymentRollbackRunbookDraft.approval_required,
        create_preview_pipeline: deploymentRollbackRunbookDraft.create_preview_pipeline,
        task_priority: deploymentRollbackRunbookDraft.task_priority,
        assigned_to: deploymentRollbackRunbookDraft.assigned_to,
        dev_tool: deploymentRollbackRunbookDraft.dev_tool,
        notes: deploymentRollbackRunbookDraft.notes,
      }),
    onSuccess: (data) => {
      setDeploymentRollbackRunbookDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentRollbackRunbooks"] });
      void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelines"] });
    },
  });

  const loadDeploymentRollbackRunbook = useMutation({
    mutationFn: (runbookId: string) => api.opsDeploymentRollbackRunbookDetail(runbookId),
    onSuccess: (data) => setDeploymentRollbackRunbookDetail(data),
  });

  const applyDeploymentRollbackRunbookAction = useMutation({
    mutationFn: ({ runbookId, action, dryRun = true }: { runbookId: string; action: string; dryRun?: boolean }) =>
      api.opsDeploymentRollbackRunbookAction(runbookId, {
        action,
        dry_run: dryRun,
        actor: deploymentRollbackRunbookDraft.operator || me.data?.username || me.data?.email || "ops-admin",
        note: deploymentRollbackRunbookDraft.notes,
        priority: deploymentRollbackRunbookDraft.task_priority,
        assigned_to: deploymentRollbackRunbookDraft.assigned_to,
        dev_tool: deploymentRollbackRunbookDraft.dev_tool,
      }),
    onSuccess: (data, vars) => {
      setDeploymentRollbackRunbookDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentRollbackRunbooks"] });
      if (vars.action === "create_pipeline") void qc.invalidateQueries({ queryKey: ["opsDeploymentPipelines"] });
      if (vars.action === "create_tasks" && !vars.dryRun) void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const createDeploymentExecutionAudit = useMutation({
    mutationFn: () =>
      api.opsCreateDeploymentExecutionAudit({
        package_id: selectedExecutionAuditPackageId,
        profile: profileDraft.name,
        pipeline_run_id: selectedExecutionAuditPipelineId,
        canary_policy_id: selectedExecutionAuditCanaryId,
        rollback_drill_id: selectedExecutionAuditDrillId,
        rollback_runbook_id: selectedExecutionAuditRunbookId,
        environment: deploymentExecutionAuditDraft.environment,
        action: deploymentExecutionAuditDraft.action,
        status: deploymentExecutionAuditDraft.status,
        actor: deploymentExecutionAuditDraft.actor || me.data?.username || me.data?.email || "release-manager",
        change_ticket: deploymentExecutionAuditDraft.change_ticket,
        evidence_url: deploymentExecutionAuditDraft.evidence_url,
        risk_level: deploymentExecutionAuditDraft.risk_level,
        notes: deploymentExecutionAuditDraft.notes,
        metadata: parseTextMap(deploymentExecutionAuditDraft.metadata),
      }),
    onSuccess: (data) => {
      setDeploymentExecutionAuditDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentExecutionAudits"] });
    },
  });

  const loadDeploymentExecutionAudit = useMutation({
    mutationFn: (auditId: string) => api.opsDeploymentExecutionAuditDetail(auditId),
    onSuccess: (data) => setDeploymentExecutionAuditDetail(data),
  });

  const createDeploymentExecutionAuditTasks = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.opsDeploymentExecutionAuditTasks(deploymentExecutionAuditDetail?.item?.id || "", {
        dry_run: dryRun,
        priority: deploymentExecutionAuditDraft.priority,
        assigned_to: deploymentExecutionAuditDraft.assigned_to,
        dev_tool: deploymentExecutionAuditDraft.dev_tool,
        include_low: deploymentExecutionAuditDraft.include_low,
      }),
    onSuccess: (data, dryRun) => {
      setDeploymentExecutionAuditDetail(data);
      void qc.invalidateQueries({ queryKey: ["opsDeploymentExecutionAudits"] });
      if (!dryRun) void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const runStorageSmoke = useMutation({
    mutationFn: api.opsStorageMigrationSmoke,
    onSuccess: (data) => setStorageSmokeResult(data),
  });

  if (!token) return null;

  const tenantLabel = me.data?.tenant_name || me.data?.tenant_slug || me.data?.tenant_id || "-";
  const healthOk = health.data?.ok === true;
  const modules: Array<{ id: SettingsModule; title: string; desc: string; icon: ReactNode; tone?: "ok" | "warn" | "danger" }> = [
    { id: "account", title: t("page.settings.moduleAccount"), desc: t("page.settings.moduleAccountDesc"), icon: <ShieldCheck className="h-5 w-5" />, tone: me.isError ? "danger" : "ok" },
    { id: "runtime", title: t("page.settings.moduleRuntime"), desc: t("page.settings.moduleRuntimeDesc"), icon: <ServerCog className="h-5 w-5" />, tone: healthOk ? "ok" : health.isError ? "danger" : "warn" },
    { id: "observability", title: t("page.settings.moduleObservability"), desc: t("page.settings.moduleObservabilityDesc"), icon: <Activity className="h-5 w-5" />, tone: opsObservability.isError ? "danger" : opsObservability.data?.doctor?.failed ? "warn" : "ok" },
    { id: "workspace", title: t("page.settings.moduleWorkspace"), desc: t("page.settings.moduleWorkspaceDesc"), icon: <ExternalLink className="h-5 w-5" /> },
    { id: "profiles", title: t("page.settings.moduleProfiles"), desc: t("page.settings.moduleProfilesDesc"), icon: <CloudCog className="h-5 w-5" />, tone: opsProfiles.data?.doctor?.ok ? "ok" : opsProfiles.isError ? "danger" : "warn" },
    { id: "storage", title: t("page.settings.moduleStorage"), desc: t("page.settings.moduleStorageDesc"), icon: <Database className="h-5 w-5" />, tone: opsStorageMigrationPlan.data?.ok ? "ok" : opsStorageMigrationPlan.isError ? "danger" : "warn" },
    { id: "sso", title: t("page.settings.moduleSso"), desc: t("page.settings.moduleSsoDesc"), icon: <KeyRound className="h-5 w-5" />, tone: ssoConfig.data?.enabled ? "ok" : ssoConfig.isError ? "danger" : "warn" },
    { id: "appearance", title: t("page.settings.moduleAppearance"), desc: t("page.settings.moduleAppearanceDesc"), icon: <Palette className="h-5 w-5" /> },
    { id: "billing", title: t("page.settings.moduleBilling"), desc: t("page.settings.moduleBillingDesc"), icon: <BadgeDollarSign className="h-5 w-5" />, tone: billingAlerts.data?.total ? "warn" : billing.isError ? "danger" : "ok" },
  ];

  return (
    <div className="w-full space-y-5">
      <SettingsWorkbenchHeader />
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 xl:hidden">
        <label className="text-xs font-semibold text-[var(--muted)]" htmlFor="settings-mobile-module">
          {t("page.settings.mobileModule")}
        </label>
        <select
          id="settings-mobile-module"
          className={`${inputClass} mt-2`}
          value={activeModule}
          onChange={(event) => {
            const next = event.target.value as SettingsModule;
            setActiveModule(next);
            window.location.hash = settingsModuleHref(next);
          }}
        >
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </div>
      <div className="grid w-full gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="hidden min-w-0 xl:sticky xl:top-4 xl:block xl:self-start">
        <Card title={t("page.settings.systemCard")}>
          <div className="space-y-2">
            {modules.map((m) => (
              <a
                key={m.id}
                href={settingsModuleHref(m.id)}
                aria-current={activeModule === m.id ? "page" : undefined}
                onClick={() => setActiveModule(m.id)}
                className={`flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                  activeModule === m.id
                    ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">{m.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{m.title}</span>
                    {m.tone ? <ModuleDot tone={m.tone} /> : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{m.desc}</span>
                </span>
              </a>
            ))}
          </div>
        </Card>
      </aside>

      <section className="min-w-0 space-y-5">
      {activeModule === "account" ? (
        <Card
          title={t("page.settings.accountCard")}
          actions={<StatusPill tone={me.isError ? "danger" : "ok"} label={me.isError ? t("page.settings.sessionError") : t("auth.secure")} />}
        >
          <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  <ShieldCheck className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-[var(--text)]">{me.data?.username || t("auth.account")}</p>
                  <p className="truncate text-xs text-[var(--muted)]">{me.data?.email || me.data?.role || t("auth.loggedIn")}</p>
                </div>
              </div>
              <button
                type="button"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] shadow-sm hover:bg-[var(--surface-muted)] disabled:opacity-50"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                <LogOut className="h-4 w-4 text-[var(--brand)]" />
                {t("auth.logout")}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Info label={t("auth.status")} value={t("auth.loggedIn")} />
              <Info label={t("auth.role")} value={me.data?.role || "-"} />
              <Info label={t("auth.tenant")} value={tenantLabel} />
              <Info label={t("auth.project")} value={projectId || "-"} />
            </div>
          </div>
          {me.isError ? <ErrorLine message={(me.error as Error).message} /> : null}
          {!projectId ? <HintLine message={t("auth.noProject")} /> : null}
        </Card>
      ) : null}

      {opsModuleActive ? (
        <Card
          title={activeModule === "observability" ? t("page.settings.logsTitle") : t("page.settings.runtimeCard")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]"
                onClick={() => {
                  void health.refetch();
                  void opsObservability.refetch();
                  void opsLogs.refetch();
                  void opsTraceSummary.refetch();
                }}
              >
                {t("common.refresh")}
              </button>
              <StatusPill tone={healthOk ? "ok" : health.isError ? "danger" : "warn"} label={healthOk ? "OK" : health.isError ? "ERR" : "..."} />
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Info label={t("page.settings.manager")} value={healthOk ? "online" : health.isError ? "error" : t("common.loading")} />
            <Info label={t("page.settings.version")} value={String(health.data?.version ?? "-")} />
            <Info label={t("page.settings.apiBase")} value={window.location.origin} />
          </div>
          {health.isError ? <ErrorLine message={(health.error as Error).message} /> : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SettingLink href="/api/v1/health" icon={<ServerCog className="h-5 w-5" />} title={t("page.settings.healthTitle")} body={t("page.settings.healthDesc")} external />
            <SettingLink href="/metrics" icon={<SlidersHorizontal className="h-5 w-5" />} title={t("page.settings.metricsTitle")} body={t("page.settings.metricsDesc")} external />
            <SettingLink href="/api/v1/events" icon={<Activity className="h-5 w-5" />} title={t("page.settings.eventsTitle")} body={t("page.settings.eventsDesc")} external />
            <SettingLink href="/api/v1/system/ops/observability" icon={<FileText className="h-5 w-5" />} title={t("page.settings.logsTitle")} body={t("page.settings.logsDesc")} external />
          </div>
          <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.traceCard")}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.settings.traceDesc")}</p>
              </div>
              <StatusPill tone={opsTraceSummary.data?.root_cause?.risk_level === "high" ? "danger" : opsTraceSummary.data?.root_cause?.risk_level === "medium" ? "warn" : "ok"} label={String(opsTraceSummary.data?.root_cause?.risk_level || "trace")} />
            </div>
            <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_6rem]">
              <input className={inputClass} value={traceFilter.run_id} onChange={(e) => setTraceFilter({ ...traceFilter, run_id: e.target.value })} placeholder={t("page.settings.traceRunPh")} />
              <input className={inputClass} value={traceFilter.trace_id} onChange={(e) => setTraceFilter({ ...traceFilter, trace_id: e.target.value })} placeholder={t("page.settings.traceIdPh")} />
              <input className={inputClass} value={traceFilter.correlation_id} onChange={(e) => setTraceFilter({ ...traceFilter, correlation_id: e.target.value })} placeholder={t("page.settings.correlationPh")} />
              <input className={inputClass} value={traceFilter.limit} onChange={(e) => setTraceFilter({ ...traceFilter, limit: e.target.value })} inputMode="numeric" />
              <button type="button" className="rounded-xl bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={opsTraceSummary.isFetching} onClick={() => void opsTraceSummary.refetch()}>
                {t("common.search")}
              </button>
            </div>
            {opsTraceSummary.isError ? <ErrorLine message={(opsTraceSummary.error as Error).message} /> : null}
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <MetricBox label={t("page.settings.traceFailedRuns")} value={opsTraceSummary.data?.summary?.failed_runs ?? 0} />
              <MetricBox label={t("page.settings.traceSlowLlm")} value={opsTraceSummary.data?.summary?.slow_llm_calls ?? 0} />
              <MetricBox label={t("page.settings.traceDataJobs")} value={opsTraceSummary.data?.summary?.data_jobs ?? 0} />
              <MetricBox label={t("page.settings.traceAudit")} value={opsTraceSummary.data?.summary?.audit_entries ?? 0} />
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                {(opsTraceSummary.data?.root_cause_navigation || []).map((node: any) => (
                  <a key={`${node.type}-${node.id}`} href={node.link || "#"} className="grid grid-cols-[7rem_minmax(0,1fr)_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs last:border-0 hover:bg-[var(--surface-muted)]">
                    <span className="font-mono text-[var(--brand)]">{node.type}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-[var(--text)]">{node.title}</span>
                      <span className="mt-1 block truncate text-[var(--muted)]">{node.detail || node.timestamp || node.id}</span>
                    </span>
                    <span className="text-right text-[var(--muted-strong)]">{node.status || "-"}</span>
                  </a>
                ))}
                {!opsTraceSummary.data?.root_cause_navigation?.length ? <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.traceEmpty")}</div> : null}
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.traceRootCause")}</p>
                <div className="mt-3 space-y-2">
                  {(opsTraceSummary.data?.root_cause?.likely_causes || []).map((cause: string) => (
                    <p key={cause} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted-strong)]">{cause}</p>
                  ))}
                  {!opsTraceSummary.data?.root_cause?.likely_causes?.length ? <p className="text-xs text-[var(--muted)]">{t("page.settings.traceNoCause")}</p> : null}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <MetricBox label={t("page.settings.logFiles")} value={opsObservability.data?.logs?.length ?? 0} />
                <MetricBox label={t("page.settings.eventTotal")} value={opsObservability.data?.events?.total ?? 0} />
                <MetricBox label={t("page.settings.doctorFailed")} value={opsObservability.data?.doctor?.failed ?? 0} />
                <MetricBox label={t("page.settings.logReturned")} value={opsLogs.data?.total ?? 0} />
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-40 flex-1 text-xs font-medium text-[var(--muted)]">
                    {t("page.settings.logFile")}
                    <select className={`${inputClass} mt-1`} value={logFilter.name} onChange={(e) => setLogFilter({ ...logFilter, name: e.target.value })}>
                      {(opsObservability.data?.logs || [{ name: "sop.app.log" }]).map((log: any) => (
                        <option key={log.name} value={log.name}>{log.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="w-28 text-xs font-medium text-[var(--muted)]">
                    {t("page.settings.level")}
                    <select className={`${inputClass} mt-1`} value={logFilter.level} onChange={(e) => setLogFilter({ ...logFilter, level: e.target.value })}>
                      <option value="">{t("page.settings.allLevels")}</option>
                      {["INFO", "WARNING", "ERROR", "DEBUG"].map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                    </select>
                  </label>
                  <label className="w-24 text-xs font-medium text-[var(--muted)]">
                    {t("page.settings.limit")}
                    <input className={`${inputClass} mt-1`} value={logFilter.limit} onChange={(e) => setLogFilter({ ...logFilter, limit: e.target.value })} inputMode="numeric" />
                  </label>
                  <label className="min-w-56 flex-1 text-xs font-medium text-[var(--muted)]">
                    {t("common.search")}
                    <input className={`${inputClass} mt-1`} value={logFilter.q} onChange={(e) => setLogFilter({ ...logFilter, q: e.target.value })} placeholder={t("page.settings.logSearchPh")} />
                  </label>
                </div>
                {opsLogs.isError ? <ErrorLine message={(opsLogs.error as Error).message} /> : null}
                <div className="mt-4 max-h-[34rem] overflow-auto rounded-xl border border-[var(--border)] bg-slate-950">
                  {(opsLogs.data?.items || []).map((row: any, idx: number) => (
                    <div key={`${row.ts}-${idx}`} className="grid grid-cols-[8.5rem_5.5rem_minmax(0,1fr)] gap-3 border-b border-slate-800 px-3 py-2 text-xs last:border-0">
                      <span className="font-mono text-slate-500">{row.ts || "-"}</span>
                      <span className={logLevelClass(row.level)}>{row.level || "-"}</span>
                      <span className="whitespace-pre-wrap break-words font-mono text-slate-200">{row.message || row.raw}</span>
                    </div>
                  ))}
                  {!opsLogs.data?.items?.length ? <div className="px-4 py-8 text-sm text-slate-400">{t("page.settings.noLogs")}</div> : null}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.logFiles")}</p>
                <div className="mt-3 space-y-2">
                  {(opsObservability.data?.logs || []).map((log: any) => (
                    <button key={log.name} type="button" className="w-full rounded-xl border border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--surface-muted)]" onClick={() => setLogFilter({ ...logFilter, name: log.name })}>
                      <span className="block text-sm font-medium text-[var(--text)]">{log.name}</span>
                      <span className="block truncate text-xs text-[var(--muted)]">{formatBytes(log.size)} · {log.updated_at}</span>
                    </button>
                  ))}
                  {!opsObservability.data?.logs?.length ? <p className="text-sm text-[var(--muted)]">{t("page.settings.noLogs")}</p> : null}
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.eventTypes")}</p>
                <div className="mt-3 space-y-2">
                  {Object.entries(opsObservability.data?.events?.by_action || {}).map(([action, count]) => (
                    <div key={action} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-xs">
                      <span className="truncate font-mono text-[var(--muted-strong)]">{action}</span>
                      <span className="font-semibold text-[var(--text)]">{String(count)}</span>
                    </div>
                  ))}
                  {!Object.keys(opsObservability.data?.events?.by_action || {}).length ? <p className="text-sm text-[var(--muted)]">{t("page.settings.noEvents")}</p> : null}
                </div>
              </div>
              {opsObservability.isError ? <ErrorLine message={(opsObservability.error as Error).message} /> : null}
              <p className="break-all text-xs text-[var(--muted)]">{opsObservability.data?.log_dir || ""}</p>
            </div>
          </div>
        </Card>
      ) : null}

      {activeModule === "workspace" ? (
        <Card title={t("page.settings.workspaceCard")}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SettingLink href="#/organization" icon={<UsersRound className="h-5 w-5" />} title={t("page.settings.orgTitle")} body={t("page.settings.orgDesc")} />
            <SettingLink href="#/intelligence" icon={<Database className="h-5 w-5" />} title={t("page.settings.dbTitle")} body={t("page.settings.dbDesc")} />
            <SettingLink href="#/vibe" icon={<Terminal className="h-5 w-5" />} title={t("page.settings.vibeTitle")} body={t("page.settings.vibeDesc")} />
            <SettingLink href="#/orchestration" icon={<Network className="h-5 w-5" />} title={t("page.settings.orchestrationTitle")} body={t("page.settings.orchestrationDesc")} />
            <SettingLink href="#/search" icon={<Search className="h-5 w-5" />} title={t("page.settings.searchTitle")} body={t("page.settings.searchDesc")} />
            <SettingLink href="/login.html" icon={<ShieldCheck className="h-5 w-5" />} title={t("page.settings.loginTitle")} body={t("page.settings.loginDesc")} external />
          </div>
        </Card>
      ) : null}

      {activeModule === "profiles" ? (
        <>
        <Card
          title={t("page.settings.profilesCard")}
          actions={<StatusPill tone={opsProfiles.data?.doctor?.ok ? "ok" : opsProfiles.isError ? "danger" : "warn"} label={opsProfiles.data?.active || "..."} />}
        >
          <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  <CloudCog className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.profileEdit")}</p>
                  <p className="text-xs text-[var(--muted)]">{t("page.settings.profileDesc")}</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <div className="grid gap-3">
                  <Info label={t("page.settings.profile")} value={profileDraft.name || "-"} />
                  <Info label={t("page.settings.mode")} value={profileDraft.mode || "-"} />
                  <Info label={t("page.settings.database")} value={profileDraft.database || "-"} />
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.profileQuickSummary", { defaultValue: "当前草稿" })}</p>
                  <p className="mt-1 break-all text-xs text-[var(--muted)]">{profileDraft.manager_url || profileDraft.public_url || profileDraft.notes || t("page.settings.profileDesc")}</p>
                </div>
                <Button block type="primary" icon={<CloudCog className="h-4 w-4" />} onClick={() => setProfileDrawerOpen(true)}>
                  {t("page.settings.profileEdit")}
                </Button>
                {saveProfile.error ? <ErrorLine message={(saveProfile.error as Error).message} /> : null}
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                {(opsProfiles.data?.doctor?.checks || []).map((check: any) => (
                  <div key={check.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <StatusPill tone={check.ok ? "ok" : "warn"} label={check.ok ? "OK" : "WARN"} />
                    <p className="mt-3 text-sm font-semibold text-[var(--text)]">{check.id}</p>
                    <p className="mt-1 truncate text-xs text-[var(--muted)]">{check.message}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {(opsProfiles.data?.templates || []).map((tpl: any) => (
                  <button
                    key={tpl.name}
                    type="button"
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]"
                    onClick={() => {
                      setProfileDraft(profileToDraft(tpl));
                      setProfileDrawerOpen(true);
                    }}
                  >
                    <span className="text-sm font-semibold text-[var(--text)]">{tpl.name}</span>
                    <span className="mt-1 block text-xs text-[var(--muted)]">{tpl.notes}</span>
                  </button>
                ))}
              </div>
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="grid grid-cols-[1fr_6rem_7rem_11rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
                  <span>{t("page.settings.profile")}</span>
                  <span>{t("page.settings.mode")}</span>
                  <span>{t("page.settings.database")}</span>
                  <span>{t("page.settings.actions")}</span>
                </div>
                {(opsProfiles.data?.items || []).map((row: any) => (
                  <div key={row.name} className="grid grid-cols-[1fr_6rem_7rem_11rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => {
                        setProfileDraft(profileToDraft(row));
                        setProfileDrawerOpen(true);
                      }}
                    >
                      <span className="block truncate text-sm font-semibold text-[var(--text)]">{row.name}</span>
                      <span className="block truncate text-xs text-[var(--muted)]">{row.manager_url || row.public_url || row.notes}</span>
                    </button>
                    <span className="text-xs text-[var(--muted-strong)]">{row.mode}</span>
                    <span className="text-xs text-[var(--muted-strong)]">{row.database}</span>
                    <span className="flex flex-wrap gap-2 text-xs">
                      <button className="text-[var(--brand)] disabled:opacity-50" disabled={activateProfile.isPending || row.active} onClick={() => activateProfile.mutate(row.name)}>{row.active ? t("page.settings.active") : t("page.settings.activate")}</button>
                      <button className="text-[var(--brand)] disabled:opacity-50" disabled={exportProfile.isPending} onClick={() => exportProfile.mutate(row.name)}>{t("page.settings.exportEnv")}</button>
                      <button className="text-[var(--brand)] disabled:opacity-50" disabled={exportBundle.isPending} onClick={() => exportBundle.mutate(row.name)}>{t("page.settings.exportBundle")}</button>
                      <button className="text-rose-600 disabled:opacity-50" disabled={deleteProfile.isPending || ["local-dev", "saas-pg", "private-oceanbase"].includes(row.name)} onClick={() => deleteProfile.mutate(row.name)}>{t("common.delete")}</button>
                    </span>
                  </div>
                ))}
              </div>
              {profileEnv ? <pre className="max-h-56 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">{profileEnv.shell}</pre> : null}
              {profileBundle ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.deployBundle")}</p>
                      <p className="mt-1 break-all text-xs text-[var(--muted)]">{profileBundle.dir}</p>
                    </div>
                    <a className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]" href={api.opsProfileComposeUrl(profileBundle.profile)} target="_blank" rel="noreferrer">
                      {t("page.settings.downloadCompose")}
                    </a>
                  </div>
                  <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{profileBundle.compose}</pre>
                </div>
              ) : null}
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <PackageCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.deployPackageVersions")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.deployPackageVersionsDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentPackages.isFetching}
                    onClick={() => void deploymentPackages.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[9rem_9rem_minmax(0,1fr)_8rem]">
                  <input
                    className={inputClass}
                    value={deploymentPackageDraft.version}
                    onChange={(e) => setDeploymentPackageDraft({ ...deploymentPackageDraft, version: e.target.value })}
                    placeholder={t("page.settings.deployPackageVersion")}
                  />
                  <select className={inputClass} value={deploymentPackageDraft.channel} onChange={(e) => setDeploymentPackageDraft({ ...deploymentPackageDraft, channel: e.target.value })}>
                    {["manual", "staging", "production", "rollback"].map((channel) => <option key={channel} value={channel}>{channel}</option>)}
                  </select>
                  <input
                    className={inputClass}
                    value={deploymentPackageDraft.release_notes}
                    onChange={(e) => setDeploymentPackageDraft({ ...deploymentPackageDraft, release_notes: e.target.value })}
                    placeholder={t("page.settings.deployPackageNotes")}
                  />
                  <button
                    type="button"
                    className="rounded-xl bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    disabled={createDeploymentPackage.isPending || !profileDraft.name.trim()}
                    onClick={() => createDeploymentPackage.mutate()}
                  >
                    {t("page.settings.deployPackageCreate")}
                  </button>
                </div>
                {createDeploymentPackage.error ? <ErrorLine message={(createDeploymentPackage.error as Error).message} /> : null}
                {deploymentPackages.error ? <ErrorLine message={(deploymentPackages.error as Error).message} /> : null}
                <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
                  <div className="grid grid-cols-[1fr_6rem_7rem_8rem] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                    <span>{t("page.settings.deployPackage")}</span>
                    <span>{t("page.settings.deployPackageChannel")}</span>
                    <span>{t("page.settings.deployPackageFiles")}</span>
                    <span>{t("page.settings.actions")}</span>
                  </div>
                  {(deploymentPackages.data?.items || []).map((item: any) => (
                    <div key={item.id} className="grid grid-cols-[1fr_6rem_7rem_8rem] gap-3 border-b border-[var(--border)] px-3 py-2 text-xs last:border-0">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[var(--text)]">{item.version}</p>
                        <p className="truncate font-mono text-[11px] text-[var(--muted)]">{item.id}</p>
                      </div>
                      <span className="font-mono text-[var(--muted-strong)]">{item.channel}</span>
                      <span className="font-mono text-[var(--muted-strong)]">{item.file_count}</span>
                      <button
                        type="button"
                        className="text-left text-[var(--brand)] disabled:opacity-50"
                        disabled={loadDeploymentPackage.isPending}
                        onClick={() => loadDeploymentPackage.mutate(item.id)}
                      >
                        {t("page.settings.deployPackageInspect")}
                      </button>
                    </div>
                  ))}
                  {!deploymentPackages.data?.items?.length ? <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">{t("page.settings.deployPackageEmpty")}</div> : null}
                </div>
                {deploymentPackageDetail ? (
                  <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentPackageDetail.item?.id}</p>
                        <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentPackageDetail.item?.dir}</p>
                      </div>
                      {deploymentPackageDetail.item?.id ? (
                        <a className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]" href={api.opsDeploymentPackageComposeUrl(deploymentPackageDetail.item.id)} target="_blank" rel="noreferrer">
                          {t("page.settings.downloadCompose")}
                        </a>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <Info label={t("page.settings.deployPackageChecksum")} value={String(deploymentPackageDetail.item?.checksum || "-")} />
                      <Info label={t("page.settings.deployPackageCreatedAt")} value={String(deploymentPackageDetail.item?.created_at || "-")} />
                      <Info label={t("page.settings.deployPackageDatabase")} value={String(deploymentPackageDetail.item?.database || "-")} />
                    </div>
                    <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{deploymentPackageDetail.preview?.compose || ""}</pre>
                  </div>
                ) : null}
                {loadDeploymentPackage.error ? <ErrorLine message={(loadDeploymentPackage.error as Error).message} /> : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.deployApprovalTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.deployApprovalDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentApprovals.isFetching}
                    onClick={() => void deploymentApprovals.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        className={inputClass}
                        value={selectedApprovalPackageId}
                        onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, package_id: e.target.value })}
                      >
                        <option value="">{t("page.settings.pipelinePackagePh")}</option>
                        {(deploymentPackages.data?.items || []).map((item: any) => (
                          <option key={item.id} value={item.id}>{`${item.version} / ${item.channel} / ${item.release_status || "draft"}`}</option>
                        ))}
                      </select>
                      <select className={inputClass} value={deploymentApprovalDraft.environment} onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, environment: e.target.value })}>
                        {["dev", "staging", "production", "rollback"].map((env) => <option key={env} value={env}>{t(`page.settings.pipelineEnvironment.${env}`, { defaultValue: env })}</option>)}
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
                      <select className={inputClass} value={deploymentApprovalDraft.policy} onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, policy: e.target.value })}>
                        {["single", "two_person", "change_board"].map((policy) => <option key={policy} value={policy}>{t(`page.settings.deployApprovalPolicy.${policy}`, { defaultValue: policy })}</option>)}
                      </select>
                      <input
                        className={inputClass}
                        value={deploymentApprovalDraft.reviewers}
                        onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, reviewers: e.target.value })}
                        placeholder={t("page.settings.deployApprovalReviewers")}
                      />
                    </div>
                    <input
                      className={inputClass}
                      value={deploymentApprovalDraft.requested_by}
                      onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, requested_by: e.target.value })}
                      placeholder={t("page.settings.deployApprovalRequester")}
                    />
                    <textarea
                      className={`${inputClass} min-h-20`}
                      value={deploymentApprovalDraft.notes}
                      onChange={(e) => setDeploymentApprovalDraft({ ...deploymentApprovalDraft, notes: e.target.value })}
                      placeholder={t("page.settings.deployApprovalNotes")}
                    />
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={createDeploymentApproval.isPending || !selectedApprovalPackageId}
                      onClick={() => createDeploymentApproval.mutate()}
                    >
                      <ListChecks className="h-4 w-4" />
                      {t("page.settings.deployApprovalRequest")}
                    </button>
                    {createDeploymentApproval.error ? <ErrorLine message={(createDeploymentApproval.error as Error).message} /> : null}
                    {deploymentApprovals.error ? <ErrorLine message={(deploymentApprovals.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.deployApprovalRecent")}</p>
                      <StatusPill tone={deploymentApprovalDetail?.item?.status === "published" ? "ok" : deploymentApprovalDetail?.item?.status === "rejected" ? "danger" : "warn"} label={deploymentApprovalDetail?.item?.status ? t(`page.settings.deployApprovalStatus.${deploymentApprovalDetail.item.status}`, { defaultValue: deploymentApprovalDetail.item.status }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentApprovals.data?.items || []).map((approval: any) => (
                        <button
                          key={approval.id}
                          type="button"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50"
                          disabled={loadDeploymentApproval.isPending}
                          onClick={() => loadDeploymentApproval.mutate(approval.id)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs text-[var(--text)]">{approval.version || approval.package_id}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{t(`page.settings.deployApprovalStatus.${approval.status}`, { defaultValue: approval.status })}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${approval.environment} / ${approval.policy} / ${approval.requested_by}`}</span>
                        </button>
                      ))}
                      {!deploymentApprovals.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.deployApprovalEmpty")}</p> : null}
                    </div>
                    {loadDeploymentApproval.error ? <ErrorLine message={(loadDeploymentApproval.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentApprovalDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentApprovalDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentApprovalDetail.item?.package_id}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {["approve", "reject", "publish", "cancel"].map((action) => (
                            <button
                              key={action}
                              type="button"
                              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                              disabled={applyDeploymentApprovalAction.isPending || !deploymentApprovalDetail.item?.id}
                              onClick={() => applyDeploymentApprovalAction.mutate({ approvalId: deploymentApprovalDetail.item.id, action })}
                            >
                              {t(`page.settings.deployApprovalControl.${action}`, { defaultValue: action })}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        <Info label={t("page.settings.deployApprovalStatusLabel")} value={t(`page.settings.deployApprovalStatus.${deploymentApprovalDetail.item?.status}`, { defaultValue: deploymentApprovalDetail.item?.status || "-" })} />
                        <Info label={t("page.settings.deployApprovalApprovedBy")} value={String(deploymentApprovalDetail.item?.approved_by || "-")} />
                        <Info label={t("page.settings.deployApprovalPipeline")} value={String(deploymentApprovalDetail.item?.pipeline_run_id || "-")} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        {(deploymentApprovalDetail.approval?.checks || []).map((check: any) => (
                          <div key={check.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.deployApprovalCheck.${check.id}`, { defaultValue: check.id })}</p>
                            <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{check.status}</p>
                          </div>
                        ))}
                      </div>
                      {applyDeploymentApprovalAction.error ? <ErrorLine message={(applyDeploymentApprovalAction.error as Error).message} /> : null}
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.deployApprovalEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentApprovalDetail.approval?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.deployApprovalEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <FileText className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackRunbookTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.rollbackRunbookDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentRollbackRunbooks.isFetching}
                    onClick={() => void deploymentRollbackRunbooks.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        className={inputClass}
                        value={selectedRollbackRunbookPackageId}
                        onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, package_id: e.target.value })}
                      >
                        <option value="">{t("page.settings.pipelinePackagePh")}</option>
                        {(deploymentPackages.data?.items || []).map((item: any) => (
                          <option key={item.id} value={item.id}>{`${item.version} / ${item.channel} / ${item.release_status || "draft"}`}</option>
                        ))}
                      </select>
                      <select
                        className={inputClass}
                        value={deploymentRollbackRunbookDraft.drill_id || deploymentRollbackDrillDetail?.item?.id || ""}
                        onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, drill_id: e.target.value })}
                      >
                        <option value="">{t("page.settings.rollbackRunbookDrillPh")}</option>
                        {(deploymentRollbackDrills.data?.items || []).map((drill: any) => (
                          <option key={drill.id} value={drill.id}>{`${drill.name || drill.version} / ${drill.status}`}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <input
                        className={inputClass}
                        value={deploymentRollbackRunbookDraft.name}
                        onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, name: e.target.value })}
                        placeholder={t("page.settings.rollbackRunbookName")}
                      />
                      <select className={inputClass} value={deploymentRollbackRunbookDraft.environment} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, environment: e.target.value })}>
                        {["dev", "staging", "production", "rollback"].map((env) => <option key={env} value={env}>{t(`page.settings.pipelineEnvironment.${env}`, { defaultValue: env })}</option>)}
                      </select>
                      <select className={inputClass} value={deploymentRollbackRunbookDraft.trigger} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, trigger: e.target.value })}>
                        {["manual", "canary_gate_failure", "post_deploy_regression", "dependency_outage", "slo_breach"].map((trigger) => <option key={trigger} value={trigger}>{t(`page.settings.rollbackRunbookTrigger.${trigger}`, { defaultValue: trigger })}</option>)}
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <input className={inputClass} value={deploymentRollbackRunbookDraft.operator} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, operator: e.target.value })} placeholder={t("page.settings.rollbackRunbookOperator")} />
                      <select className={inputClass} value={deploymentRollbackRunbookDraft.task_priority} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, task_priority: e.target.value })}>
                        {["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                      </select>
                      <input className={inputClass} value={deploymentRollbackRunbookDraft.assigned_to} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, assigned_to: e.target.value })} placeholder={t("page.settings.rollbackRunbookAssignee")} />
                      <input className={inputClass} value={deploymentRollbackRunbookDraft.dev_tool} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, dev_tool: e.target.value })} placeholder={t("page.settings.rollbackRunbookDevTool")} />
                    </div>
                    <textarea
                      className={`${inputClass} min-h-20`}
                      value={deploymentRollbackRunbookDraft.notes}
                      onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, notes: e.target.value })}
                      placeholder={t("page.settings.rollbackRunbookNotes")}
                    />
                    <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-strong)]">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={deploymentRollbackRunbookDraft.approval_required} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, approval_required: e.target.checked })} />
                        {t("page.settings.pipelineApprovalRequired")}
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={deploymentRollbackRunbookDraft.create_preview_pipeline} onChange={(e) => setDeploymentRollbackRunbookDraft({ ...deploymentRollbackRunbookDraft, create_preview_pipeline: e.target.checked })} />
                        {t("page.settings.rollbackRunbookCreatePreview")}
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={createDeploymentRollbackRunbook.isPending || !selectedRollbackRunbookPackageId}
                        onClick={() => createDeploymentRollbackRunbook.mutate()}
                      >
                        <FileText className="h-4 w-4" />
                        {t("page.settings.rollbackRunbookCreate")}
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                        disabled={applyDeploymentRollbackRunbookAction.isPending || !deploymentRollbackRunbookDetail?.item?.id}
                        onClick={() => applyDeploymentRollbackRunbookAction.mutate({ runbookId: deploymentRollbackRunbookDetail.item.id, action: "create_tasks", dryRun: true })}
                      >
                        {t("page.settings.rollbackRunbookPreviewTasks")}
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                        disabled={applyDeploymentRollbackRunbookAction.isPending || !deploymentRollbackRunbookDetail?.item?.id}
                        onClick={() => applyDeploymentRollbackRunbookAction.mutate({ runbookId: deploymentRollbackRunbookDetail.item.id, action: "create_tasks", dryRun: false })}
                      >
                        {t("page.settings.rollbackRunbookCreateTasks")}
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                        disabled={applyDeploymentRollbackRunbookAction.isPending || !deploymentRollbackRunbookDetail?.item?.id}
                        onClick={() => applyDeploymentRollbackRunbookAction.mutate({ runbookId: deploymentRollbackRunbookDetail.item.id, action: "create_pipeline", dryRun: false })}
                      >
                        {t("page.settings.rollbackRunbookCreatePipeline")}
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                        disabled={applyDeploymentRollbackRunbookAction.isPending || !deploymentRollbackRunbookDetail?.item?.id}
                        onClick={() => applyDeploymentRollbackRunbookAction.mutate({ runbookId: deploymentRollbackRunbookDetail.item.id, action: "mark_ready", dryRun: true })}
                      >
                        {t("page.settings.rollbackRunbookMarkReady")}
                      </button>
                    </div>
                    {createDeploymentRollbackRunbook.error ? <ErrorLine message={(createDeploymentRollbackRunbook.error as Error).message} /> : null}
                    {applyDeploymentRollbackRunbookAction.error ? <ErrorLine message={(applyDeploymentRollbackRunbookAction.error as Error).message} /> : null}
                    {deploymentRollbackRunbooks.error ? <ErrorLine message={(deploymentRollbackRunbooks.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackRunbookRecent")}</p>
                      <StatusPill tone={deploymentRollbackRunbookDetail?.item?.status === "ready" ? "ok" : deploymentRollbackRunbookDetail?.item?.status === "risk" ? "danger" : "warn"} label={deploymentRollbackRunbookDetail?.item?.status ? t(`page.settings.rollbackRunbookStatus.${deploymentRollbackRunbookDetail.item.status}`, { defaultValue: deploymentRollbackRunbookDetail.item.status }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentRollbackRunbooks.data?.items || []).map((runbook: any) => (
                        <button
                          key={runbook.id}
                          type="button"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50"
                          disabled={loadDeploymentRollbackRunbook.isPending}
                          onClick={() => loadDeploymentRollbackRunbook.mutate(runbook.id)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-[var(--text)]">{runbook.name || runbook.version}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{`${runbook.step_done}/${runbook.step_total}`}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${runbook.environment} / ${t(`page.settings.rollbackRunbookStatus.${runbook.status}`, { defaultValue: runbook.status })}`}</span>
                        </button>
                      ))}
                      {!deploymentRollbackRunbooks.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.rollbackRunbookEmpty")}</p> : null}
                    </div>
                    {loadDeploymentRollbackRunbook.error ? <ErrorLine message={(loadDeploymentRollbackRunbook.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentRollbackRunbookDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentRollbackRunbookDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentRollbackRunbookDetail.item?.package_id}</p>
                        </div>
                        <StatusPill tone={deploymentRollbackRunbookDetail.item?.status === "ready" ? "ok" : deploymentRollbackRunbookDetail.item?.status === "risk" ? "danger" : "warn"} label={t(`page.settings.rollbackRunbookStatus.${deploymentRollbackRunbookDetail.item?.status}`, { defaultValue: deploymentRollbackRunbookDetail.item?.status || "-" })} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-4">
                        <Info label={t("page.settings.rollbackRunbookTriggerLabel")} value={t(`page.settings.rollbackRunbookTrigger.${deploymentRollbackRunbookDetail.item?.trigger}`, { defaultValue: deploymentRollbackRunbookDetail.item?.trigger || "-" })} />
                        <Info label={t("page.settings.rollbackRunbookSteps")} value={`${deploymentRollbackRunbookDetail.item?.step_done ?? 0}/${deploymentRollbackRunbookDetail.item?.step_total ?? 0}`} />
                        <Info label={t("page.settings.rollbackRunbookTasks")} value={String(deploymentRollbackRunbookDetail.item?.task_count || 0)} />
                        <Info label={t("page.settings.rollbackRunbookPipeline")} value={String(deploymentRollbackRunbookDetail.item?.rollback_pipeline_run_id || deploymentRollbackRunbookDetail.item?.preview_pipeline_run_id || "-")} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(deploymentRollbackRunbookDetail.runbook?.steps || []).map((step: any) => (
                          <div key={step.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate font-medium text-[var(--text)]">{step.title || step.id}</span>
                              <StatusPill tone={step.status === "failed" ? "danger" : step.status === "completed" ? "ok" : "warn"} label={t(`page.settings.rollbackRunbookStepStatus.${step.status}`, { defaultValue: step.status })} />
                            </div>
                            <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{step.command || step.api || step.evidence || "-"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackRunbookEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentRollbackRunbookDetail.runbook?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.rollbackRunbookEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                      {deploymentRollbackRunbookDetail.result?.planned ? (
                        <div className="mt-3 rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                          <p className="font-semibold text-[var(--text)]">{t("page.settings.rollbackRunbookPlannedTasks")}</p>
                          <p className="mt-1 text-[var(--muted)]">{String(deploymentRollbackRunbookDetail.result.planned.length || 0)}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <ListChecks className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.executionAuditTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.executionAuditDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentExecutionAudits.isFetching}
                    onClick={() => void deploymentExecutionAudits.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <select className={inputClass} value={selectedExecutionAuditPackageId} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, package_id: e.target.value })}>
                        <option value="">{t("page.settings.pipelinePackagePh")}</option>
                        {(deploymentPackages.data?.items || []).map((item: any) => (
                          <option key={item.id} value={item.id}>{`${item.version} / ${item.channel} / ${item.release_status || "draft"}`}</option>
                        ))}
                      </select>
                      <select className={inputClass} value={deploymentExecutionAuditDraft.environment} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, environment: e.target.value })}>
                        {["dev", "staging", "production", "rollback"].map((env) => <option key={env} value={env}>{t(`page.settings.pipelineEnvironment.${env}`, { defaultValue: env })}</option>)}
                      </select>
                      <select className={inputClass} value={deploymentExecutionAuditDraft.action} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, action: e.target.value })}>
                        {["deploy", "rollback", "canary", "runbook", "manual"].map((action) => <option key={action} value={action}>{t(`page.settings.executionAuditAction.${action}`, { defaultValue: action })}</option>)}
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <select className={inputClass} value={selectedExecutionAuditPipelineId} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, pipeline_run_id: e.target.value })}>
                        <option value="">{t("page.settings.executionAuditPipelinePh")}</option>
                        {(deploymentPipelines.data?.items || []).map((run: any) => <option key={run.id} value={run.id}>{`${run.environment} / ${run.action} / ${run.status}`}</option>)}
                      </select>
                      <select className={inputClass} value={selectedExecutionAuditCanaryId} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, canary_policy_id: e.target.value })}>
                        <option value="">{t("page.settings.executionAuditCanaryPh")}</option>
                        {(deploymentCanaryPolicies.data?.items || []).map((policy: any) => <option key={policy.id} value={policy.id}>{`${policy.name || policy.version} / ${policy.status}`}</option>)}
                      </select>
                      <select className={inputClass} value={selectedExecutionAuditDrillId} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, rollback_drill_id: e.target.value })}>
                        <option value="">{t("page.settings.executionAuditDrillPh")}</option>
                        {(deploymentRollbackDrills.data?.items || []).map((drill: any) => <option key={drill.id} value={drill.id}>{`${drill.name || drill.version} / ${drill.status}`}</option>)}
                      </select>
                      <select className={inputClass} value={selectedExecutionAuditRunbookId} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, rollback_runbook_id: e.target.value })}>
                        <option value="">{t("page.settings.executionAuditRunbookPh")}</option>
                        {(deploymentRollbackRunbooks.data?.items || []).map((runbook: any) => <option key={runbook.id} value={runbook.id}>{`${runbook.name || runbook.version} / ${runbook.status}`}</option>)}
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <select className={inputClass} value={deploymentExecutionAuditDraft.status} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, status: e.target.value })}>
                        {["pending", "running", "succeeded", "failed", "blocked"].map((status) => <option key={status} value={status}>{t(`page.settings.executionAuditStatus.${status}`, { defaultValue: status })}</option>)}
                      </select>
                      <select className={inputClass} value={deploymentExecutionAuditDraft.risk_level} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, risk_level: e.target.value })}>
                        {["low", "medium", "high", "critical"].map((risk) => <option key={risk} value={risk}>{t(`page.settings.executionAuditRisk.${risk}`, { defaultValue: risk })}</option>)}
                      </select>
                      <input className={inputClass} value={deploymentExecutionAuditDraft.actor} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, actor: e.target.value })} placeholder={t("page.settings.executionAuditActor")} />
                      <input className={inputClass} value={deploymentExecutionAuditDraft.change_ticket} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, change_ticket: e.target.value })} placeholder={t("page.settings.executionAuditTicket")} />
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_1fr_12rem_12rem]">
                      <input className={inputClass} value={deploymentExecutionAuditDraft.evidence_url} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, evidence_url: e.target.value })} placeholder={t("page.settings.executionAuditEvidenceUrl")} />
                      <input className={inputClass} value={deploymentExecutionAuditDraft.assigned_to} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, assigned_to: e.target.value })} placeholder={t("page.settings.executionAuditAssignee")} />
                      <select className={inputClass} value={deploymentExecutionAuditDraft.priority} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, priority: e.target.value })}>
                        {["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                      </select>
                      <input className={inputClass} value={deploymentExecutionAuditDraft.dev_tool} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, dev_tool: e.target.value })} placeholder={t("page.settings.rollbackRunbookDevTool")} />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <textarea className={`${inputClass} min-h-20`} value={deploymentExecutionAuditDraft.notes} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, notes: e.target.value })} placeholder={t("page.settings.executionAuditNotes")} />
                      <textarea className={`${inputClass} min-h-20`} value={deploymentExecutionAuditDraft.metadata} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, metadata: e.target.value })} placeholder={t("page.settings.executionAuditMetadata")} />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                      <input type="checkbox" checked={deploymentExecutionAuditDraft.include_low} onChange={(e) => setDeploymentExecutionAuditDraft({ ...deploymentExecutionAuditDraft, include_low: e.target.checked })} />
                      {t("page.settings.executionAuditIncludeLow")}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={createDeploymentExecutionAudit.isPending || !selectedExecutionAuditPackageId} onClick={() => createDeploymentExecutionAudit.mutate()}>
                        <ListChecks className="h-4 w-4" />
                        {t("page.settings.executionAuditCreate")}
                      </button>
                      <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50" disabled={createDeploymentExecutionAuditTasks.isPending || !deploymentExecutionAuditDetail?.item?.id} onClick={() => createDeploymentExecutionAuditTasks.mutate(true)}>
                        {t("page.settings.executionAuditPreviewTasks")}
                      </button>
                      <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50" disabled={createDeploymentExecutionAuditTasks.isPending || !deploymentExecutionAuditDetail?.item?.id} onClick={() => createDeploymentExecutionAuditTasks.mutate(false)}>
                        {t("page.settings.executionAuditCreateTasks")}
                      </button>
                    </div>
                    {createDeploymentExecutionAudit.error ? <ErrorLine message={(createDeploymentExecutionAudit.error as Error).message} /> : null}
                    {createDeploymentExecutionAuditTasks.error ? <ErrorLine message={(createDeploymentExecutionAuditTasks.error as Error).message} /> : null}
                    {deploymentExecutionAudits.error ? <ErrorLine message={(deploymentExecutionAudits.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.executionAuditRecent")}</p>
                      <StatusPill tone={deploymentExecutionAuditDetail?.item?.risk_level === "critical" || deploymentExecutionAuditDetail?.item?.risk_level === "high" ? "danger" : deploymentExecutionAuditDetail?.item?.risk_level === "low" ? "ok" : "warn"} label={deploymentExecutionAuditDetail?.item?.risk_level ? t(`page.settings.executionAuditRisk.${deploymentExecutionAuditDetail.item.risk_level}`, { defaultValue: deploymentExecutionAuditDetail.item.risk_level }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentExecutionAudits.data?.items || []).map((audit: any) => (
                        <button key={audit.id} type="button" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50" disabled={loadDeploymentExecutionAudit.isPending} onClick={() => loadDeploymentExecutionAudit.mutate(audit.id)}>
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-[var(--text)]">{`${audit.environment} / ${t(`page.settings.executionAuditAction.${audit.action}`, { defaultValue: audit.action })}`}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{audit.risk_score}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${t(`page.settings.executionAuditStatus.${audit.status}`, { defaultValue: audit.status })} / ${audit.evidence_passed || 0}/${audit.evidence_total || 0}`}</span>
                        </button>
                      ))}
                      {!deploymentExecutionAudits.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.executionAuditEmpty")}</p> : null}
                    </div>
                    {loadDeploymentExecutionAudit.error ? <ErrorLine message={(loadDeploymentExecutionAudit.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentExecutionAuditDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentExecutionAuditDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentExecutionAuditDetail.item?.package_id}</p>
                        </div>
                        <StatusPill tone={deploymentExecutionAuditDetail.item?.risk_level === "critical" || deploymentExecutionAuditDetail.item?.risk_level === "high" ? "danger" : deploymentExecutionAuditDetail.item?.risk_level === "low" ? "ok" : "warn"} label={`${t(`page.settings.executionAuditRisk.${deploymentExecutionAuditDetail.item?.risk_level}`, { defaultValue: deploymentExecutionAuditDetail.item?.risk_level || "-" })} ${deploymentExecutionAuditDetail.item?.risk_score || 0}`} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-4">
                        <Info label={t("page.settings.executionAuditStatusLabel")} value={t(`page.settings.executionAuditStatus.${deploymentExecutionAuditDetail.item?.status}`, { defaultValue: deploymentExecutionAuditDetail.item?.status || "-" })} />
                        <Info label={t("page.settings.executionAuditCoverage")} value={`${deploymentExecutionAuditDetail.item?.evidence_passed || 0}/${deploymentExecutionAuditDetail.item?.evidence_total || 0}`} />
                        <Info label={t("page.settings.executionAuditMissing")} value={String(deploymentExecutionAuditDetail.item?.missing_required || 0)} />
                        <Info label={t("page.settings.executionAuditTasks")} value={String(deploymentExecutionAuditDetail.item?.task_count || 0)} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(deploymentExecutionAuditDetail.audit?.evidence || []).map((row: any) => (
                          <div key={row.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate font-medium text-[var(--text)]">{row.label || row.id}</span>
                              <StatusPill tone={row.status === "passed" ? "ok" : row.status === "failed" || row.status === "missing" ? "danger" : "warn"} label={t(`page.settings.executionAuditEvidenceStatus.${row.status}`, { defaultValue: row.status })} />
                            </div>
                            <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{row.ref_id || row.summary || "-"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.executionAuditEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentExecutionAuditDetail.audit?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.executionAuditEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                      {deploymentExecutionAuditDetail.result?.planned ? (
                        <div className="mt-3 rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                          <p className="font-semibold text-[var(--text)]">{t("page.settings.executionAuditPlannedTasks")}</p>
                          <p className="mt-1 text-[var(--muted)]">{String(deploymentExecutionAuditDetail.result.planned.length || 0)}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <SlidersHorizontal className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.canaryTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.canaryDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentCanaryPolicies.isFetching}
                    onClick={() => void deploymentCanaryPolicies.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        className={inputClass}
                        value={selectedCanaryPackageId}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, package_id: e.target.value })}
                      >
                        <option value="">{t("page.settings.pipelinePackagePh")}</option>
                        {(deploymentPackages.data?.items || []).map((item: any) => (
                          <option key={item.id} value={item.id}>{`${item.version} / ${item.channel} / ${item.release_status || "draft"}`}</option>
                        ))}
                      </select>
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.name}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, name: e.target.value })}
                        placeholder={t("page.settings.canaryName")}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <select className={inputClass} value={deploymentCanaryDraft.environment} onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, environment: e.target.value })}>
                        {["dev", "staging", "production"].map((env) => <option key={env} value={env}>{t(`page.settings.pipelineEnvironment.${env}`, { defaultValue: env })}</option>)}
                      </select>
                      <select className={inputClass} value={deploymentCanaryDraft.strategy} onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, strategy: e.target.value })}>
                        {["linear", "exponential", "manual"].map((strategy) => <option key={strategy} value={strategy}>{t(`page.settings.canaryStrategy.${strategy}`, { defaultValue: strategy })}</option>)}
                      </select>
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.traffic_steps}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, traffic_steps: e.target.value })}
                        placeholder={t("page.settings.canarySteps")}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.max_error_rate}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, max_error_rate: e.target.value })}
                        placeholder={t("page.settings.canaryMaxError")}
                      />
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.latency_p95_ms}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, latency_p95_ms: e.target.value })}
                        placeholder={t("page.settings.canaryLatency")}
                      />
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.min_observation_minutes}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, min_observation_minutes: e.target.value })}
                        placeholder={t("page.settings.canaryObserve")}
                      />
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.created_by}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, created_by: e.target.value })}
                        placeholder={t("page.settings.canaryOperator")}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_10rem_10rem]">
                      <textarea
                        className={`${inputClass} min-h-20`}
                        value={deploymentCanaryDraft.notes}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, notes: e.target.value })}
                        placeholder={t("page.settings.canaryNotes")}
                      />
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.error_rate}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, error_rate: e.target.value })}
                        placeholder={t("page.settings.canaryObservedError")}
                      />
                      <input
                        className={inputClass}
                        value={deploymentCanaryDraft.observed_latency_p95_ms}
                        onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, observed_latency_p95_ms: e.target.value })}
                        placeholder={t("page.settings.canaryObservedLatency")}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                      <input type="checkbox" checked={deploymentCanaryDraft.auto_promote} onChange={(e) => setDeploymentCanaryDraft({ ...deploymentCanaryDraft, auto_promote: e.target.checked })} />
                      {t("page.settings.canaryAutoPromote")}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={createDeploymentCanaryPolicy.isPending || !selectedCanaryPackageId}
                        onClick={() => createDeploymentCanaryPolicy.mutate()}
                      >
                        <Activity className="h-4 w-4" />
                        {t("page.settings.canaryCreate")}
                      </button>
                      {["start", "advance", "pause", "resume", "rollback", "complete"].map((action) => (
                        <button
                          key={action}
                          type="button"
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                          disabled={applyDeploymentCanaryAction.isPending || !deploymentCanaryDetail?.item?.id}
                          onClick={() => applyDeploymentCanaryAction.mutate({ policyId: deploymentCanaryDetail.item.id, action })}
                        >
                          {t(`page.settings.canaryControl.${action}`, { defaultValue: action })}
                        </button>
                      ))}
                    </div>
                    {createDeploymentCanaryPolicy.error ? <ErrorLine message={(createDeploymentCanaryPolicy.error as Error).message} /> : null}
                    {applyDeploymentCanaryAction.error ? <ErrorLine message={(applyDeploymentCanaryAction.error as Error).message} /> : null}
                    {deploymentCanaryPolicies.error ? <ErrorLine message={(deploymentCanaryPolicies.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.canaryRecent")}</p>
                      <StatusPill tone={deploymentCanaryDetail?.item?.status === "completed" ? "ok" : deploymentCanaryDetail?.item?.status === "rolled_back" || deploymentCanaryDetail?.item?.status === "blocked" ? "danger" : "warn"} label={deploymentCanaryDetail?.item?.status ? t(`page.settings.canaryStatus.${deploymentCanaryDetail.item.status}`, { defaultValue: deploymentCanaryDetail.item.status }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentCanaryPolicies.data?.items || []).map((policy: any) => (
                        <button
                          key={policy.id}
                          type="button"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50"
                          disabled={loadDeploymentCanaryPolicy.isPending}
                          onClick={() => loadDeploymentCanaryPolicy.mutate(policy.id)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-[var(--text)]">{policy.name || policy.version}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{policy.current_traffic}%</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${policy.environment} / ${policy.strategy} / ${t(`page.settings.canaryStatus.${policy.status}`, { defaultValue: policy.status })}`}</span>
                        </button>
                      ))}
                      {!deploymentCanaryPolicies.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.canaryEmpty")}</p> : null}
                    </div>
                    {loadDeploymentCanaryPolicy.error ? <ErrorLine message={(loadDeploymentCanaryPolicy.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentCanaryDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentCanaryDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentCanaryDetail.item?.package_id}</p>
                        </div>
                        <StatusPill tone={deploymentCanaryDetail.item?.status === "completed" ? "ok" : deploymentCanaryDetail.item?.status === "blocked" || deploymentCanaryDetail.item?.status === "rolled_back" ? "danger" : "warn"} label={t(`page.settings.canaryStatus.${deploymentCanaryDetail.item?.status}`, { defaultValue: deploymentCanaryDetail.item?.status || "-" })} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-4">
                        <Info label={t("page.settings.canaryTraffic")} value={`${deploymentCanaryDetail.item?.current_traffic ?? 0}%`} />
                        <Info label={t("page.settings.canaryStep")} value={`${Number(deploymentCanaryDetail.item?.current_step_index ?? -1) + 1}/${deploymentCanaryDetail.item?.traffic_steps?.length || 0}`} />
                        <Info label={t("page.settings.canaryPipeline")} value={String(deploymentCanaryDetail.item?.pipeline_run_id || "-")} />
                        <Info label={t("page.settings.canaryUpdatedAt")} value={String(deploymentCanaryDetail.item?.updated_at || "-")} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(deploymentCanaryDetail.item?.traffic_steps || []).map((step: number) => (
                          <span key={step} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${step <= Number(deploymentCanaryDetail.item?.current_traffic || 0) ? "bg-[var(--brand)] text-white" : "bg-[var(--surface)] text-[var(--muted-strong)]"}`}>
                            {step}%
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(deploymentCanaryDetail.policy?.gates || []).slice(-4).reverse().map((gate: any) => (
                          <div key={gate.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-semibold text-[var(--text)]">{t("page.settings.canaryGate")}</p>
                              <StatusPill tone={gate.status === "passed" ? "ok" : gate.status === "failed" ? "danger" : "warn"} label={t(`page.settings.canaryGateStatus.${gate.status}`, { defaultValue: gate.status })} />
                            </div>
                            <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{JSON.stringify(gate.metrics || {})}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.canaryEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentCanaryDetail.policy?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.canaryEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 xl:col-span-2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                            <Activity className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.canaryMetricTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.canaryMetricDesc")}</p>
                          </div>
                        </div>
                        <StatusPill tone={deploymentCanaryMetricResult?.gate?.status === "passed" ? "ok" : deploymentCanaryMetricResult?.gate?.status === "failed" ? "danger" : "warn"} label={deploymentCanaryMetricResult?.gate?.status ? t(`page.settings.canaryGateStatus.${deploymentCanaryMetricResult.gate.status}`, { defaultValue: deploymentCanaryMetricResult.gate.status }) : t("page.settings.canaryMetricNoResult")} />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <select className={inputClass} value={deploymentCanaryMetricSourceDraft.source_type} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, source_type: e.target.value })}>
                          {["manual", "synthetic", "prometheus", "grafana", "datadog"].map((type) => <option key={type} value={type}>{t(`page.settings.canaryMetricSourceType.${type}`, { defaultValue: type })}</option>)}
                        </select>
                        <input className={inputClass} value={deploymentCanaryMetricSourceDraft.name} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, name: e.target.value })} placeholder={t("page.settings.canaryMetricName")} />
                        <input className={inputClass} value={deploymentCanaryMetricSourceDraft.window_minutes} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, window_minutes: e.target.value })} placeholder={t("page.settings.canaryMetricWindow")} />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_9rem_9rem]">
                        <input className={inputClass} value={deploymentCanaryMetricSourceDraft.endpoint} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, endpoint: e.target.value })} placeholder={t("page.settings.canaryMetricEndpoint")} />
                        <input className={inputClass} value={deploymentCanaryMetricSourceDraft.sample_error_rate} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, sample_error_rate: e.target.value })} placeholder={t("page.settings.canaryObservedError")} />
                        <input className={inputClass} value={deploymentCanaryMetricSourceDraft.sample_latency_p95_ms} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, sample_latency_p95_ms: e.target.value })} placeholder={t("page.settings.canaryObservedLatency")} />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <textarea className={`${inputClass} min-h-20`} value={deploymentCanaryMetricSourceDraft.error_rate_query} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, error_rate_query: e.target.value })} placeholder={t("page.settings.canaryMetricErrorQuery")} />
                        <textarea className={`${inputClass} min-h-20`} value={deploymentCanaryMetricSourceDraft.latency_p95_query} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, latency_p95_query: e.target.value })} placeholder={t("page.settings.canaryMetricLatencyQuery")} />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                        <textarea className={`${inputClass} min-h-16`} value={deploymentCanaryMetricSourceDraft.labels} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, labels: e.target.value })} placeholder={t("page.settings.canaryMetricLabels")} />
                        <textarea className={`${inputClass} min-h-16`} value={deploymentCanaryMetricSourceDraft.notes} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, notes: e.target.value })} placeholder={t("page.settings.canaryMetricNotes")} />
                        <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--muted-strong)]">
                          <input type="checkbox" checked={deploymentCanaryMetricSourceDraft.enabled} onChange={(e) => setDeploymentCanaryMetricSourceDraft({ ...deploymentCanaryMetricSourceDraft, enabled: e.target.checked })} />
                          {t("page.settings.canaryMetricEnabled")}
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={createDeploymentCanaryMetricSource.isPending || !selectedCanaryPolicyId} onClick={() => createDeploymentCanaryMetricSource.mutate()}>
                          <SlidersHorizontal className="h-4 w-4" />
                          {t("page.settings.canaryMetricCreate")}
                        </button>
                        <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={collectDeploymentCanaryMetrics.isPending || !selectedCanaryMetricSourceId} onClick={() => collectDeploymentCanaryMetrics.mutate({ dryRun: true, applyToGate: false, advanceOnPass: false })}>
                          <Search className="h-4 w-4" />
                          {t("page.settings.canaryMetricPreview")}
                        </button>
                        <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={collectDeploymentCanaryMetrics.isPending || !selectedCanaryMetricSourceId} onClick={() => collectDeploymentCanaryMetrics.mutate({ dryRun: false, applyToGate: true, advanceOnPass: false })}>
                          <ListChecks className="h-4 w-4" />
                          {t("page.settings.canaryMetricApplyGate")}
                        </button>
                        <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={collectDeploymentCanaryMetrics.isPending || !selectedCanaryMetricSourceId} onClick={() => collectDeploymentCanaryMetrics.mutate({ dryRun: false, applyToGate: true, advanceOnPass: true })}>
                          <Rocket className="h-4 w-4" />
                          {t("page.settings.canaryMetricAutoAdvance")}
                        </button>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
                        <div className="space-y-2">
                          {(deploymentCanaryMetricSources.data?.items || []).map((source: any) => (
                            <button key={source.id} type="button" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50" disabled={loadDeploymentCanaryMetricSource.isPending} onClick={() => loadDeploymentCanaryMetricSource.mutate(source.id)}>
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs font-semibold text-[var(--text)]">{source.name || source.id}</span>
                                <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">{source.source_type}</span>
                              </span>
                              <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${source.last_status || "-"} / ${source.last_error_rate || "-"} / ${source.last_latency_p95_ms || "-"}`}</span>
                            </button>
                          ))}
                          {!deploymentCanaryMetricSources.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.canaryMetricEmpty")}</p> : null}
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                          <div className="grid gap-2 md:grid-cols-4">
                            <Info label={t("page.settings.canaryMetricErrorRate")} value={String(deploymentCanaryMetricResult?.metrics?.error_rate ?? deploymentCanaryMetricSourceDetail?.item?.last_error_rate ?? "-")} />
                            <Info label={t("page.settings.canaryMetricLatency")} value={String(deploymentCanaryMetricResult?.metrics?.latency_p95_ms ?? deploymentCanaryMetricSourceDetail?.item?.last_latency_p95_ms ?? "-")} />
                            <Info label={t("page.settings.canaryMetricMode")} value={String(deploymentCanaryMetricResult?.metrics?.collection_mode || "-")} />
                            <Info label={t("page.settings.canaryMetricSamples")} value={String(deploymentCanaryMetricSourceDetail?.item?.sample_count ?? "-")} />
                          </div>
                          {deploymentCanaryMetricResult ? <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify({ metrics: deploymentCanaryMetricResult.metrics, gate: deploymentCanaryMetricResult.gate, applied: deploymentCanaryMetricResult.applied, advanced: deploymentCanaryMetricResult.advanced }, null, 2)}</pre> : null}
                        </div>
                      </div>
                      {createDeploymentCanaryMetricSource.error ? <ErrorLine message={(createDeploymentCanaryMetricSource.error as Error).message} /> : null}
                      {loadDeploymentCanaryMetricSource.error ? <ErrorLine message={(loadDeploymentCanaryMetricSource.error as Error).message} /> : null}
                      {collectDeploymentCanaryMetrics.error ? <ErrorLine message={(collectDeploymentCanaryMetrics.error as Error).message} /> : null}
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 xl:col-span-2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                            <MessageSquare className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.canaryImTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.canaryImDesc")}</p>
                          </div>
                        </div>
                        {deploymentCanaryImResult?.delivery_plan ? (
                          <StatusPill
                            tone={deploymentCanaryImResult.delivery_plan.ready ? "ok" : "warn"}
                            label={`${deploymentCanaryImResult.delivery_plan.target_count || 0} ${t("page.settings.canaryImTargets")}`}
                          />
                        ) : null}
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem]">
                        <input
                          className={inputClass}
                          value={deploymentCanaryImDraft.title}
                          onChange={(e) => setDeploymentCanaryImDraft({ ...deploymentCanaryImDraft, title: e.target.value })}
                          placeholder={t("page.settings.canaryImTitlePh")}
                        />
                        <input
                          className={inputClass}
                          value={deploymentCanaryImDraft.limit}
                          onChange={(e) => setDeploymentCanaryImDraft({ ...deploymentCanaryImDraft, limit: e.target.value })}
                          placeholder={t("page.settings.canaryImLimit")}
                        />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        {(notifyChannels.data || []).map((channel: any) => {
                          const selected = deploymentCanaryImDraft.channels.includes(channel.name);
                          return (
                            <label key={channel.name} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${selected ? "border-[var(--brand)] bg-[var(--brand-softer)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-[var(--text)]">{channel.name}</span>
                                <span className="block truncate text-[11px] text-[var(--muted)]">{`${channel.type || "webhook"} / ${channel.enabled === false ? t("page.settings.canaryImDisabled") : t("page.settings.canaryImEnabled")}`}</span>
                              </span>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(e) => {
                                  const channels = e.target.checked
                                    ? [...deploymentCanaryImDraft.channels, channel.name]
                                    : deploymentCanaryImDraft.channels.filter((item) => item !== channel.name);
                                  setDeploymentCanaryImDraft({ ...deploymentCanaryImDraft, channels });
                                }}
                              />
                            </label>
                          );
                        })}
                      </div>
                      {!(notifyChannels.data || []).length ? <HintLine message={t("page.settings.canaryImNoChannels")} /> : null}
                      {notifyChannels.error ? <ErrorLine message={(notifyChannels.error as Error).message} /> : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
                          disabled={runDeploymentCanaryIm.isPending || !deploymentCanaryDetail.item?.id}
                          onClick={() => runDeploymentCanaryIm.mutate(true)}
                        >
                          <Search className="h-4 w-4" />
                          {t("page.settings.canaryImPreview")}
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                          disabled={runDeploymentCanaryIm.isPending || !deploymentCanaryDetail.item?.id}
                          onClick={() => runDeploymentCanaryIm.mutate(false)}
                        >
                          <Send className="h-4 w-4" />
                          {t("page.settings.canaryImSend")}
                        </button>
                      </div>
                      {deploymentCanaryImResult ? (
                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          <Info label={t("page.settings.canaryImRisk")} value={String(deploymentCanaryImResult.briefing?.risk_level || "-")} />
                          <Info label={t("page.settings.canaryImMode")} value={String(deploymentCanaryImResult.delivery_plan?.selection_mode || "-")} />
                          <Info label={t("page.settings.canaryImSent")} value={String(deploymentCanaryImResult.sent?.length || 0)} />
                        </div>
                      ) : null}
                      {deploymentCanaryImResult?.delivery_plan?.recommendation ? <HintLine message={deploymentCanaryImResult.delivery_plan.recommendation} /> : null}
                      {runDeploymentCanaryIm.error ? <ErrorLine message={(runDeploymentCanaryIm.error as Error).message} /> : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackDrillTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.rollbackDrillDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentRollbackDrills.isFetching}
                    onClick={() => void deploymentRollbackDrills.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        className={inputClass}
                        value={selectedRollbackDrillPackageId}
                        onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, package_id: e.target.value })}
                      >
                        <option value="">{t("page.settings.pipelinePackagePh")}</option>
                        {(deploymentPackages.data?.items || []).map((item: any) => (
                          <option key={item.id} value={item.id}>{`${item.version} / ${item.channel} / ${item.release_status || "draft"}`}</option>
                        ))}
                      </select>
                      <input
                        className={inputClass}
                        value={deploymentRollbackDrillDraft.name}
                        onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, name: e.target.value })}
                        placeholder={t("page.settings.rollbackDrillName")}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <select className={inputClass} value={deploymentRollbackDrillDraft.environment} onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, environment: e.target.value })}>
                        {["dev", "staging", "production", "rollback"].map((env) => <option key={env} value={env}>{t(`page.settings.pipelineEnvironment.${env}`, { defaultValue: env })}</option>)}
                      </select>
                      <select className={inputClass} value={deploymentRollbackDrillDraft.scenario} onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, scenario: e.target.value })}>
                        {["post_deploy_regression", "canary_gate_failure", "dependency_outage", "manual_rehearsal"].map((scenario) => <option key={scenario} value={scenario}>{t(`page.settings.rollbackDrillScenario.${scenario}`, { defaultValue: scenario })}</option>)}
                      </select>
                      <input
                        className={inputClass}
                        value={deploymentRollbackDrillDraft.operator}
                        onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, operator: e.target.value })}
                        placeholder={t("page.settings.rollbackDrillOperator")}
                      />
                    </div>
                    <textarea
                      className={`${inputClass} min-h-20`}
                      value={deploymentRollbackDrillDraft.notes}
                      onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, notes: e.target.value })}
                      placeholder={t("page.settings.rollbackDrillNotes")}
                    />
                    <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-strong)]">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={deploymentRollbackDrillDraft.approval_required} onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, approval_required: e.target.checked })} />
                        {t("page.settings.pipelineApprovalRequired")}
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={deploymentRollbackDrillDraft.create_pipeline} onChange={(e) => setDeploymentRollbackDrillDraft({ ...deploymentRollbackDrillDraft, create_pipeline: e.target.checked })} />
                        {t("page.settings.rollbackDrillCreatePreview")}
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={createDeploymentRollbackDrill.isPending || !selectedRollbackDrillPackageId}
                        onClick={() => createDeploymentRollbackDrill.mutate()}
                      >
                        <ListChecks className="h-4 w-4" />
                        {t("page.settings.rollbackDrillCreate")}
                      </button>
                      {["start", "create_rollback_pipeline", "complete", "cancel"].map((action) => (
                        <button
                          key={action}
                          type="button"
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                          disabled={applyDeploymentRollbackDrillAction.isPending || !deploymentRollbackDrillDetail?.item?.id}
                          onClick={() => applyDeploymentRollbackDrillAction.mutate({ drillId: deploymentRollbackDrillDetail.item.id, action })}
                        >
                          {t(`page.settings.rollbackDrillControl.${action}`, { defaultValue: action })}
                        </button>
                      ))}
                    </div>
                    {createDeploymentRollbackDrill.error ? <ErrorLine message={(createDeploymentRollbackDrill.error as Error).message} /> : null}
                    {applyDeploymentRollbackDrillAction.error ? <ErrorLine message={(applyDeploymentRollbackDrillAction.error as Error).message} /> : null}
                    {deploymentRollbackDrills.error ? <ErrorLine message={(deploymentRollbackDrills.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackDrillRecent")}</p>
                      <StatusPill tone={deploymentRollbackDrillDetail?.item?.status === "completed" ? "ok" : deploymentRollbackDrillDetail?.item?.status === "risk" ? "danger" : "warn"} label={deploymentRollbackDrillDetail?.item?.status ? t(`page.settings.rollbackDrillStatus.${deploymentRollbackDrillDetail.item.status}`, { defaultValue: deploymentRollbackDrillDetail.item.status }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentRollbackDrills.data?.items || []).map((drill: any) => (
                        <button
                          key={drill.id}
                          type="button"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50"
                          disabled={loadDeploymentRollbackDrill.isPending}
                          onClick={() => loadDeploymentRollbackDrill.mutate(drill.id)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-[var(--text)]">{drill.name || drill.version}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{`${drill.check_passed}/${drill.check_total}`}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${drill.environment} / ${t(`page.settings.rollbackDrillStatus.${drill.status}`, { defaultValue: drill.status })}`}</span>
                        </button>
                      ))}
                      {!deploymentRollbackDrills.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.rollbackDrillEmpty")}</p> : null}
                    </div>
                    {loadDeploymentRollbackDrill.error ? <ErrorLine message={(loadDeploymentRollbackDrill.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentRollbackDrillDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentRollbackDrillDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentRollbackDrillDetail.item?.package_id}</p>
                        </div>
                        <StatusPill tone={deploymentRollbackDrillDetail.item?.status === "completed" ? "ok" : deploymentRollbackDrillDetail.item?.status === "risk" ? "danger" : "warn"} label={t(`page.settings.rollbackDrillStatus.${deploymentRollbackDrillDetail.item?.status}`, { defaultValue: deploymentRollbackDrillDetail.item?.status || "-" })} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-4">
                        <Info label={t("page.settings.rollbackDrillScenarioLabel")} value={t(`page.settings.rollbackDrillScenario.${deploymentRollbackDrillDetail.item?.scenario}`, { defaultValue: deploymentRollbackDrillDetail.item?.scenario || "-" })} />
                        <Info label={t("page.settings.rollbackDrillChecks")} value={`${deploymentRollbackDrillDetail.item?.check_passed ?? 0}/${deploymentRollbackDrillDetail.item?.check_total ?? 0}`} />
                        <Info label={t("page.settings.rollbackDrillPreviewPipeline")} value={String(deploymentRollbackDrillDetail.item?.preview_pipeline_run_id || "-")} />
                        <Info label={t("page.settings.rollbackDrillPipeline")} value={String(deploymentRollbackDrillDetail.item?.rollback_pipeline_run_id || "-")} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(deploymentRollbackDrillDetail.drill?.checks || []).map((check: any) => (
                          <div key={check.id} className="rounded-lg bg-[var(--surface)] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate text-xs font-medium text-[var(--text)]">{t(`page.settings.rollbackDrillCheck.${check.id}`, { defaultValue: check.id })}</span>
                              <StatusPill tone={check.status === "failed" ? "danger" : check.status === "passed" ? "ok" : "warn"} label={t(`page.settings.rollbackDrillCheckStatus.${check.status}`, { defaultValue: check.status })} />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                                disabled={applyDeploymentRollbackDrillAction.isPending || !deploymentRollbackDrillDetail.item?.id}
                                onClick={() => applyDeploymentRollbackDrillAction.mutate({ drillId: deploymentRollbackDrillDetail.item.id, action: "pass_check", checkId: check.id })}
                              >
                                {t("page.settings.rollbackDrillPassCheck")}
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--danger)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                                disabled={applyDeploymentRollbackDrillAction.isPending || !deploymentRollbackDrillDetail.item?.id}
                                onClick={() => applyDeploymentRollbackDrillAction.mutate({ drillId: deploymentRollbackDrillDetail.item.id, action: "fail_check", checkId: check.id })}
                              >
                                {t("page.settings.rollbackDrillFailCheck")}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.rollbackDrillEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentRollbackDrillDetail.drill?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.rollbackDrillEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <Rocket className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.pipelineTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.pipelineDesc")}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={deploymentPipelines.isFetching}
                    onClick={() => void deploymentPipelines.refetch()}
                  >
                    {t("common.refresh")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Info label={t("page.settings.deployPackage")} value={selectedDeploymentPackageId || "-"} />
                      <Info label={t("page.settings.pipelineEnvironmentLabel", { defaultValue: "环境" })} value={t(`page.settings.pipelineEnvironment.${deploymentPipelineDraft.environment}`, { defaultValue: deploymentPipelineDraft.environment })} />
                      <Info label={t("page.settings.pipelineActionLabel", { defaultValue: "动作" })} value={t(`page.settings.pipelineAction.${deploymentPipelineDraft.action}`, { defaultValue: deploymentPipelineDraft.action })} />
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.pipelineQuickSummary", { defaultValue: "发布草稿" })}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{deploymentPipelineDraft.notes || t("page.settings.pipelineNotes")}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <StatusPill tone={deploymentPipelineDraft.dry_run ? "warn" : "ok"} label={deploymentPipelineDraft.dry_run ? t("page.settings.pipelineDryRun") : t("page.settings.pipelineCreate")} />
                        <StatusPill tone={deploymentPipelineDraft.approval_required ? "warn" : "ok"} label={deploymentPipelineDraft.approval_required ? t("page.settings.pipelineApprovalRequired") : t("page.settings.pipelineNoApproval", { defaultValue: "无需审批" })} />
                      </div>
                    </div>
                    <Button block type="primary" icon={<Rocket className="h-4 w-4" />} onClick={() => setDeploymentPipelineDrawerOpen(true)}>
                      {t("page.settings.pipelineOpenDrawer", { defaultValue: "配置发布流水线" })}
                    </Button>
                    {createDeploymentPipeline.error ? <ErrorLine message={(createDeploymentPipeline.error as Error).message} /> : null}
                    {deploymentPipelines.error ? <ErrorLine message={(deploymentPipelines.error as Error).message} /> : null}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.pipelineRecent")}</p>
                      <StatusPill tone={deploymentPipelineDetail?.item?.status === "failed" ? "danger" : deploymentPipelineDetail?.item?.status === "succeeded" ? "ok" : "warn"} label={deploymentPipelineDetail?.item?.status ? t(`page.settings.pipelineStatus.${deploymentPipelineDetail.item.status}`, { defaultValue: deploymentPipelineDetail.item.status }) : "-"} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(deploymentPipelines.data?.items || []).map((run: any) => (
                        <button
                          key={run.id}
                          type="button"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50"
                          disabled={loadDeploymentPipeline.isPending}
                          onClick={() => loadDeploymentPipeline.mutate(run.id)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs text-[var(--text)]">{run.version || run.package_id}</span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">{t(`page.settings.pipelineStatus.${run.status}`, { defaultValue: run.status })}</span>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${run.environment} / ${run.action} / ${run.stage_done}/${run.stage_total}`}</span>
                        </button>
                      ))}
                      {!deploymentPipelines.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.pipelineEmpty")}</p> : null}
                    </div>
                    {loadDeploymentPipeline.error ? <ErrorLine message={(loadDeploymentPipeline.error as Error).message} /> : null}
                  </div>
                </div>
                {deploymentPipelineDetail ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{deploymentPipelineDetail.item?.id}</p>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{deploymentPipelineDetail.item?.package_id}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {["approve", "start", "mark_success", "mark_failed", "cancel"].map((action) => (
                            <button
                              key={action}
                              type="button"
                              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                              disabled={applyDeploymentPipelineAction.isPending || !deploymentPipelineDetail.item?.id}
                              onClick={() => applyDeploymentPipelineAction.mutate({ runId: deploymentPipelineDetail.item.id, action })}
                            >
                              {t(`page.settings.pipelineControl.${action}`, { defaultValue: action })}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(deploymentPipelineDetail.run?.stages || []).map((stage: any) => (
                          <div key={stage.id} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface)] px-3 py-2">
                            <span className="truncate text-xs font-medium text-[var(--text)]">{t(`page.settings.pipelineStage.${stage.id}`, { defaultValue: stage.id })}</span>
                            <StatusPill tone={stage.status === "failed" ? "danger" : stage.status === "completed" ? "ok" : "warn"} label={t(`page.settings.pipelineStatus.${stage.status}`, { defaultValue: stage.status })} />
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.pipelineExecutorTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.pipelineExecutorDesc")}</p>
                          </div>
                          <StatusPill tone={deploymentPipelineDetail.item?.last_execution_status === "failed" ? "danger" : deploymentPipelineDetail.item?.last_execution_status === "succeeded" ? "ok" : "warn"} label={deploymentPipelineDetail.item?.last_execution_status || "EXEC"} />
                        </div>
                        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.pipelineExecutorTargetTitle")}</p>
                              <p className="mt-1 text-[11px] text-[var(--muted)]">{t("page.settings.pipelineExecutorTargetDesc")}</p>
                            </div>
                            <StatusPill tone={(deploymentExecutorTargets.data?.items || []).some((target: any) => target.enabled) ? "ok" : "warn"} label={`${deploymentExecutorTargets.data?.total || 0} ${t("page.settings.pipelineExecutorTargetCount")}`} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <input className={inputClass} value={deploymentExecutorTargetDraft.name} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, name: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetName")} />
                            <select className={inputClass} value={deploymentExecutorTargetDraft.target_type} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, target_type: e.target.value })}>
                              {["webhook", "github_actions", "gitlab_ci", "jenkins", "kubernetes_job", "temporal_workflow", "remote_agent"].map((type) => <option key={type} value={type}>{t(`page.settings.pipelineExecutorTargetType.${type}`, { defaultValue: type })}</option>)}
                            </select>
                            <input className={inputClass} value={deploymentExecutorTargetDraft.auth_ref} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, auth_ref: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetAuthRef")} />
                            <input className={inputClass} value={deploymentExecutorTargetDraft.callback_secret_ref} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, callback_secret_ref: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetCallbackSecretRef")} />
                            <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)]">
                              <input type="checkbox" checked={deploymentExecutorTargetDraft.enabled} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, enabled: e.target.checked })} />
                              {t("page.settings.pipelineExecutorTargetEnabled")}
                            </label>
                            <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)]">
                              <input type="checkbox" checked={deploymentExecutorTargetDraft.require_callback_signature} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, require_callback_signature: e.target.checked })} />
                              {t("page.settings.pipelineExecutorTargetRequireSignature")}
                            </label>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem_12rem]">
                            <input className={inputClass} value={deploymentExecutorTargetDraft.endpoint} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, endpoint: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetEndpoint")} />
                            <input className={inputClass} type="number" min={1} max={50} value={deploymentExecutorTargetDraft.concurrency_limit} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, concurrency_limit: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetConcurrency")} />
                            <input className={inputClass} type="number" min={5} max={3600} value={deploymentExecutorTargetDraft.timeout_seconds} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, timeout_seconds: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetTimeout")} />
                            <input className={inputClass} type="number" min={30} max={3600} value={deploymentExecutorTargetDraft.callback_skew_seconds} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, callback_skew_seconds: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetCallbackSkew")} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <input className={inputClass} value={deploymentExecutorTargetDraft.supports} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, supports: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetSupports")} />
                            <input className={inputClass} value={deploymentExecutorTargetDraft.labels} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, labels: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetLabels")} />
                          </div>
                          <textarea className={`${inputClass} mt-3 min-h-16`} value={deploymentExecutorTargetDraft.notes} onChange={(e) => setDeploymentExecutorTargetDraft({ ...deploymentExecutorTargetDraft, notes: e.target.value })} placeholder={t("page.settings.pipelineExecutorTargetNotes")} />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={saveDeploymentExecutorTarget.isPending || !deploymentExecutorTargetDraft.name.trim()} onClick={() => saveDeploymentExecutorTarget.mutate()}><Network className="h-4 w-4" />{deploymentExecutorTargetDraft.id ? t("page.settings.pipelineExecutorTargetUpdate") : t("page.settings.pipelineExecutorTargetCreate")}</button>
                            {deploymentExecutorTargetDraft.id ? (
                              <>
                                <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={applyDeploymentExecutorTargetAction.isPending} onClick={() => applyDeploymentExecutorTargetAction.mutate({ targetId: deploymentExecutorTargetDraft.id, action: "test" })}>{t("page.settings.pipelineExecutorTargetTest")}</button>
                                <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={applyDeploymentExecutorTargetAction.isPending} onClick={() => applyDeploymentExecutorTargetAction.mutate({ targetId: deploymentExecutorTargetDraft.id, action: deploymentExecutorTargetDraft.enabled ? "disable" : "enable" })}>{deploymentExecutorTargetDraft.enabled ? t("page.settings.pipelineExecutorTargetDisable") : t("page.settings.pipelineExecutorTargetEnable")}</button>
                                <button type="button" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={applyDeploymentExecutorTargetAction.isPending} onClick={() => applyDeploymentExecutorTargetAction.mutate({ targetId: deploymentExecutorTargetDraft.id, action: "delete" })}>{t("page.settings.pipelineExecutorTargetDelete")}</button>
                              </>
                            ) : null}
                          </div>
                          {saveDeploymentExecutorTarget.error ? <ErrorLine message={(saveDeploymentExecutorTarget.error as Error).message} /> : null}
                          {applyDeploymentExecutorTargetAction.error ? <ErrorLine message={(applyDeploymentExecutorTargetAction.error as Error).message} /> : null}
                          <div className="mt-3 grid gap-2 lg:grid-cols-2">
                            {(deploymentExecutorTargets.data?.items || []).slice(0, 6).map((target: any) => (
                              <button
                                key={target.id}
                                type="button"
                                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)]"
                                onClick={() => {
                                  setDeploymentExecutorTargetDraft({ id: target.id || "", name: target.name || "", target_type: target.target_type || "webhook", endpoint: target.endpoint || "", enabled: Boolean(target.enabled), supports: (target.supports || []).join(","), auth_ref: target.auth_ref || "", callback_secret_ref: target.callback_secret_ref || "", require_callback_signature: Boolean(target.require_callback_signature), callback_skew_seconds: String(target.callback_skew_seconds || 300), concurrency_limit: String(target.concurrency_limit || 1), timeout_seconds: String(target.timeout_seconds || 120), labels: mapToLines(target.labels), notes: target.notes || "" });
                                  setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, executor_id: target.id });
                                }}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-semibold text-[var(--text)]">{target.name || target.id}</p>
                                    <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${target.target_type || "-"} / ${target.endpoint || "-"}`}</p>
                                    <p className="mt-1 truncate text-[10px] text-[var(--muted)]">{target.require_callback_signature ? `${t("page.settings.pipelineExecutorTargetSigned")} / ${target.callback_secret_ref || "env://SOP_DEPLOY_CALLBACK_SECRET"}` : t("page.settings.pipelineExecutorTargetUnsigned")}</p>
                                  </div>
                                  <StatusPill tone={target.enabled ? "ok" : "warn"} label={target.last_check?.status || (target.enabled ? "enabled" : "disabled")} />
                                </div>
                              </button>
                            ))}
                            {!(deploymentExecutorTargets.data?.items || []).length ? <p className="text-xs text-[var(--muted)]">{t("page.settings.pipelineExecutorTargetEmpty")}</p> : null}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <select className={inputClass} value={deploymentPipelineExecuteDraft.executor_id} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, executor_id: e.target.value })}>
                            {(deploymentPipelineExecutors.data?.items || deploymentPipelineDetail.executors || deploymentPipelines.data?.executors || []).map((executor: any) => <option key={executor.id} value={executor.id}>{`${executor.name || executor.id} / ${executor.mode || "-"}`}</option>)}
                          </select>
                          <select className={inputClass} value={deploymentPipelineExecuteDraft.command_id} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, command_id: e.target.value })}>
                            <option value="">{t("page.settings.pipelineExecutorCommandPh")}</option>
                            {(deploymentPipelineDetail.run?.commands || []).map((command: any) => <option key={command.id} value={command.id}>{`${command.id} / ${command.intent}`}</option>)}
                          </select>
                          <select className={inputClass} value={deploymentPipelineExecuteDraft.stage_id} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, stage_id: e.target.value })}>
                            <option value="">{t("page.settings.pipelineExecutorStagePh")}</option>
                            {(deploymentPipelineDetail.run?.stages || []).map((stage: any) => <option key={stage.id} value={stage.id}>{t(`page.settings.pipelineStage.${stage.id}`, { defaultValue: stage.id })}</option>)}
                          </select>
                          <input className={inputClass} type="number" min={1} max={300} value={deploymentPipelineExecuteDraft.timeout_seconds} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, timeout_seconds: e.target.value })} placeholder={t("page.settings.pipelineExecutorTimeout")} />
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
                          <input className={inputClass} value={deploymentPipelineExecuteDraft.evidence_url} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, evidence_url: e.target.value })} placeholder={t("page.settings.pipelineExecutorEvidenceUrl")} />
                          <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--muted-strong)]">
                            <input type="checkbox" checked={deploymentPipelineExecuteDraft.allow_apply} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, allow_apply: e.target.checked })} />
                            {t("page.settings.pipelineExecutorAllowApply")}
                          </label>
                        </div>
                        <textarea className={`${inputClass} mt-3 min-h-16`} value={deploymentPipelineExecuteDraft.note} onChange={(e) => setDeploymentPipelineExecuteDraft({ ...deploymentPipelineExecuteDraft, note: e.target.value })} placeholder={t("page.settings.pipelineExecutorNote")} />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={executeDeploymentPipeline.isPending || !deploymentPipelineDetail.item?.id} onClick={() => executeDeploymentPipeline.mutate(true)}><Search className="h-4 w-4" />{t("page.settings.pipelineExecutorPlan")}</button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={executeDeploymentPipeline.isPending || !deploymentPipelineDetail.item?.id} onClick={() => executeDeploymentPipeline.mutate(false)}><PlayCircle className="h-4 w-4" />{t("page.settings.pipelineExecutorRun")}</button>
                        </div>
                        {executeDeploymentPipeline.error ? <ErrorLine message={(executeDeploymentPipeline.error as Error).message} /> : null}
                        {deploymentPipelineDetail.result ? <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(deploymentPipelineDetail.result, null, 2)}</pre> : null}
                        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.pipelineExternalCallbackTitle")}</p>
                              <p className="mt-1 text-[11px] text-[var(--muted)]">{t("page.settings.pipelineExternalCallbackDesc")}</p>
                            </div>
                            <StatusPill tone={(deploymentPipelineDetail.run?.executions || []).some((execution: any) => execution.status === "queued" || execution.status === "running") ? "warn" : "ok"} label={`${(deploymentPipelineDetail.run?.executions || []).length} ${t("page.settings.pipelineExternalCallbackExecutions")}`} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <select className={inputClass} value={deploymentPipelineCallbackDraft.execution_id} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, execution_id: e.target.value })}>
                              <option value="">{t("page.settings.pipelineExternalCallbackExecutionPh")}</option>
                              {(deploymentPipelineDetail.run?.executions || []).slice().reverse().map((execution: any) => <option key={execution.id} value={execution.id}>{`${execution.id} / ${execution.command_id || "-"} / ${execution.status || "-"}`}</option>)}
                            </select>
                            <select className={inputClass} value={deploymentPipelineCallbackDraft.status} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, status: e.target.value })}>
                              {["running", "succeeded", "failed", "blocked", "cancelled"].map((status) => <option key={status} value={status}>{t(`page.settings.pipelineStatus.${status}`, { defaultValue: status })}</option>)}
                            </select>
                            <input className={inputClass} value={deploymentPipelineCallbackDraft.external_run_id} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, external_run_id: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackRunId")} />
                            <input className={inputClass} type="number" value={deploymentPipelineCallbackDraft.exit_code} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, exit_code: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackExitCode")} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <input className={inputClass} value={deploymentPipelineCallbackDraft.evidence_url} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, evidence_url: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackEvidence")} />
                            <input className={inputClass} value={deploymentPipelineCallbackDraft.metadata} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, metadata: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackMetadata")} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-[10rem_12rem_minmax(0,1fr)]">
                            <input className={inputClass} type="number" value={deploymentPipelineCallbackDraft.timestamp} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, timestamp: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackTimestamp")} />
                            <input className={inputClass} value={deploymentPipelineCallbackDraft.nonce} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, nonce: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackNonce")} />
                            <input className={inputClass} value={deploymentPipelineCallbackDraft.signature} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, signature: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackSignature")} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <textarea className={`${inputClass} min-h-16`} value={deploymentPipelineCallbackDraft.stdout} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, stdout: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackStdout")} />
                            <textarea className={`${inputClass} min-h-16`} value={deploymentPipelineCallbackDraft.stderr} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, stderr: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackStderr")} />
                          </div>
                          <textarea className={`${inputClass} mt-3 min-h-14`} value={deploymentPipelineCallbackDraft.note} onChange={(e) => setDeploymentPipelineCallbackDraft({ ...deploymentPipelineCallbackDraft, note: e.target.value })} placeholder={t("page.settings.pipelineExternalCallbackNote")} />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={callbackDeploymentPipelineExecution.isPending || !deploymentPipelineDetail.item?.id || !deploymentPipelineCallbackDraft.execution_id} onClick={() => callbackDeploymentPipelineExecution.mutate()}><Send className="h-4 w-4" />{t("page.settings.pipelineExternalCallbackSubmit")}</button>
                          </div>
                          {callbackDeploymentPipelineExecution.error ? <ErrorLine message={(callbackDeploymentPipelineExecution.error as Error).message} /> : null}
                        </div>
                      </div>
                      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.pipelineRemediationTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.pipelineRemediationDesc")}</p>
                          </div>
                          <StatusPill tone={(deploymentPipelineDetail.result?.summary?.high || deploymentPipelineDetail.run?.self_heal?.summary?.high || 0) > 0 ? "danger" : (deploymentPipelineDetail.result?.summary?.findings || deploymentPipelineDetail.run?.self_heal?.summary?.findings || 0) > 0 ? "warn" : "ok"} label={`${deploymentPipelineDetail.result?.summary?.findings ?? deploymentPipelineDetail.run?.self_heal?.summary?.findings ?? 0} ${t("page.settings.pipelineRemediationFindings")}`} />
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <select className={inputClass} value={deploymentPipelineRemediationDraft.priority} onChange={(e) => setDeploymentPipelineRemediationDraft({ ...deploymentPipelineRemediationDraft, priority: e.target.value })}>
                            {["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{`${t("page.settings.pipelineRemediationPriority")} ${priority}`}</option>)}
                          </select>
                          <input className={inputClass} value={deploymentPipelineRemediationDraft.assigned_to} onChange={(e) => setDeploymentPipelineRemediationDraft({ ...deploymentPipelineRemediationDraft, assigned_to: e.target.value })} placeholder={t("page.settings.pipelineRemediationAssignee")} />
                          <input className={inputClass} value={deploymentPipelineRemediationDraft.dev_tool} onChange={(e) => setDeploymentPipelineRemediationDraft({ ...deploymentPipelineRemediationDraft, dev_tool: e.target.value })} placeholder={t("page.settings.pipelineRemediationDevTool")} />
                          <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--muted-strong)]">
                            <input type="checkbox" checked={deploymentPipelineRemediationDraft.include_low} onChange={(e) => setDeploymentPipelineRemediationDraft({ ...deploymentPipelineRemediationDraft, include_low: e.target.checked })} />
                            {t("page.settings.pipelineRemediationIncludeLow")}
                          </label>
                        </div>
                        <textarea className={`${inputClass} mt-3 min-h-16`} value={deploymentPipelineRemediationDraft.note} onChange={(e) => setDeploymentPipelineRemediationDraft({ ...deploymentPipelineRemediationDraft, note: e.target.value })} placeholder={t("page.settings.pipelineRemediationNote")} />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={remediateDeploymentPipeline.isPending || !deploymentPipelineDetail.item?.id} onClick={() => remediateDeploymentPipeline.mutate(true)}><ShieldCheck className="h-4 w-4" />{t("page.settings.pipelineRemediationPreview")}</button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={remediateDeploymentPipeline.isPending || !deploymentPipelineDetail.item?.id} onClick={() => remediateDeploymentPipeline.mutate(false)}><ListChecks className="h-4 w-4" />{t("page.settings.pipelineRemediationCreateTasks")}</button>
                        </div>
                        {remediateDeploymentPipeline.error ? <ErrorLine message={(remediateDeploymentPipeline.error as Error).message} /> : null}
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          {[
                            ["high", deploymentPipelineDetail.result?.summary?.high ?? deploymentPipelineDetail.run?.self_heal?.summary?.high ?? 0],
                            ["medium", deploymentPipelineDetail.result?.summary?.medium ?? deploymentPipelineDetail.run?.self_heal?.summary?.medium ?? 0],
                            ["created", deploymentPipelineDetail.result?.created?.length ?? deploymentPipelineDetail.item?.self_heal_task_count ?? 0],
                          ].map(([key, value]) => (
                            <div key={key} className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t(`page.settings.pipelineRemediationMetric.${key}`)}</p>
                              <p className="mt-1 text-lg font-bold text-[var(--text)]">{value}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 grid gap-3 xl:grid-cols-2">
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.pipelineRemediationFindings")}</p>
                            <div className="mt-2 space-y-2">
                              {(deploymentPipelineDetail.result?.findings || deploymentPipelineDetail.run?.self_heal?.findings || []).slice(0, 6).map((finding: any) => (
                                <div key={finding.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                                  <div className="flex items-start justify-between gap-3">
                                    <p className="font-semibold text-[var(--text)]">{finding.title || finding.id}</p>
                                    <StatusPill tone={finding.severity === "high" ? "danger" : finding.severity === "medium" ? "warn" : "ok"} label={t(`page.settings.pipelineRemediationSeverity.${finding.severity}`, { defaultValue: finding.severity })} />
                                  </div>
                                  <p className="mt-1 text-[var(--muted)]">{finding.recommendation}</p>
                                </div>
                              ))}
                              {!(deploymentPipelineDetail.result?.findings || deploymentPipelineDetail.run?.self_heal?.findings || []).length ? <p className="text-xs text-[var(--muted)]">{t("page.settings.pipelineRemediationEmpty")}</p> : null}
                            </div>
                          </div>
                          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                            <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.pipelineRemediationRunbook")}</p>
                            <div className="mt-2 space-y-2">
                              {(deploymentPipelineDetail.result?.runbook?.steps || deploymentPipelineDetail.run?.self_heal?.runbook?.steps || []).slice(0, 6).map((step: any) => (
                                <div key={step.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="truncate font-semibold text-[var(--text)]">{step.title || step.id}</p>
                                    <StatusPill tone={step.status === "completed" ? "ok" : "warn"} label={step.status || "pending"} />
                                  </div>
                                  <p className="mt-1 truncate text-[var(--muted)]">{step.api || step.owner || "-"}</p>
                                </div>
                              ))}
                              {!(deploymentPipelineDetail.result?.runbook?.steps || deploymentPipelineDetail.run?.self_heal?.runbook?.steps || []).length ? <p className="text-xs text-[var(--muted)]">{t("page.settings.pipelineRemediationEmpty")}</p> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                      {applyDeploymentPipelineAction.error ? <ErrorLine message={(applyDeploymentPipelineAction.error as Error).message} /> : null}
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.pipelineEvidence")}</p>
                      <div className="mt-3 space-y-2">
                        {(deploymentPipelineDetail.run?.events || []).slice(-5).reverse().map((event: any) => (
                          <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                            <p className="font-semibold text-[var(--text)]">{t(`page.settings.pipelineEvent.${event.kind}`, { defaultValue: event.kind })}</p>
                            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              {exportBundle.error ? <ErrorLine message={(exportBundle.error as Error).message} /> : null}
              {opsProfiles.data?.config_path ? <p className="break-all text-xs text-[var(--muted)]">{opsProfiles.data.config_path}</p> : null}
              {opsProfiles.isError ? <ErrorLine message={(opsProfiles.error as Error).message} /> : null}
            </div>
          </div>
        </Card>
        <Drawer
          title={t("page.settings.profileEdit")}
          open={profileDrawerOpen}
          onClose={() => setProfileDrawerOpen(false)}
          width={620}
          destroyOnHidden
          extra={
            <Space>
              <Button onClick={() => setProfileDrawerOpen(false)}>{t("common.cancel")}</Button>
              <Button type="primary" loading={saveProfile.isPending} disabled={!profileDraft.name.trim()} onClick={() => saveProfile.mutate()}>
                {t("page.settings.profileSave")}
              </Button>
            </Space>
          }
        >
          <div className="space-y-4">
            <Steps
              size="small"
              current={1}
              items={[
                { title: t("page.settings.profileStepScope", { defaultValue: "范围" }) },
                { title: t("page.settings.profileStepRuntime", { defaultValue: "运行" }) },
                { title: t("page.settings.profileStepEvidence", { defaultValue: "证据" }) },
              ]}
            />
            <Form
              layout="vertical"
              onFinish={() => {
                if (profileDraft.name.trim()) saveProfile.mutate();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Form.Item label={t("page.settings.profile")} required>
                  <Input value={profileDraft.name} onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })} placeholder="local-dev" />
                </Form.Item>
                <Form.Item label={t("page.settings.mode")} required>
                  <Select
                    value={profileDraft.mode}
                    onChange={(value) => setProfileDraft({ ...profileDraft, mode: value })}
                    options={["local", "single", "saas", "private"].map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
                <Form.Item label={t("page.settings.database")} required>
                  <Select
                    value={profileDraft.database}
                    onChange={(value) => setProfileDraft({ ...profileDraft, database: value })}
                    options={["sqlite", "postgresql", "mysql", "oceanbase"].map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
              </div>
              <Form.Item label="MANAGER_URL">
                <Input value={profileDraft.manager_url} onChange={(e) => setProfileDraft({ ...profileDraft, manager_url: e.target.value })} placeholder="http://localhost:8765" />
              </Form.Item>
              <Form.Item label="MANAGER_PUBLIC_URL">
                <Input value={profileDraft.public_url} onChange={(e) => setProfileDraft({ ...profileDraft, public_url: e.target.value })} placeholder="https://manager.example.com" />
              </Form.Item>
              <Form.Item label={t("page.settings.profileFeatures", { defaultValue: "能力开关" })}>
                <Input value={profileDraft.features} onChange={(e) => setProfileDraft({ ...profileDraft, features: e.target.value })} placeholder="billing=true,sso=true,worker=true" />
              </Form.Item>
              <Form.Item label={t("page.settings.profileEnv", { defaultValue: "环境变量" })}>
                <Input.TextArea
                  rows={7}
                  className="font-mono text-xs"
                  value={profileDraft.env}
                  onChange={(e) => setProfileDraft({ ...profileDraft, env: e.target.value })}
                  placeholder={"ADMIN_MODE=saas\nDB_TYPE=postgresql"}
                />
              </Form.Item>
              <Form.Item label={t("page.settings.profileNotes")}>
                <Input.TextArea rows={3} value={profileDraft.notes} onChange={(e) => setProfileDraft({ ...profileDraft, notes: e.target.value })} placeholder={t("page.settings.profileNotes")} />
              </Form.Item>
              {saveProfile.error ? <ErrorLine message={(saveProfile.error as Error).message} /> : null}
              <Button className="w-full" htmlType="submit" type="primary" loading={saveProfile.isPending} disabled={!profileDraft.name.trim()}>
                {t("page.settings.profileSave")}
              </Button>
            </Form>
          </div>
        </Drawer>
        <Drawer
          title={t("page.settings.pipelineTitle")}
          open={deploymentPipelineDrawerOpen}
          onClose={() => setDeploymentPipelineDrawerOpen(false)}
          width={640}
          destroyOnHidden
          extra={
            <Space>
              <Button onClick={() => setDeploymentPipelineDrawerOpen(false)}>{t("common.cancel")}</Button>
              <Button loading={createDeploymentPipeline.isPending} disabled={!selectedDeploymentPackageId} onClick={() => createDeploymentPipeline.mutate(true)}>
                {t("page.settings.pipelinePreview")}
              </Button>
              <Button type="primary" loading={createDeploymentPipeline.isPending} disabled={!selectedDeploymentPackageId || deploymentPipelineDraft.action === "preview"} onClick={() => createDeploymentPipeline.mutate(false)}>
                {t("page.settings.pipelineCreate")}
              </Button>
            </Space>
          }
        >
          <div className="space-y-4">
            <Steps
              size="small"
              current={deploymentPipelineDraft.action === "preview" || deploymentPipelineDraft.dry_run ? 0 : 1}
              items={[
                { title: t("page.settings.pipelinePreview", { defaultValue: "预览" }) },
                { title: t("page.settings.pipelineCreate", { defaultValue: "创建" }) },
                { title: t("page.settings.pipelineEvidence", { defaultValue: "证据" }) },
              ]}
            />
            <Form layout="vertical">
              <Form.Item label={t("page.settings.deployPackage")} required>
                <Select
                  value={selectedDeploymentPackageId || undefined}
                  placeholder={t("page.settings.pipelinePackagePh")}
                  onChange={(value) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, package_id: value })}
                  options={(deploymentPackages.data?.items || []).map((item: any) => ({ value: item.id, label: `${item.version} / ${item.channel}` }))}
                />
              </Form.Item>
              <div className="grid gap-3 sm:grid-cols-2">
                <Form.Item label={t("page.settings.pipelineEnvironmentLabel", { defaultValue: "环境" })} required>
                  <Select
                    value={deploymentPipelineDraft.environment}
                    onChange={(value) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, environment: value })}
                    options={["dev", "staging", "production", "rollback"].map((value) => ({ value, label: t(`page.settings.pipelineEnvironment.${value}`, { defaultValue: value }) }))}
                  />
                </Form.Item>
                <Form.Item label={t("page.settings.pipelineActionLabel", { defaultValue: "动作" })} required>
                  <Select
                    value={deploymentPipelineDraft.action}
                    onChange={(value) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, action: value, dry_run: value === "preview" ? true : deploymentPipelineDraft.dry_run })}
                    options={["preview", "deploy", "rollback"].map((value) => ({ value, label: t(`page.settings.pipelineAction.${value}`, { defaultValue: value }) }))}
                  />
                </Form.Item>
              </div>
              <Form.Item label={t("page.settings.pipelineOperator")}>
                <Input value={deploymentPipelineDraft.operator} onChange={(e) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, operator: e.target.value })} placeholder={me.data?.username || me.data?.email || "ops-admin"} />
              </Form.Item>
              <div className="grid gap-3 sm:grid-cols-2">
                <Form.Item label={t("page.settings.pipelineDryRun")}>
                  <Switch checked={deploymentPipelineDraft.dry_run} onChange={(checked) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, dry_run: checked, action: checked ? "preview" : deploymentPipelineDraft.action })} />
                </Form.Item>
                <Form.Item label={t("page.settings.pipelineApprovalRequired")}>
                  <Switch checked={deploymentPipelineDraft.approval_required} onChange={(checked) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, approval_required: checked })} />
                </Form.Item>
              </div>
              <Form.Item label={t("page.settings.pipelineNotes")}>
                <Input.TextArea rows={4} value={deploymentPipelineDraft.notes} onChange={(e) => setDeploymentPipelineDraft({ ...deploymentPipelineDraft, notes: e.target.value })} placeholder={t("page.settings.pipelineNotes")} />
              </Form.Item>
              {createDeploymentPipeline.error ? <ErrorLine message={(createDeploymentPipeline.error as Error).message} /> : null}
              {deploymentPipelineDetail?.result ? <pre className="max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(deploymentPipelineDetail.result, null, 2)}</pre> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <Button loading={createDeploymentPipeline.isPending} disabled={!selectedDeploymentPackageId} onClick={() => createDeploymentPipeline.mutate(true)}>
                  {t("page.settings.pipelinePreview")}
                </Button>
                <Button type="primary" loading={createDeploymentPipeline.isPending} disabled={!selectedDeploymentPackageId || deploymentPipelineDraft.action === "preview"} onClick={() => createDeploymentPipeline.mutate(false)}>
                  {t("page.settings.pipelineCreate")}
                </Button>
              </div>
            </Form>
          </div>
        </Drawer>
        </>
      ) : null}

      {activeModule === "storage" ? (
        <Card
          title={t("page.settings.storageCard")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                disabled={opsStorageMigrationPlan.isFetching}
                onClick={() => void opsStorageMigrationPlan.refetch()}
              >
                {t("common.refresh")}
              </button>
              <button
                type="button"
                className="rounded-xl bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                disabled={runStorageSmoke.isPending}
                onClick={() => runStorageSmoke.mutate()}
              >
                {t("page.settings.storageRunSmoke")}
              </button>
            </div>
          }
        >
          <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                    <Database className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.storageTarget")}</p>
                    <p className="truncate text-xs text-[var(--muted)]">{String(opsStorageMigrationPlan.data?.target?.database || "oceanbase")} / {String(opsStorageMigrationPlan.data?.target?.mode || "mysql")}</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  <Info label={t("page.settings.storageCurrentDb")} value={String(opsStorageMigrationPlan.data?.current?.db_type || "-")} />
                  <Info label={t("page.settings.storageCharset")} value={String(opsStorageMigrationPlan.data?.target?.charset || "-")} />
                  <Info label={t("page.settings.storageMigrationFiles")} value={String(opsStorageMigrationPlan.data?.migrations?.length ?? 0)} />
                  <Info label={t("page.settings.storageSqlitePath")} value={String(opsStorageMigrationPlan.data?.current?.sqlite_dev_path || "-")} />
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.storageSmokeChecks")}</p>
                <div className="mt-3 space-y-2">
                  {(storageSmokeResult?.checks || []).map((check: any) => (
                    <div key={check.id} className="flex items-start justify-between gap-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-[var(--text)]">{check.id}</p>
                        <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{check.message}</p>
                      </div>
                      <StatusPill tone={check.ok ? "ok" : "danger"} label={check.ok ? "OK" : "FAIL"} />
                    </div>
                  ))}
                  {!storageSmokeResult?.checks?.length ? <p className="text-sm text-[var(--muted)]">{t("page.settings.storageSmokeEmpty")}</p> : null}
                </div>
                {runStorageSmoke.error ? <ErrorLine message={(runStorageSmoke.error as Error).message} /> : null}
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <MetricBox label={t("page.settings.storageCoreTables")} value={opsStorageMigrationPlan.data?.core_tables?.length ?? 0} />
                <MetricBox label={t("page.settings.storageScopeColumns")} value={opsStorageMigrationPlan.data?.scope_columns?.length ?? 0} />
                <MetricBox label={t("page.settings.storageScopeIndexes")} value={opsStorageMigrationPlan.data?.scope_indexes?.length ?? 0} />
              </div>

              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="grid grid-cols-[1fr_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
                  <span>{t("page.settings.storageMigration")}</span>
                  <span>{t("page.settings.storageBytes")}</span>
                </div>
                {(opsStorageMigrationPlan.data?.migrations || []).map((migration: any) => (
                  <div key={migration.id} className="grid grid-cols-[1fr_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-[var(--text)]">{migration.id}</p>
                      <p className="truncate text-[11px] text-[var(--muted)]">{migration.file}</p>
                    </div>
                    <p className="text-right font-mono text-xs text-[var(--muted-strong)]">{formatBytes(migration.bytes)}</p>
                  </div>
                ))}
                {!opsStorageMigrationPlan.data?.migrations?.length ? <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.storageNoMigrations")}</div> : null}
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.storageBackupRestore")}</p>
                <div className="mt-3 space-y-2">
                  {(opsStorageMigrationPlan.data?.backup_restore_checklist || []).map((item: string, index: number) => (
                    <div key={`${index}-${item}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-xs">
                      <span className="font-mono text-[var(--brand)]">{index + 1}</span>
                      <span className="leading-5 text-[var(--muted-strong)]">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {opsStorageMigrationPlan.isError ? <ErrorLine message={(opsStorageMigrationPlan.error as Error).message} /> : null}
            </div>
          </div>
        </Card>
      ) : null}

      {activeModule === "sso" ? (
        <Card
          title={t("page.settings.ssoCard")}
          actions={<StatusPill tone={ssoConfig.data?.enabled ? "ok" : ssoConfig.isError ? "danger" : "warn"} label={ssoConfig.data?.enabled ? "SSO" : "OFF"} />}
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(26rem,0.9fr)_minmax(0,1.1fr)]">
            <form
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!ssoDraft.provider.trim()) return;
                saveSso.mutate();
              }}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  <KeyRound className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoProvider")}</p>
                  <p className="text-xs text-[var(--muted)]">{t("page.settings.ssoDesc")}</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className={inputClass} value={ssoDraft.provider} onChange={(e) => setSsoDraft({ ...ssoDraft, provider: e.target.value })} placeholder="okta" />
                  <select className={inputClass} value={ssoDraft.type} onChange={(e) => setSsoDraft({ ...ssoDraft, type: e.target.value })}>
                    <option value="oidc">OIDC</option>
                    <option value="saml">SAML</option>
                  </select>
                </div>
                <input className={inputClass} value={ssoDraft.issuer} onChange={(e) => setSsoDraft({ ...ssoDraft, issuer: e.target.value })} placeholder={ssoDraft.type === "saml" ? "SAML issuer / entityID" : "https://idp.example.com/oauth2/default"} />
                <input className={inputClass} value={ssoDraft.client_id} onChange={(e) => setSsoDraft({ ...ssoDraft, client_id: e.target.value })} placeholder="client_id" />
                <input className={inputClass} type="password" value={ssoDraft.client_secret} onChange={(e) => setSsoDraft({ ...ssoDraft, client_secret: e.target.value })} placeholder={t("page.settings.ssoSecretPh")} />
                <input className={inputClass} value={ssoDraft.redirect_uri} onChange={(e) => setSsoDraft({ ...ssoDraft, redirect_uri: e.target.value })} placeholder="http://localhost:8000/api/v1/sso/okta/callback" />
                <input className={inputClass} value={ssoDraft.type === "saml" ? ssoDraft.metadata_url : ssoDraft.scope} onChange={(e) => setSsoDraft(ssoDraft.type === "saml" ? { ...ssoDraft, metadata_url: e.target.value } : { ...ssoDraft, scope: e.target.value })} placeholder={ssoDraft.type === "saml" ? "metadata_url" : "openid profile email groups"} />
                {ssoDraft.type === "saml" ? (
                  <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input className={inputClass} value={ssoDraft.sso_url} onChange={(e) => setSsoDraft({ ...ssoDraft, sso_url: e.target.value })} placeholder={t("page.settings.ssoSamlSsoUrlPh")} />
                      <input className={inputClass} value={ssoDraft.name_id_format} onChange={(e) => setSsoDraft({ ...ssoDraft, name_id_format: e.target.value })} placeholder={t("page.settings.ssoSamlNameIdPh")} />
                    </div>
                    <textarea className={`${inputClass} min-h-24 font-mono text-xs`} value={ssoDraft.x509_cert} onChange={(e) => setSsoDraft({ ...ssoDraft, x509_cert: e.target.value })} placeholder={t("page.settings.ssoSamlCertPh")} />
                    <div className="grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-2">
                      <a className="break-all rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-[var(--brand)]" href={`/api/v1/sso/${encodeURIComponent(ssoDraft.provider || "saml")}/saml/metadata`} target="_blank" rel="noreferrer">
                        {t("page.settings.ssoSamlMetadata")}
                      </a>
                      <a className="break-all rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-[var(--brand)]" href={`/api/v1/sso/${encodeURIComponent(ssoDraft.provider || "saml")}/saml/login?redirect=${encodeURIComponent(currentRedirectTarget())}`} target="_blank" rel="noreferrer">
                        {t("page.settings.ssoSamlLogin")}
                      </a>
                    </div>
                  </div>
                ) : null}
                <label className="block text-xs font-medium text-[var(--muted)]">
                  {t("page.settings.ssoTenantMap")}
                  <textarea className={`${inputClass} mt-1 min-h-20 font-mono text-xs`} value={ssoDraft.tenant_domain_map} onChange={(e) => setSsoDraft({ ...ssoDraft, tenant_domain_map: e.target.value })} placeholder={t("page.settings.ssoTenantMapPh")} />
                </label>
                <label className="block text-xs font-medium text-[var(--muted)]">
                  {t("page.settings.ssoRoleMap")}
                  <textarea className={`${inputClass} mt-1 min-h-24 font-mono text-xs`} value={ssoDraft.role_map} onChange={(e) => setSsoDraft({ ...ssoDraft, role_map: e.target.value })} placeholder={t("page.settings.ssoRoleMapPh")} />
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                  <input type="checkbox" checked={ssoDraft.enabled} onChange={(e) => setSsoDraft({ ...ssoDraft, enabled: e.target.checked })} />
                  {t("page.settings.ssoEnabled")}
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                  <input type="checkbox" checked={ssoDraft.scim_enabled} onChange={(e) => setSsoDraft({ ...ssoDraft, scim_enabled: e.target.checked })} />
                  {t("page.settings.ssoScimEnabled")}
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="submit" className="rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={saveSso.isPending || !ssoDraft.provider.trim()}>
                    {t("page.settings.ssoSave")}
                  </button>
                  <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={testSso.isPending || !ssoDraft.provider.trim()} onClick={() => testSso.mutate(ssoDraft.provider)}>
                    {t("page.settings.ssoTest")}
                  </button>
                </div>
                {saveSso.error ? <ErrorLine message={(saveSso.error as Error).message} /> : null}
                {testSso.error ? <ErrorLine message={(testSso.error as Error).message} /> : null}
                {ssoTestResult ? <pre className="max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(ssoTestResult, null, 2)}</pre> : null}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoScimTitle")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoScimDesc")}</p>
                    </div>
                    <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] disabled:opacity-50" disabled={rotateScimToken.isPending || !ssoDraft.provider.trim()} onClick={() => rotateScimToken.mutate()}>
                      {t("page.settings.ssoScimRotate")}
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-[var(--muted)]">
                    <span className="break-all rounded-lg bg-[var(--surface-muted)] px-3 py-2">{`${window.location.origin}/api/v1/sso/scim/v2/${encodeURIComponent(ssoDraft.provider || "provider")}/Users`}</span>
                    <span className="break-all rounded-lg bg-[var(--surface-muted)] px-3 py-2">{`${window.location.origin}/api/v1/sso/scim/v2/${encodeURIComponent(ssoDraft.provider || "provider")}/Groups/{role}`}</span>
                    <span className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">{t("page.settings.ssoScimGroupHint")}</span>
                    {scimTokenResult?.token ? <pre className="max-h-28 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{scimTokenResult.token}</pre> : null}
                  </div>
                  {rotateScimToken.error ? <ErrorLine message={(rotateScimToken.error as Error).message} /> : null}
                </div>
              </div>
            </form>
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {(ssoConfig.data?.templates || []).map((tpl: any) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]"
                    onClick={() => setSsoDraft({
                      ...ssoDraft,
                      provider: tpl.id,
                      type: tpl.type,
                      issuer: tpl.issuer_hint || "",
                      redirect_uri: tpl.redirect_hint || "",
                      metadata_url: tpl.metadata_hint || "",
                      sso_url: tpl.sso_url_hint || "",
                      name_id_format: tpl.name_id_format || ssoDraft.name_id_format,
                      scope: tpl.scope || ssoDraft.scope,
                    })}
                  >
                    <span className="text-sm font-semibold text-[var(--text)]">{tpl.name}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--muted)]">{tpl.issuer_hint}</span>
                  </button>
                ))}
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoPreview")}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoPreviewDesc")}</p>
                    </div>
                    <StatusPill tone={ssoPreviewResult?.ok ? "ok" : "warn"} label={ssoPreviewResult?.role || "JIT"} />
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <input className={inputClass} value={ssoPreviewDraft.email} onChange={(e) => setSsoPreviewDraft({ ...ssoPreviewDraft, email: e.target.value })} placeholder={t("page.settings.ssoPreviewEmail")} />
                    <input className={inputClass} value={ssoPreviewDraft.groups} onChange={(e) => setSsoPreviewDraft({ ...ssoPreviewDraft, groups: e.target.value })} placeholder={t("page.settings.ssoPreviewGroups")} />
                  </div>
                  <button
                    type="button"
                    className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
                    disabled={previewSsoRole.isPending || !ssoDraft.provider.trim()}
                    onClick={() => previewSsoRole.mutate()}
                  >
                    {t("page.settings.ssoPreviewRun")}
                  </button>
                  {previewSsoRole.error ? <ErrorLine message={(previewSsoRole.error as Error).message} /> : null}
                  {ssoPreviewResult ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Info label={t("auth.tenant")} value={String(ssoPreviewResult.tenant || "-")} />
                      <Info label={t("auth.role")} value={String(ssoPreviewResult.role || "-")} />
                      <Info label={t("page.settings.ssoGroups")} value={(ssoPreviewResult.groups || []).join(",") || "-"} />
                    </div>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRoles")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(ssoConfig.data?.roles || []).map((role: string) => (
                      <span key={role} className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 font-mono text-[11px] text-[var(--muted-strong)]">{role}</span>
                    ))}
                  </div>
                  <div className="mt-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-xs leading-5 text-[var(--muted-strong)]">
                    <span className="font-semibold text-[var(--text)]">{t("page.settings.ssoSamlDependency")}: </span>
                    {ssoConfig.data?.saml_dependency?.installed ? `${ssoConfig.data.saml_dependency.package} ${ssoConfig.data.saml_dependency.version || ""}` : ssoConfig.data?.saml_dependency?.install_hint || "python3-saml"}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t("page.settings.ssoJitDesc")}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoScimTest")}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoScimTestDesc")}</p>
                  </div>
                  <StatusPill tone={scimTestResult?.ok ? "ok" : "warn"} label={scimTestDraft.apply ? "APPLY" : "DRY"} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input className={inputClass} value={scimTestDraft.userName} onChange={(e) => setScimTestDraft({ ...scimTestDraft, userName: e.target.value })} placeholder={t("page.settings.ssoScimUserName")} />
                  <input className={inputClass} value={scimTestDraft.displayName} onChange={(e) => setScimTestDraft({ ...scimTestDraft, displayName: e.target.value })} placeholder={t("page.settings.ssoScimDisplayName")} />
                  <input className={inputClass} value={scimTestDraft.groups} onChange={(e) => setScimTestDraft({ ...scimTestDraft, groups: e.target.value })} placeholder={t("page.settings.ssoPreviewGroups")} />
                  <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-strong)]">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={scimTestDraft.active} onChange={(e) => setScimTestDraft({ ...scimTestDraft, active: e.target.checked })} />{t("page.settings.ssoScimActive")}</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={scimTestDraft.apply} onChange={(e) => setScimTestDraft({ ...scimTestDraft, apply: e.target.checked })} />{t("page.settings.ssoScimApply")}</label>
                  </div>
                </div>
                <button type="button" className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={testScimUser.isPending || !ssoDraft.provider.trim()} onClick={() => testScimUser.mutate()}>
                  {t("page.settings.ssoScimRun")}
                </button>
                {testScimUser.error ? <ErrorLine message={(testScimUser.error as Error).message} /> : null}
                {scimTestResult ? <pre className="mt-3 max-h-52 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(scimTestResult, null, 2)}</pre> : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRiskTitle")}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoRiskDesc")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill
                      tone={ssoRiskReport.data?.status === "risk" ? "danger" : ssoRiskReport.data?.status === "watch" ? "warn" : "ok"}
                      label={String(ssoRiskReport.data?.score ?? "-")}
                    />
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] disabled:opacity-50"
                      disabled={!selectedSsoProviderExists || ssoRiskReport.isFetching}
                      onClick={() => void ssoRiskReport.refetch()}
                    >
                      {t("page.settings.ssoRiskRefresh")}
                    </button>
                  </div>
                </div>
                {!selectedSsoProviderExists ? (
                  <HintLine message={t("page.settings.ssoRiskNoProvider")} />
                ) : ssoRiskReport.error ? (
                  <ErrorLine message={(ssoRiskReport.error as Error).message} />
                ) : (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <Info label={t("page.settings.ssoRiskScore")} value={String(ssoRiskReport.data?.score ?? "-")} />
                      <Info label={t("page.settings.ssoRiskStatus")} value={String(ssoRiskReport.data?.status || "-")} />
                      <Info label={t("page.settings.ssoRiskFindings")} value={String(ssoRiskReport.data?.summary?.findings || 0)} />
                      <Info label={t("page.settings.ssoRiskHigh")} value={String(ssoRiskReport.data?.summary?.high || 0)} />
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                        <div className="grid min-w-[42rem] grid-cols-[7rem_1fr_1fr] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                          <span>{t("page.settings.ssoRiskSeverity")}</span>
                          <span>{t("page.settings.ssoRiskFinding")}</span>
                          <span>{t("page.settings.ssoRiskRecommendation")}</span>
                        </div>
                        {(ssoRiskReport.data?.findings || []).length ? (ssoRiskReport.data.findings || []).map((finding: any) => (
                          <div key={finding.id} className="grid min-w-[42rem] grid-cols-[7rem_1fr_1fr] gap-3 border-b border-[var(--border)] px-3 py-2 text-xs last:border-0">
                            <span className="font-mono text-[var(--muted-strong)]">{finding.severity}</span>
                            <span className="text-[var(--text)]">{String(t(`page.settings.ssoRiskKind.${finding.kind}`, { ...(finding.params || {}), defaultValue: finding.kind }))}</span>
                            <span className="text-[var(--muted-strong)]">{String(t(`page.settings.ssoRiskAction.${finding.recommendation_key || finding.kind}`, { ...(finding.params || {}), defaultValue: finding.recommendation_key || finding.kind }))}</span>
                          </div>
                        )) : (
                          <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">{t("page.settings.ssoRiskEmpty")}</div>
                        )}
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskActionPlan")}</p>
                        <div className="mt-3 space-y-2">
                          {(ssoRiskReport.data?.action_plan || []).length ? (ssoRiskReport.data.action_plan || []).map((action: any) => (
                            <div key={`${action.order}-${action.kind}`} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[var(--muted)]">#{action.order}</span>
                                <span className="font-mono text-[var(--muted-strong)]">{action.severity}</span>
                              </div>
                              <p className="mt-1 text-[var(--text)]">{String(t(`page.settings.ssoRiskAction.${action.action_key}`, { defaultValue: action.action_key }))}</p>
                            </div>
                          )) : (
                            <p className="text-xs text-[var(--muted)]">{t("page.settings.ssoRiskNoActions")}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskTaskTitle")}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoRiskTaskDesc")}</p>
                        </div>
                        <StatusPill
                          tone={(ssoRiskTaskResult?.summary?.created || 0) > 0 ? "ok" : (ssoRiskTaskResult?.summary?.planned || 0) > 0 ? "warn" : "ok"}
                          label={ssoRiskTaskResult ? `${ssoRiskTaskResult.summary?.planned || 0}/${ssoRiskTaskResult.summary?.created || 0}` : "TASK"}
                        />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-5">
                        <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)] md:col-span-1">
                          <input
                            type="checkbox"
                            checked={ssoRiskTaskDraft.include_low}
                            onChange={(e) => setSsoRiskTaskDraft({ ...ssoRiskTaskDraft, include_low: e.target.checked })}
                          />
                          {t("page.settings.ssoRiskTaskIncludeLow")}
                        </label>
                        <input
                          className={inputClass}
                          type="number"
                          min={1}
                          max={20}
                          value={ssoRiskTaskDraft.limit}
                          onChange={(e) => setSsoRiskTaskDraft({ ...ssoRiskTaskDraft, limit: e.target.value })}
                          placeholder={t("page.settings.ssoRiskTaskLimit")}
                        />
                        <select className={inputClass} value={ssoRiskTaskDraft.priority} onChange={(e) => setSsoRiskTaskDraft({ ...ssoRiskTaskDraft, priority: e.target.value })}>
                          {["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                        </select>
                        <input
                          className={inputClass}
                          value={ssoRiskTaskDraft.assigned_to}
                          onChange={(e) => setSsoRiskTaskDraft({ ...ssoRiskTaskDraft, assigned_to: e.target.value })}
                          placeholder={t("page.settings.ssoRiskTaskAssignee")}
                        />
                        <input
                          className={inputClass}
                          value={ssoRiskTaskDraft.dev_tool}
                          onChange={(e) => setSsoRiskTaskDraft({ ...ssoRiskTaskDraft, dev_tool: e.target.value })}
                          placeholder={t("page.settings.ssoRiskTaskDevTool")}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
                          disabled={!selectedSsoProviderExists || runSsoRiskTasks.isPending}
                          onClick={() => runSsoRiskTasks.mutate(true)}
                        >
                          <ListChecks className="h-4 w-4" />
                          {t("page.settings.ssoRiskTaskPreview")}
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                          disabled={!selectedSsoProviderExists || runSsoRiskTasks.isPending}
                          onClick={() => runSsoRiskTasks.mutate(false)}
                        >
                          <ShieldCheck className="h-4 w-4" />
                          {t("page.settings.ssoRiskTaskCreate")}
                        </button>
                      </div>
                      {runSsoRiskTasks.error ? <ErrorLine message={(runSsoRiskTasks.error as Error).message} /> : null}
                      {ssoRiskTaskResult ? (
                        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <Info label={t("page.settings.ssoRiskTaskPlanned")} value={String(ssoRiskTaskResult.summary?.planned || 0)} />
                            <Info label={t("page.settings.ssoRiskTaskCreated")} value={String(ssoRiskTaskResult.summary?.created || 0)} />
                            <Info label={t("page.settings.ssoRiskTaskSkipped")} value={String(ssoRiskTaskResult.summary?.skipped_low || 0)} />
                          </div>
                          <div className="mt-3 space-y-2">
                            {(ssoRiskTaskResult.items || []).length ? (ssoRiskTaskResult.items || []).map((item: any, index: number) => {
                              const created = (ssoRiskTaskResult.created || [])[index];
                              return (
                                <div key={`${item.source_report_id || index}-${created?.id || "preview"}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-semibold text-[var(--text)]">{item.title}</p>
                                    <span className="font-mono text-[var(--muted-strong)]">{created?.id || item.priority}</span>
                                  </div>
                                  <p className="mt-1 text-[var(--muted)]">{item.source_report_title} · {item.assigned_to} · {item.dev_tool}</p>
                                </div>
                              );
                            }) : (
                              <p className="text-xs text-[var(--muted)]">{t("page.settings.ssoRiskTaskEmpty")}</p>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                            <MessageSquare className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskImTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoRiskImDesc")}</p>
                          </div>
                        </div>
                        <StatusPill
                          tone={(ssoRiskImResult?.delivery_plan?.target_count || 0) > 0 ? "ok" : "warn"}
                          label={ssoRiskImResult ? String(ssoRiskImResult.delivery_plan?.target_count || 0) : "IM"}
                        />
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
                        <div className="space-y-3">
                          <input
                            className={inputClass}
                            value={ssoRiskImDraft.title}
                            onChange={(e) => setSsoRiskImDraft({ ...ssoRiskImDraft, title: e.target.value })}
                            placeholder={t("page.settings.ssoRiskImTitlePh")}
                          />
                          <div className="grid gap-2 md:grid-cols-2">
                            {(notifyChannels.data || []).map((channel: any) => {
                              const checked = ssoRiskImDraft.channels.includes(channel.name);
                              return (
                                <label key={channel.name} className="flex min-h-16 items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted-strong)]">
                                  <input
                                    className="mt-1"
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => setSsoRiskImDraft({
                                      ...ssoRiskImDraft,
                                      channels: e.target.checked
                                        ? Array.from(new Set([...ssoRiskImDraft.channels, channel.name]))
                                        : ssoRiskImDraft.channels.filter((name) => name !== channel.name),
                                    })}
                                  />
                                  <span className="min-w-0">
                                    <span className="flex items-center gap-2">
                                      <span className="truncate font-semibold text-[var(--text)]">{channel.name}</span>
                                      <span className="font-mono text-[10px]">{channel.type}</span>
                                    </span>
                                    <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{(channel.events || []).join(", ") || "-"}</span>
                                  </span>
                                </label>
                              );
                            })}
                            {!(notifyChannels.data || []).length ? <HintLine message={t("page.settings.ssoRiskImNoChannels")} /> : null}
                          </div>
                          {notifyChannels.error ? <ErrorLine message={(notifyChannels.error as Error).message} /> : null}
                        </div>
                        <div className="space-y-3">
                          <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)]">
                            <input
                              type="checkbox"
                              checked={ssoRiskImDraft.include_low}
                              onChange={(e) => setSsoRiskImDraft({ ...ssoRiskImDraft, include_low: e.target.checked })}
                            />
                            {t("page.settings.ssoRiskTaskIncludeLow")}
                          </label>
                          <input
                            className={inputClass}
                            type="number"
                            min={1}
                            max={20}
                            value={ssoRiskImDraft.limit}
                            onChange={(e) => setSsoRiskImDraft({ ...ssoRiskImDraft, limit: e.target.value })}
                            placeholder={t("page.settings.ssoRiskTaskLimit")}
                          />
                          <div className="grid gap-2">
                            <button
                              type="button"
                              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
                              disabled={!selectedSsoProviderExists || runSsoRiskIm.isPending}
                              onClick={() => runSsoRiskIm.mutate(true)}
                            >
                              <ListChecks className="h-4 w-4" />
                              {t("page.settings.ssoRiskImPreview")}
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                              disabled={!selectedSsoProviderExists || runSsoRiskIm.isPending}
                              onClick={() => runSsoRiskIm.mutate(false)}
                            >
                              <Send className="h-4 w-4" />
                              {t("page.settings.ssoRiskImSend")}
                            </button>
                          </div>
                        </div>
                      </div>
                      {runSsoRiskIm.error ? <ErrorLine message={(runSsoRiskIm.error as Error).message} /> : null}
                      {ssoRiskImResult ? (
                        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                          <pre className="max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{ssoRiskImResult.briefing?.content || ""}</pre>
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                            <div className="grid gap-2">
                              <Info label={t("page.settings.ssoRiskImTargets")} value={String(ssoRiskImResult.delivery_plan?.target_count || 0)} />
                              <Info label={t("page.settings.ssoRiskImMode")} value={String(ssoRiskImResult.delivery_plan?.selection_mode || "-")} />
                              <Info label={t("page.settings.ssoRiskImSent")} value={String(ssoRiskImResult.audit?.sent_count || ssoRiskImResult.sent?.length || 0)} />
                            </div>
                            {(ssoRiskImResult.delivery_plan?.missing_channels || []).length ? (
                              <p className="mt-2 text-xs text-amber-600">{t("page.settings.ssoRiskImMissing")}: {(ssoRiskImResult.delivery_plan.missing_channels || []).join(", ")}</p>
                            ) : null}
                            {(ssoRiskImResult.delivery_plan?.blocked_channels || []).length ? (
                              <p className="mt-2 text-xs text-rose-600">{t("page.settings.ssoRiskImBlocked")}: {(ssoRiskImResult.delivery_plan.blocked_channels || []).map((item: any) => item.name).join(", ")}</p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                            <ShieldCheck className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskSubscriptionTitle")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoRiskSubscriptionDesc")}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill
                            tone={ssoRiskSubscription.data?.subscription?.enabled ? "ok" : "warn"}
                            label={String(t(`page.settings.ssoRiskSubscriptionFrequencyValue.${ssoRiskSubscription.data?.subscription?.frequency || ssoRiskSubscriptionDraft.frequency}`, { defaultValue: ssoRiskSubscriptionDraft.frequency }))}
                          />
                          <StatusPill
                            tone={ssoRiskSubscriptionResult?.triggered ? "ok" : "warn"}
                            label={ssoRiskSubscriptionResult ? String(t(`page.settings.ssoRiskSubscriptionReasonValue.${ssoRiskSubscriptionResult.reason || "no_matching_risk"}`, { defaultValue: ssoRiskSubscriptionResult.reason || "-" })) : "SUB"}
                          />
                        </div>
                      </div>
                      {!selectedSsoProviderExists ? (
                        <HintLine message={t("page.settings.ssoScimAuditNoProvider")} />
                      ) : (
                        <>
                          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                            <div className="space-y-3">
                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)]">
                                  <input
                                    type="checkbox"
                                    checked={ssoRiskSubscriptionDraft.enabled}
                                    onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, enabled: e.target.checked })}
                                  />
                                  {t("page.settings.ssoRiskSubscriptionEnabled")}
                                </label>
                                <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)]">
                                  <input
                                    type="checkbox"
                                    checked={ssoRiskSubscriptionDraft.include_low}
                                    onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, include_low: e.target.checked })}
                                  />
                                  {t("page.settings.ssoRiskSubscriptionIncludeLow")}
                                </label>
                                <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--muted-strong)]">
                                  <input
                                    type="checkbox"
                                    checked={ssoRiskSubscriptionDraft.force}
                                    onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, force: e.target.checked })}
                                  />
                                  {t("page.settings.ssoRiskSubscriptionForce")}
                                </label>
                              </div>
                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <select
                                  className={inputClass}
                                  value={ssoRiskSubscriptionDraft.frequency}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, frequency: e.target.value })}
                                  aria-label={String(t("page.settings.ssoRiskSubscriptionFrequency"))}
                                >
                                  {["hourly", "daily", "weekly", "manual"].map((frequency) => (
                                    <option key={frequency} value={frequency}>
                                      {String(t(`page.settings.ssoRiskSubscriptionFrequencyValue.${frequency}`, { defaultValue: frequency }))}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  className={inputClass}
                                  value={ssoRiskSubscriptionDraft.min_severity}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, min_severity: e.target.value })}
                                  aria-label={String(t("page.settings.ssoRiskSubscriptionMinSeverity"))}
                                >
                                  {["high", "medium", "low"].map((severity) => (
                                    <option key={severity} value={severity}>
                                      {String(t(`page.settings.ssoRiskSubscriptionSeverity.${severity}`, { defaultValue: severity }))}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  className={inputClass}
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={ssoRiskSubscriptionDraft.score_threshold}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, score_threshold: e.target.value })}
                                  placeholder={t("page.settings.ssoRiskSubscriptionScoreThreshold")}
                                />
                                <input
                                  className={inputClass}
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={ssoRiskSubscriptionDraft.limit}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, limit: e.target.value })}
                                  placeholder={t("page.settings.ssoRiskSubscriptionLimit")}
                                />
                              </div>
                              <div className="grid gap-3 md:grid-cols-2">
                                <input
                                  className={inputClass}
                                  value={ssoRiskSubscriptionDraft.owner}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, owner: e.target.value })}
                                  placeholder={t("page.settings.ssoRiskSubscriptionOwner")}
                                />
                                <input
                                  className={inputClass}
                                  value={ssoRiskSubscriptionDraft.title}
                                  onChange={(e) => setSsoRiskSubscriptionDraft({ ...ssoRiskSubscriptionDraft, title: e.target.value })}
                                  placeholder={t("page.settings.ssoRiskSubscriptionTitlePh")}
                                />
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskSubscriptionChannels")}</p>
                                <div className="mt-2 grid gap-2 md:grid-cols-2">
                                  {(notifyChannels.data || []).map((channel: any) => {
                                    const checked = ssoRiskSubscriptionDraft.channels.includes(channel.name);
                                    return (
                                      <label key={channel.name} className="flex min-h-16 items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted-strong)]">
                                        <input
                                          className="mt-1"
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => setSsoRiskSubscriptionDraft({
                                            ...ssoRiskSubscriptionDraft,
                                            channels: e.target.checked
                                              ? Array.from(new Set([...ssoRiskSubscriptionDraft.channels, channel.name]))
                                              : ssoRiskSubscriptionDraft.channels.filter((name) => name !== channel.name),
                                          })}
                                        />
                                        <span className="min-w-0">
                                          <span className="flex items-center gap-2">
                                            <span className="truncate font-semibold text-[var(--text)]">{channel.name}</span>
                                            <span className="font-mono text-[10px]">{channel.type}</span>
                                          </span>
                                          <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{(channel.events || []).join(", ") || "-"}</span>
                                        </span>
                                      </label>
                                    );
                                  })}
                                  {!(notifyChannels.data || []).length ? <HintLine message={t("page.settings.ssoRiskSubscriptionNoChannels")} /> : null}
                                </div>
                              </div>
                            </div>
                            <div className="space-y-3">
                              <div className="grid gap-2">
                                <Info label={t("page.settings.ssoRiskSubscriptionLastSent")} value={String(ssoRiskSubscription.data?.subscription?.last_sent_at || "-")} />
                                <Info label={t("page.settings.ssoRiskSubscriptionTriggered")} value={ssoRiskSubscriptionResult ? String(Boolean(ssoRiskSubscriptionResult.triggered)) : "-"} />
                                <Info label={t("page.settings.ssoRiskSubscriptionReason")} value={ssoRiskSubscriptionResult ? String(t(`page.settings.ssoRiskSubscriptionReasonValue.${ssoRiskSubscriptionResult.reason || "no_matching_risk"}`, { defaultValue: ssoRiskSubscriptionResult.reason || "-" })) : "-"} />
                              </div>
                              <div className="grid gap-2">
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
                                  disabled={!selectedSsoProviderExists || saveSsoRiskSubscription.isPending}
                                  onClick={() => saveSsoRiskSubscription.mutate()}
                                >
                                  <ShieldCheck className="h-4 w-4" />
                                  {t("page.settings.ssoRiskSubscriptionSave")}
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
                                  disabled={!selectedSsoProviderExists || runSsoRiskSubscription.isPending}
                                  onClick={() => runSsoRiskSubscription.mutate(true)}
                                >
                                  <ListChecks className="h-4 w-4" />
                                  {t("page.settings.ssoRiskSubscriptionPreview")}
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                                  disabled={!selectedSsoProviderExists || runSsoRiskSubscription.isPending}
                                  onClick={() => runSsoRiskSubscription.mutate(false)}
                                >
                                  <Send className="h-4 w-4" />
                                  {t("page.settings.ssoRiskSubscriptionSend")}
                                </button>
                              </div>
                            </div>
                          </div>
                          {ssoRiskSubscription.error ? <ErrorLine message={(ssoRiskSubscription.error as Error).message} /> : null}
                          {saveSsoRiskSubscription.error ? <ErrorLine message={(saveSsoRiskSubscription.error as Error).message} /> : null}
                          {runSsoRiskSubscription.error ? <ErrorLine message={(runSsoRiskSubscription.error as Error).message} /> : null}
                          {ssoRiskSubscriptionResult ? (
                            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                              <pre className="max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{ssoRiskSubscriptionResult.briefing?.content || JSON.stringify(ssoRiskSubscriptionResult.subscription || {}, null, 2)}</pre>
                              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                                <div className="grid gap-2">
                                  <Info label={t("page.settings.ssoRiskImTargets")} value={String(ssoRiskSubscriptionResult.delivery_plan?.target_count || 0)} />
                                  <Info label={t("page.settings.ssoRiskImMode")} value={String(ssoRiskSubscriptionResult.delivery_plan?.selection_mode || "-")} />
                                  <Info label={t("page.settings.ssoRiskImSent")} value={String(ssoRiskSubscriptionResult.audit?.sent_count || ssoRiskSubscriptionResult.sent?.length || 0)} />
                                </div>
                                {(ssoRiskSubscriptionResult.delivery_plan?.missing_channels || []).length ? (
                                  <p className="mt-2 text-xs text-amber-600">{t("page.settings.ssoRiskImMissing")}: {(ssoRiskSubscriptionResult.delivery_plan.missing_channels || []).join(", ")}</p>
                                ) : null}
                                {(ssoRiskSubscriptionResult.delivery_plan?.blocked_channels || []).length ? (
                                  <p className="mt-2 text-xs text-rose-600">{t("page.settings.ssoRiskImBlocked")}: {(ssoRiskSubscriptionResult.delivery_plan.blocked_channels || []).map((item: any) => item.name).join(", ")}</p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                            <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskSubscriptionHistory")}</p>
                            <div className="mt-2 space-y-2">
                              {(ssoRiskSubscription.data?.history?.items || []).length ? (ssoRiskSubscription.data.history.items || []).map((item: any) => (
                                <div key={item.id || item.created_at} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-semibold text-[var(--text)]">{item.actor || item.owner || "-"}</span>
                                    <span className="font-mono text-[var(--muted-strong)]">{item.created_at || "-"}</span>
                                  </div>
                                  <p className="mt-1 text-[var(--muted)]">
                                    {String(t(`page.settings.ssoRiskSubscriptionReasonValue.${item.reason || "no_matching_risk"}`, { defaultValue: item.reason || "-" }))} · {item.sent_count || 0}/{item.target_count || 0}
                                  </p>
                                </div>
                              )) : (
                                <p className="text-xs text-[var(--muted)]">{t("page.settings.ssoRiskSubscriptionHistoryEmpty")}</p>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <Rocket className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRiskEscalationTitle")}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.settings.ssoRiskEscalationDesc")}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={ssoRiskEscalation.data?.policy?.enabled ? "ok" : "warn"} label={ssoRiskEscalation.data?.policy?.enabled ? String(t("page.settings.ssoRiskEscalationEnabled")) : String(t("page.settings.ssoRiskEscalationDisabled"))} />
                    <StatusPill tone={ssoRiskEscalationResult?.triggered ? "ok" : "warn"} label={ssoRiskEscalationResult ? String(t(`page.settings.ssoRiskEscalationReasonValue.${ssoRiskEscalationResult.reason || "no_matching_risk"}`, { defaultValue: ssoRiskEscalationResult.reason || "-" })) : "AUTO"} />
                  </div>
                </div>
                {!selectedSsoProviderExists ? (
                  <HintLine message={t("page.settings.ssoRiskNoProvider")} />
                ) : (
                  <>
                    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                          {ssoRiskEscalationBooleanControls.map((item) => (
                            <label key={item.key} className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--muted-strong)]">
                              <input
                                type="checkbox"
                                checked={ssoRiskEscalationDraft[item.key]}
                                onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, [item.key]: e.target.checked })}
                              />
                              {t(`page.settings.${item.label}`)}
                            </label>
                          ))}
                          {ssoRiskEscalationActions.map((action) => (
                            <label key={action} className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--muted-strong)]">
                              <input
                                type="checkbox"
                                checked={ssoRiskEscalationDraft.actions.includes(action)}
                                onChange={(e) => setSsoRiskEscalationDraft({
                                  ...ssoRiskEscalationDraft,
                                  actions: e.target.checked
                                    ? Array.from(new Set([...ssoRiskEscalationDraft.actions, action]))
                                    : ssoRiskEscalationDraft.actions.filter((item) => item !== action),
                                })}
                              />
                              {String(t(`page.settings.ssoRiskEscalationAction.${action}`, { defaultValue: action }))}
                            </label>
                          ))}
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                          <select className={inputClass} value={ssoRiskEscalationDraft.min_severity} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, min_severity: e.target.value })}>
                            {["high", "medium", "low"].map((severity) => <option key={severity} value={severity}>{String(t(`page.settings.ssoRiskSubscriptionSeverity.${severity}`, { defaultValue: severity }))}</option>)}
                          </select>
                          <input className={inputClass} type="number" min={0} max={100} value={ssoRiskEscalationDraft.score_threshold} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, score_threshold: e.target.value })} placeholder={t("page.settings.ssoRiskEscalationScoreThreshold")} />
                          <input className={inputClass} type="number" min={0} max={10080} value={ssoRiskEscalationDraft.cooldown_minutes} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, cooldown_minutes: e.target.value })} placeholder={t("page.settings.ssoRiskEscalationCooldown")} />
                          <input className={inputClass} type="number" min={1} max={20} value={ssoRiskEscalationDraft.limit} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, limit: e.target.value })} placeholder={t("page.settings.ssoRiskEscalationLimit")} />
                          <select className={inputClass} value={ssoRiskEscalationDraft.priority} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, priority: e.target.value })}>{["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <input className={inputClass} value={ssoRiskEscalationDraft.assigned_to} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, assigned_to: e.target.value })} placeholder={t("page.settings.ssoRiskEscalationAssignee")} />
                          <input className={inputClass} value={ssoRiskEscalationDraft.dev_tool} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, dev_tool: e.target.value })} placeholder={t("page.settings.ssoRiskEscalationDevTool")} />
                          <input className={inputClass} value={ssoRiskEscalationDraft.owner} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, owner: e.target.value })} placeholder={t("page.settings.ssoRiskEscalationOwner")} />
                          <input className={inputClass} value={ssoRiskEscalationDraft.title} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, title: e.target.value })} placeholder={t("page.settings.ssoRiskEscalationTitlePh")} />
                        </div>
                        <textarea className={`${inputClass} min-h-20 resize-y`} value={ssoRiskEscalationDraft.notes} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, notes: e.target.value })} placeholder={t("page.settings.ssoRiskEscalationNotes")} />
                        <div>
                          <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskEscalationChannels")}</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            {(notifyChannels.data || []).map((channel: any) => {
                              const checked = ssoRiskEscalationDraft.channels.includes(channel.name);
                              return (
                                <label key={channel.name} className="flex min-h-16 items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted-strong)]">
                                  <input className="mt-1" type="checkbox" checked={checked} onChange={(e) => setSsoRiskEscalationDraft({ ...ssoRiskEscalationDraft, channels: e.target.checked ? Array.from(new Set([...ssoRiskEscalationDraft.channels, channel.name])) : ssoRiskEscalationDraft.channels.filter((name) => name !== channel.name) })} />
                                  <span className="min-w-0">
                                    <span className="flex items-center gap-2"><span className="truncate font-semibold text-[var(--text)]">{channel.name}</span><span className="font-mono text-[10px]">{channel.type}</span></span>
                                    <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{(channel.events || []).join(", ") || "-"}</span>
                                  </span>
                                </label>
                              );
                            })}
                            {!(notifyChannels.data || []).length ? <HintLine message={t("page.settings.ssoRiskEscalationNoChannels")} /> : null}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <Info label={t("page.settings.ssoRiskEscalationLastRun")} value={String(ssoRiskEscalation.data?.policy?.last_run_at || "-")} />
                        <Info label={t("page.settings.ssoRiskEscalationLastTriggered")} value={String(ssoRiskEscalation.data?.policy?.last_triggered_at || "-")} />
                        <Info label={t("page.settings.ssoRiskEscalationTriggered")} value={ssoRiskEscalationResult ? String(Boolean(ssoRiskEscalationResult.triggered)) : "-"} />
                        <Info label={t("page.settings.ssoRiskEscalationReason")} value={ssoRiskEscalationResult ? String(t(`page.settings.ssoRiskEscalationReasonValue.${ssoRiskEscalationResult.reason || "no_matching_risk"}`, { defaultValue: ssoRiskEscalationResult.reason || "-" })) : "-"} />
                        <div className="grid gap-2">
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={!selectedSsoProviderExists || saveSsoRiskEscalation.isPending} onClick={() => saveSsoRiskEscalation.mutate()}><ShieldCheck className="h-4 w-4" />{t("page.settings.ssoRiskEscalationSave")}</button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={!selectedSsoProviderExists || runSsoRiskEscalation.isPending} onClick={() => runSsoRiskEscalation.mutate(true)}><ListChecks className="h-4 w-4" />{t("page.settings.ssoRiskEscalationPreview")}</button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!selectedSsoProviderExists || runSsoRiskEscalation.isPending} onClick={() => runSsoRiskEscalation.mutate(false)}><Rocket className="h-4 w-4" />{t("page.settings.ssoRiskEscalationRun")}</button>
                        </div>
                      </div>
                    </div>
                    {ssoRiskEscalation.error ? <ErrorLine message={(ssoRiskEscalation.error as Error).message} /> : null}
                    {saveSsoRiskEscalation.error ? <ErrorLine message={(saveSsoRiskEscalation.error as Error).message} /> : null}
                    {runSsoRiskEscalation.error ? <ErrorLine message={(runSsoRiskEscalation.error as Error).message} /> : null}
                    <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <div className="grid gap-3 md:grid-cols-4">
                          <Info label={t("page.settings.ssoRiskEscalationActions")} value={(ssoRiskEscalationResult?.actions || ssoRiskEscalation.data?.policy?.actions || []).join(", ") || "-"} />
                          <Info label={t("page.settings.ssoRiskTaskPlanned")} value={String(ssoRiskEscalationResult?.task_result?.summary?.planned || 0)} />
                          <Info label={t("page.settings.ssoRiskTaskCreated")} value={String(ssoRiskEscalationResult?.task_result?.summary?.created || 0)} />
                          <Info label={t("page.settings.ssoRiskImSent")} value={String(ssoRiskEscalationResult?.im_result?.audit?.sent_count || ssoRiskEscalationResult?.im_result?.sent?.length || 0)} />
                        </div>
                        {ssoRiskEscalationResult ? <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{ssoRiskEscalationResult.im_result?.briefing?.content || JSON.stringify(ssoRiskEscalationResult.audit || {}, null, 2)}</pre> : null}
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskEscalationHistory")}</p>
                        <div className="mt-2 space-y-2">
                          {(ssoRiskEscalation.data?.history?.items || ssoRiskEscalationResult?.history?.items || []).length ? (ssoRiskEscalation.data?.history?.items || ssoRiskEscalationResult?.history?.items || []).map((item: any) => (
                            <div key={item.id || item.created_at} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-[var(--text)]">{item.actor || "-"}</span><span className="font-mono text-[var(--muted-strong)]">{item.created_at || "-"}</span></div>
                              <p className="mt-1 text-[var(--muted)]">{String(t(`page.settings.ssoRiskEscalationReasonValue.${item.reason || "no_matching_risk"}`, { defaultValue: item.reason || "-" }))} · {item.created_count || 0}/{item.sent_count || 0}</p>
                            </div>
                          )) : <p className="text-xs text-[var(--muted)]">{t("page.settings.ssoRiskEscalationHistoryEmpty")}</p>}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <FileText className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRiskRunbookTitle")}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.settings.ssoRiskRunbookDesc")}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={ssoRiskRunbookDetail?.item?.status === "verified" ? "ok" : ssoRiskRunbookDetail?.item?.status === "risk" ? "danger" : "warn"} label={ssoRiskRunbookDetail?.item?.status ? String(t(`page.settings.ssoRiskRunbookStatus.${ssoRiskRunbookDetail.item.status}`, { defaultValue: ssoRiskRunbookDetail.item.status })) : "RUNBOOK"} />
                    <button type="button" className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50" disabled={ssoRiskRunbooks.isFetching} onClick={() => void ssoRiskRunbooks.refetch()}>
                      {t("common.refresh")}
                    </button>
                  </div>
                </div>
                {!selectedSsoProviderExists ? (
                  <HintLine message={t("page.settings.ssoRiskNoProvider")} />
                ) : (
                  <>
                    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                          <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--muted-strong)]">
                            <input type="checkbox" checked={ssoRiskRunbookDraft.include_low} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, include_low: e.target.checked })} />
                            {t("page.settings.ssoRiskRunbookIncludeLow")}
                          </label>
                          <input className={inputClass} type="number" min={1} max={20} value={ssoRiskRunbookDraft.limit} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, limit: e.target.value })} placeholder={t("page.settings.ssoRiskRunbookLimit")} />
                          <select className={inputClass} value={ssoRiskRunbookDraft.priority} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, priority: e.target.value })}>{["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select>
                          <input className={inputClass} value={ssoRiskRunbookDraft.assigned_to} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, assigned_to: e.target.value })} placeholder={t("page.settings.ssoRiskRunbookAssignee")} />
                          <input className={inputClass} value={ssoRiskRunbookDraft.dev_tool} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, dev_tool: e.target.value })} placeholder={t("page.settings.ssoRiskEscalationDevTool")} />
                        </div>
                        <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
                          <input className={inputClass} value={ssoRiskRunbookDraft.owner} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, owner: e.target.value })} placeholder={t("page.settings.ssoRiskRunbookOwner")} />
                          <input className={inputClass} value={ssoRiskRunbookDraft.title} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, title: e.target.value })} placeholder={t("page.settings.ssoRiskRunbookTitlePh")} />
                        </div>
                        <textarea className={`${inputClass} min-h-20 resize-y`} value={ssoRiskRunbookDraft.notes} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, notes: e.target.value })} placeholder={t("page.settings.ssoRiskRunbookNotes")} />
                        <div>
                          <p className="text-xs font-semibold text-[var(--text)]">{t("page.settings.ssoRiskRunbookChannels")}</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            {(notifyChannels.data || []).map((channel: any) => {
                              const checked = ssoRiskRunbookDraft.channels.includes(channel.name);
                              return (
                                <label key={channel.name} className="flex min-h-16 items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted-strong)]">
                                  <input className="mt-1" type="checkbox" checked={checked} onChange={(e) => setSsoRiskRunbookDraft({ ...ssoRiskRunbookDraft, channels: e.target.checked ? Array.from(new Set([...ssoRiskRunbookDraft.channels, channel.name])) : ssoRiskRunbookDraft.channels.filter((name) => name !== channel.name) })} />
                                  <span className="min-w-0">
                                    <span className="flex items-center gap-2"><span className="truncate font-semibold text-[var(--text)]">{channel.name}</span><span className="font-mono text-[10px]">{channel.type}</span></span>
                                    <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{(channel.events || []).join(", ") || "-"}</span>
                                  </span>
                                </label>
                              );
                            })}
                            {!(notifyChannels.data || []).length ? <HintLine message={t("page.settings.ssoRiskRunbookNoChannels")} /> : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!selectedSsoProviderExists || createSsoRiskRunbook.isPending} onClick={() => createSsoRiskRunbook.mutate()}><FileText className="h-4 w-4" />{t("page.settings.ssoRiskRunbookCreate")}</button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={!ssoRiskRunbookDetail?.item?.id || applySsoRiskRunbookAction.isPending} onClick={() => applySsoRiskRunbookAction.mutate({ action: "preview_tasks", dryRun: true })}><ListChecks className="h-4 w-4" />{t("page.settings.ssoRiskRunbookPreviewTasks")}</button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={!ssoRiskRunbookDetail?.item?.id || applySsoRiskRunbookAction.isPending} onClick={() => applySsoRiskRunbookAction.mutate({ action: "create_tasks", dryRun: false })}><ListChecks className="h-4 w-4" />{t("page.settings.ssoRiskRunbookCreateTasks")}</button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={!ssoRiskRunbookDetail?.item?.id || applySsoRiskRunbookAction.isPending} onClick={() => applySsoRiskRunbookAction.mutate({ action: "send_im", dryRun: true })}><MessageSquare className="h-4 w-4" />{t("page.settings.ssoRiskRunbookPreviewIm")}</button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!ssoRiskRunbookDetail?.item?.id || applySsoRiskRunbookAction.isPending} onClick={() => applySsoRiskRunbookAction.mutate({ action: "verify", dryRun: true })}><ShieldCheck className="h-4 w-4" />{t("page.settings.ssoRiskRunbookVerify")}</button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={!ssoRiskRunbookDetail?.item?.id || applySsoRiskRunbookAction.isPending} onClick={() => applySsoRiskRunbookAction.mutate({ action: "archive", dryRun: false })}>{t("page.settings.ssoRiskRunbookArchive")}</button>
                        </div>
                        {createSsoRiskRunbook.error ? <ErrorLine message={(createSsoRiskRunbook.error as Error).message} /> : null}
                        {loadSsoRiskRunbook.error ? <ErrorLine message={(loadSsoRiskRunbook.error as Error).message} /> : null}
                        {applySsoRiskRunbookAction.error ? <ErrorLine message={(applySsoRiskRunbookAction.error as Error).message} /> : null}
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                        <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRiskRunbookRecent")}</p>
                        <div className="mt-3 space-y-2">
                          {(ssoRiskRunbooks.data?.items || []).map((runbook: any) => (
                            <button key={runbook.id} type="button" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:border-[var(--brand)] disabled:opacity-50" disabled={loadSsoRiskRunbook.isPending} onClick={() => loadSsoRiskRunbook.mutate(runbook.id)}>
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs font-semibold text-[var(--text)]">{runbook.title || runbook.id}</span>
                                <span className="shrink-0 text-[11px] text-[var(--muted)]">{`${runbook.step_done || 0}/${runbook.step_total || 0}`}</span>
                              </span>
                              <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{`${String(t(`page.settings.ssoRiskRunbookStatus.${runbook.status}`, { defaultValue: runbook.status || "-" }))} / ${runbook.risk_score || 0}`}</span>
                            </button>
                          ))}
                          {!ssoRiskRunbooks.data?.items?.length ? <p className="py-4 text-center text-xs text-[var(--muted)]">{t("page.settings.ssoRiskRunbookEmpty")}</p> : null}
                        </div>
                        {ssoRiskRunbooks.error ? <ErrorLine message={(ssoRiskRunbooks.error as Error).message} /> : null}
                      </div>
                    </div>
                    {ssoRiskRunbookDetail ? (
                      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[var(--text)]">{ssoRiskRunbookDetail.item?.id}</p>
                              <p className="mt-1 truncate text-xs text-[var(--muted)]">{`${ssoRiskRunbookDetail.item?.provider || "-"} / ${ssoRiskRunbookDetail.item?.risk_status || "-"}`}</p>
                            </div>
                            <StatusPill tone={ssoRiskRunbookDetail.item?.status === "verified" ? "ok" : ssoRiskRunbookDetail.item?.status === "risk" ? "danger" : "warn"} label={String(t(`page.settings.ssoRiskRunbookStatus.${ssoRiskRunbookDetail.item?.status}`, { defaultValue: ssoRiskRunbookDetail.item?.status || "-" }))} />
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-4">
                            <Info label={t("page.settings.ssoRiskRunbookRiskScore")} value={String(ssoRiskRunbookDetail.item?.risk_score || 0)} />
                            <Info label={t("page.settings.ssoRiskRunbookFindings")} value={String(ssoRiskRunbookDetail.item?.finding_count || 0)} />
                            <Info label={t("page.settings.ssoRiskRunbookSteps")} value={`${ssoRiskRunbookDetail.item?.step_done || 0}/${ssoRiskRunbookDetail.item?.step_total || 0}`} />
                            <Info label={t("page.settings.ssoRiskRunbookTasks")} value={String(ssoRiskRunbookDetail.item?.task_count || 0)} />
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {(ssoRiskRunbookDetail.runbook?.steps || []).map((step: any) => (
                              <div key={step.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="truncate font-medium text-[var(--text)]">{step.title || step.id}</span>
                                  <StatusPill tone={step.status === "completed" ? "ok" : step.status === "failed" ? "danger" : "warn"} label={String(t(`page.settings.ssoRiskRunbookStepStatus.${step.status}`, { defaultValue: step.status || "-" }))} />
                                </div>
                                <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${step.kind || "-"} / ${step.owner || "-"}`}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button type="button" className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--text)] disabled:opacity-50" disabled={applySsoRiskRunbookAction.isPending} onClick={() => applySsoRiskRunbookAction.mutate({ action: "mark_step_done", dryRun: false, stepId: step.id })}>{t("page.settings.ssoRiskRunbookStepDone")}</button>
                                  <button type="button" className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--text)] disabled:opacity-50" disabled={applySsoRiskRunbookAction.isPending} onClick={() => applySsoRiskRunbookAction.mutate({ action: "mark_step_failed", dryRun: false, stepId: step.id })}>{t("page.settings.ssoRiskRunbookStepFailed")}</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                          <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoRiskRunbookEvidence")}</p>
                          <div className="mt-3 space-y-2">
                            {(ssoRiskRunbookDetail.runbook?.events || []).slice(-5).reverse().map((event: any) => (
                              <div key={event.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                                <p className="font-semibold text-[var(--text)]">{String(t(`page.settings.ssoRiskRunbookEvent.${event.kind}`, { defaultValue: event.kind || "-" }))}</p>
                                <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{`${event.actor || "-"} / ${event.at || "-"}`}</p>
                              </div>
                            ))}
                          </div>
                          {ssoRiskRunbookDetail.result ? <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify({ planned: ssoRiskRunbookDetail.result.planned?.length, created: ssoRiskRunbookDetail.result.created?.length, im: ssoRiskRunbookDetail.result.im?.audit, risk: ssoRiskRunbookDetail.result.risk }, null, 2)}</pre> : null}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.ssoScimAuditTitle")}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{t("page.settings.ssoScimAuditDesc")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={(ssoScimAudit.data?.summary?.failed || 0) > 0 ? "danger" : "ok"} label={String(ssoScimAudit.data?.summary?.total || 0)} />
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] disabled:opacity-50"
                      disabled={!selectedSsoProviderExists || ssoScimAudit.isFetching}
                      onClick={() => void ssoScimAudit.refetch()}
                    >
                      {t("page.settings.ssoScimAuditRefresh")}
                    </button>
                  </div>
                </div>
                {!selectedSsoProviderExists ? (
                  <HintLine message={t("page.settings.ssoScimAuditNoProvider")} />
                ) : ssoScimAudit.error ? (
                  <ErrorLine message={(ssoScimAudit.error as Error).message} />
                ) : (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <Info label={t("page.settings.ssoScimAuditTotal")} value={String(ssoScimAudit.data?.summary?.total || 0)} />
                      <Info label={t("page.settings.ssoScimAuditFailures")} value={String(ssoScimAudit.data?.summary?.failed || 0)} />
                      <Info label={t("page.settings.ssoScimAuditSkipped")} value={String(ssoScimAudit.data?.summary?.skipped || 0)} />
                      <Info label={t("page.settings.ssoScimAuditLast")} value={String(ssoScimAudit.data?.summary?.last_event_at || "-")} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {Object.entries(ssoScimAudit.data?.summary?.by_event || {}).map(([event, count]) => (
                        <span key={event} className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 font-mono text-[11px] text-[var(--muted-strong)]">{event}: {String(count)}</span>
                      ))}
                    </div>
                    <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)]">
                      <div className="grid min-w-[44rem] grid-cols-[9rem_8rem_8rem_1fr] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                        <span>{t("page.settings.ssoScimAuditEvent")}</span>
                        <span>{t("page.settings.status")}</span>
                        <span>{t("page.settings.ssoScimAuditActor")}</span>
                        <span>{t("page.settings.ssoScimAuditDetails")}</span>
                      </div>
                      {(ssoScimAudit.data?.items || []).length ? (ssoScimAudit.data.items || []).map((event: any) => (
                        <div key={event.event_id} className="grid min-w-[44rem] grid-cols-[9rem_8rem_8rem_1fr] gap-3 border-b border-[var(--border)] px-3 py-2 text-xs last:border-0">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[var(--text)]">{event.event_type}</p>
                            <p className="truncate text-[var(--muted)]">{event.ts}</p>
                          </div>
                          <span className="font-mono text-[var(--muted-strong)]">{event.status}</span>
                          <span className="truncate font-mono text-[var(--muted-strong)]">{event.actor || "-"}</span>
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[var(--muted-strong)]">{event.subject || "-"}</p>
                            <p className="truncate font-mono text-[11px] text-[var(--muted)]">{JSON.stringify(event.details || {})}</p>
                          </div>
                        </div>
                      )) : (
                        <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">{t("page.settings.ssoScimAuditEmpty")}</div>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="grid grid-cols-[1fr_5rem_7rem_7rem_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
                  <span>{t("page.settings.ssoProvider")}</span>
                  <span>{t("page.settings.ssoType")}</span>
                  <span>{t("page.settings.ssoSource")}</span>
                  <span>{t("page.settings.ssoReadiness")}</span>
                  <span>{t("page.settings.status")}</span>
                </div>
                {(ssoConfig.data?.items || []).map((row: any) => (
                  <div key={row.name} className="grid grid-cols-[1fr_5rem_7rem_7rem_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => setSsoDraft({
                        provider: row.name,
                        type: row.type || "oidc",
                        issuer: row.issuer || "",
                        client_id: row.client_id || "",
                        client_secret: "",
                        redirect_uri: row.redirect_uri || "",
                        scope: row.scope || "openid profile email",
                        metadata_url: row.metadata_url || "",
                        sso_url: row.sso_url || "",
                        x509_cert: "",
                        name_id_format: row.name_id_format || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
                        scim_enabled: row.scim?.enabled || false,
                        tenant_domain_map: mapToLines(row.tenant_domain_map || {}),
                        role_map: mapToLines(row.role_map || {}),
                        enabled: row.enabled !== false,
                      })}
                    >
                      <span className="block truncate text-sm font-semibold text-[var(--text)]">{row.name}</span>
                      <span className="block truncate text-xs text-[var(--muted)]">{row.issuer || row.metadata_url}</span>
                    </button>
                    <span className="text-xs uppercase text-[var(--muted-strong)]">{row.type}</span>
                    <span className="text-xs text-[var(--muted-strong)]">{row.source}</span>
                    <span className={row.type === "saml" && !row.saml?.ready ? "text-xs text-amber-600" : "text-xs text-emerald-600"}>
                      {row.type === "saml" ? (row.saml?.ready ? t("page.settings.ssoReady") : t("page.settings.ssoNotReady")) : "OIDC"}
                    </span>
                    <button type="button" className="text-left text-xs text-[var(--brand)] disabled:opacity-50" disabled={deleteSso.isPending || row.source === "env"} onClick={() => deleteSso.mutate(row.name)}>
                      {row.source === "env" ? "env" : t("common.delete")}
                    </button>
                  </div>
                ))}
                {!ssoConfig.data?.items?.length ? <div className="px-4 py-8 text-sm text-[var(--muted)]">{t("page.settings.ssoEmpty")}</div> : null}
              </div>
              {ssoConfig.isError ? <ErrorLine message={(ssoConfig.error as Error).message} /> : null}
              {ssoConfig.data?.config_path ? <p className="break-all text-xs text-[var(--muted)]">{ssoConfig.data.config_path}</p> : null}
            </div>
          </div>
        </Card>
      ) : null}

      {activeModule === "appearance" ? (
        <Card title={t("page.settings.themeCard")}>
          <p className="mb-3 text-sm leading-6 text-[var(--muted)]">{t("theme.hint")}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {THEME_OPTIONS.map((theme) => (
              <button
                key={theme}
                type="button"
                onClick={() => {
                  setThemePreference(theme);
                  setThemePref(theme);
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  themePref === theme
                    ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                  <Palette className="h-4 w-4" />
                </span>
                <span className="block text-sm font-semibold">{t(`theme.${theme}`)}</span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {activeModule === "billing" ? (
      <Card
        title={t("page.settings.billingCard")}
        actions={<StatusPill tone={billingAlerts.data?.total ? "warn" : billing.isError ? "danger" : "ok"} label={billingAlerts.data?.total ? `${billingAlerts.data.total} ${t("page.settings.alerts")}` : String(billing.data?.subscription?.status || "...")} />}
      >
        {billingAlerts.data?.items?.length ? (
          <div className="mb-4 grid gap-2 lg:grid-cols-3">
            {billingAlerts.data.items.map((alert: any) => (
              <BillingAlert key={alert.id || alert.message} alert={alert} />
            ))}
          </div>
        ) : null}
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <BillingMetric label={t("page.settings.invoiceCount")} value={String(billingSummary.data?.invoice_count ?? 0)} />
          <BillingMetric label={t("page.settings.invoiceTotal")} value={`$${formatMoney(billingSummary.data?.invoice_total_usd)}`} />
          <BillingMetric label={t("page.settings.paidTotal")} value={`$${formatMoney(billingSummary.data?.paid_total_usd)}`} />
          <BillingMetric label={t("page.settings.outstanding")} value={`$${formatMoney(billingSummary.data?.outstanding_usd)}`} />
        </div>
        <div className="mb-5 grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.overagePolicy")}</p>
            <div className="mt-3 space-y-2">
              <select className={inputClass} value={overageDraft.mode} onChange={(e) => setOverageDraft({ ...overageDraft, mode: e.target.value })}>
                {["approval_required", "block", "allow"].map((mode) => <option key={mode} value={mode}>{t(`page.settings.overageMode.${mode}`)}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} value={overageDraft.grace_percent} onChange={(e) => setOverageDraft({ ...overageDraft, grace_percent: e.target.value })} placeholder={t("page.settings.gracePercent")} inputMode="decimal" />
                <input className={inputClass} value={overageDraft.invoice_due_days} onChange={(e) => setOverageDraft({ ...overageDraft, invoice_due_days: e.target.value })} placeholder={t("page.settings.invoiceDueDays")} inputMode="numeric" />
              </div>
              <input className={inputClass} value={overageDraft.suspend_after_days} onChange={(e) => setOverageDraft({ ...overageDraft, suspend_after_days: e.target.value })} placeholder={t("page.settings.suspendAfterDays")} inputMode="numeric" />
              <button type="button" className="inline-flex w-full items-center justify-center rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={updateOveragePolicy.isPending} onClick={() => updateOveragePolicy.mutate()}>
                {t("page.settings.saveOveragePolicy")}
              </button>
              {updateOveragePolicy.error ? <ErrorLine message={(updateOveragePolicy.error as Error).message} /> : null}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.entitlementCheck")}</p>
            <div className="mt-3 space-y-2">
              <input className={inputClass} value={entitlementDraft.feature} onChange={(e) => setEntitlementDraft({ ...entitlementDraft, feature: e.target.value })} placeholder="team_rbac / sso" />
              <input className={inputClass} value={entitlementDraft.metric} onChange={(e) => setEntitlementDraft({ ...entitlementDraft, metric: e.target.value })} placeholder="llm_tokens" />
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} value={entitlementDraft.delta} onChange={(e) => setEntitlementDraft({ ...entitlementDraft, delta: e.target.value })} placeholder="1000" inputMode="decimal" />
                <input className={inputClass} value={entitlementDraft.subject} onChange={(e) => setEntitlementDraft({ ...entitlementDraft, subject: e.target.value })} placeholder="agent-run" />
              </div>
              <button type="button" className="inline-flex w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={checkEntitlement.isPending} onClick={() => checkEntitlement.mutate()}>
                {t("page.settings.runEntitlementCheck")}
              </button>
              {entitlementResult ? (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold text-[var(--text)]">{String(entitlementResult.decision || "-")}</span>
                    <StatusPill tone={entitlementResult.allowed ? "ok" : "warn"} label={entitlementResult.allowed ? t("page.settings.allowed") : t("page.settings.notAllowed")} />
                  </div>
                  <p className="mt-2 font-mono text-xs text-[var(--muted)]">{entitlementResult.quota?.metric || entitlementDraft.metric}: {formatNumber(entitlementResult.quota?.current)} / {formatNumber(entitlementResult.quota?.limit)}</p>
                </div>
              ) : null}
              {checkEntitlement.error ? <ErrorLine message={(checkEntitlement.error as Error).message} /> : null}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.dunningQueue")}</p>
              <span className="text-xs text-[var(--muted)]">{billingDunning.data?.summary?.open_invoices ?? 0}</span>
            </div>
            <div className="mt-3 space-y-2">
              {(billingDunning.data?.items || []).slice(0, 5).map((row: any) => (
                <div key={row.invoice_id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-[var(--text)]">{row.invoice_id}</span>
                    <span className="rounded-lg bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">{row.stage}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">${formatMoney(row.total_due_usd)} · {row.days_open}d · {row.next_action}</p>
                </div>
              ))}
              {!billingDunning.data?.items?.length ? <p className="text-sm text-[var(--muted)]">{t("page.settings.noDunning")}</p> : null}
            </div>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                <BadgeDollarSign className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.subscription")}</p>
                <p className="text-xs text-[var(--muted)]">{t("page.settings.billingDesc")}</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-[var(--muted)]">
                {t("page.settings.plan")}
                <select
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
                  value={planDraft}
                  onChange={(e) => setPlanDraft(e.target.value)}
                >
                  {Object.entries(billing.data?.catalog || {}).map(([id, plan]: [string, any]) => (
                    <option key={id} value={id}>
                      {plan.name || id}
                    </option>
                  ))}
                  {!billing.data?.catalog ? <option value="starter">Starter</option> : null}
                </select>
              </label>
              <label className="block text-xs font-medium text-[var(--muted)]">
                {t("page.settings.billingEmail")}
                <input
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  placeholder="billing@example.com"
                />
              </label>
              <button
                type="button"
                className="inline-flex w-full items-center justify-center rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                disabled={updateBilling.isPending}
                onClick={() => updateBilling.mutate()}
              >
                {t("page.settings.applyPlan")}
              </button>
              {updateBilling.error ? <ErrorLine message={(updateBilling.error as Error).message} /> : null}
              {billing.isError ? <ErrorLine message={(billing.error as Error).message} /> : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Object.entries(billing.data?.usage_ratio || {}).map(([metric, row]: [string, any]) => (
              <UsageQuotaCard key={metric} metric={metric} row={row} />
            ))}
            {!billing.data?.usage_ratio || Object.keys(billing.data.usage_ratio).length === 0 ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
                {t("page.settings.noQuota")}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.invoice")}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.settings.invoiceDesc")}</p>
            <div className="mt-4 grid gap-3">
              <Info label={t("page.settings.period")} value={String(invoice.data?.period || "-")} />
              <Info label={t("page.settings.totalDue")} value={`$${formatMoney(invoice.data?.total_due_usd)}`} />
              <Info label={t("page.settings.currency")} value={String(invoice.data?.currency || "USD")} />
            </div>
            <button
              type="button"
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
              disabled={snapshotInvoice.isPending || !invoice.data}
              onClick={() => snapshotInvoice.mutate()}
            >
              {t("page.settings.snapshotInvoice")}
            </button>
            <a
              className="mt-2 inline-flex w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]"
              href={api.billingInvoiceCsvUrl(String(invoice.data?.period || ""))}
              target="_blank"
              rel="noreferrer"
            >
              {t("page.settings.exportInvoiceCsv")}
            </a>
            {snapshotInvoice.data?.path ? (
              <p className="mt-2 break-all text-[11px] text-[var(--muted)]">{snapshotInvoice.data.path}</p>
            ) : null}
            {invoice.isError ? <ErrorLine message={(invoice.error as Error).message} /> : null}
            {snapshotInvoice.error ? <ErrorLine message={(snapshotInvoice.error as Error).message} /> : null}
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="grid grid-cols-[1fr_7rem_7rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
              <span>{t("page.settings.lineItem")}</span>
              <span className="text-right">{t("page.settings.quantity")}</span>
              <span className="text-right">{t("page.settings.amount")}</span>
            </div>
            {(invoice.data?.lines || []).map((line: any, idx: number) => (
              <div key={`${line.metric}-${idx}`} className="grid grid-cols-[1fr_7rem_7rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text)]">{line.metric}</p>
                  <p className="truncate text-xs text-[var(--muted)]">{line.description}</p>
                </div>
                <p className="text-right font-mono text-xs text-[var(--muted-strong)]">{formatNumber(line.quantity)}</p>
                <p className="text-right font-mono text-xs text-[var(--text)]">${formatMoney(line.amount_usd)}</p>
              </div>
            ))}
            {!invoice.data?.lines?.length ? (
              <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.noInvoice")}</div>
            ) : null}
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="grid grid-cols-[1fr_7rem_7rem_9rem_7rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
            <span>{t("page.settings.invoiceHistory")}</span>
            <span>{t("page.settings.period")}</span>
            <span className="text-right">{t("page.settings.totalDue")}</span>
            <span>{t("page.settings.status")}</span>
            <span>{t("page.settings.audit")}</span>
          </div>
          {(invoices.data?.items || []).map((row: any) => (
            <div key={row.id} className="grid grid-cols-[1fr_7rem_7rem_9rem_7rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-[var(--text)]">{row.id}</p>
                <p className="truncate text-[11px] text-[var(--muted)]">{row.path}</p>
              </div>
              <p className="text-xs text-[var(--muted-strong)]">{row.period}</p>
              <p className="text-right font-mono text-xs text-[var(--text)]">${formatMoney(row.total_due_usd)}</p>
              <select
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--text)]"
                value={row.status || "draft"}
                disabled={updateInvoiceStatus.isPending}
                onChange={(e) => updateInvoiceStatus.mutate({ id: row.id, status: e.target.value })}
              >
                {["draft", "issued", "paid", "void"].map((s) => (
                  <option key={s} value={s}>{t(`page.settings.invoiceStatus.${s}`)}</option>
                ))}
              </select>
              <button type="button" className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--text)]" onClick={() => setAuditInvoiceId(row.id)}>
                {t("page.settings.viewAudit")}
              </button>
            </div>
          ))}
          {!invoices.data?.items?.length ? (
            <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.noInvoiceHistory")}</div>
          ) : null}
        </div>
        {auditInvoiceId ? (
          <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.invoiceAudit")}</p>
                <p className="font-mono text-xs text-[var(--muted)]">{auditInvoiceId}</p>
              </div>
              <button type="button" className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs" onClick={() => setAuditInvoiceId("")}>{t("common.close")}</button>
            </div>
            {(invoiceAudit.data?.items || []).map((row: any) => (
              <div key={row.id} className="grid gap-2 border-b border-[var(--border)] px-4 py-3 text-sm last:border-0 md:grid-cols-[11rem_1fr_9rem]">
                <span className="font-mono text-xs text-[var(--muted)]">{row.ts}</span>
                <span className="font-semibold text-[var(--text)]">{row.type}</span>
                <span className="text-xs text-[var(--muted-strong)]">{row.from_status ? `${row.from_status} -> ${row.to_status}` : row.method || row.invoice_status}</span>
              </div>
            ))}
            {!invoiceAudit.data?.items?.length ? <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.noInvoiceAudit")}</div> : null}
          </div>
        ) : null}
        <div className="mt-5 grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <form
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!paymentDraft.invoice_id || Number(paymentDraft.amount_usd) <= 0) return;
              recordPayment.mutate();
            }}
          >
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.recordPayment")}</p>
            <div className="mt-4 space-y-3">
              <select
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]"
                value={paymentDraft.invoice_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const row = (invoices.data?.items || []).find((x: any) => x.id === id);
                  setPaymentDraft({ ...paymentDraft, invoice_id: id, amount_usd: row ? String(row.total_due_usd || "") : paymentDraft.amount_usd });
                }}
              >
                <option value="">{t("page.settings.pickInvoice")}</option>
                {(invoices.data?.items || []).map((row: any) => (
                  <option key={row.id} value={row.id}>{row.period} · {row.id}</option>
                ))}
              </select>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]"
                value={paymentDraft.amount_usd}
                onChange={(e) => setPaymentDraft({ ...paymentDraft, amount_usd: e.target.value })}
                placeholder={t("page.settings.paymentAmount")}
                inputMode="decimal"
              />
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]"
                value={paymentDraft.external_ref}
                onChange={(e) => setPaymentDraft({ ...paymentDraft, external_ref: e.target.value })}
                placeholder={t("page.settings.paymentRef")}
              />
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                disabled={recordPayment.isPending || !paymentDraft.invoice_id || Number(paymentDraft.amount_usd) <= 0}
              >
                {t("page.settings.savePayment")}
              </button>
              {recordPayment.error ? <ErrorLine message={(recordPayment.error as Error).message} /> : null}
            </div>
          </form>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="grid grid-cols-[1fr_7rem_8rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
              <span>{t("page.settings.paymentHistory")}</span>
              <span className="text-right">{t("page.settings.amount")}</span>
              <span>{t("page.settings.status")}</span>
            </div>
            {(payments.data?.items || []).map((row: any) => (
              <div key={row.id} className="grid grid-cols-[1fr_7rem_8rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-[var(--text)]">{row.invoice_id}</p>
                  <p className="truncate text-[11px] text-[var(--muted)]">{row.external_ref || row.id}</p>
                </div>
                <p className="text-right font-mono text-xs text-[var(--text)]">${formatMoney(row.amount_usd)}</p>
                <p className="text-xs text-[var(--muted-strong)]">{row.method}</p>
              </div>
            ))}
            {!payments.data?.items?.length ? (
              <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.noPayments")}</div>
            ) : null}
          </div>
        </div>
      </Card>
      ) : null}
      </section>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <dt className="text-[11px] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 truncate font-mono text-xs text-[var(--muted-strong)]">{value}</dd>
    </div>
  );
}

function SettingLink({ href, title, body, icon, external = false }: { href: string; title: string; body: string; icon: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      className="group flex min-h-32 flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-sm hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]"
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">{icon}</span>
      <span>
        <span className="mt-3 block text-sm font-semibold text-[var(--text)]">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{body}</span>
      </span>
    </a>
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "warn" | "danger"; label: string }) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
      : tone === "danger"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200"
        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function ModuleDot({ tone }: { tone: "ok" | "warn" | "danger" }) {
  const cls = tone === "ok" ? "bg-emerald-500" : tone === "danger" ? "bg-rose-500" : "bg-amber-500";
  return <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

function ErrorLine({ message }: { message: string }) {
  return <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">{message}</div>;
}

function HintLine({ message }: { message: string }) {
  return <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">{message}</div>;
}

function BillingAlert({ alert }: { alert: { severity?: string; message?: string; action?: string; percent?: number } }) {
  const severity = String(alert.severity || "info");
  const cls =
    severity === "critical"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200"
      : severity === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200"
        : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${cls}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold">{alert.message}</p>
        {alert.percent !== undefined ? <span className="font-mono text-xs">{alert.percent}%</span> : null}
      </div>
      {alert.action ? <p className="mt-1 text-xs opacity-80">{alert.action}</p> : null}
    </div>
  );
}

function BillingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-xl font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[var(--text)]">{formatNumber(value)}</p>
    </div>
  );
}

function logLevelClass(level: string): string {
  const lv = String(level || "").toUpperCase();
  if (lv.startsWith("ERROR") || lv.startsWith("CRITICAL")) return "font-mono text-rose-300";
  if (lv.startsWith("WARN")) return "font-mono text-amber-300";
  if (lv.startsWith("DEBUG")) return "font-mono text-slate-500";
  return "font-mono text-emerald-300";
}

function formatBytes(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "-";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function UsageQuotaCard({ metric, row }: { metric: string; row: { used?: number; limit?: number; remaining?: number; percent?: number } }) {
  const percent = Number(row.percent ?? 0);
  const tone = percent >= 90 ? "bg-rose-500" : percent >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-[var(--text)]">{metric}</p>
        <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted)]">{percent}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--muted)]">
        <span>used {formatNumber(row.used)}</span>
        <span className="text-right">limit {formatNumber(row.limit)}</span>
      </div>
    </div>
  );
}

function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    const k = key.trim();
    if (!k) continue;
    out[k] = rest.join("=").trim();
  }
  return out;
}

function parseBoolMap(text: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const raw of text.split(",")) {
    const item = raw.trim();
    if (!item || !item.includes("=")) continue;
    const [key, value] = item.split("=", 2);
    const k = key.trim();
    if (!k) continue;
    out[k] = ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
  }
  return out;
}

function parseTextMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/[\r\n,]+/)) {
    const item = raw.trim();
    if (!item || !item.includes("=")) continue;
    const [key, ...rest] = item.split("=");
    const k = key.trim();
    const v = rest.join("=").trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function mapToLines(value: any): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value).map(([k, v]) => `${k}=${v}`).join("\n");
}

function splitTokens(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitNumberTokens(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .map((x) => Number(x.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.min(100, Math.round(value)));
}

function profileToDraft(row: any) {
  const env = row.env && typeof row.env === "object"
    ? Object.entries(row.env).map(([k, v]) => `${k}=${v}`).join("\n")
    : "";
  const features = row.features && typeof row.features === "object"
    ? Object.entries(row.features).map(([k, v]) => `${k}=${Boolean(v)}`).join(",")
    : "";
  return {
    name: String(row.name || "local-dev"),
    mode: String(row.mode || "local"),
    database: String(row.database || "sqlite"),
    manager_url: String(row.manager_url || ""),
    public_url: String(row.public_url || ""),
    features,
    env,
    notes: String(row.notes || ""),
  };
}

function formatNumber(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatMoney(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}
