"""Read current attention facts with SQL audience, counts, and signed keyset pages."""

from datetime import datetime, timezone

from sqlalchemy import String, and_, case, cast, func, literal, or_, select

from .delivery_activity_cursor import decode_cursor, encode_cursor
from .delivery_inbox import CATEGORIES
from .delivery_query_index import scope
from .delivery_query_read import _stamp, _unchanged, fail, metadata
from .sql_models import DeliveryQueryFact


def _now():
    return datetime.now(timezone.utc)


def _audience(user, can_approve, scope_kind):
    data = DeliveryQueryFact.data
    flags = {name: data[name].as_boolean().is_(True) for name in CATEGORIES}
    if scope_kind == "team":
        return flags
    own = "user:" + user.id
    personal = data["mine_owner_id"].as_string() == own
    requirement_personal = data["mine_requirement_owner_id"].as_string() == own
    issue = data["item"]["kind"].as_string() == "issue"
    return {
        "work": and_(flags["work"], personal),
        "approval": and_(flags["approval"], literal(can_approve)),
        "acceptance": and_(flags["acceptance"], or_(personal, requirement_personal, literal(can_approve))),
        "blocked": and_(flags["blocked"], or_(personal, and_(issue, requirement_personal))),
    }


def inbox_page(db, project, user, *, can_approve, scope_kind="mine", category="all", limit=20, cursor=""):
    if scope_kind not in {"mine", "team"} or category not in {"all", "overdue", *CATEGORIES}:
        fail("delivery_inbox_filter_invalid", "Choose an inbox scope and category.", 422)
    if type(limit) is not int or not 1 <= limit <= 100:
        fail("delivery_inbox_filter_invalid", "Choose a page size from 1 to 100.", 422)
    stamp = _stamp(db, project)
    instant = _now().astimezone(timezone.utc)
    today = instant.date().isoformat()
    flags = _audience(user, can_approve, scope_kind)
    visible = or_(*flags.values())
    overdue = and_(DeliveryQueryFact.due_on.is_not(None), DeliveryQueryFact.due_on < today)
    filters = (*scope(project, DeliveryQueryFact), DeliveryQueryFact.kind == "inbox", visible)
    aggregates = [
        func.coalesce(func.sum(case((value, 1), else_=0)), 0).label(name) for name, value in flags.items()
    ]
    counts = dict(
        db.execute(
            select(
                *aggregates,
                func.coalesce(func.sum(case((overdue, 1), else_=0)), 0).label("overdue"),
                func.count().label("total"),
            ).where(*filters)
        )
        .mappings()
        .one()
    )
    selected = overdue if category == "overdue" else flags.get(category, literal(True))
    total = counts["total"] if category == "all" else counts[category]
    rank = case((flags["blocked"], "0"), (flags["acceptance"], "1"), (flags["approval"], "2"), else_="3")
    sort_key = (
        cast(case((overdue, "0"), else_="1"), String)
        + literal("|")
        + DeliveryQueryFact.data["priority_rank"].as_string()
        + literal("|")
        + rank
        + literal("|")
        + func.coalesce(DeliveryQueryFact.due_on, "9999-12-31")
        + literal("|")
        + DeliveryQueryFact.entity_id
    )
    signature = [project.tenant_id, project.id, user.id, "inbox", scope_kind, category, limit]
    after = None
    if cursor:
        upper, after = decode_cursor(cursor, signature)
        if (
            len(upper) != 3
            or type(upper[0]) is not int
            or not isinstance(upper[1], str)
            or type(upper[2]) is not bool
            or len(after) != 1
            or not isinstance(after[0], str)
        ):
            fail("delivery_query_cursor_invalid", "Malformed inbox cursor.", 422)
        if upper != [stamp["generation"], today, bool(can_approve)]:
            fail(
                "delivery_query_cursor_stale",
                "Inbox facts, permission or UTC date changed. Reload the first page.",
            )
    query = select(
        DeliveryQueryFact.data,
        sort_key.label("sort_key"),
        overdue.label("overdue"),
        *(value.label(name) for name, value in flags.items()),
    ).where(*filters, selected)
    if after:
        query = query.where(sort_key > after[0])
    page = db.execute(query.order_by(sort_key).limit(limit + 1)).mappings().all()
    items = []
    for row in page[:limit]:
        item = dict(row["data"]["item"])
        item["categories"] = [name for name in CATEGORIES if row[name]]
        item["overdue"] = bool(row["overdue"])
        items.append(item)
    _unchanged(db, project, stamp)
    has_more = len(page) > limit
    return {
        **metadata(db, project, stamp),
        "scope": scope_kind,
        "category": category,
        "current_user_id": user.id,
        "as_of": instant.isoformat().replace("+00:00", "Z"),
        "counts": counts,
        "items": items,
        "total": total,
        "limit": limit,
        "has_more": has_more,
        "next_cursor": encode_cursor(
            signature, [stamp["generation"], today, bool(can_approve)], [page[limit - 1]["sort_key"]]
        )
        if has_more
        else None,
    }
