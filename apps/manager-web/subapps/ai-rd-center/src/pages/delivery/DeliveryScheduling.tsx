import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Progress,
  Segmented,
  Select,
  Skeleton,
  Tag,
} from "antd";
import {
  Bot,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Users,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DeliveryInboxTarget,
  DeliveryMember,
  DeliveryMilestone,
  DeliveryWorkspace,
} from "@/lib/delivery";
import {
  defaultSchedulingRange,
  fetchDeliverySchedule,
  filterSchedulingTasks,
  openMemberCalendar,
  openSchedulingTasks,
  parseSchedulingRoute,
  schedulingHash,
  schedulingRangeProblem,
  type SchedulingRoute,
  type SchedulingSession,
} from "@/lib/deliveryScheduling";
import { DeliveryCapacityCalendar } from "./DeliveryCapacityCalendar";
import { DeliveryDependencyTimeline } from "./DeliveryDependencyTimeline";
import { DeliveryScheduleEditor } from "./DeliveryScheduleEditor";
import { progressDateTime } from "./DeliveryProgressDetails";
import "./delivery-scheduling.css";

type Props = {
  projectId: string;
  sessionId: string;
  view: "team" | "timeline";
  workspace: DeliveryWorkspace;
  onSaved: (workspace: DeliveryWorkspace) => void;
  onOpenTask: (target: DeliveryInboxTarget) => void;
  onEditMember: (member?: DeliveryMember) => void;
  onEditMilestone: (milestone?: DeliveryMilestone) => void;
};

export function DeliveryScheduling({
  projectId,
  sessionId,
  view,
  workspace,
  onSaved,
  onOpenTask,
  onEditMember,
  onEditMilestone,
}: Props) {
  const { t, i18n } = useTranslation();
  const tr = (key: string, values?: Record<string, unknown>) =>
    t(`deliverySchedule.${key}`, values);
  const qc = useQueryClient();
  const [route, setRoute] = useState(() => ({
    ...parseSchedulingRoute(location.hash),
    view,
  }));
  const [dates, setDates] = useState({
    startsOn: route.startsOn,
    endsOn: route.endsOn,
  });
  const [search, setSearch] = useState(route.search);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editor, setEditor] = useState<SchedulingSession | null>(null);
  const [actionError, setActionError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const sync = () => setRoute(parseSchedulingRoute(location.hash));
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  useEffect(() => {
    setDates({ startsOn: route.startsOn, endsOn: route.endsOn });
  }, [route.startsOn, route.endsOn]);
  useEffect(() => setSearch(route.search), [route.search]);
  const changeRoute = useCallback(
    (patch: Partial<SchedulingRoute>, replace = false) => {
      const next = { ...parseSchedulingRoute(location.hash), ...patch };
      const hash = schedulingHash(next, location.hash);
      history[replace ? "replaceState" : "pushState"](
        null,
        "",
        `${location.pathname}${location.search}${hash}`,
      );
      setRoute(next);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    [],
  );
  const problem = schedulingRangeProblem(route.startsOn, route.endsOn);
  const draftProblem = schedulingRangeProblem(dates.startsOn, dates.endsOn);
  const query = useQuery({
    queryKey: [
      "delivery-schedule",
      projectId,
      sessionId,
      route.startsOn,
      route.endsOn,
    ],
    queryFn: ({ signal }) => fetchDeliverySchedule(projectId, route, signal),
    enabled: !problem,
    gcTime: 0,
    refetchInterval: 15000,
  });
  const data = query.data;
  const tasks = data ? filterSchedulingTasks(data.tasks, route) : [];
  const visibleIds = tasks.map((task) => task.id);
  const resources = (data?.resources || []).filter(
    (resource) => !route.memberId || resource.id === route.memberId,
  );
  const mode = view === "team" ? route.teamMode : route.timelineMode;
  const detailed = mode === "capacity" || mode === "dependencies";
  const dayResource = data?.resources.find(
    (resource) => resource.id === route.dayMemberId,
  );
  const day = dayResource?.cells.find((cell) => cell.date === route.day);
  const hasTaskInspector = Boolean(
    new URLSearchParams(location.hash.split("?")[1]).get("task"),
  );
  function openTask(id: string) {
    const task = data?.tasks.find((item) => item.id === id);
    if (!task) {
      setActionError(tr("missingTask"));
      return;
    }
    onOpenTask({
      view,
      requirement_id: task.req_id,
      task_id: task.id,
      detail: "tasks",
    });
  }
  function openTasks(ids: string[]) {
    if (!data || query.isError || !data.permissions.write) return;
    try {
      setEditor(openSchedulingTasks(data, ids, crypto.randomUUID()));
      setActionError("");
      setSaved(false);
    } catch {
      setActionError(tr("missingTask"));
    }
  }
  function openCalendar(id: string) {
    if (!data || query.isError || !data.permissions.configure) return;
    try {
      setEditor(openMemberCalendar(data, id, crypto.randomUUID()));
      setActionError("");
      setSaved(false);
    } catch {
      setActionError(tr("missingResource"));
    }
  }
  useEffect(() => {
    if (route.editTaskId && data && !editor && !query.isError)
      openTasks([route.editTaskId]);
  }, [route.editTaskId, data, Boolean(editor), query.isError]);
  function editTask(id: string) {
    changeRoute({ editTaskId: id });
    openTasks([id]);
  }
  function closeEditor() {
    setEditor(null);
    if (route.editTaskId) changeRoute({ editTaskId: "" }, true);
  }
  function saveResult(updated: DeliveryWorkspace) {
    onSaved(updated);
    setSaved(true);
    for (const name of [
      "delivery-schedule",
      "delivery-progress",
      "delivery-task-reviews",
      "delivery-inbox",
      "taskDependencies",
      "tasks",
    ])
      void qc.invalidateQueries({ queryKey: [name] });
    void query.refetch();
  }
  function shiftRange(direction: number) {
    if (problem) return;
    const days =
      (Date.parse(`${route.endsOn}T00:00:00Z`) -
        Date.parse(`${route.startsOn}T00:00:00Z`)) /
        86400000 +
      1;
    const shift = (value: string) =>
      new Date(Date.parse(`${value}T00:00:00Z`) + direction * days * 86400000)
        .toISOString()
        .slice(0, 10);
    changeRoute({
      startsOn: shift(route.startsOn),
      endsOn: shift(route.endsOn),
      day: "",
      dayMemberId: "",
    });
  }
  return (
    <div className="delivery-scheduling">
      <div className="delivery-schedule-section-heading delivery-schedule-mode">
        <Segmented
          aria-label={
            view === "team" ? tr("calendarTitle") : tr("timelineTitle")
          }
          value={mode}
          options={(view === "team"
            ? ["members", "capacity"]
            : ["milestones", "dependencies"]
          ).map((key) => ({ value: key, label: tr(key) }))}
          onChange={(value) =>
            changeRoute(
              view === "team"
                ? { view, teamMode: value as SchedulingRoute["teamMode"] }
                : {
                    view,
                    timelineMode: value as SchedulingRoute["timelineMode"],
                  },
            )
          }
        />
        <div className="delivery-actions">
          {view === "team" ? (
            <>
              <Button href="#/projects">{tr("people")}</Button>
              <Button
                icon={<Plus size={14} />}
                disabled={!workspace.permissions.configure}
                onClick={() => onEditMember()}
              >
                {tr("addMember")}
              </Button>
            </>
          ) : (
            <Button
              icon={<Plus size={14} />}
              disabled={!workspace.permissions.write}
              onClick={() => onEditMilestone()}
            >
              {t("delivery.addMilestone")}
            </Button>
          )}
          <Button
            aria-label={t("common.refresh")}
            icon={<RefreshCw size={14} />}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
            disabled={Boolean(problem)}
          />
        </div>
      </div>
      <p className="delivery-hint">{tr("projectScope")}</p>
      {detailed && (
        <>
          <div className="delivery-schedule-filters">
            <label>
              <span>{tr("startsOn")}</span>
              <Input
                type="date"
                aria-label={tr("startsOn")}
                value={dates.startsOn}
                onChange={(event) =>
                  setDates((current) => ({
                    ...current,
                    startsOn: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>{tr("endsOn")}</span>
              <Input
                type="date"
                aria-label={tr("endsOn")}
                value={dates.endsOn}
                onChange={(event) =>
                  setDates((current) => ({
                    ...current,
                    endsOn: event.target.value,
                  }))
                }
              />
            </label>
            <Button
              disabled={Boolean(draftProblem)}
              onClick={() =>
                changeRoute({ ...dates, day: "", dayMemberId: "" })
              }
            >
              {tr("applyRange")}
            </Button>
            <div className="delivery-actions delivery-schedule-period">
              <Button
                aria-label={tr("previous")}
                icon={<ChevronLeft size={15} />}
                onClick={() => shiftRange(-1)}
                disabled={Boolean(problem)}
              />
              <Button
                onClick={() =>
                  changeRoute({
                    ...defaultSchedulingRange(),
                    day: "",
                    dayMemberId: "",
                  })
                }
              >
                {tr("today")}
              </Button>
              <Button
                aria-label={tr("next")}
                icon={<ChevronRight size={15} />}
                onClick={() => shiftRange(1)}
                disabled={Boolean(problem)}
              />
            </div>
            <label>
              <span>{tr("member")}</span>
              <Select
                aria-label={tr("member")}
                value={route.memberId}
                options={[
                  { value: "", label: tr("allMembers") },
                  ...(data?.resources || []).map((resource) => ({
                    value: resource.id,
                    label: `${resource.name} · ${tr(`kinds.${resource.kind || "unknown"}`)}`,
                  })),
                ]}
                onChange={(memberId) => changeRoute({ memberId })}
              />
            </label>
            <label>
              <span>{tr("milestone")}</span>
              <Select
                aria-label={tr("milestone")}
                value={route.milestoneId}
                options={[
                  { value: "", label: tr("allMilestones") },
                  ...(data?.milestones || []).map((milestone) => ({
                    value: milestone.id,
                    label: milestone.title,
                  })),
                ]}
                onChange={(milestoneId) => changeRoute({ milestoneId })}
              />
            </label>
            <label>
              <span>{tr("sprint")}</span>
              <Select
                aria-label={tr("sprint")}
                value={route.sprintId}
                options={[
                  { value: "", label: tr("allSprints") },
                  ...(data?.sprints || []).map((sprint) => ({
                    value: sprint.id,
                    label: sprint.title,
                  })),
                ]}
                onChange={(sprintId) => changeRoute({ sprintId })}
              />
            </label>
            <label>
              <span>{tr("issue")}</span>
              <Select
                aria-label={tr("issue")}
                value={route.issue}
                options={[
                  { value: "", label: tr("allIssues") },
                  ...Object.keys(data?.summary.issues_by_code || {}).map(
                    (code) => ({
                      value: code,
                      label: `${tr(`issues.${code}`, { defaultValue: code })} (${data?.summary.issues_by_code[code]})`,
                    }),
                  ),
                ]}
                onChange={(issue) => changeRoute({ issue })}
              />
            </label>
            <Input.Search
              aria-label={tr("search")}
              placeholder={tr("search")}
              value={search}
              allowClear
              onChange={(event) => {
                setSearch(event.target.value);
                if (!event.target.value) changeRoute({ search: "" });
              }}
              onSearch={() => changeRoute({ search })}
            />
            <Button
              type="text"
              onClick={() =>
                changeRoute({
                  memberId: "",
                  milestoneId: "",
                  sprintId: "",
                  issue: "",
                  search: "",
                })
              }
            >
              {tr("reset")}
            </Button>
          </div>
          {draftProblem && (
            <Alert type="warning" showIcon title={tr(draftProblem)} />
          )}
        </>
      )}
      {problem && <Alert type="error" showIcon title={tr(problem)} />}
      {query.error && (
        <Alert
          type="error"
          showIcon
          title={tr(data ? "stale" : "readFailed")}
          description={query.error.message}
          action={
            <Button onClick={() => void query.refetch()}>{tr("retry")}</Button>
          }
        />
      )}
      {actionError && (
        <Alert
          type="error"
          showIcon
          title={actionError}
          closable
          onClose={() => {
            setActionError("");
            if (route.editTaskId) changeRoute({ editTaskId: "" }, true);
          }}
        />
      )}
      {saved && (
        <Alert
          type="success"
          showIcon
          title={tr("saveSuccess")}
          closable
          onClose={() => setSaved(false)}
        />
      )}
      {query.isPending && !problem && (
        <Skeleton active paragraph={{ rows: 6 }} />
      )}
      {data && !problem && (
        <>
          <div className="delivery-schedule-source">
            <span>{progressDateTime(data.as_of, i18n.language)} UTC</span>
            <span>
              {tr("visibleCount", {
                visible: tasks.length,
                total: data.summary.tasks_total,
              })}
            </span>
            {detailed && <Tag>UTC</Tag>}
          </div>
          {detailed && (
            <>
              <div className="delivery-schedule-metrics">
                {(
                  [
                    ["activeTasks", data.summary.active_tasks],
                    ["verifiedTasks", data.summary.verified_tasks],
                    ["incompleteTasks", data.summary.incomplete_tasks],
                    ["overloadedCells", data.summary.overloaded_cells],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key}>
                    <span>{tr(key)}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p className="delivery-hint">
                {tr("fullLoadHint")} {tr("unitsHint")}
              </p>
            </>
          )}
          {mode === "capacity" && (
            <DeliveryCapacityCalendar
              resources={resources}
              visibleTaskIds={visibleIds}
              onCell={(dayMemberId, day) => changeRoute({ dayMemberId, day })}
            />
          )}
          {mode === "dependencies" && (
            <>
              <div className="delivery-schedule-section-heading">
                <div>
                  <strong>
                    {tr("selectedCount", { count: selectedIds.length })}
                  </strong>
                  {selectedIds.some((id) => !visibleIds.includes(id)) && (
                    <small>
                      {" "}
                      ·{" "}
                      {tr("outsideSelected", {
                        count: selectedIds.filter(
                          (id) => !visibleIds.includes(id),
                        ).length,
                      })}
                    </small>
                  )}
                </div>
                <div className="delivery-actions">
                  <Button
                    type="text"
                    disabled={!selectedIds.length}
                    onClick={() => setSelectedIds([])}
                  >
                    {tr("clearSelection")}
                  </Button>
                  <Button
                    type="primary"
                    disabled={
                      !data.permissions.write ||
                      query.isError ||
                      !selectedIds.length ||
                      selectedIds.length > 200
                    }
                    onClick={() => openTasks(selectedIds)}
                  >
                    {tr("editSelected")}
                  </Button>
                </div>
              </div>
              <DeliveryDependencyTimeline
                tasks={tasks}
                allTasks={data.tasks}
                range={data.range}
                selectedIds={selectedIds}
                onSelection={setSelectedIds}
                onTask={openTask}
                onEdit={editTask}
                canEdit={data.permissions.write && !query.isError}
              />
            </>
          )}
          {mode === "members" && (
            <>
              <p className="delivery-hint">
                {tr("toolsHint")} {tr("unitsHint")}
              </p>
              <div className="delivery-schedule-members">
                {workspace.members.map((member) => {
                  const resource = data.resources.find(
                    (item) => item.id === member.id,
                  );
                  const Icon =
                    member.kind === "human"
                      ? Users
                      : member.kind === "agent"
                        ? Bot
                        : Wrench;
                  return (
                    <article key={member.id}>
                      <div className="delivery-schedule-member-heading">
                        <span>
                          <Icon size={20} />
                        </span>
                        <div>
                          <h3>{member.name}</h3>
                          <small>
                            {tr(`kinds.${member.kind}`)} · {member.role}
                          </small>
                        </div>
                        <Tag>
                          {member.active ? tr("registered") : tr("inactive")}
                        </Tag>
                      </div>
                      {member.tool && <p>{member.tool}</p>}
                      <p>
                        <CalendarDays size={14} />{" "}
                        {resource?.calendar ? tr("weekly") : tr("noCalendar")} ·{" "}
                        {tr(
                          `units.${resource?.unit === "hours" ? "hoursPerDay" : resource?.unit === "slots" ? "slotsPerDay" : "unknown"}`,
                        )}
                      </p>
                      <div className="delivery-actions">
                        <Button
                          size="small"
                          disabled={
                            !data.permissions.configure ||
                            !member.active ||
                            !resource?.kind ||
                            query.isError
                          }
                          onClick={() => openCalendar(member.id)}
                        >
                          {tr("configure")}
                        </Button>
                        {member.kind !== "human" && (
                          <Button
                            size="small"
                            type="text"
                            disabled={!workspace.permissions.configure}
                            onClick={() => onEditMember(member)}
                          >
                            {tr("editMember")}
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
          {mode === "milestones" &&
            (workspace.milestones.length ? (
              <div className="delivery-scheduling-milestones">
                {[...workspace.milestones]
                  .sort((a, b) =>
                    (a.ends_on || "9999").localeCompare(b.ends_on || "9999"),
                  )
                  .map((milestone) => {
                    const related = data.tasks.filter(
                      (task) => task.milestone_id === milestone.id,
                    );
                    const verified = related.filter(
                      (task) => task.verified,
                    ).length;
                    return (
                      <article key={milestone.id}>
                        <div className="delivery-schedule-section-heading">
                          <div>
                            <h3>{milestone.title}</h3>
                            <small>
                              {milestone.starts_on || "—"} →{" "}
                              {milestone.ends_on || "—"}
                            </small>
                          </div>
                          <div className="delivery-actions">
                            <Button
                              size="small"
                              onClick={() =>
                                changeRoute({
                                  view: "timeline",
                                  timelineMode: "dependencies",
                                  milestoneId: milestone.id,
                                })
                              }
                            >
                              {tr("dependencies")}
                            </Button>
                            <Button
                              size="small"
                              type="text"
                              disabled={!workspace.permissions.write}
                              onClick={() => onEditMilestone(milestone)}
                            >
                              {t("delivery.editMilestone")}
                            </Button>
                          </div>
                        </div>
                        <p>
                          {workspace.members.find(
                            (member) => member.id === milestone.owner_id,
                          )?.name || t("delivery.unassigned")}{" "}
                          · {tr("verifiedTasks")} {verified}/{related.length}
                        </p>
                        <Progress
                          percent={
                            related.length
                              ? Math.round((verified / related.length) * 100)
                              : 0
                          }
                          size="small"
                          showInfo={false}
                        />
                      </article>
                    );
                  })}
              </div>
            ) : (
              <Empty description={t("delivery.noMilestones")} />
            ))}
        </>
      )}
      <Drawer
        open={Boolean(route.day && route.dayMemberId && !hasTaskInspector)}
        title={tr("dayTitle", {
          resource: dayResource?.name || route.dayMemberId,
          date: route.day,
        })}
        onClose={() => changeRoute({ day: "", dayMemberId: "" })}
        width={560}
        className="delivery-inspector delivery-schedule-day"
        destroyOnHidden
      >
        {!day || !dayResource ? (
          <Alert type="info" title={tr("missingResource")} />
        ) : (
          <>
            <div className="delivery-schedule-day-values">
              <div>
                <span>{tr("activeLoad")}</span>
                <strong>
                  {day.active_load}{" "}
                  <small>{tr(`units.${dayResource.unit || "unknown"}`)}</small>
                </strong>
              </div>
              <div>
                <span>{tr("available")}</span>
                <strong>
                  {day.available === null ? tr("unknown") : day.available}
                </strong>
              </div>
            </div>
            <p className="delivery-hint">
              {tr("totalReserved")}: {day.total_reserved}{" "}
              {tr(`units.${dayResource.unit || "unknown"}`)} ·{" "}
              {tr("fullLoadHint")}
            </p>
            {day.incomplete && (
              <Alert
                type="warning"
                showIcon
                title={tr("incomplete")}
                description={tr("unregistered", {
                  count: day.unregistered_count,
                })}
              />
            )}
            {day.overload !== null && day.overload > 0 && (
              <Alert
                type="error"
                showIcon
                title={tr("overload", {
                  amount: `${day.overload} ${tr(`units.${dayResource.unit || "unknown"}`)}`,
                })}
              />
            )}
            <Button
              disabled={
                !data?.permissions.configure ||
                !dayResource.active ||
                !dayResource.kind ||
                query.isError
              }
              onClick={() => openCalendar(dayResource.id)}
            >
              {tr("configure")}
            </Button>
            <h3>{tr("taskContributions")}</h3>
            {!day.contributions.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={tr("noReservations")}
              />
            )}
            <div className="delivery-schedule-day-tasks">
              {day.contributions.map((contribution) => (
                <article key={contribution.task_id}>
                  <div>
                    <strong>{contribution.title}</strong>
                    <small>
                      {contribution.task_id} · {contribution.quantity}{" "}
                      {tr(`units.${dayResource.unit || "unknown"}`)}
                    </small>
                    {!visibleIds.includes(contribution.task_id) && (
                      <Tag>{tr("outsideFilter")}</Tag>
                    )}
                    {!contribution.active && (
                      <Tag color="success">{tr("returned")}</Tag>
                    )}
                  </div>
                  <div className="delivery-actions">
                    <Button
                      size="small"
                      onClick={() => openTask(contribution.task_id)}
                    >
                      {tr("openTask")}
                    </Button>
                    <Button
                      size="small"
                      type="text"
                      disabled={!data?.permissions.write || query.isError}
                      onClick={() => editTask(contribution.task_id)}
                    >
                      {tr("adjustTask")}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
            {data && day.unregistered_count > 0 && (
              <div className="delivery-schedule-unregistered">
                {data.tasks
                  .filter(
                    (task) =>
                      task.owner_id === dayResource.id &&
                      task.issues.some(
                        (issue) => issue.code === "owner_allocation_missing",
                      ),
                  )
                  .map((task) => (
                    <Button
                      key={task.id}
                      type="link"
                      onClick={() => editTask(task.id)}
                    >
                      {task.title} · {tr("noReservations")}
                    </Button>
                  ))}
              </div>
            )}
          </>
        )}
      </Drawer>
      {editor && (
        <DeliveryScheduleEditor
          initial={editor}
          onClose={closeEditor}
          onSaved={saveResult}
        />
      )}
    </div>
  );
}
