import type {
  DeliveryQuality,
  DeliveryReleaseDetail,
  DeliveryReleases,
  ReleaseCandidate,
  ReleaseCiEvidence,
  ReleaseForm,
  ReleasePreview,
  ReleaseSnapshot,
  ReleaseCommand,
} from "./deliveryRelease";
import type { DeliveryCommandAck, DeliveryIntent } from "./delivery";
export function releaseAck(
  projectId: string,
  action: ReleaseCommand,
  payload: Record<string, unknown>,
  intent: DeliveryIntent,
): DeliveryCommandAck {
  const resource = {
    kind:
      action === "release.policy.save"
        ? "release_policy"
        : action === "release.ci.import"
          ? "ci_evidence"
          : "release_candidate",
    id:
      action === "release.policy.save"
        ? projectId
        : String(payload.id || "new"),
  };
  return {
    project_id: projectId,
    action,
    resource,
    applied_version: intent.version + 1,
    version: intent.version + 1,
    query_generation: 8,
    replayed: false,
    affected_refs: [resource],
    result: null,
  };
}
const digest = "b".repeat(64);
export const releaseForm: ReleaseForm = {
  requirement_ids: ["R-1"],
  task_ids: ["T-one"],
  version: "v1.2.0",
  environment: "staging",
  ci_evidence_id: "CI-one",
  artifact_url: "https://ci.example/pkg.zip",
  release_notes: "Ship verified search",
  rollback_plan: "Restore previous immutable image",
};
export const releaseQuality: DeliveryQuality = {
  project_id: "P",
  version: 7,
  query_generation: 7,
  as_of: "2026-10-17T10:00:00Z",
  requirements: [
    {
      id: "R-1",
      title: "Search experience",
      revision: 2,
      basis: digest,
      stage: "release",
      accepted: true,
      acceptance_criteria: ["Search is accessible"],
      task_ids: [],
      issues: [],
      reasons: [],
      target: {
        project_id: "P",
        kind: "requirement",
        view: "requirements",
        detail: "details",
        requirement_id: "R-1",
        task_id: null,
        issue_id: null,
      },
    },
  ],
  tasks: [],
  independent_tasks: [
    {
      id: "T-one",
      title: "Independent regression",
      requirement_id: null,
      recorded_status: "completed",
      delivery_status: "verified_completed",
      verified: true,
      basis: digest,
      acceptance_criteria: ["Regression is verified"],
      acceptance_available: true,
      owner: {
        id: "user:lead",
        name: "Lead",
        kind: "human",
        active: true,
        available: true,
      },
      proof: {
        source: "manual",
        id: "review-one",
        basis: digest,
        execution_id: null,
        run_id: null,
        run_version: null,
        evidence_sha256: null,
        reviewer_id: "user:lead",
        at: "2026-10-17T09:00:00Z",
      },
      issues: [],
      reasons: [],
      target: {
        project_id: "P",
        kind: "task",
        view: "tasks",
        detail: "tasks",
        requirement_id: null,
        task_id: "T-one",
        issue_id: null,
      },
    },
  ],
  selected: { requirement_ids: ["R-1"], task_ids: ["T-one"] },
  scope_basis: digest,
  eligible: true,
  reasons: [],
  summary: {
    requirements_total: 1,
    tasks_total: 1,
    verified_tasks: 1,
    unverified_tasks: 0,
    accepted_requirements: 1,
    critical_issues: 0,
  },
};
export const ciEvidence: ReleaseCiEvidence = {
  id: "CI-one",
  imported_at: "2026-10-17T10:00:00Z",
  imported_by: { id: "user:lead", name: "Lead" },
  envelope_digest: digest,
  key_id: "c".repeat(64),
  passed: true,
  current: true,
  reasons: [],
  selected: releaseQuality.selected,
  statement: {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "urn:sop:delivery:ci-evidence:v1",
    subject: [{ name: "search.zip", digest: { sha256: digest } }],
    predicate: {
      tenant_id: "team",
      project_id: "P",
      policy_generation: 1,
      repository: "https://git.example/team/search",
      workflow: "release-ci",
      commit_sha: "d".repeat(40),
      run_uri: "https://ci.example/runs/21",
      run_number: 21,
      run_attempt: 1,
      scope_basis: digest,
      build_result: "passed",
      tests: { total: 12, failed: 0, errors: 0, skipped: 0 },
      finished_at: "2026-10-17T09:50:00Z",
    },
  },
};
export const releaseSnapshot: ReleaseSnapshot = {
  version: releaseForm.version,
  environment: releaseForm.environment,
  selected: releaseQuality.selected,
  artifact_url: releaseForm.artifact_url,
  release_notes: releaseForm.release_notes,
  rollback_plan: releaseForm.rollback_plan,
  ci: {
    id: "CI-one",
    envelope_digest: digest,
    key_id: ciEvidence.key_id,
    policy_generation: 1,
    repository: ciEvidence.statement.predicate.repository,
    workflow: "release-ci",
    commit_sha: ciEvidence.statement.predicate.commit_sha,
    run_uri: ciEvidence.statement.predicate.run_uri,
    run_number: 21,
    run_attempt: 1,
    artifact_name: "search.zip",
    artifact_sha256: digest,
  },
  quality: {
    scope_basis: digest,
    requirements: releaseQuality.requirements,
    tasks: releaseQuality.independent_tasks,
  },
};
const permissions = {
  can_configure: true,
  can_import: true,
  can_create: true,
  can_review: true,
};
export const releaseCandidate: ReleaseCandidate = {
  id: "REL-one",
  created_at: "2026-10-17T10:00:00Z",
  created_by: { id: "user:lead", name: "Lead" },
  status: "pending",
  decision: "pending",
  snapshot: releaseSnapshot,
  reviews: [],
  invalidated: false,
  invalidated_at: null,
  invalidated_reasons: [],
  valid: true,
  reasons: [],
  review_basis: "e".repeat(64),
  permissions: { can_approve: true, can_reject: true, can_revoke: true },
  deployment: {
    status: "not_handed_off",
    verified: false,
    deployment_id: null,
  },
};
export const releaseIndex: DeliveryReleases = {
  project_id: "P",
  version: 7,
  query_generation: 7,
  as_of: "2026-10-17T10:00:00Z",
  policy: {
    generation: 1,
    repository: ciEvidence.statement.predicate.repository,
    workflow: "release-ci",
    keys: [{ key_id: ciEvidence.key_id, public_key: "A".repeat(43) + "=" }],
    updated_at: "2026-10-17T09:00:00Z",
    updated_by: { id: "user:lead", name: "Lead" },
  },
  totals: { candidate: 1, evidence: 1, legacy: 0 },
  permissions,
};
export const releasePreview: ReleasePreview = {
  project_id: "P",
  version: 7,
  as_of: "2026-10-17T10:00:00Z",
  preview_basis: "a".repeat(64),
  allowed: true,
  reasons: [],
  snapshot: releaseSnapshot,
  permissions,
};
export const releaseDetail: DeliveryReleaseDetail = {
  project_id: "P",
  version: 7,
  query_generation: 7,
  as_of: "2026-10-17T10:00:00Z",
  candidate: releaseCandidate,
  evidence: ciEvidence,
  envelope: '{"original":"envelope"}',
  permissions,
};
