"""Canonical bounded delivery read and command acknowledgment contracts."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

QuerySort = Literal["created_desc", "id_asc", "id_desc", "title_asc", "priority_asc", "due_asc"]
ReferenceKind = Literal["member", "milestone", "resource", "sprint", "requirement", "task", "execution"]
DeliveryStatus = Literal[
    "pending", "in_progress", "blocked", "awaiting_review", "recorded_completed", "verified_completed"
]


class ReadModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QueryState(ReadModel):
    status: Literal["ready", "rebuild_required"]
    schema_version: int = 5
    computed_at: str | None = None


class QueryEnvelope(ReadModel):
    project_id: str
    version: int
    query_generation: int | None


class DeliveryContext(QueryEnvelope):
    query_state: QueryState
    project: dict[str, Any]
    permissions: dict[str, bool]
    stages: list[dict[str, str]]
    summary: dict[str, Any] | None
    metrics: dict[str, Any] | None


class QueryRebuilt(QueryEnvelope):
    query_state: QueryState
    origin_rebuild: dict[str, int]


class QueryPage(QueryEnvelope):
    as_of: str
    items: list[dict[str, Any]]
    total: int
    next_cursor: str | None
    limit: int


class RequirementPage(QueryPage):
    facets: dict[str, dict[str, int]]


class TaskDetail(QueryEnvelope):
    task: dict[str, Any]
    requirement: dict[str, str] | None
    planning_basis: str


class ExecutionDetail(QueryEnvelope):
    execution: dict[str, Any]


class CommandReference(ReadModel):
    kind: str
    id: str


class CommandAck(QueryEnvelope):
    action: str
    resource: CommandReference
    result: dict[str, Any] | None = None
    affected_refs: list[CommandReference] = Field(default_factory=list)
    applied_version: int
    replayed: bool
