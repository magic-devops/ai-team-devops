import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { TasksWorkbenchHeader } from "./delivery/TasksWorkbenchHeader";
import { SprintBurndownChart } from "@/pages/shared/SprintBurndownChart";
import { SprintProgressPanel } from "@/pages/shared/SprintProgressPanel";
import { api } from "@/lib/api";
import { getProjectId, getToken, getSessionRevision } from "@/lib/authStorage";
import { linkedTaskRows, taskIdFromHash } from "@/lib/taskDeepLink";
import { manualTaskHref, taskRecordStatusLabel } from "@/lib/deliveryTaskReview";
import { DeliveryTaskDetail } from "./delivery/DeliveryTaskDetail";

const STATUSES = ["pending", "in_progress", "blocked", "completed"] as const;
const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

function includesStatus(v: string): v is (typeof STATUSES)[number] {
  return (STATUSES as readonly string[]).includes(v);
}

function includesPriority(v: string): v is (typeof PRIORITIES)[number] {
  return (PRIORITIES as readonly string[]).includes(v);
}

function groupsFromTasks(taskList: any[]): Record<(typeof PRIORITIES)[number], string[]> {
  const g: Record<string, string[]> = { P0: [], P1: [], P2: [], P3: [] };
  for (const task of taskList) {
    const pr = includesPriority(task.priority) ? task.priority : "P3";
    const id = task.id as string;
    if (id) g[pr].push(id);
  }
  return g as Record<(typeof PRIORITIES)[number], string[]>;
}

function moveTaskBetweenColumns(
  groups: Record<(typeof PRIORITIES)[number], string[]>,
  taskId: string,
  targetP: (typeof PRIORITIES)[number],
  insertBeforeId: string | null,
): Record<(typeof PRIORITIES)[number], string[]> {
  const next: Record<(typeof PRIORITIES)[number], string[]> = {
    P0: [...groups.P0],
    P1: [...groups.P1],
    P2: [...groups.P2],
    P3: [...groups.P3],
  };
  for (const p of PRIORITIES) {
    next[p] = next[p].filter((id) => id !== taskId);
  }
  const col = [...next[targetP]];
  if (!insertBeforeId) col.push(taskId);
  else {
    const at = col.indexOf(insertBeforeId);
    if (at < 0) col.push(taskId);
    else col.splice(at, 0, taskId);
  }
  next[targetP] = col;
  return next;
}

const statusColor: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  blocked: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};

type Tab = "list" | "board" | "priority" | "sprint" | "deps" | "scheduler";
type SchedulerPanel = "ops" | "insights" | "agent" | "quality" | "events";

const SCHEDULER_PANELS: SchedulerPanel[] = ["ops", "insights", "agent", "quality", "events"];
const LEGACY_PANEL_ALIASES: Record<string, SchedulerPanel> = {
  "agent-feed": "agent",
  "agent-reports": "agent",
  "bulk-governance": "quality",
  "quality-governance": "quality",
  "event-wakeups": "events",
  events: "events",
};

function normalizeSchedulerPanel(value?: string): SchedulerPanel {
  if (!value) return "ops";
  if ((SCHEDULER_PANELS as readonly string[]).includes(value)) return value as SchedulerPanel;
  return LEGACY_PANEL_ALIASES[value] ?? "ops";
}

function readSchedulerPanelFromHash(): SchedulerPanel | null {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) return null;
  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  const panel = params.get("panel");
  return panel ? normalizeSchedulerPanel(panel) : null;
}

function TaskCard({
  task,
  onStatus,
  busy,
  draggable,
}: {
  task: any;
  onStatus: (id: string, status: string) => void;
  busy?: boolean;
  draggable?: boolean;
}) {
  const { t } = useTranslation();
  const pr = (task.priority || "P3").toUpperCase();
  return (
    <div
      draggable={draggable && !busy}
      onDragStart={(e) => {
        if (!draggable || busy) return;
        e.dataTransfer.setData("text/task-id", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 ${
        draggable && !busy ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{task.title}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{task.id}</p>
          {task.assigned_to ? (
            <p className="mt-1 text-xs text-slate-500">{task.assigned_to}</p>
          ) : null}
        </div>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold">{pr}</span>
      </div>
      {(task.dev_tool || task.source_report_id || task.branch) ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {task.dev_tool ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {task.dev_tool}
            </span>
          ) : null}
          {task.branch ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {task.branch}
            </span>
          ) : null}
          {task.source_report_id ? (
            <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-200">
              {task.source_report_title || task.source_report_id}
            </span>
          ) : null}
        </div>
      ) : null}
      {task.debug_notes ? (
        <p className="mt-2 line-clamp-2 rounded bg-slate-50 px-2 py-1 text-[10px] text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
          {task.debug_notes}
        </p>
      ) : null}
      <select
        className="mt-2 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
        value={task.status || "pending"}
        disabled={busy}
        onChange={(e) => onStatus(task.id, e.target.value)}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {taskRecordStatusLabel(s, t)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Tasks({
  initialTab = "list",
  focused = false,
  initialSchedulerPanel = "ops",
}: {
  initialTab?: Tab;
  focused?: boolean;
  initialSchedulerPanel?: SchedulerPanel | string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sprintId, setSprintId] = useState<string>("");
  const [depQuery, setDepQuery] = useState("");
  const [depFilter, setDepFilter] = useState("all");
  const [depSelectedNode, setDepSelectedNode] = useState<any>(null);
  const [depTasksResult, setDepTasksResult] = useState<any>(null);
  const [linkedTaskId, setLinkedTaskId] = useState(() => taskIdFromHash(typeof window === "undefined" ? "" : window.location.hash));
  const [taskQuery, setTaskQuery] = useState(linkedTaskId);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkPriority, setBulkPriority] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchStrategy, setDispatchStrategy] = useState("balanced");
  const [dispatchIncludeBlocked, setDispatchIncludeBlocked] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);
  const [schedulerPolicy, setSchedulerPolicy] = useState("quality_first");
  const [schedulerIncludeBlocked, setSchedulerIncludeBlocked] = useState(false);
  const [schedulerMaxParallel, setSchedulerMaxParallel] = useState(6);
  const [schedulerResult, setSchedulerResult] = useState<any>(null);
  const [schedulerRunQuery, setSchedulerRunQuery] = useState("");
  const [schedulerIncludeArchived, setSchedulerIncludeArchived] = useState(false);
  const [schedulerPanel, setSchedulerPanel] = useState<SchedulerPanel>(() => readSchedulerPanelFromHash() ?? normalizeSchedulerPanel(initialSchedulerPanel));
  const [schedulerRunbookResult, setSchedulerRunbookResult] = useState<any>(null);
  const [schedulerInsightTasksResult, setSchedulerInsightTasksResult] = useState<any>(null);
  const [qualityPolicyDraft, setQualityPolicyDraft] = useState({
    mode: "blocking",
    required: "",
    advisory: "",
    minConfidence: 0.65,
    requireArtifact: true,
    autoBlock: true,
    notes: "",
  });
  const [qualityTasksResult, setQualityTasksResult] = useState<any>(null);
  const [agentPlanResult, setAgentPlanResult] = useState<any>(null);
  const [interactionOpsMemoryResult, setInteractionOpsMemoryResult] = useState<any>(null);
  const [interactionOpsExportResult, setInteractionOpsExportResult] = useState<any>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const syncLinkedTask = () => {
      const taskId = taskIdFromHash(window.location.hash);
      setLinkedTaskId(taskId);
      if (taskId) {
        setTaskQuery(taskId);
        setStatusFilter("");
        setPriorityFilter("");
        setSourceFilter("");
      }
    };
    window.addEventListener("hashchange", syncLinkedTask);
    return () => window.removeEventListener("hashchange", syncLinkedTask);
  }, []);

  useEffect(() => {
    setSchedulerPanel(readSchedulerPanelFromHash() ?? normalizeSchedulerPanel(initialSchedulerPanel));
  }, [initialSchedulerPanel]);

  const allTasksQ = useQuery({
    queryKey: ["tasks", taskQuery, statusFilter, priorityFilter, sourceFilter],
    queryFn: () => api.tasks({ q: taskQuery.trim(), status: statusFilter, priority: priorityFilter, source: sourceFilter }),
    enabled: authed && hasProject && (tab === "list" || tab === "board" || tab === "priority" || tab === "deps"),
  });
  const interactionOpsQ = useQuery({
    queryKey: ["tasksInteractionOps", taskQuery],
    queryFn: () => api.pagesInteractionOps({ domain: "delivery", q: taskQuery.trim(), status: "watch", limit: 30 }),
    enabled: authed && hasProject,
  });

  const summaryQ = useQuery({
    queryKey: ["tasksSummary"],
    queryFn: api.tasksSummary,
    enabled: authed && hasProject,
  });

  const depsQ = useQuery({
    queryKey: ["taskDependencies"],
    queryFn: api.taskDependencies,
    enabled: authed && hasProject && tab === "deps",
  });

  const agentFeedQ = useQuery({
    queryKey: ["taskAgentFeed", schedulerIncludeBlocked],
    queryFn: () => api.taskAgentFeed(8, "", schedulerIncludeBlocked),
    enabled: authed && hasProject && tab === "scheduler",
  });
  const agentClaimsQ = useQuery({
    queryKey: ["taskAgentClaims"],
    queryFn: () => api.taskAgentClaims("active", 50),
    enabled: authed && hasProject && tab === "scheduler",
  });
  const agentReportsQ = useQuery({
    queryKey: ["taskAgentReports"],
    queryFn: () => api.taskAgentReports(80),
    enabled: authed && hasProject && tab === "scheduler",
  });
  const qualityPolicyQ = useQuery({
    queryKey: ["taskQualityPolicy"],
    queryFn: api.taskQualityPolicy,
    enabled: authed && hasProject && tab === "scheduler",
  });
  const qualitySummaryQ = useQuery({
    queryKey: ["taskQualitySummary"],
    queryFn: () => api.taskQualitySummary(100),
    enabled: authed && hasProject && tab === "scheduler",
  });
  const schedulerRunsQ = useQuery({
    queryKey: ["taskSchedulerRuns", schedulerRunQuery, schedulerIncludeArchived],
    queryFn: () => api.taskSchedulerRuns(20, schedulerRunQuery.trim(), schedulerIncludeArchived),
    enabled: authed && hasProject && tab === "scheduler",
  });
  const schedulerOpsQ = useQuery({
    queryKey: ["taskSchedulerOps"],
    queryFn: api.taskSchedulerOpsSummary,
    enabled: authed && hasProject && tab === "scheduler",
  });
  const schedulerInsightsQ = useQuery({
    queryKey: ["taskSchedulerInsights", selectedTaskIds.join(","), schedulerMaxParallel, schedulerIncludeBlocked],
    queryFn: () => api.taskSchedulerInsights({
      ids: selectedTaskIds,
      max_items: 80,
      max_parallel: schedulerMaxParallel,
      include_blocked: schedulerIncludeBlocked,
    }),
    enabled: authed && hasProject && tab === "scheduler",
  });

  const sprintTasksQ = useQuery({
    queryKey: ["tasks", "sprint", sprintId],
    queryFn: () => api.tasks(sprintId),
    enabled: authed && hasProject && tab === "sprint" && Boolean(sprintId),
  });

  const sprintsQ = useQuery({
    queryKey: ["sprints"],
    queryFn: api.sprints,
    enabled: authed && hasProject,
  });

  const progressQ = useQuery({
    queryKey: ["sprint-progress", sprintId],
    queryFn: () => api.sprintProgress(sprintId),
    enabled: authed && hasProject && tab === "sprint" && Boolean(sprintId),
  });
  const burndownQ = useQuery({
    queryKey: ["sprint-burndown", sprintId],
    queryFn: () => api.sprintBurndown(sprintId),
    enabled: authed && hasProject && tab === "sprint" && Boolean(sprintId),
  });
  const sprintOpsQ = useQuery({
    queryKey: ["sprint-ops-plan", sprintId],
    queryFn: () => api.sprintOpsPlan(sprintId),
    enabled: authed && hasProject && tab === "sprint",
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<(typeof PRIORITIES)[number]>("P1");
  const [newSprintId, setNewSprintId] = useState("");

  const patchTask = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.updateTask(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      if (sprintId) void qc.invalidateQueries({ queryKey: ["sprint-progress", sprintId] });
    },
  });

  const reorderBoard = useMutation({
    mutationFn: (groups: Record<string, string[]>) => api.reorderTasksBoard(groups),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
    },
  });

  const createTaskMut = useMutation({
    mutationFn: () =>
      api.createTask({
        title: newTitle.trim(),
        priority: newPriority,
        sprint_id: newSprintId || undefined,
      }),
    onSuccess: () => {
      setNewTitle("");
      setCreateOpen(false);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      if (sprintId) void qc.invalidateQueries({ queryKey: ["sprint-progress", sprintId] });
    },
  });

  const deleteTaskMut = useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      void qc.invalidateQueries({ queryKey: ["taskDependencies"] });
    },
  });

  const bulkUpdateMut = useMutation({
    mutationFn: () =>
      api.bulkUpdateTasks({
        ids: selectedTaskIds,
        status: bulkStatus || undefined,
        priority: bulkPriority || undefined,
        assigned_to: bulkAssignee.trim() || undefined,
      }),
    onSuccess: () => {
      setSelectedTaskIds([]);
      setBulkStatus("");
      setBulkPriority("");
      setBulkAssignee("");
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      void qc.invalidateQueries({ queryKey: ["taskDependencies"] });
      if (sprintId) void qc.invalidateQueries({ queryKey: ["sprint-progress", sprintId] });
    },
  });
  const interactionOpsMemoryMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.pagesInteractionOpsMemory({
        dry_run: dryRun,
        domain: "delivery",
        q: taskQuery.trim(),
        status: "watch",
        kind: "episodic",
        write_kb: true,
        idempotency_key: `tasks:${taskQuery.trim()}:interaction-ops-memory`,
      }),
    onSuccess: setInteractionOpsMemoryResult,
  });
  const interactionOpsExportMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.pagesInteractionOpsExport({
        dry_run: dryRun,
        domain: "delivery",
        q: taskQuery.trim(),
        status: "watch",
        include_events: true,
        idempotency_key: `tasks:${taskQuery.trim()}:interaction-ops-export`,
      }),
    onSuccess: setInteractionOpsExportResult,
  });

  const dispatchMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.dispatchTasks({
        ids: selectedTaskIds,
        dry_run: dryRun,
        max_items: 100,
        include_blocked: dispatchIncludeBlocked,
        strategy: dispatchStrategy,
      }),
    onSuccess: (data) => {
      setDispatchResult(data);
      if (!data?.dry_run) {
        setSelectedTaskIds([]);
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
        void qc.invalidateQueries({ queryKey: ["taskDependencies"] });
      }
    },
  });

  const schedulerMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.taskSchedulerPlan({
        ids: selectedTaskIds,
        dry_run: dryRun,
        max_items: 100,
        max_parallel: schedulerMaxParallel,
        include_blocked: schedulerIncludeBlocked,
        policy: schedulerPolicy,
        event: "ui.scheduler.plan",
      }),
    onSuccess: (data) => {
      setSchedulerResult(data);
      if (!data?.dry_run) {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
        void qc.invalidateQueries({ queryKey: ["taskAgentFeed"] });
        void qc.invalidateQueries({ queryKey: ["taskSchedulerRuns"] });
      }
    },
  });

  const schedulerActionMut = useMutation({
    mutationFn: ({ scheduleId, action, dryRun }: { scheduleId: string; action: string; dryRun?: boolean }) =>
      api.taskSchedulerRunAction(scheduleId, {
        action,
        dry_run: dryRun ?? false,
        policy: schedulerPolicy,
        max_parallel: schedulerMaxParallel,
        include_blocked: schedulerIncludeBlocked,
        note: "ui.scheduler.action",
      }),
    onSuccess: (data) => {
      if (data?.plan) setSchedulerResult(data.plan);
      void qc.invalidateQueries({ queryKey: ["taskSchedulerRuns"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      void qc.invalidateQueries({ queryKey: ["taskAgentFeed"] });
    },
  });

  const schedulerRunbookMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.taskSchedulerRunbook({
        dry_run: dryRun,
        assigned_to: "Ops",
        priority: "P1",
        include_unclaimed: true,
        include_stale_claims: true,
        include_quality_blocks: true,
        include_dependency_blocks: true,
        note: "ui.scheduler.runbook",
      }),
    onSuccess: (data) => {
      setSchedulerRunbookResult(data);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      void qc.invalidateQueries({ queryKey: ["taskSchedulerOps"] });
    },
  });
  const schedulerInsightTasksMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.taskSchedulerInsightTasks({
        dry_run: dryRun,
        assigned_to: "",
        priority: "P1",
        limit: 20,
      }),
    onSuccess: (data) => {
      setSchedulerInsightTasksResult(data);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["taskSchedulerInsights"] });
    },
  });

  const sprintOpsTasksMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.sprintOpsTasks({
        dry_run: dryRun,
        priority: "P1",
        assigned_to: "SprintOps Agent",
        sprint_id: sprintId || undefined,
        limit: 20,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      void qc.invalidateQueries({ queryKey: ["sprint-ops-plan"] });
      if (sprintId) void qc.invalidateQueries({ queryKey: ["sprint-progress", sprintId] });
    },
  });

  const agentPlanMut = useMutation({
    mutationFn: (row: any) =>
      api.taskAgentExecutionPlan({
        claim_id: row?.claim_id,
        task_id: row?.task_id,
        agent: row?.agent || "",
        include_context: true,
      }),
    onSuccess: (data) => setAgentPlanResult(data),
  });

  const qualityEvaluateMut = useMutation({
    mutationFn: () =>
      api.taskQualityEvaluate({
        task_id: selectedTaskIds[0],
        gate_results: [],
        dry_run: true,
        source: "ui.scheduler.quality.preview",
      }),
  });

  const qualityPolicyMut = useMutation({
    mutationFn: () =>
      api.taskQualityPolicyUpdate({
        mode: qualityPolicyDraft.mode,
        required_gate_ids: qualityPolicyDraft.required.split(",").map((x) => x.trim()).filter(Boolean),
        advisory_gate_ids: qualityPolicyDraft.advisory.split(",").map((x) => x.trim()).filter(Boolean),
        min_confidence_to_complete: Number(qualityPolicyDraft.minConfidence || 0),
        require_artifact_for_complete: qualityPolicyDraft.requireArtifact,
        auto_block_on_failed_required: qualityPolicyDraft.autoBlock,
        notes: qualityPolicyDraft.notes,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["taskQualityPolicy"] });
      void qc.invalidateQueries({ queryKey: ["taskQualitySummary"] });
      void qc.invalidateQueries({ queryKey: ["taskSchedulerOps"] });
    },
  });

  const qualityTasksMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.taskQualityTasks({
        dry_run: dryRun,
        decisions: ["block", "warn"],
        assigned_to: "QA Agent",
        priority: "P1",
        limit: 50,
      }),
    onSuccess: (data) => {
      setQualityTasksResult(data);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      void qc.invalidateQueries({ queryKey: ["taskQualitySummary"] });
    },
  });

  const depTasksMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.taskDependencyTasks({
        dry_run: dryRun,
        assigned_to: "",
        priority: "P1",
        limit: 30,
        include_cycles: true,
        include_blocked: true,
        include_bottlenecks: true,
        include_missing_map: true,
      }),
    onSuccess: (data) => {
      setDepTasksResult(data);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      void qc.invalidateQueries({ queryKey: ["taskDependencies"] });
    },
  });

  const sprints = sprintsQ.data ?? [];
  const activeSprint = useMemo(
    () => sprints.find((s: any) => s.status === "active") ?? sprints[0],
    [sprints],
  );

  useEffect(() => {
    const policy = qualityPolicyQ.data?.policy;
    if (!policy) return;
    setQualityPolicyDraft({
      mode: policy.mode || "blocking",
      required: (policy.required_gate_ids || []).join(","),
      advisory: (policy.advisory_gate_ids || []).join(","),
      minConfidence: Number(policy.min_confidence_to_complete ?? 0.65),
      requireArtifact: Boolean(policy.require_artifact_for_complete ?? true),
      autoBlock: Boolean(policy.auto_block_on_failed_required ?? true),
      notes: policy.notes || "",
    });
  }, [qualityPolicyQ.data?.policy]);

  useEffect(() => {
    if (tab === "sprint" && !sprintId && activeSprint?.id) {
      setSprintId(activeSprint.id);
    }
  }, [tab, sprintId, activeSprint?.id]);

  const tasks = tab === "sprint" ? (sprintTasksQ.data ?? []) : linkedTaskRows(allTasksQ.data ?? [], linkedTaskId, taskQuery);
  const loading = tab === "sprint" ? sprintTasksQ.isLoading : allTasksQ.isLoading;
  const error = tab === "sprint" ? sprintTasksQ.error : allTasksQ.error;

  const boardGroups = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const s of STATUSES) g[s] = [];
    for (const task of tasks) {
      const st = includesStatus(task.status) ? task.status : "pending";
      g[st].push(task);
    }
    return g;
  }, [tasks]);

  const priorityGroups = useMemo(() => {
    const g: Record<string, any[]> = { P0: [], P1: [], P2: [], P3: [] };
    for (const task of tasks) {
      const pr = includesPriority(task.priority) ? task.priority : "P3";
      g[pr].push(task);
    }
    return g;
  }, [tasks]);

  const dependencyNodes = useMemo(() => {
    const q = depQuery.trim().toLowerCase();
    return (depsQ.data?.nodes ?? []).filter((node: any) => {
      const text = `${node.id} ${node.title} ${taskRecordStatusLabel(node.status, t)} ${node.priority} ${node.assigned_to || ""}`.toLowerCase();
      const matchQ = !q || text.includes(q);
      const matchFilter =
        depFilter === "all" ||
        (depFilter === "blocked" && node.is_dependency_blocked) ||
        (depFilter === "ready" && !node.is_dependency_blocked && node.status !== "completed") ||
        (depFilter === "high" && node.risk_level === "high");
      return matchQ && matchFilter;
    });
  }, [depFilter, depQuery, depsQ.data?.nodes]);

  const dependencyEdges = useMemo(() => {
    const visible = new Set(dependencyNodes.map((node: any) => node.id));
    return (depsQ.data?.edges ?? []).filter((edge: any) => visible.has(edge.source_id) || visible.has(edge.target_id));
  }, [dependencyNodes, depsQ.data?.edges]);

  const commitPriorityReorder = (groups: Record<(typeof PRIORITIES)[number], string[]>) => {
    reorderBoard.mutate(groups);
  };

  const handlePriorityDrop = (
    dragId: string,
    targetP: (typeof PRIORITIES)[number],
    insertBeforeId: string | null,
  ) => {
    const base = groupsFromTasks(tasks);
    const next = moveTaskBetweenColumns(base, dragId, targetP, insertBeforeId);
    commitPriorityReorder(next);
  };

  const handleBoardStatusDrop = (dragId: string, targetStatus: (typeof STATUSES)[number]) => {
    const task = tasks.find((t: any) => t.id === dragId);
    if (!task || task.status === targetStatus) return;
    patchTask.mutate({ id: dragId, patch: { status: targetStatus } });
  };

  const busy = patchTask.isPending || reorderBoard.isPending || createTaskMut.isPending || deleteTaskMut.isPending || bulkUpdateMut.isPending || interactionOpsMemoryMut.isPending || interactionOpsExportMut.isPending || dispatchMut.isPending || schedulerMut.isPending || schedulerActionMut.isPending || schedulerRunbookMut.isPending || schedulerInsightTasksMut.isPending || sprintOpsTasksMut.isPending || qualityPolicyMut.isPending || qualityTasksMut.isPending;
  const canBulkUpdate = selectedTaskIds.length > 0 && Boolean(bulkStatus || bulkPriority || bulkAssignee.trim());
  const focusedSchedulerPanel = focused && tab === "scheduler" && schedulerPanel !== "ops";
  const showSchedulerPlanning = tab === "scheduler" && (!focusedSchedulerPanel || schedulerPanel === "insights");
  const schedulerLayoutClass = showSchedulerPlanning ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]" : "space-y-4";

  if (!authed) {
    return <div className="text-sm text-rose-600">{t("auth.dashboardNeedLogin")}</div>;
  }
  if (!hasProject) {
    return <div className="text-sm text-amber-700">{t("projectSelector.hint")}</div>;
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "list", label: t("page.tasks.tabList") },
    { key: "board", label: t("page.tasks.tabBoard") },
    { key: "priority", label: t("page.tasks.tabPriority") },
    { key: "sprint", label: t("page.tasks.tabSprint") },
    { key: "deps", label: t("page.tasks.tabDeps") },
    { key: "scheduler", label: t("page.tasks.tabScheduler") },
  ];

  const taskColumns: ColumnsType<any> = [
    {
      title: t("page.tasks.task"),
      dataIndex: "title",
      render: (_value, task) => (
        <div className="min-w-0">
          <a href={manualTaskHref(task)} className="block truncate text-sm font-semibold text-[var(--brand)]">{task.title}</a>
          <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{task.id}</p>
          {task.debug_notes ? <p className="mt-1 line-clamp-1 text-xs text-[var(--muted-strong)]">{task.debug_notes}</p> : null}
        </div>
      ),
    },
    {
      title: t("page.tasks.statusLabel"),
      dataIndex: "status",
      width: 150,
      render: (value, task) => (
        <Select
          size="small"
          className="w-32"
          value={value || "pending"}
          disabled={busy}
          onChange={(status) => patchTask.mutate({ id: task.id, patch: { status } })}
          options={STATUSES.map((status) => ({ value: status, label: taskRecordStatusLabel(status, t) }))}
        />
      ),
    },
    {
      title: t("page.tasks.priority"),
      dataIndex: "priority",
      width: 110,
      render: (value, task) => (
        <Select
          size="small"
          className="w-20"
          value={includesPriority(value) ? value : "P3"}
          disabled={busy}
          onChange={(priority) => patchTask.mutate({ id: task.id, patch: { priority } })}
          options={PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
        />
      ),
    },
    {
      title: t("page.tasks.assignee"),
      dataIndex: "assigned_to",
      width: 140,
      render: (value) => value || "-",
    },
    {
      title: t("page.tasks.source"),
      dataIndex: "source",
      width: 180,
      render: (_value, task) => (
        <Space size={[4, 4]} wrap>
          <Tag>{task.source || "manual"}</Tag>
          {task.dev_tool ? <Tag color="blue">{task.dev_tool}</Tag> : null}
          {task.branch ? <Tag>{task.branch}</Tag> : null}
        </Space>
      ),
    },
    {
      title: t("page.tasks.actions"),
      dataIndex: "actions",
      width: 110,
      render: (_value, task) => (
        <Popconfirm
          title={t("page.tasks.confirmDelete", { name: task.title })}
          okText={t("common.delete")}
          cancelText={t("common.cancel")}
          onConfirm={() => deleteTaskMut.mutate(task.id)}
        >
          <Button size="small" danger disabled={busy}>{t("page.tasks.delete")}</Button>
        </Popconfirm>
      ),
    },
  ];

  const sprintOpsRiskColumns: ColumnsType<any> = [
    {
      title: t("page.tasks.sprintOpsSeverity"),
      dataIndex: "severity",
      width: 88,
      render: (value) => <Tag color={value === "P0" || value === "P1" ? "red" : "orange"}>{value}</Tag>,
    },
    { title: t("page.tasks.sprintOpsCategory"), dataIndex: "category", width: 120 },
    {
      title: t("page.tasks.sprintOpsRisk"),
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
      title: t("page.tasks.sprintOpsCommand"),
      dataIndex: "command",
      width: 260,
      render: (value) => <Typography.Text code copyable className="!text-xs">{value}</Typography.Text>,
    },
  ];

  return (
    <div className="w-full space-y-4">
      <TasksWorkbenchHeader
        pending={loading || busy}
        onRefresh={() => {
          void allTasksQ.refetch();
          void summaryQ.refetch();
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {!focused ? (
          <Segmented
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            options={tabs.map((item) => ({ value: item.key, label: item.label }))}
          />
        ) : (
          <div className="text-sm font-semibold text-[var(--text)]">{tabs.find((item) => item.key === tab)?.label ?? tab}</div>
        )}
        {loading ? <span className="text-xs text-slate-500">…</span> : null}
        <Space wrap>
          <Button onClick={() => {
            setDispatchOpen(true);
            setDispatchResult(null);
          }}>
            {t("page.tasks.smartDispatch")}
          </Button>
          <Button type="primary" onClick={() => setCreateOpen(true)}>{t("page.tasks.create")}</Button>
        </Space>
      </div>

      {linkedTaskId && authed && hasProject && (
        <Card title={t("deliveryManualReview.currentFacts")}>
          <DeliveryTaskDetail key={`${getProjectId()}:${getSessionRevision()}:${linkedTaskId}`} projectId={getProjectId()!} sessionId={getSessionRevision() || ""} taskId={linkedTaskId} />
        </Card>
      )}

      <Card title={t("page.tasks.filters")}>
        <div className="flex flex-wrap items-center gap-2">
          <Input.Search
            className="min-w-0 w-full flex-1 sm:min-w-[20rem]"
            allowClear
            value={taskQuery}
            onChange={(e) => setTaskQuery(e.target.value)}
            placeholder={t("page.tasks.searchPh")}
          />
          <Select
            className="min-w-40"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "", label: t("page.tasks.allStatuses") },
              ...STATUSES.map((status) => ({ value: status, label: taskRecordStatusLabel(status, t) })),
            ]}
          />
          <Select
            className="min-w-36"
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={[{ value: "", label: t("page.tasks.allPriorities") }, ...PRIORITIES.map((priority) => ({ value: priority, label: priority }))]}
          />
          <Select
            className="min-w-48"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[
              { value: "", label: t("page.tasks.allSources") },
              { value: "manual", label: t("page.tasks.sourceManual") },
              { value: "analytics_report", label: t("page.tasks.sourceAnalyticsReport") },
              { value: "interaction_ops", label: t("page.tasks.sourceInteractionOps") },
              { value: "system_page_backlog", label: t("page.tasks.sourceSystemBacklog") },
              { value: "project_bootstrap", label: t("page.tasks.sourceProjectBootstrap") },
            ]}
          />
          <Button
            onClick={() => {
              setTaskQuery("");
              setStatusFilter("");
              setPriorityFilter("");
              setSourceFilter("");
            }}
          >
            {t("page.tasks.clearFilters")}
          </Button>
        </div>
      </Card>

      <Card title={t("page.tasks.interactionOpsTitle")}>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="grid gap-3 md:grid-cols-4">
            <Statistic title={t("page.tasks.interactionOpsHealth")} value={interactionOpsQ.data?.summary?.health ?? 100} suffix="/100" />
            <Statistic title={t("page.tasks.interactionOpsHigh")} value={interactionOpsQ.data?.summary?.high ?? 0} />
            <Statistic title={t("page.tasks.interactionOpsBlocked")} value={interactionOpsQ.data?.summary?.blocked ?? 0} />
            <Statistic title={t("page.tasks.interactionOpsItems")} value={interactionOpsQ.data?.summary?.total ?? 0} />
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <div className="flex flex-wrap gap-2">
              <Button size="small" onClick={() => setSourceFilter("interaction_ops")}>
                {t("page.tasks.filterInteractionOps")}
              </Button>
              <Button size="small" href="#/system-map/productization">
                {t("page.tasks.viewInteractionOpsSource")}
              </Button>
              <Button size="small" loading={interactionOpsMemoryMut.isPending} onClick={() => interactionOpsMemoryMut.mutate(false)}>
                {t("page.tasks.backfillInteractionOpsEvidence")}
              </Button>
              <Button size="small" loading={interactionOpsExportMut.isPending} onClick={() => interactionOpsExportMut.mutate(true)}>
                {t("page.tasks.previewInteractionOpsExport")}
              </Button>
            </div>
            <code className="mt-3 block rounded bg-[var(--surface)] px-2 py-1 text-xs text-[var(--brand)]">
              sop pages interaction-ops --domain delivery --q "{taskQuery.trim()}" --json
            </code>
            {interactionOpsMemoryResult || interactionOpsExportResult ? (
              <div className="mt-2 space-y-1 text-xs text-[var(--muted)]">
                {interactionOpsMemoryResult ? (
                  <p>{t("page.tasks.interactionOpsMemoryResult", { items: interactionOpsMemoryResult.summary?.items ?? 0 })}</p>
                ) : null}
                {interactionOpsExportResult ? (
                  <p>{t("page.tasks.interactionOpsExportResult", { package: interactionOpsExportResult.summary?.package_id ?? "-" })}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <Table
          className="mt-3"
          rowKey={(row: any) => String(row.id)}
          dataSource={interactionOpsQ.data?.items ?? []}
          loading={interactionOpsQ.isLoading}
          size="small"
          pagination={false}
          scroll={{ x: 820 }}
          locale={{ emptyText: t("page.tasks.noInteractionOpsRisks") }}
          columns={[
            { title: t("page.tasks.source"), dataIndex: "source", width: 130, render: (_value, row: any) => <Tag>{row.source_type || row.source}</Tag> },
            {
              title: t("page.tasks.task"),
              dataIndex: "title",
              render: (value, row: any) => (
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">{value}</p>
                  <p className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">{typeof row.evidence === "string" ? row.evidence : JSON.stringify(row.evidence ?? {})}</p>
                </div>
              ),
            },
            { title: t("page.tasks.statusLabel"), dataIndex: "status", width: 120, render: (value) => <Tag>{value}</Tag> },
            { title: t("page.tasks.priority"), dataIndex: "severity", width: 110, render: (value) => <Tag color={value === "high" ? "red" : value === "medium" ? "gold" : "blue"}>{value}</Tag> },
            { title: "CLI", dataIndex: "command", width: 260, render: (value) => <Typography.Text code copyable className="!text-xs">{value}</Typography.Text> },
          ]}
        />
      </Card>

      <Modal
        title={t("page.tasks.create")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          if (!newTitle.trim()) return;
          createTaskMut.mutate();
        }}
        okButtonProps={{ disabled: busy || !newTitle.trim(), loading: createTaskMut.isPending }}
        okText={t("page.tasks.save")}
        cancelText={t("common.cancel")}
      >
        <div className="space-y-3">
          <label className="block text-xs text-[var(--muted)]">
            {t("page.tasks.titlePh")}
            <Input className="mt-1" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-[var(--muted)]">
              {t("page.tasks.priority")}
              <Select
                className="mt-1 w-full"
                value={newPriority}
                onChange={(value) => setNewPriority(value as (typeof PRIORITIES)[number])}
                options={PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
              />
            </label>
            <label className="block text-xs text-[var(--muted)]">
              {t("page.tasks.sprintOptional")}
              <Select
                className="mt-1 w-full"
                allowClear
                value={newSprintId || undefined}
                onChange={(value) => setNewSprintId(value || "")}
                options={sprints.map((s: any) => ({ value: s.id, label: s.goal }))}
              />
            </label>
          </div>
          {createTaskMut.error ? <p className="text-sm text-rose-600">{(createTaskMut.error as Error).message}</p> : null}
        </div>
      </Modal>

      <Modal
        title={t("page.tasks.dispatchTitle")}
        open={dispatchOpen}
        onCancel={() => setDispatchOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDispatchOpen(false)}>{t("common.close")}</Button>,
          <Button key="preview" loading={dispatchMut.isPending} onClick={() => dispatchMut.mutate(true)}>{t("page.tasks.previewDispatch")}</Button>,
          <Button key="apply" type="primary" loading={dispatchMut.isPending} disabled={!dispatchResult?.items?.length} onClick={() => dispatchMut.mutate(false)}>{t("page.tasks.applyDispatch")}</Button>,
        ]}
        width={980}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="min-w-44"
              value={dispatchStrategy}
              onChange={setDispatchStrategy}
              options={[
                { value: "balanced", label: t("page.tasks.dispatchBalanced") },
                { value: "ai_first", label: t("page.tasks.dispatchAiFirst") },
                { value: "human_review", label: t("page.tasks.dispatchHumanReview") },
              ]}
            />
            <label className="inline-flex items-center gap-2 text-sm text-[var(--muted-strong)]">
              <input type="checkbox" checked={dispatchIncludeBlocked} onChange={(e) => setDispatchIncludeBlocked(e.target.checked)} />
              {t("page.tasks.includeBlocked")}
            </label>
            <span className="text-xs text-[var(--muted)]">{t("page.tasks.dispatchScope", { count: selectedTaskIds.length })}</span>
          </div>
          {dispatchMut.error ? <Alert type="error" showIcon message={(dispatchMut.error as Error).message} /> : null}
          {dispatchResult && !dispatchResult.dry_run ? <Alert type="success" showIcon message={t("page.tasks.dispatchApplied", { count: dispatchResult.updated ?? 0 })} /> : null}
          <Table
            size="small"
            rowKey={(row: any) => String(row.task_id)}
            dataSource={dispatchResult?.items ?? []}
            pagination={{ pageSize: 8, showSizeChanger: true }}
            scroll={{ x: 920, y: 420 }}
            locale={{ emptyText: t("page.tasks.noDispatchPlan") }}
            columns={[
              { title: "#", dataIndex: "order", width: 56 },
              {
                title: t("page.tasks.task"),
                dataIndex: "title",
                render: (value: string, row: any) => (
                  <div>
                    <div className="font-medium">{value}</div>
                    <div className="font-mono text-xs text-[var(--muted)]">{row.task_id}</div>
                  </div>
                ),
              },
              { title: t("page.tasks.priority"), dataIndex: "priority", width: 90 },
              { title: t("page.tasks.assignee"), dataIndex: "assigned_to", width: 150 },
              { title: t("page.tasks.devTool"), dataIndex: "dev_tool", width: 110, render: (value: string) => <Tag color="blue">{value}</Tag> },
              { title: t("page.tasks.ready"), dataIndex: "ready", width: 90, render: (value: boolean, row: any) => value ? <Tag color="success">ready</Tag> : <Tag color="warning">{row.blocked_by?.length ?? 0}</Tag> },
              { title: t("page.tasks.dispatchReason"), dataIndex: "reason", width: 320 },
            ]}
          />
        </div>
      </Modal>

      {tab === "board" ? (
        <p className="text-xs text-slate-500">{t("page.tasks.boardDragHint")}</p>
      ) : null}
      {tab === "priority" ? (
        <p className="text-xs text-slate-500">{t("page.tasks.dragHint")}</p>
      ) : null}

      {error ? (
        <p className="text-sm text-rose-600">{(error as Error).message}</p>
      ) : null}

      {tab === "list" ? (
        <Card title={t("page.tasks.executionList")}>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <span className="text-sm text-[var(--muted-strong)]">
              {t("page.tasks.bulkSelected", { count: selectedTaskIds.length })}
            </span>
            <Select
              className="min-w-40"
              allowClear
              placeholder={t("page.tasks.bulkStatus")}
              value={bulkStatus || undefined}
              onChange={(value) => setBulkStatus(value || "")}
              options={STATUSES.map((status) => ({ value: status, label: taskRecordStatusLabel(status, t) }))}
            />
            <Select
              className="min-w-36"
              allowClear
              placeholder={t("page.tasks.bulkPriority")}
              value={bulkPriority || undefined}
              onChange={(value) => setBulkPriority(value || "")}
              options={PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
            />
            <Input
              className="w-44"
              allowClear
              value={bulkAssignee}
              onChange={(e) => setBulkAssignee(e.target.value)}
              placeholder={t("page.tasks.bulkAssignee")}
            />
            <Button
              type="primary"
              disabled={!canBulkUpdate}
              loading={bulkUpdateMut.isPending}
              onClick={() => bulkUpdateMut.mutate()}
            >
              {t("page.tasks.bulkApply")}
            </Button>
            <Button
              disabled={!selectedTaskIds.length && !bulkStatus && !bulkPriority && !bulkAssignee}
              onClick={() => {
                setSelectedTaskIds([]);
                setBulkStatus("");
                setBulkPriority("");
                setBulkAssignee("");
              }}
            >
              {t("common.reset")}
            </Button>
            {bulkUpdateMut.error ? <span className="text-sm text-rose-600">{(bulkUpdateMut.error as Error).message}</span> : null}
          </div>
          <Table
            rowKey="id"
            columns={taskColumns}
            dataSource={tasks}
            loading={loading}
            size="middle"
            scroll={{ x: 980 }}
            rowSelection={{
              selectedRowKeys: selectedTaskIds,
              onChange: (keys) => setSelectedTaskIds(keys.map(String)),
            }}
            pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100], showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}` }}
          />
        </Card>
      ) : null}

      {tab === "scheduler" ? (
        <div className={schedulerLayoutClass}>
          {showSchedulerPlanning ? (
          <div className="space-y-4">
            <Card
              title={t("page.tasks.schedulerTitle")}
              actions={
                <Space wrap>
                  <Button loading={schedulerMut.isPending} onClick={() => schedulerMut.mutate(true)}>
                    {t("page.tasks.schedulerPreview")}
                  </Button>
                  <Button type="primary" loading={schedulerMut.isPending} disabled={!schedulerResult?.agent_packets?.length} onClick={() => schedulerMut.mutate(false)}>
                    {t("page.tasks.schedulerApply")}
                  </Button>
                </Space>
              }
            >
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <Select
                  className="min-w-48"
                  value={schedulerPolicy}
                  onChange={setSchedulerPolicy}
                  options={[
                    { value: "quality_first", label: t("page.tasks.schedulerPolicyQuality") },
                    { value: "balanced", label: t("page.tasks.schedulerPolicyBalanced") },
                    { value: "throughput", label: t("page.tasks.schedulerPolicyThroughput") },
                    { value: "cost_saver", label: t("page.tasks.schedulerPolicyCost") },
                  ]}
                />
                <InputNumber
                  className="w-36"
                  min={1}
                  max={50}
                  value={schedulerMaxParallel}
                  onChange={(value) => setSchedulerMaxParallel(Number(value || 1))}
                  addonBefore={t("page.tasks.maxParallel")}
                />
                <label className="inline-flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                  <input type="checkbox" checked={schedulerIncludeBlocked} onChange={(e) => setSchedulerIncludeBlocked(e.target.checked)} />
                  {t("page.tasks.includeBlocked")}
                </label>
                <span className="text-xs text-[var(--muted)]">{t("page.tasks.schedulerScope", { count: selectedTaskIds.length })}</span>
              </div>
              {schedulerMut.error ? <Alert className="mb-3" type="error" showIcon message={(schedulerMut.error as Error).message} /> : null}
              {schedulerResult && !schedulerResult.dry_run ? <Alert className="mb-3" type="success" showIcon message={t("page.tasks.schedulerApplied", { count: schedulerResult.applied ?? 0 })} /> : null}
              {schedulerResult?.summary ? (
                <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                  <Stat label={t("page.tasks.schedulerReady")} value={schedulerResult.summary.ready ?? 0} />
                  <Stat label={t("page.tasks.schedulerBlocked")} value={schedulerResult.summary.blocked ?? 0} />
                  <Stat label={t("page.tasks.schedulerScheduled")} value={schedulerResult.summary.scheduled ?? 0} />
                  <Stat label={t("page.tasks.schedulerStages")} value={schedulerResult.summary.stages ?? 0} />
                  <Stat label={t("page.tasks.schedulerGates")} value={schedulerResult.summary.quality_gates ?? 0} />
                  <Stat label={t("page.tasks.schedulerWakeups")} value={schedulerResult.summary.event_wakeups ?? 0} />
                </div>
              ) : null}
              <Table
                rowKey={(row: any) => String(row.packet_id)}
                dataSource={schedulerResult?.agent_packets ?? []}
                loading={schedulerMut.isPending}
                size="small"
                scroll={{ x: 1100 }}
                pagination={{ pageSize: 8, showSizeChanger: true }}
                locale={{ emptyText: t("page.tasks.schedulerEmpty") }}
                columns={[
                  { title: "#", dataIndex: "order", width: 56 },
                  { title: t("page.tasks.lane"), dataIndex: "lane", width: 70, render: (value: number) => <Tag color="cyan">L{value}</Tag> },
                  {
                    title: t("page.tasks.task"),
                    dataIndex: "title",
                    render: (value: string, row: any) => (
                      <div>
                        <div className="font-medium text-[var(--text)]">{value}</div>
                        <div className="font-mono text-xs text-[var(--muted)]">{row.task_id}</div>
                      </div>
                    ),
                  },
                  { title: t("page.tasks.assignee"), dataIndex: "assigned_to", width: 150 },
                  { title: t("page.tasks.devTool"), dataIndex: "dev_tool", width: 110, render: (value: string) => <Tag color="blue">{value}</Tag> },
                  { title: t("page.tasks.ready"), dataIndex: "ready", width: 90, render: (value: boolean, row: any) => value ? <Tag color="success">ready</Tag> : <Tag color="warning">{row.blocked_by?.length ?? 0}</Tag> },
                  { title: t("page.tasks.qualityGates"), dataIndex: "quality_gates", width: 130, render: (items: any[]) => items?.length ?? 0 },
                  { title: t("page.tasks.dispatchReason"), dataIndex: "dispatch_reason", width: 320 },
                ]}
              />
            </Card>

            <Card title={t("page.tasks.schedulerDag")}>
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {(schedulerResult?.stages ?? []).map((stage: any) => (
                  <div key={String(stage.stage)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[var(--text)]">{t("page.tasks.stage")} {stage.stage}</span>
                      <Tag>{stage.tasks?.length ?? 0}</Tag>
                    </div>
                    <div className="space-y-2">
                      {(stage.tasks ?? []).map((task: any) => (
                        <div key={task.id} className="rounded-md bg-[var(--surface-muted)] px-2 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="line-clamp-1 text-xs font-medium text-[var(--text)]">{task.title}</span>
                            <Tag color={task.ready ? "success" : "warning"}>{task.priority}</Tag>
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">{task.id}</div>
                          {task.blocked_by?.length ? <div className="mt-1 line-clamp-1 text-[10px] text-rose-600">{task.blocked_by.join(", ")}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!schedulerResult?.stages?.length ? <p className="text-sm text-[var(--muted)]">{t("page.tasks.schedulerRunHint")}</p> : null}
              </div>
            </Card>

            <Card
              title={t("page.tasks.schedulerRuns")}
              actions={
                <Space wrap>
                  <Input.Search
                    className="w-56"
                    allowClear
                    value={schedulerRunQuery}
                    onChange={(e) => setSchedulerRunQuery(e.target.value)}
                    placeholder={t("page.tasks.schedulerRunSearch")}
                  />
                  <label className="inline-flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                    <input type="checkbox" checked={schedulerIncludeArchived} onChange={(e) => setSchedulerIncludeArchived(e.target.checked)} />
                    {t("page.tasks.includeArchived")}
                  </label>
                </Space>
              }
            >
              {schedulerActionMut.error ? <Alert className="mb-3" type="error" showIcon message={(schedulerActionMut.error as Error).message} /> : null}
              <div className="mb-3 grid gap-3 sm:grid-cols-4">
                <Stat label={t("page.tasks.schedulerRunTotal")} value={schedulerRunsQ.data?.summary?.runs ?? 0} />
                <Stat label={t("page.tasks.schedulerRunApplied")} value={schedulerRunsQ.data?.summary?.applied ?? 0} />
                <Stat label={t("page.tasks.schedulerScheduled")} value={schedulerRunsQ.data?.summary?.scheduled ?? 0} />
                <Stat label={t("page.tasks.schedulerBlocked")} value={schedulerRunsQ.data?.summary?.blocked ?? 0} />
              </div>
              <Table
                rowKey={(row: any) => String(row.schedule_id)}
                dataSource={schedulerRunsQ.data?.items ?? []}
                loading={schedulerRunsQ.isLoading || schedulerActionMut.isPending}
                size="small"
                scroll={{ x: 1120 }}
                pagination={{ pageSize: 6, showSizeChanger: true }}
                locale={{ emptyText: t("page.tasks.schedulerRunsEmpty") }}
                columns={[
                  {
                    title: t("page.tasks.schedulerRunId"),
                    dataIndex: "schedule_id",
                    width: 180,
                    render: (value: string, row: any) => (
                      <div>
                        <div className="font-mono text-xs text-[var(--text)]">{value}</div>
                        {row.parent_schedule_id ? <div className="font-mono text-[10px] text-[var(--muted)]">parent {row.parent_schedule_id}</div> : null}
                      </div>
                    ),
                  },
                  { title: t("page.tasks.runStatus"), dataIndex: "status", width: 110, render: (value: string) => <Tag>{value}</Tag> },
                  { title: t("page.tasks.schedulerPolicy"), dataIndex: "policy", width: 130 },
                  { title: t("page.tasks.schedulerScheduled"), dataIndex: ["summary", "scheduled"], width: 100 },
                  { title: t("page.tasks.schedulerRunApplied"), dataIndex: "applied", width: 100 },
                  { title: t("page.tasks.runCreatedAt"), dataIndex: "created_at", width: 180 },
                  {
                    title: t("page.tasks.action"),
                    key: "action",
                    width: 300,
                    render: (_: unknown, row: any) => (
                      <Space size={4} wrap>
                        <Button size="small" onClick={() => schedulerActionMut.mutate({ scheduleId: row.schedule_id, action: "rerun", dryRun: true })}>
                          {t("page.tasks.previewRerun")}
                        </Button>
                        <Button size="small" type="primary" onClick={() => schedulerActionMut.mutate({ scheduleId: row.schedule_id, action: "rerun", dryRun: false })}>
                          {t("page.tasks.applyRerun")}
                        </Button>
                        {row.archived ? (
                          <Button size="small" onClick={() => schedulerActionMut.mutate({ scheduleId: row.schedule_id, action: "restore" })}>
                            {t("page.tasks.restoreRun")}
                          </Button>
                        ) : (
                          <Button size="small" onClick={() => schedulerActionMut.mutate({ scheduleId: row.schedule_id, action: "archive" })}>
                            {t("page.tasks.archiveRun")}
                          </Button>
                        )}
                        <Button size="small" danger onClick={() => schedulerActionMut.mutate({ scheduleId: row.schedule_id, action: "cancel" })}>
                          {t("page.tasks.cancelRun")}
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
          ) : null}

          <div className={showSchedulerPlanning ? "space-y-4 xl:sticky xl:top-4 xl:self-start" : "space-y-4"}>
            <Card title={t("page.tasks.schedulerConsole")}>
              <Segmented
                block
                value={schedulerPanel}
                onChange={(value) => setSchedulerPanel(normalizeSchedulerPanel(String(value)))}
                options={[
                  { label: t("page.tasks.schedulerPanelOps"), value: "ops" },
                  { label: t("page.tasks.schedulerPanelInsights"), value: "insights" },
                  { label: t("page.tasks.schedulerPanelAgent"), value: "agent" },
                  { label: t("page.tasks.schedulerPanelQuality"), value: "quality" },
                  { label: t("page.tasks.schedulerPanelEvents"), value: "events" },
                ]}
              />
              <p className="mt-3 text-xs text-[var(--muted)]">{t("page.tasks.schedulerConsoleHint")}</p>
            </Card>
            {schedulerPanel === "ops" ? (
            <Card
              title={t("page.tasks.schedulerOps")}
              actions={
                <Space wrap>
                  <Button size="small" loading={schedulerRunbookMut.isPending} onClick={() => schedulerRunbookMut.mutate(true)}>
                    {t("page.tasks.previewRunbook")}
                  </Button>
                  <Button size="small" type="primary" loading={schedulerRunbookMut.isPending} onClick={() => schedulerRunbookMut.mutate(false)}>
                    {t("page.tasks.createRunbookTasks")}
                  </Button>
                </Space>
              }
            >
              {schedulerOpsQ.error ? <Alert className="mb-3" type="error" showIcon message={(schedulerOpsQ.error as Error).message} /> : null}
              {schedulerRunbookMut.error ? <Alert className="mb-3" type="error" showIcon message={(schedulerRunbookMut.error as Error).message} /> : null}
              {schedulerRunbookResult?.summary ? (
                <Alert
                  className="mb-3"
                  type={schedulerRunbookResult.dry_run ? "info" : "success"}
                  showIcon
                  message={t("page.tasks.runbookResult", { steps: schedulerRunbookResult.summary.steps ?? 0, created: schedulerRunbookResult.summary.created ?? 0 })}
                />
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Stat label={t("page.tasks.opsHealth")} value={schedulerOpsQ.data?.summary?.health_score ?? 100} />
                <Stat label={t("page.tasks.readyUnclaimed")} value={schedulerOpsQ.data?.summary?.ready_unclaimed ?? 0} />
                <Stat label={t("page.tasks.staleClaims")} value={schedulerOpsQ.data?.summary?.stale_claims ?? 0} />
                <Stat label={t("page.tasks.qualityBlocks")} value={schedulerOpsQ.data?.summary?.quality_blocks ?? 0} />
              </div>
              <div className="mt-3 space-y-2">
                {(schedulerOpsQ.data?.recommendations ?? []).slice(0, 4).map((item: any) => (
                  <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text)]">{item.title}</span>
                      <Tag color={item.severity === "high" ? "red" : "blue"}>{item.severity}</Tag>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">{item.summary}</p>
                    <code className="mt-2 block truncate rounded bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--brand)]">{item.command}</code>
                  </div>
                ))}
                {!(schedulerOpsQ.data?.recommendations ?? []).length ? (
                  <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--muted)]">{t("page.tasks.schedulerOpsStable")}</p>
                ) : null}
              </div>
              {schedulerRunbookResult?.steps?.length ? (
                <div className="mt-3 space-y-2">
                  {(schedulerRunbookResult.steps ?? []).slice(0, 5).map((step: any) => (
                    <div key={step.id} className="rounded-lg border border-[var(--border)] px-3 py-2">
                      <div className="text-xs font-semibold text-[var(--text)]">{step.title}</div>
                      <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">{step.type} · {step.task_id || "-"}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
            ) : null}

            {schedulerPanel === "insights" ? (
            <Card
              title={t("page.tasks.schedulerInsights")}
              actions={
                <Space wrap>
                  <Button size="small" loading={schedulerInsightTasksMut.isPending} onClick={() => schedulerInsightTasksMut.mutate(true)}>
                    {t("page.tasks.previewInsightTasks")}
                  </Button>
                  <Button size="small" type="primary" loading={schedulerInsightTasksMut.isPending} onClick={() => schedulerInsightTasksMut.mutate(false)}>
                    {t("page.tasks.createInsightTasks")}
                  </Button>
                </Space>
              }
            >
              {schedulerInsightsQ.error ? <Alert className="mb-3" type="error" showIcon message={(schedulerInsightsQ.error as Error).message} /> : null}
              {schedulerInsightTasksMut.error ? <Alert className="mb-3" type="error" showIcon message={(schedulerInsightTasksMut.error as Error).message} /> : null}
              {schedulerInsightTasksResult?.summary ? (
                <Alert
                  className="mb-3"
                  type={schedulerInsightTasksResult.dry_run ? "info" : "success"}
                  showIcon
                  message={t("page.tasks.insightTaskResult", {
                    planned: schedulerInsightTasksResult.summary.planned ?? 0,
                    created: schedulerInsightTasksResult.summary.created ?? 0,
                  })}
                />
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Stat label={t("page.tasks.insightHealth")} value={schedulerInsightsQ.data?.summary?.health_score ?? 100} />
                <Stat label={t("page.tasks.criticalPath")} value={schedulerInsightsQ.data?.critical_path?.length ?? 0} />
                <Stat label={t("page.tasks.bottlenecks")} value={schedulerInsightsQ.data?.summary?.bottlenecks ?? 0} />
                <Stat label={t("page.tasks.policyCount")} value={schedulerInsightsQ.data?.summary?.policies ?? 0} />
              </div>
              <div className="mt-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("page.tasks.policyComparison")}</div>
                <Table
                  rowKey={(row: any) => String(row.policy)}
                  dataSource={schedulerInsightsQ.data?.policy_comparison ?? []}
                  loading={schedulerInsightsQ.isLoading}
                  size="small"
                  pagination={false}
                  scroll={{ x: 460 }}
                  columns={[
                    { title: t("page.tasks.schedulerPolicy"), dataIndex: "policy", width: 120, render: (value: string) => <Tag color="blue">{value}</Tag> },
                    { title: t("page.tasks.policyScheduled"), dataIndex: "scheduled", width: 90 },
                    { title: t("page.tasks.policyReady"), dataIndex: "ready", width: 80 },
                    { title: t("page.tasks.policyBlocked"), dataIndex: "blocked", width: 80 },
                    { title: t("page.tasks.policyStages"), dataIndex: "stages", width: 90 },
                  ]}
                />
              </div>
              <div className="mt-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("page.tasks.schedulerRecommendations")}</div>
                {(schedulerInsightsQ.data?.recommendations ?? []).slice(0, 4).map((item: any) => (
                  <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text)]">{item.title}</span>
                      <Tag color={item.severity === "high" ? "red" : item.severity === "medium" ? "orange" : "blue"}>{item.severity}</Tag>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">{item.summary}</p>
                    <code className="mt-2 block truncate rounded bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--brand)]">{item.command}</code>
                  </div>
                ))}
              </div>
            </Card>
            ) : null}

            {schedulerPanel === "agent" ? (
            <>
            <Card title={t("page.tasks.agentFeed")}>
              <Alert className="mb-3" type="info" showIcon message={t("page.tasks.externalRuntimeHint")} action={<Button href="#/dev-flow?view=list">{t("page.tasks.openDelivery")}</Button>} />
              {agentFeedQ.error ? <Alert type="error" showIcon message={(agentFeedQ.error as Error).message} /> : null}
              <Table
                rowKey={(row: any) => String(row.packet_id)}
                dataSource={agentFeedQ.data?.items ?? []}
                loading={agentFeedQ.isLoading}
                size="small"
                pagination={false}
                scroll={{ x: 520 }}
                columns={[
                  {
                    title: t("page.tasks.task"),
                    dataIndex: "title",
                    render: (value: string, row: any) => (
                      <div>
                        <div className="line-clamp-1 text-xs font-medium">{value}</div>
                        <div className="font-mono text-[10px] text-[var(--muted)]">{row.task_id}</div>
                      </div>
                    ),
                  },
                  { title: t("page.tasks.lane"), dataIndex: "lane", width: 64 },
                  { title: t("page.tasks.qualityGates"), dataIndex: "quality_gates", width: 80, render: (items: any[]) => items?.length ?? 0 },
                  {
                    title: t("page.tasks.agentLease"),
                    dataIndex: "claim",
                    width: 100,
                    render: (claim: any) => claim?.claim_id ? <Tag color="processing">{claim.agent}</Tag> : <Tag>{t("page.tasks.unclaimed")}</Tag>,
                  },
                ]}
              />
            </Card>

            <Card title={t("page.tasks.historicalClaims")}>
              <Alert className="mb-3" type="info" showIcon message={t("page.tasks.historicalEvidenceHint")} />
              <Table
                rowKey={(row: any) => String(row.claim_id)}
                dataSource={agentClaimsQ.data?.items ?? []}
                loading={agentClaimsQ.isLoading}
                size="small"
                pagination={false}
                scroll={{ x: 620 }}
                columns={[
                  {
                    title: t("page.tasks.task"),
                    dataIndex: "task_id",
                    render: (value: string, row: any) => (
                      <div>
                        <div className="font-mono text-xs text-[var(--text)]">{value}</div>
                        <div className="font-mono text-[10px] text-[var(--muted)]">{row.claim_id}</div>
                      </div>
                    ),
                  },
                  { title: t("page.tasks.agent"), dataIndex: "agent", width: 110 },
                  { title: t("page.tasks.progress"), dataIndex: "progress", width: 90, render: (value: number) => `${value || 0}%` },
                  { title: t("page.tasks.leaseExpires"), dataIndex: "lease_expires_at", width: 170 },
                  {
                    title: t("page.tasks.action"),
                    key: "action",
                    width: 170,
                    render: (_: unknown, row: any) => (
                      <Space size={6}>
                        <Button size="small" loading={agentPlanMut.isPending} onClick={() => agentPlanMut.mutate(row)}>
                          {t("page.tasks.agentPlan")}
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>

            <Card title={t("page.tasks.agentExecutionPlan")}>
              {agentPlanMut.error ? <Alert className="mb-3" type="error" showIcon message={(agentPlanMut.error as Error).message} /> : null}
              {!agentPlanResult ? (
                <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--muted)]">{t("page.tasks.agentPlanHint")}</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={t("page.tasks.task")} value={agentPlanResult.task?.id || "-"} />
                    <Stat label={t("page.tasks.ready")} value={agentPlanResult.dependency_state?.ready ? "ready" : "blocked"} />
                    <Stat label={t("page.tasks.qualityGates")} value={agentPlanResult.quality_gates?.length ?? 0} />
                    <Stat label={t("page.tasks.agent")} value={agentPlanResult.claim?.agent || "-"} />
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                    <div className="text-sm font-semibold text-[var(--text)]">{agentPlanResult.task?.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{agentPlanResult.task?.description || t("page.tasks.noDescription")}</div>
                    {agentPlanResult.dependency_state?.blocked_by?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {agentPlanResult.dependency_state.blocked_by.map((item: string) => <Tag key={item} color="orange">{item}</Tag>)}
                      </div>
                    ) : null}
                  </div>
                  <Table
                    rowKey={(row: any) => String(row.id)}
                    dataSource={agentPlanResult.execution_steps ?? []}
                    loading={agentPlanMut.isPending}
                    size="small"
                    pagination={false}
                    scroll={{ x: 640 }}
                    columns={[
                      { title: t("page.tasks.step"), dataIndex: "id", width: 130 },
                      { title: t("page.tasks.required"), dataIndex: "required", width: 90, render: (value: boolean) => value ? <Tag color="red">required</Tag> : <Tag>optional</Tag> },
                      { title: t("page.tasks.title"), dataIndex: "title", width: 200 },
                      { title: t("page.tasks.command"), dataIndex: "command", render: (value: string) => <code className="text-[10px] text-[var(--brand)]">{value}</code> },
                    ]}
                  />
                  <div className="flex flex-wrap gap-1">
                    {(agentPlanResult.quality_gates ?? []).slice(0, 10).map((gate: any) => (
                      <Tag key={gate.id} color={gate.severity === "blocking" ? "red" : "blue"}>{gate.id}</Tag>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card title={t("page.tasks.historicalReports")}>
              <Alert className="mb-3" type="info" showIcon message={t("page.tasks.historicalEvidenceHint")} />
              {agentReportsQ.error ? <Alert className="mb-3" type="error" showIcon message={(agentReportsQ.error as Error).message} /> : null}
              <div className="mb-3 grid grid-cols-2 gap-2">
                <Stat label={t("page.tasks.reportCount")} value={agentReportsQ.data?.summary?.reports ?? 0} />
                <Stat label={t("page.tasks.reportArtifacts")} value={agentReportsQ.data?.summary?.artifacts ?? 0} />
                <Stat label={t("page.tasks.reportFailedGates")} value={agentReportsQ.data?.summary?.failed_gates ?? 0} />
                <Stat label={t("page.tasks.reportHeartbeats")} value={agentReportsQ.data?.summary?.heartbeats ?? 0} />
              </div>
              <Table
                rowKey={(row: any) => String(row.id || `${row.task_id}-${row.created_at}`)}
                dataSource={agentReportsQ.data?.items ?? []}
                loading={agentReportsQ.isLoading}
                size="small"
                pagination={false}
                scroll={{ x: 720 }}
                columns={[
                  {
                    title: t("page.tasks.task"),
                    dataIndex: "task_id",
                    width: 130,
                    render: (value: string, row: any) => (
                      <div>
                        <div className="font-mono text-xs text-[var(--text)]">{value || "-"}</div>
                        <div className="text-[10px] text-[var(--muted)]">{row.created_at?.slice?.(0, 19) || ""}</div>
                      </div>
                    ),
                  },
                  { title: t("page.tasks.agent"), dataIndex: "agent", width: 110 },
                  { title: t("page.tasks.runStatus"), dataIndex: "status", width: 100, render: (value: string) => <Tag>{value}</Tag> },
                  { title: t("page.tasks.qualityDecisionShort"), dataIndex: "quality_decision", width: 100, render: (value: string) => <Tag color={value === "block" ? "red" : value === "warn" ? "gold" : "green"}>{value || "-"}</Tag> },
                  { title: t("page.tasks.qualityAvgScore"), dataIndex: "quality_score", width: 90 },
                  {
                    title: t("page.tasks.summary"),
                    dataIndex: "summary",
                    render: (value: string, row: any) => (
                      <div className="line-clamp-2 text-xs text-[var(--muted-strong)]">
                        {value || row.status_message || (row.quality_blockers || []).join(", ") || "-"}
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
            </>
            ) : null}

            {schedulerPanel === "quality" ? (
            <Card title={t("page.tasks.qualityCenter")}>
              {qualityPolicyQ.error ? <Alert className="mb-3" type="error" showIcon message={(qualityPolicyQ.error as Error).message} /> : null}
              {qualitySummaryQ.error ? <Alert className="mb-3" type="error" showIcon message={(qualitySummaryQ.error as Error).message} /> : null}
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                <Stat label={t("page.tasks.qualityMode")} value={qualityPolicyQ.data?.policy?.mode || "-"} />
                <Stat label={t("page.tasks.qualityRequired")} value={qualityPolicyQ.data?.summary?.required ?? 0} />
                <Stat label={t("page.tasks.qualityAdvisory")} value={qualityPolicyQ.data?.summary?.advisory ?? 0} />
                <Stat label={t("page.tasks.qualityEvaluations")} value={qualitySummaryQ.data?.summary?.evaluations ?? 0} />
                <Stat label={t("page.tasks.qualityAvgScore")} value={qualitySummaryQ.data?.summary?.avg_score ?? 100} />
                <Stat label={t("page.tasks.qualityBlocks")} value={qualitySummaryQ.data?.summary?.block ?? 0} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {(qualityPolicyQ.data?.default_gates ?? []).slice(0, 8).map((gate: any) => (
                  <Tag key={gate.id} color={gate.severity === "blocking" ? "red" : "blue"}>{gate.id}</Tag>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("page.tasks.qualityPolicyEdit")}</div>
                <div className="grid gap-2">
                  <Select
                    size="small"
                    value={qualityPolicyDraft.mode}
                    options={["blocking", "advisory", "strict"].map((value) => ({ value, label: value }))}
                    onChange={(value) => setQualityPolicyDraft((v) => ({ ...v, mode: value }))}
                  />
                  <Input
                    size="small"
                    value={qualityPolicyDraft.required}
                    placeholder={t("page.tasks.qualityRequiredIds")}
                    onChange={(e) => setQualityPolicyDraft((v) => ({ ...v, required: e.target.value }))}
                  />
                  <Input
                    size="small"
                    value={qualityPolicyDraft.advisory}
                    placeholder={t("page.tasks.qualityAdvisoryIds")}
                    onChange={(e) => setQualityPolicyDraft((v) => ({ ...v, advisory: e.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <InputNumber
                      size="small"
                      className="w-full"
                      min={0}
                      max={1}
                      step={0.05}
                      value={qualityPolicyDraft.minConfidence}
                      addonBefore={t("page.tasks.qualityMinConfidence")}
                      onChange={(value) => setQualityPolicyDraft((v) => ({ ...v, minConfidence: Number(value ?? 0) }))}
                    />
                    <Select
                      size="small"
                      value={qualityPolicyDraft.requireArtifact ? "true" : "false"}
                      options={[
                        { value: "true", label: t("page.tasks.qualityRequireArtifact") },
                        { value: "false", label: t("common.no") },
                      ]}
                      onChange={(value) => setQualityPolicyDraft((v) => ({ ...v, requireArtifact: value === "true" }))}
                    />
                  </div>
                  <Select
                    size="small"
                    value={qualityPolicyDraft.autoBlock ? "true" : "false"}
                    options={[
                      { value: "true", label: t("page.tasks.qualityAutoBlock") },
                      { value: "false", label: t("common.no") },
                    ]}
                    onChange={(value) => setQualityPolicyDraft((v) => ({ ...v, autoBlock: value === "true" }))}
                  />
                  <Input.TextArea
                    rows={2}
                    value={qualityPolicyDraft.notes}
                    placeholder={t("page.tasks.qualityNotes")}
                    onChange={(e) => setQualityPolicyDraft((v) => ({ ...v, notes: e.target.value }))}
                  />
                  <Button size="small" type="primary" loading={qualityPolicyMut.isPending} onClick={() => qualityPolicyMut.mutate()}>
                    {t("page.tasks.qualitySavePolicy")}
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="small" loading={qualityEvaluateMut.isPending} disabled={!selectedTaskIds[0]} onClick={() => qualityEvaluateMut.mutate()}>
                  {t("page.tasks.qualityEvaluateSelected")}
                </Button>
                <Button size="small" loading={qualityTasksMut.isPending} onClick={() => qualityTasksMut.mutate(true)}>
                  {t("page.tasks.qualityPreviewTasks")}
                </Button>
                <Button size="small" type="primary" loading={qualityTasksMut.isPending} onClick={() => qualityTasksMut.mutate(false)}>
                  {t("page.tasks.qualityCreateTasks")}
                </Button>
                <span className="text-xs text-[var(--muted)]">{selectedTaskIds[0] || t("page.tasks.qualitySelectHint")}</span>
              </div>
              {qualityEvaluateMut.data?.quality ? (
                <Alert
                  className="mt-3"
                  type={qualityEvaluateMut.data.quality.decision === "block" ? "warning" : "success"}
                  showIcon
                  message={t("page.tasks.qualityDecision", { decision: qualityEvaluateMut.data.quality.decision, score: qualityEvaluateMut.data.quality.score })}
                />
              ) : null}
              {qualityPolicyMut.data ? <Alert className="mt-3" type="success" showIcon message={t("page.tasks.qualityPolicySaved")} /> : null}
              {qualityTasksResult ? (
                <Alert
                  className="mt-3"
                  type={qualityTasksResult.dry_run ? "info" : "success"}
                  showIcon
                  message={t("page.tasks.qualityTasksResult", {
                    planned: qualityTasksResult.summary?.planned ?? 0,
                    created: qualityTasksResult.summary?.created ?? 0,
                  })}
                />
              ) : null}
              <div className="mt-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("page.tasks.qualityRecent")}</div>
                {(qualitySummaryQ.data?.recent ?? []).slice(0, 4).map((row: any) => (
                  <div key={row.id || `${row.task_id}-${row.created_at}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-[var(--text)]">{row.task_id || row.id}</span>
                      <Tag color={row.decision === "block" ? "red" : row.decision === "warn" ? "gold" : "green"}>{row.decision}</Tag>
                    </div>
                    <div className="mt-1 text-xs text-[var(--muted-strong)]">
                      score={row.score ?? "-"} {(row.blockers || []).join(", ")}
                    </div>
                  </div>
                ))}
                {qualitySummaryQ.data && !(qualitySummaryQ.data?.recent ?? []).length ? (
                  <div className="text-xs text-[var(--muted)]">{t("page.tasks.qualityNoRecent")}</div>
                ) : null}
              </div>
            </Card>
            ) : null}

            {schedulerPanel === "events" ? (
            <>
            <Card title={t("page.tasks.eventWakeups")}>
              <div className="space-y-2">
                {(schedulerResult?.event_wakeups ?? agentFeedQ.data?.event_wakeups ?? []).map((event: any) => (
                  <div key={`${event.event}-${event.action}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                    <div className="font-mono text-xs font-semibold text-[var(--text)]">{event.event}</div>
                    <div className="mt-1 text-xs text-[var(--muted-strong)]">{event.action}</div>
                    <Tag className="mt-2">{event.target}</Tag>
                  </div>
                ))}
              </div>
            </Card>

            <Card title={t("page.tasks.agentContract")}>
              <div className="space-y-2 text-xs text-[var(--muted-strong)]">
                <p>{t("page.tasks.agentContractScope")}</p>
                <p>{t("page.tasks.agentContractGates")}</p>
                <p>{t("page.tasks.agentContractCallbacks")}</p>
              </div>
            </Card>
            </>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "board" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {STATUSES.map((st) => (
            <Card key={st} title={`${taskRecordStatusLabel(st, t)} (${boardGroups[st].length})`}>
              <div
                className="min-h-[80px] space-y-2"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const dragId = e.dataTransfer.getData("text/task-id");
                  if (!dragId) return;
                  handleBoardStatusDrop(dragId, st);
                }}
              >
                {boardGroups[st].length === 0 ? (
                  <p className="text-xs text-slate-400">{t("page.tasks.empty")}</p>
                ) : (
                  boardGroups[st].map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      busy={busy}
                      draggable
                      onStatus={(id, status) => patchTask.mutate({ id, patch: { status } })}
                    />
                  ))
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "priority" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PRIORITIES.map((pr) => (
            <Card key={pr} title={`${pr} (${priorityGroups[pr].length})`}>
              <ul
                className="min-h-[80px] space-y-2"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const dragId = e.dataTransfer.getData("text/task-id");
                  if (!dragId) return;
                  handlePriorityDrop(dragId, pr, null);
                }}
              >
                {priorityGroups[pr].length === 0 ? (
                  <li className="text-xs text-slate-400">{t("page.tasks.empty")}</li>
                ) : (
                  priorityGroups[pr].map((task) => (
                    <li
                      key={task.id}
                      draggable={!busy}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/task-id", task.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const dragId = e.dataTransfer.getData("text/task-id");
                        if (!dragId || dragId === task.id) return;
                        handlePriorityDrop(dragId, pr, task.id);
                      }}
                      className="cursor-grab rounded border border-slate-200 bg-white px-2 py-1.5 text-sm active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900/80"
                    >
                      <span className="font-medium">{task.title}</span>
                      <span
                        className={`ml-2 rounded px-1 py-0.5 text-xs ${statusColor[task.status] || ""}`}
                      >
                        {taskRecordStatusLabel(task.status, t)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </Card>
          ))}
          {reorderBoard.isError ? (
            <p className="col-span-full text-sm text-rose-600">
              {(reorderBoard.error as Error).message}
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "sprint" ? (
        <div className="space-y-4">
          <Card
            title={t("page.tasks.sprintOpsPlan")}
            actions={
              <Space wrap>
                <Button loading={sprintOpsTasksMut.isPending} onClick={() => sprintOpsTasksMut.mutate(true)}>
                  {t("page.tasks.sprintOpsPreview")}
                </Button>
                <Button type="primary" loading={sprintOpsTasksMut.isPending} onClick={() => sprintOpsTasksMut.mutate(false)}>
                  {t("page.tasks.sprintOpsCreate")}
                </Button>
              </Space>
            }
          >
            <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
              <div className="rounded-md border border-[var(--border)] bg-[var(--panel-muted)] p-4">
                <Statistic
                  title={t("page.tasks.sprintOpsHealth")}
                  value={sprintOpsQ.data?.health?.score ?? 0}
                  suffix="/ 100"
                  valueStyle={{ color: sprintOpsQ.data?.health?.grade === "risk" ? "#dc2626" : "var(--brand)" }}
                />
                <Tag className="mt-3" color={sprintOpsQ.data?.health?.grade === "healthy" ? "green" : sprintOpsQ.data?.health?.grade === "watch" ? "gold" : "red"}>
                  {sprintOpsQ.data?.health?.grade ?? "-"}
                </Tag>
                <div className="mt-4 space-y-1 text-xs text-[var(--muted)]">
                  <div>{t("page.tasks.sprintOpsActive")}: {sprintOpsQ.data?.sprint?.id ?? "-"}</div>
                  <div>{t("page.tasks.sprintOpsDaysLeft")}: {sprintOpsQ.data?.summary?.days_left ?? "-"}</div>
                  <div>{t("page.tasks.sprintOpsCriticalIssues")}: {sprintOpsQ.data?.summary?.critical_issues ?? 0}</div>
                </div>
              </div>
              <div className="min-w-0">
                <Alert
                  className="mb-3"
                  showIcon
                  type={sprintOpsQ.data?.health?.grade === "risk" ? "warning" : "info"}
                  message={t("page.tasks.sprintOpsHint")}
                  description={<Typography.Text code copyable>sop sprint ops-plan --json</Typography.Text>}
                />
                <Table
                  rowKey="id"
                  size="small"
                  loading={sprintOpsQ.isLoading}
                  columns={sprintOpsRiskColumns}
                  dataSource={sprintOpsQ.data?.risks ?? []}
                  pagination={false}
                  scroll={{ x: 780 }}
                  locale={{ emptyText: t("page.tasks.sprintOpsNoRisks") }}
                />
              </div>
            </div>
          </Card>
          <Card title={t("page.tasks.sprintList")}>
            <div className="mb-3 flex flex-wrap gap-2">
              <select
                className="rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                value={sprintId}
                onChange={(e) => setSprintId(e.target.value)}
              >
                <option value="">{t("page.tasks.pickSprint")}</option>
                {sprints.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.goal} ({s.status})
                  </option>
                ))}
              </select>
            </div>
            {sprintId ? (
              <div className="space-y-4">
                <SprintProgressPanel progress={progressQ.data} loading={progressQ.isLoading} tasksHref="#/tasks/sprints" />
                {burndownQ.isLoading ? (
                  <p className="text-sm text-slate-500">{t("common.loading")}</p>
                ) : burndownQ.data ? (
                  <SprintBurndownChart data={burndownQ.data} />
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t("page.tasks.pickSprint")}</p>
            )}
          </Card>
          <Card title={t("page.tasks.sprintTasks")}>
            {!sprintId ? (
              <p className="text-sm text-slate-500">{t("page.tasks.pickSprint")}</p>
            ) : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                {tasks.map((task: any) => (
                  <li key={task.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{task.title}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${statusColor[task.status] || ""}`}
                    >
                      {taskRecordStatusLabel(task.status, t)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "deps" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <Stat label={t("page.tasks.depNodes")} value={depsQ.data?.summary?.nodes ?? 0} />
              <Stat label={t("page.tasks.depEdges")} value={depsQ.data?.summary?.edges ?? 0} />
              <Stat label={t("page.tasks.depBlocked")} value={depsQ.data?.summary?.blocked ?? 0} />
              <Stat label={t("page.tasks.depBlocks")} value={depsQ.data?.summary?.by_type?.blocks ?? 0} />
              <Stat label={t("page.tasks.depReady")} value={depsQ.data?.summary?.ready ?? 0} />
              <Stat label={t("page.tasks.depCycles")} value={depsQ.data?.summary?.cycles ?? 0} />
            </div>
            <Card
              title={t("page.tasks.depWorkbench")}
              actions={
                <Space wrap>
                  <Button size="small" loading={depTasksMut.isPending} onClick={() => depTasksMut.mutate(true)}>
                    {t("page.tasks.depPreviewTasks")}
                  </Button>
                  <Button size="small" type="primary" loading={depTasksMut.isPending} onClick={() => depTasksMut.mutate(false)}>
                    {t("page.tasks.depCreateTasks")}
                  </Button>
                </Space>
              }
            >
              {depTasksMut.error ? <Alert className="mb-3" type="error" showIcon message={(depTasksMut.error as Error).message} /> : null}
              {depTasksResult?.summary ? (
                <Alert
                  className="mb-3"
                  type={depTasksResult.dry_run ? "info" : "success"}
                  showIcon
                  message={t("page.tasks.depTasksResult", {
                    planned: depTasksResult.summary.planned ?? 0,
                    created: depTasksResult.summary.created ?? 0,
                  })}
                />
              ) : null}
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_24rem]">
                <Input.Search
                  allowClear
                  value={depQuery}
                  onChange={(e) => setDepQuery(e.target.value)}
                  placeholder={t("page.tasks.depSearch")}
                />
                <Segmented
                  block
                  value={depFilter}
                  onChange={(value) => setDepFilter(String(value))}
                  options={[
                    { label: t("page.tasks.depFilterAll"), value: "all" },
                    { label: t("page.tasks.depFilterBlocked"), value: "blocked" },
                    { label: t("page.tasks.depFilterReady"), value: "ready" },
                    { label: t("page.tasks.depFilterHigh"), value: "high" },
                  ]}
                />
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                {(depsQ.data?.recommendations ?? []).slice(0, 3).map((item: any) => (
                  <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-[var(--text)]">{item.title}</span>
                      <Tag color={item.severity === "high" ? "red" : item.severity === "medium" ? "orange" : "blue"}>{item.severity}</Tag>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{item.summary}</p>
                    <code className="mt-2 block truncate rounded bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--brand)]">{item.command}</code>
                  </div>
                ))}
                {depsQ.isSuccess && !(depsQ.data?.recommendations ?? []).length ? (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--muted)]">
                    {t("page.tasks.depNoRecommendations")}
                  </div>
                ) : null}
              </div>
              {depTasksResult?.items?.length ? (
                <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("page.tasks.depTaskPreview")}</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {(depTasksResult.items ?? []).slice(0, 6).map((item: any) => (
                      <div key={`${item.source_report_id}-${item.title}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="line-clamp-1 text-xs font-semibold text-[var(--text)]">{item.title}</span>
                          <Tag color={item.priority === "P0" ? "red" : "blue"}>{item.priority}</Tag>
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">{item.source_report_id}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>
            <Card title={t("page.tasks.depGraph")}>
              {depsQ.isError ? <p className="text-sm text-rose-600">{(depsQ.error as Error).message}</p> : null}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {dependencyNodes.map((node: any) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setDepSelectedNode(node)}
                    className={`rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                      depSelectedNode?.id === node.id
                        ? "border-sky-400 bg-sky-50 ring-2 ring-sky-100 dark:border-sky-500 dark:bg-sky-950/30 dark:ring-sky-900"
                        : node.risk_level === "high"
                          ? "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30"
                          : node.is_dependency_blocked
                            ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                            : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{node.title}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">{node.id}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusColor[node.status] || ""}`}>{taskRecordStatusLabel(node.status, t)}</span>
                        <Tag color={node.risk_level === "high" ? "red" : node.risk_level === "medium" ? "orange" : "green"}>{node.risk_level}</Tag>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
                      <span>{t("page.tasks.depIn")}: {node.incoming}</span>
                      <span>{t("page.tasks.depOut")}: {node.outgoing}</span>
                      <span>{node.priority}</span>
                    </div>
                    {node.blocked_by?.length ? <p className="mt-2 truncate text-xs text-rose-700 dark:text-rose-200">{t("page.tasks.depBlockedBy")}: {node.blocked_by.join(", ")}</p> : null}
                  </button>
                ))}
                {depsQ.isSuccess && !dependencyNodes.length ? <p className="text-sm text-slate-500">{t("page.tasks.depEmpty")}</p> : null}
              </div>
            </Card>
            <Card title={t("page.tasks.depEdges")}>
              <ul className="space-y-2 text-sm">
                {dependencyEdges.map((edge: any) => (
                  <li key={`${edge.source_id}-${edge.target_id}-${edge.type}`} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{edge.source_id} → {edge.target_id}</span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{edge.type}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      {(edge.source_title || edge.source_id)} → {(edge.target_title || edge.target_id)}
                    </p>
                    {edge.note ? <p className="mt-1 text-xs text-slate-500">{edge.note}</p> : null}
                  </li>
                ))}
                {depsQ.isSuccess && !dependencyEdges.length ? <li className="text-sm text-slate-500">{t("page.tasks.depEmpty")}</li> : null}
              </ul>
            </Card>
          </div>
          <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <Card title={t("page.tasks.depNodeDetail")}>
              {depSelectedNode ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="text-sm font-semibold text-[var(--text)]">{depSelectedNode.title}</div>
                    <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">{depSelectedNode.id}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Tag>{depSelectedNode.priority}</Tag>
                      <Tag>{taskRecordStatusLabel(depSelectedNode.status, t)}</Tag>
                      <Tag color={depSelectedNode.risk_level === "high" ? "red" : depSelectedNode.risk_level === "medium" ? "orange" : "green"}>{depSelectedNode.risk_level}</Tag>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label={t("page.tasks.depIn")} value={depSelectedNode.incoming ?? 0} />
                    <Stat label={t("page.tasks.depOut")} value={depSelectedNode.outgoing ?? 0} />
                    <Stat label={t("page.tasks.depBlocked")} value={depSelectedNode.blocked_by?.length ?? 0} />
                  </div>
                  {depSelectedNode.blocked_by?.length ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                      {t("page.tasks.depBlockedBy")}: {depSelectedNode.blocked_by.join(", ")}
                    </div>
                  ) : null}
                  <Space wrap>
                    <Button size="small" href={manualTaskHref(depSelectedNode)}>
                      {t("deliveryManualReview.openTaskPlan")}
                    </Button>
                  </Space>
                </div>
              ) : (
                <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--muted)]">{t("page.tasks.depNoSelection")}</p>
              )}
            </Card>
            <Card title={t("page.tasks.depReadyQueue")}>
              <div className="space-y-2">
                {(depsQ.data?.ready_queue ?? []).slice(0, 8).map((task: any) => (
                  <div key={task.id} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/20">
                    <div className="line-clamp-1 text-xs font-semibold text-[var(--text)]">{task.title}</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-[var(--muted)]">{task.id}</span>
                      <Tag color="green">{task.priority}</Tag>
                    </div>
                  </div>
                ))}
                {depsQ.isSuccess && !(depsQ.data?.ready_queue ?? []).length ? <p className="text-sm text-[var(--muted)]">{t("page.tasks.schedulerEmpty")}</p> : null}
              </div>
            </Card>
            <Card title={t("page.tasks.depBlockedQueue")}>
              <div className="space-y-2">
                {(depsQ.data?.blocked_queue ?? []).slice(0, 8).map((task: any) => (
                  <div key={task.id} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/20">
                    <div className="line-clamp-1 text-xs font-semibold text-[var(--text)]">{task.title}</div>
                    <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">{task.id}</div>
                    <div className="mt-1 line-clamp-1 text-[10px] text-rose-700 dark:text-rose-200">{(task.blocked_by ?? []).join(", ")}</div>
                  </div>
                ))}
                {depsQ.isSuccess && !(depsQ.data?.blocked_queue ?? []).length ? <p className="text-sm text-[var(--muted)]">{t("page.tasks.depNoBlockedQueue")}</p> : null}
              </div>
            </Card>

          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <Statistic title={label} value={value} valueStyle={{ color: "var(--text)", fontSize: 20, fontWeight: 700 }} />
    </div>
  );
}
