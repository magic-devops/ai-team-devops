import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownView } from "@/components/MarkdownView";
import { api } from "@/lib/api";
import { getProjectId, getSessionRevision } from "@/lib/authStorage";
import {
  assistanceError,
  assistanceIntent,
  formatAssistanceDate,
  workflowHumanActions,
  workflowHumanActionBody,
  type WorkflowHumanAction,
  type AssistanceIntent,
  type WorkflowReviewDetail,
} from "@/lib/requirementsAssistance";
import {
  AssistanceField,
  assistanceButton,
  assistanceField,
  assistancePrimary,
} from "../product/AssistanceControls";

export function WorkflowHumanReview({
  workflowId,
  detail,
  onSaved,
}: {
  workflowId: string;
  detail: WorkflowReviewDetail;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<WorkflowHumanAction>();
  const [taskId, setTaskId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const intent = useRef<AssistanceIntent>();
  const inFlight = useRef(false);
  const review = detail.review || detail.result?.review;
  const record = detail.decision_record || detail.result?.decision_record;
  const status = detail.status || detail.instance?.status || "";
  const phase = detail.phase || detail.instance?.phase || "";
  const actions = workflowHumanActions(detail);
  const canDecide = actions.length > 0 && !saved;
  const tasks = (detail.result?.tasks || []).filter(
    (task) => !detail.result?.completed?.includes(task),
  );
  const finished = ["completed", "failed", "cancelled"].includes(status);
  async function confirm() {
    if (!decision || !comment.trim() || !canDecide || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    const body = {
      decision,
      comment: comment.trim(),
      task_id: taskId,
      assignee,
    };
    intent.current = assistanceIntent(
      intent.current,
      `${getSessionRevision()}:${getProjectId()}:${workflowId}`,
      "workflow-decision",
      body,
    );
    try {
      await api.signalWorkflow(
        workflowId,
        workflowHumanActionBody(decision, comment, intent.current.key, {
          task_id: taskId,
          assignee,
        }),
      );
      setSaved(
        [
          "approve",
          "request_changes",
          "reject",
          "resolve",
          "complete_review",
        ].includes(decision),
      );
      setDecision(undefined);
      onSaved();
    } catch (cause) {
      setError(assistanceError(cause).message);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
      aria-label={t("assistance.workflowReview")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t("assistance.workflowReview")}
        </h3>
        <span
          className={`rounded px-2 py-1 text-xs ${status === "timeout_pending" ? "bg-amber-500/10 text-amber-700" : "bg-[var(--brand-soft)] text-[var(--brand)]"}`}
        >
          {t(`assistance.${status}`, { defaultValue: status })}
        </span>
      </div>
      <p className="text-xs leading-5 text-[var(--muted)]">
        {t("assistance.workflowHint")}
      </p>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">{t("assistance.phase")}</dt>
          <dd className="mt-1 font-medium">
            {t(`assistance.${phase}`, { defaultValue: phase || "—" })}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">
            {t("assistance.reviewSource")}
          </dt>
          <dd className="mt-1 font-medium">
            {review?.source
              ? t(`assistance.${review.source}`, {
                  defaultValue: review.source,
                })
              : "—"}
          </dd>
        </div>
      </dl>
      {status === "timeout_pending" && (
        <p role="status" className="rounded-lg bg-amber-500/10 p-3 text-sm">
          {t("assistance.timeout")}
        </p>
      )}
      {review ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
          <p className="text-xs">
            {t("assistance.reviewStatus")}:{" "}
            {t(`assistance.${review.status}`, {
              defaultValue: review.status || "—",
            })}
          </p>
          {review.error && (
            <div role="alert" className="space-y-1 text-xs text-rose-600">
              <p>{t("assistance.reviewFailed")}</p>
              <p className="break-words">{review.error}</p>
            </div>
          )}
          {review.truncated && (
            <p role="status" className="rounded-lg bg-amber-500/10 p-2 text-xs">
              {t("assistance.partialReview", {
                reviewed: review.reviewed_chars,
                total: review.input_chars,
              })}
            </p>
          )}
          {(review.model || review.provider) && (
            <p className="break-words text-xs text-[var(--muted)]">
              {review.model} · {review.provider}
              {review.usage
                ? ` · ${t("assistance.tokens")}: ${review.usage.total_tokens ?? (review.usage.input_tokens ?? review.usage.prompt_tokens ?? 0) + (review.usage.output_tokens ?? review.usage.completion_tokens ?? 0)}`
                : ""}
            </p>
          )}
          {review.content && <MarkdownView content={review.content} />}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          {t("assistance.noReview")}
        </p>
      )}
      {record && (
        <dl className="space-y-2 rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
          <div>
            <dt className="font-medium">{t("assistance.decision")}</dt>
            <dd className="mt-1">
              {t(`assistance.${record.decision}`, {
                defaultValue: record.decision || "—",
              })}
            </dd>
          </div>
          <div>
            <dt className="font-medium">{t("assistance.comment")}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words">
              {record.comment}
            </dd>
          </div>
          <div className="flex flex-wrap gap-3 text-[var(--muted)]">
            <span>
              {t("assistance.actor")}: {record.actor_id || "—"}
            </span>
            <span>{formatAssistanceDate(record.at, i18n?.resolvedLanguage || i18n?.language || "zh-CN")}</span>
          </div>
        </dl>
      )}
      {canDecide ? (
        <>
          <AssistanceField label={t("assistance.comment")}>
            <textarea
              className={`${assistanceField} min-h-28`}
              value={comment}
              placeholder={t("assistance.commentHint")}
              maxLength={10000}
              disabled={pending}
              onChange={(e) => {
                setComment(e.target.value);
                setDecision(undefined);
              }}
            />
          </AssistanceField>
          {actions.includes("complete_task") && (
            <AssistanceField label={t("assistance.workflowTask")}>
              <select
                className={assistanceField}
                value={taskId}
                disabled={pending}
                onChange={(e) => {
                  setTaskId(e.target.value);
                  setDecision(undefined);
                }}
              >
                <option value="">{t("assistance.chooseTask")}</option>
                {tasks.map((task) => (
                  <option key={task} value={task}>
                    {task}
                  </option>
                ))}
              </select>
            </AssistanceField>
          )}
          {actions.includes("reassign") && (
            <AssistanceField label={t("assistance.owner")}>
              <input
                className={assistanceField}
                value={assignee}
                disabled={pending}
                onChange={(e) => {
                  setAssignee(e.target.value);
                  setDecision(undefined);
                }}
              />
            </AssistanceField>
          )}
          <div className="flex flex-wrap gap-2">
            {actions.map((value) => (
              <button
                key={value}
                type="button"
                className={
                  ["approve", "complete_review", "resolve"].includes(value)
                    ? assistancePrimary
                    : assistanceButton
                }
                disabled={
                  pending ||
                  !comment.trim() ||
                  (value === "complete_task" && !taskId) ||
                  (value === "reassign" && !assignee.trim())
                }
                onClick={() => setDecision(value)}
              >
                {t(`assistance.${value}`)}
              </button>
            ))}
          </div>
          {decision && (
            <div
              className="space-y-3 rounded-lg border border-[var(--brand)]/30 bg-[var(--brand-soft)] p-3"
              role="group"
              aria-label={t("assistance.confirmDecision")}
            >
              <p className="text-sm">
                {t("assistance.decisionConfirm", {
                  decision: t(`assistance.${decision}`),
                })}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">
                {comment}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={assistancePrimary}
                  disabled={pending}
                  onClick={() => void confirm()}
                >
                  {pending
                    ? t("assistance.busy")
                    : t("assistance.confirmDecision")}
                </button>
                <button
                  type="button"
                  className={assistanceButton}
                  disabled={pending}
                  onClick={() => setDecision(undefined)}
                >
                  {t("assistance.cancel")}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          {saved
            ? t("assistance.decisionSaved")
            : finished
              ? t("assistance.terminal")
              : !detail.permissions?.approve
                ? t("assistance.noApprove")
                : t("assistance.notWaiting")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}
    </section>
  );
}
