import json
import uuid

import pytest
from fastapi.testclient import TestClient
from hermes_core.agents import AgentProfile, provider_command, provider_evidence, squad_route
from hermes_core.api import create_app
from hermes_core.models import CoreError, Principal

BASE = "/api/hermes/v1"


@pytest.fixture
def setup(tmp_path, monkeypatch):
    app = create_app(tmp_path / "core", "owner", principals={
        "owner": Principal("owner"),
        "reader": Principal("reader", permissions=frozenset({"read"})),
        "writer": Principal("writer", permissions=frozenset({"read", "write", "execute"})),
        "other": Principal("other", tenant="other"),
    })
    client = TestClient(app, headers={"Authorization": "Bearer owner"})
    workspace = client.post(BASE + "/workspaces", json={"data": {"name": "Agents", "root": str(tmp_path)},
                                                          "idempotency_key": "workspace"}).json()["items"][0]
    client.headers["X-Workspace-Id"] = workspace["id"]
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)
    monkeypatch.setattr("hermes_core.agents.shutil.which", lambda provider: "/usr/bin/" + provider)
    return client, app


def create(client, kind, **data):
    response = client.post(BASE + "/" + kind, json={"data": data, "idempotency_key": uuid.uuid4().hex})
    assert response.status_code == 201, response.text
    return response.json()["items"][0]


def dispatch(client, task, agent=None, squad=None, **overrides):
    target = agent or squad
    return client.post(f"{BASE}/tasks/{task['id']}/agent-dispatch", json={
        "expected_version": task["version"], "target_version": target["version"],
        "agent_id": agent["id"] if agent else "", "squad_id": squad["id"] if squad else "",
        "idempotency_key": "dispatch", "dry_run": False, **overrides})


def codex_result(message):
    return {"succeeded": True, "exit_code": 0, "stdout": "\n".join(map(json.dumps, [
        {"type": "item.completed", "item": {"type": "agent_message", "text": message}},
        {"type": "turn.completed", "usage": {"input_tokens": 11, "output_tokens": 7}},
    ]))}


def test_agent_dispatch_preview_execution_and_evidence(setup, monkeypatch):
    client, app = setup
    agent = create(client, "agents", title="Coder", provider="codex")
    task = create(client, "tasks", title="Implement", acceptance_criteria="Output checked")
    before = client.get(BASE + "/sync").json()["items"]
    preview = dispatch(client, task, agent=agent, dry_run=True)
    assert preview.status_code == 200, preview.text
    assert client.get(BASE + "/sync").json()["items"] == before
    response = dispatch(client, task, agent=agent)
    run = response.json()["items"][0]["run"]
    assert dispatch(client, task, agent=agent).json() ["items"] == response.json()["items"]
    assert run["data"]["agent_bindings"]["agent_1"]["version"] == agent["version"]
    monkeypatch.setattr(app.state.hermes_execution, "tool", lambda *args: codex_result("Verified output"))
    started = client.post(f"{BASE}/runs/{run['id']}/start", json={"expected_version": 1,
                            "idempotency_key": "start", "dry_run": False})
    assert started.status_code == 200, started.text
    result = client.get(f"{BASE}/runs/{run['id']}").json()["items"][0]
    assert result["status"] == "completed"
    assert result["data"]["node_results"]["agent_1"]["agent"]["usage"]["output_tokens"] == 7
    assert client.get(f"{BASE}/tasks/{task['id']}/delivery").json()["items"][0]["phase"] == "awaiting_review"


def test_squad_leader_routes_only_selected_members(setup, monkeypatch):
    client, app = setup
    agents = [create(client, "agents", title=title, provider="codex") for title in ("Leader", "Coder", "Reviewer")]
    squad = create(client, "squads", title="Squad", members=[
        {"agent_id": agent["id"], "role": role} for agent, role in zip(agents, ("leader", "implementer", "reviewer"), strict=True)])
    task = create(client, "tasks", title="Implement", acceptance_criteria="Reviewed")
    run = dispatch(client, task, squad=squad).json()["items"][0]["run"]
    calls = []

    def tool(*args):
        calls.append(args[3].id)
        return codex_result(json.dumps({"delegations": [{"agent_id": agents[1]["id"], "instruction": "Implement tests"}]})) if len(calls) == 1 else codex_result("Tests pass")

    monkeypatch.setattr(app.state.hermes_execution, "tool", tool)
    client.post(f"{BASE}/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "start", "dry_run": False})
    result = client.get(f"{BASE}/runs/{run['id']}").json()["items"][0]
    assert result["status"] == "completed", result
    assert calls == ["agent_1", "agent_2"]
    assert result["data"]["node_results"]["agent_3"]["skipped"] is True
    delivery = client.get(f"{BASE}/tasks/{task['id']}/delivery").json()["items"][0]
    assert delivery["phase"] == "awaiting_review"
    assert delivery["task"]["status"] == "in_progress"
    client.headers["Authorization"] = "Bearer writer"
    response = client.post(f"{BASE}/tasks/{task['id']}/review", json={
        "expected_version": delivery["task"]["version"], "run_version": result["version"],
        "run_id": run["id"], "decision": "accept", "comment": "Ship", "idempotency_key": "not-authorized", "dry_run": False})
    assert response.status_code == 403


def test_profile_version_and_permissions_fail_closed(setup):
    client, _ = setup
    agent = create(client, "agents", title="Coder", provider="codex")
    task = create(client, "tasks", title="Work", acceptance_criteria="Evidence")
    assert dispatch(client, task, agent=agent, target_version=99).status_code == 409
    for identity in ("reader", "other"):
        client.headers["Authorization"] = "Bearer " + identity
        assert dispatch(client, task, agent=agent).status_code in {403, 404}
    client.headers["Authorization"] = "Bearer writer"
    assert client.post(BASE + "/agents", json={"data": {"title": "No", "provider": "codex"}, "idempotency_key": "no"}).status_code == 403


def test_archived_member_and_forged_run_are_rejected(setup):
    client, _ = setup
    agent = create(client, "agents", title="Coder", provider="codex")
    task = create(client, "tasks", title="Work", acceptance_criteria="Evidence")
    changed = client.patch(f"{BASE}/agents/{agent['id']}", json={"data": {"status": "archived"},
                            "expected_version": 1, "idempotency_key": "archive"})
    assert changed.status_code == 200, changed.text
    assert dispatch(client, task, agent=agent).status_code == 409
    assert client.post(BASE + "/runs", json={"data": {"title": "fake", "agent_bindings": {}}, "idempotency_key": "fake"}).status_code == 422


@pytest.mark.parametrize("stdout", ["", "{}", '{"type":"turn.failed"}', '{"type":"turn.completed"}\n{"type":"error"}'])
def test_exit_zero_without_provider_completion_is_not_success(stdout):
    assert not provider_evidence("codex", stdout)["completed"]


def test_routing_rejects_unknown_agents():
    with pytest.raises(CoreError, match="unknown"):
        squad_route('{"delegations":[{"agent_id":"outside","instruction":"Run"}]}', [])


def test_provider_cli_arguments_do_not_bypass_permissions(monkeypatch):
    monkeypatch.setattr("hermes_core.agents.shutil.which", lambda provider: "/bin/" + provider)
    for provider in ("codex", "claude", "opencode"):
        argv = provider_command(AgentProfile(title="Test", provider=provider), "prompt ; not shell")
        assert argv[-1] == "prompt ; not shell"
        assert not any("dangerously" in part or "bypassPermissions" in part for part in argv)
