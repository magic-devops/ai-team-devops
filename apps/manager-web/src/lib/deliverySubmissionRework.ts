import { canonicalDeliveryJson } from "./deliveryCanonical";
import { feedbackDigest, sameFeedbackReference, validFeedbackReference, type FeedbackReference } from "./deliveryFeedbackReference";
import { validSubmissionCurrent, validSubmissionFeedbackContext, verifySubmissionFeedbackDigest, submissionIdentity,
  type SubmissionArtifact, type SubmissionCriterion, type SubmissionCurrent, type SubmissionFeedbackContext, type SubmissionReason, type SubmissionTest, type TaskSubmissionPayload } from "./deliveryTaskSubmission";
import { request } from "./http";
import { projectSessionKey } from "./projectPortfolio";

export type SubmissionReworkDraft = { source: null; summary: string; artifacts: SubmissionArtifact[]; criteria: SubmissionCriterion[]; tests: SubmissionTest[] };
export type SubmissionReworkPreview = { project_id: string; task_id: string; version: number; query_generation: number | null; as_of: string;
  rework_reference: FeedbackReference; rework_basis: string; current: SubmissionCurrent; feedback_context: SubmissionFeedbackContext; feedback_context_sha256: string;
  draft: SubmissionReworkDraft; allowed: boolean; reasons: SubmissionReason[] };
const record = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exact = (value: Record<string, any>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const same = (left: unknown, right: unknown) => canonicalDeliveryJson(left) === canonicalDeliveryJson(right);
function validPreview(value: unknown, projectId: string, taskId: string, reference: FeedbackReference): value is SubmissionReworkPreview {
  if (!record(value) || !exact(value, ["project_id", "task_id", "version", "query_generation", "as_of", "rework_reference", "rework_basis", "current", "feedback_context", "feedback_context_sha256", "draft", "allowed", "reasons"]) ||
    value.project_id !== projectId || value.task_id !== taskId || !validFeedbackReference(value.rework_reference) || !sameFeedbackReference(value.rework_reference, reference) || !feedbackDigest(value.rework_basis) ||
    !validSubmissionCurrent(value.current, projectId, taskId) || value.version !== value.current.version || value.query_generation !== value.current.query_generation || value.as_of !== value.current.as_of ||
    !validSubmissionFeedbackContext(value.feedback_context, projectId, taskId, reference) || !feedbackDigest(value.feedback_context_sha256) || typeof value.allowed !== "boolean" || value.allowed !== value.current.can_submit ||
    !Array.isArray(value.reasons) || !same(value.reasons, value.current.reasons) || !record(value.draft) || !exact(value.draft, ["source", "summary", "artifacts", "criteria", "tests"]) || value.draft.source !== null) return false;
  const previous = value.feedback_context.submission.payload;
  const criteria = value.current.criteria.map(({ source, index, text_digest }: SubmissionCurrent["criteria"][number]) => ({ source, index, text_digest, result: "unknown", evidence_ids: [] }))
    .sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : a.index - b.index);
  const tests = previous.tests.map(({ id, title }) => ({ id, title, status: "not_run", evidence_ids: [] }));
  return value.draft.summary === previous.summary && same(value.draft.artifacts, previous.artifacts) && same(value.draft.criteria, criteria) && same(value.draft.tests, tests);
}
export async function readSubmissionReworkPreview(projectId: string, taskId: string, origin: string, reference: FeedbackReference, signal?: AbortSignal): Promise<SubmissionReworkPreview> {
  const inScope = () => { if (origin !== projectSessionKey()) throw new Error("submissionScopeChanged"); };
  inScope(); if (!submissionIdentity(projectId) || !submissionIdentity(taskId) || !validFeedbackReference(reference)) throw new Error("submissionReworkInvalid");
  const selected = structuredClone(reference);
  const value = await request<unknown>(`/api/v1/delivery/tasks/${encodeURIComponent(taskId)}/delivery-submissions/rework-preview`, { method: "POST", headers: { "X-Project-Id": projectId }, body: JSON.stringify({ rework_reference: selected }), signal });
  inScope();
  try {
    if (new TextEncoder().encode(canonicalDeliveryJson(value)).length > 256 * 1024 || !validPreview(value, projectId, taskId, selected)) throw new Error("submissionReworkInvalid");
    await verifySubmissionFeedbackDigest(value.feedback_context, value.feedback_context_sha256);
  } catch { throw new Error("submissionReworkInvalid"); }
  inScope(); return value as SubmissionReworkPreview;
}
export function sameSubmissionRework(a: SubmissionReworkPreview, b: SubmissionReworkPreview) {
  return sameFeedbackReference(a.rework_reference, b.rework_reference) && a.rework_basis === b.rework_basis;
}
export function adoptSubmissionRework(preview: SubmissionReworkPreview, edited?: TaskSubmissionPayload): TaskSubmissionPayload {
  if (!preview.allowed || !validPreview(preview, preview.project_id, preview.task_id, preview.rework_reference) || edited?.rework_reference && !sameFeedbackReference(edited.rework_reference, preview.rework_reference)) throw new Error("submissionReworkInvalid");
  const current = preview.current, draft = preview.draft;
  return { task_id: current.task_id, task_basis: current.task_basis, definition_digest: current.definition_digest, native_boundary_digest: current.native_boundary_digest,
    source: structuredClone(edited?.source || { kind: "human" as const, name: "", url: "" }), summary: edited?.summary ?? draft.summary,
    artifacts: structuredClone(edited?.artifacts || draft.artifacts), criteria: structuredClone(draft.criteria),
    tests: (edited?.tests || draft.tests).map(({ id, title }) => ({ id, title, status: "not_run" as const, evidence_ids: [] })),
    rework_reference: structuredClone(preview.rework_reference), rework_basis: preview.rework_basis };
}
