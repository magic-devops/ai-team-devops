import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
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
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  safeEvidenceUrl,
  saveDelivery,
  type DeliveryWorkspace,
} from "@/lib/delivery";
import {
  adoptManualReviewBasis,
  fetchTaskReviews,
  manualReviewError,
  manualReviewProblems,
  openManualReview,
  prepareManualReview,
  type ManualReviewCurrent,
  type ManualReviewSession,
  type ManualTaskReview,
  type TaskReviewPage,
} from "@/lib/deliveryTaskReview";
import "./delivery-manual-review.css";

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
}: Pick<ManualReviewCurrent, "task" | "owner" | "requirement" | "planning">) {
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
          <strong>{tr("criteria")}</strong>
          {requirement.acceptance_criteria.length ? (
            <ol>
              {requirement.acceptance_criteria.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ol>
          ) : (
            <p>{tr("noCriteria")}</p>
          )}
          {planning.acceptance_criteria.length > 0 && (
            <p>
              {tr("taskCriteria")}:{" "}
              {planning.acceptance_criteria
                .map(
                  (index) =>
                    requirement.acceptance_criteria[index] ||
                    tr("missingCriterion"),
                )
                .join(" · ")}
            </p>
          )}
        </div>
      )}
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
              {tr(`reasons.${reason.code}`, { defaultValue: reason.message })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ManualReviewHistory({
  reviews,
}: {
  reviews: ManualTaskReview[];
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`deliveryManualReview.${key}`, options);
  return (
    <div className="delivery-manual-history">
      {reviews.map((review) => {
        const url = safeEvidenceUrl(review.evidence_url);
        const status = review.invalidated
          ? "invalidated"
          : review.valid
            ? "verified"
            : review.decision === "request_changes"
              ? "request_changes"
              : "historical";
        return (
          <details
            className={`delivery-manual-review-record ${status}`}
            key={review.id}
          >
            <summary>
              <span className="delivery-manual-review-status">
                <Tag
                  color={
                    review.invalidated
                      ? "warning"
                      : review.valid
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
            </summary>
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
                  <p className="delivery-manual-content">
                    {review.evidence_content}
                  </p>
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
          </details>
        );
      })}
    </div>
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
  onSaved,
  onEditingChange,
}: {
  projectId: string;
  sessionId: string;
  taskId: string;
  onSaved?: (workspace: DeliveryWorkspace) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`deliveryManualReview.${key}`, options);
  const qc = useQueryClient();
  const [session, setSession] = useState<ManualReviewSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<TaskReviewPage | null>(null);
  useEffect(() => {
    if (!session) return;
    onEditingChange?.(true);
    return () => onEditingChange?.(false);
  }, [Boolean(session), onEditingChange]);
  const query = useInfiniteQuery({
    queryKey: ["delivery-task-reviews", projectId, sessionId, taskId],
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) =>
      fetchTaskReviews(projectId, taskId, { signal, cursor: pageParam }),
    getNextPageParam: (page) => page.next_cursor || undefined,
    gcTime: 0,
    retry: false,
    refetchInterval: 10000,
  });
  const data = query.data?.pages[0];
  const reviews = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.reviews)
        .map((review) => [review.id, review]) || [],
    ).values(),
  ];
  function open() {
    if (!data?.current?.can_review || query.isError) return;
    setSession(openManualReview(data, crypto.randomUUID()));
    setError("");
    setFeedback("");
    setProblems([]);
    setConflict(false);
    setLatest(null);
  }
  async function submit() {
    if (busy || !session || conflict) return;
    const invalid = manualReviewProblems(session);
    setProblems(invalid);
    if (invalid.length) {
      const field = invalid[0].startsWith("comment")
        ? "comment"
        : invalid[0] === "unsafeUrl" || invalid[0] === "urlTooLong"
          ? "url"
          : "evidence";
      document
        .getElementById(`manual-review-${session.taskId}-${field}`)
        ?.focus();
      return;
    }
    const prepared = prepareManualReview(session);
    setSession(prepared.session);
    setBusy(true);
    setError("");
    try {
      const result = await saveDelivery(
        projectId,
        prepared.command.action,
        prepared.command.payload,
        prepared.command.expected_version,
        prepared.command.idempotency_key,
      );
      onSaved?.(result);
      setSession(null);
      setFeedback(
        prepared.session.decision === "accept" ? "savedAccept" : "savedChanges",
      );
      for (const key of [
        "delivery",
        "delivery-inbox",
        "delivery-progress",
        "tasks",
        "tasksSummary",
        "taskAgentFeed",
        "taskSchedulerInsights",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
      await query.refetch();
    } catch (failure) {
      const parsed = manualReviewError(failure);
      setError(parsed.conflict ? tr("conflict") : parsed.message);
      setConflict(parsed.conflict);
      setLatest(null);
    } finally {
      setBusy(false);
    }
  }
  async function loadLatest() {
    setBusy(true);
    setLatest(null);
    try {
      setLatest(await fetchTaskReviews(projectId, taskId));
    } catch (failure) {
      setError(manualReviewError(failure).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="delivery-manual-panel" aria-label={tr("title")}>
      <div className="delivery-manual-heading">
        <div>
          <ClipboardCheck size={16} />
          <h3>{tr("title")}</h3>
        </div>
        <div>
          <Button
            size="small"
            onClick={open}
            disabled={!data?.current?.can_review || query.isError}
          >
            {tr("open")}
          </Button>
          <Button
            size="small"
            type="text"
            icon={<RefreshCw size={14} />}
            aria-label={tr("refresh")}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          />
        </div>
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
      {query.isPending && <Skeleton active paragraph={{ rows: 3 }} />}
      {query.error && (
        <Alert
          type="error"
          showIcon
          title={tr(data ? "stale" : "readFailed")}
          description={query.error.message}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              {tr("retry")}
            </Button>
          }
        />
      )}
      {data && (
        <>
          <ManualReviewFacts current={data.current} compact />
          <div className="delivery-manual-heading">
            <h4>{tr("history")}</h4>
            <small>{tr("reviewCount", { count: data.total })}</small>
          </div>
          {reviews.length ? (
            <ManualReviewHistory reviews={reviews} />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={tr("noHistory")}
            />
          )}
          {query.hasNextPage && (
            <Button
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {tr("loadMore")}
            </Button>
          )}
        </>
      )}
      <Modal
        open={Boolean(session)}
        className="delivery-manual-modal"
        title={tr("title")}
        width={680}
        onCancel={() => {
          if (!busy) setSession(null);
        }}
        onOk={() => void submit()}
        okText={tr("submit")}
        cancelText={tr("cancel")}
        confirmLoading={busy}
        okButtonProps={{
          disabled:
            conflict ||
            !session?.current.can_review ||
            (session.decision === "accept" && !session.current.can_accept),
        }}
        cancelButtonProps={{ disabled: busy }}
        closable={!busy}
        keyboard={!busy}
        maskClosable={false}
        destroyOnHidden
      >
        {error && <Alert type="error" showIcon title={error} />}
        {problems.length > 0 && (
          <Alert
            type="error"
            showIcon
            title={problems
              .map((problem) => tr(`problems.${problem}`))
              .join(" ")}
          />
        )}
        {conflict && (
          <section className="delivery-manual-conflict">
            <Button loading={busy} onClick={() => void loadLatest()}>
              {tr("loadLatest")}
            </Button>
            {latest && (
              <>
                <h4>
                  {tr("latest")} · {tr("version")} {latest.version}
                </h4>
                <ManualReviewFacts current={latest.current} />
                <p className="delivery-manual-help">{tr("adoptHint")}</p>
                <Button
                  disabled={busy || !latest.current}
                  onClick={() => {
                    if (session && latest.current) {
                      setSession(
                        adoptManualReviewBasis(
                          session,
                          latest,
                          crypto.randomUUID(),
                        ),
                      );
                      setConflict(false);
                      setLatest(null);
                      setError("");
                      setProblems([]);
                    }
                  }}
                >
                  {tr("adopt")}
                </Button>
              </>
            )}
          </section>
        )}
        {session && (
          <ManualReviewFormFields
            session={session}
            busy={busy}
            onChange={(patch) => {
              setSession((value) => (value ? { ...value, ...patch } : value));
              setProblems([]);
            }}
          />
        )}
      </Modal>
    </section>
  );
}
