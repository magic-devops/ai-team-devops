"""Real SQL/API scheduling protects explicit resource units and final planning state."""

from copy import deepcopy

import pytest
from sop_manager.routers import sql_models as models
from test_delivery_manual_review import completed, review
from test_delivery_workbench import command, requirement
from test_delivery_workbench import env as delivery_env

env = delivery_env


def schedule(client, **params):
    return client.get("/api/v1/delivery/schedule", params=params)


def apply_schedule(client, changes, **kwargs):
    current = schedule(client)
    assert current.status_code == 200, current.text
    return command(
        client,
        "tasks.schedule",
        {"planning_basis": current.json()["planning_basis"], "changes": changes},
        **kwargs,
    )


def calendar(client, member_id="user:lead", weekly=None, exceptions=None):
    current = schedule(client)
    assert current.status_code == 200, current.text
    return command(
        client,
        "member.calendar.save",
        {
            "member_id": member_id,
            "planning_basis": current.json()["planning_basis"],
            "weekly": [8, 8, 8, 8, 8, 0, 0] if weekly is None else weekly,
            "exceptions": exceptions or [],
        },
    )


def task(client):
    rid = requirement(client)
    created = command(
        client, "task.create", {"requirement_id": rid, "title": "Scheduled work", "owner_id": "user:lead"}
    )
    return next(t for t in created.json()["tasks"] if t["req_id"] == rid)


def allocation(member_id="user:lead", quantity=2, **changes):
    return {
        "member_id": member_id,
        "starts_on": "2026-10-19",
        "ends_on": "2026-10-23",
        "quantity_per_day": quantity,
        "weekdays": [0, 1, 2, 3, 4],
        **changes,
    }


def planned(client, tid, allocations=None):
    return apply_schedule(
        client,
        [
            {
                "task_id": tid,
                "starts_on": "2026-10-19",
                "ends_on": "2026-10-23",
                "allocations": [allocation()] if allocations is None else allocations,
            }
        ],
    )


def test_schedule_get_is_pure_unknown_and_calendar_full_exceptions_survive_window(env):
    client, sessions, _ = env
    before = schedule(client)
    assert before.status_code == 200, before.text
    human = next(r for r in before.json()["resources"] if r["id"] == "user:lead")
    assert human["calendar"] is None
    assert all(c["available"] is None for c in human["cells"])
    assert (
        calendar(
            client, exceptions=[{"date": "2028-02-29", "available": None, "note": "Unknown distant day"}]
        ).status_code
        == 200
    )
    with sessions() as db:
        counts = {t.name: db.query(t).count() for t in models.Base.metadata.sorted_tables}
    value = schedule(client, starts_on="2026-10-19", ends_on="2026-10-20").json()
    human = next(r for r in value["resources"] if r["id"] == "user:lead")
    assert human["calendar"]["exceptions"][0]["date"] == "2028-02-29"
    with sessions() as db:
        assert {t.name: db.query(t).count() for t in models.Base.metadata.sorted_tables} == counts


def test_explicit_reservations_compare_capacity_without_moving_demand_and_verified_only_releases(env):
    client, _, _ = env
    work = completed(client)
    assert planned(client, work["id"]).status_code == 200
    assert (
        calendar(
            client,
            weekly=[1, 1, 1, 1, 1, 0, 0],
            exceptions=[{"date": "2026-10-20", "available": 0, "note": "Unavailable"}],
        ).status_code
        == 200
    )
    value = schedule(client, starts_on="2026-10-19", ends_on="2026-10-23").json()
    cells = next(r for r in value["resources"] if r["id"] == "user:lead")["cells"]
    assert cells[0]["active_load"] == 2 and cells[0]["overload"] == 1
    assert cells[1]["active_load"] == 2 and cells[1]["unavailable"]
    assert review(client, work["id"]).status_code == 200
    cells = next(
        r
        for r in schedule(client, starts_on="2026-10-19", ends_on="2026-10-23").json()["resources"]
        if r["id"] == "user:lead"
    )["cells"]
    assert all(c["active_load"] == 0 and c["total_reserved"] == 2 for c in cells)


@pytest.mark.parametrize("quantity", [True, 1.25, 25, "2", float("inf")])
def test_human_reservation_rejects_invalid_quantity(env, quantity):
    client, _, _ = env
    work = task(client)
    if quantity == float("inf"):
        # Standard JSON cannot transport Infinity; test the actual typed boundary.
        from sop_manager.routers.delivery_scheduling_contract import AllocationInput

        with pytest.raises(ValueError):
            AllocationInput.model_validate(allocation(quantity=quantity))
        return
    assert planned(client, work["id"], [allocation(quantity=quantity)]).status_code == 422


def test_agent_tool_slots_are_integer_and_kind_is_immutable_with_no_capacity_field(env):
    client, _, _ = env
    saved = command(client, "member.save", {"kind": "tool", "name": "Test tool"})
    member = next(m for m in saved.json()["members"] if m["kind"] == "tool")
    assert "capacity" not in member
    work = task(client)
    assert planned(client, work["id"], [allocation(member["id"], 1.5)]).status_code == 422
    assert planned(client, work["id"], [allocation(member["id"], 2)]).status_code == 200
    assert calendar(client, member["id"], [2] * 7).status_code == 200
    changed = command(client, "member.save", {"id": member["id"], "name": member["name"], "kind": "agent"})
    assert changed.status_code == 409


def test_effective_day_overlap_and_task_bounds_are_validated_atomically(env):
    client, _, _ = env
    work = task(client)
    assert (
        planned(client, work["id"], [allocation(weekdays=[0]), allocation(weekdays=[1])]).status_code == 200
    )
    state = schedule(client).json()
    bad = apply_schedule(
        client, [{"task_id": work["id"], "allocations": [allocation(), allocation(weekdays=[1])]}]
    )
    assert bad.status_code == 422
    bad = apply_schedule(client, [{"task_id": work["id"], "ends_on": "2026-10-20"}])
    assert bad.status_code == 422
    assert schedule(client).json()["planning_basis"] == state["planning_basis"]


def test_final_batch_can_move_dependency_chain_without_invalid_intermediate_state_and_replays(env):
    client, _, _ = env
    rid = requirement(client)
    data = command(
        client,
        "tasks.plan",
        {
            "requirement_id": rid,
            "items": [
                {"key": "first", "title": "First", "starts_on": "2026-10-19", "ends_on": "2026-10-20"},
                {
                    "key": "next",
                    "title": "Next",
                    "starts_on": "2026-10-20",
                    "ends_on": "2026-10-21",
                    "depends_on": ["first"],
                },
            ],
        },
    ).json()
    ids = {t["title"]: t["id"] for t in data["tasks"]}
    current = schedule(client).json()
    body = {
        "planning_basis": current["planning_basis"],
        "changes": [
            {"task_id": ids["First"], "starts_on": "2026-10-21", "ends_on": "2026-10-22"},
            {"task_id": ids["Next"], "starts_on": "2026-10-22", "ends_on": "2026-10-23"},
        ],
    }
    preview = client.post("/api/v1/delivery/schedule-preview", json=body)
    assert preview.status_code == 200, preview.text
    assert schedule(client).json()["planning_basis"] == current["planning_basis"]
    saved = command(client, "tasks.schedule", body, key="same-batch", version=current["version"])
    assert saved.status_code == 200, saved.text
    replay = command(client, "tasks.schedule", body, key="same-batch", version=current["version"])
    assert replay.status_code == 200 and replay.json()["replayed"]


def test_planning_basis_catches_metadata_edit_and_single_task_uses_same_allocation_bounds(env):
    client, sessions, _ = env
    work = task(client)
    assert planned(client, work["id"]).status_code == 200
    before = schedule(client).json()
    with sessions() as db:
        workspace = db.get(models.DeliveryWorkspace, "project")
        data = deepcopy(workspace.data)
        data["task_details"][work["id"]]["ends_on"] = "2026-10-24"
        workspace.data = data
        db.commit()
    changed = command(
        client,
        "tasks.schedule",
        {
            "planning_basis": before["planning_basis"],
            "changes": [{"task_id": work["id"], "ends_on": "2026-10-25"}],
        },
    )
    assert changed.status_code == 409 and changed.json()["detail"]["code"] == "planning_basis_changed"
    latest = schedule(client).json()
    single = command(
        client,
        "task.update",
        {"id": work["id"], "planning_basis": latest["planning_basis"], "ends_on": "2026-10-20"},
    )
    assert single.status_code == 422


def test_pure_planning_preserves_manual_acceptance_and_scope_filters_do_not_change_basis(env):
    client, _, _ = env
    work = completed(client)
    assert review(client, work["id"]).status_code == 200
    assert planned(client, work["id"]).status_code == 200
    assert calendar(client).status_code == 200
    assert client.get(f"/api/v1/delivery/tasks/{work['id']}/review-current").json()["current"]["verified"]
    first = schedule(client, starts_on="2026-10-19", ends_on="2026-10-23").json()
    other = schedule(client, starts_on="2026-11-01", ends_on="2026-11-02").json()
    assert first["planning_basis"] == other["planning_basis"]


def test_reservation_change_is_observed_and_compared_to_immutable_delivery_baseline(env):
    from test_delivery_progress_baseline import _payload

    client, sessions, _ = env
    work = completed(client)
    assert review(client, work["id"]).status_code == 200
    assert planned(client, work["id"]).status_code == 200
    assert command(client, "baseline.create", _payload(client)).status_code == 200
    with sessions() as db:
        frozen = db.query(models.DeliveryProgressBaseline).one()
        baseline_id, original = frozen.id, deepcopy(frozen.data)
        observed_before = db.query(models.DeliveryProgressObservation).count()
    assert (
        apply_schedule(client, [{"task_id": work["id"], "allocations": [allocation(quantity=3)]}]).status_code
        == 200
    )
    with sessions() as db:
        assert db.query(models.DeliveryProgressObservation).count() == observed_before + 1
        assert db.query(models.DeliveryProgressBaseline).one().data == original
    response = client.get(
        f"/api/v1/delivery/progress/baselines/{baseline_id}/comparison/items/{work['id']}",
        params={"kind": "changed"},
    )
    assert response.status_code == 200, response.text
    change = response.json()["item"]
    assert change["fields"] == ["allocations"]
    assert change["before"]["allocations"][0]["quantity_per_day"] == 2
    assert change["after"]["allocations"][0]["quantity_per_day"] == 3
    assert client.get(f"/api/v1/delivery/tasks/{work['id']}/review-current").json()["current"]["verified"]


def test_schedule_rejects_non_civil_dates_and_long_windows(env):
    client, _, _ = env
    assert schedule(client, starts_on="86400", ends_on="1970-01-03").status_code == 422
    assert schedule(client, starts_on="2026-01-01", ends_on="2026-04-03").status_code == 422
    assert schedule(client, starts_on="2028-02-29", ends_on="2028-02-29").status_code == 200
    assert schedule(client, ends_on="2028-02-29").json()["range"] == {
        "starts_on": "2028-02-16",
        "ends_on": "2028-02-29",
    }
    assert schedule(client, starts_on="2028-02-29").json()["range"] == {
        "starts_on": "2028-02-29",
        "ends_on": "2028-03-13",
    }


@pytest.mark.parametrize("weekly", [[True] * 7, [1.25] * 7, [25] * 7, [8] * 6])
def test_calendar_rejects_invalid_human_capacity(env, weekly):
    client, _, _ = env
    assert calendar(client, weekly=weekly).status_code == 422


def test_calendar_replacement_requires_explicit_complete_exception_list(env):
    client, _, _ = env
    current = schedule(client).json()
    saved = command(
        client,
        "member.calendar.save",
        {"member_id": "user:lead", "planning_basis": current["planning_basis"], "weekly": [8] * 7},
    )
    assert saved.status_code == 422


def test_scope_permissions_and_inactive_resources_reject_new_plans(env):
    client, sessions, actor = env
    work = task(client)
    current = schedule(client).json()
    actor["id"] = "reader"
    assert calendar(client).status_code == 403
    assert (
        client.post(
            "/api/v1/delivery/schedule-preview",
            json={
                "planning_basis": current["planning_basis"],
                "changes": [{"task_id": work["id"], "starts_on": None}],
            },
        ).status_code
        == 403
    )
    actor["id"] = "lead"
    assert planned(client, work["id"], [allocation("user:foreign")]).status_code == 422
    with sessions() as db:
        db.get(models.User, "reader").status = "suspended"
        db.commit()
    assert planned(client, work["id"], [allocation("user:reader")]).status_code == 422


def test_preview_and_failed_batch_never_partially_write_and_single_requires_planning_basis(env):
    client, sessions, _ = env
    work = task(client)
    assert planned(client, work["id"]).status_code == 200
    current = schedule(client).json()
    body = {
        "planning_basis": current["planning_basis"],
        "changes": [{"task_id": work["id"], "ends_on": "2026-10-24"}],
    }
    with sessions() as db:
        before = {table.name: db.query(table).count() for table in models.Base.metadata.sorted_tables}
    assert client.post("/api/v1/delivery/schedule-preview", json=body).status_code == 200
    with sessions() as db:
        assert {table.name: db.query(table).count() for table in models.Base.metadata.sorted_tables} == before
    failed = apply_schedule(client, [*body["changes"], {"task_id": "deleted", "starts_on": None}])
    assert failed.status_code == 404
    assert schedule(client).json()["planning_basis"] == current["planning_basis"]
    failed = client.post(
        "/api/v1/delivery/commands",
        json={
            "action": "task.update",
            "expected_version": current["version"],
            "idempotency_key": "missing-planning-basis",
            "payload": {"id": work["id"], "ends_on": "2026-10-24"},
        },
    )
    assert failed.status_code == 422


def test_uncaptured_historical_reservations_are_unknown_instead_of_scope_changes():
    from sop_manager.routers.delivery_progress_baseline import compare_scope

    result = compare_scope({"tasks": [{"id": "task"}]}, {"tasks": [{"id": "task", "allocations": []}]})
    assert result["changed"] == []
    assert result["incomplete_plan_fields"] == [
        "acceptance",
        "acceptance_criteria",
        "allocations",
        "requirement_criteria_indices",
    ]
    assert result["unchanged_count"] == 0


def test_schedule_preview_stays_read_only_through_global_audit_middleware(env, monkeypatch):
    from sop_manager.routers import audit

    client, _, _ = env
    opened_audit_sessions = []

    def audit_session():
        opened_audit_sessions.append(True)
        yield object()

    monkeypatch.setattr(audit, "get_session", audit_session)
    monkeypatch.setattr(audit, "_write_audit", lambda *args: None)
    client.app.middleware("http")(audit.audit_middleware)
    work = task(client)
    assert opened_audit_sessions  # Actual mutation paths retain audit writes.
    before = len(opened_audit_sessions)
    current = schedule(client).json()
    body = {
        "planning_basis": current["planning_basis"],
        "changes": [{"task_id": work["id"], "starts_on": None}],
    }
    assert client.post("/api/v1/delivery/schedule-preview", json=body).status_code == 200
    assert client.post("/api/v1/delivery/schedule-preview", json={}).status_code == 422
    assert (
        client.post(
            "/api/v1/delivery/schedule-preview",
            json={**body, "planning_basis": "a" * 64},
        ).status_code
        == 409
    )
    assert len(opened_audit_sessions) == before
