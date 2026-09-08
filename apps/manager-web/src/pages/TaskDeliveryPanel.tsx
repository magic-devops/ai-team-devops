import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import { Eye, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  HermesClient,
  HermesDelivery,
  HermesEntity,
  HermesRunNode,
} from "../lib/hermes";

type PlanNode = {
  id: string;
  argv: string;
  expected_exit_code: number;
  timeout_seconds: number;
};
type Preview = {
  kind: "dispatch" | "accept" | "request_changes";
  key: string;
  version: number;
  runVersion?: number;
  nodes?: HermesRunNode[];
  comment?: string;
  result: HermesDelivery;
};

export function TaskDeliveryPanel({
  client,
  task,
  permissions,
  onOpenRun,
  scopeKey,
}: {
  client: HermesClient;
  task: HermesEntity;
  permissions: Set<string>;
  onOpenRun: (run: HermesEntity) => void;
  scopeKey: string;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const [form] = Form.useForm<{ nodes: PlanNode[] }>();
  const [preview, setPreview] = useState<Preview>();
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<"accept" | "request_changes">(
    "accept",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const query = useQuery({
    queryKey: ["task-delivery", scopeKey, task.id],
    queryFn: () => client.taskDelivery(task.id),
    retry: false,
    refetchInterval: 3000,
  });
  const item = query.data?.items[0];
  const current = item?.task;
  const run = item?.run;
  const phase = item?.phase || "unplanned";
  const canDispatch =
    permissions.has("write") &&
    permissions.has("execute") &&
    ["unplanned", "changes_requested"].includes(phase) &&
    !["completed", "archived"].includes(current?.status || "");
  const canReview =
    permissions.has("approve") &&
    ["awaiting_review", "blocked", "cancelled"].includes(phase);
  const fresh =
    !query.isError &&
    preview &&
    preview.version === current?.version &&
    (preview.runVersion === undefined || preview.runVersion === run?.version);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function previewDispatch() {
    if (!current) return;
    const values = await form.validateFields();
    const nodes: HermesRunNode[] = values.nodes.map((node) => {
      const argv: unknown = JSON.parse(node.argv);
      if (
        !Array.isArray(argv) ||
        argv.length === 0 ||
        !argv.every((part) => typeof part === "string")
      )
        throw new Error(t("workspace.delivery.invalidArgv"));
      return { ...node, kind: "command", title: node.id, argv };
    });
    const key = crypto.randomUUID();
    const result = await client.taskDispatch(task.id, {
      expected_version: current.version,
      nodes,
      idempotency_key: key,
      dry_run: true,
    });
    setPreview({
      kind: "dispatch",
      key,
      version: current.version,
      nodes,
      result: result.items[0],
    });
  }

  async function previewReview() {
    if (!current || !run) return;
    const key = crypto.randomUUID();
    const result = await client.taskReview(task.id, {
      expected_version: current.version,
      run_id: run.id,
      run_version: run.version,
      decision,
      comment,
      idempotency_key: key,
      dry_run: true,
    });
    setPreview({
      kind: decision,
      key,
      version: current.version,
      runVersion: run.version,
      comment,
      result: result.items[0],
    });
  }

  async function apply() {
    if (!preview || !fresh) return;
    if (preview.kind === "dispatch" && preview.nodes) {
      await client.taskDispatch(task.id, {
        expected_version: preview.version,
        nodes: preview.nodes,
        idempotency_key: preview.key,
        dry_run: false,
      });
    } else if (run && preview.runVersion && preview.kind !== "dispatch") {
      await client.taskReview(task.id, {
        expected_version: preview.version,
        run_id: run.id,
        run_version: preview.runVersion,
        decision: preview.kind,
        comment: preview.comment || "",
        idempotency_key: preview.key,
        dry_run: false,
      });
    }
    setPreview(undefined);
    setFeedback(t("workspace.delivery.saved"));
    await query.refetch();
    await cache.invalidateQueries({ queryKey: ["hermes"] });
    await cache.invalidateQueries({ queryKey: ["hermes-detail"] });
  }

  if (query.isLoading) return <Spin />;
  const nodes = (run?.data.nodes || preview?.nodes || []) as HermesRunNode[];
  const results = (run?.data.node_results || {}) as Record<
    string,
    Record<string, unknown>
  >;
  return (
    <section
      className="mt-4 space-y-3"
      aria-label={t("workspace.delivery.title")}
    >
      <Space wrap>
        <Typography.Title level={5} className="!mb-0">
          {t("workspace.delivery.title")}
        </Typography.Title>
        <Tag>
          {t(`workspace.delivery.phases.${phase}`, {
            defaultValue: t(`workspace.statuses.${phase}`, {
              defaultValue: phase,
            }),
          })}
        </Tag>
        <Button
          type="text"
          icon={<RefreshCw size={16} />}
          aria-label={t("common.refresh")}
          onClick={() => query.refetch()}
        />
      </Space>
      {(query.error || error) && (
        <Alert type="error" showIcon title={error || String(query.error)} />
      )}
      {feedback && <Alert type="success" showIcon title={feedback} />}
      <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
        {String(
          current?.data.acceptance_criteria ||
            t("workspace.delivery.noCriteria"),
        )}
      </Typography.Paragraph>
      {run && (
        <Button icon={<Play size={16} />} onClick={() => onOpenRun(run)}>
          {t("workspace.delivery.openRun")}
        </Button>
      )}
      {nodes.length > 0 && (
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          scroll={{ x: 420 }}
          dataSource={nodes}
          columns={[
            { title: t("workspace.delivery.node"), dataIndex: "id" },
            {
              title: t("workspace.delivery.expectedExit"),
              dataIndex: "expected_exit_code",
            },
            {
              title: t("workspace.delivery.actualExit"),
              render: (_, node) => String(results[node.id]?.exit_code ?? "-"),
            },
            {
              title: t("workspace.columns.status"),
              render: (_, node) =>
                results[node.id] ? (
                  <Tag color={results[node.id].succeeded ? "green" : "red"}>
                    {t(
                      `workspace.statuses.${results[node.id].succeeded ? "completed" : "failed"}`,
                    )}
                  </Tag>
                ) : (
                  "-"
                ),
            },
          ]}
        />
      )}
      {canDispatch && (
        <Form
          form={form}
          layout="vertical"
          onValuesChange={() => setPreview(undefined)}
          initialValues={{
            nodes: [
              {
                id: "verify",
                argv: "[]",
                expected_exit_code: 0,
                timeout_seconds: 60,
              },
            ],
          }}
        >
          <Form.List name="nodes">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div
                    key={field.key}
                    className="border-b border-[var(--border)] py-2"
                  >
                    <Form.Item
                      name={[field.name, "id"]}
                      label={t("workspace.delivery.node")}
                      rules={[
                        {
                          required: true,
                          pattern: /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/,
                        },
                      ]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "argv"]}
                      label={t("workspace.delivery.argv")}
                      rules={[{ required: true }]}
                    >
                      <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
                    </Form.Item>
                    <Space wrap align="start">
                      <Form.Item
                        name={[field.name, "expected_exit_code"]}
                        label={t("workspace.delivery.expectedExit")}
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={0} max={255} />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "timeout_seconds"]}
                        label={t("workspace.delivery.timeout")}
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={1} max={3600} />
                      </Form.Item>
                      <Button
                        icon={<Trash2 size={16} />}
                        aria-label={t("workspace.delivery.removeNode")}
                        disabled={fields.length <= 1}
                        onClick={() => {
                          remove(field.name);
                          setPreview(undefined);
                        }}
                      />
                    </Space>
                  </div>
                ))}
                <Button
                  className="mt-2"
                  icon={<Plus size={16} />}
                  disabled={fields.length >= 64}
                  onClick={() => {
                    add({
                      id: `step${fields.length + 1}`,
                      argv: "[]",
                      expected_exit_code: 0,
                      timeout_seconds: 60,
                    });
                    setPreview(undefined);
                  }}
                >
                  {t("workspace.delivery.addNode")}
                </Button>
              </>
            )}
          </Form.List>
          <Button
            className="mt-3"
            icon={<Eye size={16} />}
            disabled={busy || query.isError}
            onClick={() => perform(previewDispatch)}
          >
            {t("workspace.delivery.previewPlan")}
          </Button>
        </Form>
      )}
      {canReview && (
        <Space orientation="vertical" className="w-full">
          <Select
            className="w-full"
            aria-label={t("workspace.delivery.decision")}
            value={decision}
            onChange={(value) => {
              setDecision(value);
              setPreview(undefined);
            }}
            options={[
              {
                value: "accept",
                label: t("workspace.delivery.accept"),
                disabled: run?.status !== "completed",
              },
              {
                value: "request_changes",
                label: t("workspace.delivery.requestChanges"),
              },
            ]}
          />
          <Input.TextArea
            aria-label={t("workspace.delivery.comment")}
            placeholder={t("workspace.delivery.comment")}
            rows={3}
            maxLength={4000}
            value={comment}
            onChange={(event) => {
              setComment(event.target.value);
              setPreview(undefined);
            }}
          />
          <Button
            icon={<Eye size={16} />}
            disabled={
              busy ||
              !comment.trim() ||
              query.isError ||
              (decision === "accept" && run?.status !== "completed")
            }
            onClick={() => perform(previewReview)}
          >
            {t("workspace.delivery.previewReview")}
          </Button>
        </Space>
      )}
      {!canDispatch &&
        !canReview &&
        ![
          "accepted",
          "planned",
          "queued",
          "running",
          "interrupted",
          "retrying",
        ].includes(phase) && (
          <Typography.Text type="secondary">
            {t("workspace.delivery.permissionHint")}
          </Typography.Text>
        )}
      {preview && (
        <Alert
          type="info"
          title={t("workspace.delivery.previewReady")}
          description={
            <Space orientation="vertical" className="w-full">
              <pre className="max-h-48 max-w-full overflow-auto text-xs">
                {JSON.stringify(
                  preview.kind === "dispatch"
                    ? preview.result.plan
                    : preview.result.review,
                  null,
                  2,
                )}
              </pre>
              <Button
                type="primary"
                loading={busy}
                disabled={
                  !fresh ||
                  (preview.kind === "dispatch" ? !canDispatch : !canReview)
                }
                onClick={() => perform(apply)}
              >
                {t("workspace.delivery.apply")}
              </Button>
            </Space>
          }
        />
      )}
      <Collapse
        size="small"
        items={[
          {
            key: "cli",
            label: "CLI",
            children: (
              <Typography.Paragraph
                copyable
                code
              >{`sop task v1 delivery ${task.id} --json`}</Typography.Paragraph>
            ),
          },
          {
            key: "evidence",
            label: t("workspace.advanced.evidence"),
            children: (
              <pre className="max-h-64 overflow-auto text-xs">
                {JSON.stringify(
                  {
                    source: run?.data.task_source,
                    results,
                    review: item?.review,
                    trace_id: query.data?.trace_id,
                  },
                  null,
                  2,
                )}
              </pre>
            ),
          },
        ]}
      />
    </section>
  );
}
