/** Actual read/controller/component definitions. Runtime, type and visual verification are deferred. */
import { isValidElement, type ReactNode } from "react";
import { Button, Descriptions, Input, Modal } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import { setSession, USER_KEY } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";
import { ExecutionRuntimeControl } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRuntimeControl";
import { ExecutionControlOperationStatus } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionControlOperationStatus";
import { ExecutionObservationCard } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionObservationCard";
import { ExecutionRuntimePanel } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRuntimePanel";
import { readControlOperation, readControlOperations, useExecutionControlOperations, validControlOperation,
  type ControlOperation, type ControlOperationDetail, type ExecutionControlOperationsRead } from "./executionControlOperations";
import { createExecutionControlController, executionControlCloseOriginal, executionControlRecoveryPending } from "./executionControlCommand";
import type { DeliveryExecution } from "./delivery";
import type { ExecutionRuntime } from "./executionRuntime";
import { qualityFixture } from "./executionQualityFixtures";
import { executionControlOperationsCopy } from "../i18n/execution-control-operations";

const h = vi.hoisted(() => ({ frames: {} as Record<string, any[]>, frame: "", next: 0, queries: [] as any[],
  page: {} as any, detail: {} as any, local: new Map<string, string>(), retained: new Map<string, string>(),
  sent: [] as any[], saved: vi.fn(), unresolved: vi.fn(), accept: vi.fn(), invalidate: vi.fn(),
}));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useRef: (initial: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
  useState: (initial: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
  useMemo: (factory: () => unknown, deps: unknown[]) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots) || deps.some((part, i) => part !== slots[index].deps[i])) slots[index] = { deps, value: factory() }; return slots[index].value; },
  useCallback: (value: unknown) => value, useEffect: () => {}, useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }) }));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: any) => { h.queries.push(options); return options.queryKey[0] === "delivery-control-operation" ? h.detail : h.page; }, useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
const now = "2026-10-21T00:00:00Z", digest = "a".repeat(64), copy = executionControlOperationsCopy("zh-CN");
const operation = (patch: Partial<ControlOperation> = {}): ControlOperation => ({ id: "C", execution_id: "E", task_id: "T", workspace_id: "W", action: "execution.start", request_digest: digest,
  state: "blocked", revision: 2, attempt: 1, accepted_at: now, updated_at: now, next_attempt_at: null, error: { code: "permission_changed", message: "Original authority changed" },
  run_id: null, run_attempt: null, outcome: null, launch: null, target_operation_id: null, permissions: { can_close: true }, ...patch });
const detail = (patch: Partial<ControlOperation> = {}, version = 12): ControlOperationDetail => ({ project_id: "P", execution_id: "E", task_id: "T", version, operation: operation(patch) });
const page = (items: ControlOperation[] = []) => ({ project_id: "P", execution_id: "E", task_id: "T", version: 12, items, total: items.length, limit: 20, next_cursor: null, as_of: now });
const runtime: ExecutionRuntime = { project_id: "P", execution_id: "E", run_id: "R", run_version: 7, attempt: 1, status: "queued", runtime_status: "queued", stale: false,
  review_verified: false, quality: qualityFixture({ execution_id: "E", run_id: "R", run_version: 7, attempt: 1 }), can_review: false, can_accept: false,
  active_node_id: null, observed_at: now, recovery_requires_review: false, stop: null, approval: null, nodes: [],
  controls: { start: { allowed: true, reasons: [] }, retry: { allowed: true, reasons: [] }, cancel: { allowed: true, reasons: [] }, approval: { allowed: true, reasons: [] }, approval_reject: { allowed: true, reasons: [] } } };
function read(patch: Partial<ExecutionControlOperationsRead> = {}): ExecutionControlOperationsRead {
  return { projectId: "P", executionId: "E", taskId: "T", workspaceId: "W", readable: true, operation: operation(), version: 12, pending: true,
    accepted: null, items: [operation()], selected: false, error: null, isPending: false, isFetching: false, paused: false, nextCursor: null, cursor: "",
    isReadable: () => true, hasPending: () => true, refresh: vi.fn(), earlier: vi.fn(), first: vi.fn(), accept: h.accept, select: vi.fn(), readExact: vi.fn(async () => detail()), ...patch };
}
function frame<T>(name: string, callback: () => T) { h.frame = name; h.next = 0; return callback(); }
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...["children", "footer", "action", "description"].flatMap((key) => nodes(node.props[key]))]; }
const find = (tree: ReactNode, type: unknown, condition: (props: any) => boolean = () => true) => nodes(tree).find((node) => node.type === type && condition(node.props))?.props;
const button = (tree: ReactNode, text: string) => find(tree, Button, (props) => props.children === text);
function control(controlRead = read(), patch: Partial<Parameters<typeof ExecutionRuntimeControl>[0]> = {}) {
  return frame("control", () => ExecutionRuntimeControl({ projectId: "P", executionId: "E", workspaceId: "W", sessionId: "session", runtime,
    controlRead, onSaved: h.saved, onObserved: vi.fn(), onUnresolvedChange: h.unresolved, ...patch }));
}
function answer(body: any) { return { project_id: "P", action: body.action, resource: { kind: "execution", id: "E" }, result: { control_operation_id: "K", request_digest: "b".repeat(64) },
  affected_refs: [{ kind: "execution", id: "E" }], applied_version: body.expected_version + 1, version: body.expected_version + 1, query_generation: 1, replayed: false }; }
beforeEach(() => {
  h.frames = {}; h.frame = ""; h.next = 0; h.queries = []; h.local.clear(); h.retained.clear(); h.sent = []; h.saved.mockReset(); h.unresolved.mockReset(); h.accept.mockReset(); h.invalidate.mockReset();
  vi.stubGlobal("localStorage", { getItem: (key: string) => h.local.get(key) || null, setItem: (key: string, value: string) => h.local.set(key, value), removeItem: (key: string) => h.local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => h.retained.get(key) || null, setItem: (key: string, value: string) => h.retained.set(key, value) });
  const location = { hash: "#/dev-flow?execution_id=E", href: "http://localhost/#/dev-flow?execution_id=E" };
  vi.stubGlobal("location", location); vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  setSession("private-token", "P", "tenant"); h.local.set(USER_KEY, JSON.stringify({ id: "operator", tenant_id: "tenant" }));
  h.page = { data: page(), error: null, isPending: false, isFetching: false, refetch: vi.fn() };
  h.detail = { data: detail(), error: null, isPending: false, isFetching: false, refetch: vi.fn() };
  vi.mocked(request).mockReset().mockImplementation(async (path, init) => {
    if (path.includes("/control-operations/")) return detail(); if (path.includes("/control-operations?")) return page();
    if (path.endsWith("/runtime")) return runtime;
    const body = JSON.parse(String(init?.body)); h.sent.push(body); return answer(body);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("durable control actual reads and accepted state", () => {
  it("reads exactly one bounded list with an explicit project and no private original", async () => {
    expect(await readControlOperations("P", "E", "T", "W", projectSessionKey())).toEqual(page());
    expect(request).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledWith("/api/v1/delivery/executions/E/control-operations?limit=20", expect.objectContaining({ headers: { "X-Project-Id": "P" } }));
  });
  it.each(["project", "execution", "task", "digest"])("rejects a detail that changes the exact %s", async (field) => {
    const value: any = detail(); if (field === "digest") value.operation.request_digest = "c".repeat(64); else value[field === "project" ? "project_id" : field === "task" ? "task_id" : "execution_id"] = "other";
    vi.mocked(request).mockResolvedValueOnce(value); await expect(readControlOperation("P", "E", "T", "W", "C", projectSessionKey(), digest)).rejects.toThrow("controlOperationInvalid");
  });
  it("rejects a launch without its actual run and attempt", () => {
    expect(validControlOperation(operation({ launch: { id: "L", state: "ready", claimed_at: null } }), "E", "T", "W")).toBe(false);
  });
  it("requires a new login scope after a request completes", async () => {
    let finish!: (value: unknown) => void; vi.mocked(request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = readControlOperations("P", "E", "T", "W", projectSessionKey()); setSession("private-token", "P", "tenant"); finish(page());
    await expect(pending).rejects.toThrow("controlOperationScopeChanged");
  });
  it("keeps the actual terminal result visible and never loads list-row details automatically", () => {
    h.page.data = page([operation({ state: "applied", outcome: "applied", permissions: { can_close: false } })]);
    const value = frame("read", () => useExecutionControlOperations("P", "E", "T", "W", "session"));
    expect(value.operation?.state).toBe("applied"); expect(value.hasPending()).toBe(false);
    expect(h.queries.filter((query) => query.enabled)).toHaveLength(1); expect(h.queries[0].queryKey[0]).toBe("delivery-control-operations"); expect(h.queries[1].enabled).toBe(false); expect(request).not.toHaveBeenCalled();
  });
  it("switches an actual accepted ACK to its exact C and digest without locking navigation", () => {
    const open = () => frame("read", () => useExecutionControlOperations("P", "E", "T", "W", "session"));
    open().accept(answer({ action: "execution.start", expected_version: 11 })); const value = open();
    expect(h.queries.at(-1).queryKey.at(-2)).toBe("K"); expect(h.queries.at(-1).queryKey.at(-1)).toBe("b".repeat(64)); expect(value.readable).toBe(false); expect(value.hasPending()).toBe(true);
  });
});

describe("durable control actual interaction consumers", () => {
  it("blocks fresh control callbacks until the first C read succeeds, without blocking an original recovery", () => {
    const tree = control(read({ readable: false, isReadable: () => false }));
    expect(button(tree, "deliveryExecutionRuntime.start").disabled).toBe(true); expect(button(tree, "deliveryExecutionRuntime.cancelRun").disabled).toBe(true);
    button(tree, "deliveryExecutionRuntime.start").onClick(); expect(find(control(), Modal).open).toBe(false); expect(h.sent).toHaveLength(0);
  });
  it("leaves explicit cancel available while an ordinary control is pending", () => {
    const tree = control(); expect(button(tree, "deliveryExecutionRuntime.start").disabled).toBe(true); expect(button(tree, "deliveryExecutionRuntime.retryRun").disabled).toBe(true);
    expect(button(tree, "deliveryExecutionRuntime.cancelRun").disabled).toBe(false); expect(h.unresolved).not.toHaveBeenCalledWith(true);
  });
  it.each([{ selected: true, cursor: "" }, { selected: false, cursor: "older-page" }])("does not infer all-E control availability from a historical terminal selection: %j", (selection) => {
    const tree = control(read({ ...selection, pending: false, hasPending: () => false, operation: operation({ state: "applied", outcome: "applied", permissions: { can_close: false } }) }));
    expect(button(tree, "deliveryExecutionRuntime.start").disabled).toBe(true); expect(button(tree, "deliveryExecutionRuntime.retryRun").disabled).toBe(true);
    expect(button(tree, "deliveryExecutionRuntime.approveGate").disabled).toBe(true); expect(button(tree, "deliveryExecutionRuntime.cancelRun").disabled).toBe(false);
    expect(JSON.stringify(tree)).toContain(copy.recentBeforeControl);
  });
  it("keeps target state and reason primary while the fixed C and digest stay in collapsed request details", () => {
    find(control(), ExecutionControlOperationStatus).onCloseRequested(operation()); const tree = control();
    const primary = find(tree, Descriptions); expect(primary.items.map((item: any) => item.key)).toEqual(["action", "state", "accepted"]); expect(JSON.stringify(primary)).not.toContain(digest);
    const details = find(tree, "details"); expect(JSON.stringify(details)).toContain(digest); expect(JSON.stringify(tree)).toContain(copy.closeHint);
  });
  it("previews and submits a close with the exact target and freshly read project version", async () => {
    const value = read(), render = () => control(value);
    const status = find(render(), ExecutionControlOperationStatus); status.onCloseRequested(operation());
    find(render(), Input.TextArea).onChange({ target: { value: "Original executor is unavailable" } });
    await button(render(), copy.reviewClose).onClick(); expect(h.sent).toHaveLength(0);
    await button(render(), copy.confirmClose).onClick();
    expect(h.sent).toHaveLength(1); expect(h.sent[0]).toMatchObject({ action: "execution.control.close", expected_version: 12,
      payload: { id: "E", control_operation_id: "C", request_digest: digest, reason: "Original executor is unavailable" } });
    expect(h.accept).toHaveBeenCalledTimes(1); expect(h.saved).toHaveBeenCalledTimes(1); expect(executionControlRecoveryPending("P", "E")).toBe(false);
  });
  it("retains a lost close reply as the same immutable request even when C GET fails", async () => {
    const value = read(), render = () => control(value); find(render(), ExecutionControlOperationStatus).onCloseRequested(operation());
    find(render(), Input.TextArea).onChange({ target: { value: "Close this fixed request" } }); await button(render(), copy.reviewClose).onClick();
    vi.mocked(request).mockRejectedValueOnce(new TypeError("Reply lost")); await button(render(), copy.confirmClose).onClick();
    const raw = [...h.retained.values()][0], saved = JSON.parse(raw); expect(saved.phase).toBe("unknown"); expect(saved.original.payload.control_operation_id).toBe("C");
    const recovery = control(read({ readable: false, isReadable: () => false }), { runtime: undefined, disabled: true });
    await find(recovery, Button, (props) => props["data-action"] === "retry-original").onClick();
    expect(h.sent[0]).toEqual({ action: saved.original.action, payload: saved.original.payload, expected_version: saved.original.intent.version, idempotency_key: saved.original.intent.key });
  });
  it("does not call an already applied target a successful withdrawal", () => {
    const value = read({ operation: operation({ action: "execution.control.close", state: "applied", outcome: "needs_review", target_operation_id: "C0", permissions: { can_close: false } }) });
    const tree = frame("status", () => ExecutionControlOperationStatus({ read: value }));
    expect(JSON.stringify(tree)).toContain(copy.reviewHint); expect(JSON.stringify(tree)).not.toContain(copy.closedHint); expect(button(tree, copy.close)).toBeUndefined();
  });
  it("shows executor claim as separate evidence and never labels it a process start", () => {
    const tree = frame("status", () => ExecutionControlOperationStatus({ read: read({ operation: operation({ state: "applied", outcome: "applied", run_id: "R", run_attempt: 1, launch: { id: "L", state: "claimed", claimed_at: now }, permissions: { can_close: false } }) }) }));
    expect(JSON.stringify(tree)).toContain(copy.launchStates.claimed); expect(JSON.stringify(tree)).toContain(copy.claimedHint);
  });
  it("refreshes actual runtime facts after background processing even when normal polling is paused", async () => {
    const observed = vi.fn(), tree = control(read(), { onObserved: observed });
    find(tree, ExecutionControlOperationStatus).onFactsRequested();
    for (let index = 0; index < 24; index++) await Promise.resolve();
    expect(observed).toHaveBeenCalledWith(runtime); expect(h.sent).toHaveLength(0); expect(h.unresolved).not.toHaveBeenCalledWith(true);
  });
  it("has one C read owner in the actual ObservationCard and passes it to the runtime owner", () => {
    const entry = { id: "E", task_id: "T", workspace_id: "W", status: "queued", run_id: "R", snapshot: { task_acceptance_criteria: [] }, test_node_ids: [] } as unknown as DeliveryExecution;
    const tree = frame("card", () => ExecutionObservationCard({ entry, projectId: "P", active: false, sessionId: "session", workspaceVersion: 12, onSaved: h.saved, onCommand: vi.fn(async () => {}) }));
    const panel = find(tree, ExecutionRuntimePanel); expect(panel.controlRead).toBeDefined();
    expect(h.queries.filter((query) => query.queryKey[0] === "delivery-control-operations")).toHaveLength(1);
  });
  it("uses one original controller for close replay with identical bytes after SQL version changes", async () => {
    const original = executionControlCloseOriginal("P", "E", detail(), "Close this fixed request", "fixed-close-key"); let raw: string | null = null; const sent: string[] = [];
    const create = () => createExecutionControlController({ projectId: "P", executionId: "E", scope: "scope", currentScope: () => "scope", load: () => raw,
      save: (value) => { raw = value; }, send: async (value) => { sent.push(JSON.stringify(value)); if (sent.length === 1) throw new TypeError("Lost response"); return answer({ action: value.action, expected_version: value.intent.version }); } });
    await create().run(original); original.intent.version = 99; await create().replay(); expect(sent).toHaveLength(2); expect(sent[1]).toBe(sent[0]);
  });
});
