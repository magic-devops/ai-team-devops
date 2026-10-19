"""Small immutable Issue event provenance projections; original bodies stay in receipts."""

from typing import Literal

from pydantic import Field

from .delivery_issue_contract import DiagnosisActor, Digest, EvidenceItem, Identity, IssueContract


class IssueOrigin(IssueContract):
    id: Identity
    issue_id: Identity
    receipt_id: Identity
    attempt_id: Identity
    operation: Literal["create", "update", "delete"]
    effect_kind: Literal["issue_created", "record_upserted", "record_deleted"]
    digest: Digest
    basis: Digest
    event_id: str | None
    event_type: str | None
    source: str | None
    producer: DiagnosisActor | None
    processed_at: str
    available: bool
    unavailable_reason: str | None
    evidence: EvidenceItem


class IssueOrigins(IssueContract):
    project_id: Identity
    issue_id: Identity
    issue_available: bool
    as_of: str
    items: list[IssueOrigin] = Field(max_length=100)
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    next_cursor: str | None


class IssueOriginDetail(IssueContract):
    project_id: Identity
    issue_id: Identity
    issue_available: bool
    as_of: str
    origin: IssueOrigin
