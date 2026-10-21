/** Actual review and recovery consumer definitions. Runtime validation is deferred. */
import { createElement, isValidElement, type ReactNode } from "react";
import { Alert, Button, Drawer, Input } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionReviewControl, type ExecutionReviewControlProps } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionReviewControl";
import { ExecutionOperationRecovery, executionOperationPending } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionOperationRecovery";
import { ExecutionRouteRecoveryGate } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRouteRecoveryGate";
import { DeliveryExecutionInspector } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionInspector";
import { ExecutionObservationCard } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionObservationCard";
import { ExecutionRuntimeControl } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRuntimeControl";
import { ExecutionRuntimePanel } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRuntimePanel";
import { ExecutionSyncControl } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionSyncControl";
import { createExecutionReviewController, executionReviewRecoveryPending, executionReviewStorageKey, validExecutionReviewAck, type ExecutionReviewOriginal } from "./executionReviewCommand";
import { executionControlStorageKey } from "./executionControlCommand";
import { executionDispatchStorageKey } from "./executionDispatchCommand";
import { request } from "./http";
import { setSession, USER_KEY } from "./authStorage";
import type { DeliveryContext, DeliveryExecution } from "./delivery";
import { executionReviewCopy } from "@/i18n/execution-review";
import { qualityFixture } from "./executionQualityFixtures";

const h = vi.hoisted(() => ({ frames: {} as Record<string, any[]>, frame: "", next: 0,
  effects: {} as Record<string, Array<() => void | (() => void)>>, local: new Map<string, string>(), stored: new Map<string, string>(),
  sent: [] as any[], mode: "unknown" as "unknown" | "success" | "pending" | "refused" | "badAck", language: "en", storageFail: "none" as "none" | "all" | "cleanup",
  resolve: null as ((value: unknown) => void) | null, detailError: null as Error | null,
}));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (change: any) => { slots[index] = typeof change === "function" ? change(slots[index]) : change; }]; },
  useRef: (initial: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++;
    if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
  useMemo: (factory: () => unknown, deps: unknown[]) => { const slots = h.frames[h.frame] ||= [], index = h.next++;
    if (!(index in slots) || deps.some((part, i) => !Object.is(part, slots[index].deps[i]))) slots[index] = { deps, value: factory() }; return slots[index].value; },
  useEffect: (run: () => void | (() => void)) => { (h.effects[h.frame] ||= []).push(run); }, useCallback: (fn: unknown) => fn,
  useId: () => `review-field-${h.frame}`, useSyncExternalStore: (_listen: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: h.language } }) }));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("@tanstack/react-query", async () => ({ ...(await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query")),
  useQuery: (options: any) => ({ data: options.queryKey[0] === "delivery-control-operations" ? { project_id: "P", execution_id: "E", task_id: "T", items: [] } : undefined,
    error: h.detailError, isPending: !h.detailError, isFetching: false, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }),
}));
const saved = vi.fn(), observed = vi.fn(async () => {}), unresolved = vi.fn(), legacy = vi.fn(async () => {});
const original: ExecutionReviewOriginal = { action: "execution.review", payload: { id: "E", run_version: 9, decision: "accept", comment: "Checked actual tests and code evidence" },
  runId: "R", taskId: "T", workspaceId: "W", intent: { version: 7, key: "fixed-review-key" } };
const entry = { id: "E", task_id: "T", workspace_id: "W", run_id: "R", run_version: 9, attempt: 1, status: "awaiting_review", stale: false,
  progress: 100, created_at: "2026-10-21T01:00:00Z", snapshot: { task_acceptance_criteria: [] }, test_node_ids: [], results: {} } as unknown as DeliveryExecution;
const observation = { project_id: "P", execution_id: "E", run_id: "R", run_version: 9, attempt: 1, status: "awaiting_review", stale: false, observed_at: "2026-10-21T01:00:00Z",
  review_verified: false, quality: qualityFixture({ execution_id: "E", run_id: "R", run_version: 9, attempt: 1 }, "passed"),
  events: [], next_cursor: null, more: false, nodes: [], tests: { total: 1, passed: 1, failed: 0, pending: 0, status: "passed" },
  permissions: { can_start: false, can_cancel: false, can_review: true, can_accept: true, can_sync: true }, log_streaming: false };
function ack(body: any) { return { project_id: "P", action: body.action, resource: { kind: "execution", id: body.payload.id }, result: null,
  applied_version: body.expected_version + 1, version: body.expected_version + 1, query_generation: 2, replayed: false,
  affected_refs: [{ kind: "execution", id: body.payload.id }] }; }
function frame<T>(name: string, render: () => T): T { h.frame = name; h.next = 0; h.effects[name] = []; return render(); }
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.action), ...nodes(node.props.items?.map((item: any) => item.children))]; }
function find(tree: ReactNode, type: unknown, predicate: (props: any) => boolean = () => true) { return nodes(tree).find((node) => node.type === type && predicate(node.props))?.props; }
function action(tree: ReactNode, name: string) { return find(tree, Button, (props) => props["data-action"] === name); }
function review(patch: Partial<ExecutionReviewControlProps> = {}) { return frame("review", () => ExecutionReviewControl({ projectId: "P", executionId: "E", sessionId: "session",
  taskId: "T", workspaceId: "W", runId: "R", runVersion: 9, workspaceVersion: 7, canReview: true, canAccept: true,
  onSaved: saved, onObserved: observed, onUnresolvedChange: unresolved, ...patch })); }
function fill(tree = review()) { find(tree, Input.TextArea).onChange({ target: { value: original.payload.comment } }); return review(); }
function seedReview() { h.stored.set(executionReviewStorageKey("P", "E")!, JSON.stringify({ phase: "unknown", original })); }
function inspector() { return frame("inspector", () => DeliveryExecutionInspector({ executionId: "E", sessionId: "session", workspace: { project: { id: "P" }, version: 999 } as DeliveryContext,
  onClose: vi.fn(), onSaved: saved, onCommand: legacy, onUnresolvedChange: unresolved })); }
function recovery(props?: any) { return frame("recovery", () => ExecutionOperationRecovery(props || { projectId: "P", executionId: "E", sessionId: "session", onSaved: saved, onUnresolvedChange: unresolved })); }
function recreate() { h.frames = {}; h.effects = {}; }
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

beforeEach(() => {
  h.frames = {}; h.effects = {}; h.local.clear(); h.stored.clear(); h.sent = []; h.mode = "unknown"; h.storageFail = "none"; h.resolve = null; h.detailError = null; h.language = "en";
  saved.mockReset(); observed.mockReset().mockResolvedValue(undefined); unresolved.mockReset(); legacy.mockReset();
  vi.stubGlobal("localStorage", { getItem: (key: string) => h.local.get(key) || null, setItem: (key: string, value: string) => h.local.set(key, value), removeItem: (key: string) => h.local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => h.stored.get(key) || null, setItem: (key: string, value: string) => {
    if (h.storageFail === "all" || h.storageFail === "cleanup" && !value) throw new Error("Storage unavailable"); h.stored.set(key, value); } });
  const location = { hash: "#/dev-flow?project_id=P&execution_id=E", href: "http://localhost/#/dev-flow?project_id=P&execution_id=E" };
  vi.stubGlobal("location", location); vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  setSession("private-review-token", "P", "tenant"); h.local.set(USER_KEY, JSON.stringify({ id: "actor", tenant_id: "tenant" }));
  vi.mocked(request).mockReset().mockImplementation(async (path, init) => {
    if (init?.method !== "POST") return observation;
    const body = JSON.parse(String(init.body)); h.sent.push(body);
    if (h.mode === "unknown") throw new TypeError("Reply lost after possible committed review");
    if (h.mode === "refused") throw new Error("HTTP 403: review currently forbidden");
    if (h.mode === "pending") return new Promise((resolve) => { h.resolve = resolve; });
    return h.mode === "badAck" ? { ...ack(body), result: { not_a_review_receipt: true } } : ack(body);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("strict original native review contract", () => {
  it("requires the exact nine-field null-result receipt and single E reference", () => {
    const body = { action: original.action, payload: original.payload, expected_version: 7 };
    const valid = ack(body); expect(validExecutionReviewAck("P", "E", original, valid)).toBe(true);
    for (const changed of [{ ...valid, project_id: "other" }, { ...valid, action: "execution.sync" }, { ...valid, applied_version: 9 },
      { ...valid, resource: { kind: "execution", id: "other" } }, { ...valid, result: {} },
      { ...valid, affected_refs: [...valid.affected_refs, { kind: "task", id: "T" }] }, { ...valid, extra: true }])
      expect(validExecutionReviewAck("P", "E", original, changed)).toBe(false);
  });
  it("freezes all original metadata and rejects malformed originals before transport", async () => {
    let raw: string | null = null; const sent = vi.fn(async () => { throw new TypeError("lost"); });
    const command = createExecutionReviewController({ projectId: "P", executionId: "E", scope: "scope", currentScope: () => "scope",
      load: () => raw, save: (value) => { raw = value; }, send: sent });
    const input = structuredClone(original); await command.run(input); input.payload.comment = "Changed after send";
    expect(command.snapshot().original).toEqual(original); expect(JSON.parse(raw!).original).toEqual(original);
    expect(Object.isFrozen(command.snapshot().original!.payload)).toBe(true);
    const invalid = createExecutionReviewController({ projectId: "P", executionId: "E", scope: "scope", currentScope: () => "scope", load: () => null, save: vi.fn(), send: sent });
    await invalid.run({ ...original, payload: { ...original.payload, comment: "x".repeat(4001) } });
    expect(sent).toHaveBeenCalledTimes(1);
  });
  it("preserves Unicode task identities with internal spaces and at most 64 code points", () => {
    const receipt = ack({ action: original.action, payload: original.payload, expected_version: 7 });
    for (const taskId of ["产品 功能", "𠮷".repeat(64)])
      expect(validExecutionReviewAck("P", "E", { ...original, taskId }, receipt)).toBe(true);
    for (const taskId of [" 产品", "产品 ", " ", "产品\u0085功能", "𠮷".repeat(65)])
      expect(validExecutionReviewAck("P", "E", { ...original, taskId }, receipt)).toBe(false);
  });
});

describe("actual native review consumers", () => {
  it("sends once for double clicks and prevents old and newly-rendered callbacks from resending confirmed basis", async () => {
    const start = action(fill(), "accept-execution-review"); h.mode = "pending";
    const sending = start.onClick(); start.onClick(); await settle(); expect(h.sent).toHaveLength(1);
    h.resolve!(ack(h.sent[0])); await sending; await start.onClick();
    const fresh = fill(); await action(fresh, "accept-execution-review").onClick();
    expect(h.sent).toHaveLength(1); expect(saved).toHaveBeenCalledTimes(1); expect(observed).toHaveBeenCalledTimes(1);
  });
  it("retains reject decisions and replays exact original version, key and comment without fresh permissions", async () => {
    await action(fill(), "reject-execution-review").onClick(); const first = structuredClone(h.sent[0]);
    expect(first.payload.decision).toBe("request_changes"); recreate(); h.mode = "success";
    const restored = review({ canReview: false, disabled: true, runVersion: 999, workspaceVersion: undefined });
    await action(restored, "recover-execution-review").onClick();
    expect(h.sent).toEqual([first, first]); expect(saved).toHaveBeenCalledTimes(1); expect(executionReviewRecoveryPending("P", "E")).toBe(false);
  });
  it("does not send when durable original storage fails before transport", async () => {
    const start = action(fill(), "accept-execution-review"); h.storageFail = "all"; await start.onClick();
    expect(h.sent).toHaveLength(0); expect(saved).not.toHaveBeenCalled(); expect(action(review(), "recover-execution-review")).toBeUndefined();
  });
  it("retains unknown after a later permission refusal and never accepts a runtime GET as its ACK", async () => {
    await action(fill(), "accept-execution-review").onClick(); h.mode = "refused";
    await action(review(), "recover-execution-review").onClick(); expect(h.sent[1]).toEqual(h.sent[0]);
    expect(saved).not.toHaveBeenCalled(); expect(action(review(), "recover-execution-review")).toBeDefined();
  });
  it("keeps malformed successful responses unknown", async () => {
    h.mode = "badAck"; await action(fill(), "accept-execution-review").onClick();
    expect(saved).not.toHaveBeenCalled(); expect(action(review(), "recover-execution-review")).toBeDefined();
  });
  it("performs local confirmed cleanup after storage recovery without a second POST", async () => {
    h.mode = "success"; h.storageFail = "cleanup"; await action(fill(), "accept-execution-review").onClick();
    expect(action(review(), "recover-execution-review")).toBeUndefined(); expect(action(review(), "finish-execution-review")).toBeDefined();
    expect(unresolved.mock.calls.at(-1)).toEqual([true]); h.storageFail = "none";
    await action(review(), "finish-execution-review").onClick(); expect(h.sent).toHaveLength(1); expect(saved).toHaveBeenCalledTimes(1);
  });
  it("does not turn a confirmed review into a retry after parent or observation refresh failure", async () => {
    h.mode = "success"; saved.mockImplementationOnce(() => { throw new Error("Parent refresh failed"); }); observed.mockRejectedValueOnce(new Error("Read unavailable"));
    await action(fill(), "accept-execution-review").onClick(); expect(h.sent).toHaveLength(1);
    expect(action(review(), "recover-execution-review")).toBeUndefined(); expect(find(review(), Alert, (props) => props.description === executionReviewCopy("en").refreshFailed)).toBeDefined();
  });
  it("rejects stale handlers after account/session/execution selection changes", async () => {
    const start = action(fill(), "accept-execution-review"); setSession("private-review-token", "P", "tenant"); await start.onClick(); expect(h.sent).toHaveLength(0);
    recreate(); const next = action(fill(), "accept-execution-review"); review({ executionId: "other", sessionId: "other-session" }); await next.onClick(); expect(h.sent).toHaveLength(0);
  });
  it("restores the actual Inspector review host when the very first detail GET is forbidden", async () => {
    seedReview(); h.detailError = new Error("HTTP 403: detail forbidden"); const host = inspector();
    expect(find(host, Drawer).closable).toBe(false); expect(find(host, ExecutionObservationCard)).toBeUndefined();
    const gateway = recovery(find(host, ExecutionOperationRecovery)); const props = find(gateway, ExecutionReviewControl);
    expect(props).toBeDefined(); h.mode = "success";
    await action(frame("review", () => ExecutionReviewControl(props)), "recover-execution-review").onClick();
    expect(h.sent[0]).toMatchObject({ payload: original.payload, expected_version: 7, idempotency_key: original.intent.key });
    expect(saved).toHaveBeenCalledTimes(1);
  });
  it("selects review recovery at startup before context queries", () => {
    seedReview(); const startup = frame("startup", () => ExecutionRouteRecoveryGate({ children: createElement("div", { id: "fresh-content" }) }));
    expect(find(startup, ExecutionOperationRecovery)?.executionId).toBe("E"); expect(find(startup, "div")).toBeUndefined();
  });
  it("processes multiple retained originals through one host without dropping review", () => {
    seedReview(); const runtimeKey = executionControlStorageKey("P", "E")!, syncKey = executionDispatchStorageKey("P", "execution.sync", "E")!;
    h.stored.set(runtimeKey, JSON.stringify({ phase: "unknown", original: { action: "execution.cancel", payload: { id: "E", run_id: "R", run_version: 9, attempt: 1,
      control_basis: "a".repeat(64), reason: "Stop original attempt" }, intent: { version: 7, key: "runtime-original-key" }, workspaceId: "W" } }));
    h.stored.set(syncKey, JSON.stringify({ phase: "unknown", original: { action: "execution.sync", payload: { id: "E" }, intent: { version: 7, key: "sync-original-key" } } }));
    const runtime = find(recovery(), ExecutionRuntimeControl); expect(runtime).toBeDefined(); h.stored.set(runtimeKey, ""); runtime.onUnresolvedChange(false);
    const sync = find(recovery(), ExecutionSyncControl); expect(sync).toBeDefined(); expect(runtime.isActive()).toBe(false);
    h.stored.set(syncKey, ""); sync.onUnresolvedChange(false); expect(find(recovery(), ExecutionReviewControl)).toBeDefined();
    expect(executionOperationPending("P", "E")).toBe(true); expect(unresolved.mock.calls.every(([pending]) => pending)).toBe(true);
  });
  it("actual ObservationCard routes review through its durable child and immediately blocks sync/runtime siblings", async () => {
    const card = () => frame("card", () => ExecutionObservationCard({ entry, projectId: "P", sessionId: "session", workspaceVersion: 7, active: true,
      onSaved: saved, onCommand: legacy, onUnresolvedChange: unresolved }));
    card(); h.effects.card[0](); await settle(); const tree = card(), props = find(tree, ExecutionReviewControl);
    frame("review", () => ExecutionReviewControl(props)); const form = frame("review", () => ExecutionReviewControl(props));
    find(form, Input.TextArea).onChange({ target: { value: original.payload.comment } });
    await action(frame("review", () => ExecutionReviewControl(props)), "accept-execution-review").onClick();
    expect(legacy).not.toHaveBeenCalled(); expect(h.sent).toHaveLength(1);
    expect(find(tree, ExecutionSyncControl).isActive()).toBe(false); expect(find(tree, ExecutionRuntimePanel).isActive()).toBe(false);
  });
  it.each(["en", "zh-CN", "ja-JP"])("labels the retained decision and recovery action in %s", (language) => {
    h.language = language; seedReview(); const tree = review({ canReview: false }), copy = executionReviewCopy(language);
    expect(find(tree, "section")["aria-label"]).toBe(copy.title); expect(action(tree, "recover-execution-review").children).toBe(copy.retry);
  });
});
