import { useQuery } from "@tanstack/react-query";
import { fetchDeliveryReferences, fetchTaskPage } from "@/lib/deliveryQuery";
import { DeliveryPageControls, DeliveryQueryError } from "./DeliveryQueryViews";
import type { DeliveryCommandAck } from "@/lib/deliveryQuery";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Select,
  Skeleton,
  Tag,
} from "antd";
import { Bot, CalendarDays, Users, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  DeliveryInboxTarget,
  DeliveryMember,
  DeliveryContext,
} from "@/lib/delivery";
import type {
  DeliverySchedule,
  SchedulingRoute,
} from "@/lib/deliveryScheduling";
import { useMemberIdentity } from "@/components/DeliveryMemberIdentity";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { DeliveryMemberRuntime } from "./DeliveryMemberRuntime";
import "./delivery-team.css";

export function DeliveryTeamMembers({
  workspace,
  schedule,
  calendarFailed,
  route,
  onRoute,
  onEdit,
  onCalendar,
  onRetryCalendar,
  onTask,
  sessionId,
  onSaved,
}: {
  workspace: DeliveryContext;
  schedule?: DeliverySchedule;
  calendarFailed: boolean;
  route: SchedulingRoute;
  onRoute: (patch: Partial<SchedulingRoute>) => void;
  onEdit: (member: DeliveryMember) => void;
  onCalendar: (id: string) => void;
  onRetryCalendar: () => void;
  onTask: (target: DeliveryInboxTarget) => void;
  sessionId: string;
  onSaved: (workspace: DeliveryCommandAck) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, values?: Record<string, unknown>) =>
    t(`deliveryTeam.${key}`, values);
  const identity = useMemberIdentity();
  const hasTaskInspector = Boolean(
    new URLSearchParams(location.hash.split("?")[1]).get("task"),
  );
  const requestedMemberId = hasTaskInspector ? "" : route.teamMemberId;
  const memberInspector = useDrawerIdentity(
    `${workspace.project.id}:${sessionId}`,
    requestedMemberId,
  );
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const cursor = params.get("team_cursor") || "",
    page = Number(params.get("team_page")) || 1;
  const memberQuery = useQuery({
    queryKey: [
      "delivery-members-page",
      workspace.project.id,
      sessionId,
      route.teamSearch,
      route.teamKind,
      route.teamState,
      cursor,
      workspace.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryReferences<DeliveryMember>(
        workspace.project.id,
        "member",
        {
          q: route.teamSearch,
          member_kind: route.teamKind === "all" ? "" : route.teamKind,
          member_active:
            route.teamState === "all"
              ? undefined
              : route.teamState === "active",
          cursor,
          limit: 20,
        },
        signal,
        workspace.query_generation,
      ),
    retry: false,
    gcTime: 0,
  });
  const memberDetail = useQuery({
    queryKey: [
      "delivery-member-exact",
      workspace.project.id,
      sessionId,
      memberInspector.displayId,
      workspace.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryReferences<DeliveryMember>(
        workspace.project.id,
        "member",
        { ids: [memberInspector.displayId] },
        signal,
        workspace.query_generation,
      ),
    enabled: Boolean(memberInspector.displayId),
    retry: false,
    gcTime: 0,
  });
  const members = memberQuery.data?.items.map((item) => item.data) || [];
  const selected = memberDetail.data?.items[0]?.data;
  const taskCursor = params.get("team_task_cursor") || "",
    taskPage = Number(params.get("team_task_page")) || 1;
  const taskPaging = (nextPage: number, nextCursor: string) => {
    const next = new URLSearchParams(location.hash.split("?")[1]);
    next.set("team_task_page", String(nextPage));
    if (nextCursor) next.set("team_task_cursor", nextCursor);
    else next.delete("team_task_cursor");
    history.pushState(null, "", `#/dev-flow?${next}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const change = (patch: Partial<SchedulingRoute>) => {
    const next = new URLSearchParams(location.hash.split("?")[1]);
    if ("teamMemberId" in patch) {
      next.delete("team_task_cursor");
      next.delete("team_task_page");
    }
    if ("teamSearch" in patch || "teamKind" in patch || "teamState" in patch) {
      next.delete("team_cursor");
      next.delete("team_page");
    }
    history.replaceState(history.state, "", `#/dev-flow?${next}`);
    onRoute(patch);
  };
  const taskQuery = useQuery({
    queryKey: [
      "delivery-member-tasks",
      workspace.project.id,
      sessionId,
      selected?.id,
      taskCursor,
      workspace.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchTaskPage(
        workspace.project.id,
        { owner_id: selected!.id, cursor: taskCursor, limit: 20 },
        signal,
        workspace.query_generation,
      ),
    enabled: Boolean(selected && selected.kind !== "tool"),
    retry: false,
    gcTime: 0,
  });
  const tasks = taskQuery.data?.items || [];
  const pageRoute = (nextPage: number, nextCursor: string) => {
    const next = new URLSearchParams(location.hash.split("?")[1]);
    next.set("team_page", String(nextPage));
    if (nextCursor) next.set("team_cursor", nextCursor);
    else next.delete("team_cursor");
    history.pushState(null, "", `#/dev-flow?${next}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const filtered = Boolean(
    route.teamSearch.trim() ||
    route.teamKind !== "all" ||
    route.teamState !== "all",
  );
  const reset = () =>
    change({ teamKind: "all", teamState: "all", teamSearch: "" });
  const canConfigure = workspace.permissions.configure;
  return (
    <section className="delivery-team-registry" aria-label={tr("identity")}>
      <div className="delivery-team-filters">
        <Input.Search
          aria-label={tr("search")}
          placeholder={tr("search")}
          value={route.teamSearch}
          allowClear
          onChange={(event) => change({ teamSearch: event.target.value })}
        />
        <Select
          aria-label={tr("allKinds")}
          value={route.teamKind}
          options={[
            { value: "all", label: tr("allKinds") },
            ...["human", "agent", "tool"].map((kind) => ({
              value: kind,
              label: tr(`kinds.${kind}`),
            })),
          ]}
          onChange={(teamKind) => change({ teamKind })}
        />
        <Select
          aria-label={tr("allStates")}
          value={route.teamState}
          options={[
            { value: "all", label: tr("allStates") },
            ...["active", "inactive"].map((state) => ({
              value: state,
              label: tr(state),
            })),
          ]}
          onChange={(teamState) => change({ teamState })}
        />
        <Button type="text" onClick={reset}>
          {tr("reset")}
        </Button>
      </div>
      <div className="delivery-team-caption">
        <span>
          {tr("count", {
            visible: members.length,
            total: memberQuery.data?.total ?? "—",
          })}
        </span>
        <span>{tr("identityHint")}</span>
      </div>
      {!canConfigure && <p className="delivery-hint">{tr("readOnly")}</p>}
      {memberQuery.error && (
        <DeliveryQueryError
          error={memberQuery.error}
          onRetry={() => void memberQuery.refetch()}
          onReset={() => pageRoute(1, "")}
        />
      )}
      {!members.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <>
              <strong>{tr(filtered ? "noMatches" : "empty")}</strong>
              <p>{tr(filtered ? "noMatchesHint" : "emptyHint")}</p>
            </>
          }
        >
          {filtered ? (
            <Button onClick={reset}>{tr("reset")}</Button>
          ) : (
            <Button href="#/projects/members">{tr("people")}</Button>
          )}
        </Empty>
      ) : (
        <div className="delivery-schedule-members">
          {members.map((member) => {
            const Icon =
              member.kind === "human"
                ? Users
                : member.kind === "agent"
                  ? Bot
                  : Wrench;
            const resource = schedule?.resources.find(
              (item) => item.id === member.id,
            );
            const owned =
              memberQuery.data?.items.find((item) => item.id === member.id)
                ?.task_count ?? "—";
            return (
              <article key={member.id}>
                <div className="delivery-schedule-member-heading">
                  <span>
                    <Icon size={20} aria-hidden />
                  </span>
                  <div>
                    <h3>
                      <button
                        className="delivery-team-member-link"
                        onClick={() => change({ teamMemberId: member.id })}
                      >
                        {member.name}
                      </button>
                    </h3>
                    <small>{tr(`kinds.${member.kind}`)}</small>
                  </div>
                  <Tag color={member.active ? undefined : "warning"}>
                    {tr(member.active ? "registered" : "inactive")}
                  </Tag>
                </div>
                <code className="delivery-team-id">{member.id}</code>
                <p>
                  {tr("role")}: {member.role || "—"}
                </p>
                {member.kind !== "tool" && (
                  <p>
                    {tr("assignedTasks")} · {owned}
                  </p>
                )}
                <p>
                  <CalendarDays size={14} aria-hidden />
                  {tr(
                    calendarFailed
                      ? "calendarUnavailable"
                      : resource?.calendar
                        ? "calendar"
                        : "calendarUnknown",
                  )}
                </p>
                <div className="delivery-actions">
                  <Button
                    size="small"
                    onClick={() => change({ teamMemberId: member.id })}
                  >
                    {tr("details")}
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    onClick={() =>
                      change({
                        teamMode: "capacity",
                        memberId: member.id,
                        teamMemberId: "",
                      })
                    }
                  >
                    {tr("viewCapacity")}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {memberQuery.data && (
        <DeliveryPageControls
          page={page}
          cursor={cursor}
          next={memberQuery.data.next_cursor}
          total={memberQuery.data.total}
          loading={memberQuery.isFetching}
          onPage={pageRoute}
        />
      )}
      <Drawer
        title={tr("details")}
        open={Boolean(requestedMemberId)}
        width={560}
        className="delivery-inspector delivery-team-inspector"
        destroyOnHidden
        afterOpenChange={memberInspector.afterOpenChange}
        onClose={() => change({ teamMemberId: "" })}
      >
        {memberDetail.isPending ? (
          <Skeleton active />
        ) : memberDetail.error ? (
          <DeliveryQueryError
            error={memberDetail.error}
            onRetry={() => void memberDetail.refetch()}
          />
        ) : !selected ? (
          <Alert
            type="warning"
            title={tr("missing")}
            description={tr("missingHint")}
            action={
              <Button onClick={() => change({ teamMemberId: "" })}>
                {tr("back")}
              </Button>
            }
          />
        ) : (
          <>
            <div className="delivery-team-detail-heading">
              <h3>{selected.name}</h3>
              <Tag>{tr(`kinds.${selected.kind}`)}</Tag>
              <Tag color={selected.active ? undefined : "warning"}>
                {tr(selected.active ? "active" : "inactive")}
              </Tag>
            </div>
            <dl className="delivery-team-facts">
              <div>
                <dt>{tr("stableId")}</dt>
                <dd>
                  <code>{selected.id}</code>
                </dd>
              </div>
              <div>
                <dt>{tr("role")}</dt>
                <dd>{selected.role || "—"}</dd>
              </div>
              {selected.tool && (
                <div>
                  <dt>{t("delivery.tool")}</dt>
                  <dd>{selected.tool}</dd>
                </div>
              )}
            </dl>
            <p className="delivery-hint">{tr("roleHint")}</p>
            {selected.kind !== "human" && (
              <p className="delivery-hint">
                {tr(selected.kind === "tool" ? "toolHint" : "agentHint")}
              </p>
            )}
            {!selected.active && (
              <Alert
                type="warning"
                title={tr("inactive")}
                description={tr("inactiveHint")}
              />
            )}
            {!canConfigure && <p className="delivery-hint">{tr("readOnly")}</p>}
            <div className="delivery-actions">
              {selected.kind === "human" ? (
                <Button href="#/projects/members">{tr("people")}</Button>
              ) : (
                canConfigure && (
                  <Button onClick={() => onEdit(selected)}>{tr("edit")}</Button>
                )
              )}
              {canConfigure && selected.active && (
                <Button
                  disabled={calendarFailed}
                  onClick={() => onCalendar(selected.id)}
                >
                  {tr("configureCalendar")}
                </Button>
              )}
            </div>
            {calendarFailed && (
              <Alert
                type="error"
                title={tr("calendarUnavailable")}
                action={
                  <Button size="small" onClick={onRetryCalendar}>
                    {tr("retry")}
                  </Button>
                }
              />
            )}
            {selected.kind === "agent" && (
              <DeliveryMemberRuntime
                key={`${workspace.project.id}:${sessionId}:${selected.id}`}
                member={selected}
                projectId={workspace.project.id}
                sessionId={sessionId}
                onSaved={onSaved}
              />
            )}
            {selected.kind !== "tool" && (
              <section className="delivery-team-task-list">
                <h4>
                  {tr("assignedTasks")} · {taskQuery.data?.total ?? "—"}
                </h4>
                {!tasks.length ? (
                  <p className="delivery-hint">{tr("noTasks")}</p>
                ) : (
                  tasks.map((task) => (
                    <Button
                      key={task.id}
                      type="link"
                      onClick={() =>
                        onTask({
                          view: "team",
                          requirement_id: task.req_id,
                          task_id: task.id,
                          detail: "tasks",
                        })
                      }
                    >
                      <span>
                        {task.title}
                        <small>
                          {identity(selected ? [selected] : [], task.owner_id)}
                        </small>
                      </span>
                    </Button>
                  ))
                )}
                {taskQuery.error && (
                  <DeliveryQueryError
                    error={taskQuery.error}
                    onRetry={() => void taskQuery.refetch()}
                    onReset={() => taskPaging(1, "")}
                  />
                )}
                {taskQuery.data && (
                  <DeliveryPageControls
                    page={taskPage}
                    cursor={taskCursor}
                    next={taskQuery.data.next_cursor}
                    total={taskQuery.data.total}
                    loading={taskQuery.isFetching}
                    onPage={taskPaging}
                  />
                )}
              </section>
            )}
          </>
        )}
      </Drawer>
    </section>
  );
}
