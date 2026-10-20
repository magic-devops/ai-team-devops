import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Input as AntInput, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { BrainCircuit, Pencil, Plus, Save, Trash2, Wand2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  NeedLogin,
  RefreshButton,
  SearchInput,
} from "@/components/PageStates";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { api } from "@/lib/api";
import { ProjectScopeNotice } from "@/components/ProjectContextGate";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { getProjectId, getToken } from "@/lib/authStorage";
import { RequirementIntake } from "./product/RequirementIntake";
import { RequirementAssistance } from "./product/RequirementAssistance";
import { ProductRequirementsShell } from "./product/ProductRequirementsShell";
import { parseRequirementsHash } from "./product/requirementsNav";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";
import { requirementListFilters, requirementPlanningHref } from "@/lib/requirementPlanning";

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

export type RequirementMode = "pool" | "review" | "generation" | "batch";

export function Requirements({
  initialMode = "pool",
  focused = false,
}: {
  initialMode?: RequirementMode;
  focused?: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const projectId = getProjectId() || "";
  const hasProject = Boolean(projectId);
  const origin = projectSessionKey();
  const readInScope = <T,>(read: () => Promise<T>) => {
    if (origin !== projectSessionKey()) throw new Error("账号或项目已切换，请在当前工作区重新操作");
    return read();
  };
  const [mode, setMode] = useState<RequirementMode>(initialMode);
  const [routeFocused, setRouteFocused] = useState(focused);

  const applyRoute = (next: ReturnType<typeof parseRequirementsHash>) => {
    setMode(next.mode);
    setRouteFocused(next.focused);
  };

  useEffect(() => {
    applyRoute(parseRequirementsHash(window.location.hash));
    const onHash = () => applyRoute(parseRequirementsHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    applyRoute({ mode: initialMode, focused });
  }, [initialMode, focused]);
  const [keyword, setKeyword] = useState(() => requirementListFilters(window.location.hash).keyword);
  const [status, setStatus] = useState(() => requirementListFilters(window.location.hash).status);
  const [priority, setPriority] = useState(() => requirementListFilters(window.location.hash).priority);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [taskPlanReqId, setTaskPlanReqId] = useState("");
  const [reviewReqId, setReviewReqId] = useState("");
  const [selectedReqIds, setSelectedReqIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkPriority, setBulkPriority] = useState("");
  const [bulkAgent, setBulkAgent] = useState("");
  const [bulkTool, setBulkTool] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContextReq, setAiContextReq] = useState<RequirementRow | null>(null);
  const [opsTaskResult, setOpsTaskResult] = useState<any>(null);

  const q = useQuery({
    queryKey: ["requirements", keyword, status, priority, origin],
    queryFn: () => readInScope(() =>
      api.requirements({
        q: keyword.trim(),
        status: status === STATUS_ALL ? "" : status,
        priority: priority === PRIORITY_ALL ? "" : priority,
      })),
    enabled: authed && hasProject,
  });
  const summaryQ = useQuery({
    queryKey: ["requirementsSummary", origin],
    queryFn: () => readInScope(api.requirementsSummary),
    enabled: authed && hasProject,
  });
  const opsPlanQ = useQuery({
    queryKey: ["requirementOpsPlan", origin],
    queryFn: () => readInScope(api.requirementOpsPlan),
    enabled: authed && hasProject,
  });

  const listReady = !q.error && Array.isArray(q.data);
  const summaryReady = !summaryQ.error && Boolean(summaryQ.data?.summary);
  const opsReady = !opsPlanQ.error && Boolean(opsPlanQ.data?.health);
  const requirements = (listReady ? q.data : []) as RequirementRow[];
  const metrics = useMemo(() => {
    const summary = summaryReady ? summaryQ.data.summary : {};
    return {
      total: Number(summary.total ?? 0),
      byStatus: new Map<string, number>(Object.entries(summary.by_status ?? {}).map(([k, v]) => [k, Number(v)])),
      byPriority: new Map<string, number>(Object.entries(summary.by_priority ?? {}).map(([k, v]) => [k, Number(v)])),
    };
  }, [summaryReady, summaryQ.data]);

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
    void qc.invalidateQueries({ queryKey: ["requirementsSummary"] });
    void qc.invalidateQueries({ queryKey: ["requirementsHub"] });
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

  const bulkUpdateReq = useMutation({
    mutationFn: () =>
      api.bulkUpdateRequirements({
        ids: selectedReqIds,
        status: bulkStatus || undefined,
        priority: bulkPriority || undefined,
        assigned_agent: bulkAgent.trim() || undefined,
        dev_tool: bulkTool.trim() || undefined,
      }),
    onSuccess: () => {
      setSelectedReqIds([]);
      setBulkStatus("");
      setBulkPriority("");
      setBulkAgent("");
      setBulkTool("");
      refreshRequirements();
    },
  });

  const opsTasksMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.requirementOpsTasks({ dry_run: dryRun, priority: "P1", limit: 20 }),
    onSuccess: (data) => {
      setOpsTaskResult(data);
      void qc.invalidateQueries({ queryKey: ["requirements"] });
      void qc.invalidateQueries({ queryKey: ["requirementsSummary"] });
      void qc.invalidateQueries({ queryKey: ["requirementOpsPlan"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const busy = createReq.isPending || updateReq.isPending || deleteReq.isPending || bulkUpdateReq.isPending || opsTasksMut.isPending;
  const selectedReqSet = useMemo(() => new Set(selectedReqIds), [selectedReqIds]);
  const canBulkUpdate = selectedReqIds.length > 0 && Boolean(bulkStatus || bulkPriority || bulkAgent.trim() || bulkTool.trim());

  const hubSummary = summaryReady ? summaryQ.data.summary : {};
  const kitTotal = Number(hubSummary.total ?? metrics.total);
  const kitReady = Number(hubSummary.ready ?? 0);
  const kitCompleted = Number(hubSummary.completed ?? metrics.byStatus.get("completed") ?? 0);
  const kitCompletion = Number(hubSummary.completion_rate ?? 0);

  const displayList = useMemo(() => {
    if (mode === "review") {
      return [...filtered].sort((a, b) => {
        const aScore = (a.acceptance_criteria?.length ?? 0) > 0 ? 1 : 0;
        const bScore = (b.acceptance_criteria?.length ?? 0) > 0 ? 1 : 0;
        return aScore - bScore;
      });
    }
    if (mode === "generation") {
      const rank = (s?: string) => (s === "in_progress" ? 0 : s === "pending" ? 1 : 2);
      return [...filtered].sort((a, b) => rank(a.status) - rank(b.status));
    }
    return filtered;
  }, [filtered, mode]);

  const showCreate = !routeFocused || mode === "pool";
  const showBulkPanel = !routeFocused || mode === "pool" || mode === "batch";
  const showCardReview = !routeFocused || mode === "pool" || mode === "review";
  const showCardGenerate = !routeFocused || mode === "pool" || mode === "generation";

  if (!authed) return <NeedLogin />;
  if (!hasProject) {
    return <ProjectScopeNotice />;
  }

  const refreshReads = () => { void q.refetch(); void summaryQ.refetch(); void opsPlanQ.refetch(); };
  const accessError = [q.error, summaryQ.error, opsPlanQ.error].find((error) => error instanceof Error && (
    /^HTTP (?:401|403|404)(?::|\b)/.test(error.message) || error.message === "账号或项目已切换，请在当前工作区重新操作"
  ));
  if (accessError) return <ProjectScopeNotice message={(accessError as Error).message} onRetry={refreshReads} />;

  const aiReq = listReady ? aiContextReq ?? requirements.find((r) => r.id === reviewReqId) ?? requirements[0] ?? null : null;
  const workbenchFocused = routeFocused;
  const opsRiskColumns: ColumnsType<any> = [
    {
      title: t("page.requirements.opsSeverity"),
      dataIndex: "severity",
      width: 88,
      render: (value) => <Tag color={value === "P0" || value === "P1" ? "red" : "orange"}>{value}</Tag>,
    },
    { title: t("page.requirements.opsCategory"), dataIndex: "category", width: 120 },
    {
      title: t("page.requirements.opsRisk"),
      dataIndex: "title",
      ellipsis: true,
      render: (value, row) => (
        <div>
          <p className="font-medium text-[var(--text)]">{value}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{row.description}</p>
        </div>
      ),
    },
    {
      title: t("page.requirements.opsCommand"),
      dataIndex: "command",
      width: 280,
      render: (value) => <Typography.Text code copyable className="!text-xs">{value}</Typography.Text>,
    },
  ];
  const showIntakePanel = !workbenchFocused || mode === "pool";

  const readFailure = (label: string, error: unknown, retrying: boolean, retry: () => void) => (
    <Alert className="mb-3" type="warning" showIcon message={label} description={(error as Error).message}
      action={<Button size="small" aria-label={`${label}: ${t("common.refresh")}`} loading={retrying} disabled={retrying} onClick={retry}>{t("common.refresh")}</Button>} />
  );
  const workbenchBody = (
    <>
      {summaryQ.error ? readFailure(t("page.requirements.total"), summaryQ.error, summaryQ.isFetching, () => { void summaryQ.refetch(); }) : null}
      {showIntakePanel ? <RequirementIntake onImported={refreshRequirements} /> : null}

      <Card
        title={t("page.requirements.opsPlan")}
        actions={
          <Space wrap>
            <Button disabled={!opsReady} loading={opsTasksMut.isPending} onClick={() => opsTasksMut.mutate(true)}>
              {t("page.requirements.opsPreview")}
            </Button>
            <Button type="primary" disabled={!opsReady} loading={opsTasksMut.isPending} onClick={() => opsTasksMut.mutate(false)}>
              {t("page.requirements.opsCreate")}
            </Button>
          </Space>
        }
      >
        {opsPlanQ.error ? readFailure(t("page.requirements.opsPlan"), opsPlanQ.error, opsPlanQ.isFetching, () => { void opsPlanQ.refetch(); }) : null}
        {!opsReady && !opsPlanQ.error ? <LoadingBlock /> : null}
        {opsTasksMut.error ? <ErrorBlock message={(opsTasksMut.error as Error).message} /> : null}
        {opsReady ? <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
          <div className="rounded-md border border-[var(--border)] bg-[var(--panel-muted)] p-4">
            <Statistic
              title={t("page.requirements.opsHealth")}
              value={opsPlanQ.data?.health?.score ?? 0}
              suffix="/ 100"
              valueStyle={{ color: opsPlanQ.data?.health?.grade === "risk" ? "#dc2626" : "var(--brand)" }}
            />
            <Tag className="mt-3" color={opsPlanQ.data?.health?.grade === "healthy" ? "green" : opsPlanQ.data?.health?.grade === "watch" ? "gold" : "red"}>
              {opsPlanQ.data?.health?.grade ?? "-"}
            </Tag>
            <div className="mt-4 space-y-1 text-xs text-[var(--muted)]">
              <div>{t("page.requirements.opsAvgScore")}: {opsPlanQ.data?.health?.avg_review_score ?? 0}</div>
              <div>{t("page.requirements.opsNeedsWork")}: {opsPlanQ.data?.summary?.needs_work ?? 0}</div>
              <div>{t("page.requirements.opsHighNoTasks")}: {opsPlanQ.data?.summary?.high_priority_without_tasks ?? 0}</div>
            </div>
          </div>
          <div className="min-w-0">
            <Alert
              className="mb-3"
              showIcon
              type={opsPlanQ.data?.health?.grade === "risk" ? "warning" : "info"}
              message={t("page.requirements.opsHint")}
              description={<Typography.Text code copyable>sop requirement ops-plan --json</Typography.Text>}
            />
            {opsTaskResult ? (
              <Alert
                className="mb-3"
                type="success"
                showIcon
                message={t("page.requirements.opsTasksResult", {
                  planned: opsTaskResult?.summary?.planned ?? 0,
                  created: opsTaskResult?.summary?.created ?? 0,
                })}
              />
            ) : null}
            <Table
              rowKey="id"
              size="small"
              loading={opsPlanQ.isLoading}
              columns={opsRiskColumns}
              dataSource={opsPlanQ.data?.risks ?? []}
              pagination={false}
              scroll={{ x: 820 }}
              locale={{ emptyText: t("page.requirements.opsNoRisks") }}
            />
          </div>
        </div> : null}
      </Card>

      {listReady && workbenchFocused && mode !== "pool" ? (
        <RequirementsModeWorkbench
          mode={mode}
          requirements={displayList}
          reviewReqId={reviewReqId}
          onPickReview={setReviewReqId}
          onAppliedReview={refreshRequirements}
          onCloseReview={() => setReviewReqId("")}
          taskPlanReqId={taskPlanReqId}
          onPickGeneration={(row) => setTaskPlanReqId(row.id)}
          planningHref={(id) => requirementPlanningHref(id, projectId, window.location.hash, { keyword, status, priority })}
          onCloseTaskPlan={() => setTaskPlanReqId("")}
        />
      ) : null}

      <Card
        title={t("page.requirements.list")}
        actions={
          showCreate ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                onClick={() => setCreateOpen((v) => !v)}
              >
                {createOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {createOpen ? t("common.cancel") : t("page.requirements.create")}
              </button>
            </div>
          ) : null
        }
      >
        <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]">
            <SearchInput value={keyword} onChange={setKeyword} />
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text)]"
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
              className="rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text)]"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value={PRIORITY_ALL}>{t("page.requirements.allPriority")}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p} ({summaryReady ? metrics.byPriority.get(p) ?? 0 : "—"})
                </option>
              ))}
            </select>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => {
                setKeyword("");
                setStatus(STATUS_ALL);
                setPriority(PRIORITY_ALL);
              }}
            >
              {t("page.requirements.clearFilters")}
            </button>
          </div>
        </div>

        {createOpen && showCreate ? (
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

        {showBulkPanel && listReady ? renderBulkPanel() : null}

        {!listReady && !q.error ? <LoadingBlock /> : null}
        {q.error ? readFailure(t("page.requirements.list"), q.error, q.isFetching, () => { void q.refetch(); }) : null}
        {listReady && displayList.length === 0 ? (
          <EmptyState message={t("page.requirements.empty")} />
        ) : null}

        <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {displayList.map((r) =>
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
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {(routeFocused && mode === "batch") || !routeFocused ? (
                        <Checkbox
                          checked={selectedReqSet.has(r.id)}
                          onChange={(e) => {
                            setSelectedReqIds((prev) =>
                              e.target.checked ? Array.from(new Set([...prev, r.id])) : prev.filter((id) => id !== r.id),
                            );
                          }}
                        />
                      ) : null}
                      <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-xs font-semibold">
                        {r.priority ?? "P?"}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${statusTone[r.status ?? ""] ?? statusTone.pending}`}>
                        {statusLabel(t, r.status || "pending")}
                      </span>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-[var(--text)]">{r.title}</h3>
                    <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{r.id}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {showCardGenerate ? (
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--brand)]/30 p-2 text-[var(--brand)] hover:bg-[var(--brand-soft)] disabled:opacity-50"
                        title={t("delivery.plan")}
                        disabled={busy}
                        onClick={() => {
                          window.location.hash = requirementPlanningHref(r.id, projectId, window.location.hash, { keyword, status, priority });
                        }}
                      >
                        <Wand2 className="h-4 w-4" />
                      </button>
                    ) : null}
                    {showCardReview ? (
                      <button
                        type="button"
                        className="rounded-lg border border-violet-200 p-2 text-violet-600 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/40"
                        title={t("assistance.reviewWorkspace")}
                        disabled={busy}
                        onClick={() => {
                          setReviewReqId(r.id);
                        }}
                      >
                        <BrainCircuit className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                      title={t("page.requirements.edit")}
                      onClick={() => {
                        setEditingId(r.id);
                        setEditDraft(draftFromRow(r));
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {(!routeFocused || mode === "pool") && (
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
                    )}
                  </div>
                </div>
                {r.description ? (
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-[var(--muted-strong)]">{r.description}</p>
                ) : null}
                <div className="mt-3 grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-2">
                  <Info label={t("page.requirements.agent")} value={r.assigned_agent || "-"} />
                  <Info label={t("page.requirements.devTool")} value={r.dev_tool || "-"} />
                </div>
                {r.acceptance_criteria?.length ? (
                  <ul className="mt-3 space-y-1 text-xs text-[var(--muted-strong)]">
                    {r.acceptance_criteria.slice(0, 3).map((x, i) => (
                      <li key={`${r.id}-ac-${i}`} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
                        <span>{x}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {reviewReqId === r.id && showCardReview && !workbenchFocused ? (
                  <RequirementAssistance key={r.id} requirementId={r.id} onApplied={refreshRequirements} onClose={() => setReviewReqId("")} />
                ) : null}
              </article>
            ),
          )}
        </div>

        {deleteReq.error ? (
          <p className="mt-3 text-sm text-rose-600">{(deleteReq.error as Error).message}</p>
        ) : null}
      </Card>
    </>
  );

  function renderBulkPanel() {
    return (
      <div
        className={`mb-4 rounded-lg border p-3 ${
          workbenchFocused && mode === "batch"
            ? "border-[var(--brand)]/50 bg-[var(--brand-softer)] ring-1 ring-[var(--brand)]/20"
            : "border-[var(--border)] bg-[var(--surface-muted)]"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--muted-strong)]">
            {t("page.requirements.bulkSelected", { count: selectedReqIds.length })}
          </span>
          <Button
            size="small"
            onClick={() => setSelectedReqIds(displayList.map((item) => item.id).filter(Boolean))}
            disabled={!displayList.length}
          >
            {t("page.requirements.selectAll")}
          </Button>
          <Button size="small" onClick={() => setSelectedReqIds([])} disabled={!selectedReqIds.length}>
            {t("page.requirements.clearSelection")}
          </Button>
          <Select
            className="min-w-40"
            allowClear
            placeholder={t("page.requirements.bulkStatus")}
            value={bulkStatus || undefined}
            onChange={(value) => setBulkStatus(value || "")}
            options={STATUSES.map((item) => ({ value: item, label: statusLabel(t, item) }))}
          />
          <Select
            className="min-w-36"
            allowClear
            placeholder={t("page.requirements.bulkPriority")}
            value={bulkPriority || undefined}
            onChange={(value) => setBulkPriority(value || "")}
            options={PRIORITIES.map((item) => ({ value: item, label: item }))}
          />
          <AntInput
            className="w-40"
            allowClear
            value={bulkAgent}
            onChange={(e) => setBulkAgent(e.target.value)}
            placeholder={t("page.requirements.bulkAgent")}
          />
          <AntInput
            className="w-40"
            allowClear
            value={bulkTool}
            onChange={(e) => setBulkTool(e.target.value)}
            placeholder={t("page.requirements.bulkTool")}
          />
          <Button type="primary" disabled={!canBulkUpdate} loading={bulkUpdateReq.isPending} onClick={() => bulkUpdateReq.mutate()}>
            {t("page.requirements.bulkApply")}
          </Button>
          <Button
            disabled={!selectedReqIds.length && !bulkStatus && !bulkPriority && !bulkAgent && !bulkTool}
            onClick={() => {
              setSelectedReqIds([]);
              setBulkStatus("");
              setBulkPriority("");
              setBulkAgent("");
              setBulkTool("");
            }}
          >
            {t("common.reset")}
          </Button>
        </div>
        {bulkUpdateReq.error ? <p className="mt-2 text-sm text-rose-600">{(bulkUpdateReq.error as Error).message}</p> : null}
      </div>
    );
  }

  return (
    <>
    <WorkbenchShell
      title={workbenchFocused ? t("page.requirements.kit.title") : t("page.requirements.title")}
      description={workbenchFocused ? t(`page.requirements.mode.${mode}.hint`) : t("page.requirements.desc")}
      actions={
        <>
          <AiAssistButton
            onClick={() => {
              if (aiReq) setAiContextReq(aiReq);
              setAiOpen(true);
            }}
          />
          <RefreshButton onClick={refreshReads} pending={q.isFetching || summaryQ.isFetching || opsPlanQ.isFetching} />
        </>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.requirements.total"), value: summaryReady ? metrics.total : "—" },
            { label: t("page.requirements.pending"), value: summaryReady ? metrics.byStatus.get("pending") ?? 0 : "—" },
            { label: t("page.requirements.inProgress"), value: summaryReady ? metrics.byStatus.get("in_progress") ?? 0 : "—" },
            { label: t("page.requirements.completed"), value: summaryReady ? metrics.byStatus.get("completed") ?? 0 : "—" },
          ]}
        />
      }
    >
      {workbenchFocused ? (
        <ProductRequirementsShell
          factsReady={summaryReady}
          phase={mode}
          total={kitTotal}
          ready={kitReady}
          completed={kitCompleted}
          completionRate={kitCompletion}
        >
          {workbenchBody}
        </ProductRequirementsShell>
      ) : (
        workbenchBody
      )}
    </WorkbenchShell>

    <AiAssistDrawer
      open={aiOpen && listReady}
      onClose={() => setAiOpen(false)}
      module="product.requirements"
      context={
        aiReq
          ? {
              requirement_id: aiReq.id,
              title: aiReq.title,
              status: aiReq.status,
              priority: aiReq.priority,
              description_preview: (aiReq.description ?? "").slice(0, 800),
            }
          : undefined
      }
      initialPrompt={
        aiReq
          ? t("page.requirements.aiCopilotPrefill", { title: aiReq.title ?? aiReq.id })
          : t("page.requirements.aiCopilotPrefillGeneric")
      }
    />
    </>
  );
}

function RequirementsModeWorkbench({
  mode,
  requirements,
  reviewReqId,
  onPickReview,
  onAppliedReview,
  onCloseReview,
  taskPlanReqId,
  onPickGeneration,
  planningHref,
  onCloseTaskPlan,
}: {
  mode: RequirementMode;
  requirements: RequirementRow[];
  reviewReqId: string;
  onPickReview: (id: string) => void;
  onAppliedReview: () => void;
  onCloseReview: () => void;
  taskPlanReqId: string;
  onPickGeneration: (row: RequirementRow) => void;
  planningHref: (id: string) => string;
  onCloseTaskPlan: () => void;
}) {
  const { t } = useTranslation();
  const options = requirements.map((r) => ({
    value: r.id,
    label: `${r.title || r.id} · ${r.priority ?? "P?"}`,
  }));

  if (mode === "review") {
    return (
      <Card title={t("page.requirements.mode.review.title")}>
        <Select
          showSearch
          allowClear
          className="w-full max-w-2xl"
          placeholder={t("page.requirements.kit.pickRequirement")}
          value={reviewReqId || undefined}
          onChange={(id) => onPickReview(id || "")}
          options={options}
          optionFilterProp="label"
        />
        {reviewReqId ? (
          <RequirementAssistance key={reviewReqId} requirementId={reviewReqId} onApplied={onAppliedReview} onClose={onCloseReview} />
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">{t("page.requirements.kit.pickRequirementHint")}</p>
        )}
      </Card>
    );
  }

  if (mode === "generation") {
    const active = requirements.find((r) => r.id === taskPlanReqId);
    return (
      <Card title={t("page.requirements.mode.generation.title")}>
        <Select
          showSearch
          allowClear
          className="w-full max-w-2xl"
          placeholder={t("page.requirements.kit.pickRequirement")}
          value={taskPlanReqId || undefined}
          onChange={(id) => {
            const row = requirements.find((r) => r.id === id);
            if (row) onPickGeneration(row);
            else onCloseTaskPlan();
          }}
          options={options}
          optionFilterProp="label"
        />
        {active && taskPlanReqId ? (
          <div className="mt-4 space-y-3">
            <Alert type="info" showIcon title={t("delivery.plan")} description={t("delivery.planHint")} />
            <Button type="primary" href={planningHref(active.id)}>{t("delivery.plan")}</Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">{t("page.requirements.kit.pickRequirementHint")}</p>
        )}
      </Card>
    );
  }

  return null;
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

function statusLabel(t: (key: string) => string, status: string): string {
  const key = `page.requirements.statusMap.${status}`;
  const label = t(key);
  return label === key ? status : label;
}
