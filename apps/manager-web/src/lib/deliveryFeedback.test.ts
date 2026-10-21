/** Actual fixed-feedback DTO/API/original consumer definitions; deliberately not executed in this phase. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalDeliveryJson } from "./deliveryCanonical";
import { validFeedbackReference, validFeedbackFields, verifyFeedbackFields, type FeedbackContext } from "./deliveryFeedback";
import { previewWorkOrder, readWorkOrderDetail } from "./externalWorkOrders";
import { createWorkOrderOriginal, validWorkOrderOriginal } from "./externalWorkOrderCommand";
import { previewDeliveryExecution } from "./deliveryExecution";
const io = vi.hoisted(() => ({ request: vi.fn(), scope: "scope" }));
vi.mock("./http", () => ({ request: io.request }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => io.scope }));
const hash = "a".repeat(64), now = "2026-10-21T04:00:00Z";
const reference = { submission_id: "S", submission_digest: hash, decision_id: "D" };
const definition = { task_id: "T", title: "Original task", description: "Earlier scope", assigned_to: "", task_acceptance_criteria: ["Original criterion"], acceptance_criteria: ["Original criterion"], owner: null, requirement: null, dependency_basis: {}, designs: [], design_basis: hash };
const payload = { task_id: "T", task_basis: hash, definition_digest: hash, native_boundary_digest: hash, source: { kind: "tool" as const, name: "Earlier tool", url: "" }, summary: "Original report", artifacts: [{ id: "A", title: "Reported output", content: "Original evidence", url: "", sha256: null }], criteria: [{ source: "task" as const, index: 0, text_digest: hash, result: "not_met" as const, evidence_ids: ["A"] }], tests: [{ id: "Test", title: "Earlier check", status: "failed" as const, evidence_ids: ["A"] }] };
function context(): FeedbackContext { return { schema: "manager.delivery-feedback.v1", project_id: "P", task_id: "T", reference: structuredClone(reference), submission: { definition: structuredClone(definition), payload: structuredClone(payload) }, decision: { decision: "request_changes", review_id: "Review", comment: "Fix the failing path", reviewer: { id: "reviewer with space", name: "Reviewer" }, created_at: now, issue_id: "I" } }; }
async function fields(value = context()) { const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalDeliveryJson(value))))).map((part) => part.toString(16).padStart(2, "0")).join(""); return { feedback_context: value, feedback_context_sha256: digest }; }
const executor = { id: "Tool", name: "External tool", kind: "tool", tool: "codex", active: true, available: true, reasons: [] };
const current = { project_id: "P", version: 3, query_generation: null, as_of: now, task_id: "T", task_basis: hash, definition_digest: hash, native_boundary_digest: hash, definition, executors: [executor], active_work_order_id: null, can_dispatch: true, reasons: [] };
const preview = { ...current, complete: true, allowed: true, preview_basis: hash, packet_digest: hash, executor, max_packet_bytes: 524288 };
const input = { task_basis: hash, executor_member_id: "Tool", instructions: "Current instructions", feedback_reference: reference };
beforeEach(() => { io.request.mockReset(); io.scope = "scope"; });
describe("immutable returned-delivery feedback", () => {
  it("keeps strict S/Decision identities without narrowing project/Task/reviewer identities", async () => {
    expect(validFeedbackReference(reference)).toBe(true);
    for (const id of ["with space", "../S", " S", "S/other", "S\\other", "S".repeat(65), "中文"]) {
      expect(validFeedbackReference({ ...reference, submission_id: id })).toBe(false);
      expect(validFeedbackReference({ ...reference, decision_id: id })).toBe(false);
    }
    expect(validFeedbackReference({ ...reference, comment: "not a reference" })).toBe(false);
    await expect(verifyFeedbackFields(await fields(), "P", "T", reference)).resolves.toBeUndefined();
  });
  it("requires pair presence, a selected exact reference and full matching scoped context", async () => {
    expect(validFeedbackFields({}, "P", "T")).toBe(true);
    expect(validFeedbackFields({ feedback_context: null, feedback_context_sha256: null }, "P", "T")).toBe(true);
    for (const value of [{ feedback_context: null }, { feedback_context_sha256: null }, { feedback_context: undefined, feedback_context_sha256: undefined }]) expect(validFeedbackFields(value, "P", "T")).toBe(false);
    const value = await fields(); expect(validFeedbackFields(value, "P", "T")).toBe(false);
    for (const [project, task, ref] of [["Other", "T", reference], ["P", "Other", reference], ["P", "T", { ...reference, decision_id: "Other" }]] as const) expect(validFeedbackFields(value, project, task, ref)).toBe(false);
    expect(validFeedbackFields({}, "P", "T", reference)).toBe(false);
    await expect(verifyFeedbackFields({ ...value, feedback_context_sha256: "b".repeat(64) }, "P", "T", reference)).rejects.toThrow("feedbackInvalid");
  });
  it("rejects changed historical data, malformed payload and complete context above the 64 KiB budget", async () => {
    const value = await fields(); value.feedback_context.decision.comment = "Changed after hashing";
    await expect(verifyFeedbackFields(value, "P", "T", reference)).rejects.toThrow("feedbackInvalid");
    const huge = context(); huge.submission.definition.description = "界".repeat(24000);
    expect(validFeedbackFields({ feedback_context: huge, feedback_context_sha256: hash }, "P", "T", reference)).toBe(false);
    const bad = context(); bad.submission.payload.criteria[0].evidence_ids = ["missing"];
    expect(validFeedbackFields({ feedback_context: bad, feedback_context_sha256: hash }, "P", "T", reference)).toBe(false);
  });
  it("sends only the exact reference to W preview, retains full verified preview, and persists only the reference", async () => {
    io.request.mockResolvedValue({ ...preview, ...await fields() });
    const shown = await previewWorkOrder("P", "T", io.scope, input), original = createWorkOrderOriginal(shown, input.instructions, "fixed-feedback-key");
    expect(JSON.parse(io.request.mock.calls[0][1].body)).toEqual(input);
    expect(original.payload.feedback_reference).toEqual(reference); expect(original.payload).not.toHaveProperty("feedback_context");
    expect(shown.feedback_context?.submission.payload.artifacts[0].content).toBe("Original evidence");
    expect(validWorkOrderOriginal(original, "T")).toBe(true);
    expect(validWorkOrderOriginal({ ...original, payload: { ...original.payload, feedback_context: context() } }, "T")).toBe(false);
  });
  it("preserves a denied W preview's actual reasons, but never accepts missing or malformed feedback for an allowed preview", async () => {
    const denied = { ...preview, allowed: false, complete: false, preview_basis: null, packet_digest: null, executor: null, reasons: [{ code: "feedback_reference_unavailable", message: "Selected original unavailable" }] };
    io.request.mockResolvedValueOnce(denied); await expect(previewWorkOrder("P", "T", io.scope, input)).resolves.toMatchObject({ allowed: false, reasons: denied.reasons });
    io.request.mockResolvedValueOnce({ ...denied, feedback_context: null }); await expect(previewWorkOrder("P", "T", io.scope, input)).rejects.toThrow("feedbackInvalid");
    io.request.mockResolvedValueOnce(preview); await expect(previewWorkOrder("P", "T", io.scope, input)).rejects.toThrow("feedbackInvalid");
    expect(() => createWorkOrderOriginal(denied as never, "", "blocked-original")).toThrow("workOrderPreviewRequired");
  });
  it("verifies E preview's returned context before it reaches the existing plan/original consumer", async () => {
    const value = { ...await fields(), project_id: "P" }; io.request.mockResolvedValueOnce(value);
    const p = { task_id: "T", feedback_reference: reference } as any;
    await expect(previewDeliveryExecution("P", p)).resolves.toBe(value);
    expect(JSON.parse(io.request.mock.calls[0][1].body)).toEqual(p);
    io.request.mockResolvedValueOnce({ ...value, feedback_context_sha256: "b".repeat(64) }); await expect(previewDeliveryExecution("P", p)).rejects.toThrow("feedbackInvalid");
  });
  it("does not reinterpret half-presence in an exact W detail as an old no-feedback record", async () => {
    io.request.mockResolvedValue({ project_id: "P", version: 3, query_generation: null, as_of: now, work_order: { id: "W", task_id: "T", task_title: "Task", order_revision: 1, state: "queued", request_digest: hash, packet_digest: hash, definition_digest: hash, native_boundary_digest: hash, executor, requested_by: { id: "Actor", name: "Actor" }, claimed_by: null, created_at: now, updated_at: now, claimed_at: null, invalidated: false, invalidated_reason: null, progress: null, submission: null, delivery_state: null, closure: null }, definition, instructions: "Fixed", permissions: { can_claim: true, can_progress: false, can_cancel: true, can_release: false, can_report: false, reasons: [] }, feedback_context: null });
    await expect(readWorkOrderDetail("P", "W", io.scope, "T")).rejects.toThrow("feedbackInvalid");
  });
});
