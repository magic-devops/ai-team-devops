import {
  createDeliveryCommandController,
  useDeliveryCommand,
  validDeliveryCommandAck,
  type DeliveryControllerOptions,
} from "./deliveryCommandController";
import { eventRetryDraftKey } from "./eventReceipts";
import { bindSessionRequest, request } from "./http";
import { getSessionRevision } from "./authStorage";
import type { ProgressFreezeProof } from "./deliveryProgressReads";

export type ProgressCommandAction = "baseline.create" | "progress.record";
export type ProgressBaselineForm = {
  title: string;
  starts_on: string | null;
  ends_on: string | null;
  note: string;
};
export type ProgressBaselinePayload = ProgressBaselineForm & {
  scope: "project" | "milestone" | "sprint";
  scope_id: string;
  task_ids: string[];
  basis: string;
};
export type ProgressOriginal = {
  action: ProgressCommandAction;
  payload: ProgressBaselinePayload | Record<string, never>;
  intent: { version: number; key: string };
};
const validDate = (value: unknown) =>
  value === null ||
  (typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value);
const validId = (value: unknown, max: number) =>
  typeof value === "string" &&
  value.length > 0 &&
  Array.from(value).length <= max &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value);
export function progressBaselineDateProblem(
  form: Pick<ProgressBaselineForm, "starts_on" | "ends_on">,
) {
  if (!validDate(form.starts_on) || !validDate(form.ends_on))
    return "invalidDates";
  return form.starts_on && form.ends_on && form.starts_on > form.ends_on
    ? "dateOrder"
    : null;
}
function validBaseline(payload: ProgressOriginal["payload"]) {
  const p = payload as ProgressBaselinePayload;
  return (
    typeof p.title === "string" &&
    Boolean(p.title.trim()) &&
    p.title === p.title.trim() &&
    Array.from(p.title).length <= 200 &&
    typeof p.note === "string" &&
    Array.from(p.note).length <= 4000 &&
    ["project", "milestone", "sprint"].includes(p.scope) &&
    (p.scope === "project" ? p.scope_id === "" : validId(p.scope_id, 100)) &&
    typeof p.basis === "string" &&
    /^[a-f0-9]{64}$/.test(p.basis) &&
    Array.isArray(p.task_ids) &&
    p.task_ids.length <= 10000 &&
    new Set(p.task_ids).size === p.task_ids.length &&
    p.task_ids.every((id) => validId(id, 64)) &&
    validDate(p.starts_on) &&
    validDate(p.ends_on) &&
    (!p.starts_on || !p.ends_on || p.starts_on <= p.ends_on) &&
    Object.keys(p).every((key) =>
      [
        "title",
        "note",
        "scope",
        "scope_id",
        "basis",
        "task_ids",
        "starts_on",
        "ends_on",
      ].includes(key),
    )
  );
}
export function prepareProgressBaseline(
  proof: ProgressFreezeProof,
  form: ProgressBaselineForm,
  makeKey: () => string = () => crypto.randomUUID(),
): ProgressOriginal {
  if (
    !proof.available ||
    !proof.complete ||
    !proof.basis ||
    !Array.isArray(proof.task_ids) ||
    !proof.metrics ||
    proof.task_ids.length !== proof.metrics.tasks_total ||
    !Number.isSafeInteger(proof.version) ||
    proof.version < 0 ||
    !Number.isSafeInteger(proof.query_generation) ||
    proof.query_generation < 1
  )
    throw new Error("progressProofRequired");
  const payload = {
    ...form,
    title: form.title.trim(),
    note: form.note.trim(),
    scope: proof.scope.kind,
    scope_id: proof.scope.id,
    basis: proof.basis,
    task_ids: [...proof.task_ids],
  };
  if (!validBaseline(payload)) throw new Error("progressProofRequired");
  return {
    action: "baseline.create",
    payload,
    intent: { version: proof.version, key: makeKey() },
  };
}
export function progressCommandStorageKey(
  projectId: string,
  action: ProgressCommandAction,
) {
  return (
    eventRetryDraftKey(projectId, "progress-command:" + action)?.replace(
      "sop.event-retry.v1:",
      "sop.progress-command.v1:",
    ) || null
  );
}
export function createProgressCommandController(
  options: Omit<
    DeliveryControllerOptions<ProgressOriginal>,
    "validateOriginal" | "validateAck"
  > & { action: ProgressCommandAction },
) {
  return createDeliveryCommandController({
    ...options,
    validateOriginal: (original) =>
      original.action === options.action &&
      (original.action === "baseline.create"
        ? validBaseline(original.payload)
        : Object.keys(original.payload).length === 0),
    validateAck: (original, value) =>
      validDeliveryCommandAck(
        options.projectId,
        original,
        value,
        original.action === "baseline.create" ? "baseline" : "observation",
      ) &&
      Number.isSafeInteger(value.query_generation) &&
      (value.query_generation ?? 0) > 0,
  });
}
export function submitProgressCommand(
  projectId: string,
  original: ProgressOriginal,
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
    }),
  });
}
export function useProgressCommand(
  projectId: string,
  action: ProgressCommandAction,
  onPending?: (pending: boolean) => void,
) {
  return useDeliveryCommand<ProgressOriginal>({
    projectId,
    identity: action,
    onPending,
    storageKey: () => progressCommandStorageKey(projectId, action),
    create: (options) => {
      const read = bindSessionRequest({
        projectId,
        revision: getSessionRevision() || "",
      });
      return createProgressCommandController({
        ...options,
        action,
        send: (original) => submitProgressCommand(projectId, original, read),
      });
    },
  });
}
