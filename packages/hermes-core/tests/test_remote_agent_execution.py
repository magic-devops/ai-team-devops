from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from hermes_core.agents import AgentProfile
from hermes_core.api import create_router, install_errors
from hermes_core.execution import Execution
from hermes_core.models import CoreError, Node, Principal
from hermes_core.remote import create_remote_router
from hermes_core.remote_worker import _execute_task
from hermes_core.transactional import Store, digest
from process_fixtures import install_python_script_launcher


@pytest.fixture(autouse=True)
def python_protocol_fixture_launcher(monkeypatch):
    install_python_script_launcher(monkeypatch)


def _client(tmp_path: Path) -> tuple[TestClient, Store]:
    store = Store("sqlite:///" + str((tmp_path / "workspace.sqlite").resolve()))
    execution = Execution(store, tmp_path)
    app = FastAPI()
    app.state.hermes_store = store
    app.state.hermes_execution = execution
    install_errors(app)

    def identity(request: Request):
        if request.headers.get("Authorization") == "Bearer owner-token":
            return Principal("owner")
        raise CoreError("unauthorized", "Workspace token is invalid", 401)

    app.include_router(create_remote_router(store, identity))
    app.include_router(create_router(store, execution, identity))
    return TestClient(app), store


def _post(client: TestClient, path: str, body: dict, headers: dict | None = None) -> dict:
    response = client.post(path, json=body, headers=headers or {})
    assert response.status_code in {200, 201}, response.text
    return response.json()


def _pair_device(client: TestClient, workspace_id: str) -> tuple[dict, dict]:
    headers = {"Authorization": "Bearer owner-token", "X-Workspace-Id": workspace_id}
    device = _post(client, "/api/hermes/v1/devices", {
        "data": {"title": "Agent worker"},
        "idempotency_key": "device",
    }, headers)["items"][0]
    pairing = _post(client, f"/api/hermes/v1/devices/{device['id']}/pairing", {
        "expected_version": device["version"],
        "idempotency_key": "pairing",
        "dry_run": False,
    }, headers)["items"][0]
    paired = _post(client, "/api/hermes/v1/devices/pair", {
        "device_id": device["id"],
        "secret": pairing["pairing_secret"],
    })["items"][0]
    return device, paired


def _allow_device_runtime(store: Store, workspace_id: str, device_id: str, runtimes: list[str]) -> dict:
    current = store.get(Principal("owner"), workspace_id, "devices", device_id)
    return store.mutate(Principal("owner"), workspace_id, "devices", device_id,
                        operation="test.device-runtimes", key="device-runtimes",
                        request={"allowed_runtimes": runtimes}, trace="test", expected=current["version"],
                        transform=lambda item: {"data": {**item["data"], "allowed_runtimes": runtimes}})


def _queue_agent_run(store: Store, workspace: dict, device_id: str, *, key: str = "agent-run") -> tuple[dict, dict]:
    profile = AgentProfile(title="Remote Codex", provider="codex", instructions="Be concise.",
                           timeout_seconds=30).model_dump()
    agent = store.create(Principal("owner"), workspace["id"], "agents", profile, key + ":agent", "test")
    node = Node(id="agent_1", kind="agent", agent_id=agent["id"], prompt="Say remote agent done.",
                timeout_seconds=30).model_dump()
    binding = {"agent_id": agent["id"], "version": agent["version"], "profile": profile, "sha256": digest(profile)}
    run = store.create(Principal("owner"), workspace["id"], "runs", {
        "title": "Remote agent run",
        "nodes": [node],
        "target_device_id": device_id,
        "workspace_version": workspace["version"],
        "agent_bindings": {"agent_1": binding},
        "agent_source": {"resource": "agents", "id": agent["id"], "version": agent["version"]},
    }, key, "test", status="queued")
    return run, agent


def _auth(paired: dict, device_id: str) -> dict:
    return {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device_id}


def test_remote_claim_filters_agent_by_worker_and_device_capabilities(tmp_path: Path):
    client, store = _client(tmp_path)
    workspace = _post(client, "/api/hermes/v1/workspaces", {
        "data": {"name": "Remote Agent", "root": str(tmp_path)},
        "idempotency_key": "workspace",
    }, {"Authorization": "Bearer owner-token"})["items"][0]
    device, paired = _pair_device(client, workspace["id"])
    run, _agent = _queue_agent_run(store, workspace, device["id"])
    auth = _auth(paired, device["id"])

    no_worker_agent = _post(client, "/api/hermes/v1/remote/claim", {
        "idempotency_key": "claim-command-only",
        "worker_version": "test",
        "runtime_capabilities": ["command"],
    }, auth)
    assert no_worker_agent["items"] == []
    assert store.get(Principal("owner"), workspace["id"], "runs", run["id"])["status"] == "queued"

    no_device_agent = _post(client, "/api/hermes/v1/remote/claim", {
        "idempotency_key": "claim-device-command-only",
        "worker_version": "test",
        "runtime_capabilities": ["agent"],
    }, auth)
    assert no_device_agent["items"] == []
    assert store.get(Principal("owner"), workspace["id"], "runs", run["id"])["status"] == "queued"

    _allow_device_runtime(store, workspace["id"], device["id"], ["agent"])
    claim = _post(client, "/api/hermes/v1/remote/claim", {
        "idempotency_key": "claim-agent",
        "worker_version": "test",
        "runtime_capabilities": ["agent"],
    }, auth)["items"][0]
    assert claim["run_id"] == run["id"]
    assert claim["node"]["kind"] == "agent"
    assert claim["agent_binding"]["profile"]["provider"] == "codex"
    assert "agent" in claim["boundary"]["supports"]
    assert paired["credential"] not in json.dumps(claim)


def test_public_agent_dispatch_accepts_remote_single_agent_with_allowed_device(tmp_path: Path):
    client, store = _client(tmp_path)
    workspace = _post(client, "/api/hermes/v1/workspaces", {
        "data": {"name": "Remote Agent Dispatch", "root": str(tmp_path)},
        "idempotency_key": "workspace-dispatch",
    }, {"Authorization": "Bearer owner-token"})["items"][0]
    headers = {"Authorization": "Bearer owner-token", "X-Workspace-Id": workspace["id"]}
    device, paired = _pair_device(client, workspace["id"])
    current = store.get(Principal("owner"), workspace["id"], "devices", device["id"])
    _post(client, f"/api/hermes/v1/devices/{device['id']}/runtime-policy", {
        "expected_version": current["version"], "idempotency_key": "allow-agent", "dry_run": False,
        "allowed_runtimes": ["agent"], "allowed_providers": ["codex"]}, headers)
    _post(client, "/api/hermes/v1/remote/presence", {
        "idempotency_key": "presence", "worker_id": "worker", "worker_version": "test",
        "runtime_capabilities": ["agent"], "providers": [{"id": "codex", "executable_present": True}]}, _auth(paired, device["id"]))
    from hermes_core.execution_targets import workspace_execution_targets
    target = workspace_execution_targets(store, None, Principal("owner"), workspace["id"])["devices"][0]
    agent = _post(client, "/api/hermes/v1/agents", {
        "data": {"title": "Remote Codex", "provider": "codex", "instructions": "Be concise."},
        "idempotency_key": "public-agent",
    }, headers)["items"][0]
    task = _post(client, "/api/hermes/v1/tasks", {
        "data": {"title": "Public agent task", "acceptance_criteria": "agent finishes"},
        "idempotency_key": "public-agent-task",
    }, headers)["items"][0]

    dispatch = _post(client, f"/api/hermes/v1/tasks/{task['id']}/agent-dispatch", {
        "expected_version": task["version"],
        "idempotency_key": "public-agent-dispatch",
        "dry_run": False,
        "agent_id": agent["id"],
        "target_version": agent["version"],
        "prompt": "Run remotely.",
        "target_device_id": device["id"],
        "target_basis": target["basis"],
    }, headers)["items"][0]
    run = dispatch["run"]
    assert run["data"]["target_device_id"] == device["id"]
    assert run["data"]["agent_source"]["resource"] == "agents"
    assert run["data"]["agent_bindings"]["agent_1"]["agent_id"] == agent["id"]

    queued = _post(client, f"/api/hermes/v1/runs/{run['id']}/start", {
        "expected_version": run["version"], "idempotency_key": "public-agent-start", "dry_run": False}, headers)["items"][0]
    claim = _post(client, "/api/hermes/v1/remote/claim", {
        "idempotency_key": "public-agent-claim",
        "worker_version": "test",
        "worker_id": "worker",
        "runtime_capabilities": ["agent"],
    }, _auth(paired, device["id"]))["items"][0]
    assert claim["run_id"] == queued["id"]
    assert claim["node"]["kind"] == "agent"
    assert claim["agent_binding"]["profile"]["provider"] == "codex"


def _write_fake_agentd(path: Path) -> None:
    path.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, subprocess, sys, time\n"
        "payload = json.loads(sys.stdin.read())\n"
        "root = sys.argv[sys.argv.index('--root') + 1]\n"
        "started = time.monotonic()\n"
        "proc = subprocess.run(payload['argv'], cwd=root, text=True, capture_output=True, timeout=payload['timeout_seconds'])\n"
        "print(json.dumps({'ok': proc.returncode == 0, 'exit_code': proc.returncode, 'stdout': proc.stdout,\n"
        "                  'stderr': proc.stderr, 'duration_ms': int((time.monotonic() - started) * 1000)}))\n",
        encoding="utf-8",
    )
    path.chmod(0o700)


def _write_fake_codex(path: Path, *, completed: bool) -> None:
    events = [{"type": "item.completed", "item": {"type": "agent_message", "text": "remote agent done"}}]
    if completed:
        events.append({"type": "turn.completed", "usage": {"total_tokens": 7}})
    path.write_text(
        "#!/usr/bin/env python3\n"
        "import json\n"
        f"events = {json.dumps(events)}\n"
        "for event in events:\n"
        "    print(json.dumps(event))\n",
        encoding="utf-8",
    )
    path.chmod(0o700)


def test_worker_executes_claimed_agent_with_existing_provider_protocol(tmp_path: Path, monkeypatch):
    client, store = _client(tmp_path)
    workspace = _post(client, "/api/hermes/v1/workspaces", {
        "data": {"name": "Remote Agent Execute", "root": str(tmp_path)},
        "idempotency_key": "workspace-exec",
    }, {"Authorization": "Bearer owner-token"})["items"][0]
    device, paired = _pair_device(client, workspace["id"])
    _allow_device_runtime(store, workspace["id"], device["id"], ["agent"])
    run, _agent = _queue_agent_run(store, workspace, device["id"], key="agent-run-exec")
    auth = _auth(paired, device["id"])
    task = _post(client, "/api/hermes/v1/remote/claim", {
        "idempotency_key": "claim-agent-exec",
        "worker_version": "test",
        "runtime_capabilities": ["agent"],
    }, auth)["items"][0]

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    agentd = bin_dir / "sop-agentd"
    codex = bin_dir / "codex"
    _write_fake_agentd(agentd)
    _write_fake_codex(codex, completed=True)
    monkeypatch.setattr("hermes_core.remote_worker.provider_command", lambda profile, prompt: [sys.executable, str(codex), prompt])
    monkeypatch.setenv("PATH", str(bin_dir) + os.pathsep + os.environ.get("PATH", ""))
    result = _execute_task(str(agentd), tmp_path, task, "http://127.0.0.1", {
        "device_id": device["id"],
        "workspace_id": workspace["id"],
        "credential": paired["credential"],
        "server": "http://127.0.0.1",
    })
    assert result["ok"] is True
    assert result["agent"]["completed"] is True
    assert result["agent"]["message"] == "remote agent done"

    saved = _post(client, "/api/hermes/v1/remote/result", {
        "run_id": run["id"],
        "owner": task["owner"],
        "node_id": "agent_1",
        "idempotency_key": "result-agent-exec",
        "result": result,
    }, auth)["items"][0]
    assert saved["status"] == "completed"
    node_result = saved["data"]["node_results"]["agent_1"]
    assert node_result["succeeded"] is True
    assert node_result["agent"]["completed"] is True
    assert node_result["agent"]["agent_id"]
    assert node_result["agent"]["profile_version"] == 1
    assert paired["credential"] not in json.dumps(node_result)


def test_agent_provider_exit_zero_without_terminal_event_fails_node(tmp_path: Path, monkeypatch):
    client, store = _client(tmp_path)
    workspace = _post(client, "/api/hermes/v1/workspaces", {
        "data": {"name": "Remote Agent Fail", "root": str(tmp_path)},
        "idempotency_key": "workspace-fail",
    }, {"Authorization": "Bearer owner-token"})["items"][0]
    device, paired = _pair_device(client, workspace["id"])
    _allow_device_runtime(store, workspace["id"], device["id"], ["agent"])
    run, _agent = _queue_agent_run(store, workspace, device["id"], key="agent-run-fail")
    auth = _auth(paired, device["id"])
    task = _post(client, "/api/hermes/v1/remote/claim", {
        "idempotency_key": "claim-agent-fail",
        "worker_version": "test",
        "runtime_capabilities": ["agent"],
    }, auth)["items"][0]
    bin_dir = tmp_path / "bin-fail"
    bin_dir.mkdir()
    agentd = bin_dir / "sop-agentd"
    codex = bin_dir / "codex"
    _write_fake_agentd(agentd)
    _write_fake_codex(codex, completed=False)
    monkeypatch.setattr("hermes_core.remote_worker.provider_command", lambda profile, prompt: [sys.executable, str(codex), prompt])
    monkeypatch.setenv("PATH", str(bin_dir) + os.pathsep + os.environ.get("PATH", ""))

    result = _execute_task(str(agentd), tmp_path, task, "http://127.0.0.1", {
        "device_id": device["id"],
        "workspace_id": workspace["id"],
        "credential": paired["credential"],
        "server": "http://127.0.0.1",
    })
    assert result["exit_code"] == 0
    assert result["ok"] is False
    assert result["agent"]["completed"] is False
    saved = _post(client, "/api/hermes/v1/remote/result", {
        "run_id": run["id"],
        "owner": task["owner"],
        "node_id": "agent_1",
        "idempotency_key": "result-agent-fail",
        "result": result,
    }, auth)["items"][0]
    assert saved["status"] == "failed"
    assert saved["data"]["recovery_requires_review"] is True
