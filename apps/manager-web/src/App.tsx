/**
 * @ai_safe_edit
 *   - 新增页面：在 src/pages/ 加文件 + 在 src/navigation.tsx 注册
 *   - 改主题：tailwind.config.js brand + src/lib/theme.ts
 *   - 路由：当前用最小化 hash 路由；如需 nested route 切换到 @tanstack/react-router
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Bot,
  Clock,
  Command,
  Layers3,
  Laptop,
  Lock,
  MessageSquareText,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Pin,
  Rows3,
  Search,
  Sparkles,
  Star,
  Sun,
  ArrowRight,
  LogOut,
  Sliders,
  UserCircle,
  X,
} from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { ProjectSelector } from "./components/ProjectSelector";
import { appShellApi } from "./lib/appShellApi";
import {
  BUSINESS_CODE_KEY,
  clearSession,
  getBusinessCode,
  getProjectId,
  getTenantCode,
  getToken,
  PROJECT_CODE_KEY,
  PROJECT_ID_KEY,
  setUserSession,
  TENANT_CODE_KEY,
  TOKEN_KEY,
} from "./lib/authStorage";
import { capabilityReadOnly, useCapabilities } from "./lib/capabilities";
import {
  densityPadding,
  getMenuPrefs,
  patchMenuPrefs,
  pushRecent,
  subscribeMenuPrefs,
  toggleFavorite,
  toggleQuickAccess,
  type MenuEffect,
  type MenuDensity,
  type MenuLayout,
  type MenuPrefs,
} from "./lib/menuPrefs";
import {
  getThemePreference,
  isDarkResolved,
  setThemePreference,
  THEME_OPTIONS,
  type ThemePreference,
} from "./lib/theme";
import { applyHashNormalization } from "./lib/routeAliases";
import {
  DEFAULT_MICRO_APP_ID,
  MICRO_APPS,
  filterNavByMicroApp,
  getMicroAppIdForNavItem,
  getMicroAppIdFromHash,
  type MicroAppId,
} from "./microApps";
import {
  buildNavBreadcrumb,
  DEFAULT_CATEGORY_COLLAPSE,
  DEFAULT_COLLAPSE,
  filterNavByRole,
  findActiveNavItem,
  NAV,
  NAV_CATEGORIES,
  NAV_GROUP_ACCENT,
  pinnedNavItems,
  resolveNavKeys,
  type NavBadge,
  type NavGroupKey,
  type NavItem,
} from "./navigation";

const CommandPaletteLazy = lazy(() => import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const MobileNavDrawerLazy = lazy(() => import("./components/MobileNavDrawer").then((m) => ({ default: m.MobileNavDrawer })));

const COLLAPSE_STORAGE_KEY = "sop-nav-collapse-v1";
const CATEGORY_COLLAPSE_STORAGE_KEY = "sop-nav-category-collapse-v1";
const MODULE_COLLAPSE_STORAGE_KEY = "sop-nav-module-collapse-v1";
const SIDEBAR_STORAGE_KEY = "sop-sidebar-collapsed-v1";
const SIDEBAR_WIDTH_STORAGE_KEY = "sop-sidebar-width-v1";
const ROLE_DEFAULT_STORAGE_KEY = "sop-menu-role-default-v1";
const MICRO_APP_STORAGE_KEY = "sop-active-micro-app-v1";
const MICRO_APP_EXPANDED_STORAGE_KEY = "sop-expanded-micro-apps-v1";
const MANAGER_AUTH_OPTIONAL_HASHES = new Set(["#/workspace"]);
const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 520;
type QuickPanelKey = "pinned" | "favorites" | "recents";

const NAV_CATEGORY_I18N_BY_KEY = new Map(NAV_CATEGORIES.map((category) => [category.key, category.i18nKey]));

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

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
  const me = useQuery({ queryKey: ["authMe"], queryFn: appShellApi.authMe, enabled: authed, retry: false });
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
  const tenant = getTenantCode() || me.data?.tenant_name || me.data?.tenant_slug || me.data?.tenant_id || "-";
  const business = getBusinessCode() || "-";
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
              <div className="flex justify-between gap-3"><dt>{t("auth.business")}</dt><dd className="truncate font-mono">{business}</dd></div>
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
              void appShellApi.logout().catch(() => undefined);
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

function NavBadgeTag({ badge }: { badge?: NavBadge }) {
  const { t } = useTranslation();
  if (!badge) return null;
  const tone: Record<NavBadge, string> = {
    new: "bg-emerald-500/15 text-emerald-600 ring-emerald-500/30 dark:text-emerald-300",
    beta: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
    preview: "bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300",
    alpha: "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1 py-px text-[9px] font-bold uppercase tracking-wider ring-1 ${tone[badge]}`}
      aria-label={badge}
    >
      {t(`nav.badge.${badge}`, { defaultValue: badge })}
    </span>
  );
}

function FavoriteToggle({
  navKey,
  isFav,
  size = "sm",
  className = "",
}: {
  navKey: string;
  isFav: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useTranslation();
  const sz = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(navKey);
      }}
      aria-pressed={isFav}
      title={isFav ? t("nav.unfavorite") : t("nav.favorite")}
      className={`inline-flex shrink-0 items-center justify-center rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-amber-500 ${
        isFav ? "text-amber-500" : ""
      } ${className}`}
    >
      <Star className={sz} fill={isFav ? "currentColor" : "none"} strokeWidth={1.75} />
    </button>
  );
}

function QuickAccessToggle({
  navKey,
  isQuick,
  size = "sm",
  className = "",
}: {
  navKey: string;
  isQuick: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useTranslation();
  const sz = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleQuickAccess(navKey);
      }}
      aria-pressed={isQuick}
      title={isQuick ? t("nav.quickRemove") : t("nav.quickAdd")}
      className={`inline-flex shrink-0 items-center justify-center rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--brand)] ${
        isQuick ? "text-[var(--brand)]" : ""
      } ${className}`}
    >
      <Pin className={sz} fill={isQuick ? "currentColor" : "none"} strokeWidth={1.75} />
    </button>
  );
}

type AppMenuCategory = { key: string; label: string; items: NavItem[] };
type AppMenuDomain = { key: string; label: string; categories: AppMenuCategory[]; count: number };

function buildAppMenuTree(items: readonly NavItem[], labelOf: (kind: "group" | "category", key: string) => string): AppMenuDomain[] {
  const domains: AppMenuDomain[] = [];
  for (const item of items) {
    const domainKey = item.group || "workspace";
    const categoryKey = item.category || "default";
    let domain = domains.find((entry) => entry.key === domainKey);
    if (!domain) {
      domain = { key: domainKey, label: labelOf("group", domainKey), categories: [], count: 0 };
      domains.push(domain);
    }
    let category = domain.categories.find((entry) => entry.key === categoryKey);
    if (!category) {
      category = { key: categoryKey, label: labelOf("category", categoryKey), items: [] };
      domain.categories.push(category);
    }
    category.items.push(item);
    domain.count += 1;
  }
  return domains;
}

function MenuDisplayMenu({ prefs }: { prefs: MenuPrefs }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith("en");
  const densityOptions: MenuDensity[] = ["compact", "comfortable", "cozy"];
  const menuDisplayPresets: Array<{ key: string; label: string; desc: string; patch: Partial<MenuPrefs> }> = [
    {
      key: "simple",
      label: isEn ? "Simple" : "简单",
      desc: isEn ? "Quiet chrome, AI and quick access first" : "界面更轻，优先保留 AI 与快捷入口",
      patch: { density: "comfortable", menuLayout: "minimal", menuEffect: "quiet", showQuickPanel: true, showMenuCounts: false, showMenuMeta: false },
    },
    {
      key: "work",
      label: isEn ? "Work" : "专业",
      desc: isEn ? "Dense scanning for daily operations" : "适合日常运营，信息密度更高",
      patch: { density: "compact", menuLayout: "stream", menuEffect: "quiet", showQuickPanel: true, showMenuCounts: true, showMenuMeta: false },
    },
    {
      key: "full",
      label: isEn ? "Full" : "完整",
      desc: isEn ? "Show hierarchy, badges and helper text" : "展示层级、徽标和能力说明",
      patch: { density: "comfortable", menuLayout: "grouped", menuEffect: "soft", showQuickPanel: true, showMenuCounts: true, showMenuMeta: true },
    },
  ];
  const layoutOptions: Array<{ key: MenuLayout; label: string; desc: string }> = [
    { key: "grouped", label: isEn ? "Grouped cards" : "分组卡片", desc: isEn ? "Clear hierarchy for module-rich apps" : "层级最清晰，适合模块多的应用" },
    { key: "stream", label: isEn ? "Continuous list" : "连续列表", desc: isEn ? "Fewer card edges, smoother scanning" : "减少卡片边界，浏览更顺滑" },
    { key: "minimal", label: isEn ? "Minimal" : "极简模式", desc: isEn ? "Quiet chrome, keep path and levels" : "弱化装饰，保留路径和层级" },
  ];
  const effectOptions: Array<{ key: MenuEffect; label: string }> = [
    { key: "soft", label: isEn ? "Soft" : "柔和" },
    { key: "outline", label: isEn ? "Outline" : "描边" },
    { key: "quiet", label: isEn ? "Quiet" : "安静" },
  ];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2.5 text-[11px] font-medium text-[var(--muted-strong)] shadow-sm hover:bg-[var(--surface-muted)]"
          title="菜单显示设置"
          aria-label="菜单显示设置"
        >
          <Sliders className="h-3 w-3" />
          <span>{t(`nav.density.${prefs.density}`)}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 w-72 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-2xl"
          sideOffset={6}
          align="end"
        >
          <div className="mb-2 px-1">
            <p className="text-sm font-semibold text-[var(--text)]">{isEn ? "Menu display" : "菜单显示"}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{isEn ? "Use presets first, tune details only when needed." : "优先使用预设，需要时再细调。"}</p>
          </div>

          <div className="menuDisplayPresets grid gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-1">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{isEn ? "Presets" : "预设"}</p>
            {menuDisplayPresets.map((preset) => {
              const active = Object.entries(preset.patch).every(([key, value]) => prefs[key as keyof MenuPrefs] === value);
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => patchMenuPrefs(preset.patch)}
                  className={`flex items-start gap-2 rounded-xl px-2.5 py-2 text-left ${active ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--muted-strong)] hover:bg-[var(--surface)]"}`}
                >
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{preset.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">{preset.desc}</span>
                  </span>
                  {active ? <Check className="mt-0.5 h-3.5 w-3.5" /> : null}
                </button>
              );
            })}
          </div>

          <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-1">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{isEn ? "Density" : "密度"}</p>
            <div className="grid grid-cols-3 gap-1">
              {densityOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => patchMenuPrefs({ density: opt })}
                  className={`rounded-lg px-2 py-1.5 text-xs font-medium ${prefs.density === opt ? "bg-[var(--surface)] text-[var(--brand)] shadow-sm" : "text-[var(--muted-strong)] hover:bg-[var(--surface)]"}`}
                >
                  {t(`nav.density.${opt}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 grid gap-1">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{isEn ? "Layout" : "布局"}</p>
            {layoutOptions.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => patchMenuPrefs({ menuLayout: opt.key })}
                className={`flex items-start gap-2 rounded-xl px-2.5 py-2 text-left ${prefs.menuLayout === opt.key ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"}`}
              >
                <Rows3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">{opt.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">{opt.desc}</span>
                </span>
                {prefs.menuLayout === opt.key ? <Check className="mt-0.5 h-3.5 w-3.5" /> : null}
              </button>
            ))}
          </div>

          <div className="mt-2 rounded-xl border border-[var(--border)] p-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{isEn ? "Style" : "效果"}</p>
            <div className="grid grid-cols-3 gap-1">
              {effectOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => patchMenuPrefs({ menuEffect: opt.key })}
                  className={`rounded-lg px-2 py-1.5 text-xs font-medium ${prefs.menuEffect === opt.key ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="mt-2 grid gap-1">
              {[
                { key: "showQuickPanel", label: isEn ? "Quick panel" : "快捷区" },
                { key: "showMenuCounts", label: isEn ? "Badges" : "计数徽标" },
                { key: "showMenuMeta", label: isEn ? "Descriptions" : "能力说明" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => patchMenuPrefs({ [item.key]: !prefs[item.key as keyof MenuPrefs] } as Partial<MenuPrefs>)}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                >
                  <span>{item.label}</span>
                  <span className={`h-4 w-7 rounded-full p-0.5 transition ${prefs[item.key as keyof MenuPrefs] ? "bg-[var(--brand)]" : "bg-[var(--border)]"}`}>
                    <span className={`block h-3 w-3 rounded-full bg-white transition ${prefs[item.key as keyof MenuPrefs] ? "translate-x-3" : ""}`} />
                  </span>
                </button>
              ))}
            </div>
          </div>
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
  const [mobileNavKeyword, setMobileNavKeyword] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [activeMicroApp, setActiveMicroApp] = useState<MicroAppId>(() => {
    try {
      const stored = localStorage.getItem(MICRO_APP_STORAGE_KEY);
      const matched = MICRO_APPS.find((app) => app.id === stored);
      return matched?.id ?? DEFAULT_MICRO_APP_ID;
    } catch {
      return DEFAULT_MICRO_APP_ID;
    }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) || SIDEBAR_DEFAULT_WIDTH);
      return clampSidebarWidth(Number.isFinite(raw) ? raw : SIDEBAR_DEFAULT_WIDTH);
    } catch {
      return SIDEBAR_DEFAULT_WIDTH;
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
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(CATEGORY_COLLAPSE_STORAGE_KEY);
      if (!raw) return DEFAULT_CATEGORY_COLLAPSE;
      return { ...DEFAULT_CATEGORY_COLLAPSE, ...(JSON.parse(raw) as Record<string, boolean>) };
    } catch {
      return DEFAULT_CATEGORY_COLLAPSE;
    }
  });
  const [collapsedModules, setCollapsedModules] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(MODULE_COLLAPSE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const [expandedMicroApps, setExpandedMicroApps] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(MICRO_APP_EXPANDED_STORAGE_KEY) || "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const [menuPrefs, setMenuPrefs] = useState<MenuPrefs>(() => getMenuPrefs());
  const [quickPanel, setQuickPanel] = useState<QuickPanelKey | null>(null);
  const lastRecentKeyRef = useRef<string | null>(null);
  const lastSyncedRecentSignatureRef = useRef("");
  useEffect(() => subscribeMenuPrefs(setMenuPrefs), []);
  const authed = Boolean(getToken());
  const me = useQuery({ queryKey: ["authMe"], queryFn: appShellApi.authMe, enabled: authed, retry: false });
  const menuPrefsRemote = useQuery({
    queryKey: ["systemPagesMenuPreferencesMe"],
    queryFn: appShellApi.systemPagesMenuPreferencesMe,
    enabled: authed,
    retry: false,
  });
  const syncMenuPrefs = useMutation({
    mutationFn: appShellApi.systemPagesMenuPreferencesUpdate,
  });
  const capabilities = useCapabilities();

  useEffect(() => {
    const h = () => {
      if (applyHashNormalization()) return;
      setHash(window.location.hash || "#/dashboard");
      setMobileNavOpen(false);
    };
    h();
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if ([TOKEN_KEY, PROJECT_ID_KEY, TENANT_CODE_KEY, BUSINESS_CODE_KEY, PROJECT_CODE_KEY].includes(e.key || "")) bump((x) => x + 1);
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
    try {
      localStorage.setItem(MICRO_APP_EXPANDED_STORAGE_KEY, JSON.stringify(expandedMicroApps));
    } catch {
      /* ignore disabled storage */
    }
  }, [expandedMicroApps]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!sidebarCollapsed) localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarCollapsed, sidebarWidth]);

  useEffect(() => {
    let lastG = 0;
    const isEditing = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };
    const onKeyDown = (e: KeyboardEvent) => {
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
      if (isEditing()) return;
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        lastG = Date.now();
        return;
      }
      if (lastG && Date.now() - lastG < 900) {
        const map: Record<string, string> = {
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

  const managerAuthOptional = MANAGER_AUTH_OPTIONAL_HASHES.has(hash);

  useEffect(() => {
    if (!authed && !managerAuthOptional) {
      const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.replace(`/login.html?redirect=${encodeURIComponent(redirect)}`);
    }
  }, [authed, managerAuthOptional]);

  useEffect(() => {
    if (me.data) setUserSession(me.data, { preserveWorkspace: true });
  }, [me.data]);

  const humanizeNavKey = (key: string) =>
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  const navLabel = (key: string) => String(t(`nav.${key}`, { defaultValue: humanizeNavKey(key) }));
  const navTaxonomyLabel = (kind: "group" | "category", key: string) => {
    const i18nKey = kind === "category" ? NAV_CATEGORY_I18N_BY_KEY.get(key) ?? `nav.category.${key}` : `nav.group.${key}`;
    return String(t(i18nKey, { defaultValue: humanizeNavKey(key) }));
  };

  const currentRole = capabilities.role || String(me.data?.role || "viewer");
  const menuStrategy = menuPrefsRemote.data?.strategy;
  const capabilityItems = capabilities.items.length ? capabilities.items : capabilities.visibleItems;
  const roleVisibleNav = useMemo(
    () => filterNavByRole(currentRole, capabilityItems),
    [capabilityItems, currentRole],
  );
  const navSource = roleVisibleNav.length ? roleVisibleNav : NAV;
  const routeMicroApp = useMemo(() => getMicroAppIdFromHash(hash, navSource), [hash, navSource]);
  const visibleNav = useMemo(() => {
    return filterNavByMicroApp(activeMicroApp, navSource);
  }, [activeMicroApp, navSource]);
  const current = findActiveNavItem(hash, visibleNav.length ? visibleNav : undefined);
  const activeAppDefinition = useMemo(
    () => MICRO_APPS.find((app) => app.id === activeMicroApp) ?? MICRO_APPS[0],
    [activeMicroApp],
  );
  const appPortalItem = useMemo(
    () => visibleNav.find((item) => item.key.startsWith("microApp")),
    [visibleNav],
  );
  const appSidebarItems = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return visibleNav.filter((item) => {
      if (item.hidden || item.parentKey || item.key.startsWith("microApp")) return false;
      if (!normalized) return true;
      const label = navLabel(item.key);
      return `${label} ${item.description || ""} ${item.capability || ""} ${item.path}`.toLowerCase().includes(normalized);
    });
  }, [keyword, t, visibleNav]);
  const microAppMenuById = useMemo(() => {
    const map = new Map<MicroAppId, NavItem[]>();
    for (const app of MICRO_APPS) {
      map.set(
        app.id,
        filterNavByMicroApp(app.id, navSource).filter((item) => !item.hidden && !item.parentKey && !item.key.startsWith("microApp")),
      );
    }
    return map;
  }, [navSource]);
  const microAppMenuTreeById = useMemo(() => {
    const map = new Map<MicroAppId, AppMenuDomain[]>();
    for (const app of MICRO_APPS) {
      map.set(app.id, buildAppMenuTree(microAppMenuById.get(app.id) ?? [], navTaxonomyLabel));
    }
    return map;
  }, [microAppMenuById, t]);
  const microAppChildrenByParent = useMemo(() => {
    const out = new Map<string, NavItem[]>();
    for (const item of navSource) {
      if (!item.parentKey || item.hidden) continue;
      const rows = out.get(item.parentKey) ?? [];
      rows.push(item);
      out.set(item.parentKey, rows);
    }
    return out;
  }, [navSource]);
  const pinnedItems = useMemo(() => pinnedNavItems(visibleNav), [visibleNav]);
  const quickAccessItems = useMemo(() => {
    const manual = resolveNavKeys(menuPrefs.quickAccess, visibleNav);
    return manual.length ? manual : pinnedItems;
  }, [menuPrefs.quickAccess, pinnedItems, visibleNav]);
  const favoriteItems = useMemo(() => resolveNavKeys(menuPrefs.favorites, visibleNav), [menuPrefs.favorites, visibleNav]);
  const recentItems = useMemo(
    () => resolveNavKeys(menuPrefs.recents, visibleNav).filter((item) => item.key !== current.key).slice(0, 6),
    [menuPrefs.recents, visibleNav, current.key],
  );
  const favoriteSet = useMemo(() => new Set(menuPrefs.favorites), [menuPrefs.favorites]);
  const quickAccessSet = useMemo(() => new Set(menuPrefs.quickAccess), [menuPrefs.quickAccess]);
  const currentFavorite = favoriteSet.has(current.key);
  const currentQuickAccess = quickAccessSet.has(current.key);
  const breadcrumb = useMemo(() => buildNavBreadcrumb(hash, navLabel, visibleNav), [hash, navLabel, visibleNav]);
  const densityCls = densityPadding(menuPrefs.density);
  const isReadOnlyCurrent = current.capability ? capabilityReadOnly(capabilities.get(current.capability), capabilities.status, capabilities.role) : false;
  const quickPanelItems = quickPanel === "favorites" ? favoriteItems : quickPanel === "recents" ? recentItems : quickAccessItems;
  const quickPanelTitle = quickPanel === "favorites" ? t("nav.favorites") : quickPanel === "recents" ? t("nav.recents") : t("nav.pinned");
  const mobileCoreActions = useMemo(
    () => [
      { key: "dashboard", path: "#/dashboard", icon: Rows3, label: navLabel("dashboard") },
      { key: "tasks", path: "#/tasks", icon: Check, label: navLabel("tasks") },
      { key: "copilot", path: "#/copilot", icon: Bot, label: navLabel("copilot") },
      { key: "alerts", path: "#/intelligence/usage", icon: Sparkles, label: t("nav.mobileAlerts", { defaultValue: "告警" }) },
      { key: "im", path: "#/notify/inbound", icon: MessageSquareText, label: t("nav.mobileIm", { defaultValue: "IM" }) },
    ],
    [navLabel, t],
  );

  useEffect(() => {
    if (routeMicroApp && routeMicroApp !== activeMicroApp) setActiveMicroApp(routeMicroApp);
  }, [activeMicroApp, routeMicroApp]);

  useEffect(() => {
    try {
      localStorage.setItem(MICRO_APP_STORAGE_KEY, activeMicroApp);
    } catch {
      /* ignore disabled storage */
    }
  }, [activeMicroApp]);

  useEffect(() => {
    const prefs = menuPrefsRemote.data?.preferences;
    if (!authed || !prefs) return;
    const scope = `${ROLE_DEFAULT_STORAGE_KEY}:${currentRole}:${String(me.data?.username || me.data?.user_id || "user")}`;
    try {
      if (localStorage.getItem(scope) === "1") return;
      setCollapsedGroups({ ...DEFAULT_COLLAPSE, ...(prefs.collapsed_groups || {}) });
      setCollapsedCategories({ ...DEFAULT_CATEGORY_COLLAPSE, ...(prefs.collapsed_categories || {}) });
      setCollapsedModules(prefs.collapsed_modules || {});
      patchMenuPrefs({
        favorites: Array.isArray(prefs.favorites) ? prefs.favorites : menuPrefs.favorites,
        quickAccess: Array.isArray(prefs.quick_access) ? prefs.quick_access : menuPrefs.quickAccess,
        recents: Array.isArray(prefs.recents) ? prefs.recents : menuPrefs.recents,
        density: prefs.density || menuPrefs.density,
        showRecents: typeof prefs.show_recents === "boolean" ? prefs.show_recents : menuPrefs.showRecents,
        showFavorites: typeof prefs.show_favorites === "boolean" ? prefs.show_favorites : menuPrefs.showFavorites,
        menuLayout: prefs.menu_layout || menuPrefs.menuLayout,
        menuEffect: prefs.menu_effect || menuPrefs.menuEffect,
        showMenuCounts: typeof prefs.show_menu_counts === "boolean" ? prefs.show_menu_counts : menuPrefs.showMenuCounts,
        showMenuMeta: typeof prefs.show_menu_meta === "boolean" ? prefs.show_menu_meta : menuPrefs.showMenuMeta,
        showQuickPanel: typeof prefs.show_quick_panel === "boolean" ? prefs.show_quick_panel : menuPrefs.showQuickPanel,
      });
      localStorage.setItem(scope, "1");
    } catch {
      /* ignore disabled storage */
    }
  }, [authed, currentRole, me.data?.user_id, me.data?.username, menuPrefs.density, menuPrefs.favorites, menuPrefs.menuEffect, menuPrefs.menuLayout, menuPrefs.quickAccess, menuPrefs.recents, menuPrefs.showFavorites, menuPrefs.showMenuCounts, menuPrefs.showMenuMeta, menuPrefs.showQuickPanel, menuPrefs.showRecents, menuPrefsRemote.data?.preferences]);

  useEffect(() => {
    if (!authed || !menuPrefsRemote.data?.ok) return;
    const timer = window.setTimeout(() => {
      syncMenuPrefs.mutate({
        favorites: menuPrefs.favorites,
        quick_access: menuPrefs.quickAccess,
        recents: menuPrefs.recents,
        density: menuPrefs.density,
        show_recents: menuPrefs.showRecents,
        show_favorites: menuPrefs.showFavorites,
        menu_layout: menuPrefs.menuLayout,
        menu_effect: menuPrefs.menuEffect,
        show_menu_counts: menuPrefs.showMenuCounts,
        show_menu_meta: menuPrefs.showMenuMeta,
        show_quick_panel: menuPrefs.showQuickPanel,
        collapsed_groups: collapsedGroups,
        collapsed_categories: collapsedCategories,
        collapsed_modules: collapsedModules,
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [authed, collapsedCategories, collapsedGroups, collapsedModules, menuPrefs.density, menuPrefs.favorites, menuPrefs.menuEffect, menuPrefs.menuLayout, menuPrefs.quickAccess, menuPrefs.recents, menuPrefs.showFavorites, menuPrefs.showMenuCounts, menuPrefs.showMenuMeta, menuPrefs.showQuickPanel, menuPrefs.showRecents, menuPrefsRemote.data?.ok]);

  useEffect(() => {
    if (!current?.key) return;
    const next = lastRecentKeyRef.current === current.key ? getMenuPrefs() : pushRecent(current.key);
    lastRecentKeyRef.current = current.key;
    if (menuPrefsRemote.data?.ok) {
      const signature = next.recents.join("\u001f");
      if (signature !== lastSyncedRecentSignatureRef.current) {
        lastSyncedRecentSignatureRef.current = signature;
        syncMenuPrefs.mutate({ recents: next.recents });
      }
    }
  }, [current?.key, menuPrefsRemote.data?.ok]);
  const childrenByParent = useMemo(() => {
    const out = new Map<string, NavItem[]>();
    for (const item of visibleNav) {
      if (!item.parentKey || item.hidden) continue;
      const rows = out.get(item.parentKey) ?? [];
      rows.push(item);
      out.set(item.parentKey, rows);
    }
    return out;
  }, [visibleNav]);

  useEffect(() => {
    if (!visibleNav.length) return;
    if (routeMicroApp !== activeMicroApp) return;
    const activeAllowed = visibleNav.some((item) => !item.external && item.path.startsWith("#") && hash.startsWith(item.path));
    if (!activeAllowed) {
      const fallback = visibleNav.find((item) => item.path.startsWith("#")) ?? visibleNav[0];
      if (fallback?.path?.startsWith("#") && window.location.hash !== fallback.path) window.location.hash = fallback.path;
    }
  }, [activeMicroApp, hash, routeMicroApp, visibleNav]);
  const openModuleCopilot = () => {
    const label = navLabel(current.key);
    const group = String(t(`nav.group.${current.group}`));
    sessionStorage.setItem(
      "sop-copilot-prefill",
      t("command.moduleAiPrompt", {
        module: label,
        group,
        capability: current.capability || current.key,
        path: current.path,
      }),
    );
    window.location.hash = "#/copilot";
  };

  const toggleModule = (moduleKey: string) => {
    setCollapsedModules((prev) => ({ ...prev, [moduleKey]: !prev[moduleKey] }));
  };
  const chooseMicroApp = (appId: MicroAppId, route: string) => {
    setActiveMicroApp(appId);
    setExpandedMicroApps((prev) => ({ ...prev, [appId]: true }));
    setKeyword("");
    setQuickPanel(null);
    window.location.hash = route;
  };
  const toggleMicroAppMenu = (appId: MicroAppId) => {
    setExpandedMicroApps((prev) => ({ ...prev, [appId]: !prev[appId] }));
  };
  const startSidebarResize = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (sidebarCollapsed) return;
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (move: MouseEvent) => {
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

  if (!authed && managerAuthOptional) {
    const standaloneCurrent = findActiveNavItem(hash, NAV);
    return (
      <div className="min-h-screen bg-[var(--app-bg)] text-[var(--text)]">
        <main className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-6 lg:px-8">
          <header className="mb-4 flex flex-wrap items-center justify-end gap-3 border-b border-[var(--border)] pb-4">
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
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
              <UserMenu authed={false} />
            </div>
          </header>
          <div className="hermes-mobile-compact w-full" data-mobile-compact="true">{standaloneCurrent.el}</div>
        </main>
      </div>
    );
  }
  if (!authed) return null;
  const sidebarStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;
  const showMenuCounts = menuPrefs.showMenuCounts;
  const showMenuMeta = menuPrefs.showMenuMeta;
  const showQuickPanel = menuPrefs.showQuickPanel;
  const menuSectionClass =
    menuPrefs.menuLayout === "minimal"
      ? "rounded-lg border border-transparent bg-transparent p-0"
      : menuPrefs.menuEffect === "outline"
        ? "rounded-xl border border-[var(--border)] bg-transparent p-1"
        : menuPrefs.menuEffect === "quiet"
          ? "rounded-xl border border-transparent bg-transparent p-1"
          : "rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2";
  const menuCategoryClass =
    menuPrefs.menuLayout === "minimal"
      ? "rounded-md bg-transparent p-0.5"
      : menuPrefs.menuLayout === "stream"
        ? "rounded-lg border-l border-[var(--border)] bg-transparent p-1"
        : "rounded-md border border-[var(--border)]/50 bg-[var(--surface-raised)]/45 p-1";

  return (
    <div className="flex min-h-screen flex-col bg-[var(--app-bg)] text-[var(--text)] lg:h-screen lg:min-h-0 lg:overflow-hidden lg:flex-row">
      {commandOpen ? (
        <Suspense fallback={null}>
          <CommandPaletteLazy open={commandOpen} setOpen={setCommandOpen} authed={authed} />
        </Suspense>
      ) : null}
      {mobileNavOpen ? (
        <Suspense fallback={null}>
          <MobileNavDrawerLazy
            open={mobileNavOpen}
            onOpenChange={setMobileNavOpen}
            activeAppName={activeAppDefinition.name}
            activeMicroApp={activeMicroApp}
            current={current}
            hash={hash}
            keyword={mobileNavKeyword}
            onKeywordChange={setMobileNavKeyword}
            onOpenCommand={() => setCommandOpen(true)}
            mobileCoreActions={mobileCoreActions}
            microAppMenuById={microAppMenuById}
            navLabel={navLabel}
            chooseMicroApp={chooseMicroApp}
          />
        </Suspense>
      ) : null}
      <aside
        style={sidebarStyle}
        className={`relative hidden min-h-0 w-full shrink-0 flex-col border-b border-[var(--nav-border)] bg-[var(--nav-bg)] shadow-sm backdrop-blur-xl transition-[width] duration-200 lg:sticky lg:top-0 lg:flex lg:h-screen lg:border-b-0 lg:border-r ${
          sidebarCollapsed ? "lg:w-20" : "lg:w-[var(--sidebar-width)]"
        }`}
      >
        <div className={`border-b border-[var(--nav-border)] ${sidebarCollapsed ? "px-3 py-4" : "px-5 py-4"}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-lg font-bold tracking-tight text-[var(--brand)]">
                {sidebarCollapsed ? "H" : "Hermes"}
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

        {!sidebarCollapsed ? (
          <div className="border-b border-[var(--nav-border)] px-3 py-3">
            <div className="px-1">
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

            {!keyword && showQuickPanel ? (
              <div className="mt-2 rounded-xl border border-[var(--border)]/70 bg-[var(--surface-raised)]/45 p-1.5">
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { key: "pinned" as const, icon: Pin, label: t("nav.pinned"), count: quickAccessItems.length, enabled: quickAccessItems.length > 0 },
                    { key: "favorites" as const, icon: Star, label: t("nav.favorites"), count: favoriteItems.length, enabled: menuPrefs.showFavorites },
                    { key: "recents" as const, icon: Clock, label: t("nav.recents"), count: recentItems.length, enabled: menuPrefs.showRecents },
                  ].map((entry) => {
                    const Icon = entry.icon;
                    const active = quickPanel === entry.key;
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        disabled={!entry.enabled}
                        onClick={() => setQuickPanel((value) => (value === entry.key ? null : entry.key))}
                        className={`flex min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          active
                            ? "bg-[var(--nav-active)] text-[var(--brand)] ring-1 ring-[var(--brand)]/25"
                            : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"
                        }`}
                        title={entry.label}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{entry.label}</span>
                        {showMenuCounts ? <span className="rounded bg-[var(--surface-muted)] px-1 font-mono text-[10px] text-[var(--muted-strong)]">{entry.count}</span> : null}
                      </button>
                    );
                  })}
                </div>
                {quickPanel ? (
                  <div className="mt-1.5 border-t border-[var(--border)]/70 pt-1.5">
                    <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--nav-muted)]">
                      <span>{quickPanelTitle}</span>
                      {quickPanel === "recents" && recentItems.length ? (
                        <button
                          type="button"
                          onClick={() => patchMenuPrefs({ recents: [] })}
                          className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                          title={t("nav.clearRecents")}
                          aria-label={t("nav.clearRecents")}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                    <div className="hermes-scrollbar grid max-h-28 grid-cols-2 gap-1 overflow-y-auto pr-1">
                      {quickPanelItems.length ? quickPanelItems.map((item) => {
                        const Icon = item.icon;
                        const active = current.key === item.key || current.parentKey === item.key;
                        return (
                          <a
                            key={`${quickPanel}-${item.key}`}
                            href={item.path}
                            className={`group flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition ${
                              active
                                ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]"
                                : "text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--nav-text)]"
                            }`}
                            title={item.shortcut ? `${navLabel(item.key)} (${item.shortcut})` : navLabel(item.key)}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{navLabel(item.key)}</span>
                            {showMenuCounts ? <NavBadgeTag badge={item.badge} /> : null}
                          </a>
                        );
                      }) : (
                        <div className="col-span-2 rounded-md border border-dashed border-[var(--border)] px-2 py-2 text-center text-[11px] text-[var(--nav-muted)]">
                          {t("nav.quickEmpty")}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {!sidebarCollapsed && !keyword ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-[var(--nav-border)] px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--nav-muted)]">
                <Layers3 className="h-3.5 w-3.5" />
                {t("nav.microAppView")}
              </span>
              <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--muted-strong)]">
                {t("nav.microAppMode")}
              </span>
            </div>
            <div className="hermes-scrollbar hermes-scroll-shadow grid min-h-0 flex-1 gap-1 overflow-y-auto py-1 pr-2">
              {MICRO_APPS.map((app) => {
                const active = app.id === activeMicroApp;
                const appMenus = microAppMenuById.get(app.id) ?? [];
                const appMenuTree = microAppMenuTreeById.get(app.id) ?? [];
                const expanded = Boolean(expandedMicroApps[app.id] ?? active);
                const portalItem = navSource.find((item) => item.key.startsWith("microApp") && getMicroAppIdForNavItem(item) === app.id);
                return (
                  <div
                    key={app.id}
                    className={`rounded-xl border transition ${
                      active ? "border-[var(--brand)]/45 bg-[var(--nav-active)] ring-1 ring-[var(--brand)]/25" : "border-transparent bg-transparent hover:border-[var(--border)] hover:bg-[var(--surface-raised)]/45"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-1 p-1">
                      <button
                        type="button"
                        onClick={() => chooseMicroApp(app.id, app.route)}
                        className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs transition ${
                          active ? "font-semibold text-[var(--brand)]" : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"
                        }`}
                        title={app.name}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{app.shortName}</span>
                          {showMenuMeta ? <span className="mt-0.5 block truncate text-[10px] font-normal text-[var(--nav-muted)]">{app.owner}</span> : null}
                        </span>
                        {showMenuCounts ? <span className="shrink-0 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted-strong)]">
                          {appMenus.length}
                        </span> : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleMicroAppMenu(app.id)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                        title={expanded ? "收起子应用菜单" : "展开子应用菜单"}
                        aria-label={expanded ? "收起子应用菜单" : "展开子应用菜单"}
                      >
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </div>

                    {expanded ? (
                      <div className="mx-1 mb-2 grid gap-1 border-t border-[var(--border)]/70 pt-2">
                        {portalItem ? (
                          <a
                            href={portalItem.path}
                            onClick={() => {
                              setActiveMicroApp(app.id);
                              setKeyword("");
                              setQuickPanel(null);
                            }}
                            className={`mx-1 flex items-center justify-between rounded-lg px-2 py-2 text-xs font-semibold ${
                              active ? "bg-[var(--brand)] text-white hover:opacity-90" : "bg-[var(--brand-soft)] text-[var(--brand)] hover:bg-[var(--surface-muted)]"
                            }`}
                          >
                            <span>{app.mode === "standalone" ? "打开微应用门户" : "进入应用管理台"}</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                        <div className="grid gap-2">
                          {appMenuTree.map((domain) => {
                            const domainKey = `main-domain:${app.id}:${domain.key}`;
                            const domainOpen = !collapsedCategories[domainKey] || active;
                            return (
                              <section key={domain.key} className={menuSectionClass}>
                                <button
                                  type="button"
                                  onClick={() => setCollapsedCategories((prev) => ({ ...prev, [domainKey]: !prev[domainKey] }))}
                                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-semibold text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                                >
                                  {domainOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  <span className="min-w-0 flex-1 truncate">{domain.label}</span>
                                  {showMenuCounts ? <span className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{domain.count}</span> : null}
                                </button>
                                {domainOpen ? (
                                  <div className="mt-1 grid gap-1">
                                    {domain.categories.map((category) => {
                                      const categoryKey = `main-category:${app.id}:${domain.key}:${category.key}`;
                                      const categoryOpen = !collapsedCategories[categoryKey] || active;
                                      return (
                                        <div key={category.key} className={menuCategoryClass}>
                                          <button
                                            type="button"
                                            onClick={() => setCollapsedCategories((prev) => ({ ...prev, [categoryKey]: !prev[categoryKey] }))}
                                            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] font-semibold text-[var(--nav-muted)] hover:bg-[var(--surface-muted)]"
                                          >
                                            {categoryOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                            <span className="min-w-0 flex-1 truncate">{category.label}</span>
                                            {showMenuCounts ? <span>{category.items.length}</span> : null}
                                          </button>
                                          {categoryOpen ? (
                                            <div className="mt-0.5 grid gap-0.5">
                                              {category.items.map((item) => {
                                                const Icon = item.icon;
                                                const itemActive = current.key === item.key || current.parentKey === item.key;
                                                const children = microAppChildrenByParent.get(item.key) ?? [];
                                                const itemFav = favoriteSet.has(item.key);
                                                const itemQuick = quickAccessSet.has(item.key);
                                                return (
                                                  <div key={item.key}>
                                                    <div
                                                      className={`group/appmenu flex items-center rounded-lg text-xs ${
                                                        itemActive
                                                          ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]"
                                                          : "text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--nav-text)]"
                                                      }`}
                                                    >
                                                      <a href={item.path} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
                                                        <Icon className="h-3.5 w-3.5 shrink-0" />
                                                        <span className="min-w-0 flex-1 truncate">{navLabel(item.key)}</span>
                                                        {showMenuCounts ? <NavBadgeTag badge={item.badge} /> : null}
                                                      </a>
                                                      {item.pinnable !== false ? (
                                                        <div className="mr-1 flex shrink-0 items-center">
                                                          <QuickAccessToggle
                                                            navKey={item.key}
                                                            isQuick={itemQuick}
                                                            className={itemQuick ? "opacity-100" : "opacity-0 group-hover/appmenu:opacity-100 focus-visible:opacity-100"}
                                                          />
                                                          <FavoriteToggle
                                                            navKey={item.key}
                                                            isFav={itemFav}
                                                            className={itemFav ? "opacity-100" : "opacity-0 group-hover/appmenu:opacity-100 focus-visible:opacity-100"}
                                                          />
                                                        </div>
                                                      ) : null}
                                                    </div>
                                                    {itemActive && children.length ? (
                                                      <div className="ml-5 mt-0.5 grid gap-0.5 border-l border-[var(--border)] pl-2">
                                                        {children.slice(0, 4).map((child) => {
                                                          const ChildIcon = child.icon;
                                                          const childActive = current.key === child.key;
                                                          return (
                                                            <a
                                                              key={child.key}
                                                              href={child.path}
                                                              className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
                                                                childActive ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]" : "text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--nav-text)]"
                                                              }`}
                                                            >
                                                              <ChildIcon className="h-3 w-3 shrink-0" />
                                                              <span className="min-w-0 flex-1 truncate">{navLabel(child.key)}</span>
                                                            </a>
                                                          );
                                                        })}
                                                      </div>
                                                    ) : null}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </section>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {sidebarCollapsed || keyword ? (
        <nav className={`hermes-scrollbar hermes-scroll-shadow mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto py-1 pb-3 ${sidebarCollapsed ? "px-2" : "px-2 pr-3"}`}>
          {!sidebarCollapsed && keyword ? (
            <div className="mb-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--text)]">{activeAppDefinition.name}</p>
                  {showMenuMeta ? <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{activeAppDefinition.owner}</p> : null}
                </div>
                {showMenuCounts ? <span className="rounded-md bg-[var(--brand-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--brand)]">
                  {activeAppDefinition.mode}
                </span> : null}
              </div>
              {showMenuMeta ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted-strong)]">{activeAppDefinition.description}</p> : null}
              {appPortalItem ? (
                <a
                  href={appPortalItem.path}
                  className="mt-3 flex items-center justify-between rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
                >
                  <span>{activeAppDefinition.mode === "standalone" ? "打开微应用门户" : "进入应用管理台"}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          ) : null}
          {appSidebarItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {t("nav.searchEmpty")}
            </div>
          ) : (
            <div className="space-y-1">
              {appSidebarItems.map((n) => {
                const Icon = n.icon;
                const children = childrenByParent.get(n.key) ?? [];
                const parentActive = current.key === n.key || current.parentKey === n.key;
                const moduleOpen = Boolean(keyword) || parentActive || !collapsedModules[n.key];
                const isFav = favoriteSet.has(n.key);
                const isQuick = quickAccessSet.has(n.key);
                const canWrite = n.capability ? capabilities.can(n.capability, "write") : true;
              return (
                <div key={n.key} className="group/nav">
                  <div
                    className={`flex items-center rounded-lg text-sm transition ${
                      parentActive
                        ? "bg-[var(--nav-active)] font-semibold text-[var(--brand)] shadow-sm ring-1 ring-[var(--brand)]"
                        : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"
                    }`}
                  >
                    <a
                      href={n.path}
                      title={sidebarCollapsed ? (n.shortcut ? `${navLabel(n.key)} (${n.shortcut})` : navLabel(n.key)) : undefined}
                      className={`min-w-0 flex-1 items-center ${sidebarCollapsed ? `flex justify-center px-2 ${densityCls.item}` : `flex gap-2.5 px-3 ${densityCls.item}`}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!sidebarCollapsed ? (
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                          <span className="min-w-0 flex-1 truncate">{navLabel(n.key)}</span>
                          {!canWrite ? <Lock className="h-3 w-3 shrink-0 text-[var(--muted)]" aria-label={t("nav.readOnly")} /> : null}
                          {showMenuCounts ? <NavBadgeTag badge={n.badge} /> : null}
                        </span>
                      ) : null}
                    </a>
                    {!sidebarCollapsed && n.pinnable !== false ? (
                      <QuickAccessToggle
                        navKey={n.key}
                        isQuick={isQuick}
                        className={`transition ${
                          isQuick ? "opacity-100" : "opacity-0 group-hover/nav:opacity-100 focus-visible:opacity-100"
                        }`}
                      />
                    ) : null}
                    {!sidebarCollapsed && n.pinnable !== false ? (
                      <FavoriteToggle
                        navKey={n.key}
                        isFav={isFav}
                        className={`mr-1 transition ${
                          isFav ? "opacity-100" : "opacity-0 group-hover/nav:opacity-100 focus-visible:opacity-100"
                        }`}
                      />
                    ) : null}
                    {!sidebarCollapsed && children.length ? (
                      <button
                        type="button"
                        onClick={() => toggleModule(n.key)}
                        className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                        aria-label={moduleOpen ? t("nav.collapseModule") : t("nav.expandModule")}
                        title={moduleOpen ? t("nav.collapseModule") : t("nav.expandModule")}
                      >
                        {moduleOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    ) : null}
                  </div>
                  {!sidebarCollapsed && children.length && moduleOpen ? (
                    <div className="ml-7 mt-1 grid gap-0.5 border-l border-[var(--border)] pl-2">
                      {children.map((child) => {
                        const ChildIcon = child.icon;
                        const childActive = current.key === child.key;
                        const childFav = favoriteSet.has(child.key);
                        const childQuick = quickAccessSet.has(child.key);
                        const childCanWrite = child.capability ? capabilities.can(child.capability, "write") : true;
                        return (
                          <div
                            key={child.key}
                            className={`group/child flex items-center rounded-md text-xs ${
                              childActive
                                ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]"
                                : "text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--nav-text)]"
                            }`}
                          >
                            <a
                              href={child.path}
                              className={`flex min-w-0 flex-1 items-center gap-2 px-2 ${densityCls.child}`}
                              title={child.capability}
                            >
                              <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                              <span className="min-w-0 flex-1 truncate">{navLabel(child.key)}</span>
                              {!childCanWrite ? <Lock className="h-3 w-3 shrink-0 text-[var(--muted)]" aria-label={t("nav.readOnly")} /> : null}
                              {showMenuCounts ? <NavBadgeTag badge={child.badge} /> : null}
                            </a>
                            {child.pinnable !== false ? (
                              <QuickAccessToggle
                                navKey={child.key}
                                isQuick={childQuick}
                                className={`mr-0.5 ${
                                  childQuick ? "opacity-100" : "opacity-0 group-hover/child:opacity-100 focus-visible:opacity-100"
                                }`}
                              />
                            ) : null}
                            {child.pinnable !== false ? (
                              <FavoriteToggle
                                navKey={child.key}
                                isFav={childFav}
                                className={`mr-0.5 ${
                                  childFav ? "opacity-100" : "opacity-0 group-hover/child:opacity-100 focus-visible:opacity-100"
                                }`}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
            </div>
          )}
        </nav>
        ) : null}

        {!sidebarCollapsed ? (
          <div className="shrink-0 border-t border-[var(--nav-border)] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <MenuDisplayMenu prefs={menuPrefs} />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => patchMenuPrefs({ showFavorites: !menuPrefs.showFavorites })}
                  className={`inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] ${
                    menuPrefs.showFavorites ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "bg-[var(--control-bg)] text-[var(--muted-strong)]"
                  } hover:bg-[var(--surface-muted)]`}
                  title={t("nav.toggleFavorites")}
                >
                  <Star className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => patchMenuPrefs({ showRecents: !menuPrefs.showRecents })}
                  className={`inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] ${
                    menuPrefs.showRecents ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "bg-[var(--control-bg)] text-[var(--muted-strong)]"
                  } hover:bg-[var(--surface-muted)]`}
                  title={t("nav.toggleRecents")}
                >
                  <Clock className="h-3 w-3" />
                </button>
              </div>
            </div>
            {menuStrategy ? (
              <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-[10px]">
                <span className="min-w-0 flex-1 truncate text-[var(--nav-muted)]">
                  <span className="font-medium text-[var(--muted-strong)]">{t("nav.roleStrategy")}</span>
                  <span className="mx-1">·</span>
                  <span className="font-mono text-[var(--brand)]">{currentRole}</span>
                  <span className="mx-1">·</span>
                  {t("nav.roleHome")}: {menuStrategy.home}
                </span>
                  <button
                    type="button"
                    className="shrink-0 rounded px-1 text-[var(--brand)] hover:bg-[var(--surface)]"
                    onClick={() => {
                      const prefs = menuPrefsRemote.data?.preferences;
                      if (!prefs) return;
                      setCollapsedGroups({ ...DEFAULT_COLLAPSE, ...(prefs.collapsed_groups || {}) });
                      setCollapsedCategories({ ...DEFAULT_CATEGORY_COLLAPSE, ...(prefs.collapsed_categories || {}) });
                      setCollapsedModules(prefs.collapsed_modules || {});
                      patchMenuPrefs({
                        favorites: Array.isArray(prefs.favorites) ? prefs.favorites : menuPrefs.favorites,
                        quickAccess: Array.isArray(prefs.quick_access) ? prefs.quick_access : menuPrefs.quickAccess,
                        recents: Array.isArray(prefs.recents) ? prefs.recents : menuPrefs.recents,
                        density: prefs.density || menuPrefs.density,
                        showRecents: typeof prefs.show_recents === "boolean" ? prefs.show_recents : menuPrefs.showRecents,
                        showFavorites: typeof prefs.show_favorites === "boolean" ? prefs.show_favorites : menuPrefs.showFavorites,
                        menuLayout: prefs.menu_layout || menuPrefs.menuLayout,
                        menuEffect: prefs.menu_effect || menuPrefs.menuEffect,
                        showMenuCounts: typeof prefs.show_menu_counts === "boolean" ? prefs.show_menu_counts : menuPrefs.showMenuCounts,
                        showMenuMeta: typeof prefs.show_menu_meta === "boolean" ? prefs.show_menu_meta : menuPrefs.showMenuMeta,
                        showQuickPanel: typeof prefs.show_quick_panel === "boolean" ? prefs.show_quick_panel : menuPrefs.showQuickPanel,
                      });
                    }}
                  >
                    {t("nav.applyRoleDefaults")}
                  </button>
              </div>
            ) : null}
            <p className="mt-1 truncate px-0.5 text-[10px] text-[var(--nav-muted)]" title={t("nav.shortcutHint")}>{t("nav.shortcutHint")}</p>
          </div>
        ) : null}

        {!sidebarCollapsed ? (
          <button
            type="button"
            className="group absolute -right-1 top-0 z-20 hidden h-full w-2 cursor-col-resize items-stretch justify-center lg:flex"
            onMouseDown={startSidebarResize}
            onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
            title={t("nav.resizeSidebar")}
            aria-label={t("nav.resizeSidebar")}
          >
            <span className="my-3 w-px rounded-full bg-transparent transition group-hover:bg-[var(--brand)] group-active:bg-[var(--brand)]" />
          </button>
        ) : null}
      </aside>

      <main className="hermes-scrollbar min-w-0 flex-1 overflow-x-hidden px-3 pb-24 pt-4 sm:px-6 lg:h-screen lg:overflow-y-auto lg:px-6 lg:py-5 xl:px-8 2xl:px-10">
        <header className="sop-main-header mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4 lg:mb-6">
          <div className="sop-main-heading min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="mobile-nav-toggle"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] shadow-sm lg:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label={t("nav.openMobileMenu", { defaultValue: "打开菜单" })}
              >
                <Rows3 className="h-4 w-4" />
              </button>
              <span
                className="hidden h-5 w-1 rounded sm:inline-block"
                style={{ background: NAV_GROUP_ACCENT[current.group] }}
                aria-hidden
              />
              <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-[var(--text)] sm:text-2xl">
                {t(`page.${current.key}.title`, { defaultValue: navLabel(current.key) })}
              </h1>
              <NavBadgeTag badge={current.badge} />
              {isReadOnlyCurrent ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300"
                  title={t("nav.readOnlyHint")}
                >
                  <Lock className="h-3 w-3" />
                  {t("nav.readOnly")}
                </span>
              ) : null}
              {current.pinnable !== false ? (
                <>
                  <QuickAccessToggle navKey={current.key} isQuick={currentQuickAccess} size="md" />
                  <FavoriteToggle navKey={current.key} isFav={currentFavorite} size="md" />
                </>
              ) : null}
            </div>
            <p className="sop-main-breadcrumb mt-1 flex flex-wrap items-center gap-1 text-xs text-[var(--muted)]">
              <span>{t(breadcrumb.group.i18nKey)}</span>
              {breadcrumb.category ? (
                <>
                  <span aria-hidden>/</span>
                  <span>{t(breadcrumb.category.i18nKey, { defaultValue: humanizeNavKey(breadcrumb.category.key) })}</span>
                </>
              ) : null}
              {breadcrumb.parent ? (
                <>
                  <span aria-hidden>/</span>
                  <span>{navLabel(breadcrumb.parent.key)}</span>
                </>
              ) : null}
              <span aria-hidden>/</span>
              <span className="font-medium text-[var(--muted-strong)]">{navLabel(breadcrumb.item.key)}</span>
              {current.shortcut ? (
                <span className="ml-2 hidden items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-px font-mono text-[10px] text-[var(--muted-strong)] md:inline-flex">
                  <Sparkles className="h-3 w-3" />
                  {current.shortcut}
                </span>
              ) : null}
            </p>
          </div>
          <div className="sop-main-actions ml-auto flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              className="hidden h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm text-[var(--muted-strong)] shadow-sm hover:bg-[var(--surface-muted)] lg:inline-flex"
              onClick={() => setCommandOpen(true)}
              title={t("command.title")}
            >
              <Command className="h-4 w-4" />
              <span>{t("command.short")}</span>
            </button>
            <div className="hidden sm:block">
              <ProjectSelector />
            </div>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm text-[var(--muted-strong)] shadow-sm hover:bg-[var(--surface-muted)]"
              onClick={openModuleCopilot}
              title={t("command.moduleAi")}
            >
              <Bot className="h-4 w-4 text-[var(--brand)]" />
              <span className="hidden xl:inline">{t("command.moduleAi")}</span>
            </button>
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
        <div className="hermes-mobile-compact w-full" data-mobile-compact="true">{current.el}</div>
      </main>
      <nav
        data-testid="mobile-action-bar"
        className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]/95 p-1.5 shadow-2xl backdrop-blur-xl lg:hidden"
      >
        {mobileCoreActions.map((action) => {
          const Icon = action.icon;
          const active = hash.startsWith(action.path);
          return (
            <a
              key={action.key}
              href={action.path}
              className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] ${
                active ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]" : "text-[var(--muted-strong)]"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-full truncate">{action.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
