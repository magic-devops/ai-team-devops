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
