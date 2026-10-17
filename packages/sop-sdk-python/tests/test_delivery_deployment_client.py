import json

import httpx
import pytest
from sop_sdk.client import ManagerClient


def test_deployment_reads_and_preview_keep_scope_and_original_input():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"project_id": "project", "allowed": False})

    draft = {"candidate_id": "release-1", "environment_id": "env-1", "reason": "Deploy reviewed bytes"}
    with ManagerClient("https://manager.example", project_id="project", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        client.delivery_deployments()
        client.delivery_deployment("deployment-unknown")
        result = client.delivery_deployment_preview(draft)
    assert result["allowed"] is False
    assert [(request.method, request.url.path) for request in requests] == [
        ("GET", "/api/v1/delivery/deployments"),
        ("GET", "/api/v1/delivery/deployments/deployment-unknown"),
        ("POST", "/api/v1/delivery/deployment-preview"),
    ]
    assert all(request.headers["X-Project-Id"] == "project" for request in requests)
    assert json.loads(requests[2].content) == draft


def test_deployment_detail_rejects_invalid_ids_before_network():
    with ManagerClient("https://manager.example", max_retries=0) as client:
        for invalid in ["", "../another", "a/b", "x?scope=other", " id", "a" * 201]:
            with pytest.raises(ValueError):
                client.delivery_deployment(invalid)
