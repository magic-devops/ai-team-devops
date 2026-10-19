"""Narrow SQL requirement heads and explicit, generation-bound original reads."""

import json
from types import SimpleNamespace

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import LargeBinary, cast, func, select, true

from . import sql_models as m
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_plan import requirement_snapshot
from .delivery_query_index import scope
from .delivery_query_read import _now, _stamp, _unchanged, metadata
from .delivery_requirement_contract import RequirementHead

MAX_ITEM_BYTES = 1048576


def fail(code, message, status=409):
    raise HTTPException(status, {"code": code, "message": message})


def sqlite_only(db):
    if db.bind.dialect.name != "sqlite":
        fail(
            "requirement_storage_unavailable", "This storage cannot verify bounded requirement originals", 503
        )


def valid_id(value, maximum=64):
    if (
        not isinstance(value, str)
        or not value
        or len(value) > maximum
        or value != value.strip()
        or "/" in value
        or "\\" in value
        or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in value)
    ):
        fail("requirement_id_invalid", "Use the exact nonempty resource ID", 422)
    return value


def path(*parts):
    return "$" + "".join(
        f"[{part}]" if isinstance(part, int) else "." + json.dumps(part, ensure_ascii=False) for part in parts
    )


def envelope(db, project, identity, stamp):
    return {**metadata(db, project, stamp), "requirement_id": identity, "as_of": _now()}


def context(db, project, identity, generation=None):
    valid_id(identity)
    sqlite_only(db)
    stamp = _stamp(db, project)
    if generation is not None and generation != stamp["generation"]:
        fail("delivery_query_cursor_stale", "Requirement query facts changed; reload the current head")
    row = (
        db.execute(
            select(
                m.Requirement.id,
                m.Requirement.title,
                m.Requirement.priority,
                m.Requirement.status,
                m.Requirement.sprint_id,
            ).where(*scope(project, m.Requirement), m.Requirement.id == identity)
        )
        .mappings()
        .first()
    )
    if row is None:
        fail("requirement_missing", "Requirement is no longer in this project", 404)
    data = db.scalar(
        select(m.DeliveryQueryFact.data).where(
            *scope(project, m.DeliveryQueryFact),
            m.DeliveryQueryFact.kind == "requirement",
            m.DeliveryQueryFact.entity_id == identity,
        )
    )
    if not isinstance(data, dict):
        fail("delivery_query_rebuild_required", "Current requirement facts require an explicit rebuild")
    return stamp, dict(row), data


def record_counts(db, project, identity):
    workspace = m.DeliveryWorkspace
    ensure_workspace_shape(db, project)
    columns = [
        func.json_type(workspace.data),
        func.json_type(workspace.data, path("flows")),
        func.json_type(workspace.data, path("flows", identity)),
    ]
    for collection in ("artifacts", "reviews", "releases"):
        columns += [
            func.json_type(workspace.data, path("flows", identity, collection)),
            func.json_array_length(workspace.data, path("flows", identity, collection)),
        ]
    result = db.execute(select(*columns).where(*scope(project, workspace))).first()
    if not result:
        return dict(artifacts=0, reviews=0, releases=0)
    if result[0] != "object" or result[1] not in (None, "object"):
        fail(
            "requirement_source_unavailable", "The original Workspace or flow container has an invalid shape"
        )
    if result[2] is None:
        return dict(artifacts=0, reviews=0, releases=0)
    if result[2] != "object" or any(result[index] != "array" for index in (3, 5, 7)):
        fail("requirement_source_unavailable", "The original requirement flow arrays cannot be verified")
    return dict(zip(("artifacts", "reviews", "releases"), (result[4], result[6], result[8]), strict=True))


def ensure_workspace_shape(db, project):
    workspace = m.DeliveryWorkspace
    valid = db.scalar(select(func.json_valid(workspace.data)).where(*scope(project, workspace)))
    if valid is None:
        return
    if not valid:
        fail("requirement_source_unavailable", "The canonical Workspace is not valid JSON")
    kinds = db.execute(
        select(func.json_type(workspace.data), func.json_type(workspace.data, path("flows"))).where(
            *scope(project, workspace)
        )
    ).first()
    if kinds[0] != "object" or kinds[1] not in (None, "object"):
        fail(
            "requirement_source_unavailable", "The canonical Workspace or flow container has an invalid shape"
        )


def head(db, project, identity, generation=None):
    stamp, row, data = context(db, project, identity, generation)
    try:
        flow = {**data["flow"], "gates": data["gates"], "record_counts": record_counts(db, project, identity)}
        value = RequirementHead.model_validate(
            {
                **row,
                "basis": data["basis"],
                "flow": flow,
                **{
                    key: data[key]
                    for key in (
                        "tasks_total",
                        "tasks_done",
                        "tasks_recorded_done",
                        "accepted",
                        "deployment_verified",
                    )
                },
            },
            strict=True,
        )
    except (KeyError, ValidationError, TypeError) as exc:
        fail("delivery_query_rebuild_required", "Current requirement head facts are unavailable")
        raise AssertionError from exc
    _unchanged(db, project, stamp)
    return {**envelope(db, project, identity, stamp), "requirement": value.model_dump(mode="json")}


def check_size(db, query, expression):
    size = db.scalar(
        query.with_only_columns(func.length(cast(expression, LargeBinary)), maintain_column_froms=True)
    )
    if size is not None and size > MAX_ITEM_BYTES:
        fail(
            "requirement_item_too_large",
            "This complete original exceeds the explicit single-item budget",
            413,
        )


def definition(db, project, identity, generation):
    stamp, _, derived = context(db, project, identity, generation)
    model = m.Requirement
    columns = [model.id, model.title, model.description, model.acceptance_criteria]
    query = select(*columns).where(*scope(project, model), model.id == identity)
    expression = func.json_object(
        "id",
        model.id,
        "title",
        model.title,
        "description",
        model.description,
        "acceptance_criteria",
        func.json(model.acceptance_criteria),
    )
    check_size(db, query, expression)
    row = db.execute(query).mappings().one()
    if row["acceptance_criteria"] is not None and (
        not isinstance(row["acceptance_criteria"], list)
        or any(not isinstance(item, str) for item in row["acceptance_criteria"])
    ):
        fail("requirement_source_unavailable", "The original definition shape cannot be verified")
    value = requirement_snapshot(SimpleNamespace(**row))
    from .delivery_service import _fingerprint

    if _fingerprint(value) != derived.get("basis"):
        fail("delivery_query_rebuild_required", "Requirement definition facts do not match their original")
    _unchanged(db, project, stamp)
    return {
        **envelope(db, project, identity, stamp),
        "requirement_basis": derived["basis"],
        "definition": value,
    }


def record_query(project, identity, collection):
    items = (
        func.json_each(m.DeliveryWorkspace.data, path("flows", identity, collection))
        .table_valued("key", "value", "type")
        .alias("requirement_records")
    )
    query = (
        select()
        .select_from(m.DeliveryWorkspace)
        .join(items, true())
        .where(*scope(project, m.DeliveryWorkspace))
    )
    return items, query


def records_page(db, project, identity, collection, generation, *, user, limit=20, cursor=""):
    stamp, _, derived = context(db, project, identity, generation)
    total = record_counts(db, project, identity)[collection]
    signature = [
        project.tenant_id,
        project.id,
        user.id,
        identity,
        "requirement_records",
        collection,
        limit,
        derived["basis"],
    ]
    after = -1
    if cursor:
        upper, position = decode_cursor(cursor, signature)
        if upper != [generation] or len(position) != 1 or type(position[0]) is not int or position[0] < 0:
            fail("delivery_query_cursor_stale", "The original record position or generation changed")
        after = position[0]
    items, query = record_query(project, identity, collection)
    fields = ("revision", "kind", "stage", "title", "result", "decision", "actor", "at", "stale")
    # JSON scalar projection bounds transport; full record bodies are never selected.
    columns = [items.c.key.label("position"), items.c.type.label("shape")]
    for name in fields:
        value = func.json_extract(items.c.value, path(name))
        columns.append((value if name in {"revision", "stale"} else func.substr(value, 1, 256)).label(name))
        columns.append(func.json_type(items.c.value, path(name)).label(name + "_type"))
    rows = (
        db.execute(
            query.with_only_columns(*columns)
            .where(items.c.key > after)
            .order_by(items.c.key)
            .limit(limit + 1)
        )
        .mappings()
        .all()
    )
    result = []
    for row in rows[:limit]:
        if row["shape"] != "object":
            fail("requirement_source_unavailable", "A recorded original is not an object")
        for name in fields:
            expected = (
                ("integer",) if name == "revision" else ("true", "false") if name == "stale" else ("text",)
            )
            if row[name + "_type"] not in (None, "null", *expected):
                fail("requirement_source_unavailable", "An original record scalar has an invalid JSON type")
        value = {name: row[name] for name in ("position", *fields)}
        if value["stale"] is not None:
            value["stale"] = bool(value["stale"])
        result.append(value)
    following = (
        encode_cursor(signature, [generation], [rows[limit - 1]["position"]]) if len(rows) > limit else None
    )
    _unchanged(db, project, stamp)
    return {
        **envelope(db, project, identity, stamp),
        "requirement_basis": derived["basis"],
        "collection": collection,
        "items": result,
        "total": total,
        "limit": limit,
        "next_cursor": following,
    }


def record_detail(db, project, identity, collection, position, generation):
    stamp, _, derived = context(db, project, identity, generation)
    record_counts(db, project, identity)
    items, query = record_query(project, identity, collection)
    query = query.where(items.c.key == position)
    check_size(db, query, items.c.value)
    row = db.execute(query.with_only_columns(items.c.type, items.c.value)).first()
    if row is None:
        fail("requirement_record_missing", "This original record position no longer exists", 404)
    if row[0] != "object":
        fail("requirement_source_unavailable", "The original record is not an object")
    value = json.loads(row[1])
    for name in ("revision", "kind", "stage", "title", "result", "decision", "actor", "at", "stale"):
        expected = int if name == "revision" else bool if name == "stale" else str
        if value.get(name) is not None and type(value[name]) is not expected:
            fail("requirement_source_unavailable", "An original record scalar has an invalid JSON type")
    _unchanged(db, project, stamp)
    return {
        **envelope(db, project, identity, stamp),
        "requirement_basis": derived["basis"],
        "collection": collection,
        "position": position,
        "record": value,
    }
