import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Drawer } from "antd";
import { DeliveryTaskDetail, TaskDetailContent } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import { DeliveryWorkbench } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryWorkbench";
import { DeliveryRequirementTasks } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryQueryViews";
import { DeliveryExecutionPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionPanel";
import { DeliveryTaskPlanMaintenance } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanMaintenance";
import { DeliveryTaskPlanning } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanning";
import { DeliveryTaskDefinitionHost, TaskDefinitionRecoveryOwner } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDefinitionHost";
import { TaskExternalRecoveryOwner } from "../../subapps/ai-rd-center/src/pages/delivery/TaskExternalRecovery";
import { DeliveryCollaboration } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDiscussionAdoption";
import { DeliveryDesignContextPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDesignContextPanel";
import { DeliveryTaskSubmissionPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskSubmissionPanel";
import { DeliveryManualReviewPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryManualReviewPanel";
import { ExternalWorkOrderPanel } from "../components/ExternalWorkOrderPanel";
import { TaskDispatchHost } from "../../subapps/ai-rd-center/src/pages/delivery/TaskDispatchHost";
import { closeTaskDispatchRoute, taskDispatchRouteEvent } from "./taskDispatchRoute";
import { closeTaskDefinitionRoute, taskDefinitionRouteClosedEvent } from "./taskDefinitionRoute";
import { useDeliveryDraftState } from "./useDeliveryDraftState";
import { setSession, USER_KEY } from "./authStorage";
import { request } from "./http";
import type { DeliveryTaskData } from "./delivery";

const h = vi.hoisted(() => ({ hooks: {} as Record<string, any[]>, component: "", next: 0, effects: [] as Array<() => void>, scope: "scope-a", task: {} as any, context: {} as any, options: [] as any[], storage: {} as Record<string, string>,
  taskEditPending: undefined as undefined | ((value: boolean) => void), recoveryIds: [] as string[], externalIds: { submission: [] as string[], "work-order": [] as string[] }, externalDiscoveryError: false, discoveryError: false, taskEdit: { state: { phase: "idle" }, snapshot: () => ({ phase: "idle" }), current: () => true, reset: vi.fn(), run: vi.fn(), locked: false },
  invalidate: vi.fn(), refetch: vi.fn(), mutation: vi.fn(), queue: { state: { phase: "idle" }, snapshot: () => ({ phase: "idle" }), current: () => true, reset: vi.fn(), locked: false },
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = (initial: any) => { const values = h.hooks[h.component] ||= [], index = h.next++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values, index] as const; };
  const memo = (callback: () => unknown, deps: unknown[]) => { const [values, index] = slot(undefined); if (!values[index] || deps.some((value, i) => value !== values[index].deps[i])) values[index] = { value: callback(), deps }; return values[index].value; };
  return { ...actual,
    useState: (initial: any) => { const [values, index] = slot(initial); return [values[index], (next: any) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef: (initial: any) => { const [values, index] = slot({ current: initial }); return values[index]; },
    useMemo: memo, useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const [values, index] = slot(undefined), previous = values[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { const entry = { effect: true, make: effect, deps, cleanup: undefined as undefined | (() => void) }; values[index] = entry; h.effects.push(() => { previous?.cleanup?.(); entry.cleanup = effect() || undefined; }); } },
  };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-US" } }) }));
vi.mock("./projectPortfolio", async () => ({ ...await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio"), projectSessionKey: () => h.scope }));
vi.mock("./authStorage", async () => ({ ...await vi.importActual<typeof import("./authStorage")>("./authStorage"), getProjectId: () => "P", getToken: () => "controlled" }));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("./taskEditCommand", async () => ({ ...await vi.importActual<typeof import("./taskEditCommand")>("./taskEditCommand"),
  useTaskEditCommand: (_project: string, _task: string, _session: string, onPending: (value: boolean) => void) => { h.taskEditPending = onPending; return h.taskEdit; },
  discoverTaskEditRecovery: () => { if (h.discoveryError) throw new Error("retainedOriginalUnavailable"); return h.recoveryIds; }, taskEditRecoveryPending: (_project: string, taskId: string) => h.recoveryIds.includes(taskId),
}));
vi.mock("./deliveryQuery", async () => ({ ...await vi.importActual<typeof import("./deliveryQuery")>("./deliveryQuery"), fetchDeliveryTaskEditData: async () => structuredClone(h.task.data) }));
vi.mock("./deliveryTaskSubmission", async () => ({ ...await vi.importActual<typeof import("./deliveryTaskSubmission")>("./deliveryTaskSubmission"), discoverSubmissionRecovery: () => { if (h.externalDiscoveryError) throw new Error("retainedOriginalUnavailable"); return h.externalIds.submission; }, externalDeliveryRecoveryPending: (_p: string, task: string) => h.externalIds.submission.includes(task) }));
vi.mock("./externalWorkOrderCommand", async () => ({ ...await vi.importActual<typeof import("./externalWorkOrderCommand")>("./externalWorkOrderCommand"), discoverWorkOrderRecovery: () => { if (h.externalDiscoveryError) throw new Error("retainedOriginalUnavailable"); return h.externalIds["work-order"]; }, workOrderRecoveryPending: (_p: string, task: string) => h.externalIds["work-order"].includes(task) }));
vi.mock("./executionDispatchCommand", async () => ({ ...await vi.importActual<typeof import("./executionDispatchCommand")>("./executionDispatchCommand"), useExecutionDispatchCommand: () => h.queue }));
vi.mock("./deliveryAttention", () => ({ useDeliveryInboxQuery: () => ({ data: undefined }), useDeliveryInboxNavigation: () => ({ open: vi.fn(), retry: vi.fn() }) }));
vi.mock("../components/DeliveryMemberIdentity", async () => ({ ...await vi.importActual<typeof import("../components/DeliveryMemberIdentity")>("../components/DeliveryMemberIdentity"), useMemberIdentity: () => (_members: unknown, id: string) => id }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => { h.options.push(options); return options.queryKey[0] === "delivery-task-detail" ? h.task : options.queryKey[0] === "delivery-context" ? h.context : { data: undefined, error: null, isError: false, isPending: false, refetch: h.refetch }; },
  useInfiniteQuery: () => ({ data: { pages: [{ items: [], total: 0 }] }, error: null, isError: false, isPending: false, refetch: h.refetch }),
  useQueryClient: () => ({ getQueryData: (key: any[]) => key[0] === "delivery-context" ? h.context.data : h.task.data, invalidateQueries: h.invalidate }),
  useMutation: () => ({ isPending: false, mutateAsync: h.mutation }),
}));

const task = { project: { id: "P", name: "Project", status: "active" }, permissions: { write: true, approve: true, configure: true }, version: 7, query_generation: 1, planning_basis: "planning-basis", members: [], dependencies: [], requirement: null,
  task: { id: "T", title: "Task being edited", req_id: "", description: "Original task", owner_id: "", estimate: "", basis: "task-basis", status: "pending", recorded_status: "pending", acceptance_criteria: [], acceptance: { available: true, criteria: [], sources: [] }, execution_gate: { eligible: true, reasons: [] } },
} as unknown as DeliveryTaskData;
function frame<T>(name: string, render: () => T) { h.component = name; h.next = 0; h.effects = []; const tree = render(); h.effects.forEach((effect) => effect()); return tree; }
function strictEffectCycle(name: string) { const effects = (h.hooks[name] || []).filter((value) => value?.effect); effects.forEach((value) => value.cleanup?.()); effects.forEach((value) => { value.cleanup = value.make() || undefined; }); }
function unmount(name: string) { for (const value of h.hooks[name] || []) if (value?.effect) value.cleanup?.(); delete h.hooks[name]; }
function nodes(node: ReactNode): ReactElement<any>[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...["children", "action", "description", "footer"].flatMap((key) => nodes(node.props[key])), ...(node.props.items || []).flatMap((value: any) => nodes(value.children))]; }
function find(tree: ReactNode, type: unknown) { return nodes(tree).find((node) => node.type === type)!; }
function host(props: Record<string, unknown> = {}) { return frame("task", () => DeliveryTaskDetail({ projectId: "P", taskId: "T", sessionId: "s", ...props })); }
function workbench() { const shell = frame("shell", () => DeliveryWorkbench()), project = nodes(shell).find((node) => typeof node.type === "function" && node.type.name === "ProjectDelivery")!; return frame("workbench", () => (project.type as (props: any) => ReactNode)(project.props)); }
function beforeUnload() { const event = new Event("beforeunload", { cancelable: true }); Object.defineProperty(event, "returnValue", { writable: true, value: "" }); window.dispatchEvent(event); return event; }
beforeEach(() => {
  h.hooks = {}; h.effects = []; h.recoveryIds = []; h.discoveryError = false; h.taskEditPending = undefined; h.options = []; h.storage = {}; h.scope = "scope-a"; h.invalidate.mockReset(); h.refetch.mockReset();
  h.externalIds = { submission: [], "work-order": [] }; h.externalDiscoveryError = false;
  vi.mocked(request).mockReset();
  const local = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value), removeItem: (key: string) => local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => h.storage[key] ?? null, setItem: (key: string, value: string) => { h.storage[key] = value; } });
  const location = { href: "http://local/#/dev-flow?view=team&task=T&project_id=P", hash: "#/dev-flow?view=team&task=T&project_id=P", pathname: "/", search: "" };
  const target = Object.assign(new EventTarget(), { location, document: new EventTarget(), history: { state: null, replaceState: vi.fn((_state: unknown, _title: string, href: string) => { location.href = href; location.hash = href.includes("#") ? href.slice(href.indexOf("#")) : ""; }), pushState: vi.fn() } });
  vi.stubGlobal("window", target); vi.stubGlobal("location", location); vi.stubGlobal("history", target.history); vi.stubGlobal("requestAnimationFrame", (_fn: unknown) => 1); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  setSession("controlled", "P", "tenant-a"); localStorage.setItem(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-a" }));
  h.task = { data: structuredClone(task), error: null, isError: false, isPending: false, refetch: h.refetch };
  h.context = { data: { project_id: "P", project: task.project, permissions: task.permissions, query_state: { status: "ready" }, version: 7, query_generation: 1 }, error: null, isError: false, isPending: false, refetch: h.refetch };
});
afterEach(() => { Object.keys(h.hooks).forEach(unmount); vi.unstubAllGlobals(); });

describe("task draft navigation protection", () => {
  for (const kind of ["submission", "work-order"] as const) for (const failed of ["pending", "error", "old-schema", "requirement"]) {
    it(`retains ${kind} recovery outside the ${failed} context without current GET authority`, () => {
      h.externalIds[kind] = ["T"];
      if (failed === "pending") h.context.isPending = true;
      if (failed === "error") h.context.error = new Error("HTTP 503: unavailable");
      if (failed === "old-schema") h.context.data.query_state.status = "stale";
      if (failed === "requirement") location.hash = "#/dev-flow?view=list&requirement=R&detail=overview&task=T&project_id=P";
      const owner = nodes(workbench()).find((node) => node.type === TaskExternalRecoveryOwner && node.props.kind === kind)!;
      expect(owner.props.taskId).toBe("T"); expect(owner.props.isActive()).toBe(true);
      owner.props.onPending(true); expect(beforeUnload().defaultPrevented).toBe(true);
      h.externalIds[kind] = []; owner.props.onPending(false); owner.props.onResolved(); expect(beforeUnload().defaultPrevented).toBe(false);
    });
  }
  it("does not clear a retained external original from a stale fallback callback", () => {
    h.externalIds.submission = ["T"]; h.context.error = new Error("HTTP 503");
    const owner = find(workbench(), TaskExternalRecoveryOwner); owner.props.onPending(true);
    h.scope = "other-account"; expect(owner.props.isActive()).toBe(false); owner.props.onPending(false);
    expect(beforeUnload().defaultPrevented).toBe(false); h.scope = "scope-a"; expect(beforeUnload().defaultPrevented).toBe(true);
  });
  for (const kind of ["submission", "work-order"] as const) {
    it(`transfers a normal ${kind} owner to fallback without leaving a stale Task aggregate`, () => {
      const parent = workbench(), detail = find(parent, DeliveryTaskDetail), inner = frame("external-transfer", () => DeliveryTaskDetail(detail.props));
      const panel = find(inner, kind === "submission" ? DeliveryTaskSubmissionPanel : ExternalWorkOrderPanel);
      h.externalIds[kind] = ["T"]; panel.props.onUnresolvedChange(true);
      h.context.error = new Error("HTTP 503"); const owner = nodes(workbench()).find((node) => node.type === TaskExternalRecoveryOwner && node.props.kind === kind)!;
      panel.props.onUnresolvedChange(false); unmount("external-transfer"); owner.props.onPending(true);
      expect(beforeUnload().defaultPrevented).toBe(true);
      h.externalIds[kind] = []; owner.props.onPending(false); owner.props.onResolved(); expect(beforeUnload().defaultPrevented).toBe(false);
    });
  }
  it("protects a report draft immediately while leaving its own prepare and send authority available", () => {
    const report = find(host(), DeliveryTaskSubmissionPanel);
    report.props.onEditingChange(true);
    expect(beforeUnload().defaultPrevented).toBe(true);
    expect(report.props.canSubmit()).toBe(true);
    expect(find(host(), TaskDetailContent).props.canSubmitQueue()).toBe(true);
    report.props.onEditingChange(false);
    expect(beforeUnload().defaultPrevented).toBe(false);
  });
  it("keeps a second panel's original task pinned when the first closes", () => {
    const original = host(), report = find(original, DeliveryTaskSubmissionPanel), design = find(original, DeliveryDesignContextPanel);
    report.props.onEditingChange(true); design.props.onEditingChange(true); report.props.onEditingChange(false);
    h.task = { ...h.task, data: { ...task, task: { ...task.task, description: "New live definition" } } };
    const content = find(host(), TaskDetailContent);
    expect(content.props.pinnedDetail.task.description).toBe("Original task");
    expect(beforeUnload().defaultPrevented).toBe(true);
    design.props.onEditingChange(false);
    expect(find(host(), TaskDetailContent).props.pinnedDetail).toBeUndefined();
    expect(beforeUnload().defaultPrevented).toBe(false);
  });
  it("keeps the selected work order and its revision in the report request", () => {
    find(host(), ExternalWorkOrderPanel).props.onWriteReport({ id: "W-original", order_revision: 8 });
    const report = find(host(), DeliveryTaskSubmissionPanel);
    expect(report.props.requestCreate).toBe(1);
    expect(report.props.requestWorkOrder).toEqual({ id: "W-original", order_revision: 8 });
  });
  it("keeps the project and exact report return when opening the linked requirement or dependency", () => {
    const background = "#/dev-flow?view=team&task=T&project_id=P&submission_id=S-original&work_order_id=W-original";
    window.location.hash = background;
    const detail = { ...task, task: { ...task.task, req_id: "R" }, requirement: { id: "R", title: "Linked requirement", flow: { stage: "development" } } } as DeliveryTaskData;
    const tree = frame("linked-content", () => TaskDetailContent({ detail, taskId: "T", canEdit: true, onSaved: vi.fn(), onEditingChange: vi.fn() }));
    const requirement = nodes(tree).find((node) => node.type === Button && node.props.children === "Linked requirement")!;
    const target = new URLSearchParams(requirement.props.href.split("?")[1]);
    expect(target.get("project_id")).toBe("P"); expect(target.get("return_to")).toBe(background);
    find(tree, DeliveryTaskPlanMaintenance).props.onTask({ id: "T-dependency", req_id: "R" });
    const dependency = new URLSearchParams(window.location.hash.split("?")[1]);
    expect(dependency.get("project_id")).toBe("P"); expect(dependency.get("task")).toBe("T-dependency"); expect(dependency.get("return_to")).toBe(background);
  });
  it("gives execution and planning separate inner scopes", () => {
    const content = find(host(), TaskDetailContent), tree = frame("content", () => TaskDetailContent(content.props));
    const execution = find(tree, DeliveryExecutionPanel), planning = find(host(), DeliveryTaskDefinitionHost);
    execution.props.onEditingChange(true); planning.props.onEditingChange(true); execution.props.onEditingChange(false);
    expect(beforeUnload().defaultPrevented).toBe(true);
    planning.props.onEditingChange(false);
    expect(beforeUnload().defaultPrevented).toBe(false);
  });
  it("preserves unresolved operation protection after every draft closes", () => {
    const tree = host(), report = find(tree, DeliveryTaskSubmissionPanel), manual = find(tree, DeliveryManualReviewPanel);
    report.props.onEditingChange(true); manual.props.onUnresolvedChange(true); report.props.onEditingChange(false);
    expect(beforeUnload().defaultPrevented).toBe(true);
    expect(report.props.canSubmit()).toBe(false);
    manual.props.onUnresolvedChange(false);
    expect(beforeUnload().defaultPrevented).toBe(false);
  });
  it("keeps the mounted ordinary planning operation locked when another source reports false", () => {
    const tree = host(), content = find(tree, TaskDetailContent), inner = frame("content", () => TaskDetailContent(content.props));
    const execution = find(inner, DeliveryExecutionPanel), collaboration = find(inner, DeliveryCollaboration);
    h.taskEditPending!(true);
    collaboration.props.onUnresolvedChange(false); execution.props.onUnresolvedChange(false);
    expect(beforeUnload().defaultPrevented).toBe(true);
    expect(find(tree, DeliveryTaskSubmissionPanel).props.canSubmit()).toBe(false);
    h.taskEditPending!(false);
    expect(beforeUnload().defaultPrevented).toBe(false);
    expect(find(tree, DeliveryTaskSubmissionPanel).props.canSubmit()).toBe(true);
  });
  it("delegates planning edits to the independent definition host", () => {
    const content = find(host(), TaskDetailContent), inner = frame("content", () => TaskDetailContent(content.props));
    const maintenance = find(inner, DeliveryTaskPlanMaintenance);
    const facts = frame("planning-facts", () => DeliveryTaskPlanMaintenance(maintenance.props));
    find(facts, DeliveryTaskPlanning).props.onEdit();
    expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(1);
  });
  it("opens same-Task editing on hash/pop routes, ignores delivery selections, and reopens the same link after local close", () => {
    const base = location.hash, edit = `${base}&task_edit=1&task_edit_task=T`;
    const navigate = (hash: string, event = "hashchange") => { location.hash = hash; location.href = `http://local/${hash}`; window.dispatchEvent(new Event(event)); };
    expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(0);
    navigate(edit); expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(1);
    navigate(`${edit}&submission_id=S&work_order_id=W`); expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(1);
    const browserNavigation = vi.fn(); window.addEventListener("hashchange", browserNavigation); window.addEventListener("popstate", browserNavigation);
    closeTaskDefinitionRoute("P", "T"); expect(browserNavigation).not.toHaveBeenCalled();
    expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(1);
    navigate(edit); expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(2);
    closeTaskDefinitionRoute("P", "T");
    navigate(edit, "popstate"); expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(3);
  });
  it("retains one initial edit request and one listener through effect remount, then removes the old owner", () => {
    const base = location.hash, source = (message: string) => `${base}&task_edit=1&task_edit_task=T&task_source_thread=D&task_source_message=${message}&task_source_version=4&task_source_revision=2&task_source_resolution=E&task_source_field=description`;
    location.hash = source("A"); location.href = `http://local/${location.hash}`;
    const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
    expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(1);
    strictEffectCycle("task"); expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(1);
    location.hash = source("B"); location.href = `http://local/${location.hash}`; window.dispatchEvent(new Event("hashchange"));
    expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(2);
    const added = add.mock.calls.filter(([event]) => event === taskDefinitionRouteClosedEvent).map(([, listener]) => listener);
    expect(added).toHaveLength(2); expect(remove.mock.calls.filter(([event]) => event === taskDefinitionRouteClosedEvent).map(([, listener]) => listener)).toEqual([added[0]]);
    unmount("task"); expect(remove.mock.calls.filter(([event]) => event === taskDefinitionRouteClosedEvent).map(([, listener]) => listener)).toEqual(added);
    location.hash = source("C"); location.href = `http://local/${location.hash}`; window.dispatchEvent(new Event("hashchange"));
    expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(1);
    add.mockRestore(); remove.mockRestore();
  });
  it("recognizes a new same-Task discussion source without counting ordinary S/W changes", () => {
    host();
    const route = `${location.hash}&task_edit=1&task_edit_task=T&task_source_thread=D&task_source_message=M&task_source_version=4&task_source_revision=2&task_source_resolution=E&task_source_field=description`;
    const navigate = (hash: string) => { location.hash = hash; location.href = `http://local/${hash}`; window.dispatchEvent(new Event("hashchange")); };
    navigate(route); expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(1);
    navigate(route.replace("task_source_message=M", "task_source_message=M2")); expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(2);
    navigate(`${location.hash}&submission_id=S&work_order_id=W`); expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(2);
  });
  it("does not let route requests bypass an unknown operation or an open Task draft", () => {
    const initial = host(), base = location.hash, edit = `${base}&task_edit=1&task_edit_task=T`;
    const navigate = () => { location.hash = edit; location.href = `http://local/${edit}`; window.dispatchEvent(new Event("hashchange")); };
    h.taskEditPending!(true); navigate(); expect(location.hash).toBe(base); expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(0);
    h.taskEditPending!(false); const definition = find(initial, DeliveryTaskDefinitionHost);
    definition.props.onEditingChange(true); navigate(); expect(location.hash).toBe(base); expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(0);
    definition.props.onEditingChange(false); navigate(); expect(find(host(), DeliveryTaskDefinitionHost).props.requestEdit).toBe(1);
  });
  it("keeps the real definition owner through a failed task read", () => {
    host(); h.task = { ...h.task, data: undefined, error: new Error("HTTP 404: task missing"), isError: true };
    const owner = find(host(), DeliveryTaskDefinitionHost);
    expect(owner).toBeDefined(); expect(owner.props.current).toBeUndefined(); expect(owner.props.canEdit).toBe(false);
  });
  it("blocks fresh direct editing at a released requirement while retaining recovery", () => {
    location.hash += "&task_edit=1&task_edit_task=T";
    h.task.data = { ...task, task: { ...task.task, req_id: "R" }, requirement: { id: "R", flow: { stage: "release" } } };
    const owner = find(host(), DeliveryTaskDefinitionHost);
    expect(owner.props.requestEdit).toBe(1); expect(owner.props.canEdit).toBe(false); expect(owner.props.freshBlockReason).toContain("Reopen"); expect(owner.props.command).toBe(h.taskEdit);
  });
  for (const failed of ["pending", "error", "old-schema", "requirement"]) {
    it(`keeps hot Task edit recovery outside the ${failed} parent read`, () => {
      h.recoveryIds = ["T"];
      if (failed === "pending") h.context.isPending = true;
      if (failed === "error") h.context.error = new Error("HTTP 503: unavailable");
      if (failed === "old-schema") h.context.data.query_state.status = "stale";
      if (failed === "requirement") location.hash = "#/dev-flow?view=list&requirement=R&detail=tasks&task=T&project_id=P";
      const owner = find(workbench(), TaskDefinitionRecoveryOwner);
      expect(owner.props.taskId).toBe("T"); expect(owner.props.projectId).toBe("P");
      owner.props.onPending(true); expect(beforeUnload().defaultPrevented).toBe(true);
    });
  }
  for (const otherPending of [false, true]) {
    it(`transfers a mounted definition original without leaving its old task aggregate (${otherPending ? "another operation remains" : "all resolved"})`, () => {
      const parent = workbench(), detail = find(parent, DeliveryTaskDetail);
      const inner = frame("transferred-task", () => DeliveryTaskDetail(detail.props));
      h.recoveryIds = ["T"]; const definitionPending = h.taskEditPending!;
      definitionPending(true);
      if (otherPending) find(inner, DeliveryManualReviewPanel).props.onUnresolvedChange(true);
      h.context.error = new Error("HTTP 503: unavailable");
      const fallback = find(workbench(), TaskDefinitionRecoveryOwner);
      definitionPending(false); unmount("transferred-task");
      fallback.props.onPending(true); expect(beforeUnload().defaultPrevented).toBe(true);
      h.recoveryIds = []; fallback.props.onPending(false); fallback.props.onResolved();
      expect(beforeUnload().defaultPrevented).toBe(otherPending);
    });
  }
  it("shows inaccessible recovery storage as a retryable failure", () => {
    h.discoveryError = true;
    const tree = workbench(); expect(nodes(tree).some((node) => String(node.props.title || "").includes("retained original"))).toBe(true);
    expect(beforeUnload().defaultPrevented).toBe(true);
  });
  it("restores browser back and programmatic hash navigation until the draft is closed", () => {
    const report = find(host(), DeliveryTaskSubmissionPanel); report.props.onEditingChange(true);
    for (const type of ["hashchange", "popstate"]) {
      window.location.href = "http://local/#/projects"; window.dispatchEvent(new Event(type));
      expect(window.location.href).toBe("http://local/#/dev-flow?view=team&task=T&project_id=P");
    }
    report.props.onEditingChange(false); window.location.href = "http://local/#/projects"; window.dispatchEvent(new Event("hashchange"));
    expect(window.location.href).toBe("http://local/#/projects");
  });
  it("blocks a standalone task's return anchor before it leaves the report draft", () => {
    find(host(), DeliveryTaskSubmissionPanel).props.onEditingChange(true);
    const event = new Event("click", { cancelable: true });
    Object.defineProperties(event, { button: { value: 0 }, target: { value: { closest: () => ({ href: "http://local/#/tasks/execution", target: "", hasAttribute: () => false }) } } });
    window.document.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  });
  it("does not let an old account's draft prevent leaving the old session", () => {
    find(host(), ExternalWorkOrderPanel).props.onEditingChange(true); h.scope = "scope-b";
    expect(beforeUnload().defaultPrevented).toBe(false);
  });
  it("stops the real parent drawer close before it clears the selected task", () => {
    const tree = workbench(), detail = find(tree, DeliveryTaskDetail), drawer = nodes(tree).find((node) => node.type === Drawer && node.props.title === "deliveryTaskAcceptance.details")!;
    detail.props.onDraftChange(true); drawer.props.onClose();
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(find(workbench(), DeliveryTaskDetail).props.taskId).toBe("T");
    detail.props.onDraftChange(false); drawer.props.onClose();
    expect(history.replaceState).toHaveBeenCalled();
  });
  it("forwards the requirement task's draft separately from its pending command", () => {
    const draft = vi.fn(), pending = vi.fn(), definition = vi.fn(), external = vi.fn(), route = { task: "T", taskPage: 1, taskCursor: "" } as any;
    const tree = frame("requirement-tasks", () => DeliveryRequirementTasks({ projectId: "P", sessionId: "s", requirementId: "R", route, onRoute: vi.fn(), onUnresolvedChange: pending, onDraftChange: draft, onDefinitionPending: definition, onExternalPending: external }));
    const detail = find(tree, DeliveryTaskDetail); detail.props.onDraftChange(true); detail.props.onDraftChange(false);
    expect(draft.mock.calls).toEqual([[true], [false]]); expect(pending).not.toHaveBeenCalled();
    detail.props.onDefinitionPending(true); detail.props.onDefinitionPending(false); expect(definition.mock.calls).toEqual([[true], [false]]); expect(pending).not.toHaveBeenCalled();
    detail.props.onExternalPending("submission", true); detail.props.onExternalPending("work-order", false); expect(external.mock.calls).toEqual([["submission", true], ["work-order", false]]); expect(pending).not.toHaveBeenCalled();
  });
});

describe("synchronous task draft ownership", () => {
  it("publishes open and close before the next render without callback cleanup pulses", () => {
    const changed = vi.fn(), replacement = vi.fn();
    const read = (notify = changed) => frame("draft", () => useDeliveryDraftState<{ text: string } | null>(null, notify));
    const [, setDraft] = read(); setDraft({ text: "Original" });
    expect(changed.mock.calls).toEqual([[true]]);
    setDraft((value) => ({ text: `${value!.text} changed` })); read(replacement);
    expect(changed.mock.calls).toEqual([[true]]); expect(replacement).not.toHaveBeenCalled();
    setDraft(null); expect(replacement.mock.calls).toEqual([[false]]);
    expect(read(replacement)[0]).toBeNull();
  });
  it("releases only its own panel on unmount and ignores stale setters", () => {
    const first = vi.fn(), second = vi.fn();
    const [, setFirst] = frame("draft-a", () => useDeliveryDraftState(false, first));
    const [, setSecond] = frame("draft-b", () => useDeliveryDraftState(false, second));
    setFirst(true); setSecond(true); unmount("draft-a"); setFirst(false);
    expect(first.mock.calls).toEqual([[true], [false]]); expect(second.mock.calls).toEqual([[true]]);
    setSecond(false); expect(second.mock.calls).toEqual([[true], [false]]);
  });
});

describe("actual Task dispatch host navigation and W transfer", () => {
  const route = (submission = "S") => `#/tasks/execution?project_id=P&task_id=T&task_dispatch=1&dispatch_task=T&feedback_submission=${submission}&feedback_digest=${"a".repeat(64)}&feedback_decision=D`;
  const navigate = (hash: string, event = "hashchange") => { location.hash = hash; location.href = `http://local/${hash}`; window.dispatchEvent(new Event(event)); };
  it("recognizes same-Task A to B, skips ordinary S/W changes and opens a closed identical signature again", () => {
    host(); navigate(route()); expect(find(host(), TaskDispatchHost).props).toMatchObject({ requestOpen: 1, feedbackReference: { submission_id: "S" } });
    navigate(route("S2"), "popstate"); expect(find(host(), TaskDispatchHost).props.requestOpen).toBe(2);
    navigate(`${location.hash}&submission_id=View&work_order_id=W`); expect(find(host(), TaskDispatchHost).props.requestOpen).toBe(2);
    closeTaskDispatchRoute("P", "T"); host(); navigate(route("S2")); expect(find(host(), TaskDispatchHost).props.requestOpen).toBe(3);
  });
  it("cleans up/reinstalls dispatch listeners without double-opening the first route", () => {
    navigate(route()); const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
    expect(find(host(), TaskDispatchHost).props.requestOpen).toBe(1); strictEffectCycle("task"); expect(find(host(), TaskDispatchHost).props.requestOpen).toBe(1);
    navigate(route("S2")); expect(find(host(), TaskDispatchHost).props.requestOpen).toBe(2);
    const added = add.mock.calls.filter(([event]) => event === taskDispatchRouteEvent).map(([, listener]) => listener); unmount("task");
    expect(remove.mock.calls.filter(([event]) => event === taskDispatchRouteEvent).map(([, listener]) => listener)).toEqual(added);
    navigate(route("S3")); expect(find(host(), TaskDispatchHost).props.requestOpen).toBe(1); add.mockRestore(); remove.mockRestore();
  });
  it("protects dispatch drafts and unknown operations from same-Task feedback navigation", () => {
    const tree = host(), base = location.hash; h.taskEditPending!(true); navigate(route()); expect(location.hash).toBe(base);
    h.taskEditPending!(false); const dispatch = find(tree, TaskDispatchHost); dispatch.props.onEditingChange(true); navigate(route()); expect(location.hash).toBe(base); expect(beforeUnload().defaultPrevented).toBe(true);
    dispatch.props.onEditingChange(false); navigate(route()); expect(find(host(), TaskDispatchHost).props.requestOpen).toBe(1);
  });
  it("transfers draft ownership into W without changing its guarded hash and only clears flags after W cancel or confirmation", () => {
    navigate(route()); const tree = host(), dispatch = find(tree, TaskDispatchHost), before = location.hash;
    dispatch.props.onEditingChange(true); expect(dispatch.props.onExternal({ executorId: "Tool", feedback_reference: dispatch.props.feedbackReference })).toBe(true); dispatch.props.onEditingChange(false);
    let w = find(host(), ExternalWorkOrderPanel); expect(w.props.requestCreate).toMatchObject({ executorId: "Tool", token: 1 }); expect(beforeUnload().defaultPrevented).toBe(true);
    navigate("#/projects"); expect(location.hash).toBe(before); // Handoff did not make the guard retain an obsolete dispatch route.
    w.props.onEditingChange(true); w.props.onComposeSettled(1, true); w.props.onSelect("W-new"); expect(location.hash).toBe(before);
    w.props.onEditingChange(false); w.props.onComposeClosed(1); expect(location.hash).not.toContain("task_dispatch"); expect(beforeUnload().defaultPrevented).toBe(false);
    navigate(route()); const dispatch2 = find(host(), TaskDispatchHost); dispatch2.props.onEditingChange(true); dispatch2.props.onExternal({ executorId: "Tool", feedback_reference: dispatch2.props.feedbackReference }); dispatch2.props.onEditingChange(false);
    w = find(host(), ExternalWorkOrderPanel); w.props.onEditingChange(true); w.props.onEditingChange(false); w.props.onSelect("W-new");
    expect(location.hash).toContain("work_order_id=W-new"); expect(location.hash).not.toContain("feedback_submission"); expect(location.hash).not.toContain("task_dispatch");
  });
  it("releases a failed W transfer and ignores late settlement from a previous transfer", () => {
    const first = find(host(), TaskDispatchHost); first.props.onEditingChange(true); first.props.onExternal({ executorId: "Tool" }); first.props.onEditingChange(false);
    const old = find(host(), ExternalWorkOrderPanel); old.props.onComposeSettled(1, false); expect(beforeUnload().defaultPrevented).toBe(false);
    const second = find(host(), TaskDispatchHost); second.props.onEditingChange(true); second.props.onExternal({ executorId: "Tool" }); second.props.onEditingChange(false); host();
    old.props.onComposeSettled(1, false); expect(beforeUnload().defaultPrevented).toBe(true);
    find(host(), ExternalWorkOrderPanel).props.onComposeSettled(2, false); expect(beforeUnload().defaultPrevented).toBe(false);
  });
});
