import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeliveryTaskPlanning } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanning";
import type { DeliveryTask, DeliveryWorkspace } from "./delivery";
import {
  adoptTaskEdit,
  openTaskEdit,
  taskEditPayload,
} from "./deliveryTaskEditing";
import { planError } from "./deliveryTaskPlan";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const task = {
  id: "T-alone",
  req_id: "",
  title: "Standalone work",
  description: "Scope",
  basis: "basis-old",
  acceptance_criteria: ["Own criterion"],
  planning: {
    depends_on: ["T-first"],
    requirement_criteria_indices: [],
    starts_on: "2026-10-17",
  },
} as unknown as DeliveryTask;
const workspace = {
  project: { id: "project" },
  version: 7,
  planning_basis: "planning-old",
  tasks: [task],
  requirements: [],
} as unknown as DeliveryWorkspace;
describe("one task plan editor", () => {
  it("pins standalone task basis and submits dependencies without invented requirement criteria", () => {
    const session = openTaskEdit(workspace, task.id);
    task.basis = "mutated";
    const payload = taskEditPayload(session, {
      description: "Edited scope",
      acceptance_criteria: ["Own criterion"],
      requirement_criteria_indices: ["0"],
      depends_on: ["T-another"],
      starts_on: "2026-10-17",
      ends_on: "",
      blocked_reason: "",
    });
    expect(payload).toEqual({
      id: "T-alone",
      task_basis: "basis-old",
      planning_basis: "planning-old",
      description: "Edited scope",
      acceptance_criteria: ["Own criterion"],
      requirement_criteria_indices: [],
      depends_on: ["T-another"],
      starts_on: "2026-10-17",
      ends_on: null,
      blocked_reason: "",
    });
    expect(payload).not.toHaveProperty("requirement_basis");
    expect(session.version).toBe(7);
  });
  it("adopts only the latest exact task and remaps retained criteria by text", () => {
    const oldTask = {
      ...task,
      req_id: "REQ-one",
      basis: "first",
      planning: { requirement_criteria_indices: [0], depends_on: [] },
    };
    const first = {
      ...workspace,
      tasks: [oldTask],
      requirements: [{ id: "REQ-one", acceptance_criteria: ["A", "B"] }],
    } as unknown as DeliveryWorkspace;
    const session = openTaskEdit(first, task.id);
    const fresh = {
      ...first,
      version: 8,
      tasks: [{ ...oldTask, basis: "latest" }],
      requirements: [{ id: "REQ-one", acceptance_criteria: ["B", "A"] }],
    } as unknown as DeliveryWorkspace;
    const adopted = adoptTaskEdit(session, fresh, {
      description: "My draft",
      acceptance_criteria: ["Own criterion"],
      requirement_criteria_indices: ["0"],
      depends_on: ["T-draft"],
    });
    expect(adopted.values).toEqual({
      description: "My draft",
      acceptance_criteria: ["Own criterion"],
      requirement_criteria_indices: ["1"],
      depends_on: ["T-draft"],
    });
    expect(adopted.session).toMatchObject({
      version: 8,
      task: { basis: "latest" },
    });
    expect(() => adoptTaskEdit(session, { ...fresh, tasks: [] }, {})).toThrow();
  });
  it("treats task basis changes as explicit recoverable conflicts", () => {
    expect(
      planError(
        new Error(
          'HTTP 409: {"detail":{"code":"planning_basis_changed","message":"Dates or reservations changed"}}',
        ),
      ).conflict,
    ).toBe(true);
    expect(
      planError(
        new Error(
          'HTTP 409: {"detail":{"code":"task_basis_changed","message":"Changed task"}}',
        ),
      ).conflict,
    ).toBe(true);
    expect(
      planError(
        new Error(
          'HTTP 409: {"detail":{"code":"task_dependencies_blocked","message":"Blocked"}}',
        ),
      ).conflict,
    ).toBe(false);
  });
  it("renders standalone planning without fabricating a requirement", () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryTaskPlanning, {
        task: {
          ...task,
          planning: {
            ...task.planning,
            source: "manual",
            requirement_revision: 1,
            requirement_criteria_indices: [0],
          },
        },
        data: workspace,
        onTask: () => {},
        onEdit: () => {},
        canEdit: true,
      }),
    );
    expect(html).toContain("2026-10-17");
    expect(html).toContain("T-first");
  });
});
