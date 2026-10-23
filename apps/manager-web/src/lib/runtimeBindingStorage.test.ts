/** Actual hook, frozen transport and storage definitions. SOURCE ONLY, UNRUN. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSession, setWorkspaceScope, USER_KEY } from "./authStorage";
import { useRuntimeBindingCommand, runtimeBindingStorageKey, discoverRuntimeBindingRecovery } from "./runtimeBindingCommand";
const h = vi.hoisted(() => ({ local: new Map<string, string>(), retained: new Map<string, string>(), cleanups: [] as Array<() => void>, calls: [] as any[], lost: false }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useRef: (current: unknown) => ({ current }), useMemo: (make: () => unknown) => make(),
  useSyncExternalStore: (_listen: unknown, read: () => unknown) => read(), useEffect: (make: () => (() => void)) => { h.cleanups.push(make()); } }));
const original = { action: "member.runtime.unbind" as const, payload: { member_id: "member-tool" }, intent: { version: 8, key: "fixed-unbind-key" } };
beforeEach(() => {
  h.local.clear(); h.retained.clear(); h.calls = []; h.cleanups = []; h.lost = false;
  vi.stubGlobal("localStorage", { getItem: (key: string) => h.local.get(key) ?? null, setItem: (key: string, value: string) => h.local.set(key, value), removeItem: (key: string) => h.local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => h.retained.get(key) ?? null, setItem: (key: string, value: string) => h.retained.set(key, value), get length() { return h.retained.size; }, key: (at: number) => [...h.retained.keys()][at] ?? null });
  const location = { hash: "#/dev-flow?view=team&team_member=member-tool" };
  vi.stubGlobal("location", location); vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  setSession("private-token", "P", "tenant"); h.local.set(USER_KEY, JSON.stringify({ id: "U", tenant_id: "tenant" }));
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); h.calls.push({ body, headers: new Headers(init.headers), url });
    if (h.lost) throw new TypeError("Receipt lost");
    return new Response(JSON.stringify({ project_id: "P", action: body.action, resource: { kind: "member", id: "member-tool" }, result: null,
      affected_refs: [{ kind: "member", id: "member-tool" }], applied_version: 9, version: 9, query_generation: 4, replayed: false }), { status: 200 });
  });
});
afterEach(() => { h.cleanups.forEach((cleanup) => cleanup()); vi.unstubAllGlobals(); });
describe("member-scoped retained bindings", () => {
  it("restores in the same tab with exact transport identity and discovers it without current member reads", async () => {
    h.lost = true; const first = useRuntimeBindingCommand("P", "member-tool", "S"); await first.run(original);
    expect(discoverRuntimeBindingRecovery("P")).toEqual(["member-tool"]); h.cleanups.shift()!();
    h.lost = false; const cold = useRuntimeBindingCommand("P", "member-tool", "S"); await cold.replay();
    expect(h.calls.map((call) => call.body)).toEqual([0, 1].map(() => ({ action: original.action, payload: original.payload, expected_version: 8, idempotency_key: "fixed-unbind-key" })));
    expect(h.calls[0].headers.get("X-Project-Id")).toBe("P"); expect(cold.snapshot().phase).toBe("succeeded");
    expect(discoverRuntimeBindingRecovery("P")).toEqual(["member-tool"]); cold.reset(); expect(discoverRuntimeBindingRecovery("P")).toEqual([]);
  });
  it("prevents a second stale storage owner from replacing a confirmed operation", async () => {
    const first = useRuntimeBindingCommand("P", "member-tool", "S"), stale = useRuntimeBindingCommand("P", "member-tool", "S");
    await first.run(original); const saved = h.retained.get(runtimeBindingStorageKey("P", "member-tool")!);
    await stale.run({ ...original, intent: { version: 9, key: "another-binding-key" } });
    expect(h.calls).toHaveLength(1); expect(stale.snapshot().error).toBe("retainedOriginalUnavailable");
    expect(h.retained.get(runtimeBindingStorageKey("P", "member-tool")!)).toBe(saved);
  });
  it("allows a cold owner to recover when outgoing cleanup changes only sending to unknown", async () => {
    let complete!: (response: Response) => void;
    const realFetch = globalThis.fetch; let first = true;
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      if (first) { first = false; return new Promise<Response>((resolve) => { complete = resolve; }); }
      return realFetch(url, init);
    });
    const outgoing = useRuntimeBindingCommand("P", "member-tool", "S"), pending = outgoing.run(original);
    location.hash += "&changed=1";
    const incoming = useRuntimeBindingCommand("P", "member-tool", "S"); expect(incoming.scope).not.toBe(outgoing.scope); h.cleanups.shift()!();
    await incoming.replay(); expect(incoming.snapshot().phase).toBe("succeeded");
    const retained = h.retained.get(runtimeBindingStorageKey("P", "member-tool")!);
    complete(new Response(JSON.stringify({ version: 9 }), { status: 200 })); await pending;
    expect(h.retained.get(runtimeBindingStorageKey("P", "member-tool")!)).toBe(retained);
  });
  it("keeps corrupt originals discoverable and isolates project, business and account session", () => {
    const key = runtimeBindingStorageKey("P", "member-tool")!; h.retained.set(key, "{corrupt");
    expect(discoverRuntimeBindingRecovery("P")).toEqual(["member-tool"]); expect(discoverRuntimeBindingRecovery("Q")).toEqual([]);
    const blocked = useRuntimeBindingCommand("P", "member-tool", "S"); expect(blocked.snapshot().phase).toBe("unknown");
    setWorkspaceScope({ projectId: "P", businessCode: "different-business" }); expect(discoverRuntimeBindingRecovery("P")).toEqual([]);
    setSession("another-token", "P", "tenant"); expect(discoverRuntimeBindingRecovery("P")).toEqual([]);
    expect(h.retained.get(key)).toBe("{corrupt");
  });
});
