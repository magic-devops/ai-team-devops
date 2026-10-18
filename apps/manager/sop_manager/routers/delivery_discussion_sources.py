"""Server-frozen local references and atomic adoption provenance, without evaluation."""

from copy import deepcopy
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select

from . import sql_models as m
from .delivery_discussion_common import authorize, digest, entity, fail, identifier, scope, thread, version
from .delivery_execution_runtime_safety import safe_text


def assert_runtime_scopes(store, user, project, scopes):
    """Authorize exact original workspace rows; never enumerate a runtime roster."""
    from hermes_core.models import CoreError, Principal

    if not scopes:
        return
    if user.status != "active" or user.tenant_id != project.tenant_id:
        raise HTTPException(403, "Current account cannot read runtime evidence")
    if store is None:
        raise HTTPException(503, "Execution runtime is not configured")
    principal = Principal(
        str(user.id), tenant=project.tenant_id, business="team", permissions=frozenset({"read"})
    )
    for workspace in sorted(set(scopes)):
        try:
            row = store.get(principal, "", "workspaces", workspace)
        except CoreError as exc:
            raise HTTPException(exc.status, "Runtime evidence workspace is unavailable") from exc
        data = row.get("data") or {}
        if (
            user.role != "super_admin"
            and str(user.id) != str(data.get("owner", ""))
            and str(user.id) not in data.get("members", [])
        ):
            raise HTTPException(403, "Runtime workspace membership required")
    return principal


def canonical_basis(row, kind):
    value = {"kind": kind, "id": row.id, "title": row.title, "description": row.description or ""}
    if kind != "issue":
        value["acceptance_criteria"] = row.acceptance_criteria or []
    return digest(value)


def resolve_reference(db, project, user, selection, *, store=None, check_basis=True):
    value = selection.model_dump() if hasattr(selection, "model_dump") else dict(selection)
    kind, entity_id, field = value["kind"], value["id"], value["field"]
    if kind != "execution":
        row = entity(db, project, kind, entity_id)
        if (
            field not in {"title", "description", "acceptance_criteria"}
            or kind == "issue"
            and field == "acceptance_criteria"
        ):
            fail("discussion_reference_invalid", "Invalid canonical field", 422)
        index = value.get("criterion_index")
        if field == "acceptance_criteria":
            criteria = row.acceptance_criteria or []
            if type(index) is not int or not 0 <= index < len(criteria):
                fail("discussion_reference_invalid", "Acceptance criterion not found", 422)
            text = criteria[index]
        else:
            if index is not None:
                fail("discussion_reference_invalid", "Only acceptance references have an index", 422)
            text = getattr(row, field) or ""
        basis = canonical_basis(row, kind)
        result = {
            "kind": kind,
            "id": entity_id,
            "field": field,
            "criterion_index": index,
            "source_content_basis": basis,
            "text": safe_text(text, 8000)[0],
            "status": "available",
            "_runtime_scopes": [],
        }
    else:
        if field != "summary" or value.get("criterion_index") is not None:
            fail("discussion_reference_invalid", "Execution references use summary", 422)
        from .delivery_query_read import _stamp, _unchanged, workspace_path

        stamp = _stamp(db, project)
        data = db.scalar(
            select(m.DeliveryQueryFact.data).where(
                *scope(project, m.DeliveryQueryFact),
                m.DeliveryQueryFact.kind == "execution",
                m.DeliveryQueryFact.entity_id == entity_id,
            )
        )
        if data is None:
            raise HTTPException(404, "Execution not found in this project")
        entry = workspace_path(db, project, "executions", data["position"])
        if not entry or entry.get("id") != entity_id:
            fail("discussion_source_changed", "Execution reference changed; select it again")
        workspace, run_id = entry.get("workspace_id"), entry.get("run_id")
        principal = assert_runtime_scopes(store, user, project, [workspace])
        from hermes_core.models import CoreError

        try:
            run = store.get(principal, workspace, "runs", run_id)
        except CoreError as exc:
            raise HTTPException(exc.status, "Execution run is unavailable") from exc
        run_data = run.get("data") or {}
        attempt = run_data.get("attempt", 1)
        attempt = attempt if type(attempt) is int and attempt >= 1 else 1
        executor = (entry.get("snapshot") or {}).get("executor") or {}
        runtime = {
            "workspace_id": workspace,
            "run_id": run_id,
            "attempt": attempt,
            "executor_id": str(executor.get("id")) if executor.get("id") else None,
        }
        evidence = {"id": entity_id, "status": run.get("status"), "runtime": runtime}
        result = {
            "kind": kind,
            "id": entity_id,
            "field": "summary",
            "source_content_basis": digest(evidence),
            "text": safe_text(
                f"Execution {entity_id}: {run.get('status', '')}; run {run_id}; attempt {attempt}", 2000
            )[0],
            "status": "available",
            "runtime": runtime,
            "_runtime_scopes": [workspace],
        }
        _unchanged(db, project, stamp)
    if check_basis and value.get("source_content_basis") != result["source_content_basis"]:
        fail("discussion_source_changed", "Selected source content changed; select it again")
    return result


def reference_scopes(refs):
    return sorted({workspace for ref in refs for workspace in ref.get("_runtime_scopes", [])})


def public_refs(refs, store, user, project):
    result = []
    for ref in refs:
        try:
            assert_runtime_scopes(store, user, project, ref.get("_runtime_scopes", []))
        except HTTPException:
            result.append({"kind": ref["kind"], "id": ref["id"], "status": "unavailable"})
        else:
            result.append({key: deepcopy(value) for key, value in ref.items() if key != "_runtime_scopes"})
    return result


@dataclass(frozen=True)
class ValidatedDiscussionSource:
    tenant_id: str
    project_id: str
    source_id: str
    thread_id: str
    thread_version: int
    source_snapshot: dict
    source_digest: str
    runtime_scopes: tuple[str, ...]


def validate_source_reference(db, project, user, reference, *, store=None):
    _, user, _ = authorize(db, user, project.id)
    value = reference.model_dump() if hasattr(reference, "model_dump") else dict(reference)
    current = thread(db, project, value["thread_id"], lock=True)
    if (
        current.version != value["expected_thread_version"]
        or current.state != "resolved"
        or current.current_resolution_event_id != value["resolution_event_id"]
    ):
        fail("discussion_source_changed", "Discussion resolution changed; review the current conclusion")
    entity(db, project, current.subject_kind, current.subject_id)
    event = db.scalar(
        select(m.DeliveryDiscussionEvent).where(
            *scope(project, m.DeliveryDiscussionEvent),
            m.DeliveryDiscussionEvent.thread_id == current.id,
            m.DeliveryDiscussionEvent.id == current.current_resolution_event_id,
        )
    )
    if (
        event is None
        or event.action != "resolve"
        or event.data.get("message_id") != value["message_id"]
        or event.data.get("message_revision") != value["message_revision"]
    ):
        fail("discussion_source_changed", "Selected conclusion is not the current resolution")
    selected = version(db, project, current.id, value["message_id"], value["message_revision"])
    if selected.state != "active":
        fail("discussion_source_changed", "Selected conclusion is withdrawn")
    scopes = reference_scopes(selected.refs)
    assert_runtime_scopes(store, user, project, scopes)
    snapshot = {
        "thread": {
            "id": current.id,
            "title": current.title,
            "version": current.version,
            "subject": {"kind": current.subject_kind, "id": current.subject_id},
        },
        "resolution": {
            "event_id": event.id,
            "message_id": selected.message_id,
            "message_revision": selected.revision,
            "note": event.data.get("note", ""),
        },
        "message": {
            "id": selected.message_id,
            "revision": selected.revision,
            "body": selected.body,
            "author": {"id": event.data["message_author_id"], "name": event.data["message_author_name"]},
            "refs": deepcopy(selected.refs),
        },
    }
    return ValidatedDiscussionSource(
        project.tenant_id,
        project.id,
        event.id,
        current.id,
        current.version,
        snapshot,
        digest(snapshot),
        tuple(scopes),
    )


def record_adoption_links(
    db, project, user, source, targets, *, business_event_id=None, applied_fields=None, relation="adopted"
):
    if (
        not isinstance(source, ValidatedDiscussionSource)
        or (source.tenant_id, source.project_id) != (project.tenant_id, project.id)
        or source.source_digest != digest(source.source_snapshot)
    ):
        fail("discussion_source_changed", "Unverified discussion source")
    if relation not in {"reference", "adopted"}:
        raise ValueError("Invalid source relation")
    db.flush()
    ids = []
    for target in targets:
        entity(db, project, target["kind"], target["id"])
        link_id = identifier()
        db.add(
            m.DeliverySourceLink(
                id=link_id,
                tenant_id=project.tenant_id,
                project_id=project.id,
                source_kind="discussion_resolution",
                source_id=source.source_id,
                thread_id=source.thread_id,
                thread_version=source.thread_version,
                source_snapshot=deepcopy(source.source_snapshot),
                source_digest=source.source_digest,
                runtime_scopes=list(source.runtime_scopes),
                target_kind=target["kind"],
                target_id=target["id"],
                business_event_id=business_event_id,
                applied_fields=list(applied_fields or []),
                applied_by_id=user.id,
                applied_by_name=user.username,
                relation=relation,
            )
        )
        ids.append(link_id)
    return ids


def public_link(db, project, user, row, *, store=None):
    snapshot = deepcopy(row.source_snapshot)
    snapshot["message"]["refs"] = public_refs(snapshot["message"]["refs"], store, user, project)
    current = thread(db, project, row.thread_id)
    target = entity(db, project, row.target_kind, row.target_id, required=False)
    resolution = snapshot["resolution"]
    return {
        "id": row.id,
        "relation": row.relation,
        "source_kind": row.source_kind,
        "source_id": row.source_id,
        "thread_id": row.thread_id,
        "thread_version": row.thread_version,
        "resolution_event_id": resolution["event_id"],
        "message_id": resolution["message_id"],
        "message_revision": resolution["message_revision"],
        "source_snapshot": snapshot,
        "source_digest": row.source_digest,
        "target_kind": row.target_kind,
        "target_id": row.target_id,
        "target_missing": target is None,
        "target_title": target.title if target else None,
        "business_event_id": row.business_event_id,
        "applied_fields": row.applied_fields,
        "applied_by": {"id": row.applied_by_id, "name": row.applied_by_name},
        "created_at": row.created_at.isoformat() + "Z",
        "source_changed": current.version != row.thread_version
        or current.state != "resolved"
        or current.current_resolution_event_id != row.source_id,
    }
