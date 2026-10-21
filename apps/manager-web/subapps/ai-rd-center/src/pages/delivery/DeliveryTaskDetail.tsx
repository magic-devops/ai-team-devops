import { EventReceiptReturn } from "@/components/EventReceiptReturn";
import {
  fetchDeliveryTaskData,
  invalidateDeliveryQueries,
} from "@/lib/deliveryQuery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Select, Skeleton, Tag } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
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
import { executionDispatchRecoveryPending, useExecutionDispatchCommand, type ExecutionDispatchCommand } from "@/lib/executionDispatchCommand";
import { ExecutionQueueRecovery } from "./ExecutionQueueRecovery";
import { ExecutionOperationRecovery, executionOperationPending } from "./ExecutionOperationRecovery";
import { TaskExecutionHandoffRecovery } from "./TaskExecutionHandoffRecovery";
import { DeliveryTaskSubmissionPanel } from "./DeliveryTaskSubmissionPanel";
import { externalDeliveryRecoveryPending } from "@/lib/deliveryTaskSubmission";
import { designRecoveryPending } from "@/lib/designCommand";
import { DeliveryDesignContextPanel } from "./DeliveryDesignContextPanel";
import { ExternalWorkOrderPanel } from "@/components/ExternalWorkOrderPanel";
import { workOrderRecoveryPending } from "@/lib/externalWorkOrderCommand";
import { selectedTaskWorkOrder } from "@/lib/externalWorkOrderRoute";
import { deliveryDraftCopy } from "@/i18n/delivery-drafts";
import { taskDefinitionCopy } from "@/i18n/task-definition";
import { taskEditRecoveryPending, useTaskEditCommand, validTaskEditOriginal } from "@/lib/taskEditCommand";
import { taskDefinitionRequest, taskDefinitionRouteClosedEvent } from "@/lib/taskDefinitionRoute";
import { DeliveryTaskDefinitionHost } from "./DeliveryTaskDefinitionHost";

type TaskDraftScope = "execution" | "planning" | "work-order" | "design" | "submission" | "manual";
type TaskPendingScope = "execution" | "planning" | "collaboration";

type TaskContentProps = {
  detail?: DeliveryTaskData;
  pinnedDetail?: DeliveryTaskData;
  taskId: string;
  sessionId?: string;
  canEdit: boolean;
  executionBlocked?: boolean;
  onSaved: (workspace: DeliveryCommandAck) => void;
  onEditingChange: (scope: "execution" | "planning", editing: boolean) => void;
  onCommand?: (
    action: DeliveryAction,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onUnresolvedChange?: (value: boolean, scope?: TaskPendingScope) => void;
  queueCommand?: ExecutionDispatchCommand;
  isActive?: () => boolean;
  canSubmitQueue?: () => boolean;
  onExecutionRecovery?: (executionId: string) => void;
  onEditTask?: () => void;
  shortcutBlocked?: boolean;
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
  queueCommand,
  isActive,
  canSubmitQueue,
  onExecutionRecovery,
  onEditTask,
  shortcutBlocked = false,
}: TaskContentProps) {
  const { t } = useTranslation();
  const executionEditingChanged = (editing: boolean) => onEditingChange("execution", editing);
  const background = typeof location === "undefined" ? "" : location.hash;
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
      onEditingChange={executionEditingChanged}
      onUnresolvedChange={(value) => onUnresolvedChange?.(value, "execution")}
      queueCommand={queueCommand}
      isActive={isActive}
      canSubmitQueue={canSubmitQueue}
      onExecutionRecovery={onExecutionRecovery}
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
        <Button type="link" size="small" href={manualTaskHref(task, background, data.project.id)}>
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
            disabled={!editable || !onCommand || stageLocked || !task.basis || shortcutBlocked}
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
            disabled={!editable || !onCommand || stageLocked || !task.basis || shortcutBlocked}
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
              void command("task.update", { id: task.id, task_basis: task.basis, status }).catch(
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
        onUnresolvedChange={(value) => onUnresolvedChange?.(value, "collaboration")}
      />
      <DeliveryTaskPlanMaintenance
        task={task}
        data={data}
        onTask={(dependency) => {
          location.hash = manualTaskHref(dependency, background, data.project.id);
        }}
        canEdit={editable && !stageLocked && Boolean(onEditTask)}
        onEdit={onEditTask || (() => {})}
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
  onDefinitionPending,
  onDraftChange,
  onRecoveryIdentity,
  isActive: parentIsActive,
}: {
  projectId: string;
  sessionId: string;
  taskId: string;
  expectedRequirementId?: string;
  queryGeneration?: number | null;
  onUnresolvedChange?: (value: boolean) => void;
  onDefinitionPending?: (value: boolean) => void;
  onDraftChange?: (value: boolean) => void;
  onRecoveryIdentity?: (executionId: string) => void;
  isActive?: () => boolean;
}) {
  const { t, i18n } = useTranslation();
  const draftCopy = deliveryDraftCopy(i18n?.language);
  const qc = useQueryClient();
  const origin = useRef(projectSessionKey());
  const mounted = useRef(true), identity = `${projectId}:${sessionId}:${taskId}`, activeIdentity = useRef(identity);
  const parentAccess = useRef(parentIsActive); parentAccess.current = parentIsActive;
  activeIdentity.current = identity;
  const isActive = () => mounted.current && origin.current === projectSessionKey() && activeIdentity.current === identity && parentAccess.current?.() !== false;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const executionExit = useExecutionExitGuard();
  const pendingSources = useRef(new Set<string>());
  const setTaskPending = (source: string, value: boolean) => {
    if (value) pendingSources.current.add(source); else pendingSources.current.delete(source);
    return executionExit.setPending(source, value);
  };
  const notifyTaskPending = (_aggregate: boolean) => {
    if (origin.current !== projectSessionKey() || activeIdentity.current !== identity) return;
    // Definition originals transfer to the same parent slot as their independent recovery owner.
    onUnresolvedChange?.([...pendingSources.current].some((source) => source !== `planning:${taskId}`));
  };
  const draftExit = useExecutionExitGuard();
  const draftActive = useRef(false), draftNotify = useRef(onDraftChange); draftNotify.current = onDraftChange;
  const externalPending = useRef(externalDeliveryRecoveryPending(projectId, taskId));
  const hasExternalPending = () => externalPending.current || externalDeliveryRecoveryPending(projectId, taskId);
  const designPending = useRef(designRecoveryPending(projectId, { kind: "task", id: taskId }));
  const hasDesignPending = () => designPending.current || designRecoveryPending(projectId, { kind: "task", id: taskId });
  const workOrderPending = useRef(workOrderRecoveryPending(projectId, taskId));
  const hasWorkOrderPending = () => workOrderPending.current || workOrderRecoveryPending(projectId, taskId);
  const taskEditPending = useRef(taskEditRecoveryPending(projectId, taskId));
  const hasTaskEditPending = () => taskEditPending.current || taskEditRecoveryPending(projectId, taskId);
  const selectedWorkOrderId = selectedTaskWorkOrder(typeof location === "undefined" ? "" : location.hash, projectId, taskId);
  const workOrderParams = new URLSearchParams(typeof location === "undefined" ? "" : location.hash.split("?")[1]);
  const invalidWorkOrderSelection = workOrderParams.has("work_order_id") && !selectedWorkOrderId;
  const [reportRequest, setReportRequest] = useState(() => selectedWorkOrderId && workOrderParams.getAll("delivery_report").length === 1 && workOrderParams.get("delivery_report") === "1" ? 1 : 0);
  const [reportOrder, setReportOrder] = useState<{ id: string; order_revision?: number } | undefined>(() => selectedWorkOrderId ? { id: selectedWorkOrderId } : undefined);
  const editRouteSignature = () => {
    const request = taskDefinitionRequest(typeof location === "undefined" ? "" : location.hash, projectId, taskId);
    return request.open ? JSON.stringify(request.source || null) : "";
  };
  const [editRequest, setEditRequest] = useState(() => editRouteSignature() ? 1 : 0);
  const editSignature = useRef(editRouteSignature()), observedTaskHash = useRef(typeof location === "undefined" ? "" : location.hash);
  const [, renderTaskRoute] = useState(0);
  useEffect(() => {
    const changed = () => {
      if (!mounted.current || origin.current !== projectSessionKey() || activeIdentity.current !== identity || observedTaskHash.current === location.hash) return;
      observedTaskHash.current = location.hash;
      const next = editRouteSignature();
      if (next && next !== editSignature.current) setEditRequest((value) => value + 1);
      editSignature.current = next;
      renderTaskRoute((value) => value + 1);
    };
    for (const event of ["hashchange", "popstate", taskDefinitionRouteClosedEvent]) window.addEventListener(event, changed);
    return () => { for (const event of ["hashchange", "popstate", taskDefinitionRouteClosedEvent]) window.removeEventListener(event, changed); };
  }, [projectId, sessionId, taskId]);
  const [pinnedWorkspace, setPinnedWorkspace] = useState<DeliveryTaskData>();
  const [executionPinnedWorkspace, setExecutionPinnedWorkspace] =
    useState<DeliveryTaskData>();
  const [busy, setBusy] = useState(false);
  const writePending = useRef(false);
  const [error, setError] = useState("");
  const latestWorkspace = useRef<DeliveryTaskData>();
  const knownExecution = useRef("");
  const knownExecutionIdentity = useRef(identity);
  const [operationRecoveryId, setOperationRecoveryId] = useState("");
  const operationRecoveryLive = useRef(operationRecoveryId);
  const taskAccess = useRef({ error: false, write: false });
  const canUseQueueEditor = () => isActive() && !writePending.current && !operationRecoveryLive.current &&
    !taskAccess.current.error && taskAccess.current.write &&
    !hasExternalPending() && !hasDesignPending() && !hasWorkOrderPending() && !hasTaskEditPending() && executionExit.canNavigate() &&
    !(knownExecution.current && executionOperationPending(projectId, knownExecution.current));
  const canWriteChild = () => canUseQueueEditor() && !queueLocked && ["idle", "refused"].includes(queueCommand.snapshot().phase) &&
    !executionDispatchRecoveryPending(projectId, "execution.queue", taskId);
  const canWriteExternal = () => isActive() && !writePending.current && !operationRecoveryLive.current && !hasExternalPending() && !hasDesignPending() && !hasWorkOrderPending() && !hasTaskEditPending() &&
    !queueLocked && ["idle", "refused"].includes(queueCommand.snapshot().phase) && !executionDispatchRecoveryPending(projectId, "execution.queue", taskId) &&
    !(knownExecution.current && executionOperationPending(projectId, knownExecution.current)) && executionExit.canNavigate();
  const queuePending = (value: boolean) => {
    const pending = setTaskPending(`queue:${taskId}`, value || executionDispatchRecoveryPending(projectId, "execution.queue", taskId));
    const latest = latestWorkspace.current;
    if (pending && latest) setExecutionPinnedWorkspace((previous) => previous || structuredClone(latest));
    else if (!pending) setExecutionPinnedWorkspace(undefined);
    notifyTaskPending(pending);
  };
  const queueCommand = useExecutionDispatchCommand(projectId, "execution.queue", taskId, sessionId, queuePending);
  const taskEditCommand = useTaskEditCommand(projectId, taskId, sessionId, (value) => {
    if (origin.current !== projectSessionKey() || activeIdentity.current !== identity) return;
    taskEditPending.current = value || taskEditRecoveryPending(projectId, taskId);
    onDefinitionPending?.(taskEditPending.current);
    const pending = setTaskPending(`planning:${taskId}`, taskEditPending.current), latest = latestWorkspace.current;
    if (pending && latest) setExecutionPinnedWorkspace((previous) => previous || structuredClone(latest));
    else if (!pending) setExecutionPinnedWorkspace(undefined);
    notifyTaskPending(pending);
  });
  const queueLocked = !["idle", "refused"].includes(queueCommand.state.phase) || executionDispatchRecoveryPending(projectId, "execution.queue", taskId);
  useEffect(() => {
    queuePending(queueLocked);
    return () => { setTaskPending(`queue:${taskId}`, false); };
  }, [queueLocked]);
  const editingChanged = useCallback((scope: TaskDraftScope, editing: boolean) => {
    if (!mounted.current || origin.current !== projectSessionKey() || activeIdentity.current !== identity || editing && parentAccess.current?.() === false) return;
    const pending = draftExit.setPending(`${identity}:${scope}`, editing);
    draftActive.current = pending;
    if (pending) {
      const current = latestWorkspace.current;
      if (current)
        setPinnedWorkspace((previous) => previous || structuredClone(current));
    } else setPinnedWorkspace(undefined);
    draftNotify.current?.(pending);
  }, [identity, draftExit.setPending]);
  const draftCallbacks = useMemo(() => ({
    workOrder: (editing: boolean) => editingChanged("work-order", editing),
    design: (editing: boolean) => editingChanged("design", editing),
    submission: (editing: boolean) => editingChanged("submission", editing),
    manual: (editing: boolean) => editingChanged("manual", editing),
    planning: (editing: boolean) => editingChanged("planning", editing),
  }), [editingChanged]);
  useEffect(() => {
    draftNotify.current?.(draftActive.current);
    return () => draftNotify.current?.(false);
  }, [identity]);
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
  taskAccess.current = { error: Boolean(query.error), write: Boolean(query.data?.permissions.write) };
  const sameExecutionHost = knownExecutionIdentity.current === identity;
  const currentExecutionId = !query.error ? query.data?.task.execution_id : executionPinnedWorkspace?.task.execution_id;
  if (sameExecutionHost && currentExecutionId && (!knownExecution.current || !executionOperationPending(projectId, knownExecution.current))) knownExecution.current = currentExecutionId;
  const failedReadRecoveryId = query.error && sameExecutionHost && !queueLocked && knownExecution.current && executionOperationPending(projectId, knownExecution.current) ? knownExecution.current : "";
  const displayedOperationRecovery = sameExecutionHost ? operationRecoveryId || failedReadRecoveryId : "";
  operationRecoveryLive.current = displayedOperationRecovery;
  useEffect(() => {
    if (!sameExecutionHost) { knownExecutionIdentity.current = identity; knownExecution.current = ""; operationRecoveryLive.current = ""; setOperationRecoveryId(""); }
  }, [identity, sameExecutionHost]);
  useEffect(() => { if (failedReadRecoveryId && !operationRecoveryId) setOperationRecoveryId(failedReadRecoveryId); }, [failedReadRecoveryId, operationRecoveryId]);
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
      "delivery-task-submission-current",
      "delivery-task-submission",
      "delivery-task-submissions",
      "delivery-design-current",
    ])
      void qc.invalidateQueries({ queryKey: [name] });
  };
  const rememberRecovery = (executionId: string) => {
    if (!isActive() || !executionOperationPending(projectId, executionId)) return;
    knownExecution.current = executionId;
    onRecoveryIdentity?.(executionId);
  };
  async function command(
    action: DeliveryAction,
    payload: Record<string, unknown>,
  ) {
    const current = qc.getQueryData<DeliveryTaskData>(key);
    if (
      !current || taskEditCommand.snapshot().phase !== "idle" ||
      Boolean(current.requirement && ["release", "operations"].includes(current.requirement.flow.stage)) ||
      writePending.current || busy ||
      query.isError || taskAccess.current.error || !taskAccess.current.write ||
      !["idle", "refused"].includes(queueCommand.snapshot().phase) ||
      executionDispatchRecoveryPending(projectId, "execution.queue", taskId) ||
      Boolean(operationRecoveryLive.current) ||
      Boolean(knownExecution.current && executionOperationPending(projectId, knownExecution.current)) ||
      hasExternalPending() || hasDesignPending() || hasWorkOrderPending() || hasTaskEditPending() ||
      executionExit.pending || queueLocked || !executionExit.canNavigate() || !isActive()
    )
      throw new Error(t("deliveryTaskAcceptance.readonly"));
    writePending.current = true;
    setBusy(true);
    setError("");
    try {
      const original = { action, payload, intent: { version: current.version, key: crypto.randomUUID() } };
      if (!validTaskEditOriginal(original, taskId)) throw new Error(t("deliveryTaskAcceptance.readonly"));
      if (taskEditCommand.snapshot().phase !== "idle") return;
      await taskEditCommand.run(original);
      const confirmed = taskEditCommand.snapshot();
      if (taskEditCommand.current() && confirmed.phase === "succeeded" && confirmed.ack) {
        taskEditCommand.reset();
        if (taskEditCommand.snapshot().phase === "idle") saved(confirmed.ack);
      }
    } catch (failure) {
      if (isActive()) setError((failure as Error).message);
      throw failure;
    } finally {
      writePending.current = false;
      if (isActive()) setBusy(false);
    }
  }
  const definitionStageLocked = Boolean(query.data?.requirement && ["release", "operations"].includes(query.data.requirement.flow.stage));
  const definitionRelationChanged = Boolean(expectedRequirementId && query.data && query.data.task.req_id !== expectedRequirementId);
  return (
    <div className="delivery-task-detail">
      <ExecutionQueueRecovery command={queueCommand} projectId={projectId} taskId={taskId} onSaved={saved} isActive={isActive} />
      {query.error && !queueLocked && !displayedOperationRecovery && !(knownExecution.current && executionOperationPending(projectId, knownExecution.current)) && <TaskExecutionHandoffRecovery
        key={`${projectId}:${sessionId}:${taskId}`} projectId={projectId} taskId={taskId} sessionId={sessionId} isActive={() => isActive() && taskAccess.current.error}
        onLocated={(executionId) => {
          if (!isActive() || !taskAccess.current.error || !["idle", "refused"].includes(queueCommand.snapshot().phase) || executionDispatchRecoveryPending(projectId, "execution.queue", taskId) || !executionOperationPending(projectId, executionId)) return;
          rememberRecovery(executionId); operationRecoveryLive.current = executionId; setOperationRecoveryId(executionId);
          notifyTaskPending(setTaskPending(`execution:${taskId}`, true));
        }} />}
      {displayedOperationRecovery && <ExecutionOperationRecovery key={`${projectId}:${sessionId}:${displayedOperationRecovery}`} projectId={projectId} executionId={displayedOperationRecovery} sessionId={sessionId}
        isActive={() => isActive() && operationRecoveryLive.current === displayedOperationRecovery} onSaved={saved}
        onUnresolvedChange={(value) => {
          const retained = executionOperationPending(projectId, displayedOperationRecovery);
          const pending = setTaskPending(`execution:${taskId}`, value || retained);
          if (!value && !retained) { operationRecoveryLive.current = ""; setOperationRecoveryId(""); }
          notifyTaskPending(pending);
        }} />}
      <EventReceiptReturn
        projectId={projectId}
        disabled={executionExit.pending || hasExternalPending() || hasWorkOrderPending() || queueLocked || busy}
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
      {query.error && <p className="runtime-help">{t("deliveryRuntime.queueCurrentReadFailed")}</p>}
      {error && <Alert type="error" role="alert" title={error} />}
      {expectedRequirementId &&
        !query.error &&
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
      {draftExit.blocked && <Alert type="warning" role="status" title={draftCopy.navigationBlocked} />}
      <DeliveryTaskDefinitionHost projectId={projectId} taskId={taskId} sessionId={sessionId} command={taskEditCommand}
        current={query.error ? undefined : query.data} readError={query.error} requestEdit={editRequest} canEdit={Boolean(query.data?.permissions.write) && !query.isError && !busy && !definitionStageLocked && !definitionRelationChanged}
        freshBlockReason={definitionStageLocked ? taskDefinitionCopy(i18n?.language).stageLocked : definitionRelationChanged ? t("deliveryQuery.relationChanged") : undefined}
        isActive={isActive} canSubmit={canWriteExternal} onSaved={saved} onEditingChange={draftCallbacks.planning} />
      <ExternalWorkOrderPanel key={`${projectId}:${sessionId}:${taskId}:work-orders`} projectId={projectId} taskId={taskId} sessionId={sessionId} selectedOrderId={selectedWorkOrderId} invalidSelection={invalidWorkOrderSelection}
        disabled={executionExit.pending || hasExternalPending() || hasDesignPending() || queueLocked || Boolean(displayedOperationRecovery) || busy}
        isActive={() => isActive() && !writePending.current} canSubmit={canWriteExternal} onSaved={saved} onEditingChange={draftCallbacks.workOrder}
        onWriteReport={(order) => { if (isActive() && !hasWorkOrderPending() && !hasExternalPending() && !queueLocked) { setReportOrder(order); setReportRequest((value) => value + 1); } }}
        onUnresolvedChange={(value) => { workOrderPending.current = value || workOrderRecoveryPending(projectId, taskId); notifyTaskPending(setTaskPending(`work-order:${taskId}`, workOrderPending.current)); }} />
      <TaskDetailContent
        detail={query.error || displayedOperationRecovery ? undefined : query.data}
        pinnedDetail={query.error || displayedOperationRecovery ? undefined : executionPinnedWorkspace || pinnedWorkspace}
        taskId={taskId}
        sessionId={sessionId}
        onSaved={saved}
        canEdit={
          Boolean((pinnedWorkspace || query.data)?.permissions.write) &&
          !query.isError &&
          !busy
        }
        executionBlocked={executionExit.pending || hasExternalPending() || hasDesignPending() || hasWorkOrderPending() || queueLocked}
        queueCommand={queueCommand}
        isActive={() => isActive() && !writePending.current && !hasExternalPending() && !hasDesignPending() && !hasWorkOrderPending()}
        canSubmitQueue={canUseQueueEditor}
        onExecutionRecovery={rememberRecovery}
        shortcutBlocked={taskEditCommand.state.phase !== "idle"}
        onEditTask={() => { if (canWriteExternal()) setEditRequest((value) => value + 1); }}
        onEditingChange={editingChanged}
        onCommand={command}
        onUnresolvedChange={(value, scope = "execution") => {
          const retained = scope === "execution" && Boolean(knownExecution.current && executionOperationPending(projectId, knownExecution.current));
          const pending = setTaskPending(
            `${scope}:${taskId}`,
            value || retained,
          );
          const latest = latestWorkspace.current;
          if (pending && latest)
            setExecutionPinnedWorkspace(
              (previous) => previous || structuredClone(latest),
            );
          else if (!pending) setExecutionPinnedWorkspace(undefined);
          notifyTaskPending(pending);
        }}
      />
      <DeliveryDesignContextPanel key={`${projectId}:${sessionId}:${taskId}:design`} projectId={projectId} target={{ kind: "task", id: taskId }} sessionId={sessionId}
        disabled={executionExit.pending || hasExternalPending() || hasWorkOrderPending() || queueLocked || Boolean(displayedOperationRecovery) || busy}
        isActive={() => isActive() && !writePending.current} canSubmit={canWriteExternal} onSaved={saved} onEditingChange={draftCallbacks.design}
        onUnresolvedChange={(value) => { designPending.current = value || designRecoveryPending(projectId, { kind: "task", id: taskId }); notifyTaskPending(setTaskPending(`design:${taskId}`, designPending.current)); }} />
      <DeliveryTaskSubmissionPanel key={`${projectId}:${sessionId}:${taskId}:external`} projectId={projectId} taskId={taskId} sessionId={sessionId}
        disabled={executionExit.pending || hasWorkOrderPending() || queueLocked || Boolean(displayedOperationRecovery) || busy} requestCreate={reportRequest} requestWorkOrder={reportOrder}
        isActive={() => isActive() && !writePending.current} canSubmit={canWriteExternal} onSaved={saved} onEditingChange={draftCallbacks.submission}
        onUnresolvedChange={(value) => {
          externalPending.current = value || externalDeliveryRecoveryPending(projectId, taskId);
          const pending = setTaskPending(`external:${taskId}`, externalPending.current);
          notifyTaskPending(pending);
        }} />
      <DeliveryManualReviewPanel
        key={`${projectId}:${sessionId}:${taskId}`}
        projectId={projectId}
        sessionId={sessionId}
        taskId={taskId}
        disabled={executionExit.pending || hasExternalPending() || hasDesignPending() || hasWorkOrderPending() || queueLocked || Boolean(displayedOperationRecovery) || busy || query.isError}
        canSubmit={canWriteChild}
        onSaved={saved}
        onEditingChange={draftCallbacks.manual}
        onUnresolvedChange={(value) => {
          const pending = setTaskPending(`manual:${taskId}`, value);
          const latest = latestWorkspace.current;
          if (pending && latest)
            setExecutionPinnedWorkspace(
              (previous) => previous || structuredClone(latest),
            );
          else if (!pending) setExecutionPinnedWorkspace(undefined);
          notifyTaskPending(pending);
        }}
      />
    </div>
  );
}
