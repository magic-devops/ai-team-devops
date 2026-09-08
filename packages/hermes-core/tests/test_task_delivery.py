import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from hermes_core.api import create_app
from hermes_core.models import Principal

BASE = "/api/hermes/v1"


@pytest.fixture
def delivery(tmp_path, monkeypatch):
    app = create_app(
        tmp_path / "core",
        "owner",
        principals={
            "owner": Principal("owner"),
            "reader": Principal("reader", permissions=frozenset({"read"})),
            "writer": Principal("writer", permissions=frozenset({"read", "write"})),
            "reviewer": Principal("reviewer", permissions=frozenset({"read", "approve"})),
            "other": Principal("other", tenant="other"),
        },
    )
    client = TestClient(app, headers={"Authorization": "Bearer owner"})
    workspace = client.post(
        BASE + "/workspaces",
        json={"data": {"name": "Delivery", "root": str(tmp_path)}, "idempotency_key": "workspace"},
    ).json()["items"][0]
    client.headers["X-Workspace-Id"] = workspace["id"]
    task = client.post(
        BASE + "/tasks",
        json={
            "data": {"title": "Ship a change", "acceptance_criteria": "Tests pass and output reviewed"},
            "idempotency_key": "task",
        },
    ).json()["items"][0]
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)
    monkeypatch.setattr(
        app.state.hermes_execution,
        "tool",
        lambda *args: {"succeeded": True, "exit_code": 0, "stdout": "verified"},
    )
    return client, task


def dispatch(client, task, **overrides):
    body = {
        "expected_version": task["version"],
        "idempotency_key": "dispatch",
        "dry_run": False,
        "nodes": [{"id": "test", "argv": ["echo", "verified"]}],
        **overrides,
    }
    return client.post(f"{BASE}/tasks/{task['id']}/dispatch", json=body)


def test_preview_atomic_dispatch_and_task_provenance(delivery):
    client, task = delivery
    before = client.get(BASE + "/sync").json()
    assert dispatch(client, task, dry_run=True).json()["summary"]["dry_run"]
    assert client.get(BASE + "/sync").json()["items"] == before["items"]
    first = dispatch(client, task)
    assert first.status_code == 200, first.text
    result = first.json()["items"][0]
    assert result["task"]["status"] == "in_progress"
    assert result["run"]["data"]["task_source"]["task_version"] == 1
    assert dispatch(client, task).json()["items"][0] == result
    assert dispatch(client, result["task"], idempotency_key="second").status_code == 409
    assert len(client.get(BASE + "/runs").json()["items"]) == 1
    assert (
        client.patch(
            f"{BASE}/tasks/{task['id']}",
            json={"data": {"status": "completed"}, "expected_version": 2, "idempotency_key": "bypass"},
        ).status_code
        == 409
    )
    run = result["run"]
    assert (
        client.patch(
            f"{BASE}/runs/{run['id']}",
            json={"data": {"title": "tampered"}, "expected_version": 1, "idempotency_key": "edit-run"},
        ).status_code
        == 409
    )
    assert (
        client.post(BASE + "/runs", json={"data": {**run["data"]}, "idempotency_key": "forge"}).status_code
        == 422
    )


def test_evidence_review_and_immutable_audit(delivery):
    client, task = delivery
    result = dispatch(client, task).json()["items"][0]
    run = result["run"]
    review = {
        "run_id": run["id"],
        "run_version": 1,
        "expected_version": 2,
        "decision": "accept",
        "comment": "Verified output",
        "idempotency_key": "review",
        "dry_run": False,
    }
    url = f"{BASE}/tasks/{task['id']}/review"
    assert client.post(url, json=review).status_code == 409
    assert (
        client.post(
            f"{BASE}/runs/{run['id']}/start",
            json={"expected_version": 1, "idempotency_key": "start", "dry_run": False},
        ).status_code
        == 200
    )
    detail = client.get(f"{BASE}/tasks/{task['id']}/delivery").json()["items"][0]
    assert detail["phase"] == "awaiting_review"
    review["run_version"] = detail["run"]["version"]
    assert client.post(url, json=review, headers={"Authorization": "Bearer writer"}).status_code == 403
    before = client.get(BASE + "/sync").json()["items"]
    assert client.post(url, json={**review, "dry_run": True}).status_code == 200
    assert client.get(BASE + "/sync").json()["items"] == before
    accepted = client.post(url, json=review, headers={"Authorization": "Bearer reviewer"})
    assert accepted.status_code == 200, accepted.text
    item = accepted.json()["items"][0]
    assert item["task"]["status"] == "completed"
    assert item["review"]["actor"] == "reviewer"
    assert len(item["review"]["evidence_sha256"]) == 64
    assert item["review"]["trace_id"] == accepted.json()["trace_id"]
    assert (
        client.post(url, json=review, headers={"Authorization": "Bearer reviewer"}).json()["items"][0] == item
    )
    events = client.get(BASE + "/sync").json()["items"]
    assert any(
        event["action"] == "task.review_evidence" and event["data"]["comment"] == "Verified output"
        for event in events
    )


def test_cancel_request_changes_and_redispatch(delivery):
    client, task = delivery
    result = dispatch(client, task).json()["items"][0]
    run = result["run"]
    client.post(
        f"{BASE}/runs/{run['id']}/cancel",
        json={"expected_version": 1, "idempotency_key": "cancel", "dry_run": False},
    )
    review = {
        "run_id": run["id"],
        "run_version": 2,
        "expected_version": 2,
        "decision": "accept",
        "comment": "Rework required",
        "idempotency_key": "review",
        "dry_run": False,
    }
    url = f"{BASE}/tasks/{task['id']}/review"
    assert client.post(url, json=review).status_code == 409
    changed = client.post(url, json={**review, "decision": "request_changes"}).json()["items"][0]["task"]
    assert changed["status"] == "blocked"
    for action in ("start", "retry"):
        denied = client.post(
            f"{BASE}/runs/{run['id']}/{action}",
            json={"expected_version": 2, "idempotency_key": "closed-" + action, "dry_run": False},
        )
        assert denied.status_code == 409
        assert denied.json()["error"]["code"] == "delivery_closed"
    patched = client.patch(
        f"{BASE}/tasks/{task['id']}",
        json={
            "data": {"acceptance_criteria": "Stricter test"},
            "expected_version": changed["version"],
            "idempotency_key": "edit",
        },
    )
    assert patched.status_code == 200, patched.text
    assert dispatch(client, patched.json()["items"][0], idempotency_key="new-plan").status_code == 200
    assert len(client.get(BASE + "/runs").json()["items"]) == 2


def test_scope_permissions_validation_and_concurrency(delivery):
    client, task = delivery
    url = f"{BASE}/tasks/{task['id']}/delivery"
    assert client.get(url, headers={"Authorization": "Bearer other"}).status_code == 404
    assert client.get(url, headers={"Authorization": "Bearer reader"}).status_code == 200
    body = {"expected_version": 1, "idempotency_key": "denied", "nodes": [{"id": "x", "argv": ["echo"]}]}
    assert (
        client.post(
            f"{BASE}/tasks/{task['id']}/dispatch", json=body, headers={"Authorization": "Bearer writer"}
        ).status_code
        == 403
    )
    assert dispatch(client, task, nodes=[{"id": "review", "kind": "approval"}]).status_code == 422
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: dispatch(client, task, idempotency_key=uuid.uuid4().hex), range(2)))
    assert sorted(result.status_code for result in results) == [200, 409]
    assert len(client.get(BASE + "/runs").json()["items"]) == 1


def test_missing_acceptance_and_oversized_plan_leave_no_runs(delivery):
    client, task = delivery
    too_large = dispatch(client, task, nodes=[{"id": "x", "argv": ["echo", "x" * 1_048_576]}])
    assert too_large.status_code == 422
    patched = client.patch(
        f"{BASE}/tasks/{task['id']}",
        json={"data": {"acceptance_criteria": " "}, "expected_version": 1, "idempotency_key": "clear"},
    ).json()["items"][0]
    rejected = dispatch(client, patched)
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "acceptance_required"
    assert client.get(BASE + "/runs").json()["items"] == []
