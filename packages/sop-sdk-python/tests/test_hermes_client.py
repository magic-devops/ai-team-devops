from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from hermes_core.api import create_app
from sop_sdk import HermesClient
from sop_sdk.errors import HermesContractError, HermesUnavailableError


def _token() -> str:
    return "token-1"


def _envelope(items=None, summary=None):
    return {
        "ok": True,
        "scope": {"workspace_id": "ws-1"},
        "summary": summary or {},
        "items": [] if items is None else items,
        "actions": [],
        "permissions": ["read"],
        "audit": {},
        "trace_id": "trace-1",
    }


class _TestClientTransport(httpx.BaseTransport):
    def __init__(self, client: TestClient) -> None:
        self.client = client

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = self.client.request(
            request.method,
            str(request.url).split("http://127.0.0.1", 1)[-1],
            content=request.content,
            headers=dict(request.headers),
        )
        return httpx.Response(
            response.status_code,
            content=response.content,
            headers=response.headers,
            request=request,
        )


def test_list_resource_uses_v1_bearer_workspace_and_query():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("Authorization")
        seen["workspace"] = request.headers.get("X-Workspace-Id")
        return httpx.Response(200, json=_envelope())

    client = HermesClient(
        "https://hermes.example",
        token=_token(),
        workspace_id="ws-1",
        transport=httpx.MockTransport(handler),
    )

    payload = client.list_resource("runs", q="build", status="ready", kind="command", limit=7, cursor="abc")

    assert payload["ok"] is True
    assert seen == {
        "url": "https://hermes.example/api/hermes/v1/runs?q=build&status=ready&kind=command&limit=7&cursor=abc",
        "authorization": "Bearer token-1",
        "workspace": "ws-1",
    }


def test_health_is_unauthenticated():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("Authorization")
        return httpx.Response(200, json={"ok": True, "service": "hermes-core", "version": "1.0.0"})

    client = HermesClient("https://hermes.example/api/hermes/v1", token=_token(), transport=httpx.MockTransport(handler))

    client.health()

    assert seen["authorization"] is None


def test_diagnostics_preserves_degraded_checks_for_clients():
    def handler(request):
        assert request.url.path == "/api/hermes/v1/system/diagnostics"
        assert request.headers["Authorization"] == "Bearer token-1"
        return httpx.Response(200, json={**_envelope([{"id": "executor", "status": "failed"}]), "ok": False})

    with HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler)) as client:
        result = client.system_diagnostics()
        assert result["ok"] is False
        assert result["items"][0]["id"] == "executor"


def test_create_patch_and_run_action_bodies_match_contract():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path, json.loads(request.content or b"{}")))
        return httpx.Response(200, json=_envelope())

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    client.create_resource("assets", {"title": "KB", "kind": "knowledge"}, idempotency_key="idem-create")
    client.patch_resource("assets", "asset-1", {"title": "KB2"}, expected_version=3, idempotency_key="idem-patch")
    client.run_action("run-1", "start", expected_version=5, idempotency_key="idem-run")

    assert requests == [
        ("POST", "/api/hermes/v1/assets", {"data": {"title": "KB", "kind": "knowledge"}, "idempotency_key": "idem-create"}),
        (
            "PATCH",
            "/api/hermes/v1/assets/asset-1",
            {"data": {"title": "KB2"}, "idempotency_key": "idem-patch", "expected_version": 3},
        ),
        (
            "POST",
            "/api/hermes/v1/runs/run-1/start",
            {"idempotency_key": "idem-run", "expected_version": 5, "dry_run": True},
        ),
    ]


def test_agent_and_squad_contracts_use_native_resources_and_catalog():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path, json.loads(request.content or b"{}")))
        return httpx.Response(200, json=_envelope())

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    client.agent_catalog()
    client.squad_catalog()
    client.create_agent_profile({
        "title": "Codex executor",
        "provider": "codex",
        "model": "gpt-5.5",
        "instructions": "Implement scoped tasks",
        "timeout_seconds": 1200,
    }, idempotency_key="agent-key")
    client.create_squad({
        "title": "Implementation squad",
        "members": [{"agent_id": "agent-1", "role": "leader", "instructions": "Route members"}],
    }, idempotency_key="squad-key")

    assert requests == [
        ("GET", "/api/hermes/v1/agents/catalog", {}),
        ("GET", "/api/hermes/v1/squads", {}),
        ("POST", "/api/hermes/v1/agents", {
            "data": {
                "title": "Codex executor",
                "provider": "codex",
                "model": "gpt-5.5",
                "instructions": "Implement scoped tasks",
                "timeout_seconds": 1200,
            },
            "idempotency_key": "agent-key",
        }),
        ("POST", "/api/hermes/v1/squads", {
            "data": {
                "title": "Implementation squad",
                "members": [{"agent_id": "agent-1", "role": "leader", "instructions": "Route members"}],
            },
            "idempotency_key": "squad-key",
        }),
    ]


def test_new_sdk_actions_are_backed_by_core_openapi(tmp_path):
    app_paths = create_app(tmp_path / "db", _token()).openapi()["paths"]
    generated_paths = json.loads(
        (Path(__file__).resolve().parents[3] / "apis/generated/hermes-v1/openapi.json").read_text(encoding="utf-8"),
    )["paths"]
    expected = (
        ("/api/hermes/v1/agents/catalog", "get"),
        ("/api/hermes/v1/{resource}", "get"),
        ("/api/hermes/v1/{resource}", "post"),
        ("/api/hermes/v1/{resource}/{entity_id}", "patch"),
        ("/api/hermes/v1/tasks/{task_id}/dispatch", "post"),
        ("/api/hermes/v1/tasks/{task_id}/agent-dispatch", "post"),
        ("/api/hermes/v1/schedules/{schedule_id}/configure", "post"),
        ("/api/hermes/v1/schedules/{schedule_id}/trigger", "post"),
        ("/api/hermes/v1/schedules/{schedule_id}/pause", "post"),
        ("/api/hermes/v1/schedules/{schedule_id}/resume", "post"),
        ("/api/hermes/v1/schedules/{schedule_id}/history", "get"),
        ("/api/hermes/v1/devices/{device_id}/pairing", "post"),
        ("/api/hermes/v1/devices/pair", "post"),
        ("/api/hermes/v1/devices/{device_id}/revoke", "post"),
        ("/api/hermes/v1/remote/claim", "post"),
        ("/api/hermes/v1/remote/heartbeat", "post"),
        ("/api/hermes/v1/remote/result", "post"),
    )
    absent = {
        "/api/hermes/v1/squads/catalog",
        "/api/hermes/v1/remote/worker",
        "/api/hermes/v1/worker-health",
        "/api/hermes/v1/worker-jobs",
        "/api/hermes/v1/jobs/enqueue",
    }

    for path, method in expected:
        assert method in app_paths[path]
        assert method in generated_paths[path]
    for path in absent:
        assert path not in app_paths
        assert path not in generated_paths


def test_sdk_contracts_work_against_create_app_routes(tmp_path):
    app = create_app(tmp_path / "db", _token())
    transport = _TestClientTransport(TestClient(app))
    with HermesClient("http://127.0.0.1", token=_token(), transport=transport) as client:
        workspace = client.create_workspace(
            {"name": "SDK QA", "root": str(tmp_path)},
            idempotency_key="workspace",
        )["items"][0]
        client.workspace_id = workspace["id"]
        assert client.agent_catalog()["items"]

        agent = client.create_agent_profile({
            "title": "Coder",
            "provider": "codex",
            "model": "",
            "instructions": "Implement only scoped tasks",
            "timeout_seconds": 60,
        }, idempotency_key="agent")["items"][0]
        squad = client.create_squad({
            "title": "Leader routed squad",
            "members": [{"agent_id": agent["id"], "role": "leader", "instructions": "Route members"}],
        }, idempotency_key="squad")["items"][0]
        squads = client.squad_catalog()["items"]
        assert [item["id"] for item in squads] == [squad["id"]]

        archived_squad = client.patch_resource(
            "squads",
            squad["id"],
            {"status": "archived"},
            expected_version=squad["version"],
            idempotency_key="archive-squad",
        )["items"][0]
        assert archived_squad["status"] == "archived"
        archived_agent = client.patch_resource(
            "agents",
            agent["id"],
            {"status": "archived"},
            expected_version=agent["version"],
            idempotency_key="archive-agent",
        )["items"][0]
        assert archived_agent["status"] == "archived"
        with pytest.raises(ValueError):
            client.delete_resource("agents", agent["id"], expected_version=archived_agent["version"])
        with pytest.raises(ValueError):
            client.patch_resource("devices", "device-1", {"status": "archived"}, expected_version=1)
        with pytest.raises(ValueError):
            client.delete_resource("devices", "device-1", expected_version=1)
        with pytest.raises(ValueError):
            client.create_resource("schedules", {"title": "Wrong path"})
        with pytest.raises(ValueError):
            client.patch_resource("schedules", "schedule-1", {"status": "paused"}, expected_version=1)

        asset = client.create_resource(
            "assets",
            {"title": "Doc", "kind": "knowledge"},
            idempotency_key="asset",
        )["items"][0]
        deleted = client.delete_resource(
            "assets",
            asset["id"],
            expected_version=asset["version"],
            dry_run=False,
            idempotency_key="delete-asset",
        )["items"][0]
        assert deleted["status"] == "archived"

        device = client.create_resource(
            "devices",
            {"title": "Mac worker", "platform": "darwin"},
            idempotency_key="device",
        )["items"][0]
        pairing = client.device_pairing(
            device["id"],
            expected_version=device["version"],
            dry_run=False,
            idempotency_key="device-pairing",
        )["items"][0]
        assert pairing["status"] == "pairing"
        assert pairing["pairing_secret"]
        paired = client.device_pair(device["id"], pairing["pairing_secret"])["items"][0]
        assert paired["status"] == "active"
        assert paired["credential"]
        revoked = client.device_revoke(
            device["id"],
            expected_version=paired["version"],
            dry_run=False,
            idempotency_key="device-revoke",
        )["items"][0]
        assert revoked["status"] == "revoked"

        schedule = client.schedule_configure(
            "nightly",
            {
                "title": "Nightly command",
                "interval_seconds": 60,
                "starts_at": datetime.now(timezone.utc).isoformat(),
                "nodes": [{"id": "check", "kind": "command", "argv": ["python", "-V"]}],
            },
            dry_run=False,
            idempotency_key="schedule-configure",
        )["items"][0]
        assert schedule["status"] == "active"
        paused = client.schedule_action(
            "nightly",
            "pause",
            expected_version=schedule["version"],
            dry_run=False,
            idempotency_key="schedule-pause",
        )["items"][0]
        assert paused["status"] == "paused"


def test_repository_uses_workspace_path_and_header_scope():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["workspace"] = request.headers.get("X-Workspace-Id")
        return httpx.Response(200, json=_envelope([{"id": "repo-1", "kind": "repository"}]))

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    payload = client.repository("ws-repo")

    assert payload["items"][0]["id"] == "repo-1"
    assert seen == {
        "path": "/api/hermes/v1/workspaces/ws-repo/repository",
        "workspace": "ws-repo",
    }


def test_run_changes_reads_stored_code_evidence_envelope():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        return httpx.Response(200, json=_envelope([{"id": "change-1", "kind": "code_evidence"}]))

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    payload = client.run_changes("run-1")

    assert payload["items"][0]["kind"] == "code_evidence"
    assert seen == {"path": "/api/hermes/v1/runs/run-1/changes"}


def test_task_dispatch_carries_isolation_and_preserves_base_commit():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=_envelope())

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    client.task_dispatch(
        "task-1",
        [{"id": "node-1"}],
        expected_version=7,
        idempotency_key="dispatch-key",
        isolation="git_worktree",
        base_commit="abc123",
        target_device_id="device-1",
    )

    assert requests == [{
        "nodes": [{"id": "node-1"}],
        "expected_version": 7,
        "dry_run": True,
        "isolation": "git_worktree",
        "base_commit": "abc123",
        "target_device_id": "device-1",
        "idempotency_key": "dispatch-key",
    }]


def test_task_agent_dispatch_pins_agent_or_squad_target_version():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.url.path, json.loads(request.content)))
        return httpx.Response(200, json=_envelope())

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    client.task_agent_dispatch(
        "task-1",
        expected_version=7,
        target_version=4,
        agent_id="agent-1",
        prompt="Implement this task",
        idempotency_key="agent-dispatch-key",
        isolation="git_worktree",
        base_commit="abc123",
    )

    assert requests == [("/api/hermes/v1/tasks/task-1/agent-dispatch", {
        "expected_version": 7,
        "target_version": 4,
        "dry_run": True,
        "idempotency_key": "agent-dispatch-key",
        "prompt": "Implement this task",
        "isolation": "git_worktree",
        "base_commit": "abc123",
        "agent_id": "agent-1",
    })]


def test_task_agent_dispatch_requires_exactly_one_target_and_prompt():
    client = HermesClient("https://hermes.example", token=_token())

    with pytest.raises(ValueError):
        client.task_agent_dispatch("task-1", expected_version=1, target_version=1, prompt="", agent_id="agent-1")
    with pytest.raises(ValueError):
        client.task_agent_dispatch("task-1", expected_version=1, target_version=1, prompt="x")
    with pytest.raises(ValueError):
        client.task_agent_dispatch("task-1", expected_version=1, target_version=1, prompt="x", agent_id="a", squad_id="s")


def test_schedule_and_device_pairing_actions_are_explicit_dry_runs():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((
            request.method,
            request.url.path,
            request.headers.get("Authorization"),
            request.headers.get("X-Workspace-Id"),
            json.loads(request.content or b"{}"),
        ))
        return httpx.Response(200, json=_envelope())

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    client.schedule_configure("sch-1", {"title": "Nightly"}, idempotency_key="schedule-key")
    client.schedule_action("sch-1", "trigger", expected_version=2, idempotency_key="trigger-key")
    client.schedule_history("sch-1", limit=10, cursor="c1")
    client.device_pairing("device-1", expected_version=3, idempotency_key="pairing-key")
    client.device_pair("device-1", "pair-secret-1234567890")
    client.device_revoke("device-1", expected_version=3, idempotency_key="revoke-key")

    assert requests == [
        ("POST", "/api/hermes/v1/schedules/sch-1/configure", "Bearer token-1", None, {
            "title": "Nightly",
            "dry_run": True,
            "idempotency_key": "schedule-key",
        }),
        ("POST", "/api/hermes/v1/schedules/sch-1/trigger", "Bearer token-1", None, {"idempotency_key": "trigger-key", "expected_version": 2, "dry_run": True}),
        ("GET", "/api/hermes/v1/schedules/sch-1/history", "Bearer token-1", None, {}),
        ("POST", "/api/hermes/v1/devices/device-1/pairing", "Bearer token-1", None, {
            "idempotency_key": "pairing-key",
            "expected_version": 3,
            "dry_run": True,
        }),
        ("POST", "/api/hermes/v1/devices/pair", None, None, {"device_id": "device-1", "secret": "pair-secret-1234567890"}),
        ("POST", "/api/hermes/v1/devices/device-1/revoke", "Bearer token-1", None, {"idempotency_key": "revoke-key", "expected_version": 3, "dry_run": True}),
    ]


def test_remote_transport_uses_device_auth_routes_only():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((
            request.url.path,
            request.headers.get("Authorization"),
            request.headers.get("X-Hermes-Device-Id"),
            request.headers.get("X-Workspace-Id"),
            json.loads(request.content),
        ))
        return httpx.Response(200, json=_envelope())

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    client.remote_claim(
        device_id="device-1",
        credential="credential-1",
        worker_version="1.0",
        idempotency_key="claim-key",
    )
    client.remote_heartbeat(
        device_id="device-1",
        credential="credential-1",
        run_id="run-1",
        owner="remote-owner-123456",
        idempotency_key="heartbeat-key",
    )
    client.remote_result(
        device_id="device-1",
        credential="credential-1",
        run_id="run-1",
        owner="remote-owner-123456",
        node_id="node-1",
        result={"exit_code": 0, "stdout": "ok"},
        idempotency_key="result-key",
    )

    assert requests == [
        ("/api/hermes/v1/remote/claim", "Bearer credential-1", "device-1", None, {
            "idempotency_key": "claim-key",
            "worker_version": "1.0",
        }),
        ("/api/hermes/v1/remote/heartbeat", "Bearer credential-1", "device-1", None, {
            "run_id": "run-1",
            "owner": "remote-owner-123456",
            "idempotency_key": "heartbeat-key",
        }),
        ("/api/hermes/v1/remote/result", "Bearer credential-1", "device-1", None, {
            "run_id": "run-1",
            "owner": "remote-owner-123456",
            "node_id": "node-1",
            "idempotency_key": "result-key",
            "result": {"exit_code": 0, "stdout": "ok"},
        }),
    ]


def test_task_dispatch_defaults_to_workspace_without_implicit_head():
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json=_envelope())

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    client.task_dispatch("task-1", [], expected_version=1, idempotency_key="dispatch-key")

    assert bodies[0]["isolation"] == "workspace"
    assert bodies[0]["base_commit"] == ""
    assert "target_device_id" not in bodies[0]


def test_iter_resource_follows_summary_next_cursor():
    cursors = []

    def handler(request: httpx.Request) -> httpx.Response:
        cursor = request.url.params.get("cursor", "")
        cursors.append(cursor)
        if cursor == "":
            return httpx.Response(200, json=_envelope([{"id": "a"}], {"next_cursor": "n2"}))
        return httpx.Response(200, json=_envelope([{"id": "b"}], {"next_cursor": ""}))

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    assert list(client.iter_resource("tasks", limit=1)) == [{"id": "a"}, {"id": "b"}]
    assert cursors == ["", "n2"]


def test_contract_requires_items_array():
    client = HermesClient(
        "https://hermes.example",
        token=_token(),
        transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={**_envelope(), "items": {}})),
    )

    with pytest.raises(HermesContractError):
        client.actions()


def test_unavailable_core_is_explicit_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    with pytest.raises(HermesUnavailableError):
        client.actions()


def test_delete_approval_and_export_are_versioned_dry_runs():
    requests = []

    def handler(request):
        requests.append((request.method, request.url.path, json.loads(request.content)))
        return httpx.Response(200, json=_envelope())

    with HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler)) as client:
        client.delete_resource("assets", "a", expected_version=2, idempotency_key="delete-key")
        client.approval_decision("p", decision="approve", expected_version=3, idempotency_key="approval-key")
        client.run_action("r", "export", expected_version=4, idempotency_key="export-key")
    assert requests == [
        ("DELETE", "/api/hermes/v1/assets/a", {"expected_version": 2, "dry_run": True, "idempotency_key": "delete-key"}),
        ("POST", "/api/hermes/v1/approvals/p/decision", {"decision": "approve", "expected_version": 3,
                                               "dry_run": True, "idempotency_key": "approval-key"}),
        ("POST", "/api/hermes/v1/runs/r/export", {"expected_version": 4, "dry_run": True, "idempotency_key": "export-key"}),
    ]


@pytest.mark.parametrize("url", ["http://remote.example", "https://user:secret@example.org", "file:///tmp/a", "https://example.org/#token"])
def test_remote_credentials_require_safe_https_url(url):
    with pytest.raises(ValueError):
        HermesClient(url, token=_token())
