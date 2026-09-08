"""
@module: sop_sdk.hermes
@purpose: Hermes v5 /api/v2 HTTP client with explicit auth, workspace scope, and wire-contract checks.
@stable: HermesClient public methods mirror the frozen v5 contract.
"""
from __future__ import annotations

import json
import os
import uuid
from urllib.parse import urlsplit
from collections.abc import Iterator, Mapping
from typing import Any

import httpx

from .errors import (
    HermesContractError,
    HermesUnavailableError,
    SopAuthError,
    SopConflictError,
    SopForbiddenError,
    SopNotFoundError,
    SopServerError,
    SopTransportError,
)

_DEFAULT_HEADERS = {"Accept": "application/json", "User-Agent": "sop-sdk-hermes/5.0"}
_LIST_RESOURCES = {
    "sessions",
    "runs",
    "assets",
    "devices",
    "tasks",
    "requirements",
    "schedules",
    "artifacts",
}
_DELETE_RESOURCES = {"assets", "devices", "schedules"}
_RUN_ACTIONS = {"start", "cancel", "retry", "replay", "export"}


class HermesClient:
    """Synchronous authorized Hermes v5 client.

    `base_url` may point either at the server root or directly at `/api/v2`.
    Non-health calls require a Bearer token and send `X-Workspace-Id` when set.
    """

    def __init__(
        self,
        base_url: str,
        *,
        token: str,
        workspace_id: str = "",
        timeout: float = 30,
        verify: bool = True,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        clean_base = (base_url or "").rstrip("/")
        if not clean_base:
            raise ValueError("HermesClient: base_url is required")
        url = urlsplit(clean_base)
        if (url.scheme not in {"http", "https"} or not url.hostname or url.username
                or url.password or url.query or url.fragment):
            raise ValueError("HermesClient: URL must be an HTTP(S) origin without credentials, query or fragment")
        if url.scheme == "http" and url.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("HermesClient: remote connections require HTTPS")
        self.base_url = clean_base if clean_base.endswith("/api/v2") else f"{clean_base}/api/v2"
        self.token = (token or "").strip()
        self.workspace_id = (workspace_id or "").strip()
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            verify=verify,
            headers=_DEFAULT_HEADERS,
            follow_redirects=False,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> HermesClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> HermesClient:
        env = env if env is not None else os.environ
        return cls(
            env.get("HERMES_URL", ""),
            token=env.get("HERMES_TOKEN", ""),
            workspace_id=env.get("HERMES_WORKSPACE", ""),
        )

    def _headers(self, *, auth_required: bool) -> dict[str, str]:
        headers: dict[str, str] = {}
        if auth_required:
            if not self.token:
                raise SopAuthError("Hermes token is required; set HERMES_TOKEN or pass token explicitly")
            headers["Authorization"] = f"Bearer {self.token}"
        if self.workspace_id:
            headers["X-Workspace-Id"] = self.workspace_id
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        body: Mapping[str, Any] | None = None,
        auth_required: bool = True,
    ) -> dict[str, Any]:
        url_path = path if path.startswith("/") else f"/{path}"
        content = None
        headers = self._headers(auth_required=auth_required)
        if body is not None:
            content = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        try:
            response = self._client.request(method, url_path, params=params, content=content, headers=headers)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout) as e:
            raise HermesUnavailableError(f"Hermes core unavailable: {e}") from e
        except httpx.HTTPError as e:
            raise SopTransportError(f"Hermes transport error: {e}") from e
        self._raise_for_status(response)
        if not response.content:
            raise HermesContractError("Hermes response body is empty", status=response.status_code)
        try:
            payload = response.json()
        except ValueError as e:
            raise HermesContractError("Hermes response body is not valid JSON", status=response.status_code) from e
        if path == "/health" and not auth_required:
            if not isinstance(payload, dict) or not isinstance(payload.get("ok"), bool):
                raise HermesContractError("Invalid Hermes health response", status=response.status_code)
            return payload
        return self._validate_envelope(payload, status=response.status_code)

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.is_success:
            return
        try:
            payload = response.json()
        except Exception:
            payload = {"error": {"message": response.text}}
        error = payload.get("error") if isinstance(payload, dict) else None
        msg = ""
        if isinstance(error, Mapping):
            msg = str(error.get("message") or error.get("code") or "")
        if not msg and isinstance(payload, dict):
            msg = str(payload.get("detail") or payload.get("title") or "")
        msg = msg or response.text or "Hermes request failed"
        code = response.status_code
        if code == 401:
            raise SopAuthError(msg, status=code, detail=payload)
        if code == 403:
            raise SopForbiddenError(msg, status=code, detail=payload)
        if code == 404:
            raise SopNotFoundError(msg, status=code, detail=payload)
        if code == 409:
            raise SopConflictError(msg, status=code, detail=payload)
        if 500 <= code < 600:
            raise SopServerError(msg, status=code, detail=payload)
        raise SopTransportError(msg, status=code, detail=payload)

    @staticmethod
    def _validate_envelope(payload: Any, *, status: int) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise HermesContractError("Hermes response envelope must be an object", status=status, detail=payload)
        if not isinstance(payload.get("ok"), bool):
            raise HermesContractError("Hermes response envelope missing ok", status=status, detail=payload)
        items = payload.get("items")
        if not isinstance(items, list):
            raise HermesContractError("Hermes response envelope items must be an array", status=status, detail=payload)
        return payload

    @staticmethod
    def new_idempotency_key(prefix: str = "sop-cli") -> str:
        return f"{prefix}-{uuid.uuid4().hex}"

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/health", auth_required=False)

    def actions(self) -> dict[str, Any]:
        return self._request("GET", "/actions")

    def system_readiness(self) -> dict[str, Any]:
        return self._request("GET", "/system/readiness")

    def sync(self, *, after: int = 0) -> dict[str, Any]:
        return self._request("GET", "/sync", params={"after": after})

    def approvals(self) -> dict[str, Any]:
        return self._request("GET", "/approvals")

    def approval_decision(
        self,
        approval_id: str,
        *,
        decision: str,
        expected_version: int,
        idempotency_key: str | None = None,
        dry_run: bool = True,
    ) -> dict[str, Any]:
        if decision not in {"approve", "reject"}:
            raise ValueError("decision must be approve or reject")
        return self._request(
            "POST",
            f"/approvals/{approval_id}/decision",
            body={
                "decision": decision,
                "dry_run": dry_run,
                "expected_version": expected_version,
                "idempotency_key": idempotency_key or self.new_idempotency_key("hermes-approval"),
            },
        )

    def list_workspaces(self) -> dict[str, Any]:
        return self._request("GET", "/workspaces")

    def create_workspace(self, data: Mapping[str, Any], *, idempotency_key: str | None = None) -> dict[str, Any]:
        return self._request("POST", "/workspaces", body=self._mutation_body(data, idempotency_key=idempotency_key))

    def list_resource(
        self,
        resource: str,
        *,
        q: str = "",
        status: str = "",
        kind: str = "",
        limit: int = 50,
        cursor: str = "",
    ) -> dict[str, Any]:
        self._ensure_list_resource(resource)
        return self._request(
            "GET",
            f"/{resource}",
            params={"q": q, "status": status, "kind": kind, "limit": limit, "cursor": cursor},
        )

    def iter_resource(self, resource: str, **query: Any) -> Iterator[dict[str, Any]]:
        cursor = str(query.pop("cursor", "") or "")
        while True:
            payload = self.list_resource(resource, cursor=cursor, **query)
            yield from payload["items"]
            next_cursor = ""
            summary = payload.get("summary")
            if isinstance(summary, Mapping):
                next_cursor = str(summary.get("next_cursor") or summary.get("cursor") or "")
            if not next_cursor or next_cursor == cursor:
                break
            cursor = next_cursor

    def create_resource(
        self,
        resource: str,
        data: Mapping[str, Any],
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        self._ensure_list_resource(resource)
        if resource == "artifacts":
            raise ValueError("Artifacts are created by run export")
        return self._request("POST", f"/{resource}", body=self._mutation_body(data, idempotency_key=idempotency_key))

    def get_resource(self, resource: str, entity_id: str) -> dict[str, Any]:
        self._ensure_list_resource(resource)
        return self._request("GET", f"/{resource}/{entity_id}")

    def patch_resource(
        self,
        resource: str,
        entity_id: str,
        data: Mapping[str, Any],
        *,
        expected_version: int,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        self._ensure_list_resource(resource)
        if resource in {"artifacts", "devices"}:
            raise ValueError(f"{resource} cannot be patched")
        return self._request(
            "PATCH",
            f"/{resource}/{entity_id}",
            body=self._mutation_body(data, idempotency_key=idempotency_key, expected_version=expected_version),
        )

    def delete_resource(
        self, resource: str, entity_id: str, *, expected_version: int,
        dry_run: bool = True, idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        if resource not in _DELETE_RESOURCES:
            raise ValueError(f"DELETE is only supported for {', '.join(sorted(_DELETE_RESOURCES))}")
        return self._request("DELETE", f"/{resource}/{entity_id}", body={
            "expected_version": expected_version, "dry_run": dry_run,
            "idempotency_key": idempotency_key or self.new_idempotency_key("hermes-delete"),
        })

    def run_events(self, run_id: str, *, after: int = 0) -> dict[str, Any]:
        return self._request("GET", f"/runs/{run_id}/events", params={"after": after})

    def run_action(
        self,
        run_id: str,
        action: str,
        *,
        expected_version: int,
        dry_run: bool = True,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        if action not in _RUN_ACTIONS:
            raise ValueError(f"run action must be one of {', '.join(sorted(_RUN_ACTIONS))}")
        return self._request(
            "POST",
            f"/runs/{run_id}/{action}",
            body={
                "idempotency_key": idempotency_key or self.new_idempotency_key(f"hermes-run-{action}"),
                "expected_version": expected_version,
                "dry_run": dry_run,
            },
        )

    @staticmethod
    def _mutation_body(
        data: Mapping[str, Any],
        *,
        idempotency_key: str | None,
        expected_version: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "data": dict(data),
            "idempotency_key": idempotency_key or HermesClient.new_idempotency_key("hermes"),
        }
        if expected_version is not None:
            body["expected_version"] = expected_version
        return body

    @staticmethod
    def _ensure_list_resource(resource: str) -> None:
        if resource not in _LIST_RESOURCES:
            raise ValueError(f"resource must be one of {', '.join(sorted(_LIST_RESOURCES))}")
