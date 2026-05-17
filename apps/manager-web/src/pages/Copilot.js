import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Space, Table, Tag } from "antd";
import { ClipboardCheck, Loader2, Plus } from "lucide-react";
import { CopilotChatPanel } from "../components/ai/CopilotChatPanel";
import { Card } from "../components/Card";
import { MarkdownView } from "../components/MarkdownView";
import { NeedLogin } from "../components/PageStates";
import { WorkbenchShell } from "./shared/WorkbenchShell";
import { api } from "../lib/api";
import { formatCopilotResponse } from "../lib/copilotFormat";
import { getProjectId, getToken } from "../lib/authStorage";
const STORAGE_KEY = "sop-copilot-transcript-v1";
function loadTurns() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    }
    catch {
        return [];
    }
}
function saveTurns(rows) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-200)));
}
function newId(prefix) {
    return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}
export function Copilot() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const authed = Boolean(getToken());
    const [q, setQ] = useState("");
    const [sessionId, setSessionId] = useState(() => newId("cp"));
    const [runId, setRunId] = useState(() => newId("run"));
    const [withProject, setWithProject] = useState(true);
    const [turns, setTurns] = useState(() => loadTurns());
    const [planResult, setPlanResult] = useState(null);
    const [planTaskResult, setPlanTaskResult] = useState(null);
    const sessionsQuery = useQuery({ queryKey: ["copilotSessions"], queryFn: () => api.copilotSessions(100), enabled: authed });
    const sessionQuery = useQuery({
        queryKey: ["copilotSession", sessionId],
        queryFn: () => api.copilotSession(sessionId, 100),
        enabled: authed && Boolean(sessionId.trim()),
    });
    const localTurns = useMemo(() => turns.filter((x) => x.sessionId === sessionId).slice(-30), [turns, sessionId]);
    const currentTurns = useMemo(() => {
        const remote = (sessionQuery.data?.items ?? []).map((x) => ({
            ts: String(x.ts ?? ""),
            sessionId: String(x.session_id ?? sessionId),
            runId: String(x.run_id ?? ""),
            query: String(x.query ?? ""),
            response: x.response,
            error: x.error,
        }));
        return remote.length ? remote : localTurns;
    }, [localTurns, sessionId, sessionQuery.data?.items]);
    const handleTurn = (payload) => {
        setQ(payload.query);
        const next = [
            ...turns,
            {
                ts: new Date().toISOString(),
                sessionId: payload.sessionId,
                runId: payload.runId,
                query: payload.query,
                response: payload.response,
                error: payload.error,
            },
        ];
        setTurns(next);
        saveTurns(next);
        void qc.invalidateQueries({ queryKey: ["copilotSessions"] });
        void qc.invalidateQueries({ queryKey: ["copilotSession", sessionId] });
        setRunId(newId("run"));
    };
    const plan = useMutation({
        mutationFn: async (text) => {
            const context = withProject ? { project_id: getProjectId(), session_id: sessionId, run_id: runId, source: "manager-web" } : { session_id: sessionId, run_id: runId };
            return api.copilotPlan({ query: text, context, session_id: sessionId, run_id: runId });
        },
        onSuccess: (data) => {
            setPlanResult(data);
            setPlanTaskResult(null);
            void qc.invalidateQueries({ queryKey: ["copilotSessions"] });
            void qc.invalidateQueries({ queryKey: ["copilotSession", sessionId] });
        },
    });
    const planTasks = useMutation({
        mutationFn: async (dryRun) => api.copilotPlanTasks({
            query: q,
            plan: planResult?.plan ?? {},
            commands: planResult?.commands ?? [],
            dry_run: dryRun,
            priority: "P1",
            assigned_to: "Coder",
            dev_tool: "copilot",
        }),
        onSuccess: (data) => {
            setPlanTaskResult(data);
            if (!data?.dry_run) {
                void qc.invalidateQueries({ queryKey: ["tasks"] });
                void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
            }
        },
    });
    useEffect(() => {
        if (!authed)
            return;
        const prefill = sessionStorage.getItem("sop-copilot-prefill");
        if (!prefill)
            return;
        sessionStorage.removeItem("sop-copilot-prefill");
        setQ(prefill);
    }, [authed]);
    if (!authed)
        return _jsx(NeedLogin, {});
    return (_jsxs("div", { className: "w-full space-y-4", children: [_jsx(WorkbenchShell, { title: t("page.copilot.title"), description: t("copilot.intro"), actions: _jsxs("button", { type: "button", className: "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200", onClick: () => {
                        setSessionId(newId("cp"));
                        setRunId(newId("run"));
                        setPlanResult(null);
                        setPlanTaskResult(null);
                    }, children: [_jsx(Plus, { className: "h-4 w-4" }), t("copilot.newSession")] }) }), _jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]", children: [_jsxs(Card, { children: [_jsxs("div", { className: "mb-3 grid gap-2 md:grid-cols-2", children: [_jsxs("label", { className: "text-xs text-slate-500", children: [t("copilot.session"), _jsx("input", { className: "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900", value: sessionId, onChange: (e) => setSessionId(e.target.value) })] }), _jsxs("label", { className: "text-xs text-slate-500", children: ["run_id", _jsx("input", { className: "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900", value: runId, onChange: (e) => setRunId(e.target.value) })] })] }), _jsxs("label", { className: "mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300", children: [_jsx("input", { type: "checkbox", checked: withProject, onChange: (e) => setWithProject(e.target.checked) }), t("copilot.withProject")] }), _jsx(CopilotChatPanel, { module: "copilot", sessionId: sessionId, runId: runId, withProject: withProject, listHeight: 400, onMessageSent: setQ, onTurn: handleTurn }, sessionId), _jsx("div", { className: "mt-3 flex flex-wrap items-center gap-2", children: _jsxs("button", { type: "button", className: "inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-4 py-2 text-sm font-semibold text-[var(--text)] shadow-sm transition hover:bg-[var(--surface-muted)] disabled:pointer-events-none disabled:opacity-50", disabled: !q.trim() || plan.isPending, onClick: () => plan.mutate(q), children: [plan.isPending ? _jsx(Loader2, { className: "h-4 w-4 animate-spin" }) : _jsx(ClipboardCheck, { className: "h-4 w-4" }), t("copilot.plan")] }) }), plan.error ? _jsx("div", { className: "mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200", children: plan.error.message }) : null] }), _jsx(Card, { title: t("copilot.sessions"), children: _jsxs("div", { className: "space-y-2 text-sm", children: [[
                                    ...new Set([
                                        ...(sessionsQuery.data?.items ?? []).map((x) => String(x.session_id ?? "")),
                                        ...turns.map((x) => x.sessionId),
                                    ].filter(Boolean)),
                                ].slice(-20).reverse().map((sid) => (_jsx("button", { type: "button", className: `block w-full rounded-lg px-2 py-1.5 text-left font-mono text-xs ${sid === sessionId ? "bg-brand-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200"}`, onClick: () => setSessionId(sid), children: sid }, sid))), sessionsQuery.isError ? _jsx("p", { className: "text-xs text-amber-600", children: sessionsQuery.error.message }) : null] }) })] }), planResult ? (_jsxs(Card, { title: t("copilot.planResult"), children: [_jsxs("div", { className: "grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]", children: [_jsxs("div", { className: "rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3", children: [_jsx("p", { className: "text-xs text-[var(--muted)]", children: t("copilot.intent") }), _jsx("p", { className: "mt-1 text-sm font-semibold text-[var(--text)]", children: planResult.plan?.intent || "-" }), _jsx("p", { className: "mt-3 text-xs text-[var(--muted)]", children: t("copilot.target") }), _jsx("p", { className: "mt-1 break-all font-mono text-xs text-[var(--muted-strong)]", children: planResult.plan?.target || "-" }), _jsx("p", { className: "mt-3 text-sm text-[var(--muted-strong)]", children: planResult.plan?.summary || "-" })] }), _jsx("div", { className: "space-y-2", children: (planResult.commands ?? []).slice(0, 5).map((item) => (_jsxs("a", { href: String(item.target || "#/copilot").startsWith("#") ? String(item.target) : "#/copilot", className: "block rounded-xl border border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-muted)]", children: [_jsx("span", { className: "block text-sm font-semibold text-[var(--text)]", children: item.label }), _jsx("span", { className: "mt-0.5 block text-xs text-[var(--muted)]", children: item.description })] }, String(item.id)))) })] }), _jsxs("div", { className: "mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: t("copilot.executionTasks") }), _jsx("p", { className: "mt-0.5 text-xs text-[var(--muted)]", children: t("copilot.executionTasksHint") })] }), _jsxs(Space, { wrap: true, children: [_jsx(Button, { loading: planTasks.isPending, onClick: () => planTasks.mutate(true), children: t("copilot.previewTasks") }), _jsx(Button, { type: "primary", loading: planTasks.isPending, onClick: () => planTasks.mutate(false), children: t("copilot.createTasks") })] })] }), planTasks.error ? (_jsx(Alert, { className: "mt-3", type: "error", showIcon: true, message: planTasks.error.message })) : null, planTaskResult ? (_jsxs("div", { className: "mt-3", children: [_jsx(Alert, { className: "mb-3", type: planTaskResult.dry_run ? "info" : "success", showIcon: true, message: planTaskResult.dry_run
                                            ? t("copilot.taskPreviewReady", { count: planTaskResult.items?.length ?? 0 })
                                            : t("copilot.taskCreated", { count: planTaskResult.created ?? 0 }) }), _jsx(Table, { size: "small", rowKey: (row) => `${row.order}-${row.id || row.title}`, pagination: false, scroll: { x: 760 }, dataSource: planTaskResult.items ?? [], columns: [
                                            {
                                                title: t("tasks.task"),
                                                dataIndex: "title",
                                                render: (value, row) => (_jsxs("div", { children: [_jsx("div", { className: "font-medium text-[var(--text)]", children: value }), row.id ? _jsx("div", { className: "mt-1 font-mono text-xs text-[var(--muted)]", children: row.id }) : null] })),
                                            },
                                            {
                                                title: t("tasks.priority"),
                                                dataIndex: "priority",
                                                width: 100,
                                                render: (value) => _jsx(Tag, { color: value === "P0" ? "red" : value === "P1" ? "orange" : "blue", children: value }),
                                            },
                                            { title: t("tasks.assignee"), dataIndex: "assigned_to", width: 140 },
                                            { title: t("tasks.source"), dataIndex: "source", width: 150 },
                                        ] })] })) : null] })] })) : null, _jsx(Card, { title: t("copilot.transcript"), children: _jsxs("div", { className: "space-y-3", children: [currentTurns.map((turn) => (_jsxs("div", { className: "rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/50", children: [_jsxs("div", { className: "mb-1 font-mono text-[11px] text-slate-500", children: [turn.ts, " \u00B7 ", turn.runId] }), _jsx("p", { className: "whitespace-pre-wrap font-medium text-slate-900 dark:text-slate-100", children: turn.query }), turn.error ? (_jsx("p", { className: "mt-2 text-sm text-rose-600", children: turn.error })) : (_jsx("div", { className: "mt-2 max-h-80 overflow-auto rounded border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900", children: _jsx(MarkdownView, { content: formatCopilotResponse(turn.response) }) }))] }, `${turn.ts}-${turn.runId}`))), currentTurns.length === 0 ? _jsx("p", { className: "text-sm text-slate-500", children: t("copilot.empty") }) : null] }) })] }));
}
