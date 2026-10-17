import json

import httpx
import pytest
from sop_sdk.client import ManagerClient


def test_quality_and_release_preserve_explicit_scope_and_preview_input():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"project_id": "project"})

    body = {"version": "1.0.0", "environment": "staging", "requirement_ids": ["req"],
            "task_ids": [], "ci_evidence_id": "ci-1", "artifact_url": "https://build.example/a",
            "release_notes": "Feature", "rollback_plan": "Previous build"}
    with ManagerClient("https://manager.example", project_id="project", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        client.delivery_quality(requirement_ids=["req", "req2"], task_ids=["independent"])
        client.delivery_releases()
        client.delivery_release("release-1")
        client.delivery_release_preview(body)
    assert seen[0].url.params.get_list("requirement_ids") == ["req", "req2"]
    assert seen[0].url.params.get_list("task_ids") == ["independent"]
    assert all(request.headers["X-Project-Id"] == "project" for request in seen)
    assert seen[2].url.path == "/api/v1/delivery/releases/release-1"
    assert json.loads(seen[3].content) == body


def test_quality_rejects_ambiguous_ids_before_network():
    with ManagerClient("https://manager.example", max_retries=0) as client:
        for ids in [["a", "a"], [""], [" a"], ["x"] * 201, "task-id", [["nested"]]]:
            with pytest.raises(ValueError):
                client.delivery_quality(task_ids=ids)
