"""Real native delivery acceptance/progress regressions; execution is deferred by request."""

from copy import deepcopy

from sop_manager.routers.delivery_execution_quality import accepted_quality_valid
from sop_manager.routers.sql_models import Task
from test_delivery_execution import bridge, finish, queue, queue_payload, sync  # noqa: F401
from test_delivery_workbench import command, env  # noqa: F401


def review(client, entry, decision="accept"):
    return command(client, "execution.review", {"id": entry["id"], "decision": decision,
        "comment": "Reviewed actual fixed execution evidence", "run_version": entry["run_version"]})


def test_no_test_run_is_executable_and_reworkable_but_not_acceptable(bridge):
    client, sessions, _, _, _, _, task = bridge
    proposal = {**queue_payload(bridge), "test_node_ids": []}
    queued = command(client, "execution.queue", proposal)
    assert queued.status_code == 200, queued.text
    entry = sync(bridge, queued.json()["executions"][-1])
    finish(bridge, entry)
    entry = sync(bridge, entry)
    observation = client.get(f"/api/v1/delivery/executions/{entry['id']}/observations").json()
    assert observation["quality"]["status"] == "not_configured"
    assert observation["permissions"]["can_review"] is True
    assert observation["permissions"]["can_accept"] is False
    rejected = review(client, entry)
    assert rejected.status_code == 409, rejected.text
    with sessions() as db:
        assert db.get(Task, task["id"]).status != "completed"
    assert review(client, entry, "request_changes").status_code == 200


def test_acceptance_quality_is_bound_to_original_plan_results_run_and_attempt(bridge):
    client = bridge[0]
    entry = sync(bridge, queue(bridge))
    finish(bridge, entry)
    entry = sync(bridge, entry)
    read = client.get(f"/api/v1/delivery/executions/{entry['id']}/observations").json()
    assert read["quality"]["status"] == "passed"
    assert read["permissions"]["can_accept"] is True
    runtime = client.get(f"/api/v1/delivery/executions/{entry['id']}/runtime").json()
    assert runtime["quality"] == read["quality"]
    accepted = review(client, entry)
    assert accepted.status_code == 200, accepted.text
    saved = accepted.json()["executions"][-1]
    assert saved["review"]["quality"] == read["quality"]
    assert accepted_quality_valid(saved)
    observed = client.get(f"/api/v1/delivery/executions/{entry['id']}/observations").json()
    assert observed["review_verified"] is True
    for mutate in (
        lambda value: value["review"].pop("quality"),
        lambda value: value.update(test_node_ids=[]),
        lambda value: value.update(attempt=value["attempt"] + 1),
        lambda value: value["results"]["tests"].update(exit_code=1),
        lambda value: value["results"]["tests"]["evidence_binding"].update(run_id="borrowed"),
        lambda value: value["nodes"][0].update(argv=["echo", "different"]),
    ):
        changed = deepcopy(saved)
        mutate(changed)
        assert not accepted_quality_valid(changed)


def test_completed_tests_cannot_turn_an_older_review_into_current_verified_acceptance(bridge):
    client, _, store, principal, workspace, _, _ = bridge
    entry = sync(bridge, queue(bridge))
    finish(bridge, entry)
    entry = sync(bridge, entry)
    assert review(client, entry).status_code == 200
    run = store.get(principal, workspace["id"], "runs", entry["run_id"])
    store.mutate(principal, workspace["id"], "runs", run["id"], operation="test.later_evidence", key="later", request={},
                 trace="test", expected=run["version"], transform=lambda item: {"data": {**item["data"], "late_evidence": "new fact"}})
    observed = client.get(f"/api/v1/delivery/executions/{entry['id']}/observations").json()
    assert observed["quality"]["status"] == "passed"
    assert observed["review_verified"] is False
    runtime = client.get(f"/api/v1/delivery/executions/{entry['id']}/runtime").json()
    assert runtime["review_verified"] is False
    assert not accepted_quality_valid(sync(bridge, entry))


def test_plan_is_part_of_the_exact_managed_envelope(bridge):
    entry = sync(bridge, queue(bridge))
    store, principal, workspace = bridge[2:5]
    task = store.get(principal, workspace["id"], "tasks", entry["runtime_task_id"])
    run = store.get(principal, workspace["id"], "runs", entry["run_id"])
    assert task["data"]["source"]["test_plan"] == entry["test_plan"]
    assert run["data"]["managed_test_plan"] == entry["test_plan"]
    assert run["data"]["managed_execution_id"] == entry["id"]


def test_damaged_persisted_node_list_is_invalid_instead_of_filtered_or_a_read_error(bridge):
    from sop_manager.routers.delivery_execution_quality import execution_quality

    entry = sync(bridge, queue(bridge))
    finish(bridge, entry)
    entry = sync(bridge, entry)
    _, _, store, principal, workspace, _, _ = bridge
    run = store.get(principal, workspace["id"], "runs", entry["run_id"])
    runtime_task = store.get(principal, workspace["id"], "tasks", entry["runtime_task_id"])
    for damaged in ([*entry["nodes"], "not-a-node"], {"tests": entry["nodes"][0]}, [{"id": "tests", "argv": 42}]):
        changed = deepcopy(entry)
        changed["nodes"] = damaged
        assert execution_quality(changed, run, runtime_task)["status"] == "invalid"
        # A missing run must be readable too; do not repair or delete the source.
        assert execution_quality(changed)["status"] == "invalid"
        assert changed["nodes"] == damaged


def test_manager_entry_plan_disagreement_is_rejected_before_core_review(bridge, monkeypatch):
    import pytest
    from fastapi import HTTPException
    from sop_manager.routers.delivery_execution import _review
    from sop_manager.routers.delivery_contract import ExecutionReview
    from sop_manager.routers.sql_models import User

    entry = sync(bridge, queue(bridge))
    finish(bridge, entry)
    entry = sync(bridge, entry)
    _, sessions, store, principal, workspace, _, task = bridge
    run = store.get(principal, workspace["id"], "runs", entry["run_id"])
    original_task = store.get(principal, workspace["id"], "tasks", entry["runtime_task_id"])
    changed = deepcopy(entry)
    changed["test_node_ids"] = []
    called = []
    monkeypatch.setattr("sop_manager.routers.delivery_execution.Delivery.review", lambda *args, **kwargs: called.append(True))
    with sessions() as db, pytest.raises(HTTPException) as denied:
        _review(changed, run, db.get(Task, task["id"]), None,
                ExecutionReview(id=entry["id"], run_version=entry["run_version"], decision="accept", comment="Review fixed tests"),
                db.get(User, "lead"), store, principal)
    assert denied.value.status_code == 409 and not called
    assert store.get(principal, workspace["id"], "tasks", entry["runtime_task_id"]) == original_task


def test_old_query_facts_require_explicit_rebuild_without_get_mutation(bridge):
    from sop_manager.routers.sql_models import DeliveryQueryState

    client, sessions = bridge[:2]
    with sessions() as db:
        row = db.query(DeliveryQueryState).one()
        row.schema_version = 6
        generation = row.generation
        db.commit()
    context = client.get("/api/v1/delivery/context")
    assert context.status_code == 200
    assert context.json()["query_state"]["schema_version"] == 7
    assert context.json()["query_state"]["status"] == "rebuild_required"
    assert client.get("/api/v1/delivery/tasks").status_code == 409
    with sessions() as db:
        row = db.query(DeliveryQueryState).one()
        assert row.schema_version == 6 and row.generation == generation
    rebuilt = client.post("/api/v1/delivery/query/rebuild")
    assert rebuilt.status_code == 200, rebuilt.text
    assert client.get("/api/v1/delivery/context").json()["query_state"]["status"] == "ready"
