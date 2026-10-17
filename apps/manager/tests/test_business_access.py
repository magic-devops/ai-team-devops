"""Legacy business endpoints must use authenticated, explicit project scope."""

import hashlib
import hmac
import time
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sop_manager.path_config import resolved_project_id, resolved_tenant_id
from sop_manager.routers import (
    auth_sql,
    db_sql_compat,
    issues,
    llm_gateway,
    models,
    requirements,
    sprints,
    sql_models,
    tasks,
)
from sop_manager.routers.hmac_middleware import hmac_middleware
from sop_manager.routers.project_scope_middleware import project_scope_middleware
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def env(tmp_path, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    sql_models.Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions() as db:
        db.add_all([sql_models.Tenant(id=t, name=t, slug=t) for t in ("team", "foreign")])
        db.flush()
        for uid, role, status in [
            ("writer", "developer", "active"),
            ("product", "product_manager", "active"),
            ("reader", "viewer", "active"),
            ("analyst", "analyst", "active"),
            ("disabled", "developer", "disabled"),
        ]:
            unusable_hash = "not-a-login"
            db.add(sql_models.User(id=uid, tenant_id="team", username=uid,
                                   password_hash=unusable_hash, role=role, status=status))
        for pid, tenant in [("selected", "team"), ("other", "team"), ("private", "foreign")]:
            db.add(sql_models.Project(id=pid, tenant_id=tenant, name=pid,
                                      project_path=str(tmp_path / pid)))
        db.flush()
        for uid, role in [("writer", "developer"), ("product", "product_manager"),
                          ("reader", "viewer"), ("analyst", "analyst"), ("disabled", "developer")]:
            db.add(sql_models.ProjectMember(project_id="selected", user_id=uid, role=role))
        # Membership in the other project is read only, even for an otherwise privileged writer.
        db.add(sql_models.ProjectMember(project_id="other", user_id="writer", role="viewer"))
        for pid in ("selected", "other"):
            db.add_all([
                sql_models.Requirement(id=f"REQ-{pid}", project_id=pid, tenant_id="team", title=pid),
                sql_models.Task(id=f"T-{pid}", project_id=pid, tenant_id="team", title=pid),
                sql_models.Issue(id=f"ISSUE-{pid}", project_id=pid, tenant_id="team", title=pid),
                sql_models.Sprint(id=f"SPRINT-{pid}", project_id=pid, tenant_id="team", goal=pid),
            ])
        db.add(sql_models.ApiKey(id="key", tenant_id="team", user_id="writer", name="test",
                                key_hash=hashlib.sha256(b"local-test-key").hexdigest(), status="active"))
        db.commit()

    def session():
        with sessions() as db:
            yield db

    monkeypatch.setattr(sql_models, "SessionLocal", sessions)
    monkeypatch.setattr(db_sql_compat, "get_session", session)
    monkeypatch.setenv("ADMIN_MODE", "saas")
    monkeypatch.setenv("PROJECT_PATH", str(tmp_path))
    for module in (requirements, tasks, issues, sprints):
        monkeypatch.setattr(module, "notify_webhook", lambda *a, **kw: None)
    app = FastAPI()
    app.dependency_overrides[sql_models.get_session] = session
    for module in (requirements, tasks, issues, sprints, models, llm_gateway):
        app.include_router(module.router)
    # Match main.py's current ordering: scope runs before HMAC. Router access must still bind it.
    app.middleware("http")(hmac_middleware)
    app.middleware("http")(project_scope_middleware)
    yield TestClient(app), sessions
    engine.dispose()


def headers(uid="writer", project="selected"):
    return {"Authorization": f"Bearer {auth_sql._make_token(uid, 'team', 'developer')}",
            "X-Project-Id": project}


def test_legacy_admin_alias_keeps_existing_tenant_authority_without_changing_database_role(env):
    from sop_manager.routers.delivery import _permissions

    client, sessions = env
    with sessions() as db:
        user = db.get(sql_models.User, "writer")
        user.role = "admin"
        db.query(sql_models.ProjectMember).filter_by(user_id="writer").delete()
        db.commit()
        assert _permissions(db, user, db.get(sql_models.Project, "selected")) == {
            "write": True, "approve": True, "configure": True,
        }
    response = client.post("/api/v1/requirements", headers=headers(), json={"title": "Existing admin authority"})
    assert response.status_code == 200, response.text
    assert client.put("/api/v1/models/default?model_id=gpt-4o-mini", headers=headers()).status_code == 200
    assert client.get("/api/v1/requirements", headers=headers(project="private")).status_code == 403
    with sessions() as db:
        assert db.get(sql_models.User, "writer").role == "admin"


@pytest.mark.parametrize("path", ["requirements", "tasks", "issues", "sprints"])
@pytest.mark.parametrize("identity", ["anonymous", "invalid", "expired", "disabled"])
def test_identity_required_before_legacy_reads(env, path, identity):
    client, _ = env
    auth = {"X-Project-Id": "selected"}
    if identity == "invalid":
        auth["Authorization"] = "Bearer invalid"
    elif identity == "expired":
        token = jwt.encode({"sub": "writer", "tid": "team",
                            "exp": datetime.now(timezone.utc) - timedelta(seconds=1)},
                           auth_sql.SECRET_KEY, algorithm=auth_sql.ALGORITHM)
        auth["Authorization"] = f"Bearer {token}"
    elif identity == "disabled":
        auth = headers("disabled")
    assert client.get(f"/api/v1/{path}", headers=auth).status_code == 401


@pytest.mark.parametrize("path", ["requirements", "tasks", "issues", "sprints"])
def test_explicit_project_and_project_membership_required(env, path):
    client, _ = env
    assert client.get(f"/api/v1/{path}", headers={"Authorization": headers()["Authorization"]}).status_code == 400
    assert client.get(f"/api/v1/{path}", headers=headers(project="private")).status_code == 403
    assert client.get(f"/api/v1/{path}", headers=headers("reader", "other")).status_code == 403


@pytest.mark.parametrize("path,body", [("requirements", {"title": "No"}),
                                      ("tasks", {"title": "No"}),
                                      ("issues", {"title": "No"}),
                                      ("sprints", {"goal": "No"})])
@pytest.mark.parametrize("uid", ["reader", "analyst"])
def test_readonly_roles_cannot_write_legacy_routes(env, path, body, uid):
    client, sessions = env
    assert client.get(f"/api/v1/{path}", headers=headers(uid)).status_code == 200
    assert client.post(f"/api/v1/{path}", headers=headers(uid), json=body).status_code == 403
    with sessions() as db:
        assert db.query(sql_models.Requirement).count() == 2
        assert db.query(sql_models.Task).count() == 2
        assert db.query(sql_models.Issue).count() == 2
        assert db.query(sql_models.Sprint).count() == 2


@pytest.mark.parametrize("path,body,model", [("requirements", {"title": "Allowed"}, sql_models.Requirement),
                                             ("tasks", {"title": "Allowed"}, sql_models.Task),
                                             ("issues", {"title": "Allowed"}, sql_models.Issue),
                                             ("sprints", {"goal": "Allowed"}, sql_models.Sprint)])
def test_product_manager_can_write_current_project_only(env, path, body, model):
    client, sessions = env
    response = client.post(f"/api/v1/{path}", headers=headers("product"), json=body)
    assert response.status_code == 200, response.text
    with sessions() as db:
        row = db.get(model, response.json()["id"])
        assert (row.tenant_id, row.project_id) == ("team", "selected")


@pytest.mark.parametrize("method,path,body", [
    ("patch", "issues/ISSUE-other", {"title": "Forbidden"}),
    ("patch", "issues/ISSUE-other/resolve", {"resolution": "Forbidden"}),
    ("delete", "issues/ISSUE-other", None),
    ("patch", "sprints/SPRINT-other", {"goal": "Forbidden"}),
    ("delete", "sprints/SPRINT-other", None),
    ("get", "sprints/SPRINT-other/progress", None),
    ("get", "sprints/SPRINT-other/burndown", None),
])
def test_same_tenant_resource_ids_cannot_escape_selected_project(env, method, path, body):
    client, _ = env
    response = client.request(method, f"/api/v1/{path}", headers=headers(), json=body)
    assert response.status_code == 404, response.text


@pytest.mark.parametrize("path", ["issues", "sprints"])
def test_query_and_body_cannot_switch_project_after_write_permission_check(env, path):
    client, _ = env
    assert client.get(f"/api/v1/{path}?project_id=other", headers=headers()).status_code == 400
    body = {"project_id": "other", "title": "No", "goal": "No"}
    assert client.post(f"/api/v1/{path}", headers=headers(), json=body).status_code == 400


def signed_headers(method, path, body=b"", uid="writer"):
    ts = str(int(time.time()))
    nonce = uuid.uuid4().hex
    canonical = f"{method}\n{path}\n{ts}\n{nonce}\n{hashlib.sha256(body).hexdigest()}".encode()
    return {"X-Api-Key": "local-test-key", "X-Sop-Timestamp": ts, "X-Sop-Nonce": nonce,
            "X-Sop-Signature": "sha256=" + hmac.new(b"local-test-key", canonical, hashlib.sha256).hexdigest(),
            "X-Project-Id": "selected"}


@pytest.mark.parametrize("path", ["requirements", "tasks", "issues", "sprints"])
def test_verified_hmac_owner_uses_actual_project_scope(env, path):
    client, _ = env
    url = f"/api/v1/{path}"
    response = client.get(url, headers=signed_headers("GET", url))
    assert response.status_code == 200, response.text
    payload = response.json()
    items = payload if isinstance(payload, list) else payload["items"]
    assert len(items) == 1 and items[0]["project_id"] == "selected"
    assert client.get(url, headers={"X-Api-Key": "local-test-key", "X-Project-Id": "selected"}).status_code == 401
    bad = signed_headers("GET", url)
    bad["X-Sop-Signature"] = "sha256=bad"
    assert client.get(url, headers=bad).status_code == 401
    # Request-scoped context must not leak out into the calling thread.
    assert resolved_project_id() != "selected" and resolved_tenant_id() != "team"


def test_verified_key_cannot_resurrect_disabled_user(env):
    client, sessions = env
    with sessions() as db:
        db.get(sql_models.User, "writer").status = "disabled"
        db.commit()
    path = "/api/v1/tasks"
    assert client.get(path, headers=signed_headers("GET", path)).status_code == 401


@pytest.mark.parametrize("path,body", [
    ("tasks", {"title": "No", "req_id": "REQ-other"}),
    ("tasks", {"title": "No", "sprint_id": "SPRINT-other"}),
    ("issues", {"title": "No", "task_id": "T-other"}),
    ("issues", {"title": "No", "sprint_id": "SPRINT-other"}),
])
def test_new_records_cannot_link_other_project_resources(env, path, body):
    client, _ = env
    response = client.post(f"/api/v1/{path}", headers=headers(), json=body)
    assert response.status_code == 404, response.text


@pytest.mark.parametrize("path,body", [
    ("tasks/T-selected", {"req_id": "REQ-other"}),
    ("tasks/T-selected", {"sprint_id": "SPRINT-other"}),
    ("issues/ISSUE-selected", {"sprint_id": "SPRINT-other"}),
])
def test_update_cannot_link_other_project_resources(env, path, body):
    client, _ = env
    response = client.patch(f"/api/v1/{path}", headers=headers(), json=body)
    assert response.status_code == 404, response.text


def test_configure_guard_requires_project_admin_but_read_guard_does_not(env):
    from fastapi import Depends
    from sop_manager.routers.business_access import configure_business_access, read_business_access

    client, sessions = env

    @client.app.get("/guard-read", dependencies=[Depends(read_business_access)])
    def read():
        return {"project": resolved_project_id()}

    @client.app.post("/guard-configure", dependencies=[Depends(configure_business_access)])
    def configure():
        return {"project": resolved_project_id()}

    assert client.get("/guard-read", headers=headers("reader")).json() == {"project": "selected"}
    assert client.post("/guard-configure", headers=headers("writer")).status_code == 403
    with sessions() as db:
        db.get(sql_models.ProjectMember, ("selected", "writer")).role = "project_admin"
        db.commit()
    assert client.post("/guard-configure", headers=headers("writer")).json() == {"project": "selected"}


@pytest.mark.parametrize("path", ["requirements", "tasks", "issues", "sprints", "models", "llm/routing", "delivery/workspace", "analytics/nlq"])
def test_single_mode_protected_reads_never_provision_unknown_projects(env, monkeypatch, path):
    from sop_manager import project_provision

    client, sessions = env
    monkeypatch.setenv("ADMIN_MODE", "single")
    calls = []
    original = project_provision.ensure_project

    def track(*args, **kwargs):
        calls.append(args)
        return original(*args, **kwargs)

    monkeypatch.setattr(project_provision, "ensure_project", track)
    response = client.get(f"/api/v1/{path}", headers=headers(project="random-unknown"))
    assert response.status_code == 404, response.text
    assert calls == []
    with sessions() as db:
        assert db.get(sql_models.Project, "random-unknown") is None


def test_task_detail_reads_real_scoped_row_and_keeps_static_routes(env):
    client, _ = env
    response = client.get("/api/v1/tasks/T-selected", headers=headers("reader"))
    assert response.status_code == 200, response.text
    listed = client.get("/api/v1/tasks", headers=headers("reader")).json()
    items = listed if isinstance(listed, list) else listed["items"]
    assert response.json() == items[0]
    assert client.get("/api/v1/tasks/T-other", headers=headers()).status_code == 404
    assert client.get("/api/v1/tasks/T-missing", headers=headers()).status_code == 404
    assert client.get("/api/v1/tasks/T-selected").status_code == 401
    assert client.get("/api/v1/tasks/summary", headers=headers()).status_code == 200


@pytest.mark.parametrize("method,path,body", [
    ("GET", "models", None),
    ("GET", "llm/routing", None),
    ("PUT", "models/default?model_id=gpt-4o", None),
    ("POST", "models/providers/openai/test", None),
    ("POST", "llm/chat", {"messages": [{"role": "user", "content": "No provider call"}]}),
])
def test_model_entry_points_deny_anonymous_before_configuration_or_provider_work(env, method, path, body):
    client, _ = env
    response = client.request(method, f"/api/v1/{path}", headers={"X-Project-Id": "selected"}, json=body)
    assert response.status_code == 401, response.text


def test_model_read_write_and_configuration_roles_are_distinct(env):
    client, sessions = env
    for path in ("models", "llm/routing"):
        assert client.get(f"/api/v1/{path}", headers=headers("reader")).status_code == 200
    body = {"messages": [{"role": "user", "content": "No provider call"}]}
    assert client.post("/api/v1/llm/chat", headers=headers("reader"), json=body).status_code == 403
    assert client.put("/api/v1/models/default?model_id=gpt-4o", headers=headers()).status_code == 403
    assert client.post("/api/v1/models/providers/openai/test", headers=headers()).status_code == 403
    with sessions() as db:
        db.get(sql_models.ProjectMember, ("selected", "writer")).role = "project_admin"
        db.commit()
    assert client.put("/api/v1/models/default?model_id=gpt-4o", headers=headers()).status_code == 200
