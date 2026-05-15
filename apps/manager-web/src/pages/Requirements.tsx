import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  NeedLogin,
  RefreshButton,
  SearchInput,
} from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";

const STATUS_ALL = "__all__";
const PRIORITY_ALL = "__all__";
const STATUSES = ["pending", "in_progress", "blocked", "completed"] as const;
const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
const fieldClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const secondaryButtonClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";
const primaryButtonClass =
  "inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50";

type RequirementRow = {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  story_points?: number;
  acceptance_criteria?: string[];
  tags?: string[];
  assigned_agent?: string;
  dev_tool?: string;
  human_notes?: string;
};

type Draft = {
  title: string;
  description: string;
  priority: string;
  status: string;
  acceptance_criteria: string;
  tags: string;
  assigned_agent: string;
  dev_tool: string;
  human_notes: string;
};

const emptyDraft: Draft = {
  title: "",
  description: "",
  priority: "P1",
  status: "pending",
  acceptance_criteria: "",
  tags: "",
  assigned_agent: "",
  dev_tool: "",
  human_notes: "",
};

function toLines(value?: string[] | string): string {
  if (Array.isArray(value)) return value.join("\n");
  return String(value ?? "");
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitTags(value: string): string[] {
  return value
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function draftFromRow(row: RequirementRow): Draft {
  return {
    title: row.title ?? "",
    description: row.description ?? "",
    priority: row.priority ?? "P1",
    status: row.status ?? "pending",
    acceptance_criteria: toLines(row.acceptance_criteria),
    tags: (row.tags ?? []).join(", "),
    assigned_agent: row.assigned_agent ?? "",
    dev_tool: row.dev_tool ?? "",
    human_notes: row.human_notes ?? "",
  };
}

function createBody(draft: Draft) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    priority: draft.priority,
    acceptance_criteria: splitLines(draft.acceptance_criteria),
    tags: splitTags(draft.tags),
    assigned_agent: draft.assigned_agent.trim(),
    dev_tool: draft.dev_tool.trim(),
  };
}

function updateBody(draft: Draft) {
  return {
    ...createBody(draft),
    status: draft.status,
    human_notes: draft.human_notes.trim(),
  };
}

const statusTone: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  blocked: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};

export function Requirements() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState(STATUS_ALL);
  const [priority, setPriority] = useState(PRIORITY_ALL);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);

  const q = useQuery({
    queryKey: ["requirements"],
    queryFn: api.requirements,
    enabled: authed && hasProject,
  });

  const requirements = (q.data ?? []) as RequirementRow[];
  const metrics = useMemo(() => {
    const byStatus = new Map<string, number>();
    const byPriority = new Map<string, number>();
    for (const row of requirements) {
      const st = row.status || "pending";
      const pr = row.priority || "P?";
      byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
      byPriority.set(pr, (byPriority.get(pr) ?? 0) + 1);
    }
    return { total: requirements.length, byStatus, byPriority };
  }, [requirements]);

  const statuses = useMemo(() => {
    const set = new Set<string>(STATUSES);
    for (const r of requirements) {
      if (r.status) set.add(String(r.status));
    }
    return Array.from(set);
  }, [requirements]);

  const filtered = useMemo(() => {
    let list = requirements;
    if (status !== STATUS_ALL) list = list.filter((r) => r.status === status);
    if (priority !== PRIORITY_ALL) list = list.filter((r) => r.priority === priority);
    const k = keyword.trim().toLowerCase();
    if (!k) return list;
    return list.filter(
      (r) =>
        String(r.title ?? "").toLowerCase().includes(k) ||
        String(r.id ?? "").toLowerCase().includes(k) ||
        String(r.description ?? "").toLowerCase().includes(k) ||
        String(r.assigned_agent ?? "").toLowerCase().includes(k) ||
        String(r.dev_tool ?? "").toLowerCase().includes(k),
    );
  }, [requirements, keyword, status, priority]);

  const refreshRequirements = () => {
    void qc.invalidateQueries({ queryKey: ["requirements"] });
  };

  const createReq = useMutation({
    mutationFn: () => api.createRequirement(createBody(draft)),
    onSuccess: () => {
      setDraft(emptyDraft);
      setCreateOpen(false);
      refreshRequirements();
    },
  });

  const updateReq = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.updateRequirement(id, patch),
    onSuccess: () => {
      setEditingId("");
      refreshRequirements();
    },
  });

  const deleteReq = useMutation({
    mutationFn: (id: string) => api.deleteRequirement(id),
    onSuccess: refreshRequirements,
  });

  const busy = createReq.isPending || updateReq.isPending || deleteReq.isPending;

  if (!authed) return <NeedLogin />;
  if (!hasProject) {
    return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;
  }

  return (
    <div className="w-full space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard icon={<ClipboardList className="h-4 w-4" />} label={t("page.requirements.total")} value={metrics.total} />
        <MetricCard label={t("page.requirements.pending")} value={metrics.byStatus.get("pending") ?? 0} />
        <MetricCard label={t("page.requirements.inProgress")} value={metrics.byStatus.get("in_progress") ?? 0} />
        <MetricCard icon={<CheckCircle2 className="h-4 w-4" />} label={t("page.requirements.completed")} value={metrics.byStatus.get("completed") ?? 0} />
      </div>

      <Card
        title={t("page.requirements.list")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => setCreateOpen((v) => !v)}
            >
              {createOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {createOpen ? t("common.cancel") : t("page.requirements.create")}
            </button>
            <SearchInput value={keyword} onChange={setKeyword} />
            <select
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value={STATUS_ALL}>{t("page.requirements.allStatus")}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(t, s)}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value={PRIORITY_ALL}>{t("page.requirements.allPriority")}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p} ({metrics.byPriority.get(p) ?? 0})
                </option>
              ))}
            </select>
            <RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />
          </div>
        }
      >
        {createOpen ? (
          <RequirementEditor
            draft={draft}
            onChange={setDraft}
            onCancel={() => setCreateOpen(false)}
            onSubmit={() => createReq.mutate()}
            submitLabel={t("page.requirements.create")}
            busy={busy}
            error={createReq.error}
            mode="create"
          />
        ) : null}

        {q.isLoading ? <LoadingBlock /> : null}
        {q.error ? <ErrorBlock message={(q.error as Error).message} /> : null}
        {!q.isLoading && !q.error && filtered.length === 0 ? (
          <EmptyState message={t("page.requirements.empty")} />
        ) : null}

        <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((r) =>
            editingId === r.id ? (
              <RequirementEditor
                key={r.id}
                draft={editDraft}
                onChange={setEditDraft}
                onCancel={() => setEditingId("")}
                onSubmit={() => updateReq.mutate({ id: r.id, patch: updateBody(editDraft) })}
                submitLabel={t("common.save")}
                busy={busy}
                error={updateReq.error}
                mode="edit"
              />
            ) : (
              <article
                key={r.id}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/70"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold dark:bg-slate-800">
                        {r.priority ?? "P?"}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${statusTone[r.status ?? ""] ?? statusTone.pending}`}>
                        {statusLabel(t, r.status || "pending")}
                      </span>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-slate-950 dark:text-slate-50">
                      {r.title}
                    </h3>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">{r.id}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      title={t("page.requirements.edit")}
                      onClick={() => {
                        setEditingId(r.id);
                        setEditDraft(draftFromRow(r));
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:hover:bg-rose-950/40"
                      title={t("page.requirements.delete")}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(t("page.requirements.confirmDelete", { title: r.title || r.id }))) {
                          deleteReq.mutate(r.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {r.description ? (
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    {r.description}
                  </p>
                ) : null}
                <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                  <Info label={t("page.requirements.agent")} value={r.assigned_agent || "-"} />
                  <Info label={t("page.requirements.devTool")} value={r.dev_tool || "-"} />
                </div>
                {r.acceptance_criteria?.length ? (
                  <ul className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                    {r.acceptance_criteria.slice(0, 3).map((x, i) => (
                      <li key={`${r.id}-ac-${i}`} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-500" />
                        <span>{x}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ),
          )}
        </div>

        {deleteReq.error ? (
          <p className="mt-3 text-sm text-rose-600">{(deleteReq.error as Error).message}</p>
        ) : null}
      </Card>
    </div>
  );
}

function RequirementEditor({
  draft,
  onChange,
  onCancel,
  onSubmit,
  submitLabel,
  busy,
  error,
  mode,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  busy: boolean;
  error: unknown;
  mode: "create" | "edit";
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <form
      className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.title.trim()) return;
        onSubmit();
      }}
    >
      <div className="grid gap-3 lg:grid-cols-4">
        <Field label={t("page.requirements.titlePh")} className="lg:col-span-2">
          <input
            className={fieldClass}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            required
          />
        </Field>
        <Field label={t("page.requirements.priority")}>
          <select className={fieldClass} value={draft.priority} onChange={(e) => set({ priority: e.target.value })}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        {mode === "edit" ? (
          <Field label={t("page.requirements.status")}>
            <select className={fieldClass} value={draft.status} onChange={(e) => set({ status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(t, s)}</option>)}
            </select>
          </Field>
        ) : (
          <Field label={t("page.requirements.tags")}>
            <input className={fieldClass} value={draft.tags} onChange={(e) => set({ tags: e.target.value })} />
          </Field>
        )}
        <Field label={t("page.requirements.description")} className="lg:col-span-4">
          <textarea
            className={`${fieldClass} min-h-24`}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
        <Field label={t("page.requirements.acceptance")} className="lg:col-span-2">
          <textarea
            className={`${fieldClass} min-h-24`}
            value={draft.acceptance_criteria}
            onChange={(e) => set({ acceptance_criteria: e.target.value })}
            placeholder={t("page.requirements.acceptancePh")}
          />
        </Field>
        <div className="grid gap-3 lg:col-span-2">
          <Field label={t("page.requirements.agent")}>
            <input className={fieldClass} value={draft.assigned_agent} onChange={(e) => set({ assigned_agent: e.target.value })} />
          </Field>
          <Field label={t("page.requirements.devTool")}>
            <input className={fieldClass} value={draft.dev_tool} onChange={(e) => set({ dev_tool: e.target.value })} />
          </Field>
          {mode === "edit" ? (
            <Field label={t("page.requirements.notes")}>
              <input className={fieldClass} value={draft.human_notes} onChange={(e) => set({ human_notes: e.target.value })} />
            </Field>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onCancel} disabled={busy}>
          <X className="h-4 w-4" />
          {t("common.cancel")}
        </button>
        <button type="submit" className={primaryButtonClass} disabled={busy || !draft.title.trim()}>
          <Save className="h-4 w-4" />
          {submitLabel}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-rose-600">{(error as Error).message}</p> : null}
    </form>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-slate-500 ${className}`}>
      {label}
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 px-2 py-1.5 dark:border-slate-700">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-slate-700 dark:text-slate-300">{value}</p>
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: number; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{label}</p>
        {icon ? <span className="rounded-lg bg-sky-500/10 p-2 text-sky-500">{icon}</span> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">{value}</p>
    </div>
  );
}

function statusLabel(t: (key: string) => string, status: string): string {
  const key = `page.requirements.statusMap.${status}`;
  const label = t(key);
  return label === key ? status : label;
}
