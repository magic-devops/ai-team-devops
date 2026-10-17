"""Actual canonical definition observations and basis-bound change review."""

from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import and_, func, select

from .delivery_activity_contract import (
    DefinitionChanges,
    RequirementChangePreview,
    RequirementHistory,
    RequirementVersion,
    RequirementVersionDetail,
)
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_plan import requirement_basis, requirement_snapshot
from .delivery_service import _fingerprint, get_record, identifier, records
from .sql_models import DeliveryRequirementVersion, DeliveryWorkspace, Requirement, Task

DEFINITION_FIELDS = ("title", "description", "acceptance_criteria")


def _fail(code, message):
    raise HTTPException(409, {"code": code, "message": message})


def capture_definitions(db, project, *, actor=""):
    """Append only actually observed new definitions inside the writer transaction."""
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
        }
    ).model_dump(mode="json")


def requirement_history(db, project, id, *, cursor="", limit=20, user=None, store=None):
    requirement = records(db, Requirement, project).filter_by(id=id).first()
    query = records(db, DeliveryRequirementVersion, project).filter_by(requirement_id=id)
    if not requirement and query.first() is None:
        raise HTTPException(
            404,
            {
                "code": "requirement_missing",
                "message": "Requirement has no recorded definition in this project",
            },
        )
    filters = [project.tenant_id, project.id, "requirement_history", id]
    if cursor:
        upper, after = decode_cursor(cursor, filters)
        if len(upper) != 1 or len(after) != 1 or type(upper[0]) is not int or type(after[0]) is not int:
            raise HTTPException(422, "Invalid requirement history cursor")
    else:
        upper = [query.with_entities(func.max(DeliveryRequirementVersion.seq)).scalar() or 0]
        after = None
    query = query.filter(DeliveryRequirementVersion.seq <= upper[0])
    if after:
        query = query.filter(DeliveryRequirementVersion.seq < after[0])
    rows = query.order_by(DeliveryRequirementVersion.seq.desc()).limit(limit + 1).all()
    next_cursor = encode_cursor(filters, upper, [rows[limit - 1].seq]) if len(rows) > limit else None
    basis = requirement_basis(requirement) if requirement else None
    current_links = None
    if requirement:
        workspace = db.get(DeliveryWorkspace, project.id)
        state = workspace.data if workspace else {}
        projected = project_impact(db, project, state, user, _impact(db, project, state, id), store)
        projected.pop("invalidates_current_acceptance")
        current_links = {"requirement_basis": basis, **projected}
    return RequirementHistory.model_validate(
        {
            "project_id": project.id,
            "requirement_id": id,
            "current_basis": basis,
            "current_links": current_links,
            "items": [version_view(row) for row in rows[:limit]],
            "next_cursor": next_cursor,
        }
    ).model_dump(mode="json")


def requirement_version_detail(db, project, id, version_id):
    row = records(db, DeliveryRequirementVersion, project).filter_by(requirement_id=id, id=version_id).first()
    if not row:
        raise HTTPException(
            404,
            {
                "code": "requirement_version_missing",
                "message": "This observed version was not recorded in this project and requirement",
            },
        )
    return RequirementVersionDetail.model_validate(
        {"project_id": project.id, "requirement_id": id, "item": version_view(row)}
    ).model_dump(mode="json")


def _impact(db, project, state, requirement_id):
    tasks = records(db, Task, project).all()
    direct = {row.id for row in tasks if row.req_id == requirement_id}
    affected = set(direct)
    while True:
        added = {
            row.id
            for row in tasks
            if affected.intersection(state.get("task_details", {}).get(row.id, {}).get("depends_on", []))
        }
        if added <= affected:
            break
        affected.update(added)
    executions = [row for row in state.get("executions", []) if row["task_id"] in affected]
    candidates = [
        row
        for row in state.get("release_candidates", [])
        if requirement_id in row["snapshot"]["selected"]["requirement_ids"]
        or affected.intersection(row["snapshot"]["selected"]["task_ids"])
    ]
    candidate_ids = {row["id"] for row in candidates}
    deployments = [row for row in state.get("deployments", []) if row["candidate_id"] in candidate_ids]
    flow = state.get("flows", {}).get(requirement_id, {})
    return {
        "task_ids": sorted(direct),
        "dependent_task_ids": sorted(affected - direct),
        "execution_ids": sorted(row["id"] for row in executions),
        "release_candidate_ids": sorted(candidate_ids),
        "deployment_ids": sorted(row["id"] for row in deployments),
        "invalidates_current_acceptance": bool(
            flow.get("accepted_work")
            or flow.get("tested_work")
            or flow.get("stage") in {"testing", "acceptance", "release", "operations"}
        ),
    }


def change_facts(db, project, state, requirement, changes):
    normalized = DefinitionChanges.normalized(changes)
    current = requirement_snapshot(requirement)
    differences = [
        {"field": key, "before": current[key], "after": normalized[key]}
        for key in DEFINITION_FIELDS
        if key in normalized and normalized[key] != current[key]
    ]
    impact = _impact(db, project, state, requirement.id)
    if not differences:
        impact["invalidates_current_acceptance"] = False
    # Detail semantics participate, not a volatile heartbeat/run version.
    semantic = {
        "tasks": [
            dict(
                id=row.id,
                req_id=row.req_id,
                title=row.title,
                description=row.description,
                acceptance_criteria=row.acceptance_criteria,
                owner_id=row.owner_id,
                depends_on=state.get("task_details", {}).get(row.id, {}).get("depends_on", []),
            )
            for row in records(db, Task, project)
            .filter(Task.id.in_(impact["task_ids"] + impact["dependent_task_ids"]))
            .order_by(Task.id)
        ],
        "flows": {
            "stage": state.get("flows", {}).get(requirement.id, {}).get("stage"),
            "revision": state.get("flows", {}).get(requirement.id, {}).get("revision"),
        },
        "impact": impact,
    }
    basis = requirement_basis(requirement)
    preview_basis = _fingerprint(
        {"project_id": project.id, "requirement_basis": basis, "changes": differences, "impact": semantic}
    )
    return basis, preview_basis, differences, impact


def project_impact(db, project, state, user, impact, store):
    from .delivery_activity import target_view

    projected = deepcopy(impact)
    readable = [
        target_view(db, project, state, user, {"kind": "execution", "id": value}, store)
        for value in impact["execution_ids"]
    ]
    projected["execution_ids"] = [value["id"] for value in readable if value and value["available"]]
    projected["restricted_execution_count"] = len(readable) - len(projected["execution_ids"])
    projected["deployment_ids"] = [
        value
        for value in impact["deployment_ids"]
        if target_view(db, project, state, user, {"kind": "deployment", "id": value}, store)["available"]
    ]
    projected["restricted_deployment_count"] = len(impact["deployment_ids"]) - len(
        projected["deployment_ids"]
    )
    return projected


def preview_change(db, project, state, user, id, basis, changes, *, version, store=None):
    requirement = get_record(db, Requirement, project, id)
    current_basis, preview_basis, differences, impact = change_facts(db, project, state, requirement, changes)
    if basis != current_basis:
        _fail(
            "requirement_basis_changed",
            "Requirement changed. Read and explicitly adopt its current definition.",
        )
    projected = project_impact(db, project, state, user, impact, store)
    return RequirementChangePreview.model_validate(
        {
            "project_id": project.id,
            "requirement_id": id,
            "version": version,
            "requirement_basis": current_basis,
            "preview_basis": preview_basis,
            "changes": differences,
            "impact": projected,
            "allowed": True,
            "reasons": [],
        }
    ).model_dump(mode="json")


def require_change_preview(db, project, state, requirement, body):
    changes = body.model_dump(exclude_unset=True, exclude_none=True, include=set(DEFINITION_FIELDS))
    if changes and body.requirement_basis and body.requirement_basis != requirement_basis(requirement):
        _fail(
            "requirement_basis_changed",
            "Requirement changed. Read and explicitly adopt its current definition.",
        )
    if not any(value is not None and value != getattr(requirement, key) for key, value in changes.items()):
        return
    if not body.requirement_basis or not body.change_preview_basis:
        _fail("requirement_change_preview_required", "Preview this definition change before confirming it.")
    basis, preview_basis, _, _ = change_facts(db, project, state, requirement, changes)
    if body.requirement_basis != basis:
        _fail(
            "requirement_basis_changed",
            "Requirement changed. Read and explicitly adopt its current definition.",
        )
    if body.change_preview_basis != preview_basis:
        _fail(
            "requirement_change_preview_changed",
            "Definition changes or affected work changed. Review a fresh preview.",
        )
