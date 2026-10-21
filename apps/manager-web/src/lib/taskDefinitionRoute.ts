import { manualTaskHref } from "./deliveryTaskReview";
import { discussionSource, fetchDiscussion, fetchDiscussionMessage, type DiscussionAdoption, type DiscussionSourceReference } from "./deliveryDiscussions";
import { taskEditIdentity, validTaskEditSource } from "./taskEditCommand";

export const taskDefinitionRouteClosedEvent = "sop-task-definition-route-closed";
export const taskDefinitionSourceKeys = ["task_source_thread", "task_source_message", "task_source_version", "task_source_revision", "task_source_resolution", "task_source_field"] as const;
export const taskDefinitionRouteKeys = ["task_edit", "task_edit_task", ...taskDefinitionSourceKeys] as const;
export type TaskDefinitionRequest = { open: boolean; invalid: boolean; source?: { reference: DiscussionSourceReference; field: DiscussionAdoption["field"] } };
export function taskDefinitionRequest(hash: string, projectId: string, taskId: string): TaskDefinitionRequest {
  const [path, query] = hash.split("?"), params = new URLSearchParams(query), present = taskDefinitionRouteKeys.some((key) => params.has(key));
  if (!present) return { open: false, invalid: false };
  const key = path === "#/dev-flow" ? "task" : ["#/tasks/execution", "#/tasks/board"].includes(path) ? "task_id" : "";
  if (!key || hash.indexOf("#", 1) >= 0 || !taskEditIdentity(projectId) || !taskEditIdentity(taskId) ||
    params.getAll("project_id").length !== 1 || params.get("project_id") !== projectId || params.getAll(key).length !== 1 || params.get(key) !== taskId ||
    params.has(key === "task" ? "task_id" : "task") || taskDefinitionRouteKeys.some((name) => params.getAll(name).length > 1) ||
    params.get("task_edit") !== "1" || params.get("task_edit_task") !== taskId) return { open: false, invalid: true };
  if (!taskDefinitionSourceKeys.some((name) => params.has(name))) return { open: true, invalid: false };
  const reference = { thread_id: params.get("task_source_thread"), message_id: params.get("task_source_message"), expected_thread_version: Number(params.get("task_source_version")),
    message_revision: Number(params.get("task_source_revision")), resolution_event_id: params.get("task_source_resolution") };
  const field = params.get("task_source_field");
  if (!validTaskEditSource(reference) || !["description", "acceptance_criteria"].includes(field || "")) return { open: false, invalid: true };
  return { open: true, invalid: false, source: { reference, field: field as DiscussionAdoption["field"] } };
}
export function taskDefinitionHref(projectId: string, task: { id: string; req_id?: string }, background = "", source?: DiscussionAdoption) {
  if (!taskEditIdentity(projectId) || !taskEditIdentity(task.id) || source && (source.thread.subject.kind !== "task" || source.thread.subject.id !== task.id || source.thread.subject.missing)) throw new Error("discussion_scope_changed");
  const [path, query] = manualTaskHref(task, background, projectId).split("?"), params = new URLSearchParams(query);
  for (const key of taskDefinitionRouteKeys) params.delete(key);
  params.set("task_edit", "1"); params.set("task_edit_task", task.id);
  if (source) {
    if (!validTaskEditSource(source.reference)) throw new Error("discussion_source_changed");
    const r = source.reference;
    [r.thread_id, r.message_id, String(r.expected_thread_version), String(r.message_revision), r.resolution_event_id, source.field].forEach((value, index) => params.set(taskDefinitionSourceKeys[index], value));
  }
  return `${path}?${params}`;
}
export async function readTaskDefinitionSource(projectId: string, taskId: string, selection: NonNullable<TaskDefinitionRequest["source"]>, signal?: AbortSignal): Promise<DiscussionAdoption> {
  const { reference, field } = selection, detail = await fetchDiscussion(projectId, reference.thread_id, signal);
  if (detail.thread.subject.kind !== "task" || detail.thread.subject.id !== taskId || detail.thread.subject.missing) throw new Error("discussion_scope_changed");
  const message = await fetchDiscussionMessage(projectId, reference.thread_id, reference.message_id, signal), actual = discussionSource(detail.thread, message.message);
  if (message.thread_version !== detail.thread.version || actual.expected_thread_version !== reference.expected_thread_version || actual.message_revision !== reference.message_revision || actual.resolution_event_id !== reference.resolution_event_id) throw new Error("discussion_source_changed");
  return { reference: actual, thread: detail.thread, message: message.message, field };
}
export function closeTaskDefinitionRoute(projectId: string, taskId: string) {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  const hash = location.hash, [path, query] = hash.split("?"), params = new URLSearchParams(query);
  const key = path === "#/dev-flow" ? "task" : ["#/tasks/execution", "#/tasks/board"].includes(path) ? "task_id" : "";
  if (!key || hash.indexOf("#", 1) >= 0 || !taskEditIdentity(projectId) || !taskEditIdentity(taskId) ||
    params.getAll("project_id").length !== 1 || params.get("project_id") !== projectId ||
    params.getAll(key).length !== 1 || params.get(key) !== taskId || params.has(key === "task" ? "task_id" : "task")) return;
  // Malformed private edit flags may be cleared only inside the exact live project/Task route.
  for (const name of taskDefinitionRouteKeys) params.delete(name);
  history.replaceState(history.state, "", `${path}${params.size ? `?${params}` : ""}`);
  // Publish this local close synchronously without presenting it as a browser navigation.
  if (typeof window !== "undefined") window.dispatchEvent(new Event(taskDefinitionRouteClosedEvent));
}
