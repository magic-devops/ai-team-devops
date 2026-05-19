import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Input as AntInput, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { BrainCircuit, CheckCircle2, ListTodo, Pencil, Plus, Save, Trash2, Wand2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
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
import { AiAssistButton, AiAssistDrawer } from "../components/ai/AiAssistDrawer";
import { MarkdownView } from "../components/MarkdownView";
import { buildReviewMarkdown } from "../lib/copilotFormat";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";
import { ProductRequirementsShell } from "./product/ProductRequirementsShell";
import { parseRequirementsHash } from "./product/requirementsNav";
import { WorkbenchShell } from "./shared/WorkbenchShell";
import { WorkbenchStats } from "./shared/workbenchUi";

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

type TaskGenDraft = {
  mode: string;
  max_tasks: number;
  assigned_to: string;
  dev_tool: string;
  create_dependencies: boolean;
};

type TaskPlanItem = {
  id?: string;
  title?: string;
  description?: string;
  priority?: string;
  estimate?: string;
  assigned_to?: string;
  work_type?: string;
  agent_hint?: string;
  tool_hint?: string;
  reason?: string;
};

type TaskPlanResult = {
  ok?: boolean;
  dry_run?: boolean;
  mode?: string;
  items?: TaskPlanItem[];
  skipped?: TaskPlanItem[];
  count?: number;
};

type ReviewResult = {
  ok?: boolean;
  requirement_id?: string;
  score?: number;
  level?: string;
  risks?: Array<{ code?: string; level?: string; message?: string }>;
  suggestions?: string[];
  suggested_acceptance_criteria?: string[];
  duplicates?: Array<{ id?: string; title?: string; similarity?: number }>;
  linked_tasks?: number;
  next_actions?: string[];
};

type IntakeDraft = {
  text: string;
  filename: string;
  mode: string;
  agent: string;
  cli: string;
  assigned_agent: string;
  dev_tool: string;
  auto_priority: boolean;
  auto_acceptance: boolean;
};

type IntakeItem = Omit<RequirementRow, "id"> & {
  id?: string;
};

type IntakeResult = {
  ok?: boolean;
  source?: string;
  warning?: string;
  count?: number;
  items?: IntakeItem[];
  commands?: Array<{ label?: string; command?: string }>;
  agent_packet?: Record<string, unknown>;
  intake_config?: Record<string, unknown>;
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

const emptyIntakeDraft: IntakeDraft = {
  text: "",
  filename: "",
  mode: "prd",
  agent: "Product Analyst Agent",
  cli: "codex",
  assigned_agent: "Product Analyst Agent",
  dev_tool: "codex",
  auto_priority: true,
  auto_acceptance: true,
};

const intakeModes = ["idea", "prd", "meeting", "feedback", "incident", "data", "mixed"];
const intakeAgents = [
  "Product Analyst Agent",
  "Business Analyst Agent",
  "Data Product Agent",
  "QA Reviewer Agent",
  "Hermes Agent",
  "RequirementOps Agent",
];
const intakeCliTools = ["codex", "claude", "cursor", "qoder", "openclaw", "workbuddy", "hermes-agent"];

function defaultTaskGenDraft(row: RequirementRow): TaskGenDraft {
  return {
    mode: "standard",
    max_tasks: 6,
    assigned_to: row.assigned_agent || "Coder",
    dev_tool: row.dev_tool || "",
    create_dependencies: true,
  };
}

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
  const hasProject = Boolean(getProjectId());
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
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState(STATUS_ALL);
  const [priority, setPriority] = useState(PRIORITY_ALL);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [taskPlanReqId, setTaskPlanReqId] = useState("");
  const [taskPlanDraft, setTaskPlanDraft] = useState<TaskGenDraft>({
    mode: "standard",
    max_tasks: 6,
    assigned_to: "Coder",
    dev_tool: "",
    create_dependencies: true,
  });
  const [taskPlanResult, setTaskPlanResult] = useState<TaskPlanResult | null>(null);
  const [reviewReqId, setReviewReqId] = useState("");
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [selectedReqIds, setSelectedReqIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkPriority, setBulkPriority] = useState("");
  const [bulkAgent, setBulkAgent] = useState("");
  const [bulkTool, setBulkTool] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContextReq, setAiContextReq] = useState<RequirementRow | null>(null);
  const [opsTaskResult, setOpsTaskResult] = useState<any>(null);
  const [intakeDraft, setIntakeDraft] = useState<IntakeDraft>(emptyIntakeDraft);
  const [intakeResult, setIntakeResult] = useState<IntakeResult | null>(null);
  const [intakeSelectedKeys, setIntakeSelectedKeys] = useState<string[]>([]);

  const q = useQuery({
    queryKey: ["requirements", keyword, status, priority],
    queryFn: () =>
      api.requirements({
        q: keyword.trim(),
        status: status === STATUS_ALL ? "" : status,
        priority: priority === PRIORITY_ALL ? "" : priority,
      }),
    enabled: authed && hasProject,
  });
  const summaryQ = useQuery({
    queryKey: ["requirementsSummary"],
    queryFn: api.requirementsSummary,
    enabled: authed && hasProject,
  });
  const opsPlanQ = useQuery({
    queryKey: ["requirementOpsPlan"],
    queryFn: api.requirementOpsPlan,
    enabled: authed && hasProject,
  });

  const requirements = (q.data ?? []) as RequirementRow[];
  const metrics = useMemo(() => {
    const summary = summaryQ.data?.summary;
    if (summary) {
      return {
        total: summary.total ?? 0,
        byStatus: new Map<string, number>(Object.entries(summary.by_status ?? {}).map(([k, v]) => [k, Number(v)])),
        byPriority: new Map<string, number>(Object.entries(summary.by_priority ?? {}).map(([k, v]) => [k, Number(v)])),
      };
    }
    const byStatus = new Map<string, number>();
    const byPriority = new Map<string, number>();
    for (const row of requirements) {
      const st = row.status || "pending";
      const pr = row.priority || "P?";
      byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
      byPriority.set(pr, (byPriority.get(pr) ?? 0) + 1);
    }
    return { total: requirements.length, byStatus, byPriority };
  }, [requirements, summaryQ.data]);

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

  const generateTasks = useMutation({
    mutationFn: ({ id, dryRun }: { id: string; dryRun: boolean }) =>
      api.generateRequirementTasks(id, {
        dry_run: dryRun,
        mode: taskPlanDraft.mode,
        max_tasks: taskPlanDraft.max_tasks,
        assigned_to: taskPlanDraft.assigned_to,
        dev_tool: taskPlanDraft.dev_tool,
        create_dependencies: taskPlanDraft.create_dependencies,
      }),
    onSuccess: (data, vars) => {
      setTaskPlanReqId(vars.id);
      setTaskPlanResult(data as TaskPlanResult);
      if (!vars.dryRun) {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["task-dependencies"] });
      }
    },
  });

  const reviewReq = useMutation({
    mutationFn: (id: string) => api.reviewRequirement(id),
    onSuccess: (data, id) => {
      setReviewReqId(id);
      setReviewResult(data as ReviewResult);
    },
  });

  const applyReview = useMutation({
    mutationFn: ({ id, criteria }: { id: string; criteria: string[] }) =>
      api.applyRequirementReview(id, {
        acceptance_criteria: criteria,
        human_notes: t("page.requirements.reviewAppliedNote"),
      }),
    onSuccess: (data, vars) => {
      setReviewReqId(vars.id);
      setReviewResult(data?.review as ReviewResult);
      refreshRequirements();
    },
  });

  const opsTasksMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.requirementOpsTasks({ dry_run: dryRun, priority: "P1", assigned_to: "RequirementOps Agent", limit: 20 }),
    onSuccess: (data) => {
      setOpsTaskResult(data);
      void qc.invalidateQueries({ queryKey: ["requirements"] });
      void qc.invalidateQueries({ queryKey: ["requirementsSummary"] });
      void qc.invalidateQueries({ queryKey: ["requirementOpsPlan"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const parseIntake = useMutation({
    mutationFn: () =>
      api.parseRequirementsDocument({
        ...intakeDraft,
        filename: intakeDraft.filename || "requirements.md",
      }),
    onSuccess: (data) => {
      const result = data as IntakeResult;
      setIntakeResult(result);
      setIntakeSelectedKeys((result.items ?? []).map((_, idx) => String(idx)));
    },
  });

  const importIntake = useMutation({
    mutationFn: () =>
      api.batchCreateRequirements({
        items: (intakeResult?.items ?? [])
          .filter((_, idx) => intakeSelectedKeys.includes(String(idx)))
          .map((item) => ({
          title: item.title || "",
          description: item.description || "",
          priority: item.priority || "P2",
          acceptance_criteria: item.acceptance_criteria || [],
          tags: item.tags || [],
          assigned_agent: item.assigned_agent || intakeDraft.assigned_agent || intakeDraft.agent,
          dev_tool: item.dev_tool || intakeDraft.dev_tool || intakeDraft.cli,
        })),
      }),
    onSuccess: () => {
      refreshRequirements();
      setIntakeSelectedKeys([]);
    },
  });

  const busy = createReq.isPending || updateReq.isPending || deleteReq.isPending || generateTasks.isPending || reviewReq.isPending || applyReview.isPending || bulkUpdateReq.isPending || opsTasksMut.isPending || parseIntake.isPending || importIntake.isPending;
  const selectedReqSet = useMemo(() => new Set(selectedReqIds), [selectedReqIds]);
  const canBulkUpdate = selectedReqIds.length > 0 && Boolean(bulkStatus || bulkPriority || bulkAgent.trim() || bulkTool.trim());
  const canParseIntake = intakeDraft.text.trim().length >= 20;
  const canImportIntake = intakeSelectedKeys.length > 0;

  const hubSummary = summaryQ.data?.summary ?? {};
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
    return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;
  }

  const aiReq = aiContextReq ?? requirements.find((r) => r.id === reviewReqId) ?? requirements[0] ?? null;
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
  function updateIntakeItem(index: number, patch: Partial<IntakeItem>) {
    setIntakeResult((prev) => {
      if (!prev?.items) return prev;
      const items = prev.items.map((item, idx) => (idx === index ? { ...item, ...patch } : item));
      return { ...prev, items, count: items.length };
    });
  }

  function removeIntakeItem(index: number) {
    setIntakeResult((prev) => {
      if (!prev?.items) return prev;
      const items = prev.items.filter((_, idx) => idx !== index);
      setIntakeSelectedKeys(items.map((_, idx) => String(idx)));
      return { ...prev, items, count: items.length };
    });
  }

  function applyIntakeDefaults() {
    setIntakeResult((prev) => {
      if (!prev?.items) return prev;
      return {
        ...prev,
        items: prev.items.map((item) => ({
          ...item,
          assigned_agent: item.assigned_agent || intakeDraft.assigned_agent || intakeDraft.agent,
          dev_tool: item.dev_tool || intakeDraft.dev_tool || intakeDraft.cli,
        })),
      };
    });
  }

  const intakeColumns: ColumnsType<IntakeItem> = [
    {
      title: t("page.requirements.intakeDraftItem"),
      dataIndex: "title",
      width: 360,
      render: (value, row, index) => (
        <div className="space-y-2">
          <AntInput
            value={String(value || "")}
            onChange={(e) => updateIntakeItem(index, { title: e.target.value })}
            placeholder={t("page.requirements.titlePh")}
          />
          <AntInput.TextArea
            value={row.description || ""}
            onChange={(e) => updateIntakeItem(index, { description: e.target.value })}
            autoSize={{ minRows: 2, maxRows: 5 }}
            placeholder={t("page.requirements.description")}
          />
        </div>
      ),
    },
    {
      title: t("page.requirements.priority"),
      dataIndex: "priority",
      width: 112,
      render: (value, _row, index) => (
        <Select
          className="w-full"
          value={value || "P2"}
          onChange={(priorityValue) => updateIntakeItem(index, { priority: priorityValue })}
          options={PRIORITIES.map((item) => ({ value: item, label: item }))}
        />
      ),
    },
    {
      title: t("page.requirements.acceptance"),
      dataIndex: "acceptance_criteria",
      width: 300,
      render: (value, _row, index) => (
        <AntInput.TextArea
          value={(value || []).join("\n")}
          onChange={(e) => updateIntakeItem(index, { acceptance_criteria: splitLines(e.target.value) })}
          autoSize={{ minRows: 2, maxRows: 5 }}
          placeholder={t("page.requirements.acceptancePh")}
        />
      ),
    },
    {
      title: t("page.requirements.agent"),
      dataIndex: "assigned_agent",
      width: 190,
      render: (value, row, index) => (
        <div className="space-y-2">
          <AntInput
            value={value || ""}
            onChange={(e) => updateIntakeItem(index, { assigned_agent: e.target.value })}
            placeholder={t("page.requirements.agent")}
          />
          <AntInput
            value={row.dev_tool || ""}
            onChange={(e) => updateIntakeItem(index, { dev_tool: e.target.value })}
            placeholder={t("page.requirements.devTool")}
          />
        </div>
      ),
    },
    {
      title: t("page.requirements.tags"),
      dataIndex: "tags",
      width: 210,
      render: (value, _row, index) => (
        <div className="space-y-2">
          <AntInput
            value={(value || []).join(", ")}
            onChange={(e) => updateIntakeItem(index, { tags: splitTags(e.target.value) })}
            placeholder={t("page.requirements.tags")}
          />
          <Button danger size="small" onClick={() => removeIntakeItem(index)}>
            {t("page.requirements.intakeRemove")}
          </Button>
        </div>
      ),
    },
  ];
  const showIntakePanel = !workbenchFocused || mode === "pool";

  const workbenchBody = (
    <>
      {showIntakePanel ? renderIntakePanel() : null}

      <Card
        title={t("page.requirements.opsPlan")}
        actions={
          <Space wrap>
            <Button loading={opsTasksMut.isPending} onClick={() => opsTasksMut.mutate(true)}>
              {t("page.requirements.opsPreview")}
            </Button>
            <Button type="primary" loading={opsTasksMut.isPending} onClick={() => opsTasksMut.mutate(false)}>
              {t("page.requirements.opsCreate")}
            </Button>
          </Space>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
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
        </div>
      </Card>

      {workbenchFocused && mode !== "pool" ? (
        <RequirementsModeWorkbench
          mode={mode}
          requirements={displayList}
          reviewReqId={reviewReqId}
          reviewResult={reviewResult}
          reviewPending={reviewReq.isPending || applyReview.isPending}
          reviewError={reviewReq.error || applyReview.error}
          onPickReview={(id) => {
            setReviewReqId(id);
            setReviewResult(null);
            if (id) reviewReq.mutate(id);
          }}
          onApplyReview={(id, criteria) => applyReview.mutate({ id, criteria })}
          onCloseReview={() => {
            setReviewReqId("");
            setReviewResult(null);
          }}
          taskPlanReqId={taskPlanReqId}
          taskPlanDraft={taskPlanDraft}
          taskPlanResult={taskPlanResult}
          taskPlanPending={generateTasks.isPending}
          taskPlanError={generateTasks.error}
          onPickGeneration={(row) => {
            const next = defaultTaskGenDraft(row);
            setTaskPlanReqId(row.id);
            setTaskPlanDraft(next);
            setTaskPlanResult(null);
            generateTasks.mutate({ id: row.id, dryRun: true });
          }}
          onTaskDraftChange={setTaskPlanDraft}
          onPreviewTasks={(id) => generateTasks.mutate({ id, dryRun: true })}
          onCreateTasks={(id) => generateTasks.mutate({ id, dryRun: false })}
          onCloseTaskPlan={() => {
            setTaskPlanReqId("");
            setTaskPlanResult(null);
          }}
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
                  {p} ({metrics.byPriority.get(p) ?? 0})
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

        {showBulkPanel ? renderBulkPanel() : null}

        {q.isLoading ? <LoadingBlock /> : null}
        {q.error ? <ErrorBlock message={(q.error as Error).message} /> : null}
        {!q.isLoading && !q.error && displayList.length === 0 ? (
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
                        title={t("page.requirements.generateTasks")}
                        disabled={busy}
                        onClick={() => {
                          const next = defaultTaskGenDraft(r);
                          setTaskPlanReqId(r.id);
                          setTaskPlanDraft(next);
                          setTaskPlanResult(null);
                          generateTasks.mutate({ id: r.id, dryRun: true });
                        }}
                      >
                        <Wand2 className="h-4 w-4" />
                      </button>
                    ) : null}
                    {showCardReview ? (
                      <button
                        type="button"
                        className="rounded-lg border border-violet-200 p-2 text-violet-600 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/40"
                        title={t("page.requirements.aiReview")}
                        disabled={busy}
                        onClick={() => {
                          setReviewReqId(r.id);
                          setReviewResult(null);
                          reviewReq.mutate(r.id);
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
                {taskPlanReqId === r.id && showCardGenerate ? (
                  <TaskPlanPanel
                    draft={taskPlanDraft}
                    onChange={setTaskPlanDraft}
                    result={taskPlanResult}
                    pending={generateTasks.isPending}
                    error={generateTasks.error}
                    onPreview={() => generateTasks.mutate({ id: r.id, dryRun: true })}
                    onCreate={() => generateTasks.mutate({ id: r.id, dryRun: false })}
                    onClose={() => {
                      setTaskPlanReqId("");
                      setTaskPlanResult(null);
                    }}
                  />
                ) : null}
                {reviewReqId === r.id && showCardReview && !workbenchFocused ? (
                  <ReviewPanel
                    result={reviewResult}
                    pending={reviewReq.isPending || applyReview.isPending}
                    error={reviewReq.error || applyReview.error}
                    onApply={() => {
                      const criteria = reviewResult?.suggested_acceptance_criteria ?? [];
                      if (criteria.length) applyReview.mutate({ id: r.id, criteria });
                    }}
                    onClose={() => {
                      setReviewReqId("");
                      setReviewResult(null);
                    }}
                  />
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

  function renderIntakePanel() {
    const commands = intakeResult?.commands ?? [];
    return (
      <Card
        title={t("page.requirements.intakeTitle")}
        actions={
          <Space wrap>
            <Button
              disabled={!canParseIntake}
              loading={parseIntake.isPending}
              onClick={() => parseIntake.mutate()}
            >
              <Wand2 className="mr-1 inline h-4 w-4" />
              {t("page.requirements.intakeParse")}
            </Button>
            <Button
              type="primary"
              disabled={!canImportIntake}
              loading={importIntake.isPending}
              onClick={() => importIntake.mutate()}
            >
              <Plus className="mr-1 inline h-4 w-4" />
              {t("page.requirements.intakeImport")}
            </Button>
          </Space>
        }
      >
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.05fr)_minmax(520px,1fr)]">
          <div className="space-y-3">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] p-3">
              <p className="text-sm font-medium text-[var(--text)]">{t("page.requirements.intakeDesc")}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.requirements.intakeHint")}</p>
            </div>
            <div className="grid gap-2 lg:grid-cols-3">
              <Select
                value={intakeDraft.mode}
                onChange={(modeValue) => setIntakeDraft((prev) => ({ ...prev, mode: modeValue }))}
                options={intakeModes.map((item) => ({ value: item, label: t(`page.requirements.intakeModeMap.${item}`) }))}
              />
              <Select
                showSearch
                value={intakeDraft.agent}
                onChange={(agentValue) => setIntakeDraft((prev) => ({
                  ...prev,
                  agent: agentValue,
                  assigned_agent: prev.assigned_agent || agentValue,
                }))}
                options={intakeAgents.map((item) => ({ value: item, label: item }))}
              />
              <Select
                showSearch
                value={intakeDraft.cli}
                onChange={(cliValue) => setIntakeDraft((prev) => ({
                  ...prev,
                  cli: cliValue,
                  dev_tool: prev.dev_tool || cliValue,
                }))}
                options={intakeCliTools.map((item) => ({ value: item, label: item }))}
              />
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              <AntInput
                value={intakeDraft.assigned_agent}
                onChange={(e) => setIntakeDraft((prev) => ({ ...prev, assigned_agent: e.target.value }))}
                placeholder={t("page.requirements.intakeAssignedAgent")}
              />
              <AntInput
                value={intakeDraft.dev_tool}
                onChange={(e) => setIntakeDraft((prev) => ({ ...prev, dev_tool: e.target.value }))}
                placeholder={t("page.requirements.intakeDevTool")}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className={secondaryButtonClass}>
                {t("page.requirements.intakeFile")}
                <input
                  className="hidden"
                  type="file"
                  accept=".md,.txt,.json,.csv"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const content = await file.text();
                    setIntakeDraft((prev) => ({ ...prev, filename: file.name, text: content }));
                    setIntakeResult(null);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              <Checkbox
                checked={intakeDraft.auto_priority}
                onChange={(e) => setIntakeDraft((prev) => ({ ...prev, auto_priority: e.target.checked }))}
              >
                {t("page.requirements.intakeAutoPriority")}
              </Checkbox>
              <Checkbox
                checked={intakeDraft.auto_acceptance}
                onChange={(e) => setIntakeDraft((prev) => ({ ...prev, auto_acceptance: e.target.checked }))}
              >
                {t("page.requirements.intakeAutoAcceptance")}
              </Checkbox>
              <Button
                onClick={() => {
                  setIntakeDraft(emptyIntakeDraft);
                  setIntakeResult(null);
                  setIntakeSelectedKeys([]);
                }}
              >
                {t("page.requirements.intakeClear")}
              </Button>
            </div>
            <AntInput.TextArea
              value={intakeDraft.text}
              onChange={(e) => {
                setIntakeDraft((prev) => ({ ...prev, text: e.target.value }));
                setIntakeResult(null);
              }}
              rows={11}
              showCount
              maxLength={60000}
              placeholder={t("page.requirements.intakeTextPh")}
            />
            {intakeDraft.filename ? (
              <p className="text-xs text-[var(--muted)]">{t("page.requirements.intakeFilename")}: {intakeDraft.filename}</p>
            ) : null}
            {parseIntake.error ? <p className="text-sm text-rose-600">{(parseIntake.error as Error).message}</p> : null}
          </div>

          <div className="min-w-0 space-y-3">
            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">{t("page.requirements.intakeParsed")}</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text)]">{intakeResult?.count ?? 0}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">{t("page.requirements.intakeSelected")}</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text)]">{intakeSelectedKeys.length}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-xs text-[var(--muted)]">{t("page.requirements.intakeSource")}</p>
                <p className="mt-1 text-sm font-semibold text-[var(--text)]">{intakeResult?.source ?? "-"}</p>
              </div>
            </div>
            {intakeResult?.warning ? <Alert type="warning" showIcon message={intakeResult.warning} /> : null}
            {importIntake.data ? (
              <Alert
                type="success"
                showIcon
                message={t("page.requirements.intakeImportOk", { count: importIntake.data?.count ?? 0 })}
              />
            ) : null}
            <Table
              title={() => (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--text)]">{t("page.requirements.intakeDraftPool")}</span>
                  <Space wrap>
                    <Button
                      size="small"
                      disabled={!intakeResult?.items?.length}
                      onClick={() => setIntakeSelectedKeys((intakeResult?.items ?? []).map((_, idx) => String(idx)))}
                    >
                      {t("page.requirements.selectAll")}
                    </Button>
                    <Button size="small" disabled={!intakeSelectedKeys.length} onClick={() => setIntakeSelectedKeys([])}>
                      {t("page.requirements.clearSelection")}
                    </Button>
                    <Button size="small" disabled={!intakeResult?.items?.length} onClick={applyIntakeDefaults}>
                      {t("page.requirements.intakeApplyDefaults")}
                    </Button>
                  </Space>
                </div>
              )}
              rowKey={(_row, index) => String(index ?? 0)}
              rowSelection={{
                selectedRowKeys: intakeSelectedKeys,
                onChange: (keys) => setIntakeSelectedKeys(keys.map(String)),
              }}
              size="small"
              loading={parseIntake.isPending}
              columns={intakeColumns}
              dataSource={intakeResult?.items ?? []}
              pagination={{ pageSize: 5 }}
              scroll={{ x: 1220 }}
              locale={{ emptyText: t("page.requirements.intakeNoPreview") }}
            />
            {commands.length ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] p-3">
                <p className="mb-2 text-xs font-semibold text-[var(--text)]">{t("page.requirements.intakeCommands")}</p>
                <div className="space-y-2">
                  {commands.map((item, idx) => (
                    <div key={`${item.label}-${idx}`} className="grid gap-1 text-xs lg:grid-cols-[8rem_1fr]">
                      <span className="text-[var(--muted)]">{item.label}</span>
                      <Typography.Text code copyable className="!text-xs">{item.command}</Typography.Text>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

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
          <RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />
        </>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.requirements.total"), value: metrics.total },
            { label: t("page.requirements.pending"), value: metrics.byStatus.get("pending") ?? 0 },
            { label: t("page.requirements.inProgress"), value: metrics.byStatus.get("in_progress") ?? 0 },
            { label: t("page.requirements.completed"), value: metrics.byStatus.get("completed") ?? 0 },
          ]}
        />
      }
    >
      {workbenchFocused ? (
        <ProductRequirementsShell
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
      open={aiOpen}
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
  reviewResult,
  reviewPending,
  reviewError,
  onPickReview,
  onApplyReview,
  onCloseReview,
  taskPlanReqId,
  taskPlanDraft,
  taskPlanResult,
  taskPlanPending,
  taskPlanError,
  onPickGeneration,
  onTaskDraftChange,
  onPreviewTasks,
  onCreateTasks,
  onCloseTaskPlan,
}: {
  mode: RequirementMode;
  requirements: RequirementRow[];
  reviewReqId: string;
  reviewResult: ReviewResult | null;
  reviewPending: boolean;
  reviewError: unknown;
  onPickReview: (id: string) => void;
  onApplyReview: (id: string, criteria: string[]) => void;
  onCloseReview: () => void;
  taskPlanReqId: string;
  taskPlanDraft: TaskGenDraft;
  taskPlanResult: TaskPlanResult | null;
  taskPlanPending: boolean;
  taskPlanError: unknown;
  onPickGeneration: (row: RequirementRow) => void;
  onTaskDraftChange: (draft: TaskGenDraft) => void;
  onPreviewTasks: (id: string) => void;
  onCreateTasks: (id: string) => void;
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
          <ReviewPanel
            result={reviewResult}
            pending={reviewPending}
            error={reviewError}
            onApply={() => {
              const criteria = reviewResult?.suggested_acceptance_criteria ?? [];
              if (criteria.length) onApplyReview(reviewReqId, criteria);
            }}
            onClose={onCloseReview}
          />
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
          <TaskPlanPanel
            draft={taskPlanDraft}
            onChange={onTaskDraftChange}
            result={taskPlanResult}
            pending={taskPlanPending}
            error={taskPlanError}
            onPreview={() => onPreviewTasks(taskPlanReqId)}
            onCreate={() => onCreateTasks(taskPlanReqId)}
            onClose={onCloseTaskPlan}
          />
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">{t("page.requirements.kit.pickRequirementHint")}</p>
        )}
      </Card>
    );
  }

  return null;
}

function ReviewPanel({
  result,
  pending,
  error,
  onApply,
  onClose,
}: {
  result: ReviewResult | null;
  pending: boolean;
  error: unknown;
  onApply: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const score = Number(result?.score ?? 0);
  const tone =
    score >= 85
      ? "border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/20 dark:text-emerald-200"
      : score >= 65
        ? "border-amber-200 bg-amber-50/70 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-200"
        : "border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/20 dark:text-rose-200";
  const suggested = result?.suggested_acceptance_criteria ?? [];
  return (
    <div className={`mt-4 rounded-lg border p-3 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <BrainCircuit className="mt-0.5 h-4 w-4" />
          <div>
            <p className="text-sm font-semibold">{t("page.requirements.aiReview")}</p>
            <p className="mt-1 text-xs opacity-80">{t("page.requirements.aiReviewDesc")}</p>
          </div>
        </div>
        <button type="button" className={secondaryButtonClass} onClick={onClose}>
          <X className="h-4 w-4" />
          {t("common.close")}
        </button>
      </div>
      {pending && !result ? <p className="mt-3 text-sm">{t("common.loading")}</p> : null}
      {error ? <p className="mt-2 text-sm text-rose-600">{(error as Error).message}</p> : null}
      {result ? (
        <div className="mt-3 space-y-3">
          <MarkdownView content={buildReviewMarkdown(result)} className="rounded-lg border border-current/10 bg-white/50 p-3 dark:bg-slate-950/20" />
          <div className="grid gap-2 sm:grid-cols-3">
            <Info label={t("page.requirements.reviewScore")} value={`${result.score ?? 0}/100`} />
            <Info label={t("page.requirements.reviewLevel")} value={t(`page.requirements.reviewLevelMap.${result.level || "needs_work"}`)} />
            <Info label={t("page.requirements.linkedTasks")} value={String(result.linked_tasks ?? 0)} />
          </div>
          {result.risks?.length ? (
            <div className="rounded-lg border border-current/20 bg-white/60 p-3 dark:bg-slate-950/30">
              <p className="text-xs font-semibold">{t("page.requirements.reviewRisks")}</p>
              <ul className="mt-2 space-y-1 text-xs leading-5">
                {result.risks.map((risk, idx) => <li key={`${risk.code}-${idx}`}>{risk.message}</li>)}
              </ul>
            </div>
          ) : null}
          {result.suggestions?.length ? (
            <div className="rounded-lg border border-current/20 bg-white/60 p-3 dark:bg-slate-950/30">
              <p className="text-xs font-semibold">{t("page.requirements.reviewSuggestions")}</p>
              <ul className="mt-2 space-y-1 text-xs leading-5">
                {result.suggestions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
          {suggested.length ? (
            <div className="rounded-lg border border-current/20 bg-white/60 p-3 dark:bg-slate-950/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">{t("page.requirements.suggestedAcceptance")}</p>
                <button type="button" className={primaryButtonClass} disabled={pending} onClick={onApply}>
                  <CheckCircle2 className="h-4 w-4" />
                  {t("page.requirements.applyAcceptance")}
                </button>
              </div>
              <ul className="mt-2 space-y-1 text-xs leading-5">
                {suggested.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
          {result.duplicates?.length ? (
            <div className="rounded-lg border border-current/20 bg-white/60 p-3 text-xs dark:bg-slate-950/30">
              <p className="font-semibold">{t("page.requirements.duplicates")}</p>
              <div className="mt-2 space-y-1">
                {result.duplicates.map((item) => (
                  <p key={item.id} className="font-mono">{item.id} · {item.title} · {item.similarity}</p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
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

function TaskPlanPanel({
  draft,
  onChange,
  result,
  pending,
  error,
  onPreview,
  onCreate,
  onClose,
}: {
  draft: TaskGenDraft;
  onChange: (next: TaskGenDraft) => void;
  result: TaskPlanResult | null;
  pending: boolean;
  error: unknown;
  onPreview: () => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const items = result?.items ?? [];
  const skipped = result?.skipped ?? [];
  const set = (patch: Partial<TaskGenDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900/70 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <ListTodo className="h-4 w-4 text-sky-500" />
            {t("page.requirements.taskFlow")}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {t("page.requirements.taskFlowDesc")}
          </p>
        </div>
        <button type="button" className={secondaryButtonClass} onClick={onClose}>
          <X className="h-4 w-4" />
          {t("common.close")}
        </button>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-5">
        <Field label={t("page.requirements.taskMode")}>
          <select className={fieldClass} value={draft.mode} onChange={(e) => set({ mode: e.target.value })}>
            {["standard", "fullstack", "frontend", "backend", "test"].map((m) => (
              <option key={m} value={m}>
                {t(`page.requirements.taskModeMap.${m}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("page.requirements.maxTasks")}>
          <input
            className={fieldClass}
            type="number"
            min={1}
            max={20}
            value={draft.max_tasks}
            onChange={(e) => set({ max_tasks: Number(e.target.value) || 6 })}
          />
        </Field>
        <Field label={t("page.requirements.agent")}>
          <input className={fieldClass} value={draft.assigned_to} onChange={(e) => set({ assigned_to: e.target.value })} />
        </Field>
        <Field label={t("page.requirements.devTool")}>
          <input className={fieldClass} value={draft.dev_tool} onChange={(e) => set({ dev_tool: e.target.value })} />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-xs font-medium text-slate-500">
          <input
            type="checkbox"
            checked={draft.create_dependencies}
            onChange={(e) => set({ create_dependencies: e.target.checked })}
          />
          {t("page.requirements.createDependencies")}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={secondaryButtonClass} disabled={pending} onClick={onPreview}>
          <Wand2 className="h-4 w-4" />
          {t("page.requirements.previewTasks")}
        </button>
        <button type="button" className={primaryButtonClass} disabled={pending || items.length === 0} onClick={onCreate}>
          <ListTodo className="h-4 w-4" />
          {t("page.requirements.createTasks")}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-rose-600">{(error as Error).message}</p> : null}
      {result ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-white px-2 py-1 dark:bg-slate-900">
              {result.dry_run ? t("page.requirements.previewReady") : t("page.requirements.tasksCreated", { count: result.count ?? items.length })}
            </span>
            {skipped.length ? (
              <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                {t("page.requirements.tasksSkipped", { count: skipped.length })}
              </span>
            ) : null}
          </div>
          {items.length ? (
            <div className="grid gap-2">
              {items.map((item, idx) => (
                <div key={`${item.title}-${idx}`} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/70">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-slate-800">
                      {item.priority || "P2"}
                    </span>
                    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-950 dark:text-sky-200">
                      {item.work_type || "engineering"}
                    </span>
                    <span className="text-[10px] text-slate-400">{item.estimate || "M"}</span>
                    {item.id ? <span className="font-mono text-[10px] text-slate-400">{item.id}</span> : null}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
                  {item.description ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{item.description}</p>
                  ) : null}
                  <div className="mt-2 grid gap-2 text-[10px] text-slate-500 sm:grid-cols-2">
                    <Info label={t("page.requirements.agent")} value={item.assigned_to || "-"} />
                    <Info label={t("page.requirements.toolHint")} value={item.tool_hint || "-"} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message={t("page.requirements.noTaskPlan")} />
          )}
        </div>
      ) : null}
    </div>
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
