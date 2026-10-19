"""SQL semantic plan comparison of a fixed original and same-generation facts."""

import json

from sqlalchemy import LargeBinary, and_, case, cast, false, func, or_, select

from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_progress_current import (
    MAX_BYTES,
    MAX_ITEM_BYTES,
    MAX_TASKS,
    current_stamp,
    selected_scope,
    task_query,
)
from .delivery_progress_json import (
    baseline_metadata,
    empty_budget,
    fail,
    field,
    items_query,
    source,
)
from .delivery_query_read import _unchanged, metadata
from .delivery_service import stamp

FIELDS = ("title", "basis", "req_id", "sprint_id", "milestone_id", "owner_id", "estimate", "starts_on", "ends_on",
    "allocations", "acceptance_criteria", "requirement_criteria_indices", "acceptance")
UNKNOWN = ("allocations", "acceptance_criteria", "requirement_criteria_indices", "acceptance")
KINDS = {"added", "removed", "changed", "incomplete"}


def _json_equal(before, after, name):
    path = '$.' + json.dumps(name)
    left = func.json_tree(before, path).table_valued("fullkey", "type", "atom").alias("before_" + name)
    right = func.json_tree(after, path).table_valued("fullkey", "type", "atom").alias("after_" + name)

    def leaves(tree):
        kind = case((tree.c.type.in_(("integer", "real")), "number"), else_=tree.c.type)
        return select(tree.c.fullkey, kind, tree.c.atom).select_from(tree)

    # Stable JSON paths ignore object key order; array positions remain part of
    # each path. Compare both differences, including empty containers and null.
    return and_(~leaves(left).except_(leaves(right)).exists(), ~leaves(right).except_(leaves(left)).exists())


def _prepared(db, project, baseline_id, generation=None):
    original = source(db, project, "baseline", baseline_id)
    current = current_stamp(db, project, generation)
    selected, available = selected_scope(db, project, original["scope"]["kind"], original["scope"]["id"], fallback=original["scope"])
    header = baseline_metadata(db, original)
    envelope = {**metadata(db, project, current), "as_of": stamp(), "baseline_id": baseline_id,
        "baseline_basis": original["snapshot_basis"], "scope": original["scope"], "current_scope_available": available}
    budget = empty_budget()
    if not header["available"]:
        return envelope, current, None, budget, header["reasons"]
    items, before_query = items_query(original, "tasks", "baseline_plan_tasks")
    before = before_query.with_only_columns(field(items, "id").label("id"), items.c.value.label("value")).cte("before_plan")
    after_query = task_query(project, selected)
    if not available:
        after_query = after_query.where(false())
    after = after_query.cte("after_plan")
    counts_before = db.execute(select(func.count(), func.coalesce(func.sum(func.length(cast(before.c.value, LargeBinary))), 0),
        func.coalesce(func.max(func.length(cast(before.c.value, LargeBinary))), 0)).select_from(before)).one()
    counts_after = db.execute(select(func.count(), func.coalesce(func.sum(func.length(cast(after.c.data, LargeBinary))), 0),
        func.coalesce(func.max(func.length(cast(after.c.data, LargeBinary))), 0)).select_from(after)).one()
    budget.update(task_count=max(counts_before[0], counts_after[0]), closure_task_count=counts_after[0],
        requirement_count=header["requirement_count"], bytes_used=counts_before[1] + counts_after[1])
    if max(counts_before[0], counts_after[0]) > MAX_TASKS or budget["bytes_used"] > MAX_BYTES or max(counts_before[2], counts_after[2]) > MAX_ITEM_BYTES:
        return envelope, current, None, budget, [{"code": "progress_comparison_budget", "message": "The complete comparison exceeds its fixed proof budget"}]
    identities = select(before.c.id).union(select(after.c.entity_id.label("id"))).cte("plan_ids")
    shared = and_(before.c.id.is_not(None), after.c.entity_id.is_not(None))
    unknowns = {name: and_(shared, or_(func.json_type(before.c.value, '$.' + json.dumps(name)).is_(None),
        func.json_type(before.c.value, '$.' + json.dumps(name)) == "null",
        func.json_type(after.c.data, '$.' + json.dumps(name)).is_(None),
        func.json_type(after.c.data, '$.' + json.dumps(name)) == "null")) for name in UNKNOWN}
    changes = {name: and_(shared, ~unknowns.get(name, false()), ~_json_equal(before.c.value, after.c.data, name)) for name in FIELDS}
    changed, incomplete = or_(*changes.values()), or_(*unknowns.values())
    query = select(identities.c.id, before.c.value.label("before_value"), after.c.data.label("after_value"),
        func.json_extract(before.c.value, '$.title').label("before_title"),
        func.json_extract(after.c.data, '$.title').label("after_title"),
        before.c.id.is_(None).label("added"), after.c.entity_id.is_(None).label("removed"),
        changed.label("changed"), incomplete.label("incomplete"), and_(shared, ~changed, ~incomplete).label("unchanged"),
        *[value.label("changed_" + name) for name, value in changes.items()],
        *[value.label("unknown_" + name) for name, value in unknowns.items()]
    ).select_from(identities).outerjoin(before, before.c.id == identities.c.id).outerjoin(after, after.c.entity_id == identities.c.id).cte("classified_plan")
    return envelope, current, query, budget, []


def comparison_summary(db, project, baseline_id, *, query_generation=None):
    envelope, current, query, budget, reasons = _prepared(db, project, baseline_id, query_generation)
    counts, unknown = None, []
    if query is not None:
        names = ("added", "removed", "changed", "incomplete", "unchanged")
        row = db.execute(select(*[func.coalesce(func.sum(case((query.c[name], 1), else_=0)), 0).label(name) for name in names],
            *[func.coalesce(func.max(case((query.c["unknown_" + name], 1), else_=0)), 0).label("unknown_" + name) for name in UNKNOWN]).select_from(query)).mappings().one()
        counts = {name: row[name] for name in names}
        unknown = sorted(name for name in UNKNOWN if row["unknown_" + name])
    _unchanged(db, project, current)
    return {**envelope, "available": query is not None, "complete": query is not None, "counts": counts,
        "incomplete_plan_fields": unknown, "budget": budget, "reasons": reasons}


def _checked_query(db, project, baseline_id, kind, generation):
    if kind not in KINDS:
        fail("progress_comparison_kind_invalid", "Choose added, removed, changed or incomplete", 422)
    envelope, current, query, _, _ = _prepared(db, project, baseline_id, generation)
    if query is None:
        fail("progress_comparison_unavailable", "The complete comparison is unavailable within its budget")
    return envelope, current, query


def _item(row):
    return {"id": row["id"], "title": row["after_title"] or row["before_title"], "before_title": row["before_title"],
        "after_title": row["after_title"], "fields": sorted(name for name in FIELDS if row["changed_" + name]),
        "incomplete_fields": sorted(name for name in UNKNOWN if row["unknown_" + name])}


def comparison_page(db, project, user, baseline_id, *, kind="changed", limit=20, cursor="", query_generation=None):
    if type(limit) is not int or not 1 <= limit <= 100:
        fail("progress_page_invalid", "Choose a page size between 1 and 100", 422)
    envelope, current, query = _checked_query(db, project, baseline_id, kind, query_generation)
    signature = [project.tenant_id, project.id, user.id, "progress-comparison", baseline_id, envelope["baseline_basis"], envelope["scope"], kind, limit]
    at, after = envelope["as_of"], None
    if cursor:
        upper, last = decode_cursor(cursor, signature)
        if len(upper) != 2 or type(upper[0]) is not int or not isinstance(upper[1], str) or len(last) != 1 or not isinstance(last[0], str):
            fail("progress_cursor_invalid", "Invalid comparison cursor", 422)
        if upper[0] != current["generation"]:
            fail("delivery_query_cursor_stale", "Current progress changed; reload the comparison")
        at, after = upper[1], last[0]
    filtered = select(query).where(query.c[kind])
    total = db.scalar(select(func.count()).select_from(filtered.subquery()))
    columns = [column for column in query.c if column.key not in {"before_value", "after_value"}]
    page = select(*columns).where(query.c[kind])
    if after is not None:
        page = page.where(query.c.id > after)
    rows = db.execute(page.order_by(query.c.id).limit(limit + 1)).mappings().all()
    _unchanged(db, project, current)
    return {**envelope, "as_of": at, "kind": kind, "items": [_item(row) for row in rows[:limit]], "total": total, "limit": limit,
        "next_cursor": encode_cursor(signature, [current["generation"], at], [rows[limit - 1]["id"]]) if len(rows) > limit else None}


def comparison_detail(db, project, baseline_id, task_id, *, kind="changed", query_generation=None):
    envelope, current, query = _checked_query(db, project, baseline_id, kind, query_generation)
    match = and_(query.c.id == task_id, query.c[kind])
    size = db.scalar(select(func.coalesce(func.length(cast(query.c.before_value, LargeBinary)), 0)
        + func.coalesce(func.length(cast(query.c.after_value, LargeBinary)), 0)).where(match))
    if size is None:
        fail("progress_snapshot_item_missing", "The exact task was not found in this comparison category", 404)
    if size > MAX_ITEM_BYTES:
        fail("progress_snapshot_item_too_large", "The original comparison exceeds its explicit item budget", 413)
    row = db.execute(select(query).where(match)).mappings().one()
    value = _item(row)
    item = {key: value[key] for key in ("id", "fields", "incomplete_fields")}
    for name in ("before", "after"):
        body = row[name + "_value"]
        item[name] = json.loads(body) if isinstance(body, str) else body
    _unchanged(db, project, current)
    return {**envelope, "kind": kind, "item": item}
