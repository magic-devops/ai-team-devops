"""Exact SQL projections of the single canonical immutable progress originals."""

import json

from fastapi import HTTPException
from sqlalchemy import Integer, LargeBinary, case, cast, func, or_, select, true

from . import sql_models as m
from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_progress_baseline import timestamp
from .delivery_progress_contract import ProgressReadBudget
from .delivery_progress_facts import STATUSES
from .delivery_service import stamp

MAX_ITEM_BYTES = 1024 * 1024
TASK_SUMMARY_FIELDS = ("id", "title", "req_id", "sprint_id", "milestone_id", "owner_id", "assigned_to",
    "estimate", "starts_on", "ends_on", "basis", "status", "recorded_status")
REQUIREMENT_FIELDS = ("id", "title", "milestone_id", "sprint_id", "stage", "revision", "basis", "accepted", "released")


def fail(code, message, status=409):
    raise HTTPException(status, {"code": code, "message": message})


def sqlite_only(db):
    if db.bind.dialect.name != "sqlite":
        fail("progress_storage_unavailable", "This storage cannot yet verify bounded canonical progress snapshots", 503)


def scope_filter(project, model):
    return model.tenant_id == project.tenant_id, model.project_id == project.id


def field(items, name):
    return case((items.c.type == "object", func.json_extract(items.c.value, '$.' + json.dumps(name))), else_=None)


def field_type(items, name):
    return case((items.c.type == "object", func.json_type(items.c.value, '$.' + json.dumps(name))), else_=None)


def invalid_fact(value, collection, *, identity=None, current=False):
    """Presence and JSON types matter: an unknown boolean is never false."""
    required = ("id", "title", "req_id", "sprint_id", "milestone_id", "owner_id", "assigned_to", "basis", "status", "recorded_status") if collection == "tasks" else (
        "id", "title", "milestone_id", "sprint_id", "stage", "basis")
    invalid = [func.json_type(value) != "object"]
    for name in required:
        invalid.append(func.coalesce(func.json_type(value, '$.' + name) != "text", True))
    invalid.append(func.json_extract(value, '$.id') == "")
    if identity is not None:
        invalid.append(func.coalesce(func.json_extract(value, '$.id') != identity, True))
    if collection == "tasks":
        invalid.append(func.coalesce(func.json_extract(value, '$.status').not_in(STATUSES), True))
        for name in ("estimate", "starts_on", "ends_on"):
            invalid.append(func.coalesce(func.json_type(value, '$.' + name).not_in(("text", "null")), True))
        for name, expected in (("allocations", "array"), ("acceptance_criteria", "array"),
                ("requirement_criteria_indices", "array"), ("acceptance", "object")):
            invalid.append(func.coalesce(func.json_type(value, '$.' + name) != expected, True) if current else
                func.coalesce(func.json_type(value, '$.' + name).not_in((expected, "null")), False))
    else:
        invalid.extend(func.coalesce(func.json_type(value, '$.' + name).not_in(("true", "false")), True) for name in ("accepted", "released"))
        invalid.append(func.coalesce(func.json_type(value, '$.revision') != "integer", True))
    return or_(*invalid)


def array(model, collection, name="progress_items"):
    return func.json_each(model.data, '$.' + json.dumps(collection)).table_valued("key", "value", "type").alias(name)


def scope_condition(items, selected):
    return field(items, "milestone_id" if selected["kind"] == "milestone" else "sprint_id") == selected["id"]


def source_query(project, kind, identity):
    model = m.DeliveryProgressBaseline if kind == "baseline" else m.DeliveryProgressObservation
    return model, (*scope_filter(project, model), model.id == identity)


def source(db, project, kind, identity, *, scope="project", scope_id=""):
    sqlite_only(db)
    if kind not in {"observation", "baseline"}:
        fail("progress_source_invalid", "Choose an observation or baseline", 422)
    if kind == "observation" and (scope not in {"project", "milestone", "sprint"}
            or (scope == "project" and scope_id) or (scope != "project" and not scope_id)):
        fail("progress_scope_invalid", "Choose project without an ID or a named milestone/sprint", 422)
    model, filters = source_query(project, kind, identity)
    common = [model.id, model.source_version,
        func.json_type(model.data, '$.tasks').label("tasks_type"),
        func.json_type(model.data, '$.requirements').label("requirements_type")]
    if kind == "baseline":
        columns = [*common, model.basis.label("snapshot_basis"), model.title, model.starts_on, model.ends_on,
            model.created_at, model.created_by, model.note, model.scope_kind, model.scope_id,
            func.json_type(model.data, '$.scope').label("scope_type"),
            model.data["scope"]["kind"].as_string().label("frozen_scope_kind"),
            model.data["scope"]["id"].as_string().label("frozen_scope_id"),
            model.data["scope"]["label"].as_string().label("frozen_scope_label"),
            func.json_type(model.data, '$.task_ids').label("ids_type")]
    else:
        columns = [*common, model.fingerprint.label("snapshot_basis"), model.observed_at, model.observed_day,
            model.source, model.actor, model.data["project"]["id"].as_string().label("original_project_id"),
            model.data["project"]["name"].as_string().label("project_name")]
    row = db.execute(select(*columns).where(*filters)).mappings().first()
    if row is None:
        fail("progress_source_missing", "The exact progress original was not found in this project", 404)
    row = dict(row)
    row.update(kind=kind, model=model, filters=filters, available=True, reasons=[])
    if row["tasks_type"] != "array" or row["requirements_type"] != "array":
        row["available"] = False
    if kind == "baseline":
        selected = {"kind": row["frozen_scope_kind"], "id": row["frozen_scope_id"], "label": row["frozen_scope_label"]}
        if (row["scope_type"] != "object" or selected.get("kind") != row["scope_kind"]
                or selected.get("id") != row["scope_id"] or not isinstance(selected.get("label"), str)
                or row["ids_type"] != "array"):
            row["available"] = False
            selected = {"kind": row["scope_kind"], "id": row["scope_id"], "label": row["scope_id"] or project.id}
    elif scope == "project":
        selected = {"kind": "project", "id": "", "label": row["project_name"] or project.id}
        if row["original_project_id"] != project.id or not isinstance(row["project_name"], str):
            row["available"] = False
    else:
        if scope not in {"milestone", "sprint"} or not scope_id:
            fail("progress_scope_invalid", "Choose a named milestone or sprint", 422)
        collection = "milestones" if scope == "milestone" else "sprints"
        scopes = func.json_each(model.data, '$.scopes.' + collection).table_valued("key", "value", "type").alias("historical_scopes")
        values = db.execute(select(field(scopes, "title")).select_from(model).join(scopes, true())
            .where(*filters, field(scopes, "id") == scope_id).limit(2)).all()
        if not values:
            fail("progress_scope_missing", "This scope was not recorded in the selected observation", 404)
        if len(values) != 1 or not isinstance(values[0][0], str):
            fail("progress_snapshot_unavailable", "The original scope cannot be verified")
        selected = {"kind": scope, "id": scope_id, "label": values[0][0]}
    row["scope"] = selected
    if not row["available"]:
        row["reasons"] = [{"code": "progress_snapshot_unavailable", "message": "Required original arrays or scope metadata are missing or invalid"}]
    return row


def checked(source):
    if not source["available"]:
        fail("progress_snapshot_unavailable", "Required original snapshot facts cannot be verified")


def items_query(source, collection, name="progress_items"):
    items = array(source["model"], collection, name)
    query = select().select_from(source["model"]).join(items, true()).where(*source["filters"])
    if source["kind"] == "observation" and source["scope"]["kind"] != "project":
        if collection == "tasks":
            query = query.where(scope_condition(items, source["scope"]))
        else:
            tasks = array(source["model"], "tasks", name + "_scope_tasks")
            parents = select(field(tasks, "req_id")).select_from(tasks).where(scope_condition(tasks, source["scope"]))
            query = query.where(or_(scope_condition(items, source["scope"]), field(items, "id").in_(parents)))
    return items, query


def validate_items(db, source, collection):
    checked(source)
    items, query = items_query(source, collection, "validate_" + collection)
    safe_value = case((items.c.type == "object", items.c.value), else_="null")
    invalid = invalid_fact(safe_value, collection)
    if db.scalar(query.with_only_columns(func.count()).where(invalid)):
        fail("progress_snapshot_unavailable", "Original items have missing or invalid identity or status")
    duplicate = query.with_only_columns(field(items, "id")).group_by(field(items, "id")).having(func.count() > 1).limit(1)
    if db.execute(duplicate).first():
        fail("progress_snapshot_unavailable", "Original item identities are ambiguous")


def validate_baseline_ids(db, source):
    if source["kind"] != "baseline":
        return
    model = source["model"]
    ids = array(model, "task_ids", "frozen_identity_set")
    query = select(ids.c.value).select_from(model).join(ids, true()).where(*source["filters"])
    if db.execute(query.where(or_(ids.c.type != "text", ids.c.value == "")).limit(1)).first():
        fail("progress_snapshot_unavailable", "Original task identities have invalid types")
    if db.execute(query.group_by(ids.c.value).having(func.count() > 1).limit(1)).first():
        fail("progress_snapshot_unavailable", "Original task identities are ambiguous")
    tasks, tq = items_query(source, "tasks", "frozen_identity_tasks")
    actual = tq.with_only_columns(field(tasks, "id"))
    if db.execute(query.except_(actual).limit(1)).first() or db.execute(actual.except_(query).limit(1)).first():
        fail("progress_snapshot_unavailable", "Original task identities do not match their frozen facts")


def counts_metrics(db, source):
    for collection in ("tasks", "requirements"):
        validate_items(db, source, collection)
    validate_baseline_ids(db, source)
    tasks, tq = items_query(source, "tasks", "metric_tasks")
    counts = dict(db.execute(tq.with_only_columns(field(tasks, "status"), func.count()).group_by(field(tasks, "status"))).all())
    requirements, rq = items_query(source, "requirements", "metric_requirements")
    req = db.execute(rq.with_only_columns(func.count(), func.coalesce(func.sum(case((field(requirements, "accepted") == 1, 1), else_=0)), 0),
        func.coalesce(func.sum(case((field(requirements, "released") == 1, 1), else_=0)), 0))).one()
    status = {name: counts.get(name, 0) for name in STATUSES}
    total = sum(status.values())
    return {"tasks_total": total, "recorded_completed": status["recorded_completed"],
        "verified_completed": status["verified_completed"], "awaiting_review": status["awaiting_review"],
        "remaining": total - status["verified_completed"], "requirements_total": req[0],
        "requirements_accepted": req[1], "requirements_released": req[2], "status_counts": status}


def baseline_metadata(db, source):
    metrics = None
    if source["available"]:
        try:
            metrics = counts_metrics(db, source)
        except HTTPException as exc:
            if exc.status_code != 409:
                raise
            source["available"], source["reasons"] = False, [exc.detail]
    return {"id": source["id"], "title": source["title"], "scope": source["scope"], "basis": source["snapshot_basis"],
        "starts_on": source["starts_on"], "ends_on": source["ends_on"], "created_at": timestamp(source["created_at"]),
        "created_by": source["created_by"], "source_version": source["source_version"], "note": source["note"],
        "task_count": metrics["tasks_total"] if metrics else None, "requirement_count": metrics["requirements_total"] if metrics else None,
        "metrics": metrics, "available": source["available"], "reasons": source["reasons"]}


def metadata(db, project, kind, identity, *, scope="project", scope_id=""):
    original = source(db, project, kind, identity, scope=scope, scope_id=scope_id)
    if kind == "baseline":
        value = baseline_metadata(db, original)
    else:
        metrics = None
        if original["available"]:
            try:
                metrics = counts_metrics(db, original)
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise
                original["available"], original["reasons"] = False, [exc.detail]
        value = {"id": original["id"], "observed_at": timestamp(original["observed_at"]), "observed_day": original["observed_day"],
            "source": original["source"], "actor": original["actor"], "source_version": original["source_version"],
            "snapshot_basis": original["snapshot_basis"], "scope": original["scope"], "metrics": metrics,
            "task_count": metrics["tasks_total"] if metrics else None, "requirement_count": metrics["requirements_total"] if metrics else None,
            "available": original["available"], "reasons": original["reasons"]}
    return {"project_id": project.id, "as_of": stamp(), kind: value}


def envelope(project, original, at=None):
    return {"project_id": project.id, "as_of": at or stamp(), "source_kind": original["kind"], "source_id": original["id"],
        "snapshot_basis": original["snapshot_basis"], "scope": original["scope"]}


def snapshot_page(db, project, user, kind, identity, collection, *, scope="project", scope_id="", limit=20, cursor=""):
    if type(limit) is not int or not 1 <= limit <= 100 or collection not in {"tasks", "requirements"}:
        fail("progress_page_invalid", "Choose tasks or requirements with a page size between 1 and 100", 422)
    original = source(db, project, kind, identity, scope=scope, scope_id=scope_id)
    validate_items(db, original, collection)
    signature = [project.tenant_id, project.id, user.id, "progress-snapshot", kind, identity,
        original["snapshot_basis"], original["scope"], collection, limit]
    after, at = -1, stamp()
    if cursor:
        upper, following = decode_cursor(cursor, signature)
        if len(upper) != 1 or not isinstance(upper[0], str) or len(following) != 1 or type(following[0]) is not int or following[0] < 0:
            fail("progress_cursor_invalid", "Invalid frozen snapshot cursor", 422)
        at, after = upper[0], following[0]
    items, query = items_query(original, collection)
    total = db.scalar(query.with_only_columns(func.count()))
    fields = TASK_SUMMARY_FIELDS if collection == "tasks" else REQUIREMENT_FIELDS
    rows = db.execute(query.with_only_columns(cast(items.c.key, Integer).label("position"), *[field(items, name).label(name) for name in fields])
        .where(cast(items.c.key, Integer) > after).order_by(cast(items.c.key, Integer)).limit(limit + 1)).mappings().all()
    values = []
    for row in rows[:limit]:
        item = {name: row[name] for name in fields}
        if collection == "requirements":
            item.update(accepted=bool(item["accepted"]), released=bool(item["released"]))
        values.append(item)
    return {**envelope(project, original, at), "collection": collection, "items": values, "total": total, "limit": limit,
        "next_cursor": encode_cursor(signature, [at], [rows[limit - 1]["position"]]) if len(rows) > limit else None}


def snapshot_detail(db, project, kind, identity, collection, item_id, *, scope="project", scope_id=""):
    original = source(db, project, kind, identity, scope=scope, scope_id=scope_id)
    validate_items(db, original, collection)
    items, query = items_query(original, collection)
    match = query.where(field(items, "id") == item_id)
    size = db.scalar(match.with_only_columns(func.length(cast(items.c.value, LargeBinary))))
    if size is None:
        fail("progress_snapshot_item_missing", "The exact item was not found in this frozen scope", 404)
    if size > MAX_ITEM_BYTES:
        fail("progress_snapshot_item_too_large", "The original item exceeds its explicit read budget", 413)
    value = db.scalar(match.with_only_columns(items.c.value))
    item = json.loads(value) if isinstance(value, str) else value
    return {**envelope(project, original), "collection": collection, "item": item}


def empty_budget(**values):
    return ProgressReadBudget(**values).model_dump()
