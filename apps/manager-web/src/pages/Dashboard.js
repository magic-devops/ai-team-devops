import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, FolderKanban, ListTodo, Shield } from "lucide-react";
import { Card } from "../components/Card";
import { api } from "../lib/api";
import { getToken } from "../lib/authStorage";
function Err({ message }) {
    return (_jsx("div", { className: "rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200", children: message }));
}
function StatCard({ title, icon: Icon, accent, children, }) {
    const border = accent === "sky"
        ? "border-l-sky-500"
        : accent === "violet"
            ? "border-l-violet-500"
            : accent === "emerald"
                ? "border-l-emerald-500"
                : "border-l-amber-500";
    return (_jsx(Card, { className: `border-l-4 ${border} bg-gradient-to-br from-white to-slate-50/90 pl-4 dark:from-slate-900/80 dark:to-slate-900/40`, children: _jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400", children: title }), _jsx("div", { className: "mt-2", children: children })] }), _jsx("div", { className: "rounded-lg bg-slate-100 p-2 text-slate-500 dark:bg-slate-800/90 dark:text-slate-400", "aria-hidden": true, children: _jsx(Icon, { className: "h-5 w-5", strokeWidth: 1.75 }) })] }) }));
}
export function Dashboard() {
    const { t } = useTranslation();
    const [, bump] = useState(0);
    const hasToken = Boolean(getToken());
    useEffect(() => {
        const onSession = () => bump((x) => x + 1);
        window.addEventListener("sop-session", onSession);
        return () => window.removeEventListener("sop-session", onSession);
    }, []);
    const health = useQuery({ queryKey: ["health"], queryFn: api.health });
    const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
    const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks() });
    const audit = useQuery({ queryKey: ["audit"], queryFn: api.auditState });
    return (_jsxs("div", { className: "mx-auto max-w-7xl space-y-6", children: [_jsxs("div", { className: "flex flex-col gap-3", children: [!hasToken ? (_jsxs("div", { role: "status", className: "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-50/95", children: [_jsx("span", { children: t("auth.dashboardNeedLogin") }), _jsx("a", { href: "#/settings", className: "inline-flex items-center rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400", children: t("auth.openSettings") })] })) : null, _jsxs("div", { className: "rounded-xl border border-slate-200/80 bg-white/90 px-4 py-3 text-sm text-slate-800 shadow-sm dark:border-slate-600/80 dark:bg-slate-900/60 dark:text-slate-200", children: [_jsxs("p", { className: "font-medium leading-relaxed", children: [_jsx("span", { className: "text-slate-900 dark:text-slate-100", children: t("dashboard.fullConsoleTitle") }), " ", _jsx("span", { className: "text-slate-600 dark:text-slate-400", children: t("dashboard.fullConsoleBody") })] }), _jsx("p", { className: "mt-2 flex flex-wrap gap-2", children: _jsx("a", { href: "/console.html?from=management-platform", className: "inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-500 dark:bg-brand-500 dark:hover:bg-brand-400", children: t("dashboard.openConsoleCta") }) })] })] }), _jsxs("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", children: [_jsx(StatCard, { title: t("nav.projects"), icon: FolderKanban, accent: "sky", children: projects.isPending ? (_jsx("div", { className: "h-9 w-16 animate-pulse rounded-md bg-zinc-200/90 dark:bg-zinc-700" })) : projects.isError ? (_jsx(Err, { message: projects.error.message })) : (_jsx("div", { className: "text-3xl font-bold tabular-nums tracking-tight text-brand-700 dark:text-brand-400", children: projects.data?.length ?? "—" })) }), _jsx(StatCard, { title: t("nav.tasks"), icon: ListTodo, accent: "violet", children: tasks.isPending ? (_jsx("div", { className: "h-9 w-16 animate-pulse rounded-md bg-zinc-200/90 dark:bg-zinc-700" })) : tasks.isError ? (_jsx(Err, { message: tasks.error.message })) : (_jsx("div", { className: "text-3xl font-bold tabular-nums tracking-tight text-brand-700 dark:text-brand-400", children: tasks.data?.length ?? "—" })) }), _jsx(StatCard, { title: "Manager", icon: Activity, accent: "emerald", children: health.isPending ? (_jsx("div", { className: "h-9 w-24 animate-pulse rounded-md bg-zinc-200/90 dark:bg-zinc-700" })) : health.isError ? (_jsx(Err, { message: health.error.message })) : (_jsx("div", { className: "font-mono text-sm font-medium text-zinc-800 dark:text-zinc-200", children: health.data?.ok === true ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "text-emerald-600 dark:text-emerald-400", children: "ok" }), _jsx("span", { className: "text-zinc-400", children: " \u00B7 " }), _jsx("span", { children: String(health.data?.version ?? "—") })] })) : ("—") })) }), _jsx(StatCard, { title: t("nav.audit"), icon: Shield, accent: "amber", children: _jsxs("div", { className: "space-y-1 text-sm text-zinc-700 dark:text-zinc-300", children: [audit.isPending ? _jsx("div", { className: "text-zinc-500", children: t("common.loading") }) : null, audit.isError ? _jsx(Err, { message: audit.error.message }) : null, audit.data ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100", children: audit.data.count }), _jsx("p", { className: "text-[11px] leading-snug text-zinc-500 dark:text-zinc-400", children: t("dashboard.auditPrevHashCaption") }), /^0{64}$/.test(String(audit.data.prev_hash ?? "")) ? (_jsx("p", { className: "font-mono text-[11px] leading-snug text-zinc-500 dark:text-zinc-400", children: t("dashboard.auditGenesisNote") })) : (_jsxs("div", { className: "truncate font-mono text-[11px] leading-tight text-zinc-600 dark:text-zinc-400", children: [String(audit.data.prev_hash ?? "").slice(0, 24), "\u2026"] }))] })) : !audit.isPending && !audit.isError ? (_jsx("span", { className: "text-zinc-400", children: "\u2014" })) : null] }) })] }), hasToken ? (_jsx(Card, { title: t("dashboard.quickLinks"), children: _jsx("div", { className: "grid gap-2 sm:grid-cols-2 lg:grid-cols-4", children: [
                        { href: "#/tasks", label: t("nav.tasks"), desc: t("dashboard.linkTasks") },
                        { href: "#/requirements", label: t("nav.requirements"), desc: t("dashboard.linkReqs") },
                        { href: "#/platforms", label: t("nav.platforms"), desc: t("dashboard.linkPlatforms") },
                        { href: "#/intelligence", label: t("nav.intelligence"), desc: t("dashboard.linkIntel") },
                        { href: "#/analytics", label: t("nav.analytics"), desc: t("dashboard.linkAnalytics") },
                        { href: "#/copilot", label: t("nav.copilot"), desc: t("dashboard.linkCopilot") },
                        { href: "#/workflows", label: t("nav.workflows"), desc: t("dashboard.linkWorkflows") },
                        { href: "#/settings", label: t("nav.settings"), desc: t("dashboard.linkSettings") },
                    ].map((link) => (_jsxs("a", { href: link.href, className: "rounded-lg border border-slate-200/90 bg-white px-3 py-2.5 text-sm shadow-sm transition hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:border-brand-500/40 dark:hover:bg-brand-950/20", children: [_jsx("p", { className: "font-semibold text-slate-900 dark:text-slate-100", children: link.label }), _jsx("p", { className: "mt-0.5 text-xs text-slate-500 dark:text-slate-400", children: link.desc })] }, link.href))) }) })) : null] }));
}
