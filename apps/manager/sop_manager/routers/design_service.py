"""Exact SQL design sources and one explicit adoption boundary for real delivery."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib

from fastapi import HTTPException
from hermes_core.transactional import digest
from sqlalchemy import LargeBinary, cast, func, or_, select

from .design_contract import COMMANDS, DesignReference, DocumentContent, RevisionMetadata, design_basis
from .design_model import ProjectDesignAdoption as Adoption, ProjectDesignDocument as Document, ProjectDesignRevision as Revision
from .delivery_query_index import scope


def fail(code, message, status=409):
    raise HTTPException(status, {"code": code, "message": message})


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def date(value):
    return value.isoformat() + "Z"


def access(db, project, user, *, write=False):
    from .delivery_task_submission_service import _actor

    return _actor(db, project, user, permission="write" if write else None)


def load_document(db, project, document_id, *, include_archived=True):
    row = db.scalar(select(Document).where(*scope(project, Document), Document.id == document_id).execution_options(populate_existing=True))
    if row is None:
        fail("design_document_missing", "Design document is unavailable in this project.", 404)
    if row.archived and not include_archived:
        fail("design_document_archived", "Restore the archived document before editing or adopting another revision.")
    return row


def load_revision(db, project, document_id, revision_id, *, digest=None):
    query = select(Revision).where(*scope(project, Revision), Revision.document_id == document_id, Revision.id == revision_id)
    sizes = db.execute(query.with_only_columns(func.length(cast(Revision.content, LargeBinary)), func.length(cast(Revision.original, LargeBinary)), maintain_column_froms=True)).first()
    if sizes is None:
        fail("design_revision_missing", "The exact design revision is unavailable in this project and document.", 404)
    if (sizes[0] or 0) > 65536 or (sizes[1] or 0) > 1024 * 1024:
        fail("design_revision_budget", "The complete design original exceeds its bounded source budget.", 413)
    row = db.scalar(query)
    from hermes_core.transactional import digest as original_digest

    try:
        DocumentContent.model_validate({key: getattr(row, key) for key in DocumentContent.model_fields})
        RevisionMetadata.model_validate(revision_metadata(row))
    except (ValueError, TypeError, AttributeError):
        fail("design_revision_invalid", "The complete fixed revision has invalid content or metadata.")
    if (not isinstance(row.original, dict) or row.original.get("schema") != "manager.design-revision.v1"
            or original_digest(row.original) != row.digest or row.original.get("revision_id") != row.id
            or row.original.get("tenant_id") != project.tenant_id or row.original.get("project_id") != project.id
            or row.original.get("document_id") != document_id or row.original.get("content") != row.content
            or row.original.get("title") != row.title or row.original.get("category") != row.category
            or row.original.get("tags") != row.tags or row.original.get("number") != row.number
            or any(row.original.get(key) != getattr(row, key) for key in ("note", "author_id", "author_name", "restored_from", "preview_id"))
            or row.original.get("created_at") != date(row.created_at)
            or row.number < 1 or not row.content.strip() or "\x00" in row.content
            or hashlib.sha256(row.content.encode("utf-8")).hexdigest() != row.content_sha256
            or len(row.content.encode("utf-8")) != row.content_bytes or digest is not None and digest != row.digest):
        fail("design_revision_invalid", "The fixed design revision or its exact digest cannot be verified.")
    return row


def revision_metadata(row):
    return {"id": row.id, "document_id": row.document_id, "number": row.number, "digest": row.digest,
        "content_sha256": row.content_sha256, "content_bytes": row.content_bytes, "title": row.title,
        "category": row.category, "tags": deepcopy(row.tags), "note": row.note,
        "author": {"id": row.author_id, "name": row.author_name}, "created_at": date(row.created_at),
        "restored_from": row.restored_from, "preview_id": row.preview_id}


def load_design_selections(db, project, requirement_ids, task_ids, *, input_budget=None):
    targets = or_(
        (Adoption.target_kind == "requirement") & Adoption.target_id.in_(set(requirement_ids)),
        (Adoption.target_kind == "task") & Adoption.target_id.in_(set(task_ids)))
    latest = select(func.max(Adoption.seq).label("seq")).where(*scope(project, Adoption), targets).group_by(Adoption.target_kind, Adoption.target_id, Adoption.slot).subquery()
    columns = (Adoption.id, Adoption.tenant_id, Adoption.project_id, Adoption.target_kind, Adoption.target_id,
        Adoption.slot, Adoption.operation, Adoption.reference, Adoption.digest, Adoption.original, Adoption.revision_id,
        Adoption.target_basis, Adoption.design_basis, Adoption.preview_basis, Adoption.comment, Adoption.actor_id, Adoption.actor_name,
        Adoption.accepted_version, Adoption.created_at, Revision.digest.label("source_digest"), Revision.document_id.label("source_document_id"),
        Revision.number.label("source_number"), Revision.content_sha256.label("source_sha256"),
        Revision.content_bytes.label("source_bytes"), Revision.title.label("source_title"), Revision.category.label("source_category"))
    query = select(*columns).join(latest, Adoption.seq == latest.c.seq).outerjoin(Revision,
        (Revision.id == Adoption.revision_id) & (Revision.tenant_id == project.tenant_id) & (Revision.project_id == project.id))
    if input_budget is None:
        from .delivery_input_budget import CanonicalInputBudget

        input_budget = CanonicalInputBudget({"bytes_used": 0}, code="design_adoption_source_budget")
    input_budget.rows(db, query, columns)
    result = {}
    for row in db.execute(query):
        original = row.original
        request = original.get("request", {}) if isinstance(original, dict) else {}
        if (not isinstance(original, dict) or not isinstance(request, dict) or digest(original) != row.digest or row.operation not in {"adopt", "clear"}
                or original.get("schema") != "manager.design-adoption.v1"
                or any(original.get(key) != getattr(row, key) for key in ("id", "tenant_id", "project_id", "target_kind", "target_id", "accepted_version"))
                or original.get("action") != row.target_kind + ".design." + row.operation
                or original.get("actor") != row.actor_id or original.get("actor_name") != row.actor_name or original.get("created_at") != date(row.created_at)
                or request.get(row.target_kind + "_id") != row.target_id
                or any(request.get(key) != getattr(row, key) for key in ("slot", "target_basis", "design_basis", "preview_basis", "comment"))
                or original.get("reference") != row.reference):
            fail("design_adoption_invalid", "The immutable design adoption original cannot be verified.")
        try:
            COMMANDS[original["action"]].model_validate(request)
        except (KeyError, TypeError, ValueError):
            fail("design_adoption_invalid", "The immutable design adoption request has an invalid shape.")
        if row.operation == "clear":
            if row.reference is not None or row.revision_id is not None:
                fail("design_adoption_invalid", "A fixed clear decision cannot silently restore a source.")
            continue
        try:
            reference = DesignReference.model_validate(row.reference).model_dump(mode="json")
        except Exception:
            fail("design_adoption_invalid", "The fixed current design adoption has an invalid source shape.")
        if (reference["origin_kind"] != row.target_kind or reference["origin_id"] != row.target_id or reference["slot"] != row.slot
                or reference["adoption_id"] != row.id or reference["revision_id"] != row.revision_id
                or any(reference[key] != value for key, value in (("document_id", row.source_document_id),
                    ("revision_digest", row.source_digest), ("revision_number", row.source_number),
                    ("content_sha256", row.source_sha256), ("content_bytes", row.source_bytes),
                    ("title", row.source_title), ("category", row.source_category)))
                or any(request.get(key) != reference[key] for key in ("document_id", "revision_id", "revision_digest"))):
            fail("design_adoption_invalid", "The fixed design adoption no longer identifies this target.")
        result.setdefault((row.target_kind, row.target_id), []).append(reference)
    return {key: sorted(values, key=lambda item: item["slot"]) for key, values in result.items()}


def effective_designs(selections, target_kind, target_id, requirement_id=None):
    own = deepcopy(selections.get((target_kind, target_id), []))
    inherited = selections.get(("requirement", requirement_id), []) if target_kind == "task" and requirement_id else []
    merged = {reference["slot"]: deepcopy(reference) for reference in inherited}
    merged.update({reference["slot"]: reference for reference in own})
    return own, [merged[slot] for slot in sorted(merged)]


def _base(document, body):
    if (document.document_version, document.head_revision_id, document.head_revision_digest) != (
            body.document_version, body.base_revision_id, body.base_revision_digest):
        fail("design_document_changed", "The document head changed. Review the new revision before explicitly saving again.")


def _revision(db, project, user, document, values, command_key, *, restored_from=None, preview_id=None):
    from .delivery_service import identifier

    instant, identity = now(), identifier("design-revision")
    number = document.revision_number + 1
    original = {"schema": "manager.design-revision.v1", "revision_id": identity, "document_id": document.id,
        "tenant_id": project.tenant_id, "project_id": project.id, "number": number, **deepcopy(values),
        "author_id": user.id, "author_name": user.username, "created_at": date(instant),
        "command_key": command_key, "restored_from": restored_from, "preview_id": preview_id}
    row = Revision(id=identity, tenant_id=project.tenant_id, project_id=project.id, document_id=document.id,
        number=number, digest=digest(original), **values, content_sha256=hashlib.sha256(values["content"].encode("utf-8")).hexdigest(),
        content_bytes=len(values["content"].encode("utf-8")), author_id=user.id, author_name=user.username,
        created_at=instant, restored_from=restored_from, preview_id=preview_id, original=original)
    document.document_version += 1
    document.head_revision_id, document.head_revision_digest = row.id, row.digest
    document.revision_number, document.updated_at = number, instant
    document.title, document.category, document.tags = row.title, row.category, deepcopy(row.tags)
    db.add(row)
    db.flush()
    return row


def apply_document(db, project, user, action, body, *, command_key):
    from sop_manager.project_write_guard import design_write_scope, require_project_operation
    from .delivery_service import identifier

    require_project_operation(db, project.tenant_id, project.id)
    user, _permissions = access(db, project, user, write=True)
    with design_write_scope(db, project.tenant_id, project.id):
        if action == "design.document.create":
            instant = now()
            document = Document(id=identifier("design"), tenant_id=project.tenant_id, project_id=project.id,
                document_version=0, revision_number=0, head_revision_id="", head_revision_digest="",
                title=body.title, category=body.category, tags=body.tags, archived=False, created_at=instant, updated_at=instant)
            db.add(document)
            db.flush()
            revision = _revision(db, project, user, document, body.model_dump(mode="json"), command_key)
        else:
            document = load_document(db, project, body.document_id)
            _base(document, body)
            if action == "design.document.archive":
                document.archived, document.updated_at = body.archived, now()
                document.document_version += 1
                revision = load_revision(db, project, document.id, document.head_revision_id, digest=document.head_revision_digest)
            elif action == "design.revision.restore":
                load_document(db, project, document.id, include_archived=False)
                source = load_revision(db, project, document.id, body.revision_id, digest=body.revision_digest)
                values = {key: deepcopy(getattr(source, key)) for key in ("title", "category", "tags", "content")}
                revision = _revision(db, project, user, document, {**values, "note": body.note}, command_key, restored_from=source.id)
            else:
                load_document(db, project, document.id, include_archived=False)
                if body.preview_id:
                    from .design_generation import validate_preview

                    validate_preview(db, project, user, document.id, body.preview_id, body.base_revision_id, body.base_revision_digest)
                values = body.model_dump(mode="json", include=set(DocumentContent.model_fields))
                revision = _revision(db, project, user, document, values, command_key, preview_id=body.preview_id)
        db.flush()
    return document.id, None, {"document_id": document.id, "revision_id": revision.id,
        "revision_digest": revision.digest, "document_version": document.document_version}
