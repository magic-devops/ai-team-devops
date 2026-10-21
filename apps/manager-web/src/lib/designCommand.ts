import { useRef } from "react";
import type { DeliveryCommandAck, DeliveryIntent } from "./delivery";
import { createDeliveryCommandController, useDeliveryCommand, validDeliveryCommandAck, type DeliveryControllerOptions } from "./deliveryCommandController";
import { bindSessionRequest } from "./http";
import { getSessionRevision } from "./authStorage";
import { eventRetryDraftKey } from "./eventReceipts";
import { designDigest, designExact, designIdentity, designRecord, designSlots, validDesignContent, type DesignTarget } from "./designLibrary";

export type DesignAction = "design.document.create" | "design.revision.save" | "design.revision.restore" | "design.document.archive" | "requirement.design.adopt" | "requirement.design.clear" | "task.design.adopt" | "task.design.clear";
export type DesignOriginal = { action: DesignAction; payload: Record<string, any>; intent: DeliveryIntent };
const integer = (value: unknown, min = 0) => Number.isSafeInteger(value) && Number(value) >= min;
const baseKeys = ["document_id", "document_version", "base_revision_id", "base_revision_digest"];
const contentKeys = ["title", "category", "tags", "content", "note"];
const base = (value: Record<string, any>) => designIdentity(value.document_id) && integer(value.document_version, 1) && designIdentity(value.base_revision_id) && designDigest(value.base_revision_digest);
export function validDesignOriginal(value: unknown): value is DesignOriginal {
  if (!designRecord(value) || !designExact(value, ["action", "payload", "intent"]) || !designRecord(value.intent) || !designExact(value.intent, ["version", "key"]) || !integer(value.intent.version) || typeof value.intent.key !== "string" || value.intent.key.length < 8 || value.intent.key.length > 100 || /[\s\u0000-\u001f\u007f-\u009f]/.test(value.intent.key) || !designRecord(value.payload)) return false;
  const p = value.payload;
  if (value.action === "design.document.create") return designExact(p, contentKeys) && validDesignContent(p);
  if (value.action === "design.revision.save") return designExact(p, [...contentKeys, ...baseKeys, ...(Object.hasOwn(p, "preview_id") ? ["preview_id"] : [])]) && validDesignContent(p) && base(p) && (!Object.hasOwn(p, "preview_id") || p.preview_id === null || designIdentity(p.preview_id));
  if (value.action === "design.revision.restore") return designExact(p, [...baseKeys, "revision_id", "revision_digest", "note"]) && base(p) && designIdentity(p.revision_id) && designDigest(p.revision_digest) && typeof p.note === "string" && Array.from(p.note).length <= 300;
  if (value.action === "design.document.archive") return designExact(p, [...baseKeys, "archived"]) && base(p) && typeof p.archived === "boolean";
  if (!["requirement.design.adopt", "requirement.design.clear", "task.design.adopt", "task.design.clear"].includes(value.action)) return false;
  const target = value.action.startsWith("task.") ? "task_id" : "requirement_id", adopt = value.action.endsWith(".adopt");
  return designExact(p, [target, "target_basis", "design_basis", "preview_basis", "slot", "comment", ...(adopt ? ["document_id", "revision_id", "revision_digest"] : [])]) && designIdentity(p[target]) && [p.target_basis, p.design_basis, p.preview_basis].every(designDigest) && designSlots.includes(p.slot) && typeof p.comment === "string" && Boolean(p.comment.trim()) && Array.from(p.comment).length <= 4000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(p.comment) && (!adopt || designIdentity(p.document_id) && designIdentity(p.revision_id) && designDigest(p.revision_digest));
}
export function validDesignAck(projectId: string, original: DesignOriginal, value: unknown): value is DeliveryCommandAck {
  if (!validDesignOriginal(original) || !designRecord(value) || !designExact(value, ["project_id", "action", "resource", "result", "affected_refs", "applied_version", "version", "query_generation", "replayed"]) || !designRecord(value.result)) return false;
  const r = value.result, document = original.action.startsWith("design."), p = original.payload;
  let expected: string[];
  if (document) {
    if (!designExact(r, ["document_id", "revision_id", "revision_digest", "document_version"]) || !designIdentity(r.document_id) || !designIdentity(r.revision_id) || !designDigest(r.revision_digest) || !integer(r.document_version, 1) || original.action !== "design.document.create" && r.document_id !== p.document_id || !validDeliveryCommandAck(projectId, original, value, "design_document", r.document_id)) return false;
    if (r.document_version !== (original.action === "design.document.create" ? 1 : p.document_version + 1) || original.action === "design.document.archive" && (r.revision_id !== p.base_revision_id || r.revision_digest !== p.base_revision_digest)) return false;
    expected = [`design_document:${r.document_id}`, `design_revision:${r.revision_id}`];
  } else {
    const kind = original.action.startsWith("task.") ? "task" : "requirement", id = p[`${kind}_id`];
    if (!designExact(r, ["adoption_id", "target_kind", "target_id", "design_basis", "task_ids", "requirement_id"]) || !designIdentity(r.adoption_id) || r.target_kind !== kind || r.target_id !== id || !designDigest(r.design_basis) || !Array.isArray(r.task_ids) || r.task_ids.length > 10000 || !r.task_ids.every(designIdentity) || new Set(r.task_ids).size !== r.task_ids.length || !(r.requirement_id === null || designIdentity(r.requirement_id)) || kind === "requirement" && r.requirement_id !== id || !validDeliveryCommandAck(projectId, original, value, "design_adoption", r.adoption_id)) return false;
    if (kind === "task" && !r.task_ids.includes(id)) return false;
    expected = [...new Set([`design_adoption:${r.adoption_id}`, `${kind}:${id}`, ...r.task_ids.map((task: string) => `task:${task}`), ...(r.requirement_id ? [`requirement:${r.requirement_id}`] : [])])];
  }
  const refs = value.affected_refs.map((ref: { kind: string; id: string }) => `${ref.kind}:${ref.id}`);
  return refs.length === expected.length && new Set(refs).size === refs.length && expected.every((ref) => refs.includes(ref));
}
export function designStorageKey(projectId: string, target?: DesignTarget) { return eventRetryDraftKey(projectId, target ? `design:${target.kind}:${target.id}` : "design-library")?.replace("sop.event-retry.v1:", "sop.design.v1:") || null; }
export function designRecoveryPending(projectId: string, target?: DesignTarget) {
  const key = designStorageKey(projectId, target); if (!key) return false;
  try { const raw = sessionStorage.getItem(key); if (!raw) return false; if (raw.length > 2 * 1024 * 1024) return true; const value = JSON.parse(raw); return !designRecord(value) || value.phase !== "refused" || !validDesignOriginal(value.original); } catch { return true; }
}
export function createDesignController(options: Omit<DeliveryControllerOptions<DesignOriginal>, "validateOriginal" | "validateAck"> & { target?: DesignTarget }) {
  const bound = (value: DesignOriginal) => validDesignOriginal(value) && (options.target ? value.action.startsWith(`${options.target.kind}.design.`) && value.payload[`${options.target.kind}_id`] === options.target.id : value.action.startsWith("design."));
  return createDeliveryCommandController({ ...options, load: () => { const raw = options.load(); if (raw !== null && raw.length > 2 * 1024 * 1024) throw new Error("retainedOriginalInvalid"); return raw; }, save: (raw) => { if (raw.length > 2 * 1024 * 1024) throw new Error("retainedOriginalUnavailable"); options.save(raw); }, validateOriginal: bound, validateAck: (original, value) => bound(original) && validDesignAck(options.projectId, original, value) });
}
export function useDesignCommand(projectId: string, identity: string, target?: DesignTarget, onPending?: (pending: boolean) => void) {
  const active = useRef(identity); active.current = identity;
  return useDeliveryCommand<DesignOriginal>({ projectId, identity, storageKey: () => designStorageKey(projectId, target), onPending,
    create: (options) => { const send = bindSessionRequest({ projectId, revision: getSessionRevision() || "" }); return createDesignController({ ...options, target, scope: `${options.scope}\n${identity}`, currentScope: () => `${options.currentScope()}\n${active.current}`, send: (original) => send("/api/v1/delivery/commands", { method: "POST", headers: { "X-Project-Id": projectId }, body: JSON.stringify({ action: original.action, payload: original.payload, expected_version: original.intent.version, idempotency_key: original.intent.key }) }) }); },
  });
}
