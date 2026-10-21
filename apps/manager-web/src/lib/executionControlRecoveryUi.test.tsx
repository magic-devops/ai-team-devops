/** Real consumer and controller definitions. Runtime verification is deferred. */
import { isValidElement, type ReactNode } from "react";
import { Alert, Button, Drawer, Input, Modal } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionRuntimeControl, type ExecutionRuntimeControlProps } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRuntimeControl";
import { ExecutionRuntimePanel } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRuntimePanel";
import { DeliveryExecutionInspector } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionInspector";
import { ExecutionObservationCard } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionObservationCard";
import { ExecutionSyncControl } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionSyncControl";
import { ExecutionOperationRecovery } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionOperationRecovery";
import { executionControlRecoveryPending, executionControlStorageKey } from "./executionControlCommand";
import { setSession, USER_KEY } from "./authStorage";
import { request } from "./http";
import type { ExecutionRuntime } from "./executionRuntime";
import type { DeliveryContext, DeliveryExecution } from "./delivery";
import type { ExecutionObservations } from "./deliveryExecution";
import type { ExecutionControlOperationsRead } from "./executionControlOperations";

const h = vi.hoisted(() => ({
  frames: {} as Record<string, any[]>, frame: "", next: 0,
  effects: {} as Record<string, Array<() => void | (() => void)>>,
  stored: new Map<string, string>(), local: new Map<string, string>(),
  sent: [] as any[], events: [] as string[], version: 7, basis: "a".repeat(64),
  mode: "unknown" as "unknown" | "success" | "pending" | "refused" | "badAck",
  readError: "", storageFail: "none" as "none" | "all" | "confirmed",
  resolve: null as ((value: unknown) => void) | null,
  detailReady: false,
  refusedMessage: "HTTP 409: fixed preview changed",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: any) => {
    const slots = h.frames[h.frame] ||= [], index = h.next++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (change: any) => { slots[index] = typeof change === "function" ? change(slots[index]) : change; }];
  },
  useRef: (initial: any) => {
    const slots = h.frames[h.frame] ||= [], index = h.next++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useMemo: (factory: () => unknown, deps: unknown[]) => {
    const slots = h.frames[h.frame] ||= [], index = h.next++;
    if (!(index in slots) || deps.some((dependency, i) => !Object.is(dependency, slots[index].deps[i]))) slots[index] = { deps, value: factory() };
    return slots[index].value;
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => { (h.effects[h.frame] ||= []).push(effect); },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query")),
  useQuery: (options: any) => options.queryKey[0] === "delivery-control-operations" ? { data: { project_id: "P", execution_id: "E", task_id: "T", version: h.version,
    items: [], total: 0, limit: 20, next_cursor: null, as_of: "2026-10-21T00:00:00Z" }, isPending: false, error: null, refetch: vi.fn() } :
    ({ data: h.detailReady ? { execution: execution } : undefined, isPending: !h.detailReady, error: null, refetch: vi.fn() }),
}));

const runtime: ExecutionRuntime = {
  project_id: "P", execution_id: "E", run_id: "R", run_version: 9, attempt: 2,
  status: "running", runtime_status: "running", stale: false, active_node_id: "node", observed_at: "2026-10-20T12:00:00Z",
  recovery_requires_review: false, stop: null, approval: null, nodes: [],
  controls: { start: { allowed: true, reasons: [] }, retry: { allowed: true, reasons: [] }, cancel: { allowed: true, reasons: [] }, approval: { allowed: false, reasons: [] }, approval_reject: { allowed: false, reasons: [] } },
};
const execution: DeliveryExecution = { id: "E", workspace_id: "W", task_id: "T", agent_id: "A", run_id: "R", run_version: 9,
  attempt: 2, status: "running", progress: 0, stale: false, created_at: "2026-10-20T12:00:00Z", test_node_ids: [], results: {},
  snapshot: { task_acceptance_criteria: [] }, executor_snapshot: null };
const workspace = { project: { id: "P" }, version: 7 } as unknown as DeliveryContext;
const observation: ExecutionObservations = { project_id: "P", execution_id: "E", run_id: "R", run_version: 9, attempt: 2,
  status: "awaiting_review", stale: false, observed_at: "2026-10-20T12:00:00Z", executor_snapshot: null, executor_binding_invalidated: false,
  events: [], next_cursor: null, more: false, nodes: [], tests: { total: 0, passed: 0, failed: 0, pending: 0, status: "not_configured" },
  permissions: { can_start: false, can_cancel: true, can_review: true, can_sync: true }, log_streaming: false };
function ack(body: any) {
  return { project_id: "P", action: body.action, resource: { kind: "execution", id: "E" }, applied_version: body.expected_version + 1, version: body.expected_version + 1,
    query_generation: 2, replayed: false, affected_refs: [{ kind: "execution", id: "E" }],
    result: body.action === "execution.sync" ? null : { control_operation_id: "C", request_digest: "b".repeat(64) } };
}
function frame<T>(name: string, callback: () => T): T { h.frame = name; h.next = 0; h.effects[name] = []; return callback(); }
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<any>(node)) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.footer), ...nodes(node.props.action)];
}
function find(tree: ReactNode, type: unknown, predicate: (props: any) => boolean = () => true): any {
  return nodes(tree).find((node) => node.type === type && predicate(node.props))?.props;
}
function button(tree: ReactNode, key: string): any { return find(tree, Button, (props) => props.children === `deliveryExecutionRuntime.${key}`); }
function action(tree: ReactNode, name: string): any { return find(tree, Button, (props) => props["data-action"] === name); }
function reason(tree: ReactNode): any { return find(tree, Input.TextArea, (props) => props["aria-label"] === "deliveryExecutionRuntime.reason"); }
const saved = vi.fn(), observed = vi.fn(), unresolved = vi.fn();
function control(patch: Partial<ExecutionRuntimeControlProps> = {}) {
  return frame("control", () => ExecutionRuntimeControl({ projectId: "P", executionId: "E", sessionId: "selected-session", workspaceId: "W", runtime,
    controlRead: { isReadable: () => true, hasPending: () => false, accept: vi.fn(), readable: true, items: [], operation: null } as unknown as ExecutionControlOperationsRead,
    onSaved: saved, onObserved: observed, onUnresolvedChange: unresolved, ...patch }));
}
function inspector(executionId = "E") {
  return frame("inspector", () => DeliveryExecutionInspector({ executionId, sessionId: "selected-session", workspace,
    onClose: vi.fn(), onCommand: vi.fn(async () => {}), onSaved: saved, onUnresolvedChange: unresolved }));
}
async function ready() {
  button(control(), "cancelRun").onClick();
  reason(control()).onChange({ target: { value: "Stop original attempt" } });
  await button(control(), "preview").onClick(); return control();
}
async function cardControlChain(onCommand: Parameters<typeof ExecutionObservationCard>[0]["onCommand"]) {
  const renderCard = () => frame("card", () => ExecutionObservationCard({ entry: execution, projectId: "P", active: true,
    sessionId: "selected-session", workspaceVersion: 7, isActive: () => true, onCommand, onSaved: saved, onUnresolvedChange: unresolved }));
  renderCard(); h.effects.card[0](); await settle();
  find(renderCard(), Input.TextArea, (props) => props.id === "runtime-review-E").onChange({ target: { value: "Review the fixed execution" } });
  const card = renderCard(), panel = nodes(card).find((node) => node.type === ExecutionRuntimePanel)!;
  const renderPanel = () => frame("chain-panel", () => ExecutionRuntimePanel(panel.props));
  renderPanel(); h.effects["chain-panel"][0](); await settle();
  const retained = nodes(renderPanel()).find((node) => node.type === ExecutionRuntimeControl)!;
  const renderControl = () => frame("control", () => ExecutionRuntimeControl(retained.props));
  button(renderControl(), "cancelRun").onClick(); reason(renderControl()).onChange({ target: { value: "Stop original attempt" } });
  await button(renderControl(), "preview").onClick();
  const sync = nodes(card).find((node) => node.type === ExecutionSyncControl)!;
  const renderSync = (patch: Partial<Parameters<typeof ExecutionSyncControl>[0]> = {}) => frame("sync", () => ExecutionSyncControl({ ...sync.props, ...patch }));
  return { card, renderControl, renderSync };
}
function recreate() { h.frames = {}; h.effects = {}; }
async function settle() { for (let index = 0; index < 24; index++) await Promise.resolve(); }

beforeEach(() => {
  h.frames = {}; h.effects = {}; h.frame = ""; h.next = 0; h.stored.clear(); h.local.clear();
  h.sent = []; h.events = []; h.version = 7; h.basis = "a".repeat(64); h.mode = "unknown"; h.readError = ""; h.storageFail = "none"; h.resolve = null;
  h.detailReady = false; h.refusedMessage = "HTTP 409: fixed preview changed";
  saved.mockReset(); observed.mockReset(); unresolved.mockReset();
  vi.stubGlobal("localStorage", { getItem: (key: string) => h.local.get(key) || null, setItem: (key: string, value: string) => h.local.set(key, value), removeItem: (key: string) => h.local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => h.stored.get(key) || null, setItem: (key: string, raw: string) => {
    if (h.storageFail === "all" || h.storageFail === "confirmed" && (!raw || JSON.parse(raw).phase === "succeeded")) throw new Error("Storage unavailable");
    h.events.push(raw ? `retain:${JSON.parse(raw).phase}` : "clear"); h.stored.set(key, raw);
  } });
  const location = { hash: "#/dev-flow?execution_id=E", href: "http://localhost/#/dev-flow?execution_id=E" };
  vi.stubGlobal("location", location); vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  setSession("private-token-a", "P", "tenant-a"); h.local.set(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-a" }));
  vi.mocked(request).mockReset().mockImplementation(async (path, init) => {
    if (path.endsWith("execution-control-preview")) {
      const body = JSON.parse(String(init?.body));
      return { project_id: "P", execution_id: "E", version: h.version, action: body.action, allowed: true, reasons: [],
        payload: { id: "E", run_id: "R", run_version: 9, attempt: 2, control_basis: h.basis, reason: body.reason,
          ...(body.approval_id ? { approval_id: body.approval_id, approval_version: 4, decision: body.decision } : {}) } };
    }
    if (path.endsWith("/runtime")) { if (h.readError) throw new Error(h.readError); return runtime; }
    if (path.includes("/observations?")) return observation;
    const body = JSON.parse(String(init?.body)); h.sent.push(body); h.events.push("send");
    if (h.mode === "unknown") throw new TypeError("Lost response after possible commit");
    if (h.mode === "refused") throw new Error(h.refusedMessage);
    if (h.mode === "pending") return new Promise((resolve) => { h.resolve = resolve; });
    const answer = ack(body); return h.mode === "badAck" ? { ...answer, resource: { kind: "execution", id: "foreign" } } : answer;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("actual execution runtime control recovery", () => {
  it("previews without writing and persists the fixed original before the first confirmed send", async () => {
    const tree = await ready(); expect(h.sent).toHaveLength(0); expect(saved).not.toHaveBeenCalled();
    await button(tree, "confirm").onClick();
    expect(h.events.slice(0, 2)).toEqual(["retain:sending", "send"]);
    expect(h.sent[0]).toMatchObject({ action: "execution.cancel", expected_version: 7,
      payload: { id: "E", run_id: "R", run_version: 9, attempt: 2, control_basis: "a".repeat(64), reason: "Stop original attempt" } });
  });

  it("does not dispatch when safe original storage is unavailable", async () => {
    const tree = await ready(); h.storageFail = "all";
    await button(tree, "confirm").onClick();
    expect(h.sent).toHaveLength(0); expect(saved).not.toHaveBeenCalled();
  });

  it("invalidates a successful preview if an old explicit preview callback rereads unsuccessfully", async () => {
    button(control(), "cancelRun").onClick(); reason(control()).onChange({ target: { value: "Stop original attempt" } });
    const preview = button(control(), "preview"); await preview.onClick();
    const confirm = button(control(), "confirm");
    vi.mocked(request).mockRejectedValueOnce(new Error("Preview read interrupted"));
    await preview.onClick(); await confirm.onClick();
    expect(h.sent).toHaveLength(0); expect(button(control(), "confirm")).toBeUndefined();
    expect(button(control(), "preview")).toBeDefined();
  });

  it("synchronously rejects double confirmation and old edit, preview, start and close callbacks while sending", async () => {
    const tree = await ready(), confirm = button(tree, "confirm"), oldEdit = button(tree, "editReason"), oldReason = reason(tree), oldStart = button(tree, "start");
    h.mode = "pending"; const pending = confirm.onClick(); confirm.onClick(); oldEdit.onClick(); oldStart.onClick();
    oldReason.onChange({ target: { value: "Must not replace sending original" } });
    find(tree, Modal).onCancel(); button(tree, "close").onClick();
    await settle(); expect(h.sent).toHaveLength(1); expect(saved).not.toHaveBeenCalled();
    expect(find(control(), Modal)).toMatchObject({ open: true, closable: false, keyboard: false, maskClosable: false });
    h.resolve!(ack(h.sent[0])); await pending; expect(saved).toHaveBeenCalledTimes(1);
  });

  it("keeps old controls inert after the unknown result has settled", async () => {
    const initial = control(), oldStart = button(initial, "start");
    button(initial, "cancelRun").onClick(); reason(control()).onChange({ target: { value: "Stop original attempt" } });
    const prePreview = control(), oldPreview = button(prePreview, "preview");
    await oldPreview.onClick(); const tree = control(); await button(tree, "confirm").onClick();
    const original = structuredClone(h.sent[0]);
    oldStart.onClick(); oldPreview.onClick(); button(tree, "editReason").onClick(); button(tree, "confirm").onClick();
    reason(tree).onChange({ target: { value: "Another command" } }); find(tree, Modal).onCancel(); button(tree, "close").onClick(); await settle();
    expect(h.sent).toEqual([original]); expect(vi.mocked(request).mock.calls.filter(([path]) => path.endsWith("execution-control-preview"))).toHaveLength(1);
    expect(reason(control()).value).toBe("Stop original attempt"); expect(action(control(), "retry-original")).toBeDefined();
  });

  it("restores unknown across recreation and replays identical canonical bytes with no fresh runtime", async () => {
    await button(await ready(), "confirm").onClick(); const original = structuredClone(h.sent[0]);
    recreate(); h.mode = "success";
    const tree = control({ runtime: undefined, workspaceId: undefined, disabled: true, readOnly: true });
    expect(reason(tree).value).toBe(original.payload.reason); expect(button(tree, "start")).toBeUndefined();
    await action(tree, "retry-original").onClick();
    expect(h.sent).toEqual([original, original]); expect(saved).toHaveBeenCalledTimes(1);
    expect(executionControlRecoveryPending("P", "E")).toBe(false);
    expect(JSON.stringify([...h.stored.values()])).not.toContain("private-token-a");
  });

  it("queries the current runtime without confirming or rewriting the original command", async () => {
    await button(await ready(), "confirm").onClick(); const original = structuredClone(h.sent[0]);
    await action(control(), "query-original").onClick();
    expect(h.sent).toEqual([original]); expect(observed).toHaveBeenCalledWith(runtime); expect(saved).not.toHaveBeenCalled();
    expect(action(control(), "retry-original")).toBeDefined();
  });

  it("does not unlock an unknown original when its replay receives a definite conflict", async () => {
    await button(await ready(), "confirm").onClick(); h.mode = "refused";
    await action(control(), "retry-original").onClick();
    expect(h.sent[1]).toEqual(h.sent[0]); expect(saved).not.toHaveBeenCalled();
    expect(action(control(), "retry-original")).toBeDefined(); expect(button(control(), "readLatest")).toBeUndefined();
    expect(find(control(), Modal).closable).toBe(false);
  });

  it("requires a separate read, adoption and confirmation after a first definite refusal", async () => {
    h.mode = "refused"; h.refusedMessage = 'HTTP 409: {"detail":{"code":"execution_control_stale","message":"Review the changed fixed run"}}';
    await button(await ready(), "confirm").onClick();
    expect(find(control(), Alert, (props) => props.title === "deliveryExecutionRuntime.operationRefused")).toBeDefined();
    h.version = 8; h.basis = "b".repeat(64); await button(control(), "readLatest").onClick();
    expect(h.sent).toHaveLength(1); button(control(), "adopt").onClick(); expect(h.sent).toHaveLength(1);
    h.mode = "success"; await button(control(), "confirm").onClick();
    expect(h.sent[1]).toMatchObject({ expected_version: 8, payload: { control_basis: "b".repeat(64), reason: "Stop original attempt" } });
    expect(h.sent[1].idempotency_key).not.toBe(h.sent[0].idempotency_key);
  });

  it("blocks old read-latest and adoption callbacks after the adopted request becomes unknown", async () => {
    h.mode = "refused"; await button(await ready(), "confirm").onClick();
    const read = button(control(), "readLatest"); h.version = 8; h.basis = "b".repeat(64); await read.onClick();
    const adopt = button(control(), "adopt"); adopt.onClick();
    h.mode = "unknown"; await button(control(), "confirm").onClick();
    const original = structuredClone(h.sent[1]);
    read.onClick(); adopt.onClick(); await settle();
    expect(h.sent).toHaveLength(2); expect(h.sent[1]).toEqual(original);
    expect(vi.mocked(request).mock.calls.filter(([path]) => path.endsWith("execution-control-preview"))).toHaveLength(2);
    expect(action(control(), "retry-original")).toBeDefined(); expect(saved).not.toHaveBeenCalled();
  });

  it("keeps mismatched run evidence unresolved without notifying success", async () => {
    h.mode = "badAck"; await button(await ready(), "confirm").onClick();
    expect(saved).not.toHaveBeenCalled(); expect(action(control(), "retry-original")).toBeDefined();
  });

  it("only clears local recovery after a confirmed receipt could not be persisted or cleaned", async () => {
    const tree = await ready(); h.mode = "success"; h.storageFail = "confirmed";
    await button(tree, "confirm").onClick();
    expect(h.sent).toHaveLength(1); expect(saved).not.toHaveBeenCalled();
    const confirmed = control(); expect(action(confirmed, "retry-original")).toBeUndefined(); expect(action(confirmed, "finish-confirmed")).toBeDefined();
    button(tree, "confirm").onClick(); button(tree, "editReason").onClick(); find(tree, Modal).onCancel(); await settle();
    expect(h.sent).toHaveLength(1); expect(saved).not.toHaveBeenCalled();
    h.storageFail = "none"; await action(confirmed, "finish-confirmed").onClick();
    expect(h.sent).toHaveLength(1); expect(saved).toHaveBeenCalledTimes(1); expect(find(control(), Modal).open).toBe(false);
  });

  it("does not reinterpret a successful receipt when its parent refresh callback throws", async () => {
    h.mode = "success"; saved.mockImplementationOnce(() => { throw new Error("Parent refresh failed"); });
    await button(await ready(), "confirm").onClick(); const tree = control();
    expect(h.sent).toHaveLength(1); expect(action(tree, "retry-original")).toBeUndefined();
    expect(executionControlRecoveryPending("P", "E")).toBe(false); expect(find(tree, Modal).open).toBe(false);
    expect(find(tree, Alert, (props) => props.description === "deliveryExecutionRuntime.refreshAfterSaveFailed")).toBeDefined();
  });

  it("blocks old confirmation after relogin with the same token", async () => {
    const tree = await ready(); setSession("private-token-a", "P", "tenant-a");
    await button(tree, "confirm").onClick(); expect(h.sent).toHaveLength(0); expect(saved).not.toHaveBeenCalled();
  });

  it("does not let a new login reuse the old original or an old recovery callback", async () => {
    await button(await ready(), "confirm").onClick();
    const retry = action(control(), "retry-original"), retained = [...h.stored.values()];
    setSession("private-token-a", "P", "tenant-a"); h.mode = "success";
    await retry.onClick();
    expect(h.sent).toHaveLength(1); expect(saved).not.toHaveBeenCalled();
    expect(executionControlRecoveryPending("P", "E")).toBe(false); expect([...h.stored.values()]).toEqual(retained);
  });

  it("blocks an old callback after the selected execution session changes within the same login", async () => {
    const tree = await ready(); control({ sessionId: "another-selected-session" });
    await button(tree, "confirm").onClick(); expect(h.sent).toHaveLength(0); expect(saved).not.toHaveBeenCalled();
  });

  it("rejects both old confirmation and recovery callbacks after the retained host becomes inactive", async () => {
    let active = true;
    const isActive = () => active, render = () => control({ isActive });
    button(render(), "cancelRun").onClick(); reason(render()).onChange({ target: { value: "Stop original attempt" } });
    await button(render(), "preview").onClick(); const confirm = button(render(), "confirm");
    active = false; await confirm.onClick(); expect(h.sent).toHaveLength(0);
    active = true; await confirm.onClick(); expect(h.sent).toHaveLength(1);
    const retry = action(render(), "retry-original"); active = false; h.mode = "success";
    await retry.onClick(); expect(h.sent).toHaveLength(1); expect(saved).not.toHaveBeenCalled();
    expect(executionControlRecoveryPending("P", "E")).toBe(true);
  });

  it("withholds replacement commands when the retained original is damaged", () => {
    h.stored.set(executionControlStorageKey("P", "E")!, "broken original");
    const tree = control();
    expect(find(tree, Alert, (props) => props.title === "deliveryExecutionRuntime.retainedOriginalInvalid")).toBeDefined();
    expect(action(tree, "retry-original")).toBeUndefined();
    expect(button(tree, "start").disabled).toBe(true); button(tree, "start").onClick();
    expect(h.sent).toHaveLength(0); expect(find(control(), Modal).open).toBe(false);
  });

  it("keeps recovery mounted after the actual panel initial runtime read returns 403", async () => {
    await button(await ready(), "confirm").onClick(); const original = structuredClone(h.sent[0]);
    recreate(); h.readError = "HTTP 403: runtime read denied";
    const panel = () => frame("panel", () => ExecutionRuntimePanel({ projectId: "P", executionId: "E", sessionId: "selected-session", workspaceId: "W",
      active: false, paused: true, disabled: false, onSaved: saved, onUnresolvedChange: unresolved }));
    panel(); const mountRead = h.effects.panel[0]; mountRead(); await settle();
    const tree = panel(), retained = nodes(tree).find((node) => node.type === ExecutionRuntimeControl)!;
    expect(retained, "fresh read failure must not unmount recovery").toBeDefined();
    expect(find(tree, Alert, (props) => props.title === "deliveryExecutionRuntime.runtimeReadFailed")).toBeDefined();
    expect(retained.props.runtime).toBeUndefined();
    const recovery = frame("control", () => ExecutionRuntimeControl(retained.props));
    expect(action(recovery, "retry-original")).toBeDefined(); expect(button(recovery, "start")).toBeUndefined();
    h.mode = "success"; await action(recovery, "retry-original").onClick();
    expect(h.sent).toEqual([original, original]); expect(saved).toHaveBeenCalledTimes(1);
  });

  it("keeps the same real inspector fallback host when an in-flight detail GET finishes during replay", async () => {
    await button(await ready(), "confirm").onClick(); recreate();
    const first = inspector(), retained = nodes(first).find((node) => node.type === ExecutionOperationRecovery)!;
    expect(retained).toBeDefined(); expect(nodes(first).filter((node) => node.type === ExecutionObservationCard)).toHaveLength(0);
    const gate = frame("operation-recovery", () => ExecutionOperationRecovery(retained.props));
    const runtimeControl = nodes(gate).find((node) => node.type === ExecutionRuntimeControl)!;
    const recovery = frame("control", () => ExecutionRuntimeControl(runtimeControl.props));
    h.mode = "pending"; const replay = action(recovery, "retry-original").onClick(); await settle();
    h.detailReady = true;
    const completedRead = inspector(), sameHost = nodes(completedRead).filter((node) => node.type === ExecutionOperationRecovery);
    expect(sameHost).toHaveLength(1); expect(sameHost[0].key).toBe(retained.key);
    expect(nodes(completedRead).filter((node) => node.type === ExecutionObservationCard)).toHaveLength(0);
    expect(find(completedRead, Drawer).closable).toBe(false);
    h.resolve!(ack(h.sent[1])); await replay;
    expect(h.sent[1]).toEqual(h.sent[0]); expect(saved).toHaveBeenCalledTimes(1);
    expect(nodes(inspector()).filter((node) => node.type === ExecutionOperationRecovery)).toHaveLength(0);
    expect(nodes(inspector()).filter((node) => node.type === ExecutionObservationCard)).toHaveLength(1);
  });

  it("invalidates the actual outgoing card-to-control active callback as soon as the inspector request closes", async () => {
    h.detailReady = true;
    const first = inspector(), card = nodes(first).find((node) => node.type === ExecutionObservationCard)!;
    const cardTree = frame("card", () => ExecutionObservationCard(card.props));
    const panel = nodes(cardTree).find((node) => node.type === ExecutionRuntimePanel)!;
    const renderPanel = () => frame("inspector-panel", () => ExecutionRuntimePanel(panel.props));
    renderPanel(); h.effects["inspector-panel"][0](); await settle();
    const retained = nodes(renderPanel()).find((node) => node.type === ExecutionRuntimeControl)!;
    const renderControl = () => frame("control", () => ExecutionRuntimeControl(retained.props));
    button(renderControl(), "cancelRun").onClick(); reason(renderControl()).onChange({ target: { value: "Stop original attempt" } });
    await button(renderControl(), "preview").onClick(); const confirm = button(renderControl(), "confirm");
    expect(card.props.isActive()).toBe(true); expect(retained.props.isActive()).toBe(true);
    const closing = inspector("");
    expect(find(closing, Drawer).open).toBe(false);
    expect(nodes(closing).filter((node) => node.type === ExecutionObservationCard)).toHaveLength(1);
    expect(card.props.isActive()).toBe(false); expect(panel.props.isActive()).toBe(false); expect(retained.props.isActive()).toBe(false);
    await confirm.onClick(); expect(h.sent).toHaveLength(0); expect(saved).not.toHaveBeenCalled();
  });

  it("blocks old card sync and review callbacks while control is sending, unknown or confirmed but awaiting local cleanup", async () => {
    const onCommand = vi.fn(async () => {}), chain = await cardControlChain(onCommand);
    const sync = action(chain.renderSync(), "sync-execution");
    const review = find(chain.card, Button, (props) => props.children === "deliveryRuntime.reject");
    expect(sync.disabled).toBe(false); expect(review.disabled).toBe(false);
    h.mode = "pending"; const sending = button(chain.renderControl(), "confirm").onClick();
    sync.onClick(); review.onClick(); await settle();
    expect(onCommand).not.toHaveBeenCalled(); expect(h.sent).toHaveLength(1);
    h.resolve!({ ...ack(h.sent[0]), resource: { kind: "execution", id: "unconfirmed-execution" } }); await sending;
    sync.onClick(); review.onClick(); await settle();
    expect(action(chain.renderControl(), "retry-original")).toBeDefined(); expect(onCommand).not.toHaveBeenCalled();
    h.mode = "success"; h.storageFail = "confirmed";
    await action(chain.renderControl(), "retry-original").onClick();
    sync.onClick(); review.onClick(); await settle();
    expect(action(chain.renderControl(), "finish-confirmed")).toBeDefined();
    expect(onCommand).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled(); expect(h.sent).toHaveLength(2);
    h.storageFail = "none"; await action(chain.renderControl(), "finish-confirmed").onClick();
    chain.renderSync({ workspaceVersion: 8 });
    await sync.onClick(); review.onClick(); await settle();
    expect(onCommand.mock.calls).toEqual([["execution.review", { id: "E", decision: "request_changes", comment: "Review the fixed execution", run_version: 9 }]]);
    expect(h.sent[2]).toMatchObject({ action: "execution.sync", payload: { id: "E" } });
    expect(saved).toHaveBeenCalledTimes(2); expect(h.sent).toHaveLength(3);
  });

  it("blocks an old control confirmation synchronously while a real card sync is in flight", async () => {
    const onCommand = vi.fn(async () => {});
    const chain = await cardControlChain(onCommand), confirm = button(chain.renderControl(), "confirm");
    const sync = action(chain.renderSync(), "sync-execution"); h.mode = "pending";
    const sending = sync.onClick(); await confirm.onClick();
    expect(onCommand).not.toHaveBeenCalled(); expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ action: "execution.sync", payload: { id: "E" } }); expect(saved).not.toHaveBeenCalled();
    h.resolve!(ack(h.sent[0])); await sending; h.mode = "unknown"; await confirm.onClick();
    expect(h.sent).toHaveLength(2); expect(h.sent[1].action).toBe("execution.cancel"); expect(action(chain.renderControl(), "retry-original")).toBeDefined();
  });
});
