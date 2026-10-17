import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CalendarFields,
  ReservationFields,
  SchedulePreviewDetails,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryScheduleEditor";
import { schedulingTranslations } from "../i18n/delivery-scheduling";
import {
  openMemberCalendar,
  openSchedulingTasks,
  type DeliverySchedule,
  type SchedulePreview,
} from "./deliveryScheduling";
let language: keyof typeof schedulingTranslations = "en-US";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(
        key
          .split(".")
          .slice(1)
          .reduce<unknown>(
            (value, part) =>
              value && typeof value === "object"
                ? (value as Record<string, unknown>)[part]
                : undefined,
            schedulingTranslations[language],
          ) ??
          options?.defaultValue ??
          key,
      ).replace(/\{\{(\w+)\}\}/g, (_all, name) =>
        String(options?.[name] ?? ""),
      ),
    i18n: {
      get language() {
        return language;
      },
    },
  }),
}));
const data = {
  project_id: "project",
  version: 7,
  planning_basis: "basis",
  range: { starts_on: "2026-10-19", ends_on: "2026-11-01" },
  resources: [
    {
      id: "human",
      name: "Lead",
      kind: "human",
      unit: "hours",
      active: true,
      calendar: {
        unit: "hours",
        weekly: [null, 0, 8, 8, 8, 0, 0],
        exceptions: [
          {
            date: "2027-01-01",
            available: 0,
            note: "Outside window remains editable",
          },
        ],
      },
    },
    {
      id: "tool",
      name: "Test tool",
      kind: "tool",
      unit: "slots",
      active: true,
      calendar: null,
    },
  ],
  tasks: [
    {
      id: "T-one",
      title: "Current task",
      owner_id: "human",
      starts_on: "2026-10-19",
      ends_on: "2026-10-20",
      allocations: [
        {
          member_id: "tool",
          starts_on: "2026-10-19",
          ends_on: "2026-10-20",
          quantity_per_day: 2,
          weekdays: [0, 1],
          unit: "slots",
        },
      ],
      issues: [],
    },
  ],
} as unknown as DeliverySchedule;
describe("explicit calendars and reservations", () => {
  it("renders unknown availability separately from zero and preserves exceptions outside the query window", () => {
    const session = openMemberCalendar(data, "human", "calendar");
    if (session.kind !== "calendar") throw new Error("calendar required");
    const html = renderToStaticMarkup(
      createElement(CalendarFields, {
        session,
        busy: false,
        onChange: () => {},
      }),
    );
    expect(html).toContain("Unknown");
    const monday = html.match(/<input[^>]*aria-label="Mon"[^>]*>/)?.[0] || "";
    const tuesday = html.match(/<input[^>]*aria-label="Tue"[^>]*>/)?.[0] || "";
    expect(monday).toContain('value=""');
    expect(monday).not.toContain("aria-valuenow");
    expect(tuesday).toContain('aria-valuenow="0"');
    expect(html).toContain("2027-01-01");
    expect(html).toContain("Outside window remains editable");
    expect(html).toContain('step="0.5"');
  });
  it("shows the complete latest calendar as read-only facts without draft mutation controls", () => {
    const session = openMemberCalendar(data, "human", "latest");
    if (session.kind !== "calendar") throw new Error("calendar required");
    const html = renderToStaticMarkup(
      createElement(CalendarFields, {
        session,
        busy: false,
        readOnly: true,
        onChange: () => {},
      }),
    );
    expect(html).toContain("Outside window remains editable");
    expect(html).toContain('value="2027-01-01"');
    expect(html).not.toContain("Weekday preset");
    expect(html).not.toContain("Add exception");
    expect(html.match(/<input[^>]*aria-label="Mon"[^>]*>/)?.[0]).toContain(
      "disabled",
    );
  });
  it("shows tools as explicit reservation resources with slots and weekdays rather than task ownership", () => {
    const session = openSchedulingTasks(data, ["T-one"], "tasks");
    if (session.kind !== "tasks") throw new Error("tasks required");
    const html = renderToStaticMarkup(
      createElement(ReservationFields, {
        session,
        busy: false,
        onChange: () => {},
      }),
    );
    expect(html).toContain("Test tool");
    expect(html).toContain("slots / day");
    expect(html).toContain("Mon");
    expect(html).toContain("Tue");
    expect(html).not.toContain('aria-label="Task owner"');
  });
  it("compares exact before and after reservations with names and units without object coercion", () => {
    const session = openSchedulingTasks(data, ["T-one"], "tasks");
    const preview = {
      project_id: "project",
      version: 7,
      planning_basis: "basis",
      affected_task_ids: ["T-one"],
      changes: [
        {
          task_id: "T-one",
          title: "Current task",
          before: {
            starts_on: "2026-10-19",
            ends_on: "2026-10-20",
            allocations: [],
          },
          after: {
            starts_on: "2026-10-20",
            ends_on: "2026-10-21",
            allocations: data.tasks[0].allocations,
          },
          fields: ["starts_on", "ends_on", "allocations"],
        },
      ],
    } as SchedulePreview;
    const html = renderToStaticMarkup(
      createElement(SchedulePreviewDetails, { session, preview }),
    );
    expect(html).toContain("2026-10-19");
    expect(html).toContain("2026-10-21");
    expect(html).toContain("Test tool");
    expect(html).toContain("slots / day");
    expect(html).not.toContain("[object Object]");
    expect(html).toContain("Preview only");
  });
  it("uses matching three-language keys in the actual reservation form", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object"
        ? Object.entries(value)
            .flatMap(([key, item]) => keys(item, `${prefix}.${key}`))
            .sort()
        : [prefix];
    expect(keys(schedulingTranslations["en-US"])).toEqual(
      keys(schedulingTranslations["zh-CN"]),
    );
    expect(keys(schedulingTranslations["ja-JP"])).toEqual(
      keys(schedulingTranslations["zh-CN"]),
    );
    const session = openSchedulingTasks(data, ["T-one"], "tasks");
    if (session.kind !== "tasks") throw new Error("tasks required");
    for (const lang of Object.keys(
      schedulingTranslations,
    ) as (keyof typeof schedulingTranslations)[]) {
      language = lang;
      const html = renderToStaticMarkup(
        createElement(ReservationFields, {
          session,
          busy: false,
          onChange: () => {},
        }),
      );
      expect(html).not.toContain("deliverySchedule.");
      expect(html).toContain("Current task");
    }
    language = "en-US";
  });
});
