import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * @ai_safe_edit
 *   - 新增页面：在 src/pages/ 加文件 + 在 NAV 数组加项
 *   - 改主题：tailwind.config.js brand + src/lib/theme.ts
 *   - 路由：当前用最小化 hash 路由；如需 nested route 切换到 @tanstack/react-router
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, BellRing, Blocks, Bot, Brain, Building2, Check, ChevronDown, ChevronRight, ClipboardList, Cpu, FolderKanban, GitBranch, Laptop, LayoutDashboard, Library, Moon, PanelLeftClose, PanelLeftOpen, Palette, Search, Settings as SettingsIcon, ShieldCheck, Sun, LogOut, UserCircle, X, } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProjectSelector } from "./components/ProjectSelector";
import { api } from "./lib/api";
import { clearSession, getProjectId, getToken } from "./lib/authStorage";
import { getThemePreference, isDarkResolved, setThemePreference, THEME_OPTIONS, } from "./lib/theme";
import { Analytics } from "./pages/Analytics";
import { Audit } from "./pages/Audit";
import { Copilot } from "./pages/Copilot";
import { Dashboard } from "./pages/Dashboard";
import { Intelligence } from "./pages/Intelligence";
import { Marketplace } from "./pages/Marketplace";
import { Notify } from "./pages/Notify";
import { Organization } from "./pages/Organization";
import { Platforms } from "./pages/Platforms";
import { Projects } from "./pages/Projects";
import { Requirements } from "./pages/Requirements";
import { Settings } from "./pages/Settings";
import { Tasks } from "./pages/Tasks";
import { Workflows } from "./pages/Workflows";
const NAV = [
    { key: "dashboard", path: "#/dashboard", el: _jsx(Dashboard, {}), group: "delivery", icon: LayoutDashboard },
    { key: "projects", path: "#/projects", el: _jsx(Projects, {}), group: "delivery", icon: FolderKanban },
    { key: "tasks", path: "#/tasks", el: _jsx(Tasks, {}), group: "delivery", icon: ClipboardList },
    { key: "requirements", path: "#/requirements", el: _jsx(Requirements, {}), group: "delivery", icon: Library },
    { key: "workflows", path: "#/workflows", el: _jsx(Workflows, {}), group: "delivery", icon: GitBranch },
    { key: "organization", path: "#/organization", el: _jsx(Organization, {}), group: "management", icon: Building2 },
    { key: "analytics", path: "#/analytics", el: _jsx(Analytics, {}), group: "management", icon: BarChart3 },
    { key: "notify", path: "#/notify", el: _jsx(Notify, {}), group: "management", icon: BellRing },
    { key: "audit", path: "#/audit", el: _jsx(Audit, {}), group: "management", icon: ShieldCheck },
    { key: "copilot", path: "#/copilot", el: _jsx(Copilot, {}), group: "ai", icon: Bot },
    { key: "intelligence", path: "#/intelligence", el: _jsx(Intelligence, {}), group: "ai", icon: Brain },
    { key: "marketplace", path: "#/marketplace", el: _jsx(Marketplace, {}), group: "ai", icon: Blocks },
    { key: "platforms", path: "#/platforms", el: _jsx(Platforms, {}), group: "ai", icon: Cpu },
    { key: "settings", path: "#/settings", el: _jsx(Settings, {}), group: "system", icon: SettingsIcon },
];
const GROUP_ORDER = ["delivery", "management", "ai", "system"];
const COLLAPSE_STORAGE_KEY = "sop-nav-collapse-v1";
const SIDEBAR_STORAGE_KEY = "sop-sidebar-collapsed-v1";
const DEFAULT_COLLAPSE = {
    delivery: false,
    management: false,
    ai: false,
    system: false,
};
function ThemeMenu() {
    const { t } = useTranslation();
    const [pref, setPref] = useState(() => getThemePreference());
    useEffect(() => {
        const sync = () => setPref(getThemePreference());
        window.addEventListener("sop-theme", sync);
        return () => window.removeEventListener("sop-theme", sync);
    }, []);
    const dark = isDarkResolved(pref);
    const Icon = pref === "system" ? Laptop : dark ? Moon : Palette;
    const choose = (next) => {
        setThemePreference(next);
        setPref(next);
    };
    const itemClass = "flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text)] outline-none data-[highlighted]:bg-[var(--surface-muted)] data-[state=open]:bg-[var(--surface-muted)]";
    return (_jsxs(DropdownMenu.Root, { children: [_jsx(DropdownMenu.Trigger, { asChild: true, children: _jsx("button", { type: "button", className: "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] shadow-sm hover:bg-[var(--surface-muted)]", title: t("theme.label"), "aria-label": t("theme.label"), children: _jsx(Icon, { className: "h-4 w-4", strokeWidth: 1.75 }) }) }), _jsx(DropdownMenu.Portal, { children: _jsx(DropdownMenu.Content, { className: "z-50 min-w-[12rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg", sideOffset: 6, align: "end", children: THEME_OPTIONS.map((theme) => {
                        const ItemIcon = theme === "system" ? Laptop : theme === "dark" || theme === "graphite" ? Moon : theme === "light" ? Sun : Palette;
                        return (_jsxs(DropdownMenu.Item, { className: itemClass, onSelect: () => choose(theme), children: [_jsx(ItemIcon, { className: "h-4 w-4 shrink-0 text-[var(--brand)]", strokeWidth: 1.75 }), _jsx("span", { className: "flex-1", children: t(`theme.${theme}`) }), pref === theme ? _jsx(Check, { className: "h-4 w-4 shrink-0 text-[var(--brand)]" }) : null] }, theme));
                    }) }) })] }));
}
function UserMenu({ authed }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const me = useQuery({ queryKey: ["authMe"], queryFn: api.authMe, enabled: authed, retry: false });
    const loginHref = `/login.html?redirect=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`;
    if (!authed) {
        return (_jsxs("a", { href: loginHref, className: "inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--brand)] px-3 text-sm font-semibold text-white shadow-sm ring-1 ring-[var(--brand)] hover:opacity-90", children: [_jsx(UserCircle, { className: "h-4 w-4" }), t("auth.login")] }));
    }
    const username = me.data?.username || t("auth.account");
    const role = me.data?.role || "-";
    const tenant = me.data?.tenant_name || me.data?.tenant_slug || me.data?.tenant_id || "-";
    const projectId = getProjectId() || "-";
    return (_jsxs(DropdownMenu.Root, { children: [_jsx(DropdownMenu.Trigger, { asChild: true, children: _jsxs("button", { type: "button", className: "inline-flex h-9 max-w-[15rem] items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--control-bg)] px-2.5 text-sm text-[var(--text)] shadow-sm hover:bg-[var(--surface-muted)]", "aria-label": t("auth.account"), title: username, children: [_jsx("span", { className: "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]", children: _jsx(UserCircle, { className: "h-4 w-4" }) }), _jsx("span", { className: "min-w-0 truncate font-medium", children: username })] }) }), _jsx(DropdownMenu.Portal, { children: _jsxs(DropdownMenu.Content, { className: "z-50 w-72 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text)] shadow-xl", sideOffset: 8, align: "end", children: [_jsxs("div", { className: "rounded-xl bg-[var(--surface-muted)] p-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]", children: _jsx(UserCircle, { className: "h-6 w-6" }) }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold", children: username }), _jsx("p", { className: "truncate text-xs text-[var(--muted)]", children: me.data?.email || role })] })] }), _jsxs("dl", { className: "mt-3 grid gap-1 text-[11px] text-[var(--muted-strong)]", children: [_jsxs("div", { className: "flex justify-between gap-3", children: [_jsx("dt", { children: t("auth.role") }), _jsx("dd", { className: "font-mono", children: role })] }), _jsxs("div", { className: "flex justify-between gap-3", children: [_jsx("dt", { children: t("auth.tenant") }), _jsx("dd", { className: "truncate font-mono", children: tenant })] }), _jsxs("div", { className: "flex justify-between gap-3", children: [_jsx("dt", { children: t("auth.project") }), _jsx("dd", { className: "truncate font-mono", children: projectId })] })] })] }), me.isError ? (_jsx("div", { className: "mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-200", children: me.error.message })) : null, _jsxs(DropdownMenu.Item, { className: "mt-2 flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none hover:bg-[var(--surface-muted)] data-[highlighted]:bg-[var(--surface-muted)]", onSelect: () => {
                                void api.logout().catch(() => undefined);
                                clearSession();
                                void qc.invalidateQueries();
                                window.location.assign("/login.html");
                            }, children: [_jsx(LogOut, { className: "h-4 w-4 text-[var(--brand)]" }), t("auth.logout")] })] }) })] }));
}
export function App() {
    const { t, i18n } = useTranslation();
    const [hash, setHash] = useState(window.location.hash || "#/dashboard");
    const [, bump] = useState(0);
    const [keyword, setKeyword] = useState("");
    const searchRef = useRef(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try {
            return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
        }
        catch {
            return false;
        }
    });
    const [collapsedGroups, setCollapsedGroups] = useState(() => {
        try {
            const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
            if (!raw)
                return DEFAULT_COLLAPSE;
            return { ...DEFAULT_COLLAPSE, ...JSON.parse(raw) };
        }
        catch {
            return DEFAULT_COLLAPSE;
        }
    });
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
    useEffect(() => {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsedGroups));
    }, [collapsedGroups]);
    useEffect(() => {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
    }, [sidebarCollapsed]);
    useEffect(() => {
        const onKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                searchRef.current?.focus();
                searchRef.current?.select();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);
    useEffect(() => {
        if (!authed) {
            const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            window.location.replace(`/login.html?redirect=${encodeURIComponent(redirect)}`);
        }
    }, [authed]);
    const current = NAV.find((n) => hash.startsWith(n.path)) ?? NAV[0];
    const keywordNorm = keyword.trim().toLowerCase();
    const navLabel = (key) => String(t(`nav.${key}`));
    const groupedNav = useMemo(() => {
        const byGroup = {
            delivery: [],
            management: [],
            ai: [],
            system: [],
        };
        for (const item of NAV) {
            const label = navLabel(item.key);
            if (keywordNorm && !label.toLowerCase().includes(keywordNorm))
                continue;
            byGroup[item.group].push(item);
        }
        return GROUP_ORDER.map((group) => ({ group, items: byGroup[group] })).filter((x) => x.items.length > 0);
    }, [keywordNorm, t]);
    const toggleGroup = (group) => {
        setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
    };
    if (!authed)
        return null;
    return (_jsxs("div", { className: "flex min-h-screen flex-col bg-[var(--app-bg)] text-[var(--text)] lg:flex-row", children: [_jsxs("aside", { className: `flex w-full shrink-0 flex-col border-b border-[var(--nav-border)] bg-[var(--nav-bg)] shadow-sm backdrop-blur-xl transition-[width] duration-200 lg:h-screen lg:border-b-0 lg:border-r ${sidebarCollapsed ? "lg:w-20" : "lg:w-72"}`, children: [_jsx("div", { className: `border-b border-[var(--nav-border)] ${sidebarCollapsed ? "px-3 py-4" : "px-5 py-4"}`, children: _jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "truncate text-lg font-bold tracking-tight text-[var(--brand)]", children: sidebarCollapsed ? "SOP" : "SOP Manager" }), !sidebarCollapsed ? (_jsx("p", { className: "mt-1 text-xs text-[var(--nav-muted)]", children: t("nav.shellNavSection") })) : null] }), _jsx("button", { type: "button", className: "hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] lg:inline-flex", onClick: () => setSidebarCollapsed((v) => !v), title: sidebarCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar"), "aria-label": sidebarCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar"), children: sidebarCollapsed ? _jsx(PanelLeftOpen, { className: "h-4 w-4" }) : _jsx(PanelLeftClose, { className: "h-4 w-4" }) })] }) }), _jsxs("div", { className: `${sidebarCollapsed ? "hidden" : "px-4 pt-3"}`, children: [_jsxs("div", { className: "relative", children: [_jsx(Search, { className: "pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted)]" }), _jsx("input", { ref: searchRef, value: keyword, onChange: (e) => setKeyword(e.target.value), placeholder: t("nav.searchPlaceholder"), className: "w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] py-2 pl-8 pr-8 text-sm text-[var(--text)] shadow-sm outline-none ring-[var(--brand)] placeholder:text-[var(--muted)] focus:ring", "aria-label": t("nav.searchPlaceholder") }), keyword ? (_jsx("button", { type: "button", className: "absolute right-2 top-2 rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]", onClick: () => setKeyword(""), "aria-label": t("common.cancel"), children: _jsx(X, { className: "h-4 w-4" }) })) : null] }), _jsx("p", { className: "mt-1 px-1 text-[11px] text-[var(--nav-muted)]", children: t("nav.searchHint") })] }), _jsx("nav", { className: `mt-2 max-h-[42vh] flex-1 space-y-2 overflow-y-auto pb-3 lg:max-h-none ${sidebarCollapsed ? "px-2" : "px-2"}`, children: groupedNav.length === 0 ? (_jsx("div", { className: "rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400", children: t("nav.searchEmpty") })) : (groupedNav.map(({ group, items }) => {
                            const collapsed = collapsedGroups[group];
                            return (_jsxs("section", { children: [_jsxs("button", { type: "button", onClick: () => toggleGroup(group), className: `flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] ${sidebarCollapsed ? "justify-center" : ""}`, children: [!sidebarCollapsed ? _jsx("span", { children: t(`nav.group.${group}`) }) : _jsx("span", { className: "sr-only", children: t(`nav.group.${group}`) }), !sidebarCollapsed ? (_jsxs("span", { className: "inline-flex items-center gap-1", children: [_jsx("span", { className: "rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-strong)]", children: items.length }), collapsed ? _jsx(ChevronRight, { className: "h-3.5 w-3.5" }) : _jsx(ChevronDown, { className: "h-3.5 w-3.5" })] })) : null] }), !collapsed ? (_jsx("div", { className: "mt-1 space-y-1", children: items.map((n) => {
                                            const Icon = n.icon;
                                            return (_jsxs("a", { href: n.path, title: sidebarCollapsed ? navLabel(n.key) : undefined, className: `flex items-center rounded-lg text-sm transition ${sidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-3 py-2"} ${current.key === n.key
                                                    ? "bg-[var(--nav-active)] font-semibold text-[var(--brand)] shadow-sm ring-1 ring-[var(--brand)]"
                                                    : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"}`, children: [_jsx(Icon, { className: "h-4 w-4 shrink-0" }), !sidebarCollapsed ? _jsx("span", { children: navLabel(n.key) }) : null] }, n.key));
                                        }) })) : null] }, group));
                        })) })] }), _jsxs("main", { className: "min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 xl:px-8 2xl:px-10", children: [_jsxs("header", { className: "mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold tracking-tight text-[var(--text)]", children: t(`page.${current.key}.title`) }), _jsx("p", { className: "mt-1 text-xs text-[var(--muted)]", children: t(`nav.group.${current.group}`) })] }), _jsxs("div", { className: "ml-auto flex items-center gap-3", children: [_jsx(ProjectSelector, {}), _jsx(ThemeMenu, {}), _jsxs("select", { className: "rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2.5 py-1.5 text-sm text-[var(--text)] shadow-sm", value: i18n.language, onChange: (e) => i18n.changeLanguage(e.target.value), "aria-label": "language", children: [_jsx("option", { value: "zh-CN", children: "\u4E2D\u6587" }), _jsx("option", { value: "en-US", children: "English" }), _jsx("option", { value: "ja-JP", children: "\u65E5\u672C\u8A9E" })] }), _jsx(UserMenu, { authed: authed })] })] }), _jsx("div", { className: "w-full", children: current.el })] })] }));
}
