"""Authenticated project delivery workflow."""

import hashlib
import json
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import ValidationError
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth_sql import _norm_role, check_project_access, current_user
from .delivery_contract import (
    PAYLOADS,
    STAGES,
    Command,
    ProgressBaselineResponse,
    ProgressObservationResponse,
    ProgressResponse,
    TaskPlanPreview,
    TaskReviewsResponse,
)
from .delivery_execution_contract import (
    ExecutionObservationsResponse,
    ExecutionPreviewResponse,
    ExecutionQueue,
    ExecutionTargetsResponse,
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
    materialize,
    reconcile,
    records,
    remember_basis,
    serialize,
)
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


def _permissions(db, user, project):
    member = db.get(ProjectMember, (project.id, user.id))
    role = _norm_role(member.role if member else user.role)
    user_role = _norm_role(user.role)
    admin = user_role == "super_admin" or user.tenant_id == project.tenant_id and user_role == "tenant_admin"
    return {
        "write": admin or role in {"project_admin", "developer", "devops", "product_manager"},
        "approve": admin or role in {"project_admin", "devops", "product_manager"},
        "configure": admin or role == "project_admin",
    }


def _snapshot(db, project, user):
    row = db.get(DeliveryWorkspace, project.id)
    state = reconcile(db, project, row.data) if row else initial_state()
    result = materialize(db, project, state, user)
    events = records(db, DeliveryEvent, project).order_by(DeliveryEvent.version.desc()).limit(200).all()
    result.update(
        version=row.version if row else 0,
        stages=STAGES,
        permissions=_permissions(db, user, project),
        activity=[serialize(e) for e in events[:50]],
        history=[
            {"at": e.created_at.isoformat() + "Z", **e.data["snapshot"]}
            for e in reversed(events)
            if "snapshot" in e.data
        ],
    )
    from .delivery_scheduling import planning_basis

    result["planning_basis"] = planning_basis(db, project, state)
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
    if not _permissions(db, user, project)["write"]:
        raise HTTPException(403, "Project write permission required")
    return preview(db, project, body)


@router.get("/workspace")
def workspace(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    return _snapshot(db, _project(db, user, project_id), user)


@router.get("/inbox")
def delivery_inbox(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    scope: Annotated[Literal["mine", "team"], Query()] = "mine",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_inbox import build_inbox

    project = _project(db, user, project_id)
    return build_inbox(_snapshot(db, project, user), user, scope=scope)


@router.get("/progress", response_model=ProgressResponse)
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
        _project(db, user, project_id),
        starts_on=starts_on,
        ends_on=ends_on,
        scope=scope,
        scope_id=scope_id,
        baseline_id=baseline_id,
    )


@router.get("/progress/observations/{observation_id}", response_model=ProgressObservationResponse)
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
        db, _project(db, user, project_id), observation_id, scope=scope, scope_id=scope_id
    )


@router.get("/progress/baselines/{baseline_id}", response_model=ProgressBaselineResponse)
def delivery_progress_baseline(
    baseline_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_progress_query import baseline_detail

    return baseline_detail(db, _project(db, user, project_id), baseline_id)


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
        project_write=_permissions(db, user, project)["write"],
        project_configure=_permissions(db, user, project)["configure"],
    )


@router.post("/execution-preview", response_model=ExecutionPreviewResponse)
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
    if not _permissions(db, user, project)["write"]:
        raise HTTPException(403, "Project write permission required")
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
        return {"project_id": project.id, "version": row.version if row else 0, **plan}
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


@router.get("/tasks/{task_id}/reviews", response_model=TaskReviewsResponse)
def task_reviews(
    task_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str, Query(max_length=64)] = "",
    project_id: str = Header(default="", alias="X-Project-Id"),
):
    from .delivery_manual_review import list_reviews

    project = _project(db, user, project_id)
    return list_reviews(
        db,
        project,
        task_id,
        can_approve=_permissions(db, user, project)["approve"],
        limit=limit,
        cursor=cursor,
    )


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
    if not _permissions(db, user, project)["write"]:
        raise HTTPException(403, "Project write permission required")
    return create_preview(db, project, user, body, request)


def _command_permission(action, payload):
    if action in {"member.save", "member.calendar.save", "resource.save", "resource.archive"} or (
        action == "project.update" and {"name", "description"} & payload.keys()
    ):
        return "configure"
    if action in {
        "stage.advance",
        "stage.reopen",
        "release.save",
        "execution.review",
        "baseline.create",
        "task.manual_review",
    }:
        return "approve"
    return "write"


@router.post("/commands")
def execute(
    body: Command,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
    project_id: str = Header(default="", alias="X-Project-Id"),
    request: Request = None,
):
    project = _project(db, user, project_id)
    permissions = _permissions(db, user, project)
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
    fingerprint = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    receipt = db.get(DeliveryReceipt, key)
    if receipt:
        if receipt.request_hash != fingerprint:
            raise HTTPException(409, "Idempotency key already used with different input")
        return {**_snapshot(db, project, user), "replayed": True, "applied_version": receipt.version}
    try:
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
        data = reconcile(db, project, row.data)
        resource_id, before = _apply(db, project, user, data, body.action, payload, request)
        db.flush()
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
        summary = materialize(db, project, data, user)["summary"]
        db.add(
            DeliveryEvent(
                id=identifier("event"),
                project_id=project.id,
                tenant_id=project.tenant_id,
                version=next_version,
                actor=user.username,
                action=body.action,
                resource_id=resource_id,
                data={"snapshot": summary, "before": before, "input": payload.model_dump(mode="json")},
            )
        )
        db.add(
            DeliveryReceipt(
                id=key,
                project_id=project.id,
                tenant_id=project.tenant_id,
                request_hash=fingerprint,
                version=next_version,
            )
        )
        db.commit()
        db.expire_all()
        return {**_snapshot(db, project, user), "replayed": False, "applied_version": next_version}
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            409, "Concurrent command. Reload and retry using the same idempotency key."
        ) from exc
    except Exception:
        db.rollback()
        raise


def _apply(db, project, user, data, action, payload, request):
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
