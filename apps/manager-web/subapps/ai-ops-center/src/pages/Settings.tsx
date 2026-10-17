import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, BadgeDollarSign, CloudCog, Database, ExternalLink, KeyRound, Palette, ServerCog, ShieldCheck } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { api } from "@/lib/api";
import { clearSession, getProjectId, getToken } from "@/lib/authStorage";
import { projectWorkspaceHash } from "@/lib/projectPortfolioRoute";
import { SettingsWorkbenchHeader } from "@/pages/admin/SettingsWorkbenchHeader";

const SettingsAppearancePanel = lazy(() => import("./settings/SettingsAppearancePanel").then((m) => ({ default: m.SettingsAppearancePanel })));
const SettingsAccountPanel = lazy(() => import("./settings/SettingsAccountPanel").then((m) => ({ default: m.SettingsAccountPanel })));
const SettingsWorkspacePanel = lazy(() => import("./settings/SettingsWorkspacePanel").then((m) => ({ default: m.SettingsWorkspacePanel })));
const SettingsRuntimePanel = lazy(() => import("./settings/SettingsRuntimePanel").then((m) => ({ default: m.SettingsRuntimePanel })));
const SettingsStoragePanel = lazy(() => import("./settings/SettingsStoragePanel").then((m) => ({ default: m.SettingsStoragePanel })));
const SettingsBillingPanel = lazy(() => import("./settings/SettingsBillingPanel").then((m) => ({ default: m.SettingsBillingPanel })));
const SettingsSsoPanel = lazy(() => import("./settings/SettingsSsoPanel").then((m) => ({ default: m.SettingsSsoPanel })));
const SettingsProfilesPanel = lazy(() => import("./settings/SettingsProfilesPanel").then((m) => ({ default: m.SettingsProfilesPanel })));

type SettingsModule = "account" | "runtime" | "observability" | "workspace" | "profiles" | "storage" | "sso" | "appearance" | "billing";
type SsoRiskEscalationAction = "create_tasks" | "send_im";
type SsoRiskEscalationDraft = {
  enabled: boolean;
  actions: SsoRiskEscalationAction[];
  channels: string[];
  min_severity: string;
  score_threshold: string;
  priority: string;
  owner_id: string;
  dev_tool: string;
  include_low: boolean;
  limit: string;
  cooldown_minutes: string;
  title: string;
  owner: string;
  notes: string;
  force: boolean;
};

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
  workspace: "#/settings/workspace",
  observability: "#/settings/observability",
  profiles: "#/settings/profiles",
  storage: "#/settings/storage",
  sso: "#/settings/sso",
  appearance: "#/settings/appearance",
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

function normalizeSettingsModule(module?: string): SettingsModule | undefined {
  return module && SETTINGS_ROUTE_MODULES[module] ? SETTINGS_ROUTE_MODULES[module] : undefined;
}

function settingsModuleHref(module: SettingsModule): string {
  return SETTINGS_MODULE_PATHS[module] || `#/settings/account?module=${module}`;
}

function currentRedirectTarget() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/?shell=1#/dashboard";
}

export function Settings({ initialModule, focused: _focused = false }: { initialModule?: string; focused?: boolean } = {}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [activeModule, setActiveModule] = useState<SettingsModule>(() => normalizeSettingsModule(initialModule) || readSettingsModuleFromHash());
  const opsModuleActive = activeModule === "runtime" || activeModule === "observability";
  const token = getToken();
  const projectId = getProjectId();
  const controlledReleasesHref = projectId ? projectWorkspaceHash(projectId, "#/dev-flow?view=releases") : "#/dev-flow?view=releases";
  const me = useQuery({ queryKey: ["authMe"], queryFn: api.authMe, enabled: Boolean(token), retry: false });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, enabled: Boolean(token), retry: false });
  const billing = useQuery({ queryKey: ["billingSubscription"], queryFn: api.billingSubscription, enabled: Boolean(token), retry: false });
  const billingAlerts = useQuery({ queryKey: ["billingAlerts"], queryFn: api.billingAlerts, enabled: Boolean(token), retry: false });
  const billingSummary = useQuery({ queryKey: ["billingSummary"], queryFn: api.billingSummary, enabled: Boolean(token), retry: false });
  const billingOveragePolicy = useQuery({ queryKey: ["billingOveragePolicy"], queryFn: api.billingOveragePolicy, enabled: Boolean(token) && activeModule === "billing", retry: false });
  const billingDunning = useQuery({ queryKey: ["billingDunning"], queryFn: api.billingDunning, enabled: Boolean(token) && activeModule === "billing", retry: false });
  const ssoConfig = useQuery({ queryKey: ["ssoConfig"], queryFn: api.ssoConfig, enabled: Boolean(token), retry: false });
  const notifyChannels = useQuery({ queryKey: ["notifyChannelsForRiskBriefing"], queryFn: api.notifyChannels, enabled: Boolean(token) && activeModule === "sso", retry: false });
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
  const [billingDrawerOpen, setBillingDrawerOpen] = useState(false);
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
    owner_id: "",
    dev_tool: "codex",
  });
  const [ssoRiskTaskResult, setSsoRiskTaskResult] = useState<any>(null);
  const [ssoRiskTaskDrawerOpen, setSsoRiskTaskDrawerOpen] = useState(false);
  const [ssoRiskImDraft, setSsoRiskImDraft] = useState({ channels: [] as string[], include_low: false, limit: "6", title: "" });
  const [ssoRiskImResult, setSsoRiskImResult] = useState<any>(null);
  const [ssoRiskImDrawerOpen, setSsoRiskImDrawerOpen] = useState(false);
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
    owner_id: "",
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
  const [ssoRiskEscalationDrawerOpen, setSsoRiskEscalationDrawerOpen] = useState(false);
  const [ssoRiskRunbookDraft, setSsoRiskRunbookDraft] = useState({ include_low: false, limit: "6", priority: "P1", owner_id: "", dev_tool: "codex", owner: "SecurityOps", channels: [] as string[], title: "", notes: "" });
  const [ssoRiskRunbookDetail, setSsoRiskRunbookDetail] = useState<any>(null);
  const [ssoRiskRunbookDrawerOpen, setSsoRiskRunbookDrawerOpen] = useState(false);
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
    const sync = () => setActiveModule(readSettingsModuleFromHash());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    const normalized = normalizeSettingsModule(initialModule);
    if (normalized) setActiveModule(normalized);
  }, [initialModule]);

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
      owner_id: String(policy.owner_id || ""),
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
      setBillingDrawerOpen(false);
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
        owner_id: ssoRiskTaskDraft.owner_id,
        dev_tool: ssoRiskTaskDraft.dev_tool,
      }),
    onSuccess: (data, dryRun) => {
      setSsoRiskTaskResult(data);
      if (!dryRun) setSsoRiskTaskDrawerOpen(false);
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
      if (!dryRun) setSsoRiskImDrawerOpen(false);
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
        owner_id: ssoRiskEscalationDraft.owner_id,
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
      setSsoRiskEscalationDrawerOpen(false);
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
      if (!dryRun) setSsoRiskEscalationDrawerOpen(false);
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
        owner_id: ssoRiskRunbookDraft.owner_id,
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
        owner_id: ssoRiskRunbookDraft.owner_id,
        dev_tool: ssoRiskRunbookDraft.dev_tool,
        channels: ssoRiskRunbookDraft.channels,
        title: ssoRiskRunbookDraft.title,
      }),
    onSuccess: (data, vars) => {
      setSsoRiskRunbookDetail(data);
      if (!vars.dryRun && ["create_tasks", "archive"].includes(vars.action)) {
        setSsoRiskRunbookDrawerOpen(false);
      }
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
        <Suspense fallback={<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t("common.loading")}</div>}>
          <SettingsAccountPanel
            me={me}
            tenantLabel={tenantLabel}
            projectId={projectId}
            logoutPending={logout.isPending}
            onLogout={() => logout.mutate()}
          />
        </Suspense>
      ) : null}

      {opsModuleActive ? (
        <Suspense fallback={<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t("common.loading")}</div>}>
          <SettingsRuntimePanel
            module={activeModule === "observability" ? "observability" : "runtime"}
            health={health}
            opsObservability={opsObservability}
            opsLogs={opsLogs}
            opsTraceSummary={opsTraceSummary}
            healthOk={healthOk}
            logFilter={logFilter}
            traceFilter={traceFilter}
            setLogFilter={setLogFilter}
            setTraceFilter={setTraceFilter}
          />
        </Suspense>
      ) : null}

      {activeModule === "workspace" ? (
        <Suspense fallback={<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t("common.loading")}</div>}>
          <SettingsWorkspacePanel />
        </Suspense>
      ) : null}

      {activeModule === "profiles" ? (
        <Suspense fallback={<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t("common.loading")}</div>}>
          <SettingsProfilesPanel
            api={api}
            opsProfiles={opsProfiles}
            profileDraft={profileDraft}
            setProfileDraft={setProfileDraft}
            profileDrawerOpen={profileDrawerOpen}
            setProfileDrawerOpen={setProfileDrawerOpen}
            profileEnv={profileEnv}
            profileBundle={profileBundle}
            saveProfile={saveProfile}
            activateProfile={activateProfile}
            deleteProfile={deleteProfile}
            exportProfile={exportProfile}
            exportBundle={exportBundle}
            deploymentPackageDraft={deploymentPackageDraft}
            setDeploymentPackageDraft={setDeploymentPackageDraft}
            deploymentPackageDetail={deploymentPackageDetail}
            deploymentPackages={deploymentPackages}
            createDeploymentPackage={createDeploymentPackage}
            loadDeploymentPackage={loadDeploymentPackage}
            controlledReleasesHref={controlledReleasesHref}
          />
        </Suspense>
      ) : null}
      {activeModule === "storage" ? (
        <Suspense fallback={<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t("common.loading")}</div>}>
          <SettingsStoragePanel
            opsStorageMigrationPlan={opsStorageMigrationPlan}
            storageSmokeResult={storageSmokeResult}
            runStorageSmoke={runStorageSmoke}
          />
        </Suspense>
      ) : null}

      {activeModule === "sso" ? (
        <Suspense fallback={<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t("common.loading")}</div>}>
          <SettingsSsoPanel
            ssoConfig={ssoConfig}
            ssoDraft={ssoDraft}
            setSsoDraft={setSsoDraft}
            ssoTestResult={ssoTestResult}
            saveSso={saveSso}
            testSso={testSso}
            deleteSso={deleteSso}
            ssoPreviewDraft={ssoPreviewDraft}
            setSsoPreviewDraft={setSsoPreviewDraft}
            ssoPreviewResult={ssoPreviewResult}
            previewSsoRole={previewSsoRole}
            scimTokenResult={scimTokenResult}
            rotateScimToken={rotateScimToken}
            scimTestDraft={scimTestDraft}
            setScimTestDraft={setScimTestDraft}
            scimTestResult={scimTestResult}
            testScimUser={testScimUser}
            selectedSsoProviderExists={selectedSsoProviderExists}
            ssoScimAudit={ssoScimAudit}
            ssoRiskReport={ssoRiskReport}
            ssoRiskTaskDraft={ssoRiskTaskDraft}
            setSsoRiskTaskDraft={setSsoRiskTaskDraft}
            ssoRiskTaskResult={ssoRiskTaskResult}
            ssoRiskTaskDrawerOpen={ssoRiskTaskDrawerOpen}
            setSsoRiskTaskDrawerOpen={setSsoRiskTaskDrawerOpen}
            runSsoRiskTasks={runSsoRiskTasks}
            ssoRiskImDraft={ssoRiskImDraft}
            setSsoRiskImDraft={setSsoRiskImDraft}
            ssoRiskImResult={ssoRiskImResult}
            ssoRiskImDrawerOpen={ssoRiskImDrawerOpen}
            setSsoRiskImDrawerOpen={setSsoRiskImDrawerOpen}
            runSsoRiskIm={runSsoRiskIm}
            notifyChannels={notifyChannels}
            ssoRiskSubscription={ssoRiskSubscription}
            ssoRiskSubscriptionDraft={ssoRiskSubscriptionDraft}
            setSsoRiskSubscriptionDraft={setSsoRiskSubscriptionDraft}
            ssoRiskSubscriptionResult={ssoRiskSubscriptionResult}
            saveSsoRiskSubscription={saveSsoRiskSubscription}
            runSsoRiskSubscription={runSsoRiskSubscription}
            ssoRiskEscalation={ssoRiskEscalation}
            ssoRiskEscalationDraft={ssoRiskEscalationDraft}
            setSsoRiskEscalationDraft={setSsoRiskEscalationDraft}
            ssoRiskEscalationResult={ssoRiskEscalationResult}
            ssoRiskEscalationDrawerOpen={ssoRiskEscalationDrawerOpen}
            setSsoRiskEscalationDrawerOpen={setSsoRiskEscalationDrawerOpen}
            saveSsoRiskEscalation={saveSsoRiskEscalation}
            runSsoRiskEscalation={runSsoRiskEscalation}
            ssoRiskRunbookDraft={ssoRiskRunbookDraft}
            setSsoRiskRunbookDraft={setSsoRiskRunbookDraft}
            ssoRiskRunbookDetail={ssoRiskRunbookDetail}
            ssoRiskRunbookDrawerOpen={ssoRiskRunbookDrawerOpen}
            setSsoRiskRunbookDrawerOpen={setSsoRiskRunbookDrawerOpen}
            createSsoRiskRunbook={createSsoRiskRunbook}
            loadSsoRiskRunbook={loadSsoRiskRunbook}
            applySsoRiskRunbookAction={applySsoRiskRunbookAction}
            ssoRiskRunbooks={ssoRiskRunbooks}
          />
        </Suspense>
      ) : null}
      {activeModule === "appearance" ? (
        <Suspense fallback={<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t("common.loading")}</div>}>
          <SettingsAppearancePanel />
        </Suspense>
      ) : null}

      {activeModule === "billing" ? (
        <Suspense fallback={<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t("common.loading")}</div>}>
          <SettingsBillingPanel
            billing={billing}
            billingAlerts={billingAlerts}
            billingSummary={billingSummary}
            billingDunning={billingDunning}
            billingOveragePolicy={billingOveragePolicy}
            invoice={invoice}
            invoices={invoices}
            payments={payments}
            invoiceAudit={invoiceAudit}
            planDraft={planDraft}
            setPlanDraft={setPlanDraft}
            billingEmail={billingEmail}
            setBillingEmail={setBillingEmail}
            paymentDraft={paymentDraft}
            setPaymentDraft={setPaymentDraft}
            overageDraft={overageDraft}
            setOverageDraft={setOverageDraft}
            entitlementDraft={entitlementDraft}
            setEntitlementDraft={setEntitlementDraft}
            entitlementResult={entitlementResult}
            billingDrawerOpen={billingDrawerOpen}
            setBillingDrawerOpen={setBillingDrawerOpen}
            auditInvoiceId={auditInvoiceId}
            setAuditInvoiceId={setAuditInvoiceId}
            updateBilling={updateBilling}
            updateOveragePolicy={updateOveragePolicy}
            checkEntitlement={checkEntitlement}
            snapshotInvoice={snapshotInvoice}
            updateInvoiceStatus={updateInvoiceStatus}
            recordPayment={recordPayment}
          />
        </Suspense>
      ) : null}
      </section>
      </div>
    </div>
  );
}

function ModuleDot({ tone }: { tone: "ok" | "warn" | "danger" }) {
  const cls = tone === "ok" ? "bg-emerald-500" : tone === "danger" ? "bg-rose-500" : "bg-amber-500";
  return <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${cls}`} />;
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


function splitTokens(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
