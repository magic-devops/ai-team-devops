import { Space, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { externalWorkOrderCopy } from "@/i18n/external-work-orders";
import type { WorkOrderSummary } from "@/lib/externalWorkOrders";

/** Lifecycle, reported activity and reviewed delivery remain independent facts. */
export function WorkOrderStatusBadges({ order }: { order: WorkOrderSummary }) {
  const { i18n } = useTranslation(), copy = externalWorkOrderCopy(i18n.language);
  const delivery = order.submission && order.delivery_state
    ? order.invalidated ? "invalidated" : order.delivery_state
    : null;
  return <Space size={[4, 4]} className="max-w-full" wrap aria-label={copy.status}>
    <Tag className="!m-0 !whitespace-normal" color={order.invalidated || order.state === "cancel_requested" ? "warning" : order.state === "reported" ? "processing" : "default"}>{copy.states[order.state]}</Tag>
    {order.invalidated && <Tag className="!m-0 !whitespace-normal" color="warning">{copy.states.stale}</Tag>}
    {delivery && <Tag className="!m-0 !whitespace-normal" color={delivery === "accepted" ? "success" : delivery === "changes_requested" || delivery === "invalidated" ? "warning" : "processing"}>{copy.deliveryStates[delivery]}</Tag>}
  </Space>;
}

export function WorkOrderReportedProgress({ order }: { order: WorkOrderSummary }) {
  const { i18n } = useTranslation(), copy = externalWorkOrderCopy(i18n.language), progress = order.progress;
  if (!progress) return <span className="text-xs text-[var(--muted)]">{copy.noProgress}</span>;
  return <div aria-label={copy.progress}>
    <Space size={[4, 4]} wrap><Tag color={progress.status === "blocked" ? "warning" : "processing"}>{progress.status === "blocked" ? copy.blockedProgress : copy.runningProgress}</Tag><span className="text-xs">{progress.percent === null ? copy.percentUnknown : `${progress.percent}%`}</span></Space>
    <small className="mt-1 block text-[var(--muted)]">{copy.observed}: <time dateTime={progress.reported_at}>{new Date(progress.reported_at).toLocaleString(i18n.language)}</time></small>
    <p className="mt-1 line-clamp-2 max-w-72 whitespace-normal text-xs text-[var(--muted)]" title={progress.message}>{progress.message}</p>
  </div>;
}

/** This selects a read action; all write permissions remain on exact detail. */
export function workOrderNextAction(order: WorkOrderSummary, language: string) {
  const copy = externalWorkOrderCopy(language);
  if (order.submission) return { kind: "report" as const, label: order.delivery_state === "changes_requested" ? copy.openChanges : order.delivery_state === "accepted" && !order.invalidated ? copy.openAcceptanceRecord : copy.openReport };
  return { kind: "order" as const, label: order.state === "cancel_requested" ? copy.reviewStopAttestation : order.state === "claimed" && order.progress?.status === "blocked" ? copy.openBlockedOrder : copy.openOrder };
}
