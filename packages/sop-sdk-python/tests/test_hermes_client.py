from __future__ import annotations

import json

import httpx
import pytest
from sop_sdk import HermesClient
from sop_sdk.errors import HermesContractError, HermesUnavailableError


def _token() -> str:
    return "token-1"


def _envelope(items=None, summary=None):
    return {
        "ok": True,
        "scope": {"workspace_id": "ws-1"},
        "summary": summary or {},
        "items": [] if items is None else items,
        "actions": [],
        "permissions": ["read"],
        "audit": {},
        "trace_id": "trace-1",
    }


def test_list_resource_uses_v1_bearer_workspace_and_query():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("Authorization")
        seen["workspace"] = request.headers.get("X-Workspace-Id")
        return httpx.Response(200, json=_envelope())

    client = HermesClient(
        "https://hermes.example",
        token=_token(),
        workspace_id="ws-1",
        transport=httpx.MockTransport(handler),
    )

    payload = client.list_resource("runs", q="build", status="ready", kind="command", limit=7, cursor="abc")

    assert payload["ok"] is True
    assert seen == {
        "url": "https://hermes.example/api/hermes/v1/runs?q=build&status=ready&kind=command&limit=7&cursor=abc",
        "authorization": "Bearer token-1",
        "workspace": "ws-1",
    }


def test_health_is_unauthenticated():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("Authorization")
        return httpx.Response(200, json={"ok": True, "service": "hermes-core", "version": "1.0.0"})

    client = HermesClient("https://hermes.example/api/hermes/v1", token=_token(), transport=httpx.MockTransport(handler))

    client.health()

    assert seen["authorization"] is None


def test_diagnostics_preserves_degraded_checks_for_clients():
    def handler(request):
        assert request.url.path == "/api/hermes/v1/system/diagnostics"
        assert request.headers["Authorization"] == "Bearer token-1"
        return httpx.Response(200, json={**_envelope([{"id": "executor", "status": "failed"}]), "ok": False})

    with HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler)) as client:
        result = client.system_diagnostics()
        assert result["ok"] is False
        assert result["items"][0]["id"] == "executor"


def test_create_patch_and_run_action_bodies_match_contract():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path, json.loads(request.content or b"{}")))
        return httpx.Response(200, json=_envelope())

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    client.create_resource("assets", {"title": "KB", "kind": "knowledge"}, idempotency_key="idem-create")
    client.patch_resource("assets", "asset-1", {"title": "KB2"}, expected_version=3, idempotency_key="idem-patch")
    client.run_action("run-1", "start", expected_version=5, idempotency_key="idem-run")

    assert requests == [
        ("POST", "/api/hermes/v1/assets", {"data": {"title": "KB", "kind": "knowledge"}, "idempotency_key": "idem-create"}),
        (
            "PATCH",
            "/api/hermes/v1/assets/asset-1",
            {"data": {"title": "KB2"}, "idempotency_key": "idem-patch", "expected_version": 3},
        ),
        (
            "POST",
            "/api/hermes/v1/runs/run-1/start",
            {"idempotency_key": "idem-run", "expected_version": 5, "dry_run": True},
        ),
    ]


def test_iter_resource_follows_summary_next_cursor():
    cursors = []

    def handler(request: httpx.Request) -> httpx.Response:
        cursor = request.url.params.get("cursor", "")
        cursors.append(cursor)
        if cursor == "":
            return httpx.Response(200, json=_envelope([{"id": "a"}], {"next_cursor": "n2"}))
        return httpx.Response(200, json=_envelope([{"id": "b"}], {"next_cursor": ""}))

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    assert list(client.iter_resource("tasks", limit=1)) == [{"id": "a"}, {"id": "b"}]
    assert cursors == ["", "n2"]


def test_contract_requires_items_array():
    client = HermesClient(
        "https://hermes.example",
        token=_token(),
        transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={**_envelope(), "items": {}})),
    )

    with pytest.raises(HermesContractError):
        client.actions()


def test_unavailable_core_is_explicit_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client = HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler))

    with pytest.raises(HermesUnavailableError):
        client.actions()


def test_delete_approval_and_export_are_versioned_dry_runs():
    requests = []

    def handler(request):
        requests.append((request.method, request.url.path, json.loads(request.content)))
        return httpx.Response(200, json=_envelope())

    with HermesClient("https://hermes.example", token=_token(), transport=httpx.MockTransport(handler)) as client:
        client.delete_resource("assets", "a", expected_version=2, idempotency_key="delete-key")
        client.approval_decision("p", decision="approve", expected_version=3, idempotency_key="approval-key")
        client.run_action("r", "export", expected_version=4, idempotency_key="export-key")
    assert requests == [
        ("DELETE", "/api/hermes/v1/assets/a", {"expected_version": 2, "dry_run": True, "idempotency_key": "delete-key"}),
        ("POST", "/api/hermes/v1/approvals/p/decision", {"decision": "approve", "expected_version": 3,
                                               "dry_run": True, "idempotency_key": "approval-key"}),
        ("POST", "/api/hermes/v1/runs/r/export", {"expected_version": 4, "dry_run": True, "idempotency_key": "export-key"}),
    ]


@pytest.mark.parametrize("url", ["http://remote.example", "https://user:secret@example.org", "file:///tmp/a", "https://example.org/#token"])
def test_remote_credentials_require_safe_https_url(url):
    with pytest.raises(ValueError):
        HermesClient(url, token=_token())
