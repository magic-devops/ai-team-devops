import type { DeliveryIntent } from "./delivery";
import {
  createDeliveryCommandController,
  useDeliveryCommand,
  validDeliveryCommandAck,
  type DeliveryControllerOptions,
} from "./deliveryCommandController";
import { eventRetryDraftKey } from "./eventReceipts";
import { projectStatuses } from "./projectPortfolioRoute";
import { submitProjectCommand } from "./projectPortfolio";

export type ProjectEditorAction = "project.lifecycle" | "project.update";
export type ProjectEditorOriginal = {
  action: ProjectEditorAction;
  payload: Record<string, unknown>;
  intent: DeliveryIntent;
};
const ACTIONS: ProjectEditorAction[] = ["project.lifecycle", "project.update"];
// JSON escaping plus the optional original signature can duplicate a 20k description.
const MAX_RETAINED_LENGTH = 400000;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const text = (value: unknown, max: number, required = false): value is string => typeof value === "string" && value.length <= max && !value.includes("\0") && (!required || Boolean(value.trim()));
const identity = (value: unknown, max = 128): value is string => text(value, max, true) && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const knownStatus = (value: unknown) => typeof value === "string" && (projectStatuses as readonly string[]).includes(value);

function validPayload(action: ProjectEditorAction, payload: Record<string, unknown>) {
  if (action === "project.lifecycle") return exactKeys(payload, ["target_status", "reason", "preview_basis"]) &&
    knownStatus(payload.target_status) && text(payload.reason, 2000, true) && payload.reason === payload.reason.trim() &&
    typeof payload.preview_basis === "string" && /^[0-9a-f]{64}$/.test(payload.preview_basis);
  return exactKeys(payload, ["name", "description", "business_id", "project_path", "vector_db", "is_template"]) &&
    text(payload.name, 128, true) && !/[\u0000-\u001f\u007f]/.test(payload.name) && text(payload.description, 20000) &&
    (payload.business_id === null || identity(payload.business_id, 64)) && text(payload.project_path, 512) &&
    !/[\u0000-\u001f\u007f]/.test(payload.project_path) &&
    typeof payload.vector_db === "string" && ["lance", "milvus", "qdrant", "oceanbase"].includes(payload.vector_db) &&
    typeof payload.is_template === "boolean";
}

function validOriginal(value: unknown, action: ProjectEditorAction): value is ProjectEditorOriginal {
  if (!record(value) || !exactKeys(value, ["action", "payload", "intent"]) || value.action !== action ||
    !record(value.payload) || !validPayload(action, value.payload) || !record(value.intent)) return false;
  const intent = value.intent;
  return Object.keys(intent).every((key) => ["version", "key", "signature"].includes(key)) &&
    Number.isSafeInteger(intent.version) && Number(intent.version) >= 0 && identity(intent.key, 100) && intent.key.length >= 8 &&
    (intent.signature === undefined || intent.signature === JSON.stringify([value.action, value.payload]));
}

function validArchive(original: ProjectEditorOriginal, value: unknown) {
  if (!record(value) || !exactKeys(value, ["id", "at", "actor_id", "actor_name", "reason", "preview_basis", "facts"])) return false;
  const facts = value.facts;
  return identity(value.id) && identity(value.actor_id) && text(value.actor_name, 200, true) &&
    text(value.at, 100, true) && Number.isFinite(Date.parse(value.at)) &&
    value.reason === original.payload.reason && value.preview_basis === original.payload.preview_basis && record(facts) &&
    exactKeys(facts, ["as_of", "basis", "metrics", "risk_counts", "unclosed_intents_total"]) &&
    text(facts.as_of, 100, true) && Number.isFinite(Date.parse(facts.as_of)) && text(facts.basis, 128, true) &&
    record(facts.metrics) && record(facts.risk_counts) && Number.isSafeInteger(facts.unclosed_intents_total) && Number(facts.unclosed_intents_total) >= 0;
}

function validAck(projectId: string, original: ProjectEditorOriginal, value: unknown) {
  if (!validDeliveryCommandAck(projectId, original, value, "project", projectId)) return false;
  try {
    if (JSON.stringify({ phase: "succeeded", original, ack: value }).length > MAX_RETAINED_LENGTH) return false;
  } catch {
    return false;
  }
  // update_project returns only (project.id, before); no metadata result is emitted.
  if (original.action === "project.update") return value.result === null;
  const result = value.result;
  return record(result) && exactKeys(result, ["from_status", "target_status", "reason", "archive"]) &&
    knownStatus(result.from_status) && result.from_status !== original.payload.target_status &&
    result.target_status === original.payload.target_status && result.reason === original.payload.reason &&
    (original.payload.target_status === "archived" ? validArchive(original, result.archive) : result.archive === null);
}

export function projectEditorStorageKey(projectId: string, action: ProjectEditorAction) {
  if (!identity(projectId) || !ACTIONS.includes(action)) return null;
  return eventRetryDraftKey(projectId, action)?.replace("sop.event-retry.v1:", "sop.project-command.v1:") || null;
}

export function projectEditorRecoverySlots(projectId: string): ProjectEditorAction[] {
  return ACTIONS.filter((action) => {
    const key = projectEditorStorageKey(projectId, action);
    if (!key) return false;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return false;
      if (raw.length > MAX_RETAINED_LENGTH) return true;
      const saved: unknown = JSON.parse(raw);
      if (!record(saved)) return true;
      if (!validOriginal(saved.original, action)) return true;
      if (saved.phase === "refused") return false;
      if (saved.phase === "succeeded") return !validAck(projectId, saved.original, saved.ack);
      return true;
    } catch {
      return true;
    }
  });
}

export function createProjectEditorController(
  options: Omit<DeliveryControllerOptions<ProjectEditorOriginal>, "validateOriginal" | "validateAck"> & { action: ProjectEditorAction },
) {
  return createDeliveryCommandController({
    ...options,
    load: () => {
      if (!identity(options.projectId) || !ACTIONS.includes(options.action)) throw new Error("retainedOriginalInvalid");
      const raw = options.load();
      if (raw !== null && (typeof raw !== "string" || raw.length > MAX_RETAINED_LENGTH)) throw new Error("retainedOriginalInvalid");
      return raw;
    },
    validateOriginal: (original) => validOriginal(original, options.action),
    validateAck: (original, value) => validAck(options.projectId, original, value),
  });
}

export function useProjectEditorCommand(projectId: string, action: ProjectEditorAction, onPending?: (pending: boolean) => void) {
  const key = projectEditorStorageKey(projectId, action);
  return useDeliveryCommand<ProjectEditorOriginal>({
    projectId, identity: action, storageKey: () => key, onPending,
    create: (options) => createProjectEditorController({
      ...options, action,
      load: () => {
        if (!key) throw new Error("retainedOriginalUnavailable");
        return options.load();
      },
      send: (original) => submitProjectCommand(projectId, original.action, original.payload, original.intent),
    }),
  });
}
