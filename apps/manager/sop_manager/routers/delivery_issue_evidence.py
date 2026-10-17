"""Pure, scoped Issue evidence. Only sanitized projections leave this module."""

import json
import re
from copy import deepcopy

from fastapi import HTTPException
from hermes_core.models import CoreError
from hermes_core.transactional import digest

from .delivery_issue_contract import EvidenceItem, IssueRecord
from .delivery_service import get_record, records, serialize
from .delivery_task_contract import semantic_snapshot
from .delivery_verification import VerificationContext
from .hermes_workspace import runtime_identity
from .sql_models import Issue, Requirement, Task

_VOLATILE = {
    "observed_at",
    "as_of",
    "updated_at",
    "lease_expires_at",
    "heartbeat_at",
    "last_seen_at",
    "presence",
    "run_version",
}
_PEM = re.compile(
    r"-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----"
    r"[\s\S]*?(?:-----END (?:[A-Z0-9 ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|$)",
    re.IGNORECASE,
)
_BEARER = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
_ASSIGNMENT = re.compile(
    r"(?P<name>[\"']?\b(?:[A-Za-z0-9_.-]{0,80}[_\-.])?"
    r"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|"
    r"client[_-]?secret|secret[_-]?access[_-]?key|private[_-]?key|password|passwd|secret|token|authorization|credential)"
    r"(?:[_\-.][A-Za-z0-9_.-]{1,80})?[\"']?\s*[:=]\s*)"
    r"(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s,;&}\]\r\n]+)",
    re.IGNORECASE,
)
_TOKEN = re.compile(
    r"\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|"
    r"github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b"
)
_URL_CREDENTIAL = re.compile(r"(https?://)[^/\s:@]+:[^/\s@]+@", re.IGNORECASE)
_CONTROLS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _semantic(value):
    if isinstance(value, dict):
        return {key: _semantic(item) for key, item in value.items() if key not in _VOLATILE}
    if isinstance(value, list):
        return [_semantic(item) for item in value]
    return value


def _clean(value, limit=4000):
    original = str(value or "")
    text = _PEM.sub("[REDACTED]", original)
    text = _BEARER.sub("Bearer [REDACTED]", text)
    text = _ASSIGNMENT.sub(lambda match: match["name"] + "[REDACTED]", text)
    text = _TOKEN.sub("[REDACTED]", text)
    text = _URL_CREDENTIAL.sub(r"\1[REDACTED]@", text)
    text = _CONTROLS.sub("", text).encode("utf-8", "replace").decode("utf-8")
    return text[:limit], text != original, len(text) > limit


def _access(store, user, project, workspace):
    if not user or user.status != "active" or str(user.tenant_id) != str(project.tenant_id):
        raise HTTPException(403, "Current account cannot read this runtime evidence")
    if store is None:
        raise HTTPException(503, "Execution runtime is not configured")
    principal = runtime_identity(user, store)
    if principal.tenant != project.tenant_id or "read" not in principal.permissions:
        raise HTTPException(403, "Runtime read permission required")
    if not workspace or principal.workspace_ids is not None and workspace not in principal.workspace_ids:
        raise HTTPException(403, "Runtime workspace membership required")
    try:
        row = store.get(principal, "", "workspaces", workspace)
    except CoreError as exc:
        raise HTTPException(exc.status, "Runtime evidence workspace is unavailable") from exc
    # Historical evidence remains readable in an inactive workspace. This grants
    # no execution authority and never starts or repairs anything.
    return principal, row


def assert_evidence_access(store, user, project, workspace_ids):
    """Recheck the current reader against every originally selected workspace."""
    for workspace in sorted(set(workspace_ids)):
        _access(store, user, project, workspace)


def _target(project, issue, *, view="issues", detail="details", **identities):
    return {"project_id": project.id, "view": view, "detail": detail, "issue_id": issue.id, **identities}


class _Evidence:
    def __init__(self):
        self.items, self.scopes, self.digests = [], {}, {}

    def add(
        self,
        id,
        kind,
        label,
        target,
        *,
        status=None,
        summary="",
        facts=None,
        excerpt="",
        missing=False,
        restricted=False,
        truncated=False,
        scope="",
        raw=None,
    ):
        redacted = False

        def clean(value, limit=4000):
            nonlocal redacted, truncated
            result, changed, cut = _clean(value, limit)
            redacted |= changed
            truncated |= cut
            return result

        row = {
            "id": id,
            "kind": kind,
            "label": clean(label, 256),
            "status": clean(status, 80) if status is not None else None,
            "summary": clean(summary),
            "facts": [
                {"label": key, "value": clean(_value(value), 1000)} for key, value in (facts or {}).items()
            ],
            "excerpt": clean(excerpt),
            "truncated": truncated,
            "missing": missing,
            "restricted": restricted,
            "redacted": redacted,
            "target": target,
        }
        self.items.append(EvidenceItem.model_validate(row).model_dump())
        if scope:
            self.scopes[id] = scope
        self.digests[id] = digest(_semantic(raw if raw is not None else row))

    def bounded(self):
        items = self.items[:32]
        if len(self.items) > 32:
            items[-1]["truncated"] = True
            items[-1]["facts"].append({"label": "evidence_omitted", "value": str(len(self.items) - 32)})
        ids = {row["id"] for row in items}
        return (
            items,
            {key: value for key, value in self.scopes.items() if key in ids},
            {key: value for key, value in self.digests.items() if key in ids},
        )


def _value(value):
    if value is None:
        return "unknown"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def _run(store, user, project, workspace, run_id):
    try:
        principal, _ = _access(store, user, project, workspace)
    except (HTTPException, CoreError):
        return None, True
    if not run_id:
        return None, False
    try:
        return store.get(principal, workspace, "runs", run_id), False
    except CoreError as exc:
        if exc.status == 404:
            return None, False
        return None, True


def _run_semantic(run):
    if not run:
        return None
    data = run.get("data", {})
    return _semantic(
        {
            "id": run["id"],
            "status": run["status"],
            "tenant": run["tenant"],
            "business": run["business"],
            "workspace": run["workspace"],
            "attempt": data.get("attempt", 1),
            "active_node": data.get("active_node"),
            "node_results": data.get("node_results", {}),
            "error": data.get("error"),
            "source": data.get("source"),
            "deployment_source": data.get("deployment_source"),
            "target_snapshot": data.get("target_snapshot"),
        }
    )


def _logs(result):
    texts = []
    for name in ("error", "stdout", "stderr"):
        if result.get(name):
            texts.append(f"{name}:\n{result[name]}")
    agent = result.get("agent")
    if isinstance(agent, dict):
        for name in ("message", "error"):
            if agent.get(name):
                texts.append(f"agent.{name}:\n{agent[name]}")
    return "\n\n".join(texts)


def _nodes(evidence, run, *, target, scope, test_ids=()):
    if not run:
        return
    data = run["data"]
    results = data.get("node_results", {})
    configured = {node.get("id"): node for node in data.get("nodes", []) if isinstance(node, dict)}
    ids = sorted(set(configured) | set(results))
    provenance = _run_semantic(run)
    provenance.pop("node_results", None)
    for node_id in ids:
        result = results.get(node_id)
        result = result if isinstance(result, dict) else {}
        status = (
            "skipped"
            if result.get("skipped")
            else "passed"
            if result.get("succeeded") is True
            else ("failed" if result.get("succeeded") is False else "unknown")
        )
        if data.get("active_node") == node_id and run["status"] == "running":
            status = "running"
        current_attempt = data.get("attempt", 1)
        result_current = not result or result.get("attempt", 1) == current_attempt
        if result and not result_current:
            status = "historical"
        evidence.add(
            f"node:{run['id']}:{node_id}",
            "node",
            str(node_id),
            target,
            status=status,
            summary="node_historical" if not result_current else "node_result" if result else "node_missing",
            facts={
                "run_id": run["id"],
                "node_id": node_id,
                "is_test": node_id in test_ids,
                "attempt": result.get("attempt", 1) if result else current_attempt,
                "current_attempt": current_attempt,
                "result_current": result_current,
                "exit_code": result.get("exit_code"),
                "succeeded": result.get("succeeded"),
                "duration_ms": result.get("duration_ms"),
            },
            excerpt=_logs(result),
            missing=not result,
            truncated=bool(result.get("stdout_truncated") or result.get("stderr_truncated")),
            scope=scope,
            raw={
                "run": provenance,
                "node_id": node_id,
                "is_test": node_id in test_ids,
                "result": result,
                "attempt": data.get("attempt", 1),
            },
        )


def _execution(evidence, project, issue, entry, store, user, verification):
    workspace = entry.get("workspace_id", "")
    run, restricted = _run(store, user, project, workspace, entry.get("run_id"))
    target = _target(
        project, issue, view="execution", execution_id=entry["id"], task_id=entry.get("task_id", "")
    )
    common = {"execution_id": entry["id"], "task_id": entry.get("task_id", "")}
    evidence.add(
        f"execution:{entry['id']}",
        "execution",
        entry["id"],
        target,
        status=None if restricted else run["status"] if run else "unknown",
        summary="runtime_restricted" if restricted else "execution_record" if run else "execution_missing",
        facts=common
        if restricted
        else {
            **common,
            "run_id": entry.get("run_id"),
            "business_status": entry.get("status"),
            "scope_current": verification.execution_snapshot_current(entry),
            "attempt": run["data"].get("attempt", 1) if run else None,
            "review_decision": (entry.get("review") or {}).get("decision"),
        },
        excerpt="" if not run or restricted else run["data"].get("error", ""),
        missing=not restricted and not run,
        restricted=restricted,
        scope=workspace,
        raw={"entry": _execution_semantic(entry), "run": _run_semantic(run)},
    )
    if not restricted:
        _nodes(evidence, run, target=target, scope=workspace, test_ids=entry.get("test_node_ids", []))


def _execution_semantic(entry):
    return _semantic(
        {
            key: entry.get(key)
            for key in (
                "id",
                "issue_id",
                "task_id",
                "workspace_id",
                "run_id",
                "runtime_task_id",
                "status",
                "attempt",
                "stale",
                "planning_invalidated",
                "executor_binding_invalidated",
                "snapshot",
                "plan_basis",
                "test_node_ids",
                "results",
                "review",
            )
        }
    )


def _deployment_semantic(entry):
    return _semantic(
        {
            key: entry.get(key)
            for key in (
                "id",
                "issue_id",
                "kind",
                "status",
                "environment_id",
                "candidate_id",
                "actual_traffic",
                "physical_started",
                "snapshot",
                "operations",
            )
        }
    )


def _deployment(evidence, db, project, issue, entry, data, store, user):
    from .delivery_deployment import _validity, deployment_verified_for_release

    snapshot = entry.get("snapshot", {})
    workspace = snapshot.get("definition", {}).get("workspace_id", "")
    operations = entry.get("operations", [])
    latest = operations[-1] if operations else {}
    latest_run, restricted = _run(store, user, project, workspace, latest.get("run_id"))
    target = _target(project, issue, view="releases", deployment_id=entry["id"])
    environment = next(
        (row for row in data.get("deployment_environments", []) if row["id"] == entry.get("environment_id")),
        None,
    )
    compatible = bool(
        environment
        and environment.get("active")
        and environment.get("generation") == snapshot.get("environment_generation")
    )
    physical = next(
        (
            row
            for row in reversed(data.get("deployments", []))
            if row.get("environment_id") == entry.get("environment_id") and row.get("physical_started")
        ),
        None,
    )
    business_valid = bool(
        entry.get("status") in {"verified", "rolled_back"}
        and deployment_verified_for_release(data, entry["candidate_id"])
        and not _validity(db, project, data, entry)
    )
    evidence.add(
        f"deployment:{entry['id']}",
        "deployment",
        entry["id"],
        target,
        status=None if restricted else entry.get("status", "unknown"),
        summary="runtime_restricted" if restricted else "deployment_record",
        facts={"deployment_id": entry["id"]}
        if restricted
        else {
            "deployment_id": entry["id"],
            "kind": entry.get("kind"),
            "environment_id": entry.get("environment_id"),
            "candidate_id": entry.get("candidate_id"),
            "actual_traffic": entry.get("actual_traffic"),
            "environment_current": compatible,
            "latest_physical": bool(physical and physical["id"] == entry["id"]),
            "runtime_status": latest_run["status"] if latest_run else None,
            "business_valid": business_valid,
            "rollback_of": snapshot.get("rollback_of"),
        },
        missing=not restricted and bool(latest.get("run_id")) and not latest_run,
        restricted=restricted,
        scope=workspace,
        raw={
            "entry": _deployment_semantic(entry),
            "run": _run_semantic(latest_run),
            "business_valid": business_valid,
        },
    )
    if restricted:
        return
    for operation in operations:
        run, denied = _run(store, user, project, workspace, operation.get("run_id"))
        if denied:
            continue
        _nodes(evidence, run, target=target, scope=workspace)
        # These are the structured result actually consumed by the deployment
        # service. Unavailable runs do not make saved private output readable.
        result = operation.get("result") if not operation.get("run_id") or run else None
        if not isinstance(result, dict):
            continue
        for index, probe in enumerate(result.get("probes", [])):
            if not isinstance(probe, dict):
                continue
            evidence.add(
                f"probe:{operation['id']}:{index}",
                "probe",
                f"{operation['id']} / {index + 1}",
                target,
                status="passed" if probe.get("healthy") is True and not probe.get("error") else "failed",
                summary="probe_record",
                facts={
                    "operation_id": operation["id"],
                    "operation_status": operation.get("status"),
                    "observe_only": operation.get("observe", False),
                    "healthy": probe.get("healthy"),
                    "artifact_sha256": probe.get("artifact_sha256"),
                    "actual_traffic": probe.get("traffic_percent"),
                    "sample_count": probe.get("sample_count"),
                    "exit_code": probe.get("exit_code"),
                },
                excerpt=_logs(probe),
                scope=workspace,
                raw={"operation_id": operation["id"], "probe": probe},
                truncated=bool(probe.get("stdout_truncated") or probe.get("stderr_truncated")),
            )


def issue_snapshot(db, project, data, user, issue_id, *, store=None, execution=None):
    """Return fixed public facts plus internal scope/digests for selected evidence."""
    issue = get_record(db, Issue, project, issue_id)
    raw_issue = serialize(issue)
    evidence = _Evidence()
    safe_issue, issue_redacted, issue_truncated = {}, False, False
    for key, value in raw_issue.items():
        if isinstance(value, str):
            safe_issue[key], changed, cut = _clean(value, 20000)
            issue_redacted |= changed
            issue_truncated |= cut
        else:
            safe_issue[key] = value
    safe_issue = IssueRecord.model_validate(safe_issue).model_dump()
    evidence.add(
        f"issue:{issue.id}",
        "issue",
        safe_issue["title"],
        _target(project, issue),
        status=issue.status,
        summary="issue_record",
        facts={"severity": issue.severity, "type": issue.type, "reported_by": issue.reported_by},
        excerpt=issue.description,
        truncated=issue_truncated,
        raw=raw_issue,
    )
    evidence.items[-1]["redacted"] |= issue_redacted
    executions = sorted(
        (row for row in data.get("executions", []) if row.get("issue_id") == issue.id),
        key=lambda row: row["id"],
    )
    deployments = sorted(
        (row for row in data.get("deployments", []) if row.get("issue_id") == issue.id),
        key=lambda row: row["id"],
    )
    task_ids = {row.get("task_id") for row in executions} | {issue.task_id}
    task_rows = {
        row.id: row for row in records(db, Task, project).filter(Task.id.in_(task_ids - {None, ""})).all()
    }
    source_requirement_ids = {row.req_id for row in task_rows.values()} - {None, ""}
    source_requirements = {
        row.id: row
        for row in records(db, Requirement, project).filter(Requirement.id.in_(source_requirement_ids)).all()
    }
    verification = VerificationContext(db, project, data)
    for task_id in sorted(task_ids - {None, ""}):
        task = task_rows.get(task_id)
        evidence.add(
            f"task:{task_id}",
            "task",
            task.title if task else task_id,
            _target(
                project, issue, view="tasks", task_id=task_id, requirement_id=task.req_id if task else ""
            ),
            status=task.status if task else "unknown",
            missing=task is None,
            summary="task_record" if task else "task_missing",
            facts={
                "requirement_id": task.req_id,
                "owner_id": task.owner_id,
                "priority": task.priority,
                "acceptance_criteria": task.acceptance_criteria,
            }
            if task
            else {},
            excerpt=task.description if task else "",
            raw={
                "task": serialize(task),
                "requirement": serialize(source_requirements[task.req_id])
                if task.req_id in source_requirements
                else None,
                "definition": semantic_snapshot(verification.definition(task.id)["snapshot"]),
            }
            if task
            else {"id": task_id, "missing": True},
        )
    for entry in executions:
        _execution(evidence, project, issue, entry, store, user, verification)
    for entry in deployments:
        _deployment(evidence, db, project, issue, entry, data, store, user)
    requirement_ids = sorted(
        rid for rid, flow in data.get("flows", {}).items() if flow.get("source_issue_id") == issue.id
    )
    requirement = (
        records(db, Requirement, project)
        .filter(Requirement.id.in_(requirement_ids))
        .order_by(Requirement.id)
        .first()
        if requirement_ids
        else None
    )
    requirement_id = requirement.id if requirement else None
    items, scopes, digests = evidence.bounded()
    basis = digest(
        _semantic(
            {
                "issue": raw_issue,
                "tasks": [serialize(task_rows[key]) for key in sorted(task_rows)],
                "requirements": [serialize(source_requirements[key]) for key in sorted(source_requirements)],
                "definitions": [
                    semantic_snapshot(verification.definition(key)["snapshot"]) for key in sorted(task_rows)
                ],
                "task_ids": sorted(task_ids - {None, ""}),
                "executions": [_execution_semantic(row) for row in executions],
                "deployments": [_deployment_semantic(row) for row in deployments],
                "candidates": [
                    row
                    for row in data.get("release_candidates", [])
                    if row.get("id") in {entry.get("candidate_id") for entry in deployments}
                ],
                "environments": [
                    row
                    for row in data.get("deployment_environments", [])
                    if row.get("id") in {entry.get("environment_id") for entry in deployments}
                ],
            }
        )
    )
    return {
        "issue": safe_issue,
        "issue_basis": basis,
        "evidence": deepcopy(items),
        "requirement_id": requirement_id,
        "evidence_scopes": scopes,
        "runtime_scopes": sorted(set(scopes.values())),
        "evidence_digests": digests,
    }
