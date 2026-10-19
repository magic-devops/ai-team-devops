import { eventRetryDraftKey } from "./eventReceipts";
import { submitReleaseCommand, type ReleaseCommand } from "./deliveryRelease";
import type { DeliveryIntent } from "./delivery";
import {
  createDeliveryCommandController,
  useDeliveryCommand,
  validDeliveryCommandAck,
  type DeliveryControllerOptions,
} from "./deliveryCommandController";
export type ReleaseOriginal = {
  action: ReleaseCommand;
  payload: Record<string, unknown>;
  intent: DeliveryIntent;
};
export function releaseCommandStorageKey(projectId: string, identity: string) {
  return (
    eventRetryDraftKey(projectId, "release:" + identity)?.replace(
      "sop.event-retry.v1:",
      "sop.release-command.v1:",
    ) || null
  );
}
export function releaseRecoverySlots(projectId: string, releaseId: string) {
  return [
    "candidate",
    "policy",
    "ci",
    ...(releaseId ? ["review:" + releaseId] : []),
  ].filter((identity) => {
    const key = releaseCommandStorageKey(projectId, identity);
    if (!key) return false;
    try {
      const raw = sessionStorage.getItem(key);
      return Boolean(
        raw &&
        !["idle", "refused", "succeeded"].includes(JSON.parse(raw).phase),
      );
    } catch {
      return true;
    }
  });
}
export function createReleaseCommandController(
  options: Omit<
    DeliveryControllerOptions<ReleaseOriginal>,
    "validateOriginal" | "validateAck"
  >,
) {
  return createDeliveryCommandController({
    ...options,
    validateOriginal: (original) =>
      original.action.startsWith("release.") &&
      ["requirement_ids", "task_ids", "public_keys"].every(
        (field) =>
          !(field in original.payload) ||
          (Array.isArray(original.payload[field]) &&
            (original.payload[field] as unknown[]).every(
              (item) => typeof item === "string",
            )),
      ),
    validateAck: (original, ack) =>
      validDeliveryCommandAck(
        options.projectId,
        original,
        ack,
        original.action === "release.policy.save"
          ? "release_policy"
          : original.action === "release.ci.import"
            ? "ci_evidence"
            : "release_candidate",
        original.action === "release.policy.save"
          ? options.projectId
          : typeof original.payload.id === "string"
            ? original.payload.id
            : null,
      ),
  });
}
export function useReleaseCommand(
  projectId: string,
  identity: string,
  onPending?: (pending: boolean) => void,
) {
  return useDeliveryCommand<ReleaseOriginal>({
    projectId,
    identity,
    onPending,
    storageKey: () => releaseCommandStorageKey(projectId, identity),
    create: (options) =>
      createReleaseCommandController({
        ...options,
        send: (original) =>
          submitReleaseCommand(
            projectId,
            original.action,
            original.payload,
            original.intent,
          ),
      }),
  });
}
