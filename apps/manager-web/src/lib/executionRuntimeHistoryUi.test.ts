import { isValidElement, type ReactNode } from "react";
import { Button, Collapse } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryExecutionPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionPanel";
import { ExecutionObservationCard } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionObservationCard";
import type { DeliveryTask, DeliveryWorkspace } from "./delivery";
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as any[],
  index: 0,
  refIndex: 0,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useRef: (initial: unknown) => {
    const i = hooks.refIndex++;
    return (hooks.refs[i] ??= { current: initial });
  },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (next: any) => {
        hooks.values[index] =
          typeof next === "function" ? next(hooks.values[index]) : next;
      },
    ];
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isPending: false, isError: false }),
}));
const data = {
  project: { id: "P" },
  version: 7,
  permissions: { write: true },
  executions: ["old-one", "old-two", "current"].map((id) => ({
    id,
    task_id: "T",
    status: "cancelled",
    created_at: "2026-10-17T00:00:00Z",
    attempt: 1,
  })),
} as unknown as DeliveryWorkspace;
const task = {
  id: "T",
  req_id: "",
  status: "blocked",
  acceptance: { available: true },
  execution_gate: { eligible: true, reasons: [] },
} as unknown as DeliveryTask;
const render = () => {
  hooks.index = 0;
  hooks.refIndex = 0;
  return DeliveryExecutionPanel({
    data,
    task,
    sessionId: "s",
    onCommand: async () => {},
    onSaved: () => {},
  });
};
function collect(node: ReactNode, type: unknown): any[] {
  if (Array.isArray(node)) return node.flatMap((child) => collect(child, type));
  if (!isValidElement<any>(node)) return [];
  return [
    ...(node.type === type ? [node.props] : []),
    ...collect(node.props.children, type),
    ...(node.type === Collapse
      ? collect(
          node.props.items.map((item: any) => item.children),
          type,
        )
      : []),
  ];
}
beforeEach(() => {
  hooks.values = [];
  hooks.refs = [];
  hooks.index = 0;
  hooks.refIndex = 0;
});
describe("execution history is opened precisely on demand", () => {
  it("mounts only the current record and one explicitly chosen historical record", () => {
    expect(
      collect(render(), ExecutionObservationCard).map((card) => card.entry.id),
    ).toEqual(["current"]);
    collect(render(), Button)
      .find(
        (button) => button.children === "deliveryExecutionRuntime.openHistory",
      )
      .onClick();
    expect(
      collect(render(), ExecutionObservationCard).map((card) => card.entry.id),
    ).toEqual(["current", "old-two"]);
    collect(render(), Button)
      .find(
        (button) => button.children === "deliveryExecutionRuntime.openHistory",
      )
      .onClick();
    expect(
      collect(render(), ExecutionObservationCard).map((card) => card.entry.id),
    ).toEqual(["current", "old-one"]);
  });
  it("prevents switching or hiding history while its action result is unresolved", () => {
    collect(render(), Button)
      .find(
        (button) => button.children === "deliveryExecutionRuntime.openHistory",
      )
      .onClick();
    collect(render(), ExecutionObservationCard)
      .find((card) => card.entry.id === "old-two")
      .onUnresolvedChange(true);
    expect(collect(render(), Collapse)[0].collapsible).toBe("disabled");
    expect(
      collect(render(), Button)
        .filter((button) => /History$/.test(String(button.children)))
        .every((button) => button.disabled),
    ).toBe(true);
  });
});
