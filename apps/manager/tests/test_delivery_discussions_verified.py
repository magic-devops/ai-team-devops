"""Discussion provenance neither grants nor revokes canonical delivery acceptance."""

from sop_manager.routers import sql_models as m
from sop_manager.routers.delivery_discussions import router
from sqlalchemy import select
from test_delivery_execution import bridge as delivery_bridge
from test_delivery_execution import finish, queue, sync
from test_delivery_manual_review import completed, review
from test_delivery_workbench import command
from test_delivery_workbench import env as delivery_env

env = delivery_env
bridge = delivery_bridge


def discuss(client, task_id):
    client.app.include_router(router)
    first = client.post(
        "/api/v1/delivery/discussions",
        json={
            "subject_kind": "task",
            "subject_id": task_id,
            "title": "Keep delivery evidence",
            "body": "A discussion only",
            "idempotency_key": "verified-thread",
        },
    )
    assert first.status_code == 200, first.text
    saved = first.json()
    resolved = client.post(
        f"/api/v1/delivery/discussions/{saved['thread_id']}/resolve",
        json={
            "expected_thread_version": 1,
            "message_id": saved["message_id"],
            "message_revision": 1,
            "idempotency_key": "verified-resolve",
        },
    )
    assert resolved.status_code == 200, resolved.text
    ref = client.get(
        f"/api/v1/delivery/discussion-references/task/{task_id}", params={"field": "title"}
    ).json()
    linked = client.post(
        f"/api/v1/delivery/discussions/{saved['thread_id']}/links",
        json={
            "expected_thread_version": 2,
            "resolution_event_id": resolved.json()["event_id"],
            "message_id": saved["message_id"],
            "message_revision": 1,
            "target_kind": "task",
            "target_id": task_id,
            "target_content_basis": ref["target_content_basis"],
            "idempotency_key": "verified-link",
        },
    )
    assert linked.status_code == 200, linked.text
    edited = client.patch(
        f"/api/v1/delivery/discussions/{saved['thread_id']}/messages/{saved['message_id']}",
        json={
            "expected_message_revision": 1,
            "body": "Source later revised",
            "idempotency_key": "verified-edit",
        },
    )
    assert edited.status_code == 200, edited.text


def protected(sessions):
    with sessions() as db:
        return {
            table.name: [dict(row) for row in db.execute(select(table)).mappings()]
            for table in m.Base.metadata.sorted_tables
            if not table.name.startswith("delivery_discussion_") and table.name != "delivery_source_links"
        }


def test_human_acceptance_remains_verified_after_discussion_and_reference(env):
    client, sessions, _ = env
    task = completed(client)
    assert review(client, task["id"]).status_code == 200
    before = protected(sessions)
    discuss(client, task["id"])
    assert protected(sessions) == before
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}/reviews").json()["current"]["verified"]


def test_native_acceptance_remains_verified_after_discussion_and_reference(bridge):
    client, sessions, _, _, _, _, task = bridge
    entry = sync(bridge, queue(bridge))
    finish(bridge, entry)
    observed = sync(bridge, entry)
    accepted = command(
        client,
        "execution.review",
        {
            "id": entry["id"],
            "decision": "accept",
            "comment": "Current native test evidence inspected",
            "run_version": observed["run_version"],
        },
    )
    assert accepted.status_code == 200, accepted.text
    state = client.get("/api/v1/delivery/workspace").json()
    assert (
        next(item for item in state["tasks"] if item["id"] == task["id"])["delivery_status"]
        == "verified_completed"
    )
    before = protected(sessions)
    discuss(client, task["id"])
    assert protected(sessions) == before
    current = client.get("/api/v1/delivery/workspace").json()
    assert (
        next(item for item in current["tasks"] if item["id"] == task["id"])["delivery_status"]
        == "verified_completed"
    )
