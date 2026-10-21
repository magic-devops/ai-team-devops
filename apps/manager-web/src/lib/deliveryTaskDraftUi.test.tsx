import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Drawer } from "antd";
import { DeliveryTaskDetail, TaskDetailContent } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import { DeliveryWorkbench } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryWorkbench";
import { DeliveryRequirementTasks } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryQueryViews";
import { DeliveryExecutionPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionPanel";
import { DeliveryTaskPlanMaintenance } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanMaintenance";
import { DeliveryTaskPlanning } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanning";
import { DeliveryEditor } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryEditor";
import { DeliveryCollaboration } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDiscussionAdoption";
import { DeliveryDesignContextPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDesignContextPanel";
import { DeliveryTaskSubmissionPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskSubmissionPanel";
import { DeliveryManualReviewPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryManualReviewPanel";
import { ExternalWorkOrderPanel } from "../components/ExternalWorkOrderPanel";
import { useDeliveryDraftState } from "./useDeliveryDraftState";
import { setSession, USER_KEY } from "./authStorage";
import { request } from "./http";
import type { DeliveryTaskData } from "./delivery";

const h = vi.hoisted(() => ({ hooks: {} as Record<string, any[]>, component: "", next: 0, effects: [] as Array<() => void>, scope: "scope-a", task: {} as any, context: {} as any, options: [] as any[], storage: {} as Record<string, string>,
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
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const [values, index] = slot(undefined), previous = values[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { const entry = { effect: true, deps, cleanup: undefined as undefined | (() => void) }; values[index] = entry; h.effects.push(() => { previous?.cleanup?.(); entry.cleanup = effect() || undefined; }); } },
  };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-US" } }) }));
vi.mock("./projectPortfolio", async () => ({ ...await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio"), projectSessionKey: () => h.scope }));
vi.mock("./authStorage", async () => ({ ...await vi.importActual<typeof import("./authStorage")>("./authStorage"), getProjectId: () => "P", getToken: () => "controlled" }));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("./deliveryQuery", async () => ({ ...await vi.importActual<typeof import("./deliveryQuery")>("./deliveryQuery"), fetchDeliveryTaskEditData: async () => structuredClone(h.task.data) }));
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
function unmount(name: string) { for (const value of h.hooks[name] || []) if (value?.effect) value.cleanup?.(); delete h.hooks[name]; }
function nodes(node: ReactNode): ReactElement<any>[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...["children", "action", "description", "footer"].flatMap((key) => nodes(node.props[key])), ...(node.props.items || []).flatMap((value: any) => nodes(value.children))]; }
function find(tree: ReactNode, type: unknown) { return nodes(tree).find((node) => node.type === type)!; }
function host(props: Record<string, unknown> = {}) { return frame("task", () => DeliveryTaskDetail({ projectId: "P", taskId: "T", sessionId: "s", ...props })); }
function workbench() { const shell = frame("shell", () => DeliveryWorkbench()), project = nodes(shell).find((node) => typeof node.type === "function" && node.type.name === "ProjectDelivery")!; return frame("workbench", () => (project.type as (props: any) => ReactNode)(project.props)); }
function beforeUnload() { const event = new Event("beforeunload", { cancelable: true }); Object.defineProperty(event, "returnValue", { writable: true, value: "" }); window.dispatchEvent(event); return event; }
beforeEach(() => {
  h.hooks = {}; h.effects = []; h.options = []; h.storage = {}; h.scope = "scope-a"; h.invalidate.mockReset(); h.refetch.mockReset();
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
    const execution = find(tree, DeliveryExecutionPanel), planning = find(tree, DeliveryTaskPlanMaintenance);
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
    const planning = find(inner, DeliveryTaskPlanMaintenance), execution = find(inner, DeliveryExecutionPanel), collaboration = find(inner, DeliveryCollaboration);
    planning.props.onUnresolvedChange(true);
    collaboration.props.onUnresolvedChange(false); execution.props.onUnresolvedChange(false);
    expect(beforeUnload().defaultPrevented).toBe(true);
    expect(find(tree, DeliveryTaskSubmissionPanel).props.canSubmit()).toBe(false);
    planning.props.onUnresolvedChange(false);
    expect(beforeUnload().defaultPrevented).toBe(false);
    expect(find(tree, DeliveryTaskSubmissionPanel).props.canSubmit()).toBe(true);
  });
  it("gives an ordinary task plan the real editor's original-value retry protection", async () => {
    const unresolved = vi.fn(), props = { task: h.task.data.task, data: h.task.data, onTask: vi.fn(), onSaved: vi.fn(), canEdit: true, onUnresolvedChange: unresolved };
    const read = () => frame("ordinary-planning", () => DeliveryTaskPlanMaintenance(props));
    await find(read(), DeliveryTaskPlanning).props.onEdit();
    const editor = find(read(), DeliveryEditor);
    expect(editor).toBeDefined(); expect(editor.props.sourceAware).toBe(true);
    editor.props.onUnresolvedChange(true); editor.props.onUnresolvedChange(false);
    expect(unresolved.mock.calls).toEqual([[true], [false]]);
  });
  it("retains the original planning version, body and key across a mounted retry", async () => {
    const props = { task: h.task.data.task, data: h.task.data, onTask: vi.fn(), onSaved: vi.fn(), canEdit: true };
    const read = () => frame("retry-planning", () => DeliveryTaskPlanMaintenance(props));
    await find(read(), DeliveryTaskPlanning).props.onEdit();
    const editor = find(read(), DeliveryEditor), values = editor.props.spec.values;
    vi.mocked(request).mockRejectedValueOnce(new Error("Network result unknown")).mockResolvedValueOnce({ project_id: "P", version: 8 });
    await expect(editor.props.spec.submit(values)).rejects.toThrow();
    await editor.props.spec.submit(values);
    const first = JSON.parse(vi.mocked(request).mock.calls[0][1]!.body as string), retried = JSON.parse(vi.mocked(request).mock.calls[1][1]!.body as string);
    expect(first).toEqual(retried); expect(first.expected_version).toBe(7); expect(first.payload.task_basis).toBe("task-basis"); expect(first.payload.planning_basis).toBe("planning-basis");
    expect(props.onSaved).toHaveBeenCalledTimes(1);
  });
  it("closes the acknowledged planning draft even when refreshing its parent fails", async () => {
    const editing = vi.fn(), props = { task: h.task.data.task, data: h.task.data, onTask: vi.fn(), onSaved: () => { throw new Error("Refresh failed"); }, canEdit: true, onEditingChange: editing };
    const read = () => frame("ack-planning", () => DeliveryTaskPlanMaintenance(props));
    await find(read(), DeliveryTaskPlanning).props.onEdit();
    const editor = find(read(), DeliveryEditor); vi.mocked(request).mockResolvedValueOnce({ project_id: "P", version: 8 });
    await expect(editor.props.spec.submit(editor.props.spec.values)).resolves.toBeUndefined();
    expect(editing.mock.calls).toEqual([[true], [false]]); expect(find(read(), DeliveryEditor)).toBeUndefined();
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
    const draft = vi.fn(), pending = vi.fn(), route = { task: "T", taskPage: 1, taskCursor: "" } as any;
    const tree = frame("requirement-tasks", () => DeliveryRequirementTasks({ projectId: "P", sessionId: "s", requirementId: "R", route, onRoute: vi.fn(), onUnresolvedChange: pending, onDraftChange: draft }));
    const detail = find(tree, DeliveryTaskDetail); detail.props.onDraftChange(true); detail.props.onDraftChange(false);
    expect(draft.mock.calls).toEqual([[true], [false]]); expect(pending).not.toHaveBeenCalled();
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
