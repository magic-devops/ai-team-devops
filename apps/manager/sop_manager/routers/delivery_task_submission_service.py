"""One Task, fixed reported evidence, existing human reviews and positive native closure."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib

from fastapi import HTTPException
from hermes_core.models import CoreError
from hermes_core.transactional import digest
from sqlalchemy import LargeBinary, Text, cast, func, select

from sop_manager.project_write_guard import task_submission_invalidation_scope, task_submission_write_scope
from .delivery_task_submission_model import DeliveryTaskSubmission as Submission, DeliveryTaskSubmissionDecision as Decision
from .delivery_task_contract import semantic_snapshot
from .sql_models import DeliveryTaskReview, DeliveryWorkspace, Issue, Project, ProjectMember, Task, User

MAX_NATIVE_EXECUTIONS = 100


def _fail(code, message, status=409):
    raise HTTPException(status, {"code": code, "message": message})


def reason(code, message):
    return {"code": code, "message": message}


def _scope(project, model):
    return model.tenant_id == project.tenant_id, model.project_id == project.id


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _actor(db, project, user, *, permission=None):
    from .auth_sql import check_project_access
    from .auth_sql import _norm_role

    current = db.get(User, user.id, populate_existing=True)
    if not current or current.status != "active" or current.tenant_id != project.tenant_id:
        _fail("submission_account_unavailable", "The current project account is unavailable.", 403)
    check_project_access(current, project.id, db)
    member_role = db.scalar(select(ProjectMember.role).where(ProjectMember.project_id == project.id, ProjectMember.user_id == current.id))
    role = _norm_role(member_role or current.role)
    admin = _norm_role(current.role) == "super_admin" or _norm_role(current.role) == "tenant_admin" and current.tenant_id == project.tenant_id
    permissions = {"write": admin or role in {"project_admin", "developer", "devops", "product_manager"},
                   "approve": admin or role in {"project_admin", "devops", "product_manager"}}
    current_status = db.scalar(select(Project.status).where(Project.id == project.id, Project.tenant_id == project.tenant_id))
    if current_status == "archived":
        permissions.update(write=False, approve=False)
    if permission and (current_status == "archived" or not permissions[permission]):
        _fail("submission_permission_required", "Current project permission is required for this delivery action.", 403)
    return current, permissions


def submission_definition(context, task_id):
    definition = context.definition(task_id)
    if definition is None:
        _fail("submission_task_missing", "Task is not available in this project.", 404)
    snapshot = definition["snapshot"]
    criteria = [{**item, "text_digest": hashlib.sha256(item["text"].encode("utf-8")).hexdigest()}
                for item in definition["acceptance"]["sources"]]
    return {"definition": snapshot, "definition_digest": digest(semantic_snapshot(snapshot)),
            "task_basis": context.basis(task_id), "criteria": criteria}


def _native_entries(data, task_id):
    return [entry for entry in data.get("executions", []) if entry.get("task_id") == task_id]


def native_identity(entries):
    """No volatile version/output: a new native delivery always changes this set."""
    return sorted([{"execution_id": item["id"], "workspace_id": item.get("workspace_id") or "",
                    "handoff_id": item.get("handoff_id") or "", "run_id": item.get("run_id") or "",
                    "runtime_task_id": item.get("runtime_task_id") or "", "attempt": item.get("attempt", 1),
                    "status": item.get("status")} for item in entries], key=lambda item: item["execution_id"])


def native_boundary(db, project, user, data, task_id, store=None, execution=None):
    """Pure reads of every relevant E; absence or an unresolved stop never closes it."""
    from hermes_core.managed_controls import control_definition_hash
    from hermes_core.managed_handoff import ManagedHandoff
    from hermes_core.run_controls import stop_view
    from .delivery_execution_control_operation_model import ACTIVE, DeliveryExecutionControlOperation as Control
    from .delivery_execution_handoff import _principal, _request, _validate_original
    from .delivery_execution_handoff_model import DeliveryExecutionHandoff as Handoff
    from .delivery_execution_runtime import _require_managed_source
    from .delivery_issue_evidence import _access

    entries = _native_entries(data, task_id)
    reasons, facts = [], []
    scopes = sorted({entry.get("workspace_id") for entry in entries if entry.get("workspace_id")})
    identities = native_identity(entries)
    if len(entries) > MAX_NATIVE_EXECUTIONS:
        reasons.append(reason("submission_native_history_budget", "The complete native execution history exceeds the closure review budget."))
        boundary = {"identities": identities, "closures": [], "reasons": reasons}
        return {"boundary": boundary, "digest": digest(boundary), "reasons": reasons, "runtime_scopes": scopes}
    ids = [entry["id"] for entry in entries]
    pending = set(db.scalars(select(Control.execution_id).where(*_scope(project, Control),
        Control.execution_id.in_(ids), Control.state.in_(ACTIVE)))) if ids else set()
    for original in entries:
        entry = deepcopy(original)
        code = None
        try:
            if entry.get("status") not in {"accepted", "changes_requested", "cancelled", "failed"}:
                _fail("submission_native_delivery_open", "Review or close native delivery before submitting external work; failed work also requires positive terminal and process-stop evidence.")
            if entry["id"] in pending:
                _fail("submission_native_control_pending", "An accepted native control still has an unresolved effect or launch.")
            principal, _workspace = _access(store, user, project, entry["workspace_id"])
            handoff = None
            gate = None
            if entry.get("handoff_id"):
                handoff = db.get(Handoff, entry["handoff_id"])
                if not handoff or (handoff.tenant_id, handoff.project_id, handoff.execution_id, handoff.task_id, handoff.workspace_id) != (
                        project.tenant_id, project.id, entry["id"], task_id, entry["workspace_id"]):
                    _fail("submission_native_source_changed", "A native handoff no longer identifies this task.")
                _validate_original(handoff)
                gate = ManagedHandoff(store, execution).probe(_principal(handoff), handoff.workspace_id, **_request(handoff))
                if not gate:
                    _fail("submission_native_handoff_unresolved", "The native handoff has no positive terminal or plan evidence.")
                if gate.get("state") == "closed" and gate.get("closed") is True and gate.get("run_id") is None:
                    if entry.get("run_id"):
                        _fail("submission_native_source_changed", "Native runtime references disagree with the closed handoff.")
                    facts.append({"execution_id": entry["id"], "handoff_id": handoff.id, "state": "never_planned", "request_digest": handoff.request_digest})
                    continue
                if gate.get("state") != "planned" or not gate.get("run_id") or not gate.get("runtime_task_id"):
                    _fail("submission_native_handoff_unresolved", "The native handoff is not closed or positively planned.")
                if entry.get("run_id") and entry["run_id"] != gate["run_id"]:
                    _fail("submission_native_source_changed", "Native runtime references changed.")
                if not entry.get("run_id") or entry.get("runtime_task_id") != gate["runtime_task_id"]:
                    _fail("submission_native_projection_pending", "Observe the original native plan before reviewing external takeover.")
                entry.update(run_id=gate["run_id"], runtime_task_id=gate["runtime_task_id"])
            if not entry.get("run_id"):
                _fail("submission_native_stop_unverified", "A missing runtime receipt does not prove that native work never started.")
            run = store.get(principal, entry["workspace_id"], "runs", entry["run_id"])
            _require_managed_source(store, principal, entry, run)
            task = store.get(principal, entry["workspace_id"], "tasks", entry["runtime_task_id"])
            if (task["data"].get("source") or {}).get("snapshot", {}).get("task_id") != task_id:
                _fail("submission_native_source_changed", "Native runtime source no longer identifies this task.")
            if run["status"] not in {"completed", "failed", "cancelled"}:
                _fail("submission_native_run_open", "Native execution is still active.")
            stop = stop_view(run)
            if (not stop or stop.get("state") not in {"not_started", "confirmed"}
                    or run["data"].get("stop_request") and stop.get("attempt", 1) != run["data"].get("attempt", 1)):
                _fail("submission_native_stop_unverified", "Positive process-stop evidence is required before external takeover.")
            facts.append({"execution_id": entry["id"], "handoff_id": entry.get("handoff_id") or "", "run_id": run["id"],
                          "runtime_task_id": entry["runtime_task_id"], "attempt": run["data"].get("attempt", 1),
                          "definition_digest": control_definition_hash(run), "state": run["status"],
                          "stop_id": stop.get("id"), "stop_state": stop["state"], "stop_attempt": stop.get("attempt", 1)})
        except (HTTPException, CoreError) as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else {}
            code = detail.get("code") if isinstance(detail, dict) else None
            code = code or ("submission_native_read_required" if (exc.status_code if isinstance(exc, HTTPException) else exc.status) in {401, 403} else "submission_native_unavailable")
        except Exception:
            code = "submission_native_unavailable"
        if code:
            reasons.append(reason(code, "A native delivery is not positively closed or its original runtime scope cannot be read."))
            facts.append({"execution_id": entry["id"], "state": "unresolved", "code": code})
    boundary = {"identities": identities, "closures": sorted(facts, key=lambda item: item["execution_id"]), "reasons": reasons}
    return {"boundary": boundary, "digest": digest(boundary), "reasons": reasons, "runtime_scopes": scopes}


def report_failures(payload):
    return [f"criterion:{item['source']}:{item['index']}" for item in payload["criteria"] if item["result"] == "not_met"] + [
        "test:" + item["id"] for item in payload["tests"] if item["status"] == "failed"]


def report_accept_reasons(payload):
    reasons = []
    if any(item["result"] != "met" or not item["evidence_ids"] for item in payload["criteria"]):
        reasons.append(reason("submission_criteria_unmet", "Every original acceptance condition needs an explicit met report with evidence."))
    if not payload["tests"] or any(item["status"] != "passed" or not item["evidence_ids"] for item in payload["tests"]):
        reasons.append(reason("submission_tests_unpassed", "All reported checks must pass with evidence; unknown or unrun checks cannot pass acceptance."))
    return reasons


def submission_reasons(context, task_id, *, can_write=True, project_status="active"):
    task = context.tasks.get(task_id)
    if task is None:
        return [reason("submission_task_missing", "The original task is no longer in this project.")]
    reasons = list(context.definition(task_id)["execution_gate"]["reasons"])
    if not can_write or project_status == "archived":
        reasons.append(reason("submission_write_required", "Current project write permission is required."))
    owner = context.owner(task)
    if not owner or not owner["available"]:
        reasons.append(reason("submission_owner_unavailable", "Assign an available responsible person or agent."))
    if task.status == "completed":
        reasons.append(reason("submission_task_completed", "Explicitly reopen this task before reporting new work."))
    planning = context.data.get("task_details", {}).get(task_id, {})
    flow = context.data.get("flows", {}).get(task.req_id, {})
    if planning.get("blocked_reason") or flow.get("blocked_reason") or context.blocked(task_id):
        reasons.append(reason("submission_dependencies_blocked", "Resolve task and requirement blockers and verify predecessors first."))
    if flow.get("stage") in {"release", "operations"}:
        reasons.append(reason("submission_requirement_closed", "Reopen the accepted requirement before reporting new work."))
    return reasons


def _assert_original(row):
    if (digest(row.original) != row.submission_digest or row.original.get("submission_id") != row.id
            or row.original.get("project_id") != row.project_id or row.original.get("tenant_id") != row.tenant_id
            or row.original.get("task_id") != row.task_id or row.original.get("actor") != row.submitted_by
            or row.original.get("accepted_version") != row.accepted_version
            or row.payload.get("task_basis") != row.task_basis or row.payload.get("definition_digest") != row.definition_digest
            or row.payload.get("native_boundary_digest") != row.native_boundary_digest
            or row.original.get("payload") != row.payload
            or row.original.get("definition") != row.definition or row.original.get("native_boundary") != row.native_boundary
            or digest(semantic_snapshot(row.definition)) != row.definition_digest or digest(row.native_boundary) != row.native_boundary_digest):
        _fail("submission_original_invalid", "The fixed external delivery original cannot be verified.")


def _issue(db, project, row, user, *, comment="", existing=None):
    from .delivery_service import identifier

    issue_id = existing or row.issue_id
    if issue_id:
        issue = db.scalar(select(Issue).where(*_scope(project, Issue), Issue.id == issue_id))
        if issue is None:
            _fail("submission_issue_missing", "The original submission issue is unavailable; do not create a duplicate silently.")
        return issue.id
    issue = Issue(id=identifier("ISS"), tenant_id=project.tenant_id, project_id=project.id, task_id=row.task_id,
        title=("External delivery needs changes: " + row.definition["title"])[:256], severity="P2", type="bug", status="open",
        reported_by=user.id, description=("Reported external delivery " + row.id + " / original " + row.submission_digest + "\n" +
            row.payload["summary"] + "\n" + ", ".join(report_failures(row.payload)) + ("\nReview: " + comment if comment else ""))[:20000])
    db.add(issue)
    return issue.id


def _version(db, project):
    version = db.connection().scalar(select(DeliveryWorkspace.version).where(*_scope(project, DeliveryWorkspace)))
    if type(version) is not int or version < 1:
        _fail("submission_acceptance_version_missing", "An external delivery requires a reserved project acceptance version.")
    return version


def _invalidate_rows(db, project, rows, code):
    with task_submission_invalidation_scope(db, project.tenant_id, project.id):
        for row in rows:
            if not row.invalidated:
                row.invalidated, row.invalidated_at, row.invalidated_reason = True, _now(), code
        db.flush()


def _submit(db, project, user, data, body, store, execution, command_key):
    from .delivery_service import identifier
    from .delivery_verification import VerificationContext

    context = VerificationContext(db, project, data)
    fixed = submission_definition(context, body.task_id)
    reasons = submission_reasons(context, body.task_id, project_status=project.status)
    boundary = native_boundary(db, project, user, data, body.task_id, store, execution)
    reasons.extend(boundary["reasons"])
    from .delivery_external_work_order_service import prepare_submission_handoff, submission_intake_reasons

    reasons.extend(submission_intake_reasons(db, project, user, body.task_id, fixed["definition_digest"], boundary["digest"], task_basis=fixed["task_basis"]))
    if reasons:
        _fail(reasons[0]["code"], reasons[0]["message"])
    if body.task_basis != fixed["task_basis"] or body.definition_digest != fixed["definition_digest"] or body.native_boundary_digest != boundary["digest"]:
        _fail("submission_basis_changed", "Task definition or native closure changed. Review and explicitly adopt the latest source.")
    if body.work_order is not None:
        prepare_submission_handoff(db, project, user, body.task_id, body.work_order, store=store, execution=execution)
    actual = sorted((item.source, item.index, item.text_digest) for item in body.criteria)
    expected = sorted((item["source"], item["index"], item["text_digest"]) for item in fixed["criteria"])
    if actual != expected:
        _fail("submission_criteria_changed", "Report every exact original acceptance condition once.")
    payload = body.model_dump(mode="json")
    accepted_version = _version(db, project)
    identity = identifier("submission")
    original = {"schema": "manager.task-delivery.v1", "submission_id": identity, "tenant_id": project.tenant_id,
        "project_id": project.id, "task_id": body.task_id, "actor": user.id, "accepted_version": accepted_version,
        "command_key": command_key, "payload": payload, "definition": fixed["definition"], "native_boundary": boundary["boundary"]}
    row = Submission(id=identity, tenant_id=project.tenant_id, project_id=project.id, task_id=body.task_id,
        submitted_by=user.id, submitted_by_name=user.username, accepted_version=accepted_version,
        task_basis=fixed["task_basis"], definition_digest=fixed["definition_digest"], native_boundary_digest=boundary["digest"],
        submission_digest=digest(original), definition=fixed["definition"], native_boundary=boundary["boundary"], original=original,
        payload=payload, source=payload["source"], summary=payload["summary"][:240], issue_id=None, created_at=_now(),
        counts={"artifacts": len(payload["artifacts"]), "criteria": len(payload["criteria"]), "tests": len(payload["tests"]),
                "reported_passed": sum(item["status"] == "passed" for item in payload["tests"]),
                "reported_failed": sum(item["status"] == "failed" for item in payload["tests"])},
        invalidated=False, invalidated_at=None, invalidated_reason="")
    if report_failures(payload):
        row.issue_id = _issue(db, project, row, user)
    older = db.scalars(select(Submission).where(*_scope(project, Submission), Submission.task_id == row.task_id,
                                               Submission.invalidated.is_(False))).all()
    _invalidate_rows(db, project, older, "submission_superseded")
    with task_submission_write_scope(db, project.tenant_id, project.id, row.id):
        db.add(row)
        db.flush()
    result = {"task_ids": [row.task_id], "submission_id": row.id, "submission_digest": row.submission_digest, "issue_id": row.issue_id}
    if body.work_order is not None:
        from .delivery_external_work_order_contract import WorkOrderReport
        from .delivery_external_work_order_service import apply_work_order

        # Reuse the existing report original/latest/claimant/freshness gates and
        # mutation guard. The caller owns the one transaction and receipt.
        linked = apply_work_order(db, project, user, data, "work_order.report", WorkOrderReport(
            id=body.work_order.id, order_revision=body.work_order.order_revision,
            submission_id=row.id, submission_digest=row.submission_digest, stopped_attestation=body.work_order.stopped_attestation),
            command_key=command_key, store=store, execution=execution)[2]
        result["work_order"] = {"id": linked["work_order_id"], "order_revision": linked["order_revision"], "state": linked["state"]}
    return row.id, None, result


def _review(db, project, user, data, body, store, execution):
    from .delivery_service import identifier
    from .delivery_verification import VerificationContext
    from .delivery_external_work_order_service import require_no_active_work_order

    require_no_active_work_order(db, project, body.task_id, action="submission_review")

    row = db.scalar(select(Submission).where(*_scope(project, Submission), Submission.task_id == body.task_id, Submission.id == body.submission_id))
    if row is None:
        _fail("submission_missing", "Submission is not available for this task and project.", 404)
    _assert_original(row)
    if row.submission_digest != body.submission_digest:
        _fail("submission_original_changed", "The review does not identify the exact submitted original.")
    if db.scalar(select(Decision.id).where(*_scope(project, Decision), Decision.submission_id == row.id)):
        _fail("submission_already_reviewed", "This fixed submission already has a human decision.")
    latest = db.scalar(select(func.max(Submission.seq)).where(*_scope(project, Submission), Submission.task_id == row.task_id))
    if row.invalidated or row.seq != latest:
        _fail("submission_invalidated", "This submission is permanently invalidated or superseded. Prepare a new report.")
    context = VerificationContext(db, project, data)
    fixed = submission_definition(context, row.task_id)
    boundary = native_boundary(db, project, user, data, row.task_id, store, execution)
    if (fixed["task_basis"] != body.task_basis or fixed["definition_digest"] != row.definition_digest
            or boundary["digest"] != body.native_boundary_digest or boundary["digest"] != row.native_boundary_digest):
        _fail("submission_review_basis_changed", "Task definition or native closure changed. Review the original and current basis explicitly.")
    reasons = submission_reasons(context, row.task_id, project_status=project.status) + boundary["reasons"]
    if body.decision == "accept":
        reasons.extend(report_accept_reasons(row.payload))
    if reasons:
        _fail(reasons[0]["code"], reasons[0]["message"])
    task = context.tasks[row.task_id]
    task.status = "completed" if body.decision == "accept" else "in_progress"
    context.reset_proof()
    review = DeliveryTaskReview(id=identifier("task-review"), tenant_id=project.tenant_id, project_id=project.id,
        task_id=row.task_id, reviewer_id=user.id, reviewer_name=user.username, decision=body.decision,
        task_basis=context.basis(row.task_id), snapshot=context.snapshot(row.task_id), comment=body.comment,
        evidence_content=f"External report {row.id}; original digest {row.submission_digest}.\n{row.payload['summary']}", evidence_url="",
        invalidated=False, invalidated_at=None, invalidated_reason="")
    decision = Decision(id=identifier("submission-decision"), tenant_id=project.tenant_id, project_id=project.id,
        task_id=row.task_id, submission_id=row.id, submission_digest=row.submission_digest, review_id=review.id,
        decision=body.decision, reviewer_id=user.id, reviewer_name=user.username, comment=body.comment,
        accepted_version=_version(db, project), issue_id=row.issue_id, created_at=_now())
    if body.decision == "request_changes":
        decision.issue_id = _issue(db, project, row, user, comment=body.comment)
    with task_submission_write_scope(db, project.tenant_id, project.id, row.id):
        db.add(review)
        db.flush()  # FK-backed Decision always links the actual immutable review ID.
        db.add(decision)
        db.flush()
    if body.decision == "accept" and task.req_id:
        flow = data.get("flows", {}).get(task.req_id)
        if flow is not None:
            flow["artifacts"].append({"id": identifier("artifact"), "kind": "test", "title": task.title,
                "content": f"Human reviewed reported external checks; submission {row.id}; {body.comment}",
                "url": "", "result": "passed", "revision": flow["revision"], "at": _now().isoformat() + "Z",
                "actor": user.username, "source": "external-delivery", "evidence_source": "reported_human_reviewed",
                "task_id": task.id, "submission_id": row.id, "review_id": review.id, "evidence_sha256": row.submission_digest})
    return review.id, None, {"task_ids": [row.task_id], "submission_id": row.id, "submission_digest": row.submission_digest,
        "decision_id": decision.id, "review_id": review.id, "issue_id": decision.issue_id}


def apply_submission(db, project, user, data, action, body, *, store=None, execution=None, command_key=""):
    from sop_manager.project_write_guard import require_project_operation

    require_project_operation(db, project.tenant_id, project.id)
    actor, _permissions = _actor(db, project, user, permission="approve" if action == "task.delivery.review" else "write")
    if action == "task.delivery.submit":
        return _submit(db, project, actor, data, body, store, execution, command_key)
    if action == "task.delivery.review":
        return _review(db, project, actor, data, body, store, execution)
    _fail("submission_action_invalid", "Unsupported external delivery action.", 422)


def _submission_runtime_scope_map(db, project, submission_ids):
    """One bounded scope loader for exact originals, summaries and receipts."""
    identities = set(submission_ids)
    if not identities:
        return {}
    predicate = (*_scope(project, Submission), Submission.id.in_(identities))
    field = Submission.native_boundary
    size = func.length(cast(field, LargeBinary)) if db.bind.dialect.name == "sqlite" else func.octet_length(cast(field, Text))
    sizes = db.scalars(select(size).where(*predicate)).all()
    if len(sizes) != len(identities):
        _fail("submission_missing", "A fixed external delivery scope is unavailable.", 404)
    if any((value or 0) > 1024 * 1024 for value in sizes) or sum(value or 0 for value in sizes) > 16 * 1024 * 1024:
        _fail("submission_native_history_budget", "The original runtime scopes exceed the bounded read budget.", 413)
    rows = db.execute(select(Submission.id, field, Submission.payload["work_order"]["id"].as_string()).where(*predicate)).all()
    if any(not isinstance(boundary, dict) for _identity, boundary, _binding in rows):
        _fail("submission_missing", "The accepted submission scope is unavailable.", 404)
    scopes_by_order = {}
    bound = {binding for _identity, _boundary, binding in rows if binding}
    if bound:
        from .delivery_external_work_order_model import DeliveryExternalWorkOrder as Order

        predicate = (*_scope(project, Order), Order.id.in_(bound))
        field = Order.runtime_scopes
        size = func.length(cast(field, LargeBinary)) if db.bind.dialect.name == "sqlite" else func.octet_length(cast(field, Text))
        order_sizes = db.scalars(select(size).where(*predicate)).all()
        if len(order_sizes) != len(bound):
            _fail("work_order_missing", "The bound work order's original runtime scope is unavailable.", 404)
        if (any((value or 0) > 1024 * 1024 for value in order_sizes)
                or sum(value or 0 for value in [*sizes, *order_sizes]) > 16 * 1024 * 1024):
            _fail("submission_native_history_budget", "The complete original report and work-order scopes exceed the bounded read budget.", 413)
        for identity, original_scopes in db.execute(select(Order.id, field).where(*predicate)):
            if not isinstance(original_scopes, list) or any(not isinstance(value, str) for value in original_scopes):
                _fail("work_order_missing", "The bound work order's original runtime scope is unavailable.", 404)
            scopes_by_order[identity] = original_scopes
    return {identity: sorted({item["workspace_id"] for item in boundary.get("identities", []) if item.get("workspace_id")}
        | set(scopes_by_order.get(binding, []))) for identity, boundary, binding in rows}


def _submission_runtime_scope_set(db, project, submission_ids):
    return sorted({scope for scopes in _submission_runtime_scope_map(db, project, submission_ids).values() for scope in scopes})


def assert_submission_access(db, project, user, submission_ids, *, store=None):
    """All paged/legacy consumers recheck S and bound W scopes without bodies."""
    from .delivery_issue_evidence import assert_evidence_access

    identities = set(submission_ids)
    if not identities:
        return
    current, _permissions = _actor(db, project, user)
    assert_evidence_access(store, current, project, _submission_runtime_scope_set(db, project, identities))


def submission_runtime_scopes(db, project, submission_id):
    return _submission_runtime_scope_set(db, project, [submission_id])


PROOF_COLUMNS = (Submission.id, Submission.task_id, Submission.seq, Submission.submission_digest, Submission.definition_digest,
    Submission.native_boundary, Submission.invalidated, Decision.id.label("decision_id"), Decision.review_id, Decision.decision,
    Decision.created_at, Decision.reviewer_id)


def load_external_proofs(db, project, task_ids, *, reviews=None, input_budget=None):
    """Only proof metadata, never report payload, original or definition text."""
    ids = set(task_ids)
    if not ids:
        return {}
    query = select(*PROOF_COLUMNS).join(Decision, Decision.submission_id == Submission.id).where(
        *_scope(project, Submission), *_scope(project, Decision), Submission.task_id.in_(ids))
    if reviews is not None:
        review_ids = [review.id for review in reviews]
        query = query.where(Decision.review_id.in_(review_ids))
    if input_budget is not None:
        input_budget.rows(db, query, PROOF_COLUMNS)
    return {row["review_id"]: dict(row) for row in db.execute(query).mappings()}


def load_latest_submissions(db, project, task_ids, *, input_budget=None):
    ids = set(task_ids)
    if not ids:
        return {}
    latest = select(func.max(Submission.seq).label("seq")).where(*_scope(project, Submission), Submission.task_id.in_(ids)).group_by(Submission.task_id).subquery()
    columns = (Submission.id, Submission.task_id, Submission.submitted_by, Submission.submission_digest, Submission.definition_digest, Submission.native_boundary,
               Submission.invalidated, Decision.id.label("decision_id"))
    query = select(*columns).join(latest, Submission.seq == latest.c.seq).outerjoin(Decision, Decision.submission_id == Submission.id)
    if input_budget is not None:
        input_budget.rows(db, query, columns)
    return {row["task_id"]: dict(row) for row in db.execute(query).mappings()}


def submission_current_valid(context, task_id, proof):
    if not proof or proof["invalidated"] or task_id not in context.tasks:
        return False
    definition = context.definition(task_id)
    return bool(definition and digest(semantic_snapshot(definition["snapshot"])) == proof["definition_digest"]
        and native_identity(_native_entries(context.data, task_id)) == proof["native_boundary"]["identities"])


def native_takeover(context, entry):
    """Immutable reported takeover retires old E, even after S invalidation."""
    submitted = context.latest_submissions.get(entry["task_id"])
    if not submitted:
        return None
    boundary = submitted["native_boundary"]
    identity = next((item for item in boundary["identities"] if item["execution_id"] == entry["id"]), None)
    if identity is None:
        return None
    closure = next((item for item in boundary["closures"] if item["execution_id"] == entry["id"]), None)
    return {"submission_id": submitted["id"], "identity": identity, "closure": closure}


def native_takeover_closed(context, entry):
    takeover = native_takeover(context, entry)
    if not takeover:
        return False
    identity, closure = takeover["identity"], takeover["closure"]
    if not closure or any(identity[key] != value for key, value in (
            ("workspace_id", entry.get("workspace_id") or ""), ("run_id", entry.get("run_id") or ""),
            ("runtime_task_id", entry.get("runtime_task_id") or ""), ("handoff_id", entry.get("handoff_id") or ""),
            ("attempt", entry.get("attempt", 1)))):
        return False
    return bool(closure.get("state") == "never_planned" and not identity["run_id"]
                or closure.get("state") in {"completed", "failed", "cancelled"}
                and closure.get("stop_state") in {"confirmed", "not_started"})


def require_native_not_taken_over(context, entry):
    if native_takeover(context, entry):
        _fail("execution_external_takeover", "This original execution is retained as history after external takeover. Reopen the task and prepare a new execution plan.")


def current_submission(context, task_id):
    candidate = context.latest_submissions.get(task_id)
    return candidate if submission_current_valid(context, task_id, candidate) else None


def external_review_valid(context, task_id, review, proof):
    return bool(review and proof and proof["task_id"] == task_id and proof["review_id"] == review.id
                and proof["decision"] == "accept" and review.decision == "accept" and not review.invalidated
                and submission_current_valid(context, task_id, proof))


def external_is_latest_delivery(context, task_id, proof):
    latest = context.executions.get(task_id)
    return not latest or latest["id"] in {item["execution_id"] for item in proof["native_boundary"]["identities"]}


def invalidate_submissions(db, project, verification):
    rows = db.scalars(select(Submission).where(*_scope(project, Submission), Submission.invalidated.is_(False))).all()
    with task_submission_invalidation_scope(db, project.tenant_id, project.id):
        for row in rows:
            code = None
            if row.task_id not in verification.tasks:
                code = "submission_task_missing"
            elif digest(semantic_snapshot(verification.definition(row.task_id)["snapshot"])) != row.definition_digest:
                code = "submission_definition_changed"
            elif native_identity(_native_entries(verification.data, row.task_id)) != row.native_boundary["identities"]:
                code = "submission_native_boundary_changed"
            if code:
                row.invalidated, row.invalidated_at, row.invalidated_reason = True, _now(), code
        db.flush()
    verification.external_proofs = load_external_proofs(db, project, verification.tasks, reviews=verification.reviews.values())
    verification.latest_submissions = load_latest_submissions(db, project, verification.tasks)
    verification.reset_proof()


def sync_submission_review_invalidation(db, project, verification):
    """A decided original loses acceptance permanently with its real review."""
    rows = db.scalars(select(Submission).join(Decision, Decision.submission_id == Submission.id)
        .join(DeliveryTaskReview, DeliveryTaskReview.id == Decision.review_id).where(
            *_scope(project, Submission), *_scope(project, Decision), *_scope(project, DeliveryTaskReview),
            Submission.invalidated.is_(False), DeliveryTaskReview.invalidated.is_(True))).all()
    if not rows:
        return
    _invalidate_rows(db, project, rows, "submission_review_invalidated")
    verification.external_proofs = load_external_proofs(db, project, verification.tasks, reviews=verification.reviews.values())
    verification.latest_submissions = load_latest_submissions(db, project, verification.tasks)
    verification.reset_proof()
