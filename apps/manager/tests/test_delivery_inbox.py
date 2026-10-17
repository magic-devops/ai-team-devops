"""The inbox is a read-only view of real SQL delivery and execution evidence."""

# ruff: noqa: F811 - shared pytest fixtures are imported and injected by name.

from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sop_manager.routers.delivery_inbox import build_inbox
from sop_manager.routers.sql_models import DeliveryWorkspace, Issue, Task
from test_delivery_execution import bridge, finish, queue, sync  # noqa: F401
from test_delivery_workbench import command, env, requirement  # noqa: F401

NOW = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)


def inbox(client, user="lead", scope="mine", now=NOW):
    snapshot = client.get("/api/v1/delivery/workspace").json()
    return build_inbox(snapshot, SimpleNamespace(id=user), scope=scope, now=now)


def task(client, rid, title="Build", owner="user:lead", **extra):
    response = command(
        client,
        "task.create",
        {"requirement_id": rid, "title": title, "owner_id": owner, **extra},
    )
    assert response.status_code == 200, response.text
    return next(t for t in response.json()["tasks"] if t["title"] == title)


def member(client, kind):
    response = command(client, "member.save", {"name": "lead", "kind": kind})
    assert response.status_code == 200, response.text
    return next(m for m in response.json()["members"] if m["kind"] == kind)["id"]


def issue(sessions, task_id, iid="ISS-inbox", **extra):
    with sessions() as db:
        db.add(
            Issue(
                id=iid,
                tenant_id="tenant",
                project_id="project",
                task_id=task_id,
                title="Regression needs attention",
                **extra,
            )
        )
        db.commit()


def test_explicit_human_id_survives_agent_name_collision_but_agent_is_not_mine(env):
    client, sessions, _ = env
    rid = requirement(client)
    aid = member(client, "agent")
    mine = task(client, rid, "Human", "user:lead")
    other = task(client, rid, "Agent", aid)
    with sessions() as db:
        db.add(
            Task(
                id="TASK-legacy",
                tenant_id="tenant",
                project_id="project",
                req_id=rid,
                title="Unassigned task beside a same-name agent",
                owner_id="",
            )
        )
        db.commit()
    entries = {i["resource_id"]: i for i in inbox(client)["items"] if i["kind"] == "task"}
    assert set(entries) == {mine["id"]}
    assert other["id"] not in entries


def test_tool_name_does_not_assign_unassigned_tasks_or_hide_explicit_assignment(env):
    client, sessions, _ = env
    rid = requirement(client)
    member(client, "tool")
    explicit = task(client, rid)
    with sessions() as db:
        db.add(
            Task(
                id="TASK-tool-collision",
                tenant_id="tenant",
                project_id="project",
                req_id=rid,
                title="Unassigned task beside a same-name tool",
                owner_id="",
            )
        )
        db.commit()
    entries = [i for i in inbox(client)["items"] if i["kind"] == "task"]
    assert [i["resource_id"] for i in entries] == [explicit["id"]]


def test_generic_stable_owner_assignment_and_missing_planning_metadata_are_supported(env):
    client, sessions, _ = env
    rid = requirement(client)
    with sessions() as db:
        db.add(
            Task(
                id="TASK-legacy-unique",
                tenant_id="tenant",
                project_id="project",
                req_id=rid,
                title="Old unique assignee",
                owner_id="user:lead",
            )
        )
        db.commit()
    snapshot = client.get("/api/v1/delivery/workspace").json()
    row = snapshot["tasks"][0]
    row.pop("planning", None)
    row.pop("dependency_blocked", None)
    result = build_inbox(snapshot, {"id": "lead"}, now=NOW)
    assert next(i for i in result["items"] if i["kind"] == "task")["resource_id"] == row["id"]
    assert result["counts"]["overdue"] == 0


def test_canonical_reassignment_moves_the_task_between_stable_owner_inboxes(env):
    client, sessions, _ = env
    rid = requirement(client)
    own = task(client, rid)
    with sessions() as db:
        db.get(Task, own["id"]).owner_id = "user:reader"
        db.commit()
    snapshot = client.get("/api/v1/delivery/workspace").json()
    assert snapshot["tasks"][0]["owner_active"] is True
    assert snapshot["tasks"][0]["owner_id"] == "user:reader"
    result = build_inbox(snapshot, {"id": "lead"}, now=NOW)
    assert not [i for i in result["items"] if i["kind"] == "task"]
    assert any(i["resource_id"] == own["id"] for i in inbox(client, scope="team")["items"])


def test_finished_tasks_have_no_work_or_overdue_item_and_invalid_legacy_date_is_unknown(env):
    client, _, _ = env
    rid = requirement(client)
    done = task(client, rid, "Finished", ends_on="2026-10-16")
    pending = task(client, rid, "Uncertain date", priority="P0")
    assert command(client, "task.update", {"id": done["id"], "status": "completed"}).status_code == 200
    snapshot = client.get("/api/v1/delivery/workspace").json()
    next(t for t in snapshot["tasks"] if t["id"] == pending["id"])["planning"]["ends_on"] = "2026-19-32"
    result = build_inbox(snapshot, {"id": "lead"}, now=NOW)
    tasks = [i for i in result["items"] if i["kind"] == "task"]
    assert [i["resource_id"] for i in tasks] == [pending["id"]]
    assert tasks[0]["due_on"] is None
    assert result["counts"]["overdue"] == 0


def test_viewer_has_own_work_but_no_team_approval(env):
    client, _, actor = env
    rid = requirement(client)
    own = task(client, rid, owner="user:reader")
    actor["id"] = "reader"
    result = inbox(client, "reader")
    assert result["counts"]["approval"] == 0
    assert [i["resource_id"] for i in result["items"]] == [own["id"]]
    assert result["items"][0]["categories"] == ["work"]


def test_approval_requires_actual_current_stage_gates_and_excludes_operations_or_closed(env):
    client, _, _ = env
    rid = requirement(client)
    assert inbox(client)["counts"]["approval"] == 1
    assert (
        command(client, "stage.advance", {"requirement_id": rid, "comment": "Criteria clear"}).status_code
        == 200
    )
    snapshot = client.get("/api/v1/delivery/workspace").json()
    snapshot["requirements"][0]["flow"]["gates"] = [{"id": "forged-cache", "ok": True}]
    assert build_inbox(snapshot, {"id": "lead"}, now=NOW)["counts"]["approval"] == 0
    assert (
        command(
            client,
            "artifact.add",
            {"requirement_id": rid, "kind": "prd", "title": "PRD", "content": "Search project work"},
        ).status_code
        == 200
    )
    snapshot = client.get("/api/v1/delivery/workspace").json()
    assert build_inbox(snapshot, {"id": "lead"}, now=NOW)["counts"]["approval"] == 1
    for field, value in (("stage", "operations"), ("closed", True), ("blocked_reason", "Scope unclear")):
        changed = deepcopy(snapshot)
        changed["requirements"][0]["flow"][field] = value
        assert build_inbox(changed, {"id": "lead"}, now=NOW)["counts"]["approval"] == 0


def test_blocked_work_and_related_issue_are_deduplicated_by_domain_entity(env):
    client, sessions, _ = env
    rid = requirement(client)
    assert command(client, "requirement.update", {"id": rid, "owner_id": "user:lead"}).status_code == 200
    own = task(client, rid, blocked_reason="Waiting on credentials")
    issue(sessions, own["id"])
    issue(sessions, own["id"], "ISS-resolved", status="resolved")
    issue(sessions, "", "ISS-unrelated")
    result = inbox(client)
    assert {i["kind"] for i in result["items"]} == {"requirement", "task", "issue"}
    assert len(result["items"]) == len({i["id"] for i in result["items"]}) == 3
    assert result["counts"] == {
        "work": 2,
        "approval": 0,
        "acceptance": 0,
        "blocked": 3,
        "overdue": 0,
        "total": 3,
    }
    assert all(i["blocked_reasons"] for i in result["items"])
    linked_issue = next(i for i in result["items"] if i["kind"] == "issue")
    assert linked_issue["requirement_id"] == rid
    assert linked_issue["task_id"] == own["id"]
    assert linked_issue["target"] == {
        "view": "issues",
        "requirement_id": rid,
        "detail": "tasks",
        "task_id": own["id"],
    }
    assert inbox(client, scope="team")["counts"]["blocked"] == 4


def test_personal_requirement_tracks_blockers_on_other_members_tasks(env):
    client, sessions, _ = env
    rid = requirement(client)
    assert command(client, "requirement.update", {"id": rid, "owner_id": "user:lead"}).status_code == 200
    assigned = task(client, rid, owner="user:reader")
    issue(sessions, assigned["id"])
    result = inbox(client)
    assert {i["kind"] for i in result["items"]} == {"requirement", "issue"}
    assert result["counts"]["blocked"] == 2


def test_dependency_blockers_are_taken_from_actual_delivery_plan(env):
    client, _, _ = env
    rid = requirement(client)
    response = command(
        client,
        "tasks.plan",
        {
            "requirement_id": rid,
            "items": [
                {"key": "design", "title": "Design", "owner_id": "user:reader"},
                {"key": "build", "title": "Build", "owner_id": "user:lead", "depends_on": ["design"]},
            ],
        },
    )
    assert response.status_code == 200, response.text
    items = [i for i in inbox(client)["items"] if i["kind"] == "task"]
    assert len(items) == 1
    assert items[0]["categories"] == ["work", "blocked"]
    dependency_id = next(t["id"] for t in response.json()["tasks"] if t["title"] == "Design")
    assert any(dependency_id in reason for reason in items[0]["blocked_reasons"])


def test_due_dates_use_utc_day_and_missing_dates_never_become_overdue(env):
    client, _, _ = env
    rid = requirement(client)
    late = task(client, rid, "Yesterday", ends_on="2026-10-16", priority="P2")
    today = task(client, rid, "Today", ends_on="2026-10-17", priority="P0")
    undated = task(client, rid, "No deadline", priority="P3")
    offset_now = datetime.fromisoformat("2026-10-18T02:00:00+08:00")
    result = inbox(client, now=offset_now)
    tasks = [i for i in result["items"] if i["kind"] == "task"]
    assert [i["resource_id"] for i in tasks] == [late["id"], today["id"], undated["id"]]
    assert [i["overdue"] for i in tasks] == [True, False, False]
    assert tasks[-1]["due_on"] is None
    assert result["as_of"] == "2026-10-17T18:00:00Z"
    assert result["counts"]["overdue"] == 1


def test_current_successful_execution_is_one_acceptance_item_without_unverified_completion(bridge):
    client, _, _, _, _, rid, current = bridge
    execution = sync(bridge, queue(bridge))
    finish(bridge, execution)
    sync(bridge, execution)
    result = inbox(client)
    entry = next(i for i in result["items"] if i["kind"] == "task")
    assert entry["id"] == "task:" + current["id"]
    assert entry["status"] == "awaiting_review"
    assert entry["categories"] == ["acceptance"]
    assert entry["target"] == {
        "view": "list",
        "requirement_id": rid,
        "detail": "tasks",
        "task_id": current["id"],
    }
    assert result["counts"]["acceptance"] == 1
    assert result["counts"]["work"] == 0


def test_changed_requirement_invalidates_pending_acceptance_and_keeps_work_visible(bridge):
    client, _, _, _, _, rid, _ = bridge
    execution = sync(bridge, queue(bridge))
    finish(bridge, execution)
    sync(bridge, execution)
    assert (
        command(client, "requirement.update", {"id": rid, "description": "New acceptance scope"}).status_code
        == 200
    )
    result = inbox(client)
    entry = next(i for i in result["items"] if i["kind"] == "task")
    assert "acceptance" not in entry["categories"]
    assert "work" in entry["categories"]
    assert result["counts"]["acceptance"] == 0


@pytest.mark.parametrize(
    "change",
    [
        "execution_id",
        "task_id",
        "revision",
        "description",
        "stale",
        "missing_stale",
        "superseded",
        "missing_run_id",
        "missing_run_version",
    ],
)
def test_only_matching_latest_nonstale_execution_can_be_pending_acceptance(bridge, change):
    client, _, _, _, _, _, _ = bridge
    execution = sync(bridge, queue(bridge))
    finish(bridge, execution)
    sync(bridge, execution)
    snapshot = client.get("/api/v1/delivery/workspace").json()
    entry = snapshot["executions"][0]
    if change == "execution_id":
        snapshot["tasks"][0]["execution_id"] = "not-current"
    elif change == "task_id":
        entry["snapshot"]["task_id"] = "different-task"
    elif change == "revision":
        entry["snapshot"]["requirement"]["revision"] += 1
    elif change == "description":
        entry["snapshot"]["description"] = "different task contract"
    elif change == "stale":
        entry["stale"] = True
    elif change == "missing_stale":
        entry.pop("stale")
    elif change == "superseded":
        snapshot["executions"].append({**deepcopy(entry), "id": "new-run", "status": "pending_dispatch"})
    elif change == "missing_run_id":
        entry["run_id"] = ""
    elif change == "missing_run_version":
        entry["run_version"] = 0
    result = build_inbox(snapshot, {"id": "lead"}, now=NOW)
    assert result["counts"]["acceptance"] == 0


def test_team_acceptance_in_mine_requires_approve_and_never_grants_runtime_permission(bridge):
    client, _, _, _, _, _, _ = bridge
    execution = sync(bridge, queue(bridge))
    finish(bridge, execution)
    sync(bridge, execution)
    snapshot = client.get("/api/v1/delivery/workspace").json()
    snapshot["tasks"][0].update(owner_id="user:reader", assigned_to="reader")
    snapshot["executions"][0]["snapshot"]["assigned_to"] = "reader"
    assert build_inbox(snapshot, {"id": "lead"}, now=NOW)["counts"]["acceptance"] == 1
    snapshot["permissions"]["approve"] = False
    assert build_inbox(snapshot, {"id": "lead"}, now=NOW)["counts"]["acceptance"] == 0
    result = build_inbox(snapshot, {"id": "lead"}, scope="team", now=NOW)
    assert result["counts"]["acceptance"] == 1
    assert "permissions" not in result["items"][0]


def test_projection_does_not_mutate_snapshot_or_write_database_and_empty_is_compatible(env):
    client, sessions, _ = env
    rid = requirement(client)
    task(client, rid)
    snapshot = client.get("/api/v1/delivery/workspace").json()
    before = deepcopy(snapshot)
    with sessions() as db:
        stored = deepcopy(db.get(DeliveryWorkspace, "project").data)
        version = db.get(DeliveryWorkspace, "project").version
    first = build_inbox(snapshot, {"id": "lead"}, now=NOW)
    assert first["current_user_id"] == "lead"
    assert first == build_inbox(snapshot, {"id": "lead"}, now=NOW)
    assert snapshot == before
    with sessions() as db:
        row = db.get(DeliveryWorkspace, "project")
        assert row.data == stored and row.version == version
    empty = build_inbox({"project": {"id": "legacy"}}, {"id": "lead"}, now=NOW)
    assert empty["items"] == []
    assert empty["counts"] == {
        "work": 0,
        "approval": 0,
        "acceptance": 0,
        "blocked": 0,
        "overdue": 0,
        "total": 0,
    }
    with pytest.raises(ValueError, match="scope"):
        build_inbox(snapshot, {"id": "lead"}, scope="all", now=NOW)
