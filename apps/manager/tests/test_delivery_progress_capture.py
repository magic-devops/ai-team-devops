"""Real SQL transactions prove durable observations, rather than synthetic history."""

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sop_manager.routers import sql_models as models
from sqlalchemy import create_engine, delete, insert, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def sessions():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    models.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        db.add(models.Tenant(id="tenant", name="Team", slug="team"))
        db.flush()
        db.add(models.Project(id="project", tenant_id="tenant", name="Product"))
        db.commit()
    yield factory
    engine.dispose()


def observations(db):
    model = getattr(models, "DeliveryProgressObservation", None)
    assert model is not None, "Progress needs independent persistent observations"
    return db.query(model).filter_by(project_id="project").order_by(model.seq).all()


def add_task(db, task_id="T-1", status="pending"):
    db.add(models.Task(id=task_id, tenant_id="tenant", project_id="project", title=task_id, status=status))


def test_committed_changes_append_and_same_day_a_b_a_is_not_lost(sessions):
    with sessions() as db:
        add_task(db)
        db.commit()
        before = len(observations(db))
        task = db.get(models.Task, "T-1")
        task.status = "in_progress"
        db.commit()
        task.status = "pending"
        db.commit()
        rows = observations(db)
        assert len(rows) == before + 2
        assert [r.data["tasks"][0]["status"] for r in rows[-3:]] == ["pending", "in_progress", "pending"]
        assert rows[-1].fingerprint == rows[-3].fingerprint
        assert rows[-1].id != rows[-3].id
        assert rows[-1].observed_day == rows[-3].observed_day


def test_reads_noop_commits_and_rollback_do_not_create_observations(sessions):
    with sessions() as db:
        add_task(db)
        db.commit()
        before = len(observations(db))
        db.query(models.Task).all()
        db.commit()
        task = db.get(models.Task, "T-1")
        task.title = task.title
        db.commit()
        task.status = "completed"
        db.flush()
        db.rollback()
        db.commit()
        assert len(observations(db)) == before
        assert db.get(models.Task, "T-1").status == "pending"


def test_nested_commits_record_only_final_outer_state_and_rollback_drops_nested_state(sessions):
    with sessions() as db:
        add_task(db)
        db.commit()
        before = len(observations(db))
        task = db.get(models.Task, "T-1")
        task.status = "in_progress"
        with db.begin_nested():
            task.title = "Nested committed"
        assert len(observations(db)) == before
        task.status = "blocked"
        db.commit()
        assert len(observations(db)) == before + 1
        assert observations(db)[-1].data["tasks"][0]["status"] == "blocked"
        task.title = "Outer change"
        nested = db.begin_nested()
        task.title = "Rolled back nested"
        db.flush()
        nested.rollback()
        db.commit()
        assert observations(db)[-1].data["tasks"][0]["title"] == "Outer change"
        assert len(observations(db)) == before + 2


def test_core_update_and_delete_capture_effective_same_transaction_state(sessions):
    with sessions() as db:
        add_task(db)
        db.commit()
        before = len(observations(db))
        db.execute(update(models.Task).where(models.Task.id == "T-1").values(status="completed"))
        db.commit()
        assert len(observations(db)) == before + 1
        assert observations(db)[-1].data["tasks"][0]["status"] == "recorded_completed"
        db.execute(delete(models.Task).where(models.Task.id == "T-1"))
        db.commit()
        assert observations(db)[-1].data["tasks"] == []
        assert len(observations(db)) == before + 2


def test_observation_failure_rolls_back_business_transaction(sessions, monkeypatch):
    from sop_manager.routers import delivery_progress_capture

    with sessions() as db:
        before = len(observations(db))

        def fail(*args, **kwargs):
            raise RuntimeError("Cannot preserve progress facts")

        monkeypatch.setattr(delivery_progress_capture, "evaluate_project", fail)
        add_task(db)
        with pytest.raises(RuntimeError, match="preserve progress"):
            db.commit()
        db.rollback()
        assert db.get(models.Task, "T-1") is None
        assert len(observations(db)) == before


def test_daily_checkpoint_is_once_per_real_project_day_and_never_backfills(sessions):
    from sop_manager.routers.delivery_progress_capture import daily_once

    now = datetime(2026, 10, 22, 12, tzinfo=timezone.utc)
    assert daily_once(sessions=sessions, now=now, page_size=1) == 1
    assert daily_once(sessions=sessions, now=now, page_size=1) == 0
    later = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
    assert daily_once(sessions=sessions, now=later, page_size=1) == 1
    with sessions() as db:
        days = [r.observed_day for r in observations(db) if r.source == "daily"]
        assert days == ["2026-10-22", "2026-10-25"]
        assert db.get(models.DeliveryWorkspace, "project") is None
        assert db.query(models.DeliveryEvent).count() == 0


def test_daily_checkpoint_skips_inactive_tenant_and_project_without_stopping_other_projects(sessions):
    from sop_manager.routers.delivery_progress_capture import daily_once

    with sessions() as db:
        db.add(models.Tenant(id="inactive", name="Inactive", slug="inactive", status="suspended"))
        db.flush()
        db.add_all(
            [
                models.Project(id="p-archived", tenant_id="tenant", name="Archived"),
                models.Project(id="p-other", tenant_id="tenant", name="Other"),
                models.Project(id="p-inactive", tenant_id="inactive", name="Inactive tenant"),
            ]
        )
        db.commit()
        # Seed an existing archived project outside application write channels.
        with db.get_bind().begin() as connection:
            connection.execute(
                update(models.Project).where(models.Project.id == "p-archived").values(status="archived")
            )
    now = datetime(2026, 10, 21, tzinfo=timezone.utc)
    assert daily_once(sessions=sessions, now=now, page_size=1) == 2
    with sessions() as db:
        row = models.DeliveryProgressObservation
        assert {r.project_id for r in db.query(row).filter_by(source="daily").all()} == {"project", "p-other"}


def test_rolled_back_manual_observation_does_not_suppress_final_outer_capture(sessions):
    from sop_manager.routers.delivery_progress_capture import record_observation

    with sessions() as db:
        add_task(db)
        db.commit()
        before = len(observations(db))
        task = db.get(models.Task, "T-1")
        task.title = "Outer committed work"
        nested = db.begin_nested()
        record_observation(db, db.get(models.Project, "project"), source="manual", force=True)
        nested.rollback()
        db.commit()
        assert len(observations(db)) == before + 1
        assert observations(db)[-1].data["tasks"][0]["title"] == "Outer committed work"


def test_core_executemany_primary_keys_do_not_create_unrelated_project_observations(sessions):
    with sessions() as db:
        add_task(db)
        db.add(models.Project(id="unrelated", tenant_id="tenant", name="Unrelated"))
        db.flush()
        db.add(models.Task(id="T-other", tenant_id="tenant", project_id="unrelated", title="Other"))
        db.commit()
        row = models.DeliveryProgressObservation
        # An old project may have missed days. Updating another project cannot
        # manufacture a new day's checkpoint for this unrelated one.
        db.query(row).filter_by(project_id="unrelated").update({"observed_day": "2020-01-01"})
        db.commit()
        before = db.query(row).filter_by(project_id="unrelated").count()
        db.execute(update(models.Task), [{"id": "T-1", "status": "in_progress"}])
        db.commit()
        assert observations(db)[-1].data["tasks"][0]["status"] == "in_progress"
        assert db.query(row).filter_by(project_id="unrelated").count() == before


def test_independent_daily_workers_share_one_checkpoint(tmp_path):
    from concurrent.futures import ThreadPoolExecutor

    from sop_manager.routers.delivery_progress_capture import daily_once

    engine = create_engine(
        "sqlite:///" + str(tmp_path / "workers.sqlite"), connect_args={"check_same_thread": False}
    )
    models.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        db.add(models.Tenant(id="tenant", name="Team", slug="team"))
        db.flush()
        db.add(models.Project(id="project", tenant_id="tenant", name="Product"))
        db.commit()
    instant = datetime(2026, 10, 27, tzinfo=timezone.utc)
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(
            workers.map(lambda _: daily_once(sessions=factory, now=instant, page_size=1), range(2))
        )
    assert sum(results) == 1
    with factory() as db:
        assert db.query(models.DeliveryProgressCheckpoint).filter_by(observed_day="2026-10-27").count() == 1
        assert db.query(models.DeliveryProgressObservation).filter_by(observed_day="2026-10-27").count() == 1
    engine.dispose()


def test_core_insert_is_captured_without_an_orm_dirty_object(sessions):
    with sessions() as db:
        before = len(observations(db))
        db.execute(
            insert(models.Task).values(
                id="core-task", tenant_id="tenant", project_id="project", title="Core inserted"
            )
        )
        db.commit()
        assert len(observations(db)) == before + 1
        assert observations(db)[-1].data["tasks"][0]["id"] == "core-task"


def test_legacy_writes_never_borrow_actor_from_an_earlier_delivery_event(sessions):
    with sessions() as db:
        add_task(db)
        db.add(
            models.DeliveryEvent(
                id="event-old",
                project_id="project",
                tenant_id="tenant",
                version=1,
                actor="previous-reviewer",
                action="task.create",
                data={},
            )
        )
        db.commit()
        assert observations(db)[-1].actor == "previous-reviewer"
        db.get(models.Task, "T-1").status = "in_progress"
        db.commit()
        assert observations(db)[-1].actor == ""


def test_compatibility_table_and_sync_writers_are_observed(sessions, monkeypatch):
    from sop_manager.routers import db_sql_compat, sync_api

    monkeypatch.setattr(db_sql_compat, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(db_sql_compat, "resolved_project_id", lambda: "project")
    monkeypatch.setattr(sync_api, "_require_scope", lambda: "project")
    monkeypatch.setattr(sync_api, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(sync_api, "_ws_sync_event", lambda *args: None)
    with sessions() as db:
        table = db_sql_compat._SqlTable(models.Task, db)
        table.add([{"id": "old-api", "title": "Old task"}])
        assert observations(db)[-1].data["tasks"][0]["title"] == "Old task"
        table.update("id = 'old-api'", {"status": "in_progress"})
        assert observations(db)[-1].data["tasks"][0]["status"] == "in_progress"
        table.delete("id = 'old-api'")
        assert observations(db)[-1].data["tasks"] == []
        from event_handoff_support import direct_sync

        assert (
            direct_sync(db, "project", record={"id": "synced", "title": "Synced task"})["processing"]["state"]
            == "processed"
        )
        assert observations(db)[-1].data["tasks"][0]["title"] == "Synced task"
        assert (
            direct_sync(db, "project", action="delete", record={"id": "synced"})["processing"]["state"]
            == "processed"
        )
        assert observations(db)[-1].data["tasks"] == []


@pytest.mark.parametrize("writer", ["core", "bulk", "orm", "expired_orm"])
@pytest.mark.parametrize("other_tenant", [False, True])
def test_task_scope_move_is_rejected_without_changing_data_or_observations(sessions, writer, other_tenant):
    with sessions() as db:
        target_tenant = "target-tenant" if other_tenant else "tenant"
        if other_tenant:
            db.add(models.Tenant(id=target_tenant, name="Target", slug="target"))
            db.flush()
        db.add(models.Project(id="target-project", tenant_id=target_tenant, name="Target"))
        add_task(db)
        db.commit()
        model = models.DeliveryProgressObservation
        before = {
            pid: db.query(model).filter_by(project_id=pid).count() for pid in ("project", "target-project")
        }
        changes = {"project_id": "target-project", "tenant_id": target_tenant}
        with pytest.raises(HTTPException) as raised:
            if writer == "core":
                db.execute(
                    update(models.Task).where(models.Task.id == "T-1").values(**changes),
                    execution_options={"synchronize_session": False},
                )
            elif writer == "bulk":
                db.execute(update(models.Task), [{"id": "T-1", **changes}])
            else:
                task = db.get(models.Task, "T-1")
                if writer == "expired_orm":
                    db.expire(task, ["project_id", "tenant_id"])
                task.project_id, task.tenant_id = changes["project_id"], changes["tenant_id"]
            db.commit()
        assert raised.value.detail["code"] == "project_scope_immutable"
        db.rollback()
        assert (db.get(models.Task, "T-1").tenant_id, db.get(models.Task, "T-1").project_id) == (
            "tenant",
            "project",
        )
        for pid, tenant in (("project", "tenant"), ("target-project", target_tenant)):
            rows = db.query(model).filter_by(project_id=pid, tenant_id=tenant).order_by(model.seq).all()
            assert len(rows) == before[pid]


def test_core_workspace_updates_use_project_primary_key_and_capture_final_data(sessions):
    from sop_manager.routers.delivery_service import initial_state

    with sessions() as db:
        db.add(
            models.DeliveryWorkspace(
                project_id="project", tenant_id="tenant", data=initial_state(), version=0
            )
        )
        db.commit()
        before = len(observations(db))
        data = initial_state()
        data["project"] = {"starts_on": "2026-10-17", "ends_on": "2026-10-31"}
        db.execute(
            update(models.DeliveryWorkspace)
            .where(models.DeliveryWorkspace.project_id == "project")
            .values(data=data, version=1),
            execution_options={"synchronize_session": False},
        )
        db.commit()
        assert len(observations(db)) == before + 1
        assert observations(db)[-1].data["project"]["ends_on"] == "2026-10-31"
