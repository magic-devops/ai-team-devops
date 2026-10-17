"""Canonical deployment intents; runtime observations never rewrite release decisions."""

from copy import deepcopy
from urllib.parse import urlsplit

from fastapi import HTTPException
from hermes_core.models import CoreError
from hermes_core.transactional import digest

from .delivery_deployment_contract import DeploymentEnvironmentDefinition
from .delivery_execution import context
from .delivery_release import _candidate_reasons
from .delivery_service import identifier, stamp
from .hermes_workspace import runtime_identity

ACTIVE = frozenset({"pending_dispatch", "planned", "queued", "running", "awaiting_promotion", "unknown"})
COMPLETE = frozenset({"verified", "rolled_back"})


def _deny(status, code, message):
    raise HTTPException(status, {"code": code, "message": message})


def _reason(code, message):
    return {"code": code, "message": message}


def _project_state_reasons(project):
    return (
        []
        if project.status == "active"
        else [
            _reason(
                "project_not_active",
                "Activate the project before preparing or starting new deployment operations.",
            )
        ]
    )


def _semantic_snapshot(snapshot):
    value = deepcopy(snapshot)
    if value:
        # A heartbeat refreshes observation time, not pinned execution authority.
        for field in ("last_seen_at", "expires_at"):
            value["target_snapshot"].pop(field, None)
    return value


def _find(data, key, id):
    row = next((row for row in data.get(key, []) if row["id"] == id), None)
    if row is None:
        _deny(404, "deployment_not_found", "Deployment resource not found in this project.")
    return row


def _permissions(db, project, user, store):
    from .auth_sql import check_project_access
    from .delivery import _permissions as project_permissions

    check_project_access(user, project.id, db)
    if user.status != "active":
        _deny(403, "deployment_actor_inactive", "An active project identity is required.")
    permissions = project_permissions(db, user, project)
    runtime = runtime_identity(user, store) if store is not None else None
    execute = bool(
        runtime and runtime.tenant == project.tenant_id and {"read", "execute"}.issubset(runtime.permissions)
    )
    return {
        "can_configure": permissions["configure"],
        "can_prepare": permissions["approve"] and execute and project.status == "active",
        "can_operate": permissions["approve"] and execute,
        "can_sync": permissions["write"]
        and bool(runtime and runtime.tenant == project.tenant_id and "read" in runtime.permissions),
    }


def _context(store, user, project, workspace, permission="read"):
    principal, row = context(store, user, workspace, permission)
    if principal.tenant != project.tenant_id or "read" not in principal.permissions:
        _deny(
            403,
            "deployment_runtime_scope",
            "Runtime identity must belong to the project tenant and have workspace read access.",
        )
    return principal, row


def active_deployment_ids(data):
    return [row["id"] for row in data.get("deployments", []) if row["status"] in ACTIVE]


def _latest_physical(data, environment_id):
    return next(
        (
            row
            for row in reversed(data.get("deployments", []))
            if row["environment_id"] == environment_id and row.get("physical_started")
        ),
        None,
    )


def deployment_verified_for_release(data, candidate_id):
    """Physical projection only; caller checks current canonical candidate authority."""
    for row in reversed(data.get("deployments", [])):
        if (
            row["candidate_id"] != candidate_id
            or row["status"] not in COMPLETE
            or row.get("actual_traffic") != 100
        ):
            continue
        environment = next(
            (
                value
                for value in data.get("deployment_environments", [])
                if value["id"] == row["environment_id"]
            ),
            None,
        )
        if (
            not environment
            or not environment["active"]
            or environment["generation"] != row["snapshot"]["environment_generation"]
        ):
            continue
        if _latest_physical(data, row["environment_id"]) is row:
            return True
    return False


def _baseline(data, environment_id):
    for row in reversed(data.get("deployments", [])):
        if (
            row["environment_id"] == environment_id
            and row["status"] in COMPLETE
            and row.get("actual_traffic") == 100
        ):
            snapshot = row["snapshot"]
            return {
                "deployment_id": row["id"],
                "candidate_id": row["candidate_id"],
                "candidate_snapshot": deepcopy(snapshot["candidate_snapshot"]),
                "environment_id": environment_id,
                "environment_generation": snapshot["environment_generation"],
                "target_snapshot": deepcopy(snapshot["target_snapshot"]),
                "verified_at": row["verified_at"],
            }
    return None


def _validity(db, project, data, row):
    candidate = next(
        (value for value in data.get("release_candidates", []) if value["id"] == row["candidate_id"]), None
    )
    if candidate is None:
        return [_reason("deployment_candidate_missing", "The original candidate is unavailable.")]
    reasons = [
        _reason(value["code"], value["message"]) for value in _candidate_reasons(db, project, data, candidate)
    ]
    if candidate.get("invalidated") or candidate["decision"] != "approved":
        reasons.append(
            _reason("deployment_candidate_unapproved", "The candidate no longer has effective approval.")
        )
    if candidate["snapshot"] != row["snapshot"]["candidate_snapshot"]:
        reasons.append(
            _reason(
                "deployment_candidate_changed", "The candidate differs from the frozen deployment source."
            )
        )
    return list({value["code"]: value for value in reasons}.values())


def _environment_view(data, environment, permissions):
    locked = [
        row["id"]
        for row in data.get("deployments", [])
        if row["environment_id"] == environment["id"] and row["status"] in ACTIVE
    ]
    reasons = (
        [_reason("deployment_environment_busy", "An unfinished deployment holds this environment.")]
        if locked
        else []
    )
    return {
        **deepcopy(environment),
        "locked_by": locked,
        "can_edit": permissions["can_configure"] and not locked,
        "reasons": reasons,
    }


def _basis(row, reasons):
    return digest({"deployment": row, "reasons": reasons})


def _view(db, project, data, user, row, permissions, store):
    reasons = _validity(db, project, data, row)
    active = project.status == "active"
    reasons.extend(_project_state_reasons(project))
    environment = next(
        (value for value in data.get("deployment_environments", []) if value["id"] == row["environment_id"]),
        None,
    )
    compatible = bool(
        environment
        and environment["active"]
        and environment["generation"] == row["snapshot"]["environment_generation"]
    )
    if not compatible:
        reasons.append(
            _reason(
                "deployment_environment_changed", "The environment differs from the fixed deployment plan."
            )
        )
    can_runtime_read = False
    can_runtime_execute = False
    if store is not None:
        try:
            principal, _ = _context(store, user, project, row["snapshot"]["definition"]["workspace_id"])
            can_runtime_read = True
            can_runtime_execute = "execute" in principal.permissions
        except (HTTPException, CoreError):
            reasons.append(
                _reason("deployment_runtime_unavailable", "Runtime workspace access is unavailable.")
            )
    operate = permissions["can_operate"] and can_runtime_execute
    status = row["status"]
    normal_valid = not reasons or row["kind"] == "rollback" and compatible and can_runtime_read
    actions = {
        "can_dispatch": operate
        and (active or row["operations"][-1]["observe"])
        and status == "pending_dispatch",
        "can_start": operate
        and (active or row["operations"][-1]["observe"])
        and status in {"planned", "queued"},
        "can_advance": operate and active and normal_valid and compatible and status == "awaiting_promotion",
        "can_observe": operate and can_runtime_read and status == "unknown",
        "can_cancel": operate
        and status in {"pending_dispatch", "planned", "queued", "running", "awaiting_promotion"},
        "can_sync": permissions["can_sync"] and can_runtime_read and bool(row["operations"]),
        "can_rollback": operate
        and active
        and compatible
        and status
        not in {"pending_dispatch", "planned", "queued", "running", "awaiting_promotion", "unknown"}
        and row["snapshot"]["baseline"] is not None
        and row["snapshot"]["baseline"]["environment_generation"] == row["snapshot"]["environment_generation"]
        and row["snapshot"]["baseline"]["target_snapshot"]["basis"]
        == row["snapshot"]["target_snapshot"]["basis"]
        and _latest_physical(data, row["environment_id"]) is row,
        "reasons": reasons,
    }
    if not operate:
        actions["reasons"] = [
            *reasons,
            _reason(
                "deployment_execute_required",
                "Project approval and runtime execution permission are both required.",
            ),
        ]
    public = {key: deepcopy(value) for key, value in row.items() if key not in {"physical_started"}}
    return {
        **public,
        "current": compatible and _latest_physical(data, row["environment_id"]) is row and status in COMPLETE,
        "business_valid": not reasons
        and status in COMPLETE
        and deployment_verified_for_release(data, row["candidate_id"]),
        "reasons": reasons,
        "basis": _basis(row, reasons),
        "actions": actions,
    }


def _can_read_workspace(store, user, project, workspace_id):
    try:
        _context(store, user, project, workspace_id)
    except (CoreError, HTTPException):
        return False
    return True


def deployment_index(db, project, data, user, *, version, store=None, execution=None):
    permissions = _permissions(db, project, user, store)
    environments = [
        row
        for row in data.get("deployment_environments", [])
        if _can_read_workspace(store, user, project, row["definition"]["workspace_id"])
    ]
    deployments = [
        row
        for row in reversed(data.get("deployments", []))
        if _can_read_workspace(store, user, project, row["snapshot"]["definition"]["workspace_id"])
    ]
    return {
        "project_id": project.id,
        "version": version,
        "as_of": stamp(),
        "environments": [_environment_view(data, row, permissions) for row in environments],
        "deployments": [_view(db, project, data, user, row, permissions, store) for row in deployments],
        "permissions": permissions,
    }


def deployment_detail(db, project, data, user, id, *, version, store=None, execution=None):
    permissions = _permissions(db, project, user, store)
    row = _find(data, "deployments", id)
    _context(store, user, project, row["snapshot"]["definition"]["workspace_id"])
    return {
        "project_id": project.id,
        "version": version,
        "as_of": stamp(),
        "deployment": _view(db, project, data, user, row, permissions, store),
        "environments": [
            _environment_view(data, value, permissions)
            for value in data.get("deployment_environments", [])
            if _can_read_workspace(store, user, project, value["definition"]["workspace_id"])
        ],
        "permissions": permissions,
    }


def _artifact_reasons(candidate, definition):
    artifact = urlsplit(candidate["artifact_url"])
    if f"https://{artifact.netloc}" in definition["artifact_origins"]:
        return []
    return [
        _reason(
            "deployment_artifact_origin",
            "The immutable artifact origin is not authorized by this environment.",
        )
    ]


def _plan_reasons(project, user, store, execution, snapshot):
    if snapshot is None:
        return []
    try:
        _operation(project, user, store, snapshot, 0, execution=execution)
    except (ValueError, CoreError, HTTPException):
        return [
            _reason(
                "deployment_plan_invalid",
                "The fixed plan or installed runner arguments cannot be executed within the runtime limits.",
            )
        ]
    return []


def deployment_preview(db, project, data, user, body, *, version, store=None, execution=None):
    from hermes_core.execution_targets import select_execution_target

    permissions = _permissions(db, project, user, store)
    reasons = _project_state_reasons(project)
    authority = None
    if body.rollback_of:
        source = _find(data, "deployments", body.rollback_of)
        environment = _find(data, "deployment_environments", source["environment_id"])
        baseline = source["snapshot"]["baseline"]
        if baseline is None:
            reasons.append(
                _reason(
                    "deployment_baseline_missing",
                    "No actually verified stable version is frozen for rollback.",
                )
            )
        if _latest_physical(data, source["environment_id"]) is not source:
            reasons.append(
                _reason(
                    "deployment_rollback_superseded", "A newer deployment has replaced this physical attempt."
                )
            )
        candidate_id = baseline["candidate_id"] if baseline else source["candidate_id"]
        candidate_snapshot = (
            baseline["candidate_snapshot"] if baseline else source["snapshot"]["candidate_snapshot"]
        )
        kind = "rollback"
    else:
        candidate = _find(data, "release_candidates", body.candidate_id)
        environment = _find(data, "deployment_environments", body.environment_id)
        candidate_id, candidate_snapshot = candidate["id"], candidate["snapshot"]
        authority = {
            key: deepcopy(candidate.get(key))
            for key in ("decision", "reviews", "invalidated", "invalidated_reasons")
        }
        reasons.extend(
            _reason(value["code"], value["message"])
            for value in _candidate_reasons(db, project, data, candidate)
        )
        if candidate["decision"] != "approved" or candidate.get("invalidated"):
            reasons.append(
                _reason("deployment_candidate_unapproved", "Prepare a currently valid approved candidate.")
            )
        baseline, kind = _baseline(data, environment["id"]), "deploy"
    if candidate_snapshot["environment"] != environment["name"]:
        reasons.append(
            _reason(
                "deployment_environment_mismatch",
                "Candidate environment must exactly match the configured environment name.",
            )
        )
    reasons.extend(_artifact_reasons(candidate_snapshot, environment["definition"]))
    if not environment["active"]:
        reasons.append(
            _reason("deployment_environment_inactive", "Activate this environment before deploying.")
        )
    busy = [
        row["id"]
        for row in data.get("deployments", [])
        if row["environment_id"] == environment["id"] and row["status"] in ACTIVE
    ]
    if busy:
        reasons.append(
            _reason("deployment_environment_busy", "An unfinished deployment holds this environment.")
        )
    if not permissions["can_prepare"]:
        reasons.append(
            _reason(
                "deployment_execute_required",
                "Project approval and runtime execution permission are both required.",
            )
        )
    snapshot = None
    target = None
    try:
        principal, _ = _context(store, user, project, environment["definition"]["workspace_id"], "execute")
        target = select_execution_target(
            store,
            execution,
            principal,
            environment["definition"]["workspace_id"],
            target_kind="device" if environment["definition"]["target_device_id"] else "local",
            target_device_id=environment["definition"]["target_device_id"],
        )
    except (HTTPException, CoreError) as exc:
        reasons.append(
            _reason(
                "deployment_target_unavailable",
                str(exc.detail) if isinstance(exc, HTTPException) else exc.message,
            )
        )
    if (
        body.rollback_of
        and baseline
        and (
            baseline["environment_generation"] != environment["generation"]
            or target
            and baseline["target_snapshot"]["basis"] != target["basis"]
        )
    ):
        reasons.append(
            _reason(
                "deployment_baseline_incompatible",
                "The rollback baseline belongs to a different environment generation or target.",
            )
        )
    if target:
        snapshot = {
            "kind": kind,
            "candidate_id": candidate_id,
            "candidate_snapshot": deepcopy(candidate_snapshot),
            "environment_id": environment["id"],
            "environment_name": environment["name"],
            "environment_generation": environment["generation"],
            "definition": deepcopy(environment["definition"]),
            "target_snapshot": target,
            "baseline": deepcopy(baseline),
            "rollback_of": body.rollback_of,
            "traffic_steps": [100] if kind == "rollback" else environment["definition"]["traffic_steps"],
            "reason": body.reason,
        }
    reasons.extend(_plan_reasons(project, user, store, execution, snapshot))
    history = [
        {"id": row["id"], "status": row["status"], "updated_at": row["updated_at"]}
        for row in data.get("deployments", [])
        if row["environment_id"] == environment["id"]
    ]
    basis = digest(
        {
            "input": body.model_dump(exclude={"preview_basis"}),
            "snapshot": _semantic_snapshot(snapshot),
            "authority": authority,
            "history": history,
            "actor": user.id,
            "permissions": permissions,
        }
    )
    return {
        "project_id": project.id,
        "version": version,
        "as_of": stamp(),
        "allowed": not reasons,
        "reasons": reasons,
        "preview_basis": basis,
        "snapshot": snapshot,
        "permissions": permissions,
    }


def _save_environment(db, project, user, data, body, store):
    _context(store, user, project, body.workspace_id)
    existing = _find(data, "deployment_environments", body.id) if body.id else None
    if any(
        row["name"] == body.name and row["id"] != body.id for row in data.get("deployment_environments", [])
    ):
        _deny(409, "deployment_environment_duplicate", "Environment names must be unique within the project.")
    if existing and _environment_view(data, existing, {"can_configure": True})["locked_by"]:
        _deny(
            409,
            "deployment_environment_busy",
            "Finish or recover the active deployment before changing the environment.",
        )
    now = stamp()
    definition = DeploymentEnvironmentDefinition.model_validate(
        body.model_dump(exclude={"id", "name", "active"})
    ).model_dump()
    row = {
        "id": body.id or identifier("ENV"),
        "name": body.name,
        "active": body.active,
        "generation": (existing["generation"] if existing else 0) + 1,
        "definition": definition,
        "created_at": existing["created_at"] if existing else now,
        "updated_at": now,
    }
    before = deepcopy(existing)
    if existing:
        existing.clear()
        existing.update(row)
    else:
        data.setdefault("deployment_environments", []).append(row)
    return row["id"], before, {"environment_id": row["id"]}


def _operation(project, user, store, snapshot, index, *, original=None, execution=None):
    from hermes_core.deployment_contract import OperationPlan
    from hermes_core.deployments import ManagedDeployments

    principal, _ = _context(store, user, project, snapshot["definition"]["workspace_id"], "execute")
    id = identifier("DOP")
    definition = snapshot["definition"]
    candidate = snapshot["candidate_snapshot"]
    plan = (
        original["plan"]
        if original
        else OperationPlan.model_validate(
            {
                "protocol": "sop.deployment.v1",
                "operation_id": id,
                "tenant_id": project.tenant_id,
                "project_id": project.id,
                "environment_id": snapshot["environment_id"],
                "environment_generation": snapshot["environment_generation"],
                "candidate_id": snapshot["candidate_id"],
                "kind": snapshot["kind"],
                "artifact_url": candidate["artifact_url"],
                "artifact_sha256": candidate["ci"]["artifact_sha256"],
                "commit_sha": candidate["ci"]["commit_sha"],
                "traffic_percent": snapshot["traffic_steps"][index],
                **{
                    key: definition[key]
                    for key in (
                        "apply_argv",
                        "probe_argv",
                        "artifact_origins",
                        "max_artifact_bytes",
                        "timeout_seconds",
                        "observation_seconds",
                        "min_samples",
                    )
                },
            }
        ).model_dump(mode="json")
    )
    ManagedDeployments(store, execution).prepare(
        principal,
        snapshot["definition"]["workspace_id"],
        plan=plan,
        runner_argv=snapshot["definition"]["runner_argv"],
        target_snapshot=snapshot["target_snapshot"],
    )
    return {
        "id": id,
        "index": index,
        "observe": original is not None,
        "status": "pending_dispatch",
        "plan": deepcopy(plan),
        "plan_digest": digest(plan),
        "requested_by": {"id": user.id, "name": user.username},
        "runtime_scope": {
            "actor": principal.actor,
            "tenant": principal.tenant,
            "business": principal.business,
        },
        "run_id": None,
        "run_version": None,
        "run_status": None,
        "result": None,
        "created_at": stamp(),
        "updated_at": stamp(),
    }


def _create(db, project, user, data, body, store, execution):
    proposal = deployment_preview(db, project, data, user, body, version=0, store=store, execution=execution)
    if body.preview_basis != proposal["preview_basis"]:
        _deny(
            409,
            "deployment_preview_changed",
            "Deployment context changed; explicitly review a fresh preview.",
        )
    if not proposal["allowed"]:
        _deny(
            409,
            "deployment_ineligible",
            "Resolve every deployment preview blocker before creating an intent.",
        )
    snapshot = proposal["snapshot"]
    operation = _operation(project, user, store, snapshot, 0, execution=execution)
    row = {
        "id": identifier("DEP"),
        "candidate_id": snapshot["candidate_id"],
        "environment_id": snapshot["environment_id"],
        "kind": snapshot["kind"],
        "status": "pending_dispatch",
        "requested_by": {"id": user.id, "name": user.username},
        "snapshot": snapshot,
        "operations": [operation],
        "created_at": stamp(),
        "updated_at": stamp(),
        "verified_at": None,
        "actual_traffic": None,
        "issue_id": None,
        "physical_started": False,
    }
    data.setdefault("deployments", []).append(row)
    return row["id"], None, {"deployment_id": row["id"]}


def apply_deployment(db, project, user, data, action, body, store=None, execution=None):
    permissions = _permissions(db, project, user, store)
    if project.status == "archived":
        _deny(409, "project_archived", "Restore the project before changing deployments.")
    needed = (
        "can_configure"
        if action == "deployment.environment.save"
        else "can_sync"
        if action == "deployment.sync"
        else "can_operate"
    )
    if not permissions[needed]:
        _deny(
            403,
            "deployment_permission_required",
            "Project permission and runtime authority are required for this deployment action.",
        )
    try:
        if action == "deployment.environment.save":
            return _save_environment(db, project, user, data, body, store)
        if action == "deployment.create":
            return _create(db, project, user, data, body, store, execution)
        row = _find(data, "deployments", body.id)
        before = deepcopy(row)
        view = _view(db, project, data, user, row, permissions, store)
        if action != "deployment.sync" and body.basis != view["basis"]:
            _deny(409, "deployment_basis_changed", "Deployment evidence changed; reload before acting.")
        from .delivery_deployment_runtime import apply_operation

        result = apply_operation(db, project, user, data, row, action, store, execution)
        return row["id"], before, result
    except CoreError as exc:
        _deny(exc.status, exc.code, exc.message)
