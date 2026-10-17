import {
  prepareDeliveryIntent,
  safeEvidenceUrl,
  type DeliveryIntent,
} from "./delivery";
import { planError } from "./deliveryTaskPlan";
import { request } from "./http";
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
  acceptance_criteria: number[];
  depends_on: string[];
};
export type ManualReviewCurrent = {
  task: ReviewTask;
  basis: string;
  owner: ReviewOwner | null;
  requirement: ReviewRequirement | null;
  planning: ReviewPlanning;
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
    dependency_basis: Record<string, string>;
  };
  comment: string;
  evidence_content: string;
  evidence_url: string;
  source: "manual";
  invalidated: boolean;
  invalidated_at: string | null;
  invalidated_reason: string;
  valid: boolean;
};
export type TaskReviewPage = {
  project_id: string;
  task_id: string;
  version: number;
  as_of: string;
  current: ManualReviewCurrent | null;
  reviews: ManualTaskReview[];
  total: number;
  next_cursor: string | null;
  limit: number;
};
export type ManualReviewSession = {
  projectId: string;
  taskId: string;
  version: number;
  current: ManualReviewCurrent;
  intent: DeliveryIntent;
  decision: "accept" | "request_changes";
  comment: string;
  evidenceContent: string;
  evidenceUrl: string;
};

export function manualTaskHref(task: { id: string; req_id?: string }) {
  return deliveryInboxHref({
    view: "list",
    requirement_id: task.req_id || "",
    detail: "tasks",
    task_id: task.id,
  });
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
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<TaskReviewPage> {
  const limit = options.limit ?? 20;
  if (!projectId || projectId !== projectId.trim())
    throw new Error("Explicit project required");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(taskId))
    throw new Error("Invalid task ID");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid review page limit");
  const params = new URLSearchParams({ limit: String(limit) });
  if (options.cursor) params.set("cursor", options.cursor);
  return request<TaskReviewPage>(
    `/api/v1/delivery/tasks/${encodeURIComponent(taskId)}/reviews?${params}`,
    {
      headers: { "X-Project-Id": projectId },
      signal: options.signal,
    },
  );
}

export function openManualReview(
  page: TaskReviewPage,
  key: string,
): ManualReviewSession {
  if (!page.current || page.current.task.id !== page.task_id)
    throw new Error("Current task unavailable");
  return {
    projectId: page.project_id,
    taskId: page.task_id,
    version: page.version,
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
  page: TaskReviewPage,
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
