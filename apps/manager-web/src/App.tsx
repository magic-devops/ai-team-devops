/**
 * @ai_safe_edit
 *   - 新增页面：在 src/pages/ 加文件 + 在 NAV 数组加项
 *   - 改主题：tailwind.config.js brand + src/lib/theme.ts
 *   - 路由：当前用最小化 hash 路由；如需 nested route 切换到 @tanstack/react-router
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  BellRing,
  Blocks,
  Bot,
  Brain,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cpu,
  FolderKanban,
  GitBranch,
  Laptop,
  LayoutDashboard,
  Library,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  LogOut,
  UserCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProjectSelector } from "./components/ProjectSelector";
import { api } from "./lib/api";
import { clearSession, getProjectId, getToken } from "./lib/authStorage";
import {
  getThemePreference,
  isDarkResolved,
  setThemePreference,
  THEME_OPTIONS,
  type ThemePreference,
} from "./lib/theme";
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

type NavGroupKey = "delivery" | "management" | "ai" | "system";

const NAV = [
  { key: "dashboard", path: "#/dashboard", el: <Dashboard />, group: "delivery", icon: LayoutDashboard },
  { key: "projects", path: "#/projects", el: <Projects />, group: "delivery", icon: FolderKanban },
  { key: "tasks", path: "#/tasks", el: <Tasks />, group: "delivery", icon: ClipboardList },
  { key: "requirements", path: "#/requirements", el: <Requirements />, group: "delivery", icon: Library },
  { key: "workflows", path: "#/workflows", el: <Workflows />, group: "delivery", icon: GitBranch },
  { key: "organization", path: "#/organization", el: <Organization />, group: "management", icon: Building2 },
  { key: "analytics", path: "#/analytics", el: <Analytics />, group: "management", icon: BarChart3 },
  { key: "notify", path: "#/notify", el: <Notify />, group: "management", icon: BellRing },
  { key: "audit", path: "#/audit", el: <Audit />, group: "management", icon: ShieldCheck },
  { key: "copilot", path: "#/copilot", el: <Copilot />, group: "ai", icon: Bot },
  { key: "intelligence", path: "#/intelligence", el: <Intelligence />, group: "ai", icon: Brain },
  { key: "marketplace", path: "#/marketplace", el: <Marketplace />, group: "ai", icon: Blocks },
  { key: "platforms", path: "#/platforms", el: <Platforms />, group: "ai", icon: Cpu },
  { key: "settings", path: "#/settings", el: <Settings />, group: "system", icon: SettingsIcon },
] as const;

type NavItem = (typeof NAV)[number];

const GROUP_ORDER: NavGroupKey[] = ["delivery", "management", "ai", "system"];
const COLLAPSE_STORAGE_KEY = "sop-nav-collapse-v1";
const SIDEBAR_STORAGE_KEY = "sop-sidebar-collapsed-v1";
const DEFAULT_COLLAPSE: Record<NavGroupKey, boolean> = {
  delivery: false,
  management: false,
  ai: false,
  system: false,
};

function ThemeMenu() {
  const { t } = useTranslation();
  const [pref, setPref] = useState<ThemePreference>(() => getThemePreference());

  useEffect(() => {
    const sync = () => setPref(getThemePreference());
    window.addEventListener("sop-theme", sync);
    return () => window.removeEventListener("sop-theme", sync);
  }, []);

  const dark = isDarkResolved(pref);
  const Icon = pref === "system" ? Laptop : dark ? Moon : Palette;

  const choose = (next: ThemePreference) => {
    setThemePreference(next);
    setPref(next);
  };

  const itemClass =
    "flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text)] outline-none data-[highlighted]:bg-[var(--surface-muted)] data-[state=open]:bg-[var(--surface-muted)]";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] shadow-sm hover:bg-[var(--surface-muted)]"
          title={t("theme.label")}
          aria-label={t("theme.label")}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[12rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg"
          sideOffset={6}
          align="end"
        >
          {THEME_OPTIONS.map((theme) => {
            const ItemIcon = theme === "system" ? Laptop : theme === "dark" || theme === "graphite" ? Moon : theme === "light" ? Sun : Palette;
            return (
              <DropdownMenu.Item key={theme} className={itemClass} onSelect={() => choose(theme)}>
                <ItemIcon className="h-4 w-4 shrink-0 text-[var(--brand)]" strokeWidth={1.75} />
                <span className="flex-1">{t(`theme.${theme}`)}</span>
                {pref === theme ? <Check className="h-4 w-4 shrink-0 text-[var(--brand)]" /> : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function UserMenu({ authed }: { authed: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["authMe"], queryFn: api.authMe, enabled: authed, retry: false });
  const loginHref = `/login.html?redirect=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`;

  if (!authed) {
    return (
      <a
        href={loginHref}
        className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--brand)] px-3 text-sm font-semibold text-white shadow-sm ring-1 ring-[var(--brand)] hover:opacity-90"
      >
        <UserCircle className="h-4 w-4" />
        {t("auth.login")}
      </a>
    );
  }

  const username = me.data?.username || t("auth.account");
  const role = me.data?.role || "-";
  const tenant = me.data?.tenant_name || me.data?.tenant_slug || me.data?.tenant_id || "-";
  const projectId = getProjectId() || "-";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 max-w-[15rem] items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--control-bg)] px-2.5 text-sm text-[var(--text)] shadow-sm hover:bg-[var(--surface-muted)]"
          aria-label={t("auth.account")}
          title={username}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
            <UserCircle className="h-4 w-4" />
          </span>
          <span className="min-w-0 truncate font-medium">{username}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 w-72 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text)] shadow-xl"
          sideOffset={8}
          align="end"
        >
          <div className="rounded-xl bg-[var(--surface-muted)] p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                <UserCircle className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{username}</p>
                <p className="truncate text-xs text-[var(--muted)]">{me.data?.email || role}</p>
              </div>
            </div>
            <dl className="mt-3 grid gap-1 text-[11px] text-[var(--muted-strong)]">
              <div className="flex justify-between gap-3"><dt>{t("auth.role")}</dt><dd className="font-mono">{role}</dd></div>
              <div className="flex justify-between gap-3"><dt>{t("auth.tenant")}</dt><dd className="truncate font-mono">{tenant}</dd></div>
              <div className="flex justify-between gap-3"><dt>{t("auth.project")}</dt><dd className="truncate font-mono">{projectId}</dd></div>
            </dl>
          </div>
          {me.isError ? (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-200">
              {(me.error as Error).message}
            </div>
          ) : null}
          <DropdownMenu.Item
            className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none hover:bg-[var(--surface-muted)] data-[highlighted]:bg-[var(--surface-muted)]"
            onSelect={() => {
              void api.logout().catch(() => undefined);
              clearSession();
              void qc.invalidateQueries();
              window.location.assign("/login.html");
            }}
          >
            <LogOut className="h-4 w-4 text-[var(--brand)]" />
            {t("auth.logout")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function App() {
  const { t, i18n } = useTranslation();
  const [hash, setHash] = useState(window.location.hash || "#/dashboard");
  const [, bump] = useState(0);
  const [keyword, setKeyword] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Record<NavGroupKey, boolean>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (!raw) return DEFAULT_COLLAPSE;
      return { ...DEFAULT_COLLAPSE, ...(JSON.parse(raw) as Record<NavGroupKey, boolean>) };
    } catch {
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
    const onStorage = (e: StorageEvent) => {
      if (e.key === "sop-token" || e.key === "sop-current-project-id") bump((x) => x + 1);
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
    const onKeyDown = (e: KeyboardEvent) => {
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
  const navLabel = (key: string) => String(t(`nav.${key}`));

  const groupedNav = useMemo(() => {
    const byGroup: Record<NavGroupKey, NavItem[]> = {
      delivery: [],
      management: [],
      ai: [],
      system: [],
    };
    for (const item of NAV) {
      const label = navLabel(item.key);
      if (keywordNorm && !label.toLowerCase().includes(keywordNorm)) continue;
      byGroup[item.group].push(item);
    }
    return GROUP_ORDER.map((group) => ({ group, items: byGroup[group] })).filter((x) => x.items.length > 0);
  }, [keywordNorm, t]);

  const toggleGroup = (group: NavGroupKey) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  if (!authed) return null;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--app-bg)] text-[var(--text)] lg:flex-row">
      <aside
        className={`flex w-full shrink-0 flex-col border-b border-[var(--nav-border)] bg-[var(--nav-bg)] shadow-sm backdrop-blur-xl transition-[width] duration-200 lg:h-screen lg:border-b-0 lg:border-r ${
          sidebarCollapsed ? "lg:w-20" : "lg:w-72"
        }`}
      >
        <div className={`border-b border-[var(--nav-border)] ${sidebarCollapsed ? "px-3 py-4" : "px-5 py-4"}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-lg font-bold tracking-tight text-[var(--brand)]">
                {sidebarCollapsed ? "SOP" : "SOP Manager"}
              </div>
              {!sidebarCollapsed ? (
                <p className="mt-1 text-xs text-[var(--nav-muted)]">{t("nav.shellNavSection")}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] lg:inline-flex"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
              aria-label={sidebarCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className={`${sidebarCollapsed ? "hidden" : "px-4 pt-3"}`}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted)]" />
            <input
              ref={searchRef}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t("nav.searchPlaceholder")}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] py-2 pl-8 pr-8 text-sm text-[var(--text)] shadow-sm outline-none ring-[var(--brand)] placeholder:text-[var(--muted)] focus:ring"
              aria-label={t("nav.searchPlaceholder")}
            />
            {keyword ? (
              <button
                type="button"
                className="absolute right-2 top-2 rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                onClick={() => setKeyword("")}
                aria-label={t("common.cancel")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <p className="mt-1 px-1 text-[11px] text-[var(--nav-muted)]">{t("nav.searchHint")}</p>
        </div>

        <nav className={`mt-2 max-h-[42vh] flex-1 space-y-2 overflow-y-auto pb-3 lg:max-h-none ${sidebarCollapsed ? "px-2" : "px-2"}`}>
          {groupedNav.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {t("nav.searchEmpty")}
            </div>
          ) : (
            groupedNav.map(({ group, items }) => {
              const collapsed = collapsedGroups[group];
              return (
                <section key={group}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group)}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] ${
                      sidebarCollapsed ? "justify-center" : ""
                    }`}
                  >
                    {!sidebarCollapsed ? <span>{t(`nav.group.${group}`)}</span> : <span className="sr-only">{t(`nav.group.${group}`)}</span>}
                    {!sidebarCollapsed ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-strong)]">
                        {items.length}
                      </span>
                      {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </span>
                    ) : null}
                  </button>
                  {!collapsed ? (
                    <div className="mt-1 space-y-1">
                      {items.map((n) => {
                        const Icon = n.icon as LucideIcon;
                        return (
                          <a
                            key={n.key}
                            href={n.path}
                            title={sidebarCollapsed ? navLabel(n.key) : undefined}
                            className={`flex items-center rounded-lg text-sm transition ${
                              sidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-3 py-2"
                            } ${
                              current.key === n.key
                                ? "bg-[var(--nav-active)] font-semibold text-[var(--brand)] shadow-sm ring-1 ring-[var(--brand)]"
                                : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"
                            }`}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            {!sidebarCollapsed ? <span>{navLabel(n.key)}</span> : null}
                          </a>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </nav>

      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 xl:px-8 2xl:px-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
              {t(`page.${current.key}.title`)}
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">{t(`nav.group.${current.group}`)}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ProjectSelector />
            <ThemeMenu />
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2.5 py-1.5 text-sm text-[var(--text)] shadow-sm"
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              aria-label="language"
            >
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
              <option value="ja-JP">日本語</option>
            </select>
            <UserMenu authed={authed} />
          </div>
        </header>
        <div className="w-full">{current.el}</div>
      </main>
    </div>
  );
}
