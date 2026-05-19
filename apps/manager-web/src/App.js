import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * @ai_safe_edit
 *   - 新增页面：在 src/pages/ 加文件 + 在 src/navigation.tsx 注册
 *   - 改主题：tailwind.config.js brand + src/lib/theme.ts
 *   - 路由：当前用最小化 hash 路由；如需 nested route 切换到 @tanstack/react-router
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Bot, Clock, Command, Cpu, Laptop, Lock, Moon, PanelLeftClose, PanelLeftOpen, Palette, Pin, Rows3, Search, Sparkles, Star, Sun, ArrowRight, LogOut, Sliders, UserCircle, X, } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProjectSelector } from "./components/ProjectSelector";
import { api } from "./lib/api";
import { BUSINESS_CODE_KEY, clearSession, getBusinessCode, getProjectId, getTenantCode, getToken, PROJECT_CODE_KEY, PROJECT_ID_KEY, TENANT_CODE_KEY, TOKEN_KEY, } from "./lib/authStorage";
import { useCapabilities } from "./lib/capabilities";
import { densityPadding, getMenuPrefs, patchMenuPrefs, pushRecent, subscribeMenuPrefs, toggleFavorite, } from "./lib/menuPrefs";
import { getThemePreference, isDarkResolved, setThemePreference, THEME_OPTIONS, } from "./lib/theme";
import { applyHashNormalization } from "./lib/routeAliases";
import { buildNavBreadcrumb, DEFAULT_CATEGORY_COLLAPSE, DEFAULT_COLLAPSE, filterNavByRole, findActiveNavItem, groupNavItems, NAV, NAV_GROUP_ACCENT, pinnedNavItems, resolveNavKeys, } from "./navigation";
const COLLAPSE_STORAGE_KEY = "sop-nav-collapse-v1";
const CATEGORY_COLLAPSE_STORAGE_KEY = "sop-nav-category-collapse-v1";
const MODULE_COLLAPSE_STORAGE_KEY = "sop-nav-module-collapse-v1";
const SIDEBAR_STORAGE_KEY = "sop-sidebar-collapsed-v1";
const SIDEBAR_WIDTH_STORAGE_KEY = "sop-sidebar-width-v1";
const ROLE_DEFAULT_STORAGE_KEY = "sop-menu-role-default-v1";
const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 520;
function clampSidebarWidth(value) {
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}
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
    const tenant = getTenantCode() || me.data?.tenant_name || me.data?.tenant_slug || me.data?.tenant_id || "-";
    const business = getBusinessCode() || "-";
    const projectId = getProjectId() || "-";
    return (_jsxs(DropdownMenu.Root, { children: [_jsx(DropdownMenu.Trigger, { asChild: true, children: _jsxs("button", { type: "button", className: "inline-flex h-9 max-w-[15rem] items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--control-bg)] px-2.5 text-sm text-[var(--text)] shadow-sm hover:bg-[var(--surface-muted)]", "aria-label": t("auth.account"), title: username, children: [_jsx("span", { className: "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]", children: _jsx(UserCircle, { className: "h-4 w-4" }) }), _jsx("span", { className: "min-w-0 truncate font-medium", children: username })] }) }), _jsx(DropdownMenu.Portal, { children: _jsxs(DropdownMenu.Content, { className: "z-50 w-72 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text)] shadow-xl", sideOffset: 8, align: "end", children: [_jsxs("div", { className: "rounded-xl bg-[var(--surface-muted)] p-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]", children: _jsx(UserCircle, { className: "h-6 w-6" }) }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold", children: username }), _jsx("p", { className: "truncate text-xs text-[var(--muted)]", children: me.data?.email || role })] })] }), _jsxs("dl", { className: "mt-3 grid gap-1 text-[11px] text-[var(--muted-strong)]", children: [_jsxs("div", { className: "flex justify-between gap-3", children: [_jsx("dt", { children: t("auth.role") }), _jsx("dd", { className: "font-mono", children: role })] }), _jsxs("div", { className: "flex justify-between gap-3", children: [_jsx("dt", { children: t("auth.tenant") }), _jsx("dd", { className: "truncate font-mono", children: tenant })] }), _jsxs("div", { className: "flex justify-between gap-3", children: [_jsx("dt", { children: t("auth.business") }), _jsx("dd", { className: "truncate font-mono", children: business })] }), _jsxs("div", { className: "flex justify-between gap-3", children: [_jsx("dt", { children: t("auth.project") }), _jsx("dd", { className: "truncate font-mono", children: projectId })] })] })] }), me.isError ? (_jsx("div", { className: "mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-200", children: me.error.message })) : null, _jsxs(DropdownMenu.Item, { className: "mt-2 flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none hover:bg-[var(--surface-muted)] data-[highlighted]:bg-[var(--surface-muted)]", onSelect: () => {
                                void api.logout().catch(() => undefined);
                                clearSession();
                                void qc.invalidateQueries();
                                window.location.assign("/login.html");
                            }, children: [_jsx(LogOut, { className: "h-4 w-4 text-[var(--brand)]" }), t("auth.logout")] })] }) })] }));
}
function NavBadgeTag({ badge }) {
    const { t } = useTranslation();
    if (!badge)
        return null;
    const tone = {
        new: "bg-emerald-500/15 text-emerald-600 ring-emerald-500/30 dark:text-emerald-300",
        beta: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
        preview: "bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300",
        alpha: "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300",
    };
    return (_jsx("span", { className: `inline-flex items-center rounded px-1 py-px text-[9px] font-bold uppercase tracking-wider ring-1 ${tone[badge]}`, "aria-label": badge, children: t(`nav.badge.${badge}`, { defaultValue: badge }) }));
}
function FavoriteToggle({ navKey, isFav, size = "sm", className = "", }) {
    const { t } = useTranslation();
    const sz = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
    return (_jsx("button", { type: "button", onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFavorite(navKey);
        }, "aria-pressed": isFav, title: isFav ? t("nav.unfavorite") : t("nav.favorite"), className: `inline-flex shrink-0 items-center justify-center rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-amber-500 ${isFav ? "text-amber-500" : ""} ${className}`, children: _jsx(Star, { className: sz, fill: isFav ? "currentColor" : "none", strokeWidth: 1.75 }) }));
}
function DensityMenu({ density }) {
    const { t } = useTranslation();
    const options = ["compact", "comfortable", "cozy"];
    return (_jsxs(DropdownMenu.Root, { children: [_jsx(DropdownMenu.Trigger, { asChild: true, children: _jsxs("button", { type: "button", className: "inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[11px] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]", title: t("nav.density.label"), "aria-label": t("nav.density.label"), children: [_jsx(Sliders, { className: "h-3 w-3" }), _jsx("span", { children: t(`nav.density.${density}`) })] }) }), _jsx(DropdownMenu.Portal, { children: _jsx(DropdownMenu.Content, { className: "z-50 min-w-[10rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg", sideOffset: 6, align: "end", children: options.map((opt) => (_jsxs(DropdownMenu.Item, { className: "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text)] data-[highlighted]:bg-[var(--surface-muted)]", onSelect: () => patchMenuPrefs({ density: opt }), children: [_jsx(Sliders, { className: "h-3.5 w-3.5 text-[var(--brand)]" }), _jsx("span", { className: "flex-1", children: t(`nav.density.${opt}`) }), density === opt ? _jsx(Check, { className: "h-3.5 w-3.5 text-[var(--brand)]" }) : null] }, opt))) }) })] }));
}
const SEARCH_TYPE_TARGETS = {
    requirements: "#/requirements",
    tasks: "#/tasks",
    issues: "#/issues",
};
function CommandPalette({ open, setOpen, authed }) {
    const { t } = useTranslation();
    const [q, setQ] = useState("");
    const inputRef = useRef(null);
    const needle = q.trim().toLowerCase();
    const navMatches = useMemo(() => {
        if (!needle)
            return [];
        const rows = [];
        for (const item of NAV) {
            if (item.hidden)
                continue;
            const label = t(`nav.${item.key}`, { defaultValue: item.key });
            const description = item.description || t(`page.${item.key}.desc`, { defaultValue: item.path });
            const hay = `${label} ${description} ${item.path} ${item.key}`.toLowerCase();
            if (!hay.includes(needle))
                continue;
            rows.push({
                id: `nav-${item.key}`,
                type: "navigate",
                label,
                description,
                target: item.path,
                section: t("command.sectionNav"),
            });
        }
        return rows.slice(0, 12);
    }, [needle, t]);
    const workspaceQ = useQuery({
        queryKey: ["workspaceSearch", q],
        queryFn: () => api.workspaceSearch(q.trim()),
        enabled: authed && open && q.trim().length >= 2,
        retry: false,
    });
    const commands = useQuery({
        queryKey: ["copilotCommands", q],
        queryFn: () => api.copilotCommands(q, 16),
        enabled: authed && open && q.trim().length >= 1,
        retry: false,
    });
    const items = useMemo(() => {
        const rows = [...navMatches];
        for (const row of workspaceQ.data ?? []) {
            const type = String(row.type || "record");
            const title = String(row.title || row.id || type);
            const target = SEARCH_TYPE_TARGETS[type] || "#/dashboard";
            rows.push({
                id: `data-${type}-${String(row.id || title)}`,
                type: "search",
                label: title,
                description: `${t("command.sectionData")} · ${type}`,
                target,
                section: t("command.sectionData"),
            });
        }
        for (const item of commands.data?.items ?? []) {
            rows.push({
                id: String(item.id || item.label),
                type: item.type || "copilot",
                label: String(item.label || ""),
                description: String(item.description || ""),
                target: item.target ? String(item.target) : undefined,
                prompt: item.prompt ? String(item.prompt) : undefined,
                section: t("command.sectionAi"),
            });
        }
        return rows.slice(0, 28);
    }, [navMatches, workspaceQ.data, commands.data?.items, t]);
    const loading = workspaceQ.isFetching || commands.isFetching;
    useEffect(() => {
        if (!open)
            return;
        const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
        return () => window.clearTimeout(timer);
    }, [open]);
    useEffect(() => {
        if (!open)
            setQ("");
    }, [open]);
    const run = (item) => {
        const target = String(item?.target || "#/copilot");
        const prompt = String(item?.prompt || item?.label || q || "");
        if (item?.type === "copilot") {
            sessionStorage.setItem("sop-copilot-prefill", prompt);
            window.location.hash = "#/copilot";
        }
        else if (target.startsWith("#")) {
            window.location.hash = target;
        }
        else {
            sessionStorage.setItem("sop-copilot-prefill", `请检查 ${item?.label || target}，目标接口：${target}`);
            window.location.hash = "#/copilot";
        }
        setOpen(false);
    };
    const paletteIcon = (type) => {
        if (type === "navigate")
            return _jsx(Rows3, { className: "h-4 w-4" });
        if (type === "search")
            return _jsx(Search, { className: "h-4 w-4" });
        if (type === "operation")
            return _jsx(Cpu, { className: "h-4 w-4" });
        return _jsx(Bot, { className: "h-4 w-4" });
    };
    return (_jsx(Dialog.Root, { open: open, onOpenChange: setOpen, children: _jsxs(Dialog.Portal, { children: [_jsx(Dialog.Overlay, { className: "fixed inset-0 z-50 bg-black/45 backdrop-blur-sm" }), _jsxs(Dialog.Content, { className: "fixed left-1/2 top-[12vh] z-50 w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl", children: [_jsx(Dialog.Title, { className: "sr-only", children: t("command.title") }), _jsxs("div", { className: "flex items-center gap-3 border-b border-[var(--border)] px-4 py-3", children: [_jsx(Command, { className: "h-5 w-5 shrink-0 text-[var(--brand)]" }), _jsx("input", { ref: inputRef, value: q, onChange: (e) => setQ(e.target.value), onKeyDown: (e) => {
                                        if (e.key === "Enter" && items[0])
                                            run(items[0]);
                                    }, className: "min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--muted)]", placeholder: t("command.placeholder") }), _jsx("kbd", { className: "rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]", children: "Esc" })] }), _jsxs("div", { className: "max-h-[28rem] overflow-y-auto p-2", children: [loading ? _jsx("div", { className: "px-3 py-6 text-center text-sm text-[var(--muted)]", children: t("common.loading") }) : null, commands.isError ? (_jsx("div", { className: "rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200", children: commands.error.message })) : null, !loading && !items.length ? _jsx("div", { className: "px-3 py-8 text-center text-sm text-[var(--muted)]", children: t("command.empty") }) : null, items.map((item) => (_jsxs("button", { type: "button", onClick: () => run(item), className: "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-[var(--surface-muted)]", children: [_jsx("span", { className: "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]", children: paletteIcon(item.type) }), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsx("span", { className: "block truncate text-sm font-semibold text-[var(--text)]", children: item.label }), _jsxs("span", { className: "mt-0.5 block truncate text-xs text-[var(--muted)]", children: [item.section ? `${item.section} · ` : "", item.description] })] }), _jsx(ArrowRight, { className: "h-4 w-4 shrink-0 text-[var(--muted)]" })] }, item.id)))] })] })] }) }));
}
export function App() {
    const { t, i18n } = useTranslation();
    const [hash, setHash] = useState(window.location.hash || "#/dashboard");
    const [, bump] = useState(0);
    const [keyword, setKeyword] = useState("");
    const [commandOpen, setCommandOpen] = useState(false);
    const searchRef = useRef(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try {
            return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
        }
        catch {
            return false;
        }
    });
    const [sidebarWidth, setSidebarWidth] = useState(() => {
        try {
            const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) || SIDEBAR_DEFAULT_WIDTH);
            return clampSidebarWidth(Number.isFinite(raw) ? raw : SIDEBAR_DEFAULT_WIDTH);
        }
        catch {
            return SIDEBAR_DEFAULT_WIDTH;
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
    const [collapsedCategories, setCollapsedCategories] = useState(() => {
        try {
            const raw = localStorage.getItem(CATEGORY_COLLAPSE_STORAGE_KEY);
            if (!raw)
                return DEFAULT_CATEGORY_COLLAPSE;
            return { ...DEFAULT_CATEGORY_COLLAPSE, ...JSON.parse(raw) };
        }
        catch {
            return DEFAULT_CATEGORY_COLLAPSE;
        }
    });
    const [collapsedModules, setCollapsedModules] = useState(() => {
        try {
            const raw = localStorage.getItem(MODULE_COLLAPSE_STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        }
        catch {
            return {};
        }
    });
    const [menuPrefs, setMenuPrefs] = useState(() => getMenuPrefs());
    const [quickPanel, setQuickPanel] = useState(null);
    useEffect(() => subscribeMenuPrefs(setMenuPrefs), []);
    const authed = Boolean(getToken());
    const me = useQuery({ queryKey: ["authMe"], queryFn: api.authMe, enabled: authed, retry: false });
    const menuPrefsRemote = useQuery({
        queryKey: ["systemPagesMenuPreferencesMe"],
        queryFn: api.systemPagesMenuPreferencesMe,
        enabled: authed,
        retry: false,
    });
    const syncMenuPrefs = useMutation({
        mutationFn: api.systemPagesMenuPreferencesUpdate,
    });
    const capabilities = useCapabilities();
    useEffect(() => {
        const h = () => {
            if (applyHashNormalization())
                return;
            setHash(window.location.hash || "#/dashboard");
        };
        h();
        window.addEventListener("hashchange", h);
        return () => window.removeEventListener("hashchange", h);
    }, []);
    useEffect(() => {
        const onStorage = (e) => {
            if ([TOKEN_KEY, PROJECT_ID_KEY, TENANT_CODE_KEY, BUSINESS_CODE_KEY, PROJECT_CODE_KEY].includes(e.key || ""))
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
        localStorage.setItem(CATEGORY_COLLAPSE_STORAGE_KEY, JSON.stringify(collapsedCategories));
    }, [collapsedCategories]);
    useEffect(() => {
        localStorage.setItem(MODULE_COLLAPSE_STORAGE_KEY, JSON.stringify(collapsedModules));
    }, [collapsedModules]);
    useEffect(() => {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
    }, [sidebarCollapsed]);
    useEffect(() => {
        if (!sidebarCollapsed)
            localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    }, [sidebarCollapsed, sidebarWidth]);
    useEffect(() => {
        let lastG = 0;
        const isEditing = () => {
            const el = document.activeElement;
            if (!el)
                return false;
            if (el.isContentEditable)
                return true;
            const tag = el.tagName;
            return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
        };
        const onKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setCommandOpen(true);
                return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "/") {
                e.preventDefault();
                setSidebarCollapsed((v) => !v);
                return;
            }
            if (isEditing())
                return;
            if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                lastG = Date.now();
                return;
            }
            if (lastG && Date.now() - lastG < 900) {
                const map = {
                    d: "#/dashboard",
                    r: "#/requirements",
                    t: "#/tasks",
                    c: "#/copilot",
                    p: "#/projects",
                    a: "#/analytics",
                    o: "#/organization",
                    s: "#/settings",
                    m: "#/system-map",
                };
                const target = map[e.key.toLowerCase()];
                if (target) {
                    e.preventDefault();
                    window.location.hash = target;
                }
                lastG = 0;
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
    const humanizeNavKey = (key) => key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
    const navLabel = (key) => String(t(`nav.${key}`, { defaultValue: humanizeNavKey(key) }));
    const currentRole = capabilities.role || String(me.data?.role || "viewer");
    const menuStrategy = menuPrefsRemote.data?.strategy;
    const capabilityItems = capabilities.items.length ? capabilities.items : capabilities.visibleItems;
    const visibleNav = useMemo(() => filterNavByRole(currentRole, capabilityItems), [capabilityItems, currentRole]);
    const current = findActiveNavItem(hash, visibleNav.length ? visibleNav : undefined);
    const groupedNav = useMemo(() => groupNavItems(keyword, navLabel, visibleNav), [keyword, t, visibleNav]);
    const pinnedItems = useMemo(() => pinnedNavItems(visibleNav), [visibleNav]);
    const favoriteItems = useMemo(() => resolveNavKeys(menuPrefs.favorites, visibleNav), [menuPrefs.favorites, visibleNav]);
    const recentItems = useMemo(() => resolveNavKeys(menuPrefs.recents, visibleNav).filter((item) => item.key !== current.key).slice(0, 6), [menuPrefs.recents, visibleNav, current.key]);
    const favoriteSet = useMemo(() => new Set(menuPrefs.favorites), [menuPrefs.favorites]);
    const currentFavorite = favoriteSet.has(current.key);
    const breadcrumb = useMemo(() => buildNavBreadcrumb(hash, navLabel, visibleNav), [hash, navLabel, visibleNav]);
    const densityCls = densityPadding(menuPrefs.density);
    const canWriteCurrent = current.capability ? capabilities.can(current.capability, "write") : true;
    const quickPanelItems = quickPanel === "favorites" ? favoriteItems : quickPanel === "recents" ? recentItems : pinnedItems;
    const quickPanelTitle = quickPanel === "favorites" ? t("nav.favorites") : quickPanel === "recents" ? t("nav.recents") : t("nav.pinned");
    useEffect(() => {
        const prefs = menuPrefsRemote.data?.preferences;
        if (!authed || !prefs)
            return;
        const scope = `${ROLE_DEFAULT_STORAGE_KEY}:${currentRole}:${String(me.data?.username || me.data?.user_id || "user")}`;
        try {
            if (localStorage.getItem(scope) === "1")
                return;
            setCollapsedGroups({ ...DEFAULT_COLLAPSE, ...(prefs.collapsed_groups || {}) });
            setCollapsedCategories({ ...DEFAULT_CATEGORY_COLLAPSE, ...(prefs.collapsed_categories || {}) });
            setCollapsedModules(prefs.collapsed_modules || {});
            patchMenuPrefs({
                favorites: Array.isArray(prefs.favorites) ? prefs.favorites : menuPrefs.favorites,
                recents: Array.isArray(prefs.recents) ? prefs.recents : menuPrefs.recents,
                density: prefs.density || menuPrefs.density,
                showRecents: typeof prefs.show_recents === "boolean" ? prefs.show_recents : menuPrefs.showRecents,
                showFavorites: typeof prefs.show_favorites === "boolean" ? prefs.show_favorites : menuPrefs.showFavorites,
            });
            localStorage.setItem(scope, "1");
        }
        catch {
            /* ignore disabled storage */
        }
    }, [authed, currentRole, me.data?.user_id, me.data?.username, menuPrefs.density, menuPrefs.favorites, menuPrefs.recents, menuPrefs.showFavorites, menuPrefs.showRecents, menuPrefsRemote.data?.preferences]);
    useEffect(() => {
        if (!authed || !menuPrefsRemote.data?.ok)
            return;
        const timer = window.setTimeout(() => {
            syncMenuPrefs.mutate({
                favorites: menuPrefs.favorites,
                recents: menuPrefs.recents,
                density: menuPrefs.density,
                show_recents: menuPrefs.showRecents,
                show_favorites: menuPrefs.showFavorites,
                collapsed_groups: collapsedGroups,
                collapsed_categories: collapsedCategories,
                collapsed_modules: collapsedModules,
            });
        }, 700);
        return () => window.clearTimeout(timer);
    }, [authed, collapsedCategories, collapsedGroups, collapsedModules, menuPrefs.density, menuPrefs.favorites, menuPrefs.recents, menuPrefs.showFavorites, menuPrefs.showRecents, menuPrefsRemote.data?.ok]);
    useEffect(() => {
        if (current?.key) {
            const next = pushRecent(current.key);
            if (menuPrefsRemote.data?.ok)
                syncMenuPrefs.mutate({ recents: next.recents });
        }
    }, [current?.key, menuPrefsRemote.data?.ok]);
    const childrenByParent = useMemo(() => {
        const out = new Map();
        for (const item of visibleNav) {
            if (!item.parentKey || item.hidden)
                continue;
            const rows = out.get(item.parentKey) ?? [];
            rows.push(item);
            out.set(item.parentKey, rows);
        }
        return out;
    }, [visibleNav]);
    useEffect(() => {
        if (!visibleNav.length)
            return;
        const activeAllowed = visibleNav.some((item) => !item.external && item.path.startsWith("#") && hash.startsWith(item.path));
        if (!activeAllowed) {
            const fallback = visibleNav.find((item) => item.path.startsWith("#")) ?? visibleNav[0];
            if (fallback?.path?.startsWith("#"))
                window.location.hash = fallback.path;
        }
    }, [hash, visibleNav]);
    const openModuleCopilot = () => {
        const label = navLabel(current.key);
        const group = String(t(`nav.group.${current.group}`));
        sessionStorage.setItem("sop-copilot-prefill", t("command.moduleAiPrompt", {
            module: label,
            group,
            capability: current.capability || current.key,
            path: current.path,
        }));
        window.location.hash = "#/copilot";
    };
    const toggleGroup = (group) => {
        setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
    };
    const toggleCategory = (category) => {
        setCollapsedCategories((prev) => ({ ...prev, [category]: !prev[category] }));
    };
    const toggleModule = (moduleKey) => {
        setCollapsedModules((prev) => ({ ...prev, [moduleKey]: !prev[moduleKey] }));
    };
    const startSidebarResize = (event) => {
        event.preventDefault();
        if (sidebarCollapsed)
            return;
        const startX = event.clientX;
        const startWidth = sidebarWidth;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        const onMove = (move) => {
            setSidebarWidth(clampSidebarWidth(startWidth + move.clientX - startX));
        };
        const onUp = () => {
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };
    if (!authed)
        return null;
    const sidebarStyle = {
        "--sidebar-width": `${sidebarWidth}px`,
    };
    return (_jsxs("div", { className: "flex min-h-screen flex-col bg-[var(--app-bg)] text-[var(--text)] lg:h-screen lg:min-h-0 lg:overflow-hidden lg:flex-row", children: [_jsx(CommandPalette, { open: commandOpen, setOpen: setCommandOpen, authed: authed }), _jsxs("aside", { style: sidebarStyle, className: `relative flex min-h-0 w-full shrink-0 flex-col border-b border-[var(--nav-border)] bg-[var(--nav-bg)] shadow-sm backdrop-blur-xl transition-[width] duration-200 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r ${sidebarCollapsed ? "lg:w-20" : "lg:w-[var(--sidebar-width)]"}`, children: [_jsx("div", { className: `border-b border-[var(--nav-border)] ${sidebarCollapsed ? "px-3 py-4" : "px-5 py-4"}`, children: _jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "truncate text-lg font-bold tracking-tight text-[var(--brand)]", children: sidebarCollapsed ? "H" : "Hermes" }), !sidebarCollapsed ? (_jsx("p", { className: "mt-1 text-xs text-[var(--nav-muted)]", children: t("nav.shellNavSection") })) : null] }), _jsx("button", { type: "button", className: "hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] lg:inline-flex", onClick: () => setSidebarCollapsed((v) => !v), title: sidebarCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar"), "aria-label": sidebarCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar"), children: sidebarCollapsed ? _jsx(PanelLeftOpen, { className: "h-4 w-4" }) : _jsx(PanelLeftClose, { className: "h-4 w-4" }) })] }) }), _jsxs("div", { className: `${sidebarCollapsed ? "hidden" : "px-4 pt-3"}`, children: [_jsxs("div", { className: "relative", children: [_jsx(Search, { className: "pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted)]" }), _jsx("input", { ref: searchRef, value: keyword, onChange: (e) => setKeyword(e.target.value), placeholder: t("nav.searchPlaceholder"), className: "w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] py-2 pl-8 pr-8 text-sm text-[var(--text)] shadow-sm outline-none ring-[var(--brand)] placeholder:text-[var(--muted)] focus:ring", "aria-label": t("nav.searchPlaceholder") }), keyword ? (_jsx("button", { type: "button", className: "absolute right-2 top-2 rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]", onClick: () => setKeyword(""), "aria-label": t("common.cancel"), children: _jsx(X, { className: "h-4 w-4" }) })) : null] }), _jsx("p", { className: "mt-1 px-1 text-[11px] text-[var(--nav-muted)]", children: t("nav.searchHint") })] }), !sidebarCollapsed && !keyword ? (_jsx("div", { className: "px-3 pt-2", children: _jsxs("div", { className: "rounded-xl border border-[var(--border)]/70 bg-[var(--surface-raised)]/45 p-1.5", children: [_jsx("div", { className: "grid grid-cols-3 gap-1", children: [
                                        { key: "pinned", icon: Pin, label: t("nav.pinned"), count: pinnedItems.length, enabled: pinnedItems.length > 0 },
                                        { key: "favorites", icon: Star, label: t("nav.favorites"), count: favoriteItems.length, enabled: menuPrefs.showFavorites },
                                        { key: "recents", icon: Clock, label: t("nav.recents"), count: recentItems.length, enabled: menuPrefs.showRecents },
                                    ].map((entry) => {
                                        const Icon = entry.icon;
                                        const active = quickPanel === entry.key;
                                        return (_jsxs("button", { type: "button", disabled: !entry.enabled, onClick: () => setQuickPanel((value) => (value === entry.key ? null : entry.key)), className: `flex min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${active
                                                ? "bg-[var(--nav-active)] text-[var(--brand)] ring-1 ring-[var(--brand)]/25"
                                                : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"}`, title: entry.label, children: [_jsx(Icon, { className: "h-3.5 w-3.5 shrink-0" }), _jsx("span", { className: "truncate", children: entry.label }), _jsx("span", { className: "rounded bg-[var(--surface-muted)] px-1 font-mono text-[10px] text-[var(--muted-strong)]", children: entry.count })] }, entry.key));
                                    }) }), quickPanel ? (_jsxs("div", { className: "mt-1.5 border-t border-[var(--border)]/70 pt-1.5", children: [_jsxs("div", { className: "mb-1 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--nav-muted)]", children: [_jsx("span", { children: quickPanelTitle }), quickPanel === "recents" && recentItems.length ? (_jsx("button", { type: "button", onClick: () => patchMenuPrefs({ recents: [] }), className: "rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]", title: t("nav.clearRecents"), "aria-label": t("nav.clearRecents"), children: _jsx(X, { className: "h-3 w-3" }) })) : null] }), _jsx("div", { className: "grid max-h-28 grid-cols-2 gap-1 overflow-y-auto pr-1", children: quickPanelItems.length ? quickPanelItems.map((item) => {
                                                const Icon = item.icon;
                                                const active = current.key === item.key || current.parentKey === item.key;
                                                return (_jsxs("a", { href: item.path, className: `group flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition ${active
                                                        ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]"
                                                        : "text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--nav-text)]"}`, title: item.shortcut ? `${navLabel(item.key)} (${item.shortcut})` : navLabel(item.key), children: [_jsx(Icon, { className: "h-3.5 w-3.5 shrink-0" }), _jsx("span", { className: "min-w-0 flex-1 truncate", children: navLabel(item.key) }), _jsx(NavBadgeTag, { badge: item.badge })] }, `${quickPanel}-${item.key}`));
                                            }) : (_jsx("div", { className: "col-span-2 rounded-md border border-dashed border-[var(--border)] px-2 py-2 text-center text-[11px] text-[var(--nav-muted)]", children: t("nav.quickEmpty") })) })] })) : null] }) })) : null, _jsx("nav", { className: `mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-3 ${sidebarCollapsed ? "px-2" : "px-2"}`, children: groupedNav.length === 0 ? (_jsx("div", { className: "rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400", children: t("nav.searchEmpty") })) : (groupedNav.map(({ group, categories }) => {
                            const collapsed = collapsedGroups[group.key];
                            const groupCount = categories.reduce((sum, category) => sum + category.items.length, 0);
                            return (_jsxs("section", { className: "border-l-2 pl-1", style: { borderLeftColor: NAV_GROUP_ACCENT[group.key] }, children: [_jsxs("button", { type: "button", onClick: () => toggleGroup(group.key), className: `flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] ${sidebarCollapsed ? "justify-center" : ""}`, children: [!sidebarCollapsed ? _jsx("span", { children: t(group.i18nKey) }) : _jsx("span", { className: "sr-only", children: t(group.i18nKey) }), !sidebarCollapsed ? (_jsxs("span", { className: "inline-flex items-center gap-1", children: [_jsx("span", { className: "rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-strong)]", children: groupCount }), collapsed ? _jsx(ChevronRight, { className: "h-3.5 w-3.5" }) : _jsx(ChevronDown, { className: "h-3.5 w-3.5" })] })) : null] }), !collapsed ? (_jsx("div", { className: "mt-1 space-y-2", children: categories.map(({ category, items }) => {
                                            const categoryCollapsed = !keyword && collapsedCategories[category.key];
                                            return (_jsxs("div", { className: !sidebarCollapsed ? "rounded-lg border border-[var(--border)]/60 bg-[var(--surface-raised)]/30 p-1" : "", children: [!sidebarCollapsed ? (_jsxs("button", { type: "button", onClick: () => toggleCategory(category.key), className: "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]", children: [_jsx("span", { className: "min-w-0 truncate", children: t(category.i18nKey, { defaultValue: humanizeNavKey(category.key) }) }), _jsxs("span", { className: "inline-flex items-center gap-1", children: [_jsx("span", { className: "rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]", children: items.length }), categoryCollapsed ? _jsx(ChevronRight, { className: "h-3 w-3" }) : _jsx(ChevronDown, { className: "h-3 w-3" })] })] })) : null, !categoryCollapsed ? (_jsx("div", { className: "mt-1 space-y-1", children: items.map((n) => {
                                                            const Icon = n.icon;
                                                            const children = childrenByParent.get(n.key) ?? [];
                                                            const parentActive = current.key === n.key || current.parentKey === n.key;
                                                            const moduleOpen = Boolean(keyword) || parentActive || !collapsedModules[n.key];
                                                            const isFav = favoriteSet.has(n.key);
                                                            const canWrite = n.capability ? capabilities.can(n.capability, "write") : true;
                                                            return (_jsxs("div", { className: "group/nav", children: [_jsxs("div", { className: `flex items-center rounded-lg text-sm transition ${parentActive
                                                                            ? "bg-[var(--nav-active)] font-semibold text-[var(--brand)] shadow-sm ring-1 ring-[var(--brand)]"
                                                                            : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"}`, children: [_jsxs("a", { href: n.path, title: sidebarCollapsed ? (n.shortcut ? `${navLabel(n.key)} (${n.shortcut})` : navLabel(n.key)) : undefined, className: `min-w-0 flex-1 items-center ${sidebarCollapsed ? `flex justify-center px-2 ${densityCls.item}` : `flex gap-2.5 px-3 ${densityCls.item}`}`, children: [_jsx(Icon, { className: "h-4 w-4 shrink-0" }), !sidebarCollapsed ? (_jsxs("span", { className: "flex min-w-0 flex-1 items-center gap-1.5 truncate", children: [_jsx("span", { className: "min-w-0 flex-1 truncate", children: navLabel(n.key) }), !canWrite ? (_jsx(Lock, { className: "h-3 w-3 shrink-0 text-[var(--muted)]", "aria-label": t("nav.readOnly") })) : null, _jsx(NavBadgeTag, { badge: n.badge })] })) : null] }), !sidebarCollapsed && n.pinnable !== false ? (_jsx(FavoriteToggle, { navKey: n.key, isFav: isFav, className: `mr-1 transition ${isFav ? "opacity-100" : "opacity-0 group-hover/nav:opacity-100 focus-visible:opacity-100"}` })) : null, !sidebarCollapsed && children.length ? (_jsx("button", { type: "button", onClick: () => toggleModule(n.key), className: "mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]", "aria-label": moduleOpen ? t("nav.collapseModule") : t("nav.expandModule"), title: moduleOpen ? t("nav.collapseModule") : t("nav.expandModule"), children: moduleOpen ? _jsx(ChevronDown, { className: "h-3.5 w-3.5" }) : _jsx(ChevronRight, { className: "h-3.5 w-3.5" }) })) : null] }), !sidebarCollapsed && children.length && moduleOpen ? (_jsx("div", { className: "ml-7 mt-1 grid gap-0.5 border-l border-[var(--border)] pl-2", children: children.map((child) => {
                                                                            const ChildIcon = child.icon;
                                                                            const childActive = current.key === child.key;
                                                                            const childFav = favoriteSet.has(child.key);
                                                                            const childCanWrite = child.capability ? capabilities.can(child.capability, "write") : true;
                                                                            return (_jsxs("div", { className: `group/child flex items-center rounded-md text-xs ${childActive
                                                                                    ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]"
                                                                                    : "text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--nav-text)]"}`, children: [_jsxs("a", { href: child.path, className: `flex min-w-0 flex-1 items-center gap-2 px-2 ${densityCls.child}`, title: child.capability, children: [_jsx(ChildIcon, { className: "h-3.5 w-3.5 shrink-0" }), _jsx("span", { className: "min-w-0 flex-1 truncate", children: navLabel(child.key) }), !childCanWrite ? _jsx(Lock, { className: "h-3 w-3 shrink-0 text-[var(--muted)]", "aria-label": t("nav.readOnly") }) : null, _jsx(NavBadgeTag, { badge: child.badge })] }), child.pinnable !== false ? (_jsx(FavoriteToggle, { navKey: child.key, isFav: childFav, className: `mr-0.5 ${childFav ? "opacity-100" : "opacity-0 group-hover/child:opacity-100 focus-visible:opacity-100"}` })) : null] }, child.key));
                                                                        }) })) : null] }, n.key));
                                                        }) })) : null] }, category.key));
                                        }) })) : null] }, group.key));
                        })) }), !sidebarCollapsed ? (_jsxs("div", { className: "shrink-0 border-t border-[var(--nav-border)] px-3 py-2", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx(DensityMenu, { density: menuPrefs.density }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("button", { type: "button", onClick: () => patchMenuPrefs({ showFavorites: !menuPrefs.showFavorites }), className: `inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] ${menuPrefs.showFavorites ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "bg-[var(--control-bg)] text-[var(--muted-strong)]"} hover:bg-[var(--surface-muted)]`, title: t("nav.toggleFavorites"), children: _jsx(Star, { className: "h-3 w-3" }) }), _jsx("button", { type: "button", onClick: () => patchMenuPrefs({ showRecents: !menuPrefs.showRecents }), className: `inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] ${menuPrefs.showRecents ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "bg-[var(--control-bg)] text-[var(--muted-strong)]"} hover:bg-[var(--surface-muted)]`, title: t("nav.toggleRecents"), children: _jsx(Clock, { className: "h-3 w-3" }) })] })] }), menuStrategy ? (_jsxs("div", { className: "mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-[10px]", children: [_jsxs("span", { className: "min-w-0 flex-1 truncate text-[var(--nav-muted)]", children: [_jsx("span", { className: "font-medium text-[var(--muted-strong)]", children: t("nav.roleStrategy") }), _jsx("span", { className: "mx-1", children: "\u00B7" }), _jsx("span", { className: "font-mono text-[var(--brand)]", children: currentRole }), _jsx("span", { className: "mx-1", children: "\u00B7" }), t("nav.roleHome"), ": ", menuStrategy.home] }), _jsx("button", { type: "button", className: "shrink-0 rounded px-1 text-[var(--brand)] hover:bg-[var(--surface)]", onClick: () => {
                                            const prefs = menuPrefsRemote.data?.preferences;
                                            if (!prefs)
                                                return;
                                            setCollapsedGroups({ ...DEFAULT_COLLAPSE, ...(prefs.collapsed_groups || {}) });
                                            setCollapsedCategories({ ...DEFAULT_CATEGORY_COLLAPSE, ...(prefs.collapsed_categories || {}) });
                                            setCollapsedModules(prefs.collapsed_modules || {});
                                            patchMenuPrefs({
                                                favorites: Array.isArray(prefs.favorites) ? prefs.favorites : menuPrefs.favorites,
                                                recents: Array.isArray(prefs.recents) ? prefs.recents : menuPrefs.recents,
                                                density: prefs.density || menuPrefs.density,
                                                showRecents: typeof prefs.show_recents === "boolean" ? prefs.show_recents : menuPrefs.showRecents,
                                                showFavorites: typeof prefs.show_favorites === "boolean" ? prefs.show_favorites : menuPrefs.showFavorites,
                                            });
                                        }, children: t("nav.applyRoleDefaults") })] })) : null, _jsx("p", { className: "mt-1 truncate px-0.5 text-[10px] text-[var(--nav-muted)]", title: t("nav.shortcutHint"), children: t("nav.shortcutHint") })] })) : null, !sidebarCollapsed ? (_jsx("button", { type: "button", className: "group absolute -right-1 top-0 z-20 hidden h-full w-2 cursor-col-resize items-stretch justify-center lg:flex", onMouseDown: startSidebarResize, onDoubleClick: () => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH), title: t("nav.resizeSidebar"), "aria-label": t("nav.resizeSidebar"), children: _jsx("span", { className: "my-3 w-px rounded-full bg-transparent transition group-hover:bg-[var(--brand)] group-active:bg-[var(--brand)]" }) })) : null] }), _jsxs("main", { className: "min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:h-screen lg:overflow-y-auto xl:px-8 2xl:px-10", children: [_jsxs("header", { className: "mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "inline-block h-5 w-1 rounded", style: { background: NAV_GROUP_ACCENT[current.group] }, "aria-hidden": true }), _jsx("h1", { className: "text-2xl font-bold tracking-tight text-[var(--text)]", children: t(`page.${current.key}.title`, { defaultValue: navLabel(current.key) }) }), _jsx(NavBadgeTag, { badge: current.badge }), !canWriteCurrent ? (_jsxs("span", { className: "inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300", title: t("nav.readOnlyHint"), children: [_jsx(Lock, { className: "h-3 w-3" }), t("nav.readOnly")] })) : null, current.pinnable !== false ? (_jsx(FavoriteToggle, { navKey: current.key, isFav: currentFavorite, size: "md" })) : null] }), _jsxs("p", { className: "mt-1 flex flex-wrap items-center gap-1 text-xs text-[var(--muted)]", children: [_jsx("span", { children: t(breadcrumb.group.i18nKey) }), breadcrumb.category ? (_jsxs(_Fragment, { children: [_jsx("span", { "aria-hidden": true, children: "/" }), _jsx("span", { children: t(breadcrumb.category.i18nKey, { defaultValue: humanizeNavKey(breadcrumb.category.key) }) })] })) : null, breadcrumb.parent ? (_jsxs(_Fragment, { children: [_jsx("span", { "aria-hidden": true, children: "/" }), _jsx("span", { children: navLabel(breadcrumb.parent.key) })] })) : null, _jsx("span", { "aria-hidden": true, children: "/" }), _jsx("span", { className: "font-medium text-[var(--muted-strong)]", children: navLabel(breadcrumb.item.key) }), current.shortcut ? (_jsxs("span", { className: "ml-2 hidden items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-px font-mono text-[10px] text-[var(--muted-strong)] md:inline-flex", children: [_jsx(Sparkles, { className: "h-3 w-3" }), current.shortcut] })) : null] })] }), _jsxs("div", { className: "ml-auto flex items-center gap-3", children: [_jsxs("button", { type: "button", className: "hidden h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm text-[var(--muted-strong)] shadow-sm hover:bg-[var(--surface-muted)] lg:inline-flex", onClick: () => setCommandOpen(true), title: t("command.title"), children: [_jsx(Command, { className: "h-4 w-4" }), _jsx("span", { children: t("command.short") })] }), _jsx(ProjectSelector, {}), _jsxs("button", { type: "button", className: "inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm text-[var(--muted-strong)] shadow-sm hover:bg-[var(--surface-muted)]", onClick: openModuleCopilot, title: t("command.moduleAi"), children: [_jsx(Bot, { className: "h-4 w-4 text-[var(--brand)]" }), _jsx("span", { className: "hidden xl:inline", children: t("command.moduleAi") })] }), _jsx(ThemeMenu, {}), _jsxs("select", { className: "rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2.5 py-1.5 text-sm text-[var(--text)] shadow-sm", value: i18n.language, onChange: (e) => i18n.changeLanguage(e.target.value), "aria-label": "language", children: [_jsx("option", { value: "zh-CN", children: "\u4E2D\u6587" }), _jsx("option", { value: "en-US", children: "English" }), _jsx("option", { value: "ja-JP", children: "\u65E5\u672C\u8A9E" })] }), _jsx(UserMenu, { authed: authed })] })] }), _jsx("div", { className: "w-full", children: current.el })] })] }));
}
