import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input, Modal, Select, Space, Table, Tag as AntTag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Database, FileSearch, Network, RefreshCcw, ShieldCheck, Tags } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { LoadingBlock, NeedLogin } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

type MetadataView = "overview" | "assets" | "fields" | "lineage";
const VIEW_KEYS: MetadataView[] = ["overview", "assets", "fields", "lineage"];

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

type GovernanceTaskRow = {
  title: string;
  description?: string;
  priority?: string;
  source?: string;
  source_report_id?: string;
  labels?: string[];
};

const VIEW_HREF: Record<MetadataView, string> = {
  overview: "#/data/metadata/overview",
  assets: "#/data/metadata/assets",
  fields: "#/data/metadata/fields",
  lineage: "#/data/metadata/lineage",
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

function normalizeView(view?: string): MetadataView {
  return view && VIEW_KEYS.includes(view as MetadataView) ? (view as MetadataView) : "overview";
}

export function MetadataManagementWorkbench({
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
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState("");
  const [assetQ, setAssetQ] = useState("");
  const [fieldAssetId, setFieldAssetId] = useState("");
  const [fieldQ, setFieldQ] = useState("");
  const [sensitiveOnly, setSensitiveOnly] = useState<string>("all");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [governancePayload, setGovernancePayload] = useState<any>(null);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetRow | null>(null);
  const [form] = Form.useForm<ClassifyForm>();

  const view = normalizeView(initialView);
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

  useEffect(() => {
    if (view === "lineage" && !selectedAssetId && assets[0]?.id) {
      setSelectedAssetId(assets[0].id);
    }
  }, [assets, selectedAssetId, view]);

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
      message.success(t("page.metadataManagement.updated"));
    },
    onError: (err) => message.error((err as Error).message),
  });

  const governanceTasksMut = useMutation({
    mutationFn: (dryRun: boolean) => api.metadataGovernanceTasks({ dry_run: dryRun, priority: "P1", assigned_to: "Metadata Agent", dev_tool: "codex" }),
    onSuccess: (payload) => {
      setGovernancePayload(payload);
      message.success(
        payload?.dry_run
          ? t("page.metadataManagement.tasks.previewReady", { count: payload?.planned ?? payload?.items?.length ?? 0 })
          : t("page.metadataManagement.tasks.created", { count: payload?.created_count ?? payload?.created?.length ?? 0 }),
      );
    },
    onError: (err) => message.error((err as Error).message),
  });

  const domainOptions = useMemo(() => domains.map((item: any) => ({ label: `${item.name} (${item.count})`, value: item.name })), [domains]);
  const assetOptions = useMemo(() => assets.map((item) => ({ label: `${item.name} / ${item.source || item.id}`, value: item.id })), [assets]);

  if (!authed) return <NeedLogin />;
  if (summaryQ.isLoading || assetsQ.isLoading) return <LoadingBlock />;

  const viewOptions = VIEW_KEYS.map((key) => ({
    value: key,
    label: t(`page.metadataManagement.modules.${key}.title`),
  }));

  return (
    <WorkbenchShell
      title={focused ? t(`page.metadataManagement.modules.${view}.title`) : t("page.metadataManagement.workbenchTitle")}
      description={focused ? t(`page.metadataManagement.modules.${view}.description`) : t("page.metadataManagement.workbenchDesc")}
      actions={
        <Space wrap>
          <AiAssistButton onClick={() => setAiOpen(true)} />
          <Button icon={<RefreshCcw className="h-4 w-4" />} onClick={refreshAll}>{t("common.refresh")}</Button>
        </Space>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.metadataManagement.metrics.assets"), value: summary.assets ?? 0 },
            { label: t("page.metadataManagement.metrics.fields"), value: summary.fields ?? 0 },
            { label: t("page.metadataManagement.metrics.sensitiveFields"), value: summary.sensitive_fields ?? 0 },
            { label: t("page.metadataManagement.metrics.metadataScore"), value: summary.metadata_score ?? 0 },
          ]}
        />
      }
    >
      {focused ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.metadataManagement.focusedTag")}</span>
              <a href="#/data/metadata" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.metadataManagement.backToHub")}</a>
              <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.metadataManagement.focusedHint")}</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-[var(--text)]">{t(`page.metadataManagement.modules.${view}.title`)}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{t(`page.metadataManagement.modules.${view}.focus`)}</p>
          </div>
          <Select
            className="min-w-52"
            value={view}
            options={viewOptions}
            onChange={(next) => { window.location.hash = VIEW_HREF[next as MetadataView].slice(1); }}
          />
        </div>
      ) : null}

      {view === "overview" ? (
        <Overview
          summary={summary}
          domains={domains}
          governancePayload={governancePayload}
          governanceLoading={governanceTasksMut.isPending}
          onPreviewGovernance={() => governanceTasksMut.mutate(true)}
          onCreateGovernance={() => governanceTasksMut.mutate(false)}
          t={t}
        />
      ) : null}
      {view === "assets" ? (
        <AssetsPanel
          t={t}
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
          onLineage={(assetId) => {
            setSelectedAssetId(assetId);
            window.location.hash = VIEW_HREF.lineage.slice(1);
          }}
          onReset={() => {
            setDomain("");
            setStatus("");
            setAssetQ("");
          }}
        />
      ) : null}
      {view === "fields" ? (
        <FieldsPanel
          t={t}
          assets={assetOptions}
          fields={fields}
          loading={fieldsQ.isFetching}
          assetId={fieldAssetId}
          query={fieldQ}
          sensitive={sensitiveOnly}
          onAsset={setFieldAssetId}
          onQuery={setFieldQ}
          onSensitive={setSensitiveOnly}
          onReset={() => {
            setFieldAssetId("");
            setFieldQ("");
            setSensitiveOnly("all");
          }}
        />
      ) : null}
      {view === "lineage" ? (
        <LineagePanel
          t={t}
          assetOptions={assetOptions}
          assetId={defaultLineageAsset}
          onAsset={(value) => setSelectedAssetId(value)}
          impact={lineageQ.data}
          loading={lineageQ.isFetching}
        />
      ) : null}

      <ClassifyModal
        t={t}
        open={classifyOpen}
        asset={editingAsset}
        form={form}
        saving={classifyMut.isPending}
        onCancel={() => setClassifyOpen(false)}
        onSubmit={(values) => classifyMut.mutate(values)}
      />
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="metadata-management" title={t("page.metadataManagement.aiTitle")} initialPrompt={t("page.metadataManagement.aiPrompt")} />
    </WorkbenchShell>
  );
}

function Overview({
  summary,
  domains,
  governancePayload,
  governanceLoading,
  onPreviewGovernance,
  onCreateGovernance,
  t,
}: {
  summary: any;
  domains: Array<{ name: string; count: number }>;
  governancePayload: any;
  governanceLoading: boolean;
  onPreviewGovernance: () => void;
  onCreateGovernance: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const modules = [
    { key: "assets", href: "#/data/metadata/assets", icon: Database },
    { key: "fields", href: "#/data/metadata/fields", icon: FileSearch },
    { key: "lineage", href: "#/data/metadata/lineage", icon: Network },
  ];
  const taskRows: GovernanceTaskRow[] = governancePayload?.items ?? [];
  const taskColumns: ColumnsType<GovernanceTaskRow> = [
    { title: t("page.metadataManagement.tasks.title"), dataIndex: "title", render: (value, row) => <div><p className="font-semibold">{value}</p><p className="text-xs text-[var(--muted)]">{row.source_report_id}</p></div> },
    { title: t("page.metadataManagement.tasks.priority"), dataIndex: "priority", width: 90, render: (value) => <AntTag color={value === "P0" ? "red" : value === "P1" ? "orange" : "blue"}>{value}</AntTag> },
    { title: t("page.metadataManagement.tasks.labels"), dataIndex: "labels", render: (items: string[] = []) => <Space wrap>{items.slice(0, 5).map((item) => <AntTag key={item}>{item}</AntTag>)}</Space> },
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
                  <span className="block text-sm font-semibold text-[var(--text)]">{t(`page.metadataManagement.modules.${item.key}.title`)}</span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">{t(`page.metadataManagement.modules.${item.key}.focus`)}</span>
                </span>
              </div>
            </a>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <WorkbenchPanel
          title={t("page.metadataManagement.panels.gaps")}
          actions={
            <Space wrap>
              <Button size="small" loading={governanceLoading} onClick={onPreviewGovernance}>{t("page.metadataManagement.tasks.preview")}</Button>
              <Button size="small" type="primary" loading={governanceLoading} onClick={onCreateGovernance}>{t("page.metadataManagement.tasks.create")}</Button>
            </Space>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <RiskTile label={t("page.metadataManagement.gaps.missingOwner")} value={summary.missing_owner ?? 0} tone="red" />
            <RiskTile label={t("page.metadataManagement.gaps.missingLineage")} value={summary.missing_lineage ?? 0} tone="gold" />
            <RiskTile label={t("page.metadataManagement.gaps.qualityWatch")} value={summary.quality_watch ?? 0} tone="blue" />
          </div>
          <div className="mt-4">
            {!governancePayload ? (
              <Alert type="info" showIcon message={t("page.metadataManagement.tasks.empty")} />
            ) : (
              <div className="space-y-3">
                <Alert
                  type={governancePayload.dry_run ? "warning" : "success"}
                  showIcon
                  message={
                    governancePayload.dry_run
                      ? t("page.metadataManagement.tasks.previewSummary", { count: governancePayload.planned ?? taskRows.length })
                      : t("page.metadataManagement.tasks.createdSummary", { count: governancePayload.created_count ?? governancePayload.created?.length ?? 0 })
                  }
                />
                <Table rowKey={(row) => `${row.source_report_id || row.title}:${row.priority || ""}`} size="small" columns={taskColumns} dataSource={taskRows} pagination={{ pageSize: 5 }} />
              </div>
            )}
          </div>
        </WorkbenchPanel>
        <WorkbenchPanel title={t("page.metadataManagement.panels.domainDistribution")}>
          <div className="space-y-2">
            {domains.length === 0 ? <p className="text-sm text-[var(--muted)]">{t("page.metadataManagement.emptyDomains")}</p> : null}
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
  t,
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
  onLineage,
  onReset,
}: {
  t: (key: string) => string;
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
  onLineage: (assetId: string) => void;
  onReset: () => void;
}) {
  const columns: ColumnsType<AssetRow> = [
    {
      title: t("page.metadataManagement.assets.asset"),
      dataIndex: "name",
      render: (_, row) => (
        <div className="min-w-[180px]">
          <p className="text-sm font-semibold">{row.name}</p>
          <p className="text-xs text-[var(--muted)]">{row.id}</p>
        </div>
      ),
    },
    { title: t("page.metadataManagement.assets.domain"), dataIndex: "domain", width: 110, render: (value) => <AntTag>{value}</AntTag> },
    { title: t("page.metadataManagement.assets.source"), dataIndex: "source", width: 140 },
    { title: t("page.metadataManagement.assets.owner"), dataIndex: "owner", width: 120, render: (value) => value || <span className="text-red-500">{t("page.metadataManagement.assets.missingOwner")}</span> },
    { title: t("page.metadataManagement.assets.securityLevel"), dataIndex: "security_level", width: 120, render: (value) => <AntTag color={value === "restricted" || value === "confidential" ? "red" : "blue"}>{value}</AntTag> },
    { title: t("page.metadataManagement.assets.quality"), dataIndex: "quality_score", width: 100, render: (value) => <AntTag color={scoreColor(value)}>{value ?? 0}</AntTag> },
    { title: t("page.metadataManagement.assets.lineage"), dataIndex: "lineage_count", width: 90, render: (value) => value || <span className="text-amber-600">{t("page.metadataManagement.assets.missingLineage")}</span> },
    {
      title: t("page.metadataManagement.assets.actions"),
      key: "actions",
      width: 220,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => onClassify(row)}>{t("page.metadataManagement.assets.classify")}</Button>
          <Button size="small" icon={<Network className="h-4 w-4" />} onClick={() => onLineage(row.id)}>{t("page.metadataManagement.assets.lineageAction")}</Button>
        </Space>
      ),
    },
  ];
  return (
    <WorkbenchPanel title={t("page.metadataManagement.modules.assets.title")} actions={<Button size="small" onClick={onReset}>{t("page.metadataManagement.filters.reset")}</Button>}>
      <div className="mb-4 grid gap-3 lg:grid-cols-[180px_180px_1fr]">
        <Select allowClear placeholder={t("page.metadataManagement.assets.domain")} value={domain || undefined} options={domainOptions} onChange={(value) => onDomain(value || "")} />
        <Select allowClear placeholder={t("page.metadataManagement.assets.status")} value={status || undefined} options={STATUSES.map((value) => ({ label: value, value }))} onChange={(value) => onStatus(value || "")} />
        <Input.Search placeholder={t("page.metadataManagement.assets.searchPlaceholder")} value={assetQ} onChange={(event) => onSearch(event.target.value)} allowClear />
      </div>
      <Table rowKey="id" columns={columns} dataSource={assets} loading={loading} size="middle" scroll={{ x: 980 }} pagination={{ pageSize: 10 }} />
    </WorkbenchPanel>
  );
}

function FieldsPanel({
  t,
  assets,
  fields,
  loading,
  assetId,
  query,
  sensitive,
  onAsset,
  onQuery,
  onSensitive,
  onReset,
}: {
  t: (key: string) => string;
  assets: Array<{ label: string; value: string }>;
  fields: FieldRow[];
  loading: boolean;
  assetId: string;
  query: string;
  sensitive: string;
  onAsset: (value: string) => void;
  onQuery: (value: string) => void;
  onSensitive: (value: string) => void;
  onReset: () => void;
}) {
  const columns: ColumnsType<FieldRow> = [
    {
      title: t("page.metadataManagement.fields.field"),
      dataIndex: "name",
      render: (_, row) => (
        <div className="min-w-[180px]">
          <p className="text-sm font-semibold">{row.name}</p>
          <p className="text-xs text-[var(--muted)]">{row.asset_name || row.asset_id}</p>
        </div>
      ),
    },
    { title: t("page.metadataManagement.fields.type"), dataIndex: "type", width: 120 },
    { title: t("page.metadataManagement.fields.source"), dataIndex: "source", width: 150 },
    { title: t("page.metadataManagement.fields.sensitivity"), dataIndex: "sensitivity", width: 120, render: (value) => <AntTag color={value === "sensitive" ? "red" : "green"}>{value}</AntTag> },
    { title: t("page.metadataManagement.fields.classification"), dataIndex: "classification", width: 150 },
    { title: t("page.metadataManagement.fields.qualityFlags"), dataIndex: "quality_flags", render: (value) => asList(value).map((flag) => <AntTag key={flag} color="gold">{flag}</AntTag>) },
  ];
  return (
    <WorkbenchPanel title={t("page.metadataManagement.modules.fields.title")} actions={<Button size="small" onClick={onReset}>{t("page.metadataManagement.filters.reset")}</Button>}>
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(240px,360px)_180px_1fr]">
        <Select allowClear showSearch placeholder={t("page.metadataManagement.fields.selectAsset")} value={assetId || undefined} options={assets} onChange={(value) => onAsset(value || "")} optionFilterProp="label" />
        <Select value={sensitive} options={[{ label: t("page.metadataManagement.fields.allFields"), value: "all" }, { label: t("page.metadataManagement.fields.sensitiveOnly"), value: "sensitive" }, { label: t("page.metadataManagement.fields.normalOnly"), value: "normal" }]} onChange={onSensitive} />
        <Input.Search placeholder={t("page.metadataManagement.fields.searchPlaceholder")} value={query} onChange={(event) => onQuery(event.target.value)} allowClear />
      </div>
      <Table rowKey="id" columns={columns} dataSource={fields} loading={loading} size="middle" scroll={{ x: 880 }} pagination={{ pageSize: 10 }} />
    </WorkbenchPanel>
  );
}

function LineagePanel({
  t,
  assetOptions,
  assetId,
  onAsset,
  impact,
  loading,
}: {
  t: (key: string) => string;
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
      <WorkbenchPanel title={t("page.metadataManagement.lineage.assetSelect")}>
        <Select className="w-full max-w-xl" showSearch placeholder={t("page.metadataManagement.fields.selectAsset")} value={assetId || undefined} options={assetOptions} onChange={onAsset} optionFilterProp="label" />
      </WorkbenchPanel>
      <div className="grid gap-4 lg:grid-cols-2">
        <LineageList title={t("page.metadataManagement.lineage.upstream")} rows={upstream} loading={loading} empty={t("page.metadataManagement.lineage.emptyUpstream")} />
        <LineageList title={t("page.metadataManagement.lineage.downstream")} rows={downstream} loading={loading} empty={t("page.metadataManagement.lineage.emptyDownstream")} />
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
  t,
  open,
  asset,
  form,
  saving,
  onCancel,
  onSubmit,
}: {
  t: (key: string, options?: Record<string, unknown>) => string;
  open: boolean;
  asset: AssetRow | null;
  form: ReturnType<typeof Form.useForm<ClassifyForm>>[0];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: ClassifyForm) => void;
}) {
  return (
    <Modal title={asset ? t("page.metadataManagement.classify.titleWithAsset", { name: asset.name }) : t("page.metadataManagement.classify.title")} open={open} onCancel={onCancel} onOk={() => form.submit()} confirmLoading={saving} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item name="owner" label={t("page.metadataManagement.assets.owner")} rules={[{ required: true, message: t("page.metadataManagement.classify.ownerRequired") }]}>
          <Input placeholder={t("page.metadataManagement.classify.ownerPlaceholder")} />
        </Form.Item>
        <div className="grid gap-3 sm:grid-cols-2">
          <Form.Item name="security_level" label={t("page.metadataManagement.assets.securityLevel")}>
            <Select options={SECURITY_LEVELS.map((value) => ({ label: value, value }))} />
          </Form.Item>
          <Form.Item name="status" label={t("page.metadataManagement.assets.status")}>
            <Select options={STATUSES.map((value) => ({ label: value, value }))} />
          </Form.Item>
        </div>
        <Form.Item name="tags" label={t("page.metadataManagement.classify.tags")}>
          <Select mode="tags" tokenSeparators={[","]} placeholder={t("page.metadataManagement.classify.tagsPlaceholder")} suffixIcon={<Tags className="h-4 w-4" />} />
        </Form.Item>
        <Form.Item name="quality_rules" label={t("page.metadataManagement.classify.qualityRules")}>
          <Select mode="multiple" options={QUALITY_RULES.map((value) => ({ label: value, value }))} />
        </Form.Item>
        <div className="grid gap-3 sm:grid-cols-2">
          <Form.Item name="lineage_upstream" label={t("page.metadataManagement.lineage.upstream")}>
            <Select mode="tags" tokenSeparators={[","]} placeholder={t("page.metadataManagement.classify.upstreamPlaceholder")} />
          </Form.Item>
          <Form.Item name="lineage_downstream" label={t("page.metadataManagement.lineage.downstream")}>
            <Select mode="tags" tokenSeparators={[","]} placeholder={t("page.metadataManagement.classify.downstreamPlaceholder")} />
          </Form.Item>
        </div>
        <Form.Item name="note" label={t("page.metadataManagement.classify.note")}>
          <Input.TextArea rows={3} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
