"""Paged catalogues and exact, generation-consistent quality/release reads."""

from fastapi import HTTPException
from sqlalchemy import func, or_, select

from .delivery_activity_cursor import encode_cursor
from .delivery_query_index import scope
from .delivery_query_read import (
    _cursor_position,
    _filter_signature,
    _now,
    _stamp,
    _unchanged,
    _window,
    fail,
    metadata,
    workspace_path,
)
from .delivery_release import _candidate_view, _evidence_view, _permissions, quality, reconcile_releases
from .sql_models import DeliveryQueryFact

RELEASE_KINDS = {"candidate": "release_candidate", "evidence": "release_evidence", "legacy": "release_legacy"}


def quality_scope(db, project, *, requirement_ids=None, task_ids=None):
    from .delivery_quality_scope import load_quality_scope

    with db.no_autoflush:
        stamp = _stamp(db, project)
        context = load_quality_scope(db, project, requirement_ids=requirement_ids, task_ids=task_ids)
        value = quality(db, project, context.data, requirement_ids=requirement_ids, task_ids=task_ids, verification=context)
        selected = value["selected"]
        requirements = [row for row in value["requirements"] if row["id"] in selected["requirement_ids"]]
        included = set(selected["task_ids"]) | {tid for row in requirements for tid in row["task_ids"]}
        tasks = [row for row in value["tasks"] if row["id"] in included]
        value.update(requirements=requirements, tasks=tasks, independent_tasks=[row for row in tasks if not row["requirement_id"]],
            summary={"requirements_total": len(requirements), "tasks_total": len(tasks), "verified_tasks": sum(row["verified"] for row in tasks),
                "unverified_tasks": sum(not row["verified"] for row in tasks), "accepted_requirements": sum(row["accepted"] for row in requirements),
                "critical_issues": len({issue["id"] for row in tasks for issue in row["issues"]})})
        _unchanged(db, project, stamp)
        return {**value, **metadata(db, project, stamp)}


def _validate_page(limit, q):
    if type(limit) is not int or not 1 <= limit <= 100 or not isinstance(q, str) or len(q) > 200:
        fail("delivery_query_filter_invalid", "Use a page size of 1..100 and at most 200 search characters.", 422)


def _totals(db, project, kinds):
    fact = DeliveryQueryFact
    counts = dict(db.execute(select(fact.kind, func.count()).where(*scope(project, fact), fact.kind.in_(kinds.values())).group_by(fact.kind)).all())
    return {key: counts.get(kind, 0) for key, kind in kinds.items()}


def _search(query, term, fields):
    if not term:
        return query
    fact = DeliveryQueryFact
    return query.where(or_(fact.entity_id.icontains(term, autoescape=True),
        *(fact.data["item"][name].as_string().icontains(term, autoescape=True) for name in fields)))


def _page(db, project, user, stamp, query, filters, limit, cursor, *, descending=False):
    fact = DeliveryQueryFact
    signature = [project.tenant_id, project.id, user.id, "quality-release", _filter_signature(filters), limit]
    after = _cursor_position(cursor, signature, stamp, "id_asc")
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    key = func.coalesce(fact.data["item"]["at"].as_string(), "") if descending else func.lower(fact.label)
    result = db.execute(_window(query.add_columns(key.label("__sort")), key, fact.entity_id, descending, after).limit(limit + 1)).mappings().all()
    following = encode_cursor(signature, [stamp["generation"]], [result[limit - 1]["__sort"], result[limit - 1]["entity_id"]]) if len(result) > limit else None
    _unchanged(db, project, stamp)
    return {**metadata(db, project, stamp), "as_of": _now(), "items": [row["data"]["item"] for row in result[:limit]], "total": total, "limit": limit, "next_cursor": following}


def quality_catalogue(db, project, user, filters, *, limit=20, cursor=""):
    values = {"kind": "all", "q": "", "readiness": "all", **filters}
    _validate_page(limit, values["q"])
    if set(values) != {"kind", "q", "readiness"} or values["kind"] not in {"all", "requirement", "task"} or values["readiness"] not in {"all", "ready", "attention"}:
        fail("delivery_query_filter_invalid", "Choose a supported quality catalogue filter.", 422)
    with db.no_autoflush:
        stamp = _stamp(db, project)
        fact = DeliveryQueryFact
        query = select(fact.entity_id, fact.data).where(*scope(project, fact), fact.kind == "quality_catalogue")
        if values["kind"] != "all":
            query = query.where(fact.parent_id == values["kind"])
        if values["readiness"] != "all":
            query = query.where(fact.status == values["readiness"])
        query = _search(query, values["q"], ["id", "title"])
        counts = dict(db.execute(select(fact.parent_id, func.count()).where(*scope(project, fact), fact.kind == "quality_catalogue").group_by(fact.parent_id)).all())
        result = _page(db, project, user, stamp, query, {"view": "quality", **values}, limit, cursor)
        result["totals"] = {"requirements": counts.get("requirement", 0), "independent_tasks": counts.get("task", 0)}
        return result


def release_context(db, project, user):
    with db.no_autoflush:
        stamp = _stamp(db, project)
        value = {**metadata(db, project, stamp), "as_of": _now(), "policy": workspace_path(db, project, "release_policy"),
            "permissions": _permissions(db, project, user), "totals": _totals(db, project, RELEASE_KINDS)}
        _unchanged(db, project, stamp)
        return value


def release_page(db, project, user, kind, *, limit=20, cursor="", q=""):
    _validate_page(limit, q)
    if kind not in RELEASE_KINDS:
        fail("delivery_query_filter_invalid", "Choose candidate, evidence or legacy history.", 422)
    with db.no_autoflush:
        stamp = _stamp(db, project)
        fact = DeliveryQueryFact
        query = select(fact.entity_id, fact.data).where(*scope(project, fact), fact.kind == RELEASE_KINDS[kind])
        query = _search(query, q, ["id", "title", "version", "environment", "commit_sha", "requirement_id", "requirement_title", "summary"])
        return _page(db, project, user, stamp, query, {"view": "releases", "kind": kind, "q": q}, limit, cursor, descending=True)


def _exact_fact(db, project, kind, entity_id):
    data = db.scalar(select(DeliveryQueryFact.data).where(*scope(project, DeliveryQueryFact), DeliveryQueryFact.kind == kind, DeliveryQueryFact.entity_id == entity_id))
    if data is None:
        fail("release_not_found", "The selected release object was not found in this project.", 404)
    return data


def _original(db, project, array, entity_id, fact):
    position = fact.get("position")
    if type(position) is not int or position < 0:
        fail("delivery_query_rebuild_required", "Original release locations require an explicit rebuild.")
    row = workspace_path(db, project, array, position)
    if not isinstance(row, dict) or row.get("id") != entity_id:
        fail("delivery_query_cursor_stale", "The selected original changed; reload its catalogue.")
    return row


def _evidence_inputs(db, project, evidence_id):
    fact = _exact_fact(db, project, "release_evidence", evidence_id)
    evidence = _original(db, project, "ci_evidence", evidence_id, fact)
    latest = fact.get("latest_sequence")
    if not isinstance(latest, list) or len(latest) != 2 or any(type(value) is not int for value in latest):
        fail("delivery_query_rebuild_required", "Current CI sequence metadata requires an explicit rebuild.")
    predicate = evidence["statement"]["predicate"]
    peer = {"id": None, "statement": {"predicate": {key: predicate[key] for key in ("policy_generation", "repository", "workflow", "commit_sha")}}}
    peer["statement"]["predicate"].update(run_number=latest[0], run_attempt=latest[1])
    return evidence, [evidence, peer]


def _proof(db, project, selected, evidence_rows):
    from .delivery_quality_scope import load_quality_scope

    try:
        context = load_quality_scope(db, project, **selected)
    except HTTPException as exc:
        code = exc.detail.get("code") if isinstance(exc.detail, dict) else None
        budget = exc.status_code == 413 and code == "quality_scope_too_large"
        if not budget and code not in {"release_scope_not_found", "release_task_scope_invalid", "quality_scope_unavailable"}:
            raise
        context = _UnavailableQualityScope(project, incomplete=budget)
    context.data["release_policy"] = workspace_path(db, project, "release_policy")
    context.data["ci_evidence"] = evidence_rows
    return context


class _UnavailableQualityScope:
    """An explicit unavailable proof, so retained originals remain inspectable.

    Every accepted scope is nonempty. Canonical _selected rejects this context,
    producing release_scope_unavailable; it cannot become an eligible scope.
    """

    def __init__(self, project, *, incomplete=False):
        self.project = project
        self.scope_check_incomplete = incomplete
        self.tasks, self.requirements = {}, {}
        self.data = {"flows": {}}


def candidate_detail(db, project, user, id):
    with db.no_autoflush:
        stamp = _stamp(db, project)
        fact = _exact_fact(db, project, "release_candidate", id)
        candidate = _original(db, project, "release_candidates", id, fact)
        evidence, peers = _evidence_inputs(db, project, candidate["snapshot"]["ci"]["id"])
        context = _proof(db, project, candidate["snapshot"]["selected"], peers)
        context.data["release_candidates"] = [candidate]
        reconcile_releases(db, project, context.data, verification=context)
        result = {**metadata(db, project, stamp), "as_of": _now(),
            "candidate": _candidate_view(db, project, context.data, user, candidate, verification=context, deployment=fact["deployment"]),
            "evidence": _evidence_view(db, project, context.data, evidence, verification=context), "envelope": evidence["envelope"], "permissions": _permissions(db, project, user)}
        _unchanged(db, project, stamp)
        return result


def evidence_detail(db, project, user, id):
    with db.no_autoflush:
        stamp = _stamp(db, project)
        evidence, peers = _evidence_inputs(db, project, id)
        context = _proof(db, project, evidence["selected"], peers)
        result = {**metadata(db, project, stamp), "as_of": _now(), "evidence": _evidence_view(db, project, context.data, evidence, verification=context),
            "envelope": evidence["envelope"], "permissions": _permissions(db, project, user)}
        _unchanged(db, project, stamp)
        return result
