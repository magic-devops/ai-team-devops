import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Skeleton,
  Tag,
} from "antd";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { safeEvidenceUrl, type DeliveryCommandAck } from "@/lib/delivery";
import {
  adoptManualReviewBasis,
  fetchTaskReviews,
  fetchTaskReviewCurrent,
  fetchTaskReviewOriginal,
  manualReviewError,
  manualReviewProblems,
  openManualReview,
  prepareManualReview,
  type ManualReviewCurrent,
  type ManualReviewSession,
  type ManualTaskReview,
  type ManualReviewSummary,
  type TaskReviewCurrentResponse,
} from "@/lib/deliveryTaskReview";
import {
  useManualReviewCommand,
  type ManualReviewOriginal,
} from "@/lib/deliveryManualReviewCommand";
import { bindSessionRequest } from "@/lib/http";
import { getSessionRevision } from "@/lib/authStorage";
import { projectSessionKey } from "@/lib/projectPortfolio";
import "./delivery-manual-review.css";
import { TaskAcceptanceFacts } from "./TaskAcceptanceFacts";
import type { TaskAcceptance } from "@/lib/taskAcceptance";
import { taskSubmissionCopy } from "@/i18n/task-submission";
import { useDeliveryDraftState } from "@/lib/useDeliveryDraftState";

function reviewTime(value: string | null, language: string) {
  if (!value) return "—";
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? value
    : `${time.toLocaleString(language, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} UTC`;
}

function ManualTaskFacts({
  task,
  owner,
  requirement,
  planning,
  acceptance,
}: Pick<ManualReviewCurrent, "task" | "owner" | "requirement" | "planning"> & {
  acceptance: TaskAcceptance | null;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`deliveryManualReview.${key}`, options);
  return (
    <div className="delivery-manual-facts">
      <strong>{task.title}</strong>
      <small className="delivery-manual-identity">{task.id}</small>
      <dl className="delivery-manual-properties">
        <div>
          <dt>{tr("owner")}</dt>
          <dd>{owner?.name || tr("unknownOwner")}</dd>
        </div>
        <div>
          <dt>{tr("recordedStatus")}</dt>
          <dd>
            {t(`delivery.statuses.${task.status}`, {
              defaultValue: task.status,
            })}
          </dd>
        </div>
        <div>
          <dt>{tr("requirement")}</dt>
          <dd>
            {requirement ? (
              <>
                {requirement.title} ·{" "}
                {tr("revision", { number: requirement.revision })}
              </>
            ) : (
              tr("standalone")
            )}
          </dd>
        </div>
      </dl>
      {task.description && (
        <p className="delivery-manual-content">{task.description}</p>
      )}
      {task.blocked_reason && (
        <Alert type="warning" title={task.blocked_reason} />
      )}
      {requirement && (
        <div className="delivery-manual-criteria">
          {requirement.description && (
            <p className="delivery-manual-content">{requirement.description}</p>
          )}
          {requirement.blocked_reason && (
            <Alert type="warning" title={requirement.blocked_reason} />
          )}
        </div>
      )}
      <TaskAcceptanceFacts acceptance={acceptance} />
      <p className="delivery-manual-dependencies">
        <b>{tr("dependencies")}</b>:{" "}
        {planning.depends_on.length
          ? planning.depends_on.join(" · ")
          : tr("noDependencies")}
      </p>
    </div>
  );
}

export function ManualReviewFacts({
  current,
  compact = false,
}: {
  current: ManualReviewCurrent | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`deliveryManualReview.${key}`, options);
  if (!current)
    return (
      <Alert
        type="info"
        showIcon
        title={tr("unavailable")}
        description={tr("taskMissing")}
      />
    );
  return (
    <section
      className="delivery-manual-current"
      aria-label={tr("currentFacts")}
    >
      <Tag
        color={
          current.verified
            ? "success"
            : current.task.status === "completed"
              ? "warning"
              : "default"
        }
      >
        {tr(
          current.verified
            ? "verified"
            : current.task.status === "completed"
              ? "recorded"
              : "unverified",
        )}
      </Tag>
      {!compact && <ManualTaskFacts {...current} />}
      {current.reasons.length > 0 && (
        <ul className="delivery-manual-reasons">
          {current.reasons.map((reason, index) => (
            <li key={`${reason.code}:${index}`}>
              {reason.code.startsWith("task_")
                ? t(`deliveryTaskAcceptance.reasons.${reason.code}`, {
                    defaultValue: reason.message,
                  })
                : tr(`reasons.${reason.code}`, {
                    defaultValue: reason.message,
                  })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ManualReviewHistory({
  reviews,
  effectiveReviewId = null,
  openedId = "",
  onOpen,
}: {
  reviews: ManualReviewSummary[];
  effectiveReviewId?: string | null;
  openedId?: string;
  onOpen?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`deliveryManualReview.${key}`, options);
  return (
    <div className="delivery-manual-history">
      {reviews.map((review) => {
        const status = review.invalidated
          ? "invalidated"
          : review.id === effectiveReviewId
            ? "verified"
            : review.decision === "request_changes"
              ? "request_changes"
              : "historical";
        return (
          <article
            className={`delivery-manual-review-record ${status}`}
            key={review.id}
          >
            <div className="delivery-manual-review-summary">
              <span className="delivery-manual-review-status">
                <Tag
                  color={
                    review.invalidated
                      ? "warning"
                      : review.id === effectiveReviewId
                        ? "success"
                        : "default"
                  }
                >
                  {tr(status)}
                </Tag>
                <b>{tr(review.decision)}</b>
              </span>
              <span>{review.reviewer.name || review.reviewer.id}</span>
              <small>{reviewTime(review.created_at, i18n.language)}</small>
            </div>
            <p className="delivery-manual-content">{review.comment_summary}</p>
            <Button
              size="small"
              type="link"
              aria-expanded={openedId === review.id}
              onClick={() => onOpen?.(openedId === review.id ? "" : review.id)}
            >
              {tr(
                openedId === review.id
                  ? "hideOriginal"
                  : review.has_evidence
                    ? "showEvidence"
                    : "showOriginal",
              )}
            </Button>
          </article>
        );
      })}
    </div>
  );
}

export function ManualReviewOriginalFacts({
  review,
}: {
  review: ManualTaskReview;
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`deliveryManualReview.${key}`, options);
  const url = safeEvidenceUrl(review.evidence_url);
  return (
    <section
      className="delivery-manual-original-detail"
      aria-label={tr("originalFacts")}
    >
      <div className="delivery-manual-heading">
        <strong>{review.reviewer.name || review.reviewer.id}</strong>
        <small>{reviewTime(review.created_at, i18n.language)}</small>
      </div>
      <p className="delivery-manual-content">{review.comment}</p>
      {review.invalidated && (
        <Alert
          type="warning"
          showIcon
          title={tr(`reasons.${review.invalidated_reason}`, {
            defaultValue: review.invalidated_reason,
          })}
          description={`${tr("invalidatedAt")}: ${reviewTime(review.invalidated_at, i18n.language)}`}
        />
      )}
      {(review.evidence_content || review.evidence_url) && (
        <section className="delivery-manual-evidence">
          <strong>{tr("evidenceLabel")}</strong>
          <p className="delivery-manual-help">{tr("sourceHint")}</p>
          {review.evidence_content && (
            <p className="delivery-manual-content">{review.evidence_content}</p>
          )}
          {review.evidence_url &&
            (url ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                {review.evidence_url}
              </a>
            ) : (
              <p>{tr("problems.unsafeUrl")}</p>
            ))}
        </section>
      )}
      <section className="delivery-manual-original">
        <h4>{tr("originalFacts")}</h4>
        <ManualTaskFacts {...review.snapshot} />
        <small>
          {tr("manualBasis")}: <code>{review.task_basis}</code>
        </small>
      </section>
    </section>
  );
}

export function ManualReviewFormFields({
  session,
  busy,
  onChange,
}: {
  session: ManualReviewSession;
  busy: boolean;
  onChange: (patch: Partial<ManualReviewSession>) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryManualReview.${key}`);
  const prefix = `manual-review-${session.taskId}`;
  return (
    <div className="delivery-manual-form-fields">
      <p className="delivery-manual-help">{tr("frozen")}</p>
      <div className="delivery-manual-fixed">
        <span>
          {tr("version")}: <b>{session.version}</b>
        </span>
        <span>
          {tr("basis")}: <code>{session.current.basis}</code>
        </span>
      </div>
      <ManualReviewFacts current={session.current} />
      <p className="delivery-manual-help">{tr("approvalHint")}</p>
      <label htmlFor={`${prefix}-decision`}>
        <span>{tr("decision")}</span>
        <Select
          id={`${prefix}-decision`}
          aria-label={tr("decision")}
          value={session.decision}
          disabled={busy}
          onChange={(decision) => onChange({ decision })}
          options={[
            {
              value: "accept",
              label: tr("accept"),
              disabled: !session.current.can_accept,
            },
            { value: "request_changes", label: tr("request_changes") },
          ]}
        />
      </label>
      <label htmlFor={`${prefix}-comment`}>
        <span>{tr("comment")} *</span>
        <Input.TextArea
          id={`${prefix}-comment`}
          value={session.comment}
          disabled={busy}
          maxLength={4000}
          autoSize={{ minRows: 3, maxRows: 8 }}
          onChange={(event) => onChange({ comment: event.target.value })}
        />
      </label>
      <label htmlFor={`${prefix}-evidence`}>
        <span>{tr("evidenceContent")}</span>
        <Input.TextArea
          id={`${prefix}-evidence`}
          value={session.evidenceContent}
          disabled={busy}
          maxLength={20000}
          autoSize={{ minRows: 4, maxRows: 10 }}
          onChange={(event) =>
            onChange({ evidenceContent: event.target.value })
          }
        />
      </label>
      <label htmlFor={`${prefix}-url`}>
        <span>{tr("evidenceUrl")}</span>
        <Input
          id={`${prefix}-url`}
          value={session.evidenceUrl}
          disabled={busy}
          maxLength={2000}
          onChange={(event) => onChange({ evidenceUrl: event.target.value })}
        />
      </label>
      <p className="delivery-manual-help">{tr("sourceHint")}</p>
    </div>
  );
}

export function DeliveryManualReviewPanel({
  projectId,
  sessionId,
  taskId,
  disabled = false,
  canSubmit,
  onSaved,
  onEditingChange,
  onUnresolvedChange,
}: {
  projectId: string;
  sessionId: string;
  taskId: string;
  disabled?: boolean;
  canSubmit?: () => boolean;
  onSaved?: (workspace: DeliveryCommandAck) => void;
  onEditingChange?: (editing: boolean) => void;
  onUnresolvedChange?: (pending: boolean) => void;
}) {
  const { t, i18n } = useTranslation(), shared = taskSubmissionCopy(i18n?.language);
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`deliveryManualReview.${key}`, options);
  const qc = useQueryClient();
  const access = useRef({ disabled, canSubmit }); access.current = { disabled, canSubmit };
  // Fresh writes share the task's live authority; retained replay stays independent.
  const canWrite = () => !access.current.disabled && access.current.canSubmit?.() !== false;
  const [session, setSession] = useDeliveryDraftState<ManualReviewSession | null>(null, onEditingChange);
  const [draftScope, setDraftScope] = useState("");
  const [feedback, setFeedback] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [latest, setLatest] = useState<TaskReviewCurrentResponse | null>(null);
  const [openedId, setOpenedId] = useState("");
  const pendingCallback = useRef(onUnresolvedChange); pendingCallback.current = onUnresolvedChange;
  const liveCommand = useRef<{ snapshot: () => { phase: string } }>();
  const command = useManualReviewCommand(projectId, taskId, (value) => pendingCallback.current?.(value || liveCommand.current?.snapshot().phase === "succeeded")); liveCommand.current = command;
  const phase = command.state.phase,
    busy = phase === "sending";
  const modalOpen =
    Boolean(session) || ["sending", "unknown", "refused", "succeeded"].includes(phase);
  useEffect(() => { pendingCallback.current?.(["sending", "unknown", "succeeded"].includes(phase)); }, [phase]);
  const origin = JSON.stringify([
    projectId,
    sessionId,
    taskId,
    projectSessionKey(),
  ]);
  const read = useMemo(
    () =>
      bindSessionRequest({ projectId, revision: getSessionRevision() || "" }),
    [projectId, sessionId],
  );
  const current = useQuery({
    queryKey: ["delivery-task-review-current", projectId, sessionId, taskId],
    queryFn: ({ signal }) =>
      fetchTaskReviewCurrent(projectId, taskId, { signal, read }),
    gcTime: 0,
    retry: false,
  });
  const historyKey = ["delivery-task-reviews", projectId, sessionId, taskId];
  const history = useInfiniteQuery({
    queryKey: historyKey,
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) =>
      fetchTaskReviews(projectId, taskId, { signal, cursor: pageParam, read }),
    getNextPageParam: (page) => page.next_cursor || undefined,
    gcTime: 0,
    retry: false,
  });
  const original = useQuery({
    queryKey: [
      "delivery-task-review-original",
      projectId,
      sessionId,
      taskId,
      openedId,
    ],
    queryFn: ({ signal }) =>
      fetchTaskReviewOriginal(projectId, taskId, openedId, { signal, read }),
    enabled: Boolean(openedId),
    gcTime: 0,
    retry: false,
  });
  const proof = !current.isError ? current.data : undefined;
  const data = history.data?.pages[0];
  const reviews = [
    ...new Map(
      history.data?.pages
        .flatMap((page) => page.reviews)
        .map((review) => [review.id, review]) || [],
    ).values(),
  ];
  function open() {
    if (
      !canWrite() ||
      !proof?.current?.can_review ||
      !command.current() ||
      phase !== "idle"
    )
      return;
    setSession(openManualReview(proof, crypto.randomUUID()));
    setDraftScope(origin);
    setFeedback("");
    setRefreshFailed(false);
    setProblems([]);
    setLatest(null);
  }
  async function saved(ack: DeliveryCommandAck | undefined) {
    if (!ack || !command.current()) return;
    const decision = command.snapshot().original?.payload.decision;
    command.reset();
    if (command.snapshot().phase !== "idle") { pendingCallback.current?.(true); return; }
    pendingCallback.current?.(false);
    setSession(null);
    setLatest(null);
    setFeedback(decision === "accept" ? "savedAccept" : "savedChanges");
    try { onSaved?.(ack);
    for (const key of [
      "delivery",
      "delivery-inbox",
      "delivery-progress",
      "tasks",
      "tasksSummary",
      "taskAgentFeed",
      "taskSchedulerInsights",
      "delivery-task-review-current",
    ])
      void qc.invalidateQueries({ queryKey: [key] });
    await qc.resetQueries({ queryKey: historyKey, exact: true });
    } catch { setRefreshFailed(true); }
  }
  async function submit() {
    if (
      !canWrite() ||
      !session ||
      busy ||
      phase !== "idle" ||
      draftScope !== origin ||
      session.projectId !== projectId ||
      session.taskId !== taskId ||
      !command.current()
    )
      return;
    const invalid = manualReviewProblems(session);
    setProblems(invalid);
    if (invalid.length) {
      const field = invalid[0].startsWith("comment")
        ? "comment"
        : ["unsafeUrl", "urlTooLong"].includes(invalid[0])
          ? "url"
          : "evidence";
      document
        .getElementById(`manual-review-${session.taskId}-${field}`)
        ?.focus();
      return;
    }
    const prepared = prepareManualReview(session);
    setSession(prepared.session);
    await saved(
      await command.run({
        action: "task.manual_review",
        payload: prepared.command.payload,
        intent: prepared.session.intent,
      }),
    );
  }
  async function loadLatest() {
    if (!command.current() || phase !== "refused") return;
    setLatest(null);
    const result = await current.refetch();
    if (command.current() && !result.isError && result.data)
      setLatest(structuredClone(result.data));
  }
  function adopt() {
    if (
      !canWrite() || !latest?.current?.can_review ||
      !command.current() ||
      phase !== "refused"
    )
      return;
    const retained = command.state.original;
    const draft =
      session ||
      (retained
        ? {
            ...openManualReview(latest, crypto.randomUUID()),
            decision: retained.payload.decision,
            comment: retained.payload.comment,
            evidenceContent: retained.payload.evidence_content,
            evidenceUrl: retained.payload.evidence_url,
          }
        : null);
    if (!draft) return;
    const next = adoptManualReviewBasis(draft, latest, crypto.randomUUID());
    command.reset();
    if (command.snapshot().phase !== "idle") return;
    setSession(next);
    setDraftScope(origin);
    setLatest(null);
    setProblems([]);
  }
  return (
    <section className="delivery-manual-panel" aria-label={tr("title")}>
      <div className="delivery-manual-heading">
        <div>
          <ClipboardCheck size={16} />
          <h3>{tr("title")}</h3>
        </div>
        <Button
          size="small"
          onClick={open}
          disabled={
            disabled ||
            !proof?.current?.can_review ||
            phase !== "idle" ||
            !command.current()
          }
        >
          {tr("open")}
        </Button>
      </div>
      <p className="delivery-manual-help">{tr("intro")}</p>
      {feedback && (
        <Alert
          type="success"
          showIcon
          title={tr(feedback)}
          closable
          onClose={() => setFeedback("")}
        />
      )}
      {refreshFailed && <Alert type="warning" role="alert" title={shared.refreshFailed} />}
      <div className="delivery-manual-heading">
        <h4>{tr("currentFacts")}</h4>
        <Button
          size="small"
          type="text"
          icon={<RefreshCw size={14} />}
          aria-label={tr("refreshCurrent")}
          loading={current.isFetching}
          onClick={() => void current.refetch()}
        />
      </div>
      {current.isPending && <Skeleton active paragraph={{ rows: 2 }} />}
      {current.error && (
        <Alert
          type="warning"
          showIcon
          title={tr("currentFailed")}
          description={manualReviewError(current.error).message}
          action={
            <Button size="small" onClick={() => void current.refetch()}>
              {tr("retry")}
            </Button>
          }
        />
      )}
      {proof && <ManualReviewFacts current={proof.current} compact />}
      <div className="delivery-manual-heading">
        <h4>{tr("history")}</h4>
        <div>
          {data && <small>{tr("reviewCount", { count: data.total })}</small>}
          <Button
            size="small"
            type="text"
            icon={<RefreshCw size={14} />}
            aria-label={tr("refreshHistory")}
            loading={history.isFetching}
            onClick={() =>
              void qc.resetQueries({ queryKey: historyKey, exact: true })
            }
          />
        </div>
      </div>
      {history.isPending && <Skeleton active paragraph={{ rows: 2 }} />}
      {history.error && (
        <Alert
          type="error"
          showIcon
          title={tr("historyFailed")}
          description={manualReviewError(history.error).message}
          action={
            <Button size="small" onClick={() => void history.refetch()}>
              {tr("retry")}
            </Button>
          }
        />
      )}
      {data && !history.isError && (
        <>
          {reviews.length ? (
            <ManualReviewHistory
              reviews={reviews}
              effectiveReviewId={proof?.effective_review_id}
              openedId={openedId}
              onOpen={setOpenedId}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={tr("noHistory")}
            />
          )}
          {history.hasNextPage && (
            <Button
              loading={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {tr("loadMore")}
            </Button>
          )}
        </>
      )}
      {openedId && (
        <section className="delivery-manual-original-container">
          <div className="delivery-manual-heading">
            <h4>{tr("originalFacts")}</h4>
            <Button size="small" onClick={() => setOpenedId("")}>
              {tr("hideOriginal")}
            </Button>
          </div>
          {original.isPending && <Skeleton active paragraph={{ rows: 3 }} />}
          {original.error && (
            <Alert
              type="error"
              showIcon
              title={tr("originalFailed")}
              description={manualReviewError(original.error).message}
              action={
                <Button size="small" onClick={() => void original.refetch()}>
                  {tr("retry")}
                </Button>
              }
            />
          )}
          {!original.isError && original.data && (
            <ManualReviewOriginalFacts review={original.data.review} />
          )}
        </section>
      )}
      <Modal
        open={modalOpen}
        className="delivery-manual-modal"
        title={tr("title")}
        width={680}
        mask={{ closable: false }}
        destroyOnHidden
        onCancel={() => {
          if (command.locked) return;
          if (phase === "refused") command.reset();
          if (command.snapshot().phase === "idle") setSession(null);
        }}
        onOk={() => void submit()}
        okText={tr("submit")}
        cancelText={tr("cancel")}
        confirmLoading={busy}
        okButtonProps={{
          disabled:
            disabled ||
            phase !== "idle" ||
            !session?.current.can_review ||
            (session.decision === "accept" && !session.current.can_accept) ||
            draftScope !== origin ||
            !command.current(),
        }}
        cancelButtonProps={{ disabled: command.locked }}
        closable={!command.locked}
        keyboard={!command.locked}
      >
        {command.state.error && (
          <Alert
            type="error"
            showIcon
            title={phase === "succeeded" ? shared.confirmed : tr("commandFailed")}
            description={
              [
                "ackMismatch",
                "retainedOriginalInvalid",
                "retainedOriginalUnavailable",
              ].includes(command.state.error)
                ? tr(`commandErrors.${command.state.error}`)
                : command.state.error
            }
          />
        )}
        {problems.length > 0 && (
          <Alert
            type="error"
            showIcon
            title={problems
              .map((problem) => tr(`problems.${problem}`))
              .join(" ")}
          />
        )}
        {phase === "unknown" && (
          <Alert
            type="warning"
            showIcon
            title={tr("unknownRequest")}
            description={tr("unknownHint")}
            action={
              <Button
                disabled={!command.state.original || !command.current()}
                onClick={() => void command.replay().then(saved)}
              >
                {tr("retryOriginal")}
              </Button>
            }
          />
        )}
        {phase === "succeeded" && <Alert type="info" role="status" title={shared.confirmed} action={<Button data-action="finish-manual-review" onClick={() => void saved(command.snapshot().ack)}>{shared.finish}</Button>} />}
        {phase === "refused" && (
          <section className="delivery-manual-conflict">
            <p className="delivery-manual-help">{tr("refusedHint")}</p>
            <Button
              loading={current.isFetching}
              onClick={() => void loadLatest()}
            >
              {tr("loadLatest")}
            </Button>
            {latest && (
              <>
                <h4>
                  {tr("latest")} · {tr("version")} {latest.version}
                </h4>
                <ManualReviewFacts current={latest.current} />
                <p className="delivery-manual-help">{tr("adoptHint")}</p>
                <Button disabled={!latest.current?.can_review} onClick={adopt}>
                  {tr("adopt")}
                </Button>
              </>
            )}
          </section>
        )}
        {session ? (
          <ManualReviewFormFields
            session={session}
            busy={phase !== "idle"}
            onChange={(patch) => {
              if (phase === "idle" && command.current()) {
                setSession((value) => (value ? { ...value, ...patch } : value));
                setProblems([]);
              }
            }}
          />
        ) : (
          command.state.original && (
            <ManualReviewRetainedOriginal original={command.state.original} />
          )
        )}
      </Modal>
    </section>
  );
}
function ManualReviewRetainedOriginal({
  original,
}: {
  original: ManualReviewOriginal;
}) {
  const { t } = useTranslation();
  return (
    <section className="delivery-manual-retained">
      <p>{t("deliveryManualReview.frozen")}</p>
      <p>
        {t("deliveryManualReview.version")}: {original.intent.version}
      </p>
      <p className="delivery-manual-fixed">
        {t("deliveryManualReview.basis")}: <code>{original.payload.basis}</code>
      </p>
      <p className="delivery-manual-content">{original.payload.comment}</p>
      <p className="delivery-manual-content">
        {original.payload.evidence_content}
      </p>
      <p className="delivery-manual-content">{original.payload.evidence_url}</p>
    </section>
  );
}
