import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Popconfirm, Select, Space, Table, Tag as AntTag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type Tab = "rules" | "runs" | "alerts" | "reports" | "impact" | "rca" | "forecast" | "subscriptions";

const TAB_KEYS: Tab[] = ["rules", "runs", "alerts", "impact", "rca", "forecast", "subscriptions", "reports"];
const TAB_HREF: Record<Tab, string> = {
  rules: "#/data/quality/rules",
  runs: "#/data/quality/runs",
  alerts: "#/data/quality/alerts",
  reports: "#/data/quality/reports",
  impact: "#/data/quality/impact",
  rca: "#/data/quality/rca",
  forecast: "#/data/quality/forecast",
  subscriptions: "#/data/quality/subscriptions",
};
const TAB_META: Record<Tab, { titleKey: string; descriptionKey: string; focusKey: string }> = {
  rules: {
    titleKey: "page.dataQuality.modules.rules.title",
    descriptionKey: "page.dataQuality.modules.rules.description",
    focusKey: "page.dataQuality.modules.rules.focus",
  },
  runs: {
    titleKey: "page.dataQuality.modules.runs.title",
    descriptionKey: "page.dataQuality.modules.runs.description",
    focusKey: "page.dataQuality.modules.runs.focus",
  },
  alerts: {
    titleKey: "page.dataQuality.modules.alerts.title",
    descriptionKey: "page.dataQuality.modules.alerts.description",
    focusKey: "page.dataQuality.modules.alerts.focus",
  },
  reports: {
    titleKey: "page.dataQuality.modules.reports.title",
    descriptionKey: "page.dataQuality.modules.reports.description",
    focusKey: "page.dataQuality.modules.reports.focus",
  },
  impact: {
    titleKey: "page.dataQuality.modules.impact.title",
    descriptionKey: "page.dataQuality.modules.impact.description",
    focusKey: "page.dataQuality.modules.impact.focus",
  },
  rca: {
    titleKey: "page.dataQuality.modules.rca.title",
    descriptionKey: "page.dataQuality.modules.rca.description",
    focusKey: "page.dataQuality.modules.rca.focus",
  },
  forecast: {
    titleKey: "page.dataQuality.modules.forecast.title",
    descriptionKey: "page.dataQuality.modules.forecast.description",
    focusKey: "page.dataQuality.modules.forecast.focus",
  },
  subscriptions: {
    titleKey: "page.dataQuality.modules.subscriptions.title",
    descriptionKey: "page.dataQuality.modules.subscriptions.description",
    focusKey: "page.dataQuality.modules.subscriptions.focus",
  },
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "red",
  high: "orange",
  medium: "gold",
  low: "green",
};

const RULE_TYPES = ["not_null", "range", "regex", "uniqueness", "freshness"];
const DEFAULT_SAMPLE = `[
  {"id":"asset-1","owner":"DataOps","score":95,"email":"owner@example.com","updated_at":"2026-05-21T06:00:00+00:00"},
  {"id":"asset-1","owner":"","score":130,"email":"bad-email","updated_at":"2026-05-19T06:00:00+00:00"}
]`;

function formatTime(value?: string) {
  return value ? value.slice(0, 19).replace("T", " ") : "-";
}

function formatPercent(value: unknown) {
  return value != null ? `${(Number(value) * 100).toFixed(1)}%` : "-";
}

export function DataQualityWorkbench({ focused = false, initialTab = "rules" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({
    name: "",
    domain: "general",
    rule_type: "not_null",
    severity: "medium",
    expression: "",
    field: "owner",
    min: "",
    max: "",
    pattern: "^[^@]+@[^@]+\\.[^@]+$",
    max_age_hours: "24",
  });
  const [dataset, setDataset] = useState("asset_sample");
  const [sampleRows, setSampleRows] = useState(DEFAULT_SAMPLE);
  const [sampleError, setSampleError] = useState("");
  const [taskResult, setTaskResult] = useState<any>(null);
  const [impactTaskResult, setImpactTaskResult] = useState<any>(null);
  const [impactAction, setImpactAction] = useState<"preview" | "create" | null>(null);
  const [rcaResult, setRcaResult] = useState<any>(null);
  const [rcaTaskResult, setRcaTaskResult] = useState<any>(null);
  const [rcaAction, setRcaAction] = useState<"run" | "preview" | "create" | null>(null);
  const [forecastResult, setForecastResult] = useState<any>(null);
  const [forecastTaskResult, setForecastTaskResult] = useState<any>(null);
  const [forecastAction, setForecastAction] = useState<"run" | "preview" | "create" | null>(null);
  const [forecastParams, setForecastParams] = useState({ window_days: "30", horizon_days: "7" });
  const [subscriptionRunResult, setSubscriptionRunResult] = useState<any>(null);
  const [subscriptionAction, setSubscriptionAction] = useState<"preview" | "send" | null>(null);
  const [subscriptionForm, setSubscriptionForm] = useState({
    name: "质量运营群",
    channel: "",
    severity_min: "medium",
    min_impact_score: "1",
    schedule: "manual",
    owner: "Data Governance Agent",
    enabled: "true",
  });
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setTab(initialTab);
    setShowForm(false);
  }, [initialTab]);

  const rulesQ = useQuery({ queryKey: ["dqRules"], queryFn: () => api.dataQualityRules(), enabled: authed });
  const runsQ = useQuery({ queryKey: ["dqRuns"], queryFn: () => api.dataQualityRuns(), enabled: authed && (tab === "runs" || tab === "reports") });
  const alertsQ = useQuery({ queryKey: ["dqAlerts"], queryFn: () => api.dataQualityAlerts(), enabled: authed && (tab === "alerts" || tab === "reports" || tab === "impact" || tab === "rca" || tab === "forecast" || tab === "subscriptions") });
  const impactQ = useQuery({ queryKey: ["dqImpact"], queryFn: () => api.dataQualityImpact(), enabled: authed && tab === "impact" });
  const rcaQ = useQuery({ queryKey: ["dqRca"], queryFn: () => api.dataQualityRca(), enabled: authed && tab === "rca" });
  const rcaHistoryQ = useQuery({ queryKey: ["dqRcaHistory"], queryFn: () => api.dataQualityRcaHistory(), enabled: authed && tab === "rca" });
  const forecastQ = useQuery({ queryKey: ["dqForecast", forecastParams.window_days, forecastParams.horizon_days], queryFn: () => api.dataQualityForecast(Number(forecastParams.window_days || 30), Number(forecastParams.horizon_days || 7)), enabled: authed && tab === "forecast" });
  const forecastHistoryQ = useQuery({ queryKey: ["dqForecastHistory"], queryFn: () => api.dataQualityForecastHistory(), enabled: authed && tab === "forecast" });
  const subscriptionsQ = useQuery({ queryKey: ["dqSubscriptions"], queryFn: () => api.dataQualitySubscriptions(), enabled: authed && tab === "subscriptions" });
  const subscriptionRunsQ = useQuery({ queryKey: ["dqSubscriptionRuns"], queryFn: () => api.dataQualitySubscriptionRuns(), enabled: authed && tab === "subscriptions" });
  const notifyChannelsQ = useQuery({ queryKey: ["notifyChannels"], queryFn: () => api.notifyChannels(), enabled: authed && tab === "subscriptions" });

  function buildConfig() {
    const config: Record<string, unknown> = { field: form.field.trim() };
    if (form.rule_type === "range") {
      if (form.min !== "") config.min = Number(form.min);
      if (form.max !== "") config.max = Number(form.max);
    }
    if (form.rule_type === "regex") config.pattern = form.pattern;
    if (form.rule_type === "freshness") config.max_age_hours = Number(form.max_age_hours || 24);
    if (form.expression.trim()) {
      try {
        return { ...config, ...JSON.parse(form.expression) };
      } catch {
        return config;
      }
    }
    return config;
  }

  function parseSampleRows() {
    try {
      const parsed = JSON.parse(sampleRows);
      if (!Array.isArray(parsed)) throw new Error(t("page.dataQuality.rules.sampleMustBeArray"));
      setSampleError("");
      return parsed as Array<Record<string, unknown>>;
    } catch (err: any) {
      const message = err?.message || t("page.dataQuality.rules.invalidSampleJson");
      setSampleError(message);
      throw new Error(message);
    }
  }

  const createRule = useMutation({
    mutationFn: () => api.dataQualityRuleCreate({ ...form, config: buildConfig() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dqRules"] });
      setShowForm(false);
      setForm({ name: "", domain: "general", rule_type: "not_null", severity: "medium", expression: "", field: "owner", min: "", max: "", pattern: "^[^@]+@[^@]+\\.[^@]+$", max_age_hours: "24" });
    },
  });
  const deleteRule = useMutation({
    mutationFn: (id: string) => api.dataQualityRuleDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dqRules"] }),
  });
  const resolveAlert = useMutation({
    mutationFn: (id: string) => api.dataQualityAlertResolve(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dqAlerts"] }),
  });
  const triggerRun = useMutation({
    mutationFn: (ruleId: string) => api.dataQualityRunCreate({ rule_id: ruleId, dataset, sample_rows: parseSampleRows(), execute_now: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dqRuns"] });
      void qc.invalidateQueries({ queryKey: ["dqAlerts"] });
      setTab("runs");
    },
  });
  const finishRun = useMutation({
    mutationFn: (id: string) => api.dataQualityRunFinish(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dqRuns"] });
      void qc.invalidateQueries({ queryKey: ["dqAlerts"] });
    },
  });
  const buildAlertTasks = useMutation({
    mutationFn: (id?: string) => api.dataQualityAlertTasks({ ids: id ? [id] : [], dry_run: true, priority: "P1", owner_id: "", dev_tool: "codex" }),
    onSuccess: (data) => setTaskResult(data),
  });
  const buildImpactTasks = useMutation({
    mutationFn: ({ dryRun, alertIds }: { dryRun: boolean; alertIds: string[] }) => api.dataQualityImpactTasks({
      alert_ids: alertIds,
      dry_run: dryRun,
      priority: "P1",
      owner_id: "",
      dev_tool: "codex",
    }),
    onSuccess: (data) => setImpactTaskResult(data),
    onSettled: () => setImpactAction(null),
  });
  const runRca = useMutation({
    mutationFn: (alertIds: string[]) => api.dataQualityRcaCreate({ alert_ids: alertIds, persist: true, include_impact: true }),
    onSuccess: (data) => {
      setRcaResult(data);
      void qc.invalidateQueries({ queryKey: ["dqRca"] });
      void qc.invalidateQueries({ queryKey: ["dqRcaHistory"] });
    },
    onSettled: () => setRcaAction(null),
  });
  const buildRcaTasks = useMutation({
    mutationFn: ({ dryRun, alertIds, rcaId }: { dryRun: boolean; alertIds: string[]; rcaId?: string }) => api.dataQualityRcaTasks({
      rca_id: rcaId,
      alert_ids: alertIds,
      dry_run: dryRun,
      priority: "P1",
      owner_id: "",
      dev_tool: "codex",
    }),
    onSuccess: (data) => setRcaTaskResult(data),
    onSettled: () => setRcaAction(null),
  });
  const runForecast = useMutation({
    mutationFn: () => api.dataQualityForecastCreate({
      window_days: Number(forecastParams.window_days || 30),
      horizon_days: Number(forecastParams.horizon_days || 7),
      persist: true,
      include_rca: true,
      include_impact: true,
    }),
    onSuccess: (data) => {
      setForecastResult(data);
      void qc.invalidateQueries({ queryKey: ["dqForecast"] });
      void qc.invalidateQueries({ queryKey: ["dqForecastHistory"] });
    },
    onSettled: () => setForecastAction(null),
  });
  const buildForecastTasks = useMutation({
    mutationFn: ({ dryRun, forecastId }: { dryRun: boolean; forecastId?: string }) => api.dataQualityForecastTasks({
      forecast_id: forecastId,
      window_days: Number(forecastParams.window_days || 30),
      horizon_days: Number(forecastParams.horizon_days || 7),
      dry_run: dryRun,
      priority: "P1",
      owner_id: "",
      dev_tool: "codex",
    }),
    onSuccess: (data) => setForecastTaskResult(data),
    onSettled: () => setForecastAction(null),
  });
  const saveSubscription = useMutation({
    mutationFn: () => api.dataQualitySubscriptionCreate({
      name: subscriptionForm.name,
      channel: subscriptionForm.channel,
      severity_min: subscriptionForm.severity_min,
      min_impact_score: Number(subscriptionForm.min_impact_score || 0),
      schedule: subscriptionForm.schedule,
      owner: subscriptionForm.owner,
      enabled: subscriptionForm.enabled === "true",
      include_impact: true,
      event_types: ["quality_alert_open", "quality_impact_high"],
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dqSubscriptions"] });
      void qc.invalidateQueries({ queryKey: ["dqSubscriptionRuns"] });
    },
  });
  const updateSubscription = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api.dataQualitySubscriptionUpdate(id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dqSubscriptions"] }),
  });
  const deleteSubscription = useMutation({
    mutationFn: (id: string) => api.dataQualitySubscriptionDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dqSubscriptions"] }),
  });
  const runSubscriptions = useMutation({
    mutationFn: ({ dryRun }: { dryRun: boolean }) => api.dataQualitySubscriptionRun({ dry_run: dryRun, force: true, note: dryRun ? "manager-web preview" : "manager-web manual send" }),
    onSuccess: (data) => {
      setSubscriptionRunResult(data);
      void qc.invalidateQueries({ queryKey: ["dqSubscriptionRuns"] });
    },
    onSettled: () => setSubscriptionAction(null),
  });

  useEffect(() => {
    const firstChannel = (notifyChannelsQ.data ?? [])[0]?.name;
    if (tab === "subscriptions" && firstChannel && !subscriptionForm.channel) {
      setSubscriptionForm((value) => ({ ...value, channel: firstChannel }));
    }
  }, [notifyChannelsQ.data, subscriptionForm.channel, tab]);

  if (!authed) return <NeedLogin />;

  const rules = (rulesQ.data?.items ?? []).filter((rule: any) => !q || rule.name?.toLowerCase().includes(q.toLowerCase()));
  const runs = runsQ.data?.items ?? [];
  const alerts = alertsQ.data?.items ?? [];
  const openAlerts = alerts.filter((alert: any) => alert.status === "open");
  const impact = impactQ.data ?? {};
  const impactSummary = impact.summary ?? {};
  const rca = rcaResult ?? rcaQ.data ?? {};
  const rcaSummary = rca.summary ?? {};
  const rcaHistory = rcaHistoryQ.data?.items ?? [];
  const forecast = forecastResult ?? forecastQ.data ?? {};
  const forecastSummary = forecast.summary ?? {};
  const forecastHistory = forecastHistoryQ.data?.items ?? [];
  const subscriptions = subscriptionsQ.data?.items ?? [];
  const subscriptionRuns = subscriptionRunsQ.data?.items ?? [];
  const notifyChannels = notifyChannelsQ.data ?? [];
  const scoredRuns = runs.filter((run: any) => run.score != null);
  const averageQualityScore = scoredRuns.length
    ? `${((scoredRuns.reduce((sum: number, run: any) => sum + Number(run.score || 0), 0) / scoredRuns.length) * 100).toFixed(1)}%`
    : "-";
  const tabLabel = (value: Tab) => t(`page.dataQuality.tabs.${value}`);
  const activeMetaDef = TAB_META[tab];
  const activeMeta = {
    title: t(activeMetaDef.titleKey),
    description: t(activeMetaDef.descriptionKey),
    focus: t(activeMetaDef.focusKey),
  };

  const ruleColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.rules.name"), dataIndex: "name", render: (value) => <span className="font-semibold text-[var(--text)]">{value}</span> },
    { title: t("page.dataQuality.rules.domain"), dataIndex: "domain", width: 130, render: (value) => <AntTag>{value || "-"}</AntTag> },
    { title: t("page.dataQuality.rules.type"), dataIndex: "rule_type", width: 130, render: (value) => <AntTag color="blue">{value}</AntTag> },
    { title: t("page.dataQuality.rules.config"), dataIndex: "config", render: (value) => <span className="font-mono text-xs text-[var(--muted)]">{JSON.stringify(value || {})}</span> },
    { title: t("page.dataQuality.rules.severity"), dataIndex: "severity", width: 110, render: (value) => <AntTag color={SEVERITY_COLOR[value] ?? "default"}>{value}</AntTag> },
    { title: t("page.dataQuality.rules.status"), dataIndex: "status", width: 110, render: (value) => <AntTag>{value || "-"}</AntTag> },
    {
      title: t("common.actions"),
      key: "actions",
      width: 180,
      render: (_value, row) => (
        <Space wrap>
          <Button size="small" type="link" loading={triggerRun.isPending} onClick={() => triggerRun.mutate(row.id)}>{t("page.dataQuality.rules.run")}</Button>
          <Popconfirm title={t("page.dataQuality.rules.confirmDelete")} onConfirm={() => deleteRule.mutate(row.id)}>
            <Button size="small" danger loading={deleteRule.isPending}>{t("common.delete")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const runColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.runs.ruleId"), dataIndex: "rule_id", width: 120, render: (value) => <span className="font-mono text-xs">{String(value || "").slice(0, 8) || "-"}</span> },
    { title: t("page.dataQuality.runs.dataset"), dataIndex: "dataset", width: 150, render: (value) => value || t("page.dataQuality.runs.unnamed") },
    { title: t("page.dataQuality.runs.status"), dataIndex: "status", width: 120, render: (value) => <AntTag color={value === "passed" ? "green" : value === "failed" ? "red" : "gold"}>{value || "-"}</AntTag> },
    { title: t("page.dataQuality.runs.score"), dataIndex: "score", width: 120, render: formatPercent },
    { title: t("page.dataQuality.runs.checkedFailed"), key: "checkedFailed", width: 130, render: (_value, row) => `${row.rows_checked ?? 0} / ${row.rows_failed ?? 0}` },
    { title: t("page.dataQuality.runs.rootCause"), dataIndex: "alert_attribution", render: (value) => value?.root_causes?.join(", ") || "-" },
    { title: t("page.dataQuality.runs.startedAt"), dataIndex: "started_at", width: 180, render: formatTime },
    {
      title: t("common.actions"),
      key: "actions",
      width: 120,
      render: (_value, row) => row.status === "running" ? <Button size="small" type="link" loading={finishRun.isPending} onClick={() => finishRun.mutate(row.id)}>{t("page.dataQuality.runs.finish")}</Button> : null,
    },
  ];

  const alertColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.alerts.message"), dataIndex: "message", render: (value) => <span className="font-medium text-[var(--text)]">{value}</span> },
    { title: t("page.dataQuality.alerts.dataset"), key: "dataset", width: 150, render: (_value, row) => row.dataset || row.alert_attribution?.dataset || "-" },
    { title: t("page.dataQuality.alerts.rootCause"), dataIndex: "alert_attribution", render: (value) => value?.root_causes?.join(", ") || "-" },
    { title: t("page.dataQuality.alerts.severity"), dataIndex: "severity", width: 110, render: (value) => <AntTag color={SEVERITY_COLOR[value] ?? "default"}>{value}</AntTag> },
    { title: t("page.dataQuality.alerts.status"), dataIndex: "status", width: 110, render: (value) => <AntTag color={value === "open" ? "red" : "green"}>{value}</AntTag> },
    { title: t("page.dataQuality.alerts.createdAt"), dataIndex: "created_at", width: 180, render: formatTime },
    {
      title: t("common.actions"),
      key: "actions",
      width: 150,
      render: (_value, row) => (
        <Space wrap>
          {row.status === "open" ? <Button size="small" type="link" loading={resolveAlert.isPending} onClick={() => resolveAlert.mutate(row.id)}>{t("page.dataQuality.alerts.resolve")}</Button> : null}
          <Button size="small" type="link" loading={buildAlertTasks.isPending} onClick={() => buildAlertTasks.mutate(row.id)}>{t("page.dataQuality.alerts.task")}</Button>
        </Space>
      ),
    },
  ];
  const impactMetricColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.impact.name"), dataIndex: "name", render: (value, row) => <span className="font-medium text-[var(--text)]">{value || row.id}</span> },
    { title: t("page.dataQuality.impact.domain"), dataIndex: "domain", width: 120, render: (value) => <AntTag>{value || "-"}</AntTag> },
    { title: t("page.dataQuality.impact.version"), dataIndex: "semantic_version", width: 110 },
    { title: t("page.dataQuality.impact.matched"), key: "matched", render: (_value, row) => [...(row.matched_datasets ?? []), ...(row.matched_fields ?? [])].join(", ") || "-" },
    { title: t("page.dataQuality.impact.risk"), dataIndex: "risk_level", width: 100, render: (value) => <AntTag color={value === "high" ? "red" : "orange"}>{value || "medium"}</AntTag> },
  ];
  const impactTagColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.impact.name"), dataIndex: "name", render: (value, row) => <span className="font-medium text-[var(--text)]">{value || row.id}</span> },
    { title: t("page.dataQuality.impact.category"), dataIndex: "category", width: 130, render: (value) => <AntTag>{value || "-"}</AntTag> },
    { title: t("page.dataQuality.impact.rules"), dataIndex: "rules", width: 90 },
    { title: t("page.dataQuality.impact.matched"), key: "matched", render: (_value, row) => [...(row.matched_entities ?? []), ...(row.matched_fields ?? [])].join(", ") || "-" },
    { title: t("page.dataQuality.impact.risk"), dataIndex: "risk_level", width: 100, render: (value) => <AntTag color={value === "high" ? "red" : "orange"}>{value || "medium"}</AntTag> },
  ];
  const impactAssetColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.impact.name"), dataIndex: "name", render: (value, row) => <span className="font-medium text-[var(--text)]">{value || row.id}</span> },
    { title: t("page.dataQuality.impact.domain"), dataIndex: "domain", width: 120, render: (value) => <AntTag>{value || "-"}</AntTag> },
    { title: t("page.dataQuality.impact.owner"), dataIndex: "owner", width: 130, render: (value) => value || <span className="text-orange-600">{t("page.dataQuality.impact.missingOwner")}</span> },
    { title: t("page.dataQuality.impact.matched"), key: "matched", render: (_value, row) => [...(row.matched_datasets ?? []), ...(row.matched_fields ?? [])].join(", ") || "-" },
    { title: t("page.dataQuality.impact.risk"), dataIndex: "risk_level", width: 100, render: (value) => <AntTag color={value === "high" ? "red" : "orange"}>{value || "medium"}</AntTag> },
  ];
  const impactTaskColumns: ColumnsType<any> = [
    {
      title: t("page.dataQuality.impact.task"),
      dataIndex: "title",
      render: (value, row) => (
        <div className="min-w-[220px]">
          <p className="font-medium text-[var(--text)]">{value}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{row.description}</p>
        </div>
      ),
    },
    { title: t("page.dataQuality.impact.priority"), dataIndex: "priority", width: 100, render: (value) => <AntTag color={value === "P0" ? "red" : "orange"}>{value}</AntTag> },
    { title: t("page.dataQuality.impact.labels"), dataIndex: "labels", width: 260, render: (labels) => <Space wrap>{(labels ?? []).map((label: string) => <AntTag key={label}>{label}</AntTag>)}</Space> },
  ];
  const rcaHypothesisColumns: ColumnsType<any> = [
    {
      title: t("page.dataQuality.rca.hypotheses"),
      dataIndex: "title",
      render: (value, row) => (
        <div className="min-w-[260px]">
          <p className="font-medium text-[var(--text)]">{value}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{row.root_cause}</p>
        </div>
      ),
    },
    { title: t("page.dataQuality.rca.category"), dataIndex: "category", width: 130, render: (value) => <AntTag color="blue">{value}</AntTag> },
    { title: t("page.dataQuality.rca.risk"), dataIndex: "risk_level", width: 110, render: (value) => <AntTag color={value === "critical" || value === "high" ? "red" : "orange"}>{value}</AntTag> },
    { title: t("page.dataQuality.rca.confidenceColumn"), dataIndex: "confidence", width: 110, render: (value) => `${Math.round(Number(value || 0) * 100)}%` },
    { title: t("page.dataQuality.rca.evidence"), dataIndex: "evidence", render: (items) => <Space wrap>{(items ?? []).slice(0, 4).map((item: string) => <AntTag key={item}>{item}</AntTag>)}</Space> },
    { title: t("page.dataQuality.rca.actions"), dataIndex: "actions", render: (items) => <Space wrap>{(items ?? []).slice(0, 3).map((item: string) => <AntTag key={item} color="green">{item}</AntTag>)}</Space> },
  ];
  const rcaTaskColumns: ColumnsType<any> = [
    {
      title: t("page.dataQuality.rca.task"),
      dataIndex: "title",
      render: (value, row) => (
        <div className="min-w-[240px]">
          <p className="font-medium text-[var(--text)]">{value}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{row.description}</p>
        </div>
      ),
    },
    { title: t("page.dataQuality.rca.priority"), dataIndex: "priority", width: 100, render: (value) => <AntTag color={value === "P0" ? "red" : "orange"}>{value}</AntTag> },
    { title: t("page.dataQuality.rca.labels"), dataIndex: "labels", width: 260, render: (labels) => <Space wrap>{(labels ?? []).map((label: string) => <AntTag key={label}>{label}</AntTag>)}</Space> },
  ];
  const rcaHistoryColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.rca.createdAt"), dataIndex: "created_at", width: 180, render: formatTime },
    { title: t("page.dataQuality.rca.riskScore"), dataIndex: "summary", width: 120, render: (value) => value?.risk_score ?? 0 },
    { title: t("page.dataQuality.rca.alertCount"), dataIndex: "summary", width: 120, render: (value) => value?.alerts ?? 0 },
    { title: t("page.dataQuality.rca.rootCauseCount"), dataIndex: "summary", width: 130, render: (value) => value?.root_causes ?? 0 },
    { title: t("page.dataQuality.rca.confidence"), dataIndex: "summary", width: 120, render: (value) => `${Math.round(Number(value?.confidence_avg || 0) * 100)}%` },
  ];
  const forecastSignalColumns: ColumnsType<any> = [
    {
      title: t("page.dataQuality.forecast.signal"),
      dataIndex: "title",
      render: (value, row) => (
        <div className="min-w-[260px]">
          <p className="font-medium text-[var(--text)]">{value}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{row.id}</p>
        </div>
      ),
    },
    { title: t("page.dataQuality.forecast.level"), dataIndex: "level", width: 110, render: (value) => <AntTag color={value === "critical" || value === "high" ? "red" : value === "medium" ? "orange" : "green"}>{value}</AntTag> },
    { title: t("page.dataQuality.forecast.evidence"), dataIndex: "evidence", render: (items) => <Space wrap>{(items ?? []).slice(0, 4).map((item: string) => <AntTag key={item}>{item}</AntTag>)}</Space> },
    { title: t("page.dataQuality.forecast.actions"), dataIndex: "recommended_actions", render: (items) => <Space wrap>{(items ?? []).slice(0, 3).map((item: string) => <AntTag key={item} color="green">{item}</AntTag>)}</Space> },
  ];
  const forecastSeriesColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.forecast.date"), dataIndex: "date", width: 130 },
    { title: t("page.dataQuality.forecast.runs"), dataIndex: "runs", width: 90 },
    { title: t("page.dataQuality.forecast.avgScore"), dataIndex: "avg_score", width: 120, render: (value) => value == null ? "-" : formatPercent(value) },
    { title: t("page.dataQuality.forecast.failedRows"), dataIndex: "failed_rows", width: 110 },
    { title: t("page.dataQuality.forecast.failureRate"), dataIndex: "failure_rate", width: 120, render: formatPercent },
    { title: t("page.dataQuality.forecast.alerts"), dataIndex: "alerts", width: 90 },
  ];
  const forecastTaskColumns: ColumnsType<any> = [
    {
      title: t("page.dataQuality.forecast.task"),
      dataIndex: "title",
      render: (value, row) => (
        <div className="min-w-[240px]">
          <p className="font-medium text-[var(--text)]">{value}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{row.description}</p>
        </div>
      ),
    },
    { title: t("page.dataQuality.forecast.priority"), dataIndex: "priority", width: 100, render: (value) => <AntTag color={value === "P0" ? "red" : "orange"}>{value}</AntTag> },
    { title: t("page.dataQuality.forecast.labels"), dataIndex: "labels", width: 260, render: (labels) => <Space wrap>{(labels ?? []).map((label: string) => <AntTag key={label}>{label}</AntTag>)}</Space> },
  ];
  const forecastHistoryColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.forecast.createdAt"), dataIndex: "created_at", width: 180, render: formatTime },
    { title: t("page.dataQuality.forecast.riskScore"), dataIndex: "summary", width: 120, render: (value) => value?.risk_score ?? 0 },
    { title: t("page.dataQuality.forecast.predictedScore"), dataIndex: "summary", width: 140, render: (value) => formatPercent(value?.predicted_score) },
    { title: t("page.dataQuality.forecast.trend"), dataIndex: "summary", width: 120, render: (value) => <AntTag>{value?.trend_direction || "-"}</AntTag> },
    { title: t("page.dataQuality.forecast.signalCount"), dataIndex: "risk_signals", width: 120, render: (value) => value?.length ?? 0 },
  ];
  const subscriptionColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.subscriptions.name"), dataIndex: "name", render: (value, row) => <span className="font-medium text-[var(--text)]">{value || row.id}</span> },
    { title: t("page.dataQuality.subscriptions.channel"), dataIndex: "channel", width: 140, render: (value) => <AntTag color="blue">{value || "-"}</AntTag> },
    { title: t("page.dataQuality.subscriptions.enabled"), dataIndex: "enabled", width: 110, render: (value) => <AntTag color={value === false ? "default" : "green"}>{value === false ? t("common.no") : t("common.yes")}</AntTag> },
    { title: t("page.dataQuality.subscriptions.severityMin"), dataIndex: "severity_min", width: 130, render: (value) => <AntTag color={SEVERITY_COLOR[value] ?? "default"}>{value}</AntTag> },
    { title: t("page.dataQuality.subscriptions.impactThreshold"), dataIndex: "min_impact_score", width: 120 },
    { title: t("page.dataQuality.subscriptions.owner"), dataIndex: "owner", width: 160 },
    {
      title: t("common.actions"),
      key: "actions",
      width: 190,
      render: (_value, row) => (
        <Space wrap>
          <Button size="small" type="link" loading={updateSubscription.isPending} onClick={() => updateSubscription.mutate({ id: row.id, patch: { enabled: row.enabled === false } })}>
            {row.enabled === false ? t("page.dataQuality.subscriptions.enable") : t("page.dataQuality.subscriptions.disable")}
          </Button>
          <Popconfirm title={t("page.dataQuality.subscriptions.confirmDelete")} onConfirm={() => deleteSubscription.mutate(row.id)}>
            <Button size="small" danger loading={deleteSubscription.isPending}>{t("common.delete")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];
  const subscriptionRunColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.subscriptions.createdAt"), dataIndex: "created_at", width: 180, render: formatTime },
    { title: t("page.dataQuality.subscriptions.status"), dataIndex: "status", width: 110, render: (value) => <AntTag color={value === "sent" ? "green" : "blue"}>{value}</AntTag> },
    { title: t("page.dataQuality.subscriptions.selected"), dataIndex: "selected_count", width: 110 },
    { title: t("page.dataQuality.subscriptions.messagesPlanned"), dataIndex: "messages_planned", width: 120 },
    { title: t("page.dataQuality.subscriptions.sentCount"), dataIndex: "sent_count", width: 100 },
    { title: t("page.dataQuality.subscriptions.impactScore"), dataIndex: "impact_summary", width: 120, render: (value) => value?.impact_score ?? 0 },
  ];
  const subscriptionPlanColumns: ColumnsType<any> = [
    { title: t("page.dataQuality.subscriptions.channel"), dataIndex: "channel", width: 140, render: (value) => <AntTag color="blue">{value}</AntTag> },
    { title: t("page.dataQuality.subscriptions.ready"), dataIndex: "ready", width: 100, render: (value) => <AntTag color={value ? "green" : "orange"}>{value ? t("common.yes") : t("common.no")}</AntTag> },
    { title: t("page.dataQuality.subscriptions.messageTitle"), dataIndex: "message", render: (value) => <span className="font-medium text-[var(--text)]">{value?.title || "-"}</span> },
  ];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell title={focused ? activeMeta.title : t("page.dataQuality.workbenchTitle")} description={focused ? activeMeta.description : t("page.dataQuality.workbenchDesc")}>
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
          {focused ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-1">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.dataQuality.focusedTag")}</span>
                  <a href="#/data/quality" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.dataQuality.backToHub")}</a>
                  <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.dataQuality.focusedHint")}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--text)]">{activeMeta.focus}</p>
              </div>
              <Select
                className="min-w-48"
                value={tab}
                options={TAB_KEYS.map((tabId) => ({ value: tabId, label: tabLabel(tabId) }))}
                onChange={(next) => { window.location.hash = TAB_HREF[next as Tab].slice(1); }}
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {TAB_KEYS.map((tabId) => (
                <Button key={tabId} type={tab === tabId ? "primary" : "text"} onClick={() => { setTab(tabId); setShowForm(false); }}>
                  {tabLabel(tabId)}
                  {tabId === "alerts" && openAlerts.length > 0 ? <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white">{openAlerts.length}</span> : null}
                </Button>
              ))}
            </div>
          )}
        </div>

        {tab === "rules" && (
          <WorkbenchPanel title={t("page.dataQuality.panels.rules")} actions={
            <Space wrap>
              <Input.Search className="w-56" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t("page.dataQuality.rules.search")} allowClear />
              <AiAssistButton onClick={() => setAiOpen(true)} />
              <RefreshButton onClick={() => void rulesQ.refetch()} pending={rulesQ.isFetching} />
              <Button type="primary" onClick={() => setShowForm((value) => !value)}>{t("page.dataQuality.rules.create")}</Button>
            </Space>
          }>
            {showForm ? (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input placeholder={t("page.dataQuality.rules.nameRequired")} value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} />
                  <Input placeholder={t("page.dataQuality.rules.domainPlaceholder")} value={form.domain} onChange={(event) => setForm((value) => ({ ...value, domain: event.target.value }))} />
                  <Select value={form.rule_type} options={RULE_TYPES.map((value) => ({ value, label: value }))} onChange={(value) => setForm((item) => ({ ...item, rule_type: value }))} />
                  <Select value={form.severity} options={["critical", "high", "medium", "low"].map((value) => ({ value, label: value }))} onChange={(value) => setForm((item) => ({ ...item, severity: value }))} />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Input placeholder={t("page.dataQuality.rules.field")} value={form.field} onChange={(event) => setForm((value) => ({ ...value, field: event.target.value }))} />
                  <Input placeholder={t("page.dataQuality.rules.min")} value={form.min} onChange={(event) => setForm((value) => ({ ...value, min: event.target.value }))} disabled={form.rule_type !== "range"} />
                  <Input placeholder={t("page.dataQuality.rules.max")} value={form.max} onChange={(event) => setForm((value) => ({ ...value, max: event.target.value }))} disabled={form.rule_type !== "range"} />
                  <Input placeholder={t("page.dataQuality.rules.maxAgeHours")} value={form.max_age_hours} onChange={(event) => setForm((value) => ({ ...value, max_age_hours: event.target.value }))} disabled={form.rule_type !== "freshness"} />
                </div>
                <Input className="mt-3" placeholder={t("page.dataQuality.rules.configOverride")} value={form.rule_type === "regex" ? form.pattern : form.expression} onChange={(event) => form.rule_type === "regex" ? setForm((value) => ({ ...value, pattern: event.target.value })) : setForm((value) => ({ ...value, expression: event.target.value }))} />
                <Space className="mt-3">
                  <Button type="primary" loading={createRule.isPending} disabled={!form.name || !form.field} onClick={() => createRule.mutate()}>{t("common.create")}</Button>
                  <Button onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
                </Space>
              </div>
            ) : null}
            <div className="mb-4 grid gap-3 lg:grid-cols-[260px_1fr]">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">{t("page.dataQuality.rules.dataset")}</label>
                <Input value={dataset} onChange={(event) => setDataset(event.target.value)} placeholder="dataset_name" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">{t("page.dataQuality.rules.sampleRows")}</label>
                <Input.TextArea className="font-mono text-xs" rows={4} value={sampleRows} onChange={(event) => setSampleRows(event.target.value)} />
                {sampleError ? <Alert className="mt-2" type="error" showIcon message={sampleError} /> : null}
              </div>
            </div>
            <Table rowKey="id" columns={ruleColumns} dataSource={rules} loading={rulesQ.isFetching} pagination={{ pageSize: 10 }} scroll={{ x: 1100 }} locale={{ emptyText: t("page.dataQuality.rules.empty") }} />
          </WorkbenchPanel>
        )}

        {tab === "runs" && (
          <WorkbenchPanel title={t("page.dataQuality.panels.runs")} actions={<RefreshButton onClick={() => void runsQ.refetch()} pending={runsQ.isFetching} />}>
            <Table rowKey="id" columns={runColumns} dataSource={runs} loading={runsQ.isFetching} pagination={{ pageSize: 10 }} scroll={{ x: 1100 }} locale={{ emptyText: t("page.dataQuality.runs.empty") }} />
          </WorkbenchPanel>
        )}

        {tab === "alerts" && (
          <WorkbenchPanel title={t("page.dataQuality.panels.alerts")} actions={
            <Space wrap>
              <Button loading={buildAlertTasks.isPending} disabled={alerts.length === 0} onClick={() => buildAlertTasks.mutate(undefined)}>{t("page.dataQuality.alerts.previewTasks")}</Button>
              <RefreshButton onClick={() => void alertsQ.refetch()} pending={alertsQ.isFetching} />
            </Space>
          }>
            {taskResult?.items?.length > 0 ? (
              <Alert
                className="mb-4"
                type="info"
                showIcon
                message={t("page.dataQuality.alerts.taskPreview")}
                description={
                  <div className="space-y-2">
                    {taskResult.items.slice(0, 3).map((item: any, idx: number) => (
                      <div key={`${item.source_report_id}-${idx}`} className="rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
                        <p className="font-medium text-[var(--text)]">{item.priority} · {item.title}</p>
                        <p className="mt-1 text-[var(--muted)]">{item.description}</p>
                      </div>
                    ))}
                  </div>
                }
              />
            ) : null}
            <Table rowKey="id" columns={alertColumns} dataSource={alerts} loading={alertsQ.isFetching} pagination={{ pageSize: 10 }} scroll={{ x: 1120 }} locale={{ emptyText: t("page.dataQuality.alerts.empty") }} />
          </WorkbenchPanel>
        )}

        {tab === "reports" && (
          <WorkbenchPanel title={t("page.dataQuality.panels.reports")} actions={<RefreshButton onClick={() => { void runsQ.refetch(); void alertsQ.refetch(); }} pending={runsQ.isFetching || alertsQ.isFetching} />}>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <MetricCard label={t("page.dataQuality.reportRunTotal")} value={runs.length} />
              <MetricCard label={t("page.dataQuality.reportFailedRuns")} value={runs.filter((run: any) => run.status === "failed").length} tone="danger" />
              <MetricCard label={t("page.dataQuality.reportOpenAlerts")} value={openAlerts.length} tone="warn" />
              <MetricCard label={t("page.dataQuality.reportAverageScore")} value={averageQualityScore} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.recentRunQuality")}</p>
                <div className="space-y-2">
                  {runs.slice(0, 8).map((run: any) => (
                    <div key={run.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                      <span className="min-w-0 truncate">{run.dataset || run.rule_id}</span>
                      <AntTag color={run.status === "failed" ? "red" : "green"}>{run.status} · {formatPercent(run.score)}</AntTag>
                    </div>
                  ))}
                  {!runs.length && <div className="py-6 text-center text-sm text-[var(--muted)]">{t("page.dataQuality.emptyRuns")}</div>}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.alertRootCauseSummary")}</p>
                <div className="space-y-2">
                  {alerts.slice(0, 8).map((alert: any) => (
                    <div key={alert.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-medium text-[var(--text)]">{alert.message}</span>
                        <AntTag color={SEVERITY_COLOR[alert.severity] ?? "default"}>{alert.severity}</AntTag>
                      </div>
                      <p className="mt-1 truncate text-[var(--muted)]">{alert.alert_attribution?.root_causes?.join(", ") || t("page.dataQuality.unattributed")}</p>
                    </div>
                  ))}
                  {!alerts.length && <div className="py-6 text-center text-sm text-[var(--muted)]">{t("page.dataQuality.emptyAlerts")}</div>}
                </div>
              </div>
            </div>
          </WorkbenchPanel>
        )}

        {tab === "impact" && (
          <WorkbenchPanel title={t("page.dataQuality.panels.impact")} actions={
            <Space wrap>
              <Button loading={buildImpactTasks.isPending && impactAction === "preview"} onClick={() => { setImpactAction("preview"); buildImpactTasks.mutate({ dryRun: true, alertIds: openAlerts.map((alert: any) => alert.id) }); }}>
                {t("page.dataQuality.impact.previewTasks")}
              </Button>
              <Button type="primary" loading={buildImpactTasks.isPending && impactAction === "create"} disabled={!openAlerts.length} onClick={() => { setImpactAction("create"); buildImpactTasks.mutate({ dryRun: false, alertIds: openAlerts.map((alert: any) => alert.id) }); }}>
                {t("page.dataQuality.impact.createTasks")}
              </Button>
              <RefreshButton onClick={() => { void alertsQ.refetch(); void impactQ.refetch(); }} pending={alertsQ.isFetching || impactQ.isFetching} />
            </Space>
          }>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <MetricCard label={t("page.dataQuality.impact.impactScore")} value={impactSummary.impact_score ?? 0} tone={(impactSummary.impact_score ?? 0) >= 70 ? "danger" : "warn"} />
              <MetricCard label={t("page.dataQuality.impact.impactedMetrics")} value={impactSummary.impacted_metrics ?? 0} />
              <MetricCard label={t("page.dataQuality.impact.impactedTags")} value={impactSummary.impacted_tags ?? 0} />
              <MetricCard label={t("page.dataQuality.impact.impactedAssets")} value={impactSummary.impacted_assets ?? 0} />
            </div>
            {(impact.recommended_actions ?? []).length ? (
              <Alert
                className="mb-4"
                type="warning"
                showIcon
                message={t("page.dataQuality.impact.recommendations")}
                description={<Space wrap>{impact.recommended_actions.map((item: string) => <AntTag key={item} color="orange">{item}</AntTag>)}</Space>}
              />
            ) : null}
            <div className="grid gap-4 xl:grid-cols-3">
              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.impact.metricsPanel")}</p>
                <Table rowKey="id" size="small" columns={impactMetricColumns} dataSource={impact.impacted_metrics ?? []} loading={impactQ.isFetching} pagination={{ pageSize: 5 }} scroll={{ x: 720 }} locale={{ emptyText: t("page.dataQuality.impact.emptyMetrics") }} />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.impact.tagsPanel")}</p>
                <Table rowKey="id" size="small" columns={impactTagColumns} dataSource={impact.impacted_tags ?? []} loading={impactQ.isFetching} pagination={{ pageSize: 5 }} scroll={{ x: 720 }} locale={{ emptyText: t("page.dataQuality.impact.emptyTags") }} />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.impact.assetsPanel")}</p>
                <Table rowKey="id" size="small" columns={impactAssetColumns} dataSource={impact.impacted_assets ?? []} loading={impactQ.isFetching} pagination={{ pageSize: 5 }} scroll={{ x: 760 }} locale={{ emptyText: t("page.dataQuality.impact.emptyAssets") }} />
              </div>
            </div>
            {impactTaskResult ? (
              <Alert
                className="mt-4"
                type={impactTaskResult.dry_run ? "info" : "success"}
                showIcon
                message={impactTaskResult.dry_run ? t("page.dataQuality.impact.previewSummary", { count: impactTaskResult.planned ?? 0 }) : t("page.dataQuality.impact.createdSummary", { count: impactTaskResult.created_count ?? impactTaskResult.created?.length ?? 0 })}
                description={
                  <Table
                    className="mt-3"
                    rowKey={(row) => `${row.source_report_id}-${row.title}`}
                    columns={impactTaskColumns}
                    dataSource={impactTaskResult.items ?? []}
                    pagination={{ pageSize: 5 }}
                    scroll={{ x: 860 }}
                    locale={{ emptyText: t("page.dataQuality.impact.emptyTasks") }}
                  />
                }
              />
            ) : null}
          </WorkbenchPanel>
        )}

        {tab === "rca" && (
          <WorkbenchPanel title={t("page.dataQuality.panels.rca")} actions={
            <Space wrap>
              <Button loading={runRca.isPending && rcaAction === "run"} onClick={() => { setRcaAction("run"); runRca.mutate(openAlerts.map((alert: any) => alert.id)); }}>
                {t("page.dataQuality.rca.run")}
              </Button>
              <Button loading={buildRcaTasks.isPending && rcaAction === "preview"} disabled={!(rca.id || openAlerts.length)} onClick={() => { setRcaAction("preview"); buildRcaTasks.mutate({ dryRun: true, alertIds: openAlerts.map((alert: any) => alert.id), rcaId: rca.id }); }}>
                {t("page.dataQuality.rca.previewTasks")}
              </Button>
              <Button type="primary" loading={buildRcaTasks.isPending && rcaAction === "create"} disabled={!(rca.id || openAlerts.length)} onClick={() => { setRcaAction("create"); buildRcaTasks.mutate({ dryRun: false, alertIds: openAlerts.map((alert: any) => alert.id), rcaId: rca.id }); }}>
                {t("page.dataQuality.rca.createTasks")}
              </Button>
              <RefreshButton onClick={() => { void alertsQ.refetch(); void rcaQ.refetch(); void rcaHistoryQ.refetch(); }} pending={alertsQ.isFetching || rcaQ.isFetching || rcaHistoryQ.isFetching} />
            </Space>
          }>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <MetricCard label={t("page.dataQuality.rca.riskScore")} value={rcaSummary.risk_score ?? 0} tone={(rcaSummary.risk_score ?? 0) >= 70 ? "danger" : "warn"} />
              <MetricCard label={t("page.dataQuality.rca.alertCount")} value={rcaSummary.alerts ?? openAlerts.length} />
              <MetricCard label={t("page.dataQuality.rca.rootCauseCount")} value={rcaSummary.root_causes ?? 0} />
              <MetricCard label={t("page.dataQuality.rca.confidence")} value={`${Math.round(Number(rcaSummary.confidence_avg || 0) * 100)}%`} />
            </div>
            {(rca.recommendations?.containment_actions ?? []).length ? (
              <Alert
                className="mb-4"
                type={(rcaSummary.risk_score ?? 0) >= 70 ? "error" : "warning"}
                showIcon
                message={t("page.dataQuality.rca.recommendations")}
                description={
                  <div className="grid gap-3 md:grid-cols-3">
                    <RecommendationGroup title={t("page.dataQuality.rca.containment")} items={rca.recommendations?.containment_actions ?? []} />
                    <RecommendationGroup title={t("page.dataQuality.rca.permanent")} items={rca.recommendations?.permanent_fixes ?? []} />
                    <RecommendationGroup title={t("page.dataQuality.rca.validation")} items={rca.recommendations?.validation_plan ?? []} />
                  </div>
                }
              />
            ) : null}
            <Table
              className="mb-4"
              rowKey="id"
              columns={rcaHypothesisColumns}
              dataSource={rca.hypotheses ?? []}
              loading={rcaQ.isFetching || runRca.isPending}
              pagination={{ pageSize: 6 }}
              scroll={{ x: 1180 }}
              locale={{ emptyText: t("page.dataQuality.rca.emptyHypotheses") }}
            />
            {rcaTaskResult ? (
              <Alert
                className="mb-4"
                type={rcaTaskResult.dry_run ? "info" : "success"}
                showIcon
                message={rcaTaskResult.dry_run ? t("page.dataQuality.rca.previewSummary", { count: rcaTaskResult.planned ?? 0 }) : t("page.dataQuality.rca.createdSummary", { count: rcaTaskResult.created_count ?? rcaTaskResult.created?.length ?? 0 })}
                description={
                  <Table
                    className="mt-3"
                    rowKey={(row) => `${row.source_report_id}-${row.title}`}
                    columns={rcaTaskColumns}
                    dataSource={rcaTaskResult.items ?? []}
                    pagination={{ pageSize: 5 }}
                    scroll={{ x: 860 }}
                    locale={{ emptyText: t("page.dataQuality.rca.emptyTasks") }}
                  />
                }
              />
            ) : null}
            <p className="mb-2 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.rca.history")}</p>
            <Table rowKey="id" size="small" columns={rcaHistoryColumns} dataSource={rcaHistory} loading={rcaHistoryQ.isFetching} pagination={{ pageSize: 8 }} scroll={{ x: 760 }} locale={{ emptyText: t("page.dataQuality.rca.emptyHistory") }} />
          </WorkbenchPanel>
        )}

        {tab === "forecast" && (
          <WorkbenchPanel title={t("page.dataQuality.panels.forecast")} actions={
            <Space wrap>
              <Input className="w-28" value={forecastParams.window_days} onChange={(event) => setForecastParams((value) => ({ ...value, window_days: event.target.value }))} placeholder={t("page.dataQuality.forecast.windowDays")} />
              <Input className="w-28" value={forecastParams.horizon_days} onChange={(event) => setForecastParams((value) => ({ ...value, horizon_days: event.target.value }))} placeholder={t("page.dataQuality.forecast.horizonDays")} />
              <Button loading={runForecast.isPending && forecastAction === "run"} onClick={() => { setForecastAction("run"); runForecast.mutate(); }}>
                {t("page.dataQuality.forecast.run")}
              </Button>
              <Button loading={buildForecastTasks.isPending && forecastAction === "preview"} disabled={!(forecast.id || (forecast.risk_signals ?? []).length)} onClick={() => { setForecastAction("preview"); buildForecastTasks.mutate({ dryRun: true, forecastId: forecast.id }); }}>
                {t("page.dataQuality.forecast.previewTasks")}
              </Button>
              <Button type="primary" loading={buildForecastTasks.isPending && forecastAction === "create"} disabled={!(forecast.id || (forecast.risk_signals ?? []).length)} onClick={() => { setForecastAction("create"); buildForecastTasks.mutate({ dryRun: false, forecastId: forecast.id }); }}>
                {t("page.dataQuality.forecast.createTasks")}
              </Button>
              <RefreshButton onClick={() => { void forecastQ.refetch(); void forecastHistoryQ.refetch(); }} pending={forecastQ.isFetching || forecastHistoryQ.isFetching} />
            </Space>
          }>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <MetricCard label={t("page.dataQuality.forecast.riskScore")} value={forecastSummary.risk_score ?? 0} tone={(forecastSummary.risk_score ?? 0) >= 70 ? "danger" : "warn"} />
              <MetricCard label={t("page.dataQuality.forecast.currentScore")} value={formatPercent(forecastSummary.current_score)} />
              <MetricCard label={t("page.dataQuality.forecast.predictedScore")} value={formatPercent(forecastSummary.predicted_score)} />
              <MetricCard label={t("page.dataQuality.forecast.openAlerts")} value={forecastSummary.open_alerts ?? openAlerts.length} tone={(forecastSummary.open_alerts ?? 0) ? "warn" : "default"} />
            </div>
            {(forecast.recommendations ?? []).length ? (
              <Alert
                className="mb-4"
                type={(forecastSummary.risk_score ?? 0) >= 70 ? "error" : "warning"}
                showIcon
                message={t("page.dataQuality.forecast.recommendations")}
                description={<Space wrap>{forecast.recommendations.map((item: string) => <AntTag key={item} color="orange">{item}</AntTag>)}</Space>}
              />
            ) : null}
            <div className="mb-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.forecast.signals")}</p>
                <Table rowKey="id" size="small" columns={forecastSignalColumns} dataSource={forecast.risk_signals ?? []} loading={forecastQ.isFetching || runForecast.isPending} pagination={{ pageSize: 5 }} scroll={{ x: 980 }} locale={{ emptyText: t("page.dataQuality.forecast.emptySignals") }} />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.forecast.series")}</p>
                <Table rowKey="date" size="small" columns={forecastSeriesColumns} dataSource={(forecast.series ?? []).slice(-10)} loading={forecastQ.isFetching || runForecast.isPending} pagination={false} scroll={{ x: 720 }} locale={{ emptyText: t("page.dataQuality.forecast.emptySeries") }} />
              </div>
            </div>
            {forecastTaskResult ? (
              <Alert
                className="mb-4"
                type={forecastTaskResult.dry_run ? "info" : "success"}
                showIcon
                message={forecastTaskResult.dry_run ? t("page.dataQuality.forecast.previewSummary", { count: forecastTaskResult.planned ?? 0 }) : t("page.dataQuality.forecast.createdSummary", { count: forecastTaskResult.created_count ?? forecastTaskResult.created?.length ?? 0 })}
                description={
                  <Table
                    className="mt-3"
                    rowKey={(row) => `${row.source_report_id}-${row.title}`}
                    columns={forecastTaskColumns}
                    dataSource={forecastTaskResult.items ?? []}
                    pagination={{ pageSize: 5 }}
                    scroll={{ x: 860 }}
                    locale={{ emptyText: t("page.dataQuality.forecast.emptyTasks") }}
                  />
                }
              />
            ) : null}
            <p className="mb-2 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.forecast.history")}</p>
            <Table rowKey="id" size="small" columns={forecastHistoryColumns} dataSource={forecastHistory} loading={forecastHistoryQ.isFetching} pagination={{ pageSize: 8 }} scroll={{ x: 760 }} locale={{ emptyText: t("page.dataQuality.forecast.emptyHistory") }} />
          </WorkbenchPanel>
        )}

        {tab === "subscriptions" && (
          <WorkbenchPanel title={t("page.dataQuality.panels.subscriptions")} actions={
            <Space wrap>
              <Button loading={runSubscriptions.isPending && subscriptionAction === "preview"} onClick={() => { setSubscriptionAction("preview"); runSubscriptions.mutate({ dryRun: true }); }}>
                {t("page.dataQuality.subscriptions.previewRun")}
              </Button>
              <Button type="primary" loading={runSubscriptions.isPending && subscriptionAction === "send"} disabled={!subscriptions.length} onClick={() => { setSubscriptionAction("send"); runSubscriptions.mutate({ dryRun: false }); }}>
                {t("page.dataQuality.subscriptions.sendRun")}
              </Button>
              <RefreshButton onClick={() => { void subscriptionsQ.refetch(); void subscriptionRunsQ.refetch(); void notifyChannelsQ.refetch(); }} pending={subscriptionsQ.isFetching || subscriptionRunsQ.isFetching || notifyChannelsQ.isFetching} />
            </Space>
          }>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <MetricCard label={t("page.dataQuality.subscriptions.configured")} value={subscriptions.length} />
              <MetricCard label={t("page.dataQuality.subscriptions.enabledCount")} value={subscriptions.filter((item: any) => item.enabled !== false).length} />
              <MetricCard label={t("page.dataQuality.subscriptions.openAlerts")} value={openAlerts.length} tone={openAlerts.length ? "warn" : "default"} />
              <MetricCard label={t("page.dataQuality.subscriptions.runCount")} value={subscriptionRuns.length} />
            </div>
            {!notifyChannels.length ? (
              <Alert className="mb-4" type="warning" showIcon message={t("page.dataQuality.subscriptions.noChannels")} />
            ) : null}
            <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_1fr_160px_160px]">
              <Input value={subscriptionForm.name} placeholder={t("page.dataQuality.subscriptions.namePlaceholder")} onChange={(event) => setSubscriptionForm((value) => ({ ...value, name: event.target.value }))} />
              <Select
                value={subscriptionForm.channel || undefined}
                placeholder={t("page.dataQuality.subscriptions.channelPlaceholder")}
                options={notifyChannels.map((item: any) => ({ value: item.name, label: `${item.name} · ${item.type}${item.enabled === false ? " · disabled" : ""}` }))}
                onChange={(value) => setSubscriptionForm((item) => ({ ...item, channel: value }))}
              />
              <Select value={subscriptionForm.severity_min} options={["low", "medium", "high", "critical"].map((value) => ({ value, label: value }))} onChange={(value) => setSubscriptionForm((item) => ({ ...item, severity_min: value }))} />
              <Input value={subscriptionForm.min_impact_score} placeholder={t("page.dataQuality.subscriptions.impactThreshold")} onChange={(event) => setSubscriptionForm((value) => ({ ...value, min_impact_score: event.target.value }))} />
            </div>
            <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_1fr_160px]">
              <Input value={subscriptionForm.owner} placeholder={t("page.dataQuality.subscriptions.owner")} onChange={(event) => setSubscriptionForm((value) => ({ ...value, owner: event.target.value }))} />
              <Input value={subscriptionForm.schedule} placeholder={t("page.dataQuality.subscriptions.schedule")} onChange={(event) => setSubscriptionForm((value) => ({ ...value, schedule: event.target.value }))} />
              <Select value={subscriptionForm.enabled} options={[{ value: "true", label: t("common.yes") }, { value: "false", label: t("common.no") }]} onChange={(value) => setSubscriptionForm((item) => ({ ...item, enabled: value }))} />
            </div>
            <Space className="mb-4" wrap>
              <Button type="primary" loading={saveSubscription.isPending} disabled={!subscriptionForm.channel} onClick={() => saveSubscription.mutate()}>{t("page.dataQuality.subscriptions.save")}</Button>
              <Button onClick={() => setSubscriptionForm((value) => ({ ...value, name: "质量运营群", severity_min: "medium", min_impact_score: "1", schedule: "manual", owner: "Data Governance Agent", enabled: "true" }))}>{t("common.reset")}</Button>
            </Space>
            <Table className="mb-4" rowKey="id" columns={subscriptionColumns} dataSource={subscriptions} loading={subscriptionsQ.isFetching} pagination={{ pageSize: 6 }} scroll={{ x: 980 }} locale={{ emptyText: t("page.dataQuality.subscriptions.empty") }} />
            {subscriptionRunResult ? (
              <Alert
                className="mb-4"
                type={subscriptionRunResult.dry_run ? "info" : "success"}
                showIcon
                message={subscriptionRunResult.dry_run ? t("page.dataQuality.subscriptions.previewSummary", { count: subscriptionRunResult.delivery_plans?.length ?? 0 }) : t("page.dataQuality.subscriptions.sentSummary", { count: subscriptionRunResult.sent?.length ?? 0 })}
                description={
                  <Table
                    className="mt-3"
                    rowKey={(row) => `${row.subscription_id}-${row.channel}`}
                    columns={subscriptionPlanColumns}
                    dataSource={subscriptionRunResult.delivery_plans ?? []}
                    pagination={false}
                    scroll={{ x: 720 }}
                    locale={{ emptyText: t("page.dataQuality.subscriptions.emptyPlans") }}
                  />
                }
              />
            ) : null}
            <p className="mb-2 text-sm font-semibold text-[var(--text)]">{t("page.dataQuality.subscriptions.runHistory")}</p>
            <Table rowKey="id" size="small" columns={subscriptionRunColumns} dataSource={subscriptionRuns} loading={subscriptionRunsQ.isFetching} pagination={{ pageSize: 8 }} scroll={{ x: 900 }} locale={{ emptyText: t("page.dataQuality.subscriptions.emptyRuns") }} />
          </WorkbenchPanel>
        )}
        <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="data-quality" title={t("page.dataQuality.aiTitle")} initialPrompt={t("page.dataQuality.aiPrompt")} />
      </WorkbenchShell>
    </div>
  );
}

function RecommendationGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="mb-2 text-xs font-semibold text-[var(--text)]">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => <AntTag key={item} color="orange">{item}</AntTag>)}
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "warn" | "danger" }) {
  const toneClass = tone === "danger" ? "text-red-600" : tone === "warn" ? "text-orange-600" : "text-[var(--text)]";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
