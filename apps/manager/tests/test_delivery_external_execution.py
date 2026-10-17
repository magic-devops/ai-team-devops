"""External delivery contracts exercised through real Manager SQL and runtime stores."""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally injected by name.

import json

import pytest
from hermes_core.agents import AgentProfile
from hermes_core.transactional import digest
from sop_manager.routers.sql_models import Base, DeliveryWorkspace, Task
from sqlalchemy import MetaData, select
from test_delivery_execution import bridge, finish, sync  # noqa: F401
from test_delivery_workbench import command, env  # noqa: F401


def proposal(bridge):
    client, _, _, _, ws, _, task = bridge
    state = client.get("/api/v1/delivery/workspace").json()
    current = next(row for row in state["tasks"] if row["id"] == task["id"])
    targets = client.get("/api/v1/delivery/execution-targets").json()
    workspace = next(row for row in targets["workspaces"] if row["id"] == ws["id"])
    return {
        "task_id": task["id"],
        "task_basis": current["basis"],
        "workspace_id": ws["id"],
        "target_kind": "local",
        "target_basis": workspace["local"]["basis"],
        "nodes": [{"id": "tests", "argv": ["python", "-m", "pytest"]}],
        "test_node_ids": ["tests"],
    }


def all_counts(bridge):
    _, sessions, store, _, _, _, _ = bridge
    with sessions() as db:
        manager = {
            table.name: digest(
                json.loads(
                    json.dumps([dict(row) for row in db.execute(select(table)).mappings()], default=str)
                )
            )
            for table in Base.metadata.sorted_tables
        }
    with store.engine.connect() as conn:
        metadata = MetaData()
        metadata.reflect(bind=conn)
        runtime = {
            table.name: digest([dict(row) for row in conn.execute(select(table)).mappings()])
            for table in metadata.sorted_tables
        }
    return manager, runtime


def test_targets_expose_health_without_claiming_provider_login(bridge):
    response = bridge[0].get("/api/v1/delivery/execution-targets")
    assert response.status_code == 200
    result = response.json()
    assert result["runtime_configured"] is True
    assert result["as_of"]
    local = result["workspaces"][0]["local"]
    assert local["kind"] == "local"
    assert local["paired"] is None and local["online"] is None
    assert len(local["basis"]) == 64
    assert all(row["auth"] == "unknown" for row in local["providers"])


@pytest.mark.parametrize(
    "runtime_permissions,expected",
    [({"read", "execute"}, False), ({"read", "config"}, False), ({"read", "execute", "config"}, True)],
)
def test_policy_configuration_visibility_requires_exact_runtime_permissions(
    bridge, monkeypatch, runtime_permissions, expected
):
    from dataclasses import replace

    from sop_manager.routers import delivery_execution

    original = delivery_execution.runtime_identity
    monkeypatch.setattr(
        delivery_execution,
        "runtime_identity",
        lambda user, store: replace(original(user, store), permissions=frozenset(runtime_permissions)),
    )
    response = bridge[0].get("/api/v1/delivery/execution-targets")
    assert response.status_code == 200, response.text
    assert response.json()["can_configure_policy"] is expected


def test_old_queue_without_explicit_task_and_target_basis_is_rejected(bridge):
    client, _, _, _, ws, _, task = bridge
    response = command(
        client,
        "execution.queue",
        {
            "task_id": task["id"],
            "workspace_id": ws["id"],
            "nodes": [{"id": "test", "argv": ["python", "-m", "pytest"]}],
        },
    )
    assert response.status_code == 422


def test_preview_returns_frozen_plan_without_manager_or_runtime_writes(bridge):
    client, _, _, _, _, _, _ = bridge
    body = proposal(bridge)
    before = all_counts(bridge)
    response = client.post("/api/v1/delivery/execution-preview", json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["task_basis"] == body["task_basis"]
    assert result["target"]["basis"] == body["target_basis"]
    assert result["nodes"][0]["id"] == "tests"
    assert result["test_node_ids"] == ["tests"]
    assert result["snapshot"]["acceptance_criteria"] == ["Find a requirement by title"]
    assert all_counts(bridge) == before


@pytest.mark.parametrize(
    "edit",
    [
        {"target_kind": "device"},
        {"target_device_id": "an-implicit-device"},
        {"test_nodes": [{"id": "test", "argv": ["python"]}]},
        {"test_node_ids": ["tests", "tests"]},
        {"nodes": [{"id": "tests", "argv": ["python"], "surprise": True}]},
    ],
)
def test_invalid_explicit_plan_never_creates_intent(bridge, edit):
    client = bridge[0]
    body = {**proposal(bridge), **edit}
    before = all_counts(bridge)
    assert client.post("/api/v1/delivery/execution-preview", json=body).status_code == 422
    assert command(client, "execution.queue", body).status_code == 422
    assert all_counts(bridge) == before


@pytest.mark.parametrize("change", ["task", "target"])
def test_queue_and_preview_reject_changed_basis_without_external_effects(bridge, change):
    client, sessions, store, principal, ws, _, task = bridge
    body = proposal(bridge)
    if change == "task":
        with sessions() as db:
            db.get(Task, task["id"]).description = "Additional required work"
            db.commit()
    else:
        store.mutate(
            principal,
            "",
            "workspaces",
            ws["id"],
            operation="test.workspace",
            key="changed",
            request={},
            trace="test",
            expected=ws["version"],
            transform=lambda item: {"data": {**item["data"], "name": "Changed workspace"}},
        )
    before = all_counts(bridge)
    for response in (
        client.post("/api/v1/delivery/execution-preview", json=body),
        command(client, "execution.queue", body),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["detail"]["code"] == (
            "task_basis_changed" if change == "task" else "target_basis_changed"
        )
    assert all_counts(bridge) == before


def agent_proposal(bridge):
    _, _, store, principal, ws, _, _ = bridge
    agent = store.create(
        principal,
        ws["id"],
        "agents",
        AgentProfile(title="Coding", provider="codex").model_dump(),
        "agent",
        "test",
    )
    body = {key: value for key, value in proposal(bridge).items() if key not in {"nodes", "test_node_ids"}}
    return {
        **body,
        "agent_id": agent["id"],
        "agent_version": agent["version"],
        "test_nodes": [{"id": "pytest", "title": "Regression tests", "argv": ["python", "-m", "pytest"]}],
    }


@pytest.mark.parametrize(
    "extra", [{"test_node_ids": ["pytest"]}, {"test_nodes": [{"id": "agent_2", "argv": ["python"]}]}]
)
def test_agent_tests_have_one_server_derived_identity(bridge, extra):
    body = {**agent_proposal(bridge), **extra}
    before = all_counts(bridge)
    assert command(bridge[0], "execution.queue", body).status_code == 422
    assert all_counts(bridge) == before


def test_agent_post_tests_share_frozen_plan_and_only_review_creates_test_artifact(bridge):
    client, _, store, principal, ws, _, task = bridge
    body = agent_proposal(bridge)
    preview = client.post("/api/v1/delivery/execution-preview", json=body)
    assert preview.status_code == 200, preview.text
    plan = preview.json()
    assert [n["id"] for n in plan["nodes"]] == ["agent_1", "pytest"]
    assert plan["test_node_ids"] == ["pytest"]
    response = command(client, "execution.queue", body)
    assert response.status_code == 200, response.text
    entry = sync(bridge, response.json()["executions"][-1])
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    assert run["data"]["nodes"] == plan["nodes"]
    assert entry["test_node_ids"] == ["pytest"]
    assert entry["target_snapshot"]["basis"] == body["target_basis"]
    store.mutate(
        principal,
        ws["id"],
        "runs",
        run["id"],
        operation="test.result",
        key="result",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda item: {
            "status": "completed",
            "data": {
                **item["data"],
                "attempt": 2,
                "node_results": {
                    "agent_1": {
                        "succeeded": True,
                        "exit_code": 0,
                        "duration_ms": 15,
                        "attempt": 2,
                        "agent": {
                            "provider": "codex",
                            "completed": True,
                            "agent_id": body["agent_id"],
                            "profile_version": body["agent_version"],
                            "usage": {"input_tokens": 12, "output_tokens": 7},
                            "message": "Implemented",
                            "events": [{"type": "turn.completed"}],
                        },
                    },
                    "pytest": {
                        "succeeded": True,
                        "exit_code": 0,
                        "expected_exit_code": 0,
                        "stdout": "3 passed",
                        "duration_ms": 23,
                        "attempt": 2,
                    },
                },
            },
        },
    )
    entry = sync(bridge, entry)
    assert entry["status"] == "awaiting_review"
    state = client.get("/api/v1/delivery/workspace").json()
    assert state["summary"]["tasks_done"] == 0
    assert not state["requirements"][0]["flow"]["artifacts"]
    assert entry["results"]["agent_1"]["agent"]["usage"] == {"input_tokens": 12, "output_tokens": 7}
    assert entry["results"]["pytest"]["attempt"] == 2
    response = command(
        client,
        "execution.review",
        {
            "id": entry["id"],
            "decision": "accept",
            "comment": "Reviewed Agent and independent tests",
            "run_version": entry["run_version"],
        },
    )
    assert response.status_code == 200, response.text
    report = response.json()["requirements"][0]["flow"]["artifacts"][-1]
    assert report["source"] == "execution-runtime" and report["task_id"] == task["id"]
    assert "pytest" in report["content"] and "agent_1" not in report["content"]


def test_observations_page_existing_events_and_never_write_or_invent_streaming(bridge):
    client, _, store, principal, ws, _, _ = bridge
    response = command(client, "execution.queue", proposal(bridge))
    entry = sync(bridge, response.json()["executions"][-1])
    finish(bridge, entry)
    before = all_counts(bridge)
    url = f"/api/v1/delivery/executions/{entry['id']}/observations"
    first = client.get(url, params={"limit": 1})
    assert first.status_code == 200, first.text
    page = first.json()
    assert page["more"] is True and page["next_cursor"]
    assert page["status"] == "awaiting_review" and page["tests"]["status"] == "passed"
    assert page["log_streaming"] is False
    assert page["nodes"][0]["result"]["output_source"] == "completed_node_result"
    second = client.get(url, params={"limit": 100, "cursor": page["next_cursor"]}).json()
    expected = store.stream(principal, ws["id"], entity_id=entry["run_id"])
    assert [event["seq"] for event in page["events"] + second["events"]] == [row["seq"] for row in expected]
    assert second["next_cursor"] and not second["more"]
    repeated = client.get(url, params={"cursor": second["next_cursor"]}).json()
    assert not repeated["events"]
    assert all_counts(bridge) == before


def test_observations_require_current_project_workspace_and_bound_cursor(bridge):
    client, sessions, _, _, ws, _, _ = bridge
    response = command(client, "execution.queue", proposal(bridge))
    entry = sync(bridge, response.json()["executions"][-1])
    url = f"/api/v1/delivery/executions/{entry['id']}/observations"
    assert client.get(url, headers={"X-Project-Id": "other"}).status_code == 404
    assert client.get(url, params={"cursor": "not-valid-base64"}).status_code == 422
    assert client.get(url, params={"limit": 0}).status_code == 422
    assert client.get(url, params={"limit": 101}).status_code == 422
    from sop_manager.routers.auth_sql import current_user
    from sop_manager.routers.sql_models import User

    with sessions() as db:
        actor = db.get(User, "reader")
    client.app.dependency_overrides[current_user] = lambda: actor
    assert client.get(url).status_code == 403
    with sessions() as db:
        row = db.get(DeliveryWorkspace, "project")
        assert row.data["executions"][0]["workspace_id"] == ws["id"]


def test_valid_preview_opens_no_audit_writer_but_mutations_still_do(bridge, monkeypatch):
    from sop_manager.routers import audit
    from starlette.middleware.base import BaseHTTPMiddleware

    client, sessions, _, _, _, _, _ = bridge
    body = proposal(bridge)
    opened = []

    def audit_session():
        opened.append(True)
        with sessions() as db:
            yield db

    monkeypatch.setattr(audit, "get_session", audit_session)
    monkeypatch.setattr(audit, "_write_audit", lambda *args: None)
    client.app.middleware_stack = BaseHTTPMiddleware(
        client.app.middleware_stack, dispatch=audit.audit_middleware
    )
    before = all_counts(bridge)
    assert client.post("/api/v1/delivery/execution-preview", json=body).status_code == 200
    assert not opened and all_counts(bridge) == before
    assert command(client, "project.update", {"goal": "Audited mutation"}).status_code == 200
    assert len(opened) == 1
    assert client.post("/api/v1/delivery/execution-preview/extra", json=body).status_code == 404
    assert len(opened) == 2


def test_missing_node_exit_evidence_is_unknown_and_cannot_pass_testing(bridge):
    client, _, store, principal, ws, _, _ = bridge
    entry = sync(bridge, command(client, "execution.queue", proposal(bridge)).json()["executions"][-1])
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    store.mutate(
        principal,
        ws["id"],
        "runs",
        run["id"],
        operation="test.incomplete",
        key="unknown",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda item: {
            "status": "completed",
            "data": {**item["data"], "node_results": {"tests": {"stdout": "No recorded exit evidence"}}},
        },
    )
    read = client.get(f"/api/v1/delivery/executions/{entry['id']}/observations").json()
    assert read["nodes"][0]["result"]["exit_code"] is None
    assert read["nodes"][0]["status"] == "pending"
    assert read["tests"]["status"] == "pending"


def test_retry_shows_current_attempt_and_retains_original_node_event_evidence(bridge):
    client, _, store, principal, ws, _, _ = bridge
    entry = sync(bridge, command(client, "execution.queue", proposal(bridge)).json()["executions"][-1])
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    result = {
        "succeeded": False,
        "exit_code": 1,
        "attempt": 1,
        "duration_ms": 11,
        "stdout": "Regression failed",
    }
    run = store.mutate(
        principal,
        ws["id"],
        "runs",
        run["id"],
        operation="node.evidence",
        key="failed",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda item: {
            "status": "failed",
            "data": {**item["data"], "node_results": {"tests": result}},
        },
        audit_data={"node_id": "tests", "attempt": 1, "result": result},
    )
    store.mutate(
        principal,
        ws["id"],
        "runs",
        run["id"],
        operation="run.retry",
        key="retry",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda item: {"status": "retrying", "data": {**item["data"], "attempt": 2}},
    )
    response = client.get(f"/api/v1/delivery/executions/{entry['id']}/observations")
    assert response.status_code == 200, response.text
    read = response.json()
    assert read["attempt"] == 2
    assert read["nodes"][0]["status"] == "pending"
    assert read["nodes"][0]["result"]["attempt"] == 1
    assert read["tests"]["status"] == "pending"
    event = next(event for event in read["events"] if event["type"] == "node.evidence")
    assert event["node_id"] == "tests" and event["attempt"] == 1
    assert event["result"]["stdout"] == result["stdout"]


def test_observation_cursor_cannot_be_reused_for_a_different_execution(bridge):
    client, _, _, _, _, rid, task = bridge
    first = sync(bridge, command(client, "execution.queue", proposal(bridge)).json()["executions"][-1])
    cursor = client.get(f"/api/v1/delivery/executions/{first['id']}/observations").json()["next_cursor"]
    state = command(
        client,
        "task.create",
        {
            "requirement_id": rid,
            "title": "Another delivery",
            "owner_id": "user:lead",
            "requirement_criteria_indices": [0],
        },
    ).json()
    second_task = next(row for row in state["tasks"] if row["id"] != task["id"])
    second_bridge = (*bridge[:-1], second_task)
    second = sync(
        second_bridge, command(client, "execution.queue", proposal(second_bridge)).json()["executions"][-1]
    )
    before = all_counts(bridge)
    response = client.get(
        f"/api/v1/delivery/executions/{second['id']}/observations", params={"cursor": cursor}
    )
    assert response.status_code == 422
    assert all_counts(bridge) == before


def test_deleted_task_keeps_original_execution_history_readable_and_stale(bridge):
    client, sessions, _, _, _, _, task = bridge
    entry = sync(bridge, command(client, "execution.queue", proposal(bridge)).json()["executions"][-1])
    with sessions() as db:
        db.delete(db.get(Task, task["id"]))
        db.commit()
    before = all_counts(bridge)
    response = client.get(f"/api/v1/delivery/executions/{entry['id']}/observations")
    assert response.status_code == 200, response.text
    read = response.json()
    assert read["stale"] is True and read["events"] and read["run_id"] == entry["run_id"]
    assert read["permissions"] == {
        "can_start": False, "can_cancel": True, "can_review": False, "can_sync": False,
    }
    assert all_counts(bridge) == before


def remote_device(bridge):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hermes_core.api import create_router, install_errors

    client, _, store, principal, ws, _, _ = bridge
    app = FastAPI()
    install_errors(app)
    app.include_router(create_router(store, client.app.state.hermes_execution, lambda: principal))
    runtime = TestClient(app, headers={"X-Workspace-Id": ws["id"]})

    def post(path, body, headers=None):
        response = runtime.post("/api/hermes/v1" + path, json=body, headers=headers or {})
        assert response.status_code in {200, 201}, response.text
        return response.json()["items"][0]

    device = post("/devices", {"data": {"title": "External worker"}, "idempotency_key": "device"})
    device = post(
        f"/devices/{device['id']}/runtime-policy",
        {
            "expected_version": device["version"],
            "idempotency_key": "policy",
            "dry_run": False,
            "allowed_runtimes": ["command", "agent"],
            "allowed_providers": ["codex"],
        },
    )
    invitation = post(
        f"/devices/{device['id']}/pairing",
        {
            "expected_version": device["version"],
            "idempotency_key": "pair",
            "dry_run": False,
        },
    )
    credential = post("/devices/pair", {"device_id": device["id"], "secret": invitation["pairing_secret"]})
    headers = {"X-Hermes-Device-Id": device["id"], "Authorization": "Bearer " + credential["credential"]}
    presence = {
        "idempotency_key": "presence-1",
        "worker_id": "worker-1",
        "worker_version": "test-1",
        "runtime_capabilities": ["command", "agent"],
        "providers": [{"id": "codex", "executable_present": True, "auth": "unknown"}],
    }
    post("/remote/presence", presence, headers)
    return runtime, device["id"], presence, headers


def device_proposal(bridge, device_id):
    client, _, _, _, ws, _, _ = bridge
    body = proposal(bridge)
    target = next(
        workspace
        for workspace in client.get("/api/v1/delivery/execution-targets").json()["workspaces"]
        if workspace["id"] == ws["id"]
    )
    target = next(device for device in target["devices"] if device["id"] == device_id)
    return {**body, "target_kind": "device", "target_device_id": device_id, "target_basis": target["basis"]}


def test_public_device_presence_renewal_preserves_basis_and_preview_is_pure(bridge):
    runtime, device_id, presence, headers = remote_device(bridge)
    client = bridge[0]
    body = device_proposal(bridge, device_id)
    response = runtime.post(
        "/api/hermes/v1/remote/presence", json={**presence, "idempotency_key": "renew"}, headers=headers
    )
    assert response.status_code == 200, response.text
    assert device_proposal(bridge, device_id)["target_basis"] == body["target_basis"]
    before = all_counts(bridge)
    response = client.post("/api/v1/delivery/execution-preview", json=body)
    assert response.status_code == 200, response.text
    target = response.json()["target"]
    assert (
        target["online"] is True and target["paired"] is True and target["worker_id"] == presence["worker_id"]
    )
    assert target["providers"][0]["auth"] == "unknown"
    assert all_counts(bridge) == before


@pytest.mark.parametrize("change", ["offline", "worker", "revoke"])
def test_pending_intent_rechecks_real_device_before_cross_store_dispatch(bridge, monkeypatch, change):
    from hermes_core import execution_targets

    runtime, device_id, presence, headers = remote_device(bridge)
    client, _, store, principal, ws, _, _ = bridge
    body = device_proposal(bridge, device_id)
    response = command(client, "execution.queue", body)
    assert response.status_code == 200, response.text
    entry = response.json()["executions"][-1]
    if change == "offline":
        now = execution_targets.time.time()
        monkeypatch.setattr(execution_targets.time, "time", lambda: now + 121)
    elif change == "worker":
        response = runtime.post(
            "/api/hermes/v1/remote/presence",
            json={**presence, "worker_id": "replacement", "idempotency_key": "replacement"},
            headers=headers,
        )
        assert response.status_code == 200, response.text
    else:
        device = store.get(principal, ws["id"], "devices", device_id)
        response = runtime.post(
            f"/api/hermes/v1/devices/{device_id}/revoke",
            json={"expected_version": device["version"], "idempotency_key": "revoke", "dry_run": False},
        )
        assert response.status_code == 200, response.text
    before = all_counts(bridge)
    response = command(client, "execution.sync", {"id": entry["id"]})
    assert response.status_code == 409, response.text
    assert not store.list(principal, ws["id"], "runs")
    assert all_counts(bridge) == before
