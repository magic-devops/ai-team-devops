import { useDeliveryMemberReferences } from "@/lib/deliveryQueryHooks";
import { useMemberIdentity } from "@/components/DeliveryMemberIdentity";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Empty,
  Input,
  Progress,
  Select,
  Skeleton,
  Table,
  Tag,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deliveryStages } from "@/lib/delivery";
import {
  deliveryQueryFailure,
  fetchRequirementPage,
  fetchTaskPage,
  requirementSummaryProgress,
  type RequirementSummary,
} from "@/lib/deliveryQuery";
import type { DeliveryRoute } from "@/lib/deliveryProjectInbox";
import { ProjectOwnerSelect } from "@/components/DeliveryMemberIdentity";
import { DeliveryTaskDetail } from "./DeliveryTaskDetail";

export function DeliveryQueryError({
  error,
  onRetry,
  onReset,
}: {
  error: unknown;
  onRetry: () => void;
  onReset?: () => void;
}) {
  const { t } = useTranslation();
  const failure = deliveryQueryFailure(error);
  return (
    <Alert
      type="error"
      showIcon
      title={t(
        `deliveryQuery.${failure.stale ? "changed" : failure.missing ? "missing" : failure.denied ? "denied" : failure.rebuild ? "rebuildRequired" : "readFailed"}`,
      )}
      description={failure.message}
      action={
        <Button onClick={failure.stale && onReset ? onReset : onRetry}>
          {t(
            `deliveryQuery.${failure.stale && onReset ? "firstPage" : "retry"}`,
          )}
        </Button>
      }
    />
  );
}
export function DeliveryPageControls({
  page,
  next,
  cursor,
  onPage,
  loading,
  total,
}: {
  page: number;
  next?: string | null;
  cursor: string;
  onPage: (page: number, cursor: string) => void;
  loading: boolean;
  total: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="delivery-query-pagination">
      <span role="status">{t("deliveryQuery.pageCount", { page, total })}</span>
      <Button disabled={page <= 1 || loading} onClick={() => onPage(1, "")}>
        {t("deliveryQuery.firstPage")}
      </Button>
      <Button
        disabled={!next || loading}
        onClick={() => onPage(page + 1, next || cursor)}
      >
        {t("deliveryQuery.next")}
      </Button>
    </div>
  );
}
export function DeliveryRequirementIndex({
  projectId,
  sessionId,
  view,
  route,
  onRoute,
  onOpen,
  queryGeneration,
  onRefreshContext,
}: {
  projectId: string;
  sessionId: string;
  view: "list" | "board";
  route: DeliveryRoute;
  onRoute: (patch: Partial<DeliveryRoute>, push?: boolean) => void;
  onOpen: (id: string) => void;
  queryGeneration?: number | null;
  onRefreshContext?: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState(route.search);
  const [boardRefresh, setBoardRefresh] = useState(0);
  useEffect(() => setSearch(route.search), [route.search]);
  const boardParams = new URLSearchParams(location.hash.split("?")[1]);
  const boardPage = (stage: string, page: number, cursor: string) => {
    const params = new URLSearchParams(location.hash.split("?")[1]);
    params.set(`board_${stage}_page`, String(page));
    if (cursor) params.set(`board_${stage}_cursor`, cursor);
    else params.delete(`board_${stage}_cursor`);
    history.pushState(null, "", `#/dev-flow?${params}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const base = {
    q: route.search,
    stage: route.stage,
    owner_id: route.owner,
    sort: route.sort,
    limit: 20,
  };
  const query = useQuery({
    queryKey: [
      "delivery-requirements",
      projectId,
      sessionId,
      base,
      queryGeneration,
      route.cursor,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementPage(
        projectId,
        { ...base, cursor: route.cursor },
        signal,
        queryGeneration,
      ),
    enabled: view === "list",
    retry: false,
    gcTime: 0,
  });
  const lanes = useQueries({
    queries: deliveryStages
      .filter(
        (stage) => view === "board" && (!route.stage || stage === route.stage),
      )
      .map((stage) => ({
        queryKey: [
          "delivery-requirements-board",
          projectId,
          sessionId,
          base,
          queryGeneration,
          boardRefresh,
          stage,
          boardParams.get(`board_${stage}_cursor`) || "",
        ],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchRequirementPage(
            projectId,
            {
              ...base,
              stage,
              cursor: boardParams.get(`board_${stage}_cursor`) || "",
            },
            signal,
            queryGeneration,
          ),
        retry: false,
        gcTime: 0,
      })),
  });
  const loadedPages = lanes.flatMap((lane) => (lane.data ? [lane.data] : []));
  const listChanged = Boolean(
    query.data &&
    (query.data.project_id !== projectId ||
      (queryGeneration !== undefined &&
        query.data.query_generation !== queryGeneration)),
  );
  const boardChanged =
    loadedPages.some(
      (page) =>
        page.project_id !== projectId ||
        !Number.isInteger(page.query_generation) ||
        (queryGeneration !== undefined &&
          page.query_generation !== queryGeneration),
    ) ||
    new Set(loadedPages.map((page) => page.query_generation)).size > 1 ||
    lanes.some((lane) => lane.error && deliveryQueryFailure(lane.error).stale);
  const refreshBoard = () => {
    const params = new URLSearchParams(location.hash.split("?")[1]);
    for (const key of [...params.keys()])
      if (/^board_.+_(?:cursor|page)$/.test(key)) params.delete(key);
    history.replaceState(history.state, "", `#/dev-flow?${params}`);
    onRefreshContext?.();
    setBoardRefresh((value) => value + 1);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const refs = useDeliveryMemberReferences(
    projectId,
    sessionId,
    [
      ...(view === "list" ? query.data?.items || [] : []),
      ...(boardChanged ? [] : lanes.flatMap((lane) => lane.data?.items || [])),
    ].map((row) => row.flow.owner_id),
    queryGeneration,
  );
  const identity = useMemberIdentity();
  const ownerLabel = (id: string) =>
    id && !refs.members.some((member) => member.id === id)
      ? id
      : identity(refs.members, id);
  const filter = (patch: Partial<DeliveryRoute>) => {
    const params = new URLSearchParams(location.hash.split("?")[1]);
    for (const key of [...params.keys()])
      if (/^board_.+_(?:cursor|page)$/.test(key)) params.delete(key);
    history.replaceState(history.state, "", `#/dev-flow?${params}`);
    onRoute({ ...patch, page: 1, cursor: "" });
  };
  const card = (row: RequirementSummary) => (
    <button
      className="delivery-card"
      key={row.id}
      onClick={() => onOpen(row.id)}
    >
      <small>{row.id}</small>
      <h3>{row.title}</h3>
      <span>
        <Tag>{t(`delivery.stages.${row.flow.stage}`)}</Tag>
        <Tag>{row.priority}</Tag>
      </span>
      <Progress percent={requirementSummaryProgress(row)} size="small" />
      <span>
        {t("deliveryProgress.states.verified")}: {row.tasks_done}/
        {row.tasks_total}
      </span>
      <span>
        {t("delivery.owner")}: {ownerLabel(row.flow.owner_id)}
      </span>
      <span>
        {t("delivery.due")}: {row.flow.due_on || "—"}
      </span>
    </button>
  );
  return (
    <>
      <div className="delivery-toolbar">
        <Input.Search
          aria-label={t("delivery.search")}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            if (!event.target.value) filter({ search: "" });
          }}
          onSearch={(value) => filter({ search: value })}
          allowClear
        />
        <Select
          aria-label={t("delivery.allStages")}
          value={route.stage}
          onChange={(stage) => filter({ stage })}
          options={[
            { value: "", label: t("delivery.allStages") },
            ...deliveryStages.map((stage) => ({
              value: stage,
              label: t(`delivery.stages.${stage}`),
            })),
          ]}
        />
        <ProjectOwnerSelect
          label={t("delivery.allOwners")}
          queryGeneration={queryGeneration}
          value={route.owner}
          onChange={(owner) => filter({ owner })}
        />
        <Select
          aria-label={t("deliveryQuery.sort")}
          value={route.sort}
          onChange={(sort) => filter({ sort })}
          options={[
            "created_desc",
            "id_asc",
            "id_desc",
            "title_asc",
            "priority_asc",
            "due_asc",
          ].map((value) => ({
            value,
            label: t(`deliveryQuery.sorts.${value}`),
          }))}
        />
      </div>
      {view === "list" ? (
        <>
          {listChanged && (
            <Alert
              type="warning"
              showIcon
              title={t("deliveryQuery.changed")}
              action={
                <Button
                  onClick={() => {
                    onRefreshContext?.();
                    onRoute({ page: 1, cursor: "" });
                    void query.refetch();
                  }}
                >
                  {t("deliveryQuery.firstPage")}
                </Button>
              }
            />
          )}
          {query.error && (
            <DeliveryQueryError
              error={query.error}
              onRetry={() => void query.refetch()}
              onReset={() => onRoute({ page: 1, cursor: "" })}
            />
          )}
          {query.isPending ? (
            <Skeleton active />
          ) : (
            query.data &&
            !listChanged && (
              <>
                <div className="delivery-query-mobile-list">
                  {query.data.items.length ? (
                    query.data.items.map(card)
                  ) : (
                    <Empty description={t("delivery.empty")} />
                  )}
                </div>
                <div className="delivery-query-desktop-list">
                  <Table<RequirementSummary>
                    rowKey="id"
                    dataSource={query.data.items}
                    pagination={false}
                    size="small"
                    locale={{
                      emptyText: (
                        <Empty
                          description={
                            <>
                              <strong>{t("delivery.empty")}</strong>
                              <p>{t("delivery.emptyHint")}</p>
                            </>
                          }
                        />
                      ),
                    }}
                    scroll={{ x: 760 }}
                    columns={[
                      {
                        title: t("delivery.titleField"),
                        render: (_, row) => (
                          <Button type="link" onClick={() => onOpen(row.id)}>
                            <span>
                              {row.title}
                              <small className="delivery-query-id">
                                {row.id}
                              </small>
                            </span>
                          </Button>
                        ),
                      },
                      {
                        title: t("delivery.current"),
                        render: (_, row) => (
                          <Tag>{t(`delivery.stages.${row.flow.stage}`)}</Tag>
                        ),
                      },
                      {
                        title: t("delivery.owner"),
                        render: (_, row) => ownerLabel(row.flow.owner_id),
                      },
                      {
                        title: t("delivery.progress"),
                        render: (_, row) =>
                          `${row.tasks_done}/${row.tasks_total}`,
                      },
                      {
                        title: t("delivery.due"),
                        render: (_, row) => row.flow.due_on || "—",
                      },
                    ]}
                  />
                </div>
                <DeliveryPageControls
                  page={route.page}
                  cursor={route.cursor}
                  next={query.data.next_cursor}
                  total={query.data.total}
                  loading={query.isFetching}
                  onPage={(page, cursor) => onRoute({ page, cursor }, true)}
                />
              </>
            )
          )}
        </>
      ) : boardChanged ? (
        <Alert
          type="warning"
          showIcon
          title={t("deliveryQuery.changed")}
          action={
            <Button onClick={refreshBoard}>
              {t("deliveryQuery.firstPage")}
            </Button>
          }
        />
      ) : (
        <div className="delivery-board">
          {lanes.map((lane, index) => {
            const stage = deliveryStages.filter(
              (value) => !route.stage || value === route.stage,
            )[index];
            return (
              <section key={stage} className="delivery-lane">
                <header>
                  {t(`delivery.stages.${stage}`)}{" "}
                  <Tag>{lane.data?.total ?? "—"}</Tag>
                </header>
                {lane.isPending && <Skeleton active />}
                {lane.error && (
                  <DeliveryQueryError
                    error={lane.error}
                    onRetry={() => void lane.refetch()}
                    onReset={() => boardPage(stage, 1, "")}
                  />
                )}
                {lane.data?.items.map(card)}
                {lane.data && (
                  <DeliveryPageControls
                    page={Number(boardParams.get(`board_${stage}_page`)) || 1}
                    cursor={boardParams.get(`board_${stage}_cursor`) || ""}
                    next={lane.data.next_cursor}
                    total={lane.data.total}
                    loading={lane.isFetching}
                    onPage={(page, cursor) => boardPage(stage, page, cursor)}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
export function DeliveryRequirementTasks({
  projectId,
  sessionId,
  requirementId,
  route,
  onRoute,
  onUnresolvedChange,
  queryGeneration,
}: {
  projectId: string;
  sessionId: string;
  requirementId: string;
  route: DeliveryRoute;
  onRoute: (patch: Partial<DeliveryRoute>, push?: boolean) => void;
  onUnresolvedChange: (value: boolean) => void;
  queryGeneration?: number | null;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: [
      "delivery-requirement-tasks",
      projectId,
      sessionId,
      requirementId,
      queryGeneration,
      route.taskCursor,
      route.taskSort,
    ],
    queryFn: ({ signal }) =>
      fetchTaskPage(
        projectId,
        {
          requirement_id: requirementId,
          cursor: route.taskCursor,
          sort: route.taskSort,
          limit: 20,
        },
        signal,
        queryGeneration,
      ),
    retry: false,
    gcTime: 0,
  });
  return (
    <>
      {query.error && (
        <DeliveryQueryError
          error={query.error}
          onRetry={() => void query.refetch()}
          onReset={() => onRoute({ taskPage: 1, taskCursor: "" })}
        />
      )}
      {query.isPending && <Skeleton active />}
      {query.data && (
        <>
          {!query.data.total && <Empty description={t("delivery.noTasks")} />}
          {query.data.items.map((task) => (
            <Button
              className="delivery-query-task-row"
              key={task.id}
              type={route.task === task.id ? "primary" : "text"}
              onClick={() => onRoute({ task: task.id }, true)}
            >
              <span>
                {task.title}
                <small>{task.id}</small>
              </span>
              <Tag>{t(`deliveryProgress.states.${task.delivery_status}`)}</Tag>
            </Button>
          ))}
          <DeliveryPageControls
            page={route.taskPage}
            cursor={route.taskCursor}
            next={query.data.next_cursor}
            total={query.data.total}
            loading={query.isFetching}
            onPage={(taskPage, taskCursor) =>
              onRoute({ taskPage, taskCursor }, true)
            }
          />
        </>
      )}
      {route.task &&
        query.data &&
        !query.data.items.some((item) => item.id === route.task) && (
          <Alert type="info" title={t("deliveryQuery.outsidePage")} />
        )}
      {route.task && (
        <DeliveryTaskDetail
          key={`${projectId}:${route.task}`}
          projectId={projectId}
          sessionId={sessionId}
          taskId={route.task}
          queryGeneration={queryGeneration}
          expectedRequirementId={requirementId}
          onUnresolvedChange={onUnresolvedChange}
        />
      )}
    </>
  );
}
