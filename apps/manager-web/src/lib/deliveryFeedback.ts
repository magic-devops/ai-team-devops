import { canonicalDeliveryJson } from "./deliveryCanonical";
import { submissionIdentity, validSubmissionDefinition, validSubmissionPayload, type SubmissionDefinition, type TaskSubmissionPayload } from "./deliveryTaskSubmission";
export type FeedbackReference = { submission_id: string; submission_digest: string; decision_id: string };
export type FeedbackContext = { schema: "manager.delivery-feedback.v1"; project_id: string; task_id: string; reference: FeedbackReference; submission: { definition: SubmissionDefinition; payload: TaskSubmissionPayload }; decision: { decision: "request_changes"; review_id: string; comment: string; reviewer: { id: string; name: string }; created_at: string; issue_id: string | null } };
export type FeedbackFields = { feedback_context?: FeedbackContext | null; feedback_context_sha256?: string | null };
const record = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const exact = (v: Record<string, any>, keys: string[]) => Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
export const feedbackDigest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const feedbackIdentity = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(v);
export function validFeedbackReference(v: unknown): v is FeedbackReference { return record(v) && exact(v, ["submission_id", "submission_digest", "decision_id"]) && feedbackIdentity(v.submission_id) && feedbackDigest(v.submission_digest) && feedbackIdentity(v.decision_id); }
export function sameFeedbackReference(a: FeedbackReference, b: FeedbackReference) { return a.submission_id === b.submission_id && a.submission_digest === b.submission_digest && a.decision_id === b.decision_id; }
export function validFeedbackContext(v: unknown, projectId: string, taskId: string, reference?: FeedbackReference | null): v is FeedbackContext {
  if (!record(v) || !exact(v, ["schema", "project_id", "task_id", "reference", "submission", "decision"]) || v.schema !== "manager.delivery-feedback.v1" || v.project_id !== projectId || v.task_id !== taskId || !validFeedbackReference(v.reference) || reference && !sameFeedbackReference(v.reference, reference) || !record(v.submission) || !exact(v.submission, ["definition", "payload"]) || !validSubmissionDefinition(v.submission.definition, taskId) || !validSubmissionPayload(v.submission.payload, taskId) || !record(v.decision) || !exact(v.decision, ["decision", "review_id", "comment", "reviewer", "created_at", "issue_id"]) || v.decision.decision !== "request_changes" || !submissionIdentity(v.decision.review_id) || typeof v.decision.comment !== "string" || !record(v.decision.reviewer) || !exact(v.decision.reviewer, ["id", "name"]) || !submissionIdentity(v.decision.reviewer.id) || typeof v.decision.reviewer.name !== "string" || typeof v.decision.created_at !== "string" || !Number.isFinite(Date.parse(v.decision.created_at)) || !(v.decision.issue_id === null || submissionIdentity(v.decision.issue_id))) return false;
  try { return new TextEncoder().encode(canonicalDeliveryJson(v)).length <= 65536; } catch { return false; }
}
export function validFeedbackFields(value: unknown, projectId: string, taskId: string, reference?: FeedbackReference | null): value is FeedbackFields {
  if (!record(value)) return false;
  const contextPresent = Object.hasOwn(value, "feedback_context"), digestPresent = Object.hasOwn(value, "feedback_context_sha256");
  if (contextPresent !== digestPresent) return false;
  if (!reference && (!contextPresent || value.feedback_context === null && value.feedback_context_sha256 === null)) return true;
  return Boolean(reference) && validFeedbackContext(value.feedback_context, projectId, taskId, reference) && feedbackDigest(value.feedback_context_sha256);
}
export async function verifyFeedbackFields(value: FeedbackFields, projectId: string, taskId: string, reference?: FeedbackReference | null) {
  if (!validFeedbackFields(value, projectId, taskId, reference)) throw new Error("feedbackInvalid");
  if (value.feedback_context) { const bytes = new TextEncoder().encode(canonicalDeliveryJson(value.feedback_context)); const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((part) => part.toString(16).padStart(2, "0")).join(""); if (digest !== value.feedback_context_sha256) throw new Error("feedbackInvalid"); }
}
