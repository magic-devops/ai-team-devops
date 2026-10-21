import { validFeedbackReference } from "./deliveryFeedback";
import type { DeliveryCommandAck, DeliveryIntent } from "./delivery";
import { createDeliveryCommandController, validDeliveryCommandAck, type DeliveryControllerOptions } from "./deliveryCommandController";
import { discoverTaskExternalRecovery, useTaskExternalCommand } from "./taskExternalCommand";
import { eventRetryDraftKey } from "./eventReceipts";
import { bindSessionRequest } from "./http";
import { getSessionRevision } from "./authStorage";
import { submissionIdentity } from "./deliveryTaskSubmission";
import { workOrderDigest as digest, workOrderExact as exact, workOrderInteger as integer, workOrderRecord as record, workOrderText as text, workOrderStates, workOrderMemberIdentity,
  type WorkOrderDetail, type WorkOrderPreview, type WorkOrderState } from "./externalWorkOrders";

export const workOrderActions = ["work_order.create", "work_order.claim", "work_order.progress", "work_order.cancel", "work_order.release", "work_order.report"] as const;
export type WorkOrderAction = typeof workOrderActions[number];
export type WorkOrderOriginal = { action: WorkOrderAction; payload: Record<string, unknown>; intent: DeliveryIntent;
  binding: { task_id: string; work_order_id: string | null; request_digest: string | null; packet_digest: string; state: WorkOrderState | null } };
const maxOriginal = 64 * 1024;
const permission = { "work_order.claim": "can_claim", "work_order.progress": "can_progress", "work_order.cancel": "can_cancel", "work_order.release": "can_release", "work_order.report": "can_report" } as const;

export function validWorkOrderOriginal(value: unknown, taskId: string): value is WorkOrderOriginal {
  if (!record(value) || !exact(value, ["action", "payload", "intent", "binding"]) || !workOrderActions.includes(value.action) || !record(value.intent) || !exact(value.intent, ["version", "key"]) || !integer(value.intent.version) ||
    typeof value.intent.key !== "string" || value.intent.key.length < 8 || value.intent.key.length > 100 || /[\s\u0000-\u001f\u007f-\u009f]/.test(value.intent.key) || !record(value.binding) || !exact(value.binding, ["task_id", "work_order_id", "request_digest", "packet_digest", "state"]) ||
    value.binding.task_id !== taskId || !submissionIdentity(taskId) || !digest(value.binding.packet_digest) || !record(value.payload)) return false;
  const p = value.payload, b = value.binding;
  if (value.action === "work_order.create") {
    if (b.work_order_id !== null || b.request_digest !== null || b.state !== null || !exact(p, ["task_id", "task_basis", "definition_digest", "native_boundary_digest", "executor_member_id", "preview_basis", "instructions", ...(Object.hasOwn(p, "feedback_reference") ? ["feedback_reference"] : [])]) || p.task_id !== taskId ||
      ![p.task_basis, p.definition_digest, p.native_boundary_digest, p.preview_basis].every(digest) || !workOrderMemberIdentity(p.executor_member_id) || !text(p.instructions, 4000, false) || Object.hasOwn(p, "feedback_reference") && p.feedback_reference !== null && !validFeedbackReference(p.feedback_reference)) return false;
  } else {
    if (!submissionIdentity(b.work_order_id) || !digest(b.request_digest) || !workOrderStates.includes(b.state) || p.id !== b.work_order_id || !integer(p.order_revision, 1)) return false;
    const keys = value.action === "work_order.progress" ? ["percent", "status", "message"] : value.action === "work_order.release" ? ["stopped_attestation", "comment"] : value.action === "work_order.cancel" ? ["comment"] : value.action === "work_order.report" ? ["submission_id", "submission_digest", "stopped_attestation"] : [];
    if (!exact(p, ["id", "order_revision", ...keys])) return false;
    if (value.action === "work_order.progress" && (!(p.percent === null || integer(p.percent) && p.percent <= 100) || !["running", "blocked"].includes(p.status) || !text(p.message))) return false;
    if (["work_order.cancel", "work_order.release"].includes(value.action) && !text(p.comment)) return false;
    if (value.action === "work_order.release" && p.stopped_attestation !== true) return false;
    if (value.action === "work_order.report" && (!submissionIdentity(p.submission_id) || !digest(p.submission_digest) || p.stopped_attestation !== true)) return false;
  }
  try { return new TextEncoder().encode(JSON.stringify(value)).length <= maxOriginal; } catch { return false; }
}

export function validWorkOrderAck(projectId: string, taskId: string, original: WorkOrderOriginal, value: unknown): value is DeliveryCommandAck {
  if (!validWorkOrderOriginal(original, taskId) || !record(value) || !exact(value, ["project_id", "action", "resource", "result", "affected_refs", "applied_version", "version", "query_generation", "replayed"]) || !record(value.result)) return false;
  const r = value.result, create = original.action === "work_order.create";
  if (!exact(r, ["work_order_id", "task_ids", "request_digest", "packet_digest", "order_revision", "state", "submission_id"]) || !submissionIdentity(r.work_order_id) || !Array.isArray(r.task_ids) || r.task_ids.length !== 1 || r.task_ids[0] !== taskId ||
    !digest(r.request_digest) || r.packet_digest !== original.binding.packet_digest || !integer(r.order_revision, 1) || !workOrderStates.includes(r.state) ||
    !validDeliveryCommandAck(projectId, original, value, "work_order", r.work_order_id) || !record(value.resource) || !exact(value.resource, ["kind", "id"])) return false;
  if (create ? r.state !== "queued" || r.order_revision !== 1 : r.work_order_id !== original.binding.work_order_id || r.request_digest !== original.binding.request_digest || r.order_revision !== Number(original.payload.order_revision) + 1) return false;
  const states = original.action === "work_order.claim" ? ["claimed"] : original.action === "work_order.progress" ? [original.binding.state] : original.action === "work_order.cancel" ? [original.binding.state === "queued" ? "closed" : "cancel_requested"] :
    original.action === "work_order.release" ? ["closed"] : original.action === "work_order.report" ? ["reported"] : ["queued"];
  if (!states.includes(r.state) || (original.action === "work_order.report" ? r.submission_id !== original.payload.submission_id : r.submission_id !== null)) return false;
  const expected = [`work_order:${r.work_order_id}`, `task:${taskId}`, ...(original.action === "work_order.report" ? [`task_submission:${r.submission_id}`] : [])];
  if (!value.affected_refs.every((ref: unknown) => record(ref) && exact(ref, ["kind", "id"]))) return false;
  const refs = value.affected_refs.map((ref: { kind: string; id: string }) => `${ref.kind}:${ref.id}`);
  return refs.length === expected.length && new Set(refs).size === refs.length && expected.every((ref) => refs.includes(ref));
}

export function createWorkOrderOriginal(preview: WorkOrderPreview, instructions: string, key: string): WorkOrderOriginal {
  if (!preview.complete || !preview.allowed || !preview.can_dispatch || !preview.preview_basis || !preview.packet_digest || !preview.native_boundary_digest || !preview.executor?.available) throw new Error("workOrderPreviewRequired");
  const value: WorkOrderOriginal = { action: "work_order.create", payload: { task_id: preview.task_id, task_basis: preview.task_basis, definition_digest: preview.definition_digest, native_boundary_digest: preview.native_boundary_digest,
    executor_member_id: preview.executor.id, preview_basis: preview.preview_basis, instructions, ...(preview.feedback_context ? { feedback_reference: structuredClone(preview.feedback_context.reference) } : {}) }, intent: { version: preview.version, key }, binding: { task_id: preview.task_id, work_order_id: null, request_digest: null, packet_digest: preview.packet_digest, state: null } };
  if (!validWorkOrderOriginal(value, preview.task_id)) throw new Error("workOrderInvalid"); return value;
}
export function workOrderActionOriginal(detail: WorkOrderDetail, action: Exclude<WorkOrderAction, "work_order.create">, extra: Record<string, unknown>, key: string): WorkOrderOriginal {
  const w = detail.work_order;
  if (!detail.permissions[permission[action]]) throw new Error("workOrderNotAllowed");
  const value: WorkOrderOriginal = { action, payload: { id: w.id, order_revision: w.order_revision, ...extra }, intent: { version: detail.version, key },
    binding: { task_id: w.task_id, work_order_id: w.id, request_digest: w.request_digest, packet_digest: w.packet_digest, state: w.state } };
  if (!validWorkOrderOriginal(value, w.task_id)) throw new Error("workOrderInvalid"); return value;
}
export function workOrderStorageKey(projectId: string, taskId: string) {
  return submissionIdentity(projectId) && submissionIdentity(taskId) ? eventRetryDraftKey(projectId, `work-order:${taskId}`)?.replace("sop.event-retry.v1:", "sop.work-order.v1:") || null : null;
}
export function workOrderRecoveryPending(projectId: string, taskId: string) {
  const key = workOrderStorageKey(projectId, taskId); if (!key) return false;
  try { const raw = sessionStorage.getItem(key); if (!raw) return false; if (raw.length > maxOriginal * 2) return true; const saved: unknown = JSON.parse(raw); return !record(saved) || saved.phase !== "refused" || !validWorkOrderOriginal(saved.original, taskId); } catch { return true; }
}
export function createWorkOrderController(options: Omit<DeliveryControllerOptions<WorkOrderOriginal>, "validateOriginal" | "validateAck"> & { taskId: string }) {
  return createDeliveryCommandController({ ...options, retainSucceededOnRestore: true,
    load: () => { const raw = options.load(); if (raw !== null && raw.length > maxOriginal * 2) throw new Error("retainedOriginalInvalid"); return raw; },
    save: (raw) => { if (raw.length > maxOriginal * 2) throw new Error("retainedOriginalUnavailable"); options.save(raw); },
    validateOriginal: (value) => validWorkOrderOriginal(value, options.taskId), validateAck: (original, value) => validWorkOrderAck(options.projectId, options.taskId, original, value),
  });
}
export function discoverWorkOrderRecovery(projectId: string, includeRefused = false) {
  return discoverTaskExternalRecovery(projectId, { prefix: "sop.work-order.v1:", receiptPrefix: "work-order:", key: workOrderStorageKey, identity: submissionIdentity, pending: workOrderRecoveryPending, includeRefused });
}
export function useWorkOrderCommand(projectId: string, taskId: string, _sessionId: string, onPending?: (value: boolean) => void) {
  return useTaskExternalCommand<WorkOrderOriginal>({ projectId, taskId, kind: "work-order", storageKey: () => workOrderStorageKey(projectId, taskId), onPending,
    create: (options) => { const send = bindSessionRequest({ projectId, revision: getSessionRevision() || "" }); return createWorkOrderController({ ...options, taskId,
      send: (original) => send("/api/v1/delivery/commands", { method: "POST", headers: { "X-Project-Id": projectId }, body: JSON.stringify({ action: original.action, payload: original.payload, expected_version: original.intent.version, idempotency_key: original.intent.key }) }),
    }); },
  });
}
export type WorkOrderCommand = ReturnType<typeof useWorkOrderCommand>;
