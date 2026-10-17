from contextlib import contextmanager

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopForbiddenError, SopNotFoundError
from sop_sdk.security import BearerAuth


@contextmanager
def review_client(handler):
    with ManagerClient(
        "https://manager.example", auth=BearerAuth("test-only"), project_id="selected", max_retries=0
    ) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        yield client


def test_task_reviews_preserve_scope_pagination_and_historical_evidence_over_http():
    seen = []
    expected = {
        "project_id": "selected",
        "task_id": "T-one",
        "current": None,
        "reviews": [
            {
                "id": "review-old",
                "decision": "accept",
                "source": "manual",
                "invalidated": True,
                "snapshot": {"task": {"title": "Original deleted task"}},
                "evidence_content": "Human checked",
            }
        ],
        "total": 2,
        "limit": 1,
        "next_cursor": "review-old",
    }

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json=expected)

    with review_client(handle) as client:
        assert client.delivery_task_reviews("T-one", limit=1, cursor="review-new") == expected
    assert len(seen) == 1
    request = seen[0]
    assert request.method == "GET" and request.url.path == "/api/v1/delivery/tasks/T-one/reviews"
    assert dict(request.url.params) == {"limit": "1", "cursor": "review-new"}
    assert request.headers["X-Project-Id"] == "selected"
    assert request.headers["Authorization"] == "Bearer test-only"


def test_task_review_default_page_does_not_invent_a_cursor_or_current_task():
    seen = []
    with review_client(
        lambda request: seen.append(request) or httpx.Response(200, json={"current": None, "reviews": []})
    ) as client:
        assert client.delivery_task_reviews("T-one") == {"current": None, "reviews": []}
    assert dict(seen[0].url.params) == {"limit": "20"}


@pytest.mark.parametrize(
    "options", [{"limit": 0}, {"limit": 101}, {"limit": True}, {"limit": 1.5}, {"cursor": "../other"}]
)
def test_invalid_review_page_fails_before_transport(options):
    with review_client(lambda _: pytest.fail("Invalid page must not request")) as client:
        with pytest.raises(ValueError):
            client.delivery_task_reviews("T-one", **options)


@pytest.mark.parametrize("task_id", ["../other", "T-one/reviews", "T-one?project=other"])
def test_task_review_id_cannot_change_the_path(task_id):
    with review_client(lambda _: pytest.fail("Invalid ID must not request")) as client:
        with pytest.raises(ValueError):
            client.delivery_task_reviews(task_id)


@pytest.mark.parametrize("status,error", [(403, SopForbiddenError), (404, SopNotFoundError)])
def test_review_access_failures_are_not_synthetic_acceptance(status, error):
    with review_client(lambda _: httpx.Response(status, json={"detail": "Review inaccessible"})) as client:
        with pytest.raises(error):
            client.delivery_task_reviews("T-one")
