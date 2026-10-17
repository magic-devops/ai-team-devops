"""Bounded project reads never substitute a full workspace export."""

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError


def test_query_methods_keep_exact_selection_scope_and_generation_conflict():
    seen = []
    with ManagerClient("https://manager.test", project_id="selected", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(
            base_url=client.base_url,
            transport=httpx.MockTransport(
                lambda request: (
                    seen.append(request) or httpx.Response(200, json={"total": 200, "query_generation": 9})
                )
            ),
        )
        client.delivery_context()
        client.delivery_requirements(q="Design", stage="design", cursor="fixed", limit=7, sort="title_asc")
        client.delivery_requirement("REQ-one")
        client.delivery_tasks(requirement_id="REQ-one", status="verified_completed", limit=5)
        client.delivery_task("T-late")
        client.delivery_issues(task_id="T-late", severity="P0")
        client.delivery_execution("execution-one")
        client.delivery_references("member", ids=["user:one"], limit=3)
        client.delivery_references("execution", sort="created_desc")
        client.delivery_query_rebuild()
    assert [r.url.path for r in seen] == [
        "/api/v1/delivery/context",
        "/api/v1/delivery/requirements",
        "/api/v1/delivery/requirements/REQ-one",
        "/api/v1/delivery/tasks",
        "/api/v1/delivery/tasks/T-late",
        "/api/v1/delivery/issues",
        "/api/v1/delivery/executions/execution-one",
        "/api/v1/delivery/references",
        "/api/v1/delivery/references",
        "/api/v1/delivery/query/rebuild",
    ]
    assert dict(seen[1].url.params) == {
        "q": "Design",
        "stage": "design",
        "cursor": "fixed",
        "limit": "7",
        "sort": "title_asc",
    }
    assert seen[3].url.params["status"] == "verified_completed"
    assert seen[7].url.params["ids"] == "user:one"
    assert all(r.headers["X-Project-Id"] == "selected" for r in seen)
    assert all(r.method == "GET" for r in seen[:-1]) and seen[-1].method == "POST"
    assert seen[-1].content == b""


@pytest.mark.parametrize(
    "method,options",
    [
        ("delivery_tasks", {"limit": True}),
        ("delivery_requirements", {"limit": 101}),
        ("delivery_tasks", {"status": "completed"}),
        ("delivery_requirements", {"sort": "random"}),
        ("delivery_references", {"kind": "secret"}),
        ("delivery_references", {"kind": "member", "ids": ["x"] * 101}),
        ("delivery_tasks", {"cursor": "bad\nvalue"}),
        ("delivery_requirements", {"q": "a" * 201}),
        ("delivery_references", {"kind": "member", "member_active": "false"}),
        ("delivery_issues", {"source": "invalid"}),
    ],
)
def test_invalid_query_is_rejected_before_transport(method, options):
    with ManagerClient("https://manager.test", max_retries=0) as client:
        client._request = lambda *a, **kw: pytest.fail("Invalid selection reached transport")
        with pytest.raises(ValueError):
            getattr(client, method)(**options)


def test_stale_generation_is_returned_without_rebuild_export_or_implicit_restart():
    seen = []
    with ManagerClient("https://manager.test", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(
            base_url=client.base_url,
            transport=httpx.MockTransport(
                lambda request: (
                    seen.append(request)
                    or httpx.Response(
                        409,
                        json={
                            "detail": {
                                "code": "delivery_query_cursor_stale",
                                "message": "Reload the first page",
                            }
                        },
                    )
                )
            ),
        )
        with pytest.raises(SopConflictError):
            client.delivery_requirements(cursor="original-fixed-cursor", limit=7)
    assert len(seen) == 1
    assert seen[0].url.path == "/api/v1/delivery/requirements"
    assert seen[0].url.params["cursor"] == "original-fixed-cursor"
