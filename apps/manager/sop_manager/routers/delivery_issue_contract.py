"""Strict issue evidence, diagnosis proposals and explicit review contracts."""

from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, field_validator


def human_text(value):
    value.encode("utf-8")
    if any(ord(char) < 32 and char not in "\n\r\t" or ord(char) == 127 for char in value):
        raise ValueError("Control characters are not allowed")
    return value


Digest = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Identity = Annotated[str, StringConstraints(min_length=1, max_length=200), AfterValidator(human_text)]
Text = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000), AfterValidator(human_text)
]


class IssueContract(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    @field_validator("*", mode="after")
    @classmethod
    def valid_text(cls, value):
        if isinstance(value, str):
            human_text(value)
        return value


class DiagnosisActor(IssueContract):
    id: Identity
    name: str


class DiagnosisReason(IssueContract):
    code: Identity
    message: str


class IssueRecord(IssueContract):
    id: Identity
    tenant_id: str
    project_id: Identity
    sprint_id: str = ""
    task_id: str = ""
    title: str
    description: str = ""
    type: str = "bug"
    severity: str = "P2"
    status: str = "open"
    reported_by: str = ""
    resolved_by: str = ""
    resolution: str = ""
    created_at: str
    resolved_at: str | None = None


class EvidenceTarget(IssueContract):
    project_id: Identity
    view: str
    detail: str
    requirement_id: str = ""
    task_id: str = ""
    execution_id: str = ""
    node_id: str = ""
    attempt: int | None = Field(default=None, ge=1)
    deployment_id: str = ""
    issue_id: str = ""


class EvidenceFact(IssueContract):
    label: str
    value: str


class EvidenceItem(IssueContract):
    id: Identity
    kind: Literal["issue", "task", "execution", "deployment", "node", "probe"]
    label: str
    status: str | None = None
    summary: str
    facts: list[EvidenceFact] = Field(default_factory=list)
    excerpt: str = Field(default="", max_length=4000)
    truncated: bool = False
    missing: bool = False
    restricted: bool = False
    redacted: bool = False
    target: EvidenceTarget


class DiagnosisRequirement(IssueContract):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)]
    description: str = Field(default="", max_length=20000)
    priority: Literal["P0", "P1", "P2", "P3"]
    acceptance_criteria: list[Text] = Field(min_length=1, max_length=40)


class DiagnosisHypothesis(IssueContract):
    hypothesis: Text
    confidence: Literal["low", "medium", "high"]
    evidence_ids: list[Identity] = Field(min_length=1, max_length=32)
    verification_steps: list[Text] = Field(min_length=1, max_length=12)


class DiagnosisCheck(IssueContract):
    title: Text
    instructions: Text
    evidence_ids: list[Identity] = Field(min_length=1, max_length=32)


class DiagnosisSuggestion(IssueContract):
    summary: Text
    hypotheses: list[DiagnosisHypothesis] = Field(default_factory=list, max_length=8)
    checks: list[DiagnosisCheck] = Field(default_factory=list, max_length=12)
    risks: list[Text] = Field(default_factory=list, max_length=12)
    requirement: DiagnosisRequirement
    open_questions: list[Text] = Field(default_factory=list, max_length=12)


class IssueDiagnosisGenerate(IssueContract):
    expected_version: int = Field(ge=0)
    issue_basis: Digest
    selected_evidence_ids: list[Identity] = Field(min_length=1, max_length=32)
    generator: Literal["ai", "rules"] = "ai"
    instructions: str = Field(default="", max_length=4000)
    idempotency_key: str = Field(min_length=8, max_length=100)

    @field_validator("selected_evidence_ids")
    @classmethod
    def distinct_evidence(cls, value):
        if len(set(value)) != len(value) or any(not item.strip() for item in value):
            raise ValueError("Choose distinct nonempty evidence IDs")
        return value


class IssueDiagnosisAdopt(DiagnosisRequirement):
    issue_id: Identity
    diagnosis_id: Digest
    issue_basis: Digest
    comment: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class IssueDiagnosisDismiss(IssueContract):
    issue_id: Identity
    diagnosis_id: Digest
    issue_basis: Digest
    comment: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class DiagnosisSnapshot(IssueContract):
    issue: IssueRecord
    evidence: list[EvidenceItem] = Field(min_length=1, max_length=32)
    requirement_id: str | None = None


class DiagnosisError(IssueContract):
    code: Identity
    message: str


class DiagnosisReview(IssueContract):
    decision: Literal["adopted", "rejected", "cancelled"]
    actor: DiagnosisActor
    comment: str
    at: str
    requirement_id: str | None = None


class DiagnosisActions(IssueContract):
    can_adopt: bool
    can_dismiss: bool
    reasons: list[DiagnosisReason]


class DiagnosisView(IssueContract):
    id: Digest
    issue_id: Identity
    request_key: str
    requested_by: DiagnosisActor
    generator: Literal["ai", "rules"]
    status: Literal["generating", "succeeded", "failed", "cancelled"]
    issue_basis: Digest
    current: bool
    restricted: bool
    snapshot: DiagnosisSnapshot | None
    result: DiagnosisSuggestion | None
    error: DiagnosisError | None
    model: str
    provider: str
    usage: dict[str, Any]
    created_at: str
    review: DiagnosisReview | None
    actions: DiagnosisActions


class IssuePermissions(IssueContract):
    can_generate: bool
    can_adopt: bool
    can_dismiss: bool


class IssueDetail(IssueContract):
    project_id: Identity
    version: int
    as_of: str
    issue: IssueRecord
    issue_basis: Digest
    evidence: list[EvidenceItem] = Field(max_length=32)
    requirement_id: str | None
    diagnoses: list[DiagnosisView] = Field(max_length=20)
    next_cursor: str | None
    permissions: IssuePermissions
    reasons: list[DiagnosisReason]


class DiagnosisHistory(IssueContract):
    project_id: Identity
    issue_id: Identity
    issue_basis: Digest
    items: list[DiagnosisView] = Field(max_length=20)
    next_cursor: str | None
