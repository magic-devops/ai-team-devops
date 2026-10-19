import {
  requirementStatusLabel,
  requirementKindLabel,
  requirementStageLabel,
  requirementDecisionLabel,
  requirementReasonText,
} from "@/lib/deliveryRequirementPresentation";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Select, Skeleton, Tag } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchRequirementDefinition,
  fetchRequirementRecords,
  fetchRequirementRecord,
  fetchRequirementImpact,
  fetchRequirementImpactPage,
  fetchRequirementImpactItem,
  requirementReadMatches,
  validRequirementImpactTarget,
  type RequirementHeadResponse,
  type RequirementRecordCollection,
  type RequirementImpactKind,
} from "@/lib/deliveryRequirementReads";
import {
  collaborationSourceHref,
  useCollaborationRoute,
} from "@/lib/deliveryCollaboration";
import { beginProgressExactRead } from "@/lib/deliveryProgress";
import { safeEvidenceUrl } from "@/lib/delivery";
import { RequirementImpactFacts } from "./DeliveryRequirementChangeEditor";

export function RequirementRecordOriginal({
  collection,
  record,
  position,
}: {
  collection: RequirementRecordCollection;
  record: Record<string, unknown>;
  position: number;
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const text = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : "";
  const link = text(collection === "releases" ? "artifact_url" : "url");
  return (
    <article className="delivery-evidence" data-record-position={position}>
      <div className="delivery-collaboration-toolbar">
        <Tag>{tr("readOnly")}</Tag>
        {collection === "artifacts" && (
          <>
            <Tag>{requirementKindLabel(t, text("kind"))}</Tag>
            <Tag>{requirementStatusLabel(t, text("result"))}</Tag>
          </>
        )}
        {collection === "reviews" && (
          <>
            <Tag>{requirementStageLabel(t, text("stage"))}</Tag>
            <strong>{requirementDecisionLabel(t, text("decision"))}</strong>
          </>
        )}
        {record.stale === true && (
          <Tag color="warning">{t("delivery.staleEvidence")}</Tag>
        )}
      </div>
      {collection !== "reviews" && (
        <h3>
          {text(collection === "releases" ? "version" : "title") ||
            tr("recordType")}
        </h3>
      )}
      {collection === "artifacts" && (
        <p className="delivery-description">{text("content") || tr("none")}</p>
      )}
      {collection === "reviews" && (
        <p className="delivery-description">{text("comment") || tr("none")}</p>
      )}
      {collection === "releases" && (
        <>
          <Tag>{text("environment")}</Tag>
          <h4>{t("delivery.verification")}</h4>
          <p className="delivery-description">
            {text("verification") || tr("none")}
          </p>
          <h4>{t("delivery.rollback")}</h4>
          <p className="delivery-description">
            {text("rollback_plan") || tr("none")}
          </p>
        </>
      )}
      {text("notes") && <p className="delivery-description">{text("notes")}</p>}
      {safeEvidenceUrl(link) && (
        <a
          href={safeEvidenceUrl(link)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("delivery.url")} ↗
        </a>
      )}
      <small>
        {text("actor") || tr("unknownActor")} ·{" "}
        {text("at") ? new Date(text("at")).toLocaleString(i18n.language) : "—"}
        {typeof record.revision === "number"
          ? ` · ${t("delivery.revision", { number: record.revision })}`
          : ""}
        {collection === "artifacts"
          ? ` · ${t(text("source") === "execution-runtime" ? "delivery.runtimeEvidence" : text("source") === "manual" ? "delivery.manual" : "deliveryCollaboration.sourceUnknown")}`
          : ""}
      </small>
      <details>
        <summary>{tr("originalRecord")}</summary>
        <pre className="delivery-collaboration-original">
          {JSON.stringify(record, null, 2)}
        </pre>
      </details>
    </article>
  );
}
export function DeliveryRequirementDefinition({
  projectId,
  sessionId,
  head,
}: {
  projectId: string;
  sessionId: string;
  head: RequirementHeadResponse;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: [
      "delivery-requirement-definition",
      projectId,
      sessionId,
      head.requirement.id,
      head.query_generation,
      head.requirement.basis,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementDefinition(
        projectId,
        head.requirement.id,
        head.query_generation,
        signal,
      ),
    retry: false,
    gcTime: 0,
  });
  const data =
    !query.isError &&
    requirementReadMatches(
      query.data,
      projectId,
      head.requirement.id,
      head.query_generation,
      head.requirement.basis,
    ) &&
    query.data?.definition.id === head.requirement.id &&
    query.data.version === head.version
      ? query.data
      : undefined;
  return (
    <section data-requirement-definition={head.requirement.id}>
      {query.isPending && <Skeleton active />}
      {!query.isPending && !data && (
        <Alert
          type="info"
          title={t("deliveryCollaboration.definitionUnavailable")}
          action={
            <Button onClick={() => void query.refetch()}>
              {t("deliveryCollaboration.retry")}
            </Button>
          }
        />
      )}
      {data && (
        <>
          <p className="delivery-description">
            {data.definition.description || t("delivery.none")}
          </p>
          <h3>{t("delivery.criteria")}</h3>
          <ol className="delivery-criteria">
            {data.definition.acceptance_criteria.map((value, index) => (
              <li key={index}>{value}</li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
export function DeliveryRequirementRecords({
  projectId,
  sessionId,
  head,
  collection,
  onNavigate,
}: {
  projectId: string;
  sessionId: string;
  head: RequirementHeadResponse;
  collection: RequirementRecordCollection;
  onNavigate: (href: string) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const { route, change } = useCollaborationRoute(onNavigate);
  const same =
    route.recordCollection === collection &&
    route.scopeId === head.requirement.id;
  const stale =
    same &&
    !!route.recordGeneration &&
    route.recordGeneration !== String(head.query_generation);
  const cursor = same ? route.recordCursor : "",
    position = same ? route.recordPosition : "";
  const query = useQuery({
    queryKey: [
      "delivery-requirement-records",
      projectId,
      sessionId,
      head.requirement.id,
      head.query_generation,
      head.requirement.basis,
      collection,
      cursor,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementRecords(
        projectId,
        head.requirement.id,
        collection,
        head.query_generation,
        cursor,
        signal,
      ),
    enabled: !stale,
    retry: false,
    gcTime: 0,
  });
  const exact = useQuery({
    queryKey: [
      "delivery-requirement-record",
      projectId,
      sessionId,
      head.requirement.id,
      head.query_generation,
      head.requirement.basis,
      collection,
      position,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementRecord(
        projectId,
        head.requirement.id,
        collection,
        Number(position),
        head.query_generation,
        signal,
      ),
    enabled: !stale && /^\d+$/.test(position),
    retry: false,
    gcTime: 0,
  });
  const data =
    !stale &&
    !query.isError &&
    requirementReadMatches(
      query.data,
      projectId,
      head.requirement.id,
      head.query_generation,
      head.requirement.basis,
    ) &&
    query.data?.collection === collection
      ? query.data
      : undefined;
  const selected =
    !stale &&
    !query.isError &&
    !exact.isError &&
    requirementReadMatches(
      exact.data,
      projectId,
      head.requirement.id,
      head.query_generation,
      head.requirement.basis,
    ) &&
    exact.data?.collection === collection &&
    String(exact.data.position) === position
      ? exact.data
      : undefined;
  const patch = (input: Partial<typeof route>) =>
    change({
      scopeId: head.requirement.id,
      recordCollection: collection,
      recordGeneration: String(head.query_generation),
      ...input,
    });
  return (
    <section className="delivery-requirement-records">
      <div className="delivery-collaboration-toolbar">
        <Tag>
          {tr("recordCount")} {head.requirement.flow.record_counts[collection]}
        </Tag>
        <Button
          data-action="refresh-records"
          onClick={() => {
            void query.refetch();
            if (position) void exact.refetch();
          }}
        >
          {tr("refresh")}
        </Button>
      </div>
      <p className="delivery-collaboration-help">{tr("recordsHint")}</p>
      {query.isPending && !stale && <Skeleton active />}
      {(stale || query.isError) && (
        <Alert
          type="warning"
          title={tr(stale ? "generationChanged" : "readFailed")}
        />
      )}
      {data && (
        <>
          <div className="delivery-collaboration-version-list">
            {data.items.map((item) => (
              <Button
                key={item.position}
                data-action="open-record"
                aria-pressed={position === String(item.position)}
                onClick={() => patch({ recordPosition: String(item.position) })}
              >
                <span>
                  {item.title ||
                    (collection === "reviews"
                      ? requirementDecisionLabel(t, item.decision)
                      : requirementKindLabel(t, item.kind))}
                </span>
                <small>
                  {item.at} ·{" "}
                  {item.stage ? requirementStageLabel(t, item.stage) : ""} ·{" "}
                  {item.result ? requirementStatusLabel(t, item.result) : ""} ·{" "}
                  {item.revision === null
                    ? "—"
                    : t("delivery.revision", { number: item.revision })}
                </small>
                {item.stale && (
                  <Tag color="warning">{t("delivery.staleEvidence")}</Tag>
                )}
              </Button>
            ))}
          </div>
          {!data.items.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={tr("none")}
            />
          )}
        </>
      )}
      <div className="delivery-collaboration-toolbar">
        {(cursor || stale) && (
          <Button
            data-action="first-records"
            onClick={() => patch({ recordCursor: "", recordPosition: "" })}
          >
            {tr("firstPage")}
          </Button>
        )}
        {data?.next_cursor && (
          <Button
            data-action="next-records"
            onClick={() => patch({ recordCursor: data.next_cursor || "" })}
          >
            {tr("nextPage")}
          </Button>
        )}
      </div>
      {position !== "" && (
        <>
          {exact.isPending && !stale && <Skeleton active />}
          {!selected && !exact.isPending && (
            <Alert
              type="info"
              title={tr("recordUnavailable")}
              action={
                <Button onClick={() => void exact.refetch()}>
                  {tr("retry")}
                </Button>
              }
            />
          )}
          {selected && (
            <>
              <div className="delivery-collaboration-toolbar">
                <Button onClick={() => patch({ recordPosition: "" })}>
                  {tr("closeVersion")}
                </Button>
              </div>
              <RequirementRecordOriginal
                collection={collection}
                record={selected.record}
                position={selected.position}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
const kinds: RequirementImpactKind[] = [
  "direct_task",
  "dependent_task",
  "execution",
  "release_candidate",
  "deployment",
];
export function DeliveryRequirementImpact({
  projectId,
  sessionId,
  requirementId,
  onNavigate,
  unavailable = false,
}: {
  projectId: string;
  sessionId: string;
  requirementId: string;
  onNavigate: (href: string) => void;
  unavailable?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const { route, change } = useCollaborationRoute(onNavigate);
  const [problem, setProblem] = useState("");
  const kind = kinds.includes(route.impactKind as RequirementImpactKind)
    ? (route.impactKind as RequirementImpactKind)
    : "direct_task";
  const summary = useQuery({
    queryKey: [
      "delivery-requirement-impact",
      projectId,
      sessionId,
      requirementId,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementImpact(projectId, requirementId, undefined, signal),
    enabled: !unavailable,
    retry: false,
    gcTime: 0,
  });
  const head =
    !unavailable &&
    !summary.isError &&
    summary.data?.project_id === projectId &&
    summary.data.requirement_id === requirementId
      ? summary.data
      : undefined;
  const stale =
    !!route.impactGeneration &&
    route.impactGeneration !== String(head?.query_generation);
  const usable = !!head?.available && head.complete && !stale;
  const cursor = route.impactCursor;
  const page = useQuery({
    queryKey: [
      "delivery-requirement-impact-page",
      projectId,
      sessionId,
      requirementId,
      head?.query_generation,
      head?.requirement_basis,
      kind,
      cursor,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementImpactPage(
        projectId,
        requirementId,
        kind,
        head!.query_generation,
        cursor,
        signal,
      ),
    enabled: usable,
    retry: false,
    gcTime: 0,
  });
  const exact = useQuery({
    queryKey: [
      "delivery-requirement-impact-item",
      projectId,
      sessionId,
      requirementId,
      head?.query_generation,
      head?.requirement_basis,
      kind,
      route.impactItem,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementImpactItem(
        projectId,
        requirementId,
        kind,
        route.impactItem,
        head!.query_generation,
        signal,
      ),
    enabled: usable && !!route.impactItem,
    retry: false,
    gcTime: 0,
  });
  const denied =
    (page.isError && /^HTTP (403|404)\b/.test(page.error.message)) ||
    (exact.isError && /^HTTP (403|404)\b/.test(exact.error.message));
  const data =
    usable &&
    !denied &&
    !page.isError &&
    requirementReadMatches(
      page.data,
      projectId,
      requirementId,
      head!.query_generation,
      head!.requirement_basis,
    ) &&
    page.data?.kind === kind
      ? page.data
      : undefined;
  const selected =
    usable &&
    !denied &&
    !page.isError &&
    !exact.isError &&
    requirementReadMatches(
      exact.data,
      projectId,
      requirementId,
      head!.query_generation,
      head!.requirement_basis,
    ) &&
    exact.data?.kind === kind &&
    exact.data.item.id === route.impactItem
      ? exact.data.item
      : undefined;
  const patch = (input: Partial<typeof route>) =>
    change({
      impactGeneration: String(head?.query_generation || ""),
      ...input,
    });
  return (
    <section className="delivery-collaboration-current-impact">
      <h3>{tr("currentImpact")}</h3>
      <p className="delivery-collaboration-help">{tr("currentImpactHint")}</p>
      <Button
        data-action="refresh-impact"
        onClick={() => {
          void summary.refetch();
          if (head) {
            void page.refetch();
            if (route.impactItem) void exact.refetch();
          }
        }}
      >
        {tr("refresh")}
      </Button>
      {summary.isPending && <Skeleton active />}
      {(!head || !head.available || !head.complete) && !summary.isPending && (
        <Alert
          type="info"
          title={tr("impactUnavailable")}
          description={head?.reasons
            .map((reason) => requirementReasonText(t, reason.code))
            .join(" · ")}
        />
      )}{" "}
      {denied && <Alert type="warning" title={tr("impactUnavailable")} />}
      {head?.available && head.complete && !denied && (
        <>
          <small>{head.as_of}</small>
          <RequirementImpactFacts counts={head.counts} />
          <Select
            aria-label={tr("impactKind")}
            value={kind}
            options={kinds.map((value) => ({
              value,
              label: t(`deliveryCollaboration.impactKinds.${value}`),
            }))}
            onChange={(value) =>
              patch({ impactKind: value, impactCursor: "", impactItem: "" })
            }
          />
          {stale && <Alert type="warning" title={tr("generationChanged")} />}
          {(page.isError || exact.isError || problem) && (
            <Alert type="error" title={problem || tr("readFailed")} />
          )}
          {usable && page.isPending && <Skeleton active />}
          {usable && route.impactItem && exact.isPending && <Skeleton active />}
          <div className="delivery-collaboration-version-list">
            {data?.items.map((item) => (
              <Button
                key={item.id}
                data-action="select-impact"
                onClick={() => patch({ impactItem: item.id })}
              >
                {item.title || item.id}
                <Tag>{requirementStatusLabel(t, item.status)}</Tag>
              </Button>
            ))}
          </div>
          {data && !data.items.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={tr("none")}
            />
          )}
          <div className="delivery-collaboration-toolbar">
            {(cursor || stale) && (
              <Button
                data-action="first-impact"
                onClick={() => patch({ impactCursor: "", impactItem: "" })}
              >
                {tr("firstPage")}
              </Button>
            )}
            {data?.next_cursor && (
              <Button
                data-action="next-impact"
                onClick={() => patch({ impactCursor: data.next_cursor || "" })}
              >
                {tr("nextPage")}
              </Button>
            )}
          </div>
          {selected && (
            <article className="delivery-evidence" data-impact-id={selected.id}>
              <h4>{selected.title || selected.id}</h4>
              <p>{requirementStatusLabel(t, selected.status)}</p>
              {validRequirementImpactTarget(selected) ? (
                <Button
                  data-action="open-impact"
                  onClick={async () => {
                    const ticket = beginProgressExactRead();
                    setProblem("");
                    try {
                      const result = await fetchRequirementImpactItem(
                        projectId,
                        requirementId,
                        kind,
                        selected.id,
                        head.query_generation,
                      );
                      if (
                        !ticket.current() ||
                        !requirementReadMatches(
                          result,
                          projectId,
                          requirementId,
                          head.query_generation,
                          head.requirement_basis,
                        ) ||
                        result.kind !== kind ||
                        result.item.id !== selected.id ||
                        !validRequirementImpactTarget(result.item)
                      )
                        throw new Error(tr("generationChanged"));
                      const href = collaborationSourceHref(
                        result.item.target,
                        projectId,
                        location.hash,
                      );
                      if (!href) throw new Error(tr("impactUnavailable"));
                      onNavigate(href);
                    } catch (error) {
                      if (ticket.current()) setProblem(tr("readFailed"));
                    } finally {
                      ticket.finish();
                    }
                  }}
                >
                  {tr("openCurrentTarget")}
                </Button>
              ) : (
                <Alert type="info" title={tr("impactUnavailable")} />
              )}
            </article>
          )}
        </>
      )}
    </section>
  );
}
