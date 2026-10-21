"""Committed scheduling cannot promote an old receipt into a fresh attempt."""

from test_delivery_execution import bridge, queue, sync  # noqa: F401
from test_delivery_workbench import command, env  # noqa: F401


def test_only_durable_scanner_submits_the_original_attempt_and_activation(bridge, monkeypatch):  # noqa: F811
    from datetime import datetime, timedelta, timezone
    from sop_manager.routers.delivery_execution_control_operation_service import control_once
    from sop_manager.routers import delivery_execution_schedule

    client, _, store, principal, workspace, _, _ = bridge
    entry = sync(bridge, queue(bridge))
    calls = []
    monkeypatch.setattr(delivery_execution_schedule, "submit_control_launch", lambda *args: calls.append(args) or False)
    preview = client.post("/api/v1/delivery/execution-control-preview", json={"id": entry["id"], "action": "execution.start", "reason": "Start the reviewed task"}).json()
    body = {"action": "execution.start", "payload": preview["payload"], "expected_version": preview["version"], "idempotency_key": "fixed-start-receipt"}
    response = client.post("/api/v1/delivery/commands", json=body)
    assert response.status_code == 200 and calls == [], response.text
    assert control_once(client.app, bridge[1]) == 1
    assert len(calls) == 1
    arguments = calls[0][3]
    assert arguments["expected_attempt"] == 1 and arguments["run_id"] == entry["run_id"] and arguments["launch_id"]
    run = store.get(principal, workspace["id"], "runs", entry["run_id"])
    store.mutate(principal, workspace["id"], "runs", run["id"], operation="test.later-attempt", key="later-attempt", request={}, trace="test",
        expected=run["version"], transform=lambda row: {"status": "queued", "data": {**row["data"], "attempt": 2}})
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200 and replay.json()["replayed"], replay.text
    assert control_once(client.app, bridge[1], now=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=2)) == 1
    assert len(calls) == 1
    detail = client.get(f"/api/v1/delivery/executions/{entry['id']}/control-operations/{response.json()['result']['control_operation_id']}")
    assert detail.status_code == 200 and detail.json()["operation"]["state"] == "blocked", detail.text


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
