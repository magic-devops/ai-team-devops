/** Real sync recovery consumers. Definitions only; runtime validation is deferred. */
import { createElement, isValidElement, type ReactNode } from "react";
import { Alert, Button, Drawer } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionSyncControl, type ExecutionSyncControlProps } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionSyncControl";
import { ExecutionOperationRecovery } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionOperationRecovery";
import { ExecutionRouteRecoveryGate, executionRouteRecoverySelection } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRouteRecoveryGate";
import { ExecutionRuntimeControl } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRuntimeControl";
import { DeliveryExecutionInspector } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionInspector";
import { DeliveryTaskDetail, TaskDetailContent } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import { DeliveryExecutionPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionPanel";
import { ExecutionObservationCard } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionObservationCard";
import { executionDispatchRecoveryPending, executionDispatchStorageKey, executionQueueOriginal } from "./executionDispatchCommand";
import { executionControlStorageKey } from "./executionControlCommand";
import { request } from "./http";
import { setSession, setWorkspaceScope, USER_KEY } from "./authStorage";
import type { DeliveryContext, DeliveryExecution, DeliveryTaskData } from "./delivery";
import { openExecutionDraft, prepareExecution, type ExecutionObservations } from "./deliveryExecution";
import { qualityFixture } from "./executionQualityFixtures";
import { commandDraft } from "./executionCommands";

const h = vi.hoisted(() => ({ frames: {} as Record<string, any[]>, frame: "", next: 0,
  effects: {} as Record<string, Array<{ run: () => void | (() => void); deps?: unknown[] }>>,
  stored: new Map<string, string>(), local: new Map<string, string>(), sent: [] as any[],
  mode: "unknown" as "unknown" | "success" | "pending" | "refused" | "badAck",
  storageFail: "none" as "none" | "all" | "confirmed", failure: "HTTP 422: observation synchronization refused",
  resolve: null as ((value: unknown) => void) | null, detailError: null as Error | null, detailReady: false, invalidations: [] as unknown[],
  taskHost: false, readFailure: null as "task" | "execution" | null, historyFailure: false, historyOmit: false,
}));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (change: any) => { slots[index] = typeof change === "function" ? change(slots[index]) : change; }]; },
  useRef: (initial: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++;
    if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
  useMemo: (factory: () => unknown, deps: unknown[]) => { const slots = h.frames[h.frame] ||= [], index = h.next++;
    if (!(index in slots) || deps.some((dependency, i) => !Object.is(dependency, slots[index].deps[i]))) slots[index] = { deps, value: factory() }; return slots[index].value; },
  useEffect: (run: () => void | (() => void), deps?: unknown[]) => { (h.effects[h.frame] ||= []).push({ run, deps }); }, useCallback: (callback: unknown) => callback,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./http", async () => ({ ...await vi.importActual<typeof import("./http")>("./http"), request: vi.fn() }));
vi.mock("@tanstack/react-query", async () => ({ ...(await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query")),
  useQuery: (options: any) => {
    if (!h.taskHost) return { data: h.detailReady ? { execution } : undefined, isPending: !h.detailReady && !h.detailError, error: h.detailError, refetch: vi.fn() };
    const kind = options.queryKey[0], failed = h.readFailure === (kind === "delivery-task-detail" ? "task" : "execution") && kind !== "delivery-targets";
    const data = kind === "delivery-task-detail" ? taskData : kind === "delivery-targets" ? { runtime_configured: true, can_execute: true, workspaces: [{ id: "W" }] } :
      { execution: { ...execution, id: options.queryKey[3] } };
    return { data, error: failed ? new Error("HTTP 403: fresh detail forbidden") : null, isError: failed, isPending: false, refetch: vi.fn() };
  },
  useInfiniteQuery: () => ({ data: { pages: [{ items: h.historyOmit ? [] : [{ data: { ...execution, id: "E-history" } }], total: 1 }] },
    error: h.historyFailure ? new Error("HTTP 403: history list forbidden") : null, isPending: false, hasNextPage: false }),
  useQueryClient: () => ({ invalidateQueries: async (options: unknown) => { h.invalidations.push(options); }, getQueryData: () => taskData }),
}));
const execution: DeliveryExecution = { id: "E", workspace_id: "W", task_id: "T", agent_id: "A", run_id: "R", run_version: 9,
  attempt: 2, status: "running", progress: 0, stale: false, created_at: "2026-10-20T12:00:00Z", test_node_ids: [], results: {},
  snapshot: { task_acceptance_criteria: [] }, executor_snapshot: null };
const taskData = { project: { id: "P", name: "Project" }, version: 7, query_generation: 3, planning_basis: "f".repeat(64),
  permissions: { write: true, approve: false, configure: false }, members: [], dependencies: [], requirement: null,
  task: { id: "T", req_id: "", basis: "a".repeat(64), title: "Task", description: "Task scope", owner_id: "", estimate: "", execution_id: "E",
    priority: "medium", assigned_to: "", owner_active: false, verified: false, delivery_status: "in_progress", status: "in_progress", recorded_status: "in_progress",
    acceptance_criteria: [], acceptance: { criteria: [], sources: [], available: true, requirement_id: null, requirement_revision: null },
    execution_gate: { eligible: true, reasons: [] } } } as unknown as DeliveryTaskData;
const observation: ExecutionObservations = { project_id: "P", execution_id: "E", run_id: "R", run_version: 9, attempt: 2,
  review_verified: false, quality: qualityFixture({ execution_id: "E", run_id: "R", run_version: 9, attempt: 2 }),
  status: "awaiting_review", stale: false, observed_at: "2026-10-20T12:00:00Z", executor_snapshot: null, executor_binding_invalidated: false,
  events: [], next_cursor: null, more: false, nodes: [], tests: { total: 0, passed: 0, failed: 0, pending: 0, status: "not_configured" },
  permissions: { can_start: false, can_cancel: true, can_review: true, can_accept: false, can_sync: true }, log_streaming: false };
function ack(body: any) {
  const executionId = body.payload.id;
  return { project_id: "P", action: body.action, resource: { kind: "execution", id: executionId },
    applied_version: body.expected_version + 1, version: body.expected_version + 1, query_generation: 2, replayed: false,
    affected_refs: [{ kind: "execution", id: executionId }],
    result: body.action === "execution.sync" ? null : { run_id: "R", run_version: 10, replayed_runtime: false } };
}
function frame<T>(name: string, callback: () => T): T { h.frame = name; h.next = 0; h.effects[name] = []; return callback(); }
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.footer), ...nodes(node.props.action), ...nodes(node.props.items?.map((item: any) => item.children))]; }
function find(tree: ReactNode, type: unknown, test: (props: any) => boolean = () => true): any { return nodes(tree).find((node) => node.type === type && test(node.props))?.props; }
function action(tree: ReactNode, name: string): any { return find(tree, Button, (props) => props["data-action"] === name); }
const saved = vi.fn(), observed = vi.fn(async () => {}), unresolved = vi.fn();
function sync(patch: Partial<ExecutionSyncControlProps> = {}) { return frame("sync", () => ExecutionSyncControl({ projectId: "P", executionId: "E", sessionId: "selected-session",
  workspaceVersion: 7, canSync: true, onSaved: saved, onObserved: observed, onUnresolvedChange: unresolved, ...patch })); }
function gate() { return frame("gate", () => ExecutionOperationRecovery({ projectId: "P", executionId: "E", sessionId: "selected-session", isActive: () => true,
  onSaved: saved, onUnresolvedChange: unresolved })); }
function startup(children: ReactNode) { return frame("startup", () => ExecutionRouteRecoveryGate({ children })); }
function startupOperation(tree: ReactNode) {
  const host = nodes(tree).find((node) => node.type === ExecutionOperationRecovery)!;
  return frame("startup-operation", () => ExecutionOperationRecovery(host.props));
}
function seedRuntimeOriginal() {
  h.stored.set(executionControlStorageKey("P", "E")!, JSON.stringify({ phase: "unknown", original: { action: "execution.cancel",
    payload: { id: "E", run_id: "R", run_version: 9, attempt: 2, control_basis: "a".repeat(64), reason: "Stop the fixed attempt" },
    intent: { version: 7, key: "original-runtime-key" }, workspaceId: "W" } }));
}
function seedQueueOriginal() {
  const draft = openExecutionDraft(taskData, "T", "startup-queue-key"); draft.mode = "command"; draft.workspaceId = "W";
  draft.target = { id: "local", kind: "local", name: "Local", version: 1, basis: "b".repeat(64), paired: null, online: null, last_seen_at: null,
    expires_at: null, worker_id: null, capability_digest: "", runtime_capabilities: ["command"], providers: [],
    policy: { allowed_runtimes: ["command"], allowed_providers: [] }, can_execute: true, reason_codes: [] };
  draft.commands = [commandDraft("tests", "python")]; const prepared = prepareExecution(draft);
  prepared.session.preview = { project_id: "P", version: 7, task_basis: "a".repeat(64), plan_basis: "c".repeat(64), executor_snapshot: null,
    workspace_id: "W", workspace_version: 1, target: structuredClone(draft.target), agent: null,
    nodes: prepared.payload.nodes.map((node) => ({ ...node, argv: [...node.argv], expected_exit_code: "expected_exit_code" in node ? node.expected_exit_code : 0,
      timeout_seconds: "timeout_seconds" in node ? node.timeout_seconds : 60, agent_id: "", prompt: "" })),
    test_node_ids: [...prepared.payload.test_node_ids], snapshot: { task_id: "T", title: "Task", description: "Task scope", assigned_to: "",
      task_acceptance_criteria: [], acceptance_criteria: [], requirement: null, owner: null, dependency_basis: {} } };
  h.stored.set(executionDispatchStorageKey("P", "execution.queue", "T")!, JSON.stringify({ phase: "unknown", original: executionQueueOriginal(prepared) }));
}
function inspector() { return frame("inspector", () => DeliveryExecutionInspector({ executionId: "E", sessionId: "selected-session",
  workspace: { project: { id: "P" }, version: 7 } as unknown as DeliveryContext,
  onClose: vi.fn(), onCommand: vi.fn(async () => {}), onSaved: saved, onUnresolvedChange: unresolved })); }
function taskHost() { h.taskHost = true; return frame("task", () => DeliveryTaskDetail({ projectId: "P", taskId: "T", sessionId: "selected-session", onUnresolvedChange: unresolved })); }
async function liveTaskChain() {
  const content = nodes(taskHost()).find((node) => node.type === TaskDetailContent)!;
  const detail = frame("task-content", () => TaskDetailContent(content.props));
  const panel = nodes(detail).find((node) => node.type === DeliveryExecutionPanel)!;
  const renderPanel = () => frame("task-panel", () => DeliveryExecutionPanel(panel.props));
  const card = nodes(renderPanel()).find((node) => node.type === ExecutionObservationCard)!;
  const renderCard = () => frame("task-card", () => ExecutionObservationCard(card.props));
  renderCard(); h.effects["task-card"][0].run(); await settle();
  const syncElement = nodes(renderCard()).find((node) => node.type === ExecutionSyncControl)!;
  return { renderPanel, syncElement };
}
function recoverySync(host: ReactNode, name: string) {
  const operation = nodes(host).find((node) => node.type === ExecutionOperationRecovery)!;
  const tree = frame(`${name}-operation`, () => ExecutionOperationRecovery(operation.props));
  const syncElement = nodes(tree).find((node) => node.type === ExecutionSyncControl)!;
  return frame(`${name}-sync`, () => ExecutionSyncControl(syncElement.props));
}
function recreate() { h.frames = {}; h.effects = {}; }
async function settle() { for (let index = 0; index < 24; index++) await Promise.resolve(); }

beforeEach(() => {
  h.frames = {}; h.effects = {}; h.frame = ""; h.next = 0; h.stored.clear(); h.local.clear(); h.sent = []; h.mode = "unknown";
  h.taskHost = false; h.readFailure = null; h.historyFailure = false; h.historyOmit = false;
  h.storageFail = "none"; h.failure = "HTTP 422: observation synchronization refused"; h.resolve = null; h.detailError = null; h.detailReady = false; h.invalidations = [];
  saved.mockReset(); observed.mockReset().mockResolvedValue(undefined); unresolved.mockReset();
  vi.stubGlobal("localStorage", { getItem: (key: string) => h.local.get(key) || null, setItem: (key: string, raw: string) => h.local.set(key, raw), removeItem: (key: string) => h.local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => h.stored.get(key) || null, setItem: (key: string, raw: string) => {
    if (h.storageFail === "all" || h.storageFail === "confirmed" && (!raw || JSON.parse(raw).phase === "succeeded")) throw new Error("Storage unavailable"); h.stored.set(key, raw);
  } });
  const location = { hash: "#/dev-flow?execution_id=E", href: "http://localhost/#/dev-flow?execution_id=E" };
  vi.stubGlobal("location", location); vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  setSession("private-sync-token", "P", "tenant-a"); h.local.set(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-a" }));
  vi.mocked(request).mockReset().mockImplementation(async (path, init) => {
    if (path.endsWith("/runtime")) return { project_id: "P", execution_id: "E", run_id: "R", run_version: 10, attempt: 2, status: "running" };
    if (path.includes("/observations?")) return { ...observation, execution_id: decodeURIComponent(path.split("/executions/")[1].split("/")[0]) };
    const body = JSON.parse(String(init?.body)); h.sent.push(body);
    if (h.mode === "unknown") throw new TypeError("Reply lost after possible runtime plan creation");
    if (h.mode === "refused") throw new Error(h.failure);
    if (h.mode === "pending") return new Promise((resolve) => { h.resolve = resolve; });
    const answer = ack(body); return h.mode === "badAck" ? { ...answer, resource: { kind: "execution", id: "foreign" } } : answer;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("actual sync original recovery", () => {
  it("sends once for old double clicks and never reuses the old fresh callback after acknowledgement", async () => {
    const start = action(sync(), "sync-execution"); h.mode = "pending";
    const sending = start.onClick(); start.onClick(); await settle();
    expect(h.sent).toHaveLength(1); expect(saved).not.toHaveBeenCalled();
    expect(h.sent[0]).toMatchObject({ action: "execution.sync", payload: { id: "E" }, expected_version: 7 });
    h.resolve!(ack(h.sent[0])); await sending; await start.onClick();
    expect(h.sent).toHaveLength(1); expect(saved).toHaveBeenCalledTimes(1); expect(observed).toHaveBeenCalledTimes(1);
  });

  it("does not POST or report an unknown command when original persistence fails before send", async () => {
    const start = action(sync(), "sync-execution"); h.storageFail = "all"; await start.onClick();
    expect(h.sent).toHaveLength(0); expect(saved).not.toHaveBeenCalled(); expect(action(sync(), "retry-sync-original")).toBeUndefined();
    expect(find(sync(), Alert, (props) => props.title === "deliveryExecutionRuntime.retainedOriginalUnavailable")).toBeDefined();
  });

  it("dismisses a first definite observation refusal locally and invalidates the old fresh callback", async () => {
    const start = action(sync(), "sync-execution"); h.mode = "refused"; await start.onClick();
    const original = structuredClone(h.sent[0]); await start.onClick();
    expect(h.sent).toEqual([original]); expect(action(sync(), "retry-sync-original")).toBeUndefined(); expect(saved).not.toHaveBeenCalled();
    await action(sync(), "dismiss-sync-refused").onClick();
    await start.onClick(); expect(h.sent).toHaveLength(1);
    expect(executionDispatchRecoveryPending("P", "execution.sync", "E")).toBe(false);
  });

  it("recreates an unknown sync without fresh permission/version facts and replays exact transport bytes", async () => {
    await action(sync(), "sync-execution").onClick(); const original = structuredClone(h.sent[0]);
    recreate(); h.mode = "success";
    const retained = sync({ canSync: false, disabled: true, workspaceVersion: undefined });
    expect(action(retained, "sync-execution")).toBeUndefined(); await action(retained, "retry-sync-original").onClick();
    expect(h.sent).toEqual([original, original]); expect(saved).toHaveBeenCalledTimes(1);
    expect(executionDispatchRecoveryPending("P", "execution.sync", "E")).toBe(false);
  });

  it("preserves the original and recovery action after a later permission refusal", async () => {
    await action(sync(), "sync-execution").onClick(); h.mode = "refused"; h.failure = "HTTP 403: permission changed";
    await action(sync(), "retry-sync-original").onClick();
    expect(h.sent[1]).toEqual(h.sent[0]); expect(saved).not.toHaveBeenCalled(); expect(action(sync(), "retry-sync-original")).toBeDefined();
  });

  it("does not report success for a foreign execution acknowledgement", async () => {
    h.mode = "badAck"; await action(sync(), "sync-execution").onClick();
    expect(saved).not.toHaveBeenCalled(); expect(action(sync(), "retry-sync-original")).toBeDefined();
  });

  it("keeps confirmed cleanup pending and uses only local cleanup instead of a second POST", async () => {
    const start = action(sync(), "sync-execution"); h.mode = "success"; h.storageFail = "confirmed"; await start.onClick();
    const retained = sync(); expect(action(retained, "retry-sync-original")).toBeUndefined();
    expect(action(retained, "finish-sync-confirmed")).toBeDefined(); expect(unresolved.mock.calls.at(-1)).toEqual([true]);
    await start.onClick(); expect(h.sent).toHaveLength(1); expect(saved).not.toHaveBeenCalled();
    h.storageFail = "none"; await action(retained, "finish-sync-confirmed").onClick();
    expect(h.sent).toHaveLength(1); expect(saved).toHaveBeenCalledTimes(1); expect(unresolved.mock.calls.at(-1)).toEqual([false]);
  });

  it("does not turn an acknowledged sync into unknown when its parent refresh throws", async () => {
    const start = action(sync(), "sync-execution"); h.mode = "success"; saved.mockImplementationOnce(() => { throw new Error("Parent refresh failed"); });
    await start.onClick(); await start.onClick();
    expect(h.sent).toHaveLength(1); expect(action(sync(), "retry-sync-original")).toBeUndefined();
    expect(find(sync(), Alert, (props) => props.description === "deliveryExecutionRuntime.refreshAfterSaveFailed")).toBeDefined();
  });

  it("rejects old callbacks after a same-token login or selected-session change", async () => {
    const start = action(sync(), "sync-execution"); setSession("private-sync-token", "P", "tenant-a"); await start.onClick();
    expect(h.sent).toHaveLength(0); recreate();
    const current = action(sync(), "sync-execution"); sync({ sessionId: "another-selection" }); await current.onClick();
    expect(h.sent).toHaveLength(0); expect(saved).not.toHaveBeenCalled();
  });

  it("keeps actual Inspector recovery available when the initial detail query returns 403", async () => {
    await action(sync(), "sync-execution").onClick(); const original = structuredClone(h.sent[0]); recreate(); h.detailError = new Error("HTTP 403: detail forbidden");
    const host = inspector(), recovery = nodes(host).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(recovery).toBeDefined(); expect(find(host, Drawer).closable).toBe(false); expect(nodes(host).filter((node) => node.type === ExecutionObservationCard)).toHaveLength(0);
    const tree = frame("gate", () => ExecutionOperationRecovery(recovery.props));
    const retained = nodes(tree).find((node) => node.type === ExecutionSyncControl)!; h.mode = "success";
    await action(frame("sync", () => ExecutionSyncControl(retained.props)), "retry-sync-original").onClick();
    expect(h.sent).toEqual([original, original]); expect(saved).toHaveBeenCalledTimes(1);
    expect(nodes(inspector()).filter((node) => node.type === ExecutionObservationCard)).toHaveLength(0);
  });

  it("keeps an Inspector-to-Card sync original when its already-started detail GET fails", async () => {
    h.detailReady = true;
    const card = nodes(inspector()).find((node) => node.type === ExecutionObservationCard)!;
    const renderCard = () => frame("inspector-card", () => ExecutionObservationCard(card.props));
    renderCard(); h.effects["inspector-card"][0].run(); await settle();
    const syncElement = nodes(renderCard()).find((node) => node.type === ExecutionSyncControl)!;
    await action(frame("sync", () => ExecutionSyncControl(syncElement.props)), "sync-execution").onClick();
    const original = structuredClone(h.sent[0]); h.detailError = new Error("HTTP 403: in-flight detail read denied");
    const failed = inspector(), retained = nodes(failed).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(retained).toBeDefined(); expect(find(failed, Drawer).closable).toBe(false);
    expect(nodes(failed).some((node) => node.type === ExecutionObservationCard)).toBe(false);
    retained.props.onUnresolvedChange(false);
    expect(nodes(inspector()).some((node) => node.type === ExecutionOperationRecovery)).toBe(true);
    h.effects.inspector.find((effect) => effect.deps?.[0] === "E" && effect.deps?.[1] === "")!.run();
    h.detailError = null;
    const reread = inspector();
    expect(nodes(reread).find((node) => node.type === ExecutionOperationRecovery)!.key).toBe(retained.key);
    expect(nodes(reread).some((node) => node.type === ExecutionObservationCard)).toBe(false);
    h.mode = "success"; await action(recoverySync(reread, "inspector-recovery"), "retry-sync-original").onClick();
    expect(h.sent).toEqual([original, original]); expect(saved).toHaveBeenCalledTimes(1);
    expect(nodes(inspector()).some((node) => node.type === ExecutionObservationCard)).toBe(true);
  });

  it("recovers stored runtime and sync originals serially without releasing their shared exit guard early", async () => {
    await action(sync(), "sync-execution").onClick();
    seedRuntimeOriginal();
    recreate(); h.mode = "success";
    const first = nodes(gate()).find((node) => node.type === ExecutionRuntimeControl)!; expect(first).toBeDefined();
    const runtime = frame("runtime", () => ExecutionRuntimeControl(first.props));
    await action(runtime, "retry-original").onClick();
    expect(unresolved.mock.calls.at(-1)).toEqual([true]);
    const second = nodes(gate()).find((node) => node.type === ExecutionSyncControl)!;
    expect(second).toBeDefined(); expect(nodes(gate()).filter((node) => node.type === ExecutionRuntimeControl)).toHaveLength(0);
    await action(frame("sync", () => ExecutionSyncControl(second.props)), "retry-sync-original").onClick();
    expect(h.sent.map((body) => body.action)).toEqual(["execution.sync", "execution.cancel", "execution.sync"]);
    expect(unresolved.mock.calls.at(-1)).toEqual([false]); expect(saved).toHaveBeenCalledTimes(2);
  });
});

describe("actual cold-route recovery gate", () => {
  it("withholds the context child through both slots and confirmed cleanup, ignoring a premature false notification", async () => {
    await action(sync(), "sync-execution").onClick(); const syncOriginal = structuredClone(h.sent[0]); seedRuntimeOriginal(); recreate(); h.mode = "success";
    const readContext = vi.fn();
    function ContextConsumer() { readContext(); return createElement("div", null, "Context facts"); }
    const child = createElement(ContextConsumer);
    const mountReturnedContext = (tree: ReactNode) => {
      nodes(tree).filter((node) => node.type === ContextConsumer).forEach(() => ContextConsumer());
    };
    const cold = startup(child), operation = nodes(cold).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(operation).toBeDefined(); expect(operation.props).toMatchObject({ projectId: "P", executionId: "E" });
    mountReturnedContext(cold); expect(readContext).not.toHaveBeenCalled();
    operation.props.onUnresolvedChange(false);
    expect(nodes(startup(child)).some((node) => node.type === ContextConsumer)).toBe(false);
    const first = nodes(startupOperation(startup(child))).find((node) => node.type === ExecutionRuntimeControl)!;
    expect(first).toBeDefined(); first.props.onUnresolvedChange(false);
    const stillFirst = startupOperation(startup(child));
    expect(nodes(stillFirst).some((node) => node.type === ExecutionRuntimeControl)).toBe(true);
    expect(nodes(stillFirst).some((node) => node.type === ExecutionSyncControl)).toBe(false);
    await action(frame("runtime", () => ExecutionRuntimeControl(first.props)), "retry-original").onClick();
    const waitingForSync = startup(child); mountReturnedContext(waitingForSync);
    expect(readContext).not.toHaveBeenCalled(); expect(h.invalidations).toHaveLength(1);
    const second = nodes(startupOperation(waitingForSync)).find((node) => node.type === ExecutionSyncControl)!;
    expect(second).toBeDefined(); h.storageFail = "confirmed";
    await action(frame("sync", () => ExecutionSyncControl(second.props)), "retry-sync-original").onClick();
    const confirmed = frame("sync", () => ExecutionSyncControl(second.props));
    expect(action(confirmed, "finish-sync-confirmed")).toBeDefined();
    mountReturnedContext(startup(child)); expect(readContext).not.toHaveBeenCalled(); expect(h.invalidations).toHaveLength(1);
    h.storageFail = "none"; await action(confirmed, "finish-sync-confirmed").onClick();
    const ready = startup(child); expect(ready).toBe(child); mountReturnedContext(ready);
    expect(readContext).toHaveBeenCalledTimes(1); expect(h.invalidations).toHaveLength(2);
    expect(h.sent.map((body) => body.action)).toEqual(["execution.sync", "execution.cancel", "execution.sync"]);
    expect(h.sent[2]).toEqual(syncOriginal);
  });

  it.each([
    "#/dev-flow?execution_id=E&project_id=Q", "#/dev-flow?execution_id=E&project_id=P&project_id=P",
    "#/dev-flow?execution_id=E&execution_id=E", "#/projects?execution_id=E", "#/dev-flow?execution_id=E#foreign",
  ])("does not bind another or ambiguous URL to the retained operation: %s", async (hash) => {
    await action(sync(), "sync-execution").onClick();
    expect(executionRouteRecoverySelection("#/dev-flow?execution_id=E&project_id=P", "P")).toEqual({ projectId: "P", kind: "execution", id: "E" });
    expect(executionRouteRecoverySelection(hash, "P")).toBeNull();
    expect(executionRouteRecoverySelection("#/dev-flow?execution_id=E&project_id=P", "Q")).toBeNull();
    expect(h.sent).toHaveLength(1);
  });

  it("does not downgrade duplicate execution IDs into a valid pending task queue recovery", async () => {
    await action(sync(), "sync-execution").onClick(); seedQueueOriginal();
    expect(executionRouteRecoverySelection("#/dev-flow?task=T", "P")).toEqual({ projectId: "P", kind: "queue", id: "T" });
    expect(executionRouteRecoverySelection("#/dev-flow?execution_id=E&execution_id=E&task=T", "P")).toBeNull();
    expect(h.sent).toHaveLength(1);
  });

  it.each(["login", "project"])("does not replay or invalidate from an old startup host after a %s change", async (change) => {
    await action(sync(), "sync-execution").onClick(); recreate();
    const child = createElement("div", null, "Context facts"), cold = startup(child);
    const operation = nodes(cold).find((node) => node.type === ExecutionOperationRecovery)!;
    const retained = nodes(startupOperation(cold)).find((node) => node.type === ExecutionSyncControl)!;
    const retry = action(frame("sync", () => ExecutionSyncControl(retained.props)), "retry-sync-original");
    if (change === "login") setSession("private-sync-token", "P", "tenant-a");
    else setWorkspaceScope({ projectId: "Q", projectCode: "Q" });
    h.mode = "success"; await retry.onClick();
    operation.props.onSaved(ack(h.sent[0])); operation.props.onUnresolvedChange(false);
    expect(operation.props.isActive()).toBe(false); expect(h.sent).toHaveLength(1); expect(h.invalidations).toHaveLength(0);
  });
});

describe("actual task and historical execution recovery consumers", () => {
  it("preserves a TaskDetail-to-Panel-to-Card sync original when the task GET fails", async () => {
    const chain = await liveTaskChain();
    await action(frame("sync", () => ExecutionSyncControl(chain.syncElement.props)), "sync-execution").onClick();
    const original = structuredClone(h.sent[0]); h.readFailure = "task";
    const failed = taskHost(), content = nodes(failed).find((node) => node.type === TaskDetailContent)!;
    expect(content.props.detail).toBeUndefined(); expect(content.props.pinnedDetail).toBeUndefined();
    expect(frame("task-content", () => TaskDetailContent(content.props))).toBeNull();
    const retained = nodes(failed).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(retained.props).toMatchObject({ projectId: "P", executionId: "E" });
    h.effects.task.find((effect) => effect.deps?.[0] === "E" && effect.deps?.[1] === "")!.run();
    h.readFailure = null;
    expect(nodes(taskHost()).some((node) => node.type === ExecutionOperationRecovery)).toBe(true);
    h.mode = "success"; await action(recoverySync(taskHost(), "task-recovery"), "retry-sync-original").onClick();
    expect(h.sent).toEqual([original, original]); expect(executionDispatchRecoveryPending("P", "execution.sync", "E")).toBe(false);
    expect(nodes(taskHost()).some((node) => node.type === ExecutionOperationRecovery)).toBe(false);
  });

  it("keeps Panel recovery independent of failed then successful current-execution GETs", async () => {
    const chain = await liveTaskChain();
    await action(frame("sync", () => ExecutionSyncControl(chain.syncElement.props)), "sync-execution").onClick();
    const original = structuredClone(h.sent[0]); h.readFailure = "execution";
    const failed = chain.renderPanel(), retained = nodes(failed).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(retained).toBeDefined(); expect(nodes(failed).some((node) => node.type === ExecutionObservationCard)).toBe(false);
    h.effects["task-panel"].find((effect) => effect.deps?.[0] === "E" && effect.deps?.[1] === "")!.run();
    h.readFailure = null;
    const reread = chain.renderPanel();
    expect(nodes(reread).find((node) => node.type === ExecutionOperationRecovery)!.key).toBe(retained.key);
    expect(nodes(reread).some((node) => node.type === ExecutionObservationCard)).toBe(false);
    h.mode = "success"; await action(recoverySync(reread, "panel-recovery"), "retry-sync-original").onClick();
    expect(h.sent).toEqual([original, original]);
    expect(nodes(chain.renderPanel()).some((node) => node.type === ExecutionOperationRecovery)).toBe(false);
  });

  it("keeps the real historical ExactExecutionCard original through a detail GET failure", async () => {
    const chain = await liveTaskChain();
    find(chain.renderPanel(), Button, (props) => props.children === "deliveryExecutionRuntime.openHistory").onClick();
    const exact = nodes(chain.renderPanel()).find((node) => typeof node.type === "function" && node.type.name === "ExactExecutionCard")!;
    const renderExact = () => frame("history-exact", () => exact.type(exact.props));
    const card = nodes(renderExact()).find((node) => node.type === ExecutionObservationCard)!;
    const renderHistoryCard = () => frame("history-card", () => ExecutionObservationCard(card.props));
    renderHistoryCard(); h.effects["history-card"][0].run(); await settle();
    const syncElement = nodes(renderHistoryCard()).find((node) => node.type === ExecutionSyncControl)!;
    await action(frame("history-sync", () => ExecutionSyncControl(syncElement.props)), "sync-execution").onClick();
    const original = structuredClone(h.sent[0]); expect(original.payload.id).toBe("E-history");
    h.readFailure = "execution";
    const failed = renderExact(); expect(nodes(failed).some((node) => node.type === ExecutionOperationRecovery)).toBe(true);
    expect(nodes(failed).some((node) => node.type === ExecutionObservationCard)).toBe(false);
    h.effects["history-exact"].at(-1)!.run(); h.readFailure = null;
    expect(nodes(renderExact()).some((node) => node.type === ExecutionOperationRecovery)).toBe(true);
    h.mode = "success"; await action(recoverySync(renderExact(), "history-recovery"), "retry-sync-original").onClick();
    expect(h.sent).toEqual([original, original]); expect(executionDispatchRecoveryPending("P", "execution.sync", "E-history")).toBe(false);
    expect(nodes(renderExact()).some((node) => node.type === ExecutionObservationCard)).toBe(true);
  });

  it.each(["read-error", "row-removed"])("keeps the opened historical sync outside its list after %s", async (failure) => {
    const chain = await liveTaskChain();
    find(chain.renderPanel(), Button, (props) => props.children === "deliveryExecutionRuntime.openHistory").onClick();
    const exact = nodes(chain.renderPanel()).find((node) => typeof node.type === "function" && node.type.name === "ExactExecutionCard")!;
    const exactTree = frame("history-exact", () => exact.type(exact.props));
    const card = nodes(exactTree).find((node) => node.type === ExecutionObservationCard)!;
    const renderHistoryCard = () => frame("history-card", () => ExecutionObservationCard(card.props));
    renderHistoryCard(); h.effects["history-card"][0].run(); await settle();
    const syncElement = nodes(renderHistoryCard()).find((node) => node.type === ExecutionSyncControl)!;
    await action(frame("history-sync", () => ExecutionSyncControl(syncElement.props)), "sync-execution").onClick();
    const original = structuredClone(h.sent[0]); expect(original.payload.id).toBe("E-history");
    h.historyFailure = failure === "read-error"; h.historyOmit = failure === "row-removed";
    const failed = chain.renderPanel(), retained = nodes(failed).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(retained.props.executionId).toBe("E-history");
    expect(nodes(failed).some((node) => typeof node.type === "function" && node.type.name === "ExactExecutionCard")).toBe(false);
    retained.props.onUnresolvedChange(false);
    expect(nodes(chain.renderPanel()).some((node) => node.type === ExecutionOperationRecovery)).toBe(true);
    h.effects["task-panel"].find((effect) => effect.deps?.[0] === "E-history" && effect.deps?.[1] === "")!.run();
    h.historyFailure = false; h.historyOmit = false;
    const restoredList = chain.renderPanel();
    expect(nodes(restoredList).find((node) => node.type === ExecutionOperationRecovery)!.key).toBe(retained.key);
    expect(nodes(restoredList).some((node) => typeof node.type === "function" && node.type.name === "ExactExecutionCard")).toBe(false);
    h.mode = "success"; await action(recoverySync(restoredList, "history-list-recovery"), "retry-sync-original").onClick();
    expect(h.sent).toEqual([original, original]); expect(executionDispatchRecoveryPending("P", "execution.sync", "E-history")).toBe(false);
    expect(nodes(chain.renderPanel()).some((node) => node.type === ExecutionOperationRecovery)).toBe(false);
  });
});
