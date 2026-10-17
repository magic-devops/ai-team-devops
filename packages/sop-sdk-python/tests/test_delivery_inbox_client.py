import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.security import BearerAuth


@pytest.mark.parametrize("scope", ["mine", "team"])
def test_delivery_inbox_preserves_scope_and_project_identity(scope):
    seen = []
    expected = {"project_id": "selected", "scope": scope, "items": []}

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json=expected)

    with ManagerClient("https://manager.example", auth=BearerAuth("test-only"), project_id="selected") as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handle), base_url=client.base_url)
        assert client.delivery_inbox(scope=scope) == expected
    assert len(seen) == 1
    request = seen[0]
    assert request.method == "GET" and request.url.path == "/api/v1/delivery/inbox"
    assert request.url.params["scope"] == scope
    assert request.headers["X-Project-Id"] == "selected"
    assert request.headers["Authorization"] == "Bearer test-only"


def test_delivery_inbox_rejects_unknown_scope_before_network():
    with ManagerClient("https://manager.example", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(lambda _: pytest.fail("Invalid scope must not request")))
        with pytest.raises(ValueError, match="scope"):
            client.delivery_inbox(scope="everything")
