"""Focused regressions for the scheduling review's date, span and status boundaries."""

from copy import deepcopy
from datetime import date, timedelta

import pytest
from sop_manager.routers import sql_models as models
from test_delivery_execution import bridge as delivery_bridge
from test_delivery_execution import finish, queue, sync
from test_delivery_scheduling import allocation, apply_schedule, schedule, task
from test_delivery_workbench import command
from test_delivery_workbench import env as delivery_env

env = delivery_env
bridge = delivery_bridge


def observed_task(client, task_id):
    series = client.get("/api/v1/delivery/progress")
    assert series.status_code == 200, series.text
    observation_id = next(
        day["observation_id"] for day in reversed(series.json()["days"]) if day["observation_id"]
    )
    exact = client.get(f"/api/v1/delivery/progress/observations/{observation_id}/tasks/{task_id}")
    assert exact.status_code == 200, exact.text
    assert exact.json()["source_id"] == observation_id
    assert exact.json()["item"]["id"] == task_id
    return exact.json()["item"]


@pytest.mark.parametrize("value", [86400, "86400", "2026-10-19T00:00:00Z"])
@pytest.mark.parametrize("entry", ["update", "create", "plan"])
def test_all_task_date_inputs_reject_epoch_numbers_and_timestamps_before_any_write(env, entry, value):
    client, sessions, _ = env
    work = task(client)
    with sessions() as db:
        version = db.get(models.DeliveryWorkspace, "project").version
        count = db.query(models.Task).count()
    if entry == "update":
        result = command(client, "task.update", {"id": work["id"], "starts_on": value, "ends_on": None})
    elif entry == "create":
        result = command(
            client, "task.create", {"requirement_id": work["req_id"], "title": "Bad date", "starts_on": value}
        )
    else:
        result = command(
            client,
            "tasks.plan",
            {"requirement_id": work["req_id"], "items": [{"title": "Bad date", "starts_on": value}]},
        )
    assert result.status_code == 422, result.text
    with sessions() as db:
        assert db.get(models.DeliveryWorkspace, "project").version == version
        assert db.query(models.Task).count() == count


@pytest.mark.parametrize("entry", ["batch", "preview", "single"])
def test_reservation_input_allows_366_inclusive_days_and_rejects_367_without_partial_write(env, entry):
    client, _, _ = env
    work = task(client)
    first = date(2028, 1, 1)
    for days, expected in [(367, 422), (366, 200)]:
        last = (first + timedelta(days=days - 1)).isoformat()
        segment = allocation(starts_on=first.isoformat(), ends_on=last, weekdays=[0, 1, 2, 3, 4, 5, 6])
        before = schedule(client).json()
        change = {
            "task_id": work["id"],
            "starts_on": first.isoformat(),
            "ends_on": last,
            "allocations": [segment],
        }
        if entry == "batch":
            result = apply_schedule(client, [change])
        elif entry == "preview":
            result = client.post(
                "/api/v1/delivery/schedule-preview",
                json={"planning_basis": before["planning_basis"], "changes": [change]},
            )
        else:
            result = command(
                client,
                "task.update",
                {
                    "id": work["id"],
                    "planning_basis": before["planning_basis"],
                    **{k: v for k, v in change.items() if k != "task_id"},
                },
            )
        assert result.status_code == expected, result.text
        if expected == 422 or entry == "preview":
            after = schedule(client).json()
            assert after["planning_basis"] == before["planning_basis"]


@pytest.mark.parametrize("kind", ["dependency", "task", "requirement"])
def test_schedule_and_progress_consume_the_same_effective_blocked_state(env, kind):
    client, sessions, _ = env
    work = task(client)
    if kind == "task":
        assert (
            command(
                client, "task.update", {"id": work["id"], "blocked_reason": "External dependency"}
            ).status_code
            == 200
        )
    elif kind == "requirement":
        assert (
            command(
                client, "requirement.update", {"id": work["req_id"], "blocked_reason": "Awaiting decision"}
            ).status_code
            == 200
        )
    else:
        predecessor = task(client)
        with sessions() as db:
            workspace = db.get(models.DeliveryWorkspace, "project")
            data = deepcopy(workspace.data)
            data["task_details"][work["id"]]["depends_on"] = [predecessor["id"]]
            workspace.data = data
            db.commit()
    scheduled = next(t for t in schedule(client).json()["tasks"] if t["id"] == work["id"])
    proof = client.get("/api/v1/delivery/progress/freeze-proof").json()
    progress = observed_task(client, work["id"])
    assert proof["complete"] and proof["metrics"]["status_counts"]["blocked"] >= 1
    assert scheduled["delivery_status"] == progress["status"] == "blocked"


def test_schedule_requires_the_same_current_native_review_evidence_as_progress(bridge):
    client, sessions, _, _, _, _, work = bridge
    intent = queue(bridge)
    execution = sync(bridge, intent)
    finish(bridge, execution)
    sync(bridge, intent)
    before = next(t for t in schedule(client).json()["tasks"] if t["id"] == work["id"])
    assert before["delivery_status"] == "awaiting_review"
    with sessions() as db:
        workspace = db.get(models.DeliveryWorkspace, "project")
        data = deepcopy(workspace.data)
        data["executions"][-1]["run_version"] = 0
        workspace.data = data
        db.commit()
    scheduled = next(t for t in schedule(client).json()["tasks"] if t["id"] == work["id"])
    proof = client.get("/api/v1/delivery/progress/freeze-proof").json()
    progress = observed_task(client, work["id"])
    assert proof["complete"] and proof["metrics"]["status_counts"]["in_progress"] >= 1
    assert scheduled["delivery_status"] == progress["status"] == "in_progress"
