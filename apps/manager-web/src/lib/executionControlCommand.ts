import { useRef } from "react";
import type { DeliveryIntent } from "./delivery";
import { createDeliveryCommandController, useDeliveryCommand, validDeliveryCommandAck, type DeliveryControllerOptions } from "./deliveryCommandController";
import { eventRetryDraftKey } from "./eventReceipts";
import { projectSessionKey } from "./projectPortfolio";
import { submitExecutionControl, type ExecutionControlAction, type ExecutionControlClosePayload, type ExecutionControlIntent, type ExecutionControlPayload } from "./executionRuntime";
import { validControlAcceptance, type ControlOperationDetail } from "./executionControlOperations";

export type ExecutionControlOriginal = {
  action: ExecutionControlAction | "execution.control.close";
  payload: Record<string, unknown>;
  intent: DeliveryIntent;
  workspaceId: string;
};
const actions = ["execution.start", "execution.retry", "execution.cancel", "execution.approval", "execution.control.close"];
const MAX_RETAINED_LENGTH = 100000;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const id = (value: unknown, max = 100): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\s\u0000-\u001f\u007f-\u009f]/.test(value);
const integer = (value: unknown, min: number) => Number.isSafeInteger(value) && Number(value) >= min;

function validOriginal(value: unknown, executionId: string): value is ExecutionControlOriginal {
  if (!record(value) || !keys(value, ["action", "payload", "intent", "workspaceId"]) || !actions.includes(String(value.action)) ||
    !id(value.workspaceId) || !record(value.payload) || !record(value.intent)) return false;
  const p = value.payload, intent = value.intent, approval = value.action === "execution.approval";
  const close = value.action === "execution.control.close";
  return (close ? keys(p, ["id", "control_operation_id", "request_digest", "reason"]) && p.id === executionId && id(p.control_operation_id) &&
    typeof p.request_digest === "string" && /^[a-f0-9]{64}$/.test(p.request_digest) :
    keys(p, ["id", "run_id", "run_version", "attempt", "control_basis", "reason", ...(approval ? ["approval_id", "approval_version", "decision"] : [])]) &&
    p.id === executionId && (p.run_id === "" || id(p.run_id, 64)) && integer(p.run_version, 0) && Boolean(p.run_id) === Boolean(p.run_version) &&
    (p.run_id !== "" || value.action === "execution.cancel") && integer(p.attempt, 1) &&
    typeof p.control_basis === "string" && /^[a-f0-9]{64}$/.test(p.control_basis) &&
    (!approval || id(p.approval_id) && integer(p.approval_version, 1) && ["approve", "reject"].includes(String(p.decision)))) &&
    typeof p.reason === "string" && Boolean(p.reason.trim()) && p.reason === p.reason.trim() && p.reason.length <= 2000 && !p.reason.includes("\0") &&
    Object.keys(intent).every((key) => ["version", "key", "signature"].includes(key)) && integer(intent.version, 0) && id(intent.key) && intent.key.length >= 8 &&
    (intent.signature === undefined || intent.signature === JSON.stringify([value.action, p]));
}

/** Validate the committed command receipt; current runtime observations cannot confirm an intent. */
export function validExecutionControlAck(projectId: string, executionId: string, original: ExecutionControlOriginal, value: unknown) {
  if (!validOriginal(original, executionId) || !validDeliveryCommandAck(projectId, original, value, "execution", executionId) || value.affected_refs.length !== 1) return false;
  if (!keys(value as unknown as Record<string, unknown>, ["project_id", "action", "resource", "result", "affected_refs", "applied_version", "version", "query_generation", "replayed"]) ||
    !validControlAcceptance(value.result) || original.action === "execution.control.close" && value.result.control_operation_id === original.payload.control_operation_id) return false;
  try { return JSON.stringify({ phase: "succeeded", original, ack: value }).length <= MAX_RETAINED_LENGTH; }
  catch { return false; }
}
/** Historical confirmed receipts are read-only cleanup evidence, never a new transport result. */
function validHistoricalControlAck(projectId: string, executionId: string, original: ExecutionControlOriginal, value: unknown) {
  if (original.action === "execution.control.close" || !validOriginal(original, executionId) || !validDeliveryCommandAck(projectId, original, value, "execution", executionId) || value.affected_refs.length !== 1) return false;
  const result = value.result, p = original.payload;
  const starts = original.action === "execution.start" || original.action === "execution.retry" || original.action === "execution.approval" && p.decision === "approve";
  if (!record(result) || !keys(result, ["run_id", "run_version", "replayed_runtime", ...(starts ? ["start_run"] : [])]) ||
    result.run_id !== p.run_id || !integer(result.run_version, Number(p.run_version)) ||
    (!p.run_id && result.run_version !== 0) || typeof result.replayed_runtime !== "boolean") return false;
  if (starts) {
    const start = result.start_run;
    if (!record(start) || !keys(start, ["workspace_id", "run_id", "attempt", "resume"]) ||
      start.workspace_id !== original.workspaceId || start.run_id !== p.run_id ||
      start.attempt !== Number(p.attempt) + (original.action === "execution.retry" ? 1 : 0)) return false;
    if (original.action !== "execution.approval" ? start.resume !== null : start.resume !== null &&
      (!record(start.resume) || !keys(start.resume, ["approval_id", "approval_version"]) || start.resume.approval_id !== p.approval_id ||
        start.resume.approval_version !== Number(p.approval_version) + 1)) return false;
  }
  try { return JSON.stringify({ phase: "succeeded", original, ack: value }).length <= MAX_RETAINED_LENGTH; }
  catch { return false; }
}

export function executionControlOriginal(prepared: ExecutionControlIntent, workspaceId: string): ExecutionControlOriginal {
  const original: ExecutionControlOriginal = { action: prepared.action, payload: structuredClone(prepared.payload), intent: { version: prepared.version, key: prepared.key }, workspaceId };
  if (prepared.scope !== projectSessionKey() || !validOriginal(original, prepared.executionId)) throw new Error("retainedOriginalInvalid");
  return original;
}
export function executionControlCloseOriginal(projectId: string, executionId: string, detail: ControlOperationDetail, reason: string, key: string): ExecutionControlOriginal {
  const target = detail.operation;
  if (detail.project_id !== projectId || detail.execution_id !== executionId || target.execution_id !== executionId ||
    target.action === "execution.control.close" || !target.permissions.can_close) throw new Error("retainedOriginalInvalid");
  const original: ExecutionControlOriginal = { action: "execution.control.close", workspaceId: target.workspace_id,
    payload: { id: executionId, control_operation_id: target.id, request_digest: target.request_digest, reason: reason.trim() }, intent: { version: detail.version, key } };
  if (!validOriginal(original, executionId)) throw new Error("retainedOriginalInvalid");
  return original;
}
export function executionControlStorageKey(projectId: string, executionId: string) {
  return id(projectId) && id(executionId)
    ? eventRetryDraftKey(projectId, executionId)?.replace("sop.event-retry.v1:", "sop.execution-control.v1:") || null : null;
}
/** A persisted receipt can still require read-only local cleanup. Never hide a damaged original. */
export function executionControlRecoveryPending(projectId: string, executionId: string) {
  const key = executionControlStorageKey(projectId, executionId);
  if (!key) return false;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return false;
    if (raw.length > MAX_RETAINED_LENGTH) return true;
    const saved: unknown = JSON.parse(raw);
    return !record(saved) || !validOriginal(saved.original, executionId) || saved.phase !== "refused";
  } catch { return true; }
}
export function createExecutionControlController(options: Omit<DeliveryControllerOptions<ExecutionControlOriginal>, "validateOriginal" | "validateAck"> & { executionId: string }) {
  let restoring = true;
  const controller = createDeliveryCommandController({ ...options,
    save: (raw) => { if (raw.length > MAX_RETAINED_LENGTH) throw new Error("retainedOriginalUnavailable"); options.save(raw); },
    load: () => {
      if (!id(options.projectId) || !id(options.executionId)) throw new Error("retainedOriginalInvalid");
      const raw = options.load();
      if (raw !== null && (typeof raw !== "string" || raw.length > MAX_RETAINED_LENGTH)) throw new Error("retainedOriginalInvalid");
      return raw;
    },
    validateOriginal: (value) => validOriginal(value, options.executionId),
    validateAck: (original, value) => validExecutionControlAck(options.projectId, options.executionId, original, value) || restoring && validHistoricalControlAck(options.projectId, options.executionId, original, value),
  });
  restoring = false;
  return controller;
}
export function useExecutionControlCommand(projectId: string, executionId: string, sessionId: string, onPending?: (value: boolean) => void) {
  const key = executionControlStorageKey(projectId, executionId);
  const identity = JSON.stringify([projectId, executionId, sessionId]), active = useRef(identity);
  active.current = identity;
  return useDeliveryCommand<ExecutionControlOriginal>({ projectId, identity: `${sessionId}:${executionId}`, storageKey: () => key, onPending,
    create: (options) => createExecutionControlController({ ...options, executionId,
      scope: `${options.scope}\n${identity}`, currentScope: () => `${options.currentScope()}\n${active.current}`,
      load: () => { if (!key) throw new Error("retainedOriginalUnavailable"); return options.load(); },
      send: (original) => submitExecutionControl({ projectId, executionId,
        action: original.action, payload: original.payload as ExecutionControlPayload | ExecutionControlClosePayload, version: original.intent.version, key: original.intent.key, scope: projectSessionKey() }),
    }),
  });
}
