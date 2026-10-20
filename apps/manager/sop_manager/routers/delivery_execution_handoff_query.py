"""Bounded, currently authorized reads of canonical execution handoffs.

These reads never claim work, create a runtime plan, or require a disposable
delivery query index. Large frozen requests remain private to the worker.
"""

import hashlib
import json
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select

from .auth_sql import check_project_access
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_execution_handoff import handoff_view
from .delivery_execution_handoff_model import DeliveryExecutionHandoff as Handoff
from .delivery_issue_evidence import _access
from .delivery_service import stamp
from .hermes_workspace import runtime_identity
from .sql_models import Task, User

PUBLIC_FIELDS = (
    "id", "execution_id", "task_id", "workspace_id", "state", "revision", "attempt",
    "accepted_at", "updated_at", "next_attempt_at", "error", "run_id", "runtime_task_id",
)


def _scope(project):
    return Handoff.tenant_id == project.tenant_id, Handoff.project_id == project.id


def _public_query(project):
    return select(*(getattr(Handoff, name) for name in PUBLIC_FIELDS)).where(*_scope(project))


def _view(row):
    return handoff_view(SimpleNamespace(**dict(row)))


def _principal(db, project, user, store):
    current = db.get(User, user.id, populate_existing=True) if user is not None else None
    if current is None or current.status != "active" or current.tenant_id != project.tenant_id:
        raise HTTPException(403, "Current account cannot read execution handoffs")
    check_project_access(current, project.id, db)
    if store is None:
        raise HTTPException(503, "Execution runtime is not configured")
    principal = runtime_identity(current, store)
    if principal.tenant != project.tenant_id or "read" not in principal.permissions:
        raise HTTPException(403, "Runtime read permission required")
    return current, principal


def handoff_detail(db, project, user, execution_id, store):
    current, principal = _principal(db, project, user, store)
    row = db.execute(_public_query(project).where(Handoff.execution_id == execution_id)).mappings().first()
    if row is None:
        raise HTTPException(404, {"code": "execution_handoff_not_found", "message": "No durable handoff exists for this execution"})
    if principal.workspace_ids is not None and row["workspace_id"] not in principal.workspace_ids:
        raise HTTPException(403, "Runtime workspace membership required")
    _access(store, current, project, row["workspace_id"])
    return {"project_id": project.id, "execution_id": execution_id, "task_id": row["task_id"], "handoff": _view(row)}


def page_handoff_summaries(db, project, user, execution_ids, store):
    """Attach live technical facts only to a bounded, already authorized page."""
    if len(execution_ids) > 100:
        raise ValueError("Execution handoff summaries require a bounded page")
    if not execution_ids:
        return {}
    current, principal = _principal(db, project, user, store)
    query = _public_query(project).where(Handoff.execution_id.in_(execution_ids))
    if principal.workspace_ids is not None:
        query = query.where(Handoff.workspace_id.in_(sorted(principal.workspace_ids)))
    rows = db.execute(query).mappings().all()
    for workspace_id in sorted({row["workspace_id"] for row in rows}):
        _access(store, current, project, workspace_id)
    return {row["execution_id"]: _view(row) for row in rows}


def _position(value):
    if len(value) != 2 or not all(isinstance(part, str) for part in value) or not value[1] or len(value[1]) > 64:
        raise ValueError("Invalid handoff cursor position")
    parsed = datetime.fromisoformat(value[0])
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed, value[1]


def _before(position, *, inclusive=False):
    at, identity = position
    return or_(Handoff.accepted_at < at, and_(Handoff.accepted_at == at,
        Handoff.id <= identity if inclusive else Handoff.id < identity))


def task_handoffs(db, project, user, task_id, store, *, limit=20, cursor=""):
    if type(limit) is not int or not 1 <= limit <= 100:
        raise HTTPException(422, "Use a handoff page size between 1 and 100")
    current, principal = _principal(db, project, user, store)
    allowed = None if principal.workspace_ids is None else sorted(principal.workspace_ids)
    visibility = "all" if allowed is None else hashlib.sha256(json.dumps(allowed, separators=(",", ":")).encode()).hexdigest()
    filters = ["execution-handoffs", project.tenant_id, project.id, current.id, task_id, visibility, limit]
    query = _public_query(project).where(Handoff.task_id == task_id)
    if allowed is not None:
        query = query.where(Handoff.workspace_id.in_(allowed))
    if cursor:
        upper_value, after_value = decode_cursor(cursor, filters)
        try:
            upper, after = _position(upper_value), _position(after_value)
            if after > upper:
                raise ValueError("Handoff cursor exceeds its accepted upper bound")
        except (ValueError, TypeError, OverflowError) as exc:
            raise HTTPException(422, "Invalid execution handoff cursor") from exc
    else:
        top = db.execute(query.order_by(Handoff.accepted_at.desc(), Handoff.id.desc()).limit(1)).mappings().first()
        if top is None:
            # A removed task can still have authorized immutable handoff history.
            task = db.scalar(select(Task.id).where(Task.tenant_id == project.tenant_id,
                Task.project_id == project.id, Task.id == task_id))
            if task is None:
                raise HTTPException(404, "Task handoff history not found in this project")
            return {"project_id": project.id, "task_id": task_id, "items": [], "total": 0,
                "limit": limit, "next_cursor": None, "as_of": stamp()}
        upper = top["accepted_at"], top["id"]
        upper_value = [upper[0].isoformat(), upper[1]]
        after = None
    bounded = query.where(_before(upper, inclusive=True))
    total = db.scalar(select(func.count()).select_from(bounded.subquery()))
    if after is not None:
        bounded = bounded.where(_before(after))
    rows = db.execute(bounded.order_by(Handoff.accepted_at.desc(), Handoff.id.desc()).limit(limit + 1)).mappings().all()
    page = rows[:limit]
    for workspace_id in sorted({row["workspace_id"] for row in page}):
        _access(store, current, project, workspace_id)
    token = encode_cursor(filters, upper_value, [page[-1]["accepted_at"].isoformat(), page[-1]["id"]]) if len(rows) > limit else None
    return {"project_id": project.id, "task_id": task_id, "items": [_view(row) for row in page],
        "total": total, "limit": limit, "next_cursor": token, "as_of": stamp()}
