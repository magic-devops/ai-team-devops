"""Actual SDK transport definitions for bounded, read-only control recovery."""

from contextlib import contextmanager

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError, SopForbiddenError, SopNotFoundError


@contextmanager
def controls_client(handler):
    with ManagerClient("https://manager.example", project_id="selected", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(base_url=client.base_url, transport=httpx.MockTransport(handler))
        yield client


@pytest.mark.parametrize("operation_id", ["", "C-one"])
def test_control_reads_use_exact_execution_project_and_one_page(operation_id):
    seen = []
    expected = {"project_id": "selected", "execution_id": "E-one", "items": [], "next_cursor": "next-window"}
    with controls_client(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        actual = client.delivery_execution_control("E-one", operation_id) if operation_id else client.delivery_execution_controls("E-one")
    assert actual == expected and len(seen) == 1
    request = seen[0]
    assert request.method == "GET" and request.content == b"" and request.headers["X-Project-Id"] == "selected"
    assert request.url.path == "/api/v1/delivery/executions/E-one/control-operations" + ("/C-one" if operation_id else "")
    assert dict(request.url.params) == ({} if operation_id else {"limit": "20"})


def test_control_page_preserves_opaque_cursor_without_following_it():
    seen = []
    with controls_client(lambda request: seen.append(request) or httpx.Response(200, json={"next_cursor": "another"})) as client:
        client.delivery_execution_controls("E-one", limit=1, cursor="opaque/+?=:window")
    assert len(seen) == 1 and dict(seen[0].url.params) == {"limit": "1", "cursor": "opaque/+?=:window"}


@pytest.mark.parametrize("options", [{"limit": 0}, {"limit": 101}, {"limit": True}, {"limit": 1.5},
    {"cursor": None}, {"cursor": "x" * 4001}, {"cursor": "bad\nvalue"}, {"cursor": "bad\x7fvalue"}, {"cursor": "bad\x85value"}])
def test_invalid_control_page_never_reaches_transport(options):
    with controls_client(lambda _: pytest.fail("Invalid control page reached transport")) as client:
        with pytest.raises(ValueError):
            client.delivery_execution_controls("E-one", **options)


@pytest.mark.parametrize("identity", ["", "../other", "one/other", "one?project=other", "x" * 65])
@pytest.mark.parametrize("target", ["execution", "operation"])
def test_control_read_identity_cannot_change_path(identity, target):
    with controls_client(lambda _: pytest.fail("Invalid control identity reached transport")) as client:
        with pytest.raises(ValueError):
            client.delivery_execution_control(identity if target == "execution" else "E-one", identity if target == "operation" else "C-one")


@pytest.mark.parametrize("exact", [False, True])
@pytest.mark.parametrize("status,error", [(403, SopForbiddenError), (404, SopNotFoundError), (409, SopConflictError)])
def test_control_read_errors_do_not_rebuild_retry_write_or_choose_another_target(exact, status, error):
    seen = []
    with controls_client(lambda request: seen.append(request) or httpx.Response(status, json={"detail": "Control unavailable"})) as client:
        with pytest.raises(error):
            client.delivery_execution_control("E-one", "C-one") if exact else client.delivery_execution_controls("E-one")
    assert len(seen) == 1 and seen[0].method == "GET"
