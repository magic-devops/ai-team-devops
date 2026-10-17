import { describe, expect, it, vi } from "vitest";
import { request } from "./http";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeliveryTaskPlanning } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanning";
import type {
  DeliveryRequirement,
  DeliveryTask,
  DeliveryWorkspace,
} from "./delivery";
import {
  remapPlanCriteria,
  selectedPlanItems,
  taskPlanProblems,
  previewTaskPlan,
  planError,
  type TaskPlanRow,
} from "./deliveryTaskPlan";

vi.mock("./http", () => ({ request: vi.fn() }));
const row = (
  key: string,
  overrides: Partial<TaskPlanRow> = {},
): TaskPlanRow => ({
  key,
  selected: true,
  title: key,
  description: "Edited scope",
  owner_id: "user:lead",
  priority: "P1",
  estimate: "M",
  acceptance_criteria: [],
  requirement_criteria_indices: [0],
  depends_on: [],
  starts_on: null,
  ends_on: null,
  blocked_reason: "",
  ...overrides,
});

describe("editable task plans", () => {
  it("offers explicit review after a stale progress scope without retrying unrelated conflicts", () => {
    const detail =
      "Progress scope changed. Reload and review the current task scope before freezing.";
    expect(
      planError(new Error(`HTTP 409: ${JSON.stringify({ detail })}`)),
    ).toMatchObject({
      conflict: true,
      message: detail,
    });
    expect(
      planError(
        new Error(
          'HTTP 409: {"detail":"Idempotency key reused with different input"}',
        ),
      ).conflict,
    ).toBe(false);
    expect(
      planError(new Error(`HTTP 422: ${JSON.stringify({ detail })}`)).conflict,
    ).toBe(false);
  });
  it("distinguishes changed plan bases from blocked dependencies and in-flight generation", () => {
    const failure = (code: string) =>
      new Error(
        `HTTP 409: ${JSON.stringify({ detail: { code, message: "Visible reason" } })}`,
      );
    expect(planError(failure("task_dependencies_blocked"))).toMatchObject({
      conflict: false,
      message: "Visible reason",
    });
    expect(planError(failure("plan_generation_in_progress")).conflict).toBe(
      false,
    );
    expect(planError(failure("plan_basis_changed")).conflict).toBe(true);
    expect(
      planError(
        new Error('HTTP 403: {"detail":"Project write permission required"}'),
      ).message,
    ).toBe("Project write permission required");
    expect(
      planError(new Error('HTTP 409: {"detail":"Project changed. Reload."}'))
        .conflict,
    ).toBe(true);
  });
  it("renders existing tasks with absent or partial planning metadata", () => {
    for (const planning of [
      {},
      { starts_on: "2026-10-16", blocked_reason: "Awaiting decision" },
    ]) {
      const element = createElement(DeliveryTaskPlanning, {
        task: {
          id: "legacy",
          title: "Existing work",
          planning,
        } as DeliveryTask,
        requirement: {
          flow: { revision: 1 },
          acceptance_criteria: [],
        } as unknown as DeliveryRequirement,
        data: { tasks: [] } as unknown as DeliveryWorkspace,
        onTask: () => {},
        onEdit: () => {},
        canEdit: true,
      });
      expect(() => renderToStaticMarkup(element)).not.toThrow();
    }
  });
  it("submits precisely the selected edited content without editor state", () => {
    expect(
      selectedPlanItems([
        row("build", { title: "Adjusted task", estimate: "L" }),
        row("skip", { selected: false }),
      ]),
    ).toEqual([
      {
        key: "build",
        title: "Adjusted task",
        description: "Edited scope",
        owner_id: "user:lead",
        priority: "P1",
        estimate: "L",
        acceptance_criteria: [],
  requirement_criteria_indices: [0],
        depends_on: [],
        starts_on: null,
        ends_on: null,
        blocked_reason: "",
      },
    ]);
  });
  it("blocks a plan whose selected task depends on a deselected or missing task", () => {
    const rows = [
      row("build", { selected: false }),
      row("verify", { depends_on: ["build"] }),
    ];
    expect(
      taskPlanProblems(rows, 1, ["existing-task"]).map((p) => p.code),
    ).toContain("missingDependency");
    expect(
      taskPlanProblems([row("verify", { depends_on: ["existing-task"] })], 1, [
        "existing-task",
      ]),
    ).toEqual([]);
  });
  it("rejects cycles, reversed dates and out-of-range criterion references", () => {
    expect(
      taskPlanProblems(
        [row("a", { depends_on: ["b"] }), row("b", { depends_on: ["a"] })],
        1,
        [],
      ).map((p) => p.code),
    ).toContain("cycle");
    const codes = taskPlanProblems(
      [
        row("a", {
          starts_on: "2026-10-20",
          ends_on: "2026-10-19",
          requirement_criteria_indices: [2],
        }),
      ],
      1,
      [],
    ).map((p) => p.code);
    expect(codes).toContain("dates");
    expect(codes).toContain("criteria");
  });
  it("remaps criterion identity by exact text and occurrence, never by old index", () => {
    const rows = [row("a", { requirement_criteria_indices: [0, 1, 2] })];
    expect(
      remapPlanCriteria(rows, ["A", "Removed", "A"], ["New", "A", "A"])[0]
        .requirement_criteria_indices,
    ).toEqual([1, 2]);
    expect(rows[0].requirement_criteria_indices).toEqual([0, 1, 2]);
  });
  it("sends the fixed preview version and retry key to the authenticated delivery endpoint", async () => {
    const body = {
      requirement_id: "r",
      expected_version: 8,
      idempotency_key: "same-preview",
      generator: "template" as const,
      mode: "fullstack" as const,
      max_items: 4,
    };
    await previewTaskPlan("project", body);
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/delivery/task-plan-preview",
      expect.objectContaining({
        method: "POST",
        headers: { "X-Project-Id": "project" },
        body: JSON.stringify(body),
      }),
    );
  });
});
