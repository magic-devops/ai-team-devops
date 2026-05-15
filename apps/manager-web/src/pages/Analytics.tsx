import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";

function MetricTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-200/90 bg-gradient-to-br from-white to-slate-50/90 p-4 dark:border-slate-700 dark:from-slate-900/80 dark:to-slate-900/40">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-brand-700 dark:text-brand-400">{value}</p>
    </div>
  );
}

export function Analytics() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [question, setQuestion] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const overview = useQuery({
    queryKey: ["analyticsOverview"],
    queryFn: api.analyticsOverview,
    enabled: authed && hasProject,
  });

  const nlq = useMutation({
    mutationFn: () => api.analyticsNlq(question.trim()),
  });

  if (!authed) return <NeedLogin />;
  if (!hasProject) return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;

  const metrics = overview.data?.metrics ?? {};

  return (
    <div className="w-full space-y-6">
      <Card
        title={t("page.analytics.overview")}
        actions={<RefreshButton onClick={() => void overview.refetch()} pending={overview.isFetching} />}
      >
        {overview.isLoading ? <LoadingBlock /> : null}
        {overview.error ? <ErrorBlock message={(overview.error as Error).message} /> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label={t("page.analytics.tasks")} value={metrics.tasks_total ?? 0} />
          <MetricTile label={t("page.analytics.requirements")} value={metrics.requirements_total ?? 0} />
          <MetricTile label={t("page.analytics.issues")} value={metrics.issues_total ?? 0} />
          <MetricTile label={t("page.analytics.reflections")} value={metrics.agent_reflections_sampled ?? 0} />
        </div>
        <button
          type="button"
          className="mt-3 text-xs text-brand-600 underline dark:text-brand-400"
          onClick={() => setShowRaw((v) => !v)}
        >
          {showRaw ? t("page.analytics.hideRaw") : t("page.analytics.showRaw")}
        </button>
        {showRaw ? (
          <pre className="mt-2 overflow-auto rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">
            {JSON.stringify(metrics, null, 2)}
          </pre>
        ) : null}
      </Card>

      <Card title={t("page.analytics.nlq")}>
        <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">{t("page.analytics.nlqHint")}</p>
        <textarea
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("page.analytics.nlqPh")}
        />
        <button
          type="button"
          className="mt-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!question.trim() || nlq.isPending}
          onClick={() => nlq.mutate()}
        >
          {t("page.analytics.ask")}
        </button>
        {nlq.isError ? <p className="mt-2 text-sm text-rose-600">{(nlq.error as Error).message}</p> : null}
        {nlq.data?.answer ? (
          <p className="mt-3 whitespace-pre-wrap rounded-lg border border-brand-200/80 bg-brand-50/80 p-4 text-sm dark:border-brand-800/50 dark:bg-slate-800/80">
            {nlq.data.answer}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
