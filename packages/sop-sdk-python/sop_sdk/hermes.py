"""
@module: sop_sdk.hermes
@purpose: Hermes /api/hermes/v1 HTTP client with explicit auth, workspace scope, and wire-contract checks.
@stable: HermesClient public methods mirror the frozen v1 contract.
"""
from __future__ import annotations

import json
import os
import uuid
from collections.abc import Iterator, Mapping
from typing import Any
from urllib.parse import quote, urlsplit

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

_DEFAULT_HEADERS = {"Accept": "application/json", "User-Agent": "sop-sdk-hermes/1.0"}
_LIST_RESOURCES = {
    "agents",
    "sessions",
    "runs",
    "assets",
    "devices",
    "tasks",
    "requirements",
    "schedules",
    "squads",
    "artifacts",
}
_DELETE_RESOURCES = {"assets"}
_RUN_ACTIONS = {"start", "cancel", "retry", "replay", "export"}
_SCHEDULE_ACTIONS = {"trigger", "pause", "resume"}
_SCHEDULE_CONFIG_REQUIRED_KEYS = {"title", "trigger", "nodes"}
_SCHEDULE_CONFIG_LEGACY_TRIGGER_KEYS = {"interval_seconds", "starts_at", "cron_expression", "timezone", "secret_ref", "max_body_bytes"}


class HermesClient:
    """Synchronous authorized Hermes client.

    `base_url` may point either at the server root or directly at `/api/hermes/v1`.
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
        self.base_url = clean_base if clean_base.endswith("/api/hermes/v1") else f"{clean_base}/api/hermes/v1"
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

    def _headers(self, *, auth_required: bool, workspace_id: str = "") -> dict[str, str]:
        headers: dict[str, str] = {}
        if auth_required:
            if not self.token:
                raise SopAuthError("Hermes token is required; set HERMES_TOKEN or pass token explicitly")
            headers["Authorization"] = f"Bearer {self.token}"
        scoped_workspace = (workspace_id or self.workspace_id).strip()
        if scoped_workspace:
            headers["X-Workspace-Id"] = scoped_workspace
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        body: Mapping[str, Any] | None = None,
        auth_required: bool = True,
        workspace_id: str = "",
    ) -> dict[str, Any]:
        url_path = path if path.startswith("/") else f"/{path}"
        content = None
        headers = self._headers(auth_required=auth_required, workspace_id=workspace_id)
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

    def _device_request(
        self,
        path: str,
        body: Mapping[str, Any],
        *,
        device_id: str,
        credential: str,
    ) -> dict[str, Any]:
        clean_device = str(device_id or "").strip()
        clean_credential = str(credential or "").strip()
        if not clean_device:
            raise ValueError("device_id is required")
        if not clean_credential:
            raise SopAuthError("Hermes device credential is required")
        content = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {clean_credential}",
            "X-Hermes-Device-Id": clean_device,
            "Content-Type": "application/json",
        }
        try:
            response = self._client.request("POST", path, content=content, headers=headers)
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

    def system_diagnostics(self) -> dict[str, Any]:
        return self._request("GET", "/system/diagnostics")

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

    def repository(self, workspace_id: str) -> dict[str, Any]:
        workspace_id = (workspace_id or "").strip()
        if not workspace_id:
            raise ValueError("workspace_id is required")
        return self._request("GET", f"/workspaces/{workspace_id}/repository", workspace_id=workspace_id)

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
        if resource in {"artifacts", "schedules"}:
            raise ValueError(f"{resource} cannot be created directly")
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
        if resource in {"artifacts", "devices", "schedules"}:
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

    def agent_catalog(self) -> dict[str, Any]:
        return self._request("GET", "/agents/catalog")

    def squad_catalog(self) -> dict[str, Any]:
        return self.list_resource("squads")

    def create_agent_profile(self, data: Mapping[str, Any], *, idempotency_key: str | None = None) -> dict[str, Any]:
        self._validate_agent_profile(data)
        return self.create_resource("agents", data, idempotency_key=idempotency_key)

    def create_squad(self, data: Mapping[str, Any], *, idempotency_key: str | None = None) -> dict[str, Any]:
        self._validate_squad(data)
        return self.create_resource("squads", data, idempotency_key=idempotency_key)

    def run_events(self, run_id: str, *, after: int = 0) -> dict[str, Any]:
        return self._request("GET", f"/runs/{run_id}/events", params={"after": after})

    def run_changes(self, run_id: str) -> dict[str, Any]:
        return self._request("GET", f"/runs/{run_id}/changes")

    def task_delivery(self, task_id: str) -> dict[str, Any]:
        return self._request("GET", f"/tasks/{task_id}/delivery")

    def task_dispatch(self, task_id: str, nodes: list[dict[str, Any]], *, expected_version: int,
                      dry_run: bool = True, idempotency_key: str | None = None,
                      isolation: str = "workspace", base_commit: str = "",
                      target_device_id: str = "") -> dict[str, Any]:
        if isolation not in {"workspace", "git_worktree"}:
            raise ValueError("isolation must be workspace or git_worktree")
        body = {
            "nodes": nodes, "expected_version": expected_version, "dry_run": dry_run,
            "isolation": isolation, "base_commit": base_commit,
            "idempotency_key": idempotency_key or self.new_idempotency_key("task-dispatch"),
        }
        if target_device_id:
            body["target_device_id"] = target_device_id
        return self._request("POST", f"/tasks/{task_id}/dispatch", body=body)

    def task_agent_dispatch(
        self,
        task_id: str,
        *,
        expected_version: int,
        target_version: int,
        prompt: str,
        agent_id: str = "",
        squad_id: str = "",
        dry_run: bool = True,
        idempotency_key: str | None = None,
        isolation: str = "workspace",
        base_commit: str = "",
        target_device_id: str = "",
    ) -> dict[str, Any]:
        if isolation not in {"workspace", "git_worktree"}:
            raise ValueError("isolation must be workspace or git_worktree")
        if bool(agent_id) == bool(squad_id):
            raise ValueError("exactly one of agent_id or squad_id is required")
        if not str(prompt or "").strip():
            raise ValueError("prompt is required")
        body = {
            "expected_version": expected_version,
            "target_version": target_version,
            "dry_run": dry_run,
            "idempotency_key": idempotency_key or self.new_idempotency_key("task-agent-dispatch"),
            "prompt": prompt,
            "isolation": isolation,
            "base_commit": base_commit,
        }
        if agent_id:
            body["agent_id"] = agent_id
        else:
            body["squad_id"] = squad_id
        if target_device_id:
            body["target_device_id"] = target_device_id
        return self._request("POST", f"/tasks/{task_id}/agent-dispatch", body=body)

    def task_review(self, task_id: str, *, run_id: str, run_version: int, expected_version: int,
                    decision: str, comment: str, dry_run: bool = True,
                    idempotency_key: str | None = None) -> dict[str, Any]:
        if decision not in {"accept", "request_changes"}:
            raise ValueError("decision must be accept or request_changes")
        return self._request("POST", f"/tasks/{task_id}/review", body={
            "run_id": run_id, "run_version": run_version, "expected_version": expected_version,
            "decision": decision, "comment": comment, "dry_run": dry_run,
            "idempotency_key": idempotency_key or self.new_idempotency_key("task-review"),
        })

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

    def schedule_configure(
        self,
        schedule_id: str,
        data: Mapping[str, Any],
        *,
        expected_version: int | None = None,
        dry_run: bool = True,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        self._validate_schedule_config(data)
        body = dict(data)
        body["dry_run"] = dry_run
        body["idempotency_key"] = idempotency_key or self.new_idempotency_key("hermes-schedule-configure")
        if expected_version is not None:
            body["expected_version"] = expected_version
        return self._request("POST", f"/schedules/{schedule_id}/configure", body=body)

    def schedule_action(
        self,
        schedule_id: str,
        action: str,
        *,
        expected_version: int,
        dry_run: bool = True,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        if action not in _SCHEDULE_ACTIONS:
            raise ValueError(f"schedule action must be one of {', '.join(sorted(_SCHEDULE_ACTIONS))}")
        return self._request("POST", f"/schedules/{schedule_id}/{action}", body={
            "idempotency_key": idempotency_key or self.new_idempotency_key(f"hermes-schedule-{action}"),
            "expected_version": expected_version,
            "dry_run": dry_run,
        })

    def schedule_history(self, schedule_id: str, *, limit: int = 50, cursor: str = "") -> dict[str, Any]:
        return self._request("GET", f"/schedules/{schedule_id}/history", params={"limit": limit, "cursor": cursor})

    def schedule_preview(self, data: Mapping[str, Any], *, runs: int = 5) -> dict[str, Any]:
        self._validate_schedule_config(data)
        body = {**data, "dry_run": True, "idempotency_key": self.new_idempotency_key("schedule-preview")}
        return self._request("POST", "/schedules/preview", params={"runs": runs}, body=body)

    @staticmethod
    def _validate_schedule_config(data: Mapping[str, Any]) -> None:
        missing = _SCHEDULE_CONFIG_REQUIRED_KEYS - set(data)
        if missing:
            raise ValueError(f"schedule configuration requires {', '.join(sorted(_SCHEDULE_CONFIG_REQUIRED_KEYS))}")
        legacy_keys = _SCHEDULE_CONFIG_LEGACY_TRIGGER_KEYS & (set(data) - {"trigger"})
        if legacy_keys:
            raise ValueError("schedule trigger fields must be nested under trigger")
        trigger = data.get("trigger")
        if not isinstance(trigger, Mapping):
            raise ValueError("schedule configuration trigger must be a JSON object")
        trigger_type = trigger.get("type")
        if trigger_type not in {"interval", "cron", "webhook"}:
            raise ValueError("schedule trigger type must be interval, cron, or webhook")

    def schedule_webhook_test(self, schedule_id: str, *, expected_version: int,
                              dry_run: bool = True, idempotency_key: str | None = None) -> dict[str, Any]:
        return self._request("POST", f"/schedules/{quote(schedule_id, safe='')}/webhook-test", body={
            "expected_version": expected_version, "dry_run": dry_run,
            "idempotency_key": idempotency_key or self.new_idempotency_key("webhook-test"),
        })

    def collaboration_channels(self, *, include_archived: bool = False) -> dict[str, Any]:
        return self._request("GET", "/collaboration/channels", params={"include_archived": str(include_archived).lower()})

    def collaboration_members(self) -> dict[str, Any]:
        return self._request("GET", "/collaboration/members")

    def collaboration_configure_channel(self, channel_id: str, data: Mapping[str, Any], *,
                                        dry_run: bool = True, idempotency_key: str | None = None,
                                        expected_version: int | None = None) -> dict[str, Any]:
        body = self._collaboration_body(data, dry_run, idempotency_key, expected_version)
        return self._request("POST", f"/collaboration/channels/{quote(channel_id, safe='')}/configure", body=body)

    def collaboration_threads(self, channel_id: str, *, cursor: str = "", limit: int = 100, include_archived: bool = False) -> dict[str, Any]:
        return self._request("GET", f"/collaboration/channels/{quote(channel_id, safe='')}/threads", params={"cursor": cursor, "limit": limit, "include_archived": include_archived})

    def collaboration_create_thread(self, data: Mapping[str, Any], *, dry_run: bool = True,
                                    idempotency_key: str | None = None) -> dict[str, Any]:
        return self._request("POST", "/collaboration/threads", body=self._collaboration_body(data, dry_run, idempotency_key))

    def collaboration_messages(self, thread_id: str, *, after: int = 0, limit: int = 100) -> dict[str, Any]:
        return self._request("GET", f"/collaboration/threads/{quote(thread_id, safe='')}/messages", params={"after": after, "limit": limit})

    def collaboration_send_message(self, data: Mapping[str, Any], *, dry_run: bool = True,
                                   idempotency_key: str | None = None) -> dict[str, Any]:
        return self._request("POST", "/collaboration/messages", body=self._collaboration_body(data, dry_run, idempotency_key))

    def collaboration_edit_message(self, message_id: str, data: Mapping[str, Any], *, expected_version: int,
                                   dry_run: bool = True, idempotency_key: str | None = None) -> dict[str, Any]:
        return self._request("PATCH", f"/collaboration/messages/{quote(message_id, safe='')}",
                             body=self._collaboration_body(data, dry_run, idempotency_key, expected_version))

    def collaboration_archive(self, resource: str, entity_id: str, *, expected_version: int,
                              dry_run: bool = True, idempotency_key: str | None = None) -> dict[str, Any]:
        if resource not in {"threads", "messages"}:
            raise ValueError("collaboration archive resource must be threads or messages")
        return self._request("POST", f"/collaboration/{resource}/{quote(entity_id, safe='')}/archive",
                             body=self._collaboration_body({}, dry_run, idempotency_key, expected_version))

    def collaboration_inbox(self, *, limit: int = 100) -> dict[str, Any]:
        return self._request("GET", "/collaboration/inbox", params={"limit": limit})

    def collaboration_mark_read(self, data: Mapping[str, Any], *, dry_run: bool = True,
                                idempotency_key: str | None = None) -> dict[str, Any]:
        return self._request("POST", "/collaboration/read", body=self._collaboration_body(data, dry_run, idempotency_key))

    def _collaboration_body(self, data: Mapping[str, Any], dry_run: bool, key: str | None,
                            expected_version: int | None = None) -> dict[str, Any]:
        body = {**data, "dry_run": dry_run, "idempotency_key": key or self.new_idempotency_key("collaboration")}
        if expected_version is not None:
            body["expected_version"] = expected_version
        return body

    def device_pairing(
        self,
        device_id: str,
        *,
        expected_version: int,
        dry_run: bool = True,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        return self._request("POST", f"/devices/{device_id}/pairing", body={
            "idempotency_key": idempotency_key or self.new_idempotency_key("hermes-device-pairing"),
            "expected_version": expected_version,
            "dry_run": dry_run,
        })

    def device_pair(self, device_id: str, secret: str) -> dict[str, Any]:
        return self._request("POST", "/devices/pair", body={
            "device_id": device_id,
            "secret": secret,
        }, auth_required=False)

    def device_revoke(
        self,
        device_id: str,
        *,
        expected_version: int,
        dry_run: bool = True,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        return self._request("POST", f"/devices/{device_id}/revoke", body={
            "idempotency_key": idempotency_key or self.new_idempotency_key("hermes-device-revoke"),
            "expected_version": expected_version,
            "dry_run": dry_run,
        })

    def remote_claim(
        self,
        *,
        device_id: str,
        credential: str,
        worker_version: str = "",
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        return self._device_request("/remote/claim", {
            "idempotency_key": idempotency_key or self.new_idempotency_key("hermes-remote-claim"),
            "worker_version": worker_version,
        }, device_id=device_id, credential=credential)

    def remote_heartbeat(
        self,
        *,
        device_id: str,
        credential: str,
        run_id: str,
        owner: str,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        return self._device_request("/remote/heartbeat", {
            "run_id": run_id,
            "owner": owner,
            "idempotency_key": idempotency_key or self.new_idempotency_key("hermes-remote-heartbeat"),
        }, device_id=device_id, credential=credential)

    def remote_result(
        self,
        *,
        device_id: str,
        credential: str,
        run_id: str,
        owner: str,
        node_id: str,
        result: Mapping[str, Any],
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        return self._device_request("/remote/result", {
            "run_id": run_id,
            "owner": owner,
            "node_id": node_id,
            "idempotency_key": idempotency_key or self.new_idempotency_key("hermes-remote-result"),
            "result": dict(result),
        }, device_id=device_id, credential=credential)

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

    @staticmethod
    def _validate_agent_profile(data: Mapping[str, Any]) -> None:
        if data.get("provider") not in {"codex", "claude", "opencode"}:
            raise ValueError("agent provider must be codex, claude or opencode")

    @staticmethod
    def _validate_squad(data: Mapping[str, Any]) -> None:
        members = data.get("members")
        if not isinstance(members, list) or not members:
            raise ValueError("squad members must be a non-empty array")
        for member in members:
            if not isinstance(member, Mapping):
                raise ValueError("squad members must be objects")
            if member.get("role") not in {"leader", "implementer", "reviewer"}:
                raise ValueError("squad member role must be leader, implementer or reviewer")
