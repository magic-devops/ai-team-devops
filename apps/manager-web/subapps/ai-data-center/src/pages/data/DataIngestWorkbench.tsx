import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, Input, InputNumber, Popconfirm, Select, Space, Table, Tag as AntTag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Database, Plus, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

type Tab = "connectors" | "jobs" | "schemas" | "runs";

const TAB_KEYS: Tab[] = ["connectors", "schemas", "runs", "jobs"];
const TAB_HREF: Record<Tab, string> = {
  connectors: "#/data/ingest/connectors",
  schemas: "#/data/ingest/schema",
  runs: "#/data/ingest/cdc",
  jobs: "#/data/ingest/batch",
};
const TAB_META: Record<Tab, { titleKey: string; descriptionKey: string; focusKey: string }> = {
  connectors: {
    titleKey: "page.dataIngest.modules.connectors.title",
    descriptionKey: "page.dataIngest.modules.connectors.description",
    focusKey: "page.dataIngest.modules.connectors.focus",
  },
  schemas: {
    titleKey: "page.dataIngest.modules.schema.title",
    descriptionKey: "page.dataIngest.modules.schema.description",
    focusKey: "page.dataIngest.modules.schema.focus",
  },
  runs: {
    titleKey: "page.dataIngest.modules.cdc.title",
    descriptionKey: "page.dataIngest.modules.cdc.description",
    focusKey: "page.dataIngest.modules.cdc.focus",
  },
  jobs: {
    titleKey: "page.dataIngest.modules.batch.title",
    descriptionKey: "page.dataIngest.modules.batch.description",
    focusKey: "page.dataIngest.modules.batch.focus",
  },
};

const CONNECTOR_TYPES = ["mysql", "postgresql", "kafka", "s3", "api", "dingtalk", "wechat", "oceanbase", "starrocks"];
const INGEST_MODES = ["batch", "cdc", "stream"];

function shortDate(value?: string) {
  return value ? value.slice(0, 19).replace("T", " ") : "-";
}

function statusColor(status?: string) {
  if (status === "active" || status === "success" || status === "passed") return "green";
  if (status === "running") return "gold";
  if (status === "failed" || status === "inactive" || status === "warning") return "red";
  return "default";
}

function columnSummary(columns?: Array<{ name?: string; type?: string }>) {
  const items = Array.isArray(columns) ? columns : [];
  if (!items.length) return "-";
  return items.map((item) => `${item.name}:${item.type}`).join(", ");
}

export function DataIngestWorkbench({ focused = false, initialTab = "connectors" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [cForm, setCForm] = useState({ name: "", connector_type: "mysql", host: "", port: 3306, database: "", supports_cdc: true });
  const [jForm, setJForm] = useState({ connector_id: "", name: "", ingest_mode: "batch", schedule: "", source_table: "", target_table: "", cursor_field: "updated_at", batch_size: 1000 });
  const [schema, setSchema] = useState<any>(null);
  const [dryRun, setDryRun] = useState<any>(null);
  const [finishForm, setFinishForm] = useState({ rows_ingested: 1000, cdc_cursor: "binlog.000001:100" });

  useEffect(() => {
    setTab(initialTab);
    setShowForm(false);
  }, [initialTab]);

  const summaryQ = useQuery({ queryKey: ["diSummary"], queryFn: api.dataIngestSummary, enabled: authed });
  const connQ = useQuery({ queryKey: ["diConnectors"], queryFn: () => api.dataIngestConnectors(), enabled: authed });
  const jobsQ = useQuery({ queryKey: ["diJobs"], queryFn: () => api.dataIngestJobs(), enabled: authed && (tab === "jobs" || tab === "runs") });
  const schemaRegistryQ = useQuery({ queryKey: ["diSchemaRegistry"], queryFn: () => api.dataIngestSchemaRegistry(), enabled: authed && tab === "schemas" });
  const runsQ = useQuery({ queryKey: ["diRuns"], queryFn: () => api.dataIngestRuns(), enabled: authed && tab === "runs" });
  const cursorsQ = useQuery({ queryKey: ["diCdcCursors"], queryFn: () => api.dataIngestCdcCursors(), enabled: authed && tab === "runs" });

  const refreshAll = () => {
    void summaryQ.refetch();
    void connQ.refetch();
    void jobsQ.refetch();
    void schemaRegistryQ.refetch();
    void runsQ.refetch();
    void cursorsQ.refetch();
  };

  const createConn = useMutation({
    mutationFn: () => api.dataIngestConnectorCreate({ ...cForm, extra: { supports_cdc: cForm.supports_cdc } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["diConnectors"] });
      void qc.invalidateQueries({ queryKey: ["diSummary"] });
      setShowForm(false);
      setCForm({ name: "", connector_type: "mysql", host: "", port: 3306, database: "", supports_cdc: true });
    },
  });
  const testConn = useMutation({
    mutationFn: (id: string) => api.dataIngestConnectorTest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["diConnectors"] });
      void qc.invalidateQueries({ queryKey: ["diSummary"] });
    },
  });
  const deleteConn = useMutation({
    mutationFn: (id: string) => api.dataIngestConnectorDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["diConnectors"] });
      void qc.invalidateQueries({ queryKey: ["diSummary"] });
    },
  });
  const loadSchema = useMutation({
    mutationFn: (id: string) => api.dataIngestConnectorSchema(id),
    onSuccess: (data) => {
      setSchema(data);
      void qc.invalidateQueries({ queryKey: ["diSchemaRegistry"] });
    },
  });
  const dryRunConn = useMutation({
    mutationFn: (id: string) => api.dataIngestConnectorDryRun(id, { sample_limit: 5 }),
    onSuccess: (data) => {
      setDryRun(data);
      void qc.invalidateQueries({ queryKey: ["diConnectors"] });
      void qc.invalidateQueries({ queryKey: ["diSchemaRegistry"] });
      void qc.invalidateQueries({ queryKey: ["diSummary"] });
    },
  });
  const createJob = useMutation({
    mutationFn: () => api.dataIngestJobCreate(jForm),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["diJobs"] });
      void qc.invalidateQueries({ queryKey: ["diSummary"] });
      setShowForm(false);
      setJForm({ connector_id: "", name: "", ingest_mode: "batch", schedule: "", source_table: "", target_table: "", cursor_field: "updated_at", batch_size: 1000 });
    },
  });
  const runJob = useMutation({
    mutationFn: (id: string) => api.dataIngestJobRun(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["diJobs"] });
      void qc.invalidateQueries({ queryKey: ["diRuns"] });
      void qc.invalidateQueries({ queryKey: ["diSummary"] });
    },
  });
  const finishJob = useMutation({
    mutationFn: (id: string) => api.dataIngestJobStatus(id, { status: "success", rows_ingested: finishForm.rows_ingested, cdc_cursor: finishForm.cdc_cursor }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["diJobs"] });
      void qc.invalidateQueries({ queryKey: ["diRuns"] });
      void qc.invalidateQueries({ queryKey: ["diCdcCursors"] });
      void qc.invalidateQueries({ queryKey: ["diSummary"] });
    },
  });
  const deleteJob = useMutation({
    mutationFn: (id: string) => api.dataIngestJobDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["diJobs"] });
      void qc.invalidateQueries({ queryKey: ["diSummary"] });
    },
  });

  if (!authed) return <NeedLogin />;

  const connectors = connQ.data?.items ?? [];
  const jobs = jobsQ.data?.items ?? [];
  const schemaItems = schemaRegistryQ.data?.items ?? [];
  const runs = runsQ.data?.items ?? [];
  const cursors = cursorsQ.data?.items ?? [];
  const summary = summaryQ.data?.summary ?? {};
  const activeMetaDef = TAB_META[tab];
  const activeMeta = {
    title: t(activeMetaDef.titleKey),
    description: t(activeMetaDef.descriptionKey),
    focus: t(activeMetaDef.focusKey),
  };
  const tabLabel = (value: Tab) => {
    if (value === "connectors") return `${t("page.dataIngest.tabs.connectors")} (${connectors.length})`;
    if (value === "jobs") return `${t("page.dataIngest.tabs.jobs")} (${jobs.length})`;
    if (value === "schemas") return `${t("page.dataIngest.tabs.schemas")} (${schemaItems.length})`;
    return t("page.dataIngest.tabs.runs");
  };

  const connectorColumns: ColumnsType<any> = [
    {
      title: t("page.dataIngest.connectors.name"),
      dataIndex: "name",
      render: (_value, row) => (
        <div className="min-w-[180px]">
          <p className="font-semibold text-[var(--text)]">{row.name}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{row.database || "default"} · {row.id}</p>
        </div>
      ),
    },
    { title: t("page.dataIngest.connectors.type"), dataIndex: "connector_type", width: 130, render: (value) => <AntTag color="blue">{value || "-"}</AntTag> },
    { title: t("page.dataIngest.connectors.endpoint"), key: "endpoint", render: (_value, row) => <span className="text-xs text-[var(--muted)]">{row.host || "-"}:{row.port || "-"}</span> },
    { title: t("page.dataIngest.connectors.status"), dataIndex: "status", width: 120, render: (value) => <AntTag color={statusColor(value)}>{value || "-"}</AntTag> },
    { title: t("page.dataIngest.connectors.lastTested"), dataIndex: "last_tested_at", width: 170, render: (value) => <span className="text-xs text-[var(--muted)]">{shortDate(value)}</span> },
    {
      title: t("common.actions"),
      key: "actions",
      width: 330,
      render: (_value, row) => (
        <Space wrap>
          <Button size="small" type="link" loading={testConn.isPending} onClick={() => testConn.mutate(row.id)}>{t("page.dataIngest.connectors.test")}</Button>
          <Button size="small" type="link" loading={dryRunConn.isPending} onClick={() => dryRunConn.mutate(row.id)}>{t("page.dataIngest.connectors.dryRun")}</Button>
          <Button size="small" type="link" loading={loadSchema.isPending} onClick={() => loadSchema.mutate(row.id)}>{t("page.dataIngest.connectors.discoverSchema")}</Button>
          <Popconfirm title={t("page.dataIngest.connectors.confirmDelete")} onConfirm={() => deleteConn.mutate(row.id)}>
            <Button size="small" danger loading={deleteConn.isPending}>{t("common.delete")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const jobColumns: ColumnsType<any> = [
    {
      title: t("page.dataIngest.jobs.name"),
      dataIndex: "name",
      render: (_value, row) => (
        <div className="min-w-[180px]">
          <p className="font-semibold text-[var(--text)]">{row.name}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{row.source_table || "-"} → {row.target_table || "-"}</p>
        </div>
      ),
    },
    { title: t("page.dataIngest.jobs.mode"), dataIndex: "ingest_mode", width: 110, render: (value) => <AntTag color="geekblue">{value || "-"}</AntTag> },
    { title: t("page.dataIngest.jobs.status"), dataIndex: "status", width: 120, render: (value) => <AntTag color={statusColor(value)}>{value || "-"}</AntTag> },
    { title: t("page.dataIngest.jobs.rows"), dataIndex: "rows_ingested", width: 120, render: (value) => value ?? 0 },
    { title: t("page.dataIngest.jobs.lastRun"), dataIndex: "last_run_at", width: 210, render: (_value, row) => <span className="text-xs text-[var(--muted)]">{shortDate(row.last_run_at)}{row.cdc_cursor ? ` · ${row.cdc_cursor}` : ""}</span> },
    {
      title: t("common.actions"),
      key: "actions",
      width: 190,
      render: (_value, row) => (
        <Space wrap>
          {row.status !== "running" ? <Button size="small" type="link" loading={runJob.isPending} onClick={() => runJob.mutate(row.id)}>{t("page.dataIngest.jobs.run")}</Button> : null}
          {row.status === "running" ? <Button size="small" type="link" loading={finishJob.isPending} onClick={() => finishJob.mutate(row.id)}>{t("page.dataIngest.jobs.finish")}</Button> : null}
          <Popconfirm title={t("page.dataIngest.jobs.confirmDelete")} onConfirm={() => deleteJob.mutate(row.id)}>
            <Button size="small" danger loading={deleteJob.isPending}>{t("common.delete")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const schemaColumns: ColumnsType<any> = [
    { title: t("page.dataIngest.schemas.table"), dataIndex: "table_name", render: (value) => <span className="font-semibold">{value || "-"}</span> },
    { title: t("page.dataIngest.schemas.database"), dataIndex: "database", width: 150, render: (value) => value || "default" },
    { title: t("page.dataIngest.schemas.connector"), dataIndex: "connector_name", width: 180 },
    { title: t("page.dataIngest.schemas.columns"), dataIndex: "columns", render: (items) => <span className="text-xs text-[var(--muted)]">{columnSummary(items)}</span> },
    { title: t("page.dataIngest.schemas.discoveredAt"), dataIndex: "discovered_at", width: 180, render: (value) => <span className="text-xs text-[var(--muted)]">{shortDate(value)}</span> },
  ];

  const runColumns: ColumnsType<any> = [
    { title: t("page.dataIngest.runs.run"), dataIndex: "run_id", width: 150, render: (value) => <span className="font-mono text-xs">{String(value || "").slice(0, 8) || "-"}...</span> },
    { title: t("page.dataIngest.runs.job"), dataIndex: "name" },
    { title: t("page.dataIngest.runs.mode"), dataIndex: "ingest_mode", width: 110, render: (value) => <AntTag>{value || "-"}</AntTag> },
    { title: t("page.dataIngest.runs.status"), dataIndex: "status", width: 120, render: (value) => <AntTag color={statusColor(value)}>{value || "-"}</AntTag> },
    { title: t("page.dataIngest.runs.rows"), dataIndex: "rows_ingested", width: 110, render: (value) => value ?? 0 },
    { title: t("page.dataIngest.runs.cursor"), dataIndex: "cdc_cursor", render: (value) => <span className="font-mono text-xs text-[var(--muted)]">{value || "-"}</span> },
  ];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={focused ? activeMeta.title : t("page.dataIngest.workbenchTitle")}
        description={focused ? activeMeta.description : t("page.dataIngest.workbenchDesc")}
        actions={
          <Space wrap>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <Button icon={<RefreshCw className="h-4 w-4" />} onClick={refreshAll}>{t("common.refresh")}</Button>
          </Space>
        }
        metrics={
          <WorkbenchStats items={[
            { label: t("page.dataIngest.metrics.connectors"), value: summary.connectors ?? connectors.length },
            { label: t("page.dataIngest.metrics.activeJobs"), value: summary.active_jobs ?? jobs.filter((job: any) => job.status === "running").length },
            { label: t("page.dataIngest.metrics.rowsToday"), value: summary.rows_today ?? 0 },
            { label: t("page.dataIngest.metrics.cdcStreams"), value: summary.cdc_streams ?? 0 },
          ]} />
        }
      >
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
          {focused ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-1">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.dataIngest.focusedTag")}</span>
                  <a href="#/data/ingest" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.dataIngest.backToHub")}</a>
                  <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.dataIngest.focusedHint")}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--text)]">{activeMeta.focus}</p>
              </div>
              <Select
                className="min-w-52"
                value={tab}
                options={TAB_KEYS.map((tabId) => ({ value: tabId, label: t(`page.dataIngest.tabs.${tabId}`) }))}
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

        {tab === "connectors" ? (
          <WorkbenchPanel
            title={t("page.dataIngest.panels.connectors")}
            actions={
              <Space wrap>
                <RefreshButton onClick={() => void connQ.refetch()} pending={connQ.isFetching} />
                <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setShowForm((value) => !value)}>{t("page.dataIngest.connectors.create")}</Button>
              </Space>
            }
          >
            {showForm ? (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input placeholder={t("page.dataIngest.connectors.nameRequired")} value={cForm.name} onChange={(event) => setCForm((value) => ({ ...value, name: event.target.value }))} />
                  <Select value={cForm.connector_type} options={CONNECTOR_TYPES.map((value) => ({ value, label: value }))} onChange={(connector_type) => setCForm((value) => ({ ...value, connector_type }))} />
                  <Input placeholder={t("page.dataIngest.connectors.host")} value={cForm.host} onChange={(event) => setCForm((value) => ({ ...value, host: event.target.value }))} />
                  <InputNumber className="w-full" min={1} max={65535} placeholder={t("page.dataIngest.connectors.port")} value={cForm.port} onChange={(port) => setCForm((value) => ({ ...value, port: Number(port ?? 3306) }))} />
                  <Input className="sm:col-span-2" placeholder={t("page.dataIngest.connectors.database")} value={cForm.database} onChange={(event) => setCForm((value) => ({ ...value, database: event.target.value }))} />
                  <Checkbox checked={cForm.supports_cdc} onChange={(event) => setCForm((value) => ({ ...value, supports_cdc: event.target.checked }))}>{t("page.dataIngest.connectors.supportsCdc")}</Checkbox>
                </div>
                <Space className="mt-3" wrap>
                  <Button type="primary" disabled={!cForm.name.trim()} loading={createConn.isPending} onClick={() => createConn.mutate()}>{t("page.dataIngest.connectors.save")}</Button>
                  <Button onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
                </Space>
              </div>
            ) : null}
            <Table rowKey="id" columns={connectorColumns} dataSource={connectors} loading={connQ.isFetching} pagination={{ pageSize: 8 }} locale={{ emptyText: t("page.dataIngest.connectors.empty") }} />
            {schema ? (
              <Alert
                className="mt-4"
                type="info"
                showIcon
                message={t("page.dataIngest.connectors.schemaResult")}
                description={
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(schema.tables ?? []).map((item: any) => (
                      <div key={item.name} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{columnSummary(item.columns)}</p>
                      </div>
                    ))}
                  </div>
                }
              />
            ) : null}
            {dryRun ? (
              <Alert
                className="mt-4"
                type={dryRun.status === "passed" ? "success" : "warning"}
                showIcon
                message={t("page.dataIngest.connectors.dryRunResult")}
                description={
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center"><p className="text-xs text-[var(--muted)]">{t("page.dataIngest.connectors.status")}</p><p className="text-lg font-semibold">{dryRun.status}</p></div>
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center"><p className="text-xs text-[var(--muted)]">{t("page.dataIngest.connectors.tables")}</p><p className="text-lg font-semibold">{dryRun.schema_summary?.tables ?? 0}</p></div>
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center"><p className="text-xs text-[var(--muted)]">{t("page.dataIngest.connectors.columns")}</p><p className="text-lg font-semibold">{dryRun.schema_summary?.columns ?? 0}</p></div>
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-center"><p className="text-xs text-[var(--muted)]">CDC</p><p className="text-lg font-semibold">{dryRun.supports_cdc ? t("common.yes") : t("common.no")}</p></div>
                  </div>
                }
              />
            ) : null}
          </WorkbenchPanel>
        ) : null}

        {tab === "jobs" ? (
          <WorkbenchPanel
            title={t("page.dataIngest.panels.jobs")}
            actions={
              <Space wrap>
                <RefreshButton onClick={() => void jobsQ.refetch()} pending={jobsQ.isFetching} />
                <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setShowForm((value) => !value)}>{t("page.dataIngest.jobs.create")}</Button>
              </Space>
            }
          >
            {showForm ? (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input placeholder={t("page.dataIngest.jobs.nameRequired")} value={jForm.name} onChange={(event) => setJForm((value) => ({ ...value, name: event.target.value }))} />
                  <Select value={jForm.connector_id} options={[{ value: "", label: t("page.dataIngest.jobs.selectConnector") }, ...connectors.map((item: any) => ({ value: item.id, label: item.name }))]} onChange={(connector_id) => setJForm((value) => ({ ...value, connector_id }))} />
                  <Select value={jForm.ingest_mode} options={INGEST_MODES.map((value) => ({ value, label: value }))} onChange={(ingest_mode) => setJForm((value) => ({ ...value, ingest_mode }))} />
                  <Input placeholder={t("page.dataIngest.jobs.schedule")} value={jForm.schedule} onChange={(event) => setJForm((value) => ({ ...value, schedule: event.target.value }))} />
                  <Input placeholder={t("page.dataIngest.jobs.sourceTable")} value={jForm.source_table} onChange={(event) => setJForm((value) => ({ ...value, source_table: event.target.value }))} />
                  <Input placeholder={t("page.dataIngest.jobs.targetTable")} value={jForm.target_table} onChange={(event) => setJForm((value) => ({ ...value, target_table: event.target.value }))} />
                  <Input placeholder={t("page.dataIngest.jobs.cursorField")} value={jForm.cursor_field} onChange={(event) => setJForm((value) => ({ ...value, cursor_field: event.target.value }))} />
                  <InputNumber className="w-full" min={1} placeholder={t("page.dataIngest.jobs.batchSize")} value={jForm.batch_size} onChange={(batch_size) => setJForm((value) => ({ ...value, batch_size: Number(batch_size ?? 1000) }))} />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <InputNumber className="w-full" min={0} placeholder={t("page.dataIngest.jobs.finishRows")} value={finishForm.rows_ingested} onChange={(rows_ingested) => setFinishForm((value) => ({ ...value, rows_ingested: Number(rows_ingested ?? 0) }))} />
                  <Input placeholder={t("page.dataIngest.jobs.finishCursor")} value={finishForm.cdc_cursor} onChange={(event) => setFinishForm((value) => ({ ...value, cdc_cursor: event.target.value }))} />
                </div>
                <Space className="mt-3" wrap>
                  <Button type="primary" disabled={!jForm.name.trim() || !jForm.connector_id} loading={createJob.isPending} onClick={() => createJob.mutate()}>{t("page.dataIngest.jobs.save")}</Button>
                  <Button onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
                </Space>
              </div>
            ) : null}
            <Table rowKey="id" columns={jobColumns} dataSource={jobs} loading={jobsQ.isFetching} pagination={{ pageSize: 8 }} locale={{ emptyText: t("page.dataIngest.jobs.empty") }} />
          </WorkbenchPanel>
        ) : null}

        {tab === "schemas" ? (
          <WorkbenchPanel title={t("page.dataIngest.panels.schemas")} actions={<RefreshButton onClick={() => void schemaRegistryQ.refetch()} pending={schemaRegistryQ.isFetching} />}>
            <Table rowKey="id" columns={schemaColumns} dataSource={schemaItems} loading={schemaRegistryQ.isFetching} pagination={{ pageSize: 8 }} locale={{ emptyText: t("page.dataIngest.schemas.empty") }} />
          </WorkbenchPanel>
        ) : null}

        {tab === "runs" ? (
          <WorkbenchPanel title={t("page.dataIngest.panels.runs")} actions={<RefreshButton onClick={() => { void runsQ.refetch(); void cursorsQ.refetch(); }} pending={runsQ.isFetching || cursorsQ.isFetching} />}>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {cursors.length === 0 ? <Alert className="sm:col-span-2 xl:col-span-4" type="info" showIcon message={t("page.dataIngest.runs.emptyCursors")} /> : null}
              {cursors.map((item: any) => (
                <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)]"><Database className="h-3.5 w-3.5" />{item.source_table || item.job_id}</div>
                  <p className="mt-1 truncate font-mono text-sm text-[var(--brand)]">{item.cursor || "-"}</p>
                </div>
              ))}
            </div>
            <Table rowKey="id" columns={runColumns} dataSource={runs} loading={runsQ.isFetching} pagination={{ pageSize: 8 }} locale={{ emptyText: t("page.dataIngest.runs.empty") }} />
          </WorkbenchPanel>
        ) : null}

        <AiAssistDrawer
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          module="data-ingest"
          title={t("page.dataIngest.aiTitle")}
          context={{ tab, connectors: connectors.length, jobs: jobs.length, schemaItems: schemaItems.length, runs: runs.length }}
          initialPrompt={t("page.dataIngest.aiPrompt")}
        />
      </WorkbenchShell>
    </div>
  );
}
