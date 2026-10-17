import json

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError, SopForbiddenError, SopServerError
from sop_sdk.security import BearerAuth


def preview_body():
    return {
        "requirement_id": "REQ-中文",
        "expected_version": 7,
        "idempotency_key": "preview-retry-stable",
        "generator": "template",
        "mode": "fullstack",
        "max_items": 5,
    }


def test_delivery_task_plan_preview_preserves_scope_and_retry_body():
    seen = []
    result = {"id": "preview-one", "version": 7, "items": [{"key": "design", "title": "设计"}]}

    def handle(request):
        seen.append(request)
        if len(seen) == 1:
            raise httpx.ReadError("connection closed before response", request=request)
        return httpx.Response(200, json=result)

    with ManagerClient(
        "https://manager.example",
        auth=BearerAuth("test-bearer"),
        project_id="project-a",
        tenant_code="tenant-a",
        business_code="business-a",
        project_code="project-code-a",
        max_retries=1,
    ) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handle), base_url=client.base_url)
        body = preview_body()
        assert client.delivery_task_plan_preview(body) == result

    assert len(seen) == 2
    assert seen[0].content == seen[1].content
    assert json.loads(seen[0].content) == body
    for request in seen:
        assert request.method == "POST"
        assert request.url.path == "/api/v1/delivery/task-plan-preview"
        assert request.headers["Authorization"] == "Bearer test-bearer"
        assert request.headers["X-Project-Id"] == "project-a"
        assert request.headers["X-Tenant-Code"] == "tenant-a"
        assert request.headers["X-Business-Code"] == "business-a"
        assert request.headers["X-Project-Code"] == "project-code-a"


@pytest.mark.parametrize(
    "status,error",
    [(409, SopConflictError), (403, SopForbiddenError), (502, SopServerError)],
)
def test_delivery_task_plan_preview_exposes_server_errors_without_fallback(status, error):
    seen = []
    problem = {
        "detail": {"code": "plan_generation_failed", "message": "preview failed"},
        "current_version": 9,
        "preview_id": "failed-one",
    }

    def handle(request):
        seen.append(request)
        return httpx.Response(status, json=problem)

    with ManagerClient("https://manager.example", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handle), base_url=client.base_url)
        with pytest.raises(error) as exc:
            client.delivery_task_plan_preview(preview_body())

    assert len(seen) == 1
    assert exc.value.status == status
    assert exc.value.detail == problem
    assert "preview failed" in str(exc.value)


def test_delivery_command_keeps_project_version_and_retry_identity():
    seen = []

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json={"version": 4})

    client = ManagerClient("https://manager.example", project_id="project-a", max_retries=0)
    client._client.close()
    client._client = httpx.Client(
        transport=httpx.MockTransport(handle), base_url=client.base_url, headers={"X-Project-Id": "project-a"}
    )
    body = {
        "action": "execution.sync",
        "payload": {"id": "execution-one"},
        "expected_version": 3,
        "idempotency_key": "stable-retry-key",
    }
    assert client.delivery_command(body) == {"version": 4}
    assert json.loads(seen[0].content) == body
    assert seen[0].headers["X-Project-Id"] == "project-a"
    client.delivery_workspace()
    client.delivery_execution_targets()
    assert [r.url.path for r in seen] == [
        "/api/v1/delivery/commands",
        "/api/v1/delivery/workspace",
        "/api/v1/delivery/execution-targets",
    ]
    client.close()
