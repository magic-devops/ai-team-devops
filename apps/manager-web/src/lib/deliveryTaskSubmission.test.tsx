/** Actual adapters/controllers/consumers. Definitions only: runtime validation is deferred. */
import { isValidElement, type ReactNode } from "react";
import { Button, Checkbox, Input, Modal, Select } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import { setSession, USER_KEY } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";
import { createSubmissionController, externalDeliveryRecoveryPending, parseSubmissionSelection, readSubmissionCurrent, readSubmissionDetail, readSubmissions,
  submissionStorageKey, validSubmissionAck, validSubmissionPayload, type SubmissionCurrent, type SubmissionDetail, type SubmissionOriginal, type SubmissionSummary, type TaskSubmissionPayload } from "./deliveryTaskSubmission";
import { adoptSubmissionDraft, DeliveryTaskSubmissionPanel, SubmissionFacts } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskSubmissionPanel";
import { DeliveryTaskDetail } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import { DeliveryManualReviewPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryManualReviewPanel";
import { TaskExternalRecovery } from "../../subapps/ai-rd-center/src/pages/delivery/TaskExternalRecovery";
import { taskSubmissionCopy, taskSubmissionReason } from "../i18n/task-submission";
import { eventTargetHref } from "./eventReceiptState";
import { issueEvidenceHref } from "./deliveryIssue";
import { canonicalDeliveryJson } from "./deliveryCanonical";
import { TaskSubmissionReworkPreview } from "../../subapps/ai-rd-center/src/pages/delivery/TaskSubmissionReworkPreview";

const h = vi.hoisted(() => ({ frames: {} as Record<string, any[]>, frame: "", next: 0, effects: [] as Array<() => void | (() => void)>, local: new Map<string, string>(), retained: new Map<string, string>(),
  current: {} as any, detail: {} as any, detailsById: null as Record<string, any> | null, page: {} as any, currentError: null as Error | null, detailError: null as Error | null, sent: [] as any[], queries: [] as any[], saved: vi.fn(), pending: vi.fn(),
  mode: "success" as "success" | "unknown", storageFail: false, canWrite: true, canStart: true, rework: null as any, taskData: {} as any, editing: vi.fn(),
}));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useRef: (initial: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
  useState: (initial: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
  useMemo: (factory: () => unknown, deps: unknown[]) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots) || deps.some((part, i) => part !== slots[index].deps[i])) slots[index] = { deps, value: factory() }; return slots[index].value; },
  useCallback: (value: unknown) => value, useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); }, useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }) }));
vi.mock("./http", async () => ({ ...await vi.importActual<typeof import("./http")>("./http"), request: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: any) => {
  h.queries.push(options); const kind = options.queryKey[0], data = kind === "delivery-task-submission-current" ? h.current : kind === "delivery-task-submission" ? h.detailsById ? h.detailsById[options.queryKey.at(-1)] : h.detail : kind === "delivery-task-detail" ? h.taskData : h.page;
  const error = kind === "delivery-task-submission-current" ? h.currentError : kind === "delivery-task-submission" ? h.detailError : null;
  return { data, error, isError: Boolean(error), isPending: !data, isFetching: false, refetch: vi.fn(async () => ({ data, isError: Boolean(error) })) };
}, useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}), resetQueries: vi.fn(async () => {}), getQueryData: () => h.taskData }) }));
const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64), d = "d".repeat(64), now = "2026-10-21T02:00:00Z", copy = taskSubmissionCopy("zh-CN");
const payload = (): TaskSubmissionPayload => ({ task_id: "T", task_basis: a, definition_digest: b, native_boundary_digest: c, source: { kind: "tool", name: "Codex", url: "" }, summary: "Implemented outside this platform",
  artifacts: [{ id: "e1", title: "Diff and check output", content: "Actual delivered change and reported check output", url: "https://example.com/pull/1", sha256: null }],
  criteria: [{ source: "task", index: 0, text_digest: d, result: "met", evidence_ids: ["e1"] }], tests: [{ id: "test1", title: "Acceptance check", status: "passed", evidence_ids: ["e1"] }] });
const current = (): SubmissionCurrent => ({ project_id: "P", task_id: "T", version: 7, query_generation: null, as_of: now, task_basis: a, definition_digest: b, native_boundary_digest: c,
  definition: { task_id: "T", title: "Task", description: "Current scope", assigned_to: "owner", task_acceptance_criteria: ["User can recover"], acceptance_criteria: ["User can recover"], owner: null, dependency_basis: {}, requirement: null, designs: [], design_basis: a },
  criteria: [{ source: "task", index: 0, text: "User can recover", text_digest: d }], can_submit: true, reasons: [], latest_submission_id: null, work_order: null });
const workOrder = () => ({ id: "W1", order_revision: 2, executor: { id: "tool:codex", name: "Codex", kind: "tool" as const, tool: "codex", active: true, available: true, reasons: [] } });
const summary = (): SubmissionSummary => ({ id: "S1", task_id: "T", created_at: now, submitted_by: { id: "U", name: "Submitter" }, source: payload().source, summary: payload().summary,
  digest: d, task_basis: a, definition_digest: b, native_boundary_digest: c, status: "awaiting_review", invalidated: false, invalidated_at: null, invalidated_reason: "",
  counts: { artifacts: 1, criteria: 1, tests: 1, reported_passed: 1, reported_failed: 0 }, issue_id: null, review_id: null });
const detail = (): SubmissionDetail => ({ project_id: "P", task_id: "T", version: 7, as_of: now, task_basis: a, native_boundary_digest: c, submission: summary(), payload: payload(), definition: current().definition,
  decision: null, permissions: { can_review: true, can_accept: true, reasons: [] } });
const original = (review = false): SubmissionOriginal => ({ action: review ? "task.delivery.review" : "task.delivery.submit", payload: review ? { task_id: "T", submission_id: "S1", submission_digest: d, task_basis: a, native_boundary_digest: c, decision: "accept", comment: "Reviewed actual evidence" } : payload(), intent: { version: 7, key: "original-submission-key" } });
function ack(value: SubmissionOriginal, issue: string | null = null) {
  const review = value.action === "task.delivery.review", resource = { kind: review ? "task_review" : "task_submission", id: review ? "R1" : "S1" };
  const binding = review ? null : (value.payload as TaskSubmissionPayload).work_order;
  const rework = !review && (value.payload as TaskSubmissionPayload).rework_reference ? { rework_reference: (value.payload as TaskSubmissionPayload).rework_reference, rework_basis: (value.payload as TaskSubmissionPayload).rework_basis } : {};
  return { project_id: "P", action: value.action, resource, result: { task_ids: ["T"], submission_id: "S1", submission_digest: d, issue_id: issue, ...rework, ...(review ? { decision_id: "K1", review_id: "R1" } : {}), ...(binding ? { work_order: { id: binding.id, order_revision: binding.order_revision + 1, state: "reported" } } : {}) },
    affected_refs: [resource, { kind: "task", id: "T" }, ...(review ? [{ kind: "task_submission", id: "S1" }] : []), ...(issue ? [{ kind: "issue", id: issue }] : []), ...(binding ? [{ kind: "work_order", id: binding.id }] : [])],
    applied_version: value.intent.version + 1, version: value.intent.version + 1, query_generation: null, replayed: false };
}
function frame<T>(name: string, callback: () => T) { h.frame = name; h.next = 0; return callback(); }
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; if (node.type === TaskExternalRecovery) return [node, ...nodes(frame("original-recovery", () => TaskExternalRecovery(node.props)))]; return [node, ...["children", "footer", "action", "description"].flatMap((key) => nodes(node.props[key]))]; }
const find = (tree: ReactNode, type: unknown, predicate: (props: any) => boolean = () => true) => nodes(tree).find((node) => node.type === type && predicate(node.props))?.props;
const button = (tree: ReactNode, text: string) => find(tree, Button, (props) => props.children === text);
const panel = () => frame("panel", () => DeliveryTaskSubmissionPanel({ projectId: "P", taskId: "T", sessionId: "session", canSubmit: () => h.canWrite, canStart: () => h.canStart, onSaved: h.saved, onUnresolvedChange: h.pending, onEditingChange: h.editing }));
async function ready(handoff = false) {
  button(panel(), copy.create).onClick();
  const input = (type: unknown, label: string, value: string) => find(panel(), type, (props) => props["aria-label"] === label).onChange({ target: { value } });
  input(Input, copy.name, "Codex"); input(Input.TextArea, copy.summary, "External change"); input(Input, `${copy.evidenceTitle} 1`, "Diff"); input(Input.TextArea, `${copy.content} 1`, "Actual changes");
  find(panel(), Select, (props) => props["aria-label"] === `${copy.criteria} 1`).onChange("met"); find(panel(), Select, (props) => props["aria-label"] === `${copy.evidenceIds} 1`).onChange(["evidence-1"]);
  if (handoff) find(panel(), Checkbox).onChange({ target: { checked: true } });
  await button(panel(), handoff ? copy.previewHandoff : h.current.work_order ? copy.previewOnly : copy.preview).onClick(); return panel();
}
beforeEach(() => {
  h.frames = {}; h.frame = ""; h.next = 0; h.effects = []; h.local.clear(); h.retained.clear(); h.sent = []; h.queries = []; h.saved.mockReset(); h.pending.mockReset(); h.editing.mockReset(); h.mode = "success"; h.storageFail = false; h.canWrite = true; h.canStart = true; h.rework = null;
  h.current = current(); h.detail = detail(); h.detailsById = null; h.page = { project_id: "P", task_id: "T", as_of: now, items: [summary()], total: 1, limit: 20, next_cursor: null }; h.currentError = null; h.detailError = null;
  h.taskData = { project: { id: "P" }, version: 7, query_generation: 1, permissions: { write: true }, members: [], task: { id: "T", execution_id: "", execution_gate: { eligible: true, reasons: [] } } };
  vi.stubGlobal("localStorage", { getItem: (key: string) => h.local.get(key) || null, setItem: (key: string, value: string) => h.local.set(key, value), removeItem: (key: string) => h.local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => h.retained.get(key) || null, setItem: (key: string, value: string) => { if (h.storageFail && (!value || JSON.parse(value).phase === "succeeded")) throw new Error("Storage unavailable"); h.retained.set(key, value); } });
  const location = { hash: "#/dev-flow?project_id=P&task=T", href: "http://localhost/#/dev-flow?project_id=P&task=T" };
  vi.stubGlobal("location", location); vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  setSession("private-token", "P", "tenant"); h.local.set(USER_KEY, JSON.stringify({ id: "U", tenant_id: "tenant" }));
  // The command hook uses the real session-bound HTTP transport, not the exported read mock.
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url), "http://fixture.invalid");
    const value = await request(parsed.pathname + parsed.search, init);
    return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.mocked(request).mockReset().mockImplementation(async (path, init) => {
    if (path.endsWith("/rework-preview")) return h.rework; if (path.endsWith("/current")) return h.current; if (path.includes("/delivery-submissions?")) return h.page; if (path.includes("/delivery-submissions/")) return h.detail;
    const body = JSON.parse(String(init?.body)); h.sent.push(body); if (h.mode === "unknown") throw new TypeError("Lost reply");
    return ack({ action: body.action, payload: body.payload, intent: { version: body.expected_version, key: body.idempotency_key } });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("external submission actual contract and read definitions", () => {
  it("reads canonical current and exact original with an explicit project", async () => {
    expect(await readSubmissionCurrent("P", "T", projectSessionKey())).toEqual(current()); expect(await readSubmissionDetail("P", "T", "S1", projectSessionKey())).toEqual(detail());
    expect(vi.mocked(request).mock.calls.map(([path]) => path)).toEqual(["/api/v1/delivery/tasks/T/delivery-submissions/current", "/api/v1/delivery/tasks/T/delivery-submissions/S1"]);
    expect(new Headers(vi.mocked(request).mock.calls[0][1]?.headers).get("X-Project-Id")).toBe("P");
  });
  it("keeps one bounded history page and its opaque cursor", async () => {
    await readSubmissions("P", "T", projectSessionKey(), "opaque/+?="); expect(request).toHaveBeenCalledTimes(1);
    expect(vi.mocked(request).mock.calls[0][0]).toBe("/api/v1/delivery/tasks/T/delivery-submissions?limit=20&cursor=opaque%2F%2B%3F%3D");
  });
  it("supports Unicode task identity and rejects a completed read after a new login", async () => {
    h.current = { ...current(), task_id: "任务一", definition: { ...current().definition, task_id: "任务一" } };
    await readSubmissionCurrent("P", "任务一", projectSessionKey()); expect(vi.mocked(request).mock.calls[0][0]).toContain(encodeURIComponent("任务一"));
    let finish!: (value: unknown) => void; vi.mocked(request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = readSubmissionCurrent("P", "T", projectSessionKey()); setSession("private-token", "P", "tenant"); finish(current());
    await expect(pending).rejects.toThrow("submissionScopeChanged");
  });
  it.each(["project", "task", "submission", "digest"])("rejects wrong %s original facts", async (field) => {
    const value: any = detail(); if (field === "project") value.project_id = "Q"; if (field === "task") value.payload.task_id = "foreign"; if (field === "submission") value.submission.id = "other"; if (field === "digest") value.payload.definition_digest = a;
    vi.mocked(request).mockResolvedValueOnce(value); await expect(readSubmissionDetail("P", "T", "S1", projectSessionKey())).rejects.toThrow("submissionInvalid");
  });
  it.each(["duplicate", "dangling", "passed-no-evidence", "url", "budget"])("rejects invalid report %s", (change) => {
    const value = payload(); if (change === "duplicate") value.criteria.push(value.criteria[0]); if (change === "dangling") value.criteria[0].evidence_ids = ["missing"];
    if (change === "passed-no-evidence") value.tests[0].evidence_ids = []; if (change === "url") value.artifacts[0].url = "https://secret:password@example.com/evidence";
    if (change === "budget") value.artifacts = Array.from({ length: 7 }, (_, index) => ({ ...value.artifacts[0], id: `e${index}`, content: "x".repeat(8000) }));
    expect(validSubmissionPayload(value, "T")).toBe(false);
  });
  it("preserves reports of failure, not-run and unknown without calling them acceptance", () => {
    const value = payload(); value.criteria[0].result = "not_met"; value.tests[0].status = "failed"; expect(validSubmissionPayload(value, "T")).toBe(true);
    value.tests[0].status = "not_run"; value.tests[0].evidence_ids = []; expect(validSubmissionPayload(value, "T")).toBe(true);
  });
  it.each(["zh-CN", "en-US", "ja-JP"])("provides known restrictions in %s and preserves unknown server messages", (language) => {
    const codes = taskSubmissionCopy(language).reasonCodes;
    expect(Object.keys(codes).sort()).toEqual(Object.keys(copy.reasonCodes).sort());
    for (const [code, message] of Object.entries(codes)) expect(taskSubmissionReason(language, { code, message: "Raw server detail" })).toBe(message);
    expect(taskSubmissionReason(language, { code: "future_specific_reason", message: "Exact future server detail" })).toBe("Exact future server detail");
  });
  it("uses exact route selection and refuses foreign or duplicated identities without choosing latest", () => {
    for (const [path, task] of [["#/dev-flow", "task"], ["#/tasks/execution", "task_id"]]) {
      expect(parseSubmissionSelection(`${path}?project_id=P&${task}=T&submission_id=S1`, "P", "T")).toEqual({ id: "S1", invalid: false });
      const other = task === "task" ? "task_id" : "task";
      for (const suffix of [
        `project_id=Q&${task}=T&submission_id=S1`, `project_id=P&${task}=other&submission_id=S1`,
        `project_id=P&${task}=T&submission_id=S1&submission_id=S1`, `project_id=P&${task}=T&submission_id=S1&submission_id=S2`,
        `project_id=P&project_id=P&${task}=T&submission_id=S1`, `project_id=P&${task}=T&${task}=T&submission_id=S1`,
        `project_id=P&${task}=T&${task}=other&submission_id=S1`, `project_id=P&${other}=T&submission_id=S1`,
        `project_id=P&${task}=T&${other}=T&submission_id=S1`, `project_id=P&${task}=T&${other}=other&submission_id=S1`,
      ]) expect(parseSubmissionSelection(`${path}?${suffix}`, "P", "T")).toEqual({ id: "", invalid: true });
    }
    expect(parseSubmissionSelection("#/other?project_id=P&task=T&submission_id=S1", "P", "T")).toEqual({ id: "", invalid: true });
  });
  it("adopts changed criteria only by stable source/index/text digest and resets changed reports", () => {
    const next = current(); next.criteria[0].text = "New condition"; next.criteria[0].text_digest = b;
    const adopted = adoptSubmissionDraft(payload(), next); expect(adopted.criteria[0]).toMatchObject({ result: "unknown", evidence_ids: [], text_digest: b }); expect(adopted.artifacts).toEqual(payload().artifacts);
  });
});

describe("report and work-order handoff through the actual form and command controller (unrun)", () => {
  it("requires a fresh stop statement and sends one fixed S command for the exact W", async () => {
    h.current.work_order = workOrder();
    button(panel(), copy.create).onClick();
    expect(find(panel(), Checkbox).checked).toBe(false);
    expect(button(panel(), copy.previewHandoff).disabled).toBe(true);
    expect(find(panel(), Input, (props) => props["aria-label"] === copy.name).value).toBe("Codex");
    await button(panel(), copy.previewHandoff).onClick();
    expect(h.sent).toEqual([]); expect(JSON.stringify(panel())).toContain(copy.stopRequired);
    button(panel(), copy.close).onClick();
    const prepared = await ready(true);
    await button(prepared, copy.confirmHandoff).onClick();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ action: "task.delivery.submit", expected_version: 7, payload: { work_order: { id: "W1", order_revision: 2, stopped_attestation: true } } });
    expect(JSON.stringify(panel())).toContain(copy.submittedHandoff);
    expect(h.saved).toHaveBeenCalledTimes(1);
  });
  it("can save only the report while a work order remains held, without inventing a stop statement", async () => {
    h.current.work_order = workOrder();
    await button(await ready(), copy.confirm).onClick();
    expect(h.sent).toHaveLength(1); expect(h.sent[0].payload.work_order).toBeUndefined();
    expect(JSON.stringify(panel())).toContain(copy.submitted);
  });
  it.each(["id", "order_revision", "removed"])("keeps report contents but requires adoption and a new stop statement after W %s changes", async (change) => {
    h.current.work_order = workOrder(); button(panel(), copy.create).onClick();
    find(panel(), Input.TextArea, (props) => props["aria-label"] === copy.summary).onChange({ target: { value: "Keep this report" } });
    find(panel(), Checkbox).onChange({ target: { checked: true } });
    h.current = { ...current(), work_order: change === "removed" ? null : { ...workOrder(), ...(change === "id" ? { id: "W2" } : { order_revision: 3 }) } };
    await button(panel(), copy.previewHandoff).onClick();
    expect(button(panel(), copy.adopt)).toBeDefined(); expect(h.sent).toHaveLength(0);
    button(panel(), copy.adopt).onClick();
    expect(find(panel(), Input.TextArea, (props) => props["aria-label"] === copy.summary).value).toBe("Keep this report");
    if (change !== "removed") { expect(find(panel(), Checkbox).checked).toBe(false); expect(button(panel(), copy.previewHandoff).disabled).toBe(true); }
  });
  it.each([false, 1, "true", null, undefined])("rejects non-explicit stopped attestation %s in the actual original validator", (stopped) => {
    const report: any = payload(); report.work_order = { id: "W1", order_revision: 2, stopped_attestation: stopped };
    expect(validSubmissionPayload(report, "T")).toBe(false);
  });
  it.each(["../W1", "W/1", "W\\1", "\ud800", "W\u0085"])("rejects malformed bound W identity %s before transport", (id) => {
    const report = payload(); report.work_order = { id, order_revision: 2, stopped_attestation: true };
    expect(validSubmissionPayload(report, "T")).toBe(false);
  });
  it.each(["missing", "revision", "body", "foreign"])("rejects malformed current handoff context %s", async (change) => {
    const value: any = current(); value.work_order = workOrder();
    if (change === "missing") delete value.work_order;
    if (change === "revision") value.work_order.order_revision = true;
    if (change === "body") value.work_order.packet = { arbitrary: "not a thin context" };
    if (change === "foreign") value.project_id = "Q";
    vi.mocked(request).mockResolvedValueOnce(value);
    await expect(readSubmissionCurrent("P", "T", projectSessionKey())).rejects.toThrow("submissionInvalid");
  });
  it.each(["id", "revision", "state", "ref", "missing"])("refuses a handoff ACK with wrong %s", (change) => {
    const value = original(); (value.payload as TaskSubmissionPayload).work_order = { id: "W1", order_revision: 2, stopped_attestation: true };
    const answer: any = ack(value);
    if (change === "id") answer.result.work_order.id = "W2";
    if (change === "revision") answer.result.work_order.order_revision = 2;
    if (change === "state") answer.result.work_order.state = "claimed";
    if (change === "ref") answer.affected_refs = answer.affected_refs.filter((item: any) => item.kind !== "work_order");
    if (change === "missing") delete answer.result.work_order;
    expect(validSubmissionAck("P", "T", value, answer)).toBe(false);
  });
  it("retains the entire S/W original across transport loss and replays one unchanged command", async () => {
    let raw: string | null = null; const sent: string[] = []; const value = original();
    (value.payload as TaskSubmissionPayload).work_order = { id: "W1", order_revision: 2, stopped_attestation: true };
    const controller = () => createSubmissionController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => "scope", load: () => raw, save: (next) => { raw = next; }, send: async (captured) => { sent.push(JSON.stringify(captured)); if (sent.length === 1) throw new TypeError("Lost reply"); return ack(captured); } });
    await controller().run(value);
    (value.payload as TaskSubmissionPayload).work_order!.id = "W2";
    await controller().replay(); expect(sent).toHaveLength(2); expect(sent[1]).toBe(sent[0]); expect(JSON.parse(sent[1]).payload.work_order.id).toBe("W1");
  });
  it("releases the draft synchronously before the saved callback, without releasing an unknown command", async () => {
    const prepared = await ready(); expect(h.editing.mock.calls).toEqual([[true]]);
    h.saved.mockImplementationOnce(() => expect(h.editing.mock.calls).toEqual([[true], [false]]));
    await button(prepared, copy.confirm).onClick(); expect(h.saved).toHaveBeenCalledTimes(1);
    h.editing.mockReset(); h.frames = {}; h.mode = "unknown";
    await button(await ready(), copy.confirm).onClick();
    expect(h.editing.mock.calls).toEqual([[true]]); expect(externalDeliveryRecoveryPending("P", "T")).toBe(true);
  });
  it("opens the fixed report's linked work order without changing acceptance", () => {
    const value = detail(); value.payload.work_order = { id: "W1", order_revision: 2, stopped_attestation: true };
    const tree = frame("facts", () => SubmissionFacts({ detail: value }));
    const href = button(tree, copy.openWorkOrder).href;
    expect(href).toContain("work_order_id=W1"); expect(href).toContain("submission_id=S1"); expect(href).toContain("project_id=P");
    expect(JSON.stringify(tree)).toContain(copy.stoppedReported); expect(JSON.stringify(tree)).toContain(copy.statuses.awaiting_review);
  });
});

describe("external submit/review exact receipt and durable originals", () => {
  it.each([false, true])("retains and replays identical original for review=%s", async (review) => {
    let raw: string | null = null; const sent: string[] = []; const value = original(review);
    const create = () => createSubmissionController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => "scope", load: () => raw, save: (text) => { raw = text; }, send: async (captured) => { sent.push(JSON.stringify(captured)); if (sent.length === 1) throw new TypeError("Lost reply"); return ack(captured); } });
    await create().run(value); value.intent.version = 99; await create().replay(); expect(sent).toHaveLength(2); expect(sent[1]).toBe(sent[0]); expect(create().snapshot().phase).toBe("succeeded");
  });
  it.each(["project", "version", "resource", "extra-result", "duplicate-ref", "missing-issue", "wrong-original"])("rejects malformed review ACK %s", (change) => {
    const value = original(true), answer: any = ack(value, "I1"); if (change === "project") answer.project_id = "Q"; if (change === "version") answer.applied_version++;
    if (change === "resource") answer.resource.id = "other"; if (change === "extra-result") answer.result.verified = true; if (change === "duplicate-ref") answer.affected_refs.push(answer.affected_refs[0]);
    if (change === "missing-issue") answer.affected_refs.pop(); if (change === "wrong-original") answer.result.submission_digest = a;
    expect(validSubmissionAck("P", "T", value, answer)).toBe(false);
  });
  it("does not depend on reference order and does bind the real linked issue", () => { const value = original(), answer = ack(value, "I1"); answer.affected_refs.reverse(); expect(validSubmissionAck("P", "T", value, answer)).toBe(true); });
  it("partitions retained keys by user/login/project/task without credentials", () => {
    const first = submissionStorageKey("P", "T")!; expect(first).not.toContain("private-token"); expect(submissionStorageKey("P", "U")).not.toBe(first);
    setSession("private-token", "P", "tenant"); expect(submissionStorageKey("P", "T")).not.toBe(first);
  });
});

async function reworkFacts() {
  h.current.latest_submission_id = "S1";
  h.detail.submission.status = "changes_requested"; h.detail.submission.review_id = "R1";
  h.detail.decision = { id: "D1", review_id: "R1", decision: "request_changes", reviewer: { id: "Reviewer", name: "Human reviewer" }, comment: "Repair the failed case", created_at: now };
  const reference = { submission_id: "S1", submission_digest: h.detail.submission.digest, decision_id: "D1" };
  const context = { schema: "manager.delivery-feedback.v1", project_id: "P", task_id: "T", reference, submission: { definition: structuredClone(h.detail.definition), payload: structuredClone(h.detail.payload) }, decision: { ...h.detail.decision, issue_id: h.detail.submission.issue_id } };
  delete (context.decision as any).id;
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalDeliveryJson(context))))).map((part) => part.toString(16).padStart(2, "0")).join("");
  h.rework = { project_id: "P", task_id: "T", version: h.current.version, query_generation: h.current.query_generation, as_of: h.current.as_of, rework_reference: reference, rework_basis: a,
    current: structuredClone(h.current), feedback_context: context, feedback_context_sha256: sha, allowed: true, reasons: [],
    draft: { source: null, summary: h.detail.payload.summary, artifacts: structuredClone(h.detail.payload.artifacts),
      criteria: h.current.criteria.map(({ source, index, text_digest }: any) => ({ source, index, text_digest, result: "unknown", evidence_ids: [] })).sort((left: any, right: any) => left.source.localeCompare(right.source) || left.index - right.index),
      tests: h.detail.payload.tests.map(({ id, title }: any) => ({ id, title, status: "not_run", evidence_ids: [] })) } };
  return structuredClone(h.rework);
}
async function reworkDraft() {
  await reworkFacts(); await button(panel(), copy.rework).onClick();
  const preview = find(panel(), TaskSubmissionReworkPreview); expect(preview).toBeDefined(); preview.onAdopt(); return panel();
}
describe("actual selected-source rework report interaction definitions", () => {
  it("requires preview and explicit adoption, resets old conclusions and never inherits source or stop", async () => {
    h.detail.payload.work_order = { id: "OldW", order_revision: 1, stopped_attestation: true };
    await reworkFacts(); await button(panel(), copy.rework).onClick(); expect(h.sent).toHaveLength(0); expect(h.editing).not.toHaveBeenCalled();
    expect(find(panel(), Modal).open).toBe(false); const preview = find(panel(), TaskSubmissionReworkPreview); preview.onAdopt();
    const tree = panel(); expect(find(tree, Modal).open).toBe(true); expect(h.editing).toHaveBeenCalledWith(true);
    expect(find(tree, Select, (props) => props["aria-label"] === copy.kind).value).toBeUndefined();
    expect(find(tree, Input, (props) => props["aria-label"] === copy.name).value).toBe("");
    expect(find(tree, Select, (props) => props["aria-label"] === `${copy.criteria} 1`).value).toBe("unknown");
    expect(find(tree, Select, (props) => props["aria-label"] === `${copy.tests} 1`).value).toBe("not_run");
    await button(tree, copy.preview).onClick(); expect(button(panel(), copy.confirm)).toBeUndefined(); expect(JSON.stringify(panel())).toContain(copy.reworkSourceRequired);
  });
  it("submits current declared results with selected S/digest/Decision rather than a newer report", async () => {
    await reworkDraft();
    find(panel(), Select, (props) => props["aria-label"] === copy.kind).onChange("agent");
    find(panel(), Input, (props) => props["aria-label"] === copy.name).onChange({ target: { value: "Current agent" } });
    const newer = structuredClone(h.detail); newer.submission.id = "S2"; newer.decision.id = "D2"; h.detailsById = { S1: h.detail, S2: newer };
    h.current.latest_submission_id = "S2"; h.rework.current.latest_submission_id = "S2";
    const cleanup = h.effects.splice(0).map((effect) => effect()); window.dispatchEvent(new Event("popstate"));
    panel(); expect(h.queries.filter((query) => query.queryKey[0] === "delivery-task-submission").at(-1).queryKey.at(-1)).toBe("S1");
    await button(panel(), copy.preview).onClick(); expect(button(panel(), copy.confirm)).toBeDefined();
    await button(panel(), copy.confirm).onClick(); expect(h.sent).toHaveLength(1);
    expect(h.sent[0].payload.rework_reference).toEqual({ submission_id: "S1", submission_digest: d, decision_id: "D1" });
    expect(h.sent[0].payload.source).toEqual({ kind: "agent", name: "Current agent", url: "" }); expect(h.sent[0].payload).not.toHaveProperty("work_order");
    cleanup.forEach((close) => { if (typeof close === "function") close(); });
  });
  it("preserves edits when fixed basis changes, and resets result links only after adopting it explicitly", async () => {
    await reworkDraft(); find(panel(), Select, (props) => props["aria-label"] === copy.kind).onChange("tool");
    find(panel(), Input, (props) => props["aria-label"] === copy.name).onChange({ target: { value: "Current tool" } });
    find(panel(), Input.TextArea, (props) => props["aria-label"] === copy.summary).onChange({ target: { value: "Edited summary" } });
    find(panel(), Select, (props) => props["aria-label"] === `${copy.criteria} 1`).onChange("met");
    find(panel(), Select, (props) => props["aria-label"] === `${copy.evidenceIds} 1`).onChange(["e1"]);
    h.rework.rework_basis = b; h.rework.current.task_basis = b;
    await button(panel(), copy.preview).onClick(); expect(button(panel(), copy.confirm)).toBeUndefined();
    expect(find(panel(), Input.TextArea, (props) => props["aria-label"] === copy.summary).value).toBe("Edited summary");
    expect(find(panel(), Select, (props) => props["aria-label"] === `${copy.criteria} 1`).value).toBe("met");
    button(panel(), copy.adopt).onClick(); expect(find(panel(), Input.TextArea, (props) => props["aria-label"] === copy.summary).value).toBe("Edited summary");
    expect(find(panel(), Select, (props) => props["aria-label"] === `${copy.criteria} 1`).value).toBe("unknown"); expect(h.sent).toHaveLength(0);
  });
  it.each(["other-draft", "permission", "selected-source", "route", "account"])("discards the awaited preview after %s changed", async (change) => {
    const response = await reworkFacts(); let resolve!: (value: unknown) => void; h.rework = new Promise((done) => { resolve = done; });
    const pending = button(panel(), copy.rework).onClick();
    if (change === "other-draft") h.canStart = false; if (change === "permission") h.canWrite = false;
    if (change === "selected-source") { h.detail = structuredClone(h.detail); h.detail.decision.id = "Other"; panel(); }
    if (change === "route") { location.hash += "&submission_id=Other"; window.dispatchEvent(new Event("hashchange")); }
    if (change === "account") setSession("other-token", "P", "tenant");
    resolve(response); await pending; expect(find(panel(), TaskSubmissionReworkPreview)).toBeUndefined(); expect(h.sent).toHaveLength(0); expect(h.editing).not.toHaveBeenCalled();
  });
  it("closes both the readonly preview and edited draft after fresh write permission is revoked", async () => {
    await reworkFacts(); await button(panel(), copy.rework).onClick(); const preview = find(panel(), TaskSubmissionReworkPreview); h.canWrite = false; preview.onClose(); expect(find(panel(), TaskSubmissionReworkPreview)).toBeUndefined();
    h.canWrite = true; await reworkDraft(); const close = button(panel(), copy.close); h.canWrite = false; close.onClick(); expect(find(panel(), Modal).open).toBe(false); expect(h.editing).toHaveBeenLastCalledWith(false);
  });
  it("does not let an old preview's adopt or close callback affect a later preview", async () => {
    await reworkFacts(); await button(panel(), copy.rework).onClick(); const old = find(panel(), TaskSubmissionReworkPreview); old.onClose();
    await button(panel(), copy.rework).onClick(); const next = find(panel(), TaskSubmissionReworkPreview); old.onAdopt(); old.onClose();
    expect(find(panel(), TaskSubmissionReworkPreview).preview).toBe(next.preview); expect(h.editing).not.toHaveBeenCalled(); expect(h.sent).toHaveLength(0);
  });
  it.each(["permission", "other-draft"])("does not prepare a human review after awaited %s changed", async (change) => {
    h.current.latest_submission_id = "S1"; button(panel(), copy.accept).onClick();
    find(panel(), Input.TextArea, (props) => props["aria-label"] === copy.comment).onChange({ target: { value: "Reviewed evidence" } });
    let resolve!: (value: unknown) => void; vi.mocked(request).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const waiting = button(panel(), copy.reviewPreview).onClick(); if (change === "permission") h.canWrite = false; else h.canStart = false;
    resolve(detail()); await waiting; expect(button(panel(), copy.reviewConfirm)).toBeUndefined(); expect(h.sent).toHaveLength(0);
  });
});

describe("actual external delivery interaction definitions", () => {
  it("keeps external submission available without a runtime provider and labels reported evidence honestly", async () => {
    const tree = await ready(); expect(h.sent).toHaveLength(0); expect(JSON.stringify(tree)).toContain(copy.reportOnly); expect(button(tree, copy.confirm)).toBeDefined();
    expect(h.queries.some((query) => query.queryKey[0] === "delivery-targets")).toBe(false);
  });
  it("shows warm unknown recovery inside the modal and invalidates old confirmation/edit/close callbacks", async () => {
    const tree = await ready(), confirm = button(tree, copy.confirm), edit = button(tree, copy.edit), close = button(tree, copy.close), modal = find(tree, Modal);
    h.mode = "unknown"; await confirm.onClick(); expect(h.sent).toHaveLength(1);
    confirm.onClick(); edit.onClick(); close.onClick(); modal.onCancel(); expect(h.sent).toHaveLength(1); expect(find(panel(), Modal).open).toBe(true);
    const recovery = find(find(panel(), Modal).children, Button, (props) => props["data-action"] === "recover-submission"); expect(recovery).toBeDefined();
    h.mode = "success"; await recovery.onClick(); expect(h.sent[1]).toEqual(h.sent[0]); expect(h.saved).toHaveBeenCalledTimes(1);
  });
  it("restores a cold original and replays it despite current read failure and revoked fresh submission", async () => {
    h.mode = "unknown"; await button(await ready(), copy.confirm).onClick(); const before = structuredClone(h.sent[0]); h.frames = {}; h.currentError = new Error("HTTP 403: current unavailable"); h.canWrite = false; h.mode = "success";
    await find(panel(), Button, (props) => props["data-action"] === "recover-submission").onClick(); expect(h.sent[1]).toEqual(before); expect(externalDeliveryRecoveryPending("P", "T")).toBe(false);
  });
  it("retains a confirmed ACK through cleanup failure and never repeats its write", async () => {
    const tree = await ready(); h.storageFail = true; await button(tree, copy.confirm).onClick(); expect(h.sent).toHaveLength(1); expect(h.saved).not.toHaveBeenCalled();
    const finish = find(panel(), Button, (props) => props["data-action"] === "finish-submission-original"); expect(finish).toBeDefined(); h.storageFail = false; await finish.onClick();
    expect(h.sent).toHaveLength(1); expect(h.saved).toHaveBeenCalledTimes(1); expect(externalDeliveryRecoveryPending("P", "T")).toBe(false);
  });
  it("requires explicit adoption after a native boundary or criterion changes", async () => {
    button(panel(), copy.create).onClick(); h.current = { ...current(), native_boundary_digest: b }; await button(panel(), copy.preview).onClick();
    expect(button(panel(), copy.confirm)).toBeUndefined(); expect(button(panel(), copy.adopt)).toBeDefined(); expect(h.sent).toHaveLength(0);
  });
  it.each(["#/dev-flow?project_id=P&task=T&submission_id=S1", "#/tasks/execution?project_id=P&task_id=T&submission_id=S1"])("selects exact S instead of latest on %s", (hash) => {
    location.hash = hash; h.current.latest_submission_id = "S2"; panel();
    expect(h.queries.find((query) => query.queryKey[0] === "delivery-task-submission").queryKey.at(-1)).toBe("S1");
  });
  it("opens the actual event target navigation output as the exact report in the panel", async () => {
    vi.mocked(request).mockResolvedValueOnce({ project_id: "P", task_id: "T", submission_id: "S1" })
      .mockResolvedValueOnce({ project_id: "P", task: { id: "T", req_id: "R" } });
    const back = "#/intelligence/events?project_id=P&event_receipt=E";
    const href = await eventTargetHref("P", { kind: "task_delivery_submitted", target_kind: "task_submission", target_id: "S1" }, back);
    expect(href).toContain("task=T"); expect(href).toContain("event_return=");
    expect(parseSubmissionSelection(href, "P", "T")).toEqual({ id: "S1", invalid: false });
    location.hash = href; h.current.latest_submission_id = "S2"; panel();
    expect(h.queries.find((query) => query.queryKey[0] === "delivery-task-submission").queryKey.at(-1)).toBe("S1");
    expect(vi.mocked(request).mock.calls.map(([path]) => path)).toEqual(["/api/v1/delivery/delivery-submissions/S1/locator", "/api/v1/delivery/tasks/T"]);
  });
  it("opens the actual issue evidence navigation output as the exact report in the panel", () => {
    const href = issueEvidenceHref("P", { project_id: "P", task_id: "T", submission_id: "S1", requirement_id: "R" }, "#/dev-flow?project_id=P&view=issues&issue=I1");
    expect(href).toBeTruthy(); expect(href).toContain("task=T"); expect(href).toContain("return_to=");
    expect(parseSubmissionSelection(href!, "P", "T")).toEqual({ id: "S1", invalid: false });
    location.hash = href!; h.current.latest_submission_id = "S2"; panel();
    expect(h.queries.find((query) => query.queryKey[0] === "delivery-task-submission").queryKey.at(-1)).toBe("S1");
    expect(request).not.toHaveBeenCalled();
  });
  it("does not let a successful current fact read confirm an unknown original ACK", async () => {
    h.mode = "unknown"; await button(await ready(), copy.confirm).onClick();
    h.current.latest_submission_id = "S1"; h.detail = { ...detail(), submission: { ...summary(), status: "accepted" } };
    button(panel(), copy.refresh).onClick(); expect(find(panel(), Button, (props) => props["data-action"] === "recover-submission")).toBeDefined();
    expect(h.saved).not.toHaveBeenCalled(); expect(h.sent).toHaveLength(1); expect(externalDeliveryRecoveryPending("P", "T")).toBe(true);
  });
  it("uses canonical human-review permissions rather than reported passing tests", () => {
    h.current.latest_submission_id = "S1"; h.detail.permissions.can_accept = false;
    const tree = panel(); expect(button(tree, copy.accept).disabled).toBe(true); expect(button(tree, copy.reject).disabled).toBe(false); expect(h.sent).toHaveLength(0);
  });
  it("shows localized current restrictions with original code and server detail inside disclosure", () => {
    h.current.can_submit = false; h.current.reasons = [{ code: "submission_native_stop_unverified", message: "Positive process-stop evidence is required before external takeover." }];
    const tree = panel();
    expect(find(tree, "p", (props) => props.children === copy.reasonCodes.submission_native_stop_unverified)).toBeDefined();
    const disclosure = nodes(tree).find((node) => node.type === "details" && JSON.stringify(node).includes("submission_native_stop_unverified"));
    expect(disclosure).toBeDefined(); expect(JSON.stringify(disclosure)).toContain(h.current.reasons[0].message); expect(button(tree, copy.create).disabled).toBe(true);
  });
  it("localizes invalidation while retaining the exact code in its disclosure", () => {
    const value = detail(); value.submission.invalidated = true; value.submission.invalidated_reason = "submission_definition_changed";
    const tree = frame("facts", () => SubmissionFacts({ detail: value }));
    expect(JSON.stringify(tree)).toContain(copy.reasonCodes.submission_definition_changed);
    expect(find(tree, "code", (props) => props.children === "submission_definition_changed")).toBeDefined();
  });
  it("localizes a canonical read restriction and keeps its original server code available", () => {
    h.currentError = new Error('HTTP 409: {"detail":{"code":"project_archived","message":"Restore the project before editing."}}');
    const tree = panel(); expect(JSON.stringify(tree)).toContain(copy.reasonCodes.project_archived);
    expect(find(tree, "code", (props) => props.children === "project_archived")).toBeDefined(); expect(button(tree, copy.create).disabled).toBe(true);
  });
  it("keeps a reported passing test distinct from human acceptance and opens its existing issue", () => {
    const value = detail(); value.submission.issue_id = "I1";
    const tree = frame("facts", () => SubmissionFacts({ detail: value })); expect(JSON.stringify(tree)).toContain(copy.testStates.passed); expect(JSON.stringify(tree)).toContain(copy.statuses.awaiting_review);
    expect(button(tree, copy.issue).href).toContain("issue=I1"); expect(button(tree, copy.issue).href).toContain("project_id=P");
  });
  it("blocks a captured fresh submit button after the current read fails", () => {
    const old = button(panel(), copy.create); h.currentError = new Error("HTTP 503: unavailable"); panel(); old.onClick(); expect(find(panel(), Modal).open).toBe(false); expect(h.sent).toHaveLength(0);
  });
  it("mounts exactly one persistent external owner in TaskDetail and blocks other fresh task writes when its original is pending", async () => {
    h.mode = "unknown"; await button(await ready(), copy.confirm).onClick();
    const tree = frame("parent", () => DeliveryTaskDetail({ projectId: "P", taskId: "T", sessionId: "session" }));
    expect(nodes(tree).filter((node) => node.type === DeliveryTaskSubmissionPanel)).toHaveLength(1);
    expect(find(tree, DeliveryManualReviewPanel).canSubmit()).toBe(false);
  });
});
