import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Collapse } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetailContent } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import type { DeliveryTaskData } from "./deliveryQuery";
const state = vi.hoisted(() => ({ reads: 0 }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../components/DeliveryMemberIdentity", () => ({
  ProjectOwnerSelect: () => null,
}));
vi.mock(
  "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanMaintenance",
  () => ({ DeliveryTaskPlanMaintenance: () => null }),
);
vi.mock(
  "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionPanel",
  () => ({ DeliveryExecutionPanel: () => null }),
);
vi.mock(
  "../../subapps/ai-rd-center/src/pages/delivery/DeliveryManualReviewPanel",
  () => ({
    DeliveryManualReviewPanel: () => {
      state.reads++;
      return createElement("div", null, "explicit-review");
    },
  }),
);
function data(native: boolean): DeliveryTaskData {
  return {
    project: { id: "P" },
    version: 3,
    permissions: { write: true },
    planning_basis: "fixed",
    requirement: null,
    dependencies: [],
    members: [],
    task: {
      id: "T-10001",
      req_id: "",
      title: "Exact task",
      owner_id: "",
      status: "pending",
      basis: "task-basis",
      execution_id: native ? "E-1" : "",
      execution_gate: { reasons: [], eligible: false },
      acceptance: { available: true, criteria: [], sources: [] },
    },
  } as unknown as DeliveryTaskData;
}
function collapse(node: ReactNode): any {
  if (Array.isArray(node)) return node.map(collapse).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (node.type === Collapse) return node.props;
  return collapse(node.props.children);
}
beforeEach(() => {
  state.reads = 0;
});
describe("explicit manual review reads", () => {
  it.each([false, true])(
    "does not mount the review reader on initial exact task render (native=%s)",
    (native) => {
      renderToStaticMarkup(
        createElement(TaskDetailContent, {
          detail: data(native),
          taskId: "T-10001",
          canEdit: true,
          onSaved: vi.fn(),
          onEditingChange: vi.fn(),
        }),
      );
      expect(state.reads).toBe(0);
    },
  );
  it.each([false, true])(
    "mounts the review reader only when its panel is explicitly opened (native=%s)",
    (native) => {
      const props = collapse(
        TaskDetailContent({
          detail: data(native),
          taskId: "T-10001",
          canEdit: true,
          onSaved: vi.fn(),
          onEditingChange: vi.fn(),
        }),
      );
      expect(props).toBeDefined();
      renderToStaticMarkup(
        createElement(Collapse, { ...props, activeKey: [props.items[0].key] }),
      );
      expect(state.reads).toBe(1);
    },
  );
});
