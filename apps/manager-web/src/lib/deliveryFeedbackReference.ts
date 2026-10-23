/** Fixed historical selection. No submission or execution runtime dependency. */
export type FeedbackReference = { submission_id: string; submission_digest: string; decision_id: string };
export const feedbackDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identity = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value);
export function validFeedbackReference(value: unknown): value is FeedbackReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 3 && ["submission_id", "submission_digest", "decision_id"].every((key) => Object.hasOwn(v, key)) && identity(v.submission_id) && feedbackDigest(v.submission_digest) && identity(v.decision_id);
}
export function sameFeedbackReference(a: FeedbackReference, b: FeedbackReference) {
  return a.submission_id === b.submission_id && a.submission_digest === b.submission_digest && a.decision_id === b.decision_id;
}
