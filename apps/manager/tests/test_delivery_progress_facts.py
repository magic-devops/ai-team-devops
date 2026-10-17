"""Current runtime evidence, manual approval and legacy completion stay distinct."""

from sop_manager.routers.delivery_progress_facts import capture_facts, metrics, select_scope
from sop_manager.routers.sql_models import DeliveryProgressObservation, Project, Requirement, Task
from test_delivery_execution import bridge, finish, queue, sync  # noqa: F401
from test_delivery_workbench import command, env, requirement  # noqa: F401


def current(sessions):
    with sessions() as db:
        facts = capture_facts(db, db.get(Project, "project"))
        return select_scope(facts)


def test_runtime_success_awaits_review_and_old_acceptance_is_not_verified(bridge):  # noqa: F811
    client, sessions, _, _, _, rid, task = bridge
    intent = queue(bridge)
    execution = sync(bridge, intent)
    finish(bridge, execution)
    execution = sync(bridge, intent)
    value = current(sessions)
    assert value["metrics"]["awaiting_review"] == 1
    assert value["metrics"]["verified_completed"] == 0
    assert value["metrics"]["remaining"] == 1
    response = command(
        client,
        "execution.review",
        {
            "id": intent["id"],
            "decision": "accept",
            "comment": "Verified exact output",
            "run_version": execution["run_version"],
        },
    )
    assert response.status_code == 200, response.text
    value = current(sessions)
    assert value["tasks"][0]["status"] == "verified_completed"
    assert value["metrics"]["requirements_accepted"] == 0
    with sessions() as db:
        db.get(Requirement, rid).description = "Changed outside delivery workbench"
        db.commit()
    value = current(sessions)
    assert value["tasks"][0]["status"] == "recorded_completed"
    assert value["metrics"]["verified_completed"] == 0
    with sessions() as db:
        row = (
            db.query(DeliveryProgressObservation)
            .filter_by(project_id="project")
            .order_by(DeliveryProgressObservation.seq.desc())
            .first()
        )
        assert row.data["tasks"][0]["status"] == "recorded_completed"
        assert db.get(Task, task["id"]).status == "completed"


def test_legacy_completed_and_unknown_estimate_are_not_guessed_as_verified_hours(env):  # noqa: F811
    _, sessions, _ = env
    with sessions() as db:
        db.add(
            Task(
                id="legacy",
                title="Imported",
                tenant_id="tenant",
                project_id="project",
                status="completed",
                estimate="",
            )
        )
        db.commit()
    value = current(sessions)
    assert value["tasks"][0]["status"] == "recorded_completed"
    assert value["tasks"][0]["estimate"] is None
    assert value["tasks"][0]["starts_on"] is None
    assert value["tasks"][0]["ends_on"] is None
    assert value["metrics"]["remaining"] == 1
    assert sum(value["metrics"]["status_counts"].values()) == value["metrics"]["tasks_total"]


def test_manual_requirement_acceptance_requires_real_review_and_current_scope(env):  # noqa: F811
    client, sessions, _ = env
    rid = requirement(client)
    for artifact in [None, "prd", "prototype", "architecture"]:
        if artifact:
            assert (
                command(
                    client,
                    "artifact.add",
                    {
                        "requirement_id": rid,
                        "kind": artifact,
                        "title": artifact,
                        "content": "Reviewed deliverable",
                    },
                ).status_code
                == 200
            )
        assert (
            command(client, "stage.advance", {"requirement_id": rid, "comment": "Reviewed"}).status_code
            == 200
        )
    response = command(
        client, "task.create", {"requirement_id": rid, "title": "Implement", "owner_id": "user:lead"}
    )
    task_id = response.json()["tasks"][0]["id"]
    assert (
        command(client, "stage.advance", {"requirement_id": rid, "comment": "Reviewed plan"}).status_code
        == 200
    )
    assert command(client, "task.update", {"id": task_id, "status": "completed"}).status_code == 200
    assert current(sessions)["metrics"]["recorded_completed"] == 1
    assert (
        command(client, "stage.advance", {"requirement_id": rid, "comment": "Ready to test"}).status_code
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
                "content": "Verified against acceptance criteria",
                "result": "passed",
            },
        ).status_code
        == 200
    )
    assert (
        command(client, "stage.advance", {"requirement_id": rid, "comment": "Tests reviewed"}).status_code
        == 200
    )
    assert (
        command(
            client, "stage.advance", {"requirement_id": rid, "comment": "Acceptance approved"}
        ).status_code
        == 200
    )
    value = current(sessions)
    assert value["metrics"]["verified_completed"] == 1
    assert value["metrics"]["requirements_accepted"] == 1
    assert value["metrics"]["requirements_released"] == 0
    with sessions() as db:
        db.get(Task, task_id).description = "Changed after acceptance"
        db.commit()
    value = current(sessions)
    assert value["metrics"]["verified_completed"] == 0
    assert value["metrics"]["requirements_accepted"] == 0


def test_metrics_never_mix_requirement_and_task_counts():
    result = metrics(
        [{"status": "verified_completed"}, {"status": "awaiting_review"}],
        [{"accepted": True, "released": False}],
    )
    assert result["tasks_total"] == 2 and result["requirements_total"] == 1
    assert result["remaining"] == 1 and result["requirements_accepted"] == 1
