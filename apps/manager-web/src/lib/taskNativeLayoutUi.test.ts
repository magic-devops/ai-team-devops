import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { TaskDetailContent } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import type { DeliveryWorkspace } from "./delivery";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock(
  "../../subapps/ai-rd-center/src/pages/delivery/ExecutionObservationCard",
  () => ({
    ExecutionObservationCard: () =>
      createElement("div", {}, "current-native-stages"),
  }),
);
vi.mock(
  "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanMaintenance",
  () => ({
    DeliveryTaskPlanMaintenance: () =>
      createElement("div", {}, "maintain-task-plan"),
  }),
);
vi.mock(
  "../../subapps/ai-rd-center/src/pages/delivery/DeliveryManualReviewPanel",
  () => ({
    DeliveryManualReviewPanel: () => null,
  }),
);

function renderTask(
  reason = "task_dispatch_stage_blocked",
  status = "completed",
) {
  const data = {
    project: { id: "project" },
    version: 7,
    permissions: { write: true },
    requirements: [],
    members: [],
    tasks: [
      {
        id: "T",
        req_id: "",
        title: "Accepted standalone task",
        description: "Scope",
        status,
        recorded_status: "completed",
        delivery_status: "verified_completed",
        verified: true,
        acceptance_criteria: ["Own condition"],
        acceptance: {
          criteria: ["Own condition"],
          sources: [{ source: "task", index: 0, text: "Own condition" }],
          available: reason !== "task_requirement_missing",
          requirement_id: null,
          requirement_revision: null,
        },
        execution_gate: {
          eligible: false,
          reasons: [
            {
              code: reason,
              message: "Reopen the task and requirement before dispatch.",
            },
          ],
        },
      },
    ],
    executions: [{ id: "E", task_id: "T", status: "accepted", stale: false }],
  } as unknown as DeliveryWorkspace;
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(TaskDetailContent, {
        workspace: data,
        taskId: "T",
        canEdit: true,
        onSaved: () => {},
        onEditingChange: () => {},
      }),
    ),
  );
}

describe("focused native task layout", () => {
  it("keeps successful delivery prominent and uses a compact reopen explanation", () => {
    const html = renderTask();
    expect(html).toContain("deliveryProgress.states.verified_completed");
    expect(html.indexOf("current-native-stages")).toBeLessThan(
      html.indexOf("Own condition"),
    );
    expect(html).toContain("deliveryTaskAcceptance.standaloneStageBlocked");
    expect(html).not.toContain("ant-alert-info");
    expect(html).not.toContain("Reopen the task and requirement");
  });
  it("retains an explicit warning when the acceptance source is unavailable", () => {
    const html = renderTask("task_requirement_missing");
    expect(html).toContain("ant-alert");
    expect(html).toContain(
      "deliveryTaskAcceptance.reasons.task_requirement_missing",
    );
  });
  it("shows the original recorded status separately from an invalidated delivery state", () => {
    const html = renderTask("task_requirement_basis_changed", "in_progress");
    expect(html).toContain("deliveryManualReview.recordedCompleted");
    expect(html).not.toContain('title="page.tasks.status.in_progress"');
  });
});
