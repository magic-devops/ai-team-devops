import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
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

type Tab = "board" | "priority" | "sprint";

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

export function Tasks() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [tab, setTab] = useState<Tab>("board");
  const [sprintId, setSprintId] = useState<string>("");

  const allTasksQ = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api.tasks(),
    enabled: authed && hasProject && (tab === "board" || tab === "priority"),
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

  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<(typeof PRIORITIES)[number]>("P1");
  const [newSprintId, setNewSprintId] = useState("");

  const patchTask = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.updateTask(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      if (sprintId) void qc.invalidateQueries({ queryKey: ["sprint-progress", sprintId] });
    },
  });

  const reorderBoard = useMutation({
    mutationFn: (groups: Record<string, string[]>) => api.reorderTasksBoard(groups),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks"] }),
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
      if (sprintId) void qc.invalidateQueries({ queryKey: ["sprint-progress", sprintId] });
    },
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

  const busy = patchTask.isPending || reorderBoard.isPending || createTaskMut.isPending;

  if (!authed) {
    return <div className="text-sm text-rose-600">{t("auth.dashboardNeedLogin")}</div>;
  }
  if (!hasProject) {
    return <div className="text-sm text-amber-700">{t("projectSelector.hint")}</div>;
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "board", label: t("page.tasks.tabBoard") },
    { key: "priority", label: t("page.tasks.tabPriority") },
    { key: "sprint", label: t("page.tasks.tabSprint") },
  ];

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map((x) => (
            <button
              key={x.key}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${
                tab === x.key
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"
              }`}
              onClick={() => setTab(x.key)}
            >
              {x.label}
            </button>
          ))}
        </div>
        {loading ? <span className="text-xs text-slate-500">…</span> : null}
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white dark:bg-slate-100 dark:text-slate-900"
          onClick={() => setCreateOpen((v) => !v)}
        >
          {createOpen ? t("page.tasks.cancelCreate") : t("page.tasks.create")}
        </button>
      </div>

      {createOpen ? (
        <Card title={t("page.tasks.create")}>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newTitle.trim()) return;
              createTaskMut.mutate();
            }}
          >
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-slate-500">
              {t("page.tasks.titlePh")}
              <input
                className="rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              {t("page.tasks.priority")}
              <select
                className="rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as (typeof PRIORITIES)[number])}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[140px] flex-col gap-1 text-xs text-slate-500">
              {t("page.tasks.sprintOptional")}
              <select
                className="rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                value={newSprintId}
                onChange={(e) => setNewSprintId(e.target.value)}
              >
                <option value="">—</option>
                {sprints.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.goal}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={busy || !newTitle.trim()}
              className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {t("page.tasks.save")}
            </button>
          </form>
          {createTaskMut.error ? (
            <p className="mt-2 text-sm text-rose-600">{(createTaskMut.error as Error).message}</p>
          ) : null}
        </Card>
      ) : null}

      {tab === "board" ? (
        <p className="text-xs text-slate-500">{t("page.tasks.boardDragHint")}</p>
      ) : null}
      {tab === "priority" ? (
        <p className="text-xs text-slate-500">{t("page.tasks.dragHint")}</p>
      ) : null}

      {error ? (
        <p className="text-sm text-rose-600">{(error as Error).message}</p>
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
            {sprintId && progressQ.data ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label={t("page.tasks.total")} value={progressQ.data.total_tasks} />
                <Stat label={t("page.tasks.done")} value={progressQ.data.completed} />
                <Stat label={t("page.tasks.inProgress")} value={progressQ.data.in_progress} />
                <Stat
                  label={t("page.tasks.completion")}
                  value={`${progressQ.data.completion_rate}%`}
                />
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t("page.tasks.pickSprint")}</p>
            )}
            {progressQ.data?.blocked?.length ? (
              <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs dark:border-rose-900 dark:bg-rose-950/40">
                <p className="font-medium text-rose-800 dark:text-rose-200">
                  {t("page.tasks.blockedList")} ({progressQ.data.blocked.length})
                </p>
                <ul className="mt-1 space-y-1 text-rose-700 dark:text-rose-300">
                  {progressQ.data.blocked.map((b: any) => (
                    <li key={b.id}>
                      {b.id}: {b.title}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}
