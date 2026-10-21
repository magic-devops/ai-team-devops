import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Select } from "antd";
import { TaskDispatchHost } from "../../subapps/ai-rd-center/src/pages/delivery/TaskDispatchHost";
import { ExecutionPlanEditor } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionPlanEditor";
import { fetchDeliveryTaskEditData } from "./deliveryQuery";
import { fetchDeliveryTargets } from "./deliveryExecution";
import { fetchTeamRuntimeBindings } from "./deliveryTeamRuntime";
import { readSubmissionDetail } from "./deliveryTaskSubmission";
import { readWorkOrderCurrent } from "./externalWorkOrders";
const h = vi.hoisted(() => ({ slots: [] as any[], next: 0, effects: [] as Array<() => void>, scope: "scope" }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useRef: (initial: any) => { const at = h.next++; return h.slots[at] ||= { current: initial }; }, useState: (initial: any) => { const at = h.next++; if (!(at in h.slots)) h.slots[at] = typeof initial === "function" ? initial() : initial; return [h.slots[at], (value: any) => { h.slots[at] = typeof value === "function" ? value(h.slots[at]) : value; }]; }, useCallback: (callback: unknown) => callback, useEffect: (effect: () => void) => { h.effects.push(effect); } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en-US" }, t: (key: string) => key }) }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => h.scope }));
vi.mock("./deliveryQuery", async () => ({ ...await vi.importActual<typeof import("./deliveryQuery")>("./deliveryQuery"), fetchDeliveryTaskEditData: vi.fn() }));
vi.mock("./deliveryExecution", async () => ({ ...await vi.importActual<typeof import("./deliveryExecution")>("./deliveryExecution"), fetchDeliveryTargets: vi.fn() }));
vi.mock("./deliveryTeamRuntime", async () => ({ ...await vi.importActual<typeof import("./deliveryTeamRuntime")>("./deliveryTeamRuntime"), fetchTeamRuntimeBindings: vi.fn() }));
vi.mock("./deliveryTaskSubmission", async () => ({ ...await vi.importActual<typeof import("./deliveryTaskSubmission")>("./deliveryTaskSubmission"), readSubmissionDetail: vi.fn() }));
vi.mock("./externalWorkOrders", async () => ({ ...await vi.importActual<typeof import("./externalWorkOrders")>("./externalWorkOrders"), readWorkOrderCurrent: vi.fn() }));
function frame(render: () => ReactNode) { h.next = 0; h.effects = []; return render(); }
function nodes(node: ReactNode): ReactElement<any>[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...["children", "footer", "action"].flatMap((key) => nodes(node.props[key]))]; }
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
const task: any = { project: { id: "P" }, version: 7, planning_basis: "f".repeat(64), permissions: { write: true }, members: [{ id: "agent:one", name: "Bound agent" }], dependencies: [], requirement: null, task: { id: "T", req_id: "", title: "Task", basis: "a".repeat(64), execution_gate: { eligible: true, reasons: [] } } };
const target: any = { id: "local", kind: "local", can_execute: true, basis: "c".repeat(64), reason_codes: [], runtime_capabilities: ["agent", "command"], policy: { allowed_runtimes: ["agent", "command"], allowed_providers: ["codex"] }, providers: [{ id: "codex", executable_present: true }] };
const targets: any = { project_id: "P", can_execute: true, runtime_configured: true, workspaces: [{ id: "W", name: "Workspace", agents: [{ id: "A", version: 2, title: "Profile", provider: "codex" }], local: target, devices: [] }] };
const bindings: any = { project_id: "P", members: [{ member_id: "agent:one", status: "current", binding_basis: "b".repeat(64), binding: { workspace_id: "W", agent_id: "A", agent_version: 2 } }] };
const feedbackA = { submission_id: "S", submission_digest: "d".repeat(64), decision_id: "D" };
const feedbackB = { submission_id: "S2", submission_digest: "e".repeat(64), decision_id: "D2" };
function report(ref = feedbackA): any { return { project_id: "P", task_id: "T", submission: { id: ref.submission_id, digest: ref.submission_digest, invalidated: true }, decision: { id: ref.decision_id, decision: "request_changes" } }; }
function queue(): any { return { state: { phase: "idle" }, snapshot: () => ({ phase: "idle" }), current: () => true, locked: false, run: vi.fn() }; }
function choose(tree: ReactNode, label: string, value: string) { nodes(tree).find((node) => node.type === Select && node.props["aria-label"] === label)!.props.onChange(value); }
async function next(tree: ReactNode) { await nodes(tree).find((node) => node.type === Button && node.props.children === "Continue")!.props.onClick(); await settle(); }
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  const location = { hash: "#/tasks/execution?project_id=P&task_id=T&task_dispatch=1&dispatch_task=T" };
  vi.stubGlobal("location", location); vi.stubGlobal("window", new EventTarget()); vi.stubGlobal("history", { state: null, replaceState: vi.fn((_state, _title, href) => { location.hash = href; }) });
  vi.mocked(readSubmissionDetail).mockReset().mockImplementation(async (_p, _t, id) => report(id === "S2" ? feedbackB : feedbackA));
  h.slots = []; h.effects = []; h.scope = "scope"; vi.mocked(fetchDeliveryTaskEditData).mockResolvedValue(structuredClone(task)); vi.mocked(fetchDeliveryTargets).mockResolvedValue(structuredClone(targets)); vi.mocked(fetchTeamRuntimeBindings).mockResolvedValue(structuredClone(bindings)); vi.mocked(readWorkOrderCurrent).mockResolvedValue({ task_id: "T", project_id: "P", can_dispatch: true, active_work_order_id: null, executors: [{ id: "agent:one", name: "Bound agent", kind: "agent", active: true, available: true }], reasons: [] } as any); });
describe("one Task dispatch choice (source definitions only)", () => {
  it("prefills the existing Agent editor from a real binding without posting or silently creating W", async () => {
    const external = vi.fn(), queue: any = { state: { phase: "idle" }, snapshot: () => ({ phase: "idle" }), current: () => true, locked: false, run: vi.fn() };
    const read = () => frame(() => TaskDispatchHost({ projectId: "P", taskId: "T", sessionId: "s", requestOpen: 1, queueCommand: queue, onExternal: external, onSaved: vi.fn() }));
    read(); h.effects.forEach((effect) => effect()); await settle();
    let tree = read(); nodes(tree).find((node) => node.type === Select && node.props["aria-label"] === "Delivery method")!.props.onChange("agent");
    tree = read(); nodes(tree).find((node) => node.type === Select && node.props["aria-label"] === "Execution member")!.props.onChange("agent:one");
    tree = read(); await nodes(tree).find((node) => node.type === Button && node.props.children === "Continue")!.props.onClick(); await settle();
    const editor = nodes(read()).find((node) => node.type === ExecutionPlanEditor)!;
    expect(editor.props.initial).toMatchObject({ executorMemberId: "agent:one", executorBindingBasis: "b".repeat(64), workspaceId: "W", agentId: "A", agentVersion: 2 });
    expect(external).not.toHaveBeenCalled(); expect(queue.run).not.toHaveBeenCalled();
  });
  it("does not convert an active external work order into native execution", async () => {
    vi.mocked(readWorkOrderCurrent).mockResolvedValue({ project_id: "P", task_id: "T", can_dispatch: false, active_work_order_id: "W-active", executors: [], reasons: [] } as any);
    const queue: any = { state: { phase: "idle" }, snapshot: () => ({ phase: "idle" }), current: () => true, locked: false };
    const read = () => frame(() => TaskDispatchHost({ projectId: "P", taskId: "T", sessionId: "s", requestOpen: 1, queueCommand: queue, onExternal: vi.fn(), onSaved: vi.fn() }));
    read(); h.effects.forEach((effect) => effect()); await settle();
    const tree = read(), method = nodes(tree).find((node) => node.type === Select && node.props["aria-label"] === "Delivery method")!;
    expect(method.props.options.find((item: any) => item.value === "agent").disabled).toBe(true);
  });
});

it("keeps command and external collaboration explicit, using the same native editor or exact W request", async () => {
  let external = vi.fn(() => true), q = queue();
  const read = () => frame(() => TaskDispatchHost({ projectId: "P", taskId: "T", sessionId: "s", requestOpen: 1, feedbackReference: feedbackA, queueCommand: q, onExternal: external, onSaved: vi.fn() }));
  read(); h.effects.forEach((effect) => effect()); await settle(); choose(read(), "Delivery method", "command"); await next(read());
  expect(nodes(read()).find((node) => node.type === ExecutionPlanEditor)?.props.initial).toMatchObject({ mode: "command", feedback_reference: feedbackA });
  expect(q.run).not.toHaveBeenCalled(); expect(external).not.toHaveBeenCalled();
  h.slots = []; { read(); h.effects.forEach((effect) => effect()); await settle(); choose(read(), "Delivery method", "external"); choose(read(), "Execution member", "agent:one"); await next(read()); }
  expect(external).toHaveBeenCalledWith({ executorId: "agent:one", feedback_reference: feedbackA }); expect(q.run).not.toHaveBeenCalled();
});
it("leaves multiple eligible targets for an explicit target choice and requires adoption when formal binding changes", async () => {
  const multiple = structuredClone(targets); multiple.workspaces[0].devices = [{ ...target, id: "D", kind: "device" }]; vi.mocked(fetchDeliveryTargets).mockResolvedValue(multiple);
  const q = queue(), read = () => frame(() => TaskDispatchHost({ projectId: "P", taskId: "T", sessionId: "s", requestOpen: 1, queueCommand: q, onExternal: vi.fn(() => true), onSaved: vi.fn() }));
  read(); h.effects.forEach((effect) => effect()); await settle(); choose(read(), "Delivery method", "agent"); choose(read(), "Execution member", "agent:one");
  const changed = structuredClone(bindings); changed.members[0].binding.agent_version = 3; vi.mocked(fetchTeamRuntimeBindings).mockResolvedValue(changed);
  await next(read()); expect(nodes(read()).some((node) => node.type === ExecutionPlanEditor)).toBe(false);
  expect(nodes(read()).some((node) => node.type === Button && node.props.children === "Use the current facts and select again")).toBe(true);
  vi.mocked(fetchTeamRuntimeBindings).mockResolvedValue(structuredClone(bindings));
  choose(read(), "Execution member", "agent:one"); await next(read());
  expect(nodes(read()).find((node) => node.type === ExecutionPlanEditor)?.props.initial.target).toBeNull(); expect(q.run).not.toHaveBeenCalled();
});
it("waits for the latest same-Task feedback source after a cancelled A read and opens B only", async () => {
  let release!: (value: any) => void; vi.mocked(fetchDeliveryTaskEditData).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  let count = 1, ref = feedbackA; const q = queue(), read = () => frame(() => TaskDispatchHost({ projectId: "P", taskId: "T", sessionId: "s", requestOpen: count, feedbackReference: ref, queueCommand: q, onExternal: vi.fn(() => true), onSaved: vi.fn() }));
  read(); h.effects.forEach((effect) => effect()); count = 2; ref = feedbackB; location.hash += `&feedback_submission=S2&feedback_digest=${feedbackB.submission_digest}&feedback_decision=D2`; read(); h.effects.forEach((effect) => effect());
  release(structuredClone(task)); await settle(); read(); h.effects.forEach((effect) => effect()); await settle();
  choose(read(), "Delivery method", "command"); await next(read());
  expect(nodes(read()).find((node) => node.type === ExecutionPlanEditor)?.props.initial.feedback_reference).toEqual(feedbackB); expect(q.run).not.toHaveBeenCalled();
});
it("offers an explicit read-only retry after same-source S/W navigation cancels its pending read", async () => {
  let release!: (value: any) => void, live = true; vi.mocked(fetchDeliveryTaskEditData).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  let q = { ...queue(), current: () => live }; const read = () => frame(() => TaskDispatchHost({ projectId: "P", taskId: "T", sessionId: "s", requestOpen: 1, queueCommand: q, onExternal: vi.fn(() => true), onSaved: vi.fn() }));
  read(); h.effects.forEach((effect) => effect()); location.hash += "&work_order_id=W"; live = false; q = queue(); read(); h.effects.forEach((effect) => effect()); release(structuredClone(task)); await settle();
  const retry = nodes(read()).find((node) => node.type === Button && node.props.children === "Read current capabilities")!;
  await retry.props.onClick(); await settle(); expect(nodes(read()).some((node) => node.type === Select && node.props["aria-label"] === "Delivery method")).toBe(true); expect(q.run).not.toHaveBeenCalled();
});
it("pins native editor callbacks to the original feedback and cannot close an unknown original", async () => {
  const q = queue(); let ref = feedbackA, count = 1;
  const read = () => frame(() => TaskDispatchHost({ projectId: "P", taskId: "T", sessionId: "s", requestOpen: count, feedbackReference: ref, queueCommand: q, onExternal: vi.fn(() => true), onSaved: vi.fn() }));
  read(); h.effects.forEach((effect) => effect()); await settle(); choose(read(), "Delivery method", "command"); await next(read());
  const old = nodes(read()).find((node) => node.type === ExecutionPlanEditor)!; expect(old.props.isActive()).toBe(true);
  ref = feedbackB; count++; read(); expect(old.props.isActive()).toBe(true); expect(old.props.canSubmit()).toBe(false);
  q.snapshot = () => ({ phase: "unknown" }); old.props.onClose(); expect(history.replaceState).not.toHaveBeenCalled(); expect(nodes(read()).some((node) => node.type === ExecutionPlanEditor)).toBe(true);
  q.snapshot = () => ({ phase: "idle" }); old.props.onClose(); expect(nodes(read()).some((node) => node.type === ExecutionPlanEditor)).toBe(false); expect(q.run).not.toHaveBeenCalled();
});
it("never silently selects a different report when the exact feedback read fails", async () => {
  vi.mocked(readSubmissionDetail).mockRejectedValue(new Error("HTTP 404")); const q = queue();
  const read = () => frame(() => TaskDispatchHost({ projectId: "P", taskId: "T", sessionId: "s", requestOpen: 1, feedbackReference: feedbackA, queueCommand: q, onExternal: vi.fn(() => true), onSaved: vi.fn() }));
  read(); h.effects.forEach((effect) => effect()); await settle(); expect(nodes(read()).some((node) => node.type === Select)).toBe(false); expect(readSubmissionDetail).toHaveBeenCalledWith("P", "T", "S", "scope"); expect(q.run).not.toHaveBeenCalled();
});
it("does not open a second task draft when another editor starts during capability reads", async () => {
  let release!: (value: any) => void, canStart = true;
  vi.mocked(fetchDeliveryTaskEditData).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const q = queue(), editing = vi.fn(), external = vi.fn(() => true);
  const read = () => frame(() => TaskDispatchHost({ projectId: "P", taskId: "T", sessionId: "s", requestOpen: 1, queueCommand: q, onExternal: external, onSaved: vi.fn(), onEditingChange: editing, canStart: () => canStart }));
  read(); h.effects.forEach((effect) => effect()); canStart = false; read(); release(structuredClone(task)); await settle();
  expect(nodes(read()).some((node) => node.type === Select)).toBe(false); expect(editing).not.toHaveBeenCalledWith(true);
  expect(q.run).not.toHaveBeenCalled(); expect(external).not.toHaveBeenCalled();
  canStart = true; const retry = nodes(read()).find((node) => node.type === Button && node.props.children === "Read current capabilities")!;
  await retry.props.onClick(); await settle(); expect(nodes(read()).some((node) => node.type === Select && node.props["aria-label"] === "Delivery method")).toBe(true);
});
