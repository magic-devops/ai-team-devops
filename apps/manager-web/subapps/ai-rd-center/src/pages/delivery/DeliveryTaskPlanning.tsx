import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  fetchRequirementDefinition,
  requirementReadMatches,
  type RequirementHead,
} from "@/lib/deliveryRequirementReads";
import { Alert, Button, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { DeliveryTask, DeliveryTaskData } from "@/lib/delivery";

export function DeliveryTaskPlanning({
  task,
  requirement,
  data,
  onTask,
  onEdit,
  canEdit,
}: {
  task: DeliveryTask;
  requirement?: RequirementHead;
  data: DeliveryTaskData;
  onTask: (task: Pick<DeliveryTask, "id" | "req_id">) => void;
  onEdit: () => void;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`delivery.taskPlan.${key}`);
  const plan = task.planning;
  const [expanded, setExpanded] = useState(false);
  const definition = useQuery({
    queryKey: [
      "delivery-task-parent-definition",
      data.project.id,
      projectSessionKey(),
      requirement?.id,
      requirement?.basis,
      data.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementDefinition(
        data.project.id,
        requirement!.id,
        data.query_generation,
        signal,
      ),
    enabled:
      expanded &&
      !!requirement &&
      !plan?.requirement_snapshot &&
      plan?.requirement_revision === requirement.flow.revision,
    retry: false,
    gcTime: 0,
  });
  const criteria =
    requirement &&
    !definition.isError &&
    requirementReadMatches(
      definition.data,
      data.project.id,
      requirement.id,
      data.query_generation,
      requirement.basis,
    ) &&
    definition.data?.definition.id === requirement.id &&
    definition.data.version === data.version
      ? definition.data.definition.acceptance_criteria
      : undefined;
  return (
    <section className="delivery-task-planning">
      <div className="delivery-task-plan-heading">
        <small>
          {plan?.starts_on || "—"} → {plan?.ends_on || tr("noDate")}
        </small>
        <Button size="small" type="text" onClick={onEdit} disabled={!canEdit}>
          {tr("editTask")}
        </Button>
      </div>
      {plan && (
        <>
          {plan.blocked_reason && (
            <Alert type="warning" title={plan.blocked_reason} />
          )}
          {Boolean(task.dependency_blocked?.length) && (
            <p className="delivery-overdue">{tr("dependencyWaiting")}</p>
          )}
          {Boolean(plan.depends_on?.length) && (
            <div className="delivery-plan-dependencies">
              <small>{tr("dependencies")}</small>
              {(plan.depends_on || []).map((id) => {
                const dependency = data.dependencies.find(
                  (item) => item.id === id,
                );
                return dependency ? (
                  <Button
                    key={id}
                    type="link"
                    size="small"
                    onClick={() => onTask(dependency)}
                  >
                    {dependency.title}
                    <Tag
                      color={
                        task.dependency_blocked?.includes(id)
                          ? "warning"
                          : "success"
                      }
                    >
                      {t(`delivery.statuses.${dependency.status}`)}
                    </Tag>
                  </Button>
                ) : (
                  <Tag key={id} color="warning">
                    {id}
                  </Tag>
                );
              })}
            </div>
          )}
          {plan.source && (
            <details
              onToggle={(event) => setExpanded(event.currentTarget.open)}
            >
              <summary>
                {tr("planOrigin")} ·{" "}
                {tr(plan.source === "manual" ? "manualSource" : plan.source)}
              </summary>
              {plan.model && (
                <small>
                  {plan.provider} · {plan.model}
                </small>
              )}
              {requirement && (
                <p>
                  {t("delivery.revision", {
                    number: plan.requirement_revision,
                  })}
                </p>
              )}
              {requirement && (
                <ul>
                  {(plan.requirement_criteria_indices || []).map((index) => (
                    <li key={index}>
                      {plan.requirement_snapshot?.acceptance_criteria[index] ||
                        (plan.requirement_revision ===
                          requirement.flow.revision && criteria
                          ? criteria[index]
                          : `${index + 1} · ${t("deliveryCollaboration.definitionUnavailable")}`)}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}
