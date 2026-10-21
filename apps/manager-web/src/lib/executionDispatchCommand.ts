import { useRef } from "react";
import { validDesignReferences } from "./designLibrary";
import { saveDelivery, type DeliveryIntent } from "./delivery";
import { createDeliveryCommandController, useDeliveryCommand, validDeliveryCommandAck, type DeliveryControllerOptions } from "./deliveryCommandController";
import { eventRetryDraftKey } from "./eventReceipts";
import type { ExecutionPreview, prepareExecution } from "./deliveryExecution";

export type ExecutionDispatchAction = "execution.queue" | "execution.sync";
export type ExecutionDispatchOriginal = { action: ExecutionDispatchAction; payload: Record<string, unknown>; intent: DeliveryIntent };
const MAX_RETAINED_LENGTH = 1500000;
const MAX_ORIGINAL_LENGTH = MAX_RETAINED_LENGTH - 8192;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const id = (value: unknown, max = 100): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\s\u0000-\u001f\u007f]/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !value.includes("\0");
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
function validNode(node: unknown, approval: boolean) {
  if (!record(node) || typeof node.id !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(node.id) || !text(node.title, 200)) return false;
  if (node.kind === "approval") return approval && keys(node, ["id", "title", "kind", "argv", "agent_id", "prompt"]) &&
    Array.isArray(node.argv) && node.argv.length === 0 && node.agent_id === "" && node.prompt === "";
  return node.kind === "command" && keys(node, ["id", "title", "kind", "argv", "expected_exit_code", "timeout_seconds"]) &&
    Array.isArray(node.argv) && node.argv.length >= 1 && node.argv.length <= 128 && node.argv.every((arg) => typeof arg === "string" && Boolean(arg) && !arg.includes("\0")) &&
    integer(node.expected_exit_code, 0, 255) && integer(node.timeout_seconds, 1, 3600);
}
function validQueue(payload: Record<string, unknown>, taskId: string) {
  if (!keys(payload, ["executor_member_id", "executor_binding_basis", "task_id", "task_basis", "workspace_id", "target_kind", "target_basis", "target_device_id", "agent_id", "agent_version", "nodes", "test_nodes", "test_node_ids"]) ||
    payload.task_id !== taskId || !id(taskId, 64) || !digest(payload.task_basis) || !id(payload.workspace_id, 64) || !digest(payload.target_basis) ||
    (payload.target_kind !== "local" && payload.target_kind !== "device") || !(payload.target_device_id === "" || id(payload.target_device_id, 64)) ||
    (payload.target_kind === "device") !== Boolean(payload.target_device_id) || !(payload.agent_id === "" || id(payload.agent_id, 64)) || !integer(payload.agent_version, 1) ||
    !(payload.executor_member_id === "" || id(payload.executor_member_id)) || !(payload.executor_binding_basis === "" || digest(payload.executor_binding_basis)) ||
    Boolean(payload.executor_member_id) !== Boolean(payload.executor_binding_basis) || Boolean(payload.executor_member_id) && !payload.agent_id ||
    !Array.isArray(payload.nodes) || payload.nodes.length > 32 || !Array.isArray(payload.test_nodes) || payload.test_nodes.length > 32 ||
    !Array.isArray(payload.test_node_ids) || payload.test_node_ids.length > 32 || !payload.test_node_ids.every((value) => typeof value === "string")) return false;
  const agent = Boolean(payload.agent_id), nodes = agent ? payload.test_nodes : payload.nodes;
  if (agent ? payload.nodes.length !== 0 || payload.test_node_ids.length !== 0 : payload.nodes.length === 0 || payload.test_nodes.length !== 0) return false;
  if (!nodes.every((node) => validNode(node, !agent && payload.target_kind === "local")) ||
    !agent && !nodes.some((node) => node.kind === "command") || agent && nodes.some((node) => node.id.startsWith("agent_"))) return false;
  const ids = new Set(nodes.map((node) => node.id));
  return ids.size === nodes.length && new Set(payload.test_node_ids).size === payload.test_node_ids.length &&
    payload.test_node_ids.every((value) => nodes.some((node) => node.kind === "command" && node.id === value));
}
function validOriginal(value: unknown, action: ExecutionDispatchAction, targetId: string): value is ExecutionDispatchOriginal {
  if (!record(value) || !keys(value, ["action", "payload", "intent"]) || value.action !== action || !record(value.payload) || !record(value.intent)) return false;
  const intent = value.intent;
  if (!Object.keys(intent).every((key) => ["version", "key", "signature"].includes(key)) || !integer(intent.version, 0) || !id(intent.key) || intent.key.length < 8 ||
    intent.signature !== undefined && intent.signature !== JSON.stringify([action, value.payload])) return false;
  if (action === "execution.queue" ? !validQueue(value.payload, targetId) : !keys(value.payload, ["id"]) || value.payload.id !== targetId || !id(targetId, 64)) return false;
  try { return JSON.stringify({ phase: "sending", original: value }).length <= MAX_ORIGINAL_LENGTH; } catch { return false; }
}
const normalized = (node: Record<string, unknown>) => [node.id, node.title, node.kind, node.argv,
  node.expected_exit_code ?? 0, node.timeout_seconds ?? 60, node.agent_id ?? "", node.prompt ?? ""];
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((part) => typeof part === "string");
function validSnapshot(value: unknown, taskId: string) {
  if (!record(value) || value.task_id !== taskId || ![value.title, value.description, value.assigned_to].every((part) => typeof part === "string") ||
    !strings(value.acceptance_criteria) || !strings(value.task_acceptance_criteria) || !validDesignReferences(value.designs) || !digest(value.design_basis) || !record(value.dependency_basis) ||
    !Object.values(value.dependency_basis).every((part) => typeof part === "string")) return false;
  const requirement = value.requirement, owner = value.owner;
  return (requirement === null || record(requirement) && id(requirement.id, 64) &&
    [requirement.title, requirement.description].every((part) => typeof part === "string") && integer(requirement.revision, 0) &&
    strings(requirement.acceptance_criteria) && Array.isArray(requirement.criteria_indices) && requirement.criteria_indices.every((part) => integer(part, 0))) &&
    (owner === null || record(owner) && id(owner.id) && (owner.name === null || typeof owner.name === "string") &&
      (owner.kind === null || typeof owner.kind === "string" && ["human", "agent", "tool"].includes(owner.kind)) && typeof owner.active === "boolean");
}
/** Match the exact preview to the request that was reviewed, including command/test boundaries. */
export function validExecutionQueuePreview(projectId: string, prepared: ReturnType<typeof prepareExecution>, value: unknown): value is ExecutionPreview {
  const p = prepared.payload;
  if (!record(value) || value.project_id !== projectId || value.version !== prepared.version || value.task_basis !== p.task_basis ||
    !digest(value.plan_basis) || value.workspace_id !== p.workspace_id || !integer(value.workspace_version, 1) ||
    !validSnapshot(value.snapshot, p.task_id) ||
    !record(value.target) || value.target.kind !== p.target_kind || value.target.basis !== p.target_basis ||
    p.target_kind === "device" && value.target.id !== p.target_device_id ||
    !Array.isArray(value.nodes) || !value.nodes.every((node) => record(node) && id(node.id) && typeof node.title === "string" &&
      typeof node.kind === "string" && ["command", "approval", "agent"].includes(node.kind) && strings(node.argv) && integer(node.expected_exit_code, 0, 255) && integer(node.timeout_seconds, 1, 3600) &&
      typeof node.agent_id === "string" && typeof node.prompt === "string") || !Array.isArray(value.test_node_ids)) return false;
  if (p.agent_id ? !record(value.agent) || value.agent.id !== p.agent_id || value.agent.version !== p.agent_version : value.agent !== null) return false;
  if (p.executor_member_id ? !record(value.executor_snapshot) || value.executor_snapshot.member_id !== p.executor_member_id ||
    value.executor_snapshot.binding_basis !== p.executor_binding_basis || value.executor_snapshot.workspace_id !== p.workspace_id ||
    value.executor_snapshot.agent_id !== p.agent_id || value.executor_snapshot.agent_version !== p.agent_version ||
    !integer(value.executor_snapshot.binding_generation, 0) ||
    ![value.executor_snapshot.member_name, value.executor_snapshot.workspace_name, value.executor_snapshot.agent_title,
      value.executor_snapshot.provider, value.executor_snapshot.profile_digest, value.executor_snapshot.recorded_at,
      value.executor_snapshot.recorded_by].every((part) => typeof part === "string") : value.executor_snapshot !== null) return false;
  const input = p.agent_id ? p.test_nodes : p.nodes;
  const output = p.agent_id ? value.nodes.slice(1) : value.nodes;
  if (p.agent_id && (value.nodes.length !== input.length + 1 || value.nodes[0].id !== "agent_1" || value.nodes[0].kind !== "agent" || value.nodes[0].agent_id !== p.agent_id)) return false;
  return JSON.stringify(output.map(normalized)) === JSON.stringify(input.map((node) => normalized(node as unknown as Record<string, unknown>))) &&
    JSON.stringify(value.test_node_ids) === JSON.stringify(p.agent_id ? p.test_nodes.map((node) => node.id) : p.test_node_ids);
}
export function executionQueueOriginal(prepared: ReturnType<typeof prepareExecution>): ExecutionDispatchOriginal {
  const value: ExecutionDispatchOriginal = { action: "execution.queue", payload: structuredClone(prepared.payload), intent: structuredClone(prepared.session.intent) };
  if (!validOriginal(value, "execution.queue", prepared.session.taskId) || !validExecutionQueuePreview(prepared.session.projectId, prepared, prepared.session.preview)) throw new Error("previewRequired");
  return value;
}
export function validExecutionDispatchAck(projectId: string, action: ExecutionDispatchAction, targetId: string, original: ExecutionDispatchOriginal, value: unknown) {
  if (!validOriginal(original, action, targetId) || !validDeliveryCommandAck(projectId, original, value, "execution", action === "execution.sync" ? targetId : null) ||
    !keys(value as unknown as Record<string, unknown>, ["project_id", "action", "resource", "applied_version", "version", "query_generation", "replayed", "affected_refs", "result"]) ||
    !keys(value.resource, ["kind", "id"]) || !id(value.resource.id) || value.affected_refs.length !== 1 || !keys(value.affected_refs[0], ["kind", "id"]) ||
    value.result !== null || action === "execution.queue" && value.resource.id === targetId) return false;
  try { return JSON.stringify({ phase: "succeeded", original, ack: value }).length <= MAX_RETAINED_LENGTH; } catch { return false; }
}
export function executionDispatchStorageKey(projectId: string, action: ExecutionDispatchAction, targetId: string) {
  if (!id(projectId) || !id(targetId) || !["execution.queue", "execution.sync"].includes(action)) return null;
  return eventRetryDraftKey(projectId, JSON.stringify([action, targetId]))?.replace("sop.event-retry.v1:", "sop.execution-dispatch.v1:") || null;
}
export function executionDispatchRecoveryPending(projectId: string, action: ExecutionDispatchAction, targetId: string) {
  const key = executionDispatchStorageKey(projectId, action, targetId);
  if (!key) return false;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return false;
    if (raw.length > MAX_RETAINED_LENGTH) return true;
    const saved: unknown = JSON.parse(raw);
    return !record(saved) || !validOriginal(saved.original, action, targetId) || saved.phase !== "refused";
  } catch { return true; }
}
export function createExecutionDispatchController(options: Omit<DeliveryControllerOptions<ExecutionDispatchOriginal>, "validateOriginal" | "validateAck"> & { action: ExecutionDispatchAction; targetId: string }) {
  return createDeliveryCommandController({ ...options,
    save: (raw) => { if (raw.length > MAX_RETAINED_LENGTH) throw new Error("retainedOriginalUnavailable"); options.save(raw); },
    load: () => {
      if (!id(options.projectId) || !id(options.targetId) || !["execution.queue", "execution.sync"].includes(options.action)) throw new Error("retainedOriginalInvalid");
      const raw = options.load();
      if (raw !== null && (typeof raw !== "string" || raw.length > MAX_RETAINED_LENGTH)) throw new Error("retainedOriginalInvalid");
      return raw;
    },
    validateOriginal: (value) => validOriginal(value, options.action, options.targetId),
    validateAck: (original, value) => validExecutionDispatchAck(options.projectId, options.action, options.targetId, original, value),
  });
}
export function useExecutionDispatchCommand(projectId: string, action: ExecutionDispatchAction, targetId: string, sessionId: string, onPending?: (value: boolean) => void) {
  const key = executionDispatchStorageKey(projectId, action, targetId), identity = JSON.stringify([projectId, action, targetId, sessionId]);
  const active = useRef(identity), controller = useRef<{ snapshot: () => { phase: string } }>();
  active.current = identity;
  const command = useDeliveryCommand<ExecutionDispatchOriginal>({ projectId, identity, storageKey: () => key,
    onPending: (value) => onPending?.(value || controller.current?.snapshot().phase === "succeeded"),
    create: (options) => createExecutionDispatchController({ ...options, action, targetId,
      scope: `${options.scope}\n${identity}`, currentScope: () => `${options.currentScope()}\n${active.current}`,
      load: () => { if (!key) throw new Error("retainedOriginalUnavailable"); return options.load(); },
      send: (original) => saveDelivery(projectId, original.action, original.payload, original.intent.version, original.intent.key),
    }),
  });
  controller.current = command;
  return command;
}
export type ExecutionDispatchCommand = ReturnType<typeof useExecutionDispatchCommand>;
