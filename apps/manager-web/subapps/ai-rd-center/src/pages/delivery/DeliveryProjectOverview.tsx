import { Button, Progress, Tag } from "antd";
import { ArrowRight, FileText, Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DeliveryInbox, DeliveryWorkspace } from "@/lib/delivery";

export function DeliveryProjectOverview({
  data,
  inbox,
  onView,
  onMilestone,
}: {
  data: DeliveryWorkspace;
  inbox?: DeliveryInbox;
  onView: (view: string) => void;
  onMilestone: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const tp = (key: string) => t(`deliveryProject.${key}`);
  const activeResources = (data.resources || []).filter(
    (resource) => !resource.archived,
  );
  const milestones = [...data.milestones]
    .sort((a, b) => (a.ends_on || "9999").localeCompare(b.ends_on || "9999"))
    .slice(0, 3);
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
        {milestones.length ? (
          <div className="delivery-compact-milestones">
            {milestones.map((milestone) => {
              const linked = data.requirements.filter(
                (requirement) => requirement.flow.milestone_id === milestone.id,
              );
              const accepted = linked.filter((requirement) =>
                ["release", "operations"].includes(requirement.flow.stage),
              ).length;
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
                      linked.length
                        ? Math.round((accepted / linked.length) * 100)
                        : 0
                    }
                    size="small"
                    showInfo={false}
                  />
                  <span>
                    {t("deliveryProject.milestoneCount", {
                      count: linked.length,
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
            {t("deliveryProject.resourceCount", {
              count: activeResources.length,
            })}
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
            {inbox
              ? t("deliveryProject.pendingCount", { count: inbox.counts.total })
              : tp("inbox")}
          </p>
          {inbox && (
            <small>
              {tp("category.acceptance")} {inbox.counts.acceptance} ·{" "}
              {tp("category.blocked")} {inbox.counts.blocked}
            </small>
          )}
        </div>
        <Button size="small" onClick={() => onView("inbox")}>
          {tp("viewInbox")}
        </Button>
      </section>
    </div>
  );
}
