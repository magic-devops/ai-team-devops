import { canonicalDeliveryJson } from "./deliveryCanonical";
import { verifyFeedbackFields, validFeedbackReference, type FeedbackFields, type FeedbackReference } from "./deliveryFeedback";
import { request } from "./http";
import { projectSessionKey } from "./projectPortfolio";
import { submissionIdentity, validSubmissionDefinition } from "./deliveryTaskSubmission";
import type { ExecutionPreview } from "./deliveryExecution";
import { fetchTaskPage } from "./deliveryQuery";

export const workOrderStates = ["queued", "claimed", "cancel_requested", "reported", "closed"] as const;
export type WorkOrderState = typeof workOrderStates[number];
export type WorkOrderReason = { code: string; message: string };
export type WorkOrderActor = { id: string; name: string };
export type WorkOrderExecutor = { id: string; name: string; kind: "agent" | "tool"; tool: string; active: boolean; available: boolean; reasons: WorkOrderReason[] };
export type WorkOrderDefinition = ExecutionPreview["snapshot"];
export type WorkOrderEnvelope = { project_id: string; version: number; query_generation: number | null; as_of: string };
export type WorkOrderCurrent = WorkOrderEnvelope & { task_id: string; task_basis: string; definition_digest: string; native_boundary_digest: string | null;
  definition: WorkOrderDefinition; executors: WorkOrderExecutor[]; active_work_order_id: string | null; can_dispatch: boolean; reasons: WorkOrderReason[] };
export type WorkOrderPreview = WorkOrderCurrent & FeedbackFields & { complete: boolean; allowed: boolean; preview_basis: string | null; packet_digest: string | null; executor: WorkOrderExecutor | null; max_packet_bytes: number };
export type WorkOrderPreviewInput = { feedback_reference?: FeedbackReference | null; task_basis: string; executor_member_id: string; instructions: string };
export type WorkOrderSummary = { id: string; task_id: string; task_title: string; order_revision: number; state: WorkOrderState; request_digest: string; packet_digest: string;
  definition_digest: string; native_boundary_digest: string; executor: WorkOrderExecutor; requested_by: WorkOrderActor; claimed_by: WorkOrderActor | null; created_at: string; updated_at: string;
  claimed_at: string | null; invalidated: boolean; invalidated_reason: string | null;
  progress: { percent: number | null; status: "running" | "blocked"; message: string; reported_at: string; source: "external_reported" } | null;
  submission: { id: string; digest: string } | null; delivery_state: "awaiting_review" | "accepted" | "changes_requested" | "invalidated" | null;
  closure: { kind: "never_claimed" | "external_reported_stop"; actor: WorkOrderActor; comment: string; at: string } | null };
export type WorkOrderPage = WorkOrderEnvelope & { items: WorkOrderSummary[]; total: number; limit: number; next_cursor: string | null };
export type WorkOrderDetail = WorkOrderEnvelope & FeedbackFields & { work_order: WorkOrderSummary; definition: WorkOrderDefinition; instructions: string;
  permissions: { can_claim: boolean; can_progress: boolean; can_cancel: boolean; can_release: boolean; can_report: boolean; reasons: WorkOrderReason[] } };
export type WorkOrderPacket = WorkOrderEnvelope & { work_order_id: string; request_digest: string; packet_digest: string; packet: Record<string, unknown>; max_packet_bytes: number };

export const workOrderRecord = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export const workOrderExact = (value: Record<string, any>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
export const workOrderDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const workOrderInteger = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && Number(value) >= min;
export const workOrderText = (value: unknown, max = 4000, required = true): value is string => typeof value === "string" && Array.from(value).length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value) && (!required || Boolean(value.trim()));
export const workOrderMemberIdentity = (value: unknown): value is string => workOrderText(value, 100) && value === value.trim() && !/[\r\n\t]/.test(value);
const time = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const nullableId = (value: unknown) => value === null || submissionIdentity(value);
const reasons = (value: unknown): value is WorkOrderReason[] => Array.isArray(value) && value.every((item) => workOrderRecord(item) && workOrderExact(item, ["code", "message"]) && typeof item.code === "string" && typeof item.message === "string");
const actor = (value: unknown): value is WorkOrderActor => workOrderRecord(value) && workOrderExact(value, ["id", "name"]) && submissionIdentity(value.id) && typeof value.name === "string";
const executor = (value: unknown): value is WorkOrderExecutor => workOrderRecord(value) && workOrderExact(value, ["id", "name", "kind", "tool", "active", "available", "reasons"]) &&
  workOrderMemberIdentity(value.id) && typeof value.name === "string" && ["agent", "tool"].includes(value.kind) && typeof value.tool === "string" && typeof value.active === "boolean" && typeof value.available === "boolean" && reasons(value.reasons);
const envelope = (value: unknown, projectId: string): value is Record<string, any> => workOrderRecord(value) && value.project_id === projectId && workOrderInteger(value.version) &&
  (value.query_generation === null || workOrderInteger(value.query_generation, 1)) && time(value.as_of);
export function validWorkOrderSummary(value: unknown): value is WorkOrderSummary {
  if (!workOrderRecord(value) || !workOrderExact(value, ["id", "task_id", "task_title", "order_revision", "state", "request_digest", "packet_digest", "definition_digest", "native_boundary_digest", "executor", "requested_by", "claimed_by", "created_at", "updated_at", "claimed_at", "invalidated", "invalidated_reason", "progress", "submission", "delivery_state", "closure"]) ||
    !submissionIdentity(value.id) || !submissionIdentity(value.task_id) || typeof value.task_title !== "string" || !workOrderInteger(value.order_revision, 1) || !workOrderStates.includes(value.state) ||
    ![value.request_digest, value.packet_digest, value.definition_digest, value.native_boundary_digest].every(workOrderDigest) || !executor(value.executor) || !actor(value.requested_by) ||
    !(value.claimed_by === null || actor(value.claimed_by)) || !time(value.created_at) || !time(value.updated_at) || !(value.claimed_at === null || time(value.claimed_at)) || typeof value.invalidated !== "boolean" || !(value.invalidated_reason === null || typeof value.invalidated_reason === "string")) return false;
  return (value.progress === null || workOrderRecord(value.progress) && workOrderExact(value.progress, ["percent", "status", "message", "reported_at", "source"]) &&
    (value.progress.percent === null || workOrderInteger(value.progress.percent) && value.progress.percent <= 100) && ["running", "blocked"].includes(value.progress.status) && typeof value.progress.message === "string" && time(value.progress.reported_at) && value.progress.source === "external_reported") &&
    (value.submission === null || workOrderRecord(value.submission) && workOrderExact(value.submission, ["id", "digest"]) && submissionIdentity(value.submission.id) && workOrderDigest(value.submission.digest)) &&
    (value.delivery_state === null || ["awaiting_review", "accepted", "changes_requested", "invalidated"].includes(value.delivery_state)) &&
    (value.closure === null || workOrderRecord(value.closure) && workOrderExact(value.closure, ["kind", "actor", "comment", "at"]) && ["never_claimed", "external_reported_stop"].includes(value.closure.kind) && actor(value.closure.actor) && typeof value.closure.comment === "string" && time(value.closure.at));
}
const currentKeys = ["project_id", "version", "query_generation", "as_of", "task_id", "task_basis", "definition_digest", "native_boundary_digest", "definition", "executors", "active_work_order_id", "can_dispatch", "reasons"];
function current(value: unknown, projectId: string, taskId: string): value is WorkOrderCurrent {
  return envelope(value, projectId) && value.task_id === taskId && workOrderDigest(value.task_basis) && workOrderDigest(value.definition_digest) &&
    (value.native_boundary_digest === null || workOrderDigest(value.native_boundary_digest)) && validSubmissionDefinition(value.definition, taskId) && Array.isArray(value.executors) && value.executors.every(executor) &&
    new Set(value.executors.map((item: WorkOrderExecutor) => item.id)).size === value.executors.length && nullableId(value.active_work_order_id) && typeof value.can_dispatch === "boolean" && reasons(value.reasons);
}
function assertScope(projectId: string, scope: string) { if (!submissionIdentity(projectId) || scope !== projectSessionKey()) throw new Error("workOrderScopeChanged"); }
function taskPath(taskId: string) { if (!submissionIdentity(taskId)) throw new Error("workOrderInvalid"); return `/api/v1/delivery/tasks/${encodeURIComponent(taskId)}`; }
function orderPath(orderId: string) { if (!submissionIdentity(orderId)) throw new Error("workOrderInvalid"); return `/api/v1/delivery/work-orders/${encodeURIComponent(orderId)}`; }
async function scopedRead(projectId: string, scope: string, path: string, signal?: AbortSignal, body?: WorkOrderPreviewInput) {
  assertScope(projectId, scope); const value = await request<unknown>(path, { headers: { "X-Project-Id": projectId }, signal, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) }); assertScope(projectId, scope); return value;
}
export async function readWorkOrderCurrent(projectId: string, taskId: string, scope: string, signal?: AbortSignal) {
  const value = await scopedRead(projectId, scope, `${taskPath(taskId)}/work-orders/current`, signal);
  if (!current(value, projectId, taskId) || !workOrderExact(value, currentKeys)) throw new Error("workOrderInvalid"); return value;
}
export async function readWorkOrderTasks(projectId: string, scope: string, q = "", cursor = "", signal?: AbortSignal) {
  if (!workOrderText(q, 200, false) || !workOrderText(cursor, 4000, false) || /[\r\n\t]/.test(cursor)) throw new Error("workOrderInvalid");
  assertScope(projectId, scope); const page = await fetchTaskPage(projectId, { q, cursor, limit: 20 }, signal); assertScope(projectId, scope);
  if (!envelope(page, projectId) || !Array.isArray(page.items) || page.items.length > 20 || page.limit !== 20 || !workOrderInteger(page.total) || page.total < page.items.length ||
    !page.items.every((item) => submissionIdentity(item.id) && typeof item.title === "string") || new Set(page.items.map((item) => item.id)).size !== page.items.length ||
    !(page.next_cursor === null || workOrderText(page.next_cursor, 4000) && page.next_cursor !== cursor)) throw new Error("workOrderInvalid");
  return page;
}
export async function previewWorkOrder(projectId: string, taskId: string, scope: string, input: WorkOrderPreviewInput, signal?: AbortSignal): Promise<WorkOrderPreview> {
  if (input.feedback_reference != null && !validFeedbackReference(input.feedback_reference) || !workOrderDigest(input.task_basis) || !workOrderMemberIdentity(input.executor_member_id) || !workOrderText(input.instructions, 4000, false)) throw new Error("workOrderInvalid");
  const response = await scopedRead(projectId, scope, `${taskPath(taskId)}/work-order-preview`, signal, input);
  if (!current(response, projectId, taskId)) throw new Error("workOrderInvalid");
  const value = response as WorkOrderPreview;
  if (!workOrderExact(value, [...currentKeys, "complete", "allowed", "preview_basis", "packet_digest", "executor", "max_packet_bytes", ...["feedback_context", "feedback_context_sha256"].filter((key) => Object.hasOwn(value, key))]) || typeof value.complete !== "boolean" || typeof value.allowed !== "boolean" ||
    !(value.preview_basis === null || workOrderDigest(value.preview_basis)) || !(value.packet_digest === null || workOrderDigest(value.packet_digest)) || !(value.executor === null || executor(value.executor)) || value.max_packet_bytes !== 524288 ||
    value.executor && value.executor.id !== input.executor_member_id || value.allowed && (value.task_basis !== input.task_basis || !value.complete || !value.can_dispatch || !value.preview_basis || !value.packet_digest || !value.native_boundary_digest || !value.executor?.available)) throw new Error("workOrderInvalid");
  const hasFeedback = Object.hasOwn(value, "feedback_context") || Object.hasOwn(value, "feedback_context_sha256");
  await verifyFeedbackFields(value, projectId, taskId, value.allowed || hasFeedback ? input.feedback_reference : undefined);
  assertScope(projectId, scope);
  return value as WorkOrderPreview;
}
export async function readWorkOrders(projectId: string, scope: string, options: { taskId?: string; state?: string; cursor?: string } = {}, signal?: AbortSignal): Promise<WorkOrderPage> {
  const { taskId = "", state = "", cursor = "" } = options;
  if (taskId && !submissionIdentity(taskId) || state && !workOrderStates.includes(state as WorkOrderState) || !workOrderText(cursor, 4000, false) || /[\r\n\t]/.test(cursor)) throw new Error("workOrderInvalid");
  const params = new URLSearchParams({ limit: "20" }); if (taskId) params.set("task_id", taskId); if (state) params.set("state", state); if (cursor) params.set("cursor", cursor);
  const value = await scopedRead(projectId, scope, `/api/v1/delivery/work-orders?${params}`, signal);
  if (!envelope(value, projectId) || !workOrderExact(value, ["project_id", "version", "query_generation", "as_of", "items", "total", "limit", "next_cursor"]) || !Array.isArray(value.items) || value.items.length > 20 ||
    !value.items.every((item: unknown) => validWorkOrderSummary(item) && (!taskId || item.task_id === taskId) && (!state || item.state === state)) || new Set(value.items.map((item: WorkOrderSummary) => item.id)).size !== value.items.length ||
    !workOrderInteger(value.total) || value.total < value.items.length || value.limit !== 20 || !(value.next_cursor === null || workOrderText(value.next_cursor, 4000) && value.next_cursor !== cursor && !/[\r\n\t]/.test(value.next_cursor))) throw new Error("workOrderInvalid");
  return value as WorkOrderPage;
}
export async function readWorkOrderDetail(projectId: string, orderId: string, scope: string, taskId = "", signal?: AbortSignal): Promise<WorkOrderDetail> {
  const value = await scopedRead(projectId, scope, orderPath(orderId), signal);
  if (!envelope(value, projectId) || !workOrderExact(value, ["project_id", "version", "query_generation", "as_of", "work_order", "definition", "instructions", "permissions", ...["feedback_context", "feedback_context_sha256"].filter((key) => Object.hasOwn(value, key))]) || !validWorkOrderSummary(value.work_order) || value.work_order.id !== orderId || taskId && value.work_order.task_id !== taskId ||
    !validSubmissionDefinition(value.definition, value.work_order.task_id) || !workOrderText(value.instructions, 4000, false) || !workOrderRecord(value.permissions) || !workOrderExact(value.permissions, ["can_claim", "can_progress", "can_cancel", "can_release", "can_report", "reasons"]) ||
    !["can_claim", "can_progress", "can_cancel", "can_release", "can_report"].every((key) => typeof value.permissions[key] === "boolean") || !reasons(value.permissions.reasons)) throw new Error("workOrderInvalid");
  await verifyFeedbackFields(value, projectId, value.work_order.task_id, value.feedback_context?.reference);
  assertScope(projectId, scope);
  return value as WorkOrderDetail;
}
export async function readWorkOrderPacket(projectId: string, order: WorkOrderSummary, scope: string, signal?: AbortSignal): Promise<WorkOrderPacket> {
  const value = await scopedRead(projectId, scope, `${orderPath(order.id)}/packet`, signal);
  if (!envelope(value, projectId) || !workOrderExact(value, ["project_id", "version", "query_generation", "as_of", "work_order_id", "request_digest", "packet_digest", "packet", "max_packet_bytes"]) || value.work_order_id !== order.id ||
    value.request_digest !== order.request_digest || value.packet_digest !== order.packet_digest || !workOrderRecord(value.packet) || value.packet.project_id !== projectId || value.packet.task_id !== order.task_id || value.max_packet_bytes !== 524288) throw new Error("workOrderInvalid");
  await verifyFeedbackFields(value.packet, projectId, order.task_id, value.packet.feedback_context?.reference);
  const bytes = new TextEncoder().encode(canonicalWorkOrderJson(value.packet));
  if (bytes.length > value.max_packet_bytes) throw new Error("workOrderInvalid");
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((part) => part.toString(16).padStart(2, "0")).join("");
  assertScope(projectId, scope);
  if (actual !== value.packet_digest) throw new Error("workOrderInvalid");
  return value as WorkOrderPacket;
}

export function canonicalWorkOrderJson(value: unknown): string { try { return canonicalDeliveryJson(value); } catch { throw new Error("workOrderInvalid"); } }
