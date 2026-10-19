"""SQL-paged canonical summaries and exact, narrow JSON-path detail reads."""

import hashlib
import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select

from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_contract import STAGES, default_flow
from .delivery_query_index import SCHEMA_VERSION, scope
from .delivery_resources import project_view
from .delivery_service import serialize
from .delivery_task_contract import delivery_task_definition
from .sql_models import DeliveryQueryFact, DeliveryQueryState, DeliveryWorkspace, Issue, Requirement, Task


def fail(code, message, status=409):
    raise HTTPException(status, {"code": code, "message": message})


def _stamp(db, project, *, required=True):
    row = (
        db.execute(select(DeliveryQueryState.__table__).where(*scope(project, DeliveryQueryState)))
        .mappings()
        .first()
    )
    if row is None or row["schema_version"] != SCHEMA_VERSION:
        if required:
            fail(
                "delivery_query_rebuild_required",
                "Current delivery query facts require an explicit authorized rebuild.",
            )
        return None
    return row


def metadata(db, project, stamp=None):
    version = (
        stamp["source_version"]
        if stamp
        else db.scalar(select(DeliveryWorkspace.version).where(*scope(project, DeliveryWorkspace)))
    ) or 0
    return {
        "project_id": project.id,
        "version": version,
        "query_generation": stamp["generation"] if stamp else None,
    }


def _unchanged(db, project, stamp):
    generation = db.scalar(select(DeliveryQueryState.generation).where(*scope(project, DeliveryQueryState)))
    if generation != stamp["generation"]:
        fail("delivery_query_cursor_stale", "Project query facts changed. Reload the first page.")


def _date(value):
    return value.isoformat() + "Z" if isinstance(value, datetime) else value


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _filter_signature(filters):
    encoded = json.dumps(filters, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def workspace_path(db, project, *path):
    """Never select the entire lifetime workspace JSON before projecting."""
    return db.scalar(select(DeliveryWorkspace.data[tuple(path)]).where(*scope(project, DeliveryWorkspace)))


def context(db, project, permissions):
    stamp = _stamp(db, project, required=False)
    result = {
        **metadata(db, project, stamp),
        "query_state": query_state(stamp),
        "project": project_view(project, {"project": workspace_path(db, project, "project") or {}}),
        "permissions": permissions,
        "stages": STAGES,
        "summary": stamp["summary"] if stamp else None,
        "metrics": stamp["metrics"] if stamp else None,
    }
    if stamp:
        _unchanged(db, project, stamp)
    return result


def query_state(stamp):
    return {
        "status": "ready" if stamp else "rebuild_required",
        "schema_version": SCHEMA_VERSION,
        "computed_at": _date(stamp["computed_at"]) if stamp else None,
    }


def _canonical_query(project, kind):
    model = {"requirement": Requirement, "task": Task, "issue": Issue}[kind]
    fields = {
        "requirement": ("id", "title", "priority", "status", "sprint_id", "created_at", "updated_at"),
        "task": (
            "id",
            "req_id",
            "title",
            "priority",
            "status",
            "owner_id",
            "estimate",
            "sprint_id",
            "created_at",
            "updated_at",
        ),
        "issue": ("id", "title", "severity", "status", "task_id", "type", "reported_by", "created_at"),
    }[kind]
    fact = DeliveryQueryFact
    query = (
        select(*(getattr(model, name) for name in fields), fact.data.label("query_data"))
        .join(
            fact,
            and_(
                fact.entity_id == model.id,
                fact.kind == kind,
                fact.tenant_id == model.tenant_id,
                fact.project_id == model.project_id,
            ),
        )
        .where(*scope(project, model))
    )
    return model, query


def _filters(query, model, filters, *, omit_stage=False):
    fact = DeliveryQueryFact
    values = {key: value for key, value in filters.items() if value and key not in {"sort", "kind", "ids"}}
    expressions = {
        "priority": getattr(model, "priority", None),
        "owner_id": fact.owner_id,
        "milestone_id": fact.milestone_id,
        "sprint_id": getattr(model, "sprint_id", None),
        "stage": fact.status,
        "status": fact.status,
        "severity": getattr(model, "severity", None),
        "task_id": getattr(model, "task_id", fact.parent_id),
    }
    for key, value in values.items():
        if key == "q":
            literal = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.where(model.title.ilike(f"%{literal}%", escape="\\"))
        elif key == "requirement_id":
            query = _requirement_filter(query, model, value)
        elif key == "source":
            sources = fact.data["source_kinds"].as_string()
            query = query.where(sources == "[]" if value == "other" else sources.contains(f'"{value}"'))
        elif key in expressions and not (omit_stage and key == "stage"):
            query = query.where(expressions[key] == value)
    return query


def _requirement_filter(query, model, requirement_id):
    if model is Task:
        return query.where(Task.req_id == requirement_id)
    if model is Issue:
        return query.where(
            Issue.task_id.in_(
                select(Task.id).where(
                    Task.tenant_id == Issue.tenant_id,
                    Task.project_id == Issue.project_id,
                    Task.req_id == requirement_id,
                )
            )
        )
    return query.where(model.id == requirement_id)


def _ordering(model, sort):
    choices = {
        "id_asc": (model.id, False),
        "id_desc": (model.id, True),
        "created_desc": (func.coalesce(model.created_at, datetime(1970, 1, 1)), True),
        "title_asc": (func.lower(model.title), False),
        "priority_asc": (getattr(model, "priority", model.id), False),
        "due_asc": (func.coalesce(DeliveryQueryFact.due_on, "9999-12-31"), False),
    }
    return choices[sort]


def _cursor_position(cursor, signature, stamp, sort):
    if not cursor:
        return None
    upper, after = decode_cursor(cursor, signature)
    if (
        len(upper) != 1
        or type(upper[0]) is not int
        or len(after) != 2
        or not all(isinstance(v, str) for v in after)
    ):
        fail("delivery_query_cursor_invalid", "Malformed query cursor.", 422)
    if upper[0] != stamp["generation"]:
        fail("delivery_query_cursor_stale", "Project query facts changed. Reload the first page.")
    if sort == "created_desc":
        try:
            after[0] = datetime.fromisoformat(after[0])
        except ValueError as exc:
            raise HTTPException(422, "Malformed date cursor") from exc
    return after


def _window(query, key, model_id, descending, after):
    if after:
        comparison = key < after[0] if descending else key > after[0]
        tie = model_id < after[1] if descending else model_id > after[1]
        query = query.where(or_(comparison, and_(key == after[0], tie)))
    order = (key.desc(), model_id.desc()) if descending else (key.asc(), model_id.asc())
    return query.order_by(*order)


def _summary(row, kind):
    value = {key: _date(item) for key, item in row.items() if key not in {"query_data", "__sort"}}
    derived = {
        key: item
        for key, item in row["query_data"].items()
        if key not in {"gates", "owner", "execution_gate"}
    }
    return {**value, **derived}


def entity_page(db, project, user, kind, filters, *, limit=20, cursor=""):
    stamp = _stamp(db, project)
    model, base = _canonical_query(project, kind)
    filtered = _filters(base, model, filters)
    sort = filters.get("sort") or "created_desc"
    signature = [project.tenant_id, project.id, user.id, kind, _filter_signature(filters), limit]
    after = _cursor_position(cursor, signature, stamp, sort)
    total = db.scalar(select(func.count()).select_from(filtered.subquery()))
    key, descending = _ordering(model, sort)
    query = _window(filtered.add_columns(key.label("__sort")), key, model.id, descending, after)
    page = db.execute(query.limit(limit + 1)).mappings().all()
    visible = page[:limit]
    following = None
    if len(page) > limit:
        position = [
            str(visible[-1]["__sort"].isoformat())
            if isinstance(visible[-1]["__sort"], datetime)
            else str(visible[-1]["__sort"]),
            visible[-1]["id"],
        ]
        following = encode_cursor(signature, [stamp["generation"]], position)
    result = {
        **metadata(db, project, stamp),
        "as_of": _now(),
        "items": [_summary(row, kind) for row in visible],
        "total": total,
        "next_cursor": following,
        "limit": limit,
    }
    if kind == "requirement":
        facets = _filters(base, model, filters, omit_stage=True)
        counts = _stage_counts(db, project, facets)
        result["facets"] = {"stages": counts}
    _unchanged(db, project, stamp)
    return result


def _stage_counts(db, project, query):
    ids = query.with_only_columns(Requirement.id).subquery()
    return dict(
        db.execute(
            select(DeliveryQueryFact.status, func.count())
            .where(
                *scope(project, DeliveryQueryFact),
                DeliveryQueryFact.kind == "requirement",
                DeliveryQueryFact.entity_id.in_(select(ids.c.id)),
            )
            .group_by(DeliveryQueryFact.status)
        ).all()
    )


def _exact(db, project, kind, entity_id):
    stamp = _stamp(db, project)
    model = {"requirement": Requirement, "task": Task}[kind]
    row = db.scalar(select(model).where(*scope(project, model), model.id == entity_id))
    if row is None:
        raise HTTPException(404, "Record not found in this project")
    data = db.scalar(
        select(DeliveryQueryFact.data).where(
            *scope(project, DeliveryQueryFact),
            DeliveryQueryFact.kind == kind,
            DeliveryQueryFact.entity_id == entity_id,
        )
    )
    if data is None:
        fail(
            "delivery_query_rebuild_required",
            "Current entity facts are unavailable; rebuild the query index.",
        )
    return stamp, row, data


def requirement_detail(db, project, entity_id):
    stamp, row, derived = _exact(db, project, "requirement", entity_id)
    flow = workspace_path(db, project, "flows", entity_id) or default_flow()
    value = {
        **serialize(row),
        **{key: item for key, item in derived.items() if key not in {"gates", "flow"}},
        "flow": {**flow, **derived["flow"], "gates": derived["gates"]},
    }
    _unchanged(db, project, stamp)
    return {**metadata(db, project, stamp), "requirement": value}


def task_detail(db, project, entity_id):
    stamp, row, derived = _exact(db, project, "task", entity_id)
    planning = workspace_path(db, project, "task_details", entity_id) or {}
    parent = (
        db.scalar(select(Requirement).where(*scope(project, Requirement), Requirement.id == row.req_id))
        if row.req_id
        else None
    )
    flow = (
        db.scalar(
            select(DeliveryQueryFact.data["flow"]).where(
                *scope(project, DeliveryQueryFact),
                DeliveryQueryFact.kind == "requirement",
                DeliveryQueryFact.entity_id == row.req_id,
            )
        )
        if parent
        else None
    )
    parent_value = serialize(parent) if parent else None
    task = {**serialize(row), **derived, "planning": planning}
    definition = delivery_task_definition(
        task,
        parent_value,
        planning,
        derived.get("owner"),
        {},
        requirement_revision=(flow or default_flow())["revision"],
    )
    task["acceptance"] = definition["acceptance"]
    _unchanged(db, project, stamp)
    return {
        **metadata(db, project, stamp),
        "task": task,
        "planning_basis": stamp["planning_basis"],
        "requirement": {"id": parent.id, "title": parent.title} if parent else None,
    }


def _reference_ids(raw):
    values = list(dict.fromkeys(raw.split(","))) if raw else []
    if len(values) > 100 or any(not value or len(value) > 100 for value in values):
        fail("delivery_query_ids_invalid", "Select at most 100 valid stable reference IDs.", 422)
    return values


def _reference_item(row, kind):
    data = {key: value for key, value in row["data"].items() if key != "position"}
    return {
        "id": row["entity_id"],
        "kind": kind,
        "label": row["label"],
        "task_count": data.get("task_count", 0),
        "data": data,
    }


def _selected_resources(db, project, rows):
    if not rows:
        return []
    columns = [
        DeliveryWorkspace.data[("resources", row["data"]["position"])].label(str(index))
        for index, row in enumerate(rows)
    ]
    selected = db.execute(select(*columns).where(*scope(project, DeliveryWorkspace))).mappings().first()
    items = []
    for index, row in enumerate(rows):
        item = _reference_item(row, "resource")
        resource = selected[str(index)] if selected else None
        if not resource or resource.get("id") != row["entity_id"]:
            fail("delivery_query_cursor_stale", "Resource changed. Reload its reference.")
        item["data"] = {
            key: resource.get(key)
            for key in (
                "id",
                "kind",
                "title",
                "description",
                "url",
                "ref",
                "archived",
                "created_at",
                "updated_at",
                "archived_at",
            )
        }
        items.append(item)
    return items


def reference_page(db, project, user, filters, *, limit=50, cursor="", store=None):
    kind = filters["kind"]
    if kind in {"task", "requirement"}:
        return _entity_references(db, project, user, filters, limit, cursor)
    stamp = _stamp(db, project)
    fact = DeliveryQueryFact
    query = select(fact.entity_id, fact.label, fact.data).where(*scope(project, fact), fact.kind == kind)
    runtime_scope = None
    if kind == "execution":
        query, runtime_scope = _execution_reference_scope(query, project, user, store)
    ids = _reference_ids(filters.get("ids", ""))
    if ids:
        query = query.where(fact.entity_id.in_(ids))
    if filters.get("q"):
        query = query.where(fact.label.icontains(filters["q"], autoescape=True))
    query = _reference_filters(query, filters)
    if filters.get("task_id"):
        query = query.where(fact.parent_id == filters["task_id"])
    if filters.get("requirement_id") and kind == "execution":
        query = query.where(
            fact.parent_id.in_(
                select(Task.id).where(*scope(project, Task), Task.req_id == filters["requirement_id"])
            )
        )
    signature = [
        project.tenant_id,
        project.id,
        user.id,
        "references",
        _filter_signature(filters),
        limit,
        runtime_scope,
    ]
    sort = filters.get("sort") or "id_asc"
    after = _cursor_position(
        cursor, signature, stamp, "execution_created_desc" if sort == "created_desc" else sort
    )
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    key = _reference_sort_key(sort)
    page = (
        db.execute(
            _window(
                query.add_columns(key.label("__sort")), key, fact.entity_id, sort == "created_desc", after
            ).limit(limit + 1)
        )
        .mappings()
        .all()
    )
    token = (
        encode_cursor(
            signature, [stamp["generation"]], [page[limit - 1]["__sort"], page[limit - 1]["entity_id"]]
        )
        if len(page) > limit
        else None
    )
    items = (
        _selected_resources(db, project, page[:limit])
        if ids and kind == "resource"
        else [_reference_item(row, kind) for row in page[:limit]]
    )
    _unchanged(db, project, stamp)
    return {
        **metadata(db, project, stamp),
        "as_of": _now(),
        "items": items,
        "total": total,
        "next_cursor": token,
        "limit": limit,
    }


def _reference_filters(query, filters):
    fact = DeliveryQueryFact
    if filters.get("member_kind"):
        query = query.where(fact.data["kind"].as_string() == filters["member_kind"])
    if filters.get("member_active") is not None:
        query = query.where(fact.data["active"].as_boolean() == filters["member_active"])
    if filters.get("resource_kind"):
        query = query.where(fact.data["kind"].as_string() == filters["resource_kind"])
    if filters.get("archived") is not None:
        query = query.where(fact.status == ("archived" if filters["archived"] else "active"))
    return query


def _reference_sort_key(sort):
    fact = DeliveryQueryFact
    if sort == "ends_asc":
        return func.coalesce(fact.due_on, "9999-12-31")
    if sort == "created_desc":
        return func.coalesce(fact.data["created_at"].as_string(), "")
    return fact.entity_id


def _execution_reference_scope(query, project, user, store):
    from .hermes_workspace import runtime_identity

    if not user or user.status != "active" or str(user.tenant_id) != str(project.tenant_id):
        raise HTTPException(403, "Current account cannot read runtime metadata")
    if store is None:
        raise HTTPException(503, "Execution runtime is not configured")
    principal = runtime_identity(user, store)
    if principal.tenant != project.tenant_id or "read" not in principal.permissions:
        raise HTTPException(403, "Runtime read permission required")
    if principal.workspace_ids is None:
        return query, "all"
    allowed = sorted(principal.workspace_ids)
    return query.where(DeliveryQueryFact.data["workspace_id"].as_string().in_(allowed)), _filter_signature(
        allowed
    )


def _entity_references(db, project, user, filters, limit, cursor):
    kind = filters["kind"]
    values = {
        "q": filters.get("q", ""),
        "sort": "id_asc",
        "requirement_id": filters.get("requirement_id", ""),
    }
    ids = _reference_ids(filters.get("ids", ""))
    if ids:
        return _selected_entity_references(db, project, user, filters, ids, limit, cursor)
    result = entity_page(db, project, user, kind, values, limit=limit, cursor=cursor)
    result.pop("facets", None)
    result["items"] = [
        {
            "kind": kind,
            "id": item["id"],
            "label": item["title"],
            "task_count": item.get("tasks_total", 0),
            "data": item,
        }
        for item in result["items"]
    ]
    return result


def _selected_entity_references(db, project, user, filters, ids, limit, cursor):
    stamp = _stamp(db, project)
    kind = filters["kind"]
    model, query = _canonical_query(project, kind)
    query = _filters(query.where(model.id.in_(ids)), model, filters)
    signature = [project.tenant_id, project.id, user.id, "references", _filter_signature(filters), limit]
    after = _cursor_position(cursor, signature, stamp, "id_asc")
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    if after:
        query = query.where(model.id > after[1])
    rows = db.execute(query.order_by(model.id).limit(limit + 1)).mappings().all()
    token = (
        encode_cursor(signature, [stamp["generation"]], [rows[limit - 1]["id"]] * 2)
        if len(rows) > limit
        else None
    )
    items = [_summary(row, kind) for row in rows[:limit]]
    _unchanged(db, project, stamp)
    return {
        **metadata(db, project, stamp),
        "as_of": _now(),
        "total": total,
        "limit": limit,
        "next_cursor": token,
        "items": [
            {
                "kind": kind,
                "id": item["id"],
                "label": item["title"],
                "task_count": item.get("tasks_total", 0),
                "data": item,
            }
            for item in items
        ],
    }


def execution_detail(db, project, user, entity_id, store):
    from .delivery_issue_evidence import _access

    stamp = _stamp(db, project)
    data = db.scalar(
        select(DeliveryQueryFact.data).where(
            *scope(project, DeliveryQueryFact),
            DeliveryQueryFact.kind == "execution",
            DeliveryQueryFact.entity_id == entity_id,
        )
    )
    if data is None:
        raise HTTPException(404, "Execution not found in this project")
    if store is None:
        raise HTTPException(503, "Execution store is unavailable")
    _access(store, user, project, data["workspace_id"])
    entry = workspace_path(db, project, "executions", data["position"])
    if not entry or entry.get("id") != entity_id:
        fail("delivery_query_cursor_stale", "Execution source changed. Reload the task.")
    _unchanged(db, project, stamp)
    return {**metadata(db, project, stamp), "execution": entry}
