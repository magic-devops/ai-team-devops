import {
  Alert,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Select,
  Tag,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { saveDelivery, type DeliveryCommandAck } from "@/lib/delivery";
import {
  adoptSchedulingBasis,
  allocationSummary,
  fetchDeliverySchedule,
  openMemberCalendar,
  prepareSchedulingCommand,
  previewDeliverySchedule,
  schedulingError,
  schedulingPayload,
  schedulingRangeProblem,
  type ScheduleAllocationDraft,
  type SchedulingSession,
  type SchedulePreview,
  type DeliverySchedule,
} from "@/lib/deliveryScheduling";

export function CalendarFields({
  session,
  busy,
  onChange,
  readOnly = false,
}: {
  session: Extract<SchedulingSession, { kind: "calendar" }>;
  busy: boolean;
  readOnly?: boolean;
  onChange: (session: SchedulingSession) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliverySchedule.${key}`);
  const resource = session.snapshot.resources.find(
    (item) => item.id === session.memberId,
  )!;
  const hours = resource.unit === "hours";
  return (
    <div className="delivery-calendar-fields">
      <div className="delivery-schedule-section-heading">
        <h3>
          {resource.name}{" "}
          <Tag>{tr(`units.${hours ? "hoursPerDay" : "slotsPerDay"}`)}</Tag>
        </h3>
        {!readOnly && (
          <div className="delivery-actions">
            <Button
              size="small"
              disabled={busy || readOnly}
              onClick={() =>
                onChange({
                  ...session,
                  weekly: [0, 1, 2, 3, 4, 5, 6].map((day) =>
                    day < 5 ? (hours ? 8 : 1) : 0,
                  ),
                })
              }
            >
              {tr("workdayPreset")}
            </Button>
            <Button
              size="small"
              disabled={busy || readOnly}
              onClick={() =>
                onChange({
                  ...session,
                  weekly: Array<number | null>(7).fill(null),
                })
              }
            >
              {tr("clearWeek")}
            </Button>
          </div>
        )}
      </div>
      <h4>{tr("weekly")}</h4>
      <p className="delivery-hint">{tr("weeklyHint")}</p>
      <div className="delivery-calendar-week">
        {session.weekly.map((quantity, day) => (
          <label key={day}>
            <span>{tr(`weekdaysLabels.${day}`)}</span>
            <InputNumber
              aria-label={tr(`weekdaysLabels.${day}`)}
              min={0}
              max={hours ? 24 : 100}
              step={hours ? 0.5 : 1}
              value={quantity}
              placeholder={tr("unknown")}
              disabled={busy || readOnly}
              onChange={(value) =>
                onChange({
                  ...session,
                  weekly: session.weekly.map((old, index) =>
                    index === day ? value : old,
                  ),
                })
              }
            />
          </label>
        ))}
      </div>
      <div className="delivery-schedule-section-heading">
        <h4>
          {tr("exceptions")} <small>{session.exceptions.length}/366</small>
        </h4>
        {!readOnly && (
          <Button
            size="small"
            disabled={busy || session.exceptions.length >= 366}
            onClick={() =>
              onChange({
                ...session,
                exceptions: [
                  ...session.exceptions,
                  { date: "", available: null, note: "" },
                ],
              })
            }
          >
            {tr("addException")}
          </Button>
        )}
      </div>
      <p className="delivery-hint">{tr("exceptionsHint")}</p>
      <div className="delivery-calendar-exceptions">
        {session.exceptions.map((exception, index) => {
          const patch = (values: Partial<typeof exception>) =>
            onChange({
              ...session,
              exceptions: session.exceptions.map((old, position) =>
                position === index ? { ...old, ...values } : old,
              ),
            });
          return (
            <article key={index}>
              <label>
                <span>{tr("date")}</span>
                <Input
                  type="date"
                  aria-label={`${tr("date")} ${index + 1}`}
                  value={exception.date}
                  disabled={busy || readOnly}
                  onChange={(event) => patch({ date: event.target.value })}
                />
              </label>
              <label>
                <span>{tr("available")}</span>
                <InputNumber
                  aria-label={`${tr("available")} ${index + 1}`}
                  value={exception.available}
                  placeholder={tr("unknown")}
                  min={0}
                  max={hours ? 24 : 100}
                  step={hours ? 0.5 : 1}
                  disabled={busy || readOnly}
                  onChange={(available) => patch({ available })}
                />
              </label>
              <label>
                <span>{tr("note")}</span>
                <Input
                  aria-label={`${tr("note")} ${index + 1}`}
                  value={exception.note}
                  maxLength={2000}
                  disabled={busy || readOnly}
                  onChange={(event) => patch({ note: event.target.value })}
                />
              </label>
              {!readOnly && (
                <Button
                  size="small"
                  danger
                  disabled={busy || readOnly}
                  aria-label={`${tr("remove")} ${exception.date || index + 1}`}
                  onClick={() =>
                    onChange({
                      ...session,
                      exceptions: session.exceptions.filter(
                        (_old, position) => position !== index,
                      ),
                    })
                  }
                >
                  {tr("remove")}
                </Button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function ReservationFields({
  session,
  busy,
  onChange,
}: {
  session: Extract<SchedulingSession, { kind: "tasks" }>;
  busy: boolean;
  onChange: (session: SchedulingSession) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliverySchedule.${key}`);
  const change = (
    index: number,
    patch: Partial<(typeof session.changes)[number]>,
  ) =>
    onChange({
      ...session,
      changes: session.changes.map((old, position) =>
        position === index ? { ...old, ...patch } : old,
      ),
    });
  return (
    <div className="delivery-reservation-fields">
      <p className="delivery-hint">{tr("reservationsHint")}</p>
      {session.changes.map((item, index) => {
        const task = session.snapshot.tasks.find(
          (row) => row.id === item.task_id,
        )!;
        const reservations = item.allocations || [];
        const patchAllocation = (
          position: number,
          patch: Partial<ScheduleAllocationDraft>,
        ) =>
          change(index, {
            allocations: reservations.map((old, offset) =>
              offset === position ? { ...old, ...patch } : old,
            ),
          });
        return (
          <details
            className="delivery-reservation-task"
            key={item.task_id}
            open
          >
            <summary>
              <strong>{task.title}</strong>
              <small>{task.id}</small>
            </summary>
            <div className="delivery-reservation-dates">
              <label>
                <span>{tr("startsOn")}</span>
                <Input
                  type="date"
                  aria-label={`${tr("startsOn")} ${task.title}`}
                  value={item.starts_on || ""}
                  disabled={busy}
                  onChange={(event) =>
                    change(index, { starts_on: event.target.value || null })
                  }
                />
              </label>
              <label>
                <span>{tr("endsOn")}</span>
                <Input
                  type="date"
                  aria-label={`${tr("endsOn")} ${task.title}`}
                  value={item.ends_on || ""}
                  disabled={busy}
                  onChange={(event) =>
                    change(index, { ends_on: event.target.value || null })
                  }
                />
              </label>
            </div>
            <div className="delivery-schedule-section-heading">
              <h4>
                {tr("reservations")} <small>{reservations.length}/80</small>
              </h4>
              <Button
                size="small"
                disabled={busy || reservations.length >= 80}
                onClick={() =>
                  change(index, {
                    allocations: [
                      ...reservations,
                      {
                        member_id: "",
                        starts_on: item.starts_on || "",
                        ends_on: item.ends_on || "",
                        quantity_per_day: null,
                        weekdays: [],
                      },
                    ],
                  })
                }
              >
                {tr("addReservation")}
              </Button>
            </div>
            {!reservations.length && (
              <p className="delivery-hint">{tr("noReservations")}</p>
            )}
            {reservations.map((allocation, position) => {
              const resource = session.snapshot.resources.find(
                (row) => row.id === allocation.member_id,
              );
              const hours = resource?.unit === "hours";
              const label = `${task.title} ${position + 1}`;
              return (
                <article
                  className="delivery-reservation-segment"
                  key={position}
                >
                  <div className="delivery-schedule-section-heading">
                    <span>
                      {position + 1}.{" "}
                      {resource?.name || allocation.member_id || tr("member")}
                    </span>
                    <Button
                      size="small"
                      danger
                      disabled={busy}
                      aria-label={`${tr("removeReservation")} ${label}`}
                      onClick={() =>
                        change(index, {
                          allocations: reservations.filter(
                            (_old, offset) => offset !== position,
                          ),
                        })
                      }
                    >
                      {tr("remove")}
                    </Button>
                  </div>
                  <div className="delivery-reservation-inputs">
                    <label>
                      <span>{tr("reservationResource")}</span>
                      <Select
                        aria-label={`${tr("reservationResource")} ${label}`}
                        value={allocation.member_id || undefined}
                        disabled={busy}
                        showSearch
                        optionFilterProp="label"
                        options={session.snapshot.resources
                          .filter((row) => row.kind && row.active)
                          .map((row) => ({
                            value: row.id,
                            label: `${row.name} · ${tr(`kinds.${row.kind}`)}`,
                          }))}
                        onChange={(member_id) =>
                          patchAllocation(position, {
                            member_id,
                            quantity_per_day: null,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>
                        {tr("quantity")} ·{" "}
                        {tr(
                          `units.${resource?.unit ? (hours ? "hoursPerDay" : "slotsPerDay") : "unknown"}`,
                        )}
                      </span>
                      <InputNumber
                        aria-label={`${tr("quantity")} ${label}`}
                        value={allocation.quantity_per_day}
                        min={hours ? 0.5 : 1}
                        max={hours ? 24 : 100}
                        step={hours ? 0.5 : 1}
                        disabled={busy || !resource?.active}
                        onChange={(quantity_per_day) =>
                          patchAllocation(position, { quantity_per_day })
                        }
                      />
                    </label>
                  </div>
                  <div className="delivery-reservation-dates">
                    <label>
                      <span>{tr("startsOn")}</span>
                      <Input
                        type="date"
                        aria-label={`${tr("startsOn")} ${tr("reservations")} ${label}`}
                        value={allocation.starts_on}
                        disabled={busy}
                        onChange={(event) =>
                          patchAllocation(position, {
                            starts_on: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>{tr("endsOn")}</span>
                      <Input
                        type="date"
                        aria-label={`${tr("endsOn")} ${tr("reservations")} ${label}`}
                        value={allocation.ends_on}
                        disabled={busy}
                        onChange={(event) =>
                          patchAllocation(position, {
                            ends_on: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="delivery-reservation-weekdays">
                    <span>{tr("weekdays")}</span>
                    <Checkbox.Group
                      aria-label={`${tr("weekdays")} ${label}`}
                      value={allocation.weekdays}
                      disabled={busy}
                      options={[0, 1, 2, 3, 4, 5, 6].map((day) => ({
                        value: day,
                        label: tr(`weekdaysLabels.${day}`),
                      }))}
                      onChange={(weekdays) =>
                        patchAllocation(position, {
                          weekdays: weekdays as number[],
                        })
                      }
                    />
                    <div className="delivery-actions">
                      <Button
                        size="small"
                        type="text"
                        disabled={busy}
                        onClick={() =>
                          patchAllocation(position, {
                            weekdays: [0, 1, 2, 3, 4],
                          })
                        }
                      >
                        {tr("workdays")}
                      </Button>
                      <Button
                        size="small"
                        type="text"
                        disabled={busy}
                        onClick={() =>
                          patchAllocation(position, {
                            weekdays: [0, 1, 2, 3, 4, 5, 6],
                          })
                        }
                      >
                        {tr("allDays")}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </details>
        );
      })}
    </div>
  );
}

export function SchedulePreviewDetails({
  preview,
  session,
}: {
  preview: SchedulePreview;
  session: SchedulingSession;
}) {
  const { t } = useTranslation();
  const tr = (key: string, values?: Record<string, unknown>) =>
    t(`deliverySchedule.${key}`, values);
  return (
    <section className="delivery-schedule-preview" aria-label={tr("preview")}>
      <Alert
        type="info"
        showIcon
        title={tr("previewOnly")}
        description={tr("affected", {
          count: preview.affected_task_ids.length,
        })}
      />
      {preview.changes.map((change) => (
        <article key={change.task_id}>
          <h4>{change.title}</h4>
          <small>{change.task_id}</small>
          <div className="delivery-schedule-comparison">
            {(["before", "after"] as const).map((key) => (
              <div key={key}>
                <b>{tr(key)}</b>
                <p>
                  {change[key].starts_on || "—"} → {change[key].ends_on || "—"}
                </p>
                <p className="delivery-schedule-multiline">
                  {allocationSummary(
                    change[key].allocations,
                    session.snapshot.resources,
                    t,
                  )}
                </p>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function formProblems(session: SchedulingSession): string[] {
  const problems = new Set<string>();
  const validDate = (value: string) => !schedulingRangeProblem(value, value);
  const validQuantity = (value: unknown, hours: boolean, reservation = false) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= (reservation ? (hours ? 0.5 : 1) : 0) &&
    value <= (hours ? 24 : 100) &&
    (hours ? Number.isInteger(value * 2) : Number.isInteger(value));
  if (session.kind === "calendar") {
    const hours =
      session.snapshot.resources.find((item) => item.id === session.memberId)
        ?.unit === "hours";
    if (
      session.weekly.length !== 7 ||
      [
        ...session.weekly,
        ...session.exceptions.map((item) => item.available),
      ].some((value) => value !== null && !validQuantity(value, hours))
    )
      problems.add("calendar_quantity_invalid");
    if (
      session.exceptions.some((item) => !validDate(item.date)) ||
      new Set(session.exceptions.map((item) => item.date)).size !==
        session.exceptions.length
    )
      problems.add("calendar_exceptions_invalid");
  } else
    for (const change of session.changes) {
      if (
        (change.starts_on && !validDate(change.starts_on)) ||
        (change.ends_on && !validDate(change.ends_on)) ||
        (change.starts_on &&
          change.ends_on &&
          change.starts_on > change.ends_on)
      )
        problems.add("allocation_dates_invalid");
      for (const item of change.allocations || []) {
        const member = session.snapshot.resources.find(
          (row) => row.id === item.member_id,
        );
        if (!member?.active || !member.kind || !member.unit)
          problems.add("allocation_member_unavailable");
        if (
          !validQuantity(item.quantity_per_day, member?.unit === "hours", true)
        )
          problems.add("allocation_quantity_invalid");
        if (
          !item.weekdays.length ||
          new Set(item.weekdays).size !== item.weekdays.length
        )
          problems.add("allocation_empty_days");
        if (
          !validDate(item.starts_on) ||
          !validDate(item.ends_on) ||
          item.starts_on > item.ends_on ||
          !change.starts_on ||
          !change.ends_on ||
          item.starts_on < change.starts_on ||
          item.ends_on > change.ends_on
        )
          problems.add("allocation_dates_invalid");
      }
    }
  return [...problems];
}

export function DeliveryScheduleEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: SchedulingSession;
  onClose: () => void;
  onSaved: (workspace: DeliveryCommandAck) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, values?: Record<string, unknown>) =>
    t(`deliverySchedule.${key}`, values);
  const [session, setSession] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<DeliverySchedule | null>(null);
  const [canAdopt, setCanAdopt] = useState(false);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewSignature, setPreviewSignature] = useState("");
  const payloadSignature = JSON.stringify(schedulingPayload(session));
  const checked =
    session.kind === "calendar" ||
    Boolean(preview && previewSignature === payloadSignature);
  function report(failure: unknown) {
    const parsed = schedulingError(failure);
    setError(
      parsed.conflict
        ? tr("conflict")
        : tr(`errors.${parsed.code}`, { defaultValue: parsed.message }),
    );
    setConflict(parsed.conflict);
    setLatest(null);
    setCanAdopt(false);
  }
  function validate() {
    const problems = formProblems(session);
    if (problems.length) {
      setError(problems.map((code) => tr(`errors.${code}`)).join(" "));
      return false;
    }
    return true;
  }
  async function inspect() {
    if (busy || !validate()) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setPreviewSignature("");
    try {
      const result = await previewDeliverySchedule(session);
      setPreview(result);
      setPreviewSignature(payloadSignature);
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (busy || conflict || !checked || !validate()) return;
    const prepared = prepareSchedulingCommand(session);
    setSession(prepared.session);
    setBusy(true);
    setError("");
    try {
      onSaved(
        await saveDelivery(
          session.projectId,
          prepared.action,
          prepared.payload,
          prepared.version,
          prepared.key,
        ),
      );
      onClose();
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(false);
    }
  }
  async function readLatest() {
    setBusy(true);
    setLatest(null);
    setCanAdopt(false);
    try {
      const data = await fetchDeliverySchedule(session.projectId, {
        startsOn: session.snapshot.range.starts_on,
        endsOn: session.snapshot.range.ends_on,
      });
      setLatest(data);
      try {
        adoptSchedulingBasis(session, data, "check-only");
        setCanAdopt(true);
      } catch {
        setError(
          tr(session.kind === "calendar" ? "missingResource" : "missingTask"),
        );
      }
    } catch (failure) {
      setError(schedulingError(failure).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      className="delivery-schedule-editor"
      width={900}
      title={tr(session.kind === "calendar" ? "calendarEdit" : "taskEdit")}
      onCancel={() => {
        if (!busy) onClose();
      }}
      onOk={() => void save()}
      okText={tr("save")}
      cancelText={tr("cancel")}
      confirmLoading={busy}
      okButtonProps={{ disabled: conflict || !checked }}
      cancelButtonProps={{ disabled: busy }}
      closable={!busy}
      keyboard={!busy}
      maskClosable={false}
      destroyOnHidden
    >
      <p className="delivery-hint">{tr("currentBasis")}</p>
      <div className="delivery-schedule-fixed">
        <span>
          {tr("version")}: {session.version}
        </span>
      </div>
      {error && <Alert type="error" showIcon title={error} />}
      {conflict && (
        <section className="delivery-schedule-conflict">
          <Button loading={busy} onClick={() => void readLatest()}>
            {tr("readLatest")}
          </Button>
          {latest && (
            <>
              <h4>
                {tr("latestFacts")} · {tr("version")} {latest.version}
              </h4>
              {session.kind === "tasks"
                ? session.changes.map((change) => {
                    const task = latest.tasks.find(
                      (item) => item.id === change.task_id,
                    );
                    return (
                      <article key={change.task_id}>
                        <strong>{task?.title || change.task_id}</strong>
                        {task ? (
                          <>
                            <p>
                              {task.starts_on || "—"} → {task.ends_on || "—"} ·{" "}
                              {task.owner_name || task.owner_id || "—"}
                            </p>
                            <p className="delivery-schedule-multiline">
                              {allocationSummary(
                                task.allocations,
                                latest.resources,
                                t,
                              )}
                            </p>
                          </>
                        ) : (
                          <p>{tr("missingTask")}</p>
                        )}
                      </article>
                    );
                  })
                : (() => {
                    const resource = latest.resources.find(
                      (item) => item.id === session.memberId,
                    );
                    if (!resource?.active || !resource.kind || !resource.unit)
                      return <p>{tr("missingResource")}</p>;
                    const current = openMemberCalendar(
                      latest,
                      session.memberId,
                      "facts-only",
                    );
                    return current.kind === "calendar" ? (
                      <CalendarFields
                        session={current}
                        busy={false}
                        readOnly
                        onChange={() => {}}
                      />
                    ) : null;
                  })()}
              <p className="delivery-hint">{tr("adoptHint")}</p>
              <Button
                disabled={busy || !canAdopt}
                onClick={() => {
                  setSession(
                    adoptSchedulingBasis(session, latest, crypto.randomUUID()),
                  );
                  setConflict(false);
                  setLatest(null);
                  setCanAdopt(false);
                  setError("");
                  setPreview(null);
                  setPreviewSignature("");
                }}
              >
                {tr("adopt")}
              </Button>
            </>
          )}
        </section>
      )}
      {session.kind === "calendar" ? (
        <CalendarFields session={session} busy={busy} onChange={setSession} />
      ) : (
        <ReservationFields
          session={session}
          busy={busy}
          onChange={(value) => {
            setSession(value);
            setPreview(null);
            setPreviewSignature("");
          }}
        />
      )}
      {session.kind === "tasks" && (
        <section className="delivery-schedule-preview-actions">
          <Button
            type="primary"
            loading={busy}
            disabled={conflict}
            onClick={() => void inspect()}
          >
            {tr("preview")}
          </Button>
          <p className="delivery-hint">
            {tr(checked ? "previewOnly" : "previewRequired")}
          </p>
        </section>
      )}
      {preview && (
        <SchedulePreviewDetails preview={preview} session={session} />
      )}
    </Modal>
  );
}
