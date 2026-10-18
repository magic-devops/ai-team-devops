"""Executable proposed event handoff DTOs; design only, not imported by production."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

ID = Annotated[str, Field(min_length=1, max_length=128)]
ScopeID = Annotated[str, Field(min_length=1, max_length=64)]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class FrozenEvent(Strict):
    id: ID
    event_json: str
    digest: Digest


class IngestIn(Strict):
    expected_tenant_id: ScopeID
    expected_project_id: ScopeID
    expected_producer_id: ScopeID
    events: Annotated[list[FrozenEvent], Field(min_length=1, max_length=50)]


class Identity(Strict):
    tenant_id: ScopeID
    project_id: ScopeID
    producer_id: ScopeID


class Producer(Strict):
    kind: Literal["user"]
    id: str


class EventError(Strict):
    code: str
    message: str
    retryable: bool


class EffectResult(Strict):
    kind: Literal[
        "fact_recorded",
        "task_updated",
        "issue_created",
        "record_upserted",
        "record_deleted",
        "asset_materialized",
    ]
    target_kind: Literal["task", "issue", "requirement", "sprint", "asset"] | None
    target_id: str | None


class Processing(Strict):
    state: Literal["pending", "processed", "failed"]
    revision: Annotated[int, Field(ge=1)]
    handler: str | None
    operation_id: str | None
    attempts: Annotated[int, Field(ge=0)]
    updated_at: str
    processed_at: str | None
    reason_code: str | None
    retryable: bool
    result: EffectResult | None


class EventResult(Strict):
    id: str
    digest: Digest
    outcome: Literal["stored", "duplicate", "rejected"]
    receipt_id: str | None
    stored_at: str | None
    processing: Processing | None
    error: EventError | None


class IngestOut(Strict):
    tenant_id: str
    project_id: str
    producer: Producer
    as_of: str
    results: list[EventResult]


class Permissions(Strict):
    read: bool
    configure: bool


class Capabilities(Strict):
    retry: bool
    retry_reason_code: str | None


class EventSummary(Strict):
    id: str
    event_id: str
    digest: Digest
    type: str
    subject: str
    source: str
    producer: Producer
    stored_at: str
    processing: Processing


class Page(Strict):
    project_id: str
    as_of: str
    total: int
    limit: int
    has_more: bool
    next_cursor: str | None


class EventPage(Page):
    items: list[EventSummary]
    permissions: Permissions


class Attempt(Strict):
    id: str
    seq: int
    actor: Producer
    action: Literal["initial", "retry", "recover"]
    created_at: str
    from_state: Literal["pending", "processed", "failed"]
    to_state: Literal["pending", "processed", "failed"]
    error: EventError | None
    result: EffectResult | None


class AttemptPage(Page):
    receipt_id: str
    items: list[Attempt]


class EventDetail(Strict):
    project_id: str
    as_of: str
    event: EventSummary
    event_json: str
    attempts: AttemptPage
    permissions: Permissions
    capabilities: Capabilities


class RetryIn(Strict):
    expected_revision: Annotated[int, Field(ge=1)]
    idempotency_key: Annotated[str, Field(min_length=1, max_length=128)]
    reason: Annotated[str, Field(min_length=1, max_length=2000)]


class RetryAck(Strict):
    project_id: str
    receipt_id: str
    event_id: str
    digest: Digest
    processing: Processing
    attempt_id: str
    replayed: bool
