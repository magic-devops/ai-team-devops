import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeliveryCapacityCalendar } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryCapacityCalendar";
import { DeliveryDependencyTimeline } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDependencyTimeline";
import { schedulingTranslations } from "../i18n/delivery-scheduling";
import { progressTranslations } from "../i18n/delivery-progress";
import type {
  ScheduleCell,
  ScheduleResource,
  ScheduleTask,
} from "./deliveryScheduling";

let language: keyof typeof schedulingTranslations = "en-US";
function translate(key: string, options?: Record<string, unknown>) {
  const [namespace, ...parts] = key.split(".");
  const bundle =
    namespace === "deliveryProgress"
      ? progressTranslations[language]
      : schedulingTranslations[language];
  const value = parts.reduce<unknown>(
    (current, part) =>
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[part]
        : undefined,
    bundle,
  );
  return String(value ?? options?.defaultValue ?? key).replace(
    /\{\{(\w+)\}\}/g,
    (_all, name) => String(options?.[name] ?? ""),
  );
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
    i18n: {
      get language() {
        return language;
      },
    },
  }),
}));

const cell = (
  date: string,
  fields: Partial<ScheduleCell> = {},
): ScheduleCell => ({
  date,
  available: 8,
  active_load: 0,
  total_reserved: 0,
  overload: 0,
  unavailable: false,
  unregistered_count: 0,
  incomplete: false,
  contributions: [],
  ...fields,
});
const person = (cells: ScheduleCell[]): ScheduleResource => ({
  id: "human",
  name: "Lin",
  kind: "human",
  active: true,
  unit: "hours",
  calendar: { unit: "hours", weekly: [8, 8, 8, 8, 8, 0, 0], exceptions: [] },
  cells,
});
const task = (
  id: string,
  fields: Partial<ScheduleTask> = {},
): ScheduleTask => ({
  id,
  title: `Task ${id}`,
  req_id: "req",
  requirement_title: "Requirement",
  owner_id: "human",
  owner_name: "Lin",
  owner_active: true,
  status: "in_progress",
  delivery_status: "in_progress",
  verified: false,
  milestone_id: "",
  sprint_id: "",
  task_basis: "basis",
  starts_on: "2026-10-19",
  ends_on: "2026-10-21",
  depends_on: [],
  dependency_blocked: [],
  allocations: [],
  issues: [],
  ...fields,
});
const range = { starts_on: "2026-10-19", ends_on: "2026-10-25" };
function calendar(resources: ScheduleResource[], visibleTaskIds = ["shown"]) {
  return renderToStaticMarkup(
    createElement(DeliveryCapacityCalendar, {
      resources,
      visibleTaskIds,
      onCell: () => {},
    }),
  );
}
function timeline(
  tasks: ScheduleTask[],
  allTasks = tasks,
  selectedIds: string[] = [],
  canEdit?: boolean,
) {
  return renderToStaticMarkup(
    createElement(DeliveryDependencyTimeline, {
      tasks,
      allTasks,
      range,
      selectedIds,
      onSelection: () => {},
      onTask: () => {},
      onEdit: () => {},
      canEdit,
    }),
  );
}

describe("capacity calendar and dependency schedule", () => {
  it("distinguishes unknown capacity, explicit zero rest, and unavailable reservations without fake green capacity", () => {
    const html = calendar([
      person([
        cell("2026-10-19", {
          available: null,
          active_load: 3,
          total_reserved: 3,
          overload: null,
        }),
        cell("2026-10-20", { available: 0 }),
        cell("2026-10-21", {
          available: 0,
          active_load: 2,
          total_reserved: 2,
          overload: 2,
          unavailable: true,
        }),
      ]),
    ]);
    expect(html).toContain('data-capacity-state="unknown"');
    expect(html).toContain('data-capacity-state="rest"');
    expect(html).toContain('data-capacity-state="unavailable"');
    expect(html).toContain("Active reservations: 3 h; Available: Unknown");
    expect(html).toContain("Active reservations: 0 h; Available: 0 h");
    expect(html).toContain("Unavailable day");
    expect(html).not.toContain('aria-valuenow="NaN"');
    expect(html).not.toContain('aria-valuemax="0"');
  });
  it("preserves full-project overloaded load under task filters and reports incomplete registrations", () => {
    const html = calendar([
      person([
        cell("2026-10-19", {
          active_load: 10,
          total_reserved: 13,
          overload: 2,
          incomplete: true,
          unregistered_count: 2,
          contributions: [
            {
              task_id: "shown",
              title: "Visible task",
              quantity: 4,
              active: true,
            },
            {
              task_id: "hidden",
              title: "Hidden task",
              quantity: 6,
              active: true,
            },
            {
              task_id: "verified",
              title: "Verified task",
              quantity: 3,
              active: false,
            },
          ],
        }),
      ]),
    ]);
    expect(html).toContain("Active reservations: 10 h; Available: 8 h");
    expect(html).toContain("All reservations: 13 h");
    expect(html).toContain("Over by 2 h");
    expect(html).toContain("2 tasks without registered work");
    expect(html).toContain("6 h reserved by tasks outside current filters");
    expect(html).toContain('data-capacity-state="overload"');
    expect(html).toContain('data-incomplete="true"');
  });
  it("groups resource units separately and supplies a same-source narrow-screen list", () => {
    const day = [cell("2026-10-19", { active_load: 2, total_reserved: 2 })];
    const html = calendar([
      person(day),
      {
        ...person(day),
        id: "agent",
        name: "Agent One",
        kind: "agent",
        unit: "slots",
      },
      {
        ...person(day),
        id: "tool",
        name: "Test Tool",
        kind: "tool",
        unit: "slots",
      },
      {
        ...person(day),
        id: "ghost",
        name: "Removed Resource",
        kind: null,
        unit: null,
        active: false,
      },
    ]);
    for (const kind of ["human", "agent", "tool", "unknown"])
      expect(html).toContain(`data-resource-kind="${kind}"`);
    expect(html).toContain('class="delivery-capacity-mobile"');
    expect(html).toContain("Active reservations: 2 slots");
    expect(html).toContain("Unknown unit");
    expect(html).toContain(
      'aria-label="View reservations for Lin on 2026-10-19; Active reservations: 2 h; Available: 8 h; All reservations: 2 h"',
    );
  });
  it("renders exact task identities, real clipped date bars, auxiliary dependency lines and explicit selection", () => {
    const before = task("before", {
      starts_on: "2026-10-17",
      ends_on: "2026-10-19",
      verified: true,
      delivery_status: "verified_completed",
    });
    const next = task("next", {
      starts_on: "2026-10-21",
      ends_on: "2026-10-27",
      depends_on: ["before"],
      issues: [
        {
          code: "dependency_dates",
          message: "",
          member_id: "",
          task_id: "before",
        },
      ],
    });
    const html = timeline([before, next], [before, next], ["next"]);
    expect(html).toContain('data-task-id="before"');
    expect(html).toContain('data-task-id="next"');
    expect(html).toContain(
      'aria-label="Open Task next (next), 2026-10-21 to 2026-10-27"',
    );
    expect(html).toContain("grid-column:3 / 8");
    expect(html).toContain('class="delivery-timeline-connectors"');
    expect(html).toContain('data-predecessor="before"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-label="Select task Task next" checked=""');
    expect(html).toContain("Dependency date conflict");
    expect(html).toContain("Verified complete");
  });
  it("keeps partial and missing dates unplaced while distinguishing hidden and missing predecessors", () => {
    const hidden = task("hidden", { title: "Filtered predecessor" });
    const partial = task("partial", {
      starts_on: "2026-10-22",
      ends_on: null,
      depends_on: ["hidden", "deleted"],
    });
    const absent = task("absent", { starts_on: null, ends_on: null });
    const html = timeline([partial, absent], [partial, absent, hidden]);
    expect(html).toContain("Without complete dates");
    expect(html).toContain(
      "Complete the start and end dates to place this task.",
    );
    expect(html).toContain("Predecessor outside filters");
    expect(html).toContain("Predecessor missing");
    expect(html).toContain('data-open-task="hidden"');
    expect(html).not.toContain('data-open-task="deleted"');
    expect(html).not.toContain('data-task-bar="partial"');
    expect(html).not.toContain('data-task-bar="absent"');
    expect(html).toContain('class="delivery-timeline-mobile"');
  });
  it("keeps fully dated tasks outside the range visible without inventing a bar inside the window", () => {
    const html = timeline([
      task("outside", { starts_on: "2026-11-01", ends_on: "2026-11-02" }),
    ]);
    expect(html).toContain("Outside displayed dates");
    expect(html).not.toContain('data-task-bar="outside"');
    expect(html).toContain('data-open-task="outside"');
  });
  it("disables schedule edits for read-only users in both views while preserving task navigation", () => {
    const html = timeline([task("one")], undefined, [], false);
    const editButtons =
      html.match(/<button[^>]*class="delivery-timeline-edit"[^>]*>/g) || [];
    expect(editButtons.length).toBe(2);
    for (const button of editButtons) {
      expect(button).toContain('disabled=""');
      expect(button).toContain(
        'title="Read only: scheduling permission required"',
      );
    }
    const openButtons =
      html.match(/<button[^>]*data-open-task="one"[^>]*>/g) || [];
    expect(openButtons.length).toBe(2);
    for (const button of openButtons)
      expect(button).not.toContain('disabled=""');
    const defaultEdits =
      timeline([task("one")]).match(
        /<button[^>]*class="delivery-timeline-edit"[^>]*>/g,
      ) || [];
    for (const button of defaultEdits)
      expect(button).not.toContain('disabled=""');
  });
  it("renders real capacity and task facts in all three languages without untranslated labels", () => {
    for (const lang of Object.keys(
      schedulingTranslations,
    ) as (keyof typeof schedulingTranslations)[]) {
      language = lang;
      const html =
        calendar([
          person([
            cell("2026-10-19", {
              available: null,
              overload: null,
              incomplete: true,
            }),
          ]),
        ]) + timeline([task("one", { starts_on: null, ends_on: null })]);
      expect(html).toContain("Lin");
      expect(html).toContain("Task one");
      expect(html).not.toContain("deliverySchedule.");
      expect(html).not.toContain("deliveryProgress.");
    }
    language = "en-US";
  });
});
