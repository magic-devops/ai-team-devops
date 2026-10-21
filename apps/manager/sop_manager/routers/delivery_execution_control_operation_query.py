"""Small, authorized reads of accepted controls, independent of worker effects."""

import hashlib
import json
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select

from .auth_sql import _norm_role
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_execution_control_operation_model import DeliveryExecutionControlOperation as Control
from .delivery_execution_control_operation_service import control_view
from .delivery_execution_handoff_model import DeliveryExecutionHandoff as Handoff
from .delivery_execution_handoff_query import _principal
from .delivery_issue_evidence import _access
from .delivery_service import stamp
from .sql_models import DeliveryQueryFact, DeliveryWorkspace, Project, ProjectMember

PUBLIC_FIELDS = (
    "id", "execution_id", "task_id", "workspace_id", "action", "request_digest", "state",
    "revision", "attempt", "accepted_at", "updated_at", "next_attempt_at", "error",
    "run_id", "run_attempt", "outcome", "launch", "target_operation_id", "requested_by",
)
OPEN_STATES = {"accepted", "applying", "retry_wait", "blocked"}


def _scope(project, model=Control):
    return model.tenant_id == project.tenant_id, model.project_id == project.id


def _query(project):
    # Neither private original nor the potentially large Core effect is selected.
    return select(*(getattr(Control, name) for name in PUBLIC_FIELDS)).where(*_scope(project))


def _identity(db, project, execution_id):
    value = db.execute(select(Control.task_id, Control.workspace_id).where(
        *_scope(project), Control.execution_id == execution_id,
    ).order_by(Control.accepted_at.desc(), Control.id.desc()).limit(1)).first()
    if value is not None:
        return value.task_id, value.workspace_id
    value = db.execute(select(Handoff.task_id, Handoff.workspace_id).where(
        *_scope(project, Handoff), Handoff.execution_id == execution_id,
    )).first()
    if value is not None:
        return value.task_id, value.workspace_id

    # Older executions have neither immutable row. Use only a validated position
    # and three scalar JSON paths; a GET must not provision a missing query index.
    from .delivery_query_index import scope
    from .delivery_query_read import _stamp, _unchanged, fail, workspace_path

    generation = _stamp(db, project)
    position = db.scalar(select(DeliveryQueryFact.data["position"]).where(
        *scope(project, DeliveryQueryFact), DeliveryQueryFact.kind == "execution",
        DeliveryQueryFact.entity_id == execution_id,
    ))
    if position is None:
        raise HTTPException(404, "Execution controls not found in this project")
    if type(position) is not int or position < 0:
        fail("delivery_query_cursor_stale", "Execution source changed. Reload the task.")
    actual_id = workspace_path(db, project, "executions", position, "id")
    task_id = workspace_path(db, project, "executions", position, "task_id")
    workspace_id = workspace_path(db, project, "executions", position, "workspace_id")
    if actual_id != execution_id or not isinstance(task_id, str) or not task_id or not isinstance(workspace_id, str) or not workspace_id:
        fail("delivery_query_cursor_stale", "Execution source changed. Reload the task.")
    _unchanged(db, project, generation)
    return task_id, workspace_id


def _authorized(db, project, user, execution_id, store):
    current, principal = _principal(db, project, user, store)
    task_id, workspace_id = _identity(db, project, execution_id)
    if principal.workspace_ids is not None and workspace_id not in principal.workspace_ids:
        raise HTTPException(403, "Runtime workspace membership required")
    _access(store, current, project, workspace_id)
    return current, principal, task_id, workspace_id


def _version(db, project):
    return db.scalar(select(DeliveryWorkspace.version).where(*_scope(project, DeliveryWorkspace))) or 0


def _close_authority(db, project, current):
    # Read current membership/status scalars rather than a previously cached ORM
    # object; a list refresh cannot preserve revoked write or approval authority.
    member_role = db.scalar(select(ProjectMember.role).where(
        ProjectMember.project_id == project.id, ProjectMember.user_id == current.id,
    ))
    role, user_role = _norm_role(member_role or current.role), _norm_role(current.role)
    admin = user_role == "super_admin" or current.tenant_id == project.tenant_id and user_role == "tenant_admin"
    status = db.scalar(select(Project.status).where(Project.tenant_id == project.tenant_id, Project.id == project.id))
    active = status is not None and status != "archived"
    write = active and (admin or role in {"project_admin", "developer", "devops", "product_manager"})
    approve = active and (admin or role in {"project_admin", "devops", "product_manager"})
    return write, approve


def _views(db, project, current, rows):
    write, approve = _close_authority(db, project, current)
    ids = [row["id"] for row in rows]
    # One bounded query also covers a close K which has not reached Core yet.
    closing = set(db.scalars(select(Control.target_operation_id).where(
        *_scope(project), Control.target_operation_id.in_(ids),
        Control.action == "execution.control.close", Control.state.in_(OPEN_STATES),
    ))) if ids else set()
    result = []
    for row in rows:
        value = control_view(SimpleNamespace(**dict(row)))
        value["permissions"] = {"can_close": bool(
            write and (approve or row["requested_by"] == current.id)
            and row["action"] != "execution.control.close" and row["state"] in OPEN_STATES
            and row["outcome"] is None and row["id"] not in closing
        )}
        result.append(value)
    return result


def control_operation_detail(db, project, user, execution_id, operation_id, store):
    current, _principal_value, task_id, workspace_id = _authorized(db, project, user, execution_id, store)
    row = db.execute(_query(project).where(
        Control.execution_id == execution_id, Control.id == operation_id,
        Control.task_id == task_id, Control.workspace_id == workspace_id,
    )).mappings().first()
    if row is None:
        raise HTTPException(404, "Control operation not found for this execution")
    return {"project_id": project.id, "execution_id": execution_id, "task_id": task_id,
        "version": _version(db, project), "operation": _views(db, project, current, [row])[0]}


def _position(value):
    if len(value) != 2 or not all(isinstance(part, str) for part in value) or not value[1] or len(value[1]) > 64:
        raise ValueError("Invalid control cursor position")
    parsed = datetime.fromisoformat(value[0])
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed, value[1]


def _before(position, *, inclusive=False):
    at, identity = position
    return or_(Control.accepted_at < at, and_(Control.accepted_at == at,
        Control.id <= identity if inclusive else Control.id < identity))


def control_operations(db, project, user, execution_id, store, *, limit=20, cursor=""):
    if type(limit) is not int or not 1 <= limit <= 100:
        raise HTTPException(422, "Use a control page size between 1 and 100")
    current, principal, task_id, workspace_id = _authorized(db, project, user, execution_id, store)
    allowed = None if principal.workspace_ids is None else sorted(principal.workspace_ids)
    visibility = "all" if allowed is None else hashlib.sha256(json.dumps(allowed, separators=(",", ":")).encode()).hexdigest()
    filters = ["execution-controls", project.tenant_id, project.id, current.id, execution_id,
        task_id, workspace_id, visibility, limit]
    query = _query(project).where(Control.execution_id == execution_id,
        Control.task_id == task_id, Control.workspace_id == workspace_id)
    if cursor:
        upper_value, after_value = decode_cursor(cursor, filters)
        try:
            upper, after = _position(upper_value), _position(after_value)
            if after > upper:
                raise ValueError("Control cursor exceeds its accepted upper bound")
        except (ValueError, TypeError, OverflowError) as exc:
            raise HTTPException(422, "Invalid execution control cursor") from exc
    else:
        top = db.execute(query.order_by(Control.accepted_at.desc(), Control.id.desc()).limit(1)).mappings().first()
        if top is None:
            return {"project_id": project.id, "execution_id": execution_id, "task_id": task_id,
                "version": _version(db, project), "items": [], "total": 0, "limit": limit,
                "next_cursor": None, "as_of": stamp()}
        upper = top["accepted_at"], top["id"]
        upper_value = [upper[0].isoformat(), upper[1]]
        after = None
    bounded = query.where(_before(upper, inclusive=True))
    total = db.scalar(select(func.count()).select_from(bounded.subquery()))
    if after is not None:
        bounded = bounded.where(_before(after))
    rows = db.execute(bounded.order_by(Control.accepted_at.desc(), Control.id.desc()).limit(limit + 1)).mappings().all()
    page = rows[:limit]
    token = encode_cursor(filters, upper_value, [page[-1]["accepted_at"].isoformat(), page[-1]["id"]]) if len(rows) > limit else None
    return {"project_id": project.id, "execution_id": execution_id, "task_id": task_id,
        "version": _version(db, project), "items": _views(db, project, current, page), "total": total,
        "limit": limit, "next_cursor": token, "as_of": stamp()}
