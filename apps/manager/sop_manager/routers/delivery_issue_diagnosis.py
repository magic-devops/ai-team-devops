"""Fixed issue evidence, durable model receipts and explicit human demand feedback.

The provider never holds a business lock. Pending receipts are observations of an
uncertain call, never an instruction to call the provider again.
"""

import base64
import json
from copy import deepcopy
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError

from .delivery_issue_contract import DiagnosisHistory, DiagnosisSnapshot, DiagnosisView, IssueDetail
from .delivery_service import _fingerprint, get_record, initial_state, records, stamp
from .sql_models import DeliveryWorkspace, Issue, IssueDiagnosis, Project, Requirement, User


def fail(status, code, message):
    raise HTTPException(status, {"code": code, "message": message})


def _access(db, project, user, *, permission=None):
    from .delivery import _permissions, _project

    actor = db.get(User, user.id, populate_existing=True)
    if not actor or actor.status != "active":
        fail(403, "issue_diagnosis_access_changed", "An active account is required")
    current = db.get(Project, project.id, populate_existing=True)
    if current is None:
        fail(404, "project_missing", "Project was not found")
    current = _project(db, actor, current.id)
    permissions = _permissions(db, actor, current)
    if permission and not permissions[permission]:
        fail(403, "issue_diagnosis_access_changed", f"Project {permission} permission is required")
    return current, actor, permissions


def _source(db, project, data, user, issue_id, store, execution, selected_ids=()):
    from .delivery_issue_evidence import issue_snapshot

    source = issue_snapshot(db, project, data, user, issue_id, store=store, execution=execution)
    return _selected_source(db, project, user, issue_id, source, selected_ids)


def _selected_source(db, project, user, issue_id, source, ids):
    from .delivery_issue_origins import selected_origins

    items, digests = selected_origins(db, project, user, issue_id, ids)
    return {**source, "evidence": [*source["evidence"], *items],
        "evidence_digests": {**source.get("evidence_digests", {}), **digests}}


def _workspace(db, project):
    row = db.get(DeliveryWorkspace, project.id, populate_existing=True)
    if row and row.tenant_id != project.tenant_id:
        fail(403, "issue_diagnosis_scope_changed", "Workspace tenant differs from the project")
    return (row.version, deepcopy(row.data)) if row else (0, initial_state())


def _readable(row, store, user, project):
    from .delivery_issue_evidence import assert_evidence_access

    try:
        assert_evidence_access(store, user, project, row.data["runtime_scopes"])
        return True
    except HTTPException as exc:
        if exc.status_code in {401, 403, 404, 409, 503}:
            return False
        raise


def _current(row, source):
    return (
        not source.get("missing")
        and row.data["issue_basis"] == source["issue_basis"]
        and all(
            source.get("evidence_digests", {}).get(id) == digest
            for id, digest in row.data["selected_evidence_digests"].items()
        )
    )


def _reason(code, message):
    return {"code": code, "message": message}


def _view(row, source, user, project, permissions, store, db=None):
    if db is not None and not source.get("missing"):
        source = _selected_source(db, project, user, row.issue_id, source, row.data["selected_evidence_digests"])
    readable = _readable(row, store, user, project)
    current = readable and _current(row, source)
    review = row.data.get("review")
    reasons = []
    if not readable:
        reasons.append(
            _reason(
                "issue_diagnosis_evidence_restricted",
                "The original selected evidence is not currently readable",
            )
        )
    elif not current:
        reasons.append(
            _reason(
                "issue_diagnosis_source_missing"
                if source.get("missing")
                else "issue_diagnosis_basis_changed",
                "The source Issue is missing; this proposal can only be viewed or dismissed"
                if source.get("missing")
                else "Issue or selected evidence changed; generate a new proposal",
            )
        )
    if not permissions["approve"]:
        reasons.append(
            _reason("issue_diagnosis_approval_required", "Project approval permission is required")
        )
    if row.status != "succeeded":
        reasons.append(_reason("issue_diagnosis_unavailable", "Only a successful proposal can be adopted"))
    if review:
        reasons.append(_reason("issue_diagnosis_reviewed", "The proposal has already been reviewed"))
    can_dismiss = bool(
        not review
        and row.status != "cancelled"
        and (permissions["approve"] or user.id == row.user_id and permissions["write"])
    )
    value = {
        "id": row.id,
        "issue_id": row.issue_id,
        "request_key": row.data["request_key"],
        "requested_by": row.data["requested_by"],
        "generator": row.data["generator"],
        "status": row.status,
        "issue_basis": row.data["issue_basis"],
        "current": current,
        "restricted": not readable,
        "snapshot": deepcopy(row.data["snapshot"]) if readable else None,
        "result": deepcopy(row.data.get("result")) if readable else None,
        "error": deepcopy(row.data.get("error")) if readable else None,
        "model": row.data.get("model", "") if readable else "",
        "provider": row.data.get("provider", "") if readable else "",
        "usage": deepcopy(row.data.get("usage", {})) if readable else {},
        "created_at": row.created_at.isoformat() + "Z",
        "review": deepcopy(review) if readable else None,
        "actions": {
            "can_adopt": bool(
                current and permissions["approve"] and row.status == "succeeded" and not review
            ),
            "can_dismiss": can_dismiss,
            "reasons": reasons,
        },
    }
    return DiagnosisView.model_validate(value).model_dump(mode="json")


def _encode_cursor(project, issue_id, row):
    payload = [project.tenant_id, project.id, issue_id, row.created_at.isoformat(), row.id]
    return base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")


def _decode_cursor(project, issue_id, value):
    try:
        if len(value) > 2048:
            raise ValueError("Cursor exceeds its bound")
        payload = json.loads(base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True))
        if (
            not isinstance(payload, list)
            or len(payload) != 5
            or payload[:3] != [project.tenant_id, project.id, issue_id]
            or not isinstance(payload[3], str)
            or not isinstance(payload[4], str)
            or len(payload[4]) != 64
            or any(char not in "0123456789abcdef" for char in payload[4])
        ):
            raise ValueError("Cursor scope mismatch")
        return datetime.fromisoformat(payload[3]), payload[4]
    except (ValueError, TypeError, UnicodeError, OverflowError, RecursionError):
        fail(
            422, "issue_diagnosis_cursor_invalid", "History cursor does not belong to this project and issue"
        )


def _history(db, project, source, user, permissions, issue_id, cursor, store):
    query = records(db, IssueDiagnosis, project).filter_by(issue_id=issue_id)
    if cursor:
        at, id = _decode_cursor(project, issue_id, cursor)
        query = query.filter(
            or_(IssueDiagnosis.created_at < at, and_(IssueDiagnosis.created_at == at, IssueDiagnosis.id < id))
        )
    rows = query.order_by(IssueDiagnosis.created_at.desc(), IssueDiagnosis.id.desc()).limit(21).all()
    items = [_view(row, source, user, project, permissions, store, db) for row in rows[:20]]
    return items, _encode_cursor(project, issue_id, rows[19]) if len(rows) > 20 else None


def issue_detail(db, project, data, user, id, *, version, store=None, execution=None):
    from .delivery_issue_origins import origin_summary
    project, user, permissions = _access(db, project, user)
    source = _source(db, project, data, user, id, store, execution)
    diagnoses, cursor = _history(db, project, source, user, permissions, id, "", store)
    result = {
        "project_id": project.id,
        "version": version,
        "as_of": stamp(),
        "issue": source["issue"],
        "issue_basis": source["issue_basis"],
        "evidence": source["evidence"],
        "requirement_id": source["requirement_id"],
        "diagnoses": diagnoses,
        "next_cursor": cursor,
        "permissions": {
            "can_generate": permissions["write"],
            "can_adopt": permissions["approve"],
            "can_dismiss": permissions["write"] or permissions["approve"],
        },
        "reasons": []
        if permissions["write"]
        else [
            _reason(
                "issue_diagnosis_write_required",
                "Project write permission is required to generate a proposal",
            )
        ],
        "origin_summary": origin_summary(db, project, id),
    }
    return IssueDetail.model_validate(result).model_dump(mode="json")


def diagnosis_history(db, project, data, user, id, *, cursor="", store=None, execution=None):
    project, user, permissions = _access(db, project, user)
    source = _source(db, project, data, user, id, store, execution)
    items, next_cursor = _history(db, project, source, user, permissions, id, cursor, store)
    return DiagnosisHistory.model_validate(
        {
            "project_id": project.id,
            "issue_id": id,
            "issue_basis": source["issue_basis"],
            "items": items,
            "next_cursor": next_cursor,
        }
    ).model_dump(mode="json")


def diagnosis_detail(db, project, user, issue_id, diagnosis_id, *, store=None, execution=None):
    """Read one original proposal even when its business Issue has been removed."""
    project, user, permissions = _access(db, project, user)
    row = records(db, IssueDiagnosis, project).filter_by(id=diagnosis_id, issue_id=issue_id).first()
    if not row:
        fail(404, "issue_diagnosis_missing", "Diagnosis was not found in this project and issue")
    if records(db, Issue, project).filter_by(id=issue_id).first():
        _, data = _workspace(db, project)
        source = _source(db, project, data, user, issue_id, store, execution)
    else:
        source = {"issue_basis": row.data["issue_basis"], "evidence_digests": {}, "missing": True}
    return _view(row, source, user, project, permissions, store, db)


def _selected(source, ids, issue_id):
    available = {item["id"]: item for item in source["evidence"]}
    if f"issue:{issue_id}" not in ids:
        fail(422, "issue_diagnosis_issue_required", "Select the issue itself as diagnosis evidence")
    if any(id not in available or available[id]["missing"] or available[id]["restricted"] for id in ids):
        fail(
            422,
            "issue_diagnosis_evidence_unavailable",
            "Selected evidence is missing, restricted or outside this issue",
        )
    digests = source.get("evidence_digests", {})
    if any(id not in digests for id in ids):
        fail(
            409,
            "issue_diagnosis_evidence_changed",
            "Selected evidence could not be fixed; refresh before generation",
        )
    snapshot = DiagnosisSnapshot.model_validate(
        {
            "issue": source["issue"],
            "evidence": [available[id] for id in ids],
            "requirement_id": source["requirement_id"],
        }
    ).model_dump(mode="json")
    scopes = sorted({source["evidence_scopes"][id] for id in ids if id in source.get("evidence_scopes", {})})
    scopes = sorted(set(scopes) | {workspace for id in ids for workspace in source.get("evidence_scope_sets", {}).get(id, [])})
    return snapshot, {id: digests[id] for id in ids}, scopes


def generate_diagnosis(db, project, user, issue_id, body, request, *, store=None, execution=None):
    from ..project_write_guard import require_project_operation
    from .delivery_issue_generation import generate_result

    project_id, user_id = project.id, user.id
    # The project lock serializes receipt creation with archive and other writers.
    require_project_operation(db, project.tenant_id, project_id)
    project, user, permissions = _access(db, project, user, permission="write")
    fingerprint = _fingerprint([issue_id, body.model_dump(mode="json")])
    key = _fingerprint(["issue-diagnosis", project.tenant_id, project.id, user.id, body.idempotency_key])
    row = db.get(IssueDiagnosis, key, populate_existing=True)
    version, data = _workspace(db, project)
    source = _source(db, project, data, user, issue_id, store, execution, body.selected_evidence_ids)
    if row:
        if row.request_hash != fingerprint:
            fail(
                409,
                "issue_diagnosis_idempotency_conflict",
                "Request key was already used with different input",
            )
        # Pure replay: no provider, no source replacement, no workspace write.
        return _view(row, source, user, project, permissions, store, db)
    if version != body.expected_version:
        fail(
            409,
            "issue_diagnosis_version_conflict",
            "Project changed; explicitly review the current workspace version",
        )
    if source["issue_basis"] != body.issue_basis:
        fail(
            409,
            "issue_diagnosis_basis_changed",
            "Issue changed; review the current evidence before generation",
        )
    snapshot, digests, scopes = _selected(source, body.selected_evidence_ids, issue_id)
    row = IssueDiagnosis(
        id=key,
        tenant_id=project.tenant_id,
        project_id=project.id,
        issue_id=issue_id,
        user_id=user.id,
        request_hash=fingerprint,
        status="generating",
        data={
            "request_key": body.idempotency_key,
            "requested_by": {"id": user.id, "name": user.username},
            "generator": body.generator,
            "issue_basis": source["issue_basis"],
            "snapshot": snapshot,
            "selected_evidence_digests": digests,
            "runtime_scopes": scopes,
        },
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        project, user, permissions = _access(db, Project(id=project_id), User(id=user_id), permission="write")
        other = db.get(IssueDiagnosis, key, populate_existing=True)
        if other and other.request_hash == fingerprint:
            _, state = _workspace(db, project)
            return _view(
                other,
                _source(db, project, state, user, issue_id, store, execution),
                user,
                project,
                permissions,
                store,
                db,
            )
        fail(409, "issue_diagnosis_concurrent", "Another request was recorded; retry the original request")
    # Do not retain an ORM instance across rollback/commit and a provider call.
    outcome = generate_result(request, body, snapshot)
    db.rollback()
    db.expire_all()
    fresh_project = db.get(Project, project_id)
    if not fresh_project:
        fail(404, "project_missing", "Project was removed while generating the proposal")
    row = db.get(IssueDiagnosis, key, populate_existing=True)
    if row is None:
        fail(404, "issue_diagnosis_missing", "The generation receipt is unavailable")
    if row.status == "generating" and not row.data.get("review"):
        require_project_operation(db, fresh_project.tenant_id, project_id)
        db.refresh(row)
        if row.status == "generating" and not row.data.get("review"):
            row.status = outcome["status"]
            row.data = {**row.data, **{field: value for field, value in outcome.items() if field != "status"}}
            db.commit()
    project, user, permissions = _access(db, Project(id=project_id), User(id=user_id))
    _, current = _workspace(db, project)
    source = _source(db, project, current, user, issue_id, store, execution)
    return _view(
        db.get(IssueDiagnosis, key, populate_existing=True), source, user, project, permissions, store, db
    )


def apply_issue_diagnosis(db, project, user, data, action, body, *, store=None, execution=None):
    from ..project_write_guard import require_project_operation

    require_project_operation(db, project.tenant_id, project.id)
    project, user, permissions = _access(db, project, user)
    row = records(db, IssueDiagnosis, project).filter_by(id=body.diagnosis_id, issue_id=body.issue_id).first()
    if not row:
        fail(404, "issue_diagnosis_missing", "Diagnosis was not found in this project and issue")
    if row.data["issue_basis"] != body.issue_basis:
        fail(409, "issue_diagnosis_basis_changed", "The review does not identify the fixed proposal basis")
    before = {"status": row.status, "review": deepcopy(row.data.get("review"))}
    if row.data.get("review") or row.status == "cancelled":
        fail(409, "issue_diagnosis_reviewed", "The proposal has already been reviewed")
    actor = {"id": user.id, "name": user.username}
    if action == "issue.diagnosis.dismiss":
        if not (permissions["approve"] or user.id == row.user_id and permissions["write"]):
            fail(
                403,
                "issue_diagnosis_dismiss_denied",
                "Only the author or an authorized reviewer can dismiss this proposal",
            )
        decision = "cancelled" if row.status == "generating" else "rejected"
        if row.status == "generating":
            row.status = "cancelled"
        row.data = {
            **row.data,
            "review": {
                "decision": decision,
                "actor": actor,
                "comment": body.comment,
                "at": stamp(),
                "requirement_id": None,
            },
        }
        return row.id, before, {"diagnosis_id": row.id, "decision": decision, "requirement_id": None}
    if action != "issue.diagnosis.adopt":
        fail(422, "issue_diagnosis_action_invalid", "Unknown diagnosis review action")
    get_record(db, Issue, project, body.issue_id)
    if not permissions["approve"]:
        fail(403, "issue_diagnosis_approval_required", "Project approval permission is required")
    if row.status != "succeeded":
        fail(409, "issue_diagnosis_unavailable", "Only a successful diagnosis can be adopted")
    if not _readable(row, store, user, project):
        fail(
            403, "issue_diagnosis_evidence_restricted", "Original selected evidence is not currently readable"
        )
    source = _source(db, project, data, user, body.issue_id, store, execution, row.data["selected_evidence_digests"])
    if not _current(row, source):
        fail(
            409,
            "issue_diagnosis_basis_changed",
            "Issue or selected execution evidence changed; generate a new proposal",
        )
    return _adopt(db, project, data, user, row, source, body, before)


def _adopt(db, project, data, user, row, source, body, before):
    from .delivery_contract import IssuePromote
    from .delivery_service import _promote_issue

    actor = {"id": user.id, "name": user.username}
    existing = source["requirement_id"]
    resource, _ = _promote_issue(
        db, project, data, IssuePromote(issue_id=body.issue_id, acceptance_criteria=body.acceptance_criteria)
    )
    if not existing:
        # Production sessions disable autoflush; the new canonical row must be
        # visible to scoped reads within this same business transaction.
        db.flush()
        requirement = get_record(db, Requirement, project, resource)
        requirement.title, requirement.description, requirement.priority = (
            body.title,
            body.description,
            body.priority,
        )
        requirement.acceptance_criteria = list(body.acceptance_criteria)
        data["flows"][resource]["source_diagnosis"] = {
            "id": row.id,
            "basis": row.data["issue_basis"],
            "result_sha": _fingerprint(row.data["result"]),
            "reviewer": actor,
            "comment": body.comment,
        }
    row.data = {
        **row.data,
        "review": {
            "decision": "adopted",
            "actor": actor,
            "comment": body.comment,
            "at": stamp(),
            "requirement_id": resource,
        },
    }
    return (
        resource,
        before,
        {
            "diagnosis_id": row.id,
            "decision": "adopted",
            "requirement_id": resource,
            "created": not bool(existing),
        },
    )


def active_diagnosis_ids(db, project):
    return [
        id
        for (id,) in records(db, IssueDiagnosis, project)
        .with_entities(IssueDiagnosis.id)
        .filter_by(status="generating")
        .order_by(IssueDiagnosis.created_at, IssueDiagnosis.id)
        .all()
    ]
