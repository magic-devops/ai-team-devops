import json

import httpx
import pytest
from sop_sdk import HermesClient
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError
from sop_sdk.security import BearerAuth


def test_external_preview_observations_preserve_scope_basis_cursor_and_unknown_usage():
    seen = []
    result = {"next_cursor": "eyJvcGFxdWUiOnRydWV9", "nodes": [{"result": {"agent": {"usage": None}}}]}

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=result)

    body = {
        "task_id": "T-one",
        "task_basis": "a" * 64,
        "target_basis": "b" * 64,
        "target_kind": "device",
        "target_device_id": "device-one",
        "test_nodes": [],
    }
    with ManagerClient(
        "https://manager.example", auth=BearerAuth("test-token"), project_id="project-one", max_retries=0
    ) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        assert client.delivery_execution_preview(body) == result
        assert (
            client.delivery_execution_observations("execution-one", cursor=result["next_cursor"], limit=7)
            == result
        )
    assert json.loads(seen[0].content) == body
    assert seen[0].url.path == "/api/v1/delivery/execution-preview"
    assert seen[1].url.path == "/api/v1/delivery/executions/execution-one/observations"
    assert dict(seen[1].url.params) == {"cursor": result["next_cursor"], "limit": "7"}
    assert all(r.headers["X-Project-Id"] == "project-one" for r in seen)


def test_external_preview_conflict_is_not_retried_or_adopted():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(409, json={"detail": "Target changed", "current_version": 9})

    with ManagerClient("https://manager.example", max_retries=3) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        with pytest.raises(SopConflictError):
            client.delivery_execution_preview({"target_basis": "pinned"})
    assert len(seen) == 1


@pytest.mark.parametrize("limit,cursor", [(True, ""), (0, ""), (101, ""), (1, "bad\nvalue"), (1, "a" * 2049)])
def test_external_observation_rejects_invalid_boundaries_before_request(limit, cursor):
    with ManagerClient("https://manager.example") as client:
        with pytest.raises(ValueError):
            client.delivery_execution_observations("execution-one", limit=limit, cursor=cursor)


def test_device_policy_and_agent_post_tests_transport_pinned_body():
    seen = []
    envelope = {
        "ok": True,
        "scope": {"workspace_id": "ws-one"},
        "summary": {},
        "items": [],
        "actions": [],
        "permissions": ["read"],
        "audit": {},
        "trace_id": "trace-one",
    }

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=envelope)

    policy = {
        "expected_version": 4,
        "idempotency_key": "policy-key",
        "dry_run": False,
        "allowed_runtimes": ["command", "agent"],
        "allowed_providers": ["codex"],
    }
    tests = [{"id": "test", "kind": "command", "argv": ["python", "-m", "unittest"]}]
    auth_value = "token-one"
    with HermesClient(
        "https://manager.example",
        token=auth_value,
        workspace_id="ws-one",
        transport=httpx.MockTransport(handler),
    ) as client:
        client.device_runtime_policy("device-one", policy)
        client.task_agent_dispatch(
            "task-one",
            expected_version=2,
            target_version=3,
            prompt="Implement",
            agent_id="agent-one",
            target_device_id="device-one",
            target_basis="a" * 64,
            test_nodes=tests,
            idempotency_key="dispatch-key",
        )
    assert seen[0].url.path == "/api/hermes/v1/devices/device-one/runtime-policy"
    assert json.loads(seen[0].content) == policy
    assert json.loads(seen[1].content)["test_nodes"] == tests
    assert json.loads(seen[1].content)["target_basis"] == "a" * 64
    assert all(r.headers["X-Workspace-Id"] == "ws-one" for r in seen)
