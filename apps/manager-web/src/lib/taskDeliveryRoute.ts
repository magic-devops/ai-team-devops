/** Task delivery selections belong to one explicit project and Task. */
export type TaskDeliverySelection = {
  submission_id?: string | null;
  work_order_id?: string | null;
};
const selectionKeys = ["submission_id", "work_order_id", "delivery_report"] as const;
const taskEditKeys = ["task_dispatch", "dispatch_task", "feedback_submission", "feedback_digest", "feedback_decision", "task_edit", "task_edit_task", "task_source_thread", "task_source_message", "task_source_version", "task_source_revision", "task_source_resolution", "task_source_field"];
const identity = (value: unknown, max = 64): value is string => typeof value === "string" && Boolean(value) && Array.from(value).length <= max && value === value.trim() &&
  !/[\u0000-\u001f\u007f-\u009f/\\]/.test(value) && ![".", ".."].includes(value) &&
  !Array.from(value).some((char) => { const code = char.codePointAt(0)!; return code >= 0xd800 && code <= 0xdfff; });

export function clearTaskDeliverySelection(params: URLSearchParams) {
  for (const key of selectionKeys) params.delete(key);
}

function taskScope(hash: string) {
  const [path, query] = hash.split("?"), params = new URLSearchParams(query);
  const key = path === "#/dev-flow" ? "task" : path === "#/tasks/execution" ? "task_id" : "";
  if (!key || hash.indexOf("#", 1) >= 0 || params.has(key === "task" ? "task_id" : "task") ||
    params.getAll("project_id").length !== 1 || params.getAll(key).length !== 1 ||
    (path === "#/dev-flow" && (params.getAll("detail").length !== 1 || params.get("detail") !== "tasks"))) return null;
  const projectId = params.get("project_id")!, taskId = params.get(key)!;
  return identity(projectId, 128) && identity(taskId) ? { projectId, taskId, params } : null;
}

export function applyTaskDeliverySelection(target: string, source: string, explicit?: TaskDeliverySelection) {
  const [path, query] = target.split("?"), params = new URLSearchParams(query);
  const next = taskScope(target), previous = taskScope(source);
  if (!next || !previous || next.projectId !== previous.projectId || next.taskId !== previous.taskId) for (const key of taskEditKeys) params.delete(key);
  clearTaskDeliverySelection(params);
  const supplied = explicit && (Object.hasOwn(explicit, "submission_id") || Object.hasOwn(explicit, "work_order_id"));
  if (supplied) {
    const refs = [explicit.submission_id, explicit.work_order_id];
    if (refs.some((value) => value != null && (!identity(value) || !next))) throw new Error("invalidTaskDeliveryTarget");
    if (explicit.submission_id) params.set("submission_id", explicit.submission_id);
    if (explicit.work_order_id) params.set("work_order_id", explicit.work_order_id);
  } else if (next && previous && next.projectId === previous.projectId && next.taskId === previous.taskId && selectionKeys.every((key) => previous.params.getAll(key).length <= 1)) {
    for (const key of ["submission_id", "work_order_id"] as const) {
      const value = previous.params.get(key);
      if (previous.params.getAll(key).length === 1 && value && identity(value)) params.set(key, value);
    }
    if (params.has("work_order_id") && !params.has("submission_id") && previous.params.getAll("delivery_report").length === 1 && previous.params.get("delivery_report") === "1") params.set("delivery_report", "1");
  }
  return `${path}${params.size ? `?${params}` : ""}`;
}
