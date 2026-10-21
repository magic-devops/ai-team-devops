"""Bounded attention reads; decisions remain in their original domain commands."""

from typing import Any, Literal

from pydantic import Field

from .delivery_contract import ProgressCoverage, ProgressRange
from .delivery_query_contract import QueryEnvelope, ReadModel

InboxScope = Literal["mine", "team"]
InboxCategory = Literal["all", "work", "approval", "acceptance", "blocked", "overdue"]


class InboxTarget(ReadModel):
    view: str
    requirement_id: str
    detail: str
    task_id: str | None = None
    issue_id: str | None = None
    submission_id: str | None = None
    work_order_id: str | None = None


class InboxCounts(ReadModel):
    work: int = Field(ge=0)
    approval: int = Field(ge=0)
    acceptance: int = Field(ge=0)
    blocked: int = Field(ge=0)
    overdue: int = Field(ge=0)
    total: int = Field(ge=0)


class InboxItem(ReadModel):
    id: str
    kind: Literal["requirement", "task", "issue"]
    resource_id: str
    title: str
    requirement_id: str
    task_id: str
    status: str
    stage: str
    owner_id: str
    due_on: str | None
    priority: str
    categories: list[Literal["work", "approval", "acceptance", "blocked"]]
    blocked_reasons: list[str] = Field(max_length=5)
    blocked_reason_count: int = Field(ge=0)
    overdue: bool
    acceptance_kind: Literal["manual", "execution", "external"] | None = None
    target: InboxTarget


class DeliveryInboxResponse(QueryEnvelope):
    scope: InboxScope
    category: InboxCategory
    current_user_id: str
    as_of: str
    counts: InboxCounts
    items: list[InboxItem]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    has_more: bool
    next_cursor: str | None


class SummaryCurrent(ReadModel):
    metrics: dict[str, Any]


class ProgressSummaryResponse(QueryEnvelope):
    as_of: str
    timezone: Literal["UTC"]
    range: ProgressRange
    current: SummaryCurrent
    coverage: ProgressCoverage
