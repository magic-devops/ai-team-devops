import { useQuery } from "@tanstack/react-query";
import {
  fetchDeliveryReferences,
  type MilestoneSummary,
} from "@/lib/deliveryQuery";
import type { DeliveryResource } from "@/lib/delivery";
import { Button, Progress, Skeleton, Tag } from "antd";
import { DeliveryQueryError } from "./DeliveryQueryViews";
import { getSessionRevision } from "@/lib/authStorage";
import { ArrowRight, FileText, Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DeliveryInbox, DeliveryContext } from "@/lib/delivery";
import {
  inboxCategories,
  type InboxCategory,
} from "@/lib/deliveryProjectInbox";

export function DeliveryProjectOverview({
  data,
  inbox,
  onView,
  onMilestone,
  onInboxCategory,
  inboxError,
  inboxLoading,
  onRefreshInbox,
}: {
  data: DeliveryContext;
  inbox?: DeliveryInbox;
  onView: (view: string) => void;
  onMilestone: (id: string) => void;
  onInboxCategory?: (category: InboxCategory) => void;
  inboxError?: string;
  inboxLoading?: boolean;
  onRefreshInbox?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tp = (key: string) => t(`deliveryProject.${key}`);
  const milestoneQuery = useQuery({
    queryKey: [
      "delivery-overview-milestones",
      data.project.id,
      getSessionRevision(),
      data.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryReferences<MilestoneSummary>(
        data.project.id,
        "milestone",
        { limit: 3, sort: "ends_asc" },
        signal,
        data.query_generation,
      ),
    retry: false,
    gcTime: 0,
  });
  const resourceQuery = useQuery({
    queryKey: [
      "delivery-overview-resources",
      data.project.id,
      getSessionRevision(),
      data.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryReferences<DeliveryResource>(
        data.project.id,
        "resource",
        { limit: 2, archived: false },
        signal,
        data.query_generation,
      ),
    retry: false,
    gcTime: 0,
  });
  const activeResources =
    resourceQuery.data?.items.map((item) => item.data) || [];
  const milestones = milestoneQuery.data?.items.map((item) => item.data) || [];
  return (
    <div className="delivery-project-overview">
      <section className="delivery-panel delivery-project-milestones">
        <div className="delivery-section-heading">
          <h2>{tp("recentMilestones")}</h2>
          <Button type="link" size="small" onClick={() => onView("timeline")}>
            {tp("viewMilestones")}
            <ArrowRight size={12} />
          </Button>
        </div>
        {milestoneQuery.isPending ? (
          <Skeleton active />
        ) : milestoneQuery.error ? (
          <DeliveryQueryError
            error={milestoneQuery.error}
            onRetry={() => void milestoneQuery.refetch()}
          />
        ) : milestones.length ? (
          <div className="delivery-compact-milestones">
            {milestones.map((milestone) => {
              const linkedCount = milestone.requirement_count ?? 0;
              const accepted = milestone.accepted_requirement_count ?? 0;
              return (
                <button
                  type="button"
                  key={milestone.id}
                  onClick={() => onMilestone(milestone.id)}
                >
                  <div>
                    <strong>{milestone.title}</strong>
                    <small>
                      {milestone.ends_on
                        ? new Intl.DateTimeFormat(i18n.language, {
                            month: "short",
                            day: "numeric",
                            timeZone: "UTC",
                          }).format(new Date(`${milestone.ends_on}T12:00:00Z`))
                        : tp("noDue")}
                    </small>
                  </div>
                  <Progress
                    percent={
                      linkedCount
                        ? Math.round((accepted / linkedCount) * 100)
                        : 0
                    }
                    size="small"
                    showInfo={false}
                  />
                  <span>
                    {t("deliveryProject.milestoneCount", {
                      count: linkedCount,
                    })}{" "}
                    · {t("delivery.accepted")} {accepted}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="delivery-hint">{tp("noMilestones")}</p>
        )}
      </section>
      <section className="delivery-panel delivery-project-entry">
        <FileText size={20} />
        <div>
          <h2>{tp("resources")}</h2>
          <p>
            {resourceQuery.data
              ? t("deliveryProject.resourceCount", {
                  count: resourceQuery.data.total,
                })
              : "—"}
          </p>
          <div>
            {activeResources.slice(0, 2).map((resource) => (
              <Tag key={resource.id}>{resource.title}</Tag>
            ))}
          </div>
        </div>
        <Button size="small" onClick={() => onView("resources")}>
          {tp("viewResources")}
        </Button>
      </section>
      <section className="delivery-panel delivery-project-entry">
        <Inbox size={20} />
        <div>
          <h2>{tp("mine")}</h2>
          <p>
            {inbox && !inboxError
              ? t("deliveryProject.pendingCount", { count: inbox.counts.total })
              : tp("inbox")}
          </p>
          {inboxLoading && <Skeleton active paragraph={false} />}
          {inboxError && (
            <DeliveryQueryError
              error={inboxError}
              onRetry={onRefreshInbox || (() => {})}
              onReset={onRefreshInbox}
            />
          )}
          {inbox && !inboxError && (
            <div className="delivery-overview-inbox-counts">
              {inboxCategories.map((category) => (
                <button
                  type="button"
                  key={category}
                  aria-label={tp(`category.${category}`)}
                  onClick={() =>
                    onInboxCategory
                      ? onInboxCategory(category)
                      : onView("inbox")
                  }
                >
                  <span>{tp(`category.${category}`)}</span>
                  <strong>{inbox.counts[category]}</strong>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button size="small" onClick={() => onView("inbox")}>
          {tp("viewInbox")}
        </Button>
      </section>
    </div>
  );
}
