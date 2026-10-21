"""Freeze authorized returned-report originals; never infer current acceptance."""
from copy import deepcopy
import hashlib
import json

from fastapi import HTTPException
from hermes_core.models import CoreError
from sqlalchemy import LargeBinary, Text, cast, func, select

from .delivery_feedback_contract import FeedbackReference, MAX_FEEDBACK_CONTEXT_BYTES
from .delivery_query_index import scope

CONTEXT_FIELDS = ("feedback_context", "feedback_context_sha256")


def fail(code="feedback_reference_invalid", message="Select the exact returned report and human decision for this task.", status=409):
    raise HTTPException(status, {"code": code, "message": message})


def _bytes(db, column):
    return func.length(cast(column, LargeBinary)) if db.bind.dialect.name == "sqlite" else func.octet_length(cast(column, Text))


def _scopes(values):
    if (not isinstance(values, list) or len(values) > 1000
            or any(not isinstance(value, str) or not value.strip() or len(value) > 64 for value in values)
            or len(set(values)) != len(values)):
        fail("feedback_context_invalid", "The fixed feedback permission scope cannot be verified.")
    return sorted(values)


def context_fields(values):
    return {key: deepcopy(values[key]) for key in CONTEXT_FIELDS if key in values}


def validate_fixed_feedback(values, *, project_id, task_id, reference=None):
    """Check only the frozen original, without loading a later S or Decision."""
    from hermes_core.agent_input import validate_feedback_context

    try:
        selected = FeedbackReference.model_validate(reference).model_dump(mode="json") if reference is not None else None
        envelope = {**context_fields(values), "source": {"kind": "manager.delivery", "snapshot": {"task_id": task_id}}}
        if selected is not None:
            envelope["source"]["feedback_reference"] = selected
            if "feedback_runtime_scopes" not in values:
                fail("feedback_context_invalid", "Selected feedback requires its explicit fixed permission scope.")
        context = validate_feedback_context(envelope, project_id=project_id)
        scopes = _scopes(values.get("feedback_runtime_scopes", []))
        if context is None and scopes:
            fail("feedback_context_invalid", "Feedback permissions require a fixed selected context.")
        return context, scopes
    except CoreError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from exc
    except (TypeError, ValueError):
        fail("feedback_context_invalid", "The fixed feedback reference cannot be verified.")


def assert_fixed_feedback_access(project, user, values, *, task_id, reference=None, store=None):
    from .delivery_issue_evidence import assert_evidence_access

    context, scopes = validate_fixed_feedback(values, project_id=project.id, task_id=task_id, reference=reference)
    if context is not None:
        assert_evidence_access(store, user, project, scopes)
    return context


def assert_execution_feedback_access(db, project, user, entry, *, store=None):
    """Launch reads the accepted H original, never a new version of its S."""
    if entry.get("feedback_reference") is None:
        if entry.get("feedback_context_sha256") is not None or entry.get("feedback_runtime_scopes"):
            fail("feedback_context_invalid", "The execution feedback locator is incomplete.")
        return
    if "feedback_runtime_scopes" not in entry:
        fail("feedback_context_invalid", "The execution feedback permission scope is missing.")
    from .delivery_execution_handoff import _validate_original
    from .delivery_execution_handoff_model import DeliveryExecutionHandoff as Handoff

    predicate = (*scope(project, Handoff), Handoff.id == entry.get("handoff_id"),
        Handoff.execution_id == entry["id"], Handoff.task_id == entry["task_id"])
    size = db.scalar(select(_bytes(db, Handoff.original)).where(*predicate))
    if size is None:
        fail("feedback_context_invalid", "The accepted execution feedback original is unavailable.")
    if size > 4 * 1024 * 1024:
        fail("feedback_source_budget", "The accepted feedback execution original exceeds its bounded read budget.", 413)
    row = db.scalar(select(Handoff).where(*predicate))
    _validate_original(row)
    if (row.original.get("feedback_reference") != entry["feedback_reference"]
            or row.original.get("feedback_context_sha256") != entry.get("feedback_context_sha256")
            or row.original.get("feedback_runtime_scopes") != entry.get("feedback_runtime_scopes")):
        fail("feedback_context_invalid", "The accepted feedback original and execution locator differ.")
    assert_fixed_feedback_access(project, user, row.original, task_id=entry["task_id"],
        reference=entry["feedback_reference"], store=store)


def freeze_feedback(db, project, user, task_id, reference, *, store=None):
    """New admission may select invalidated history; it must retain exact originals."""
    if reference is None:
        return {}
    from .delivery_issue_evidence import assert_evidence_access
    from .delivery_task_submission_model import DeliveryTaskSubmission as Submission, DeliveryTaskSubmissionDecision as Decision
    from .delivery_task_submission_service import _actor, _assert_original, submission_runtime_scopes
    from .sql_models import DeliveryTaskReview

    actor, _permissions = _actor(db, project, user)
    selected = FeedbackReference.model_validate(reference).model_dump(mode="json")
    predicate = (*scope(project, Submission), Submission.task_id == task_id, Submission.id == selected["submission_id"])
    fields = (Submission.payload, Submission.original, Submission.definition, Submission.native_boundary)
    sizes = db.execute(select(*(_bytes(db, field) for field in fields)).where(*predicate)).first()
    if sizes is None:
        fail("feedback_reference_missing", "The selected feedback report is unavailable for this project and task.", 404)
    if any((size or 0) > 1024 * 1024 for size in sizes) or sum(size or 0 for size in sizes) > 4 * 1024 * 1024:
        fail("feedback_source_budget", "The complete selected feedback original exceeds its bounded read budget.", 413)
    row = db.scalar(select(Submission).where(*predicate))
    try:
        _assert_original(row)
    except (KeyError, TypeError, ValueError, UnicodeError, RecursionError):
        fail("feedback_original_invalid", "The complete selected feedback original cannot be verified.")
    if row.submission_digest != selected["submission_digest"]:
        fail()
    decision_predicate = (*scope(project, Decision), Decision.id == selected["decision_id"], Decision.task_id == task_id, Decision.submission_id == row.id)
    decision_size = db.scalar(select(_bytes(db, Decision.comment)).where(*decision_predicate))
    if decision_size is not None and decision_size > 16 * 1024:
        fail("feedback_source_budget", "The complete feedback decision exceeds its bounded read budget.", 413)
    decision = db.scalar(select(Decision).where(*decision_predicate))
    if (decision is None or decision.submission_digest != row.submission_digest or decision.decision != "request_changes"):
        fail()
    columns = (DeliveryTaskReview.id, DeliveryTaskReview.task_id, DeliveryTaskReview.decision, DeliveryTaskReview.comment,
        DeliveryTaskReview.reviewer_id, DeliveryTaskReview.reviewer_name, DeliveryTaskReview.evidence_content)
    review_sizes = db.execute(select(_bytes(db, DeliveryTaskReview.comment), _bytes(db, DeliveryTaskReview.evidence_content)).where(
        *scope(project, DeliveryTaskReview), DeliveryTaskReview.id == decision.review_id)).first()
    if review_sizes and sum(size or 0 for size in review_sizes) > 32 * 1024:
        fail("feedback_source_budget", "The complete feedback review exceeds its bounded read budget.", 413)
    review = db.execute(select(*columns).where(*scope(project, DeliveryTaskReview), DeliveryTaskReview.id == decision.review_id)).first()
    if (review is None or review.task_id != task_id or review.decision != "request_changes"
            or review.comment != decision.comment or review.reviewer_id != decision.reviewer_id or review.reviewer_name != decision.reviewer_name
            or review.evidence_content != f"External report {row.id}; original digest {row.submission_digest}.\n{row.payload['summary']}"):
        fail("feedback_original_invalid", "The selected returned report and original human review cannot be verified.")
    scopes = sorted(set(submission_runtime_scopes(db, project, row.id)))
    assert_evidence_access(store, actor, project, scopes)
    context = {"schema": "manager.delivery-feedback.v1", "project_id": project.id, "task_id": task_id,
        "reference": selected, "submission": {"definition": deepcopy(row.definition), "payload": deepcopy(row.payload)},
        "decision": {"decision": "request_changes", "review_id": decision.review_id, "comment": decision.comment,
            "reviewer": {"id": decision.reviewer_id, "name": decision.reviewer_name},
            "created_at": decision.created_at.isoformat() + "Z", "issue_id": decision.issue_id}}
    try:
        encoded = json.dumps(context, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        fail("feedback_context_invalid", "The fixed feedback must be complete strict finite UTF-8 JSON.")
    if len(encoded) > MAX_FEEDBACK_CONTEXT_BYTES:
        fail("feedback_context_budget", "The complete selected feedback exceeds 64 KiB; no content was truncated.", 413)
    result = {"feedback_context": context, "feedback_context_sha256": hashlib.sha256(encoded).hexdigest(), "feedback_runtime_scopes": scopes}
    validate_fixed_feedback(result, project_id=project.id, task_id=task_id, reference=selected)
    return result
