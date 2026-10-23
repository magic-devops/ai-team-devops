"""External work is a fixed report; only an explicit human decision accepts it."""

import json
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_serializer, model_validator

from .delivery_execution_contract import ExecutionSnapshot
from .delivery_external_work_order_contract import Executor, Identity as WorkOrderIdentity
from .delivery_issue_contract import human_text
from .delivery_feedback_contract import FeedbackReference

Digest = Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{64}$")]
Identity = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=64), AfterValidator(human_text)]
EvidenceId = Annotated[str, StringConstraints(strict=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")]
Text = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=2000), AfterValidator(human_text)]
MAX_REPORT_BYTES = 48 * 1024


def _paired_rework_schema(schema):
    # Omission is ordinary work; explicit null is not a selected source.
    for key in ("rework_reference", "rework_basis"):
        field = schema["properties"][key]
        options = [item for item in field.pop("anyOf") if item.get("type") != "null"]
        field.update(options[0])
        field.pop("default", None)
    schema["dependentRequired"] = {"rework_reference": ["rework_basis"], "rework_basis": ["rework_reference"]}


def http_link(value):
    human_text(value)
    if not value:
        return value
    parts = urlsplit(value)
    if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username is not None or parts.password is not None:
        raise ValueError("Use an HTTP(S) link without embedded credentials")
    return value


class Contract(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class SubmissionSource(Contract):
    kind: Literal["human", "agent", "tool"]
    name: Text
    url: str = Field(default="", max_length=2000)
    _url = field_validator("url")(http_link)


class SubmissionArtifact(Contract):
    id: EvidenceId
    title: Text
    content: str = Field(default="", max_length=8000)
    url: str = Field(default="", max_length=2000)
    sha256: Digest | None = None
    _url = field_validator("url")(http_link)
    _content = field_validator("content")(human_text)

    @model_validator(mode="after")
    def evidence_present(self):
        if not self.content.strip() and not self.url:
            raise ValueError("Provide evidence content or a link")
        return self


class SubmissionCriterion(Contract):
    source: Literal["task", "requirement"]
    index: int = Field(ge=0)
    text_digest: Digest
    result: Literal["met", "not_met", "unknown"]
    evidence_ids: list[EvidenceId] = Field(max_length=40)


class SubmissionTest(Contract):
    id: EvidenceId
    title: Text
    status: Literal["passed", "failed", "skipped", "not_run", "unknown"]
    evidence_ids: list[EvidenceId] = Field(max_length=40)


class SubmissionWorkOrderBinding(Contract):
    id: WorkOrderIdentity
    order_revision: int = Field(ge=1)
    stopped_attestation: Literal[True]

    @field_validator("stopped_attestation", mode="before")
    @classmethod
    def actual_stop_attestation(cls, value):
        if value is not True:
            raise ValueError("Explicitly attest that this external work stopped")
        return value


class SubmissionWorkOrderContext(Contract):
    id: WorkOrderIdentity
    order_revision: int = Field(ge=1)
    executor: Executor


class TaskDeliverySubmit(Contract):
    model_config = ConfigDict(strict=True, extra="forbid", json_schema_extra=_paired_rework_schema)

    task_id: Identity
    task_basis: Digest
    definition_digest: Digest
    native_boundary_digest: Digest
    source: SubmissionSource
    summary: Text
    artifacts: list[SubmissionArtifact] = Field(min_length=1, max_length=40)
    criteria: list[SubmissionCriterion] = Field(min_length=1, max_length=160)
    tests: list[SubmissionTest] = Field(max_length=40)
    work_order: SubmissionWorkOrderBinding | None = None
    rework_reference: FeedbackReference | None = None
    rework_basis: Digest | None = None

    @model_validator(mode="before")
    @classmethod
    def explicit_rework_pair(cls, value):
        if isinstance(value, dict) and {"rework_reference", "rework_basis"}.intersection(value):
            if value.get("rework_reference") is None or value.get("rework_basis") is None:
                raise ValueError("Select a complete fixed rework reference and preview basis together")
        return value

    @model_serializer(mode="wrap")
    def original_shape(self, handler):
        values = handler(self)
        if self.rework_reference is None:
            # Ordinary originals and event inputs keep their prior exact shape.
            values.pop("rework_reference", None)
            values.pop("rework_basis", None)
        return values

    @model_validator(mode="after")
    def fixed_references_and_budget(self):
        artifact_ids = {item.id for item in self.artifacts}
        if len(artifact_ids) != len(self.artifacts) or len({item.id for item in self.tests}) != len(self.tests):
            raise ValueError("Artifact and test IDs must be unique")
        if len({(item.source, item.index) for item in self.criteria}) != len(self.criteria):
            raise ValueError("Each fixed acceptance condition must appear once")
        for item in [*self.criteria, *self.tests]:
            if len(set(item.evidence_ids)) != len(item.evidence_ids) or not set(item.evidence_ids).issubset(artifact_ids):
                raise ValueError("Evidence IDs must reference distinct artifacts in this report")
            reported = item.result in {"met", "not_met"} if isinstance(item, SubmissionCriterion) else item.status in {"passed", "failed"}
            if reported and not item.evidence_ids:
                raise ValueError("A reported result requires explicit evidence")
        encoded = json.dumps(self.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_REPORT_BYTES:
            raise ValueError("The complete external report must not exceed 48 KiB")
        return self


class TaskDeliveryReview(Contract):
    task_id: Identity
    submission_id: Identity
    submission_digest: Digest
    task_basis: Digest
    native_boundary_digest: Digest
    decision: Literal["accept", "request_changes"]
    comment: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=4000), AfterValidator(human_text)]


class SubmissionReason(Contract):
    code: str
    message: str


class SubmissionActor(Contract):
    id: Identity
    name: str


class CurrentCriterion(Contract):
    source: Literal["task", "requirement"]
    index: int = Field(ge=0)
    text: str
    text_digest: Digest


class SubmissionCounts(Contract):
    artifacts: int = Field(ge=0)
    criteria: int = Field(ge=0)
    tests: int = Field(ge=0)
    reported_passed: int = Field(ge=0)
    reported_failed: int = Field(ge=0)


class SubmissionSummary(Contract):
    id: Identity
    task_id: Identity
    created_at: str
    submitted_by: SubmissionActor
    source: SubmissionSource
    summary: str = Field(max_length=240)
    digest: Digest
    task_basis: Digest
    definition_digest: Digest
    native_boundary_digest: Digest
    status: Literal["awaiting_review", "accepted", "changes_requested", "invalidated"]
    invalidated: bool
    invalidated_at: str | None
    invalidated_reason: str
    counts: SubmissionCounts
    issue_id: Identity | None
    review_id: Identity | None


class SubmissionDecision(Contract):
    id: Identity
    review_id: Identity
    decision: Literal["accept", "request_changes"]
    reviewer: SubmissionActor
    comment: str
    created_at: str


class SubmissionPermissions(Contract):
    can_review: bool
    can_accept: bool
    reasons: list[SubmissionReason]


class SubmissionCurrent(Contract):
    project_id: Identity
    task_id: Identity
    version: int = Field(ge=0)
    query_generation: int | None
    as_of: str
    task_basis: Digest
    definition_digest: Digest
    native_boundary_digest: Digest
    definition: ExecutionSnapshot
    criteria: list[CurrentCriterion]
    can_submit: bool
    reasons: list[SubmissionReason]
    latest_submission_id: Identity | None
    work_order: SubmissionWorkOrderContext | None


class SubmissionRework(Contract):
    schema: Literal["manager.submission-rework.v1"]
    reference: FeedbackReference
    basis: Digest
    feedback_context: dict
    feedback_context_sha256: Digest
    feedback_runtime_scopes: list[Identity] = Field(max_length=1000)
    target_work_order: SubmissionWorkOrderContext | None


class SubmissionReworkPreviewInput(Contract):
    rework_reference: FeedbackReference


class SubmissionReworkDraft(Contract):
    source: None
    summary: Text
    artifacts: list[SubmissionArtifact] = Field(min_length=1, max_length=40)
    criteria: list[SubmissionCriterion] = Field(max_length=160)
    tests: list[SubmissionTest] = Field(max_length=40)


class SubmissionReworkPreview(Contract):
    project_id: Identity
    task_id: Identity
    version: int = Field(ge=0)
    query_generation: int | None
    as_of: str
    rework_reference: FeedbackReference
    rework_basis: Digest
    current: SubmissionCurrent
    feedback_context: dict
    feedback_context_sha256: Digest
    draft: SubmissionReworkDraft
    allowed: bool
    reasons: list[SubmissionReason]


class SubmissionDetail(Contract):
    project_id: Identity
    task_id: Identity
    version: int = Field(ge=0)
    as_of: str
    task_basis: Digest | None
    native_boundary_digest: Digest | None
    submission: SubmissionSummary
    payload: TaskDeliverySubmit
    definition: ExecutionSnapshot
    decision: SubmissionDecision | None
    permissions: SubmissionPermissions
    rework: SubmissionRework | None = None


class SubmissionPage(Contract):
    project_id: Identity
    task_id: Identity
    as_of: str
    items: list[SubmissionSummary]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    next_cursor: str | None


def command_openapi_contracts():
    def inline(model):
        schema = model.model_json_schema()
        definitions = schema.pop("$defs", {})

        def resolve(value):
            if isinstance(value, list):
                return [resolve(item) for item in value]
            if isinstance(value, dict):
                if "$ref" in value:
                    reference = value["$ref"]
                    if not reference.startswith("#/$defs/"):
                        raise ValueError("Unexpected command schema reference")
                    return {**resolve(definitions[reference.removeprefix("#/$defs/")]),
                            **{key: resolve(item) for key, item in value.items() if key != "$ref"}}
                return {key: resolve(item) for key, item in value.items()}
            return value

        return resolve(schema)

    return {"x-delivery-command-contracts": {
        "task.delivery.submit": {"payload": inline(TaskDeliverySubmit), "result_semantics": "report_saved_not_accepted"},
        "task.delivery.review": {"payload": inline(TaskDeliveryReview), "result_semantics": "human_review_recorded"},
    }}


class SubmissionLocator(Contract):
    project_id: Identity
    task_id: Identity
    submission_id: Identity
