"""Project locks and fail-closed lifecycle protection for application Session writes.

Direct Engine/Connection migrations are deliberately outside this boundary. SQL
writers must name a finite project or primary-key scope; legacy bulk APIs bypass
Session events and are therefore explicitly unavailable on ManagerSession.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import and_, event, false, inspect, or_, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.sql import operators, visitors
from sqlalchemy.sql.elements import BindParameter, BooleanClauseList, ClauseElement, Grouping, TextClause

_TOKENS = "project_write_guard_tokens"
_FILE_SESSION = ContextVar("project_file_write_session", default=None)


class ManagerSession(Session):
    def bulk_save_objects(self, *args, **kwargs):
        raise ValueError("Use typed Session.execute or ordinary ORM writes instead of legacy bulk_save_objects")

    def bulk_insert_mappings(self, *args, **kwargs):
        raise ValueError("Use typed Session.execute instead of legacy bulk_insert_mappings")

    def bulk_update_mappings(self, *args, **kwargs):
        raise ValueError("Use typed Session.execute instead of legacy bulk_update_mappings")


def _deny(code, message, status=409):
    raise HTTPException(status, {"code": code, "message": message})


def _transaction(db):
    if not db.in_transaction():
        db.begin()
    return db.get_nested_transaction() or db.get_transaction()


@dataclass(frozen=True)
class _Permission:
    transaction: object
    tenant_id: str
    project_id: str
    purpose: str
    original_status: str


def _permission(db, scope, purpose):
    current = db.get_nested_transaction() or db.get_transaction()
    return next((token for token in reversed(db.info.get(_TOKENS, []))
                 if token.transaction is current and (token.tenant_id, token.project_id) == scope
                 and token.purpose == purpose), None)


def _pending_project(db, scope):
    from .routers.sql_models import Project
    return next((row for row in db.new if isinstance(row, Project)
                 and (row.tenant_id, row.id) == scope), None)


def lock_project_scopes(db, scopes):
    """Lock actual Project rows, in stable order, without touching updated_at."""
    from .routers.sql_models import Project

    result = {}
    table = Project.__table__
    connection = db.connection()
    for tenant_id, project_id in sorted(set(scopes)):
        scope = (str(tenant_id), str(project_id))
        pending = _pending_project(db, scope)
        if pending is not None:
            result[scope] = pending.status or "active"
            continue
        predicate = and_(table.c.tenant_id == tenant_id, table.c.id == project_id)
        if connection.dialect.name == "sqlite":
            # The no-op UPDATE upgrades SQLite's transaction to a writer before
            # facts are re-read. Explicit updated_at suppresses Column.onupdate.
            try:
                connection.execute(update(table).where(predicate)
                                   .values(status=table.c.status, updated_at=table.c.updated_at))
            except OperationalError as exc:
                if getattr(exc.orig, "sqlite_errorcode", 0) & 0xFF in {5, 6}:
                    _deny("project_concurrent_write", "Project changed concurrently; reload and retry")
                raise
        query = _project_lock_query(table, predicate, connection.dialect.name)
        status = connection.scalar(query)
        if status is None:
            _deny("project_scope_not_found", "Project does not exist in the specified tenant", 404)
        # Pending lifecycle edits are authoritative even before their ORM flush.
        for row in db.dirty:
            if isinstance(row, Project) and (row.tenant_id, row.id) == scope:
                if inspect(row).attrs.status.history.has_changes():
                    status = row.status
        result[scope] = status
    return result


def _project_lock_query(table, predicate, dialect_name):
    query = select(table.c.status).where(predicate)
    return query if dialect_name == "sqlite" else query.with_for_update()


def require_project_operation(db, tenant_id, project_id, operation="write"):
    """Enforce lifecycle availability; caller still owns authorization checks."""
    if operation not in {"write", "dispatch"}:
        raise ValueError("Unknown project operation")
    scope = (str(tenant_id), str(project_id))
    status = lock_project_scopes(db, [scope])[scope]
    lifecycle = _permission(db, scope, "lifecycle")
    archived = status == "archived" or (lifecycle and lifecycle.original_status == "archived")
    if archived and not (_permission(db, scope, "identity") or lifecycle):
        _deny("project_archived", "Archived projects are read-only; restore the project before editing")
    if operation == "dispatch" and status != "active":
        _deny("project_not_active", "Only an active project can start a new execution")
    return status


@contextmanager
def _scope(db, tenant_id, project_id, purpose):
    scope = (str(tenant_id), str(project_id))
    transaction = _transaction(db)
    status = lock_project_scopes(db, [scope])[scope]
    token = _Permission(transaction, *scope, purpose, status)
    db.info.setdefault(_TOKENS, []).append(token)
    try:
        yield token
    finally:
        tokens = db.info.get(_TOKENS, [])
        if token in tokens:
            tokens.remove(token)


def lifecycle_scope(db, tenant_id, project_id):
    """Internal capability for one lifecycle command, including its commit."""
    return _scope(db, tenant_id, project_id, "lifecycle")


def identity_capture_scope(db, tenant_id, project_id):
    """Internal capability for monotonic invalidation after real User changes."""
    return _scope(db, tenant_id, project_id, "identity")


def in_lifecycle_scope(db, tenant_id, project_id):
    return _permission(db, (str(tenant_id), str(project_id)), "lifecycle") is not None


@contextmanager
def project_file_write_scope(*, tenant_id=None, project_id=None):
    """Serialize a short filesystem mutation with archive, not a second SQL writer."""
    from .path_config import resolved_project_id, resolved_tenant_id
    from .routers.sql_models import SessionLocal

    scope = (tenant_id if tenant_id is not None else resolved_tenant_id(),
             project_id if project_id is not None else resolved_project_id())
    existing = _FILE_SESSION.get()
    if existing:
        if existing[0] != scope:
            raise ValueError("A file mutation cannot change project scope inside another mutation")
        yield
        return
    with SessionLocal() as db:
        context = _FILE_SESSION.set((scope, db))
        try:
            require_project_operation(db, *scope)
            yield
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            _FILE_SESSION.reset(context)


def _name(column):
    return column if isinstance(column, str) else getattr(column, "key", None)


def _literal(value, parameters):
    if isinstance(value, BindParameter):
        if value.callable is not None:
            _deny("project_sql_scope_unproven", "Dynamic SQL parameters cannot prove a project scope", 422)
        if value.key in parameters:
            return parameters[value.key]
        if value.required:
            _deny("project_sql_scope_unproven", "Missing bound parameter for a project write", 422)
        return value.value
    if isinstance(value, ClauseElement):
        _deny("project_sql_scope_unproven", "SQL expressions cannot provide immutable scope values", 422)
    return value


def _anchor(clause, table, parameters):
    """Every OR branch must have a finite target; an AND needs one bound anchor."""
    if isinstance(clause, Grouping):
        return _anchor(clause.element, table, parameters)
    if isinstance(clause, BooleanClauseList):
        values = [_anchor(child, table, parameters) for child in clause.clauses]
        return all(values) if clause.operator is operators.or_ else any(values)
    if getattr(clause, "operator", None) not in {operators.eq, operators.in_op}:
        return False
    left, right = clause.left, clause.right
    column_table = getattr(left, "table", None)
    anchors = {column.key for column in table.primary_key} | {"project_id"}
    if getattr(column_table, "name", None) != table.name or _name(left) not in anchors:
        return False
    if not isinstance(right, BindParameter):
        return False
    value = _literal(right, parameters)
    if clause.operator is operators.in_op:
        return isinstance(value, (list, tuple, set)) and all(isinstance(item, (str, int)) for item in value)
    return isinstance(value, (str, int)) and not isinstance(value, bool)


def _assignments(statement, parameters):
    static = getattr(statement, "_values", None) or dict(getattr(statement, "_ordered_values", None) or [])
    values = dict(parameters)
    for column, value in static.items():
        values[_name(column)] = _assignment_value(statement, column, value, parameters)
    return values


def _assignment_value(statement, column, value, parameters):
    table = _base_table(statement.table)
    immutable = {item.key for item in table.primary_key} | {"id", "tenant_id", "project_id"}
    if table.name == "projects":
        immutable.add("status")
    # Mutable business expressions remain valid inside a proven scope. Their
    # domain guards (for example Task acceptance) still validate their fields.
    if isinstance(value, ClauseElement) and not isinstance(value, BindParameter) and _name(column) not in immutable:
        return value
    return _literal(value, parameters)


def _scope_for_row(db, table, row):
    from .routers.sql_models import Project

    project_id = row.get("id") if table.name == "projects" else row.get("project_id")
    tenant_id = row.get("tenant_id")
    if not project_id and table.name in {"audit_logs", "webhook_configs"}:
        return None
    if not isinstance(project_id, str) or not project_id:
        _deny("project_sql_scope_unproven", "Project writes require an explicit project ID", 422)
    if table.name == "project_members":
        pending = next((p for p in db.new if isinstance(p, Project) and p.id == project_id), None)
        tenant_id = pending.tenant_id if pending else db.connection().scalar(
            select(Project.tenant_id).where(Project.id == project_id))
    if not isinstance(tenant_id, str) or not tenant_id:
        _deny("project_sql_scope_unproven", "Project writes require an explicit tenant ID", 422)
    return tenant_id, project_id


def _monotonic_flag(old, new, key):
    a, b = old.get(key, False), new.get(key, False)
    return isinstance(a, bool) and isinstance(b, bool) and (not a or b)


def _workspace_invalidation(old, new, *, lifecycle=False):
    if not isinstance(old, dict) or not isinstance(new, dict):
        return False
    before, after = deepcopy(old), deepcopy(new)
    if lifecycle:
        before.pop("lifecycle", None)
        after.pop("lifecycle", None)
    if not _release_candidates_invalidation(
        before.pop("release_candidates", []), after.pop("release_candidates", [])
    ):
        return False
    old_entries, new_entries = before.pop("executions", []), after.pop("executions", [])
    if (not isinstance(old_entries, list) or not isinstance(new_entries, list)
            or len(old_entries) != len(new_entries)
            or any(not isinstance(entry, dict) for entry in old_entries + new_entries)):
        return False
    for original, changed in zip(old_entries, new_entries, strict=True):
        a, b = dict(original), dict(changed)
        for key in ("stale", "planning_invalidated", "executor_binding_invalidated"):
            if not _monotonic_flag(a, b, key):
                return False
            a.pop(key, None)
            b.pop(key, None)
        if a != b:
            return False
    old_flows, new_flows = before.pop("flows", {}), after.pop("flows", {})
    if (not isinstance(old_flows, dict) or not isinstance(new_flows, dict)
            or old_flows.keys() != new_flows.keys() or before != after
            or any(not isinstance(flow, dict) for flow in [*old_flows.values(), *new_flows.values()])):
        return False
    return all(_flow_invalidation(original, new_flows[rid]) for rid, original in old_flows.items())


def _release_candidates_invalidation(originals, changes):
    """Identity capture may add terminal invalidation facts, never approve or rewrite."""
    from .routers.delivery_release import INVALIDATION_CODES

    if not isinstance(originals, list) or not isinstance(changes, list) or len(originals) != len(changes):
        return False
    for original, changed in zip(originals, changes, strict=True):
        if not isinstance(original, dict) or not isinstance(changed, dict):
            return False
        if original == changed:
            continue
        if original.get("invalidated", False) is not False or changed.get("invalidated") is not True:
            return False
        reasons = changed.get("invalidated_reasons")
        if (not isinstance(changed.get("invalidated_at"), str) or not changed["invalidated_at"]
                or not isinstance(reasons, list) or not reasons):
            return False
        for reason in reasons:
            if (not isinstance(reason, dict) or set(reason) != {"code", "message", "target"}
                    or reason["code"] not in INVALIDATION_CODES or reason["target"] is not None
                    or not isinstance(reason["message"], str) or not reason["message"]
                    or len(reason["message"]) > 4000):
                return False
        fields = {"invalidated", "invalidated_at", "invalidated_reasons"}
        if {k: v for k, v in original.items() if k not in fields} != {
            k: v for k, v in changed.items() if k not in fields
        }:
            return False
    return True


def _flow_invalidation(original, changed):
    a, b = deepcopy(original), deepcopy(changed)
    aa, ba = a.get("artifacts", []), b.get("artifacts", [])
    if (not isinstance(aa, list) or not isinstance(ba, list) or len(aa) != len(ba)
            or any(not isinstance(artifact, dict) for artifact in aa + ba)):
        return False
    for artifact, updated in zip(aa, ba, strict=True):
        if not _monotonic_flag(artifact, updated, "stale"):
            return False
        artifact.pop("stale", None)
        updated.pop("stale", None)
    if a.get("definition") != b.get("definition"):
        digest = b.get("definition")
        if not isinstance(digest, str) or len(digest) != 64:
            return False
        a.pop("definition", None)
        b.pop("definition", None)
    if a.get("reviews", []) != b.get("reviews", []):
        reviews = b.get("reviews", [])
        old_reviews = a.get("reviews", [])
        if (not isinstance(reviews, list) or not isinstance(old_reviews, list)
                or len(reviews) != len(old_reviews) + 1 or reviews[:-1] != old_reviews
                or not isinstance(reviews[-1], dict)):
            return False
        review = reviews[-1]
        if (set(review) != {"stage", "revision", "decision", "actor", "comment", "at"}
                or review["stage"] != a.get("stage") or review["revision"] != a.get("revision")
                or review["decision"] != "reopen" or review["actor"] != "system"
                or review["comment"] != "Canonical requirement or accepted work changed outside this workbench."
                or not isinstance(review["at"], str) or not review["at"]
                or b.get("revision") != a.get("revision", 0) + 1 or b.get("stage") != "intake"
                or b.get("closed") is not False or "accepted_work" in b or "tested_work" in b):
            return False
        for key in ("reviews", "revision", "stage", "closed", "accepted_work", "tested_work"):
            a.pop(key, None)
            b.pop(key, None)
    if a != b:
        return False
    return True


def _restricted_write(db, table, scope, operation, old, values):
    lifecycle = _permission(db, scope, "lifecycle")
    identity = _permission(db, scope, "identity")
    if lifecycle:
        if table.name == "projects" and operation == "update" and set(values) <= {"status", "updated_at"}:
            status = values.get("status", old.get("status"))
            if isinstance(status, str) and status in {"planning", "active", "paused", "archived"}:
                return True
        if table.name in {"delivery_events", "delivery_receipts"} and operation == "insert":
            return table.name == "delivery_receipts" or values.get("action") == "project.lifecycle"
    if table.name == "delivery_workspaces" and (lifecycle or identity):
        if operation == "insert" and lifecycle:
            from .routers.delivery_service import initial_state
            return _workspace_invalidation(initial_state(), values.get("data", {}), lifecycle=True)
        if operation == "update" and set(values) <= {"data", "version"}:
            version = values.get("version", old["version"])
            return (version in {old["version"], old["version"] + 1}
                    and _workspace_invalidation(old["data"], values.get("data", old["data"]), lifecycle=bool(lifecycle)))
    if identity:
        if table.name == "delivery_progress_observations" and operation == "insert":
            return True
        if table.name == "delivery_task_reviews" and operation == "update":
            return (set(values) <= {"invalidated", "invalidated_at", "invalidated_reason"}
                    and not old["invalidated"] and values.get("invalidated") is True
                    and values.get("invalidated_at") is not None
                    and values.get("invalidated_reason") in {"task_review_task_missing", "task_review_basis_changed"})
    return False


def _check_project_change(db, scope, operation, old, values):
    if operation == "delete":
        _deny("project_delete_forbidden", "Projects must be archived instead of physically deleted")
    if operation == "insert":
        status = values.get("status", "active")
        if not isinstance(status, str) or status not in {"planning", "active", "paused"}:
            _deny("project_initial_status_invalid", "New projects must be planning, active or paused", 422)
        return
    if "status" in values and values["status"] != old.get("status") and not _permission(db, scope, "lifecycle"):
        _deny("project_lifecycle_command_required", "Change project status through project.lifecycle")


def _check_write(db, table, operation, old, values, *, user_cascade=False):
    scope = _scope_for_row(db, table, values if operation == "insert" else old)
    if scope is None:
        return
    if operation == "update":
        immutable = {column.key for column in table.primary_key.columns} | {"id", "tenant_id", "project_id"}
        if any(key in values and values[key] != old.get(key) for key in immutable):
            _deny("project_scope_immutable", "Entity keys and tenant/project scope are immutable")
    if table.name == "projects":
        _check_project_change(db, scope, operation, old, values)
        if operation == "insert":
            return
    if table.name == "audit_logs":
        if operation == "insert":
            return  # Audit also records rejected archived requests and unknown IDs.
        _deny("project_audit_immutable", "Audit facts are append-only")
    status = lock_project_scopes(db, [scope])[scope]
    lifecycle = _permission(db, scope, "lifecycle")
    archived = status == "archived" or (lifecycle and lifecycle.original_status == "archived")
    if archived:
        if user_cascade and table.name == "project_members" and operation == "delete":
            return
        if not _restricted_write(db, table, scope, operation, old, values):
            _deny("project_archived", "Archived projects are read-only; restore the project before editing")


def _scoped(table):
    return table is not None and (table.name == "projects" or "project_id" in table.c)


def _base_table(table):
    while getattr(table, "original", None) is not None:
        table = table.original
    return table


def _parent_delete(db, table, ids):
    from .routers.sql_models import Project
    if not ids:
        return
    connection = db.connection()
    if connection.dialect.name == "sqlite":
        values = {column.key: column for column in table.c if column.onupdate is not None}
        values["id"] = table.c.id
        connection.execute(update(table).where(table.c.id.in_(ids)).values(**values))
    else:
        connection.execute(select(table.c.id).where(table.c.id.in_(ids)).with_for_update()).all()
    column = Project.tenant_id if table.name == "tenants" else Project.business_id
    pending = any(isinstance(row, Project) and getattr(row, column.key) in ids for row in db.new)
    if pending or connection.scalar(select(Project.id).where(column.in_(ids)).limit(1)):
        _deny("project_delete_forbidden", "Parent deletion cannot remove or reparent project evidence")


def _insert_plans(statement, parameters):
    groups = getattr(statement, "_multi_values", ())
    statics = [row for group in groups for row in group] if groups else [None]
    for static in statics:
        if static is None:
            values = _assignments(statement, parameters)
        else:
            if not hasattr(static, "items"):
                _deny("project_sql_scope_unproven", "Inserts require named column values", 422)
            values = {_name(key): _assignment_value(statement, key, value, parameters) for key, value in static.items()}
        yield "insert", {}, values


def _update_values(statement, parameters, table, orm_bulk):
    values = _assignments(statement, parameters)
    if orm_bulk:
        primary_names = {column.key for column in table.primary_key}
        return {key: value for key, value in values.items() if key not in primary_names}
    # WHERE bind parameters are not UPDATE assignments.
    names = {_name(key) for key in (getattr(statement, "_values", None) or {})}
    names.update(_name(key) for key, _ in (getattr(statement, "_ordered_values", None) or []))
    return {key: value for key, value in values.items() if key in (names or table.c)}


def _bounded_rows(state, table, parameters, orm_bulk):
    statement = state.statement
    query = select(table)
    if statement.whereclause is not None:
        query = query.where(statement.whereclause)
    if orm_bulk:
        primary = list(table.primary_key)
        if any(column.key not in parameters for column in primary):
            _deny("project_sql_scope_unproven", "ORM bulk updates require every primary key", 422)
        query = query.where(*(column == parameters[column.key] for column in primary))
    elif not _anchor(statement.whereclause, table, parameters):
        _deny("project_sql_scope_unproven", "Write predicates must name a finite project or primary-key scope", 422)
    return [dict(row) for row in state.session.connection().execute(query, parameters).mappings()]


def _typed_plans(state, table, canonical, orm_bulk, parent):
    batches = list(state.parameters) if isinstance(state.parameters, (list, tuple)) else [state.parameters or {}]
    plans = []
    for parameters in batches:
        if not isinstance(parameters, dict):
            _deny("project_sql_scope_unproven", "Project SQL requires named parameters", 422)
        if state.is_insert:
            plans.extend(_insert_plans(state.statement, parameters))
            continue
        values = _update_values(state.statement, parameters, table, orm_bulk) if state.is_update else {}
        rows = _bounded_rows(state, table, parameters, orm_bulk)
        if parent:
            _parent_delete(state.session, canonical, [row["id"] for row in rows])
        else:
            plans.extend(("update" if state.is_update else "delete", old, values) for old in rows)
    return plans


def _typed_write(state):
    statement, db = state.statement, state.session
    elements = list(visitors.iterate(statement))
    if any(isinstance(element, TextClause) for element in elements):
        # A textual SELECT can hide writable CTEs or multiple statements.
        _deny("project_sql_scope_unproven", "Textual Session statements are unavailable; use typed SQL", 422)
    if any(getattr(element, "is_dml", False) for element in elements if element is not statement):
        _deny("project_sql_scope_unproven", "Nested writable statements cannot prove a project scope", 422)
    if not (state.is_insert or state.is_update or state.is_delete):
        return
    table = getattr(statement, "table", None)
    if table is None:
        _deny("project_sql_scope_unproven", "Cannot establish the write target", 422)
    canonical = _base_table(table)
    parent = state.is_delete and canonical.name in {"tenants", "businesses"}
    if not (_scoped(canonical) or parent):
        return
    if (getattr(statement, "_select_names", None) or getattr(statement, "_post_values_clause", None) is not None
            or getattr(statement, "_prefixes", ())):
        _deny("project_sql_scope_unproven", "INSERT SELECT and conflict writes cannot prove a project scope", 422)
    orm_bulk = state.is_update and isinstance(state.parameters, (list, tuple)) and getattr(table, "_annotations", {}).get("parentmapper")
    plans = _typed_plans(state, table, canonical, orm_bulk, parent)
    scopes = {_scope_for_row(db, canonical, values if operation == "insert" else old)
              for operation, old, values in plans}
    lock_project_scopes(db, [scope for scope in scopes if scope is not None and canonical.name not in {"projects", "audit_logs"}])
    for operation, old, values in plans:
        _check_write(db, canonical, operation, old, values)
    if not state.is_insert and not parent and not orm_bulk:
        # Restrict preselected PK writes against newly inserted phantom rows.
        primary = list(table.primary_key)
        targets = {tuple(old[column.key] for column in primary) for _, old, _ in plans}
        # Fixed scalar predicates work with executemany; expanding IN parameters
        # do not. Keep the same selected-PK fence for every batch parameter row.
        predicate = or_(*(and_(*(column == value for column, value in zip(primary, target, strict=True)))
                          for target in sorted(targets))) if targets else false()
        state.statement = statement.where(predicate)


def _check_relationship_identity(obj, state, table, old):
    immutable = {column.key for column in table.primary_key} | {"id", "tenant_id", "project_id"}
    for relation in state.mapper.relationships:
        if relation.uselist or not state.attrs[relation.key].history.has_changes():
            continue
        related = getattr(obj, relation.key)
        for local, remote in relation.local_remote_pairs:
            if local.table.name == table.name and local.key in immutable:
                target = getattr(related, remote.key) if related is not None else None
                if target != old[local.key]:
                    _deny("project_scope_immutable", "Entity keys and tenant/project scope are immutable")


def _orm_plan(db, obj, deleted, cascade_members):
    table, state = obj.__table__, inspect(obj)
    if obj in db.dirty and obj not in deleted and not db.is_modified(obj, include_collections=False):
        return None
    if obj in deleted and table.name in {"tenants", "businesses"}:
        _parent_delete(db, table, [state.identity[0]])
    if not _scoped(table):
        return None
    if obj in db.new:
        values = {column.key: getattr(obj, column.key) for column in table.c
                  if getattr(obj, column.key) is not None}
        return table, "insert", {}, values, False
    primary = list(table.primary_key.columns)
    old = db.connection().execute(select(table).where(*(column == value for column, value in zip(primary, state.identity, strict=True)))).mappings().first()
    if old is None:
        return None
    if obj not in deleted:
        _check_relationship_identity(obj, state, table, old)
    values = {column.key: getattr(obj, column.key) for column in table.c
              if state.attrs[column.key].history.has_changes()}
    cascade = table.name == "project_members" and tuple(state.identity) in cascade_members
    return table, "delete" if obj in deleted else "update", dict(old), values, cascade


def _before_flush(db, flush_context, instances):
    from .routers.sql_models import ProjectMember, User

    # SQLAlchemy discovers delete-orphan effects during its unit-of-work flush,
    # after before_flush. Inspect relationship history before those hidden
    # DELETEs are emitted, rather than relying on db.deleted alone.
    orphans = {removed for obj in db.dirty for relation in inspect(obj).mapper.relationships
               if relation.cascade.delete_orphan
               for removed in inspect(obj).attrs[relation.key].history.deleted if removed not in db.new}
    deleted = set(db.deleted) | orphans
    deleted_users = {inspect(user).identity[0] for user in deleted if isinstance(user, User)}
    cascade_members = set()
    if deleted_users:
        cascade_members = set(db.connection().execute(select(ProjectMember.project_id, ProjectMember.user_id)
                                                     .where(ProjectMember.user_id.in_(deleted_users))).all())
    plans = [plan for obj in set(db.new) | set(db.dirty) | deleted
             if (plan := _orm_plan(db, obj, deleted, cascade_members)) is not None]
    scopes = {_scope_for_row(db, table, values if operation == "insert" else old)
              for table, operation, old, values, _ in plans
              if table.name != "audit_logs" and not (table.name == "projects" and operation == "insert")}
    lock_project_scopes(db, [scope for scope in scopes if scope is not None])
    for table, operation, old, values, cascade in plans:
        _check_write(db, table, operation, old, values, user_cascade=cascade)


def _transaction_end(db, transaction):
    db.info[_TOKENS] = [token for token in db.info.get(_TOKENS, []) if token.transaction is not transaction]
    if not db.info[_TOKENS]:
        db.info.pop(_TOKENS, None)


def install_project_write_guard():
    for name, callback in [("do_orm_execute", _typed_write), ("before_flush", _before_flush),
                           ("after_transaction_end", _transaction_end)]:
        if not event.contains(Session, name, callback):
            event.listen(Session, name, callback)
