/** Actual page callbacks and persistent/session-bound consumer definitions; not executed in this stage. */
import { isValidElement, type ReactNode } from "react";
import { Button, Checkbox, Input, Modal, Select, Table, Tag } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request } from "./http";
import { setSession, USER_KEY } from "./authStorage";
import { externalWorkOrderCopy } from "../i18n/external-work-orders";
import { ExternalWorkOrderPanel, WorkOrderFacts, DefinitionFacts } from "../components/ExternalWorkOrderPanel";
import { WorkOrderStatusBadges, WorkOrderReportedProgress } from "../components/ExternalWorkOrderPresentation";
import { ActivitySourceLinks } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryActivityFeed";
import { parseExternalWorkOrderRoute } from "./externalWorkOrderRoute";
import { ProjectWorkOrders } from "../../subapps/ai-foundation/src/pages/ecosystem/A2aWorkbench";
import { DeliveryTaskDetail, TaskDetailContent } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import { TaskDispatchFeedback } from "../../subapps/ai-rd-center/src/pages/delivery/TaskDispatchFeedback";
import { taskDispatchRequest } from "./taskDispatchRoute";
import { taskDispatchCopy, taskDispatchReason } from "../i18n/task-dispatch";
import { externalWorkOrderReason } from "../i18n/external-work-orders";
import { DeliveryTaskSubmissionPanel, SubmissionFacts } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskSubmissionPanel";
import { workOrderStorageKey } from "./externalWorkOrderCommand";
import { installExecutionExitGuard } from "./executionExitGuard";
const h = vi.hoisted(() => ({ frame: "", next: 0, frames: {} as Record<string, any[]>, local: new Map<string, string>(), storage: new Map<string, string>(), queries: [] as any[], current: {} as any, detail: {} as any, reportCurrent: {} as any, reportDetail: {} as any,
  currentError: null as Error | null, directoryError: null as Error | null, taskData: {} as any, sent: [] as any[], mode: "success", cleanupFail: false, canWrite: true, saved: vi.fn(), pending: vi.fn(), navigated: vi.fn() }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useRef: (value: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
  useState: (value: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value; return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
  useMemo: (factory: () => any, deps: any[]) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots) || deps.some((value, i) => value !== slots[index].deps[i])) slots[index] = { deps, value: factory() }; return slots[index].value; },
  useEffect: () => {}, useCallback: (value: unknown) => value, useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }) }));
vi.mock("./http", async () => ({ ...await vi.importActual<typeof import("./http")>("./http"), request: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: (options: any) => {
  h.queries.push(options); const key = options.queryKey[0], data = key === "delivery-task-detail" ? h.taskData : key === "delivery-work-order-current" ? h.current : key === "delivery-work-order-exact" ? h.detail : key === "delivery-work-order-report-current" ? h.reportCurrent : key === "delivery-work-order-report-choice" ? h.reportDetail : ["delivery-work-orders", "delivery-work-orders-directory"].includes(key) ? { ...h.current, items: [h.detail.work_order], total: 1, limit: 20, next_cursor: null } : undefined;
  const error = key === "delivery-work-order-current" ? h.currentError : key === "delivery-work-orders-directory" ? h.directoryError : null;
  return { data, error, isError: Boolean(error), isPending: !data, isFetching: false, refetch: vi.fn(async () => ({ data, isError: Boolean(error) })) };
} }));
const digest = "a".repeat(64), now = "2026-10-21T04:00:00Z", copy = externalWorkOrderCopy("zh-CN");
function frame<T>(key: string, fn: () => T) { h.frame = key; h.next = 0; return fn(); }
function nodes(value: ReactNode): any[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!isValidElement<any>(value)) return []; return [value, ...["children", "footer", "action", "actions", "description"].flatMap((key) => nodes(value.props[key]))]; }
const find = (tree: ReactNode, type: unknown, test: (props: any) => boolean = () => true) => nodes(tree).find((node) => node.type === type && test(node.props))?.props;
const button = (tree: ReactNode, label: string) => find(tree, Button, (props) => props.children === label);
const panel = () => frame("panel", () => ExternalWorkOrderPanel({ projectId: "P", taskId: "T", sessionId: "session", canSubmit: () => h.canWrite, onSaved: h.saved, onUnresolvedChange: h.pending }));
const workbench = () => frame("workbench", () => ProjectWorkOrders());
const workbenchPanel = () => { const props = find(workbench(), ExternalWorkOrderPanel); return frame("workbench-panel", () => ExternalWorkOrderPanel(props)); };
beforeEach(() => {
  h.frames = {}; h.queries = []; h.local.clear(); h.storage.clear(); h.sent = []; h.mode = "success"; h.cleanupFail = false; h.currentError = null; h.directoryError = null; h.canWrite = true; h.saved.mockReset(); h.pending.mockReset(); h.navigated.mockReset();
  vi.stubGlobal("localStorage", { getItem: (key: string) => h.local.get(key) || null, setItem: (key: string, value: string) => h.local.set(key, value), removeItem: (key: string) => h.local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => h.storage.get(key) || null, setItem: (key: string, value: string) => { if (h.cleanupFail && !value) throw new Error("Storage denied"); h.storage.set(key, value); } });
  setSession("private-fixture-token", "P", "tenant"); h.local.set(USER_KEY, JSON.stringify({ id: "U", tenant_id: "tenant" }));
  const location = { hash: "#/tasks/execution?project_id=P&task_id=T&work_order_id=W", href: "http://localhost/#/tasks/execution?project_id=P&task_id=T&work_order_id=W" };
  vi.stubGlobal("location", location); vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  const definition = { task_id: "T", title: "Actual task", description: "Fixed scope", assigned_to: "M", task_acceptance_criteria: ["Criterion"], acceptance_criteria: ["Criterion"], dependency_basis: {}, owner: { id: "M", name: "Owner", kind: "human", active: true }, requirement: null, designs: [], design_basis: digest };
  const executor = { id: "Tool", name: "Codex", kind: "tool", tool: "codex", active: true, available: true, reasons: [] };
  h.current = { project_id: "P", version: 3, query_generation: null, as_of: now, task_id: "T", task_basis: digest, definition_digest: digest, native_boundary_digest: digest, definition, executors: [executor], active_work_order_id: "W", can_dispatch: true, reasons: [] };
  h.taskData = { project: { id: "P" }, version: 3, permissions: { write: true }, task: { id: "T", execution_id: null }, members: [] };
  h.detail = { project_id: "P", version: 3, query_generation: null, as_of: now, definition, instructions: "", work_order: { id: "W", task_id: "T", task_title: "Actual task", order_revision: 1, state: "queued", request_digest: digest, packet_digest: digest, definition_digest: digest, native_boundary_digest: digest, executor,
    requested_by: { id: "U", name: "Operator" }, claimed_by: null, created_at: now, updated_at: now, claimed_at: null, invalidated: false, invalidated_reason: null, progress: null, submission: null, delivery_state: null, closure: null }, permissions: { can_claim: true, can_progress: false, can_cancel: true, can_release: false, can_report: false, reasons: [] } };
  const source = { kind: "tool", name: "Actual Codex report", url: "" };
  const submission = { id: "S", task_id: "T", created_at: now, submitted_by: { id: "U", name: "Claimant" }, source, summary: "Actual delivery", digest, task_basis: digest, definition_digest: digest, native_boundary_digest: digest,
    status: "awaiting_review", invalidated: false, invalidated_at: null, invalidated_reason: "", counts: { artifacts: 1, criteria: 1, tests: 1, reported_passed: 1, reported_failed: 0 }, issue_id: null, review_id: null };
  h.reportCurrent = { ...h.current, criteria: [{ source: "task", index: 0, text_digest: digest, text: "Criterion" }], can_submit: true, latest_submission_id: "S", work_order: null };
  h.reportDetail = { project_id: "P", task_id: "T", version: 3, as_of: now, task_basis: digest, native_boundary_digest: digest, submission, definition, decision: null,
    permissions: { can_review: false, can_accept: false, reasons: [] }, payload: { task_id: "T", task_basis: digest, definition_digest: digest, native_boundary_digest: digest, source, summary: "Actual delivery", artifacts: [{ id: "A", title: "Actual test output", content: "Actual reported output", url: "", sha256: null }], criteria: [{ source: "task", index: 0, text_digest: digest, result: "met", evidence_ids: ["A"] }], tests: [{ id: "Test", title: "Actual test", status: "passed", evidence_ids: ["A"] }] } };
  vi.mocked(request).mockReset().mockImplementation(async (path, init) => {
    if (path.endsWith("/work-orders/current")) { if (h.currentError) throw h.currentError; return h.current; }
    if (path.endsWith("/work-order-preview")) return { ...h.current, complete: true, allowed: true, preview_basis: digest, packet_digest: digest, executor, max_packet_bytes: 524288 };
    if (path === "/api/v1/delivery/work-orders/W") return h.detail;
    if (path.endsWith("/delivery-submissions/current")) return h.reportCurrent;
    if (path.endsWith("/delivery-submissions/S")) return h.reportDetail;
    const body = JSON.parse(String(init?.body)); h.sent.push(body); if (h.mode === "unknown") throw new TypeError("Lost response");
    const state = body.action === "work_order.create" ? "queued" : body.action === "work_order.claim" ? "claimed" : body.action === "work_order.release" ? "closed" : body.action === "work_order.progress" ? h.detail.work_order.state : "reported";
    return { project_id: "P", action: body.action, resource: { kind: "work_order", id: "W" }, result: { work_order_id: "W", task_ids: ["T"], request_digest: digest, packet_digest: digest, order_revision: body.action === "work_order.create" ? 1 : body.payload.order_revision + 1, state, submission_id: body.payload.submission_id || null },
      affected_refs: [{ kind: "work_order", id: "W" }, { kind: "task", id: "T" }, ...(body.action === "work_order.report" ? [{ kind: "task_submission", id: "S" }] : [])], applied_version: 4, version: 4, query_generation: null, replayed: false };
  });
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => { const parsed = new URL(String(url), "http://fixture.invalid"), value = await request(parsed.pathname + parsed.search, init); return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function prepareClaim() { button(panel(), copy.claim).onClick(); await button(panel(), copy.prepare).onClick(); return panel(); }
it("submits an actual fixed Task preview, not a second freeform or synthetic Task", async () => {
  button(panel(), copy.create).onClick(); find(panel(), Select, (props) => props["aria-label"] === copy.member).onChange("Tool");
  find(panel(), Input.TextArea, (props) => props["aria-label"] === copy.instruction).onChange({ target: { value: "Additional actual instructions" } });
  await button(panel(), copy.prepare).onClick(); await button(panel(), copy.confirm).onClick();
  expect(h.sent).toHaveLength(1); expect(h.sent[0].action).toBe("work_order.create"); expect(h.sent[0].payload.task_id).toBe("T"); expect(h.sent[0].payload.instructions).toBe("Additional actual instructions");
  expect(h.sent[0].payload.preview_basis).toBe(digest); expect(h.sent[0].payload).not.toHaveProperty("run_id");
});
it("recovers a cold original despite failed fresh reads and disabled fresh actions", async () => {
  h.mode = "unknown"; await button(await prepareClaim(), copy.confirm).onClick(); const original = structuredClone(h.sent[0]);
  h.frames = {}; h.currentError = new Error("HTTP 503: unavailable"); h.canWrite = false; h.mode = "success";
  const recovery = find(panel(), Button, (props) => props["data-action"] === "recover-work-order"); expect(recovery).toBeDefined(); await recovery.onClick();
  expect(h.sent).toEqual([original, original]); expect(h.saved).toHaveBeenCalledTimes(1);
});
it("clears a retained confirmed ACK without a second POST after local cleanup fails", async () => {
  const tree = await prepareClaim(); h.cleanupFail = true; await button(tree, copy.confirm).onClick(); expect(h.saved).not.toHaveBeenCalled();
  h.cleanupFail = false; await button(panel(), copy.cleanup).onClick(); expect(h.sent).toHaveLength(1); expect(h.saved).toHaveBeenCalledTimes(1);
});
it("requires an explicit unchecked stop attestation before release", async () => {
  h.detail.work_order.state = "claimed"; h.detail.work_order.claimed_by = { id: "U", name: "Claimant" }; h.detail.work_order.claimed_at = now; h.detail.permissions.can_claim = false; h.detail.permissions.can_progress = true; h.detail.permissions.can_release = true;
  button(panel(), copy.release).onClick(); expect(find(panel(), Checkbox).checked).toBe(false);
  find(panel(), Input.TextArea).onChange({ target: { value: "Checked the external process stopped" } }); await button(panel(), copy.prepare).onClick(); expect(button(panel(), copy.confirm)).toBeUndefined();
  find(panel(), Checkbox).onChange({ target: { checked: true } }); await button(panel(), copy.prepare).onClick(); await button(panel(), copy.confirm).onClick();
  expect(h.sent[0].payload.stopped_attestation).toBe(true); expect(h.sent[0].action).toBe("work_order.release");
});
it("submits actual claimed progress with an explicit unknown percentage and no preset success", async () => {
  h.detail.work_order.state = "claimed"; h.detail.work_order.claimed_by = { id: "U", name: "Claimant" }; h.detail.work_order.claimed_at = now; h.detail.permissions.can_claim = false; h.detail.permissions.can_progress = true;
  button(panel(), copy.updateProgress).onClick(); expect(find(panel(), Checkbox).checked).toBe(false);
  find(panel(), Input.TextArea).onChange({ target: { value: "Actually working on the second criterion" } }); await button(panel(), copy.prepare).onClick(); await button(panel(), copy.confirm).onClick();
  expect(h.sent[0].payload.percent).toBeNull(); expect(h.sent[0].payload.status).toBe("running"); expect(h.sent[0].payload).not.toHaveProperty("confidence");
});
it("links only the selected fixed actual S with explicit stop attestation, without issuing a human acceptance command", async () => {
  h.detail.work_order.state = "claimed"; h.detail.work_order.claimed_by = { id: "U", name: "Claimant" }; h.detail.work_order.claimed_at = now; h.detail.permissions.can_claim = false; h.detail.permissions.can_report = true;
  button(panel(), copy.linkReport).onClick(); expect(find(panel(), Checkbox).checked).toBe(false);
  find(panel(), Select, (props) => props["aria-label"] === copy.chooseReport).onChange("S"); await button(panel(), copy.prepare).onClick(); expect(button(panel(), copy.confirm)).toBeUndefined();
  find(panel(), Checkbox).onChange({ target: { checked: true } }); await button(panel(), copy.prepare).onClick(); await button(panel(), copy.confirm).onClick();
  expect(h.sent).toHaveLength(1); expect(h.sent[0].action).toBe("work_order.report"); expect(h.sent[0].payload).toMatchObject({ submission_id: "S", submission_digest: digest, stopped_attestation: true }); expect(h.sent[0].payload).not.toHaveProperty("decision");
});
it("does not let an old create action open an editor after the canonical Task read fails", () => {
  const old = button(panel(), copy.create); h.currentError = new Error("HTTP 403: revoked"); panel(); old.onClick(); expect(find(panel(), Modal).open).toBe(false);
});
it("still prepares an explicit exact-order stop release when the current Task cannot be read", async () => {
  h.detail.work_order.state = "claimed"; h.detail.work_order.claimed_by = { id: "U", name: "Claimant" }; h.detail.work_order.claimed_at = now; h.detail.permissions.can_claim = false; h.detail.permissions.can_release = true;
  h.currentError = new Error("HTTP 404: Task unavailable");
  expect(button(panel(), copy.release).disabled).toBe(false); button(panel(), copy.release).onClick();
  find(panel(), Input.TextArea).onChange({ target: { value: "Observed external work stopped" } }); find(panel(), Checkbox).onChange({ target: { checked: true } });
  await button(panel(), copy.prepare).onClick(); expect(button(panel(), copy.confirm)).toBeDefined(); expect(h.sent).toHaveLength(0);
});
it("still prepares an explicit queued cancellation from exact detail when current Task returns 404", async () => {
  h.currentError = new Error("HTTP 404: Task unavailable"); button(panel(), copy.cancelOrder).onClick();
  find(panel(), Input.TextArea).onChange({ target: { value: "Cancel the unclaimed original" } }); await button(panel(), copy.prepare).onClick();
  expect(button(panel(), copy.confirm)).toBeDefined(); expect(h.sent).toHaveLength(0);
});
it("labels reported progress, pending cancellation and accepted human review as separate facts", () => {
  const order = { ...h.detail.work_order, state: "reported", claimed_by: { id: "U", name: "Claimant" }, progress: { percent: null, status: "running", message: "Actual message", source: "external_reported", reported_at: now }, submission: { id: "S", digest }, delivery_state: "accepted" };
  const tree = frame("facts", () => WorkOrderFacts({ order })); expect(JSON.stringify(tree)).toContain(copy.percentUnknown); expect(JSON.stringify(tree)).toContain(copy.deliveryStates.accepted); expect(JSON.stringify(tree)).not.toContain("50%");
});
it("uses the actual activity source consumer to link W with its real related Task, independently of ref order", () => {
  const w = { kind: "work_order" as const, id: "W", label: "Actual work", available: true, reason: null }, task = { kind: "task" as const, id: "T", label: "Actual task", available: true, reason: null };
  const tree = frame("activity", () => ActivitySourceLinks({ targets: [task, w], projectId: "P", background: location.hash, onNavigate: h.navigated }));
  const actions = nodes(tree).filter((node) => node.type === Button && node.props["data-action"] === "open-source"); actions[1].props.onClick();
  expect(parseExternalWorkOrderRoute(h.navigated.mock.calls[0][0])).toMatchObject({ projectId: "P", taskId: "T", workOrderId: "W", invalid: false });
});
it("lets the actual directory recover a stale cursor by returning to page one while keeping the filter", () => {
  location.hash = "#/ecosystem/a2a/dispatch?project_id=P&status=claimed&cursor=stale"; h.directoryError = new Error('HTTP 409: {"detail":{"code":"work_order_catalogue_changed","message":"Facts changed"}}');
  const tree = frame("workbench", () => ProjectWorkOrders()); button(tree, copy.first).onClick();
  expect(parseExternalWorkOrderRoute(location.hash)).toMatchObject({ status: "claimed", cursor: "", invalid: false });
});
it("renders the preserved safe portfolio return as an actual guarded header action", () => {
  const portfolio = "#/projects/portfolio?status=active";
  location.hash = `#/ecosystem/a2a/dispatch?project_id=P&return_to=${encodeURIComponent(portfolio)}`;
  const tree = frame("workbench", () => ProjectWorkOrders()), action = button(tree, copy.backToPortfolio), event = { preventDefault: vi.fn() };
  expect(action.href).toBe(portfolio); expect(action.disabled).toBe(false); action.onClick(event); expect(event.preventDefault).not.toHaveBeenCalled();
  h.canWrite = false;
  setSession("other-fixture-token", "AnotherProject", "tenant"); action.onClick(event); expect(event.preventDefault).toHaveBeenCalledTimes(1);
});
it("uses the same actual directory status and progress components on desktop and narrow screens without treating 100 percent as acceptance", () => {
  location.hash = "#/ecosystem/a2a/dispatch?project_id=P";
  const order = h.detail.work_order;
  order.state = "claimed"; order.progress = { percent: 100, status: "blocked", message: "Review found a real failing check", source: "external_reported", reported_at: now };
  const tree = workbench(), table = find(tree, Table);
  const status = table.columns.find((column: any) => column.key === "state").render(null, order);
  const progress = table.columns.find((column: any) => column.key === "progress").render(null, order);
  expect(status.type).toBe(WorkOrderStatusBadges); expect(progress.type).toBe(WorkOrderReportedProgress);
  expect(find(tree, WorkOrderStatusBadges).order).toBe(order); expect(find(tree, WorkOrderReportedProgress).order).toBe(order);
  const badges = WorkOrderStatusBadges(status.props), reported = WorkOrderReportedProgress(progress.props);
  expect(JSON.stringify(reported)).toContain(copy.blockedProgress); expect(JSON.stringify(reported)).toContain("100%"); expect(JSON.stringify(reported)).toContain(order.progress.message);
  expect(JSON.stringify(badges)).not.toContain(copy.deliveryStates.accepted);
  expect(nodes(badges).filter((node) => node.type === Tag && node.props.color === "success")).toHaveLength(0);
});
it("distinguishes a reported unknown percentage from no report and keeps invalidation visible on narrow screens", () => {
  location.hash = "#/ecosystem/a2a/dispatch?project_id=P";
  h.detail.work_order.invalidated = true;
  h.detail.work_order.progress = { percent: null, status: "running", message: "Still checking the logs", source: "external_reported", reported_at: now };
  const tree = workbench(), progress = WorkOrderReportedProgress(find(tree, WorkOrderReportedProgress));
  expect(JSON.stringify(progress)).toContain(copy.percentUnknown); expect(JSON.stringify(progress)).not.toContain(copy.noProgress);
  expect(JSON.stringify(WorkOrderStatusBadges(find(tree, WorkOrderStatusBadges)))).toContain(copy.states.stale);
  h.detail.work_order.progress = null;
  expect(JSON.stringify(WorkOrderReportedProgress(find(workbench(), WorkOrderReportedProgress)))).toContain(copy.noProgress);
});
it.each(["running", "blocked"])("shows a closed work order's last %s report as history and offers only its original detail", (status) => {
  location.hash = "#/ecosystem/a2a/dispatch?project_id=P";
  const order = h.detail.work_order;
  order.state = "closed"; order.claimed_by = { id: "U", name: "Claimant" }; order.claimed_at = now;
  order.progress = { percent: 100, status, message: "Last report before the external work stopped", source: "external_reported", reported_at: now };
  order.closure = { kind: "external_reported_stop", actor: { id: "U", name: "Claimant" }, comment: "External work stopped", at: now };
  const tree = workbench(), table = find(tree, Table), action = table.columns.find((column: any) => column.key === "actions").render(null, order);
  expect(action.props.children).toBe(copy.openOrder); expect(action.props.children).not.toBe(copy.openBlockedOrder);
  const progress = WorkOrderReportedProgress(find(tree, WorkOrderReportedProgress));
  expect(JSON.stringify(progress)).toContain(copy.observed); expect(find(progress, "time").dateTime).toBe(now);
  expect(JSON.stringify(WorkOrderStatusBadges(find(tree, WorkOrderStatusBadges)))).not.toContain(copy.deliveryStates.accepted);
});
it.each([
  ["awaiting_review", "openReport"], ["changes_requested", "openChanges"], ["accepted", "openAcceptanceRecord"], ["invalidated", "openReport"],
])("opens the precise existing S directly from both directory actions for %s and preserves the current page", (state, label) => {
  location.hash = "#/ecosystem/a2a/evidence?project_id=P&cursor=current-page";
  const background = location.hash, order = h.detail.work_order;
  order.state = "reported"; order.submission = { id: "S", digest }; order.delivery_state = state;
  const tree = workbench(), table = find(tree, Table), desktop = table.columns.find((column: any) => column.key === "actions").render(null, order);
  const mobile = find(tree, Button, (props) => props["data-action"] === "work-order-next");
  expect(desktop.props.children).toBe(copy[label as keyof typeof copy]); expect(mobile.children).toBe(desktop.props.children); expect(mobile.href).toBe(desktop.props.href);
  const params = new URLSearchParams(mobile.href.split("?")[1]);
  expect(mobile.href.split("?")[0]).toBe("#/tasks/execution"); expect(params.get("project_id")).toBe("P"); expect(params.get("task_id")).toBe("T"); expect(params.get("work_order_id")).toBe("W"); expect(params.get("submission_id")).toBe("S"); expect(params.get("return_to")).toBe(background);
  expect(JSON.stringify(WorkOrderStatusBadges(find(tree, WorkOrderStatusBadges)))).toContain(copy.deliveryStates[state as keyof typeof copy.deliveryStates]);
  const event = { preventDefault: vi.fn() }; mobile.onClick(event); expect(event.preventDefault).not.toHaveBeenCalled();
  setSession("other-fixture-token", "AnotherProject", "tenant"); mobile.onClick(event); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(location.hash).toBe(background);
});
it("opens the exact W for an unlinked blocker and keeps the existing draft exit guard on a captured report link", () => {
  location.hash = "#/ecosystem/a2a/dispatch?project_id=P&status=claimed&cursor=current-page";
  h.detail.work_order.state = "claimed"; h.detail.work_order.progress = { percent: null, status: "blocked", message: "Need access", source: "external_reported", reported_at: now };
  const action = find(workbench(), Button, (props) => props["data-action"] === "work-order-next");
  expect(action.children).toBe(copy.openBlockedOrder); expect(action.href).toBeUndefined(); action.onClick();
  expect(parseExternalWorkOrderRoute(location.hash)).toMatchObject({ projectId: "P", taskId: "T", workOrderId: "W", invalid: false });
  location.hash = "#/ecosystem/a2a/dispatch?project_id=P"; h.frames = {};
  h.detail.work_order.state = "reported"; h.detail.work_order.submission = { id: "S", digest }; h.detail.work_order.delivery_state = "awaiting_review";
  const captured = find(workbench(), Button, (props) => props["data-action"] === "work-order-next"), event = { preventDefault: vi.fn() };
  location.hash = "#/ecosystem/a2a/dispatch?project_id=P&task_id=T&work_order_id=W";
  find(workbench(), ExternalWorkOrderPanel).onEditingChange(true);
  captured.onClick(event); expect(event.preventDefault).toHaveBeenCalledOnce();
  find(workbench(), ExternalWorkOrderPanel).onEditingChange(false);
  captured.onClick(event); expect(event.preventDefault).toHaveBeenCalledTimes(1);
});
it("protects the actual standalone draft from view and portfolio navigation until its close callback clears the draft slot", () => {
  location.hash = "#/ecosystem/a2a/dispatch?project_id=P&task_id=T&work_order_id=W&return_to=%23%2Fprojects%2Fportfolio";
  const before = location.hash, oldBack = button(workbench(), copy.backToPortfolio), oldTab = button(workbench(), copy.history), event = { preventDefault: vi.fn() };
  button(workbenchPanel(), copy.claim).onClick();
  expect(button(workbench(), copy.back).disabled).toBe(true); expect(JSON.stringify(workbench())).toContain(copy.pendingNavigation);
  oldBack.onClick(event); oldTab.onClick(); expect(event.preventDefault).toHaveBeenCalledTimes(1); expect(location.hash).toBe(before);
  button(workbenchPanel(), copy.close).onClick(); expect(button(workbench(), copy.back).disabled).toBe(false);
  oldBack.onClick(event); expect(event.preventDefault).toHaveBeenCalledTimes(1); button(workbench(), copy.history).onClick();
  expect(parseExternalWorkOrderRoute(location.hash)).toMatchObject({ view: "orders", taskId: "", workOrderId: "", invalid: false });
});
it("feeds the actual standalone draft state into the existing native back and team-link exit protection", () => {
  location.hash = "#/ecosystem/a2a/negotiate?project_id=P&task_id=T"; h.current.executors = [];
  const target = new EventTarget(), browserLocation = { href: `http://local/${location.hash}` }, retained = browserLocation.href;
  let linkClick: ((event: any) => void) | undefined;
  const document = { addEventListener: (_name: string, callback: (event: any) => void) => { linkClick = callback; }, removeEventListener: () => {} };
  const nativeWindow = Object.assign(target, { location: browserLocation, document, history: { state: null, replaceState: (_state: unknown, _title: string, href: string) => { browserLocation.href = href; } } }) as unknown as Window;
  const dispose = installExecutionExitGuard(nativeWindow, () => Boolean(button(workbench(), copy.back).disabled), h.navigated);
  try {
    button(workbenchPanel(), copy.create).onClick(); const team = find(workbenchPanel(), "a"); expect(team.href).toContain("view=team");
    browserLocation.href = "http://local/#/previous"; target.dispatchEvent(new Event("popstate")); expect(browserLocation.href).toBe(retained);
    const event = { ctrlKey: false, metaKey: false, shiftKey: false, button: 0, target: { closest: () => ({ target: "", href: `http://local/${team.href}`, hasAttribute: () => false }) }, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    linkClick!(event); expect(event.preventDefault).toHaveBeenCalledTimes(1);
    button(workbenchPanel(), copy.close).onClick(); linkClick!(event); expect(event.preventDefault).toHaveBeenCalledTimes(1);
    browserLocation.href = "http://local/#/previous"; target.dispatchEvent(new Event("popstate")); expect(browserLocation.href).toBe("http://local/#/previous");
  } finally { dispose(); }
});
it("synchronously clears the standalone draft before the actual successful ACK selection navigates to the fixed W", async () => {
  location.hash = "#/ecosystem/a2a/negotiate?project_id=P&task_id=T";
  button(workbenchPanel(), copy.claim).onClick(); await button(workbenchPanel(), copy.prepare).onClick();
  expect(button(workbench(), copy.back).disabled).toBe(true); await button(workbenchPanel(), copy.confirm).onClick();
  expect(h.sent).toHaveLength(1); expect(parseExternalWorkOrderRoute(location.hash)).toMatchObject({ view: "orders", projectId: "P", taskId: "T", workOrderId: "W", invalid: false });
  expect(button(workbench(), copy.back).disabled).toBe(false);
});
it("keeps the standalone unknown-request slot protected independently of draft cleanup and permits exact replay", async () => {
  location.hash = "#/ecosystem/a2a/negotiate?project_id=P&task_id=T"; h.mode = "unknown";
  button(workbenchPanel(), copy.claim).onClick(); await button(workbenchPanel(), copy.prepare).onClick(); await button(workbenchPanel(), copy.confirm).onClick();
  const original = structuredClone(h.sent[0]); find(workbenchPanel(), Modal).onCancel();
  find(workbench(), ExternalWorkOrderPanel).onEditingChange(false); expect(button(workbench(), copy.back).disabled).toBe(true);
  h.mode = "success"; await find(workbenchPanel(), Button, (props) => props["data-action"] === "recover-work-order").onClick();
  expect(h.sent).toEqual([original, original]); expect(button(workbench(), copy.back).disabled).toBe(false);
  expect(parseExternalWorkOrderRoute(location.hash)).toMatchObject({ taskId: "T", workOrderId: "W", invalid: false });
});
it("cold-loads the same Task work-order slot before allowing the actual native queue editor", () => {
  const render = () => frame("task", () => DeliveryTaskDetail({ projectId: "P", taskId: "T", sessionId: "session" }));
  expect(find(render(), TaskDetailContent).canSubmitQueue()).toBe(true);
  const original = { action: "work_order.claim", binding: { task_id: "T", work_order_id: "W", request_digest: digest, packet_digest: digest, state: "queued" }, payload: { id: "W", order_revision: 1 }, intent: { version: 3, key: "retained-claim-1" } };
  h.storage.set(workOrderStorageKey("P", "T")!, JSON.stringify({ phase: "unknown", original })); h.frames = {};
  const tree = render(); expect(find(tree, TaskDetailContent).canSubmitQueue()).toBe(false);
  expect(find(tree, ExternalWorkOrderPanel).selectedOrderId).toBe("W"); expect(find(tree, ExternalWorkOrderPanel).isActive()).toBe(true);
});
it("carries an explicit work-order report request into the existing Task report editor without changing its submission schema", () => {
  location.hash += "&delivery_report=1";
  const tree = frame("task", () => DeliveryTaskDetail({ projectId: "P", taskId: "T", sessionId: "session" }));
  expect(find(tree, DeliveryTaskSubmissionPanel).requestCreate).toBe(1);
  expect(find(tree, DeliveryTaskSubmissionPanel)).not.toHaveProperty("source");
});

it("shows fixed W definition/instructions in the detail and claim dialog without downloading JSON", () => {
  h.detail.instructions = "Keep the checked release path";
  let tree = panel(); expect(find(tree, DefinitionFacts).definition).toEqual(h.detail.definition);
  const instruction = nodes(tree).find((node) => node.props["aria-label"] === taskDispatchCopy("zh-CN").instructions); expect(instruction).toBeDefined();
  expect(nodes(instruction).some((node) => node.props.children === "Keep the checked release path")).toBe(true);
  button(tree, copy.claim).onClick(); tree = panel(); const modal = find(tree, Modal);
  expect(find(modal.children, DefinitionFacts).definition).toEqual(h.detail.definition);
  expect(nodes(modal.children).some((node) => node.props.children === "Keep the checked release path")).toBe(true); expect(request).not.toHaveBeenCalled();
});
it("produces an exact historical S return CTA on the independent current Task rather than its old requirement", () => {
  h.reportDetail.submission.invalidated = true; h.reportDetail.submission.status = "invalidated";
  h.reportDetail.definition.requirement = { id: "OldRequirement" }; h.reportDetail.decision = { id: "D", review_id: "Review", decision: "request_changes", comment: "Fix the path", reviewer: { id: "R", name: "Reviewer" }, created_at: now };
  const tree = frame("S-facts", () => SubmissionFacts({ detail: h.reportDetail })), href = button(tree, taskDispatchCopy("zh-CN").feedback).href;
  expect(taskDispatchRequest(href, "P", "T")).toMatchObject({ open: true, feedback: { submission_id: "S", submission_digest: digest, decision_id: "D" } });
  expect(href).toContain("#/tasks/execution?"); expect(href).not.toContain("OldRequirement"); expect(href).not.toContain("Fix+the+path");
});
it("shows fixed historical title, issue, full original and safe artifact links apart from current acceptance", () => {
  const context: any = { schema: "manager.delivery-feedback.v1", project_id: "P", task_id: "T", reference: { submission_id: "S", submission_digest: digest, decision_id: "D" }, submission: { definition: h.detail.definition, payload: h.reportDetail.payload }, decision: { decision: "request_changes", review_id: "Review", comment: "Earlier feedback", reviewer: { id: "R", name: "Reviewer" }, created_at: now, issue_id: "Issue-original" } };
  context.submission.payload.artifacts[0].url = "https://example.test/evidence";
  const tree = frame("fixed-feedback", () => TaskDispatchFeedback({ context, fixed: true }));
  expect(nodes(tree).some((node) => node.props.children === h.detail.definition.title)).toBe(true);
  expect(nodes(tree).some((node) => Array.isArray(node.props.children) && node.props.children.includes("Issue-original"))).toBe(true);
  expect(nodes(tree).some((node) => node.type === "a" && node.props.href === "https://example.test/evidence" && node.props.rel === "noopener noreferrer")).toBe(true);
  expect(nodes(tree).some((node) => node.type === "pre" && node.props.children === JSON.stringify(context, null, 2))).toBe(true);
  for (const language of ["zh-CN", "en-US", "ja-JP"]) expect(externalWorkOrderReason(language, { code: "feedback_context_budget", message: "raw diagnostic" })).toBe(taskDispatchReason(language, "feedback_context_budget"));
});
