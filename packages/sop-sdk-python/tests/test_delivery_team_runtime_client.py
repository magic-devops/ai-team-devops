import httpx
from sop_sdk.client import ManagerClient


def test_team_runtime_directory_preserves_project_scope_and_saved_version():
    seen = []
    payload = {"version": 8, "members": [{"member_id": "member-one", "status": "stale"}]}

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
