import { safeExecutionReturn } from "./executionCommands";
import { safePortfolioReturn } from "./projectPortfolioRoute";

export type ExternalWorkOrderView = "orders" | "dispatch" | "reports";
export type ExternalWorkOrderRoute = {
  projectId: string; view: ExternalWorkOrderView; taskId: string; workOrderId: string;
  cursor: string; status: string; returnTo: string; invalid: boolean;
};
const unicodeId = (value: string, max = 64) => Boolean(value) && Array.from(value).length <= max && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f/\\]/.test(value) && ![".", ".."].includes(value);
const orderId = (value: string) => unicodeId(value);
const clean = (value: string, max: number) => value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const single = (params: URLSearchParams, key: string) => params.getAll(key).length <= 1;
const paths: Record<ExternalWorkOrderView, string> = { orders: "#/ecosystem/a2a/dispatch", dispatch: "#/ecosystem/a2a/negotiate", reports: "#/ecosystem/a2a/evidence" };

export function parseExternalWorkOrderRoute(hash: string): ExternalWorkOrderRoute {
  const [path, query] = hash.split("?");
  const params = new URLSearchParams(query);
  const projectId = params.get("project_id") || "", taskId = params.get("task_id") || "", workOrderId = params.get("work_order_id") || "";
  const cursor = params.get("cursor") || "", status = params.get("status") || "";
  const returnTo = safePortfolioReturn(params.get("return_to") || "") || "";
  const route = path.match(/^#\/ecosystem\/a2a(?:\/(workbench|registry|negotiate|dispatch|evidence|sla|windows))?$/);
  return {
    projectId, taskId, workOrderId, cursor, status, returnTo,
    view: route?.[1] === "registry" || route?.[1] === "negotiate" ? "dispatch" : route?.[1] === "evidence" ? "reports" : "orders",
    invalid: !route || hash.indexOf("#", 1) >= 0 || ["project_id", "task_id", "work_order_id", "cursor", "status", "return_to"].some((key) => !single(params, key)) || params.has("task") || Boolean(params.get("return_to") && !returnTo) ||
      Boolean(projectId && !unicodeId(projectId, 128) || taskId && !unicodeId(taskId) || workOrderId && (!orderId(workOrderId) || !taskId)) || !clean(cursor, 4000) || !clean(status, 32),
  };
}

export function externalWorkOrderHref(route: { projectId: string; view: ExternalWorkOrderView; taskId?: string; workOrderId?: string; cursor?: string; status?: string; returnTo?: string }) {
  if (!unicodeId(route.projectId, 128) || route.taskId && !unicodeId(route.taskId) || route.workOrderId && (!orderId(route.workOrderId) || !route.taskId)) throw new Error("workOrderScopeChanged");
  const params = new URLSearchParams({ project_id: route.projectId });
  for (const [key, value] of [["task_id", route.taskId], ["work_order_id", route.workOrderId], ["cursor", route.cursor], ["status", route.status]]) if (value) params.set(key!, value);
  const back = safePortfolioReturn(route.returnTo || ""); if (back) params.set("return_to", back);
  return `${paths[route.view]}?${params}`;
}

export function externalWorkOrderReturn(hash: string, projectId: string) {
  const route = parseExternalWorkOrderRoute(hash);
  return !route.invalid && route.projectId === projectId ? hash : null;
}

export function externalWorkOrderTaskHref(projectId: string, taskId: string, workOrderId: string, submissionId = "", background = "", composeReport = false) {
  if (!unicodeId(projectId, 128) || !unicodeId(taskId) || !orderId(workOrderId) || submissionId && !orderId(submissionId)) throw new Error("workOrderScopeChanged");
  const params = new URLSearchParams({ project_id: projectId, task_id: taskId, work_order_id: workOrderId });
  if (submissionId) params.set("submission_id", submissionId);
  if (composeReport) params.set("delivery_report", "1");
  const legacyBack = safeExecutionReturn(background), legacyParams = new URLSearchParams(background.split("?")[1]);
  const safe = externalWorkOrderReturn(background, projectId) || (legacyParams.getAll("project_id").length === 1 && legacyParams.get("project_id") === projectId ? legacyBack : null);
  if (safe) params.set("return_to", safe);
  return `#/tasks/execution?${params}`;
}

export function selectedTaskWorkOrder(hash: string, projectId: string, taskId: string) {
  const [path, query] = hash.split("?");
  const params = new URLSearchParams(query);
  const taskKey = path === "#/dev-flow" ? "task" : path === "#/tasks/execution" ? "task_id" : "";
  const alternate = taskKey === "task" ? "task_id" : "task";
  if (!taskKey || hash.indexOf("#", 1) >= 0 || params.has(alternate) ||
    ["project_id", taskKey, "work_order_id"].some((key) => params.getAll(key).length !== 1) ||
    params.get("project_id") !== projectId || params.get(taskKey) !== taskId || !unicodeId(taskId) || !orderId(params.get("work_order_id") || "")) return "";
  return params.get("work_order_id")!;
}
