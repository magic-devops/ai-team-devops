from fastapi import FastAPI
from fastapi.testclient import TestClient

from sop_manager.routers.auth_sql import current_user
from sop_manager.routers.hermes_workspace import mount_hermes_workspace
from sop_manager.routers.legacy_unversioned_api_redirect import legacy_unversioned_api_redirect_middleware
from sop_manager.routers.sql_models import User


def test_manager_execution_fails_closed_and_uses_authenticated_actor(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_DATA_DIR", str(tmp_path / "store"))
    monkeypatch.setenv("HERMES_EXECUTION_ROOTS", str(tmp_path))
    monkeypatch.delenv("HERMES_ALLOW_MANAGER_EXECUTION", raising=False)
    app = FastAPI()
    mount_hermes_workspace(app)
    user = User(id="admin", tenant_id="tenant-a", role="project_admin")
    app.dependency_overrides[current_user] = lambda: user
    client = TestClient(app)
    response = client.post("/api/hermes/v1/workspaces", json={"data": {"name": "Manager QA", "root": str(tmp_path), "owner": "forged"}, "idempotency_key": "workspace"})
    assert response.status_code == 201, response.text
    workspace = response.json()["items"][0]
    assert workspace["data"]["owner"] == "admin"
    assert response.json()["audit"]["actor"] == "admin"
    assert "execute" not in response.json()["permissions"]
    assert not app.state.hermes_execution.available()
    client.headers["X-Workspace-Id"] = workspace["id"]
    run = client.post("/api/hermes/v1/runs", json={"data": {"nodes": [{"id": "test", "argv": ["echo", "test"]}]}, "idempotency_key": "run"}).json()["items"][0]
    assert client.post(f"/api/hermes/v1/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "start", "dry_run": False}).status_code == 403
    app.dependency_overrides[current_user] = lambda: User(id="other", tenant_id="tenant-b", role="super_admin")
    assert client.get(f"/api/hermes/v1/runs/{run['id']}").status_code == 404


def test_workspace_page_is_registered():
    from sop_manager.routers.system_pages import NAV_CONTRACT, REACT_PAGES
    nav = next(row for row in NAV_CONTRACT if row["id"] == "workspace")
    page = next(row for row in REACT_PAGES if row["id"] == "workspace")
    assert nav["path"] == page["path"] == "#/workspace"
    assert nav["capability"] == page["capability"] == "overview.hermes.workspace"


def test_canonical_hermes_route_is_not_legacy_redirected(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_DATA_DIR", str(tmp_path / "store"))
    app = FastAPI()
    app.middleware("http")(legacy_unversioned_api_redirect_middleware)
    mount_hermes_workspace(app)
    app.dependency_overrides[current_user] = lambda: User(id="admin", tenant_id="tenant-a", role="super_admin")
    client = TestClient(app)

    assert client.get("/api/hermes/v1/health", follow_redirects=False).status_code == 200
    old = client.get("/api/v2/health", follow_redirects=False)
    assert old.status_code == 404
    assert "location" not in old.headers


def test_team_collaboration_only_lists_active_same_tenant_workspace_members(tmp_path, monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from sop_manager.routers import hermes_workspace
    from sop_manager.routers.sql_models import Base

    database = create_engine("sqlite:///" + str(tmp_path / "auth.sqlite"))
    Base.metadata.create_all(database)
    sessions = sessionmaker(bind=database)
    monkeypatch.setattr(hermes_workspace, "SessionLocal", sessions)
    with sessions() as session:
        for user_id, tenant, status in [("admin", "a", "active"), ("alice", "a", "active"),
                                         ("disabled", "a", "disabled"), ("foreign", "b", "active")]:
            session.add(User(id=user_id, tenant_id=tenant, username=user_id, password_hash=user_id, status=status))
        session.commit()
    monkeypatch.setenv("HERMES_DATA_DIR", str(tmp_path / "core"))
    monkeypatch.setenv("HERMES_EXECUTION_ROOTS", str(tmp_path))
    app = FastAPI()
    mount_hermes_workspace(app)
    app.dependency_overrides[current_user] = lambda: User(id="admin", tenant_id="a", role="super_admin")
    client = TestClient(app)
    created = client.post("/api/hermes/v1/workspaces", json={"data": {"name": "Team", "root": str(tmp_path),
        "members": ["alice", "disabled", "foreign"]}, "idempotency_key": "team"})
    assert created.status_code == 201, created.text
    workspace = created.json()["items"][0]
    client.headers["X-Workspace-Id"] = workspace["id"]
    base = "/api/hermes/v1/collaboration"
    assert client.get(base + "/members").json()["items"] == [{"id": "admin"}, {"id": "alice"}]
    body = {"title": "Team", "members": ["admin", "foreign"], "dry_run": False, "idempotency_key": "create"}
    assert client.post(base + "/channels/general/configure", json=body).status_code == 422
    body["members"] = ["admin", "alice"]
    channel = client.post(base + "/channels/general/configure", json=body).json()["items"][0]
    app.dependency_overrides[current_user] = lambda: User(id="alice", tenant_id="a", role="developer")
    assert client.get(base + "/channels").json()["items"][0]["id"] == channel["id"]
    assert client.post(base + "/threads", json={"channel_id": channel["id"], "title": "Review", "body": "Ready",
        "dry_run": False, "idempotency_key": "thread"}).status_code == 200
    app.dependency_overrides[current_user] = lambda: User(id="foreign", tenant_id="b", role="super_admin")
    assert client.get(base + "/channels").status_code == 404
