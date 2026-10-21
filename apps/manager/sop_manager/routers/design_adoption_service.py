"""Complete impact proof and append-only design choices, including standalone work."""
from copy import deepcopy

from fastapi import HTTPException
from hermes_core.transactional import digest
from sqlalchemy import select

from .design_model import ProjectDesignAdoption as Adoption
from .design_service import access, date, design_basis, effective_designs, fail, load_document, load_revision, now
from .delivery_input_budget import CanonicalInputBudget
from .delivery_plan import requirement_basis
from .delivery_quality_scope import _Scope
from .delivery_query_index import scope
from .delivery_query_read import _now, _stamp, _unchanged, metadata
from .delivery_requirement_contract import RequirementReadBudget
from .delivery_requirement_impact import KINDS, acl, budget_counts, count, relation_queries, validate_sources
from .sql_models import DeliveryWorkspace, Requirement, Task


def current(db, project, user, kind, identity):
    from .delivery_quality_scope import load_task_scope
    from .delivery_verification import VerificationContext
    from .delivery_service import initial_state

    _actor, permissions = access(db, project, user)
    stamp = _stamp(db, project)
    if kind == "task":
        context = load_task_scope(db, project, identity)
        target = context.tasks[identity]
        basis = context.basis(identity)
        requirement_id = target.req_id
    else:
        target = db.scalar(select(Requirement).where(*scope(project, Requirement), Requirement.id == identity))
        if target is None:
            fail("design_target_missing", "Requirement is unavailable in this project.", 404)
        context = VerificationContext(db, project, initial_state(), tasks=[], requirements=[target], reviews=[], issues=[])
        basis, requirement_id = requirement_basis(target), None
    own, effective = effective_designs(context.design_selections, kind, identity, requirement_id)
    reasons = [] if permissions["write"] else [{"code": "design_write_required", "message": "Current project write permission is required."}]
    _unchanged(db, project, stamp)
    return {**metadata(db, project, stamp), "as_of": _now(), "target_kind": kind, "target_id": identity,
        "target_basis": basis, "design_basis": design_basis(effective), "own": own, "effective": effective,
        "can_adopt": not reasons, "reasons": reasons}


def prepare(db, project, user, kind, identity, body, *, operation="adopt", store=None):
    selected = current(db, project, user, kind, identity)
    if selected["target_basis"] != body.target_basis or selected["design_basis"] != body.design_basis:
        fail("design_target_changed", "The target or selected designs changed. Explicitly review a fresh design preview.")
    source = None
    if operation == "adopt":
        if any(reference["slot"] == body.slot and reference["document_id"] == body.document_id
                and reference["revision_id"] == body.revision_id and reference["revision_digest"] == body.revision_digest
                for reference in selected["own"]):
            fail("design_already_adopted", "This exact revision is already directly selected for this slot.")
        load_document(db, project, body.document_id, include_archived=False)
        source = load_revision(db, project, body.document_id, body.revision_id, digest=body.revision_digest)
    elif not any(reference["slot"] == body.slot for reference in selected["own"]):
        fail("design_slot_not_owned", "There is no direct design choice to clear in this slot.")
    validate_sources(db, project)
    target_task = db.scalar(select(Task).where(*scope(project, Task), Task.id == identity)) if kind == "task" else None
    impact_requirement = target_task.req_id if target_task and target_task.req_id else identity if kind == "requirement" else None
    queries = relation_queries(project, impact_requirement or identity, task_target=impact_requirement is None)
    budget = budget_counts(db, queries)
    tracker = CanonicalInputBudget(budget, code="design_adoption_proof_budget")
    identities = {}
    for relation in KINDS:
        rows = queries[relation].subquery()
        query = select(rows.c.id).order_by(rows.c.id)
        tracker.rows(db, query, [rows.c.id])
        identities[relation] = db.scalars(query).all()
    task_ids = set(identities["direct_task"] + identities["dependent_task"])
    context = _Scope(db, project, {impact_requirement} if impact_requirement else set(), task_ids,
        10000, input_budget=tracker, record_limit=10000, extra_flow_fields=("accepted_work",)).context()
    own = {reference["slot"]: reference for reference in selected["own"]}
    if source:
        own[body.slot] = {"slot": body.slot, "adoption_id": "pending-adoption", "document_id": source.document_id,
            "revision_id": source.id, "revision_number": source.number, "revision_digest": source.digest,
            "content_sha256": source.content_sha256, "content_bytes": source.content_bytes,
            "title": source.title, "category": source.category, "origin_kind": kind, "origin_id": identity}
    else:
        own.pop(body.slot, None)
    selections = deepcopy(context.design_selections)
    selections[(kind, identity)] = list(own.values())
    requirement_id = context.tasks[identity].req_id if kind == "task" else None
    _next_own, next_effective = effective_designs(selections, kind, identity, requirement_id)
    flow = context.data.get("flows", {}).get(impact_requirement, {}) if impact_requirement else {}
    semantic = {"target_kind": kind, "target_id": identity, "target_basis": body.target_basis,
        "design_basis": body.design_basis, "slot": body.slot, "operation": operation,
        "source": source.digest if source else None, "impact": identities,
        "tasks": {tid: {"basis": context.basis(tid), "verified": context.verified(tid)} for tid in sorted(task_ids)},
        "flow": {key: flow.get(key) for key in ("stage", "revision", "closed")}, "generation": selected["query_generation"]}
    preview_basis = digest(semantic)
    visible, restricted, _ = acl(db, project, queries, user, store)
    counts = {relation: count(db, query) for relation, query in visible.items()}
    counts.update(restricted)
    invalidates = bool(task_ids or identities["release_candidate"] or identities["deployment"] or flow.get("stage") not in {None, "intake"})
    return {"selected": selected, "preview_basis": preview_basis, "next_effective": next_effective,
        "impact": {"counts": counts, "invalidates_current_acceptance": invalidates}, "budget": budget,
        "identities": identities, "source": source, "context": context, "impact_requirement": impact_requirement}


def preview(db, project, user, kind, identity, body, *, store=None):
    selected = current(db, project, user, kind, identity)
    try:
        complete = prepare(db, project, user, kind, identity, body, operation=body.operation, store=store)
        return {**selected, "available": True, "complete": True, "allowed": selected["can_adopt"],
            "preview_basis": complete["preview_basis"], "next_effective": complete["next_effective"],
            "impact": complete["impact"], "budget": complete["budget"]}
    except HTTPException as exc:
        if exc.status_code not in {409, 413} or not isinstance(exc.detail, dict) or exc.detail.get("code") == "design_target_changed":
            raise
        return {**selected, "available": False, "complete": False, "allowed": False, "preview_basis": None,
            "next_effective": [], "impact": {"counts": None, "invalidates_current_acceptance": None},
            "budget": RequirementReadBudget().model_dump(), "reasons": [*selected["reasons"], exc.detail]}


def prepare_command(db, project, user, action, body, *, store=None):
    if action not in {"requirement.design.adopt", "requirement.design.clear", "task.design.adopt", "task.design.clear"}:
        return None
    kind = action.split(".")[0]
    identity = body.requirement_id if kind == "requirement" else body.task_id
    complete = prepare(db, project, user, kind, identity, body, operation=action.split(".")[-1], store=store)
    if complete["preview_basis"] != body.preview_basis:
        fail("design_adoption_preview_changed", "The exact source or complete affected work changed. Review a new preview.")
    return complete


def apply_adoption(db, project, user, data, action, body, prepared, *, command_key):
    from sop_manager.project_write_guard import design_write_scope, require_project_operation
    from .delivery_service import default_flow, identifier, invalidate
    from .delivery_verification import VerificationContext
    require_project_operation(db, project.tenant_id, project.id)
    user, _permissions = access(db, project, user, write=True)
    if prepared is None or prepared["preview_basis"] != body.preview_basis:
        fail("design_adoption_preview_required", "A complete current design impact preview is required.")
    kind, operation = action.split(".")[0], action.split(".")[-1]
    identity = body.requirement_id if kind == "requirement" else body.task_id
    source, instant, adoption_id = prepared["source"], now(), identifier("design-adoption")
    reference = None
    if source:
        reference = next(item for item in prepared["next_effective"] if item["slot"] == body.slot)
        reference = {**reference, "adoption_id": adoption_id}
    version = db.connection().scalar(select(DeliveryWorkspace.version).where(*scope(project, DeliveryWorkspace)))
    original = {"schema": "manager.design-adoption.v1", "id": adoption_id, "tenant_id": project.tenant_id,
        "project_id": project.id, "action": action, "target_kind": kind, "target_id": identity,
        "request": body.model_dump(mode="json"), "reference": reference, "accepted_version": version,
        "command_key": command_key, "actor": user.id, "actor_name": user.username, "created_at": date(instant)}
    row = Adoption(id=adoption_id, tenant_id=project.tenant_id, project_id=project.id, target_kind=kind, target_id=identity,
        slot=body.slot, operation=operation, revision_id=source.id if source else None, reference=reference,
        target_basis=body.target_basis, design_basis=body.design_basis, preview_basis=body.preview_basis,
        digest=digest(original), original=original, comment=body.comment, actor_id=user.id, actor_name=user.username,
        accepted_version=version, created_at=instant)
    with design_write_scope(db, project.tenant_id, project.id):
        db.add(row)
        db.flush()
    affected = set(prepared["identities"]["direct_task"] + prepared["identities"]["dependent_task"])
    executions = set(prepared["identities"]["execution"])
    for entry in data.get("executions", []):
        if entry["id"] in executions:
            entry["planning_invalidated"] = True
    impact_requirement = prepared["impact_requirement"]
    if impact_requirement:
        flow = data["flows"].setdefault(impact_requirement, default_flow())
        invalidate(flow)
        db.get(Requirement, impact_requirement).status = "pending"
    if kind == "requirement":
        flow = data["flows"][identity]
        flow["artifacts"].append({"id": identifier("evidence"), "kind": body.slot,
            "title": source.title if source else "Design choice cleared", "content": "", "url": "",
            "result": "recorded" if source else "failed", "revision": flow["revision"], "actor": user.id,
            "at": date(instant), "source": "design_revision", "design_adoption_id": adoption_id,
            "design": deepcopy(reference), "comment": body.comment})
    verification = VerificationContext(db, project, data)
    from .delivery_manual_review import invalidate_reviews

    invalidate_reviews(db, project, verification=verification)
    target = verification.tasks.get(identity) if kind == "task" else None
    _own, effective = effective_designs(verification.design_selections, kind, identity, target.req_id if target else None)
    return adoption_id, None, {"adoption_id": adoption_id, "target_kind": kind, "target_id": identity,
        "design_basis": design_basis(effective), "task_ids": sorted(affected),
        "requirement_id": identity if kind == "requirement" else target.req_id or None}
