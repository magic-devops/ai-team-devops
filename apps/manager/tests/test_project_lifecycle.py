"""Lifecycle preview and dispatch boundary tests over real SQL and Hermes receipts."""

from importlib import import_module
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sop_manager.routers.delivery_service import initial_state
from sop_manager.routers.sql_models import DeliveryWorkspace, Project, User
from test_delivery_execution import bridge as delivery_bridge
from test_delivery_execution import cancel_execution, queue, queue_payload, sync
from test_delivery_workbench import command
from test_delivery_workbench import env as delivery_env

env = delivery_env
bridge = delivery_bridge


def preview_value(sessions, target="archived", reason="Pause this delivery scope"):
    module = import_module("sop_manager.routers.project_lifecycle")
    with sessions() as db:
        row = db.get(DeliveryWorkspace, "project")
        return module.preview(
            db,
            db.get(Project, "project"),
            db.get(User, "lead"),
            row.data if row else initial_state(),
            SimpleNamespace(target_status=target, reason=reason),
            version=row.version if row else 0,
        )


def test_lifecycle_preview_is_pure_and_preserves_complete_unclosed_missing_task_intents(env):
    _, sessions, _ = env
    with sessions() as db:
        data = initial_state()
        data["executions"] = [
            {"id": f"intent-{n}", "task_id": f"missing-{n}", "status": "pending_dispatch", "run_id": ""}
            for n in range(15)
        ]
        data["executions"].append({"id": "closed", "task_id": "gone", "status": "cancelled"})
        db.add(DeliveryWorkspace(project_id="project", tenant_id="tenant", version=0, data=data))
        db.commit()
        before_version = db.get(DeliveryWorkspace, "project").version
    result = preview_value(sessions)
    assert not result["allowed"]
    assert result["facts"]["unclosed_intents_total"] == len(result["blockers"]) == 15
    assert {item["target"]["execution_id"] for item in result["blockers"]} == {
        f"intent-{n}" for n in range(15)
    }
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project").version == before_version
        assert db.get(Project, "project").status == "active"


def test_preview_without_workspace_does_not_create_one_and_definition_change_changes_basis(env):
    _, sessions, _ = env
    first = preview_value(sessions)
    assert first["allowed"] and first["version"] == 0
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project") is None
        db.get(Project, "project").project_path = "D:/changed"
        db.commit()
    changed = preview_value(sessions)
    assert first["preview_basis"] != changed["preview_basis"]
    same = preview_value(sessions)
    assert changed["preview_basis"] == same["preview_basis"]


@pytest.mark.parametrize("status", ["planning", "paused", "archived"])
def test_non_active_project_cannot_prepare_or_queue_new_execution(bridge, status):  # noqa: F811
    client, sessions, store, principal, ws, _, _ = bridge
    body = queue_payload(bridge)
    # Existing state fixture; production lifecycle write permissions are tested separately.
    with sessions.kw["bind"].begin() as connection:
        connection.execute(Project.__table__.update().where(Project.id == "project").values(status=status))
    response = client.post("/api/v1/delivery/execution-preview", json=body)
    assert response.status_code == 409, response.text
    assert command(client, "execution.queue", body).status_code == 409
    assert not store.list(principal, ws["id"], "runs")


def test_paused_pending_cannot_handoff_but_can_cancel(bridge):  # noqa: F811
    intent = queue(bridge)
    with bridge[1].kw["bind"].begin() as connection:
        connection.execute(Project.__table__.update().where(Project.id == "project").values(status="paused"))
    response = command(bridge[0], "execution.sync", {"id": intent["id"]})
    assert response.status_code == 409, response.text
    assert not bridge[2].list(bridge[3], bridge[4]["id"], "runs")
    assert cancel_execution(bridge[0], intent["id"]).status_code == 200


def test_paused_receipt_recovers_after_manager_rollback_before_fresh_dispatch_gate(bridge, monkeypatch):  # noqa: F811
    from sop_manager.routers import delivery_execution

    intent = queue(bridge)
    original = delivery_execution._observe

    def interrupted(*args, **kwargs):
        raise HTTPException(503, "Manager interrupted after committed receipt")

    monkeypatch.setattr(delivery_execution, "_observe", interrupted)
    assert command(bridge[0], "execution.sync", {"id": intent["id"]}).status_code == 503
    with bridge[1].kw["bind"].begin() as connection:
        connection.execute(Project.__table__.update().where(Project.id == "project").values(status="paused"))
    monkeypatch.setattr(delivery_execution, "_observe", original)
    recovered = sync(bridge, intent)
    assert recovered["run_id"] and recovered["status"] == "planned"
    response = bridge[0].get(f"/api/v1/delivery/executions/{intent['id']}/observations")
    assert response.status_code == 200, response.text
    assert not response.json()["permissions"]["can_start"]
    assert response.json()["permissions"]["can_sync"]
    assert len(bridge[2].list(bridge[3], bridge[4]["id"], "runs")) == 1


def test_ordinary_progress_capture_cannot_write_archived_project(env):  # noqa: F811
    from sop_manager.routers.delivery_progress_capture import record_observation

    _, sessions, _ = env
    with sessions.kw["bind"].begin() as connection:
        connection.execute(
            Project.__table__.update().where(Project.id == "project").values(status="archived")
        )
    with sessions() as db:
        with pytest.raises(HTTPException) as blocked:
            record_observation(db, db.get(Project, "project"), force=True)
        assert blocked.value.status_code == 409
        db.rollback()
