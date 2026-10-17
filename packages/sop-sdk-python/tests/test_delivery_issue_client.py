import httpx
import pytest
from sop_sdk.client import ManagerClient


def test_issue_diagnosis_uses_exact_ids_cursor_and_original_request():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"ok": True})

    body = {
        "generator": "rules",
        "expected_version": 7,
        "issue_basis": "a" * 64,
        "selected_evidence_ids": ["issue:ISS-1"],
        "idempotency_key": "original-key",
    }
    with ManagerClient(base_url="https://manager.test", project_id="project", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(base_url="https://manager.test", transport=httpx.MockTransport(handler))
        client.delivery_issue("ISS-1")
        client.delivery_issue_diagnoses("ISS-1", cursor="fixed-cursor")
        client.delivery_issue_diagnose("ISS-1", body)
        client.delivery_issue_diagnosis("ISS-1", "a" * 64)
    assert [request.url.path for request in calls] == [
        "/api/v1/delivery/issues/ISS-1",
        "/api/v1/delivery/issues/ISS-1/diagnoses",
        "/api/v1/delivery/issues/ISS-1/diagnoses",
        "/api/v1/delivery/issues/ISS-1/diagnoses/" + "a" * 64,
    ]
    assert calls[1].url.params["cursor"] == "fixed-cursor"
    import json

    assert json.loads(calls[2].content) == body


@pytest.mark.parametrize("issue_id", ["", "../issue", "other/issue", "ISS?scope=other"])
def test_issue_diagnosis_rejects_resource_path_injection(issue_id):
    with ManagerClient(base_url="https://manager.test", max_retries=0) as client:
        with pytest.raises(ValueError):
            client.delivery_issue(issue_id)
