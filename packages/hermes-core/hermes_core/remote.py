from __future__ import annotations

import hmac
import secrets
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Float, MetaData, String, Table, delete, insert, select, update

from .models import API_BASE, CoreError, Node, Principal, RunAction, payload
from .transactional import Store, digest

PAIRING_TTL_SECONDS = 10 * 60
REMOTE_LEASE_SECONDS = 120
LOG_LIMIT_BYTES = 262144
REMOTE_OWNER_PREFIX = "remote:"


class PairRedeem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: str = Field(min_length=1, max_length=64)
    secret: str = Field(min_length=20, max_length=512)


class RemoteClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=160)
    worker_version: str = Field(default="", max_length=80)


class RemoteHeartbeat(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str = Field(min_length=1, max_length=64)
    owner: str = Field(min_length=16, max_length=160)
    idempotency_key: str = Field(min_length=1, max_length=160)


class RemoteResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str = Field(min_length=1, max_length=64)
    owner: str = Field(min_length=16, max_length=160)
    node_id: str = Field(min_length=1, max_length=64)
    idempotency_key: str = Field(min_length=1, max_length=160)
    result: dict[str, Any] = Field(default_factory=dict)


@dataclass(frozen=True)
class DeviceIdentity:
    principal: Principal
    workspace: str
    device: dict[str, Any]
    credential_secret: str


@dataclass(frozen=True)
class RemoteNode:
    id: str
    kind: str
    argv: list[str]
    expected_exit_code: int
    timeout_seconds: int
    raw: dict[str, Any]

    def model_dump(self) -> dict[str, Any]:
        return dict(self.raw)


def _hash_secret(secret: str, salt: str) -> str:
    return digest(["hermes-remote-secret-v1", salt, secret])


def _credential_table_definition() -> Table:
    meta = MetaData()
    return Table("hermes_remote_device_credentials", meta,
                 Column("device_id", String(64), primary_key=True),
                 Column("pairing_hash", String(64), nullable=False, default=""),
                 Column("pairing_salt", String(64), nullable=False, default=""),
                 Column("pairing_expires_at", Float, nullable=False, default=0),
                 Column("pairing_used_at", Float, nullable=False, default=0),
                 Column("credential_hash", String(64), nullable=False, default=""),
                 Column("credential_salt", String(64), nullable=False, default=""))


def _remote_credentials(store: Store) -> Table:
    table = _credential_table_definition()
    table.metadata.create_all(store.engine)
    return table


def _credential_row(store: Store, device_id: str) -> dict[str, Any]:
    table = _remote_credentials(store)
    with store.engine.connect() as conn:
        row = conn.execute(select(table).where(table.c.device_id == device_id)).mappings().first()
    if row is None:
        return {}
    return dict(row)


def is_paired_device(store: Store, principal: Principal, workspace: str, device_id: str, conn=None) -> bool:
    if conn is None:
        device = store.get(principal, workspace, "devices", device_id)
        credential = _credential_row(store, device_id)
    else:
        device = store._get(conn, principal, workspace, "devices", device_id)
        table = _credential_table_definition()
        row = conn.execute(select(table).where(table.c.device_id == device_id)).mappings().first()
        credential = dict(row) if row is not None else {}
    return (device["status"] == "active"
            and bool(credential.get("credential_hash"))
            and bool(credential.get("credential_salt")))


def _new_secret() -> str:
    return secrets.token_urlsafe(32)


def _now() -> float:
    return time.time()


def _constant_equals(left: str, right: str) -> bool:
    return hmac.compare_digest(str(left or ""), str(right or ""))


def _public_device(device: dict[str, Any]) -> dict[str, Any]:
    data = {
        key: value
        for key, value in device["data"].items()
        if key not in {"pairing_hash", "pairing_salt", "credential_hash", "credential_salt"}
    }
    return {**device, "data": data}


def _response(principal: Principal, workspace: str, items: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return payload(principal, workspace, items, trace=uuid.uuid4().hex, **extra)


def _device_cli(device_id: str) -> dict[str, str]:
    return {"command": f"sop device get {device_id} --json"}


def _run_cli(run_id: str) -> dict[str, str]:
    return {"command": f"sop run get {run_id} --json"}


def _require(principal: Principal, action: str) -> None:
    if action not in principal.permissions:
        raise CoreError("forbidden", f"Missing {action} permission", 403)


def _workspace_id(store: Store, request: Request, principal: Principal) -> str:
    workspace = request.headers.get("X-Workspace-Id", "")
    if not workspace:
        raise CoreError("workspace_required", "Select a workspace first", 400)
    if principal.workspace_ids is not None and workspace not in principal.workspace_ids:
        raise CoreError("forbidden", "Workspace access denied", 403)
    row = store.get(principal, "", "workspaces", workspace)
    if row["status"] != "active":
        raise CoreError("workspace_inactive", "Workspace is inactive", 409)
    return workspace


def _find_device_scope(store: Store, device_id: str) -> dict[str, Any]:
    with store.engine.connect() as conn:
        row = conn.execute(
            select(store.entities).where(store.entities.c.kind == "devices", store.entities.c.id == device_id)
        ).mappings().first()
    if row is None:
        raise CoreError("not_found", "Device not found", 404)
    return dict(row)


def _device_identity(store: Store, request: Request) -> DeviceIdentity:
    device_id = request.headers.get("X-Hermes-Device-Id", "")
    auth = request.headers.get("Authorization", "")
    if not device_id or not auth.startswith("Bearer "):
        raise CoreError("unauthorized", "Device credential is required", 401)
    device = _find_device_scope(store, device_id)
    credential_data = _credential_row(store, device_id)
    credential_hash = str(credential_data.get("credential_hash") or "")
    credential_salt = str(credential_data.get("credential_salt") or "")
    if device["status"] != "active" or not credential_hash or not credential_salt:
        raise CoreError("device_revoked", "Device is not active", 403)
    credential_secret = auth[7:]
    if not _constant_equals(_hash_secret(credential_secret, credential_salt), credential_hash):
        raise CoreError("unauthorized", "Device credential is invalid", 401)
    principal = Principal(f"device:{device_id}", tenant=device["tenant"], business=device["business"],
                          permissions=frozenset({"read", "execute"}), workspace_ids=frozenset({device["workspace"]}))
    return DeviceIdentity(principal, device["workspace"], device, credential_secret)


def _sanitize_result(raw: dict[str, Any], expected_exit_code: int) -> dict[str, Any]:
    exit_code = raw.get("exit_code")
    if isinstance(exit_code, bool) or not isinstance(exit_code, int) or exit_code < -1 or exit_code > 255:
        raise CoreError("invalid_result", "Remote result requires an integer exit_code", 422)
    ok = raw.get("ok", exit_code == expected_exit_code)
    if not isinstance(ok, bool):
        raise CoreError("invalid_result", "Remote result ok must be a boolean when provided", 422)
    duration_ms = raw.get("duration_ms", 0)
    if isinstance(duration_ms, bool) or not isinstance(duration_ms, int) or duration_ms < 0:
        raise CoreError("invalid_result", "Remote result duration_ms must be a non-negative integer", 422)
    result = {
        "ok": ok,
        "exit_code": exit_code,
        "stdout": str(raw.get("stdout", ""))[-LOG_LIMIT_BYTES:],
        "stderr": str(raw.get("stderr", ""))[-LOG_LIMIT_BYTES:],
        "duration_ms": duration_ms,
        "error": str(raw.get("error", ""))[:2000],
        "expected_exit_code": expected_exit_code,
    }
    result["succeeded"] = ok and exit_code == expected_exit_code and not result["error"]
    return result


def _planned_nodes(run: dict[str, Any]) -> list[RemoteNode]:
    nodes: list[RemoteNode] = []
    for raw_node in run["data"].get("nodes", []):
        if not isinstance(raw_node, dict):
            raise CoreError("invalid_graph", "Run nodes must be objects", 422)
        kind = str(raw_node.get("kind", "command"))
        if kind == "command":
            node = Node.model_validate(raw_node)
            nodes.append(RemoteNode(node.id, node.kind, node.argv, node.expected_exit_code,
                                    node.timeout_seconds, node.model_dump()))
            continue
        node_id = str(raw_node.get("id") or "")
        if not node_id:
            raise CoreError("invalid_graph", "Run nodes require an id", 422)
        nodes.append(RemoteNode(node_id, kind, [], 0, 60, dict(raw_node)))
    return nodes


def _unsupported_reason(run: dict[str, Any], nodes: list[RemoteNode]) -> str:
    if run["data"].get("isolation", "workspace") != "workspace" or run["data"].get("base_commit"):
        return "Remote execution currently supports workspace command runs only; git_worktree isolation is not supported."
    if any(node.kind == "approval" for node in nodes):
        return "Remote execution currently supports command nodes only; approval nodes require the server checkpoint path."
    if any(node.kind == "agent" for node in nodes):
        return "Remote execution currently does not run agent nodes; agent_id/prompt require the real adapter before dispatch."
    if any(node.kind != "command" for node in nodes):
        return "Remote execution currently supports command nodes only."
    return ""


def _next_node(nodes: list[RemoteNode], results: dict[str, Any]) -> RemoteNode | None:
    for node in nodes:
        recorded = results.get(node.id)
        if not recorded or not recorded.get("succeeded"):
            return node
    return None


def _assert_run_still_remote_executable(store: Store, conn, principal: Principal, workspace: str,
                                        run: dict[str, Any], device_id: str) -> None:
    current_workspace = store._get(conn, Principal(principal.actor, tenant=principal.tenant,
                                                   business=principal.business), "", "workspaces", workspace)
    if run["data"].get("workspace_version") != current_workspace["version"]:
        raise CoreError("workspace_changed", "Workspace configuration changed; create a newly reviewed run", 409)
    if run["data"].get("target_device_id") != device_id:
        raise CoreError("forbidden", "Run is assigned to a different device", 403)
    source = run["data"].get("task_source")
    if source:
        task = store._get(conn, principal, workspace, "tasks", source["task_id"])
        link = task["data"].get("delivery", {})
        if link.get("run_id") != run["id"] or link.get("phase") != "executing":
            raise CoreError("delivery_closed", "The task delivery is no longer executable", 409)


def _assert_device_active_in_tx(store: Store, conn, device: dict[str, Any], credential_table: Table,
                                credential_secret: str) -> None:
    current = store._get(conn, Principal("device-check", tenant=device["tenant"], business=device["business"]),
                         device["workspace"], "devices", device["id"])
    credential = conn.execute(select(credential_table).where(
        credential_table.c.device_id == device["id"]).with_for_update()).mappings().first()
    if (current["status"] != "active" or credential is None or not credential["credential_hash"]
            or not credential["credential_salt"]):
        raise CoreError("device_revoked", "Device is not active", 403)
    current_hash = _hash_secret(credential_secret, str(credential["credential_salt"]))
    if not _constant_equals(current_hash, str(credential["credential_hash"])):
        raise CoreError("device_revoked", "Device credential is no longer current", 403)


def _task_payload(run: dict[str, Any], workspace: str, device_id: str, owner: str,
                  node: RemoteNode, version: int) -> dict[str, Any]:
    return {"run_id": run["id"], "run_version": version, "owner": owner,
            "workspace_id": workspace, "device_id": device_id, "lease_seconds": REMOTE_LEASE_SECONDS,
            "node": node.model_dump(), "boundary": {"supports": ["command"],
            "unsupported": ["approval", "agent", "git_worktree"],
            "workspace_root_from_server_is_untrusted": True}}


def _active_assignment(store: Store, principal: Principal, workspace: str, device_id: str) -> dict[str, Any] | None:
    cursor = ""
    while True:
        rows = store.list(principal, workspace, "runs", status="running", cursor=cursor, limit=100)
        for run in rows:
            owner = str(run["data"].get("execution_owner") or "")
            if (run["data"].get("target_device_id") != device_id or not owner.startswith(REMOTE_OWNER_PREFIX)
                    or float(run["data"].get("lease_expires_at") or 0) < _now()):
                continue
            nodes = _planned_nodes(run)
            node_id = run["data"].get("active_node")
            node = next((candidate for candidate in nodes if candidate.id == node_id), None)
            if node is not None:
                return _task_payload(run, workspace, device_id, owner, node, run["version"])
        if len(rows) < 100:
            return None
        cursor = rows[-1]["id"]


def _claim_key_seen(store: Store, principal: Principal, workspace: str, key: str) -> bool:
    cursor = ""
    while True:
        rows = store.list(principal, workspace, "runs", cursor=cursor, limit=100)
        for run in rows:
            if run["data"].get("remote_claim_key") == key:
                return True
        if len(rows) < 100:
            return False
        cursor = rows[-1]["id"]


def recover_expired_remote(store: Store, principal: Principal, workspace: str) -> None:
    cursor = ""
    while True:
        rows = store.list(principal, workspace, "runs", status="running", cursor=cursor, limit=100)
        for run in rows:
            owner = str(run["data"].get("execution_owner") or "")
            if not owner.startswith(REMOTE_OWNER_PREFIX):
                continue
            if float(run["data"].get("lease_expires_at") or 0) >= _now():
                continue

            def expire(item: dict[str, Any], expired_owner=owner) -> dict[str, Any]:
                if item["status"] != "running" or item["data"].get("execution_owner") != expired_owner:
                    raise CoreError("lease_lost", "Remote execution ownership changed", 409)
                if float(item["data"].get("lease_expires_at") or 0) >= _now():
                    raise CoreError("lease_active", "Remote execution lease is still active", 409)
                return {"status": "failed", "data": {**item["data"], "execution_owner": None,
                    "lease_expires_at": None, "recovery_requires_review": True,
                    "error": "Remote execution lease expired. Review external side effects before retrying."}}

            try:
                store.mutate(principal, workspace, "runs", run["id"], operation="remote.lease_expired",
                             key=f"remote-expired:{run['version']}", request={}, trace=uuid.uuid4().hex,
                             expected=run["version"], transform=expire)
            except CoreError as exc:
                if exc.status != 409:
                    raise
        if len(rows) < 100:
            return
        cursor = rows[-1]["id"]


def create_remote_router(store: Store, identity: Callable):  # noqa: C901
    credential_table = _remote_credentials(store)
    router = APIRouter(prefix=API_BASE, tags=["Hermes Remote Execution"])

    def device_auth(request: Request) -> DeviceIdentity:
        return _device_identity(store, request)

    @router.post("/devices/{device_id}/pairing")
    def pairing(device_id: str, body: RunAction, request: Request,
                principal: Principal = Depends(identity)):  # noqa: B008
        _require(principal, "config")
        _require(principal, "execute")
        workspace = _workspace_id(store, request, principal)
        operation = f"device.pairing_issued:{device_id}"
        if not body.dry_run and store.receipt(principal, workspace, operation, body.idempotency_key,
                                              body.model_dump()) is not None:
            raise CoreError("pairing_secret_unavailable",
                            "Pairing secrets are returned once only; issue a new pairing invitation", 409)
        device = store.get(principal, workspace, "devices", device_id)
        if device["version"] != body.expected_version:
            raise CoreError("version_conflict", "Device changed; reload before pairing", 409)
        if device["status"] == "revoked":
            raise CoreError("device_revoked", "Revoked devices cannot be paired", 409)
        if body.dry_run:
            return _response(principal, workspace, [_public_device(device)],
                             summary={"dry_run": True, "secret_returned": False, "ttl_seconds": PAIRING_TTL_SECONDS},
                             cli=_device_cli(device_id))
        secret = _new_secret()
        salt = uuid.uuid4().hex
        expires_at = _now() + PAIRING_TTL_SECONDS

        def issue(item: dict[str, Any]) -> dict[str, Any]:
            if item["status"] == "revoked":
                raise CoreError("device_revoked", "Revoked devices cannot be paired", 409)
            return {"status": "pairing", "data": {**item["data"],
                "pairing_expires_at": expires_at, "pairing_used_at": None,
                "pairing_issued_by": principal.actor}}

        def issue_pairing_credentials(conn) -> None:
            current = store._get(conn, principal, workspace, "devices", device_id)
            if current["version"] != body.expected_version:
                raise CoreError("version_conflict", "Device changed; reload before pairing", 409)
            if current["status"] == "revoked":
                raise CoreError("device_revoked", "Revoked devices cannot be paired", 409)
            conn.execute(delete(credential_table).where(credential_table.c.device_id == device_id))
            conn.execute(insert(credential_table).values(device_id=device_id, pairing_hash=_hash_secret(secret, salt),
                         pairing_salt=salt, pairing_expires_at=expires_at, pairing_used_at=0,
                         credential_hash="", credential_salt=""))

        result = store.mutate(principal, workspace, "devices", device_id, operation="device.pairing_issued",
                              key=body.idempotency_key, request=body.model_dump(), trace=uuid.uuid4().hex,
                              expected=body.expected_version, transform=issue, precondition=issue_pairing_credentials)
        public = _public_device(result)
        public["pairing_secret"] = secret
        return _response(principal, workspace, [public],
                         summary={"dry_run": False, "secret_returned_once": True, "ttl_seconds": PAIRING_TTL_SECONDS},
                         cli=_device_cli(device_id))

    @router.post("/devices/pair")
    def pair(body: PairRedeem):
        device = _find_device_scope(store, body.device_id)
        principal = Principal(f"pair:{body.device_id}", tenant=device["tenant"], business=device["business"],
                              permissions=frozenset({"execute"}), workspace_ids=frozenset({device["workspace"]}))
        if device["status"] != "pairing":
            raise CoreError("pairing_closed", "Pairing invitation is not active", 409)
        credential = _new_secret()
        credential_salt = uuid.uuid4().hex
        pairing_state: dict[str, Any] = {}

        def redeem(item: dict[str, Any]) -> dict[str, Any]:
            if item["status"] != "pairing" or item["data"].get("pairing_used_at"):
                raise CoreError("pairing_closed", "Pairing invitation was already redeemed", 409)
            if float(pairing_state.get("pairing_expires_at") or 0) < _now():
                raise CoreError("pairing_expired", "Pairing invitation expired", 410)
            if not _constant_equals(_hash_secret(body.secret, str(pairing_state.get("pairing_salt") or "")),
                                    str(pairing_state.get("pairing_hash") or "")):
                raise CoreError("unauthorized", "Pairing secret is invalid", 401)
            clean = dict(item["data"])
            clean.update(pairing_used_at=_now())
            return {"status": "active", "data": clean}

        def redeem_pairing_credentials(conn) -> None:
            current = store._get(conn, principal, device["workspace"], "devices", body.device_id)
            if current["status"] != "pairing" or current["data"].get("pairing_used_at"):
                raise CoreError("pairing_closed", "Pairing invitation was already redeemed", 409)
            row = conn.execute(select(credential_table).where(
                credential_table.c.device_id == body.device_id).with_for_update()).mappings().first()
            if row is None or not row["pairing_hash"] or not row["pairing_salt"]:
                raise CoreError("pairing_closed", "Pairing invitation is not active", 409)
            if float(row["pairing_expires_at"] or 0) < _now():
                raise CoreError("pairing_expired", "Pairing invitation expired", 410)
            if not _constant_equals(_hash_secret(body.secret, str(row["pairing_salt"])),
                                    str(row["pairing_hash"])):
                raise CoreError("unauthorized", "Pairing secret is invalid", 401)
            pairing_state.update(dict(row))
            conn.execute(update(credential_table).where(credential_table.c.device_id == body.device_id).values(
                pairing_hash="", pairing_salt="", pairing_used_at=_now(),
                credential_hash=_hash_secret(credential, credential_salt), credential_salt=credential_salt))

        result = store.mutate(principal, device["workspace"], "devices", body.device_id,
                              operation="device.paired", key=uuid.uuid4().hex,
                              request={"device_id": body.device_id}, trace=uuid.uuid4().hex,
                              expected=device["version"], transform=redeem,
                              precondition=redeem_pairing_credentials)
        public = _public_device(result)
        public.update(device_id=body.device_id, workspace_id=device["workspace"],
                      credential=credential, credential_scope={"tenant": device["tenant"],
                      "business": device["business"], "workspace": device["workspace"]})
        return _response(principal, device["workspace"], [public],
                         summary={"credential_returned_once": True, "revocable": True},
                         cli=_device_cli(body.device_id))

    @router.post("/devices/{device_id}/revoke")
    def revoke(device_id: str, body: RunAction, request: Request,
               principal: Principal = Depends(identity)):  # noqa: B008
        _require(principal, "config")
        workspace = _workspace_id(store, request, principal)
        device = store.get(principal, workspace, "devices", device_id)
        if device["version"] != body.expected_version:
            raise CoreError("version_conflict", "Device changed; reload before revoke", 409)
        if body.dry_run:
            return _response(principal, workspace, [_public_device(device)], summary={"dry_run": True},
                             cli=_device_cli(device_id))

        def do_revoke(item: dict[str, Any]) -> dict[str, Any]:
            return {"status": "revoked", "data": {**item["data"], "revoked_at": _now(), "revoked_by": principal.actor,
                "credential_hash": "", "credential_salt": "", "pairing_hash": "", "pairing_salt": ""}}

        def delete_device_credentials(conn) -> None:
            current = store._get(conn, principal, workspace, "devices", device_id)
            if current["version"] != body.expected_version:
                raise CoreError("version_conflict", "Device changed; reload before revoke", 409)
            conn.execute(delete(credential_table).where(credential_table.c.device_id == device_id))

        result = store.mutate(principal, workspace, "devices", device_id, operation="device.revoked",
                              key=body.idempotency_key, request=body.model_dump(), trace=uuid.uuid4().hex,
                              expected=body.expected_version, transform=do_revoke,
                              precondition=delete_device_credentials)
        return _response(principal, workspace, [_public_device(result)], summary={"dry_run": False},
                         cli=_device_cli(device_id))

    @router.post("/remote/claim")
    def claim(body: RemoteClaim, request: Request):  # noqa: C901
        identity_data = device_auth(request)
        principal, workspace, device = identity_data.principal, identity_data.workspace, identity_data.device
        recover_expired_remote(store, principal, workspace)
        active = _active_assignment(store, principal, workspace, device["id"])
        if active is not None:
            return _response(principal, workspace, [active], summary={"claimed": True, "idempotent": True},
                             cli=_run_cli(active["run_id"]))
        if _claim_key_seen(store, principal, workspace, body.idempotency_key):
            raise CoreError("stale_claim_key", "Claim idempotency key already belongs to a completed assignment", 409)
        cursor = ""
        while True:
            rows = store.list(principal, workspace, "runs", cursor=cursor, limit=100)
            for run in rows:
                if run["status"] not in {"queued", "retrying"}:
                    continue
                if run["data"].get("target_device_id") != device["id"]:
                    continue
                nodes = _planned_nodes(run)
                unsupported = _unsupported_reason(run, nodes)
                if not nodes:
                    unsupported = "Remote execution requires at least one planned node."
                if unsupported:
                    store.mutate(principal, workspace, "runs", run["id"], operation="remote.unsupported",
                                 key=f"remote-unsupported:{run['version']}", request={}, trace=uuid.uuid4().hex,
                                 expected=run["version"], transform=lambda item, message=unsupported: {
                                     "status": "failed",
                                     "data": {**item["data"], "error": message, "recovery_requires_review": False,
                                              "execution_owner": None, "lease_expires_at": None}})
                    continue
                node = _next_node(nodes, run["data"].get("node_results", {}))
                if node is None:
                    store.mutate(principal, workspace, "runs", run["id"], operation="remote.completed",
                                 key=f"remote-complete:{run['version']}", request={}, trace=uuid.uuid4().hex,
                                 expected=run["version"], transform=lambda item: {"status": "completed",
                                 "data": {**item["data"], "execution_owner": None, "lease_expires_at": None,
                                          "active_node": None}})
                    continue
                owner = REMOTE_OWNER_PREFIX + secrets.token_urlsafe(24)

                def take(item: dict[str, Any], assigned_owner=owner, assigned_node=node) -> dict[str, Any]:
                    if item["status"] not in {"queued", "retrying"}:
                        raise CoreError("already_claimed", "Run is no longer claimable", 409)
                    return {"status": "running", "data": {**item["data"], "execution_owner": assigned_owner,
                        "lease_expires_at": _now() + REMOTE_LEASE_SECONDS, "active_node": assigned_node.id,
                        "remote_worker_version": body.worker_version, "remote_claim_key": body.idempotency_key,
                        "recovery_requires_review": False}}

                claimed = store.mutate(principal, workspace, "runs", run["id"], operation="remote.claimed",
                                       key=body.idempotency_key, request=body.model_dump(), trace=uuid.uuid4().hex,
                                       expected=run["version"], transform=take,
                                       precondition=lambda conn, current=run: (
                                           _assert_device_active_in_tx(store, conn, device, credential_table,
                                                                       identity_data.credential_secret),
                                           _assert_run_still_remote_executable(store, conn, principal, workspace,
                                                                               current, device["id"])))
                persisted_owner = str(claimed["data"].get("execution_owner") or owner)
                persisted_node_id = str(claimed["data"].get("active_node") or node.id)
                persisted_node = next(candidate for candidate in nodes if candidate.id == persisted_node_id)
                task = _task_payload(claimed, workspace, device["id"], persisted_owner, persisted_node,
                                     claimed["version"])
                return _response(principal, workspace, [task], summary={"claimed": True},
                                 cli=_run_cli(claimed["id"]))
            if len(rows) < 100:
                break
            cursor = rows[-1]["id"]
        return _response(principal, workspace, [], summary={"claimed": False}, cli=_device_cli(device["id"]))

    @router.post("/remote/heartbeat")
    def heartbeat(body: RemoteHeartbeat, request: Request):
        identity_data = device_auth(request)
        principal, workspace, device = identity_data.principal, identity_data.workspace, identity_data.device
        recover_expired_remote(store, principal, workspace)

        def beat(item: dict[str, Any]) -> dict[str, Any]:
            if item["status"] == "cancelled":
                raise CoreError("cancelled", "Run was cancelled", 409)
            if item["status"] != "running" or item["data"].get("execution_owner") != body.owner:
                raise CoreError("lease_lost", "Remote execution ownership changed", 409)
            if item["data"].get("target_device_id") != device["id"]:
                raise CoreError("forbidden", "Run is assigned to a different device", 403)
            if float(item["data"].get("lease_expires_at") or 0) < _now():
                raise CoreError("lease_expired", "Remote execution lease expired", 409)
            return {"data": {**item["data"], "lease_expires_at": _now() + REMOTE_LEASE_SECONDS}}

        result = store.mutate(principal, workspace, "runs", body.run_id, operation="remote.heartbeat",
                              key=body.idempotency_key, request=body.model_dump(), trace=uuid.uuid4().hex,
                              expected=None, transform=beat,
                              precondition=lambda conn: _assert_device_active_in_tx(store, conn, device,
                                                                                    credential_table,
                                                                                    identity_data.credential_secret))
        return _response(principal, workspace, [{"run_id": body.run_id, "status": result["status"],
                                                "lease_expires_at": result["data"].get("lease_expires_at")}],
                         cli=_run_cli(body.run_id))

    @router.post("/remote/result")
    def result(body: RemoteResult, request: Request):
        identity_data = device_auth(request)
        principal, workspace, device = identity_data.principal, identity_data.workspace, identity_data.device
        recover_expired_remote(store, principal, workspace)
        current = store.get(principal, workspace, "runs", body.run_id)
        nodes = _planned_nodes(current)
        node_by_id = {node.id: node for node in nodes}
        node = node_by_id.get(body.node_id)
        if node is None:
            raise CoreError("unknown_node", "Result references an unknown run node", 404)
        clean_result = _sanitize_result(body.result, node.expected_exit_code)
        current_existing = current["data"].get("node_results", {}).get(body.node_id)
        audit_data = {"node_id": body.node_id, "owner": body.owner,
                      "attempt": current["data"].get("attempt", 1)}
        if current_existing is not None:
            audit_data["superseded_result_sha256"] = digest(current_existing)

        def record(item: dict[str, Any]) -> dict[str, Any]:
            if item["data"].get("target_device_id") != device["id"]:
                raise CoreError("forbidden", "Run is assigned to a different device", 403)
            attempt = item["data"].get("attempt", 1)
            owned_result = {**clean_result, "execution_owner": body.owner, "attempt": attempt}
            fingerprint = digest(owned_result)
            existing = item["data"].get("node_results", {}).get(body.node_id)
            if existing is not None:
                same_assignment = (existing.get("execution_owner") == body.owner
                                   and existing.get("attempt", 1) == attempt)
                if same_assignment:
                    if digest(existing) == fingerprint:
                        return {"status": item["status"], "data": item["data"]}
                    raise CoreError("result_conflict", "Node result was already recorded differently", 409)
            if item["status"] != "running" or item["data"].get("execution_owner") != body.owner:
                raise CoreError("lease_lost", "Remote execution ownership changed", 409)
            if float(item["data"].get("lease_expires_at") or 0) < _now():
                raise CoreError("lease_expired", "Remote execution lease expired", 409)
            if item["data"].get("active_node") != body.node_id:
                raise CoreError("stale_result", "Result does not match the active node", 409)
            results = {**item["data"].get("node_results", {}), body.node_id: owned_result}
            if not owned_result["succeeded"]:
                return {"status": "failed", "data": {**item["data"], "node_results": results,
                    "execution_owner": None, "lease_expires_at": None, "active_node": None,
                    "recovery_requires_review": True,
                    "error": f"Remote node {body.node_id} exited {owned_result['exit_code']}"}}
            next_node = _next_node(nodes, results)
            status = "completed" if next_node is None else "queued"
            return {"status": status, "data": {**item["data"], "node_results": results, "execution_owner": None,
                "lease_expires_at": None, "active_node": None}}

        saved = store.mutate(principal, workspace, "runs", body.run_id, operation="remote.result",
                             key=body.idempotency_key, request=body.model_dump(), trace=uuid.uuid4().hex,
                             expected=None, transform=record, audit_data=audit_data,
                             precondition=lambda conn: _assert_device_active_in_tx(store, conn, device,
                                                                                   credential_table,
                                                                                   identity_data.credential_secret))
        return _response(principal, workspace, [saved], summary={"result_recorded": True},
                         cli=_run_cli(body.run_id))

    return router
