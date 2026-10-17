import { ProjectOwnerSelect } from "@/components/DeliveryMemberIdentity";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrainCircuit, ClipboardList, PlayCircle, RefreshCcw, Wand2 } from "lucide-react";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { Analytics } from "../Analytics";
import { api } from "@/lib/api";
import { getProjectId, getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("@/components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

type ReportsView = "overview" | "assets" | "subscription" | "actionTasks";

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

type ReportsWorkbenchProps = {
  initialView?: ReportsView;
};

export function AnalyticsReportsWorkbench({ initialView = "overview" }: ReportsWorkbenchProps) {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [aiOpen, setAiOpen] = useState(false);
  const [view, setView] = useState<ReportsView>(initialView);
  const [taskPreviews, setTaskPreviews] = useState<any[]>([]);
  const [decisionResult, setDecisionResult] = useState<any>(null);
  const [decisionTaskPreviews, setDecisionTaskPreviews] = useState<any[]>([]);
  const [decisionForm, setDecisionForm] = useState({
    question: t("page.analyticsReports.decisionQuestionDefault"),
    priority: "",
    owner_id: "",
    dev_tool: "codex",
    max_tasks: 5,
  });
  const qc = useQueryClient();

  const summaryQ = useQuery({
    queryKey: ["analyticsReportsSummary"],
    queryFn: api.analyticsReportsSummary,
    enabled: authed && hasProject,
  });
  const chartsQ = useQuery({
    queryKey: ["analyticsReportsCharts"],
    queryFn: api.analyticsReportsCharts,
    enabled: authed && hasProject,
  });
  const intelligenceQ = useQuery({
    queryKey: ["analyticsReportsIntelligence"],
    queryFn: api.analyticsReportsIntelligence,
    enabled: authed && hasProject,
  });
  const decisionOverviewQ = useQuery({
    queryKey: ["analyticsDecisionOverview"],
    queryFn: () => api.analyticsDecisionOverview({ include_evidence: true, max_reports: 10 }),
    enabled: authed && hasProject,
  });
  const createInsight = useMutation({
    mutationFn: () => api.analyticsCreateInsightReport({ title: t("page.analytics.insightReportTitle"), publish: false }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["analyticsReports"] });
      void qc.invalidateQueries({ queryKey: ["analyticsReportsSummary"] });
      void qc.invalidateQueries({ queryKey: ["analyticsReportsCharts"] });
      void qc.invalidateQueries({ queryKey: ["analyticsReportsIntelligence"] });
    },
  });
  const refreshAttribution = useMutation({
    mutationFn: () => api.analyticsRefreshReportsAttribution({ only_missing: false }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["analyticsReports"] });
      void qc.invalidateQueries({ queryKey: ["analyticsReportsSummary"] });
      void qc.invalidateQueries({ queryKey: ["analyticsReportsCharts"] });
      void qc.invalidateQueries({ queryKey: ["analyticsReportsIntelligence"] });
    },
  });
  const previewOpsTasks = useMutation({
    mutationFn: () => api.analyticsReportsIntelligenceTasks({ preview: true, priority: "", owner_id: "", dev_tool: "codex" }),
    onSuccess: (data) => setTaskPreviews(data?.items ?? []),
  });
  const createOpsTasks = useMutation({
    mutationFn: () => api.analyticsReportsIntelligenceTasks({ preview: false, priority: "", owner_id: "", dev_tool: "codex" }),
    onSuccess: (data) => {
      setTaskPreviews(data?.items ?? []);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const explainDecision = useMutation({
    mutationFn: () =>
      api.analyticsDecisionExplain({
        question: decisionForm.question,
        include_evidence: true,
        max_reports: 10,
      }),
    onSuccess: (data) => setDecisionResult(data),
  });
  const previewDecisionTasks = useMutation({
    mutationFn: () =>
      api.analyticsDecisionTasks({
        question: decisionForm.question,
        include_evidence: true,
        max_reports: 10,
        preview: true,
        priority: decisionForm.priority,
        owner_id: decisionForm.owner_id,
        dev_tool: decisionForm.dev_tool,
        max_tasks: decisionForm.max_tasks,
      }),
    onSuccess: (data) => {
      setDecisionResult(data?.decision_packet ?? data);
      setDecisionTaskPreviews(data?.items ?? []);
    },
  });
  const createDecisionTasks = useMutation({
    mutationFn: () =>
      api.analyticsDecisionTasks({
        question: decisionForm.question,
        include_evidence: true,
        max_reports: 10,
        preview: false,
        priority: decisionForm.priority,
        owner_id: decisionForm.owner_id,
        dev_tool: decisionForm.dev_tool,
        max_tasks: decisionForm.max_tasks,
      }),
    onSuccess: (data) => {
      setDecisionResult(data?.decision_packet ?? data);
      setDecisionTaskPreviews(data?.items ?? []);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const summary = summaryQ.data?.summary ?? {};
  const intelligence = intelligenceQ.data ?? {};
  const decisionPacket = decisionResult ?? decisionOverviewQ.data ?? {};
  const decision = decisionPacket.decision ?? {};
  const decisionSummary = decisionPacket.summary ?? {};
  const decisionEvidence = decisionPacket.evidence ?? [];
  const decisionActions = decisionPacket.actions ?? [];
  const intelligenceSummary = intelligence.summary ?? {};
  const topDrivers = intelligence.top_drivers ?? [];
  const recommendations = intelligence.recommendations ?? [];
  const showOverview = view === "overview";
  const showAssets = view === "overview" || view === "assets";
  const showActionTasks = view === "overview" || view === "actionTasks";

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  if (!authed) return <NeedLogin />;
  if (!hasProject) return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={t("page.analyticsReports.title")}
        description={t("page.analyticsReports.workbenchDesc")}
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
              {(["overview", "assets", "subscription", "actionTasks"] as ReportsView[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-sm font-medium ${view === item ? "bg-[var(--brand)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"}`}
                  onClick={() => setView(item)}
                >
                  {t(`page.analyticsReports.view.${item}`)}
                </button>
              ))}
            </div>
            {showOverview || showAssets ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                disabled={createInsight.isPending}
                onClick={() => createInsight.mutate()}
              >
                <Wand2 className="size-4" />
                {createInsight.isPending ? t("common.loading") : t("page.analytics.generateInsight")}
              </button>
            ) : null}
            <RefreshButton
              onClick={() => {
                void summaryQ.refetch();
                void chartsQ.refetch();
                void intelligenceQ.refetch();
                void decisionOverviewQ.refetch();
              }}
              pending={summaryQ.isFetching || chartsQ.isFetching || intelligenceQ.isFetching || decisionOverviewQ.isFetching}
            />
          </>
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.analytics.reportTotal"), value: summary.total ?? 0 },
              { label: t("page.analytics.reportPublished"), value: summary.published ?? 0 },
              { label: t("page.analytics.reportDraft"), value: summary.draft ?? 0 },
              { label: t("page.analytics.reportNotified"), value: summary.notified ?? 0 },
              { label: t("page.analytics.reportPinned"), value: summary.pinned ?? 0 },
              { label: t("page.analytics.attributionReports"), value: summary.attribution_reports ?? 0 },
              { label: t("page.analytics.highRiskReports"), value: summary.high_risk_reports ?? 0 },
              { label: t("page.analyticsReports.avgScore"), value: intelligenceSummary.average_score ?? 0 },
              {
                label: t("page.analyticsReports.healthStatus"),
                value: t(`page.analyticsReports.healthStatusValue.${intelligence.health_status ?? "healthy"}`),
              },
              {
                label: t("page.analyticsReports.decisionScore"),
                value: decision.score ?? 0,
              },
              {
                label: t("page.analyticsReports.decisionStatus"),
                value: t(`page.analyticsReports.decisionStatusValue.${decision.status ?? "go"}`),
              },
              {
                label: t("page.analytics.subscriptionHealth"),
                value: t(`page.analytics.subscriptionHealthValue.${summary.subscription_health ?? "inactive"}`),
              },
            ]}
          />
        }
      >
        {showOverview || showAssets ? (
        <WorkbenchPanel title={t("page.analyticsReports.intelligenceTitle")}>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <p className="text-xs text-[var(--muted)]">{t("page.analyticsReports.avgScore")}</p>
                  <p className="mt-1 text-2xl font-semibold">{intelligenceSummary.average_score ?? 0}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <p className="text-xs text-[var(--muted)]">{t("page.analytics.highRiskReports")}</p>
                  <p className="mt-1 text-2xl font-semibold">{intelligenceSummary.high_risk_reports ?? 0}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <p className="text-xs text-[var(--muted)]">{t("page.analyticsReports.healthStatus")}</p>
                  <p className="mt-1 text-lg font-semibold">
                    {t(`page.analyticsReports.healthStatusValue.${intelligence.health_status ?? "healthy"}`)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  disabled={refreshAttribution.isPending}
                  onClick={() => refreshAttribution.mutate()}
                >
                  <RefreshCcw className="size-4" />
                  {refreshAttribution.isPending ? t("common.loading") : t("page.analyticsReports.batchRefreshAttribution")}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  disabled={previewOpsTasks.isPending}
                  onClick={() => previewOpsTasks.mutate()}
                >
                  <ClipboardList className="size-4" />
                  {previewOpsTasks.isPending ? t("common.loading") : t("page.analyticsReports.previewOpsTasks")}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  disabled={createOpsTasks.isPending}
                  onClick={() => createOpsTasks.mutate()}
                >
                  <ClipboardList className="size-4" />
                  {createOpsTasks.isPending ? t("common.loading") : t("page.analyticsReports.createOpsTasks")}
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold">{t("page.analyticsReports.topDrivers")}</p>
                <div className="mt-2 space-y-2">
                  {topDrivers.length ? topDrivers.slice(0, 4).map((item: any) => (
                    <div key={item.factor} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{item.label ?? item.factor}</span>
                        <span className="text-xs text-[var(--muted)]">{item.count ?? 0} · {t("page.analyticsReports.affectedReports", { count: (item.report_ids ?? []).length })}</span>
                      </div>
                    </div>
                  )) : <p className="text-sm text-[var(--muted)]">{t("page.analyticsReports.noTopDrivers")}</p>}
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold">{t("page.analyticsReports.recommendations")}</p>
                <div className="mt-2 space-y-2">
                  {recommendations.slice(0, 3).map((item: any) => (
                    <div key={item.action_type} className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm">
                      <span className="font-medium">{item.title}</span>
                      <p className="mt-1 text-xs text-[var(--muted)]">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {taskPreviews.length ? (
            <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <p className="text-sm font-semibold">{t("page.analyticsReports.taskPreview")}</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {taskPreviews.slice(0, 4).map((item: any) => (
                  <div key={item.title} className="rounded-lg bg-[var(--surface)] p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{item.title}</span>
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs">{item.priority}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </WorkbenchPanel>
        ) : null}

        {showOverview || showActionTasks ? (
        <WorkbenchPanel
          title={t("page.analyticsReports.decisionEngineTitle")}
          actions={
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              disabled={decisionOverviewQ.isFetching}
              onClick={() => {
                setDecisionResult(null);
                void decisionOverviewQ.refetch();
              }}
            >
              <RefreshCcw className="size-4" />
              {t("common.refresh")}
            </button>
          }
        >
          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <p className="text-xs text-[var(--muted)]">{t("page.analyticsReports.decisionScore")}</p>
                  <p className="mt-1 text-2xl font-semibold">{decision.score ?? 0}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <p className="text-xs text-[var(--muted)]">{t("page.analyticsReports.decisionStatus")}</p>
                  <p className="mt-1 text-lg font-semibold">{t(`page.analyticsReports.decisionStatusValue.${decision.status ?? "go"}`)}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <p className="text-xs text-[var(--muted)]">{t("page.analyticsReports.decisionConfidence")}</p>
                  <p className="mt-1 text-2xl font-semibold">{Math.round(Number(decision.confidence ?? 0) * 100)}%</p>
                </div>
              </div>
              <textarea
                className="min-h-24 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
                value={decisionForm.question}
                onChange={(event) => setDecisionForm((form) => ({ ...form, question: event.target.value }))}
                placeholder={t("page.analyticsReports.decisionQuestionPlaceholder")}
              />
              <div className="grid gap-2 md:grid-cols-4">
                <select
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  value={decisionForm.priority}
                  onChange={(event) => setDecisionForm((form) => ({ ...form, priority: event.target.value }))}
                >
                  <option value="">{t("page.analyticsReports.priorityAuto")}</option>
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                </select>
                <ProjectOwnerSelect
                  value={decisionForm.owner_id}
                  onChange={(owner_id) => setDecisionForm((form) => ({ ...form, owner_id: owner_id }))}
                  placeholder={t("page.analyticsReports.assignee")}
                />
                <input
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  value={decisionForm.dev_tool}
                  onChange={(event) => setDecisionForm((form) => ({ ...form, dev_tool: event.target.value }))}
                  placeholder={t("page.analyticsReports.devTool")}
                />
                <input
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  type="number"
                  min={1}
                  max={10}
                  value={decisionForm.max_tasks}
                  onChange={(event) => setDecisionForm((form) => ({ ...form, max_tasks: Number(event.target.value || 1) }))}
                  aria-label={t("page.analyticsReports.maxTasks")}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  disabled={explainDecision.isPending}
                  onClick={() => explainDecision.mutate()}
                >
                  <BrainCircuit className="size-4" />
                  {explainDecision.isPending ? t("common.loading") : t("page.analyticsReports.explainDecision")}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  disabled={previewDecisionTasks.isPending}
                  onClick={() => previewDecisionTasks.mutate()}
                >
                  <ClipboardList className="size-4" />
                  {previewDecisionTasks.isPending ? t("common.loading") : t("page.analyticsReports.previewDecisionTasks")}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  disabled={createDecisionTasks.isPending}
                  onClick={() => createDecisionTasks.mutate()}
                >
                  <PlayCircle className="size-4" />
                  {createDecisionTasks.isPending ? t("common.loading") : t("page.analyticsReports.createDecisionTasks")}
                </button>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm leading-6">
                <p className="font-semibold">{t("page.analyticsReports.decisionAnswer")}</p>
                <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">{decisionPacket.answer ?? t("page.analyticsReports.noDecisionAnswer")}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { label: t("page.analyticsReports.decisionReports"), value: decisionSummary.total_reports ?? 0 },
                  { label: t("page.analyticsReports.decisionHighRisk"), value: decisionSummary.high_risk_reports ?? 0 },
                  { label: t("page.analyticsReports.decisionEvidence"), value: decisionSummary.evidence_count ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                    <p className="text-xs text-[var(--muted)]">{item.label}</p>
                    <p className="mt-1 text-xl font-semibold">{item.value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-sm font-semibold">{t("page.analyticsReports.decisionActions")}</p>
                <div className="mt-2 space-y-2">
                  {decisionActions.slice(0, 4).map((item: any) => (
                    <div key={item.id ?? item.title} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{item.title}</span>
                        <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs">{item.priority_hint}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{item.detail}</p>
                    </div>
                  ))}
                  {!decisionActions.length ? <p className="text-sm text-[var(--muted)]">{t("page.analyticsReports.noDecisionActions")}</p> : null}
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold">{t("page.analyticsReports.decisionEvidenceList")}</p>
                <div className="mt-2 space-y-2">
                  {decisionEvidence.slice(0, 5).map((item: any) => (
                    <div key={`${item.type}-${item.id ?? item.title}`} className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{item.title ?? item.id}</span>
                        <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs">{item.type}</span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {item.risk_level ? `${item.risk_level} · score ${item.score ?? 0}` : t("page.analyticsReports.affectedReports", { count: (item.report_ids ?? []).length })}
                      </p>
                    </div>
                  ))}
                  {!decisionEvidence.length ? <p className="text-sm text-[var(--muted)]">{t("page.analyticsReports.noDecisionEvidence")}</p> : null}
                </div>
              </div>
              {decisionTaskPreviews.length ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <p className="text-sm font-semibold">{t("page.analyticsReports.decisionTaskPreview")}</p>
                  <div className="mt-2 space-y-2">
                    {decisionTaskPreviews.slice(0, 4).map((item: any) => (
                      <div key={item.title} className="rounded-lg bg-[var(--surface)] p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{item.title}</span>
                          <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs">{item.priority}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{item.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </WorkbenchPanel>
        ) : null}

        {showOverview || showAssets ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.keys(pieToRecord(chartsQ.data?.by_status)).length ? (
            <WorkbenchPanel title={t("page.analyticsReports.chartStatus")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_status)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(chartsQ.data?.by_tag)).length ? (
            <WorkbenchPanel title={t("page.analyticsReports.chartTags")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_tag)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(chartsQ.data?.by_owner)).length ? (
            <WorkbenchPanel title={t("page.analyticsReports.chartOwners")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(chartsQ.data?.by_owner)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
        ) : null}
      </WorkbenchShell>

      {summaryQ.error ? <ErrorBlock message={(summaryQ.error as Error).message} /> : null}
      <Analytics section="reports" reportsLayout="module" reportsView={view} />

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module="data.analytics.reports"
        context={{ summary }}
        initialPrompt={t("page.analyticsReports.aiPrefill")}
      />
    </div>
  );
}
