import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Divider, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { Activity, Database, Download, KeyRound, Play, RefreshCw, ShieldCheck, Square, Workflow } from "lucide-react";
import {
  DEFAULT_HERMES_BASE_URL,
  HermesUnavailableError,
  createHermesClient,
  type HermesApiResponse,
  type HermesEntity,
  type HermesResource,
  type HermesRunData,
} from "../lib/hermesV2";

const RESOURCE_TABS: HermesResource[] = ["sessions", "runs", "assets", "tasks", "requirements", "schedules", "devices"];

type ConnectionForm = {
  baseUrl: string;
  token: string;
  workspaceId?: string;
};

type QueryState = {
  q: string;
  status?: string;
  kind?: string;
  limit: number;
};

type RunFormValues = {
  title: string;
  session_id?: string;
  nodesJson: string;
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
      message={err.status === 401 || err.status === 403 ? t("workspaceV5.authError") : t("workspaceV5.offlineError")}
      description={[err.message, err.traceId ? `trace_id=${err.traceId}` : ""].filter(Boolean).join(" · ")}
    />
  );
}

function EntityTable({
  rows,
  loading,
  onSelect,
}: {
  rows: HermesEntity[];
  loading?: boolean;
  onSelect: (row: HermesEntity) => void;
}) {
  const { t } = useTranslation();
  const columns: ColumnsType<HermesEntity> = [
    {
      title: t("workspaceV5.columns.title"),
      dataIndex: "id",
      render: (_, row) => (
        <button type="button" className="text-left font-semibold text-[var(--brand)] hover:underline" onClick={() => onSelect(row)}>
          {entityTitle(row)}
        </button>
      ),
    },
    { title: t("workspaceV5.columns.status"), dataIndex: "status", width: 120, render: (status) => <Tag>{String(status || "-")}</Tag> },
    { title: t("workspaceV5.columns.kind"), dataIndex: "kind", width: 140 },
    { title: t("workspaceV5.columns.version"), dataIndex: "version", width: 100 },
    { title: t("workspaceV5.columns.updated"), dataIndex: "updated_at", width: 210 },
  ];
  return <Table rowKey="id" size="small" loading={loading} columns={columns} dataSource={rows} pagination={{ pageSize: 8 }} scroll={{ x: 760 }} />;
}

function collectRunOutput(selected?: HermesEntity, events?: HermesApiResponse<unknown>) {
  const data = selected?.data ?? {};
  const chunks: string[] = [];
  const nodeResults = data.node_results && typeof data.node_results === "object" ? data.node_results as Record<string, Record<string, unknown>> : {};
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const exitCode = result.exit_code ?? result.expected_exit_code;
    chunks.push([`[${nodeId}] exit=${exitCode ?? "-"}`, stdout ? `stdout:\n${stdout}` : "", stderr ? `stderr:\n${stderr}` : ""].filter(Boolean).join("\n"));
  }
  for (const key of ["stdout", "stderr", "output", "logs"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) chunks.push(`${key}:\n${value}`);
    else if (value !== undefined && value !== null) chunks.push(`${key}:\n${shortJson(value)}`);
  }
  if (!chunks.length && events?.items?.length) chunks.push(shortJson(events.items));
  return chunks.join("\n\n");
}

function OutputPanel({ selected, events }: { selected?: HermesEntity; events?: HermesApiResponse<unknown> }) {
  const { t } = useTranslation();
  const output = collectRunOutput(selected, events);
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--text)]">
      {output || t("workspaceV5.noRecordedOutput")}
    </pre>
  );
}

export function WorkspaceV5() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionForm>({ baseUrl: DEFAULT_HERMES_BASE_URL, token: "", workspaceId: "" });
  const [tokenGeneration, setTokenGeneration] = useState(0);
  const [query, setQuery] = useState<QueryState>({ q: "", limit: 20 });
  const [activeResource, setActiveResource] = useState<HermesResource>("runs");
  const [selected, setSelected] = useState<HermesEntity | undefined>();
  const [actionResult, setActionResult] = useState<{ title: string; response: HermesApiResponse<unknown> } | undefined>();
  const [workspaceForm] = Form.useForm<{ name: string; root: string }>();
  const [runForm] = Form.useForm<RunFormValues>();
  const [assetForm] = Form.useForm<{ title: string; kind: string; content: string }>();
  const client = useHermes(connection);
  const connected = Boolean(connection.baseUrl && connection.token);
  const workspaceReady = connected && Boolean(connection.workspaceId);

  useEffect(() => {
    setSelected(undefined);
  }, [connection.baseUrl, connection.workspaceId, tokenGeneration]);

  const listQuery = useQuery({
    queryKey: ["hermes-v5", connection.baseUrl, tokenGeneration, connection.workspaceId, activeResource, query],
    queryFn: () => client.list(activeResource, query),
    enabled: workspaceReady,
    refetchInterval: workspaceReady && activeResource === "runs" ? 3000 : false,
    retry: false,
  });

  const workspacesQuery = useQuery({
    queryKey: ["hermes-v5-workspaces", connection.baseUrl, tokenGeneration],
    queryFn: () => client.workspaces({ limit: 50 }),
    enabled: connected,
    retry: false,
  });

  const approvalsQuery = useQuery({
    queryKey: ["hermes-v5-approvals", connection.baseUrl, tokenGeneration, connection.workspaceId],
    queryFn: () => client.approvals({ limit: 20 }),
    enabled: workspaceReady,
    refetchInterval: workspaceReady ? 5000 : false,
    retry: false,
  });

  const readinessQuery = useQuery({
    queryKey: ["hermes-v5-readiness", connection.baseUrl, tokenGeneration],
    queryFn: () => client.readiness(),
    enabled: connected,
    retry: false,
  });

  const selectedQuery = useQuery({
    queryKey: ["hermes-v5-detail", connection.baseUrl, tokenGeneration, connection.workspaceId, activeResource, selected?.id],
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
    queryKey: ["hermes-v5-run-events", connection.baseUrl, tokenGeneration, connection.workspaceId, selected?.id],
    queryFn: () => client.runEvents(selected?.id || "", 0),
    enabled: workspaceReady && activeResource === "runs" && Boolean(selected?.id),
    refetchInterval: workspaceReady && activeResource === "runs" && selected && !["completed", "failed", "cancelled"].includes(selected.status) ? 2000 : false,
    retry: false,
  });

  const createWorkspace = useMutation({
    mutationFn: (values: { name: string; root: string }) => client.createWorkspace({ data: values, idempotency_key: idempotencyKey("workspace") }),
    onSuccess: (response) => {
      const workspace = response.items[0];
      if (workspace?.id) setConnection((prev) => ({ ...prev, workspaceId: workspace.id }));
      workspaceForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ["hermes-v5-workspaces"] });
      message.success(t("workspaceV5.created"));
    },
  });

  const createRun = useMutation({
    mutationFn: (values: RunFormValues) => {
      const nodes = JSON.parse(values.nodesJson) as HermesRunData["nodes"];
      const data: HermesRunData = {
        title: values.title,
        nodes,
      };
      if (values.session_id?.trim()) data.session_id = values.session_id.trim();
      return client.create("runs", {
        data,
        idempotency_key: idempotencyKey("run"),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hermes-v5"] });
      message.success(t("workspaceV5.created"));
    },
  });

  const createAsset = useMutation({
    mutationFn: (values: { title: string; kind: string; content: string }) =>
      client.create("assets", { data: values, idempotency_key: idempotencyKey("asset") }),
    onSuccess: () => {
      assetForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ["hermes-v5"] });
      message.success(t("workspaceV5.created"));
    },
  });

  const runAction = useMutation({
    mutationFn: (action: "start" | "cancel" | "retry" | "replay") => {
      if (!selected) throw new Error("No run selected");
      return client.runAction(selected.id, action, {
        idempotency_key: idempotencyKey(action),
        expected_version: selected.version,
        dry_run: action === "replay",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hermes-v5"] });
      queryClient.invalidateQueries({ queryKey: ["hermes-v5-run-events"] });
      message.success(t("workspaceV5.actionSent"));
    },
  });

  const inspectRunAction = useMutation({
    mutationFn: (action: "replay" | "export") => {
      if (!selected) throw new Error("No run selected");
      return client.runAction(selected.id, action, {
        idempotency_key: idempotencyKey(action),
        expected_version: selected.version,
        dry_run: action === "replay",
      });
    },
    onSuccess: (response, action) => {
      setActionResult({ title: t(`workspaceV5.actions.${action === "replay" ? "replayDryRun" : "exportJson"}`), response });
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
      queryClient.invalidateQueries({ queryKey: ["hermes-v5"] });
      queryClient.invalidateQueries({ queryKey: ["hermes-v5-run-events"] });
      message.success(t("workspaceV5.actionSent"));
    },
  });

  const approvalDecision = useMutation({
    mutationFn: ({ row, decision }: { row: HermesEntity; decision: "approve" | "reject" }) =>
      client.approvalDecision(row.id, {
        decision,
        idempotency_key: idempotencyKey(`approval-${decision}`),
        expected_version: row.version,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hermes-v5-approvals"] });
      message.success(t("workspaceV5.actionSent"));
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

  return (
    <section className="space-y-4">
      <Card size="small">
        <Row gutter={[16, 16]} align="bottom">
          <Col xs={24} lg={7}>
            <Typography.Title level={3} className="!mb-1">
              {t("workspaceV5.title")}
            </Typography.Title>
          </Col>
          <Col xs={24} sm={12} lg={5}>
            <Input
              aria-label={t("workspaceV5.baseUrl")}
              prefix={<Database className="h-4 w-4" />}
              value={connection.baseUrl}
              onChange={(event) => {
                setSelected(undefined);
                setConnection((prev) => ({ ...prev, baseUrl: event.target.value, workspaceId: "" }));
              }}
              placeholder={DEFAULT_HERMES_BASE_URL}
            />
          </Col>
          <Col xs={24} sm={12} lg={5}>
            <Input.Password
              aria-label={t("workspaceV5.token")}
              prefix={<KeyRound className="h-4 w-4" />}
              value={connection.token}
              onChange={(event) => {
                setTokenGeneration((value) => value + 1);
                setSelected(undefined);
                setConnection((prev) => ({ ...prev, token: event.target.value, workspaceId: "" }));
              }}
              placeholder={t("workspaceV5.tokenPlaceholder")}
            />
          </Col>
          <Col xs={24} sm={16} lg={5}>
            <Select
              className="w-full"
              allowClear
              showSearch
              value={connection.workspaceId || undefined}
              placeholder={t("workspaceV5.workspace")}
              onChange={(value) => {
                setSelected(undefined);
                setConnection((prev) => ({ ...prev, workspaceId: value }));
              }}
              options={workspaceRows.map((item) => ({ value: item.id, label: `${entityTitle(item)} · ${item.id}` }))}
            />
          </Col>
          <Col xs={24} sm={8} lg={2}>
            <Button block icon={<RefreshCw className="h-4 w-4" />} onClick={() => queryClient.invalidateQueries({ queryKey: ["hermes-v5"] })}>
              {t("common.refresh")}
            </Button>
          </Col>
        </Row>
        {!connected ? <Alert className="mt-3" type="info" showIcon message={t("workspaceV5.connectHint")} /> : null}
        {connected && !connection.workspaceId ? <Alert className="mt-3" type="warning" showIcon message={t("workspaceV5.workspaceRequired")} /> : null}
      </Card>

      <ErrorAlert error={listQuery.error || workspacesQuery.error || readinessQuery.error || approvalsQuery.error || createRun.error || createAsset.error || runAction.error || inspectRunAction.error || approvalDecision.error} />

      <div className="grid grid-cols-3 gap-3 border-b py-3">
        <div className="min-w-0">
          <Typography.Text type="secondary">{t("workspaceV5.summary.scope")}</Typography.Text>
          <div className="mt-1 flex min-w-0 items-center gap-1">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <Typography.Text ellipsis={{ tooltip: connection.workspaceId }}>
              {String(workspaceRows.find((item) => item.id === connection.workspaceId)?.data.name || t("workspaceV5.noWorkspace"))}
            </Typography.Text>
          </div>
        </div>
        <Statistic valueStyle={{ fontSize: 16 }} title={t("workspaceV5.summary.items")} value={rows.length} prefix={<Workflow className="h-4 w-4" />} />
        <Statistic valueStyle={{ fontSize: 16 }} title={t("workspaceV5.summary.readiness")} value={readinessQuery.data?.ok ? t("workspaceV5.ready") : t("workspaceV5.unknown")} prefix={<Activity className="h-4 w-4" />} />
      </div>

      <Tabs
        activeKey={activeResource}
        onChange={(key) => {
          setActiveResource(key as HermesResource);
          setSelected(undefined);
        }}
        items={RESOURCE_TABS.map((resource) => ({ key: resource, label: t(`workspaceV5.resources.${resource}`) }))}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card
            size="small"
            title={t("workspaceV5.resourceList")}
            extra={<Typography.Text type="secondary">{responseSummary(listQuery.data)}</Typography.Text>}
          >
            <Space wrap className="mb-3">
              <Input.Search allowClear placeholder={t("workspaceV5.query")} value={query.q} onChange={(e) => setQuery((prev) => ({ ...prev, q: e.target.value }))} />
              <Input placeholder={t("workspaceV5.status")} value={query.status} onChange={(e) => setQuery((prev) => ({ ...prev, status: e.target.value || undefined }))} />
              <Input placeholder={t("workspaceV5.kind")} value={query.kind} onChange={(e) => setQuery((prev) => ({ ...prev, kind: e.target.value || undefined }))} />
              <InputNumber min={1} max={100} value={query.limit} onChange={(value) => setQuery((prev) => ({ ...prev, limit: Number(value || 20) }))} />
            </Space>
            <EntityTable rows={rows} loading={listQuery.isFetching} onSelect={setSelected} />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card size="small" title={t("workspaceV5.detail")}>
            {selected ? (
              <>
                <Typography.Text strong>{entityTitle(selected)}</Typography.Text>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Tag>{selected.kind}</Tag>
                  <Tag>{selected.status}</Tag>
                  <Tag>v{selected.version}</Tag>
                </div>
                {activeResource === "runs" ? (
                  <Space wrap className="mt-3">
                    <Button icon={<Play className="h-4 w-4" />} disabled={!canStartRun || runAction.isPending} onClick={() => runAction.mutate("start")}>
                      {t("workspaceV5.actions.start")}
                    </Button>
                    <Button icon={<Square className="h-4 w-4" />} disabled={!canCancelRun || runAction.isPending} onClick={() => runAction.mutate("cancel")}>
                      {t("workspaceV5.actions.cancel")}
                    </Button>
                    <Button disabled={!canRetryRun || runAction.isPending} onClick={() => runAction.mutate("retry")}>{t("workspaceV5.actions.retry")}</Button>
                    <Button disabled={!canExecute || inspectRunAction.isPending} onClick={() => inspectRunAction.mutate("replay")}>{t("workspaceV5.actions.replayDryRun")}</Button>
                    <Button icon={<Download className="h-4 w-4" />} disabled={!canExport || inspectRunAction.isPending} onClick={() => inspectRunAction.mutate("export")}>{t("workspaceV5.actions.exportJson")}</Button>
                  </Space>
                ) : null}
                <Divider />
                <Typography.Text type="secondary">{t("workspaceV5.recordedOutput")}</Typography.Text>
                <OutputPanel selected={selected} events={eventsQuery.data} />
                <Divider />
                <pre className="max-h-64 overflow-auto rounded-md bg-[var(--surface-muted)] p-3 text-xs">{shortJson(selected)}</pre>
              </>
            ) : (
              <Alert type="info" showIcon message={t("workspaceV5.selectEntity")} />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card size="small" title={t("workspaceV5.createWorkspace")}>
            <Form name="workspace-v5-create-workspace" form={workspaceForm} layout="vertical" onFinish={(values) => createWorkspace.mutate(values)}>
              <Form.Item name="name" label={t("workspaceV5.workspaceName")} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="root" label={t("workspaceV5.workspaceRoot")} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Button htmlType="submit" type="primary" disabled={!connected || !canConfig} loading={createWorkspace.isPending}>
                {t("workspaceV5.create")}
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title={t("workspaceV5.createRun")}>
            <Form
              name="workspace-v5-create-run"
              form={runForm}
              layout="vertical"
              initialValues={{
                title: "Quality evidence run",
                session_id: "",
                nodesJson: JSON.stringify(
                  [{ id: "node-1", title: "Typecheck", kind: "command", argv: ["pnpm", "typecheck"], expected_exit_code: 0, timeout_seconds: 60 }],
                  null,
                  2,
                ),
              }}
              onFinish={(values) => createRun.mutate(values)}
            >
              <Form.Item name="title" label={t("workspaceV5.runTitle")} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="session_id" label={t("workspaceV5.sessionId")}>
                <Input />
              </Form.Item>
              <Form.Item name="nodesJson" label={t("workspaceV5.nodesJson")} rules={[{ required: true }]}>
                <Input.TextArea rows={6} />
              </Form.Item>
              <Button htmlType="submit" type="primary" disabled={!workspaceReady || !canWrite} loading={createRun.isPending}>
                {t("workspaceV5.create")}
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title={t("workspaceV5.createAsset")}>
            <Form name="workspace-v5-create-asset" form={assetForm} layout="vertical" onFinish={(values) => createAsset.mutate(values)}>
              <Form.Item name="title" label={t("workspaceV5.assetTitle")} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="kind" label={t("workspaceV5.assetKind")} initialValue="knowledge" rules={[{ required: true }]}>
                <Select options={["memory", "knowledge", "skill", "plugin", "data-source"].map((value) => ({ value, label: value }))} />
              </Form.Item>
              <Form.Item name="content" label={t("workspaceV5.assetContent")} rules={[{ required: true }]}>
                <Input.TextArea rows={6} />
              </Form.Item>
              <Button htmlType="submit" type="primary" disabled={!workspaceReady || !canWrite} loading={createAsset.isPending}>
                {t("workspaceV5.create")}
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>

      <Card size="small" title={t("workspaceV5.approvals")}>
        <Table
          rowKey="id"
          size="small"
          dataSource={approvalRows}
          loading={approvalsQuery.isFetching}
          pagination={{ pageSize: 6 }}
          columns={[
            { title: t("workspaceV5.columns.title"), render: (_, row) => entityTitle(row) },
            { title: t("workspaceV5.columns.status"), dataIndex: "status", render: (status) => <Tag>{String(status || "-")}</Tag> },
            {
              title: t("workspaceV5.columns.actions"),
              render: (_, row) => (
                <Space>
                  <Button size="small" disabled={!canApprove || approvalDecision.isPending || row.status !== "pending"} onClick={() => approvalDecision.mutate({ row, decision: "approve" })}>
                    {t("workspaceV5.actions.approve")}
                  </Button>
                  <Button size="small" danger disabled={!canApprove || approvalDecision.isPending || row.status !== "pending"} onClick={() => approvalDecision.mutate({ row, decision: "reject" })}>
                    {t("workspaceV5.actions.reject")}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Drawer
        title={actionResult?.title}
        open={Boolean(actionResult)}
        width={720}
        onClose={() => setActionResult(undefined)}
      >
        <pre className="max-h-[70vh] overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--text)]">
          {shortJson(actionResult?.response)}
        </pre>
      </Drawer>
    </section>
  );
}
