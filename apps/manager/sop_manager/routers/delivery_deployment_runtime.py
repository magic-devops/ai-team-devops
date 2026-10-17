"""Explicit handoff and observation of immutable managed deployment operations."""

from dataclasses import replace

from hermes_core.deployment_contract import OperationResult, strict_json
from hermes_core.deployments import ManagedDeployments, receipt_request
from hermes_core.transactional import digest

from .delivery_deployment import (
    COMPLETE,
    _context,
    _deny,
    _find,
    _operation,
    _permissions,
    _validity,
)
from .delivery_service import identifier, stamp
from .sql_models import Issue, User


def _scope(principal, operation):
    scope = operation["runtime_scope"]
    if (principal.tenant, principal.business) != (scope["tenant"], scope["business"]):
        _deny(403, "deployment_runtime_scope", "The runtime scope differs from the original operation.")
    # Receipts are scoped by the original actor; retain the caller's permissions.
    return replace(principal, actor=scope["actor"])


def _request(row, operation):
    snapshot = row["snapshot"]
    return receipt_request(
        operation["plan"],
        snapshot["definition"]["runner_argv"],
        snapshot["target_snapshot"],
        operation["observe"],
    )


def _assert_environment(data, row):
    environment = _find(data, "deployment_environments", row["environment_id"])
    snapshot = row["snapshot"]
    if (
        not environment["active"]
        or environment["generation"] != snapshot["environment_generation"]
        or environment["definition"] != snapshot["definition"]
    ):
        _deny(
            409,
            "deployment_environment_changed",
            "The fixed environment changed; no new side effect is allowed.",
        )
    if any(
        value["id"] != row["id"]
        and value["environment_id"] == row["environment_id"]
        and value["status"]
        in {"pending_dispatch", "planned", "queued", "running", "awaiting_promotion", "unknown"}
        for value in data.get("deployments", [])
    ):
        _deny(409, "deployment_environment_busy", "Another deployment owns the environment.")


def _assert_business(db, project, data, row):
    from .project_lifecycle import require_active

    require_active(project)
    _assert_environment(data, row)
    if row["kind"] == "deploy" and _validity(db, project, data, row):
        _deny(
            409, "deployment_candidate_changed", "The candidate is no longer eligible for a new side effect."
        )
    if row["kind"] == "rollback":
        baseline = row["snapshot"]["baseline"]
        original = _find(data, "deployments", baseline["deployment_id"]) if baseline else None
        if (
            not original
            or original["status"] not in COMPLETE
            or original["actual_traffic"] != 100
            or original["snapshot"]["candidate_snapshot"] != row["snapshot"]["candidate_snapshot"]
        ):
            _deny(
                409,
                "deployment_baseline_invalid",
                "Rollback must restore the actually verified frozen baseline.",
            )


def _origin(db, project, data, row, operation, store):
    user = db.get(User, operation["requested_by"]["id"])
    if user is None or user.status != "active":
        _deny(
            403,
            "deployment_originator_inactive",
            "The operation originator is inactive; recover existing receipts or cancel the intent.",
        )
    if not _permissions(db, project, user, store)["can_operate"]:
        _deny(
            403,
            "deployment_originator_permission",
            "The operation originator no longer has approval and runtime execution authority.",
        )
    principal, _ = _context(store, user, project, row["snapshot"]["definition"]["workspace_id"], "execute")
    if any(getattr(principal, key) != value for key, value in operation["runtime_scope"].items()):
        _deny(403, "deployment_originator_scope", "The original runtime scope changed.")
    return principal


def _verify_run(row, operation, run):
    snapshot = row["snapshot"]
    source = run["data"].get("deployment_source", {})
    if (
        source.get("plan") != operation["plan"]
        or source.get("plan_digest") != operation["plan_digest"]
        or source.get("observe") is not operation["observe"]
        or source.get("requested_by") != operation["runtime_scope"]["actor"]
        or run["workspace"] != snapshot["definition"]["workspace_id"]
        or run["tenant"] != operation["runtime_scope"]["tenant"]
        or run["business"] != operation["runtime_scope"]["business"]
        or run["data"].get("target_snapshot") != snapshot["target_snapshot"]
    ):
        _deny(
            409, "deployment_run_mismatch", "The runtime run does not match the immutable operation source."
        )


def _recover(store, principal, row, operation):
    workspace = row["snapshot"]["definition"]["workspace_id"]
    origin = _scope(principal, operation)
    if operation["run_id"]:
        run = store.get(origin, workspace, "runs", operation["run_id"])
    else:
        receipt = store.receipt(
            origin, workspace, "deployment.dispatch", operation["id"], _request(row, operation)
        )
        if receipt is None:
            return None
        run = store.get(origin, workspace, "runs", receipt["id"])
    _verify_run(row, operation, run)
    return run


def _record(row, operation, run):
    operation.update(
        run_id=run["id"], run_version=run["version"], run_status=run["status"], updated_at=stamp()
    )
    if run["status"] in {"planned", "queued", "running"}:
        operation["status"] = row["status"] = run["status"]
    if (
        run["status"] in {"queued", "running", "completed", "failed", "interrupted"}
        and not operation["observe"]
    ):
        row["physical_started"] = True
        row["actual_traffic"] = None
    row["updated_at"] = stamp()


def _issue(db, project, row, operation, message):
    if row.get("issue_id"):
        return
    id = identifier("ISS")
    db.add(
        Issue(
            id=id,
            tenant_id=project.tenant_id,
            project_id=project.id,
            title=f"Deployment {row['status']}: {row['snapshot']['environment_name']}"[:256],
            description=f"Deployment: {row['id']}\nOperation: {operation['id']}\nCandidate: {row['candidate_id']}\nEnvironment: {row['environment_id']}\nRun: {operation.get('run_id') or 'unavailable'}\nStage: {operation['status']}\n{message}",
            type="bug",
            severity="P1",
            status="open",
            reported_by="deployment-runtime",
        )
    )
    row["issue_id"] = id


def _unknown(db, project, row, operation, message):
    operation["status"] = row["status"] = "unknown"
    operation["updated_at"] = row["updated_at"] = stamp()
    _issue(db, project, row, operation, message)


def _result(operation, run):
    node = run["data"].get("node_results", {}).get("deployment")
    if not isinstance(node, dict):
        raise ValueError("The deployment node has no complete result")
    result = OperationResult.model_validate(strict_json(node.get("stdout", ""), max_bytes=65536)).model_dump(
        mode="json"
    )
    plan = operation["plan"]
    if (
        result["operation_id"] != plan["operation_id"]
        or result["request_digest"] != digest(plan)
        or result["request_digest"] != operation["plan_digest"]
        or result["artifact_sha256"] != plan["artifact_sha256"]
        or result["traffic_percent"] != plan["traffic_percent"]
    ):
        raise ValueError("Runner evidence differs from the fixed operation identity, artifact or traffic")
    if result["status"] == "verified":
        if run["status"] != "completed" or node.get("succeeded") is not True or node.get("exit_code") != 0:
            raise ValueError("A verified runner result requires a completed successful command")
        if (
            result["observation_seconds"] < plan["observation_seconds"]
            or len(result["probes"]) < plan["min_samples"]
        ):
            raise ValueError("The actual observation window or independent probe count is insufficient")
    return result


def _sync(db, project, user, row, store):
    operation = row["operations"][-1]
    principal, _ = _context(store, user, project, row["snapshot"]["definition"]["workspace_id"])
    run = _recover(store, principal, row, operation)
    if run is None:
        return {"deployment_id": row["id"], "observed": False}
    # A later observation operation is the only recovery authority; terminal
    # evidence remains immutable when late callbacks arrive for older runs.
    if operation["status"] in {"verified", "failed", "cancelled"}:
        return {"deployment_id": row["id"], "observed": True}
    _record(row, operation, run)
    if run["status"] in {"planned", "queued", "running"}:
        return {"deployment_id": row["id"], "observed": True}
    try:
        result = _result(operation, run)
    except (ValueError, TypeError, KeyError) as exc:
        _unknown(db, project, row, operation, str(exc))
        return {"deployment_id": row["id"], "observed": True}
    operation["result"] = result
    operation["status"] = result["status"]
    if result["status"] == "verified":
        row["actual_traffic"] = result["traffic_percent"]
        if result["traffic_percent"] == 100:
            row["status"] = "rolled_back" if row["kind"] == "rollback" else "verified"
            row["verified_at"] = result["finished_at"]
        else:
            row["status"] = "awaiting_promotion"
    elif result["status"] == "failed":
        row["status"] = "failed"
        _issue(db, project, row, operation, result["error"])
    else:
        _unknown(db, project, row, operation, result["error"])
    row["updated_at"] = stamp()
    return {"deployment_id": row["id"], "observed": True}


def _dispatch(db, project, user, data, row, store, execution):
    operation = row["operations"][-1]
    workspace = row["snapshot"]["definition"]["workspace_id"]
    principal, _ = _context(store, user, project, workspace, "execute")
    if row["status"] != "pending_dispatch":
        _deny(409, "deployment_transition_invalid", "This deployment already has a runtime handoff.")
    run = _recover(store, principal, row, operation)
    if run is None:
        if operation["observe"]:
            _assert_environment(data, row)
        else:
            _assert_business(db, project, data, row)
        origin = _origin(db, project, data, row, operation, store)
        run = ManagedDeployments(store, execution).dispatch(
            origin,
            workspace,
            plan=operation["plan"],
            runner_argv=row["snapshot"]["definition"]["runner_argv"],
            target_snapshot=row["snapshot"]["target_snapshot"],
            key=operation["id"],
            observe=operation["observe"],
        )
    _verify_run(row, operation, run)
    _record(row, operation, run)
    if run["status"] not in {"planned", "queued", "running"}:
        return _sync(db, project, user, row, store)
    return {"deployment_id": row["id"]}


def _start(db, project, user, data, row, store, execution):
    operation = row["operations"][-1]
    workspace = row["snapshot"]["definition"]["workspace_id"]
    principal, _ = _context(store, user, project, workspace, "execute")
    if row["status"] not in {"planned", "queued"}:
        _deny(409, "deployment_transition_invalid", "Dispatch the deployment before starting it.")
    run = _recover(store, principal, row, operation)
    if run is None:
        _deny(409, "deployment_run_missing", "The dispatched run is unavailable.")
    origin_scope = _scope(principal, operation)
    cached = store.receipt(
        origin_scope, workspace, f"deployment.start:{run['id']}", operation["id"], {"run_id": run["id"]}
    )
    if cached is None:
        if operation["observe"]:
            _assert_environment(data, row)
        else:
            _assert_business(db, project, data, row)
        origin = _origin(db, project, data, row, operation, store)
        ManagedDeployments(store, execution).start(origin, workspace, run["id"], key=operation["id"])
    run = store.get(origin_scope, workspace, "runs", run["id"])
    _verify_run(row, operation, run)
    _record(row, operation, run)
    if run["status"] not in {"planned", "queued", "running"}:
        return _sync(db, project, user, row, store)
    result = {"deployment_id": row["id"]}
    if run["status"] == "queued" and not run["data"].get("target_device_id"):
        result["start_run"] = {"workspace_id": workspace, "run_id": run["id"]}
    return result


def _cancel(db, project, user, data, row, store, execution):
    operation = row["operations"][-1]
    workspace = row["snapshot"]["definition"]["workspace_id"]
    principal, _ = _context(store, user, project, workspace, "execute")
    if row["status"] not in {"pending_dispatch", "planned", "queued", "running", "awaiting_promotion"}:
        _deny(409, "deployment_transition_invalid", "This deployment cannot be cancelled.")
    run = _recover(store, principal, row, operation)
    uncertain = operation["observe"] or (
        bool(run and run["status"] not in {"planned", "cancelled"}) and row["status"] != "awaiting_promotion"
    )
    if run and run["status"] in {"planned", "queued", "running", "interrupted"}:
        run = ManagedDeployments(store, execution).cancel(
            _scope(principal, operation), workspace, run["id"], key=operation["id"]
        )
        _record(row, operation, run)
    if uncertain:
        _unknown(
            db,
            project,
            row,
            operation,
            "Execution or its recovery was cancelled; inspect actual side effects with read-only observation.",
        )
    else:
        operation["status"] = row["status"] = "cancelled"
    return {"deployment_id": row["id"]}


def apply_operation(db, project, user, data, row, action, store, execution):
    if action == "deployment.sync":
        return _sync(db, project, user, row, store)
    handlers = {"deployment.dispatch": _dispatch, "deployment.start": _start, "deployment.cancel": _cancel}
    if action in handlers:
        return handlers[action](db, project, user, data, row, store, execution)
    operation = row["operations"][-1]
    if action == "deployment.advance":
        if row["status"] != "awaiting_promotion":
            _deny(409, "deployment_transition_invalid", "Only a verified partial rollout can advance.")
        _assert_business(db, project, data, row)
        index = operation["index"] + 1
        if index >= len(row["snapshot"]["traffic_steps"]):
            _deny(409, "deployment_transition_invalid", "The rollout has no further traffic step.")
        row["operations"].append(
            _operation(project, user, store, row["snapshot"], index, execution=execution)
        )
    elif action == "deployment.observe":
        if row["status"] != "unknown":
            _deny(
                409,
                "deployment_transition_invalid",
                "Read-only recovery is available only for an unknown result.",
            )
        _assert_environment(data, row)
        row["operations"].append(
            _operation(
                project,
                user,
                store,
                row["snapshot"],
                operation["index"],
                original=operation,
                execution=execution,
            )
        )
    else:
        _deny(422, "deployment_action_invalid", "Unknown deployment action.")
    row["status"] = "pending_dispatch"
    row["updated_at"] = stamp()
    return {"deployment_id": row["id"]}
