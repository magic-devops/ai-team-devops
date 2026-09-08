from fastapi import FastAPI
from fastapi.testclient import TestClient

from sop_manager.routers.legacy_unversioned_api_redirect import legacy_unversioned_api_redirect_middleware
from sop_manager.routers.auth_sql import current_user
from sop_manager.routers.hermes_workspace import mount_hermes_workspace
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
