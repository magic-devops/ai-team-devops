"""Canonical invalidation and isolated invalid business input regressions."""

from copy import deepcopy

import pytest
from sop_manager.project_write_guard import require_project_operation
from sop_manager.routers import delivery
from sop_manager.routers import sql_models as m
from sop_manager.routers.auth_sql import current_user, current_user_or_apikey
from test_delivery_workbench import command, requirement
from test_event_handoff import env as env
from test_event_handoff import frozen, result, send, version


def flow_client(env):
    client, sessions, actor, tmp, app = env
    app.include_router(delivery.router)
    app.dependency_overrides[current_user] = app.dependency_overrides[current_user_or_apikey]
    return client


def push(client, sessions, module, record, action="upsert", eid="sync-change"):
    return result(
        send(
            client,
            frozen(
                eid,
                "sop.sync.push",
                {
                    "module": module,
                    "action": action,
                    "record": record,
                    "expected_version": version(sessions),
                },
            ),
        )
    )


def set_stage(sessions, rid, stage):
    from sop_manager.routers.delivery_service import remember_basis

    with sessions() as db:
        require_project_operation(db, "tenant", "project")
        row = db.get(m.DeliveryWorkspace, "project")
        data = deepcopy(row.data)
        data["flows"][rid]["stage"] = stage
        remember_basis(db, db.get(m.Project, "project"), data)
        row.data = data
        db.commit()


def test_sync_requirement_definition_requires_canonical_preview_before_reopening(env):
    client = flow_client(env)
    sessions = env[1]
    rid = requirement(client)
    approved = command(client, "stage.advance", {"requirement_id": rid, "comment": "Reviewed"}).json()
    before = next(row for row in approved["requirements"] if row["id"] == rid)
    receipt = push(
        client, sessions, "requirements", {"id": rid, "acceptance_criteria": ["New unreviewed scope"]}
    )
    assert receipt["processing"]["state"] == "failed", receipt
    assert receipt["processing"]["reason_code"] == "requirement_change_preview_required"
    assert not receipt["processing"]["retryable"]
    with sessions() as db:
        flow = db.get(m.DeliveryWorkspace, "project").data["flows"][rid]
        assert flow["stage"] == before["flow"]["stage"] and flow["revision"] == before["flow"]["revision"]
        assert db.get(m.Requirement, rid).acceptance_criteria == before["acceptance_criteria"]
    # The normal change-preview + requirement.update path remains available and
    # invalidates the prior approval only when the definition actually changes.
    changed = command(
        client, "requirement.update", {"id": rid, "acceptance_criteria": ["New unreviewed scope"]}
    )
    assert changed.status_code == 200, changed.text
    after = next(row for row in changed.json()["requirements"] if row["id"] == rid)
    assert after["flow"]["stage"] == "intake" and after["flow"]["revision"] > before["flow"]["revision"]
    assert after["status"] == "pending"


@pytest.mark.parametrize("status", ["completed", "in_progress", "unknown"])
def test_sync_requirement_status_cannot_bypass_delivery_stage(env, status):
    client = flow_client(env)
    rid = requirement(client)
    receipt = push(client, env[1], "requirements", {"id": rid, "status": status})
    assert receipt["processing"]["state"] == "failed", receipt
    with env[1]() as db:
        assert db.get(m.Requirement, rid).status == "pending"


@pytest.mark.parametrize(
    "change",
    [
        {"description": "Changed"},
        {"title": "New title"},
        {"owner_id": "user:other-user"},
        {"acceptance_criteria": ["Changed"]},
        {"req_id": ""},
    ],
)
def test_sync_task_scope_reopens_testing_before_remembering_basis(env, change):
    client = flow_client(env)
    rid = requirement(client)
    made = command(
        client, "task.create", {"requirement_id": rid, "title": "Build", "owner_id": "user:lead"}
    ).json()
    tid = next(row["id"] for row in made["tasks"] if row["req_id"] == rid)
    set_stage(env[1], rid, "acceptance")
    receipt = push(client, env[1], "tasks", {"id": tid, **change})
    assert receipt["processing"]["state"] == "processed", receipt
    with env[1]() as db:
        flow = db.get(m.DeliveryWorkspace, "project").data["flows"][rid]
        assert flow["stage"] == "intake" and flow["revision"] == 2
        assert db.get(m.Requirement, rid).status == "pending"


@pytest.mark.parametrize("action", ["upsert", "delete"])
def test_sync_task_cannot_change_released_work(env, action):
    client = flow_client(env)
    rid = requirement(client)
    made = command(client, "task.create", {"requirement_id": rid, "title": "Build"}).json()
    tid = next(row["id"] for row in made["tasks"] if row["req_id"] == rid)
    set_stage(env[1], rid, "release")
    record = {"id": tid, **({"req_id": ""} if action == "upsert" else {})}
    receipt = push(client, env[1], "tasks", record, action)
    assert receipt["processing"]["state"] == "failed", receipt
    with env[1]() as db:
        assert db.get(m.Task, tid).req_id == rid


@pytest.mark.parametrize(
    "data",
    [
        {"module": "rules", "record": []},
        {"module": "rules", "record": None},
        {"module": []},
        {"module": {}},
        {"module": "rules", "action": []},
        {"module": "rules", "record": {"path": "x.md", "content": "x", "extra": True}},
        {"module": "rules", "record": {"path": "x.md", "content": "x"}, "extra": True},
        {"module": "rules", "record": {"path": "x.md", "content": "x"}, "expected_version": True},
    ],
)
def test_invalid_sync_shape_preserves_valid_sibling(env, data):
    client, sessions, *_ = env
    client._transport.raise_server_exceptions = False
    bad = frozen("invalid-business", "sop.sync.push", {"expected_version": 0, **data})
    response = send(client, bad, frozen("valid-sibling"))
    assert response.status_code == 200, response.text
    rows = response.json()["results"]
    assert rows[0]["outcome"] == "stored" and rows[0]["processing"]["state"] == "failed", rows
    assert not rows[0]["processing"]["retryable"]
    assert rows[1]["outcome"] == "stored"
    with sessions() as db:
        assert db.query(m.EventInbox).count() == 2


@pytest.mark.parametrize("existing", [False, True])
def test_sync_task_cannot_add_or_move_into_released_requirement(env, existing):
    client = flow_client(env)
    rid = requirement(client)
    set_stage(env[1], rid, "release")
    record = {"id": "T-task" if existing else "new-task", "req_id": rid, "title": "Build"}
    receipt = push(client, env[1], "tasks", record)
    assert receipt["processing"]["state"] == "failed", receipt
    with env[1]() as db:
        row = db.get(m.Task, record["id"])
        assert (row.req_id == "") if existing else row is None


@pytest.mark.parametrize("action", ["create", "delete"])
def test_sync_task_membership_changes_reopen_testing(env, action):
    client = flow_client(env)
    rid = requirement(client)
    made = command(client, "task.create", {"requirement_id": rid, "title": "Build"}).json()
    tid = next(row["id"] for row in made["tasks"] if row["req_id"] == rid)
    set_stage(env[1], rid, "acceptance")
    record = {"id": tid} if action == "delete" else {"id": "added-task", "req_id": rid, "title": "Added"}
    receipt = push(client, env[1], "tasks", record, "delete" if action == "delete" else "upsert")
    assert receipt["processing"]["state"] == "processed", receipt
    with env[1]() as db:
        flow = db.get(m.DeliveryWorkspace, "project").data["flows"][rid]
        assert flow["stage"] == "intake" and flow["revision"] == 2
        assert db.get(m.Requirement, rid).status == "pending"


def test_sync_task_move_and_completion_obeys_final_requirement_blocker(env):
    client = flow_client(env)
    source = requirement(client)
    made = command(
        client, "requirement.create", {"title": "Blocked target", "acceptance_criteria": ["Blocked scope"]}
    ).json()
    target = next(row["id"] for row in made["requirements"] if row["title"] == "Blocked target")
    command(client, "requirement.update", {"id": target, "blocked_reason": "Cannot execute this scope"})
    created = command(
        client,
        "task.create",
        {"requirement_id": source, "title": "Move", "owner_id": "user:lead", "acceptance_criteria": ["Done"]},
    ).json()
    tid = next(row["id"] for row in created["tasks"] if row["req_id"] == source)
    old_version = version(env[1])
    receipt = push(client, env[1], "tasks", {"id": tid, "req_id": target, "status": "completed"})
    assert receipt["processing"]["state"] == "failed", receipt
    assert receipt["processing"]["reason_code"] == "task_blocked"
    assert version(env[1]) == old_version
    with env[1]() as db:
        row = db.get(m.Task, tid)
        assert row.req_id == source and row.status == "pending"
