"""Actual canonical definition observations and basis-bound change review."""

from copy import deepcopy
from types import SimpleNamespace

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, func, select

from .delivery_activity_contract import (
    RequirementVersion,
    RequirementVersionDetail,
)
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_plan import requirement_basis, requirement_snapshot
from .delivery_service import _fingerprint, identifier, records
from .sql_models import DeliveryRequirementVersion, DeliveryWorkspace, Requirement


def capture_definitions(db, project, *, actor=""):
    """Append only actually observed new definitions inside the writer transaction."""
    from ..project_write_guard import requirement_version_capture_scope

    with requirement_version_capture_scope(db, project.tenant_id, project.id):
        _capture_definitions(db, project, actor=actor)


def _capture_definitions(db, project, *, actor=""):
    latest = (
        select(
            DeliveryRequirementVersion.requirement_id, func.max(DeliveryRequirementVersion.seq).label("seq")
        )
        .where(
            DeliveryRequirementVersion.tenant_id == project.tenant_id,
            DeliveryRequirementVersion.project_id == project.id,
        )
        .group_by(DeliveryRequirementVersion.requirement_id)
        .subquery()
    )
    prior = {
        row.requirement_id: row
        for row in db.scalars(
            select(DeliveryRequirementVersion).join(
                latest,
                and_(
                    DeliveryRequirementVersion.requirement_id == latest.c.requirement_id,
                    DeliveryRequirementVersion.seq == latest.c.seq,
                ),
            )
        ).all()
    }
    workspace = db.get(DeliveryWorkspace, project.id)
    state = workspace.data if workspace else {}
    transaction = db.get_nested_transaction() or db.get_transaction()
    identity = (
        db.info.get("delivery_collaboration_actor", {})
        .get(transaction, {})
        .get((project.tenant_id, project.id))
    )
    for requirement in records(db, Requirement, project).all():
        basis = requirement_basis(requirement)
        previous = prior.get(requirement.id)
        if previous and previous.basis == basis:
            continue
        db.add(
            DeliveryRequirementVersion(
                id=identifier("reqv"),
                tenant_id=project.tenant_id,
                project_id=project.id,
                requirement_id=requirement.id,
                number=previous.number + 1 if previous else 1,
                basis=basis,
                definition=requirement_snapshot(requirement),
                actor_id=identity.get("id") if identity else None,
                actor_name=identity.get("name", "") if identity else "",
                source="delivery_command" if identity else "sql_observed",
                flow_revision=state.get("flows", {}).get(requirement.id, {}).get("revision"),
            )
        )
    db.flush()


def version_view(row):
    return RequirementVersion.model_validate(
        {
            "id": row.id,
            "number": row.number,
            "basis": row.basis,
            "definition": deepcopy(row.definition),
            "at": row.created_at.isoformat() + "Z",
            "actor": {"id": row.actor_id, "name": row.actor_name},
            "source": row.source,
            "flow_revision": row.flow_revision,
        },
        strict=True,
    ).model_dump(mode="json")


def requirement_history(db, project, id, *, cursor="", limit=20, user=None):
    from .delivery_query_read import _now
    from .delivery_requirement_read import valid_id

    valid_id(id)
    model = DeliveryRequirementVersion
    columns = [column for column in model.__table__.c if column.key != "definition"]
    query = select(*columns).where(
        model.tenant_id == project.tenant_id, model.project_id == project.id, model.requirement_id == id
    )
    upper = db.scalar(query.with_only_columns(func.max(model.seq), maintain_column_froms=True)) or 0
    exists = db.scalar(
        select(Requirement.id).where(
            Requirement.tenant_id == project.tenant_id,
            Requirement.project_id == project.id,
            Requirement.id == id,
        )
    )
    if not exists and not upper:
        raise HTTPException(
            404,
            {
                "code": "requirement_missing",
                "message": "Requirement has no recorded definition in this project",
            },
        )
    filters = [project.tenant_id, project.id, user.id if user else None, "requirement_history", id, limit]
    if cursor:
        upper, after = decode_cursor(cursor, filters)
        if len(upper) != 1 or len(after) != 1 or type(upper[0]) is not int or type(after[0]) is not int:
            raise HTTPException(422, "Invalid requirement history cursor")
    else:
        upper = [upper]
        after = None
    query = query.filter(DeliveryRequirementVersion.seq <= upper[0])
    if after:
        query = query.filter(DeliveryRequirementVersion.seq < after[0])
    rows = db.execute(query.order_by(DeliveryRequirementVersion.seq.desc()).limit(limit + 1)).mappings().all()
    next_cursor = encode_cursor(filters, upper, [rows[limit - 1]["seq"]]) if len(rows) > limit else None
    items = [
        {
            "id": row["id"],
            "number": row["number"],
            "basis": row["basis"],
            "at": row["created_at"].isoformat() + "Z",
            "actor": {"id": row["actor_id"], "name": row["actor_name"]},
            "source": row["source"],
            "flow_revision": row["flow_revision"],
        }
        for row in rows[:limit]
    ]
    return {
        "project_id": project.id,
        "requirement_id": id,
        "as_of": _now(),
        "items": items,
        "limit": limit,
        "next_cursor": next_cursor,
        "earlier_history_unknown": True,
    }


def requirement_version_detail(db, project, id, version_id):
    from .delivery_requirement_read import check_size, fail, sqlite_only, valid_id

    valid_id(id)
    valid_id(version_id, 200)
    sqlite_only(db)
    model = DeliveryRequirementVersion
    query = select(*model.__table__.c).where(
        model.tenant_id == project.tenant_id,
        model.project_id == project.id,
        model.requirement_id == id,
        model.id == version_id,
    )
    check_size(db, query, model.definition)
    row = db.execute(query).mappings().first()
    if not row:
        raise HTTPException(
            404,
            {
                "code": "requirement_version_missing",
                "message": "This observed version was not recorded in this project and requirement",
            },
        )
    if (
        not isinstance(row["definition"], dict)
        or row["definition"].get("id") != id
        or _fingerprint(row["definition"]) != row["basis"]
    ):
        fail("requirement_version_unavailable", "The saved definition identity or basis cannot be verified")
    try:
        return RequirementVersionDetail.model_validate(
            {"project_id": project.id, "requirement_id": id, "item": version_view(SimpleNamespace(**row))}
        ).model_dump(mode="json")
    except ValidationError:
        fail("requirement_version_unavailable", "The saved definition shape cannot be verified")
