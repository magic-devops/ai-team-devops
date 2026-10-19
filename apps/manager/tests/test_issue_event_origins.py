"""Successful typed tool effects have exact, bounded reverse Issue origins."""

import json

import pytest
from fastapi import HTTPException
from sop_manager.routers import delivery
from sop_manager.routers import sql_models as m
from sop_manager.routers.auth_sql import current_user, current_user_or_apikey
from sqlalchemy import event, select
from test_event_handoff import env, frozen, result, send, version  # noqa: F401


def setup(env):  # noqa: F811
    client, sessions, actor, _, app = env
    app.include_router(delivery.router)
    app.dependency_overrides[current_user] = app.dependency_overrides[current_user_or_apikey]
    return client, sessions, actor


def opened(client, sessions, eid="opened"):
    return result(send(client, frozen(eid=eid, etype="sop.issue.opened", data={
        "expected_version": version(sessions), "title": "Actual Issue", "task_id": "T-task",
    })))


def sync(client, sessions, action, iid, eid):
    return result(send(client, frozen(eid=eid, etype="sop.sync.push", data={
        "expected_version": version(sessions), "module": "issues", "action": action,
        "record": {"id": iid, **({"title": "Actual synced Issue"} if action != "delete" else {})},
    })))


def table_snapshot(sessions):
    with sessions() as db:
        return {table.name: [list(row) for row in db.execute(select(table)).all()]
                for table in m.Base.metadata.sorted_tables}


def test_opened_and_typed_sync_origins_are_real_unique_and_pure(env):  # noqa: F811
    client, sessions, _ = setup(env)
    first = opened(client, sessions)
    iid = first["processing"]["result"]["target_id"]
    result(send(client, frozen(eid="claimed", subject=iid, data={"issue_id": iid, "run_id": "private-claim"})))
    created = sync(client, sessions, "create", "ISS-fixed", "sync-create")
    assert first["processing"]["state"] == created["processing"]["state"] == "processed"
    before = table_snapshot(sessions)
    page = client.get(f"/api/v1/delivery/issues/{iid}/origins")
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["total"] == 1 and body["issue_available"] is True
    row = body["items"][0]
    assert (row["operation"], row["effect_kind"], row["receipt_id"]) == ("create", "issue_created", first["receipt_id"])
    assert row["available"] and row["evidence"]["id"] == "event:" + row["id"]
    assert row["evidence"]["target"]["receipt_id"] == first["receipt_id"]
    assert "private-claim" not in json.dumps(body) and "event_json" not in json.dumps(body)
    exact = client.get(f"/api/v1/delivery/issues/{iid}/origins/{row['id']}")
    assert exact.status_code == 200 and exact.json()["origin"] == row
    detail = client.get(f"/api/v1/delivery/issues/{iid}").json()
    assert detail["origin_summary"] == {"total": 1, "projection": "current"}
    assert [item["kind"] for item in detail["evidence"]] == ["issue", "task"]
    filtered = client.get("/api/v1/delivery/issues?source=event")
    assert filtered.status_code == 200 and filtered.json()["total"] == 2
    assert all(item["source_kinds"] == ["event"] for item in filtered.json()["items"])
    assert client.get(f"/api/v1/delivery/issues/{iid}/origins", headers={"X-Project-Id": "other"}).status_code == 404
    for url in (f"/api/v1/delivery/issues/{iid}/origins", f"/api/v1/delivery/issues/{iid}/origins/{row['id']}"):
        assert client.get(url, headers={"X-Project-Id": ""}).status_code == 400
        request = client.build_request("GET", url)
        del request.headers["X-Project-Id"]
        assert client.send(request).status_code == 400
    assert table_snapshot(sessions) == before


def test_sync_update_delete_history_window_and_exact_selection(env):  # noqa: F811
    client, sessions, actor = setup(env)
    first = sync(client, sessions, "create", "ISS-fixed", "create")
    assert first["processing"]["state"] == "processed"
    updated = sync(client, sessions, "update", "ISS-fixed", "update")
    assert updated["processing"]["state"] == "processed", updated
    page = client.get("/api/v1/delivery/issues/ISS-fixed/origins?limit=1").json()
    assert page["total"] == 2 and page["items"][0]["operation"] == "update"
    cursor = page["next_cursor"]
    assert cursor
    deleted = sync(client, sessions, "delete", "ISS-fixed", "delete")
    assert deleted["processing"]["state"] == "processed", deleted
    rest = client.get("/api/v1/delivery/issues/ISS-fixed/origins", params={"limit": 1, "cursor": cursor})
    assert rest.status_code == 200, rest.text
    assert rest.json()["total"] == 2 and rest.json()["items"][0]["operation"] == "create"
    assert rest.json()["issue_available"] is False
    assert client.get("/api/v1/delivery/issues/ISS-fixed/origins", params={"limit": 2, "cursor": cursor}).status_code == 422
    actor["id"] = "other-user"
    assert client.get("/api/v1/delivery/issues/ISS-fixed/origins", params={"limit": 1, "cursor": cursor}).status_code == 422


def test_selected_origin_outside_default_evidence_is_fixed_and_revalidated(env):  # noqa: F811
    client, sessions, _ = setup(env)
    first = opened(client, sessions)
    iid = first["processing"]["result"]["target_id"]
    original = client.get(f"/api/v1/delivery/issues/{iid}").json()
    page = client.get(f"/api/v1/delivery/issues/{iid}/origins").json()
    origin = page["items"][0]
    response = client.post(f"/api/v1/delivery/issues/{iid}/diagnoses", json={
        "expected_version": original["version"], "issue_basis": original["issue_basis"],
        "selected_evidence_ids": [f"issue:{iid}", origin["evidence"]["id"]],
        "generator": "rules", "idempotency_key": "origin-diagnosis-fixed",
    })
    assert response.status_code == 200, response.text
    proposal = response.json()
    assert proposal["current"] and proposal["actions"]["can_adopt"]
    assert proposal["snapshot"]["evidence"][1] == origin["evidence"]
    # A failed extra event cannot replace a fixed selection or create a new origin.
    result(send(client, frozen(eid="bad", etype="sop.sync.push", data={
        "expected_version": 0, "module": "issues", "action": "update", "record": {"id": iid, "title": "bad"},
    })))
    view = client.get(f"/api/v1/delivery/issues/{iid}/diagnoses/{proposal['id']}").json()
    assert view["current"] and view["snapshot"] == proposal["snapshot"]
    with sessions() as db:
        # Direct migration outside application Session guards simulates damage.
        db.connection().execute(m.EventInbox.__table__.update().where(m.EventInbox.id == first["receipt_id"]).values(digest="0" * 64))
        db.commit()
    invalid = client.get(f"/api/v1/delivery/issues/{iid}/diagnoses/{proposal['id']}").json()
    assert not invalid["current"] and not invalid["actions"]["can_adopt"]
    exact = client.get(f"/api/v1/delivery/issues/{iid}/origins/{origin['id']}").json()["origin"]
    assert not exact["available"] and exact["evidence"]["missing"]


def test_origin_projection_is_append_only_and_not_client_insertable(env):  # noqa: F811
    client, sessions, _ = setup(env)
    opened(client, sessions)
    with sessions() as db:
        row = db.scalar(select(m.IssueEventOrigin))
        row.operation = "delete"
        with pytest.raises(HTTPException) as denied:
            db.commit()
        assert denied.value.detail["code"] == "event_origin_immutable"
        db.rollback()
        db.add(m.IssueEventOrigin(id="fake", tenant_id="tenant", project_id="project", issue_id="fake", receipt_id="fake", attempt_id="fake", operation="create", effect_kind="issue_created", digest="0" * 64))
        with pytest.raises(HTTPException) as denied:
            db.commit()
        assert denied.value.detail["code"] == "event_origin_command_required"


def test_replay_and_upsert_keep_actual_operation_and_unrelated_origin_basis(env):  # noqa: F811
    client, sessions, _ = setup(env)
    raw = frozen(eid="once", etype="sop.issue.opened", data={"expected_version": version(sessions), "title": "Once"})
    first = result(send(client, raw))
    iid = first["processing"]["result"]["target_id"]
    before_version = version(sessions)
    assert result(send(client, raw))["receipt_id"] == first["receipt_id"]
    assert version(sessions) == before_version
    detail = client.get(f"/api/v1/delivery/issues/{iid}").json()
    original = client.get(f"/api/v1/delivery/issues/{iid}/origins").json()["items"][0]
    generated = client.post(f"/api/v1/delivery/issues/{iid}/diagnoses", json={
        "expected_version": detail["version"], "issue_basis": detail["issue_basis"],
        "selected_evidence_ids": [f"issue:{iid}", "event:" + original["id"]],
        "generator": "rules", "idempotency_key": "stable-unrelated-origins",
    }).json()
    assert generated["current"]
    # A no-op business update adds provenance but changes no Issue semantics.
    unchanged = result(send(client, frozen(eid="noop", etype="sop.sync.push", data={
        "expected_version": version(sessions), "module": "issues", "action": "upsert", "record": {"id": iid},
    })))
    assert unchanged["processing"]["state"] == "processed"
    view = client.get(f"/api/v1/delivery/issues/{iid}/diagnoses/{generated['id']}").json()
    assert view["current"] and view["snapshot"] == generated["snapshot"]
    assert client.get(f"/api/v1/delivery/issues/{iid}").json()["issue_basis"] == detail["issue_basis"]
    origins = client.get(f"/api/v1/delivery/issues/{iid}/origins").json()["items"]
    assert [row["operation"] for row in origins] == ["update", "create"]
    # The original selection remains valid outside a later first-page window,
    # during exact request replay, history reads and the actual human adoption.
    assert client.get(f"/api/v1/delivery/issues/{iid}/origins?limit=1").json()["items"][0]["id"] != original["id"]
    replay = client.post(f"/api/v1/delivery/issues/{iid}/diagnoses", json={
        "expected_version": detail["version"], "issue_basis": detail["issue_basis"],
        "selected_evidence_ids": [f"issue:{iid}", "event:" + original["id"]],
        "generator": "rules", "idempotency_key": "stable-unrelated-origins",
    })
    assert replay.status_code == 200 and replay.json()["current"]
    history = client.get(f"/api/v1/delivery/issues/{iid}/diagnoses").json()
    assert history["items"][0]["current"] and history["items"][0]["snapshot"] == generated["snapshot"]
    command = {"action": "issue.diagnosis.adopt", "expected_version": version(sessions),
        "idempotency_key": "origin-human-adoption", "payload": {
            **generated["result"]["requirement"], "issue_id": iid, "diagnosis_id": generated["id"],
            "issue_basis": detail["issue_basis"], "comment": "Human checked the exact original tool source",
        }}
    adopted = client.post("/api/v1/delivery/commands", json=command)
    assert adopted.status_code == 200, adopted.text
    assert client.post("/api/v1/delivery/commands", json=command).json()["replayed"]
    with sessions() as db:
        assert db.query(m.Requirement).count() == 1
        assert db.get(m.Issue, iid).status == "open"
    created = sync(client, sessions, "upsert", "ISS-upsert", "upsert-create")
    assert created["processing"]["state"] == "processed"
    assert client.get("/api/v1/delivery/issues/ISS-upsert/origins").json()["items"][0]["operation"] == "create"


def test_projection_failure_rolls_back_business_receipt_and_attempt(env, monkeypatch):  # noqa: F811
    client, sessions, _ = setup(env)
    from sop_manager.routers import delivery_issue_origins

    def fail_projection(*args, **kwargs):
        raise RuntimeError("projection failed before commit")

    monkeypatch.setattr(delivery_issue_origins, "append_origin", fail_projection)
    before = version(sessions)
    attempt = opened(client, sessions)
    assert attempt["processing"]["state"] == "failed"
    assert version(sessions) == before
    with sessions() as db:
        assert db.scalar(select(m.Issue.id)) is None
        assert db.scalar(select(m.IssueEventOrigin.id)) is None
        assert db.scalar(select(m.DeliveryReceipt.id)) is None
        assert db.scalar(select(m.EventProcessingAttempt.to_state)) == "failed"


def test_explicit_rebuild_repairs_only_verified_origins_in_archived_projects(env):  # noqa: F811
    client, sessions, _ = setup(env)
    first = opened(client, sessions)
    iid = first["processing"]["result"]["target_id"]
    with sessions() as db:
        connection = db.connection()
        connection.execute(m.IssueEventOrigin.__table__.delete().where(m.IssueEventOrigin.project_id == "project"))
        connection.execute(m.DeliveryQueryState.__table__.update().where(m.DeliveryQueryState.project_id == "project").values(schema_version=3))
        connection.execute(m.Project.__table__.update().where(m.Project.id == "project").values(status="archived"))
        db.commit()
    before = table_snapshot(sessions)
    assert client.get(f"/api/v1/delivery/issues/{iid}").json()["origin_summary"] == {"total": 0, "projection": "rebuild_required"}
    assert table_snapshot(sessions) == before
    rebuilt = client.post("/api/v1/delivery/query/rebuild")
    assert rebuilt.status_code == 200, rebuilt.text
    assert rebuilt.json()["query_state"]["schema_version"] == 5
    assert rebuilt.json()["origin_rebuild"] == {"added": 1, "existing": 0, "skipped": 0}
    after = table_snapshot(sessions)
    for table in before:
        if table not in {"issue_event_origins", "delivery_query_facts", "delivery_query_states"}:
            assert before[table] == after[table], table
    assert client.post("/api/v1/delivery/query/rebuild").json()["origin_rebuild"] == {"added": 0, "existing": 1, "skipped": 0}
    assert client.get(f"/api/v1/delivery/issues/{iid}/origins").json()["total"] == 1


def test_rebuild_skips_unverifiable_success_instead_of_guessing_operation(env):  # noqa: F811
    client, sessions, _ = setup(env)
    first = opened(client, sessions)
    iid = first["processing"]["result"]["target_id"]
    with sessions() as db:
        connection = db.connection()
        connection.execute(m.IssueEventOrigin.__table__.delete().where(m.IssueEventOrigin.project_id == "project"))
        connection.execute(m.DeliveryEvent.__table__.delete().where(m.DeliveryEvent.project_id == "project"))
        db.commit()
    before_version = version(sessions)
    rebuilt = client.post("/api/v1/delivery/query/rebuild")
    assert rebuilt.status_code == 200, rebuilt.text
    assert rebuilt.json()["origin_rebuild"] == {"added": 0, "existing": 0, "skipped": 1}
    assert version(sessions) == before_version
    assert client.get(f"/api/v1/delivery/issues/{iid}").json()["origin_summary"]["projection"] == "rebuild_required"


def test_cursor_tampering_and_cross_issue_exact_source_cannot_choose_first(env):  # noqa: F811
    client, sessions, actor = setup(env)
    first = opened(client, sessions)
    iid = first["processing"]["result"]["target_id"]
    sync(client, sessions, "upsert", iid, "noop")
    page = client.get(f"/api/v1/delivery/issues/{iid}/origins?limit=1").json()
    row = page["items"][0]
    assert client.get(f"/api/v1/delivery/issues/{iid}/origins", params={"limit": 1, "cursor": page["next_cursor"] + "x"}).status_code == 422
    assert client.get(f"/api/v1/delivery/issues/different/origins/{row['id']}").status_code == 404
    assert client.get(f"/api/v1/delivery/issues/{iid}/origins/missing").status_code == 404
    with sessions() as db:
        db.get(m.User, actor["id"]).status = "disabled"
        db.commit()
    assert client.get(f"/api/v1/delivery/issues/{iid}/origins/{row['id']}").status_code == 403


def test_origin_page_loads_only_exact_bounded_originals_and_attempts(env):  # noqa: F811
    client, sessions, _ = setup(env)
    first = opened(client, sessions)
    iid = first["processing"]["result"]["target_id"]
    for index in range(5):
        result(send(client, frozen(eid=f"budget-{index}", etype="sop.sync.push", data={
            "expected_version": version(sessions), "module": "issues", "action": "upsert", "record": {"id": iid},
        })))
    before = table_snapshot(sessions)
    statements = []
    engine = sessions.kw["bind"]

    def capture(connection, cursor, sql, parameters, context, executemany):
        statements.append(sql)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.get(f"/api/v1/delivery/issues/{iid}/origins?limit=2")
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 6 and len(response.json()["items"]) == 2
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    for table in ("event_inbox", "event_processing_attempts"):
        selected = [sql for sql in statements if f"FROM {table}" in sql]
        assert len(selected) == 2
        assert all(f"{table}.id =" in sql for sql in selected)
        assert all(f"{table}.tenant_id =" in sql and f"{table}.project_id =" in sql for sql in selected)
    assert all(sql.lstrip().upper().startswith(("SELECT", "PRAGMA")) for sql in statements)
    assert table_snapshot(sessions) == before


def test_actual_origin_insert_fault_rolls_back_then_original_retry_creates_one_origin(env):  # noqa: F811
    client, sessions, _ = setup(env)
    with sessions() as db:
        db.connection().exec_driver_sql(
            "CREATE TRIGGER reject_origin BEFORE INSERT ON issue_event_origins "
            "BEGIN SELECT RAISE(ABORT, 'origin fault'); END"
        )
        db.commit()
    before = version(sessions)
    failed = opened(client, sessions)
    assert failed["processing"]["state"] == "failed" and version(sessions) == before
    with sessions() as db:
        for model in (m.Issue, m.IssueEventOrigin, m.DeliveryReceipt, m.DeliveryEvent):
            assert db.scalar(select(model).limit(1)) is None
        assert db.scalar(select(m.EventProcessingAttempt.to_state)) == "failed"
        db.connection().exec_driver_sql("DROP TRIGGER reject_origin")
        db.commit()
    body = {"expected_revision": failed["processing"]["revision"],
        "idempotency_key": "recover-origin-insert", "reason": "Reviewed failed transaction; retry original"}
    response = client.post(f"/api/v1/events/{failed['receipt_id']}:retry", json=body)
    assert response.status_code == 200, response.text
    success = response.json()
    assert success["processing"]["state"] == "processed" and version(sessions) == before + 1
    assert client.post(f"/api/v1/events/{failed['receipt_id']}:retry", json=body).json()["replayed"]
    iid = success["processing"]["result"]["target_id"]
    origins = client.get(f"/api/v1/delivery/issues/{iid}/origins").json()
    assert origins["total"] == 1 and origins["items"][0]["attempt_id"] == success["attempt_id"]


@pytest.mark.parametrize("operation", ["opened", "create", "upsert", "update", "delete"])
@pytest.mark.parametrize("shape", ["missing", "null", "array"])
def test_historical_operation_requires_verifiable_before_shape(env, operation, shape):  # noqa: F811
    client, sessions, _ = setup(env)
    if operation in {"update", "delete"}:
        assert sync(client, sessions, "create", "ISS-history", "create-first")["processing"]["state"] == "processed"
    result = opened(client, sessions) if operation == "opened" else sync(client, sessions, operation, "ISS-history", "historical")
    assert result["processing"]["state"] == "processed"
    with sessions() as db:
        connection = db.connection()
        connection.execute(m.IssueEventOrigin.__table__.delete().where(m.IssueEventOrigin.receipt_id == result["receipt_id"]))
        event = db.execute(select(m.DeliveryEvent.id, m.DeliveryEvent.data).where(m.DeliveryEvent.project_id == "project")
            .order_by(m.DeliveryEvent.version.desc()).limit(1)).first()
        data = dict(event.data)
        if shape == "missing":
            data.pop("before")
        else:
            data["before"] = None if shape == "null" else []
        connection.execute(m.DeliveryEvent.__table__.update().where(m.DeliveryEvent.id == event.id).values(data=data))
        db.commit()
    before_version = version(sessions)
    response = client.post("/api/v1/delivery/query/rebuild")
    assert response.status_code == 200, response.text
    verified = shape == "null" and operation in {"opened", "create", "upsert"}
    assert response.json()["origin_rebuild"] == {"added": int(verified), "existing": int(operation in {"update", "delete"}), "skipped": int(not verified)}
    assert version(sessions) == before_version
