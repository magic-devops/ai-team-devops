import {
  prepareDeliveryIntent,
  safeEvidenceUrl,
  type DeliveryIntent,
} from "./delivery";
import { planError } from "./deliveryTaskPlan";
import { request } from "./http";
import type { TaskAcceptance } from "./taskAcceptance";
import { safeExecutionReturn } from "./executionCommands";
import { preserveProjectContext } from "./projectPortfolioRoute";
import { deliveryInboxHref } from "./deliveryProjectInbox";

export type ReviewTask = {
  id: string;
  title: string;
  description: string;
  req_id: string;
  status: string;
  assigned_to: string;
  priority: string;
  estimate: string;
  blocked_reason: string;
  acceptance_criteria: string[] | null;
};
export type ReviewOwner = {
  id: string;
  name: string;
  kind: string;
  active: boolean;
};
export type ReviewRequirement = {
  id: string;
  title: string;
  description: string;
  revision: number;
  acceptance_criteria: string[];
  blocked_reason: string;
};
export type ReviewPlanning = {
  requirement_criteria_indices: number[] | null;
  depends_on: string[];
};
export type ManualReviewCurrent = {
  task: ReviewTask;
  basis: string;
  owner: ReviewOwner | null;
  requirement: ReviewRequirement | null;
  planning: ReviewPlanning;
  acceptance: TaskAcceptance;
  eligible: boolean;
  can_review: boolean;
  can_accept: boolean;
  reasons: { code: string; message: string }[];
  dependency_blocked: string[];
  verified: boolean;
  dependency_basis: Record<string, string>;
};
export type ManualTaskReview = {
  id: string;
  task_id: string;
  decision: "accept" | "request_changes";
  created_at: string;
  reviewer: { id: string; name: string };
  task_basis: string;
  snapshot: {
    task: ReviewTask;
    owner: ReviewOwner | null;
    requirement: ReviewRequirement | null;
    planning: ReviewPlanning;
    acceptance: TaskAcceptance | null;
    dependency_basis: Record<string, string>;
  };
  comment: string;
  evidence_content: string;
  evidence_url: string;
  source: "manual" | "external";
  submission_id?: string | null;
  submission_digest?: string | null;
  invalidated: boolean;
  invalidated_at: string | null;
  invalidated_reason: string;
};
export type ManualReviewSummary = Pick<
  ManualTaskReview,
  | "id"
  | "task_id"
  | "decision"
  | "created_at"
  | "reviewer"
  | "task_basis"
  | "source"
  | "submission_id"
  | "submission_digest"
  | "invalidated"
  | "invalidated_at"
  | "invalidated_reason"
> & {
  comment_summary: string;
  has_evidence: boolean;
};
export type TaskReviewPage = {
  project_id: string;
  task_id: string;
  as_of: string;
  reviews: ManualReviewSummary[];
  total: number;
  next_cursor: string | null;
  limit: number;
};
export type TaskReviewCurrentResponse = {
  project_id: string;
  task_id: string;
  version: number;
  query_generation: number;
  as_of: string;
  current: ManualReviewCurrent;
  effective_review_id: string | null;
};
export type TaskReviewOriginalResponse = {
  project_id: string;
  task_id: string;
  as_of: string;
  review: ManualTaskReview;
};
export type ManualReviewSession = {
  projectId: string;
  taskId: string;
  version: number;
  queryGeneration: number;
  current: ManualReviewCurrent;
  intent: DeliveryIntent;
  decision: "accept" | "request_changes";
  comment: string;
  evidenceContent: string;
  evidenceUrl: string;
};

export function manualTaskHref(
  task: { id: string; req_id?: string },
  background = "",
) {
  const href = deliveryInboxHref({
    view: "list",
    requirement_id: task.req_id || "",
    detail: "tasks",
    task_id: task.id,
  });
  const safe = safeExecutionReturn(background);
  return preserveProjectContext(
    safe ? `${href}&return_to=${encodeURIComponent(safe)}` : href,
    background,
  );
}

export function taskRecordStatusLabel(
  status: string,
  translate: (key: string) => string,
) {
  if (status === "completed")
    return translate("deliveryManualReview.recordedCompleted");
  return ["pending", "in_progress", "blocked"].includes(status)
    ? translate(`page.tasks.status.${status}`)
    : status;
}

export async function fetchTaskReviews(
  projectId: string,
  taskId: string,
  options: {
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
    read?: typeof request;
  } = {},
): Promise<TaskReviewPage> {
  const limit = options.limit ?? 20;
  reviewScopeInput(projectId, taskId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid review page limit");
  const params = new URLSearchParams({ limit: String(limit) });
  if (
    options.cursor &&
    (options.cursor.length > 4000 ||
      /[\u0000-\u001f\u007f]/.test(options.cursor))
  )
    throw new Error("Invalid review cursor");
  if (options.cursor) params.set("cursor", options.cursor);
  const page = await (options.read || request)<TaskReviewPage>(
    `/api/v1/delivery/tasks/${encodeURIComponent(taskId)}/reviews?${params}`,
    {
      headers: { "X-Project-Id": projectId },
      signal: options.signal,
    },
  );
  assertReviewScope(page, projectId, taskId);
  if (
    !Array.isArray(page.reviews) ||
    !Number.isSafeInteger(page.total) ||
    page.total < 0 ||
    page.limit !== limit ||
    !(page.next_cursor === null || typeof page.next_cursor === "string") ||
    page.reviews.some(
      (row) =>
        !row ||
        row.task_id !== taskId ||
        !validReviewId(row.id) ||
        typeof row.comment_summary !== "string" ||
        Array.from(row.comment_summary).length > 240 ||
        typeof row.has_evidence !== "boolean",
    )
  )
    throw new Error("reviewResponseInvalid");
  return page;
}
const validReviewId = (value: string) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value);
function reviewScopeInput(projectId: string, taskId: string) {
  if (!projectId || projectId !== projectId.trim())
    throw new Error("Explicit project required");
  if (!validReviewId(taskId)) throw new Error("Invalid task ID");
}
function assertReviewScope(
  value: { project_id: string; task_id: string },
  projectId: string,
  taskId: string,
) {
  if (!value || value.project_id !== projectId || value.task_id !== taskId)
    throw new Error("reviewScopeChanged");
}
export async function fetchTaskReviewCurrent(
  projectId: string,
  taskId: string,
  options: { signal?: AbortSignal; read?: typeof request } = {},
): Promise<TaskReviewCurrentResponse> {
  reviewScopeInput(projectId, taskId);
  const proof = await (options.read || request)<TaskReviewCurrentResponse>(
    `/api/v1/delivery/tasks/${encodeURIComponent(taskId)}/review-current`,
    { headers: { "X-Project-Id": projectId }, signal: options.signal },
  );
  assertReviewScope(proof, projectId, taskId);
  if (
    !Number.isSafeInteger(proof.version) ||
    proof.version < 0 ||
    !Number.isSafeInteger(proof.query_generation) ||
    proof.query_generation < 1 ||
    !(
      proof.effective_review_id === null ||
      validReviewId(proof.effective_review_id)
    ) ||
    (proof.effective_review_id !== null && !proof.current?.verified) ||
    !proof.current ||
    proof.current.task?.id !== taskId ||
    !proof.current.basis ||
    typeof proof.current.can_review !== "boolean" ||
    typeof proof.current.can_accept !== "boolean" ||
    typeof proof.current.verified !== "boolean"
  )
    throw new Error("reviewResponseInvalid");
  return proof;
}
export async function fetchTaskReviewOriginal(
  projectId: string,
  taskId: string,
  reviewId: string,
  options: { signal?: AbortSignal; read?: typeof request } = {},
): Promise<TaskReviewOriginalResponse> {
  reviewScopeInput(projectId, taskId);
  if (!validReviewId(reviewId)) throw new Error("Invalid review ID");
  const value = await (options.read || request)<TaskReviewOriginalResponse>(
    `/api/v1/delivery/tasks/${encodeURIComponent(taskId)}/reviews/${encodeURIComponent(reviewId)}`,
    { headers: { "X-Project-Id": projectId }, signal: options.signal },
  );
  assertReviewScope(value, projectId, taskId);
  if (
    !value.review ||
    value.review.id !== reviewId ||
    value.review.task_id !== taskId ||
    value.review.snapshot?.task?.id !== taskId
  )
    throw new Error("reviewScopeChanged");
  return value;
}

export function openManualReview(
  page: TaskReviewCurrentResponse,
  key: string,
): ManualReviewSession {
  if (!page.current || page.current.task.id !== page.task_id)
    throw new Error("Current task unavailable");
  return {
    projectId: page.project_id,
    taskId: page.task_id,
    version: page.version,
    queryGeneration: page.query_generation,
    current: structuredClone(page.current),
    intent: { version: page.version, key },
    decision: page.current.can_accept ? "accept" : "request_changes",
    comment: "",
    evidenceContent: "",
    evidenceUrl: "",
  };
}

export function prepareManualReview(session: ManualReviewSession) {
  const payload = {
    task_id: session.taskId,
    decision: session.decision,
    basis: session.current.basis,
    comment: session.comment.trim(),
    evidence_content: session.evidenceContent.trim(),
    evidence_url: session.evidenceUrl.trim(),
  };
  const intent = prepareDeliveryIntent(
    session.intent,
    "task.manual_review",
    payload,
  );
  return {
    session: { ...session, intent },
    command: {
      action: "task.manual_review" as const,
      expected_version: session.version,
      idempotency_key: intent.key,
      payload,
    },
  };
}

export function adoptManualReviewBasis(
  session: ManualReviewSession,
  page: TaskReviewCurrentResponse,
  key: string,
): ManualReviewSession {
  if (page.project_id !== session.projectId || page.task_id !== session.taskId)
    throw new Error("Review scope changed");
  const next = openManualReview(page, key);
  return {
    ...next,
    decision: session.decision,
    comment: session.comment,
    evidenceContent: session.evidenceContent,
    evidenceUrl: session.evidenceUrl,
  };
}

export function manualReviewProblems(session: ManualReviewSession): string[] {
  const problems: string[] = [];
  if (!session.comment.trim()) problems.push("commentRequired");
  if (session.comment.length > 4000) problems.push("commentTooLong");
  if (session.evidenceContent.length > 20000) problems.push("evidenceTooLong");
  if (session.evidenceUrl.length > 2000) problems.push("urlTooLong");
  if (
    session.decision === "accept" &&
    !session.evidenceContent.trim() &&
    !session.evidenceUrl.trim()
  )
    problems.push("evidenceRequired");
  if (
    session.evidenceUrl.trim() &&
    !safeEvidenceUrl(session.evidenceUrl.trim())
  )
    problems.push("unsafeUrl");
  if (!session.current.can_review) problems.push("cannotReview");
  if (session.decision === "accept" && !session.current.can_accept)
    problems.push("cannotAccept");
  return problems;
}

export function manualReviewError(error: unknown): {
  code: string;
  message: string;
  conflict: boolean;
} {
  const failure = planError(error);
  const raw = error instanceof Error ? error.message : String(error);
  return {
    ...failure,
    conflict:
      failure.conflict ||
      (raw.startsWith("HTTP 409") &&
        failure.code === "task_review_basis_changed"),
  };
}
