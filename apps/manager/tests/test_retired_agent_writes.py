"""Name-only reports cannot change business tasks outside the execution protocol."""

from copy import deepcopy

import pytest
from sop_manager.routers import sql_models, tasks
from test_business_access import env as business_env
from test_business_access import headers

env = business_env


@pytest.mark.parametrize(
    ("path", "body"),
    [
        (
            "/api/v1/tasks/agent-feed/claim",
            {"task_id": "T-selected", "agent": "Unbound agent", "force": True, "auto_start": True},
        ),
        (
            "/api/v1/tasks/agent-feed/heartbeat",
            {"task_id": "T-selected", "claim_id": "retired-claim", "agent": "Unbound agent", "state": "running", "progress": 100},
        ),
        (
            "/api/v1/tasks/T-selected/agent-report",
            {"agent": "Unbound agent", "status": "completed", "summary": "Unverified report"},
        ),
    ],
)
def test_unbound_agent_write_routes_are_absent_and_cannot_change_tasks(env, monkeypatch, path, body):
    client, sessions = env
    if path.endswith("heartbeat"):
        monkeypatch.setattr(tasks, "_load_agent_claims", lambda: {"claims": {"retired-claim": {"claim_id": "retired-claim", "task_id": "T-selected", "agent": "Unbound agent"}}})
    with sessions() as db:
        before = {column.name: deepcopy(getattr(db.get(sql_models.Task, "T-selected"), column.name)) for column in sql_models.Task.__table__.columns}
        counts = {table.name: db.query(table).count() for table in sql_models.Base.metadata.sorted_tables}
    response = client.post(path, headers=headers(), json=body)
    assert response.status_code == 404, response.text
    with sessions() as db:
        after = {column.name: getattr(db.get(sql_models.Task, "T-selected"), column.name) for column in sql_models.Task.__table__.columns}
        assert after == before
        assert {table.name: db.query(table).count() for table in sql_models.Base.metadata.sorted_tables} == counts


def test_agent_feed_points_to_the_identity_bound_delivery_protocol(env):
    client, _ = env
    response = client.get("/api/v1/tasks/agent-feed?include_blocked=true", headers=headers())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["protocol"]["preview"] == "POST /api/v1/delivery/execution-preview"
    assert data["protocol"]["command"] == "POST /api/v1/delivery/commands"
    for item in data["items"]:
        assert "agent-report" not in str(item["callbacks"])
        assert "agent-feed/claim" not in str(item["callbacks"])
