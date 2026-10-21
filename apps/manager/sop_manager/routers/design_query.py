"""Thin authenticated SQL catalogues and explicit exact revision originals."""
import difflib

from sqlalchemy import func, select

from .design_model import ProjectDesignDocument as Document, ProjectDesignRevision as Revision
from .design_service import access, date, fail, load_document, load_revision, revision_metadata
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_query_index import scope
from .delivery_query_read import _now, _stamp, metadata


def _permissions(permissions, document=None):
    allowed = bool(permissions["write"])
    active = not (document and document.archived)
    reasons = [] if allowed else [{"code": "design_write_unavailable", "message": "Current project write permission is required."}]
    if allowed and not active:
        reasons.append({"code": "design_document_archived", "message": "Restore this document before editing or generating another revision."})
    return {"can_write": allowed, "can_generate": bool(allowed and active), "reasons": reasons}


def _head(row):
    return {"id": row.id, "document_version": row.document_version, "head_revision_id": row.head_revision_id,
        "head_revision_digest": row.head_revision_digest, "revision_number": row.revision_number,
        "title": row.title, "category": row.category, "tags": row.tags, "archived": row.archived,
        "created_at": date(row.created_at), "updated_at": date(row.updated_at)}


def _read_stamp(db, project):
    # The SQL library can be the first business action in a new project.
    # Reading an empty library must not require or build derived delivery facts.
    return metadata(db, project, _stamp(db, project, required=False))


def _same_stamp(db, project, stamp):
    if _read_stamp(db, project) != stamp:
        fail("design_catalogue_changed", "The project or design catalogue changed. Reload this view.")


def envelope(db, project, stamp):
    return {**stamp, "as_of": _now()}


def documents(db, project, user, *, limit=20, cursor="", q="", include_archived=False):
    actor, permissions = access(db, project, user)
    stamp = _read_stamp(db, project)
    filters = [project.tenant_id, project.id, actor.id, "design-documents", limit, q, include_archived]
    query = select(Document).where(*scope(project, Document))
    if not include_archived:
        query = query.where(Document.archived.is_(False))
    if q:
        query = query.where(Document.title.icontains(q, autoescape=True))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    if cursor:
        upper, position = decode_cursor(cursor, filters)
        if upper != [stamp["version"], stamp["query_generation"]] or len(position) != 1 or not isinstance(position[0], str):
            fail("design_catalogue_changed", "Design catalogue changed. Reload the first page.")
        query = query.where(Document.id > position[0])
    rows = db.scalars(query.order_by(Document.id).limit(limit + 1)).all()
    _same_stamp(db, project, stamp)
    return {**envelope(db, project, stamp), "items": [_head(row) for row in rows[:limit]], "total": total, "limit": limit,
        "next_cursor": encode_cursor(filters, [stamp["version"], stamp["query_generation"]], [rows[limit - 1].id]) if len(rows) > limit else None,
        "permissions": _permissions(permissions)}


def document(db, project, user, document_id):
    _actor, permissions = access(db, project, user)
    stamp = _read_stamp(db, project)
    row = load_document(db, project, document_id)
    _same_stamp(db, project, stamp)
    return {**envelope(db, project, stamp), "document": _head(row), "permissions": _permissions(permissions, row)}


def revisions(db, project, user, document_id, *, limit=20, cursor=""):
    actor, _permissions = access(db, project, user)
    stamp = _read_stamp(db, project)
    load_document(db, project, document_id)
    # Metadata projection never selects content or the protected original JSON.
    columns = [column for column in Revision.__table__.c if column.key not in {"content", "original"}]
    predicate = (*scope(project, Revision), Revision.document_id == document_id)
    filters = [project.tenant_id, project.id, actor.id, "design-revisions", document_id, limit]
    upper = db.scalar(select(func.max(Revision.seq)).where(*predicate)) or 0
    after = None
    if cursor:
        maximum, position = decode_cursor(cursor, filters)
        if (len(maximum) != 1 or len(position) != 1 or type(maximum[0]) is not int or type(position[0]) is not int
                or not 0 < position[0] <= maximum[0]):
            fail("design_revision_cursor_invalid", "Use an exact revision history cursor.", 422)
        upper, after = maximum[0], position[0]
    query = select(*columns).where(*predicate, Revision.seq <= upper)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    if after is not None:
        query = query.where(Revision.seq < after)
    rows = db.execute(query.order_by(Revision.seq.desc()).limit(limit + 1)).all()
    _same_stamp(db, project, stamp)
    return {**envelope(db, project, stamp), "document_id": document_id,
        "items": [revision_metadata(row) for row in rows[:limit]], "total": total, "limit": limit,
        "next_cursor": encode_cursor(filters, [upper], [rows[limit - 1].seq]) if len(rows) > limit else None}


def revision(db, project, user, document_id, revision_id):
    access(db, project, user)
    stamp = _read_stamp(db, project)
    load_document(db, project, document_id)
    row = load_revision(db, project, document_id, revision_id)
    _same_stamp(db, project, stamp)
    return {**envelope(db, project, stamp), "document_id": document_id, "revision": revision_metadata(row), "content": row.content}


def compare(db, project, user, document_id, from_id, to_id):
    access(db, project, user)
    stamp = _read_stamp(db, project)
    load_document(db, project, document_id)
    before, after = (load_revision(db, project, document_id, identity) for identity in (from_id, to_id))
    lines = list(difflib.unified_diff(before.content.splitlines(), after.content.splitlines(),
        fromfile=before.id, tofile=after.id, lineterm=""))
    _same_stamp(db, project, stamp)
    return {**envelope(db, project, stamp), "document_id": document_id, "from_revision_id": before.id,
        "to_revision_id": after.id, "added_lines": sum(line.startswith("+") for line in lines[2:]),
        "removed_lines": sum(line.startswith("-") for line in lines[2:]),
        "diff_preview": "\n".join(lines[:120])[:24000], "truncated": len(lines) > 120 or len("\n".join(lines[:120])) > 24000}
