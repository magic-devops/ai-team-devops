/**
 * @ai_safe_edit
 *   - 新增页面：在 src/pages/ 加文件 + 在 src/navigation.tsx 注册
 *   - 改主题：tailwind.config.js brand + src/lib/theme.ts
 *   - 路由：当前用最小化 hash 路由；如需 nested route 切换到 @tanstack/react-router
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Bot,
  Clock,
  Command,
  Cpu,
  Layers3,
  Laptop,
  Lock,
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
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { ProjectSelector } from "./components/ProjectSelector";
import { api } from "./lib/api";
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
import { useCapabilities } from "./lib/capabilities";
import {
  densityPadding,
  getMenuPrefs,
  patchMenuPrefs,
  pushRecent,
  subscribeMenuPrefs,
  toggleFavorite,
  type MenuDensity,
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
  groupNavItems,
  NAV,
  NAV_GROUP_ACCENT,
  pinnedNavItems,
  resolveNavKeys,
  type NavBadge,
  type NavGroupKey,
  type NavItem,
} from "./navigation";

const COLLAPSE_STORAGE_KEY = "sop-nav-collapse-v1";
const CATEGORY_COLLAPSE_STORAGE_KEY = "sop-nav-category-collapse-v1";
const MODULE_COLLAPSE_STORAGE_KEY = "sop-nav-module-collapse-v1";
const SIDEBAR_STORAGE_KEY = "sop-sidebar-collapsed-v1";
const SIDEBAR_WIDTH_STORAGE_KEY = "sop-sidebar-width-v1";
const ROLE_DEFAULT_STORAGE_KEY = "sop-menu-role-default-v1";
const MICRO_APP_STORAGE_KEY = "sop-active-micro-app-v1";
const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 520;
type QuickPanelKey = "pinned" | "favorites" | "recents";

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

function DensityMenu({ density }: { density: MenuDensity }) {
  const { t } = useTranslation();
  const options: MenuDensity[] = ["compact", "comfortable", "cozy"];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[11px] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
          title={t("nav.density.label")}
          aria-label={t("nav.density.label")}
        >
          <Sliders className="h-3 w-3" />
          <span>{t(`nav.density.${density}`)}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[10rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg"
          sideOffset={6}
          align="end"
        >
          {options.map((opt) => (
            <DropdownMenu.Item
              key={opt}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text)] data-[highlighted]:bg-[var(--surface-muted)]"
              onSelect={() => patchMenuPrefs({ density: opt })}
            >
              <Sliders className="h-3.5 w-3.5 text-[var(--brand)]" />
              <span className="flex-1">{t(`nav.density.${opt}`)}</span>
              {density === opt ? <Check className="h-3.5 w-3.5 text-[var(--brand)]" /> : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

type PaletteItem = {
  id: string;
  type: "navigate" | "search" | "copilot" | "operation";
  label: string;
  description?: string;
  target?: string;
  prompt?: string;
  section?: string;
};

const SEARCH_TYPE_TARGETS: Record<string, string> = {
  requirements: "#/requirements",
  tasks: "#/tasks",
  issues: "#/issues",
};

function CommandPalette({ open, setOpen, authed }: { open: boolean; setOpen: (open: boolean) => void; authed: boolean }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const needle = q.trim().toLowerCase();

  const navMatches = useMemo((): PaletteItem[] => {
    if (!needle) return [];
    const rows: PaletteItem[] = [];
    for (const item of NAV) {
      if (item.hidden) continue;
      const label = t(`nav.${item.key}`, { defaultValue: item.key });
      const description = item.description || t(`page.${item.key}.desc`, { defaultValue: item.path });
      const hay = `${label} ${description} ${item.path} ${item.key}`.toLowerCase();
      if (!hay.includes(needle)) continue;
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
    const rows: PaletteItem[] = [...navMatches];
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
        type: (item.type as PaletteItem["type"]) || "copilot",
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
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const run = (item: PaletteItem) => {
    const target = String(item?.target || "#/copilot");
    const prompt = String(item?.prompt || item?.label || q || "");
    if (item?.type === "copilot") {
      sessionStorage.setItem("sop-copilot-prefill", prompt);
      window.location.hash = "#/copilot";
    } else if (target.startsWith("#")) {
      window.location.hash = target;
    } else {
      sessionStorage.setItem("sop-copilot-prefill", `请检查 ${item?.label || target}，目标接口：${target}`);
      window.location.hash = "#/copilot";
    }
    setOpen(false);
  };

  const paletteIcon = (type: PaletteItem["type"]) => {
    if (type === "navigate") return <Rows3 className="h-4 w-4" />;
    if (type === "search") return <Search className="h-4 w-4" />;
    if (type === "operation") return <Cpu className="h-4 w-4" />;
    return <Bot className="h-4 w-4" />;
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl">
          <Dialog.Title className="sr-only">{t("command.title")}</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
            <Command className="h-5 w-5 shrink-0 text-[var(--brand)]" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && items[0]) run(items[0]);
              }}
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--muted)]"
              placeholder={t("command.placeholder")}
            />
            <kbd className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">Esc</kbd>
          </div>
          <div className="max-h-[28rem] overflow-y-auto p-2">
            {loading ? <div className="px-3 py-6 text-center text-sm text-[var(--muted)]">{t("common.loading")}</div> : null}
            {commands.isError ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
                {(commands.error as Error).message}
              </div>
            ) : null}
            {!loading && !items.length ? <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">{t("command.empty")}</div> : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => run(item)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-[var(--surface-muted)]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  {paletteIcon(item.type)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--text)]">{item.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                    {item.section ? `${item.section} · ` : ""}
                    {item.description}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted)]" />
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function App() {
  const { t, i18n } = useTranslation();
  const [hash, setHash] = useState(window.location.hash || "#/dashboard");
  const [, bump] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
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
  const [menuPrefs, setMenuPrefs] = useState<MenuPrefs>(() => getMenuPrefs());
  const [quickPanel, setQuickPanel] = useState<QuickPanelKey | null>(null);
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
      if (applyHashNormalization()) return;
      setHash(window.location.hash || "#/dashboard");
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

  useEffect(() => {
    if (!authed) {
      const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.replace(`/login.html?redirect=${encodeURIComponent(redirect)}`);
    }
  }, [authed]);

  useEffect(() => {
    if (me.data) setUserSession(me.data);
  }, [me.data]);

  const humanizeNavKey = (key: string) =>
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  const navLabel = (key: string) => String(t(`nav.${key}`, { defaultValue: humanizeNavKey(key) }));

  const currentRole = capabilities.role || String(me.data?.role || "viewer");
  const menuStrategy = menuPrefsRemote.data?.strategy;
  const capabilityItems = capabilities.items.length ? capabilities.items : capabilities.visibleItems;
  const roleVisibleNav = useMemo(
    () => filterNavByRole(currentRole, capabilityItems),
    [capabilityItems, currentRole],
  );
  const routeMicroApp = useMemo(() => getMicroAppIdFromHash(hash, roleVisibleNav.length ? roleVisibleNav : NAV), [hash, roleVisibleNav]);
  const visibleNav = useMemo(() => {
    const source = roleVisibleNav.length ? roleVisibleNav : NAV;
    return filterNavByMicroApp(activeMicroApp, source);
  }, [activeMicroApp, roleVisibleNav]);
  const current = findActiveNavItem(hash, visibleNav.length ? visibleNav : undefined);
  const groupedNav = useMemo(() => groupNavItems(keyword, navLabel, visibleNav), [keyword, t, visibleNav]);
  const pinnedItems = useMemo(() => pinnedNavItems(visibleNav), [visibleNav]);
  const favoriteItems = useMemo(() => resolveNavKeys(menuPrefs.favorites, visibleNav), [menuPrefs.favorites, visibleNav]);
  const recentItems = useMemo(
    () => resolveNavKeys(menuPrefs.recents, visibleNav).filter((item) => item.key !== current.key).slice(0, 6),
    [menuPrefs.recents, visibleNav, current.key],
  );
  const favoriteSet = useMemo(() => new Set(menuPrefs.favorites), [menuPrefs.favorites]);
  const currentFavorite = favoriteSet.has(current.key);
  const breadcrumb = useMemo(() => buildNavBreadcrumb(hash, navLabel, visibleNav), [hash, navLabel, visibleNav]);
  const densityCls = densityPadding(menuPrefs.density);
  const canWriteCurrent = current.capability ? capabilities.can(current.capability, "write") : true;
  const quickPanelItems = quickPanel === "favorites" ? favoriteItems : quickPanel === "recents" ? recentItems : pinnedItems;
  const quickPanelTitle = quickPanel === "favorites" ? t("nav.favorites") : quickPanel === "recents" ? t("nav.recents") : t("nav.pinned");

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
        recents: Array.isArray(prefs.recents) ? prefs.recents : menuPrefs.recents,
        density: prefs.density || menuPrefs.density,
        showRecents: typeof prefs.show_recents === "boolean" ? prefs.show_recents : menuPrefs.showRecents,
        showFavorites: typeof prefs.show_favorites === "boolean" ? prefs.show_favorites : menuPrefs.showFavorites,
      });
      localStorage.setItem(scope, "1");
    } catch {
      /* ignore disabled storage */
    }
  }, [authed, currentRole, me.data?.user_id, me.data?.username, menuPrefs.density, menuPrefs.favorites, menuPrefs.recents, menuPrefs.showFavorites, menuPrefs.showRecents, menuPrefsRemote.data?.preferences]);

  useEffect(() => {
    if (!authed || !menuPrefsRemote.data?.ok) return;
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
      if (menuPrefsRemote.data?.ok) syncMenuPrefs.mutate({ recents: next.recents });
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
    const activeAllowed = visibleNav.some((item) => !item.external && item.path.startsWith("#") && hash.startsWith(item.path));
    if (!activeAllowed) {
      const fallback = visibleNav.find((item) => item.path.startsWith("#")) ?? visibleNav[0];
      if (fallback?.path?.startsWith("#")) window.location.hash = fallback.path;
    }
  }, [hash, visibleNav]);
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

  const toggleGroup = (group: NavGroupKey) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };
  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };
  const toggleModule = (moduleKey: string) => {
    setCollapsedModules((prev) => ({ ...prev, [moduleKey]: !prev[moduleKey] }));
  };
  const chooseMicroApp = (appId: MicroAppId, route: string) => {
    setActiveMicroApp(appId);
    setKeyword("");
    setQuickPanel(null);
    window.location.hash = route;
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

  if (!authed) return null;
  const sidebarStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--app-bg)] text-[var(--text)] lg:h-screen lg:min-h-0 lg:overflow-hidden lg:flex-row">
      <CommandPalette open={commandOpen} setOpen={setCommandOpen} authed={authed} />
      <aside
        style={sidebarStyle}
        className={`relative flex min-h-0 w-full shrink-0 flex-col border-b border-[var(--nav-border)] bg-[var(--nav-bg)] shadow-sm backdrop-blur-xl transition-[width] duration-200 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r ${
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
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--nav-muted)]">
                <Layers3 className="h-3.5 w-3.5" />
                {t("nav.microAppView")}
              </span>
              <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--muted-strong)]">
                {t("nav.microAppMode")}
              </span>
            </div>
            <div className="grid gap-1">
              {MICRO_APPS.map((app) => {
                const active = app.id === activeMicroApp;
                const count = (roleVisibleNav.length ? roleVisibleNav : NAV).filter((item) => !item.hidden && !item.parentKey && getMicroAppIdForNavItem(item) === app.id).length;
                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => chooseMicroApp(app.id, app.route)}
                    className={`flex min-w-0 items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
                      active
                        ? "bg-[var(--nav-active)] font-semibold text-[var(--brand)] ring-1 ring-[var(--brand)]/35"
                        : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"
                    }`}
                    title={app.name}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{app.shortName}</span>
                      <span className="mt-0.5 block truncate text-[10px] font-normal text-[var(--nav-muted)]">{app.owner}</span>
                    </span>
                    <span className="shrink-0 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted-strong)]">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

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

        {!sidebarCollapsed && !keyword ? (
          <div className="px-3 pt-2">
            <div className="rounded-xl border border-[var(--border)]/70 bg-[var(--surface-raised)]/45 p-1.5">
              <div className="grid grid-cols-3 gap-1">
                {[
                  { key: "pinned" as const, icon: Pin, label: t("nav.pinned"), count: pinnedItems.length, enabled: pinnedItems.length > 0 },
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
                      <span className="rounded bg-[var(--surface-muted)] px-1 font-mono text-[10px] text-[var(--muted-strong)]">{entry.count}</span>
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
                  <div className="grid max-h-28 grid-cols-2 gap-1 overflow-y-auto pr-1">
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
                          <NavBadgeTag badge={item.badge} />
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
          </div>
        ) : null}

        <nav className={`mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-3 ${sidebarCollapsed ? "px-2" : "px-2"}`}>
          {groupedNav.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {t("nav.searchEmpty")}
            </div>
          ) : (
            groupedNav.map(({ group, categories }) => {
              const collapsed = collapsedGroups[group.key];
              const groupCount = categories.reduce((sum, category) => sum + category.items.length, 0);
              return (
                <section
                  key={group.key}
                  className="border-l-2 pl-1"
                  style={{ borderLeftColor: NAV_GROUP_ACCENT[group.key] }}
                >
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] ${
                      sidebarCollapsed ? "justify-center" : ""
                    }`}
                  >
                    {!sidebarCollapsed ? <span>{t(group.i18nKey)}</span> : <span className="sr-only">{t(group.i18nKey)}</span>}
                    {!sidebarCollapsed ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-strong)]">
                        {groupCount}
                      </span>
                      {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </span>
                    ) : null}
                  </button>
                  {!collapsed ? (
                    <div className="mt-1 space-y-2">
                      {categories.map(({ category, items }) => {
                        const categoryCollapsed = !keyword && collapsedCategories[category.key];
                        return (
                          <div key={category.key} className={!sidebarCollapsed ? "rounded-lg border border-[var(--border)]/60 bg-[var(--surface-raised)]/30 p-1" : ""}>
                            {!sidebarCollapsed ? (
                              <button
                                type="button"
                                onClick={() => toggleCategory(category.key)}
                                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                              >
                                <span className="min-w-0 truncate">{t(category.i18nKey, { defaultValue: humanizeNavKey(category.key) })}</span>
                                <span className="inline-flex items-center gap-1">
                                  <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{items.length}</span>
                                  {categoryCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                </span>
                              </button>
                            ) : null}
                            {!categoryCollapsed ? (
                              <div className="mt-1 space-y-1">
                                {items.map((n) => {
                                  const Icon = n.icon;
                                  const children = childrenByParent.get(n.key) ?? [];
                                  const parentActive = current.key === n.key || current.parentKey === n.key;
                                  const moduleOpen = Boolean(keyword) || parentActive || !collapsedModules[n.key];
                                  const isFav = favoriteSet.has(n.key);
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
                                              {!canWrite ? (
                                                <Lock
                                                  className="h-3 w-3 shrink-0 text-[var(--muted)]"
                                                  aria-label={t("nav.readOnly")}
                                                />
                                              ) : null}
                                              <NavBadgeTag badge={n.badge} />
                                            </span>
                                          ) : null}
                                        </a>
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
                                                  <NavBadgeTag badge={child.badge} />
                                                </a>
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
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </nav>

        {!sidebarCollapsed ? (
          <div className="shrink-0 border-t border-[var(--nav-border)] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <DensityMenu density={menuPrefs.density} />
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
                        recents: Array.isArray(prefs.recents) ? prefs.recents : menuPrefs.recents,
                        density: prefs.density || menuPrefs.density,
                        showRecents: typeof prefs.show_recents === "boolean" ? prefs.show_recents : menuPrefs.showRecents,
                        showFavorites: typeof prefs.show_favorites === "boolean" ? prefs.show_favorites : menuPrefs.showFavorites,
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

      <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:h-screen lg:overflow-y-auto xl:px-8 2xl:px-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-5 w-1 rounded"
                style={{ background: NAV_GROUP_ACCENT[current.group] }}
                aria-hidden
              />
              <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
                {t(`page.${current.key}.title`, { defaultValue: navLabel(current.key) })}
              </h1>
              <NavBadgeTag badge={current.badge} />
              {!canWriteCurrent ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300"
                  title={t("nav.readOnlyHint")}
                >
                  <Lock className="h-3 w-3" />
                  {t("nav.readOnly")}
                </span>
              ) : null}
              {current.pinnable !== false ? (
                <FavoriteToggle navKey={current.key} isFav={currentFavorite} size="md" />
              ) : null}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[var(--muted)]">
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
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              className="hidden h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm text-[var(--muted-strong)] shadow-sm hover:bg-[var(--surface-muted)] lg:inline-flex"
              onClick={() => setCommandOpen(true)}
              title={t("command.title")}
            >
              <Command className="h-4 w-4" />
              <span>{t("command.short")}</span>
            </button>
            <ProjectSelector />
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
        <div className="w-full">{current.el}</div>
      </main>
    </div>
  );
}
