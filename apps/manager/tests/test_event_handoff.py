"""Durable scoped event receipts and real original-version effects."""

import hashlib
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sop_manager.project_write_guard import ManagerSession
from sop_manager.routers import events_ingest
from sop_manager.routers import sql_models as m
from sop_manager.routers.auth_sql import current_user_or_apikey
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

UNUSABLE_HASH = "not-a-login"


@pytest.fixture
def env(tmp_path, monkeypatch, request):
    url = (
        "sqlite:///" + str(tmp_path / "events.sqlite")
        if getattr(request, "param", None) == "file"
        else "sqlite://"
    )
    engine = create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", m._configure_sqlite)
    m.Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, class_=ManagerSession, autoflush=False, expire_on_commit=False)
    with sessions() as db:
        db.add(m.Tenant(id="tenant", name="Tenant", slug="tenant"))
        db.flush()
        db.add_all(
            [
                m.User(
                    id="lead",
                    tenant_id="tenant",
                    username="Lead",
                    password_hash=UNUSABLE_HASH,
                    role="tenant_admin",
                    status="active",
                ),
                m.User(
                    id="other-user",
                    tenant_id="tenant",
                    username="Other",
                    password_hash=UNUSABLE_HASH,
                    role="tenant_admin",
                    status="active",
                ),
            ]
        )
        db.flush()
        db.add_all(
            [
                m.Project(id="project", tenant_id="tenant", name="Project", project_path=str(tmp_path)),
                m.Project(id="other", tenant_id="tenant", name="Other", project_path=str(tmp_path / "other")),
            ]
        )
        db.flush()
        db.add(
            m.Task(
                id="T-task",
                tenant_id="tenant",
                project_id="project",
                title="Task",
                acceptance_criteria=["Finish work"],
            )
        )
        db.commit()
    actor = {"id": "lead"}

    def session():
        with sessions() as db:
            yield db

    def identity():
        with sessions() as db:
            return db.get(m.User, actor["id"])

    app = FastAPI()
    app.include_router(events_ingest.router)
    app.dependency_overrides[m.get_session] = session
    app.dependency_overrides[current_user_or_apikey] = identity
    client = TestClient(app, headers={"X-Project-Id": "project"})
    yield client, sessions, actor, tmp_path, app
    engine.dispose()


def frozen(eid="event-1", etype="sop.example.fact", data=None, subject=""):
    raw = json.dumps(
        {
            "specversion": "1.0",
            "id": eid,
            "type": etype,
            "source": "test",
            "subject": subject,
            "time": "2026-10-18T00:00:00Z",
            "datacontenttype": "application/json",
            "data": data or {},
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return {"id": eid, "event_json": raw, "digest": hashlib.sha256(raw.encode()).hexdigest()}


def send(client, *items, project="project", producer="lead"):
    return client.post(
        "/api/v1/events:ingest",
        headers={"X-Project-Id": project},
        json={
            "expected_tenant_id": "tenant",
            "expected_project_id": project,
            "expected_producer_id": producer,
            "events": list(items),
        },
    )


def result(response):
    assert response.status_code == 200, response.text
    return response.json()["results"][0]


def version(sessions):
    with sessions() as db:
        row = db.get(m.DeliveryWorkspace, "project")
        return row.version if row else 0


def test_exact_original_receipt_survives_independent_sessions_and_no_business_capture(env, monkeypatch):
    client, sessions, _, _, _ = env
    from sop_manager.routers import delivery_progress_capture, delivery_query_index

    def forbidden(*args, **kwargs):
        pytest.fail("generic event invoked business observation")

    monkeypatch.setattr(delivery_progress_capture, "record_observation", forbidden)
    monkeypatch.setattr(delivery_query_index, "replace_from_evaluation", forbidden)
    first = result(send(client, frozen()))
    assert first["outcome"] == "stored" and first["receipt_id"]
    assert first["processing"]["state"] == "pending"
    second = result(send(client, frozen()))
    assert second["outcome"] == "duplicate"
    assert (second["receipt_id"], second["stored_at"], second["digest"]) == (
        first["receipt_id"],
        first["stored_at"],
        first["digest"],
    )
    with sessions() as db:
        assert db.query(m.EventInbox).count() == 1


def test_different_bytes_conflict_and_scope_and_producer_are_independent(env):
    client, _, actor, _, _ = env
    first = result(send(client, frozen()))
    conflict = result(send(client, frozen(data={"changed": True})))
    assert conflict["outcome"] == "rejected" and conflict["error"]["code"] == "event_digest_conflict"
    assert result(send(client, frozen(), project="other"))["receipt_id"] != first["receipt_id"]
    actor["id"] = "other-user"
    assert send(client, frozen()).status_code == 409
    assert result(send(client, frozen(), producer="other-user"))["receipt_id"] != first["receipt_id"]


def test_actual_task_change_uses_original_version_and_duplicate_does_not_reapply(env):
    client, sessions, _, _, _ = env
    original = version(sessions)
    item = frozen(
        etype="sop.task.status_changed",
        data={
            "expected_version": original,
            "status": "in_progress",
            "notes": "audit only",
            "confidence": 0.7,
        },
        subject="T-task",
    )
    first = result(send(client, item))
    assert first["processing"]["state"] == "processed", first
    with sessions() as db:
        assert db.get(m.Task, "T-task").status == "in_progress"
    changed = version(sessions)
    assert changed == original + 1
    assert result(send(client, item))["processing"]["result"]["target_id"] == "T-task"
    assert version(sessions) == changed
    missing = result(
        send(client, frozen("missing", "sop.task.status_changed", {"status": "completed"}, "T-task"))
    )
    assert (
        missing["processing"]["state"] == "failed"
        and missing["processing"]["reason_code"] == "version_required"
    )
    stale = result(
        send(
            client,
            frozen(
                "stale",
                "sop.task.status_changed",
                {"expected_version": original, "status": "completed"},
                "T-task",
            ),
        )
    )
    assert stale["processing"]["state"] == "failed"
    with sessions() as db:
        assert db.get(m.Task, "T-task").status == "in_progress"


def test_issue_is_created_once_open_under_original_version(env):
    client, sessions, _, _, _ = env
    item = frozen(
        etype="sop.issue.opened",
        data={"expected_version": version(sessions), "title": "Actual issue", "description": "Observed"},
    )
    first = result(send(client, item))
    assert first["processing"]["state"] == "processed", first
    iid = first["processing"]["result"]["target_id"]
    second = result(send(client, item))
    assert second["processing"]["result"]["target_id"] == iid
    with sessions() as db:
        assert db.query(m.Issue).count() == 1
        assert db.get(m.Issue, iid).status == "open"


def test_bad_json_is_per_id_rejected_without_poisoning_good_sibling(env):
    client, sessions, _, _, _ = env
    bad = frozen("bad")
    bad["event_json"] = '{"id":"bad","id":"forged"}'
    bad["digest"] = hashlib.sha256(bad["event_json"].encode()).hexdigest()
    response = send(client, bad, frozen("good"))
    assert response.status_code == 200, response.text
    assert [r["outcome"] for r in response.json()["results"]] == ["rejected", "stored"]
    with sessions() as db:
        assert db.query(m.EventInbox).count() == 1


def test_postcommit_notification_failure_preserves_original_receipt(env, monkeypatch):
    from sop_manager.routers import ws_events

    def failed(*args, **kwargs):
        raise OSError("simulated notification fault")

    monkeypatch.setattr(ws_events, "broadcast", failed)
    first = result(send(env[0], frozen()))
    assert first["outcome"] == "stored"
    assert result(send(env[0], frozen()))["receipt_id"] == first["receipt_id"]


def test_asset_written_before_status_failure_recovers_same_plan_and_exact_bytes(env, monkeypatch):
    client, sessions, _, root, _ = env
    from sop_manager.routers import event_processing

    old = event_processing._attempt
    fault = {"once": True}

    def fail_once(*args, **kwargs):
        if args[6] is None and fault["once"]:
            fault["once"] = False
            raise OSError("simulated SQL state fault after file write")
        return old(*args, **kwargs)

    monkeypatch.setattr(event_processing, "_attempt", fail_once)
    item = frozen(
        etype="sop.sync.push",
        data={
            "expected_version": version(sessions),
            "module": "specs",
            "action": "upsert",
            "record": {"path": "note.md", "content": "line1\r\nline2\r\n"},
        },
    )
    first = result(send(client, item))
    assert first["processing"]["state"] == "failed", first
    assert (root / "sop/custom/specs/note.md").read_bytes() == b"line1\r\nline2\r\n"
    rid = first["receipt_id"]
    body = {
        "expected_revision": first["processing"]["revision"],
        "idempotency_key": "recover",
        "reason": "Retry the original fixed asset plan",
    }
    response = client.post(f"/api/v1/events/{rid}:retry", json=body)
    assert response.status_code == 200, response.text
    ack = response.json()
    assert ack["processing"]["state"] == "processed", ack
    assert client.post(f"/api/v1/events/{rid}:retry", json=body).json() == {**ack, "replayed": True}
    assert client.post(f"/api/v1/events/{rid}:retry", json={**body, "reason": "changed"}).status_code == 409
    with sessions() as db:
        assert db.query(m.EventProcessingAttempt).count() == 2


def test_asset_changed_by_other_writer_is_not_overwritten_on_retry(env, monkeypatch):
    client, sessions, _, root, _ = env
    from sop_manager.routers import event_assets

    original = event_assets.apply_asset

    def fail(*args):
        raise OSError("temporary device fault")

    monkeypatch.setattr(event_assets, "apply_asset", fail)
    item = frozen(
        etype="sop.sync.push",
        data={
            "expected_version": version(sessions),
            "module": "templates",
            "action": "upsert",
            "record": {"path": "note.md", "content": "desired"},
        },
    )
    first = result(send(client, item))
    assert first["processing"]["state"] == "failed"
    target = root / "sop/custom/note.md"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"external change")
    monkeypatch.setattr(event_assets, "apply_asset", original)
    response = client.post(
        f"/api/v1/events/{first['receipt_id']}:retry",
        json={
            "expected_revision": first["processing"]["revision"],
            "idempotency_key": "retry",
            "reason": "Recover device fault",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["processing"]["reason_code"] == "event_asset_target_changed"
    assert target.read_bytes() == b"external change"


def test_sql_effect_fault_rolls_back_business_and_version_then_original_retry_succeeds(env, monkeypatch):
    client, sessions, _, _, _ = env
    from sop_manager.routers import event_processing

    old = event_processing._attempt
    fault = {"once": True}

    def fail_once(*args, **kwargs):
        if args[6] is None and fault["once"]:
            fault["once"] = False
            raise OSError("state fault")
        return old(*args, **kwargs)

    monkeypatch.setattr(event_processing, "_attempt", fail_once)
    before = version(sessions)
    first = result(
        send(
            client,
            frozen(
                etype="sop.task.status_changed",
                subject="T-task",
                data={"expected_version": before, "status": "in_progress"},
            ),
        )
    )
    assert first["processing"]["state"] == "failed"
    assert version(sessions) == before
    with sessions() as db:
        assert db.get(m.Task, "T-task").status == "pending"
    response = client.post(
        f"/api/v1/events/{first['receipt_id']}:retry",
        json={
            "expected_revision": first["processing"]["revision"],
            "idempotency_key": "retry",
            "reason": "Recover transaction fault",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["processing"]["state"] == "processed"
    assert version(sessions) == before + 1


def test_event_receipt_and_operation_are_immutable_and_paged_get_is_pure(env):
    from fastapi import HTTPException
    from sqlalchemy import update

    client, sessions, _, _, _ = env
    values = [result(send(client, frozen(str(i)))) for i in range(3)]
    first = client.get("/api/v1/events", params={"limit": 1})
    assert first.status_code == 200, first.text
    token = first.json()["next_cursor"]
    assert first.json()["total"] == 3
    assert client.get("/api/v1/events", params={"limit": 2, "cursor": token}).status_code == 422
    assert (
        client.get("/api/v1/events", params={"limit": 1, "cursor": token}).json()["items"][0]["event_id"]
        == "1"
    )
    result(send(client, frozen("new")))
    assert client.get("/api/v1/events", params={"limit": 1, "cursor": token}).status_code == 409
    with sessions() as db:
        original = db.scalar(select(m.EventInbox).where(m.EventInbox.id == values[0]["receipt_id"]))
        original.event_json = "changed"
        with pytest.raises(HTTPException):
            db.commit()
        db.rollback()
        with pytest.raises(HTTPException):
            db.execute(
                update(m.EventProcessing)
                .where(
                    m.EventProcessing.id == values[0]["receipt_id"],
                    m.EventProcessing.project_id == "project",
                    m.EventProcessing.tenant_id == "tenant",
                )
                .values(state="processed")
            )
    statements = []
    engine = sessions.kw["bind"]

    def capture(conn, cursor, sql, params, context, many):
        statements.append(sql)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        detail = client.get("/api/v1/events/" + values[0]["receipt_id"])
        assert detail.status_code == 200, detail.text
        assert detail.json()["capabilities"]["retry"] is False
        assert client.get("/api/v1/events/" + values[0]["receipt_id"] + "/attempts").status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert all(sql.lstrip().upper().startswith("SELECT") for sql in statements)


@pytest.mark.parametrize("data", [{"bad": float("inf")}, {"bad": float("nan")}])
def test_invalid_finite_json_is_rejected(env, data):
    item = frozen(data=data)
    response = result(send(env[0], item))
    assert response["outcome"] == "rejected" and response["receipt_id"] is None


def test_structured_sprint_sync_uses_real_model_fields_and_original_version(env):
    client, sessions, _, _, _ = env
    item = frozen(
        etype="sop.sync.push",
        data={
            "expected_version": version(sessions),
            "module": "sprints",
            "action": "upsert",
            "record": {"id": "S-1", "goal": "Ship a useful flow", "ends_at": "2026-11-01T00:00:00Z"},
        },
    )
    response = result(send(client, item))
    assert response["processing"]["state"] == "processed", response
    with sessions() as db:
        assert db.get(m.Sprint, "S-1").goal == "Ship a useful flow"


def test_ws_rejects_current_disabled_user_and_wrong_project(env, monkeypatch):
    from sop_manager.routers import ws_events
    from sop_manager.routers.auth_sql import _make_token
    from starlette.websockets import WebSocketDisconnect

    client, sessions, _, _, app = env
    app.include_router(ws_events.router)
    monkeypatch.setattr(m, "SessionLocal", sessions)
    with sessions() as db:
        db.add(
            m.User(
                id="viewer",
                tenant_id="tenant",
                username="Viewer",
                password_hash=UNUSABLE_HASH,
                role="viewer",
                status="active",
            )
        )
        db.flush()
        db.add(m.ProjectMember(project_id="project", user_id="viewer", role="viewer"))
        db.commit()
    token = _make_token("viewer", "tenant", "viewer")
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/events?project_id=other&token=" + token) as socket:
            socket.receive_json()
    with sessions() as db:
        db.get(m.User, "viewer").status = "disabled"
        db.commit()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/events?project_id=project&token=" + token) as socket:
            socket.receive_json()


def test_ws_rechecks_permission_before_another_frame(env, monkeypatch):
    from sop_manager.routers import ws_events
    from sop_manager.routers.auth_sql import _make_token
    from starlette.websockets import WebSocketDisconnect

    client, sessions, _, _, app = env
    app.include_router(ws_events.router)
    monkeypatch.setattr(m, "SessionLocal", sessions)
    token = _make_token("lead", "tenant", "tenant_admin")
    with client.websocket_connect("/ws/events?project_id=project&token=" + token) as socket:
        assert socket.receive_json()["type"] == "sop.ws.hello"
        with sessions() as db:
            db.get(m.User, "lead").status = "disabled"
            db.commit()
        socket.send_json({"type": "ping"})
        with pytest.raises(WebSocketDisconnect):
            socket.receive_json()


def test_direct_sync_uses_same_durable_intake_and_does_not_reapply(env):
    from sop_manager.routers import sync_api

    client, sessions, _, _, app = env
    app.include_router(sync_api.router)
    body = {
        "expected_version": version(sessions),
        "module": "tasks",
        "action": "upsert",
        "record": {"id": "T-synced", "title": "Synced"},
        "idempotency_key": "original-sync-key",
    }
    first = client.post("/api/v1/sync/push", json=body)
    assert first.status_code == 200, first.text
    ack = first.json()
    assert ack["processing"]["state"] == "processed", ack
    current = version(sessions)
    second = client.post("/api/v1/sync/push", json=body)
    assert second.status_code == 200, second.text
    assert second.json()["receipt_id"] == ack["receipt_id"] and second.json()["outcome"] == "duplicate"
    assert version(sessions) == current
    conflict = client.post(
        "/api/v1/sync/push", json={**body, "record": {"id": "T-synced", "title": "Changed"}}
    )
    assert conflict.status_code == 409, conflict.text


@pytest.mark.parametrize(
    "field,value",
    [("actual_hours", True), ("owner_id", None), ("status", "accepted"), ("confidence", 2), ("title", 17)],
)
def test_structured_task_sync_rejects_invalid_types_without_partial_effect(env, field, value):
    client, sessions, _, _, _ = env
    before = version(sessions)
    response = result(
        send(
            client,
            frozen(
                etype="sop.sync.push",
                data={
                    "expected_version": before,
                    "module": "tasks",
                    "action": "upsert",
                    "record": {"id": "T-task", field: value},
                },
            ),
        )
    )
    assert response["processing"]["state"] == "failed", response
    assert version(sessions) == before
    with sessions() as db:
        assert db.get(m.Task, "T-task").title == "Task"


def test_ingest_failure_before_commit_has_no_poisoned_receipt(env, monkeypatch):
    client, sessions, _, _, _ = env

    def fault(mapper, connection, target):
        raise OSError("simulated receipt storage failure")

    event.listen(m.EventInbox, "before_insert", fault)
    try:
        with pytest.raises(OSError):
            send(client, frozen())
    finally:
        event.remove(m.EventInbox, "before_insert", fault)
    with sessions() as db:
        assert db.query(m.EventInbox).count() == 0
    assert result(send(client, frozen()))["outcome"] == "stored"


@pytest.mark.parametrize("raw", ['{"a":1e400}', '{"a":"\\ud800"}', "[]"])
def test_strict_inner_json_rejects_overflow_surrogate_and_nonobject(env, raw):
    item = {"id": "bad", "event_json": raw, "digest": hashlib.sha256(raw.encode()).hexdigest()}
    assert result(send(env[0], item))["outcome"] == "rejected"


def test_postcommit_hint_contains_no_payload_and_scope_is_authenticated(env, monkeypatch):
    from sop_manager.routers import ws_events

    client, _, _, _, _ = env
    frames = []
    monkeypatch.setattr(ws_events, "broadcast", lambda project, frame: frames.append((project, frame)))
    receipt = result(send(client, frozen(data={"secret": "authored body"})))
    assert frames == [
        (
            "project",
            {
                "type": "sop.event.received",
                "receipt_id": receipt["receipt_id"],
                "event_id": "event-1",
                "digest": receipt["digest"],
                "processing_state": "pending",
            },
        )
    ]
    assert result(send(client, frozen(data={"project_id": "other"})))["outcome"] == "rejected"


def test_identity_and_unauthenticated_route_are_fail_closed(env):
    client, _, _, _, app = env
    identity = client.get("/api/v1/events:identity")
    assert identity.status_code == 200, identity.text
    assert identity.json() == {"tenant_id": "tenant", "project_id": "project", "producer_id": "lead"}
    app.dependency_overrides.pop(current_user_or_apikey)
    assert send(client, frozen()).status_code == 401


def test_lock_wait_membership_downgrade_is_rechecked_with_cached_identity(env, monkeypatch):
    from sqlalchemy import update

    client, sessions, actor, _, _ = env
    with sessions() as db:
        db.add(
            m.User(
                id="writer",
                tenant_id="tenant",
                username="Writer",
                password_hash=UNUSABLE_HASH,
                role="developer",
                status="active",
            )
        )
        db.flush()
        db.add(m.ProjectMember(project_id="project", user_id="writer", role="developer"))
        db.commit()
    actor["id"] = "writer"
    original = events_ingest.require_project_operation
    held = []

    def change(db, *args, **kwargs):
        answer = original(db, *args, **kwargs)
        held.append(db.get(m.ProjectMember, ("project", "writer")))
        db.connection().execute(
            update(m.ProjectMember)
            .where(m.ProjectMember.project_id == "project", m.ProjectMember.user_id == "writer")
            .values(role="viewer")
        )
        return answer

    monkeypatch.setattr(events_ingest, "require_project_operation", change)
    response = send(client, frozen(), producer="writer")
    assert response.status_code == 403, response.text
    with sessions() as db:
        assert db.query(m.EventInbox).count() == 0


def test_stale_failure_cannot_replace_concurrent_committed_processing(env, monkeypatch):
    from sop_manager.routers import event_processing

    client, sessions, _, _, _ = env
    original_attempt = event_processing._attempt
    original_error = event_processing._error
    fault = {"once": True, "recover": True}

    def fail_once(*args, **kwargs):
        if args[6] is None and fault["once"]:
            fault["once"] = False
            raise OSError("first processor lost transaction")
        return original_attempt(*args, **kwargs)

    def after_rollback(exc):
        if fault["recover"]:
            fault["recover"] = False
            with sessions() as db:
                receipt = db.scalar(select(m.EventInbox))
                event_processing.process(db, db.get(m.Project, "project"), db.get(m.User, "lead"), receipt.id)
        return original_error(exc)

    monkeypatch.setattr(event_processing, "_attempt", fail_once)
    monkeypatch.setattr(event_processing, "_error", after_rollback)
    first = result(
        send(
            client,
            frozen(
                etype="sop.task.status_changed",
                subject="T-task",
                data={"expected_version": version(sessions), "status": "in_progress"},
            ),
        )
    )
    assert first["processing"]["state"] == "processed", first
    with sessions() as db:
        assert db.get(m.Task, "T-task").status == "in_progress"
        assert db.query(m.DeliveryReceipt).count() == 1


@pytest.mark.parametrize("env", ["file"], indirect=True)
@pytest.mark.parametrize("fault_point", ["second_insert", "outer_commit"])
def test_file_sqlite_rolled_back_batch_does_not_escape_released_savepoints(env, fault_point):
    import sqlite3

    client, sessions, _, root, _ = env

    def insert_fault(mapper, connection, target):
        if target.event_id == "second":
            raise OSError("fault after first released savepoint")

    def commit_fault(db):
        if not db.in_nested_transaction() and db.scalar(select(m.EventInbox.id).limit(1)) is not None:
            raise OSError("fault before outer commit")

    target, event_name, hook = (
        (m.EventInbox, "before_insert", insert_fault)
        if fault_point == "second_insert"
        else (ManagerSession, "before_commit", commit_fault)
    )
    event.listen(target, event_name, hook)
    try:
        with pytest.raises(OSError):
            send(client, frozen("first"), frozen("second"))
    finally:
        event.remove(target, event_name, hook)
    with sqlite3.connect(root / "events.sqlite") as reopened:
        assert reopened.execute("SELECT count(*) FROM event_inbox").fetchone()[0] == 0
        assert reopened.execute("SELECT count(*) FROM event_processing").fetchone()[0] == 0
    response = send(client, frozen("first"), frozen("second"))
    assert response.status_code == 200, response.text
    assert [r["outcome"] for r in response.json()["results"]] == ["stored", "stored"]


def test_missing_explicit_project_never_provisions_and_real_jwt_is_required(env, monkeypatch):
    from sop_manager.routers.auth_sql import _make_token
    from sop_manager.routers.project_scope_middleware import project_scope_middleware

    client, sessions, _, _, app = env
    monkeypatch.setattr(m, "SessionLocal", sessions)
    app.dependency_overrides.pop(current_user_or_apikey)
    app.middleware("http")(project_scope_middleware)
    token = _make_token("lead", "forged-tenant-claim", "viewer")
    response = client.get(
        "/api/v1/events:identity", headers={"Authorization": "Bearer " + token, "X-Project-Id": "missing"}
    )
    assert response.status_code == 404, response.text
    with sessions() as db:
        assert db.get(m.Project, "missing") is None
    assert (
        client.get(
            "/api/v1/events:identity", headers={"Authorization": "Bearer " + token, "X-Project-Id": ""}
        ).status_code
        == 400
    )


def test_verified_hmac_key_rotation_keeps_producer_and_revocation_is_current(env, monkeypatch):
    import hmac
    import secrets
    import time
    from uuid import uuid4

    from sop_manager.routers.hmac_middleware import hmac_middleware

    client, sessions, _, _, app = env
    app.dependency_overrides.pop(current_user_or_apikey)
    app.middleware("http")(hmac_middleware)
    monkeypatch.setattr(m, "SessionLocal", sessions)
    keys = [secrets.token_hex(32), secrets.token_hex(32)]
    with sessions() as db:
        for i, key in enumerate(keys):
            db.add(
                m.ApiKey(
                    id="key-" + str(i),
                    tenant_id="tenant",
                    user_id="lead",
                    name="ephemeral",
                    key_hash=hashlib.sha256(key.encode()).hexdigest(),
                    status="active",
                )
            )
        db.commit()

    def signed(key, item):
        payload = {
            "expected_tenant_id": "tenant",
            "expected_project_id": "project",
            "expected_producer_id": "lead",
            "events": [item],
        }
        raw = json.dumps(payload, separators=(",", ":"))
        stamp = str(int(time.time()))
        nonce = uuid4().hex
        canonical = "\n".join(
            ["POST", "/api/v1/events:ingest", stamp, nonce, hashlib.sha256(raw.encode()).hexdigest()]
        )
        signature = "sha256=" + hmac.new(key.encode(), canonical.encode(), hashlib.sha256).hexdigest()
        return client.post(
            "/api/v1/events:ingest",
            content=raw,
            headers={
                "Content-Type": "application/json",
                "X-Api-Key": key,
                "X-Sop-Timestamp": stamp,
                "X-Sop-Nonce": nonce,
                "X-Sop-Signature": signature,
            },
        )

    first = result(signed(keys[0], frozen()))
    with sessions() as db:
        db.get(m.ApiKey, "key-0").status = "revoked"
        db.commit()
    second = result(signed(keys[1], frozen()))
    assert second["outcome"] == "duplicate" and second["receipt_id"] == first["receipt_id"]
    assert signed(keys[0], frozen("revoked")).status_code == 401
    with sessions() as db:
        row = db.scalar(select(m.EventInbox))
        assert row.credential_id == "key-0"


def test_large_event_metadata_window_does_not_select_payload_or_plan(env, monkeypatch):
    from datetime import datetime

    from sop_manager.routers import delivery_progress_capture
    from sqlalchemy import insert
    from sqlalchemy.orm import Session

    client, sessions, _, _, _ = env
    engine = sessions.kw["bind"]
    at = datetime.utcnow()
    with engine.begin() as connection:
        connection.execute(
            insert(m.EventInbox),
            [
                {
                    "id": "bulk-" + str(i),
                    "scope_key": hashlib.sha256(str(i).encode()).hexdigest(),
                    "tenant_id": "tenant",
                    "project_id": "project",
                    "producer_id": "lead",
                    "event_id": str(i),
                    "event_json": "x" * 4096,
                    "digest": "0" * 64,
                    "event_type": "fact",
                    "subject": "",
                    "source": "test",
                    "event_time": "2026-10-18T00:00:00Z",
                    "stored_at": at,
                }
                for i in range(10000)
            ],
        )
        connection.execute(
            insert(m.EventProcessing),
            [
                {
                    "id": "bulk-" + str(i),
                    "tenant_id": "tenant",
                    "project_id": "project",
                    "state": "pending",
                    "revision": 1,
                    "attempts": 0,
                    "updated_at": at,
                    "retryable": False,
                }
                for i in range(10000)
            ],
        )

    def forbidden(*args, **kwargs):
        pytest.fail("metadata GET invoked full business evaluation")

    monkeypatch.setattr(delivery_progress_capture, "record_observation", forbidden)
    statements = []
    loaded = []

    def sql(conn, cursor, statement, parameters, context, many):
        statements.append(statement)

    def load(db, obj):
        loaded.append(type(obj).__name__)

    event.listen(engine, "before_cursor_execute", sql)
    event.listen(Session, "loaded_as_persistent", load)
    try:
        response = client.get("/api/v1/events", params={"limit": 20})
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 10000 and len(response.json()["items"]) == 20
    finally:
        event.remove(engine, "before_cursor_execute", sql)
        event.remove(Session, "loaded_as_persistent", load)
    assert not any("event_inbox.event_json" in sql or "event_processing.plan" in sql for sql in statements)
    assert len(statements) <= 12 and len(loaded) <= 45
    assert len(response.content) < 30000
    print(
        json.dumps(
            {
                "inbox_rows": 10000,
                "page": 20,
                "sql": len(statements),
                "orm_rows": len(loaded),
                "response_bytes": len(response.content),
                "payload_or_plan_selects": 0,
            }
        )
    )


def test_fixed_asset_plan_rejects_module_junction_retarget_inside_project(tmp_path):
    import os
    from types import SimpleNamespace

    from fastapi import HTTPException
    from sop_manager.routers.event_assets import apply_asset, plan_asset

    root = tmp_path / "asset-project"
    allowed = root / ".ai-memory/rules"
    foreign = root / "unapproved"
    allowed.mkdir(parents=True)
    foreign.mkdir()
    for base in (allowed, foreign):
        (base / "example.md").write_bytes(b"original")
    project = SimpleNamespace(project_path=str(root))
    intent = SimpleNamespace(
        data={"module": "rules", "record": {"path": "example.md", "content": "new rule bytes"}}
    )
    plan = plan_asset(project, intent)
    allowed.rename(root / ".ai-memory/rules-original")
    if os.name == "nt":
        import _winapi

        _winapi.CreateJunction(str(foreign), str(allowed))
    else:
        allowed.symlink_to(foreign, target_is_directory=True)
    try:
        with pytest.raises(HTTPException) as exc:
            apply_asset(project, "fixed-original-operation", plan)
        assert exc.value.status_code == 409
        assert (foreign / "example.md").read_bytes() == b"original"
    finally:
        assert allowed.resolve() == foreign.resolve()
        if os.name == "nt":
            os.rmdir(allowed)
        else:
            allowed.unlink()
