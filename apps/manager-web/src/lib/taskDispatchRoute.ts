import { externalWorkOrderReturn } from "./externalWorkOrderRoute";
import { manualTaskHref } from "./deliveryTaskReview";
import { taskDefinitionRouteKeys } from "./taskDefinitionRoute";
import { submissionIdentity } from "./deliveryTaskSubmission";
import { validFeedbackReference, type FeedbackReference } from "./deliveryFeedback";
export const taskDispatchRouteEvent = "sop-task-dispatch-route";
export const taskDispatchKeys = ["task_dispatch", "dispatch_task", "feedback_submission", "feedback_digest", "feedback_decision"] as const;
export function taskDispatchRequest(hash: string, projectId: string, taskId: string): { open: boolean; invalid: boolean; feedback?: FeedbackReference } {
  const [path, query] = hash.split("?"), p = new URLSearchParams(query); if (!taskDispatchKeys.some((key) => p.has(key))) return { open: false, invalid: false };
  const key = path === "#/dev-flow" ? "task" : ["#/tasks/execution", "#/tasks/board"].includes(path) ? "task_id" : "";
  if (!key || hash.indexOf("#", 1) >= 0 || !submissionIdentity(projectId) || !submissionIdentity(taskId) || p.getAll("project_id").length !== 1 || p.get("project_id") !== projectId || p.getAll(key).length !== 1 || p.get(key) !== taskId || p.has(key === "task" ? "task_id" : "task") || taskDispatchKeys.some((name) => p.getAll(name).length > 1) || p.get("task_dispatch") !== "1" || p.get("dispatch_task") !== taskId) return { open: false, invalid: true };
  if (!["feedback_submission", "feedback_digest", "feedback_decision"].some((key) => p.has(key))) return { open: true, invalid: false };
  const feedback = { submission_id: p.get("feedback_submission"), submission_digest: p.get("feedback_digest"), decision_id: p.get("feedback_decision") };
  return validFeedbackReference(feedback) ? { open: true, invalid: false, feedback } : { open: false, invalid: true };
}
export function taskDispatchHref(projectId: string, task: { id: string; req_id?: string }, background = "", feedback?: FeedbackReference) {
  if (!submissionIdentity(projectId) || !submissionIdentity(task.id) || feedback && !validFeedbackReference(feedback)) throw new Error("dispatchScopeChanged");
  const [path, query] = manualTaskHref(task, background, projectId).split("?"), p = new URLSearchParams(query); for (const key of taskDispatchKeys) p.delete(key);
  for (const key of [...taskDefinitionRouteKeys, "delivery_report"]) p.delete(key);
  p.set("task_dispatch", "1"); p.set("dispatch_task", task.id);
  if (feedback) { p.set("feedback_submission", feedback.submission_id); p.set("feedback_digest", feedback.submission_digest); p.set("feedback_decision", feedback.decision_id); }
  const externalBack = externalWorkOrderReturn(background, projectId); if (externalBack) p.set("return_to", externalBack);
  return `${path}?${p}`;
}
export function closeTaskDispatchRoute(projectId: string, taskId: string) {
  if (typeof location === "undefined") return; const hash = location.hash, [path, query] = hash.split("?"), p = new URLSearchParams(query), key = path === "#/dev-flow" ? "task" : ["#/tasks/execution", "#/tasks/board"].includes(path) ? "task_id" : "";
  if (!submissionIdentity(projectId) || !submissionIdentity(taskId) || !key || hash.indexOf("#", 1) >= 0 || p.getAll("project_id").length !== 1 || p.get("project_id") !== projectId || p.getAll(key).length !== 1 || p.get(key) !== taskId || p.has(key === "task" ? "task_id" : "task")) return;
  for (const name of taskDispatchKeys) p.delete(name); history.replaceState(history.state, "", `${path}?${p}`); window.dispatchEvent(new Event(taskDispatchRouteEvent));
}

/** Keep the current Task workspace/return while selecting a confirmed exact work order. */
export function taskDispatchOrderHref(hash: string, projectId: string, taskId: string, orderId: string): string | null {
  const [path, query] = hash.split("?"), p = new URLSearchParams(query), key = path === "#/dev-flow" ? "task" : ["#/tasks/execution", "#/tasks/board"].includes(path) ? "task_id" : "";
  if (!submissionIdentity(projectId) || !submissionIdentity(taskId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(orderId) || !key || hash.indexOf("#", 1) >= 0 || p.getAll("project_id").length !== 1 || p.get("project_id") !== projectId || p.getAll(key).length !== 1 || p.get(key) !== taskId || p.has(key === "task" ? "task_id" : "task")) return null;
  for (const name of [...taskDispatchKeys, ...taskDefinitionRouteKeys, "submission_id", "delivery_report"]) p.delete(name); p.set("work_order_id", orderId); return `${path}?${p}`;
}
