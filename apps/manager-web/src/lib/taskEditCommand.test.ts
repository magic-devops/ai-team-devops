/** Actual controller and hook definitions. Runtime validation is deferred by the user. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSession, USER_KEY } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";
import { useDeliveryCommand } from "./deliveryCommandController";
import { beginProgressExactRead } from "./deliveryProgressReads";
import { createTaskEditController, discoverTaskEditRecovery, taskEditRecoveryPending, taskEditStorageKey, useTaskEditCommand,
  validTaskEditAck, validTaskEditOriginal, type TaskDefinitionEditPayload, type TaskEditOriginal } from "./taskEditCommand";

const h = vi.hoisted(() => ({ frames: {} as Record<string, any[]>, frame: "", at: 0, local: new Map<string, string>(), retained: new Map<string, string>(),
  calls: [] as any[], reply: "success" as "success" | "lost" | "denied", denyStorage: false }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useRef: (initial: any) => { const slots = h.frames[h.frame] ||= [], at = h.at++; return slots[at] ||= { current: initial }; },
  useMemo: (make: () => unknown, deps: unknown[]) => { const slots = h.frames[h.frame] ||= [], at = h.at++; if (!slots[at] || deps.some((part, index) => part !== slots[at].deps[index])) slots[at] = { deps, value: make() }; return slots[at].value; },
  useSyncExternalStore: (_listen: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (make: () => unknown, deps: unknown[]) => { const slots = h.frames[h.frame] ||= [], at = h.at++;
    if (!slots[at] || deps.some((part, index) => part !== slots[at].deps[index])) { slots[at]?.cleanup?.(); slots[at] = { deps, make, cleanup: make() }; }
  },
}));
const a = "a".repeat(64), b = "b".repeat(64);
const payload = (): TaskDefinitionEditPayload => ({ id: "T", title: "Task definition", task_basis: a, planning_basis: b, description: "Keep this exact edit",
  acceptance_criteria: ["Can recover"], requirement_criteria_indices: [], depends_on: [], starts_on: null, ends_on: null, blocked_reason: "" });
const original = (): TaskEditOriginal => ({ action: "task.update", payload: payload(), intent: { version: 7, key: "fixed-task-edit-key" } });
const ack = (value: TaskEditOriginal) => ({ project_id: "P", action: "task.update", resource: { kind: "task", id: "T" }, result: null,
  affected_refs: [{ kind: "task", id: "T" }], applied_version: value.intent.version + 1, version: value.intent.version + 1, query_generation: 9, replayed: false });
function hook(name = "task", callback = vi.fn()) { h.frame = name; h.at = 0; return useTaskEditCommand("P", "T", "session", callback); }
function unmount(name: string) { for (const slot of h.frames[name] || []) { slot?.cleanup?.(); if (slot?.cleanup) slot.cleanup = undefined; } delete h.frames[name]; }
beforeEach(() => {
  for (const name of Object.keys(h.frames)) unmount(name);
  h.frames = {}; h.local.clear(); h.retained.clear(); h.calls = []; h.reply = "success"; h.denyStorage = false;
  vi.stubGlobal("localStorage", { getItem: (key: string) => h.local.get(key) ?? null, setItem: (key: string, raw: string) => h.local.set(key, raw), removeItem: (key: string) => h.local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => { if (h.denyStorage) throw new Error("Storage denied"); return h.retained.get(key) ?? null; },
    setItem: (key: string, raw: string) => { if (h.denyStorage) throw new Error("Storage denied"); h.retained.set(key, raw); }, get length() { return h.retained.size; }, key: (at: number) => [...h.retained.keys()][at] ?? null });
  const location = { hash: "#/tasks/execution?project_id=P&task_id=T", href: "http://localhost/#/tasks/execution?project_id=P&task_id=T" };
  vi.stubGlobal("location", location); vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  setSession("private-token", "P", "tenant"); h.local.set(USER_KEY, JSON.stringify({ id: "U", tenant_id: "tenant" }));
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); h.calls.push({ url: String(url), body, headers: new Headers(init?.headers) });
    if (h.reply === "lost") throw new TypeError("Lost receipt");
    return new Response(JSON.stringify(h.reply === "denied" ? { detail: "Current permission revoked" } : ack({ action: body.action, payload: body.payload,
      intent: { version: body.expected_version, key: body.idempotency_key }, ...(body.source_reference ? { source_reference: body.source_reference } : {}) })),
      { status: h.reply === "denied" ? 403 : 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { for (const name of Object.keys(h.frames)) unmount(name); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("strict task edit originals and receipts (definitions only)", () => {
  it("supports full definition, owner and status without accepting an unrelated task operation", () => {
    const value = original(); expect(validTaskEditOriginal(value, "T")).toBe(true);
    for (const extra of [{ owner_id: "" }, { owner_id: "agent:codex" }, { status: "blocked" }]) expect(validTaskEditOriginal({ ...value, payload: { id: "T", task_basis: a, ...extra } }, "T")).toBe(true);
    expect(validTaskEditOriginal({ ...value, payload: { ...payload(), priority: "P0" } }, "T")).toBe(false);
    expect(validTaskEditOriginal({ ...value, payload: { ...payload(), id: "other" } }, "T")).toBe(false);
  });
  it("allows legitimate definition text above the external-report limit and preserves a fixed discussion source", () => {
    const value = original(); (value.payload as TaskDefinitionEditPayload).acceptance_criteria = Array.from({ length: 80 }, () => "中".repeat(2000));
    value.source_reference = { thread_id: "thread", expected_thread_version: 2, resolution_event_id: "resolution", message_id: "message", message_revision: 3 };
    expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeGreaterThan(48 * 1024); expect(validTaskEditOriginal(value, "T")).toBe(true);
    expect(validTaskEditOriginal({ ...value, source_reference: { ...value.source_reference, message_revision: 0 } }, "T")).toBe(false);
  });
  it.each(["basis", "null-title", "extra", "lone-surrogate", "date", "indices", "self-dependency", "signature"])("refuses malformed %s before retaining or sending", (change) => {
    const value: any = original(); if (change === "basis") value.payload.task_basis = ""; if (change === "null-title") value.payload.title = null;
    if (change === "extra") value.payload.verified = true; if (change === "lone-surrogate") value.payload.title = "\ud800";
    if (change === "date") value.payload.starts_on = "2026-02-30"; if (change === "indices") value.payload.requirement_criteria_indices = [0, 0];
    if (change === "self-dependency") value.payload.depends_on = ["T"]; if (change === "signature") value.intent.signature = "not part of original";
    expect(validTaskEditOriginal(value, "T")).toBe(false);
  });
  it.each(["project", "action", "version", "target", "result", "extra-ref", "missing-ref"])("rejects wrong %s ACK rather than treating a current GET as confirmation", (change) => {
    const value = original(), answer: any = ack(value);
    if (change === "project") answer.project_id = "Q"; if (change === "action") answer.action = "task.create"; if (change === "version") answer.applied_version++;
    if (change === "target") answer.resource.id = "other"; if (change === "result") answer.result = { ok: true };
    if (change === "extra-ref") answer.affected_refs.push(answer.affected_refs[0]); if (change === "missing-ref") answer.affected_refs = [];
    expect(validTaskEditAck("P", "T", value, answer)).toBe(false);
  });
  it("retains a cold confirmed ACK until explicit cleanup and never replays it", async () => {
    const value = original(); let raw = JSON.stringify({ phase: "succeeded", original: value, ack: ack(value) }); const send = vi.fn();
    const controller = createTaskEditController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => "scope", load: () => raw, save: (next) => { raw = next; }, send });
    expect(controller.snapshot().phase).toBe("succeeded"); expect(raw).not.toBe(""); await controller.replay(); expect(send).not.toHaveBeenCalled();
    controller.reset(); expect(controller.snapshot().phase).toBe("idle"); expect(raw).toBe("");
  });
  it("keeps acknowledged outcome known when local cleanup fails", () => {
    const value = original(); const raw = JSON.stringify({ phase: "succeeded", original: value, ack: ack(value) });
    const controller = createTaskEditController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => "scope", load: () => raw,
      save: () => { throw new Error("Storage unavailable"); }, send: vi.fn() });
    controller.reset(); expect(controller.snapshot()).toMatchObject({ phase: "succeeded", error: "retainedOriginalUnavailable" });
  });
  it.each(["unknown", "succeeded"])("renders safe metadata for a retained %s without losing the validated original or receipt", async (phase) => {
    const value = original(), send = vi.fn(async () => ack(value));
    const controller = createTaskEditController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => "scope",
      load: () => JSON.stringify({ phase, original: value, ...(phase === "succeeded" ? { ack: ack(value) } : {}), error: { message: "Corrupt metadata" } }), save: vi.fn(), send });
    expect(controller.snapshot()).toMatchObject({ phase, original: value }); expect(controller.snapshot().error).toBeUndefined();
    await controller.replay(); expect(send).toHaveBeenCalledTimes(phase === "unknown" ? 1 : 0); expect(controller.snapshot().phase).toBe("succeeded");
  });
});

describe("actual task edit hook, shared owner and original HTTP transport (unrun)", () => {
  it("shares one controller, preserves source/body/version/key and restores unknown after all owners unmount", async () => {
    const pending = vi.fn(), value = original(); value.source_reference = { thread_id: "thread", expected_thread_version: 2, resolution_event_id: "resolution", message_id: "message", message_revision: 3 };
    const editor = hook("editor", pending), recovery = hook("recovery"); expect(editor.snapshot).toBe(recovery.snapshot);
    h.reply = "lost"; await editor.run(value); expect(pending).toHaveBeenLastCalledWith(true); expect(h.calls).toHaveLength(1);
    expect(discoverTaskEditRecovery("P")).toEqual(["T"]); expect(discoverTaskEditRecovery("Q")).toEqual([]);
    unmount("editor"); expect(recovery.current()).toBe(true); unmount("recovery");
    const restored = hook("restored"); expect(restored.snapshot().phase).toBe("unknown");
    h.reply = "success"; await restored.replay();
    expect(h.calls).toHaveLength(2); expect(h.calls[1].body).toEqual(h.calls[0].body); expect(h.calls[1].headers.get("X-Project-Id")).toBe("P");
    expect(restored.snapshot().phase).toBe("succeeded"); expect(taskEditRecoveryPending("P", "T")).toBe(true);
    restored.reset(); expect(taskEditRecoveryPending("P", "T")).toBe(false);
  });
  it("does not let a second mounted idle editor overwrite an unknown original", async () => {
    const first = hook("first"), second = hook("second"); h.reply = "lost"; await first.run(original());
    const newer = original(); newer.intent.key = "other-task-edit-key"; newer.payload = { id: "T", task_basis: a, status: "blocked" };
    await second.run(newer); expect(h.calls).toHaveLength(1); expect(first.snapshot().original).toEqual(original());
  });
  it("shares the actual account and Task scope even when caller session labels differ", async () => {
    const first = hook("editor"); h.frame = "recovery"; h.at = 0;
    const second = useTaskEditCommand("P", "T", "different-caller-label");
    expect(second.snapshot).toBe(first.snapshot); h.reply = "lost"; await first.run(original());
    await second.run({ ...original(), intent: { version: 7, key: "replacement-editor-key" } });
    expect(h.calls).toHaveLength(1); expect(second.snapshot().original).toEqual(original());
  });
  it("keeps save and recovery active across unrelated preference storage events", async () => {
    const command = hook(); window.dispatchEvent(new Event("storage")); expect(command.current()).toBe(true);
    h.reply = "lost"; await command.run(original()); window.dispatchEvent(new Event("storage"));
    expect(command.current()).toBe(true); h.reply = "success"; await command.replay(); expect(command.snapshot().phase).toBe("succeeded");
    expect(h.calls).toHaveLength(2);
  });
  it("keeps exact definition reads active for preferences but invalidates real route changes", () => {
    const read = beginProgressExactRead(); window.dispatchEvent(new Event("storage")); expect(read.current()).toBe(true);
    location.hash = "#/tasks/execution?project_id=P&task_id=other"; window.dispatchEvent(new Event("hashchange"));
    expect(read.current()).toBe(false); read.finish();
  });
  it("keeps the shared canonical delivery hook active for unrelated storage events too", async () => {
    let calls = 0;
    h.frame = "canonical-hook"; h.at = 0;
    const command = useDeliveryCommand<TaskEditOriginal>({ projectId: "P", identity: "task:T", storageKey: () => taskEditStorageKey("P", "T"),
      create: (options) => createTaskEditController({ ...options, taskId: "T", send: async (value) => { calls++; if (calls === 1) throw new TypeError("Lost reply"); return ack(value); } }) });
    window.dispatchEvent(new Event("storage")); expect(command.current()).toBe(true); await command.run(original());
    window.dispatchEvent(new Event("storage")); expect(command.current()).toBe(true); await command.replay(); expect(calls).toBe(2);
    expect(command.snapshot().phase).toBe("succeeded");
  });
  it("survives StrictMode effect cleanup/setup while retaining one shared controller", async () => {
    const command = hook("strict"); const effects = (h.frames.strict || []).filter((slot) => slot?.make);
    for (const effect of effects) { effect.cleanup?.(); effect.cleanup = effect.make(); }
    const other = hook("other"); expect(other.snapshot).toBe(command.snapshot); await command.run(original()); expect(h.calls).toHaveLength(1);
  });
  it("does not send without retaining the original and fails closed on corrupt stored recovery", async () => {
    const controller = hook(); h.denyStorage = true; await controller.run(original()); expect(h.calls).toHaveLength(0); h.denyStorage = false; unmount("task");
    h.retained.set(taskEditStorageKey("P", "T")!, "broken-json"); const broken = hook(); expect(broken.snapshot().phase).toBe("unknown");
    expect(taskEditRecoveryPending("P", "T")).toBe(true); await broken.run(original()); expect(h.calls).toHaveLength(0);
  });
  it("can discover a refused original for failed-read presentation without classifying it as unresolved", () => {
    h.retained.set(taskEditStorageKey("P", "T")!, JSON.stringify({ phase: "refused", original: original(), error: "basis changed" }));
    expect(taskEditRecoveryPending("P", "T")).toBe(false); expect(discoverTaskEditRecovery("P")).toEqual([]);
    expect(discoverTaskEditRecovery("P", true)).toEqual(["T"]); expect(discoverTaskEditRecovery("Q", true)).toEqual([]);
  });
  it("keeps a rejected replay unknown after access revocation and never reads current facts to replace it", async () => {
    const command = hook(); h.reply = "lost"; await command.run(original()); h.reply = "denied"; await command.replay();
    expect(command.snapshot().phase).toBe("unknown"); expect(h.calls).toHaveLength(2); expect(h.calls[1].body).toEqual(h.calls[0].body);
    expect(h.calls.every((call) => call.url.endsWith("/api/v1/delivery/commands"))).toBe(true);
  });
  it("invalidates old account and unmounted callbacks without changing their retained original", async () => {
    const command = hook(); h.reply = "lost"; await command.run(original()); const raw = h.retained.get(taskEditStorageKey("P", "T")!);
    const before = projectSessionKey(); setSession("new-token", "P", "tenant"); expect(projectSessionKey()).not.toBe(before);
    await command.replay(); expect(h.calls).toHaveLength(1); expect([...h.retained.values()]).toContain(raw);
  });
});
