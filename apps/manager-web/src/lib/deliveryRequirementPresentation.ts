import type { TFunction } from "i18next";
export const requirementStatusLabel = (t: TFunction, value: string | null) =>
  value
    ? t([
        `delivery.statuses.${value}`,
        `deliveryRuntime.${value}`,
        `deliveryRelease.statuses.${value}`,
        "deliveryCollaboration.statusUnknown",
      ])
    : "—";
export const requirementKindLabel = (t: TFunction, value: string | null) =>
  value
    ? t([`delivery.kinds.${value}`, "deliveryCollaboration.recordType"])
    : t("deliveryCollaboration.recordType");
export const requirementStageLabel = (t: TFunction, value: string | null) =>
  value
    ? t([`delivery.stages.${value}`, "deliveryCollaboration.stageUnknown"])
    : "—";
export const requirementDecisionLabel = (t: TFunction, value: string | null) =>
  value === "reopen"
    ? t("delivery.reopen")
    : value === "advance"
      ? t("delivery.advance")
      : t("deliveryCollaboration.reviewDecision");
export function requirementReasonText(t: TFunction, code: string) {
  if (code.includes("budget") || code === "requirement_item_too_large")
    return t("deliveryCollaboration.completeReadBudget");
  if (code === "delivery_query_rebuild_required")
    return t("deliveryQuery.rebuildRequired");
  if (
    code === "requirement_source_unavailable" ||
    code === "requirement_storage_unavailable" ||
    code === "requirement_version_unavailable"
  )
    return t("deliveryCollaboration.originalUnavailable");
  return t("deliveryCollaboration.impactUnavailable");
}
