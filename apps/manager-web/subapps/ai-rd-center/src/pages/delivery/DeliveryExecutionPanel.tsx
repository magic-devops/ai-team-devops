import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Collapse, Skeleton } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import {
  fetchDeliveryTargets,
  type DeliveryAction,
  type DeliveryRequirement,
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
  requirement: DeliveryRequirement;
  onCommand: (
    action: DeliveryAction,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onSaved: (data: DeliveryWorkspace) => void;
  onEditingChange?: (editing: boolean) => void;
};
const closed = ["accepted", "changes_requested", "cancelled"];

export function DeliveryExecutionPanel({
  data,
  task,
  requirement,
  onCommand,
  onSaved,
  sessionId,
  onEditingChange,
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
  const canDispatch =
    data.permissions.write &&
    targets.data?.can_execute &&
    !targets.isError &&
    task.status !== "completed" &&
    !task.dependency_blocked?.length &&
    !task.planning?.blocked_reason &&
    !requirement.flow.blocked_reason &&
    !["testing", "acceptance", "release", "operations"].includes(
      requirement.flow.stage,
    ) &&
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
          initial={draft}
          initialTargets={structuredClone(targets.data)}
          canConfigure={
            data.permissions.configure && targets.data.can_configure_policy
          }
          onClose={() => setDraft(undefined)}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}
