/** Source-first definitions; execution is deferred by the user. */
import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeliveryTask } from "./delivery";
import { focusTaskSection, taskDetailNextSection } from "./taskDetailNavigation";
import { TaskDetailNavigation } from "../../subapps/ai-rd-center/src/pages/delivery/TaskDetailWorkspace";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }) }));
function nodes(value: ReactNode): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return isValidElement<any>(value) ? [value, ...nodes(value.props.children)] : [];
}
const task = (patch: Partial<DeliveryTask> = {}) => ({ id: "T", title: "Task", recorded_status: "pending", status: "pending", delivery_status: "pending", verified: false, execution_gate: { eligible: true, reasons: [] }, ...patch }) as DeliveryTask;
afterEach(() => vi.unstubAllGlobals());

describe("task detail reading and next handling entry", () => {
  it("offers one keyboard button for each real area and delegates reading only", () => {
    const navigate = vi.fn();
    const tree = TaskDetailNavigation({ task: task(), onNavigate: navigate });
    const buttons = nodes(tree).filter((node) => node.type === "button");
    expect(buttons.map((node) => node.props["data-task-jump"])).toEqual(["overview", "execution", "work-order", "design", "delivery", "planning", "discussion"]);
    for (const node of buttons) { expect(node.props.type).toBe("button"); node.props.onClick(); }
    expect(navigate.mock.calls.map(([key]) => key)).toEqual(buttons.map((node) => node.props["data-task-jump"]));
    expect(nodes(tree).some((node) => node.type === "a")).toBe(false);
  });
  it.each([
    [{ verified: true, delivery_status: "verified_completed" }, null],
    [{ verified: false, delivery_status: "verified_completed", recorded_status: "completed" }, "delivery"],
    [{ delivery_status: "awaiting_review", execution_id: "E" }, "execution"],
    [{ delivery_status: "awaiting_review" }, "delivery"],
    [{ delivery_status: "blocked", execution_id: "E" }, "execution"],
    [{ delivery_status: "blocked", dependency_blocked: ["T-dependency"] }, "planning"],
    [{ delivery_status: "in_progress", execution_id: "E" }, "execution"],
    [{ delivery_status: "in_progress" }, null],
    [{ delivery_status: "blocked" }, null],
    [{ delivery_status: "recorded_completed", recorded_status: "completed" }, "delivery"],
  ] as const)("uses effective facts without claiming execution or acceptance from a record: %o", (patch, expected) => {
    expect(taskDetailNextSection(task(patch as Partial<DeliveryTask>))).toBe(expected);
  });
  it("stays within the current mounted workspace, preserves the route, and respects reduced motion", () => {
    const target = { focus: vi.fn(), scrollIntoView: vi.fn() }, querySelector = vi.fn(() => target);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const root = { querySelector } as unknown as HTMLElement;
    expect(focusTaskSection(root, "design", () => true)).toBe(true);
    expect(querySelector).toHaveBeenCalledWith('[data-task-section="design"]');
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    expect(focusTaskSection(root, "design", () => false)).toBe(false);
    expect(querySelector).toHaveBeenCalledTimes(1);
  });
  it("does not fall through to another task when a region has not loaded", () => {
    expect(focusTaskSection(null, "execution", () => true)).toBe(false);
    expect(focusTaskSection({ querySelector: () => null } as unknown as HTMLElement, "execution", () => true)).toBe(false);
  });
});
