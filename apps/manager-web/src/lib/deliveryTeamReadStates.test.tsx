/** Actual consumer callbacks and state definitions; authored but not executed. */
import { isValidElement, type ReactNode } from "react";
import { Button, Empty, Skeleton } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryTeamMembers } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTeamMembers";
import { DeliveryMemberRuntimeOwner } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryMemberRuntime";
import { parseSchedulingRoute } from "./deliveryScheduling";
import type { DeliveryContext } from "./delivery";
const h = vi.hoisted(() => ({ hooks: [] as any[], next: 0, session: "original", result: {} as Record<string, any>, queries: [] as any[] }));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useState: (initial: any) => {
    const index = h.next++;
    if (!(index in h.hooks)) h.hooks[index] = typeof initial === "function" ? initial() : initial;
    return [h.hooks[index], (value: any) => { h.hooks[index] = typeof value === "function" ? value(h.hooks[index]) : value; }];
  },
  useRef: (initial: any) => { const index = h.next++; return h.hooks[index] ||= { current: initial }; },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => h.session }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: any) => {
  h.queries.push(options);
  return { isPending: false, isError: false, isFetching: false, refetch: vi.fn(), ...h.result[options.queryKey[0]] };
} }));
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<any>(node)) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.action)];
}
const person = { id: "user:one", name: "Alex", kind: "human", active: true, role: "Developer", tool: "" };
const context = { project: { id: "P" }, query_generation: 3, permissions: { write: true, configure: true } } as DeliveryContext;
const envelope = (items: any[]) => ({ project_id: "P", query_generation: 3, items, total: items.length, next_cursor: null });
const onEdit = vi.fn(), onTask = vi.fn(), onRoute = vi.fn(), onCalendar = vi.fn();
function render(memberId = "") {
  h.next = 0; h.queries = [];
  return DeliveryTeamMembers({ workspace: context, calendarFailed: false, sessionId: "S", onSaved: vi.fn(),
    route: { ...parseSchedulingRoute(location.hash), teamMemberId: memberId }, onEdit, onTask, onRoute,
    onCalendar, onRetryCalendar: vi.fn() });
}
beforeEach(() => {
  vi.clearAllMocks(); h.hooks = []; h.next = 0; h.session = "original";
  context.permissions.configure = true;
  h.result = {
    "delivery-members-page": { data: envelope([{ id: person.id, data: person, task_count: 1 }]) },
    "delivery-member-exact": { data: envelope([{ id: person.id, data: person }]) },
    "delivery-member-tasks": { data: envelope([{ id: "T", req_id: "R", title: "Owned task", owner_id: person.id }]) },
  };
  vi.stubGlobal("location", { hash: "#/dev-flow?view=team&project_id=P" });
  vi.stubGlobal("history", { state: null, replaceState: vi.fn(), pushState: vi.fn() });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
describe("team read states and exact navigation", () => {
  it("shows loading without an empty roster or a false zero", () => {
    h.result["delivery-members-page"] = { isPending: true };
    const tree = render();
    expect(nodes(tree).some((node) => node.type === Skeleton)).toBe(true);
    expect(nodes(tree).some((node) => node.type === Empty)).toBe(false);
    expect(nodes(tree).some((node) => node.type === "article")).toBe(false);
  });
  it.each([403, 404, 500])("suppresses cached roster and empty guidance on failed reads (%s)", (status) => {
    Object.assign(h.result["delivery-members-page"], { isError: true, error: new Error(`HTTP ${status}: unavailable`) });
    const tree = render();
    expect(nodes(tree).some((node) => node.type === "article" || node.type === Empty)).toBe(false);
  });
  it("does not call a failed task page empty or retain its cached task link", () => {
    h.result["delivery-member-tasks"].isPending = true; delete h.result["delivery-member-tasks"].data;
    expect(JSON.stringify(render(person.id))).not.toContain("deliveryTeam.noTasks");
    h.result["delivery-member-tasks"] = { data: envelope([{ id: "T", title: "Private cached task", owner_id: person.id }]), isError: true, error: new Error("HTTP 403") };
    const tree = render(person.id);
    expect(JSON.stringify(tree)).not.toContain("Private cached task");
    expect(JSON.stringify(tree)).not.toContain("deliveryTeam.noTasks");
  });
  it("rejects foreign generations and exact member identities before showing actions or loading assignments", () => {
    h.result["delivery-members-page"].data.query_generation = 2;
    h.result["delivery-member-exact"].data = envelope([{ id: "user:other", data: { ...person, id: "user:other" } }]);
    const tree = render(person.id);
    expect(nodes(tree).some((node) => node.type === "article")).toBe(false);
    expect(h.queries.find((query) => query.queryKey[0] === "delivery-member-tasks").enabled).toBe(false);
  });
  it("keeps the runtime recovery owner active for a missing member, then invalidates its old inspector identity", () => {
    h.result["delivery-member-exact"] = { isError: true, error: new Error("HTTP 404") };
    const tree = render("agent:gone");
    const recoveryOwner = nodes(tree).find((node) => node.type === DeliveryMemberRuntimeOwner)?.props;
    expect(recoveryOwner.member).toBeUndefined(); expect(recoveryOwner.isActive()).toBe(true);
    expect(h.queries.find((query) => query.queryKey[0] === "delivery-member-tasks").enabled).toBe(false);
    render("agent:other"); expect(recoveryOwner.isActive()).toBe(false);
  });
  it("checks the current configuration permission and exact member read in old calendar callbacks", () => {
    const tree = render(person.id);
    const calendar = nodes(tree).find((node) => node.type === Button && node.props.children === "deliveryTeam.configureCalendar");
    context.permissions.configure = false; render(person.id); calendar.props.onClick();
    expect(onCalendar).not.toHaveBeenCalled();
    context.permissions.configure = true;
    h.result["delivery-member-exact"] = { isError: true, error: new Error("HTTP 403") };
    render(person.id); calendar.props.onClick(); expect(onCalendar).not.toHaveBeenCalled();
  });
  it("preserves the project in people management and rejects callbacks from a different member or login", () => {
    const tree = render(person.id);
    expect(nodes(tree).find((node) => node.type === Button && node.props.href)?.props.href).toBe("#/projects/members?project_id=P");
    const task = nodes(tree).find((node) => node.type === Button && JSON.stringify(node.props.children).includes("Owned task"));
    render("user:other"); task.props.onClick(); expect(onTask).not.toHaveBeenCalled();
    h.session = "next-login";
    const detail = nodes(tree).find((node) => node.type === Button && node.props.children === "deliveryTeam.configureCalendar");
    detail.props.onClick(); expect(onCalendar).not.toHaveBeenCalled();
  });
});
