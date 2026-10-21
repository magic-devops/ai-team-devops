import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Empty, Select, Skeleton, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { externalWorkOrderActionLabel, externalWorkOrderCopy } from "@/i18n/external-work-orders";
import {
  fetchDeliveryActivity,
  fetchDeliveryActivityItem,
  collaborationSourceHref,
  useCollaborationRoute,
  type ActivityTarget,
  type FieldChange,
} from "@/lib/deliveryCollaboration";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import "./delivery-collaboration.css";

type Props = {
  projectId: string;
  sessionId: string;
  onNavigate: (href: string) => void;
};
function CollaborationActivityAction({ action }: { action: string }) {
  const { t, i18n } = useTranslation();
  return (
    <strong>
      {externalWorkOrderActionLabel(i18n.language, action) || t(`deliveryCollaboration.actions.${action}`, {
        defaultValue: t(`delivery.actions.${action}`, {
          defaultValue: t(`deliveryProject.actions.${action}`, {
            defaultValue: action,
          }),
        }),
      })}
    </strong>
  );
}
export function ActivityFieldChanges({ changes }: { changes: FieldChange[] }) {
  const { t } = useTranslation();
  const value = (input: unknown) =>
    Array.isArray(input) ? (
      <ol>
        {input.map((item, i) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ol>
    ) : (
      <p>
        {typeof input === "string"
          ? input || "—"
          : (JSON.stringify(input) ?? "—")}
      </p>
    );
  return (
    <dl className="delivery-collaboration-diff">
      {changes.map((change) => (
        <div key={change.field}>
          <dt>
            {t(`deliveryCollaboration.fields.${change.field}`, {
              defaultValue: change.field,
            })}
          </dt>
          <dd>
            <section>
              <small>{t("deliveryCollaboration.before")}</small>
              {value(change.before)}
            </section>
            <section>
              <small>{t("deliveryCollaboration.after")}</small>
              {value(change.after)}
            </section>
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function ActivitySourceLinks({
  targets,
  projectId,
  background,
  onNavigate,
}: {
  targets: ActivityTarget[];
  projectId: string;
  background: string;
  onNavigate: Props["onNavigate"];
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  return (
    <ul className="delivery-collaboration-sources">
      {targets.map((target, i) => {
        const href = collaborationSourceHref(target, projectId, background, targets);
        return (
          <li key={`${target.kind}:${target.id || i}`}>
            <div>
              <small>{target.kind === "work_order" ? externalWorkOrderCopy(i18n.language).order : tr(`kinds.${target.kind}`)}</small>
              <span>{target.label || target.id || tr("restrictedSource")}</span>
              {target.id && <code>{target.id}</code>}
            </div>
            {href ? (
              <Button
                size="small"
                data-action="open-source"
                onClick={() => onNavigate(href)}
              >
                {tr("openSource")}
              </Button>
            ) : (
              <Tag>
                {tr(
                  target.reason === "target_restricted"
                    ? "restrictedSource"
                    : "missingSource",
                )}
              </Tag>
            )}
          </li>
        );
      })}
    </ul>
  );
}
export function DeliveryActivityFeed({
  projectId,
  sessionId,
  requirementId = "",
  onNavigate,
}: Props & { requirementId?: string }) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const { route, change } = useCollaborationRoute(onNavigate);
  const cursor = route.scopeId === requirementId ? route.cursor : "";
  const query = useQuery({
    queryKey: [
      "delivery-activity",
      projectId,
      sessionId,
      requirementId,
      route.action,
      cursor,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryActivity(projectId, {
        requirementId,
        action: route.action,
        cursor,
        signal,
      }),
    gcTime: 0,
    retry: false,
  });
  const candidate = query.data;
  const data =
    candidate?.project_id === projectId &&
    candidate.scope === (requirementId ? "requirement" : "project") &&
    candidate.scope_id === requirementId
      ? candidate
      : undefined;
  const eventNodes = useRef(new Map<string, HTMLButtonElement>());
  const previousEvent = useRef(route.eventId);
  useEffect(() => {
    const previous = previousEvent.current;
    previousEvent.current = route.eventId;
    if (previous && !route.eventId) {
      const frame = requestAnimationFrame(() =>
        eventNodes.current.get(previous)?.focus(),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [route.eventId]);
  const actions = [
    ...new Set(
      [
        route.action,
        ...(data?.items.map((item) => item.action) || []),
        "requirement.create",
        "requirement.update",
        "task.update",
        "tasks.plan",
        "stage.advance",
        "execution.review",
      ].filter(Boolean),
    ),
  ];
  return (
    <div className="delivery-collaboration-feed">
      <div className="delivery-collaboration-toolbar">
        <Select
          aria-label={tr("actionFilter")}
          value={route.action}
          onChange={(action) =>
            change({ action, cursor: "", scopeId: requirementId, eventId: "" })
          }
          options={[
            { value: "", label: tr("allActions") },
            ...actions.map((action) => ({
              value: action,
              label: externalWorkOrderActionLabel(i18n.language, action) || t(`deliveryCollaboration.actions.${action}`, {
                defaultValue: t(`delivery.actions.${action}`, {
                  defaultValue: t(`deliveryProject.actions.${action}`, {
                    defaultValue: action,
                  }),
                }),
              }),
            })),
          ]}
        />
        <Button
          size="small"
          data-action="refresh-activity"
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {tr("refresh")}
        </Button>
      </div>
      {query.isPending && <Skeleton active paragraph={{ rows: 3 }} />}
      {query.isError && (
        <Alert
          type="error"
          showIcon
          title={tr("readFailed")}
          action={
            <Button
              size="small"
              data-action="retry-activity"
              onClick={() => void query.refetch()}
            >
              {tr("retry")}
            </Button>
          }
        />
      )}
      {!query.isPending && !query.isError && !data && (
        <Alert type="warning" title={tr("scopeUnavailable")} />
      )}
      {data && (
        <>
          <small className="delivery-collaboration-help">
            {tr("activityHint")}
            {data.as_of &&
              ` · ${new Date(data.as_of).toLocaleString(i18n.language)}`}
          </small>
          {data.items.length ? (
            <ol className="delivery-collaboration-events">
              {data.items.map((item) => (
                <li key={item.id} data-event-id={item.id}>
                  <Button
                    ref={(node) => {
                      if (node)
                        eventNodes.current.set(
                          item.id,
                          node as HTMLButtonElement,
                        );
                      else eventNodes.current.delete(item.id);
                    }}
                    type="text"
                    data-action="open-event"
                    className="delivery-collaboration-event"
                    onClick={() =>
                      change({ eventId: item.id, scopeId: requirementId })
                    }
                  >
                    <div>
                      <CollaborationActivityAction action={item.action} />
                      <span>
                        {item.target?.label ||
                          item.target?.id ||
                          tr("recordedAction")}
                      </span>
                      {item.association === "unknown" && (
                        <Tag>{tr("unknownAssociation")}</Tag>
                      )}
                    </div>
                    <small>
                      {item.actor.name || tr("unknownActor")} ·{" "}
                      {new Date(item.at).toLocaleString(i18n.language)}
                    </small>
                  </Button>
                </li>
              ))}
            </ol>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={tr("noActivity")}
            />
          )}
          <div className="delivery-collaboration-toolbar">
            {cursor && (
              <Button
                size="small"
                data-action="first-activity"
                onClick={() =>
                  change({ cursor: "", scopeId: requirementId, eventId: "" })
                }
              >
                {tr("firstPage")}
              </Button>
            )}
            {data.next_cursor && (
              <Button
                size="small"
                data-action="older-activity"
                onClick={() =>
                  change({
                    cursor: data.next_cursor || "",
                    scopeId: requirementId,
                    eventId: "",
                  })
                }
              >
                {tr("olderActivity")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
export function DeliveryActivityDetail({
  projectId,
  sessionId,
  onNavigate,
}: Props) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const { route, change } = useCollaborationRoute(onNavigate);
  const identity = useDrawerIdentity(
    `${projectId}:${sessionId}`,
    route.eventId,
  );
  const query = useQuery({
    queryKey: [
      "delivery-activity-item",
      projectId,
      sessionId,
      identity.displayId,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryActivityItem(projectId, identity.displayId, signal),
    enabled: Boolean(identity.displayId),
    retry: false,
    gcTime: 0,
  });
  const data =
    query.data?.project_id === projectId &&
    query.data.item.id === identity.displayId
      ? query.data.item
      : undefined;
  return (
    <Drawer
      open={Boolean(route.eventId)}
      title={tr("eventDetail")}
      size="min(620px, 100vw)"
      className="delivery-inspector delivery-collaboration-detail"
      destroyOnHidden
      onClose={() => change({ eventId: "" })}
      afterOpenChange={identity.afterOpenChange}
    >
      {query.isPending && <Skeleton active paragraph={{ rows: 5 }} />}
      {!query.isPending && (query.isError || !data) && (
        <Alert
          type="warning"
          showIcon
          title={tr("eventUnavailable")}
          description={route.eventId}
          action={
            <Button
              data-action="retry-event"
              onClick={() => void query.refetch()}
            >
              {tr("retry")}
            </Button>
          }
        />
      )}
      {data && (
        <>
          <div className="delivery-collaboration-event-heading">
            <CollaborationActivityAction action={data.action} />
            <Tag>{tr("readOnly")}</Tag>
          </div>
          <p className="delivery-collaboration-help">
            {data.actor.name || tr("unknownActor")} ·{" "}
            {new Date(data.at).toLocaleString(i18n.language)}
          </p>
          <code>{data.id}</code>
          {data.association === "unknown" && (
            <Alert
              type="info"
              showIcon
              title={tr("unknownAssociation")}
              description={tr("unknownAssociationHint")}
            />
          )}
          <h3>{tr("sources")}</h3>
          {data.target || data.related_targets.length ? (
            <ActivitySourceLinks
              targets={[
                ...(data.target ? [data.target] : []),
                ...data.related_targets,
              ]}
              projectId={projectId}
              background={location.hash}
              onNavigate={onNavigate}
            />
          ) : (
            <Alert type="info" title={tr("missingSource")} />
          )}
          {data.changes.length > 0 && (
            <>
              <h3>{tr("definitionChanges")}</h3>
              <ActivityFieldChanges changes={data.changes} />
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
