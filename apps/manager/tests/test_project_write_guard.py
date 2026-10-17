"""Project lifecycle is enforced at the shared application SQL boundary."""

from copy import deepcopy

import pytest
from fastapi import HTTPException
from sop_manager.project_write_guard import (
    ManagerSession,
    identity_capture_scope,
    install_project_write_guard,
    lifecycle_scope,
    lock_project_scopes,
    require_project_operation,
)
from sop_manager.routers import sql_models as m
from sqlalchemy import bindparam, create_engine, delete, insert, select, text, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def guarded():
    install_project_write_guard()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, class_=ManagerSession, expire_on_commit=False)
    with sessions() as db:
        from sop_manager.routers.delivery_service import initial_state
        db.add(m.Tenant(id="tenant", name="Team", slug="team"))
        db.flush()
        unusable_hash = "not-a-login"
        db.add(m.User(id="user", tenant_id="tenant", username="user", password_hash=unusable_hash))
        db.add_all([m.Project(id=pid, tenant_id="tenant", name=pid) for pid in ("active", "archived")])
        db.flush()
        for pid in ("active", "archived"):
            db.add(m.ProjectMember(project_id=pid, user_id="user", role="developer"))
            db.add(m.Task(id="task-" + pid, tenant_id="tenant", project_id=pid, title=pid))
            db.add(m.DeliveryWorkspace(project_id=pid, tenant_id="tenant", version=0, data=initial_state()))
        db.commit()
    # Fixture provisioning is deliberately outside the application Session API.
    with engine.begin() as conn:
        conn.execute(update(m.Project).where(m.Project.id == "archived").values(status="archived"))
    yield sessions, engine
    engine.dispose()


@pytest.mark.parametrize("mode", ["orm", "core", "bound", "batch", "insert", "delete", "member", "workspace"])
def test_archived_writes_are_rejected_before_any_batch_row_is_applied(guarded, mode):
    sessions, _ = guarded
    with sessions() as db:
        with pytest.raises(HTTPException) as raised:
            if mode == "orm":
                db.get(m.Task, "task-archived").title = "changed"
                db.flush()
            elif mode == "core":
                db.execute(update(m.Task).where(m.Task.id == "task-archived").values(title="changed"))
            elif mode == "bound":
                db.execute(update(m.Task.__table__).where(m.Task.id == bindparam("target"))
                           .values(title=bindparam("title_value")), {"target": "task-archived", "title_value": "changed"})
            elif mode == "batch":
                db.execute(update(m.Task), [{"id": "task-active", "title": "changed"},
                                            {"id": "task-archived", "title": "changed"}])
            elif mode == "insert":
                db.execute(insert(m.Issue), [{"id": "i-1", "tenant_id": "tenant", "project_id": "active", "title": "a"},
                                             {"id": "i-2", "tenant_id": "tenant", "project_id": "archived", "title": "b"}])
            elif mode == "delete":
                db.execute(delete(m.Task).where(m.Task.id == "task-archived"))
            elif mode == "member":
                db.delete(db.get(m.ProjectMember, ("archived", "user")))
                db.flush()
            else:
                db.execute(update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "archived")
                           .values(version=1))
        assert raised.value.status_code == 409
        assert raised.value.detail["code"] == "project_archived"
        # Core batches are validated before the first row; no caller rollback is
        # needed to keep a valid first row from being changed by a rejected batch.
        if mode not in {"orm", "member"}:
            assert db.connection().scalar(select(m.Task.title).where(m.Task.id == "task-active")) == "active"
        db.rollback()
        assert db.get(m.Task, "task-archived").title == "archived"


@pytest.mark.parametrize("mode", ["orm", "core", "bound", "primary"])
def test_entity_scope_and_primary_key_are_immutable(guarded, mode):
    sessions, _ = guarded
    with sessions() as db:
        with pytest.raises(HTTPException) as raised:
            if mode == "orm":
                db.get(m.Task, "task-active").project_id = "archived"
                db.flush()
            elif mode == "primary":
                db.execute(update(m.Task).where(m.Task.id == "task-active").values(id="renamed"))
            elif mode == "bound":
                db.execute(update(m.Task.__table__).where(m.Task.id == bindparam("target"))
                           .values(project_id=bindparam("destination")), {"target": "task-active", "destination": "archived"})
            else:
                db.execute(update(m.Task).where(m.Task.id == "task-active").values(project_id="archived"))
        assert raised.value.detail["code"] == "project_scope_immutable"
        db.rollback()


@pytest.mark.parametrize("mode", ["unbounded", "dynamic", "insert_select", "raw", "wrapped_raw", "replace", "or_unbounded"])
def test_unprovable_sql_fails_closed(guarded, mode):
    sessions, _ = guarded
    with sessions() as db:
        with pytest.raises((HTTPException, ValueError)):
            if mode == "unbounded":
                db.execute(update(m.Task).values(title="all"))
            elif mode == "dynamic":
                db.execute(update(m.Task).where(m.Task.title == "active").values(title="changed"))
            elif mode == "insert_select":
                db.execute(insert(m.Task).from_select(["id", "tenant_id", "project_id"],
                                                      select(m.Issue.id, m.Issue.tenant_id, m.Issue.project_id)))
            elif mode == "or_unbounded":
                db.execute(update(m.Task).where((m.Task.id == "task-active") | (m.Task.title == "archived"))
                           .values(title="changed"))
            elif mode == "wrapped_raw":
                db.execute(select(m.Task).from_statement(text("UPDATE tasks SET title='changed' WHERE id='task-archived' RETURNING *")))
            elif mode == "replace":
                db.execute(insert(m.Task).prefix_with("OR REPLACE").values(id="task-archived", tenant_id="tenant", project_id="active", title="escape"))
            else:
                db.execute(text("UPDATE tasks SET title='changed' WHERE id='task-archived'"))
        db.rollback()


@pytest.mark.parametrize("method", ["bulk_save_objects", "bulk_insert_mappings", "bulk_update_mappings"])
def test_legacy_bulk_methods_are_explicitly_retired(guarded, method):
    sessions, _ = guarded
    with sessions() as db:
        args = ([m.Task(id="legacy", tenant_id="tenant", project_id="active")],) if method == "bulk_save_objects" else (m.Task, [{"id": "legacy", "tenant_id": "tenant", "project_id": "active"}])
        with pytest.raises(ValueError, match="Session.execute"):
            getattr(db, method)(*args)


def test_new_project_and_membership_same_flush_and_lock_preserves_metadata(guarded):
    sessions, _ = guarded
    with sessions() as db:
        before = db.get(m.Project, "active").updated_at
        lock_project_scopes(db, [("tenant", "active")])
        db.commit()
        assert db.get(m.Project, "active").updated_at == before
        db.add(m.Project(id="new", tenant_id="tenant", name="New", status="planning"))
        db.add(m.ProjectMember(project_id="new", user_id="user", role="developer"))
        db.commit()
        assert db.get(m.ProjectMember, ("new", "user")) is not None


@pytest.mark.parametrize("kind", ["project", "tenant", "business"])
def test_physical_deletion_cannot_swallow_project_evidence(guarded, kind):
    sessions, engine = guarded
    if kind == "business":
        with engine.begin() as conn:
            conn.execute(insert(m.Business).values(id="business", tenant_id="tenant", name="Business"))
            conn.execute(update(m.Project).where(m.Project.id == "active").values(business_id="business"))
    with sessions() as db:
        model, key = {"project": (m.Project, "active"), "tenant": (m.Tenant, "tenant"),
                      "business": (m.Business, "business")}[kind]
        with pytest.raises(HTTPException):
            db.execute(delete(model).where(model.id == key))
        db.rollback()


def test_lifecycle_scope_is_narrow_and_expires_on_exit(guarded):
    sessions, _ = guarded
    with sessions() as db:
        with lifecycle_scope(db, "tenant", "archived"):
            with pytest.raises(HTTPException):
                db.execute(update(m.Task).where(m.Task.id == "task-archived").values(status="completed"))
            db.execute(update(m.Project).where(m.Project.id == "archived").values(status="paused"))
            db.commit()
        assert db.get(m.Project, "archived").status == "paused"
        with pytest.raises(HTTPException) as raised:
            db.execute(update(m.Project).where(m.Project.id == "archived").values(status="active"))
        assert raised.value.detail["code"] == "project_lifecycle_command_required"


def test_trusted_identity_capture_cannot_edit_business_or_arbitrary_json(guarded):
    sessions, _ = guarded
    with sessions() as db:
        with identity_capture_scope(db, "tenant", "archived"):
            for statement in [update(m.Task).where(m.Task.id == "task-archived").values(title="escape"),
                              update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "archived")
                              .values(data={"flows": {}, "executions": [], "members": [{"id": "escape"}]}, version=1)]:
                with pytest.raises(HTTPException):
                    db.execute(statement)
        db.rollback()


def test_trusted_identity_capture_only_latches_existing_evidence_and_never_revives_it(guarded):
    sessions, engine = guarded
    initial = {"flows": {}, "executions": [{"id": "run", "stale": False}], "members": []}
    with engine.begin() as conn:
        conn.execute(update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "archived").values(data=initial))
    with sessions() as db:
        changed = deepcopy(initial)
        changed["executions"][0].update(stale=True, planning_invalidated=True)
        with identity_capture_scope(db, "tenant", "archived"):
            db.execute(update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "archived")
                       .values(data=changed, version=1))
            with pytest.raises(HTTPException):
                db.execute(update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "archived")
                           .values(data=initial, version=2))
        db.rollback()


def test_global_user_delete_allows_only_its_real_membership_cascade(guarded):
    sessions, _ = guarded
    with sessions() as db:
        db.delete(db.get(m.User, "user"))
        db.commit()
        assert db.get(m.ProjectMember, ("archived", "user")) is None
        assert db.get(m.Project, "archived") is not None


def test_dispatch_requires_active_but_paused_maintenance_remains_available(guarded):
    sessions, engine = guarded
    with engine.begin() as conn:
        conn.execute(update(m.Project).where(m.Project.id == "active").values(status="paused"))
    with sessions() as db:
        require_project_operation(db, "tenant", "active", operation="write")
        with pytest.raises(HTTPException) as raised:
            require_project_operation(db, "tenant", "active", operation="dispatch")
        assert raised.value.detail["code"] == "project_not_active"


@pytest.mark.parametrize("model,values", [
    (m.Requirement, {"title": "Requirement"}), (m.Task, {"title": "Task"}),
    (m.Issue, {"title": "Issue"}), (m.Sprint, {"goal": "Sprint"}),
    (m.DeliveryEvent, {"version": 1, "actor": "actor", "action": "task.create", "data": {}}),
    (m.DeliveryReceipt, {"version": 1, "request_hash": "hash"}),
    (m.DeliveryProgressObservation, {}), (m.DeliveryProgressCheckpoint, {}),
    (m.DeliveryProgressBaseline, {}), (m.DeliveryPlanPreview, {}),
    (m.DeliveryTaskReview, {}), (m.RequirementAssistance, {}),
    (m.WebhookConfig, {"name": "Hook", "url": "https://example.test"}),
])
def test_all_project_scoped_business_tables_share_the_archived_insert_guard(guarded, model, values):
    sessions, _ = guarded
    row = {"tenant_id": "tenant", "project_id": "archived", **values}
    if "id" in model.__table__.c:
        row["id"] = "new-row"
    with sessions() as db:
        with pytest.raises(HTTPException) as raised:
            db.execute(insert(model).values(**row))
        assert raised.value.detail["code"] == "project_archived"


def test_audit_records_rejected_or_unknown_project_requests_without_mutable_escape(guarded):
    sessions, _ = guarded
    with sessions() as db:
        db.add(m.AuditLog(id="audit", tenant_id="tenant", project_id="unknown", action="rejected"))
        db.commit()
        assert db.get(m.AuditLog, "audit").action == "rejected"
        with pytest.raises(HTTPException):
            db.execute(update(m.AuditLog).where(m.AuditLog.id == "audit").values(action="forged"))


def test_restoring_with_lifecycle_token_does_not_authorize_business_edits_in_that_transaction(guarded):
    sessions, _ = guarded
    with sessions() as db:
        with lifecycle_scope(db, "tenant", "archived"):
            db.execute(update(m.Project).where(m.Project.id == "archived").values(status="active"))
            with pytest.raises(HTTPException):
                db.execute(update(m.Task).where(m.Task.id == "task-archived").values(title="escape"))
            db.rollback()
        assert db.get(m.Project, "archived").status == "archived"


def test_lifecycle_and_identity_tokens_expire_on_nested_rollback(guarded):
    sessions, _ = guarded
    with sessions() as db:
        nested = db.begin_nested()
        with lifecycle_scope(db, "tenant", "archived"):
            nested.rollback()
            with pytest.raises(HTTPException):
                db.execute(update(m.Project).where(m.Project.id == "archived").values(status="active"))


@pytest.mark.parametrize("data", [{"flows": [], "executions": []}, {"flows": {}, "executions": [0]},
                                 {"flows": {"r": {"reviews": [0]}}, "executions": []}])
def test_malformed_trusted_workspace_values_fail_closed(guarded, data):
    sessions, _ = guarded
    with sessions() as db:
        with identity_capture_scope(db, "tenant", "archived"):
            with pytest.raises(HTTPException):
                db.execute(update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "archived")
                           .values(data=data, version=1))


def test_postgresql_project_lock_uses_row_lock_compilation():
    from sop_manager.project_write_guard import _project_lock_query
    from sqlalchemy.dialects import postgresql

    statement = _project_lock_query(m.Project.__table__, m.Project.id == "p", "postgresql")
    compiled = str(statement.compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in compiled
    # This is deliberately compilation evidence, not a claim of PG concurrency.


@pytest.mark.parametrize("mode", ["orphan_task", "orphan_member", "relationship_reparent", "alias_status"])
def test_orm_relationship_and_aliased_sql_writes_share_the_same_boundary(guarded, mode):
    sessions, _ = guarded
    with sessions() as db:
        with pytest.raises(HTTPException):
            if mode == "orphan_task":
                project = db.get(m.Project, "archived")
                project.tasks.remove(db.get(m.Task, "task-archived"))
                db.flush()
            elif mode == "orphan_member":
                project = db.get(m.Project, "archived")
                project.members.remove(db.get(m.ProjectMember, ("archived", "user")))
                db.flush()
            elif mode == "relationship_reparent":
                db.get(m.Task, "task-active").project = db.get(m.Project, "archived")
                db.flush()
            else:
                alias = m.Project.__table__.alias("project_target")
                db.execute(update(alias).where(alias.c.id == "archived").values(status="active"))
        db.rollback()
        assert db.get(m.Task, "task-archived") is not None
        assert db.get(m.ProjectMember, ("archived", "user")) is not None
