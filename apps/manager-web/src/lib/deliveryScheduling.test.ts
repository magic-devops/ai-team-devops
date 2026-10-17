import { describe, expect, it, vi } from "vitest";
import { request } from "./http";
import {
  adoptSchedulingBasis,
  defaultSchedulingRange,
  fetchDeliverySchedule,
  filterSchedulingTasks,
  openMemberCalendar,
  openSchedulingTasks,
  parseSchedulingRoute,
  prepareSchedulingCommand,
  preserveSchedulingRoute,
  previewDeliverySchedule,
  schedulingError,
  schedulingHash,
  schedulingPayload,
  schedulingRangeProblem,
  type DeliverySchedule,
} from "./deliveryScheduling";
vi.mock("./http", () => ({ request: vi.fn() }));
const task = {
  id: "T-one",
  title: "One",
  req_id: "REQ-one",
  owner_id: "human",
  milestone_id: "milestone",
  sprint_id: "sprint",
  starts_on: "2026-10-19",
  ends_on: "2026-10-20",
  allocations: [
    {
      member_id: "tool",
      starts_on: "2026-10-19",
      ends_on: "2026-10-20",
      quantity_per_day: 1,
      weekdays: [0, 1],
      unit: "slots",
    },
  ],
  issues: [
    { code: "unscheduled", message: "", member_id: "", task_id: "T-one" },
  ],
};
const schedule = () =>
  ({
    project_id: "project",
    version: 7,
    planning_basis: "initial-basis",
    tasks: [structuredClone(task)],
    resources: [
      {
        id: "human",
        name: "Lead",
        kind: "human",
        active: true,
        unit: "hours",
        calendar: {
          unit: "hours",
          weekly: [8, 8, 8, 8, 8, 0, null],
          exceptions: [
            {
              date: "2027-01-01",
              available: 0,
              note: "Outside current window",
            },
          ],
        },
        cells: [],
      },
    ],
    range: { starts_on: "2026-10-19", ends_on: "2026-11-01" },
  }) as unknown as DeliverySchedule;
describe("explicit project scheduling", () => {
  it("uses civil UTC days and limits inclusive ranges to 92 days", () => {
    expect(
      defaultSchedulingRange(new Date("2026-10-17T23:30:00-08:00")),
    ).toEqual({ startsOn: "2026-10-18", endsOn: "2026-10-31" });
    expect(schedulingRangeProblem("2026-01-01", "2026-04-02")).toBeNull();
    expect(schedulingRangeProblem("2026-01-01", "2026-04-03")).toBe(
      "rangeLimit",
    );
    expect(schedulingRangeProblem("2026-02-29", "2026-03-01")).toBe(
      "invalidDates",
    );
    expect(schedulingRangeProblem("2028-02-29", "2028-03-01")).toBeNull();
    expect(schedulingRangeProblem("0000-01-01", "0000-01-02")).toBe(
      "invalidDates",
    );
  });
  it("retains modes and filters while an exact task inspector is opened and closed", () => {
    expect(
      preserveSchedulingRoute(
        "#/dev-flow?view=team",
        "#/dev-flow?view=progress&starts_on=2020-01-01&ends_on=2020-01-30",
      ),
    ).toBe("#/dev-flow?view=team");
    const route = parseSchedulingRoute(
      "#/dev-flow?view=team&team_view=capacity&starts_on=2026-10-19&ends_on=2026-11-01&member_id=human&milestone_id=M&sprint_id=S&schedule_issue=unscheduled&schedule_q=One&schedule_day_member=human&schedule_day=2026-10-19",
    );
    const hash = schedulingHash(route);
    expect(parseSchedulingRoute(hash)).toEqual(route);
    const taskHash = preserveSchedulingRoute(
      "#/dev-flow?view=team&requirement=REQ-one&detail=tasks&task=T-one",
      hash,
    );
    expect(taskHash).toContain("task=T-one");
    expect(parseSchedulingRoute(taskHash)).toEqual(route);
    expect(preserveSchedulingRoute("#/dev-flow?view=team", taskHash)).toContain(
      "member_id=human",
    );
  });
  it("reads the full project load with an explicit scope and sends no display filters to the API", async () => {
    const signal = new AbortController().signal;
    vi.mocked(request).mockResolvedValueOnce(schedule());
    await fetchDeliverySchedule(
      "project",
      { startsOn: "2026-10-19", endsOn: "2026-11-01" },
      signal,
    );
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/delivery/schedule?starts_on=2026-10-19&ends_on=2026-11-01",
      { headers: { "X-Project-Id": "project" }, signal },
    );
    await expect(
      fetchDeliverySchedule("", {
        startsOn: "2026-10-19",
        endsOn: "2026-11-01",
      }),
    ).rejects.toThrow();
  });
  it("pins versions and complete calendars including exceptions outside the visible date range", () => {
    const data = schedule();
    const session = openMemberCalendar(data, "human", "calendar-key");
    data.resources[0].calendar!.exceptions = [];
    data.planning_basis = "mutated";
    expect(schedulingPayload(session)).toEqual({
      member_id: "human",
      planning_basis: "initial-basis",
      weekly: [8, 8, 8, 8, 8, 0, null],
      exceptions: [
        { date: "2027-01-01", available: 0, note: "Outside current window" },
      ],
    });
    expect(prepareSchedulingCommand(session)).toMatchObject({
      action: "member.calendar.save",
      version: 7,
      key: "calendar-key",
    });
  });
  it("previews only explicit task changes without unit or mutating their fixed command identity", async () => {
    const session = openSchedulingTasks(schedule(), ["T-one"], "same-command");
    const first = prepareSchedulingCommand(session);
    const replay = prepareSchedulingCommand(first.session);
    expect(replay.key).toBe("same-command");
    expect(first.payload).toEqual({
      planning_basis: "initial-basis",
      changes: [
        {
          task_id: "T-one",
          starts_on: "2026-10-19",
          ends_on: "2026-10-20",
          allocations: [
            {
              member_id: "tool",
              starts_on: "2026-10-19",
              ends_on: "2026-10-20",
              quantity_per_day: 1,
              weekdays: [0, 1],
            },
          ],
        },
      ],
    });
    await previewDeliverySchedule(first.session);
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/delivery/schedule-preview",
      {
        method: "POST",
        headers: { "X-Project-Id": "project" },
        body: JSON.stringify(first.payload),
        signal: undefined,
      },
    );
  });
  it("explicitly adopts a new basis while preserving changes, refusing deleted tasks and mismatched scopes", () => {
    const session = openSchedulingTasks(schedule(), ["T-one"], "old");
    if (session.kind !== "tasks") throw new Error("tasks required");
    session.changes[0].starts_on = "2026-10-20";
    const fresh = { ...schedule(), version: 9, planning_basis: "new-basis" };
    const adopted = adoptSchedulingBasis(session, fresh, "new-key");
    expect(prepareSchedulingCommand(adopted)).toMatchObject({
      version: 9,
      key: "new-key",
      payload: {
        planning_basis: "new-basis",
        changes: [{ starts_on: "2026-10-20" }],
      },
    });
    expect(() =>
      adoptSchedulingBasis(session, { ...fresh, tasks: [] }, "no"),
    ).toThrow();
    expect(() =>
      adoptSchedulingBasis(session, { ...fresh, project_id: "other" }, "no"),
    ).toThrow();
  });
  it("distinguishes changed planning scope from invalid allocations and idempotency reuse", () => {
    const error = (code: string) =>
      new Error(
        `HTTP 409: ${JSON.stringify({ detail: { code, message: "Visible detail" } })}`,
      );
    expect(schedulingError(error("planning_basis_changed")).conflict).toBe(
      true,
    );
    expect(
      schedulingError(error("allocation_outside_task_dates")).conflict,
    ).toBe(false);
    expect(schedulingError(error("idempotency_key_reused")).conflict).toBe(
      false,
    );
  });
  it("filters task visibility by explicit collaborator resources while leaving project occupancy untouched", () => {
    const data = schedule();
    const route = {
      ...parseSchedulingRoute("#/dev-flow?view=timeline"),
      memberId: "tool",
    };
    expect(
      filterSchedulingTasks(data.tasks, route).map((row) => row.id),
    ).toEqual(["T-one"]);
    expect(
      filterSchedulingTasks(data.tasks, { ...route, memberId: "other" }),
    ).toEqual([]);
    expect(data.resources[0].calendar!.weekly).toEqual([
      8,
      8,
      8,
      8,
      8,
      0,
      null,
    ]);
  });
});
