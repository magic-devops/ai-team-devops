import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Skeleton } from "antd";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchDelivery, type DeliveryWorkspace } from "@/lib/delivery";
import { manualTaskHref } from "@/lib/deliveryTaskReview";
import { DeliveryManualReviewPanel } from "./DeliveryManualReviewPanel";
import { DeliveryTaskPlanMaintenance } from "./DeliveryTaskPlanMaintenance";

export function TaskDetailContent({
  workspace,
  pinnedWorkspace,
  taskId,
  canEdit,
  onSaved,
  onEditingChange,
}: {
  workspace?: DeliveryWorkspace;
  pinnedWorkspace?: DeliveryWorkspace;
  taskId: string;
  canEdit: boolean;
  onSaved: (workspace: DeliveryWorkspace) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const data = pinnedWorkspace || workspace;
  const task = data?.tasks.find((item) => item.id === taskId);
  if (!data || !task) return null;
  return (
    <>
      <div className="delivery-manual-heading">
        <h3>{task.title}</h3>
        {task.req_id && (
          <Button type="link" size="small" href={manualTaskHref(task)}>
            {t("deliveryManualReview.openTaskPlan")}
          </Button>
        )}
      </div>
      <small className="delivery-manual-identity">{task.id}</small>
      <p className="delivery-manual-content">{task.description}</p>
      <DeliveryTaskPlanMaintenance
        task={task}
        data={data}
        onTask={(dependency) => {
          location.hash = manualTaskHref(dependency);
        }}
        onSaved={onSaved}
        canEdit={canEdit}
        onEditingChange={onEditingChange}
      />
    </>
  );
}

export function DeliveryTaskDetail({
  projectId,
  sessionId,
  taskId,
}: {
  projectId: string;
  sessionId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pinnedWorkspace, setPinnedWorkspace] = useState<DeliveryWorkspace>();
  const latestWorkspace = useRef<DeliveryWorkspace>();
  const editingChanged = useCallback((editing: boolean) => {
    if (editing) {
      const current = latestWorkspace.current;
      if (current)
        setPinnedWorkspace((previous) => previous || structuredClone(current));
    } else setPinnedWorkspace(undefined);
  }, []);
  const key = ["delivery", projectId, sessionId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchDelivery(projectId, signal),
    gcTime: 0,
    enabled: !pinnedWorkspace,
  });
  latestWorkspace.current = query.data;
  const saved = (workspace: DeliveryWorkspace) => {
    qc.setQueryData(key, workspace);
    for (const name of [
      "delivery-task-reviews",
      "delivery-inbox",
      "delivery-progress",
      "tasks",
      "tasksSummary",
      "taskDependencies",
    ])
      void qc.invalidateQueries({ queryKey: [name] });
  };
  return (
    <div className="delivery-task-detail">
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
      <TaskDetailContent
        workspace={query.data}
        pinnedWorkspace={pinnedWorkspace}
        taskId={taskId}
        onSaved={saved}
        canEdit={
          Boolean((pinnedWorkspace || query.data)?.permissions.write) &&
          !query.isError
        }
        onEditingChange={editingChanged}
      />
      <DeliveryManualReviewPanel
        projectId={projectId}
        sessionId={sessionId}
        taskId={taskId}
        onSaved={saved}
        onEditingChange={editingChanged}
      />
    </div>
  );
}
