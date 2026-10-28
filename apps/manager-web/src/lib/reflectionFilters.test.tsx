import { isValidElement, type ReactNode } from "react";
import { Button, Input } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReflectionWorkbench } from "../../subapps/ai-foundation/src/pages/intelligence/reflections/ReflectionWorkbench";
import { reflectionPageFixture } from "./reflectionFixtures";
const h = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], next: 0, refNext: 0 }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), useState: (initial: any) => { const index = h.next++; if (!(index in h.states)) h.states[index] = typeof initial === "function" ? initial() : initial; return [h.states[index], (value: any) => { h.states[index] = typeof value === "function" ? value(h.states[index]) : value; }]; }, useRef: (v: any) => (h.refs[h.refNext++] ||= { current: v }), useEffect: () => {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-query", async () => ({ ...(await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query")), useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: () => ({ data: reflectionPageFixture(), error: null, isPending: false, isFetching: false, refetch: vi.fn() }) }));
vi.mock("./projectPortfolio", async () => ({ ...(await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio")), projectSessionKey: () => "S" }));
vi.mock("./executionExitGuard", () => ({ useExecutionExitGuard: () => ({ pending: false, blocked: false, canNavigate: () => true, setPending: () => {} }) }));
vi.mock("./reflectionCommand", async () => ({ ...(await vi.importActual<typeof import("./reflectionCommand")>("./reflectionCommand")), useReflectionInputCommand: () => ({ current: () => true, snapshot: () => ({ phase: "idle" }), state: { phase: "idle" }, locked: false, unresolved: false }) }));
function find(node: ReactNode, predicate: (value: any) => boolean): any {
  if (Array.isArray(node)) return node.map((value) => find(value, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (predicate(node)) return node;
  return find(node.props.children, predicate);
}
function render() {
  h.next = 0; h.refNext = 0;
  const outer = ReflectionWorkbench({ projectId: "P" });
  const lists = find(outer, (v) => typeof v.props.onAdopt === "function" && typeof v.props.change === "function");
  return lists.type(lists.props);
}
const input = (tree: ReactNode, name: string) => find(tree, (v) => v.type === Input && v.props["aria-label"] === "reflections." + name).props;
const apply = (tree: ReactNode) => find(tree, (v) => v.type === Button && v.props.children === "reflections.apply").props.onClick();
beforeEach(() => {
  h.states = []; h.refs = []; h.next = 0; h.refNext = 0;
  vi.stubEnv("TZ", "Asia/Shanghai");
  vi.stubGlobal("location", { hash: "#/intelligence/reflections?project_id=P" });
  vi.stubGlobal("window", { dispatchEvent: () => {} });
  vi.stubGlobal("history", { pushState: (_data: unknown, _title: string, hash: string) => { location.hash = hash; } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("actual reflection time filter callbacks", () => {
  it("converts a chosen local time into a timezone-bearing canonical occurrence boundary", () => {
    input(render(), "from").onChange({ target: { value: "2026-10-20T08:30" } });
    apply(render());
    expect(new URLSearchParams(location.hash.split("?")[1]).get("reflection_from")).toBe("2026-10-20T00:30:00.000Z");
    expect(input(render(), "from").type).toBe("datetime-local");
  });
  it("clears a chosen boundary without sending a fabricated empty timestamp", () => {
    input(render(), "from").onChange({ target: { value: "2026-10-20T08:30" } }); apply(render());
    input(render(), "from").onChange({ target: { value: "" } }); apply(render());
    expect(new URLSearchParams(location.hash.split("?")[1]).has("reflection_from")).toBe(false);
  });
  it("keeps the current window when the chosen exclusive end is before its start", () => {
    const tree = render();
    input(tree, "from").onChange({ target: { value: "2026-10-20T08:30" } });
    input(render(), "to").onChange({ target: { value: "2026-10-19T08:30" } });
    apply(render());
    expect(location.hash).toBe("#/intelligence/reflections?project_id=P");
  });
});
