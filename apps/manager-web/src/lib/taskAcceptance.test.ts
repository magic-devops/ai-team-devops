import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  adoptTaskEdit,
  openTaskEdit,
  taskEditPayload,
} from "./deliveryTaskEditing";
import { TaskDetailContent } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import type { DeliveryRequirement, DeliveryTaskData } from "./delivery";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const workspace = () =>
  ({
    project: { id: "project" },
    version: 7,
    planning_basis: "plan",
    permissions: { write: true, approve: true, configure: true },
    members: [],
    requirement: null,
    dependencies: [],
    task: {
        id: "T-one",
        req_id: "",
        title: "Standalone task",
        description: "Scope",
        basis: "basis",
        owner_id: "",
        assigned_to: "",
        status: "pending",
        acceptance_criteria: ["Task must preserve draft"],
        acceptance: {
          criteria: ["Task must preserve draft"],
          sources: [
            { source: "task", index: 0, text: "Task must preserve draft" },
          ],
          available: true,
          requirement_id: null,
          requirement_revision: null,
        },
        execution_gate: { eligible: true, reasons: [] },
        planning: { depends_on: [], requirement_criteria_indices: [] },
      },
  }) as unknown as DeliveryTaskData;
describe("task acceptance as explicit business content", () => {
  it("submits own text and requirement indices as separate fields with the fixed basis", () => {
    const data = workspace();
    const session = openTaskEdit(data, "T-one");
    const result = taskEditPayload(session, {
      description: "Edited",
      acceptance_criteria: ["  Verify final output  "],
      requirement_criteria_indices: ["0"],
      depends_on: [],
    });
    expect(result.acceptance_criteria).toEqual(["Verify final output"]);
    expect(result.requirement_criteria_indices).toEqual([]);
    expect(result.task_basis).toBe("basis");
    expect(data.task.acceptance_criteria).toEqual([
      "Task must preserve draft",
    ]);
  });
  it("retains own criteria while explicitly adopting reordered requirement references", () => {
    const data = workspace();
    data.task.req_id = "REQ";
    data.requirement = { id: "REQ", title: "Requirement", acceptance_criteria: ["Requirement A", "Requirement B"], flow: { revision: 3 } } as DeliveryRequirement;
    const session = openTaskEdit(data, "T-one");
    const latest = workspace();
    latest.task.req_id = "REQ";
    latest.requirement = structuredClone(data.requirement);
    latest.version = 8;
    latest.requirement.acceptance_criteria.reverse();
    const adopted = adoptTaskEdit(session, latest, {
      acceptance_criteria: ["My edited condition"],
      requirement_criteria_indices: ["0"],
      description: "My description",
    });
    expect(adopted.values.acceptance_criteria).toEqual(["My edited condition"]);
    expect(adopted.values.requirement_criteria_indices).toEqual(["1"]);
  });
  it("shows standalone acceptance and a shared native execution section without inventing a requirement", () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(TaskDetailContent, {
          detail: workspace(),
          taskId: "T-one",
          canEdit: true,
          onSaved: () => {},
          onEditingChange: () => {},
        }),
      ),
    );
    expect(html).toContain("Task must preserve draft");
    expect(html).toContain("deliveryTaskAcceptance.standalone");
    expect(html).toContain("deliveryRuntime.title");
    expect(html).not.toContain("Requirement A");
  });
});
