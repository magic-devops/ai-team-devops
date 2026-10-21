import { Button } from "antd";
import { useTranslation } from "react-i18next";
import type { DeliveryTask, DeliveryTaskData } from "@/lib/delivery";
import { allocationSummary, parseSchedulingRoute, schedulingHash } from "@/lib/deliveryScheduling";
import { DeliveryTaskPlanning } from "./DeliveryTaskPlanning";

/** Planning facts delegate definition edits to the Task's single durable owner. */
export function DeliveryTaskPlanMaintenance({ task, data, onTask, canEdit, onEdit }: {
  task: DeliveryTask;
  data: DeliveryTaskData;
  onTask: (task: Pick<DeliveryTask, "id" | "req_id">) => void;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  return <>
    <DeliveryTaskPlanning task={task} requirement={data.requirement || undefined} data={data} onTask={onTask} onEdit={onEdit} canEdit={canEdit && Boolean(task.basis)} />
    <div className="delivery-task-reservation-link">
      <Button type="link" size="small" disabled={!canEdit} onClick={() => {
        location.hash = schedulingHash({ ...parseSchedulingRoute(location.hash), view: "timeline", timelineMode: "dependencies", editTaskId: task.id });
      }}>{t("deliverySchedule.adjustTask")}</Button>
      <p className="delivery-schedule-multiline">{allocationSummary(task.planning?.allocations || [], data.members, t)}</p>
    </div>
  </>;
}
