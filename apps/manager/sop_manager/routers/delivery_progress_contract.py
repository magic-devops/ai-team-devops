"""Bounded progress reads and explicit complete-scope baseline proof."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .delivery_contract import (
    ProgressCoverage,
    ProgressDay,
    ProgressIdealPoint,
    ProgressMetrics,
    ProgressRange,
    ProgressRequirementFact,
    ProgressScope,
    ProgressTaskFact,
)


class ProgressReadModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProgressReadReason(ProgressReadModel):
    code: str
    message: str


class ProgressReadBudget(ProgressReadModel):
    max_tasks: int = 10000
    max_closure_tasks: int = 10000
    max_requirements: int = 10000
    max_bytes: int = 16 * 1024 * 1024
    max_item_bytes: int = 1024 * 1024
    max_dependency_depth: int = 64
    task_count: int | None = None
    closure_task_count: int | None = None
    requirement_count: int | None = None
    bytes_used: int | None = None


class ProgressCurrentSummary(ProgressReadModel):
    scope: ProgressScope
    metrics: ProgressMetrics


class ProgressBaselineMetadata(ProgressReadModel):
    id: str
    title: str
    scope: ProgressScope
    basis: str
    starts_on: str | None
    ends_on: str | None
    created_at: str
    created_by: str
    source_version: int
    note: str
    task_count: int | None
    requirement_count: int | None
    metrics: ProgressMetrics | None
    available: bool
    reasons: list[ProgressReadReason]


class ProgressSeriesResponse(ProgressReadModel):
    project_id: str
    version: int
    query_generation: int
    as_of: str
    timezone: Literal["UTC"] = "UTC"
    scope: ProgressScope
    range: ProgressRange
    current: ProgressCurrentSummary
    coverage: ProgressCoverage
    days: list[ProgressDay] = Field(max_length=366)
    baseline: ProgressBaselineMetadata | None
    ideal: list[ProgressIdealPoint] = Field(max_length=366)


class ProgressBaselinesResponse(ProgressReadModel):
    project_id: str
    as_of: str
    scope: ProgressScope
    items: list[ProgressBaselineMetadata] = Field(max_length=100)
    total: int
    limit: int
    next_cursor: str | None


class ProgressBaselineMetadataResponse(ProgressReadModel):
    project_id: str
    as_of: str
    baseline: ProgressBaselineMetadata


class ProgressObservationMetadata(ProgressReadModel):
    id: str
    observed_at: str
    observed_day: str
    source: str
    actor: str
    source_version: int | None
    snapshot_basis: str
    scope: ProgressScope
    metrics: ProgressMetrics | None
    task_count: int | None
    requirement_count: int | None
    available: bool
    reasons: list[ProgressReadReason]


class ProgressObservationMetadataResponse(ProgressReadModel):
    project_id: str
    as_of: str
    observation: ProgressObservationMetadata


class ProgressTaskSummary(ProgressReadModel):
    id: str
    title: str
    req_id: str
    sprint_id: str
    milestone_id: str
    owner_id: str
    assigned_to: str
    estimate: str | None
    starts_on: str | None
    ends_on: str | None
    basis: str
    status: str
    recorded_status: str


class ProgressSnapshotEnvelope(ProgressReadModel):
    project_id: str
    as_of: str
    source_kind: Literal["observation", "baseline"]
    source_id: str
    snapshot_basis: str
    scope: ProgressScope


class ProgressSnapshotTaskPage(ProgressSnapshotEnvelope):
    collection: Literal["tasks"] = "tasks"
    items: list[ProgressTaskSummary] = Field(max_length=100)
    total: int
    limit: int
    next_cursor: str | None


class ProgressSnapshotRequirementPage(ProgressSnapshotEnvelope):
    collection: Literal["requirements"] = "requirements"
    items: list[ProgressRequirementFact] = Field(max_length=100)
    total: int
    limit: int
    next_cursor: str | None


class ProgressSnapshotTaskDetail(ProgressSnapshotEnvelope):
    collection: Literal["tasks"] = "tasks"
    item: ProgressTaskFact


class ProgressSnapshotRequirementDetail(ProgressSnapshotEnvelope):
    collection: Literal["requirements"] = "requirements"
    item: ProgressRequirementFact


ComparisonKind = Literal["added", "removed", "changed", "incomplete"]


class ProgressComparisonCounts(ProgressReadModel):
    added: int
    removed: int
    changed: int
    incomplete: int
    unchanged: int


class ProgressComparisonEnvelope(ProgressReadModel):
    project_id: str
    version: int
    query_generation: int
    as_of: str
    baseline_id: str
    baseline_basis: str
    scope: ProgressScope
    current_scope_available: bool


class ProgressComparisonSummaryResponse(ProgressComparisonEnvelope):
    available: bool
    complete: bool
    counts: ProgressComparisonCounts | None
    incomplete_plan_fields: list[str]
    budget: ProgressReadBudget
    reasons: list[ProgressReadReason]


class ProgressComparisonItemSummary(ProgressReadModel):
    id: str
    title: str
    before_title: str | None
    after_title: str | None
    fields: list[str]
    incomplete_fields: list[str]


class ProgressComparisonPageResponse(ProgressComparisonEnvelope):
    kind: ComparisonKind
    items: list[ProgressComparisonItemSummary] = Field(max_length=100)
    total: int
    limit: int
    next_cursor: str | None


class ProgressComparisonItemDetail(ProgressReadModel):
    id: str
    fields: list[str]
    incomplete_fields: list[str]
    before: ProgressTaskFact | None
    after: ProgressTaskFact | None


class ProgressComparisonDetailResponse(ProgressComparisonEnvelope):
    kind: ComparisonKind
    item: ProgressComparisonItemDetail


class ProgressFreezeProofResponse(ProgressReadModel):
    project_id: str
    version: int
    query_generation: int
    as_of: str
    scope: ProgressScope
    available: bool
    complete: bool
    basis: str | None
    task_ids: list[str] | None = Field(max_length=10000)
    metrics: ProgressMetrics | None
    budget: ProgressReadBudget
    reasons: list[ProgressReadReason]
