"""SQL Session hooks with lazy domain imports, safe for every model import order."""

from sqlalchemy import event, select
from sqlalchemy.orm import Session

_SCOPES = "delivery_progress_scopes"
_RECORDED = "delivery_progress_recorded"
_BUSY = "delivery_progress_capturing"
_ACTORS = "delivery_progress_actors"
_CORE_ROWS = "delivery_progress_core_rows"
_IDENTITY_USERS = "delivery_progress_identity_users"
_TRUSTED_SCOPES = "delivery_progress_identity_scopes"
_RESERVED_VERSIONS = "delivery_reserved_workspace_versions"


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


def _administrator_roster_scopes(db, tenant_ids, user_ids, include_roster):
    from .sql_models import Project, User

    # Administrators appear in every project roster of their tenant, including
    # when they own no work and have no ProjectMember row.
    tenants = set(tenant_ids) if include_roster else set()
    tenants.update(db.connection().scalars(
        select(User.tenant_id).where(User.id.in_(user_ids), User.tenant_id.in_(tenant_ids),
                                    User.role.in_(["tenant_admin", "super_admin"]))
    ).all())
    return db.connection().execute(
        select(Project.tenant_id, Project.id).where(Project.tenant_id.in_(tenants))
    ).all() if tenants else []


def _identity_scopes(db, *, tenant_ids=(), user_ids=(), project_ids=(), trusted=False, include_roster=False):
    """Actual stable responsibility scopes affected by account or membership changes."""
    from .sql_models import DeliveryTaskReview, DeliveryWorkspace, Project, ProjectMember, Task

    affected = set()

    if tenant_ids and user_ids:
        owner_ids = {"user:" + value for value in user_ids}
        for tenant_id, project_id in db.connection().execute(
            select(Task.tenant_id, Task.project_id)
            .where(Task.tenant_id.in_(tenant_ids), Task.owner_id.in_(owner_ids))
            .distinct()
        ):
            affected.add((tenant_id, project_id))
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
            affected.add((tenant_id, project_id))
        if trusted:
            affected.update(_administrator_roster_scopes(db, tenant_ids, user_ids, include_roster))
            affected.update(db.connection().execute(
                select(Project.tenant_id, Project.id).join(ProjectMember, ProjectMember.project_id == Project.id)
                .where(Project.tenant_id.in_(tenant_ids), ProjectMember.user_id.in_(user_ids))
            ).all())
            # Tenant administrators may approve without a ProjectMember row.
            # Follow the actual immutable approval identity in scoped workspaces.
            for tenant_id, project_id, data in db.connection().execute(
                select(DeliveryWorkspace.tenant_id, DeliveryWorkspace.project_id, DeliveryWorkspace.data)
                .where(DeliveryWorkspace.tenant_id.in_(tenant_ids))
            ):
                candidates = (data or {}).get("release_candidates", [])
                if any(
                    not candidate.get("invalidated") and candidate.get("decision") == "approved"
                    and any(review.get("decision") == "approve" and (review.get("actor") or {}).get("id") in user_ids
                            for review in candidate.get("reviews", []))
                    for candidate in candidates
                ):
                    affected.add((tenant_id, project_id))
    if project_ids:
        for tenant_id, project_id in db.connection().execute(
            select(Project.tenant_id, Project.id).where(Project.id.in_(project_ids))
        ):
            affected.add((tenant_id, project_id))
    if trusted and affected:
        from sop_manager.project_write_guard import lock_project_scopes

        lock_project_scopes(db, affected)
    for tenant_id, project_id in sorted(affected):
        mark_progress(db, tenant_id, project_id)
    if trusted and affected:
        transaction = db.get_nested_transaction() or db.get_transaction()
        db.info.setdefault(_TRUSTED_SCOPES, {}).setdefault(transaction, set()).update(affected)


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
        _identity_scopes(db, tenant_ids=tenants, user_ids={obj.id}, trusted=True,
                         include_roster=obj.role in {"tenant_admin", "super_admin"})
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


def _parameter_rows(state):
    if isinstance(state.parameters, (list, tuple)):
        return state.parameters
    return [state.parameters or {}]


def _insert_rows(state):
    """Resolve literal/bound identity fields without compiling ORM bulk INSERT."""
    from sqlalchemy.sql.elements import BindParameter, ClauseElement

    groups = getattr(state.statement, "_multi_values", ())
    static_rows = (
        [row for group in groups for row in group]
        if groups
        else [getattr(state.statement, "_values", None) or {}]
    )
    for parameters in _parameter_rows(state):
        for static in static_rows:
            values = dict(parameters)
            for column, value in static.items():
                key = column if isinstance(column, str) else column.key
                if isinstance(value, BindParameter):
                    value = parameters.get(value.key, value.value)
                if not isinstance(value, ClauseElement):
                    values.setdefault(key, value)
            yield values


def _selected_rows(state, columns, primary_columns):
    """Bind each actual write separately; ORM bulk adds its primary-key filter."""
    rows = set()
    for parameters in _parameter_rows(state):
        query = select(*columns)
        if state.statement.whereclause is not None:
            query = query.where(state.statement.whereclause)
        # ORM columns in a Core WHERE also set is_orm_statement. Only an ORM
        # entity as the UPDATE target causes SQLAlchemy to add a PK predicate.
        orm_target = getattr(state.statement.table, "_annotations", {}).get("parentmapper")
        if isinstance(state.parameters, (list, tuple)) and state.is_update and orm_target is not None:
            if any(column.key not in parameters for column in primary_columns):
                continue  # The ORM rejects a bulk row without its primary key.
            query = query.where(*(column == parameters[column.key] for column in primary_columns))
        rows.update(tuple(row) for row in state.session.connection().execute(query, parameters).all())
    return rows


def _core_identity_write(state, table):

    from .sql_models import ProjectMember, User

    if table is None or table.name not in {User.__tablename__, ProjectMember.__tablename__}:
        return False
    is_user = table.name == User.__tablename__
    if state.is_insert:
        for value in _insert_rows(state):
            if is_user and value.get("id") and value.get("tenant_id"):
                _identity_scopes(
                    state.session,
                    tenant_ids={value["tenant_id"]},
                    user_ids={value["id"]},
                    trusted=True,
                    include_roster=value.get("role") in {"tenant_admin", "super_admin"},
                )
            elif not is_user and value.get("project_id"):
                _identity_scopes(state.session, project_ids={value["project_id"]})
        return True
    columns = [table.c.id, table.c.tenant_id] if is_user else [table.c.project_id, table.c.user_id]
    rows = _selected_rows(state, columns, columns[: 1 if is_user else 2])
    if is_user:
        transaction = state.session.get_nested_transaction() or state.session.get_transaction()
        state.session.info.setdefault(_IDENTITY_USERS, {}).setdefault(transaction, set()).update(
            row[0] for row in rows
        )
        for user_id, tenant_id in rows:
            _identity_scopes(state.session, tenant_ids={tenant_id}, user_ids={user_id}, trusted=True)
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
        for row in _insert_rows(state):
            if isinstance(row, dict):
                mark_progress(
                    state.session,
                    row.get("tenant_id"),
                    row.get("id") if table.name == Project.__tablename__ else row.get("project_id"),
                )
        return
    project_column = table.c.id if table.name == Project.__tablename__ else table.c.project_id
    primary_column = next(iter(table.primary_key.columns))
    affected = _selected_rows(state, [primary_column, table.c.tenant_id, project_column], [primary_column])
    for _row_id, tenant_id, project_id in affected:
        mark_progress(state.session, tenant_id, project_id)
    if state.is_update and affected:
        transaction = state.session.get_nested_transaction() or state.session.get_transaction()
        state.session.info.setdefault(_CORE_ROWS, {}).setdefault(transaction, {}).setdefault(
            table.name, set()
        ).update(row_id for row_id, _, _ in affected)


def _capture_requirement_definitions(db, project, identity, actor):
    if not identity:
        from .delivery_requirement_history import capture_definitions

        capture_definitions(db, project, actor=actor)


def _before_commit(db):
    from .delivery_progress_capture import record_observation
    from .sql_models import Project, User

    if db.in_nested_transaction() or db.info.get(_BUSY):
        return
    db.flush()
    changed_users = (
        set().union(*db.info.get(_IDENTITY_USERS, {}).values()) if db.info.get(_IDENTITY_USERS) else set()
    )
    if changed_users:
        for user_id, tenant_id in db.connection().execute(
            select(User.id, User.tenant_id).where(User.id.in_(changed_users))
        ):
            _identity_scopes(db, tenant_ids={tenant_id}, user_ids={user_id}, trusted=True)
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
            from contextlib import nullcontext

            from sop_manager.project_write_guard import identity_capture_scope, in_lifecycle_scope

            project = db.get(Project, project_id)
            if not project or project.tenant_id != tenant_id:
                continue
            identity_scopes = set().union(*db.info.get(_TRUSTED_SCOPES, {}).values()) if db.info.get(_TRUSTED_SCOPES) else set()
            identity = (tenant_id, project_id) in identity_scopes
            if in_lifecycle_scope(db, tenant_id, project_id) and not identity:
                from .delivery_progress_facts import evaluate_project
                from .delivery_query_index import replace_from_evaluation

                # Lifecycle has its own audit trail. Refresh disposable query
                # facts in this transaction without inventing a work observation.
                replace_from_evaluation(db, project, evaluate_project(db, project))
                continue
            context = identity_capture_scope(db, tenant_id, project_id) if identity else nullcontext()
            with context:
                record_observation(db, project, actor=actors.get((tenant_id, project_id), ""))
                _capture_requirement_definitions(db, project, identity, actors.get((tenant_id, project_id), ""))
    finally:
        db.info.pop(_BUSY, None)


def _after_commit(db):
    nested = db.get_nested_transaction()
    if nested:
        scopes = db.info.get(_SCOPES, {})
        values = scopes.pop(nested, set())
        if values:
            scopes.setdefault(nested.parent, set()).update(values)
        for key in (_RECORDED, _ACTORS, _RESERVED_VERSIONS, "delivery_collaboration_actor"):
            groups = db.info.get(key, {})
            group = groups.pop(nested, {})
            if group:
                groups.setdefault(nested.parent, {}).update(group)
        core_groups = db.info.get(_CORE_ROWS, {})
        for table_name, ids in core_groups.pop(nested, {}).items():
            core_groups.setdefault(nested.parent, {}).setdefault(table_name, set()).update(ids)
        for key in (_IDENTITY_USERS, _TRUSTED_SCOPES):
            identity_groups = db.info.get(key, {})
            identity_groups.setdefault(nested.parent, set()).update(identity_groups.pop(nested, set()))


def _after_soft_rollback(db, previous):
    if previous.nested:
        db.info.get(_SCOPES, {}).pop(previous, None)
        for key in (_RECORDED, _ACTORS, _CORE_ROWS, _IDENTITY_USERS, _TRUSTED_SCOPES, _RESERVED_VERSIONS, "delivery_collaboration_actor"):
            db.info.get(key, {}).pop(previous, None)


def _after_transaction_end(db, transaction):
    if transaction.parent is None:
        for key in (_SCOPES, _RECORDED, _BUSY, _ACTORS, _CORE_ROWS, _IDENTITY_USERS, _TRUSTED_SCOPES, _RESERVED_VERSIONS, "delivery_collaboration_actor"):
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
