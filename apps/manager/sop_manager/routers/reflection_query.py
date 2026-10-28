"""Fixed SQL metadata windows and exact original integrity checks, without writes."""

from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import LargeBinary, cast, func, select
from sqlalchemy.orm import defer, load_only

from . import sql_models as m
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_discussion_sources import assert_runtime_scopes
from .event_common import date, fail, now, scope
from .reflection_intake import current_links, frozen_plan, original_data, visibility


def permissions(project, access):
    writable = access["write"] and project.status != "archived"
    return {"read": True, "collect": writable, "prepare": writable}


def window(db, project, user, model, filters, limit, cursor, kind):
    signature = ["reflection-window-v1", kind, project.tenant_id, project.id, user.id, filters, limit]
    if cursor:
        upper, after = decode_cursor(cursor, signature)
        if (len(upper) != 2 or type(upper[0]) is not int or upper[0] < 0 or not isinstance(upper[1], str)
                or len(after) != 1 or type(after[0]) is not int or not 0 < after[0] <= upper[0]):
            fail("reflection_cursor_invalid", "Invalid reflection window cursor", 422)
        try:
            datetime.fromisoformat(upper[1].replace("Z", "+00:00"))
        except ValueError:
            fail("reflection_cursor_invalid", "Invalid reflection window timestamp", 422)
    else:
        upper = [db.scalar(select(func.max(model.seq)).where(*scope(project, model))) or 0, date(now())]
        after = [upper[0] + 1]
    return signature, upper, after[0]


def page(project, access, rows, total, limit, signature, upper, summary):
    more = len(rows) > limit
    visible = rows[:limit]
    return {"project_id": project.id, "as_of": upper[1], "items": [summary(row) for row in visible],
            "total": total, "limit": limit, "has_more": more,
            "next_cursor": encode_cursor(signature, upper, [visible[-1].seq]) if more else None,
            "permissions": permissions(project, access)}


def record_summary(db, row, status="not_loaded", reason=None):
    name = db.scalar(select(m.User.username).where(m.User.id == row.producer_id, m.User.tenant_id == row.tenant_id))
    return {"id": row.id, "category": row.category, "occurred_at": date(row.occurred_at),
            "collected_at": date(row.collected_at), "producer": {"id": row.producer_id, "name": name},
            "reference_count": len(row.references), "intake_status": "collected", "original_status": status,
            "unavailable_reason": reason}


def list_records(db, project, user, access, *, category, occurred_from, occurred_to, limit, cursor, store):
    filters = [category, date(occurred_from), date(occurred_to)]
    signature, upper, after = window(db, project, user, m.ReflectionRecord, filters, limit, cursor, "records")
    predicates = [*scope(project, m.ReflectionRecord), m.ReflectionRecord.seq <= upper[0]]
    if category:
        predicates.append(m.ReflectionRecord.category == category)
    if occurred_from:
        predicates.append(m.ReflectionRecord.occurred_at >= occurred_from)
    if occurred_to:
        predicates.append(m.ReflectionRecord.occurred_at < occurred_to)
    total = db.scalar(select(func.count()).select_from(m.ReflectionRecord).where(*predicates))
    rows = db.scalars(select(m.ReflectionRecord).where(*predicates, m.ReflectionRecord.seq < after)
                      .order_by(m.ReflectionRecord.seq.desc()).limit(limit + 1)).all()
    # Directory verifies only frozen plans/scopes on this bounded page. It never
    # reads body bytes or claims the original remains intact.
    ids = [row.id for row in rows[:limit]]
    plans = {r.id: r for r in db.execute(select(m.EventProcessing.id, m.EventProcessing.handler, m.EventProcessing.plan)
                                       .where(*scope(project, m.EventProcessing), m.EventProcessing.id.in_(ids))).all()}
    memo = {}

    def summary(row):
        original = SimpleNamespace(event_type="sop.reflection.recorded", digest=row.digest)
        pointer = plans.get(row.id)
        plan = frozen_plan(pointer.plan if pointer and pointer.handler == "reflection.record" else None, row.digest)
        reason = ("reflection_visibility_unavailable" if plan is None or plan["references"] != row.references or plan["runtime_scopes"] != row.runtime_scopes
                  else visibility(original, pointer, project, user, store, memo))
        status = "restricted" if reason == "reflection_source_restricted" else "unavailable" if reason else "not_loaded"
        return record_summary(db, row, status, reason)

    return page(project, access, rows, total, limit, signature, upper, summary)


def selected_source_bytes(db, project, ids):
    expression = (func.length(cast(m.EventInbox.event_json, LargeBinary))
                  if db.get_bind().dialect.name == "sqlite" else func.octet_length(m.EventInbox.event_json))
    sizes = dict(db.execute(select(m.EventInbox.id, expression).where(*scope(project, m.EventInbox), m.EventInbox.id.in_(ids))).all())
    if len(sizes) != len(ids):
        fail("reflection_original_missing", "A selected original is unavailable", 404)
    if any(type(value) is not int or value > 65536 for value in sizes.values()) or sum(sizes.values()) > 2097152:
        fail("reflection_selection_too_large", "Selected originals exceed the complete input byte budget", 413)


def exact(db, project, user, rid, *, store=None, include_raw=True):
    record = db.scalar(select(m.ReflectionRecord).where(*scope(project, m.ReflectionRecord), m.ReflectionRecord.id == rid))
    if record is None:
        fail("reflection_not_found", "Collected reflection not found in this project", 404)
    result = {"project_id": project.id, "as_of": date(now()), "reflection": record_summary(db, record),
              "available": False, "unavailable_reason": None, "statement": None, "source": None,
              "verified": None, "links": [], "selection_reference": None}
    original = db.scalar(select(m.EventInbox).options(defer(m.EventInbox.event_json)).where(*scope(project, m.EventInbox), m.EventInbox.id == record.receipt_id))
    processing = db.scalar(select(m.EventProcessing).where(*scope(project, m.EventProcessing), m.EventProcessing.id == record.receipt_id))
    reason = "reflection_original_missing" if original is None else visibility(original, processing, project, user, store, recorded=True)
    if reason is None:
        try:
            selected_source_bytes(db, project, [rid])
            event, data, plan = original_data(original, processing, project)
            attempt = db.scalar(select(m.EventProcessingAttempt).where(*scope(project, m.EventProcessingAttempt),
                                m.EventProcessingAttempt.id == record.attempt_id))
            expected = {"kind": "reflection_recorded", "target_kind": "reflection", "target_id": rid}
            occurred = datetime.fromisoformat(event.time.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
            if (record.id != record.receipt_id or record.digest != original.digest or record.producer_id != original.producer_id
                    or record.category != data.category or record.occurred_at != occurred
                    or record.references != plan["references"] or record.runtime_scopes != plan["runtime_scopes"]
                    or processing.state != "processed" or processing.result != expected
                    or attempt is None or attempt.receipt_id != rid or attempt.to_state != "processed"
                    or attempt.error is not None or attempt.result != expected or record.collected_at != attempt.created_at):
                fail("reflection_original_changed", "Collection identity and actual original attempt disagree")
        except HTTPException as exc:
            reason = exc.detail.get("code", "reflection_original_unavailable") if isinstance(exc.detail, dict) else "reflection_original_unavailable"
        except (ValueError, TypeError, KeyError):
            reason = "reflection_original_changed"
    if reason:
        status = "restricted" if reason == "reflection_source_restricted" else "unavailable"
        result["reflection"].update(original_status=status, unavailable_reason=reason)
        result["unavailable_reason"] = reason
        return result
    links = current_links(db, project, user, plan, store)
    result.update(available=True, links=links)
    result["reflection"]["original_status"] = "available"
    if include_raw:
        result["statement"] = {"category": data.category, "title": data.title, "observation": data.observation,
                               "lesson": data.lesson, "claimed_occurred_at": event.time}
        result["source"] = {"receipt_id": rid, "event_id": original.event_id, "digest": original.digest,
                            "producer_id": original.producer_id, "stored_at": date(original.stored_at), "event_json": original.event_json}
        result["verified"] = {"attempt_id": attempt.id, "handler": "reflection.record", "collected_at": date(attempt.created_at),
                              "identity_and_references_checked": True, "is_acceptance_evidence": False}
    if all(link["available"] for link in links):
        result["selection_reference"] = {"reflection_id": rid, "source_digest": original.digest, "attempt_id": attempt.id}
    return result


def input_summary(row, count):
    return {"id": row.id, "title": row.title, "status": "prepared", "source_count": count,
            "created_at": date(row.created_at), "created_by": {"id": row.created_by_id, "name": row.created_by_name},
            "source_version": row.source_version}


def source_count(sources, dialect_name):
    # The current sources column is JSON, including on PostgreSQL (not JSONB).
    length = func.json_array_length if dialect_name in {"sqlite", "postgresql"} else func.json_length
    return length(sources)


def list_inputs(db, project, user, access, *, limit, cursor):
    model = m.ReflectionInput
    signature, upper, after = window(db, project, user, model, [], limit, cursor, "inputs")
    predicates = [*scope(project, model), model.seq <= upper[0]]
    total = db.scalar(select(func.count()).select_from(model).where(*predicates))
    pairs = db.execute(select(model, source_count(model.sources, db.get_bind().dialect.name)).options(load_only(model.seq, model.id, model.title,
                        model.created_at, model.created_by_id, model.created_by_name, model.source_version))
                       .where(*predicates, model.seq < after).order_by(model.seq.desc()).limit(limit + 1)).all()
    counts = {row.id: count for row, count in pairs}
    return page(project, access, [row for row, _ in pairs], total, limit, signature, upper,
                lambda row: input_summary(row, counts[row.id]))


def input_detail(db, project, user, iid, *, store=None):
    from .reflection_commands import manifest_digest
    from .reflection_contract import ReflectionInputCreate

    row = db.scalar(select(m.ReflectionInput).where(*scope(project, m.ReflectionInput), m.ReflectionInput.id == iid))
    if row is None:
        fail("reflection_input_not_found", "Fixed input not found in this project", 404)
    # The manifest and rationale may disclose source identities. Its original
    # scopes authorize this content, independently from the tiny replay ACK.
    assert_runtime_scopes(store, user, project, row.runtime_scopes)
    try:
        value = ReflectionInputCreate.model_validate({"title": row.title, "rationale": row.rationale, "sources": row.sources})
        if row.manifest_digest != manifest_digest(row.sources):
            raise ValueError()
    except ValueError:
        fail("reflection_input_corrupt", "The saved fixed input is unavailable")
    sources = []
    for reference in value.sources:
        fixed = reference.model_dump()
        reason = None
        try:
            result = exact(db, project, user, reference.reflection_id, store=store, include_raw=False)
            if not result["available"]:
                reason = result["unavailable_reason"]
            elif result["selection_reference"] != fixed:
                reason = "reflection_source_changed"
        except HTTPException as exc:
            reason = exc.detail.get("code", "reflection_original_unavailable") if isinstance(exc.detail, dict) else "reflection_original_unavailable"
        sources.append({**fixed, "available": reason is None, "unavailable_reason": reason})
    return {"project_id": project.id, "as_of": date(now()), "input": input_summary(row, len(row.sources)),
            "rationale": row.rationale, "manifest_digest": row.manifest_digest, "sources": sources,
            "available": all(r["available"] for r in sources), "is_acceptance_evidence": False}
