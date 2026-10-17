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
}: Props) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRuntime.${key}`);
  const targets = useQuery({
    queryKey: ["delivery-targets", data.project.id, sessionId],
    queryFn: ({ signal }) => fetchDeliveryTargets(data.project.id, signal),
    gcTime: 0,
    retry: false,
  });
  const [draft, setDraft] = useState<ExecutionDraftSession>();
  const [historyId, setHistoryId] = useState("");
  const [controlLocked, setControlLocked] = useState(false);
  const pendingControls = useRef(new Set<string>());
  const controlPending = (id: string, value: boolean) => {
    if (value) pendingControls.current.add(id);
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
    enabled: Boolean(task.execution_id),
    retry: false,
    gcTime: 0,
    refetchInterval: controlLocked ? false : 5000,
  });
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
    history.data?.pages
      .flatMap((page) => page.items.map((item) => item.data))
      .filter((entry) => entry.id !== task.execution_id) || [];
  const current = currentQuery.data?.execution;
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
    !controlLocked &&
    data.permissions.write &&
    targets.data?.can_execute &&
    !targets.isError &&
    !currentQuery.isError &&
    task.execution_gate.eligible &&
    (!current || closed.includes(current.status));
  useEffect(() => {
    if (!draft) return;
    onEditingChange?.(true);
    return () => onEditingChange?.(false);
  }, [Boolean(draft), onEditingChange]);
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
          disabled={!canDispatch}
          onClick={() =>
            setDraft(openExecutionDraft(data, task.id, crypto.randomUUID()))
          }
        >
          {tr(current ? "redispatch" : "dispatch")}
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
      {targets.data && !targets.data.runtime_configured && (
        <Alert type="info" title={tr("notConfigured")} />
      )}
      {targets.data?.runtime_configured && !targets.data.can_execute && (
        <p className="runtime-help">{tr("noPermission")}</p>
      )}
      {targets.data && !targets.data.workspaces.length && (
        <p>
          {tr("noTargets")} · <a href="#/workspace">{tr("configure")}</a>
        </p>
      )}
      {!current && <p className="runtime-help">{tr("empty")}</p>}
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
      {current && (
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
            onCommand={onCommand}
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
                          onClick={() =>
                            setHistoryId((selected) =>
                              selected === entry.id ? "" : entry.id,
                            )
                          }
                        >
                          {t(
                            `deliveryExecutionRuntime.${historyId === entry.id ? "closeHistory" : "openHistory"}`,
                          )}
                        </Button>
                      </div>
                      {historyId === entry.id && (
                        <ExactExecutionCard
                          id={entry.id}
                          projectId={data.project.id}
                          sessionId={sessionId}
                          workspaceVersion={data.version}
                          onSaved={onSaved}
                          onCommand={onCommand}
                          disabled={disabled || controlLocked}
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
      {draft && targets.data && (
        <ExecutionPlanEditor
          members={data.members}
          sessionId={sessionId}
          initial={draft}
          initialTargets={structuredClone(targets.data)}
          canConfigure={
            !disabled &&
            data.permissions.configure &&
            targets.data.can_configure_policy
          }
          onClose={() => setDraft(undefined)}
          onSaved={onSaved}
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
  });
  return query.data ? (
    <ExecutionObservationCard
      {...props}
      entry={query.data.execution}
      active={false}
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
