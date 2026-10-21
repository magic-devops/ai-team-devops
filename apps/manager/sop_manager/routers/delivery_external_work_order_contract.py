"""Formal external work orders; reported execution never constitutes acceptance."""
from typing import Annotated, Literal
from math import isfinite

from fastapi import HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from .delivery_execution_contract import ExecutionSnapshot
from .delivery_issue_contract import human_text


def work_order_text(value):
    try:
        human_text(value)
    except UnicodeError:
        # FastAPI's default validation response echoes the invalid input. An
        # unpaired surrogate cannot itself be serialized as a UTF-8 response.
        raise HTTPException(422, {"code": "work_order_text_invalid", "message": "Use valid UTF-8 work-order text."}) from None
    if any(127 <= ord(char) <= 159 for char in value):
        raise ValueError("Control characters are not allowed")
    return value


def member_identity(value):
    work_order_text(value)
    if value != value.strip() or not value.strip() or any(char in value for char in "\r\n\t"):
        raise ValueError("Retain the exact formal resource identity")
    return value


def identity(value):
    member_identity(value)
    if value in {".", ".."} or any(char in value for char in "/\\"):
        raise ValueError("Retain the exact path resource identity")
    return value


Identity = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=64), AfterValidator(identity)]
MemberIdentity = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=100), AfterValidator(member_identity)]
Digest = Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{64}$")]
Comment = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=4000)]
State = Literal["queued", "claimed", "cancel_requested", "reported", "closed"]
MAX_PACKET_BYTES = 524288


class Contract(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def valid_utf8_json(cls, value):
        # Check before constraints: their errors echo the rejected value, even
        # for a wrong type or overlong field. Never echo an invalid surrogate.
        pending, visited = [(value, 0)], 0
        while pending:
            item, depth = pending.pop()
            visited += 1
            if depth > 64 or visited > 100000:
                raise HTTPException(422, {"code": "work_order_json_invalid", "message": "Use a bounded work-order JSON value."})
            if isinstance(item, str):
                try:
                    item.encode("utf-8")
                except UnicodeError:
                    raise HTTPException(422, {"code": "work_order_text_invalid", "message": "Use valid UTF-8 work-order text."}) from None
            elif isinstance(item, float) and not isfinite(item):
                raise HTTPException(422, {"code": "work_order_json_invalid", "message": "Use finite JSON numbers."})
            elif isinstance(item, dict):
                pending.extend((part, depth + 1) for pair in item.items() for part in pair)
            elif isinstance(item, (list, tuple)):
                pending.extend((part, depth + 1) for part in item)
        return value

    @field_validator("*", mode="after")
    @classmethod
    def valid_text(cls, value):
        if isinstance(value, str):
            work_order_text(value)
        return value


class Reason(Contract):
    code: str
    message: str


class Actor(Contract):
    id: Identity
    name: str


class Executor(Contract):
    id: MemberIdentity
    name: str
    kind: Literal["agent", "tool"]
    tool: str
    active: bool
    available: bool
    reasons: list[Reason]


class PreviewInput(Contract):
    task_basis: Digest
    executor_member_id: MemberIdentity
    instructions: str = Field(default="", max_length=4000)


class WorkOrderCreate(PreviewInput):
    task_id: Identity
    definition_digest: Digest
    native_boundary_digest: Digest
    preview_basis: Digest


class Target(Contract):
    id: Identity
    order_revision: int = Field(ge=1)


class WorkOrderClaim(Target):
    pass


class WorkOrderProgress(Target):
    percent: int | None = Field(ge=0, le=100)
    status: Literal["running", "blocked"]
    message: Comment


class WorkOrderCancel(Target):
    comment: Comment


class WorkOrderRelease(Target):
    stopped_attestation: Literal[True]
    comment: Comment

    @field_validator("stopped_attestation", mode="before")
    @classmethod
    def actual_attestation(cls, value):
        if value is not True:
            raise ValueError("Explicitly attest that the external work stopped")
        return value


class WorkOrderReport(Target):
    submission_id: Identity
    submission_digest: Digest
    stopped_attestation: Literal[True]

    @field_validator("stopped_attestation", mode="before")
    @classmethod
    def actual_attestation(cls, value):
        if value is not True:
            raise ValueError("Explicitly attest that the external work stopped")
        return value


class Envelope(Contract):
    project_id: Identity
    version: int = Field(ge=0)
    query_generation: int | None
    as_of: str


class Current(Envelope):
    task_id: Identity
    task_basis: Digest
    definition_digest: Digest
    native_boundary_digest: Digest | None
    definition: ExecutionSnapshot
    executors: list[Executor]
    active_work_order_id: Identity | None
    can_dispatch: bool
    reasons: list[Reason]


class Preview(Current):
    complete: bool
    allowed: bool
    preview_basis: Digest | None
    packet_digest: Digest | None
    executor: Executor | None
    max_packet_bytes: int


class ReportedProgress(Contract):
    percent: int | None
    status: Literal["running", "blocked"]
    message: str
    reported_at: str
    source: Literal["external_reported"]


class SubmissionLink(Contract):
    id: Identity
    digest: Digest


class Closure(Contract):
    kind: Literal["never_claimed", "external_reported_stop"]
    actor: Actor
    comment: str
    at: str


class Permissions(Contract):
    can_claim: bool
    can_progress: bool
    can_cancel: bool
    can_release: bool
    can_report: bool
    reasons: list[Reason]


class Summary(Contract):
    id: Identity
    task_id: Identity
    task_title: str
    order_revision: int
    state: State
    request_digest: Digest
    packet_digest: Digest
    definition_digest: Digest
    native_boundary_digest: Digest
    executor: Executor
    requested_by: Actor
    claimed_by: Actor | None
    created_at: str
    updated_at: str
    claimed_at: str | None
    invalidated: bool
    invalidated_reason: str | None
    progress: ReportedProgress | None
    submission: SubmissionLink | None
    delivery_state: Literal["awaiting_review", "accepted", "changes_requested", "invalidated"] | None
    closure: Closure | None


class Page(Envelope):
    items: list[Summary]
    total: int
    limit: int
    next_cursor: str | None


class Detail(Envelope):
    work_order: Summary
    definition: ExecutionSnapshot
    instructions: str
    permissions: Permissions


class PacketView(Envelope):
    work_order_id: Identity
    request_digest: Digest
    packet_digest: Digest
    packet: dict
    max_packet_bytes: int


COMMANDS = {"work_order.create": WorkOrderCreate, "work_order.claim": WorkOrderClaim,
    "work_order.progress": WorkOrderProgress, "work_order.cancel": WorkOrderCancel,
    "work_order.release": WorkOrderRelease, "work_order.report": WorkOrderReport}
