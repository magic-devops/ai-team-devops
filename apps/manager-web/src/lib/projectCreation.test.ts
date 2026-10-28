/** UNRUN: browser persistence, original request and receipt recovery definitions. */
import { describe, expect, it, vi } from "vitest";
import { createProjectCreationStore, projectCreationStorageKey, type CreationLock, type ProjectCreationOriginal } from "./projectCreation";

const principal = { tenant_id: "tenant", user_id: "creator" };
const ack = (body: ProjectCreationOriginal) => ({ ok: true, action: "project.create", id: "proj-" + "a".repeat(59),
  tenant_id: "tenant", creator_id: "creator", idempotency_key: body.idempotency_key, replayed: false });
function setup(data = new Map<string, string>()) {
  const h = { active: true, failWrite: false, failRead: false, owns: true };
  const storage = { getItem: (key: string) => { if (h.failRead) throw new Error("storage temporarily denied"); return data.get(key) ?? null; },
    setItem: (key: string, raw: string) => { if (h.failWrite) throw new Error("quota"); data.set(key, raw); },
    removeItem: (key: string) => { if (h.failWrite) throw new Error("quota"); data.delete(key); } };
  const send = vi.fn<(body: ProjectCreationOriginal) => Promise<unknown>>(async (body) => ack(body));
  const lock: CreationLock = (_key, work) => work(h.owns);
  const store = createProjectCreationStore({ principal, storage, lock, current: () => h.active, send, key: () => "test-create-001" });
  store.connect();
  return { store, h, data, send };
}
describe("project creation recovery", () => {
  const reconnect = async (store: ReturnType<typeof createProjectCreationStore>) => {
    store.connect(); for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  it("retains each edit across editor close and a fresh account-scoped instance", () => {
    const first = setup(); first.store.edit({ name: "New product", description: "Context", business_id: "business" });
    expect(first.store.snapshot()).toMatchObject({ local: "saved", unsaved: false }); first.store.disconnect();
    const second = setup(first.data);
    expect(second.store.snapshot().draft).toMatchObject({ name: "New product", business_id: "business", status: "planning" });
    expect(second.send).not.toHaveBeenCalled();
  });
  it("persists the fixed original before wire and suppresses duplicate clicks in the same frame", async () => {
    const f = setup(); f.store.edit({ name: "  New project  " });
    let finish!: (value: unknown) => void;
    f.send.mockImplementation((body) => { expect(JSON.parse([...f.data.values()][0]).state.original).toEqual(body); return new Promise((resolve) => { finish = resolve; }); });
    const pending = f.store.create(); await f.store.create();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0][0]).toMatchObject({ name: "New project", business_id: null, status: "planning" });
    finish(ack(f.send.mock.calls[0][0])); await pending;
    expect(f.store.snapshot().phase).toBe("succeeded");
  });
  it("restores interrupted sends as unknown and only resends the same body and key", async () => {
    const first = setup(); first.store.edit({ name: "Original" }); first.send.mockImplementation(() => new Promise(() => {}));
    void first.store.create(); const original = first.store.snapshot().original!; first.store.disconnect();
    const next = setup(first.data); expect(next.store.snapshot().phase).toBe("unknown"); expect(next.send).not.toHaveBeenCalled();
    next.store.edit({ name: "Replacement" }); expect(next.store.clear()).toBe(false); await next.store.create();
    next.send.mockRejectedValueOnce(new Error("HTTP 403: permission changed")); await next.store.replay();
    expect(next.store.snapshot().phase).toBe("unknown");
    await next.store.replay(); expect(next.send.mock.calls).toEqual([[original], [original]]);
    expect(next.store.snapshot().phase).toBe("succeeded");
  });
  it("allows explicit revision only after a definite first-attempt refusal", async () => {
    const f = setup(); f.store.edit({ name: "Rejected draft" }); f.send.mockRejectedValueOnce(new Error("HTTP 422: invalid business"));
    await f.store.create(); expect(f.store.snapshot().phase).toBe("refused");
    f.store.edit({ name: "Hidden replacement" }); expect(f.store.snapshot().draft.name).toBe("Rejected draft");
    f.store.revise(); f.store.edit({ name: "Revised" }); expect(f.store.snapshot().phase).toBe("editing");
    expect(f.store.snapshot().original).toBeNull();
  });
  it("does not accept a receipt for another actor, key or project shape", async () => {
    const f = setup(); f.store.edit({ name: "New" });
    f.send.mockImplementationOnce(async (body) => ({ ...ack(body), creator_id: "someone-else" }));
    await f.store.create(); expect(f.store.snapshot().phase).toBe("unknown");
    f.send.mockImplementationOnce(async (body) => ({ ...ack(body), idempotency_key: "other-original" }));
    await f.store.replay(); expect(f.store.snapshot().phase).toBe("unknown");
  });
  it("preserves volatile edits on quota failure and sends nothing before they are saved", async () => {
    const f = setup(); f.h.failWrite = true; f.store.edit({ name: "Unsaved input" });
    expect(f.store.snapshot()).toMatchObject({ unsaved: true, draft: { name: "Unsaved input" } });
    await f.store.create(); expect(f.send).not.toHaveBeenCalled();
    f.h.failWrite = false; expect(f.store.retryStorage()).toBe(true); await f.store.create();
    expect(f.store.snapshot().phase).toBe("succeeded");
  });
  it("preserves a confirmed receipt in memory if browser persistence fails after the response", async () => {
    const f = setup(); f.store.edit({ name: "New" });
    f.send.mockImplementation(async (body) => { f.h.failWrite = true; return ack(body); });
    await f.store.create(); expect(f.store.snapshot()).toMatchObject({ phase: "succeeded", unsaved: true });
    f.store.disconnect(); const next = setup(f.data);
    expect(next.store.snapshot().phase).toBe("unknown"); await next.store.replay();
    expect(next.store.snapshot().phase).toBe("succeeded");
  });
  it("preserves corrupt and foreign recovery bytes and never overwrites them", () => {
    const key = projectCreationStorageKey(principal), data = new Map([[key, "invalid-original"]]);
    const f = setup(data); f.store.edit({ name: "Replacement" });
    expect(f.store.snapshot().local).toBe("invalid"); expect(f.store.clear()).toBe(false); expect(data.get(key)).toBe("invalid-original");
  });
  it.each(["unknown", "refused", "succeeded"])("rejects a %s record whose draft differs from its fixed original", async (phase) => {
    const f = setup(); f.store.edit({ name: "Original" });
    if (phase !== "succeeded") f.send.mockRejectedValueOnce(new Error(phase === "unknown" ? "timeout" : "HTTP 422: invalid"));
    await f.store.create(); f.store.disconnect();
    const key = projectCreationStorageKey(principal), saved = JSON.parse(f.data.get(key)!);
    saved.state.draft.name = "Different display"; const raw = JSON.stringify(saved); f.data.set(key, raw);
    const next = setup(f.data); expect(next.store.snapshot().local).toBe("invalid");
    await next.store.replay(); expect(next.send).not.toHaveBeenCalled(); expect(next.data.get(key)).toBe(raw);
  });
  it("preserves unsaved input when the same account reconnects after workspace or session changes", async () => {
    const f = setup(); f.store.edit({ name: "Saved" }); f.h.failWrite = true;
    f.store.edit({ name: "Unsaved latest" }); f.store.disconnect();
    await reconnect(f.store);
    expect(f.store.snapshot()).toMatchObject({ draft: { name: "Unsaved latest" }, unsaved: true, local: "unavailable" });
    f.h.failWrite = false; expect(f.store.retryStorage()).toBe(true);
    expect(f.store.snapshot()).toMatchObject({ draft: { name: "Unsaved latest" }, unsaved: false });
  });
  it("keeps a volatile draft recoverable after a transient storage read failure during reconnect", async () => {
    const f = setup(); f.store.edit({ name: "Saved" }); f.h.failWrite = true;
    f.store.edit({ name: "Only current input" }); f.store.disconnect(); f.h.failRead = true;
    await reconnect(f.store);
    expect(f.store.snapshot()).toMatchObject({ local: "unavailable", unsaved: true, draft: { name: "Only current input" } });
    f.h.failRead = false; f.h.failWrite = false;
    expect(f.store.retryStorage()).toBe(true); expect(f.store.snapshot()).toMatchObject({ local: "saved", unsaved: false });
  });
  it("refuses external raw changes under its lease", () => {
    const f = setup(); f.store.edit({ name: "Original" }); const key = projectCreationStorageKey(principal);
    f.data.set(key, "external-bytes"); f.store.edit({ description: "Retained here" });
    expect(f.store.snapshot().local).toBe("conflict"); expect(f.data.get(key)).toBe("external-bytes");
  });
  it("blocks writes when another window owns the lease and after identity changes", async () => {
    const f = setup(); f.store.disconnect(); f.h.owns = false; await reconnect(f.store);
    f.store.edit({ name: "No lease" }); await f.store.create(); expect(f.store.snapshot().local).toBe("busy"); expect(f.send).not.toHaveBeenCalled();
    const next = setup(); next.store.edit({ name: "Scoped draft" }); next.h.active = false;
    await next.store.create(); expect(next.send).not.toHaveBeenCalled();
  });
  it("ignores a late response from a previous editor lifetime after reconnect", async () => {
    const f = setup(); f.store.edit({ name: "Original" }); let finish!: (value: unknown) => void;
    f.send.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = f.store.create(); const original = f.store.snapshot().original!;
    f.store.disconnect(); await reconnect(f.store); finish(ack(original)); await pending;
    expect(f.store.snapshot().phase).toBe("unknown");
    await f.store.replay(); expect(f.store.snapshot().phase).toBe("succeeded");
  });
});
