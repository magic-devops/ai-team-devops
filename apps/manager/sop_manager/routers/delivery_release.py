"""Canonical quality and immutable release decisions, without progress/materialization recursion."""

from copy import deepcopy
from datetime import datetime, timezone

from fastapi import HTTPException

from .delivery_ci import policy_value, verify_envelope
from .delivery_release_contract import ReleasePreviewInput
from .delivery_task_contract import semantic_snapshot, snapshots_match
from .delivery_verification import VerificationContext, fingerprint
from .sql_models import User

INVALIDATION_CODES = frozenset(
    {
        "release_scope_changed",
        "release_scope_unavailable",
        "release_quality_unverified",
        "release_policy_changed",
        "release_ci_missing",
        "release_ci_superseded",
        "release_ci_failed",
        "release_approver_unavailable",
    }
)


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _id(prefix):
    from uuid import uuid4

    return prefix + "-" + uuid4().hex[:20]


def _deny(status, code, message):
    raise HTTPException(status, {"code": code, "message": message})


def _reason(code, message, target=None):
    return {"code": code, "message": message, "target": target}


def _target(project, kind, rid, requirement_id=None):
    return {
        "project_id": project.id,
        "kind": kind,
        "view": {"requirement": "requirements", "task": "tasks", "issue": "issues"}[kind],
        "detail": "details",
        "requirement_id": rid if kind == "requirement" else requirement_id,
        "task_id": rid if kind == "task" else None,
        "issue_id": rid if kind == "issue" else None,
    }


def _actor(user):
    return {"id": user.id, "name": user.username}


def _permissions(db, project, user):
    from .delivery import _permissions as project_permissions

    allowed = project_permissions(db, user, project)
    return {
        "can_configure": allowed["configure"],
        "can_import": allowed["write"],
        "can_create": allowed["write"],
        "can_review": allowed["approve"],
    }


def _selected(context, requirement_ids, task_ids):
    groups = (list(requirement_ids or []), list(task_ids or []))
    for group in groups:
        if (
            len(group) > 200
            or any(not isinstance(value, str) or not value.strip() for value in group)
            or len(set(group)) != len(group)
        ):
            _deny(
                422,
                "release_scope_invalid",
                "Choose at most 200 distinct nonempty IDs in each scope category.",
            )
    requirements, tasks = map(sorted, groups)
    if any(value not in context.requirements for value in requirements) or any(
        value not in context.tasks for value in tasks
    ):
        _deny(404, "release_scope_not_found", "A selected item is missing or outside this project.")
    if any(context.tasks[value].req_id for value in tasks):
        _deny(
            422, "release_task_scope_invalid", "Select a linked task through its complete requirement scope."
        )
    included = set(tasks) | {task.id for task in context.tasks.values() if task.req_id in requirements}
    return {"requirement_ids": requirements, "task_ids": tasks}, included


def _issues(context, task_ids):
    return [
        issue
        for issue in context.issues
        if issue.task_id in task_ids
        and issue.severity in {"P0", "P1"}
        and issue.status not in {"resolved", "closed"}
    ]


def _issue_view(project, issue):
    return {
        "id": issue.id,
        "title": issue.title,
        "severity": issue.severity,
        "status": issue.status,
        "task_id": issue.task_id,
        "target": _target(project, "issue", issue.id),
    }


def _proof(context, task):
    result = {
        "source": "none",
        "id": None,
        "basis": None,
        "execution_id": None,
        "run_id": None,
        "run_version": None,
        "evidence_sha256": None,
        "reviewer_id": None,
        "at": None,
    }
    entry = context.executions.get(task.id)
    if entry:
        review = entry.get("review") or {}
        return {
            **result,
            "source": "native",
            "id": entry["id"],
            "execution_id": entry["id"],
            "basis": review.get("evidence_sha256"),
            "run_id": entry.get("run_id") or None,
            "run_version": entry.get("run_version") or None,
            "evidence_sha256": review.get("evidence_sha256"),
            "reviewer_id": review.get("actor"),
            "at": review.get("at"),
        }
    review = context.reviews.get(task.id)
    if (
        review
        and not review.invalidated
        and review.decision == "accept"
        and snapshots_match(review.snapshot, context.snapshot(task.id))
    ):
        return _manual_proof(result, review)
    if task.req_id and context.requirement_accepted(task.req_id):
        flow = context.data["flows"][task.req_id]
        accepted = next(
            value
            for value in reversed(flow["reviews"])
            if value.get("stage") == "acceptance"
            and value.get("revision") == flow["revision"]
            and value.get("decision") == "approved"
        )
        return {
            **result,
            "source": "requirement",
            "basis": fingerprint(accepted),
            "reviewer_id": accepted.get("actor"),
            "at": accepted.get("at"),
        }
    return _manual_proof(result, review) if review else result


def _manual_proof(result, review):
    instant = (
        review.created_at.replace(tzinfo=timezone.utc)
        if review.created_at.tzinfo is None
        else review.created_at
    )
    return {
        **result,
        "source": "manual",
        "id": review.id,
        "basis": review.task_basis,
        "reviewer_id": review.reviewer_id,
        "at": instant.isoformat().replace("+00:00", "Z"),
    }


def _task_quality(context, task):
    definition = context.definition(task.id)
    target = _target(context.project, "task", task.id, task.req_id or None)
    verified = context.verified(task.id)
    reasons = [{**value, "target": target} for value in definition["execution_gate"]["reasons"]]
    owner = context.owner(task)
    if not owner or not owner["available"]:
        reasons.append(_reason("task_owner_unavailable", "Assign an available responsible identity.", target))
    if not verified:
        reasons.append(
            _reason("task_unverified", "This task does not have current effective acceptance.", target)
        )
    issues = [_issue_view(context.project, issue) for issue in _issues(context, {task.id})]
    if issues:
        reasons.append(
            _reason("critical_issues", "Resolve the linked P0/P1 issues before releasing.", target)
        )
    return {
        "id": task.id,
        "title": task.title,
        "requirement_id": task.req_id or None,
        "recorded_status": task.status,
        "delivery_status": context.delivery_status(task.id),
        "verified": verified,
        "basis": context.basis(task.id),
        "acceptance_criteria": definition["acceptance"]["criteria"],
        "acceptance_available": definition["acceptance"]["available"],
        "owner": {key: owner[key] for key in ("id", "name", "kind", "active", "available")}
        if owner
        else None,
        "proof": _proof(context, task),
        "issues": issues,
        "reasons": reasons,
        "target": target,
    }


def _requirement_quality(context, requirement, tasks):
    flow = context.data.get("flows", {}).get(requirement.id, {})
    linked = [task for task in tasks if task["requirement_id"] == requirement.id]
    target = _target(context.project, "requirement", requirement.id)
    accepted = context.requirement_accepted(requirement.id)
    reasons = (
        []
        if accepted
        else [
            _reason(
                "requirement_unaccepted", "Complete current quality acceptance for this requirement.", target
            )
        ]
    )
    if not linked:
        reasons.append(
            _reason("requirement_tasks_missing", "This requirement has no delivery tasks.", target)
        )
    if flow.get("blocked_reason"):
        reasons.append(_reason("requirement_blocked", flow["blocked_reason"], target))
    definition = {
        key: getattr(requirement, key) for key in ("id", "title", "description", "acceptance_criteria")
    }
    return {
        "id": requirement.id,
        "title": requirement.title,
        "revision": flow.get("revision", 1),
        "basis": fingerprint({**definition, "revision": flow.get("revision", 1)}),
        "stage": flow.get("stage", "intake"),
        "accepted": accepted,
        "acceptance_criteria": requirement.acceptance_criteria or [],
        "task_ids": [task["id"] for task in linked],
        "issues": [issue for task in linked for issue in task["issues"]],
        "reasons": reasons,
        "target": target,
    }


def _scope_payload(context, selected, included, requirements, tasks):
    return {
        "tenant_id": context.project.tenant_id,
        "project_id": context.project.id,
        "selected": selected,
        "requirements": [
            {
                key: value
                for key, value in row.items()
                if key in {"id", "revision", "basis", "stage", "accepted", "task_ids"}
            }
            for row in requirements
            if row["id"] in selected["requirement_ids"]
        ],
        "tasks": [
            {
                "definition": semantic_snapshot(context.definition(row["id"])["snapshot"]),
                "status": row["recorded_status"],
                "verified": row["verified"],
                "proof": row["proof"],
            }
            for row in tasks
            if row["id"] in included
        ],
        "critical_issues": [
            {
                key: getattr(issue, key)
                for key in ("id", "task_id", "title", "description", "severity", "status")
            }
            for issue in sorted(_issues(context, included), key=lambda row: row.id)
        ],
    }


def quality(db, project, data, *, requirement_ids=None, task_ids=None):
    context = VerificationContext(db, project, data)
    selected, included = _selected(context, requirement_ids, task_ids)
    tasks = [_task_quality(context, task) for task in sorted(context.tasks.values(), key=lambda row: row.id)]
    requirements = [
        _requirement_quality(context, req, tasks)
        for req in sorted(context.requirements.values(), key=lambda row: row.id)
    ]
    chosen_requirements = [row for row in requirements if row["id"] in selected["requirement_ids"]]
    chosen_tasks = [row for row in tasks if row["id"] in included]
    has_scope = bool(selected["requirement_ids"] or selected["task_ids"])
    reasons = [reason for row in [*chosen_requirements, *chosen_tasks] for reason in row["reasons"]]
    if not has_scope:
        reasons.append(
            _reason("release_scope_missing", "Select an explicit requirement or independent task scope.")
        )
    return {
        "project_id": project.id,
        "as_of": _now(),
        "requirements": requirements,
        "tasks": tasks,
        "independent_tasks": [row for row in tasks if row["requirement_id"] is None],
        "selected": selected,
        "scope_basis": fingerprint(_scope_payload(context, selected, included, requirements, tasks))
        if has_scope
        else None,
        "eligible": has_scope and not reasons,
        "reasons": reasons,
        "summary": {
            "requirements_total": len(requirements),
            "tasks_total": len(tasks),
            "verified_tasks": sum(row["verified"] for row in tasks),
            "unverified_tasks": sum(not row["verified"] for row in tasks),
            "accepted_requirements": sum(row["accepted"] for row in requirements),
            "critical_issues": len(_issues(context, set(context.tasks))),
        },
    }


def _scope_quality(db, project, data, selected):
    return quality(db, project, data, **selected)


def _snapshot_quality(value):
    selected = value["selected"]
    requirements = [row for row in value["requirements"] if row["id"] in selected["requirement_ids"]]
    included = set(selected["task_ids"]) | {tid for row in requirements for tid in row["task_ids"]}
    return {
        "scope_basis": value["scope_basis"],
        "requirements": deepcopy(requirements),
        "tasks": deepcopy([row for row in value["tasks"] if row["id"] in included]),
    }


def _sequence_key(evidence):
    predicate = evidence["statement"]["predicate"]
    return tuple(predicate[key] for key in ("policy_generation", "repository", "workflow", "commit_sha"))


def _sequence(evidence):
    predicate = evidence["statement"]["predicate"]
    return predicate["run_number"], predicate["run_attempt"]


def _ci_reasons(db, project, data, evidence, current_quality=None):
    reasons = []
    policy = data.get("release_policy")
    predicate = evidence["statement"]["predicate"]
    if not policy or predicate["policy_generation"] != policy["generation"]:
        reasons.append(_reason("release_policy_changed", "The configured CI trust policy changed."))
    peers = [row for row in data.get("ci_evidence", []) if _sequence_key(row) == _sequence_key(evidence)]
    if peers and _sequence(evidence) < max(map(_sequence, peers)):
        reasons.append(_reason("release_ci_superseded", "A later CI attempt superseded this evidence."))
    try:
        current_quality = current_quality or _scope_quality(db, project, data, evidence["selected"])
        if predicate["scope_basis"] != current_quality["scope_basis"]:
            reasons.append(_reason("release_scope_changed", "The selected quality scope changed."))
    except HTTPException:
        reasons.append(_reason("release_scope_unavailable", "The original release scope is unavailable."))
    return reasons


def _evidence_view(db, project, data, evidence):
    reasons = _ci_reasons(db, project, data, evidence)
    return {
        key: deepcopy(evidence[key])
        for key in (
            "id",
            "imported_at",
            "imported_by",
            "envelope_digest",
            "key_id",
            "passed",
            "selected",
            "statement",
        )
    } | {"current": not reasons, "reasons": reasons}


def _approver_available(db, project, actor_id):
    from .auth_sql import check_project_access
    from .delivery import _role_permissions

    user = db.get(User, actor_id)
    if not user or user.status != "active":
        return False
    try:
        check_project_access(user, project.id, db)
        return _role_permissions(db, user, project)["approve"]
    except HTTPException:
        return False


def _candidate_reasons(db, project, data, candidate):
    reasons = deepcopy(candidate.get("invalidated_reasons", []))
    snapshot = candidate["snapshot"]
    evidence = next((row for row in data.get("ci_evidence", []) if row["id"] == snapshot["ci"]["id"]), None)
    if evidence is None:
        reasons.append(_reason("release_ci_missing", "The original signed CI evidence is unavailable."))
    else:
        reasons.extend(_ci_reasons(db, project, data, evidence))
        if not evidence["passed"]:
            reasons.append(_reason("release_ci_failed", "The selected signed CI checks did not pass."))
    policy = data.get("release_policy")
    if not policy or policy["generation"] != snapshot["ci"]["policy_generation"]:
        reasons.append(_reason("release_policy_changed", "The configured CI trust policy changed."))
    try:
        current = _scope_quality(db, project, data, snapshot["selected"])
        if current["scope_basis"] != snapshot["quality"]["scope_basis"]:
            reasons.append(_reason("release_scope_changed", "The selected quality scope changed."))
        if not current["eligible"]:
            reasons.append(
                _reason(
                    "release_quality_unverified",
                    "The selected work no longer has effective quality acceptance.",
                )
            )
    except HTTPException:
        reasons.append(_reason("release_scope_unavailable", "The original release scope is unavailable."))
    if candidate["decision"] == "approved" and any(
        not _approver_available(db, project, row["actor"]["id"])
        for row in candidate["reviews"]
        if row["decision"] == "approve"
    ):
        reasons.append(
            _reason(
                "release_approver_unavailable",
                "The release approver no longer has active project approval authority.",
            )
        )
    return list({row["code"]: row for row in reasons}.values())


def reconcile_releases(db, project, data):
    """Only latch the three invalidation fields; original content and decisions stay immutable."""
    for candidate in data.get("release_candidates", []):
        reasons = _candidate_reasons(db, project, data, candidate)
        if reasons and not candidate.get("invalidated"):
            candidate["invalidated"] = True
            candidate["invalidated_at"] = _now()
            candidate["invalidated_reasons"] = reasons


def _semantic_candidate(candidate):
    value = deepcopy(candidate)
    # A pure reconciled view may discover staleness before its capture commits.
    # The discovery timestamp is not part of the fixed decision's meaning.
    value.pop("invalidated_at", None)
    value["created_by"].pop("name", None)
    for review in value["reviews"]:
        review["actor"].pop("name", None)
    for task in value["snapshot"]["quality"]["tasks"]:
        if task["owner"]:
            task["owner"].pop("name", None)
    return value


def _candidate_view(db, project, data, user, candidate):
    value = deepcopy(candidate)
    reasons = _candidate_reasons(db, project, data, candidate)
    valid = not candidate.get("invalidated") and not reasons
    allowed = _permissions(db, project, user)["can_review"]
    pending = candidate["decision"] == "pending"
    value.update(
        status="stale"
        if not valid and candidate["decision"] in {"pending", "approved"}
        else candidate["decision"],
        valid=valid,
        reasons=reasons,
        review_basis=fingerprint({"candidate": _semantic_candidate(candidate), "reasons": reasons}),
        permissions={
            "can_approve": allowed and pending and valid,
            "can_reject": allowed and pending,
            "can_revoke": allowed and candidate["decision"] in {"pending", "approved"},
        },
        deployment={"status": "not_handed_off", "verified": False},
    )
    return value


def release_index(db, project, data, user, *, version):
    requirements = VerificationContext(db, project, data).requirements
    return {
        "project_id": project.id,
        "version": version,
        "as_of": _now(),
        "policy": deepcopy(data.get("release_policy")),
        "evidence": [_evidence_view(db, project, data, row) for row in reversed(data.get("ci_evidence", []))],
        "candidates": [
            _candidate_view(db, project, data, user, row)
            for row in reversed(data.get("release_candidates", []))
        ],
        "legacy_history": [
            {
                "requirement_id": rid,
                "requirement_title": requirements[rid].title if rid in requirements else None,
                "record": deepcopy(record),
                "source": "manual_history",
                "deployment_verified": False,
            }
            for rid, flow in data.get("flows", {}).items()
            for record in flow.get("releases", [])
        ],
        "permissions": _permissions(db, project, user),
    }


def release_detail(db, project, data, user, id, *, version):
    candidate = next((row for row in data.get("release_candidates", []) if row["id"] == id), None)
    if not candidate:
        _deny(404, "release_not_found", "Release candidate not found in this project.")
    evidence = next(
        (row for row in data.get("ci_evidence", []) if row["id"] == candidate["snapshot"]["ci"]["id"]), None
    )
    if not evidence:
        _deny(409, "release_ci_missing", "The original signed CI evidence is unavailable.")
    return {
        "project_id": project.id,
        "version": version,
        "as_of": _now(),
        "candidate": _candidate_view(db, project, data, user, candidate),
        "evidence": _evidence_view(db, project, data, evidence),
        "envelope": evidence["envelope"],
        "permissions": _permissions(db, project, user),
    }


def _ci_snapshot(evidence):
    predicate = evidence["statement"]["predicate"]
    subject = evidence["statement"]["subject"][0]
    return {
        "id": evidence["id"],
        "envelope_digest": evidence["envelope_digest"],
        "key_id": evidence["key_id"],
        **{
            key: predicate[key]
            for key in (
                "policy_generation",
                "repository",
                "workflow",
                "commit_sha",
                "run_uri",
                "run_number",
                "run_attempt",
            )
        },
        "artifact_name": subject["name"],
        "artifact_sha256": subject["digest"]["sha256"],
    }


def preview(db, project, data, user, body, *, version):
    current = quality(db, project, data, requirement_ids=body.requirement_ids, task_ids=body.task_ids)
    permissions = _permissions(db, project, user)
    reasons = deepcopy(current["reasons"])
    evidence = next((row for row in data.get("ci_evidence", []) if row["id"] == body.ci_evidence_id), None)
    snapshot = None
    if evidence is None:
        reasons.append(_reason("release_ci_missing", "Select signed CI evidence from this project."))
    else:
        reasons.extend(_ci_reasons(db, project, data, evidence, current))
        if evidence["selected"] != current["selected"]:
            reasons.append(
                _reason("release_scope_changed", "The selected CI scope does not match this candidate.")
            )
        if not evidence["passed"]:
            reasons.append(_reason("release_ci_failed", "The selected signed CI checks did not pass."))
        snapshot = {
            **body.model_dump(exclude={"preview_basis", "requirement_ids", "task_ids", "ci_evidence_id"}),
            "selected": current["selected"],
            "ci": _ci_snapshot(evidence),
            "quality": _snapshot_quality(current),
        }
    if any(
        row["snapshot"]["version"] == body.version and row["snapshot"]["environment"] == body.environment
        for row in data.get("release_candidates", [])
    ):
        reasons.append(
            _reason(
                "release_version_used",
                "This version and environment already identify a retained candidate; choose a new version.",
            )
        )
    if not permissions["can_create"]:
        reasons.append(
            _reason("release_write_forbidden", "Project write permission is required to prepare a release.")
        )
    basis = fingerprint(
        {
            "input": body.model_dump(exclude={"preview_basis"}),
            "scope_basis": current["scope_basis"],
            "policy_generation": (data.get("release_policy") or {}).get("generation"),
            "evidence_digest": evidence["envelope_digest"] if evidence else None,
            "reasons": reasons,
            "permissions": permissions,
        }
    )
    return {
        "project_id": project.id,
        "version": version,
        "as_of": _now(),
        "preview_basis": basis,
        "allowed": not reasons,
        "reasons": reasons,
        "snapshot": snapshot,
        "permissions": permissions,
    }


def _save_policy(project, user, data, body):
    current = data.get("release_policy")
    value = policy_value(body, current["generation"] + 1 if current else 1)
    semantic = {key: value[key] for key in ("repository", "workflow", "keys")}
    if current and semantic == {key: current[key] for key in semantic}:
        _deny(409, "release_policy_unchanged", "The same CI trust policy is already configured.")
    data["release_policy"] = {**value, "updated_at": _now(), "updated_by": _actor(user)}
    return project.id, deepcopy(current), deepcopy(data["release_policy"])


def _import_ci(db, project, user, data, body):
    current = quality(db, project, data, requirement_ids=body.requirement_ids, task_ids=body.task_ids)
    if current["scope_basis"] is None:
        _deny(422, "release_scope_missing", "Select an explicit CI quality scope.")
    policy = data.get("release_policy")
    if not policy:
        _deny(422, "release_policy_missing", "Configure a trusted CI public key before importing evidence.")
    verified = verify_envelope(
        body.envelope,
        policy,
        tenant_id=project.tenant_id,
        project_id=project.id,
        scope_basis=current["scope_basis"],
    )
    for row in data.get("ci_evidence", []):
        if row["envelope_digest"] == verified["envelope_digest"]:
            return row["id"], None, {"evidence_id": row["id"], "replayed": True}
    row = {
        **verified,
        "id": _id("ci"),
        "imported_at": _now(),
        "imported_by": _actor(user),
        "selected": current["selected"],
        "quality_snapshot": _snapshot_quality(current),
    }
    peers = [value for value in data.get("ci_evidence", []) if _sequence_key(value) == _sequence_key(row)]
    if peers and _sequence(row) <= max(map(_sequence, peers)):
        _deny(
            409,
            "release_ci_sequence_conflict",
            "CI run number/attempt must advance; the same sequence cannot identify different evidence.",
        )
    data.setdefault("ci_evidence", []).append(row)
    return row["id"], None, {"evidence_id": row["id"], "replayed": False, "passed": row["passed"]}


def _create_candidate(db, project, user, data, body):
    proposal = preview(
        db,
        project,
        data,
        user,
        ReleasePreviewInput.model_validate(body.model_dump(exclude={"preview_basis"})),
        version=0,
    )
    if body.preview_basis != proposal["preview_basis"]:
        _deny(
            409,
            "release_preview_changed",
            "The proposal changed; explicitly review and adopt a fresh preview.",
        )
    if not proposal["allowed"]:
        _deny(
            422,
            "release_candidate_ineligible",
            "Resolve every release preview blocker before creating the candidate.",
        )
    candidate = {
        "id": _id("release"),
        "created_at": _now(),
        "created_by": _actor(user),
        "snapshot": deepcopy(proposal["snapshot"]),
        "decision": "pending",
        "reviews": [],
        "invalidated": False,
        "invalidated_at": None,
        "invalidated_reasons": [],
    }
    data.setdefault("release_candidates", []).append(candidate)
    return (
        candidate["id"],
        None,
        {"candidate_id": candidate["id"], "decision": "pending", "deployment_verified": False},
    )


def _review_candidate(db, project, user, data, action, body):
    candidate = next((row for row in data.get("release_candidates", []) if row["id"] == body.id), None)
    if not candidate:
        _deny(404, "release_not_found", "Release candidate not found in this project.")
    view = _candidate_view(db, project, data, user, candidate)
    if body.review_basis != view["review_basis"]:
        _deny(
            409,
            "release_review_changed",
            "Candidate evidence or decisions changed; explicitly adopt the current review basis.",
        )
    decision = "revoke" if action == "release.candidate.revoke" else body.decision
    permission = {"approve": "can_approve", "reject": "can_reject", "revoke": "can_revoke"}[decision]
    if not view["permissions"][permission]:
        _deny(
            409,
            "release_review_unavailable",
            "This candidate cannot receive that decision in its current state.",
        )
    before = deepcopy(candidate)
    candidate["reviews"].append(
        {
            "decision": decision,
            "comment": body.comment,
            "actor": _actor(user),
            "at": _now(),
            "review_basis": body.review_basis,
        }
    )
    candidate["decision"] = {"approve": "approved", "reject": "rejected", "revoke": "revoked"}[decision]
    return (
        candidate["id"],
        before,
        {"candidate_id": candidate["id"], "decision": candidate["decision"], "deployment_verified": False},
    )


def apply_release(db, project, user, data, action, body):
    if project.status == "archived":
        _deny(409, "project_archived", "Restore the project before changing release governance.")
    allowed = _permissions(db, project, user)
    needed = (
        "can_configure"
        if action == "release.policy.save"
        else "can_review"
        if action in {"release.candidate.review", "release.candidate.revoke"}
        else "can_import"
    )
    if not allowed[needed]:
        _deny(403, "release_permission_required", "Project permission is required for this release action.")
    reconcile_releases(db, project, data)
    if action == "release.policy.save":
        result = _save_policy(project, user, data, body)
    elif action == "release.ci.import":
        result = _import_ci(db, project, user, data, body)
    elif action == "release.candidate.create":
        result = _create_candidate(db, project, user, data, body)
    elif action in {"release.candidate.review", "release.candidate.revoke"}:
        result = _review_candidate(db, project, user, data, action, body)
    else:
        _deny(422, "release_action_invalid", "Unknown release action.")
    reconcile_releases(db, project, data)
    return result
