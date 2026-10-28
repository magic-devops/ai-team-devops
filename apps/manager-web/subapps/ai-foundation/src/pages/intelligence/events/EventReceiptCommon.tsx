import { Alert, Button, Tag } from "antd";
import { useTranslation } from "react-i18next";
import {
  eventProblem,
  type EventEffect,
  type EventProcessing,
} from "@/lib/eventReceipts";
import { useEventTargetNavigation } from "@/lib/eventReceiptState";
export function EventProblem({
  error,
  onRetry,
  onFirst,
}: {
  error: unknown;
  onRetry?: () => void;
  onFirst?: () => void;
}) {
  const { t } = useTranslation();
  const problem = eventProblem(error);
  return (
    <Alert
      role="alert"
      type="error"
      showIcon
      title={t(
        "eventReceipts." +
          (problem.cursor
            ? "stale"
            : problem.forbidden
              ? "forbidden"
              : problem.missing
                ? "missing"
                : "readFailed"),
      )}
      description={problem.message}
      action={
        <div className="event-receipt-actions">
          {problem.cursor && onFirst && (
            <Button onClick={onFirst}>{t("eventReceipts.first")}</Button>
          )}
          {onRetry && (
            <Button onClick={onRetry}>{t("eventReceipts.refresh")}</Button>
          )}
        </div>
      }
    />
  );
}
export function EventProcessingTags({
  processing,
}: {
  processing: EventProcessing;
}) {
  const { t } = useTranslation();
  const only =
    processing.state === "pending" &&
    processing.reason_code === "handler_not_configured";
  const fact =
    processing.state === "processed" &&
    processing.result?.kind === "fact_recorded";
  const reflection = processing.state === "processed" && processing.result?.kind === "reflection_recorded";
  const submission = processing.state === "processed" && processing.result?.kind === "task_delivery_submitted";
  return (
    <div className="event-receipt-tags">
      <Tag>{t("eventReceipts.stored")}</Tag>
      <Tag
        color={
          processing.state === "failed"
            ? "error"
            : reflection || submission ? "blue" : processing.state === "processed"
              ? "success"
              : "default"
        }
      >
        {t(
          "eventReceipts." +
            (only ? "storedOnly" : submission ? "task_delivery_submitted" : reflection ? "reflection_recorded" : fact ? "factRecorded" : processing.state),
        )}
      </Tag>
    </div>
  );
}
export function EventReason({ code }: { code: string | null | undefined }) {
  const { t } = useTranslation();
  if (!code) return null;
  return (
    <p className="event-receipt-note">
      {t("eventReceipts." + code, { defaultValue: code })}
    </p>
  );
}
export function EventPager({
  page,
  total,
  more,
  busy,
  onFirst,
  onNext,
}: {
  page: number;
  total: number;
  more: boolean;
  busy?: boolean;
  onFirst: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="event-receipt-pager" aria-label={t("eventReceipts.title")}>
      <span role="status">{t("eventReceipts.page", { page, total })}</span>
      <Button disabled={busy} onClick={onFirst}>
        {t("eventReceipts.first")}
      </Button>
      <Button disabled={busy || !more} onClick={onNext}>
        {t("eventReceipts.next")}
      </Button>
    </nav>
  );
}
export function EventEffectResult({
  projectId,
  effect,
  identity,
  background,
  canNavigate,
  onNavigate,
  disabled = false,
}: {
  projectId: string;
  effect: EventEffect | null;
  identity: string;
  background: string;
  canNavigate: () => boolean;
  onNavigate: (href: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const navigation = useEventTargetNavigation(
    projectId,
    identity,
    canNavigate,
    onNavigate,
  );
  if (!effect) return <p>{t("eventReceipts.noResult")}</p>;
  const target = effect.target_kind && effect.target_id;
  const supported =
    effect.target_kind &&
    ["task", "issue", "requirement", "reflection", "task_submission"].includes(effect.target_kind);
  return (
    <section className="event-receipt-result">
      <h4>{t("eventReceipts.result")}</h4>
      <Tag>{t("eventReceipts." + effect.kind)}</Tag>
      {target && (
        <p className="event-receipt-text">
          {t("eventReceipts." + effect.target_kind)} · {effect.target_id}
        </p>
      )}
      {target &&
        (supported ? (
          <Button
            loading={navigation.busy}
            disabled={disabled || navigation.busy}
            onClick={() => void navigation.open(effect, background)}
          >
            {t("eventReceipts.openTarget")}
          </Button>
        ) : (
          <p className="event-receipt-note">
            {t("eventReceipts.targetUnavailable")}
          </p>
        ))}
      {Boolean(navigation.error) && <EventProblem error={navigation.error} />}
    </section>
  );
}
