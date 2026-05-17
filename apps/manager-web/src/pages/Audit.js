import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal, Space, Table, Tag, Timeline } from "antd";
import { Download, FilePlus2, Search, ShieldCheck } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";
import { WorkbenchShell } from "./shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "./shared/workbenchUi";
const EChartsDonutLazy = lazy(() => import("../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })));
const EChartsBarLazy = lazy(() => import("../components/charts/EChartsBar").then((m) => ({ default: m.EChartsBar })));
function pieToRecord(items) {
    const out = {};
    for (const row of items ?? [])
        out[row.name] = row.value;
    return out;
}
import { getProjectId, getToken } from "../lib/authStorage";
const inputClass = "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";
export function Audit() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const authed = Boolean(getToken());
    const [module, setModule] = useState("chain");
    const [q, setQ] = useState("");
    const [riskLevel, setRiskLevel] = useState("all");
    const [approvalStatus, setApprovalStatus] = useState("pending");
    const [policyDraft, setPolicyDraft] = useState({
        enabled: true,
        mode: "advisory",
        approval_threshold: 60,
        alert_threshold: 35,
        block_threshold: 90,
        notify_channels: "",
        notes: "",
    });
    const [draft, setDraft] = useState({ action: "manual.review", resource_type: "system", resource_id: "", details: "{}" });
    const [taskPreview, setTaskPreview] = useState(null);
    const state = useQuery({ queryKey: ["audit-state"], queryFn: api.auditState, enabled: authed });
    const verify = useQuery({ queryKey: ["audit-verify"], queryFn: api.auditVerify, enabled: authed });
    const summary = useQuery({ queryKey: ["audit-summary"], queryFn: api.auditSummary, enabled: authed });
    const auditChartsQ = useQuery({ queryKey: ["audit-charts"], queryFn: api.auditCharts, enabled: authed });
    const timeline = useQuery({
        queryKey: ["audit-timeline", getProjectId()],
        queryFn: () => api.auditTimeline(60, getProjectId() || undefined),
        enabled: authed && module === "events",
    });
    const events = useQuery({ queryKey: ["audit-events", q], queryFn: () => api.auditEvents(q, 1, 100), enabled: authed && module === "events" });
    const actionPolicy = useQuery({ queryKey: ["audit-action-policy"], queryFn: api.systemPagesActionPolicy, enabled: authed && module === "actions" });
    const approvals = useQuery({ queryKey: ["audit-action-approvals", approvalStatus], queryFn: () => api.systemPagesActionApprovals(approvalStatus, 100), enabled: authed && module === "actions" });
    const actionRuns = useQuery({ queryKey: ["audit-action-runs", riskLevel], queryFn: () => api.systemPagesActionRuns(100, "", "", riskLevel), enabled: authed && module === "actions" });
    useEffect(() => {
        const policy = actionPolicy.data?.policy;
        if (!policy)
            return;
        setPolicyDraft({
            enabled: Boolean(policy.enabled),
            mode: String(policy.mode || "advisory"),
            approval_threshold: Number(policy.approval_threshold ?? 60),
            alert_threshold: Number(policy.alert_threshold ?? 35),
            block_threshold: Number(policy.block_threshold ?? 90),
            notify_channels: (policy.notify_channels ?? []).join(", "),
            notes: String(policy.notes || ""),
        });
    }, [actionPolicy.data]);
    const savePolicy = useMutation({
        mutationFn: () => api.systemPagesActionPolicyUpdate({
            ...policyDraft,
            notify_channels: policyDraft.notify_channels.split(",").map((x) => x.trim()).filter(Boolean),
        }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["audit-action-policy"] });
            void qc.invalidateQueries({ queryKey: ["audit-action-runs"] });
            void qc.invalidateQueries({ queryKey: ["audit-state"] });
            void qc.invalidateQueries({ queryKey: ["audit-verify"] });
        },
    });
    const reviewApproval = useMutation({
        mutationFn: ({ id, status }) => api.systemPagesActionApprovalReview(id, { status, note: status === "approved" ? "approved in Audit console" : "rejected in Audit console" }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["audit-action-approvals"] });
            void qc.invalidateQueries({ queryKey: ["audit-state"] });
            void qc.invalidateQueries({ queryKey: ["audit-verify"] });
        },
    });
    const record = useMutation({
        mutationFn: () => {
            let details = {};
            try {
                details = JSON.parse(draft.details || "{}");
            }
            catch {
                throw new Error(t("page.audit.invalidJson"));
            }
            return api.auditRecord({
                action: draft.action,
                resource_type: draft.resource_type,
                resource_id: draft.resource_id,
                project_id: getProjectId() || "",
                details,
            });
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["audit-events"] });
            void qc.invalidateQueries({ queryKey: ["audit-summary"] });
            void qc.invalidateQueries({ queryKey: ["audit-state"] });
            void qc.invalidateQueries({ queryKey: ["audit-verify"] });
        },
    });
    const eventTask = useMutation({
        mutationFn: ({ id, dryRun }) => api.auditEventTask(id, { dry_run: dryRun, priority: "P1", assigned_to: "SecurityOps", dev_tool: "copilot" }),
        onSuccess: (data) => {
            if (data?.dry_run) {
                setTaskPreview(data.item);
            }
            else {
                void qc.invalidateQueries({ queryKey: ["tasks"] });
                void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
                void qc.invalidateQueries({ queryKey: ["audit-events"] });
            }
        },
    });
    if (!authed)
        return _jsx(NeedLogin, {});
    const refresh = () => {
        void state.refetch();
        void verify.refetch();
        void summary.refetch();
        void auditChartsQ.refetch();
        void timeline.refetch();
        void events.refetch();
        void actionPolicy.refetch();
        void approvals.refetch();
        void actionRuns.refetch();
    };
    const modules = [
        { id: "chain", label: t("page.audit.module.chain") },
        { id: "events", label: t("page.audit.module.events") },
        { id: "actions", label: t("page.audit.module.actions") },
        { id: "record", label: t("page.audit.module.record") },
    ];
    const auditActivity = useMemo(() => {
        const trend = auditChartsQ.data?.activity_trend;
        if (!trend?.days?.length)
            return null;
        return {
            categories: trend.days,
            series: (trend.series ?? []).map((s) => ({
                name: s.name === "failures" ? t("page.audit.failures") : t("page.audit.eventVolume"),
                data: s.data,
            })),
        };
    }, [auditChartsQ.data, t]);
    return (_jsx(WorkbenchShell, { title: t("page.audit.title"), description: t("page.audit.subtitle"), actions: _jsx(RefreshButton, { onClick: refresh, pending: state.isFetching || verify.isFetching || summary.isFetching || auditChartsQ.isFetching }), metrics: _jsx(WorkbenchStats, { items: [
                { label: t("page.audit.total"), value: summary.data?.total ?? 0 },
                { label: t("page.audit.failures"), value: summary.data?.failures ?? 0 },
                { label: t("page.audit.last24h"), value: summary.data?.last_24h ?? 0 },
                { label: t("page.audit.last7d"), value: summary.data?.last_7d ?? 0 },
                { label: t("page.audit.count"), value: state.data?.count ?? 0 },
            ] }), children: _jsxs("div", { className: "grid w-full gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]", children: [_jsx("aside", { className: "xl:sticky xl:top-4 xl:self-start", children: _jsx(Card, { title: t("page.audit.modules"), children: _jsx("div", { className: "grid gap-2", children: modules.map((m) => (_jsx("button", { type: "button", onClick: () => setModule(m.id), className: `rounded-xl border px-3 py-2 text-left text-sm font-medium ${module === m.id ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]" : "border-[var(--border)] text-[var(--muted-strong)]"}`, children: m.label }, m.id))) }) }) }), _jsxs("section", { className: "min-w-0 space-y-4", children: [auditActivity ? (_jsx(WorkbenchPanel, { title: t("page.audit.activityTrend"), children: _jsx(Suspense, { fallback: null, children: _jsx(EChartsBarLazy, { categories: auditActivity.categories, series: auditActivity.series, stacked: true, height: 260 }) }) })) : null, _jsxs("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-3", children: [Object.keys(pieToRecord(auditChartsQ.data?.by_action)).length ? (_jsx(WorkbenchPanel, { title: t("page.audit.byAction"), children: _jsx(Suspense, { fallback: null, children: _jsx(EChartsDonutLazy, { data: pieToRecord(auditChartsQ.data?.by_action), height: 200 }) }) })) : null, Object.keys(pieToRecord(auditChartsQ.data?.by_resource)).length ? (_jsx(WorkbenchPanel, { title: t("page.audit.byResource"), children: _jsx(Suspense, { fallback: null, children: _jsx(EChartsDonutLazy, { data: pieToRecord(auditChartsQ.data?.by_resource), height: 200 }) }) })) : null, Object.keys(pieToRecord(auditChartsQ.data?.outcome)).length ? (_jsx(WorkbenchPanel, { title: t("page.audit.outcome"), children: _jsx(Suspense, { fallback: null, children: _jsx(EChartsDonutLazy, { data: pieToRecord(auditChartsQ.data?.outcome), height: 200 }) }) })) : null] }), module === "chain" ? (_jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.8fr)]", children: [_jsxs(Card, { title: t("page.audit.chainHead"), children: [state.isLoading ? _jsx(LoadingBlock, {}) : null, state.error ? _jsx(ErrorBlock, { message: state.error.message }) : null, state.data ? (_jsxs("dl", { className: "grid gap-3 text-sm sm:grid-cols-2", children: [_jsx(Info, { label: t("page.audit.count"), value: String(state.data.count ?? 0) }), _jsx(Info, { label: "version", value: String(state.data.version ?? "-") }), _jsxs("div", { className: "sm:col-span-2", children: [_jsx("dt", { className: "text-[var(--muted)]", children: t("page.audit.prevHash") }), _jsx("dd", { className: "mt-1 break-all font-mono text-xs text-[var(--muted-strong)]", children: String(state.data.prev_hash ?? "-") })] })] })) : null] }), _jsxs(Card, { title: t("page.audit.verify"), children: [verify.isLoading ? _jsx(LoadingBlock, {}) : null, verify.error ? _jsx(ErrorBlock, { message: verify.error.message }) : null, verify.data ? (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(ShieldCheck, { className: `h-5 w-5 ${verify.data.ok ? "text-emerald-600" : "text-rose-600"}` }), _jsx("span", { className: "text-sm font-medium", children: verify.data.ok ? t("page.audit.verifyOk") : t("page.audit.verifyFail") }), _jsxs("span", { className: "text-xs text-[var(--muted)]", children: [t("page.audit.total"), ": ", verify.data.total ?? "-"] })] }), verify.data.errors?.length ? _jsx("pre", { className: "overflow-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200", children: JSON.stringify(verify.data.errors, null, 2) }) : null] })) : null] })] })) : null, module === "events" ? (_jsxs(Card, { title: t("page.audit.events"), actions: _jsxs("a", { className: "inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm", href: api.auditExportCsvUrl(), target: "_blank", rel: "noreferrer", children: [_jsx(Download, { className: "h-4 w-4" }), t("page.audit.exportCsv")] }), children: [_jsx("div", { className: "mb-4 flex gap-2", children: _jsxs("div", { className: "relative min-w-[16rem] flex-1", children: [_jsx(Search, { className: "pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--muted)]" }), _jsx("input", { className: `${inputClass} w-full pl-9`, value: q, onChange: (e) => setQ(e.target.value), placeholder: t("page.audit.searchPh") })] }) }), timeline.data?.days?.length ? (_jsxs("div", { className: "mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4", children: [_jsx("p", { className: "mb-3 text-xs font-semibold text-[var(--text)]", children: t("page.audit.timeline") }), _jsx(Timeline, { items: timeline.data.days.map((day) => ({
                                                children: (_jsxs("div", { children: [_jsxs("p", { className: "text-sm font-medium text-[var(--text)]", children: [day.date, " ", _jsxs("span", { className: "text-[var(--muted)]", children: ["(", day.count, ")"] })] }), _jsx("ul", { className: "mt-2 space-y-1 text-xs text-[var(--muted-strong)]", children: day.items.slice(0, 5).map((ev) => (_jsxs("li", { className: "font-mono", children: [String(ev.action), " \u00B7 ", String(ev.resource_type || ""), "/", String(ev.resource_id || ""), " \u00B7", " ", String(ev.username || ev.user_id || "")] }, String(ev.id)))) })] })),
                                            })) })] })) : null, events.isLoading ? _jsx(LoadingBlock, {}) : null, events.error ? _jsx(ErrorBlock, { message: events.error.message }) : null, eventTask.error ? _jsx(Alert, { className: "mb-3", type: "error", showIcon: true, message: eventTask.error.message }) : null, eventTask.data && !eventTask.data.dry_run ? _jsx(Alert, { className: "mb-3", type: "success", showIcon: true, message: t("page.audit.taskCreated") }) : null, _jsx(Table, { rowKey: (row) => String(row.id), size: "middle", loading: events.isLoading, dataSource: events.data?.items ?? [], scroll: { x: 980 }, pagination: { pageSize: 10, showSizeChanger: true }, locale: { emptyText: t("page.audit.noEvents") }, columns: [
                                        {
                                            title: t("page.audit.event"),
                                            dataIndex: "path",
                                            render: (value, row) => (_jsxs("div", { className: "min-w-[22rem]", children: [_jsx("div", { className: "font-mono text-xs font-semibold text-[var(--text)]", children: value || row.id }), _jsxs("div", { className: "mt-1 text-xs text-[var(--muted)]", children: [row.created_at, " \u00B7 ", row.username || row.user_id || "-"] })] })),
                                        },
                                        { title: t("page.audit.action"), dataIndex: "action", width: 120 },
                                        {
                                            title: t("page.audit.resource"),
                                            width: 200,
                                            render: (_, row) => _jsxs("span", { className: "font-mono text-xs", children: [row.resource_type, "/", row.resource_id] }),
                                        },
                                        {
                                            title: t("page.audit.status"),
                                            dataIndex: "status_code",
                                            width: 110,
                                            render: (value) => _jsx(Tag, { color: Number(value) >= 400 ? "red" : "success", children: value || "-" }),
                                        },
                                        {
                                            title: t("page.audit.actions"),
                                            width: 220,
                                            fixed: "right",
                                            render: (_, row) => (_jsxs(Space, { wrap: true, children: [_jsx(Button, { size: "small", loading: eventTask.isPending, onClick: () => eventTask.mutate({ id: row.id, dryRun: true }), children: t("page.audit.previewTask") }), _jsx(Button, { size: "small", type: Number(row.status_code) >= 400 ? "primary" : "default", loading: eventTask.isPending, onClick: () => eventTask.mutate({ id: row.id, dryRun: false }), children: t("page.audit.createTask") })] })),
                                        },
                                    ] })] })) : null, module === "actions" ? (_jsxs("div", { className: "space-y-4", children: [_jsxs(Card, { title: t("page.audit.actionPolicy"), actions: _jsx("button", { type: "button", className: "rounded-xl bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50", disabled: !actionPolicy.data?.editable || savePolicy.isPending, onClick: () => savePolicy.mutate(), children: t("page.audit.savePolicy") }), children: [actionPolicy.error ? _jsx(ErrorBlock, { message: actionPolicy.error.message }) : null, _jsxs("div", { className: "grid gap-3 lg:grid-cols-[10rem_10rem_repeat(3,8rem)_1fr]", children: [_jsxs("label", { className: "flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]", children: [_jsx("input", { type: "checkbox", checked: policyDraft.enabled, onChange: (e) => setPolicyDraft((v) => ({ ...v, enabled: e.target.checked })) }), t("page.audit.policyEnabled")] }), _jsxs("select", { className: inputClass, value: policyDraft.mode, onChange: (e) => setPolicyDraft((v) => ({ ...v, mode: e.target.value })), children: [_jsx("option", { value: "advisory", children: t("page.audit.policyMode.advisory") }), _jsx("option", { value: "enforce", children: t("page.audit.policyMode.enforce") })] }), _jsx(NumberInput, { label: t("page.audit.alertThreshold"), value: policyDraft.alert_threshold, onChange: (value) => setPolicyDraft((v) => ({ ...v, alert_threshold: value })) }), _jsx(NumberInput, { label: t("page.audit.approvalThreshold"), value: policyDraft.approval_threshold, onChange: (value) => setPolicyDraft((v) => ({ ...v, approval_threshold: value })) }), _jsx(NumberInput, { label: t("page.audit.blockThreshold"), value: policyDraft.block_threshold, onChange: (value) => setPolicyDraft((v) => ({ ...v, block_threshold: value })) }), _jsx("input", { className: inputClass, value: policyDraft.notify_channels, onChange: (e) => setPolicyDraft((v) => ({ ...v, notify_channels: e.target.value })), placeholder: t("page.audit.notifyChannelsPh") })] }), _jsx("textarea", { className: `${inputClass} mt-3 min-h-20 w-full`, value: policyDraft.notes, onChange: (e) => setPolicyDraft((v) => ({ ...v, notes: e.target.value })), placeholder: t("page.audit.policyNotesPh") }), savePolicy.data ? _jsx("p", { className: "mt-2 text-sm text-emerald-600", children: t("page.audit.policySaved") }) : null, savePolicy.error ? _jsx(ErrorBlock, { message: savePolicy.error.message }) : null] }), _jsxs(Card, { title: t("page.audit.approvalQueue"), actions: _jsxs("select", { className: inputClass, value: approvalStatus, onChange: (e) => setApprovalStatus(e.target.value), children: [_jsx("option", { value: "pending", children: t("page.audit.approvalStatus.pending") }), _jsx("option", { value: "approved", children: t("page.audit.approvalStatus.approved") }), _jsx("option", { value: "rejected", children: t("page.audit.approvalStatus.rejected") }), _jsx("option", { value: "all", children: t("page.audit.riskAll") })] }), children: [approvals.error ? _jsx(ErrorBlock, { message: approvals.error.message }) : null, _jsxs("div", { className: "mb-3 grid gap-3 md:grid-cols-3", children: [_jsx(Metric, { label: t("page.audit.pendingApprovals"), value: approvals.data?.summary?.pending ?? 0 }), _jsx(Metric, { label: t("page.audit.approvalTotal"), value: approvals.data?.total ?? 0 }), _jsx(Metric, { label: t("page.audit.approvalEditable"), value: approvals.data?.editable ? "on" : "off" })] }), _jsx("div", { className: "grid gap-3 lg:grid-cols-2", children: (approvals.data?.items ?? []).slice(0, 8).map((item) => (_jsxs("article", { className: "rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4", children: [_jsxs("div", { className: "flex flex-wrap items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold text-[var(--text)]", children: item.module_name || item.module_id }), _jsxs("p", { className: "mt-1 truncate font-mono text-xs text-[var(--muted)]", children: [item.id, " \u00B7 ", item.run_id] })] }), _jsx(RiskBadge, { level: String(item.risk?.level || "low"), score: Number(item.risk?.score ?? 0) })] }), _jsx("p", { className: "mt-3 text-sm text-[var(--muted-strong)]", children: item.action_name || item.action_id }), _jsxs("p", { className: "mt-1 text-xs text-[var(--muted)]", children: [item.policy?.decision || "-", " \u00B7 ", item.reason] }), _jsxs("div", { className: "mt-3 flex flex-wrap gap-2", children: [_jsx("span", { className: "rounded-full bg-[var(--surface)] px-2 py-1 text-xs text-[var(--muted-strong)]", children: item.status }), item.status === "pending" ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", disabled: !approvals.data?.editable || reviewApproval.isPending, className: "rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50", onClick: () => reviewApproval.mutate({ id: item.id, status: "approved" }), children: t("page.audit.approve") }), _jsx("button", { type: "button", disabled: !approvals.data?.editable || reviewApproval.isPending, className: "rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-600 disabled:opacity-50", onClick: () => reviewApproval.mutate({ id: item.id, status: "rejected" }), children: t("page.audit.reject") })] })) : null] })] }, item.id))) }), !approvals.isLoading && !(approvals.data?.items ?? []).length ? (_jsx("div", { className: "rounded-2xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]", children: t("page.audit.noApprovals") })) : null] }), _jsxs(Card, { title: t("page.audit.actionRuns"), actions: _jsxs("select", { className: inputClass, value: riskLevel, onChange: (e) => setRiskLevel(e.target.value), children: [_jsx("option", { value: "all", children: t("page.audit.riskAll") }), _jsx("option", { value: "critical", children: t("page.audit.risk.critical") }), _jsx("option", { value: "high", children: t("page.audit.risk.high") }), _jsx("option", { value: "medium", children: t("page.audit.risk.medium") }), _jsx("option", { value: "low", children: t("page.audit.risk.low") })] }), children: [actionRuns.isLoading ? _jsx(LoadingBlock, {}) : null, actionRuns.error ? _jsx(ErrorBlock, { message: actionRuns.error.message }) : null, _jsxs("div", { className: "mb-4 grid gap-3 md:grid-cols-5", children: [_jsx(Metric, { label: t("page.audit.actionRunTotal"), value: actionRuns.data?.total ?? 0 }), _jsx(Metric, { label: t("page.audit.actionRunExecuted"), value: actionRuns.data?.summary?.executed ?? 0 }), _jsx(Metric, { label: t("page.audit.actionRunTypes"), value: Object.keys(actionRuns.data?.summary?.by_type ?? {}).length }), _jsx(Metric, { label: t("page.audit.actionRunModules"), value: Object.keys(actionRuns.data?.summary?.by_module ?? {}).length }), _jsx(Metric, { label: t("page.audit.highestRisk"), value: actionRuns.data?.summary?.highest_risk ?? 0 })] }), _jsx("div", { className: "overflow-auto rounded-2xl border border-[var(--border)]", children: _jsxs("div", { className: "min-w-[70rem]", children: [_jsxs("div", { className: "grid grid-cols-[1.1fr_1fr_8rem_8rem_9rem_1.4fr] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold text-[var(--muted)]", children: [_jsx("span", { children: t("page.audit.run") }), _jsx("span", { children: t("page.audit.moduleName") }), _jsx("span", { children: t("page.audit.action") }), _jsx("span", { children: t("page.audit.riskScore") }), _jsx("span", { children: t("page.audit.result") }), _jsx("span", { children: t("page.audit.evidence") })] }), (actionRuns.data?.items ?? []).map((row) => {
                                                        const chain = row.evidence?.audit_chain;
                                                        const event = row.evidence?.event;
                                                        return (_jsxs("div", { className: "grid grid-cols-[1.1fr_1fr_8rem_8rem_9rem_1.4fr] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs last:border-0", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate font-mono font-semibold text-[var(--text)]", children: row.id }), _jsx("p", { className: "truncate text-[var(--muted)]", children: row.created_at })] }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate font-semibold text-[var(--text)]", children: row.module_name || row.module_id }), _jsx("p", { className: "truncate font-mono text-[var(--muted)]", children: row.capability || "-" })] }), _jsx("span", { className: "truncate text-[var(--muted-strong)]", children: row.action_name || row.action_id }), _jsx(RiskBadge, { level: String(row.risk?.level || "low"), score: Number(row.risk?.score ?? 0) }), _jsx("span", { className: row.executed ? "text-emerald-600" : "text-amber-600", children: row.result_type || "-" }), _jsxs("div", { className: "min-w-0 space-y-1", children: [_jsxs("p", { className: "truncate font-mono text-[var(--muted-strong)]", children: ["chain: ", chain?.hash ? String(chain.hash).slice(0, 18) : chain?.error || "-"] }), _jsxs("p", { className: "truncate font-mono text-[var(--muted-strong)]", children: ["event: ", event?.id || event?.error || "-"] }), _jsx("p", { className: "truncate text-[var(--muted)]", children: (row.risk?.recommendations ?? []).slice(0, 1).join(" ") })] })] }, row.id));
                                                    }), !actionRuns.isLoading && !(actionRuns.data?.items ?? []).length ? (_jsx("div", { className: "px-4 py-10 text-center text-sm text-[var(--muted)]", children: t("page.audit.noActionRuns") })) : null] }) })] })] })) : null, module === "record" ? (_jsxs(Card, { title: t("page.audit.record"), children: [_jsxs("div", { className: "grid gap-3 lg:grid-cols-3", children: [_jsx("input", { className: inputClass, value: draft.action, onChange: (e) => setDraft((v) => ({ ...v, action: e.target.value })), placeholder: "action" }), _jsx("input", { className: inputClass, value: draft.resource_type, onChange: (e) => setDraft((v) => ({ ...v, resource_type: e.target.value })), placeholder: "resource_type" }), _jsx("input", { className: inputClass, value: draft.resource_id, onChange: (e) => setDraft((v) => ({ ...v, resource_id: e.target.value })), placeholder: "resource_id" }), _jsx("textarea", { className: `${inputClass} min-h-36 font-mono text-xs lg:col-span-3`, value: draft.details, onChange: (e) => setDraft((v) => ({ ...v, details: e.target.value })) })] }), _jsxs("button", { type: "button", className: "mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50", disabled: !draft.action.trim() || record.isPending, onClick: () => record.mutate(), children: [_jsx(FilePlus2, { className: "h-4 w-4" }), t("page.audit.saveRecord")] }), record.error ? _jsx(ErrorBlock, { message: record.error.message }) : null, record.data ? _jsx("pre", { className: "mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100", children: JSON.stringify(record.data, null, 2) }) : null] })) : null] }), _jsx(Modal, { open: Boolean(taskPreview), title: t("page.audit.taskPreview"), onCancel: () => setTaskPreview(null), footer: _jsx(Button, { type: "primary", onClick: () => setTaskPreview(null), children: t("common.close") }), width: 760, children: taskPreview ? (_jsxs("div", { className: "space-y-3", children: [_jsx(Alert, { type: "info", showIcon: true, message: taskPreview.title }), _jsx("pre", { className: "max-h-96 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100", children: JSON.stringify(taskPreview, null, 2) })] })) : null })] }) }));
}
function Metric({ label, value }) {
    return (_jsxs("div", { className: "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3", children: [_jsx("p", { className: "text-xs text-[var(--muted)]", children: label }), _jsx("p", { className: "mt-1 truncate text-xl font-semibold text-[var(--text)]", children: value })] }));
}
function Info({ label, value }) {
    return (_jsxs("div", { className: "rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3", children: [_jsx("dt", { className: "text-xs text-[var(--muted)]", children: label }), _jsx("dd", { className: "mt-1 font-mono text-xs text-[var(--text)]", children: value })] }));
}
function RiskBadge({ level, score }) {
    const cls = level === "critical"
        ? "bg-rose-600 text-white"
        : level === "high"
            ? "bg-orange-500/15 text-orange-700 dark:text-orange-200"
            : level === "medium"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-200"
                : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200";
    return (_jsxs("span", { className: `inline-flex w-fit items-center rounded-full px-2 py-0.5 font-semibold ${cls}`, children: [level, " \u00B7 ", score] }));
}
function NumberInput({ label, value, onChange }) {
    return (_jsxs("label", { className: "grid gap-1", children: [_jsx("span", { className: "text-[11px] text-[var(--muted)]", children: label }), _jsx("input", { className: inputClass, type: "number", min: 0, max: 100, value: value, onChange: (e) => onChange(Math.max(0, Math.min(100, Number(e.target.value || 0)))) })] }));
}
