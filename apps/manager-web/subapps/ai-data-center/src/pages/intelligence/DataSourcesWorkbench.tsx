import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Checkbox, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Database, FileSearch, Link2, Plus, RefreshCcw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { LoadingBlock, NeedLogin } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { RefreshButton, WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

type DataSourceView = "overview" | "connections" | "metadata" | "security";
const VIEW_KEYS: DataSourceView[] = ["overview", "connections", "metadata", "security"];

type SourceForm = {
  name: string;
  type: string;
  role: string;
  capabilities: string[];
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  schema_name?: string;
  ssl_mode?: string;
  readonly?: boolean;
  pool_size?: number;
  url_env?: string;
  secret_ref?: string;
};

type SourceRow = SourceForm & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

const DEFAULT_SOURCE: SourceForm = {
  name: "",
  type: "mysql",
  role: "business",
  capabilities: ["sql"],
  host: "",
  port: 3306,
  database: "",
  username: "",
  schema_name: "",
  ssl_mode: "",
  readonly: true,
  pool_size: 5,
  url_env: "",
  secret_ref: "",
};

const VIEW_HREF: Record<DataSourceView, string> = {
  overview: "#/data/sources/overview",
  connections: "#/data/sources/connections",
  metadata: "#/data/sources/metadata",
  security: "#/data/sources/security",
};

function normalizeView(view?: string): DataSourceView {
  return view && VIEW_KEYS.includes(view as DataSourceView) ? (view as DataSourceView) : "overview";
}

export function DataSourcesWorkbench({
  focused = false,
  initialView = "overview",
}: {
  focused?: boolean;
  initialView?: string;
}) {
  const authed = Boolean(getToken());
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [previewPayload, setPreviewPayload] = useState<any>(null);
  const [syncPayload, setSyncPayload] = useState<any>(null);
  const [securityPayload, setSecurityPayload] = useState<any>(null);
  const [form] = Form.useForm<SourceForm>();

  const connQ = useQuery({ queryKey: ["dbConnections"], queryFn: api.dbConnections, enabled: authed });
  const summaryQ = useQuery({ queryKey: ["dbConnectionsSummary"], queryFn: api.dbConnectionsSummary, enabled: authed });
  const driversQ = useQuery({ queryKey: ["dbDrivers"], queryFn: api.dbDrivers, enabled: authed });

  const sources: SourceRow[] = connQ.data?.items ?? [];
  const summary = summaryQ.data?.summary ?? {};
  const driverCatalog = driversQ.data ?? {};
  const sourceTypes: string[] = driverCatalog.sql?.supported ?? driverCatalog.drivers ?? ["mysql", "postgresql", "oceanbase", "sqlite"];
  const roles: string[] = driverCatalog.roles ?? ["metadata", "business", "analytics", "vector", "memory", "audit"];
  const capabilities: string[] = driverCatalog.capabilities ?? ["sql", "vector", "json", "graph", "analytics", "memory", "audit"];

  const readinessMap = useMemo(() => {
    const rows = Array.isArray(summaryQ.data?.readiness) ? summaryQ.data.readiness : [];
    return new Map(rows.map((item: any) => [item.name, item]));
  }, [summaryQ.data]);

  const selectedSource = sources.find((item) => item.name === selectedName) ?? sources[0];

  const refreshAll = () => {
    void connQ.refetch();
    void summaryQ.refetch();
  };

  const openCreate = () => {
    setEditingName(null);
    form.setFieldsValue(DEFAULT_SOURCE);
    setEditOpen(true);
  };

  const openEdit = (row: SourceRow) => {
    setEditingName(row.name);
    form.setFieldsValue({ ...DEFAULT_SOURCE, ...row, capabilities: row.capabilities?.length ? row.capabilities : ["sql"] });
    setEditOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: (v: SourceForm) => api.dbUpsertConnection(editingName || v.name, v),
    onSuccess: () => {
      setEditOpen(false);
      setEditingName(null);
      form.resetFields();
      refreshAll();
      message.success(t("page.dataSources.messages.saved"));
    },
    onError: (e) => message.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => api.dbDeleteConnection(name),
    onSuccess: () => {
      refreshAll();
      message.success(t("page.dataSources.messages.deleted"));
    },
    onError: (e) => message.error((e as Error).message),
  });

  const testMut = useMutation({
    mutationFn: (name: string) => api.dbTestConnection(name),
    onSuccess: (data) => message.success(data?.message || t("page.dataSources.messages.testOk")),
    onError: (e) => message.error((e as Error).message),
  });

  const previewMut = useMutation({
    mutationFn: (name: string) => api.dbMetadataPreview(name, { sample_limit: 50 }),
    onSuccess: (payload, name) => {
      setSelectedName(name);
      setPreviewPayload(payload);
      setSyncPayload(null);
      message.success(t("page.dataSources.messages.previewReady"));
    },
    onError: (e) => message.error((e as Error).message),
  });

  const syncMut = useMutation({
    mutationFn: (name: string) => api.dbMetadataSync(name, { create_ingest_connector: true, sample_limit: 50, owner: "DataOps" }),
    onSuccess: (payload, name) => {
      setSelectedName(name);
      setSyncPayload(payload);
      message.success(t("page.dataSources.messages.syncReady"));
    },
    onError: (e) => message.error((e as Error).message),
  });

  const securityMut = useMutation({
    mutationFn: (name: string) => api.dbSecurityScan(name, { sample_limit: 80 }),
    onSuccess: (payload, name) => {
      setSelectedName(name);
      setSecurityPayload(payload);
      message.success(t("page.dataSources.messages.securityReady"));
    },
    onError: (e) => message.error((e as Error).message),
  });

  if (!authed) return <NeedLogin />;
  if (connQ.isLoading || summaryQ.isLoading) return <LoadingBlock />;

  const view = normalizeView(initialView);
  const viewOptions = VIEW_KEYS.map((key) => ({
    value: key,
    label: t(`page.dataSources.modules.${key}.title`),
  }));

  return (
    <WorkbenchShell
      title={focused ? t(`page.dataSources.modules.${view}.title`) : t("page.dataSources.workbenchTitle")}
      description={focused ? t(`page.dataSources.modules.${view}.description`) : t("page.dataSources.workbenchDesc")}
      actions={
        <Space wrap>
          <AiAssistButton onClick={() => setAiOpen(true)} />
          <Button icon={<RefreshCcw className="h-4 w-4" />} onClick={refreshAll}>{t("common.refresh")}</Button>
          {view === "connections" ? <Button icon={<Plus className="h-4 w-4" />} type="primary" onClick={openCreate}>{t("page.dataSources.createSource")}</Button> : null}
        </Space>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.dataSources.metrics.total"), value: summary.total ?? sources.length },
            { label: t("page.dataSources.metrics.ready"), value: summary.ready ?? 0, trend: "up" },
            { label: t("page.dataSources.metrics.watch"), value: summary.watch ?? 0 },
            { label: t("page.dataSources.metrics.readinessScore"), value: summary.readiness_score ?? 0 },
          ]}
        />
      }
    >
      {focused ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.dataSources.focusedTag")}</span>
              <a href="#/data/sources" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.dataSources.backToHub")}</a>
              <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.dataSources.focusedHint")}</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-[var(--text)]">{t(`page.dataSources.modules.${view}.title`)}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{t(`page.dataSources.modules.${view}.focus`)}</p>
          </div>
          <Select
            className="min-w-52"
            value={view}
            options={viewOptions}
            onChange={(next) => { window.location.hash = VIEW_HREF[next as DataSourceView].slice(1); }}
          />
        </div>
      ) : null}

      {view === "overview" ? <Overview summary={summary} /> : null}
      {view === "connections" ? (
        <ConnectionsPanel
          sources={sources}
          readinessMap={readinessMap}
          onCreate={openCreate}
          onEdit={openEdit}
          onDelete={(name) => deleteMut.mutate(name)}
          onTest={(name) => testMut.mutate(name)}
          testing={testMut.isPending}
          refreshing={connQ.isFetching || summaryQ.isFetching}
          onRefresh={refreshAll}
        />
      ) : null}
      {view === "metadata" ? (
        <MetadataPanel
          sources={sources}
          selectedName={selectedSource?.name ?? ""}
          previewPayload={previewPayload}
          syncPayload={syncPayload}
          previewing={previewMut.isPending}
          syncing={syncMut.isPending}
          onSelect={(name) => {
            setSelectedName(name);
            setPreviewPayload(null);
            setSyncPayload(null);
          }}
          onPreview={(name) => previewMut.mutate(name)}
          onSync={(name) => syncMut.mutate(name)}
        />
      ) : null}
      {view === "security" ? (
        <SecurityPanel
          sources={sources}
          selectedName={selectedSource?.name ?? ""}
          scanPayload={securityPayload}
          scanning={securityMut.isPending}
          onSelect={(name) => {
            setSelectedName(name);
            setSecurityPayload(null);
          }}
          onScan={(name) => securityMut.mutate(name)}
        />
      ) : null}

      <SourceEditor
        open={editOpen}
        editingName={editingName}
        form={form}
        sourceTypes={sourceTypes}
        roles={roles}
        capabilities={capabilities}
        saving={saveMut.isPending}
        onCancel={() => setEditOpen(false)}
        onSubmit={(v) => saveMut.mutate({ ...DEFAULT_SOURCE, ...v })}
      />
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="data-sources" title={t("page.dataSources.aiTitle")} initialPrompt={t("page.dataSources.aiPrompt")} />
    </WorkbenchShell>
  );
}

function Overview({ summary }: { summary: any }) {
  const { t } = useTranslation();
  const modules = [
    { href: "#/data/sources/connections", icon: Database, title: t("page.dataSources.overview.connectionsTitle"), desc: t("page.dataSources.overview.connectionsDesc") },
    { href: "#/data/sources/metadata", icon: FileSearch, title: t("page.dataSources.overview.metadataTitle"), desc: t("page.dataSources.overview.metadataDesc") },
    { href: "#/data/ingest/schema", icon: Link2, title: t("page.dataSources.overview.schemaTitle"), desc: t("page.dataSources.overview.schemaDesc") },
    { href: "#/data/sources/security", icon: ShieldCheck, title: t("page.dataSources.overview.securityTitle"), desc: t("page.dataSources.overview.securityDesc") },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <WorkbenchPanel title={t("page.dataSources.overview.coreEntries")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {modules.map(({ href, icon: Icon, title, desc }) => (
            <a key={href} href={href} className="group rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]">
              <Icon className="mb-3 h-5 w-5 text-[var(--brand)]" />
              <span className="block text-sm font-semibold text-[var(--text)]">{title}</span>
              <span className="mt-1 block text-xs text-[var(--muted)]">{desc}</span>
            </a>
          ))}
        </div>
      </WorkbenchPanel>
      <WorkbenchPanel title={t("page.dataSources.overview.coverage")}>
        <CompactKV title={t("page.dataSources.overview.byRole")} value={summary.by_role ?? {}} />
        <CompactKV title={t("page.dataSources.overview.byType")} value={summary.by_type ?? {}} />
        <CompactKV title={t("page.dataSources.overview.capabilities")} value={summary.capabilities ?? {}} />
      </WorkbenchPanel>
    </div>
  );
}

function SecurityPanel({
  sources,
  selectedName,
  scanPayload,
  scanning,
  onSelect,
  onScan,
}: {
  sources: SourceRow[];
  selectedName: string;
  scanPayload: any;
  scanning: boolean;
  onSelect: (name: string) => void;
  onScan: (name: string) => void;
}) {
  const { t } = useTranslation();
  const findings = scanPayload?.findings ?? [];
  return (
    <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <WorkbenchPanel title={t("page.dataSources.security.scope")}>
        <Space direction="vertical" className="w-full">
          <Select
            className="w-full"
            value={selectedName || undefined}
            placeholder={t("page.dataSources.security.selectSource")}
            options={sources.map((item) => ({ value: item.name, label: `${item.name} · ${item.type}` }))}
            onChange={onSelect}
          />
          <Button className="w-full" type="primary" disabled={!selectedName} loading={scanning} onClick={() => onScan(selectedName)}>
            {t("page.dataSources.security.runScan")}
          </Button>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--muted)]">
            {t("page.dataSources.security.description")}
          </div>
        </Space>
      </WorkbenchPanel>
      <WorkbenchPanel title={t("page.dataSources.security.result")}>
        {!scanPayload ? (
          <EmptyHint />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label={t("page.dataSources.security.score")} value={scanPayload.score ?? 0} />
              <Metric label={t("page.dataSources.security.status")} value={scanPayload.status ?? "-"} />
              <Metric label={t("page.dataSources.security.findings")} value={findings.length} />
              <Metric label={t("page.dataSources.security.candidateTasks")} value={scanPayload.candidate_tasks?.length ?? 0} />
            </div>
            <Table
              rowKey="id"
              size="small"
              pagination={{ pageSize: 8 }}
              dataSource={findings}
              columns={[
                { title: t("page.dataSources.security.severity"), dataIndex: "severity", width: 100, render: (v) => <Tag color={v === "high" ? "red" : "orange"}>{v}</Tag> },
                { title: t("page.dataSources.security.issue"), dataIndex: "title", width: 180 },
                { title: t("page.dataSources.security.detail"), dataIndex: "detail" },
                { title: t("page.dataSources.security.recommendation"), dataIndex: "recommendation" },
              ]}
              scroll={{ x: 900 }}
            />
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <p className="text-sm font-semibold text-[var(--text)]">{t("page.dataSources.security.controls")}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {Object.entries(scanPayload.controls ?? {}).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-md bg-[var(--surface-muted)] px-3 py-2 text-xs">
                    <span className="font-mono text-[var(--muted)]">{key}</span>
                    <span className="text-right font-semibold text-[var(--text)]">{Array.isArray(value) ? value.join(", ") : String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </WorkbenchPanel>
    </div>
  );
}

function ConnectionsPanel({
  sources,
  readinessMap,
  refreshing,
  testing,
  onRefresh,
  onCreate,
  onEdit,
  onDelete,
  onTest,
}: {
  sources: SourceRow[];
  readinessMap: Map<any, any>;
  refreshing: boolean;
  testing: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onEdit: (row: SourceRow) => void;
  onDelete: (name: string) => void;
  onTest: (name: string) => void;
}) {
  const { t } = useTranslation();
  const columns: ColumnsType<SourceRow> = [
    {
      title: t("page.dataSources.connections.source"),
      dataIndex: "name",
      render: (_, row) => (
        <div>
          <div className="font-semibold text-[var(--text)]">{row.name}</div>
          <div className="text-xs text-[var(--muted)]">{row.host || t("page.dataSources.connections.local")}{row.port ? `:${row.port}` : ""} / {row.database || t("page.dataSources.connections.defaultDb")}</div>
        </div>
      ),
    },
    { title: t("page.dataSources.connections.type"), dataIndex: "type", width: 120, render: (value) => <Tag>{value}</Tag> },
    { title: t("page.dataSources.connections.role"), dataIndex: "role", width: 130 },
    {
      title: t("page.dataSources.connections.capabilities"),
      dataIndex: "capabilities",
      render: (items: string[] = []) => <Space wrap>{items.map((item) => <Tag key={item} color="blue">{item}</Tag>)}</Space>,
    },
    {
      title: t("page.dataSources.connections.secretRef"),
      key: "secret",
      ellipsis: true,
      render: (_, row) => row.secret_ref || row.url_env || <span className="text-xs text-amber-600">{t("page.dataSources.connections.unconfigured")}</span>,
    },
    {
      title: t("page.dataSources.connections.readiness"),
      key: "readiness",
      width: 100,
      render: (_, row) => {
        const item = readinessMap.get(row.name);
        const color = item?.status === "ready" ? "success" : item?.status === "watch" ? "warning" : "error";
        return <Tag color={color}>{item?.score ?? 0}</Tag>;
      },
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 260,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => onEdit(row)}>{t("page.dataSources.connections.edit")}</Button>
          <Button size="small" loading={testing} onClick={() => onTest(row.name)}>{t("page.dataSources.connections.test")}</Button>
          <Button size="small" href="#/data/sources/metadata">{t("page.dataSources.connections.metadata")}</Button>
          <Popconfirm title={t("page.dataSources.connections.confirmDelete")} onConfirm={() => onDelete(row.name)}>
            <Button size="small" danger>{t("common.delete")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <WorkbenchPanel title={t("page.dataSources.connections.panel")} actions={<Space><RefreshButton onClick={onRefresh} pending={refreshing} /><Button type="primary" onClick={onCreate}>{t("page.dataSources.connections.create")}</Button></Space>}>
      <Table rowKey="name" columns={columns} dataSource={sources} pagination={{ pageSize: 10 }} scroll={{ x: 1080 }} />
    </WorkbenchPanel>
  );
}

function MetadataPanel({
  sources,
  selectedName,
  previewPayload,
  syncPayload,
  previewing,
  syncing,
  onSelect,
  onPreview,
  onSync,
}: {
  sources: SourceRow[];
  selectedName: string;
  previewPayload: any;
  syncPayload: any;
  previewing: boolean;
  syncing: boolean;
  onSelect: (name: string) => void;
  onPreview: (name: string) => void;
  onSync: (name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <WorkbenchPanel title={t("page.dataSources.metadata.scope")}>
        <Space direction="vertical" className="w-full">
          <Select
            className="w-full"
            value={selectedName || undefined}
            placeholder={t("page.dataSources.metadata.selectSource")}
            options={sources.map((item) => ({ value: item.name, label: `${item.name} · ${item.type}` }))}
            onChange={onSelect}
          />
          <Button className="w-full" type="primary" disabled={!selectedName} loading={previewing} onClick={() => onPreview(selectedName)}>{t("page.dataSources.metadata.preview")}</Button>
          <Button className="w-full" disabled={!selectedName} loading={syncing} onClick={() => onSync(selectedName)}>{t("page.dataSources.metadata.sync")}</Button>
        </Space>
      </WorkbenchPanel>
      <WorkbenchPanel title={t("page.dataSources.metadata.result")}>
        {!previewPayload ? (
          <EmptyHint />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label={t("page.dataSources.metadata.tables")} value={previewPayload.metadata?.tables ?? 0} />
              <Metric label={t("page.dataSources.metadata.columns")} value={previewPayload.metadata?.columns ?? 0} />
              <Metric label={t("page.dataSources.metadata.piiCandidates")} value={previewPayload.metadata?.pii_candidates ?? 0} />
              <Metric label={t("page.dataSources.metadata.readonly")} value={previewPayload.metadata?.readonly ? t("common.yes") : t("common.no")} />
            </div>
            <Table
              rowKey="name"
              size="small"
              pagination={{ pageSize: 8 }}
              dataSource={previewPayload.tables ?? []}
              columns={[
                { title: t("page.dataSources.metadata.tableName"), dataIndex: "name", width: 220 },
                { title: t("page.dataSources.metadata.schema"), dataIndex: "schema_name", width: 120 },
                { title: t("page.dataSources.metadata.columns"), render: (_, row: any) => (row.columns ?? []).map((col: any) => `${col.name}:${col.type}`).join(", ") },
              ]}
            />
            {syncPayload ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t("page.dataSources.metadata.syncResult", { count: syncPayload.schema_registry?.total ?? 0 })}</span>
                  <Button size="small" href="#/data/ingest/schema">{t("page.dataSources.metadata.openSchemaRegistry")}</Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </WorkbenchPanel>
    </div>
  );
}

function SourceEditor({
  open,
  editingName,
  form,
  sourceTypes,
  roles,
  capabilities,
  saving,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  editingName: string | null;
  form: ReturnType<typeof Form.useForm<SourceForm>>[0];
  sourceTypes: string[];
  roles: string[];
  capabilities: string[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: SourceForm) => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      title={editingName ? t("page.dataSources.editor.editTitle") : t("page.dataSources.editor.createTitle")}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={saving}
      width={820}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onSubmit} initialValues={DEFAULT_SOURCE}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Form.Item name="name" label={t("page.dataSources.editor.name")} rules={[{ required: true, message: t("page.dataSources.messages.nameRequired") }]}>
            <Input disabled={Boolean(editingName)} placeholder={t("page.dataSources.editor.namePlaceholder")} />
          </Form.Item>
          <Form.Item name="type" label={t("page.dataSources.editor.type")} rules={[{ required: true }]}>
            <Select options={sourceTypes.map((item) => ({ value: item, label: item }))} />
          </Form.Item>
          <Form.Item name="role" label={t("page.dataSources.editor.role")} rules={[{ required: true }]}>
            <Select options={roles.map((item) => ({ value: item, label: item }))} />
          </Form.Item>
          <Form.Item name="capabilities" label={t("page.dataSources.editor.capabilities")} rules={[{ required: true }]}>
            <Select mode="multiple" options={capabilities.map((item) => ({ value: item, label: item }))} />
          </Form.Item>
          <Form.Item name="host" label={t("page.dataSources.editor.host")}><Input placeholder={t("page.dataSources.editor.hostPlaceholder")} /></Form.Item>
          <Form.Item name="port" label={t("page.dataSources.editor.port")}><InputNumber className="w-full" min={0} max={65535} /></Form.Item>
          <Form.Item name="database" label={t("page.dataSources.editor.database")}><Input placeholder={t("page.dataSources.editor.databasePlaceholder")} /></Form.Item>
          <Form.Item name="schema_name" label={t("page.dataSources.editor.schema")}><Input placeholder={t("page.dataSources.editor.schemaPlaceholder")} /></Form.Item>
          <Form.Item name="username" label={t("page.dataSources.editor.username")}><Input placeholder={t("page.dataSources.editor.usernamePlaceholder")} /></Form.Item>
          <Form.Item name="pool_size" label={t("page.dataSources.editor.poolSize")}><InputNumber className="w-full" min={1} max={200} /></Form.Item>
          <Form.Item name="url_env" label={t("page.dataSources.editor.urlEnv")}><Input placeholder={t("page.dataSources.editor.urlEnvPlaceholder")} /></Form.Item>
          <Form.Item name="secret_ref" label={t("page.dataSources.editor.secretRef")}><Input placeholder={t("page.dataSources.editor.secretRefPlaceholder")} /></Form.Item>
          <Form.Item name="ssl_mode" label={t("page.dataSources.editor.sslMode")}><Input placeholder={t("page.dataSources.editor.sslModePlaceholder")} /></Form.Item>
          <Form.Item name="readonly" label={t("page.dataSources.editor.securityPolicy")} valuePropName="checked">
            <Switch checkedChildren={t("page.dataSources.editor.readonly")} unCheckedChildren={t("page.dataSources.editor.readwrite")} />
          </Form.Item>
        </div>
        <Checkbox checked disabled>{t("page.dataSources.editor.noPlainSecret")}</Checkbox>
      </Form>
    </Modal>
  );
}

function CompactKV({ title, value }: { title: string; value: Record<string, unknown> }) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-[var(--brand)]" />
        {title}
      </div>
      <div className="space-y-1">
        {Object.entries(value).length === 0 ? <p className="text-xs text-[var(--muted)]">{t("page.dataSources.overview.empty")}</p> : null}
        {Object.entries(value).map(([key, count]) => (
          <div key={key} className="flex justify-between text-xs">
            <span className="text-[var(--muted)]">{key}</span>
            <span className="font-semibold">{String(count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function EmptyHint() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-60 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-center">
      <FileSearch className="mb-3 h-8 w-8 text-[var(--muted)]" />
      <p className="text-sm font-medium">{t("page.dataSources.metadata.emptyHint")}</p>
    </div>
  );
}
