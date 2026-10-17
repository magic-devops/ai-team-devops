import { Bot, UserRound, Wrench, UserRoundX } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ScheduleCell, ScheduleResource } from "@/lib/deliveryScheduling";
import "./delivery-scheduling-visuals.css";

type Translate = (key: string, options?: Record<string, unknown>) => string;
const kinds = ["human", "agent", "tool", "unknown"] as const;
const icons = {
  human: UserRound,
  agent: Bot,
  tool: Wrench,
  unknown: UserRoundX,
};

function CellContent({
  resource,
  cell,
  visible,
  tr,
}: {
  resource: ScheduleResource;
  cell: ScheduleCell;
  visible: Set<string>;
  tr: Translate;
}) {
  const unit = tr(`units.${resource.unit || "unknown"}`);
  const outside = cell.contributions
    .filter((item) => item.active && !visible.has(item.task_id))
    .reduce((sum, item) => sum + item.quantity, 0);
  const ratio =
    cell.available != null && cell.available > 0
      ? Math.min(100, (cell.active_load / cell.available) * 100)
      : null;
  return (
    <>
      <span className="delivery-capacity-reading">
        <strong>{cell.active_load}</strong>
        <span>/ {cell.available ?? tr("unknown")}</span>
        <small>{unit}</small>
      </span>
      <span className="delivery-capacity-meter" aria-hidden="true">
        {ratio !== null && (
          <span
            className="delivery-capacity-fill"
            style={{ width: `${ratio}%` }}
          />
        )}
        {ratio !== null && outside > 0 && (
          <span
            className="delivery-capacity-outside-fill"
            style={{
              width: `${Math.min(100, (outside / cell.available!) * 100)}%`,
            }}
          />
        )}
      </span>
      {cell.total_reserved !== cell.active_load && (
        <small className="delivery-capacity-total">
          {tr("totalReserved")}: {cell.total_reserved} {unit}
        </small>
      )}
      <span className="delivery-capacity-flags">
        {cell.unavailable ? (
          <span>{tr("unavailable")}</span>
        ) : cell.overload != null && cell.overload > 0 ? (
          <span>{tr("overload", { amount: `${cell.overload} ${unit}` })}</span>
        ) : cell.available === 0 && cell.active_load === 0 ? (
          <span>{tr("rest")}</span>
        ) : null}
        {cell.unregistered_count > 0 ? (
          <span>{tr("unregistered", { count: cell.unregistered_count })}</span>
        ) : cell.incomplete ? (
          <span>{tr("incomplete")}</span>
        ) : null}
        {outside > 0 && (
          <span className="delivery-capacity-outside">
            {tr("outsideLoad", { amount: outside, unit })}
          </span>
        )}
      </span>
    </>
  );
}

function CapacityCell({
  resource,
  cell,
  visible,
  onCell,
  tr,
}: {
  resource: ScheduleResource;
  cell: ScheduleCell;
  visible: Set<string>;
  onCell: (resourceId: string, date: string) => void;
  tr: Translate;
}) {
  const unit = tr(`units.${resource.unit || "unknown"}`);
  const outside = cell.contributions
    .filter((item) => item.active && !visible.has(item.task_id))
    .reduce((sum, item) => sum + item.quantity, 0);
  const incomplete = cell.incomplete || cell.unregistered_count > 0;
  const state = cell.unavailable
    ? "unavailable"
    : cell.overload != null && cell.overload > 0
      ? "overload"
      : cell.available === null
        ? "unknown"
        : incomplete
          ? "incomplete"
          : cell.available === 0 && cell.active_load === 0
            ? "rest"
            : "known";
  const label = [
    tr("cellLabel", { resource: resource.name, date: cell.date }),
    `${tr("activeLoad")}: ${cell.active_load} ${unit}`,
    `${tr("available")}: ${cell.available === null ? tr("unknown") : `${cell.available} ${unit}`}`,
    `${tr("totalReserved")}: ${cell.total_reserved} ${unit}`,
    ...(cell.unavailable
      ? [tr("unavailable")]
      : cell.overload != null && cell.overload > 0
        ? [tr("overload", { amount: `${cell.overload} ${unit}` })]
        : []),
    ...(cell.unregistered_count > 0
      ? [tr("unregistered", { count: cell.unregistered_count })]
      : incomplete
        ? [tr("incomplete")]
        : []),
    ...(outside > 0 ? [tr("outsideLoad", { amount: outside, unit })] : []),
  ].join("; ");
  return (
    <button
      type="button"
      className="delivery-capacity-cell"
      data-capacity-state={state}
      data-incomplete={incomplete}
      aria-label={label}
      onClick={() => onCell(resource.id, cell.date)}
    >
      <CellContent resource={resource} cell={cell} visible={visible} tr={tr} />
    </button>
  );
}

function ResourceName({
  resource,
  tr,
}: {
  resource: ScheduleResource;
  tr: Translate;
}) {
  const Icon = icons[resource.kind || "unknown"];
  return (
    <span className="delivery-schedule-resource">
      <span className="delivery-schedule-resource-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span>
        <strong>{resource.name}</strong>
        <small>
          {tr(`units.${resource.unit ? `${resource.unit}PerDay` : "unknown"}`)}
          {!resource.active && ` · ${tr("inactive")}`}
        </small>
        {!resource.calendar && <small>{tr("noCalendar")}</small>}
        {resource.kind === null && <code>{resource.id}</code>}
      </span>
    </span>
  );
}

export function DeliveryCapacityCalendar({
  resources,
  visibleTaskIds,
  onCell,
}: {
  resources: ScheduleResource[];
  visibleTaskIds: string[];
  onCell: (resourceId: string, date: string) => void;
}) {
  const { t } = useTranslation();
  const tr: Translate = (key, options) => t(`deliverySchedule.${key}`, options);
  const visible = new Set(visibleTaskIds);
  if (!resources.length)
    return <p className="delivery-schedule-empty">{tr("noResources")}</p>;
  return (
    <div className="delivery-capacity-calendar">
      <p className="delivery-schedule-explainer">{tr("calendarLegend")}</p>
      {kinds.map((kind) => {
        const group = resources.filter(
          (resource) => (resource.kind || "unknown") === kind,
        );
        if (!group.length) return null;
        const dates = [
          ...new Set(
            group.flatMap((resource) =>
              resource.cells.map((cell) => cell.date),
            ),
          ),
        ].sort();
        const Icon = icons[kind];
        return (
          <section
            className="delivery-capacity-group"
            data-resource-kind={kind}
            key={kind}
            aria-label={tr(`kinds.${kind}`)}
          >
            <div className="delivery-schedule-group-title">
              <Icon size={16} aria-hidden="true" />
              <h3>{tr(`kinds.${kind}`)}</h3>
              <span>{group.length}</span>
              <small>
                {tr(
                  `units.${kind === "human" ? "hoursPerDay" : kind === "unknown" ? "unknown" : "slotsPerDay"}`,
                )}
              </small>
            </div>
            <div
              className="delivery-capacity-desktop delivery-schedule-scroll"
              role="region"
              aria-label={tr(`kinds.${kind}`)}
              tabIndex={0}
            >
              <table
                className="delivery-capacity-table"
                style={{ minWidth: 200 + dates.length * 108 }}
              >
                <thead>
                  <tr>
                    <th scope="col">{tr("member")}</th>
                    {dates.map((date) => (
                      <th
                        scope="col"
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
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.map((resource) => (
                    <tr key={resource.id}>
                      <th scope="row">
                        <ResourceName resource={resource} tr={tr} />
                      </th>
                      {dates.map((date) => {
                        const cell = resource.cells.find(
                          (item) => item.date === date,
                        );
                        return (
                          <td key={date}>
                            {cell ? (
                              <CapacityCell
                                resource={resource}
                                cell={cell}
                                visible={visible}
                                onCell={onCell}
                                tr={tr}
                              />
                            ) : (
                              <span>{tr("unknown")}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="delivery-capacity-mobile">
              {group.map((resource) => (
                <section
                  className="delivery-capacity-mobile-resource"
                  key={resource.id}
                  aria-label={resource.name}
                >
                  <ResourceName resource={resource} tr={tr} />
                  <ul>
                    {resource.cells.map((cell) => (
                      <li key={cell.date}>
                        <time dateTime={cell.date}>
                          {cell.date.slice(5)}
                          <small>
                            {tr(
                              `weekdaysLabels.${(new Date(`${cell.date}T00:00:00Z`).getUTCDay() + 6) % 7}`,
                            )}
                          </small>
                        </time>
                        <CapacityCell
                          resource={resource}
                          cell={cell}
                          visible={visible}
                          onCell={onCell}
                          tr={tr}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
