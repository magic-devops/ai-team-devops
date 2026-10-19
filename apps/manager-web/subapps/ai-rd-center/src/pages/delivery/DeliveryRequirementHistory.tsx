import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Skeleton, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { fetchRequirementDetail } from "@/lib/deliveryQuery";
import {
  fetchRequirementDefinition,
  requirementReadMatches,
} from "@/lib/deliveryRequirementReads";
import { DeliveryRequirementImpact } from "./DeliveryRequirementReads";
import {
  fetchRequirementHistory,
  fetchRequirementHistoryItem,
  requirementDefinitionChanges,
  useCollaborationRoute,
} from "@/lib/deliveryCollaboration";
import { ActivityFieldChanges } from "./DeliveryActivityFeed";

import "./delivery-collaboration.css";

export function DeliveryRequirementHistory({
  projectId,
  sessionId,
  requirementId,
  onNavigate,
}: {
  projectId: string;
  sessionId: string;
  requirementId: string;
  onNavigate: (href: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const { route, change } = useCollaborationRoute(onNavigate);
  const cursor = route.scopeId === requirementId ? route.historyCursor : "";
  const query = useQuery({
    queryKey: [
      "delivery-requirement-history",
      projectId,
      sessionId,
      requirementId,
      cursor,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementHistory(projectId, requirementId, cursor, signal),
    gcTime: 0,
    retry: false,
  });
  const exact = useQuery({
    queryKey: [
      "delivery-requirement-version",
      projectId,
      sessionId,
      requirementId,
      route.versionId,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementHistoryItem(
        projectId,
        requirementId,
        route.versionId,
        signal,
      ),
    enabled: Boolean(route.versionId),
    gcTime: 0,
    retry: false,
  });
  const data =
    !(query.isError && /^HTTP (403|404):/.test(query.error?.message || "")) &&
    query.data?.project_id === projectId &&
    query.data.requirement_id === requirementId
      ? query.data
      : undefined;
  const selected =
    route.versionId &&
    !(query.isError && /^HTTP 403:/.test(query.error?.message || "")) &&
    !(exact.isError && /^HTTP (403|404):/.test(exact.error?.message || "")) &&
    exact.data?.project_id === projectId &&
    exact.data.requirement_id === requirementId &&
    exact.data.item.id === route.versionId
      ? exact.data.item
      : undefined;
  const [compare, setCompare] = useState(false);
  const currentHead = useQuery({
    queryKey: [
      "delivery-requirement-history-current-head",
      projectId,
      sessionId,
      requirementId,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementDetail(projectId, requirementId, signal),
    enabled: compare,
    retry: false,
    gcTime: 0,
  });
  const currentDefinition = useQuery({
    queryKey: [
      "delivery-requirement-history-current-definition",
      projectId,
      sessionId,
      requirementId,
      currentHead.data?.query_generation,
      currentHead.data?.requirement.basis,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementDefinition(
        projectId,
        requirementId,
        currentHead.data!.query_generation,
        signal,
      ),
    enabled: compare && !!currentHead.data && !currentHead.isError,
    retry: false,
    gcTime: 0,
  });
  const current =
    compare &&
    !currentHead.isError &&
    !currentDefinition.isError &&
    currentHead.data?.requirement.id === requirementId &&
    requirementReadMatches(
      currentDefinition.data,
      projectId,
      requirementId,
      currentHead.data.query_generation,
      currentHead.data.requirement.basis,
    ) &&
    currentDefinition.data?.definition.id === requirementId &&
    currentDefinition.data.version === currentHead.data.version
      ? currentDefinition.data.definition
      : undefined;
  const definitionChanges =
    selected && current
      ? requirementDefinitionChanges(selected.definition, current)
      : undefined;
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
                  change({ versionId: item.id, scopeId: requirementId })
                }
              >
                <span>
                  {tr("recordVersion")} {item.number}
                </span>

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
                  change({ historyCursor: "", scopeId: requirementId })
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
                    scopeId: requirementId,
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
              <Button
                data-action="compare-current"
                onClick={() => {
                  if (compare) {
                    void currentHead.refetch();
                    if (currentHead.data) void currentDefinition.refetch();
                  } else setCompare(true);
                }}
              >
                {tr("readCurrentDefinition")}
              </Button>
              {!current && (
                <Alert type="info" title={tr("definitionUnavailable")} />
              )}
              {definitionChanges &&
                (Object.keys(definitionChanges).length ? (
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
                ))}
            </section>
          )}
        </>
      )}
      <DeliveryRequirementImpact
        projectId={projectId}
        sessionId={sessionId}
        requirementId={requirementId}
        onNavigate={onNavigate}
        unavailable={
          (query.isError && /^HTTP (403|404)\b/.test(query.error.message)) ||
          (currentHead.isError &&
            /^HTTP (403|404)\b/.test(currentHead.error.message))
        }
      />
    </div>
  );
}
