import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from hermes_core.api import create_app
from hermes_core.models import CoreError, Principal
from hermes_core.transactional import Store


@pytest.fixture
def core(tmp_path):
    app = create_app(tmp_path / "data", "owner-token", principals={
        "owner-token": Principal("owner"),
        "viewer-token": Principal("viewer", permissions=frozenset({"read"})),
        "other-token": Principal("other", tenant="other"),
    })
    client = TestClient(app, headers={"Authorization": "Bearer owner-token"})
    result = client.post("/api/v2/workspaces", json={"data": {"name": "Test", "root": str(tmp_path)}, "idempotency_key": "workspace"})
    assert result.status_code == 201, result.text
    workspace = result.json()["items"][0]["id"]
    client.headers["X-Workspace-Id"] = workspace
    return app, client, workspace


def create_run(client, nodes):
    response = client.post("/api/v2/runs", json={"data": {"title": "TDD", "nodes": nodes}, "idempotency_key": uuid.uuid4().hex})
    assert response.status_code == 201, response.text
    return response.json()["items"][0]


def test_auth_scope_and_permissions(core):
    app, client, workspace = core
    assert TestClient(app).get("/api/v2/workspaces").status_code == 401
    assert client.get("/api/v2/tasks", headers={"Authorization": "Bearer other-token"}).status_code == 404
    denied = client.post("/api/v2/tasks", headers={"Authorization": "Bearer viewer-token"}, json={"data": {}, "idempotency_key": "denied"})
    assert denied.status_code == 403
    assert client.get("/api/v2/tasks").json()["items"] == []


def test_atomic_idempotency_and_version(core):
    _app, client, _workspace = core
    body = {"data": {"title": "One task"}, "idempotency_key": "unique"}
    first = client.post("/api/v2/tasks", json=body).json()["items"][0]
    assert client.post("/api/v2/tasks", json=body).json()["items"][0] == first
    assert client.post("/api/v2/tasks", json={**body, "data": {"title": "different"}}).status_code == 409
    update = {"data": {"title": "Updated"}, "expected_version": first["version"], "idempotency_key": "update"}
    assert client.patch(f"/api/v2/tasks/{first['id']}", json=update).status_code == 200
    assert client.patch(f"/api/v2/tasks/{first['id']}", json={**update, "idempotency_key": "stale"}).status_code == 409
    events = client.get("/api/v2/sync").json()["items"]
    assert len(events) == 2
    assert all(event["actor"] == "owner" for event in events)
    assert client.get("/api/v2/sync", params={"after": events[-1]["seq"]}).json()["items"] == []


def test_dry_run_has_no_events(core):
    _app, client, _workspace = core
    run = create_run(client, [{"id": "test", "argv": ["echo", "test"]}])
    before = client.get("/api/v2/sync").json()["items"]
    response = client.post(f"/api/v2/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "preview"})
    assert response.json()["summary"]["dry_run"]
    assert client.get("/api/v2/sync").json()["items"] == before


def test_langgraph_interrupt_resume_and_checkpoint(core, monkeypatch):
    app, client, _workspace = core
    calls = []
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)

    def execute_tool(_principal, _workspace, _run_id, node, _root, _owner):
        calls.append(node.id)
        return {"succeeded": True, "exit_code": node.expected_exit_code, "stdout": node.id}

    monkeypatch.setattr(app.state.hermes_execution, "tool", execute_tool)
    run = create_run(client, [{"id": "red", "argv": ["test"], "expected_exit_code": 1}, {"id": "review", "kind": "approval"}, {"id": "green", "argv": ["test"]}])
    started = client.post(f"/api/v2/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "start", "dry_run": False})
    assert started.status_code == 200, started.text
    detail = client.get(f"/api/v2/runs/{run['id']}").json()["items"][0]
    assert detail["status"] == "interrupted", detail
    approval = client.get("/api/v2/approvals").json()["items"][0]
    decision = {"decision": "approve", "expected_version": approval["version"], "idempotency_key": "approval"}
    result = client.post(f"/api/v2/approvals/{approval['id']}/decision", json=decision)
    assert result.status_code == 200, result.text
    detail = client.get(f"/api/v2/runs/{run['id']}").json()["items"][0]
    assert detail["status"] == "completed", detail
    assert calls == ["red", "green"]
    assert client.post(f"/api/v2/approvals/{approval['id']}/decision", json=decision).status_code == 200
    assert calls == ["red", "green"]


def test_invalid_graph_does_not_write(core):
    _app, client, _workspace = core
    response = client.post("/api/v2/runs", json={"data": {"nodes": [{"id": "../unsafe", "argv": []}]}, "idempotency_key": "bad"})
    assert response.status_code == 422
    assert client.get("/api/v2/runs").json()["items"] == []


def test_uncertain_tool_failure_requires_review_and_replay_clears_runtime(core, monkeypatch):
    app, client, _ = core
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)

    def broken_tool(*_args):
        raise CoreError("executor_protocol", "Executor connection lost", 502)

    monkeypatch.setattr(app.state.hermes_execution, "tool", broken_tool)
    run = create_run(client, [{"id": "write", "argv": ["echo", "test"]}])
    client.post(f"/api/v2/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "start", "dry_run": False})
    failed = client.get(f"/api/v2/runs/{run['id']}").json()["items"][0]
    assert failed["status"] == "failed"
    assert failed["data"]["recovery_requires_review"]
    replay = client.post(f"/api/v2/runs/{run['id']}/replay", json={"expected_version": failed["version"], "idempotency_key": "replay", "dry_run": False}).json()["items"][0]
    assert "recovery_requires_review" not in replay["data"]
    assert "attempt" not in replay["data"]


def test_workspace_change_invalidates_approval(core, monkeypatch):
    app, client, workspace = core
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)
    run = create_run(client, [{"id": "review", "kind": "approval"}])
    client.post(f"/api/v2/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "start", "dry_run": False})
    approval = client.get("/api/v2/approvals").json()["items"][0]
    assert client.patch(f"/api/v2/workspaces/{workspace}", json={"data": {"name": "Changed"}, "expected_version": 1, "idempotency_key": "change"}).status_code == 200
    decision = client.post(f"/api/v2/approvals/{approval['id']}/decision", json={"decision": "approve", "expected_version": 1, "idempotency_key": "approve"})
    assert decision.status_code == 409
    assert decision.json()["error"]["code"] == "approval_stale"


def test_concurrent_version_compare_and_swap(tmp_path):
    store = Store("sqlite:///" + str(tmp_path / "concurrent.db"))
    principal = Principal("owner")
    task = store.create(principal, "w", "tasks", {}, "create", "trace")

    def change(index):
        try:
            store.mutate(principal, "w", "tasks", task["id"], operation="update", key=str(index), request={}, trace="trace",
                expected=1, transform=lambda item: {"data": {"index": index}})
            return True
        except CoreError as exc:
            assert exc.code == "version_conflict"
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(change, range(8))) == 1
    assert len(store.stream(principal, "w")) == 2
