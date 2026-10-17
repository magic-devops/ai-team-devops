import json

import httpx
from sop_sdk.client import ManagerClient


def test_delivery_runtime_exact_output_and_original_control_preview():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"ok": True})

    body = {"id": "EXEC-1", "action": "execution.cancel", "reason": "Human reviewed the selected run"}
    with ManagerClient(base_url="https://manager.test", project_id="project", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(base_url="https://manager.test", transport=httpx.MockTransport(handler))
        client.delivery_execution_runtime("EXEC-1")
        client.delivery_execution_output("EXEC-1", "tests", attempt=2, stream="stderr", cursor="fixed-cursor")
        client.delivery_execution_control_preview(body)
    assert [request.url.path for request in calls] == [
        "/api/v1/delivery/executions/EXEC-1/runtime",
        "/api/v1/delivery/executions/EXEC-1/nodes/tests/output",
        "/api/v1/delivery/execution-control-preview",
    ]
    assert all(request.headers["X-Project-Id"] == "project" for request in calls)
    assert dict(calls[1].url.params) == {
        "attempt": "2",
        "stream": "stderr",
        "cursor": "fixed-cursor",
        "limit": "50",
    }
    assert json.loads(calls[2].content) == body
