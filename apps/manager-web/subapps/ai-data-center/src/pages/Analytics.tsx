import { ProjectOwnerSelect } from "@/components/DeliveryMemberIdentity";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Archive, Brain, Clock3, Database, Download, FileText, GitBranch, LibraryBig, ListChecks, Pin, Save, Send, Tags, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getProjectId, getToken } from "@/lib/authStorage";

export type AnalyticsSection = "overview" | "blueprint" | "reports" | "catalog" | "lineage" | "exchange" | "nlq";
export type CatalogPanel = "assets" | "metrics" | "services" | "quality" | "development";
export type CatalogLayout = "legacy" | "module";
export type ReportsLayout = "legacy" | "module";
export type ReportsView = "overview" | "assets" | "subscription" | "actionTasks";

function MetricTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-200/90 bg-gradient-to-br from-white to-slate-50/90 p-4 dark:border-slate-700 dark:from-slate-900/80 dark:to-slate-900/40">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-brand-700 dark:text-brand-400">{value}</p>
    </div>
  );
}

function parseImportBody(text: string) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Import JSON must be an object");
  }
  return { mode: "merge", ...(value as Record<string, unknown>) };
}

function moduleLabel(module: any, fallback: string) {
  return String(module?.label || module?.name || fallback);
}

export function Analytics({
  section = "overview",
  initialCatalogPanel = "assets",
  catalogLayout = "legacy",
  reportsLayout = "legacy",
  reportsView = "overview",
}: {
  section?: AnalyticsSection;
  initialCatalogPanel?: CatalogPanel;
  catalogLayout?: CatalogLayout;
  reportsLayout?: ReportsLayout;
  reportsView?: ReportsView;
}) {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [question, setQuestion] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [exchangeModules, setExchangeModules] = useState<string[]>([
    "requirements",
    "tasks",
    "issues",
    "sprints",
  ]);
  const [importText, setImportText] = useState("");
  const [reportChannels, setReportChannels] = useState<Record<string, string>>({});
  const [subscriptionChannel, setSubscriptionChannel] = useState("");
  const [subscriptionEnabled, setSubscriptionEnabled] = useState<boolean | null>(null);
  const [subscriptionAuto, setSubscriptionAuto] = useState<boolean | null>(null);
  const [reportStatusFilter, setReportStatusFilter] = useState("");
  const [reportSourceFilter, setReportSourceFilter] = useState("");
  const [reportQuery, setReportQuery] = useState("");
  const [reportMetaDrafts, setReportMetaDrafts] = useState<Record<string, { title: string; owner: string; tags: string; note: string; pinned: boolean }>>({});
  const [reportActionDrafts, setReportActionDrafts] = useState<Record<string, { max_tasks: number; priority: string; owner_id: string; dev_tool: string }>>({});
  const [reportActionPreviews, setReportActionPreviews] = useState<Record<string, any[]>>({});
  const [reportAttributionPreviews, setReportAttributionPreviews] = useState<Record<string, any[]>>({});
  const [selectedDataGaps, setSelectedDataGaps] = useState<string[]>([]);
  const [catalogPanel, setCatalogPanel] = useState<CatalogPanel>(initialCatalogPanel);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetStatus, setAssetStatus] = useState("");
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [metricDraft, setMetricDraft] = useState({ id: "", name: "", domain: "business", source: "", grain: "project", owner: "DataOps", formula: "" });
  const [tagDraft, setTagDraft] = useState({ id: "", name: "", category: "business", owner: "DataOps", rule: "", target_assets: "" });
  const [serviceDraft, setServiceDraft] = useState({ id: "", name: "", type: "metric_api", endpoint: "", owner: "DataOps", assets: "", metrics: "", consumers: "" });
  const [selectedAlerts, setSelectedAlerts] = useState<string[]>([]);
  const [selectedDevTemplates, setSelectedDevTemplates] = useState<string[]>([]);
  const [evidenceChannel, setEvidenceChannel] = useState("");
  const [devFeedAgent, setDevFeedAgent] = useState("");
  const [devFeedIncludeBlocked, setDevFeedIncludeBlocked] = useState(true);
  const [devEvidenceDecision, setDevEvidenceDecision] = useState("");
  const [devTemplateDraft, setDevTemplateDraft] = useState({ id: "", name: "", type: "data_development", engine: "SQL", owner: "Data Platform Agent", assets: "", quality_gates: "", description: "" });

  const overview = useQuery({
    queryKey: ["analyticsOverview"],
    queryFn: api.analyticsOverview,
    enabled: authed && hasProject && (section === "overview" || section === "nlq"),
  });
  const catalog = useQuery({
    queryKey: ["analyticsCatalog"],
    queryFn: api.analyticsCatalog,
    enabled: authed && hasProject && section === "catalog",
  });
  const assets = useQuery({
    queryKey: ["analyticsAssets", assetStatus, assetQuery],
    queryFn: () => api.analyticsAssets("", assetStatus, assetQuery.trim()),
    enabled: authed && hasProject && section === "catalog",
  });
  const metricsCenter = useQuery({
    queryKey: ["analyticsMetricsCenter"],
    queryFn: () => api.analyticsMetricsCenter(),
    enabled: authed && hasProject && section === "catalog",
  });
  const tags = useQuery({
    queryKey: ["analyticsTags"],
    queryFn: () => api.analyticsTags(),
    enabled: authed && hasProject && section === "catalog",
  });
  const dataServices = useQuery({
    queryKey: ["analyticsDataServices"],
    queryFn: () => api.analyticsDataServices(),
    enabled: authed && hasProject && section === "catalog",
  });
  const qualityAlerts = useQuery({
    queryKey: ["analyticsQualityAlerts"],
    queryFn: () => api.analyticsQualityAlerts(),
    enabled: authed && hasProject && section === "catalog",
  });
  const devTemplates = useQuery({
    queryKey: ["analyticsDevTemplates"],
    queryFn: () => api.analyticsDevTemplates(),
    enabled: authed && hasProject && section === "catalog",
  });
  const devOpsSummary = useQuery({
    queryKey: ["analyticsDevOpsSummary"],
    queryFn: api.analyticsDevOpsSummary,
    enabled: authed && hasProject && section === "catalog",
  });
  const devSchedules = useQuery({
    queryKey: ["analyticsDevSchedules"],
    queryFn: () => api.analyticsDevSchedules(10),
    enabled: authed && hasProject && section === "catalog",
  });
  const devAgentFeed = useQuery({
    queryKey: ["analyticsDevAgentFeed", devFeedAgent, devFeedIncludeBlocked],
    queryFn: () => api.analyticsDevAgentFeed(8, "", devFeedAgent.trim(), devFeedIncludeBlocked),
    enabled: authed && hasProject && section === "catalog",
  });
  const devEvidence = useQuery({
    queryKey: ["analyticsDevEvidence", devEvidenceDecision],
    queryFn: () => api.analyticsDevEvidence(8, "", "", devEvidenceDecision),
    enabled: authed && hasProject && section === "catalog",
  });
  const lineage = useQuery({
    queryKey: ["analyticsLineage"],
    queryFn: api.analyticsLineage,
    enabled: authed && hasProject && section === "lineage",
  });
  const blueprint = useQuery({
    queryKey: ["analyticsBlueprint"],
    queryFn: api.analyticsBlueprint,
    enabled: authed && hasProject && section === "blueprint",
  });
  const exchange = useQuery({
    queryKey: ["dataExchangeSummary"],
    queryFn: api.dataExchangeSummary,
    enabled: authed && hasProject && section === "exchange",
  });
  const exchangeJobs = useQuery({
    queryKey: ["dataExchangeJobs"],
    queryFn: () => api.dataExchangeJobs(20),
    enabled: authed && hasProject && section === "exchange",
  });
  const reports = useQuery({
    queryKey: ["analyticsReports", reportStatusFilter, reportSourceFilter, reportQuery],
    queryFn: () => api.analyticsReports(50, reportStatusFilter, reportSourceFilter, reportQuery.trim()),
    enabled: authed && hasProject && section === "reports",
  });
  const reportsSummary = useQuery({
    queryKey: ["analyticsReportsSummary"],
    queryFn: api.analyticsReportsSummary,
    enabled: authed && hasProject && section === "reports",
  });
  const notifyChannels = useQuery({
    queryKey: ["notifyChannelsForAnalytics"],
    queryFn: api.notifyChannels,
    enabled: authed && hasProject && (section === "reports" || section === "catalog"),
  });
  const reportSubscription = useQuery({
    queryKey: ["analyticsReportSubscription"],
    queryFn: api.analyticsReportSubscription,
    enabled: authed && hasProject && section === "reports",
  });
  const metrics = overview.data?.metrics ?? {};
  const exchangeRows = exchange.data?.modules ?? [];
  const selectedExchangeModules = exchangeModules.length ? exchangeModules : exchangeRows.map((m: any) => String(m.name));

  useEffect(() => {
    if (section === "catalog") setCatalogPanel(initialCatalogPanel);
  }, [initialCatalogPanel, section]);

  const catalogChrome = section !== "catalog" || catalogLayout === "legacy";
  const activeCatalogPanel = catalogLayout === "module" ? initialCatalogPanel : catalogPanel;
  const showReportAssets = reportsView === "overview" || reportsView === "assets";
  const showReportSubscription = reportsView === "overview" || reportsView === "subscription";
  const showReportActionTasks = reportsView === "overview" || reportsView === "actionTasks";

  const nlq = useMutation({
    mutationFn: () => api.analyticsNlq(question.trim()),
  });
  const previewImport = useMutation({
    mutationFn: () => api.dataExchangePreview(parseImportBody(importText)),
  });
  const runImport = useMutation({
    mutationFn: () => api.dataExchangeImport(parseImportBody(importText)),
    onSuccess: () => {
      void overview.refetch();
      void exchange.refetch();
      void exchangeJobs.refetch();
    },
  });
  const createExportJob = useMutation({
    mutationFn: () => api.dataExchangeExportJob(selectedExchangeModules),
    onSuccess: () => {
      void exchangeJobs.refetch();
    },
  });
  const saveReport = useMutation({
    mutationFn: (source: "overview" | "nlq") =>
      api.analyticsCreateReport({
        title: source === "nlq" && question.trim() ? question.trim().slice(0, 80) : t("page.analytics.defaultReportTitle"),
        question: source === "nlq" ? question.trim() : "",
        answer: source === "nlq" ? String(nlq.data?.answer ?? "") : "",
        metrics_snapshot: metrics,
      }),
    onSuccess: () => {
      void reports.refetch();
      void reportsSummary.refetch();
    },
  });
  const createInsightReport = useMutation({
    mutationFn: () => api.analyticsCreateInsightReport({ title: t("page.analytics.insightReportTitle"), publish: false }),
    onSuccess: () => {
      void reports.refetch();
      void reportsSummary.refetch();
    },
  });
  const deleteReport = useMutation({
    mutationFn: (id: string) => api.analyticsDeleteReport(id),
    onSuccess: () => {
      void reports.refetch();
      void reportsSummary.refetch();
    },
  });
  const updateReportStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "draft" | "published" | "archived" }) =>
      api.analyticsUpdateReportStatus(id, status),
    onSuccess: () => {
      void reports.refetch();
      void reportsSummary.refetch();
    },
  });
  const updateReportMeta = useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: { title: string; owner: string; tags: string; note: string; pinned: boolean } }) =>
      api.analyticsUpdateReportMeta(id, {
        title: meta.title,
        owner: meta.owner,
        tags: meta.tags
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        note: meta.note,
        pinned: meta.pinned,
      }),
    onSuccess: () => {
      void reports.refetch();
      void reportsSummary.refetch();
    },
  });
  const notifyReport = useMutation({
    mutationFn: ({ id, channel }: { id: string; channel: string }) =>
      api.analyticsNotifyReport(id, { channels: [channel] }),
    onSuccess: () => {
      void reports.refetch();
      void reportsSummary.refetch();
    },
  });
  const previewActionTasks = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: { max_tasks: number; priority: string; owner_id: string; dev_tool: string } }) =>
      api.analyticsReportActionTasks(id, { ...draft, preview: true }),
    onSuccess: (data, vars) => {
      setReportActionPreviews((prev) => ({ ...prev, [vars.id]: data.items ?? [] }));
    },
  });
  const createActionTasks = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: { max_tasks: number; priority: string; owner_id: string; dev_tool: string } }) =>
      api.analyticsReportActionTasks(id, { ...draft, preview: false }),
    onSuccess: (data, vars) => {
      setReportActionPreviews((prev) => ({ ...prev, [vars.id]: data.items ?? [] }));
      void reports.refetch();
      void reportsSummary.refetch();
    },
  });
  const refreshAttribution = useMutation({
    mutationFn: (id: string) => api.analyticsRefreshReportAttribution(id),
    onSuccess: () => {
      void reports.refetch();
      void reportsSummary.refetch();
    },
  });
  const previewAttributionTasks = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: { priority: string; owner_id: string; dev_tool: string } }) =>
      api.analyticsReportAttributionTasks(id, { ...draft, preview: true }),
    onSuccess: (data, vars) => {
      setReportAttributionPreviews((prev) => ({ ...prev, [vars.id]: data.items ?? [] }));
    },
  });
  const createAttributionTasks = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: { priority: string; owner_id: string; dev_tool: string } }) =>
      api.analyticsReportAttributionTasks(id, { ...draft, preview: false }),
    onSuccess: (data, vars) => {
      setReportAttributionPreviews((prev) => ({ ...prev, [vars.id]: data.items ?? [] }));
      void reports.refetch();
      void reportsSummary.refetch();
    },
  });
  const saveSubscription = useMutation({
    mutationFn: () => {
      const current = reportSubscription.data?.subscription ?? {};
      const channel = subscriptionChannel || (current.channels ?? [])[0] || "";
      return api.analyticsUpdateReportSubscription({
        enabled: subscriptionEnabled ?? Boolean(current.enabled),
        auto_on_publish: subscriptionAuto ?? Boolean(current.auto_on_publish),
        channels: channel ? [channel] : [],
      });
    },
    onSuccess: () => {
      void reportSubscription.refetch();
    },
  });
  const testSubscription = useMutation({
    mutationFn: api.analyticsTestReportSubscription,
  });
  const blueprintTasks = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.analyticsBlueprintTasks({
        ids: selectedDataGaps,
        dry_run: dryRun,
        priority: "P1",
        owner_id: "",
        dev_tool: "codex",
      }),
    onSuccess: (data) => {
      if (!data?.dry_run) setSelectedDataGaps([]);
    },
  });
  const patchAsset = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api.analyticsPatchAsset(id, patch),
    onSuccess: () => {
      void assets.refetch();
      void lineage.refetch();
    },
  });
  const upsertMetric = useMutation({
    mutationFn: () => api.analyticsUpsertMetric({ ...metricDraft, description: metricDraft.formula || metricDraft.name, tags: [metricDraft.domain, metricDraft.source].filter(Boolean) }),
    onSuccess: () => {
      setMetricDraft({ id: "", name: "", domain: "business", source: "", grain: "project", owner: "DataOps", formula: "" });
      void metricsCenter.refetch();
    },
  });
  const upsertTag = useMutation({
    mutationFn: () =>
      api.analyticsUpsertTag({
        ...tagDraft,
        target_assets: tagDraft.target_assets.split(",").map((x) => x.trim()).filter(Boolean),
        description: tagDraft.rule || tagDraft.name,
      }),
    onSuccess: () => {
      setTagDraft({ id: "", name: "", category: "business", owner: "DataOps", rule: "", target_assets: "" });
      void tags.refetch();
    },
  });
  const upsertService = useMutation({
    mutationFn: () =>
      api.analyticsUpsertDataService({
        ...serviceDraft,
        assets: serviceDraft.assets.split(",").map((x) => x.trim()).filter(Boolean),
        metrics: serviceDraft.metrics.split(",").map((x) => x.trim()).filter(Boolean),
        consumers: serviceDraft.consumers.split(",").map((x) => x.trim()).filter(Boolean),
        description: serviceDraft.name,
      }),
    onSuccess: () => {
      setServiceDraft({ id: "", name: "", type: "metric_api", endpoint: "", owner: "DataOps", assets: "", metrics: "", consumers: "" });
      void dataServices.refetch();
    },
  });
  const publishService = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.analyticsPublishDataService(id, { status }),
    onSuccess: () => void dataServices.refetch(),
  });
  const evaluateQuality = useMutation({
    mutationFn: () => api.analyticsQualityEvaluate({ asset_ids: selectedAssets }),
  });
  const governanceTasks = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.analyticsGovernanceTasks({
        ids: selectedAssets,
        dry_run: dryRun,
        priority: "P1",
        owner_id: "",
        dev_tool: "codex",
      }),
  });
  const alertTasks = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.analyticsQualityAlertTasks({
        ids: selectedAlerts,
        dry_run: dryRun,
        priority: "P1",
        owner_id: "",
        dev_tool: "codex",
      }),
    onSuccess: () => void qualityAlerts.refetch(),
  });
  const upsertDevTemplate = useMutation({
    mutationFn: () =>
      api.analyticsUpsertDevTemplate({
        ...devTemplateDraft,
        assets: devTemplateDraft.assets.split(",").map((x) => x.trim()).filter(Boolean),
        quality_gates: devTemplateDraft.quality_gates.split(",").map((x) => x.trim()).filter(Boolean),
        dag: [],
        priority: "P1",
        dev_tool: "codex",
      }),
    onSuccess: () => {
      setDevTemplateDraft({ id: "", name: "", type: "data_development", engine: "SQL", owner: "Data Platform Agent", assets: "", quality_gates: "", description: "" });
      void devTemplates.refetch();
    },
  });
  const devTemplateTasks = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.analyticsDevTemplateTasks({
        ids: selectedDevTemplates,
        dry_run: dryRun,
        priority: "P1",
        owner_id: "",
        dev_tool: "codex",
      }),
  });
  const devSchedule = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.analyticsDevSchedule({
        ids: selectedDevTemplates,
        dry_run: dryRun,
        max_parallel: 4,
        policy: "quality_first",
        priority: "P1",
        owner_id: "",
        dev_tool: "codex",
        event: "analytics.catalog.action",
      }),
    onSuccess: (data) => {
      if (!data?.dry_run) {
        void assets.refetch();
        void devTemplates.refetch();
        void devOpsSummary.refetch();
        void devSchedules.refetch();
      }
    },
  });
  const devScheduleAction = useMutation({
    mutationFn: ({ id, action, dryRun = false }: { id: string; action: "rerun" | "cancel" | "archive" | "restore"; dryRun?: boolean }) =>
      api.analyticsDevScheduleAction(id, {
        action,
        dry_run: dryRun,
        max_parallel: 4,
        policy: "quality_first",
        priority: "P1",
        owner_id: "",
        dev_tool: "codex",
        note: "analytics.catalog.history",
      }),
    onSuccess: (data) => {
      if (data?.summary) {
        devSchedule.reset();
      }
      void devSchedules.refetch();
    },
  });
  const devRunbook = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.analyticsDevRunbook({
        decisions: ["block", "warn"],
        include_unclaimed: true,
        dry_run: dryRun,
        priority: "P1",
        owner_id: "",
        dev_tool: "codex",
      }),
    onSuccess: (data) => {
      if (!data?.dry_run) {
        void devOpsSummary.refetch();
      }
    },
  });
  const devPacketAction = useMutation({
    mutationFn: ({ packet, action }: { packet: any; action: "claim" | "heartbeat" | "report" }) =>
      api.analyticsDevAgentFeedAction({
        schedule_id: String(packet.schedule_id || ""),
        packet_id: String(packet.packet_id || ""),
        action,
        agent: "Data Platform Agent",
        progress: action === "report" ? 100 : action === "heartbeat" ? 50 : 0,
        status: action === "report" ? "completed" : "running",
        summary: action === "report" ? "Packet completed from analytics workbench." : "",
        evidence: action === "report" ? [
          { gate_id: "scope.isolation", status: "pass", evidence: "Workbench report confirmed scope isolation." },
          { gate_id: "data.lineage", status: "pass", evidence: "Lineage impact reviewed from packet contract." },
          { gate_id: "data.quality", status: "pass", evidence: "Quality check submitted from packet report." },
          { gate_id: "schedule.dag", status: "pass", evidence: "DAG stage execution acknowledged." },
        ] : [],
        note: "analytics.catalog.agent_feed",
      }),
    onSuccess: () => {
      void devAgentFeed.refetch();
      void devSchedules.refetch();
      void devEvidence.refetch();
      void devOpsSummary.refetch();
    },
  });
  const devEvidenceTasks = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.analyticsDevEvidenceTasks({
        decisions: ["block", "warn"],
        dry_run: dryRun,
        priority: "P1",
        owner_id: "",
        dev_tool: "codex",
      }),
    onSuccess: () => void devOpsSummary.refetch(),
  });
  const devEvidenceNotify = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.analyticsDevEvidenceNotify({
        decisions: ["block", "warn"],
        channels: evidenceChannel ? [evidenceChannel] : [],
        dry_run: dryRun,
      }),
  });

  if (!authed) return <NeedLogin />;
  if (!hasProject) return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;

  const toggleExchangeModule = (name: string) => {
    setExchangeModules((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };
  const reportMetaDraft = (report: any) => {
    const id = String(report.id);
    return reportMetaDrafts[id] ?? {
      title: String(report.title ?? ""),
      owner: String(report.owner ?? ""),
      tags: (report.tags ?? []).join(", "),
      note: String(report.note ?? ""),
      pinned: Boolean(report.pinned),
    };
  };
  const patchReportMetaDraft = (report: any, patch: Partial<{ title: string; owner: string; tags: string; note: string; pinned: boolean }>) => {
    const id = String(report.id);
    setReportMetaDrafts((prev) => ({ ...prev, [id]: { ...reportMetaDraft(report), ...patch } }));
  };
  const reportActionDraft = (report: any) => {
    const id = String(report.id);
    return reportActionDrafts[id] ?? {
      max_tasks: 3,
      priority: "P2",
      owner_id: "",
      dev_tool: "sop",
    };
  };
  const patchReportActionDraft = (report: any, patch: Partial<{ max_tasks: number; priority: string; owner_id: string; dev_tool: string }>) => {
    const id = String(report.id);
    setReportActionDrafts((prev) => ({ ...prev, [id]: { ...reportActionDraft(report), ...patch } }));
  };
  const show = (target: AnalyticsSection) => section === target;

  return (
    <div className="w-full space-y-6">
      {show("blueprint") ? (
        <Card
          title={t("page.analytics.blueprint")}
          actions={
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                disabled={!selectedDataGaps.length || blueprintTasks.isPending}
                onClick={() => blueprintTasks.mutate(true)}
              >
                <ListChecks className="h-4 w-4" />
                {t("page.analytics.previewBlueprintTasks")}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                disabled={!selectedDataGaps.length || blueprintTasks.isPending}
                onClick={() => blueprintTasks.mutate(false)}
              >
                <Save className="h-4 w-4" />
                {t("page.analytics.createBlueprintTasks")}
              </button>
              <RefreshButton onClick={() => void blueprint.refetch()} pending={blueprint.isFetching} />
            </div>
          }
        >
          {blueprint.isLoading ? <LoadingBlock /> : null}
          {blueprint.error ? <ErrorBlock message={(blueprint.error as Error).message} /> : null}
          {blueprintTasks.isError ? <ErrorBlock message={(blueprintTasks.error as Error).message} /> : null}
          {blueprintTasks.data?.dry_run ? (
            <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
              {t("page.analytics.blueprintTaskPreview", { count: blueprintTasks.data.items?.length ?? 0 })}
            </div>
          ) : null}
          {blueprintTasks.data && !blueprintTasks.data.dry_run ? (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              {t("page.analytics.blueprintTaskCreated", { count: blueprintTasks.data.created ?? 0 })}
            </div>
          ) : null}
          <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <div className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-[var(--brand)]" />
                  <h3 className="text-sm font-semibold text-[var(--text)]">{blueprint.data?.architecture?.name ?? "Hermes Data"}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[var(--muted-strong)]">{blueprint.data?.architecture?.positioning}</p>
                <div className="mt-4 grid gap-2">
                  <MetricTile label={t("page.analytics.platformMaturity")} value={`${blueprint.data?.summary?.maturity ?? 0}%`} />
                  <MetricTile label={t("page.analytics.blueprintCapabilities")} value={blueprint.data?.summary?.capabilities ?? 0} />
                  <MetricTile label={t("page.analytics.blueprintStack")} value={blueprint.data?.summary?.stack_items ?? 0} />
                  <MetricTile label={t("page.analytics.blueprintGaps")} value={blueprint.data?.summary?.gaps ?? 0} />
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.scope")}</h3>
                <div className="mt-3 space-y-2 font-mono text-xs text-[var(--muted-strong)]">
                  <p>tenant_code: {blueprint.data?.scope?.tenant_code || "-"}</p>
                  <p>business_code: {blueprint.data?.scope?.business_code || "-"}</p>
                  <p>project_id: {blueprint.data?.scope?.project_id || "-"}</p>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                {(blueprint.data?.architecture?.layers ?? []).map((layer: string) => (
                  <div key={layer} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-xs text-[var(--muted-strong)]">
                    {layer}
                  </div>
                ))}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {(blueprint.data?.capabilities ?? []).map((capability: any) => (
                  <article key={capability.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-[var(--text)]">{capability.name}</h3>
                        <p className="mt-1 text-xs text-[var(--muted)]">{capability.next}</p>
                      </div>
                      <span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--brand)]">{capability.maturity}%</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(capability.stack ?? []).slice(0, 4).map((item: string) => (
                        <span key={item} className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] text-[var(--muted-strong)]">{item}</span>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(capability.ai_surfaces ?? []).slice(0, 4).map((item: string) => (
                        <span key={item} className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">{item}</span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="border-b border-[var(--border)] px-4 py-3">
                  <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.stackMatrix")}</h3>
                </div>
                <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-4">
                  {(blueprint.data?.stack ?? []).map((item: any) => (
                    <div key={item.id} className="border-b border-r border-[var(--border)] p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[var(--text)]">{item.name}</span>
                        <span className="text-xs text-[var(--brand)]">{item.maturity}%</span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">{item.recommendation}</p>
                      <p className="mt-2 font-mono text-[10px] text-[var(--muted)]">{(item.integration ?? []).join(", ")}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                  <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.blueprintGaps")}</h3>
                  <span className="text-xs text-[var(--muted)]">{t("page.analytics.selectedGaps", { count: selectedDataGaps.length })}</span>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {(blueprint.data?.gaps ?? []).map((gap: any) => (
                    <label key={gap.id} className="grid cursor-pointer gap-3 px-4 py-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_4rem]">
                      <input
                        type="checkbox"
                        checked={selectedDataGaps.includes(gap.id)}
                        onChange={(e) =>
                          setSelectedDataGaps((prev) => (e.target.checked ? [...prev, gap.id] : prev.filter((id) => id !== gap.id)))
                        }
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[var(--text)]">{gap.title}</span>
                        <span className="mt-1 block text-xs text-[var(--muted)]">{gap.recommendation}</span>
                      </span>
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-center text-xs text-[var(--muted-strong)]">{gap.priority}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {show("overview") ? (
        <Card
        title={t("page.analytics.overview")}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
              disabled={saveReport.isPending}
              onClick={() => saveReport.mutate("overview")}
            >
              <Save className="h-4 w-4" />
              {t("page.analytics.saveSnapshot")}
            </button>
            <RefreshButton onClick={() => void overview.refetch()} pending={overview.isFetching} />
          </div>
        }
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
      ) : null}

      {show("reports") ? (
        <Card
        title={t("page.analytics.reports")}
        actions={
          <div className="flex flex-wrap gap-2">
            {showReportAssets ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                disabled={createInsightReport.isPending}
                onClick={() => createInsightReport.mutate()}
              >
                <Brain className="h-4 w-4" />
                {t("page.analytics.generateInsight")}
              </button>
            ) : null}
            <RefreshButton
              onClick={() => {
                void reports.refetch();
                void reportsSummary.refetch();
              }}
              pending={reports.isFetching || reportsSummary.isFetching}
            />
          </div>
        }
      >
        {reports.error ? <ErrorBlock message={(reports.error as Error).message} /> : null}
        {reportsSummary.error ? <ErrorBlock message={(reportsSummary.error as Error).message} /> : null}
        {reportsLayout === "legacy" ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricTile label={t("page.analytics.reportTotal")} value={reportsSummary.data?.summary?.total ?? 0} />
          <MetricTile label={t("page.analytics.reportPublished")} value={reportsSummary.data?.summary?.published ?? 0} />
          <MetricTile label={t("page.analytics.reportDraft")} value={reportsSummary.data?.summary?.draft ?? 0} />
          <MetricTile label={t("page.analytics.reportNotified")} value={reportsSummary.data?.summary?.notified ?? 0} />
          <MetricTile label={t("page.analytics.reportPinned")} value={reportsSummary.data?.summary?.pinned ?? 0} />
          <MetricTile label={t("page.analytics.attributionReports")} value={reportsSummary.data?.summary?.attribution_reports ?? 0} />
        </div>
        ) : null}
        {showReportAssets || showReportActionTasks ? (
        <div className="mb-4 grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
          <input
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
            value={reportQuery}
            onChange={(e) => setReportQuery(e.target.value)}
            placeholder={t("page.analytics.searchReports")}
          />
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
            value={reportStatusFilter}
            onChange={(e) => setReportStatusFilter(e.target.value)}
          >
            <option value="">{t("page.analytics.allStatuses")}</option>
            <option value="draft">{t("page.analytics.reportStatus.draft")}</option>
            <option value="published">{t("page.analytics.reportStatus.published")}</option>
            <option value="archived">{t("page.analytics.reportStatus.archived")}</option>
          </select>
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
            value={reportSourceFilter}
            onChange={(e) => setReportSourceFilter(e.target.value)}
          >
            <option value="">{t("page.analytics.allSources")}</option>
            <option value="overview">{t("page.analytics.sourceOverview")}</option>
            <option value="nlq">{t("page.analytics.sourceNlq")}</option>
            <option value="insight">{t("page.analytics.sourceInsight")}</option>
          </select>
        </div>
        ) : null}
        {showReportSubscription ? (
        <div className="mb-4 grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.reportSubscription")}</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.analytics.reportSubscriptionHint")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <select
                className="min-w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
                value={subscriptionChannel || (reportSubscription.data?.subscription?.channels ?? [])[0] || ""}
                onChange={(e) => setSubscriptionChannel(e.target.value)}
              >
                <option value="">{t("page.analytics.pickNotifyChannel")}</option>
                {(notifyChannels.data ?? []).map((ch: any) => (
                  <option key={ch.name} value={ch.name}>
                    {ch.name} · {ch.type}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={subscriptionEnabled ?? Boolean(reportSubscription.data?.subscription?.enabled)}
                  onChange={(e) => setSubscriptionEnabled(e.target.checked)}
                />
                {t("page.analytics.enableSubscription")}
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={subscriptionAuto ?? Boolean(reportSubscription.data?.subscription?.auto_on_publish)}
                  onChange={(e) => setSubscriptionAuto(e.target.checked)}
                />
                {t("page.analytics.autoNotifyOnPublish")}
              </label>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={saveSubscription.isPending}
            onClick={() => saveSubscription.mutate()}
          >
            <Save className="h-4 w-4" />
            {t("page.analytics.saveSubscription")}
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
            disabled={testSubscription.isPending}
            onClick={() => testSubscription.mutate()}
          >
            <Send className="h-4 w-4" />
            {t("page.analytics.testSubscription")}
          </button>
        </div>
        ) : null}
        {showReportSubscription && testSubscription.isError ? <ErrorBlock message={(testSubscription.error as Error).message} /> : null}
        {showReportSubscription && testSubscription.data ? (
          <pre className="mb-4 max-h-40 overflow-auto rounded-2xl bg-slate-950 p-3 text-xs text-slate-100">
            {JSON.stringify(testSubscription.data.results ?? testSubscription.data, null, 2)}
          </pre>
        ) : null}
        {showReportAssets || showReportActionTasks ? (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {(reports.data?.items ?? []).map((report: any) => {
            const draft = reportMetaDraft(report);
            const actionDraft = reportActionDraft(report);
            const actionPreview = reportActionPreviews[String(report.id)] ?? [];
            const attribution = report.attribution && typeof report.attribution === "object" ? report.attribution : null;
            const attributionPreview = reportAttributionPreviews[String(report.id)] ?? [];
            return (
            <article key={report.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {report.pinned ? <Pin className="h-4 w-4 text-amber-500" /> : null}
                    <FileText className="h-4 w-4 text-[var(--brand)]" />
                    <h3 className="truncate text-sm font-semibold text-[var(--text)]">{report.title}</h3>
                  </div>
                  <p className="mt-1 font-mono text-xs text-[var(--muted)]">{report.created_at}</p>
                </div>
                {showReportAssets ? (
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-rose-500 disabled:opacity-50"
                    disabled={deleteReport.isPending}
                    onClick={() => deleteReport.mutate(String(report.id))}
                    title={t("page.analytics.deleteReport")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-medium text-[var(--muted-strong)]">
                  {t(`page.analytics.reportStatus.${report.status || "draft"}`)}
                </span>
                {report.owner ? (
                  <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--muted-strong)]">
                    {t("page.analytics.reportOwner")}: {report.owner}
                  </span>
                ) : null}
                {attribution ? (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${attribution.risk_level === "high" ? "bg-red-50 text-red-700" : attribution.risk_level === "medium" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {t("page.analytics.attributionBadge", { score: attribution.score ?? 0, level: attribution.risk_level })}
                  </span>
                ) : null}
                <a
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text)] hover:bg-[var(--surface-muted)]"
                  href={api.analyticsReportMarkdownUrl(String(report.id))}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("page.analytics.exportMarkdown")}
                </a>
              </div>
              {(report.tags ?? []).length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(report.tags ?? []).map((tag: string) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-xs text-[var(--brand)]">
                      <Tags className="h-3 w-3" />
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {report.question ? <p className="mt-3 text-xs font-medium text-[var(--muted-strong)]">{report.question}</p> : null}
              <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm text-[var(--muted)]">{report.answer}</p>
              {report.note ? <p className="mt-3 rounded-xl bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted-strong)]">{report.note}</p> : null}
              {(report.action_task_ids ?? []).length ? (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  {t("page.analytics.generatedTasks")}: {(report.action_task_ids ?? []).join(", ")}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {(report.highlights ?? []).slice(0, 3).map((h: string) => (
                  <span key={h} className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--muted-strong)]">
                    {h}
                  </span>
                ))}
              </div>
              {attribution ? (
                <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--text)]">
                      <Brain className="h-3.5 w-3.5 text-[var(--brand)]" />
                      {t("page.analytics.smartAttribution")}
                    </h4>
                    <span className="text-xs text-[var(--muted)]">{t("page.analytics.healthScore", { score: attribution.score ?? 0 })}</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {(attribution.drivers ?? []).slice(0, 3).map((driver: any) => (
                      <p key={driver.factor || driver.label} className="text-xs leading-5 text-[var(--muted-strong)]">
                        <span className={driver.impact === "negative" ? "text-red-600" : "text-emerald-600"}>{driver.label}</span>
                        <span className="mx-1">·</span>
                        {driver.explanation}
                      </p>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {showReportAssets ? (
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                      disabled={refreshAttribution.isPending}
                      onClick={() => refreshAttribution.mutate(String(report.id))}
                    >
                      {t("page.analytics.refreshAttribution")}
                    </button>
                    ) : null}
                    {showReportActionTasks ? (
                    <>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                        disabled={previewAttributionTasks.isPending}
                        onClick={() => previewAttributionTasks.mutate({ id: String(report.id), draft: { priority: actionDraft.priority, owner_id: actionDraft.owner_id, dev_tool: actionDraft.dev_tool } })}
                      >
                        {t("page.analytics.previewAttributionTasks")}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        disabled={createAttributionTasks.isPending}
                        onClick={() => createAttributionTasks.mutate({ id: String(report.id), draft: { priority: actionDraft.priority, owner_id: actionDraft.owner_id, dev_tool: actionDraft.dev_tool } })}
                      >
                        {t("page.analytics.createAttributionTasks")}
                      </button>
                    </>
                    ) : null}
                  </div>
                  {attributionPreview.length ? (
                    <ul className="mt-3 space-y-1 rounded-lg bg-[var(--surface)] p-2">
                      {attributionPreview.map((item: any) => (
                        <li key={item.source_report_id || item.title} className="text-xs text-[var(--muted-strong)]">
                          <span className="font-mono text-[var(--brand)]">{item.priority}</span>
                          <span className="mx-1">·</span>
                          {item.title}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {showReportAssets ? (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                  disabled={updateReportStatus.isPending || report.status === "published"}
                  onClick={() => updateReportStatus.mutate({ id: String(report.id), status: "published" })}
                >
                  <Send className="h-3.5 w-3.5" />
                  {t("page.analytics.publishReport")}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                  disabled={updateReportStatus.isPending || report.status === "archived"}
                  onClick={() => updateReportStatus.mutate({ id: String(report.id), status: "archived" })}
                >
                  <Archive className="h-3.5 w-3.5" />
                  {t("page.analytics.archiveReport")}
                </button>
                {report.status === "archived" ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={updateReportStatus.isPending}
                    onClick={() => updateReportStatus.mutate({ id: String(report.id), status: "draft" })}
                  >
                  {t("page.analytics.restoreDraft")}
                  </button>
                ) : null}
              </div>
              ) : null}
              {showReportAssets ? (
              <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]"
                    value={draft.title}
                    onChange={(e) => patchReportMetaDraft(report, { title: e.target.value })}
                    placeholder={t("page.analytics.reportTitlePh")}
                  />
                  <input
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]"
                    value={draft.owner}
                    onChange={(e) => patchReportMetaDraft(report, { owner: e.target.value })}
                    placeholder={t("page.analytics.reportOwnerPh")}
                  />
                </div>
                <input
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]"
                  value={draft.tags}
                  onChange={(e) => patchReportMetaDraft(report, { tags: e.target.value })}
                  placeholder={t("page.analytics.reportTagsPh")}
                />
                <textarea
                  className="min-h-20 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]"
                  value={draft.note}
                  onChange={(e) => patchReportMetaDraft(report, { note: e.target.value })}
                  placeholder={t("page.analytics.reportNotePh")}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-xs text-[var(--text)]">
                    <input
                      type="checkbox"
                      checked={draft.pinned}
                      onChange={(e) => patchReportMetaDraft(report, { pinned: e.target.checked })}
                    />
                    {t("page.analytics.pinReport")}
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={updateReportMeta.isPending || !draft.title.trim()}
                    onClick={() => updateReportMeta.mutate({ id: String(report.id), meta: draft })}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {t("page.analytics.saveReportMeta")}
                  </button>
                </div>
              </div>
              ) : null}
              {showReportAssets ? (
              <div className="mt-3 grid gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <select
                  className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]"
                  value={reportChannels[String(report.id)] ?? ""}
                  onChange={(e) => setReportChannels((prev) => ({ ...prev, [String(report.id)]: e.target.value }))}
                >
                  <option value="">{t("page.analytics.pickNotifyChannel")}</option>
                  {(notifyChannels.data ?? []).map((ch: any) => (
                    <option key={ch.name} value={ch.name}>
                      {ch.name} · {ch.type}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                  disabled={notifyReport.isPending || !reportChannels[String(report.id)]}
                  onClick={() => notifyReport.mutate({ id: String(report.id), channel: reportChannels[String(report.id)] })}
                >
                  <Send className="h-3.5 w-3.5" />
                  {t("page.analytics.notifyReport")}
                </button>
              </div>
              ) : null}
              {showReportActionTasks ? (
              <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-[var(--brand)]" />
                  <h4 className="text-xs font-semibold text-[var(--text)]">{t("page.analytics.actionTasks")}</h4>
                </div>
                <div className="grid gap-2 sm:grid-cols-[5rem_6rem_minmax(0,1fr)_8rem]">
                  <input
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]"
                    type="number"
                    min={1}
                    max={8}
                    value={actionDraft.max_tasks}
                    onChange={(e) => patchReportActionDraft(report, { max_tasks: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })}
                    title={t("page.analytics.maxTasks")}
                  />
                  <select
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]"
                    value={actionDraft.priority}
                    onChange={(e) => patchReportActionDraft(report, { priority: e.target.value })}
                  >
                    {["P0", "P1", "P2", "P3"].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <ProjectOwnerSelect
                    value={actionDraft.owner_id}
                    onChange={(owner_id) => patchReportActionDraft(report, { owner_id: owner_id })}
                    placeholder={t("page.analytics.actionAssigneePh")}
                  />
                  <input
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]"
                    value={actionDraft.dev_tool}
                    onChange={(e) => patchReportActionDraft(report, { dev_tool: e.target.value })}
                    placeholder={t("page.analytics.actionToolPh")}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    disabled={previewActionTasks.isPending}
                    onClick={() => previewActionTasks.mutate({ id: String(report.id), draft: actionDraft })}
                  >
                    <ListChecks className="h-3.5 w-3.5" />
                    {t("page.analytics.previewActionTasks")}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    disabled={createActionTasks.isPending}
                    onClick={() => createActionTasks.mutate({ id: String(report.id), draft: actionDraft })}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {t("page.analytics.createActionTasks")}
                  </button>
                </div>
                {actionPreview.length ? (
                  <ul className="space-y-1 rounded-xl bg-[var(--surface-muted)] p-3">
                    {actionPreview.map((item: any) => (
                      <li key={item.id || item.title} className="text-xs text-[var(--muted-strong)]">
                        <span className="font-mono text-[var(--brand)]">{item.id || item.priority}</span>
                        <span className="mx-1">·</span>
                        {item.title}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              ) : null}
              {report.last_notified_at ? (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {t("page.analytics.lastNotified")}: {report.last_notified_at}
                </p>
              ) : null}
            </article>
            );
          })}
          {!(reports.data?.items ?? []).length ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">
              {t("page.analytics.noReports")}
            </div>
          ) : null}
        </div>
        ) : null}
        </Card>
      ) : null}

      {show("catalog") || show("lineage") ? (
        <div className={`grid gap-4 ${show("catalog") && show("lineage") ? "xl:grid-cols-[minmax(0,1fr)_28rem]" : ""}`}>
        {show("catalog") ? (
        <Card
          className={catalogLayout === "module" ? "border-0 bg-transparent p-0 shadow-none" : ""}
          title={catalogLayout === "module" ? undefined : t("page.analytics.dataGovernance")}
          actions={
            catalogLayout === "module" ? undefined : (
              <a className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]" href={api.analyticsExportCsvUrl()} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4" />
                {t("page.analytics.exportCsv")}
              </a>
            )
          }
        >
          {catalog.error ? <ErrorBlock message={(catalog.error as Error).message} /> : null}
          {assets.error ? <ErrorBlock message={(assets.error as Error).message} /> : null}
          {metricsCenter.error ? <ErrorBlock message={(metricsCenter.error as Error).message} /> : null}
          {tags.error ? <ErrorBlock message={(tags.error as Error).message} /> : null}
	          {catalogChrome ? <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
	            <MetricTile label={t("page.analytics.assets")} value={assets.data?.summary?.assets ?? 0} />
	            <MetricTile label={t("page.analytics.metrics")} value={assets.data?.summary?.metrics ?? catalog.data?.total ?? 0} />
	            <MetricTile label={t("page.analytics.tags")} value={assets.data?.summary?.tags ?? 0} />
	            <MetricTile label={t("page.analytics.dataServices")} value={assets.data?.summary?.services ?? dataServices.data?.total ?? 0} />
	            <MetricTile label={t("page.analytics.devTemplates")} value={assets.data?.summary?.dev_templates ?? devTemplates.data?.total ?? 0} />
	            <MetricTile label={t("page.analytics.qualityBlocked")} value={assets.data?.summary?.quality_blocked ?? 0} />
	          </div> : null}
	          {catalogChrome ? <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2">
	            <div className="grid gap-2 md:grid-cols-5">
	              {(["assets", "metrics", "services", "quality", "development"] as CatalogPanel[]).map((panel) => (
	                <button
	                  key={panel}
	                  type="button"
	                  className={`rounded-xl px-3 py-2 text-left text-sm font-medium transition ${activeCatalogPanel === panel ? "bg-brand-600 text-white shadow-sm" : "text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"}`}
	                  onClick={() => setCatalogPanel(panel)}
	                >
	                  <span className="block">{t(`page.analytics.catalogPanel.${panel}`)}</span>
	                  <span className={`mt-1 block text-xs font-normal ${activeCatalogPanel === panel ? "text-white/80" : "text-[var(--muted)]"}`}>{t(`page.analytics.catalogPanelHint.${panel}`)}</span>
	                </button>
	              ))}
	            </div>
	          </div> : null}
	          <div className={`${activeCatalogPanel === "assets" ? "grid" : "hidden"} mb-4 gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-[minmax(0,1fr)_12rem_auto_auto_auto]`}>
            <input
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
              value={assetQuery}
              onChange={(e) => setAssetQuery(e.target.value)}
              placeholder={t("page.analytics.searchAssets")}
            />
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
              value={assetStatus}
              onChange={(e) => setAssetStatus(e.target.value)}
            >
              <option value="">{t("page.analytics.allStatuses")}</option>
              <option value="active">active</option>
              <option value="planned">planned</option>
              <option value="paused">paused</option>
              <option value="deprecated">deprecated</option>
            </select>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-50"
              disabled={evaluateQuality.isPending}
              onClick={() => evaluateQuality.mutate()}
            >
              {t("page.analytics.evaluateQuality")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-50"
              disabled={governanceTasks.isPending}
              onClick={() => governanceTasks.mutate(true)}
            >
              {t("page.analytics.previewGovernanceTasks")}
            </button>
            <button
              type="button"
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={governanceTasks.isPending}
              onClick={() => governanceTasks.mutate(false)}
            >
              {t("page.analytics.createGovernanceTasks")}
            </button>
          </div>
          {evaluateQuality.data ? (
            <pre className="mb-4 max-h-48 overflow-auto rounded-2xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(evaluateQuality.data.items ?? [], null, 2)}</pre>
          ) : null}
          {governanceTasks.data ? (
            <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
              {governanceTasks.data.dry_run ? t("page.analytics.governanceTaskPreview", { count: governanceTasks.data.items?.length ?? 0 }) : t("page.analytics.governanceTaskCreated", { count: governanceTasks.data.created ?? 0 })}
            </div>
          ) : null}
          {alertTasks.data ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {alertTasks.data.dry_run ? t("page.analytics.alertTaskPreview", { count: alertTasks.data.items?.length ?? 0 }) : t("page.analytics.alertTaskCreated", { count: alertTasks.data.created ?? 0 })}
            </div>
          ) : null}
          {devTemplateTasks.data ? (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              {devTemplateTasks.data.dry_run ? t("page.analytics.devTaskPreview", { count: devTemplateTasks.data.items?.length ?? 0 }) : t("page.analytics.devTaskCreated", { count: devTemplateTasks.data.created ?? 0 })}
            </div>
          ) : null}
          {devSchedule.data ? (
            <div className="mb-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200">
              {devSchedule.data.dry_run
                ? t("page.analytics.devSchedulePreview", { count: devSchedule.data.summary?.packets ?? 0, gates: devSchedule.data.summary?.quality_gates ?? 0 })
                : t("page.analytics.devScheduleApplied", { count: devSchedule.data.created ?? 0, packets: devSchedule.data.summary?.packets ?? 0 })}
            </div>
          ) : null}
          {devRunbook.data ? (
            <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
              {devRunbook.data.dry_run
                ? t("page.analytics.devRunbookPreview", { count: devRunbook.data.summary?.steps ?? 0 })
                : t("page.analytics.devRunbookCreated", { count: devRunbook.data.created ?? 0 })}
            </div>
          ) : null}
          {devEvidenceTasks.data ? (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {devEvidenceTasks.data.dry_run ? t("page.analytics.devEvidenceTaskPreview", { count: devEvidenceTasks.data.items?.length ?? 0 }) : t("page.analytics.devEvidenceTaskCreated", { count: devEvidenceTasks.data.created ?? 0 })}
            </div>
          ) : null}
          {devEvidenceNotify.data ? (
            <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-200">
              {devEvidenceNotify.data.dry_run ? t("page.analytics.devEvidenceNotifyPreview", { count: devEvidenceNotify.data.total ?? 0 }) : t("page.analytics.devEvidenceNotifySent", { count: Object.keys(devEvidenceNotify.data.results ?? {}).length })}
            </div>
          ) : null}
	          <div className={`${activeCatalogPanel === "assets" || activeCatalogPanel === "metrics" ? "grid" : "hidden"} gap-4 2xl:grid-cols-[minmax(0,1.3fr)_minmax(24rem,0.7fr)]`}>
	            <div className={`${activeCatalogPanel === "assets" ? "overflow-hidden" : "hidden"} rounded-2xl border border-[var(--border)]`}>
              <div className="grid grid-cols-[2rem_1.4fr_7rem_7rem_7rem_9rem] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
                <span />
                <span>{t("page.analytics.asset")}</span>
                <span>{t("page.analytics.domain")}</span>
                <span>{t("page.analytics.source")}</span>
                <span>{t("page.analytics.status")}</span>
                <span>{t("page.analytics.quality")}</span>
              </div>
              {(assets.data?.items ?? []).map((asset: any) => (
                <div key={asset.id} className="grid grid-cols-[2rem_1.4fr_7rem_7rem_7rem_9rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                  <input
                    type="checkbox"
                    checked={selectedAssets.includes(asset.id)}
                    onChange={(e) => setSelectedAssets((prev) => (e.target.checked ? [...prev, asset.id] : prev.filter((id) => id !== asset.id)))}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--text)]">{asset.name}</p>
                    <p className="truncate font-mono text-xs text-[var(--muted)]">{asset.id} · {asset.type}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{asset.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(asset.tags ?? []).slice(0, 4).map((tag: string) => <span key={tag} className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] text-[var(--brand)]">{tag}</span>)}
                    </div>
                  </div>
                  <span className="text-xs text-[var(--muted-strong)]">{asset.domain}</span>
                  <span className="font-mono text-xs text-[var(--muted-strong)]">{asset.source}</span>
                  <select
                    className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)]"
                    value={asset.status}
                    disabled={patchAsset.isPending}
                    onChange={(e) => patchAsset.mutate({ id: asset.id, patch: { status: e.target.value } })}
                  >
                    {["active", "planned", "paused", "deprecated"].map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  <div>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${asset.quality?.decision === "pass" ? "bg-emerald-50 text-emerald-700" : asset.quality?.decision === "block" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                      {asset.quality?.decision} · {asset.quality?.score}
                    </span>
                    <p className="mt-1 line-clamp-2 text-[10px] text-[var(--muted)]">{[...(asset.quality?.blockers ?? []), ...(asset.quality?.warnings ?? [])].join(", ") || "-"}</p>
                  </div>
                </div>
              ))}
            </div>
	            <div className={`${activeCatalogPanel === "metrics" ? "space-y-4" : "hidden"}`}>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.addMetric")}</h3>
                <div className="mt-3 grid gap-2">
                  <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder="metric id" value={metricDraft.id} onChange={(e) => setMetricDraft((v) => ({ ...v, id: e.target.value }))} />
                  <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.metricName")} value={metricDraft.name} onChange={(e) => setMetricDraft((v) => ({ ...v, name: e.target.value }))} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.domain")} value={metricDraft.domain} onChange={(e) => setMetricDraft((v) => ({ ...v, domain: e.target.value }))} />
                    <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.source")} value={metricDraft.source} onChange={(e) => setMetricDraft((v) => ({ ...v, source: e.target.value }))} />
                    <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.grain")} value={metricDraft.grain} onChange={(e) => setMetricDraft((v) => ({ ...v, grain: e.target.value }))} />
                    <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.owner")} value={metricDraft.owner} onChange={(e) => setMetricDraft((v) => ({ ...v, owner: e.target.value }))} />
                  </div>
                  <textarea className="min-h-20 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.formula")} value={metricDraft.formula} onChange={(e) => setMetricDraft((v) => ({ ...v, formula: e.target.value }))} />
                  <button type="button" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!metricDraft.id.trim() || !metricDraft.name.trim() || upsertMetric.isPending} onClick={() => upsertMetric.mutate()}>{t("common.save")}</button>
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.addTag")}</h3>
                <div className="mt-3 grid gap-2">
                  <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder="tag id" value={tagDraft.id} onChange={(e) => setTagDraft((v) => ({ ...v, id: e.target.value }))} />
                  <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.tagName")} value={tagDraft.name} onChange={(e) => setTagDraft((v) => ({ ...v, name: e.target.value }))} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.category")} value={tagDraft.category} onChange={(e) => setTagDraft((v) => ({ ...v, category: e.target.value }))} />
                    <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.owner")} value={tagDraft.owner} onChange={(e) => setTagDraft((v) => ({ ...v, owner: e.target.value }))} />
                  </div>
                  <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.targetAssets")} value={tagDraft.target_assets} onChange={(e) => setTagDraft((v) => ({ ...v, target_assets: e.target.value }))} />
                  <textarea className="min-h-20 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.tagRule")} value={tagDraft.rule} onChange={(e) => setTagDraft((v) => ({ ...v, rule: e.target.value }))} />
                  <button type="button" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!tagDraft.id.trim() || !tagDraft.name.trim() || upsertTag.isPending} onClick={() => upsertTag.mutate()}>{t("common.save")}</button>
                </div>
              </div>
            </div>
          </div>
	          <div className={`${activeCatalogPanel === "services" || activeCatalogPanel === "development" ? "grid" : "hidden"} mt-4 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.7fr)]`}>
	            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
	              <div className={`${activeCatalogPanel === "development" ? "mb-4" : "hidden"} rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 dark:border-indigo-900 dark:bg-indigo-950/20`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-200">{t("page.analytics.devOpsSummary")}</h4>
                    <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-200">{t("page.analytics.devOpsHealth", { score: devOpsSummary.data?.summary?.health ?? 0 })}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="rounded-md border border-indigo-300 px-2 py-1 text-[10px] font-medium text-indigo-800 disabled:opacity-50 dark:text-indigo-100" disabled={devRunbook.isPending} onClick={() => devRunbook.mutate(true)}>{t("page.analytics.previewDevRunbook")}</button>
                    <button type="button" className="rounded-md bg-indigo-600 px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50" disabled={devRunbook.isPending} onClick={() => devRunbook.mutate(false)}>{t("page.analytics.createDevRunbook")}</button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs lg:grid-cols-5">
                  <span className="rounded-lg bg-[var(--surface)] p-2 text-[var(--muted)]">{t("page.analytics.schedulePackets")}<b className="ml-2 text-[var(--text)]">{devOpsSummary.data?.summary?.packets ?? 0}</b></span>
                  <span className="rounded-lg bg-[var(--surface)] p-2 text-[var(--muted)]">{t("page.analytics.claimPacket")}<b className="ml-2 text-[var(--text)]">{devOpsSummary.data?.summary?.claimed_packets ?? 0}</b></span>
                  <span className="rounded-lg bg-[var(--surface)] p-2 text-[var(--muted)]">{t("page.analytics.reportPacket")}<b className="ml-2 text-[var(--text)]">{devOpsSummary.data?.summary?.reported_packets ?? 0}</b></span>
                  <span className="rounded-lg bg-[var(--surface)] p-2 text-[var(--muted)]">Warn<b className="ml-2 text-[var(--text)]">{devOpsSummary.data?.summary?.warn ?? 0}</b></span>
                  <span className="rounded-lg bg-[var(--surface)] p-2 text-[var(--muted)]">Block<b className="ml-2 text-[var(--text)]">{devOpsSummary.data?.summary?.block ?? 0}</b></span>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  {(devOpsSummary.data?.recommendations ?? []).slice(0, 4).map((rec: any) => (
                    <div key={rec.id} className="rounded-lg border border-indigo-200 bg-[var(--surface)] p-2 text-xs dark:border-indigo-900">
                      <span className="font-semibold text-[var(--text)]">{rec.priority} · {rec.title}</span>
                      <span className="mt-1 block truncate font-mono text-[10px] text-[var(--muted)]">{rec.action}</span>
                    </div>
                  ))}
                  {!(devOpsSummary.data?.recommendations ?? []).length ? (
                    <p className="rounded-lg border border-dashed border-indigo-200 bg-[var(--surface)] p-3 text-xs text-indigo-700 dark:border-indigo-900 dark:text-indigo-200">
                      {t("page.analytics.noDevOpsRecommendations")}
                    </p>
                  ) : null}
                </div>
                {devRunbook.data?.steps?.length ? (
                  <div className="mt-3 rounded-lg border border-indigo-200 bg-[var(--surface)] p-2 dark:border-indigo-900">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text)]">{t("page.analytics.devRunbook")}</span>
                      <span className="text-[10px] text-[var(--muted)]">{t("page.analytics.devRunbookSteps", { count: devRunbook.data.summary?.steps ?? 0 })}</span>
                    </div>
                    <div className="mt-2 grid gap-2">
                      {(devRunbook.data.steps ?? []).slice(0, 4).map((step: any) => (
                        <div key={step.id} className="grid gap-2 rounded-md bg-[var(--surface-muted)] p-2 text-xs md:grid-cols-[5rem_minmax(0,1fr)_6rem]">
                          <span className="font-semibold text-indigo-700 dark:text-indigo-200">{step.priority}</span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-[var(--text)]">{step.title}</span>
                            <span className="block truncate font-mono text-[10px] text-[var(--muted)]">{step.type} · {step.packet_id}</span>
                          </span>
                          <span className="truncate text-[var(--muted)]">{step.agent}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
	              <div className={`${activeCatalogPanel === "services" ? "flex" : "hidden"} flex-wrap items-center justify-between gap-3`}>
                <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.dataServices")}</h3>
                <span className="text-xs text-[var(--muted)]">{t("page.analytics.publishedServices")}: {dataServices.data?.summary?.published_services ?? 0}</span>
              </div>
	              <div className={`${activeCatalogPanel === "services" ? "grid" : "hidden"} mt-3 gap-3 lg:grid-cols-2`}>
                {(dataServices.data?.items ?? []).map((svc: any) => (
                  <article key={svc.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--text)]">{svc.name}</p>
                        <p className="truncate font-mono text-xs text-[var(--muted)]">{svc.id} · {svc.method} {svc.endpoint}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs ${svc.health?.decision === "pass" ? "bg-emerald-50 text-emerald-700" : svc.health?.decision === "block" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                        {svc.status} · {svc.health?.score}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-[var(--muted)]">{svc.description}</p>
                    <p className="mt-2 font-mono text-[10px] text-[var(--muted)]">{(svc.assets ?? []).join(", ")}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["published", "paused", "draft"].map((status) => (
                        <button
                          key={status}
                          type="button"
                          className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--text)] disabled:opacity-50"
                          disabled={publishService.isPending || svc.status === status}
                          onClick={() => publishService.mutate({ id: svc.id, status })}
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
	            <div className={`${activeCatalogPanel === "services" ? "block" : "hidden"} rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4`}>
              <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.addDataService")}</h3>
              <div className="mt-3 grid gap-2">
                <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder="service id" value={serviceDraft.id} onChange={(e) => setServiceDraft((v) => ({ ...v, id: e.target.value }))} />
                <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.serviceName")} value={serviceDraft.name} onChange={(e) => setServiceDraft((v) => ({ ...v, name: e.target.value }))} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.serviceType")} value={serviceDraft.type} onChange={(e) => setServiceDraft((v) => ({ ...v, type: e.target.value }))} />
                  <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.owner")} value={serviceDraft.owner} onChange={(e) => setServiceDraft((v) => ({ ...v, owner: e.target.value }))} />
                </div>
                <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.endpoint")} value={serviceDraft.endpoint} onChange={(e) => setServiceDraft((v) => ({ ...v, endpoint: e.target.value }))} />
                <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.serviceAssets")} value={serviceDraft.assets} onChange={(e) => setServiceDraft((v) => ({ ...v, assets: e.target.value }))} />
                <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.serviceMetrics")} value={serviceDraft.metrics} onChange={(e) => setServiceDraft((v) => ({ ...v, metrics: e.target.value }))} />
                <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.serviceConsumers")} value={serviceDraft.consumers} onChange={(e) => setServiceDraft((v) => ({ ...v, consumers: e.target.value }))} />
                <button type="button" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!serviceDraft.id.trim() || !serviceDraft.name.trim() || upsertService.isPending} onClick={() => upsertService.mutate()}>{t("common.save")}</button>
              </div>
            </div>
          </div>
	          <div className={`${activeCatalogPanel === "quality" ? "block" : "hidden"} mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.qualityAlerts")}</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">{t("page.analytics.selectedAlerts", { count: selectedAlerts.length })}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-50" disabled={alertTasks.isPending} onClick={() => alertTasks.mutate(true)}>{t("page.analytics.previewAlertTasks")}</button>
                <button type="button" className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" disabled={alertTasks.isPending} onClick={() => alertTasks.mutate(false)}>{t("page.analytics.createAlertTasks")}</button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {(qualityAlerts.data?.items ?? []).map((alert: any) => (
                <label key={alert.id} className="grid cursor-pointer gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_5rem]">
                  <input
                    type="checkbox"
                    checked={selectedAlerts.includes(alert.id)}
                    onChange={(e) => setSelectedAlerts((prev) => (e.target.checked ? [...prev, alert.id] : prev.filter((id) => id !== alert.id)))}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--text)]">{alert.title}</span>
                    <span className="mt-1 block line-clamp-2 text-xs text-[var(--muted)]">{alert.recommendation}</span>
                    <span className="mt-1 block font-mono text-[10px] text-[var(--muted)]">{(alert.blockers ?? []).join(", ") || (alert.warnings ?? []).join(", ") || "-"}</span>
                  </span>
                  <span className={`rounded-full px-2 py-1 text-center text-xs font-semibold ${alert.severity === "critical" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                    {alert.severity}
                  </span>
                </label>
              ))}
              {!(qualityAlerts.data?.items ?? []).length ? <p className="text-sm text-[var(--muted)]">{t("page.analytics.noQualityAlerts")}</p> : null}
            </div>
          </div>
	          <div className={`${activeCatalogPanel === "development" ? "grid" : "hidden"} mt-4 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.7fr)]`}>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.devTemplates")}</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">{t("page.analytics.selectedDevTemplates", { count: selectedDevTemplates.length })}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-50" disabled={devSchedule.isPending} onClick={() => devSchedule.mutate(true)}>{t("page.analytics.previewDevSchedule")}</button>
                  <button type="button" className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" disabled={devSchedule.isPending} onClick={() => devSchedule.mutate(false)}>{t("page.analytics.applyDevSchedule")}</button>
                  <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-50" disabled={devTemplateTasks.isPending} onClick={() => devTemplateTasks.mutate(true)}>{t("page.analytics.previewDevTasks")}</button>
                  <button type="button" className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" disabled={devTemplateTasks.isPending} onClick={() => devTemplateTasks.mutate(false)}>{t("page.analytics.createDevTasks")}</button>
                </div>
              </div>
              {devSchedule.data ? (
                <div className="mt-3 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:grid-cols-[14rem_minmax(0,1fr)]">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span className="rounded-lg bg-[var(--surface)] p-2 text-[var(--muted)]">{t("page.analytics.schedulePackets")}<b className="ml-2 text-[var(--text)]">{devSchedule.data.summary?.packets ?? 0}</b></span>
                    <span className="rounded-lg bg-[var(--surface)] p-2 text-[var(--muted)]">{t("page.analytics.scheduleStages")}<b className="ml-2 text-[var(--text)]">{devSchedule.data.summary?.stages ?? 0}</b></span>
                    <span className="rounded-lg bg-[var(--surface)] p-2 text-[var(--muted)]">{t("page.analytics.scheduleGates")}<b className="ml-2 text-[var(--text)]">{devSchedule.data.summary?.quality_gates ?? 0}</b></span>
                    <span className="rounded-lg bg-[var(--surface)] p-2 text-[var(--muted)]">{t("page.analytics.eventWakeups")}<b className="ml-2 text-[var(--text)]">{devSchedule.data.summary?.event_wakeups ?? 0}</b></span>
                  </div>
                  <div className="grid gap-2">
                    {(devSchedule.data.agent_packets ?? []).slice(0, 4).map((packet: any) => (
                      <div key={packet.packet_id} className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-[var(--text)]">{packet.title}</span>
                          <span className="block truncate font-mono text-[10px] text-[var(--muted)]">{packet.packet_id} · lane {packet.lane}</span>
                        </span>
                        <span className="text-[var(--muted)]">{packet.assigned_to}</span>
                        <span className={packet.ready ? "text-emerald-600" : "text-amber-600"}>{packet.ready ? "ready" : "blocked"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {(devTemplates.data?.items ?? []).map((tpl: any) => (
                  <label key={tpl.id} className="grid cursor-pointer gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_6rem]">
                    <input
                      type="checkbox"
                      checked={selectedDevTemplates.includes(tpl.id)}
                      onChange={(e) => setSelectedDevTemplates((prev) => (e.target.checked ? [...prev, tpl.id] : prev.filter((id) => id !== tpl.id)))}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[var(--text)]">{tpl.name}</span>
                      <span className="mt-1 block font-mono text-xs text-[var(--muted)]">{tpl.type} · {tpl.engine}</span>
                      <span className="mt-1 block line-clamp-2 text-xs text-[var(--muted)]">{tpl.description}</span>
                      <span className="mt-1 block font-mono text-[10px] text-[var(--muted)]">{(tpl.quality_gates ?? []).join(", ")}</span>
                    </span>
                    <span className="rounded-full bg-[var(--brand-soft)] px-2 py-1 text-center text-xs font-semibold text-[var(--brand)]">{tpl.status}</span>
                  </label>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("page.analytics.devScheduleHistory")}</h4>
                  <span className="text-xs text-[var(--muted)]">{t("page.analytics.devScheduleTotal", { count: devSchedules.data?.total ?? 0 })}</span>
                </div>
                <div className="mt-3 grid gap-2">
                  {(devSchedules.data?.items ?? []).slice(0, 5).map((run: any) => (
                    <div key={run.id} className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs xl:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_7rem_12rem]">
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[var(--text)]">{run.id}</span>
                        <span className="block truncate text-[10px] text-[var(--muted)]">{run.created_at || "-"} · {run.policy || "-"} · {run.status || "applied"}</span>
                      </span>
                      <span className="text-[var(--muted)]">{t("page.analytics.scheduleTemplates")}: <b className="text-[var(--text)]">{run.templates ?? 0}</b></span>
                      <span className="text-[var(--muted)]">{t("page.analytics.schedulePackets")}: <b className="text-[var(--text)]">{run.packets ?? 0}</b></span>
                      <span className="text-[var(--muted)]">{t("page.analytics.scheduleGates")}: <b className="text-[var(--text)]">{run.quality_gates ?? 0}</b></span>
                      <span className="text-[var(--muted)]">{t("page.analytics.scheduleCreatedTasks")}: <b className="text-[var(--text)]">{run.created_tasks ?? 0}</b></span>
                      <span className="flex flex-wrap gap-1">
                        <button type="button" className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text)] disabled:opacity-50" disabled={devScheduleAction.isPending} onClick={() => devScheduleAction.mutate({ id: run.id, action: "rerun", dryRun: true })}>{t("page.analytics.previewRerun")}</button>
                        <button type="button" className="rounded-md bg-cyan-600 px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50" disabled={devScheduleAction.isPending} onClick={() => devScheduleAction.mutate({ id: run.id, action: "rerun", dryRun: false })}>{t("page.analytics.applyRerun")}</button>
                        {run.status === "archived" ? (
                          <button type="button" className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text)] disabled:opacity-50" disabled={devScheduleAction.isPending} onClick={() => devScheduleAction.mutate({ id: run.id, action: "restore" })}>{t("page.analytics.restoreSchedule")}</button>
                        ) : (
                          <button type="button" className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text)] disabled:opacity-50" disabled={devScheduleAction.isPending} onClick={() => devScheduleAction.mutate({ id: run.id, action: "archive" })}>{t("page.analytics.archiveSchedule")}</button>
                        )}
                        {run.status !== "cancelled" ? <button type="button" className="rounded-md border border-rose-200 px-2 py-1 text-[10px] text-rose-600 disabled:opacity-50" disabled={devScheduleAction.isPending} onClick={() => devScheduleAction.mutate({ id: run.id, action: "cancel" })}>{t("page.analytics.cancelSchedule")}</button> : null}
                      </span>
                    </div>
                  ))}
                  {!(devSchedules.data?.items ?? []).length ? <p className="text-sm text-[var(--muted)]">{t("page.analytics.noDevSchedules")}</p> : null}
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50/70 p-3 dark:border-cyan-900 dark:bg-cyan-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">{t("page.analytics.devAgentFeed")}</h4>
                    <p className="mt-1 text-xs text-cyan-700 dark:text-cyan-200">{t("page.analytics.devAgentFeedTotal", { count: devAgentFeed.data?.total ?? 0 })}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="h-8 w-40 rounded-md border border-cyan-300 bg-[var(--surface)] px-2 text-xs text-[var(--text)] placeholder:text-[var(--muted)]"
                      placeholder={t("page.analytics.agentFilter")}
                      value={devFeedAgent}
                      onChange={(e) => setDevFeedAgent(e.target.value)}
                    />
                    <label className="flex h-8 items-center gap-1 rounded-md border border-cyan-300 bg-[var(--surface)] px-2 text-[10px] font-medium text-cyan-800 dark:text-cyan-100">
                      <input
                        type="checkbox"
                        checked={devFeedIncludeBlocked}
                        onChange={(e) => setDevFeedIncludeBlocked(e.target.checked)}
                      />
                      {t("page.analytics.includeBlocked")}
                    </label>
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  {(devAgentFeed.data?.items ?? []).slice(0, 4).map((packet: any) => (
                    <div key={`${packet.schedule_id}-${packet.packet_id}`} className="grid gap-2 rounded-lg border border-cyan-200 bg-[var(--surface)] p-2 text-xs xl:grid-cols-[minmax(0,1fr)_6rem_7rem_10rem] dark:border-cyan-900">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-[var(--text)]">{packet.title}</span>
                        <span className="block truncate font-mono text-[10px] text-[var(--muted)]">{packet.packet_id} · {packet.schedule_id}</span>
                      </span>
                      <span className={packet.ready ? "text-emerald-600" : "text-amber-600"}>{packet.packet_status || (packet.ready ? "ready" : "blocked")}</span>
                      <span className="truncate text-[var(--muted)]">{packet.assigned_to}</span>
                      <span className="flex flex-wrap gap-1">
                        <button type="button" className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text)] disabled:opacity-50" disabled={devPacketAction.isPending} onClick={() => devPacketAction.mutate({ packet, action: "claim" })}>{t("page.analytics.claimPacket")}</button>
                        <button type="button" className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text)] disabled:opacity-50" disabled={devPacketAction.isPending} onClick={() => devPacketAction.mutate({ packet, action: "heartbeat" })}>{t("page.analytics.heartbeatPacket")}</button>
                        <button type="button" className="rounded-md bg-cyan-600 px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50" disabled={devPacketAction.isPending} onClick={() => devPacketAction.mutate({ packet, action: "report" })}>{t("page.analytics.reportPacket")}</button>
                      </span>
                    </div>
                  ))}
                  {!(devAgentFeed.data?.items ?? []).length ? <p className="text-sm text-cyan-700 dark:text-cyan-200">{t("page.analytics.noDevAgentFeed")}</p> : null}
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">{t("page.analytics.devEvidence")}</h4>
                    <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-200">
                      {t("page.analytics.devEvidenceSummary", { pass: devEvidence.data?.summary?.pass ?? 0, warn: devEvidence.data?.summary?.warn ?? 0, block: devEvidence.data?.summary?.block ?? 0 })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="h-8 rounded-md border border-emerald-300 bg-[var(--surface)] px-2 text-[10px] text-[var(--text)]" value={devEvidenceDecision} onChange={(e) => setDevEvidenceDecision(e.target.value)}>
                      <option value="">{t("page.analytics.allEvidenceDecisions")}</option>
                      <option value="pass">pass</option>
                      <option value="warn">warn</option>
                      <option value="block">block</option>
                    </select>
                    <button type="button" className="rounded-md border border-emerald-300 px-2 py-1 text-[10px] text-emerald-800 disabled:opacity-50 dark:text-emerald-100" disabled={devEvidenceTasks.isPending} onClick={() => devEvidenceTasks.mutate(true)}>{t("page.analytics.previewEvidenceTasks")}</button>
                    <button type="button" className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50" disabled={devEvidenceTasks.isPending} onClick={() => devEvidenceTasks.mutate(false)}>{t("page.analytics.createEvidenceTasks")}</button>
                    <select className="rounded-md border border-emerald-300 bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text)]" value={evidenceChannel} onChange={(e) => setEvidenceChannel(e.target.value)}>
                      <option value="">{t("page.analytics.selectNotifyChannel")}</option>
                      {(notifyChannels.data ?? []).map((ch: any) => <option key={ch.name} value={ch.name}>{ch.name}</option>)}
                    </select>
                    <button type="button" className="rounded-md border border-purple-300 px-2 py-1 text-[10px] text-purple-800 disabled:opacity-50 dark:text-purple-100" disabled={devEvidenceNotify.isPending} onClick={() => devEvidenceNotify.mutate(true)}>{t("page.analytics.previewEvidenceNotify")}</button>
                    <button type="button" className="rounded-md bg-purple-600 px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50" disabled={devEvidenceNotify.isPending || !evidenceChannel} onClick={() => devEvidenceNotify.mutate(false)}>{t("page.analytics.sendEvidenceNotify")}</button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  {(devEvidence.data?.items ?? []).slice(0, 4).map((item: any) => (
                    <div key={`${item.schedule_id}-${item.packet_id}`} className="grid gap-2 rounded-lg border border-emerald-200 bg-[var(--surface)] p-2 text-xs xl:grid-cols-[minmax(0,1fr)_5rem_6rem_8rem] dark:border-emerald-900">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-[var(--text)]">{item.title}</span>
                        <span className="block truncate font-mono text-[10px] text-[var(--muted)]">{item.packet_id} · {item.reported_at || "-"}</span>
                      </span>
                      <span className={item.quality?.decision === "pass" ? "text-emerald-600" : item.quality?.decision === "block" ? "text-rose-600" : "text-amber-600"}>{item.quality?.decision || "-"}</span>
                      <span className="text-[var(--muted)]">{t("page.analytics.qualityScore")}: <b className="text-[var(--text)]">{item.quality?.score ?? 0}</b></span>
                      <span className="truncate text-[var(--muted)]">{(item.quality?.missing_required_gates ?? []).join(", ") || item.report?.status || "-"}</span>
                    </div>
                  ))}
                  {!(devEvidence.data?.items ?? []).length ? <p className="text-sm text-emerald-700 dark:text-emerald-200">{t("page.analytics.noDevEvidence")}</p> : null}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.addDevTemplate")}</h3>
              <div className="mt-3 grid gap-2">
                <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder="template id" value={devTemplateDraft.id} onChange={(e) => setDevTemplateDraft((v) => ({ ...v, id: e.target.value }))} />
                <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.templateName")} value={devTemplateDraft.name} onChange={(e) => setDevTemplateDraft((v) => ({ ...v, name: e.target.value }))} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.templateType")} value={devTemplateDraft.type} onChange={(e) => setDevTemplateDraft((v) => ({ ...v, type: e.target.value }))} />
                  <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.engine")} value={devTemplateDraft.engine} onChange={(e) => setDevTemplateDraft((v) => ({ ...v, engine: e.target.value }))} />
                </div>
                <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.owner")} value={devTemplateDraft.owner} onChange={(e) => setDevTemplateDraft((v) => ({ ...v, owner: e.target.value }))} />
                <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.serviceAssets")} value={devTemplateDraft.assets} onChange={(e) => setDevTemplateDraft((v) => ({ ...v, assets: e.target.value }))} />
                <input className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.templateGates")} value={devTemplateDraft.quality_gates} onChange={(e) => setDevTemplateDraft((v) => ({ ...v, quality_gates: e.target.value }))} />
                <textarea className="min-h-20 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" placeholder={t("page.analytics.templateDesc")} value={devTemplateDraft.description} onChange={(e) => setDevTemplateDraft((v) => ({ ...v, description: e.target.value }))} />
                <button type="button" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!devTemplateDraft.id.trim() || !devTemplateDraft.name.trim() || upsertDevTemplate.isPending} onClick={() => upsertDevTemplate.mutate()}>{t("common.save")}</button>
              </div>
            </div>
          </div>
	          <div className={`${activeCatalogPanel === "metrics" ? "grid" : "hidden"} mt-4 gap-4 xl:grid-cols-2`}>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.metrics")}</h3>
              <div className="mt-3 max-h-80 space-y-2 overflow-auto">
                {(metricsCenter.data?.items ?? []).map((m: any) => (
                  <div key={m.id || m.key} className="rounded-xl bg-[var(--surface-muted)] p-3">
                    <p className="text-sm font-semibold text-[var(--text)]">{m.name}</p>
                    <p className="font-mono text-xs text-[var(--muted)]">{m.id || m.key} · {m.domain} · {m.source}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{m.description || m.formula}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.tags")}</h3>
              <div className="mt-3 max-h-80 space-y-2 overflow-auto">
                {(tags.data?.items ?? []).map((tag: any) => (
                  <div key={tag.id} className="rounded-xl bg-[var(--surface-muted)] p-3">
                    <p className="text-sm font-semibold text-[var(--text)]">{tag.name}</p>
                    <p className="font-mono text-xs text-[var(--muted)]">{tag.id} · {tag.category} · {tag.owner}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{tag.rule || tag.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
        ) : null}

        {show("lineage") ? (
        <Card title={t("page.analytics.lineage")}>
          {lineage.error ? <ErrorBlock message={(lineage.error as Error).message} /> : null}
          <div className="space-y-3">
            {(lineage.data?.nodes ?? []).map((node: any) => (
              <div key={node.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <div className="flex items-center gap-2">
                  {node.type === "dataset" || node.type === "ai_dataset" ? <LibraryBig className="h-4 w-4 text-[var(--brand)]" /> : <GitBranch className="h-4 w-4 text-[var(--brand)]" />}
                  <span className="font-mono text-xs text-[var(--text)]">{node.label}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">{node.type}</p>
              </div>
            ))}
          </div>
          <pre className="mt-3 max-h-52 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(lineage.data?.edges ?? [], null, 2)}</pre>
        </Card>
        ) : null}
      </div>
      ) : null}

      {show("exchange") ? (
        <Card
        title={t("page.analytics.dataExchange")}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <RefreshButton onClick={() => void exchange.refetch()} pending={exchange.isFetching} />
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
              disabled={createExportJob.isPending}
              onClick={() => createExportJob.mutate()}
            >
              <Clock3 className="h-4 w-4" />
              {t("page.analytics.createExportJob")}
            </button>
            <a
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
              href={api.dataExchangeExportUrl(selectedExchangeModules)}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="h-4 w-4" />
              {t("page.analytics.exportJson")}
            </a>
          </div>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,0.9fr)]">
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)]">{t("page.analytics.dataExchangeDesc")}</p>
            {exchange.error ? <ErrorBlock message={(exchange.error as Error).message} /> : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {exchangeRows.map((m: any) => (
                <button
                  key={m.name}
                  type="button"
                  className={`rounded-2xl border p-4 text-left transition ${
                    exchangeModules.includes(String(m.name))
                      ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--text)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                  }`}
                  onClick={() => toggleExchangeModule(String(m.name))}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Database className="h-4 w-4 text-[var(--brand)]" />
                    <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] uppercase text-[var(--muted)]">
                      {m.kind}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold">{moduleLabel(m, String(m.name))}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{m.count ?? 0}</p>
                </button>
              ))}
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">
              <span className="font-medium text-[var(--text)]">{t("page.analytics.selectedModules")}: </span>
              {selectedExchangeModules.join(", ") || "-"}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-[var(--brand)]" />
              <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.importJson")}</h3>
            </div>
            <p className="text-xs text-[var(--muted)]">{t("page.analytics.sqlImportHint")}</p>
            <textarea
              className="min-h-48 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--brand)]"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={t("page.analytics.importJsonPh")}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                disabled={!importText.trim() || previewImport.isPending}
                onClick={() => previewImport.mutate()}
              >
                {t("page.analytics.previewImport")}
              </button>
              <button
                type="button"
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={!importText.trim() || runImport.isPending}
                onClick={() => runImport.mutate()}
              >
                {t("page.analytics.runImport")}
              </button>
            </div>
            {previewImport.isError ? (
              <ErrorBlock message={(previewImport.error as Error).message} />
            ) : null}
            {runImport.isError ? <ErrorBlock message={(runImport.error as Error).message} /> : null}
            {previewImport.data ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h4 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.importPreview")}</h4>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {Object.entries(previewImport.data.modules ?? {}).map(([name, info]: [string, any]) => (
                    <div key={name} className="rounded-xl bg-[var(--surface-muted)] p-3 text-xs">
                      <p className="font-mono font-semibold text-[var(--text)]">{name}</p>
                      <p className="mt-1 text-[var(--muted)]">
                        {t("page.analytics.rows")}: {info.rows ?? 0} · {t("page.analytics.uniqueIds")}: {info.unique_ids ?? 0}
                      </p>
                      <p className="text-[var(--muted)]">
                        {t("page.analytics.missingIds")}: {info.missing_ids ?? 0} · {t("page.analytics.duplicates")}: {info.duplicates ?? 0}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-xl bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">
                  <p className="font-semibold text-[var(--text)]">{t("page.analytics.importWarnings")}</p>
                  {(previewImport.data.warnings ?? []).length ? (
                    <ul className="mt-1 list-disc pl-5">
                      {(previewImport.data.warnings ?? []).map((w: string) => <li key={w}>{w}</li>)}
                    </ul>
                  ) : (
                    <p className="mt-1">{t("page.analytics.noWarnings")}</p>
                  )}
                </div>
              </div>
            ) : null}
            {runImport.data ? (
              <pre className="max-h-48 overflow-auto rounded-2xl bg-slate-950 p-3 text-xs text-slate-100">
                {JSON.stringify(runImport.data, null, 2)}
              </pre>
            ) : null}
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-[var(--brand)]" />
              <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.analytics.exchangeJobs")}</h3>
            </div>
            <RefreshButton onClick={() => void exchangeJobs.refetch()} pending={exchangeJobs.isFetching} />
          </div>
          {exchangeJobs.error ? <ErrorBlock message={(exchangeJobs.error as Error).message} /> : null}
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("page.analytics.jobType")}</th>
                  <th className="px-4 py-3 font-medium">{t("page.analytics.status")}</th>
                  <th className="px-4 py-3 font-medium">{t("page.analytics.modules")}</th>
                  <th className="px-4 py-3 font-medium">{t("page.analytics.dataTotal")}</th>
                  <th className="px-4 py-3 font-medium">{t("page.analytics.actor")}</th>
                  <th className="px-4 py-3 font-medium">{t("page.analytics.createdAt")}</th>
                  <th className="px-4 py-3 font-medium">{t("page.analytics.action")}</th>
                </tr>
              </thead>
              <tbody>
                {(exchangeJobs.data?.items ?? []).map((job: any) => (
                  <tr key={job.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-3 font-mono text-xs text-[var(--text)]">{job.type}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--muted-strong)]">{job.status}</span>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {(job.modules ?? []).join(", ")}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--text)]">{job.total ?? 0}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{job.actor || "-"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">{job.created_at || "-"}</td>
                    <td className="px-4 py-3">
                      {job.download_url ? (
                        <a className="text-xs font-medium text-[var(--brand)] underline" href={job.download_url} target="_blank" rel="noreferrer">
                          {t("page.analytics.download")}
                        </a>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!(exchangeJobs.data?.items ?? []).length ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-[var(--muted)]" colSpan={7}>
                      {t("page.analytics.noExchangeJobs")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        </Card>
      ) : null}

      {show("nlq") ? (
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
        {nlq.data?.answer ? (
          <button
            type="button"
            className="ml-2 mt-2 inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
            disabled={saveReport.isPending}
            onClick={() => saveReport.mutate("nlq")}
          >
            <Save className="h-4 w-4" />
            {t("page.analytics.saveAsReport")}
          </button>
        ) : null}
        {nlq.isError ? <p className="mt-2 text-sm text-rose-600">{(nlq.error as Error).message}</p> : null}
        {nlq.data?.answer ? (
          <p className="mt-3 whitespace-pre-wrap rounded-lg border border-brand-200/80 bg-brand-50/80 p-4 text-sm dark:border-brand-800/50 dark:bg-slate-800/80">
            {nlq.data.answer}
          </p>
        ) : null}
        </Card>
      ) : null}
    </div>
  );
}
