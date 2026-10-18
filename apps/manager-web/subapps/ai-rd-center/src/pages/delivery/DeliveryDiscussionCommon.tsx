import { Alert, Button, Empty, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type {
  DiscussionReference,
  DiscussionSourceReference,
  DiscussionAdoption,
} from "@/lib/deliveryDiscussions";
import { discussionFailure } from "@/lib/deliveryDiscussions";
export function DiscussionProblem({
  error,
  onRetry,
  onReset,
}: {
  error: unknown;
  onRetry?: () => void;
  onReset?: () => void;
}) {
  const { t } = useTranslation();
  const problem = discussionFailure(error);
  return (
    <Alert
      showIcon
      type="error"
      role="alert"
      title={t(
        `deliveryDiscussion.${problem.stale ? "stale" : problem.forbidden ? "forbidden" : problem.conflict ? "conflict" : "failed"}`,
      )}
      description={problem.message}
      action={
        <div className="discussion-actions">
          {onReset && (
            <Button onClick={onReset}>{t("deliveryDiscussion.first")}</Button>
          )}
          {onRetry && (
            <Button onClick={onRetry}>{t("deliveryDiscussion.refresh")}</Button>
          )}
        </div>
      }
    />
  );
}
export function DiscussionPager({
  page,
  total,
  hasMore,
  busy,
  onFirst,
  onNext,
}: {
  page: number;
  total: number;
  hasMore: boolean;
  busy?: boolean;
  onFirst: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      className="discussion-pager"
      aria-label={t("deliveryDiscussion.title")}
    >
      <span role="status">{t("deliveryDiscussion.page", { page, total })}</span>
      <Button size="small" onClick={onFirst} disabled={busy}>
        {t("deliveryDiscussion.first")}
      </Button>
      <Button size="small" onClick={onNext} disabled={busy || !hasMore}>
        {t("deliveryDiscussion.next")}
      </Button>
    </nav>
  );
}
export function DiscussionReferences({
  refs,
}: {
  refs: DiscussionReference[];
}) {
  const { t } = useTranslation();
  return (
    <div className="discussion-references">
      {refs.map((ref, index) => (
        <blockquote key={`${ref.kind}:${ref.id}:${index}`}>
          <div>
            <Tag>{t(`deliveryDiscussion.${ref.kind}`)}</Tag>
            <code>{ref.id}</code>
          </div>
          {ref.status === "unavailable" ? (
            <p>{t("deliveryDiscussion.unavailable")}</p>
          ) : (
            <>
              <small>
                {t(
                  `deliveryDiscussion.${ref.field === "title" ? "titleField" : ref.field || "summary"}`,
                )}
                {ref.criterion_index != null
                  ? ` ${ref.criterion_index + 1}`
                  : ""}
              </small>
              <p className="discussion-text">{ref.text}</p>
              {ref.runtime && (
                <small>
                  {ref.runtime.run_id} · {ref.runtime.attempt} ·{" "}
                  {ref.runtime.executor_id}
                </small>
              )}
            </>
          )}
        </blockquote>
      ))}
    </div>
  );
}
export function DiscussionSourceCard({
  adoption,
  onRemove,
}: {
  adoption: DiscussionAdoption;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="discussion-fixed-source">
      <strong>
        {t("deliveryDiscussion.fixed")} · {adoption.thread.title}
      </strong>
      <p className="discussion-text">{adoption.message.body}</p>
      <small>
        {adoption.message.author.name || adoption.message.author.id} ·{" "}
        {t("deliveryDiscussion.revision", {
          revision: adoption.reference.message_revision,
        })}
      </small>
      <DiscussionReferences refs={adoption.message.refs} />
      {onRemove && (
        <Button size="small" onClick={onRemove}>
          {t("deliveryDiscussion.dropSource")}
        </Button>
      )}
    </aside>
  );
}
export function discussionSourceMatches(
  a: DiscussionSourceReference | undefined,
  b: DiscussionSourceReference | undefined,
) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}
export function DiscussionEmpty({ sources = false }: { sources?: boolean }) {
  const { t } = useTranslation();
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={t(
        `deliveryDiscussion.${sources ? "emptySources" : "empty"}`,
      )}
    />
  );
}
