"""Committed scheduling cannot promote an old receipt into a fresh attempt."""

from test_delivery_execution import bridge, queue, sync  # noqa: F401
from test_delivery_workbench import command, env  # noqa: F401


def test_start_schedules_only_the_attempt_captured_by_the_committed_event(bridge, monkeypatch):  # noqa: F811
    client, _, store, principal, workspace, _, _ = bridge
    entry = sync(bridge, queue(bridge))
    calls = []
    monkeypatch.setattr(
        client.app.state.hermes_execution, "execute", lambda *args, **kw: calls.append((args, kw))
    )
    preview = client.post(
        "/api/v1/delivery/execution-control-preview",
        json={
            "id": entry["id"],
            "action": "execution.start",
            "reason": "Start the reviewed task",
        },
    ).json()
    body = {
        "action": "execution.start",
        "payload": preview["payload"],
        "expected_version": preview["version"],
        "idempotency_key": "fixed-start-receipt",
    }
    response = client.post("/api/v1/delivery/commands", json=body)
    assert response.status_code == 200, response.text
    assert len(calls) == 1
    run = store.get(principal, workspace["id"], "runs", entry["run_id"])
    store.mutate(
        principal,
        workspace["id"],
        "runs",
        run["id"],
        operation="test.later-attempt",
        key="later-attempt",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda row: {"status": "queued", "data": {**row["data"], "attempt": 2}},
    )
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200 and replay.json()["replayed"], replay.text
    assert len(calls) == 1


def test_project_archive_counts_unresolved_cancelled_stops_without_double_counting(env):  # noqa: F811
    from copy import deepcopy

    from sop_manager.routers.delivery_service import initial_state
    from sop_manager.routers.sql_models import DeliveryWorkspace
    from test_project_lifecycle import preview_value

    _, sessions, _ = env
    state = initial_state()
    state["executions"] = [
        {
            "id": "cancelled-unknown",
            "task_id": "missing",
            "status": "cancelled",
            "run_id": "run-a",
            "stop_pending": True,
            "stop_snapshot": {"state": "unknown"},
        },
        {
            "id": "running-stop",
            "task_id": "missing",
            "status": "running",
            "run_id": "run-b",
            "stop_pending": True,
            "stop_snapshot": {"state": "requested"},
        },
    ]
    with sessions() as db:
        db.add(DeliveryWorkspace(project_id="project", tenant_id="tenant", version=1, data=state))
        db.commit()
    value = preview_value(sessions)
    assert not value["allowed"]
    assert value["facts"]["unclosed_intents_total"] == 2
    assert {item["target"]["execution_id"] for item in value["blockers"]} == {
        "cancelled-unknown",
        "running-stop",
    }
    assert any(item["code"] == "project_execution_stop_unresolved" for item in value["blockers"])
    with sessions() as db:
        row = db.get(DeliveryWorkspace, "project")
        updated = deepcopy(row.data)
        updated["executions"][0].update(stop_pending=False, stop_snapshot={"state": "confirmed"})
        row.data = updated
        db.commit()
    assert preview_value(sessions)["preview_basis"] != value["preview_basis"]
