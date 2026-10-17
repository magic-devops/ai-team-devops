"""Delivery vocabulary, input contracts and evidence-based stage gates."""

from __future__ import annotations

import re
from datetime import date
from typing import Annotated, Literal
from urllib.parse import parse_qsl, unquote, urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from sop_manager.task_acceptance import TaskAcceptanceCriteria
from sop_manager.task_owner import TaskOwnerId

from .delivery_ci_contract import ReleaseCiImport, ReleasePolicySave
from .delivery_execution_contract import ExecutionQueue
from .delivery_release_contract import ReleaseCandidateCreate, ReleaseCandidateReview, ReleaseCandidateRevoke
from .delivery_scheduling_contract import (
    AllocationInput,
    CalendarSave,
    ScheduleChanges,
    StoredAllocation,
    civil_date,
)
from .delivery_team_runtime_contract import MemberRuntimeBind, MemberRuntimeUnbind
from .project_lifecycle_contract import ProjectLifecycleCommand

STAGES = [
    {"id": "intake", "artifact": "", "route": "#/requirements/intake"},
    {"id": "product", "artifact": "prd", "route": "#/requirements"},
    {"id": "ux", "artifact": "prototype", "route": "#/requirements"},
    {"id": "architecture", "artifact": "architecture", "route": "#/intelligence/design-docs"},
    {"id": "planning", "artifact": "", "route": "#/tasks"},
    {"id": "development", "artifact": "", "route": "#/tasks/execution"},
    {"id": "testing", "artifact": "test", "route": "#/tasks/quality-governance"},
    {"id": "acceptance", "artifact": "", "route": "#/tasks/quality-governance"},
    {"id": "release", "artifact": "", "route": "#/dev-flow?view=releases"},
    {"id": "operations", "artifact": "runbook", "route": "#/issues/tracker"},
]
STAGE_IDS = [s["id"] for s in STAGES]
Stage = Literal[
    "intake",
    "product",
    "ux",
    "architecture",
    "planning",
    "development",
    "testing",
    "acceptance",
    "release",
    "operations",
]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TaskAcceptanceSource(BaseModel):
    source: Literal["task", "requirement"]
    index: int
    text: str


class TaskAcceptance(BaseModel):
    criteria: list[str]
    sources: list[TaskAcceptanceSource]
    available: bool
    requirement_id: str | None
    requirement_revision: int | None


class Command(Input):
    action: Literal[
        "project.update",
        "project.lifecycle",
        "resource.save",
        "resource.archive",
        "member.save",
        "member.runtime.bind",
        "member.runtime.unbind",
        "milestone.save",
        "requirement.create",
        "requirement.update",
        "task.create",
        "task.update",
        "task.manual_review",
        "tasks.schedule",
        "member.calendar.save",
        "tasks.plan",
        "artifact.add",
        "stage.advance",
        "stage.reopen",
        "issue.promote",
        "release.policy.save",
        "release.ci.import",
        "release.candidate.create",
        "release.candidate.review",
        "release.candidate.revoke",
        "execution.queue",
        "execution.sync",
        "execution.review",
        "execution.cancel",
        "progress.record",
        "baseline.create",
    ]
    expected_version: int = Field(ge=0)
    idempotency_key: str = Field(min_length=8, max_length=100)
    payload: dict


class Dated(Input):
    starts_on: date | None = None
    ends_on: date | None = None
    _civil_dates = field_validator("starts_on", "ends_on", mode="before")(civil_date)

    @model_validator(mode="after")
    def dates_in_order(self):
        if self.starts_on and self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("End date must not precede start date")
        return self


class ProjectEdit(Dated):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=20000)
    goal: str = Field(default="", max_length=10000)
    owner_id: str = Field(default="", max_length=100)
    business_id: str | None = Field(default=None, min_length=1, max_length=64)
    project_path: str = Field(default="", max_length=512)
    vector_db: Literal['lance', 'milvus', 'qdrant', 'oceanbase'] = 'lance'
    vector_db_config: dict = Field(default_factory=dict)
    is_template: bool = Field(default=False, strict=True)

    @field_validator("name", "description")
    @classmethod
    def explicit_project_text(cls, value):
        if value is None:
            raise ValueError("Omit unchanged project text; use an empty description to clear it")
        return value


def _credential_query_key(key):
    normalized = re.sub(r"[^a-z0-9]", "", key.lower())
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", key).lower()
    sensitive = {"token", "password", "passwd", "pwd", "key", "secret", "credential", "credentials"}
    return bool(sensitive.intersection(re.split(r"[^a-z0-9]+", words))) or normalized in {
        "accesstoken",
        "refreshtoken",
        "idtoken",
        "authtoken",
        "bearertoken",
        "securitytoken",
        "apikey",
        "accesskey",
        "privatekey",
        "secretkey",
        "clientsecret",
        "authorization",
        "auth",
        "signature",
        "sig",
        "xamzcredential",
        "xamzsignature",
        "xamzsecuritytoken",
        "xgoogcredential",
        "xgoogsignature",
        "awsaccesskeyid",
    }


class ResourceSave(Input):
    id: str = Field(default="", max_length=64)
    kind: Literal["repository", "document", "design", "other"]
    title: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=2000)
    description: str = Field(default="", max_length=4000)
    ref: str = Field(default="", max_length=200)
    archived: bool = False

    @field_validator("url", mode="before")
    @classmethod
    def safe_resource_url(cls, value):
        if not isinstance(value, str):
            raise ValueError("Use an HTTP(S) resource URL")
        if any(ord(c) < 32 or ord(c) == 127 for c in unquote(value)):
            raise ValueError("Resource URLs cannot contain control characters")
        try:
            parsed = urlsplit(value)
            invalid = (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or "\\" in value
                or any(c.isspace() for c in parsed.netloc)
            )
            # Accessing port validates malformed/out-of-range port syntax.
            _ = parsed.port
        except ValueError as exc:
            raise ValueError("Use a valid HTTP(S) resource URL") from exc
        if invalid:
            raise ValueError("Use an HTTP(S) resource URL without account credentials")
        for key, _ in parse_qsl(parsed.query, keep_blank_values=True):
            if _credential_query_key(key):
                raise ValueError("Resource links cannot carry credentials in query parameters")
        return value


class ResourceArchive(Input):
    id: str = Field(min_length=1, max_length=64)
    comment: str = Field(default="", max_length=4000)


class ProgressRecord(Input):
    pass


class BaselineCreate(Dated):
    title: str = Field(min_length=1, max_length=200)
    scope: Literal["project", "milestone", "sprint"] = "project"
    scope_id: str = Field(default="", max_length=100)
    task_ids: list[str] = Field(max_length=10000)
    basis: str = Field(pattern=r"^[0-9a-f]{64}$")
    note: str = Field(default="", max_length=4000)

    @field_validator("task_ids")
    @classmethod
    def explicit_task_ids(cls, values):
        if len(values) != len(set(values)) or any(
            not value or value != value.strip() or len(value) > 64 for value in values
        ):
            raise ValueError("Task IDs must be unique, nonempty IDs")
        return values

    @model_validator(mode="after")
    def explicit_scope(self):
        if (self.scope == "project" and self.scope_id) or (self.scope != "project" and not self.scope_id):
            raise ValueError("Choose a project scope without scope_id or a named milestone/sprint scope")
        return self


ProgressScopeKind = Literal["project", "milestone", "sprint"]
ProgressTaskStatus = Literal[
    "pending", "in_progress", "blocked", "awaiting_review", "recorded_completed", "verified_completed"
]


class ProgressScope(BaseModel):
    kind: ProgressScopeKind
    id: str
    label: str


class ProgressScopeOption(BaseModel):
    id: str
    title: str
    starts_on: str | None = None
    ends_on: str | None = None


class ProgressScopes(BaseModel):
    milestones: list[ProgressScopeOption]
    sprints: list[ProgressScopeOption]


class ProgressTaskFact(BaseModel):
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
    status: ProgressTaskStatus
    recorded_status: str
    allocations: list[StoredAllocation] | None = None
    acceptance_criteria: list[str] | None = None
    requirement_criteria_indices: list[int] | None = None
    acceptance: TaskAcceptance | None = None


class ProgressRequirementFact(BaseModel):
    id: str
    title: str
    milestone_id: str
    sprint_id: str
    stage: str
    revision: int
    basis: str
    accepted: bool
    released: bool


class ProgressStatusCounts(BaseModel):
    pending: int
    in_progress: int
    blocked: int
    awaiting_review: int
    recorded_completed: int
    verified_completed: int


class ProgressMetrics(BaseModel):
    tasks_total: int
    recorded_completed: int
    verified_completed: int
    awaiting_review: int
    remaining: int
    requirements_total: int
    requirements_accepted: int
    requirements_released: int
    status_counts: ProgressStatusCounts


class ProgressCurrent(BaseModel):
    scope: ProgressScope
    tasks: list[ProgressTaskFact]
    requirements: list[ProgressRequirementFact]
    task_ids: list[str]
    basis: str
    metrics: ProgressMetrics


class ProgressRange(BaseModel):
    starts_on: str
    ends_on: str


class ProgressCoverage(BaseModel):
    first_observed_at: str | None
    last_observed_at: str | None
    observed_days: list[str]
    missing_days: list[str]
    future_days: list[str]


class ProgressDay(BaseModel):
    date: str
    observation_id: str | None
    observed_at: str | None
    source: str | None
    metrics: ProgressMetrics | None
    baseline_remaining: int | None


class ProgressBaselineSummary(BaseModel):
    id: str
    title: str
    scope: ProgressScope
    basis: str
    starts_on: str | None
    ends_on: str | None
    created_at: str
    created_by: str
    source_version: int | None
    note: str
    task_ids: list[str]
    metrics: ProgressMetrics


class ProgressBaseline(ProgressBaselineSummary):
    tasks: list[ProgressTaskFact]
    requirements: list[ProgressRequirementFact]


class ProgressTaskChange(BaseModel):
    id: str
    before: ProgressTaskFact
    after: ProgressTaskFact
    fields: list[str]


class ProgressComparison(BaseModel):
    added: list[ProgressTaskFact]
    removed: list[ProgressTaskFact]
    changed: list[ProgressTaskChange]
    unchanged_count: int
    incomplete_plan_fields: list[str] = Field(default_factory=list)
    incomplete_task_ids: list[str] = Field(default_factory=list)


class ProgressIdealPoint(BaseModel):
    date: str
    remaining: float


class ProgressResponse(BaseModel):
    project_id: str
    version: int
    as_of: str
    timezone: Literal["UTC"]
    scope: ProgressScope
    range: ProgressRange
    scopes: ProgressScopes
    current: ProgressCurrent
    coverage: ProgressCoverage
    days: list[ProgressDay]
    baselines: list[ProgressBaselineSummary]
    baseline: ProgressBaseline | None
    comparison: ProgressComparison | None
    ideal: list[ProgressIdealPoint]


class ProgressObservationResponse(BaseModel):
    id: str
    project_id: str
    observed_at: str
    observed_day: str
    source: str
    actor: str
    source_version: int | None
    scope: ProgressScope
    current: ProgressCurrent


class ProgressBaselineResponse(BaseModel):
    project_id: str
    version: int
    as_of: str
    baseline: ProgressBaseline
    current: ProgressCurrent
    comparison: ProgressComparison


class MemberEdit(Input):
    id: str = Field(default="", max_length=100)
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["agent", "tool"]
    role: str = Field(default="developer", max_length=80)
    tool: str = Field(default="", max_length=80)
    active: bool = True


class MilestoneEdit(Dated):
    id: str = Field(default="", max_length=100)
    title: str = Field(min_length=1, max_length=200)
    owner_id: str = Field(default="", max_length=100)


class RequirementCreate(Input):
    title: str = Field(min_length=1, max_length=256)
    description: str = Field(default="", max_length=20000)
    priority: Literal["P0", "P1", "P2", "P3"] = "P1"
    acceptance_criteria: list[str] = Field(default_factory=list, max_length=80)
    owner_id: str = Field(default="", max_length=100)
    due_on: date | None = None
    milestone_id: str = Field(default="", max_length=100)

    @field_validator("acceptance_criteria")
    @classmethod
    def nonempty_criteria(cls, values):
        if any(not v.strip() or len(v) > 2000 for v in values):
            raise ValueError("Acceptance criteria must be nonempty and at most 2000 characters each")
        return [v.strip() for v in values]


class RequirementEdit(Input):
    id: str = Field(min_length=1, max_length=64)
    title: str | None = Field(default=None, min_length=1, max_length=256)
    description: str | None = Field(default=None, max_length=20000)
    priority: Literal["P0", "P1", "P2", "P3"] | None = None
    acceptance_criteria: list[str] | None = Field(default=None, max_length=80)
    owner_id: str | None = Field(default=None, max_length=100)
    due_on: date | None = None
    milestone_id: str | None = Field(default=None, max_length=100)
    blocked_reason: str | None = Field(default=None, max_length=2000)

    @field_validator("acceptance_criteria")
    @classmethod
    def nonempty_criteria(cls, values):
        return RequirementCreate.nonempty_criteria(values) if values is not None else None


class TaskDraft(Dated):
    key: str = Field(default="", max_length=64)
    title: str = Field(min_length=1, max_length=256)
    description: str = Field(default="", max_length=10000)
    owner_id: TaskOwnerId = ""
    priority: Literal["P0", "P1", "P2", "P3"] = "P1"
    estimate: Literal["XS", "S", "M", "L", "XL"] = "M"
    acceptance_criteria: TaskAcceptanceCriteria = Field(default_factory=list)
    requirement_criteria_indices: list[Annotated[int, Field(strict=True, ge=0)]] = Field(
        default_factory=list, max_length=80
    )
    depends_on: list[str] = Field(default_factory=list, max_length=40)
    blocked_reason: str = Field(default="", max_length=2000)

    @field_validator("requirement_criteria_indices", "depends_on")
    @classmethod
    def unique_references(cls, values):
        if len(set(values)) != len(values):
            raise ValueError("References must be unique")
        return values

    @field_validator("depends_on")
    @classmethod
    def nonempty_references(cls, values):
        if any(not value.strip() or len(value) > 64 or value != value.strip() for value in values):
            raise ValueError("Dependency references must be nonempty IDs or plan keys")
        return values


class TaskCreate(TaskDraft):
    requirement_id: str = Field(default="", max_length=64)


class TaskEdit(Dated):
    id: str = Field(min_length=1, max_length=64)
    status: Literal["pending", "in_progress", "blocked", "completed"] | None = None
    owner_id: TaskOwnerId = ""
    description: str | None = Field(default=None, max_length=10000)
    blocked_reason: str | None = Field(default=None, max_length=2000)
    acceptance_criteria: TaskAcceptanceCriteria = Field(default_factory=list)
    requirement_criteria_indices: list[Annotated[int, Field(strict=True, ge=0)]] | None = Field(
        default=None, max_length=80
    )
    depends_on: list[str] | None = Field(default=None, max_length=40)
    task_basis: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    planning_basis: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    allocations: list[AllocationInput] | None = Field(default=None, max_length=80)

    @field_validator("requirement_criteria_indices", "depends_on")
    @classmethod
    def explicit_references(cls, values, info):
        if values is None:
            raise ValueError("Use an array, including [] to clear references")
        TaskDraft.unique_references(values)
        if info.field_name == "depends_on":
            TaskDraft.nonempty_references(values)
        return values

    @model_validator(mode="after")
    def references_require_basis(self):
        definition_fields = {"acceptance_criteria", "requirement_criteria_indices", "depends_on", "owner_id"}
        if definition_fields & self.model_fields_set and self.task_basis is None:
            raise ValueError("Reference edits require the current task basis")
        if {"starts_on", "ends_on", "allocations"} & self.model_fields_set and self.planning_basis is None:
            raise ValueError("Date and reservation edits require the current project planning basis")
        if "allocations" in self.model_fields_set and self.allocations is None:
            raise ValueError("Use an array, including [] to clear reservations")
        return self


class TaskPlan(Input):
    requirement_id: str = Field(min_length=1, max_length=64)
    items: list[TaskDraft] = Field(min_length=1, max_length=40)
    requirement_revision: int | None = Field(default=None, ge=1)
    requirement_basis: str | None = Field(default=None, min_length=64, max_length=64)
    preview_id: str | None = Field(default=None, min_length=1, max_length=64)


class TaskPlanPreview(Input):
    requirement_id: str = Field(min_length=1, max_length=64)
    expected_version: int = Field(ge=0)
    idempotency_key: str = Field(min_length=8, max_length=100)
    generator: Literal["template", "ai"] = "template"
    mode: Literal["frontend", "backend", "fullstack", "testing"] = "fullstack"
    max_items: int = Field(default=8, ge=1, le=40)


class ArtifactAdd(Input):
    requirement_id: str = Field(min_length=1, max_length=64)
    kind: Literal["prd", "prototype", "architecture", "code", "test", "runbook"]
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=50000)
    url: str = Field(default="", max_length=2000)
    result: Literal["recorded", "passed", "failed"] = "recorded"

    @field_validator("url")
    @classmethod
    def safe_url(cls, value):
        if value:
            url = urlsplit(value)
            if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password:
                raise ValueError("Use an HTTP(S) evidence URL without credentials")
        return value

    @model_validator(mode="after")
    def evidence_required(self):
        if not self.content and not self.url:
            raise ValueError("Evidence needs content or a link")
        return self


class TaskManualReview(Input):
    task_id: str = Field(min_length=1, max_length=64)
    decision: Literal["accept", "request_changes"]
    basis: str = Field(pattern=r"^[0-9a-f]{64}$")
    comment: str = Field(min_length=1, max_length=4000)
    evidence_content: str = Field(default="", max_length=20000)
    evidence_url: str = Field(default="", max_length=2000)
    _url = field_validator("evidence_url")(ArtifactAdd.safe_url.__func__)

    @model_validator(mode="after")
    def accepted_evidence_required(self):
        if self.decision == "accept" and not (self.evidence_content or self.evidence_url):
            raise ValueError("Manual acceptance requires evidence content or an HTTP(S) link")
        return self


class TaskReviewTask(BaseModel):
    id: str
    title: str
    description: str
    acceptance_criteria: list[str] | None = None
    req_id: str
    status: str
    owner_id: str | None = None
    assigned_to: str
    priority: str
    estimate: str
    blocked_reason: str


class TaskReviewOwner(BaseModel):
    id: str
    name: str | None
    kind: Literal["human", "agent", "tool"] | None
    active: bool
    available: bool | None = None
    reasons: list[dict[str, str]] = Field(default_factory=list)


class TaskReviewRequirement(BaseModel):
    id: str
    title: str
    description: str
    revision: int
    acceptance_criteria: list[str]
    blocked_reason: str


class TaskReviewPlanning(BaseModel):
    requirement_criteria_indices: list[int] | None = None
    depends_on: list[str]


class TaskReviewSnapshot(BaseModel):
    task: TaskReviewTask
    owner: TaskReviewOwner | None
    requirement: TaskReviewRequirement | None
    acceptance: TaskAcceptance | None = None
    planning: TaskReviewPlanning
    dependency_basis: dict[str, str]


class TaskReviewReason(BaseModel):
    code: str
    message: str


class TaskReviewCurrent(TaskReviewSnapshot):
    basis: str
    eligible: bool
    can_review: bool
    can_accept: bool
    reasons: list[TaskReviewReason]
    dependency_blocked: list[str]
    verified: bool


class TaskReviewReviewer(BaseModel):
    id: str
    name: str


class TaskReviewRecord(BaseModel):
    id: str
    task_id: str
    decision: Literal["accept", "request_changes"]
    created_at: str
    reviewer: TaskReviewReviewer
    task_basis: str
    snapshot: TaskReviewSnapshot
    comment: str
    evidence_content: str
    evidence_url: str
    source: Literal["manual"]
    invalidated: bool
    invalidated_at: str | None
    invalidated_reason: str
    valid: bool


class TaskReviewsResponse(BaseModel):
    project_id: str
    task_id: str
    version: int
    as_of: str
    current: TaskReviewCurrent | None
    reviews: list[TaskReviewRecord]
    total: int
    next_cursor: str | None
    limit: int


class StageAction(Input):
    requirement_id: str = Field(min_length=1, max_length=64)
    comment: str = Field(min_length=1, max_length=4000)


class IssuePromote(Input):
    issue_id: str = Field(min_length=1, max_length=64)
    acceptance_criteria: list[str] = Field(min_length=1, max_length=80)
    _criteria = field_validator("acceptance_criteria")(RequirementCreate.nonempty_criteria.__func__)


class ExecutionSync(Input):
    id: str = Field(min_length=1, max_length=64)


class ExecutionReview(ExecutionSync):
    decision: Literal["accept", "request_changes"]
    comment: str = Field(min_length=1, max_length=4000)
    run_version: int = Field(ge=1)


PAYLOADS = {
    "project.lifecycle": ProjectLifecycleCommand,
    "tasks.schedule": ScheduleChanges,
    "member.calendar.save": CalendarSave,
    "task.manual_review": TaskManualReview,
    "progress.record": ProgressRecord,
    "baseline.create": BaselineCreate,
    "execution.queue": ExecutionQueue,
    "execution.sync": ExecutionSync,
    "execution.review": ExecutionReview,
    "execution.cancel": ExecutionSync,
    "project.update": ProjectEdit,
    "resource.save": ResourceSave,
    "resource.archive": ResourceArchive,
    "member.save": MemberEdit,
    "member.runtime.bind": MemberRuntimeBind,
    "member.runtime.unbind": MemberRuntimeUnbind,
    "milestone.save": MilestoneEdit,
    "requirement.create": RequirementCreate,
    "requirement.update": RequirementEdit,
    "task.create": TaskCreate,
    "task.update": TaskEdit,
    "tasks.plan": TaskPlan,
    "artifact.add": ArtifactAdd,
    "stage.advance": StageAction,
    "stage.reopen": StageAction,
    "issue.promote": IssuePromote,
    "release.policy.save": ReleasePolicySave,
    "release.ci.import": ReleaseCiImport,
    "release.candidate.create": ReleaseCandidateCreate,
    "release.candidate.review": ReleaseCandidateReview,
    "release.candidate.revoke": ReleaseCandidateRevoke,
}


def default_flow():
    return {
        "stage": "intake",
        "revision": 1,
        "owner_id": "",
        "due_on": None,
        "milestone_id": "",
        "blocked_reason": "",
        "artifacts": [],
        "reviews": [],
        "releases": [],
        "closed": False,
    }


def stage_gates(requirement, flow, tasks, issues):
    stage = flow["stage"]
    revision = flow["revision"]
    artifacts = [a for a in flow["artifacts"] if a["revision"] == revision]
    linked = [t for t in tasks if t["req_id"] == requirement["id"]]
    linked_ids = {t["id"] for t in linked}
    failures = [
        i
        for i in issues
        if i["task_id"] in linked_ids
        and i["status"] not in {"resolved", "closed"}
        and i["severity"] in {"P0", "P1"}
    ]
    checks = [{"id": "not_blocked", "ok": not flow.get("blocked_reason")}]
    if stage == "intake":
        checks.append({"id": "criteria", "ok": bool(requirement.get("acceptance_criteria"))})
    artifact = next(s["artifact"] for s in STAGES if s["id"] == stage)
    if artifact:
        evidence = [a for a in artifacts if a["kind"] == artifact]
        # A later failed test supersedes an older passing report.
        checks.append(
            {
                "id": artifact,
                "ok": bool(evidence)
                and not evidence[-1].get("stale", False)
                and evidence[-1]["result"] != "failed"
                and (artifact != "test" or evidence[-1]["result"] == "passed"),
            }
        )
    if stage in {"planning", "development", "testing", "acceptance", "release"}:
        checks.append({"id": "tasks", "ok": bool(linked)})
        checks.append(
            {
                "id": "task_acceptance",
                "ok": bool(linked)
                and all(
                    (t.get("acceptance") or {}).get("available")
                    and bool((t.get("acceptance") or {}).get("criteria"))
                    for t in linked
                ),
            }
        )
    if stage in {"planning", "development", "testing", "acceptance", "release"}:
        checks.append(
            {
                "id": "assignment",
                "ok": bool(linked)
                and all(t.get("owner_id") and t.get("owner_active", False) for t in linked),
            }
        )
    if stage in {"development", "testing", "acceptance", "release"}:
        checks.append(
            {"id": "tasks_completed", "ok": bool(linked) and all(t["status"] == "completed" for t in linked)}
        )
    if stage in {"testing", "acceptance", "release"}:
        checks.append({"id": "critical_issues", "ok": not failures})
    if stage in {"acceptance", "release"}:
        reports = [a for a in artifacts if a["kind"] == "test"]
        checks.append(
            {
                "id": "test",
                "ok": bool(reports)
                and not reports[-1].get("stale", False)
                and reports[-1]["result"] == "passed",
            }
        )
    if stage == "release":
        # Candidate approval authorizes preparation. Only a real deployment
        # adapter can provide this boundary; manual history cannot satisfy it.
        checks.append({"id": "deployment_verified", "ok": False})
    return checks
