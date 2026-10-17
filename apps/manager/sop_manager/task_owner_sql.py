"""Scoped responsibility validation for ORM and typed Session SQL writes."""

from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import event, inspect, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import BindParameter, ClauseElement

from .task_owner import normalize_task_owner_id

_FIELDS = {"owner_id", "tenant_id", "project_id"}
_PENDING = "task_owner_pending_validation"


def _key(value):
    return value if isinstance(value, str) else value.key


def _validate(db, values):
    from .routers.delivery_team import validate_task_owner
    from .routers.sql_models import Project

    owner_id = normalize_task_owner_id(values.get("owner_id", ""))
    if not owner_id:
        return
    project_id, tenant_id = values.get("project_id"), values.get("tenant_id")
    row = db.connection().execute(select(Project.id, Project.tenant_id).where(Project.id == project_id, Project.tenant_id == tenant_id)).first()
    if row is None:
        raise HTTPException(422, {"code": "task_owner_invalid_scope", "message": "Task owner requires an existing tenant/project scope."})
    validate_task_owner(db, SimpleNamespace(id=row.id, tenant_id=row.tenant_id), owner_id)


def _literal(value, parameters, name):
    if isinstance(value, BindParameter):
        if value.callable is not None or value.expanding:
            raise ValueError(f"{name} dynamic SQL parameter cannot be validated")
        key = name if value.unique and name in parameters else value.key
        if key in parameters:
            return parameters[key]
        if value.required:
            raise ValueError(f"{name} bound parameter is required")
        return value.value
    if isinstance(value, ClauseElement):
        raise ValueError(f"{name} SQL expression cannot be validated; provide a stable identity value")
    return value


def _assignments(statement, parameters, static):
    values = {key: value for key, value in parameters.items() if key in _FIELDS}
    for column, value in static.items():
        name = _key(column)
        if name in _FIELDS:
            values[name] = _literal(value, parameters, name)
    return values


def _typed_write(state):
    if not (state.is_insert or state.is_update):
        return
    statement = state.statement
    table = getattr(statement, "table", None)
    if table is None or table.name != "tasks" or "owner_id" not in table.c:
        return
    parameters = state.parameters
    batches = list(parameters) if isinstance(parameters, (list, tuple)) else [parameters or {}]
    if _FIELDS.intersection(getattr(statement, "_select_names", ()) or ()):
        raise ValueError("Task identity INSERT SELECT cannot be validated")
    post = getattr(statement, "_post_values_clause", None)
    if post is not None:
        updates = getattr(post, "update_values_to_set", None) or getattr(post, "update", None) or {}
        if any(_key(column) in _FIELDS for column in dict(updates)):
            raise ValueError("Task identity conflict-update SQL cannot be validated")
    groups = getattr(statement, "_multi_values", ())
    static_rows = [row for group in groups for row in group] if groups else [getattr(statement, "_values", None) or dict(getattr(statement, "_ordered_values", None) or [])]
    for parameters in batches:
        for static in static_rows:
            if not hasattr(static, "items"):
                raise ValueError("Task SQL inserts require named column values")
            assignments = _assignments(statement, parameters, static)
            if state.is_insert:
                _validate(state.session, assignments)
                continue
            if not assignments:
                continue
            columns = [table.c.id, table.c.tenant_id, table.c.project_id, table.c.owner_id]
            query = select(*columns)
            if statement.whereclause is not None:
                query = query.where(statement.whereclause)
            orm_target = getattr(table, "_annotations", {}).get("parentmapper")
            if isinstance(state.parameters, (list, tuple)) and orm_target is not None:
                if "id" not in parameters:
                    raise ValueError("Task ORM bulk update requires its primary key")
                query = query.where(table.c.id == parameters["id"])
            for old in state.session.connection().execute(query, parameters).mappings():
                _validate(state.session, {**old, **assignments})


def _before_flush(db, flush_context, instances):
    from .routers.sql_models import Task

    pending = []
    for task in db.new | db.dirty:
        if not isinstance(task, Task):
            continue
        state = inspect(task)
        if task in db.new or any(state.attrs[name].history.has_changes() for name in _FIELDS):
            pending.append(task)
    if pending:
        db.info[_PENDING] = pending


def _after_flush(db, flush_context):
    # Related project/membership/registry writes in this transaction are now visible.
    for task in db.info.pop(_PENDING, ()):
        _validate(db, {name: getattr(task, name) for name in _FIELDS})


def _rollback(db, previous_transaction):
    db.info.pop(_PENDING, None)


def install_task_owner_guard():
    for name, callback in [("do_orm_execute", _typed_write), ("before_flush", _before_flush), ("after_flush_postexec", _after_flush), ("after_soft_rollback", _rollback)]:
        if not event.contains(Session, name, callback):
            event.listen(Session, name, callback)
