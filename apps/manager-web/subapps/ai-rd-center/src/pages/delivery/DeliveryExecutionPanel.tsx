import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Collapse,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Tag,
} from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, RefreshCw, Send } from "lucide-react";
import { request } from "@/lib/http";
import {
  fetchDeliveryTargets,
  prepareDeliveryIntent,
  saveDelivery,
  type DeliveryAction,
  type DeliveryExecution,
  type DeliveryIntent,
  type DeliveryRequirement,
  type DeliveryTask,
  type DeliveryWorkspace,
} from "@/lib/delivery";

type Props = {
  sessionId: string;
  data: DeliveryWorkspace;
  task: DeliveryTask;
  requirement: DeliveryRequirement;
  onCommand: (
    action: DeliveryAction,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onSaved: (data: DeliveryWorkspace) => void;
};
const closed = ["accepted", "changes_requested", "cancelled"];

export function DeliveryExecutionPanel({
  data,
  task,
  requirement,
  onCommand,
  onSaved,
  sessionId,
}: Props) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`delivery.execution.${key}`);
  const targets = useQuery({
    queryKey: ["delivery-targets", data.project.id, sessionId],
    queryFn: () => fetchDeliveryTargets(data.project.id),
    gcTime: 0,
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm();
  const intent = useRef<DeliveryIntent>();
  const workspaceId = Form.useWatch("workspace_id", form);
  const mode = Form.useWatch("mode", form) || "agent";
  const workspace = targets.data?.workspaces.find((w) => w.id === workspaceId);
  const executions = (data.executions || [])
    .filter((e) => e.task_id === task.id)
    .slice()
    .reverse();
  const canExecute = data.permissions.write && targets.data?.can_execute;
  const canDispatch =
    canExecute &&
    task.status !== "completed" &&
    !task.dependency_blocked?.length &&
    !task.planning?.blocked_reason &&
    !["testing", "acceptance", "release", "operations"].includes(
      requirement.flow.stage,
    ) &&
    (!executions[0] || closed.includes(executions[0].status));

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const values = await form.validateFields();
    await act(async () => {
      let nodes: unknown[] = [];
      if (values.mode === "command") {
        try {
          nodes = JSON.parse(values.nodes);
          if (!Array.isArray(nodes)) throw new Error();
        } catch {
          throw new Error(tr("invalidPlan"));
        }
      }
      const agent = workspace?.agents.find((a) => a.id === values.agent_id);
      const payload = {
        task_id: task.id,
        workspace_id: values.workspace_id,
        agent_id: values.mode === "agent" ? values.agent_id : "",
        agent_version: agent?.version || 1,
        target_device_id: values.target_device_id || "",
        nodes,
        test_node_ids:
          values.mode === "command"
            ? String(values.test_node_ids || "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
      };
      intent.current = prepareDeliveryIntent(
        intent.current!,
        "execution.queue",
        payload,
      );
      const result = await saveDelivery(
        data.project.id,
        "execution.queue",
        payload,
        intent.current.version,
        intent.current.key,
      );
      onSaved(result);
      setOpen(false);
      form.resetFields();
    });
  }
  function openPlan() {
    intent.current = { version: data.version, key: crypto.randomUUID() };
    setError("");
    setOpen(true);
  }
  return (
    <section className="delivery-executions" aria-label={tr("title")}>
      <div className="delivery-execution-heading">
        <strong>{tr("title")}</strong>
        <Button
          size="small"
          icon={<Send size={14} />}
          disabled={!canDispatch || busy}
          onClick={openPlan}
        >
          {tr("queue")}
        </Button>
      </div>
      {targets.isError && (
        <Alert
          type="error"
          message={targets.error.message}
          action={
            <Button onClick={() => void targets.refetch()}>{tr("sync")}</Button>
          }
        />
      )}
      {targets.data && !targets.data.can_execute && (
        <p className="delivery-execution-help">{tr("noPermission")}</p>
      )}
      {targets.data && !targets.data.workspaces.length && (
        <p>
          {tr("noTargets")} · <a href="#/workspace">{tr("configure")}</a>
        </p>
      )}
      {error && !open && (
        <Alert
          role="alert"
          type="error"
          message={error}
          closable
          onClose={() => setError("")}
        />
      )}
      {!executions.length && (
        <p className="delivery-execution-help">{tr("empty")}</p>
      )}
      {executions.map((entry) => (
        <ExecutionCard
          key={entry.id}
          entry={entry}
          busy={busy}
          approve={data.permissions.approve}
          write={data.permissions.write}
          canExecute={Boolean(canExecute)}
          act={act}
          onCommand={onCommand}
          projectId={data.project.id}
        />
      ))}
      <Modal
        className="delivery-editor"
        title={tr("planTitle")}
        open={open}
        onCancel={() => !busy && setOpen(false)}
        confirmLoading={busy}
        okText={tr("save")}
        onOk={() => void save().catch(() => {})}
        destroyOnClose
      >
        <Alert type="info" message={tr("hint")} style={{ marginBottom: 16 }} />
        {error && (
          <Alert
            role="alert"
            type="error"
            message={error.includes("409") ? tr("conflict") : error}
            style={{ marginBottom: 12 }}
          />
        )}
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            mode: "agent",
            nodes: '[{"id":"tests","argv":["python","-m","pytest"]}]',
            test_node_ids: "tests",
          }}
        >
          <Form.Item
            name="workspace_id"
            label={tr("workspace")}
            rules={[{ required: true }]}
          >
            <Select
              options={targets.data?.workspaces.map((w) => ({
                value: w.id,
                label: w.name,
              }))}
              onChange={() =>
                form.setFieldsValue({
                  agent_id: undefined,
                  target_device_id: undefined,
                })
              }
            />
          </Form.Item>
          <Form.Item name="mode" label={tr("mode")}>
            <Select
              options={[
                { value: "agent", label: tr("agentMode") },
                { value: "command", label: tr("commandMode") },
              ]}
            />
          </Form.Item>
          {mode === "agent" ? (
            <Form.Item
              name="agent_id"
              label={tr("agent")}
              rules={[{ required: true }]}
            >
              <Select
                options={workspace?.agents.map((a) => ({
                  value: a.id,
                  label: `${a.title} · ${a.provider} · v${a.version}`,
                }))}
              />
            </Form.Item>
          ) : (
            <>
              <Form.Item
                name="nodes"
                label={tr("nodes")}
                rules={[{ required: true }]}
              >
                <Input.TextArea rows={5} spellCheck={false} />
              </Form.Item>
              <Form.Item name="test_node_ids" label={tr("testNodes")}>
                <Input />
              </Form.Item>
            </>
          )}
          <Form.Item name="target_device_id" label={tr("device")}>
            <Select
              allowClear
              placeholder={tr("local")}
              options={workspace?.devices.map((d) => ({
                value: d.id,
                label: d.name,
              }))}
            />
          </Form.Item>
        </Form>
        <div className="delivery-execution-snapshot">
          <strong>
            {tr("preview")} · v{requirement.flow.revision}
          </strong>
          <ul>
            {requirement.acceptance_criteria.map((criterion, index) => (
              <li key={index}>{criterion}</li>
            ))}
          </ul>
        </div>
      </Modal>
    </section>
  );
}

function ExecutionCard({
  entry,
  busy,
  approve,
  write,
  canExecute,
  act,
  onCommand,
  projectId,
}: {
  entry: DeliveryExecution;
  busy: boolean;
  approve: boolean;
  write: boolean;
  canExecute: boolean;
  projectId: string;
  act: (action: () => Promise<unknown>) => Promise<void>;
  onCommand: Props["onCommand"];
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`delivery.execution.${key}`);
  const [comment, setComment] = useState("");
  const terminal = closed.includes(entry.status);
  const reviewable = ["awaiting_review", "failed"].includes(entry.status);
  const review = (decision: string) =>
    void act(() =>
      onCommand("execution.review", {
        id: entry.id,
        decision,
        comment: comment.trim(),
        run_version: entry.run_version,
      }),
    );
  return (
    <article className={`delivery-execution-card is-${entry.status}`}>
      <div className="delivery-execution-heading">
        <Tag
          color={
            entry.status === "accepted"
              ? "success"
              : entry.status === "failed"
                ? "error"
                : "processing"
          }
        >
          {tr(`states.${entry.status}`)}
        </Tag>
        <small>
          {tr("revision")} {entry.snapshot.revision}
        </small>
      </div>
      {entry.stale && <Alert type="warning" message={tr("stale")} />}
      <Progress
        percent={entry.progress}
        size="small"
        status={
          entry.status === "failed"
            ? "exception"
            : entry.status === "accepted"
              ? "success"
              : "normal"
        }
      />
      <p className="delivery-execution-help">
        {tr("observed")} ·{" "}
        {entry.observed_at
          ? new Date(entry.observed_at).toLocaleString()
          : tr("never")}
      </p>
      <code className="delivery-execution-id">{entry.run_id || entry.id}</code>
      <Space wrap style={{ marginBlock: 10 }}>
        <Button
          size="small"
          loading={busy}
          disabled={!write || terminal}
          icon={<RefreshCw size={13} />}
          onClick={() =>
            void act(() => onCommand("execution.sync", { id: entry.id }))
          }
        >
          {tr("sync")}
        </Button>
        {entry.status === "planned" && (
          <Button
            size="small"
            type="primary"
            disabled={!canExecute || busy || entry.stale}
            icon={<Play size={13} />}
            onClick={() =>
              void act(async () => {
                await request(
                  `/api/hermes/v1/runs/${encodeURIComponent(entry.run_id)}/start`,
                  {
                    method: "POST",
                    headers: {
                      "X-Workspace-Id": entry.workspace_id,
                      "X-Project-Id": projectId,
                    },
                    body: JSON.stringify({
                      expected_version: entry.run_version,
                      idempotency_key: `${entry.id}-start`,
                      dry_run: false,
                    }),
                  },
                );
                await onCommand("execution.sync", { id: entry.id });
              })
            }
          >
            {tr("start")}
          </Button>
        )}
        {!terminal && entry.status !== "awaiting_review" && (
          <Button
            size="small"
            disabled={!canExecute || busy}
            onClick={() =>
              void act(() => onCommand("execution.cancel", { id: entry.id }))
            }
          >
            {tr("cancel")}
          </Button>
        )}
      </Space>
      {entry.issue_id && (
        <p>
          <a href="#/dev-flow?view=issues">
            <Tag color="error">{entry.issue_id}</Tag>
          </a>
          {tr("failed")}
        </p>
      )}
      <Collapse
        ghost
        size="small"
        items={[
          {
            key: "snapshot",
            label: tr("snapshot"),
            children: (
              <ul>
                {entry.snapshot.acceptance_criteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ),
          },
          {
            key: "logs",
            label: tr("logs"),
            children: Object.keys(entry.results).length ? (
              Object.entries(entry.results).map(([id, result]) => (
                <div className="delivery-execution-node" key={id}>
                  <strong>{id}</strong>{" "}
                  {entry.test_node_ids.includes(id) && <Tag>{tr("test")}</Tag>}
                  <p>
                    {tr("exit")}: {result.exit_code ?? "—"}
                  </p>
                  <pre>
                    {[result.error, result.stdout, result.stderr]
                      .filter(Boolean)
                      .join("\n") || "—"}
                  </pre>
                </div>
              ))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ),
          },
        ]}
      />
      {reviewable && approve && (
        <div className="delivery-execution-review">
          <label htmlFor={`review-${entry.id}`}>{tr("review")}</label>
          <Input.TextArea
            id={`review-${entry.id}`}
            value={comment}
            maxLength={4000}
            rows={2}
            onChange={(e) => setComment(e.target.value)}
            placeholder={tr("comment")}
          />
          <Space wrap>
            <Button
              size="small"
              type="primary"
              disabled={
                busy ||
                entry.stale ||
                entry.status !== "awaiting_review" ||
                !comment.trim()
              }
              onClick={() => review("accept")}
            >
              {tr("accept")}
            </Button>
            <Button
              size="small"
              disabled={busy || !comment.trim()}
              onClick={() => review("request_changes")}
            >
              {tr("reject")}
            </Button>
          </Space>
        </div>
      )}
      {entry.review && (
        <blockquote>
          {entry.review.comment}
          <footer>
            {entry.review.actor} · {new Date(entry.review.at).toLocaleString()}
          </footer>
        </blockquote>
      )}
    </article>
  );
}
