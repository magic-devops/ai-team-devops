import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileInput,
  Layers3,
  Pencil,
  RotateCcw,
  Search,
  ShieldCheck,
  Square,
  CheckSquare,
  Upload,
  X,
} from "lucide-react";
import { NAV, NAV_GROUPS, validateNavRegistry, type NavBadge, type NavGroupKey, type NavItem } from "../../navigation";
import { api } from "../../lib/api";
import { WorkbenchShell } from "../shared/WorkbenchShell";

type ManagedNavItem = NavItem & {
  label?: string;
};

type EditForm = {
  key: string;
  label: string;
  path: string;
  capability: string;
  group: NavGroupKey;
  badge: "" | NavBadge;
  hidden: boolean;
};

const badgeOptions: Array<"" | NavBadge> = ["", "new", "beta", "preview", "alpha"];
const secondaryButton =
  "inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-45";
const primaryButton =
  "inline-flex items-center gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90";
const inputControl =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function serializeItem(item: ManagedNavItem) {
  const { el, icon, ...rest } = item;
  void el;
  void icon;
  return rest;
}

export function MenuManagement() {
  const { t } = useTranslation();
  const mt = (key: string, values?: Record<string, unknown>) => t(`page.menuManagement.${key}`, values);
  const importRef = useRef<HTMLInputElement | null>(null);
  const backendHealth = useQuery({ queryKey: ["systemPagesHealth"], queryFn: api.systemPagesHealth, retry: false });
  const backendValidation = useQuery({ queryKey: ["systemPagesValidate"], queryFn: api.systemPagesValidate, retry: false });
  const [items, setItems] = useState<ManagedNavItem[]>(() => NAV.map((item) => ({ ...item })));
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState<"all" | NavGroupKey>("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(NAV.filter((item) => !item.parentKey).slice(0, 8).map((item) => item.key)));
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [taskPreview, setTaskPreview] = useState<any | null>(null);
  const [taskPriority, setTaskPriority] = useState<"P0" | "P1" | "P2" | "P3">("P1");
  const [taskAssignee, setTaskAssignee] = useState("Coder");
  const backlogTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.systemPagesBacklogTasks({ dry_run: dryRun, priority: taskPriority, assigned_to: taskAssignee.trim() || "Coder" }),
    onSuccess: (data, dryRun) => {
      setTaskPreview(data);
      const summary = data?.summary ?? {};
      setToast(
        dryRun
          ? mt("taskPreviewToast", { planned: summary.planned ?? 0, skipped: summary.skipped ?? 0 })
          : mt("taskCreatedToast", { created: summary.created ?? 0, skipped: summary.skipped ?? 0 }),
      );
    },
    onError: (error: unknown) => {
      setToast(mt("taskErrorToast", { message: error instanceof Error ? error.message : mt("backendUnavailable") }));
    },
  });

  const labelOf = (item: ManagedNavItem) => item.label || t(`nav.${item.key}`, { defaultValue: item.key });
  const groupLabel = (key: NavGroupKey) => t(`nav.group.${key}`, { defaultValue: key });

  const childrenByParent = useMemo(() => {
    const map = new Map<string, ManagedNavItem[]>();
    for (const item of items) {
      if (!item.parentKey) continue;
      const rows = map.get(item.parentKey) ?? [];
      rows.push(item);
      map.set(item.parentKey, rows);
    }
    return map;
  }, [items]);

  const healthIssues = useMemo(() => validateNavRegistry(items), [items]);
  const healthSummary = useMemo(
    () => ({
      error: healthIssues.filter((issue) => issue.level === "error").length,
      warn: healthIssues.filter((issue) => issue.level === "warn").length,
      ok: healthIssues.length === 0,
    }),
    [healthIssues],
  );

  const visibleTree = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const match = (item: ManagedNavItem) => {
      const haystack = [
        item.key,
        labelOf(item),
        item.path,
        item.capability,
        item.description,
        item.category,
        item.group,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (!keyword || haystack.includes(keyword)) && (domain === "all" || item.group === domain);
    };
    return items
      .filter((item) => !item.parentKey)
      .filter((parent) => {
        const children = childrenByParent.get(parent.key) ?? [];
        return match(parent) || children.some(match);
      })
      .map((parent) => ({
        parent,
        children: (childrenByParent.get(parent.key) ?? []).filter((child) => match(child) || match(parent)),
      }));
  }, [childrenByParent, domain, items, query, t]);

  function toggleSelected(key: string) {
    setSelected((next) => {
      const clone = new Set(next);
      if (clone.has(key)) clone.delete(key);
      else clone.add(key);
      return clone;
    });
  }

  function openEditor(item: ManagedNavItem) {
    setEditing({
      key: item.key,
      label: labelOf(item),
      path: item.path,
      capability: item.capability ?? "",
      group: item.group,
      badge: item.badge ?? "",
      hidden: Boolean(item.hidden),
    });
  }

  function saveEditor() {
    if (!editing) return;
    setItems((next) =>
      next.map((item) =>
        item.key === editing.key
          ? {
              ...item,
              label: editing.label.trim() || item.key,
              path: editing.path.trim(),
              capability: editing.capability.trim(),
              group: editing.group,
              badge: editing.badge || undefined,
              hidden: editing.hidden,
            }
          : item,
      ),
    );
    setToast(mt("updatedToast", { label: editing.label || editing.key }));
    setEditing(null);
  }

  function batchHidden(hidden: boolean) {
    setItems((next) => next.map((item) => (selected.has(item.key) ? { ...item, hidden } : item)));
    setToast(hidden ? mt("batchHiddenToast", { count: selected.size }) : mt("batchShownToast", { count: selected.size }));
  }

  function resetWorkingCopy() {
    setItems(NAV.map((item) => ({ ...item })));
    setSelected(new Set());
    setToast(mt("resetToast"));
  }

  function exportRegistry() {
    const payload = JSON.stringify(items.map(serializeItem), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `hermes-nav-registry-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setToast(mt("exportToast"));
  }

  function importRegistry(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    file
      .text()
      .then((content) => {
        const parsed = JSON.parse(content) as Array<Partial<ManagedNavItem> & { key?: string }>;
        if (!Array.isArray(parsed)) throw new Error(mt("invalidImportArray"));
        const patches = new Map(parsed.filter((entry) => entry.key).map((entry) => [entry.key as string, entry]));
        let count = 0;
        setItems((next) =>
          next.map((item) => {
            const patch = patches.get(item.key);
            if (!patch) return item;
            count += 1;
            return {
              ...item,
              label: typeof patch.label === "string" ? patch.label : item.label,
              path: typeof patch.path === "string" ? patch.path : item.path,
              capability: typeof patch.capability === "string" ? patch.capability : item.capability,
              group: (patch.group as NavGroupKey) ?? item.group,
              badge: (patch.badge as NavBadge | undefined) ?? item.badge,
              hidden: typeof patch.hidden === "boolean" ? patch.hidden : item.hidden,
            };
          }),
        );
        setToast(mt("importToast", { count }));
      })
      .catch((error: unknown) => {
        setToast(mt("importErrorToast", { message: error instanceof Error ? error.message : mt("parseFailed") }));
      });
  }

  return (
    <WorkbenchShell
      title={mt("title")}
      description={mt("description")}
      actions={
        <>
          <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={importRegistry} />
          <button className={secondaryButton} type="button" onClick={() => importRef.current?.click()}>
            <Upload size={16} /> {mt("import")}
          </button>
          <button className={secondaryButton} type="button" onClick={exportRegistry}>
            <Download size={16} /> {mt("export")}
          </button>
          <button className={secondaryButton} type="button" onClick={resetWorkingCopy}>
            <RotateCcw size={16} /> {mt("resetDefault")}
          </button>
        </>
      }
      metrics={
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label={mt("metricTotal")} value={items.length} icon={<Layers3 size={18} />} />
          <MetricCard label={mt("metricSelected")} value={selected.size} icon={<CheckSquare size={18} />} />
          <MetricCard label={mt("metricErrors")} value={healthSummary.error} tone={healthSummary.error ? "danger" : "ok"} icon={<AlertTriangle size={18} />} />
          <MetricCard label={mt("metricWarnings")} value={healthSummary.warn} tone={healthSummary.warn ? "warn" : "ok"} icon={<ShieldCheck size={18} />} />
        </div>
      }
    >
      {toast ? (
        <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-sm text-[var(--text)]">
          <span>{toast}</span>
          <button type="button" className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-muted)]" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] p-4">
            <label className="relative min-w-[18rem] flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={18} />
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 pl-10 pr-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={mt("searchPlaceholder")}
              />
            </label>
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
              value={domain}
              onChange={(event) => setDomain(event.target.value as "all" | NavGroupKey)}
            >
              <option value="all">{t("common.all")}</option>
              {NAV_GROUPS.map((group) => (
                <option key={group.key} value={group.key}>
                  {groupLabel(group.key)}
                </option>
              ))}
            </select>
            <button className={secondaryButton} type="button" disabled={!selected.size} onClick={() => batchHidden(true)}>
              <EyeOff size={16} /> {mt("batchHide")}
            </button>
            <button className={secondaryButton} type="button" disabled={!selected.size} onClick={() => batchHidden(false)}>
              <Eye size={16} /> {mt("batchShow")}
            </button>
          </div>
          <div className="max-h-[70vh] overflow-auto p-3">
            {visibleTree.map(({ parent, children }) => (
              <TreeNode
                key={parent.key}
                item={parent}
                childrenCount={children.length}
                expanded={expanded.has(parent.key)}
                selected={selected.has(parent.key)}
                label={labelOf(parent)}
                groupLabel={groupLabel(parent.group)}
                onToggle={() =>
                  setExpanded((next) => {
                    const clone = new Set(next);
                    if (clone.has(parent.key)) clone.delete(parent.key);
                    else clone.add(parent.key);
                    return clone;
                  })
                }
                onSelect={() => toggleSelected(parent.key)}
                onEdit={() => openEditor(parent)}
              >
                {children.map((child) => (
                  <TreeRow
                    key={child.key}
                    item={child}
                    label={labelOf(child)}
                    groupLabel={groupLabel(child.group)}
                    selected={selected.has(child.key)}
                    child
                    onSelect={() => toggleSelected(child.key)}
                    onEdit={() => openEditor(child)}
                  />
                ))}
              </TreeNode>
            ))}
          </div>
        </section>

        <div className="space-y-4">
          <HealthPanel issues={healthIssues} />
          <GovernanceTaskPanel
            preview={taskPreview}
            loading={backlogTasks.isPending}
            priority={taskPriority}
            assignedTo={taskAssignee}
            onPriorityChange={setTaskPriority}
            onAssignedToChange={setTaskAssignee}
            onPreview={() => backlogTasks.mutate(true)}
            onCreate={() => backlogTasks.mutate(false)}
          />
          <BackendHealthPanel
            health={backendHealth.data?.health}
            validation={backendValidation.data?.validation}
            loading={backendHealth.isLoading || backendValidation.isLoading}
            error={backendHealth.error || backendValidation.error}
            onRefresh={() => {
              backendHealth.refetch();
              backendValidation.refetch();
            }}
          />
        </div>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" role="dialog" aria-modal="true">
          <div className="h-full w-full max-w-xl overflow-auto border-l border-[var(--border)] bg-[var(--surface-raised)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">{mt("inlineEditor")}</p>
                <h3 className="mt-1 text-xl font-semibold text-[var(--text)]">{editing.label}</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">{editing.key}</p>
              </div>
              <button className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)]" type="button" onClick={() => setEditing(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="mt-6 space-y-4">
              <Field label={mt("fieldName")}>
                <input className={inputControl} value={editing.label} onChange={(event) => setEditing({ ...editing, label: event.target.value })} />
              </Field>
              <Field label={mt("fieldPath")}>
                <input className={cn(inputControl, "font-mono")} value={editing.path} onChange={(event) => setEditing({ ...editing, path: event.target.value })} />
              </Field>
              <Field label={mt("fieldCapability")}>
                <input className={cn(inputControl, "font-mono")} value={editing.capability} onChange={(event) => setEditing({ ...editing, capability: event.target.value })} />
              </Field>
              <Field label={mt("fieldDomain")}>
                <select className={inputControl} value={editing.group} onChange={(event) => setEditing({ ...editing, group: event.target.value as NavGroupKey })}>
                  {NAV_GROUPS.map((group) => (
                    <option key={group.key} value={group.key}>
                      {groupLabel(group.key)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={mt("fieldBadge")}>
                <select className={inputControl} value={editing.badge} onChange={(event) => setEditing({ ...editing, badge: event.target.value as "" | NavBadge })}>
                  {badgeOptions.map((badge) => (
                    <option key={badge || "none"} value={badge}>
                      {badge || mt("noBadge")}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)]">
                <span>
                  <strong>{mt("hiddenMenu")}</strong>
                  <span className="ml-2 text-[var(--muted)]">{mt("hiddenHint")}</span>
                </span>
                <input type="checkbox" checked={editing.hidden} onChange={(event) => setEditing({ ...editing, hidden: event.target.checked })} />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button className={secondaryButton} type="button" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </button>
              <button className={primaryButton} type="button" onClick={saveEditor}>
                {mt("saveAndCheck")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </WorkbenchShell>
  );
}

function GovernanceTaskPanel({
  preview,
  loading,
  priority,
  assignedTo,
  onPriorityChange,
  onAssignedToChange,
  onPreview,
  onCreate,
}: {
  preview: any | null;
  loading: boolean;
  priority: "P0" | "P1" | "P2" | "P3";
  assignedTo: string;
  onPriorityChange: (value: "P0" | "P1" | "P2" | "P3") => void;
  onAssignedToChange: (value: string) => void;
  onPreview: () => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const planned = Array.isArray(preview?.planned) ? preview.planned : [];
  const skipped = Array.isArray(preview?.skipped) ? preview.skipped : [];
  const created = Array.isArray(preview?.created) ? preview.created : [];
  return (
    <aside className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]">
      <div className="border-b border-[var(--border)] p-4">
        <div className="flex items-center gap-2 text-base font-semibold text-[var(--text)]">
          <CheckSquare size={18} className="text-[var(--accent)]" />
          {t("page.menuManagement.governanceTasks")}
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("page.menuManagement.governanceTasksDesc")}</p>
      </div>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs font-medium text-[var(--muted)]">
            {t("page.menuManagement.priority")}
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
              value={priority}
              onChange={(event) => onPriorityChange(event.target.value as "P0" | "P1" | "P2" | "P3")}
            >
              {["P0", "P1", "P2", "P3"].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-[var(--muted)]">
            {t("page.menuManagement.assignee")}
            <input
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
              value={assignedTo}
              onChange={(event) => onAssignedToChange(event.target.value)}
              placeholder={t("page.menuManagement.defaultAssignee")}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryButton} type="button" disabled={loading} onClick={onPreview}>
            <Eye size={16} /> {t("page.menuManagement.previewTasks")}
          </button>
          <button className={primaryButton} type="button" disabled={loading} onClick={onCreate}>
            <CheckSquare size={16} /> {t("page.menuManagement.createTasks")}
          </button>
        </div>
        {preview ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div><div className="text-[var(--muted)]">{t("page.menuManagement.planned")}</div><div className="text-lg font-semibold text-[var(--text)]">{planned.length}</div></div>
              <div><div className="text-[var(--muted)]">{t("page.menuManagement.created")}</div><div className="text-lg font-semibold text-[var(--text)]">{created.length}</div></div>
              <div><div className="text-[var(--muted)]">{t("page.menuManagement.skipped")}</div><div className="text-lg font-semibold text-[var(--text)]">{skipped.length}</div></div>
            </div>
            <div className="mt-3 max-h-44 space-y-2 overflow-auto pr-1">
              {planned.slice(0, 6).map((task: any) => (
                <div key={`${task.title}-${task.priority}`} className="rounded-md bg-[var(--surface-muted)] px-3 py-2 text-xs">
                  <div className="font-semibold text-[var(--text)]">{task.title}</div>
                  <div className="mt-1 text-[var(--muted)]">{task.description ?? task.status ?? t("page.menuManagement.waitingCreate")}</div>
                </div>
              ))}
              {!planned.length ? <div className="text-xs text-[var(--muted)]">{t("page.menuManagement.noNewTasks")}</div> : null}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function BackendHealthPanel({
  health,
  validation,
  loading,
  error,
  onRefresh,
}: {
  health?: any;
  validation?: any;
  loading: boolean;
  error: unknown;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const summary = health?.summary ?? {};
  const issues = Array.isArray(health?.top_issues) ? health.top_issues : Array.isArray(health?.issues) ? health.issues.slice(0, 8) : [];
  const validationIssueCount = Array.isArray(validation?.issues) ? validation.issues.length : 0;
  return (
    <aside className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-[var(--text)]">
            <FileInput size={18} className="text-[var(--accent)]" />
            {t("page.menuManagement.backendStatus")}
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("page.menuManagement.backendStatusDesc")}</p>
        </div>
        <button type="button" className={secondaryButton} onClick={onRefresh}>{t("common.refresh")}</button>
      </div>
      <div className="space-y-3 p-4">
        {loading ? <div className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--muted)]">{t("page.menuManagement.loadingBackend")}</div> : null}
        {error ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("page.menuManagement.backendHealthUnavailable")}</div> : null}
        {!loading && !error ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-lg bg-[var(--surface)] p-3"><div className="text-[var(--muted)]">{t("page.menuManagement.healthScore")}</div><div className="text-xl font-semibold text-[var(--text)]">{health?.score ?? "-"}</div></div>
              <div className="rounded-lg bg-[var(--surface)] p-3"><div className="text-[var(--muted)]">{t("page.menuManagement.issues")}</div><div className="text-xl font-semibold text-[var(--text)]">{summary.issues ?? issues.length}</div></div>
              <div className="rounded-lg bg-[var(--surface)] p-3"><div className="text-[var(--muted)]">{t("page.menuManagement.consistency")}</div><div className="text-xl font-semibold text-[var(--text)]">{validationIssueCount}</div></div>
            </div>
            <div className="space-y-2">
              {issues.length ? issues.map((issue: any) => (
                <div key={`${issue.category ?? issue.code}-${issue.module_id ?? issue.key}-${issue.title ?? issue.detail}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
                  <div className="font-semibold text-[var(--text)]">{issue.title ?? issue.code ?? t("page.menuManagement.governanceIssue")}</div>
                  <div className="mt-1 text-[var(--muted)]">{issue.detail ?? issue.message ?? t("page.menuManagement.inspectContract")}</div>
                </div>
              )) : <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{t("page.menuManagement.backendHealthy")}</div>}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function MetricCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className={cn("rounded-xl border bg-[var(--surface-raised)] p-4", tone === "danger" && "border-red-200", tone === "warn" && "border-amber-200", tone === "ok" && "border-emerald-200")}>
      <div className="flex items-center gap-2 text-sm text-[var(--muted)]">{icon}{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}

function HealthPanel({ issues }: { issues: ReturnType<typeof validateNavRegistry> }) {
  const { t } = useTranslation();
  const errors = issues.filter((issue) => issue.level === "error");
  const warns = issues.filter((issue) => issue.level === "warn");
  return (
    <aside className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]">
      <div className="border-b border-[var(--border)] p-4">
        <div className="flex items-center gap-2 text-base font-semibold text-[var(--text)]">
          {issues.length ? <AlertTriangle size={18} className="text-amber-500" /> : <CheckCircle2 size={18} className="text-emerald-600" />}
          {t("page.menuManagement.realtimeHealth")}
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("page.menuManagement.realtimeHealthDesc")}</p>
      </div>
      <div className="max-h-[70vh] space-y-4 overflow-auto p-4">
        {!issues.length ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{t("page.menuManagement.frontendHealthy")}</div>
        ) : (
          <>
            <IssueList title={t("page.menuManagement.issueError")} issues={errors} tone="error" />
            <IssueList title={t("page.menuManagement.issueWarning")} issues={warns} tone="warn" />
          </>
        )}
      </div>
    </aside>
  );
}

function IssueList({ title, issues, tone }: { title: string; issues: ReturnType<typeof validateNavRegistry>; tone: "error" | "warn" }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm font-semibold text-[var(--text)]">
        <span>{title}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs", tone === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>{issues.length}</span>
      </div>
      <div className="space-y-2">
        {issues.map((issue) => (
          <div key={`${issue.code}-${issue.key}-${issue.message}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
            <div className="font-mono text-xs text-[var(--muted)]">{issue.code}{issue.key ? ` · ${issue.key}` : ""}</div>
            <div className="mt-1 text-[var(--text)]">{issue.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TreeNode(props: {
  item: ManagedNavItem;
  label: string;
  groupLabel: string;
  childrenCount: number;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const Icon = props.item.icon;
  return (
    <div className="mb-2 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-2 p-3">
        <button className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-muted)]" type="button" onClick={props.onToggle}>
          {props.childrenCount ? props.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : <span className="block w-4" />}
        </button>
        <button className="text-[var(--muted)]" type="button" onClick={props.onSelect}>
          {props.selected ? <CheckSquare size={18} /> : <Square size={18} />}
        </button>
        <Icon size={18} className="text-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--text)]">{props.label}</span>
            <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted)]">{props.groupLabel}</span>
            {props.item.badge ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">{props.item.badge}</span> : null}
            {props.item.hidden ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t("page.menuManagement.hidden")}</span> : null}
          </div>
          <div className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{props.item.path} · {props.item.capability ?? t("page.menuManagement.missingCapability")}</div>
        </div>
        <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--muted)]">{props.childrenCount}</span>
        <button className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)]" type="button" onClick={props.onEdit}>
          <Pencil size={16} />
        </button>
      </div>
      {props.expanded ? <div className="space-y-1 border-t border-[var(--border)] px-3 py-2">{props.children}</div> : null}
    </div>
  );
}

function TreeRow({
  item,
  label,
  groupLabel,
  selected,
  child,
  onSelect,
  onEdit,
}: {
  item: ManagedNavItem;
  label: string;
  groupLabel: string;
  selected: boolean;
  child?: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-[var(--surface-muted)]", child && "ml-8")}>
      <button className="text-[var(--muted)]" type="button" onClick={onSelect}>
        {selected ? <CheckSquare size={16} /> : <Square size={16} />}
      </button>
      <Icon size={16} className="text-[var(--muted)]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-[var(--text)]">{label}</span>
          <span className="text-xs text-[var(--muted)]">{groupLabel}</span>
          {item.hidden ? <EyeOff size={14} className="text-[var(--muted)]" /> : null}
        </div>
        <div className="truncate font-mono text-xs text-[var(--muted)]">{item.path} · {item.capability ?? t("page.menuManagement.missingCapability")}</div>
      </div>
      <button className="rounded-md p-2 text-[var(--muted)] hover:bg-[var(--surface)]" type="button" onClick={onEdit}>
        <Pencil size={15} />
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--text)]">{label}</span>
      {children}
    </label>
  );
}
