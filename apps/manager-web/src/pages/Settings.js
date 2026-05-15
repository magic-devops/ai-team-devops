import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, ExternalLink, LogOut, Palette, ServerCog, ShieldCheck, SlidersHorizontal, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { api } from "../lib/api";
import { clearSession, getProjectId, getToken } from "../lib/authStorage";
import { getThemePreference, setThemePreference, THEME_OPTIONS } from "../lib/theme";
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
    useEffect(() => {
        const sync = () => setThemePref(getThemePreference());
        window.addEventListener("sop-theme", sync);
        return () => window.removeEventListener("sop-theme", sync);
    }, []);
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
    if (!token)
        return null;
    const tenantLabel = me.data?.tenant_name || me.data?.tenant_slug || me.data?.tenant_id || "-";
    const healthOk = health.data?.ok === true;
    return (_jsxs("div", { className: "w-full space-y-5", children: [_jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]", children: [_jsxs(Card, { title: t("page.settings.accountCard"), actions: _jsx(StatusPill, { tone: me.isError ? "danger" : "ok", label: me.isError ? t("page.settings.sessionError") : t("auth.secure") }), children: [_jsxs("div", { className: "grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]", children: [_jsxs("div", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]", children: _jsx(ShieldCheck, { className: "h-7 w-7" }) }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-lg font-semibold text-[var(--text)]", children: me.data?.username || t("auth.account") }), _jsx("p", { className: "truncate text-xs text-[var(--muted)]", children: me.data?.email || me.data?.role || t("auth.loggedIn") })] })] }), _jsxs("button", { type: "button", className: "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] shadow-sm hover:bg-[var(--surface-muted)] disabled:opacity-50", disabled: logout.isPending, onClick: () => logout.mutate(), children: [_jsx(LogOut, { className: "h-4 w-4 text-[var(--brand)]" }), t("auth.logout")] })] }), _jsxs("div", { className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-4", children: [_jsx(Info, { label: t("auth.status"), value: t("auth.loggedIn") }), _jsx(Info, { label: t("auth.role"), value: me.data?.role || "-" }), _jsx(Info, { label: t("auth.tenant"), value: tenantLabel }), _jsx(Info, { label: t("auth.project"), value: projectId || "-" })] })] }), me.isError ? _jsx(ErrorLine, { message: me.error.message }) : null, !projectId ? _jsx(HintLine, { message: t("auth.noProject") }) : null] }), _jsxs(Card, { title: t("page.settings.runtimeCard"), actions: _jsx(StatusPill, { tone: healthOk ? "ok" : health.isError ? "danger" : "warn", label: healthOk ? "OK" : health.isError ? "ERR" : "..." }), children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-3", children: [_jsx(Info, { label: t("page.settings.manager"), value: healthOk ? "online" : health.isError ? "error" : t("common.loading") }), _jsx(Info, { label: t("page.settings.version"), value: String(health.data?.version ?? "-") }), _jsx(Info, { label: t("page.settings.apiBase"), value: window.location.origin })] }), health.isError ? _jsx(ErrorLine, { message: health.error.message }) : null, _jsxs("div", { className: "mt-4 grid gap-3 sm:grid-cols-2", children: [_jsx(SettingLink, { href: "/api/v1/health", icon: _jsx(ServerCog, { className: "h-5 w-5" }), title: t("page.settings.healthTitle"), body: t("page.settings.healthDesc"), external: true }), _jsx(SettingLink, { href: "/metrics", icon: _jsx(SlidersHorizontal, { className: "h-5 w-5" }), title: t("page.settings.metricsTitle"), body: t("page.settings.metricsDesc"), external: true })] })] })] }), _jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]", children: [_jsx(Card, { title: t("page.settings.workspaceCard"), children: _jsxs("div", { className: "grid gap-3 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(SettingLink, { href: "#/organization", icon: _jsx(UsersRound, { className: "h-5 w-5" }), title: t("page.settings.orgTitle"), body: t("page.settings.orgDesc") }), _jsx(SettingLink, { href: "#/intelligence", icon: _jsx(Database, { className: "h-5 w-5" }), title: t("page.settings.dbTitle"), body: t("page.settings.dbDesc") }), _jsx(SettingLink, { href: "/console.html", icon: _jsx(ExternalLink, { className: "h-5 w-5" }), title: t("page.settings.consoleTitle"), body: t("page.settings.consoleDesc"), external: true }), _jsx(SettingLink, { href: "/login.html", icon: _jsx(ShieldCheck, { className: "h-5 w-5" }), title: t("page.settings.loginTitle"), body: t("page.settings.loginDesc"), external: true })] }) }), _jsxs(Card, { title: t("page.settings.themeCard"), children: [_jsx("p", { className: "mb-3 text-sm leading-6 text-[var(--muted)]", children: t("theme.hint") }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: THEME_OPTIONS.map((theme) => (_jsxs("button", { type: "button", onClick: () => {
                                        setThemePreference(theme);
                                        setThemePref(theme);
                                    }, className: `rounded-xl border p-3 text-left transition ${themePref === theme
                                        ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]"
                                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"}`, children: [_jsx("span", { className: "mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]", children: _jsx(Palette, { className: "h-4 w-4" }) }), _jsx("span", { className: "block text-sm font-semibold", children: t(`theme.${theme}`) })] }, theme))) })] })] })] }));
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
function ErrorLine({ message }) {
    return _jsx("div", { className: "mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200", children: message });
}
function HintLine({ message }) {
    return _jsx("div", { className: "mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200", children: message });
}
