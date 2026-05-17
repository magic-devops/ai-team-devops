import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, BadgeDollarSign, CloudCog, Database, ExternalLink, FileText, KeyRound, LogOut, Network, Palette, Search, ServerCog, ShieldCheck, SlidersHorizontal, Terminal, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { api } from "../lib/api";
import { clearSession, getProjectId, getToken } from "../lib/authStorage";
import { getThemePreference, setThemePreference, THEME_OPTIONS, type ThemePreference } from "../lib/theme";
import { SettingsWorkbenchHeader } from "./admin/SettingsWorkbenchHeader";

type SettingsModule = "account" | "runtime" | "workspace" | "profiles" | "sso" | "appearance" | "billing";

const inputClass = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";

function currentRedirectTarget() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/?shell=1#/dashboard";
}

export function Settings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [themePref, setThemePref] = useState<ThemePreference>(() => getThemePreference());
  const token = getToken();
  const projectId = getProjectId();
  const me = useQuery({ queryKey: ["authMe"], queryFn: api.authMe, enabled: Boolean(token), retry: false });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, enabled: Boolean(token), retry: false });
  const billing = useQuery({ queryKey: ["billingSubscription"], queryFn: api.billingSubscription, enabled: Boolean(token), retry: false });
  const billingAlerts = useQuery({ queryKey: ["billingAlerts"], queryFn: api.billingAlerts, enabled: Boolean(token), retry: false });
  const billingSummary = useQuery({ queryKey: ["billingSummary"], queryFn: api.billingSummary, enabled: Boolean(token), retry: false });
  const ssoConfig = useQuery({ queryKey: ["ssoConfig"], queryFn: api.ssoConfig, enabled: Boolean(token), retry: false });
  const opsProfiles = useQuery({ queryKey: ["opsProfiles"], queryFn: api.opsProfiles, enabled: Boolean(token), retry: false });
  const opsObservability = useQuery({ queryKey: ["opsObservability"], queryFn: api.opsObservability, enabled: Boolean(token), retry: false });
  const invoice = useQuery({ queryKey: ["billingInvoice"], queryFn: () => api.billingInvoice(), enabled: Boolean(token), retry: false });
  const invoices = useQuery({ queryKey: ["billingInvoices"], queryFn: () => api.billingInvoices(20), enabled: Boolean(token), retry: false });
  const payments = useQuery({ queryKey: ["billingPayments"], queryFn: () => api.billingPayments("", 20), enabled: Boolean(token), retry: false });
  const [planDraft, setPlanDraft] = useState("starter");
  const [billingEmail, setBillingEmail] = useState("");
  const [paymentDraft, setPaymentDraft] = useState({ invoice_id: "", amount_usd: "", method: "manual", external_ref: "" });
  const [ssoDraft, setSsoDraft] = useState({
    provider: "okta",
    type: "oidc",
    issuer: "",
    client_id: "",
    client_secret: "",
    redirect_uri: "",
    scope: "openid profile email",
    metadata_url: "",
    tenant_domain_map: "example.com=t-default",
    role_map: "sop-admins=tenant_admin\nsop-devops=devops\n*=developer",
    enabled: true,
  });
  const [ssoTestResult, setSsoTestResult] = useState<any>(null);
  const [ssoPreviewDraft, setSsoPreviewDraft] = useState({ email: "admin@example.com", groups: "sop-admins,sop-devops" });
  const [ssoPreviewResult, setSsoPreviewResult] = useState<any>(null);
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
  const [profileEnv, setProfileEnv] = useState<any>(null);
  const [profileBundle, setProfileBundle] = useState<any>(null);
  const [logFilter, setLogFilter] = useState({ name: "sop.app.log", level: "", q: "", limit: "200" });
  const [activeModule, setActiveModule] = useState<SettingsModule>("account");
  const opsLogs = useQuery({
    queryKey: ["opsLogs", logFilter.name, logFilter.level, logFilter.q, logFilter.limit],
    queryFn: () => api.opsLogs(logFilter.name, Number(logFilter.limit || 200), logFilter.level, logFilter.q),
    enabled: Boolean(token) && activeModule === "runtime",
    retry: false,
  });

  useEffect(() => {
    const sync = () => setThemePref(getThemePreference());
    window.addEventListener("sop-theme", sync);
    return () => window.removeEventListener("sop-theme", sync);
  }, []);

  useEffect(() => {
    if (!billing.data) return;
    setPlanDraft(String(billing.data.subscription?.plan || "starter"));
    setBillingEmail(String(billing.data.subscription?.billing_email || me.data?.email || ""));
  }, [billing.data, me.data?.email]);

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

  const snapshotInvoice = useMutation({
    mutationFn: () => api.billingSnapshotInvoice(String(invoice.data?.period || "")),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["billingInvoice"] });
      void qc.invalidateQueries({ queryKey: ["billingInvoices"] });
    },
  });

  const updateInvoiceStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.billingUpdateInvoiceStatus(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["billingInvoices"] }),
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
      tenant_domain_map: parseTextMap(ssoDraft.tenant_domain_map),
      role_map: parseTextMap(ssoDraft.role_map),
      enabled: ssoDraft.enabled,
    }),
    onSuccess: (data) => {
      setSsoDraft((v) => ({ ...v, client_secret: "" }));
      setSsoTestResult(data);
      void qc.invalidateQueries({ queryKey: ["ssoConfig"] });
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsProfiles"] }),
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

  if (!token) return null;

  const tenantLabel = me.data?.tenant_name || me.data?.tenant_slug || me.data?.tenant_id || "-";
  const healthOk = health.data?.ok === true;
  const modules: Array<{ id: SettingsModule; title: string; desc: string; icon: ReactNode; tone?: "ok" | "warn" | "danger" }> = [
    { id: "account", title: t("page.settings.moduleAccount"), desc: t("page.settings.moduleAccountDesc"), icon: <ShieldCheck className="h-5 w-5" />, tone: me.isError ? "danger" : "ok" },
    { id: "runtime", title: t("page.settings.moduleRuntime"), desc: t("page.settings.moduleRuntimeDesc"), icon: <ServerCog className="h-5 w-5" />, tone: healthOk ? "ok" : health.isError ? "danger" : "warn" },
    { id: "workspace", title: t("page.settings.moduleWorkspace"), desc: t("page.settings.moduleWorkspaceDesc"), icon: <ExternalLink className="h-5 w-5" /> },
    { id: "profiles", title: t("page.settings.moduleProfiles"), desc: t("page.settings.moduleProfilesDesc"), icon: <CloudCog className="h-5 w-5" />, tone: opsProfiles.data?.doctor?.ok ? "ok" : opsProfiles.isError ? "danger" : "warn" },
    { id: "sso", title: t("page.settings.moduleSso"), desc: t("page.settings.moduleSsoDesc"), icon: <KeyRound className="h-5 w-5" />, tone: ssoConfig.data?.enabled ? "ok" : ssoConfig.isError ? "danger" : "warn" },
    { id: "appearance", title: t("page.settings.moduleAppearance"), desc: t("page.settings.moduleAppearanceDesc"), icon: <Palette className="h-5 w-5" /> },
    { id: "billing", title: t("page.settings.moduleBilling"), desc: t("page.settings.moduleBillingDesc"), icon: <BadgeDollarSign className="h-5 w-5" />, tone: billingAlerts.data?.total ? "warn" : billing.isError ? "danger" : "ok" },
  ];

  return (
    <div className="w-full space-y-5">
      <SettingsWorkbenchHeader />
      <div className="grid w-full gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <Card title={t("page.settings.systemCard")}>
          <div className="space-y-2">
            {modules.map((m) => (
              <button
                key={m.id}
                type="button"
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
              </button>
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

      {activeModule === "runtime" ? (
        <Card
          title={t("page.settings.runtimeCard")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]"
                onClick={() => {
                  void health.refetch();
                  void opsObservability.refetch();
                  void opsLogs.refetch();
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
        <Card
          title={t("page.settings.profilesCard")}
          actions={<StatusPill tone={opsProfiles.data?.doctor?.ok ? "ok" : opsProfiles.isError ? "danger" : "warn"} label={opsProfiles.data?.active || "..."} />}
        >
          <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
            <form
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!profileDraft.name.trim()) return;
                saveProfile.mutate();
              }}
            >
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
                <div className="grid gap-3 sm:grid-cols-3">
                  <input className={inputClass} value={profileDraft.name} onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })} placeholder="local-dev" />
                  <select className={inputClass} value={profileDraft.mode} onChange={(e) => setProfileDraft({ ...profileDraft, mode: e.target.value })}>
                    {["local", "single", "saas", "private"].map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <select className={inputClass} value={profileDraft.database} onChange={(e) => setProfileDraft({ ...profileDraft, database: e.target.value })}>
                    {["sqlite", "postgresql", "mysql", "oceanbase"].map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
                <input className={inputClass} value={profileDraft.manager_url} onChange={(e) => setProfileDraft({ ...profileDraft, manager_url: e.target.value })} placeholder="MANAGER_URL" />
                <input className={inputClass} value={profileDraft.public_url} onChange={(e) => setProfileDraft({ ...profileDraft, public_url: e.target.value })} placeholder="MANAGER_PUBLIC_URL" />
                <input className={inputClass} value={profileDraft.features} onChange={(e) => setProfileDraft({ ...profileDraft, features: e.target.value })} placeholder="billing=true,sso=true,worker=true" />
                <textarea className={`${inputClass} min-h-36 font-mono text-xs`} value={profileDraft.env} onChange={(e) => setProfileDraft({ ...profileDraft, env: e.target.value })} placeholder={"ADMIN_MODE=saas\nDB_TYPE=postgresql"} />
                <textarea className={`${inputClass} min-h-20`} value={profileDraft.notes} onChange={(e) => setProfileDraft({ ...profileDraft, notes: e.target.value })} placeholder={t("page.settings.profileNotes")} />
                <button type="submit" className="w-full rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={saveProfile.isPending || !profileDraft.name.trim()}>
                  {t("page.settings.profileSave")}
                </button>
                {saveProfile.error ? <ErrorLine message={(saveProfile.error as Error).message} /> : null}
              </div>
            </form>
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
                    onClick={() => setProfileDraft(profileToDraft(tpl))}
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
                    <button type="button" className="min-w-0 text-left" onClick={() => setProfileDraft(profileToDraft(row))}>
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
              {exportBundle.error ? <ErrorLine message={(exportBundle.error as Error).message} /> : null}
              {opsProfiles.data?.config_path ? <p className="break-all text-xs text-[var(--muted)]">{opsProfiles.data.config_path}</p> : null}
              {opsProfiles.isError ? <ErrorLine message={(opsProfiles.error as Error).message} /> : null}
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
                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t("page.settings.ssoJitDesc")}</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="grid grid-cols-[1fr_5rem_7rem_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
                  <span>{t("page.settings.ssoProvider")}</span>
                  <span>{t("page.settings.ssoType")}</span>
                  <span>{t("page.settings.ssoSource")}</span>
                  <span>{t("page.settings.status")}</span>
                </div>
                {(ssoConfig.data?.items || []).map((row: any) => (
                  <div key={row.name} className="grid grid-cols-[1fr_5rem_7rem_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
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
          <div className="grid grid-cols-[1fr_7rem_7rem_9rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
            <span>{t("page.settings.invoiceHistory")}</span>
            <span>{t("page.settings.period")}</span>
            <span className="text-right">{t("page.settings.totalDue")}</span>
            <span>{t("page.settings.status")}</span>
          </div>
          {(invoices.data?.items || []).map((row: any) => (
            <div key={row.id} className="grid grid-cols-[1fr_7rem_7rem_9rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
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
            </div>
          ))}
          {!invoices.data?.items?.length ? (
            <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.noInvoiceHistory")}</div>
          ) : null}
        </div>
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
