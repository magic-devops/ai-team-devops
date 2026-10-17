import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryProgressHistory,
  DeliveryProgressSnapshot,
  DeliveryProgressComparison,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProgressDetails";
import { progressChartOptions } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProgressCharts";
import { progressTranslations } from "../i18n/delivery-progress";
import { schedulingTranslations } from "../i18n/delivery-scheduling";
import type {
  DeliveryProgress,
  ProgressObservation,
  ProgressMetrics,
  ProgressTask,
} from "./deliveryProgress";
import { fetchTaskDetail } from "./deliveryQuery";

const navigationHooks = vi.hoisted(() => ({ values: [] as unknown[], next: 0 }));
vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: unknown) => {
    const index = navigationHooks.next++;
    if (!(index in navigationHooks.values)) navigationHooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [navigationHooks.values[index], (value: any) => { navigationHooks.values[index] = typeof value === "function" ? value(navigationHooks.values[index]) : value; }];
  },
}));
vi.mock("./authStorage", async () => ({ ...await vi.importActual<typeof import("./authStorage")>("./authStorage"), getProjectId: () => "P" }));
vi.mock("./deliveryQuery", async () => ({ ...await vi.importActual<typeof import("./deliveryQuery")>("./deliveryQuery"), fetchTaskDetail: vi.fn() }));
beforeEach(() => { navigationHooks.values = []; navigationHooks.next = 0; language = "en-US"; vi.mocked(fetchTaskDetail).mockReset(); });

let language: keyof typeof progressTranslations = "en-US";
function translate(key: string, options?: Record<string, unknown>): string {
  const value = key
    .split(".")
    .slice(1)
    .reduce<unknown>(
      (current, part) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[part]
          : undefined,
      key.startsWith("deliverySchedule.")
        ? schedulingTranslations[language]
        : progressTranslations[language],
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
const metrics: ProgressMetrics = {
  tasks_total: 4,
  verified_completed: 1,
  recorded_completed: 1,
  awaiting_review: 1,
  remaining: 3,
  requirements_total: 2,
  requirements_accepted: 1,
  requirements_released: 0,
  status_counts: {
    pending: 1,
    in_progress: 0,
    blocked: 0,
    awaiting_review: 1,
    recorded_completed: 1,
    verified_completed: 1,
  },
};
const task = {
  allocations: null,
  id: "present",
  req_id: "req",
  title: "Historical task title",
  status: "awaiting_review" as const,
  recorded_status: "in_progress",
  owner_id: "user:one",
  assigned_to: "Lead",
  estimate: "M",
  starts_on: null,
  ends_on: null,
  sprint_id: "",
  milestone_id: "",
  basis: "basis",
};
const days = [
  {
    date: "2026-10-15",
    observation_id: "O15",
    observed_at: "2026-10-15T20:00:00Z",
    source: "manual",
    metrics,
    baseline_remaining: 2,
  },
  {
    date: "2026-10-16",
    observation_id: null,
    observed_at: null,
    source: null,
    metrics: null,
    baseline_remaining: null,
  },
  {
    date: "2026-10-17",
    observation_id: "O17",
    observed_at: "2026-10-17T10:00:00Z",
    source: "daily",
    metrics,
    baseline_remaining: 1,
  },
  {
    date: "2026-10-18",
    observation_id: null,
    observed_at: null,
    source: null,
    metrics: null,
    baseline_remaining: null,
  },
];
const progress = {
  days,
  baseline: { id: "base" },
  ideal: [
    { date: "2026-10-15", remaining: 4 },
    { date: "2026-10-18", remaining: 0 },
  ],
  coverage: { future_days: ["2026-10-18"] },
} as unknown as DeliveryProgress;

function findCurrentControl(node: ReactNode, id: string): any {
  if (Array.isArray(node)) return node.map((child) => findCurrentControl(child, id)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (typeof node.type === "function" && node.type.name === "CurrentTaskButton" && node.props.task.id === id) return node;
  return findCurrentControl(node.props.children, id);
}
function currentControl(historical: ProgressTask, onOpenTask: (target: any) => void) {
  const observation = { id: "O", scope: { kind: "project", id: "", label: "Project" }, current: { tasks: [historical], metrics } } as ProgressObservation;
  const node = findCurrentControl(DeliveryProgressSnapshot({ observation, currentTasks: [], onOpenTask }), historical.id);
  return () => { navigationHooks.next = 0; return node.type(node.props); };
}
async function settleNavigation() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

describe("real progress presentation", () => {
  it("shows acceptance changes as readable criteria and sources rather than object serialization", () => {
    language = "en-US";
    const html = renderToStaticMarkup(createElement(DeliveryProgressComparison, {
      comparison: { added: [], removed: [], changed: [{ id: "present", before: { ...task, acceptance: { criteria: ["Original criterion"], sources: [{ source: "task", index: 0, text: "Original criterion" }], available: true, requirement_id: null, requirement_revision: null } }, after: { ...task, acceptance: { criteria: ["Updated criterion"], sources: [{ source: "task", index: 0, text: "Updated criterion" }], available: true, requirement_id: null, requirement_revision: null } }, fields: ["acceptance"] }], unchanged_count: 0, incomplete_plan_fields: [], incomplete_task_ids: [] }, currentTasks: [], onOpenTask: () => {},
    }));
    expect(html).toContain("Original criterion"); expect(html).toContain("Updated criterion"); expect(html).not.toContain("[object Object]");
  });
  it("renders frozen reservation changes with units and reports uncaptured baseline fields", () => {
    language = "en-US";
    const allocation = {
      member_id: "tool",
      starts_on: "2026-10-19",
      ends_on: "2026-10-20",
      quantity_per_day: 2,
      weekdays: [0, 1],
      unit: "slots" as const,
    };
    const html = renderToStaticMarkup(
      createElement(DeliveryProgressComparison, {
        comparison: {
          added: [],
          removed: [],
          changed: [
            {
              id: "present",
              before: { ...task, allocations: [] },
              after: { ...task, allocations: [allocation] },
              fields: ["allocations"],
            },
          ],
          unchanged_count: 0,
          incomplete_plan_fields: ["allocations"],
          incomplete_task_ids: ["old-task"],
        } as unknown as Parameters<
          typeof DeliveryProgressComparison
        >[0]["comparison"],
        currentTasks: [{ id: "present", req_id: "req" }],
        onOpenTask: () => {},
      }),
    );
    expect(html).toContain("slots / day");
    expect(html).toContain("2026-10-19");
    expect(html).toContain("Reservations were not captured in this baseline");
    expect(html).not.toContain("[object Object]");
  });
  it("provides keyboard buttons only for actual observations and labels missing versus future dates", () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryProgressHistory, {
        data: progress,
        onOpen: () => {},
      }),
    );
    expect(html).toContain(
      'aria-label="View historical observation for 2026-10-15"',
    );
    expect(html).toContain(
      'aria-label="View historical observation for 2026-10-17"',
    );
    expect(html).not.toContain(
      'aria-label="View historical observation for 2026-10-16"',
    );
    expect(html).toContain("No observation");
    expect(html).toContain("Future date");
    expect(html).toContain("Recorded complete only");
  });
  it("keeps both actual charts disconnected across missing dates and has no fake history or smoothing", () => {
    const options = progressChartOptions(progress, (key) =>
      translate(`deliveryProgress.${key}`),
    );
    const burn = options.burndown.series as {
      name: string;
      data: unknown[];
      connectNulls?: boolean;
      smooth?: boolean;
    }[];
    expect(
      burn.find((series) => series.name === "Current scope unverified")?.data,
    ).toEqual([3, "-", 3, "-"]);
    expect(
      burn.find((series) => series.name === "Baseline tasks unverified")?.data,
    ).toEqual([2, "-", 1, "-"]);
    for (const series of [...burn, ...(options.flow.series as typeof burn)]) {
      expect(series.connectNulls).toBe(false);
      expect(series.smooth).toBe(false);
    }
    expect(options.burndown.animation).toBe(false);
    expect(
      (options.flow.series as typeof burn).find(
        (series) => series.name === "Recorded complete only",
      )?.data,
    ).toEqual([1, "-", 1, "-"]);
  });
  it("renders historical facts read only and offers explicit exact lookups without claiming current existence", () => {
    const observation = {
      id: "O",
      observed_at: "2026-10-15T20:00:00Z",
      source: "manual",
      actor: "Lead",
      source_version: 3,
      scope: { kind: "project", id: "", label: "Project" },
      current: {
        tasks: [
          task,
          { ...task, id: "deleted", title: "Removed historical task" },
        ],
        metrics,
      },
    } as ProgressObservation;
    const html = renderToStaticMarkup(
      createElement(DeliveryProgressSnapshot, {
        observation,
        currentTasks: [{ id: "present", req_id: "req" }],
        onOpenTask: () => {},
      }),
    );
    expect(html).toContain("Historical snapshot · Read only");
    expect(html).toContain("Historical task title");
    expect(html).toContain("Removed historical task");
    expect(html.match(/Open current task/g)).toHaveLength(2);
    expect(fetchTaskDetail).not.toHaveBeenCalled();
    expect(html).not.toContain("Current task no longer exists");
    expect(html).not.toContain("execution.review");
    expect(html).not.toContain("stage.advance");
  });
  it("preserves frozen and changed titles while deferring current navigation to an exact read", () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryProgressComparison, {
        comparison: {
          added: [],
          removed: [{ ...task, id: "removed", title: "Frozen deleted task" }],
          changed: [
            {
              id: "present",
              before: task,
              after: { ...task, title: "Current renamed task" },
              fields: ["title"],
            },
          ],
          unchanged_count: 1,
          incomplete_plan_fields: [],
          incomplete_task_ids: [],
        },
        currentTasks: [{ id: "present", req_id: "req" }],
        onOpenTask: () => {},
      }),
    );
    expect(html).toContain("Frozen deleted task");
    expect(html).toContain("Historical task title");
    expect(html).toContain("Current renamed task");
    expect(html).toContain("When frozen");
    expect(html).toContain("Changed fields");
    expect(html.match(/Open current task/g)).toHaveLength(2);
    expect(fetchTaskDetail).not.toHaveBeenCalled();
  });
  it("does not navigate a removed historical task when its explicit exact read returns 404", async () => {
    const onOpenTask = vi.fn();
    const render = currentControl({ ...task, id: "deleted", title: "Removed historical task" }, onOpenTask);
    vi.mocked(fetchTaskDetail).mockRejectedValue(new Error("HTTP 404: Current task no longer exists"));
    expect(fetchTaskDetail).not.toHaveBeenCalled();
    render().props.children[0].props.onClick();
    await settleNavigation();
    expect(fetchTaskDetail).toHaveBeenCalledWith("P", "deleted");
    expect(onOpenTask).not.toHaveBeenCalled();
    const missing = render().props.children[1];
    expect(missing.props.role).toBe("alert");
    expect(missing.props.children).toContain("Current task no longer exists");
  });
  it("opens the current exact task using its remote requirement after migration out of the historical scope", async () => {
    const onOpenTask = vi.fn();
    const render = currentControl({ ...task, req_id: "REQ-historical" }, onOpenTask);
    vi.mocked(fetchTaskDetail).mockResolvedValue({ project_id: "P", version: 9, query_generation: 4, planning_basis: "current-plan", task: { id: "present", req_id: "REQ-current" }, requirement: { id: "REQ-current", title: "Current requirement" } } as Awaited<ReturnType<typeof fetchTaskDetail>>);
    render().props.children[0].props.onClick();
    await settleNavigation();
    expect(fetchTaskDetail).toHaveBeenCalledWith("P", "present");
    expect(onOpenTask).toHaveBeenCalledOnce();
    expect(onOpenTask).toHaveBeenCalledWith({ view: "progress", requirement_id: "REQ-current", task_id: "present", detail: "tasks" });
  });
  it("does not claim unchanged scope when original reservation facts were not collected", () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryProgressComparison, {
        comparison: {
          added: [],
          removed: [],
          changed: [],
          unchanged_count: 0,
          incomplete_plan_fields: ["allocations"],
          incomplete_task_ids: [task.id],
        },
        currentTasks: [],
        onOpenTask: () => {},
      }),
    );
    expect(html).toContain("No changes were found in the comparable fields.");
    expect(html).not.toContain("The current scope matches the frozen plan.");
  });
  it("has the same localized vocabulary and no technical translation keys in any supported language", () => {
    const keys = (value: object): string[] =>
      Object.entries(value)
        .flatMap(([key, entry]) =>
          typeof entry === "object"
            ? keys(entry).map((child) => `${key}.${child}`)
            : key,
        )
        .sort();
    expect(keys(progressTranslations["en-US"])).toEqual(
      keys(progressTranslations["zh-CN"]),
    );
    expect(keys(progressTranslations["ja-JP"])).toEqual(
      keys(progressTranslations["zh-CN"]),
    );
    for (const locale of Object.keys(
      progressTranslations,
    ) as (keyof typeof progressTranslations)[]) {
      language = locale;
      expect(
        renderToStaticMarkup(
          createElement(DeliveryProgressHistory, {
            data: progress,
            onOpen: () => {},
          }),
        ),
      ).not.toContain("deliveryProgress.");
    }
    language = "en-US";
  });
  it("shows actual estimate, owner and dates before and after each scope change without exposing basis hashes", () => {
    const before = {
      ...task,
      estimate: "M",
      owner_id: "user:alice",
      starts_on: null,
      ends_on: "2026-10-18",
      basis: "a".repeat(64),
    };
    const after = {
      ...task,
      estimate: "XL",
      owner_id: "agent:builder",
      starts_on: "2026-10-17",
      ends_on: "2026-10-30",
      basis: "b".repeat(64),
    };
    const html = renderToStaticMarkup(
      createElement(DeliveryProgressComparison, {
        comparison: {
          added: [],
          removed: [],
          changed: [
            {
              id: task.id,
              before,
              after,
              fields: ["estimate", "owner_id", "starts_on", "ends_on", "basis"],
            },
          ],
          unchanged_count: 0,
          incomplete_plan_fields: [],
          incomplete_task_ids: [],
        },
        currentTasks: [{ id: task.id, req_id: "req" }],
        onOpenTask: () => {},
      }),
    );
    for (const expected of [
      "M",
      "XL",
      "user:alice",
      "agent:builder",
      "2026-10-17",
      "2026-10-18",
      "2026-10-30",
      "Content basis changed",
      "—",
    ])
      expect(html).toContain(expected);
    expect(html).not.toContain("a".repeat(64));
    expect(html).not.toContain("b".repeat(64));
  });
});
