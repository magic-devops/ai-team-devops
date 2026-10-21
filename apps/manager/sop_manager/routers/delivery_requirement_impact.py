"""Current requirement impact as SQL relationships, never a Python project scan."""

from fastapi import HTTPException
from sqlalchemy import and_, case, false, func, literal, or_, select, true

from . import sql_models as m
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_query_index import scope
from .delivery_query_read import _filter_signature, _unchanged
from .delivery_requirement_contract import RequirementReadBudget
from .delivery_requirement_read import context, ensure_workspace_shape, envelope, fail, path, valid_id

KINDS = ("direct_task", "dependent_task", "execution", "release_candidate", "deployment")
MAX_RECORDS = 10000


def field(items, *parts):
    return case((items.c.type == "object", func.json_extract(items.c.value, path(*parts))), else_=None)


def array(collection, name):
    return (
        func.json_each(m.DeliveryWorkspace.data, path(collection))
        .table_valued("key", "value", "type")
        .alias(name)
    )


def workspace_query(project, items):
    return (
        select()
        .select_from(m.DeliveryWorkspace)
        .join(items, true())
        .where(*scope(project, m.DeliveryWorkspace))
    )


def invalid_id(value, json_type, maximum=200):
    whitespace = "".join(chr(number) for number in range(0x3100) if chr(number).isspace())
    return or_(
        func.coalesce(json_type != "text", True),
        value == "",
        func.length(value) > maximum,
        value != func.trim(value, whitespace),
        value.op("GLOB")("*[\x01-\x1f\x7f-\x9f]*"),
        func.instr(value, func.char(0)) > 0,
        func.instr(value, "/") > 0,
        func.instr(value, "\\") > 0,
    )


def source_type(items, *parts):
    return case((items.c.type == "object", func.json_type(items.c.value, path(*parts))), else_=None)


def reject_rows(db, query, message):
    if db.scalar(query.with_only_columns(literal(1), maintain_column_froms=True).limit(1)):
        fail("requirement_source_unavailable", message)


def affected_tasks(project, identity, *, task_target=False):
    task = m.Task
    plans = (
        func.json_each(m.DeliveryWorkspace.data, path("task_details"))
        .table_valued("key", "value", "type")
        .alias("impact_plans")
    )
    safe_plan = case((plans.c.type == "object", plans.c.value), else_=literal("{}"))
    deps = (
        func.json_each(safe_plan, path("depends_on"))
        .table_valued("value", "type")
        .alias("impact_dependencies")
    )
    edges = (
        select(task.id.label("task_id"), deps.c.value.label("dependency_id"))
        .select_from(m.DeliveryWorkspace)
        .join(plans, true())
        .join(task, and_(task.id == plans.c.key, *scope(project, task)))
        .join(deps, true())
        .where(*scope(project, m.DeliveryWorkspace), deps.c.type == "text")
        .cte("requirement_dependency_edges")
    )
    direct = select(task.id.label("id")).where(*scope(project, task), task.id == identity if task_target else task.req_id == identity)
    affected = direct.cte("requirement_affected_tasks", recursive=True)
    affected = affected.union(select(edges.c.task_id).join(affected, edges.c.dependency_id == affected.c.id))
    return direct, affected


def relation_queries(project, identity, *, task_target=False):
    direct, affected = affected_tasks(project, identity, task_target=task_target)
    task, fact = m.Task, m.DeliveryQueryFact
    task_query = (
        select(
            task.id.label("id"),
            func.substr(task.title, 1, 256).label("title"),
            fact.status.label("status"),
            literal(None).label("workspace_id"),
        )
        .select_from(task)
        .outerjoin(fact, and_(*scope(project, fact), fact.kind == "task", fact.entity_id == task.id))
        .where(*scope(project, task))
    )
    affected_ids = select(affected.c.id)
    execution = select(
        fact.entity_id.label("id"),
        func.substr(fact.parent_id, 1, 256).label("title"),
        fact.status.label("status"),
        fact.data["workspace_id"].as_string().label("workspace_id"),
    ).where(*scope(project, fact), fact.kind == "execution", fact.parent_id.in_(affected_ids))
    candidates = array("release_candidates", "impact_candidates")
    requirements = (
        func.json_each(
            case((candidates.c.type == "object", candidates.c.value), else_=literal("{}")),
            path("snapshot", "selected", "requirement_ids"),
        )
        .table_valued("value")
        .alias("impact_candidate_requirements")
    )
    tasks = (
        func.json_each(
            case((candidates.c.type == "object", candidates.c.value), else_=literal("{}")),
            path("snapshot", "selected", "task_ids"),
        )
        .table_valued("value")
        .alias("impact_candidate_tasks")
    )
    match = or_(
        select(1).select_from(requirements).where(requirements.c.value.in_(select(task.req_id).where(*scope(project, task), task.id.in_(affected_ids))) if task_target else requirements.c.value == identity).exists(),
        select(1).select_from(tasks).where(tasks.c.value.in_(affected_ids)).exists(),
    )
    candidate = (
        workspace_query(project, candidates)
        .with_only_columns(
            field(candidates, "id").label("id"),
            func.substr(field(candidates, "snapshot", "version"), 1, 256).label("title"),
            field(candidates, "decision").label("status"),
            literal(None).label("workspace_id"),
        )
        .where(match)
    )
    candidate_rows = candidate.subquery("selected_impact_candidates")
    deployments = array("deployments", "impact_deployments")
    deployment = workspace_query(project, deployments).with_only_columns(
        field(deployments, "id").label("id"),
        func.substr(field(deployments, "snapshot", "candidate_snapshot", "version"), 1, 256).label("title"),
        field(deployments, "status").label("status"),
        field(deployments, "snapshot", "definition", "workspace_id").label("workspace_id"),
    )
    deployment = deployment.where(field(deployments, "candidate_id").in_(select(candidate_rows.c.id)))
    return {
        "direct_task": task_query.where(task.id.in_(direct)),
        "dependent_task": task_query.where(task.id.in_(affected_ids), task.id.not_in(direct)),
        "execution": execution,
        "release_candidate": candidate,
        "deployment": deployment,
    }


def validate_sources(db, project):
    # Null is not absence. Unknown relations cannot be called a complete empty graph.
    ensure_workspace_shape(db, project)
    workspace = m.DeliveryWorkspace
    columns = [
        func.json_type(workspace.data, path(collection))
        for collection in ("task_details", "executions", "release_candidates", "deployments")
    ]
    kinds = db.execute(select(*columns).where(*scope(project, workspace))).first()
    if kinds and any(
        kind is not None and kind != expected
        for kind, expected in zip(kinds, ("object", "array", "array", "array"), strict=True)
    ):
        fail("requirement_source_unavailable", "An original impact relationship container is invalid")
    plans = (
        func.json_each(workspace.data, path("task_details"))
        .table_valued("key", "value", "type")
        .alias("validated_impact_plans")
    )
    safe = case((plans.c.type == "object", plans.c.value), else_=literal("{}"))
    dependency_type = func.json_type(safe, path("depends_on"))
    bad = (
        select(1)
        .select_from(workspace)
        .join(plans, true())
        .join(m.Task, and_(m.Task.id == plans.c.key, *scope(project, m.Task)))
        .where(
            *scope(project, workspace),
            or_(plans.c.type != "object", and_(dependency_type.is_not(None), dependency_type != "array")),
        )
        .limit(1)
    )
    if db.scalar(bad):
        fail("requirement_source_unavailable", "A canonical dependency relationship is unknown")
    deps = (
        func.json_each(safe, path("depends_on")).table_valued("value", "type").alias("validated_dependencies")
    )
    parent = m.Task.__table__.alias("canonical_dependency")
    dependency_query = (
        select()
        .select_from(workspace)
        .join(plans, true())
        .join(m.Task, and_(m.Task.id == plans.c.key, *scope(project, m.Task)))
        .join(deps, true())
        .outerjoin(
            parent,
            and_(
                parent.c.id == deps.c.value,
                parent.c.tenant_id == project.tenant_id,
                parent.c.project_id == project.id,
            ),
        )
        .where(*scope(project, workspace))
    )
    reject_rows(
        db,
        dependency_query.where(or_(invalid_id(deps.c.value, deps.c.type, 64), parent.c.id.is_(None))),
        "A canonical dependency ID is invalid or missing from this project",
    )
    fact = m.DeliveryQueryFact
    execution_sources = array("executions", "canonical_latest_execution")
    latest = (
        workspace_query(project, execution_sources)
        .with_only_columns(field(execution_sources, "id"))
        .where(field(execution_sources, "task_id") == m.Task.id)
        .order_by(execution_sources.c.key.desc())
        .limit(1)
        .correlate(m.Task)
        .scalar_subquery()
    )
    missing = (
        select(m.Task.id)
        .outerjoin(fact, and_(*scope(project, fact), fact.kind == "task", fact.entity_id == m.Task.id))
        .where(
            *scope(project, m.Task),
            or_(
                fact.entity_id.is_(None),
                fact.parent_id != func.coalesce(m.Task.req_id, ""),
                func.coalesce(func.json_type(fact.data) != "object", True),
                func.coalesce(func.json_type(fact.data, path("execution_id")) != "text", True),
                func.coalesce(fact.data["execution_id"].as_string(), "") != func.coalesce(latest, ""),
            ),
        )
    )
    if db.scalar(missing.limit(1)):
        fail(
            "delivery_query_rebuild_required",
            "Canonical Tasks and current Task facts do not describe the same complete scope",
        )
    for collection in ("executions", "release_candidates", "deployments"):
        rows = array(collection, "validated_" + collection)
        query = workspace_query(project, rows)
        bad_fields = [rows.c.type != "object", invalid_id(field(rows, "id"), source_type(rows, "id"))]
        if collection == "executions":
            for name, maximum in (("task_id", 64), ("workspace_id", 200)):
                bad_fields.append(invalid_id(field(rows, name), source_type(rows, name), maximum))
        elif collection == "release_candidates":
            for parts, expected in (
                (("snapshot",), "object"),
                (("snapshot", "selected"), "object"),
                (("snapshot", "selected", "requirement_ids"), "array"),
                (("snapshot", "selected", "task_ids"), "array"),
                (("snapshot", "version"), "text"),
                (("decision",), "text"),
            ):
                bad_fields.append(func.coalesce(source_type(rows, *parts) != expected, True))
        else:
            bad_fields += [
                invalid_id(field(rows, "candidate_id"), source_type(rows, "candidate_id")),
                invalid_id(
                    field(rows, "snapshot", "definition", "workspace_id"),
                    source_type(rows, "snapshot", "definition", "workspace_id"),
                ),
                func.coalesce(source_type(rows, "snapshot", "candidate_snapshot", "version") != "text", True),
                func.coalesce(source_type(rows, "status") != "text", True),
            ]
        reject_rows(
            db, query.where(or_(*bad_fields)), "An original impact record or association has an invalid shape"
        )
        duplicates = (
            query.with_only_columns(field(rows, "id")).group_by(field(rows, "id")).having(func.count() > 1)
        )
        reject_rows(db, duplicates, "Original impact record IDs are not unique")
        if collection == "release_candidates":
            for name in ("requirement_ids", "task_ids"):
                values = (
                    func.json_each(rows.c.value, path("snapshot", "selected", name))
                    .table_valued("value", "type")
                    .alias("validated_selected_" + name)
                )
                selected = query.join(values, true())
                reject_rows(
                    db,
                    selected.where(invalid_id(values.c.value, values.c.type, 64)),
                    "A selected historical release ID is invalid",
                )
        if collection == "executions":
            joined = query.outerjoin(
                fact,
                and_(*scope(project, fact), fact.kind == "execution", fact.entity_id == field(rows, "id")),
            )
            reject_rows(
                db,
                joined.where(
                    or_(
                        fact.entity_id.is_(None),
                        func.coalesce(fact.data["id"].as_string() != field(rows, "id"), True),
                        func.coalesce(fact.data["task_id"].as_string() != field(rows, "task_id"), True),
                        func.coalesce(
                            fact.data["workspace_id"].as_string() != field(rows, "workspace_id"), True
                        ),
                        func.coalesce(func.json_type(fact.data, path("position")) != "integer", True),
                        func.coalesce(fact.data["position"].as_integer() != rows.c.key, True),
                        fact.parent_id != field(rows, "task_id"),
                    )
                ),
                "Current execution facts do not identify their canonical original",
            )
            stored = db.scalar(
                select(func.count()).select_from(fact).where(*scope(project, fact), fact.kind == "execution")
            )
            originals = db.scalar(query.with_only_columns(func.count(), maintain_column_froms=True))
            if stored != originals:
                fail(
                    "delivery_query_rebuild_required",
                    "Current execution facts do not cover exactly the recorded execution sources",
                )


def count(db, query):
    rows = query.subquery()
    return db.scalar(select(func.count()).select_from(rows))


def acl(db, project, queries, user, store):
    from .delivery_issue_evidence import _access

    workspaces = set()
    for kind in ("execution", "deployment"):
        rows = queries[kind].subquery()
        values = db.scalars(select(rows.c.workspace_id).distinct().limit(MAX_RECORDS + 1)).all()
        workspaces.update(values)
    if len(workspaces) > MAX_RECORDS:
        fail(
            "requirement_proof_record_budget",
            "Too many runtime workspace relationships for the complete impact",
            413,
        )
    readable = set()
    for identity in sorted(workspaces, key=lambda value: value or ""):
        try:
            _access(store, user, project, identity)
            readable.add(identity)
        except HTTPException:
            pass
    signature = _filter_signature(
        [user.id if user else None, sorted(readable), sorted(workspaces, key=lambda value: value or "")]
    )
    result = dict(queries)
    restricted = {}
    for kind in ("execution", "deployment"):
        rows = queries[kind].subquery()
        original = count(db, queries[kind])
        filtered = select(rows).where(rows.c.workspace_id.in_(readable) if readable else false())
        result[kind] = filtered
        restricted["restricted_" + kind] = original - count(db, filtered)
    return result, restricted, signature


def budget_counts(db, queries):
    counts = {}
    for kind, query in queries.items():
        counts[kind] = count(db, query)
        task_count = counts.get("direct_task", 0) + counts.get("dependent_task", 0)
        if task_count > MAX_RECORDS or counts[kind] > MAX_RECORDS:
            fail(
                "requirement_proof_record_budget",
                "The complete impact exceeds its explicit relationship budget",
                413,
            )
    budget = RequirementReadBudget(
        task_count=counts["direct_task"] + counts["dependent_task"],
        execution_count=counts["execution"],
        release_candidate_count=counts["release_candidate"],
        deployment_count=counts["deployment"],
    ).model_dump()
    return budget


def selected_context(db, project, identity, generation, user, store):
    stamp, _, derived = context(db, project, identity, generation)
    validate_sources(db, project)
    queries = relation_queries(project, identity)
    budget = budget_counts(db, queries)
    visible, restricted, signature = acl(db, project, queries, user, store)
    counts = {kind: count(db, query) for kind, query in visible.items()}
    counts.update(restricted)
    return stamp, derived, queries, visible, counts, budget, signature


def impact_summary(db, project, identity, generation=None, *, user, store=None):
    stamp, _, derived = context(db, project, identity, generation)
    try:
        stamp, derived, _, _, counts, budget, _ = selected_context(
            db, project, identity, generation, user, store
        )
        result = dict(available=True, complete=True, counts=counts, budget=budget, reasons=[])
    except HTTPException as exc:
        if (
            exc.status_code not in (409, 413)
            or not isinstance(exc.detail, dict)
            or exc.detail.get("code") == "delivery_query_cursor_stale"
        ):
            raise
        result = dict(
            available=False,
            complete=False,
            counts=None,
            budget=RequirementReadBudget().model_dump(),
            reasons=[exc.detail],
        )
    _unchanged(db, project, stamp)
    return {**envelope(db, project, identity, stamp), "requirement_basis": derived["basis"], **result}


def item_view(kind, row):
    target_kind = "task" if kind in ("direct_task", "dependent_task") else kind
    title = row["title"][:256] if isinstance(row["title"], str) else None
    status = row["status"][:256] if isinstance(row["status"], str) else None
    return {
        "id": row["id"],
        "kind": kind,
        "title": title,
        "status": status,
        "target": {"kind": target_kind, "id": row["id"], "label": title, "available": True, "reason": None},
    }


def impact_page(db, project, identity, kind, generation, *, user, store=None, limit=20, cursor=""):
    stamp, derived, _, queries, counts, _, acl_signature = selected_context(
        db, project, identity, generation, user, store
    )
    signature = [
        project.tenant_id,
        project.id,
        user.id,
        identity,
        "requirement_impact",
        kind,
        limit,
        derived["basis"],
        acl_signature,
    ]
    after = ""
    if cursor:
        upper, position = decode_cursor(cursor, signature)
        if upper != [generation] or len(position) != 1 or not isinstance(position[0], str):
            fail("delivery_query_cursor_stale", "Impact relationship generation changed")
        after = position[0]
    rows = queries[kind].subquery()
    page = (
        db.execute(select(rows).where(rows.c.id > after).order_by(rows.c.id).limit(limit + 1))
        .mappings()
        .all()
    )
    following = encode_cursor(signature, [generation], [page[limit - 1]["id"]]) if len(page) > limit else None
    _unchanged(db, project, stamp)
    return {
        **envelope(db, project, identity, stamp),
        "requirement_basis": derived["basis"],
        "kind": kind,
        "items": [item_view(kind, row) for row in page[:limit]],
        "total": counts[kind],
        "limit": limit,
        "next_cursor": following,
    }


def impact_detail(db, project, identity, kind, item_id, generation, *, user, store=None):
    valid_id(item_id, 64 if kind in ("direct_task", "dependent_task") else 200)
    stamp, derived, _, queries, _, _, _ = selected_context(db, project, identity, generation, user, store)
    rows = queries[kind].subquery()
    row = db.execute(select(rows).where(rows.c.id == item_id)).mappings().first()
    if row is None:
        fail(
            "requirement_impact_item_missing",
            "This readable object is not in the current requirement impact",
            404,
        )
    _unchanged(db, project, stamp)
    return {
        **envelope(db, project, identity, stamp),
        "requirement_basis": derived["basis"],
        "kind": kind,
        "item": item_view(kind, row),
    }
