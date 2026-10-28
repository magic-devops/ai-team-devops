import { createDeliveryCommandController, useDeliveryCommand, validDeliveryCommandAck, type DeliveryControllerOptions } from "./deliveryCommandController";
import { eventRetryDraftKey } from "./eventReceipts";
import { bindSessionRequest, request } from "./http";
import { getSessionRevision } from "./authStorage";
import { reflectionCodepoints, validReflectionReference, type ReflectionSelectionReference } from "./reflectionReads";
import type { DeliveryIntent } from "./delivery";

export type ReflectionInputPayload = { title: string; rationale: string; sources: ReflectionSelectionReference[] };
export type ReflectionInputOriginal = { action: "reflection.input.create"; payload: ReflectionInputPayload; intent: DeliveryIntent };
function validPayload(payload: ReflectionInputPayload) {
  return payload && Object.keys(payload).length === 3 && typeof payload.title === "string" && !!payload.title.trim() && reflectionCodepoints(payload.title) <= 160 && typeof payload.rationale === "string" && !!payload.rationale.trim() && reflectionCodepoints(payload.rationale) <= 2000 && Array.isArray(payload.sources) && payload.sources.length >= 1 && payload.sources.length <= 32 && payload.sources.every(validReflectionReference) && new Set(payload.sources.map((source) => source.reflection_id)).size === payload.sources.length;
}
export function prepareReflectionInputOriginal(version: number, payload: ReflectionInputPayload, key = () => crypto.randomUUID()): ReflectionInputOriginal {
  if (!Number.isSafeInteger(version) || version < 0 || !validPayload(payload)) throw new Error("reflectionInputInvalid");
  return { action: "reflection.input.create", payload: structuredClone(payload), intent: { version, key: key() } };
}
export function createReflectionInputController(options: Omit<DeliveryControllerOptions<ReflectionInputOriginal>, "validateOriginal" | "validateAck">) {
  return createDeliveryCommandController({
    ...options,
    validateOriginal: (original) => original.action === "reflection.input.create" && validPayload(original.payload),
    validateAck: (original, ack) => validDeliveryCommandAck(options.projectId, original, ack, "reflection_input") && ack.affected_refs.length === 1 && ack.affected_refs[0].kind === "reflection_input" && ack.affected_refs[0].id === ack.resource.id && !!ack.result && Object.keys(ack.result).length === 2 && ack.result.status === "prepared" && ack.result.source_count === original.payload.sources.length,
  });
}
export const reflectionInputStorageKey = (projectId: string) => eventRetryDraftKey(projectId, "reflection.input.create")?.replace("sop.event-retry.v1:", "sop.reflection-command.v1:") || null;
export function submitReflectionInput(projectId: string, original: ReflectionInputOriginal, read: typeof request = request) {
  return read("/api/v1/delivery/commands", { method: "POST", headers: { "X-Project-Id": projectId }, body: JSON.stringify({ action: original.action, payload: original.payload, expected_version: original.intent.version, idempotency_key: original.intent.key }) });
}
export function useReflectionInputCommand(projectId: string, onPending?: (pending: boolean) => void) {
  return useDeliveryCommand<ReflectionInputOriginal>({ projectId, identity: "reflection.input.create", storageKey: () => reflectionInputStorageKey(projectId), onPending, create: (options) => {
    const read = bindSessionRequest({ projectId, revision: getSessionRevision() || "" });
    return createReflectionInputController({ ...options, send: (original) => submitReflectionInput(projectId, original, read) });
  } });
}
