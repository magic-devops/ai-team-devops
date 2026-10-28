/** UNRUN: actual hook lifecycle retains volatile drafts and expires captured callbacks. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectCreation } from "./useProjectCreation";
const h = vi.hoisted(() => ({ next: 0, slots: [] as any[], effects: [] as Array<() => void>, scope: "first-workspace",
  principal: { tenant_id: "tenant", user_id: "creator" }, fail: false, data: new Map<string, string>() }));
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
vi.mock("react", () => ({
  useRef: (value: unknown) => { const i = h.next++; return h.slots[i] ||= { current: value }; },
  useMemo: (make: () => unknown, deps: unknown[]) => { const i = h.next++, old = h.slots[i];
    if (!old || !same(old.deps, deps)) h.slots[i] = { deps, value: make() }; return h.slots[i].value; },
  useEffect: (make: () => unknown, deps: unknown[]) => { const i = h.next++, old = h.slots[i];
    if (!old || !same(old.deps, deps)) { h.slots[i] = { deps }; h.effects.push(() => { old?.cleanup?.(); h.slots[i].cleanup = make(); }); } },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => h.scope }));
vi.mock("./projectCreation", async () => ({ ...await vi.importActual<typeof import("./projectCreation")>("./projectCreation"),
  projectCreationPrincipal: () => ({ ...h.principal }), browserCreationLock: (_key: string, work: (available: boolean) => Promise<void>) => work(true),
}));
vi.mock("./executionExitGuard", () => ({ installExecutionExitGuard: () => () => {} }));
function render(enabled = true) {
  h.next = 0; h.effects = []; const result = useProjectCreation(enabled); h.effects.forEach((work) => work()); return result;
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => {
  h.slots.forEach((slot) => slot?.cleanup?.()); h.next = 0; h.slots = []; h.effects = []; h.scope = "first-workspace";
  h.principal = { tenant_id: "tenant", user_id: "creator" }; h.fail = false; h.data = new Map();
  vi.stubGlobal("window", { location: { hash: "#/projects/portfolio" }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: (key: string) => h.data.get(key) ?? null,
    setItem: (key: string, raw: string) => { if (h.fail) throw new Error("quota"); h.data.set(key, raw); }, removeItem: (key: string) => h.data.delete(key) });
});
describe("project creation hook lifecycle", () => {
  it("keeps unsaved current input across same-account workspace and token-scope changes", async () => {
    const old = render(); old.edit({ name: "Saved" }); h.fail = true; old.edit({ name: "Latest unsaved" });
    h.scope = "second-workspace"; const next = render(); await tick();
    expect(next.snapshot()).toMatchObject({ draft: { name: "Latest unsaved" }, unsaved: true });
    old.edit({ name: "Old callback" }); expect(next.snapshot().draft.name).toBe("Latest unsaved");
    h.fail = false; expect(next.retryStorage()).toBe(true); expect(next.snapshot().unsaved).toBe(false);
  });
  it("does not expose an account's draft to another account", async () => {
    const first = render(); first.edit({ name: "Private draft" });
    h.principal = { tenant_id: "other-tenant", user_id: "other-person" }; h.scope = "other-login";
    const other = render(); await tick();
    expect(other.snapshot().draft.name).toBe(""); first.edit({ name: "Old callback" });
    expect(other.snapshot().draft.name).toBe("");
  });
  it("releases and reacquires its own lease after closing and reopening", async () => {
    const first = render(); first.edit({ name: "Retained" }); render(false);
    const reopened = render(true); await tick();
    expect(reopened.current()).toBe(true); expect(reopened.snapshot()).toMatchObject({ draft: { name: "Retained" }, local: "saved" });
  });
});
