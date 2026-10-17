import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Skeleton, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { DeliveryRequirement } from "@/lib/delivery";
import {
  fetchRequirementHistory,
  fetchRequirementHistoryItem,
  requirementDefinitionChanges,
  useCollaborationRoute,
} from "@/lib/deliveryCollaboration";
import { ActivityFieldChanges } from "./DeliveryActivityFeed";
import { RequirementImpactFacts } from "./DeliveryRequirementChangeEditor";
import "./delivery-collaboration.css";

export function DeliveryRequirementHistory({
  projectId,
  sessionId,
  requirement,
  onNavigate,
}: {
  projectId: string;
  sessionId: string;
  requirement: DeliveryRequirement;
  onNavigate: (href: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const { route, change } = useCollaborationRoute(onNavigate);
  const cursor = route.scopeId === requirement.id ? route.historyCursor : "";
  const query = useQuery({
    queryKey: [
      "delivery-requirement-history",
      projectId,
      sessionId,
      requirement.id,
      cursor,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementHistory(projectId, requirement.id, cursor, signal),
    gcTime: 0,
    retry: false,
  });
  const exact = useQuery({
    queryKey: [
      "delivery-requirement-version",
      projectId,
      sessionId,
      requirement.id,
      route.versionId,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementHistoryItem(
        projectId,
        requirement.id,
        route.versionId,
        signal,
      ),
    enabled: Boolean(route.versionId),
    gcTime: 0,
    retry: false,
  });
  const data =
    query.data?.project_id === projectId &&
    query.data.requirement_id === requirement.id
      ? query.data
      : undefined;
  const selected =
    route.versionId &&
    exact.data?.project_id === projectId &&
    exact.data.requirement_id === requirement.id &&
    exact.data.item.id === route.versionId
      ? exact.data.item
      : undefined;
  const currentLinks =
    data?.current_basis === requirement.basis &&
    data.current_links?.requirement_basis === requirement.basis
      ? data.current_links
      : undefined;
  const definitionChanges = selected
    ? requirementDefinitionChanges(selected.definition, requirement)
    : {};
  return (
    <div className="delivery-collaboration-history">
      <div className="delivery-collaboration-toolbar">
        <h3>{tr("versionHistory")}</h3>
        <Button
          size="small"
          data-action="refresh-history"
          onClick={() => {
            void query.refetch();
            if (route.versionId) void exact.refetch();
          }}
        >
          {tr("refresh")}
        </Button>
      </div>
      <p className="delivery-collaboration-help">{tr("historyHint")}</p>
      {query.isPending && <Skeleton active paragraph={{ rows: 3 }} />}
      {query.isError && (
        <Alert
          type="error"
          title={tr("readFailed")}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              {tr("retry")}
            </Button>
          }
        />
      )}
      {data && (
        <>
          {data.earlier_history_unknown !== false && (
            <Alert type="info" title={tr("earlierUnknown")} />
          )}
          <div className="delivery-collaboration-version-list">
            {data.items.map((item) => (
              <Button
                key={item.id}
                data-action="open-version"
                aria-pressed={route.versionId === item.id}
                onClick={() =>
                  change({ versionId: item.id, scopeId: requirement.id })
                }
              >
                <span>
                  {tr("recordVersion")} {item.number}
                </span>
                {item.basis === data.current_basis && (
                  <Tag>{tr("current")}</Tag>
                )}
                <small>{new Date(item.at).toLocaleString(i18n.language)}</small>
              </Button>
            ))}
          </div>
          {!data.items.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={tr("noVersions")}
            />
          )}
          <div className="delivery-collaboration-toolbar">
            {cursor && (
              <Button
                size="small"
                onClick={() =>
                  change({ historyCursor: "", scopeId: requirement.id })
                }
              >
                {tr("firstPage")}
              </Button>
            )}
            {data.next_cursor && (
              <Button
                size="small"
                data-action="older-versions"
                onClick={() =>
                  change({
                    historyCursor: data.next_cursor || "",
                    scopeId: requirement.id,
                  })
                }
              >
                {tr("olderVersions")}
              </Button>
            )}
          </div>
        </>
      )}
      {route.versionId && (
        <>
          {exact.isPending && <Skeleton active paragraph={{ rows: 4 }} />}
          {!exact.isPending && (exact.isError || !selected) && (
            <Alert
              type="warning"
              title={tr("versionUnavailable")}
              action={
                <Button
                  data-action="retry-version"
                  onClick={() => void exact.refetch()}
                >
                  {tr("retry")}
                </Button>
              }
            />
          )}
          {selected && (
            <section
              className="delivery-collaboration-version"
              data-version-id={selected.id}
            >
              <div className="delivery-collaboration-toolbar">
                <h3>
                  {tr("recordVersion")} {selected.number}
                </h3>
                <Tag>{tr("readOnly")}</Tag>
                <Button size="small" onClick={() => change({ versionId: "" })}>
                  {tr("closeVersion")}
                </Button>
              </div>
              <p className="delivery-collaboration-help">
                {selected.actor.name || tr("unknownActor")} ·{" "}
                {new Date(selected.at).toLocaleString(i18n.language)} ·{" "}
                {tr(
                  selected.source === "sql_observed"
                    ? "observedSource"
                    : "commandSource",
                )}
              </p>
              {selected.flow_revision !== null && (
                <Tag>
                  {t("delivery.revision", { number: selected.flow_revision })}
                </Tag>
              )}
              <h4>{selected.definition.title}</h4>
              <p className="delivery-collaboration-content">
                {selected.definition.description || tr("none")}
              </p>
              <ol>
                {selected.definition.acceptance_criteria.map((value, index) => (
                  <li key={index}>{value}</li>
                ))}
              </ol>
              <code>{selected.id}</code>
              <h4>{tr("compareCurrent")}</h4>
              {Object.keys(definitionChanges).length ? (
                <ActivityFieldChanges
                  changes={Object.entries(definitionChanges).map(
                    ([field, after]) => ({
                      field,
                      before:
                        selected.definition[
                          field as keyof typeof selected.definition
                        ],
                      after,
                    }),
                  )}
                />
              ) : (
                <p>{tr("definitionSame")}</p>
              )}
            </section>
          )}
        </>
      )}
      <section className="delivery-collaboration-current-impact">
        <h3>{tr("currentImpact")}</h3>
        <p className="delivery-collaboration-help">{tr("currentImpactHint")}</p>
        {query.isPending && <Skeleton active paragraph={{ rows: 2 }} />}
        {!query.isPending && (query.isError || !currentLinks) && (
          <Alert
            type="info"
            title={tr("impactUnavailable")}
            action={
              <Button
                size="small"
                data-action="retry-impact"
                onClick={() => void query.refetch()}
              >
                {tr("retry")}
              </Button>
            }
          />
        )}
        {currentLinks && (
          <RequirementImpactFacts
            links={currentLinks}
            projectId={projectId}
            background={location.hash}
            onNavigate={onNavigate}
          />
        )}
      </section>
    </div>
  );
}
