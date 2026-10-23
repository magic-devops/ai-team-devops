import type { DiscussionSourceReference } from "./deliveryDiscussions";
import { request } from "./http";
import type { DeliveryCommandAck } from "./delivery";
import { projectHeaders } from "./projectPortfolio";
import { safeExecutionReturn } from "./executionCommands";
import { safePortfolioReturn } from "./projectPortfolioRoute";
import { safeIssueOriginReturn } from "./issueOriginRoute";

export type IssueReason = { code: string; message: string };
export type IssueActor = { id: string; name: string };
export type IssueRecord = {
  id: string;
  tenant_id: string;
  project_id: string;
  sprint_id: string;
  task_id: string;
  title: string;
  description: string;
  type: string;
  severity: string;
  status: string;
  reported_by: string;
  resolved_by: string;
  resolution: string;
  created_at: string;
  resolved_at: string | null;
};
export type IssueEvidenceTarget = {
  project_id: string;
  view: string;
  detail: string;
  requirement_id?: string;
  task_id?: string;
  execution_id?: string;
  node_id?: string;
  attempt?: number | null;
  deployment_id?: string;
  issue_id?: string;
  receipt_id?: string;
  origin_id?: string;
  submission_id?: string | null;
};
export type IssueEvidence = {
  id: string;
  kind:
    | "issue"
    | "task"
    | "submission"
    | "execution"
    | "deployment"
    | "node"
    | "probe"
    | "event"
    | "ops";
  label: string;
  status: string | null;
  summary: string;
  facts: Array<{ label: string; value: string }>;
  excerpt: string;
  truncated: boolean;
  missing: boolean;
  restricted: boolean;
  redacted: boolean;
  target: IssueEvidenceTarget;
};
export type DiagnosisRequirement = {
  title: string;
  description: string;
  priority: "P0" | "P1" | "P2" | "P3";
  acceptance_criteria: string[];
};
export type DiagnosisSuggestion = {
  summary: string;
  hypotheses: Array<{
    hypothesis: string;
    confidence: "low" | "medium" | "high";
    evidence_ids: string[];
    verification_steps: string[];
  }>;
  checks: Array<{
    title: string;
    instructions: string;
    evidence_ids: string[];
  }>;
  risks: string[];
  requirement: DiagnosisRequirement;
  open_questions: string[];
};
export type DiagnosisView = {
  id: string;
  issue_id: string;
  request_key: string;
  requested_by: IssueActor;
  generator: "ai" | "rules";
  status: "generating" | "succeeded" | "failed" | "cancelled";
  issue_basis: string;
  current: boolean;
  restricted: boolean;
  snapshot: {
    issue: IssueRecord;
    evidence: IssueEvidence[];
    requirement_id: string | null;
  } | null;
  result: DiagnosisSuggestion | null;
  error: IssueReason | null;
  model: string;
  provider: string;
  usage: Record<string, unknown>;
  created_at: string;
  review: {
    decision: "adopted" | "rejected" | "cancelled";
    actor: IssueActor;
    comment: string;
    at: string;
    requirement_id: string | null;
  } | null;
  actions: { can_adopt: boolean; can_dismiss: boolean; reasons: IssueReason[] };
};
export type IssueDetail = {
  project_id: string;
  version: number;
  as_of: string;
  issue: IssueRecord;
  issue_basis: string;
  evidence: IssueEvidence[];
  origin_summary: { total: number; projection: "current" | "rebuild_required" };
  requirement_id: string | null;
  diagnoses: DiagnosisView[];
  next_cursor: string | null;
  permissions: {
    can_generate: boolean;
    can_adopt: boolean;
    can_dismiss: boolean;
  };
  reasons: IssueReason[];
};
export type IssueOrigin = {
  id: string;
  issue_id: string;
  receipt_id: string;
  attempt_id: string;
  operation: "create" | "update" | "delete";
  effect_kind: string;
  digest: string;
  basis: string;
  event_id: string | null;
  event_type: string | null;
  source: string | null;
  producer: IssueActor | null;
  processed_at: string;
  available: boolean;
  unavailable_reason: string | null;
  evidence: IssueEvidence;
};
export type IssueOriginPage = {
  project_id: string;
  issue_id: string;
  issue_available: boolean;
  as_of: string;
  items: IssueOrigin[];
  total: number;
  limit: number;
  next_cursor: string | null;
};
export type IssueOriginDetail = Omit<
  IssueOriginPage,
  "items" | "total" | "limit" | "next_cursor"
> & {
  origin: IssueOrigin;
};
export type DiagnosisHistory = {
  project_id: string;
  issue_id: string;
  issue_basis: string;
  items: DiagnosisView[];
  next_cursor: string | null;
};
export type DiagnosisForm = {
  generator: "ai" | "rules";
  selected_evidence_ids: string[];
  instructions: string;
};
export type DiagnosisGenerateBody = DiagnosisForm & {
  expected_version: number;
  issue_basis: string;
  idempotency_key: string;
};
export type DiagnosisSubmission = {
  body: DiagnosisGenerateBody;
  signature: string;
  evidence: IssueEvidence[];
};
export type IssueReviewForm = DiagnosisRequirement & { comment: string };
export type IssueReviewCommand = {
  action: "issue.diagnosis.adopt" | "issue.diagnosis.dismiss";
  payload: {
    issue_id: string;
    diagnosis_id: string;
    issue_basis: string;
    comment: string;
  } & Partial<DiagnosisRequirement>;
  expected_version: number;
  idempotency_key: string;
  source_reference?: DiscussionSourceReference;
};
const identity = (id: string) => {
  if (
    !id.trim() ||
    id !== id.trim() ||
    id.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(id)
  )
    throw new Error("issueMissing");
  return id;
};
const scoped = (projectId: string) => projectHeaders(identity(projectId));
export function fetchDeliveryIssue(
  projectId: string,
  id: string,
  signal?: AbortSignal,
) {
  return request<IssueDetail>(
    `/api/v1/delivery/issues/${encodeURIComponent(identity(id))}`,
    { signal, headers: scoped(projectId) },
  );
}
function assertIssueOrigin(
  projectId: string,
  issueId: string,
  origin: IssueOrigin,
) {
  if (
    origin.issue_id !== issueId ||
    origin.evidence.kind !== "event" ||
    origin.evidence.id !== `event:${origin.id}` ||
    origin.evidence.target.project_id !== projectId ||
    origin.evidence.target.receipt_id !== origin.receipt_id ||
    origin.evidence.target.origin_id !== origin.id
  )
    throw new Error("scopeChanged");
}
export async function fetchIssueOrigins(
  projectId: string,
  issueId: string,
  query: { limit?: number; cursor?: string } = {},
  signal?: AbortSignal,
) {
  const limit = query.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("originsUnavailable");
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.cursor) params.set("cursor", query.cursor);
  const value = await request<IssueOriginPage>(
    `/api/v1/delivery/issues/${encodeURIComponent(identity(issueId))}/origins?${params}`,
    { signal, headers: scoped(projectId) },
  );
  if (value.project_id !== projectId || value.issue_id !== issueId)
    throw new Error("scopeChanged");
  value.items.forEach((origin) =>
    assertIssueOrigin(projectId, issueId, origin),
  );
  return value;
}
export async function fetchIssueOrigin(
  projectId: string,
  issueId: string,
  originId: string,
  signal?: AbortSignal,
) {
  const value = await request<IssueOriginDetail>(
    `/api/v1/delivery/issues/${encodeURIComponent(identity(issueId))}/origins/${encodeURIComponent(identity(originId))}`,
    { signal, headers: scoped(projectId) },
  );
  if (
    value.project_id !== projectId ||
    value.issue_id !== issueId ||
    value.origin.id !== originId
  )
    throw new Error("scopeChanged");
  assertIssueOrigin(projectId, issueId, value.origin);
  return value;
}
export function fetchIssueDiagnosisHistory(
  projectId: string,
  id: string,
  cursor = "",
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return request<DiagnosisHistory>(
    `/api/v1/delivery/issues/${encodeURIComponent(identity(id))}/diagnoses${params.size ? `?${params}` : ""}`,
    { signal, headers: scoped(projectId) },
  );
}
export function generateIssueDiagnosis(
  projectId: string,
  id: string,
  body: DiagnosisGenerateBody,
) {
  return request<DiagnosisView>(
    `/api/v1/delivery/issues/${encodeURIComponent(identity(id))}/diagnoses`,
    { method: "POST", headers: scoped(projectId), body: JSON.stringify(body) },
  );
}
export function fetchIssueDiagnosis(
  projectId: string,
  issueId: string,
  diagnosisId: string,
  signal?: AbortSignal,
) {
  return request<DiagnosisView>(
    `/api/v1/delivery/issues/${encodeURIComponent(identity(issueId))}/diagnoses/${encodeURIComponent(identity(diagnosisId))}`,
    { signal, headers: scoped(projectId) },
  );
}
export async function diagnosisHistoryRequest(
  projectId: string,
  id: string,
  key: string,
  signal?: AbortSignal,
): Promise<DiagnosisView | null> {
  const cursors = new Set<string>();
  let cursor = "";
  for (;;) {
    if (signal?.aborted) throw new Error("scopeChanged");
    const page = await fetchIssueDiagnosisHistory(
      projectId,
      id,
      cursor,
      signal,
    );
    if (page.project_id !== projectId || page.issue_id !== id)
      throw new Error("scopeChanged");
    const found = page.items.find((item) => item.request_key === key);
    if (found) {
      if (found.issue_id && found.issue_id !== id)
        throw new Error("scopeChanged");
      return found;
    }
    if (!page.next_cursor) return null;
    if (cursors.has(page.next_cursor)) throw new Error("historyUnavailable");
    cursors.add(page.next_cursor);
    cursor = page.next_cursor;
  }
}
export function prepareDiagnosisGeneration(
  detail: IssueDetail,
  form: DiagnosisForm,
  previous?: DiagnosisSubmission,
  regenerate = false,
  makeKey: () => string = () => crypto.randomUUID(),
  originEvidence: IssueEvidence[] = [],
): DiagnosisSubmission {
  const selected = [...form.selected_evidence_ids].sort(),
    instructions = form.instructions.trim();
  if (
    !detail.permissions.can_generate ||
    !["ai", "rules"].includes(form.generator) ||
    !selected.length ||
    selected.length > 32 ||
    new Set(selected).size !== selected.length ||
    !selected.includes(`issue:${detail.issue.id}`) ||
    instructions.length > 4000
  )
    throw new Error("evidenceRequired");
  const evidence = selected.map(
    (id) =>
      detail.evidence.find((item) => item.id === id) ||
      originEvidence.find(
        (item) =>
          item.id === id &&
          item.kind === "event" &&
          item.id === `event:${item.target.origin_id}` &&
          item.target.project_id === detail.project_id &&
          Boolean(item.target.receipt_id),
      ),
  );
  if (evidence.some((item) => !item || item.restricted || item.missing))
    throw new Error("evidenceRequired");
  const body = {
    expected_version: detail.version,
    issue_basis: detail.issue_basis,
    selected_evidence_ids: selected,
    generator: form.generator,
    instructions,
  };
  const signature = JSON.stringify(body);
  return {
    signature,
    body: {
      ...body,
      idempotency_key:
        !regenerate && previous?.signature === signature
          ? previous.body.idempotency_key
          : makeKey(),
    },
    evidence: structuredClone(evidence as IssueEvidence[]),
  };
}
export function prepareIssueReview(
  detail: IssueDetail,
  diagnosis: DiagnosisView,
  decision: "adopt" | "dismiss",
  form: IssueReviewForm,
  previous?: IssueReviewCommand,
  makeKey: () => string = () => crypto.randomUUID(),
  source?: DiscussionSourceReference,
): IssueReviewCommand {
  const comment = form.comment.trim();
  if (
    diagnosis.issue_id !== detail.issue.id ||
    (decision === "adopt" && diagnosis.restricted) ||
    !comment ||
    comment.length > 4000 ||
    (decision === "adopt"
      ? !detail.permissions.can_adopt ||
        !diagnosis.actions.can_adopt ||
        !diagnosis.current ||
        diagnosis.status !== "succeeded" ||
        diagnosis.issue_basis !== detail.issue_basis
      : !diagnosis.actions.can_dismiss)
  )
    throw new Error("reviewUnavailable");
  const payload: IssueReviewCommand["payload"] = {
    issue_id: detail.issue.id,
    diagnosis_id: diagnosis.id,
    issue_basis: diagnosis.issue_basis,
    comment,
  };
  if (decision === "adopt") {
    const criteria = form.acceptance_criteria
      .map((line) => line.trim())
      .filter(Boolean);
    if (
      !form.title.trim() ||
      form.title.trim().length > 256 ||
      form.description.length > 20000 ||
      !["P0", "P1", "P2", "P3"].includes(form.priority) ||
      !criteria.length ||
      criteria.length > 40 ||
      criteria.some((line) => line.length > 2000)
    )
      throw new Error("requirementRequired");
    Object.assign(payload, {
      title: form.title.trim(),
      description: form.description,
      priority: form.priority,
      acceptance_criteria: criteria,
    });
  }
  const command = {
    action: `issue.diagnosis.${decision}` as IssueReviewCommand["action"],
    payload,
    expected_version: detail.version,
    ...(decision === "adopt" && source
      ? { source_reference: structuredClone(source) }
      : {}),
  };
  const signature = (value: Omit<IssueReviewCommand, "idempotency_key">) =>
    JSON.stringify(
      value.source_reference
        ? [
            value.action,
            value.payload,
            value.expected_version,
            value.source_reference,
          ]
        : [value.action, value.payload, value.expected_version],
    );
  return {
    ...command,
    idempotency_key:
      previous && signature(previous) === signature(command)
        ? previous.idempotency_key
        : makeKey(),
  };
}
export function prepareIssueDismissal(
  projectId: string,
  diagnosis: DiagnosisView,
  version: number,
  comment: string,
  previous?: IssueReviewCommand,
  makeKey: () => string = () => crypto.randomUUID(),
): IssueReviewCommand {
  identity(projectId);
  if (
    !diagnosis.actions.can_dismiss ||
    !Number.isSafeInteger(version) ||
    version < 0 ||
    !comment.trim() ||
    comment.trim().length > 4000
  )
    throw new Error("reviewUnavailable");
  const payload = {
    issue_id: diagnosis.issue_id,
    diagnosis_id: diagnosis.id,
    issue_basis: diagnosis.issue_basis,
    comment: comment.trim(),
  };
  const same =
    previous?.action === "issue.diagnosis.dismiss" &&
    previous.expected_version === version &&
    JSON.stringify(previous.payload) === JSON.stringify(payload);
  return {
    action: "issue.diagnosis.dismiss",
    payload,
    expected_version: version,
    idempotency_key: same ? previous.idempotency_key : makeKey(),
  };
}
export function submitIssueReview(
  projectId: string,
  command: IssueReviewCommand,
) {
  return request<DeliveryCommandAck>("/api/v1/delivery/commands", {
    method: "POST",
    headers: scoped(projectId),
    body: JSON.stringify(command),
  });
}
export function issueProblem(problem: unknown) {
  const raw =
    problem instanceof Error ? problem.message : String(problem ?? "");
  let message = raw,
    code = "";
  try {
    const data = JSON.parse(raw.replace(/^HTTP \d+:\s*/, ""));
    const detail = data.detail ?? data;
    if (typeof detail === "string") message = detail;
    else {
      code = detail.code || "";
      message = detail.message || detail.error || raw;
    }
  } catch {
    /* Keep local or network failure text. */
  }
  return {
    status: Number(raw.match(/^HTTP (\d{3}):/)?.[1] || 0),
    message,
    code,
    conflict: /^HTTP 409:/.test(raw),
    stale: /basis|stale|evidence_changed/.test(code),
    unknown: !/^HTTP (400|401|403|404|409|422):/.test(raw),
  };
}
export function issueHref(
  projectId: string,
  issueId: string,
  background = "",
  diagnosisId = "",
) {
  const params = new URLSearchParams({
    view: "issues",
    issue: identity(issueId),
    project_id: identity(projectId),
  });
  if (diagnosisId) params.set("diagnosis_id", identity(diagnosisId));
  const back =
    safeExecutionReturn(background) || safePortfolioReturn(background);
  if (back) params.set("return_to", back);
  return `#/dev-flow?${params}`;
}
export function issueEvidenceHref(
  projectId: string,
  target: Partial<IssueEvidenceTarget>,
  background: string,
) {
  if (target.project_id !== projectId) return null;
  const params = new URLSearchParams({ project_id: projectId });
  let path = "#/dev-flow";
  if (target.receipt_id && target.origin_id) {
    params.set("event_receipt", target.receipt_id);
    const back = safeIssueOriginReturn(background, projectId);
    if (back) params.set("issue_return", back);
    return `#/intelligence/events?${params}`;
  } else if (target.submission_id) {
    if (!target.task_id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(target.submission_id)) return null;
    params.set("view", target.requirement_id ? "list" : "timeline");
    params.set("task", target.task_id);
    params.set("submission_id", target.submission_id);
    if (target.requirement_id) {
      params.set("requirement", target.requirement_id);
      params.set("detail", "tasks");
    }
  } else if (target.deployment_id) {
    params.set("view", "releases");
    params.set("deployment_id", target.deployment_id);
  } else if (target.execution_id) {
    params.set("view", "list");
    params.set("execution_id", target.execution_id);
    if (target.node_id) {
      if (!Number.isSafeInteger(target.attempt) || Number(target.attempt) < 1)
        return null;
      params.set("execution_node", target.node_id);
      params.set("execution_attempt", String(target.attempt));
      params.set("execution_stream", "stdout");
    }
  } else if (target.requirement_id) {
    params.set("view", "list");
    params.set("requirement", target.requirement_id);
    params.set("detail", target.detail === "tasks" ? "tasks" : "details");
    if (target.task_id) params.set("task", target.task_id);
  } else if (target.task_id) {
    path = "#/tasks/execution";
    params.set("task_id", target.task_id);
  } else if (target.issue_id) {
    params.set("view", "issues");
    params.set("issue", target.issue_id);
  } else return null;
  const back =
    safeExecutionReturn(background) || safePortfolioReturn(background);
  if (back) params.set("return_to", back);
  return `${path}?${params}`;
}
