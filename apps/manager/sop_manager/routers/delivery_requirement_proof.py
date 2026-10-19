"""Complete canonical requirement changes, shared by previews and actual writers."""

from copy import deepcopy
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select

from . import sql_models as m
from .delivery_activity_contract import DefinitionChanges
from .delivery_input_budget import CanonicalInputBudget
from .delivery_plan import requirement_basis, requirement_snapshot
from .delivery_quality_scope import _Scope
from .delivery_query_index import scope
from .delivery_query_read import _unchanged
from .delivery_requirement_contract import RequirementReadBudget
from .delivery_requirement_impact import KINDS, acl, budget_counts, count, relation_queries, validate_sources
from .delivery_requirement_read import context, envelope, fail
from .delivery_service import _fingerprint

DEFINITION_FIELDS = ("title", "description", "acceptance_criteria")
_CACHE = "delivery_requirement_proof"


@dataclass
class CompleteChange:
    basis: str
    preview_basis: str
    differences: list
    impact: dict
    flow: dict
    budget: dict
    stamp: dict
    queries: dict
    changes: dict


def prepare(db, project, identity, changes, *, expected_basis=None):
    """No whole Workspace, project Task bodies or CAS precedes the source budget."""
    normalized = DefinitionChanges.normalized(changes)
    stamp, _, derived = context(db, project, identity)
    if expected_basis is not None and expected_basis != derived["basis"]:
        fail(
            "requirement_basis_changed",
            "Requirement changed. Read and explicitly adopt its current definition.",
        )
    validate_sources(db, project)
    queries = relation_queries(project, identity)
    budget = budget_counts(db, queries)
    tracker = CanonicalInputBudget(budget, code="requirement_proof_bytes_budget")
    impact = {}
    for kind, key in zip(
        KINDS,
        ("task_ids", "dependent_task_ids", "execution_ids", "release_candidate_ids", "deployment_ids"),
        strict=True,
    ):
        rows = queries[kind].subquery()
        query = select(rows.c.id).order_by(rows.c.id)
        tracker.rows(db, query, [rows.c.id])
        values = db.scalars(query).all()
        if any(not isinstance(value, str) or not value for value in values) or len(values) != len(
            set(values)
        ):
            fail("requirement_source_unavailable", "Impact identities are not unique canonical resource IDs")
        impact[key] = values
    affected = set(impact["task_ids"] + impact["dependent_task_ids"])
    loader = _Scope(
        db,
        project,
        {identity},
        affected,
        10000,
        input_budget=tracker,
        record_limit=10000,
        extra_flow_fields=("accepted_work",),
    )
    verification = loader.context()
    if affected - verification.tasks.keys() or identity not in verification.requirements:
        fail("requirement_source_unavailable", "A necessary canonical requirement or Task is missing")
    budget.update(
        closure_task_count=len(verification.tasks), requirement_count=len(verification.requirements)
    )
    # accepted_work entered the necessary source BEFORE canonical reconciliation.
    # invalidate() may permanently remove it; an expired original is never restored.
    flow = deepcopy(verification.data["flows"].get(identity, {}))
    requirement = verification.requirements[identity]
    current = requirement_snapshot(requirement)
    basis = requirement_basis(requirement)
    if basis != derived["basis"]:
        fail(
            "delivery_query_rebuild_required",
            "Current requirement facts do not match their canonical definition",
        )
    differences = [
        {"field": key, "before": current[key], "after": normalized[key]}
        for key in DEFINITION_FIELDS
        if key in normalized and normalized[key] != current[key]
    ]
    impact["invalidates_current_acceptance"] = bool(
        differences
        and (
            flow.get("accepted_work")
            or flow.get("tested_work")
            or flow.get("stage") in {"testing", "acceptance", "release", "operations"}
        )
    )
    tasks = []
    for task_id in sorted(affected):
        row = verification.tasks[task_id]
        if (
            not isinstance(row.title, str)
            or not isinstance(row.description, str)
            or not isinstance(row.acceptance_criteria, list)
            or any(not isinstance(item, str) for item in row.acceptance_criteria)
        ):
            fail(
                "requirement_source_unavailable", "A necessary canonical Task definition has an invalid shape"
            )
        tasks.append(
            {
                **{
                    key: getattr(row, key)
                    for key in ("id", "req_id", "title", "description", "acceptance_criteria", "owner_id")
                },
                "depends_on": verification.data["task_details"].get(task_id, {}).get("depends_on", []),
            }
        )
    semantic = {
        "tasks": tasks,
        "flows": {"stage": flow.get("stage"), "revision": flow.get("revision")},
        "impact": impact,
    }
    digest = _fingerprint(
        {"project_id": project.id, "requirement_basis": basis, "changes": differences, "impact": semantic}
    )
    _unchanged(db, project, stamp)
    return CompleteChange(basis, digest, differences, impact, flow, budget, stamp, queries, normalized)


def preview(db, project, identity, basis, changes, *, user, store=None):
    stamp, _, derived = context(db, project, identity)
    if basis != derived["basis"]:
        fail(
            "requirement_basis_changed",
            "Requirement changed. Read and explicitly adopt its current definition.",
        )
    try:
        complete = prepare(db, project, identity, changes, expected_basis=basis)
        visible, restricted, _ = acl(db, project, complete.queries, user, store)
        counts = {kind: count(db, query) for kind, query in visible.items()}
        counts.update(restricted)
        result = dict(
            preview_basis=complete.preview_basis,
            changes=complete.differences,
            impact=dict(
                counts=counts,
                invalidates_current_acceptance=complete.impact["invalidates_current_acceptance"],
            ),
            available=True,
            complete=True,
            allowed=True,
            budget=complete.budget,
            reasons=[],
        )
    except HTTPException as exc:
        if (
            exc.status_code not in (409, 413)
            or not isinstance(exc.detail, dict)
            or exc.detail.get("code") in {"requirement_basis_changed", "delivery_query_cursor_stale"}
        ):
            raise
        result = dict(
            preview_basis=None,
            changes=[],
            impact=dict(counts=None, invalidates_current_acceptance=None),
            available=False,
            complete=False,
            allowed=False,
            budget=RequirementReadBudget().model_dump(),
            reasons=[exc.detail],
        )
    _unchanged(db, project, stamp)
    return {**envelope(db, project, identity, stamp), "requirement_basis": basis, **result}


def install(db, project, identity, complete):
    transaction = db.get_nested_transaction() or db.get_transaction()
    key = (transaction, project.tenant_id, project.id, identity)
    previous = db.info.setdefault(_CACHE, {}).get(key)
    db.info[_CACHE][key] = complete
    return key, previous


def release(db, token):
    if token is None:
        return
    key, previous = token
    if previous is None:
        db.info.get(_CACHE, {}).pop(key, None)
    else:
        db.info[_CACHE][key] = previous


def change_facts(db, project, state, requirement, changes):
    normalized = DefinitionChanges.normalized(changes)
    transaction = db.get_nested_transaction() or db.get_transaction()
    complete = db.info.get(_CACHE, {}).get((transaction, project.tenant_id, project.id, requirement.id))
    if complete is None or complete.changes != normalized:
        complete = prepare(db, project, requirement.id, normalized)
    if complete.basis != requirement_basis(requirement):
        fail("requirement_basis_changed", "The canonical definition changed inside the writer transaction")
    flow = state.get("flows", {}).get(requirement.id, {})
    if any(flow.get(key) != complete.flow.get(key) for key in ("stage", "revision")):
        fail("requirement_change_preview_changed", "Canonical flow changed; review the complete change again")
    return complete.basis, complete.preview_basis, deepcopy(complete.differences), deepcopy(complete.impact)


def prepare_update(db, project, identity, body):
    """Prepare only substantive definition edits; metadata/no-op keep their semantics."""
    changes = body.model_dump(exclude_unset=True, exclude_none=True, include=set(DEFINITION_FIELDS))
    if not changes:
        return None
    stamp, _, derived = context(db, project, identity)
    if body.requirement_basis and body.requirement_basis != derived["basis"]:
        fail(
            "requirement_basis_changed",
            "Requirement changed. Read and explicitly adopt its current definition.",
        )
    columns = [getattr(m.Requirement, key) for key in changes]
    query = select(*columns).where(*scope(project, m.Requirement), m.Requirement.id == identity)
    budget = RequirementReadBudget().model_dump()
    CanonicalInputBudget(budget, code="requirement_proof_bytes_budget").rows(db, query, columns)
    original = db.execute(query).mappings().one()
    if all(original[key] == value for key, value in changes.items()):
        _unchanged(db, project, stamp)
        return None
    if not body.requirement_basis or not body.change_preview_basis:
        fail("requirement_change_preview_required", "Preview this definition change before confirming it.")
    complete = prepare(db, project, identity, changes, expected_basis=body.requirement_basis)
    if complete.preview_basis != body.change_preview_basis:
        fail(
            "requirement_change_preview_changed",
            "Definition changes or affected work changed. Review a fresh preview.",
        )
    return complete


def prepare_sync(db, project, body):
    if body.module != "requirements" or body.action == "create":
        return None
    identity = body.record.get("id")
    if not isinstance(identity, str) or not db.scalar(
        select(m.Requirement.id).where(*scope(project, m.Requirement), m.Requirement.id == identity)
    ):
        return None
    from .delivery_contract import RequirementEdit

    changes = {key: body.record[key] for key in DEFINITION_FIELDS if key in body.record}
    edit = RequirementEdit(
        id=identity,
        **changes,
        requirement_basis=body.requirement_basis,
        change_preview_basis=body.change_preview_basis,
    )
    complete = prepare_update(db, project, identity, edit)
    if complete is None and body.change_preview_basis is not None:
        complete = prepare(db, project, identity, changes, expected_basis=body.requirement_basis)
        if complete.preview_basis != body.change_preview_basis:
            fail("requirement_change_preview_changed", "Definition or impact changed; review a fresh preview")
    if complete is None and body.requirement_basis is not None:
        _, _, derived = context(db, project, identity)
        if derived["basis"] != body.requirement_basis:
            fail("requirement_basis_changed", "Requirement changed; review its current definition")
    return complete


def prepare_assistance(db, project, identity, criteria):
    query = select(m.Requirement.acceptance_criteria).where(
        *scope(project, m.Requirement), m.Requirement.id == identity
    )
    budget = RequirementReadBudget().model_dump()
    CanonicalInputBudget(budget, code="requirement_proof_bytes_budget").rows(
        db, query, [m.Requirement.acceptance_criteria]
    )
    original = db.scalar(query)
    if original == criteria:
        return None
    return prepare(db, project, identity, {"acceptance_criteria": criteria})


def require_change_preview(db, project, state, requirement, body):
    changes = body.model_dump(exclude_unset=True, exclude_none=True, include=set(DEFINITION_FIELDS))
    if changes and body.requirement_basis and body.requirement_basis != requirement_basis(requirement):
        fail(
            "requirement_basis_changed",
            "Requirement changed. Read and explicitly adopt its current definition.",
        )
    if not any(value != getattr(requirement, key) for key, value in changes.items()):
        return
    if not body.requirement_basis or not body.change_preview_basis:
        fail("requirement_change_preview_required", "Preview this definition change before confirming it.")
    basis, digest, _, _ = change_facts(db, project, state, requirement, changes)
    if body.requirement_basis != basis:
        fail(
            "requirement_basis_changed",
            "Requirement changed. Read and explicitly adopt its current definition.",
        )
    if body.change_preview_basis != digest:
        fail(
            "requirement_change_preview_changed",
            "Definition changes or affected work changed. Review a fresh preview.",
        )
