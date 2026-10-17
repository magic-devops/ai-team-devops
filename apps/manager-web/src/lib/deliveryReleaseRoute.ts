import { deliveryInboxHref } from "./deliveryProjectInbox";
import type { DeliveryInboxTarget } from "./delivery";
import type { ReleaseTarget } from "./deliveryRelease";
import {
  preserveProjectContext,
  routeProjectId,
} from "./projectPortfolioRoute";
import { safeExecutionReturn } from "./executionCommands";

export type ReleaseRoute = {
  view: "quality" | "releases";
  releaseId: string;
  evidenceId: string;
  query: string;
  kind: "all" | "requirement" | "task";
  state: "all" | "ready" | "attention";
  requirementIds: string[];
  taskIds: string[];
};
const clean = (value: string | null, max = 200) =>
  value && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : "";
export function parseReleaseRoute(hash: string): ReleaseRoute {
  const p = new URLSearchParams(hash.split("?")[1]);
  const kind = p.get("quality_kind"),
    state = p.get("quality_state");
  return {
    view: p.get("view") === "releases" ? "releases" : "quality",
    releaseId: clean(p.get("release_id"), 128),
    evidenceId: clean(p.get("ci_evidence_id"), 128),
    query: clean(p.get("quality_q")),
    kind: kind === "requirement" || kind === "task" ? kind : "all",
    state: state === "ready" || state === "attention" ? state : "all",
    requirementIds: [
      ...new Set(
        p
          .getAll("requirement_ids")
          .map((id) => clean(id, 64))
          .filter(Boolean),
      ),
    ],
    taskIds: [
      ...new Set(
        p
          .getAll("task_ids")
          .map((id) => clean(id, 64))
          .filter(Boolean),
      ),
    ],
  };
}
export function releaseHash(route: ReleaseRoute, background = "") {
  const p = new URLSearchParams({ view: route.view });
  if (route.releaseId) p.set("release_id", route.releaseId);
  if (route.evidenceId) p.set("ci_evidence_id", route.evidenceId);
  if (route.query) p.set("quality_q", route.query);
  if (route.kind !== "all") p.set("quality_kind", route.kind);
  if (route.state !== "all") p.set("quality_state", route.state);
  for (const id of route.requirementIds) p.append("requirement_ids", id);
  for (const id of route.taskIds) p.append("task_ids", id);
  return preserveProjectContext(`#/dev-flow?${p}`, background);
}
export function releaseTargetHref(
  target: DeliveryInboxTarget | ReleaseTarget,
  background: string,
) {
  const requestedProject = "project_id" in target ? target.project_id : "";
  if (
    requestedProject &&
    routeProjectId(background) &&
    requestedProject !== routeProjectId(background)
  )
    throw new Error("scopeChanged");
  const normalized = {
    view: target.view === "issues" ? "issues" : "list",
    requirement_id: target.requirement_id || "",
    detail: target.task_id ? "tasks" : target.detail,
    task_id: target.task_id || "",
    issue_id: target.issue_id || "",
  };
  const [path, query] = deliveryInboxHref(normalized).split("?");
  const p = new URLSearchParams(query);
  const projectId = requestedProject || routeProjectId(background);
  if (projectId) p.set("project_id", projectId);
  // Only the current canonical workbench route is used as the return target.
  p.set("return_to", releaseHash(parseReleaseRoute(background), background));
  return `${path}?${p}`;
}
export function releaseReturnFromHash(hash: string) {
  const value = new URLSearchParams(hash.split("?")[1]).get("return_to") || "";
  const safe = safeExecutionReturn(value);
  const view = new URLSearchParams(safe?.split("?")[1]).get("view");
  return safe && (view === "quality" || view === "releases")
    ? releaseHash(parseReleaseRoute(safe), safe)
    : null;
}
