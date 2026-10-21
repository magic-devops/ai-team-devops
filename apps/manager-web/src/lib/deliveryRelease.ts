import { request } from "./http";
import {
  prepareDeliveryIntent,
  type DeliveryIntent,
  type DeliveryCommandAck,
} from "./delivery";
import { projectHeaders } from "./projectPortfolio";
import type { DeploymentStatus } from "./deliveryDeployment";

export type ReleaseScope = { requirement_ids: string[]; task_ids: string[] };
export type ReleaseTarget = {
  project_id: string;
  kind: "requirement" | "task" | "issue";
  view: "requirements" | "tasks" | "issues";
  detail: string;
  requirement_id: string | null;
  task_id: string | null;
  issue_id: string | null;
};
export type ReleaseReason = {
  code: string;
  message: string;
  target: ReleaseTarget | null;
};
export type ReleaseActor = { id: string; name: string };
export type QualityOwner = {
  id: string;
  name: string | null;
  kind: "human" | "agent" | "tool" | null;
  active: boolean;
  available: boolean;
};
export type QualityIssue = {
  id: string;
  title: string;
  severity: string;
  status: string;
  task_id: string;
  target: ReleaseTarget;
};
export type QualityProof = {
  source: "native" | "manual" | "external" | "requirement" | "none";
  id: string | null;
  basis: string | null;
  execution_id: string | null;
  run_id: string | null;
  run_version: number | null;
  evidence_sha256: string | null;
  reviewer_id: string | null;
  at: string | null;
};
export type QualityTask = {
  id: string;
  title: string;
  requirement_id: string | null;
  recorded_status: string;
  delivery_status:
    | "pending"
    | "in_progress"
    | "blocked"
    | "awaiting_review"
    | "recorded_completed"
    | "verified_completed";
  verified: boolean;
  basis: string;
  acceptance_criteria: string[];
  acceptance_available: boolean;
  owner: QualityOwner | null;
  proof: QualityProof;
  issues: QualityIssue[];
  reasons: ReleaseReason[];
  target: ReleaseTarget;
};
export type QualityRequirement = {
  id: string;
  title: string;
  revision: number;
  basis: string;
  stage: string;
  accepted: boolean;
  acceptance_criteria: string[];
  task_ids: string[];
  issues: QualityIssue[];
  reasons: ReleaseReason[];
  target: ReleaseTarget;
};
export type DeliveryQuality = {
  project_id: string;
  version: number;
  query_generation: number;
  as_of: string;
  requirements: QualityRequirement[];
  tasks: QualityTask[];
  independent_tasks: QualityTask[];
  selected: ReleaseScope;
  scope_basis: string | null;
  eligible: boolean;
  reasons: ReleaseReason[];
  summary: {
    requirements_total: number;
    tasks_total: number;
    verified_tasks: number;
    unverified_tasks: number;
    accepted_requirements: number;
    critical_issues: number;
  };
};
export type ReleasePolicy = {
  generation: number;
  repository: string;
  workflow: string;
  keys: { key_id: string; public_key: string }[];
  updated_at: string;
  updated_by: ReleaseActor;
};
export type CiStatement = {
  _type: "https://in-toto.io/Statement/v1";
  subject: { name: string; digest: { sha256: string } }[];
  predicateType: "urn:sop:delivery:ci-evidence:v1";
  predicate: {
    tenant_id: string;
    project_id: string;
    policy_generation: number;
    repository: string;
    workflow: string;
    commit_sha: string;
    run_uri: string;
    run_number: number;
    run_attempt: number;
    scope_basis: string;
    build_result: "passed" | "failed";
    tests: { total: number; failed: number; errors: number; skipped: number };
    finished_at: string;
  };
};
export type ReleaseCiEvidence = {
  id: string;
  imported_at: string;
  imported_by: ReleaseActor;
  envelope_digest: string;
  key_id: string;
  passed: boolean;
  current: boolean;
  reasons: ReleaseReason[];
  selected: ReleaseScope;
  statement: CiStatement;
};
export type ReleaseCiSnapshot = {
  id: string;
  envelope_digest: string;
  key_id: string;
  policy_generation: number;
  repository: string;
  workflow: string;
  commit_sha: string;
  run_uri: string;
  run_number: number;
  run_attempt: number;
  artifact_name: string;
  artifact_sha256: string;
};
export type ReleaseQualitySnapshot = {
  scope_basis: string;
  requirements: QualityRequirement[];
  tasks: QualityTask[];
};
export type ReleaseSnapshot = {
  version: string;
  environment: string;
  selected: ReleaseScope;
  artifact_url: string;
  release_notes: string;
  rollback_plan: string;
  ci: ReleaseCiSnapshot;
  quality: ReleaseQualitySnapshot;
};
export type ReleaseDecision = {
  decision: "approve" | "reject" | "revoke";
  comment: string;
  actor: ReleaseActor;
  at: string;
  review_basis: string;
};
export type ReleaseCandidate = {
  id: string;
  created_at: string;
  created_by: ReleaseActor;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "revoked"
    | "stale"
    | "unverified";
  decision: "pending" | "approved" | "rejected" | "revoked";
  snapshot: ReleaseSnapshot;
  reviews: ReleaseDecision[];
  invalidated: boolean;
  invalidated_at: string | null;
  invalidated_reasons: ReleaseReason[];
  valid: boolean;
  reasons: ReleaseReason[];
  review_basis: string;
  permissions: {
    can_approve: boolean;
    can_reject: boolean;
    can_revoke: boolean;
  };
  deployment: {
    status: "not_handed_off" | "superseded" | DeploymentStatus;
    verified: boolean;
    deployment_id: string | null;
  };
};
export type ReleasePermissions = {
  can_configure: boolean;
  can_import: boolean;
  can_create: boolean;
  can_review: boolean;
};
export type DeliveryReleases = {
  project_id: string;
  version: number;
  query_generation: number;
  as_of: string;
  policy: ReleasePolicy | null;
  permissions: ReleasePermissions;
  totals: { candidate: number; evidence: number; legacy: number };
};
export type ReleasePageKind = "candidate" | "evidence" | "legacy";
export type ReleaseListRow = {
  kind: ReleasePageKind;
  id: string;
  title: string;
  at: string | null;
  status: string;
  version: string | null;
  environment: string | null;
  commit_sha: string | null;
  passed: boolean | null;
  requirement_id: string | null;
  requirement_title: string | null;
  scope_requirements: number;
  scope_tasks: number;
  summary: string | null;
};
export type QualityCatalogueRow = {
  kind: "requirement" | "task";
  id: string;
  title: string;
  ready: boolean;
  attention: boolean;
  reasons: ReleaseReason[];
  issue_count: number;
  target: ReleaseTarget;
  revision: number | null;
  task_count: number;
};
export type ReleasePage<T> = {
  project_id: string;
  version: number;
  query_generation: number;
  as_of: string;
  items: T[];
  total: number;
  limit: number;
  next_cursor: string | null;
};
export type QualityCataloguePage = ReleasePage<QualityCatalogueRow> & {
  totals: { requirements: number; independent_tasks: number };
};
export type ReleaseEvidenceDetail = {
  project_id: string;
  version: number;
  query_generation: number;
  as_of: string;
  evidence: ReleaseCiEvidence;
  envelope: string;
  permissions: ReleasePermissions;
};
export type DeliveryReleaseDetail = {
  project_id: string;
  version: number;
  query_generation: number;
  as_of: string;
  candidate: ReleaseCandidate;
  evidence: ReleaseCiEvidence;
  envelope: string;
  permissions: ReleasePermissions;
};
export type ReleasePreview = {
  project_id: string;
  version: number;
  as_of: string;
  preview_basis: string;
  allowed: boolean;
  reasons: ReleaseReason[];
  snapshot: ReleaseSnapshot | null;
  permissions: ReleasePermissions;
};
export type ReleaseForm = ReleaseScope & {
  version: string;
  environment: string;
  ci_evidence_id: string;
  artifact_url: string;
  release_notes: string;
  rollback_plan: string;
};
export type ReleaseCommand =
  | "release.policy.save"
  | "release.ci.import"
  | "release.candidate.create"
  | "release.candidate.review"
  | "release.candidate.revoke";
export type ReleaseDraft = {
  projectId: string;
  form: ReleaseForm;
  preview: ReleasePreview | null;
  intent: DeliveryIntent;
};
const scope = (projectId: string) => {
  if (!projectId || projectId !== projectId.trim())
    throw new Error("scopeChanged");
  return projectHeaders(projectId);
};
export function fetchDeliveryQuality(
  projectId: string,
  selected: ReleaseScope,
  signal?: AbortSignal,
  generation?: number | null,
) {
  if (!selected.requirement_ids.length && !selected.task_ids.length)
    throw new Error("scopeRequired");
  const p = new URLSearchParams();
  for (const id of ids(selected.requirement_ids))
    p.append("requirement_ids", id);
  for (const id of ids(selected.task_ids)) p.append("task_ids", id);
  return request<DeliveryQuality>(
    `/api/v1/delivery/quality${p.size ? `?${p}` : ""}`,
    { signal, headers: scope(projectId) },
  ).then((value) => assertReleaseRead(projectId, value, generation));
}
export function fetchDeliveryReleases(
  projectId: string,
  signal?: AbortSignal,
  generation?: number | null,
) {
  return request<DeliveryReleases>("/api/v1/delivery/releases", {
    signal,
    headers: scope(projectId),
  }).then((value) => assertReleaseRead(projectId, value, generation));
}
export function fetchDeliveryRelease(
  projectId: string,
  id: string,
  signal?: AbortSignal,
  generation?: number | null,
) {
  if (!id) throw new Error("releaseMissing");
  return request<DeliveryReleaseDetail>(
    `/api/v1/delivery/releases/${encodeURIComponent(id)}`,
    { signal, headers: scope(projectId) },
  ).then((value) => {
    assertReleaseRead(projectId, value, generation);
    if (value.candidate.id !== id) throw new Error("releaseMissing");
    return value;
  });
}
export function assertReleaseRead<
  T extends { project_id: string; version: number; query_generation: number },
>(projectId: string, value: T, generation?: number | null): T {
  if (value.project_id !== projectId) throw new Error("scopeChanged");
  if (
    !Number.isSafeInteger(value.version) ||
    value.version < 0 ||
    !Number.isSafeInteger(value.query_generation) ||
    value.query_generation < 0 ||
    (generation != null && value.query_generation !== generation)
  )
    throw new Error("generationChanged");
  return value;
}
export function fetchQualityCatalogue(
  projectId: string,
  query: {
    kind?: "all" | "requirement" | "task";
    q?: string;
    readiness?: "all" | "ready" | "attention";
    cursor?: string;
    limit?: number;
  } = {},
  signal?: AbortSignal,
  generation?: number | null,
) {
  const p = new URLSearchParams({
    kind: query.kind || "all",
    readiness: query.readiness || "all",
    limit: String(query.limit ?? 20),
  });
  if (query.q) p.set("q", query.q);
  if (query.cursor) p.set("cursor", query.cursor);
  return request<QualityCataloguePage>(
    `/api/v1/delivery/quality/catalogue?${p}`,
    { headers: scope(projectId), signal },
  ).then((value) => assertReleaseRead(projectId, value, generation));
}
export function fetchReleasePage(
  projectId: string,
  kind: ReleasePageKind,
  query: { q?: string; cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
  generation?: number | null,
) {
  const p = new URLSearchParams({ kind, limit: String(query.limit ?? 20) });
  if (query.q) p.set("q", query.q);
  if (query.cursor) p.set("cursor", query.cursor);
  return request<ReleasePage<ReleaseListRow>>(
    `/api/v1/delivery/release-pages?${p}`,
    { headers: scope(projectId), signal },
  ).then((value) => assertReleaseRead(projectId, value, generation));
}
export function fetchReleaseEvidence(
  projectId: string,
  id: string,
  signal?: AbortSignal,
  generation?: number | null,
) {
  if (!id) throw new Error("evidenceMissing");
  return request<ReleaseEvidenceDetail>(
    `/api/v1/delivery/release-evidence/${encodeURIComponent(id)}`,
    { headers: scope(projectId), signal },
  ).then((value) => {
    assertReleaseRead(projectId, value, generation);
    if (value.evidence.id !== id) throw new Error("evidenceMissing");
    return value;
  });
}
const ids = (values: string[]) => {
  if (
    values.length > 200 ||
    new Set(values).size !== values.length ||
    values.some((id) => !id.trim() || id !== id.trim())
  )
    throw new Error("scopeRequired");
  return [...values].sort();
};
export function releaseInput(form: ReleaseForm): ReleaseForm {
  const input = {
    requirement_ids: ids(form.requirement_ids),
    task_ids: ids(form.task_ids),
    version: form.version.trim(),
    environment: form.environment.trim(),
    ci_evidence_id: form.ci_evidence_id.trim(),
    artifact_url: form.artifact_url.trim(),
    release_notes: form.release_notes.trim(),
    rollback_plan: form.rollback_plan.trim(),
  };
  if (!input.requirement_ids.length && !input.task_ids.length)
    throw new Error("scopeRequired");
  for (const key of [
    "version",
    "environment",
    "ci_evidence_id",
    "artifact_url",
    "release_notes",
    "rollback_plan",
  ] as const) {
    const limit = {
      version: 80,
      environment: 80,
      ci_evidence_id: 64,
      artifact_url: 2000,
      release_notes: 10000,
      rollback_plan: 10000,
    }[key];
    if (!input[key] || input[key].length > limit)
      throw new Error("fieldsRequired");
  }
  let url: URL;
  try {
    url = new URL(input.artifact_url);
  } catch {
    throw new Error("artifactHttps");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    input.artifact_url.includes("#") ||
    /[\s\\]/.test(input.artifact_url)
  )
    throw new Error("artifactHttps");
  return input;
}
export function previewDeliveryRelease(
  projectId: string,
  form: ReleaseForm,
  signal?: AbortSignal,
) {
  return request<ReleasePreview>("/api/v1/delivery/release-preview", {
    method: "POST",
    headers: scope(projectId),
    signal,
    body: JSON.stringify(releaseInput(form)),
  });
}
export function prepareReleaseCandidate(draft: ReleaseDraft) {
  const preview = draft.preview,
    snapshot = preview?.snapshot;
  const input = releaseInput(draft.form);
  if (
    !preview?.allowed ||
    !snapshot ||
    !preview.permissions.can_create ||
    preview.project_id !== draft.projectId ||
    draft.intent.version !== preview.version
  )
    throw new Error("previewRequired");
  const captured = {
    version: snapshot.version,
    environment: snapshot.environment,
    ci_evidence_id: snapshot.ci.id,
    artifact_url: snapshot.artifact_url,
    release_notes: snapshot.release_notes,
    rollback_plan: snapshot.rollback_plan,
    ...snapshot.selected,
  };
  if (JSON.stringify(releaseInput(captured)) !== JSON.stringify(input))
    throw new Error("previewRequired");
  const payload = { ...input, preview_basis: preview.preview_basis };
  const intent = prepareDeliveryIntent(
    draft.intent,
    "release.candidate.create",
    payload,
  );
  return {
    payload,
    version: intent.version,
    key: intent.key,
    draft: { ...draft, intent },
  };
}
export function submitReleaseCommand(
  projectId: string,
  action: ReleaseCommand,
  payload: Record<string, unknown>,
  intent: DeliveryIntent,
) {
  return request<DeliveryCommandAck>("/api/v1/delivery/commands", {
    method: "POST",
    headers: scope(projectId),
    body: JSON.stringify({
      action,
      payload,
      expected_version: intent.version,
      idempotency_key: intent.key,
    }),
  });
}
export function releaseProblem(problem: unknown) {
  const raw = problem instanceof Error ? problem.message : String(problem);
  let code = "",
    message = raw;
  try {
    const value = JSON.parse(raw.replace(/^HTTP \d+:\s*/, ""));
    const detail = value.detail ?? value;
    code = detail.code || "";
    message = detail.message || raw;
  } catch {
    /* A network failure has no server code. */
  }
  return {
    code,
    message,
    conflict: /409/.test(raw),
    missing: /404/.test(raw),
    forbidden: /403/.test(raw),
  };
}
