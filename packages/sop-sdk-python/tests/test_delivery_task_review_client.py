from contextlib import contextmanager

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError, SopForbiddenError, SopNotFoundError
from sop_sdk.security import BearerAuth


@contextmanager
def review_client(handler):
    with ManagerClient(
        "https://manager.example", auth=BearerAuth("test-only"), project_id="selected", max_retries=0
    ) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        yield client


def test_task_reviews_preserve_small_catalogue_and_opaque_cursor_over_http():
    seen = []
    expected = {
        "project_id": "selected",
        "task_id": "T-one",
        "as_of": "2026-10-18T00:00:00Z",
        "reviews": [
            {
                "id": "review-old",
                "decision": "accept",
                "source": "manual",
                "invalidated": True,
                "task_id": "T-one",
                "created_at": "2026-10-17T00:00:00Z",
                "reviewer": {"id": "user-one", "name": "Reviewer"},
                "task_basis": "a" * 64,
                "comment_summary": "Human checked",
                "has_evidence": True,
                "invalidated_at": "2026-10-18T00:00:00Z",
                "invalidated_reason": "task_changed",
            }
        ],
        "total": 2,
        "limit": 1,
        "next_cursor": "signed-next-window",
    }

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json=expected)

    with review_client(handle) as client:
        assert client.delivery_task_reviews("T-one", limit=1, cursor="opaque/+?=:window") == expected
    assert len(seen) == 1
    request = seen[0]
    assert request.method == "GET" and request.url.path == "/api/v1/delivery/tasks/T-one/reviews"
    assert dict(request.url.params) == {"limit": "1", "cursor": "opaque/+?=:window"}
    assert request.headers["X-Project-Id"] == "selected"
    assert request.headers["Authorization"] == "Bearer test-only"


def test_task_review_default_page_does_not_invent_a_cursor_or_current_task():
    seen = []
    with review_client(
        lambda request: seen.append(request) or httpx.Response(200, json={"reviews": [], "total": 0})
    ) as client:
        assert client.delivery_task_reviews("T-one") == {"reviews": [], "total": 0}
    assert dict(seen[0].url.params) == {"limit": "20"}


@pytest.mark.parametrize(
    "options",
    [
        {"limit": 0}, {"limit": 101}, {"limit": True}, {"limit": 1.5},
        {"cursor": "x" * 4001}, {"cursor": None}, {"cursor": 42}, {"cursor": False},
        {"cursor": "bad\nwindow"}, {"cursor": "bad\x00window"},
        {"cursor": "bad\x7fwindow"}, {"cursor": "bad\x85window"},
    ],
)
def test_invalid_review_page_fails_before_transport(options):
    with review_client(lambda _: pytest.fail("Invalid page must not request")) as client:
        with pytest.raises(ValueError):
            client.delivery_task_reviews("T-one", **options)


@pytest.mark.parametrize("task_id", ["../other", "T-one/reviews", "T-one?project=other"])
@pytest.mark.parametrize("method", ["delivery_task_reviews", "delivery_task_review_current", "delivery_task_review"])
def test_task_review_id_cannot_change_the_path(task_id, method):
    with review_client(lambda _: pytest.fail("Invalid ID must not request")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)(task_id, *(["review-one"] if method == "delivery_task_review" else []))


@pytest.mark.parametrize("cursor", ["../other", "x" * 4000])
def test_review_cursor_is_query_data_with_its_full_server_limit(cursor):
    seen = []
    with review_client(lambda request: seen.append(request) or httpx.Response(200, json={"reviews": []})) as client:
        client.delivery_task_reviews("T-one", cursor=cursor)
    assert seen[0].url.path == "/api/v1/delivery/tasks/T-one/reviews"
    assert seen[0].url.params["cursor"] == cursor


def test_review_current_is_a_separate_exact_read_with_current_generation():
    seen = []
    expected = {
        "project_id": "selected", "task_id": "T-one", "version": 9,
        "query_generation": 4, "as_of": "2026-10-18T00:00:00Z",
        "current": {"basis": "a" * 64, "eligible": True},
        "effective_review_id": "review-one",
    }
    with review_client(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        assert client.delivery_task_review_current("T-one") == expected
    assert len(seen) == 1
    assert seen[0].method == "GET"
    assert seen[0].url.path == "/api/v1/delivery/tasks/T-one/review-current"
    assert not seen[0].url.params
    assert seen[0].headers["X-Project-Id"] == "selected"
    assert seen[0].headers["Authorization"] == "Bearer test-only"


def test_review_original_preserves_frozen_body_without_requesting_current_proof():
    seen = []
    expected = {
        "project_id": "selected", "task_id": "T-deleted", "as_of": "2026-10-18T00:00:00Z",
        "review": {"id": "review-old", "decision": "accept", "invalidated": True,
                   "snapshot": {"task": {"title": "Original deleted task"}},
                   "comment": "Full original comment", "evidence_content": "Human checked"},
    }
    with review_client(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        assert client.delivery_task_review("T-deleted", "review-old") == expected
    assert len(seen) == 1
    assert seen[0].method == "GET"
    assert seen[0].url.path == "/api/v1/delivery/tasks/T-deleted/reviews/review-old"
    assert not seen[0].url.params
    assert seen[0].headers["X-Project-Id"] == "selected"


@pytest.mark.parametrize("review_id", ["", "../other", "review/other", "review?task=other"])
def test_original_review_id_cannot_change_the_path(review_id):
    with review_client(lambda _: pytest.fail("Invalid review ID must not request")) as client:
        with pytest.raises(ValueError):
            client.delivery_task_review("T-one", review_id)


@pytest.mark.parametrize("status,error", [(403, SopForbiddenError), (404, SopNotFoundError), (409, SopConflictError)])
@pytest.mark.parametrize("method", ["delivery_task_reviews", "delivery_task_review_current", "delivery_task_review"])
def test_review_access_failures_are_not_synthetic_acceptance(status, error, method):
    with review_client(lambda _: httpx.Response(status, json={"detail": "Review inaccessible"})) as client:
        with pytest.raises(error):
            getattr(client, method)("T-one", *(["review-one"] if method == "delivery_task_review" else []))
