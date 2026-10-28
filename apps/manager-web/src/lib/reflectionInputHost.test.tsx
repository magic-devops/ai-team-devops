import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Alert, Button, Input, Modal } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReflectionInputHost } from "../../subapps/ai-foundation/src/pages/intelligence/reflections/ReflectionInputHost";
import { ReflectionProblem } from "../../subapps/ai-foundation/src/pages/intelligence/reflections/ReflectionCommon";
import { reflectionDigest, reflectionDetailFixture } from "./reflectionFixtures";

const h = vi.hoisted(() => ({
  states: [] as any[], refs: [] as any[], next: 0, refNext: 0,
  raw: "", controller: null as any, session: "S", mode: "unknown",
  writes: [] as any[], context: null as any, options: [] as any[],
  pending: false,
  storageFails: false,
  preview: "available",
  sourceIds: ["R"],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: any) => {
    const index = h.next++;
    if (!(index in h.states)) h.states[index] = typeof initial === "function" ? initial() : initial;
    return [h.states[index], (value: any) => { h.states[index] = typeof value === "function" ? value(h.states[index]) : value; }];
  },
  useRef: (value: any) => (h.refs[h.refNext++] ||= { current: value }),
  useEffect: () => {},
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query")),
  useQuery: (options: any) => {
    h.options.push(options);
    return { data: h.context, error: h.context ? null : new Error("HTTP 503: current context unavailable"), isError: !h.context, isPending: false, isFetching: false, refetch: vi.fn() };
  },
  useQueries: (options: any) => {
    h.options.push(...options.queries);
    return options.queries.map((query: any, index: number) => {
      const detail = reflectionDetailFixture(h.preview === "mismatch" ? "other" : query.queryKey[3]);
      if (h.preview === "digest") detail.source.digest = "b".repeat(64);
      if (h.preview === "attempt") detail.verified.attempt_id = "A2";
      const missing = h.preview === "missing" || h.preview === "second-missing" && index === 1;
      return { data: missing ? undefined : detail, error: h.preview === "forbidden" ? new Error("HTTP 403: denied") : null, isPending: missing, refetch: vi.fn() };
    });
  },
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio")),
  projectSessionKey: () => h.session,
}));
vi.mock("./reflectionCommand", async () => {
  const actual = await vi.importActual<typeof import("./reflectionCommand")>("./reflectionCommand");
  return {
    ...actual,
    useReflectionInputCommand: (_projectId: string, onPending: (value: boolean) => void) => {
      const controller = (h.controller ||= actual.createReflectionInputController({
        projectId: "P", scope: h.session, currentScope: () => h.session,
        load: () => h.raw, save: (value) => { if (h.storageFails) throw new Error("storage full"); h.raw = value; }, onPending,
        send: async (original) => {
          h.writes.push(structuredClone(original));
          if (h.mode === "unknown") throw new Error("network lost after possible commit");
          return {
            project_id: "P", action: "reflection.input.create", resource: { kind: "reflection_input", id: "I" },
            affected_refs: [{ kind: "reflection_input", id: "I" }], result: { status: "prepared", source_count: 1 },
            applied_version: 8, version: 8, query_generation: 4, replayed: true,
          };
        },
      }));
      const state = controller.snapshot();
      return { ...controller, state, locked: !["idle", "refused"].includes(state.phase), unresolved: ["sending", "unknown"].includes(state.phase) };
    },
  };
});
function find(node: ReactNode, type: unknown, predicate: (props: any) => boolean = () => true): any {
  if (Array.isArray(node)) return node.map((value) => find(value, type, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (node.type === type && predicate(node.props)) return node.props;
  return find(node.props.children, type, predicate) || find(node.props.footer, type, predicate) || find(node.props.action, type, predicate);
}
const saved = vi.fn(), closed = vi.fn();
function render() {
  h.next = 0; h.refNext = 0;
  return ReflectionInputHost({
    projectId: "P", sessionId: h.session,
    sources: h.sourceIds.map((reflection_id) => ({ reflection_id, source_digest: reflectionDigest, attempt_id: "A" })),
    onSaved: saved, onClose: closed, onPending: (value) => { h.pending = value; },
  });
}
const action = (tree: ReactNode, name: string) => find(tree, Button, (props) => props["data-action"] === name);
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
async function ready() {
  find(render(), Input, (props) => props["aria-label"] === "reflections.inputTitle").onChange({ target: { value: "Reviewed input" } });
  find(render(), Input.TextArea, (props) => props["aria-label"] === "reflections.rationale").onChange({ target: { value: "Reviewed rationale" } });
  return render();
}
beforeEach(() => {
  h.states = []; h.refs = []; h.next = 0; h.refNext = 0; h.raw = ""; h.controller = null;
  h.session = "S"; h.mode = "unknown"; h.writes = []; h.options = []; h.pending = false;
  h.storageFails = false;
  h.preview = "available";
  h.sourceIds = ["R"];
  h.context = { project_id: "P", version: 7, query_generation: 3, query_state: { status: "ready" }, permissions: { write: true } };
  saved.mockReset(); closed.mockReset();
});
describe("actual reflection input host callbacks", () => {
  it("retains an unknown original and restores it even when all current reads are unavailable", async () => {
    const tree = await ready();
    const oldEdit = find(tree, Input, (props) => props["aria-label"] === "reflections.inputTitle").onChange;
    action(tree, "confirm-reflection-input").onClick();
    await settle();
    expect(h.writes).toHaveLength(1);
    const first = structuredClone(h.writes[0]);
    oldEdit({ target: { value: "Late replacement must not apply" } });
    expect(find(render(), Modal)).toMatchObject({ open: true, closable: false, keyboard: false, maskClosable: false });
    expect(find(render(), Alert, (props) => props.title === "reflections.unknown")).toBeDefined();
    h.states = []; h.refs = []; h.controller = null; h.context = null; h.mode = "success"; h.options = [];
    action(render(), "retry-reflection-input").onClick();
    await settle();
    expect(h.options.every((options) => options.enabled === false)).toBe(true);
    expect(h.writes[1]).toEqual(first);
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ resource: { kind: "reflection_input", id: "I" } }));
    expect(h.pending).toBe(false);
  });
  it("does not call onSaved or allow a replacement original on a second unknown outcome", async () => {
    action(await ready(), "confirm-reflection-input").onClick();
    await settle();
    action(render(), "retry-reflection-input").onClick();
    await settle();
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]).toEqual(h.writes[0]);
    expect(h.pending).toBe(true);
    expect(saved).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });
  it("locks two actual confirm callbacks synchronously", async () => {
    const tree = await ready();
    const click = action(tree, "confirm-reflection-input").onClick;
    click(); click();
    await settle();
    expect(h.writes).toHaveLength(1);
    expect(h.pending).toBe(true);
  });
  it("sends nothing through the actual confirm callback if durable storage fails", async () => {
    const tree = await ready(); h.storageFails = true;
    action(tree, "confirm-reflection-input").onClick();
    await settle();
    expect(h.writes).toHaveLength(0);
    expect(find(render(), Alert, (props) => props.title === "reflections.storageFailed")).toBeDefined();
    expect(saved).not.toHaveBeenCalled();
  });
  it("rejects an old actual confirm callback after the account changes", async () => {
    const tree = await ready(); h.session = "other";
    action(tree, "confirm-reflection-input").onClick();
    await settle();
    expect(h.writes).toHaveLength(0);
    expect(saved).not.toHaveBeenCalled();
  });
  it("does not treat cached current context as write permission after a current read error", async () => {
    const tree = await ready(); h.context = null;
    action(render(), "confirm-reflection-input").onClick();
    await settle();
    expect(h.writes).toHaveLength(0);
    expect(action(tree, "confirm-reflection-input")).toBeDefined();
  });
  it("refuses actual confirmation until every selected original has a current matching preview", async () => {
    h.preview = "missing";
    const tree = await ready();
    action(tree, "confirm-reflection-input").onClick(); await settle();
    expect(h.writes).toHaveLength(0);
    expect(action(tree, "confirm-reflection-input").disabled).toBe(true);
  });
  it("hides the old readable preview and blocks actual confirmation after current permission denial", async () => {
    await ready(); h.preview = "forbidden";
    const tree = render();
    action(tree, "confirm-reflection-input").onClick(); await settle();
    expect(h.writes).toHaveLength(0);
    const problem = find(tree, ReflectionProblem);
    expect(problem).toBeDefined();
    const html = renderToStaticMarkup(createElement(ReflectionProblem, problem));
    expect(html).toContain("reflections.forbidden");
    expect(html).not.toContain("A claim");
    expect(JSON.stringify(tree)).not.toContain("A claim");
  });
  it("does not confirm when a preview belongs to a different selected original", async () => {
    h.preview = "mismatch";
    action(await ready(), "confirm-reflection-input").onClick(); await settle();
    expect(h.writes).toHaveLength(0);
  });
  it.each(["digest", "attempt"])("refuses confirmation when the current preview %s differs from the selected reference", async (mismatch) => {
    h.preview = mismatch;
    const tree = await ready();
    action(tree, "confirm-reflection-input").onClick(); await settle();
    expect(h.writes).toHaveLength(0);
    expect(action(tree, "confirm-reflection-input").disabled).toBe(true);
  });
  it("requires an independent matching preview for every selected original", async () => {
    h.sourceIds = ["R", "R2"]; h.preview = "second-missing";
    const tree = await ready();
    expect(h.options.some((options) => options.queryKey?.[0] === "reflection-input-preview" && options.queryKey?.[3] === "R2")).toBe(true);
    action(tree, "confirm-reflection-input").onClick(); await settle();
    expect(h.writes).toHaveLength(0);
  });
});
