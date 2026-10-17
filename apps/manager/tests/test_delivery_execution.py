"""Real SQL + runtime store tests for the business/execution bridge."""

import sys

import pytest
from hermes_core.execution import Execution
from hermes_core.models import Principal
from hermes_core.transactional import Store
from sop_manager.routers.sql_models import Task, User
from test_delivery_workbench import command, env, requirement  # noqa: F401


@pytest.fixture
def bridge(env, tmp_path, monkeypatch):  # noqa: F811 - pytest fixture injection
    client, sessions, actor = env
    with sessions() as db:
        db.get(User, "lead").role = "super_admin"
        db.commit()
    store = Store("sqlite:///" + str(tmp_path / "runtime.sqlite"))
    client.app.state.hermes_store = store
    executor = Execution(store, tmp_path, agentd=sys.executable)
    executor.allowed_roots = (tmp_path.resolve(),)
    client.app.state.hermes_execution = executor
    from hermes_core import execution_targets

    original_which = execution_targets.shutil.which
    monkeypatch.setattr(
        execution_targets.shutil,
        "which",
        lambda command: sys.executable if command == "codex" else original_which(command),
    )
    p = Principal("lead", tenant="tenant", business="team")
    ws = store.create(
        p, "", "workspaces", {"name": "Test", "root": str(tmp_path), "owner": "lead"}, "ws", "test"
    )
    rid = requirement(client)
    state = command(
        client, "task.create", {"requirement_id": rid, "title": "Implement", "owner_id": "user:lead"}
    ).json()
    task = state["tasks"][0]
    yield client, sessions, store, p, ws, rid, task
    store.engine.dispose()


def queue_payload(bridge):
    client, _, _, _, ws, _, task = bridge
    state = client.get("/api/v1/delivery/workspace").json()
    current = next(t for t in state["tasks"] if t["id"] == task["id"])
    targets = client.get("/api/v1/delivery/execution-targets").json()
    target = next(w for w in targets["workspaces"] if w["id"] == ws["id"])["local"]
    return {
        "task_id": task["id"],
        "workspace_id": ws["id"],
        "task_basis": current["basis"],
        "target_kind": "local",
        "target_basis": target["basis"],
        "nodes": [{"id": "tests", "argv": ["python", "-m", "pytest"]}],
        "test_node_ids": ["tests"],
    }


def queue(bridge):
    client = bridge[0]
    response = command(
        client,
        "execution.queue",
        queue_payload(bridge),
    )
    assert response.status_code == 200, response.text
    return response.json()["executions"][-1]


def sync(bridge, execution):
    response = command(bridge[0], "execution.sync", {"id": execution["id"]})
    assert response.status_code == 200, response.text
    return response.json()["executions"][-1]


def finish(bridge, execution, success=True):
    _, _, store, p, ws, _, _ = bridge
    run = store.get(p, ws["id"], "runs", execution["run_id"])
    store.mutate(
        p,
        ws["id"],
        "runs",
        run["id"],
        operation="test.worker.result",
        key="result",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda r: {
            "status": "completed" if success else "failed",
            "data": {
                **r["data"],
                "node_results": {
                    "tests": {"succeeded": success, "exit_code": 0 if success else 1, "stdout": "test output"}
                },
            },
        },
    )


def test_durable_dispatch_is_idempotent_and_review_separates_success(bridge):
    client, sessions, store, p, ws, _, task = bridge
    intent = queue(bridge)
    assert intent["status"] == "pending_dispatch"
    assert not store.list(p, ws["id"], "runs")
    execution = sync(bridge, intent)
    assert execution["status"] == "planned"
    assert sync(bridge, intent)["run_id"] == execution["run_id"]
    assert len(store.list(p, ws["id"], "runs")) == 1
    finish(bridge, execution)
    execution = sync(bridge, intent)
    assert execution["status"] == "awaiting_review"
    with sessions() as db:
        assert db.get(Task, task["id"]).status == "in_progress"
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 409
    response = command(
        client,
        "execution.review",
        {
            "id": intent["id"],
            "decision": "accept",
            "comment": "Verified output",
            "run_version": execution["run_version"],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["tasks"][0]["status"] == "completed"
    assert response.json()["executions"][0]["status"] == "accepted"


def test_changed_requirement_cannot_accept_old_execution(bridge):
    client, _, _, _, _, rid, _ = bridge
    intent = queue(bridge)
    execution = sync(bridge, intent)
    finish(bridge, execution)
    command(client, "requirement.update", {"id": rid, "description": "Changed scope"})
    state = sync(bridge, intent)
    assert state["stale"] is True
    response = command(
        client,
        "execution.review",
        {
            "id": intent["id"],
            "decision": "accept",
            "comment": "Old result",
            "run_version": state["run_version"],
        },
    )
    assert response.status_code == 409


def test_failed_execution_creates_single_traceable_issue_and_can_promote(bridge):
    client, _, _, _, _, _, task = bridge
    intent = queue(bridge)
    execution = sync(bridge, intent)
    finish(bridge, execution, False)
    sync(bridge, intent)
    sync(bridge, intent)
    state = client.get("/api/v1/delivery/workspace").json()
    assert len(state["issues"]) == 1
    assert state["issues"][0]["task_id"] == task["id"]
    response = command(
        client,
        "issue.promote",
        {"issue_id": state["issues"][0]["id"], "acceptance_criteria": ["Regression passes"]},
    )
    assert response.status_code == 200


def test_runtime_permissions_are_not_elevated_and_cannot_double_dispatch(bridge):
    client, sessions, _, _, _, _, _ = bridge
    queue(bridge)
    with pytest.raises(AssertionError):
        queue(bridge)
    with sessions() as db:
        db.get(User, "lead").role = "tenant_admin"
        db.commit()
    state = client.get("/api/v1/delivery/workspace").json()
    response = command(client, "execution.sync", {"id": state["executions"][0]["id"]})
    assert response.status_code == 403


def test_dispatch_recovery_after_runtime_commit_before_manager_commit(bridge, monkeypatch):
    from sop_manager.routers import delivery_execution

    client, _, store, p, ws, _, _ = bridge
    intent = queue(bridge)
    original = delivery_execution._observe

    def interrupted(*args, **kwargs):
        from fastapi import HTTPException

        raise HTTPException(503, "Simulated interruption after runtime commit")

    monkeypatch.setattr(delivery_execution, "_observe", interrupted)
    response = command(client, "execution.sync", {"id": intent["id"]})
    assert response.status_code == 503
    assert len(store.list(p, ws["id"], "runs")) == 1
    monkeypatch.setattr(delivery_execution, "_observe", original)
    execution = sync(bridge, intent)
    assert execution["run_id"]
    assert len(store.list(p, ws["id"], "runs")) == 1


def test_pending_intent_can_be_cancelled_after_requirement_changes(bridge):
    client, _, store, p, ws, rid, _ = bridge
    intent = queue(bridge)
    command(client, "requirement.update", {"id": rid, "description": "Changed"})
    response = command(client, "execution.cancel", {"id": intent["id"]})
    assert response.status_code == 200, response.text
    assert response.json()["executions"][0]["status"] == "cancelled"
    assert not store.list(p, ws["id"], "runs")


def test_generic_sql_updates_cannot_complete_managed_execution(bridge, monkeypatch):
    from fastapi import HTTPException
    from sop_manager.routers import db_sql_compat

    _, sessions, _, _, _, _, task = bridge
    queue(bridge)
    monkeypatch.setattr(db_sql_compat, "resolved_project_id", lambda: "project")
    monkeypatch.setattr(db_sql_compat, "resolved_tenant_id", lambda: "tenant")
    with sessions() as db:
        with pytest.raises(HTTPException) as failure:
            db_sql_compat._SqlTable(Task, db).update(f"id = '{task['id']}'", {"status": "completed"})
        assert failure.value.status_code == 409


def test_accepted_execution_becomes_stale_when_legacy_content_changes(bridge):
    client, sessions, _, _, _, _, task = bridge
    intent = queue(bridge)
    execution = sync(bridge, intent)
    finish(bridge, execution)
    execution = sync(bridge, intent)
    command(
        client,
        "execution.review",
        {
            "id": intent["id"],
            "decision": "accept",
            "comment": "Verified",
            "run_version": execution["run_version"],
        },
    )
    with sessions() as db:
        db.get(Task, task["id"]).description = "Changed after acceptance"
        db.commit()
    state = client.get("/api/v1/delivery/workspace").json()
    assert state["tasks"][0]["status"] != "completed"
    assert state["executions"][0]["stale"] is True


@pytest.mark.parametrize("change", ["scope", "redispatch"])
def test_runtime_test_report_cannot_validate_changed_or_redispatched_work(bridge, change):
    from sop_manager.routers.delivery_contract import stage_gates

    client, sessions, _, _, _, rid, task = bridge
    execution = sync(bridge, queue(bridge))
    finish(bridge, execution)
    execution = sync(bridge, execution)
    response = command(
        client,
        "execution.review",
        {
            "id": execution["id"],
            "decision": "accept",
            "comment": "Verified original test run",
            "run_version": execution["run_version"],
        },
    )
    assert response.status_code == 200, response.text
    if change == "scope":
        with sessions() as db:
            db.get(Task, task["id"]).description = "Additional behavior after tests"
            db.commit()
    else:
        assert command(client, "task.update", {"id": task["id"], "status": "in_progress"}).status_code == 200
        queue(bridge)
    state = client.get("/api/v1/delivery/workspace").json()
    req = next(r for r in state["requirements"] if r["id"] == rid)
    report = req["flow"]["artifacts"][-1]
    gates = stage_gates(req, {**req["flow"], "stage": "testing"}, state["tasks"], state["issues"])
    assert next(g for g in gates if g["id"] == "test")["ok"] is False
    assert report["stale"] is True


def test_background_sync_writes_real_evidence_once_without_auto_acceptance(bridge):
    from sop_manager.routers.delivery_sync import sync_once

    client, sessions, _, _, _, _, _ = bridge
    execution = sync(bridge, queue(bridge))
    finish(bridge, execution)
    assert sync_once(client.app, sessions) == 1
    assert sync_once(client.app, sessions) == 0
    state = client.get("/api/v1/delivery/workspace").json()
    assert state["executions"][0]["status"] == "awaiting_review"
    assert state["summary"]["tasks_done"] == 0


def test_moving_task_to_another_requirement_invalidates_execution(bridge):
    client, sessions, _, _, _, _, task = bridge
    execution = sync(bridge, queue(bridge))
    finish(bridge, execution)
    new_req = requirement(client)
    with sessions() as db:
        db.get(Task, task["id"]).req_id = new_req
        db.commit()
    execution = sync(bridge, execution)
    assert execution["stale"] is True
    response = command(
        client,
        "execution.review",
        {
            "id": execution["id"],
            "decision": "accept",
            "comment": "Must not accept moved task",
            "run_version": execution["run_version"],
        },
    )
    assert response.status_code == 409


@pytest.mark.parametrize("dispatched", [False, True])
def test_authorized_admin_can_take_over_after_dispatcher_disabled(bridge, dispatched):
    from sop_manager.routers.auth_sql import current_user

    client, sessions, _, _, _, _, _ = bridge
    execution = queue(bridge)
    if dispatched:
        execution = sync(bridge, execution)
    with sessions() as db:
        db.get(User, "lead").status = "disabled"
        unusable = "not-a-login"
        db.add(
            User(
                id="replacement",
                tenant_id="tenant",
                username="replacement",
                role="super_admin",
                password_hash=unusable,
                status="active",
            )
        )
        db.commit()
        replacement = db.get(User, "replacement")
    client.app.dependency_overrides[current_user] = lambda: replacement
    response = command(client, "execution.cancel", {"id": execution["id"]})
    assert response.status_code == 200, response.text
    assert response.json()["executions"][0]["status"] == "cancelled"


def test_existing_agent_adapter_receives_pinned_task_and_requirement_context(bridge):
    from hermes_core.agents import AgentProfile

    client, _, store, p, ws, _, task = bridge
    agent = store.create(
        p, ws["id"], "agents", AgentProfile(title="Coding", provider="codex").model_dump(), "agent", "test"
    )
    response = command(
        client,
        "execution.queue",
        {
            **{
                key: value
                for key, value in queue_payload(bridge).items()
                if key not in {"nodes", "test_node_ids"}
            },
            "agent_id": agent["id"],
            "agent_version": agent["version"],
        },
    )
    assert response.status_code == 200, response.text
    execution = sync(bridge, response.json()["executions"][0])
    run = store.get(p, ws["id"], "runs", execution["run_id"])
    assert run["data"]["agent_bindings"]["agent_1"]["profile"]["provider"] == "codex"
    assert "Find a requirement by title" in run["data"]["nodes"][0]["prompt"]
    assert "Search project work" in run["data"]["nodes"][0]["prompt"]
    assert not execution["test_node_ids"]  # Agent prose is not a test report.


def test_stale_manager_version_never_dispatches_to_runtime(bridge):
    client, _, store, p, ws, _, _ = bridge
    execution = queue(bridge)
    response = command(client, "execution.sync", {"id": execution["id"]}, version=0)
    assert response.status_code == 409
    assert not store.list(p, ws["id"], "runs")
