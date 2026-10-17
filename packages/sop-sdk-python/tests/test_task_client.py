import json

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopNotFoundError
from sop_sdk.security import BearerAuth


def test_task_detail_preserves_auth_project_and_server_fields():
    seen = []
    result = {"id": "T-detail.1", "project_id": "selected", "title": "Review", "dev_tool": "codex"}

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json=result)

    with ManagerClient("https://manager.example", auth=BearerAuth("test-bearer"),
                       project_id="selected", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handle), base_url=client.base_url)
        assert client.get_task("T-detail.1") == result
    assert len(seen) == 1
    assert seen[0].method == "GET"
    assert seen[0].url.raw_path == b"/api/v1/tasks/T-detail.1"
    assert seen[0].headers["Authorization"] == "Bearer test-bearer"
    assert seen[0].headers["X-Project-Id"] == "selected"


@pytest.mark.parametrize("task_id", ["", " ", "T-", "../models", "T-one/two", "T-one?project_id=other", "T-one#fragment"])
def test_task_detail_rejects_invalid_or_path_changing_ids_without_request(task_id):
    def handle(request):
        pytest.fail("Invalid task ID must not issue an HTTP request")

    with ManagerClient("https://manager.example", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handle), base_url=client.base_url)
        with pytest.raises(ValueError, match="task_id"):
            client.get_task(task_id)


def test_missing_task_is_explicit_and_does_not_retry_or_fall_back_to_list():
    seen = []

    def handle(request):
        seen.append(request)
        return httpx.Response(404, json={"detail": "Task not found"})

    with ManagerClient("https://manager.example", project_id="selected") as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handle), base_url=client.base_url)
        with pytest.raises(SopNotFoundError, match="Task not found"):
            client.get_task("T-absent")
    assert len(seen) == 1


def test_task_write_requests_preserve_own_criteria_omission_and_explicit_clear():
    seen = []

    def handle(request):
        seen.append((request.method, request.url.path, json.loads(request.content), request.headers["X-Project-Id"]))
        return httpx.Response(200, json={"ok": True, "id": "T-independent"})

    with ManagerClient("https://manager.example", project_id="selected", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handle), base_url=client.base_url)
        client.create_task({"title": "Independent", "req_id": "", "acceptance_criteria": ["测试通过", "Review evidence"]})
        client.update_task("T-independent", {"title": "Renamed"})
        client.update_task("T-independent", {"acceptance_criteria": []})
    assert seen == [
        ("POST", "/api/v1/tasks", {"title": "Independent", "req_id": "", "acceptance_criteria": ["测试通过", "Review evidence"]}, "selected"),
        ("PATCH", "/api/v1/tasks/T-independent", {"title": "Renamed"}, "selected"),
        ("PATCH", "/api/v1/tasks/T-independent", {"acceptance_criteria": []}, "selected"),
    ]


def test_task_owner_ids_are_never_replaced_by_display_names():
    seen = []

    def handle(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "T-owned", "owner_id": "user:one", "assigned_to": "Same name"})

    with ManagerClient("https://manager.example", project_id="selected", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handle), base_url=client.base_url)
        assert client.create_task({"title": "Owned", "owner_id": "user:one"})["owner_id"] == "user:one"
        client.update_task("T-owned", {"title": "Keep identity"})
        client.update_task("T-owned", {"owner_id": ""})
    assert seen == [{"title": "Owned", "owner_id": "user:one"}, {"title": "Keep identity"}, {"owner_id": ""}]
