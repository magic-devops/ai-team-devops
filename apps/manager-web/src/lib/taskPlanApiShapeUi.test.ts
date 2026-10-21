import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryTaskPlanMaintenance } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanMaintenance";
import type { DeliveryTaskData } from "./delivery";

let edit: (() => void) | undefined;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock(
  "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanning",
  () => ({
    DeliveryTaskPlanning: ({ onEdit }: { onEdit: () => void }) => {
      edit = onEdit;
      return createElement("button", {}, "Edit plan");
    },
  }),
);

describe("task editor with the materialized API task shape", () => {
  beforeEach(() => {
    edit = undefined;
  });
  for (const linked of [false, true]) {
    it(`opens the ${linked ? "linked" : "standalone"} editor without a fabricated top-level reference field`, () => {
      const data = {
        project: { id: "project" },
        version: 7,
        planning_basis: "plan-basis",
        members: [],
        requirement: linked
          ? { id: "REQ", acceptance_criteria: ["A", "B"] }
          : null,
        dependencies: [],
        task: {
            id: "T",
            title: "Actual API task",
            req_id: linked ? "REQ" : "",
            basis: "task-basis",
            acceptance_criteria: ["Own condition"],
            planning: {
              depends_on: [],
              requirement_criteria_indices: linked ? [1] : [],
            },
          },
      } as unknown as DeliveryTaskData;
      const onEdit = vi.fn();
      renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(DeliveryTaskPlanMaintenance, {
            data,
            task: data.task,
            canEdit: true,
            onTask: () => {},
            onEdit,
          }),
        ),
      );
      expect(edit).toBeTypeOf("function");
      expect(() => edit!()).not.toThrow();
      expect(onEdit).toHaveBeenCalledTimes(1);
    });
  }
});
