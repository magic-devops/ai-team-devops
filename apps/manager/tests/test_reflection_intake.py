"""Canonical reflection intake never turns statements into delivery acceptance."""

import importlib.util
import json

import pytest
from sop_manager.routers import sql_models as m
from sop_manager.routers.auth_sql import current_user, current_user_or_apikey
from sqlalchemy import event, func, select

from test_event_handoff import env, frozen, result, send, version  # noqa: F401


@pytest.fixture
def reflection_env(env):
    client, sessions, actor, _, app = env
    if importlib.util.find_spec("sop_manager.routers.reflections"):
        from sop_manager.routers.reflections import router

        app.include_router(router)
    from sop_manager.routers.delivery import router as delivery_router

    app.include_router(delivery_router)
    app.dependency_overrides[current_user] = app.dependency_overrides[current_user_or_apikey]
    return client, sessions, actor, app


def reflection(eid="reflection-1", *, data=None, subject=""):
    return frozen(
        eid,
        "sop.reflection.recorded",
        data
        if data is not None
        else {
            "schema_version": 1,
            "category": "workflow",
            "title": "Recover the original operation",
            "observation": "The client lost the response after the operation committed.",
            "lesson": "Review and replay the original request.",
            "references": [{"kind": "task", "id": "T-task"}],
        },
        subject,
    )


def test_valid_collection_keeps_exact_original_and_does_not_approve_work(reflection_env):
    # A missing handler or a receipt-only pseudo-success must fail this contract.
    client, sessions, _, _ = reflection_env
    before = version(sessions)
    item = reflection()
    first = result(send(client, item))
    assert first["processing"]["state"] == "processed"
    assert first["processing"]["handler"] == "reflection.record"
    assert first["processing"]["result"] == {
        "kind": "reflection_recorded",
        "target_kind": "reflection",
        "target_id": first["receipt_id"],
    }
    again = result(send(client, item))
    assert again["outcome"] == "duplicate"
    assert again["receipt_id"] == first["receipt_id"]
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.ReflectionRecord)) == 1
        assert db.scalar(select(m.EventInbox.event_json)) == item["event_json"]
        assert db.get(m.Task, "T-task").status == "pending"
    assert version(sessions) == before


def test_invalid_typed_reference_is_rejected_without_poisoning_valid_sibling(reflection_env):
    # Accepting an arbitrary payload as a stored reflection would hide this error.
    client, sessions, _, _ = reflection_env
    bad_data = json.loads(reflection()["event_json"])["data"]
    bad_data["references"] = [{"kind": "task", "id": "T-foreign"}]
    response = send(client, reflection("bad", data=bad_data), reflection("good"))
    assert response.status_code == 200
    bad, good = response.json()["results"]
    assert bad["outcome"] == "rejected"
    assert bad["receipt_id"] is None
    assert good["processing"]["state"] == "processed"
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.EventInbox)) == 1


def test_legacy_unconfigured_reflection_never_exposes_raw_or_attempts(reflection_env):
    # A previously stored type with no trusted server plan is not public raw.
    client, sessions, _, _ = reflection_env
    stored = result(send(client, reflection()))
    rid = stored["receipt_id"]
    with sessions() as db:
        db.connection().execute(
            m.EventProcessing.__table__.update()
            .where(m.EventProcessing.id == rid)
            .values(handler=None, plan=None)
        )
        db.commit()
    assert client.get(f"/api/v1/events/{rid}").status_code == 403
    assert client.get(f"/api/v1/events/{rid}/attempts").status_code == 403
    page = client.get("/api/v1/events").json()
    row = next(item for item in page["items"] if item["id"] == rid)
    assert row["source"] == "" and row["subject"] == ""
    assert row["processing"]["result"] is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schema_version", True),
        ("schema_version", 2),
        ("schema_version", "1"),
        ("category", "unknown"),
        ("title", " "),
        ("title", "x" * 161),
        ("title", None),
        ("observation", ""),
        ("observation", "x" * 12001),
        ("lesson", None),
        ("lesson", "x" * 8001),
        ("references", None),
        ("references", [{"kind": "task", "id": "T-task"}] * 2),
        ("references", [{"kind": "task", "id": "T-task", "project_id": "other"}]),
        ("references", [{"kind": "task", "id": " T-task"}]),
        ("references", [{"kind": "task", "id": "T-task/hidden"}]),
        ("references", [{"kind": "task", "id": "T-task\\hidden"}]),
        ("references", [{"kind": "task", "id": "T-task\x7f"}]),
        ("references", [{"kind": "execution", "id": "x" * 201}]),
        ("references", [{"kind": "requirement", "id": "R"}]),
        ("project_id", "project"),
    ],
)
def test_typed_intake_rejects_invalid_original_without_a_receipt(reflection_env, field, value):
    client, sessions, _, _ = reflection_env
    data = json.loads(reflection()["event_json"])["data"]
    data[field] = value
    received = result(send(client, reflection(data=data)))
    assert received["outcome"] == "rejected"
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.EventInbox)) == 0


def test_subject_cannot_be_used_as_an_implicit_task_reference(reflection_env):
    client, _, _, _ = reflection_env
    assert result(send(client, reflection(subject="T-task")))["outcome"] == "rejected"


def test_collection_projection_failure_rolls_back_success_then_original_retry_recovers(reflection_env):
    client, sessions, _, _ = reflection_env
    engine = sessions.kw["bind"]
    armed = {"value": True}

    def fail_record(connection, cursor, statement, parameters, context, executemany):
        if armed["value"] and statement.lstrip().lower().startswith("insert into reflection_records"):
            armed["value"] = False
            raise OSError("controlled reflection record write failure")

    event.listen(engine, "before_cursor_execute", fail_record)
    try:
        first = result(send(client, reflection()))
    finally:
        event.remove(engine, "before_cursor_execute", fail_record)
    assert first["processing"]["state"] == "failed"
    rid = first["receipt_id"]
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.ReflectionRecord)) == 0
        attempts = db.scalars(select(m.EventProcessingAttempt)).all()
        assert len(attempts) == 1 and attempts[0].to_state == "failed"
    retry = {
        "expected_revision": first["processing"]["revision"],
        "idempotency_key": "recover-reflection-record",
        "reason": "Reviewed failed transaction; recover the exact original.",
    }
    response = client.post(f"/api/v1/events/{rid}:retry", json=retry)
    assert response.status_code == 200, response.text
    assert response.json()["processing"]["state"] == "processed"
    replay = client.post(f"/api/v1/events/{rid}:retry", json=retry)
    assert replay.json()["replayed"] is True
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.ReflectionRecord)) == 1
        assert db.scalar(select(func.count()).select_from(m.EventProcessingAttempt)) == 2


def test_reflection_exact_is_independent_of_catalogue_and_has_fixed_source(reflection_env):
    client, _, _, _ = reflection_env
    received = result(send(client, reflection()))
    rid = received["receipt_id"]
    response = client.get(f"/api/v1/reflections/{rid}")
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["available"] is True
    assert value["source"]["event_json"] == reflection()["event_json"]
    assert value["statement"]["title"] == "Recover the original operation"
    assert value["verified"]["is_acceptance_evidence"] is False
    assert value["selection_reference"]["reflection_id"] == rid
    assert value["selection_reference"]["source_digest"] == received["digest"]
    assert value["selection_reference"]["attempt_id"]
