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
  const [planResult, setPlanResult] = useState<any>(null);
  const [planTaskResult, setPlanTaskResult] = useState<any>(null);
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

  const handleTurn = (payload: {
    query: string;
    response?: unknown;
    error?: string;
    sessionId: string;
    runId: string;
  }) => {
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
    mutationFn: async (text: string) => {
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
    mutationFn: async (dryRun: boolean) =>
      api.copilotPlanTasks({
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
    if (!authed) return;
    const prefill = sessionStorage.getItem("sop-copilot-prefill");
    if (!prefill) return;
    sessionStorage.removeItem("sop-copilot-prefill");
    setQ(prefill);
  }, [authed]);

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={t("page.copilot.title")}
        description={t("copilot.intro")}
        actions={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => {
              setSessionId(newId("cp"));
              setRunId(newId("run"));
              setPlanResult(null);
              setPlanTaskResult(null);
            }}
          >
            <Plus className="h-4 w-4" />
            {t("copilot.newSession")}
          </button>
        }
      />

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

          <CopilotChatPanel
            key={sessionId}
            module="copilot"
            sessionId={sessionId}
            runId={runId}
            withProject={withProject}
            listHeight={400}
            onMessageSent={setQ}
            onTurn={handleTurn}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-4 py-2 text-sm font-semibold text-[var(--text)] shadow-sm transition hover:bg-[var(--surface-muted)] disabled:pointer-events-none disabled:opacity-50"
              disabled={!q.trim() || plan.isPending}
              onClick={() => plan.mutate(q)}
            >
              {plan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              {t("copilot.plan")}
            </button>
          </div>
          
          {plan.error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{(plan.error as Error).message}</div> : null}
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

      {planResult ? (
        <Card title={t("copilot.planResult")}>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <p className="text-xs text-[var(--muted)]">{t("copilot.intent")}</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text)]">{planResult.plan?.intent || "-"}</p>
              <p className="mt-3 text-xs text-[var(--muted)]">{t("copilot.target")}</p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--muted-strong)]">{planResult.plan?.target || "-"}</p>
              <p className="mt-3 text-sm text-[var(--muted-strong)]">{planResult.plan?.summary || "-"}</p>
            </div>
            <div className="space-y-2">
              {(planResult.commands ?? []).slice(0, 5).map((item: any) => (
                <a key={String(item.id)} href={String(item.target || "#/copilot").startsWith("#") ? String(item.target) : "#/copilot"} className="block rounded-xl border border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-muted)]">
                  <span className="block text-sm font-semibold text-[var(--text)]">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">{item.description}</span>
                </a>
              ))}
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{t("copilot.executionTasks")}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{t("copilot.executionTasksHint")}</p>
              </div>
              <Space wrap>
                <Button loading={planTasks.isPending} onClick={() => planTasks.mutate(true)}>
                  {t("copilot.previewTasks")}
                </Button>
                <Button type="primary" loading={planTasks.isPending} onClick={() => planTasks.mutate(false)}>
                  {t("copilot.createTasks")}
                </Button>
              </Space>
            </div>
            {planTasks.error ? (
              <Alert className="mt-3" type="error" showIcon message={(planTasks.error as Error).message} />
            ) : null}
            {planTaskResult ? (
              <div className="mt-3">
                <Alert
                  className="mb-3"
                  type={planTaskResult.dry_run ? "info" : "success"}
                  showIcon
                  message={
                    planTaskResult.dry_run
                      ? t("copilot.taskPreviewReady", { count: planTaskResult.items?.length ?? 0 })
                      : t("copilot.taskCreated", { count: planTaskResult.created ?? 0 })
                  }
                />
                <Table
                  size="small"
                  rowKey={(row: any) => `${row.order}-${row.id || row.title}`}
                  pagination={false}
                  scroll={{ x: 760 }}
                  dataSource={planTaskResult.items ?? []}
                  columns={[
                    {
                      title: t("tasks.task"),
                      dataIndex: "title",
                      render: (value: string, row: any) => (
                        <div>
                          <div className="font-medium text-[var(--text)]">{value}</div>
                          {row.id ? <div className="mt-1 font-mono text-xs text-[var(--muted)]">{row.id}</div> : null}
                        </div>
                      ),
                    },
                    {
                      title: t("tasks.priority"),
                      dataIndex: "priority",
                      width: 100,
                      render: (value: string) => <Tag color={value === "P0" ? "red" : value === "P1" ? "orange" : "blue"}>{value}</Tag>,
                    },
                    { title: t("tasks.assignee"), dataIndex: "assigned_to", width: 140 },
                    { title: t("tasks.source"), dataIndex: "source", width: 150 },
                  ]}
                />
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card title={t("copilot.transcript")}>
        <div className="space-y-3">
          {currentTurns.map((turn) => (
            <div key={`${turn.ts}-${turn.runId}`} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/50">
              <div className="mb-1 font-mono text-[11px] text-slate-500">{turn.ts} · {turn.runId}</div>
              <p className="whitespace-pre-wrap font-medium text-slate-900 dark:text-slate-100">{turn.query}</p>
              {turn.error ? (
                <p className="mt-2 text-sm text-rose-600">{turn.error}</p>
              ) : (
                <div className="mt-2 max-h-80 overflow-auto rounded border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <MarkdownView content={formatCopilotResponse(turn.response)} />
                </div>
              )}
            </div>
          ))}
          {currentTurns.length === 0 ? <p className="text-sm text-slate-500">{t("copilot.empty")}</p> : null}
        </div>
      </Card>
    </div>
  );
}
