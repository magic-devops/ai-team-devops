import { taskEditIdentity } from "./taskEditCommand";
export function taskPlanRouteRequirement(hash: string, projectId: string) {
  const [path, query] = hash.split("?"), params = new URLSearchParams(query);
  const id = params.get("plan_requirement");
  return path === "#/dev-flow" && params.getAll("project_id").length === 1 && params.get("project_id") === projectId &&
    params.getAll("plan_requirement").length === 1 && taskEditIdentity(id) ? id : "";
}
export function taskPlanEditorHash(projectId: string, requirementId: string, source = location.hash) {
  const params = new URLSearchParams(source.split("?")[1]);
  if (requirementId && !taskEditIdentity(requirementId)) throw new Error("invalidRequirement");
  if (!taskEditIdentity(projectId) || source.split("?")[0] !== "#/dev-flow" || params.getAll("project_id").length !== 1 || params.get("project_id") !== projectId) throw new Error("projectScopeChanged");
  if (requirementId) params.set("plan_requirement", requirementId); else params.delete("plan_requirement");
  return `#/dev-flow?${params}`;
}
