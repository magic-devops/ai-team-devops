"""Short history queries must not materialize lifetime task snapshots."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone

from sop_manager.routers.delivery_progress import sprint_burndown_history
from sop_manager.routers.delivery_progress_query import progress
from sop_manager.routers.delivery_service import initial_state
from sop_manager.routers.sql_models import DeliveryProgressObservation, DeliveryWorkspace, Project, Sprint
from sqlalchemy import event
from test_delivery_progress_api import _facts, _observe
from test_delivery_workbench import env as delivery_env

env = delivery_env


def _read(sessions, callback):
    loaded, statements = [], []
    with sessions() as db:

        def object_loaded(session, instance):
            if isinstance(instance, DeliveryProgressObservation):
                loaded.append(instance.id)

        def sql_executed(connection, cursor, statement, parameters, context, executemany):
            if "delivery_progress_observations" in statement:
                statements.append(statement)

        event.listen(db, "loaded_as_persistent", object_loaded)
        event.listen(db.bind, "before_cursor_execute", sql_executed)
        try:
            body = callback(db, db.get(Project, "project"))
        finally:
            event.remove(db.bind, "before_cursor_execute", sql_executed)
    return body, loaded, statements


def test_one_day_project_loads_only_daily_latest_snapshot_and_aggregates_lifetime_coverage(env):
    _, sessions, _ = env
    today = datetime.now(timezone.utc).date()
    old = today - timedelta(days=500)
    with sessions() as db:
        db.query(DeliveryProgressObservation).delete()
        for index in range(250):
            _observe(
                db,
                f"out-of-range-{index}",
                datetime.combine(old - timedelta(days=index), datetime.min.time()),
            )
        for index in range(205):
            _observe(
                db,
                f"daily-change-{index}",
                datetime.combine(today, datetime.min.time()),
                _facts(f"Version {index}"),
            )
        db.commit()
    body, loaded, statements = _read(
        sessions, lambda db, project: progress(db, project, starts_on=today, ends_on=today)
    )
    assert body["days"][0]["observation_id"] == "daily-change-204"
    assert loaded == ["daily-change-204"]
    assert body["coverage"]["first_observed_at"].startswith((old - timedelta(days=249)).isoformat())
    assert body["coverage"]["last_observed_at"].startswith(today.isoformat())
    assert any("min(" in statement.lower() and "max(" in statement.lower() for statement in statements)
    assert any("row_number()" in statement.lower() for statement in statements)


def test_named_scope_uses_light_projection_and_last_valid_scope_point_after_deletion(env):
    _, sessions, _ = env
    today = datetime.now(timezone.utc).date()
    with sessions() as db:
        state = initial_state()
        state["milestones"] = [
            {"id": "milestone-history", "title": "Current milestone", "starts_on": None, "ends_on": None}
        ]
        db.add(DeliveryWorkspace(project_id="project", tenant_id="tenant", data=state, version=0))
        db.commit()
        db.query(DeliveryProgressObservation).delete()
        absent = deepcopy(_facts())
        absent["scopes"]["milestones"] = []
        absent["tasks"] = []
        absent["requirements"] = []
        for index in range(300):
            _observe(
                db,
                f"before-scope-{index}",
                datetime.combine(today - timedelta(days=500 + index), datetime.min.time()),
                absent,
            )
        first_day = today - timedelta(days=450)
        _observe(db, "scope-first", datetime.combine(first_day, datetime.min.time()))
        _observe(db, "scope-last-valid", datetime.combine(today, datetime.min.time()) + timedelta(hours=9))
        for index in range(300):
            _observe(
                db,
                f"scope-deleted-{index}",
                datetime.combine(today, datetime.min.time()) + timedelta(hours=10, seconds=index),
                absent,
            )
        db.commit()
    body, loaded, statements = _read(
        sessions,
        lambda db, project: progress(
            db, project, starts_on=today, ends_on=today, scope="milestone", scope_id="milestone-history"
        ),
    )
    assert body["days"][0]["observation_id"] == "scope-last-valid"
    assert body["days"][0]["metrics"]["tasks_total"] == 1
    assert loaded == ["scope-last-valid"]
    assert body["coverage"]["first_observed_at"].startswith(first_day.isoformat())
    assert body["coverage"]["last_observed_at"].endswith("T09:00:00Z")
    projections = [statement for statement in statements if "progress_scope_projection" in statement]
    assert projections and all("JSON_EXTRACT" in statement for statement in projections)
    assert any("LIMIT" in statement for statement in projections)


def test_legacy_sprint_reuses_bounded_snapshot_loading_for_long_history(env):
    _, sessions, _ = env
    today = datetime.now(timezone.utc).date()
    started = datetime.combine(today - timedelta(days=1), datetime.min.time())
    ends = datetime.combine(today + timedelta(days=1), datetime.min.time())
    with sessions() as db:
        db.add(
            Sprint(
                id="SPRINT-bounded",
                tenant_id="tenant",
                project_id="project",
                goal="Bounded sprint",
                started_at=started,
                ends_at=ends,
            )
        )
        db.commit()
        db.query(DeliveryProgressObservation).delete()
        facts = _facts()
        facts["scopes"]["sprints"] = [
            {
                "id": "SPRINT-bounded",
                "title": "Bounded sprint",
                "starts_on": started.date().isoformat(),
                "ends_on": ends.date().isoformat(),
            }
        ]
        facts["tasks"][0]["sprint_id"] = "SPRINT-bounded"
        facts["requirements"][0]["sprint_id"] = "SPRINT-bounded"
        for index in range(250):
            _observe(
                db,
                f"old-sprint-{index}",
                datetime.combine(today - timedelta(days=500 + index), datetime.min.time()),
                facts,
            )
        _observe(db, "current-sprint", datetime.combine(today, datetime.min.time()), facts)
        db.commit()
    body, loaded, statements = _read(
        sessions,
        lambda db, project: sprint_burndown_history(db, db.get(Sprint, "SPRINT-bounded"), started, ends),
    )
    assert body["actual"][0]["observation_id"] == "current-sprint"
    assert loaded == ["current-sprint"]
    assert body["history_available"] is True
    assert any("progress_scope_projection" in statement for statement in statements)
