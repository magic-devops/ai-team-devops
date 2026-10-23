/** Hook lifecycle definitions only; UNRUN. No runtime verdict is implied. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskPlanRetention } from "./useTaskPlanRetention";
import { planDraft, planPrincipal, planStorage } from "./taskPlanRetentionFixtures";
const h = vi.hoisted(() => ({ hooks: [] as any[], next: 0, effects: [] as (() => (() => void))[], session: "login-1", send: vi.fn() }));
vi.mock("react", () => ({
  useRef: (initial: any) => { const i = h.next++; return h.hooks[i] ||= { current: initial }; },
  useMemo: (factory: () => any, deps: any[]) => { const i = h.next++, before = h.hooks[i];
    if (!before || deps.some((value, j) => value !== before.deps[j])) h.hooks[i] = { value: factory(), deps }; return h.hooks[i].value; },
  useSyncExternalStore: (_subscribe: any, snapshot: () => any) => snapshot(),
  useEffect: (effect: () => (() => void), deps: any[]) => { const i = h.next++, before = h.hooks[i];
    if (!before || deps.some((value, j) => value !== before[j])) h.effects.push(effect); h.hooks[i] = deps; },
}));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => h.session }));
vi.mock("./authStorage", async () => ({ ...(await vi.importActual<typeof import("./authStorage")>("./authStorage")), getSessionRevision: () => h.session }));
vi.mock("./http", () => ({ bindSessionRequest: () => h.send }));
vi.mock("./taskPlanRetention", async () => ({ ...(await vi.importActual<typeof import("./taskPlanRetention")>("./taskPlanRetention")),
  taskPlanPrincipal: () => planPrincipal, browserPlanLock: async (_key: string, work: (available: boolean) => Promise<void>) => work(true) }));
let cleanup: (() => void) | undefined, listeners: Map<string, Set<() => void>>;
function render() { h.next = 0; return useTaskPlanRetention("P", "R"); }
beforeEach(() => {
  h.hooks = []; h.next = 0; h.effects = []; h.session = "login-1"; h.send.mockReset(); listeners = new Map(); cleanup = undefined;
  vi.stubGlobal("location", { hash: "#/dev-flow?project_id=P&plan_requirement=R" }); vi.stubGlobal("localStorage", planStorage());
  vi.stubGlobal("window", { addEventListener: (name: string, fn: () => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
    removeEventListener: (name: string, fn: () => void) => listeners.get(name)?.delete(fn), dispatchEvent: () => true });
});
afterEach(async () => { cleanup?.(); await Promise.resolve(); vi.unstubAllGlobals(); });
describe("task-plan retention lifecycle", () => {
  it("shows unavailable storage when reading the browser storage property itself is denied", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("SecurityError"); } });
    try { const result = render(); expect(result.view.status).toBe("unavailable"); expect(h.send).not.toHaveBeenCalled(); }
    finally { if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); }
  });
  it("keeps its lock across immediate effect reconnect and blocks callbacks after real unmount", async () => {
    const first = render(), connect = h.effects[0]; cleanup = connect(); expect(first.store.saveDraft(planDraft())).toBe(true);
    cleanup(); expect(first.store.current()).toBe(false); cleanup = connect(); await Promise.resolve();
    expect(first.store.current()).toBe(true); expect(render().store).toBe(first.store); cleanup(); cleanup = undefined;
    expect(first.store.current()).toBe(false); await Promise.resolve(); expect(first.store.snapshot().owned).toBe(false);
  });
  it("reopens the same durable draft with a new route scope and refuses the old callbacks", async () => {
    const first = render(); cleanup = h.effects[0](); first.store.saveDraft(planDraft());
    location.hash += "&view=tasks"; expect(first.store.current()).toBe(false); cleanup();
    const second = render(); cleanup = h.effects.at(-1)!(); await Promise.resolve();
    expect(second.store).not.toBe(first.store); expect(second.store.snapshot().draft).toEqual(planDraft()); expect(first.store.current()).toBe(false);
  });
  it("invalidates the current instance on session change without deleting the saved record", () => {
    const first = render(); cleanup = h.effects[0](); first.store.saveDraft(planDraft()); h.session = "login-2";
    listeners.get("sop-session")?.forEach((fn) => fn()); expect(first.store.current()).toBe(false);
    expect(localStorage.getItem(first.store.key!)).toContain("Pinned scope"); expect(h.send).not.toHaveBeenCalled();
  });
});
