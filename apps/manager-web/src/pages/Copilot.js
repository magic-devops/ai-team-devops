import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Loader2, Plus, Sparkles } from "lucide-react";
import { Card } from "../components/Card";
import { NeedLogin } from "../components/PageStates";
import { api } from "../lib/api";
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
    const ask = useMutation({
        mutationFn: async (text) => {
            const context = withProject ? { project_id: getProjectId(), session_id: sessionId, run_id: runId, source: "manager-web" } : { session_id: sessionId, run_id: runId };
            return api.copilotAsk(text, context, sessionId, runId);
        },
        onSuccess: (data, text) => {
            const next = [...turns, { ts: new Date().toISOString(), sessionId, runId, query: text, response: data }];
            setTurns(next);
            saveTurns(next);
            void qc.invalidateQueries({ queryKey: ["copilotSessions"] });
            void qc.invalidateQueries({ queryKey: ["copilotSession", sessionId] });
            setRunId(newId("run"));
        },
        onError: (err, text) => {
            const next = [...turns, { ts: new Date().toISOString(), sessionId, runId, query: text, error: err.message }];
            setTurns(next);
            saveTurns(next);
            void qc.invalidateQueries({ queryKey: ["copilotSessions"] });
            void qc.invalidateQueries({ queryKey: ["copilotSession", sessionId] });
            setRunId(newId("run"));
        },
    });
    if (!authed)
        return _jsx(NeedLogin, {});
    return (_jsxs("div", { className: "w-full space-y-4", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/10 text-brand-700 dark:text-brand-300", children: _jsx(Bot, { className: "h-5 w-5", strokeWidth: 1.75 }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100", children: t("page.copilot.title") }), _jsx("p", { className: "text-sm text-slate-600 dark:text-slate-400", children: t("copilot.intro") })] })] }), _jsxs("button", { type: "button", className: "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200", onClick: () => {
                            setSessionId(newId("cp"));
                            setRunId(newId("run"));
                        }, children: [_jsx(Plus, { className: "h-4 w-4" }), t("copilot.newSession")] })] }), _jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]", children: [_jsxs(Card, { children: [_jsxs("div", { className: "mb-3 grid gap-2 md:grid-cols-2", children: [_jsxs("label", { className: "text-xs text-slate-500", children: [t("copilot.session"), _jsx("input", { className: "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900", value: sessionId, onChange: (e) => setSessionId(e.target.value) })] }), _jsxs("label", { className: "text-xs text-slate-500", children: ["run_id", _jsx("input", { className: "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900", value: runId, onChange: (e) => setRunId(e.target.value) })] })] }), _jsxs("label", { className: "mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300", children: [_jsx("input", { type: "checkbox", checked: withProject, onChange: (e) => setWithProject(e.target.checked) }), t("copilot.withProject")] }), _jsx("textarea", { className: "min-h-[140px] w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 shadow-inner outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100", rows: 5, placeholder: t("copilot.placeholder"), value: q, onChange: (e) => setQ(e.target.value) }), _jsx("div", { className: "mt-3 flex flex-wrap items-center gap-2", children: _jsxs("button", { type: "button", className: "inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-50", disabled: !q.trim() || ask.isPending, onClick: () => ask.mutate(q), children: [ask.isPending ? _jsx(Loader2, { className: "h-4 w-4 animate-spin" }) : _jsx(Sparkles, { className: "h-4 w-4" }), t("copilot.ask")] }) }), ask.error ? _jsx("div", { className: "mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200", children: ask.error.message }) : null] }), _jsx(Card, { title: t("copilot.sessions"), children: _jsxs("div", { className: "space-y-2 text-sm", children: [[
                                    ...new Set([
                                        ...(sessionsQuery.data?.items ?? []).map((x) => String(x.session_id ?? "")),
                                        ...turns.map((x) => x.sessionId),
                                    ].filter(Boolean)),
                                ].slice(-20).reverse().map((sid) => (_jsx("button", { type: "button", className: `block w-full rounded-lg px-2 py-1.5 text-left font-mono text-xs ${sid === sessionId ? "bg-brand-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200"}`, onClick: () => setSessionId(sid), children: sid }, sid))), sessionsQuery.isError ? _jsx("p", { className: "text-xs text-amber-600", children: sessionsQuery.error.message }) : null] }) })] }), _jsx(Card, { title: t("copilot.transcript"), children: _jsxs("div", { className: "space-y-3", children: [currentTurns.map((turn) => (_jsxs("div", { className: "rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/50", children: [_jsxs("div", { className: "mb-1 font-mono text-[11px] text-slate-500", children: [turn.ts, " \u00B7 ", turn.runId] }), _jsx("p", { className: "whitespace-pre-wrap font-medium text-slate-900 dark:text-slate-100", children: turn.query }), _jsx("pre", { className: "mt-2 max-h-80 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100", children: JSON.stringify(turn.response ?? turn.error, null, 2) })] }, `${turn.ts}-${turn.runId}`))), currentTurns.length === 0 ? _jsx("p", { className: "text-sm text-slate-500", children: t("copilot.empty") }) : null] }) })] }));
}
