"""Task-owned acceptance is canonical and gates native/manual delivery."""

# ruff: noqa: F811 - shared pytest fixtures are imported and injected by name.

import pytest
from sop_manager.routers.sql_models import (
    DeliveryProgressObservation,
    DeliveryTaskReview,
    DeliveryWorkspace,
    Project,
    Requirement,
    Task,
    Tenant,
    User,
    get_session,
)
from sqlalchemy import update
from test_delivery_execution import bridge, cancel_execution, finish, queue_payload, sync  # noqa: F401
from test_delivery_manual_review import review, reviews
from test_delivery_workbench import command, env, requirement  # noqa: F401


def create(client, **payload):
    response = command(client, "task.create", {"title": "Standalone", "owner_id": "user:lead", **payload})
    assert response.status_code == 200, response.text
    return next(t for t in response.json()["tasks"] if t["title"] == payload.get("title", "Standalone"))


def test_standalone_task_has_own_canonical_acceptance_and_manual_review(env):
    client, sessions, _ = env
    task = create(client, acceptance_criteria=["Requested behavior is verified"])
    assert task["req_id"] == ""
    assert task["acceptance"]["criteria"] == ["Requested behavior is verified"]
    assert task["execution_gate"]["eligible"]
    with sessions() as db:
        assert db.get(Task, task["id"]).acceptance_criteria == ["Requested behavior is verified"]
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert reviews(client, task["id"]).json()["current"]["acceptance"]["available"]
    assert review(client, task["id"]).status_code == 200


def test_effective_acceptance_only_includes_explicit_requirement_indices(env):
    client, _, _ = env
    rid = requirement(client)
    assert (
        command(
            client, "requirement.update", {"id": rid, "acceptance_criteria": ["Selected", "Excluded"]}
        ).status_code
        == 200
    )
    task = create(
        client, requirement_id=rid, acceptance_criteria=["Task-specific"], requirement_criteria_indices=[0]
    )
    assert task["acceptance"]["criteria"] == ["Task-specific", "Selected"]
    assert task["acceptance"]["sources"] == [
        {"source": "task", "index": 0, "text": "Task-specific"},
        {"source": "requirement", "index": 0, "text": "Selected"},
    ]
    assert "acceptance_criteria" not in task["planning"]
    assert task["planning"]["requirement_criteria_indices"] == [0]


def test_empty_acceptance_draft_cannot_be_manually_accepted(env):
    client, _, _ = env
    task = create(client)
    assert not task["execution_gate"]["eligible"]
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert not reviews(client, task["id"]).json()["current"]["can_accept"]
    assert review(client, task["id"]).status_code == 409


def test_requirement_references_need_explicit_readoption_and_own_edit_does_not_adopt(env):
    client, _, _ = env
    rid = requirement(client)
    task = create(client, requirement_id=rid, requirement_criteria_indices=[0])
    assert (
        command(client, "requirement.update", {"id": rid, "acceptance_criteria": ["New meaning"]}).status_code
        == 200
    )
    task = client.get("/api/v1/delivery/workspace").json()["tasks"][0]
    assert not task["acceptance"]["available"]
    assert task["execution_gate"]["reasons"][0]["code"] == "task_requirement_basis_changed"
    edited = command(
        client,
        "task.update",
        {"id": task["id"], "task_basis": task["basis"], "acceptance_criteria": ["Own condition"]},
    )
    assert edited.status_code == 200, edited.text
    task = edited.json()["tasks"][0]
    assert not task["acceptance"]["available"]
    adopted = command(
        client,
        "task.update",
        {"id": task["id"], "task_basis": task["basis"], "requirement_criteria_indices": [0]},
    )
    assert adopted.status_code == 200, adopted.text
    assert adopted.json()["tasks"][0]["acceptance"]["criteria"] == ["Own condition", "New meaning"]
    assert adopted.json()["tasks"][0]["acceptance"]["available"]


def test_empty_native_draft_is_blocked_before_creating_runtime_envelope(bridge):
    client, _, store, principal, workspace, _, _ = bridge
    task = create(client)
    response = command(
        client,
        "execution.queue",
        {**queue_payload(bridge), "task_id": task["id"], "task_basis": task["basis"]},
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "task_acceptance_missing"
    assert store.list(principal, workspace["id"], "tasks") == []


def test_standalone_native_tests_and_review_do_not_create_requirement_flow(bridge):
    client, sessions, _, _, _, rid, _ = bridge
    task = create(client, acceptance_criteria=["Standalone command passes"])
    body = {**queue_payload(bridge), "task_id": task["id"], "task_basis": task["basis"]}
    preview = client.post("/api/v1/delivery/execution-preview", json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()["snapshot"]["requirement"] is None
    assert preview.json()["snapshot"]["task_acceptance_criteria"] == ["Standalone command passes"]
    response = command(client, "execution.queue", body)
    assert response.status_code == 200, response.text
    intent = response.json()["executions"][-1]
    execution = sync(bridge, intent)
    finish(bridge, execution)
    execution = sync(bridge, intent)
    accepted = command(
        client,
        "execution.review",
        {
            "id": intent["id"],
            "decision": "accept",
            "comment": "Test checked",
            "run_version": execution["run_version"],
        },
    )
    assert accepted.status_code == 200, accepted.text
    assert (
        next(t for t in accepted.json()["tasks"] if t["id"] == task["id"])["delivery_status"]
        == "verified_completed"
    )
    with sessions() as db:
        data = db.get(DeliveryWorkspace, "project").data
        assert "" not in data["flows"]
        assert data["flows"][rid]["artifacts"] == []
        assert data["executions"][-1]["results"]["tests"]["succeeded"] is True
    observation = client.get(f"/api/v1/delivery/executions/{intent['id']}/observations")
    assert observation.status_code == 200, observation.text
    assert observation.json()["tests"]["status"] == "passed"


@pytest.mark.parametrize("writer", ["orm", "core", "compat", "sync", "import"])
def test_native_scope_change_and_restore_permanently_invalidates_receipt(bridge, writer, monkeypatch):
    client, sessions, _, _, _, _, _ = bridge
    task = create(client, acceptance_criteria=["Original condition"])
    response = command(
        client,
        "execution.queue",
        {**queue_payload(bridge), "task_id": task["id"], "task_basis": task["basis"]},
    )
    assert response.status_code == 200, response.text
    intent = response.json()["executions"][-1]
    from sop_manager.routers import data_exchange, db_sql_compat, sync_api

    monkeypatch.setattr(db_sql_compat, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(db_sql_compat, "resolved_project_id", lambda: "project")
    monkeypatch.setattr(sync_api, "_require_scope", lambda: "project")
    monkeypatch.setattr(sync_api, "resolved_tenant_id", lambda: "tenant")
    monkeypatch.setattr(sync_api, "_ws_sync_event", lambda *args: None)
    for criteria in (["Changed condition"], ["Original condition"]):
        with sessions() as db:
            if writer == "orm":
                db.get(Task, task["id"]).acceptance_criteria = criteria
            elif writer == "core":
                db.execute(update(Task).where(Task.id == task["id"]).values(acceptance_criteria=criteria))
            elif writer == "compat":
                db_sql_compat._SqlTable(Task, db).update(
                    f"id = '{task['id']}'", {"acceptance_criteria": criteria}
                )
            elif writer == "sync":
                from event_handoff_support import direct_sync

                observed = client.get(f"/api/v1/delivery/tasks/{task['id']}").json()["task"]
                result = direct_sync(
                    db,
                    "project",
                    record={"id": task["id"], "acceptance_criteria": criteria},
                    task_basis=observed["basis"],
                )
                assert result["processing"]["state"] == "processed", result
            else:
                data_exchange._merge_table(
                    db, "tasks", [{"id": task["id"], "acceptance_criteria": criteria}], "tenant", "project"
                )
            db.commit()
    with sessions() as db:
        entry = next(
            e for e in db.get(DeliveryWorkspace, "project").data["executions"] if e["id"] == intent["id"]
        )
        assert entry["planning_invalidated"] is True
        assert entry["snapshot"]["task_acceptance_criteria"] == ["Original condition"]
    response = command(client, "execution.sync", {"id": intent["id"]})
    assert response.status_code == 409


@pytest.mark.parametrize("mutation", ["deleted", "foreign"])
def test_missing_linked_requirement_cannot_turn_into_independent_task(env, mutation):
    client, sessions, _ = env
    rid = requirement(client)
    task = create(client, requirement_id=rid, acceptance_criteria=["Own condition"])
    with sessions() as db:
        row = db.get(Requirement, rid)
        if mutation == "deleted":
            db.delete(row)
            db.commit()
        else:
            # Simulate external database tampering, which is outside the
            # application Session guard; ordinary reparenting is now forbidden.
            with db.get_bind().begin() as connection:
                connection.execute(
                    update(Requirement).where(Requirement.id == rid).values(project_id="other")
                )
    task = client.get("/api/v1/delivery/workspace").json()["tasks"][0]
    assert not task["acceptance"]["available"]
    assert task["execution_gate"]["reasons"][0]["code"] == "task_requirement_missing"
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert review(client, task["id"]).status_code == 409


def test_old_review_snapshot_is_readable_without_fabricating_task_conditions(env):
    client, sessions, _ = env
    task = create(client, acceptance_criteria=["Present condition"])
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert review(client, task["id"]).status_code == 200
    with sessions() as db:
        row = db.query(DeliveryTaskReview).one()
        old = dict(row.snapshot)
        old.pop("acceptance")
        old["task"] = {key: value for key, value in old["task"].items() if key != "acceptance_criteria"}
        old["planning"] = {"acceptance_criteria": [0], "depends_on": []}
        row.snapshot = old
        db.commit()
    response = reviews(client, task["id"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reviews"][0]["snapshot"]["acceptance"] is None
    assert body["reviews"][0]["snapshot"]["task"]["acceptance_criteria"] is None
    assert body["reviews"][0]["snapshot"]["planning"]["requirement_criteria_indices"] is None
    assert body["current"]["acceptance"] is not None
    with sessions() as db:
        assert db.query(DeliveryTaskReview).one().snapshot == old


def test_old_native_run_cannot_change_reparented_task_status(bridge):
    client, sessions, _, _, _, _, _ = bridge
    task = create(client, acceptance_criteria=["Original condition"])
    response = command(
        client,
        "execution.queue",
        {**queue_payload(bridge), "task_id": task["id"], "task_basis": task["basis"]},
    )
    intent = response.json()["executions"][-1]
    execution = sync(bridge, intent)
    rid = requirement(client)
    with sessions() as db:
        row = db.get(Task, task["id"])
        row.req_id, row.status = rid, "pending"
        db.commit()
    finish(bridge, execution)
    observed = sync(bridge, intent)
    assert observed["stale"]
    with sessions() as db:
        assert db.get(Task, task["id"]).status == "pending"
    assert (
        command(
            client,
            "execution.review",
            {
                "id": intent["id"],
                "decision": "accept",
                "comment": "Old scope",
                "run_version": observed["run_version"],
            },
        ).status_code
        == 409
    )


def test_cancel_invalidated_intent_preserves_current_task_status_and_allows_new_dispatch(bridge):
    client, sessions, _, _, _, _, _ = bridge
    task = create(client, acceptance_criteria=["Original condition"])
    response = command(
        client,
        "execution.queue",
        {**queue_payload(bridge), "task_id": task["id"], "task_basis": task["basis"]},
    )
    intent = response.json()["executions"][-1]
    with sessions() as db:
        row = db.get(Task, task["id"])
        row.acceptance_criteria, row.status = ["Changed condition"], "pending"
        db.commit()
    observed = client.get(f"/api/v1/delivery/executions/{intent['id']}/observations")
    assert observed.status_code == 200, observed.text
    assert observed.json()["stale"] and observed.json()["permissions"]["can_cancel"]
    cancelled = cancel_execution(client, intent["id"])
    assert cancelled.status_code == 200, cancelled.text
    task = next(t for t in cancelled.json()["tasks"] if t["id"] == task["id"])
    assert task["status"] == "pending"
    fresh = command(
        client,
        "execution.queue",
        {**queue_payload(bridge), "task_id": task["id"], "task_basis": task["basis"]},
    )
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["executions"][-1]["snapshot"]["task_acceptance_criteria"] == ["Changed condition"]


def test_linked_task_own_conditions_allow_dispatch_without_parent_conditions(bridge):
    client, _, _, _, _, rid, _ = bridge
    assert command(client, "requirement.update", {"id": rid, "acceptance_criteria": []}).status_code == 200
    task = create(client, requirement_id=rid, acceptance_criteria=["Task behavior checked"])
    response = client.post(
        "/api/v1/delivery/execution-preview",
        json={**queue_payload(bridge), "task_id": task["id"], "task_basis": task["basis"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["snapshot"]["acceptance_criteria"] == ["Task behavior checked"]
    assert response.json()["snapshot"]["requirement"]["acceptance_criteria"] == []


def test_old_native_snapshot_get_is_pure_and_pending_unknown_receipt_cannot_cancel(bridge):
    client, sessions, _, _, _, rid, task = bridge
    response = command(client, "execution.queue", queue_payload(bridge))
    intent = response.json()["executions"][-1]
    with sessions() as db:
        workspace = db.get(DeliveryWorkspace, "project")
        data = {**workspace.data, "executions": [dict(e) for e in workspace.data["executions"]]}
        old = {
            "task_id": task["id"],
            "title": task["title"],
            "description": "",
            "assigned_to": "lead",
            "requirement_id": rid,
            "requirement_title": "Search",
            "requirement_description": "Search project work",
            "acceptance_criteria": ["Find a requirement by title"],
            "revision": 1,
        }
        data["executions"][-1]["snapshot"] = old
        workspace.data = data
        db.commit()
    with sessions() as db:
        version = db.get(DeliveryWorkspace, "project").version
    state = client.get("/api/v1/delivery/workspace")
    assert state.status_code == 200, state.text
    assert state.json()["executions"][-1]["snapshot"] == old
    observation = client.get(f"/api/v1/delivery/executions/{intent['id']}/observations")
    assert observation.status_code == 200, observation.text
    assert observation.json()["stale"]
    assert not any(observation.json()["permissions"].values())
    assert cancel_execution(client, intent["id"]).status_code == 409
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project").version == version
        assert db.get(DeliveryWorkspace, "project").data["executions"][-1]["snapshot"] == old


@pytest.mark.parametrize("writer", ["orm", "core"])
def test_collective_requirement_approval_cannot_revive_after_task_own_condition_a_b_a(env, writer):
    client, sessions, _ = env
    rid = requirement(client)
    for kind in (None, "prd", "prototype", "architecture"):
        if kind:
            assert (
                command(
                    client,
                    "artifact.add",
                    {"requirement_id": rid, "kind": kind, "title": kind, "content": "Reviewed design"},
                ).status_code
                == 200
            )
        assert (
            command(client, "stage.advance", {"requirement_id": rid, "comment": "Reviewed"}).status_code
            == 200
        )
    task = create(client, requirement_id=rid, acceptance_criteria=["Original condition"])
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
                "content": "Conditions tested",
                "result": "passed",
            },
        ).status_code
        == 200
    )
    assert (
        command(client, "stage.advance", {"requirement_id": rid, "comment": "Tests reviewed"}).status_code
        == 200
    )
    accepted = command(client, "stage.advance", {"requirement_id": rid, "comment": "Human acceptance"})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["tasks"][0]["verified"]
    for conditions in (["Changed condition"], ["Original condition"]):
        with sessions() as db:
            if writer == "orm":
                db.get(Task, task["id"]).acceptance_criteria = conditions
            else:
                db.execute(update(Task).where(Task.id == task["id"]).values(acceptance_criteria=conditions))
            db.commit()
            flow = db.get(DeliveryWorkspace, "project").data["flows"][rid]
            assert flow["stage"] == "intake" and flow["revision"] > 1
            assert flow["reviews"][-1]["decision"] == "reopen"
            assert db.get(Task, task["id"]).status == "completed"
    state = client.get("/api/v1/delivery/workspace").json()
    assert not state["tasks"][0]["verified"]
    assert state["summary"]["accepted"] == 0


@pytest.mark.parametrize("writer", ["orm", "core", "bulk"])
@pytest.mark.parametrize(
    "field,changed,restored", [("status", "suspended", "active"), ("username", "New name", "lead")]
)
def test_native_owner_status_invalidates_but_display_name_change_preserves_receipt(
    bridge, writer, field, changed, restored
):
    client, sessions, _, _, _, _, _ = bridge
    response = command(client, "execution.queue", queue_payload(bridge))
    intent = response.json()["executions"][-1]
    for value in (changed, restored):
        with sessions() as db:
            if writer == "orm":
                setattr(db.get(User, "lead"), field, value)
            elif writer == "core":
                db.execute(update(User).where(User.id == "lead").values(**{field: value}))
            else:
                db.execute(update(User), [{"id": "lead", field: value}])
            db.commit()
    with sessions() as db:
        assert db.query(DeliveryTaskReview).count() == 0
        entry = db.get(DeliveryWorkspace, "project").data["executions"][-1]
        assert bool(entry.get("planning_invalidated")) is (field == "status")
        assert entry["snapshot"]["owner"]["name"] == "lead"
    assert command(client, "execution.sync", {"id": intent["id"]}).status_code == (
        409 if field == "status" else 200
    )


def test_same_name_owner_in_another_tenant_does_not_invalidate_native_delivery(bridge):
    client, sessions, _, _, _, _, _ = bridge
    assert command(client, "execution.queue", queue_payload(bridge)).status_code == 200
    with sessions() as db:
        db.add(Tenant(id="separate", name="Separate", slug="separate"))
        db.flush()
        unusable_hash = "not-a-login"
        db.add_all(
            [
                User(
                    id="separate-lead",
                    tenant_id="separate",
                    username="lead",
                    password_hash=unusable_hash,
                    role="tenant_admin",
                ),
                Project(id="separate-project", tenant_id="separate", name="Separate project"),
                Task(
                    id="separate-task",
                    tenant_id="separate",
                    project_id="separate-project",
                    title="Separate task",
                    owner_id="user:separate-lead",
                    acceptance_criteria=["Separate criterion"],
                ),
            ]
        )
        db.commit()
        original = db.get(DeliveryWorkspace, "project").data
        observations = db.query(DeliveryProgressObservation).filter_by(project_id="project").count()
    with sessions() as db:
        db.execute(update(User).where(User.id == "separate-lead").values(status="suspended"))
        db.commit()
        assert db.get(DeliveryWorkspace, "project").data == original
        assert db.query(DeliveryProgressObservation).filter_by(project_id="project").count() == observations
        assert not db.get(DeliveryWorkspace, "project").data["executions"][-1].get("planning_invalidated")


@pytest.mark.parametrize("writer", ["orm", "core", "bulk"])
def test_native_owner_invalidation_and_user_edit_rollback_together(bridge, writer, monkeypatch):
    from sop_manager.routers import delivery_progress_capture

    client, sessions, _, _, _, _, _ = bridge
    response = command(client, "execution.queue", queue_payload(bridge))
    intent = response.json()["executions"][-1]

    def fail(*args, **kwargs):
        raise RuntimeError("Capture failed")

    with monkeypatch.context() as patch:
        patch.setattr(delivery_progress_capture, "evaluate_project", fail)
        with sessions() as db:
            if writer == "orm":
                db.get(User, "lead").status = "suspended"
            elif writer == "core":
                db.execute(update(User).where(User.id == "lead").values(status="suspended"))
            else:
                db.execute(update(User), [{"id": "lead", "status": "suspended"}])
            with pytest.raises(RuntimeError, match="Capture failed"):
                db.commit()
            db.rollback()
            assert db.get(User, "lead").status == "active"
            assert not db.get(DeliveryWorkspace, "project").data["executions"][-1].get("planning_invalidated")
    assert command(client, "execution.sync", {"id": intent["id"]}).status_code == 200


def test_cached_workspace_command_cannot_overwrite_permanent_invalidation_from_another_session(bridge):
    client, sessions, _, _, _, _, task = bridge
    assert command(client, "execution.queue", queue_payload(bridge)).status_code == 200
    with sessions() as old:
        cached = old.get(DeliveryWorkspace, "project")
        version = cached.version
        for conditions in (["Changed condition"], ["Find a requirement by title"]):
            with sessions() as fresh:
                fresh.get(Task, task["id"]).acceptance_criteria = conditions
                fresh.commit()
        override = client.app.dependency_overrides[get_session]

        def session():
            yield old

        client.app.dependency_overrides[get_session] = session
        try:
            response = client.post(
                "/api/v1/delivery/commands",
                json={
                    "action": "project.update",
                    "expected_version": version,
                    "idempotency_key": "cached-workspace-command",
                    "payload": {"goal": "Concurrent scope"},
                },
            )
        finally:
            client.app.dependency_overrides[get_session] = override
        assert response.status_code == 409, response.text
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project").data["executions"][-1]["planning_invalidated"]


def test_progress_record_reuses_explicit_command_reservation_when_it_invalidates_native_scope(bridge):
    client, sessions, _, _, _, _, task = bridge
    queued = command(client, "execution.queue", queue_payload(bridge)).json()
    with sessions.kw["bind"].begin() as connection:
        connection.execute(
            update(Task).where(Task.id == task["id"]).values(acceptance_criteria=["Unobserved legacy edit"])
        )
    response = command(client, "progress.record", {})
    assert response.status_code == 200, response.text
    assert response.json()["version"] == response.json()["applied_version"] == queued["version"] + 1
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project").data["executions"][-1]["planning_invalidated"]


def test_explicit_workspace_reservation_is_cleared_after_failed_and_committed_commands(env):
    client, sessions, _ = env
    with sessions() as db:
        override = client.app.dependency_overrides[get_session]

        def session():
            yield db

        client.app.dependency_overrides[get_session] = session
        try:
            failed = command(client, "project.update", {"owner_id": "unknown-owner"})
            assert failed.status_code == 422, failed.text
            assert not db.info.get("delivery_reserved_workspace_versions")
            saved = command(client, "progress.record", {})
            assert saved.status_code == 200, saved.text
            assert saved.json()["version"] == saved.json()["applied_version"] == 1
            assert not db.info.get("delivery_reserved_workspace_versions")
        finally:
            client.app.dependency_overrides[get_session] = override


@pytest.mark.parametrize("mutation", ["conditions", "requirement", "deleted", "foreign"])
def test_stale_completed_intent_can_close_without_changing_terminal_run_or_current_task(bridge, mutation):
    client, sessions, store, principal, workspace, _, _ = bridge
    task = create(client, acceptance_criteria=["Original condition"])
    intent = command(
        client,
        "execution.queue",
        {**queue_payload(bridge), "task_id": task["id"], "task_basis": task["basis"]},
    ).json()["executions"][-1]
    execution = sync(bridge, intent)
    finish(bridge, execution)
    parent = requirement(client) if mutation == "requirement" else None
    with sessions() as db:
        row = db.get(Task, task["id"])
        if mutation == "foreign":
            # Deliberate out-of-band corruption must still not let an old run
            # overwrite a task now stored under a different project.
            with db.get_bind().begin() as connection:
                connection.execute(
                    update(Task).where(Task.id == task["id"]).values(project_id="other", status="pending")
                )
        elif mutation == "deleted":
            db.delete(row)
        else:
            row.status = "pending"
            if mutation == "conditions":
                row.acceptance_criteria = ["Changed condition"]
            elif mutation == "requirement":
                row.req_id = parent
        db.commit()
    execution = sync(bridge, intent)
    assert execution["stale"] and execution["status"] == "awaiting_review"
    assert (
        command(
            client,
            "execution.review",
            {
                "id": intent["id"],
                "decision": "request_changes",
                "comment": "Old scope",
                "run_version": execution["run_version"],
            },
        ).status_code
        == 409
    )
    observation = client.get(f"/api/v1/delivery/executions/{intent['id']}/observations")
    assert observation.status_code == 200, observation.text
    assert observation.json()["permissions"]["can_cancel"]
    original_run = store.get(principal, workspace["id"], "runs", execution["run_id"])
    cancelled = cancel_execution(client, intent["id"])
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["executions"][-1]["status"] == "cancelled"
    assert cancelled.json()["executions"][-1]["snapshot"] == intent["snapshot"]
    assert store.get(principal, workspace["id"], "runs", execution["run_id"]) == original_run
    assert cancel_execution(client, intent["id"]).status_code == 409
    with sessions() as db:
        row = db.get(Task, task["id"])
        if mutation == "deleted":
            assert row is None
        else:
            assert row.status == "pending"
            assert row.project_id == ("other" if mutation == "foreign" else "project")
    if mutation in {"conditions", "requirement"}:
        current = next(t for t in cancelled.json()["tasks"] if t["id"] == task["id"])
        fresh = command(
            client,
            "execution.queue",
            {**queue_payload(bridge), "task_id": task["id"], "task_basis": current["basis"]},
        )
        assert fresh.status_code == 200, fresh.text
        assert fresh.json()["executions"][-1]["id"] != intent["id"]


def test_current_completed_and_reviewed_execution_cannot_bypass_human_review_by_cancel(bridge):
    client, _, store, principal, workspace, _, _ = bridge
    intent = command(client, "execution.queue", queue_payload(bridge)).json()["executions"][-1]
    execution = sync(bridge, intent)
    finish(bridge, execution)
    execution = sync(bridge, intent)
    original_run = store.get(principal, workspace["id"], "runs", execution["run_id"])
    observation = client.get(f"/api/v1/delivery/executions/{intent['id']}/observations")
    assert not observation.json()["permissions"]["can_cancel"]
    assert cancel_execution(client, intent["id"]).status_code == 409
    accepted = command(
        client,
        "execution.review",
        {
            "id": intent["id"],
            "decision": "accept",
            "comment": "Current behavior checked",
            "run_version": execution["run_version"],
        },
    )
    assert accepted.status_code == 200, accepted.text
    assert cancel_execution(client, intent["id"]).status_code == 409
    assert store.get(principal, workspace["id"], "runs", execution["run_id"]) == original_run
