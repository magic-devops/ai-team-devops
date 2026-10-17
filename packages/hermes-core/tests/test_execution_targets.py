"""Public policy/presence and pinned Agent-to-test execution boundaries."""

import json
import os
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hermes_core.api import create_app
from hermes_core.models import Principal
from sqlalchemy import MetaData, Table, inspect, select

BASE = "/api/hermes/v1"


@pytest.fixture
def runtime(tmp_path):
    app = create_app(tmp_path / "core", "owner", principals={
        "owner": Principal("owner"),
        "reader": Principal("reader", permissions=frozenset({"read"})),
        "other": Principal("other", tenant="other"),
    })
    client = TestClient(app, headers={"Authorization": "Bearer owner"})
    workspace = post(client, "/workspaces", {"data": {"name": "Remote", "root": str(tmp_path)},
                                              "idempotency_key": "workspace"})["items"][0]
    client.headers["X-Workspace-Id"] = workspace["id"]
    device = post(client, "/devices", {"data": {"title": "Worker"}, "idempotency_key": "device"})["items"][0]
    invite = post(client, f"/devices/{device['id']}/pairing", {
        "expected_version": device["version"], "idempotency_key": "invite", "dry_run": False})["items"][0]
    paired = post(client, "/devices/pair", {"device_id": device["id"], "secret": invite["pairing_secret"]})["items"][0]
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    yield client, app, workspace, paired, auth
    app.state.hermes_store.engine.dispose()


def post(client, path, body, headers=None):
    response = client.post(BASE + path, json=body, headers=headers)
    assert response.status_code in {200, 201}, response.text
    return response.json()


def presence_body(**updates):
    return {"idempotency_key": uuid.uuid4().hex, "worker_id": "worker-one", "worker_version": "test",
            "runtime_capabilities": ["command", "agent"],
            "providers": [{"id": "codex", "executable_present": True, "version": None, "auth": "unknown"}],
            **updates}


def policy(client, device, **updates):
    return post(client, f"/devices/{device['id']}/runtime-policy", {
        "expected_version": device["version"], "idempotency_key": uuid.uuid4().hex, "dry_run": False,
        "allowed_runtimes": ["command", "agent"], "allowed_providers": ["codex"], **updates})["items"][0]


def targets(runtime, **kwargs):
    from hermes_core.execution_targets import workspace_execution_targets

    _, app, workspace, _, _ = runtime
    return workspace_execution_targets(app.state.hermes_store, app.state.hermes_execution,
                                       Principal("owner"), workspace["id"], **kwargs)


def test_public_device_policy_requires_permission_cas_and_exact_replay(runtime):
    client, _, _, paired, _ = runtime
    body = {"expected_version": paired["version"], "idempotency_key": "policy", "dry_run": False,
            "allowed_runtimes": ["command", "agent"], "allowed_providers": ["codex"]}
    denied = client.post(BASE + f"/devices/{paired['id']}/runtime-policy", json=body,
                         headers={"Authorization": "Bearer reader"})
    assert denied.status_code == 403
    first = post(client, f"/devices/{paired['id']}/runtime-policy", body)
    assert post(client, f"/devices/{paired['id']}/runtime-policy", body)["items"] == first["items"]
    changed = first["items"][0]
    assert changed["version"] == paired["version"] + 1
    assert changed["data"]["allowed_providers"] == ["codex"]
    stale = client.post(BASE + f"/devices/{paired['id']}/runtime-policy",
                        json={**body, "idempotency_key": "stale"})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "version_conflict"


@pytest.mark.parametrize("updates", [
    {"allowed_runtimes": ["agent", "agent"]}, {"allowed_runtimes": [True]},
    {"allowed_providers": ["workbuddy"]}, {"allowed_providers": ["codex", "codex"]},
    {"allowed_runtimes": ["agent"], "allowed_providers": []},
])
def test_policy_rejects_ambiguous_or_unsupported_permissions(runtime, updates):
    client, _, _, paired, _ = runtime
    response = client.post(BASE + f"/devices/{paired['id']}/runtime-policy", json={
        "expected_version": paired["version"], "idempotency_key": "bad", "dry_run": False,
        "allowed_runtimes": ["command"], "allowed_providers": [], **updates})
    assert response.status_code == 422


def test_presence_is_device_authenticated_stable_and_reads_do_not_write(runtime):
    client, app, workspace, paired, auth = runtime
    denied = client.post(BASE + "/remote/presence", json=presence_body())
    assert denied.status_code == 401
    post(client, "/remote/presence", presence_body(), auth)
    device = policy(client, paired)
    initial = targets(runtime)["devices"][0]
    assert initial["paired"] is True and initial["online"] is True and initial["can_execute"] is True
    assert initial["providers"][0]["auth"] == "unknown"
    before = app.state.hermes_store.get(Principal("owner"), workspace["id"], "devices", device["id"])
    post(client, "/remote/presence", presence_body(), auth)
    refreshed = targets(runtime)["devices"][0]
    assert refreshed["basis"] == initial["basis"]
    assert app.state.hermes_store.get(Principal("owner"), workspace["id"], "devices", device["id"]) == before
    counts_before = database_rows(app.state.hermes_store)
    targets(runtime)
    assert database_rows(app.state.hermes_store) == counts_before
    expired = targets(runtime, now_seconds=10**12)["devices"][0]
    assert expired["online"] is False and expired["can_execute"] is False
    assert "worker_offline" in expired["reason_codes"]


def database_rows(store):
    result = {}
    with store.engine.connect() as conn:
        for name in inspect(store.engine).get_table_names():
            table = Table(name, MetaData(), autoload_with=conn)
            result[name] = conn.execute(select(table)).fetchall()
    return result


@pytest.mark.parametrize("updates", [{"providers": [{"id": "codex", "executable_present": 1}]},
                                       {"providers": [{"id": "codex", "executable_present": True, "auth": "connected"}]},
                                       {"workspace_id": "other"}, {"runtime_capabilities": ["agent", "agent"]}])
def test_presence_rejects_fake_auth_cross_scope_and_coerced_flags(runtime, updates):
    client, _, _, _, auth = runtime
    response = client.post(BASE + "/remote/presence", json=presence_body(**updates), headers=auth)
    assert response.status_code == 422


def test_repairing_device_invalidates_previous_presence_and_credentials(runtime):
    client, _, _, paired, auth = runtime
    post(client, "/remote/presence", presence_body(), auth)
    device = policy(client, paired)
    invite = post(client, f"/devices/{device['id']}/pairing", {
        "expected_version": device["version"], "idempotency_key": "repair", "dry_run": False})["items"][0]
    repaired = post(client, "/devices/pair", {"device_id": device["id"], "secret": invite["pairing_secret"]})["items"][0]
    assert targets(runtime)["devices"][0]["online"] is False
    assert client.post(BASE + "/remote/presence", json=presence_body(), headers=auth).status_code == 401
    new_auth = {**auth, "Authorization": "Bearer " + repaired["credential"]}
    post(client, "/remote/presence", presence_body(worker_id="worker-two"), new_auth)
    assert targets(runtime)["devices"][0]["online"] is True


def test_worker_replacement_cannot_receive_an_already_claimed_process(runtime):
    client, _, _, _, auth = runtime
    run, _ = dispatch_agent(runtime)
    first = claim(runtime, "first")
    post(client, "/remote/presence", presence_body(worker_id="replacement"), auth)
    response = client.post(BASE + "/remote/claim", json={"idempotency_key": "replacement-claim",
        "worker_id": "replacement", "runtime_capabilities": ["agent", "command"]}, headers=auth)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "target_basis_changed"
    assert first["run_id"] == run["id"]


def test_revoking_runtime_policy_stops_active_heartbeat(runtime):
    client, _, _, paired, auth = runtime
    run, _ = dispatch_agent(runtime)
    first = claim(runtime, "first")
    current = post(client, f"/devices/{paired['id']}/runtime-policy", {
        "expected_version": paired["version"] + 1, "idempotency_key": "disable", "dry_run": False,
        "allowed_runtimes": [], "allowed_providers": []})["items"][0]
    response = client.post(BASE + "/remote/heartbeat", json={"run_id": run["id"], "owner": first["owner"],
        "idempotency_key": "heartbeat"}, headers=auth)
    assert response.status_code == 409
    assert current["data"]["allowed_runtimes"] == []


def test_restoring_worker_identity_does_not_revive_old_target(runtime):
    from hermes_core.execution_targets import select_execution_target
    from hermes_core.models import CoreError

    client, app, workspace, paired, auth = runtime
    policy(client, paired)
    post(client, "/remote/presence", presence_body(), auth)
    original = targets(runtime)["devices"][0]
    post(client, "/remote/presence", presence_body(worker_id="replacement"), auth)
    post(client, "/remote/presence", presence_body(), auth)
    with pytest.raises(CoreError, match="changed"):
        select_execution_target(app.state.hermes_store, app.state.hermes_execution, Principal("owner"), workspace["id"],
                                target_kind="device", target_device_id=paired["id"], expected_basis=original["basis"])


def test_policy_preview_has_zero_database_writes(runtime):
    client, app, _, paired, _ = runtime
    before = database_rows(app.state.hermes_store)
    post(client, f"/devices/{paired['id']}/runtime-policy", {
        "expected_version": paired["version"], "idempotency_key": "preview", "dry_run": True,
        "allowed_runtimes": ["command", "agent"], "allowed_providers": ["codex"]})
    assert database_rows(app.state.hermes_store) == before


def test_changed_agent_profile_cannot_be_claimed_after_public_start(runtime):
    client, _, _, _, auth = runtime
    _, agent = dispatch_agent(runtime)
    response = client.patch(BASE + f"/agents/{agent['id']}", json={
        "expected_version": agent["version"], "idempotency_key": "change-agent",
        "data": {"instructions": "Different instructions"}})
    assert response.status_code == 200
    claim_response = client.post(BASE + "/remote/claim", json={"idempotency_key": "changed-agent-claim",
        "worker_id": "worker-one", "runtime_capabilities": ["agent", "command"]}, headers=auth)
    assert claim_response.status_code == 409
    assert claim_response.json()["error"]["code"] == "configuration_changed"


def test_worker_honors_explicit_nonzero_expected_exit_from_real_agentd(tmp_path):
    from hermes_core.remote_worker import _run_agentd_command

    default = Path(__file__).resolve().parents[3] / ".sop-runtime" / "delivery-agentd.exe"
    binary = Path(os.environ.get("HERMES_TEST_AGENTD", str(default)))
    if not binary.is_file():
        pytest.skip("A native sop-agentd binary is required for process exit evidence")
    result = _run_agentd_command(str(binary), tmp_path, {}, {
        "kind": "command", "argv": [sys.executable, "-c", "import sys; print('expected failure'); sys.exit(3)"],
        "expected_exit_code": 3, "timeout_seconds": 10}, "http://127.0.0.1:1", {})
    assert result["exit_code"] == 3 and result["ok"] is True


@pytest.mark.parametrize("provider,event", [
    ("codex", {"type": "turn.completed"}),
    ("claude", {"type": "result", "subtype": "success"}),
    ("opencode", {"type": "step_finish", "part": {"reason": "stop"}}),
])
def test_terminal_success_without_usage_keeps_usage_unknown(provider, event):
    from hermes_core.agents import provider_evidence

    evidence = provider_evidence(provider, json.dumps(event))
    assert evidence["completed"] is True and evidence["usage"] is None


def public_command_run(runtime):
    client, _, _, paired, auth = runtime
    post(client, "/remote/presence", presence_body(), auth)
    target = targets(runtime)["devices"][0]
    return post(client, "/runs", {"idempotency_key": "command-run", "data": {
        "title": "Remote test", "target_device_id": paired["id"], "target_basis": target["basis"],
        "nodes": [{"id": "regression", "argv": ["python", "-m", "unittest"]}]}})["items"][0]


def test_generic_run_patch_cannot_clear_device_and_fall_back_to_local(runtime):
    client, _, _, _, _ = runtime
    run = public_command_run(runtime)
    response = client.patch(BASE + f"/runs/{run['id']}", json={
        "expected_version": run["version"], "idempotency_key": "clear-device", "data": {"target_device_id": ""}})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "immutable_target"


def test_public_replay_retains_reviewed_target_and_cannot_evade_worker_change(runtime):
    client, _, _, _, auth = runtime
    run = public_command_run(runtime)
    replay = post(client, f"/runs/{run['id']}/replay", {
        "expected_version": run["version"], "idempotency_key": "replay", "dry_run": False})["items"][0]
    assert replay["data"].get("target_snapshot", {}).get("basis") == run["data"]["target_snapshot"]["basis"]
    post(client, "/remote/presence", presence_body(worker_id="other-worker"), auth)
    response = client.post(BASE + f"/runs/{replay['id']}/start", json={
        "expected_version": replay["version"], "idempotency_key": "start-replay", "dry_run": False})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "target_basis_changed"


def dispatch_agent(runtime):
    client, _, _, paired, auth = runtime
    policy(client, paired)
    post(client, "/remote/presence", presence_body(), auth)
    target = targets(runtime)["devices"][0]
    agent = post(client, "/agents", {"data": {"title": "Coder", "provider": "codex"},
                                        "idempotency_key": "agent"})["items"][0]
    task = post(client, "/tasks", {"data": {"title": "Build", "acceptance_criteria": "Real test passes"},
                                       "idempotency_key": "task"})["items"][0]
    result = post(client, f"/tasks/{task['id']}/agent-dispatch", {
        "expected_version": task["version"], "idempotency_key": "dispatch", "dry_run": False,
        "agent_id": agent["id"], "target_version": agent["version"],
        "target_device_id": paired["id"], "target_basis": target["basis"],
        "test_nodes": [{"id": "regression", "argv": ["python", "-m", "unittest"]}]})["items"][0]
    run = result["run"]
    post(client, f"/runs/{run['id']}/start", {
        "expected_version": run["version"], "idempotency_key": "start", "dry_run": False})
    return run, agent


def claim(runtime, key):
    client, _, _, _, auth = runtime
    return post(client, "/remote/claim", {"idempotency_key": key, "worker_id": "worker-one",
                                          "runtime_capabilities": ["command", "agent"]}, auth)["items"][0]


def test_agent_terminal_then_real_command_test_remain_one_run_and_await_review(runtime):
    client, app, workspace, _, auth = runtime
    run, agent = dispatch_agent(runtime)
    first = claim(runtime, "claim-one")
    assert first["node"]["id"] == "agent_1"
    events = [{"type": "turn.completed", "usage": {"input_tokens": 1, "output_tokens": 2}}]
    post(client, "/remote/result", {"run_id": run["id"], "node_id": "agent_1", "owner": first["owner"],
                                   "idempotency_key": "agent-result", "result": {
        "ok": True, "exit_code": 0, "stdout": "\n".join(map(json.dumps, events)),
        "agent": {"provider": "codex", "completed": True, "agent_id": agent["id"],
                  "profile_version": agent["version"], "events": events}}}, auth)
    second = claim(runtime, "claim-two")
    assert second["run_id"] == first["run_id"] and second["node"]["id"] == "regression"
    saved = post(client, "/remote/result", {"run_id": run["id"], "node_id": "regression", "owner": second["owner"],
                                            "idempotency_key": "test-result", "result": {
                                                "ok": True, "exit_code": 0, "stdout": "OK"}}, auth)["items"][0]
    assert saved["status"] == "completed"
    task = app.state.hermes_store.get(Principal("owner"), workspace["id"], "tasks", run["data"]["task_source"]["task_id"])
    assert task["status"] == "in_progress"


@pytest.mark.parametrize("change", ["missing", "provider", "agent_id", "version", "terminal", "completed"])
def test_unbound_agent_success_cannot_release_tests(runtime, change):
    client, app, workspace, _, auth = runtime
    run, agent = dispatch_agent(runtime)
    first = claim(runtime, "claim-one")
    events = [{"type": "turn.completed"}]
    evidence = {"provider": "codex", "completed": True, "agent_id": agent["id"],
                "profile_version": agent["version"], "events": events}
    if change == "provider":
        evidence["provider"] = "claude"
    elif change == "agent_id":
        evidence["agent_id"] = "different"
    elif change == "version":
        evidence["profile_version"] = 2
    elif change == "terminal":
        evidence["events"] = []
    elif change == "completed":
        evidence["completed"] = False
    result = {"ok": True, "exit_code": 0, "agent": evidence}
    if change == "missing":
        result.pop("agent")
    response = client.post(BASE + "/remote/result", json={
        "run_id": run["id"], "node_id": "agent_1", "owner": first["owner"],
        "idempotency_key": "forged", "result": result}, headers=auth)
    assert response.status_code == 422
    persisted = app.state.hermes_store.get(Principal("owner"), workspace["id"], "runs", run["id"])
    assert persisted["status"] == "running" and not persisted["data"].get("node_results")


@pytest.mark.parametrize("malformed", [
    {"type": "item.completed", "item": ["invalid"]},
    {"type": "text", "part": ["invalid"]},
    {"type": "turn.completed", "usage": ["invalid"]},
    {"type": ["turn.completed"]},
])
def test_malformed_nested_provider_events_return_422_without_releasing_tests(runtime, malformed):
    client, app, workspace, _, auth = runtime
    run, agent = dispatch_agent(runtime)
    first = claim(runtime, "claim-one")
    network = TestClient(app, headers=client.headers, raise_server_exceptions=False)
    response = network.post(BASE + "/remote/result", headers=auth, json={
        "run_id": run["id"], "node_id": "agent_1", "owner": first["owner"], "idempotency_key": "malformed",
        "result": {"ok": True, "exit_code": 0, "agent": {
            "provider": "codex", "completed": True, "agent_id": agent["id"], "profile_version": agent["version"],
            "events": [malformed, {"type": "turn.completed"}]}}})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_agent_evidence"
    persisted = app.state.hermes_store.get(Principal("owner"), workspace["id"], "runs", run["id"])
    assert persisted["status"] == "running" and not persisted["data"].get("node_results")


@pytest.mark.parametrize("test_nodes", [[{"id": "agent_2", "argv": ["pytest"]}],
                                      [{"id": "same", "argv": ["pytest"]}] * 2,
                                      [{"id": "approval", "kind": "approval"}],
                                      [{"id": "empty", "argv": []}],
                                      [{"id": "bool_timeout", "argv": ["pytest"], "timeout_seconds": True}],
                                      [{"id": "bool_exit", "argv": ["pytest"], "expected_exit_code": True}]])
def test_agent_post_tests_reject_reserved_duplicate_or_non_command_nodes(runtime, test_nodes):
    from hermes_core.agents import AgentDispatch
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        AgentDispatch(expected_version=1, target_version=1, agent_id="agent", idempotency_key="bad",
                      test_nodes=test_nodes)
