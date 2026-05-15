/**
 * @ai_safe_edit
 *   - 新增页面：在 src/pages/ 加文件 + 在 NAV 数组加项
 *   - 改主题：tailwind.config.js brand + src/lib/theme.ts
 *   - 路由：当前用最小化 hash 路由；如需 nested route 切换到 @tanstack/react-router
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProjectSelector } from "./components/ProjectSelector";
import { getToken } from "./lib/authStorage";
import {
  getThemePreference,
  isDarkResolved,
  setThemePreference,
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
  const Icon = pref === "system" ? Laptop : dark ? Moon : Sun;

  const choose = (next: ThemePreference) => {
    setThemePreference(next);
    setPref(next);
  };

  const itemClass =
    "flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 data-[state=open]:bg-slate-50 dark:data-[highlighted]:bg-slate-800 dark:data-[state=open]:bg-slate-800";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-800"
          title={t("theme.label")}
          aria-label={t("theme.label")}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[10.5rem] rounded-xl border border-slate-200/90 bg-white p-1 shadow-lg dark:border-slate-600 dark:bg-slate-900"
          sideOffset={6}
          align="end"
        >
          <DropdownMenu.Item className={itemClass} onSelect={() => choose("light")}>
            <Sun className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={1.75} />
            <span className="flex-1">{t("theme.light")}</span>
            {pref === "light" ? <Check className="h-4 w-4 shrink-0 text-brand-600" /> : null}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={() => choose("dark")}>
            <Moon className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" strokeWidth={1.75} />
            <span className="flex-1">{t("theme.dark")}</span>
            {pref === "dark" ? <Check className="h-4 w-4 shrink-0 text-brand-600" /> : null}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={() => choose("system")}>
            <Laptop className="h-4 w-4 shrink-0 text-slate-500" strokeWidth={1.75} />
            <span className="flex-1">{t("theme.system")}</span>
            {pref === "system" ? <Check className="h-4 w-4 shrink-0 text-brand-600" /> : null}
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

  return (
    <div className="flex min-h-screen bg-slate-100/90 dark:bg-slate-950">
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200/90 bg-gradient-to-b from-white via-slate-50/85 to-slate-100/60 dark:border-slate-700/80 dark:from-slate-900 dark:via-slate-900/95 dark:to-slate-950">
        <div className="border-b border-slate-200/80 px-5 py-4 dark:border-slate-700/80">
          <div className="text-lg font-bold tracking-tight text-brand-700 dark:text-brand-300">SOP Manager</div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("nav.shellNavSection")}</p>
        </div>

        <div className="px-4 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              ref={searchRef}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t("nav.searchPlaceholder")}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-8 text-sm shadow-sm outline-none ring-brand-500/40 placeholder:text-slate-400 focus:ring dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100"
              aria-label={t("nav.searchPlaceholder")}
            />
            {keyword ? (
              <button
                type="button"
                className="absolute right-2 top-2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                onClick={() => setKeyword("")}
                aria-label={t("common.cancel")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <p className="mt-1 px-1 text-[11px] text-slate-400 dark:text-slate-500">{t("nav.searchHint")}</p>
        </div>

        <nav className="mt-2 flex-1 space-y-2 overflow-y-auto px-2 pb-3">
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
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/70"
                  >
                    <span>{t(`nav.group.${group}`)}</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700/80 dark:text-slate-300">
                        {items.length}
                      </span>
                      {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                  {!collapsed ? (
                    <div className="mt-1 space-y-1">
                      {items.map((n) => {
                        const Icon = n.icon as LucideIcon;
                        return (
                          <a
                            key={n.key}
                            href={n.path}
                            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                              current.key === n.key
                                ? "bg-brand-500/12 font-semibold text-brand-800 shadow-sm ring-1 ring-brand-500/15 dark:bg-brand-500/12 dark:text-brand-100 dark:ring-brand-400/20"
                                : "text-slate-600 hover:bg-slate-100/90 dark:text-slate-300 dark:hover:bg-slate-800/70"
                            }`}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span>{navLabel(n.key)}</span>
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

        <div className="mx-2 mt-auto border-t border-slate-200 px-2 pb-4 pt-3 text-[11px] leading-snug text-slate-500 dark:border-slate-700/80 dark:text-slate-400">
          <p className="px-1">{t("nav.dockHint")}</p>
          <a
            href="/?shell=1#/dashboard"
            className="mt-2 block rounded-lg px-2 py-1.5 text-center font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800/80"
          >
            {t("nav.setShellHome")}
          </a>
        </div>
      </aside>

      <main className="flex-1 px-5 py-6 sm:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4 dark:border-slate-700/80">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              {t(`page.${current.key}.title`)}
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t(`nav.group.${current.group}`)}</p>
          </div>
          <div className="flex items-center gap-3">
            {!authed ? (
              <a
                href="#/settings"
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm ring-1 ring-brand-600/30 hover:bg-brand-500 dark:ring-brand-400/25"
              >
                {t("auth.login")}
              </a>
            ) : null}
            <ProjectSelector />
            <ThemeMenu />
            <select
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100"
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              aria-label="language"
            >
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
              <option value="ja-JP">日本語</option>
            </select>
          </div>
        </header>
        {current.el}
      </main>
    </div>
  );
}
