"""Authenticated project delivery workflow."""

import hashlib
import json
from contextlib import contextmanager, nullcontext
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Path, Query, Request
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth_sql import _norm_role, check_project_access, current_user
from .delivery_activity_contract import (
    ActivityDetail,
    ActivityPage,
    RequirementChangePreviewInput,
    RequirementVersionDetail,
)
from .delivery_attention_contract import DeliveryInboxResponse, ProgressSummaryResponse
from .delivery_contract import (
    PAYLOADS,
    STAGES,
    Command,
    TaskPlanPreview,
    TaskReviewCurrentResponse,
    TaskReviewDetailResponse,
    TaskReviewsResponse,
)
from .delivery_deployment_contract import (
    DeploymentDetail,
    DeploymentIndex,
    DeploymentPreview,
    DeploymentPreviewInput,
)
from .delivery_execution_contract import (
    ExecutionObservationsResponse,
    ExecutionPreviewResponse,
    ExecutionQueue,
    ExecutionTargetsResponse,
)
from .delivery_execution_handoff_contract import ExecutionHandoffDetail, TaskHandoffPage
from .delivery_execution_control_operation_contract import ControlOperationDetail, ControlOperationPage, command_openapi_contracts
from .delivery_task_submission_contract import (
    SubmissionCurrent, SubmissionDetail, SubmissionLocator, SubmissionPage,
    command_openapi_contracts as submission_openapi_contracts,
)
from .delivery_execution_runtime_contract import (
    ExecutionControlPreviewInput,
    ExecutionControlPreviewResponse,
    ExecutionNodeOutputResponse,
    ExecutionRuntimeResponse,
)
from .delivery_issue_contract import DiagnosisHistory, DiagnosisView, IssueDetail, IssueDiagnosisGenerate
from .delivery_issue_origin_contract import IssueOriginDetail, IssueOrigins
from .delivery_progress_contract import (
    ComparisonKind,
    ProgressBaselineMetadataResponse,
    ProgressBaselinesResponse,
    ProgressComparisonDetailResponse,
    ProgressComparisonPageResponse,
    ProgressComparisonSummaryResponse,
    ProgressFreezeProofResponse,
    ProgressObservationMetadataResponse,
    ProgressSeriesResponse,
    ProgressSnapshotRequirementDetail,
    ProgressSnapshotRequirementPage,
    ProgressSnapshotTaskDetail,
    ProgressSnapshotTaskPage,
)
from .delivery_query_contract import (
    CommandAck,
    DeliveryContext,
    DeliveryStatus,
    ExecutionDetail,
    QueryPage,
    QueryRebuilt,
    QuerySort,
    ReferenceKind,
    RequirementPage,
    TaskDetail,
)
from .delivery_release_contract import (
    DeliveryQualityResponse,
    DeliveryReleaseDetail,
    DeliveryReleasesResponse,
    QualityCatalogueResponse,
    ReleaseEvidenceDetail,
    ReleasePageResponse,
    ReleasePreviewInput,
    ReleasePreviewResponse,
)
from .delivery_requirement_contract import (
    RecordCollection,
    RequirementChangePreview,
    RequirementDefinitionResponse,
    RequirementHeadResponse,
    RequirementHistoryPage,
    RequirementImpactDetail,
    RequirementImpactKind,
    RequirementImpactPage,
    RequirementImpactSummary,
    RequirementRecordDetail,
    RequirementRecordsPage,
)
from .delivery_scheduling_contract import (
    CivilDate,
    ScheduleChanges,
    SchedulePreviewResponse,
    ScheduleResponse,
)
from .delivery_service import (
    apply_action,
    identifier,
    initial_state,
    reconcile,
    records,
    remember_basis,
)
from .delivery_team_runtime_contract import TeamRuntimeBindingsResponse
from .project_lifecycle_contract import ProjectLifecyclePreviewInput
from .project_portfolio_contract import ProjectLifecyclePreviewResponse
from .sql_models import (
    DeliveryEvent,
    DeliveryReceipt,
    DeliveryWorkspace,
    Project,
    ProjectMember,
    User,
    get_session,
)

router = APIRouter(prefix="/api/v1/delivery", tags=["delivery"])


def _project(db, user, pid):
    if not pid:
        raise HTTPException(400, "Select a project using X-Project-Id")
    project = db.get(Project, pid)
    if not project:
        raise HTTPException(404, "Project not found")
    check_project_access(user, pid, db)
    return project


def _progress_project(db, user, pid):
    active = db.get(User, user.id, populate_existing=True)
    if active is None or active.status != "active":
        raise HTTPException(401, "Active identity required")
    return _project(db, active, pid)


def _role_permissions(db, user, project):
    member = db.get(ProjectMember, (project.id, user.id))
    role = _norm_role(member.role if member else user.role)
    user_role = _norm_role(user.role)
    admin = user_role == "super_admin" or user.tenant_id == project.tenant_id and user_role == "tenant_admin"
    return {
        "write": admin or role in {"project_admin", "developer", "devops", "product_manager"},
        "approve": admin or role in {"project_admin", "devops", "product_manager"},
        "configure": admin or role == "project_admin",
        "lifecycle": admin or role == "project_admin",
    }


def _permissions(db, user, project):
    permissions = _role_permissions(db, user, project)
    if project.status == "archived":
        permissions.update(write=False, approve=False, configure=False)
    return permissions


def _snapshot(db, project, user):
    from .delivery_activity import legacy_activity
    from .delivery_progress_facts import evaluate_project

    row = db.get(DeliveryWorkspace, project.id)
    evaluation = evaluate_project(db, project, row.data if row else initial_state())
    state, result = evaluation.state, evaluation.snapshot
    events = records(db, DeliveryEvent, project).order_by(DeliveryEvent.version.desc()).limit(200).all()
    result.update(
        version=row.version if row else 0,
        stages=STAGES,
        permissions=_permissions(db, user, project),
        activity=[legacy_activity(e) for e in events[:50]],
        history=[
            {"at": e.created_at.isoformat() + "Z", **e.data["snapshot"]}
            for e in reversed(events)
            if "snapshot" in e.data
        ],
    )
    from .delivery_scheduling import planning_basis

    result["planning_basis"] = planning_basis(db, project, state, verification=evaluation.verification)
    return result


@router.get("/schedule", response_model=ScheduleResponse)
def delivery_schedule(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    starts_on: CivilDate | None = None,
    ends_on: CivilDate | None = None,
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_scheduling import get_schedule

    project = _project(db, user, project_id)
    return get_schedule(db, project, _permissions(db, user, project), starts_on, ends_on)


@router.post("/schedule-preview", response_model=SchedulePreviewResponse)
def delivery_schedule_preview(
    body: ScheduleChanges,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_scheduling import preview

    project = _project(db, user, project_id)
    if not _role_permissions(db, user, project)["write"]:
        raise HTTPException(403, "Project write permission required")
    _require_writable_state(project)
    return preview(db, project, body)


@router.get("/workspace")
def workspace(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    return _snapshot(db, _project(db, user, project_id), user)


@router.get("/context", response_model=DeliveryContext)
def delivery_context(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_query_read import context

    project = _project(db, user, project_id)
    permissions = {
        **_permissions(db, user, project),
        "query_rebuild": _role_permissions(db, user, project)["configure"],
    }
    return context(db, project, permissions)


@router.post("/query/rebuild", response_model=QueryRebuilt)
def delivery_query_rebuild(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_query_index import rebuild

    project = _project(db, user, project_id)
    if not _role_permissions(db, user, project)["configure"]:
        raise HTTPException(403, "Project configure permission required")
    return rebuild(db, project, user)


@router.get("/requirements", response_model=RequirementPage)
def delivery_requirement_page(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    q: str = Query("", max_length=200),
    stage: str = Query("", max_length=32),
    priority: str = Query("", max_length=8),
    owner_id: str = Query("", max_length=100),
    milestone_id: str = Query("", max_length=64),
    sort: QuerySort = "created_desc",
    cursor: str = Query("", max_length=4000),
    limit: int = Query(20, ge=1, le=100),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_query_read import entity_page

    if stage and stage not in {item["id"] for item in STAGES}:
        raise HTTPException(422, "Unknown delivery stage")
    filters = {
        "q": q,
        "stage": stage,
        "priority": priority,
        "owner_id": owner_id,
        "milestone_id": milestone_id,
        "sort": sort,
    }
    return entity_page(
        db, _project(db, user, project_id), user, "requirement", filters, limit=limit, cursor=cursor
    )


@router.get("/tasks", response_model=QueryPage)
def delivery_task_page(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    requirement_id: str = Query("", max_length=64),
    q: str = Query("", max_length=200),
    status: DeliveryStatus | Literal[""] = "",
    priority: str = Query("", max_length=8),
    owner_id: str = Query("", max_length=100),
    milestone_id: str = Query("", max_length=64),
    sprint_id: str = Query("", max_length=100),
    sort: QuerySort = "created_desc",
    cursor: str = Query("", max_length=4000),
    limit: int = Query(20, ge=1, le=100),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_query_read import entity_page

    if sort == "due_asc":
        raise HTTPException(422, "Task queries do not support due date sorting")
    filters = {
        "requirement_id": requirement_id,
        "q": q,
        "status": status,
        "priority": priority,
        "owner_id": owner_id,
        "milestone_id": milestone_id,
        "sprint_id": sprint_id,
        "sort": sort,
    }
    return entity_page(db, _project(db, user, project_id), user, "task", filters, limit=limit, cursor=cursor)


@router.get("/issues", response_model=QueryPage)
def delivery_issue_page(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    requirement_id: str = Query("", max_length=64),
    task_id: str = Query("", max_length=64),
    q: str = Query("", max_length=200),
    status: str = Query("", max_length=32),
    severity: str = Query("", max_length=8),
    source: Literal["", "execution", "deployment", "event", "external", "other"] = "",
    cursor: str = Query("", max_length=4000),
    limit: int = Query(20, ge=1, le=100),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_query_read import entity_page

    filters = {
        "requirement_id": requirement_id,
        "task_id": task_id,
        "q": q,
        "status": status,
        "severity": severity,
        "source": source,
        "sort": "created_desc",
    }
    return entity_page(db, _project(db, user, project_id), user, "issue", filters, limit=limit, cursor=cursor)


@router.get("/references", response_model=QueryPage)
def delivery_reference_page(
    kind: ReferenceKind,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    q: str = Query("", max_length=200),
    ids: str = Query("", max_length=10100),
    requirement_id: str = Query("", max_length=64),
    task_id: str = Query("", max_length=64),
    cursor: str = Query("", max_length=4000),
    member_kind: Literal["", "human", "agent", "tool"] = "",
    member_active: bool | None = None,
    resource_kind: Literal["", "repository", "document", "design", "other"] = "",
    archived: bool | None = None,
    sort: Literal["id_asc", "ends_asc", "created_desc"] = "id_asc",
    limit: int = Query(50, ge=1, le=100),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_query_read import reference_page

    if sort == "ends_asc" and kind != "milestone":
        raise HTTPException(422, "End date sorting applies to milestone references")
    if sort == "created_desc" and kind != "execution":
        raise HTTPException(422, "Creation date sorting applies to execution references")
    filters = {
        "kind": kind,
        "q": q,
        "ids": ids,
        "requirement_id": requirement_id,
        "task_id": task_id,
        "member_kind": member_kind,
        "member_active": member_active,
        "resource_kind": resource_kind,
        "archived": archived,
        "sort": sort,
    }
    return reference_page(
        db,
        _project(db, user, project_id),
        user,
        filters,
        limit=limit,
        cursor=cursor,
        store=getattr(request.app.state, "hermes_store", None),
    )


@router.get("/requirements/{requirement_id}", response_model=RequirementHeadResponse)
def delivery_requirement_detail(
    requirement_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    query_generation: int | None = Query(default=None, ge=1),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_requirement_read import head

    return head(db, _project(db, user, project_id), requirement_id, query_generation)


@router.get("/requirements/{requirement_id}/definition", response_model=RequirementDefinitionResponse)
def delivery_requirement_definition(
    requirement_id: str,
    query_generation: Annotated[int, Query(ge=1)],
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_requirement_read import definition

    return definition(db, _project(db, user, project_id), requirement_id, query_generation)


@router.get("/requirements/{requirement_id}/records", response_model=RequirementRecordsPage)
def delivery_requirement_records(
    requirement_id: str,
    collection: RecordCollection,
    query_generation: Annotated[int, Query(ge=1)],
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str = Query(default="", max_length=4000),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_requirement_read import records_page

    return records_page(
        db,
        _project(db, user, project_id),
        requirement_id,
        collection,
        query_generation,
        user=user,
        limit=limit,
        cursor=cursor,
    )


@router.get("/requirements/{requirement_id}/records/{position}", response_model=RequirementRecordDetail)
def delivery_requirement_record(
    requirement_id: str,
    position: Annotated[int, Path(ge=0)],
    collection: RecordCollection,
    query_generation: Annotated[int, Query(ge=1)],
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_requirement_read import record_detail

    return record_detail(
        db, _project(db, user, project_id), requirement_id, collection, position, query_generation
    )


@router.get("/requirements/{requirement_id}/impact", response_model=RequirementImpactSummary)
def delivery_requirement_impact(
    requirement_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    query_generation: int | None = Query(default=None, ge=1),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_requirement_impact import impact_summary

    return impact_summary(
        db,
        _project(db, user, project_id),
        requirement_id,
        query_generation,
        user=user,
        store=getattr(request.app.state, "hermes_store", None),
    )


@router.get("/requirements/{requirement_id}/impact/items", response_model=RequirementImpactPage)
def delivery_requirement_impact_items(
    requirement_id: str,
    kind: RequirementImpactKind,
    query_generation: Annotated[int, Query(ge=1)],
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str = Query(default="", max_length=4000),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_requirement_impact import impact_page

    return impact_page(
        db,
        _project(db, user, project_id),
        requirement_id,
        kind,
        query_generation,
        user=user,
        store=getattr(request.app.state, "hermes_store", None),
        limit=limit,
        cursor=cursor,
    )


@router.get("/requirements/{requirement_id}/impact/items/{item_id}", response_model=RequirementImpactDetail)
def delivery_requirement_impact_item(
    requirement_id: str,
    item_id: str,
    kind: RequirementImpactKind,
    query_generation: Annotated[int, Query(ge=1)],
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_requirement_impact import impact_detail

    return impact_detail(
        db,
        _project(db, user, project_id),
        requirement_id,
        kind,
        item_id,
        query_generation,
        user=user,
        store=getattr(request.app.state, "hermes_store", None),
    )


@router.get("/tasks/{task_id}", response_model=TaskDetail)
def delivery_task_detail(
    task_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_query_read import task_detail

    return task_detail(db, _project(db, user, project_id), task_id)


@router.get("/executions/{execution_id}", response_model=ExecutionDetail)
def delivery_execution_detail(
    execution_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_query_read import execution_detail

    return execution_detail(
        db,
        _project(db, user, project_id),
        user,
        execution_id,
        getattr(request.app.state, "hermes_store", None),
    )


@router.get("/activity", response_model=ActivityPage)
def delivery_activity(
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    scope: Literal["project", "requirement"] = "project",
    scope_id: str = Query(default="", max_length=64),
    action: str = Query(default="", max_length=64),
    cursor: str = Query(default="", max_length=4000),
    limit: int = Query(default=20, ge=1, le=100),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_activity import list_activity

    project = _project(db, user, project_id)
    workspace = db.get(DeliveryWorkspace, project.id)
    return list_activity(
        db,
        project,
        workspace.data if workspace else initial_state(),
        user,
        scope=scope,
        scope_id=scope_id,
        action=action,
        cursor=cursor,
        limit=limit,
        store=getattr(request.app.state, "hermes_store", None),
    )


@router.get("/activity/{event_id}", response_model=ActivityDetail)
def delivery_activity_detail(
    event_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_activity import activity_detail

    project = _project(db, user, project_id)
    workspace = db.get(DeliveryWorkspace, project.id)
    return activity_detail(
        db,
        project,
        workspace.data if workspace else initial_state(),
        user,
        event_id,
        store=getattr(request.app.state, "hermes_store", None),
    )


@router.get("/requirements/{requirement_id}/history", response_model=RequirementHistoryPage)
def delivery_requirement_history(
    requirement_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    cursor: str = Query(default="", max_length=4000),
    limit: int = Query(default=20, ge=1, le=100),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_requirement_history import requirement_history

    return requirement_history(
        db, _project(db, user, project_id), requirement_id, cursor=cursor, limit=limit, user=user
    )


@router.get("/requirements/{requirement_id}/history/{version_id}", response_model=RequirementVersionDetail)
def delivery_requirement_version(
    requirement_id: str,
    version_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_requirement_history import requirement_version_detail

    return requirement_version_detail(db, _project(db, user, project_id), requirement_id, version_id)


@router.post("/requirements/{requirement_id}/change-preview", response_model=RequirementChangePreview)
def delivery_requirement_change_preview(
    requirement_id: str,
    body: RequirementChangePreviewInput,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_requirement_proof import preview

    project = _project(db, user, project_id)
    if not _role_permissions(db, user, project)["write"]:
        raise HTTPException(403, "Project write permission required")
    _require_writable_state(project)
    return preview(
        db,
        project,
        requirement_id,
        body.requirement_basis,
        body.changes.model_dump(exclude_unset=True),
        user=user,
        store=getattr(request.app.state, "hermes_store", None),
    )


@router.get("/issues/{issue_id}", response_model=IssueDetail)
def delivery_issue_detail(
    issue_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_issue_diagnosis import issue_detail

    project = _project(db, user, project_id)
    row = db.get(DeliveryWorkspace, project.id)
    return issue_detail(
        db,
        project,
        row.data if row else initial_state(),
        user,
        issue_id,
        version=row.version if row else 0,
        store=getattr(request.app.state, "hermes_store", None),
        execution=getattr(request.app.state, "hermes_execution", None),
    )


@router.get("/issues/{issue_id}/origins", response_model=IssueOrigins)
def delivery_issue_origins(
    issue_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str = Query(default="", max_length=4000),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_issue_origins import issue_origins

    return issue_origins(db, _project(db, user, project_id), user, issue_id, limit=limit, cursor=cursor)


@router.get("/issues/{issue_id}/origins/{origin_id}", response_model=IssueOriginDetail)
def delivery_issue_origin(
    issue_id: str,
    origin_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_issue_origins import issue_origin_detail

    return issue_origin_detail(db, _project(db, user, project_id), user, issue_id, origin_id)


@router.get("/issues/{issue_id}/diagnoses", response_model=DiagnosisHistory)
def delivery_issue_diagnoses(
    issue_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    cursor: str = Query(default="", max_length=2000),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_issue_diagnosis import diagnosis_history

    project = _project(db, user, project_id)
    row = db.get(DeliveryWorkspace, project.id)
    return diagnosis_history(
        db,
        project,
        row.data if row else initial_state(),
        user,
        issue_id,
        cursor=cursor,
        store=getattr(request.app.state, "hermes_store", None),
        execution=getattr(request.app.state, "hermes_execution", None),
    )


@router.post("/issues/{issue_id}/diagnoses", response_model=DiagnosisView)
def delivery_issue_diagnose(
    issue_id: str,
    body: IssueDiagnosisGenerate,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_issue_diagnosis import generate_diagnosis

    project = _project(db, user, project_id)
    return generate_diagnosis(
        db,
        project,
        user,
        issue_id,
        body,
        request,
        store=getattr(request.app.state, "hermes_store", None),
        execution=getattr(request.app.state, "hermes_execution", None),
    )


@router.get("/issues/{issue_id}/diagnoses/{diagnosis_id}", response_model=DiagnosisView)
def delivery_issue_diagnosis_detail(
    issue_id: str,
    diagnosis_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_issue_diagnosis import diagnosis_detail

    return diagnosis_detail(
        db,
        _project(db, user, project_id),
        user,
        issue_id,
        diagnosis_id,
        store=getattr(request.app.state, "hermes_store", None),
        execution=getattr(request.app.state, "hermes_execution", None),
    )


@router.get("/quality", response_model=DeliveryQualityResponse)
def delivery_quality(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    requirement_ids: Annotated[list[str] | None, Query(max_length=200)] = None,
    task_ids: Annotated[list[str] | None, Query(max_length=200)] = None,
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_release_query import quality_scope

    return quality_scope(
        db, _project(db, user, project_id), requirement_ids=requirement_ids, task_ids=task_ids
    )


@router.get("/quality/catalogue", response_model=QualityCatalogueResponse)
def delivery_quality_catalogue(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    kind: Annotated[Literal["all", "requirement", "task"], Query()] = "all",
    readiness: Annotated[Literal["all", "ready", "attention"], Query()] = "all",
    q: Annotated[str, Query(max_length=200)] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str, Query(max_length=4000)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_release_query import quality_catalogue

    return quality_catalogue(
        db,
        _project(db, user, project_id),
        user,
        {"kind": kind, "readiness": readiness, "q": q},
        limit=limit,
        cursor=cursor,
    )


@router.get("/release-pages", response_model=ReleasePageResponse)
def delivery_release_page(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    kind: Annotated[Literal["candidate", "evidence", "legacy"], Query()] = "candidate",
    q: Annotated[str, Query(max_length=200)] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str, Query(max_length=4000)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_release_query import release_page

    return release_page(db, _project(db, user, project_id), user, kind, limit=limit, cursor=cursor, q=q)


@router.get("/release-evidence/{evidence_id}", response_model=ReleaseEvidenceDetail)
def delivery_release_evidence(
    evidence_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_release_query import evidence_detail

    return evidence_detail(db, _project(db, user, project_id), user, evidence_id)


@router.get("/releases", response_model=DeliveryReleasesResponse)
def delivery_releases(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_release_query import release_context

    return release_context(db, _project(db, user, project_id), user)


@router.get("/releases/{release_id}", response_model=DeliveryReleaseDetail)
def delivery_release_detail(
    release_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_release_query import candidate_detail

    return candidate_detail(db, _project(db, user, project_id), user, release_id)


@router.post("/release-preview", response_model=ReleasePreviewResponse)
def delivery_release_preview(
    body: ReleasePreviewInput,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_release import preview

    project = _project(db, user, project_id)
    if not _role_permissions(db, user, project)["write"]:
        raise HTTPException(403, "Project write permission required")
    _require_writable_state(project)
    row = db.get(DeliveryWorkspace, project.id)
    data = reconcile(db, project, row.data) if row else initial_state()
    return preview(db, project, data, user, body, version=row.version if row else 0)


@router.get("/inbox", response_model=DeliveryInboxResponse)
def delivery_inbox(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    scope: Annotated[Literal["mine", "team"], Query()] = "mine",
    category: Annotated[
        Literal["all", "work", "approval", "acceptance", "blocked", "overdue"], Query()
    ] = "all",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str, Query(max_length=4000)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_inbox_query import inbox_page

    project = _project(db, user, project_id)
    return inbox_page(
        db,
        project,
        user,
        can_approve=_permissions(db, user, project)["approve"],
        scope_kind=scope,
        category=category,
        limit=limit,
        cursor=cursor,
    )


@router.get("/progress/summary", response_model=ProgressSummaryResponse)
def delivery_progress_summary(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    starts_on: date | None = None,
    ends_on: date | None = None,
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_summary import progress_summary

    return progress_summary(db, _project(db, user, project_id), starts_on=starts_on, ends_on=ends_on)


@router.get("/progress", response_model=ProgressSeriesResponse)
def delivery_progress(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    starts_on: date | None = None,
    ends_on: date | None = None,
    scope: Annotated[Literal["project", "milestone", "sprint"], Query()] = "project",
    scope_id: Annotated[str, Query(max_length=100)] = "",
    baseline_id: Annotated[str, Query(max_length=64)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_query import progress

    return progress(
        db,
        _progress_project(db, user, project_id),
        starts_on=starts_on,
        ends_on=ends_on,
        scope=scope,
        scope_id=scope_id,
        baseline_id=baseline_id,
    )


@router.get("/progress/observations/{observation_id}", response_model=ProgressObservationMetadataResponse)
def delivery_progress_observation(
    observation_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    scope: Annotated[Literal["project", "milestone", "sprint"], Query()] = "project",
    scope_id: Annotated[str, Query(max_length=100)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_query import observation_detail

    return observation_detail(
        db, _progress_project(db, user, project_id), observation_id, scope=scope, scope_id=scope_id
    )


@router.get("/progress/baselines", response_model=ProgressBaselinesResponse)
def delivery_progress_baselines(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    scope: Literal["project", "milestone", "sprint"] = "project",
    scope_id: str = Query("", max_length=100),
    limit: int = Query(20, ge=1, le=100),
    cursor: str = Query("", max_length=4000),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_query import baselines

    return baselines(
        db,
        _progress_project(db, user, project_id),
        user,
        scope=scope,
        scope_id=scope_id,
        limit=limit,
        cursor=cursor,
    )


@router.get("/progress/freeze-proof", response_model=ProgressFreezeProofResponse)
def delivery_progress_freeze_proof(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    scope: Literal["project", "milestone", "sprint"] = "project",
    scope_id: str = Query("", max_length=100),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_current import freeze_proof

    return freeze_proof(db, _progress_project(db, user, project_id), scope=scope, scope_id=scope_id)


@router.get("/progress/baselines/{baseline_id}", response_model=ProgressBaselineMetadataResponse)
def delivery_progress_baseline(
    baseline_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_query import baseline_detail

    return baseline_detail(db, _progress_project(db, user, project_id), baseline_id)


@router.get("/progress/observations/{observation_id}/tasks", response_model=ProgressSnapshotTaskPage)
def delivery_progress_observation_tasks(
    observation_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    scope: Literal["project", "milestone", "sprint"] = "project",
    scope_id: str = Query("", max_length=100),
    limit: int = Query(20, ge=1, le=100),
    cursor: str = Query("", max_length=4000),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_json import snapshot_page

    return snapshot_page(
        db,
        _progress_project(db, user, project_id),
        user,
        "observation",
        observation_id,
        "tasks",
        limit=limit,
        cursor=cursor,
        scope=scope,
        scope_id=scope_id,
    )


@router.get(
    "/progress/observations/{observation_id}/tasks/{task_id}", response_model=ProgressSnapshotTaskDetail
)
def delivery_progress_observation_task(
    observation_id: str,
    task_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    scope: Literal["project", "milestone", "sprint"] = "project",
    scope_id: str = Query("", max_length=100),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_json import snapshot_detail

    return snapshot_detail(
        db,
        _progress_project(db, user, project_id),
        "observation",
        observation_id,
        "tasks",
        task_id,
        scope=scope,
        scope_id=scope_id,
    )


@router.get(
    "/progress/observations/{observation_id}/requirements", response_model=ProgressSnapshotRequirementPage
)
def delivery_progress_observation_requirements(
    observation_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    scope: Literal["project", "milestone", "sprint"] = "project",
    scope_id: str = Query("", max_length=100),
    limit: int = Query(20, ge=1, le=100),
    cursor: str = Query("", max_length=4000),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_json import snapshot_page

    return snapshot_page(
        db,
        _progress_project(db, user, project_id),
        user,
        "observation",
        observation_id,
        "requirements",
        limit=limit,
        cursor=cursor,
        scope=scope,
        scope_id=scope_id,
    )


@router.get(
    "/progress/observations/{observation_id}/requirements/{requirement_id}",
    response_model=ProgressSnapshotRequirementDetail,
)
def delivery_progress_observation_requirement(
    observation_id: str,
    requirement_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    scope: Literal["project", "milestone", "sprint"] = "project",
    scope_id: str = Query("", max_length=100),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_json import snapshot_detail

    return snapshot_detail(
        db,
        _progress_project(db, user, project_id),
        "observation",
        observation_id,
        "requirements",
        requirement_id,
        scope=scope,
        scope_id=scope_id,
    )


@router.get("/progress/baselines/{baseline_id}/tasks", response_model=ProgressSnapshotTaskPage)
def delivery_progress_baseline_tasks(
    baseline_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: int = Query(20, ge=1, le=100),
    cursor: str = Query("", max_length=4000),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_json import snapshot_page

    return snapshot_page(
        db,
        _progress_project(db, user, project_id),
        user,
        "baseline",
        baseline_id,
        "tasks",
        limit=limit,
        cursor=cursor,
    )


@router.get("/progress/baselines/{baseline_id}/tasks/{task_id}", response_model=ProgressSnapshotTaskDetail)
def delivery_progress_baseline_task(
    baseline_id: str,
    task_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_json import snapshot_detail

    return snapshot_detail(
        db, _progress_project(db, user, project_id), "baseline", baseline_id, "tasks", task_id
    )


@router.get("/progress/baselines/{baseline_id}/requirements", response_model=ProgressSnapshotRequirementPage)
def delivery_progress_baseline_requirements(
    baseline_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: int = Query(20, ge=1, le=100),
    cursor: str = Query("", max_length=4000),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_json import snapshot_page

    return snapshot_page(
        db,
        _progress_project(db, user, project_id),
        user,
        "baseline",
        baseline_id,
        "requirements",
        limit=limit,
        cursor=cursor,
    )


@router.get(
    "/progress/baselines/{baseline_id}/requirements/{requirement_id}",
    response_model=ProgressSnapshotRequirementDetail,
)
def delivery_progress_baseline_requirement(
    baseline_id: str,
    requirement_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_json import snapshot_detail

    return snapshot_detail(
        db, _progress_project(db, user, project_id), "baseline", baseline_id, "requirements", requirement_id
    )


@router.get("/progress/baselines/{baseline_id}/comparison", response_model=ProgressComparisonSummaryResponse)
def delivery_progress_comparison(
    baseline_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    query_generation: int | None = Query(None, ge=1),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_comparison import comparison_summary

    return comparison_summary(
        db, _progress_project(db, user, project_id), baseline_id, query_generation=query_generation
    )


@router.get(
    "/progress/baselines/{baseline_id}/comparison/items", response_model=ProgressComparisonPageResponse
)
def delivery_progress_comparison_items(
    baseline_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    kind: ComparisonKind = "changed",
    limit: int = Query(20, ge=1, le=100),
    cursor: str = Query("", max_length=4000),
    query_generation: int | None = Query(None, ge=1),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_comparison import comparison_page

    return comparison_page(
        db,
        _progress_project(db, user, project_id),
        user,
        baseline_id,
        kind=kind,
        limit=limit,
        cursor=cursor,
        query_generation=query_generation,
    )


@router.get(
    "/progress/baselines/{baseline_id}/comparison/items/{task_id}",
    response_model=ProgressComparisonDetailResponse,
)
def delivery_progress_comparison_item(
    baseline_id: str,
    task_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    kind: ComparisonKind = "changed",
    query_generation: int | None = Query(None, ge=1),
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_comparison import comparison_detail

    return comparison_detail(
        db,
        _progress_project(db, user, project_id),
        baseline_id,
        task_id,
        kind=kind,
        query_generation=query_generation,
    )


@router.get("/team-runtime-bindings", response_model=TeamRuntimeBindingsResponse)
def team_runtime_bindings(
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_team_runtime import runtime_bindings_view

    project = _project(db, user, project_id)
    row = db.get(DeliveryWorkspace, project.id)
    data = row.data if row else initial_state()
    return runtime_bindings_view(
        db,
        project,
        data,
        user,
        getattr(request.app.state, "hermes_store", None),
        can_configure=_permissions(db, user, project)["configure"],
        version=row.version if row else 0,
    )


@router.get("/execution-targets", response_model=ExecutionTargetsResponse)
def execution_targets(
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_execution import catalog

    project = _project(db, user, project_id)
    return catalog(
        getattr(request.app.state, "hermes_store", None),
        user,
        getattr(request.app.state, "hermes_execution", None),
        project_id=project.id,
        project_write=_permissions(db, user, project)["write"] and project.status == "active",
        project_configure=_permissions(db, user, project)["configure"],
    )


@router.post("/execution-preview", response_model=ExecutionPreviewResponse, response_model_exclude_unset=True)
def execution_preview(
    body: ExecutionQueue,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from hermes_core.models import CoreError

    from .delivery_execution import prepare_plan

    project = _project(db, user, project_id)
    if not _role_permissions(db, user, project)["write"]:
        raise HTTPException(403, "Project write permission required")
    _require_writable_state(project)
    row = db.get(DeliveryWorkspace, project.id)
    state = reconcile(db, project, row.data) if row else initial_state()
    try:
        plan = prepare_plan(
            db,
            project,
            user,
            state,
            body,
            getattr(request.app.state, "hermes_store", None),
            getattr(request.app.state, "hermes_execution", None),
        )
        return {"project_id": project.id, "version": row.version if row else 0,
            **{key: value for key, value in plan.items() if key not in {"design_context", "feedback_runtime_scopes"}}}
    except CoreError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from exc


@router.get("/executions/{execution_id}/observations", response_model=ExecutionObservationsResponse)
def execution_observations(
    execution_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    cursor: Annotated[str, Query(max_length=1000)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from hermes_core.models import CoreError

    from .delivery_execution_observations import observations

    project = _project(db, user, project_id)
    row = db.get(DeliveryWorkspace, project.id)
    state = reconcile(db, project, row.data) if row else initial_state()
    entry = next((item for item in state.get("executions", []) if item["id"] == execution_id), None)
    if not entry:
        raise HTTPException(404, "Execution not found in project")
    try:
        return observations(
            db,
            project,
            user,
            state,
            entry,
            getattr(request.app.state, "hermes_store", None),
            getattr(request.app.state, "hermes_execution", None),
            _permissions(db, user, project),
            limit=limit,
            cursor=cursor,
        )
    except CoreError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from exc


@router.get("/executions/{execution_id}/handoff", response_model=ExecutionHandoffDetail)
def execution_handoff(
    execution_id: Annotated[str, Path(min_length=1, max_length=64)],
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_execution_handoff_query import handoff_detail

    project = _progress_project(db, user, project_id)
    return handoff_detail(db, project, user, execution_id, getattr(request.app.state, "hermes_store", None))


@router.get("/tasks/{task_id}/execution-handoffs", response_model=TaskHandoffPage)
def task_execution_handoffs(
    task_id: Annotated[str, Path(min_length=1, max_length=64)],
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str, Query(max_length=4000)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_execution_handoff_query import task_handoffs

    project = _progress_project(db, user, project_id)
    return task_handoffs(db, project, user, task_id, getattr(request.app.state, "hermes_store", None), limit=limit, cursor=cursor)


@router.get("/executions/{execution_id}/control-operations", response_model=ControlOperationPage)
def execution_control_operations(
    execution_id: Annotated[str, Path(min_length=1, max_length=64)],
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str, Query(max_length=4000)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_execution_control_operation_query import control_operations

    project = _progress_project(db, user, project_id)
    return control_operations(db, project, user, execution_id, getattr(request.app.state, "hermes_store", None),
        limit=limit, cursor=cursor)


@router.get("/executions/{execution_id}/control-operations/{operation_id}", response_model=ControlOperationDetail)
def execution_control_operation(
    execution_id: Annotated[str, Path(min_length=1, max_length=64)],
    operation_id: Annotated[str, Path(min_length=1, max_length=64)],
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_execution_control_operation_query import control_operation_detail

    project = _progress_project(db, user, project_id)
    return control_operation_detail(db, project, user, execution_id, operation_id,
        getattr(request.app.state, "hermes_store", None))


@router.get("/tasks/{task_id}/delivery-submissions/current", response_model=SubmissionCurrent)
def task_submission_current(
    task_id: Annotated[str, Path(min_length=1, max_length=64)], request: Request,
    user: Annotated[User, Depends(current_user)], db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_task_submission_query import submission_current

    project = _progress_project(db, user, project_id)
    return submission_current(db, project, user, task_id,
        store=getattr(request.app.state, "hermes_store", None),
        execution=getattr(request.app.state, "hermes_execution", None))


@router.get("/tasks/{task_id}/delivery-submissions", response_model=SubmissionPage)
def task_submissions(
    task_id: Annotated[str, Path(min_length=1, max_length=64)], request: Request,
    user: Annotated[User, Depends(current_user)], db: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str, Query(max_length=4000)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_task_submission_query import submission_list

    project = _progress_project(db, user, project_id)
    return submission_list(db, project, user, task_id, limit=limit, cursor=cursor,
        store=getattr(request.app.state, "hermes_store", None),
        execution=getattr(request.app.state, "hermes_execution", None))


@router.get("/tasks/{task_id}/delivery-submissions/{submission_id}", response_model=SubmissionDetail)
def task_submission(
    task_id: Annotated[str, Path(min_length=1, max_length=64)],
    submission_id: Annotated[str, Path(min_length=1, max_length=64)], request: Request,
    user: Annotated[User, Depends(current_user)], db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_task_submission_query import submission_detail

    project = _progress_project(db, user, project_id)
    return submission_detail(db, project, user, task_id, submission_id,
        store=getattr(request.app.state, "hermes_store", None),
        execution=getattr(request.app.state, "hermes_execution", None))


@router.get("/delivery-submissions/{submission_id}/locator", response_model=SubmissionLocator)
def task_submission_locator(
    submission_id: Annotated[str, Path(min_length=1, max_length=64)], request: Request,
    user: Annotated[User, Depends(current_user)], db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_issue_evidence import assert_evidence_access
    from .delivery_task_submission_model import DeliveryTaskSubmission
    from .delivery_task_submission_service import submission_runtime_scopes

    project = _progress_project(db, user, project_id)
    task_id = db.scalar(select(DeliveryTaskSubmission.task_id).where(
        DeliveryTaskSubmission.tenant_id == project.tenant_id,
        DeliveryTaskSubmission.project_id == project.id, DeliveryTaskSubmission.id == submission_id))
    if task_id is None:
        raise HTTPException(404, "Submission not found in this project")
    current = db.get(User, user.id, populate_existing=True)
    assert_evidence_access(getattr(request.app.state, "hermes_store", None), current, project,
        submission_runtime_scopes(db, project, submission_id))
    return {"project_id": project.id, "task_id": task_id, "submission_id": submission_id}


def _runtime_entry(db, project, execution_id):
    row = db.get(DeliveryWorkspace, project.id)
    state = reconcile(db, project, row.data) if row else initial_state()
    entry = next((item for item in state.get("executions", []) if item["id"] == execution_id), None)
    if entry is None:
        raise HTTPException(404, "Execution not found in project")
    return row, state, entry


@router.get("/executions/{execution_id}/runtime", response_model=ExecutionRuntimeResponse)
def execution_runtime(
    execution_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_execution_runtime import runtime_detail

    project = _project(db, user, project_id)
    _row, state, entry = _runtime_entry(db, project, execution_id)
    return runtime_detail(
        db,
        project,
        user,
        state,
        entry,
        getattr(request.app.state, "hermes_store", None),
        getattr(request.app.state, "hermes_execution", None),
        _permissions(db, user, project),
    )


@router.get("/executions/{execution_id}/nodes/{node_id}/output", response_model=ExecutionNodeOutputResponse)
def execution_node_output(
    execution_id: str,
    node_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    attempt: Annotated[int, Query(ge=1)],
    stream: Literal["stdout", "stderr"] = "stdout",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str, Query(max_length=2000)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_execution_runtime import node_output

    project = _project(db, user, project_id)
    _row, state, entry = _runtime_entry(db, project, execution_id)
    return node_output(
        db,
        project,
        user,
        state,
        entry,
        getattr(request.app.state, "hermes_store", None),
        node_id=node_id,
        attempt=attempt,
        stream=stream,
        limit=limit,
        cursor=cursor,
    )


@router.post("/execution-control-preview", response_model=ExecutionControlPreviewResponse)
def execution_control_preview(
    body: ExecutionControlPreviewInput,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_execution_runtime import control_preview

    project = _project(db, user, project_id)
    row = db.get(DeliveryWorkspace, project.id)
    state = reconcile(db, project, row.data) if row else initial_state()
    return control_preview(
        db,
        project,
        user,
        state,
        body,
        getattr(request.app.state, "hermes_store", None),
        getattr(request.app.state, "hermes_execution", None),
        _permissions(db, user, project),
        version=row.version if row else 0,
    )


@router.get("/tasks/{task_id}/reviews", response_model=TaskReviewsResponse)
def task_reviews(
    task_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str, Query(max_length=4000)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_manual_review_query import list_reviews

    project = _project(db, user, project_id)
    return list_reviews(
        db,
        project,
        user,
        task_id,
        limit=limit,
        cursor=cursor,
        store=getattr(request.app.state, "hermes_store", None),
    )


@router.get("/tasks/{task_id}/review-current", response_model=TaskReviewCurrentResponse)
def task_review_current(
    task_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_manual_review_query import review_current

    project = _project(db, user, project_id)
    return review_current(db, project, task_id, can_approve=_permissions(db, user, project)["approve"],
        user=user, store=getattr(request.app.state, "hermes_store", None))


@router.get("/tasks/{task_id}/reviews/{review_id}", response_model=TaskReviewDetailResponse)
def task_review_detail(
    task_id: str,
    review_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_manual_review_query import review_detail

    project = _project(db, user, project_id)
    return review_detail(db, project, task_id, review_id,
        user=user, store=getattr(request.app.state, "hermes_store", None))


@router.post("/task-plan-preview")
def task_plan_preview(
    body: TaskPlanPreview,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_plan import create_preview

    project = _project(db, user, project_id)
    if not _role_permissions(db, user, project)["write"]:
        raise HTTPException(403, "Project write permission required")
    _require_writable_state(project)
    return create_preview(db, project, user, body, request)


@router.get("/deployments", response_model=DeploymentIndex)
def deployments(
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_deployment import deployment_index

    project = _project(db, user, project_id)
    row = db.get(DeliveryWorkspace, project.id)
    return deployment_index(
        db,
        project,
        row.data if row else initial_state(),
        user,
        version=row.version if row else 0,
        store=getattr(request.app.state, "hermes_store", None),
        execution=getattr(request.app.state, "hermes_execution", None),
    )


@router.get("/deployments/{deployment_id}", response_model=DeploymentDetail)
def deployment_detail(
    deployment_id: str,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_deployment import deployment_detail as read_detail

    project = _project(db, user, project_id)
    row = db.get(DeliveryWorkspace, project.id)
    return read_detail(
        db,
        project,
        row.data if row else initial_state(),
        user,
        deployment_id,
        version=row.version if row else 0,
        store=getattr(request.app.state, "hermes_store", None),
        execution=getattr(request.app.state, "hermes_execution", None),
    )


@router.post("/deployment-preview", response_model=DeploymentPreview)
def deployment_preview(
    body: DeploymentPreviewInput,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_deployment import deployment_preview as prepare

    project = _project(db, user, project_id)
    if not _role_permissions(db, user, project)["approve"]:
        raise HTTPException(403, "Project approve permission required")
    _require_writable_state(project)
    row = db.get(DeliveryWorkspace, project.id)
    return prepare(
        db,
        project,
        row.data if row else initial_state(),
        user,
        body,
        version=row.version if row else 0,
        store=getattr(request.app.state, "hermes_store", None),
        execution=getattr(request.app.state, "hermes_execution", None),
    )


def _command_permission(action, payload):
    if action == "issue.diagnosis.adopt":
        return "approve"
    if action == "project.lifecycle":
        return "lifecycle"
    if action in {
        "member.runtime.bind",
        "member.runtime.unbind",
        "release.policy.save",
        "deployment.environment.save",
    }:
        return "configure"
    if action.startswith("deployment.") and action != "deployment.sync":
        return "approve"
    if action in {"member.save", "member.calendar.save", "resource.save", "resource.archive"} or (
        action == "project.update"
        and {
            "name",
            "description",
            "business_id",
            "project_path",
            "vector_db",
            "vector_db_config",
            "is_template",
        }
        & payload.keys()
    ):
        return "configure"
    if action in {
        "stage.advance",
        "stage.reopen",
        "release.candidate.review",
        "release.candidate.revoke",
        "execution.review",
        "execution.approval",
        "baseline.create",
        "task.manual_review",
        "task.delivery.review",
    }:
        return "approve"
    return "write"


def _require_writable_state(project):
    if project.status == "archived":
        raise HTTPException(
            409, {"code": "project_archived", "message": "Restore the project before editing."}
        )


@router.post("/project-lifecycle-preview", response_model=ProjectLifecyclePreviewResponse)
def project_lifecycle_preview(
    body: ProjectLifecyclePreviewInput,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .project_lifecycle import preview

    project = _project(db, user, project_id)
    if not _role_permissions(db, user, project)["lifecycle"]:
        raise HTTPException(403, "Project lifecycle permission required")
    row = db.get(DeliveryWorkspace, project.id)
    return preview(
        db, project, user, row.data if row else initial_state(), body, version=row.version if row else 0
    )


@router.post("/commands", response_model=CommandAck, openapi_extra={
    "x-delivery-command-contracts": {
        **command_openapi_contracts()["x-delivery-command-contracts"],
        **submission_openapi_contracts()["x-delivery-command-contracts"],
    },
})
def execute(
    body: Command,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
    request: Request = None,
    background_tasks: BackgroundTasks = None,
):
    project = _project(db, user, project_id)
    permissions = _role_permissions(db, user, project)
    needed = _command_permission(body.action, body.payload)
    if not permissions[needed]:
        raise HTTPException(403, f"Project {needed} permission required")
    try:
        payload = PAYLOADS[body.action].model_validate(body.payload)
    except ValidationError as exc:
        raise HTTPException(422, json.loads(exc.json(include_context=False))) from exc
    key = hashlib.sha256(
        json.dumps([project.tenant_id, project.id, user.id, body.idempotency_key]).encode()
    ).hexdigest()
    fingerprint = hashlib.sha256(body.model_dump_json(exclude_none=True).encode()).hexdigest()
    receipt = db.get(DeliveryReceipt, key)
    if receipt:
        from .delivery_query_commands import replay_ack

        if receipt.request_hash != fingerprint:
            raise HTTPException(409, "Idempotency key already used with different input")
        _schedule_committed_run(db, project, user, body, request, background_tasks, receipt.version)
        return replay_ack(
            db,
            project,
            receipt.version,
            user=user,
            store=getattr(request.app.state, "hermes_store", None) if request else None,
        )
    from ..project_write_guard import lifecycle_scope, require_project_operation

    scope = (
        lifecycle_scope(db, project.tenant_id, project.id)
        if body.action == "project.lifecycle"
        else nullcontext()
    )
    try:
        with scope:
            require_project_operation(db, project.tenant_id, project.id)
            # Membership and account state may have changed while waiting for
            # the Project lock. Cached authorization cannot authorize a write.
            actor_id = user.id
            db.expire_all()
            locked_actor = db.get(User, actor_id, populate_existing=True)
            if not locked_actor or locked_actor.status != "active":
                raise HTTPException(403, "An active account is required")
            check_project_access(locked_actor, project.id, db)
            if not _role_permissions(db, locked_actor, project)[needed]:
                raise HTTPException(403, f"Project {needed} permission required")
            user = locked_actor
            receipt = db.get(DeliveryReceipt, key, populate_existing=True)
            if receipt:
                from .delivery_query_commands import replay_ack

                if receipt.request_hash != fingerprint:
                    raise HTTPException(409, "Idempotency key already used with different input")
                _schedule_committed_run(db, project, user, body, request, background_tasks, receipt.version)
                return replay_ack(
                    db,
                    project,
                    receipt.version,
                    user=user,
                    store=getattr(request.app.state, "hermes_store", None) if request else None,
                )
            return _commit_command(
                db, project, user, body, payload, key, fingerprint, request, background_tasks
            )
    except Exception:
        db.rollback()
        raise


def _schedule_committed_run(db, project, user, body, request, background_tasks, applied_version):
    """Deployment callbacks only; execution controls use durable SQL delivery."""
    if body.action != "deployment.start" or request is None or background_tasks is None:
        return
    from hermes_core.models import CoreError

    from .delivery_deployment import _context
    from .delivery_deployment_runtime import _origin

    store = getattr(request.app.state, "hermes_store", None)
    execution = getattr(request.app.state, "hermes_execution", None)
    workspace = db.get(DeliveryWorkspace, project.id)
    if store is None or execution is None or workspace is None:
        return
    data = workspace.data
    entry = next((item for item in data.get("deployments", []) if item["id"] == body.payload["id"]), None)
    if entry is None or not entry["operations"]:
        return
    operation = entry["operations"][-1]
    if not operation.get("run_id"):
        return
    workspace_id = entry["snapshot"]["definition"]["workspace_id"]
    event = db.scalar(
        select(DeliveryEvent).where(
            DeliveryEvent.project_id == project.id,
            DeliveryEvent.tenant_id == project.tenant_id,
            DeliveryEvent.version == applied_version,
            DeliveryEvent.action == "deployment.start",
            DeliveryEvent.resource_id == entry["id"],
        )
    )
    committed = event.data.get("result", {}).get("start_run") if event else None
    if committed != {"workspace_id": workspace_id, "run_id": operation["run_id"]}:
        return
    try:
        # The replaying caller and the original operation actor each need their
        # own current authority. A saved receipt never grants fresh execution.
        _context(store, user, project, workspace_id, "execute")
        if not operation["observe"]:
            from .project_lifecycle import require_active

            require_active(project)
        principal = _origin(db, project, data, entry, operation, store)
        run = store.get(principal, workspace_id, "runs", operation["run_id"])
    except (HTTPException, CoreError):
        return
    source = run["data"].get("deployment_source", {})
    if (
        run["status"] != "queued"
        or run["data"].get("target_device_id")
        or source.get("plan_digest") != operation["plan_digest"]
        or source.get("requested_by") != operation["requested_by"]["id"]
    ):
        return
    background_tasks.add_task(execution.execute, principal, workspace_id, run["id"])


@contextmanager
def stage_delivery_command(db, project, user, body, payload, key, fingerprint, request):
    """Prepare one canonical command; caller owns commit and original result."""
    reservation = None
    requirement_proof_token = None
    try:
        from .delivery_discussion_adoption import prepare_adoption, record_adoption
        from .delivery_requirement_proof import install, prepare_sync, prepare_update

        if body.action == "requirement.update":
            complete = prepare_update(db, project, payload.id, payload)
            if complete is not None:
                requirement_proof_token = install(db, project, payload.id, complete)
        elif body.action == "sync.record.apply":
            complete = prepare_sync(db, project, payload)
            if complete is not None:
                requirement_proof_token = install(db, project, payload.record["id"], complete)
        from .design_adoption_service import prepare_command as prepare_design_adoption

        design_prepared = prepare_design_adoption(db, project, user, body.action, payload,
            store=getattr(request.app.state, "hermes_store", None) if request else None)
        progress_proof = None
        if body.action == "baseline.create":
            from .delivery_progress_current import freeze_proof

            progress_proof = freeze_proof(
                db, project, scope=payload.scope, scope_id=payload.scope_id, internal=True
            )
            if not progress_proof[0]["available"] or not progress_proof[0]["complete"]:
                raise HTTPException(
                    413,
                    {
                        "code": "progress_proof_unavailable",
                        "message": "The complete baseline approval exceeds its canonical proof budget",
                        "reasons": progress_proof[0]["reasons"],
                    },
                )
        source = prepare_adoption(db, project, user, body, request)
        row = db.get(DeliveryWorkspace, project.id)
        if not row:
            row = DeliveryWorkspace(
                project_id=project.id, tenant_id=project.tenant_id, version=0, data=initial_state()
            )
            db.add(row)
            db.flush()
        if row.version != body.expected_version:
            raise HTTPException(409, "Project changed. Reload and review your changes before saving.")
        next_version = row.version + 1
        # Acquire the SQL write lock before any idempotent cross-store effect.
        # A competing cancel/sync must fail its CAS before touching the runtime.
        reserved = db.execute(
            update(DeliveryWorkspace)
            .where(
                DeliveryWorkspace.project_id == project.id,
                DeliveryWorkspace.tenant_id == project.tenant_id,
                DeliveryWorkspace.version == body.expected_version,
            )
            .values(version=next_version),
            execution_options={"synchronize_session": False},
        )
        if reserved.rowcount != 1:
            raise HTTPException(409, "Concurrent edit. Reload the project.")
        from .delivery_progress_capture import reserve_workspace_version

        reservation = reserve_workspace_version(db, project, next_version)
        data = row.data if body.action == "baseline.create" else reconcile(db, project, row.data)
        if progress_proof is not None:
            from .delivery_progress_baseline import apply_progress

            applied = apply_progress(db, project, user, body.action, payload, proof=progress_proof)
        else:
            applied = _apply(
                db, project, user, data, body.action, payload, request, command_key=body.idempotency_key, design_prepared=design_prepared
            )
        resource_id, before = applied[:2]
        event_data = {
            "before": before,
            "input": payload.model_dump(mode="json", exclude_unset=body.action == "project.update"),
        }
        if body.action == "project.update" and "vector_db_config" in event_data["input"]:
            event_data["input"]["vector_db_config"] = {"changed": True}
        if len(applied) == 3:
            event_data["result"] = applied[2]
        from .delivery_query_commands import command_access, recorded_ack

        ack = recorded_ack(project, body.action, resource_id, event_data.get("result"), next_version)
        event_data["command_ack"] = ack
        event_data["command_ack_access"] = sorted(
            set(
                command_access(data, body.action, resource_id)
                + (list(source.runtime_scopes) if source is not None else [])
            )
        )
        if body.action in {"task.delivery.submit", "task.delivery.review"}:
            from .delivery_task_submission_service import submission_runtime_scopes

            event_data["command_ack_access"] = sorted(set(event_data["command_ack_access"] +
                submission_runtime_scopes(db, project, event_data["result"]["submission_id"])))
        if body.action.startswith("work_order."):
            from .delivery_external_work_order_model import DeliveryExternalWorkOrder

            runtime_scopes = db.scalar(select(DeliveryExternalWorkOrder.runtime_scopes).where(
                DeliveryExternalWorkOrder.tenant_id == project.tenant_id, DeliveryExternalWorkOrder.project_id == project.id,
                DeliveryExternalWorkOrder.id == resource_id)) or []
            event_data["command_ack_access"] = sorted(set(event_data["command_ack_access"] + runtime_scopes))
        db.flush()
        if body.action not in {"project.lifecycle", "baseline.create"} and not body.action.startswith(
            ("release.", "deployment.")
        ):
            remember_basis(db, project, data)
        updated = db.execute(
            update(DeliveryWorkspace)
            .where(
                DeliveryWorkspace.project_id == project.id,
                DeliveryWorkspace.tenant_id == project.tenant_id,
                DeliveryWorkspace.version == next_version,
            )
            .values(data=data, version=next_version),
            execution_options={"synchronize_session": False},
        )
        if updated.rowcount != 1:
            raise HTTPException(409, "Concurrent edit. Reload the project.")
        db.flush()
        event = DeliveryEvent(
            id=identifier("event"),
            project_id=project.id,
            tenant_id=project.tenant_id,
            version=next_version,
            actor=user.username,
            action=body.action,
            resource_id=resource_id,
            data=event_data,
        )
        from .delivery_activity import record_activity

        record_activity(db, project, user, data, event)
        record_adoption(db, project, user, source, body, payload, ack, event)
        db.add(
            DeliveryReceipt(
                id=key,
                project_id=project.id,
                tenant_id=project.tenant_id,
                request_hash=fingerprint,
                version=next_version,
            )
        )
        yield {"ack": ack, "version": next_version}
    finally:
        from .delivery_requirement_proof import release

        release(db, requirement_proof_token)
        if reservation:
            from .delivery_progress_capture import release_workspace_version

            release_workspace_version(db, reservation)


def _commit_command(db, project, user, body, payload, key, fingerprint, request, background_tasks=None):
    try:
        with stage_delivery_command(db, project, user, body, payload, key, fingerprint, request) as staged:
            db.commit()
        db.expire_all()
        _schedule_committed_run(db, project, user, body, request, background_tasks, staged["version"])
        from .delivery_query_commands import current_ack

        return current_ack(db, project, staged["ack"], replayed=False)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            409, "Concurrent command. Reload and retry using the same idempotency key."
        ) from exc
    except Exception:
        db.rollback()
        raise


def _apply(db, project, user, data, action, payload, request, *, command_key="", design_prepared=None):
    if action.startswith("work_order."):
        from .delivery_external_work_order_service import apply_work_order

        return apply_work_order(db, project, user, data, action, payload, command_key=command_key,
            store=getattr(request.app.state, "hermes_store", None) if request else None,
            execution=getattr(request.app.state, "hermes_execution", None) if request else None)
    if action.startswith("design."):
        from .design_service import apply_document

        return apply_document(db, project, user, action, payload, command_key=command_key)
    if action in {"requirement.design.adopt", "requirement.design.clear", "task.design.adopt", "task.design.clear"}:
        from .design_adoption_service import apply_adoption

        return apply_adoption(db, project, user, data, action, payload, design_prepared, command_key=command_key)
    if action in {"task.delivery.submit", "task.delivery.review"}:
        from .delivery_task_submission_service import apply_submission

        return apply_submission(db, project, user, data, action, payload,
            store=getattr(request.app.state, "hermes_store", None) if request else None,
            execution=getattr(request.app.state, "hermes_execution", None) if request else None,
            command_key=command_key)
    if action in {"issue.create", "sync.record.apply"}:
        from .event_business import apply_canonical

        return apply_canonical(db, project, user, data, action, payload, command_key)
    if action in {"execution.start", "execution.retry", "execution.cancel", "execution.approval", "execution.control.close"}:
        from .delivery_execution_runtime import apply_runtime_control

        return apply_runtime_control(
            db,
            project,
            user,
            data,
            action,
            payload,
            getattr(request.app.state, "hermes_store", None) if request else None,
            getattr(request.app.state, "hermes_execution", None) if request else None,
            command_key=command_key,
        )
    if action.startswith("issue.diagnosis."):
        from .delivery_issue_diagnosis import apply_issue_diagnosis

        return apply_issue_diagnosis(
            db,
            project,
            user,
            data,
            action,
            payload,
            store=getattr(request.app.state, "hermes_store", None) if request else None,
            execution=getattr(request.app.state, "hermes_execution", None) if request else None,
        )
    if action.startswith("deployment."):
        from .delivery_deployment import apply_deployment

        store = getattr(request.app.state, "hermes_store", None) if request else None
        execution = getattr(request.app.state, "hermes_execution", None) if request else None
        return apply_deployment(db, project, user, data, action, payload, store, execution)
    if action.startswith("release."):
        from .delivery_release import apply_release

        return apply_release(db, project, user, data, action, payload)
    if action == "project.lifecycle":
        from .project_lifecycle import apply_lifecycle

        return apply_lifecycle(db, project, user, data, payload)
    if action in {"member.runtime.bind", "member.runtime.unbind"}:
        from .delivery_team_runtime import apply_runtime_binding

        store = getattr(request.app.state, "hermes_store", None) if request else None
        return apply_runtime_binding(db, project, data, user, store, action, payload)
    if action in {"tasks.schedule", "member.calendar.save"}:
        from .delivery_scheduling import apply_scheduling

        return apply_scheduling(db, project, data, action, payload)
    if action == "task.manual_review":
        from .delivery_manual_review import apply_review

        return apply_review(db, project, user, data, payload)
    if action in {"progress.record", "baseline.create"}:
        from .delivery_progress_baseline import apply_progress

        return apply_progress(db, project, user, action, payload)
    if action.startswith("execution."):
        from .delivery_execution import apply_execution

        store = getattr(request.app.state, "hermes_store", None) if request else None
        execution = getattr(request.app.state, "hermes_execution", None) if request else None
        return apply_execution(db, project, user, data, action, payload, store, execution)
    return apply_action(db, project, user, data, action, payload)


from .design_contract import AdoptionPreview, AdoptionPreviewInput, DesignCurrent  # noqa: E402


@router.get("/requirements/{requirement_id}/designs", response_model=DesignCurrent)
def requirement_designs(requirement_id: str, user: Annotated[User, Depends(current_user)], db: Annotated[Session, Depends(get_session)],
                        project_id: str = Header(default="", alias="X-Project-Id")):
    from .design_adoption_service import current

    with db.no_autoflush:
        return current(db, _project(db, user, project_id), user, "requirement", requirement_id)


@router.get("/tasks/{task_id}/designs", response_model=DesignCurrent)
def task_designs(task_id: str, user: Annotated[User, Depends(current_user)], db: Annotated[Session, Depends(get_session)],
                 project_id: str = Header(default="", alias="X-Project-Id")):
    from .design_adoption_service import current

    with db.no_autoflush:
        return current(db, _project(db, user, project_id), user, "task", task_id)


@router.post("/requirements/{requirement_id}/design-adoption-preview", response_model=AdoptionPreview)
def requirement_design_preview(requirement_id: str, body: AdoptionPreviewInput, request: Request,
        user: Annotated[User, Depends(current_user)], db: Annotated[Session, Depends(get_session)],
        project_id: str = Header(default="", alias="X-Project-Id")):
    from .design_adoption_service import preview

    with db.no_autoflush:
        return preview(db, _project(db, user, project_id), user, "requirement", requirement_id, body,
            store=getattr(request.app.state, "hermes_store", None))


@router.post("/tasks/{task_id}/design-adoption-preview", response_model=AdoptionPreview)
def task_design_preview(task_id: str, body: AdoptionPreviewInput, request: Request,
        user: Annotated[User, Depends(current_user)], db: Annotated[Session, Depends(get_session)],
        project_id: str = Header(default="", alias="X-Project-Id")):
    from .design_adoption_service import preview

    with db.no_autoflush:
        return preview(db, _project(db, user, project_id), user, "task", task_id, body,
            store=getattr(request.app.state, "hermes_store", None))


from .delivery_external_work_order_contract import Current as WorkOrderCurrent, Preview as WorkOrderPreview, PreviewInput as WorkOrderPreviewInput, Page as WorkOrderPage, Detail as WorkOrderDetail, PacketView as WorkOrderPacketView  # noqa: E402


@router.get("/tasks/{task_id}/work-orders/current", response_model=WorkOrderCurrent)
def external_work_order_current(task_id: str, request: Request, user: Annotated[User, Depends(current_user)],
        db: Annotated[Session, Depends(get_session)], project_id: str = Header(default="", alias="X-Project-Id")):
    from .delivery_external_work_order_query import current

    with db.no_autoflush:
        return current(db, _project(db, user, project_id), user, task_id, store=getattr(request.app.state, "hermes_store", None), execution=getattr(request.app.state, "hermes_execution", None))


@router.post("/tasks/{task_id}/work-order-preview", response_model=WorkOrderPreview, response_model_exclude_unset=True)
def external_work_order_preview(task_id: str, body: WorkOrderPreviewInput, request: Request, user: Annotated[User, Depends(current_user)],
        db: Annotated[Session, Depends(get_session)], project_id: str = Header(default="", alias="X-Project-Id")):
    from .delivery_external_work_order_query import preview

    with db.no_autoflush:
        return preview(db, _project(db, user, project_id), user, task_id, body, store=getattr(request.app.state, "hermes_store", None), execution=getattr(request.app.state, "hermes_execution", None))


@router.get("/work-orders", response_model=WorkOrderPage)
def external_work_orders(request: Request, user: Annotated[User, Depends(current_user)], db: Annotated[Session, Depends(get_session)],
        task_id: str = Query("", max_length=64), state: Literal["", "queued", "claimed", "cancel_requested", "reported", "closed"] = "",
        limit: int = Query(20, ge=1, le=100), cursor: str = Query("", max_length=4000), project_id: str = Header(default="", alias="X-Project-Id")):
    from .delivery_external_work_order_query import catalogue

    with db.no_autoflush:
        return catalogue(db, _project(db, user, project_id), user, task_id=task_id, state=state, limit=limit, cursor=cursor, store=getattr(request.app.state, "hermes_store", None))


@router.get("/work-orders/{work_order_id}", response_model=WorkOrderDetail, response_model_exclude_unset=True)
def external_work_order_detail(work_order_id: str, request: Request, user: Annotated[User, Depends(current_user)],
        db: Annotated[Session, Depends(get_session)], project_id: str = Header(default="", alias="X-Project-Id")):
    from .delivery_external_work_order_query import detail

    with db.no_autoflush:
        return detail(db, _project(db, user, project_id), user, work_order_id, store=getattr(request.app.state, "hermes_store", None), execution=getattr(request.app.state, "hermes_execution", None))


@router.get("/work-orders/{work_order_id}/packet", response_model=WorkOrderPacketView)
def external_work_order_packet(work_order_id: str, request: Request, user: Annotated[User, Depends(current_user)],
        db: Annotated[Session, Depends(get_session)], project_id: str = Header(default="", alias="X-Project-Id")):
    from .delivery_external_work_order_query import packet

    with db.no_autoflush:
        return packet(db, _project(db, user, project_id), user, work_order_id, store=getattr(request.app.state, "hermes_store", None))
