import json

import httpx
from sop_sdk.client import ManagerClient


def test_portfolio_inspection_does_not_inherit_another_project_or_business():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"summary_scope": "filtered_projects"})

    with ManagerClient("https://manager.example", project_id="old", business_code="old-business", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        client.project_portfolio(status=["active", "paused"], risk=["blocked"], cursor="opaque", limit=2)
        client.project_portfolio_detail("new")
        client.delivery_project_lifecycle_preview({"target_status": "paused", "reason": "Delivery window"})
        assert client.project_id == "old" and client.business_code == "old-business"
    assert seen[0].headers["X-Project-Id"] == seen[0].headers["X-Business-Code"] == ""
    assert seen[0].url.params.get_list("status") == ["active", "paused"]
    assert seen[0].url.params["cursor"] == "opaque"
    assert seen[1].headers["X-Project-Id"] == seen[1].headers["X-Project-Code"] == "new"
    assert seen[1].headers["X-Business-Code"] == ""
    assert seen[2].headers["X-Project-Id"] == "old"
    assert json.loads(seen[2].content) == {"target_status": "paused", "reason": "Delivery window"}


def test_portfolio_invalid_filters_fail_before_network():
    import pytest

    with ManagerClient("https://manager.example", max_retries=0) as client:
        for options in ({"status": ["deleted"]}, {"risk": ["healthy"]}, {"limit": True}, {"limit": 101}):
            with pytest.raises(ValueError):
                client.project_portfolio(**options)
