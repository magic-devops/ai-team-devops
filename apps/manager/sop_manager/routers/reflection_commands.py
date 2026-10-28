"""One source-exact fixed input inside the canonical Delivery transaction."""

import hashlib
import json

from sqlalchemy import select

from sop_manager.project_write_guard import reflection_input_write_scope

from . import sql_models as m
from .event_common import fail, identifier, scope


def manifest_digest(sources):
    return hashlib.sha256(json.dumps(sources, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def apply_input(db, project, user, payload, store):
    from .reflection_query import exact, selected_source_bytes

    refs = [r.model_dump() for r in payload.sources]
    selected_source_bytes(db, project, [r["reflection_id"] for r in refs])
    scopes = set()
    for reference in refs:
        result = exact(db, project, user, reference["reflection_id"], store=store, include_raw=False)
        if not result["available"] or result["selection_reference"] != reference:
            fail("reflection_source_changed", "A selected original changed or is unavailable; review the exact source again")
        scopes.update(db.scalar(select(m.ReflectionRecord.runtime_scopes).where(*scope(project, m.ReflectionRecord),
                          m.ReflectionRecord.id == reference["reflection_id"])))
    iid = identifier()
    version = db.scalar(select(m.DeliveryWorkspace.version).where(*scope(project, m.DeliveryWorkspace)))
    with reflection_input_write_scope(db, project.tenant_id, project.id, iid):
        db.add(m.ReflectionInput(id=iid, tenant_id=project.tenant_id, project_id=project.id,
               title=payload.title, rationale=payload.rationale, created_by_id=user.id, created_by_name=user.username,
               source_version=version, sources=refs, manifest_digest=manifest_digest(refs), runtime_scopes=sorted(scopes)))
        db.flush()
    return iid, None, {"status": "prepared", "source_count": len(refs)}
