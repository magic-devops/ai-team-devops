import { isValidElement, type ReactNode } from "react";
import { Button, Input } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReflectionWorkbench } from "../../subapps/ai-foundation/src/pages/intelligence/reflections/ReflectionWorkbench";
import { ReflectionInputForm } from "../../subapps/ai-foundation/src/pages/intelligence/reflections/ReflectionInputHost";
import { reflectionDigest, reflectionDetailFixture } from "./reflectionFixtures";
const h = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], next: 0, refNext: 0, effects: [] as Array<() => void | (() => void)>, listeners: {} as Record<string, Array<() => void>>, raw: "", controller: null as any, controllers: new Map<string, any>(), retained: new Map<string, string>(), project: "P", session: "S", pending: false, mode: "unknown", writes: [] as any[], context: { project_id: "P", version: 7, query_generation: 3, query_state: { status: "ready" }, permissions: { write: true } } }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), useState: (initial: any) => { const index = h.next++; if (!(index in h.states)) h.states[index] = typeof initial === "function" ? initial() : initial; return [h.states[index], (v: any) => { h.states[index] = typeof v === "function" ? v(h.states[index]) : v; }]; }, useRef: (v: any) => (h.refs[h.refNext++] ||= { current: v }), useEffect: (effect: any) => h.effects.push(effect) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-query", async () => ({ ...(await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query")), useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: () => ({ data: h.context, error: null, refetch: vi.fn() }), useQueries: (options: any) => options.queries.map(() => ({ data: reflectionDetailFixture(), error: null, isPending: false, refetch: vi.fn() })) }));
vi.mock("./projectPortfolio", async () => ({ ...(await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio")), projectSessionKey: () => h.session }));
vi.mock("./executionExitGuard", () => ({ useExecutionExitGuard: () => ({ pending: h.pending, blocked: false, canNavigate: () => !h.pending, setPending: (_id: string, value: boolean) => { h.pending = value; } }) }));
vi.mock("./reflectionCommand", async () => {
  const actual = await vi.importActual<typeof import("./reflectionCommand")>("./reflectionCommand");
  return { ...actual, useReflectionInputCommand: (projectId: string, onPending: (v: boolean) => void) => {
    const scope = JSON.stringify([projectId, h.session]);
    const controller = h.controllers.get(scope) || actual.createReflectionInputController({ projectId, scope, currentScope: () => JSON.stringify([h.project, h.session]), load: () => h.retained.get(scope) || null, save: (v) => { h.raw = v; h.retained.set(scope, v); }, onPending, send: async (original) => { h.writes.push(structuredClone(original)); if (h.mode === "unknown") throw new Error("lost acknowledgement"); return { project_id: projectId, action: "reflection.input.create", resource: { kind: "reflection_input", id: "I" }, affected_refs: [{ kind: "reflection_input", id: "I" }], result: { status: "prepared", source_count: 1 }, applied_version: 8, version: 8, query_generation: 4, replayed: true }; } });
    h.controllers.set(scope, controller); h.controller = controller;
    const state = controller.snapshot(); return { ...controller, state, locked: !["idle", "refused"].includes(state.phase), unresolved: ["sending", "unknown"].includes(state.phase) };
  } };
});
function find(node: ReactNode, predicate: (value: any) => boolean): any {
  if (Array.isArray(node)) return node.map((v) => find(v, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (predicate(node)) return node.props;
  return find(node.props.children, predicate) || find(node.props.footer, predicate) || find(node.props.action, predicate);
}
const source = { reflection_id: "R", source_digest: reflectionDigest, attempt_id: "A" };
const exitState = vi.fn();
function render() {
  h.next = 0; h.refNext = 0;
  const tree = ReflectionWorkbench({ projectId: h.project, onExitState: exitState } as never);
  const hostProps = find(tree, (v) => v.type === ReflectionInputForm);
  const form = hostProps ? ReflectionInputForm(hostProps) : null;
  return { tree, form, hostProps, list: find(tree, (v) => typeof v.props.onAdopt === "function" && typeof v.props.change === "function") };
}
function button(form: ReactNode, name: string) { return find(form, (v) => v.type === Button && v.props["data-action"] === name); }
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function ready() {
  render().list.onAdopt(source);
  const { form } = render();
  find(form, (v) => v.type === Input).onChange({ target: { value: "Title" } });
  find(form, (v) => v.type === Input.TextArea).onChange({ target: { value: "Rationale" } });
  return render();
}
beforeEach(() => {
  h.states = []; h.refs = []; h.next = 0; h.refNext = 0; h.effects = []; h.listeners = {}; h.raw = ""; h.controller = null; h.pending = false; h.mode = "unknown"; h.writes = [];
  h.controllers.clear(); h.retained.clear(); h.project = "P"; h.session = "S";
  exitState.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal("location", { hash: "#/intelligence/reflections?project_id=P&reflection_prepare=1" });
  vi.stubGlobal("window", { addEventListener: (name: string, callback: () => void) => { (h.listeners[name] ||= []).push(callback); }, removeEventListener: () => {}, dispatchEvent: (event: Event) => { h.listeners[event.type]?.forEach((cb) => cb()); } });
  vi.stubGlobal("history", { pushState: (_data: unknown, _title: string, hash: string) => { location.hash = hash; } });
});
describe("actual reflection workbench parent callbacks", () => {
  it("clears the selection and navigates after the recovery host resets its controller", async () => {
    button(ready().form, "confirm-reflection-input").onClick(); await settle();
    expect(h.controller.snapshot().phase).toBe("unknown");
    const recovering = render(); h.mode = "success";
    await button(recovering.form, "retry-reflection-input").onClick();
    expect(render().hostProps.sources).toEqual([]);
    expect(location.hash).toContain("reflection_input=I");
  });
  it("rejects a pre-send adoption callback after the controller synchronously starts sending", async () => {
    const old = ready();
    button(old.form, "confirm-reflection-input").onClick();
    old.list.onAdopt({ ...source, reflection_id: "late" });
    await settle();
    expect(render().hostProps.sources).toEqual([source]);
  });
  it("rejects a pre-navigation adoption callback after route ABA without a rerender", () => {
    const old = ready();
    for (const setup of h.effects) setup();
    location.hash = "#/intelligence/reflections?project_id=P&reflection_receipt=other"; h.listeners.hashchange?.forEach((callback) => callback());
    location.hash = "#/intelligence/reflections?project_id=P&reflection_prepare=1"; h.listeners.hashchange?.forEach((callback) => callback());
    old.list.onAdopt({ ...source, reflection_id: "late" });
    expect(render().hostProps.sources).toEqual([source]);
  });
  it("registers the unresolved recovery host with the actual Intelligence internal-tab exit callback", async () => {
    button(ready().form, "confirm-reflection-input").onClick(); await settle(); render();
    for (const setup of h.effects) setup();
    expect(exitState).toHaveBeenCalledWith(expect.any(Function), true);
  });
  it("keeps the current-project unknown recovery host outside a mismatched deep-link branch", async () => {
    button(ready().form, "confirm-reflection-input").onClick(); await settle();
    location.hash = "#/intelligence/reflections?project_id=other";
    const current = render();
    expect(current.hostProps).toBeDefined();
    expect(button(current.form, "retry-reflection-input")).toBeDefined();
  });
  it("hides the previous project's selection and original when the actual session and project change", async () => {
    button(ready().form, "confirm-reflection-input").onClick(); await settle();
    const previous = h.controller;
    h.project = "Q"; h.session = "Q-session"; h.pending = false;
    location.hash = "#/intelligence/reflections?project_id=Q";
    const current = render();
    expect(previous.current()).toBe(false);
    expect(current.hostProps.sources).toEqual([]);
    expect(button(current.form, "retry-reflection-input")).toBeUndefined();
    expect(find(current.form, (value) => value.type === Input && value.props.value === "Title")).toBeUndefined();
  });
});
