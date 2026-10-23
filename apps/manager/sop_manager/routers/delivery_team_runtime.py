"""Explicit project Agent/Tool associations with real, immutable runtime profiles.

These records describe execution affiliation. They do not grant workspace
membership, runtime permissions or authority over the business task owner.
"""

from copy import deepcopy
from datetime import datetime, timezone

from fastapi import HTTPException
from hermes_core.agents import AgentProfile
from hermes_core.models import CoreError
from hermes_core.transactional import digest
from sqlalchemy.exc import SQLAlchemyError

from .hermes_workspace import runtime_identity

_BINDINGS = "member_runtime_bindings"
_IDENTITY_FIELDS = ("workspace_id", "agent_id", "agent_version", "profile_digest")


def _reason(code, message):
    return {"code": code, "message": message}


def _fail(code, message, status=409):
    raise HTTPException(status, _reason(code, message))


def _stamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _records(data):
    records = data.get(_BINDINGS, {})
    return records if isinstance(records, dict) else {}


def _record(data, member_id):
    value = _records(data).get(member_id)
    return value if isinstance(value, dict) else {}


def _generation(record):
    value = record.get("generation", 0)
    return value if type(value) is int and value >= 0 else 0


def _binding(record):
    binding = record.get("binding")
    return binding if record.get("status") == "bound" and isinstance(binding, dict) else None


def _member(data, member_id):
    matches = [
        item for item in data.get("members", []) if isinstance(item, dict) and item.get("id") == member_id
    ]
    return matches[0] if len(matches) == 1 else None


def _member_reasons(data, member_id):
    member = _member(data, member_id)
    if member_id.startswith("user:") or member and member.get("kind") not in {"agent", "tool"}:
        return [
            _reason(
                "executor_member_kind_unsupported",
                "Only registered Agent or Tool members can be associated with execution profiles.",
            )
        ]
    if member is None:
        return [
            _reason(
                "executor_member_missing", "The execution member is no longer registered in this project."
            )
        ]
    if member.get("active") is not True:
        return [
            _reason(
                "executor_member_inactive",
                "The execution member is inactive; restore it and explicitly associate a profile again.",
            )
        ]
    return []


def binding_basis(project, data, member_id):
    """Stable association identity; display names, placement and heartbeats are excluded."""
    record = _record(data, member_id)
    binding = _binding(record)
    return digest(
        {
            "tenant_id": project.tenant_id,
            "project_id": project.id,
            "member_id": member_id,
            "generation": _generation(record),
            "binding": {key: binding.get(key) for key in _IDENTITY_FIELDS} if binding else None,
        }
    )


def execution_binding_current(project, data, member_id, expected_basis):
    """Pure project-state check, also used to invalidate unhanded-off intents."""
    reasons = _member_reasons(data, member_id)
    record = _record(data, member_id)
    if _binding(record) is None:
        reasons.append(
            _reason("executor_unbound", "The execution member has no current profile association.")
        )
    if binding_basis(project, data, member_id) != expected_basis or _generation(record) < 1:
        reasons.append(
            _reason("executor_binding_changed", "The execution association changed; prepare a new plan.")
        )
    return {"current": not reasons, "reasons": reasons}


def _principal(project, user, store):
    if store is None:
        _fail("runtime_not_configured", "The execution runtime is not configured.", 503)
    if str(user.tenant_id) != str(project.tenant_id):
        _fail(
            "runtime_workspace_forbidden",
            "Execution profiles must belong to the same tenant as this project.",
            403,
        )
    principal = runtime_identity(user, store)
    if "read" not in principal.permissions:
        _fail("runtime_read_forbidden", "Runtime read permission is required.", 403)
    return principal


def _workspace(store, principal, workspace_id):
    # Store scopes SQL rows but does not enforce workspace_ids or permissions.
    # Check ACL before fetching any profile, even for project administrators.
    if principal.workspace_ids is not None and workspace_id not in principal.workspace_ids:
        _fail("runtime_workspace_forbidden", "Access to this execution workspace is required.", 403)
    try:
        workspace = store.get(principal, "", "workspaces", workspace_id)
    except CoreError as exc:
        if exc.status == 404:
            _fail("runtime_workspace_missing", "The associated execution workspace is unavailable.", 404)
        raise HTTPException(exc.status, _reason(exc.code, exc.message)) from exc
    if workspace["status"] != "active":
        _fail("runtime_workspace_inactive", "The associated execution workspace is inactive.")
    return workspace


def _profile(store, principal, workspace_id, agent_id):
    try:
        agent = store.get(principal, workspace_id, "agents", agent_id)
    except CoreError as exc:
        if exc.status == 404:
            _fail("runtime_agent_missing", "The associated execution profile is unavailable.", 404)
        raise HTTPException(exc.status, _reason(exc.code, exc.message)) from exc
    if agent["status"] != "active" or agent["data"].get("status", "active") != "active":
        _fail("runtime_agent_archived", "The associated execution profile is archived.")
    try:
        AgentProfile.model_validate(agent["data"])
    except ValueError as exc:
        raise HTTPException(
            409, _reason("runtime_agent_changed", "The execution profile is no longer valid.")
        ) from exc
    return agent


def _read_binding(project, user, store, binding):
    principal = _principal(project, user, store)
    workspace = _workspace(store, principal, binding["workspace_id"])
    agent = _profile(store, principal, workspace["id"], binding["agent_id"])
    if agent["version"] != binding["agent_version"] or digest(agent["data"]) != binding["profile_digest"]:
        _fail("runtime_agent_changed", "The execution profile changed; explicitly adopt the current version.")
    return workspace, agent


def resolve_executor_binding(
    db, project, data, user, store, *, member_id, expected_basis, workspace_id, agent_id, agent_version
):
    current = execution_binding_current(project, data, member_id, expected_basis)
    if not current["current"]:
        raise HTTPException(409, current["reasons"][0])
    record = _record(data, member_id)
    binding = _binding(record)
    if (workspace_id, agent_id, agent_version) != (
        binding["workspace_id"],
        binding["agent_id"],
        binding["agent_version"],
    ):
        _fail(
            "executor_selection_mismatch",
            "The selected workspace/profile/version does not match this execution member.",
        )
    _read_binding(project, user, store, binding)
    source = binding["source"]
    return {
        "member_id": member_id,
        "member_name": _member(data, member_id).get("name"),
        "binding_basis": expected_basis,
        "binding_generation": record["generation"],
        "workspace_id": workspace_id,
        "workspace_name": source["workspace_name"],
        "agent_id": agent_id,
        "agent_version": agent_version,
        "agent_title": source["agent_title"],
        "profile_digest": binding["profile_digest"],
        "provider": source["provider"],
        "recorded_at": binding["bound_at"],
        "recorded_by": binding["bound_by"],
    }


def invalidate_member_runtime_binding(data, member_id, *, actor, reason):
    """Persist a tombstone on lifecycle changes; restoration never rebinds it."""
    record = _record(data, member_id)
    if _binding(record) is None:
        return False
    data[_BINDINGS][member_id] = {
        "generation": _generation(record) + 1,
        "status": "unbound",
        "binding": None,
        "changed_by": actor,
        "changed_at": _stamp(),
        "reason": reason,
    }
    return True


def apply_runtime_binding(db, project, data, user, store, action, body):
    from .auth_sql import check_project_access
    from .delivery import _permissions

    check_project_access(user, project.id, db)
    if not _permissions(db, user, project)["configure"]:
        _fail("project_configure_required", "Project configure permission is required.", 403)
    member_id = body.member_id
    before = deepcopy(_record(data, member_id)) or None
    if action == "member.runtime.unbind":
        if not invalidate_member_runtime_binding(data, member_id, actor=user.id, reason="explicit_unbind"):
            _fail("executor_unbound", "The execution member has no profile association to remove.")
        return member_id, before
    if action != "member.runtime.bind":
        _fail("invalid_binding_action", "Choose an explicit bind or unbind action.", 422)
    reasons = _member_reasons(data, member_id)
    if reasons:
        raise HTTPException(422, reasons[0])
    principal = _principal(project, user, store)
    workspace = _workspace(store, principal, body.workspace_id)
    agent = _profile(store, principal, workspace["id"], body.agent_id)
    if type(body.agent_version) is not int or agent["version"] != body.agent_version:
        _fail(
            "runtime_agent_changed",
            "The selected execution profile version changed; reload and explicitly adopt it.",
        )
    at = _stamp()
    record = {
        "generation": _generation(before or {}) + 1,
        "status": "bound",
        "binding": {
            "workspace_id": workspace["id"],
            "agent_id": agent["id"],
            "agent_version": agent["version"],
            "profile_digest": digest(agent["data"]),
            "source": {
                "workspace_name": workspace["data"].get("name") or workspace["id"],
                "agent_title": agent["data"]["title"],
                "provider": agent["data"]["provider"],
            },
            "bound_by": user.id,
            "bound_at": at,
        },
        "changed_by": user.id,
        "changed_at": at,
        "reason": "explicit_bind",
    }
    data.setdefault(_BINDINGS, {})[member_id] = record
    return member_id, before


def _directory(project, user, store):
    principal = _principal(project, user, store)
    workspaces = []
    for workspace in store.list(principal, "", "workspaces", status="active", limit=10000):
        if principal.workspace_ids is not None and workspace["id"] not in principal.workspace_ids:
            continue
        agents = []
        for agent in store.list(principal, workspace["id"], "agents", status="active", limit=10000):
            try:
                profile = AgentProfile.model_validate(agent["data"])
            except ValueError:
                continue
            if profile.status == "active":
                agents.append(
                    {
                        "id": agent["id"],
                        "version": agent["version"],
                        "title": profile.title,
                        "provider": profile.provider,
                    }
                )
        workspaces.append(
            {
                "id": workspace["id"],
                "name": workspace["data"].get("name") or workspace["id"],
                "agents": agents,
            }
        )
    return workspaces


def runtime_bindings_view(db, project, data, user, store, *, can_configure, version):
    directory_reason = None
    try:
        workspaces = _directory(project, user, store)
    except HTTPException as exc:
        workspaces, directory_reason = [], exc.detail
    except SQLAlchemyError:
        workspaces, directory_reason = (
            [],
            _reason("runtime_unavailable", "The execution runtime cannot currently be read."),
        )
    member_ids = {
        item["id"]
        for item in data.get("members", [])
        if isinstance(item, dict) and item.get("kind") in {"agent", "tool"} and isinstance(item.get("id"), str)
    } | set(_records(data))
    members = []
    for member_id in sorted(member_ids):
        member = _member(data, member_id)
        supported = member is not None and member.get("kind") in {"agent", "tool"}
        record = _record(data, member_id)
        binding = _binding(record)
        reasons = _member_reasons(data, member_id)
        status = "unavailable" if reasons else "unbound"
        if binding is None:
            reasons.append(
                _reason("executor_unbound", "The execution member has no current profile association.")
            )
        elif not reasons:
            if directory_reason:
                reasons.append(directory_reason)
                status = "unavailable"
            else:
                try:
                    _read_binding(project, user, store, binding)
                    status = "current"
                except HTTPException as exc:
                    reasons.append(exc.detail)
                    status = "stale" if exc.detail.get("code") == "runtime_agent_changed" else "unavailable"
                except SQLAlchemyError:
                    reasons.append(
                        _reason("runtime_unavailable", "The execution runtime cannot currently be read.")
                    )
                    status = "unavailable"
        members.append(
            {
                "member_id": member_id,
                "member_name": member.get("name") if supported else None,
                "member_kind": member["kind"] if supported else None,
                "binding_basis": binding_basis(project, data, member_id),
                "generation": _generation(record),
                "binding": deepcopy(binding),
                "status": status,
                "reasons": reasons,
                "permissions": {
                    "can_bind": bool(
                        can_configure
                        and not _member_reasons(data, member_id)
                        and any(w["agents"] for w in workspaces)
                    ),
                    "can_unbind": bool(can_configure and binding is not None),
                },
            }
        )
    return {
        "project_id": project.id,
        "version": version,
        "as_of": _stamp(),
        "runtime_configured": store is not None,
        "workspaces": workspaces,
        "members": members,
    }
