/** Actual hooks/controllers/HTTP consumers; definitions only while runtime validation is deferred. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSession, USER_KEY } from "./authStorage";
import { createSubmissionController, discoverSubmissionRecovery, submissionStorageKey, useSubmissionCommand } from "./deliveryTaskSubmission";
import { createWorkOrderController, discoverWorkOrderRecovery, workOrderStorageKey, useWorkOrderCommand } from "./externalWorkOrderCommand";
import { retainedAck, retainedSubmission, retainedWorkOrder } from "./taskExternalRecoveryFixtures";
const h = vi.hoisted(() => ({ frames: {} as Record<string, any[]>, frame: "", next: 0, effects: [] as Array<() => void | (() => void)>, cleanup: [] as Array<() => void>, local: new Map<string, string>(), saved: new Map<string, string>(), sent: [] as any[], unavailable: false, lost: false }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useRef: (initial: any) => { const rows = h.frames[h.frame] ||= [], at = h.next++; return rows[at] ||= { current: initial }; },
  useMemo: (factory: () => unknown, deps: unknown[]) => { const rows = h.frames[h.frame] ||= [], at = h.next++; if (!(at in rows) || deps.some((value, index) => value !== rows[at].deps[index])) rows[at] = { deps, value: factory() }; return rows[at].value; },
  useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); }, useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
function frame<T>(name: string, render: () => T) { h.frame = name; h.next = 0; h.effects = []; const result = render(); for (const run of h.effects) { const cleanup = run(); if (cleanup) h.cleanup.push(cleanup); } return result; }
beforeEach(() => {
  h.frames = {}; h.local.clear(); h.saved.clear(); h.sent = []; h.cleanup = []; h.unavailable = false; h.lost = false;
  vi.stubGlobal("localStorage", { getItem: (key: string) => h.local.get(key) || null, setItem: (key: string, value: string) => h.local.set(key, value), removeItem: (key: string) => h.local.delete(key) });
  vi.stubGlobal("sessionStorage", { get length() { if (h.unavailable) throw new Error("storage unavailable"); return h.saved.size; }, key: (at: number) => [...h.saved.keys()][at] ?? null,
    getItem: (key: string) => { if (h.unavailable) throw new Error("storage unavailable"); return h.saved.get(key) ?? null; }, setItem: (key: string, value: string) => { if (h.unavailable) throw new Error("storage unavailable"); h.saved.set(key, value); } });
  vi.stubGlobal("location", { hash: "#/tasks/execution?project_id=P&task_id=T" }); vi.stubGlobal("window", new EventTarget());
  setSession("private-test-token", "P", "Tenant"); h.local.set(USER_KEY, JSON.stringify({ id: "User", tenant_id: "Tenant" }));
  vi.stubGlobal("fetch", async (_url: unknown, options: RequestInit) => { const body = JSON.parse(String(options.body)); h.sent.push(body); if (h.lost) throw new TypeError("Lost receipt");
    const original = body.action.startsWith("work_order.") ? retainedWorkOrder() : retainedSubmission(body.action === "task.delivery.review");
    return new Response(JSON.stringify(retainedAck(original)), { status: 200, headers: { "Content-Type": "application/json" } }); });
});
afterEach(() => { for (const cleanup of h.cleanup.reverse()) cleanup(); vi.unstubAllGlobals(); });
describe("one retained controller for each real Task/external operation scope", () => {
  it.each(["submission", "work-order"] as const)("normal and fallback %s owners ignore caller session labels and cannot send twice", async (kind) => {
    const key = kind === "submission" ? submissionStorageKey("P", "T")! : workOrderStorageKey("P", "T")!;
    const original = kind === "submission" ? retainedSubmission() : retainedWorkOrder(); h.saved.set(key, JSON.stringify({ phase: "unknown", original }));
    const hook = kind === "submission" ? useSubmissionCommand : useWorkOrderCommand;
    const first = frame("normal", () => hook("P", "T", "normal-session")), second = frame("fallback", () => hook("P", "T", "new-parent-session"));
    expect(first.snapshot).toBe(second.snapshot); await Promise.all([first.replay(), second.replay()]);
    expect(h.sent).toHaveLength(1); expect(second.snapshot().phase).toBe("succeeded"); expect(second.snapshot().original).toEqual(original);
  });
  it("keeps W and S families independent while each exact original preserves its stop/binding/feedback fields", async () => {
    const s = retainedSubmission(), w = retainedWorkOrder(); h.saved.set(submissionStorageKey("P", "T")!, JSON.stringify({ phase: "unknown", original: s })); h.saved.set(workOrderStorageKey("P", "T")!, JSON.stringify({ phase: "unknown", original: w }));
    const report = frame("report", () => useSubmissionCommand("P", "T", "s")), work = frame("work", () => useWorkOrderCommand("P", "T", "s"));
    expect(report.snapshot).not.toBe(work.snapshot); h.lost = true; await report.replay(); await work.replay(); h.lost = false; await report.replay(); await work.replay();
    expect(h.sent[0]).toEqual(h.sent[2]); expect(h.sent[1]).toEqual(h.sent[3]); expect(h.sent[0].payload.work_order.stopped_attestation).toBe(true); expect(h.sent[1].payload.feedback_reference).toEqual(w.payload.feedback_reference);
  });
  it("does not replace a retained original when another storage writer changes the exact raw value", async () => {
    const key = submissionStorageKey("P", "T")!, original = retainedSubmission(); h.saved.set(key, JSON.stringify({ phase: "unknown", original }));
    const command = frame("report", () => useSubmissionCommand("P", "T", "s")); const competing = JSON.stringify({ phase: "unknown", original: { ...original, intent: { ...original.intent, key: "different-original-key" } } }); h.saved.set(key, competing);
    await command.replay(); expect(h.sent).toHaveLength(0); expect(h.saved.get(key)).toBe(competing); expect(command.snapshot().error).toBe("retainedOriginalUnavailable");
  });
  it("keeps the shared owner active when a normal panel unmounts before fallback cleanup", async () => {
    const original = retainedSubmission(), key = submissionStorageKey("P", "T")!; h.saved.set(key, JSON.stringify({ phase: "unknown", original }));
    const normal = frame("normal", () => useSubmissionCommand("P", "T", "normal")), fallback = frame("fallback", () => useSubmissionCommand("P", "T", "fallback"));
    const leaveNormal = h.cleanup.shift()!; leaveNormal(); expect(fallback.current()).toBe(true); expect(normal.snapshot).toBe(fallback.snapshot);
    await fallback.replay(); fallback.reset(); expect(fallback.snapshot().phase).toBe("idle"); expect(h.saved.get(key)).toBe(""); expect(h.sent).toHaveLength(1);
  });
  it("uses exact raw CAS even if a competing JSON document has the same semantic fields", async () => {
    const original = retainedWorkOrder(), key = workOrderStorageKey("P", "T")!, retained = { phase: "unknown", original }; h.saved.set(key, JSON.stringify(retained));
    const command = frame("work", () => useWorkOrderCommand("P", "T", "s")), competing = JSON.stringify(retained, null, 2); h.saved.set(key, competing);
    await command.replay(); expect(h.sent).toHaveLength(0); expect(h.saved.get(key)).toBe(competing);
  });
  it("does not clear another writer's confirmed receipt when the local known ACK is finished", () => {
    const original = retainedSubmission(), key = submissionStorageKey("P", "T")!, receipt = { phase: "succeeded", original, ack: retainedAck(original) }; h.saved.set(key, JSON.stringify(receipt));
    const command = frame("report", () => useSubmissionCommand("P", "T", "s")), competing = JSON.stringify(receipt, null, 2); h.saved.set(key, competing);
    command.reset(); expect(command.snapshot().phase).toBe("succeeded"); expect(command.snapshot().error).toBe("retainedOriginalUnavailable"); expect(h.saved.get(key)).toBe(competing); expect(h.sent).toHaveLength(0);
  });
  it.each(["submission", "work-order"] as const)("retains a validated known %s ACK on remount until local reset, without a new HTTP request", (kind) => {
    const original = kind === "submission" ? retainedSubmission() : retainedWorkOrder(); let raw = JSON.stringify({ phase: "succeeded", original, ack: retainedAck(original) });
    const options: any = { projectId: "P", taskId: "T", scope: "scope", currentScope: () => "scope", load: () => raw, save: (value: string) => { raw = value; }, send: vi.fn() };
    const command = kind === "submission" ? createSubmissionController(options) : createWorkOrderController(options);
    expect(command.snapshot().phase).toBe("succeeded"); expect(raw).not.toBe(""); command.reset(); expect(command.snapshot().phase).toBe("idle"); expect(raw).toBe(""); expect(options.send).not.toHaveBeenCalled();
  });
  it("discovers only current tenant/user/revision/project originals, including corruption but excluding old sessions", () => {
    h.saved.set(submissionStorageKey("P", "T")!, JSON.stringify({ phase: "unknown", original: retainedSubmission() })); h.saved.set(workOrderStorageKey("P", "T")!, "broken retained JSON");
    h.saved.set(submissionStorageKey("Q", "T")!, JSON.stringify({ phase: "unknown", original: retainedSubmission() }));
    expect(discoverSubmissionRecovery("P")).toEqual(["T"]); expect(discoverWorkOrderRecovery("P")).toEqual(["T"]); expect(discoverWorkOrderRecovery("Q")).toEqual([]);
    setSession("new-token", "P", "Tenant"); expect(discoverSubmissionRecovery("P")).toEqual([]); expect(discoverWorkOrderRecovery("P")).toEqual([]);
  });
  it("fails closed on unavailable discovery storage and invalidates old account or route callbacks", async () => {
    h.saved.set(submissionStorageKey("P", "T")!, JSON.stringify({ phase: "unknown", original: retainedSubmission() })); const command = frame("report", () => useSubmissionCommand("P", "T", "s"));
    h.unavailable = true; expect(() => discoverSubmissionRecovery("P")).toThrow("retainedOriginalUnavailable"); h.unavailable = false;
    location.hash += "&submission_id=Other"; window.dispatchEvent(new Event("hashchange")); await command.replay(); expect(h.sent).toHaveLength(0);
  });
  it("identifies an initial DOM storage read outage as unavailable rather than a damaged original", () => {
    h.unavailable = true; const command = frame("unavailable-report", () => useSubmissionCommand("P", "T", "s"));
    expect(command.snapshot()).toMatchObject({ phase: "unknown", error: "retainedOriginalUnavailable" }); expect(command.snapshot().original).toBeUndefined(); expect(h.sent).toHaveLength(0);
  });
});
