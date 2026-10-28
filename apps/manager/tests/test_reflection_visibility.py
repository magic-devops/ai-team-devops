"""Frozen source scopes protect every raw-original entry point."""

from datetime import datetime

import pytest
from hermes_core.models import Principal
from hermes_core.transactional import Store
from sop_manager.routers import sql_models as m
from sop_manager.routers.delivery_query_index import SCHEMA_VERSION
from sqlalchemy import delete, event, insert, select, update

from test_event_handoff import env, result, send  # noqa: F401
from test_reflection_intake import reflection, reflection_env  # noqa: F401


@pytest.fixture
def execution_source(reflection_env, tmp_path, monkeypatch):
    client, sessions, actor, app = reflection_env
    store = Store("sqlite:///" + str(tmp_path / "runtime.sqlite"))
    app.state.hermes_store = store
    principal = Principal("lead", tenant="tenant", business="team")
    workspace = store.create(
        principal, "", "workspaces", {"name": "Private", "owner": "lead"}, "private", "private-ws"
    )
    run = store.create(principal, workspace["id"], "runs", {"attempt": 1}, "run", "run", status="completed")
    monkeypatch.setattr(store, "list", lambda *args, **kwargs: pytest.fail("Never enumerate runtime ACL"))
    with sessions() as db:
        row = db.get(m.DeliveryWorkspace, "project")
        if row is None:
            from sop_manager.routers.delivery_service import initial_state

            row = m.DeliveryWorkspace(project_id="project", tenant_id="tenant", version=0, data=initial_state())
            db.add(row)
            db.flush()
        state = dict(row.data)
        state["executions"] = [{
            "id": "E-private", "workspace_id": workspace["id"], "run_id": run["id"],
            "status": "completed", "task_id": "T-task",
        }]
        db.connection().execute(update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "project").values(data=state))
        db.connection().execute(delete(m.DeliveryQueryState).where(m.DeliveryQueryState.project_id == "project"))
        db.connection().execute(insert(m.DeliveryQueryState).values(
            tenant_id="tenant", project_id="project", schema_version=SCHEMA_VERSION, generation=1,
            source_version=row.version, computed_at=datetime.utcnow(), summary={}, metrics={}, planning_basis="",
        ))
        db.connection().execute(insert(m.DeliveryQueryFact).values(
            tenant_id="tenant", project_id="project", kind="execution", entity_id="E-private",
            data={"position": 0, "workspace_id": workspace["id"]},
        ))
        db.commit()
    data = {
        "schema_version": 1, "category": "testing", "title": "Private execution observation",
        "observation": "Sensitive observation that must never become a test-passed assertion.",
        "references": [{"kind": "execution", "id": "E-private"}],
    }
    return client, sessions, actor, store, workspace, run, data


def test_restricted_runtime_source_cannot_leak_through_generic_event_routes(execution_source):
    client, sessions, actor, _, _, _, data = execution_source
    first = result(send(client, reflection(data=data)))
    assert first["processing"]["state"] == "processed"
    rid = first["receipt_id"]
    actor["id"] = "other-user"
    response = client.get(f"/api/v1/reflections/{rid}")
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["available"] is False
    assert value["statement"] is None and value["source"] is None
    assert value["selection_reference"] is None
    assert "E-private" not in response.text and "Sensitive observation" not in response.text
    assert client.get(f"/api/v1/events/{rid}").status_code == 403
    assert client.get(f"/api/v1/events/{rid}/attempts").status_code == 403
    page = client.get("/api/v1/events").json()
    row = next(item for item in page["items"] if item["id"] == rid)
    assert row["source"] == "" and row["subject"] == ""
    assert row["processing"]["result"] is None
    reflection_page = client.get("/api/v1/reflections").json()
    assert reflection_page["total"] == 1
    assert reflection_page["items"][0]["original_status"] == "restricted"
    with sessions() as db:
        assert db.get(m.Task, "T-task").status == "pending"


def test_execution_rebinding_does_not_broaden_original_visibility(execution_source):
    client, sessions, actor, store, _, _, data = execution_source
    first = result(send(client, reflection(data=data)))
    rid = first["receipt_id"]
    principal = Principal("other-user", tenant="tenant", business="team")
    new_workspace = store.create(principal, "", "workspaces", {"name": "Other", "owner": "other-user"}, "new", "new-ws")
    with sessions() as db:
        row = db.get(m.DeliveryWorkspace, "project")
        state = dict(row.data)
        state["executions"] = [{**state["executions"][0], "workspace_id": new_workspace["id"]}]
        db.connection().execute(update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "project").values(data=state))
        db.commit()
    actor["id"] = "other-user"
    assert client.get(f"/api/v1/events/{rid}").status_code == 403
    assert client.get(f"/api/v1/reflections/{rid}").json()["source"] is None
    actor["id"] = "lead"
    original = client.get(f"/api/v1/reflections/{rid}").json()
    assert original["available"] is True
    assert original["links"][0]["available"] is False
    assert original["selection_reference"] is None


@pytest.mark.parametrize("suffix", ["", "/attempts"])
def test_shape_valid_plan_with_removed_scopes_never_grants_generic_attempt_access(execution_source, suffix):
    client, sessions, actor, _, _, _, data = execution_source
    first = result(send(client, reflection(data=data)))
    assert first["processing"]["state"] == "processed"
    rid = first["receipt_id"]
    with sessions() as db:
        plan = {"reflection_visibility": {"version": 1, "digest": first["digest"], "references": [], "runtime_scopes": []}}
        db.connection().execute(update(m.EventProcessing).where(m.EventProcessing.id == rid).values(plan=plan))
        db.commit()
    actor["id"] = "other-user"
    response = client.get(f"/api/v1/events/{rid}{suffix}")
    assert response.status_code == 403, response.text
    assert "Sensitive observation" not in response.text
    page = client.get("/api/v1/events").json()
    row = next(item for item in page["items"] if item["id"] == rid)
    assert row["source"] == "" and row["subject"] == "" and row["processing"]["result"] is None
    exact = client.get(f"/api/v1/reflections/{rid}").json()
    assert exact["source"] is None and exact["statement"] is None and exact["selection_reference"] is None


@pytest.mark.parametrize("reader", ["lead", "other-user"])
def test_changed_type_index_cannot_publish_a_private_reflection_or_its_result(execution_source, reader):
    # Changing only the mutable index must not bypass the shared raw/attempt guard.
    client, sessions, actor, _, _, _, data = execution_source
    first = result(send(client, reflection(data=data)))
    rid = first["receipt_id"]
    with sessions() as db:
        db.connection().execute(update(m.EventInbox).where(m.EventInbox.id == rid).values(event_type="sop.agent.heartbeat"))
        db.commit()
    actor["id"] = reader
    for suffix in ("", "/attempts"):
        response = client.get(f"/api/v1/events/{rid}{suffix}")
        assert response.status_code == 403, response.text
        assert "Sensitive observation" not in response.text and "E-private" not in response.text
        assert "reflection_recorded" not in response.text
    retry = client.post(f"/api/v1/events/{rid}:retry", json={
        "expected_revision": first["processing"]["revision"], "idempotency_key": "corrupt-type-retry",
        "reason": "Review the same stored event without publishing its protected original.",
    })
    assert retry.status_code == 403, retry.text
    statements = []

    def watch(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())

    engine = sessions.kw["bind"]
    event.listen(engine, "before_cursor_execute", watch)
    try:
        response = client.get("/api/v1/events")
    finally:
        event.remove(engine, "before_cursor_execute", watch)
    assert response.status_code == 200, response.text
    row = next(item for item in response.json()["items"] if item["id"] == rid)
    assert row["source"] == "" and row["subject"] == "" and row["processing"]["result"] is None
    assert all("event_json" not in statement and "event_processing.plan" not in statement for statement in statements)
    current = client.get(f"/api/v1/reflections/{rid}").json()
    assert current["source"] is None and current["statement"] is None and current["selection_reference"] is None


@pytest.mark.parametrize("handler", ["reflection.record", None])
def test_collection_record_keeps_changed_type_private_when_plan_or_handler_is_missing(execution_source, handler):
    client, sessions, actor, _, _, _, data = execution_source
    rid = result(send(client, reflection(data=data)))["receipt_id"]
    with sessions() as db:
        # The unconfigured legacy/missing-plan state already has no trusted scope;
        # changing its type index must not turn it into a generic public event.
        db.connection().execute(update(m.EventProcessing).where(m.EventProcessing.id == rid).values(handler=handler, plan=None, result=None))
        db.connection().execute(update(m.EventInbox).where(m.EventInbox.id == rid).values(event_type="sop.agent.heartbeat"))
        db.commit()
    actor["id"] = "other-user"
    assert client.get(f"/api/v1/events/{rid}").status_code == 403
    assert client.get(f"/api/v1/events/{rid}/attempts").status_code == 403
    row = next(item for item in client.get("/api/v1/events").json()["items"] if item["id"] == rid)
    assert row["source"] == "" and row["subject"] == "" and row["processing"]["result"] is None


def test_reflection_cannot_process_through_a_changed_heartbeat_handler(reflection_env):
    client, sessions, _, _ = reflection_env
    item = reflection()
    rid = result(send(client, item))["receipt_id"]
    with sessions() as db:
        db.connection().execute(update(m.EventProcessing).where(m.EventProcessing.id == rid).values(handler="heartbeat.record", state="pending"))
        db.commit()
    received = result(send(client, item))
    assert received["receipt_id"] == rid and received["outcome"] == "duplicate"
    assert received["processing"]["state"] == "failed"
    assert received["processing"]["result"] is None
    with sessions() as db:
        latest = db.scalar(select(m.EventProcessingAttempt).where(m.EventProcessingAttempt.receipt_id == rid)
                           .order_by(m.EventProcessingAttempt.seq.desc()).limit(1))
        assert latest.to_state == "failed" and latest.result is None


def test_retry_rechecks_private_original_after_waiting_for_project_lock(execution_source, monkeypatch):
    from sop_manager.routers import events_ingest

    client, sessions, _, _, _, _, data = execution_source
    armed = {"value": True}

    def fail_record(connection, cursor, statement, parameters, context, executemany):
        if armed["value"] and statement.lstrip().lower().startswith("insert into reflection_records"):
            armed["value"] = False
            raise OSError("controlled collection failure before retry")

    engine = sessions.kw["bind"]
    event.listen(engine, "before_cursor_execute", fail_record)
    try:
        first = result(send(client, reflection(data=data)))
    finally:
        event.remove(engine, "before_cursor_execute", fail_record)
    assert first["processing"]["state"] == "failed"
    original_lock = events_ingest.require_project_operation

    def lock_then_runtime_unavailable(*args, **kwargs):
        original_lock(*args, **kwargs)
        client.app.state.hermes_store = None

    monkeypatch.setattr(events_ingest, "require_project_operation", lock_then_runtime_unavailable)
    rid = first["receipt_id"]
    response = client.post(f"/api/v1/events/{rid}:retry", json={
        "expected_revision": first["processing"]["revision"], "idempotency_key": "runtime-lost-after-lock",
        "reason": "Recover the same failed collection after reviewing its original.",
    })
    assert response.status_code == 403, response.text
    assert "Sensitive observation" not in response.text and "reflection_recorded" not in response.text
    with sessions() as db:
        assert db.get(m.EventProcessing, rid).revision == first["processing"]["revision"]
        attempts = db.scalars(select(m.EventProcessingAttempt).where(m.EventProcessingAttempt.receipt_id == rid)).all()
        assert len(attempts) == 1


def test_unavailable_runtime_during_intake_rolls_back_the_entire_uncommitted_batch(execution_source):
    client, sessions, _, _, _, _, data = execution_source
    client.app.state.hermes_store = None
    response = send(client, reflection("good-task"), reflection("requires-runtime", data=data))
    assert response.status_code == 503, response.text
    with sessions() as db:
        assert db.scalar(select(m.EventInbox.id)) is None


def test_fixed_private_input_replay_does_not_depend_on_runtime_but_content_does(execution_source):
    from test_reflection_inputs import prepare_body

    client, sessions, actor, _, _, _, data = execution_source
    rid = result(send(client, reflection(data=data)))["receipt_id"]
    body = prepare_body(client, sessions, [rid])
    first = client.post("/api/v1/delivery/commands", json=body)
    assert first.status_code == 200, first.text
    iid = first.json()["resource"]["id"]
    client.app.state.hermes_store = None
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"] is True
    assert replay.json()["result"] == {"status": "prepared", "source_count": 1}
    assert "E-private" not in replay.text and "Sensitive observation" not in replay.text
    assert client.get(f"/api/v1/reflections/inputs/{iid}").status_code == 503
    actor["id"] = "other-user"
    assert client.get("/api/v1/reflections/inputs").json()["total"] == 1


def test_processed_history_survives_original_producer_becoming_inactive(reflection_env):
    client, sessions, actor, _ = reflection_env
    rid = result(send(client, reflection()))["receipt_id"]
    actor["id"] = "other-user"
    with sessions() as db:
        db.get(m.User, "lead").status = "disabled"
        db.commit()
    current = client.get(f"/api/v1/reflections/{rid}")
    assert current.status_code == 200, current.text
    assert current.json()["available"] is True
    assert current.json()["source"]["producer_id"] == "lead"
