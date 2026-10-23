import json

import httpx
from sop_sdk.client import ManagerClient


def test_team_runtime_directory_preserves_project_scope_and_saved_version():
    seen = []
    payload = {"version": 8, "members": [{"member_id": "member-one", "member_name": "Tool", "member_kind": "tool", "status": "stale"}]}

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=payload)

    with ManagerClient("https://manager.example", project_id="project-one", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        assert client.delivery_team_runtime_bindings() == payload
    assert len(seen) == 1
    assert seen[0].method == "GET"
    assert seen[0].url.path == "/api/v1/delivery/team-runtime-bindings"
    assert seen[0].headers["X-Project-Id"] == "project-one"


def test_tool_binding_command_keeps_explicit_configuration_version_and_original_request():
    """Source definition only: binding uses the same formal command contract."""
    seen = []
    body = {"action": "member.runtime.bind", "payload": {
        "member_id": "member-tool", "workspace_id": "W", "agent_id": "A", "agent_version": 3,
    }, "expected_version": 8, "idempotency_key": "fixed-tool-binding"}

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"action": "member.runtime.bind", "resource_id": "member-tool", "applied_version": 9})

    with ManagerClient("https://manager.example", project_id="project-one", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        for _ in range(2):
            assert client.delivery_command(body)["resource_id"] == "member-tool"
    assert [json.loads(request.content) for request in seen] == [body, body]
    assert all(request.method == "POST" and request.url.path == "/api/v1/delivery/commands" for request in seen)
    assert all(request.headers["X-Project-Id"] == "project-one" for request in seen)
