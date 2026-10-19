import {
  createDeliveryCommandController,
  useDeliveryCommand,
  validDeliveryCommandAck,
  type DeliveryControllerOptions,
} from "./deliveryCommandController";
import { prepareRequirementChange } from "./deliveryCollaboration";
import { eventRetryDraftKey } from "./eventReceipts";
import { bindSessionRequest, request } from "./http";
import { getSessionRevision } from "./authStorage";
import type { DeliveryIntent } from "./delivery";
import type { DiscussionSourceReference } from "./deliveryDiscussions";
import type { BoundedRequirementChangePreview } from "./deliveryRequirementReads";
export type RequirementOriginal = {
  action: "requirement.update";
  payload: Record<string, unknown>;
  intent: DeliveryIntent;
  source_reference?: DiscussionSourceReference;
};
const length = (value: string) => Array.from(value).length;
const identifier = (value: unknown, max = 64, empty = false) =>
  typeof value === "string" &&
  (empty || !!value) &&
  length(value) <= max &&
  value === value.trim() &&
  !/[\/\\\u0000-\u001f\u007f-\u009f]/.test(value);
const hash = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function validOriginal(original: RequirementOriginal, id: string) {
  const p = original.payload;
  if (
    original.action !== "requirement.update" ||
    p.id !== id ||
    !identifier(id) ||
    !hash(p.requirement_basis) ||
    Object.keys(p).some(
      (key) =>
        ![
          "id",
          "title",
          "description",
          "acceptance_criteria",
          "priority",
          "owner_id",
          "due_on",
          "milestone_id",
          "blocked_reason",
          "requirement_basis",
          "change_preview_basis",
        ].includes(key),
    )
  )
    return false;
  for (const [key, max] of [
    ["title", 256],
    ["description", 20000],
    ["blocked_reason", 2000],
  ] as const)
    if (
      key in p &&
      (typeof p[key] !== "string" ||
        length(p[key]) > max ||
        (key === "title" && !p[key].trim()))
    )
      return false;
  if (
    "priority" in p &&
    !["P0", "P1", "P2", "P3"].includes(p.priority as string)
  )
    return false;
  for (const key of ["owner_id", "milestone_id"])
    if (key in p && !identifier(p[key], 100, true)) return false;
  if (
    "due_on" in p &&
    p.due_on !== null &&
    (typeof p.due_on !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.due_on) ||
      !Number.isFinite(Date.parse(p.due_on + "T00:00:00Z")) ||
      new Date(p.due_on + "T00:00:00Z").toISOString().slice(0, 10) !== p.due_on)
  )
    return false;
  if (
    "acceptance_criteria" in p &&
    (!Array.isArray(p.acceptance_criteria) ||
      p.acceptance_criteria.length > 80 ||
      p.acceptance_criteria.some(
        (value) =>
          typeof value !== "string" ||
          !value.trim() ||
          value !== value.trim() ||
          length(value) > 2000,
      ))
  )
    return false;
  if ("change_preview_basis" in p && !hash(p.change_preview_basis))
    return false;
  const source = original.source_reference;
  return (
    !source ||
    (identifier(source.thread_id) &&
      identifier(source.resolution_event_id) &&
      identifier(source.message_id) &&
      Number.isSafeInteger(source.expected_thread_version) &&
      source.expected_thread_version >= 1 &&
      Number.isSafeInteger(source.message_revision) &&
      source.message_revision >= 1)
  );
}
export function prepareRequirementOriginal(
  intent: DeliveryIntent,
  id: string,
  basis: string,
  changes: Record<string, unknown>,
  definitionChanged: boolean,
  preview: BoundedRequirementChangePreview | null,
  projectId?: string,
  source?: DiscussionSourceReference,
): RequirementOriginal {
  if (
    definitionChanged &&
    (!preview ||
      !preview.available ||
      !preview.complete ||
      !preview.allowed ||
      !hash(preview.preview_basis) ||
      preview.requirement_id !== id ||
      preview.requirement_basis !== basis ||
      preview.version !== intent.version ||
      (projectId && preview.project_id !== projectId))
  )
    throw new Error("requirementProofRequired");
  const prepared = prepareRequirementChange(
    intent,
    basis,
    { id, ...changes },
    definitionChanged,
    preview?.preview_basis || null,
    source,
  );
  const original: RequirementOriginal = {
    action: "requirement.update",
    ...prepared,
  };
  if (!validOriginal(original, id)) throw new Error("requirementInputInvalid");
  return original;
}
export function requirementCommandStorageKey(projectId: string, id: string) {
  return (
    eventRetryDraftKey(
      projectId,
      "requirement-command:requirement.update:" + id,
    )?.replace("sop.event-retry.v1:", "sop.requirement-command.v1:") || null
  );
}
export function createRequirementCommandController(
  options: Omit<
    DeliveryControllerOptions<RequirementOriginal>,
    "validateOriginal" | "validateAck"
  > & { requirementId: string },
) {
  return createDeliveryCommandController({
    ...options,
    validateOriginal: (original) =>
      validOriginal(original, options.requirementId),
    validateAck: (original, value) =>
      validDeliveryCommandAck(
        options.projectId,
        original,
        value,
        "requirement",
        options.requirementId,
      ) &&
      Number.isSafeInteger(value.query_generation) &&
      (value.query_generation ?? 0) > 0,
  });
}
export function submitRequirementCommand(
  projectId: string,
  original: RequirementOriginal,
  read: typeof request = request,
) {
  return read("/api/v1/delivery/commands", {
    method: "POST",
    headers: { "X-Project-Id": projectId },
    body: JSON.stringify({
      action: original.action,
      payload: original.payload,
      expected_version: original.intent.version,
      idempotency_key: original.intent.key,
      ...(original.source_reference
        ? { source_reference: original.source_reference }
        : {}),
    }),
  });
}
export function useRequirementCommand(
  projectId: string,
  id: string,
  onPending?: (value: boolean) => void,
) {
  return useDeliveryCommand<RequirementOriginal>({
    projectId,
    identity: "requirement.update:" + id,
    onPending,
    storageKey: () => requirementCommandStorageKey(projectId, id),
    create: (options) => {
      const read = bindSessionRequest({
        projectId,
        revision: getSessionRevision() || "",
      });
      return createRequirementCommandController({
        ...options,
        requirementId: id,
        send: (original) => submitRequirementCommand(projectId, original, read),
      });
    },
  });
}
