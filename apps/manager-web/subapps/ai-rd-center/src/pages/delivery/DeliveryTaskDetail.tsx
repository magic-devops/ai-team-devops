import { EventReceiptReturn } from "@/components/EventReceiptReturn";
import {
  fetchDeliveryTaskData,
  invalidateDeliveryQueries,
} from "@/lib/deliveryQuery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Select, Skeleton, Tag } from "antd";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  saveDelivery,
  type DeliveryAction,
  type DeliveryTaskData,
  type DeliveryCommandAck,
} from "@/lib/delivery";
import {
  manualTaskHref,
  taskRecordStatusLabel,
} from "@/lib/deliveryTaskReview";
import { DeliveryManualReviewPanel } from "./DeliveryManualReviewPanel";
import { DeliveryTaskPlanMaintenance } from "./DeliveryTaskPlanMaintenance";
import { DeliveryExecutionPanel } from "./DeliveryExecutionPanel";
import { DeliveryCollaboration } from "./DeliveryDiscussionAdoption";
import { TaskAcceptanceFacts } from "./TaskAcceptanceFacts";
import "./task-acceptance.css";
import { ProjectOwnerSelect } from "@/components/DeliveryMemberIdentity";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { useExecutionExitGuard } from "@/lib/executionExitGuard";

type TaskContentProps = {
  detail?: DeliveryTaskData;
  pinnedDetail?: DeliveryTaskData;
  taskId: string;
  sessionId?: string;
  canEdit: boolean;
  executionBlocked?: boolean;
  onSaved: (workspace: DeliveryCommandAck) => void;
  onEditingChange: (editing: boolean) => void;
  onCommand?: (
    action: DeliveryAction,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onUnresolvedChange?: (value: boolean) => void;
};
export function TaskDetailContent({
  detail,
  pinnedDetail,
  taskId,
  sessionId = "",
  canEdit,
  executionBlocked = false,
  onSaved,
  onEditingChange,
  onCommand,
  onUnresolvedChange,
}: TaskContentProps) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryTaskAcceptance.${key}`);
  const data = pinnedDetail || detail;
  const editable = canEdit && !executionBlocked;
  const task = data?.task.id === taskId ? data.task : undefined;
  if (!data) return null;
  if (!task)
    return (
      <Alert
        type="warning"
        title={tr("missing")}
        description={tr("missingHint")}
      />
    );
  const requirement = data.requirement || undefined;
  const owner = data.members.find((member) => member.id === task.owner_id);
  const unavailableOwner = Boolean(
    task.owner_id && (!owner?.active || owner.kind === "tool"),
  );
  const native = Boolean(task.execution_id);
  const command = onCommand || (async () => {});
  const stageLocked = Boolean(
    requirement && ["release", "operations"].includes(requirement.flow.stage),
  );
  const execution = (
    <DeliveryExecutionPanel
      disabled={!editable}
      data={data}
      task={task}
      sessionId={sessionId}
      onCommand={command}
      onSaved={onSaved}
      onEditingChange={onEditingChange}
      onUnresolvedChange={onUnresolvedChange}
    />
  );
  return (
    <div className="task-delivery-content">
      <div className="delivery-manual-heading task-delivery-heading">
        <h3>{task.title}</h3>
        <div>
          {task.delivery_status && (
            <Tag
              color={
                task.verified
                  ? "success"
                  : task.delivery_status === "blocked"
                    ? "warning"
                    : "processing"
              }
            >
              {t(`deliveryProgress.states.${task.delivery_status}`)}
            </Tag>
          )}
          <Tag>{tr(task.req_id ? "linked" : "standalone")}</Tag>
        </div>
      </div>
      <small className="delivery-manual-identity">
        {task.id} · {task.estimate}
      </small>
      {requirement && (
        <Button type="link" size="small" href={manualTaskHref(task)}>
          {requirement.title}
        </Button>
      )}
      <p className="delivery-manual-content">{task.description}</p>
      {native && execution}
      <div className="task-delivery-properties">
        <label>
          {tr("owner")}
          <ProjectOwnerSelect
            queryGeneration={data.query_generation}
            label={`${tr("owner")} ${task.title}`}
            value={task.owner_id}
            members={data.members}
            disabled={!editable || !onCommand || stageLocked || !task.basis}
            onChange={(owner_id) =>
              void command("task.update", {
                id: task.id,
                owner_id,
                task_basis: task.basis,
              }).catch(() => {})
            }
          />
        </label>
        <label>
          {tr("recordStatus")}
          <Select
            aria-label={`${tr("recordStatus")} ${task.title}`}
            value={task.recorded_status ?? task.status}
            disabled={!editable || !onCommand || stageLocked}
            options={["pending", "in_progress", "blocked", "completed"].map(
              (value) => ({
                value,
                label: taskRecordStatusLabel(value, t),
                disabled:
                  (value === "completed" && native) ||
                  (["in_progress", "completed"].includes(value) &&
                    Boolean(
                      task.dependency_blocked?.length ||
                      task.planning?.blocked_reason ||
                      requirement?.flow.blocked_reason,
                    )),
              }),
            )}
            onChange={(status) =>
              void command("task.update", { id: task.id, status }).catch(
                () => {},
              )
            }
          />
        </label>
      </div>
      {unavailableOwner && (
        <p className="runtime-help" role="status">
          {t("deliveryTeam.unavailableOwner")}
        </p>
      )}
      <p className="runtime-help">{tr("executionOwner")}</p>
      <TaskAcceptanceFacts acceptance={task.acceptance} />
      <DeliveryCollaboration
        key={`${data.project.id}:${sessionId}:${task.id}`}
        projectId={data.project.id}
        sessionId={sessionId}
        subject={{ kind: "task", id: task.id }}
        object
        readOnly={!editable}
        onSaved={onSaved}
        onUnresolvedChange={onUnresolvedChange}
      />
      <DeliveryTaskPlanMaintenance
        task={task}
        data={data}
        onTask={(dependency) => {
          location.hash = manualTaskHref(dependency);
        }}
        onSaved={onSaved}
        canEdit={editable && !stageLocked}
        onEditingChange={onEditingChange}
      />
      {!native && execution}
      {native && <p className="runtime-help">{tr("nativeReview")}</p>}
    </div>
  );
}
export function DeliveryTaskDetail({
  projectId,
  sessionId,
  taskId,
  expectedRequirementId,
  queryGeneration,
  onUnresolvedChange,
}: {
  projectId: string;
  sessionId: string;
  taskId: string;
  expectedRequirementId?: string;
  queryGeneration?: number | null;
  onUnresolvedChange?: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const origin = useRef(projectSessionKey());
  const executionExit = useExecutionExitGuard();
  const [pinnedWorkspace, setPinnedWorkspace] = useState<DeliveryTaskData>();
  const [executionPinnedWorkspace, setExecutionPinnedWorkspace] =
    useState<DeliveryTaskData>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latestWorkspace = useRef<DeliveryTaskData>();
  const editingChanged = useCallback((editing: boolean) => {
    if (editing) {
      const current = latestWorkspace.current;
      if (current)
        setPinnedWorkspace((previous) => previous || structuredClone(current));
    } else setPinnedWorkspace(undefined);
  }, []);
  const key = [
    "delivery-task-detail",
    projectId,
    sessionId,
    taskId,
    queryGeneration,
  ];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      fetchDeliveryTaskData(projectId, taskId, signal, queryGeneration),
    gcTime: 0,
    enabled: !pinnedWorkspace,
    refetchInterval: pinnedWorkspace ? false : 5000,
  });
  latestWorkspace.current = query.data;
  const saved = (workspace: DeliveryCommandAck) => {
    if (
      workspace.project_id !== projectId ||
      origin.current !== projectSessionKey()
    )
      return;
    void invalidateDeliveryQueries(qc, projectId);
    for (const name of [
      "delivery-task-reviews",
      "delivery-task-review-current",
      "delivery-inbox",
      "delivery-progress",
      "tasks",
      "tasksSummary",
      "taskDependencies",
    ])
      void qc.invalidateQueries({ queryKey: [name] });
  };
  const intent = useRef<{ signature: string; key: string }>();
  async function command(
    action: DeliveryAction,
    payload: Record<string, unknown>,
  ) {
    const current = qc.getQueryData<DeliveryTaskData>(key);
    if (
      !current ||
      busy ||
      query.isError ||
      executionExit.pending ||
      origin.current !== projectSessionKey()
    )
      throw new Error(t("deliveryTaskAcceptance.readonly"));
    const signature = JSON.stringify([action, payload, current.version]);
    if (intent.current?.signature !== signature)
      intent.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      saved(
        await saveDelivery(
          projectId,
          action,
          payload,
          current.version,
          intent.current.key,
        ),
      );
    } catch (failure) {
      setError((failure as Error).message);
      throw failure;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="delivery-task-detail">
      <EventReceiptReturn
        projectId={projectId}
        disabled={executionExit.pending || busy}
      />
      {query.isPending && <Skeleton active paragraph={{ rows: 3 }} />}
      {query.error && (
        <Alert
          type="error"
          showIcon
          title={t("deliveryManualReview.readFailed")}
          description={query.error.message}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              {t("deliveryManualReview.retry")}
            </Button>
          }
        />
      )}
      {error && <Alert type="error" role="alert" title={error} />}
      {expectedRequirementId &&
        query.data &&
        query.data.task.req_id !== expectedRequirementId && (
          <Alert
            type="warning"
            title={t("deliveryQuery.relationChanged")}
            action={
              <Button
                href={manualTaskHref(
                  query.data.task,
                  `#/dev-flow?project_id=${encodeURIComponent(projectId)}`,
                )}
              >
                {query.data.requirement?.title ||
                  t("deliveryTaskAcceptance.details")}
              </Button>
            }
          />
        )}
      {executionExit.blocked && (
        <Alert
          type="warning"
          role="status"
          title={t("deliveryExecutionRuntime.pendingNavigation")}
        />
      )}
      <TaskDetailContent
        detail={query.data}
        pinnedDetail={executionPinnedWorkspace || pinnedWorkspace}
        taskId={taskId}
        sessionId={sessionId}
        onSaved={saved}
        canEdit={
          Boolean((pinnedWorkspace || query.data)?.permissions.write) &&
          !query.isError &&
          !busy
        }
        executionBlocked={executionExit.pending}
        onEditingChange={editingChanged}
        onCommand={command}
        onUnresolvedChange={(value) => {
          const pending = executionExit.setPending(
            `execution:${taskId}`,
            value,
          );
          const latest = latestWorkspace.current;
          if (pending && latest)
            setExecutionPinnedWorkspace(
              (previous) => previous || structuredClone(latest),
            );
          else if (!pending) setExecutionPinnedWorkspace(undefined);
          onUnresolvedChange?.(pending);
        }}
      />
      <DeliveryManualReviewPanel
        key={`${projectId}:${sessionId}:${taskId}`}
        projectId={projectId}
        sessionId={sessionId}
        taskId={taskId}
        disabled={executionExit.pending || busy}
        onSaved={saved}
        onEditingChange={editingChanged}
        onUnresolvedChange={(value) => {
          const pending = executionExit.setPending(`manual:${taskId}`, value);
          const latest = latestWorkspace.current;
          if (pending && latest)
            setExecutionPinnedWorkspace(
              (previous) => previous || structuredClone(latest),
            );
          else if (!pending) setExecutionPinnedWorkspace(undefined);
          onUnresolvedChange?.(pending);
        }}
      />
    </div>
  );
}
