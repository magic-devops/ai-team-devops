"""Real SQL budgets, fixed reader windows and immutable-original boundaries."""

from copy import deepcopy
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sop_manager.project_write_guard import progress_snapshot_write_scope
from sop_manager.routers import sql_models as m
from sqlalchemy import delete, event, insert, inspect, select, update
from sqlalchemy.orm import Session
from test_delivery_bounded_progress import seed, snapshot
from test_delivery_workbench import env  # noqa: F401


def raw_baseline(client, proof, key="fixed-budget-command"):
    return client.post("/api/v1/delivery/commands", json={"action": "baseline.create", "expected_version": proof["version"],
        "idempotency_key": key, "payload": {"title": "Reviewed complete scope", "task_ids": proof["task_ids"], "basis": proof["basis"]}})


def test_actual_oversize_canonical_input_rejects_proof_and_direct_write_before_whole_capture(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    original_proof = client.get("/api/v1/delivery/progress/freeze-proof").json()
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(m.Task).where(m.Task.id == "T-0").values(description="x" * (1024 * 1024 + 1)))
    before = snapshot(sessions)
    loaded = []

    def onload(session, instance):
        if isinstance(instance, (m.Task, m.Requirement, m.DeliveryWorkspace, m.DeliveryProgressObservation)):
            loaded.append(type(instance).__name__)

    event.listen(Session, "loaded_as_persistent", onload)
    try:
        response = client.get("/api/v1/delivery/progress/freeze-proof")
        assert response.status_code == 200, response.text
        body = response.json()
        assert not body["complete"] and not body["available"]
        assert body["task_ids"] is None and body["basis"] is None
        assert body["reasons"][0]["code"] == "progress_proof_bytes_budget"
        assert raw_baseline(client, original_proof).status_code == 413
    finally:
        event.remove(Session, "loaded_as_persistent", onload)
    assert not loaded
    assert snapshot(sessions) == before


def test_empty_legal_scope_can_freeze_and_replay_the_original_receipt(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions() as db:
        db.add(m.Sprint(id="S-empty", tenant_id="tenant", project_id="project", goal="Empty legal scope"))
        db.commit()
    proof = client.get("/api/v1/delivery/progress/freeze-proof?scope=sprint&scope_id=S-empty").json()
    assert proof["complete"] and proof["task_ids"] == [] and proof["basis"]
    body = {"action": "baseline.create", "expected_version": proof["version"], "idempotency_key": "empty-scope-command",
        "payload": {"title": "Empty plan", "scope": "sprint", "scope_id": "S-empty", "task_ids": [], "basis": proof["basis"]}}
    first = client.post("/api/v1/delivery/commands", json=body)
    assert first.status_code == 200, first.text
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert first.json()["resource"] == replay.json()["resource"]
    assert client.get("/api/v1/delivery/progress/baselines?scope=sprint&scope_id=S-empty").json()["total"] == 1


def test_catalogue_same_version_ties_and_clock_rollback_new_command_stay_outside_window(env):  # noqa: F811
    client, sessions, _ = env
    frozen, _ = seed(sessions)
    instant = datetime(2026, 1, 1)
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(m.DeliveryProgressBaseline).where(m.DeliveryProgressBaseline.id == "B-fixed").values(created_at=instant))
    with sessions() as db:
        with progress_snapshot_write_scope(db, "tenant", "project", "baseline"):
            for identity in ("B-z", "B-y", "B-x"):
                db.add(m.DeliveryProgressBaseline(id=identity, tenant_id="tenant", project_id="project", title=identity,
                    scope_kind="project", scope_id="", basis=frozen["basis"], source_version=0, data=deepcopy(frozen),
                    created_at=instant, created_by="lead"))
            db.commit()
    first = client.get("/api/v1/delivery/progress/baselines?limit=1").json()
    assert first["items"][0]["id"] == "B-z" and first["total"] == 4
    proof = client.get("/api/v1/delivery/progress/freeze-proof").json()
    added = raw_baseline(client, proof)
    assert added.status_code == 200, added.text
    identity = added.json()["resource"]["id"]
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(m.DeliveryProgressBaseline).where(m.DeliveryProgressBaseline.id == identity).values(created_at=instant - timedelta(days=10)))
        connection.execute(delete(m.DeliveryProgressBaseline).where(m.DeliveryProgressBaseline.id == "B-y"))
    second = client.get("/api/v1/delivery/progress/baselines", params={"limit": 1, "cursor": first["next_cursor"]})
    assert second.status_code == 200, second.text
    assert second.json()["items"][0]["id"] == "B-x" and second.json()["total"] == 3
    third = client.get("/api/v1/delivery/progress/baselines", params={"limit": 1, "cursor": second.json()["next_cursor"]}).json()
    assert third["items"][0]["id"] == "B-fixed" and third["next_cursor"] is None
    assert client.get("/api/v1/delivery/progress/baselines", params={"limit": 2, "cursor": first["next_cursor"]}).status_code == 422


@pytest.mark.parametrize("model", [m.DeliveryProgressBaseline, m.DeliveryProgressObservation])
@pytest.mark.parametrize("operation", ["insert", "update", "delete"])
def test_core_session_writes_cannot_mutate_or_forge_originals(env, model, operation):  # noqa: F811
    _, sessions, _ = env
    seed(sessions)
    with sessions() as db:
        table = model.__table__
        filters = (table.c.tenant_id == "tenant", table.c.project_id == "project")
        existing = db.execute(select(table).where(*filters)).mappings().first()
        if operation == "insert":
            values = {**existing, "id": "forged-original"}
            if "seq" in values:
                values.pop("seq")
            statement = insert(model).values(**values)
        elif operation == "update":
            statement = update(model).where(*filters).values(data={})
        else:
            statement = delete(model).where(*filters)
        with pytest.raises(HTTPException) as denied:
            db.execute(statement)
        expected = "progress_snapshot_command_required" if operation == "insert" else "progress_snapshot_immutable"
        assert denied.value.detail["code"] == expected


def test_mutable_comparison_generation_and_current_identity_are_checked_on_every_read(env):  # noqa: F811
    client, sessions, actor = env
    seed(sessions, baseline_change=lambda frozen: [task.update(title="Older") for task in frozen["tasks"]])
    path = "/api/v1/delivery/progress/baselines/B-fixed/comparison"
    first = client.get(path + "/items?kind=changed&limit=1").json()
    with sessions() as db:
        db.get(m.Task, "T-0").title = "Latest"
        db.commit()
    assert client.get(path + "/items", params={"kind": "changed", "limit": 1, "cursor": first["next_cursor"]}).status_code == 409
    assert client.get(path, params={"query_generation": first["query_generation"]}).status_code == 409
    assert client.get(path + "/items/T-0", params={"query_generation": first["query_generation"]}).status_code == 409
    actor["id"] = "reader"
    assert client.get(path).status_code == 200
    with sessions() as db:
        db.delete(db.get(m.ProjectMember, ("project", "reader")))
        db.commit()
    assert client.get(path).status_code == 403
    assert client.get("/api/v1/delivery/progress/baselines/B-fixed/tasks").status_code == 403


def test_old_schema_requires_explicit_rebuild_but_history_is_independent_and_gets_do_not_repair(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(m.DeliveryQueryState).where(m.DeliveryQueryState.project_id == "project").values(schema_version=4))
    before = snapshot(sessions)
    assert client.get("/api/v1/delivery/progress").status_code == 409
    assert client.get("/api/v1/delivery/progress/freeze-proof").status_code == 409
    assert client.get("/api/v1/delivery/progress/baselines/B-fixed/tasks/T-0").status_code == 200
    assert snapshot(sessions) == before
    rebuilt = client.post("/api/v1/delivery/query/rebuild")
    assert rebuilt.status_code == 200 and rebuilt.json()["query_state"]["schema_version"] == 5
    assert client.get("/api/v1/delivery/progress/freeze-proof").json()["complete"]


def test_unused_issue_bodies_are_deferred_before_baseline_insert_and_budget_is_real(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    from sop_manager.routers.delivery_contract import IssueCreateCommand

    description = "\U0001f642" * 10000
    IssueCreateCommand.model_validate({"title": "Blocking issue", "description": description, "task_id": "T-0", "severity": "P1"})
    assert len(description.encode("utf-8")) * 450 > 16 * 1024 * 1024
    with sessions() as db:
        db.add_all(m.Issue(id=f"I-budget-{index}", tenant_id="tenant", project_id="project", task_id="T-0", title="Blocking issue",
            description=description, severity="P1", status="open") for index in range(450))
        db.commit()
    proof = client.get("/api/v1/delivery/progress/freeze-proof").json()
    assert proof["available"] and proof["complete"] and 0 < proof["budget"]["bytes_used"] <= proof["budget"]["max_bytes"]
    state = {"inserted": False, "deferred": 0}

    def loaded(session, instance):
        if isinstance(instance, m.Issue) and not state["inserted"]:
            assert "description" in inspect(instance).unloaded
            state["deferred"] += 1

    def sql(connection, cursor, statement, parameters, context, many):
        if statement.lower().lstrip().startswith("insert into delivery_progress_baselines"):
            state["inserted"] = True
        if not state["inserted"]:
            assert "issues.description" not in statement.lower()

    event.listen(Session, "loaded_as_persistent", loaded)
    event.listen(sessions.kw["bind"], "before_cursor_execute", sql)
    try:
        result = raw_baseline(client, proof, "issue-source-budget-command")
        assert result.status_code == 200, result.text
    finally:
        event.remove(Session, "loaded_as_persistent", loaded)
        event.remove(sessions.kw["bind"], "before_cursor_execute", sql)
    assert state["inserted"] and state["deferred"] >= 450


def test_explicit_progress_proof_and_command_support_more_than_quality_default_500(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions() as db:
        db.add_all(m.Task(id=f"T-budget-{index:04}", tenant_id="tenant", project_id="project", title="Independent task") for index in range(501))
        db.commit()
    proof = client.get("/api/v1/delivery/progress/freeze-proof").json()
    assert proof["available"] and proof["complete"] and len(proof["task_ids"]) == 504
    assert proof["budget"]["closure_task_count"] == 504 and proof["budget"]["max_tasks"] == 10000
    result = raw_baseline(client, proof, "more-than-500")
    assert result.status_code == 200, result.text


def test_actual_10001_scope_is_unavailable_and_command_model_keeps_meaningful_10000_cap(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    from pydantic import ValidationError
    from sop_manager.routers.delivery_contract import BaselineCreate

    identities = [f"T-limit-{index:05}" for index in range(10001)]
    BaselineCreate.model_validate({"title": "Complete command limit", "basis": "a" * 64, "task_ids": identities[:10000]})
    with pytest.raises(ValidationError):
        BaselineCreate.model_validate({"title": "Too many tasks", "basis": "a" * 64, "task_ids": identities})
    with sessions.kw["bind"].begin() as connection:
        fact = m.DeliveryQueryFact.__table__
        template = connection.scalar(select(fact.c.data).where(fact.c.kind == "progress_task", fact.c.entity_id == "T-1"))
        connection.execute(delete(m.Task).where(m.Task.project_id == "project"))
        connection.execute(delete(fact).where(fact.c.kind == "progress_task", fact.c.project_id == "project"))
        connection.execute(insert(m.Task), [{"id": identity, "tenant_id": "tenant", "project_id": "project", "title": "Bounded"} for identity in identities])
        connection.execute(insert(fact), [{"entity_id": identity, "tenant_id": "tenant", "project_id": "project", "kind": "progress_task",
            "data": {**template, "id": identity, "title": "Bounded"}} for identity in identities])
    response = client.get("/api/v1/delivery/progress/freeze-proof")
    assert response.status_code == 200, response.text
    proof = response.json()
    assert not proof["available"] and not proof["complete"] and proof["task_ids"] is None and proof["basis"] is None
    assert proof["budget"]["task_count"] == 10001 and proof["reasons"][0]["code"] == "progress_proof_task_budget"


@pytest.mark.parametrize("dialect", ["postgresql", "mysql", "mariadb"])
def test_unverified_storage_dialects_explicitly_refuse_without_full_body_fallback(dialect):
    from types import SimpleNamespace

    from sop_manager.routers.delivery_progress_json import sqlite_only

    with pytest.raises(HTTPException) as denied:
        sqlite_only(SimpleNamespace(bind=SimpleNamespace(dialect=SimpleNamespace(name=dialect))))
    assert denied.value.status_code == 503 and denied.value.detail["code"] == "progress_storage_unavailable"


def test_canonical_baseline_proof_is_recomputed_inside_the_command_and_failure_rolls_back_every_table(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    proof = client.get("/api/v1/delivery/progress/freeze-proof").json()
    before = snapshot(sessions)
    statements = []

    def sql(connection, cursor, statement, parameters, context, many):
        if statement.lstrip().lower().startswith("insert into delivery_progress_"):
            statements.append(statement.lower())

    engine = sessions.kw["bind"]
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TRIGGER deny_progress_snapshot BEFORE INSERT ON delivery_progress_observations BEGIN SELECT RAISE(ABORT, 'forced snapshot failure'); END")
    event.listen(engine, "before_cursor_execute", sql)
    try:
        rejected = raw_baseline(client, proof, "atomic-complete-proof")
        assert rejected.status_code == 409, rejected.text
    finally:
        event.remove(engine, "before_cursor_execute", sql)
    assert "baselines" in statements[0] and "observations" in statements[1]
    assert snapshot(sessions) == before
    with engine.begin() as connection:
        connection.exec_driver_sql("DROP TRIGGER deny_progress_snapshot")
    first = raw_baseline(client, proof, "atomic-complete-proof")
    assert first.status_code == 200, first.text
    replay = raw_baseline(client, proof, "atomic-complete-proof")
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert replay.json()["resource"] == first.json()["resource"]
    with sessions() as db:
        assert db.scalar(select(m.DeliveryProgressBaseline.source_version).where(m.DeliveryProgressBaseline.id == first.json()["resource"]["id"])) == proof["version"] + 1


def test_external_proof_never_approves_old_canonical_data_under_a_current_command_version(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    proof = client.get("/api/v1/delivery/progress/freeze-proof").json()
    with sessions() as db:
        db.get(m.Task, "T-0").title = "Changed after external proof"
        db.commit()
    before = snapshot(sessions)
    rejected = raw_baseline(client, proof, "external-proof-is-not-authority")
    assert rejected.status_code == 409, rejected.text
    assert snapshot(sessions) == before


@pytest.mark.parametrize("path", ["/api/v1/delivery/progress/baselines", "/api/v1/delivery/progress/freeze-proof"])
@pytest.mark.parametrize("missing", [True, False])
def test_new_reads_require_an_explicit_project_with_canonical_400(env, path, missing):  # noqa: F811
    client, _, _ = env
    if missing:
        client.headers.pop("X-Project-Id")
        response = client.get(path)
    else:
        response = client.get(path, headers={"X-Project-Id": ""})
    assert response.status_code == 400
