import { webcrypto } from "node:crypto";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReflectionDetail } from "../../subapps/ai-foundation/src/pages/intelligence/reflections/ReflectionDetail";
import { ReflectionProblem } from "../../subapps/ai-foundation/src/pages/intelligence/reflections/ReflectionCommon";
import { reflectionDetailFixture, reflectionWithTaskFixture } from "./reflectionFixtures";
import { request } from "./http";
const h = vi.hoisted(() => ({
  states: [] as any[], refs: [] as any[], next: 0, refNext: 0,
  effects: [] as Array<() => void | (() => void)>, session: "S",
  error: null as unknown, data: null as any, listeners: {} as Record<string, Array<() => void>>,
  refetch: vi.fn(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: any) => {
    const index = h.next++;
    if (!(index in h.states)) h.states[index] = typeof initial === "function" ? initial() : initial;
    return [h.states[index], (value: any) => { h.states[index] = typeof value === "function" ? value(h.states[index]) : value; }];
  },
  useRef: (value: any) => (h.refs[h.refNext++] ||= { current: value }),
  useEffect: (effect: () => void | (() => void)) => h.effects.push(effect),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: h.data, error: h.error, isError: !!h.error, isPending: false, isFetching: false, refetch: h.refetch }),
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio")),
  projectSessionKey: () => h.session,
}));
vi.mock("./http", () => ({ request: vi.fn() }));
function find(node: ReactNode, type: unknown, predicate: (props: any) => boolean): any {
  if (Array.isArray(node)) return node.map((value) => find(value, type, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (node.type === type && predicate(node.props)) return node.props;
  return find(node.props.children, type, predicate) || find(node.props.action, type, predicate);
}
const adopt = vi.fn(), navigate = vi.fn();
function props() { return { projectId: "P", reflectionId: "R", onAdopt: adopt, canNavigate: () => true, onNavigate: navigate }; }
function render() { h.next = 0; h.refNext = 0; return ReflectionDetail(props()); }
function adoptButton() { return find(render(), Button, (value) => value["data-action"] === "adopt-reflection"); }
beforeEach(() => {
  h.states = []; h.refs = []; h.next = 0; h.refNext = 0; h.effects = [];
  h.session = "S"; h.error = null; h.data = reflectionDetailFixture(); h.listeners = {};
  adopt.mockReset(); vi.mocked(request).mockReset();
  navigate.mockReset();
  h.refetch.mockReset();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("location", { hash: "#/intelligence/reflections?project_id=P&reflection_receipt=R" });
  vi.stubGlobal("window", { addEventListener: (name: string, callback: () => void) => { (h.listeners[name] ||= []).push(callback); }, removeEventListener: () => {} });
});
describe("actual exact reflection adoption callbacks", () => {
  it("requires explicit adoption and rereads the current exact original before adding it", async () => {
    render();
    expect(adopt).not.toHaveBeenCalled();
    vi.mocked(request).mockResolvedValue(reflectionDetailFixture());
    await adoptButton().onClick();
    expect(adopt).toHaveBeenCalledWith(reflectionDetailFixture().selection_reference);
    expect(vi.mocked(request).mock.calls[0][0]).toBe("/api/v1/reflections/R");
  });
  it("hides cached claim content when current permission is denied", () => {
    h.error = new Error("HTTP 403: denied");
    const html = renderToStaticMarkup(createElement(ReflectionDetail, props()));
    expect(html).not.toContain("A claim");
    expect(html).not.toContain("A lesson");
    expect(html).toContain("reflections.forbidden");
    expect(adoptButton()).toBeUndefined();
  });
  it("hides an originally readable claim after a fresh actual adoption read is forbidden", async () => {
    vi.mocked(request).mockRejectedValue(new Error("HTTP 403: current exact denied"));
    await adoptButton().onClick();
    const html = renderToStaticMarkup(render());
    expect(html).not.toContain("A claim");
    expect(html).not.toContain("A lesson");
    expect(html).toContain("reflections.forbidden");
    expect(adoptButton()).toBeUndefined();
  });
  it.each(["storage", "hashchange", "popstate"])("keeps a fresh denial withdrawn after %s invalidates its async ticket for the same original", async (event) => {
    const button = adoptButton();
    h.effects[0]();
    vi.mocked(request).mockRejectedValue(new Error("HTTP 403: current exact denied"));
    await button.onClick();
    if (event !== "storage") location.hash += "&reflection_category=testing";
    h.listeners[event]?.forEach((callback) => callback());
    expect(h.error).toBeNull();
    expect(h.data.statement.title).toBe("A claim");
    expect(h.refetch).not.toHaveBeenCalled();
    const tree = render(), html = renderToStaticMarkup(tree);
    expect(html).toContain("reflections.forbidden");
    expect(html).not.toContain("A claim");
    expect(html).not.toContain("A lesson");
    expect(find(tree, Button, (value) => value["data-action"] === "adopt-reflection")).toBeUndefined();
    expect(find(tree, Button, (value) => value["data-action"] === "open-reflection-original")).toBeUndefined();
    expect(adopt).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
  it.each(["storage", "hashchange", "popstate"])("keeps an unavailable action result withdrawn across %s and restores it only after a fresh explicit reread", async (event) => {
    const detail = reflectionDetailFixture(), button = adoptButton();
    h.effects[0]();
    vi.mocked(request).mockResolvedValue({ ...detail, reflection: { ...detail.reflection, original_status: "restricted" }, available: false, unavailable_reason: "reflection_source_restricted", statement: null, source: null, verified: null, links: [], selection_reference: null });
    await button.onClick();
    if (event !== "storage") location.hash += "&reflection_category=testing";
    h.listeners[event]?.forEach((callback) => callback());
    const hidden = render();
    expect(renderToStaticMarkup(hidden)).toContain("reflections.forbidden");
    expect(renderToStaticMarkup(hidden)).not.toContain("A claim");
    expect(adoptButton()).toBeUndefined();
    h.refetch.mockResolvedValue({ data: detail, error: null });
    find(render(), Button, (value) => value.children === "reflections.refresh").onClick();
    for (let index = 0; index < 4; index++) await Promise.resolve();
    expect(adoptButton()).toBeDefined();
    expect(adopt).not.toHaveBeenCalled();
  });
  it("keeps a withdrawn original retryable when a storage event invalidates an in-flight reread", async () => {
    const button = adoptButton(); h.effects[0]();
    vi.mocked(request).mockRejectedValue(new Error("HTTP 403: denied"));
    await button.onClick();
    let resolve!: (value: unknown) => void;
    h.refetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
    find(render(), ReflectionProblem, () => true).onRetry();
    h.listeners.storage?.forEach((callback) => callback());
    expect(renderToStaticMarkup(render())).not.toContain("A claim");
    resolve({ data: reflectionDetailFixture(), error: null });
    for (let index = 0; index < 4; index++) await Promise.resolve();
    expect(adoptButton()).toBeUndefined();
    expect(find(render(), Button, (value) => value.children === "reflections.refresh")).toBeDefined();
    h.refetch.mockResolvedValue({ data: reflectionDetailFixture(), error: null });
    find(render(), Button, (value) => value.children === "reflections.refresh").onClick();
    for (let index = 0; index < 4; index++) await Promise.resolve();
    expect(adoptButton()).toBeDefined();
  });
  it("handles a canonical restricted shell without offering original navigation", () => {
    const detail = reflectionDetailFixture();
    h.data = { ...detail, reflection: { ...detail.reflection, original_status: "restricted", unavailable_reason: "reflection_source_restricted" }, available: false, unavailable_reason: "reflection_source_restricted", statement: null, source: null, verified: null, links: [], selection_reference: null };
    const html = renderToStaticMarkup(render());
    expect(html).toContain("reflections.forbidden");
    expect(html).not.toContain("A claim");
    expect(adoptButton()).toBeUndefined();
  });
  it("withdraws the old statement after an unavailable adoption read, until a successful explicit reread", async () => {
    const detail = reflectionDetailFixture();
    vi.mocked(request).mockResolvedValue({ ...detail, reflection: { ...detail.reflection, original_status: "restricted" }, available: false, unavailable_reason: "reflection_source_restricted", statement: null, source: null, verified: null, links: [], selection_reference: null });
    await adoptButton().onClick();
    expect(renderToStaticMarkup(render())).not.toContain("A claim");
    expect(adoptButton()).toBeUndefined();
    h.refetch.mockResolvedValue({ data: detail, error: null });
    await find(render(), Button, (value) => value.children === "reflections.refresh").onClick();
    expect(adoptButton()).toBeDefined();
    expect(adopt).not.toHaveBeenCalled();
  });
  it("keeps a denied statement hidden after a failed explicit reread despite cached query data", async () => {
    vi.mocked(request).mockRejectedValue(new Error("HTTP 403: denied"));
    await adoptButton().onClick();
    h.refetch.mockResolvedValue({ data: reflectionDetailFixture(), error: new Error("HTTP 503: unavailable") });
    await find(render(), ReflectionProblem, () => true).onRetry();
    expect(renderToStaticMarkup(render())).not.toContain("A claim");
    expect(adoptButton()).toBeUndefined();
  });
  it("does not adopt when a fresh exact response no longer permits selection", async () => {
    h.data = reflectionWithTaskFixture();
    vi.mocked(request).mockResolvedValue({ ...reflectionWithTaskFixture(), selection_reference: null, links: [{ kind: "task", id: "T", label: null, available: false, reason: "target_missing" }] });
    await adoptButton().onClick();
    expect(adopt).not.toHaveBeenCalled();
  });
  it("drops a late adoption after route ABA before React rerenders", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(request).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const button = adoptButton();
    for (const setup of h.effects) setup();
    const pending = button.onClick();
    location.hash = "#/intelligence/reflections?project_id=P&reflection_receipt=other";
    h.listeners.hashchange?.forEach((callback) => callback());
    location.hash = "#/intelligence/reflections?project_id=P&reflection_receipt=R";
    h.listeners.hashchange?.forEach((callback) => callback());
    resolve(reflectionDetailFixture());
    await pending;
    expect(adopt).not.toHaveBeenCalled();
  });
  it("keeps the first valid action after StrictMode setup cleanup setup", async () => {
    const button = adoptButton();
    const cleanup = h.effects[0]();
    if (typeof cleanup === "function") cleanup();
    h.effects[0]();
    vi.mocked(request).mockResolvedValue(reflectionDetailFixture());
    await button.onClick();
    expect(adopt).toHaveBeenCalledTimes(1);
  });
  it("does not adopt an exact original whose successful attempt changed", async () => {
    const detail = reflectionDetailFixture(); detail.verified.attempt_id = "A2"; detail.selection_reference.attempt_id = "A2";
    vi.mocked(request).mockResolvedValue(detail);
    await adoptButton().onClick();
    expect(adopt).not.toHaveBeenCalled();
  });
  it("checks a task's current project and requirement before actual navigation", async () => {
    h.data = reflectionWithTaskFixture();
    vi.mocked(request).mockResolvedValueOnce(reflectionWithTaskFixture()).mockResolvedValueOnce({ project_id: "P", task: { id: "T", req_id: "current-requirement" } });
    await find(render(), Button, (value) => value.children === "reflections.openSource").onClick();
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("requirement=current-requirement"));
    expect(vi.mocked(request).mock.calls[1][0]).toContain("/tasks/T");
  });
  it("does not navigate to an object returned from another project", async () => {
    h.data = reflectionWithTaskFixture();
    vi.mocked(request).mockResolvedValueOnce(reflectionWithTaskFixture()).mockResolvedValueOnce({ project_id: "Q", task: { id: "T", req_id: "foreign" } });
    await find(render(), Button, (value) => value.children === "reflections.openSource").onClick();
    expect(navigate).not.toHaveBeenCalled();
  });
});
