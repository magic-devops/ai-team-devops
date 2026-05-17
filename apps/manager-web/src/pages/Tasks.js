import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Statistic, Table, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { TasksWorkbenchHeader } from "./delivery/TasksWorkbenchHeader";
import { SprintBurndownChart } from "./shared/SprintBurndownChart";
import { SprintProgressPanel } from "./shared/SprintProgressPanel";
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
        }, className: `rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 ${draggable && !busy ? "cursor-grab active:cursor-grabbing" : ""}`, children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "text-sm font-medium text-slate-900 dark:text-slate-100", children: task.title }), _jsx("p", { className: "mt-0.5 font-mono text-[10px] text-slate-400", children: task.id }), task.assigned_to ? (_jsx("p", { className: "mt-1 text-xs text-slate-500", children: task.assigned_to })) : null] }), _jsx("span", { className: "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", children: pr })] }), (task.dev_tool || task.source_report_id || task.branch) ? (_jsxs("div", { className: "mt-2 flex flex-wrap gap-1.5", children: [task.dev_tool ? (_jsx("span", { className: "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300", children: task.dev_tool })) : null, task.branch ? (_jsx("span", { className: "rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300", children: task.branch })) : null, task.source_report_id ? (_jsx("span", { className: "rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-200", children: task.source_report_title || task.source_report_id })) : null] })) : null, task.debug_notes ? (_jsx("p", { className: "mt-2 line-clamp-2 rounded bg-slate-50 px-2 py-1 text-[10px] text-slate-500 dark:bg-slate-800/80 dark:text-slate-400", children: task.debug_notes })) : null, _jsx("select", { className: "mt-2 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800", value: task.status || "pending", disabled: busy, onChange: (e) => onStatus(task.id, e.target.value), children: STATUSES.map((s) => (_jsx("option", { value: s, children: s }, s))) })] }));
}
export function Tasks({ initialTab = "list", focused = false }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const authed = Boolean(getToken());
    const hasProject = Boolean(getProjectId());
    const [tab, setTab] = useState(initialTab);
    const [sprintId, setSprintId] = useState("");
    const [depDraft, setDepDraft] = useState({ source: "", target: "", type: "blocks", note: "" });
    const [taskQuery, setTaskQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [priorityFilter, setPriorityFilter] = useState("");
    const [sourceFilter, setSourceFilter] = useState("");
    const [selectedTaskIds, setSelectedTaskIds] = useState([]);
    const [bulkStatus, setBulkStatus] = useState("");
    const [bulkPriority, setBulkPriority] = useState("");
    const [bulkAssignee, setBulkAssignee] = useState("");
    const [dispatchOpen, setDispatchOpen] = useState(false);
    const [dispatchStrategy, setDispatchStrategy] = useState("balanced");
    const [dispatchIncludeBlocked, setDispatchIncludeBlocked] = useState(false);
    const [dispatchResult, setDispatchResult] = useState(null);
    const [schedulerPolicy, setSchedulerPolicy] = useState("quality_first");
    const [schedulerIncludeBlocked, setSchedulerIncludeBlocked] = useState(false);
    const [schedulerMaxParallel, setSchedulerMaxParallel] = useState(6);
    const [schedulerResult, setSchedulerResult] = useState(null);
    const [agentName, setAgentName] = useState("HermesAgent");
    const [claimResult, setClaimResult] = useState(null);
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
    const [newPriority, setNewPriority] = useState("P1");
    const [newSprintId, setNewSprintId] = useState("");
    const patchTask = useMutation({
        mutationFn: ({ id, patch }) => api.updateTask(id, patch),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["tasks"] });
            void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
            if (sprintId)
                void qc.invalidateQueries({ queryKey: ["sprint-progress", sprintId] });
        },
    });
    const reorderBoard = useMutation({
        mutationFn: (groups) => api.reorderTasksBoard(groups),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["tasks"] });
            void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
        },
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
            void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
            if (sprintId)
                void qc.invalidateQueries({ queryKey: ["sprint-progress", sprintId] });
        },
    });
    const deleteTaskMut = useMutation({
        mutationFn: (id) => api.deleteTask(id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["tasks"] });
            void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
            void qc.invalidateQueries({ queryKey: ["taskDependencies"] });
        },
    });
    const bulkUpdateMut = useMutation({
        mutationFn: () => api.bulkUpdateTasks({
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
            if (sprintId)
                void qc.invalidateQueries({ queryKey: ["sprint-progress", sprintId] });
        },
    });
    const dispatchMut = useMutation({
        mutationFn: (dryRun) => api.dispatchTasks({
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
        mutationFn: (dryRun) => api.taskSchedulerPlan({
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
        mutationFn: (packet) => api.taskAgentClaim({
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
        mutationFn: (claim) => api.taskAgentHeartbeat({
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
        mutationFn: () => api.taskQualityEvaluate({
            task_id: selectedTaskIds[0],
            gate_results: [],
            dry_run: true,
            source: "ui.scheduler.quality.preview",
        }),
    });
    const addDependency = useMutation({
        mutationFn: () => api.addTaskDependency(depDraft.source, {
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
        mutationFn: ({ source, target, type }) => api.deleteTaskDependency(source, target, type),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ["taskDependencies"] }),
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
    const busy = patchTask.isPending || reorderBoard.isPending || createTaskMut.isPending || deleteTaskMut.isPending || bulkUpdateMut.isPending || dispatchMut.isPending || schedulerMut.isPending;
    const canBulkUpdate = selectedTaskIds.length > 0 && Boolean(bulkStatus || bulkPriority || bulkAssignee.trim());
    if (!authed) {
        return _jsx("div", { className: "text-sm text-rose-600", children: t("auth.dashboardNeedLogin") });
    }
    if (!hasProject) {
        return _jsx("div", { className: "text-sm text-amber-700", children: t("projectSelector.hint") });
    }
    const tabs = [
        { key: "list", label: t("page.tasks.tabList") },
        { key: "board", label: t("page.tasks.tabBoard") },
        { key: "priority", label: t("page.tasks.tabPriority") },
        { key: "sprint", label: t("page.tasks.tabSprint") },
        { key: "deps", label: t("page.tasks.tabDeps") },
        { key: "scheduler", label: t("page.tasks.tabScheduler") },
    ];
    const taskColumns = [
        {
            title: t("page.tasks.task"),
            dataIndex: "title",
            render: (_value, task) => (_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold text-[var(--text)]", children: task.title }), _jsx("p", { className: "mt-1 truncate font-mono text-xs text-[var(--muted)]", children: task.id }), task.debug_notes ? _jsx("p", { className: "mt-1 line-clamp-1 text-xs text-[var(--muted-strong)]", children: task.debug_notes }) : null] })),
        },
        {
            title: t("page.tasks.statusLabel"),
            dataIndex: "status",
            width: 150,
            render: (value, task) => (_jsx(Select, { size: "small", className: "w-32", value: value || "pending", disabled: busy, onChange: (status) => patchTask.mutate({ id: task.id, patch: { status } }), options: STATUSES.map((status) => ({ value: status, label: t(`page.tasks.status.${status}`) })) })),
        },
        {
            title: t("page.tasks.priority"),
            dataIndex: "priority",
            width: 110,
            render: (value, task) => (_jsx(Select, { size: "small", className: "w-20", value: includesPriority(value) ? value : "P3", disabled: busy, onChange: (priority) => patchTask.mutate({ id: task.id, patch: { priority } }), options: PRIORITIES.map((priority) => ({ value: priority, label: priority })) })),
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
            render: (_value, task) => (_jsxs(Space, { size: [4, 4], wrap: true, children: [_jsx(Tag, { children: task.source || "manual" }), task.dev_tool ? _jsx(Tag, { color: "blue", children: task.dev_tool }) : null, task.branch ? _jsx(Tag, { children: task.branch }) : null] })),
        },
        {
            title: t("page.tasks.actions"),
            dataIndex: "actions",
            width: 110,
            render: (_value, task) => (_jsx(Popconfirm, { title: t("page.tasks.confirmDelete", { name: task.title }), okText: t("common.delete"), cancelText: t("common.cancel"), onConfirm: () => deleteTaskMut.mutate(task.id), children: _jsx(Button, { size: "small", danger: true, disabled: busy, children: t("page.tasks.delete") }) })),
        },
    ];
    return (_jsxs("div", { className: "w-full space-y-4", children: [_jsx(TasksWorkbenchHeader, { pending: loading || busy, onRefresh: () => {
                    void allTasksQ.refetch();
                    void summaryQ.refetch();
                } }), _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [!focused ? (_jsx(Segmented, { value: tab, onChange: (value) => setTab(value), options: tabs.map((item) => ({ value: item.key, label: item.label })) })) : (_jsx("div", { className: "text-sm font-semibold text-[var(--text)]", children: tabs.find((item) => item.key === tab)?.label ?? tab })), loading ? _jsx("span", { className: "text-xs text-slate-500", children: "\u2026" }) : null, _jsxs(Space, { wrap: true, children: [_jsx(Button, { onClick: () => {
                                    setDispatchOpen(true);
                                    setDispatchResult(null);
                                }, children: t("page.tasks.smartDispatch") }), _jsx(Button, { type: "primary", onClick: () => setCreateOpen(true), children: t("page.tasks.create") })] })] }), _jsx(Card, { title: t("page.tasks.filters"), children: _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Input.Search, { className: "min-w-[20rem] flex-1", allowClear: true, value: taskQuery, onChange: (e) => setTaskQuery(e.target.value), placeholder: t("page.tasks.searchPh") }), _jsx(Select, { className: "min-w-40", value: statusFilter, onChange: setStatusFilter, options: [
                                { value: "", label: t("page.tasks.allStatuses") },
                                ...STATUSES.map((status) => ({ value: status, label: t(`page.tasks.status.${status}`) })),
                            ] }), _jsx(Select, { className: "min-w-36", value: priorityFilter, onChange: setPriorityFilter, options: [{ value: "", label: t("page.tasks.allPriorities") }, ...PRIORITIES.map((priority) => ({ value: priority, label: priority }))] }), _jsx(Select, { className: "min-w-48", value: sourceFilter, onChange: setSourceFilter, options: [
                                { value: "", label: t("page.tasks.allSources") },
                                { value: "manual", label: t("page.tasks.sourceManual") },
                                { value: "analytics_report", label: t("page.tasks.sourceAnalyticsReport") },
                                { value: "system_page_backlog", label: t("page.tasks.sourceSystemBacklog") },
                                { value: "project_bootstrap", label: t("page.tasks.sourceProjectBootstrap") },
                            ] }), _jsx(Button, { onClick: () => {
                                setTaskQuery("");
                                setStatusFilter("");
                                setPriorityFilter("");
                                setSourceFilter("");
                            }, children: t("page.tasks.clearFilters") })] }) }), _jsx(Modal, { title: t("page.tasks.create"), open: createOpen, onCancel: () => setCreateOpen(false), onOk: () => {
                    if (!newTitle.trim())
                        return;
                    createTaskMut.mutate();
                }, okButtonProps: { disabled: busy || !newTitle.trim(), loading: createTaskMut.isPending }, okText: t("page.tasks.save"), cancelText: t("common.cancel"), children: _jsxs("div", { className: "space-y-3", children: [_jsxs("label", { className: "block text-xs text-[var(--muted)]", children: [t("page.tasks.titlePh"), _jsx(Input, { className: "mt-1", value: newTitle, onChange: (e) => setNewTitle(e.target.value) })] }), _jsxs("div", { className: "grid gap-3 sm:grid-cols-2", children: [_jsxs("label", { className: "block text-xs text-[var(--muted)]", children: [t("page.tasks.priority"), _jsx(Select, { className: "mt-1 w-full", value: newPriority, onChange: (value) => setNewPriority(value), options: PRIORITIES.map((priority) => ({ value: priority, label: priority })) })] }), _jsxs("label", { className: "block text-xs text-[var(--muted)]", children: [t("page.tasks.sprintOptional"), _jsx(Select, { className: "mt-1 w-full", allowClear: true, value: newSprintId || undefined, onChange: (value) => setNewSprintId(value || ""), options: sprints.map((s) => ({ value: s.id, label: s.goal })) })] })] }), createTaskMut.error ? _jsx("p", { className: "text-sm text-rose-600", children: createTaskMut.error.message }) : null] }) }), _jsx(Modal, { title: t("page.tasks.dispatchTitle"), open: dispatchOpen, onCancel: () => setDispatchOpen(false), footer: [
                    _jsx(Button, { onClick: () => setDispatchOpen(false), children: t("common.close") }, "close"),
                    _jsx(Button, { loading: dispatchMut.isPending, onClick: () => dispatchMut.mutate(true), children: t("page.tasks.previewDispatch") }, "preview"),
                    _jsx(Button, { type: "primary", loading: dispatchMut.isPending, disabled: !dispatchResult?.items?.length, onClick: () => dispatchMut.mutate(false), children: t("page.tasks.applyDispatch") }, "apply"),
                ], width: 980, children: _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Select, { className: "min-w-44", value: dispatchStrategy, onChange: setDispatchStrategy, options: [
                                        { value: "balanced", label: t("page.tasks.dispatchBalanced") },
                                        { value: "ai_first", label: t("page.tasks.dispatchAiFirst") },
                                        { value: "human_review", label: t("page.tasks.dispatchHumanReview") },
                                    ] }), _jsxs("label", { className: "inline-flex items-center gap-2 text-sm text-[var(--muted-strong)]", children: [_jsx("input", { type: "checkbox", checked: dispatchIncludeBlocked, onChange: (e) => setDispatchIncludeBlocked(e.target.checked) }), t("page.tasks.includeBlocked")] }), _jsx("span", { className: "text-xs text-[var(--muted)]", children: t("page.tasks.dispatchScope", { count: selectedTaskIds.length }) })] }), dispatchMut.error ? _jsx(Alert, { type: "error", showIcon: true, message: dispatchMut.error.message }) : null, dispatchResult && !dispatchResult.dry_run ? _jsx(Alert, { type: "success", showIcon: true, message: t("page.tasks.dispatchApplied", { count: dispatchResult.updated ?? 0 }) }) : null, _jsx(Table, { size: "small", rowKey: (row) => String(row.task_id), dataSource: dispatchResult?.items ?? [], pagination: { pageSize: 8, showSizeChanger: true }, scroll: { x: 920, y: 420 }, locale: { emptyText: t("page.tasks.noDispatchPlan") }, columns: [
                                { title: "#", dataIndex: "order", width: 56 },
                                {
                                    title: t("page.tasks.task"),
                                    dataIndex: "title",
                                    render: (value, row) => (_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: value }), _jsx("div", { className: "font-mono text-xs text-[var(--muted)]", children: row.task_id })] })),
                                },
                                { title: t("page.tasks.priority"), dataIndex: "priority", width: 90 },
                                { title: t("page.tasks.assignee"), dataIndex: "assigned_to", width: 150 },
                                { title: t("page.tasks.devTool"), dataIndex: "dev_tool", width: 110, render: (value) => _jsx(Tag, { color: "blue", children: value }) },
                                { title: t("page.tasks.ready"), dataIndex: "ready", width: 90, render: (value, row) => value ? _jsx(Tag, { color: "success", children: "ready" }) : _jsx(Tag, { color: "warning", children: row.blocked_by?.length ?? 0 }) },
                                { title: t("page.tasks.dispatchReason"), dataIndex: "reason", width: 320 },
                            ] })] }) }), tab === "board" ? (_jsx("p", { className: "text-xs text-slate-500", children: t("page.tasks.boardDragHint") })) : null, tab === "priority" ? (_jsx("p", { className: "text-xs text-slate-500", children: t("page.tasks.dragHint") })) : null, error ? (_jsx("p", { className: "text-sm text-rose-600", children: error.message })) : null, tab === "list" ? (_jsxs(Card, { title: t("page.tasks.executionList"), children: [_jsxs("div", { className: "mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3", children: [_jsx("span", { className: "text-sm text-[var(--muted-strong)]", children: t("page.tasks.bulkSelected", { count: selectedTaskIds.length }) }), _jsx(Select, { className: "min-w-40", allowClear: true, placeholder: t("page.tasks.bulkStatus"), value: bulkStatus || undefined, onChange: (value) => setBulkStatus(value || ""), options: STATUSES.map((status) => ({ value: status, label: t(`page.tasks.status.${status}`) })) }), _jsx(Select, { className: "min-w-36", allowClear: true, placeholder: t("page.tasks.bulkPriority"), value: bulkPriority || undefined, onChange: (value) => setBulkPriority(value || ""), options: PRIORITIES.map((priority) => ({ value: priority, label: priority })) }), _jsx(Input, { className: "w-44", allowClear: true, value: bulkAssignee, onChange: (e) => setBulkAssignee(e.target.value), placeholder: t("page.tasks.bulkAssignee") }), _jsx(Button, { type: "primary", disabled: !canBulkUpdate, loading: bulkUpdateMut.isPending, onClick: () => bulkUpdateMut.mutate(), children: t("page.tasks.bulkApply") }), _jsx(Button, { disabled: !selectedTaskIds.length && !bulkStatus && !bulkPriority && !bulkAssignee, onClick: () => {
                                    setSelectedTaskIds([]);
                                    setBulkStatus("");
                                    setBulkPriority("");
                                    setBulkAssignee("");
                                }, children: t("common.reset") }), bulkUpdateMut.error ? _jsx("span", { className: "text-sm text-rose-600", children: bulkUpdateMut.error.message }) : null] }), _jsx(Table, { rowKey: "id", columns: taskColumns, dataSource: tasks, loading: loading, size: "middle", scroll: { x: 980 }, rowSelection: {
                            selectedRowKeys: selectedTaskIds,
                            onChange: (keys) => setSelectedTaskIds(keys.map(String)),
                        }, pagination: { pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100], showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}` } })] })) : null, tab === "scheduler" ? (_jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]", children: [_jsxs("div", { className: "space-y-4", children: [_jsxs(Card, { title: t("page.tasks.schedulerTitle"), actions: _jsxs(Space, { wrap: true, children: [_jsx(Button, { loading: schedulerMut.isPending, onClick: () => schedulerMut.mutate(true), children: t("page.tasks.schedulerPreview") }), _jsx(Button, { type: "primary", loading: schedulerMut.isPending, disabled: !schedulerResult?.agent_packets?.length, onClick: () => schedulerMut.mutate(false), children: t("page.tasks.schedulerApply") })] }), children: [_jsxs("div", { className: "mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3", children: [_jsx(Select, { className: "min-w-48", value: schedulerPolicy, onChange: setSchedulerPolicy, options: [
                                                    { value: "quality_first", label: t("page.tasks.schedulerPolicyQuality") },
                                                    { value: "balanced", label: t("page.tasks.schedulerPolicyBalanced") },
                                                    { value: "throughput", label: t("page.tasks.schedulerPolicyThroughput") },
                                                    { value: "cost_saver", label: t("page.tasks.schedulerPolicyCost") },
                                                ] }), _jsx(InputNumber, { className: "w-36", min: 1, max: 50, value: schedulerMaxParallel, onChange: (value) => setSchedulerMaxParallel(Number(value || 1)), addonBefore: t("page.tasks.maxParallel") }), _jsxs("label", { className: "inline-flex items-center gap-2 text-sm text-[var(--muted-strong)]", children: [_jsx("input", { type: "checkbox", checked: schedulerIncludeBlocked, onChange: (e) => setSchedulerIncludeBlocked(e.target.checked) }), t("page.tasks.includeBlocked")] }), _jsx("span", { className: "text-xs text-[var(--muted)]", children: t("page.tasks.schedulerScope", { count: selectedTaskIds.length }) })] }), schedulerMut.error ? _jsx(Alert, { className: "mb-3", type: "error", showIcon: true, message: schedulerMut.error.message }) : null, schedulerResult && !schedulerResult.dry_run ? _jsx(Alert, { className: "mb-3", type: "success", showIcon: true, message: t("page.tasks.schedulerApplied", { count: schedulerResult.applied ?? 0 }) }) : null, schedulerResult?.summary ? (_jsxs("div", { className: "mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6", children: [_jsx(Stat, { label: t("page.tasks.schedulerReady"), value: schedulerResult.summary.ready ?? 0 }), _jsx(Stat, { label: t("page.tasks.schedulerBlocked"), value: schedulerResult.summary.blocked ?? 0 }), _jsx(Stat, { label: t("page.tasks.schedulerScheduled"), value: schedulerResult.summary.scheduled ?? 0 }), _jsx(Stat, { label: t("page.tasks.schedulerStages"), value: schedulerResult.summary.stages ?? 0 }), _jsx(Stat, { label: t("page.tasks.schedulerGates"), value: schedulerResult.summary.quality_gates ?? 0 }), _jsx(Stat, { label: t("page.tasks.schedulerWakeups"), value: schedulerResult.summary.event_wakeups ?? 0 })] })) : null, _jsx(Table, { rowKey: (row) => String(row.packet_id), dataSource: schedulerResult?.agent_packets ?? [], loading: schedulerMut.isPending, size: "small", scroll: { x: 1100 }, pagination: { pageSize: 8, showSizeChanger: true }, locale: { emptyText: t("page.tasks.schedulerEmpty") }, columns: [
                                            { title: "#", dataIndex: "order", width: 56 },
                                            { title: t("page.tasks.lane"), dataIndex: "lane", width: 70, render: (value) => _jsxs(Tag, { color: "cyan", children: ["L", value] }) },
                                            {
                                                title: t("page.tasks.task"),
                                                dataIndex: "title",
                                                render: (value, row) => (_jsxs("div", { children: [_jsx("div", { className: "font-medium text-[var(--text)]", children: value }), _jsx("div", { className: "font-mono text-xs text-[var(--muted)]", children: row.task_id })] })),
                                            },
                                            { title: t("page.tasks.assignee"), dataIndex: "assigned_to", width: 150 },
                                            { title: t("page.tasks.devTool"), dataIndex: "dev_tool", width: 110, render: (value) => _jsx(Tag, { color: "blue", children: value }) },
                                            { title: t("page.tasks.ready"), dataIndex: "ready", width: 90, render: (value, row) => value ? _jsx(Tag, { color: "success", children: "ready" }) : _jsx(Tag, { color: "warning", children: row.blocked_by?.length ?? 0 }) },
                                            { title: t("page.tasks.qualityGates"), dataIndex: "quality_gates", width: 130, render: (items) => items?.length ?? 0 },
                                            { title: t("page.tasks.dispatchReason"), dataIndex: "dispatch_reason", width: 320 },
                                        ] })] }), _jsx(Card, { title: t("page.tasks.schedulerDag"), children: _jsxs("div", { className: "grid gap-3 md:grid-cols-2 2xl:grid-cols-3", children: [(schedulerResult?.stages ?? []).map((stage) => (_jsxs("div", { className: "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3", children: [_jsxs("div", { className: "mb-2 flex items-center justify-between gap-2", children: [_jsxs("span", { className: "text-sm font-semibold text-[var(--text)]", children: [t("page.tasks.stage"), " ", stage.stage] }), _jsx(Tag, { children: stage.tasks?.length ?? 0 })] }), _jsx("div", { className: "space-y-2", children: (stage.tasks ?? []).map((task) => (_jsxs("div", { className: "rounded-md bg-[var(--surface-muted)] px-2 py-2", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsx("span", { className: "line-clamp-1 text-xs font-medium text-[var(--text)]", children: task.title }), _jsx(Tag, { color: task.ready ? "success" : "warning", children: task.priority })] }), _jsx("div", { className: "mt-1 font-mono text-[10px] text-[var(--muted)]", children: task.id }), task.blocked_by?.length ? _jsx("div", { className: "mt-1 line-clamp-1 text-[10px] text-rose-600", children: task.blocked_by.join(", ") }) : null] }, task.id))) })] }, String(stage.stage)))), !schedulerResult?.stages?.length ? _jsx("p", { className: "text-sm text-[var(--muted)]", children: t("page.tasks.schedulerRunHint") }) : null] }) })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs(Card, { title: t("page.tasks.agentFeed"), children: [_jsxs("div", { className: "mb-3 flex flex-wrap items-center gap-2", children: [_jsx(Input, { className: "max-w-56", value: agentName, onChange: (e) => setAgentName(e.target.value), placeholder: t("page.tasks.agentName") }), _jsx(Button, { loading: claimMut.isPending, onClick: () => claimMut.mutate(undefined), children: t("page.tasks.claimNext") })] }), claimMut.error ? _jsx(Alert, { className: "mb-3", type: "error", showIcon: true, message: claimMut.error.message }) : null, claimResult?.claim ? _jsx(Alert, { className: "mb-3", type: "success", showIcon: true, message: t("page.tasks.claimedTask", { task: claimResult.claim.task_id, agent: claimResult.claim.agent }) }) : null, agentFeedQ.error ? _jsx(Alert, { type: "error", showIcon: true, message: agentFeedQ.error.message }) : null, _jsx(Table, { rowKey: (row) => String(row.packet_id), dataSource: agentFeedQ.data?.items ?? [], loading: agentFeedQ.isLoading, size: "small", pagination: false, scroll: { x: 520 }, columns: [
                                            {
                                                title: t("page.tasks.task"),
                                                dataIndex: "title",
                                                render: (value, row) => (_jsxs("div", { children: [_jsx("div", { className: "line-clamp-1 text-xs font-medium", children: value }), _jsx("div", { className: "font-mono text-[10px] text-[var(--muted)]", children: row.task_id })] })),
                                            },
                                            { title: t("page.tasks.lane"), dataIndex: "lane", width: 64 },
                                            { title: t("page.tasks.qualityGates"), dataIndex: "quality_gates", width: 80, render: (items) => items?.length ?? 0 },
                                            {
                                                title: t("page.tasks.agentLease"),
                                                dataIndex: "claim",
                                                width: 100,
                                                render: (claim) => claim?.claim_id ? _jsx(Tag, { color: "processing", children: claim.agent }) : _jsx(Tag, { children: t("page.tasks.unclaimed") }),
                                            },
                                            {
                                                title: t("page.tasks.action"),
                                                key: "action",
                                                width: 96,
                                                render: (_, row) => (_jsx(Button, { size: "small", loading: claimMut.isPending, disabled: !row.ready || Boolean(row.claim?.claim_id), onClick: () => claimMut.mutate(row), children: t("page.tasks.claim") })),
                                            },
                                        ] })] }), _jsx(Card, { title: t("page.tasks.activeClaims"), children: _jsx(Table, { rowKey: (row) => String(row.claim_id), dataSource: agentClaimsQ.data?.items ?? [], loading: agentClaimsQ.isLoading || heartbeatMut.isPending, size: "small", pagination: false, scroll: { x: 620 }, columns: [
                                        {
                                            title: t("page.tasks.task"),
                                            dataIndex: "task_id",
                                            render: (value, row) => (_jsxs("div", { children: [_jsx("div", { className: "font-mono text-xs text-[var(--text)]", children: value }), _jsx("div", { className: "font-mono text-[10px] text-[var(--muted)]", children: row.claim_id })] })),
                                        },
                                        { title: t("page.tasks.agent"), dataIndex: "agent", width: 110 },
                                        { title: t("page.tasks.progress"), dataIndex: "progress", width: 90, render: (value) => `${value || 0}%` },
                                        { title: t("page.tasks.leaseExpires"), dataIndex: "lease_expires_at", width: 170 },
                                        {
                                            title: t("page.tasks.action"),
                                            key: "action",
                                            width: 90,
                                            render: (_, row) => (_jsx(Button, { size: "small", onClick: () => heartbeatMut.mutate(row), children: t("page.tasks.heartbeat") })),
                                        },
                                    ] }) }), _jsxs(Card, { title: t("page.tasks.qualityCenter"), children: [qualityPolicyQ.error ? _jsx(Alert, { className: "mb-3", type: "error", showIcon: true, message: qualityPolicyQ.error.message }) : null, _jsxs("div", { className: "grid grid-cols-3 gap-2", children: [_jsx(Stat, { label: t("page.tasks.qualityMode"), value: qualityPolicyQ.data?.policy?.mode || "-" }), _jsx(Stat, { label: t("page.tasks.qualityRequired"), value: qualityPolicyQ.data?.summary?.required ?? 0 }), _jsx(Stat, { label: t("page.tasks.qualityAdvisory"), value: qualityPolicyQ.data?.summary?.advisory ?? 0 })] }), _jsx("div", { className: "mt-3 flex flex-wrap gap-1", children: (qualityPolicyQ.data?.default_gates ?? []).slice(0, 8).map((gate) => (_jsx(Tag, { color: gate.severity === "blocking" ? "red" : "blue", children: gate.id }, gate.id))) }), _jsxs("div", { className: "mt-3 flex items-center gap-2", children: [_jsx(Button, { size: "small", loading: qualityEvaluateMut.isPending, disabled: !selectedTaskIds[0], onClick: () => qualityEvaluateMut.mutate(), children: t("page.tasks.qualityEvaluateSelected") }), _jsx("span", { className: "text-xs text-[var(--muted)]", children: selectedTaskIds[0] || t("page.tasks.qualitySelectHint") })] }), qualityEvaluateMut.data?.quality ? (_jsx(Alert, { className: "mt-3", type: qualityEvaluateMut.data.quality.decision === "block" ? "warning" : "success", showIcon: true, message: t("page.tasks.qualityDecision", { decision: qualityEvaluateMut.data.quality.decision, score: qualityEvaluateMut.data.quality.score }) })) : null] }), _jsx(Card, { title: t("page.tasks.eventWakeups"), children: _jsx("div", { className: "space-y-2", children: (schedulerResult?.event_wakeups ?? agentFeedQ.data?.event_wakeups ?? []).map((event) => (_jsxs("div", { className: "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2", children: [_jsx("div", { className: "font-mono text-xs font-semibold text-[var(--text)]", children: event.event }), _jsx("div", { className: "mt-1 text-xs text-[var(--muted-strong)]", children: event.action }), _jsx(Tag, { className: "mt-2", children: event.target })] }, `${event.event}-${event.action}`))) }) }), _jsx(Card, { title: t("page.tasks.agentContract"), children: _jsxs("div", { className: "space-y-2 text-xs text-[var(--muted-strong)]", children: [_jsx("p", { children: t("page.tasks.agentContractScope") }), _jsx("p", { children: t("page.tasks.agentContractGates") }), _jsx("p", { children: t("page.tasks.agentContractCallbacks") })] }) })] })] })) : null, tab === "board" ? (_jsx("div", { className: "grid gap-3 md:grid-cols-2 xl:grid-cols-4", children: STATUSES.map((st) => (_jsx(Card, { title: `${t(`page.tasks.status.${st}`)} (${boardGroups[st].length})`, children: _jsx("div", { className: "min-h-[80px] space-y-2", onDragOver: (e) => {
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
                                }, className: "cursor-grab rounded border border-slate-200 bg-white px-2 py-1.5 text-sm active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900/80", children: [_jsx("span", { className: "font-medium", children: task.title }), _jsx("span", { className: `ml-2 rounded px-1 py-0.5 text-xs ${statusColor[task.status] || ""}`, children: task.status })] }, task.id)))) }) }, pr))), reorderBoard.isError ? (_jsx("p", { className: "col-span-full text-sm text-rose-600", children: reorderBoard.error.message })) : null] })) : null, tab === "sprint" ? (_jsxs("div", { className: "space-y-4", children: [_jsxs(Card, { title: t("page.tasks.sprintList"), children: [_jsx("div", { className: "mb-3 flex flex-wrap gap-2", children: _jsxs("select", { className: "rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900", value: sprintId, onChange: (e) => setSprintId(e.target.value), children: [_jsx("option", { value: "", children: t("page.tasks.pickSprint") }), sprints.map((s) => (_jsxs("option", { value: s.id, children: [s.goal, " (", s.status, ")"] }, s.id)))] }) }), sprintId ? (_jsxs("div", { className: "space-y-4", children: [_jsx(SprintProgressPanel, { progress: progressQ.data, loading: progressQ.isLoading, tasksHref: "#/tasks/sprints" }), burndownQ.isLoading ? (_jsx("p", { className: "text-sm text-slate-500", children: t("common.loading") })) : burndownQ.data ? (_jsx(SprintBurndownChart, { data: burndownQ.data })) : null] })) : (_jsx("p", { className: "text-sm text-slate-500", children: t("page.tasks.pickSprint") }))] }), _jsx(Card, { title: t("page.tasks.sprintTasks"), children: !sprintId ? (_jsx("p", { className: "text-sm text-slate-500", children: t("page.tasks.pickSprint") })) : (_jsx("ul", { className: "divide-y divide-slate-200 dark:divide-slate-700", children: tasks.map((task) => (_jsxs("li", { className: "flex items-center justify-between py-2 text-sm", children: [_jsx("span", { children: task.title }), _jsx("span", { className: `rounded px-1.5 py-0.5 text-xs ${statusColor[task.status] || ""}`, children: task.status })] }, task.id))) })) })] })) : null, tab === "deps" ? (_jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem]", children: [_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-4", children: [_jsx(Stat, { label: t("page.tasks.depNodes"), value: depsQ.data?.summary?.nodes ?? 0 }), _jsx(Stat, { label: t("page.tasks.depEdges"), value: depsQ.data?.summary?.edges ?? 0 }), _jsx(Stat, { label: t("page.tasks.depBlocked"), value: depsQ.data?.summary?.blocked ?? 0 }), _jsx(Stat, { label: t("page.tasks.depBlocks"), value: depsQ.data?.summary?.by_type?.blocks ?? 0 })] }), _jsxs(Card, { title: t("page.tasks.depGraph"), children: [depsQ.isError ? _jsx("p", { className: "text-sm text-rose-600", children: depsQ.error.message }) : null, _jsx("div", { className: "grid gap-3 md:grid-cols-2 xl:grid-cols-3", children: (depsQ.data?.nodes ?? []).map((node) => (_jsxs("div", { className: `rounded-lg border p-3 ${node.is_dependency_blocked ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`, children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold text-slate-900 dark:text-slate-100", children: node.title }), _jsx("p", { className: "mt-0.5 font-mono text-[10px] text-slate-400", children: node.id })] }), _jsx("span", { className: `rounded px-1.5 py-0.5 text-[10px] ${statusColor[node.status] || ""}`, children: node.status })] }), _jsxs("div", { className: "mt-3 grid grid-cols-3 gap-2 text-[11px] text-slate-500", children: [_jsxs("span", { children: [t("page.tasks.depIn"), ": ", node.incoming] }), _jsxs("span", { children: [t("page.tasks.depOut"), ": ", node.outgoing] }), _jsx("span", { children: node.priority })] }), node.blocked_by?.length ? _jsxs("p", { className: "mt-2 truncate text-xs text-rose-700 dark:text-rose-200", children: [t("page.tasks.depBlockedBy"), ": ", node.blocked_by.join(", ")] }) : null] }, node.id))) })] }), _jsx(Card, { title: t("page.tasks.depEdges"), children: _jsxs("ul", { className: "space-y-2 text-sm", children: [(depsQ.data?.edges ?? []).map((edge) => (_jsxs("li", { className: "rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsxs("span", { className: "font-mono text-xs text-slate-700 dark:text-slate-200", children: [edge.source_id, " \u2192 ", edge.target_id] }), _jsx("span", { className: "rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800", children: edge.type })] }), edge.note ? _jsx("p", { className: "mt-1 text-xs text-slate-500", children: edge.note }) : null, _jsx("button", { type: "button", className: "mt-2 text-xs text-rose-600 disabled:opacity-50", disabled: deleteDependency.isPending, onClick: () => deleteDependency.mutate({ source: edge.source_id, target: edge.target_id, type: edge.type }), children: t("page.tasks.depDelete") })] }, `${edge.source_id}-${edge.target_id}-${edge.type}`))), depsQ.isSuccess && !depsQ.data?.edges?.length ? _jsx("li", { className: "text-sm text-slate-500", children: t("page.tasks.depEmpty") }) : null] }) })] }), _jsx(Card, { title: t("page.tasks.depCreate"), children: _jsxs("form", { className: "space-y-3", onSubmit: (e) => {
                                e.preventDefault();
                                if (!depDraft.source || !depDraft.target)
                                    return;
                                addDependency.mutate();
                            }, children: [_jsxs("label", { className: "block text-xs text-slate-500", children: [t("page.tasks.depSource"), _jsxs("select", { className: "mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900", value: depDraft.source, onChange: (e) => setDepDraft((v) => ({ ...v, source: e.target.value })), children: [_jsx("option", { value: "", children: "\u2014" }), tasks.map((task) => _jsxs("option", { value: task.id, children: [task.id, " \u00B7 ", task.title] }, task.id))] })] }), _jsxs("label", { className: "block text-xs text-slate-500", children: [t("page.tasks.depTarget"), _jsxs("select", { className: "mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900", value: depDraft.target, onChange: (e) => setDepDraft((v) => ({ ...v, target: e.target.value })), children: [_jsx("option", { value: "", children: "\u2014" }), tasks.map((task) => _jsxs("option", { value: task.id, children: [task.id, " \u00B7 ", task.title] }, task.id))] })] }), _jsxs("label", { className: "block text-xs text-slate-500", children: [t("page.tasks.depType"), _jsxs("select", { className: "mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900", value: depDraft.type, onChange: (e) => setDepDraft((v) => ({ ...v, type: e.target.value })), children: [_jsx("option", { value: "blocks", children: "blocks" }), _jsx("option", { value: "relates", children: "relates" }), _jsx("option", { value: "duplicates", children: "duplicates" })] })] }), _jsx("textarea", { className: "min-h-24 w-full rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900", value: depDraft.note, onChange: (e) => setDepDraft((v) => ({ ...v, note: e.target.value })), placeholder: t("page.tasks.depNote") }), _jsx("button", { type: "submit", disabled: addDependency.isPending || !depDraft.source || !depDraft.target, className: "w-full rounded-lg bg-sky-600 px-4 py-1.5 text-sm text-white disabled:opacity-50", children: t("page.tasks.depSave") }), addDependency.error ? _jsx("p", { className: "text-sm text-rose-600", children: addDependency.error.message }) : null, deleteDependency.error ? _jsx("p", { className: "text-sm text-rose-600", children: deleteDependency.error.message }) : null] }) })] })) : null] }));
}
function Stat({ label, value }) {
    return (_jsx("div", { className: "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3", children: _jsx(Statistic, { title: label, value: value, valueStyle: { color: "var(--text)", fontSize: 20, fontWeight: 700 } }) }));
}
