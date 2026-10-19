"""Origin reads keep one explicit issue, fixed page and current identity."""

from contextlib import contextmanager

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError, SopForbiddenError, SopNotFoundError
from sop_sdk.security import BearerAuth


@contextmanager
def origin_client(handler):
    with ManagerClient(
        "https://manager.example", auth=BearerAuth("test-only"), project_id="selected", max_retries=0
    ) as client:
        client._client.close()
        client._client = httpx.Client(base_url=client.base_url, transport=httpx.MockTransport(handler))
        yield client


def test_issue_origins_preserve_bounded_page_and_opaque_cursor_without_following_next():
    seen = []
    expected = {
        "project_id": "selected", "issue_id": "ISS-one", "issue_available": True,
        "as_of": "2026-10-19T00:00:00Z", "items": [{"id": "origin-old", "operation": "update"}],
        "total": 500, "limit": 1, "next_cursor": "signed-next-window",
    }
    with origin_client(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        assert client.delivery_issue_origins("ISS-one", limit=1, cursor="opaque/+?=:window") == expected
    assert len(seen) == 1
    assert seen[0].method == "GET"
    assert seen[0].url.path == "/api/v1/delivery/issues/ISS-one/origins"
    assert dict(seen[0].url.params) == {"limit": "1", "cursor": "opaque/+?=:window"}
    assert seen[0].headers["X-Project-Id"] == "selected"
    assert seen[0].headers["Authorization"] == "Bearer test-only"


def test_default_origins_page_and_exact_deleted_issue_are_separate_reads():
    seen = []
    expected = {"issue_id": "ISS-deleted", "issue_available": False, "origin": {"id": "origin-old"}}
    with origin_client(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        client.delivery_issue_origins("ISS-one")
        assert client.delivery_issue_origin("ISS-deleted", "origin-old") == expected
    assert [request.url.path for request in seen] == [
        "/api/v1/delivery/issues/ISS-one/origins",
        "/api/v1/delivery/issues/ISS-deleted/origins/origin-old",
    ]
    assert dict(seen[0].url.params) == {"limit": "20"}
    assert not seen[1].url.params
    assert all(request.method == "GET" and request.content == b"" for request in seen)


@pytest.mark.parametrize("options", [
    {"limit": 0}, {"limit": 101}, {"limit": True}, {"limit": 1.5},
    {"cursor": "x" * 4001}, {"cursor": None}, {"cursor": 42}, {"cursor": False},
    {"cursor": "bad\nwindow"}, {"cursor": "bad\x00window"},
    {"cursor": "bad\x7fwindow"}, {"cursor": "bad\x85window"},
])
def test_invalid_origin_page_is_rejected_before_transport(options):
    with origin_client(lambda _: pytest.fail("Invalid page reached transport")) as client:
        with pytest.raises(ValueError):
            client.delivery_issue_origins("ISS-one", **options)


@pytest.mark.parametrize("value", ["", "../other", "ISS-one/origins", "ISS?project=other"])
@pytest.mark.parametrize("method", ["delivery_issue_origins", "delivery_issue_origin"])
def test_origin_issue_id_cannot_change_path(value, method):
    with origin_client(lambda _: pytest.fail("Invalid ID reached transport")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)(value, *(["origin-one"] if method == "delivery_issue_origin" else []))


@pytest.mark.parametrize("value", ["", "../other", "origin/other", "origin?project=other"])
def test_exact_origin_id_cannot_change_path(value):
    with origin_client(lambda _: pytest.fail("Invalid origin reached transport")) as client:
        with pytest.raises(ValueError):
            client.delivery_issue_origin("ISS-one", value)


@pytest.mark.parametrize("cursor", ["../other", "x" * 4000])
def test_origin_cursor_is_query_data_up_to_its_server_limit(cursor):
    seen = []
    with origin_client(lambda request: seen.append(request) or httpx.Response(200, json={})) as client:
        client.delivery_issue_origins("ISS-one", cursor=cursor, limit=100)
    assert seen[0].url.path == "/api/v1/delivery/issues/ISS-one/origins"
    assert seen[0].url.params["cursor"] == cursor and seen[0].url.params["limit"] == "100"


@pytest.mark.parametrize("status,error", [(403, SopForbiddenError), (404, SopNotFoundError), (409, SopConflictError)])
@pytest.mark.parametrize("exact", [False, True])
def test_origin_errors_never_fallback_rebuild_or_choose_another_origin(status, error, exact):
    seen = []
    with origin_client(
        lambda request: seen.append(request) or httpx.Response(status, json={"detail": "Original inaccessible"})
    ) as client:
        with pytest.raises(error):
            if exact:
                client.delivery_issue_origin("ISS-one", "origin-old")
            else:
                client.delivery_issue_origins("ISS-one", cursor="original-window")
    assert len(seen) == 1 and seen[0].method == "GET"


def test_issue_event_source_filter_is_forwarded_as_explicit_query():
    seen = []
    with origin_client(lambda request: seen.append(request) or httpx.Response(200, json={"items": []})) as client:
        client.delivery_issues(source="event", task_id="T-one", limit=5)
    assert len(seen) == 1
    assert dict(seen[0].url.params) == {"source": "event", "task_id": "T-one", "limit": "5"}
