"""Attention reads preserve server pagination, evidence gaps and project scope."""

from contextlib import contextmanager

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError, SopForbiddenError
from sop_sdk.security import BearerAuth


@contextmanager
def attention_client(handler):
    with ManagerClient(
        "https://manager.example", auth=BearerAuth("test-only"), project_id="selected", max_retries=0
    ) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        yield client


@pytest.mark.parametrize("category", ["all", "work", "approval", "acceptance", "blocked", "overdue"])
def test_inbox_sends_bounded_category_selection_and_preserves_server_projection(category):
    seen = []
    expected = {
        "project_id": "selected",
        "version": 8,
        "query_generation": 12,
        "scope": "team",
        "category": category,
        "counts": {"total": 200, "blocked": 31},
        "total": 31,
        "limit": 7,
        "has_more": True,
        "next_cursor": "next-fixed",
        "items": [{"id": "task:T-one", "status": "recorded_completed", "categories": ["blocked", "acceptance"]}],
    }
    with attention_client(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        result = client.delivery_inbox(scope="team", category=category, limit=7, cursor="original-fixed")
    assert result == expected
    assert len(seen) == 1
    request = seen[0]
    assert request.method == "GET" and request.url.path == "/api/v1/delivery/inbox"
    assert dict(request.url.params) == {"scope": "team", "category": category, "limit": "7", "cursor": "original-fixed"}
    assert request.headers["X-Project-Id"] == "selected" and request.headers["Authorization"] == "Bearer test-only"


def test_inbox_defaults_to_the_first_twenty_items_without_loading_more_pages():
    seen = []
    with attention_client(
        lambda request: (
            seen.append(request)
            or httpx.Response(200, json={"items": [], "total": 200, "has_more": True, "next_cursor": "next"})
        )
    ) as client:
        client.delivery_inbox()
    assert len(seen) == 1
    assert dict(seen[0].url.params) == {"scope": "mine", "category": "all", "limit": "20"}


@pytest.mark.parametrize("category,kind,selection", [
    ("acceptance", "external", {"submission_id": "S-fixed", "work_order_id": None}),
    ("blocked", None, {"submission_id": None, "work_order_id": "W-held"}),
])
def test_external_attention_preserves_exact_targets_without_opening_protected_originals(category, kind, selection):
    seen = []
    item = {"id": "task:T", "kind": "task", "resource_id": "T", "acceptance_kind": kind,
            "categories": [category], "target": {"view": "list", "requirement_id": "R", "detail": "tasks", "task_id": "T", **selection}}
    expected = {"project_id": "selected", "scope": "mine", "category": category, "items": [item],
                "total": 1, "limit": 20, "has_more": False, "next_cursor": None}
    with attention_client(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        assert client.delivery_inbox(category=category) == expected
    assert len(seen) == 1 and seen[0].method == "GET"
    assert seen[0].url.path == "/api/v1/delivery/inbox"
    assert seen[0].headers["X-Project-Id"] == "selected"


@pytest.mark.parametrize(
    "options",
    [
        {"scope": "all"},
        {"category": "all-work"},
        {"limit": 0},
        {"limit": 101},
        {"limit": True},
        {"limit": "20"},
        {"cursor": "bad\nvalue"},
        {"cursor": "a" * 4001},
        {"cursor": None},
    ],
)
def test_inbox_invalid_selection_never_reaches_http(options):
    with attention_client(lambda _: pytest.fail("Invalid selection must not request")) as client:
        with pytest.raises(ValueError):
            client.delivery_inbox(**options)


def test_inbox_stale_cursor_is_not_silently_restarted_or_exported():
    seen = []
    with attention_client(
        lambda request: (
            seen.append(request) or httpx.Response(409, json={"detail": {"code": "delivery_query_cursor_stale"}})
        )
    ) as client:
        with pytest.raises(SopConflictError):
            client.delivery_inbox(scope="team", category="overdue", limit=3, cursor="stale-fixed")
    assert len(seen) == 1 and seen[0].url.path == "/api/v1/delivery/inbox"
    assert seen[0].url.params["cursor"] == "stale-fixed"


def test_progress_summary_is_a_scoped_get_with_unmodified_current_metrics_and_missing_coverage():
    seen = []
    expected = {
        "project_id": "selected",
        "version": 8,
        "query_generation": 12,
        "as_of": "2026-10-18T01:00:00Z",
        "timezone": "UTC",
        "range": {"starts_on": "2026-10-15", "ends_on": "2026-10-19"},
        "current": {"metrics": {"tasks_total": 3, "recorded_completed": 1, "verified_completed": 0}},
        "coverage": {
            "first_observed_at": "2026-10-16T00:00:00Z",
            "last_observed_at": "2026-10-16T00:00:00Z",
            "observed_days": ["2026-10-16"],
            "missing_days": ["2026-10-15", "2026-10-17", "2026-10-18"],
            "future_days": ["2026-10-19"],
        },
    }
    with attention_client(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        result = client.delivery_progress_summary(starts_on="2026-10-15", ends_on="2026-10-19")
    assert result == expected
    assert len(seen) == 1
    request = seen[0]
    assert request.method == "GET" and request.url.path == "/api/v1/delivery/progress/summary"
    assert dict(request.url.params) == {"starts_on": "2026-10-15", "ends_on": "2026-10-19"}
    assert request.headers["X-Project-Id"] == "selected" and request.headers["Authorization"] == "Bearer test-only"


def test_progress_summary_default_dates_are_left_to_the_server_and_forbidden_stays_forbidden():
    seen = []
    with attention_client(
        lambda request: seen.append(request) or httpx.Response(403, json={"detail": "Project access denied"})
    ) as client:
        with pytest.raises(SopForbiddenError):
            client.delivery_progress_summary()
    assert len(seen) == 1 and dict(seen[0].url.params) == {}


@pytest.mark.parametrize(
    "options",
    [
        {"starts_on": "2026-02-30"},
        {"ends_on": "20261018"},
        {"starts_on": "2026-10-19", "ends_on": "2026-10-18"},
        {"starts_on": "2025-01-01", "ends_on": "2026-10-18"},
    ],
)
def test_progress_summary_invalid_dates_never_reach_http(options):
    with attention_client(lambda _: pytest.fail("Invalid summary dates must not request")) as client:
        with pytest.raises(ValueError):
            client.delivery_progress_summary(**options)
