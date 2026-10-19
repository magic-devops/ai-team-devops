import { Alert, Button, Empty, Skeleton, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { useDeliveryMemberReferences } from "@/lib/deliveryQueryHooks";
import { allocationSummary } from "@/lib/deliveryScheduling";
import { fetchRequirementDetail } from "@/lib/deliveryQuery";
import {
  fetchProgressBaselines,
  fetchProgressBaseline,
  fetchProgressObservation,
  fetchProgressSnapshotPage,
  fetchProgressSnapshotItem,
  fetchProgressComparison,
  fetchProgressComparisonPage,
  fetchProgressComparisonItem,
  progressReadDenied,
  beginProgressExactRead,
  type ProgressRoute,
  type ProgressSourceKind,
  type ProgressCollection,
  type ProgressTask,
  type ProgressRequirement,
  type ProgressComparisonKind,
  type ProgressComparisonDetail,
  type ProgressObservationRead,
  type ProgressBaselineRead,
  type ProgressSnapshotEnvelope,
} from "@/lib/deliveryProgress";
import type { DeliveryInboxTarget } from "@/lib/delivery";
import {
  CurrentTaskButton,
  progressDateTime,
  DeliveryProgressComparison,
} from "./DeliveryProgressDetails";

const ownRouteKeys = [
  "progress_collection",
  "progress_cursor",
  "progress_page",
  "progress_item",
  "progress_diff_kind",
  "progress_diff_cursor",
  "progress_diff_page",
  "progress_diff_item",
  "progress_baseline_cursor",
  "progress_baseline_page",
];
export function progressBrowserHash(
  patch: Record<string, string | number | null>,
  source = location.hash,
) {
  const params = new URLSearchParams(source.split("?")[1]);
  for (const [key, value] of Object.entries(patch)) {
    if (!ownRouteKeys.includes(key)) continue;
    if (value) params.set(key, String(value));
    else params.delete(key);
  }
  return `#/dev-flow?${params}`;
}
function useBrowserRoute(disabled: boolean) {
  const owner = useRef(projectSessionKey()),
    live = useRef(true),
    blocked = useRef(disabled);
  blocked.current = disabled;
  useEffect(() => {
    live.current = true;
    const invalidate = () => {
      live.current = false;
    };
    for (const event of ["sop-session", "storage"])
      window.addEventListener(event, invalidate);
    return () => {
      live.current = false;
      for (const event of ["sop-session", "storage"])
        window.removeEventListener(event, invalidate);
    };
  }, []);
  const [hash, setHash] = useState(() =>
    typeof location === "undefined" ? "" : location.hash,
  );
  useEffect(() => {
    const sync = () => setHash(location.hash);
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const change = (patch: Record<string, string | number | null>) => {
    if (
      !live.current ||
      blocked.current ||
      owner.current !== projectSessionKey()
    )
      return;
    const next = progressBrowserHash(patch);
    history.replaceState(null, "", next);
    setHash(next);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  return { params: new URLSearchParams(hash.split("?")[1]), change };
}
function ReadProblem({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert
      type="warning"
      title={t("deliveryProgress.bounded.readFailed")}
      description={(error as Error)?.message || ""}
      action={
        <Button size="small" onClick={retry}>
          {t("deliveryProgress.refresh")}
        </Button>
      }
    />
  );
}
export function ProgressPager({
  total,
  count,
  cursor,
  next,
  page,
  busy,
  onPage,
}: {
  total: number;
  count: number;
  cursor: string;
  next: string | null;
  page: number;
  busy?: boolean;
  onPage: (cursor: string, page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      className="delivery-actions delivery-progress-pager"
      aria-label={t("deliveryProgress.bounded.pagination")}
    >
      <span role="status">
        {t("deliveryProgress.bounded.pageCount", { page, count, total })}
      </span>
      <Button
        size="small"
        disabled={busy || !cursor}
        onClick={() => onPage("", 1)}
      >
        {t("deliveryProgress.bounded.first")}
      </Button>
      <Button
        size="small"
        disabled={busy || !next || next === cursor}
        onClick={() => next && onPage(next, page + 1)}
      >
        {t("deliveryProgress.bounded.next")}
      </Button>
    </nav>
  );
}
export function DeliveryProgressBaselineCatalogue({
  projectId,
  sessionId,
  route,
  disabled,
  onSelect,
}: {
  projectId: string;
  sessionId: string;
  route: ProgressRoute;
  disabled: boolean;
  onSelect: (id: string, view: boolean) => void;
}) {
  const { t, i18n } = useTranslation(),
    { params, change } = useBrowserRoute(disabled),
    owner = useRef(projectSessionKey());
  const cursor = params.get("progress_baseline_cursor") || "",
    page = Math.max(1, Number(params.get("progress_baseline_page")) || 1);
  const query = useQuery({
    queryKey: [
      "delivery-progress-baselines",
      projectId,
      sessionId,
      route.scope,
      route.scopeId,
      cursor,
    ],
    queryFn: ({ signal }) =>
      fetchProgressBaselines(projectId, route, { cursor }, signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const data =
    !query.isError && owner.current === projectSessionKey()
      ? query.data
      : undefined;
  return (
    <section className="delivery-progress-catalogue">
      <p className="delivery-hint">
        {t("deliveryProgress.bounded.catalogueHint")}
      </p>
      {query.isPending && <Skeleton active />}
      {query.error && (
        <ReadProblem error={query.error} retry={() => void query.refetch()} />
      )}
      {data && (
        <>
          <div className="delivery-progress-task-list">
            {data.items.map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.scope.label} · {item.task_count ?? "—"} /{" "}
                    {item.requirement_count ?? "—"} ·{" "}
                    {progressDateTime(item.created_at, i18n.language)} UTC
                  </small>
                  <small>
                    {item.starts_on || "—"} → {item.ends_on || "—"}
                  </small>
                  <small>
                    {t("deliveryProgress.createdBy")}: {item.created_by || "—"}
                  </small>
                  {!item.available &&
                    item.reasons.map((reason) => (
                      <p key={reason.code}>{reason.message}</p>
                    ))}
                </div>
                <div className="delivery-actions">
                  <Button
                    size="small"
                    disabled={disabled || !item.available}
                    onClick={() => {
                      if (!disabled && owner.current === projectSessionKey())
                        onSelect(item.id, false);
                    }}
                  >
                    {t("deliveryProgress.bounded.useBaseline")}
                  </Button>
                  <Button
                    size="small"
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled && owner.current === projectSessionKey())
                        onSelect(item.id, true);
                    }}
                  >
                    {t("deliveryProgress.bounded.viewBaseline")}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {!data.items.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("deliveryProgress.bounded.noBaselines")}
            />
          )}
          <ProgressPager
            total={data.total}
            count={data.items.length}
            cursor={cursor}
            next={data.next_cursor}
            page={page}
            busy={query.isFetching || disabled}
            onPage={(value, number) =>
              change({
                progress_baseline_cursor: value,
                progress_baseline_page: number,
              })
            }
          />
        </>
      )}
    </section>
  );
}
function ExactTaskFacts({ task }: { task: ProgressTask }) {
  const { t } = useTranslation();
  const criteria = task.acceptance?.criteria || task.acceptance_criteria;
  return (
    <section className="delivery-progress-exact">
      <h4>{task.title}</h4>
      <dl className="delivery-facts">
        {[
          ["bounded.taskId", task.id],
          ["changeFields.owner_id", task.assigned_to || task.owner_id],
          [
            "changeFields.estimate",
            task.estimate === null
              ? t("deliveryProgress.bounded.notCaptured")
              : task.estimate,
          ],
          ["startsOn", task.starts_on],
          ["endsOn", task.ends_on],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{t(`deliveryProgress.${label}`)}</dt>
            <dd>{value || "—"}</dd>
          </div>
        ))}
      </dl>
      {criteria ? (
        <ol>
          {criteria.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ol>
      ) : (
        <p>{t("deliveryProgress.acceptanceNotCaptured")}</p>
      )}
      <p className="delivery-description">
        {allocationSummary(task.allocations, [], t)}
      </p>
    </section>
  );
}
function CurrentRequirementButton({
  projectId,
  id,
  onOpen,
}: {
  projectId: string;
  id: string;
  onOpen: (target: DeliveryInboxTarget) => void;
}) {
  const { t } = useTranslation(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const owner = projectSessionKey();
  return (
    <>
      <Button
        size="small"
        loading={busy}
        onClick={async () => {
          if (owner !== projectSessionKey()) return;
          const read = beginProgressExactRead();
          setBusy(true);
          setError("");
          try {
            const value = await fetchRequirementDetail(projectId, id);
            if (
              read.current() &&
              owner === projectSessionKey() &&
              value.project_id === projectId &&
              value.requirement.id === id
            )
              onOpen({
                view: "progress",
                requirement_id: id,
                detail: "details",
                task_id: "",
              });
          } catch (cause) {
            if (owner === projectSessionKey())
              setError((cause as Error).message);
          } finally {
            if (read.current()) setBusy(false);
            read.finish();
          }
        }}
      >
        {t("deliveryProgress.bounded.openCurrentRequirement")}
      </Button>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
export function DeliveryProgressSnapshotBrowser({
  projectId,
  sessionId,
  sourceKind,
  sourceId,
  route,
  disabled,
  generation,
  onOpenTask,
}: {
  projectId: string;
  sessionId: string;
  sourceKind: ProgressSourceKind;
  sourceId: string;
  route: ProgressRoute;
  disabled: boolean;
  generation: number | null;
  onOpenTask: (target: DeliveryInboxTarget) => void;
}) {
  const { t, i18n } = useTranslation(),
    { params, change } = useBrowserRoute(disabled),
    owner = useRef(projectSessionKey());
  const collection: ProgressCollection =
      params.get("progress_collection") === "requirements"
        ? "requirements"
        : "tasks",
    cursor = params.get("progress_cursor") || "",
    page = Math.max(1, Number(params.get("progress_page")) || 1),
    itemId = params.get("progress_item") || "";
  const metadata = useQuery<ProgressObservationRead | ProgressBaselineRead>({
    queryKey: [
      "delivery-progress-source",
      projectId,
      sessionId,
      sourceKind,
      sourceId,
      route.scope,
      route.scopeId,
    ],
    queryFn: async ({ signal }) =>
      sourceKind === "observation"
        ? await fetchProgressObservation(projectId, sourceId, route, signal)
        : await fetchProgressBaseline(projectId, sourceId, signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const candidate =
    metadata.data &&
    (sourceKind === "observation"
      ? "observation" in metadata.data
        ? metadata.data.observation
        : undefined
      : "baseline" in metadata.data
        ? metadata.data.baseline
        : undefined);
  const header =
    !metadata.isError &&
    owner.current === projectSessionKey() &&
    metadata.data?.project_id === projectId &&
    candidate?.id === sourceId &&
    (sourceKind === "baseline" ||
      (candidate.scope.kind === route.scope &&
        candidate.scope.id === route.scopeId))
      ? candidate
      : undefined;
  const basis =
      header &&
      ("snapshot_basis" in header ? header.snapshot_basis : header.basis),
    scope = header
      ? { scope: header.scope.kind, scopeId: header.scope.id }
      : route;
  const matchesSnapshot = (value: ProgressSnapshotEnvelope | undefined) =>
    Boolean(
      value &&
      value.project_id === projectId &&
      value.source_kind === sourceKind &&
      value.source_id === sourceId &&
      value.snapshot_basis === basis &&
      value.collection === collection &&
      value.scope.kind === scope.scope &&
      value.scope.id === scope.scopeId,
    );
  const items = useQuery({
    queryKey: [
      "delivery-progress-snapshot-page",
      projectId,
      sessionId,
      sourceKind,
      sourceId,
      basis,
      scope.scope,
      scope.scopeId,
      collection,
      cursor,
    ],
    queryFn: ({ signal }) =>
      fetchProgressSnapshotPage(
        projectId,
        sourceKind,
        sourceId,
        collection,
        scope,
        { cursor },
        signal,
      ),
    enabled: Boolean(header?.available),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const data =
    header?.available && !items.isError && matchesSnapshot(items.data)
      ? items.data
      : undefined;
  const exact = useQuery({
    queryKey: [
      "delivery-progress-snapshot-item",
      projectId,
      sessionId,
      sourceKind,
      sourceId,
      basis,
      scope.scope,
      scope.scopeId,
      collection,
      itemId,
    ],
    queryFn: ({ signal }) =>
      fetchProgressSnapshotItem(
        projectId,
        sourceKind,
        sourceId,
        collection,
        itemId,
        scope,
        signal,
      ),
    enabled: Boolean(header?.available && itemId),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const denied =
    progressReadDenied(items.error) || progressReadDenied(exact.error);
  const item =
    !denied &&
    !exact.isError &&
    header?.available &&
    exact.data &&
    matchesSnapshot(exact.data) &&
    exact.data.item.id === itemId
      ? exact.data.item
      : undefined;
  const memberRefs = useDeliveryMemberReferences(
    projectId,
    sessionId,
    collection === "tasks"
      ? (data?.items || []).map((row) => (row as ProgressTask).owner_id)
      : [],
    generation,
  );
  return (
    <section className="delivery-progress-snapshot">
      <Tag>{t("deliveryProgress.historical")}</Tag>
      {metadata.isPending && <Skeleton active />}
      {metadata.error && (
        <ReadProblem
          error={metadata.error}
          retry={() => void metadata.refetch()}
        />
      )}
      {denied && (
        <ReadProblem
          error={items.error || exact.error}
          retry={() => {
            void metadata.refetch();
            void items.refetch();
            if (itemId) void exact.refetch();
          }}
        />
      )}
      {header && !denied && (
        <>
          <h2>
            {"title" in header
              ? header.title
              : progressDateTime(header.observed_at, i18n.language) + " UTC"}
          </h2>
          <p className="delivery-hint">
            {header.scope.label} · {header.task_count ?? "—"}{" "}
            {t("deliveryProgress.tasks")} · {header.requirement_count ?? "—"}{" "}
            {t("deliveryProgress.bounded.requirements")}
          </p>
          {header.reasons.map((reason) => (
            <Alert type="warning" key={reason.code} title={reason.message} />
          ))}
          <dl className="delivery-facts">
            <div>
              <dt>{t("deliveryProgress.createdBy")}</dt>
              <dd>
                {"actor" in header ? header.actor : header.created_by || "—"}
              </dd>
            </div>
            <div>
              <dt>{t("deliveryProgress.sourceVersion")}</dt>
              <dd>{header.source_version ?? "—"}</dd>
            </div>
            {"source" in header && (
              <div>
                <dt>{t("deliveryProgress.source")}</dt>
                <dd>
                  {t(`deliveryProgress.sources.${header.source}`, {
                    defaultValue: header.source,
                  })}
                </dd>
              </div>
            )}
            {"starts_on" in header && (
              <div>
                <dt>
                  {t("deliveryProgress.startsOn")} →{" "}
                  {t("deliveryProgress.endsOn")}
                </dt>
                <dd>
                  {header.starts_on || "—"} → {header.ends_on || "—"}
                </dd>
              </div>
            )}
          </dl>
          {"note" in header && header.note && (
            <p className="delivery-description">{header.note}</p>
          )}
          {header.metrics && (
            <p className="delivery-hint">
              {t("deliveryProgress.verified")}{" "}
              {header.metrics.verified_completed} ·{" "}
              {t("deliveryProgress.recorded")}{" "}
              {header.metrics.recorded_completed} ·{" "}
              {t("deliveryProgress.remaining")} {header.metrics.remaining} ·{" "}
              {t("deliveryProgress.acceptedRequirements")}{" "}
              {header.metrics.requirements_accepted}/
              {header.metrics.requirements_total}
            </p>
          )}
          <p className="delivery-hint">{t("deliveryProgress.scopeReadOnly")}</p>
          <nav className="delivery-actions">
            {(["tasks", "requirements"] as const).map((value) => (
              <Button
                key={value}
                aria-pressed={collection === value}
                disabled={disabled || !header.available}
                onClick={() => {
                  if (!disabled && owner.current === projectSessionKey())
                    change({
                      progress_collection: value,
                      progress_cursor: null,
                      progress_page: null,
                      progress_item: null,
                    });
                }}
              >
                {t(
                  value === "tasks"
                    ? "deliveryProgress.tasks"
                    : "deliveryProgress.bounded.requirements",
                )}
              </Button>
            ))}
          </nav>
          {items.isPending && header.available && <Skeleton active />}
          {items.error && (
            <ReadProblem
              error={items.error}
              retry={() =>
                cursor
                  ? change({
                      progress_cursor: null,
                      progress_page: null,
                      progress_item: null,
                    })
                  : void items.refetch()
              }
            />
          )}
          {data && (
            <>
              <div className="delivery-progress-task-list">
                {data.items.map((row) => (
                  <article key={row.id}>
                    <div>
                      <strong>{row.title}</strong>
                      <small>
                        {row.id} ·{" "}
                        {collection === "tasks"
                          ? t(
                              `deliveryProgress.states.${(row as ProgressTask).status}`,
                            )
                          : (row as ProgressRequirement).stage}
                      </small>
                      {collection === "tasks" && (
                        <small>
                          {memberRefs.members.find(
                            (member) =>
                              member.id === (row as ProgressTask).owner_id,
                          )?.name ||
                            (row as ProgressTask).assigned_to ||
                            (row as ProgressTask).owner_id}
                        </small>
                      )}
                    </div>
                    <div className="delivery-actions">
                      <Button
                        size="small"
                        disabled={disabled}
                        onClick={() => {
                          if (
                            !disabled &&
                            owner.current === projectSessionKey()
                          )
                            change({
                              progress_item: itemId === row.id ? null : row.id,
                            });
                        }}
                      >
                        {t("deliveryProgress.bounded.openOriginalItem")}
                      </Button>
                      {!disabled &&
                        (collection === "tasks" ? (
                          <CurrentTaskButton
                            projectId={projectId}
                            task={{ id: row.id }}
                            onOpenTask={onOpenTask}
                          />
                        ) : (
                          <CurrentRequirementButton
                            projectId={projectId}
                            id={row.id}
                            onOpen={onOpenTask}
                          />
                        ))}
                    </div>
                  </article>
                ))}
              </div>
              {!data.items.length && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("deliveryProgress.noTasks")}
                />
              )}
              <ProgressPager
                total={data.total}
                count={data.items.length}
                cursor={cursor}
                next={data.next_cursor}
                page={page}
                busy={items.isFetching || disabled}
                onPage={(value, number) =>
                  change({
                    progress_cursor: value,
                    progress_page: number,
                    progress_item: null,
                  })
                }
              />
            </>
          )}
          {itemId && exact.isPending && <Skeleton active />}
          {itemId && exact.error && (
            <ReadProblem
              error={exact.error}
              retry={() => void exact.refetch()}
            />
          )}
          {item &&
            (collection === "tasks" ? (
              <ExactTaskFacts task={item as ProgressTask} />
            ) : (
              <section className="delivery-progress-exact">
                <h4>{item.title}</h4>
                <p>
                  {t("deliveryProgress.bounded.frozenRequirement", {
                    revision: (item as ProgressRequirement).revision,
                    stage: (item as ProgressRequirement).stage,
                  })}
                </p>
              </section>
            ))}
        </>
      )}
    </section>
  );
}
function ExactDifference({
  detail,
  projectId,
  onOpenTask,
}: {
  detail: ProgressComparisonDetail;
  projectId: string;
  onOpenTask: (target: DeliveryInboxTarget) => void;
}) {
  const item = detail.item;
  return (
    <DeliveryProgressComparison
      projectId={projectId}
      comparison={{
        added: !item.before && item.after ? [item.after] : [],
        removed: item.before && !item.after ? [item.before] : [],
        changed:
          item.before && item.after
            ? [
                {
                  id: item.id,
                  before: item.before,
                  after: item.after,
                  fields: item.fields,
                },
              ]
            : [],
        incomplete_plan_fields: item.incomplete_fields,
      }}
      onOpenTask={(target) => {
        if (projectId) onOpenTask(target);
      }}
    />
  );
}
export function DeliveryProgressComparisonBrowser({
  projectId,
  sessionId,
  baselineId,
  generation,
  disabled,
  onOpenTask,
}: {
  projectId: string;
  sessionId: string;
  baselineId: string;
  generation: number;
  disabled: boolean;
  onOpenTask: (target: DeliveryInboxTarget) => void;
}) {
  const { t } = useTranslation(),
    { params, change } = useBrowserRoute(disabled),
    owner = useRef(projectSessionKey());
  const rawKind = params.get("progress_diff_kind") || "",
    kind = ["added", "removed", "changed", "incomplete"].includes(rawKind)
      ? (rawKind as ProgressComparisonKind)
      : null,
    cursor = params.get("progress_diff_cursor") || "",
    page = Math.max(1, Number(params.get("progress_diff_page")) || 1),
    itemId = params.get("progress_diff_item") || "";
  const summary = useQuery({
    queryKey: [
      "delivery-progress-comparison",
      projectId,
      sessionId,
      baselineId,
      generation,
    ],
    queryFn: ({ signal }) =>
      fetchProgressComparison(projectId, baselineId, signal, generation),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const info =
    !summary.isError && owner.current === projectSessionKey()
      ? summary.data
      : undefined;
  const items = useQuery({
    queryKey: [
      "delivery-progress-differences",
      projectId,
      sessionId,
      baselineId,
      info?.baseline_basis,
      info?.query_generation,
      kind,
      cursor,
    ],
    queryFn: ({ signal }) =>
      fetchProgressComparisonPage(
        projectId,
        baselineId,
        kind!,
        info!.query_generation,
        { cursor },
        signal,
      ),
    enabled: Boolean(info?.available && info.complete && kind),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const data =
    info?.available &&
    info.complete &&
    !items.isError &&
    items.data?.query_generation === info.query_generation &&
    items.data.baseline_basis === info.baseline_basis &&
    items.data.kind === kind
      ? items.data
      : undefined;
  const exact = useQuery({
    queryKey: [
      "delivery-progress-difference-item",
      projectId,
      sessionId,
      baselineId,
      info?.baseline_basis,
      info?.query_generation,
      kind,
      itemId,
    ],
    queryFn: ({ signal }) =>
      fetchProgressComparisonItem(
        projectId,
        baselineId,
        kind!,
        itemId,
        info!.query_generation,
        signal,
      ),
    enabled: Boolean(info?.available && info.complete && kind && itemId),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const denied =
    progressReadDenied(items.error) || progressReadDenied(exact.error);
  const detail =
    !denied &&
    !exact.isError &&
    info?.available &&
    info.complete &&
    exact.data?.baseline_id === baselineId &&
    exact.data.kind === kind &&
    exact.data?.query_generation === info.query_generation &&
    exact.data.baseline_basis === info.baseline_basis &&
    exact.data.item.id === itemId
      ? exact.data
      : undefined;
  return (
    <section className="delivery-progress-comparison">
      <h3>{t("deliveryProgress.changes")}</h3>
      {summary.isPending && <Skeleton active />}
      {summary.error && (
        <ReadProblem
          error={summary.error}
          retry={() => void summary.refetch()}
        />
      )}
      {denied && (
        <ReadProblem
          error={items.error || exact.error}
          retry={() => {
            void summary.refetch();
            void items.refetch();
            if (itemId) void exact.refetch();
          }}
        />
      )}
      {info && !denied && (
        <>
          {info.reasons.map((reason) => (
            <Alert key={reason.code} type="info" title={reason.message} />
          ))}
          {info.counts && (
            <nav className="delivery-actions">
              {(["added", "removed", "changed", "incomplete"] as const).map(
                (value) => (
                  <Button
                    key={value}
                    disabled={disabled || !info.available || !info.complete}
                    aria-pressed={kind === value}
                    onClick={() => {
                      if (!disabled && owner.current === projectSessionKey())
                        change({
                          progress_diff_kind: value,
                          progress_diff_cursor: null,
                          progress_diff_page: null,
                          progress_diff_item: null,
                        });
                    }}
                  >
                    {t(
                      value === "incomplete"
                        ? "deliveryProgress.bounded.incomplete"
                        : `deliveryProgress.${value}`,
                    )}{" "}
                    {info.counts![value]}
                  </Button>
                ),
              )}
              <span>
                {t("deliveryProgress.unchanged", {
                  count: info.counts.unchanged,
                })}
              </span>
            </nav>
          )}
          <p className="delivery-hint">
            {t("deliveryProgress.bounded.diffHint")}
          </p>
        </>
      )}
      {kind && items.isPending && info?.available && <Skeleton active />}
      {kind && items.error && (
        <ReadProblem
          error={items.error}
          retry={() =>
            change({
              progress_diff_cursor: null,
              progress_diff_page: null,
              progress_diff_item: null,
            })
          }
        />
      )}
      {data && !denied && (
        <>
          <div className="delivery-progress-task-list">
            {data.items.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.title}</strong>
                  <small>
                    {row.before_title || "—"} → {row.after_title || "—"}
                  </small>
                  <small>
                    {row.fields
                      .map((field) =>
                        t(`deliveryProgress.changeFields.${field}`, {
                          defaultValue: field,
                        }),
                      )
                      .join(" · ")}
                  </small>
                </div>
                <Button
                  size="small"
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled && owner.current === projectSessionKey())
                      change({
                        progress_diff_item: itemId === row.id ? null : row.id,
                      });
                  }}
                >
                  {t("deliveryProgress.bounded.openDifference")}
                </Button>
              </article>
            ))}
          </div>
          <ProgressPager
            total={data.total}
            count={data.items.length}
            cursor={cursor}
            next={data.next_cursor}
            page={page}
            busy={items.isFetching || disabled}
            onPage={(value, number) =>
              change({
                progress_diff_cursor: value,
                progress_diff_page: number,
                progress_diff_item: null,
              })
            }
          />
        </>
      )}
      {itemId && exact.isPending && <Skeleton active />}
      {itemId && exact.error && (
        <ReadProblem error={exact.error} retry={() => void exact.refetch()} />
      )}
      {detail && (
        <ExactDifference
          detail={detail}
          projectId={projectId}
          onOpenTask={onOpenTask}
        />
      )}
    </section>
  );
}
