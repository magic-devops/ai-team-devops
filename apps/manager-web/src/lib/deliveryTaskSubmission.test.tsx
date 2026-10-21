/** Actual adapters/controllers/consumers. Definitions only: runtime validation is deferred. */
import { isValidElement, type ReactNode } from "react";
import { Button, Input, Modal, Select } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import { setSession, USER_KEY } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";
import { createSubmissionController, externalDeliveryRecoveryPending, parseSubmissionSelection, readSubmissionCurrent, readSubmissionDetail, readSubmissions,
  submissionStorageKey, validSubmissionAck, validSubmissionPayload, type SubmissionCurrent, type SubmissionDetail, type SubmissionOriginal, type SubmissionSummary, type TaskSubmissionPayload } from "./deliveryTaskSubmission";
import { adoptSubmissionDraft, DeliveryTaskSubmissionPanel, SubmissionFacts } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskSubmissionPanel";
import { DeliveryTaskDetail } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import { DeliveryManualReviewPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryManualReviewPanel";
import { taskSubmissionCopy, taskSubmissionReason } from "../i18n/task-submission";
import { eventTargetHref } from "./eventReceiptState";
import { issueEvidenceHref } from "./deliveryIssue";

const h = vi.hoisted(() => ({ frames: {} as Record<string, any[]>, frame: "", next: 0, local: new Map<string, string>(), retained: new Map<string, string>(),
  current: {} as any, detail: {} as any, page: {} as any, currentError: null as Error | null, detailError: null as Error | null, sent: [] as any[], queries: [] as any[], saved: vi.fn(), pending: vi.fn(),
  mode: "success" as "success" | "unknown", storageFail: false, canWrite: true, taskData: {} as any,
}));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useRef: (initial: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
  useState: (initial: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
  useMemo: (factory: () => unknown, deps: unknown[]) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots) || deps.some((part, i) => part !== slots[index].deps[i])) slots[index] = { deps, value: factory() }; return slots[index].value; },
  useCallback: (value: unknown) => value, useEffect: () => {}, useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }) }));
vi.mock("./http", async () => ({ ...await vi.importActual<typeof import("./http")>("./http"), request: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: any) => {
  h.queries.push(options); const kind = options.queryKey[0], data = kind === "delivery-task-submission-current" ? h.current : kind === "delivery-task-submission" ? h.detail : kind === "delivery-task-detail" ? h.taskData : h.page;
  const error = kind === "delivery-task-submission-current" ? h.currentError : kind === "delivery-task-submission" ? h.detailError : null;
  return { data, error, isError: Boolean(error), isPending: !data, isFetching: false, refetch: vi.fn(async () => ({ data, isError: Boolean(error) })) };
}, useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}), resetQueries: vi.fn(async () => {}), getQueryData: () => h.taskData }) }));
const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64), d = "d".repeat(64), now = "2026-10-21T02:00:00Z", copy = taskSubmissionCopy("zh-CN");
const payload = (): TaskSubmissionPayload => ({ task_id: "T", task_basis: a, definition_digest: b, native_boundary_digest: c, source: { kind: "tool", name: "Codex", url: "" }, summary: "Implemented outside this platform",
  artifacts: [{ id: "e1", title: "Diff and check output", content: "Actual delivered change and reported check output", url: "https://example.com/pull/1", sha256: null }],
  criteria: [{ source: "task", index: 0, text_digest: d, result: "met", evidence_ids: ["e1"] }], tests: [{ id: "test1", title: "Acceptance check", status: "passed", evidence_ids: ["e1"] }] });
const current = (): SubmissionCurrent => ({ project_id: "P", task_id: "T", version: 7, query_generation: null, as_of: now, task_basis: a, definition_digest: b, native_boundary_digest: c,
  definition: { task_id: "T", title: "Task", description: "Current scope", assigned_to: "owner", task_acceptance_criteria: ["User can recover"], acceptance_criteria: ["User can recover"], owner: null, dependency_basis: {}, requirement: null, designs: [], design_basis: a },
  criteria: [{ source: "task", index: 0, text: "User can recover", text_digest: d }], can_submit: true, reasons: [], latest_submission_id: null });
const summary = (): SubmissionSummary => ({ id: "S1", task_id: "T", created_at: now, submitted_by: { id: "U", name: "Submitter" }, source: payload().source, summary: payload().summary,
  digest: d, task_basis: a, definition_digest: b, native_boundary_digest: c, status: "awaiting_review", invalidated: false, invalidated_at: null, invalidated_reason: "",
  counts: { artifacts: 1, criteria: 1, tests: 1, reported_passed: 1, reported_failed: 0 }, issue_id: null, review_id: null });
const detail = (): SubmissionDetail => ({ project_id: "P", task_id: "T", version: 7, as_of: now, task_basis: a, native_boundary_digest: c, submission: summary(), payload: payload(), definition: current().definition,
  decision: null, permissions: { can_review: true, can_accept: true, reasons: [] } });
const original = (review = false): SubmissionOriginal => ({ action: review ? "task.delivery.review" : "task.delivery.submit", payload: review ? { task_id: "T", submission_id: "S1", submission_digest: d, task_basis: a, native_boundary_digest: c, decision: "accept", comment: "Reviewed actual evidence" } : payload(), intent: { version: 7, key: "original-submission-key" } });
function ack(value: SubmissionOriginal, issue: string | null = null) {
  const review = value.action === "task.delivery.review", resource = { kind: review ? "task_review" : "task_submission", id: review ? "R1" : "S1" };
  return { project_id: "P", action: value.action, resource, result: { task_ids: ["T"], submission_id: "S1", submission_digest: d, issue_id: issue, ...(review ? { decision_id: "K1", review_id: "R1" } : {}) },
    affected_refs: [resource, { kind: "task", id: "T" }, ...(review ? [{ kind: "task_submission", id: "S1" }] : []), ...(issue ? [{ kind: "issue", id: issue }] : [])],
    applied_version: value.intent.version + 1, version: value.intent.version + 1, query_generation: null, replayed: false };
}
function frame<T>(name: string, callback: () => T) { h.frame = name; h.next = 0; return callback(); }
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...["children", "footer", "action", "description"].flatMap((key) => nodes(node.props[key]))]; }
const find = (tree: ReactNode, type: unknown, predicate: (props: any) => boolean = () => true) => nodes(tree).find((node) => node.type === type && predicate(node.props))?.props;
const button = (tree: ReactNode, text: string) => find(tree, Button, (props) => props.children === text);
const panel = () => frame("panel", () => DeliveryTaskSubmissionPanel({ projectId: "P", taskId: "T", sessionId: "session", canSubmit: () => h.canWrite, onSaved: h.saved, onUnresolvedChange: h.pending }));
async function ready() {
  button(panel(), copy.create).onClick();
  const input = (type: unknown, label: string, value: string) => find(panel(), type, (props) => props["aria-label"] === label).onChange({ target: { value } });
  input(Input, copy.name, "Codex"); input(Input.TextArea, copy.summary, "External change"); input(Input, `${copy.evidenceTitle} 1`, "Diff"); input(Input.TextArea, `${copy.content} 1`, "Actual changes");
  find(panel(), Select, (props) => props["aria-label"] === `${copy.criteria} 1`).onChange("met"); find(panel(), Select, (props) => props["aria-label"] === `${copy.evidenceIds} 1`).onChange(["evidence-1"]);
  await button(panel(), copy.preview).onClick(); return panel();
}
beforeEach(() => {
  h.frames = {}; h.frame = ""; h.next = 0; h.local.clear(); h.retained.clear(); h.sent = []; h.queries = []; h.saved.mockReset(); h.pending.mockReset(); h.mode = "success"; h.storageFail = false; h.canWrite = true;
  h.current = current(); h.detail = detail(); h.page = { project_id: "P", task_id: "T", as_of: now, items: [summary()], total: 1, limit: 20, next_cursor: null }; h.currentError = null; h.detailError = null;
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
    if (path.endsWith("/current")) return h.current; if (path.includes("/delivery-submissions?")) return h.page; if (path.includes("/delivery-submissions/")) return h.detail;
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

describe("external submit/review exact receipt and durable originals", () => {
  it.each([false, true])("retains and replays identical original for review=%s", async (review) => {
    let raw: string | null = null; const sent: string[] = []; const value = original(review);
    const create = () => createSubmissionController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => "scope", load: () => raw, save: (text) => { raw = text; }, send: async (captured) => { sent.push(JSON.stringify(captured)); if (sent.length === 1) throw new TypeError("Lost reply"); return ack(captured); } });
    await create().run(value); value.intent.version = 99; await create().replay(); expect(sent).toHaveLength(2); expect(sent[1]).toBe(sent[0]); expect(create().snapshot().phase).toBe("idle");
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
    const finish = find(panel(), Button, (props) => props["data-action"] === "finish-submission"); expect(finish).toBeDefined(); h.storageFail = false; await finish.onClick();
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
