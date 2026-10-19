"""Bounded attention reads preserve real completion, audience, and UTC coverage."""

import re
from datetime import datetime, timedelta, timezone

import pytest
from sop_manager.routers import sql_models as m
from sop_manager.routers.delivery_service import initial_state
from sqlalchemy import event, select, update
from test_delivery_execution import bridge as delivery_bridge
from test_delivery_execution import finish, queue, sync
from test_delivery_workbench import env as delivery_env

env = delivery_env
bridge = delivery_bridge


def seed(sessions):
    today = datetime.now(timezone.utc).date()
    rows = [
        ("A", "user:lead", "pending", "P2", 2),
        ("B", "user:reader", "pending", "P1", -2),
        ("C", "user:lead", "completed", "P1", None),
        ("D", "", "pending", "P0", None),
        ("E", "user:lead", "blocked", "P0", -3),
        ("F", "user:lead", "pending", "P1", 1),
        ("G", "user:lead", "pending", "P1", 1),
    ]
    state = initial_state()
    for tid, _, _, _, due in rows:
        state["task_details"][tid] = {
            "ends_on": (today + timedelta(days=due)).isoformat() if due is not None else None
        }
    with sessions() as db:
        db.add(m.DeliveryWorkspace(project_id="project", tenant_id="tenant", version=0, data=state))
        db.add_all(
            [
                m.Task(
                    id=tid,
                    tenant_id="tenant",
                    project_id="project",
                    title=tid,
                    owner_id=owner,
                    status=status,
                    priority=priority,
                    acceptance_criteria=["Requested behavior is present"],
                )
                for tid, owner, status, priority, _ in rows
            ]
        )
        db.commit()


def get(client, **params):
    response = client.get("/api/v1/delivery/inbox", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_recorded_manual_delivery_remains_actionable_until_real_acceptance(env):
    client, sessions, _ = env
    seed(sessions)
    body = get(client, category="acceptance")
    assert [row["resource_id"] for row in body["items"]] == ["C"]
    item = body["items"][0]
    assert item["status"] == "recorded_completed"
    assert item["acceptance_kind"] == "manual"
    current = client.get("/api/v1/delivery/tasks/C/review-current").json()
    assert current["current"]["can_accept"]
    saved = client.post(
        "/api/v1/delivery/commands",
        json={
            "action": "task.manual_review",
            "payload": {
                "task_id": "C",
                "decision": "accept",
                "basis": current["current"]["basis"],
                "comment": "Inspected delivery",
                "evidence_content": "Requested behavior was checked",
            },
            "expected_version": current["version"],
            "idempotency_key": "attention-manual-accept",
        },
    )
    assert saved.status_code == 200, saved.text
    assert get(client, category="acceptance")["items"] == []


def test_scope_counts_are_complete_while_category_and_sql_pages_are_bounded(env):
    client, sessions, _ = env
    seed(sessions)
    first = get(client, scope="team", limit=2)
    assert first["counts"] == {
        "work": 6,
        "approval": 0,
        "acceptance": 1,
        "blocked": 1,
        "overdue": 2,
        "total": 7,
    }
    assert [row["resource_id"] for row in first["items"]] == ["E", "B"]
    assert first["total"] == 7 and first["limit"] == 2 and first["has_more"]
    second = get(client, scope="team", limit=2, cursor=first["next_cursor"])
    assert not {row["id"] for row in first["items"]} & {row["id"] for row in second["items"]}
    filtered = get(client, scope="team", category="acceptance", limit=1)
    assert filtered["counts"] == first["counts"]
    assert filtered["total"] == 1 and [row["resource_id"] for row in filtered["items"]] == ["C"]
    assert filtered["query_generation"] == first["query_generation"]


def test_mine_requires_real_active_human_ownership_and_current_permission(env):
    client, sessions, actor = env
    seed(sessions)
    actor["id"] = "reader"
    mine = get(client)
    assert [row["resource_id"] for row in mine["items"]] == ["B"]
    assert get(client, scope="team")["counts"]["total"] == 7
    with sessions() as db:
        db.get(m.User, "reader").status = "inactive"
        db.commit()
    actor["id"] = "lead"
    assert "B" not in [row["resource_id"] for row in get(client)["items"]]


def test_cursor_cannot_move_between_scope_category_limit_or_actor(env):
    client, sessions, actor = env
    seed(sessions)
    token = get(client, scope="team", limit=1)["next_cursor"]
    for params in (
        {"scope": "mine", "limit": 1},
        {"scope": "team", "category": "blocked", "limit": 1},
        {"scope": "team", "limit": 2},
    ):
        assert client.get("/api/v1/delivery/inbox", params={**params, "cursor": token}).status_code == 422
    actor["id"] = "reader"
    assert (
        client.get(
            "/api/v1/delivery/inbox", params={"scope": "team", "limit": 1, "cursor": token}
        ).status_code
        == 422
    )


def test_changed_generation_and_utc_day_make_old_pages_explicitly_stale(env, monkeypatch):
    client, sessions, _ = env
    seed(sessions)
    first = get(client, scope="team", limit=1)
    with sessions() as db:
        db.get(m.Task, "A").title = "Updated A"
        db.commit()
    stale = client.get(
        "/api/v1/delivery/inbox", params={"scope": "team", "limit": 1, "cursor": first["next_cursor"]}
    )
    assert stale.status_code == 409
    import sop_manager.routers.delivery_inbox_query as module

    current = datetime.now(timezone.utc)
    monkeypatch.setattr(module, "_now", lambda: current)
    today = get(client, scope="team", limit=1)
    monkeypatch.setattr(module, "_now", lambda: current + timedelta(days=1))
    midnight = client.get(
        "/api/v1/delivery/inbox", params={"scope": "team", "limit": 1, "cursor": today["next_cursor"]}
    )
    assert midnight.status_code == 409


@pytest.mark.parametrize("path", ["/api/v1/delivery/inbox", "/api/v1/delivery/progress/summary"])
def test_missing_or_old_index_requires_explicit_rebuild_without_get_writes(env, path):
    client, sessions, _ = env
    with sessions() as db:
        db.connection().execute(m.DeliveryQueryFact.__table__.delete())
        db.connection().execute(m.DeliveryQueryState.__table__.delete())
        db.commit()
    assert client.get(path).status_code == 409
    seed(sessions)
    with sessions() as db:
        db.connection().execute(update(m.DeliveryQueryState).values(schema_version=1))
        db.commit()
    assert client.get(path).status_code == 409
    with sessions() as db:
        assert db.scalar(select(m.DeliveryQueryState.schema_version)) == 1


def test_attention_gets_never_load_full_business_or_history_json_and_do_not_write(env):
    client, sessions, _ = env
    seed(sessions)
    sql = []

    def record(c, cursor, statement, parameters, context, many):
        sql.append(statement)

    engine = sessions.kw["bind"]
    event.listen(engine, "before_cursor_execute", record)
    try:
        get(client, scope="team", limit=1)
        response = client.get("/api/v1/delivery/progress/summary")
        assert response.status_code == 200, response.text
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert not any(
        re.search(
            r"(?:select|,)\s+(?:delivery_workspaces|delivery_progress_observations)\.data(?:\s|,|$)",
            q.lower(),
        )
        for q in sql
    )
    assert not any("tasks.description" in q.lower() or "requirements.description" in q.lower() for q in sql)
    assert all(q.lstrip().lower().startswith("select") for q in sql)


def test_progress_summary_uses_real_observed_days_and_full_current_metrics(env):
    client, sessions, _ = env
    seed(sessions)
    today = datetime.now(timezone.utc).date()
    response = client.get(
        "/api/v1/delivery/progress/summary",
        params={
            "starts_on": (today - timedelta(days=1)).isoformat(),
            "ends_on": (today + timedelta(days=1)).isoformat(),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["timezone"] == "UTC"
    assert body["current"]["metrics"]["tasks_total"] == 7
    assert body["current"]["metrics"]["verified_completed"] == 0
    assert body["current"]["metrics"]["recorded_completed"] == 1
    assert body["coverage"]["observed_days"] == [today.isoformat()]
    assert body["coverage"]["missing_days"] == [(today - timedelta(days=1)).isoformat()]
    assert body["coverage"]["future_days"] == [(today + timedelta(days=1)).isoformat()]
    assert set(body["current"]) == {"metrics"}
    assert "tasks" not in body and "scopes" not in body


def test_query_filter_errors_are_not_silently_ignored(env):
    client, sessions, _ = env
    seed(sessions)
    for params in ({"category": "unknown"}, {"scope": "other"}, {"limit": 0}, {"limit": 101}):
        assert client.get("/api/v1/delivery/inbox", params=params).status_code == 422
    assert (
        client.get(
            "/api/v1/delivery/progress/summary", params={"starts_on": "2026-10-19", "ends_on": "2026-10-18"}
        ).status_code
        == 422
    )


def test_native_history_cannot_be_reinterpreted_as_manual_and_reasons_are_bounded(env):
    client, sessions, _ = env
    seed(sessions)
    from sop_manager.routers.delivery_inbox import build_inbox

    snapshot = client.get("/api/v1/delivery/workspace").json()
    snapshot["executions"] = [{"id": "old-native", "task_id": "C", "status": "failed"}]
    result = build_inbox(snapshot, {"id": "lead"}, scope="team")
    assert not [
        item for item in result["items"] if item["resource_id"] == "C" and "acceptance" in item["categories"]
    ]
    with sessions() as db:
        db.add_all(
            [
                m.Issue(
                    id=f"I-{i}",
                    tenant_id="tenant",
                    project_id="project",
                    task_id="E",
                    title=f"Issue {i}",
                    severity="P1",
                    status="open",
                )
                for i in range(8)
            ]
        )
        db.commit()
    item = next(item for item in get(client, category="blocked")["items"] if item["resource_id"] == "E")
    assert len(item["blocked_reasons"]) == 5
    assert item["blocked_reason_count"] == 9


def test_manual_acceptance_reappears_on_real_invalidation_and_changes_request_returns_work(env):
    client, sessions, _ = env
    seed(sessions)

    def decide(decision, key):
        current = client.get("/api/v1/delivery/tasks/C/review-current").json()
        response = client.post(
            "/api/v1/delivery/commands",
            json={
                "action": "task.manual_review",
                "payload": {
                    "task_id": "C",
                    "decision": decision,
                    "basis": current["current"]["basis"],
                    "comment": "Review current delivery",
                    "evidence_content": "Manually inspected",
                },
                "expected_version": current["version"],
                "idempotency_key": key,
            },
        )
        assert response.status_code == 200, response.text

    decide("accept", "accept-before-change")
    assert get(client, category="acceptance")["items"] == []
    with sessions() as db:
        db.get(m.Task, "C").title = "Changed delivery definition"
        db.commit()
    assert [item["resource_id"] for item in get(client, category="acceptance")["items"]] == ["C"]
    decide("request_changes", "request-current-changes")
    assert get(client, category="acceptance")["items"] == []
    assert "C" in [item["resource_id"] for item in get(client, category="work")["items"]]


def test_native_success_stays_one_execution_acceptance_item_in_sql_api(bridge):
    client, _, _, _, _, _, task = bridge
    execution = sync(bridge, queue(bridge))
    finish(bridge, execution)
    sync(bridge, execution)
    items = get(client, category="acceptance")["items"]
    assert len(items) == 1 and items[0]["resource_id"] == task["id"]
    assert items[0]["acceptance_kind"] == "execution"
    assert items[0]["status"] == "awaiting_review"


def test_cursor_rechecks_current_approval_permission_and_project(env):
    client, sessions, _ = env
    seed(sessions)
    token = get(client, scope="team", limit=1)["next_cursor"]
    assert (
        client.get(
            "/api/v1/delivery/inbox",
            headers={"X-Project-Id": "other"},
            params={"scope": "team", "limit": 1, "cursor": token},
        ).status_code
        == 422
    )
    with sessions() as db:
        db.add(m.ProjectMember(project_id="project", user_id="lead", role="viewer"))
        db.get(m.User, "lead").role = "viewer"
        db.commit()
    stale = client.get("/api/v1/delivery/inbox", params={"scope": "team", "limit": 1, "cursor": token})
    assert stale.status_code == 409


def test_progress_summary_deduplicates_days_and_uses_lifetime_metadata(env):
    client, sessions, _ = env
    seed(sessions)
    today = datetime.now(timezone.utc).date()
    old = today - timedelta(days=600)
    from test_delivery_progress_api import _observe

    with sessions() as db:
        for i in range(3):
            _observe(
                db,
                f"summary-today-{i}",
                datetime.combine(today, datetime.min.time()) + timedelta(seconds=i),
                {"unused_full_snapshot": "x" * 200000},
            )
        _observe(
            db,
            "summary-old",
            datetime.combine(old, datetime.min.time()),
            {"unused_full_snapshot": "x" * 200000},
        )
        db.commit()
    response = client.get(
        "/api/v1/delivery/progress/summary",
        params={"starts_on": today.isoformat(), "ends_on": today.isoformat()},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["coverage"]["observed_days"] == [today.isoformat()]
    assert body["coverage"]["first_observed_at"].startswith(old.isoformat())
    assert len(response.content) < 3000
