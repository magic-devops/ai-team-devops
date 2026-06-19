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
      message.success("数据源已保存");
    },
    onError: (e) => message.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => api.dbDeleteConnection(name),
    onSuccess: () => {
      refreshAll();
      message.success("数据源已删除");
    },
    onError: (e) => message.error((e as Error).message),
  });

  const testMut = useMutation({
    mutationFn: (name: string) => api.dbTestConnection(name),
    onSuccess: (data) => message.success(data?.message || "连接测试通过"),
    onError: (e) => message.error((e as Error).message),
  });

  const previewMut = useMutation({
    mutationFn: (name: string) => api.dbMetadataPreview(name, { sample_limit: 50 }),
    onSuccess: (payload, name) => {
      setSelectedName(name);
      setPreviewPayload(payload);
      setSyncPayload(null);
      message.success("元数据预览已生成");
    },
    onError: (e) => message.error((e as Error).message),
  });

  const syncMut = useMutation({
    mutationFn: (name: string) => api.dbMetadataSync(name, { create_ingest_connector: true, sample_limit: 50, owner: "DataOps" }),
    onSuccess: (payload, name) => {
      setSelectedName(name);
      setSyncPayload(payload);
      message.success("已同步到 Schema Registry");
    },
    onError: (e) => message.error((e as Error).message),
  });

  const securityMut = useMutation({
    mutationFn: (name: string) => api.dbSecurityScan(name, { sample_limit: 80 }),
    onSuccess: (payload, name) => {
      setSelectedName(name);
      setSecurityPayload(payload);
      message.success("安全扫描已完成");
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
  const modules = [
    { href: "#/data/sources/connections", icon: Database, title: "连接目录", desc: "维护数据源、SecretRef 和能力声明" },
    { href: "#/data/sources/metadata", icon: FileSearch, title: "元数据同步", desc: "发现表字段并注册到 Schema Registry" },
    { href: "#/data/ingest/schema", icon: Link2, title: "Schema Registry", desc: "查看已同步的数据接入结构" },
    { href: "#/data/sources/security", icon: ShieldCheck, title: "安全治理", desc: "扫描 SecretRef、敏感字段和隔离字段" },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <WorkbenchPanel title="核心入口">
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
      <WorkbenchPanel title="覆盖概况">
        <CompactKV title="按角色" value={summary.by_role ?? {}} />
        <CompactKV title="按类型" value={summary.by_type ?? {}} />
        <CompactKV title="能力" value={summary.capabilities ?? {}} />
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
  const findings = scanPayload?.findings ?? [];
  return (
    <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <WorkbenchPanel title="扫描范围">
        <Space direction="vertical" className="w-full">
          <Select
            className="w-full"
            value={selectedName || undefined}
            placeholder="选择数据源"
            options={sources.map((item) => ({ value: item.name, label: `${item.name} · ${item.type}` }))}
            onChange={onSelect}
          />
          <Button className="w-full" type="primary" disabled={!selectedName} loading={scanning} onClick={() => onScan(selectedName)}>
            运行安全扫描
          </Button>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-5 text-[var(--muted)]">
            扫描覆盖 SecretRef、只读策略、敏感字段候选、tenant_code/business_code/project_id 隔离字段，并输出 Agent 可消费治理任务候选。
          </div>
        </Space>
      </WorkbenchPanel>
      <WorkbenchPanel title="安全结果">
        {!scanPayload ? (
          <EmptyHint />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="安全分" value={scanPayload.score ?? 0} />
              <Metric label="状态" value={scanPayload.status ?? "-"} />
              <Metric label="问题" value={findings.length} />
              <Metric label="任务候选" value={scanPayload.candidate_tasks?.length ?? 0} />
            </div>
            <Table
              rowKey="id"
              size="small"
              pagination={{ pageSize: 8 }}
              dataSource={findings}
              columns={[
                { title: "风险", dataIndex: "severity", width: 100, render: (v) => <Tag color={v === "high" ? "red" : "orange"}>{v}</Tag> },
                { title: "问题", dataIndex: "title", width: 180 },
                { title: "说明", dataIndex: "detail" },
                { title: "建议", dataIndex: "recommendation" },
              ]}
              scroll={{ x: 900 }}
            />
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <p className="text-sm font-semibold text-[var(--text)]">治理控制点</p>
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
  const columns: ColumnsType<SourceRow> = [
    {
      title: "数据源",
      dataIndex: "name",
      render: (_, row) => (
        <div>
          <div className="font-semibold text-[var(--text)]">{row.name}</div>
          <div className="text-xs text-[var(--muted)]">{row.host || "local"}{row.port ? `:${row.port}` : ""} / {row.database || "default"}</div>
        </div>
      ),
    },
    { title: "类型", dataIndex: "type", width: 120, render: (value) => <Tag>{value}</Tag> },
    { title: "角色", dataIndex: "role", width: 130 },
    {
      title: "能力",
      dataIndex: "capabilities",
      render: (items: string[] = []) => <Space wrap>{items.map((item) => <Tag key={item} color="blue">{item}</Tag>)}</Space>,
    },
    {
      title: "密钥引用",
      key: "secret",
      ellipsis: true,
      render: (_, row) => row.secret_ref || row.url_env || <span className="text-xs text-amber-600">待配置</span>,
    },
    {
      title: "健康",
      key: "readiness",
      width: 100,
      render: (_, row) => {
        const item = readinessMap.get(row.name);
        const color = item?.status === "ready" ? "success" : item?.status === "watch" ? "warning" : "error";
        return <Tag color={color}>{item?.score ?? 0}</Tag>;
      },
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => onEdit(row)}>编辑</Button>
          <Button size="small" loading={testing} onClick={() => onTest(row.name)}>测试</Button>
          <Button size="small" href="#/data/sources/metadata">元数据</Button>
          <Popconfirm title="确认删除该数据源？" onConfirm={() => onDelete(row.name)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <WorkbenchPanel title="连接目录" actions={<Space><RefreshButton onClick={onRefresh} pending={refreshing} /><Button type="primary" onClick={onCreate}>新建数据源</Button></Space>}>
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
  return (
    <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <WorkbenchPanel title="选择数据源">
        <Space direction="vertical" className="w-full">
          <Select
            className="w-full"
            value={selectedName || undefined}
            placeholder="选择数据源"
            options={sources.map((item) => ({ value: item.name, label: `${item.name} · ${item.type}` }))}
            onChange={onSelect}
          />
          <Button className="w-full" type="primary" disabled={!selectedName} loading={previewing} onClick={() => onPreview(selectedName)}>预览元数据</Button>
          <Button className="w-full" disabled={!selectedName} loading={syncing} onClick={() => onSync(selectedName)}>同步到 Schema Registry</Button>
        </Space>
      </WorkbenchPanel>
      <WorkbenchPanel title="预览与同步结果">
        {!previewPayload ? (
          <EmptyHint />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="表" value={previewPayload.metadata?.tables ?? 0} />
              <Metric label="字段" value={previewPayload.metadata?.columns ?? 0} />
              <Metric label="敏感候选" value={previewPayload.metadata?.pii_candidates ?? 0} />
              <Metric label="只读" value={previewPayload.metadata?.readonly ? "是" : "否"} />
            </div>
            <Table
              rowKey="name"
              size="small"
              pagination={{ pageSize: 8 }}
              dataSource={previewPayload.tables ?? []}
              columns={[
                { title: "表名", dataIndex: "name", width: 220 },
                { title: "Schema", dataIndex: "schema_name", width: 120 },
                { title: "字段", render: (_, row: any) => (row.columns ?? []).map((col: any) => `${col.name}:${col.type}`).join(", ") },
              ]}
            />
            {syncPayload ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>已同步 {syncPayload.schema_registry?.total ?? 0} 张表</span>
                  <Button size="small" href="#/data/ingest/schema">查看 Schema Registry</Button>
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
  return (
    <Modal
      title={editingName ? "编辑数据源" : "新建数据源"}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={saving}
      width={820}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onSubmit} initialValues={DEFAULT_SOURCE}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Form.Item name="name" label="数据源名称" rules={[{ required: true, message: "请输入数据源名称" }]}>
            <Input disabled={Boolean(editingName)} placeholder="billing-ob" />
          </Form.Item>
          <Form.Item name="type" label="数据库类型" rules={[{ required: true }]}>
            <Select options={sourceTypes.map((item) => ({ value: item, label: item }))} />
          </Form.Item>
          <Form.Item name="role" label="数据源角色" rules={[{ required: true }]}>
            <Select options={roles.map((item) => ({ value: item, label: item }))} />
          </Form.Item>
          <Form.Item name="capabilities" label="能力声明" rules={[{ required: true }]}>
            <Select mode="multiple" options={capabilities.map((item) => ({ value: item, label: item }))} />
          </Form.Item>
          <Form.Item name="host" label="主机"><Input placeholder="db.example.internal" /></Form.Item>
          <Form.Item name="port" label="端口"><InputNumber className="w-full" min={0} max={65535} /></Form.Item>
          <Form.Item name="database" label="数据库"><Input placeholder="billing" /></Form.Item>
          <Form.Item name="schema_name" label="Schema"><Input placeholder="public / dwd" /></Form.Item>
          <Form.Item name="username" label="用户名"><Input placeholder="只保存用户名，不保存密码" /></Form.Item>
          <Form.Item name="pool_size" label="连接池大小"><InputNumber className="w-full" min={1} max={200} /></Form.Item>
          <Form.Item name="url_env" label="连接串环境变量"><Input placeholder="APP_DB_URL" /></Form.Item>
          <Form.Item name="secret_ref" label="SecretRef"><Input placeholder="env://APP_DB_URL 或 vault://secret/data/app-db" /></Form.Item>
          <Form.Item name="ssl_mode" label="SSL 模式"><Input placeholder="require / verify-full" /></Form.Item>
          <Form.Item name="readonly" label="安全策略" valuePropName="checked">
            <Switch checkedChildren="只读" unCheckedChildren="读写" />
          </Form.Item>
        </div>
        <Checkbox checked disabled>不保存明文密码或连接串</Checkbox>
      </Form>
    </Modal>
  );
}

function CompactKV({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-[var(--brand)]" />
        {title}
      </div>
      <div className="space-y-1">
        {Object.entries(value).length === 0 ? <p className="text-xs text-[var(--muted)]">暂无数据</p> : null}
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
  return (
    <div className="flex min-h-60 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-center">
      <FileSearch className="mb-3 h-8 w-8 text-[var(--muted)]" />
      <p className="text-sm font-medium">请选择数据源并预览元数据</p>
    </div>
  );
}
