import type { DeliveryTask, DeliveryTaskData } from "./delivery";
import { remapCriterionIndexes } from "./deliveryTaskPlan";
import { normalizeTaskCriteria } from "./taskAcceptance";
import { requirementReadMatches } from "./deliveryRequirementReads";
import type { TaskDefinitionEditPayload } from "./taskEditCommand";
export type TaskEditSession = {
  projectId: string;
  version: number;
  planningBasis: string;
  task: DeliveryTask;
  criteria: string[];
};
export function openTaskEdit(
  workspace: DeliveryTaskData,
  taskId: string,
): TaskEditSession {
  const task = workspace.task.id === taskId ? workspace.task : undefined;
  if (!task?.basis) throw new Error("Current task basis unavailable");
  if (!workspace.planning_basis)
    throw new Error("Current planning basis unavailable");
  const requirement = workspace.requirement;
  if (task.req_id && (!requirement || requirement.id !== task.req_id))
    throw new Error("Current requirement definition unavailable");
  const definition = workspace.requirement_definition;
  if (
    requirement &&
    (!requirementReadMatches(
      definition,
      workspace.project.id,
      requirement.id,
      workspace.query_generation,
      requirement.basis,
    ) ||
      definition?.definition.id !== requirement.id ||
      definition.version !== workspace.version)
  )
    throw new Error("Current requirement definition unavailable");
  return {
    projectId: workspace.project.id,
    version: workspace.version,
    planningBasis: workspace.planning_basis,
    task: structuredClone(task),
    criteria: requirement
      ? [...definition!.definition.acceptance_criteria]
      : [],
  };
}
export function taskEditPayload(
  session: TaskEditSession,
  values: Record<string, unknown>,
): TaskDefinitionEditPayload {
  return {
    id: session.task.id,
    title: typeof values.title === "string" ? values.title.trim() : session.task.title,
    task_basis: session.task.basis,
    planning_basis: session.planningBasis,
    description: typeof values.description === "string" ? values.description : "",
    acceptance_criteria: normalizeTaskCriteria(
      values.acceptance_criteria || [],
    ),
    requirement_criteria_indices: session.task.req_id
      ? ((values.requirement_criteria_indices || []) as string[]).map(Number)
      : [],
    depends_on: (values.depends_on || []) as string[],
    starts_on: (values.starts_on || null) as string | null,
    ends_on: (values.ends_on || null) as string | null,
    blocked_reason: typeof values.blocked_reason === "string" ? values.blocked_reason : "",
  };
}
export function adoptTaskEdit(
  session: TaskEditSession,
  workspace: DeliveryTaskData,
  values: Record<string, unknown>,
): { session: TaskEditSession; values: Record<string, unknown> } {
  if (workspace.project.id !== session.projectId)
    throw new Error("Task edit scope changed");
  const latest = openTaskEdit(workspace, session.task.id);
  const criteria = remapCriterionIndexes(
    ((values.requirement_criteria_indices || []) as string[]).map(Number),
    session.criteria,
    latest.criteria,
  );
  return {
    session: latest,
    values: {
      ...values,
      requirement_criteria_indices:
        session.task.req_id === latest.task.req_id ? criteria.map(String) : [],
    },
  };
}
