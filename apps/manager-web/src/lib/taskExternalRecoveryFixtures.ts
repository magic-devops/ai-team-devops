/** Source fixtures for actual retained-operation consumers; no runtime assertions here. */
import type { DeliveryCommandAck } from "./delivery";
import type { SubmissionOriginal } from "./deliveryTaskSubmission";
import type { WorkOrderOriginal } from "./externalWorkOrderCommand";

const hash = "a".repeat(64);
export function retainedSubmission(review = false): SubmissionOriginal {
  return { action: review ? "task.delivery.review" : "task.delivery.submit", intent: { version: 7, key: "fixed-external-report-key" }, payload: review ? {
    task_id: "T", submission_id: "S", submission_digest: hash, task_basis: hash, native_boundary_digest: hash, decision: "request_changes", comment: "Review this exact original",
  } : {
    task_id: "T", task_basis: hash, definition_digest: hash, native_boundary_digest: hash, source: { kind: "tool", name: "Original worker", url: "" }, summary: "Fixed external report",
    artifacts: [{ id: "A", title: "Reported evidence", content: "Fixed original evidence", url: "", sha256: null }],
    criteria: [{ source: "task", index: 0, text_digest: hash, result: "met", evidence_ids: ["A"] }], tests: [{ id: "Check", title: "Reported check", status: "passed", evidence_ids: ["A"] }],
    work_order: { id: "W", order_revision: 2, stopped_attestation: true },
  } };
}
export function retainedWorkOrder(): WorkOrderOriginal {
  return { action: "work_order.create", intent: { version: 7, key: "fixed-external-work-key" },
    payload: { task_id: "T", task_basis: hash, definition_digest: hash, native_boundary_digest: hash, executor_member_id: "Tool", preview_basis: hash,
      instructions: "The complete fixed work instructions", feedback_reference: { submission_id: "PreviousS", submission_digest: hash, decision_id: "PreviousDecision" } },
    binding: { task_id: "T", work_order_id: null, request_digest: null, packet_digest: hash, state: null } };
}
export function retainedAck(original: SubmissionOriginal | WorkOrderOriginal): DeliveryCommandAck {
  const work = original.action.startsWith("work_order."), review = original.action === "task.delivery.review";
  const resource = { kind: work ? "work_order" : review ? "task_review" : "task_submission", id: work ? "W" : review ? "Review" : "S" };
  return { project_id: "P", action: original.action, resource, applied_version: 8, version: 8, query_generation: null, replayed: true,
    affected_refs: [resource, { kind: "task", id: "T" }, ...(review ? [{ kind: "task_submission", id: "S" }] : []), ...(!work && !review ? [{ kind: "work_order", id: "W" }] : [])],
    result: work ? { work_order_id: "W", task_ids: ["T"], request_digest: hash, packet_digest: hash, order_revision: 1, state: "queued", submission_id: null }
      : { task_ids: ["T"], submission_id: "S", submission_digest: hash, issue_id: null, ...(review ? { decision_id: "Decision", review_id: "Review" } : { work_order: { id: "W", order_revision: 3, state: "reported" } }) } };
}
