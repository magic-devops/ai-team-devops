import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { api } from "../lib/api";
import { clearSession, getProjectId, getToken, setSession } from "../lib/authStorage";
import { getThemePreference, setThemePreference } from "../lib/theme";
export function Settings() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [themePref, setThemePref] = useState(() => getThemePreference());
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [tenantSlug, setTenantSlug] = useState("");
    const token = getToken();
    const projectId = getProjectId();
    useEffect(() => {
        const sync = () => setThemePref(getThemePreference());
        window.addEventListener("sop-theme", sync);
        return () => window.removeEventListener("sop-theme", sync);
    }, []);
    const login = useMutation({
        mutationFn: () => api.login({
            username: username.trim(),
            password,
            ...(tenantSlug.trim() ? { tenant_slug: tenantSlug.trim() } : {}),
        }),
        onSuccess: (data) => {
            setSession(data.token, data.default_project_id || undefined);
            setPassword("");
            void qc.invalidateQueries();
        },
    });
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs(Card, { title: t("auth.title"), children: [_jsx("p", { className: "mb-3 text-sm text-zinc-600 dark:text-zinc-400", children: t("auth.hint") }), _jsx("p", { className: "mb-3 text-xs text-zinc-500 dark:text-zinc-400", children: _jsx("a", { href: "/console.html", className: "font-medium text-brand-700 underline dark:text-brand-400", children: t("auth.consoleLink") }) }), token ? (_jsxs("div", { className: "space-y-2 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "text-zinc-500", children: t("auth.status") }), " ", _jsx("span", { className: "font-medium text-emerald-600", children: t("auth.loggedIn") })] }), projectId ? (_jsxs("div", { className: "font-mono text-xs text-zinc-600 dark:text-zinc-400", children: ["X-Project-Id: ", projectId] })) : (_jsx("div", { className: "text-xs text-amber-700 dark:text-amber-400", children: t("auth.noProject") })), _jsx("button", { type: "button", className: "rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800", onClick: () => {
                                    clearSession();
                                    void qc.invalidateQueries();
                                }, children: t("auth.logout") })] })) : (_jsxs("form", { className: "max-w-md space-y-2", onSubmit: (e) => {
                            e.preventDefault();
                            login.mutate();
                        }, children: [_jsxs("label", { className: "block text-sm", children: [_jsx("span", { className: "text-zinc-600 dark:text-zinc-400", children: t("auth.username") }), _jsx("input", { className: "mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900", value: username, onChange: (e) => setUsername(e.target.value), autoComplete: "username" })] }), _jsxs("label", { className: "block text-sm", children: [_jsx("span", { className: "text-zinc-600 dark:text-zinc-400", children: t("auth.password") }), _jsx("input", { type: "password", className: "mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900", value: password, onChange: (e) => setPassword(e.target.value), autoComplete: "current-password" })] }), _jsxs("label", { className: "block text-sm", children: [_jsx("span", { className: "text-zinc-600 dark:text-zinc-400", children: t("auth.tenantSlug") }), _jsx("input", { className: "mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900", value: tenantSlug, onChange: (e) => setTenantSlug(e.target.value), placeholder: t("auth.tenantPlaceholder") })] }), _jsx("button", { type: "submit", disabled: !username.trim() || !password || login.isPending, className: "rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-50", children: t("auth.login") }), login.error ? (_jsx("div", { className: "text-sm text-red-600", children: login.error.message })) : null] }))] }), _jsxs(Card, { title: t("page.settings.themeCard"), children: [_jsx("p", { className: "mb-2 text-xs text-slate-500 dark:text-slate-400", children: t("theme.hint") }), _jsxs("label", { className: "block max-w-xs text-sm text-slate-700 dark:text-slate-300", children: [_jsx("span", { className: "mb-1 block font-medium", children: t("theme.label") }), _jsxs("select", { value: themePref, onChange: (e) => {
                                    const v = e.target.value;
                                    setThemePreference(v);
                                    setThemePref(v);
                                }, className: "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100", children: [_jsx("option", { value: "light", children: t("theme.light") }), _jsx("option", { value: "dark", children: t("theme.dark") }), _jsx("option", { value: "system", children: t("theme.system") })] })] })] })] }));
}
