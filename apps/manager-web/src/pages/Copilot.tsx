import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Loader2, Plus, Sparkles } from "lucide-react";
import { Card } from "../components/Card";
import { NeedLogin } from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";

type Turn = { ts: string; sessionId: string; runId: string; query: string; response?: unknown; error?: string };
const STORAGE_KEY = "sop-copilot-transcript-v1";

function loadTurns(): Turn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
}

function saveTurns(rows: Turn[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-200)));
}

function newId(prefix: string) {
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
  const [turns, setTurns] = useState<Turn[]>(() => loadTurns());
  const sessionsQuery = useQuery({ queryKey: ["copilotSessions"], queryFn: () => api.copilotSessions(100), enabled: authed });
  const sessionQuery = useQuery({
    queryKey: ["copilotSession", sessionId],
    queryFn: () => api.copilotSession(sessionId, 100),
    enabled: authed && Boolean(sessionId.trim()),
  });
  const localTurns = useMemo(() => turns.filter((x) => x.sessionId === sessionId).slice(-30), [turns, sessionId]);
  const currentTurns = useMemo(() => {
    const remote = (sessionQuery.data?.items ?? []).map((x: any) => ({
      ts: String(x.ts ?? ""),
      sessionId: String(x.session_id ?? sessionId),
      runId: String(x.run_id ?? ""),
      query: String(x.query ?? ""),
      response: x.response,
      error: x.error,
    })) as Turn[];
    return remote.length ? remote : localTurns;
  }, [localTurns, sessionId, sessionQuery.data?.items]);

  const ask = useMutation({
    mutationFn: async (text: string) => {
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
      const next = [...turns, { ts: new Date().toISOString(), sessionId, runId, query: text, error: (err as Error).message }];
      setTurns(next);
      saveTurns(next);
      void qc.invalidateQueries({ queryKey: ["copilotSessions"] });
      void qc.invalidateQueries({ queryKey: ["copilotSession", sessionId] });
      setRunId(newId("run"));
    },
  });

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/10 text-brand-700 dark:text-brand-300">
            <Bot className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("page.copilot.title")}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">{t("copilot.intro")}</p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          onClick={() => {
            setSessionId(newId("cp"));
            setRunId(newId("run"));
          }}
        >
          <Plus className="h-4 w-4" />
          {t("copilot.newSession")}
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card>
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <label className="text-xs text-slate-500">
              {t("copilot.session")}
              <input className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
            </label>
            <label className="text-xs text-slate-500">
              run_id
              <input className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900" value={runId} onChange={(e) => setRunId(e.target.value)} />
            </label>
          </div>
          <label className="mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={withProject} onChange={(e) => setWithProject(e.target.checked)} />
            {t("copilot.withProject")}
          </label>
          <textarea
            className="min-h-[140px] w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 shadow-inner outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            rows={5}
            placeholder={t("copilot.placeholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-50"
              disabled={!q.trim() || ask.isPending}
              onClick={() => ask.mutate(q)}
            >
              {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t("copilot.ask")}
            </button>
          </div>
          {ask.error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{(ask.error as Error).message}</div> : null}
        </Card>

        <Card title={t("copilot.sessions")}>
          <div className="space-y-2 text-sm">
            {[
              ...new Set([
                ...(sessionsQuery.data?.items ?? []).map((x: any) => String(x.session_id ?? "")),
                ...turns.map((x) => x.sessionId),
              ].filter(Boolean)),
            ].slice(-20).reverse().map((sid) => (
              <button key={sid} type="button" className={`block w-full rounded-lg px-2 py-1.5 text-left font-mono text-xs ${sid === sessionId ? "bg-brand-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200"}`} onClick={() => setSessionId(sid)}>{sid}</button>
            ))}
            {sessionsQuery.isError ? <p className="text-xs text-amber-600">{(sessionsQuery.error as Error).message}</p> : null}
          </div>
        </Card>
      </div>

      <Card title={t("copilot.transcript")}>
        <div className="space-y-3">
          {currentTurns.map((turn) => (
            <div key={`${turn.ts}-${turn.runId}`} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/50">
              <div className="mb-1 font-mono text-[11px] text-slate-500">{turn.ts} · {turn.runId}</div>
              <p className="whitespace-pre-wrap font-medium text-slate-900 dark:text-slate-100">{turn.query}</p>
              <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(turn.response ?? turn.error, null, 2)}</pre>
            </div>
          ))}
          {currentTurns.length === 0 ? <p className="text-sm text-slate-500">{t("copilot.empty")}</p> : null}
        </div>
      </Card>
    </div>
  );
}
