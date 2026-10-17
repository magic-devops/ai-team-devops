import { Button, Empty, Tag } from "antd";
import { useTranslation } from "react-i18next";
import {
  currentProgressTaskTarget,
  progressStates,
  type DeliveryProgress,
  type ProgressComparison,
  type ProgressObservation,
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
  data: DeliveryProgress;
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
  currentTasks: { id: string; req_id: string }[];
  onOpenTask: (target: DeliveryInboxTarget) => void;
};
function CurrentTaskButton({
  task,
  currentTasks,
  onOpenTask,
}: TaskNavigation & { task: ProgressTask }) {
  const { t } = useTranslation();
  const target = currentProgressTaskTarget(task.id, currentTasks);
  return target ? (
    <Button size="small" onClick={() => onOpenTask(target)}>
      {t("deliveryProgress.openCurrentTask")}
    </Button>
  ) : (
    <small className="delivery-hint">{t("deliveryProgress.deletedTask")}</small>
  );
}
export function DeliveryProgressSnapshot({
  observation,
  currentTasks,
  onOpenTask,
}: TaskNavigation & { observation: ProgressObservation }) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryProgress.${key}`);
  return (
    <div className="delivery-progress-snapshot">
      <Tag>{tr("historical")}</Tag>
      <h2>{progressDateTime(observation.observed_at, i18n.language)} UTC</h2>
      <p className="delivery-hint">{tr("scopeReadOnly")}</p>
      <dl className="delivery-facts">
        <div>
          <dt>{tr("scope")}</dt>
          <dd>{observation.scope.label}</dd>
        </div>
        <div>
          <dt>{tr("source")}</dt>
          <dd>
            {t(`deliveryProgress.sources.${observation.source}`, {
              defaultValue: observation.source,
            })}
          </dd>
        </div>
        <div>
          <dt>{tr("createdBy")}</dt>
          <dd>{observation.actor || "—"}</dd>
        </div>
        <div>
          <dt>{tr("sourceVersion")}</dt>
          <dd>{observation.source_version}</dd>
        </div>
        <div>
          <dt>{tr("taskCount")}</dt>
          <dd>{observation.current.metrics.tasks_total}</dd>
        </div>
        <div>
          <dt>{tr("verified")}</dt>
          <dd>{observation.current.metrics.verified_completed}</dd>
        </div>
        <div>
          <dt>{tr("recorded")}</dt>
          <dd>{observation.current.metrics.recorded_completed}</dd>
        </div>
        <div>
          <dt>{tr("acceptedRequirements")}</dt>
          <dd>
            {observation.current.metrics.requirements_accepted}/
            {observation.current.metrics.requirements_total}
          </dd>
        </div>
      </dl>
      <div className="delivery-state-counts">
        {progressStates.map((state) => (
          <span key={state}>
            <i className={`delivery-state-dot ${state}`} />
            {tr(`states.${state}`)}{" "}
            <b>{observation.current.metrics.status_counts[state]}</b>
          </span>
        ))}
      </div>
      <h3>{tr("historicalTask")}</h3>
      {observation.current.tasks.length ? (
        <div className="delivery-progress-task-list">
          {observation.current.tasks.map((task) => (
            <article key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <small>
                  {task.id} · {task.assigned_to || "—"} · {task.estimate || "—"}
                </small>
                <Tag>{tr(`states.${task.status}`)}</Tag>
              </div>
              <CurrentTaskButton
                task={task}
                currentTasks={currentTasks}
                onOpenTask={onOpenTask}
              />
            </article>
          ))}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={tr("noTasks")}
        />
      )}
    </div>
  );
}
export function DeliveryProgressComparison({
  comparison,
  currentTasks,
  onOpenTask,
}: TaskNavigation & { comparison: ProgressComparison }) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`deliveryProgress.${key}`, options);
  return (
    <div className="delivery-progress-comparison">
      <div className="delivery-section-heading">
        <h3>{tr("changes")}</h3>
        <small>{tr("unchanged", { count: comparison.unchanged_count })}</small>
      </div>
      {!comparison.added.length &&
      !comparison.removed.length &&
      !comparison.changed.length ? (
        <p className="delivery-hint">{tr("noChanges")}</p>
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
                                <span>
                                  <small>{tr("before")}</small>
                                  {String(
                                    change.before[
                                      field as keyof ProgressTask
                                    ] || "—",
                                  )}
                                </span>
                                <span>
                                  <small>{tr("after")}</small>
                                  {String(
                                    change.after[field as keyof ProgressTask] ||
                                      "—",
                                  )}
                                </span>
                              </dd>
                            )}
                          </div>
                        ))}
                      </dl>
                    </div>
                    <CurrentTaskButton
                      task={change.after}
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
