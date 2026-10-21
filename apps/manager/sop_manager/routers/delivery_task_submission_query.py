"""Bounded current sources, thin single-page history and exact external originals."""
from copy import deepcopy
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import LargeBinary, Text, cast, func, select

from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_issue_evidence import assert_evidence_access
from .delivery_quality_scope import _paths, load_task_scope
from .delivery_query_index import scope
from .delivery_query_read import _now, _stamp, _unchanged, metadata
from .delivery_service import stamp
from .delivery_task_contract import public_design_snapshot
from .delivery_task_submission_model import DeliveryTaskSubmission as Submission, DeliveryTaskSubmissionDecision as Decision
from .delivery_task_submission_service import (
    MAX_NATIVE_EXECUTIONS, _actor, _assert_original, assert_submission_access, native_boundary, reason, report_accept_reasons,
    submission_current_valid, submission_definition, submission_reasons, submission_runtime_scopes,
)
from .sql_models import DeliveryQueryFact, DeliveryWorkspace, Task

SUMMARY_COLUMNS = (Submission.id, Submission.task_id, Submission.created_at, Submission.submitted_by, Submission.submitted_by_name,
    Submission.source, Submission.summary, Submission.submission_digest, Submission.task_basis, Submission.definition_digest,
    Submission.native_boundary_digest, Submission.invalidated, Submission.invalidated_at, Submission.invalidated_reason,
    Submission.counts, Submission.issue_id, Decision.review_id, Decision.decision, Decision.issue_id.label("decision_issue_id"))


def _summary(row):
    return {"id": row.id, "task_id": row.task_id, "created_at": row.created_at.isoformat() + "Z",
        "submitted_by": {"id": row.submitted_by, "name": row.submitted_by_name}, "source": deepcopy(row.source),
        "summary": row.summary, "digest": row.submission_digest, "task_basis": row.task_basis,
        "definition_digest": row.definition_digest, "native_boundary_digest": row.native_boundary_digest,
        "status": "invalidated" if row.invalidated else "accepted" if row.decision == "accept" else "changes_requested" if row.decision else "awaiting_review",
        "invalidated": row.invalidated, "invalidated_at": row.invalidated_at.isoformat() + "Z" if row.invalidated_at else None,
        "invalidated_reason": row.invalidated_reason, "counts": deepcopy(row.counts),
        "issue_id": row.decision_issue_id or row.issue_id, "review_id": row.review_id}


def _query(project, task_id):
    return select(*SUMMARY_COLUMNS).outerjoin(Decision, Decision.submission_id == Submission.id).where(
        *scope(project, Submission), Submission.task_id == task_id)


def _context(db, project, task_id):
    # Current admission always checks every E, even before the first external S.
    query = select(DeliveryQueryFact.entity_id, DeliveryQueryFact.data).where(*scope(project, DeliveryQueryFact),
        DeliveryQueryFact.kind == "execution", DeliveryQueryFact.data["task_id"].as_string() == task_id)
    count = db.scalar(select(func.count()).select_from(query.subquery()))
    if count > MAX_NATIVE_EXECUTIONS:
        raise HTTPException(413, {"code": "submission_native_history_budget", "message": "The complete native execution history exceeds the external takeover review budget."})
    rows = db.execute(query).all()
    if any(type(facts.get("position")) is not int or facts["position"] < 0 for _identity, facts in rows):
        raise HTTPException(409, "Native execution source positions changed; reload this task")
    rows.sort(key=lambda row: row[1]["position"])
    paths = {identity: ("executions", facts["position"]) for identity, facts in rows}
    columns = [DeliveryWorkspace.data[path] for path in paths.values()]
    sizes = db.execute(select(*(func.length(cast(field, LargeBinary)) if db.bind.dialect.name == "sqlite"
        else func.octet_length(cast(field, Text)) for field in columns)).where(*scope(project, DeliveryWorkspace))).first() if columns else []
    if sizes and (any((size or 0) > 1024 * 1024 for size in sizes) or sum(size or 0 for size in sizes) > 16 * 1024 * 1024):
        raise HTTPException(413, {"code": "submission_native_history_budget", "message": "The complete native source exceeds its bounded closure review budget."})
    context = load_task_scope(db, project, task_id)
    values = _paths(db, project, paths)
    entries = [entry for entry in context.data.get("executions", []) if entry.get("task_id") != task_id]
    for identity, entry in values.items():
        if not isinstance(entry, dict) or entry.get("id") != identity or entry.get("task_id") != task_id:
            raise HTTPException(409, {"code": "delivery_query_cursor_stale", "message": "Native execution source changed. Reload this task."})
        entries.append(entry)
    context.data["executions"] = entries
    context.executions = {entry["task_id"]: entry for entry in entries}
    context.reset_proof()
    return context


def submission_current(db, project, user, task_id, *, store=None, execution=None):
    current, permissions = _actor(db, project, user)
    with db.no_autoflush:
        generation = _stamp(db, project)
        context = _context(db, project, task_id)
        fixed = submission_definition(context, task_id)
        boundary = native_boundary(db, project, current, context.data, task_id, store, execution)
        reasons = submission_reasons(context, task_id, can_write=permissions["write"], project_status=project.status) + boundary["reasons"]
        latest = db.scalar(select(Submission.id).where(*scope(project, Submission), Submission.task_id == task_id).order_by(Submission.seq.desc()).limit(1))
        _unchanged(db, project, generation)
        return {**metadata(db, project, generation), "task_id": task_id, "as_of": _now(), **fixed,
                "native_boundary_digest": boundary["digest"], "can_submit": not reasons, "reasons": reasons,
                "latest_submission_id": latest}


def submission_list(db, project, user, task_id, *, limit=20, cursor="", store=None, execution=None):
    current, _permissions = _actor(db, project, user)
    if type(limit) is not int or not 1 <= limit <= 100:
        raise HTTPException(422, "Use a submission page size between 1 and 100")
    filters = [project.tenant_id, project.id, user.id, task_id, "task-delivery-submissions", limit]
    after = None
    if cursor:
        upper, position = decode_cursor(cursor, filters)
        if (len(upper) != 1 or len(position) != 1 or type(upper[0]) is not int or type(position[0]) is not int
                or not 0 < position[0] <= upper[0]):
            raise HTTPException(422, "Malformed submission history cursor")
        maximum, after = upper[0], position[0]
    else:
        maximum = db.scalar(select(func.max(Submission.seq)).where(*scope(project, Submission), Submission.task_id == task_id)) or 0
    bounded = (*scope(project, Submission), Submission.task_id == task_id, Submission.seq <= maximum)
    total = db.scalar(select(func.count()).select_from(Submission).where(*bounded))
    if not total and not db.scalar(select(Task.id).where(*scope(project, Task), Task.id == task_id)):
        raise HTTPException(404, "Task delivery submissions are not available in this project")
    query = _query(project, task_id).add_columns(Submission.seq).where(Submission.seq <= maximum)
    if after is not None:
        query = query.where(Submission.seq < after)
    rows = db.execute(query.order_by(Submission.seq.desc()).limit(limit + 1)).mappings().all()
    page = rows[:limit]
    assert_submission_access(db, project, current, [row["id"] for row in page], store=store)
    return {"project_id": project.id, "task_id": task_id, "as_of": stamp(), "items": [_summary(SimpleNamespace(**dict(row))) for row in page],
            "total": total, "limit": limit, "next_cursor": encode_cursor(filters, [maximum], [page[-1]["seq"]]) if len(rows) > limit else None}


def submission_detail(db, project, user, task_id, submission_id, *, store=None, execution=None):
    current, permissions = _actor(db, project, user)
    predicate = (*scope(project, Submission), Submission.task_id == task_id, Submission.id == submission_id)
    # Exact detail has a fixed source budget before downloading any JSON body.
    fields = (Submission.payload, Submission.original, Submission.definition, Submission.native_boundary)
    sizes = db.execute(select(*(func.length(cast(field, LargeBinary)) if db.bind.dialect.name == "sqlite"
        else func.octet_length(cast(field, Text)) for field in fields)).where(*predicate)).first()
    if sizes is None:
        raise HTTPException(404, "Submission not found for this task and project")
    if any((size or 0) > 1024 * 1024 for size in sizes):
        raise HTTPException(413, "The exact external original exceeds its bounded source budget")
    row = db.scalar(select(Submission).where(*predicate))
    _assert_original(row)
    assert_evidence_access(store, current, project, submission_runtime_scopes(db, project, row.id))
    decision = db.scalar(select(Decision).where(*scope(project, Decision), Decision.submission_id == row.id))
    summary = db.execute(_query(project, task_id).where(Submission.id == row.id)).mappings().one()
    reasons, task_basis, boundary_digest = [], None, None
    try:
        generation = _stamp(db, project)
        context = _context(db, project, task_id)
        task_basis = context.basis(task_id)
        boundary = native_boundary(db, project, current, context.data, task_id, store, execution)
        boundary_digest = boundary["digest"] if not boundary["reasons"] else None
        reasons = submission_reasons(context, task_id, project_status=project.status) + boundary["reasons"]
        if not submission_current_valid(context, task_id, {"invalidated": row.invalidated, "definition_digest": row.definition_digest, "native_boundary": row.native_boundary}):
            reasons.append(reason("submission_invalidated", "The original definition or complete native boundary changed."))
        _unchanged(db, project, generation)
    except HTTPException as exc:
        code = exc.detail.get("code") if isinstance(exc.detail, dict) else None
        reasons = [reason(code or "submission_current_unavailable", "The current task source is unavailable; the original remains readable.")]
    latest = db.scalar(select(func.max(Submission.seq)).where(*scope(project, Submission), Submission.task_id == task_id))
    if row.invalidated or row.seq != latest:
        reasons.append(reason("submission_invalidated", "The fixed original was invalidated or superseded."))
    if decision:
        reasons.append(reason("submission_already_reviewed", "The fixed original already has a human decision."))
    if not permissions["approve"]:
        reasons.append(reason("submission_approval_required", "Project approval permission is required to review delivery."))
    can_review = not reasons
    accept_reasons = report_accept_reasons(row.payload)
    decision_view = {"id": decision.id, "review_id": decision.review_id, "decision": decision.decision,
        "reviewer": {"id": decision.reviewer_id, "name": decision.reviewer_name}, "comment": decision.comment,
        "created_at": decision.created_at.isoformat() + "Z"} if decision else None
    version = db.scalar(select(DeliveryWorkspace.version).where(*scope(project, DeliveryWorkspace))) or 0
    return {"project_id": project.id, "task_id": task_id, "version": version, "as_of": stamp(), "task_basis": task_basis,
        "native_boundary_digest": boundary_digest, "submission": _summary(SimpleNamespace(**dict(summary))),
        "payload": deepcopy(row.payload), "definition": public_design_snapshot(row.definition), "decision": decision_view,
        "permissions": {"can_review": can_review, "can_accept": can_review and not accept_reasons,
                        "reasons": reasons + accept_reasons}}
