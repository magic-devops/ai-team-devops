import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Descriptions, Drawer, Input, Select, Space, Table, Tag, Timeline, Typography } from "antd";
import { Activity, GitBranch, ListChecks, Network, PauseCircle, Play, Radio, RefreshCw, Send, Terminal, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { FlashMessage } from "../components/FlashMessage";
import { EmptyState, ErrorBlock, LoadingBlock, NeedLogin } from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";
import { WorkflowsWorkbenchHeader } from "./delivery/WorkflowsWorkbenchHeader";
import { WorkflowDag } from "./shared/WorkflowDag";
const inputClass = "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";
function StatusBadge({ status }) {
    const cls = status === "completed" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" :
        status === "failed" || status === "cancelled" ? "bg-rose-500/10 text-rose-700 dark:text-rose-200" :
            "bg-sky-500/10 text-sky-700 dark:text-sky-200";
    return _jsx("span", { className: `rounded-full px-2 py-0.5 text-xs font-medium ${cls}`, children: status });
}
export function Workflows({ initialModule = "catalog", focused = false }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const authed = Boolean(getToken());
    const hasProject = Boolean(getProjectId());
    const [module, setModule] = useState(initialModule);
    const [type, setType] = useState("");
    const [args, setArgs] = useState("{}");
    const [selected, setSelected] = useState("");
    const [detailId, setDetailId] = useState("");
    const [instanceStatus, setInstanceStatus] = useState("");
    const [instanceType, setInstanceType] = useState("");
    const [instanceQuery, setInstanceQuery] = useState("");
    const [selectedWorkflowIds, setSelectedWorkflowIds] = useState([]);
    const [signalDraft, setSignalDraft] = useState({ signal: "approve", payload: "{}" });
    const [flash, setFlash] = useState(null);
    const types = useQuery({ queryKey: ["wf-types"], queryFn: api.workflowTypes, enabled: authed && hasProject });
    const summary = useQuery({ queryKey: ["wf-summary"], queryFn: api.workflowSummary, enabled: authed && hasProject });
    const engineStatus = useQuery({ queryKey: ["wf-engine"], queryFn: api.workflowEngineStatus, enabled: authed && hasProject });
    const opsPlan = useQuery({ queryKey: ["wf-ops-plan"], queryFn: api.workflowOpsPlan, enabled: authed && hasProject && module === "ops" });
    const instances = useQuery({
        queryKey: ["wf-instances", instanceStatus, instanceType, instanceQuery],
        queryFn: () => api.workflowInstances(300, instanceStatus, instanceType, instanceQuery.trim()),
        enabled: authed && hasProject,
    });
    const events = useQuery({ queryKey: ["wf-events", selected], queryFn: () => api.workflowEvents(100, selected), enabled: authed && hasProject && (module === "events" || module === "signals") });
    const detailQ = useQuery({
        queryKey: ["wf-detail", detailId],
        queryFn: () => api.workflowDetail(detailId),
        enabled: authed && hasProject && Boolean(detailId),
    });
    const start = useMutation({
        mutationFn: () => {
            let parsed = {};
            try {
                parsed = JSON.parse(args || "{}");
            }
            catch {
                throw new Error(t("page.workflows.invalidJson"));
            }
            return api.startWorkflow({ type, args: parsed });
        },
        onSuccess: (data) => {
            setSelected(String(data?.workflow_id ?? ""));
            setFlash({ kind: "ok", message: t("page.workflows.started", { id: data?.workflow_id ?? data?.id ?? "-" }) });
            invalidate();
        },
        onError: (err) => setFlash({ kind: "err", message: err.message }),
    });
    const signal = useMutation({
        mutationFn: () => {
            let payload = {};
            try {
                payload = JSON.parse(signalDraft.payload || "{}");
            }
            catch {
                throw new Error(t("page.workflows.invalidJson"));
            }
            return api.signalWorkflow(selected, { signal: signalDraft.signal, payload });
        },
        onSuccess: () => {
            setFlash({ kind: "ok", message: t("page.workflows.signalSent") });
            invalidate();
        },
        onError: (err) => setFlash({ kind: "err", message: err.message }),
    });
    const cancel = useMutation({
        mutationFn: (workflowId) => api.cancelWorkflow(workflowId),
        onSuccess: () => {
            setFlash({ kind: "ok", message: t("page.workflows.cancelled") });
            invalidate();
        },
    });
    const bulkCancel = useMutation({
        mutationFn: () => api.bulkCancelWorkflows(selectedWorkflowIds),
        onSuccess: (data) => {
            setSelectedWorkflowIds([]);
            setFlash({ kind: "ok", message: t("page.workflows.bulkCancelled", { count: data?.count ?? 0 }) });
            invalidate();
        },
        onError: (err) => setFlash({ kind: "err", message: err.message }),
    });
    const opsTasks = useMutation({
        mutationFn: (dryRun) => api.workflowOpsTasks({ dry_run: dryRun, priority: "P1", assigned_to: "Coder" }),
        onSuccess: (data) => {
            setFlash({ kind: "ok", message: t("page.workflows.opsTasksResult", { planned: data?.summary?.planned ?? 0, created: data?.summary?.created ?? 0 }) });
            invalidate();
        },
        onError: (err) => setFlash({ kind: "err", message: err.message }),
    });
    function invalidate() {
        void qc.invalidateQueries({ queryKey: ["wf-summary"] });
        void qc.invalidateQueries({ queryKey: ["wf-charts"] });
        void qc.invalidateQueries({ queryKey: ["wf-instances"] });
        void qc.invalidateQueries({ queryKey: ["wf-events"] });
        void qc.invalidateQueries({ queryKey: ["wf-ops-plan"] });
    }
    useEffect(() => {
        if (!flash)
            return;
        const tmr = window.setTimeout(() => setFlash(null), 6000);
        return () => window.clearTimeout(tmr);
    }, [flash]);
    useEffect(() => {
        setModule(initialModule);
    }, [initialModule]);
    if (!authed)
        return _jsx(NeedLogin, {});
    if (!hasProject)
        return _jsx("p", { className: "text-sm text-amber-700", children: t("projectSelector.hint") });
    const modules = [
        { id: "catalog", label: t("page.workflows.module.catalog"), icon: _jsx(GitBranch, { className: "h-5 w-5" }) },
        { id: "instances", label: t("page.workflows.module.instances"), icon: _jsx(Play, { className: "h-5 w-5" }) },
        { id: "events", label: t("page.workflows.module.events"), icon: _jsx(Radio, { className: "h-5 w-5" }) },
        { id: "signals", label: t("page.workflows.module.signals"), icon: _jsx(Network, { className: "h-5 w-5" }) },
        { id: "ops", label: t("page.workflows.module.ops"), icon: _jsx(Activity, { className: "h-5 w-5" }) },
    ];
    const workflowTypeOptions = (types.data ?? []).map((wf) => ({ value: wf.type, label: wf.type }));
    const instanceColumns = [
        {
            title: t("page.workflows.instance"),
            dataIndex: "workflow_id",
            render: (_value, row) => (_jsxs("button", { type: "button", className: "min-w-0 text-left", onClick: () => { setSelected(row.workflow_id); setModule("events"); }, children: [_jsx("p", { className: "truncate font-mono text-xs font-semibold text-[var(--text)]", children: row.workflow_id }), _jsx("p", { className: "mt-1 truncate text-xs text-[var(--muted)]", children: row.run_id })] })),
        },
        {
            title: t("page.workflows.type"),
            dataIndex: "type",
            width: 170,
            render: (value) => _jsx(Tag, { children: value }),
        },
        {
            title: t("page.workflows.status"),
            dataIndex: "status",
            width: 130,
            render: (value) => _jsx(StatusBadge, { status: String(value ?? "-") }),
        },
        {
            title: t("page.workflows.duration"),
            dataIndex: "duration_s",
            width: 120,
            render: (value) => `${Number(value ?? 0)}s`,
        },
        {
            title: t("page.workflows.actions"),
            dataIndex: "actions",
            width: 190,
            render: (_value, row) => (_jsxs(Space, { size: 6, wrap: true, children: [_jsx(Button, { size: "small", onClick: () => setDetailId(row.workflow_id), children: t("common.view") }), _jsx(Button, { size: "small", onClick: () => { setSelected(row.workflow_id); setModule("events"); }, children: t("page.workflows.events") }), _jsx(Button, { size: "small", danger: true, icon: _jsx(XCircle, { className: "h-3.5 w-3.5" }), disabled: cancel.isPending || ["completed", "failed", "cancelled"].includes(row.status), onClick: () => cancel.mutate(row.workflow_id) })] })),
        },
    ];
    return (_jsxs("div", { className: "w-full space-y-4", children: [_jsx(WorkflowsWorkbenchHeader, { onRefresh: invalidate, pending: start.isPending || signal.isPending || cancel.isPending || bulkCancel.isPending }), _jsxs("div", { className: "grid w-full gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]", children: [_jsx("aside", { className: "xl:sticky xl:top-4 xl:self-start", children: _jsx(Card, { title: focused ? t(`page.workflows.module.${module}`) : t("page.workflows.title"), children: _jsxs("div", { className: "grid gap-3", children: [_jsx(Summary, { label: t("page.workflows.engine"), value: summary.data?.engine ?? "-" }), _jsx(Summary, { label: t("page.workflows.temporal"), value: engineStatus.data?.temporal_connected ? t("page.workflows.temporalOn") : t("page.workflows.temporalOff") }), _jsx(Summary, { label: t("page.workflows.instances"), value: summary.data?.total ?? 0 }), _jsx(Summary, { label: t("page.workflows.running"), value: summary.data?.by_status?.running ?? 0 }), _jsx("div", { className: "mt-2 grid gap-2", children: modules.map((m) => (_jsxs("button", { type: "button", onClick: () => setModule(m.id), className: `flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium ${module === m.id ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]" : "border-[var(--border)] text-[var(--muted-strong)]"}`, children: [_jsx("span", { className: "text-[var(--brand)]", children: m.icon }), m.label] }, m.id))) })] }) }) }), _jsxs("section", { className: "min-w-0 space-y-4", children: [flash ? _jsx(FlashMessage, { kind: flash.kind, message: flash.message, onDismiss: () => setFlash(null) }) : null, module === "catalog" ? (_jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]", children: [_jsxs(Card, { title: t("page.workflows.available"), actions: _jsx(RefreshButton, { onClick: invalidate }), children: [types.isLoading ? _jsx(LoadingBlock, {}) : null, types.error ? _jsx(ErrorBlock, { message: types.error.message }) : null, (types.data ?? []).length === 0 && !types.isLoading && !types.error ? _jsx(EmptyState, { message: t("page.workflows.empty") }) : null, _jsx("div", { className: "grid gap-3 lg:grid-cols-2", children: (types.data ?? []).map((wf) => (_jsxs("button", { type: "button", className: `rounded-2xl border p-4 text-left ${type === wf.type ? "border-[var(--brand)] bg-[var(--brand-softer)]" : "border-[var(--border)] bg-[var(--surface)]"}`, onClick: () => setType(wf.type), children: [_jsx("div", { className: "font-mono text-sm font-semibold text-[var(--text)]", children: wf.type }), _jsx("p", { className: "mt-2 text-sm text-[var(--muted-strong)]", children: wf.description }), _jsxs("p", { className: "mt-3 text-xs text-[var(--muted)]", children: [t("page.workflows.signals"), ": ", (wf.signals ?? []).join(", ") || "-"] })] }, wf.type))) })] }), _jsx(Card, { title: t("page.workflows.start"), children: _jsxs("div", { className: "space-y-3", children: [_jsxs("select", { className: `${inputClass} w-full`, value: type, onChange: (e) => setType(e.target.value), children: [_jsx("option", { value: "", children: t("page.workflows.choose") }), (types.data ?? []).map((wf) => _jsx("option", { value: wf.type, children: wf.type }, wf.type))] }), _jsx("textarea", { className: `${inputClass} min-h-40 w-full font-mono text-xs`, value: args, onChange: (e) => setArgs(e.target.value), placeholder: '{"key": "value"}' }), _jsxs("button", { type: "button", className: "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50", disabled: !type || start.isPending, onClick: () => start.mutate(), children: [_jsx(Play, { className: "h-4 w-4" }), start.isPending ? t("common.loading") : t("page.workflows.startBtn")] })] }) })] })) : null, module === "instances" ? (_jsxs(Card, { title: t("page.workflows.instances"), actions: _jsx(RefreshButton, { onClick: invalidate }), children: [instances.isLoading ? _jsx(LoadingBlock, {}) : null, instances.error ? _jsx(ErrorBlock, { message: instances.error.message }) : null, _jsxs("div", { className: "mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3", children: [_jsx(Input.Search, { className: "min-w-[18rem] flex-1", allowClear: true, value: instanceQuery, onChange: (e) => setInstanceQuery(e.target.value), placeholder: t("page.workflows.searchInstances") }), _jsx(Select, { className: "min-w-40", allowClear: true, placeholder: t("page.workflows.allStatuses"), value: instanceStatus || undefined, onChange: (value) => setInstanceStatus(value || ""), options: [
                                                    { value: "running", label: "running" },
                                                    { value: "completed", label: "completed" },
                                                    { value: "failed", label: "failed" },
                                                    { value: "cancelled", label: "cancelled" },
                                                ] }), _jsx(Select, { className: "min-w-52", allowClear: true, placeholder: t("page.workflows.allTypes"), value: instanceType || undefined, onChange: (value) => setInstanceType(value || ""), options: workflowTypeOptions }), _jsx(Button, { onClick: () => {
                                                    setInstanceQuery("");
                                                    setInstanceStatus("");
                                                    setInstanceType("");
                                                }, children: t("common.reset") }), _jsx(Button, { danger: true, disabled: !selectedWorkflowIds.length || bulkCancel.isPending, loading: bulkCancel.isPending, onClick: () => bulkCancel.mutate(), children: t("page.workflows.bulkCancel", { count: selectedWorkflowIds.length }) })] }), _jsx(Table, { rowKey: "workflow_id", columns: instanceColumns, dataSource: instances.data?.items ?? [], loading: instances.isLoading, size: "middle", scroll: { x: 900 }, rowSelection: {
                                            selectedRowKeys: selectedWorkflowIds,
                                            onChange: (keys) => setSelectedWorkflowIds(keys.map(String)),
                                            getCheckboxProps: (record) => ({
                                                disabled: ["completed", "failed", "cancelled"].includes(record.status),
                                            }),
                                        }, pagination: { pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100], showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}` } })] })) : null, module === "events" ? (_jsx("div", { className: "grid gap-4", children: _jsxs(Card, { title: t("page.workflows.events"), children: [_jsxs("select", { className: `${inputClass} mb-3 w-full`, value: selected, onChange: (e) => setSelected(e.target.value), children: [_jsx("option", { value: "", children: t("page.workflows.allInstances") }), (instances.data?.items ?? []).map((row) => _jsx("option", { value: row.workflow_id, children: row.workflow_id }, row.workflow_id))] }), _jsxs("ul", { className: "space-y-2", children: [(events.data?.items ?? []).map((evt) => (_jsxs("li", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsx("span", { className: "font-mono text-xs font-semibold text-[var(--text)]", children: evt.workflow_id }), _jsx("span", { className: "text-xs text-[var(--muted)]", children: evt.ts })] }), _jsx("pre", { className: "mt-2 max-h-40 overflow-auto text-xs text-[var(--muted-strong)]", children: JSON.stringify(evt, null, 2) })] }, evt.id))), events.isSuccess && !(events.data?.items ?? []).length ? _jsx(EmptyState, { message: t("page.workflows.noEvents") }) : null] })] }) })) : null, module === "signals" ? (_jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]", children: [_jsxs(Card, { title: t("page.workflows.signalTargets"), children: [_jsx(Table, { rowKey: "workflow_id", columns: instanceColumns.filter((column) => column.dataIndex !== "actions"), dataSource: (instances.data?.items ?? []).filter((row) => !["completed", "failed", "cancelled"].includes(row.status)), loading: instances.isLoading, size: "middle", scroll: { x: 720 }, pagination: { pageSize: 8, showSizeChanger: true, pageSizeOptions: [8, 20, 50] }, onRow: (record) => ({
                                                    onClick: () => setSelected(record.workflow_id),
                                                }) }), instances.isSuccess && !(instances.data?.items ?? []).some((row) => !["completed", "failed", "cancelled"].includes(row.status)) ? (_jsx(EmptyState, { message: t("page.workflows.noSignalTargets") })) : null] }), _jsx(Card, { title: t("page.workflows.signal"), children: _jsxs("div", { className: "space-y-2", children: [_jsxs("select", { className: `${inputClass} w-full`, value: selected, onChange: (e) => setSelected(e.target.value), children: [_jsx("option", { value: "", children: t("page.workflows.chooseInstance") }), (instances.data?.items ?? []).map((row) => _jsx("option", { value: row.workflow_id, children: row.workflow_id }, row.workflow_id))] }), _jsx("input", { className: `${inputClass} w-full`, value: signalDraft.signal, onChange: (e) => setSignalDraft((v) => ({ ...v, signal: e.target.value })) }), _jsx("textarea", { className: `${inputClass} min-h-32 w-full font-mono text-xs`, value: signalDraft.payload, onChange: (e) => setSignalDraft((v) => ({ ...v, payload: e.target.value })) }), _jsxs("button", { type: "button", className: "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50", disabled: !selected || !signalDraft.signal.trim() || signal.isPending, onClick: () => signal.mutate(), children: [_jsx(Send, { className: "h-4 w-4" }), t("page.workflows.sendSignal")] }), _jsxs("button", { type: "button", className: "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)]", disabled: !selected, onClick: () => setSignalDraft((v) => ({ ...v, signal: "pause" })), children: [_jsx(PauseCircle, { className: "h-4 w-4" }), "pause"] })] }) })] })) : null, module === "ops" ? (_jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]", children: [_jsxs(Card, { title: t("page.workflows.opsPlan"), actions: _jsx(RefreshButton, { onClick: invalidate }), children: [opsPlan.isLoading ? _jsx(LoadingBlock, {}) : null, opsPlan.error ? _jsx(ErrorBlock, { message: opsPlan.error.message }) : null, opsPlan.data ? (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-3", children: [_jsx(Summary, { label: t("page.workflows.opsHealth"), value: opsPlan.data.health?.score ?? 0 }), _jsx(Summary, { label: t("page.workflows.opsGrade"), value: opsPlan.data.health?.grade ?? "-" }), _jsx(Summary, { label: t("page.workflows.opsTasks"), value: opsPlan.data.task_candidates?.length ?? 0 })] }), _jsx("div", { className: "grid gap-2 lg:grid-cols-2", children: (opsPlan.data.commands ?? []).map((cmd) => (_jsxs("button", { type: "button", className: "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]", onClick: () => void navigator.clipboard.writeText(cmd.command), children: [_jsxs("div", { className: "flex items-center gap-2 text-sm font-semibold text-[var(--text)]", children: [_jsx(Terminal, { className: "h-4 w-4 text-[var(--brand)]" }), cmd.title] }), _jsx("p", { className: "mt-2 break-all font-mono text-xs text-[var(--muted)]", children: cmd.command })] }, cmd.id))) }), (opsPlan.data.health?.risks ?? []).length ? (_jsx("div", { className: "grid gap-2", children: (opsPlan.data.health.risks ?? []).map((risk) => (_jsxs("div", { className: "rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-[var(--text)]", children: [_jsx("span", { className: "font-semibold", children: risk.level }), " \u00B7 ", risk.message] }, risk.id))) })) : null] })) : null] }), _jsxs(Card, { title: t("page.workflows.opsActions"), children: [_jsxs("div", { className: "grid gap-2", children: [_jsx(Button, { icon: _jsx(ListChecks, { className: "h-4 w-4" }), loading: opsTasks.isPending, onClick: () => opsTasks.mutate(true), children: t("page.workflows.previewOpsTasks") }), _jsx(Button, { type: "primary", icon: _jsx(ListChecks, { className: "h-4 w-4" }), loading: opsTasks.isPending, onClick: () => opsTasks.mutate(false), children: t("page.workflows.createOpsTasks") })] }), _jsx("div", { className: "mt-4 space-y-2", children: (opsPlan.data?.task_candidates ?? []).map((task) => (_jsxs("div", { className: "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm", children: [_jsx("div", { className: "font-medium text-[var(--text)]", children: task.title }), _jsx("p", { className: "mt-1 text-xs text-[var(--muted)]", children: task.description })] }, task.id))) })] })] })) : null] }), _jsxs(Drawer, { title: detailId || t("page.workflows.instanceDetail"), open: Boolean(detailId), onClose: () => setDetailId(""), width: 640, children: [detailQ.isLoading ? _jsx(LoadingBlock, {}) : null, detailQ.data ? (_jsxs("div", { className: "space-y-4 text-sm", children: [_jsxs("div", { className: "grid gap-2 sm:grid-cols-2", children: [_jsx(Summary, { label: t("page.workflows.status"), value: String(detailQ.data.instance?.status ?? "—") }), _jsx(Summary, { label: t("page.workflows.type"), value: String(detailQ.data.instance?.type ?? "—") }), _jsx(Summary, { label: t("page.workflows.duration"), value: `${Number(detailQ.data.instance?.duration_s ?? 0)}s` }), _jsx(Summary, { label: t("page.workflows.engine"), value: String(detailQ.data.engine ?? detailQ.data.instance?.engine ?? "—") })] }), detailQ.data.dag?.steps?.length ? (_jsxs("div", { children: [_jsx(Typography.Text, { strong: true, className: "text-xs", children: t("page.workflows.dag") }), _jsx("div", { className: "mt-2", children: _jsx(WorkflowDag, { steps: detailQ.data.dag.steps, edges: detailQ.data.dag?.edges, currentStepId: detailQ.data.dag.current_step_id }) })] })) : null, detailQ.data.temporal ? (_jsxs("div", { className: "rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3", children: [_jsx(Typography.Text, { strong: true, className: "text-xs", children: t("page.workflows.temporalState") }), _jsxs(Descriptions, { column: 1, size: "small", className: "mt-2", children: [_jsx(Descriptions.Item, { label: t("page.workflows.temporalAvailable"), children: detailQ.data.temporal.available ? t("common.yes") : t("common.no") }), detailQ.data.temporal.status_name ? (_jsx(Descriptions.Item, { label: t("page.workflows.status"), children: String(detailQ.data.temporal.status_name) })) : null, detailQ.data.temporal.task_queue ? (_jsx(Descriptions.Item, { label: t("page.workflows.taskQueue"), children: String(detailQ.data.temporal.task_queue) })) : null, detailQ.data.temporal.history_length != null ? (_jsx(Descriptions.Item, { label: t("page.workflows.historyLength"), children: String(detailQ.data.temporal.history_length) })) : null, detailQ.data.temporal.reason ? (_jsx(Descriptions.Item, { label: t("page.workflows.temporalReason"), children: String(detailQ.data.temporal.reason) })) : null] })] })) : null, detailQ.data.error ? (_jsx(Typography.Paragraph, { type: "danger", className: "!mb-0 text-xs", children: detailQ.data.error })) : null, detailQ.data.result != null ? (_jsx("pre", { className: "max-h-32 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-xs", children: JSON.stringify(detailQ.data.result, null, 2) })) : null, _jsx(Typography.Text, { strong: true, className: "text-xs", children: t("page.workflows.eventTimeline") }), _jsx(Timeline, { items: (detailQ.data.events ?? []).map((evt) => ({
                                            children: (_jsxs("div", { children: [_jsx("span", { className: "font-mono text-[10px] text-[var(--muted)]", children: String(evt.ts ?? "") }), _jsx("div", { className: "font-medium", children: String(evt.event ?? evt.signal ?? "event") }), evt.status ? _jsx(Tag, { className: "mt-1", children: String(evt.status) }) : null] })),
                                        })) })] })) : null] })] })] }));
}
function Summary({ label, value }) {
    return (_jsxs("div", { className: "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3", children: [_jsx("p", { className: "text-xs text-[var(--muted)]", children: label }), _jsx("p", { className: "mt-1 truncate text-xl font-semibold text-[var(--text)]", children: value })] }));
}
function RefreshButton({ onClick }) {
    return (_jsx("button", { type: "button", className: "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]", onClick: onClick, children: _jsx(RefreshCw, { className: "h-4 w-4" }) }));
}
