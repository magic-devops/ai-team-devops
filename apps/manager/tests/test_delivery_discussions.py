"""Discussion SQL facts never become business progress observations."""

import importlib.util

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sop_manager.project_write_guard import ManagerSession
from sop_manager.routers import sql_models as m
from sop_manager.routers.auth_sql import current_user
from sqlalchemy import create_engine, delete, event, select, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def env(request, tmp_path):
    app = FastAPI()
    if importlib.util.find_spec("sop_manager.routers.delivery_discussions"):
        from sop_manager.routers.delivery_discussions import router

        app.include_router(router)
    if getattr(request, "param", None) == "file":
        engine = create_engine(
            "sqlite:///" + str(tmp_path / "discussion.sqlite"), connect_args={"check_same_thread": False}
        )
    else:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", m._configure_sqlite)
    m.Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, class_=ManagerSession, autoflush=False, expire_on_commit=False)
    unusable_hash = "not-a-login"
    with sessions() as db:
        db.add(m.Tenant(id="tenant", name="Team", slug="team"))
        db.flush()
        db.add_all(
            [
                m.User(
                    id="lead",
                    tenant_id="tenant",
                    username="Lead",
                    password_hash=unusable_hash,
                    role="tenant_admin",
                    status="active",
                ),
                m.User(
                    id="writer",
                    tenant_id="tenant",
                    username="Writer",
                    password_hash=unusable_hash,
                    role="developer",
                    status="active",
                ),
                m.User(
                    id="viewer",
                    tenant_id="tenant",
                    username="Viewer",
                    password_hash=unusable_hash,
                    role="viewer",
                    status="active",
                ),
            ]
        )
        db.flush()
        db.add_all(
            [
                m.Project(id="project", tenant_id="tenant", name="Product"),
                m.Project(id="other", tenant_id="tenant", name="Other"),
            ]
        )
        db.flush()
        db.add_all(
            [
                m.ProjectMember(project_id="project", user_id="writer", role="developer"),
                m.ProjectMember(project_id="project", user_id="viewer", role="viewer"),
                m.Requirement(
                    id="R",
                    tenant_id="tenant",
                    project_id="project",
                    title="Search",
                    description="Find records",
                    acceptance_criteria=["Same", "Same"],
                ),
                m.Task(
                    id="T",
                    tenant_id="tenant",
                    project_id="project",
                    req_id="R",
                    title="Task",
                    acceptance_criteria=["Own task condition"],
                ),
                m.Issue(
                    id="I", tenant_id="tenant", project_id="project", title="Broken", description="Observed"
                ),
            ]
        )
        db.commit()
    actor = {"id": "lead"}

    def session():
        with sessions() as db:
            yield db

    def identity():
        with sessions() as db:
            return db.get(m.User, actor["id"])

    app.dependency_overrides[m.get_session] = session
    app.dependency_overrides[current_user] = identity
    client = TestClient(app, headers={"X-Project-Id": "project"})
    yield client, sessions, actor
    engine.dispose()


def create(client, key="create", **extra):
    response = client.post(
        "/api/v1/delivery/discussions",
        json={
            "subject_kind": "requirement",
            "subject_id": "R",
            "title": "Clarify search",
            "body": "First thought",
            "idempotency_key": key,
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_empty_discussion_read_has_no_business_or_support_side_effects(env):
    client, sessions, _ = env
    with sessions() as db:
        before = {table.name: len(db.execute(select(table)).all()) for table in m.Base.metadata.sorted_tables}
    response = client.get("/api/v1/delivery/discussions")
    assert response.status_code == 200, response.text
    assert response.json()["items"] == []
    with sessions() as db:
        after = {table.name: len(db.execute(select(table)).all()) for table in m.Base.metadata.sorted_tables}
    assert after == before


def test_real_create_reply_resolution_edit_history_and_original_ack(env):
    client, sessions, _ = env
    first = create(client)
    tid = first["thread_id"]
    mid = first["message_id"]
    resolved = client.post(
        f"/api/v1/delivery/discussions/{tid}/resolve",
        json={
            "expected_thread_version": 1,
            "message_id": mid,
            "message_revision": 1,
            "note": "Use this",
            "idempotency_key": "resolve",
        },
    )
    assert resolved.status_code == 200, resolved.text
    edited = client.patch(
        f"/api/v1/delivery/discussions/{tid}/messages/{mid}",
        json={"expected_message_revision": 1, "body": "Revised thought", "idempotency_key": "edit"},
    )
    assert edited.status_code == 200, edited.text
    detail = client.get(f"/api/v1/delivery/discussions/{tid}").json()
    assert detail["thread"]["state"] == "open" and detail["thread"]["current_resolution"] is None
    assert detail["thread"]["version"] == 3
    original = client.get(f"/api/v1/delivery/discussions/{tid}/messages/{mid}/versions/1").json()["version"]
    assert original["body"] == "First thought" and original["editor"] == {"id": "lead", "name": "Lead"}
    replay = create(client)
    assert replay == {**first, "replayed": True}
    changed = client.post(
        "/api/v1/delivery/discussions",
        json={
            "subject_kind": "requirement",
            "subject_id": "R",
            "title": "Clarify search",
            "body": "Changed",
            "idempotency_key": "create",
        },
    )
    assert changed.status_code == 409
    with sessions() as db:
        assert db.query(m.DeliveryEvent).count() == 0 and db.query(m.DeliveryWorkspace).count() == 0
        assert db.query(m.DeliveryDiscussionEvent).count() == 3
        assert db.query(m.DeliveryDiscussionReceipt).count() == 3
        assert db.get(m.Requirement, "R").description == "Find records"


def test_strict_authenticated_authorship_and_editor_permission(env):
    client, _, actor = env
    assert (
        client.post(
            "/api/v1/delivery/discussions",
            json={
                "subject_kind": "requirement",
                "subject_id": "R",
                "title": "x",
                "body": "x",
                "idempotency_key": "forged",
                "author_id": "writer",
            },
        ).status_code
        == 422
    )
    first = create(client)
    actor["id"] = "writer"
    response = client.patch(
        f"/api/v1/delivery/discussions/{first['thread_id']}/messages/{first['message_id']}",
        json={"expected_message_revision": 1, "body": "Impersonation", "idempotency_key": "bad-editor"},
    )
    assert response.status_code == 403
    actor["id"] = "viewer"
    assert client.get(f"/api/v1/delivery/discussions/{first['thread_id']}").status_code == 200
    assert (
        client.post(
            f"/api/v1/delivery/discussions/{first['thread_id']}/messages",
            json={"body": "reader", "idempotency_key": "reader"},
        ).status_code
        == 403
    )


def test_reference_is_server_frozen_at_the_selected_canonical_revision(env):
    client, sessions, _ = env
    selected = client.get(
        "/api/v1/delivery/discussion-references/requirement/R",
        params={"field": "acceptance_criteria", "criterion_index": 1},
    )
    assert selected.status_code == 200, selected.text
    reference = selected.json()["reference"]
    assert reference["text"] == "Same" and reference["criterion_index"] == 1
    selection = {
        key: reference[key] for key in ["kind", "id", "field", "criterion_index", "source_content_basis"]
    }
    first = create(client, refs=[selection])
    tid = first["thread_id"]
    mid = first["message_id"]
    with sessions() as db:
        row = db.get(m.Requirement, "R")
        row.acceptance_criteria = ["Changed", "Other"]
        db.commit()
    message = client.get(f"/api/v1/delivery/discussions/{tid}/messages/{mid}").json()["message"]
    assert message["refs"][0]["text"] == "Same"
    stale = client.post(
        f"/api/v1/delivery/discussions/{tid}/messages",
        json={"body": "stale quote", "refs": [selection], "idempotency_key": "stale"},
    )
    assert stale.status_code == 409


def post(client, tid, operation, body):
    response = client.post(f"/api/v1/delivery/discussions/{tid}/{operation}", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def resolve(client, first, key="resolve"):
    return post(
        client,
        first["thread_id"],
        "resolve",
        {
            "expected_thread_version": first["thread_version"],
            "message_id": first["message_id"],
            "message_revision": first["message_revision"],
            "idempotency_key": key,
        },
    )


def test_reply_reopens_resolution_cursor_is_scope_bound_and_history_upper_is_fixed(env):
    client, _, actor = env
    first = create(client)
    tid = first["thread_id"]
    mid = first["message_id"]
    resolve(client, first)
    reply = post(
        client, tid, "messages", {"body": "New fact", "parent_message_id": mid, "idempotency_key": "reply"}
    )
    assert client.get(f"/api/v1/delivery/discussions/{tid}").json()["thread"]["state"] == "open"
    current = client.get(f"/api/v1/delivery/discussions/{tid}/messages", params={"limit": 1}).json()
    assert current["total"] == 2 and current["has_more"]
    params = {"limit": 1, "cursor": current["next_cursor"]}
    assert (
        client.get(f"/api/v1/delivery/discussions/{tid}/messages", params={**params, "limit": 2}).status_code
        == 422
    )
    actor["id"] = "writer"
    assert client.get(f"/api/v1/delivery/discussions/{tid}/messages", params=params).status_code == 422
    actor["id"] = "lead"
    edited = client.patch(
        f"/api/v1/delivery/discussions/{tid}/messages/{mid}",
        json={"expected_message_revision": 1, "body": "Version2", "idempotency_key": "edit2"},
    )
    assert edited.status_code == 200
    assert client.get(f"/api/v1/delivery/discussions/{tid}/messages", params=params).status_code == 409
    history = client.get(
        f"/api/v1/delivery/discussions/{tid}/messages/{mid}/versions", params={"limit": 1}
    ).json()
    assert history["upper_revision"] == 2 and history["has_more"]
    assert (
        client.patch(
            f"/api/v1/delivery/discussions/{tid}/messages/{mid}",
            json={"expected_message_revision": 2, "body": "Version3", "idempotency_key": "edit3"},
        ).status_code
        == 200
    )
    old = client.get(
        f"/api/v1/delivery/discussions/{tid}/messages/{mid}/versions",
        params={"limit": 1, "cursor": history["next_cursor"]},
    ).json()
    assert old["upper_revision"] == 2 and [row["revision"] for row in old["items"]] == [2]
    assert client.get(f"/api/v1/delivery/discussions/{tid}/messages/{reply['message_id']}").status_code == 200


def test_reference_links_have_their_own_watermark_and_do_not_advance_thread_or_business(env):
    client, sessions, _ = env
    first = create(client)
    resolved = resolve(client, first)
    tid = first["thread_id"]
    target = client.get("/api/v1/delivery/discussion-references/task/T", params={"field": "title"}).json()
    body = {
        "expected_thread_version": resolved["thread_version"],
        "resolution_event_id": resolved["event_id"],
        "message_id": first["message_id"],
        "message_revision": 1,
        "target_kind": "task",
        "target_id": "T",
        "target_content_basis": target["target_content_basis"],
        "idempotency_key": "link1",
    }
    link = post(client, tid, "links", body)
    assert link["event_id"] == resolved["event_id"] and link["thread_version"] == resolved["thread_version"]
    post(client, tid, "links", {**body, "idempotency_key": "link2"})
    page1 = client.get(f"/api/v1/delivery/discussions/{tid}/links", params={"limit": 1}).json()
    assert page1["total"] == 2 and page1["has_more"] and not page1["items"][0]["source_changed"]
    post(client, tid, "links", {**body, "idempotency_key": "link3"})
    assert (
        client.get(
            f"/api/v1/delivery/discussions/{tid}/links", params={"limit": 1, "cursor": page1["next_cursor"]}
        ).status_code
        == 409
    )
    with sessions() as db:
        assert db.query(m.DeliveryDiscussionEvent).count() == 2
        assert db.query(m.DeliverySourceLink).count() == 3
        assert db.query(m.DeliveryEvent).count() == 0
        db.delete(db.get(m.Task, "T"))
        db.commit()
    sources = client.get("/api/v1/delivery/sources", params={"target_kind": "task", "target_id": "T"}).json()
    assert all(row["target_missing"] and row["target_title"] is None for row in sources["items"])
    assert sources["items"][0]["source_snapshot"]["message"]["body"] == "First thought"


def test_untouched_business_tables_and_forbidden_full_evaluation_during_pure_discussion(env, monkeypatch):
    client, sessions, _ = env
    from sop_manager.routers import (
        delivery_progress_capture,
        delivery_query_index,
        delivery_service,
        delivery_verification,
    )

    def forbidden(*args, **kwargs):
        pytest.fail("pure discussion reached full business evaluation")

    monkeypatch.setattr(delivery_service, "reconcile", forbidden)
    monkeypatch.setattr(delivery_progress_capture, "record_observation", forbidden)
    monkeypatch.setattr(delivery_query_index, "replace_from_evaluation", forbidden)
    monkeypatch.setattr(delivery_verification, "VerificationContext", forbidden)

    def snapshot():
        with sessions() as db:
            return {
                table.name: [dict(row) for row in db.execute(select(table)).mappings()]
                for table in m.Base.metadata.sorted_tables
                if not table.name.startswith("delivery_discussion_") and table.name != "delivery_source_links"
            }

    before = snapshot()
    first = create(client)
    tid = first["thread_id"]
    resolve(client, first)
    response = client.post(
        f"/api/v1/delivery/discussions/{tid}/messages/{first['message_id']}/withdraw",
        json={"expected_message_revision": 1, "reason": "Withdrawn by author", "idempotency_key": "withdraw"},
    )
    assert response.status_code == 200, response.text
    detail = client.get(f"/api/v1/delivery/discussions/{tid}").json()
    assert detail["thread"]["state"] == "open"
    archived = post(
        client,
        tid,
        "archive",
        {"expected_thread_version": detail["thread"]["version"], "idempotency_key": "archive"},
    )
    post(
        client,
        tid,
        "restore",
        {"expected_thread_version": archived["thread_version"], "idempotency_key": "restore"},
    )
    assert snapshot() == before


def test_project_archive_is_readable_replayable_and_restore_reenables_discussion(env):
    client, sessions, _ = env
    from sop_manager.project_write_guard import lifecycle_scope

    first = create(client)
    tid = first["thread_id"]
    with sessions() as db:
        with lifecycle_scope(db, "tenant", "project"):
            db.get(m.Project, "project").status = "archived"
            db.commit()
    assert client.get(f"/api/v1/delivery/discussions/{tid}").status_code == 200
    assert create(client) == {**first, "replayed": True}
    assert (
        client.post(
            f"/api/v1/delivery/discussions/{tid}/messages",
            json={"body": "new", "idempotency_key": "after-archive"},
        ).status_code
        == 409
    )
    with sessions() as db:
        with lifecycle_scope(db, "tenant", "project"):
            db.get(m.Project, "project").status = "active"
            db.commit()
    assert (
        post(client, tid, "messages", {"body": "Restored project", "idempotency_key": "restored-project"})[
            "thread_version"
        ]
        == 2
    )


def test_append_only_history_guards_cover_orm_and_typed_sql(env):
    client, sessions, _ = env
    from fastapi import HTTPException

    first = create(client)
    for model in [m.DeliveryDiscussionMessageVersion, m.DeliveryDiscussionEvent, m.DeliveryDiscussionReceipt]:
        with sessions() as db:
            row = db.scalars(select(model)).first()
            with pytest.raises(HTTPException, match="append-only"):
                db.delete(row)
                db.flush()
            db.rollback()
        with sessions() as db:
            with pytest.raises(HTTPException, match="append-only"):
                db.execute(delete(model).where(model.project_id == "project", model.tenant_id == "tenant"))
            db.rollback()
    with sessions() as db:
        row = db.query(m.DeliveryDiscussionThread).filter_by(id=first["thread_id"]).one()
        row.subject_id = "I"
        with pytest.raises(HTTPException, match="immutable"):
            db.flush()


def test_subject_deleted_or_task_moved_never_rebinds_discussion(env):
    client, sessions, _ = env
    first = create(client, subject_kind="task", subject_id="T")
    tid = first["thread_id"]
    with sessions() as db:
        db.get(m.Task, "T").req_id = ""
        db.commit()
    assert (
        client.get(f"/api/v1/delivery/discussions/{tid}").json()["thread"]["subject"][
            "current_requirement_id"
        ]
        is None
    )
    with sessions() as db:
        db.delete(db.get(m.Task, "T"))
        db.commit()
    detail = client.get(f"/api/v1/delivery/discussions/{tid}").json()
    assert detail["thread"]["subject"]["missing"] and not detail["capabilities"]["reply"]
    assert (
        client.post(
            f"/api/v1/delivery/discussions/{tid}/messages",
            json={"body": "must fail", "idempotency_key": "deleted"},
        ).status_code
        == 409
    )
    assert (
        client.get(
            f"/api/v1/delivery/discussions/{tid}/messages/{first['message_id']}/versions/1"
        ).status_code
        == 200
    )


def test_revoked_account_after_waiting_for_project_lock_cannot_write(env, monkeypatch):
    client, sessions, actor = env
    from sop_manager.routers import delivery_discussion

    original = delivery_discussion.require_project_operation

    def revoke(db, tenant, pid):
        original(db, tenant, pid)
        db.connection().execute(update(m.User).where(m.User.id == "writer").values(status="disabled"))

    monkeypatch.setattr(delivery_discussion, "require_project_operation", revoke)
    actor["id"] = "writer"
    response = client.post(
        "/api/v1/delivery/discussions",
        json={
            "subject_kind": "requirement",
            "subject_id": "R",
            "title": "locked",
            "body": "must fail",
            "idempotency_key": "revoked",
        },
    )
    assert response.status_code == 403, response.text
    with sessions() as db:
        assert db.query(m.DeliveryDiscussionThread).count() == 0


def test_exact_legacy_source_adapter_reads_recorded_issue_diagnosis_and_plan(env):
    client, sessions, _ = env
    from sop_manager.routers.delivery_contract import default_flow
    from sop_manager.routers.delivery_service import initial_state

    state = initial_state()
    state["flows"]["R"] = {**default_flow(), "source_issue_id": "I", "source_diagnosis": {"id": "diag"}}
    state["task_details"]["T"] = {"preview_id": "plan"}
    with sessions() as db:
        db.add(
            m.IssueDiagnosis(
                id="diag",
                tenant_id="tenant",
                project_id="project",
                issue_id="I",
                user_id="lead",
                request_hash="h",
                status="succeeded",
                data={"runtime_scopes": []},
            )
        )
        db.add(
            m.DeliveryPlanPreview(
                id="plan",
                tenant_id="tenant",
                project_id="project",
                user_id="lead",
                request_hash="h",
                status="succeeded",
                data={"snapshot": {"id": "R"}},
            )
        )
        db.add(m.DeliveryWorkspace(tenant_id="tenant", project_id="project", version=1, data=state))
        db.commit()
    sources = client.get("/api/v1/delivery/sources", params={"target_kind": "requirement", "target_id": "R"})
    assert sources.status_code == 200, sources.text
    assert {row["kind"] for row in sources.json()["legacy_sources"]} == {"issue", "diagnosis"}
    planned = client.get("/api/v1/delivery/sources", params={"target_kind": "task", "target_id": "T"})
    assert planned.status_code == 200, planned.text
    assert [row["id"] for row in planned.json()["legacy_sources"]] == ["plan"]


def test_runtime_reference_redacts_current_acl_and_original_replay_requires_original_scope(
    env, tmp_path, monkeypatch
):
    from datetime import datetime

    from hermes_core.models import Principal
    from hermes_core.transactional import Store
    from sop_manager.project_write_guard import require_project_operation
    from sop_manager.routers.delivery_discussion_sources import (
        record_adoption_links,
        validate_source_reference,
    )
    from sqlalchemy import insert

    client, sessions, actor = env
    store = Store("sqlite:///" + str(tmp_path / "runtime.sqlite"))
    client.app.state.hermes_store = store
    principal = Principal("lead", tenant="tenant", business="team")
    ws = store.create(principal, "", "workspaces", {"name": "Private", "owner": "lead"}, "private", "ws")
    wid = ws["id"]
    run = store.create(
        principal,
        wid,
        "runs",
        {"attempt": 1, "nodes": [{"argv": ["private-command"]}], "env": {"TOKEN": "must-never-project"}},
        "run",
        "run",
        status="completed",
    )
    monkeypatch.setattr(
        store, "list", lambda *args, **kwargs: pytest.fail("reference ACL must use exact workspace get")
    )
    entry = {"id": "E", "workspace_id": wid, "run_id": run["id"], "status": "completed", "task_id": "T"}
    with sessions.kw["bind"].begin() as conn:
        conn.execute(
            insert(m.DeliveryWorkspace).values(
                project_id="project", tenant_id="tenant", version=0, data={"executions": [entry]}
            )
        )
        conn.execute(delete(m.DeliveryQueryState).where(m.DeliveryQueryState.project_id == "project"))
        conn.execute(
            insert(m.DeliveryQueryState).values(
                tenant_id="tenant",
                project_id="project",
                schema_version=3,
                generation=1,
                source_version=0,
                computed_at=datetime.utcnow(),
                summary={},
                metrics={},
                planning_basis="",
            )
        )
        conn.execute(
            insert(m.DeliveryQueryFact).values(
                tenant_id="tenant",
                project_id="project",
                kind="execution",
                entity_id="E",
                data={"position": 0, "workspace_id": wid},
            )
        )
    selected = client.get("/api/v1/delivery/discussion-references/execution/E", params={"field": "summary"})
    assert selected.status_code == 200, selected.text
    assert "private-command" not in selected.text and "must-never-project" not in selected.text
    ref = selected.json()["reference"]
    first = create(client, refs=[{key: ref[key] for key in ["kind", "id", "field", "source_content_basis"]}])
    resolved = resolve(client, first)
    source_ref = {
        "thread_id": first["thread_id"],
        "expected_thread_version": resolved["thread_version"],
        "resolution_event_id": resolved["event_id"],
        "message_id": first["message_id"],
        "message_revision": 1,
    }
    with sessions() as db:
        project = db.get(m.Project, "project")
        user = db.get(m.User, "lead")
        require_project_operation(db, "tenant", "project")
        source = validate_source_reference(db, project, user, source_ref, store=store)
        record_adoption_links(db, project, user, source, [{"kind": "task", "id": "T"}])
        db.commit()
    actor["id"] = "writer"
    for path in [
        f"/api/v1/delivery/discussions/{first['thread_id']}/messages/{first['message_id']}",
        f"/api/v1/delivery/discussions/{first['thread_id']}/messages/{first['message_id']}/versions/1",
        f"/api/v1/delivery/discussions/{first['thread_id']}/links",
    ]:
        response = client.get(path)
        assert response.status_code == 200, response.text
        assert '"status":"unavailable"' in response.text and "Execution E: completed" not in response.text
        assert "_runtime_scopes" not in response.text and "private-command" not in response.text
    store.mutate(
        principal,
        "",
        "workspaces",
        wid,
        operation="fixture.acl",
        key="revoke",
        request={},
        trace="test",
        expected=ws["version"],
        transform=lambda row: {"data": {**row["data"], "owner": "writer", "members": []}},
    )
    actor["id"] = "lead"
    replay = client.post(
        "/api/v1/delivery/discussions",
        json={
            "subject_kind": "requirement",
            "subject_id": "R",
            "title": "Clarify search",
            "body": "First thought",
            "refs": [{key: ref[key] for key in ["kind", "id", "field", "source_content_basis"]}],
            "idempotency_key": "create",
        },
    )
    assert replay.status_code == 403, replay.text
    store.engine.dispose()


def test_source_link_savepoint_rollback_leaves_no_ghost_adoption_or_version(env):
    from sop_manager.project_write_guard import require_project_operation
    from sop_manager.routers.delivery_discussion_sources import (
        record_adoption_links,
        validate_source_reference,
    )

    client, sessions, _ = env
    first = create(client)
    resolved = resolve(client, first)
    source_ref = {
        "thread_id": first["thread_id"],
        "expected_thread_version": resolved["thread_version"],
        "resolution_event_id": resolved["event_id"],
        "message_id": first["message_id"],
        "message_revision": 1,
    }
    with sessions() as db:
        project = db.get(m.Project, "project")
        user = db.get(m.User, "lead")
        require_project_operation(db, "tenant", "project")
        source = validate_source_reference(db, project, user, source_ref)
        with pytest.raises(RuntimeError):
            with db.begin_nested():
                record_adoption_links(db, project, user, source, [{"kind": "task", "id": "T"}])
                db.flush()
                assert db.query(m.DeliverySourceLink).count() == 1
                raise RuntimeError("rollback after source fact")
        db.commit()
    with sessions() as db:
        assert db.query(m.DeliverySourceLink).count() == 0
        assert db.query(m.DeliveryDiscussionThread).one().version == 2
        assert db.query(m.DeliveryDiscussionEvent).count() == 2


def test_failed_receipt_flush_rolls_back_all_discussion_rows_and_same_key_can_retry(env, monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError

    client, sessions, _ = env
    engine = sessions.kw["bind"]

    def fail_receipt(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("INSERT INTO DELIVERY_DISCUSSION_RECEIPTS"):
            raise SQLAlchemyError("injected receipt failure")

    event.listen(engine, "before_cursor_execute", fail_receipt)
    try:
        with pytest.raises(SQLAlchemyError, match="injected receipt"):
            create(client)
    finally:
        event.remove(engine, "before_cursor_execute", fail_receipt)
    with sessions() as db:
        for model in [
            m.DeliveryDiscussionThread,
            m.DeliveryDiscussionMessage,
            m.DeliveryDiscussionMessageVersion,
            m.DeliveryDiscussionEvent,
            m.DeliveryDiscussionReceipt,
        ]:
            assert db.query(model).count() == 0
    assert create(client)["thread_version"] == 1


def test_large_project_discussion_window_and_one_reply_load_only_bounded_rows(env, monkeypatch):
    import json
    from datetime import datetime

    from sop_manager.routers import delivery_service, delivery_verification
    from sqlalchemy import insert
    from sqlalchemy.orm import Session

    client, sessions, _ = env
    engine = sessions.kw["bind"]
    at = datetime.utcnow()
    with engine.begin() as conn:
        conn.execute(
            insert(m.Requirement),
            [
                {
                    "id": f"bulk-r-{index}",
                    "tenant_id": "tenant",
                    "project_id": "project",
                    "title": "Large requirement",
                }
                for index in range(10000)
            ],
        )
        conn.execute(
            insert(m.Task),
            [
                {
                    "id": f"bulk-t-{index}",
                    "tenant_id": "tenant",
                    "project_id": "project",
                    "title": "Large task",
                    "acceptance_criteria": ["Own"],
                }
                for index in range(10000)
            ],
        )
        conn.execute(
            insert(m.DeliveryDiscussionThread),
            [
                {
                    "id": f"bulk-d-{index}",
                    "tenant_id": "tenant",
                    "project_id": "project",
                    "subject_kind": "requirement",
                    "subject_id": "R",
                    "version": 1,
                    "state": "open",
                    "title": "Large discussion",
                    "created_by_id": "lead",
                    "created_by_name": "Lead",
                    "created_at": at,
                    "last_activity_at": at,
                }
                for index in range(20000)
            ],
        )
        conn.execute(
            insert(m.DeliveryDiscussionEvent),
            [
                {
                    "id": f"bulk-e-{index}",
                    "tenant_id": "tenant",
                    "project_id": "project",
                    "thread_id": f"bulk-d-{index}",
                    "thread_version": 1,
                    "subject_kind": "requirement",
                    "subject_id": "R",
                    "action": "create",
                    "actor_id": "lead",
                    "actor_name": "Lead",
                    "data": {},
                    "created_at": at,
                }
                for index in range(20000)
            ],
        )

    def forbidden(*args, **kwargs):
        pytest.fail("bounded discussion operation reached full evaluation")

    monkeypatch.setattr(delivery_verification, "VerificationContext", forbidden)
    monkeypatch.setattr(delivery_service, "reconcile", forbidden)
    statements = []
    loaded = []

    def sql(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    def load(db, obj):
        loaded.append(type(obj).__name__)

    event.listen(engine, "before_cursor_execute", sql)
    event.listen(Session, "loaded_as_persistent", load)
    try:
        response = client.get(
            "/api/v1/delivery/discussions",
            params={"subject_kind": "requirement", "subject_id": "R", "limit": 20},
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 20000 and len(response.json()["items"]) == 20
        read_sql = len(statements)
        read_rows = len(loaded)
        read_bytes = len(response.content)
        statements.clear()
        loaded.clear()
        reply = post(
            client,
            "bulk-d-0",
            "messages",
            {"body": "Bounded one-message reply", "idempotency_key": "bounded"},
        )
        assert reply["thread_version"] == 2
        write_sql = len(statements)
        write_rows = len(loaded)
    finally:
        event.remove(engine, "before_cursor_execute", sql)
        event.remove(Session, "loaded_as_persistent", load)
    assert read_sql < 65 and read_rows < 30 and read_bytes < 30000
    assert write_sql < 75 and write_rows < 20
    print(
        json.dumps(
            {
                "canonical_requirements": 10001,
                "canonical_tasks": 10001,
                "threads": 20000,
                "page_size": 20,
                "read_sql": read_sql,
                "read_orm_rows": read_rows,
                "response_bytes": read_bytes,
                "reply_sql": write_sql,
                "reply_orm_rows": write_rows,
                "whole_workspace_decodes": 0,
            }
        )
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("expected_thread_version", True),
        ("expected_thread_version", "1"),
        ("message_revision", True),
        ("message_revision", "1"),
    ],
)
def test_concurrency_numbers_require_actual_json_integers(env, field, value):
    client, _, _ = env
    first = create(client)
    payload = {
        "expected_thread_version": 1,
        "message_id": first["message_id"],
        "message_revision": 1,
        "idempotency_key": "strict",
    }
    payload[field] = value
    response = client.post(f"/api/v1/delivery/discussions/{first['thread_id']}/resolve", json=payload)
    assert response.status_code == 422, response.text


def test_discussion_pointers_cannot_be_edited_through_ordinary_scoped_sql(env):
    from fastapi import HTTPException

    client, sessions, _ = env
    first = create(client)
    with sessions() as db:
        with pytest.raises(HTTPException, match="discussion commands"):
            db.execute(
                update(m.DeliveryDiscussionThread)
                .where(
                    m.DeliveryDiscussionThread.id == first["thread_id"],
                    m.DeliveryDiscussionThread.project_id == "project",
                    m.DeliveryDiscussionThread.tenant_id == "tenant",
                )
                .values(version=99)
            )
        db.rollback()
    with sessions() as db:
        row = db.query(m.DeliveryDiscussionMessage).filter_by(id=first["message_id"]).one()
        row.current_revision = 99
        with pytest.raises(HTTPException, match="discussion commands"):
            db.flush()


@pytest.mark.parametrize("env", ["file"], indirect=True)
def test_concurrent_replies_and_same_key_retries_are_serialized_by_project_lock(env):
    from concurrent.futures import ThreadPoolExecutor

    client, sessions, _ = env
    first = create(client)
    endpoint = f"/api/v1/delivery/discussions/{first['thread_id']}/messages"
    with ThreadPoolExecutor(max_workers=2) as workers:
        replies = list(
            workers.map(
                lambda index: client.post(
                    endpoint, json={"body": f"Independent {index}", "idempotency_key": f"reply-{index}"}
                ),
                range(2),
            )
        )
    assert [reply.status_code for reply in replies] == [200, 200], [reply.text for reply in replies]
    assert {reply.json()["thread_version"] for reply in replies} == {2, 3}
    payload = {"body": "One durable reply", "idempotency_key": "one-key"}
    with ThreadPoolExecutor(max_workers=2) as workers:
        retries = list(workers.map(lambda _: client.post(endpoint, json=payload), range(2)))
    assert [reply.status_code for reply in retries] == [200, 200], [reply.text for reply in retries]
    assert retries[0].json()["message_id"] == retries[1].json()["message_id"]
    assert {reply.json()["replayed"] for reply in retries} == {False, True}
    with sessions() as db:
        assert db.query(m.DeliveryDiscussionMessage).count() == 4
        assert db.query(m.DeliveryDiscussionEvent).count() == 4


def test_cross_project_parent_and_revision_paths_never_expose_other_threads(env):
    client, _, _ = env
    first = create(client)
    second = create(client, key="other-discussion", subject_kind="issue", subject_id="I")
    assert (
        client.get(
            f"/api/v1/delivery/discussions/{second['thread_id']}/messages/{first['message_id']}/versions/1"
        ).status_code
        == 404
    )
    response = client.post(
        f"/api/v1/delivery/discussions/{second['thread_id']}/messages",
        json={
            "body": "Wrong parent",
            "parent_message_id": first["message_id"],
            "idempotency_key": "wrong-parent",
        },
    )
    assert response.status_code == 404
    assert (
        client.get(
            f"/api/v1/delivery/discussions/{first['thread_id']}", headers={"X-Project-Id": "other"}
        ).status_code
        == 404
    )


def test_administrator_can_withdraw_but_cannot_rewrite_another_authors_message(env):
    client, _, actor = env
    actor["id"] = "writer"
    first = create(client)
    actor["id"] = "lead"
    endpoint = f"/api/v1/delivery/discussions/{first['thread_id']}/messages/{first['message_id']}"
    assert (
        client.patch(
            endpoint,
            json={"expected_message_revision": 1, "body": "Cannot impersonate", "idempotency_key": "rewrite"},
        ).status_code
        == 403
    )
    withdrawn = client.post(
        endpoint + "/withdraw",
        json={"expected_message_revision": 1, "reason": "Moderated", "idempotency_key": "moderate"},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    message = client.get(endpoint).json()["message"]
    assert message["body"] is None and message["state"] == "withdrawn"
    assert message["author"] == {"id": "writer", "name": "Writer"}
    original = client.get(endpoint + "/versions/1").json()["version"]
    assert original["body"] == "First thought" and original["editor"]["id"] == "writer"
