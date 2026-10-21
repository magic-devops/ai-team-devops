import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Modal, Select } from "antd";
import { ExecutionPlanEditor } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionPlanEditor";
import { ExecutionQueueRecovery } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionQueueRecovery";
import { DeliveryTaskDetail, TaskDetailContent } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import { DeliveryExecutionPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionPanel";
import { ExecutionOperationRecovery } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionOperationRecovery";
import { commandDraft } from "./executionCommands";
import { openExecutionDraft, prepareExecution, previewDeliveryExecution, fetchDeliveryTargets, type ExecutionDraftSession, type ExecutionPreview, type DeliveryTargets } from "./deliveryExecution";
import { createExecutionDispatchController, executionQueueOriginal, executionDispatchStorageKey, type ExecutionDispatchCommand } from "./executionDispatchCommand";
import { fetchDeliveryTaskEditData } from "./deliveryQuery";
import { projectSessionKey } from "./projectPortfolio";
import { setSession, USER_KEY } from "./authStorage";
import type { DeliveryCommandAck, DeliveryTaskData } from "./delivery";

const h = vi.hoisted(() => ({
  hooks: {} as Record<string, any[]>, scope: "editor", next: 0, raw: "", storageFail: false,
  controller: undefined as any, onPending: undefined as undefined | ((value: boolean) => void), send: vi.fn(),
  query: {} as any, queries: [] as any[], hookCalls: [] as any[], saved: vi.fn(), close: vi.fn(), resolved: vi.fn(),
  taskSend: vi.fn(), queueStorageKey: "", storage: {} as Record<string, string>, effects: [] as Array<() => void>,
  executionQuery: {} as any, historyQuery: {} as any,
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const read = (initial: any) => {
    const state = h.hooks[h.scope] ||= [], index = h.next++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [state, index] as const;
  };
  return { ...actual,
    useState: (initial: any) => { const [state, index] = read(initial); return [state[index], (next: any) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; },
    useRef: (initial: any) => { const [state, index] = read({ current: initial }); return state[index]; },
    useCallback: (callback: unknown) => callback, useMemo: (callback: () => unknown) => callback(),
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const [state, index] = read(undefined), previous = state[index];
      if (!previous || !deps || deps.some((value, i) => value !== previous.deps?.[i])) h.effects.push(() => {
        previous?.cleanup?.(); state[index] = { deps, cleanup: effect() };
      });
    },
    useSyncExternalStore: (_subscribe: unknown, readSnapshot: () => unknown) => readSnapshot(),
  };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-US" } }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => { h.queries.push(options); return options.queryKey[0] === "delivery-task-detail" ? h.query : options.queryKey[0] === "delivery-execution-exact" ? h.executionQuery : options.queryKey[0] === "delivery-targets" ? { data: targets, error: null, isError: false } : { data: undefined, isError: false, isFetching: false, refetch: vi.fn() }; },
  useInfiniteQuery: () => h.historyQuery,
  useQueryClient: () => ({ invalidateQueries: vi.fn(), getQueryData: () => h.query.data, setQueryData: vi.fn() }),
}));
vi.mock("./executionDispatchCommand", async () => {
  const actual = await vi.importActual<typeof import("./executionDispatchCommand")>("./executionDispatchCommand");
  return { ...actual, useExecutionDispatchCommand: (projectId: string, action: string, targetId: string, sessionId: string, onPending?: (value: boolean) => void) => {
    h.hookCalls.push([projectId, action, targetId, sessionId]); h.onPending = onPending;
    const state = h.controller.snapshot();
    return { ...h.controller, state, locked: !["idle", "refused"].includes(state.phase), unresolved: ["sending", "unknown"].includes(state.phase) };
  } };
});
vi.mock("./deliveryExecution", async () => ({ ...await vi.importActual<typeof import("./deliveryExecution")>("./deliveryExecution"), previewDeliveryExecution: vi.fn(), fetchDeliveryTargets: vi.fn() }));
vi.mock("./deliveryQuery", async () => ({ ...await vi.importActual<typeof import("./deliveryQuery")>("./deliveryQuery"), fetchDeliveryTaskEditData: vi.fn() }));
vi.mock("./delivery", async () => ({ ...await vi.importActual<typeof import("./delivery")>("./delivery"), saveDelivery: (...args: unknown[]) => h.taskSend(...args) }));

const taskBasis = "a".repeat(64), targetBasis = "b".repeat(64);
const target = { id: "local", kind: "local" as const, name: "Local", version: 1, basis: targetBasis, paired: null, online: null, last_seen_at: null, expires_at: null, worker_id: null, capability_digest: "", runtime_capabilities: ["command" as const], providers: [], policy: { allowed_runtimes: ["command" as const], allowed_providers: [] }, can_execute: true, reason_codes: [] };
const targets: DeliveryTargets = { project_id: "P", as_of: "now", runtime_configured: true, can_execute: true, can_configure_policy: false, workspaces: [{ id: "W", name: "Workspace", version: 1, agents: [], local: target, devices: [] }] };
const data = { project: { id: "P", name: "Project" }, version: 7, query_generation: 3, permissions: { write: true, approve: false, configure: false }, members: [], dependencies: [], requirement: null, task: { id: "T", req_id: "", basis: taskBasis, title: "Task", description: "Task body", owner_id: "", estimate: "", recorded_status: "pending", status: "pending", acceptance: { criteria: [], sources: [], available: true, requirement_id: null, requirement_revision: null }, execution_gate: { eligible: true, reasons: [] }, acceptance_criteria: ["original criterion"] } } as unknown as DeliveryTaskData;
function draft(): ExecutionDraftSession { return { ...openExecutionDraft(data, "T", "queue-original-key"), mode: "command", workspaceId: "W", target, commands: [commandDraft("tests", "python")] }; }
function previewFor(value = draft()): ExecutionPreview {
  const prepared = prepareExecution(value);
  return { project_id: "P", version: 7, task_basis: taskBasis, plan_basis: "c".repeat(64), workspace_id: "W", workspace_version: 1, target, agent: null, executor_snapshot: null,
    nodes: prepared.payload.nodes.map((node) => ({ expected_exit_code: 0, timeout_seconds: 60, agent_id: "", prompt: "", ...node })), test_node_ids: ["tests"],
    snapshot: { task_id: "T", title: "Task", description: "Task body", assigned_to: "", task_acceptance_criteria: ["original criterion"], acceptance_criteria: ["original criterion"], requirement: null, owner: null, dependency_basis: {}, designs: [], design_basis: "a".repeat(64) },
  };
}
const original = () => { const value = draft(); value.preview = previewFor(value); return executionQueueOriginal(prepareExecution(value)); };
const ack = (): DeliveryCommandAck => ({ project_id: "P", action: "execution.queue", resource: { kind: "execution", id: "E-created" }, result: null, affected_refs: [{ kind: "execution", id: "E-created" }], applied_version: 8, version: 8, query_generation: 4, replayed: false });
function controller() {
  const scope = projectSessionKey();
  h.controller = createExecutionDispatchController({ projectId: "P", action: "execution.queue", targetId: "T", scope, currentScope: projectSessionKey,
    load: () => h.raw || null, save: (raw) => { if (h.storageFail) throw new Error("quota"); h.raw = raw; }, send: h.send,
    onPending: (value) => h.onPending?.(value || h.controller?.snapshot().phase === "succeeded"),
  });
  return h.controller;
}
function command(): ExecutionDispatchCommand { const state = h.controller.snapshot(); return { ...h.controller, state, locked: !["idle", "refused"].includes(state.phase), unresolved: ["sending", "unknown"].includes(state.phase) }; }
function run<T>(scope: string, read: () => T) {
  h.scope = scope; h.next = 0; h.effects = [];
  const tree = read(); const effects = h.effects; h.effects = []; effects.forEach((effect) => effect()); return tree;
}
function renderEditor(extra: Record<string, unknown> = {}) { return run("editor", () => ExecutionPlanEditor({ initial: draft(), initialTargets: targets, members: [], sessionId: "s", canConfigure: false, queueCommand: command(), onSaved: h.saved, onClose: h.close, isActive: () => true, ...extra })); }
function renderRecovery(extra: Record<string, unknown> = {}) { return run("recovery", () => ExecutionQueueRecovery({ command: command(), projectId: "P", taskId: "T", onSaved: h.saved, onResolved: h.resolved, isActive: () => true, ...extra })); }
function renderHost() { return run("host", () => DeliveryTaskDetail({ projectId: "P", taskId: "T", sessionId: "s" })); }
function renderPanel() { return run("panel", () => DeliveryExecutionPanel({ data, task: { ...data.task, execution_id: "E-existing" }, sessionId: "s", queueCommand: command(), onSaved: h.saved, onCommand: vi.fn() })); }
function nodes(node: ReactNode): ReactElement<any>[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...["children", "footer", "action", "description"].flatMap((key) => nodes(node.props[key])), ...(node.props.items || []).flatMap((item: any) => nodes(item.children))]; }
function button(tree: ReactNode, key: string) { return nodes(tree).find((node) => node.type === Button && node.props.children === key)!.props; }
function retainSync(id: string) { h.storage[executionDispatchStorageKey("P", "execution.sync", id)!] = JSON.stringify({ phase: "unknown", original: { action: "execution.sync", payload: { id }, intent: { version: 7, key: "sync-original-key" } } }); }

beforeEach(() => {
  h.hooks = {}; h.next = 0; h.raw = ""; h.storage = {}; h.effects = []; h.storageFail = false; h.queries = []; h.hookCalls = []; h.onPending = undefined;
  h.send.mockReset().mockResolvedValue(ack()); h.saved.mockReset(); h.close.mockReset(); h.resolved.mockReset();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => key === h.queueStorageKey ? h.raw || null : h.storage[key] || null, setItem: (key: string, raw: string) => { if (key === h.queueStorageKey) h.raw = raw; else h.storage[key] = raw; } });
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { hash: "#/tasks/execution?project_id=P&task_id=T", href: "http://local/#/tasks/execution?project_id=P&task_id=T" }, document: new EventTarget(), history: { replaceState: vi.fn() } }));
  setSession("account-a", "P", "tenant-a"); localStorage.setItem(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-a" }));
  h.queueStorageKey = executionDispatchStorageKey("P", "execution.queue", "T")!; controller();
  h.query = { data, error: null, isError: false, isPending: false, refetch: vi.fn() };
  h.executionQuery = { data: undefined, error: null, isError: false, isPending: true, refetch: vi.fn() };
  h.historyQuery = { data: { pages: [{ items: [{ data: { id: "E-history", status: "failed", created_at: "now", attempt: 1 } }], total: 1 }] }, error: null };
  h.taskSend.mockReset().mockResolvedValue({ ...ack(), action: "task.update", resource: { kind: "task", id: "T" } });
  vi.mocked(fetchDeliveryTaskEditData).mockReset();
  vi.mocked(fetchDeliveryTargets).mockReset().mockResolvedValue(targets);
  vi.mocked(previewDeliveryExecution).mockReset().mockImplementation(async (_projectId, payload) => previewFor({ ...draft(), approvalBeforeRun: payload.nodes.some((node) => node.kind === "approval") }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("actual dispatch editor and permanent recovery host (definitions, not executed)", () => {
  it("persists the exact reviewed payload before posting and closes only after confirmed local cleanup", async () => {
    await button(renderEditor(), "deliveryRuntime.preview").onClick();
    expect(button(renderEditor(), "deliveryRuntime.save").disabled).toBe(false);
    h.send.mockImplementation(async (request) => { expect(JSON.parse(h.raw).original).toEqual(request); return ack(); });
    await button(renderEditor(), "deliveryRuntime.save").onClick();
    expect(h.send).toHaveBeenCalledOnce(); expect(h.controller.snapshot().phase).toBe("idle"); expect(h.raw).toBe("");
    expect(h.saved).toHaveBeenCalledWith(ack()); expect(h.close).toHaveBeenCalledOnce();
  });
  it("prevents repeated save callbacks before React renders the sending phase", async () => {
    await button(renderEditor(), "deliveryRuntime.preview").onClick();
    let finish!: (value: unknown) => void; h.send.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const save = button(renderEditor(), "deliveryRuntime.save").onClick;
    const pending = save(); const duplicate = save();
    expect(h.send).toHaveBeenCalledOnce(); finish(ack()); await Promise.all([pending, duplicate]);
  });
  it("rejects an old fresh-save callback after a confirmed ACK even before the parent unmounts", async () => {
    await button(renderEditor(), "deliveryRuntime.preview").onClick();
    const save = button(renderEditor(), "deliveryRuntime.save").onClick;
    await save(); await save();
    expect(h.send).toHaveBeenCalledOnce(); expect(h.saved).toHaveBeenCalledOnce();
    expect(h.controller.snapshot().phase).toBe("idle");
  });
  it("rejects a foreign project/workspace preview before it can enable queue submission", async () => {
    vi.mocked(previewDeliveryExecution).mockResolvedValue({ ...previewFor(), project_id: "Q", workspace_id: "foreign" });
    await button(renderEditor(), "deliveryRuntime.preview").onClick();
    expect(button(renderEditor(), "deliveryRuntime.save").disabled).toBe(true); expect(h.send).not.toHaveBeenCalled();
  });
  it("revokes an old preview before a failed preview or current-basis read can leave it confirmable", async () => {
    await button(renderEditor(), "deliveryRuntime.preview").onClick();
    vi.mocked(previewDeliveryExecution).mockRejectedValueOnce(new Error("HTTP 409: Project changed. Reload before saving"));
    await button(renderEditor(), "deliveryRuntime.preview").onClick();
    expect(button(renderEditor(), "deliveryRuntime.save").disabled).toBe(true);
    vi.mocked(fetchDeliveryTaskEditData).mockRejectedValueOnce(new Error("HTTP 503: current task unavailable"));
    await button(renderEditor(), "deliveryRuntime.readLatest").onClick();
    expect(button(renderEditor(), "deliveryRuntime.save").disabled).toBe(true); expect(h.send).not.toHaveBeenCalled();
  });
  it("rejects an old task property callback immediately when queue sending begins", async () => {
    const content = nodes(renderHost()).find((node) => node.type === TaskDetailContent)!;
    let finish!: (value: unknown) => void; h.send.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = h.controller.run(original());
    await expect(content.props.onCommand("task.update", { id: "T", status: "blocked" })).rejects.toThrow();
    expect(h.taskSend).not.toHaveBeenCalled(); finish(ack()); await pending;
  });
  it("rejects an old queue save callback immediately when a task property write begins", async () => {
    const content = nodes(renderHost()).find((node) => node.type === TaskDetailContent)!;
    await button(renderEditor({ canSubmit: content.props.canSubmitQueue }), "deliveryRuntime.preview").onClick();
    const save = button(renderEditor({ canSubmit: content.props.canSubmitQueue }), "deliveryRuntime.save").onClick;
    let finish!: (value: unknown) => void; h.taskSend.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = content.props.onCommand("task.update", { id: "T", status: "blocked" });
    expect(content.props.isActive()).toBe(false);
    await save(); expect(h.send).not.toHaveBeenCalled(); finish({ ...ack(), action: "task.update" }); await pending;
    expect(content.props.isActive()).toBe(true);
  });
  it.each(["read_error", "write_revoked"])("rejects a captured task-property callback after current access changes: %s", async (change) => {
    const callback = nodes(renderHost()).find((node) => node.type === TaskDetailContent)!.props.onCommand;
    h.query = change === "read_error" ? { ...h.query, error: new Error("HTTP 403: task denied"), isError: true } : { ...h.query, data: { ...data, permissions: { ...data.permissions, write: false } } };
    renderHost();
    await expect(callback("task.update", { id: "T", status: "blocked" })).rejects.toThrow();
    expect(h.taskSend).not.toHaveBeenCalled();
  });
  it("rejects fresh queue confirmation after live write permission changes without disabling original recovery", async () => {
    let allowed = true;
    await button(renderEditor({ canSubmit: () => allowed }), "deliveryRuntime.preview").onClick();
    const save = button(renderEditor({ canSubmit: () => allowed }), "deliveryRuntime.save").onClick;
    allowed = false; await save(); expect(h.send).not.toHaveBeenCalled();
  });
  it("keeps an unknown original read-only and blocks close, policy and new preview", async () => {
    await button(renderEditor(), "deliveryRuntime.preview").onClick(); h.send.mockRejectedValueOnce(new Error("Failed to fetch"));
    await button(renderEditor(), "deliveryRuntime.save").onClick();
    const tree = renderEditor(); const modal = nodes(tree).find((node) => node.type === Modal)!;
    expect(modal.props.closable).toBe(false); expect(modal.props.maskClosable).toBe(false); expect(modal.props.keyboard).toBe(false);
    expect(nodes(tree).some((node) => node.type === Select)).toBe(false);
    modal.props.onCancel(); expect(h.close).not.toHaveBeenCalled(); expect(h.controller.snapshot().phase).toBe("unknown");
  });
  it("offers explicit current-basis recovery after a definite JSON 409 refusal", async () => {
    await button(renderEditor(), "deliveryRuntime.preview").onClick();
    h.send.mockRejectedValueOnce(new Error('HTTP 409: {"detail":{"code":"project_version_conflict","message":"Project changed. Reload before saving"}}'));
    await button(renderEditor(), "deliveryRuntime.save").onClick();
    expect(h.controller.snapshot().phase).toBe("refused");
    const tree = renderEditor();
    expect(button(tree, "deliveryRuntime.preview").disabled).toBe(true);
    expect(button(tree, "deliveryRuntime.readLatest")).toBeDefined();
    expect(JSON.stringify(tree)).toContain("deliveryRuntime.conflict");
  });
  it("rebuilds from retained storage and retries the original key/version/body without a fresh catalogue", async () => {
    h.send.mockRejectedValueOnce(new Error("network timeout")); await h.controller.run(original());
    const first = h.send.mock.calls[0][0]; controller(); h.hooks = {};
    const tree = renderRecovery(); expect(JSON.stringify(tree)).toContain("deliveryRuntime.queueRequestOnly");
    expect(JSON.stringify(tree)).toContain(taskBasis); expect(JSON.stringify(tree)).toContain("W");
    await button(tree, "deliveryRuntime.queueRetryOriginal").onClick();
    expect(h.send.mock.calls[1][0]).toEqual(first); expect(h.resolved).toHaveBeenCalledOnce(); expect(h.saved).toHaveBeenCalledOnce();
  });
  it("keeps recovery actions visible and places technical identity in a closed native disclosure", () => {
    h.raw = JSON.stringify({ phase: "unknown", original: original() }); controller();
    const tree = renderRecovery(), details = nodes(tree).find((node) => node.type === "details")!;
    expect(details.props.open).toBeUndefined();
    expect(JSON.stringify(details)).toContain("queue-original-key"); expect(JSON.stringify(details)).toContain(taskBasis);
    expect(nodes(details).some((node) => node.type === "summary" && node.props.children === "deliveryRuntime.queueRequestDetails")).toBe(true);
    expect(nodes(details).some((node) => node.type === Button)).toBe(false);
    expect(button(tree, "deliveryRuntime.queueRetryOriginal").disabled).toBe(false);
  });
  it.each(["HTTP 401: session unavailable", "HTTP 403: denied", "HTTP 404: task missing", "Failed to fetch"])("keeps the permanent queue recovery consumer before the failed task query: %s", async (message) => {
    h.raw = JSON.stringify({ phase: "unknown", original: original() }); controller();
    h.query = { ...h.query, data: undefined, error: new Error(message), isError: true };
    const tree = renderHost();
    expect(h.hookCalls).toEqual([["P", "execution.queue", "T", "s"]]);
    expect(nodes(tree).some((node) => node.type === ExecutionQueueRecovery)).toBe(true);
    expect(nodes(tree).find((node) => node.type === TaskDetailContent)?.props.detail).toBeUndefined();
    expect(h.controller.snapshot().phase).toBe("unknown"); expect(h.send).not.toHaveBeenCalled();
  });
  it("does not clear an unknown request when a current GET reports a new execution ID", async () => {
    h.raw = JSON.stringify({ phase: "unknown", original: original() }); controller();
    renderHost(); h.query = { ...h.query, data: { ...data, task: { ...data.task, execution_id: "E-current-pointer" } } }; renderHost();
    expect(h.controller.snapshot().phase).toBe("unknown"); expect(h.send).not.toHaveBeenCalled();
    expect(h.hookCalls.every((entry) => entry[2] === "T")).toBe(true);
  });
  it.each(["E-existing", "E-history"])("retains the known execution outside a failed task body until its original clears: %s", (id) => {
    h.query = { ...h.query, data: { ...data, task: { ...data.task, execution_id: "E-existing" } } };
    const content = nodes(renderHost()).find((node) => node.type === TaskDetailContent)!;
    retainSync(id); content.props.onExecutionRecovery(id); content.props.onUnresolvedChange(true);
    h.query = { ...h.query, error: new Error("HTTP 403: task denied"), isError: true };
    const failed = renderHost();
    expect(nodes(failed).find((node) => node.type === ExecutionOperationRecovery)?.props.executionId).toBe(id);
    expect(nodes(failed).find((node) => node.type === TaskDetailContent)?.props.detail).toBeUndefined();
    expect(nodes(failed).find((node) => node.type === TaskDetailContent)?.props.pinnedDetail).toBeUndefined();
    h.query = { ...h.query, error: null, isError: false, data: { ...data, task: { ...data.task, execution_id: "E-new" } } };
    const recoveredRead = renderHost();
    const recovery = nodes(recoveredRead).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(recovery.props.executionId).toBe(id); expect(h.send).not.toHaveBeenCalled();
    delete h.storage[executionDispatchStorageKey("P", "execution.sync", id)!];
    recovery.props.onUnresolvedChange(false);
    expect(nodes(renderHost()).some((node) => node.type === ExecutionOperationRecovery)).toBe(false);
  });
  it("mounts current-execution recovery before its exact GET and keeps the host when a later GET succeeds", () => {
    retainSync("E-existing");
    h.executionQuery = { ...h.executionQuery, error: new Error("HTTP 403: execution denied"), isError: true };
    const initial = renderPanel();
    expect(nodes(initial).find((node) => node.type === ExecutionOperationRecovery)?.props.executionId).toBe("E-existing");
    expect(h.queries.find((query) => query.queryKey[0] === "delivery-execution-exact").enabled).toBe(false);
    h.executionQuery = { ...h.executionQuery, error: null, isError: false, data: { execution: { id: "E-existing", status: "running" } } };
    const recovery = nodes(renderPanel()).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(recovery.props.executionId).toBe("E-existing");
    delete h.storage[executionDispatchStorageKey("P", "execution.sync", "E-existing")!];
    recovery.props.onUnresolvedChange(false);
    expect(nodes(renderPanel()).some((node) => node.type === ExecutionOperationRecovery)).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });
  it.each(["read_error", "row_left_page"])("preserves an opened history original outside the authorized list when it disappears: %s", (change) => {
    button(renderPanel(), "deliveryExecutionRuntime.openHistory").onClick();
    const selected = nodes(renderPanel()).find((node) => typeof node.type === "function" && node.type.name === "ExactExecutionCard")!;
    expect(selected.props.id).toBe("E-history");
    retainSync("E-history"); selected.props.onUnresolvedChange(true);
    const authorizedHistory = h.historyQuery;
    h.historyQuery = change === "read_error" ? { ...h.historyQuery, error: new Error("HTTP 403: list denied") } : { ...h.historyQuery, data: { pages: [{ items: [], total: 0 }] } };
    const disappeared = renderPanel();
    expect(nodes(disappeared).find((node) => node.type === ExecutionOperationRecovery)?.props.executionId).toBe("E-history");
    expect(nodes(disappeared).some((node) => typeof node.type === "function" && node.type.name === "ExactExecutionCard")).toBe(false);
    h.historyQuery = authorizedHistory;
    const restored = renderPanel();
    const recovery = nodes(restored).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(recovery.props.executionId).toBe("E-history");
    expect(nodes(restored).some((node) => typeof node.type === "function" && node.type.name === "ExactExecutionCard")).toBe(false);
    delete h.storage[executionDispatchStorageKey("P", "execution.sync", "E-history")!];
    recovery.props.onUnresolvedChange(false);
    expect(nodes(renderPanel()).some((node) => node.type === ExecutionOperationRecovery)).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("keeps an unauthorized replay unknown without turning it into a fresh dispatch", async () => {
    h.raw = JSON.stringify({ phase: "unknown", original: original() }); controller();
    h.send.mockRejectedValue(new Error("HTTP 403: runtime permission changed"));
    await button(renderRecovery(), "deliveryRuntime.queueRetryOriginal").onClick();
    expect(h.controller.snapshot().phase).toBe("unknown"); expect(h.send).toHaveBeenCalledOnce();
    expect(h.resolved).not.toHaveBeenCalled(); expect(h.saved).not.toHaveBeenCalled();
  });
  it("keeps a confirmed receipt when cleanup fails and finishes without another POST", async () => {
    h.raw = JSON.stringify({ phase: "unknown", original: original() }); controller();
    h.send.mockImplementation(async () => { h.storageFail = true; return ack(); });
    await button(renderRecovery(), "deliveryRuntime.queueRetryOriginal").onClick();
    expect(h.controller.snapshot().phase).toBe("succeeded"); expect(h.saved).not.toHaveBeenCalled();
    h.storageFail = false;
    await button(renderRecovery(), "deliveryRuntime.queueFinishConfirmed").onClick();
    expect(h.controller.snapshot().phase).toBe("idle"); expect(h.send).toHaveBeenCalledOnce(); expect(h.saved).toHaveBeenCalledOnce();
  });
  it("preserves confirmed wording after successful cleanup when refreshing its consumer fails", async () => {
    h.raw = JSON.stringify({ phase: "unknown", original: original() }); controller();
    h.saved.mockImplementationOnce(() => { throw new Error("consumer refresh failed"); });
    const retry = button(renderRecovery(), "deliveryRuntime.queueRetryOriginal").onClick;
    await retry(); await retry();
    const confirmed = JSON.stringify(renderRecovery());
    expect(h.controller.snapshot().phase).toBe("idle"); expect(h.raw).toBe(""); expect(h.send).toHaveBeenCalledOnce();
    expect(confirmed).toContain("Dispatch accepted"); expect(confirmed).toContain("deliveryRuntime.queueRefreshAfterSaveFailed");
    expect(confirmed).not.toContain("deliveryRuntime.queueUnknown"); expect(confirmed).not.toContain("deliveryRuntime.queueOriginalUnavailable");
  });
  it("does not label a pre-POST storage refusal as an unknown dispatch outcome", async () => {
    h.storageFail = true; await h.controller.run(original());
    const refusedBeforeSend = JSON.stringify(renderRecovery());
    expect(h.controller.snapshot().phase).toBe("idle"); expect(h.send).not.toHaveBeenCalled();
    expect(refusedBeforeSend).toContain("deliveryRuntime.queueStorageUnavailable");
    expect(refusedBeforeSend).not.toContain("deliveryRuntime.queueUnknown"); expect(refusedBeforeSend).not.toContain("Dispatch accepted");
  });
  it("shows a damaged retained slot and never offers destructive clearing or a new request", () => {
    h.raw = "{broken"; controller(); const tree = renderRecovery();
    expect(JSON.stringify(tree)).toContain("deliveryRuntime.queueOriginalUnavailable");
    expect(nodes(tree).filter((node) => node.type === Button).every((node) => node.props.disabled)).toBe(true);
    expect(h.send).not.toHaveBeenCalled(); expect(h.raw).toBe("{broken");
  });
  it("rejects an old recovery button after the account changes", async () => {
    h.raw = JSON.stringify({ phase: "unknown", original: original() }); controller();
    const retry = button(renderRecovery(), "deliveryRuntime.queueRetryOriginal").onClick;
    setSession("account-b", "P", "tenant-a"); await retry();
    expect(h.send).not.toHaveBeenCalled(); expect(h.saved).not.toHaveBeenCalled(); expect(h.resolved).not.toHaveBeenCalled();
  });
  it("rejects a stale host callback when its task route is no longer active", async () => {
    h.raw = JSON.stringify({ phase: "unknown", original: original() }); controller();
    let active = true; const retry = button(renderRecovery({ isActive: () => active }), "deliveryRuntime.queueRetryOriginal").onClick;
    active = false; await retry(); expect(h.send).not.toHaveBeenCalled(); expect(h.resolved).not.toHaveBeenCalled();
  });
});
