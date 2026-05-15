import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * @ai_safe_edit
 *   - 新增页面：在 src/pages/ 加文件 + 在 NAV 数组加项
 *   - 改主题：tailwind.config.js brand + src/lib/theme.ts
 *   - 路由：当前用最小化 hash 路由；如需 nested route 切换到 @tanstack/react-router
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dashboard } from "./pages/Dashboard";
import { Projects } from "./pages/Projects";
import { Tasks } from "./pages/Tasks";
import { Workflows } from "./pages/Workflows";
import { Marketplace } from "./pages/Marketplace";
import { Audit } from "./pages/Audit";
import { Copilot } from "./pages/Copilot";
import { Settings } from "./pages/Settings";
import { getToken } from "./lib/authStorage";
import { getThemePreference, isDarkResolved, setThemePreference, } from "./lib/theme";
const NAV = [
    { key: "dashboard", path: "#/dashboard", el: _jsx(Dashboard, {}) },
    { key: "projects", path: "#/projects", el: _jsx(Projects, {}) },
    { key: "tasks", path: "#/tasks", el: _jsx(Tasks, {}) },
    { key: "workflows", path: "#/workflows", el: _jsx(Workflows, {}) },
    { key: "marketplace", path: "#/marketplace", el: _jsx(Marketplace, {}) },
    { key: "audit", path: "#/audit", el: _jsx(Audit, {}) },
    { key: "copilot", path: "#/copilot", el: _jsx(Copilot, {}) },
    { key: "settings", path: "#/settings", el: _jsx(Settings, {}) },
];
function ThemeMenu() {
    const { t } = useTranslation();
    const [pref, setPref] = useState(() => getThemePreference());
    useEffect(() => {
        const sync = () => setPref(getThemePreference());
        window.addEventListener("sop-theme", sync);
        return () => window.removeEventListener("sop-theme", sync);
    }, []);
    const dark = isDarkResolved(pref);
    const Icon = pref === "system" ? Laptop : dark ? Moon : Sun;
    const choose = (next) => {
        setThemePreference(next);
        setPref(next);
    };
    const itemClass = "flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 data-[state=open]:bg-slate-50 dark:data-[highlighted]:bg-slate-800 dark:data-[state=open]:bg-slate-800";
    return (_jsxs(DropdownMenu.Root, { children: [_jsx(DropdownMenu.Trigger, { asChild: true, children: _jsx("button", { type: "button", className: "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-800", title: t("theme.label"), "aria-label": t("theme.label"), children: _jsx(Icon, { className: "h-4 w-4", strokeWidth: 1.75 }) }) }), _jsx(DropdownMenu.Portal, { children: _jsxs(DropdownMenu.Content, { className: "z-50 min-w-[10.5rem] rounded-xl border border-slate-200/90 bg-white p-1 shadow-lg dark:border-slate-600 dark:bg-slate-900", sideOffset: 6, align: "end", children: [_jsxs(DropdownMenu.Item, { className: itemClass, onSelect: () => choose("light"), children: [_jsx(Sun, { className: "h-4 w-4 shrink-0 text-amber-500", strokeWidth: 1.75 }), _jsx("span", { className: "flex-1", children: t("theme.light") }), pref === "light" ? _jsx(Check, { className: "h-4 w-4 shrink-0 text-brand-600" }) : null] }), _jsxs(DropdownMenu.Item, { className: itemClass, onSelect: () => choose("dark"), children: [_jsx(Moon, { className: "h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400", strokeWidth: 1.75 }), _jsx("span", { className: "flex-1", children: t("theme.dark") }), pref === "dark" ? _jsx(Check, { className: "h-4 w-4 shrink-0 text-brand-600" }) : null] }), _jsxs(DropdownMenu.Item, { className: itemClass, onSelect: () => choose("system"), children: [_jsx(Laptop, { className: "h-4 w-4 shrink-0 text-slate-500", strokeWidth: 1.75 }), _jsx("span", { className: "flex-1", children: t("theme.system") }), pref === "system" ? _jsx(Check, { className: "h-4 w-4 shrink-0 text-brand-600" }) : null] })] }) })] }));
}
export function App() {
    const { t, i18n } = useTranslation();
    const [hash, setHash] = useState(window.location.hash || "#/dashboard");
    const [, bump] = useState(0);
    const authed = Boolean(getToken());
    useEffect(() => {
        const h = () => setHash(window.location.hash || "#/dashboard");
        window.addEventListener("hashchange", h);
        return () => window.removeEventListener("hashchange", h);
    }, []);
    useEffect(() => {
        const onStorage = (e) => {
            if (e.key === "sop-token" || e.key === "sop-current-project-id")
                bump((x) => x + 1);
        };
        const onSession = () => bump((x) => x + 1);
        window.addEventListener("storage", onStorage);
        window.addEventListener("sop-session", onSession);
        return () => {
            window.removeEventListener("storage", onStorage);
            window.removeEventListener("sop-session", onSession);
        };
    }, []);
    const current = NAV.find((n) => hash.startsWith(n.path)) ?? NAV[0];
    return (_jsxs("div", { className: "flex min-h-screen bg-slate-100/90 dark:bg-slate-950", children: [_jsxs("aside", { className: "flex w-56 shrink-0 flex-col border-r border-slate-200/90 bg-gradient-to-b from-white via-slate-50/80 to-slate-100/60 dark:border-slate-700/80 dark:from-slate-900 dark:via-slate-900/95 dark:to-slate-950", children: [_jsx("div", { className: "border-b border-slate-200/80 px-5 py-4 text-lg font-bold tracking-tight text-brand-700 dark:border-slate-700/80 dark:text-brand-300", children: "SOP Manager" }), _jsx("div", { className: "px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400", children: t("nav.shellNavSection") }), _jsx("nav", { className: "px-2", children: NAV.map((n) => (_jsx("a", { href: n.path, className: `block rounded-lg px-3 py-2 text-sm transition ${current.key === n.key
                                ? "bg-brand-500/12 font-semibold text-brand-800 shadow-sm ring-1 ring-brand-500/15 dark:bg-brand-500/12 dark:text-brand-100 dark:ring-brand-400/20"
                                : "text-slate-600 hover:bg-slate-100/90 dark:text-slate-300 dark:hover:bg-slate-800/70"}`, children: t(`nav.${n.key}`) }, n.key))) }), _jsxs("div", { className: "mx-2 mt-auto border-t border-slate-200 px-2 pb-4 pt-3 text-[11px] leading-snug text-slate-500 dark:border-slate-700/80 dark:text-slate-400", children: [_jsx("p", { className: "px-1", children: t("nav.dockHint") }), _jsx("a", { href: "/?shell=1#/dashboard", className: "mt-2 block rounded-lg px-2 py-1.5 text-center font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800/80", children: t("nav.setShellHome") })] })] }), _jsxs("main", { className: "flex-1 px-5 py-6 sm:px-8", children: [_jsxs("header", { className: "mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4 dark:border-slate-700/80", children: [_jsx("h1", { className: "text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50", children: t(`page.${current.key}.title`) }), _jsxs("div", { className: "flex items-center gap-3", children: [!authed ? (_jsx("a", { href: "#/settings", className: "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm ring-1 ring-brand-600/30 hover:bg-brand-500 dark:ring-brand-400/25", children: t("auth.login") })) : null, _jsx(ThemeMenu, {}), _jsxs("select", { className: "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100", value: i18n.language, onChange: (e) => i18n.changeLanguage(e.target.value), "aria-label": "language", children: [_jsx("option", { value: "zh-CN", children: "\u4E2D\u6587" }), _jsx("option", { value: "en-US", children: "English" }), _jsx("option", { value: "ja-JP", children: "\u65E5\u672C\u8A9E" })] })] })] }), current.el] })] }));
}
