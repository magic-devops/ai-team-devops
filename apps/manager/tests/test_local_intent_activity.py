"""Original requirement scopes remain discoverable after canonical sync removes or moves a Task."""

from sop_manager.routers import sql_models as m
from test_delivery_workbench import command, requirement
from test_event_handoff import env as env  # noqa: F401
from test_event_handoff import frozen, result, send, version
from test_event_handoff_business import flow_client


def emit(env, action, record, event_id):
    return result(
        send(
            env[0],
            frozen(
                event_id,
                "sop.sync.push",
                {
                    "module": "tasks",
                    "action": action,
                    "record": record,
                    "expected_version": version(env[1]),
                },
            ),
        )
    )


def related(client, rid):
    response = client.get(
        "/api/v1/delivery/activity",
        params={
            "scope": "requirement",
            "scope_id": rid,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["items"]


def test_synced_task_delete_records_the_requirement_it_removed_work_from(env):
    client = flow_client(env)
    rid = requirement(client)
    made = command(client, "task.create", {"requirement_id": rid, "title": "Remove this work"})
    assert made.status_code == 200, made.text
    tid = next(row["id"] for row in made.json()["tasks"] if row["req_id"] == rid)
    receipt = emit(env, "delete", {"id": tid}, "review-delete")
    assert receipt["processing"]["state"] == "processed", receipt
    with env[1]() as db:
        assert db.get(m.Task, tid) is None
        event = db.query(m.DeliveryEvent).filter_by(action="sync.record.apply").one()
        event_id = event.id
    project = client.get("/api/v1/delivery/activity").json()["items"]
    entry = next(row for row in project if row["id"] == event_id)
    assert entry["target"]["id"] == tid and not entry["target"]["available"]
    assert event_id in [row["id"] for row in related(client, rid)], entry


def test_synced_task_move_records_source_and_destination_requirement(env):
    client = flow_client(env)
    source = requirement(client)
    new_req = command(client, "requirement.create", {"title": "Destination", "acceptance_criteria": ["B"]})
    target = next(row["id"] for row in new_req.json()["requirements"] if row["title"] == "Destination")
    made = command(client, "task.create", {"requirement_id": source, "title": "Move this work"})
    tid = next(row["id"] for row in made.json()["tasks"] if row["req_id"] == source)
    receipt = emit(env, "update", {"id": tid, "req_id": target}, "review-move")
    assert receipt["processing"]["state"] == "processed", receipt
    with env[1]() as db:
        assert db.get(m.Task, tid).req_id == target
        event = db.query(m.DeliveryEvent).filter_by(action="sync.record.apply").one()
        event_id = event.id
    assert event_id in [row["id"] for row in related(client, target)]
    assert event_id in [row["id"] for row in related(client, source)]
