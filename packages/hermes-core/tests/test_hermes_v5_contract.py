import pytest
from fastapi.testclient import TestClient

from hermes_core.api import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path / "db", "token")
    client = TestClient(app, headers={"Authorization": "Bearer token"})
    workspace = client.post("/api/v2/workspaces", json={"data": {"name": "QA", "root": str(tmp_path)}, "idempotency_key": "workspace"}).json()["items"][0]
    client.headers["X-Workspace-Id"] = workspace["id"]
    return app, client, workspace


def test_health_catalog_crud_and_soft_delete(client):
    app, client, _ = client
    assert TestClient(app).get("/api/v2/health").json()["ok"]
    assert TestClient(app).get("/api/v2/actions").status_code == 401
    assert client.get("/api/v2/actions").json()["items"]
    body = {"data": {"kind": "knowledge", "content": "Verified note"}, "idempotency_key": "asset"}
    asset = client.post("/api/v2/assets", json=body).json()["items"][0]
    assert client.post("/api/v2/assets", json=body).json()["items"][0] == asset
    action = {"expected_version": 1, "idempotency_key": "archive"}
    assert client.request("DELETE", f"/api/v2/assets/{asset['id']}", json=action).json()["summary"]["dry_run"]
    assert client.get(f"/api/v2/assets/{asset['id']}").json()["items"][0]["status"] == "active"
    assert client.request("DELETE", f"/api/v2/assets/{asset['id']}", json={**action, "dry_run": False}).json()["items"][0]["status"] == "archived"
    assert client.request("DELETE", "/api/v2/tasks/unknown", json=action).status_code == 409
    events = client.get("/api/v2/sync").json()["items"]
    assert len(events) == 2


def test_workspace_roots_and_ownership_are_guarded(client, tmp_path):
    app, client, workspace = client
    no_root = client.post("/api/v2/workspaces", json={"data": {"name": "Invalid"}, "idempotency_key": "no-root"})
    assert no_root.status_code == 400
    app.state.hermes_execution.allowed_roots = (tmp_path / "allowed",)
    denied = client.post("/api/v2/workspaces", json={"data": {"name": "Invalid", "root": str(tmp_path)}, "idempotency_key": "denied"})
    assert denied.status_code == 403
    response = client.patch(f"/api/v2/workspaces/{workspace['id']}", json={"data": {"owner": "attacker"}, "idempotency_key": "steal", "expected_version": 1})
    assert response.status_code == 403


def test_clients_cannot_forge_execution_evidence(client):
    _, client, _ = client
    body = {"data": {"nodes": [{"id": "test", "argv": ["false"]}], "node_results": {"test": {"succeeded": True}}}, "idempotency_key": "forged"}
    assert client.post("/api/v2/runs", json=body).status_code == 422
    assert client.get("/api/v2/runs").json()["items"] == []


def test_rejected_approval_gets_new_attempt_on_retry(client, monkeypatch):
    app, client, _ = client
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)
    run = client.post("/api/v2/runs", json={"data": {"nodes": [{"id": "review", "kind": "approval"}]}, "idempotency_key": "run"}).json()["items"][0]
    assert client.post(f"/api/v2/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "start", "dry_run": False}).status_code == 200
    first = client.get("/api/v2/approvals").json()["items"][0]
    assert client.post(f"/api/v2/approvals/{first['id']}/decision", json={"expected_version": 1, "idempotency_key": "reject", "decision": "reject"}).status_code == 200
    failed = client.get(f"/api/v2/runs/{run['id']}").json()["items"][0]
    assert failed["status"] == "failed"
    assert client.post(f"/api/v2/runs/{run['id']}/retry", json={"expected_version": failed["version"], "idempotency_key": "retry", "dry_run": False}).status_code == 200
    approvals = client.get("/api/v2/approvals").json()["items"]
    assert len(approvals) == 2
    second = next(row for row in approvals if row["status"] == "pending")
    assert second["id"] != first["id"]
    assert client.post(f"/api/v2/approvals/{second['id']}/decision", json={"expected_version": 1, "idempotency_key": "approve", "decision": "approve"}).status_code == 200
    assert client.get(f"/api/v2/runs/{run['id']}").json()["items"][0]["status"] == "completed"
