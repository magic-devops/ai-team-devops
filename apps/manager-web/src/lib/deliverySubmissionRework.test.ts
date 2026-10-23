/** Actual rework HTTP, payload and receipt consumers. Definitions only; not executed. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalDeliveryJson } from "./deliveryCanonical";
import { readSubmissionReworkPreview, adoptSubmissionRework, sameSubmissionRework, type SubmissionReworkPreview } from "./deliverySubmissionRework";
import { readSubmissionDetail, validSubmissionPayload, validSubmissionAck, type SubmissionOriginal } from "./deliveryTaskSubmission";
const io = vi.hoisted(() => ({ request: vi.fn(), scope: "scope" }));
vi.mock("./http", () => ({ request: io.request }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => io.scope }));
const hash = "a".repeat(64), other = "b".repeat(64), time = "2026-10-23T03:00:00Z";
const reference = { submission_id: "S1", submission_digest: hash, decision_id: "D1" };
const definition = { task_id: "T", title: "Task", description: "Scope", assigned_to: "", task_acceptance_criteria: ["Current criterion"], acceptance_criteria: ["Current criterion"], owner: null, requirement: null, dependency_basis: {}, designs: [], design_basis: hash };
const payload = { task_id: "T", task_basis: hash, definition_digest: hash, native_boundary_digest: hash, source: { kind: "tool" as const, name: "Earlier tool", url: "" }, summary: "Historical summary", artifacts: [{ id: "A", title: "Earlier evidence", content: "Original material", url: "", sha256: null }], criteria: [{ source: "task" as const, index: 0, text_digest: hash, result: "not_met" as const, evidence_ids: ["A"] }], tests: [{ id: "test", title: "Earlier check", status: "failed" as const, evidence_ids: ["A"] }] };
async function preview(): Promise<SubmissionReworkPreview> {
  const context = { schema: "manager.delivery-feedback.v1" as const, project_id: "P", task_id: "T", reference, submission: { definition, payload }, decision: { decision: "request_changes" as const, review_id: "R1", comment: "Fix the failed path", reviewer: { id: "U", name: "Reviewer" }, created_at: time, issue_id: "I1" } };
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalDeliveryJson(context))))).map((part) => part.toString(16).padStart(2, "0")).join("");
  return structuredClone({ project_id: "P", task_id: "T", version: 8, query_generation: 2, as_of: time, rework_reference: reference, rework_basis: hash, feedback_context: context, feedback_context_sha256: sha,
    current: { project_id: "P", task_id: "T", version: 8, query_generation: 2, as_of: time, task_basis: other, definition_digest: other, native_boundary_digest: other, definition, criteria: [{ source: "task", index: 0, text: "Current criterion", text_digest: other }], can_submit: true, reasons: [], latest_submission_id: "S2", work_order: null },
    draft: { source: null, summary: payload.summary, artifacts: structuredClone(payload.artifacts), criteria: [{ source: "task", index: 0, text_digest: other, result: "unknown", evidence_ids: [] }], tests: [{ id: "test", title: "Earlier check", status: "not_run", evidence_ids: [] }] }, allowed: true, reasons: [] } as SubmissionReworkPreview);
}
beforeEach(() => { io.request.mockReset(); io.scope = "scope"; });
describe("fixed external report rework", () => {
  it("previews only the selected S/digest/Decision and adopts reset current scope without an author or W", async () => {
    const expected = await preview(); io.request.mockResolvedValue(expected);
    const read = await readSubmissionReworkPreview("P", "T", "scope", reference);
    expect(io.request.mock.calls[0][0]).toBe("/api/v1/delivery/tasks/T/delivery-submissions/rework-preview");
    expect(JSON.parse(io.request.mock.calls[0][1].body)).toEqual({ rework_reference: reference });
    expect(io.request.mock.calls[0][1].method).toBe("POST");
    const adopted = adoptSubmissionRework(read); expect(adopted.source.name).toBe(""); expect(adopted).not.toHaveProperty("work_order");
    expect(adopted.summary).toBe(payload.summary); expect(adopted.criteria[0]).toMatchObject({ text_digest: other, result: "unknown", evidence_ids: [] });
    expect(adopted.tests[0]).toMatchObject({ status: "not_run", evidence_ids: [] }); expect(adopted.rework_reference).toEqual(reference);
    expect(validSubmissionPayload(adopted, "T")).toBe(false); adopted.source = { kind: "human", name: "Current worker", url: "" }; expect(validSubmissionPayload(adopted, "T")).toBe(true);
  });
  it.each(["foreign", "reference", "sha", "source", "criteria", "test", "work-order", "historical-material", "oversize"])("rejects malformed or misleading preview %s before adoption", async (change) => {
    const value: any = await preview();
    if (change === "foreign") value.current.project_id = "Q"; if (change === "reference") value.rework_reference.decision_id = "D2";
    if (change === "sha") value.feedback_context_sha256 = other; if (change === "source") value.draft.source = payload.source;
    if (change === "criteria") value.draft.criteria[0].result = "met"; if (change === "test") value.draft.tests[0].evidence_ids = ["A"];
    if (change === "work-order") value.draft.work_order = { id: "W", stopped_attestation: true };
    if (change === "historical-material") value.draft.artifacts[0].content = "Different material";
    if (change === "oversize") value.as_of = "x".repeat(262145);
    io.request.mockResolvedValue(value); await expect(readSubmissionReworkPreview("P", "T", "scope", reference)).rejects.toThrow("submissionReworkInvalid");
  });
  it("retains explicit denied reasons without manufacturing a reusable draft", async () => {
    const value = await preview(); value.allowed = value.current.can_submit = false; value.reasons = value.current.reasons = [{ code: "submission_write_required", message: "Write access unavailable" }];
    io.request.mockResolvedValue(value); const read = await readSubmissionReworkPreview("P", "T", "scope", reference);
    expect(read.reasons).toEqual(value.reasons); expect(() => adoptSubmissionRework(read)).toThrow("submissionReworkInvalid");
  });
  it("does not equate a changed fixed source or basis with an adopted draft", async () => {
    const first = await preview(), second = structuredClone(first); expect(sameSubmissionRework(first, second)).toBe(true);
    second.rework_basis = other; expect(sameSubmissionRework(first, second)).toBe(false);
  });
  it("reads complete fixed lineage and rejects changed context, source pair, target W or basis before rendering detail", async () => {
    const view = await preview(), p = adoptSubmissionRework(view); p.source = { kind: "human", name: "Current author", url: "" };
    const fixed = { schema: "manager.submission-rework.v1", reference: view.rework_reference, basis: "", feedback_context: view.feedback_context, feedback_context_sha256: view.feedback_context_sha256, feedback_runtime_scopes: [], target_work_order: null };
    const basis = { schema: "manager.submission-rework-basis.v1", project_id: "P", task_id: "T", reference: fixed.reference, feedback_context_sha256: fixed.feedback_context_sha256, feedback_runtime_scopes: [], task_basis: p.task_basis, definition_digest: p.definition_digest, native_boundary_digest: p.native_boundary_digest, target_work_order: null, draft: view.draft };
    fixed.basis = p.rework_basis = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalDeliveryJson(basis))))).map((part) => part.toString(16).padStart(2, "0")).join("");
    const detail = { project_id: "P", task_id: "T", version: 9, as_of: time, task_basis: p.task_basis, native_boundary_digest: p.native_boundary_digest, payload: p, definition,
      submission: { id: "S3", task_id: "T", created_at: time, submitted_by: { id: "Current", name: "Current author" }, source: p.source, summary: p.summary, digest: hash, task_basis: p.task_basis, definition_digest: p.definition_digest, native_boundary_digest: p.native_boundary_digest, status: "awaiting_review", invalidated: false, invalidated_at: null, invalidated_reason: "", counts: { artifacts: 1, criteria: 1, tests: 1, reported_passed: 0, reported_failed: 0 }, issue_id: null, review_id: null },
      decision: null, permissions: { can_review: true, can_accept: false, reasons: [] }, rework: fixed };
    io.request.mockResolvedValueOnce(detail); await expect(readSubmissionDetail("P", "T", "S3", "scope")).resolves.toEqual(detail);
    for (const change of ["context", "pair", "target", "basis", "missing"]) {
      const bad: any = structuredClone(detail); if (change === "context") bad.rework.feedback_context.decision.comment = "Edited after hashing";
      if (change === "pair") bad.payload.rework_reference.decision_id = "DifferentD"; if (change === "target") delete bad.rework.target_work_order;
      if (change === "basis") bad.rework.basis = bad.payload.rework_basis = hash; if (change === "missing") delete bad.rework;
      io.request.mockResolvedValueOnce(bad); await expect(readSubmissionDetail("P", "T", "S3", "scope")).rejects.toThrow("submissionInvalid");
    }
  });
  it("requires a complete selected lineage pair and exact matching ACK while leaving ordinary originals unchanged", () => {
    const p = { ...structuredClone(payload), rework_reference: reference, rework_basis: other };
    expect(validSubmissionPayload(p, "T")).toBe(true);
    for (const value of [{ ...payload, rework_reference: reference }, { ...payload, rework_basis: other }, { ...p, rework_basis: null }]) expect(validSubmissionPayload(value, "T")).toBe(false);
    const original: SubmissionOriginal = { action: "task.delivery.submit", payload: p, intent: { version: 8, key: "fixed-rework-key" } };
    const ack = { project_id: "P", action: original.action, resource: { kind: "task_submission", id: "S3" }, result: { task_ids: ["T"], submission_id: "S3", submission_digest: hash, issue_id: null, rework_reference: reference, rework_basis: other }, affected_refs: [{ kind: "task_submission", id: "S3" }, { kind: "task", id: "T" }], applied_version: 9, version: 9, query_generation: 3, replayed: false };
    expect(validSubmissionAck("P", "T", original, ack)).toBe(true);
    expect(validSubmissionAck("P", "T", original, { ...ack, result: { ...ack.result, rework_basis: hash } })).toBe(false);
    const ordinary = { ...original, payload }; expect(validSubmissionAck("P", "T", ordinary, ack)).toBe(false); expect(ordinary.payload).not.toHaveProperty("rework_reference");
  });
});
