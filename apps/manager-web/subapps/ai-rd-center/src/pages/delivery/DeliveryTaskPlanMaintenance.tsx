import {
  fetchDeliveryTaskData,
  type DeliveryCommandAck,
} from "@/lib/deliveryQuery";
import { useEffect, useState } from "react";
import "./delivery-scheduling.css";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  prepareDeliveryIntent,
  saveDelivery,
  type DeliveryIntent,
  type DeliveryTask,
  type DeliveryTaskData,
} from "@/lib/delivery";
import {
  adoptTaskEdit,
  openTaskEdit,
  taskEditPayload,
} from "@/lib/deliveryTaskEditing";
import { planError, remapCriterionIndexes } from "@/lib/deliveryTaskPlan";
import {
  DeliveryEditor,
  type EditorField,
  type EditorSpec,
} from "./DeliveryEditor";
import { DeliveryTaskPlanning } from "./DeliveryTaskPlanning";
import { Button } from "antd";
import { useMemberIdentity } from "@/components/DeliveryMemberIdentity";
import {
  allocationSummary,
  parseSchedulingRoute,
  schedulingHash,
} from "@/lib/deliveryScheduling";

export function DeliveryTaskPlanMaintenance({
  task,
  data,
  onTask,
  onSaved,
  canEdit,
  onEditingChange,
}: {
  task: DeliveryTask;
  data: DeliveryTaskData;
  onTask: (task: Pick<DeliveryTask, "id" | "req_id">) => void;
  onSaved: (data: DeliveryCommandAck) => void;
  canEdit: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const identity = useMemberIdentity();
  const tr = (key: string) => t(`delivery.${key}`);
  const [editor, setEditor] = useState<EditorSpec | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!editor) return;
    onEditingChange?.(true);
    return () => onEditingChange?.(false);
  }, [Boolean(editor), onEditingChange]);
  const requirement = data.requirement || undefined;
  function edit() {
    if (!task.basis) {
      setError(t("deliveryManualReview.readFailed"));
      return;
    }
    setError("");
    let pinned = openTaskEdit(data, task.id);
    let latest: DeliveryTaskData | undefined;
    let intent: DeliveryIntent = {
      version: data.version,
      key: crypto.randomUUID(),
    };
    const fields = (workspace: DeliveryTaskData): EditorField[] => [
      {
        key: "description",
        label: tr("description"),
        type: "area",
        max: 10000,
      },
      {
        key: "acceptance_criteria",
        label: t("deliveryTaskAcceptance.ownCriteria"),
        type: "criteria",
      },
      ...(pinned.task.req_id
        ? [
            {
              key: "requirement_criteria_indices",
              label: t("deliveryTaskAcceptance.requirementCriteria"),
              multiple: true,
              options: pinned.criteria.map((text, index) => ({
                value: String(index),
                label: `${index + 1}. ${text}`,
              })),
            },
          ]
        : []),
      {
        key: "depends_on",
        label: tr("taskPlan.dependencies"),
        multiple: true,
        referenceKind: "task",
        options: workspace.dependencies
          .filter((item) => item.id !== task.id)
          .map((item) => ({ value: item.id, label: item.title })),
      },
      { key: "starts_on", label: tr("taskPlan.starts"), type: "date" },
      { key: "ends_on", label: tr("taskPlan.ends"), type: "date" },
      {
        key: "blocked_reason",
        label: tr("blockedReason"),
        type: "area",
        max: 2000,
      },
    ];
    setEditor({
      title: tr("taskPlan.editTask"),
      hint: tr("taskPlan.editHint"),
      fields: fields(data),
      values: {
        description: task.description,
        acceptance_criteria: [...task.acceptance_criteria],
        requirement_criteria_indices: remapCriterionIndexes(
          task.planning?.requirement_criteria_indices || [],
          task.planning?.requirement_snapshot?.acceptance_criteria ||
            pinned.criteria,
          pinned.criteria,
        ).map(String),
        depends_on: task.planning?.depends_on || [],
        starts_on: task.planning?.starts_on,
        ends_on: task.planning?.ends_on,
        blocked_reason: task.planning?.blocked_reason || "",
      },
      submit: async (values) => {
        const payload = taskEditPayload(pinned, values);
        intent = prepareDeliveryIntent(intent, "task.update", payload);
        try {
          onSaved(
            await saveDelivery(
              data.project.id,
              "task.update",
              payload,
              intent.version,
              intent.key,
            ),
          );
          for (const name of [
            "delivery-task-reviews",
            "delivery-progress",
            "delivery-inbox",
            "taskDependencies",
          ])
            void qc.invalidateQueries({ queryKey: [name] });
        } catch (failure) {
          const parsed = planError(failure);
          const result = new Error(
            parsed.conflict ? tr("conflict") : parsed.message,
          );
          result.name = parsed.conflict ? "DeliveryConflict" : "Error";
          throw result;
        }
      },
      loadLatest: async () => {
        latest = await fetchDeliveryTaskData(data.project.id, task.id);
        if (latest.task.id !== task.id)
          throw new Error(t("deliveryManualReview.taskPlanUnavailable"));
        const current = openTaskEdit(latest, task.id);
        return {
          version: latest.version,
          items: [
            { label: tr("titleField"), value: current.task.title },
            {
              label: tr("owner"),
              value: identity(latest.members, current.task.owner_id),
            },
            {
              label: tr("current"),
              value: tr(`statuses.${current.task.status}`),
            },
            {
              label: t("deliveryManualReview.requirement"),
              value:
                latest.requirement?.title ||
                t("deliveryManualReview.standalone"),
            },
            { label: tr("description"), value: current.task.description },
            {
              label: t("deliveryTaskAcceptance.ownCriteria"),
              value: current.task.acceptance_criteria.join("\n") || tr("none"),
            },
            {
              label: tr("taskPlan.criteria"),
              value: current.criteria.join("\n") || tr("none"),
            },
            {
              label: tr("taskPlan.dependencies"),
              value:
                (current.task.planning?.depends_on || [])
                  .map(
                    (id) =>
                      latest!.dependencies.find((item) => item.id === id)
                        ?.title || id,
                  )
                  .join(" · ") || tr("none"),
            },
            {
              label: tr("taskPlan.starts"),
              value: current.task.planning?.starts_on || tr("unscheduled"),
            },
            {
              label: tr("taskPlan.ends"),
              value: current.task.planning?.ends_on || tr("unscheduled"),
            },
            {
              label: tr("blockedReason"),
              value: current.task.planning?.blocked_reason || tr("none"),
            },
          ],
        };
      },
      adoptVersion: (version, draft) => {
        if (!latest) return;
        const adopted = adoptTaskEdit(pinned, latest, draft);
        pinned = adopted.session;
        intent = { version, key: crypto.randomUUID() };
        setEditor((current) =>
          current ? { ...current, fields: fields(latest!) } : current,
        );
        return adopted.values;
      },
    });
  }
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <DeliveryTaskPlanning
        task={task}
        requirement={requirement}
        data={data}
        onTask={onTask}
        onEdit={edit}
        canEdit={canEdit && Boolean(task.basis)}
      />
      <div className="delivery-task-reservation-link">
        <Button
          type="link"
          size="small"
          disabled={!canEdit}
          onClick={() => {
            location.hash = schedulingHash({
              ...parseSchedulingRoute(location.hash),
              view: "timeline",
              timelineMode: "dependencies",
              editTaskId: task.id,
            });
          }}
        >
          {t("deliverySchedule.adjustTask")}
        </Button>
        <p className="delivery-schedule-multiline">
          {allocationSummary(task.planning?.allocations || [], data.members, t)}
        </p>
      </div>
      {editor && (
        <DeliveryEditor spec={editor} onClose={() => setEditor(null)} />
      )}
    </>
  );
}
