import { Alert, Button, Empty, Segmented, Skeleton, Tag } from "antd";
import { ArrowRight, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  DeliveryInbox as InboxData,
  DeliveryInboxItem,
  DeliveryInboxTarget,
  DeliveryWorkspace,
} from "@/lib/delivery";
import {
  filterDeliveryInbox,
  inboxCategories,
  type InboxCategory,
  type InboxScope,
} from "@/lib/deliveryProjectInbox";
import { deliveryBlocker } from "@/lib/deliveryBlockers";
import { useMemberIdentity } from "@/components/DeliveryMemberIdentity";

export function DeliveryInbox({
  data,
  workspace,
  scope,
  category,
  loading,
  refreshing,
  error,
  onScope,
  onCategory,
  onRefresh,
  onOpen,
}: {
  data?: InboxData;
  workspace: DeliveryWorkspace;
  scope: InboxScope;
  category: InboxCategory;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  onScope: (scope: InboxScope) => void;
  onCategory: (category: InboxCategory) => void;
  onRefresh: () => void;
  onOpen: (target: DeliveryInboxTarget) => void;
}) {
  const { t, i18n } = useTranslation();
  const tp = (key: string) => t(`deliveryProject.${key}`);
  const items = filterDeliveryInbox(data?.items || [], category);
  const identity = useMemberIdentity();
  const ownerName = (id: string) => identity(workspace.members, id);
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
    t(`deliveryProject.status.${item.status}`, {
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
        {data && (
          <small>
            {t("deliveryProject.asOf", {
              time: new Date(data.as_of).toLocaleString(i18n.language),
            })}
          </small>
        )}
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={
            <Button size="small" onClick={onRefresh}>
              {t("delivery.refresh")}
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
                <strong>{data?.counts[key] ?? "—"}</strong>
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
              {tp("all")} {data?.counts.total ?? "—"}
            </Button>
            <Button
              size="small"
              type={category === "overdue" ? "primary" : "default"}
              aria-pressed={category === "overdue"}
              onClick={() =>
                onCategory(category === "overdue" ? "all" : "overdue")
              }
            >
              {tp("overdue")} {data?.counts.overdue ?? "—"}
            </Button>
            <span>{tp("uniqueHint")}</span>
          </div>
          {data &&
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
                    </div>
                    <div className="delivery-inbox-end">
                      <span className={item.overdue ? "delivery-overdue" : ""}>
                        {tp("due")}: {due(item.due_on)}
                      </span>
                      <Button
                        size="small"
                        icon={<ArrowRight size={13} />}
                        onClick={() => openItem(item)}
                      >
                        {tp("open")}
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
        </>
      )}
    </section>
  );
}
