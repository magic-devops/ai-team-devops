import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { Activity, Database, Download, Edit3, KeyRound, Play, Plus, RefreshCw, ShieldCheck, Square, Workflow } from "lucide-react";
import {
  DEFAULT_HERMES_BASE_URL,
  HermesUnavailableError,
  createHermesClient,
  type HermesApiResponse,
  type HermesEntity,
  type HermesResource,
  type HermesRunData,
  type HermesRunNode,
} from "../lib/hermes";

const RESOURCE_TABS: HermesResource[] = ["sessions", "runs", "tasks", "requirements", "assets"];

const RESOURCE_STATUSES: Record<HermesResource, readonly string[]> = {
  sessions: ["active", "paused", "completed", "archived"],
  runs: ["planned", "queued", "running", "interrupted", "retrying", "completed", "failed", "cancelled"],
  tasks: ["active", "in_progress", "blocked", "completed", "archived"],
  requirements: ["active", "draft", "ready", "completed", "archived"],
  assets: ["active", "archived"],
};

const MUTABLE_RESOURCES = new Set<HermesResource>(["sessions", "tasks", "requirements", "assets", "runs"]);
const EDITABLE_RESOURCES = new Set<HermesResource>(["sessions", "tasks", "requirements", "assets"]);

type ConnectionForm = {
  baseUrl: string;
  token: string;
  workspaceId?: string;
};

type QueryState = {
  q: string;
  status?: string;
  limit: number;
};

type DrawerMode = "create" | "edit";

type BusinessFormValues = {
  title?: string;
  name?: string;
  status?: string;
  kind?: string;
  description?: string;
  content?: string;
  session_id?: string;
  nodesJson?: string;
};

function entityTitle(entity: HermesEntity) {
  return String(entity.data?.title || entity.data?.name || entity.id);
}

function shortJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readableTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function responseSummary(response?: HermesApiResponse) {
  if (!response) return "";
  const trace = response.trace_id ? `trace_id=${response.trace_id}` : "";
  const count = `items=${response.items.length}`;
  return [count, trace].filter(Boolean).join(" · ");
}

function useHermes(connection: ConnectionForm) {
  return useMemo(
    () =>
      createHermesClient({
        baseUrl: connection.baseUrl || DEFAULT_HERMES_BASE_URL,
        token: connection.token,
        workspaceId: connection.workspaceId,
      }),
    [connection.baseUrl, connection.token, connection.workspaceId],
  );
}

function ErrorAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const err = error instanceof HermesUnavailableError ? error : new HermesUnavailableError(error instanceof Error ? error.message : String(error));
  return (
    <Alert
      className="mb-4"
      type={err.status === 401 || err.status === 403 ? "warning" : "error"}
      showIcon
      title={err.status === 401 || err.status === 403 ? t("workspace.authError") : t("workspace.offlineError")}
      description={[err.message, err.traceId ? `trace_id=${err.traceId}` : ""].filter(Boolean).join(" · ")}
    />
  );
}

function statusLabel(t: (key: string, options?: Record<string, unknown>) => string, status?: string) {
  if (!status) return "-";
  return t(`workspace.statuses.${status}`, { defaultValue: status });
}

function StatusTag({ status }: { status?: string }) {
  const { t } = useTranslation();
  const color = status === "failed" || status === "blocked" ? "red" : status === "completed" ? "green" : status === "archived" ? "default" : "blue";
  return <Tag color={color}>{statusLabel(t, status)}</Tag>;
}

function EntityTable({
  rows,
  loading,
  onSelect,
  resource,
}: {
  rows: HermesEntity[];
  loading?: boolean;
  onSelect: (row: HermesEntity) => void;
  resource: HermesResource;
}) {
  const { t } = useTranslation();
  const columns: ColumnsType<HermesEntity> = [
    {
      title: t("workspace.columns.title"),
      dataIndex: "id",
      ellipsis: true,
      render: (_, row) => (
        <button type="button" className="max-w-full truncate text-left font-semibold text-[var(--brand)] hover:underline" onClick={() => onSelect(row)}>
          {entityTitle(row)}
        </button>
      ),
    },
    { title: t("workspace.columns.status"), dataIndex: "status", width: 130, render: (status) => <StatusTag status={String(status || "")} /> },
    ...(resource === "assets"
      ? [{ title: t("workspace.columns.kind"), width: 130, ellipsis: true, render: (_: unknown, row: HermesEntity) => String(row.data?.kind || "-") }]
      : []),
    { title: t("workspace.columns.resourceVersion"), dataIndex: "version", width: 110, render: (version) => `v${version}` },
    { title: t("workspace.columns.updated"), dataIndex: "updated_at", width: 180, render: (value) => readableTime(String(value || "")) },
  ];
  return (
    <Table
      rowKey="id"
      size="small"
      loading={loading}
      columns={columns}
      dataSource={rows}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      scroll={{ x: 760 }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("workspace.emptyResource")} /> }}
    />
  );
}

function collectRunOutput(selected?: HermesEntity) {
  const data = selected?.data ?? {};
  const chunks: string[] = [];
  const nodeResults = data.node_results && typeof data.node_results === "object" ? data.node_results as Record<string, Record<string, unknown>> : {};
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const exitCode = result.exit_code ?? result.expected_exit_code;
    const outcome = typeof result.decision === "string" ? `approval=${result.decision}` : `exit=${exitCode ?? "-"}`;
    chunks.push([`[${nodeId}] ${outcome}`, stdout ? `stdout:\n${stdout}` : "", stderr ? `stderr:\n${stderr}` : ""].filter(Boolean).join("\n"));
  }
  for (const key of ["stdout", "stderr", "output", "logs"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) chunks.push(`${key}:\n${value}`);
    else if (value !== undefined && value !== null) chunks.push(`${key}:\n${shortJson(value)}`);
  }
  return chunks.join("\n\n");
}

function OutputPanel({ selected }: { selected?: HermesEntity }) {
  const { t } = useTranslation();
  const output = collectRunOutput(selected);
  return (
    <pre className="max-h-60 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--text)]">
      {output || t("workspace.noRecordedOutput")}
    </pre>
  );
}

function buildInitialValues(resource: HermesResource, selected?: HermesEntity): BusinessFormValues {
  if (!selected) {
    if (resource === "runs") {
      return {
        title: "Quality evidence run",
        session_id: "",
        nodesJson: JSON.stringify(
          [{ id: "typecheck", title: "Typecheck", kind: "command", argv: ["pnpm", "typecheck"], expected_exit_code: 0, timeout_seconds: 60 }],
          null,
          2,
        ),
      };
    }
    return { status: RESOURCE_STATUSES[resource][0], kind: resource === "assets" ? "knowledge" : resource.slice(0, -1) };
  }
  const data = selected.data;
  return {
    title: typeof data.title === "string" ? data.title : "",
    name: typeof data.name === "string" ? data.name : "",
    status: selected.status,
    kind: typeof data.kind === "string" ? data.kind : "",
    description: typeof data.description === "string" ? data.description : "",
    content: typeof data.content === "string" ? data.content : "",
  };
}

function boundedTextRule(t: (key: string) => string) {
  return [
    { required: true, whitespace: true, message: t("workspace.validation.titleRequired") },
    { max: 120, message: t("workspace.validation.titleMax") },
  ];
}

function scopeSignature(connection: ConnectionForm, resource: string, generation: number, tokenGeneration: number) {
  return [connection.baseUrl, connection.workspaceId || "", resource, generation, tokenGeneration].join("\u001f");
}

function buildBusinessData(resource: HermesResource, values: BusinessFormValues, mode: DrawerMode) {
  const status = values.status;
  if (resource === "runs") {
    const nodes = JSON.parse(values.nodesJson || "[]") as HermesRunNode[];
    const data: HermesRunData = { title: String(values.title || "").trim(), nodes };
    if (values.session_id?.trim()) data.session_id = values.session_id.trim();
    return data;
  }
  const title = String(values.title || "").trim();
  const name = String(values.name || "").trim();
  const data: Record<string, unknown> = resource === "sessions" ? { name: name || title } : { title };
  if (resource === "assets" && (mode === "edit" || values.kind?.trim())) data.kind = String(values.kind || "").trim();
  if (mode === "edit" || values.description?.trim()) data.description = String(values.description || "").trim();
  if (resource === "assets" && (mode === "edit" || values.content?.trim())) data.content = String(values.content || "").trim();
  if (status) data.status = status;
  return data;
}

export function Workspace() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionForm>({ baseUrl: DEFAULT_HERMES_BASE_URL, token: "", workspaceId: "" });
  const [tokenGeneration, setTokenGeneration] = useState(0);
  const [contextGeneration, setContextGeneration] = useState(0);
  const [query, setQuery] = useState<QueryState>({ q: "", limit: 20 });
  const [activeResource, setActiveResource] = useState<HermesResource>("runs");
  const [selected, setSelected] = useState<HermesEntity | undefined>();
  const [actionResult, setActionResult] = useState<{ title: string; response: HermesApiResponse<unknown>; diagnostics?: boolean } | undefined>();
  const [businessDrawer, setBusinessDrawer] = useState<{ mode: DrawerMode; resource: HermesResource; entity?: HermesEntity } | undefined>();
  const [workspaceDrawer, setWorkspaceDrawer] = useState(false);
  const [businessForm] = Form.useForm<BusinessFormValues>();
  const [workspaceForm] = Form.useForm<{ name: string; root: string }>();
  const client = useHermes(connection);
  const connected = Boolean(connection.baseUrl && connection.token);
  const workspaceReady = connected && Boolean(connection.workspaceId);
  const canCreateResource = MUTABLE_RESOURCES.has(activeResource);
  const canEditResource = EDITABLE_RESOURCES.has(activeResource);
  const currentScopeSignature = scopeSignature(connection, activeResource, contextGeneration, tokenGeneration);

  useEffect(() => {
    setSelected(undefined);
    setActionResult(undefined);
    setBusinessDrawer(undefined);
    setWorkspaceDrawer(false);
  }, [connection.baseUrl, connection.workspaceId, tokenGeneration, activeResource]);

  useEffect(() => {
    if (businessDrawer) businessForm.setFieldsValue(buildInitialValues(businessDrawer.resource, businessDrawer.entity));
  }, [businessDrawer, businessForm]);

  const listQuery = useQuery({
    queryKey: ["hermes", connection.baseUrl, tokenGeneration, connection.workspaceId, activeResource, query],
    queryFn: () => client.list(activeResource, query),
    enabled: workspaceReady,
    refetchInterval: workspaceReady && activeResource === "runs" ? 3000 : false,
    retry: false,
  });

  const workspacesQuery = useQuery({
    queryKey: ["hermes-workspaces", connection.baseUrl, tokenGeneration],
    queryFn: () => client.workspaces({ limit: 50 }),
    enabled: connected,
    retry: false,
  });

  const approvalsQuery = useQuery({
    queryKey: ["hermes-approvals", connection.baseUrl, tokenGeneration, connection.workspaceId],
    queryFn: () => client.approvals({ limit: 20 }),
    enabled: workspaceReady,
    refetchInterval: workspaceReady ? 5000 : false,
    retry: false,
  });

  const readinessQuery = useQuery({
    queryKey: ["hermes-readiness", connection.baseUrl, tokenGeneration],
    queryFn: () => client.readiness(),
    enabled: connected,
    retry: false,
  });

  const selectedQuery = useQuery({
    queryKey: ["hermes-detail", connection.baseUrl, tokenGeneration, connection.workspaceId, activeResource, selected?.id],
    queryFn: () => client.get(activeResource, selected?.id || ""),
    enabled: workspaceReady && Boolean(selected?.id),
    refetchInterval: workspaceReady && activeResource === "runs" && selected && !["completed", "failed", "cancelled"].includes(selected.status) ? 2000 : false,
    retry: false,
  });

  useEffect(() => {
    const next = selectedQuery.data?.items[0];
    if (next) setSelected(next);
  }, [selectedQuery.data]);

  const eventsQuery = useQuery({
    queryKey: ["hermes-run-events", connection.baseUrl, tokenGeneration, connection.workspaceId, selected?.id],
    queryFn: () => client.runEvents(selected?.id || "", 0),
    enabled: workspaceReady && activeResource === "runs" && Boolean(selected?.id),
    refetchInterval: workspaceReady && activeResource === "runs" && selected && !["completed", "failed", "cancelled"].includes(selected.status) ? 2000 : false,
    retry: false,
  });

  const createWorkspace = useMutation({
    mutationFn: async (values: { name: string; root: string }) => {
      const requestScope = scopeSignature(connection, "workspaces", contextGeneration, tokenGeneration);
      const response = await client.createWorkspace({ data: values, idempotency_key: idempotencyKey("workspace") });
      return { response, requestScope, resource: "workspaces" };
    },
    onSuccess: ({ response, requestScope, resource }) => {
      const isCurrentRequest = requestScope === scopeSignature(connection, resource, contextGeneration, tokenGeneration);
      if (isCurrentRequest) {
        const workspace = response.items[0];
        if (workspace?.id) setConnection((prev) => ({ ...prev, workspaceId: workspace.id }));
        setWorkspaceDrawer(false);
        workspaceForm.resetFields();
        message.success(t("workspace.created"));
      }
      queryClient.invalidateQueries({ queryKey: ["hermes-workspaces"] });
    },
  });

  const saveBusinessEntity = useMutation({
    mutationFn: async (values: BusinessFormValues) => {
      if (!businessDrawer) throw new Error("No drawer state");
      const requestScope = scopeSignature(connection, businessDrawer.resource, contextGeneration, tokenGeneration);
      const requestResource = businessDrawer.resource;
      const requestEntityId = businessDrawer.entity?.id;
      const data = buildBusinessData(businessDrawer.resource, values, businessDrawer.mode);
      if (businessDrawer.mode === "edit") {
        if (!businessDrawer.entity) throw new Error("No selected entity");
        const response = await client.patch(businessDrawer.resource, businessDrawer.entity.id, {
          data,
          expected_version: businessDrawer.entity.version,
          idempotency_key: idempotencyKey(`${businessDrawer.resource}-edit`),
        });
        return { response, requestScope, requestResource, requestEntityId };
      }
      const response = await client.create(businessDrawer.resource, { data, idempotency_key: idempotencyKey(businessDrawer.resource) });
      return { response, requestScope, requestResource, requestEntityId };
    },
    onSuccess: ({ response, requestScope, requestResource, requestEntityId }) => {
      const isCurrentRequest = requestScope === currentScopeSignature && requestResource === activeResource && (!requestEntityId || requestEntityId === selected?.id);
      if (isCurrentRequest) {
        const entity = response.items[0];
        if (entity) setSelected(entity);
        setBusinessDrawer(undefined);
        businessForm.resetFields();
        message.success(t("workspace.saved"));
      }
      queryClient.invalidateQueries({ queryKey: ["hermes"] });
    },
  });

  const runtimeDiagnostics = useMutation({
    mutationFn: async () => ({ response: await client.diagnostics(), requestScope: currentScopeSignature }),
    onSuccess: ({ response, requestScope }) => {
      if (requestScope !== currentScopeSignature) return;
      setActionResult({ title: t("workspace.diagnostics.title"), response, diagnostics: true });
    },
  });

  const runAction = useMutation({
    mutationFn: async (action: "start" | "cancel" | "retry" | "replay" | "export") => {
      if (!selected) throw new Error("No run selected");
      const requestScope = scopeSignature(connection, "runs", contextGeneration, tokenGeneration);
      const requestEntityId = selected.id;
      const response = await client.runAction(selected.id, action, {
        idempotency_key: idempotencyKey(action),
        expected_version: selected.version,
        dry_run: action === "replay",
      });
      return { response, action, requestScope, requestResource: "runs", requestEntityId };
    },
    onSuccess: ({ response, action, requestScope, requestResource, requestEntityId }) => {
      const isCurrentRequest = requestScope === currentScopeSignature && requestResource === activeResource && requestEntityId === selected?.id;
      if (!isCurrentRequest) return;
      if (action === "replay" || action === "export") {
        setActionResult({ title: t(`workspace.actions.${action === "replay" ? "replayDryRun" : "exportJson"}`), response });
      }
      if (action === "export") {
        const blob = new Blob([JSON.stringify(response, null, 2)], { type: "application/json" });
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = `hermes-run-export-${selected?.id || "run"}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(href);
      }
      queryClient.invalidateQueries({ queryKey: ["hermes"] });
      queryClient.invalidateQueries({ queryKey: ["hermes-run-events"] });
      message.success(t("workspace.actionSent"));
    },
  });

  const approvalDecision = useMutation({
    mutationFn: async ({ row, decision }: { row: HermesEntity; decision: "approve" | "reject" }) => {
      const requestScope = scopeSignature(connection, "runs", contextGeneration, tokenGeneration);
      const response = await client.approvalDecision(row.id, {
        decision,
        idempotency_key: idempotencyKey(`approval-${decision}`),
        expected_version: row.version,
      });
      return { response, requestScope, requestResource: "runs", requestEntityId: row.id };
    },
    onSuccess: ({ requestScope, requestResource, requestEntityId }) => {
      const hasCurrentApproval = approvalRows.some((row) => row.id === requestEntityId);
      if (requestScope !== currentScopeSignature || requestResource !== activeResource || !hasCurrentApproval) return;
      queryClient.invalidateQueries({ queryKey: ["hermes-approvals"] });
      message.success(t("workspace.actionSent"));
    },
  });

  const rows = listQuery.data?.items || [];
  const workspaceRows = workspacesQuery.data?.items || [];
  const approvalRows = approvalsQuery.data?.items || [];
  const permissions = new Set(
    [
      ...(readinessQuery.data?.permissions || []),
      ...(workspacesQuery.data?.permissions || []),
      ...(listQuery.data?.permissions || []),
      ...(approvalsQuery.data?.permissions || []),
    ].map(String),
  );
  const canConfig = permissions.has("config");
  const canWrite = permissions.has("write");
  const canExecute = permissions.has("execute");
  const canApprove = permissions.has("approve");
  const canExport = permissions.has("export");
  const runStatus = selected?.status || "";
  const canStartRun = canExecute && runStatus === "planned";
  const canCancelRun = canExecute && ["planned", "queued", "running", "interrupted", "retrying"].includes(runStatus);
  const canRetryRun = canExecute && runStatus === "failed";
  const statusOptions = RESOURCE_STATUSES[activeResource].map((status) => ({ value: status, label: statusLabel(t, status) }));
  const connectionNotice = !connected ? t("workspace.connectHint") : connected && !connection.workspaceId ? t("workspace.workspaceRequired") : "";

  return (
    <section className="space-y-4">
      <Card size="small">
        <Row gutter={[12, 12]} align="bottom">
          <Col xs={24} lg={7}>
            <Typography.Title level={3} className="!mb-1">
              {t("workspace.title")}
            </Typography.Title>
          </Col>
          <Col xs={24} sm={12} lg={5}>
            <Input
              aria-label={t("workspace.baseUrl")}
              prefix={<Database className="h-4 w-4" />}
              value={connection.baseUrl}
              onChange={(event) => {
                setContextGeneration((value) => value + 1);
                setSelected(undefined);
                setActionResult(undefined);
                setWorkspaceDrawer(false);
                setConnection((prev) => ({ ...prev, baseUrl: event.target.value, workspaceId: "" }));
              }}
              placeholder={DEFAULT_HERMES_BASE_URL}
            />
          </Col>
          <Col xs={24} sm={12} lg={5}>
            <Input.Password
              aria-label={t("workspace.token")}
              prefix={<KeyRound className="h-4 w-4" />}
              value={connection.token}
              onChange={(event) => {
                setContextGeneration((value) => value + 1);
                setTokenGeneration((value) => value + 1);
                setSelected(undefined);
                setActionResult(undefined);
                setWorkspaceDrawer(false);
                setConnection((prev) => ({ ...prev, token: event.target.value, workspaceId: "" }));
              }}
              placeholder={t("workspace.tokenPlaceholder")}
            />
          </Col>
          <Col xs={24} sm={16} lg={5}>
            <div className="flex gap-2">
              <Select
                className="min-w-0 flex-1"
                allowClear
                showSearch
                loading={workspacesQuery.isFetching}
                value={connection.workspaceId || undefined}
                placeholder={t("workspace.workspace")}
                onChange={(value) => {
                  setContextGeneration((generation) => generation + 1);
                  setSelected(undefined);
                  setActionResult(undefined);
                  setBusinessDrawer(undefined);
                  setWorkspaceDrawer(false);
                  setConnection((prev) => ({ ...prev, workspaceId: value }));
                }}
                options={workspaceRows.map((item) => ({ value: item.id, label: `${entityTitle(item)} · ${item.id}` }))}
              />
              <Button
                aria-label={t("workspace.createWorkspace")}
                icon={<Plus className="h-4 w-4" />}
                disabled={!connected || !canConfig}
                onClick={() => setWorkspaceDrawer(true)}
              />
            </div>
          </Col>
          <Col xs={24} sm={8} lg={2}>
            <Button block icon={<RefreshCw className="h-4 w-4" />} onClick={() => queryClient.invalidateQueries({ queryKey: ["hermes"] })}>
              {t("common.refresh")}
            </Button>
          </Col>
        </Row>
      </Card>

      <ErrorAlert error={listQuery.error || workspacesQuery.error || readinessQuery.error || approvalsQuery.error || createWorkspace.error || saveBusinessEntity.error || runAction.error || approvalDecision.error || runtimeDiagnostics.error} />

      <div className="grid gap-3 border-b py-3 sm:grid-cols-3">
        <div className="min-w-0">
          <Typography.Text type="secondary">{t("workspace.summary.scope")}</Typography.Text>
          <div className="mt-1 flex min-w-0 items-center gap-1">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <Typography.Text ellipsis={{ tooltip: connection.workspaceId }}>
              {String(workspaceRows.find((item) => item.id === connection.workspaceId)?.data.name || t("workspace.noWorkspace"))}
            </Typography.Text>
          </div>
        </div>
        <Statistic styles={{ content: { fontSize: 16 } }} title={t("workspace.summary.items")} value={rows.length} prefix={<Workflow className="h-4 w-4" />} />
        <div className="flex items-center justify-between gap-2">
          <Statistic styles={{ content: { fontSize: 16 } }} title={t("workspace.summary.readiness")} value={readinessQuery.data ? readinessQuery.data.ok ? t("workspace.ready") : t("workspace.diagnostics.degraded") : t("workspace.unknown")} prefix={<Activity className="h-4 w-4" />} />
          <Tooltip title={t("workspace.diagnostics.title")}>
            <Button aria-label={t("workspace.diagnostics.title")} icon={<Activity className="h-4 w-4" />} disabled={!connected || !permissions.has("read")} loading={runtimeDiagnostics.isPending} onClick={() => runtimeDiagnostics.mutate()} />
          </Tooltip>
        </div>
      </div>

      <Tabs
        activeKey={activeResource}
        onChange={(key) => {
          const resource = key as HermesResource;
          setContextGeneration((generation) => generation + 1);
          setActiveResource(resource);
          setSelected(undefined);
          setActionResult(undefined);
          setBusinessDrawer(undefined);
          setWorkspaceDrawer(false);
          setQuery((prev) => ({ ...prev, status: undefined }));
        }}
        items={RESOURCE_TABS.map((resource) => ({ key: resource, label: t(`workspace.resources.${resource}`) }))}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card
            size="small"
            title={t("workspace.resourceList")}
            extra={<Typography.Text type="secondary">{responseSummary(listQuery.data)}</Typography.Text>}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input.Search className="w-60" allowClear placeholder={t("workspace.query")} value={query.q} onChange={(e) => setQuery((prev) => ({ ...prev, q: e.target.value }))} />
              <Select className="w-44" allowClear placeholder={t("workspace.status")} value={query.status} onChange={(value) => setQuery((prev) => ({ ...prev, status: value }))} options={statusOptions} />
              <InputNumber min={1} max={100} value={query.limit} onChange={(value) => setQuery((prev) => ({ ...prev, limit: Number(value || 20) }))} />
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  icon={<Plus className="h-4 w-4" />}
                  type="primary"
                  disabled={!workspaceReady || !canWrite || !canCreateResource}
                  onClick={() => setBusinessDrawer({ mode: "create", resource: activeResource })}
                >
                  {t("workspace.actions.create")}
                </Button>
                <Button
                  icon={<Edit3 className="h-4 w-4" />}
                  disabled={!workspaceReady || !canWrite || !selected || !canEditResource}
                  onClick={() => selected && setBusinessDrawer({ mode: "edit", resource: activeResource, entity: selected })}
                >
                  {t("workspace.actions.edit")}
                </Button>
              </div>
            </div>
            {connectionNotice ? <Alert className="mb-3" type={connected ? "warning" : "info"} showIcon title={connectionNotice} /> : null}
            {workspaceReady && !canWrite ? <Alert className="mb-3" type="warning" showIcon title={t("workspace.permissionReadOnly")} /> : null}
            <EntityTable rows={rows} loading={listQuery.isFetching} onSelect={setSelected} resource={activeResource} />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card size="small" title={t("workspace.detail")}>
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Typography.Text strong ellipsis={{ tooltip: entityTitle(selected) }}>{entityTitle(selected)}</Typography.Text>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {activeResource === "assets" && selected.data?.kind ? <Tag>{String(selected.data.kind)}</Tag> : null}
                      <StatusTag status={selected.status} />
                      <Tag>v{selected.version}</Tag>
                    </div>
                  </div>
                </div>
                {activeResource === "runs" ? (
                  <Space wrap className="mt-3">
                    <Button icon={<Play className="h-4 w-4" />} disabled={!canStartRun || runAction.isPending} onClick={() => runAction.mutate("start")}>
                      {t("workspace.actions.start")}
                    </Button>
                    <Button icon={<Square className="h-4 w-4" />} disabled={!canCancelRun || runAction.isPending} onClick={() => runAction.mutate("cancel")}>
                      {t("workspace.actions.cancel")}
                    </Button>
                    <Button disabled={!canRetryRun || runAction.isPending} onClick={() => runAction.mutate("retry")}>{t("workspace.actions.retry")}</Button>
                    <Button disabled={!canExecute || runAction.isPending} onClick={() => runAction.mutate("replay")}>{t("workspace.actions.replayDryRun")}</Button>
                    <Button icon={<Download className="h-4 w-4" />} disabled={!canExport || runAction.isPending} onClick={() => runAction.mutate("export")}>{t("workspace.actions.exportJson")}</Button>
                  </Space>
                ) : null}
                <Descriptions size="small" column={1} className="mt-4" bordered>
                  <Descriptions.Item label={t("workspace.columns.status")}><StatusTag status={selected.status} /></Descriptions.Item>
                  <Descriptions.Item label={t("workspace.columns.resourceVersion")}>v{selected.version}</Descriptions.Item>
                  <Descriptions.Item label={t("workspace.columns.updated")}>{readableTime(selected.updated_at)}</Descriptions.Item>
                  <Descriptions.Item label={t("workspace.columns.created")}>{readableTime(selected.created_at)}</Descriptions.Item>
                  {activeResource === "assets" && selected.data?.kind ? <Descriptions.Item label={t("workspace.columns.kind")}>{String(selected.data.kind)}</Descriptions.Item> : null}
                  {selected.data?.description !== undefined ? <Descriptions.Item label={t("workspace.fields.description")}>{String(selected.data.description || "-")}</Descriptions.Item> : null}
                  {activeResource === "assets" && selected.data?.content !== undefined ? <Descriptions.Item label={t("workspace.assetContent")}>{String(selected.data.content || "-")}</Descriptions.Item> : null}
                </Descriptions>
                {activeResource === "runs" ? (
                  <div className="mt-4">
                    <Typography.Text type="secondary">{t("workspace.recordedOutput")}</Typography.Text>
                    <OutputPanel selected={selected} />
                  </div>
                ) : null}
                <Collapse
                  className="mt-4"
                  size="small"
                  items={[
                    { key: "data", label: t("workspace.advanced.data"), children: <pre className="max-h-64 overflow-auto rounded-md bg-[var(--surface-muted)] p-3 text-xs">{shortJson(selected.data)}</pre> },
                    { key: "evidence", label: t("workspace.advanced.evidence"), children: <pre className="max-h-64 overflow-auto rounded-md bg-[var(--surface-muted)] p-3 text-xs">{shortJson({ entity: selected, events: eventsQuery.data })}</pre> },
                  ]}
                />
              </>
            ) : (
              <Alert type="info" showIcon title={t("workspace.selectEntity")} />
            )}
          </Card>
        </Col>
      </Row>

      {activeResource === "runs" ? (
        <Card size="small" title={t("workspace.approvals")}>
          <Table
            rowKey="id"
            size="small"
            dataSource={approvalRows}
            loading={approvalsQuery.isFetching}
            pagination={{ pageSize: 6, showSizeChanger: false }}
            columns={[
              { title: t("workspace.columns.title"), render: (_, row) => entityTitle(row as HermesEntity) },
              { title: t("workspace.columns.status"), dataIndex: "status", render: (status) => <StatusTag status={String(status || "")} /> },
              {
                title: t("workspace.columns.actions"),
                width: 180,
                render: (_, row: HermesEntity) => (
                  <Space>
                    <Button size="small" disabled={!canApprove || approvalDecision.isPending || row.status !== "pending"} onClick={() => approvalDecision.mutate({ row, decision: "approve" })}>
                      {t("workspace.actions.approve")}
                    </Button>
                    <Button size="small" danger disabled={!canApprove || approvalDecision.isPending || row.status !== "pending"} onClick={() => approvalDecision.mutate({ row, decision: "reject" })}>
                      {t("workspace.actions.reject")}
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      ) : null}

      <Drawer
        title={t(`workspace.drawer.${businessDrawer?.mode || "create"}`, { resource: t(`workspace.resources.${businessDrawer?.resource || activeResource}`) })}
        open={Boolean(businessDrawer)}
        size="large"
        onClose={() => setBusinessDrawer(undefined)}
      >
        {businessDrawer ? (
          <Form form={businessForm} layout="vertical" onFinish={(values) => saveBusinessEntity.mutate(values)}>
            {businessDrawer.resource === "sessions" ? (
              <Form.Item name="name" label={t("workspace.fields.name")} rules={boundedTextRule(t)}>
                <Input maxLength={120} showCount />
              </Form.Item>
            ) : (
              <Form.Item name="title" label={t("workspace.fields.title")} rules={boundedTextRule(t)}>
                <Input maxLength={120} showCount />
              </Form.Item>
            )}
            {businessDrawer.resource !== "runs" ? (
              <>
                <Form.Item name="status" label={t("workspace.status")} rules={[{ required: true }]}>
                  <Select options={RESOURCE_STATUSES[businessDrawer.resource].map((status) => ({ value: status, label: statusLabel(t, status) }))} />
                </Form.Item>
                {businessDrawer.resource === "assets" ? (
                  <Form.Item name="kind" label={t("workspace.kind")}>
                    <Input maxLength={80} />
                  </Form.Item>
                ) : null}
                <Form.Item name="description" label={t("workspace.fields.description")}>
                  <Input.TextArea rows={3} maxLength={500} showCount />
                </Form.Item>
              </>
            ) : (
              <>
                <Form.Item name="session_id" label={t("workspace.sessionId")}>
                  <Input maxLength={120} />
                </Form.Item>
                <Form.Item name="nodesJson" label={t("workspace.nodesJson")} rules={[{ required: true }]}>
                  <Input.TextArea rows={8} />
                </Form.Item>
              </>
            )}
            {businessDrawer.resource === "assets" ? (
              <Form.Item name="content" label={t("workspace.assetContent")}>
                <Input.TextArea rows={6} maxLength={5000} showCount />
              </Form.Item>
            ) : null}
            {businessDrawer.mode === "edit" && businessDrawer.entity ? (
              <Alert className="mb-4" type="info" showIcon title={t("workspace.casHint", { version: businessDrawer.entity.version })} />
            ) : null}
            <Space>
              <Button htmlType="submit" type="primary" disabled={!workspaceReady || !canWrite} loading={saveBusinessEntity.isPending}>
                {t("workspace.save")}
              </Button>
              <Button onClick={() => setBusinessDrawer(undefined)}>{t("common.cancel")}</Button>
            </Space>
          </Form>
        ) : null}
      </Drawer>

      <Drawer
        title={actionResult?.title}
        open={Boolean(actionResult)}
        size="large"
        onClose={() => setActionResult(undefined)}
      >
        {actionResult?.diagnostics ? (
          <Space direction="vertical" size="middle" className="w-full">
            <Alert type={actionResult.response.ok ? "success" : "warning"} showIcon message={t(actionResult.response.ok ? "workspace.ready" : "workspace.diagnostics.degraded")} />
            <Table<{ id: string; status: string; detail: string }>
              size="small" rowKey="id" pagination={false}
              dataSource={actionResult.response.items.filter((item): item is { id: string; status: string; detail: string } =>
                typeof item === "object" && item !== null && "id" in item && typeof item.id === "string" &&
                "status" in item && typeof item.status === "string" && "detail" in item && typeof item.detail === "string")}
              columns={[
                { title: t("workspace.diagnostics.check"), dataIndex: "id", render: (value: string) => t(`workspace.diagnostics.${value}`, value) },
                { title: t("workspace.status"), dataIndex: "status", render: (value: string) => <Tag color={value === "passed" ? "success" : "error"}>{t(`workspace.diagnostics.${value}`, value)}</Tag> },
                { title: t("workspace.detail"), dataIndex: "detail" },
              ]}
            />
            <Typography.Paragraph copyable code>sop hermes diagnostics --json</Typography.Paragraph>
            <Collapse items={[{ key: "evidence", label: t("workspace.advanced.evidence"), children: <pre className="overflow-auto text-xs">{shortJson(actionResult.response)}</pre> }]} />
          </Space>
        ) : (
        <pre className="max-h-[70vh] overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--text)]">
          {shortJson(actionResult?.response)}
        </pre>
        )}
      </Drawer>

      <Drawer
        title={t("workspace.createWorkspace")}
        open={workspaceDrawer}
        size="large"
        onClose={() => setWorkspaceDrawer(false)}
      >
        <Form name="workspace-create-workspace" form={workspaceForm} layout="vertical" onFinish={(values) => createWorkspace.mutate(values)}>
          <Form.Item name="name" label={t("workspace.workspaceName")} rules={boundedTextRule(t)}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="root" label={t("workspace.workspaceRoot")} rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Button htmlType="submit" type="primary" disabled={!connected || !canConfig} loading={createWorkspace.isPending}>
            {t("workspace.createWorkspace")}
          </Button>
        </Form>
      </Drawer>
    </section>
  );
}
