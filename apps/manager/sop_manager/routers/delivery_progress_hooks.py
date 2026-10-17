"""SQL Session hooks with lazy domain imports, safe for every model import order."""

from sqlalchemy import event, select
from sqlalchemy.orm import Session

_SCOPES = "delivery_progress_scopes"
_RECORDED = "delivery_progress_recorded"
_BUSY = "delivery_progress_capturing"
_ACTORS = "delivery_progress_actors"
_CORE_ROWS = "delivery_progress_core_rows"


def _models():
    from .sql_models import (
        DeliveryEvent,
        DeliveryTaskReview,
        DeliveryWorkspace,
        Issue,
        Project,
        Requirement,
        Sprint,
        Task,
    )

    return Requirement, Task, Issue, Sprint, Project, DeliveryWorkspace, DeliveryEvent, DeliveryTaskReview


def _identity_scopes(db, *, tenant_ids=(), user_ids=(), project_ids=()):
    """Actual review scopes affected by membership, name or account status changes."""
    from .sql_models import DeliveryTaskReview, Project

    if tenant_ids and user_ids:
        for tenant_id, project_id in db.connection().execute(
            select(DeliveryTaskReview.tenant_id, DeliveryTaskReview.project_id)
            .where(
                DeliveryTaskReview.tenant_id.in_(tenant_ids),
                DeliveryTaskReview.snapshot["owner"]["id"]
                .as_string()
                .in_(["user:" + value for value in user_ids]),
            )
            .distinct()
        ):
            mark_progress(db, tenant_id, project_id)
    if project_ids:
        for tenant_id, project_id in db.connection().execute(
            select(Project.tenant_id, Project.id).where(Project.id.in_(project_ids))
        ):
            mark_progress(db, tenant_id, project_id)


def _identity_object_scopes(db, obj):
    from sqlalchemy import inspect

    from .sql_models import ProjectMember, User

    state = inspect(obj)
    if isinstance(obj, User):
        tenants = {obj.tenant_id}
        if state.persistent:
            original = (
                db.connection().execute(select(User.tenant_id).where(User.id == state.identity[0])).scalar()
            )
            if original:
                tenants.add(original)
        _identity_scopes(db, tenant_ids=tenants, user_ids={obj.id})
    elif isinstance(obj, ProjectMember):
        projects = {obj.project_id}
        if state.persistent:
            projects.add(state.identity[0])
        _identity_scopes(db, project_ids=projects)


def mark_progress(db, tenant_id, project_id):
    """Register scopes in their current transaction, not a process-wide default project."""
    if not tenant_id or not project_id or db.info.get(_BUSY):
        return
    transaction = db.get_nested_transaction() or db.get_transaction()
    if transaction is None:
        db.begin()
        transaction = db.get_transaction()
    db.info.setdefault(_SCOPES, {}).setdefault(transaction, set()).add((str(tenant_id), str(project_id)))


def _before_flush(db, flush_context, instances):
    from sqlalchemy import inspect

    from .sql_models import DeliveryEvent, Project

    if db.info.get(_BUSY):
        return
    for obj in db.new | db.dirty | db.deleted:
        _identity_object_scopes(db, obj)
        if not isinstance(obj, _models()):
            continue
        if obj in db.dirty and not db.is_modified(obj, include_collections=False):
            continue
        mark_progress(db, obj.tenant_id, obj.id if isinstance(obj, Project) else obj.project_id)
        state = inspect(obj)
        tenant_history = state.attrs.tenant_id.history
        project_history = (
            state.attrs.id.history if isinstance(obj, Project) else state.attrs.project_id.history
        )
        if state.persistent and (tenant_history.has_changes() or project_history.has_changes()):
            # Expired attributes need not retain their old value in ORM history.
            # Before flushing, the actual row still carries its original scope.
            table = obj.__table__
            old_project_column = table.c.id if isinstance(obj, Project) else table.c.project_id
            primary_column = next(iter(table.primary_key.columns))
            original = (
                db.connection()
                .execute(
                    select(table.c.tenant_id, old_project_column).where(primary_column == state.identity[0])
                )
                .first()
            )
            if original:
                mark_progress(db, *original)
        if tenant_history.deleted or project_history.deleted:
            old_tenant = tenant_history.deleted[0] if tenant_history.deleted else obj.tenant_id
            old_project = (
                project_history.deleted[0]
                if project_history.deleted
                else (obj.id if isinstance(obj, Project) else obj.project_id)
            )
            mark_progress(db, old_tenant, old_project)
        if isinstance(obj, DeliveryEvent) and obj in db.new:
            transaction = db.get_nested_transaction() or db.get_transaction()
            db.info.setdefault(_ACTORS, {}).setdefault(transaction, {})[(obj.tenant_id, obj.project_id)] = (
                obj.actor
            )


def _core_identity_write(state, table):
    from sqlalchemy import tuple_

    from .sql_models import ProjectMember, User

    if table is None or table.name not in {User.__tablename__, ProjectMember.__tablename__}:
        return False
    if state.is_insert:
        return True
    is_user = table.name == User.__tablename__
    columns = [table.c.id, table.c.tenant_id] if is_user else [table.c.project_id, table.c.user_id]
    query = select(*columns)
    if state.statement.whereclause is not None:
        query = query.where(state.statement.whereclause)
    elif isinstance(state.parameters, list):
        keys = [
            tuple(row.get(column.key) for column in columns[: 1 if is_user else 2])
            for row in state.parameters
        ]
        query = query.where(tuple_(*columns[: 1 if is_user else 2]).in_(keys))
    rows = (
        state.session.connection()
        .execute(query, state.parameters if isinstance(state.parameters, dict) else {})
        .all()
    )
    if is_user:
        for user_id, tenant_id in rows:
            _identity_scopes(state.session, tenant_ids={tenant_id}, user_ids={user_id})
    else:
        _identity_scopes(state.session, project_ids={row[0] for row in rows})
    return True


def _core_write(state):
    from .sql_models import Project

    if not (state.is_update or state.is_delete or state.is_insert) or state.session.info.get(_BUSY):
        return
    statement = state.statement
    table = getattr(statement, "table", None)
    if _core_identity_write(state, table):
        return
    if table is None or table.name not in {m.__tablename__ for m in _models()}:
        return
    if state.is_insert:
        values = (
            state.parameters
            if isinstance(state.parameters, list)
            else [state.parameters or statement.compile().params]
        )
        for row in values:
            if isinstance(row, dict):
                mark_progress(
                    state.session,
                    row.get("tenant_id"),
                    row.get("id") if table.name == Project.__tablename__ else row.get("project_id"),
                )
        return
    project_column = table.c.id if table.name == Project.__tablename__ else table.c.project_id
    primary_column = next(iter(table.primary_key.columns))
    query = select(primary_column, table.c.tenant_id, project_column)
    if statement.whereclause is not None:
        query = query.where(statement.whereclause)
    if isinstance(state.parameters, list) and statement.whereclause is None:
        # ORM bulk UPDATE by primary key adds its PK predicate after this hook.
        # Select only those IDs, rather than treating it as an unscoped update.
        query = query.where(
            primary_column.in_(
                [row[primary_column.key] for row in state.parameters if primary_column.key in row]
            )
        )
    parameters = state.parameters if isinstance(state.parameters, dict) else None
    affected = state.session.connection().execute(query, parameters or {}).all()
    for _row_id, tenant_id, project_id in affected:
        mark_progress(state.session, tenant_id, project_id)
    if state.is_update and affected:
        transaction = state.session.get_nested_transaction() or state.session.get_transaction()
        state.session.info.setdefault(_CORE_ROWS, {}).setdefault(transaction, {}).setdefault(
            table.name, set()
        ).update(row_id for row_id, _, _ in affected)


def _before_commit(db):
    from .delivery_progress_capture import record_observation
    from .sql_models import Project

    if db.in_nested_transaction() or db.info.get(_BUSY):
        return
    db.flush()
    # Core UPDATE may move rows across projects/tenants without any dirty ORM
    # object. Resolve the same actual primary keys after all writes finish,
    # rather than guessing destinations from literal UPDATE parameters.
    tables = {model.__tablename__: model.__table__ for model in _models()}
    moved = {}
    for group in db.info.get(_CORE_ROWS, {}).values():
        for table_name, ids in group.items():
            moved.setdefault(table_name, set()).update(ids)
    for table_name, ids in moved.items():
        table = tables[table_name]
        project_column = table.c.id if table.name == Project.__tablename__ else table.c.project_id
        primary_column = next(iter(table.primary_key.columns))
        for tenant_id, project_id in (
            db.connection()
            .execute(select(table.c.tenant_id, project_column).where(primary_column.in_(ids)))
            .all()
        ):
            mark_progress(db, tenant_id, project_id)
    groups = db.info.get(_SCOPES, {})
    scopes = set().union(*groups.values()) if groups else set()
    if not scopes:
        return
    db.info[_BUSY] = True
    try:
        actors = {key: actor for group in db.info.get(_ACTORS, {}).values() for key, actor in group.items()}
        for tenant_id, project_id in sorted(scopes):
            project = db.get(Project, project_id)
            if not project or project.tenant_id != tenant_id:
                continue
            record_observation(db, project, actor=actors.get((tenant_id, project_id), ""))
    finally:
        db.info.pop(_BUSY, None)


def _after_commit(db):
    nested = db.get_nested_transaction()
    if nested:
        scopes = db.info.get(_SCOPES, {})
        values = scopes.pop(nested, set())
        if values:
            scopes.setdefault(nested.parent, set()).update(values)
        for key in (_RECORDED, _ACTORS):
            groups = db.info.get(key, {})
            group = groups.pop(nested, {})
            if group:
                groups.setdefault(nested.parent, {}).update(group)
        core_groups = db.info.get(_CORE_ROWS, {})
        for table_name, ids in core_groups.pop(nested, {}).items():
            core_groups.setdefault(nested.parent, {}).setdefault(table_name, set()).update(ids)


def _after_soft_rollback(db, previous):
    if previous.nested:
        db.info.get(_SCOPES, {}).pop(previous, None)
        for key in (_RECORDED, _ACTORS, _CORE_ROWS):
            db.info.get(key, {}).pop(previous, None)


def _after_transaction_end(db, transaction):
    if transaction.parent is None:
        for key in (_SCOPES, _RECORDED, _BUSY, _ACTORS, _CORE_ROWS):
            db.info.pop(key, None)


def install_progress_hooks():
    handlers = (
        ("before_flush", _before_flush),
        ("do_orm_execute", _core_write),
        ("before_commit", _before_commit),
        ("after_commit", _after_commit),
        ("after_soft_rollback", _after_soft_rollback),
        ("after_transaction_end", _after_transaction_end),
    )
    for name, handler in handlers:
        if not event.contains(Session, name, handler):
            event.listen(Session, name, handler)
