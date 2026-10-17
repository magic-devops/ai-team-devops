"""Pure daily comparisons of explicit reservations against explicit calendars.

Unverified owners without any valid own reservation remain unregistered. Complete
task dates constrain that warning to their inclusive interval; a single date
constrains the known side. Undated or malformed dates conservatively warn across
the query window. A valid reservation need not fill every task date: deliberately
unreserved days are not inferred work. Past dates never move to ``today``.

Stored invalid segments are ignored, never converted to the current resource's
unit. Their possible dates remain incomplete. Inactive resources with provable
units retain explicit reservations but have unknown capacity. Only effective
``verified is True`` releases activity; raw completed status is insufficient.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta
from math import isfinite


def _date(value):
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if not isinstance(value, str) or len(value) != 10 or value[4] != "-" or value[7] != "-":
        return None
    if not (value[:4] + value[5:7] + value[8:]).isascii():
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.isoformat() == value else None


def _quantity(value, unit, *, zero=False):
    if unit not in {"hours", "slots"} or isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    upper = 24 if unit == "hours" else 100
    if not (0 <= value <= upper) or (not zero and value == 0) or not isfinite(value):
        return None
    step = value * 2 if unit == "hours" else value
    return value if step == int(step) else None


def _has_weekday(starts_on, ends_on, weekdays):
    return any((day - starts_on.weekday()) % 7 <= (ends_on - starts_on).days for day in weekdays)


def _segment(raw, task, resource):
    """Normalize a provable segment, independent of the selected query window."""
    if not isinstance(raw, dict) or not resource or raw.get("unit") != resource.get("unit"):
        return None
    starts_on, ends_on = _date(raw.get("starts_on")), _date(raw.get("ends_on"))
    task_start, task_end = _date(task.get("starts_on")), _date(task.get("ends_on"))
    weekdays = raw.get("weekdays")
    quantity = _quantity(raw.get("quantity_per_day"), resource.get("unit"))
    if not starts_on or not ends_on or not task_start or not task_end:
        return None
    if not task_start <= starts_on <= ends_on <= task_end or quantity is None:
        return None
    if (
        not isinstance(weekdays, list)
        or not weekdays
        or any(type(day) is not int or not 0 <= day <= 6 for day in weekdays)
        or len(set(weekdays)) != len(weekdays)
        or not _has_weekday(starts_on, ends_on, weekdays)
    ):
        return None
    return {
        "member_id": raw["member_id"],
        "starts_on": starts_on,
        "ends_on": ends_on,
        "weekdays": set(weekdays),
        "quantity": quantity,
    }


def _overlap(left, right):
    starts_on = max(left["starts_on"], right["starts_on"])
    ends_on = min(left["ends_on"], right["ends_on"])
    return (
        left["member_id"] == right["member_id"]
        and starts_on <= ends_on
        and _has_weekday(starts_on, ends_on, left["weekdays"] & right["weekdays"])
    )


def _possible_days(raw, days):
    """Malformed endpoints cannot prove that a date is free of unknown demand."""
    if isinstance(raw, dict):
        starts_on, ends_on = _date(raw.get("starts_on")), _date(raw.get("ends_on"))
        if starts_on and ends_on and starts_on <= ends_on:
            return [day for day in days if starts_on <= day <= ends_on]
    return days


def _unregistered_days(task, days):
    starts_on, ends_on = _date(task.get("starts_on")), _date(task.get("ends_on"))
    if (task.get("starts_on") and not starts_on) or (task.get("ends_on") and not ends_on):
        return days
    if starts_on and ends_on and starts_on > ends_on:
        return days
    return [day for day in days if (not starts_on or day >= starts_on) and (not ends_on or day <= ends_on)]


def _calendar(resource):
    unit, raw = resource.get("unit"), resource.get("calendar")
    if resource.get("active") is not True or unit not in {"hours", "slots"} or not isinstance(raw, dict):
        return [None] * 7, {}
    weekly = raw.get("weekly")
    if not isinstance(weekly, list) or len(weekly) != 7:
        weekly = [None] * 7
    weekly = [_quantity(value, unit, zero=True) for value in weekly]
    exceptions = raw.get("exceptions", [])
    if not isinstance(exceptions, list):
        return [None] * 7, {}
    overrides = {}
    for entry in exceptions:
        day = _date(entry.get("date")) if isinstance(entry, dict) else None
        if day is None:
            weekly = [None] * 7
            continue
        # A corrupt duplicate has no reliable precedence.
        overrides[day] = None if day in overrides else _quantity(entry.get("available"), unit, zero=True)
    return weekly, overrides


def _new_cells(resource, days):
    weekly, exceptions = _calendar(resource)
    result = {}
    for day in days:
        available = exceptions.get(day, weekly[day.weekday()])
        result[day] = {
            "date": day.isoformat(),
            "available": available,
            "active_load": 0,
            "total_reserved": 0,
            "overload": None if available is None else 0,
            "unavailable": False,
            "unregistered_count": 0,
            "incomplete": available is None,
            "contributions": [],
        }
    return result


def _task_segments(task, roster, by_resource, days):
    valid = []
    allocations = task.get("allocations")
    if not isinstance(allocations, list):
        allocations = []
    for raw in allocations:
        member_id = raw.get("member_id") if isinstance(raw, dict) else None
        member = roster.get(member_id) if isinstance(member_id, str) else None
        segment = _segment(raw, task, member)
        if segment is not None:
            valid.append((raw, segment))
        elif member is not None:
            for day in _possible_days(raw, days):
                by_resource[member_id][day]["incomplete"] = True
    conflicted = {
        index
        for index, (_, segment) in enumerate(valid)
        if any(index != other and _overlap(segment, candidate) for other, (_, candidate) in enumerate(valid))
    }
    for index in conflicted:
        raw, segment = valid[index]
        for day in _possible_days(raw, days):
            by_resource[segment["member_id"]][day]["incomplete"] = True
    return [segment for index, (_, segment) in enumerate(valid) if index not in conflicted]


def _add_task(task, segments, by_resource, days):
    active = task.get("verified") is not True
    for segment in segments:
        for day in days:
            if (
                not segment["starts_on"] <= day <= segment["ends_on"]
                or day.weekday() not in segment["weekdays"]
            ):
                continue
            cell = by_resource[segment["member_id"]][day]
            quantity = segment["quantity"]
            cell["total_reserved"] += quantity
            cell["active_load"] += quantity if active else 0
            cell["contributions"].append(
                {"task_id": task["id"], "title": task["title"], "quantity": quantity, "active": active}
            )
    owner = task.get("owner_id")
    if active and owner in by_resource and not any(segment["member_id"] == owner for segment in segments):
        for day in _unregistered_days(task, days):
            cell = by_resource[owner][day]
            cell["unregistered_count"] += 1
            cell["incomplete"] = True


def calculate_cells(resources, tasks, starts_on, ends_on, today=None):
    """Return detached resource rows with nine-field daily cells, without I/O.

    Dates are civil dates, supplied as strict ISO dates or ``date`` objects.
    ``today`` is deliberately irrelevant: overdue reservations remain on their
    recorded dates. All project tasks must be supplied, before UI filtering.
    """
    starts_on, ends_on = _date(starts_on), _date(ends_on)
    if not starts_on or not ends_on or ends_on < starts_on:
        raise ValueError("Choose an ordered civil-date range")
    days = [starts_on + timedelta(days=offset) for offset in range((ends_on - starts_on).days + 1)]
    roster = {resource["id"]: resource for resource in resources}
    by_resource = {identifier: _new_cells(resource, days) for identifier, resource in roster.items()}
    for task in tasks:
        segments = _task_segments(task, roster, by_resource, days)
        _add_task(task, segments, by_resource, days)
    result = []
    for resource in resources:
        row = deepcopy(resource)
        for cell in by_resource[resource["id"]].values():
            if cell["available"] is not None:
                cell["overload"] = max(0, cell["active_load"] - cell["available"])
                cell["unavailable"] = cell["available"] == 0 and cell["active_load"] > 0
        row["cells"] = list(by_resource[resource["id"]].values())
        result.append(row)
    return result
