"""Canonical project edits and reversible resources within one delivery transaction."""

from copy import deepcopy

from fastapi import HTTPException
from pydantic import ValidationError

from .delivery_contract import Dated

PROJECT_METADATA = {"goal", "owner_id", "starts_on", "ends_on"}


def project_view(project, data):
    """Canonical fields always win over historical metadata copies."""
    return {
        **{key: value for key, value in data.get("project", {}).items() if key in PROJECT_METADATA},
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "status": project.status,
        "business_id": project.business_id,
        "project_path": project.project_path or "",
        "vector_db": project.vector_db or "lance",
        "is_template": bool(project.is_template),
    }


def update_project(db, project, data, body):
    before = deepcopy(project_view(project, data))
    changes = body.model_dump(mode="json", exclude_unset=True)
    metadata = {k: v for k, v in data.get("project", {}).items() if k in PROJECT_METADATA}
    metadata.update({k: v for k, v in changes.items() if k in PROJECT_METADATA})
    try:
        Dated.model_validate({k: metadata.get(k) for k in ("starts_on", "ends_on")})
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_context=False)) from exc
    if changes.get("business_id"):
        from .sql_models import Business

        business = db.get(Business, changes["business_id"])
        if not business or business.tenant_id != project.tenant_id:
            raise HTTPException(422, "Choose a business in this project's tenant")
    for field in (
        "name",
        "description",
        "business_id",
        "project_path",
        "vector_db",
        "vector_db_config",
        "is_template",
    ):
        if field in changes:
            setattr(project, field, changes[field])
    data["project"] = metadata
    return project.id, before


def apply_resource(data, user, action, body):
    """Keep resource identity and provenance; events retain every prior revision."""
    from .delivery_service import identifier, stamp

    entries = data.setdefault("resources", [])
    current = next((entry for entry in entries if entry["id"] == body.id), None)
    if body.id and current is None:
        raise HTTPException(404, "Resource not found in this project")
    before = deepcopy(current)
    now = stamp()
    if action == "resource.archive":
        current.update(archived=True, updated_at=now, updated_by=user.id)
        return body.id, before
    saved = {
        **body.model_dump(mode="json"),
        "id": body.id or identifier("resource"),
        "created_at": current["created_at"] if current else now,
        "created_by": current["created_by"] if current else user.id,
        "updated_at": now,
        "updated_by": user.id,
    }
    data["resources"] = [entry for entry in entries if entry["id"] != saved["id"]] + [saved]
    return saved["id"], before
