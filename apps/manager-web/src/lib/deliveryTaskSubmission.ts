import { useRef } from "react";
import type { DeliveryCommandAck, DeliveryIntent } from "./delivery";
import type { ExecutionPreview } from "./deliveryExecution";
import { createDeliveryCommandController, useDeliveryCommand, validDeliveryCommandAck, type DeliveryControllerOptions } from "./deliveryCommandController";
import { eventRetryDraftKey } from "./eventReceipts";
import { bindSessionRequest } from "./http";
import { getSessionRevision } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";
import { request } from "./http";
import { validDesignReferences } from "./designLibrary";
import type { WorkOrderExecutor } from "./externalWorkOrders";

export type SubmissionSource = { kind: "human" | "agent" | "tool"; name: string; url: string };
export type SubmissionArtifact = { id: string; title: string; content: string; url: string; sha256: string | null };
export type SubmissionCriterion = { source: "task" | "requirement"; index: number; text_digest: string; result: "met" | "not_met" | "unknown"; evidence_ids: string[] };
export type SubmissionTest = { id: string; title: string; status: "passed" | "failed" | "skipped" | "not_run" | "unknown"; evidence_ids: string[] };
export type SubmissionWorkOrderBinding = { id: string; order_revision: number; stopped_attestation: true };
export type SubmissionWorkOrderContext = { id: string; order_revision: number; executor: WorkOrderExecutor };
export type TaskSubmissionPayload = { task_id: string; task_basis: string; definition_digest: string; native_boundary_digest: string; source: SubmissionSource; summary: string;
  artifacts: SubmissionArtifact[]; criteria: SubmissionCriterion[]; tests: SubmissionTest[]; work_order?: SubmissionWorkOrderBinding | null };
export type TaskSubmissionReviewPayload = { task_id: string; submission_id: string; submission_digest: string; task_basis: string; native_boundary_digest: string;
  decision: "accept" | "request_changes"; comment: string };
export type SubmissionActor = { id: string; name: string };
export type SubmissionReason = { code: string; message: string };
export type SubmissionDefinition = ExecutionPreview["snapshot"];
export type SubmissionSummary = { id: string; task_id: string; created_at: string; submitted_by: SubmissionActor; source: SubmissionSource; summary: string;
  digest: string; task_basis: string; definition_digest: string; native_boundary_digest: string; status: "awaiting_review" | "accepted" | "changes_requested" | "invalidated";
  invalidated: boolean; invalidated_at: string | null; invalidated_reason: string;
  counts: { artifacts: number; criteria: number; tests: number; reported_passed: number; reported_failed: number }; issue_id: string | null; review_id: string | null };
export type SubmissionCurrent = { project_id: string; task_id: string; version: number; query_generation: number | null; as_of: string;
  task_basis: string; definition_digest: string; native_boundary_digest: string; definition: SubmissionDefinition;
  criteria: Array<Pick<SubmissionCriterion, "source" | "index" | "text_digest"> & { text: string }>; can_submit: boolean; reasons: SubmissionReason[]; latest_submission_id: string | null;
  work_order: SubmissionWorkOrderContext | null };
export type SubmissionDetail = { project_id: string; task_id: string; version: number; as_of: string; task_basis: string | null; native_boundary_digest: string | null;
  submission: SubmissionSummary; payload: TaskSubmissionPayload; definition: SubmissionDefinition;
  decision: { id: string; review_id: string; decision: "accept" | "request_changes"; reviewer: SubmissionActor; comment: string; created_at: string } | null;
  permissions: { can_review: boolean; can_accept: boolean; reasons: SubmissionReason[] } };
export type SubmissionPage = { project_id: string; task_id: string; as_of: string; items: SubmissionSummary[]; total: number; limit: number; next_cursor: string | null };
export type SubmissionOriginal = { action: "task.delivery.submit" | "task.delivery.review"; payload: TaskSubmissionPayload | TaskSubmissionReviewPayload; intent: DeliveryIntent };

const record = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exact = (value: Record<string, any>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && Number(value) >= min;
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const text = (value: unknown, max: number, required = true): value is string => typeof value === "string" && Array.from(value).length <= max && !controls.test(value) && (!required || Boolean(value.trim()));
export const submissionIdentity = (value: unknown): value is string => text(value, 64) && value === value.trim() && value !== "." && value !== ".." && !/[\/\\\r\n\t]/.test(value);
const evidenceIdentity = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value);
export function parseSubmissionSelection(hash: string, projectId: string, taskId: string) {
  const params = new URLSearchParams(hash.split("?")[1]); if (!params.has("submission_id")) return { id: "", invalid: false };
  const id = params.get("submission_id");
  const path = hash.split("?")[0], taskParam = path === "#/dev-flow" ? "task" : path === "#/tasks/execution" ? "task_id" : null;
  const valid = taskParam !== null && !params.has(taskParam === "task" ? "task_id" : "task") &&
    params.getAll(taskParam).length === 1 && params.get(taskParam) === taskId && params.getAll("submission_id").length === 1 &&
    params.getAll("project_id").length === 1 && params.get("project_id") === projectId && evidenceIdentity(id);
  return { id: valid ? id : "", invalid: !valid };
}
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const time = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
export function submissionUrl(value: unknown): value is string {
  if (!text(value, 2000, false) || /[\r\n\t]/.test(value)) return false;
  if (!value) return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
}
const validSource = (value: unknown): value is SubmissionSource => record(value) && exact(value, ["kind", "name", "url"]) && ["human", "agent", "tool"].includes(value.kind) && text(value.name, 2000) && submissionUrl(value.url);
const validActor = (value: unknown) => record(value) && submissionIdentity(value.id) && typeof value.name === "string";
const validReasons = (value: unknown) => Array.isArray(value) && value.every((item) => record(item) && typeof item.code === "string" && typeof item.message === "string");
const workOrderIdentity = (value: unknown): value is string => submissionIdentity(value) && !/[\ud800-\udfff]/u.test(value);
export const validSubmissionWorkOrderBinding = (value: unknown): value is SubmissionWorkOrderBinding => record(value) && exact(value, ["id", "order_revision", "stopped_attestation"]) &&
  workOrderIdentity(value.id) && integer(value.order_revision, 1) && value.stopped_attestation === true;
export const validSubmissionWorkOrderContext = (value: unknown): value is SubmissionWorkOrderContext => record(value) && exact(value, ["id", "order_revision", "executor"]) &&
  workOrderIdentity(value.id) && integer(value.order_revision, 1) && record(value.executor) && exact(value.executor, ["id", "name", "kind", "tool", "active", "available", "reasons"]) &&
  text(value.executor.id, 100) && value.executor.id === value.executor.id.trim() && !/[\r\n\t]/.test(value.executor.id) &&
  typeof value.executor.name === "string" && ["agent", "tool"].includes(value.executor.kind) && typeof value.executor.tool === "string" &&
  typeof value.executor.active === "boolean" && typeof value.executor.available === "boolean" && validReasons(value.executor.reasons);
const validDefinition = (value: unknown, taskId: string): value is SubmissionDefinition => record(value) && value.task_id === taskId && typeof value.title === "string" && typeof value.description === "string" &&
  typeof value.assigned_to === "string" && Array.isArray(value.task_acceptance_criteria) && value.task_acceptance_criteria.every((item: unknown) => text(item, 2000)) &&
  Array.isArray(value.acceptance_criteria) && value.acceptance_criteria.every((item: unknown) => text(item, 2000)) && record(value.dependency_basis) && validDesignReferences(value.designs) && digest(value.design_basis) &&
  (value.owner === null || record(value.owner) && text(value.owner.id, 100) && value.owner.id === value.owner.id.trim() && !/[\r\n\t]/.test(value.owner.id) && typeof value.owner.active === "boolean") &&
  (value.requirement === null || record(value.requirement) && submissionIdentity(value.requirement.id) && integer(value.requirement.revision, 1) &&
    Array.isArray(value.requirement.acceptance_criteria) && value.requirement.acceptance_criteria.every((item: unknown) => text(item, 2000)) && Array.isArray(value.requirement.criteria_indices));
export const validSubmissionDefinition = validDefinition;

export function validSubmissionPayload(value: unknown, taskId: string): value is TaskSubmissionPayload {
  if (!record(value) || !exact(value, ["task_id", "task_basis", "definition_digest", "native_boundary_digest", "source", "summary", "artifacts", "criteria", "tests", ...(Object.hasOwn(value, "work_order") ? ["work_order"] : [])]) || value.task_id !== taskId ||
    (Object.hasOwn(value, "work_order") && value.work_order !== null && !validSubmissionWorkOrderBinding(value.work_order)) ||
    !digest(value.task_basis) || !digest(value.definition_digest) || !digest(value.native_boundary_digest) || !validSource(value.source) || !text(value.summary, 2000) ||
    !Array.isArray(value.artifacts) || value.artifacts.length < 1 || value.artifacts.length > 40 || !Array.isArray(value.criteria) || value.criteria.length < 1 || value.criteria.length > 160 || !Array.isArray(value.tests) || value.tests.length > 40) return false;
  if (!value.artifacts.every((item: unknown) => record(item) && exact(item, ["id", "title", "content", "url", "sha256"]) && evidenceIdentity(item.id) && text(item.title, 2000) && text(item.content, 8000, false) &&
    submissionUrl(item.url) && Boolean(item.content.trim() || item.url) && (item.sha256 === null || digest(item.sha256)))) return false;
  const ids = new Set(value.artifacts.map((item: SubmissionArtifact) => item.id));
  const refs = (value: unknown, required: boolean) => Array.isArray(value) && value.length <= 40 && (!required || value.length > 0) && new Set(value).size === value.length && value.every((id) => evidenceIdentity(id) && ids.has(id));
  if (ids.size !== value.artifacts.length || !value.criteria.every((item: unknown) => record(item) && exact(item, ["source", "index", "text_digest", "result", "evidence_ids"]) &&
    ["task", "requirement"].includes(item.source) && integer(item.index) && digest(item.text_digest) && ["met", "not_met", "unknown"].includes(item.result) && refs(item.evidence_ids, item.result !== "unknown")) ||
    new Set(value.criteria.map((item: SubmissionCriterion) => `${item.source}:${item.index}`)).size !== value.criteria.length ||
    !value.tests.every((item: unknown) => record(item) && exact(item, ["id", "title", "status", "evidence_ids"]) && evidenceIdentity(item.id) && text(item.title, 2000) &&
      ["passed", "failed", "skipped", "not_run", "unknown"].includes(item.status) && refs(item.evidence_ids, ["passed", "failed"].includes(item.status))) || new Set(value.tests.map((item: SubmissionTest) => item.id)).size !== value.tests.length) return false;
  try { return new TextEncoder().encode(JSON.stringify(value)).length <= 48 * 1024; } catch { return false; }
}
export function validSubmissionReview(value: unknown, taskId: string): value is TaskSubmissionReviewPayload {
  return record(value) && exact(value, ["task_id", "submission_id", "submission_digest", "task_basis", "native_boundary_digest", "decision", "comment"]) && value.task_id === taskId && evidenceIdentity(value.submission_id) &&
    digest(value.submission_digest) && digest(value.task_basis) && digest(value.native_boundary_digest) && ["accept", "request_changes"].includes(value.decision) && text(value.comment, 4000);
}
export function validSubmissionSummary(value: unknown, taskId: string): value is SubmissionSummary {
  return record(value) && evidenceIdentity(value.id) && value.task_id === taskId && time(value.created_at) && validActor(value.submitted_by) && validSource(value.source) && text(value.summary, 240, false) &&
    digest(value.digest) && digest(value.task_basis) && digest(value.definition_digest) && digest(value.native_boundary_digest) && ["awaiting_review", "accepted", "changes_requested", "invalidated"].includes(value.status) &&
    typeof value.invalidated === "boolean" && (value.invalidated_at === null || time(value.invalidated_at)) && typeof value.invalidated_reason === "string" && record(value.counts) &&
    ["artifacts", "criteria", "tests", "reported_passed", "reported_failed"].every((key) => integer(value.counts[key])) && (value.issue_id === null || submissionIdentity(value.issue_id)) && (value.review_id === null || submissionIdentity(value.review_id));
}
function inScope(origin: string) { if (origin !== projectSessionKey()) throw new Error("submissionScopeChanged"); }
function base(projectId: string, taskId: string) { if (!submissionIdentity(projectId) || !submissionIdentity(taskId)) throw new Error("submissionInvalid"); return `/api/v1/delivery/tasks/${encodeURIComponent(taskId)}/delivery-submissions`; }
function outer(value: unknown, projectId: string, taskId: string): value is Record<string, any> { return record(value) && value.project_id === projectId && value.task_id === taskId && time(value.as_of); }
export async function readSubmissionCurrent(projectId: string, taskId: string, origin: string, signal?: AbortSignal): Promise<SubmissionCurrent> {
  inScope(origin); const value = await request<unknown>(`${base(projectId, taskId)}/current`, { headers: { "X-Project-Id": projectId }, signal }); inScope(origin);
  if (!outer(value, projectId, taskId) || !integer(value.version) || !(value.query_generation === null || integer(value.query_generation, 1)) || !digest(value.task_basis) || !digest(value.definition_digest) || !digest(value.native_boundary_digest) ||
    !validDefinition(value.definition, taskId) || !Array.isArray(value.criteria) || value.criteria.length > 160 || !value.criteria.every((item: unknown) => record(item) && ["task", "requirement"].includes(item.source) && integer(item.index) && text(item.text, 2000) && digest(item.text_digest)) ||
    new Set(value.criteria.map((item: SubmissionCriterion) => `${item.source}:${item.index}`)).size !== value.criteria.length || typeof value.can_submit !== "boolean" || !validReasons(value.reasons) || !(value.latest_submission_id === null || evidenceIdentity(value.latest_submission_id)) ||
    !(value.work_order === null || validSubmissionWorkOrderContext(value.work_order))) throw new Error("submissionInvalid");
  return value as SubmissionCurrent;
}
export async function readSubmissionDetail(projectId: string, taskId: string, submissionId: string, origin: string, signal?: AbortSignal): Promise<SubmissionDetail> {
  inScope(origin); if (!evidenceIdentity(submissionId)) throw new Error("submissionInvalid");
  const value = await request<unknown>(`${base(projectId, taskId)}/${encodeURIComponent(submissionId)}`, { headers: { "X-Project-Id": projectId }, signal }); inScope(origin);
  if (!outer(value, projectId, taskId) || !integer(value.version) || !(value.task_basis === null || digest(value.task_basis)) || !(value.native_boundary_digest === null || digest(value.native_boundary_digest)) ||
    !validSubmissionSummary(value.submission, taskId) || value.submission.id !== submissionId || !validSubmissionPayload(value.payload, taskId) || value.payload.task_basis !== value.submission.task_basis ||
    value.payload.definition_digest !== value.submission.definition_digest || value.payload.native_boundary_digest !== value.submission.native_boundary_digest || !validDefinition(value.definition, taskId) ||
    !record(value.permissions) || typeof value.permissions.can_review !== "boolean" || typeof value.permissions.can_accept !== "boolean" || !validReasons(value.permissions.reasons) ||
    !(value.decision === null || record(value.decision) && evidenceIdentity(value.decision.id) && evidenceIdentity(value.decision.review_id) && value.decision.review_id === value.submission.review_id &&
      ["accept", "request_changes"].includes(value.decision.decision) && validActor(value.decision.reviewer) && text(value.decision.comment, 4000) && time(value.decision.created_at))) throw new Error("submissionInvalid");
  return value as SubmissionDetail;
}
export async function readSubmissions(projectId: string, taskId: string, origin: string, cursor = "", signal?: AbortSignal): Promise<SubmissionPage> {
  inScope(origin); if (typeof cursor !== "string" || cursor.length > 4000 || /[\u0000-\u001f\u007f-\u009f]/.test(cursor)) throw new Error("submissionInvalid");
  const query = new URLSearchParams({ limit: "20" }); if (cursor) query.set("cursor", cursor);
  const value = await request<unknown>(`${base(projectId, taskId)}?${query}`, { headers: { "X-Project-Id": projectId }, signal }); inScope(origin);
  if (!outer(value, projectId, taskId) || !Array.isArray(value.items) || value.items.length > 20 || !value.items.every((item: unknown) => validSubmissionSummary(item, taskId)) || new Set(value.items.map((item: SubmissionSummary) => item.id)).size !== value.items.length ||
    !integer(value.total) || value.total < value.items.length || value.limit !== 20 || !(value.next_cursor === null || typeof value.next_cursor === "string" && value.next_cursor.length > 0 && value.next_cursor.length <= 4000 && value.next_cursor !== cursor && !/[\u0000-\u001f\u007f-\u009f]/.test(value.next_cursor))) throw new Error("submissionInvalid");
  return value as SubmissionPage;
}
export function validSubmissionOriginal(value: unknown, taskId: string): value is SubmissionOriginal {
  return record(value) && exact(value, ["action", "payload", "intent"]) && record(value.intent) && exact(value.intent, ["version", "key"]) && integer(value.intent.version) &&
    typeof value.intent.key === "string" && value.intent.key.length >= 8 && value.intent.key.length <= 100 && !/[\s\u0000-\u001f\u007f-\u009f]/.test(value.intent.key) &&
    (value.action === "task.delivery.submit" ? validSubmissionPayload(value.payload, taskId) : value.action === "task.delivery.review" && validSubmissionReview(value.payload, taskId));
}
export function validSubmissionAck(projectId: string, taskId: string, original: SubmissionOriginal, value: unknown): value is DeliveryCommandAck {
  if (!validSubmissionOriginal(original, taskId) || !record(value) || !record(value.result)) return false;
  const result = value.result, submit = original.action === "task.delivery.submit";
  const binding = submit ? (original.payload as TaskSubmissionPayload).work_order : null;
  if (!exact(result, ["task_ids", "submission_id", "submission_digest", "issue_id", ...(submit ? [] : ["decision_id", "review_id"]), ...(binding ? ["work_order"] : [])]) ||
    !Array.isArray(result.task_ids) || result.task_ids.length !== 1 || result.task_ids[0] !== taskId || !evidenceIdentity(result.submission_id) || !digest(result.submission_digest) || !(result.issue_id === null || submissionIdentity(result.issue_id))) return false;
  if (binding && (!record(result.work_order) || !exact(result.work_order, ["id", "order_revision", "state"]) || result.work_order.id !== binding.id ||
    !integer(result.work_order.order_revision, 1) || result.work_order.order_revision !== binding.order_revision + 1 || result.work_order.state !== "reported")) return false;
  if (!submit) { const p = original.payload as TaskSubmissionReviewPayload; if (result.submission_id !== p.submission_id || result.submission_digest !== p.submission_digest || !evidenceIdentity(result.decision_id) || !evidenceIdentity(result.review_id)) return false; }
  const resourceId = submit ? result.submission_id : result.review_id, kind = submit ? "task_submission" : "task_review";
  if (!validDeliveryCommandAck(projectId, original, value, kind, resourceId) || !exact(value, ["project_id", "action", "resource", "result", "affected_refs", "applied_version", "version", "query_generation", "replayed"])) return false;
  const expected = [`${kind}:${resourceId}`, `task:${taskId}`, ...(!submit ? [`task_submission:${result.submission_id}`] : []), ...(result.issue_id ? [`issue:${result.issue_id}`] : []), ...(binding ? [`work_order:${binding.id}`] : [])];
  const refs = value.affected_refs.map((ref) => `${ref.kind}:${ref.id}`);
  return refs.length === expected.length && new Set(refs).size === refs.length && expected.every((ref) => refs.includes(ref));
}
export function submissionStorageKey(projectId: string, taskId: string) { return submissionIdentity(projectId) && submissionIdentity(taskId) ? eventRetryDraftKey(projectId, `external-submission:${taskId}`)?.replace("sop.event-retry.v1:", "sop.task-submission.v1:") || null : null; }
export function externalDeliveryRecoveryPending(projectId: string, taskId: string) {
  const key = submissionStorageKey(projectId, taskId); if (!key) return false;
  try { const raw = sessionStorage.getItem(key); if (!raw) return false; if (raw.length > 160000) return true; const value: unknown = JSON.parse(raw); return !record(value) || value.phase !== "refused" || !validSubmissionOriginal(value.original, taskId); } catch { return true; }
}
export function createSubmissionController(options: Omit<DeliveryControllerOptions<SubmissionOriginal>, "validateOriginal" | "validateAck"> & { taskId: string }) {
  return createDeliveryCommandController({ ...options,
    load: () => { const raw = options.load(); if (raw !== null && raw.length > 160000) throw new Error("retainedOriginalInvalid"); return raw; },
    save: (raw) => { if (raw.length > 160000) throw new Error("retainedOriginalUnavailable"); options.save(raw); },
    validateOriginal: (value) => validSubmissionOriginal(value, options.taskId), validateAck: (original, value) => validSubmissionAck(options.projectId, options.taskId, original, value),
  });
}
export function useSubmissionCommand(projectId: string, taskId: string, sessionId: string, onPending?: (value: boolean) => void) {
  const identity = JSON.stringify([projectId, taskId, sessionId]), active = useRef(identity); active.current = identity;
  return useDeliveryCommand<SubmissionOriginal>({ projectId, identity: `${sessionId}:${taskId}`, storageKey: () => submissionStorageKey(projectId, taskId), onPending,
    create: (options) => { const read = bindSessionRequest({ projectId, revision: getSessionRevision() || "" }); return createSubmissionController({ ...options, taskId,
      scope: `${options.scope}\n${identity}`, currentScope: () => `${options.currentScope()}\n${active.current}`,
      load: () => { if (!submissionStorageKey(projectId, taskId)) throw new Error("retainedOriginalUnavailable"); return options.load(); },
      send: (original) => read("/api/v1/delivery/commands", { method: "POST", headers: { "X-Project-Id": projectId }, body: JSON.stringify({ action: original.action, payload: original.payload, expected_version: original.intent.version, idempotency_key: original.intent.key }) }),
    }); },
  });
}
