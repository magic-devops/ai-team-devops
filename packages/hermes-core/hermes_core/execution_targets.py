"""Execution policy and observed capability, shared by runtime and business dispatch.

Reading a target never provisions credentials, presence or runtime resources.
Presence renewals are independent of device configuration versions.
"""

from __future__ import annotations

import shutil
import time
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator
from sqlalchemy import JSON, Column, Float, Integer, MetaData, String, Table, insert, select, update

from .models import CoreError, RunAction
from .transactional import digest, now

RuntimeKind = Literal["command", "agent"]
ProviderId = Literal["codex", "claude", "opencode"]
PRESENCE_TTL_SECONDS = 120


class ProviderCapability(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: ProviderId
    executable_present: StrictBool
    version: str | None = Field(default=None, max_length=80)
    auth: Literal["unknown"] = "unknown"


class RuntimePolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allowed_runtimes: list[RuntimeKind] = Field(max_length=2)
    allowed_providers: list[ProviderId] = Field(max_length=3)

    @model_validator(mode="after")
    def unique_policy(self):
        if len(set(self.allowed_runtimes)) != len(self.allowed_runtimes):
            raise ValueError("Runtime permissions must be unique")
        if len(set(self.allowed_providers)) != len(self.allowed_providers):
            raise ValueError("Provider permissions must be unique")
        if "agent" in self.allowed_runtimes and not self.allowed_providers:
            raise ValueError("Agent execution requires an explicitly allowed provider")
        return self


class DeviceRuntimePolicy(RunAction, RuntimePolicy):
    pass


class WorkerPresence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=160)
    worker_id: str = Field(min_length=1, max_length=120)
    worker_version: str = Field(min_length=1, max_length=80)
    runtime_capabilities: list[RuntimeKind] = Field(max_length=2)
    providers: list[ProviderCapability] = Field(max_length=3)

    @model_validator(mode="after")
    def unique_capabilities(self):
        if len(set(self.runtime_capabilities)) != len(self.runtime_capabilities):
            raise ValueError("Runtime capabilities must be unique")
        ids = [provider.id for provider in self.providers]
        if len(set(ids)) != len(ids):
            raise ValueError("Provider capabilities must be unique")
        return self


class ExecutionTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: Literal["local", "device"]
    name: str
    version: int
    basis: str
    paired: bool | None
    online: bool | None
    last_seen_at: str | None
    expires_at: str | None
    worker_id: str | None
    capability_digest: str
    runtime_capabilities: list[RuntimeKind]
    providers: list[ProviderCapability]
    policy: RuntimePolicy
    can_execute: bool
    reason_codes: list[str]


def presence_table():
    return Table("hermes_remote_worker_presence", MetaData(),
                 Column("device_id", String(64), primary_key=True),
                 Column("credential_binding", String(64), nullable=False),
                 Column("worker_id", String(120), nullable=False),
                 Column("worker_version", String(80), nullable=False),
                 Column("capabilities", JSON, nullable=False),
                 Column("capability_digest", String(64), nullable=False),
                 Column("generation", Integer, nullable=False),
                 Column("observed_at", Float, nullable=False),
                 Column("expires_at", Float, nullable=False))


def initialize_target_storage(store):
    table = presence_table()
    table.metadata.create_all(store.engine)


def _timestamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat() if value is not None else None


def _credential_binding(row):
    return digest([row.get("credential_hash"), row.get("credential_salt")]) if row and row.get("credential_hash") else ""


def _presence_and_credential(conn, device_id):
    from .remote import _credential_table_definition

    table = presence_table()
    presence = conn.execute(select(table).where(table.c.device_id == device_id)).mappings().first()
    credential = _credential_table_definition()
    row = conn.execute(select(credential).where(credential.c.device_id == device_id)).mappings().first()
    return (dict(presence) if presence else {}, dict(row) if row else {})


def record_worker_presence(store, identity, body: WorkerPresence):
    from .remote import _assert_device_active_in_tx, _credential_table_definition

    principal, workspace, device = identity.principal, identity.workspace, identity.device
    table = presence_table()
    request = body.model_dump()
    capabilities = {"runtime_capabilities": sorted(body.runtime_capabilities),
                    "providers": sorted((p.model_dump() for p in body.providers), key=lambda p: p["id"])}
    with store.transaction() as conn:
        _assert_device_active_in_tx(store, conn, device, _credential_table_definition(), identity.credential_secret)
        receipt_id, cached = store._receipt(conn, principal, workspace, "remote.presence:" + device["id"],
                                          body.idempotency_key, request)
        if cached is not None:
            return cached
        _, credential = _presence_and_credential(conn, device["id"])
        current = time.time()
        values = {"credential_binding": _credential_binding(credential), "worker_id": body.worker_id,
                  "worker_version": body.worker_version, "capabilities": capabilities,
                  "capability_digest": digest(capabilities), "observed_at": current,
                  "expires_at": current + PRESENCE_TTL_SECONDS}
        existing = conn.execute(select(table).where(table.c.device_id == device["id"])).mappings().first()
        unchanged = bool(existing and all(existing[field] == values[field] for field in (
            "credential_binding", "worker_id", "worker_version", "capability_digest")))
        values["generation"] = existing["generation"] if unchanged else (existing["generation"] + 1 if existing else 1)
        if existing:
            conn.execute(update(table).where(table.c.device_id == device["id"]).values(**values))
        else:
            conn.execute(insert(table).values(device_id=device["id"], **values))
        result = {"device_id": device["id"], "worker_id": body.worker_id, "worker_version": body.worker_version,
                  **capabilities, "capability_digest": values["capability_digest"],
                  "observed_at": _timestamp(current), "expires_at": _timestamp(values["expires_at"])}
        conn.execute(insert(store.receipts).values(id=receipt_id, request_hash=digest(request), result=result, created_at=now()))
        return result


def _workspace(store, conn, principal, workspace_id):
    if principal.workspace_ids is not None and workspace_id not in principal.workspace_ids:
        raise CoreError("forbidden", "Workspace access denied", 403)
    workspace = store._get(conn, principal, "", "workspaces", workspace_id)
    if workspace["status"] != "active":
        raise CoreError("workspace_inactive", "Workspace is inactive", 409)
    return workspace


def _device_target(store, conn, principal, workspace, device, current):
    presence, credential = _presence_and_credential(conn, device["id"])
    paired = device["status"] == "active" and bool(credential.get("credential_hash"))
    current_binding = _credential_binding(credential)
    valid_presence = bool(paired and presence and presence["credential_binding"] == current_binding)
    online = bool(valid_presence and presence["expires_at"] > current)
    capabilities = presence["capabilities"] if valid_presence else {"runtime_capabilities": [], "providers": []}
    try:
        policy = RuntimePolicy(allowed_runtimes=device["data"].get("allowed_runtimes", ["command"]),
                               allowed_providers=device["data"].get("allowed_providers", [])).model_dump()
    except ValueError:
        policy = {"allowed_runtimes": [], "allowed_providers": []}
    reasons = []
    if "execute" not in principal.permissions:
        reasons.append("execute_permission_required")
    if not paired:
        reasons.append("device_unpaired" if device["status"] != "revoked" else "device_revoked")
    if not online:
        reasons.append("worker_offline")
    permitted = set(policy["allowed_runtimes"]) & set(capabilities["runtime_capabilities"])
    if not permitted:
        reasons.append("runtime_not_allowed")
    stable = {"workspace_id": workspace["id"], "workspace_version": workspace["version"],
              "device_id": device["id"], "device_version": device["version"], "policy": policy,
              "worker_id": presence.get("worker_id") if valid_presence else None,
              "capability_digest": presence.get("capability_digest", "") if valid_presence else "",
              "presence_generation": presence.get("generation") if valid_presence else None,
              "credential_binding": current_binding}
    return ExecutionTarget(id=device["id"], kind="device", name=device["data"].get("name") or device["data"].get("title") or device["id"],
                           version=device["version"], basis=digest(stable), paired=paired, online=online,
                           last_seen_at=_timestamp(presence.get("observed_at")) if valid_presence else None,
                           expires_at=_timestamp(presence.get("expires_at")) if valid_presence else None,
                           worker_id=stable["worker_id"], capability_digest=stable["capability_digest"],
                           **capabilities, policy=policy, can_execute=not reasons, reason_codes=reasons).model_dump()


def _local_target(execution, principal, workspace):
    providers = [ProviderCapability(id=provider, executable_present=bool(shutil.which(provider))).model_dump()
                 for provider in ("codex", "claude", "opencode")]
    capabilities = {"runtime_capabilities": ["command", "agent"], "providers": providers}
    reasons = []
    if "execute" not in principal.permissions:
        reasons.append("execute_permission_required")
    if execution is None or not execution.available():
        reasons.append("executor_unavailable")
    if execution is not None:
        from pathlib import Path

        try:
            execution.validate_root(Path(workspace["data"]["root"]).resolve())
        except CoreError:
            reasons.append("root_forbidden")
    config = {"workspace_id": workspace["id"], "workspace_version": workspace["version"],
              "agentd": str(getattr(execution, "agentd", "")),
              "allow_commands": bool(getattr(execution, "allow_commands", False)),
              "allowed_roots": [str(root) for root in getattr(execution, "allowed_roots", ()) or ()],
              "capability_digest": digest(capabilities)}
    return ExecutionTarget(id="local", kind="local", name="Local execution", version=workspace["version"],
                           basis=digest(config), paired=None, online=None, last_seen_at=None, expires_at=None,
                           worker_id=None, capability_digest=digest(capabilities), **capabilities,
                           policy={"allowed_runtimes": ["command", "agent"], "allowed_providers": ["codex", "claude", "opencode"]},
                           can_execute=not reasons, reason_codes=reasons).model_dump()


def workspace_execution_targets(store, execution, principal, workspace_id: str, *, now_seconds: float | None = None):
    with store.engine.connect() as conn:
        workspace = _workspace(store, conn, principal, workspace_id)
        devices = conn.execute(select(store.entities).where(store._scope(store.entities, principal, workspace_id),
                               store.entities.c.kind == "devices").order_by(store.entities.c.id)).mappings().all()
        current = time.time() if now_seconds is None else now_seconds
        return {"local": _local_target(execution, principal, workspace),
                "devices": [_device_target(store, conn, principal, workspace, dict(device), current) for device in devices]}


def select_execution_target(store, execution, principal, workspace_id: str, *, target_kind: Literal["local", "device"],
                            target_device_id: str = "", provider: str = "", expected_basis: str | None = None,
                            now_seconds: float | None = None, conn=None):
    if conn is None:
        with store.engine.connect() as connection:
            return select_execution_target(store, execution, principal, workspace_id, target_kind=target_kind,
                                           target_device_id=target_device_id, provider=provider,
                                           expected_basis=expected_basis, now_seconds=now_seconds, conn=connection)
    workspace = _workspace(store, conn, principal, workspace_id)
    if target_kind == "device" and target_device_id:
        device = store._get(conn, principal, workspace_id, "devices", target_device_id)
        target = _device_target(store, conn, principal, workspace, device, time.time() if now_seconds is None else now_seconds)
    elif target_kind == "local" and not target_device_id:
        target = _local_target(execution, principal, workspace)
    else:
        raise CoreError("invalid_target", "Select an explicit local or device target", 422)
    if expected_basis is not None and target["basis"] != expected_basis:
        raise CoreError("target_basis_changed", "Execution target changed; review and explicitly adopt the current target", 409)
    reasons = list(target["reason_codes"])
    runtime = "agent" if provider else "command"
    if runtime not in target["runtime_capabilities"] or runtime not in target["policy"]["allowed_runtimes"]:
        reasons.append("runtime_not_allowed")
    if provider:
        from .agents import require_provider_input_transport
        require_provider_input_transport(provider)
        if provider not in target["policy"]["allowed_providers"]:
            reasons.append("provider_not_allowed")
        if not any(item["id"] == provider and item["executable_present"] for item in target["providers"]):
            reasons.append("provider_unavailable")
    if reasons:
        raise CoreError("target_unavailable", "Execution target unavailable: " + ", ".join(dict.fromkeys(reasons)), 409)
    return target


def validate_execution_target_snapshot(store, execution, principal, workspace_id, snapshot: dict, *, provider: str = "", conn=None):
    return select_execution_target(store, execution, principal, workspace_id, target_kind=snapshot["kind"],
                                   target_device_id=snapshot["id"] if snapshot["kind"] == "device" else "",
                                   provider=provider, expected_basis=snapshot["basis"], conn=conn)


def select_execution_plan_target(store, execution, principal, workspace, body, bindings, conn):
    if not body.target_basis:
        raise CoreError("target_basis_required", "Review the current execution target before dispatch", 422)
    providers = {binding["profile"]["provider"] for binding in bindings.values()} or {""}
    if any(node.kind == "command" for node in body.nodes):
        providers.add("")
    snapshot = None
    for provider in providers:
        snapshot = select_execution_target(store, execution, principal, workspace,
                                           target_kind="device" if body.target_device_id else "local",
                                           target_device_id=body.target_device_id, provider=provider,
                                           expected_basis=body.target_basis, conn=conn)
    return snapshot
