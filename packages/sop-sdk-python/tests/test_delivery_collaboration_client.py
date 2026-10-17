"""Exact activity and observed requirement history are server-owned facts."""

import json

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError


def test_collaboration_reads_use_pinned_scope_cursor_and_exact_ids():
    seen = []
    expected = {"association": "unknown", "items": [], "next_cursor": "fixed"}
    with ManagerClient("https://manager.test", project_id="selected", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(
            base_url=client.base_url,
            transport=httpx.MockTransport(lambda request: seen.append(request) or httpx.Response(200, json=expected)),
        )
        assert client.delivery_activity(scope="requirement", scope_id="REQ-one", cursor="same", limit=7) == expected
        assert client.delivery_activity_event("event-one") == expected
        assert client.delivery_requirement_history("REQ-one", cursor="observed", limit=5) == expected
        assert client.delivery_requirement_version("REQ-one", "version-one") == expected
    assert [request.url.path for request in seen] == [
        "/api/v1/delivery/activity", "/api/v1/delivery/activity/event-one",
        "/api/v1/delivery/requirements/REQ-one/history", "/api/v1/delivery/requirements/REQ-one/history/version-one",
    ]
    assert dict(seen[0].url.params) == {"scope": "requirement", "scope_id": "REQ-one", "cursor": "same", "limit": "7"}
    assert dict(seen[2].url.params) == {"cursor": "observed", "limit": "5"}
    assert all(request.headers["X-Project-Id"] == "selected" and request.method == "GET" for request in seen)


def test_change_preview_preserves_proposal_and_conflict_without_implicit_adoption():
    seen = []
    body = {"requirement_basis": "b" * 64, "changes": {"description": "Reviewed wording", "acceptance_criteria": []}}
    with ManagerClient("https://manager.test", project_id="selected", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(
            base_url=client.base_url,
            transport=httpx.MockTransport(lambda request: seen.append(request) or httpx.Response(409, json={"detail": "changed"})),
        )
        with pytest.raises(SopConflictError):
            client.delivery_requirement_change_preview("REQ-one", body)
    assert len(seen) == 1
    assert seen[0].method == "POST" and seen[0].url.path == "/api/v1/delivery/requirements/REQ-one/change-preview"
    assert json.loads(seen[0].content) == body


@pytest.mark.parametrize("options", [
    {"scope": "task"}, {"scope": "project", "scope_id": "REQ-one"},
    {"scope": "requirement"}, {"limit": 0}, {"limit": 101}, {"limit": True},
])
def test_invalid_activity_scope_or_limit_is_rejected_before_transport(options):
    with ManagerClient("https://manager.test", max_retries=0) as client:
        client._request = lambda *args, **kwargs: pytest.fail("Invalid selection must not request")
        with pytest.raises(ValueError):
            client.delivery_activity(**options)
