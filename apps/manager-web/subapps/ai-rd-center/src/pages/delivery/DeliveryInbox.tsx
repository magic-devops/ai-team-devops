import { useDeliveryMemberReferences } from "@/lib/deliveryQueryHooks";
import { Alert, Button, Empty, Segmented, Skeleton, Tag } from "antd";
import { ArrowRight, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  DeliveryInbox as InboxData,
  DeliveryInboxItem,
  DeliveryInboxTarget,
  DeliveryContext,
} from "@/lib/delivery";
import {
  inboxCategories,
  type InboxCategory,
  type InboxScope,
} from "@/lib/deliveryProjectInbox";
import { deliveryBlocker } from "@/lib/deliveryBlockers";
import { useMemberIdentity } from "@/components/DeliveryMemberIdentity";
import { deliveryQueryFailure } from "@/lib/deliveryQuery";

export function DeliveryInbox({
  data,
  workspace,
  scope,
  category,
  page = 1,
  loading,
  refreshing,
  error,
  onScope,
  onCategory,
  onRefresh,
  onOpen,
  onFirstPage,
  onNextPage,
  navigationError,
  navigationBusy,
  onRetryOpen,
}: {
  data?: InboxData;
  workspace: DeliveryContext;
  scope: InboxScope;
  category: InboxCategory;
  page?: number;
  cursor?: string;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  onScope: (scope: InboxScope) => void;
  onCategory: (category: InboxCategory) => void;
  onRefresh: () => void;
  onOpen: (target: DeliveryInboxTarget) => void;
  onFirstPage?: () => void;
  onNextPage?: (cursor: string) => void;
  navigationError?: string;
  navigationBusy?: string;
  onRetryOpen?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tp = (key: string) => t(`deliveryProject.${key}`);
  const ta = (key: string, values?: Record<string, unknown>) =>
    t(`deliveryAttention.${key}`, values);
  const failure = deliveryQueryFailure(error);
  const current = !error ? data : undefined;
  const items = current?.items || [];
  const identity = useMemberIdentity();
  const memberRefs = useDeliveryMemberReferences(
    workspace.project.id,
    "inbox",
    items.map((item) => item.owner_id),
    workspace.query_generation,
  );
  const ownerName = (id: string) => identity(memberRefs.members, id);
  const due = (date: string | null) =>
    date
      ? new Intl.DateTimeFormat(i18n.language, {
          year: "numeric",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`))
      : tp("unscheduled");
  const statusLabel = (item: DeliveryInboxItem) =>
    item.acceptance_kind === "external"
      ? ta("externalAcceptance")
      : item.acceptance_kind === "manual"
        ? ta("manualAcceptance")
        : item.acceptance_kind === "execution"
          ? ta("executionAcceptance")
          : t(`deliveryProject.status.${item.status}`, {
              defaultValue: t(`delivery.statuses.${item.status}`, {
                defaultValue: item.status,
              }),
            });
  const openItem = (item: DeliveryInboxItem) =>
    onOpen({
      ...item.target,
      ...(item.kind === "issue" ? { issue_id: item.resource_id } : {}),
    });
  return (
    <section className="delivery-inbox">
      <div className="delivery-section-heading delivery-project-heading">
        <div>
          <h2>{tp("inbox")}</h2>
          <p className="delivery-hint">{tp("inboxHint")}</p>
        </div>
        <Button
          icon={<RefreshCw size={15} />}
          loading={refreshing}
          onClick={onRefresh}
        >
          {t("delivery.refresh")}
        </Button>
      </div>
      <div className="delivery-inbox-toolbar">
        <Segmented
          aria-label={tp("inbox")}
          value={scope}
          onChange={(value) => onScope(value as InboxScope)}
          options={[
            { label: tp("mine"), value: "mine" },
            { label: tp("team"), value: "team" },
          ]}
        />
        {current && (
          <small>
            {t("deliveryProject.asOf", {
              time: new Date(current.as_of).toLocaleString(i18n.language),
            })}
          </small>
        )}
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          title={
            failure.stale
              ? ta("changed")
              : failure.rebuild
                ? t("deliveryQuery.rebuildRequired")
                : error
          }
          action={
            <Button
              size="small"
              onClick={failure.stale && onFirstPage ? onFirstPage : onRefresh}
            >
              {failure.stale ? ta("firstPage") : t("delivery.refresh")}
            </Button>
          }
        />
      )}
      {navigationError && (
        <Alert
          type="error"
          showIcon
          title={ta("openFailed")}
          description={navigationError}
          action={
            <Button size="small" onClick={onRetryOpen}>
              {ta("retryOpen")}
            </Button>
          }
        />
      )}
      {loading ? (
        <Skeleton active paragraph={{ rows: 7 }} />
      ) : (
        <>
          <div className="delivery-inbox-counts" aria-label={tp("all")}>
            {inboxCategories.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={category === key}
                className={category === key ? "is-selected" : ""}
                onClick={() => onCategory(category === key ? "all" : key)}
              >
                <span>{tp(`category.${key}`)}</span>
                <strong>{current?.counts[key] ?? "—"}</strong>
              </button>
            ))}
          </div>
          <div className="delivery-inbox-filters">
            <Button
              size="small"
              type={category === "all" ? "primary" : "default"}
              aria-pressed={category === "all"}
              onClick={() => onCategory("all")}
            >
              {tp("all")} {current?.counts.total ?? "—"}
            </Button>
            <Button
              size="small"
              type={category === "overdue" ? "primary" : "default"}
              aria-pressed={category === "overdue"}
              onClick={() =>
                onCategory(category === "overdue" ? "all" : "overdue")
              }
            >
              {tp("overdue")} {current?.counts.overdue ?? "—"}
            </Button>
            <span>{tp("uniqueHint")}</span>
          </div>
          {current &&
            (items.length ? (
              <div className="delivery-inbox-list">
                {items.map((item) => (
                  <article
                    key={item.id}
                    className={`delivery-inbox-row ${item.overdue ? "is-overdue" : ""}`}
                  >
                    <div className="delivery-inbox-main">
                      <div className="delivery-inbox-title">
                        <Tag>{tp(`itemKinds.${item.kind}`)}</Tag>
                        <h3>
                          <button
                            className="delivery-title-link"
                            disabled={Boolean(navigationBusy)}
                            onClick={() => openItem(item)}
                          >
                            {item.title}
                          </button>
                        </h3>
                        {item.priority && (
                          <Tag
                            color={item.priority === "P0" ? "red" : "default"}
                          >
                            {item.priority}
                          </Tag>
                        )}
                      </div>
                      <div className="delivery-inbox-meta">
                        <small>{item.resource_id}</small>
                        <span>{statusLabel(item)}</span>
                        {item.stage && (
                          <span>
                            {t(`delivery.stages.${item.stage}`, {
                              defaultValue: item.stage,
                            })}
                          </span>
                        )}
                        <span>
                          {tp("owner")}: {ownerName(item.owner_id)}
                        </span>
                      </div>
                      <div className="delivery-inbox-labels">
                        {item.categories.map((key) => (
                          <Tag
                            key={key}
                            color={
                              key === "blocked"
                                ? "red"
                                : key === "acceptance"
                                  ? "gold"
                                  : "default"
                            }
                          >
                            {tp(`category.${key}`)}
                          </Tag>
                        ))}
                        {item.overdue && <Tag color="red">{tp("overdue")}</Tag>}
                      </div>
                      {!!item.blocked_reasons.length && (
                        <ul
                          aria-label={tp("blockedReasons")}
                          className="delivery-inbox-reasons"
                        >
                          {item.blocked_reasons.map((reason, index) => (
                            <li key={index}>
                              {deliveryBlocker(reason, (key, values) =>
                                t(`deliveryProject.blocker.${key}`, values),
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {item.blocked_reason_count >
                        item.blocked_reasons.length && (
                        <small className="delivery-hint">
                          {ta("moreBlockers", {
                            count:
                              item.blocked_reason_count -
                              item.blocked_reasons.length,
                          })}
                        </small>
                      )}
                    </div>
                    <div className="delivery-inbox-end">
                      <span className={item.overdue ? "delivery-overdue" : ""}>
                        {tp("due")}: {due(item.due_on)}
                      </span>
                      <Button
                        size="small"
                        icon={<ArrowRight size={13} />}
                        loading={Boolean(
                          navigationBusy && navigationBusy === item.task_id,
                        )}
                        disabled={Boolean(
                          navigationBusy && navigationBusy !== item.task_id,
                        )}
                        onClick={() => openItem(item)}
                      >
                        {item.acceptance_kind === "external"
                          ? ta("openExternalAcceptance")
                          : item.acceptance_kind === "manual"
                            ? ta("openManualAcceptance")
                            : item.acceptance_kind === "execution"
                              ? ta("openExecutionAcceptance")
                              : tp("open")}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <>
                    <strong>
                      {tp(
                        category !== "all"
                          ? "noCategoryItems"
                          : scope === "mine"
                            ? "myEmpty"
                            : "teamEmpty",
                      )}
                    </strong>
                    <p>{tp("inboxEmptyHint")}</p>
                  </>
                }
              />
            ))}
          {current && (
            <div className="delivery-query-pagination delivery-attention-pagination">
              <span role="status">
                {ta("pageCount", { page, total: current.total })}
              </span>
              <Button disabled={page <= 1 || refreshing} onClick={onFirstPage}>
                {ta("firstPage")}
              </Button>
              <Button
                disabled={
                  !current.has_more || !current.next_cursor || refreshing
                }
                onClick={() => onNextPage?.(current.next_cursor!)}
              >
                {ta("nextPage")}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
