"""Stable task responsibility is independent from labels and runtime execution."""

# ruff: noqa: F811 - shared pytest fixtures are imported and injected by name.

import pytest
from sop_manager.routers.delivery_contract import default_flow, stage_gates
from sop_manager.routers.sql_models import DeliveryTaskReview, DeliveryWorkspace, ProjectMember, Task, User
from test_delivery_execution import bridge, finish, queue, queue_payload, sync  # noqa: F401
from test_delivery_manual_review import review, review_current, review_detail, reviews
from test_delivery_workbench import command, env, requirement  # noqa: F401


def create(client, *, owner_id="user:lead", title="Stable responsibility"):
    response = command(
        client,
        "task.create",
        {"title": title, "owner_id": owner_id, "acceptance_criteria": ["Requested behavior is checked"]},
    )
    assert response.status_code == 200, response.text
    return next(t for t in response.json()["tasks"] if t["title"] == title)


def test_canonical_owner_survives_human_rename_and_old_name_reuse(env):
    client, sessions, actor = env
    task = create(client)
    with sessions() as db:
        assert db.get(Task, task["id"]).owner_id == "user:lead"
        db.get(User, "lead").username = "Renamed lead"
        db.flush()
        unusable_hash = "not-a-login"
        db.add(
            User(
                id="replacement",
                tenant_id="tenant",
                username="lead",
                role="tenant_admin",
                password_hash=unusable_hash,
            )
        )
        db.commit()
    current = client.get("/api/v1/delivery/workspace").json()["tasks"][0]
    assert current["owner_id"] == "user:lead"
    assert current["owner"]["name"] == current["assigned_to"] == "Renamed lead"
    assert current["owner"]["available"]
    assert any(item["task_id"] == task["id"] for item in client.get("/api/v1/delivery/inbox").json()["items"])
    actor["id"] = "replacement"
    assert not any(
        item["task_id"] == task["id"] for item in client.get("/api/v1/delivery/inbox").json()["items"]
    )


def test_manual_receipt_preserves_original_label_without_invalidating_on_rename(env):
    client, sessions, _ = env
    task = create(client)
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert review(client, task["id"]).status_code == 200
    before = review_current(client, task["id"]).json()
    with sessions() as db:
        db.get(User, "lead").username = "Renamed lead"
        db.commit()
    after = review_current(client, task["id"]).json()
    assert after["current"]["verified"] and after["effective_review_id"]
    assert after["current"]["basis"] == before["current"]["basis"]
    assert after["current"]["owner"]["name"] == "Renamed lead"
    original = review_detail(client, task["id"], after["effective_review_id"]).json()["review"]
    assert original["snapshot"]["owner"]["name"] == "lead"
    with sessions() as db:
        assert not db.query(DeliveryTaskReview).one().invalidated


def test_native_receipt_is_not_invalidated_by_owner_display_name_change(bridge):
    client, sessions, _, _, _, _, task = bridge
    intent = queue(bridge)
    execution = sync(bridge, intent)
    finish(bridge, execution)
    execution = sync(bridge, intent)
    accepted = command(
        client,
        "execution.review",
        {
            "id": intent["id"],
            "decision": "accept",
            "comment": "Current result verified",
            "run_version": execution["run_version"],
        },
    )
    assert accepted.status_code == 200, accepted.text
    with sessions() as db:
        db.get(User, "lead").username = "Renamed lead"
        db.commit()
    state = client.get("/api/v1/delivery/workspace").json()
    assert not state["executions"][-1]["stale"]
    assert state["executions"][-1]["snapshot"]["owner"]["name"] == "lead"
    current = next(t for t in state["tasks"] if t["id"] == task["id"])
    assert current["verified"] and current["assigned_to"] == "Renamed lead"


def test_responsible_agent_can_receive_explicit_human_manual_acceptance(env):
    client, _, _ = env
    saved = command(client, "member.save", {"name": "Responsible agent", "kind": "agent", "tool": "codex"})
    agent = next(m for m in saved.json()["members"] if m["kind"] == "agent")
    task = create(client, owner_id=agent["id"])
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    accepted = review(client, task["id"])
    assert accepted.status_code == 200, accepted.text
    evidence = reviews(client, task["id"]).json()
    assert review_current(client, task["id"]).json()["current"]["verified"]
    assert evidence["reviews"][0]["source"] == "manual"
    assert evidence["reviews"][0]["reviewer"]["id"] == "lead"
    original = review_detail(client, task["id"], evidence["reviews"][0]["id"]).json()["review"]
    assert original["snapshot"]["owner"]["id"] == agent["id"]


def test_unassigned_draft_cannot_dispatch_and_does_not_adopt_operator(bridge):
    client, sessions, store, principal, workspace, _, _ = bridge
    task = create(client, owner_id="")
    assert task["owner"] is None and task["owner_id"] == ""
    response = command(
        client,
        "execution.queue",
        {**queue_payload(bridge), "task_id": task["id"], "task_basis": task["basis"]},
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "task_owner_missing"
    assert not store.list(principal, workspace["id"], "tasks")
    with sessions() as db:
        assert db.get(Task, task["id"]).owner_id == ""


@pytest.mark.parametrize("owner_id", ["user:missing", "member-missing"])
def test_unavailable_owner_is_explicit_and_cannot_be_reassigned_by_name(env, owner_id):
    client, _, _ = env
    from sop_manager.routers.delivery_team import TeamContext

    # The pure read descriptor retains a broken explicit reference; no label lookup.
    with env[1]() as db:
        from sop_manager.routers.sql_models import Project

        owner = TeamContext(db, db.get(Project, "project")).resolve_owner(owner_id)
        assert owner["id"] == owner_id and not owner["available"]
    response = command(client, "task.create", {"title": "Invalid owner", "owner_id": owner_id})
    assert response.status_code == 422


def accepted_parent(client):
    rid = requirement(client)
    for kind in (None, "prd", "prototype", "architecture"):
        if kind:
            response = command(
                client,
                "artifact.add",
                {"requirement_id": rid, "kind": kind, "title": kind, "content": "Reviewed design"},
            )
            assert response.status_code == 200, response.text
        response = command(client, "stage.advance", {"requirement_id": rid, "comment": "Reviewed"})
        assert response.status_code == 200, response.text
    response = command(
        client,
        "task.create",
        {
            "requirement_id": rid,
            "title": "Collective delivery",
            "owner_id": "user:reader",
            "acceptance_criteria": ["Checked behavior"],
        },
    )
    task = response.json()["tasks"][0]
    assert (
        command(client, "stage.advance", {"requirement_id": rid, "comment": "Plan reviewed"}).status_code
        == 200
    )
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert (
        command(
            client, "stage.advance", {"requirement_id": rid, "comment": "Development reviewed"}
        ).status_code
        == 200
    )
    assert (
        command(
            client,
            "artifact.add",
            {
                "requirement_id": rid,
                "kind": "test",
                "title": "Tests",
                "content": "Behavior tested",
                "result": "passed",
            },
        ).status_code
        == 200
    )
    assert (
        command(client, "stage.advance", {"requirement_id": rid, "comment": "Tests reviewed"}).status_code
        == 200
    )
    response = command(client, "stage.advance", {"requirement_id": rid, "comment": "Human acceptance"})
    assert response.status_code == 200 and response.json()["tasks"][0]["verified"], response.text
    return task


@pytest.mark.parametrize("change", ["suspend", "remove_membership"])
def test_collective_parent_cannot_revive_after_responsibility_becomes_unavailable(env, change):
    client, sessions, _ = env
    task = accepted_parent(client)
    for restore in (False, True):
        with sessions() as db:
            if change == "suspend":
                db.get(User, "reader").status = "active" if restore else "suspended"
            elif restore:
                db.add(ProjectMember(project_id="project", user_id="reader", role="viewer"))
            else:
                db.delete(db.get(ProjectMember, ("project", "reader")))
            db.commit()
            flow = db.get(DeliveryWorkspace, "project").data["flows"][task["req_id"]]
            assert flow["stage"] == "intake" and flow["revision"] > 1
    assert not review_current(client, task["id"]).json()["current"]["verified"]


def test_member_role_and_display_changes_preserve_responsibility_and_manual_receipt(env):
    client, sessions, _ = env
    task = create(client, owner_id="user:reader")
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert review(client, task["id"]).status_code == 200
    before = review_current(client, task["id"]).json()["current"]["basis"]
    with sessions() as db:
        db.get(ProjectMember, ("project", "reader")).role = "developer"
        db.get(User, "reader").username = "New reader label"
        db.commit()
    current = review_current(client, task["id"]).json()
    assert current["current"]["verified"] and current["current"]["basis"] == before
    original = review_detail(client, task["id"], current["effective_review_id"]).json()["review"]
    assert original["snapshot"]["owner"]["name"] == "reader"


def test_owner_reassignment_a_b_a_cannot_revive_manual_receipt(env):
    client, _, _ = env
    task = create(client)
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert review(client, task["id"]).status_code == 200
    missing_basis = command(client, "task.update", {"id": task["id"], "owner_id": "user:reader"})
    assert missing_basis.status_code == 422
    for owner_id in ("user:reader", "user:lead"):
        current = review_current(client, task["id"]).json()["current"]
        response = command(
            client, "task.update", {"id": task["id"], "owner_id": owner_id, "task_basis": current["basis"]}
        )
        assert response.status_code == 200, response.text
    current = reviews(client, task["id"]).json()
    assert current["reviews"][0]["invalidated"]
    assert not review_current(client, task["id"]).json()["current"]["verified"]


def test_registered_agent_rename_preserves_receipt_but_disable_restore_invalidates(env):
    client, _, _ = env
    member = {"name": "Responsible agent", "kind": "agent", "tool": "codex", "active": True}
    saved = command(client, "member.save", member)
    member["id"] = next(m["id"] for m in saved.json()["members"] if m["kind"] == "agent")
    task = create(client, owner_id=member["id"])
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert review(client, task["id"]).status_code == 200
    member["name"] = "New agent label"
    assert command(client, "member.save", member).status_code == 200
    assert review_current(client, task["id"]).json()["current"]["verified"]
    for active in (False, True):
        response = command(client, "member.save", {**member, "active": active})
        assert response.status_code == 200, response.text
    current = reviews(client, task["id"]).json()
    assert current["reviews"][0]["invalidated"]
    assert not review_current(client, task["id"]).json()["current"]["verified"]


def test_tool_resource_cannot_be_responsible_for_a_task(env):
    client, _, _ = env
    saved = command(client, "member.save", {"name": "Builder tool", "kind": "tool", "active": True})
    tool = next(m for m in saved.json()["members"] if m["kind"] == "tool")
    assert tool["available"] and not tool["can_own_task"]
    assert (
        command(
            client, "task.create", {"title": "No tool responsibility", "owner_id": tool["id"]}
        ).status_code
        == 422
    )


def test_owner_display_rename_preserves_planning_and_progress_baseline_scope(env):
    from test_delivery_progress_baseline import _payload

    client, sessions, _ = env
    create(client)
    before = client.get("/api/v1/delivery/workspace").json()["planning_basis"]
    payload = _payload(client)
    with sessions() as db:
        db.get(User, "lead").username = "Changed display name"
        db.commit()
    assert client.get("/api/v1/delivery/workspace").json()["planning_basis"] == before
    proof = client.get("/api/v1/delivery/progress/freeze-proof").json()
    assert proof["complete"] and proof["basis"] == payload["basis"]
    accepted = command(client, "baseline.create", payload)
    assert accepted.status_code == 200, accepted.text


@pytest.mark.parametrize("stage", ["planning", "development", "testing", "acceptance", "release"])
def test_collective_gate_requires_available_responsibility_through_delivery(stage):
    task = {
        "id": "task",
        "req_id": "requirement",
        "status": "completed",
        "owner_id": "user:reader",
        "owner_active": False,
        "acceptance": {"available": True, "criteria": ["Checked behavior"]},
    }
    gates = stage_gates({"id": "requirement"}, {**default_flow(), "stage": stage}, [task], [])
    assert any(gate["id"] == "assignment" and gate["ok"] is False for gate in gates)


@pytest.mark.parametrize("owner_id", [None, True, 17])
def test_delivery_owner_edit_rejects_explicit_non_string_values(env, owner_id):
    client, sessions, _ = env
    task = create(client)
    response = command(
        client, "task.update", {"id": task["id"], "task_basis": task["basis"], "owner_id": owner_id}
    )
    assert response.status_code == 422, response.text
    with sessions() as db:
        assert db.get(Task, task["id"]).owner_id == "user:lead"


def test_delivery_owner_edit_distinguishes_omitted_owner_from_explicit_clear(env):
    client, sessions, _ = env
    task = create(client)
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert review(client, task["id"]).status_code == 200
    response = command(client, "task.update", {"id": task["id"], "blocked_reason": ""})
    assert response.status_code == 200, response.text
    current = next(row for row in response.json()["tasks"] if row["id"] == task["id"])
    assert current["owner_id"] == "user:lead"
    assert current["verified"]
    rejected = command(
        client, "task.update", {"id": task["id"], "task_basis": current["basis"], "owner_id": None}
    )
    assert rejected.status_code == 422
    with sessions() as db:
        assert not db.query(DeliveryTaskReview).one().invalidated
        assert db.get(Task, task["id"]).owner_id == "user:lead"
    assert command(client, "task.update", {"id": task["id"], "owner_id": ""}).status_code == 422
    response = command(
        client, "task.update", {"id": task["id"], "task_basis": current["basis"], "owner_id": ""}
    )
    assert response.status_code == 200, response.text
    with sessions() as db:
        assert db.get(Task, task["id"]).owner_id == ""
        assert db.query(DeliveryTaskReview).one().invalidated
