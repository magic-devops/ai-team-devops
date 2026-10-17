"""Current portfolio facts and lifecycle previews share delivery metric semantics."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from .delivery_contract import ProgressMetrics
from .project_lifecycle_contract import ProjectRiskCode, ProjectStatus


class PortfolioContract(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ProjectCapabilities(PortfolioContract):
    can_enter: bool
    can_write: bool
    can_dispatch: bool
    can_configure: bool
    can_transition: bool
    can_archive: bool
    can_restore: bool


class PortfolioProject(PortfolioContract):
    id: str
    tenant_id: str
    tenant_code: str
    business_id: str | None
    business_code: str
    business_name: str
    project_code: str
    name: str
    description: str
    project_path: str
    vector_db: str
    is_template: bool
    template_id: str
    status: ProjectStatus
    version: int
    created_at: str
    updated_at: str
    permissions: ProjectCapabilities


class PortfolioRiskCounts(PortfolioContract):
    blocked: int
    awaiting_review: int
    recorded_completed: int
    overdue_unverified: int
    acceptance_unavailable: int
    owner_unavailable: int
    open_issues: int
    total_items: int


class PortfolioTarget(PortfolioContract):
    project_id: str
    kind: Literal['project', 'task', 'requirement', 'issue', 'milestone', 'execution', 'deployment']
    view: str
    detail: str = 'details'
    requirement_id: str | None = None
    task_id: str | None = None
    issue_id: str | None = None
    milestone_id: str | None = None
    execution_id: str | None = None
    deployment_id: str | None = None
    diagnosis_id: str | None = None


class PortfolioRisk(PortfolioContract):
    id: str
    entity_kind: Literal['task', 'requirement', 'issue', 'milestone']
    entity_id: str
    title: str
    categories: list[ProjectRiskCode]
    due_on: str | None
    target: PortfolioTarget


class PortfolioMilestone(PortfolioContract):
    id: str
    title: str
    starts_on: str | None
    ends_on: str
    target: PortfolioTarget


class ProjectLifecycleFacts(PortfolioContract):
    as_of: str
    basis: str
    metrics: ProgressMetrics
    risk_counts: PortfolioRiskCounts
    unclosed_intents_total: int


class PortfolioRow(PortfolioContract):
    project: PortfolioProject
    facts_source: Literal['live']
    facts_as_of: str
    basis: str
    metrics: ProgressMetrics
    risk_counts: PortfolioRiskCounts
    unclosed_intents_total: int
    nearest_milestone: PortfolioMilestone | None
    primary_target: PortfolioTarget


class PortfolioSummary(PortfolioContract):
    projects_total: int
    status_counts: dict[str, int]
    metrics: ProgressMetrics
    risk_counts: PortfolioRiskCounts


class ProjectPortfolioResponse(PortfolioContract):
    as_of: str
    rows: list[PortfolioRow]
    total: int
    next_cursor: str | None
    limit: int
    summary: PortfolioSummary
    summary_scope: Literal['filtered_projects']
    permissions: dict[Literal['can_create'], bool]


class ProjectArchiveRecord(PortfolioContract):
    id: str
    at: str
    actor_id: str
    actor_name: str
    reason: str
    preview_basis: str
    facts: ProjectLifecycleFacts


class ProjectLifecycleProvenance(PortfolioContract):
    last_archive: ProjectArchiveRecord | None


class ProjectPortfolioDetail(PortfolioRow):
    risks: list[PortfolioRisk]
    lifecycle: ProjectLifecycleProvenance


class ProjectLifecycleBlocker(PortfolioContract):
    code: str
    message: str
    target: PortfolioTarget
    status: str
    run_id: str | None


class ProjectLifecycleWarning(PortfolioContract):
    code: str
    message: str
    count: int


class ProjectLifecyclePreviewResponse(PortfolioContract):
    project_id: str
    version: int
    from_status: ProjectStatus
    target_status: ProjectStatus
    reason: str
    preview_basis: str
    allowed: bool
    blockers: list[ProjectLifecycleBlocker]
    warnings: list[ProjectLifecycleWarning]
    facts: ProjectLifecycleFacts
    permissions: dict[Literal['can_transition'], bool]
