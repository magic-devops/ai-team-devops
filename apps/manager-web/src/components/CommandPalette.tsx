import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, Command, Cpu, Rows3, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { NAV } from "../navigation";

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

export function CommandPalette({ open, setOpen, authed }: { open: boolean; setOpen: (open: boolean) => void; authed: boolean }) {
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
