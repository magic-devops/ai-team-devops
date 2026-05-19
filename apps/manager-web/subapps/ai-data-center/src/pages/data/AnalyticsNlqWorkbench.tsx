import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { Save, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { MarkdownView } from "@/components/MarkdownView";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getProjectId, getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

export function AnalyticsNlqWorkbench() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [question, setQuestion] = useState("");
  const [aiOpen, setAiOpen] = useState(false);

  const overview = useQuery({
    queryKey: ["analyticsOverview"],
    queryFn: api.analyticsOverview,
    enabled: authed && hasProject,
  });

  const nlq = useMutation({
    mutationFn: () => api.analyticsNlq(question.trim()),
  });

  const metrics = overview.data?.metrics ?? {};

  const saveReport = useMutation({
    mutationFn: () =>
      api.analyticsCreateReport({
        title: question.trim().slice(0, 80) || t("page.analytics.defaultReportTitle"),
        question: question.trim(),
        answer: String(nlq.data?.answer ?? ""),
        metrics_snapshot: metrics,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["analyticsReports"] });
      void qc.invalidateQueries({ queryKey: ["analyticsReportsSummary"] });
    },
  });

  const copilotPrompt = useMemo(() => {
    if (!question.trim() && !nlq.data?.answer) return "";
    return t("page.analytics.nlqCopilotPrefill", {
      question: question.trim(),
      answer: String(nlq.data?.answer ?? "").slice(0, 500),
    });
  }, [question, nlq.data, t]);

  if (!authed) return <NeedLogin />;
  if (!hasProject) {
    return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;
  }

  return (
    <>
      <WorkbenchShell
        title={t("page.analytics.nlq")}
        description={t("page.analytics.nlqHint")}
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            {nlq.data?.answer ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                disabled={saveReport.isPending}
                onClick={() => saveReport.mutate()}
              >
                <Save className="h-4 w-4" />
                {t("page.analytics.saveAsReport")}
              </button>
            ) : null}
            <RefreshButton onClick={() => void overview.refetch()} pending={overview.isFetching} />
          </>
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.analytics.tasks"), value: metrics.tasks_total ?? 0 },
              { label: t("page.analytics.requirements"), value: metrics.requirements_total ?? 0 },
              { label: t("page.analytics.issues"), value: metrics.issues_total ?? 0 },
            ]}
          />
        }
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <WorkbenchPanel title={t("page.analytics.nlqAsk")}>
            <Input.TextArea
              rows={4}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t("page.analytics.nlqPh")}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="primary"
                icon={<Sparkles className="h-4 w-4" />}
                disabled={!question.trim() || nlq.isPending}
                loading={nlq.isPending}
                onClick={() => nlq.mutate()}
              >
                {t("page.analytics.ask")}
              </Button>
            </div>
            {nlq.isError ? <ErrorBlock message={(nlq.error as Error).message} /> : null}
            {nlq.isPending ? <LoadingBlock /> : null}
            {nlq.data?.answer ? (
              <div className="mt-4 rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-softer)] p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {t("page.analytics.nlqAnswer")}
                </p>
                <MarkdownView content={String(nlq.data.answer)} />
              </div>
            ) : null}
          </WorkbenchPanel>

          <WorkbenchPanel title={t("page.analytics.nlqContext")}>
            <p className="mb-2 text-xs text-[var(--muted)]">{t("page.analytics.nlqContextHint")}</p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
              {JSON.stringify(metrics, null, 2)}
            </pre>
          </WorkbenchPanel>
        </div>
      </WorkbenchShell>

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module="analytics.nlq"
        context={{ question: question.trim(), answer_preview: String(nlq.data?.answer ?? "").slice(0, 800) }}
        initialPrompt={copilotPrompt}
      />
    </>
  );
}
