/** Authored against the actual picker callbacks. UNRUN until validation resumes. */
import { isValidElement, type ReactNode } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "antd";
import { DeliveryReferenceSelect, DeliveryReferencePicker, deliveryReferenceScope } from "../components/DeliveryReferenceSelect";
import { ProjectOwnerSelect } from "../components/DeliveryMemberIdentity";
import { invalidateDeliveryQueries } from "./deliveryQuery";
import { DeliveryRequirementIndex } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryQueryViews";
import { parseDeliveryRoute } from "./deliveryProjectInbox";
const h = vi.hoisted(() => ({ hooks: [] as any[], next: 0, session: "login-1", project: "P", query: null as any, selected: null as any, requests: [] as any[], effects: [] as (() => void)[] }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")),
  useId: () => "reference-status", useSyncExternalStore: (_subscribe: unknown, snapshot: () => string) => snapshot(),
  useRef: (initial: any) => { const i = h.next++; return h.hooks[i] ||= { current: initial }; },
  useState: (initial: any) => { const i = h.next++; if (!(i in h.hooks)) h.hooks[i] = initial; return [h.hooks[i], (value: any) => { h.hooks[i] = typeof value === "function" ? value(h.hooks[i]) : value; }]; },
  useEffect: (effect: () => void, _deps: any[]) => { h.effects.push(effect); },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./authStorage", async () => ({ ...(await vi.importActual<typeof import("./authStorage")>("./authStorage")), getProjectId: () => h.project, getToken: () => "controlled" }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => JSON.stringify([h.session, h.project]) }));
vi.mock("./deliveryQueryHooks", async () => ({ ...(await vi.importActual<typeof import("./deliveryQueryHooks")>("./deliveryQueryHooks")),
  useDeliveryMemberReferences: () => ({ members: [] }) }));
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: (options: any) => { h.requests.push(options); return h.query; },
  useQuery: (options: any) => { h.requests.push(options); return h.selected; },
  useQueries: () => [],
}));
const ref = (id: string, active = true) => ({ kind: "member" as const, id, label: id, task_count: 0, data: { id, active, kind: "human" } });
const page = (items = [ref("user:a")], generation = 3) => ({ project_id: "P", query_generation: generation, version: 7, items, total: items.length, limit: 50, next_cursor: null, as_of: "now" });
const changed = vi.fn();
function nodes(tree: ReactNode): any[] { if (Array.isArray(tree)) return tree.flatMap(nodes); if (!isValidElement<any>(tree)) return [];
  return [tree, ...nodes(tree.props.children), ...nodes(tree.props.action)]; }
const select = (tree: ReactNode) => nodes(tree).find((node) => node.type === Select)!.props;
function render(props: Record<string, any> = {}) { h.next = 0; h.requests = [];
  return DeliveryReferencePicker({ kind: "member", projectId: "P", scope: deliveryReferenceScope("member", 3), queryGeneration: 3, onChange: changed,
    options: [{ value: "", label: "Clear" }], ...props }); }
beforeEach(() => { h.hooks = []; h.next = 0; h.requests = []; h.effects = []; h.session = "login-1"; h.project = "P"; changed.mockClear();
  vi.stubGlobal("location", { hash: "#/dev-flow?project_id=P" });
  h.query = { data: { pages: [page()] }, isError: false, isPending: false, isFetching: false, hasNextPage: false, fetchNextPage: vi.fn() };
  h.selected = { data: undefined, isError: false, isPending: false, isFetching: false };
});
afterEach(() => vi.unstubAllGlobals());
describe("reference picker consumers", () => {
  it("connects the public field to a scope-keyed picker and resets its identity on login/project/route changes", () => {
    const first = DeliveryReferenceSelect({ kind: "member", queryGeneration: 3 }); expect(first.type).toBe(DeliveryReferencePicker);
    h.session = "login-2"; const next = DeliveryReferenceSelect({ kind: "member", queryGeneration: 3 }); expect(next.key).not.toBe(first.key);
    location.hash += "&task=T"; expect(DeliveryReferenceSelect({ kind: "member", queryGeneration: 3 }).key).not.toBe(next.key);
  });
  it("rejects stale callbacks immediately after a route, project or login changes", () => {
    const old = select(render()); h.session = "login-2"; old.onChange("user:a"); expect(changed).not.toHaveBeenCalled();
    h.session = "login-1"; h.project = "Q"; old.onChange("user:a"); expect(changed).not.toHaveBeenCalled();
    h.project = "P"; location.hash += "&task=other"; old.onChange("user:a"); expect(changed).not.toHaveBeenCalled();
  });
  it("keeps both real picker query keys discoverable by project command invalidation", () => {
    render({ value: "user:old" }); const keys = h.requests.map((entry) => entry.queryKey), matched: unknown[] = [];
    const client = { invalidateQueries: ({ predicate }: any) => { for (const queryKey of keys) if (predicate({ queryKey })) matched.push(queryKey); return Promise.resolve(); } };
    void invalidateDeliveryQueries(client as any, "P"); expect(matched).toEqual(keys);
    matched.length = 0; void invalidateDeliveryQueries(client as any, "Q"); expect(matched).toEqual([]);
  });
  it("does not reselect cached remote choices while invalidation is refreshing them", () => {
    const old = select(render()); h.query.isFetching = true; render(); old.onChange("user:a"); expect(changed).not.toHaveBeenCalled();
  });
  it("distinguishes disabled scope from loading and missing index from unpinned reads", () => {
    expect(deliveryReferenceScope("member")).not.toBe(deliveryReferenceScope("member", null));
    h.project = "Q"; const inactive = render(); expect(select(inactive).disabled).toBe(true);
    expect(nodes(inactive).some((node) => node.props.title === "deliveryQuery.referenceScopeUnavailable")).toBe(true);
    h.project = "P"; render({ queryGeneration: null, scope: deliveryReferenceScope("member", null) });
    expect(h.requests.every((entry) => entry.enabled === false)).toBe(true);
  });
  it("blocks cached choices after read failure but still permits an explicit clear", () => {
    const old = select(render()); h.query.isError = true; const failed = render({ value: "user:old" });
    old.onChange("user:a"); expect(changed).not.toHaveBeenCalled(); select(failed).onChange(""); expect(changed).toHaveBeenCalledWith("");
    expect(nodes(failed).some((node) => node.props.title === "deliveryQuery.referenceReadFailed")).toBe(true);
  });
  it("shows exact selected-record failure outside the popup and never adds that cached record", () => {
    h.selected = { data: page([ref("user:old")]), isError: true, isPending: false, isFetching: false };
    const tree = render({ value: "user:old" }); expect(select(tree).options.find((o: any) => o.value === "user:old").disabled).toBe(true);
    expect(nodes(tree).some((node) => node.props.description === "deliveryQuery.referenceSelectedFailed")).toBe(true);
    select(tree).onChange("user:a"); expect(changed).toHaveBeenCalledWith("user:a");
  });
  it("labels an unresolved selected read as checking instead of declaring it unavailable", () => {
    h.selected.isPending = true; h.selected.isFetching = true;
    const tree = render({ value: "user:waiting" }), option = select(tree).options.find((o: any) => o.value === "user:waiting");
    expect(option.label).toContain("deliveryQuery.referenceChecking"); expect(option.label).not.toContain("deliveryQuery.unavailable");
    expect(nodes(tree).some((node) => node.props.children === "deliveryQuery.referenceSelectedLoading")).toBe(true);
  });
  it("restarts at the first page for both candidate and exact reads while retaining the selected value", () => {
    h.query.isError = true; const tree = render({ value: "user:old" }), before = h.requests.map((q) => q.queryKey);
    nodes(tree).find((node) => typeof node.props.onClick === "function" && node.props.children === "deliveryQuery.retry").props.onClick();
    const after = render({ value: "user:old" }); expect(select(after).value).toBe("user:old");
    expect(h.requests[0].queryKey).not.toEqual(before[0]); expect(h.requests[1].queryKey).not.toEqual(before[1]); expect(h.requests[0].initialPageParam).toBe("");
  });
  it("does not let an old more-button request the previous search after the current search changes", () => {
    h.query.hasNextPage = true; const first = select(render()), menu = first.popupRender(null);
    const more = nodes(menu).find((node) => node.props.children === "deliveryQuery.more")!.props;
    first.onSearch("new search"); render(); more.onClick(); expect(h.query.fetchNextPage).not.toHaveBeenCalled();
  });
  it("reads only remote selected IDs and keeps generated draft dependencies locally selectable", () => {
    const tree = render({ kind: "task", scope: deliveryReferenceScope("task", 3), multiple: true, value: ["generated-1", "T-real"],
      options: [{ value: "generated-1", label: "Preview task", local: true }] });
    expect(h.requests[1].queryKey.at(-1)).toEqual(["T-real"]); select(tree).onChange(["generated-1"]); expect(changed).toHaveBeenCalledWith(["generated-1"]);
  });
  it("removes unavailable dependencies through a real visible action without enabling addition", () => {
    const tree = render({ multiple: true, value: ["user:deleted", "user:a"] });
    const remove = nodes(tree).find((node) => node.props["aria-label"] === "deliveryQuery.referenceRemove")!.props;
    expect(select(tree).options.find((option: any) => option.value === "user:deleted").disabled).toBe(true);
    remove.onClick(); expect(changed).toHaveBeenCalledWith(["user:a"]); remove.onClick(); expect(changed).toHaveBeenCalledTimes(1);
    select(tree).onChange(["user:deleted", "user:a"]); expect(changed).toHaveBeenCalledTimes(1);
  });
  it("provides an explicit remove action for deselected local draft dependencies even when remote reads fail", () => {
    h.query.isError = true; const tree = render({ kind: "task", scope: deliveryReferenceScope("task", 3), multiple: true, value: ["generated-1"],
      options: [{ value: "generated-1", label: "Deselected task", local: true, disabled: true }] });
    nodes(tree).find((node) => node.props["aria-label"] === "deliveryQuery.referenceRemove")!.props.onClick();
    expect(changed).toHaveBeenCalledWith([]); select(tree).onChange(["generated-1"]); expect(changed).toHaveBeenCalledTimes(1);
  });
  it("does not use labels from the supplied roster as permission and differentiates all-owner filter wording", () => {
    const tree = ProjectOwnerSelect({ value: "user:missing", members: [], emptyLabel: "All owners" });
    expect(tree.type).toBe(DeliveryReferenceSelect); expect(tree.props.options[0].label).toBe("All owners");
    expect(tree.props.filter({ active: true, kind: "tool" })).toBe(false); expect(tree.props.filter({ active: true, kind: "agent" })).toBe(true);
    expect(tree.props.formatLabel(ref("user:a"))).toContain("user:a");
  });
  it("permits inactive owners only for explicit read-only filtering, with a visible inactive label", () => {
    const assign = ProjectOwnerSelect({}), filter = ProjectOwnerSelect({ purpose: "filter", emptyLabel: "All owners" });
    const inactive = ref("user:inactive", false);
    expect(assign.props.filter(inactive.data)).toBe(false); expect(filter.props.filter(inactive.data)).toBe(true);
    expect(filter.props.formatLabel(inactive)).toContain("deliveryTeam.inactive"); expect(filter.key).not.toBe(assign.key);
    expect(filter.props.filter({ active: false, kind: "tool" })).toBe(false);
  });
  it("connects the real requirement list/board filter to read-only owner purpose and resets paging on selection", () => {
    vi.stubGlobal("history", { state: null, replaceState: vi.fn() }); h.next = 0; const onRoute = vi.fn();
    const tree = DeliveryRequirementIndex({ projectId: "P", sessionId: "session", view: "list", queryGeneration: 3,
      route: parseDeliveryRoute(location.hash), onRoute, onOpen: vi.fn() });
    const owner = nodes(tree).find((node) => node.type === ProjectOwnerSelect)!;
    expect(owner.props.purpose).toBe("filter"); expect(owner.props.emptyLabel).toBe("delivery.allOwners");
    owner.props.onChange("user:inactive"); expect(onRoute).toHaveBeenCalledWith({ owner: "user:inactive", page: 1, cursor: "" });
  });
});
