import type { ReactNode } from "react";
import { Activity, FileText, ServerCog, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";

const inputClass = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";

type LogFilter = {
  name: string;
  level: string;
  q: string;
  limit: string;
};

type TraceFilter = {
  run_id: string;
  trace_id: string;
  correlation_id: string;
  limit: string;
};

type Props = {
  module: "runtime" | "observability";
  health: any;
  opsObservability: any;
  opsLogs: any;
  opsTraceSummary: any;
  healthOk: boolean;
  logFilter: LogFilter;
  traceFilter: TraceFilter;
  setLogFilter: (next: LogFilter) => void;
  setTraceFilter: (next: TraceFilter) => void;
};

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <dt className="text-[11px] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 truncate font-mono text-xs text-[var(--muted-strong)]">{value}</dd>
    </div>
  );
}

function SettingLink({ href, title, body, icon, external = false }: { href: string; title: string; body: string; icon: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      className="group flex min-h-32 flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-sm hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]"
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">{icon}</span>
      <span>
        <span className="mt-3 block text-sm font-semibold text-[var(--text)]">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{body}</span>
      </span>
    </a>
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "warn" | "danger"; label: string }) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200"
        : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function ErrorLine({ message }: { message: string }) {
  return <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">{message}</div>;
}

function MetricBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

function logLevelClass(level: string): string {
  if (level === "ERROR") return "font-semibold text-rose-300";
  if (level === "WARNING") return "font-semibold text-amber-300";
  if (level === "DEBUG") return "font-semibold text-sky-300";
  return "font-semibold text-emerald-300";
}

function formatBytes(value: unknown): string {
  const n = Number(value || 0);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function SettingsRuntimePanel({ module, health, opsObservability, opsLogs, opsTraceSummary, healthOk, logFilter, traceFilter, setLogFilter, setTraceFilter }: Props) {
  const { t } = useTranslation();

  return (
    <Card
      title={module === "observability" ? t("page.settings.logsTitle") : t("page.settings.runtimeCard")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]"
            onClick={() => {
              void health.refetch();
              void opsObservability.refetch();
              void opsLogs.refetch();
              void opsTraceSummary.refetch();
            }}
          >
            {t("common.refresh")}
          </button>
          <StatusPill tone={healthOk ? "ok" : health.isError ? "danger" : "warn"} label={healthOk ? "OK" : health.isError ? "ERR" : "..."} />
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Info label={t("page.settings.manager")} value={healthOk ? "online" : health.isError ? "error" : t("common.loading")} />
        <Info label={t("page.settings.version")} value={String(health.data?.version ?? "-")} />
        <Info label={t("page.settings.apiBase")} value={window.location.origin} />
      </div>
      {health.isError ? <ErrorLine message={(health.error as Error).message} /> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SettingLink href="/api/v1/health" icon={<ServerCog className="h-5 w-5" />} title={t("page.settings.healthTitle")} body={t("page.settings.healthDesc")} external />
        <SettingLink href="/metrics" icon={<SlidersHorizontal className="h-5 w-5" />} title={t("page.settings.metricsTitle")} body={t("page.settings.metricsDesc")} external />
        <SettingLink href="/api/v1/events" icon={<Activity className="h-5 w-5" />} title={t("page.settings.eventsTitle")} body={t("page.settings.eventsDesc")} external />
        <SettingLink href="/api/v1/system/ops/observability" icon={<FileText className="h-5 w-5" />} title={t("page.settings.logsTitle")} body={t("page.settings.logsDesc")} external />
      </div>
      <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.traceCard")}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.settings.traceDesc")}</p>
          </div>
          <StatusPill tone={opsTraceSummary.data?.root_cause?.risk_level === "high" ? "danger" : opsTraceSummary.data?.root_cause?.risk_level === "medium" ? "warn" : "ok"} label={String(opsTraceSummary.data?.root_cause?.risk_level || "trace")} />
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_6rem]">
          <input className={inputClass} value={traceFilter.run_id} onChange={(e) => setTraceFilter({ ...traceFilter, run_id: e.target.value })} placeholder={t("page.settings.traceRunPh")} />
          <input className={inputClass} value={traceFilter.trace_id} onChange={(e) => setTraceFilter({ ...traceFilter, trace_id: e.target.value })} placeholder={t("page.settings.traceIdPh")} />
          <input className={inputClass} value={traceFilter.correlation_id} onChange={(e) => setTraceFilter({ ...traceFilter, correlation_id: e.target.value })} placeholder={t("page.settings.correlationPh")} />
          <input className={inputClass} value={traceFilter.limit} onChange={(e) => setTraceFilter({ ...traceFilter, limit: e.target.value })} inputMode="numeric" />
          <button type="button" className="rounded-xl bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={opsTraceSummary.isFetching} onClick={() => void opsTraceSummary.refetch()}>
            {t("common.search")}
          </button>
        </div>
        {opsTraceSummary.isError ? <ErrorLine message={(opsTraceSummary.error as Error).message} /> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <MetricBox label={t("page.settings.traceFailedRuns")} value={opsTraceSummary.data?.summary?.failed_runs ?? 0} />
          <MetricBox label={t("page.settings.traceSlowLlm")} value={opsTraceSummary.data?.summary?.slow_llm_calls ?? 0} />
          <MetricBox label={t("page.settings.traceDataJobs")} value={opsTraceSummary.data?.summary?.data_jobs ?? 0} />
          <MetricBox label={t("page.settings.traceAudit")} value={opsTraceSummary.data?.summary?.audit_entries ?? 0} />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="overflow-hidden rounded-xl border border-[var(--border)]">
            {(opsTraceSummary.data?.root_cause_navigation || []).map((node: any) => (
              <a key={`${node.type}-${node.id}`} href={node.link || "#"} className="grid grid-cols-[7rem_minmax(0,1fr)_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs last:border-0 hover:bg-[var(--surface-muted)]">
                <span className="font-mono text-[var(--brand)]">{node.type}</span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[var(--text)]">{node.title}</span>
                  <span className="mt-1 block truncate text-[var(--muted)]">{node.detail || node.timestamp || node.id}</span>
                </span>
                <span className="text-right text-[var(--muted-strong)]">{node.status || "-"}</span>
              </a>
            ))}
            {!opsTraceSummary.data?.root_cause_navigation?.length ? <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.traceEmpty")}</div> : null}
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.traceRootCause")}</p>
            <div className="mt-3 space-y-2">
              {(opsTraceSummary.data?.root_cause?.likely_causes || []).map((cause: string) => (
                <p key={cause} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted-strong)]">{cause}</p>
              ))}
              {!opsTraceSummary.data?.root_cause?.likely_causes?.length ? <p className="text-xs text-[var(--muted)]">{t("page.settings.traceNoCause")}</p> : null}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <MetricBox label={t("page.settings.logFiles")} value={opsObservability.data?.logs?.length ?? 0} />
            <MetricBox label={t("page.settings.eventTotal")} value={opsObservability.data?.events?.total ?? 0} />
            <MetricBox label={t("page.settings.doctorFailed")} value={opsObservability.data?.doctor?.failed ?? 0} />
            <MetricBox label={t("page.settings.logReturned")} value={opsLogs.data?.total ?? 0} />
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-40 flex-1 text-xs font-medium text-[var(--muted)]">
                {t("page.settings.logFile")}
                <select className={`${inputClass} mt-1`} value={logFilter.name} onChange={(e) => setLogFilter({ ...logFilter, name: e.target.value })}>
                  {(opsObservability.data?.logs || [{ name: "sop.app.log" }]).map((log: any) => (
                    <option key={log.name} value={log.name}>{log.name}</option>
                  ))}
                </select>
              </label>
              <label className="w-28 text-xs font-medium text-[var(--muted)]">
                {t("page.settings.level")}
                <select className={`${inputClass} mt-1`} value={logFilter.level} onChange={(e) => setLogFilter({ ...logFilter, level: e.target.value })}>
                  <option value="">{t("page.settings.allLevels")}</option>
                  {["INFO", "WARNING", "ERROR", "DEBUG"].map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                </select>
              </label>
              <label className="w-24 text-xs font-medium text-[var(--muted)]">
                {t("page.settings.limit")}
                <input className={`${inputClass} mt-1`} value={logFilter.limit} onChange={(e) => setLogFilter({ ...logFilter, limit: e.target.value })} inputMode="numeric" />
              </label>
              <label className="min-w-56 flex-1 text-xs font-medium text-[var(--muted)]">
                {t("common.search")}
                <input className={`${inputClass} mt-1`} value={logFilter.q} onChange={(e) => setLogFilter({ ...logFilter, q: e.target.value })} placeholder={t("page.settings.logSearchPh")} />
              </label>
            </div>
            {opsLogs.isError ? <ErrorLine message={(opsLogs.error as Error).message} /> : null}
            <div className="mt-4 max-h-[34rem] overflow-auto rounded-xl border border-[var(--border)] bg-slate-950">
              {(opsLogs.data?.items || []).map((row: any, idx: number) => (
                <div key={`${row.ts}-${idx}`} className="grid grid-cols-[8.5rem_5.5rem_minmax(0,1fr)] gap-3 border-b border-slate-800 px-3 py-2 text-xs last:border-0">
                  <span className="font-mono text-slate-500">{row.ts || "-"}</span>
                  <span className={logLevelClass(row.level)}>{row.level || "-"}</span>
                  <span className="whitespace-pre-wrap break-words font-mono text-slate-200">{row.message || row.raw}</span>
                </div>
              ))}
              {!opsLogs.data?.items?.length ? <div className="px-4 py-8 text-sm text-slate-400">{t("page.settings.noLogs")}</div> : null}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.logFiles")}</p>
            <div className="mt-3 space-y-2">
              {(opsObservability.data?.logs || []).map((log: any) => (
                <button key={log.name} type="button" className="w-full rounded-xl border border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--surface-muted)]" onClick={() => setLogFilter({ ...logFilter, name: log.name })}>
                  <span className="block text-sm font-medium text-[var(--text)]">{log.name}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{formatBytes(log.size)} · {log.updated_at}</span>
                </button>
              ))}
              {!opsObservability.data?.logs?.length ? <p className="text-sm text-[var(--muted)]">{t("page.settings.noLogs")}</p> : null}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.eventTypes")}</p>
            <div className="mt-3 space-y-2">
              {Object.entries(opsObservability.data?.events?.by_action || {}).map(([action, count]) => (
                <div key={action} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-xs">
                  <span className="truncate font-mono text-[var(--muted-strong)]">{action}</span>
                  <span className="font-semibold text-[var(--text)]">{String(count)}</span>
                </div>
              ))}
              {!Object.keys(opsObservability.data?.events?.by_action || {}).length ? <p className="text-sm text-[var(--muted)]">{t("page.settings.noEvents")}</p> : null}
            </div>
          </div>
          {opsObservability.isError ? <ErrorLine message={(opsObservability.error as Error).message} /> : null}
          <p className="break-all text-xs text-[var(--muted)]">{opsObservability.data?.log_dir || ""}</p>
        </div>
      </div>
    </Card>
  );
}
