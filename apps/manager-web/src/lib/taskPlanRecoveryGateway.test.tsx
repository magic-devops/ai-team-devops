/** Recovery entry and source identity definitions; UNRUN until validation resumes. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskPlanRecoveryGateway, TaskPlanRecoveryWorkspace } from "../../subapps/ai-rd-center/src/pages/delivery/TaskPlanRecoveryGateway";
import { TaskPlanRecoveryModal } from "../../subapps/ai-rd-center/src/pages/delivery/TaskPlanRecoveryModal";
import { DeliveryTaskPlanForm } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanEditor";
import { taskPlanEditorHash, taskPlanRouteRequirement } from "./taskPlanRoute";
import { planDraft } from "./taskPlanRetentionFixtures";
const h = vi.hoisted(() => ({ query: [] as any[], retention: null as any, hash: "#/dev-flow?project_id=P&plan_requirement=R", hooks: [] as any[], next: 0 }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), useEffect: () => {},
  useRef: (value: any) => { const i = h.next++; return h.hooks[i] ||= { current: value }; },
  useState: (value: any) => { const i = h.next++; if (!(i in h.hooks)) h.hooks[i] = typeof value === "function" ? value() : value;
    return [h.hooks[i], (next: any) => { h.hooks[i] = typeof next === "function" ? next(h.hooks[i]) : next; }]; } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => h.query.shift() }));
vi.mock("./useTaskPlanRetention", () => ({ useTaskPlanRetention: () => h.retention }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => "scope" }));
vi.mock("./taskPlanRetention", () => ({ PLAN_RETENTION_EVENT: "plan-event", discoverTaskPlans: () => [{ requirementId: "R", title: "Saved requirement", phase: "unknown" }] }));
const liveRead = { data: { project: { id: "P" }, version: 7, query_generation: 3, permissions: { write: true } } as any, pending: false, failed: false, refresh: vi.fn() };
const props = { liveRead, projectId: "P", requirementId: "R", sessionId: "scope", onClose: vi.fn(), onSaved: vi.fn(), onPending: vi.fn() };
beforeEach(() => {
  liveRead.pending = false; liveRead.failed = false; liveRead.data.permissions.write = true; liveRead.refresh.mockReset().mockResolvedValue(liveRead.data);
  h.next = 0; h.hooks = []; h.query = []; h.retention = { view: { owned: true, command: { phase: "idle" }, draft: planDraft() }, store: { close: vi.fn(), current: () => true } };
  vi.stubGlobal("location", { hash: h.hash });
});
afterEach(() => vi.unstubAllGlobals());
describe("persistent recovery entry", () => {
  it.each(["#/other?project_id=P&plan_requirement=R", "#/dev-flow?project_id=Q&plan_requirement=R", "#/dev-flow?project_id=P&project_id=Q&plan_requirement=R", "#/dev-flow?project_id=P&plan_requirement=R&plan_requirement=S", "#/dev-flow?project_id=P&plan_requirement=../bad"])
  ("rejects ambiguous or foreign routes %s", (hash) => { expect(taskPlanRouteRequirement(hash, "P")).toBe(""); });
  it("preserves working position while opening and closing a plan", () => {
    const route = taskPlanEditorHash("P", "R", "#/dev-flow?project_id=P&view=requirements&search=word");
    expect(taskPlanRouteRequirement(route, "P")).toBe("R"); expect(taskPlanEditorHash("P", "", route)).toBe("#/dev-flow?project_id=P&view=requirements&search=word");
    expect(() => taskPlanEditorHash("P", "R", "#/dev-flow?project_id=P&project_id=P")).toThrow();
  });
  it.each(["unknown", "succeeded", "refused"])("shows %s even if the current context is denied and the requirement is missing", (phase) => {
    h.retention.view.command.phase = phase; liveRead.failed = true; h.query = [{ isError: true, error: new Error("HTTP 404") }];
    const tree = TaskPlanRecoveryWorkspace(props); expect(tree.type).toBe(TaskPlanRecoveryModal); expect(tree.props.store).toBe(h.retention.store);
  });
  it("keeps a normal draft recoverable when reads fail and exposes retry", async () => {
    const refetch = vi.fn().mockResolvedValue({ isError: true, error: new Error("HTTP 404") }); liveRead.failed = true; h.query = [{ isError: true, error: new Error("HTTP 404"), refetch }];
    const tree = TaskPlanRecoveryWorkspace(props); expect(tree.type).toBe(TaskPlanRecoveryModal); expect(tree.props.readError).toBeDefined();
    tree.props.onRetryCurrent(); expect(refetch).toHaveBeenCalledTimes(1); expect(liveRead.refresh).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
  it("joins only the same project, version and query generation before editing", () => {
    const definition = { project_id: "P", version: 7, query_generation: 3, requirement: { id: "R" } };
    h.query = [{ data: { ...definition, query_generation: 4 } }]; expect(TaskPlanRecoveryWorkspace(props).type).toBe(TaskPlanRecoveryModal);
    h.next = 0; h.query = [{ data: definition }]; expect(TaskPlanRecoveryWorkspace(props).type).toBe(DeliveryTaskPlanForm);
  });
  it("updates the existing form's write guard when parent permission or read access changes", () => {
    const definition = { project_id: "P", version: 7, query_generation: 3, requirement: { id: "R" } };
    h.query = [{ data: definition }]; const first = TaskPlanRecoveryWorkspace(props), oldGuard = first.props.canWriteCurrent;
    expect(oldGuard()).toBe(true); liveRead.data = { ...liveRead.data, permissions: { write: false } };
    h.next = 0; h.query = [{ data: definition }]; TaskPlanRecoveryWorkspace(props); expect(oldGuard()).toBe(false);
    liveRead.data = { ...liveRead.data, permissions: { write: true } }; liveRead.failed = true;
    h.next = 0; h.query = [{ data: definition }]; expect(TaskPlanRecoveryWorkspace(props).type).toBe(TaskPlanRecoveryModal); expect(oldGuard()).toBe(false);
  });
  it("blocks cached successful reads throughout refused-edit refresh, then admits only its checked join", async () => {
    const definition = { project_id: "P", version: 7, query_generation: 3, requirement: { id: "R", basis: "a".repeat(64) } };
    let contextDone!: (value: any) => void, definitionDone!: (value: any) => void;
    liveRead.refresh.mockReturnValueOnce(new Promise((ok) => { contextDone = ok; }));
    const refetch = vi.fn().mockReturnValueOnce(new Promise((ok) => { definitionDone = ok; }));
    h.query = [{ data: definition, refetch }]; const oldGuard = TaskPlanRecoveryWorkspace(props).props.canWriteCurrent;
    h.retention.view.command.phase = "refused"; h.next = 0; h.query = [{ data: definition, refetch }];
    const refused = TaskPlanRecoveryWorkspace(props); h.retention.view.command.phase = "idle"; refused.props.onEdit(); expect(oldGuard()).toBe(false);
    h.next = 0; h.query = [{ data: definition, isPending: false, isFetching: true, refetch }];
    expect(TaskPlanRecoveryWorkspace(props).type).not.toBe(DeliveryTaskPlanForm);
    contextDone(liveRead.data); definitionDone({ data: definition, isError: false }); for (let i = 0; i < 8; i++) await Promise.resolve();
    h.next = 0; h.query = [{ data: definition, isFetching: false, refetch }]; const ready = TaskPlanRecoveryWorkspace(props);
    expect(ready.type).toBe(DeliveryTaskPlanForm); expect(ready.props.canWriteCurrent()).toBe(true);
  });
  it("keeps the explicit refresh barrier after failure instead of falling back to cached success", async () => {
    const definition = { project_id: "P", version: 7, query_generation: 3, requirement: { id: "R", basis: "a".repeat(64) } };
    liveRead.failed = true; liveRead.refresh.mockRejectedValueOnce(new Error("HTTP 403"));
    const refetch = vi.fn().mockResolvedValue({ data: definition, isError: false }); h.query = [{ data: definition, refetch }];
    TaskPlanRecoveryWorkspace(props).props.onRetryCurrent(); for (let i = 0; i < 8; i++) await Promise.resolve();
    liveRead.failed = false; h.next = 0; h.query = [{ data: definition, refetch }]; expect(TaskPlanRecoveryWorkspace(props).type).toBe(TaskPlanRecoveryModal);
    h.retention.view.command.phase = "unknown"; h.next = 0; h.query = [{ data: definition, refetch }]; expect(TaskPlanRecoveryWorkspace(props).type).toBe(TaskPlanRecoveryModal);
  });
  it("mounts a routed recovery independently of project page reads", () => {
    const tree = TaskPlanRecoveryGateway({ liveRead, projectId: "P", sessionId: "scope", onSaved: vi.fn(), onPending: vi.fn(), canNavigate: () => true });
    const children = tree.props.children as any[]; expect(children.find((child) => child?.type === TaskPlanRecoveryWorkspace)?.props.requirementId).toBe("R");
  });
  it("does not let an old close or saved callback replace another live plan route", () => {
    const saved = vi.fn(), replaceState = vi.fn(); vi.stubGlobal("history", { replaceState });
    const tree = TaskPlanRecoveryGateway({ liveRead, projectId: "P", sessionId: "scope", onSaved: saved, onPending: vi.fn(), canNavigate: () => true });
    const workspace = (tree.props.children as any[]).find((child) => child?.type === TaskPlanRecoveryWorkspace);
    location.hash = "#/dev-flow?project_id=P&plan_requirement=another";
    workspace.props.onClose(); workspace.props.onSaved({}); expect(replaceState).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  });
});
