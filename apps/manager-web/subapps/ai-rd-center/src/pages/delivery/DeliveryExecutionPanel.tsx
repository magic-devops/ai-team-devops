import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Collapse, Skeleton } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import {
  fetchDeliveryTargets,
  type DeliveryAction,
  type DeliveryTask,
  type DeliveryWorkspace,
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
  data: DeliveryWorkspace;
  task: DeliveryTask;
  onCommand: (
    action: DeliveryAction,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onSaved: (data: DeliveryWorkspace) => void;
  onEditingChange?: (editing: boolean) => void;
  disabled?: boolean;
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
  const executions = (data.executions || [])
    .filter((entry) => entry.task_id === task.id)
    .slice()
    .reverse();
  const current = executions[0];
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
    data.permissions.write &&
    targets.data?.can_execute &&
    !targets.isError &&
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
      {executions.length > 1 && (
        <Collapse
          size="small"
          ghost
          items={[
            {
              key: "history",
              label: `${tr("history")} · ${executions.length - 1}`,
              children: executions
                .slice(1)
                .map((entry) => (
                  <ExecutionObservationCard
                    key={`${data.project.id}:${sessionId}:${entry.id}`}
                    entry={entry}
                    projectId={data.project.id}
                    active={false}
                    onCommand={onCommand}
                  />
                )),
            },
          ]}
        />
      )}
      {draft && targets.data && (
        <ExecutionPlanEditor
          members={data.members} sessionId={sessionId}
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
