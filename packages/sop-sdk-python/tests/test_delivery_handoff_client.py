"""Canonical handoff reads remain bounded and carry the selected project."""
from contextlib import contextmanager

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError, SopForbiddenError, SopNotFoundError


@contextmanager
def handoff_client(handler):
    with ManagerClient("https://manager.example", project_id="selected", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(base_url=client.base_url, transport=httpx.MockTransport(handler))
        yield client


@pytest.mark.parametrize("task", [False, True])
def test_exact_handoff_and_task_page_do_not_dispatch_or_follow_next(task):
    seen = []
    expected = {"project_id": "selected", "items": [], "next_cursor": "next-window"} if task else {
        "project_id": "selected", "execution_id": "E-one", "handoff": {"state": "accepted"}}
    with handoff_client(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        actual = client.delivery_task_handoffs("T-one", limit=1, cursor="opaque/+?=:window") if task else client.delivery_execution_handoff("E-one")
        assert actual == expected
    assert len(seen) == 1 and seen[0].method == "GET" and seen[0].content == b""
    assert seen[0].headers["X-Project-Id"] == "selected"
    assert seen[0].url.path == ("/api/v1/delivery/tasks/T-one/execution-handoffs" if task else "/api/v1/delivery/executions/E-one/handoff")
    assert dict(seen[0].url.params) == ({"limit": "1", "cursor": "opaque/+?=:window"} if task else {})


def test_task_handoff_defaults_to_one_twenty_item_page():
    seen = []
    with handoff_client(lambda request: seen.append(request) or httpx.Response(200, json={})) as client:
        client.delivery_task_handoffs("T-one")
    assert len(seen) == 1 and dict(seen[0].url.params) == {"limit": "20"}


@pytest.mark.parametrize("options", [
    {"limit": 0}, {"limit": 101}, {"limit": True}, {"limit": 1.5},
    {"cursor": None}, {"cursor": "x" * 4001}, {"cursor": "bad\nvalue"},
    {"cursor": "bad\x7fvalue"}, {"cursor": "bad\x85value"},
])
def test_invalid_handoff_page_never_reaches_transport(options):
    with handoff_client(lambda _: pytest.fail("Invalid page reached transport")) as client:
        with pytest.raises(ValueError):
            client.delivery_task_handoffs("T-one", **options)


@pytest.mark.parametrize("method", ["delivery_execution_handoff", "delivery_task_handoffs"])
@pytest.mark.parametrize("identity", ["", "../other", "one/other", "one?project=other"])
def test_handoff_identity_cannot_change_the_path(method, identity):
    with handoff_client(lambda _: pytest.fail("Invalid ID reached transport")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)(identity)


@pytest.mark.parametrize("method", ["delivery_execution_handoff", "delivery_task_handoffs"])
@pytest.mark.parametrize("status,error", [(403, SopForbiddenError), (404, SopNotFoundError), (409, SopConflictError)])
def test_handoff_errors_do_not_rebuild_or_choose_another_execution(method, status, error):
    seen = []
    with handoff_client(lambda request: seen.append(request) or httpx.Response(status, json={"detail": "Inaccessible handoff"})) as client:
        with pytest.raises(error):
            getattr(client, method)("one")
    assert len(seen) == 1 and seen[0].method == "GET"
