"""Bounded reflection reads and immutable, exact-source selection commands."""

import json

import pytest
from sop_manager.routers import sql_models as m
from sqlalchemy import delete, event, func, select

from test_event_handoff import env, result, send, version  # noqa: F401
from test_reflection_intake import reflection, reflection_env  # noqa: F401


def exact(client, rid):
    response = client.get(f"/api/v1/reflections/{rid}")
    assert response.status_code == 200, response.text
    return response.json()


def prepare_body(client, sessions, ids, key="fixed-reflection-input", **changes):
    payload = {
        "title": "Recoverable input",
        "rationale": "Review these exact sources before any future analysis.",
        "sources": [exact(client, rid)["selection_reference"] for rid in ids],
        **changes,
    }
    return {
        "action": "reflection.input.create",
        "expected_version": version(sessions),
        "idempotency_key": key,
        "payload": payload,
    }


def test_metadata_pages_have_fixed_window_and_never_select_full_originals(reflection_env):
    client, sessions, _, _ = reflection_env
    ids = [result(send(client, reflection(f"r-{index}")))["receipt_id"] for index in range(23)]
    statements = []

    def watch(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = sessions.kw["bind"]
    event.listen(engine, "before_cursor_execute", watch)
    try:
        first_response = client.get("/api/v1/reflections")
    finally:
        event.remove(engine, "before_cursor_execute", watch)
    assert first_response.status_code == 200, first_response.text
    first = first_response.json()
    assert first["total"] == 23 and len(first["items"]) == 20
    assert first["has_more"] and first["next_cursor"]
    assert all("event_json" not in statement for statement in statements)
    assert all("observation" not in row and "selection_reference" not in row for row in first["items"])
    assert ids[0] not in {row["id"] for row in first["items"]}
    assert exact(client, ids[0])["selection_reference"]["reflection_id"] == ids[0]
    result(send(client, reflection("later")))
    second = client.get("/api/v1/reflections", params={"cursor": first["next_cursor"]}).json()
    assert second["total"] == 23 and len(second["items"]) == 3
    assert ids[0] in {row["id"] for row in second["items"]}
    assert not second["has_more"]
    assert client.get("/api/v1/reflections", params={"cursor": first["next_cursor"], "limit": 19}).status_code == 422
    assert client.get("/api/v1/reflections", params={"cursor": first["next_cursor"] + "x"}).status_code == 422


def test_input_commit_replays_original_small_ack_after_source_disappears(reflection_env):
    client, sessions, _, _ = reflection_env
    rid = result(send(client, reflection()))["receipt_id"]
    body = prepare_body(client, sessions, [rid])
    committed = client.post("/api/v1/delivery/commands", json=body)
    assert committed.status_code == 200, committed.text
    ack = committed.json()
    assert ack["resource"]["kind"] == "reflection_input"
    assert ack["result"] == {"status": "prepared", "source_count": 1}
    assert ack["affected_refs"] == [ack["resource"]]
    assert ack["applied_version"] == body["expected_version"] + 1
    with sessions() as db:
        # Controlled storage loss, outside application Session protections.
        db.connection().execute(delete(m.EventInbox).where(m.EventInbox.id == rid))
        db.commit()
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"] is True
    assert replay.json()["resource"] == ack["resource"]
    assert replay.json()["applied_version"] == ack["applied_version"]
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.ReflectionInput)) == 1
    detail = client.get(f"/api/v1/reflections/inputs/{ack['resource']['id']}").json()
    assert detail["input"]["source_count"] == 1
    assert len(detail["sources"]) == 1 and not detail["sources"][0]["available"]
    assert detail["sources"][0]["reflection_id"] == rid
    changed = json.loads(json.dumps(body))
    changed["payload"]["rationale"] = "A different reviewed selection."
    assert client.post("/api/v1/delivery/commands", json=changed).status_code == 409


@pytest.mark.parametrize("bad_field", ["source_digest", "attempt_id", "reflection_id"])
def test_selection_failure_is_atomic_and_does_not_use_a_similar_source(reflection_env, bad_field):
    client, sessions, _, _ = reflection_env
    ids = [result(send(client, reflection(f"r-{index}")))["receipt_id"] for index in range(2)]
    body = prepare_body(client, sessions, ids)
    body["payload"]["sources"][1][bad_field] = "0" * (64 if bad_field == "source_digest" else 32)
    response = client.post("/api/v1/delivery/commands", json=body)
    assert response.status_code in {404, 409}, response.text
    assert version(sessions) == body["expected_version"]
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.ReflectionInput)) == 0
        assert db.scalar(select(func.count()).select_from(m.DeliveryReceipt)) == 0


def test_corrupted_original_is_not_adopted_even_if_stored_digest_column_did_not_change(reflection_env):
    client, sessions, _, _ = reflection_env
    rid = result(send(client, reflection()))["receipt_id"]
    original_ref = exact(client, rid)["selection_reference"]
    with sessions() as db:
        db.connection().execute(
            m.EventInbox.__table__.update()
            .where(m.EventInbox.id == rid)
            .values(event_json=reflection()["event_json"].replace("Recover the original", "Altered the original"))
        )
        db.commit()
    current = exact(client, rid)
    assert not current["available"] and current["selection_reference"] is None
    assert current["source"] is None and current["statement"] is None
    body = {
        "action": "reflection.input.create",
        "expected_version": version(sessions),
        "idempotency_key": "do-not-adopt-corrupted",
        "payload": {"title": "Selection", "rationale": "Reviewed exact source", "sources": [original_ref]},
    }
    assert client.post("/api/v1/delivery/commands", json=body).status_code == 409


def test_current_missing_link_preserves_historical_statement_but_disables_new_selection(reflection_env):
    client, sessions, _, _ = reflection_env
    rid = result(send(client, reflection()))["receipt_id"]
    with sessions() as db:
        db.delete(db.get(m.Task, "T-task"))
        db.commit()
    value = exact(client, rid)
    assert value["available"] is True
    assert value["statement"]["title"] == "Recover the original operation"
    assert value["links"][0]["available"] is False
    assert value["selection_reference"] is None


def test_oversize_original_exact_measures_bytes_before_loading_body(reflection_env):
    client, sessions, _, _ = reflection_env
    rid = result(send(client, reflection()))["receipt_id"]
    with sessions() as db:
        db.connection().execute(m.EventInbox.__table__.update().where(m.EventInbox.id == rid).values(event_json="x" * 1000000))
        db.commit()
    statements = []
    engine = sessions.kw["bind"]

    def watch(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())

    event.listen(engine, "before_cursor_execute", watch)
    try:
        current = exact(client, rid)
    finally:
        event.remove(engine, "before_cursor_execute", watch)
    assert current["source"] is None and not current["available"]
    # SQL length over the stored column is allowed; returning the body column is not.
    assert any("length(cast(event_inbox.event_json" in sql for sql in statements)
    assert not any("event_inbox.event_json," in sql or "select event_inbox.event_json " in sql for sql in statements)


@pytest.mark.parametrize("suffix", ["", "/attempts"])
def test_oversize_generic_reflection_read_measures_bytes_before_loading_body(reflection_env, suffix):
    client, sessions, _, _ = reflection_env
    rid = result(send(client, reflection()))["receipt_id"]
    with sessions() as db:
        db.connection().execute(m.EventInbox.__table__.update().where(m.EventInbox.id == rid).values(event_json="x" * 1000000))
        db.commit()
    statements = []
    engine = sessions.kw["bind"]

    def watch(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())

    event.listen(engine, "before_cursor_execute", watch)
    try:
        response = client.get(f"/api/v1/events/{rid}{suffix}")
    finally:
        event.remove(engine, "before_cursor_execute", watch)
    assert response.status_code == 403, response.text
    assert any("length(cast(event_inbox.event_json" in sql for sql in statements)
    assert not any("event_inbox.event_json," in sql or "select event_inbox.event_json " in sql for sql in statements)


@pytest.mark.parametrize("field", ["title", "rationale"])
def test_fixed_input_rejects_unpaired_surrogate_as_validation_error(reflection_env, field):
    client, sessions, _, _ = reflection_env
    rid = result(send(client, reflection()))["receipt_id"]
    body = prepare_body(client, sessions, [rid])
    body["payload"][field] = "bad\ud800text"
    # Exercise the actual HTTP failure response rather than letting TestClient
    # promote an application exception into a test harness error.
    original = client._transport.raise_server_exceptions
    client._transport.raise_server_exceptions = False
    try:
        response = client.post("/api/v1/delivery/commands", content=json.dumps(body, ensure_ascii=True), headers={"Content-Type": "application/json"})
    finally:
        client._transport.raise_server_exceptions = original
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "reflection_selection_invalid"
    assert version(sessions) == body["expected_version"]
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.ReflectionInput)) == 0
        assert db.scalar(select(func.count()).select_from(m.DeliveryReceipt)) == 0


@pytest.mark.parametrize(("dialect_name", "function"), [
    ("sqlite", "json_array_length"), ("postgresql", "json_array_length"), ("mysql", "json_length"),
])
def test_input_directory_source_count_uses_the_supported_json_array_function(dialect_name, function):
    from sqlalchemy.dialects import mysql, postgresql, sqlite
    from sop_manager.routers.reflection_query import source_count

    dialect = {"sqlite": sqlite, "postgresql": postgresql, "mysql": mysql}[dialect_name].dialect()
    statement = select(source_count(m.ReflectionInput.sources, dialect_name))
    sql = str(statement.compile(dialect=dialect)).lower()
    assert f"{function}(reflection_inputs.sources)" in sql
    assert ("json_length(" in sql) is (dialect_name == "mysql")


def test_all_reflection_gets_are_read_only_without_an_implicit_rebuild(reflection_env):
    client, sessions, _, _ = reflection_env
    rid = result(send(client, reflection()))["receipt_id"]
    body = prepare_body(client, sessions, [rid])
    committed = client.post("/api/v1/delivery/commands", json=body)
    assert committed.status_code == 200, committed.text
    iid = committed.json()["resource"]["id"]
    writes = []

    def watch(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().lower().startswith(("insert", "update", "delete", "create", "alter")):
            writes.append(statement)

    engine = sessions.kw["bind"]
    event.listen(engine, "before_cursor_execute", watch)
    try:
        for path in (
            "/api/v1/reflections",
            f"/api/v1/reflections/{rid}",
            "/api/v1/reflections/inputs",
            f"/api/v1/reflections/inputs/{iid}",
        ):
            response = client.get(path)
            assert response.status_code == 200, response.text
    finally:
        event.remove(engine, "before_cursor_execute", watch)
    assert writes == []


@pytest.mark.parametrize("model_name", ["ReflectionRecord", "ReflectionInput"])
@pytest.mark.parametrize("operation", ["orm_insert", "core_insert", "orm_update", "core_update", "orm_delete", "core_delete"])
def test_reflection_facts_require_exact_append_authority_and_remain_immutable(reflection_env, model_name, operation):
    from fastapi import HTTPException
    from sqlalchemy import insert, update

    client, sessions, _, _ = reflection_env
    rid = result(send(client, reflection()))["receipt_id"]
    body = prepare_body(client, sessions, [rid])
    response = client.post("/api/v1/delivery/commands", json=body)
    assert response.status_code == 200, response.text
    model = getattr(m, model_name)
    with sessions() as db:
        row = db.scalar(select(model))
        values = {column.key: getattr(row, column.key) for column in model.__table__.columns if column.key != "seq"}
        original_id = row.id
        values["id"] = "manufactured-fact"
        if model_name == "ReflectionRecord":
            values["receipt_id"], values["attempt_id"] = "manufactured-receipt", "manufactured-attempt"
        with pytest.raises(HTTPException):
            if operation == "orm_insert":
                db.add(model(**values))
                db.flush()
            elif operation == "core_insert":
                db.execute(insert(model).values(**values))
            elif operation == "orm_update":
                row.id = "changed"
                db.flush()
            elif operation == "core_update":
                db.execute(update(model).where(model.id == original_id).values(id="changed"))
            elif operation == "orm_delete":
                db.delete(row)
                db.flush()
            else:
                db.execute(delete(model).where(model.id == original_id))
        db.rollback()
        assert db.scalar(select(func.count()).select_from(model)) == 1


def test_archived_project_replays_small_input_ack_but_cannot_prepare_another(reflection_env):
    from sqlalchemy import update

    client, sessions, _, _ = reflection_env
    rid = result(send(client, reflection()))["receipt_id"]
    body = prepare_body(client, sessions, [rid])
    first = client.post("/api/v1/delivery/commands", json=body)
    assert first.status_code == 200, first.text
    with sessions() as db:
        db.connection().execute(update(m.Project).where(m.Project.id == "project").values(status="archived"))
        db.connection().execute(delete(m.EventInbox).where(m.EventInbox.id == rid))
        db.commit()
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200 and replay.json()["replayed"]
    other = {**body, "idempotency_key": "another-input-after-archive"}
    assert client.post("/api/v1/delivery/commands", json=other).status_code == 409
    page = client.get("/api/v1/reflections/inputs").json()
    assert page["total"] == 1 and not page["permissions"]["prepare"]


def test_downgraded_project_viewer_recovers_only_own_committed_small_ack(reflection_env, monkeypatch):
    from fastapi import HTTPException
    from sop_manager.routers import reflection_query

    client, sessions, _, _ = reflection_env
    rid = result(send(client, reflection()))["receipt_id"]
    body = prepare_body(client, sessions, [rid])
    first = client.post("/api/v1/delivery/commands", json=body)
    assert first.status_code == 200, first.text
    with sessions() as db:
        db.get(m.User, "lead").role = "viewer"
        db.add(m.ProjectMember(project_id="project", user_id="lead", role="viewer"))
        db.commit()

    def unavailable(*args, **kwargs):
        raise HTTPException(503, "Source reads are unavailable")

    monkeypatch.setattr(reflection_query, "exact", unavailable)
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"] and replay.json()["resource"] == first.json()["resource"]
    assert client.post("/api/v1/delivery/commands", json={**body, "idempotency_key": "new-key-after-demotion"}).status_code == 403
    changed = json.loads(json.dumps(body))
    changed["payload"]["rationale"] = "A different body cannot be acknowledged as the original."
    assert client.post("/api/v1/delivery/commands", json=changed).status_code in {403, 409}
