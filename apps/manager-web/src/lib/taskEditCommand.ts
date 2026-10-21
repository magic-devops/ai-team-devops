import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { DeliveryCommandAck, DeliveryIntent } from "./delivery";
import { createDeliveryCommandController, validDeliveryCommandAck, type DeliveryControllerOptions } from "./deliveryCommandController";
import type { DiscussionSourceReference } from "./deliveryDiscussions";
import { eventRetryDraftKey } from "./eventReceipts";
import { getSessionRevision } from "./authStorage";
import { bindSessionRequest } from "./http";
import { projectSessionKey } from "./projectPortfolio";

export type TaskDefinitionEditPayload = { id: string; title: string; task_basis: string; planning_basis: string; description: string;
  acceptance_criteria: string[]; requirement_criteria_indices: number[]; depends_on: string[]; starts_on: string | null; ends_on: string | null; blocked_reason: string };
export type TaskEditPayload = TaskDefinitionEditPayload | { id: string; task_basis: string; owner_id: string } |
  { id: string; task_basis: string; status: "pending" | "in_progress" | "blocked" | "completed" };
export type TaskEditOriginal = { action: "task.update"; payload: TaskEditPayload; intent: DeliveryIntent; source_reference?: DiscussionSourceReference };
export const MAX_TASK_EDIT_BODY_BYTES = 1024 * 1024;
const MAX_RETAINED_LENGTH = 3 * 1024 * 1024;
const record = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exact = (value: Record<string, any>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && Number(value) >= min;
const utf8Text = (value: unknown, max: number, required = true): value is string => typeof value === "string" && Array.from(value).length <= max &&
  !/[\ud800-\udfff]/u.test(value) && (!required || Boolean(value.trim()));
export const taskEditIdentity = (value: unknown, max = 64): value is string => utf8Text(value, max) && value === value.trim() &&
  !/[\u0000-\u001f\u007f-\u009f/\\]/.test(value) && ![".", ".."].includes(value);
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const date = (value: unknown) => value === null || typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function validTaskEditSource(value: unknown): value is DiscussionSourceReference {
  return record(value) && exact(value, ["thread_id", "expected_thread_version", "resolution_event_id", "message_id", "message_revision"]) &&
    taskEditIdentity(value.thread_id, 200) && taskEditIdentity(value.resolution_event_id, 200) && taskEditIdentity(value.message_id, 200) &&
    integer(value.expected_thread_version, 1) && integer(value.message_revision, 1);
}
export function validTaskEditPayload(value: unknown, taskId: string): value is TaskEditPayload {
  if (!record(value) || !taskEditIdentity(taskId) || value.id !== taskId || !digest(value.task_basis)) return false;
  if (exact(value, ["id", "task_basis", "owner_id"])) return value.owner_id === "" || utf8Text(value.owner_id, 100) && value.owner_id === value.owner_id.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value.owner_id);
  if (exact(value, ["id", "task_basis", "status"])) return ["pending", "in_progress", "blocked", "completed"].includes(value.status);
  if (!exact(value, ["id", "title", "task_basis", "planning_basis", "description", "acceptance_criteria", "requirement_criteria_indices", "depends_on", "starts_on", "ends_on", "blocked_reason"]) ||
    !utf8Text(value.title, 256) || value.title !== value.title.trim() || !digest(value.planning_basis) || !utf8Text(value.description, 10000, false) || !utf8Text(value.blocked_reason, 2000, false) ||
    !Array.isArray(value.acceptance_criteria) || value.acceptance_criteria.length > 80 || !value.acceptance_criteria.every((item: unknown) => utf8Text(item, 2000) && item === item.trim()) ||
    !Array.isArray(value.requirement_criteria_indices) || value.requirement_criteria_indices.length > 80 || !value.requirement_criteria_indices.every((item: unknown) => integer(item)) ||
    new Set(value.requirement_criteria_indices).size !== value.requirement_criteria_indices.length || !Array.isArray(value.depends_on) || value.depends_on.length > 40 ||
    !value.depends_on.every((item: unknown) => taskEditIdentity(item) && item !== taskId) || new Set(value.depends_on).size !== value.depends_on.length ||
    !date(value.starts_on) || !date(value.ends_on) || value.starts_on && value.ends_on && value.ends_on < value.starts_on) return false;
  return true;
}
export function validTaskEditOriginal(value: unknown, taskId: string): value is TaskEditOriginal {
  if (!record(value) || !exact(value, ["action", "payload", "intent", ...(Object.hasOwn(value, "source_reference") ? ["source_reference"] : [])]) || value.action !== "task.update" ||
    !validTaskEditPayload(value.payload, taskId) || !record(value.intent) || !exact(value.intent, ["version", "key"]) || !integer(value.intent.version) ||
    typeof value.intent.key !== "string" || value.intent.key.length < 8 || value.intent.key.length > 100 || /[\s\u0000-\u001f\u007f-\u009f]/.test(value.intent.key) ||
    Object.hasOwn(value, "source_reference") && !validTaskEditSource(value.source_reference)) return false;
  try { return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_TASK_EDIT_BODY_BYTES; } catch { return false; }
}
export function validTaskEditAck(projectId: string, taskId: string, original: TaskEditOriginal, value: unknown): value is DeliveryCommandAck {
  return validTaskEditOriginal(original, taskId) && record(value) && exact(value, ["project_id", "action", "resource", "result", "affected_refs", "applied_version", "version", "query_generation", "replayed"]) &&
    validDeliveryCommandAck(projectId, original, value, "task", taskId) && record(value.resource) && exact(value.resource, ["kind", "id"]) && value.result === null &&
    value.affected_refs.length === 1 && record(value.affected_refs[0]) && exact(value.affected_refs[0], ["kind", "id"]) && value.affected_refs[0].kind === "task" && value.affected_refs[0].id === taskId;
}
export function createTaskEditController(options: Omit<DeliveryControllerOptions<TaskEditOriginal>, "validateOriginal" | "validateAck"> & { taskId: string }) {
  return createDeliveryCommandController<TaskEditOriginal>({ ...options, retainSucceededOnRestore: true,
    load: () => { const raw = options.load(); if (raw !== null && raw.length > MAX_RETAINED_LENGTH) throw new Error("retainedOriginalInvalid"); return raw; },
    save: (raw) => { if (raw.length > MAX_RETAINED_LENGTH) throw new Error("retainedOriginalUnavailable"); options.save(raw); },
    validateOriginal: (value) => validTaskEditOriginal(value, options.taskId), validateAck: (original, value) => validTaskEditAck(options.projectId, options.taskId, original, value),
  });
}
const PREFIX = "sop.task-edit.v1:";
export function taskEditStorageKey(projectId: string, taskId: string) {
  return taskEditIdentity(projectId) && taskEditIdentity(taskId) ? eventRetryDraftKey(projectId, `task-edit:${taskId}`)?.replace("sop.event-retry.v1:", PREFIX) || null : null;
}
export function taskEditRecoveryPending(projectId: string, taskId: string) {
  const key = taskEditStorageKey(projectId, taskId); if (!key) return false;
  try { const raw = sessionStorage.getItem(key); if (!raw) return false; if (raw.length > MAX_RETAINED_LENGTH) return true;
    const value: unknown = JSON.parse(raw); return !record(value) || value.phase !== "refused" || !validTaskEditOriginal(value.original, taskId);
  } catch { return true; }
}
export function discoverTaskEditRecovery(projectId: string, includeRefused = false): string[] {
  const probe = taskEditStorageKey(projectId, "__scope__"); if (!probe) return [];
  const expected = JSON.parse(probe.slice(PREFIX.length));
  const tasks = new Set<string>();
  try {
    for (let at = 0; at < sessionStorage.length; at++) {
      const key = sessionStorage.key(at); if (!key?.startsWith(PREFIX)) continue;
      let parts: unknown; try { parts = JSON.parse(key.slice(PREFIX.length)); } catch { continue; }
      if (!Array.isArray(parts) || parts.length !== 5 || !parts.slice(0, 4).every((value, index) => value === expected[index]) || typeof parts[4] !== "string" || !parts[4].startsWith("task-edit:")) continue;
      const taskId = parts[4].slice("task-edit:".length);
      if (taskEditIdentity(taskId) && (taskEditRecoveryPending(projectId, taskId) || includeRefused && Boolean(sessionStorage.getItem(key)))) tasks.add(taskId);
    }
  } catch { throw new Error("retainedOriginalUnavailable"); }
  return [...tasks].sort();
}

type Controller = ReturnType<typeof createTaskEditController>;
type Entry = { controller: Controller; owners: number; pending: Set<(value: boolean) => void> };
const entries = new Map<string, Entry>();
const pendingState = (entry: Entry) => !["idle", "refused"].includes(entry.controller.snapshot().phase);
function entryFor(projectId: string, taskId: string, scope: string, currentScope: () => string): Entry {
  const found = entries.get(scope); if (found) return found;
  const key = taskEditStorageKey(projectId, taskId), pending = new Set<(value: boolean) => void>();
  let expectedRaw: string | null = null;
  let entry: Entry;
  const read = bindSessionRequest({ projectId, revision: getSessionRevision() || "" });
  const controller = createTaskEditController({ projectId, taskId, scope, currentScope,
    load: () => { if (!key && typeof window !== "undefined") throw new Error("retainedOriginalUnavailable"); expectedRaw = key ? sessionStorage.getItem(key) : null; return expectedRaw; },
    save: (raw) => {
      if (!key) throw new Error("retainedOriginalUnavailable");
      if (sessionStorage.getItem(key) !== expectedRaw) throw new Error("retainedOriginalUnavailable");
      sessionStorage.setItem(key, raw); expectedRaw = raw;
    },
    send: (original) => read("/api/v1/delivery/commands", { method: "POST", headers: { "X-Project-Id": projectId }, body: JSON.stringify({
      action: original.action, payload: original.payload, expected_version: original.intent.version, idempotency_key: original.intent.key,
      ...(original.source_reference ? { source_reference: original.source_reference } : {}),
    }) }),
    onPending: () => { if (entry) for (const notify of pending) notify(pendingState(entry)); },
  });
  entry = { controller, owners: 0, pending };
  entries.set(scope, entry);
  // An unmounted Task may be revisited, but old inactive entries need not grow forever.
  if (entries.size > 128) for (const [name, old] of entries) { if (name !== scope && !old.owners) { old.controller.invalidate(); entries.delete(name); } if (entries.size <= 128) break; }
  return entry;
}
export function useTaskEditCommand(projectId: string, taskId: string, sessionId: string, onPending?: (pending: boolean) => void) {
  const currentScope = () => JSON.stringify([projectSessionKey(), projectId, taskId, typeof location === "undefined" ? "" : location.hash]);
  const scope = currentScope(), callback = useRef(onPending); callback.current = onPending;
  const entry = useMemo(() => entryFor(projectId, taskId, scope, currentScope), [projectId, taskId, sessionId, scope]);
  const state = useSyncExternalStore(entry.controller.subscribe, entry.controller.snapshot, entry.controller.snapshot);
  useEffect(() => {
    if (!entries.has(scope)) entries.set(scope, entry);
    entry.owners++; entry.controller.activate();
    const notify = (pending: boolean) => callback.current?.(pending);
    entry.pending.add(notify); notify(pendingState(entry));
    const leave = () => { if (currentScope() !== scope) entry.controller.invalidate(); };
    if (typeof window !== "undefined") for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.addEventListener(name, leave);
    return () => {
      if (typeof window !== "undefined") for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.removeEventListener(name, leave);
      entry.pending.delete(notify); entry.owners--; if (!entry.owners) { entry.controller.invalidate(); if (entries.get(scope) === entry) entries.delete(scope); } callback.current?.(false);
    };
  }, [entry, scope]);
  return { ...entry.controller, state, locked: !["idle", "refused"].includes(state.phase), unresolved: !["idle", "refused"].includes(state.phase) };
}
export type TaskEditCommand = ReturnType<typeof useTaskEditCommand>;
