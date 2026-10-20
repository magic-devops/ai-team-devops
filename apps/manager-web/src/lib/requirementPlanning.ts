import { getProjectId } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";

const statuses = new Set(["pending", "in_progress", "blocked", "completed"]);
const priorities = new Set(["P0", "P1", "P2", "P3"]);
const requirementPath = /^#\/requirements(?:\/(?:pool|review|generation|batch|workbench))?$/;

export type RequirementListFilters = { keyword: string; status: string; priority: string };

export function requirementListFilters(hash: string): RequirementListFilters {
  const params = new URLSearchParams(hash.split("?")[1]);
  const keyword = params.get("q") || "";
  return {
    keyword: keyword.length <= 500 && !/[\u0000-\u001f\u007f]/.test(keyword) ? keyword : "",
    status: statuses.has(params.get("status") || "") ? params.get("status")! : "__all__",
    priority: priorities.has(params.get("priority") || "") ? params.get("priority")! : "__all__",
  };
}

/** A navigation intent only: task creation remains in the canonical editable plan. */
export function requirementPlanningHref(
  requirementId: string,
  projectId: string,
  background: string,
  filters: RequirementListFilters,
) {
  if (![requirementId, projectId].every((value) => value && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value))) {
    throw new Error("Invalid project or requirement identity");
  }
  const base = background.split("?")[0];
  const back = new URLSearchParams({ project_id: projectId });
  const normalized = requirementListFilters(`?${new URLSearchParams({ q: filters.keyword, status: filters.status, priority: filters.priority })}`);
  if (normalized.keyword) back.set("q", normalized.keyword);
  if (normalized.status !== "__all__") back.set("status", normalized.status);
  if (normalized.priority !== "__all__") back.set("priority", normalized.priority);
  const params = new URLSearchParams({
    view: "list", requirement: requirementId, detail: "tasks", project_id: projectId,
    return_to: `${requirementPath.test(base) ? base : "#/requirements/pool"}?${back}`,
  });
  return `#/dev-flow?${params}`;
}

export function requirementPlanningReturn(hash: string, projectId: string): string | null {
  const target = new URLSearchParams(hash.split("?")[1]);
  const value = target.get("return_to") || "";
  if (!projectId || target.get("project_id") !== projectId || value.length > 4000
    || /[\u0000-\u001f\u007f\\]/.test(value) || value.indexOf("#", 1) !== -1) return null;
  const base = value.split("?")[0];
  const params = new URLSearchParams(value.split("?")[1]);
  if (!requirementPath.test(base) || params.get("project_id") !== projectId) return null;
  const filters = requirementListFilters(value);
  const clean = new URLSearchParams({ project_id: projectId });
  if (filters.keyword) clean.set("q", filters.keyword);
  if (filters.status !== "__all__") clean.set("status", filters.status);
  if (filters.priority !== "__all__") clean.set("priority", filters.priority);
  return `${base}?${clean}`;
}
export function bindRequirementPlanningBack(canNavigate: () => boolean) {
  const origin = projectSessionKey();
  return () => {
    if (origin !== projectSessionKey()) return false;
    const target = requirementPlanningReturn(window.location.hash, getProjectId() || "");
    if (!target || !canNavigate()) return false;
    window.location.hash = target;
    return true;
  };
}
