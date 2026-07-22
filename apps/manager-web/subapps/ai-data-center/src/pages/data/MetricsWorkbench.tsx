import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Popconfirm, Select, Space, Table, Tag as AntTag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type Tab = "catalog" | "semantic" | "published" | "monitor" | "approvals";

const TAB_KEYS: Tab[] = ["catalog", "semantic", "published", "monitor", "approvals"];
const TAB_HREF: Record<Tab, string> = {
  catalog: "#/data/metrics",
  semantic: "#/data/metrics/semantic",
  published: "#/data/metrics/api-publish",
  monitor: "#/data/metrics/monitor",
  approvals: "#/data/metrics/approvals",
};
const TAB_META: Record<Tab, { titleKey: string; descriptionKey: string; focusKey: string }> = {
  catalog: {
    titleKey: "page.metricsCenter.modules.catalog.title",
    descriptionKey: "page.metricsCenter.modules.catalog.description",
    focusKey: "page.metricsCenter.modules.catalog.focus",
  },
  semantic: {
    titleKey: "page.metricsCenter.modules.semantic.title",
    descriptionKey: "page.metricsCenter.modules.semantic.description",
    focusKey: "page.metricsCenter.modules.semantic.focus",
  },
  published: {
    titleKey: "page.metricsCenter.modules.published.title",
    descriptionKey: "page.metricsCenter.modules.published.description",
    focusKey: "page.metricsCenter.modules.published.focus",
  },
  monitor: {
    titleKey: "page.metricsCenter.modules.monitor.title",
    descriptionKey: "page.metricsCenter.modules.monitor.description",
    focusKey: "page.metricsCenter.modules.monitor.focus",
  },
  approvals: {
    titleKey: "page.metricsCenter.modules.approvals.title",
    descriptionKey: "page.metricsCenter.modules.approvals.description",
    focusKey: "page.metricsCenter.modules.approvals.focus",
  },
};
const METRIC_TYPES = ["atomic", "derived", "composite"];

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatTime(value?: string) {
  return value ? value.slice(0, 19).replace("T", " ") : "-";
}

export function MetricsWorkbench({ focused = false, initialTab = "catalog" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [activeMetricId, setActiveMetricId] = useState("");
  const [form, setForm] = useState({ name: "", domain: "general", metric_type: "atomic", formula: "", dimensions: "day", source_assets: "", depends_on: "", unit: "", owner: "", description: "" });
  const [publishForm, setPublishForm] = useState({ version_note: t("page.metricsCenter.semantic.defaultVersionNote"), sla: "99.5%" });
  const [queryForm, setQueryForm] = useState({ grain: "day", dimensions: "" });
  const [queryResult, setQueryResult] = useState<any>(null);
  const [impactResult, setImpactResult] = useState<any>(null);
  const [governancePayload, setGovernancePayload] = useState<any>(null);
  const [governanceAction, setGovernanceAction] = useState<"preview" | "create" | null>(null);
  const [approvalStatus, setApprovalStatus] = useState("pending");
  const [approvalForm, setApprovalForm] = useState({ reason: "", version_note: t("page.metricsCenter.approvals.defaultVersionNote"), sla: "99.5%" });

  useEffect(() => {
    setTab(initialTab);
    setShowForm(false);
  }, [initialTab]);

  const catalogQ = useQuery({ queryKey: ["metricsCatalog"], queryFn: () => api.metricsCatalog(), enabled: authed });
  const publishedQ = useQuery({ queryKey: ["metricsPublished"], queryFn: () => api.metricsPublished(), enabled: authed && (tab === "published" || tab === "monitor") });
  const versionsQ = useQuery({ queryKey: ["metricVersions", activeMetricId], queryFn: () => api.metricVersions(activeMetricId), enabled: authed && tab === "semantic" && Boolean(activeMetricId) });
  const approvalsQ = useQuery({ queryKey: ["metricApprovals", approvalStatus], queryFn: () => api.metricApprovals(approvalStatus), enabled: authed && tab === "approvals" });

  const create = useMutation({
    mutationFn: () => api.metricCreate({
      name: form.name,
      domain: form.domain,
      metric_type: form.metric_type,
      formula: form.formula,
      dimensions: splitList(form.dimensions),
      source_assets: splitList(form.source_assets),
      depends_on: splitList(form.depends_on),
      unit: form.unit,
      owner: form.owner,
      description: form.description,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["metricsCatalog"] });
      setShowForm(false);
      setForm({ name: "", domain: "general", metric_type: "atomic", formula: "", dimensions: "day", source_assets: "", depends_on: "", unit: "", owner: "", description: "" });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.metricDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["metricsCatalog"] }),
  });
  const publish = useMutation({
    mutationFn: (id: string) => api.metricPublishApi(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["metricsCatalog"] });
      void qc.invalidateQueries({ queryKey: ["metricsPublished"] });
    },
  });
  const previewValues = useMutation({
    mutationFn: (id: string) => api.metricValues(id),
  });
  const publishVersion = useMutation({
    mutationFn: (id: string) => api.metricPublishVersion(id, publishForm),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["metricsCatalog"] });
      void qc.invalidateQueries({ queryKey: ["metricsPublished"] });
      void qc.invalidateQueries({ queryKey: ["metricVersions", activeMetricId] });
    },
  });
  const queryMetric = useMutation({
    mutationFn: (id: string) => api.metricQuery(id, queryForm),
    onSuccess: (data) => setQueryResult(data),
  });
  const impactMetric = useMutation({
    mutationFn: (id: string) => api.metricImpact(id),
    onSuccess: (data) => setImpactResult(data),
  });
  const governanceTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.metricsGovernanceTasks({
      ids: governanceTodos.map((metric: any) => metric.id),
      dry_run: dryRun,
      priority: "P1",
      assigned_to: "Metrics Agent",
      dev_tool: "codex",
    }),
    onSuccess: (data) => {
      setGovernancePayload(data);
      if (!data?.dry_run) void qc.invalidateQueries({ queryKey: ["metricsCatalog"] });
    },
    onSettled: () => setGovernanceAction(null),
  });
  const createApproval = useMutation({
    mutationFn: (metricId: string) => api.metricApprovalCreate({
      metric_id: metricId,
      action: "publish_metric",
      reason: approvalForm.reason,
      requested_by: "Metrics Agent",
      reviewers: ["Data Governance"],
      payload: { version_note: approvalForm.version_note, sla: approvalForm.sla },
      auto_apply_on_approval: true,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["metricApprovals"] });
      setApprovalForm({ reason: "", version_note: t("page.metricsCenter.approvals.defaultVersionNote"), sla: "99.5%" });
    },
  });
  const reviewApproval = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "rejected" }) => api.metricApprovalReview(id, {
      status,
      reviewer: "Data Governance",
      note: status === "approved" ? t("page.metricsCenter.approvals.approveNote") : t("page.metricsCenter.approvals.rejectNote"),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["metricApprovals"] });
      void qc.invalidateQueries({ queryKey: ["metricsCatalog"] });
      void qc.invalidateQueries({ queryKey: ["metricsPublished"] });
      void qc.invalidateQueries({ queryKey: ["metricVersions", activeMetricId] });
    },
  });

  const catalog = catalogQ.data?.items ?? [];
  const published = publishedQ.data?.items ?? [];
  const approvals = approvalsQ.data?.items ?? [];
  const approvalCounts = approvalsQ.data?.counts ?? {};
  const metricsWithSemanticVersion = catalog.filter((metric: any) => metric.semantic_version);
  const metricsWithFormulaIssues = catalog.filter((metric: any) => metric.formula_validation && !metric.formula_validation.valid);
  const catalogAliases = useMemo(() => new Set(catalog.flatMap((metric: any) => [metric.id, String(metric.name || "").toLowerCase()])), [catalog]);
  const governanceTodos = catalog.filter((metric: any) => {
    const warnings = metric.formula_validation?.warnings ?? [];
    const hasBrokenDependency = (metric.depends_on ?? []).some((dep: string) => dep && !catalogAliases.has(dep) && !catalogAliases.has(String(dep).toLowerCase()));
    return !metric.owner
      || !metric.formula
      || warnings.includes("formula_empty")
      || (metric.formula_validation && !metric.formula_validation.valid)
      || !metric.api_endpoint
      || !metric.semantic_version
      || metric.semantic_version === "v0"
      || hasBrokenDependency;
  });
  const activeMetric = catalog.find((metric: any) => metric.id === activeMetricId) ?? catalog[0];
  const versions = versionsQ.data?.items ?? [];
  const metricNameById = useMemo(() => new Map(catalog.map((metric: any) => [metric.id, metric.name])), [catalog]);
  const selectMetric = (id: string) => {
    setActiveMetricId(id);
    setQueryResult(null);
    setImpactResult(null);
    setTab("semantic");
  };
  const activeMetaDef = TAB_META[tab];
  const activeMeta = {
    title: t(activeMetaDef.titleKey),
    description: t(activeMetaDef.descriptionKey),
    focus: t(activeMetaDef.focusKey),
  };
  const tabLabel = (tabId: Tab) => {
    if (tabId === "catalog") return `${t("page.metricsCenter.tabs.catalog")} (${catalog.length})`;
    if (tabId === "published") return `${t("page.metricsCenter.tabs.published")} (${published.length})`;
    if (tabId === "approvals") return `${t("page.metricsCenter.tabs.approvals")} (${approvalCounts.pending ?? 0})`;
    return t(`page.metricsCenter.tabs.${tabId}`);
  };

  const catalogColumns: ColumnsType<any> = [
    {
      title: t("page.metricsCenter.catalog.name"),
      dataIndex: "name",
      render: (_value, row) => (
        <div className="min-w-[180px]">
          <p className="font-semibold text-[var(--text)]">{row.name}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{row.description || t("page.metricsCenter.catalog.noDescription")}</p>
        </div>
      ),
    },
    { title: t("page.metricsCenter.catalog.domain"), dataIndex: "domain", width: 130, render: (value) => <AntTag>{value || "-"}</AntTag> },
    { title: t("page.metricsCenter.catalog.type"), dataIndex: "metric_type", width: 120, render: (value) => <AntTag color="blue">{value || "-"}</AntTag> },
    { title: t("page.metricsCenter.catalog.formula"), dataIndex: "formula", render: (value) => <span className="font-mono text-xs text-[var(--muted)]">{value || "-"}</span> },
    { title: t("page.metricsCenter.catalog.version"), dataIndex: "semantic_version", width: 110, render: (value) => value || "v0" },
    { title: t("page.metricsCenter.catalog.api"), dataIndex: "api_endpoint", width: 130, render: (value) => value ? <AntTag color="green">{t("page.metricsCenter.catalog.published")}</AntTag> : <AntTag>{t("page.metricsCenter.catalog.unpublished")}</AntTag> },
    {
      title: t("common.actions"),
      key: "actions",
      width: 260,
      render: (_value, row) => (
        <Space wrap>
          {!row.api_endpoint ? <Button size="small" type="link" loading={publish.isPending} onClick={() => publish.mutate(row.id)}>{t("page.metricsCenter.catalog.publishApi")}</Button> : null}
          <Button size="small" type="link" onClick={() => selectMetric(row.id)}>{t("page.metricsCenter.catalog.semantic")}</Button>
          <Button size="small" type="link" loading={previewValues.isPending} onClick={() => previewValues.mutate(row.id)}>{t("page.metricsCenter.catalog.preview")}</Button>
          <Popconfirm title={t("page.metricsCenter.catalog.confirmDelete")} onConfirm={() => del.mutate(row.id)}>
            <Button size="small" danger loading={del.isPending}>{t("common.delete")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const publishedColumns: ColumnsType<any> = [
    { title: t("page.metricsCenter.published.metric"), dataIndex: "metric_id", width: 180, render: (value) => metricNameById.get(value) || <span className="font-mono text-xs">{String(value || "").slice(0, 10) || "-"}</span> },
    { title: t("page.metricsCenter.published.endpoint"), dataIndex: "endpoint", render: (value) => <span className="font-mono text-xs text-[var(--brand)]">{value || "-"}</span> },
    { title: t("page.metricsCenter.published.publishedAt"), dataIndex: "published_at", width: 180, render: (value) => formatTime(value) },
  ];
  const taskColumns: ColumnsType<any> = [
    {
      title: t("page.metricsCenter.tasks.title"),
      dataIndex: "title",
      render: (value, row) => (
        <div className="min-w-[220px]">
          <p className="font-medium text-[var(--text)]">{value}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{row.description}</p>
        </div>
      ),
    },
    { title: t("page.metricsCenter.tasks.priority"), dataIndex: "priority", width: 90, render: (value) => <AntTag color={value === "P0" ? "red" : "orange"}>{value || "P1"}</AntTag> },
    { title: t("page.metricsCenter.tasks.labels"), dataIndex: "labels", width: 260, render: (labels) => <Space size={[4, 4]} wrap>{(labels ?? []).slice(0, 4).map((label: string) => <AntTag key={label}>{label}</AntTag>)}</Space> },
  ];
  const approvalColumns: ColumnsType<any> = [
    {
      title: t("page.metricsCenter.approvals.target"),
      dataIndex: "target_name",
      render: (value, row) => (
        <div className="min-w-[220px]">
          <p className="font-medium text-[var(--text)]">{value || metricNameById.get(row.metric_id) || row.metric_id}</p>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">{row.metric_id}</p>
        </div>
      ),
    },
    { title: t("page.metricsCenter.approvals.action"), dataIndex: "action", width: 150, render: (value) => <AntTag color="blue">{value}</AntTag> },
    { title: t("page.metricsCenter.approvals.status"), dataIndex: "status", width: 120, render: (value) => <AntTag color={value === "pending" ? "orange" : value === "approved" ? "green" : "default"}>{value}</AntTag> },
    { title: t("page.metricsCenter.approvals.risk"), dataIndex: ["risk", "risk_level"], width: 110, render: (value) => <AntTag color={value === "high" ? "red" : value === "medium" ? "orange" : "green"}>{value || "low"}</AntTag> },
    { title: t("page.metricsCenter.approvals.requestedBy"), dataIndex: "requested_by", width: 150 },
    { title: t("page.metricsCenter.approvals.createdAt"), dataIndex: "created_at", width: 180, render: (value) => formatTime(value) },
    {
      title: t("common.actions"),
      key: "actions",
      width: 190,
      render: (_value, row) => row.status === "pending" ? (
        <Space wrap>
          <Button size="small" type="primary" loading={reviewApproval.isPending} onClick={() => reviewApproval.mutate({ id: row.id, status: "approved" })}>{t("page.metricsCenter.approvals.approve")}</Button>
          <Button size="small" danger loading={reviewApproval.isPending} onClick={() => reviewApproval.mutate({ id: row.id, status: "rejected" })}>{t("page.metricsCenter.approvals.reject")}</Button>
        </Space>
      ) : <span className="text-xs text-[var(--muted)]">{row.review_note || "-"}</span>,
    },
  ];

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell title={focused ? activeMeta.title : t("page.metricsCenter.workbenchTitle")} description={focused ? activeMeta.description : t("page.metricsCenter.workbenchDesc")}>
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
          {focused ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-1">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.metricsCenter.focusedTag")}</span>
                  <a href="#/data/metrics" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.metricsCenter.backToHub")}</a>
                  <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.metricsCenter.focusedHint")}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--text)]">{activeMeta.focus}</p>
              </div>
              <Select
                className="min-w-48"
                value={tab}
                options={TAB_KEYS.map((tabId) => ({ value: tabId, label: t(`page.metricsCenter.tabs.${tabId}`) }))}
                onChange={(next) => { window.location.hash = TAB_HREF[next as Tab].slice(1); }}
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {TAB_KEYS.map((tabId) => (
                <Button key={tabId} type={tab === tabId ? "primary" : "text"} onClick={() => { setTab(tabId); setShowForm(false); }}>
                  {tabLabel(tabId)}
                </Button>
              ))}
            </div>
          )}
        </div>

        {tab === "catalog" && (
          <WorkbenchPanel title={t("page.metricsCenter.panels.catalog")} actions={
            <Space wrap>
              <AiAssistButton onClick={() => setAiOpen(true)} />
              <RefreshButton onClick={() => void catalogQ.refetch()} pending={catalogQ.isFetching} />
              <Button type="primary" onClick={() => setShowForm((value) => !value)}>{t("page.metricsCenter.catalog.create")}</Button>
            </Space>
          }>
            {showForm ? (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input placeholder={t("page.metricsCenter.catalog.nameRequired")} value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} />
                  <Input placeholder={t("page.metricsCenter.catalog.domain")} value={form.domain} onChange={(event) => setForm((value) => ({ ...value, domain: event.target.value }))} />
                  <Select value={form.metric_type} options={METRIC_TYPES.map((value) => ({ value, label: value }))} onChange={(value) => setForm((item) => ({ ...item, metric_type: value }))} />
                  <Input placeholder={t("page.metricsCenter.catalog.unit")} value={form.unit} onChange={(event) => setForm((value) => ({ ...value, unit: event.target.value }))} />
                  <Input className="sm:col-span-2" placeholder={t("page.metricsCenter.catalog.formulaPlaceholder")} value={form.formula} onChange={(event) => setForm((value) => ({ ...value, formula: event.target.value }))} />
                  <Input placeholder={t("page.metricsCenter.catalog.dimensionsPlaceholder")} value={form.dimensions} onChange={(event) => setForm((value) => ({ ...value, dimensions: event.target.value }))} />
                  <Input placeholder={t("page.metricsCenter.catalog.sourceAssetsPlaceholder")} value={form.source_assets} onChange={(event) => setForm((value) => ({ ...value, source_assets: event.target.value }))} />
                  <Input placeholder={t("page.metricsCenter.catalog.dependsOnPlaceholder")} value={form.depends_on} onChange={(event) => setForm((value) => ({ ...value, depends_on: event.target.value }))} />
                  <Input placeholder={t("page.metricsCenter.catalog.owner")} value={form.owner} onChange={(event) => setForm((value) => ({ ...value, owner: event.target.value }))} />
                  <Input className="sm:col-span-2" placeholder={t("page.metricsCenter.catalog.description")} value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} />
                </div>
                <Space className="mt-3">
                  <Button type="primary" loading={create.isPending} disabled={!form.name} onClick={() => create.mutate()}>{t("common.create")}</Button>
                  <Button onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
                </Space>
              </div>
            ) : null}
            <Table rowKey="id" columns={catalogColumns} dataSource={catalog} loading={catalogQ.isFetching} pagination={{ pageSize: 10 }} scroll={{ x: 1120 }} locale={{ emptyText: t("page.metricsCenter.catalog.empty") }} />
            {previewValues.data ? (
              <Alert
                className="mt-4"
                type="info"
                showIcon
                message={t("page.metricsCenter.catalog.previewTitle")}
                description={
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    {(previewValues.data.values ?? []).map((value: any) => (
                      <div key={value.bucket} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                        <p className="text-xs text-[var(--muted)]">{value.bucket}</p>
                        <p className="text-lg font-semibold">{value.value}</p>
                      </div>
                    ))}
                  </div>
                }
              />
            ) : null}
          </WorkbenchPanel>
        )}

        {tab === "semantic" && (
          <WorkbenchPanel title={t("page.metricsCenter.panels.semantic")} actions={<RefreshButton onClick={() => void catalogQ.refetch()} pending={catalogQ.isFetching} />}>
            {!activeMetric ? (
              <div className="py-8 text-center text-sm text-[var(--muted)]">{t("page.metricsCenter.semantic.empty")}</div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <p className="mb-2 text-xs text-[var(--muted)]">{t("page.metricsCenter.semantic.currentMetric")}</p>
                    <Select
                      className="w-full"
                      value={activeMetric.id}
                      options={catalog.map((item: any) => ({ value: item.id, label: item.name }))}
                      onChange={(value) => selectMetric(value)}
                    />
                    <p className="mt-3 font-mono text-xs text-[var(--muted)]">{activeMetric.formula || t("page.metricsCenter.semantic.noFormula")}</p>
                    <Space className="mt-2" wrap>{(activeMetric.dimensions ?? []).map((dimension: string) => <AntTag key={dimension} color="geekblue">{dimension}</AntTag>)}</Space>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <p className="mb-2 text-xs text-[var(--muted)]">{t("page.metricsCenter.semantic.formulaValidation")}</p>
                    <AntTag color={activeMetric.formula_validation?.valid ? "green" : "orange"}>{activeMetric.formula_validation?.valid ? t("page.metricsCenter.semantic.valid") : t("page.metricsCenter.semantic.needsFix")}</AntTag>
                    <p className="mt-2 text-xs text-[var(--muted)]">{t("page.metricsCenter.semantic.functions")}: {activeMetric.formula_validation?.functions?.join(", ") || "-"}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{t("page.metricsCenter.semantic.fields")}: {activeMetric.formula_validation?.fields?.join(", ") || "-"}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <p className="mb-2 text-xs text-[var(--muted)]">{t("page.metricsCenter.semantic.queryContract")}</p>
                    <p className="font-mono text-xs text-[var(--brand)]">{activeMetric.query_contract?.endpoint || activeMetric.api_endpoint || t("page.metricsCenter.catalog.unpublished")}</p>
                    <p className="mt-2 text-xs text-[var(--muted)]">SLA: {activeMetric.query_contract?.sla || "-"} · {t("page.metricsCenter.catalog.version")}: {activeMetric.semantic_version || "v0"}</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                    <p className="mb-3 text-sm font-semibold">{t("page.metricsCenter.semantic.versionPublish")}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input value={publishForm.version_note} onChange={(event) => setPublishForm((value) => ({ ...value, version_note: event.target.value }))} placeholder={t("page.metricsCenter.semantic.versionNote")} />
                      <Input value={publishForm.sla} onChange={(event) => setPublishForm((value) => ({ ...value, sla: event.target.value }))} placeholder="SLA" />
                    </div>
                    <Button className="mt-3" type="primary" loading={publishVersion.isPending} onClick={() => publishVersion.mutate(activeMetric.id)}>{t("page.metricsCenter.semantic.publishVersion")}</Button>
                    <div className="mt-3 space-y-2">
                      {versions.slice(0, 3).map((version: any) => (
                        <div key={version.id} className="rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
                          <span className="font-semibold">{version.semantic_version}</span>
                          <span className="ml-2 text-[var(--muted)]">{version.version_note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                    <p className="mb-3 text-sm font-semibold">{t("page.metricsCenter.semantic.sampleQuery")}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Select value={queryForm.grain} options={["day", "week", "month"].map((value) => ({ value, label: value }))} onChange={(value) => setQueryForm((item) => ({ ...item, grain: value }))} />
                      <Input value={queryForm.dimensions} onChange={(event) => setQueryForm((value) => ({ ...value, dimensions: event.target.value }))} placeholder={t("page.metricsCenter.semantic.dimensionFilter")} />
                    </div>
                    <Button className="mt-3" loading={queryMetric.isPending} onClick={() => queryMetric.mutate(activeMetric.id)}>{t("page.metricsCenter.semantic.runQuery")}</Button>
                    {queryResult ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        {(queryResult.values ?? []).slice(0, 4).map((value: any) => (
                          <div key={value.bucket} className="rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-center text-xs">
                            <p className="text-[var(--muted)]">{value.bucket}</p>
                            <p className="text-base font-semibold">{value.value}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{t("page.metricsCenter.semantic.impactTitle")}</p>
                    <Button loading={impactMetric.isPending} onClick={() => impactMetric.mutate(activeMetric.id)}>{t("page.metricsCenter.semantic.impactAnalyze")}</Button>
                  </div>
                  {impactResult ? (
                    <div className="grid gap-3 lg:grid-cols-3">
                      <InfoBlock label={t("page.metricsCenter.semantic.upstream")} value={impactResult.upstream_assets?.join(", ") || "-"} />
                      <InfoBlock label={t("page.metricsCenter.semantic.downstream")} value={impactResult.downstream_metrics?.map((metric: any) => metric.name).join(", ") || "-"} />
                      <InfoBlock label={t("page.metricsCenter.semantic.riskLevel")} value={impactResult.risk_level || "-"} strong />
                    </div>
                  ) : <p className="text-sm text-[var(--muted)]">{t("page.metricsCenter.semantic.impactEmpty")}</p>}
                </div>
              </div>
            )}
          </WorkbenchPanel>
        )}

        {tab === "published" && (
          <WorkbenchPanel title={t("page.metricsCenter.panels.published")} actions={<RefreshButton onClick={() => void publishedQ.refetch()} pending={publishedQ.isFetching} />}>
            <Table rowKey="id" columns={publishedColumns} dataSource={published} loading={publishedQ.isFetching} pagination={{ pageSize: 10 }} scroll={{ x: 760 }} locale={{ emptyText: t("page.metricsCenter.published.empty") }} />
          </WorkbenchPanel>
        )}

        {tab === "monitor" && (
          <WorkbenchPanel title={t("page.metricsCenter.panels.monitor")} actions={
            <Space wrap>
              <Button loading={governanceTasks.isPending && governanceAction === "preview"} onClick={() => { setGovernanceAction("preview"); governanceTasks.mutate(true); }}>
                {t("page.metricsCenter.tasks.preview")}
              </Button>
              <Button type="primary" loading={governanceTasks.isPending && governanceAction === "create"} disabled={!governanceTodos.length} onClick={() => { setGovernanceAction("create"); governanceTasks.mutate(false); }}>
                {t("page.metricsCenter.tasks.create")}
              </Button>
              <RefreshButton onClick={() => { void catalogQ.refetch(); void publishedQ.refetch(); }} pending={catalogQ.isFetching || publishedQ.isFetching} />
            </Space>
          }>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <MetricCard label={t("page.metricsCenter.metricTotal")} value={catalog.length} />
              <MetricCard label={t("page.metricsCenter.publishedApi")} value={published.length} />
              <MetricCard label={t("page.metricsCenter.semanticCoverage")} value={metricsWithSemanticVersion.length} />
              <MetricCard label={t("page.metricsCenter.formulaIssues")} value={metricsWithFormulaIssues.length} tone="warn" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text)]">{t("page.metricsCenter.serviceHealth")}</p>
                <div className="space-y-2">
                  {published.slice(0, 8).map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                      <span className="min-w-0 truncate font-mono text-[var(--brand)]">{item.endpoint}</span>
                      <AntTag color="green">healthy</AntTag>
                    </div>
                  ))}
                  {!published.length && <div className="py-6 text-center text-sm text-[var(--muted)]">{t("page.metricsCenter.emptyPublishedServices")}</div>}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text)]">{t("page.metricsCenter.governanceTodos")}</p>
                <div className="space-y-2">
                  {governanceTodos.slice(0, 8).map((metric: any) => (
                    <div key={metric.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                      <p className="font-medium text-[var(--text)]">{metric.name}</p>
                      <p className="mt-1 text-[var(--muted)]">{!metric.api_endpoint ? t("page.metricsCenter.unpublishedApi") : t("page.metricsCenter.formulaNeedsFix")}</p>
                    </div>
                  ))}
                  {!governanceTodos.length && (
                    <div className="py-6 text-center text-sm text-[var(--muted)]">{t("page.metricsCenter.emptyGovernanceTodos")}</div>
                  )}
                </div>
              </div>
            </div>
            {governancePayload ? (
              <Alert
                className="mt-4"
                type={governancePayload.dry_run ? "info" : "success"}
                showIcon
                message={governancePayload.dry_run ? t("page.metricsCenter.tasks.previewSummary", { count: governancePayload.planned ?? 0 }) : t("page.metricsCenter.tasks.createdSummary", { count: governancePayload.created_count ?? governancePayload.created?.length ?? 0 })}
                description={
                  <Table
                    className="mt-3"
                    rowKey={(row) => `${row.source_report_id}-${row.title}`}
                    columns={taskColumns}
                    dataSource={governancePayload.items ?? []}
                    pagination={{ pageSize: 5 }}
                    scroll={{ x: 760 }}
                    locale={{ emptyText: t("page.metricsCenter.tasks.empty") }}
                  />
                }
              />
            ) : null}
          </WorkbenchPanel>
        )}

        {tab === "approvals" && (
          <WorkbenchPanel title={t("page.metricsCenter.panels.approvals")} actions={
            <Space wrap>
              <Select
                className="min-w-36"
                value={approvalStatus}
                options={["pending", "approved", "rejected", "cancelled"].map((value) => ({ value, label: t(`page.metricsCenter.approvals.statusOptions.${value}`) }))}
                onChange={setApprovalStatus}
              />
              <RefreshButton onClick={() => void approvalsQ.refetch()} pending={approvalsQ.isFetching} />
            </Space>
          }>
            <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text)]">{t("page.metricsCenter.approvals.createTitle")}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Select
                    placeholder={t("page.metricsCenter.approvals.selectMetric")}
                    value={activeMetric?.id}
                    options={catalog.map((item: any) => ({ value: item.id, label: `${item.name} · ${item.semantic_version || "v0"}` }))}
                    onChange={(value) => setActiveMetricId(value)}
                  />
                  <Input value={approvalForm.sla} onChange={(event) => setApprovalForm((value) => ({ ...value, sla: event.target.value }))} placeholder="SLA" />
                  <Input value={approvalForm.version_note} onChange={(event) => setApprovalForm((value) => ({ ...value, version_note: event.target.value }))} placeholder={t("page.metricsCenter.approvals.versionNote")} />
                  <Input value={approvalForm.reason} onChange={(event) => setApprovalForm((value) => ({ ...value, reason: event.target.value }))} placeholder={t("page.metricsCenter.approvals.reason")} />
                </div>
                <Button className="mt-3" type="primary" loading={createApproval.isPending} disabled={!activeMetric?.id} onClick={() => activeMetric?.id && createApproval.mutate(activeMetric.id)}>
                  {t("page.metricsCenter.approvals.create")}
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <MetricCard label={t("page.metricsCenter.approvals.pending")} value={approvalCounts.pending ?? 0} tone="warn" />
                <MetricCard label={t("page.metricsCenter.approvals.approved")} value={approvalCounts.approved ?? 0} />
                <MetricCard label={t("page.metricsCenter.approvals.rejected")} value={approvalCounts.rejected ?? 0} />
              </div>
            </div>
            <Table
              rowKey="id"
              columns={approvalColumns}
              dataSource={approvals}
              loading={approvalsQ.isFetching}
              pagination={{ pageSize: 8 }}
              scroll={{ x: 1160 }}
              locale={{ emptyText: t("page.metricsCenter.approvals.empty") }}
              expandable={{
                expandedRowRender: (row) => (
                  <div className="grid gap-3 text-xs lg:grid-cols-3">
                    <InfoBlock label={t("page.metricsCenter.approvals.reason")} value={row.reason || "-"} />
                    <InfoBlock label={t("page.metricsCenter.approvals.payload")} value={JSON.stringify(row.payload ?? {})} />
                    <InfoBlock label={t("page.metricsCenter.approvals.applied")} value={row.applied_result?.endpoint || row.applied_result?.query_contract?.endpoint || "-"} strong />
                  </div>
                ),
              }}
            />
          </WorkbenchPanel>
        )}
        <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="metrics" title={t("page.metricsCenter.aiTitle")} initialPrompt={t("page.metricsCenter.aiPrompt")} />
      </WorkbenchShell>
    </div>
  );
}

function MetricCard({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "warn" }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "warn" ? "text-orange-600" : "text-[var(--text)]"}`}>{value}</p>
    </div>
  );
}

function InfoBlock({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`mt-1 text-sm ${strong ? "font-semibold text-[var(--text)]" : "text-[var(--text)]"}`}>{value}</p>
    </div>
  );
}
