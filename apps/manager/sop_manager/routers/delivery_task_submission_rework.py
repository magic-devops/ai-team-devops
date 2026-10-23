"""Explicit historical report reuse with fresh acceptance and fixed provenance."""
from copy import deepcopy
import json

from fastapi import HTTPException
from hermes_core.transactional import digest
from sqlalchemy import select

from .delivery_feedback_contract import FeedbackReference
from .delivery_feedback_service import _scopes, freeze_feedback, validate_fixed_feedback
from .delivery_task_submission_contract import SubmissionRework, SubmissionReworkDraft
from .delivery_task_submission_service import _fail

MAX_REWORK_PREVIEW_BYTES = 256 * 1024


def seed(feedback_context, criteria):
    """Only authorized material is reused; results and authorship are new input."""
    source = feedback_context["submission"]["payload"]
    value = {"source": None, "summary": source["summary"], "artifacts": deepcopy(source["artifacts"]),
        "criteria": [{"source": item["source"], "index": item["index"], "text_digest": item["text_digest"],
            "result": "unknown", "evidence_ids": []} for item in sorted(criteria, key=lambda item: (item["source"], item["index"]))],
        "tests": [{"id": item["id"], "title": item["title"], "status": "not_run", "evidence_ids": []}
            for item in source["tests"]]}
    return SubmissionReworkDraft.model_validate(value).model_dump(mode="json")


def _basis(project_id, task_id, current, selected, feedback, draft):
    return digest({"schema": "manager.submission-rework-basis.v1", "project_id": project_id, "task_id": task_id,
        "reference": selected, "feedback_context_sha256": feedback["feedback_context_sha256"],
        "feedback_runtime_scopes": feedback["feedback_runtime_scopes"],
        **{key: current[key] for key in ("task_basis", "definition_digest", "native_boundary_digest")},
        "target_work_order": current["work_order"], "draft": draft})


def prepare_rework(db, project, user, task_id, reference, current, *, store=None):
    selected = FeedbackReference.model_validate(reference).model_dump(mode="json")
    feedback = freeze_feedback(db, project, user, task_id, selected, store=store)
    target = current["work_order"]
    if target is not None:
        from .delivery_external_work_order_model import DeliveryExternalWorkOrder as Order
        from .delivery_external_work_order_service import byte_size
        from .delivery_issue_evidence import assert_evidence_access

        predicate = (Order.tenant_id == project.tenant_id, Order.project_id == project.id,
            Order.task_id == task_id, Order.id == target["id"], Order.revision == target["order_revision"])
        size = db.scalar(select(byte_size(db, Order.runtime_scopes)).where(*predicate))
        if size is None:
            _fail("submission_rework_basis_changed", "The current target work-order revision changed; adopt a new preview.")
        if size > 1024 * 1024:
            _fail("submission_rework_preview_budget", "The complete target work-order permission scope exceeds its read budget.", 413)
        scopes = _scopes(db.scalar(select(Order.runtime_scopes).where(*predicate)))
        assert_evidence_access(store, user, project, scopes)
        feedback["feedback_runtime_scopes"] = _scopes(sorted(set(feedback["feedback_runtime_scopes"] + scopes)))
    draft = seed(feedback["feedback_context"], current["criteria"])
    basis = _basis(project.id, task_id, current, selected, feedback, draft)
    fixed = {"schema": "manager.submission-rework.v1", "reference": selected, "basis": basis,
        **feedback, "target_work_order": deepcopy(current["work_order"])}
    return fixed, draft


def rework_preview(db, project, user, task_id, reference, *, store=None, execution=None):
    from .delivery_query_read import _stamp, _unchanged
    from .delivery_task_submission_query import submission_current

    with db.no_autoflush:
        generation = _stamp(db, project)
        current = submission_current(db, project, user, task_id, store=store, execution=execution)
        fixed, draft = prepare_rework(db, project, user, task_id, reference, current, store=store)
        result = {**{key: current[key] for key in ("project_id", "task_id", "version", "query_generation", "as_of")},
            "rework_reference": fixed["reference"], "rework_basis": fixed["basis"], "current": current,
            "feedback_context": fixed["feedback_context"], "feedback_context_sha256": fixed["feedback_context_sha256"],
            "draft": draft, "allowed": current["can_submit"], "reasons": deepcopy(current["reasons"])}
        try:
            encoded = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
        except (ValueError, TypeError, UnicodeError, RecursionError):
            _fail("submission_rework_original_invalid", "The complete rework preview cannot be encoded as strict finite UTF-8 JSON.")
        if len(encoded) > MAX_REWORK_PREVIEW_BYTES:
            _fail("submission_rework_preview_budget", "The complete rework preview exceeds 256 KiB; no content was truncated.", 413)
        _unchanged(db, project, generation)
        return result


def validate_rework_original(row):
    """Self-contained integrity check, without fetching a later historical head."""
    payload = row.payload
    selected = payload.get("rework_reference")
    if selected is None:
        if "rework" in row.original or "rework_reference" in payload or "rework_basis" in payload:
            _fail("submission_rework_original_invalid", "An ordinary original cannot acquire inferred rework provenance.")
        return
    fixed = row.original.get("rework")
    try:
        fixed = SubmissionRework.model_validate(fixed).model_dump(mode="json")
        context, scopes = validate_fixed_feedback(fixed, project_id=row.project_id, task_id=row.task_id, reference=selected)
        if (fixed["reference"] != selected or fixed["basis"] != payload.get("rework_basis")
                or fixed["feedback_runtime_scopes"] != scopes or context is None):
            raise ValueError("The fixed origin and selected payload differ")
        current = {**{key: payload[key] for key in ("task_basis", "definition_digest", "native_boundary_digest")},
            "work_order": fixed["target_work_order"]}
        if _basis(row.project_id, row.task_id, current, selected, fixed, seed(context, payload["criteria"])) != fixed["basis"]:
            raise ValueError("The fixed rework basis differs")
        binding = payload.get("work_order")
        if binding is not None and (fixed["target_work_order"] is None
                or any(binding[key] != fixed["target_work_order"][key] for key in ("id", "order_revision"))):
            raise ValueError("The explicit report binding differs from the fixed target")
    except (HTTPException, ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        _fail("submission_rework_original_invalid", "The complete fixed rework origin and report cannot be verified.")


def fixed_lineage_scopes(reference, basis, locator, *, present=False):
    """Thin bounded locator check for pages, receipts and events; no recursion."""
    if not present and reference is None and basis is None and all(value is None for value in locator.values()):
        return []
    try:
        selected = FeedbackReference.model_validate(reference).model_dump(mode="json")
        if (not isinstance(basis, str) or len(basis) != 64 or any(char not in "0123456789abcdef" for char in basis)
                or locator["schema"] != "manager.submission-rework.v1" or locator["reference"] != selected
                or locator["basis"] != basis or not isinstance(locator["feedback_context_sha256"], str)
                or len(locator["feedback_context_sha256"]) != 64
                or any(char not in "0123456789abcdef" for char in locator["feedback_context_sha256"])):
            raise ValueError("The lineage locator is incomplete")
        scopes = _scopes(locator["feedback_runtime_scopes"])
        if scopes != locator["feedback_runtime_scopes"]:
            raise ValueError("The fixed lineage scope is not canonical")
        return scopes
    except (HTTPException, TypeError, ValueError, KeyError):
        _fail("submission_rework_original_invalid", "The fixed rework permission source cannot be verified.")
