"""Legacy Sprint charts consume durable verified-delivery observations."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone

from sop_manager.routers import sprints
from sop_manager.routers.delivery_progress_facts import capture_facts
from sop_manager.routers.sql_models import DeliveryProgressObservation, Project, Sprint, Task
from test_business_access import env as business_env
from test_business_access import headers

env = business_env


def _dates(sessions, started=None, ends=None):
    now = datetime.now(timezone.utc)
    with sessions() as db:
        sprint = db.get(Sprint, "SPRINT-selected")
        sprint.started_at = (started or now - timedelta(days=3)).replace(tzinfo=None)
        sprint.ends_at = (ends or now + timedelta(days=3)).replace(tzinfo=None)
        db.commit()


def _task(client):
    response = client.post(
        "/api/v1/tasks",
        headers=headers(),
        json={"title": "Sprint work", "sprint_id": "SPRINT-selected", "owner_id": "user:writer"},
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _observe(db, row_id, at, facts):
    db.add(
        DeliveryProgressObservation(
            id=row_id,
            tenant_id="team",
            project_id="selected",
            observed_at=at.replace(tzinfo=None),
            observed_day=at.date().isoformat(),
            source="transaction",
            actor="writer",
            source_version=None,
            fingerprint=row_id,
            data=deepcopy(facts),
        )
    )
    db.flush()


def test_legacy_task_writes_feed_persisted_sprint_history_without_read_writes(env):
    client, sessions = env
    _dates(sessions)
    task_id = _task(client)
    updated = client.patch(f"/api/v1/tasks/{task_id}", headers=headers(), json={"status": "in_progress"})
    assert updated.status_code == 200, updated.text
    with sessions() as db:
        before = db.query(DeliveryProgressObservation).count()
    result = client.get("/api/v1/sprints/SPRINT-selected/burndown", headers=headers())
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["history_available"] is True
    assert body["unit"] == "tasks" and body["remaining_basis"] == "verified_completion"
    assert body["stats"]["in_progress"] == 1
    assert body["current_metrics"]["status_counts"]["in_progress"] == 1
    assert body["actual"][-1]["metrics"]["status_counts"]["in_progress"] == 1
    assert body["actual"][-1]["observation_id"]
    assert body["current_observation"]["source"] == "live"
    assert body["current_observation"]["observation_id"] is None
    with sessions() as db:
        assert db.query(DeliveryProgressObservation).count() == before


def test_canonical_completed_without_acceptance_is_still_unverified_remaining(env):
    client, sessions = env
    _dates(sessions)
    task_id = _task(client)
    with sessions() as db:
        db.get(Task, task_id).status = "completed"
        db.commit()
    body = client.get("/api/v1/sprints/SPRINT-selected/burndown", headers=headers()).json()
    assert body["stats"]["completed"] == 0 and body["stats"]["remaining"] == 1
    assert body["stats"]["recorded_completed"] == 1
    assert body["current_metrics"]["recorded_completed"] == 1
    assert body["current_metrics"]["verified_completed"] == 0
    assert body["actual"][-1]["remaining"] == 1.0


def test_current_live_point_does_not_masquerade_as_persisted_history(env):
    client, sessions = env
    _dates(sessions)
    _task(client)
    with sessions() as db:
        db.query(DeliveryProgressObservation).filter_by(tenant_id="team", project_id="selected").delete()
        db.commit()
    body = client.get("/api/v1/sprints/SPRINT-selected/burndown", headers=headers()).json()
    assert body["history_available"] is False and body["actual"] == []
    assert body["ideal"]
    assert body["current_observation"]["remaining"] == 1.0
    assert body["current_observation"]["observation_id"] is None


def test_utc_daily_last_and_missing_days_use_only_this_sprints_facts(env):
    client, sessions = env
    task_id = _task(client)
    now = datetime(2026, 10, 15, tzinfo=timezone.utc)
    with sessions() as db:
        sprint = db.get(Sprint, "SPRINT-selected")
        # A local Oct 10 start is Oct 11 in UTC.
        sprint.started_at = datetime(2026, 10, 11, 4, 50)
        sprint.ends_at = datetime(2026, 10, 20, 4, 50)
        db.add(Sprint(id="SPRINT-separate", tenant_id="team", project_id="selected", goal="Other scope"))
        db.add(
            Task(
                id="T-separate",
                tenant_id="team",
                project_id="selected",
                title="Other sprint task",
                sprint_id="SPRINT-separate",
            )
        )
        db.commit()
        facts = capture_facts(db, db.get(Project, "selected"))
        db.query(DeliveryProgressObservation).filter_by(tenant_id="team", project_id="selected").delete()
        _observe(db, "sprint-first", datetime(2026, 10, 11, 9), facts)
        last = deepcopy(facts)
        next(task for task in last["tasks"] if task["id"] == task_id).update(
            status="recorded_completed", recorded_status="completed"
        )
        _observe(db, "sprint-last", datetime(2026, 10, 11, 23), last)
        verified = deepcopy(facts)
        next(task for task in verified["tasks"] if task["id"] == task_id).update(
            status="verified_completed", recorded_status="completed"
        )
        _observe(db, "sprint-verified", datetime(2026, 10, 13, 1), verified)
        db.commit()
        result = sprints._burndown_payload(
            sprint, db.query(Task).filter_by(sprint_id=sprint.id).all(), db=db, now=now
        )
    assert [(point["day"], point["remaining"]) for point in result["actual"]] == [(0, 1.0), (2, 0.0)]
    assert result["actual"][0]["observation_id"] == "sprint-last"
    assert result["coverage"]["missing_days"] == ["2026-10-12", "2026-10-14", "2026-10-15"]
    assert result["current_metrics"]["tasks_total"] == 1
    assert result["elapsed_days"] == 4


def test_missing_dates_keep_history_metadata_but_do_not_invent_chart_dates(env):
    client, sessions = env
    _task(client)
    with sessions() as db:
        sprint = db.get(Sprint, "SPRINT-selected")
        sprint.ends_at = None
        db.commit()
    body = client.get("/api/v1/sprints/SPRINT-selected/burndown", headers=headers()).json()
    assert body["actual"] == [] and body["ideal"] == []
    assert body["history_available"] is True
    assert body["current_observation"]["day"] is None
    assert body["current_metrics"]["tasks_total"] == 1


def test_unstarted_sprint_does_not_classify_future_days_as_missing(env):
    client, sessions = env
    now = datetime(2026, 10, 15, tzinfo=timezone.utc)
    _task(client)
    with sessions() as db:
        sprint = db.get(Sprint, "SPRINT-selected")
        sprint.started_at = datetime(2026, 10, 16)
        sprint.ends_at = datetime(2026, 10, 18)
        db.commit()
        result = sprints._burndown_payload(
            sprint, db.query(Task).filter_by(sprint_id=sprint.id).all(), db=db, now=now
        )
    assert result["actual"] == []
    assert result["coverage"]["missing_days"] == []
    assert result["coverage"]["future_days"] == ["2026-10-16", "2026-10-17", "2026-10-18"]
    assert result["current_observation"]["day"] is None


def test_old_sprint_exposes_bounded_window_without_clamping_real_elapsed_days(env):
    client, sessions = env
    now = datetime(2026, 10, 15, tzinfo=timezone.utc)
    _task(client)
    with sessions() as db:
        sprint = db.get(Sprint, "SPRINT-selected")
        sprint.started_at = datetime(2020, 1, 1)
        sprint.ends_at = datetime(2020, 1, 10)
        db.commit()
        result = sprints._burndown_payload(
            sprint, db.query(Task).filter_by(sprint_id=sprint.id).all(), db=db, now=now
        )
    assert result["coverage"]["window_truncated"] is True
    assert result["coverage"]["range"] == {"starts_on": "2025-10-15", "ends_on": "2026-10-15"}
    assert len(result["coverage"]["missing_days"]) <= 366
    assert result["elapsed_days"] > result["span_days"]
