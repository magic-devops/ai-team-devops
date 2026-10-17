import { useId } from "react";
import { ArrowRight, CalendarDays, Link2, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ScheduleTask } from "@/lib/deliveryScheduling";
import "./delivery-scheduling-visuals.css";

type Translate = (key: string, options?: Record<string, unknown>) => string;
const dayWidth = 44;
const rowHeight = 112;
function civilTime(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
    ? time
    : null;
}
function completeDates(task: ScheduleTask): boolean {
  const start = civilTime(task.starts_on),
    end = civilTime(task.ends_on);
  return start !== null && end !== null && start <= end;
}
function dateWindow(
  task: ScheduleTask,
  startsOn: string,
  dayCount: number,
): { start: number; end: number } | null {
  const start = Math.max(
    0,
    Math.round((civilTime(task.starts_on)! - civilTime(startsOn)!) / 86400000),
  );
  const end = Math.min(
    dayCount - 1,
    Math.round((civilTime(task.ends_on)! - civilTime(startsOn)!) / 86400000),
  );
  return start <= end ? { start, end } : null;
}
function Predecessors({
  task,
  current,
  visible,
  onTask,
  tr,
}: {
  task: ScheduleTask;
  current: Map<string, ScheduleTask>;
  visible: Set<string>;
  onTask: (id: string) => void;
  tr: Translate;
}) {
  if (!task.depends_on.length) return null;
  return (
    <div className="delivery-timeline-predecessors">
      <span className="delivery-timeline-predecessor-label">
        <Link2 size={12} aria-hidden="true" />
        {tr("predecessors")}
      </span>
      {task.depends_on.map((id) => {
        const predecessor = current.get(id);
        return predecessor ? (
          <button
            type="button"
            key={id}
            data-open-task={id}
            className="delivery-timeline-predecessor"
            onClick={() => onTask(id)}
            title={`${predecessor.title} · ${id}${!visible.has(id) ? ` · ${tr("outsidePredecessor")}` : ""}`}
          >
            <span>{predecessor.title}</span>
            {!visible.has(id) && <small>{tr("outsidePredecessor")}</small>}
          </button>
        ) : (
          <span className="delivery-timeline-missing" key={id}>
            {tr("missingPredecessor")} · {id}
          </span>
        );
      })}
    </div>
  );
}
function TaskFacts({
  task,
  current,
  visible,
  selectedIds,
  onSelection,
  onTask,
  onEdit,
  canEdit,
  tr,
  status,
}: {
  task: ScheduleTask;
  current: Map<string, ScheduleTask>;
  visible: Set<string>;
  selectedIds: string[];
  onSelection: (ids: string[]) => void;
  onTask: (id: string) => void;
  onEdit: (id: string) => void;
  canEdit: boolean;
  tr: Translate;
  status: (value: string) => string;
}) {
  return (
    <>
      <div className="delivery-timeline-task-heading">
        <input
          type="checkbox"
          aria-label={tr("selectTask", { title: task.title })}
          checked={selectedIds.includes(task.id)}
          onChange={(event) =>
            onSelection(
              event.target.checked
                ? [...new Set([...selectedIds, task.id])]
                : selectedIds.filter((id) => id !== task.id),
            )
          }
        />
        <button
          type="button"
          data-open-task={task.id}
          className="delivery-timeline-task-name"
          title={task.title}
          onClick={() => onTask(task.id)}
        >
          {task.title}
        </button>
        <button
          type="button"
          className="delivery-timeline-edit"
          aria-label={`${tr("adjustTask")} · ${task.title}`}
          disabled={!canEdit}
          title={!canEdit ? tr("readOnly") : tr("adjustTask")}
          onClick={() => onEdit(task.id)}
        >
          <Pencil size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="delivery-timeline-task-meta">
        <code>{task.id}</code>
        <span>{task.owner_name || tr("issues.owner_missing")}</span>
      </div>
      <div className="delivery-timeline-task-states">
        <span
          className="delivery-timeline-status"
          data-verified={task.verified}
        >
          {status(task.delivery_status)}
        </span>
        {task.issues.map((issue, index) => (
          <span
            className="delivery-timeline-issue"
            key={`${issue.code}:${index}`}
            title={issue.message || undefined}
          >
            {tr(`issues.${issue.code}`)}
          </span>
        ))}
      </div>
      <Predecessors
        task={task}
        current={current}
        visible={visible}
        onTask={onTask}
        tr={tr}
      />
    </>
  );
}

export function DeliveryDependencyTimeline({
  tasks,
  allTasks,
  range,
  selectedIds,
  onSelection,
  onTask,
  onEdit,
  canEdit = true,
}: {
  tasks: ScheduleTask[];
  allTasks: ScheduleTask[];
  range: { starts_on: string; ends_on: string };
  selectedIds: string[];
  onSelection: (ids: string[]) => void;
  onTask: (id: string) => void;
  onEdit: (id: string) => void;
  canEdit?: boolean;
}) {
  const { t } = useTranslation();
  const tr: Translate = (key, options) => t(`deliverySchedule.${key}`, options);
  const status = (value: string) =>
    t(`deliveryProgress.states.${value}`, { defaultValue: value });
  const markerId = `delivery-dependency-${useId().replace(/:/g, "")}`;
  const first = civilTime(range.starts_on),
    last = civilTime(range.ends_on);
  if (
    first === null ||
    last === null ||
    last < first ||
    (last - first) / 86400000 >= 92
  )
    return <p className="delivery-schedule-empty">{tr("invalidDates")}</p>;
  if (!tasks.length)
    return <p className="delivery-schedule-empty">{tr("noTasks")}</p>;
  const dates = Array.from(
    { length: Math.round((last - first) / 86400000) + 1 },
    (_, index) => new Date(first + index * 86400000).toISOString().slice(0, 10),
  );
  const current = new Map(allTasks.map((task) => [task.id, task]));
  const visible = new Set(tasks.map((task) => task.id));
  const scheduled = tasks.filter(completeDates),
    unplaced = tasks.filter((task) => !completeDates(task));
  const windows = new Map(
    scheduled.map((task) => [
      task.id,
      dateWindow(task, range.starts_on, dates.length),
    ]),
  );
  const rows = new Map(scheduled.map((task, index) => [task.id, index]));
  const links = scheduled.flatMap((task) =>
    task.depends_on.flatMap((id) => {
      const from = windows.get(id),
        to = windows.get(task.id),
        fromRow = rows.get(id),
        toRow = rows.get(task.id);
      if (!from || !to || fromRow === undefined || toRow === undefined)
        return [];
      return [
        {
          predecessor: id,
          task: task.id,
          from,
          to,
          fromRow,
          toRow,
          conflict: task.issues.some(
            (issue) =>
              issue.code === "dependency_dates" &&
              (!issue.task_id || issue.task_id === id),
          ),
        },
      ];
    }),
  );
  const taskFacts = (task: ScheduleTask) => (
    <TaskFacts
      task={task}
      current={current}
      visible={visible}
      selectedIds={selectedIds}
      onSelection={onSelection}
      onTask={onTask}
      onEdit={onEdit}
      canEdit={canEdit}
      tr={tr}
      status={status}
    />
  );
  return (
    <div className="delivery-dependency-timeline">
      <div className="delivery-timeline-legend">
        {!canEdit && (
          <span className="delivery-timeline-read-only">{tr("readOnly")}</span>
        )}
        <CalendarDays size={15} aria-hidden="true" />
        <span>
          {tr("scheduledTasks")} <strong>{scheduled.length}</strong>
        </span>
        <span>
          <Link2 size={13} aria-hidden="true" />
          {tr("dependenciesCount", { count: links.length })}
        </span>
        <small>{tr("dependencyLegend")}</small>
      </div>
      <div className="delivery-timeline-desktop">
        {scheduled.length > 0 && (
          <div
            className="delivery-schedule-scroll"
            role="region"
            aria-label={tr("timelineTitle")}
            tabIndex={0}
          >
            <div
              className="delivery-timeline-board"
              style={{ width: 280 + dates.length * dayWidth }}
            >
              <div className="delivery-timeline-row-label delivery-timeline-header-label">
                {tr("scheduledTasks")}
              </div>
              <div
                className="delivery-timeline-dates"
                style={{
                  gridTemplateColumns: `repeat(${dates.length}, ${dayWidth}px)`,
                }}
              >
                {dates.map((date) => (
                  <div
                    key={date}
                    data-weekend={
                      new Date(`${date}T00:00:00Z`).getUTCDay() % 6 === 0
                    }
                  >
                    <time dateTime={date}>{date.slice(5)}</time>
                    <small>
                      {tr(
                        `weekdaysLabels.${(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7}`,
                      )}
                    </small>
                  </div>
                ))}
              </div>
              <div className="delivery-timeline-labels">
                {scheduled.map((task) => (
                  <div
                    className="delivery-timeline-row-label"
                    data-task-id={task.id}
                    key={task.id}
                    style={{ height: rowHeight }}
                  >
                    {taskFacts(task)}
                  </div>
                ))}
              </div>
              <div
                className="delivery-timeline-chart"
                style={{
                  width: dates.length * dayWidth,
                  height: scheduled.length * rowHeight,
                }}
              >
                <div
                  className="delivery-timeline-day-shading"
                  aria-hidden="true"
                >
                  {dates.map((date) => (
                    <span
                      key={date}
                      data-weekend={
                        new Date(`${date}T00:00:00Z`).getUTCDay() % 6 === 0
                      }
                      style={{ width: dayWidth }}
                    />
                  ))}
                </div>
                {scheduled.map((task) => {
                  const window = windows.get(task.id);
                  return (
                    <div
                      className="delivery-timeline-lane"
                      key={task.id}
                      style={{
                        height: rowHeight,
                        gridTemplateColumns: `repeat(${dates.length}, ${dayWidth}px)`,
                      }}
                    >
                      {window ? (
                        <button
                          type="button"
                          className="delivery-timeline-bar"
                          data-task-bar={task.id}
                          data-verified={task.verified}
                          data-conflict={task.issues.some(
                            (issue) => issue.code === "dependency_dates",
                          )}
                          data-clipped-start={task.starts_on! < range.starts_on}
                          data-clipped-end={task.ends_on! > range.ends_on}
                          style={{
                            gridColumn: `${window.start + 1} / ${window.end + 2}`,
                          }}
                          aria-label={tr("timelineTaskLabel", {
                            title: task.title,
                            id: task.id,
                            from: task.starts_on,
                            to: task.ends_on,
                          })}
                          title={`${task.title} · ${task.starts_on} → ${task.ends_on}`}
                          onClick={() => onTask(task.id)}
                        >
                          <span>{task.title}</span>
                          <small>
                            {task.starts_on!.slice(5)}{" "}
                            <ArrowRight size={10} aria-hidden="true" />{" "}
                            {task.ends_on!.slice(5)}
                          </small>
                        </button>
                      ) : (
                        <span className="delivery-timeline-outside">
                          {tr("outsideRange")} · {task.starts_on} →{" "}
                          {task.ends_on}
                        </span>
                      )}
                    </div>
                  );
                })}
                <svg
                  className="delivery-timeline-connectors"
                  width={dates.length * dayWidth}
                  height={scheduled.length * rowHeight}
                  aria-hidden="true"
                  focusable="false"
                >
                  <defs>
                    <marker
                      id={markerId}
                      viewBox="0 0 8 8"
                      refX="7"
                      refY="4"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
                    </marker>
                  </defs>
                  {links.map((link) => {
                    const fromX = Math.min(
                        dates.length * dayWidth - 3,
                        (link.from.end + 1) * dayWidth - 4,
                      ),
                      toX = link.to.start * dayWidth + 4,
                      fromY = link.fromRow * rowHeight + rowHeight / 2,
                      toY = link.toRow * rowHeight + rowHeight / 2,
                      bend = Math.min(
                        dates.length * dayWidth - 2,
                        Math.max(fromX + 9, toX - 12),
                      );
                    return (
                      <path
                        key={`${link.predecessor}:${link.task}`}
                        data-predecessor={link.predecessor}
                        data-dependent={link.task}
                        data-conflict={link.conflict}
                        d={`M ${fromX} ${fromY} H ${bend} V ${toY} H ${toX}`}
                        fill="none"
                        markerEnd={`url(#${markerId})`}
                      />
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        )}
        {unplaced.length > 0 && (
          <section className="delivery-timeline-unplaced">
            <h3>
              <CalendarDays size={15} aria-hidden="true" />
              {tr("unplaced")} <span>{unplaced.length}</span>
            </h3>
            <p className="delivery-schedule-explainer">
              {tr("partialSchedule")}
            </p>
            <div>
              {unplaced.map((task) => (
                <article key={task.id} data-task-id={task.id}>
                  {taskFacts(task)}
                  <div className="delivery-timeline-partial-dates">
                    <span>
                      {tr("from")}: {task.starts_on || "—"}
                    </span>
                    <span>
                      {tr("to")}: {task.ends_on || "—"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
      <div className="delivery-timeline-mobile">
        {tasks.map((task) => (
          <article key={task.id} data-task-id={task.id}>
            {taskFacts(task)}
            <div className="delivery-timeline-mobile-dates">
              <CalendarDays size={14} aria-hidden="true" />
              <span>{task.starts_on || "—"}</span>
              <ArrowRight size={13} aria-hidden="true" />
              <span>{task.ends_on || "—"}</span>
            </div>
            {!completeDates(task) ? (
              <p className="delivery-schedule-explainer">
                {tr("partialSchedule")}
              </p>
            ) : !dateWindow(task, range.starts_on, dates.length) ? (
              <p className="delivery-schedule-explainer">
                {tr("outsideRange")}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
