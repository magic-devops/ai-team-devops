"""Query facts refresh atomically, including writes without new progress facts."""

import pytest
from sop_manager.project_write_guard import lifecycle_scope
from sop_manager.routers import sql_models as m
from sqlalchemy import delete, insert, select, update
from test_delivery_progress_capture import sessions as capture_sessions

sessions = capture_sessions


def state(db):
    return db.execute(
        select(m.DeliveryQueryState.generation, m.DeliveryQueryState.summary).where(
            m.DeliveryQueryState.project_id == "project"
        )
    ).one()


def test_metadata_only_changes_refresh_index_before_progress_dedup(sessions):
    with sessions() as db:
        db.add(m.Task(id="T-1", tenant_id="tenant", project_id="project", title="Work"))
        db.commit()
        before = state(db).generation
        count = db.query(m.DeliveryProgressObservation).count()
        db.get(m.Task, "T-1").priority = "P0"
        db.commit()
        assert state(db).generation > before
        assert db.query(m.DeliveryProgressObservation).count() == count


def test_lifecycle_updates_refresh_without_fabricating_observation(sessions):
    with sessions() as db:
        before = state(db).generation
        count = db.query(m.DeliveryProgressObservation).count()
        with lifecycle_scope(db, "tenant", "project"):
            db.get(m.Project, "project").status = "archived"
            db.commit()
        assert state(db).generation > before
        assert db.query(m.DeliveryProgressObservation).count() == count


def test_failed_query_replacement_rolls_back_business_and_observation(sessions, monkeypatch):
    from sop_manager.routers import delivery_query_index

    with sessions() as db:
        before = state(db).generation
        count = db.query(m.DeliveryProgressObservation).count()

        def fail(*args):
            raise RuntimeError("query replacement failed")

        monkeypatch.setattr(delivery_query_index, "replace_from_evaluation", fail)
        db.add(m.Task(id="T-1", tenant_id="tenant", project_id="project", title="Work"))
        with pytest.raises(RuntimeError, match="query replacement failed"):
            db.commit()
        db.rollback()
        assert db.get(m.Task, "T-1") is None
        assert state(db).generation == before
        assert db.query(m.DeliveryProgressObservation).count() == count


def test_core_write_and_savepoint_rollback_keep_query_generation_atomic(sessions):
    with sessions() as db:
        db.add(m.Task(id="T-1", tenant_id="tenant", project_id="project", title="Work"))
        db.commit()
        before = state(db).generation
        nested = db.begin_nested()
        db.execute(update(m.Task).where(m.Task.id == "T-1").values(status="completed"))
        db.flush()
        nested.rollback()
        db.commit()
        assert state(db).generation == before
        db.execute(update(m.Task).where(m.Task.id == "T-1").values(status="completed"))
        db.commit()
        after = state(db)
        assert after.generation > before
        assert after.summary["tasks_done"] == 0
        fact = (
            db.query(m.DeliveryQueryFact).filter_by(project_id="project", kind="task", entity_id="T-1").one()
        )
        assert fact.status == "recorded_completed"


@pytest.mark.parametrize("core", [False, True])
def test_tenant_admin_roster_tracks_identity_without_owned_tasks_or_membership(sessions, core):
    with sessions() as db:
        fields = {
            "id": "admin",
            "tenant_id": "tenant",
            "username": "Original admin",
            "password_hash": "unusable",
            "role": "tenant_admin",
            "status": "active",
        }
        if core:
            db.execute(insert(m.User).values(**fields))
        else:
            db.add(m.User(**fields))
        db.commit()

        def change(**values):
            if core:
                db.execute(update(m.User).where(m.User.id == "admin").values(**values))
            else:
                for key, value in values.items():
                    setattr(db.get(m.User, "admin"), key, value)
            db.commit()

        def roster():
            return db.scalar(
                select(m.DeliveryQueryFact.data).where(
                    m.DeliveryQueryFact.project_id == "project",
                    m.DeliveryQueryFact.kind == "member",
                    m.DeliveryQueryFact.entity_id == "user:admin",
                )
            )

        assert roster()["name"] == "Original admin"
        change(role="developer")
        assert roster() is None
        change(role="tenant_admin")
        assert roster()["name"] == "Original admin"
        change(username="Renamed admin", status="suspended")
        assert roster()["name"] == "Renamed admin" and not roster()["active"]
        change(role="developer")
        assert roster() is None
        change(role="tenant_admin", status="active")
        if core:
            db.execute(delete(m.User).where(m.User.id == "admin"))
        else:
            db.delete(db.get(m.User, "admin"))
        db.commit()
        assert roster() is None
