"""Quality, immutable release candidates and explicit approval contracts."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from .delivery_ci_contract import CiStatement, HexDigest, Identity, safe_https

ScopeIds = Annotated[list[Identity], Field(max_length=200)]
NonemptyText = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1)]


class ReleaseContract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReleaseInput(ReleaseContract):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)


class ReleaseScope(ReleaseInput):
    requirement_ids: ScopeIds = Field(default_factory=list)
    task_ids: ScopeIds = Field(default_factory=list)

    @field_validator("requirement_ids", "task_ids")
    @classmethod
    def unique_ids(cls, values):
        if len(values) != len(set(values)) or any(not value.strip() for value in values):
            raise ValueError("Choose distinct nonempty scope IDs")
        return values

    @model_validator(mode="after")
    def scope_required(self):
        if not self.requirement_ids and not self.task_ids:
            raise ValueError("Choose at least one requirement or independent task")
        return self


class ReleasePreviewInput(ReleaseScope):
    version: NonemptyText = Field(max_length=80)
    environment: NonemptyText = Field(max_length=80)
    ci_evidence_id: NonemptyText = Field(max_length=64)
    artifact_url: NonemptyText = Field(max_length=2000)
    release_notes: NonemptyText = Field(max_length=10000)
    rollback_plan: NonemptyText = Field(max_length=10000)

    @field_validator("artifact_url")
    @classmethod
    def artifact_location(cls, value):
        return safe_https(value)


class ReleaseCandidateCreate(ReleasePreviewInput):
    preview_basis: HexDigest


class ReleaseCandidateReview(ReleaseInput):
    id: NonemptyText = Field(max_length=64)
    decision: Literal["approve", "reject"]
    comment: NonemptyText = Field(max_length=4000)
    review_basis: HexDigest


class ReleaseCandidateRevoke(ReleaseInput):
    id: NonemptyText = Field(max_length=64)
    comment: NonemptyText = Field(max_length=4000)
    review_basis: HexDigest


class ReleaseTarget(ReleaseContract):
    project_id: str
    kind: Literal["requirement", "task", "issue"]
    view: Literal["requirements", "tasks", "issues"]
    detail: str = "details"
    requirement_id: str | None = None
    task_id: str | None = None
    issue_id: str | None = None


class ReleaseReason(ReleaseContract):
    code: str
    message: str
    target: ReleaseTarget | None = None


class ReleaseActor(ReleaseContract):
    id: str
    name: str


class QualityOwner(ReleaseContract):
    id: str
    name: str | None
    kind: Literal["human", "agent", "tool"] | None
    active: bool
    available: bool


class QualityIssue(ReleaseContract):
    id: str
    title: str
    severity: str
    status: str
    task_id: str
    target: ReleaseTarget


class QualityProof(ReleaseContract):
    source: Literal["native", "manual", "requirement", "none"]
    id: str | None
    basis: str | None
    execution_id: str | None
    run_id: str | None
    run_version: int | None
    evidence_sha256: str | None
    reviewer_id: str | None
    at: str | None


class QualityTask(ReleaseContract):
    id: str
    title: str
    requirement_id: str | None
    recorded_status: str
    delivery_status: Literal[
        "pending", "in_progress", "blocked", "awaiting_review", "recorded_completed", "verified_completed"
    ]
    verified: bool
    basis: str
    acceptance_criteria: list[str]
    acceptance_available: bool
    owner: QualityOwner | None
    proof: QualityProof
    issues: list[QualityIssue]
    reasons: list[ReleaseReason]
    target: ReleaseTarget


class QualityRequirement(ReleaseContract):
    id: str
    title: str
    revision: int
    basis: str
    stage: str
    accepted: bool
    acceptance_criteria: list[str]
    task_ids: list[str]
    issues: list[QualityIssue]
    reasons: list[ReleaseReason]
    target: ReleaseTarget


class SelectedReleaseScope(ReleaseContract):
    requirement_ids: list[str]
    task_ids: list[str]


class QualitySummary(ReleaseContract):
    requirements_total: int
    tasks_total: int
    verified_tasks: int
    unverified_tasks: int
    accepted_requirements: int
    critical_issues: int


class DeliveryQualityResponse(ReleaseContract):
    project_id: str
    as_of: str
    requirements: list[QualityRequirement]
    tasks: list[QualityTask]
    independent_tasks: list[QualityTask]
    selected: SelectedReleaseScope
    scope_basis: str | None
    eligible: bool
    reasons: list[ReleaseReason]
    summary: QualitySummary


class ReleaseKey(ReleaseContract):
    key_id: str
    public_key: str


class ReleasePolicy(ReleaseContract):
    generation: int
    repository: str
    workflow: str
    keys: list[ReleaseKey]
    updated_at: str
    updated_by: ReleaseActor


class ReleaseCiEvidence(ReleaseContract):
    id: str
    imported_at: str
    imported_by: ReleaseActor
    envelope_digest: str
    key_id: str
    passed: bool
    current: bool
    reasons: list[ReleaseReason]
    selected: SelectedReleaseScope
    statement: CiStatement


class ReleaseCiEvidenceSnapshot(ReleaseContract):
    id: str
    envelope_digest: str
    key_id: str
    policy_generation: int
    repository: str
    workflow: str
    commit_sha: str
    run_uri: str
    run_number: int
    run_attempt: int
    artifact_name: str
    artifact_sha256: str


class ReleaseQualitySnapshot(ReleaseContract):
    scope_basis: str
    requirements: list[QualityRequirement]
    tasks: list[QualityTask]


class ReleaseSnapshot(ReleaseContract):
    version: str
    environment: str
    selected: SelectedReleaseScope
    artifact_url: str
    release_notes: str
    rollback_plan: str
    ci: ReleaseCiEvidenceSnapshot
    quality: ReleaseQualitySnapshot


class ReleaseDecision(ReleaseContract):
    decision: Literal["approve", "reject", "revoke"]
    comment: str
    actor: ReleaseActor
    at: str
    review_basis: str


class ReleaseCandidatePermissions(ReleaseContract):
    can_approve: bool
    can_reject: bool
    can_revoke: bool


class ReleaseDeployment(ReleaseContract):
    status: Literal[
        "not_handed_off", "pending_dispatch", "planned", "queued", "running",
        "awaiting_promotion", "verified", "failed", "unknown", "cancelled",
        "rolled_back", "superseded",
    ] = "not_handed_off"
    verified: bool = False
    deployment_id: str | None = None


class ReleaseCandidate(ReleaseContract):
    id: str
    created_at: str
    created_by: ReleaseActor
    status: Literal["pending", "approved", "rejected", "revoked", "stale"]
    decision: Literal["pending", "approved", "rejected", "revoked"]
    snapshot: ReleaseSnapshot
    reviews: list[ReleaseDecision]
    invalidated: bool
    invalidated_at: str | None
    invalidated_reasons: list[ReleaseReason]
    valid: bool
    reasons: list[ReleaseReason]
    review_basis: str
    permissions: ReleaseCandidatePermissions
    deployment: ReleaseDeployment


class ReleasePermissions(ReleaseContract):
    can_configure: bool
    can_import: bool
    can_create: bool
    can_review: bool


class LegacyReleaseRecord(ReleaseContract):
    requirement_id: str
    requirement_title: str | None
    record: dict
    source: Literal["manual_history"] = "manual_history"
    deployment_verified: Literal[False] = False


class DeliveryReleasesResponse(ReleaseContract):
    project_id: str
    version: int
    as_of: str
    policy: ReleasePolicy | None
    evidence: list[ReleaseCiEvidence]
    candidates: list[ReleaseCandidate]
    legacy_history: list[LegacyReleaseRecord]
    permissions: ReleasePermissions


class DeliveryReleaseDetail(ReleaseContract):
    project_id: str
    version: int
    as_of: str
    candidate: ReleaseCandidate
    evidence: ReleaseCiEvidence
    envelope: str
    permissions: ReleasePermissions


class ReleasePreviewResponse(ReleaseContract):
    project_id: str
    version: int
    as_of: str
    preview_basis: str
    allowed: bool
    reasons: list[ReleaseReason]
    snapshot: ReleaseSnapshot | None
    permissions: ReleasePermissions
