"""Progress reads retain real UTC observations without manufacturing missing history."""

from datetime import datetime, timedelta, timezone

from sop_manager.routers.auth_sql import current_user
from sop_manager.routers.sql_models import DeliveryEvent, DeliveryReceipt, DeliveryWorkspace, Project, Tenant
from test_delivery_workbench import command, requirement
from test_delivery_workbench import env as delivery_env

env = delivery_env


def _models():
    from sop_manager.routers.sql_models import DeliveryProgressBaseline, DeliveryProgressObservation

    return DeliveryProgressObservation, DeliveryProgressBaseline


def _facts(title="Historical task", status="pending"):
    return {
        "project": {"id": "project", "name": "Product", "starts_on": None, "ends_on": None},
        "tasks": [
            {
                "id": "TASK-history",
                "title": title,
                "req_id": "REQ-history",
                "sprint_id": "",
                "milestone_id": "milestone-history",
                "owner_id": "user:lead",
                "assigned_to": "lead",
                "estimate": "M",
                "starts_on": None,
                "ends_on": None,
                "basis": "a" * 64,
                "status": status,
                "recorded_status": "completed" if status.endswith("completed") else status,
            }
        ],
        "requirements": [
            {
                "id": "REQ-history",
                "title": "Historical requirement",
                "milestone_id": "milestone-history",
                "sprint_id": "",
                "stage": "planning",
                "revision": 1,
                "basis": "b" * 64,
                "accepted": False,
                "released": False,
            }
        ],
        "scopes": {
            "milestones": [
                {"id": "milestone-history", "title": "Deleted milestone", "starts_on": None, "ends_on": None}
            ],
            "sprints": [],
        },
    }


def _observe(db, public_id, at, facts=None, project_id="project", tenant_id="tenant"):
    observation, _ = _models()
    row = observation(
        id=public_id,
        project_id=project_id,
        tenant_id=tenant_id,
        observed_day=at.date().isoformat(),
        observed_at=at.replace(tzinfo=None),
        source="manual",
        actor="lead",
        source_version=1,
        fingerprint=public_id,
        data=facts or _facts(),
    )
    db.add(row)
    db.flush()
    return row


def test_progress_get_is_pure_and_has_no_manufactured_initial_history(env):
    client, sessions, _ = env
    with sessions() as db:
        # Simulate a pre-existing project whose history predates this feature.
        db.query(_models()[0]).delete()
        db.commit()
    response = client.get("/api/v1/delivery/progress")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["project_id"] == "project" and body["version"] == 0
    assert body["timezone"] == "UTC" and body["scope"]["kind"] == "project"
    assert body["current"]["metrics"]["tasks_total"] == 0
    assert len(body["days"]) == 30 and all(point["metrics"] is None for point in body["days"])
    assert body["coverage"]["first_observed_at"] is None
    assert body["baselines"] == [] and body["baseline"] is None and body["ideal"] == []
    with sessions() as db:
        for model in (*_models(), DeliveryWorkspace, DeliveryEvent, DeliveryReceipt):
            assert db.query(model).count() == 0


def test_daily_series_selects_latest_actual_observation_and_retains_gaps(env):
    client, sessions, _ = env
    today = datetime.now(timezone.utc).date()
    first = today - timedelta(days=2)
    with sessions() as db:
        db.query(_models()[0]).delete()
        _observe(db, "observation-first", datetime.combine(first, datetime.min.time()), _facts("First"))
        _observe(
            db,
            "observation-latest",
            datetime.combine(first, datetime.max.time()),
            _facts("Latest", "recorded_completed"),
        )
        db.commit()
    result = client.get(
        "/api/v1/delivery/progress",
        params={"starts_on": first.isoformat(), "ends_on": (today + timedelta(days=1)).isoformat()},
    )
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["days"][0]["observation_id"] == "observation-latest"
    assert body["days"][0]["metrics"]["recorded_completed"] == 1
    assert body["days"][0]["metrics"]["verified_completed"] == 0
    assert all(point["metrics"] is None for point in body["days"][1:])
    assert body["coverage"]["observed_days"] == [first.isoformat()]
    assert body["coverage"]["missing_days"] == [(today - timedelta(days=1)).isoformat(), today.isoformat()]
    assert body["coverage"]["future_days"] == [(today + timedelta(days=1)).isoformat()]
    assert body["current"]["tasks"] == []


def test_history_is_independent_of_two_hundred_event_window_and_tie_uses_sequence(env):
    client, sessions, _ = env
    at = datetime(2026, 1, 1, 10, 0)
    with sessions() as db:
        for index in range(205):
            _observe(db, f"observation-{index}", at, _facts(f"Task {index}"))
        db.commit()
    body = client.get(
        "/api/v1/delivery/progress", params={"starts_on": "2026-01-01", "ends_on": "2026-01-01"}
    ).json()
    assert body["days"][0]["observation_id"] == "observation-204"
    detail = client.get("/api/v1/delivery/progress/observations/observation-0")
    assert detail.status_code == 200 and detail.json()["current"]["tasks"][0]["title"] == "Task 0"


def test_observation_scope_uses_frozen_facts_even_after_scope_deleted(env):
    client, sessions, _ = env
    with sessions() as db:
        _observe(db, "observation-deleted-scope", datetime(2026, 1, 1, 10, 0))
        db.commit()
    result = client.get(
        "/api/v1/delivery/progress/observations/observation-deleted-scope",
        params={"scope": "milestone", "scope_id": "milestone-history"},
    )
    assert result.status_code == 200, result.text
    assert result.json()["scope"]["label"] == "Deleted milestone"
    assert result.json()["current"]["task_ids"] == ["TASK-history"]
    assert (
        client.get("/api/v1/delivery/progress?scope=milestone&scope_id=milestone-history").status_code == 404
    )


def test_invalid_ranges_and_scope_inputs_are_explicit(env):
    client, _, _ = env
    for params in (
        {"starts_on": "invalid"},
        {"starts_on": "2026-02-30"},
        {"starts_on": "2026-03-01", "ends_on": "2026-02-28"},
        {"starts_on": "2025-01-01", "ends_on": "2026-01-02"},
        {"scope": "unknown"},
        {"scope": "milestone"},
        {"scope": "project", "scope_id": "other"},
    ):
        response = client.get("/api/v1/delivery/progress", params=params)
        assert response.status_code == 422, (params, response.text)


def test_project_access_and_resource_scope_are_checked_on_every_read(env):
    client, sessions, actor = env
    assert client.get("/api/v1/delivery/progress", headers={"X-Project-Id": ""}).status_code == 400
    with sessions() as db:
        _observe(db, "foreign-project-observation", datetime(2026, 1, 1), project_id="other")
        db.add(Tenant(id="foreign-tenant", name="Foreign", slug="foreign"))
        db.flush()
        db.add(Project(id="foreign-project", tenant_id="foreign-tenant", name="Foreign"))
        db.flush()
        _observe(
            db,
            "foreign-tenant-observation",
            datetime(2026, 1, 1),
            project_id="foreign-project",
            tenant_id="foreign-tenant",
        )
        db.commit()
    assert client.get("/api/v1/delivery/progress/observations/foreign-project-observation").status_code == 404
    assert client.get("/api/v1/delivery/progress/observations/foreign-tenant-observation").status_code == 404
    assert client.get("/api/v1/delivery/progress/observations/missing").status_code == 404
    assert (
        client.get("/api/v1/delivery/progress", headers={"X-Project-Id": "foreign-project"}).status_code
        == 403
    )
    actor["id"] = "reader"
    assert client.get("/api/v1/delivery/progress").status_code == 200
    assert client.get("/api/v1/delivery/progress", headers={"X-Project-Id": "other"}).status_code == 403
    client.app.dependency_overrides.pop(current_user)
    assert client.get("/api/v1/delivery/progress").status_code == 401


def test_manual_record_requires_write_cas_and_exact_replay(env):
    client, sessions, actor = env
    observation, _ = _models()
    with sessions() as db:
        before = db.query(observation).count()
    first = command(client, "progress.record", {}, key="manual-record-progress", version=0)
    assert first.status_code == 200, first.text
    with sessions() as db:
        count = db.query(observation).count()
        assert count == before + 1
        row = db.query(observation).filter_by(project_id="project").order_by(observation.seq.desc()).first()
        assert row.source == "manual" and row.source_version == 1
    replay = command(client, "progress.record", {}, key="manual-record-progress", version=0)
    assert replay.status_code == 200 and replay.json()["replayed"] is True
    assert command(client, "progress.record", {}, key="stale-manual-record", version=0).status_code == 409
    assert command(client, "progress.record", {"observed_day": "2020-01-01"}).status_code == 422
    actor["id"] = "reader"
    assert command(client, "progress.record", {}).status_code == 403
    with sessions() as db:
        assert db.query(observation).count() == count


def test_current_task_facts_use_real_business_rows(env):
    client, _, _ = env
    rid = requirement(client)
    created = command(
        client, "task.create", {"requirement_id": rid, "title": "Current task", "owner_id": "user:lead"}
    )
    assert created.status_code == 200
    body = client.get("/api/v1/delivery/progress").json()
    assert body["current"]["tasks"][0]["title"] == "Current task"
    assert body["current"]["metrics"]["tasks_total"] == 1
    assert body["current"]["metrics"]["verified_completed"] == 0


def test_daily_latest_uses_observed_time_then_sequence_not_insertion_only(env):
    client, sessions, _ = env
    with sessions() as db:
        _observe(db, "observed-at-noon", datetime(2026, 1, 1, 12), _facts("Noon"))
        _observe(db, "late-inserted-older-time", datetime(2026, 1, 1, 11), _facts("Earlier"))
        db.commit()
    body = client.get(
        "/api/v1/delivery/progress", params={"starts_on": "2026-01-01", "ends_on": "2026-01-01"}
    ).json()
    assert body["days"][0]["observation_id"] == "observed-at-noon"


def test_missing_legacy_estimate_remains_missing_in_live_and_frozen_facts(env):
    client, sessions, _ = env
    from sop_manager.routers.sql_models import Task

    with sessions() as db:
        db.add(Task(id="TASK-no-estimate", project_id="project", tenant_id="tenant", title="Legacy task"))
        db.commit()
        db.get(Task, "TASK-no-estimate").estimate = None
        db.commit()
    response = client.get("/api/v1/delivery/progress")
    assert response.status_code == 200, response.text
    current = response.json()["current"]
    assert current["tasks"][0]["estimate"] is None
    frozen = command(
        client,
        "baseline.create",
        {"title": "Unestimated legacy scope", "task_ids": current["task_ids"], "basis": current["basis"]},
    )
    assert frozen.status_code == 200, frozen.text
