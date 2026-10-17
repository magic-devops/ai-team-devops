"""Fixed lifecycle proposals reuse SQL CAS, request identity and immutable event results."""

from sop_manager.routers.sql_models import (
    DeliveryEvent,
    DeliveryProgressObservation,
    DeliveryReceipt,
    DeliveryWorkspace,
    Project,
    Task,
)
from test_delivery_execution import bridge as delivery_bridge
from test_delivery_execution import queue
from test_delivery_workbench import command
from test_delivery_workbench import env as delivery_env

env = delivery_env
bridge = delivery_bridge


def proposal(client, target="archived", reason="Delivery paused for a planned review"):
    response = client.post(
        "/api/v1/delivery/project-lifecycle-preview", json={"target_status": target, "reason": reason}
    )
    assert response.status_code == 200, response.text
    return response.json()


def submit(client, preview, *, key="lifecycle-fixed-request", version=None):
    return command(
        client,
        "project.lifecycle",
        {key: preview[key] for key in ("target_status", "reason", "preview_basis")},
        key=key,
        version=preview["version"] if version is None else version,
    )


def test_archive_restore_keeps_canonical_status_and_every_archive_fact_in_its_event(env):
    client, sessions, _ = env
    first = proposal(client)
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project") is None
        observations_before = db.query(DeliveryProgressObservation).count()
    saved = submit(client, first)
    assert saved.status_code == 200, saved.text
    archive = saved.json()["project"]["status"]
    assert archive == "archived"
    replay = submit(client, first)
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert replay.json()["applied_version"] == saved.json()["applied_version"]
    with sessions() as db:
        assert db.get(Project, "project").status == "archived"
        source = db.get(DeliveryWorkspace, "project").data["lifecycle"]["last_archive"]
        assert source["actor_id"] == "lead" and source["reason"] == first["reason"]
        event = db.query(DeliveryEvent).filter_by(action="project.lifecycle").one()
        assert event.data["result"]["archive"] == source
        first_id = source["id"]
        assert db.query(DeliveryProgressObservation).count() == observations_before
        assert db.query(DeliveryReceipt).count() == 1
    restore = submit(
        client, proposal(client, "paused", "Prepare next release"), key="restore-explicit-paused"
    )
    assert restore.status_code == 200 and restore.json()["project"]["status"] == "paused"
    again = submit(client, proposal(client, reason="Second archive"), key="archive-second")
    assert again.status_code == 200, again.text
    with sessions() as db:
        events = (
            db.query(DeliveryEvent)
            .filter_by(action="project.lifecycle")
            .order_by(DeliveryEvent.version)
            .all()
        )
        assert events[0].data["result"]["archive"]["id"] == first_id
        assert events[2].data["result"]["archive"]["id"] != first_id
        assert "status" not in db.get(DeliveryWorkspace, "project").data["lifecycle"]


def test_changed_preview_basis_and_stale_version_have_no_lifecycle_side_effects(env):
    client, sessions, _ = env
    frozen = proposal(client)
    edit = command(client, "project.update", {"project_path": "D:/new-plan"})
    assert edit.status_code == 200, edit.text
    rejected = submit(client, frozen)
    assert rejected.status_code == 409, rejected.text
    changed = submit(client, frozen, key="old-basis-new-version", version=edit.json()["version"])
    assert changed.status_code == 409, changed.text
    assert changed.json()["detail"]["code"] == "project_lifecycle_basis_changed"
    with sessions() as db:
        assert db.get(Project, "project").status == "active"
        assert db.query(DeliveryEvent).filter_by(action="project.lifecycle").count() == 0
        assert "lifecycle" not in db.get(DeliveryWorkspace, "project").data


def test_same_state_and_read_only_actor_cannot_transition(env):
    client, _, actor = env
    current = proposal(client, "active")
    assert not current["allowed"]
    response = submit(client, current)
    assert response.status_code == 409, response.text
    actor["id"] = "reader"
    forbidden = client.post(
        "/api/v1/delivery/project-lifecycle-preview",
        json={"target_status": "archived", "reason": "Read only"},
    )
    assert forbidden.status_code == 403


def test_archive_blocks_pending_intent_even_after_task_deletion_until_explicit_cancel(bridge):
    client, sessions, _, _, _, _, task = bridge
    intent = queue(bridge)
    with sessions() as db:
        db.delete(db.get(Task, task["id"]))
        db.commit()
    blocked = proposal(client)
    assert not blocked["allowed"] and blocked["facts"]["unclosed_intents_total"] == 1
    assert blocked["blockers"][0]["target"]["execution_id"] == intent["id"]
    rejected = submit(client, blocked, key="archive-blocked-intent")
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["detail"]["code"] == "project_archive_blocked"
    with sessions() as db:
        assert db.get(Project, "project").status == "active"
        assert db.query(DeliveryEvent).filter_by(action="project.lifecycle").count() == 0
    assert command(client, "execution.cancel", {"id": intent["id"]}).status_code == 200
    archived = submit(client, proposal(client), key="archive-after-explicit-cancel")
    assert archived.status_code == 200, archived.text
    assert archived.json()["project"]["status"] == "archived"
