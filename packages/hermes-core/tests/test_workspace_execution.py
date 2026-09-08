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
    result = client.post("/api/hermes/v1/workspaces", json={"data": {"name": "Test", "root": str(tmp_path)}, "idempotency_key": "workspace"})
    assert result.status_code == 201, result.text
    workspace = result.json()["items"][0]["id"]
    client.headers["X-Workspace-Id"] = workspace
    return app, client, workspace


def create_run(client, nodes):
    response = client.post("/api/hermes/v1/runs", json={"data": {"title": "TDD", "nodes": nodes}, "idempotency_key": uuid.uuid4().hex})
    assert response.status_code == 201, response.text
    return response.json()["items"][0]


def test_auth_scope_and_permissions(core):
    app, client, workspace = core
    assert TestClient(app).get("/api/hermes/v1/workspaces").status_code == 401
    assert client.get("/api/hermes/v1/tasks", headers={"Authorization": "Bearer other-token"}).status_code == 404
    denied = client.post("/api/hermes/v1/tasks", headers={"Authorization": "Bearer viewer-token"}, json={"data": {}, "idempotency_key": "denied"})
    assert denied.status_code == 403
    assert client.get("/api/hermes/v1/tasks").json()["items"] == []


def test_atomic_idempotency_and_version(core):
    _app, client, _workspace = core
    body = {"data": {"title": "One task"}, "idempotency_key": "unique"}
    first = client.post("/api/hermes/v1/tasks", json=body).json()["items"][0]
    assert client.post("/api/hermes/v1/tasks", json=body).json()["items"][0] == first
    assert client.post("/api/hermes/v1/tasks", json={**body, "data": {"title": "different"}}).status_code == 409
    changed_status = client.post("/api/hermes/v1/tasks", json={**body, "data": {"title": "One task", "status": "completed"}})
    assert changed_status.status_code == 409
    update = {"data": {"title": "Updated"}, "expected_version": first["version"], "idempotency_key": "update"}
    assert client.patch(f"/api/hermes/v1/tasks/{first['id']}", json=update).status_code == 200
    assert client.patch(f"/api/hermes/v1/tasks/{first['id']}", json={**update, "idempotency_key": "stale"}).status_code == 409
    events = client.get("/api/hermes/v1/sync").json()["items"]
    assert len(events) == 2
    assert all(event["actor"] == "owner" for event in events)
    assert client.get("/api/hermes/v1/sync", params={"after": events[-1]["seq"]}).json()["items"] == []


def test_typed_resources_validate_title_status_and_clearable_optional_fields(core):
    _app, client, _workspace = core
    assert client.post("/api/hermes/v1/tasks", json={"data": {}, "idempotency_key": "missing-title"}).status_code == 422
    assert client.post("/api/hermes/v1/tasks", json={"data": {"title": "x" * 121}, "idempotency_key": "long-title"}).status_code == 422
    assert client.post("/api/hermes/v1/tasks", json={"data": {"title": "Task", "status": "waiting"}, "idempotency_key": "bad-status"}).status_code == 422
    assert client.post("/api/hermes/v1/tasks", json={"data": {"title": "Task", "mystery": "field"}, "idempotency_key": "bad-field"}).status_code == 422
    task = client.post("/api/hermes/v1/tasks", json={
        "data": {"title": "Task", "summary": "keep", "priority": "high", "status": "in_progress"},
        "idempotency_key": "valid-task",
    }).json()["items"][0]
    assert task["status"] == "in_progress"
    patched = client.patch(f"/api/hermes/v1/tasks/{task['id']}", json={
        "data": {"summary": "", "assigned_agent": "", "dev_tool": "", "acceptance_criteria": "", "source": "", "kind": ""},
        "expected_version": task["version"],
        "idempotency_key": "clear-optionals",
    }).json()["items"][0]
    for field in ("summary", "assigned_agent", "dev_tool", "acceptance_criteria", "source", "kind"):
        assert patched["data"][field] == ""


def test_kind_filter_applies_before_list_pagination(core):
    _app, client, _workspace = core
    for index in range(3):
        created = client.post("/api/hermes/v1/assets", json={
            "data": {"title": f"Asset {index}", "kind": "note" if index < 2 else "knowledge"},
            "idempotency_key": f"asset-{index}",
        })
        assert created.status_code == 201, created.text
    result = client.get("/api/hermes/v1/assets", params={"kind": "knowledge", "limit": 1})
    assert result.status_code == 200, result.text
    payload = result.json()
    assert [item["data"]["kind"] for item in payload["items"]] == ["knowledge"]


def test_dry_run_has_no_events(core):
    _app, client, _workspace = core
    run = create_run(client, [{"id": "test", "argv": ["echo", "test"]}])
    before = client.get("/api/hermes/v1/sync").json()["items"]
    response = client.post(f"/api/hermes/v1/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "preview"})
    assert response.json()["summary"]["dry_run"]
    assert client.get("/api/hermes/v1/sync").json()["items"] == before


def test_langgraph_interrupt_resume_and_checkpoint(core, monkeypatch):
    app, client, _workspace = core
    calls = []
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)

    def execute_tool(_principal, _workspace, _run_id, node, _root, _owner):
        calls.append(node.id)
        return {"succeeded": True, "exit_code": node.expected_exit_code, "stdout": node.id}

    monkeypatch.setattr(app.state.hermes_execution, "tool", execute_tool)
    run = create_run(client, [{"id": "red", "argv": ["test"], "expected_exit_code": 1}, {"id": "review", "kind": "approval"}, {"id": "green", "argv": ["test"]}])
    started = client.post(f"/api/hermes/v1/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "start", "dry_run": False})
    assert started.status_code == 200, started.text
    detail = client.get(f"/api/hermes/v1/runs/{run['id']}").json()["items"][0]
    assert detail["status"] == "interrupted", detail
    approval = client.get("/api/hermes/v1/approvals").json()["items"][0]
    decision = {"decision": "approve", "expected_version": approval["version"], "idempotency_key": "approval"}
    result = client.post(f"/api/hermes/v1/approvals/{approval['id']}/decision", json=decision)
    assert result.status_code == 200, result.text
    detail = client.get(f"/api/hermes/v1/runs/{run['id']}").json()["items"][0]
    assert detail["status"] == "completed", detail
    assert calls == ["red", "green"]
    assert client.post(f"/api/hermes/v1/approvals/{approval['id']}/decision", json=decision).status_code == 200
    assert calls == ["red", "green"]


def test_invalid_graph_does_not_write(core):
    _app, client, _workspace = core
    response = client.post("/api/hermes/v1/runs", json={"data": {"nodes": [{"id": "../unsafe", "argv": []}]}, "idempotency_key": "bad"})
    assert response.status_code == 422
    assert client.get("/api/hermes/v1/runs").json()["items"] == []


def test_uncertain_tool_failure_requires_review_and_replay_clears_runtime(core, monkeypatch):
    app, client, _ = core
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)

    def broken_tool(*_args):
        raise CoreError("executor_protocol", "Executor connection lost", 502)

    monkeypatch.setattr(app.state.hermes_execution, "tool", broken_tool)
    run = create_run(client, [{"id": "write", "argv": ["echo", "test"]}])
    client.post(f"/api/hermes/v1/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "start", "dry_run": False})
    failed = client.get(f"/api/hermes/v1/runs/{run['id']}").json()["items"][0]
    assert failed["status"] == "failed"
    assert failed["data"]["recovery_requires_review"]
    replay = client.post(f"/api/hermes/v1/runs/{run['id']}/replay", json={"expected_version": failed["version"], "idempotency_key": "replay", "dry_run": False}).json()["items"][0]
    assert "recovery_requires_review" not in replay["data"]
    assert "attempt" not in replay["data"]


def test_workspace_change_invalidates_approval(core, monkeypatch):
    app, client, workspace = core
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)
    run = create_run(client, [{"id": "review", "kind": "approval"}])
    client.post(f"/api/hermes/v1/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "start", "dry_run": False})
    approval = client.get("/api/hermes/v1/approvals").json()["items"][0]
    assert client.patch(f"/api/hermes/v1/workspaces/{workspace}", json={"data": {"name": "Changed"}, "expected_version": 1, "idempotency_key": "change"}).status_code == 200
    decision = client.post(f"/api/hermes/v1/approvals/{approval['id']}/decision", json={"decision": "approve", "expected_version": 1, "idempotency_key": "approve"})
    assert decision.status_code == 409
    assert decision.json()["error"]["code"] == "approval_stale"


def test_duplicate_approval_receipt_does_not_resume_later_gate(core, monkeypatch):
    app, client, _workspace = core
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)
    run = create_run(client, [
        {"id": "first", "kind": "approval", "title": "First gate"},
        {"id": "second", "kind": "approval", "title": "Second gate"},
    ])
    assert client.post(f"/api/hermes/v1/runs/{run['id']}/start", json={
        "expected_version": run["version"],
        "idempotency_key": "start",
        "dry_run": False,
    }).status_code == 200
    first_approval = client.get("/api/hermes/v1/approvals").json()["items"][0]
    first_decision = {
        "decision": "approve",
        "expected_version": first_approval["version"],
        "idempotency_key": "approve-first",
    }
    assert client.post(f"/api/hermes/v1/approvals/{first_approval['id']}/decision", json=first_decision).status_code == 200
    waiting_second = client.get(f"/api/hermes/v1/runs/{run['id']}").json()["items"][0]
    assert waiting_second["status"] == "interrupted"
    assert waiting_second["data"]["active_node"] == "second"
    duplicate = client.post(f"/api/hermes/v1/approvals/{first_approval['id']}/decision", json=first_decision)
    assert duplicate.status_code == 200
    app.state.hermes_execution.execute(Principal("owner"), _workspace, run["id"], resume={
        "approval_id": first_approval["id"],
        "approval_version": first_approval["version"] + 1,
    })
    still_waiting = client.get(f"/api/hermes/v1/runs/{run['id']}").json()["items"][0]
    assert still_waiting["status"] == "interrupted"
    assert still_waiting["data"]["active_node"] == "second"
    assert "error" not in still_waiting["data"]
    second_approval = next(row for row in client.get("/api/hermes/v1/approvals").json()["items"] if row["data"]["node_id"] == "second")
    assert client.post(f"/api/hermes/v1/approvals/{second_approval['id']}/decision", json={
        "decision": "approve",
        "expected_version": second_approval["version"],
        "idempotency_key": "approve-second",
    }).status_code == 200
    assert client.get(f"/api/hermes/v1/runs/{run['id']}").json()["items"][0]["status"] == "completed"


def test_stale_resume_claim_does_not_displace_valid_approved_gate(core, monkeypatch):
    app, client, workspace = core
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)
    run = create_run(client, [
        {"id": "first", "kind": "approval", "title": "First gate"},
        {"id": "second", "kind": "approval", "title": "Second gate"},
    ])
    assert client.post(f"/api/hermes/v1/runs/{run['id']}/start", json={
        "expected_version": run["version"],
        "idempotency_key": "start",
        "dry_run": False,
    }).status_code == 200
    first_approval = client.get("/api/hermes/v1/approvals").json()["items"][0]
    assert client.post(f"/api/hermes/v1/approvals/{first_approval['id']}/decision", json={
        "decision": "approve",
        "expected_version": first_approval["version"],
        "idempotency_key": "approve-first",
    }).status_code == 200
    second_waiting = client.get(f"/api/hermes/v1/runs/{run['id']}").json()["items"][0]
    second_approval = next(row for row in client.get("/api/hermes/v1/approvals").json()["items"] if row["data"]["node_id"] == "second")
    approved_second = app.state.hermes_store.mutate(
        Principal("owner"),
        workspace,
        "approvals",
        second_approval["id"],
        operation="approval.test-approved",
        key="approve-second-direct",
        request={},
        trace="trace",
        expected=second_approval["version"],
        transform=lambda item: {"status": "approved", "data": {**item["data"], "decision": "approve"}},
    )

    app.state.hermes_execution.execute(Principal("owner"), workspace, run["id"], resume={
        "approval_id": first_approval["id"],
        "approval_version": first_approval["version"] + 1,
    })
    still_waiting = client.get(f"/api/hermes/v1/runs/{run['id']}").json()["items"][0]
    assert still_waiting["status"] == "interrupted"
    assert still_waiting["version"] == second_waiting["version"]
    assert still_waiting["data"]["active_node"] == "second"
    assert still_waiting["data"].get("execution_owner") is None

    app.state.hermes_execution.execute(Principal("owner"), workspace, run["id"], resume={
        "approval_id": approved_second["id"],
        "approval_version": approved_second["version"],
    })
    assert client.get(f"/api/hermes/v1/runs/{run['id']}").json()["items"][0]["status"] == "completed"


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
