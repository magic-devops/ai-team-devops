import { taskDispatchCopy } from "@/i18n/task-dispatch";
import {
  fetchDeliveryReferences,
  fetchExecutionDetail,
} from "@/lib/deliveryQuery";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Alert, Button, Collapse, Skeleton } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import {
  fetchDeliveryTargets,
  type DeliveryAction,
  type DeliveryTask,
  type DeliveryTaskData,
  type DeliveryCommandAck,
  type DeliveryExecution,
} from "@/lib/delivery";
import {
  openExecutionDraft,
  type ExecutionDraftSession,
} from "@/lib/deliveryExecution";
import { ExecutionPlanEditor } from "./ExecutionPlanEditor";
import { ExecutionObservationCard } from "./ExecutionObservationCard";
import "./delivery-runtime.css";
import type { ExecutionDispatchCommand } from "@/lib/executionDispatchCommand";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { ExecutionOperationRecovery, executionOperationPending } from "./ExecutionOperationRecovery";
import { useExecutionHandoffQuery } from "@/lib/executionHandoff";
import { useDeliveryDraftState } from "@/lib/useDeliveryDraftState";

type Props = {
  sessionId: string;
  data: DeliveryTaskData;
  task: DeliveryTask;
  onCommand: (
    action: DeliveryAction,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onSaved: (data: DeliveryCommandAck) => void;
  onEditingChange?: (editing: boolean) => void;
  disabled?: boolean;
  onUnresolvedChange?: (value: boolean) => void;
  queueCommand?: ExecutionDispatchCommand;
  isActive?: () => boolean;
  canSubmitQueue?: () => boolean;
  onDispatch?: () => void;
  onExecutionRecovery?: (executionId: string) => void;
};
const closed = ["accepted", "changes_requested", "cancelled"];

export function DeliveryExecutionPanel({
  data,
  task,
  onCommand,
  onSaved,
  sessionId,
  onEditingChange,
  disabled = false,
  onUnresolvedChange,
  queueCommand,
  isActive,
  canSubmitQueue,
  onDispatch,
  onExecutionRecovery,
}: Props) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryRuntime.${key}`);
  const origin = useRef(projectSessionKey());
  const identity = `${data.project.id}:${sessionId}:${task.id}`, live = useRef({ identity, executionId: task.execution_id || "", isActive });
  live.current = { identity, executionId: task.execution_id || "", isActive };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const activeTask = () => mounted.current && origin.current === projectSessionKey() && live.current.identity === identity && live.current.isActive?.() !== false;
  const [recoveryId, setRecoveryId] = useState(() => task.execution_id && executionOperationPending(data.project.id, task.execution_id) ? task.execution_id : "");
  const recoveryIdentity = useRef(identity), recoveryLive = useRef(recoveryId);
  recoveryLive.current = recoveryIdentity.current === identity ? recoveryId : "";
  const targets = useQuery({
    queryKey: ["delivery-targets", data.project.id, sessionId],
    queryFn: ({ signal }) => fetchDeliveryTargets(data.project.id, signal),
    gcTime: 0,
    retry: false,
  });
  const [draft, setDraft] = useDeliveryDraftState<ExecutionDraftSession | undefined>(undefined, onEditingChange);
  const [historyId, setHistoryId] = useState("");
  const [controlLocked, setControlLocked] = useState(false);
  const pendingControls = useRef(new Set<string>());
  const knownPendingExecution = useRef("");
  const controlPending = (id: string, value: boolean) => {
    if (!activeTask()) return;
    const retained = value || id !== "queue" && executionOperationPending(data.project.id, id);
    if (retained && id !== "queue") {
      knownPendingExecution.current = id;
      onExecutionRecovery?.(id);
    } else if (knownPendingExecution.current === id) knownPendingExecution.current = "";
    if (retained) pendingControls.current.add(id);
    else pendingControls.current.delete(id);
    const pending = pendingControls.current.size > 0;
    setControlLocked(pending);
    onUnresolvedChange?.(pending);
  };
  const currentQuery = useQuery({
    queryKey: [
      "delivery-execution-exact",
      data.project.id,
      sessionId,
      task.execution_id,
    ],
    queryFn: ({ signal }) =>
      fetchExecutionDetail(data.project.id, task.execution_id!, signal),
    enabled: Boolean(task.execution_id) && !recoveryId,
    retry: false,
    gcTime: 0,
    refetchInterval: controlLocked ? false : 5000,
  });
  useEffect(() => {
    if (recoveryIdentity.current !== identity) {
      recoveryIdentity.current = identity;
      knownPendingExecution.current = "";
      pendingControls.current.clear();
      setHistoryId("");
      setControlLocked(false);
      setRecoveryId(task.execution_id && executionOperationPending(data.project.id, task.execution_id) ? task.execution_id : "");
    }
  }, [identity, task.execution_id]);
  const history = useInfiniteQuery({
    queryKey: ["delivery-task-executions", data.project.id, sessionId, task.id],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      fetchDeliveryReferences<
        Pick<DeliveryExecution, "id" | "status" | "created_at" | "attempt">
      >(
        data.project.id,
        "execution",
        {
          task_id: task.id,
          limit: 20,
          sort: "created_desc",
          cursor: pageParam,
        },
        signal,
      ),
    getNextPageParam: (page) => page.next_cursor || undefined,
    retry: false,
    gcTime: 0,
  });
  const executions =
    !history.error && history.data?.pages
      .flatMap((page) => page.items.map((item) => item.data))
      .filter((entry) => entry.id !== task.execution_id) || [];
  const current = currentQuery.error ? undefined : currentQuery.data?.execution;
  const freshReads = useRef({ error: false }); freshReads.current = { error: Boolean(currentQuery.error || targets.error) };
  const handoff = useExecutionHandoffQuery(data.project.id, current?.id || task.execution_id || "", task.id, sessionId, Boolean(current?.handoff_id), activeTask);
  const handoffAccess = useRef(handoff); handoffAccess.current = handoff;
  const canReplaceHandoff = () => !handoffAccess.current.required || handoffAccess.current.readable &&
    ["planned", "cancelled"].includes(handoffAccess.current.value?.handoff.state || "");
  // Keep only an execution actually selected or reported by a mounted card.
  // A refresh may remove its row even when the list request itself succeeds.
  const knownExecutionId = recoveryIdentity.current === identity ? knownPendingExecution.current || historyId : "";
  const knownExecutionVisible = current?.id === knownExecutionId ||
    historyId === knownExecutionId && executions.some((entry) => entry.id === knownExecutionId);
  const missingKnownRecovery = knownExecutionId && !knownExecutionVisible &&
    executionOperationPending(data.project.id, knownExecutionId) ? knownExecutionId : "";
  const readFailureRecovery = currentQuery.error && task.execution_id &&
    executionOperationPending(data.project.id, task.execution_id) ? task.execution_id : "";
  const recoveryCandidate = missingKnownRecovery || readFailureRecovery;
  const retainedExecutionId = recoveryLive.current || recoveryCandidate;
  recoveryLive.current = retainedExecutionId;
  useEffect(() => { if (recoveryCandidate && !recoveryId) setRecoveryId(recoveryCandidate); }, [recoveryCandidate, recoveryId]);
  const gateReasons = task.execution_gate.reasons.map((reason) =>
    !task.req_id && reason.code === "task_dispatch_stage_blocked"
      ? t("deliveryTaskAcceptance.standaloneStageBlocked")
      : t(`deliveryTaskAcceptance.reasons.${reason.code}`, {
          defaultValue: reason.message,
        }),
  );
  const compactGate =
    (task.status === "completed" || current?.status === "accepted") &&
    !current?.stale &&
    task.acceptance.available &&
    task.execution_gate.reasons.length > 0 &&
    task.execution_gate.reasons.every(
      (reason) => reason.code === "task_dispatch_stage_blocked",
    );
  const canDispatch =
    !disabled &&
    !controlLocked && !retainedExecutionId &&
    Boolean(queueCommand) &&
    !queueCommand?.locked &&
    data.permissions.write &&
    targets.data?.can_execute &&
    !targets.isError &&
    !currentQuery.isError &&
    handoff.readable && canReplaceHandoff() &&
    task.execution_gate.eligible &&
    (!task.execution_id || Boolean(current && closed.includes(current.status)));
  return (
    <section
      className="delivery-executions runtime-panel"
      aria-label={tr("title")}
    >
      <div className="runtime-section-heading">
        <strong>{tr("title")}</strong>
        <Button
          size="small"
          icon={<Send size={14} />}
          disabled={onDispatch ? disabled || controlLocked || Boolean(retainedExecutionId) || !data.permissions.write || Boolean(queueCommand?.locked) : !canDispatch}
          onClick={() => {
            if (onDispatch) { if (!disabled && !controlLocked && !retainedExecutionId && data.permissions.write && origin.current === projectSessionKey() && isActive?.() !== false && canSubmitQueue?.() !== false && queueCommand?.current()) onDispatch(); return; }
            if (!canDispatch || freshReads.current.error || live.current.executionId !== (task.execution_id || "") || !handoffAccess.current.readable || !canReplaceHandoff() || pendingControls.current.size || origin.current !== projectSessionKey() || isActive?.() === false || canSubmitQueue?.() === false || !queueCommand?.current()) return;
            if (queueCommand.snapshot().phase === "refused") { queueCommand.reset(); if (queueCommand.snapshot().phase !== "idle") return; }
            if (queueCommand.snapshot().phase !== "idle") return;
            setDraft(openExecutionDraft(data, task.id, crypto.randomUUID()));
          }}
        >
          {onDispatch ? taskDispatchCopy(i18n?.language).title : tr(current ? "redispatch" : "dispatch")}
        </Button>
      </div>
      {targets.isPending && (
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      )}
      {targets.isError && (
        <Alert
          type="error"
          role="alert"
          title={targets.error.message}
          action={
            <Button size="small" onClick={() => void targets.refetch()}>
              {tr("refresh")}
            </Button>
          }
        />
      )}
      {!targets.error && targets.data && !targets.data.runtime_configured && (
        <Alert type="info" title={tr("notConfigured")} />
      )}
      {!targets.error && targets.data?.runtime_configured && !targets.data.can_execute && (
        <p className="runtime-help">{tr("noPermission")}</p>
      )}
      {!targets.error && targets.data && !targets.data.workspaces.length && (
        <p>
          {tr("noTargets")} · <a href="#/workspace">{tr("configure")}</a>
        </p>
      )}
      {!current && !retainedExecutionId && <p className="runtime-help">{tr("empty")}</p>}
      {retainedExecutionId && <ExecutionOperationRecovery key={`${identity}:${retainedExecutionId}`} projectId={data.project.id} executionId={retainedExecutionId} sessionId={sessionId}
        isActive={() => activeTask() && recoveryLive.current === retainedExecutionId} onSaved={onSaved}
        onUnresolvedChange={(value) => {
          const retained = executionOperationPending(data.project.id, retainedExecutionId);
          controlPending(retainedExecutionId, value || retained);
          if (!value && !retained) { recoveryLive.current = ""; setRecoveryId(""); }
        }} />}
      {currentQuery.error && (
        <Alert
          type="error"
          title={t("deliveryQuery.readFailed")}
          description={currentQuery.error.message}
          action={
            <Button onClick={() => void currentQuery.refetch()}>
              {t("deliveryQuery.retry")}
            </Button>
          }
        />
      )}
      {history.error && (
        <Alert
          type="error"
          title={t("deliveryQuery.readFailed")}
          description={history.error.message}
          action={
            <Button onClick={() => void history.refetch()}>
              {t("deliveryQuery.retry")}
            </Button>
          }
        />
      )}
      {!task.execution_gate.eligible && !compactGate && (
        <Alert
          type="info"
          title={t("deliveryTaskAcceptance.blocked")}
          description={
            <ul>
              {gateReasons.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          }
        />
      )}
      {current && !retainedExecutionId && (
        <>
          <h4>{tr("current")}</h4>
          <ExecutionObservationCard
            key={`${data.project.id}:${sessionId}:${current.id}`}
            entry={current}
            projectId={data.project.id}
            sessionId={sessionId}
            workspaceVersion={data.version}
            onSaved={onSaved}
            disabled={disabled || controlLocked}
            onUnresolvedChange={(value) => controlPending(current.id, value)}
            active
            isActive={() => activeTask() && live.current.executionId === current.id}
            onCommand={onCommand}
            handoffRead={handoff}
          />
        </>
      )}
      {!task.execution_gate.eligible && compactGate && (
        <p className="runtime-help task-redispatch-help">
          {gateReasons.join(" ")}
        </p>
      )}
      {executions.length > 0 && (
        <Collapse
          size="small"
          ghost
          collapsible={controlLocked ? "disabled" : undefined}
          items={[
            {
              key: "history",
              label: `${tr("history")} · ${history.data?.pages[0]?.total || executions.length}`,
              children: (
                <div className="execution-history-list">
                  {executions.map((entry) => (
                    <section key={entry.id} className="execution-history-entry">
                      <div className="runtime-section-heading">
                        <div>
                          <strong>
                            {t(`delivery.execution.states.${entry.status}`, {
                              defaultValue: entry.status,
                            })}
                          </strong>
                          <small className="runtime-identity">
                            {entry.id} · {tr("attempt")} {entry.attempt ?? "—"}{" "}
                            · {new Date(entry.created_at).toLocaleString()}
                          </small>
                        </div>
                        <Button
                          size="small"
                          disabled={controlLocked}
                          onClick={() => {
                            if (!activeTask() || pendingControls.current.size || queueCommand && !["idle", "refused"].includes(queueCommand.snapshot().phase)) return;
                            setHistoryId((selected) => selected === entry.id ? "" : entry.id);
                          }}
                        >
                          {t(
                            `deliveryExecutionRuntime.${historyId === entry.id ? "closeHistory" : "openHistory"}`,
                          )}
                        </Button>
                      </div>
                      {historyId === entry.id && !retainedExecutionId && (
                        <ExactExecutionCard
                          id={entry.id}
                          projectId={data.project.id}
                          sessionId={sessionId}
                          workspaceVersion={data.version}
                          onSaved={onSaved}
                          onCommand={onCommand}
                          disabled={disabled || controlLocked}
                          isActive={activeTask}
                          onUnresolvedChange={(value) =>
                            controlPending(entry.id, value)
                          }
                        />
                      )}
                    </section>
                  ))}
                  {history.hasNextPage && (
                    <Button
                      loading={history.isFetchingNextPage}
                      onClick={() => void history.fetchNextPage()}
                    >
                      {t("deliveryQuery.more")}
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}
      {draft && targets.data && queueCommand && (
        <ExecutionPlanEditor
          key={`${identity}:${draft.intent.key}`}
          queueCommand={queueCommand}
          isActive={activeTask}
          canSubmit={canSubmitQueue}
          onUnresolvedChange={(value) => controlPending("queue", value)}
          members={data.members}
          sessionId={sessionId}
          initial={draft}
          initialTargets={structuredClone(targets.data)}
          canConfigure={
            !disabled &&
            data.permissions.configure &&
            targets.data.can_configure_policy
          }
          onClose={() => { if (["idle", "refused"].includes(queueCommand.snapshot().phase)) setDraft(undefined); }}
          onSaved={(ack) => { if (queueCommand.snapshot().phase === "idle") setDraft(undefined); onSaved(ack); }}
        />
      )}
    </section>
  );
}

function ExactExecutionCard({
  id,
  ...props
}: Omit<Parameters<typeof ExecutionObservationCard>[0], "entry" | "active"> & {
  id: string;
}) {
  const origin = useRef(projectSessionKey()), liveId = useRef(id); liveId.current = id;
  const [recovering, setRecovering] = useState(() => executionOperationPending(props.projectId, id));
  const recoveryLive = useRef(recovering); recoveryLive.current = recovering;
  const active = () => origin.current === projectSessionKey() && liveId.current === id && props.isActive?.() !== false;
  const query = useQuery({
    queryKey: [
      "delivery-execution-exact",
      props.projectId,
      props.sessionId,
      id,
    ],
    queryFn: ({ signal }) => fetchExecutionDetail(props.projectId, id, signal),
    retry: false,
    gcTime: 0,
    enabled: !recovering,
  });
  const readFailureRecovery = Boolean(query.error && executionOperationPending(props.projectId, id));
  recoveryLive.current = recovering || readFailureRecovery;
  useEffect(() => { if (readFailureRecovery) setRecovering(true); }, [readFailureRecovery]);
  if (recovering || readFailureRecovery) return <ExecutionOperationRecovery projectId={props.projectId} executionId={id} sessionId={props.sessionId}
    isActive={() => active() && recoveryLive.current} onSaved={props.onSaved}
    onUnresolvedChange={(value) => {
      const retained = executionOperationPending(props.projectId, id);
      props.onUnresolvedChange?.(value || retained);
      if (!value && !retained) { recoveryLive.current = false; setRecovering(false); }
    }} />;
  return !query.error && query.data ? (
    <ExecutionObservationCard
      {...props}
      entry={query.data.execution}
      active={false}
      isActive={active}
    />
  ) : query.error ? (
    <Alert
      type="error"
      title={query.error.message}
      action={<Button onClick={() => void query.refetch()}>↻</Button>}
    />
  ) : (
    <Skeleton active />
  );
}
