import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, BadgeDollarSign, CloudCog, Database, ExternalLink, FileText, KeyRound, LogOut, Network, Palette, Search, ServerCog, ShieldCheck, SlidersHorizontal, Terminal, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { api } from "../lib/api";
import { clearSession, getProjectId, getToken } from "../lib/authStorage";
import { getThemePreference, setThemePreference, THEME_OPTIONS } from "../lib/theme";
import { SettingsWorkbenchHeader } from "./admin/SettingsWorkbenchHeader";
const inputClass = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";
function currentRedirectTarget() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/?shell=1#/dashboard";
}
export function Settings() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [themePref, setThemePref] = useState(() => getThemePreference());
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
    const [ssoTestResult, setSsoTestResult] = useState(null);
    const [ssoPreviewDraft, setSsoPreviewDraft] = useState({ email: "admin@example.com", groups: "sop-admins,sop-devops" });
    const [ssoPreviewResult, setSsoPreviewResult] = useState(null);
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
    const [profileEnv, setProfileEnv] = useState(null);
    const [profileBundle, setProfileBundle] = useState(null);
    const [logFilter, setLogFilter] = useState({ name: "sop.app.log", level: "", q: "", limit: "200" });
    const [activeModule, setActiveModule] = useState("account");
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
        if (!billing.data)
            return;
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
        mutationFn: () => api.billingUpdateSubscription({
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
        mutationFn: ({ id, status }) => api.billingUpdateInvoiceStatus(id, status),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ["billingInvoices"] }),
    });
    const recordPayment = useMutation({
        mutationFn: () => api.billingRecordPayment({
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
        mutationFn: (provider) => api.ssoDeleteProvider(provider),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ["ssoConfig"] }),
    });
    const testSso = useMutation({
        mutationFn: (provider) => api.ssoTestProvider(provider),
        onSuccess: (data) => setSsoTestResult(data),
    });
    const previewSsoRole = useMutation({
        mutationFn: () => api.ssoRolePreview(ssoDraft.provider, {
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
        mutationFn: (profile) => api.opsActivateProfile(profile),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsProfiles"] }),
    });
    const deleteProfile = useMutation({
        mutationFn: (profile) => api.opsDeleteProfile(profile),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ["opsProfiles"] }),
    });
    const exportProfile = useMutation({
        mutationFn: (profile) => api.opsProfileEnv(profile),
        onSuccess: (data) => setProfileEnv(data),
    });
    const exportBundle = useMutation({
        mutationFn: (profile) => api.opsProfileBundle(profile),
        onSuccess: (data) => setProfileBundle(data),
    });
    if (!token)
        return null;
    const tenantLabel = me.data?.tenant_name || me.data?.tenant_slug || me.data?.tenant_id || "-";
    const healthOk = health.data?.ok === true;
    const modules = [
        { id: "account", title: t("page.settings.moduleAccount"), desc: t("page.settings.moduleAccountDesc"), icon: _jsx(ShieldCheck, { className: "h-5 w-5" }), tone: me.isError ? "danger" : "ok" },
        { id: "runtime", title: t("page.settings.moduleRuntime"), desc: t("page.settings.moduleRuntimeDesc"), icon: _jsx(ServerCog, { className: "h-5 w-5" }), tone: healthOk ? "ok" : health.isError ? "danger" : "warn" },
        { id: "workspace", title: t("page.settings.moduleWorkspace"), desc: t("page.settings.moduleWorkspaceDesc"), icon: _jsx(ExternalLink, { className: "h-5 w-5" }) },
        { id: "profiles", title: t("page.settings.moduleProfiles"), desc: t("page.settings.moduleProfilesDesc"), icon: _jsx(CloudCog, { className: "h-5 w-5" }), tone: opsProfiles.data?.doctor?.ok ? "ok" : opsProfiles.isError ? "danger" : "warn" },
        { id: "sso", title: t("page.settings.moduleSso"), desc: t("page.settings.moduleSsoDesc"), icon: _jsx(KeyRound, { className: "h-5 w-5" }), tone: ssoConfig.data?.enabled ? "ok" : ssoConfig.isError ? "danger" : "warn" },
        { id: "appearance", title: t("page.settings.moduleAppearance"), desc: t("page.settings.moduleAppearanceDesc"), icon: _jsx(Palette, { className: "h-5 w-5" }) },
        { id: "billing", title: t("page.settings.moduleBilling"), desc: t("page.settings.moduleBillingDesc"), icon: _jsx(BadgeDollarSign, { className: "h-5 w-5" }), tone: billingAlerts.data?.total ? "warn" : billing.isError ? "danger" : "ok" },
    ];
    return (_jsxs("div", { className: "w-full space-y-5", children: [_jsx(SettingsWorkbenchHeader, {}), _jsxs("div", { className: "grid w-full gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]", children: [_jsx("aside", { className: "min-w-0 xl:sticky xl:top-4 xl:self-start", children: _jsx(Card, { title: t("page.settings.systemCard"), children: _jsx("div", { className: "space-y-2", children: modules.map((m) => (_jsxs("button", { type: "button", onClick: () => setActiveModule(m.id), className: `flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition ${activeModule === m.id
                                        ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]"
                                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"}`, children: [_jsx("span", { className: "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]", children: m.icon }), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsxs("span", { className: "flex items-center justify-between gap-2", children: [_jsx("span", { className: "truncate text-sm font-semibold", children: m.title }), m.tone ? _jsx(ModuleDot, { tone: m.tone }) : null] }), _jsx("span", { className: "mt-1 block text-xs leading-5 text-[var(--muted)]", children: m.desc })] })] }, m.id))) }) }) }), _jsxs("section", { className: "min-w-0 space-y-5", children: [activeModule === "account" ? (_jsxs(Card, { title: t("page.settings.accountCard"), actions: _jsx(StatusPill, { tone: me.isError ? "danger" : "ok", label: me.isError ? t("page.settings.sessionError") : t("auth.secure") }), children: [_jsxs("div", { className: "grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]", children: [_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]", children: _jsx(ShieldCheck, { className: "h-7 w-7" }) }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-lg font-semibold text-[var(--text)]", children: me.data?.username || t("auth.account") }), _jsx("p", { className: "truncate text-xs text-[var(--muted)]", children: me.data?.email || me.data?.role || t("auth.loggedIn") })] })] }), _jsxs("button", { type: "button", className: "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] shadow-sm hover:bg-[var(--surface-muted)] disabled:opacity-50", disabled: logout.isPending, onClick: () => logout.mutate(), children: [_jsx(LogOut, { className: "h-4 w-4 text-[var(--brand)]" }), t("auth.logout")] })] }), _jsxs("div", { className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-4", children: [_jsx(Info, { label: t("auth.status"), value: t("auth.loggedIn") }), _jsx(Info, { label: t("auth.role"), value: me.data?.role || "-" }), _jsx(Info, { label: t("auth.tenant"), value: tenantLabel }), _jsx(Info, { label: t("auth.project"), value: projectId || "-" })] })] }), me.isError ? _jsx(ErrorLine, { message: me.error.message }) : null, !projectId ? _jsx(HintLine, { message: t("auth.noProject") }) : null] })) : null, activeModule === "runtime" ? (_jsxs(Card, { title: t("page.settings.runtimeCard"), actions: _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("button", { type: "button", className: "rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]", onClick: () => {
                                                void health.refetch();
                                                void opsObservability.refetch();
                                                void opsLogs.refetch();
                                            }, children: t("common.refresh") }), _jsx(StatusPill, { tone: healthOk ? "ok" : health.isError ? "danger" : "warn", label: healthOk ? "OK" : health.isError ? "ERR" : "..." })] }), children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-3", children: [_jsx(Info, { label: t("page.settings.manager"), value: healthOk ? "online" : health.isError ? "error" : t("common.loading") }), _jsx(Info, { label: t("page.settings.version"), value: String(health.data?.version ?? "-") }), _jsx(Info, { label: t("page.settings.apiBase"), value: window.location.origin })] }), health.isError ? _jsx(ErrorLine, { message: health.error.message }) : null, _jsxs("div", { className: "mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4", children: [_jsx(SettingLink, { href: "/api/v1/health", icon: _jsx(ServerCog, { className: "h-5 w-5" }), title: t("page.settings.healthTitle"), body: t("page.settings.healthDesc"), external: true }), _jsx(SettingLink, { href: "/metrics", icon: _jsx(SlidersHorizontal, { className: "h-5 w-5" }), title: t("page.settings.metricsTitle"), body: t("page.settings.metricsDesc"), external: true }), _jsx(SettingLink, { href: "/api/v1/events", icon: _jsx(Activity, { className: "h-5 w-5" }), title: t("page.settings.eventsTitle"), body: t("page.settings.eventsDesc"), external: true }), _jsx(SettingLink, { href: "/api/v1/system/ops/observability", icon: _jsx(FileText, { className: "h-5 w-5" }), title: t("page.settings.logsTitle"), body: t("page.settings.logsDesc"), external: true })] }), _jsxs("div", { className: "mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]", children: [_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid gap-3 md:grid-cols-4", children: [_jsx(MetricBox, { label: t("page.settings.logFiles"), value: opsObservability.data?.logs?.length ?? 0 }), _jsx(MetricBox, { label: t("page.settings.eventTotal"), value: opsObservability.data?.events?.total ?? 0 }), _jsx(MetricBox, { label: t("page.settings.doctorFailed"), value: opsObservability.data?.doctor?.failed ?? 0 }), _jsx(MetricBox, { label: t("page.settings.logReturned"), value: opsLogs.data?.total ?? 0 })] }), _jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", children: [_jsxs("div", { className: "flex flex-wrap items-end gap-2", children: [_jsxs("label", { className: "min-w-40 flex-1 text-xs font-medium text-[var(--muted)]", children: [t("page.settings.logFile"), _jsx("select", { className: `${inputClass} mt-1`, value: logFilter.name, onChange: (e) => setLogFilter({ ...logFilter, name: e.target.value }), children: (opsObservability.data?.logs || [{ name: "sop.app.log" }]).map((log) => (_jsx("option", { value: log.name, children: log.name }, log.name))) })] }), _jsxs("label", { className: "w-28 text-xs font-medium text-[var(--muted)]", children: [t("page.settings.level"), _jsxs("select", { className: `${inputClass} mt-1`, value: logFilter.level, onChange: (e) => setLogFilter({ ...logFilter, level: e.target.value }), children: [_jsx("option", { value: "", children: t("page.settings.allLevels") }), ["INFO", "WARNING", "ERROR", "DEBUG"].map((lv) => _jsx("option", { value: lv, children: lv }, lv))] })] }), _jsxs("label", { className: "w-24 text-xs font-medium text-[var(--muted)]", children: [t("page.settings.limit"), _jsx("input", { className: `${inputClass} mt-1`, value: logFilter.limit, onChange: (e) => setLogFilter({ ...logFilter, limit: e.target.value }), inputMode: "numeric" })] }), _jsxs("label", { className: "min-w-56 flex-1 text-xs font-medium text-[var(--muted)]", children: [t("common.search"), _jsx("input", { className: `${inputClass} mt-1`, value: logFilter.q, onChange: (e) => setLogFilter({ ...logFilter, q: e.target.value }), placeholder: t("page.settings.logSearchPh") })] })] }), opsLogs.isError ? _jsx(ErrorLine, { message: opsLogs.error.message }) : null, _jsxs("div", { className: "mt-4 max-h-[34rem] overflow-auto rounded-xl border border-[var(--border)] bg-slate-950", children: [(opsLogs.data?.items || []).map((row, idx) => (_jsxs("div", { className: "grid grid-cols-[8.5rem_5.5rem_minmax(0,1fr)] gap-3 border-b border-slate-800 px-3 py-2 text-xs last:border-0", children: [_jsx("span", { className: "font-mono text-slate-500", children: row.ts || "-" }), _jsx("span", { className: logLevelClass(row.level), children: row.level || "-" }), _jsx("span", { className: "whitespace-pre-wrap break-words font-mono text-slate-200", children: row.message || row.raw })] }, `${row.ts}-${idx}`))), !opsLogs.data?.items?.length ? _jsx("div", { className: "px-4 py-8 text-sm text-slate-400", children: t("page.settings.noLogs") }) : null] })] })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: t("page.settings.logFiles") }), _jsxs("div", { className: "mt-3 space-y-2", children: [(opsObservability.data?.logs || []).map((log) => (_jsxs("button", { type: "button", className: "w-full rounded-xl border border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--surface-muted)]", onClick: () => setLogFilter({ ...logFilter, name: log.name }), children: [_jsx("span", { className: "block text-sm font-medium text-[var(--text)]", children: log.name }), _jsxs("span", { className: "block truncate text-xs text-[var(--muted)]", children: [formatBytes(log.size), " \u00B7 ", log.updated_at] })] }, log.name))), !opsObservability.data?.logs?.length ? _jsx("p", { className: "text-sm text-[var(--muted)]", children: t("page.settings.noLogs") }) : null] })] }), _jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: t("page.settings.eventTypes") }), _jsxs("div", { className: "mt-3 space-y-2", children: [Object.entries(opsObservability.data?.events?.by_action || {}).map(([action, count]) => (_jsxs("div", { className: "flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-xs", children: [_jsx("span", { className: "truncate font-mono text-[var(--muted-strong)]", children: action }), _jsx("span", { className: "font-semibold text-[var(--text)]", children: String(count) })] }, action))), !Object.keys(opsObservability.data?.events?.by_action || {}).length ? _jsx("p", { className: "text-sm text-[var(--muted)]", children: t("page.settings.noEvents") }) : null] })] }), opsObservability.isError ? _jsx(ErrorLine, { message: opsObservability.error.message }) : null, _jsx("p", { className: "break-all text-xs text-[var(--muted)]", children: opsObservability.data?.log_dir || "" })] })] })] })) : null, activeModule === "workspace" ? (_jsx(Card, { title: t("page.settings.workspaceCard"), children: _jsxs("div", { className: "grid gap-3 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(SettingLink, { href: "#/organization", icon: _jsx(UsersRound, { className: "h-5 w-5" }), title: t("page.settings.orgTitle"), body: t("page.settings.orgDesc") }), _jsx(SettingLink, { href: "#/intelligence", icon: _jsx(Database, { className: "h-5 w-5" }), title: t("page.settings.dbTitle"), body: t("page.settings.dbDesc") }), _jsx(SettingLink, { href: "#/vibe", icon: _jsx(Terminal, { className: "h-5 w-5" }), title: t("page.settings.vibeTitle"), body: t("page.settings.vibeDesc") }), _jsx(SettingLink, { href: "#/orchestration", icon: _jsx(Network, { className: "h-5 w-5" }), title: t("page.settings.orchestrationTitle"), body: t("page.settings.orchestrationDesc") }), _jsx(SettingLink, { href: "#/search", icon: _jsx(Search, { className: "h-5 w-5" }), title: t("page.settings.searchTitle"), body: t("page.settings.searchDesc") }), _jsx(SettingLink, { href: "/login.html", icon: _jsx(ShieldCheck, { className: "h-5 w-5" }), title: t("page.settings.loginTitle"), body: t("page.settings.loginDesc"), external: true })] }) })) : null, activeModule === "profiles" ? (_jsx(Card, { title: t("page.settings.profilesCard"), actions: _jsx(StatusPill, { tone: opsProfiles.data?.doctor?.ok ? "ok" : opsProfiles.isError ? "danger" : "warn", label: opsProfiles.data?.active || "..." }), children: _jsxs("div", { className: "grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]", children: [_jsxs("form", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4", onSubmit: (e) => {
                                                e.preventDefault();
                                                if (!profileDraft.name.trim())
                                                    return;
                                                saveProfile.mutate();
                                            }, children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]", children: _jsx(CloudCog, { className: "h-6 w-6" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: t("page.settings.profileEdit") }), _jsx("p", { className: "text-xs text-[var(--muted)]", children: t("page.settings.profileDesc") })] })] }), _jsxs("div", { className: "mt-4 space-y-3", children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-3", children: [_jsx("input", { className: inputClass, value: profileDraft.name, onChange: (e) => setProfileDraft({ ...profileDraft, name: e.target.value }), placeholder: "local-dev" }), _jsx("select", { className: inputClass, value: profileDraft.mode, onChange: (e) => setProfileDraft({ ...profileDraft, mode: e.target.value }), children: ["local", "single", "saas", "private"].map((x) => _jsx("option", { value: x, children: x }, x)) }), _jsx("select", { className: inputClass, value: profileDraft.database, onChange: (e) => setProfileDraft({ ...profileDraft, database: e.target.value }), children: ["sqlite", "postgresql", "mysql", "oceanbase"].map((x) => _jsx("option", { value: x, children: x }, x)) })] }), _jsx("input", { className: inputClass, value: profileDraft.manager_url, onChange: (e) => setProfileDraft({ ...profileDraft, manager_url: e.target.value }), placeholder: "MANAGER_URL" }), _jsx("input", { className: inputClass, value: profileDraft.public_url, onChange: (e) => setProfileDraft({ ...profileDraft, public_url: e.target.value }), placeholder: "MANAGER_PUBLIC_URL" }), _jsx("input", { className: inputClass, value: profileDraft.features, onChange: (e) => setProfileDraft({ ...profileDraft, features: e.target.value }), placeholder: "billing=true,sso=true,worker=true" }), _jsx("textarea", { className: `${inputClass} min-h-36 font-mono text-xs`, value: profileDraft.env, onChange: (e) => setProfileDraft({ ...profileDraft, env: e.target.value }), placeholder: "ADMIN_MODE=saas\nDB_TYPE=postgresql" }), _jsx("textarea", { className: `${inputClass} min-h-20`, value: profileDraft.notes, onChange: (e) => setProfileDraft({ ...profileDraft, notes: e.target.value }), placeholder: t("page.settings.profileNotes") }), _jsx("button", { type: "submit", className: "w-full rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50", disabled: saveProfile.isPending || !profileDraft.name.trim(), children: t("page.settings.profileSave") }), saveProfile.error ? _jsx(ErrorLine, { message: saveProfile.error.message }) : null] })] }), _jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "grid gap-3 md:grid-cols-3", children: (opsProfiles.data?.doctor?.checks || []).map((check) => (_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", children: [_jsx(StatusPill, { tone: check.ok ? "ok" : "warn", label: check.ok ? "OK" : "WARN" }), _jsx("p", { className: "mt-3 text-sm font-semibold text-[var(--text)]", children: check.id }), _jsx("p", { className: "mt-1 truncate text-xs text-[var(--muted)]", children: check.message })] }, check.id))) }), _jsx("div", { className: "grid gap-3 md:grid-cols-2", children: (opsProfiles.data?.templates || []).map((tpl) => (_jsxs("button", { type: "button", className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]", onClick: () => setProfileDraft(profileToDraft(tpl)), children: [_jsx("span", { className: "text-sm font-semibold text-[var(--text)]", children: tpl.name }), _jsx("span", { className: "mt-1 block text-xs text-[var(--muted)]", children: tpl.notes })] }, tpl.name))) }), _jsxs("div", { className: "overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]", children: [_jsxs("div", { className: "grid grid-cols-[1fr_6rem_7rem_11rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]", children: [_jsx("span", { children: t("page.settings.profile") }), _jsx("span", { children: t("page.settings.mode") }), _jsx("span", { children: t("page.settings.database") }), _jsx("span", { children: t("page.settings.actions") })] }), (opsProfiles.data?.items || []).map((row) => (_jsxs("div", { className: "grid grid-cols-[1fr_6rem_7rem_11rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0", children: [_jsxs("button", { type: "button", className: "min-w-0 text-left", onClick: () => setProfileDraft(profileToDraft(row)), children: [_jsx("span", { className: "block truncate text-sm font-semibold text-[var(--text)]", children: row.name }), _jsx("span", { className: "block truncate text-xs text-[var(--muted)]", children: row.manager_url || row.public_url || row.notes })] }), _jsx("span", { className: "text-xs text-[var(--muted-strong)]", children: row.mode }), _jsx("span", { className: "text-xs text-[var(--muted-strong)]", children: row.database }), _jsxs("span", { className: "flex flex-wrap gap-2 text-xs", children: [_jsx("button", { className: "text-[var(--brand)] disabled:opacity-50", disabled: activateProfile.isPending || row.active, onClick: () => activateProfile.mutate(row.name), children: row.active ? t("page.settings.active") : t("page.settings.activate") }), _jsx("button", { className: "text-[var(--brand)] disabled:opacity-50", disabled: exportProfile.isPending, onClick: () => exportProfile.mutate(row.name), children: t("page.settings.exportEnv") }), _jsx("button", { className: "text-[var(--brand)] disabled:opacity-50", disabled: exportBundle.isPending, onClick: () => exportBundle.mutate(row.name), children: t("page.settings.exportBundle") }), _jsx("button", { className: "text-rose-600 disabled:opacity-50", disabled: deleteProfile.isPending || ["local-dev", "saas-pg", "private-oceanbase"].includes(row.name), onClick: () => deleteProfile.mutate(row.name), children: t("common.delete") })] })] }, row.name)))] }), profileEnv ? _jsx("pre", { className: "max-h-56 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100", children: profileEnv.shell }) : null, profileBundle ? (_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: t("page.settings.deployBundle") }), _jsx("p", { className: "mt-1 break-all text-xs text-[var(--muted)]", children: profileBundle.dir })] }), _jsx("a", { className: "rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]", href: api.opsProfileComposeUrl(profileBundle.profile), target: "_blank", rel: "noreferrer", children: t("page.settings.downloadCompose") })] }), _jsx("pre", { className: "mt-3 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100", children: profileBundle.compose })] })) : null, exportBundle.error ? _jsx(ErrorLine, { message: exportBundle.error.message }) : null, opsProfiles.data?.config_path ? _jsx("p", { className: "break-all text-xs text-[var(--muted)]", children: opsProfiles.data.config_path }) : null, opsProfiles.isError ? _jsx(ErrorLine, { message: opsProfiles.error.message }) : null] })] }) })) : null, activeModule === "sso" ? (_jsx(Card, { title: t("page.settings.ssoCard"), actions: _jsx(StatusPill, { tone: ssoConfig.data?.enabled ? "ok" : ssoConfig.isError ? "danger" : "warn", label: ssoConfig.data?.enabled ? "SSO" : "OFF" }), children: _jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(26rem,0.9fr)_minmax(0,1.1fr)]", children: [_jsxs("form", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4", onSubmit: (e) => {
                                                e.preventDefault();
                                                if (!ssoDraft.provider.trim())
                                                    return;
                                                saveSso.mutate();
                                            }, children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]", children: _jsx(KeyRound, { className: "h-6 w-6" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: t("page.settings.ssoProvider") }), _jsx("p", { className: "text-xs text-[var(--muted)]", children: t("page.settings.ssoDesc") })] })] }), _jsxs("div", { className: "mt-4 space-y-3", children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-2", children: [_jsx("input", { className: inputClass, value: ssoDraft.provider, onChange: (e) => setSsoDraft({ ...ssoDraft, provider: e.target.value }), placeholder: "okta" }), _jsxs("select", { className: inputClass, value: ssoDraft.type, onChange: (e) => setSsoDraft({ ...ssoDraft, type: e.target.value }), children: [_jsx("option", { value: "oidc", children: "OIDC" }), _jsx("option", { value: "saml", children: "SAML" })] })] }), _jsx("input", { className: inputClass, value: ssoDraft.issuer, onChange: (e) => setSsoDraft({ ...ssoDraft, issuer: e.target.value }), placeholder: ssoDraft.type === "saml" ? "SAML issuer / entityID" : "https://idp.example.com/oauth2/default" }), _jsx("input", { className: inputClass, value: ssoDraft.client_id, onChange: (e) => setSsoDraft({ ...ssoDraft, client_id: e.target.value }), placeholder: "client_id" }), _jsx("input", { className: inputClass, type: "password", value: ssoDraft.client_secret, onChange: (e) => setSsoDraft({ ...ssoDraft, client_secret: e.target.value }), placeholder: t("page.settings.ssoSecretPh") }), _jsx("input", { className: inputClass, value: ssoDraft.redirect_uri, onChange: (e) => setSsoDraft({ ...ssoDraft, redirect_uri: e.target.value }), placeholder: "http://localhost:8000/api/v1/sso/okta/callback" }), _jsx("input", { className: inputClass, value: ssoDraft.type === "saml" ? ssoDraft.metadata_url : ssoDraft.scope, onChange: (e) => setSsoDraft(ssoDraft.type === "saml" ? { ...ssoDraft, metadata_url: e.target.value } : { ...ssoDraft, scope: e.target.value }), placeholder: ssoDraft.type === "saml" ? "metadata_url" : "openid profile email groups" }), _jsxs("label", { className: "block text-xs font-medium text-[var(--muted)]", children: [t("page.settings.ssoTenantMap"), _jsx("textarea", { className: `${inputClass} mt-1 min-h-20 font-mono text-xs`, value: ssoDraft.tenant_domain_map, onChange: (e) => setSsoDraft({ ...ssoDraft, tenant_domain_map: e.target.value }), placeholder: t("page.settings.ssoTenantMapPh") })] }), _jsxs("label", { className: "block text-xs font-medium text-[var(--muted)]", children: [t("page.settings.ssoRoleMap"), _jsx("textarea", { className: `${inputClass} mt-1 min-h-24 font-mono text-xs`, value: ssoDraft.role_map, onChange: (e) => setSsoDraft({ ...ssoDraft, role_map: e.target.value }), placeholder: t("page.settings.ssoRoleMapPh") })] }), _jsxs("label", { className: "flex items-center gap-2 text-sm text-[var(--muted-strong)]", children: [_jsx("input", { type: "checkbox", checked: ssoDraft.enabled, onChange: (e) => setSsoDraft({ ...ssoDraft, enabled: e.target.checked }) }), t("page.settings.ssoEnabled")] }), _jsxs("div", { className: "grid gap-2 sm:grid-cols-2", children: [_jsx("button", { type: "submit", className: "rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50", disabled: saveSso.isPending || !ssoDraft.provider.trim(), children: t("page.settings.ssoSave") }), _jsx("button", { type: "button", className: "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50", disabled: testSso.isPending || !ssoDraft.provider.trim(), onClick: () => testSso.mutate(ssoDraft.provider), children: t("page.settings.ssoTest") })] }), saveSso.error ? _jsx(ErrorLine, { message: saveSso.error.message }) : null, testSso.error ? _jsx(ErrorLine, { message: testSso.error.message }) : null, ssoTestResult ? _jsx("pre", { className: "max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100", children: JSON.stringify(ssoTestResult, null, 2) }) : null] })] }), _jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "grid gap-3 md:grid-cols-2", children: (ssoConfig.data?.templates || []).map((tpl) => (_jsxs("button", { type: "button", className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]", onClick: () => setSsoDraft({
                                                            ...ssoDraft,
                                                            provider: tpl.id,
                                                            type: tpl.type,
                                                            issuer: tpl.issuer_hint || "",
                                                            redirect_uri: tpl.redirect_hint || "",
                                                            scope: tpl.scope || ssoDraft.scope,
                                                        }), children: [_jsx("span", { className: "text-sm font-semibold text-[var(--text)]", children: tpl.name }), _jsx("span", { className: "mt-1 block truncate text-xs text-[var(--muted)]", children: tpl.issuer_hint })] }, tpl.id))) }), _jsxs("div", { className: "grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]", children: [_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: t("page.settings.ssoPreview") }), _jsx("p", { className: "mt-1 text-xs text-[var(--muted)]", children: t("page.settings.ssoPreviewDesc") })] }), _jsx(StatusPill, { tone: ssoPreviewResult?.ok ? "ok" : "warn", label: ssoPreviewResult?.role || "JIT" })] }), _jsxs("div", { className: "mt-4 grid gap-3 md:grid-cols-2", children: [_jsx("input", { className: inputClass, value: ssoPreviewDraft.email, onChange: (e) => setSsoPreviewDraft({ ...ssoPreviewDraft, email: e.target.value }), placeholder: t("page.settings.ssoPreviewEmail") }), _jsx("input", { className: inputClass, value: ssoPreviewDraft.groups, onChange: (e) => setSsoPreviewDraft({ ...ssoPreviewDraft, groups: e.target.value }), placeholder: t("page.settings.ssoPreviewGroups") })] }), _jsx("button", { type: "button", className: "mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50", disabled: previewSsoRole.isPending || !ssoDraft.provider.trim(), onClick: () => previewSsoRole.mutate(), children: t("page.settings.ssoPreviewRun") }), previewSsoRole.error ? _jsx(ErrorLine, { message: previewSsoRole.error.message }) : null, ssoPreviewResult ? (_jsxs("div", { className: "mt-3 grid gap-3 sm:grid-cols-3", children: [_jsx(Info, { label: t("auth.tenant"), value: String(ssoPreviewResult.tenant || "-") }), _jsx(Info, { label: t("auth.role"), value: String(ssoPreviewResult.role || "-") }), _jsx(Info, { label: t("page.settings.ssoGroups"), value: (ssoPreviewResult.groups || []).join(",") || "-" })] })) : null] }), _jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: t("page.settings.ssoRoles") }), _jsx("div", { className: "mt-3 flex flex-wrap gap-2", children: (ssoConfig.data?.roles || []).map((role) => (_jsx("span", { className: "rounded-full bg-[var(--surface-muted)] px-2.5 py-1 font-mono text-[11px] text-[var(--muted-strong)]", children: role }, role))) }), _jsx("p", { className: "mt-3 text-xs leading-5 text-[var(--muted)]", children: t("page.settings.ssoJitDesc") })] })] }), _jsxs("div", { className: "overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]", children: [_jsxs("div", { className: "grid grid-cols-[1fr_5rem_7rem_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]", children: [_jsx("span", { children: t("page.settings.ssoProvider") }), _jsx("span", { children: t("page.settings.ssoType") }), _jsx("span", { children: t("page.settings.ssoSource") }), _jsx("span", { children: t("page.settings.status") })] }), (ssoConfig.data?.items || []).map((row) => (_jsxs("div", { className: "grid grid-cols-[1fr_5rem_7rem_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0", children: [_jsxs("button", { type: "button", className: "min-w-0 text-left", onClick: () => setSsoDraft({
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
                                                                    }), children: [_jsx("span", { className: "block truncate text-sm font-semibold text-[var(--text)]", children: row.name }), _jsx("span", { className: "block truncate text-xs text-[var(--muted)]", children: row.issuer || row.metadata_url })] }), _jsx("span", { className: "text-xs uppercase text-[var(--muted-strong)]", children: row.type }), _jsx("span", { className: "text-xs text-[var(--muted-strong)]", children: row.source }), _jsx("button", { type: "button", className: "text-left text-xs text-[var(--brand)] disabled:opacity-50", disabled: deleteSso.isPending || row.source === "env", onClick: () => deleteSso.mutate(row.name), children: row.source === "env" ? "env" : t("common.delete") })] }, row.name))), !ssoConfig.data?.items?.length ? _jsx("div", { className: "px-4 py-8 text-sm text-[var(--muted)]", children: t("page.settings.ssoEmpty") }) : null] }), ssoConfig.isError ? _jsx(ErrorLine, { message: ssoConfig.error.message }) : null, ssoConfig.data?.config_path ? _jsx("p", { className: "break-all text-xs text-[var(--muted)]", children: ssoConfig.data.config_path }) : null] })] }) })) : null, activeModule === "appearance" ? (_jsxs(Card, { title: t("page.settings.themeCard"), children: [_jsx("p", { className: "mb-3 text-sm leading-6 text-[var(--muted)]", children: t("theme.hint") }), _jsx("div", { className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-4", children: THEME_OPTIONS.map((theme) => (_jsxs("button", { type: "button", onClick: () => {
                                                setThemePreference(theme);
                                                setThemePref(theme);
                                            }, className: `rounded-xl border p-3 text-left transition ${themePref === theme
                                                ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]"
                                                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"}`, children: [_jsx("span", { className: "mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]", children: _jsx(Palette, { className: "h-4 w-4" }) }), _jsx("span", { className: "block text-sm font-semibold", children: t(`theme.${theme}`) })] }, theme))) })] })) : null, activeModule === "billing" ? (_jsxs(Card, { title: t("page.settings.billingCard"), actions: _jsx(StatusPill, { tone: billingAlerts.data?.total ? "warn" : billing.isError ? "danger" : "ok", label: billingAlerts.data?.total ? `${billingAlerts.data.total} ${t("page.settings.alerts")}` : String(billing.data?.subscription?.status || "...") }), children: [billingAlerts.data?.items?.length ? (_jsx("div", { className: "mb-4 grid gap-2 lg:grid-cols-3", children: billingAlerts.data.items.map((alert) => (_jsx(BillingAlert, { alert: alert }, alert.id || alert.message))) })) : null, _jsxs("div", { className: "mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(BillingMetric, { label: t("page.settings.invoiceCount"), value: String(billingSummary.data?.invoice_count ?? 0) }), _jsx(BillingMetric, { label: t("page.settings.invoiceTotal"), value: `$${formatMoney(billingSummary.data?.invoice_total_usd)}` }), _jsx(BillingMetric, { label: t("page.settings.paidTotal"), value: `$${formatMoney(billingSummary.data?.paid_total_usd)}` }), _jsx(BillingMetric, { label: t("page.settings.outstanding"), value: `$${formatMoney(billingSummary.data?.outstanding_usd)}` })] }), _jsxs("div", { className: "grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]", children: [_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]", children: _jsx(BadgeDollarSign, { className: "h-6 w-6" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: t("page.settings.subscription") }), _jsx("p", { className: "text-xs text-[var(--muted)]", children: t("page.settings.billingDesc") })] })] }), _jsxs("div", { className: "mt-4 space-y-3", children: [_jsxs("label", { className: "block text-xs font-medium text-[var(--muted)]", children: [t("page.settings.plan"), _jsxs("select", { className: "mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]", value: planDraft, onChange: (e) => setPlanDraft(e.target.value), children: [Object.entries(billing.data?.catalog || {}).map(([id, plan]) => (_jsx("option", { value: id, children: plan.name || id }, id))), !billing.data?.catalog ? _jsx("option", { value: "starter", children: "Starter" }) : null] })] }), _jsxs("label", { className: "block text-xs font-medium text-[var(--muted)]", children: [t("page.settings.billingEmail"), _jsx("input", { className: "mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]", value: billingEmail, onChange: (e) => setBillingEmail(e.target.value), placeholder: "billing@example.com" })] }), _jsx("button", { type: "button", className: "inline-flex w-full items-center justify-center rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50", disabled: updateBilling.isPending, onClick: () => updateBilling.mutate(), children: t("page.settings.applyPlan") }), updateBilling.error ? _jsx(ErrorLine, { message: updateBilling.error.message }) : null, billing.isError ? _jsx(ErrorLine, { message: billing.error.message }) : null] })] }), _jsxs("div", { className: "grid gap-3 md:grid-cols-2 xl:grid-cols-4", children: [Object.entries(billing.data?.usage_ratio || {}).map(([metric, row]) => (_jsx(UsageQuotaCard, { metric: metric, row: row }, metric))), !billing.data?.usage_ratio || Object.keys(billing.data.usage_ratio).length === 0 ? (_jsx("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]", children: t("page.settings.noQuota") })) : null] })] }), _jsxs("div", { className: "mt-5 grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]", children: [_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: t("page.settings.invoice") }), _jsx("p", { className: "mt-1 text-xs leading-5 text-[var(--muted)]", children: t("page.settings.invoiceDesc") }), _jsxs("div", { className: "mt-4 grid gap-3", children: [_jsx(Info, { label: t("page.settings.period"), value: String(invoice.data?.period || "-") }), _jsx(Info, { label: t("page.settings.totalDue"), value: `$${formatMoney(invoice.data?.total_due_usd)}` }), _jsx(Info, { label: t("page.settings.currency"), value: String(invoice.data?.currency || "USD") })] }), _jsx("button", { type: "button", className: "mt-4 inline-flex w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50", disabled: snapshotInvoice.isPending || !invoice.data, onClick: () => snapshotInvoice.mutate(), children: t("page.settings.snapshotInvoice") }), _jsx("a", { className: "mt-2 inline-flex w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]", href: api.billingInvoiceCsvUrl(String(invoice.data?.period || "")), target: "_blank", rel: "noreferrer", children: t("page.settings.exportInvoiceCsv") }), snapshotInvoice.data?.path ? (_jsx("p", { className: "mt-2 break-all text-[11px] text-[var(--muted)]", children: snapshotInvoice.data.path })) : null, invoice.isError ? _jsx(ErrorLine, { message: invoice.error.message }) : null, snapshotInvoice.error ? _jsx(ErrorLine, { message: snapshotInvoice.error.message }) : null] }), _jsxs("div", { className: "overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]", children: [_jsxs("div", { className: "grid grid-cols-[1fr_7rem_7rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]", children: [_jsx("span", { children: t("page.settings.lineItem") }), _jsx("span", { className: "text-right", children: t("page.settings.quantity") }), _jsx("span", { className: "text-right", children: t("page.settings.amount") })] }), (invoice.data?.lines || []).map((line, idx) => (_jsxs("div", { className: "grid grid-cols-[1fr_7rem_7rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-medium text-[var(--text)]", children: line.metric }), _jsx("p", { className: "truncate text-xs text-[var(--muted)]", children: line.description })] }), _jsx("p", { className: "text-right font-mono text-xs text-[var(--muted-strong)]", children: formatNumber(line.quantity) }), _jsxs("p", { className: "text-right font-mono text-xs text-[var(--text)]", children: ["$", formatMoney(line.amount_usd)] })] }, `${line.metric}-${idx}`))), !invoice.data?.lines?.length ? (_jsx("div", { className: "px-4 py-6 text-sm text-[var(--muted)]", children: t("page.settings.noInvoice") })) : null] })] }), _jsxs("div", { className: "mt-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]", children: [_jsxs("div", { className: "grid grid-cols-[1fr_7rem_7rem_9rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]", children: [_jsx("span", { children: t("page.settings.invoiceHistory") }), _jsx("span", { children: t("page.settings.period") }), _jsx("span", { className: "text-right", children: t("page.settings.totalDue") }), _jsx("span", { children: t("page.settings.status") })] }), (invoices.data?.items || []).map((row) => (_jsxs("div", { className: "grid grid-cols-[1fr_7rem_7rem_9rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate font-mono text-xs text-[var(--text)]", children: row.id }), _jsx("p", { className: "truncate text-[11px] text-[var(--muted)]", children: row.path })] }), _jsx("p", { className: "text-xs text-[var(--muted-strong)]", children: row.period }), _jsxs("p", { className: "text-right font-mono text-xs text-[var(--text)]", children: ["$", formatMoney(row.total_due_usd)] }), _jsx("select", { className: "rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--text)]", value: row.status || "draft", disabled: updateInvoiceStatus.isPending, onChange: (e) => updateInvoiceStatus.mutate({ id: row.id, status: e.target.value }), children: ["draft", "issued", "paid", "void"].map((s) => (_jsx("option", { value: s, children: t(`page.settings.invoiceStatus.${s}`) }, s))) })] }, row.id))), !invoices.data?.items?.length ? (_jsx("div", { className: "px-4 py-6 text-sm text-[var(--muted)]", children: t("page.settings.noInvoiceHistory") })) : null] }), _jsxs("div", { className: "mt-5 grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]", children: [_jsxs("form", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", onSubmit: (e) => {
                                                    e.preventDefault();
                                                    if (!paymentDraft.invoice_id || Number(paymentDraft.amount_usd) <= 0)
                                                        return;
                                                    recordPayment.mutate();
                                                }, children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: t("page.settings.recordPayment") }), _jsxs("div", { className: "mt-4 space-y-3", children: [_jsxs("select", { className: "w-full rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]", value: paymentDraft.invoice_id, onChange: (e) => {
                                                                    const id = e.target.value;
                                                                    const row = (invoices.data?.items || []).find((x) => x.id === id);
                                                                    setPaymentDraft({ ...paymentDraft, invoice_id: id, amount_usd: row ? String(row.total_due_usd || "") : paymentDraft.amount_usd });
                                                                }, children: [_jsx("option", { value: "", children: t("page.settings.pickInvoice") }), (invoices.data?.items || []).map((row) => (_jsxs("option", { value: row.id, children: [row.period, " \u00B7 ", row.id] }, row.id)))] }), _jsx("input", { className: "w-full rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]", value: paymentDraft.amount_usd, onChange: (e) => setPaymentDraft({ ...paymentDraft, amount_usd: e.target.value }), placeholder: t("page.settings.paymentAmount"), inputMode: "decimal" }), _jsx("input", { className: "w-full rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]", value: paymentDraft.external_ref, onChange: (e) => setPaymentDraft({ ...paymentDraft, external_ref: e.target.value }), placeholder: t("page.settings.paymentRef") }), _jsx("button", { type: "submit", className: "inline-flex w-full items-center justify-center rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50", disabled: recordPayment.isPending || !paymentDraft.invoice_id || Number(paymentDraft.amount_usd) <= 0, children: t("page.settings.savePayment") }), recordPayment.error ? _jsx(ErrorLine, { message: recordPayment.error.message }) : null] })] }), _jsxs("div", { className: "overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]", children: [_jsxs("div", { className: "grid grid-cols-[1fr_7rem_8rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]", children: [_jsx("span", { children: t("page.settings.paymentHistory") }), _jsx("span", { className: "text-right", children: t("page.settings.amount") }), _jsx("span", { children: t("page.settings.status") })] }), (payments.data?.items || []).map((row) => (_jsxs("div", { className: "grid grid-cols-[1fr_7rem_8rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate font-mono text-xs text-[var(--text)]", children: row.invoice_id }), _jsx("p", { className: "truncate text-[11px] text-[var(--muted)]", children: row.external_ref || row.id })] }), _jsxs("p", { className: "text-right font-mono text-xs text-[var(--text)]", children: ["$", formatMoney(row.amount_usd)] }), _jsx("p", { className: "text-xs text-[var(--muted-strong)]", children: row.method })] }, row.id))), !payments.data?.items?.length ? (_jsx("div", { className: "px-4 py-6 text-sm text-[var(--muted)]", children: t("page.settings.noPayments") })) : null] })] })] })) : null] })] })] }));
}
function Info({ label, value }) {
    return (_jsxs("div", { className: "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3", children: [_jsx("dt", { className: "text-[11px] text-[var(--muted)]", children: label }), _jsx("dd", { className: "mt-1 truncate font-mono text-xs text-[var(--muted-strong)]", children: value })] }));
}
function SettingLink({ href, title, body, icon, external = false }) {
    return (_jsxs("a", { href: href, className: "group flex min-h-32 flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-sm hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]", target: external ? "_blank" : undefined, rel: external ? "noreferrer" : undefined, children: [_jsx("span", { className: "flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]", children: icon }), _jsxs("span", { children: [_jsx("span", { className: "mt-3 block text-sm font-semibold text-[var(--text)]", children: title }), _jsx("span", { className: "mt-1 block text-xs leading-5 text-[var(--muted)]", children: body })] })] }));
}
function StatusPill({ tone, label }) {
    const cls = tone === "ok"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
        : tone === "danger"
            ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200"
            : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";
    return _jsx("span", { className: `rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`, children: label });
}
function ModuleDot({ tone }) {
    const cls = tone === "ok" ? "bg-emerald-500" : tone === "danger" ? "bg-rose-500" : "bg-amber-500";
    return _jsx("span", { className: `mt-1 h-2 w-2 shrink-0 rounded-full ${cls}` });
}
function ErrorLine({ message }) {
    return _jsx("div", { className: "mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200", children: message });
}
function HintLine({ message }) {
    return _jsx("div", { className: "mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200", children: message });
}
function BillingAlert({ alert }) {
    const severity = String(alert.severity || "info");
    const cls = severity === "critical"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200"
        : severity === "warning"
            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200"
            : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200";
    return (_jsxs("div", { className: `rounded-2xl border px-4 py-3 ${cls}`, children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsx("p", { className: "text-sm font-semibold", children: alert.message }), alert.percent !== undefined ? _jsxs("span", { className: "font-mono text-xs", children: [alert.percent, "%"] }) : null] }), alert.action ? _jsx("p", { className: "mt-1 text-xs opacity-80", children: alert.action }) : null] }));
}
function BillingMetric({ label, value }) {
    return (_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", children: [_jsx("p", { className: "text-xs text-[var(--muted)]", children: label }), _jsx("p", { className: "mt-2 text-xl font-semibold text-[var(--text)]", children: value })] }));
}
function MetricBox({ label, value }) {
    return (_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", children: [_jsx("p", { className: "text-xs text-[var(--muted)]", children: label }), _jsx("p", { className: "mt-2 text-2xl font-semibold text-[var(--text)]", children: formatNumber(value) })] }));
}
function logLevelClass(level) {
    const lv = String(level || "").toUpperCase();
    if (lv.startsWith("ERROR") || lv.startsWith("CRITICAL"))
        return "font-mono text-rose-300";
    if (lv.startsWith("WARN"))
        return "font-mono text-amber-300";
    if (lv.startsWith("DEBUG"))
        return "font-mono text-slate-500";
    return "font-mono text-emerald-300";
}
function formatBytes(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n))
        return "-";
    if (n >= 1024 * 1024)
        return `${(n / 1024 / 1024).toFixed(1)} MB`;
    if (n >= 1024)
        return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
}
function UsageQuotaCard({ metric, row }) {
    const percent = Number(row.percent ?? 0);
    const tone = percent >= 90 ? "bg-rose-500" : percent >= 70 ? "bg-amber-500" : "bg-emerald-500";
    return (_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx("p", { className: "truncate text-sm font-semibold text-[var(--text)]", children: metric }), _jsxs("span", { className: "rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted)]", children: [percent, "%"] })] }), _jsx("div", { className: "mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]", children: _jsx("div", { className: `h-full ${tone}`, style: { width: `${Math.max(0, Math.min(percent, 100))}%` } }) }), _jsxs("div", { className: "mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--muted)]", children: [_jsxs("span", { children: ["used ", formatNumber(row.used)] }), _jsxs("span", { className: "text-right", children: ["limit ", formatNumber(row.limit)] })] })] }));
}
function parseEnvLines(text) {
    const out = {};
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#") || !line.includes("="))
            continue;
        const [key, ...rest] = line.split("=");
        const k = key.trim();
        if (!k)
            continue;
        out[k] = rest.join("=").trim();
    }
    return out;
}
function parseBoolMap(text) {
    const out = {};
    for (const raw of text.split(",")) {
        const item = raw.trim();
        if (!item || !item.includes("="))
            continue;
        const [key, value] = item.split("=", 2);
        const k = key.trim();
        if (!k)
            continue;
        out[k] = ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
    }
    return out;
}
function parseTextMap(text) {
    const out = {};
    for (const raw of text.split(/[\r\n,]+/)) {
        const item = raw.trim();
        if (!item || !item.includes("="))
            continue;
        const [key, ...rest] = item.split("=");
        const k = key.trim();
        const v = rest.join("=").trim();
        if (k && v)
            out[k] = v;
    }
    return out;
}
function mapToLines(value) {
    if (!value || typeof value !== "object")
        return "";
    return Object.entries(value).map(([k, v]) => `${k}=${v}`).join("\n");
}
function splitTokens(text) {
    return text
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter(Boolean);
}
function profileToDraft(row) {
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
function formatNumber(v) {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n))
        return "-";
    if (Math.abs(n) >= 1_000_000_000)
        return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(n) >= 1_000_000)
        return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000)
        return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}
function formatMoney(v) {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n))
        return "0.00";
    return n.toFixed(2);
}
