import * as Dialog from "@radix-ui/react-dialog";
import { Bot, Command, Search, X } from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { MICRO_APPS, type MicroAppId } from "../microApps";
import type { NavBadge, NavItem } from "../navigation";

type IconComponent = ComponentType<{ className?: string }>;

type MobileCoreAction = {
  key: string;
  path: string;
  icon: IconComponent;
  label: string;
};

function NavBadgeTag({ badge }: { badge?: NavBadge }) {
  if (!badge) return null;
  const cls =
    badge === "alpha"
      ? "bg-amber-500/10 text-amber-600"
      : badge === "preview"
        ? "bg-sky-500/10 text-sky-600"
        : "bg-[var(--brand-soft)] text-[var(--brand)]";
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{badge}</span>;
}

export function MobileNavDrawer({
  open,
  onOpenChange,
  activeAppName,
  activeMicroApp,
  current,
  hash,
  keyword,
  onKeywordChange,
  onOpenCommand,
  mobileCoreActions,
  microAppMenuById,
  navLabel,
  chooseMicroApp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeAppName: string;
  activeMicroApp: MicroAppId;
  current: NavItem;
  hash: string;
  keyword: string;
  onKeywordChange: (value: string) => void;
  onOpenCommand: () => void;
  mobileCoreActions: MobileCoreAction[];
  microAppMenuById: Map<MicroAppId, NavItem[]>;
  navLabel: (key: string) => string;
  chooseMicroApp: (appId: MicroAppId, route: string) => void;
}) {
  const { t } = useTranslation();
  const term = keyword.trim().toLowerCase();

  const noMatches =
    term &&
    MICRO_APPS.every((app) => {
      const allAppMenus = microAppMenuById.get(app.id) ?? [];
      const appMatches = `${app.name} ${app.shortName} ${app.owner} ${app.description}`.toLowerCase().includes(term);
      const menuMatches = allAppMenus.some((item) => {
        const label = navLabel(item.key);
        return `${label} ${item.description || ""} ${item.capability || ""} ${item.path}`.toLowerCase().includes(term);
      });
      return !appMatches && !menuMatches;
    });

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) onKeywordChange("");
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm lg:hidden" />
        <Dialog.Content
          data-testid="mobile-nav-drawer"
          className="fixed inset-y-0 left-0 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col border-r border-[var(--nav-border)] bg-[var(--nav-bg)] text-[var(--text)] shadow-2xl backdrop-blur-xl lg:hidden"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--nav-border)] px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-bold text-[var(--brand)]">Hermes</Dialog.Title>
              <p className="mt-0.5 truncate text-xs text-[var(--nav-muted)]">{activeAppName}</p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)]"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="border-b border-[var(--nav-border)] p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <button
                type="button"
                className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-3 py-2.5 text-sm font-semibold text-white"
                onClick={onOpenCommand}
              >
                <Command className="h-4 w-4" />
                <span className="truncate">{t("command.short")}</span>
              </button>
              <a
                href="#/copilot"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--control-bg)] text-[var(--brand)]"
                aria-label={navLabel("copilot")}
              >
                <Bot className="h-4 w-4" />
              </a>
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted)]" />
              <input
                data-testid="mobile-nav-search"
                value={keyword}
                onChange={(event) => onKeywordChange(event.target.value)}
                placeholder={t("nav.searchPlaceholder")}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--control-bg)] py-2 pl-8 pr-8 text-sm text-[var(--text)] outline-none ring-[var(--brand)] placeholder:text-[var(--muted)] focus:ring"
                aria-label={t("nav.searchPlaceholder")}
              />
              {keyword ? (
                <button
                  type="button"
                  className="absolute right-2 top-2 rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                  onClick={() => onKeywordChange("")}
                  aria-label={t("common.cancel")}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="mt-3 grid grid-cols-5 gap-1">
              {mobileCoreActions.map((action) => {
                const Icon = action.icon;
                const active = hash.startsWith(action.path);
                return (
                  <a
                    key={action.key}
                    href={action.path}
                    className={`flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] ${
                      active ? "bg-[var(--nav-active)] font-semibold text-[var(--brand)]" : "text-[var(--nav-muted)] hover:bg-[var(--surface-muted)]"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="max-w-full truncate">{action.label}</span>
                  </a>
                );
              })}
            </div>
          </div>
          <div className="hermes-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid gap-2" data-testid="mobile-nav-filtered-micro-apps">
              {MICRO_APPS.map((app) => {
                const allAppMenus = microAppMenuById.get(app.id) ?? [];
                const appMatches = term ? `${app.name} ${app.shortName} ${app.owner} ${app.description}`.toLowerCase().includes(term) : true;
                const appMenus = term
                  ? allAppMenus.filter((item) => {
                      const label = navLabel(item.key);
                      return `${label} ${item.description || ""} ${item.capability || ""} ${item.path}`.toLowerCase().includes(term);
                    })
                  : allAppMenus;
                if (term && !appMatches && !appMenus.length) return null;
                const active = app.id === activeMicroApp;
                const shownMenus = appMatches && term && !appMenus.length ? allAppMenus : appMenus;
                const shown = shownMenus.slice(0, term ? 10 : active ? 12 : 5);
                return (
                  <section key={app.id} className={`rounded-xl border p-2 ${active ? "border-[var(--brand)]/45 bg-[var(--nav-active)]" : "border-[var(--border)] bg-[var(--surface-raised)]/55"}`}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left"
                      onClick={() => chooseMicroApp(app.id, app.route)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[var(--text)]">{app.shortName}</span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">{app.owner}</span>
                      </span>
                      <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--muted-strong)]">{term ? shownMenus.length : allAppMenus.length}</span>
                    </button>
                    <div className="mt-1 grid gap-1">
                      {shown.map((item) => {
                        const Icon = item.icon;
                        const activeItem = current.key === item.key || current.parentKey === item.key;
                        return (
                          <a
                            key={item.key}
                            href={item.path}
                            className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-xs ${
                              activeItem ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]" : "text-[var(--nav-text)] hover:bg-[var(--surface-muted)]"
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{navLabel(item.key)}</span>
                            <NavBadgeTag badge={item.badge} />
                          </a>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              {noMatches ? (
                <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--muted)]">
                  {t("nav.searchEmpty")}
                </div>
              ) : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
