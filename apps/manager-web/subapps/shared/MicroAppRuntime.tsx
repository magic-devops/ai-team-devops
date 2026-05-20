import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CircleDot,
  ExternalLink,
  Gauge,
  Globe2,
  Layers3,
  Laptop,
  ListChecks,
  Lock,
  LogOut,
  Menu,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  RefreshCw,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Sun,
  UserCircle,
  X,
  Zap,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  BUSINESS_CODE_KEY,
  PROJECT_CODE_KEY,
  PROJECT_ID_KEY,
  TENANT_CODE_KEY,
  TOKEN_KEY,
  USER_KEY,
  clearSession,
  getToken,
} from "../../src/lib/authStorage";
import { ProjectSelector } from "../../src/components/ProjectSelector";
import { api } from "../../src/lib/api";
import { getThemePreference, initTheme, isDarkResolved, setThemePreference, THEME_OPTIONS, type ThemePreference } from "../../src/lib/theme";
import { densityPadding, getMenuPrefs, patchMenuPrefs, pushRecent, subscribeMenuPrefs, toggleFavorite, type MenuDensity, type MenuEffect, type MenuLayout, type MenuPrefs } from "../../src/lib/menuPrefs";
import { filterNavByMicroApp, getMicroApp, type MicroAppId } from "../../src/microApps";
import { buildNavBreadcrumb, NAV, NAV_CATEGORIES, type NavItem } from "../../src/navigation";

type WujieProps = {
  token?: string | null;
  locale?: string | null;
  tenantCode?: string | null;
  businessCode?: string | null;
  projectId?: string | null;
  projectCode?: string | null;
};

declare global {
  interface Window {
    __POWERED_BY_WUJIE__?: boolean;
    $wujie?: {
      props?: WujieProps;
      bus?: {
        $emit?: (event: string, payload?: unknown) => void;
      };
    };
  }
}

function setLocalValue(key: string, value: string | null | undefined) {
  try {
    if (value && value.trim()) localStorage.setItem(key, value.trim());
  } catch {
    /* ignore sandboxed storage */
  }
}

function getStoredRuntimeUser(): { username?: string; tenantName?: string; role?: string } {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return {};
    const value = JSON.parse(raw) as { username?: string; id?: string; tenant_name?: string; tenant_slug?: string; tenant_id?: string; role?: string };
    return {
      username: value.username || value.id,
      tenantName: value.tenant_name || value.tenant_slug || value.tenant_id,
      role: value.role,
    };
  } catch {
    return {};
  }
}

function hydrateWujieSession() {
  const props = window.$wujie?.props;
  if (!props) return;
  setLocalValue(TOKEN_KEY, props.token || null);
  setLocalValue(TENANT_CODE_KEY, props.tenantCode || null);
  setLocalValue(BUSINESS_CODE_KEY, props.businessCode || null);
  setLocalValue(PROJECT_ID_KEY, props.projectId || null);
  setLocalValue(PROJECT_CODE_KEY, props.projectCode || props.projectId || null);
}

function openModuleCopilot(item: NavItem, appName: string, label: string) {
  try {
    sessionStorage.setItem(
      "sop-copilot-prefill",
      `请作为 ${appName} 的模块助手，分析 ${label}。能力码：${item.capability || item.key}，路径：${item.path}`,
    );
  } catch {
    /* ignore */
  }
  if (window.__POWERED_BY_WUJIE__) {
    window.$wujie?.bus?.$emit?.("hermes:navigate", { hash: "#/copilot" });
    return;
  }
  window.location.hash = "#/copilot";
}

function findRuntimeNavItem(hash: string, items: readonly NavItem[]): NavItem {
  const found = [...items]
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => !item.external && item.path.startsWith("#") && hash.startsWith(item.path));
  return found ?? items.find((item) => !item.hidden && !item.parentKey) ?? items[0] ?? NAV[0];
}

type RuntimeApp = ReturnType<typeof getMicroApp>;
type RuntimeMenuCategory = { key: string; label: string; items: NavItem[] };
type RuntimeMenuDomain = { key: string; label: string; categories: RuntimeMenuCategory[]; count: number };
type RuntimeSidebarSize = "compact" | "standard" | "wide" | "custom";
type RuntimeSidebarPreset = Exclude<RuntimeSidebarSize, "custom">;
type RuntimeQuickPanelKey = "pinned" | "favorites" | "recents";

const RUNTIME_CATEGORY_I18N_BY_KEY = new Map(NAV_CATEGORIES.map((category) => [category.key, category.i18nKey]));

function humanizeRuntimeKey(key: string) {
  return key
    .replace(/^nav\.(group|category)\./, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeRuntimeLabel(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "undefined" || text === "null") return fallback;
  return text;
}

function resolveRuntimeNavKeys(keys: readonly string[], items: readonly NavItem[]) {
  const byKey = new Map(items.filter((item) => !item.hidden && !item.external && !item.key.startsWith("microApp")).map((item) => [item.key, item]));
  return keys.map((key) => byKey.get(key)).filter(Boolean) as NavItem[];
}

function buildRuntimeMenuTree(items: readonly NavItem[], labelOf: (i18nKey: string, fallbackKey: string) => string): RuntimeMenuDomain[] {
  const domains: RuntimeMenuDomain[] = [];
  for (const item of items) {
    const domainKey = item.group || "workspace";
    const categoryKey = item.category || "default";
    let domain = domains.find((entry) => entry.key === domainKey);
    if (!domain) {
      domain = { key: domainKey, label: labelOf(`nav.group.${domainKey}`, domainKey), categories: [], count: 0 };
      domains.push(domain);
    }
    let category = domain.categories.find((entry) => entry.key === categoryKey);
    if (!category) {
      category = { key: categoryKey, label: labelOf(RUNTIME_CATEGORY_I18N_BY_KEY.get(categoryKey) ?? `nav.category.${categoryKey}`, categoryKey), items: [] };
      domain.categories.push(category);
    }
    category.items.push(item);
    domain.count += 1;
  }
  return domains;
}

const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_WIDTH: Record<RuntimeSidebarPreset, number> = {
  compact: 280,
  standard: SIDEBAR_DEFAULT_WIDTH,
  wide: 360,
};

function clampRuntimeSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

function densityText(density: MenuDensity, isEn = false) {
  if (density === "compact") return isEn ? "Compact" : "紧凑";
  if (density === "cozy") return isEn ? "Loose" : "宽松";
  return isEn ? "Standard" : "标准";
}

function RuntimeMenuDisplayButton({
  prefs,
  sidebarSize,
  onSidebarSizeChange,
  onExpandAll,
  onCollapseAll,
  onResetDisplay,
  placement = "down",
  variant = "card",
}: {
  prefs: MenuPrefs;
  sidebarSize: RuntimeSidebarSize;
  onSidebarSizeChange: (size: RuntimeSidebarPreset) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  onResetDisplay?: () => void;
  placement?: "up" | "down";
  variant?: "card" | "footer";
}) {
  const { i18n } = useTranslation();
  const isEn = i18n.language?.startsWith("en");
  const densityOptions: MenuDensity[] = ["compact", "comfortable", "cozy"];
  const widthOptions: Array<{ key: RuntimeSidebarPreset; label: string }> = [
    { key: "compact", label: isEn ? "Narrow" : "窄栏" },
    { key: "standard", label: isEn ? "Normal" : "标准" },
    { key: "wide", label: isEn ? "Wide" : "宽栏" },
  ];
  const widthLabel = sidebarSize === "custom" ? (isEn ? "Custom" : "自定义") : widthOptions.find((item) => item.key === sidebarSize)?.label;
  const layoutOptions: Array<{ key: MenuLayout; label: string }> = [
    { key: "grouped", label: isEn ? "Grouped" : "分组" },
    { key: "stream", label: isEn ? "List" : "列表" },
    { key: "minimal", label: isEn ? "Minimal" : "极简" },
  ];
  const effectOptions: Array<{ key: MenuEffect; label: string }> = [
    { key: "soft", label: isEn ? "Soft" : "柔和" },
    { key: "outline", label: isEn ? "Outline" : "描边" },
    { key: "quiet", label: isEn ? "Quiet" : "安静" },
  ];
  const toggleBoolean = (key: "showQuickPanel" | "showMenuCounts" | "showMenuMeta") => patchMenuPrefs({ [key]: !prefs[key] });
  const buttonClass =
    variant === "footer"
      ? "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-xs font-medium text-[var(--muted-strong)] transition hover:bg-[var(--surface-muted)] data-[state=open]:border-[var(--brand)]/40 data-[state=open]:bg-[var(--brand-soft)] data-[state=open]:text-[var(--brand)] data-[state=open]:shadow-sm"
      : "rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-2 text-left text-xs text-[var(--muted-strong)] transition hover:bg-[var(--surface-muted)] data-[state=open]:border-[var(--brand)]/40 data-[state=open]:bg-[var(--brand-soft)] data-[state=open]:text-[var(--brand)]";
  const panelWidth = variant === "footer" ? "min-w-[28rem] w-[34rem] max-w-[calc(100vw-2rem)]" : "w-80 max-w-[calc(100vw-2rem)]";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={buttonClass}>
          <SlidersHorizontal className={variant === "footer" ? "h-4 w-4" : "mb-1 h-4 w-4"} />
          <span>{isEn ? "Menu" : "菜单"} · {densityText(prefs.density, isEn)}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`z-50 max-h-[min(640px,calc(100vh-6rem))] ${panelWidth} overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl`}
          side={placement === "up" ? "top" : "bottom"}
          sideOffset={8}
          align={variant === "footer" ? "start" : "end"}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="inline-flex items-center gap-2 text-base font-bold text-[var(--text)]">
                <SlidersHorizontal className="h-4 w-4 text-[var(--brand)]" />
                {isEn ? "Menu display" : "菜单显示"}
              </span>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{isEn ? "Control density, width, layout, helper panels and hierarchy state." : "统一控制密度、宽度、布局、辅助面板和菜单层级状态。"}</span>
            </span>
            <span className="shrink-0 rounded-lg bg-[var(--surface-muted)] px-2 py-1 text-[11px] font-medium text-[var(--muted-strong)]">{widthLabel}</span>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
              <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{isEn ? "Density" : "密度"}</p>
              <div className="grid grid-cols-3 gap-1">
                {densityOptions.map((item) => (
                  <button key={item} type="button" onClick={() => patchMenuPrefs({ density: item })} className={`rounded-lg px-2 py-1.5 text-xs font-medium ${prefs.density === item ? "bg-[var(--surface)] text-[var(--brand)] shadow-sm" : "text-[var(--muted-strong)] hover:bg-[var(--surface)]"}`}>
                    {densityText(item, isEn)}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-2">
              <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{isEn ? "Sidebar width" : "侧栏宽度"}</p>
              <div className="grid grid-cols-3 gap-1">
                {widthOptions.map((item) => (
                  <button key={item.key} type="button" onClick={() => onSidebarSizeChange(item.key)} className={`rounded-lg px-2 py-1.5 text-xs font-medium ${sidebarSize === item.key ? "bg-[var(--surface)] text-[var(--brand)] shadow-sm" : "text-[var(--muted-strong)] hover:bg-[var(--surface)]"}`}>
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 px-1 text-[11px] text-[var(--muted)]">{isEn ? "Drag the sidebar edge for a custom width." : "也可以拖动侧栏右边缘设置自定义宽度。"}</p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] p-2">
                <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{isEn ? "Layout" : "布局"}</p>
                {layoutOptions.map((item) => (
                  <button key={item.key} type="button" onClick={() => patchMenuPrefs({ menuLayout: item.key })} className={`mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-medium ${prefs.menuLayout === item.key ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"}`}>
                    <span className="inline-flex items-center gap-2">
                      <Layers3 className="h-3.5 w-3.5" />
                      {item.label}
                    </span>
                    {prefs.menuLayout === item.key ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                  </button>
                ))}
              </div>
              <div className="rounded-xl border border-[var(--border)] p-2">
                <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{isEn ? "Style" : "效果"}</p>
                <div className="grid grid-cols-3 gap-1">
                  {effectOptions.map((item) => (
                    <button key={item.key} type="button" onClick={() => patchMenuPrefs({ menuEffect: item.key })} className={`rounded-lg px-2 py-1.5 text-xs font-medium ${prefs.menuEffect === item.key ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"}`}>{item.label}</button>
                  ))}
                </div>
                <div className="mt-2 grid gap-1">
                  {[
                    { key: "showQuickPanel" as const, label: isEn ? "Quick panel" : "快捷区" },
                    { key: "showMenuCounts" as const, label: isEn ? "Badges" : "计数徽标" },
                    { key: "showMenuMeta" as const, label: isEn ? "Descriptions" : "能力说明" },
                  ].map((item) => (
                    <button key={item.key} type="button" onClick={() => toggleBoolean(item.key)} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]">
                      <span>{item.label}</span>
                      <span className={`h-4 w-7 rounded-full p-0.5 transition ${prefs[item.key] ? "bg-[var(--brand)]" : "bg-[var(--border)]"}`}>
                        <span className={`block h-3 w-3 rounded-full bg-white transition ${prefs[item.key] ? "translate-x-3" : ""}`} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-3">
              <button
                type="button"
                onClick={onExpandAll}
                className="rounded-lg bg-[var(--surface-muted)] px-2 py-2 text-xs font-medium text-[var(--muted-strong)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!onExpandAll}
              >
                {isEn ? "Expand" : "展开全部"}
              </button>
              <button
                type="button"
                onClick={onCollapseAll}
                className="rounded-lg bg-[var(--surface-muted)] px-2 py-2 text-xs font-medium text-[var(--muted-strong)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!onCollapseAll}
              >
                {isEn ? "Collapse" : "收起全部"}
              </button>
              <button
                type="button"
                onClick={onResetDisplay}
                className="rounded-lg bg-[var(--surface-muted)] px-2 py-2 text-xs font-medium text-[var(--muted-strong)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!onResetDisplay}
              >
                {isEn ? "Reset" : "恢复默认"}
              </button>
            </div>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function RuntimeThemeMenu() {
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

function RuntimeTopBar({
  app,
  currentLabel,
  current,
  onToggleMenu,
  onOpenCopilot,
}: {
  app: RuntimeApp;
  currentLabel: string;
  current: NavItem;
  onToggleMenu: () => void;
  onOpenCopilot: () => void;
}) {
  const { i18n } = useTranslation();
  const qc = useQueryClient();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement | null>(null);
  const authed = Boolean(getToken());
  const me = useQuery({ queryKey: ["authMe"], queryFn: api.authMe, enabled: authed, retry: false });
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      clearSession();
      void qc.clear();
      window.location.replace(`/login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`);
    },
  });

  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [accountOpen]);

  const chooseLanguage = (value: string) => {
    void i18n.changeLanguage(value);
    try {
      localStorage.setItem("i18nextLng", value);
    } catch {
      /* ignore sandboxed storage */
    }
  };

  const storedUser = getStoredRuntimeUser();
  const username = String(me.data?.username || me.data?.user_id || storedUser.username || "admin");
  const tenantName = String(me.data?.tenant_name || me.data?.tenant_slug || me.data?.tenant_id || storedUser.tenantName || "default");
  const isEn = i18n.language?.startsWith("en");

  return (
    <div className="sticky top-0 z-40 shrink-0 border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 py-3 backdrop-blur xl:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onToggleMenu}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] shadow-sm hover:bg-[var(--surface-muted)]"
            aria-label="切换子应用菜单"
          >
            <Menu className="h-4 w-4" />
          </button>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <Layers3 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[var(--text)]">{app.name}</p>
            <p className="truncate text-xs text-[var(--muted)]">{app.shortName} / {currentLabel}</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <ProjectSelector />
          <button
            type="button"
            onClick={onOpenCopilot}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
          >
            <Bot className="h-4 w-4 text-[var(--brand)]" />
            模块 AI
          </button>
          <RuntimeThemeMenu />
          <label className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2 text-sm text-[var(--muted-strong)] shadow-sm">
            <Globe2 className="h-4 w-4" />
            <select
              value={i18n.language || "zh-CN"}
              onChange={(event) => chooseLanguage(event.target.value)}
              className="max-w-[6rem] bg-transparent text-[var(--text)] outline-none"
              aria-label="界面语言"
            >
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <a
            href="/#/settings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
            title="子应用配置"
          >
            <Settings2 className="h-4 w-4" />
          </a>
          <div ref={accountRef} className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen((value) => !value)}
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium shadow-sm transition ${
                accountOpen ? "border-[var(--brand)]/40 bg-[var(--brand-soft)] text-[var(--brand)]" : "border-[var(--border)] bg-[var(--control-bg)] text-[var(--text)] hover:bg-[var(--surface-muted)]"
              }`}
              title={`${tenantName} / ${username}`}
              aria-expanded={accountOpen}
            >
              <UserCircle className="h-4 w-4 text-[var(--brand)]" />
              <span className="max-w-[8rem] truncate">{username}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition ${accountOpen ? "rotate-180" : ""}`} />
            </button>
            {accountOpen ? (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-sm shadow-2xl">
                <div className="border-b border-[var(--border)] bg-[var(--surface-muted)]/60 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <UserCircle className="h-6 w-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold text-[var(--text)]">{username}</p>
                      <p className="mt-1 truncate text-xs text-[var(--muted)]">{tenantName}</p>
                      <p className="mt-2 inline-flex max-w-full items-center rounded-md bg-[var(--surface)] px-2 py-1 text-[11px] font-medium text-[var(--muted-strong)]">
                        <span className="truncate">{tenantName} / {username}</span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid gap-2 p-3">
                  <a
                    href="/#/organization/users"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[var(--muted-strong)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                  >
                    <UserCircle className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-nowrap font-semibold">{isEn ? "Users and accounts" : "用户与账号管理"}</span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">{isEn ? "Members, accounts, tenant session" : "成员、账号、租户会话"}</span>
                    </span>
                  </a>
                  <a
                    href="/#/organization/role-policy"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[var(--muted-strong)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                  >
                    <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-nowrap font-semibold">{isEn ? "Role permission policy" : "角色权限策略"}</span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">{isEn ? "Roles, capability boundaries, access control" : "角色、能力边界、访问控制"}</span>
                    </span>
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      void me.refetch();
                      setAccountOpen(false);
                    }}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[var(--muted-strong)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                  >
                    <RefreshCw className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-nowrap font-semibold">{isEn ? "Refresh account state" : "刷新账户状态"}</span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">{isEn ? "Sync tenant and permission info" : "同步当前租户和权限信息"}</span>
                    </span>
                  </button>
                </div>
                <div className="border-t border-[var(--border)] p-3">
                <button
                  type="button"
                  onClick={() => logout.mutate()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-500/15"
                >
                  <LogOut className="h-4 w-4" />
                  {isEn ? "Sign out" : "退出登录"}
                </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <p className="mt-2 hidden truncate text-xs text-[var(--muted)] lg:block">
        子应用独立运行态 · {current.capability || current.key} · {app.owner}
      </p>
    </div>
  );
}

function maturityTone(maturity: RuntimeApp["capabilities"][number]["maturity"]) {
  if (maturity === "leading") return "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300";
  if (maturity === "advanced") return "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300";
  return "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300";
}

function maturityText(maturity: RuntimeApp["capabilities"][number]["maturity"]) {
  if (maturity === "leading") return "领先";
  if (maturity === "advanced") return "增强";
  return "标准";
}

function priorityTone(priority: RuntimeApp["actions"][number]["priority"]) {
  if (priority === "P0") return "bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300";
  if (priority === "P1") return "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300";
  return "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300";
}

function MicroAppHome({
  app,
  current,
  visibleItems,
  childrenByParent,
  labelOf,
}: {
  app: RuntimeApp;
  current: NavItem;
  visibleItems: NavItem[];
  childrenByParent: Map<string, NavItem[]>;
  labelOf: (key: string) => string;
}) {
  const [capabilityMode, setCapabilityMode] = useState<"matrix" | "workflow" | "actions">("matrix");
  const childCount = Array.from(childrenByParent.values()).reduce((sum, rows) => sum + rows.length, 0);
  const focusItems = visibleItems.slice(0, 4);
  const targetByKey = new Map(visibleItems.map((item) => [item.key, item]));
  for (const children of childrenByParent.values()) {
    for (const item of children) targetByKey.set(item.key, item);
  }
  const groupedItems = visibleItems.reduce<Record<string, NavItem[]>>((out, item) => {
    const group = item.category || item.group || "workspace";
    out[group] = [...(out[group] || []), item];
    return out;
  }, {});

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="grid gap-5 p-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--brand)]">
              <Layers3 className="h-4 w-4" />
              {app.shortName} 工作台
            </span>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-[var(--text)]">{app.name}</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted-strong)]">{app.description}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {app.highlights.map((item) => (
                <div key={item} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                  <ShieldCheck className="mb-2 h-4 w-4 text-[var(--brand)]" />
                  <p className="text-sm font-semibold text-[var(--text)]">{item}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <Layers3 className="mb-3 h-5 w-5 text-[var(--brand)]" />
              <p className="text-2xl font-bold text-[var(--text)]">{visibleItems.length}</p>
              <p className="text-sm text-[var(--muted)]">专业主模块</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <Route className="mb-3 h-5 w-5 text-[var(--brand)]" />
              <p className="text-2xl font-bold text-[var(--text)]">{childCount}</p>
              <p className="text-sm text-[var(--muted)]">细化子能力</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <Activity className="mb-3 h-5 w-5 text-[var(--brand)]" />
              <p className="text-2xl font-bold text-[var(--text)]">{app.groups.length}</p>
              <p className="text-sm text-[var(--muted)]">能力域</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <Gauge className="mb-3 h-5 w-5 text-[var(--brand)]" />
              <p className="text-2xl font-bold text-[var(--text)]">{app.mode === "standalone" ? "独立" : "统一"}</p>
              <p className="text-sm text-[var(--muted)]">运行模式</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text)]">能力运营台</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">把子应用能力沉淀成矩阵、流程和行动队列，方便专业团队持续运营。</p>
          </div>
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-1">
            {[
              { key: "matrix", label: "能力矩阵", icon: SlidersHorizontal },
              { key: "workflow", label: "工作流", icon: Zap },
              { key: "actions", label: "行动项", icon: ListChecks },
            ].map((option) => {
              const Icon = option.icon;
              const active = capabilityMode === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setCapabilityMode(option.key as typeof capabilityMode)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${
                    active ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {capabilityMode === "matrix" ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {app.capabilities.map((capability) => (
              <div key={capability.name} className="min-h-44 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ${maturityTone(capability.maturity)}`}>{maturityText(capability.maturity)}</span>
                  <CircleDot className="h-4 w-4 text-[var(--brand)]" />
                </div>
                <h4 className="text-sm font-semibold text-[var(--text)]">{capability.name}</h4>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--muted)]">{capability.scope}</p>
                <p className="mt-4 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted-strong)]">{capability.kpi}</p>
              </div>
            ))}
          </div>
        ) : null}

        {capabilityMode === "workflow" ? (
          <div className="grid gap-3 lg:grid-cols-4">
            {app.workflows.map((workflow, index) => (
              <div key={workflow.phase} className="relative rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="mb-4 flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-sm font-bold text-[var(--brand)]">{index + 1}</span>
                  <h4 className="text-sm font-semibold text-[var(--text)]">{workflow.phase}</h4>
                </div>
                <p className="text-xs leading-5 text-[var(--muted)]">{workflow.detail}</p>
                <p className="mt-4 inline-flex rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--muted-strong)]">{workflow.metric}</p>
              </div>
            ))}
          </div>
        ) : null}

        {capabilityMode === "actions" ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {app.actions.map((action) => {
              const target = targetByKey.get(action.targetKey);
              return (
                <a
                  key={action.title}
                  href={target?.path || app.basePath}
                  className="group rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--brand)]/40 hover:shadow-md"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ${priorityTone(action.priority)}`}>{action.priority}</span>
                    <ArrowRight className="h-4 w-4 text-[var(--muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" />
                  </div>
                  <h4 className="text-sm font-semibold text-[var(--text)]">{action.title}</h4>
                  <div className="mt-4 grid gap-2 text-xs text-[var(--muted)]">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {action.owner}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {action.due}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--brand)]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {target ? labelOf(target.key) : "进入工作台"}
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.82fr]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-[var(--text)]">核心工作流</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">按当前子应用的专业场景组织入口。</p>
            </div>
            <button
              type="button"
              onClick={() => openModuleCopilot(current, app.name, labelOf(current.key))}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
            >
              <Bot className="h-4 w-4 text-[var(--brand)]" />
              工作台 AI
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {focusItems.map((item) => {
              const Icon = item.icon;
              const children = childrenByParent.get(item.key) ?? [];
              return (
                <a
                  key={item.key}
                  href={item.path}
                  className="group min-h-32 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--brand)]/40 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[var(--text)]">{labelOf(item.key)}</span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[var(--muted)]">{item.description || item.capability || item.path}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" />
                  </div>
                  {children.length ? (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {children.slice(0, 4).map((child) => (
                        <span key={child.key} className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--muted-strong)]">
                          {labelOf(child.key)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </a>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <h3 className="text-lg font-semibold text-[var(--text)]">能力地图</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">从能力域进入对应模块，保持子应用边界清晰。</p>
          <div className="mt-4 grid gap-3">
            {Object.entries(groupedItems).slice(0, 5).map(([group, items]) => (
              <div key={group} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text)]">{humanizeRuntimeKey(group)}</p>
                  <span className="rounded-md bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--brand)]">{items.length}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {items.slice(0, 6).map((item) => (
                    <a key={item.key} href={item.path} className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--muted-strong)] hover:text-[var(--brand)]">
                      {labelOf(item.key)}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function MicroAppRuntime({ appId, embedded = false }: { appId: MicroAppId; embedded?: boolean }) {
  const { t, i18n } = useTranslation();
  const app = getMicroApp(appId);
  const [hash, setHash] = useState(window.location.hash || app.basePath);
  const [keyword, setKeyword] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [quickPanel, setQuickPanel] = useState<RuntimeQuickPanelKey | null>(null);
  const [sidebarSize, setSidebarSize] = useState<RuntimeSidebarSize>(() => {
    try {
      const stored = localStorage.getItem(`sop-subapp-${appId}-sidebar-size`);
      return stored === "compact" || stored === "wide" || stored === "standard" || stored === "custom" ? stored : "standard";
    } catch {
      return "standard";
    }
  });
  const [sidebarWidthValue, setSidebarWidthValue] = useState(() => {
    try {
      const raw = Number(localStorage.getItem(`sop-subapp-${appId}-sidebar-width`) || SIDEBAR_DEFAULT_WIDTH);
      return clampRuntimeSidebarWidth(Number.isFinite(raw) ? raw : SIDEBAR_DEFAULT_WIDTH);
    } catch {
      return SIDEBAR_DEFAULT_WIDTH;
    }
  });
  const [menuPrefs, setMenuPrefs] = useState<MenuPrefs>(() => getMenuPrefs());
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`sop-subapp-${appId}-collapsed-groups`) || "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const lastRecentKeyRef = useRef<string | null>(null);
  const navItems = useMemo(() => filterNavByMicroApp(appId, NAV), [appId]);
  const visibleItems = useMemo(() => navItems.filter((item) => !item.hidden && !item.parentKey && !item.key.startsWith("microApp")), [navItems]);
  const densityCls = densityPadding(menuPrefs.density);
  const labelOf = useCallback(
    (key: string) => safeRuntimeLabel(t(`nav.${key}`, { defaultValue: humanizeRuntimeKey(key) }), humanizeRuntimeKey(key)),
    [t],
  );
  const i18nLabelOf = useCallback(
    (i18nKey: string, fallbackKey: string) => safeRuntimeLabel(t(i18nKey, { defaultValue: humanizeRuntimeKey(fallbackKey) }), humanizeRuntimeKey(fallbackKey)),
    [t],
  );

  useEffect(() => subscribeMenuPrefs(setMenuPrefs), []);

  useEffect(() => {
    try {
      localStorage.setItem(`sop-subapp-${appId}-sidebar-size`, sidebarSize);
    } catch {
      /* ignore sandboxed storage */
    }
  }, [appId, sidebarSize]);

  useEffect(() => {
    try {
      if (!sidebarCollapsed) localStorage.setItem(`sop-subapp-${appId}-sidebar-width`, String(sidebarWidthValue));
    } catch {
      /* ignore sandboxed storage */
    }
  }, [appId, sidebarCollapsed, sidebarWidthValue]);

  useEffect(() => {
    try {
      localStorage.setItem(`sop-subapp-${appId}-collapsed-groups`, JSON.stringify(collapsedGroups));
    } catch {
      /* ignore sandboxed storage */
    }
  }, [appId, collapsedGroups]);

  useEffect(() => {
    hydrateWujieSession();
    initTheme();
    const propsLocale = window.$wujie?.props?.locale;
    if (propsLocale && propsLocale !== i18n.language) void i18n.changeLanguage(propsLocale);
    if (!getToken()) {
      const redirect = window.__POWERED_BY_WUJIE__ ? "/" : `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.replace(`/login.html?redirect=${encodeURIComponent(redirect)}`);
    }
  }, [i18n]);

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash || app.basePath);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [app.basePath]);

  const current = useMemo(() => findRuntimeNavItem(hash, navItems), [hash, navItems]);
  useEffect(() => {
    if (!current?.key || current.key.startsWith("microApp") || lastRecentKeyRef.current === current.key) return;
    lastRecentKeyRef.current = current.key;
    pushRecent(current.key);
  }, [current?.key]);

  const breadcrumb = useMemo(() => buildNavBreadcrumb(hash, labelOf, navItems), [hash, labelOf, navItems]);
  const matchedModules = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return visibleItems;
    const matchedParents = new Set(
      navItems
        .filter((item) => item.parentKey)
        .filter((item) => {
          const label = labelOf(item.key);
          return `${label} ${item.description || ""} ${item.capability || ""}`.toLowerCase().includes(needle);
        })
        .map((item) => item.parentKey as string),
    );
    return visibleItems.filter((item) => {
      const label = labelOf(item.key);
      return matchedParents.has(item.key) || `${label} ${item.description || ""} ${item.capability || ""}`.toLowerCase().includes(needle);
    });
  }, [keyword, labelOf, navItems, visibleItems]);
  const childrenByParent = useMemo(() => {
    const out = new Map<string, NavItem[]>();
    for (const item of navItems) {
      if (!item.parentKey) continue;
      const rows = out.get(item.parentKey) ?? [];
      rows.push(item);
      out.set(item.parentKey, rows);
    }
    return out;
  }, [navItems]);
  const menuTree = useMemo(() => buildRuntimeMenuTree(matchedModules, i18nLabelOf), [i18nLabelOf, matchedModules]);
  const favoriteItems = useMemo(() => resolveRuntimeNavKeys(menuPrefs.favorites, navItems), [menuPrefs.favorites, navItems]);
  const recentItems = useMemo(() => resolveRuntimeNavKeys(menuPrefs.recents, navItems).filter((item) => item.key !== current.key), [current.key, menuPrefs.recents, navItems]);
  const isEnglish = i18n.language?.startsWith("en");
  const quickItems = useMemo(() => {
    const seen = new Set<string>();
    return [...favoriteItems, ...recentItems, ...visibleItems]
      .filter((item) => {
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      })
      .slice(0, 6);
  }, [favoriteItems, recentItems, visibleItems]);
  const quickPanelItems = quickPanel === "favorites" ? favoriteItems : quickPanel === "recents" ? recentItems : quickItems;
  const quickPanelTitle = quickPanel === "favorites" ? (isEnglish ? "Favorites" : "我的收藏") : quickPanel === "recents" ? (isEnglish ? "Recent" : "最近访问") : (isEnglish ? "Quick access" : "快捷入口");

  const currentLabel = labelOf(current.key);
  const groupLabel = i18nLabelOf(breadcrumb.group.i18nKey, breadcrumb.group.key);
  const categoryLabel = breadcrumb.category ? i18nLabelOf(breadcrumb.category.i18nKey, breadcrumb.category.key) : "";
  const currentIsFavorite = menuPrefs.favorites.includes(current.key);
  const toggleGroup = (key: string) => setCollapsedGroups((currentGroups) => ({ ...currentGroups, [key]: !currentGroups[key] }));
  const openCurrentCopilot = () => openModuleCopilot(current, app.name, currentLabel);
  const showMenuCounts = menuPrefs.showMenuCounts;
  const showMenuMeta = menuPrefs.showMenuMeta;
  const showQuickPanel = menuPrefs.showQuickPanel;
  const sidebarWidth = sidebarCollapsed ? 72 : sidebarWidthValue;
  const chooseSidebarPreset = (size: RuntimeSidebarPreset) => {
    setSidebarSize(size);
    setSidebarWidthValue(SIDEBAR_WIDTH[size]);
  };
  const startSidebarResize = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (sidebarCollapsed) return;
    const startX = event.clientX;
    const startWidth = sidebarWidthValue;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (move: MouseEvent) => {
      setSidebarSize("custom");
      setSidebarWidthValue(clampRuntimeSidebarWidth(startWidth + move.clientX - startX));
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
  const expandAllMenus = () => setCollapsedGroups({});
  const collapseAllMenus = () => {
    const next: Record<string, boolean> = {};
    for (const domain of menuTree) {
      next[`domain:${domain.key}`] = true;
      for (const category of domain.categories) next[`category:${domain.key}:${category.key}`] = true;
    }
    for (const item of visibleItems) {
      if ((childrenByParent.get(item.key) ?? []).length) next[`module:${item.key}`] = true;
    }
    setCollapsedGroups(next);
  };
  const resetMenuDisplay = () => {
    chooseSidebarPreset("standard");
    patchMenuPrefs({
      density: "comfortable",
      menuLayout: "grouped",
      menuEffect: "soft",
      showQuickPanel: true,
      showMenuCounts: true,
      showMenuMeta: true,
      showFavorites: true,
      showRecents: true,
    });
    setCollapsedGroups({});
  };
  const shellRootClass = embedded ? "h-full min-h-0 overflow-hidden" : "min-h-screen overflow-visible";
  const shellBodyClass = embedded ? "flex min-h-0 flex-1 overflow-hidden" : "flex min-h-[calc(100vh-4.75rem)] flex-1 items-start overflow-visible";
  const sidebarClass = [
    "relative hidden shrink-0 flex-col border-r border-[var(--nav-border)] bg-[var(--nav-bg)] transition-[width,flex-basis] duration-200 lg:flex",
    embedded ? "h-full min-h-0 overflow-visible" : "sticky top-[4.75rem] h-[calc(100vh-4.75rem)] overflow-visible",
  ].join(" ");
  const mainClass = embedded
    ? "min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 xl:px-8"
    : "min-w-0 flex-1 overflow-visible px-4 py-5 pb-12 sm:px-6 xl:px-8";
  const runtimeSectionClass =
    menuPrefs.menuLayout === "minimal"
      ? "rounded-lg border border-transparent bg-transparent p-0"
      : menuPrefs.menuEffect === "outline"
        ? "rounded-xl border border-[var(--border)] bg-transparent p-1"
        : menuPrefs.menuEffect === "quiet"
          ? "rounded-xl border border-transparent bg-transparent p-1"
          : "rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2";
  const runtimeCategoryClass =
    menuPrefs.menuLayout === "minimal"
      ? "rounded-md bg-transparent p-0.5"
      : menuPrefs.menuLayout === "stream"
        ? "rounded-lg border-l border-[var(--border)] bg-transparent p-1"
        : "rounded-lg bg-[var(--surface-muted)]/45 p-1.5";

  return (
    <div className={`flex flex-col bg-[var(--app-bg)] text-[var(--text)] ${shellRootClass}`}>
      <RuntimeTopBar
        app={app}
        current={current}
        currentLabel={currentLabel}
        onOpenCopilot={openCurrentCopilot}
        onToggleMenu={() => {
          setSidebarCollapsed((collapsed) => !collapsed);
          setMobileMenuOpen((open) => !open);
        }}
      />

      {mobileMenuOpen ? (
        <div className="max-h-[45vh] shrink-0 overflow-y-auto border-b border-[var(--nav-border)] bg-[var(--nav-bg)] p-3 lg:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted)]" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索应用模块"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] py-2 pl-8 pr-3 text-sm outline-none ring-[var(--brand)] focus:ring"
            />
          </div>
          <div className="mt-3 grid gap-2">
            {menuTree.flatMap((domain) => domain.categories).flatMap((category) => category.items).map((item) => {
              const Icon = item.icon;
              const active = current.key === item.key || current.parentKey === item.key;
              return (
                <a
                  key={item.key}
                  href={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    active ? "bg-[var(--nav-active)] font-semibold text-[var(--brand)]" : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{labelOf(item.key)}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--muted)]" />
                </a>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className={shellBodyClass}>
      <aside
        className={sidebarClass}
        style={{
          width: sidebarWidth,
          flexBasis: sidebarWidth,
          maxWidth: sidebarCollapsed ? 72 : SIDEBAR_MAX_WIDTH,
        }}
      >
        <div className={`shrink-0 border-b border-[var(--nav-border)] ${sidebarCollapsed ? "px-3 py-4" : "px-5 py-4"}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-lg font-bold tracking-tight text-[var(--brand)]">
                {sidebarCollapsed ? app.shortName.slice(0, 1) : app.name}
              </div>
              {!sidebarCollapsed ? (
                <p className="mt-1 truncate text-xs text-[var(--nav-muted)]">
                  {app.owner} · {isEnglish ? `${visibleItems.length} modules` : `${visibleItems.length} 个模块`}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
              title={sidebarCollapsed ? (isEnglish ? "Expand menu" : "展开菜单") : (isEnglish ? "Collapse menu" : "收起菜单")}
              aria-label={sidebarCollapsed ? (isEnglish ? "Expand menu" : "展开菜单") : (isEnglish ? "Collapse menu" : "收起菜单")}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>
          {!sidebarCollapsed && showMenuMeta ? (
            <p className="mt-2 line-clamp-2 rounded-lg bg-[var(--surface-raised)]/55 px-3 py-2 text-[11px] leading-5 text-[var(--nav-muted)]">
              {app.description}
            </p>
          ) : null}
        </div>

        {!sidebarCollapsed ? (
          <div className="shrink-0 border-b border-[var(--nav-border)] px-3 py-3">
            <div className="px-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted)]" />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder={isEnglish ? "Search modules" : "搜索应用模块"}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] py-2 pl-8 pr-8 text-sm text-[var(--text)] shadow-sm outline-none ring-[var(--brand)] placeholder:text-[var(--muted)] focus:ring"
                  aria-label={isEnglish ? "Search modules" : "搜索应用模块"}
                />
                {keyword ? (
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                    onClick={() => setKeyword("")}
                    aria-label={isEnglish ? "Clear search" : "清空搜索"}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <p className="mt-1 px-1 text-[11px] text-[var(--nav-muted)]">{isEnglish ? "Filter this micro app by name, capability or path." : "按名称、能力码和路径筛选当前子应用模块。"}</p>
            </div>

            {!keyword && showQuickPanel ? (
              <div className="mt-2 rounded-xl border border-[var(--border)]/70 bg-[var(--surface-raised)]/45 p-1.5">
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { key: "pinned" as const, icon: Pin, label: isEnglish ? "Quick" : "快捷入口", count: quickItems.length, enabled: quickItems.length > 0 },
                    { key: "favorites" as const, icon: Star, label: isEnglish ? "Favorites" : "我的收藏", count: favoriteItems.length, enabled: menuPrefs.showFavorites },
                    { key: "recents" as const, icon: Clock, label: isEnglish ? "Recent" : "最近访问", count: recentItems.length, enabled: menuPrefs.showRecents },
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
                          title={isEnglish ? "Clear recent modules" : "清空最近访问"}
                          aria-label={isEnglish ? "Clear recent modules" : "清空最近访问"}
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
                            title={labelOf(item.key)}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{labelOf(item.key)}</span>
                          </a>
                        );
                      }) : (
                        <div className="col-span-2 rounded-md border border-dashed border-[var(--border)] px-2 py-2 text-center text-[11px] text-[var(--nav-muted)]">
                          {isEnglish ? "No modules yet" : "暂无模块"}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${sidebarCollapsed ? "px-2 py-3" : "border-b border-[var(--nav-border)] px-3 py-3"}`}>
          {!sidebarCollapsed ? (
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--nav-muted)]">
                <Layers3 className="h-3.5 w-3.5" />
                {isEnglish ? "App menu" : "应用菜单"}
              </span>
              {showMenuCounts ? <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--muted-strong)]">{visibleItems.length}</span> : null}
            </div>
          ) : null}

        <nav className={`grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pr-1 ${sidebarCollapsed ? "gap-1 pr-0" : ""}`}>
          {menuTree.map((domain) => {
            const domainCollapsed = collapsedGroups[`domain:${domain.key}`] && !keyword;
            return (
              <section key={domain.key} className={sidebarCollapsed ? "grid gap-1" : runtimeSectionClass}>
                <button
                  type="button"
                  onClick={() => toggleGroup(`domain:${domain.key}`)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] ${sidebarCollapsed ? "justify-center" : ""}`}
                  title={domain.label}
                >
                  {domainCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {!sidebarCollapsed ? <span className="min-w-0 flex-1 truncate">{domain.label}</span> : null}
                  {!sidebarCollapsed && showMenuCounts ? <span className="rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{domain.count}</span> : null}
                </button>
                {domainCollapsed ? null : (
                  <div className="mt-1 grid gap-2">
                    {domain.categories.map((category) => {
                      const categoryKey = `category:${domain.key}:${category.key}`;
                      const categoryCollapsed = collapsedGroups[categoryKey] && !keyword;
                      return (
                        <div key={category.key} className={sidebarCollapsed ? "grid gap-1" : runtimeCategoryClass}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(categoryKey)}
                            className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-semibold text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] ${sidebarCollapsed ? "justify-center" : ""}`}
                            title={category.label}
                          >
                            {categoryCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {!sidebarCollapsed ? <span className="min-w-0 flex-1 truncate">{category.label}</span> : null}
                            {!sidebarCollapsed && showMenuCounts ? <span className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{category.items.length}</span> : null}
                          </button>
                          {categoryCollapsed ? null : (
                            <div className="mt-1 grid gap-1">
                              {category.items.map((item) => {
                                const Icon = item.icon;
                                const active = current.key === item.key || current.parentKey === item.key;
                                const children = childrenByParent.get(item.key) ?? [];
                                const moduleKey = `module:${item.key}`;
                                const open = Boolean(keyword) || active || !collapsedGroups[moduleKey];
                                const itemFavorite = menuPrefs.favorites.includes(item.key);
                                return (
                                  <div key={item.key}>
                                    <div
                                      className={`group flex items-center gap-1 rounded-lg px-2 text-sm transition ${
                                        active
                                          ? "bg-[var(--nav-active)] font-semibold text-[var(--brand)] ring-1 ring-[var(--brand)]/30"
                                          : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"
                                      }`}
                                    >
                                      <a href={item.path} title={labelOf(item.key)} className={`flex min-w-0 flex-1 items-center gap-2 ${sidebarCollapsed ? "justify-center py-2" : densityCls.item}`}>
                                        <Icon className="h-4 w-4 shrink-0" />
                                        {!sidebarCollapsed ? <span className="min-w-0 flex-1 truncate">{labelOf(item.key)}</span> : null}
                                      </a>
                                      {!sidebarCollapsed ? <button
                                        type="button"
                                        onClick={() => toggleFavorite(item.key)}
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] opacity-80 hover:bg-[var(--surface-raised)] hover:text-[var(--brand)] group-hover:opacity-100"
                                        aria-label={itemFavorite ? "取消收藏" : "收藏模块"}
                                      >
                                        <Star className="h-3.5 w-3.5" fill={itemFavorite ? "currentColor" : "none"} />
                                      </button> : null}
                                      {!sidebarCollapsed && children.length ? (
                                        <button
                                          type="button"
                                          onClick={() => toggleGroup(moduleKey)}
                                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
                                          aria-label={open ? "收起模块子能力" : "展开模块子能力"}
                                        >
                                          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                        </button>
                                      ) : !sidebarCollapsed ? (
                                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                                      ) : null}
                                    </div>
                                    {!sidebarCollapsed && children.length && open ? (
                                      <div className="ml-5 mt-1 grid gap-0.5 border-l border-[var(--border)] pl-2">
                                        {children.map((child) => {
                                          const ChildIcon = child.icon;
                                          const childActive = current.key === child.key;
                                          const childFavorite = menuPrefs.favorites.includes(child.key);
                                          return (
                                            <div
                                              key={child.key}
                                              className={`group/child flex items-center gap-1 rounded-md px-1.5 text-xs ${
                                                childActive
                                                  ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]"
                                                  : "text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--nav-text)]"
                                              }`}
                                              title={child.capability}
                                            >
                                              <a href={child.path} className={`flex min-w-0 flex-1 items-center gap-2 ${densityCls.child}`}>
                                                <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                                                <span className="min-w-0 flex-1 truncate">{labelOf(child.key)}</span>
                                              </a>
                                              <button
                                                type="button"
                                                onClick={() => toggleFavorite(child.key)}
                                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--muted)] opacity-70 hover:bg-[var(--surface-raised)] hover:text-[var(--brand)] group-hover/child:opacity-100"
                                                aria-label={childFavorite ? "取消收藏" : "收藏模块"}
                                              >
                                                <Star className="h-3 w-3" fill={childFavorite ? "currentColor" : "none"} />
                                              </button>
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
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </nav>
        </div>

        {!sidebarCollapsed ? (
          <div className="shrink-0 border-t border-[var(--nav-border)] bg-[var(--nav-bg)] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <RuntimeMenuDisplayButton
                prefs={menuPrefs}
                sidebarSize={sidebarSize}
                onSidebarSizeChange={chooseSidebarPreset}
                onExpandAll={expandAllMenus}
                onCollapseAll={collapseAllMenus}
                onResetDisplay={resetMenuDisplay}
                placement="up"
                variant="footer"
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => patchMenuPrefs({ showFavorites: !menuPrefs.showFavorites })}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-xs transition ${
                    menuPrefs.showFavorites ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "bg-[var(--control-bg)] text-[var(--muted-strong)]"
                  } hover:bg-[var(--surface-muted)]`}
                  title={isEnglish ? "Show or hide favorites" : "显示/隐藏我的收藏"}
                  aria-label={isEnglish ? "Show or hide favorites" : "显示/隐藏我的收藏"}
                >
                  <Star className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => patchMenuPrefs({ showRecents: !menuPrefs.showRecents })}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-xs transition ${
                    menuPrefs.showRecents ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "bg-[var(--control-bg)] text-[var(--muted-strong)]"
                  } hover:bg-[var(--surface-muted)]`}
                  title={isEnglish ? "Show or hide recents" : "显示/隐藏最近访问"}
                  aria-label={isEnglish ? "Show or hide recents" : "显示/隐藏最近访问"}
                >
                  <Clock className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {!sidebarCollapsed ? (
          <button
            type="button"
            className="group absolute -right-1 top-0 z-20 hidden h-full w-2 cursor-col-resize items-stretch justify-center lg:flex"
            onMouseDown={startSidebarResize}
            onDoubleClick={() => chooseSidebarPreset("standard")}
            title={isEnglish ? "Drag to resize menu width, double-click to reset" : "拖动调整菜单宽度，双击恢复默认"}
            aria-label={isEnglish ? "Resize menu width" : "调整菜单宽度"}
          >
            <span className="my-3 w-px rounded-full bg-transparent transition group-hover:bg-[var(--brand)] group-active:bg-[var(--brand)]" />
          </button>
        ) : null}
      </aside>

      <main className={mainClass}>
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--brand-soft)] px-2 py-1 text-xs font-semibold text-[var(--brand)]">
                <ShieldCheck className="h-3.5 w-3.5" />
                {app.shortName}
              </span>
              <h1 className="truncate text-2xl font-bold tracking-tight text-[var(--text)]">{currentLabel}</h1>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[var(--muted)]">
              <span>{groupLabel}</span>
              {breadcrumb.category ? (
                <>
                  <span>/</span>
                  <span>{categoryLabel}</span>
                </>
              ) : null}
              <span>/</span>
              <span className="font-medium text-[var(--muted-strong)]">{currentLabel}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!current.key.startsWith("microApp") ? (
              <button
                type="button"
                onClick={() => toggleFavorite(current.key)}
                className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${
                  currentIsFavorite
                    ? "border-[var(--brand)]/40 bg-[var(--brand-soft)] text-[var(--brand)]"
                    : "border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                <Star className="h-4 w-4" fill={currentIsFavorite ? "currentColor" : "none"} />
                {currentIsFavorite ? "已收藏" : "收藏"}
              </button>
            ) : null}
            {!window.__POWERED_BY_WUJIE__ ? (
              <a
                href="/"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
              >
                <ExternalLink className="h-4 w-4" />
                主应用
              </a>
            ) : null}
          </div>
        </header>

        {current.key.startsWith("microApp") ? (
          <MicroAppHome app={app} current={current} visibleItems={visibleItems} childrenByParent={childrenByParent} labelOf={labelOf} />
        ) : (
          <div className="w-full">{current.el}</div>
        )}

        {!current.capability ? (
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300">
            <Lock className="h-3.5 w-3.5" />
            当前模块尚未声明能力码，请在主应用能力注册表补齐。
          </div>
        ) : null}
      </main>
      </div>
    </div>
  );
}
