import type { DeliveryTask, DeliveryWorkspace } from "./delivery";
import { remapCriterionIndexes } from "./deliveryTaskPlan";
export type TaskEditSession = {
  projectId: string;
  version: number;
  planningBasis: string;
  task: DeliveryTask;
  criteria: string[];
};
export function openTaskEdit(
  workspace: DeliveryWorkspace,
  taskId: string,
): TaskEditSession {
  const task = workspace.tasks.find((item) => item.id === taskId);
  if (!task?.basis) throw new Error("Current task basis unavailable");
  if (!workspace.planning_basis)
    throw new Error("Current planning basis unavailable");
  const requirement = workspace.requirements.find(
    (item) => item.id === task.req_id,
  );
  return {
    projectId: workspace.project.id,
    version: workspace.version,
    planningBasis: workspace.planning_basis,
    task: structuredClone(task),
    criteria: [...(requirement?.acceptance_criteria || [])],
  };
}
export function taskEditPayload(
  session: TaskEditSession,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: session.task.id,
    task_basis: session.task.basis,
    planning_basis: session.planningBasis,
    description: values.description || "",
    acceptance_criteria: session.task.req_id
      ? ((values.acceptance_criteria || []) as string[]).map(Number)
      : [],
    depends_on: values.depends_on || [],
    starts_on: values.starts_on || null,
    ends_on: values.ends_on || null,
    blocked_reason: values.blocked_reason || "",
  };
}
export function adoptTaskEdit(
  session: TaskEditSession,
  workspace: DeliveryWorkspace,
  values: Record<string, unknown>,
): { session: TaskEditSession; values: Record<string, unknown> } {
  if (workspace.project.id !== session.projectId)
    throw new Error("Task edit scope changed");
  const latest = openTaskEdit(workspace, session.task.id);
  const criteria = remapCriterionIndexes(
    ((values.acceptance_criteria || []) as string[]).map(Number),
    session.criteria,
    latest.criteria,
  );
  return {
    session: latest,
    values: { ...values, acceptance_criteria: criteria.map(String) },
  };
}
