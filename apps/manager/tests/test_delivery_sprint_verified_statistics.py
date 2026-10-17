"""Sprint statistics share the actual delivery acceptance boundary, using real SQL/API."""

from datetime import datetime, timedelta, timezone

import pytest
from sop_manager.routers import auth_sql, sprints
from sop_manager.routers.sql_models import (
    DeliveryEvent,
    DeliveryProgressObservation,
    DeliveryReceipt,
    DeliveryTaskReview,
    Sprint,
    Task,
)
from sqlalchemy import event
from test_business_access import env as business_env  # noqa: F401
from test_business_access import headers
from test_delivery_execution import bridge, finish, queue, sync  # noqa: F401
from test_delivery_manual_review import review
from test_delivery_workbench import command, env  # noqa: F401


def install_sprint(client, sessions):
    client.app.include_router(sprints.router)
    client.app.dependency_overrides[auth_sql.current_user_or_apikey] = (
        client.app.dependency_overrides[auth_sql.current_user]
    )
    with sessions() as db:
        db.add(Sprint(id="SPRINT-stats", tenant_id="tenant", project_id="project", goal="Verified work"))
        db.commit()


@pytest.fixture
def sprint_env(env):  # noqa: F811
    install_sprint(env[0], env[1])
    return env


def create_task(client, sessions, *, status="pending"):
    response = command(client, "task.create", {
        "title": "Sprint delivery", "owner_id": "user:lead",
        "acceptance_criteria": ["Requested behavior is verified"],
    })
    assert response.status_code == 200, response.text
    task_id = response.json()["tasks"][-1]["id"]
    with sessions() as db:
        task = db.get(Task, task_id)
        task.sprint_id = "SPRINT-stats"
        task.status = status
        db.commit()
    return task_id


def statistics(client, sprint_id="SPRINT-stats"):
    progress = client.get(f"/api/v1/sprints/{sprint_id}/progress")
    burndown = client.get(f"/api/v1/sprints/{sprint_id}/burndown")
    assert progress.status_code == 200, progress.text
    assert burndown.status_code == 200, burndown.text
    return progress.json(), burndown.json()


def assert_statistics(client, *, recorded=0, verified=0, awaiting=0, pending=0, active=0, blocked=0):
    progress, burndown = statistics(client)
    total = recorded + verified + awaiting + pending + active + blocked
    counts = {
        "pending": pending, "in_progress": active, "blocked": blocked,
        "awaiting_review": awaiting, "recorded_completed": recorded, "verified_completed": verified,
    }
    for stats in (progress, burndown["stats"]):
        assert stats["total_tasks"] == total
        assert stats["completed"] == verified
        assert stats["recorded_completed"] == recorded
        assert stats["verified_completed"] == verified
        assert stats["awaiting_review"] == awaiting
        assert stats["remaining"] == total - verified
        assert stats["completion_rate"] == (round(verified / total * 100, 1) if total else 0)
        assert stats["status_counts"] == counts
        assert len(stats["blocked"]) == blocked
        assert stats["pending"] == pending and stats["in_progress"] == active
    assert progress["current_metrics"] == burndown["current_metrics"]
    assert burndown["current_metrics"]["remaining"] == total - verified
    assert burndown["current_metrics"]["status_counts"] == counts
    assert burndown["current_observation"]["remaining"] == total - verified


def test_recorded_completion_cannot_report_one_hundred_percent_and_acceptance_invalidation_reopens_remaining(sprint_env):
    client, sessions, _ = sprint_env
    task_id = create_task(client, sessions, status="completed")
    assert_statistics(client, recorded=1)
    assert review(client, task_id).status_code == 200
    assert_statistics(client, verified=1)
    with sessions() as db:
        db.get(Task, task_id).description = "Scope changed after review"
        db.commit()
    assert_statistics(client, recorded=1)
    # Restoring the old contents cannot revive a permanently invalidated approval.
    with sessions() as db:
        db.get(Task, task_id).description = ""
        db.commit()
    assert_statistics(client, recorded=1)


def test_effective_six_state_statistics_and_empty_sprint_are_pure_reads(sprint_env):
    client, sessions, _ = sprint_env
    assert_statistics(client)
    for status in ("pending", "in_progress", "blocked", "completed"):
        create_task(client, sessions, status=status)
    with sessions() as db:
        before = tuple(db.query(model).count() for model in (
            DeliveryEvent, DeliveryProgressObservation, DeliveryReceipt, DeliveryTaskReview,
        ))
    writes = []

    def track_writes(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().split(None, 1)[0].upper() in {"INSERT", "UPDATE", "DELETE", "REPLACE"}:
            writes.append(statement)

    engine = sessions.kw["bind"]
    event.listen(engine, "before_cursor_execute", track_writes)
    try:
        assert_statistics(client, pending=1, active=1, blocked=1, recorded=1)
    finally:
        event.remove(engine, "before_cursor_execute", track_writes)
    assert writes == []
    with sessions() as db:
        after = tuple(db.query(model).count() for model in (
            DeliveryEvent, DeliveryProgressObservation, DeliveryReceipt, DeliveryTaskReview,
        ))
    assert after == before


def test_successful_runtime_remains_awaiting_review_until_the_actual_run_is_accepted(bridge):  # noqa: F811
    client, sessions, _, _, _, _, task = bridge
    install_sprint(client, sessions)
    with sessions() as db:
        db.get(Task, task["id"]).sprint_id = "SPRINT-stats"
        db.commit()
    intent = queue(bridge)
    execution = sync(bridge, intent)
    finish(bridge, execution)
    execution = sync(bridge, intent)
    assert execution["status"] == "awaiting_review"
    assert_statistics(client, awaiting=1)
    accepted = command(client, "execution.review", {
        "id": intent["id"], "decision": "accept", "comment": "Verified exact run output",
        "run_version": execution["run_version"],
    })
    assert accepted.status_code == 200, accepted.text
    assert_statistics(client, verified=1)


@pytest.mark.parametrize("endpoint", ["progress", "burndown"])
def test_statistics_keep_authenticated_tenant_and_project_scope(business_env, endpoint):  # noqa: F811
    client, sessions = business_env
    with sessions() as db:
        db.add(Task(id="T-foreign-sprint", title="Unrelated project", tenant_id="team", project_id="other",
                    sprint_id="SPRINT-selected", status="completed"))
        db.add(Task(id="T-other-tenant-sprint", title="Unrelated tenant", tenant_id="foreign", project_id="private",
                    sprint_id="SPRINT-selected", status="completed"))
        db.commit()
    path = f"/api/v1/sprints/SPRINT-selected/{endpoint}"
    response = client.get(path, headers=headers("reader"))
    assert response.status_code == 200, response.text
    body = response.json()
    stats = body if endpoint == "progress" else body["stats"]
    assert stats["total_tasks"] == 0 and stats["completed"] == 0
    assert client.get(path).status_code == 401
    assert client.get(path, headers={"Authorization": headers()["Authorization"]}).status_code == 400
    assert client.get(path, headers=headers("reader", "other")).status_code == 403
    assert client.get(path, headers=headers(project="private")).status_code == 403
    assert client.get(f"/api/v1/sprints/SPRINT-other/{endpoint}", headers=headers()).status_code == 404


def test_summary_and_governance_risk_cannot_treat_recorded_completion_as_verified(sprint_env):
    client, sessions, _ = sprint_env
    create_task(client, sessions, status="completed")
    with sessions() as db:
        db.get(Sprint, "SPRINT-stats").ends_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)
        db.commit()
    summary = client.get("/api/v1/sprints/summary")
    assert summary.status_code == 200, summary.text
    assert summary.json()["active_progress"]["completion_rate"] == 0
    plan = client.get("/api/v1/sprints/ops-plan", params={"sprint_id": "SPRINT-stats"})
    assert plan.status_code == 200, plan.text
    assert any(risk["id"] == "sprint-end-risk" and risk["count"] == 1 for risk in plan.json()["risks"])
