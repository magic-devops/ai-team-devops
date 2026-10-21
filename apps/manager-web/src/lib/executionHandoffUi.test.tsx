import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Alert, Button } from "antd";
import { ExecutionHandoffStatus, handoffControlsId } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionHandoffStatus";
import { ExecutionObservationCard } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionObservationCard";
import { ExecutionRuntimePanel } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRuntimePanel";
import { ExecutionSyncControl } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionSyncControl";
import { DeliveryExecutionPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionPanel";
import { ExecutionPlanEditor } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionPlanEditor";
import { readExecutionHandoff, validExecutionHandoff, type ExecutionHandoffResponse } from "./executionHandoff";
import { createExecutionDispatchController } from "./executionDispatchCommand";
import { executionHandoffCopy } from "../i18n/execution-handoff";
import { request } from "./http";
import type { DeliveryExecution, DeliveryTaskData } from "./delivery";

const h = vi.hoisted(() => ({ scope: "scope-a", language: "zh-CN", hooks: {} as Record<string, any[]>, component: "status", next: 0,
  effects: [] as Array<() => void>, queries: [] as any[], handoff: {} as any, exact: {} as any, invalidation: vi.fn(), refresh: vi.fn(), send: vi.fn(), saved: vi.fn(),
  sync: undefined as any, raw: "", effectsEnabled: true,
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const read = (initial: any) => { const values = h.hooks[h.component] ||= [], index = h.next++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values, index] as const; };
  return { ...actual, useState: (initial: any) => { const [values, index] = read(initial); return [values[index], (next: any) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef: (initial: any) => { const [values, index] = read({ current: initial }); return values[index]; }, useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void, deps: unknown[]) => { const [values, index] = read(undefined); if (h.effectsEnabled && (!values[index] || deps.some((part, i) => part !== values[index][i]))) { values[index] = deps; h.effects.push(effect); } },
  };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: h.language } }) }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => h.scope }));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => { h.queries.push(options); return options.queryKey[0] === "delivery-execution-handoff" ? h.handoff : options.queryKey[0] === "delivery-execution-exact" ? h.exact :
    options.queryKey[0] === "delivery-control-operations" ? { data: { project_id: "P", execution_id: "E", task_id: "T", version: 7, items: [], total: 0, limit: 20, next_cursor: null, as_of: "2026-10-21T00:00:00Z" }, error: null, isPending: false } :
    { data: { can_execute: true, runtime_configured: true, workspaces: [] }, error: null, isError: false }; },
  useInfiniteQuery: () => ({ data: { pages: [{ items: [] }] }, error: null }), useQueryClient: () => ({ invalidateQueries: h.invalidation }),
}));
vi.mock("./executionDispatchCommand", async () => ({ ...await vi.importActual<typeof import("./executionDispatchCommand")>("./executionDispatchCommand"),
  useExecutionDispatchCommand: () => { const state = h.sync.snapshot(); return { ...h.sync, state, locked: !["idle", "refused"].includes(state.phase) }; },
}));
const now = "2026-10-20T12:00:00Z";
const detail = (state: ExecutionHandoffResponse["handoff"]["state"] = "accepted", revision = 1): ExecutionHandoffResponse => ({ project_id: "P", execution_id: "E", task_id: "T", handoff: {
  id: "H", execution_id: "E", task_id: "T", workspace_id: "W", state, revision, attempt: state === "accepted" ? 0 : 1, accepted_at: now, updated_at: now, next_attempt_at: null,
  error: state === "blocked" ? { code: "binding_changed", message: "The original member binding changed" } : null,
  run_id: state === "planned" ? "R" : null, runtime_task_id: state === "planned" ? "RT" : null,
} });
const entry = { id: "E", task_id: "T", workspace_id: "W", handoff_id: "H", status: "pending_dispatch", run_id: "", attempt: 1, snapshot: { title: "Private task title", task_acceptance_criteria: [], requirement: null }, test_node_ids: [] } as unknown as DeliveryExecution;
function run<T>(name: string, render: () => T, effects = false) { h.component = name; h.next = 0; h.effects = []; h.effectsEnabled = effects; const tree = render(); h.effects.forEach((effect) => effect()); return tree; }
function status() { return run("status", () => ExecutionHandoffStatus({ projectId: "P", executionId: "E", taskId: "T", sessionId: "s", controlsAvailable: true }), true); }
function card(value = entry) { return run("card", () => ExecutionObservationCard({ projectId: "P", entry: value, sessionId: "s", workspaceVersion: 7, onSaved: h.saved, onCommand: h.send, active: true })); }
function nodes(node: ReactNode): ReactElement<any>[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...["children", "action", "description", "footer"].flatMap((key) => nodes(node.props[key])), ...(node.props.items || []).flatMap((item: any) => nodes(item.children))]; }
const ack = { project_id: "P", action: "execution.sync", resource: { kind: "execution", id: "E" }, result: null, affected_refs: [{ kind: "execution", id: "E" }], applied_version: 8, version: 8, query_generation: 2, replayed: false };
beforeEach(() => {
  h.scope = "scope-a"; h.language = "zh-CN"; h.hooks = {}; h.queries = []; h.effects = []; h.raw = "";
  h.invalidation.mockReset(); h.refresh.mockReset(); h.send.mockReset().mockResolvedValue(ack); h.saved.mockReset();
  h.handoff = { data: detail(), error: null, isPending: false, isFetching: false, refetch: h.refresh };
  h.exact = { data: { execution: entry }, error: null, isError: false, isPending: false };
  vi.mocked(request).mockReset().mockResolvedValue(detail());
  h.sync = createExecutionDispatchController({ projectId: "P", action: "execution.sync", targetId: "E", scope: h.scope, currentScope: () => h.scope, load: () => h.raw || null, save: (value) => { h.raw = value; }, send: h.send });
});

describe("durable handoff actual read and UI consumers (definitions, unexecuted)", () => {
  it("uses one exact scoped GET and validates both outer and inner identities", async () => {
    expect(await readExecutionHandoff("P", "E", "T", h.scope)).toEqual(detail());
    expect(request).toHaveBeenCalledWith("/api/v1/delivery/executions/E/handoff", expect.objectContaining({ headers: { "X-Project-Id": "P" } }));
    expect(vi.mocked(request).mock.calls[0][1]?.method).toBeUndefined();
  });
  it.each(["outer_project", "outer_execution", "outer_task", "inner_execution", "inner_task", "wrong_refs", "bad_state", "bad_revision", "bad_time"])("rejects mismatched or damaged handoff data: %s", (change) => {
    const value = structuredClone(detail()) as any;
    if (change === "outer_project") value.project_id = "Q";
    if (change === "outer_execution") value.execution_id = "E-other";
    if (change === "outer_task") value.task_id = "T-other";
    if (change === "inner_execution") value.handoff.execution_id = "E-other";
    if (change === "inner_task") value.handoff.task_id = "T-other";
    if (change === "wrong_refs") value.handoff.run_id = "R";
    if (change === "bad_state") value.handoff.state = "running";
    if (change === "bad_revision") value.handoff.revision = 0;
    if (change === "bad_time") value.handoff.updated_at = "yesterday";
    expect(validExecutionHandoff("P", "E", "T", value)).toBe(false);
  });
  it("requires actual run and runtime task identities for a planned handoff", () => {
    expect(validExecutionHandoff("P", "E", "T", detail("planned"))).toBe(true);
    const invalid = detail("planned"); invalid.handoff.runtime_task_id = null;
    expect(validExecutionHandoff("P", "E", "T", invalid)).toBe(false);
  });
  it("rejects a response after the login scope changes", async () => {
    let finish!: (value: unknown) => void; vi.mocked(request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = readExecutionHandoff("P", "E", "T", h.scope); h.scope = "scope-b"; finish(detail());
    await expect(pending).rejects.toThrow("handoffScopeChanged");
  });
  it.each(["accepted", "dispatching", "retry_wait"] as const)("observes pending %s without a write or navigation lock", (state) => {
    h.handoff.data = detail(state); const tree = status();
    expect(JSON.stringify(tree)).toContain(executionHandoffCopy(h.language).states[state]);
    expect(h.queries[0].queryKey.slice(0, 5)).toEqual(["delivery-execution-handoff", "P", "E", "T", "s"]);
    expect(JSON.stringify(h.queries[0].queryKey)).not.toContain(h.scope);
    expect(h.queries[0].refetchInterval({ state: { data: detail(state), error: null } })).toBe(4000);
    expect(h.send).not.toHaveBeenCalled(); expect(h.invalidation).not.toHaveBeenCalled();
    expect(nodes(tree).filter((node) => node.type === Button)).toHaveLength(1);
  });
  it.each(["blocked", "planned", "cancelled"] as const)("stops automatic pending polling for %s", (state) => {
    h.handoff.data = detail(state); status();
    expect(h.queries[0].refetchInterval({ state: { data: detail(state), error: null } })).toBe(false);
  });
  it.each(["zh-CN", "en-US", "ja-JP"])("renders the same real handoff and neutral controls action in %s", (language) => {
    h.language = language; h.handoff.data = detail("planned"); const tree = status(), copy = executionHandoffCopy(language);
    expect(JSON.stringify(tree)).toContain(copy.states.planned); expect(JSON.stringify(tree)).toContain(copy.plannedHint);
    expect(nodes(tree).find((node) => node.type === Button)!.props.children).toBe(copy.controls);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("caps automatic checks and allows a deliberate pure-read refresh", async () => {
    status(); const options = h.queries[0];
    for (let i = 0; i < 60; i++) await options.queryFn({ signal: undefined });
    const tree = status(); expect(JSON.stringify(tree)).toContain(executionHandoffCopy(h.language).paused);
    expect(h.queries.at(-1).refetchInterval({ state: { data: detail(), error: null } })).toBe(false);
    nodes(tree).find((node) => node.type === Button)!.props.onClick(); expect(h.refresh).toHaveBeenCalledOnce(); expect(h.send).not.toHaveBeenCalled();
  });
  it("invalidates actual business reads only once for each planned H revision without inventing an ACK", () => {
    h.handoff.data = detail("planned", 2); status(); status(); expect(h.invalidation).toHaveBeenCalledOnce();
    h.handoff.data = detail("planned", 3); status(); expect(h.invalidation).toHaveBeenCalledTimes(2); expect(h.saved).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it.each(["HTTP 403: denied", "Failed to fetch"])("hides cached handoff facts and offers only a read retry after %s", (message) => {
    h.handoff = { ...h.handoff, data: detail("planned"), error: new Error(message) }; const tree = status();
    expect(nodes(tree).some((node) => node.type === Alert)).toBe(true);
    expect(JSON.stringify(tree)).not.toContain(executionHandoffCopy(h.language).states.planned);
    nodes(tree).find((node) => node.type === Button)!.props.onClick(); expect(h.refresh).toHaveBeenCalledOnce(); expect(h.send).not.toHaveBeenCalled();
  });
  it("moves focus to a real scoped controls target instead of changing the application hash", () => {
    h.handoff.data = detail("planned"); const focus = vi.fn(), scrollIntoView = vi.fn();
    const original = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: vi.fn(() => ({ focus, scrollIntoView })) } });
    try { nodes(status()).find((node) => node.type === Button)!.props.onClick(); expect(document.getElementById).toHaveBeenCalledWith(handoffControlsId("P", "E", "s")); expect(focus).toHaveBeenCalledOnce(); }
    finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
    expect(nodes(card()).some((node) => node.props.id === handoffControlsId("P", "E", "s"))).toBe(true);
  });
  it("uses live handoff qualification to invalidate captured fresh control callbacks", () => {
    const control = nodes(card()).find((node) => node.type === ExecutionRuntimePanel)!;
    expect(control.props.canSubmit()).toBe(true);
    h.handoff = { ...h.handoff, error: new Error("Failed to fetch") }; card();
    expect(control.props.canSubmit()).toBe(false);
    const sync = nodes(card()).find((node) => node.type === ExecutionSyncControl)!; expect(sync.props.canSubmit()).toBe(false);
  });
  it("keeps unknown original sync replay possible while the same live qualification blocks a new sync", async () => {
    const original = { action: "execution.sync" as const, payload: { id: "E" }, intent: { version: 7, key: "sync-original-key" } };
    const renderSync = () => run("sync", () => ExecutionSyncControl({ projectId: "P", executionId: "E", sessionId: "s", workspaceVersion: 7, canSync: true, canSubmit: () => false, onSaved: h.saved }));
    await nodes(renderSync()).find((node) => node.props["data-action"] === "sync-execution")!.props.onClick();
    expect(h.send).not.toHaveBeenCalled();
    h.send.mockRejectedValueOnce(new Error("Failed to fetch")); await h.sync.run(original);
    const tree = renderSync(); expect(h.send).toHaveBeenCalledOnce();
    await nodes(tree).find((node) => node.props["data-action"] === "retry-sync-original")!.props.onClick();
    expect(h.send).toHaveBeenCalledTimes(2); expect(h.send.mock.calls[1][0]).toEqual(original); expect(h.saved).toHaveBeenCalledWith(ack);
  });
  it("does not request handoff or freeze controls for real historical executions without a handoff ID", () => {
    const historical = { ...entry }; delete historical.handoff_id; card(historical);
    expect(h.queries.filter((query) => query.queryKey[0] === "delivery-execution-handoff").every((query) => query.enabled === false)).toBe(true);
    expect(nodes(card(historical as DeliveryExecution)).find((node) => node.type === ExecutionRuntimePanel)!.props.canSubmit()).toBe(true);
  });
  it("does not reveal a cached execution body when its handoff permission read is denied", () => {
    h.handoff = { ...h.handoff, error: new Error("HTTP 403: handoff denied") }; const tree = card();
    expect(JSON.stringify(tree)).not.toContain("Private task title"); expect(nodes(tree).some((node) => node.type === ExecutionRuntimePanel)).toBe(false);
  });
  it.each(["handoff_error", "current_execution_error"])("rejects an old redispatch button after current readability changes: %s", (change) => {
    const data = { project: { id: "P" }, version: 7, permissions: { write: true }, members: [] } as unknown as DeliveryTaskData;
    const task = { id: "T", execution_id: "E", status: "completed", req_id: "", acceptance: { available: true }, execution_gate: { eligible: true, reasons: [] } } as DeliveryTaskData["task"];
    h.exact.data.execution = { ...entry, status: "accepted" };
    h.handoff.data = detail("planned");
    const command = { current: () => true, locked: false, snapshot: () => ({ phase: "idle" }) } as any;
    const render = () => run("panel", () => DeliveryExecutionPanel({ data, task, sessionId: "s", queueCommand: command, onSaved: h.saved, onCommand: h.send }));
    const captured = nodes(render()).find((node) => node.type === Button && node.props.children === "deliveryRuntime.redispatch")!;
    expect(captured.props.disabled).toBe(false);
    if (change === "handoff_error") h.handoff = { ...h.handoff, error: new Error("HTTP 403: denied") };
    else h.exact = { ...h.exact, error: new Error("HTTP 403: exact execution denied"), isError: true };
    render();
    captured.props.onClick(); expect(nodes(render()).some((node) => node.type === ExecutionPlanEditor)).toBe(false); expect(h.send).not.toHaveBeenCalled();
    expect(nodes(render()).find((node) => node.type === Button && node.props.children === "deliveryRuntime.redispatch")!.props.disabled).toBe(true);
  });
});
