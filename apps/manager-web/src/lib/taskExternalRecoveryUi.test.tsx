/** Actual original-only recovery callbacks; definitions remain UNRUN. */
import { isValidElement, type ReactNode } from "react";
import { Button } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmissionController } from "./deliveryTaskSubmission";
import { createWorkOrderController } from "./externalWorkOrderCommand";
import { TaskExternalRecovery, TaskExternalRecoveryOwner } from "../../subapps/ai-rd-center/src/pages/delivery/TaskExternalRecovery";
import { ExecutionRouteRecoveryGate, executionRouteRecoverySelection } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRouteRecoveryGate";
import { retainedAck, retainedSubmission, retainedWorkOrder } from "./taskExternalRecoveryFixtures";
import type { WorkOrderAction } from "./externalWorkOrderCommand";
const h = vi.hoisted(() => ({ slots: [] as any[], next: 0, originals: [] as string[], orders: [] as string[], discoveryError: false, scope: "scope", pending: vi.fn(), invalidate: vi.fn() }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useRef: (initial: any) => { const at = h.next++; return h.slots[at] ||= { current: initial }; },
  useState: (initial: any) => { const at = h.next++; if (!(at in h.slots)) h.slots[at] = initial; return [h.slots[at], (value: any) => { h.slots[at] = typeof value === "function" ? value(h.slots[at]) : value; }]; },
  useEffect: () => {}, useMemo: (factory: () => unknown) => factory(), useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-US" } }) }));
vi.mock("./deliveryTaskSubmission", async () => ({ ...await vi.importActual<typeof import("./deliveryTaskSubmission")>("./deliveryTaskSubmission"), discoverSubmissionRecovery: () => { if (h.discoveryError) throw new Error("retainedOriginalUnavailable"); return h.originals; }, externalDeliveryRecoveryPending: (_p: string, task: string) => h.originals.includes(task) }));
vi.mock("./externalWorkOrderCommand", async () => ({ ...await vi.importActual<typeof import("./externalWorkOrderCommand")>("./externalWorkOrderCommand"), discoverWorkOrderRecovery: () => h.orders, workOrderRecoveryPending: (_p: string, task: string) => h.orders.includes(task) }));
vi.mock("./taskEditCommand", async () => ({ ...await vi.importActual<typeof import("./taskEditCommand")>("./taskEditCommand"), discoverTaskEditRecovery: () => [], taskEditRecoveryPending: () => false }));
vi.mock("./executionDispatchCommand", async () => ({ ...await vi.importActual<typeof import("./executionDispatchCommand")>("./executionDispatchCommand"), executionDispatchRecoveryPending: () => false }));
vi.mock("./authStorage", async () => ({ ...await vi.importActual<typeof import("./authStorage")>("./authStorage"), getProjectId: () => "P" }));
vi.mock("./projectPortfolio", async () => ({ ...await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio"), projectSessionKey: () => h.scope }));
vi.mock("./executionExitGuard", () => ({ useExecutionExitGuard: () => ({ setPending: h.pending }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
function render(run: () => ReactNode) { h.next = 0; return run(); }
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...["children", "action", "description"].flatMap((key) => nodes(node.props[key]))]; }
function action(tree: ReactNode, key: string) { return nodes(tree).find((node) => node.type === Button && node.props["data-action"] === key)!.props; }
beforeEach(() => { h.slots = []; h.next = 0; h.originals = []; h.orders = []; h.discoveryError = false; h.scope = "scope"; h.pending.mockReset(); h.invalidate.mockReset(); vi.stubGlobal("location", { hash: "#/dev-flow?project_id=P&task=T" }); });
afterEach(() => vi.unstubAllGlobals());
describe("recovery with unavailable current Task, requirement and workspace facts", () => {
  it.each([
    ["work_order.create", "Dispatch work order"], ["work_order.claim", "Claim with this account"], ["work_order.progress", "Report current progress"],
    ["work_order.cancel", "Cancel work order"], ["work_order.release", "Attest external work stopped"], ["work_order.report", "Link fixed delivery report"],
    ["task.delivery.submit", "Submit external work"], ["task.delivery.review", "Review delivery"],
  ])("names the retained %s operation before its raw details", (actionName, label) => {
    const kind = actionName.startsWith("work_order.") ? "work-order" : "submission", original = kind === "submission" ? retainedSubmission(actionName === "task.delivery.review") : retainedWorkOrder();
    if (kind === "work-order" && actionName !== "work_order.create") Object.assign(original, { action: actionName as WorkOrderAction,
      binding: { task_id: "T", work_order_id: "W", request_digest: "a".repeat(64), packet_digest: "a".repeat(64), state: "claimed" },
      payload: { id: "W", order_revision: 2, ...(actionName === "work_order.progress" ? { percent: 20, status: "running", message: "Original progress" } : actionName === "work_order.cancel" ? { comment: "Original cancellation" } : actionName === "work_order.release" ? { stopped_attestation: true, comment: "Original stop" } : actionName === "work_order.report" ? { stopped_attestation: true, submission_id: "S", submission_digest: "a".repeat(64) } : {}) } });
    const options: any = { projectId: "P", taskId: "T", scope: "scope", currentScope: () => h.scope, load: () => JSON.stringify({ phase: "unknown", original }), save: vi.fn(), send: vi.fn() };
    const command = kind === "submission" ? createSubmissionController(options) : createWorkOrderController(options);
    const tree = render(() => TaskExternalRecovery({ projectId: "P", taskId: "T", kind, command: { ...command, state: command.snapshot() } as any, onSaved: vi.fn() }));
    expect(nodes(tree).find((node) => node.type === "strong")?.props.children).toBe(label); expect(command.snapshot().original).toEqual(original);
  });
  it("distinguishes a mismatched receipt from unavailable storage and preserves its diagnostics", () => {
    const original = retainedSubmission(), raw = JSON.stringify({ phase: "unknown", original, error: "ackMismatch" });
    const command = createSubmissionController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => h.scope, load: () => raw, save: vi.fn(), send: vi.fn() });
    const tree = render(() => TaskExternalRecovery({ projectId: "P", taskId: "T", kind: "submission", command: { ...command, state: command.snapshot() }, onSaved: vi.fn() }));
    expect(JSON.stringify(tree)).toContain("does not match the original request"); expect(JSON.stringify(tree)).toContain("ackMismatch"); expect(action(tree, "recover-submission")).toBeDefined();
  });
  it.each(["submission", "work-order"] as const)("cleans a known %s ACK locally without GET or sending again", async (kind) => {
    const original = kind === "submission" ? retainedSubmission() : retainedWorkOrder(); let raw = JSON.stringify({ phase: "succeeded", original, ack: retainedAck(original) });
    const send = vi.fn(), saved = vi.fn(), resolved = vi.fn(), options: any = { projectId: "P", taskId: "T", scope: "scope", currentScope: () => h.scope, load: () => raw, save: (value: string) => { raw = value; }, send };
    const controller = kind === "submission" ? createSubmissionController(options) : createWorkOrderController(options);
    const tree = () => render(() => TaskExternalRecovery({ projectId: "P", taskId: "T", kind, command: { ...controller, state: controller.snapshot() } as any, onSaved: saved, onResolved: resolved }));
    expect(JSON.stringify(tree())).toContain(original.intent.key); await action(tree(), `finish-${kind}-original`).onClick();
    expect(controller.snapshot().phase).toBe("idle"); expect(raw).toBe(""); expect(saved).toHaveBeenCalledWith(retainedAck(original), original); expect(resolved).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled();
  });
  it("replays one unchanged S/W original and leaves a confirmed receipt if local cleanup fails", async () => {
    const original = retainedSubmission(); let raw = JSON.stringify({ phase: "unknown", original }), refuseClear = true;
    const send = vi.fn(async (value) => { expect(value).toEqual(original); return retainedAck(original); }), saved = vi.fn();
    const controller = createSubmissionController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => h.scope, load: () => raw, save: (value) => { if (!value && refuseClear) throw new Error("Quota unavailable"); raw = value; }, send });
    const tree = () => render(() => TaskExternalRecovery({ projectId: "P", taskId: "T", kind: "submission", command: { ...controller, state: controller.snapshot() }, onSaved: saved }));
    await action(tree(), "recover-submission").onClick(); expect(send).toHaveBeenCalledOnce(); expect(controller.snapshot().phase).toBe("succeeded"); expect(saved).not.toHaveBeenCalled();
    refuseClear = false; await action(tree(), "finish-submission-original").onClick(); expect(send).toHaveBeenCalledOnce(); expect(saved).toHaveBeenCalledOnce();
  });
  it("cannot replay, discard or clear from a callback captured before an account/route change", async () => {
    const original = retainedWorkOrder(); let raw = JSON.stringify({ phase: "unknown", original }); const send = vi.fn(async () => retainedAck(original));
    const controller = createWorkOrderController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => h.scope, load: () => raw, save: (value) => { raw = value; }, send });
    const tree = render(() => TaskExternalRecovery({ projectId: "P", taskId: "T", kind: "work-order", command: { ...controller, state: controller.snapshot() }, onSaved: vi.fn() }));
    const before = raw; h.scope = "other"; await action(tree, "recover-work-order").onClick(); expect(send).not.toHaveBeenCalled(); expect(raw).toBe(before);
  });
  it("keeps a corrupted original closed to replay and local discard", () => {
    const raw = "broken original", save = vi.fn(), send = vi.fn();
    const command = createSubmissionController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => h.scope, load: () => raw, save, send });
    const tree = render(() => TaskExternalRecovery({ projectId: "P", taskId: "T", kind: "submission", command: { ...command, state: command.snapshot() }, onSaved: vi.fn() }));
    expect(command.snapshot().phase).toBe("unknown"); expect(nodes(tree).filter((node) => node.type === Button)).toHaveLength(0); expect(save).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it("offers a guarded page reload after an initial storage outage without clearing or inventing an original", () => {
    const reload = vi.fn(), save = vi.fn(), send = vi.fn(); vi.stubGlobal("window", { location: { reload } });
    const command = createSubmissionController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => h.scope, load: () => { throw new Error("retainedOriginalUnavailable"); }, save, send });
    const tree = render(() => TaskExternalRecovery({ projectId: "P", taskId: "T", kind: "submission", command: { ...command, state: command.snapshot() }, onSaved: vi.fn() }));
    const retry = action(tree, "reload-submission-recovery"); retry.onClick(); expect(reload).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    h.scope = "other-account"; retry.onClick(); expect(reload).toHaveBeenCalledOnce();
  });
  it("does not clear a confirmed receipt from a stale account callback", () => {
    const original = retainedWorkOrder(); let raw = JSON.stringify({ phase: "succeeded", original, ack: retainedAck(original) }); const saved = vi.fn(), send = vi.fn();
    const command = createWorkOrderController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => h.scope, load: () => raw, save: (value) => { raw = value; }, send });
    const tree = render(() => TaskExternalRecovery({ projectId: "P", taskId: "T", kind: "work-order", command: { ...command, state: command.snapshot() }, onSaved: saved })), previous = raw;
    h.scope = "another-account"; action(tree, "finish-work-order-original").onClick(); expect(raw).toBe(previous); expect(saved).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it("discovers a retained report before mounting fresh child context queries and rejects conflicting route identities", () => {
    h.originals = ["T"];
    expect(executionRouteRecoverySelection("#/dev-flow?project_id=P&task=T", "P")).toEqual({ projectId: "P", kind: "submission", id: "T" });
    expect(executionRouteRecoverySelection("#/tasks/execution?project_id=P", "P")).toEqual({ projectId: "P", kind: "submission", id: "T" });
    for (const bad of ["#/tasks/execution?project_id=Q&task_id=T", "#/tasks/execution?project_id=P&task_id=T&task_id=Other", "#/tasks/execution?project_id=P&task=T&task_id=Other"]) expect(executionRouteRecoverySelection(bad, "P")).toBeNull();
  });
  it("starts at the actual W/S recovery owner and only renders fresh children after both originals finish", () => {
    h.originals = ["T"]; h.orders = ["OtherTask"];
    const child = "fresh context child", gate = () => render(() => ExecutionRouteRecoveryGate({ children: child }));
    const owner = () => nodes(gate()).find((node) => node.type === TaskExternalRecoveryOwner)!.props;
    expect(owner()).toMatchObject({ kind: "submission", taskId: "T" }); expect(gate()).not.toBe(child);
    const first = owner(); first.onPending(true); h.originals = []; first.onResolved();
    expect(owner()).toMatchObject({ kind: "work-order", taskId: "OtherTask" }); expect(gate()).not.toBe(child);
    const second = owner(); h.orders = []; second.onResolved(); expect(gate()).toBe(child);
    first.onPending(true); expect(gate()).toBe(child);
  });
  it("keeps startup children unavailable when discovering current-session originals fails", () => {
    h.discoveryError = true; const child = "fresh context child", gate = () => render(() => ExecutionRouteRecoveryGate({ children: child }));
    expect(gate()).not.toBe(child); expect(nodes(gate()).some((node) => node.type === TaskExternalRecoveryOwner)).toBe(false);
    h.discoveryError = false; const retry = nodes(gate()).find((node) => node.type === Button)!.props; retry.onClick(); expect(gate()).toBe(child);
  });
});
