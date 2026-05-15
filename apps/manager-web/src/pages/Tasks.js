import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";
const STATUSES = ["pending", "in_progress", "blocked", "completed"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];
function includesStatus(v) {
    return STATUSES.includes(v);
}
function includesPriority(v) {
    return PRIORITIES.includes(v);
}
function groupsFromTasks(taskList) {
    const g = { P0: [], P1: [], P2: [], P3: [] };
    for (const task of taskList) {
        const pr = includesPriority(task.priority) ? task.priority : "P3";
        const id = task.id;
        if (id)
            g[pr].push(id);
    }
    return g;
}
function moveTaskBetweenColumns(groups, taskId, targetP, insertBeforeId) {
    const next = {
        P0: [...groups.P0],
        P1: [...groups.P1],
        P2: [...groups.P2],
        P3: [...groups.P3],
    };
    for (const p of PRIORITIES) {
        next[p] = next[p].filter((id) => id !== taskId);
    }
    const col = [...next[targetP]];
    if (!insertBeforeId)
        col.push(taskId);
    else {
        const at = col.indexOf(insertBeforeId);
        if (at < 0)
            col.push(taskId);
        else
            col.splice(at, 0, taskId);
    }
    next[targetP] = col;
    return next;
}
const statusColor = {
    pending: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    in_progress: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
    blocked: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
    completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};
function TaskCard({ task, onStatus, busy, draggable, }) {
    const pr = (task.priority || "P3").toUpperCase();
    return (_jsxs("div", { draggable: draggable && !busy, onDragStart: (e) => {
            if (!draggable || busy)
                return;
            e.dataTransfer.setData("text/task-id", task.id);
            e.dataTransfer.effectAllowed = "move";
        }, className: `rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 ${draggable && !busy ? "cursor-grab active:cursor-grabbing" : ""}`, children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "text-sm font-medium text-slate-900 dark:text-slate-100", children: task.title }), _jsx("p", { className: "mt-0.5 font-mono text-[10px] text-slate-400", children: task.id }), task.assigned_to ? (_jsx("p", { className: "mt-1 text-xs text-slate-500", children: task.assigned_to })) : null] }), _jsx("span", { className: "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", children: pr })] }), _jsx("select", { className: "mt-2 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800", value: task.status || "pending", disabled: busy, onChange: (e) => onStatus(task.id, e.target.value), children: STATUSES.map((s) => (_jsx("option", { value: s, children: s }, s))) })] }));
}
export function Tasks() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const authed = Boolean(getToken());
    const hasProject = Boolean(getProjectId());
    const [tab, setTab] = useState("board");
    const [sprintId, setSprintId] = useState("");
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
    const [newPriority, setNewPriority] = useState("P1");
    const [newSprintId, setNewSprintId] = useState("");
    const patchTask = useMutation({
        mutationFn: ({ id, patch }) => api.updateTask(id, patch),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["tasks"] });
            if (sprintId)
                void qc.invalidateQueries({ queryKey: ["sprint-progress", sprintId] });
        },
    });
    const reorderBoard = useMutation({
        mutationFn: (groups) => api.reorderTasksBoard(groups),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks"] }),
    });
    const createTaskMut = useMutation({
        mutationFn: () => api.createTask({
            title: newTitle.trim(),
            priority: newPriority,
            sprint_id: newSprintId || undefined,
        }),
        onSuccess: () => {
            setNewTitle("");
            setCreateOpen(false);
            void qc.invalidateQueries({ queryKey: ["tasks"] });
            if (sprintId)
                void qc.invalidateQueries({ queryKey: ["sprint-progress", sprintId] });
        },
    });
    const sprints = sprintsQ.data ?? [];
    const activeSprint = useMemo(() => sprints.find((s) => s.status === "active") ?? sprints[0], [sprints]);
    useEffect(() => {
        if (tab === "sprint" && !sprintId && activeSprint?.id) {
            setSprintId(activeSprint.id);
        }
    }, [tab, sprintId, activeSprint?.id]);
    const tasks = tab === "sprint" ? (sprintTasksQ.data ?? []) : (allTasksQ.data ?? []);
    const loading = tab === "sprint" ? sprintTasksQ.isLoading : allTasksQ.isLoading;
    const error = tab === "sprint" ? sprintTasksQ.error : allTasksQ.error;
    const boardGroups = useMemo(() => {
        const g = {};
        for (const s of STATUSES)
            g[s] = [];
        for (const task of tasks) {
            const st = includesStatus(task.status) ? task.status : "pending";
            g[st].push(task);
        }
        return g;
    }, [tasks]);
    const priorityGroups = useMemo(() => {
        const g = { P0: [], P1: [], P2: [], P3: [] };
        for (const task of tasks) {
            const pr = includesPriority(task.priority) ? task.priority : "P3";
            g[pr].push(task);
        }
        return g;
    }, [tasks]);
    const commitPriorityReorder = (groups) => {
        reorderBoard.mutate(groups);
    };
    const handlePriorityDrop = (dragId, targetP, insertBeforeId) => {
        const base = groupsFromTasks(tasks);
        const next = moveTaskBetweenColumns(base, dragId, targetP, insertBeforeId);
        commitPriorityReorder(next);
    };
    const handleBoardStatusDrop = (dragId, targetStatus) => {
        const task = tasks.find((t) => t.id === dragId);
        if (!task || task.status === targetStatus)
            return;
        patchTask.mutate({ id: dragId, patch: { status: targetStatus } });
    };
    const busy = patchTask.isPending || reorderBoard.isPending || createTaskMut.isPending;
    if (!authed) {
        return _jsx("div", { className: "text-sm text-rose-600", children: t("auth.dashboardNeedLogin") });
    }
    if (!hasProject) {
        return _jsx("div", { className: "text-sm text-amber-700", children: t("projectSelector.hint") });
    }
    const tabs = [
        { key: "board", label: t("page.tasks.tabBoard") },
        { key: "priority", label: t("page.tasks.tabPriority") },
        { key: "sprint", label: t("page.tasks.tabSprint") },
    ];
    return (_jsxs("div", { className: "mx-auto max-w-6xl space-y-4", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsx("div", { className: "flex flex-wrap gap-2", children: tabs.map((x) => (_jsx("button", { type: "button", className: `rounded-lg px-3 py-1.5 text-sm ${tab === x.key
                                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                                : "border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"}`, onClick: () => setTab(x.key), children: x.label }, x.key))) }), loading ? _jsx("span", { className: "text-xs text-slate-500", children: "\u2026" }) : null, _jsx("button", { type: "button", className: "rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white dark:bg-slate-100 dark:text-slate-900", onClick: () => setCreateOpen((v) => !v), children: createOpen ? t("page.tasks.cancelCreate") : t("page.tasks.create") })] }), createOpen ? (_jsxs(Card, { title: t("page.tasks.create"), children: [_jsxs("form", { className: "flex flex-wrap items-end gap-2", onSubmit: (e) => {
                            e.preventDefault();
                            if (!newTitle.trim())
                                return;
                            createTaskMut.mutate();
                        }, children: [_jsxs("label", { className: "flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-slate-500", children: [t("page.tasks.titlePh"), _jsx("input", { className: "rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900", value: newTitle, onChange: (e) => setNewTitle(e.target.value), required: true })] }), _jsxs("label", { className: "flex flex-col gap-1 text-xs text-slate-500", children: [t("page.tasks.priority"), _jsx("select", { className: "rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900", value: newPriority, onChange: (e) => setNewPriority(e.target.value), children: PRIORITIES.map((p) => (_jsx("option", { value: p, children: p }, p))) })] }), _jsxs("label", { className: "flex min-w-[140px] flex-col gap-1 text-xs text-slate-500", children: [t("page.tasks.sprintOptional"), _jsxs("select", { className: "rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900", value: newSprintId, onChange: (e) => setNewSprintId(e.target.value), children: [_jsx("option", { value: "", children: "\u2014" }), sprints.map((s) => (_jsx("option", { value: s.id, children: s.goal }, s.id)))] })] }), _jsx("button", { type: "submit", disabled: busy || !newTitle.trim(), className: "rounded-lg bg-sky-600 px-4 py-1.5 text-sm text-white disabled:opacity-50", children: t("page.tasks.save") })] }), createTaskMut.error ? (_jsx("p", { className: "mt-2 text-sm text-rose-600", children: createTaskMut.error.message })) : null] })) : null, tab === "board" ? (_jsx("p", { className: "text-xs text-slate-500", children: t("page.tasks.boardDragHint") })) : null, tab === "priority" ? (_jsx("p", { className: "text-xs text-slate-500", children: t("page.tasks.dragHint") })) : null, error ? (_jsx("p", { className: "text-sm text-rose-600", children: error.message })) : null, tab === "board" ? (_jsx("div", { className: "grid gap-3 md:grid-cols-2 xl:grid-cols-4", children: STATUSES.map((st) => (_jsx(Card, { title: `${t(`page.tasks.status.${st}`)} (${boardGroups[st].length})`, children: _jsx("div", { className: "min-h-[80px] space-y-2", onDragOver: (e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                        }, onDrop: (e) => {
                            e.preventDefault();
                            const dragId = e.dataTransfer.getData("text/task-id");
                            if (!dragId)
                                return;
                            handleBoardStatusDrop(dragId, st);
                        }, children: boardGroups[st].length === 0 ? (_jsx("p", { className: "text-xs text-slate-400", children: t("page.tasks.empty") })) : (boardGroups[st].map((task) => (_jsx(TaskCard, { task: task, busy: busy, draggable: true, onStatus: (id, status) => patchTask.mutate({ id, patch: { status } }) }, task.id)))) }) }, st))) })) : null, tab === "priority" ? (_jsxs("div", { className: "grid gap-3 md:grid-cols-2 xl:grid-cols-4", children: [PRIORITIES.map((pr) => (_jsx(Card, { title: `${pr} (${priorityGroups[pr].length})`, children: _jsx("ul", { className: "min-h-[80px] space-y-2", onDragOver: (e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                            }, onDrop: (e) => {
                                e.preventDefault();
                                const dragId = e.dataTransfer.getData("text/task-id");
                                if (!dragId)
                                    return;
                                handlePriorityDrop(dragId, pr, null);
                            }, children: priorityGroups[pr].length === 0 ? (_jsx("li", { className: "text-xs text-slate-400", children: t("page.tasks.empty") })) : (priorityGroups[pr].map((task) => (_jsxs("li", { draggable: !busy, onDragStart: (e) => {
                                    e.dataTransfer.setData("text/task-id", task.id);
                                    e.dataTransfer.effectAllowed = "move";
                                }, onDragOver: (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }, onDrop: (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const dragId = e.dataTransfer.getData("text/task-id");
                                    if (!dragId || dragId === task.id)
                                        return;
                                    handlePriorityDrop(dragId, pr, task.id);
                                }, className: "cursor-grab rounded border border-slate-200 bg-white px-2 py-1.5 text-sm active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900/80", children: [_jsx("span", { className: "font-medium", children: task.title }), _jsx("span", { className: `ml-2 rounded px-1 py-0.5 text-xs ${statusColor[task.status] || ""}`, children: task.status })] }, task.id)))) }) }, pr))), reorderBoard.isError ? (_jsx("p", { className: "col-span-full text-sm text-rose-600", children: reorderBoard.error.message })) : null] })) : null, tab === "sprint" ? (_jsxs("div", { className: "space-y-4", children: [_jsxs(Card, { title: t("page.tasks.sprintList"), children: [_jsx("div", { className: "mb-3 flex flex-wrap gap-2", children: _jsxs("select", { className: "rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900", value: sprintId, onChange: (e) => setSprintId(e.target.value), children: [_jsx("option", { value: "", children: t("page.tasks.pickSprint") }), sprints.map((s) => (_jsxs("option", { value: s.id, children: [s.goal, " (", s.status, ")"] }, s.id)))] }) }), sprintId && progressQ.data ? (_jsxs("div", { className: "grid gap-3 sm:grid-cols-2 lg:grid-cols-4", children: [_jsx(Stat, { label: t("page.tasks.total"), value: progressQ.data.total_tasks }), _jsx(Stat, { label: t("page.tasks.done"), value: progressQ.data.completed }), _jsx(Stat, { label: t("page.tasks.inProgress"), value: progressQ.data.in_progress }), _jsx(Stat, { label: t("page.tasks.completion"), value: `${progressQ.data.completion_rate}%` })] })) : (_jsx("p", { className: "text-sm text-slate-500", children: t("page.tasks.pickSprint") })), progressQ.data?.blocked?.length ? (_jsxs("div", { className: "mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs dark:border-rose-900 dark:bg-rose-950/40", children: [_jsxs("p", { className: "font-medium text-rose-800 dark:text-rose-200", children: [t("page.tasks.blockedList"), " (", progressQ.data.blocked.length, ")"] }), _jsx("ul", { className: "mt-1 space-y-1 text-rose-700 dark:text-rose-300", children: progressQ.data.blocked.map((b) => (_jsxs("li", { children: [b.id, ": ", b.title] }, b.id))) })] })) : null] }), _jsx(Card, { title: t("page.tasks.sprintTasks"), children: !sprintId ? (_jsx("p", { className: "text-sm text-slate-500", children: t("page.tasks.pickSprint") })) : (_jsx("ul", { className: "divide-y divide-slate-200 dark:divide-slate-700", children: tasks.map((task) => (_jsxs("li", { className: "flex items-center justify-between py-2 text-sm", children: [_jsx("span", { children: task.title }), _jsx("span", { className: `rounded px-1.5 py-0.5 text-xs ${statusColor[task.status] || ""}`, children: task.status })] }, task.id))) })) })] })) : null] }));
}
function Stat({ label, value }) {
    return (_jsxs("div", { className: "rounded-lg border border-slate-200 p-3 dark:border-slate-700", children: [_jsx("p", { className: "text-xs text-slate-500", children: label }), _jsx("p", { className: "text-lg font-semibold text-slate-900 dark:text-slate-100", children: value })] }));
}
