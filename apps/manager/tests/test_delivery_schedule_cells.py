"""Capacity is explicit planning data, never an estimate converted into hours."""

from copy import deepcopy
from datetime import date

import pytest
from sop_manager.routers.delivery_schedule_cells import calculate_cells


def resource(identifier="user:lead", *, unit="hours", active=True, calendar=None):
    return {
        "id": identifier,
        "name": "Lead",
        "kind": "human" if unit == "hours" else "agent",
        "active": active,
        "unit": unit,
        "calendar": calendar,
    }


def calendar(weekly=None, exceptions=None):
    return {
        "weekly": [8, 8, 8, 8, 8, 0, 0] if weekly is None else weekly,
        "exceptions": [] if exceptions is None else exceptions,
    }


def allocation(
    member="user:lead", *, start="2026-10-19", end="2026-10-20", qty=4, weekdays=None, unit="hours"
):
    return {
        "member_id": member,
        "starts_on": start,
        "ends_on": end,
        "quantity_per_day": qty,
        "weekdays": [0, 1] if weekdays is None else weekdays,
        "unit": unit,
    }


def task(
    identifier="T-1",
    *,
    owner="user:lead",
    verified=False,
    start="2026-10-19",
    end="2026-10-20",
    allocations=None,
    **extra,
):
    return {
        "id": identifier,
        "title": identifier,
        "owner_id": owner,
        "verified": verified,
        "starts_on": start,
        "ends_on": end,
        "allocations": [] if allocations is None else allocations,
        "issues": [],
        **extra,
    }


def cells(resources, tasks, start="2026-10-19", end="2026-10-20", **kwargs):
    return calculate_cells(resources, tasks, start, end, **kwargs)[0]["cells"]


def test_unknown_capacity_and_zero_are_distinct_and_full_configuration_is_preserved():
    unknown = resource()
    resting = resource("agent:worker", unit="slots", calendar=calendar([0] * 7))
    inputs = deepcopy([unknown, resting])
    result = calculate_cells(inputs, [], "2026-10-19", "2026-10-19")
    assert result[0]["cells"] == [
        {
            "date": "2026-10-19",
            "available": None,
            "active_load": 0,
            "total_reserved": 0,
            "overload": None,
            "unavailable": False,
            "unregistered_count": 0,
            "incomplete": True,
            "contributions": [],
        }
    ]
    assert result[1]["cells"][0] == {
        "date": "2026-10-19",
        "available": 0,
        "active_load": 0,
        "total_reserved": 0,
        "overload": 0,
        "unavailable": False,
        "unregistered_count": 0,
        "incomplete": False,
        "contributions": [],
    }
    assert inputs == [unknown, resting]
    assert {key: value for key, value in result[0].items() if key != "cells"} == unknown


def test_calendar_exceptions_override_weekly_including_null_and_zero_without_window_loss():
    config = calendar(
        exceptions=[
            {"date": "2026-10-19", "available": 0, "note": "Leave"},
            {"date": "2026-10-20", "available": None, "note": "Unconfirmed"},
            {"date": "2027-01-01", "available": 0, "note": "Outside window"},
        ]
    )
    member = resource(calendar=config)
    result = calculate_cells([member], [task(allocations=[allocation()])], "2026-10-19", "2026-10-20")
    first, second = result[0]["cells"]
    assert (first["available"], first["overload"], first["unavailable"]) == (0, 4, True)
    assert (second["available"], second["overload"], second["unavailable"]) == (None, None, False)
    assert result[0]["calendar"] == config


def test_only_effective_verified_delivery_releases_activity_and_all_reservations_remain():
    tasks = [
        task("manual-completed", status="completed", allocations=[allocation(qty=3)]),
        task("awaiting-review", status="awaiting_review", allocations=[allocation(qty=2)]),
        task("verified", verified=True, allocations=[allocation(qty=4)]),
    ]
    result = cells([resource(calendar=calendar([4] * 7))], tasks)
    for cell in result:
        assert (cell["active_load"], cell["total_reserved"], cell["overload"]) == (5, 9, 1)
        assert cell["contributions"] == [
            {"task_id": "manual-completed", "title": "manual-completed", "quantity": 3, "active": True},
            {"task_id": "awaiting-review", "title": "awaiting-review", "quantity": 2, "active": True},
            {"task_id": "verified", "title": "verified", "quantity": 4, "active": False},
        ]
        assert cell["unregistered_count"] == 0


def test_inclusive_dates_weekdays_and_half_hour_reservations_do_not_shift_on_weekend():
    segment = allocation(start="2028-02-28", end="2028-03-01", qty=1.5, weekdays=[0, 2])
    result = cells(
        [resource(calendar=calendar())],
        [task(start=segment["starts_on"], end=segment["ends_on"], allocations=[segment])],
        "2028-02-28",
        "2028-03-01",
    )
    assert [cell["active_load"] for cell in result] == [1.5, 0, 1.5]
    assert [cell["unregistered_count"] for cell in result] == [0, 0, 0]
    assert [cell["date"] for cell in result] == ["2028-02-28", "2028-02-29", "2028-03-01"]


def test_unknown_work_demand_is_explicit_without_converting_size_or_actual_hours():
    tasks = [
        task("scheduled", start="2026-10-20", end="2026-10-20", estimate="XL", actual_hours=12),
        task("start-only", start="2026-10-20", end=None),
        task("end-only", start=None, end="2026-10-19"),
        task("undated", start=None, end=None),
        task("invalid", start="not-a-date", end="2026-10-18"),
        task("verified-undated", verified=True, start=None, end=None),
    ]
    result = cells([resource(calendar=calendar())], tasks)
    assert [cell["unregistered_count"] for cell in result] == [3, 4]
    assert all(cell["incomplete"] and cell["active_load"] == 0 for cell in result)


def test_overdue_tasks_are_not_moved_into_today_and_explicit_collaborators_are_separate():
    tasks = [
        task("past", start="2026-10-18", end="2026-10-18"),
        task("collaboration", allocations=[allocation("agent:worker", unit="slots", qty=2)]),
    ]
    resources = [
        resource(calendar=calendar()),
        resource("agent:worker", unit="slots", calendar=calendar([3] * 7)),
    ]
    result = calculate_cells(
        resources, tasks, date(2026, 10, 19), date(2026, 10, 20), today=date(2026, 10, 20)
    )
    assert [cell["unregistered_count"] for cell in result[0]["cells"]] == [1, 1]
    assert [cell["active_load"] for cell in result[1]["cells"]] == [2, 2]
    assert all(cell["unregistered_count"] == 0 for cell in result[1]["cells"])


def test_inactive_resource_keeps_provable_reservations_but_never_claims_capacity():
    result = cells([resource(active=False, calendar=calendar())], [task(allocations=[allocation()])])
    assert all(cell["active_load"] == 4 and cell["total_reserved"] == 4 for cell in result)
    assert all(
        cell["available"] is None and cell["overload"] is None and cell["incomplete"] for cell in result
    )


@pytest.mark.parametrize(
    "mutate",
    [
        {"unit": "slots"},
        {"quantity_per_day": True},
        {"quantity_per_day": float("nan")},
        {"quantity_per_day": float("inf")},
        {"quantity_per_day": 0},
        {"quantity_per_day": 1.25},
        {"weekdays": []},
        {"weekdays": [0, 0]},
        {"weekdays": [True]},
        {"starts_on": "2026-10-18"},
        {"ends_on": "2026-10-21"},
        {"starts_on": "2026-10-20", "ends_on": "2026-10-19"},
    ],
)
def test_damaged_stored_segment_is_ignored_without_reinterpreting_its_quantity(mutate):
    segment = allocation()
    segment.update(mutate)
    result = cells([resource(calendar=calendar())], [task(allocations=[segment])])
    assert all(
        cell["active_load"] == 0
        and cell["total_reserved"] == 0
        and cell["unregistered_count"] == 1
        and cell["incomplete"]
        for cell in result
    )


def test_unknown_resource_unit_never_enters_numeric_load():
    result = cells([resource(unit=None, calendar=calendar())], [task(allocations=[allocation()])])
    assert all(
        cell["available"] is None
        and cell["active_load"] == 0
        and cell["contributions"] == []
        and cell["incomplete"]
        for cell in result
    )


@pytest.mark.parametrize("quantity", [1.5, True, None, float("inf")])
def test_slot_reservations_do_not_accept_hour_steps_or_unknown_numbers(quantity):
    member = resource("agent:worker", unit="slots", calendar=calendar([4] * 7))
    result = cells(
        [member],
        [
            task(
                owner=member["id"],
                allocations=[
                    allocation(member["id"], unit="slots", qty=quantity),
                ],
            )
        ],
    )
    assert all(
        cell["active_load"] == 0 and cell["unregistered_count"] == 1 and cell["incomplete"] for cell in result
    )


def test_unknown_capacity_still_shows_provable_load_and_registration_outside_window():
    segment = allocation(start="2026-10-20", end="2026-10-20", weekdays=[1], qty=0.5)
    first, second = cells([resource()], [task(allocations=[segment])])
    assert first["active_load"] == 0 and first["unregistered_count"] == 0
    assert second["active_load"] == 0.5 and second["unregistered_count"] == 0
    assert first["overload"] is None and second["overload"] is None


def test_segment_without_any_effective_date_is_invalid_even_when_weekday_is_valid():
    result = cells([resource(calendar=calendar())], [task(allocations=[allocation(weekdays=[2])])])
    assert all(
        cell["unregistered_count"] == 1 and cell["incomplete"] and cell["contributions"] == []
        for cell in result
    )


def test_disjoint_effective_weekdays_are_valid_but_corrupt_overlap_is_not_double_counted():
    monday = allocation(weekdays=[0])
    tuesday = allocation(weekdays=[1], qty=2)
    result = cells([resource(calendar=calendar())], [task(allocations=[monday, tuesday])])
    assert [cell["active_load"] for cell in result] == [4, 2]
    overlap = cells([resource(calendar=calendar())], [task(allocations=[monday, allocation(qty=3)])])
    assert all(cell["active_load"] == 0 and cell["incomplete"] for cell in overlap)


def test_corrupt_calendar_values_are_unknown_instead_of_claiming_zero_or_default_capacity():
    member = resource(calendar=calendar([True, 1.25, 8, 8, 8, 0, 0]))
    result = cells([member], [])
    assert all(
        cell["available"] is None and cell["overload"] is None and cell["incomplete"] for cell in result
    )


def test_result_is_detached_and_repeatable_and_invalid_window_is_rejected():
    resources = [resource(calendar=calendar())]
    tasks = [task(allocations=[allocation()])]
    before = deepcopy((resources, tasks))
    first = calculate_cells(resources, tasks, "2026-10-19", "2026-10-20")
    assert first == calculate_cells(resources, tasks, "2026-10-19", "2026-10-20")
    first[0]["calendar"]["weekly"][0] = 0
    assert (resources, tasks) == before
    for start, end in [("20261019", "2026-10-20"), ("2026-10-20", "2026-10-19")]:
        with pytest.raises(ValueError):
            calculate_cells(resources, tasks, start, end)
