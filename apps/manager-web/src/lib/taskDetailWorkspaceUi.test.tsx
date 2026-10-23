/** Actual workspace callbacks, source definitions only; not runtime proof. */
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetailNavigation, TaskDetailWorkspace } from "../../subapps/ai-rd-center/src/pages/delivery/TaskDetailWorkspace";
import type { DeliveryTask } from "./delivery";

const h = vi.hoisted(() => ({ refs: [] as any[], next: 0, scope: "session-a", cleanup: undefined as (() => void) | undefined }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useRef: (value: any) => { const index = h.next++; return h.refs[index] ||= { current: value }; },
  useEffect: (fn: () => (() => void)) => { h.cleanup ||= fn(); },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }) }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => h.scope }));
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<any>(node) ? [node, ...nodes(node.props.children)] : [];
}
const task = { id: "T", status: "completed", recorded_status: "completed", verified: false, delivery_status: "recorded_completed" } as DeliveryTask;
function render(patch: Record<string, any> = {}) { h.next = 0; return TaskDetailWorkspace({ scope: "P:s:T", task, isActive: () => true, children: <section data-task-section="delivery">retained-operation</section>, ...patch }); }
beforeEach(() => { h.refs = []; h.next = 0; h.scope = "session-a"; h.cleanup = undefined; });
afterEach(() => { h.cleanup?.(); vi.unstubAllGlobals(); });

describe("mounted task reading workspace", () => {
  it("separates recorded and verified completion and never manufactures accepted status", () => {
    const tree = render(), text = JSON.stringify(tree);
    expect(text).toContain("deliveryManualReview.recordedCompleted");
    expect(text).toContain("deliveryProgress.states.recorded_completed");
    expect(text).toContain("记录完成仍需核对");
    expect(text).not.toContain("已按当前条件验收");
    expect(JSON.stringify(render({ task: { ...task, verified: false, delivery_status: "verified_completed" } }))).not.toContain("deliveryProgress.states.verified_completed");
    expect(JSON.stringify(render({ task: { ...task, verified: true, delivery_status: "verified_completed" } }))).toContain("已按当前条件验收");
  });
  it("keeps children visible and mounted when facts fail and disables only unavailable regions", () => {
    const child = <div>original-recovery-owner</div>, first = render({ children: child }), failed = render({ children: child, task: undefined });
    expect(first.props.children.at(-1)).toBe(child); expect(failed.props.children.at(-1)).toBe(child);
    expect(JSON.stringify(failed)).not.toContain('"hidden":true');
    const directory = nodes(failed).find((node) => node.type === TaskDetailNavigation);
    const buttons = nodes(TaskDetailNavigation(directory.props)).filter((node) => node.type === "button");
    expect(buttons.filter((node) => !node.props.disabled).map((node) => node.props["data-task-jump"])).toEqual(["work-order", "design", "delivery"]);
  });
  it("labels pinned editing facts and avoids current-acceptance or next-step claims", () => {
    const snapshot = { ...task, verified: true, delivery_status: "verified_completed" };
    const fixed = JSON.stringify(render({ task: snapshot, frozen: true }));
    expect(fixed).toContain("快照交付状态");
    expect(fixed).toContain("编辑开始时的固定任务快照");
    expect(fixed).not.toContain("已按当前条件验收");
    expect(JSON.stringify(render({ frozen: true }))).not.toContain("查看下一步处理区域");
  });
  it.each(["parent", "session", "scope", "unmount"])("revokes an old directory callback after %s changes", (change) => {
    let allowed = true;
    const tree = render({ isActive: () => allowed }), directory = nodes(tree).find((node) => node.type === TaskDetailNavigation);
    const target = { focus: vi.fn(), scrollIntoView: vi.fn() }, querySelector = vi.fn(() => target);
    h.refs[0].current = { querySelector };
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    directory.props.onNavigate("delivery"); expect(target.focus).toHaveBeenCalledOnce();
    if (change === "parent") allowed = false;
    if (change === "session") h.scope = "session-b";
    if (change === "scope") render({ scope: "P:s:another-task" });
    if (change === "unmount") h.cleanup?.();
    directory.props.onNavigate("delivery"); expect(querySelector).toHaveBeenCalledTimes(1);
  });
});
