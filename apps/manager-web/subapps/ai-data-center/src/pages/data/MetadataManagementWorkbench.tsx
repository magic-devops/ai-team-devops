import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Select, Space, Table, Tag as AntTag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Database, FileSearch, Network, RefreshCcw, ShieldCheck, Tags } from "lucide-react";
import { useMemo, useState } from "react";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { LoadingBlock, NeedLogin } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

type MetadataView = "overview" | "assets" | "fields" | "lineage";

type AssetRow = {
  id: string;
  name: string;
  type: string;
  domain: string;
  source: string;
  owner: string;
  status: string;
  security_level: string;
  tags?: string[];
  quality_score?: number;
  quality_decision?: string;
  lineage_count?: number;
  quality_rules?: string[];
};

type FieldRow = {
  id: string;
  asset_id: string;
  asset_name: string;
  name: string;
  type: string;
  source: string;
  sensitivity: string;
  classification: string;
  quality_flags?: string[];
};

type ClassifyForm = {
  owner?: string;
  security_level?: string;
  status?: string;
  tags?: string[];
  quality_rules?: string[];
  lineage_upstream?: string[];
  lineage_downstream?: string[];
  note?: string;
};

const VIEW_META: Record<MetadataView, { title: string; description: string }> = {
  overview: { title: "元数据管理", description: "资产、字段、分类和血缘影响的统一元数据控制面。" },
  assets: { title: "元数据资产目录", description: "维护资产负责人、状态、密级、标签和治理规则。" },
  fields: { title: "字段元数据", description: "按资产和敏感级别检索字段、类型、来源和分类候选。" },
  lineage: { title: "血缘影响分析", description: "按资产查看上下游影响范围和变更风险。" },
};

const SECURITY_LEVELS = ["public", "internal", "confidential", "restricted"];
const STATUSES = ["active", "planned", "deprecated", "paused"];
const QUALITY_RULES = ["required_owner", "lineage_declared", "pii_redaction", "freshness_24h", "status_valid", "quality_gate_trace"];

function splitList(value?: string[]) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function scoreColor(score?: number) {
  if ((score ?? 0) >= 90) return "green";
  if ((score ?? 0) >= 70) return "gold";
  return "red";
}

export function MetadataManagementWorkbench({
  focused = false,
  initialView = "overview",
}: {
  focused?: boolean;
  initialView?: MetadataView;
}) {
  const authed = Boolean(getToken());
  const { message } = App.useApp();
  const [aiOpen, setAiOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState("");
  const [assetQ, setAssetQ] = useState("");
  const [fieldAssetId, setFieldAssetId] = useState("");
  const [fieldQ, setFieldQ] = useState("");
  const [sensitiveOnly, setSensitiveOnly] = useState<string>("all");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetRow | null>(null);
  const [form] = Form.useForm<ClassifyForm>();

  const view = initialView;
  const summaryQ = useQuery({ queryKey: ["metadataSummary"], queryFn: api.metadataSummary, enabled: authed });
  const assetsQ = useQuery({
    queryKey: ["metadataAssets", domain, status, assetQ],
    queryFn: () => api.metadataAssets(domain, status, assetQ),
    enabled: authed,
  });
  const fieldsQ = useQuery({
    queryKey: ["metadataFields", fieldAssetId, fieldQ, sensitiveOnly],
    queryFn: () => api.metadataFields(fieldAssetId, fieldQ, sensitiveOnly === "all" ? undefined : sensitiveOnly === "sensitive"),
    enabled: authed && (view === "fields" || view === "overview"),
  });
  const lineageQ = useQuery({
    queryKey: ["metadataLineageImpact", selectedAssetId],
    queryFn: () => api.metadataLineageImpact(selectedAssetId),
    enabled: authed && view === "lineage" && Boolean(selectedAssetId),
  });

  const assets: AssetRow[] = assetsQ.data?.items ?? [];
  const fields: FieldRow[] = fieldsQ.data?.items ?? [];
  const summary = summaryQ.data?.summary ?? {};
  const domains = summaryQ.data?.domains ?? [];
  const defaultLineageAsset = selectedAssetId || assets[0]?.id || "";

  const refreshAll = () => {
    void summaryQ.refetch();
    void assetsQ.refetch();
    void fieldsQ.refetch();
    void lineageQ.refetch();
  };

  const openClassify = (asset: AssetRow) => {
    setEditingAsset(asset);
    form.setFieldsValue({
      owner: asset.owner,
      status: asset.status || "active",
      security_level: asset.security_level || "internal",
      tags: asList(asset.tags),
      quality_rules: asList(asset.quality_rules),
      lineage_upstream: [],
      lineage_downstream: [],
      note: "",
    });
    setClassifyOpen(true);
  };

  const classifyMut = useMutation({
    mutationFn: (values: ClassifyForm) => api.metadataClassifyAsset(editingAsset?.id || "", {
      ...values,
      tags: splitList(values.tags),
      quality_rules: splitList(values.quality_rules),
      lineage_upstream: splitList(values.lineage_upstream),
      lineage_downstream: splitList(values.lineage_downstream),
    }),
    onSuccess: () => {
      setClassifyOpen(false);
      setEditingAsset(null);
      refreshAll();
      message.success("元数据分类已更新");
    },
    onError: (err) => message.error((err as Error).message),
  });

  const domainOptions = useMemo(() => domains.map((item: any) => ({ label: `${item.name} (${item.count})`, value: item.name })), [domains]);
  const assetOptions = useMemo(() => assets.map((item) => ({ label: `${item.name} / ${item.source || item.id}`, value: item.id })), [assets]);

  if (!authed) return <NeedLogin />;
  if (summaryQ.isLoading || assetsQ.isLoading) return <LoadingBlock />;

  const shell = VIEW_META[view];

  return (
    <WorkbenchShell
      title={shell.title}
      description={focused ? shell.description : "企业元数据管理控制面。"}
      actions={
        <Space wrap>
          <AiAssistButton onClick={() => setAiOpen(true)} />
          <Button icon={<RefreshCcw className="h-4 w-4" />} onClick={refreshAll}>刷新</Button>
        </Space>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: "资产", value: summary.assets ?? 0 },
            { label: "字段", value: summary.fields ?? 0 },
            { label: "敏感字段", value: summary.sensitive_fields ?? 0 },
            { label: "元数据健康", value: summary.metadata_score ?? 0 },
          ]}
        />
      }
    >
      {view === "overview" ? <Overview summary={summary} domains={domains} /> : null}
      {view === "assets" ? (
        <AssetsPanel
          assets={assets}
          loading={assetsQ.isFetching}
          domain={domain}
          status={status}
          assetQ={assetQ}
          domainOptions={domainOptions}
          onDomain={setDomain}
          onStatus={setStatus}
          onSearch={setAssetQ}
          onClassify={openClassify}
        />
      ) : null}
      {view === "fields" ? (
        <FieldsPanel
          assets={assetOptions}
          fields={fields}
          loading={fieldsQ.isFetching}
          assetId={fieldAssetId}
          query={fieldQ}
          sensitive={sensitiveOnly}
          onAsset={setFieldAssetId}
          onQuery={setFieldQ}
          onSensitive={setSensitiveOnly}
        />
      ) : null}
      {view === "lineage" ? (
        <LineagePanel
          assetOptions={assetOptions}
          assetId={defaultLineageAsset}
          onAsset={(value) => setSelectedAssetId(value)}
          impact={lineageQ.data}
          loading={lineageQ.isFetching}
        />
      ) : null}

      <ClassifyModal
        open={classifyOpen}
        asset={editingAsset}
        form={form}
        saving={classifyMut.isPending}
        onCancel={() => setClassifyOpen(false)}
        onSubmit={(values) => classifyMut.mutate(values)}
      />
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="metadata-management" title="元数据管理 AI 助手" initialPrompt="请分析当前资产负责人、敏感字段、质量规则和血缘声明缺口，并生成可执行的元数据治理建议。" />
    </WorkbenchShell>
  );
}

function Overview({ summary, domains }: { summary: any; domains: Array<{ name: string; count: number }> }) {
  const modules = [
    { href: "#/data/metadata/assets", icon: Database, title: "资产目录", desc: "负责人、密级、标签与质量规则" },
    { href: "#/data/metadata/fields", icon: FileSearch, title: "字段元数据", desc: "字段类型、来源、敏感候选与分类" },
    { href: "#/data/metadata/lineage", icon: Network, title: "血缘影响", desc: "上下游影响和变更风险范围" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {modules.map((item) => {
          const Icon = item.icon;
          return (
            <a key={item.href} href={item.href} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)]">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]"><Icon className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--text)]">{item.title}</span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">{item.desc}</span>
                </span>
              </div>
            </a>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <WorkbenchPanel title="治理缺口">
          <div className="grid gap-3 sm:grid-cols-3">
            <RiskTile label="缺负责人资产" value={summary.missing_owner ?? 0} tone="red" />
            <RiskTile label="缺血缘资产" value={summary.missing_lineage ?? 0} tone="gold" />
            <RiskTile label="质量观察资产" value={summary.quality_watch ?? 0} tone="blue" />
          </div>
        </WorkbenchPanel>
        <WorkbenchPanel title="领域分布">
          <div className="space-y-2">
            {domains.length === 0 ? <p className="text-sm text-[var(--muted)]">暂无领域资产</p> : null}
            {domains.map((item) => (
              <div key={item.name} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                <span>{item.name}</span>
                <AntTag color="blue">{item.count}</AntTag>
              </div>
            ))}
          </div>
        </WorkbenchPanel>
      </div>
    </div>
  );
}

function RiskTile({ label, value, tone }: { label: string; value: number; tone: "red" | "gold" | "blue" }) {
  const toneClass = tone === "red" ? "text-red-600" : tone === "gold" ? "text-amber-600" : "text-blue-600";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function AssetsPanel({
  assets,
  loading,
  domain,
  status,
  assetQ,
  domainOptions,
  onDomain,
  onStatus,
  onSearch,
  onClassify,
}: {
  assets: AssetRow[];
  loading: boolean;
  domain: string;
  status: string;
  assetQ: string;
  domainOptions: Array<{ label: string; value: string }>;
  onDomain: (value: string) => void;
  onStatus: (value: string) => void;
  onSearch: (value: string) => void;
  onClassify: (asset: AssetRow) => void;
}) {
  const columns: ColumnsType<AssetRow> = [
    {
      title: "资产",
      dataIndex: "name",
      render: (_, row) => (
        <div className="min-w-[180px]">
          <p className="text-sm font-semibold">{row.name}</p>
          <p className="text-xs text-[var(--muted)]">{row.id}</p>
        </div>
      ),
    },
    { title: "领域", dataIndex: "domain", width: 110, render: (value) => <AntTag>{value}</AntTag> },
    { title: "来源", dataIndex: "source", width: 140 },
    { title: "负责人", dataIndex: "owner", width: 120, render: (value) => value || <span className="text-red-500">待补齐</span> },
    { title: "密级", dataIndex: "security_level", width: 120, render: (value) => <AntTag color={value === "restricted" || value === "confidential" ? "red" : "blue"}>{value}</AntTag> },
    { title: "质量", dataIndex: "quality_score", width: 100, render: (value) => <AntTag color={scoreColor(value)}>{value ?? 0}</AntTag> },
    { title: "血缘", dataIndex: "lineage_count", width: 90, render: (value) => value || <span className="text-amber-600">待声明</span> },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_, row) => <Button size="small" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => onClassify(row)}>分类治理</Button>,
    },
  ];
  return (
    <WorkbenchPanel title="资产目录">
      <div className="mb-4 grid gap-3 lg:grid-cols-[180px_180px_1fr]">
        <Select allowClear placeholder="领域" value={domain || undefined} options={domainOptions} onChange={(value) => onDomain(value || "")} />
        <Select allowClear placeholder="状态" value={status || undefined} options={STATUSES.map((value) => ({ label: value, value }))} onChange={(value) => onStatus(value || "")} />
        <Input.Search placeholder="搜索资产、来源、负责人或标签" value={assetQ} onChange={(event) => onSearch(event.target.value)} allowClear />
      </div>
      <Table rowKey="id" columns={columns} dataSource={assets} loading={loading} size="middle" scroll={{ x: 980 }} pagination={{ pageSize: 10 }} />
    </WorkbenchPanel>
  );
}

function FieldsPanel({
  assets,
  fields,
  loading,
  assetId,
  query,
  sensitive,
  onAsset,
  onQuery,
  onSensitive,
}: {
  assets: Array<{ label: string; value: string }>;
  fields: FieldRow[];
  loading: boolean;
  assetId: string;
  query: string;
  sensitive: string;
  onAsset: (value: string) => void;
  onQuery: (value: string) => void;
  onSensitive: (value: string) => void;
}) {
  const columns: ColumnsType<FieldRow> = [
    {
      title: "字段",
      dataIndex: "name",
      render: (_, row) => (
        <div className="min-w-[180px]">
          <p className="text-sm font-semibold">{row.name}</p>
          <p className="text-xs text-[var(--muted)]">{row.asset_name || row.asset_id}</p>
        </div>
      ),
    },
    { title: "类型", dataIndex: "type", width: 120 },
    { title: "来源", dataIndex: "source", width: 150 },
    { title: "敏感级别", dataIndex: "sensitivity", width: 120, render: (value) => <AntTag color={value === "sensitive" ? "red" : "green"}>{value}</AntTag> },
    { title: "分类", dataIndex: "classification", width: 150 },
    { title: "质量标记", dataIndex: "quality_flags", render: (value) => asList(value).map((flag) => <AntTag key={flag} color="gold">{flag}</AntTag>) },
  ];
  return (
    <WorkbenchPanel title="字段目录">
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(240px,360px)_180px_1fr]">
        <Select allowClear showSearch placeholder="选择资产" value={assetId || undefined} options={assets} onChange={(value) => onAsset(value || "")} optionFilterProp="label" />
        <Select value={sensitive} options={[{ label: "全部字段", value: "all" }, { label: "仅敏感字段", value: "sensitive" }, { label: "仅普通字段", value: "normal" }]} onChange={onSensitive} />
        <Input.Search placeholder="搜索字段、类型、来源" value={query} onChange={(event) => onQuery(event.target.value)} allowClear />
      </div>
      <Table rowKey="id" columns={columns} dataSource={fields} loading={loading} size="middle" scroll={{ x: 880 }} pagination={{ pageSize: 10 }} />
    </WorkbenchPanel>
  );
}

function LineagePanel({
  assetOptions,
  assetId,
  onAsset,
  impact,
  loading,
}: {
  assetOptions: Array<{ label: string; value: string }>;
  assetId: string;
  onAsset: (value: string) => void;
  impact: any;
  loading: boolean;
}) {
  const upstream = impact?.upstream ?? [];
  const downstream = impact?.downstream ?? [];
  return (
    <div className="space-y-4">
      <WorkbenchPanel title="资产选择">
        <Select className="w-full max-w-xl" showSearch placeholder="选择资产" value={assetId || undefined} options={assetOptions} onChange={onAsset} optionFilterProp="label" />
      </WorkbenchPanel>
      <div className="grid gap-4 lg:grid-cols-2">
        <LineageList title="上游依赖" rows={upstream} loading={loading} empty="暂无上游依赖" />
        <LineageList title="下游影响" rows={downstream} loading={loading} empty="暂无下游影响" />
      </div>
    </div>
  );
}

function LineageList({ title, rows, loading, empty }: { title: string; rows: any[]; loading: boolean; empty: string }) {
  return (
    <WorkbenchPanel title={title}>
      {loading ? <LoadingBlock /> : null}
      {!loading && rows.length === 0 ? <p className="py-8 text-center text-sm text-[var(--muted)]">{empty}</p> : null}
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id || row.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <p className="text-sm font-semibold">{row.label || row.id}</p>
            <p className="text-xs text-[var(--muted)]">{row.type || "node"} · {row.domain || "unknown"}</p>
          </div>
        ))}
      </div>
    </WorkbenchPanel>
  );
}

function ClassifyModal({
  open,
  asset,
  form,
  saving,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  asset: AssetRow | null;
  form: ReturnType<typeof Form.useForm<ClassifyForm>>[0];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: ClassifyForm) => void;
}) {
  return (
    <Modal title={asset ? `分类治理：${asset.name}` : "分类治理"} open={open} onCancel={onCancel} onOk={() => form.submit()} confirmLoading={saving} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item name="owner" label="负责人" rules={[{ required: true, message: "请输入负责人" }]}>
          <Input placeholder="DataOps" />
        </Form.Item>
        <div className="grid gap-3 sm:grid-cols-2">
          <Form.Item name="security_level" label="密级">
            <Select options={SECURITY_LEVELS.map((value) => ({ label: value, value }))} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={STATUSES.map((value) => ({ label: value, value }))} />
          </Form.Item>
        </div>
        <Form.Item name="tags" label="标签">
          <Select mode="tags" tokenSeparators={[","]} placeholder="输入后回车" suffixIcon={<Tags className="h-4 w-4" />} />
        </Form.Item>
        <Form.Item name="quality_rules" label="质量规则">
          <Select mode="multiple" options={QUALITY_RULES.map((value) => ({ label: value, value }))} />
        </Form.Item>
        <div className="grid gap-3 sm:grid-cols-2">
          <Form.Item name="lineage_upstream" label="上游节点">
            <Select mode="tags" tokenSeparators={[","]} placeholder="requirements" />
          </Form.Item>
          <Form.Item name="lineage_downstream" label="下游节点">
            <Select mode="tags" tokenSeparators={[","]} placeholder="analytics_reports" />
          </Form.Item>
        </div>
        <Form.Item name="note" label="治理备注">
          <Input.TextArea rows={3} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
