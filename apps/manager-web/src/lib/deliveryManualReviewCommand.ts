import { safeEvidenceUrl, type DeliveryIntent } from "./delivery";
import {
  createDeliveryCommandController,
  useDeliveryCommand,
  validDeliveryCommandAck,
  type DeliveryControllerOptions,
} from "./deliveryCommandController";
import { eventRetryDraftKey } from "./eventReceipts";
import { bindSessionRequest, request } from "./http";
import { getSessionRevision } from "./authStorage";
export type ManualReviewOriginal = {
  action: "task.manual_review";
  payload: {
    task_id: string;
    decision: "accept" | "request_changes";
    basis: string;
    comment: string;
    evidence_content: string;
    evidence_url: string;
  };
  intent: DeliveryIntent;
};
export function manualReviewCommandStorageKey(
  projectId: string,
  taskId: string,
) {
  return (
    eventRetryDraftKey(projectId, "manual-review:" + taskId)?.replace(
      "sop.event-retry.v1:",
      "sop.manual-review-command.v1:",
    ) || null
  );
}
export function createManualReviewCommandController(
  options: Omit<
    DeliveryControllerOptions<ManualReviewOriginal>,
    "validateOriginal" | "validateAck"
  > & { taskId: string },
) {
  return createDeliveryCommandController({
    ...options,
    validateOriginal: (original) => {
      const p = original.payload;
      return (
        original.action === "task.manual_review" &&
        p.task_id === options.taskId &&
        ["accept", "request_changes"].includes(p.decision) &&
        typeof p.basis === "string" &&
        Boolean(p.basis.trim()) &&
        typeof p.comment === "string" &&
        Boolean(p.comment.trim()) &&
        p.comment.length <= 4000 &&
        typeof p.evidence_content === "string" &&
        p.evidence_content.length <= 20000 &&
        typeof p.evidence_url === "string" &&
        p.evidence_url.length <= 2000 &&
        (!p.evidence_url || Boolean(safeEvidenceUrl(p.evidence_url))) &&
        (p.decision !== "accept" ||
          Boolean(p.evidence_content.trim() || p.evidence_url.trim()))
      );
    },
    validateAck: (original, value) =>
      validDeliveryCommandAck(
        options.projectId,
        original,
        value,
        "task_review",
      ) &&
      Number.isSafeInteger(value.query_generation) &&
      (value.query_generation ?? 0) > 0 &&
      value.affected_refs.some(
        (ref) => ref.kind === "task" && ref.id === original.payload.task_id,
      ) &&
      Array.isArray(value.result?.task_ids) &&
      value.result.task_ids.length === 1 &&
      value.result.task_ids[0] === original.payload.task_id,
  });
}
export function submitManualReviewCommand(
  projectId: string,
  original: ManualReviewOriginal,
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
export function useManualReviewCommand(
  projectId: string,
  taskId: string,
  onPending?: (pending: boolean) => void,
) {
  return useDeliveryCommand<ManualReviewOriginal>({
    projectId,
    identity: taskId,
    onPending,
    storageKey: () => manualReviewCommandStorageKey(projectId, taskId),
    create: (options) => {
      const read = bindSessionRequest({
        projectId,
        revision: getSessionRevision() || "",
      });
      return createManualReviewCommandController({
        ...options,
        taskId,
        send: (original) =>
          submitManualReviewCommand(projectId, original, read),
      });
    },
  });
}
