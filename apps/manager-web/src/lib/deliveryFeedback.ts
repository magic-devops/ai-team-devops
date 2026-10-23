import { validSubmissionFeedbackContext, verifySubmissionFeedbackDigest, type SubmissionFeedbackContext } from "./deliveryTaskSubmission";
import { feedbackDigest, type FeedbackReference } from "./deliveryFeedbackReference";
export { feedbackDigest, sameFeedbackReference, validFeedbackReference, type FeedbackReference } from "./deliveryFeedbackReference";
export type FeedbackContext = SubmissionFeedbackContext;
export type FeedbackFields = { feedback_context?: FeedbackContext | null; feedback_context_sha256?: string | null };
const record = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === "object" && !Array.isArray(v));
export const validFeedbackContext = validSubmissionFeedbackContext;
export function validFeedbackFields(value: unknown, projectId: string, taskId: string, reference?: FeedbackReference | null): value is FeedbackFields {
  if (!record(value)) return false;
  const contextPresent = Object.hasOwn(value, "feedback_context"), digestPresent = Object.hasOwn(value, "feedback_context_sha256");
  if (contextPresent !== digestPresent) return false;
  if (!reference && (!contextPresent || value.feedback_context === null && value.feedback_context_sha256 === null)) return true;
  return Boolean(reference) && validFeedbackContext(value.feedback_context, projectId, taskId, reference) && feedbackDigest(value.feedback_context_sha256);
}
export async function verifyFeedbackFields(value: FeedbackFields, projectId: string, taskId: string, reference?: FeedbackReference | null) {
  if (!validFeedbackFields(value, projectId, taskId, reference)) throw new Error("feedbackInvalid");
  if (value.feedback_context) await verifySubmissionFeedbackDigest(value.feedback_context, value.feedback_context_sha256!);
}
