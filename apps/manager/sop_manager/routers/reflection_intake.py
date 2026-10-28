"""Server-frozen reference identities and one successful event collection fact."""

import json
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import object_session

from sop_manager.project_write_guard import reflection_record_write_scope

from . import sql_models as m
from .delivery_discussion_sources import assert_runtime_scopes
from .event_common import date, fail, parse, scope
from .reflection_contract import ReflectionData, ReflectionReference

EVENT_TYPE = "sop.reflection.recorded"


def recorded_receipts(db, project, ids):
    """Corroborate only bounded receipt IDs; never scan or load original bodies."""
    if not ids:
        return set()
    return set(db.scalars(select(m.ReflectionRecord.receipt_id).where(
        *scope(project, m.ReflectionRecord), m.ReflectionRecord.receipt_id.in_(ids),
    )))


def is_reflection(original, processing, *, recorded=False, metadata_only=False):
    """Any reflection metadata keeps the original behind the same fail-closed gate."""
    # Generic directories deliberately defer plans as well as original bodies.
    # Their current type/handler/effect and bounded collection IDs protect
    # canonical receipts without materializing arbitrary plans.
    plan = None if metadata_only else getattr(processing, "plan", None)
    result = getattr(processing, "result", None)
    return (original.event_type == EVENT_TYPE or recorded
            or getattr(processing, "handler", None) == "reflection.record"
            or isinstance(plan, dict) and "reflection_visibility" in plan
            or isinstance(result, dict) and (result.get("kind") == "reflection_recorded" or result.get("target_kind") == "reflection"))


def typed(event):
    try:
        if event.type != EVENT_TYPE or event.subject:
            raise ValueError("Reflection event type or subject is invalid")
        return ReflectionData.model_validate(event.data)
    except (ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(422, {"code": "reflection_input_invalid", "message": "Invalid typed reflection"}) from exc


def resolve_reference(db, project, user, ref, store):
    """Read only an exact task or indexed exact execution JSON path."""
    kind, rid = ref["kind"], ref["id"]
    if kind == "task":
        row = db.execute(select(m.Task.id, m.Task.title).where(*scope(project, m.Task), m.Task.id == rid)).first()
        if row is None:
            fail("reflection_reference_missing", "Referenced task is unavailable in this project", 404)
        return {"kind": kind, "id": rid}, row.title
    from hermes_core.models import CoreError

    from .delivery_query_read import _stamp, _unchanged, workspace_path

    stamp = _stamp(db, project, required=False)
    if stamp is None:
        fail("reflection_reference_index_unavailable", "Execution reference index is unavailable", 503)
    fact = db.scalar(select(m.DeliveryQueryFact.data).where(
        *scope(project, m.DeliveryQueryFact), m.DeliveryQueryFact.kind == "execution", m.DeliveryQueryFact.entity_id == rid,
    ))
    if fact is None:
        fail("reflection_reference_missing", "Referenced execution is unavailable in this project", 404)
    entry = workspace_path(db, project, "executions", fact["position"])
    if not isinstance(entry, dict) or entry.get("id") != rid:
        fail("reflection_reference_changed", "Execution reference identity changed")
    workspace, run_id = entry.get("workspace_id"), entry.get("run_id")
    if not isinstance(workspace, str) or not workspace or not isinstance(run_id, str) or not run_id:
        fail("reflection_reference_changed", "Execution has no exact runtime binding")
    principal = assert_runtime_scopes(store, user, project, [workspace])
    try:
        store.get(principal, workspace, "runs", run_id)
    except CoreError as exc:
        raise HTTPException(exc.status, {"code": "reflection_runtime_unavailable", "message": "Execution run is unavailable"}) from exc
    _unchanged(db, project, stamp)
    return {"kind": kind, "id": rid, "workspace_id": workspace, "run_id": run_id}, rid


def plan_intake(db, project, user, item, event, store):
    data = typed(event)
    refs = [resolve_reference(db, project, user, r.model_dump(), store)[0] for r in data.references]
    return {"reflection_visibility": {"version": 1, "digest": item.digest, "references": refs,
            "runtime_scopes": sorted({r["workspace_id"] for r in refs if r["kind"] == "execution"})}}


def frozen_plan(plan, source_digest):
    """Fail closed for unknown, absent, oversized or malformed visibility plans."""
    try:
        if not isinstance(plan, dict) or set(plan) != {"reflection_visibility"}:
            raise ValueError()
        value = plan["reflection_visibility"]
        if (not isinstance(value, dict) or set(value) != {"version", "digest", "references", "runtime_scopes"}
                or type(value["version"]) is not int or value["version"] != 1 or value["digest"] != source_digest):
            raise ValueError()
        refs = value["references"]
        if not isinstance(refs, list) or len(refs) > 8:
            raise ValueError()
        seen = set()
        for ref in refs:
            if not isinstance(ref, dict):
                raise ValueError()
            basic = ReflectionReference.model_validate({k: ref[k] for k in ("kind", "id")})
            keys = {"kind", "id"} if basic.kind == "task" else {"kind", "id", "workspace_id", "run_id"}
            if set(ref) != keys or (basic.kind, basic.id) in seen:
                raise ValueError()
            seen.add((basic.kind, basic.id))
            if basic.kind == "execution" and any(not isinstance(ref[k], str) or not ref[k] or len(ref[k]) > 200 for k in ("workspace_id", "run_id")):
                raise ValueError()
        scopes = sorted({ref["workspace_id"] for ref in refs if ref["kind"] == "execution"})
        if value["runtime_scopes"] != scopes:
            raise ValueError()
        return value
    except (KeyError, ValueError, TypeError, ValidationError):
        return None


def visibility(original, processing, project, user, store, memo=None, *, recorded=False):
    if not is_reflection(original, processing, recorded=recorded):
        return None
    if original.event_type != EVENT_TYPE:
        return "reflection_original_changed"
    plan = frozen_plan(processing.plan if processing and processing.handler == "reflection.record" else None, original.digest)
    if plan is None:
        return "reflection_visibility_unavailable"
    for workspace in plan["runtime_scopes"]:
        key = (str(user.id), workspace)
        if memo is not None and key in memo:
            reason = memo[key]
        else:
            try:
                assert_runtime_scopes(store, user, project, [workspace])
                reason = None
            except HTTPException as exc:
                reason = "reflection_source_restricted" if exc.status_code == 403 else "reflection_runtime_unavailable"
            if memo is not None:
                memo[key] = reason
        if reason:
            return reason
    return None


def require_visible(original, processing, project, user, store):
    db = object_session(original)
    recorded = original.id in recorded_receipts(db, project, [original.id])
    if not is_reflection(original, processing, recorded=recorded):
        return
    if visibility(original, processing, project, user, store, recorded=recorded):
        fail("reflection_source_restricted", "The reflection original is not currently readable", 403)
    from .reflection_query import exact, selected_source_bytes

    try:
        if processing.state == "processed":
            if not exact(db, project, user, original.id, store=store, include_raw=False)["available"]:
                fail("reflection_original_changed", "The successful reflection original cannot be verified")
        else:
            selected_source_bytes(db, project, [original.id])
            original_data(original, processing, project)
    except (HTTPException, ValueError, TypeError, KeyError) as exc:
        raise HTTPException(403, {"code": "reflection_source_restricted", "message": "The reflection original visibility cannot be verified"}) from exc


def original_data(original, row, project):
    event = parse(SimpleNamespace(id=original.event_id, event_json=original.event_json, digest=original.digest), project)
    data = typed(event)
    plan = frozen_plan(row.plan if row and row.handler == "reflection.record" else None, original.digest)
    if (plan is None or event.type != original.event_type or event.subject != original.subject
            or event.source != original.source or event.time != original.event_time
            or [{"kind": r["kind"], "id": r["id"]} for r in plan["references"]] != [r.model_dump() for r in data.references]):
        fail("reflection_original_changed", "The original and frozen server identity disagree")
    return event, data, plan


def prepare_processing(db, project, producer, original, row, store):
    # Authorize and measure bytes before loading the original. Authorization
    # follows the original workspace, before inspecting a later binding.
    require_visible(original, row, project, producer, store)
    event, data, plan = original_data(original, row, project)
    current = [resolve_reference(db, project, producer, ref, store)[0] for ref in plan["references"]]
    if current != plan["references"]:
        fail("reflection_reference_changed", "An original reference runtime binding changed")
    return event, data, plan


def append_record(db, project, original, entry, prepared):
    event, data, plan = prepared
    if entry.to_state != "processed" or entry.result != {"kind": "reflection_recorded", "target_kind": "reflection", "target_id": original.id}:
        fail("reflection_success_required", "Collection requires its actual successful processing attempt")
    with reflection_record_write_scope(db, project.tenant_id, project.id, original.id, entry.id):
        db.add(m.ReflectionRecord(
            id=original.id, tenant_id=project.tenant_id, project_id=project.id, receipt_id=original.id,
            attempt_id=entry.id, producer_id=original.producer_id, digest=original.digest, category=data.category,
            occurred_at=datetime.fromisoformat(event.time.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None),
            collected_at=entry.created_at, references=plan["references"], runtime_scopes=plan["runtime_scopes"],
        ))
        db.flush()


def current_links(db, project, user, plan, store):
    links = []
    for ref in plan["references"]:
        reason, label = None, None
        try:
            current, label = resolve_reference(db, project, user, ref, store)
            if current != ref:
                reason = "reflection_reference_changed"
        except HTTPException as exc:
            reason = exc.detail.get("code", "reflection_reference_unavailable") if isinstance(exc.detail, dict) else "reflection_reference_unavailable"
        links.append({"kind": ref["kind"], "id": ref["id"], "label": label if reason is None else None,
                      "available": reason is None, "reason": reason})
    return links
