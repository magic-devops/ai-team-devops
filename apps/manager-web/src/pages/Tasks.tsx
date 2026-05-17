import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Statistic, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { TasksWorkbenchHeader } from "./delivery/TasksWorkbenchHeader";
import { SprintBurndownChart } from "./shared/SprintBurndownChart";
import { SprintProgressPanel } from "./shared/SprintProgressPanel";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";

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
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Tasks({ initialTab = "list", focused = false }: { initialTab?: Tab; focused?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sprintId, setSprintId] = useState<string>("");
  const [depDraft, setDepDraft] = useState({ source: "", target: "", type: "blocks", note: "" });
  const [taskQuery, setTaskQuery] = useState("");
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
  const [agentName, setAgentName] = useState("HermesAgent");
  const [claimResult, setClaimResult] = useState<any>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const allTasksQ = useQuery({
    queryKey: ["tasks", taskQuery, statusFilter, priorityFilter, sourceFilter],
    queryFn: () => api.tasks({ q: taskQuery.trim(), status: statusFilter, priority: priorityFilter, source: sourceFilter }),
    enabled: authed && hasProject && (tab === "list" || tab === "board" || tab === "priority" || tab === "deps"),
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
  const qualityPolicyQ = useQuery({
    queryKey: ["taskQualityPolicy"],
    queryFn: api.taskQualityPolicy,
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
      }
    },
  });

  const claimMut = useMutation({
    mutationFn: (packet?: any) =>
      api.taskAgentClaim({
        task_id: packet?.task_id,
        packet_id: packet?.packet_id,
        agent: agentName.trim() || "HermesAgent",
        dev_tool: packet?.dev_tool || "codex",
        lease_seconds: 900,
        auto_start: true,
      }),
    onSuccess: (data) => {
      setClaimResult(data);
      void qc.invalidateQueries({ queryKey: ["taskAgentFeed"] });
      void qc.invalidateQueries({ queryKey: ["taskAgentClaims"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
    },
  });

  const heartbeatMut = useMutation({
    mutationFn: (claim: any) =>
      api.taskAgentHeartbeat({
        claim_id: claim?.claim_id,
        agent: claim?.agent,
        progress: Number(claim?.progress || 0),
        state: "heartbeat",
        status_message: "ui heartbeat",
        extend_seconds: 900,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["taskAgentClaims"] });
    },
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

  const addDependency = useMutation({
    mutationFn: () =>
      api.addTaskDependency(depDraft.source, {
        target_id: depDraft.target,
        type: depDraft.type,
        note: depDraft.note,
      }),
    onSuccess: () => {
      setDepDraft((v) => ({ ...v, note: "" }));
      void qc.invalidateQueries({ queryKey: ["taskDependencies"] });
    },
  });

  const deleteDependency = useMutation({
    mutationFn: ({ source, target, type }: { source: string; target: string; type: string }) =>
      api.deleteTaskDependency(source, target, type),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["taskDependencies"] }),
  });

  const sprints = sprintsQ.data ?? [];
  const activeSprint = useMemo(
    () => sprints.find((s: any) => s.status === "active") ?? sprints[0],
    [sprints],
  );

  useEffect(() => {
    if (tab === "sprint" && !sprintId && activeSprint?.id) {
      setSprintId(activeSprint.id);
    }
  }, [tab, sprintId, activeSprint?.id]);

  const tasks = tab === "sprint" ? (sprintTasksQ.data ?? []) : (allTasksQ.data ?? []);
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

  const busy = patchTask.isPending || reorderBoard.isPending || createTaskMut.isPending || deleteTaskMut.isPending || bulkUpdateMut.isPending || dispatchMut.isPending || schedulerMut.isPending;
  const canBulkUpdate = selectedTaskIds.length > 0 && Boolean(bulkStatus || bulkPriority || bulkAssignee.trim());

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
          <p className="truncate text-sm font-semibold text-[var(--text)]">{task.title}</p>
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
          options={STATUSES.map((status) => ({ value: status, label: t(`page.tasks.status.${status}`) }))}
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

      <Card title={t("page.tasks.filters")}>
        <div className="flex flex-wrap items-center gap-2">
          <Input.Search
            className="min-w-[20rem] flex-1"
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
              ...STATUSES.map((status) => ({ value: status, label: t(`page.tasks.status.${status}`) })),
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
              options={STATUSES.map((status) => ({ value: status, label: t(`page.tasks.status.${status}`) }))}
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
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
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
          </div>

          <div className="space-y-4">
            <Card title={t("page.tasks.agentFeed")}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-56"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder={t("page.tasks.agentName")}
                />
                <Button loading={claimMut.isPending} onClick={() => claimMut.mutate(undefined)}>
                  {t("page.tasks.claimNext")}
                </Button>
              </div>
              {claimMut.error ? <Alert className="mb-3" type="error" showIcon message={(claimMut.error as Error).message} /> : null}
              {claimResult?.claim ? <Alert className="mb-3" type="success" showIcon message={t("page.tasks.claimedTask", { task: claimResult.claim.task_id, agent: claimResult.claim.agent })} /> : null}
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
                  {
                    title: t("page.tasks.action"),
                    key: "action",
                    width: 96,
                    render: (_: unknown, row: any) => (
                      <Button size="small" loading={claimMut.isPending} disabled={!row.ready || Boolean(row.claim?.claim_id)} onClick={() => claimMut.mutate(row)}>
                        {t("page.tasks.claim")}
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>

            <Card title={t("page.tasks.activeClaims")}>
              <Table
                rowKey={(row: any) => String(row.claim_id)}
                dataSource={agentClaimsQ.data?.items ?? []}
                loading={agentClaimsQ.isLoading || heartbeatMut.isPending}
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
                    width: 90,
                    render: (_: unknown, row: any) => (
                      <Button size="small" onClick={() => heartbeatMut.mutate(row)}>
                        {t("page.tasks.heartbeat")}
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>

            <Card title={t("page.tasks.qualityCenter")}>
              {qualityPolicyQ.error ? <Alert className="mb-3" type="error" showIcon message={(qualityPolicyQ.error as Error).message} /> : null}
              <div className="grid grid-cols-3 gap-2">
                <Stat label={t("page.tasks.qualityMode")} value={qualityPolicyQ.data?.policy?.mode || "-"} />
                <Stat label={t("page.tasks.qualityRequired")} value={qualityPolicyQ.data?.summary?.required ?? 0} />
                <Stat label={t("page.tasks.qualityAdvisory")} value={qualityPolicyQ.data?.summary?.advisory ?? 0} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {(qualityPolicyQ.data?.default_gates ?? []).slice(0, 8).map((gate: any) => (
                  <Tag key={gate.id} color={gate.severity === "blocking" ? "red" : "blue"}>{gate.id}</Tag>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button size="small" loading={qualityEvaluateMut.isPending} disabled={!selectedTaskIds[0]} onClick={() => qualityEvaluateMut.mutate()}>
                  {t("page.tasks.qualityEvaluateSelected")}
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
            </Card>

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
          </div>
        </div>
      ) : null}

      {tab === "board" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {STATUSES.map((st) => (
            <Card key={st} title={`${t(`page.tasks.status.${st}`)} (${boardGroups[st].length})`}>
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
                        {task.status}
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
                      {task.status}
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
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label={t("page.tasks.depNodes")} value={depsQ.data?.summary?.nodes ?? 0} />
              <Stat label={t("page.tasks.depEdges")} value={depsQ.data?.summary?.edges ?? 0} />
              <Stat label={t("page.tasks.depBlocked")} value={depsQ.data?.summary?.blocked ?? 0} />
              <Stat label={t("page.tasks.depBlocks")} value={depsQ.data?.summary?.by_type?.blocks ?? 0} />
            </div>
            <Card title={t("page.tasks.depGraph")}>
              {depsQ.isError ? <p className="text-sm text-rose-600">{(depsQ.error as Error).message}</p> : null}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(depsQ.data?.nodes ?? []).map((node: any) => (
                  <div key={node.id} className={`rounded-lg border p-3 ${node.is_dependency_blocked ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{node.title}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">{node.id}</p>
                      </div>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusColor[node.status] || ""}`}>{node.status}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
                      <span>{t("page.tasks.depIn")}: {node.incoming}</span>
                      <span>{t("page.tasks.depOut")}: {node.outgoing}</span>
                      <span>{node.priority}</span>
                    </div>
                    {node.blocked_by?.length ? <p className="mt-2 truncate text-xs text-rose-700 dark:text-rose-200">{t("page.tasks.depBlockedBy")}: {node.blocked_by.join(", ")}</p> : null}
                  </div>
                ))}
              </div>
            </Card>
            <Card title={t("page.tasks.depEdges")}>
              <ul className="space-y-2 text-sm">
                {(depsQ.data?.edges ?? []).map((edge: any) => (
                  <li key={`${edge.source_id}-${edge.target_id}-${edge.type}`} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{edge.source_id} → {edge.target_id}</span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{edge.type}</span>
                    </div>
                    {edge.note ? <p className="mt-1 text-xs text-slate-500">{edge.note}</p> : null}
                    <button
                      type="button"
                      className="mt-2 text-xs text-rose-600 disabled:opacity-50"
                      disabled={deleteDependency.isPending}
                      onClick={() => deleteDependency.mutate({ source: edge.source_id, target: edge.target_id, type: edge.type })}
                    >
                      {t("page.tasks.depDelete")}
                    </button>
                  </li>
                ))}
                {depsQ.isSuccess && !depsQ.data?.edges?.length ? <li className="text-sm text-slate-500">{t("page.tasks.depEmpty")}</li> : null}
              </ul>
            </Card>
          </div>
          <Card title={t("page.tasks.depCreate")}>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!depDraft.source || !depDraft.target) return;
                addDependency.mutate();
              }}
            >
              <label className="block text-xs text-slate-500">
                {t("page.tasks.depSource")}
                <select className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" value={depDraft.source} onChange={(e) => setDepDraft((v) => ({ ...v, source: e.target.value }))}>
                  <option value="">—</option>
                  {tasks.map((task: any) => <option key={task.id} value={task.id}>{task.id} · {task.title}</option>)}
                </select>
              </label>
              <label className="block text-xs text-slate-500">
                {t("page.tasks.depTarget")}
                <select className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" value={depDraft.target} onChange={(e) => setDepDraft((v) => ({ ...v, target: e.target.value }))}>
                  <option value="">—</option>
                  {tasks.map((task: any) => <option key={task.id} value={task.id}>{task.id} · {task.title}</option>)}
                </select>
              </label>
              <label className="block text-xs text-slate-500">
                {t("page.tasks.depType")}
                <select className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" value={depDraft.type} onChange={(e) => setDepDraft((v) => ({ ...v, type: e.target.value }))}>
                  <option value="blocks">blocks</option>
                  <option value="relates">relates</option>
                  <option value="duplicates">duplicates</option>
                </select>
              </label>
              <textarea className="min-h-24 w-full rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" value={depDraft.note} onChange={(e) => setDepDraft((v) => ({ ...v, note: e.target.value }))} placeholder={t("page.tasks.depNote")} />
              <button
                type="submit"
                disabled={addDependency.isPending || !depDraft.source || !depDraft.target}
                className="w-full rounded-lg bg-sky-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {t("page.tasks.depSave")}
              </button>
              {addDependency.error ? <p className="text-sm text-rose-600">{(addDependency.error as Error).message}</p> : null}
              {deleteDependency.error ? <p className="text-sm text-rose-600">{(deleteDependency.error as Error).message}</p> : null}
            </form>
          </Card>
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
