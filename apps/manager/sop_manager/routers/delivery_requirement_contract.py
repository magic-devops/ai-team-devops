"""Bounded requirement originals, current relationships and complete change proof."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .delivery_activity_contract import ActivityActor, ActivityTarget, FieldChange, RequirementDefinition
from .delivery_contract import Stage

Count = Annotated[int, Field(ge=0)]
SummaryText = Annotated[str, Field(max_length=256)]
RecordCollection = Literal["artifacts", "reviews", "releases"]
RequirementImpactKind = Literal[
    "direct_task", "dependent_task", "execution", "release_candidate", "deployment"
]


class RequirementReadModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RequirementReadReason(RequirementReadModel):
    code: str
    message: str


class RequirementReadEnvelope(RequirementReadModel):
    project_id: str
    requirement_id: str
    version: int
    query_generation: int
    as_of: str


class RequirementGate(RequirementReadModel):
    id: str
    ok: bool


class RequirementRecordCounts(RequirementReadModel):
    artifacts: Count
    reviews: Count
    releases: Count


class RequirementFlowHead(RequirementReadModel):
    stage: Stage
    revision: int
    owner_id: str
    due_on: str | None
    milestone_id: str
    blocked_reason: str
    closed: bool
    legacy_completed: bool
    gates: list[RequirementGate]
    record_counts: RequirementRecordCounts


class RequirementHead(RequirementReadModel):
    id: str
    title: SummaryText
    priority: Literal["P0", "P1", "P2", "P3"]
    status: str
    sprint_id: str
    basis: str
    flow: RequirementFlowHead
    tasks_total: Count
    tasks_done: Count
    tasks_recorded_done: Count
    accepted: bool
    deployment_verified: bool


class RequirementHeadResponse(RequirementReadEnvelope):
    requirement: RequirementHead


class RequirementDefinitionResponse(RequirementReadEnvelope):
    requirement_basis: str
    definition: RequirementDefinition


class RequirementVersionMetadata(RequirementReadModel):
    id: str
    number: int
    basis: str
    at: str
    actor: ActivityActor
    source: Literal["delivery_command", "sql_observed"]
    flow_revision: int | None


class RequirementHistoryPage(RequirementReadModel):
    project_id: str
    requirement_id: str
    as_of: str
    items: list[RequirementVersionMetadata] = Field(max_length=100)
    limit: int
    next_cursor: str | None
    earlier_history_unknown: bool = True


class RequirementRecordSummary(RequirementReadModel):
    position: Count
    revision: int | None
    kind: SummaryText | None
    stage: SummaryText | None
    title: SummaryText | None
    result: SummaryText | None
    decision: SummaryText | None
    actor: SummaryText | None
    at: SummaryText | None
    stale: bool | None


class RequirementRecordsPage(RequirementReadEnvelope):
    requirement_basis: str
    collection: RecordCollection
    items: list[RequirementRecordSummary] = Field(max_length=100)
    total: Count
    limit: int
    next_cursor: str | None


class RequirementRecordDetail(RequirementReadEnvelope):
    requirement_basis: str
    collection: RecordCollection
    position: Count
    record: dict[str, Any]


class RequirementReadBudget(RequirementReadModel):
    max_tasks: int = 10000
    max_closure_tasks: int = 10000
    max_requirements: int = 10000
    max_records_per_collection: int = 10000
    max_bytes: int = 16777216
    max_item_bytes: int = 1048576
    max_dependency_depth: int = 64
    task_count: int | None = None
    closure_task_count: int | None = None
    requirement_count: int | None = None
    execution_count: int | None = None
    release_candidate_count: int | None = None
    deployment_count: int | None = None
    bytes_used: int | None = None


class RequirementImpactCounts(RequirementReadModel):
    direct_task: Count
    dependent_task: Count
    execution: Count
    release_candidate: Count
    deployment: Count
    restricted_execution: Count
    restricted_deployment: Count


class RequirementImpactSummary(RequirementReadEnvelope):
    requirement_basis: str
    available: bool
    complete: bool
    counts: RequirementImpactCounts | None
    budget: RequirementReadBudget
    reasons: list[RequirementReadReason]


class RequirementImpactItem(RequirementReadModel):
    id: str
    kind: RequirementImpactKind
    title: SummaryText | None
    status: SummaryText | None
    target: ActivityTarget


class RequirementImpactPage(RequirementReadEnvelope):
    requirement_basis: str
    kind: RequirementImpactKind
    items: list[RequirementImpactItem] = Field(max_length=100)
    total: Count
    limit: int
    next_cursor: str | None


class RequirementImpactDetail(RequirementReadEnvelope):
    requirement_basis: str
    kind: RequirementImpactKind
    item: RequirementImpactItem


class RequirementPreviewImpact(RequirementReadModel):
    counts: RequirementImpactCounts | None
    invalidates_current_acceptance: bool | None


class RequirementChangePreview(RequirementReadEnvelope):
    requirement_basis: str
    preview_basis: str | None
    changes: list[FieldChange]
    impact: RequirementPreviewImpact
    available: bool
    complete: bool
    allowed: bool
    budget: RequirementReadBudget
    reasons: list[RequirementReadReason]
