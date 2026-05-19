import { ArrowRight, Bot, ChevronDown, ChevronRight, ExternalLink, Layers3, Lock, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BUSINESS_CODE_KEY,
  PROJECT_CODE_KEY,
  PROJECT_ID_KEY,
  TENANT_CODE_KEY,
  TOKEN_KEY,
  getToken,
} from "../lib/authStorage";
import { initTheme } from "../lib/theme";
import { filterNavByMicroApp, getMicroApp, type MicroAppId } from "../microApps";
import { buildNavBreadcrumb, NAV, type NavItem } from "../navigation";

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

export function MicroAppRuntime({ appId }: { appId: MicroAppId }) {
  const { t, i18n } = useTranslation();
  const app = getMicroApp(appId);
  const [hash, setHash] = useState(window.location.hash || app.basePath);
  const [keyword, setKeyword] = useState("");
  const navItems = useMemo(() => filterNavByMicroApp(appId, NAV), [appId]);
  const visibleItems = useMemo(() => navItems.filter((item) => !item.hidden && !item.parentKey && !item.key.startsWith("microApp")), [navItems]);

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
  const breadcrumb = useMemo(
    () => buildNavBreadcrumb(hash, (key) => String(t(`nav.${key}`, { defaultValue: key })), navItems),
    [hash, navItems, t],
  );
  const matchedModules = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return visibleItems;
    const matchedParents = new Set(
      navItems
        .filter((item) => item.parentKey)
        .filter((item) => {
          const label = String(t(`nav.${item.key}`, { defaultValue: item.key }));
          return `${label} ${item.description || ""} ${item.capability || ""}`.toLowerCase().includes(needle);
        })
        .map((item) => item.parentKey as string),
    );
    return visibleItems.filter((item) => {
      const label = String(t(`nav.${item.key}`, { defaultValue: item.key }));
      return matchedParents.has(item.key) || `${label} ${item.description || ""} ${item.capability || ""}`.toLowerCase().includes(needle);
    });
  }, [keyword, navItems, t, visibleItems]);
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

  const currentLabel = String(t(`nav.${current.key}`, { defaultValue: current.key }));

  return (
    <div className="flex min-h-screen bg-[var(--app-bg)] text-[var(--text)]">
      <aside className="hidden w-72 shrink-0 border-r border-[var(--nav-border)] bg-[var(--nav-bg)] p-4 lg:block">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
              <Layers3 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[var(--text)]">{app.name}</p>
              <p className="truncate text-xs text-[var(--muted)]">{app.owner}</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--muted-strong)]">{app.description}</p>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted)]" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索应用模块"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] py-2 pl-8 pr-3 text-sm outline-none ring-[var(--brand)] focus:ring"
          />
        </div>

        <nav className="mt-4 grid max-h-[calc(100vh-18rem)] gap-1 overflow-y-auto pr-1">
          {matchedModules.map((item) => {
            const Icon = item.icon;
            const active = current.key === item.key || current.parentKey === item.key;
            const children = childrenByParent.get(item.key) ?? [];
            const open = Boolean(keyword) || active;
            return (
              <div key={item.key}>
                <a
                  href={item.path}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-[var(--nav-active)] font-semibold text-[var(--brand)] ring-1 ring-[var(--brand)]/30"
                      : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t(`nav.${item.key}`, { defaultValue: item.key })}</span>
                  {children.length ? (
                    open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                  )}
                </a>
                {children.length && open ? (
                  <div className="ml-5 mt-1 grid gap-0.5 border-l border-[var(--border)] pl-2">
                    {children.map((child) => {
                      const ChildIcon = child.icon;
                      const childActive = current.key === child.key;
                      return (
                        <a
                          key={child.key}
                          href={child.path}
                          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                            childActive
                              ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]"
                              : "text-[var(--nav-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--nav-text)]"
                          }`}
                          title={child.capability}
                        >
                          <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{t(`nav.${child.key}`, { defaultValue: child.key })}</span>
                        </a>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 xl:px-8">
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
              <span>{t(breadcrumb.group.i18nKey)}</span>
              {breadcrumb.category ? (
                <>
                  <span>/</span>
                  <span>{t(breadcrumb.category.i18nKey, { defaultValue: breadcrumb.category.key })}</span>
                </>
              ) : null}
              <span>/</span>
              <span className="font-medium text-[var(--muted-strong)]">{currentLabel}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openModuleCopilot(current, app.name, currentLabel)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
            >
              <Bot className="h-4 w-4 text-[var(--brand)]" />
              模块 AI
            </button>
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
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.key}
                  href={item.path}
                  className="group rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--brand)]/40 hover:shadow-md"
                >
                  <Icon className="mb-3 h-5 w-5 text-[var(--brand)]" />
                  <p className="font-semibold text-[var(--text)]">{t(`nav.${item.key}`, { defaultValue: item.key })}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">
                    {item.description || item.capability || item.path}
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">
                    进入 <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                  </span>
                </a>
              );
            })}
          </section>
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
  );
}
