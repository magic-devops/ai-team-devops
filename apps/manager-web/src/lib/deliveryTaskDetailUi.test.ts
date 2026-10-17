import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { TaskDetailContent } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import type { DeliveryTaskData } from "./delivery";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("standalone task edit retention", () => {
  it("keeps the real planning component mounted with the frozen workspace after a live delete or migration", () => {
    const original = {
      project: { id: "project" },
      version: 7,
      permissions: { write: true },
      requirement: null,
      members: [],
      dependencies: [],
      task: {
          id: "T-alone",
          req_id: "",
          basis: "original",
          title: "Original task being edited",
          description: "Pinned scope",
          acceptance_criteria: [],
          acceptance: {
            criteria: [],
            sources: [],
            available: true,
            requirement_id: null,
            requirement_revision: null,
          },
          execution_gate: { eligible: false, reasons: [] },
          planning: { starts_on: "2026-10-17", depends_on: [] },
        },
    } as unknown as DeliveryTaskData;
    const frozen = structuredClone(original);
    original.task = { ...original.task, id: "T-migrated" };
    const cache = new QueryClient();
    const render = (pinnedDetail?: DeliveryTaskData) =>
      renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client: cache },
          createElement(TaskDetailContent, {
            detail: original,
            pinnedDetail,
            taskId: "T-alone",
            canEdit: true,
            onSaved: () => {},
            onEditingChange: () => {},
          }),
        ),
      );
    const whileEditing = render(frozen);
    expect(whileEditing).toContain("Original task being edited");
    expect(whileEditing).toContain("2026-10-17");
    expect(whileEditing).toContain("delivery.taskPlan.editTask");
    expect(render()).not.toContain("Original task being edited");
  });
});
