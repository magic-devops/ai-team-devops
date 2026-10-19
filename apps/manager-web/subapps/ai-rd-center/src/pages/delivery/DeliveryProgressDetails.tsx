import { Alert, Button } from "antd";
import { useState } from "react";
import { getProjectId } from "@/lib/authStorage";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { fetchTaskDetail } from "@/lib/deliveryQuery";
import { allocationSummary } from "@/lib/deliveryScheduling";
import { useTranslation } from "react-i18next";
import {
  beginProgressExactRead,
  type ProgressSeries,
  type ProgressTask,
} from "@/lib/deliveryProgress";
import type { DeliveryInboxTarget } from "@/lib/delivery";

export function progressDateTime(
  value: string | null | undefined,
  language: string,
) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(language, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(date)
    : "—";
}
export function DeliveryProgressHistory({
  data,
  onOpen,
}: {
  data: Pick<ProgressSeries, "days" | "coverage">;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`deliveryProgress.${key}`, options);
  const futureDays = new Set(data.coverage.future_days);
  return (
    <section className="delivery-panel delivery-progress-history">
      <div className="delivery-section-heading">
        <h2>{tr("history")}</h2>
        <span>{tr("utc")}</span>
      </div>
      <p className="delivery-hint">{tr("pointHint")}</p>
      <div
        className="delivery-observation-table"
        role="table"
        aria-label={tr("history")}
      >
        <div role="row" className="delivery-observation-heading">
          <span role="columnheader">{tr("date")}</span>
          <span role="columnheader">{tr("remaining")}</span>
          <span role="columnheader">{tr("verified")}</span>
          <span role="columnheader">{tr("source")}</span>
        </div>
        {data.days.map((day) => (
          <div
            role="row"
            key={day.date}
            className={`delivery-observation-row${day.metrics ? "" : " is-missing"}`}
          >
            <div role="cell">
              {day.observation_id && day.metrics ? (
                <button
                  type="button"
                  aria-label={tr("viewObservation", { date: day.date })}
                  onClick={() => onOpen(day.observation_id!)}
                >
                  {day.date}
                </button>
              ) : (
                <span>{day.date}</span>
              )}
            </div>
            <div role="cell">
              <small className="delivery-mobile-label">{tr("remaining")}</small>
              {day.metrics?.remaining ?? "—"}
            </div>
            <div role="cell">
              <small className="delivery-mobile-label">{tr("verified")}</small>
              {day.metrics?.verified_completed ?? "—"}
            </div>
            <div role="cell">
              {day.metrics ? (
                <>
                  <span>
                    {tr(`sources.${day.source}`, {
                      defaultValue: day.source || "—",
                    })}
                  </span>
                  <small>
                    {tr("recorded")} {day.metrics.recorded_completed} ·{" "}
                    {tr("review")} {day.metrics.awaiting_review}
                  </small>
                </>
              ) : (
                <span>
                  {tr(futureDays.has(day.date) ? "future" : "missing")}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
type TaskNavigation = {
  projectId?: string;
  currentTasks?: { id: string; req_id: string }[];
  onOpenTask: (target: DeliveryInboxTarget) => void;
};
export function CurrentTaskButton({
  task,
  onOpenTask,
  projectId,
}: TaskNavigation & { task: Pick<ProgressTask, "id"> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const project = projectId || getProjectId() || "",
    owner = projectSessionKey();
  const open = async () => {
    if (owner !== projectSessionKey()) return;
    const read = beginProgressExactRead();
    setBusy(true);
    setError("");
    try {
      const detail = await fetchTaskDetail(project, task.id);
      if (
        !read.current() ||
        owner !== projectSessionKey() ||
        detail.project_id !== project ||
        detail.task.id !== task.id
      )
        return;
      onOpenTask({
        view: "progress",
        requirement_id: detail.task.req_id,
        task_id: detail.task.id,
        detail: "tasks",
      });
    } catch (failure) {
      if (read.current()) setError((failure as Error).message);
    } finally {
      if (read.current()) setBusy(false);
      read.finish();
    }
  };
  return (
    <>
      <Button size="small" loading={busy} onClick={() => void open()}>
        {t("deliveryProgress.openCurrentTask")}
      </Button>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
type ProgressComparisonView = {
  incomplete_plan_fields: string[];
  added: ProgressTask[];
  removed: ProgressTask[];
  changed: {
    id: string;
    before: ProgressTask;
    after: ProgressTask;
    fields: string[];
  }[];
};
export function DeliveryProgressComparison({
  comparison,
  currentTasks,
  onOpenTask,
  projectId,
  members = [],
}: TaskNavigation & {
  comparison: ProgressComparisonView;
  members?: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`deliveryProgress.${key}`, options);
  const fieldValue = (task: ProgressTask, field: string) => {
    if (field === "allocations")
      return allocationSummary(task.allocations, members, t);
    const value = task[field as keyof ProgressTask];
    if (field === "estimate" && value === null)
      return tr("bounded.notCaptured");
    if (
      [
        "acceptance_criteria",
        "requirement_criteria_indices",
        "acceptance",
      ].includes(field) &&
      value == null
    )
      return tr("acceptanceNotCaptured");
    if (field === "acceptance_criteria")
      return task.acceptance_criteria?.join("\n") || "—";
    if (field === "requirement_criteria_indices")
      return (
        task.requirement_criteria_indices
          ?.map((index) => tr("criterionReference", { number: index + 1 }))
          .join("\n") || "—"
      );
    if (field === "acceptance")
      return (
        task.acceptance?.sources
          .map(
            (source) =>
              `${tr(source.source === "task" ? "taskCriterion" : "requirementCriterion")}: ${source.text}`,
          )
          .join("\n") || "—"
      );
    return String(value || "—");
  };
  return (
    <div className="delivery-progress-comparison">
      <div className="delivery-section-heading">
        <h3>{tr("changes")}</h3>
      </div>
      {Boolean(comparison.incomplete_plan_fields?.length) && (
        <Alert
          type="info"
          showIcon
          title={tr(
            comparison.incomplete_plan_fields.some(
              (field) => field !== "allocations",
            )
              ? "acceptanceNotCaptured"
              : "baselineReservationsUnknown",
          )}
        />
      )}
      <p className="delivery-hint">{t("deliverySchedule.baselineHint")}</p>
      {!comparison.added.length &&
      !comparison.removed.length &&
      !comparison.changed.length ? (
        <p className="delivery-hint">
          {tr(
            comparison.incomplete_plan_fields.length
              ? "noComparableChanges"
              : "noChanges",
          )}
        </p>
      ) : (
        <>
          {(["added", "removed"] as const).map(
            (kind) =>
              comparison[kind].length > 0 && (
                <details key={kind} open>
                  <summary>
                    {tr(kind)} <b>{comparison[kind].length}</b>
                  </summary>
                  <div className="delivery-progress-task-list">
                    {comparison[kind].map((task) => (
                      <article key={task.id}>
                        <div>
                          <strong>{task.title}</strong>
                          <small>
                            {task.id} · {tr(`states.${task.status}`)}
                          </small>
                        </div>
                        <CurrentTaskButton
                          task={task}
                          projectId={projectId}
                          currentTasks={currentTasks}
                          onOpenTask={onOpenTask}
                        />
                      </article>
                    ))}
                  </div>
                </details>
              ),
          )}
          {comparison.changed.length > 0 && (
            <details open>
              <summary>
                {tr("changed")} <b>{comparison.changed.length}</b>
              </summary>
              <div className="delivery-progress-task-list">
                {comparison.changed.map((change) => (
                  <article key={change.id}>
                    <div>
                      <strong>{change.after.title}</strong>
                      <small>{change.id}</small>
                      <p>
                        <b>{tr("before")}: </b>
                        {change.before.title} ·{" "}
                        {tr(`states.${change.before.status}`)}
                      </p>
                      <p>
                        <b>{tr("after")}: </b>
                        {change.after.title} ·{" "}
                        {tr(`states.${change.after.status}`)}
                      </p>
                      <small>
                        {tr("fields")}:{" "}
                        {change.fields
                          .map((field) =>
                            tr(`changeFields.${field}`, {
                              defaultValue: field,
                            }),
                          )
                          .join(" · ")}
                      </small>
                      <dl className="delivery-progress-field-changes">
                        {change.fields.map((field) => (
                          <div key={field}>
                            <dt>
                              {tr(`changeFields.${field}`, {
                                defaultValue: field,
                              })}
                            </dt>
                            {field === "basis" ? (
                              <dd>{tr("contentBasisChanged")}</dd>
                            ) : (
                              <dd>
                                <span
                                  className={
                                    [
                                      "allocations",
                                      "acceptance_criteria",
                                      "requirement_criteria_indices",
                                      "acceptance",
                                    ].includes(field)
                                      ? "delivery-schedule-multiline"
                                      : undefined
                                  }
                                >
                                  <small>{tr("before")}</small>
                                  {fieldValue(change.before, field)}
                                </span>
                                <span
                                  className={
                                    [
                                      "allocations",
                                      "acceptance_criteria",
                                      "requirement_criteria_indices",
                                      "acceptance",
                                    ].includes(field)
                                      ? "delivery-schedule-multiline"
                                      : undefined
                                  }
                                >
                                  <small>{tr("after")}</small>
                                  {fieldValue(change.after, field)}
                                </span>
                              </dd>
                            )}
                          </div>
                        ))}
                      </dl>
                    </div>
                    <CurrentTaskButton
                      task={change.after}
                      projectId={projectId}
                      currentTasks={currentTasks}
                      onOpenTask={onOpenTask}
                    />
                  </article>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
