import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Drawer } from "antd";
import { TaskExecutionHandoffRecovery, TaskQueueOriginalRecovery } from "../../subapps/ai-rd-center/src/pages/delivery/TaskExecutionHandoffRecovery";
import { DeliveryTaskDetail, TaskDetailContent } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import { DeliveryWorkbench } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryWorkbench";
import { DeliveryQueryError, DeliveryRequirementTasks } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryQueryViews";
import { DeliveryExecutionInspector } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionInspector";
import { ExecutionObservationCard } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionObservationCard";
import { ExecutionOperationRecovery } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionOperationRecovery";
import { ProjectContextGate } from "../components/ProjectContextGate";
import { readTaskHandoffs, type TaskHandoffPage, type ExecutionHandoff } from "./executionHandoff";
import { executionDispatchStorageKey, createExecutionDispatchController } from "./executionDispatchCommand";
import { executionControlStorageKey } from "./executionControlCommand";
import { executionHandoffCopy } from "../i18n/execution-handoff";
import { setSession, USER_KEY } from "./authStorage";
import { parseDeliveryRoute } from "./deliveryProjectInbox";
import { request } from "./http";
import type { DeliveryTaskData } from "./delivery";

const h = vi.hoisted(() => ({ hooks: {} as Record<string, any[]>, component: "locator", next: 0, effects: [] as Array<() => void>, scope: "scope-a", activeProject: "P",
  list: {} as any, task: {} as any, context: {} as any, exact: {} as any, requirement: {} as any, options: [] as any[], storage: {} as Record<string, string>, located: vi.fn(), saved: vi.fn(), invalidation: vi.fn(),
  queue: undefined as any, queuePending: undefined as undefined | ((value: boolean) => void), mutation: vi.fn(), refetch: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const read = (initial: any) => { const values = h.hooks[h.component] ||= [], index = h.next++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values, index] as const; };
  return { ...actual, useState: (initial: any) => { const [values, index] = read(initial); return [values[index], (next: any) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef: (initial: any) => { const [values, index] = read({ current: initial }); return values[index]; }, useCallback: (callback: unknown) => callback,
    useMemo: (callback: () => unknown, deps: unknown[]) => { const [values, index] = read(undefined); if (!values[index] || deps.some((part, i) => part !== values[index].deps[i])) values[index] = { value: callback(), deps }; return values[index].value; },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useEffect: (effect: () => void, deps: unknown[]) => { const [values, index] = read(undefined); if (!values[index] || deps.some((part, i) => part !== values[index][i])) { values[index] = deps; h.effects.push(effect); } },
  };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-US" } }) }));
vi.mock("./authStorage", async () => ({ ...await vi.importActual<typeof import("./authStorage")>("./authStorage"), getProjectId: () => h.activeProject, getToken: () => "controlled" }));
vi.mock("./projectPortfolio", async () => ({ ...await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio"), projectSessionKey: () => h.scope }));
vi.mock("./http", async () => ({ ...await vi.importActual<typeof import("./http")>("./http"), request: vi.fn() }));
vi.mock("../components/DeliveryMemberIdentity", async () => ({ ...await vi.importActual<typeof import("../components/DeliveryMemberIdentity")>("../components/DeliveryMemberIdentity"), useMemberIdentity: () => (_members: unknown, id: string) => id }));
vi.mock("./deliveryAttention", () => ({ useDeliveryInboxQuery: () => ({ data: undefined }), useDeliveryInboxNavigation: () => ({ open: vi.fn(), retry: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => { h.options.push(options); return options.queryKey[0] === "delivery-task-handoffs" ? h.list : options.queryKey[0] === "delivery-task-detail" ? h.task : options.queryKey[0] === "delivery-context" ? h.context : options.queryKey[0] === "delivery-execution-exact" ? h.exact : options.queryKey[0] === "delivery-requirement-detail" ? h.requirement : { data: { items: [], total: 0 }, error: null, isError: false, isPending: false, refetch: h.refetch }; },
  useQueryClient: () => ({ getQueryData: (key: any[]) => key[0] === "delivery-context" ? h.context.data : h.task.data, invalidateQueries: h.invalidation }),
  useMutation: () => ({ isPending: false, mutateAsync: h.mutation }),
}));
vi.mock("./executionDispatchCommand", async () => ({ ...await vi.importActual<typeof import("./executionDispatchCommand")>("./executionDispatchCommand"),
  useExecutionDispatchCommand: (_p: string, _a: string, _t: string, _s: string, onPending?: (value: boolean) => void) => { h.queuePending = onPending; const state = h.queue.snapshot(); return { ...h.queue, state, locked: !["idle", "refused"].includes(state.phase) }; },
}));
const now = "2026-10-20T12:00:00Z";
const item = (executionId: string, state: ExecutionHandoff["state"] = "accepted"): ExecutionHandoff => ({ id: `H-${executionId}`, execution_id: executionId, task_id: "T", workspace_id: "W", state, revision: 1, attempt: 0,
  accepted_at: now, updated_at: now, next_attempt_at: null, error: null, run_id: state === "planned" ? `run-${executionId}` : null, runtime_task_id: state === "planned" ? `runtime-${executionId}` : null });
const page = (items = [item("E")], cursor: string | null = null): TaskHandoffPage => ({ project_id: "P", task_id: "T", items, total: items.length, next_cursor: cursor, limit: 20, as_of: now });
const context = { project_id: "P", project: { id: "P", name: "Private project", status: "active" }, permissions: { write: true, approve: true, query_rebuild: true }, query_state: { status: "ready" }, version: 7, query_generation: 1 };
const task = { project: context.project, permissions: context.permissions, version: 7, query_generation: 1, members: [], dependencies: [], requirement: null,
  task: { id: "T", title: "Private task", req_id: "", description: "Task body", owner_id: "", estimate: "", status: "pending", recorded_status: "pending", acceptance: { available: true, criteria: [], sources: [] }, execution_gate: { eligible: true, reasons: [] } } } as unknown as DeliveryTaskData;
function run<T>(component: string, render: () => T, flush = true) { h.component = component; h.next = 0; h.effects = []; const tree = render(); const effects = h.effects; if (flush) effects.forEach((effect) => effect()); return tree; }
function nodes(node: ReactNode): ReactElement<any>[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...["children", "action", "description", "footer"].flatMap((key) => nodes(node.props[key])), ...(node.props.items || []).flatMap((value: any) => nodes(value.children))]; }
function locator(props: Record<string, unknown> = {}, flush = true) { return run("locator", () => TaskExecutionHandoffRecovery({ projectId: "P", taskId: "T", sessionId: "s", onLocated: h.located, ...props }), flush); }
function taskHost() { return run("task", () => DeliveryTaskDetail({ projectId: "P", taskId: "T", sessionId: "s", onRecoveryIdentity: h.located })); }
function workbench() { const shell = run("shell", () => DeliveryWorkbench(), false); const project = nodes(shell).find((node) => typeof node.type === "function" && node.type.name === "ProjectDelivery")!; return run("workbench", () => (project.type as (props: any) => ReactNode)(project.props)); }
function pending(executionId: string) { h.storage[executionDispatchStorageKey("P", "execution.sync", executionId)!] = JSON.stringify({ phase: "unknown", original: { action: "execution.sync", payload: { id: executionId }, intent: { version: 7, key: "original-sync-key" } } }); }
function clear(executionId: string) { delete h.storage[executionDispatchStorageKey("P", "execution.sync", executionId)!]; }
beforeEach(() => {
  h.hooks = {}; h.options = []; h.effects = []; h.scope = "scope-a"; h.activeProject = "P"; h.storage = {}; h.queuePending = undefined;
  h.located.mockReset(); h.saved.mockReset(); h.invalidation.mockReset(); h.mutation.mockReset(); h.refetch.mockReset();
  const local = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value), removeItem: (key: string) => local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => h.storage[key] ?? null, setItem: (key: string, value: string) => { h.storage[key] = value; } });
  const target = Object.assign(new EventTarget(), { location: { hash: "#/dev-flow?view=team&task=T&project_id=P", href: "http://local/#/dev-flow?view=team&task=T&project_id=P", pathname: "/", search: "" }, document: new EventTarget(), history: { replaceState: vi.fn() } });
  vi.stubGlobal("window", target); vi.stubGlobal("location", target.location); vi.stubGlobal("requestAnimationFrame", (_fn: unknown) => 1); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  setSession("controlled", "P", "tenant-a"); localStorage.setItem(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-a" }));
  h.list = { data: page(), error: null, isPending: false, isFetching: false, refetch: h.refetch };
  h.task = { data: undefined, error: new Error("HTTP 403: task denied"), isError: true, isPending: false, refetch: h.refetch };
  h.context = { data: undefined, error: new Error("HTTP 503: context unavailable"), isError: true, isPending: false, refetch: h.refetch };
  h.exact = { data: { execution: { id: "E-selected", task_id: "T", status: "running" } }, error: null, isError: false, isPending: false, refetch: h.refetch };
  h.requirement = { data: undefined, error: null, isError: false, isPending: false, refetch: h.refetch };
  h.queue = createExecutionDispatchController({ projectId: "P", action: "execution.queue", targetId: "T", scope: h.scope, currentScope: () => h.scope, load: () => h.storage[executionDispatchStorageKey("P", "execution.queue", "T")!] || null,
    save: (raw) => { h.storage[executionDispatchStorageKey("P", "execution.queue", "T")!] = raw; }, send: h.mutation, onPending: (value) => h.queuePending?.(value) });
  vi.mocked(request).mockReset().mockResolvedValue(page());
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("canonical task locator and actual failure hosts (definitions, unexecuted)", () => {
  it("reads only the exact authorized task page with explicit project and bounded cursor", async () => {
    await readTaskHandoffs("P", "T", h.scope, "next/a+b");
    expect(request).toHaveBeenCalledWith("/api/v1/delivery/tasks/T/execution-handoffs?limit=20&cursor=next%2Fa%2Bb", expect.objectContaining({ headers: { "X-Project-Id": "P" } }));
    expect(vi.mocked(request).mock.calls[0][1]?.method).toBeUndefined();
  });
  it.each(["project", "task", "inner_task", "duplicate_execution", "over_budget", "repeated_cursor"])("rejects mixed or unbounded task locator responses: %s", async (change) => {
    const value = page() as any;
    if (change === "project") value.project_id = "Q";
    if (change === "task") value.task_id = "T-other";
    if (change === "inner_task") value.items[0].task_id = "T-other";
    if (change === "duplicate_execution") value.items.push({ ...item("E"), id: "H-other" });
    if (change === "over_budget") value.items = Array.from({ length: 21 }, (_, i) => item(`E-${i}`));
    if (change === "repeated_cursor") value.next_cursor = "same";
    value.total = value.items.length; vi.mocked(request).mockResolvedValue(value);
    await expect(readTaskHandoffs("P", "T", h.scope, change === "repeated_cursor" ? "same" : "")).rejects.toThrow("handoffResponseInvalid");
  });
  it("checks only exact executions in this authorized page without enumerating storage", () => {
    pending("E-private"); pending("E"); const allowed = new Set([executionControlStorageKey("P", "E"), executionDispatchStorageKey("P", "execution.sync", "E")]);
    const get = vi.spyOn(sessionStorage, "getItem"); locator();
    expect(h.located).toHaveBeenCalledWith("E"); expect(get.mock.calls.every(([key]) => allowed.has(key))).toBe(true);
  });
  it("does not lock or invent an original for an accepted background handoff", () => {
    const tree = locator(); expect(h.located).not.toHaveBeenCalled(); expect(JSON.stringify(tree)).toContain(executionHandoffCopy("en").pageOnly);
    expect(nodes(tree).some((node) => node.type === ExecutionOperationRecovery)).toBe(false); expect(h.mutation).not.toHaveBeenCalled();
  });
  it("offers an explicit earlier page and locates a retained historical execution there", () => {
    h.list.data = page([item("E-new")], "older"); const tree = locator();
    nodes(tree).find((node) => node.type === Button && node.props.children === executionHandoffCopy("en").earlier)!.props.onClick();
    pending("E-old"); h.list.data = page([item("E-old")]); locator();
    expect(h.options.at(-1).queryKey.at(-1)).toBe("older"); expect(h.located).toHaveBeenCalledWith("E-old");
  });
  it("clears cached locator facts on real 403 and cannot select a stale effect", () => {
    pending("E"); locator({}, false); const oldEffects = h.effects;
    h.list = { ...h.list, error: new Error("HTTP 403: handoff denied") }; const tree = locator(); oldEffects.forEach((effect) => effect());
    expect(h.located).not.toHaveBeenCalled(); expect(JSON.stringify(tree)).not.toContain(executionHandoffCopy("en").pageOnly);
  });
  it("resets a changed signed page scope to the first page without submitting", () => {
    h.list.data = page([item("E-new")], "older"); nodes(locator()).find((node) => node.type === Button && node.props.children === executionHandoffCopy("en").earlier)!.props.onClick();
    h.list = { ...h.list, error: new Error("HTTP 422: cursor scope changed") };
    const tree = locator(); expect(JSON.stringify(tree)).toContain(executionHandoffCopy("en").cursorChanged);
    nodes(tree).find((node) => node.type === Button)!.props.onClick(); h.list = { ...h.list, error: null }; locator();
    expect(h.options.at(-1).queryKey.at(-1)).toBe(""); expect(h.mutation).not.toHaveBeenCalled();
  });
  it.each(["parent", "session"])("rejects a locator callback after its %s scope is no longer active", (changed) => {
    pending("E"); let active = true; locator({ isActive: () => active }, false); const effects = h.effects;
    if (changed === "parent") active = false; else h.scope = "scope-b";
    effects.forEach((effect) => effect());
    expect(h.located).not.toHaveBeenCalled();
  });
  it("uses the actual cold denied task host then retains one owner after a late successful task read", () => {
    const host = taskHost(), fallback = nodes(host).find((node) => node.type === TaskExecutionHandoffRecovery)!;
    expect(fallback.props.taskId).toBe("T"); pending("E"); locator(fallback.props);
    let recovered = taskHost(); expect(nodes(recovered).filter((node) => node.type === ExecutionOperationRecovery)).toHaveLength(1);
    h.task = { ...h.task, data: task, error: null, isError: false }; recovered = taskHost();
    const owner = nodes(recovered).find((node) => node.type === ExecutionOperationRecovery)!; expect(owner.props.executionId).toBe("E");
    expect(nodes(recovered).find((node) => node.type === TaskDetailContent)!.props.detail).toBeUndefined();
    clear("E"); owner.props.onUnresolvedChange(false); expect(nodes(taskHost()).some((node) => node.type === ExecutionOperationRecovery)).toBe(false);
  });
  it("prioritizes the already known task execution without starting a second locator/controller", () => {
    h.task = { ...h.task, data: { ...task, task: { ...task.task, execution_id: "E" } }, error: null, isError: false };
    const content = nodes(taskHost()).find((node) => node.type === TaskDetailContent)!; pending("E"); content.props.onExecutionRecovery("E");
    h.task = { ...h.task, error: new Error("HTTP 403: task denied"), isError: true };
    const failed = taskHost(); expect(nodes(failed).some((node) => node.type === TaskExecutionHandoffRecovery)).toBe(false);
    expect(nodes(failed).filter((node) => node.type === ExecutionOperationRecovery)).toHaveLength(1); expect(h.located).toHaveBeenCalledWith("E");
  });
  it("can locate earlier authorized originals when the known task execution has no original", () => {
    h.task = { ...h.task, data: { ...task, task: { ...task.task, execution_id: "E-current" } }, error: null, isError: false }; taskHost();
    h.task = { ...h.task, error: new Error("HTTP 403: task denied"), isError: true };
    const fallback = nodes(taskHost()).find((node) => node.type === TaskExecutionHandoffRecovery)!;
    h.list.data = page([item("E-earlier")]); pending("E-earlier"); locator(fallback.props);
    expect(nodes(taskHost()).find((node) => node.type === ExecutionOperationRecovery)?.props.executionId).toBe("E-earlier");
  });
  it.each(["no_data", "rebuild", "permission_error"])("mounts the workbench task locator before unavailable context: %s", (failure) => {
    if (failure === "rebuild") h.context = { ...h.context, data: { ...context, query_state: { status: "rebuild_required" } }, error: null, isError: false };
    if (failure === "permission_error") h.context = { ...h.context, data: context, error: new Error("HTTP 403: context denied") };
    const tree = workbench(); expect(nodes(tree).find((node) => node.type === TaskExecutionHandoffRecovery)?.props.taskId).toBe("T");
    expect(JSON.stringify(tree)).not.toContain("Private project"); expect(h.mutation).not.toHaveBeenCalled();
  });
  it("keeps the workbench recovery owner when context becomes ready and releases it only after original cleanup", () => {
    const fallback = nodes(workbench()).find((node) => node.type === TaskExecutionHandoffRecovery)!; pending("E"); locator(fallback.props);
    h.context = { ...h.context, data: context, error: null, isError: false };
    const tree = workbench(), owner = nodes(tree).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(owner.props.executionId).toBe("E"); expect(nodes(tree).some((node) => node.type === DeliveryTaskDetail)).toBe(false);
    clear("E"); owner.props.onUnresolvedChange(false); expect(nodes(workbench()).some((node) => node.type === ExecutionOperationRecovery)).toBe(false);
  });
  it.each(["task", "context"])("revokes the old %s locator immediately when its business read becomes ready", (host) => {
    const initial = host === "task" ? taskHost() : workbench();
    const fallback = nodes(initial).find((node) => node.type === TaskExecutionHandoffRecovery)!;
    pending("E"); locator(fallback.props, false); const effects = h.effects;
    if (host === "task") h.task = { ...h.task, data: task, error: null, isError: false };
    else h.context = { ...h.context, data: context, error: null, isError: false };
    const ready = host === "task" ? taskHost() : workbench(); effects.forEach((effect) => effect());
    expect(fallback.props.isActive()).toBe(false); expect(h.located).not.toHaveBeenCalled();
    expect(nodes(ready).some((node) => node.type === ExecutionOperationRecovery)).toBe(false);
  });
  it("transfers a warm direct task's exact original to the workbench error host", () => {
    h.context = { ...h.context, data: context, error: null, isError: false };
    const detail = nodes(workbench()).find((node) => node.type === DeliveryTaskDetail)!; pending("E-history"); detail.props.onRecoveryIdentity("E-history");
    h.context = { ...h.context, error: new Error("HTTP 403: context denied"), isError: true };
    const failed = workbench(); expect(nodes(failed).find((node) => node.type === ExecutionOperationRecovery)?.props.executionId).toBe("E-history");
    expect(nodes(failed).some((node) => node.type === TaskExecutionHandoffRecovery)).toBe(false);
  });
  it("passes the same known-execution callback through the actual requirement task consumer", () => {
    const callback = vi.fn(), active = () => false, route = { ...parseDeliveryRoute(location.hash), task: "T" };
    const tree = run("requirement", () => DeliveryRequirementTasks({ projectId: "P", requirementId: "R", sessionId: "s", route, onRoute: vi.fn(), onUnresolvedChange: vi.fn(), onRecoveryIdentity: callback, isActive: active }));
    expect(nodes(tree).find((node) => node.type === DeliveryTaskDetail)!.props.onRecoveryIdentity).toBe(callback);
    expect(nodes(tree).find((node) => node.type === DeliveryTaskDetail)!.props.isActive).toBe(active);
  });
  it("retains queue, known task execution and exact selected execution until every original is cleared", () => {
    location.hash = "#/dev-flow?view=team&task=T&execution_id=E-selected&project_id=P";
    h.context = { ...h.context, data: context, error: null, isError: false };
    const detail = nodes(workbench()).find((node) => node.type === DeliveryTaskDetail)!;
    pending("E-known"); detail.props.onRecoveryIdentity("E-known"); detail.props.onUnresolvedChange(true);
    pending("E-selected"); h.storage[executionDispatchStorageKey("P", "execution.queue", "T")!] = "{broken";
    h.context = { ...h.context, error: new Error("HTTP 403: context denied"), isError: true };
    const queue = nodes(workbench()).find((node) => node.type === TaskQueueOriginalRecovery)!;
    expect(queue.props.isActive()).toBe(true); expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    h.storage[executionDispatchStorageKey("P", "execution.queue", "T")!] = ""; queue.props.onPending(false);
    let tree = workbench(), owner = nodes(tree).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(owner.props.executionId).toBe("E-known"); expect(nodes(tree).filter((node) => node.type === ExecutionOperationRecovery)).toHaveLength(1);
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    expect(queue.props.isActive()).toBe(false);
    clear("E-known"); owner.props.onUnresolvedChange(false); tree = workbench();
    owner = nodes(tree).find((node) => node.type === ExecutionOperationRecovery)!; expect(owner.props.executionId).toBe("E-selected");
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    h.context = { ...h.context, error: null, isError: false }; expect(nodes(workbench()).find((node) => node.type === ExecutionOperationRecovery)!.props.executionId).toBe("E-selected");
    clear("E-selected"); owner.props.onUnresolvedChange(false); tree = workbench();
    expect(nodes(tree).some((node) => node.type === ExecutionOperationRecovery || node.type === TaskQueueOriginalRecovery)).toBe(false);
    expect(nodes(tree).find((node) => node.type === DeliveryTaskDetail)!.props.isActive()).toBe(true);
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });
  it("clears each original's prior parent lock when the exact selected execution is recovered before the known task execution", () => {
    location.hash = "#/dev-flow?view=team&task=T&execution_id=E-selected&project_id=P";
    h.context = { ...h.context, data: context, error: null, isError: false };
    const initial = workbench(), detail = nodes(initial).find((node) => node.type === DeliveryTaskDetail)!, inspector = nodes(initial).find((node) => node.type === DeliveryExecutionInspector)!;
    pending("E-known"); detail.props.onRecoveryIdentity("E-known"); detail.props.onUnresolvedChange(true);
    pending("E-selected"); inspector.props.onUnresolvedChange(true);
    h.context = { ...h.context, error: new Error("HTTP 403: context denied"), isError: true };
    let owner = nodes(workbench()).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(owner.props.executionId).toBe("E-selected");
    clear("E-selected"); owner.props.onUnresolvedChange(false); owner = nodes(workbench()).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(owner.props.executionId).toBe("E-known"); expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    clear("E-known"); owner.props.onUnresolvedChange(false); h.context = { ...h.context, error: null, isError: false };
    const ready = workbench(); expect(nodes(ready).some((node) => node.type === ExecutionOperationRecovery)).toBe(false);
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
    expect(nodes(ready).find((node) => node.type === Drawer && node.props.className === "delivery-inspector")!.props.closable).toBe(true);
  });
  it("revokes a warm task's old write and child callbacks synchronously when context fails", async () => {
    h.context = { ...h.context, data: context, error: null, isError: false }; h.task = { ...h.task, data: task, error: null, isError: false };
    const detail = nodes(workbench()).find((node) => node.type === DeliveryTaskDetail)!;
    const child = nodes(run("warm-task", () => DeliveryTaskDetail(detail.props))).find((node) => node.type === TaskDetailContent)!;
    expect(child.props.isActive()).toBe(true);
    h.context = { ...h.context, error: new Error("HTTP 503: context unavailable"), isError: true }; workbench();
    expect(detail.props.isActive()).toBe(false); expect(child.props.isActive()).toBe(false);
    await expect(child.props.onCommand("task.status", { id: "T", status: "in_progress" })).rejects.toThrow("readonly");
    expect(h.mutation).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });
  it("revokes actual Inspector card, retry and close callbacks before the parent's recovery takeover", () => {
    location.hash = "#/dev-flow?view=team&task=T&execution_id=E-selected&project_id=P";
    h.context = { ...h.context, data: context, error: null, isError: false };
    const inspector = nodes(workbench()).find((node) => node.type === DeliveryExecutionInspector)!, closed = vi.fn();
    const tree = run("inspector", () => DeliveryExecutionInspector({ ...inspector.props, onClose: closed }));
    const card = nodes(tree).find((node) => node.type === ExecutionObservationCard)!, drawer = nodes(tree).find((node) => node.type === Drawer)!;
    expect(card.props.isActive()).toBe(true);
    h.exact = { ...h.exact, error: new Error("HTTP 503: execution unavailable"), isError: true };
    const retry = nodes(run("inspector", () => DeliveryExecutionInspector({ ...inspector.props, onClose: closed }))).find((node) => node.type === DeliveryQueryError)!;
    pending("E-selected"); h.context = { ...h.context, error: new Error("HTTP 403: context denied"), isError: true };
    const recovery = nodes(workbench()).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(recovery.props.executionId).toBe("E-selected"); expect(recovery.props.isActive()).toBe(true);
    expect(card.props.isActive()).toBe(false); card.props.onUnresolvedChange(false); retry.props.onRetry(); drawer.props.onClose(); expect(closed).not.toHaveBeenCalled(); expect(h.refetch).not.toHaveBeenCalled();
    clear("E-selected"); drawer.props.onClose(); expect(closed).not.toHaveBeenCalled();
  });
  it("preserves a legacy execution's exact identity through the requirement task consumer on context failure", () => {
    location.hash = "#/dev-flow?view=list&requirement=R&detail=tasks&task=T&project_id=P";
    h.context = { ...h.context, data: context, error: null, isError: false };
    h.requirement.data = { project_id: "P", version: 7, query_generation: 1, requirement: { id: "R", title: "Requirement", basis: "a".repeat(64), priority: "P1",
      flow: { owner_id: "", stage: "implementation", revision: 1, gates: [], closed: false } } };
    const consumer = nodes(workbench()).find((node) => node.type === DeliveryRequirementTasks)!;
    const detail = nodes(run("requirement", () => DeliveryRequirementTasks(consumer.props))).find((node) => node.type === DeliveryTaskDetail)!;
    pending("E-legacy"); detail.props.onRecoveryIdentity("E-legacy");
    h.context = { ...h.context, error: new Error("HTTP 403: context denied"), isError: true };
    const failed = workbench(); expect(nodes(failed).find((node) => node.type === ExecutionOperationRecovery)?.props.executionId).toBe("E-legacy");
    expect(detail.props.isActive()).toBe(false); expect(nodes(failed).some((node) => node.type === TaskExecutionHandoffRecovery)).toBe(false);
  });
  it("prioritizes an exact warm queue original over canonical handoff lookup", () => {
    h.storage[executionDispatchStorageKey("P", "execution.queue", "T")!] = "{broken";
    const tree = workbench(); expect(nodes(tree).some((node) => node.type === TaskQueueOriginalRecovery)).toBe(true);
    expect(nodes(tree).some((node) => node.type === TaskExecutionHandoffRecovery)).toBe(false); expect(h.mutation).not.toHaveBeenCalled();
  });
  it("retains the real project mismatch gate instead of exposing the fallback from another project", () => {
    location.hash = "#/dev-flow?view=team&task=T&project_id=Q";
    const guarded = run("gate", () => ProjectContextGate({ children: "protected locator" }));
    expect(JSON.stringify(guarded)).not.toContain("protected locator");
    expect(nodes(run("shell", () => DeliveryWorkbench(), false)).some((node) => node.type === ProjectContextGate)).toBe(true);
  });
});
