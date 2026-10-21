import { useRef } from "react";
import { saveDelivery, type DeliveryIntent } from "./delivery";
import { createDeliveryCommandController, useDeliveryCommand, validDeliveryCommandAck, type DeliveryControllerOptions } from "./deliveryCommandController";
import { eventRetryDraftKey } from "./eventReceipts";

export type ExecutionReviewOriginal = {
  action: "execution.review";
  payload: { id: string; run_version: number; decision: "accept" | "request_changes"; comment: string };
  intent: DeliveryIntent;
  runId: string;
  taskId: string;
  workspaceId: string;
};
const MAX_RETAINED_LENGTH = 32000;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const id = (value: unknown, max = 64): value is string => typeof value === "string" && Boolean(value) && value.length <= max && !/[\s\u0000-\u001f\u007f-\u009f]/.test(value);
const taskId = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value === value.trim() && Array.from(value).length <= 64 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const integer = (value: unknown, min: number) => Number.isSafeInteger(value) && Number(value) >= min;
function validOriginal(value: unknown, executionId: string): value is ExecutionReviewOriginal {
  if (!record(value) || !keys(value, ["action", "payload", "intent", "runId", "taskId", "workspaceId"]) || value.action !== "execution.review" ||
    !record(value.payload) || !record(value.intent) || !id(executionId) || !taskId(value.taskId) || ![value.runId, value.workspaceId].every((part) => id(part))) return false;
  const payload = value.payload, intent = value.intent;
  return keys(payload, ["id", "run_version", "decision", "comment"]) && payload.id === executionId && integer(payload.run_version, 1) &&
    ["accept", "request_changes"].includes(String(payload.decision)) && typeof payload.comment === "string" && Boolean(payload.comment.trim()) &&
    payload.comment === payload.comment.trim() && payload.comment.length <= 4000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(payload.comment) &&
    Object.keys(intent).every((key) => ["version", "key", "signature"].includes(key)) && integer(intent.version, 0) && id(intent.key, 100) && intent.key.length >= 8 &&
    (intent.signature === undefined || intent.signature === JSON.stringify([value.action, payload]));
}
/** The original review API returns a null result and only its exact E reference. */
export function validExecutionReviewAck(projectId: string, executionId: string, original: ExecutionReviewOriginal, value: unknown) {
  if (!validOriginal(original, executionId) || !validDeliveryCommandAck(projectId, original, value, "execution", executionId) ||
    !keys(value as unknown as Record<string, unknown>, ["project_id", "action", "resource", "result", "affected_refs", "applied_version", "version", "query_generation", "replayed"]) ||
    !keys(value.resource, ["kind", "id"]) || value.result !== null || value.affected_refs.length !== 1 ||
    !keys(value.affected_refs[0], ["kind", "id"]) || value.affected_refs[0].kind !== "execution" || value.affected_refs[0].id !== executionId) return false;
  try { return JSON.stringify({ phase: "succeeded", original, ack: value }).length <= MAX_RETAINED_LENGTH; } catch { return false; }
}
export function executionReviewStorageKey(projectId: string, executionId: string) {
  return id(projectId) && id(executionId)
    ? eventRetryDraftKey(projectId, executionId)?.replace("sop.event-retry.v1:", "sop.execution-review.v1:") || null : null;
}
export function executionReviewRecoveryPending(projectId: string, executionId: string) {
  const key = executionReviewStorageKey(projectId, executionId);
  if (!key) return false;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return false;
    if (raw.length > MAX_RETAINED_LENGTH) return true;
    const saved: unknown = JSON.parse(raw);
    return !record(saved) || !validOriginal(saved.original, executionId) || saved.phase !== "refused";
  } catch { return true; }
}
export function createExecutionReviewController(options: Omit<DeliveryControllerOptions<ExecutionReviewOriginal>, "validateOriginal" | "validateAck"> & { executionId: string }) {
  return createDeliveryCommandController({ ...options,
    load: () => {
      if (!id(options.projectId) || !id(options.executionId)) throw new Error("retainedOriginalInvalid");
      const raw = options.load();
      if (raw !== null && (typeof raw !== "string" || raw.length > MAX_RETAINED_LENGTH)) throw new Error("retainedOriginalInvalid");
      return raw;
    },
    save: (raw) => { if (raw.length > MAX_RETAINED_LENGTH) throw new Error("retainedOriginalUnavailable"); options.save(raw); },
    validateOriginal: (original) => validOriginal(original, options.executionId),
    validateAck: (original, value) => validExecutionReviewAck(options.projectId, options.executionId, original, value),
  });
}
export function useExecutionReviewCommand(projectId: string, executionId: string, sessionId: string, onPending?: (value: boolean) => void) {
  const key = executionReviewStorageKey(projectId, executionId), identity = JSON.stringify([projectId, executionId, sessionId]);
  const active = useRef(identity), controller = useRef<{ snapshot: () => { phase: string } }>();
  active.current = identity;
  const command = useDeliveryCommand<ExecutionReviewOriginal>({ projectId, identity, storageKey: () => key,
    onPending: (value) => onPending?.(value || controller.current?.snapshot().phase === "succeeded"),
    create: (options) => createExecutionReviewController({ ...options, executionId,
      scope: `${options.scope}\n${identity}`, currentScope: () => `${options.currentScope()}\n${active.current}`,
      load: () => { if (!key) throw new Error("retainedOriginalUnavailable"); return options.load(); },
      send: (original) => saveDelivery(projectId, "execution.review", original.payload, original.intent.version, original.intent.key),
    }),
  });
  controller.current = command;
  return command;
}
