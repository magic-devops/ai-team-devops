"""Real SQL decisions distinguish recorded manual work from verified delivery."""

import pytest
from sop_manager.routers import sql_models as models
from sop_manager.routers.delivery_progress_facts import capture_facts
from sqlalchemy import delete, update
from test_delivery_execution import bridge as delivery_bridge
from test_delivery_workbench import command, requirement
from test_delivery_workbench import env as delivery_env

env = delivery_env
bridge = delivery_bridge


def make_task(client):
    rid = requirement(client)
    state = command(
        client,
        "task.create",
        {
            "requirement_id": rid,
            "title": "Human delivery",
            "owner_id": "user:lead",
            "requirement_criteria_indices": [0],
        },
    ).json()
    return next(t for t in state["tasks"] if t["req_id"] == rid)


def reviews(client, tid, **params):
    return client.get(f"/api/v1/delivery/tasks/{tid}/reviews", params=params)


def review_current(client, tid):
    return client.get(f"/api/v1/delivery/tasks/{tid}/review-current")


def review_detail(client, tid, review_id):
    return client.get(f"/api/v1/delivery/tasks/{tid}/reviews/{review_id}")


def review(client, tid, *, decision="accept", **changes):
    response = review_current(client, tid)
    assert response.status_code == 200, response.text
    payload = {
        "task_id": tid,
        "decision": decision,
        "basis": response.json()["current"]["basis"],
        "comment": "Checked current scope and delivery",
        "evidence_content": "Manual verification: inspected requested behavior",
        "evidence_url": "",
        **changes,
    }
    return command(client, "task.manual_review", payload)


def completed(client):
    task = make_task(client)
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    return task


def facts(sessions):
    with sessions() as db:
        return capture_facts(db, db.get(models.Project, "project"))


def test_completed_record_requires_explicit_manual_decision_before_it_is_verified(env):  # noqa: F811
    client, sessions, _ = env
    task = completed(client)
    before = facts(sessions)
    assert before["tasks"][0]["status"] == "recorded_completed"
    current = review_current(client, task["id"])
    assert current.status_code == 200, current.text
    assert current.json()["current"]["can_accept"]
    assert review(client, task["id"]).status_code == 200
    assert facts(sessions)["tasks"][0]["status"] == "verified_completed"
    history = reviews(client, task["id"]).json()
    proof = review_current(client, task["id"]).json()
    assert proof["current"]["verified"]
    assert history["reviews"][0]["source"] == "manual"
    assert proof["effective_review_id"] == history["reviews"][0]["id"]
    assert history["reviews"][0]["reviewer"] == {"id": "lead", "name": "lead"}
    original = review_detail(client, task["id"], proof["effective_review_id"]).json()["review"]
    assert original["snapshot"]["task"]["title"] == "Human delivery"


def test_actual_manual_ack_binds_original_task_and_replays_the_same_result(env):  # noqa: F811
    client, _, _ = env
    task = completed(client)
    current = review_current(client, task["id"]).json()
    original = {
        "action": "task.manual_review",
        "expected_version": current["version"],
        "idempotency_key": "fixed-task-review-ack",
        "payload": {
            "task_id": task["id"],
            "basis": current["current"]["basis"],
            "decision": "accept",
            "comment": "Checked this exact task",
            "evidence_content": "Human evidence",
        },
    }
    saved = client.post("/api/v1/delivery/commands", json=original)
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["result"] == {"task_ids": [task["id"]]}
    assert body["resource"]["kind"] == "task_review" and body["resource"]["id"]
    assert body["resource"] in body["affected_refs"]
    assert {"kind": "task", "id": task["id"]} in body["affected_refs"]
    replay = client.post("/api/v1/delivery/commands", json=original)
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert replay.json()["result"] == body["result"]
    assert replay.json()["affected_refs"] == body["affected_refs"]


def test_recorded_predecessor_stays_blocked_until_review_then_successor_starts(env):  # noqa: F811
    client, _, _ = env
    first = completed(client)
    rid = first["req_id"]
    saved = command(
        client,
        "task.create",
        {"requirement_id": rid, "title": "Successor", "owner_id": "user:lead", "depends_on": [first["id"]]},
    )
    successor = next(t for t in saved.json()["tasks"] if t["title"] == "Successor")
    assert command(client, "task.update", {"id": successor["id"], "status": "in_progress"}).status_code == 409
    assert review(client, first["id"]).status_code == 200
    assert command(client, "task.update", {"id": successor["id"], "status": "in_progress"}).status_code == 200


def test_current_basis_catches_legacy_edits_without_workspace_version_change_and_preserves_receipt(env):  # noqa: F811
    client, sessions, _ = env
    task = completed(client)
    current = review_current(client, task["id"])
    assert current.status_code == 200, current.text
    frozen = current.json()
    payload = {
        "task_id": task["id"],
        "decision": "accept",
        "basis": frozen["current"]["basis"],
        "comment": "Checked",
        "evidence_content": "Manual evidence",
    }
    with sessions() as db:
        db.get(models.Task, task["id"]).title = "Legacy edit"
        db.commit()
    failed = command(
        client, "task.manual_review", payload, version=frozen["version"], key="same-review-input"
    )
    assert failed.status_code == 409
    assert failed.json()["detail"]["code"] == "task_review_basis_changed"
    payload["basis"] = review_current(client, task["id"]).json()["current"]["basis"]
    accepted = command(client, "task.manual_review", payload, key="accepted-review")
    assert accepted.status_code == 200, accepted.text
    replay = command(client, "task.manual_review", payload, version=frozen["version"], key="accepted-review")
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert reviews(client, task["id"]).json()["total"] == 1


@pytest.mark.parametrize("write", ["orm", "core", "compat"])
def test_scope_a_b_a_permanently_invalidates_old_acceptance_in_the_same_business_transaction(
    env,
    monkeypatch,
    write,  # noqa: F811
):
    client, sessions, _ = env
    task = completed(client)
    assert review(client, task["id"]).status_code == 200
    original = task["title"]
    for title in ["Changed content", original]:
        with sessions() as db:
            if write == "core":
                db.execute(update(models.Task).where(models.Task.id == task["id"]).values(title=title))
                db.commit()
            elif write == "compat":
                from sop_manager.routers import db_sql_compat

                monkeypatch.setattr(db_sql_compat, "resolved_tenant_id", lambda: "tenant")
                monkeypatch.setattr(db_sql_compat, "resolved_project_id", lambda: "project")
                db_sql_compat._SqlTable(models.Task, db).update(f"id = '{task['id']}'", {"title": title})
            else:
                db.get(models.Task, task["id"]).title = title
                db.commit()
    result = reviews(client, task["id"]).json()
    assert result["reviews"][0]["invalidated"]
    assert result["reviews"][0]["invalidated_at"]
    assert not review_current(client, task["id"]).json()["current"]["verified"]
    assert facts(sessions)["tasks"][0]["status"] == "recorded_completed"
    assert review(client, task["id"]).status_code == 200
    assert reviews(client, task["id"]).json()["total"] == 2


def test_date_changes_preserve_accepted_work_but_request_changes_appends_and_reopens(env):  # noqa: F811
    client, sessions, _ = env
    task = completed(client)
    assert review(client, task["id"]).status_code == 200
    before = review_current(client, task["id"]).json()["current"]["basis"]
    assert (
        command(
            client, "task.update", {"id": task["id"], "starts_on": "2026-10-20", "ends_on": "2026-10-23"}
        ).status_code
        == 200
    )
    current = review_current(client, task["id"]).json()["current"]
    assert current["basis"] == before and current["verified"]
    assert review(client, task["id"], decision="request_changes", evidence_content="").status_code == 200
    result = reviews(client, task["id"]).json()
    proof = review_current(client, task["id"]).json()
    assert proof["current"]["task"]["status"] == "in_progress"
    assert not proof["current"]["verified"] and proof["effective_review_id"] is None
    assert result["reviews"][0]["decision"] == "request_changes"
    assert facts(sessions)["tasks"][0]["status"] == "in_progress"


def test_deleted_and_moved_tasks_keep_original_project_read_only_history(env):  # noqa: F811
    client, sessions, _ = env
    task = completed(client)
    assert review(client, task["id"]).status_code == 200
    with sessions() as db:
        # Application reparenting is forbidden. Simulate out-of-band database
        # damage, then explicitly capture the resulting proof invalidation.
        with db.get_bind().begin() as connection:
            connection.execute(
                update(models.Task).where(models.Task.id == task["id"]).values(project_id="other")
            )
        from sop_manager.routers.delivery_progress_capture import record_observation

        record_observation(db, db.get(models.Project, "project"))
        db.commit()
    original = reviews(client, task["id"])
    assert original.status_code == 200 and review_current(client, task["id"]).status_code == 404
    assert original.json()["reviews"][0]["invalidated"]
    assert (
        client.get(f"/api/v1/delivery/tasks/{task['id']}/reviews", headers={"X-Project-Id": "other"}).json()[
            "reviews"
        ]
        == []
    )
    with sessions() as db:
        db.execute(delete(models.Task).where(models.Task.id == task["id"]))
        db.commit()
    assert reviews(client, task["id"]).status_code == 200
    assert review_current(client, task["id"]).status_code == 404
    assert reviews(client, "unknown-task").status_code == 404


def test_review_rejects_reader_pending_unsafe_evidence_and_allows_responsible_agent(env):  # noqa: F811
    client, _, actor = env
    task = make_task(client)
    assert review(client, task["id"]).status_code == 409
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    actor["id"] = "reader"
    value = review_current(client, task["id"]).json()
    assert not value["current"]["can_review"]
    assert review(client, task["id"]).status_code == 403
    actor["id"] = "lead"
    assert review(client, task["id"], evidence_content="", evidence_url="").status_code == 422
    assert review(client, task["id"], evidence_url="javascript:alert(1)").status_code == 422
    agent = command(client, "member.save", {"name": "Person-like agent", "kind": "agent"}).json()["members"][
        -1
    ]
    basis = review_current(client, task["id"]).json()["current"]["basis"]
    assert (
        command(
            client, "task.update", {"id": task["id"], "owner_id": agent["id"], "task_basis": basis}
        ).status_code
        == 200
    )
    assert review_current(client, task["id"]).json()["current"]["eligible"]
    assert review(client, task["id"]).status_code == 200


def test_standalone_human_review_and_pagination_are_read_only(env):  # noqa: F811
    client, sessions, _ = env
    with sessions() as db:
        db.add(
            models.Task(
                id="standalone",
                tenant_id="tenant",
                project_id="project",
                title="Independent",
                acceptance_criteria=["Independent behavior verified"],
                owner_id="user:lead",
                status="completed",
            )
        )
        db.commit()
    for i in range(3):
        assert review(client, "standalone", comment=f"Review {i}").status_code == 200
    with sessions() as db:
        count = db.query(models.DeliveryProgressObservation).count()
        version = db.get(models.DeliveryWorkspace, "project").version
    first = reviews(client, "standalone", limit=2).json()
    second = reviews(client, "standalone", limit=2, cursor=first["next_cursor"]).json()
    assert first["total"] == 3 and len(first["reviews"]) == 2
    assert len(second["reviews"]) == 1 and second["next_cursor"] is None
    assert review_current(client, "standalone").json()["effective_review_id"] == first["reviews"][0]["id"]
    assert second["reviews"][0]["id"] != first["reviews"][0]["id"]
    assert reviews(client, "standalone", cursor="foreign-review").status_code == 422
    with sessions() as db:
        assert db.query(models.DeliveryProgressObservation).count() == count
        assert db.get(models.DeliveryWorkspace, "project").version == version


@pytest.mark.parametrize("write", ["orm", "core"])
def test_human_identity_a_b_a_cannot_restore_old_delivery_after_inactivation(env, write):  # noqa: F811
    client, sessions, _ = env
    task = completed(client)
    assert review(client, task["id"]).status_code == 200
    for status in ["suspended", "active"]:
        with sessions() as db:
            if write == "core":
                db.execute(update(models.User).where(models.User.id == "lead").values(status=status))
            else:
                db.get(models.User, "lead").status = status
            db.commit()
    result = reviews(client, task["id"]).json()
    assert result["reviews"][0]["invalidated"]
    assert not review_current(client, task["id"]).json()["current"]["verified"]


def test_removing_human_membership_invalidates_its_delivery_but_not_reviewer_history(env):  # noqa: F811
    client, sessions, actor = env
    with sessions() as db:
        unusable_hash = "not-a-login"
        db.add(
            models.User(
                id="dev",
                tenant_id="tenant",
                username="Developer",
                role="developer",
                status="active",
                password_hash=unusable_hash,
            )
        )
        db.flush()
        db.add(models.ProjectMember(project_id="project", user_id="dev", role="developer"))
        db.commit()
    task = completed(client)
    basis = review_current(client, task["id"]).json()["current"]["basis"]
    assert (
        command(
            client, "task.update", {"id": task["id"], "owner_id": "user:dev", "task_basis": basis}
        ).status_code
        == 200
    )
    assert review(client, task["id"]).status_code == 200
    with sessions() as db:
        # The old reviewer loses its approval role, but its legitimate decision remains.
        db.add(models.ProjectMember(project_id="project", user_id="lead", role="viewer"))
        db.get(models.User, "lead").role = "viewer"
        db.commit()
    assert review_current(client, task["id"]).json()["current"]["verified"]
    with sessions() as db:
        db.delete(db.get(models.ProjectMember, ("project", "dev")))
        db.commit()
    result = reviews(client, task["id"]).json()
    assert result["reviews"][0]["invalidated"]
    assert not review_current(client, task["id"]).json()["current"]["eligible"]


def test_predecessor_content_change_invalidates_entire_accepted_chain_permanently(env):  # noqa: F811
    client, sessions, _ = env
    first = completed(client)
    assert review(client, first["id"]).status_code == 200
    created = command(
        client,
        "task.create",
        {
            "requirement_id": first["req_id"],
            "title": "Dependent",
            "requirement_criteria_indices": [0],
            "owner_id": "user:lead",
            "depends_on": [first["id"]],
        },
    ).json()
    successor = next(t for t in created["tasks"] if t["title"] == "Dependent")
    assert command(client, "task.update", {"id": successor["id"], "status": "completed"}).status_code == 200
    assert review(client, successor["id"]).status_code == 200
    for title in ["New predecessor scope", first["title"]]:
        with sessions() as db:
            db.get(models.Task, first["id"]).title = title
            db.commit()
    for task in [first, successor]:
        result = reviews(client, task["id"]).json()
        assert result["reviews"][0]["invalidated"]
        assert not review_current(client, task["id"]).json()["current"]["verified"]
    assert review_current(client, successor["id"]).json()["current"]["dependency_blocked"] == [first["id"]]


def test_native_execution_cannot_be_accepted_through_manual_review(bridge):  # noqa: F811
    from test_delivery_execution import queue

    client, _, _, _, _, _, task = bridge
    queue(bridge)
    response = review_current(client, task["id"])
    assert response.status_code == 200, response.text
    assert not response.json()["current"]["eligible"]
    assert response.json()["current"]["reasons"][0]["code"] == "manual_review_execution_managed"
    assert review(client, task["id"]).status_code == 409


def test_invalidation_and_business_edits_rollback_together(env, monkeypatch):  # noqa: F811
    from sop_manager.routers import delivery_progress_capture

    client, sessions, _ = env
    task = completed(client)
    assert review(client, task["id"]).status_code == 200

    def fail(*args, **kwargs):
        raise RuntimeError("Failed progress capture")

    monkeypatch.setattr(delivery_progress_capture, "evaluate_project", fail)
    with sessions() as db:
        db.get(models.Task, task["id"]).title = "Uncommitted"
        with pytest.raises(RuntimeError, match="Failed progress"):
            db.commit()
        db.rollback()
        assert db.get(models.Task, task["id"]).title == task["title"]
        assert not db.query(models.DeliveryTaskReview).one().invalidated


def test_independent_task_dependencies_use_fixed_task_basis_and_no_requirement_proxy(env):  # noqa: F811
    client, sessions, _ = env
    with sessions() as db:
        db.add_all(
            [
                models.Task(
                    id="first",
                    tenant_id="tenant",
                    project_id="project",
                    title="First",
                    acceptance_criteria=["First behavior verified"],
                    owner_id="user:lead",
                    status="completed",
                ),
                models.Task(
                    id="second",
                    tenant_id="tenant",
                    project_id="project",
                    title="Second",
                    acceptance_criteria=["Second behavior verified"],
                    owner_id="user:lead",
                    status="pending",
                ),
            ]
        )
        db.commit()
    tasks = {task["id"]: task for task in client.get("/api/v1/delivery/workspace").json()["tasks"]}
    assert "basis" in tasks["second"], "Unified planning needs an authoritative task basis"
    payload = {
        "id": "second",
        "task_basis": tasks["second"]["basis"],
        "depends_on": ["first"],
        "requirement_criteria_indices": [],
    }
    saved = command(client, "task.update", payload)
    assert saved.status_code == 200, saved.text
    assert command(client, "task.update", {"id": "second", "status": "in_progress"}).status_code == 409
    assert review(client, "first").status_code == 200
    assert command(client, "task.update", {"id": "second", "status": "in_progress"}).status_code == 200
    stale = command(client, "task.update", {**payload, "depends_on": []})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "task_basis_changed"
    latest = next(t for t in client.get("/api/v1/delivery/workspace").json()["tasks"] if t["id"] == "second")
    assert (
        command(
            client,
            "task.update",
            {"id": "second", "task_basis": latest["basis"], "requirement_criteria_indices": [0]},
        ).status_code
        == 422
    )


def test_requirement_blocking_reason_prevents_task_start_without_partial_write(env):  # noqa: F811
    client, sessions, _ = env
    task = make_task(client)
    assert (
        command(
            client,
            "requirement.update",
            {
                "id": task["req_id"],
                "blocked_reason": "Awaiting product approval",
            },
        ).status_code
        == 200
    )
    result = command(client, "task.update", {"id": task["id"], "status": "in_progress"})
    assert result.status_code == 409, result.text
    with sessions() as db:
        assert db.get(models.Task, task["id"]).status == "pending"
