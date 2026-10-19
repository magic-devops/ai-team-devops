"""Progress pages retain canonical full-scope semantics without loading full originals."""

from copy import deepcopy
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sop_manager.routers import sql_models as m
from sop_manager.routers.delivery_contract import default_flow
from sop_manager.routers.delivery_progress_facts import capture_facts, select_scope
from sop_manager.routers.delivery_service import initial_state
from sqlalchemy import event, select
from sqlalchemy.orm import Session
from test_delivery_workbench import env  # noqa: F401


def seed(sessions, *, baseline_change=None):
    state = initial_state()
    state["flows"]["R-one"] = {**default_flow(), "milestone_id": "M-one"}
    state["milestones"] = [{"id": "M-one", "title": "First milestone", "starts_on": None, "ends_on": None}]
    with sessions() as db:
        db.add_all([m.Requirement(id="R-one", tenant_id="tenant", project_id="project", title="Requirement"),
                    m.Requirement(id="R-empty", tenant_id="tenant", project_id="project", title="Empty")])
        db.flush()
        db.add_all([m.Task(id=f"T-{i}", tenant_id="tenant", project_id="project", req_id="R-one" if i == 0 else "",
                          title=f"Task {i}", description="PRIVATE TASK BODY", owner_id="user:lead",
                          acceptance_criteria=["Independent check"]) for i in range(3)])
        db.add(m.DeliveryWorkspace(project_id="project", tenant_id="tenant", version=0, data=state))
        db.commit()
    with sessions() as db:
        frozen = select_scope(capture_facts(db, db.get(m.Project, "project")))
        if baseline_change:
            baseline_change(frozen)
        from sop_manager.project_write_guard import progress_snapshot_write_scope

        with progress_snapshot_write_scope(db, "tenant", "project", "baseline"):
            db.add(m.DeliveryProgressBaseline(id="B-fixed", tenant_id="tenant", project_id="project", title="Fixed plan",
                scope_kind="project", scope_id="", basis=frozen["basis"], source_version=0, data=deepcopy(frozen),
                created_by="lead", starts_on="2026-01-01", ends_on="2026-01-03"))
            db.commit()
        observation_id = db.scalar(select(m.DeliveryProgressObservation.id).where(m.DeliveryProgressObservation.project_id == "project")
            .order_by(m.DeliveryProgressObservation.seq.desc()).limit(1))
    return frozen, observation_id


def snapshot(sessions):
    with sessions() as db:
        return {table.name: [list(row) for row in db.execute(select(table)).all()] for table in m.Base.metadata.sorted_tables}


def test_series_is_small_while_retaining_full_scope_current_metrics(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    today = datetime.now(timezone.utc).date().isoformat()
    before = snapshot(sessions)
    response = client.get("/api/v1/delivery/progress", params={"starts_on": today, "ends_on": today})
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body["current"]) == {"scope", "metrics"}
    assert body["current"]["metrics"]["tasks_total"] == 3
    assert "scopes" not in body and "baselines" not in body and "comparison" not in body
    assert isinstance(body["query_generation"], int)
    assert snapshot(sessions) == before


@pytest.mark.parametrize("kind", ["observation", "baseline"])
def test_snapshot_metadata_page_and_exact_never_load_whole_original(env, kind):  # noqa: F811
    client, sessions, _ = env
    _, observation_id = seed(sessions)
    identity = observation_id if kind == "observation" else "B-fixed"
    path = f"/api/v1/delivery/progress/{kind}s/{identity}"
    engine = sessions.kw["bind"]
    loaded, statements = [], []

    def onload(session, instance):
        if isinstance(instance, (m.DeliveryProgressBaseline, m.DeliveryProgressObservation)):
            loaded.append(instance)

    def onsql(connection, cursor, statement, parameters, context, many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", onsql)
    event.listen(Session, "loaded_as_persistent", onload)
    try:
        header = client.get(path)
        assert header.status_code == 200, header.text
        assert header.json()[kind]["task_count"] == 3
        assert "tasks" not in header.json()[kind]
        page = client.get(path + "/tasks?limit=1")
        assert page.status_code == 200, page.text
        body = page.json()
        assert body["total"] == 3 and len(body["items"]) == 1
        assert "acceptance_criteria" not in body["items"][0]
        assert body["source_kind"] == kind and body["source_id"] == identity
        exact = client.get(path + "/tasks/" + body["items"][0]["id"])
        assert exact.status_code == 200 and exact.json()["item"]["acceptance_criteria"] == ["Independent check"]
        assert client.get(path + "/tasks/missing").status_code == 404
    finally:
        event.remove(engine, "before_cursor_execute", onsql)
        event.remove(Session, "loaded_as_persistent", onload)
    assert not loaded
    assert all(sql.lstrip().upper().startswith(("SELECT", "WITH", "PRAGMA")) for sql in statements)


def test_baseline_catalogue_and_frozen_cursor_do_not_drift_with_current_generation(env):  # noqa: F811
    client, sessions, actor = env
    seed(sessions)
    catalogue = client.get("/api/v1/delivery/progress/baselines?limit=1")
    assert catalogue.status_code == 200, catalogue.text
    assert catalogue.json()["items"][0]["task_count"] == 3
    assert "task_ids" not in catalogue.json()["items"][0]
    first = client.get("/api/v1/delivery/progress/baselines/B-fixed/tasks?limit=1").json()
    with sessions() as db:
        db.get(m.Task, "T-0").title = "Changed current task"
        db.commit()
    second = client.get("/api/v1/delivery/progress/baselines/B-fixed/tasks", params={"limit": 1, "cursor": first["next_cursor"]})
    assert second.status_code == 200, second.text
    assert second.json()["items"][0]["id"] == "T-1"
    actor["id"] = "reader"
    assert client.get("/api/v1/delivery/progress/baselines/B-fixed/tasks", params={"limit": 1, "cursor": first["next_cursor"]}).status_code == 422


def test_comparison_uses_json_semantics_and_reports_unknown_separately(env):  # noqa: F811
    client, sessions, _ = env

    def adjust(frozen):
        row = frozen["tasks"][0]
        row["title"] = "Older title"
        row["allocations"] = None
        for other in frozen["tasks"][1:]:
            other["acceptance"] = dict(reversed(list(other["acceptance"].items())))

    seed(sessions, baseline_change=adjust)
    response = client.get("/api/v1/delivery/progress/baselines/B-fixed/comparison")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["complete"] and body["counts"] == {"added": 0, "removed": 0, "changed": 1, "incomplete": 1, "unchanged": 2}
    assert body["incomplete_plan_fields"] == ["allocations"]
    page = client.get("/api/v1/delivery/progress/baselines/B-fixed/comparison/items?kind=changed&limit=1")
    assert page.status_code == 200, page.text
    assert page.json()["items"][0]["fields"] == ["title"]
    detail = client.get("/api/v1/delivery/progress/baselines/B-fixed/comparison/items/T-0?kind=incomplete")
    assert detail.status_code == 200 and detail.json()["item"]["before"]["title"] == "Older title"


def test_freeze_proof_is_complete_ids_and_independent_progress_basis(env):  # noqa: F811
    client, sessions, _ = env
    frozen, _ = seed(sessions)
    before = snapshot(sessions)
    response = client.get("/api/v1/delivery/progress/freeze-proof")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["available"] and body["complete"]
    assert body["task_ids"] == frozen["task_ids"] and body["basis"] == frozen["basis"]
    assert "tasks" not in body and body["budget"]["max_tasks"] == 10000
    assert snapshot(sessions) == before


@pytest.mark.parametrize("model", [m.DeliveryProgressBaseline, m.DeliveryProgressObservation])
def test_frozen_source_is_append_only_through_ordinary_session(env, model):  # noqa: F811
    _, sessions, _ = env
    seed(sessions)
    with sessions() as db:
        query = select(model).where(model.project_id == "project")
        row = db.scalar(query.order_by(model.seq.desc()) if model is m.DeliveryProgressObservation else query)
        row.data = {**row.data, "tasks": []}
        with pytest.raises(HTTPException) as denied:
            db.commit()
        assert denied.value.detail["code"] == "progress_snapshot_immutable"


@pytest.mark.parametrize("value", ["missing", None, "false", 0, []])
@pytest.mark.parametrize("field", ["accepted", "released"])
def test_unknown_historical_requirement_acceptance_cannot_be_guessed(env, value, field):  # noqa: F811
    client, sessions, _ = env
    frozen, _ = seed(sessions)
    if value == "missing":
        frozen["requirements"][0].pop(field)
    else:
        frozen["requirements"][0][field] = value
    with sessions.kw["bind"].begin() as connection:
        connection.execute(m.DeliveryProgressBaseline.__table__.update().where(m.DeliveryProgressBaseline.id == "B-fixed").values(data=frozen))
    header = client.get("/api/v1/delivery/progress/baselines/B-fixed")
    assert header.status_code == 200 and not header.json()["baseline"]["available"]
    assert header.json()["baseline"]["metrics"] is None
    assert client.get("/api/v1/delivery/progress/baselines/B-fixed/requirements").status_code == 409


@pytest.mark.parametrize("kind,identity", [("progress_task", "T-0"), ("progress_requirement", "R-one")])
def test_current_fact_identity_mismatch_cannot_produce_complete_proof(env, kind, identity):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions.kw["bind"].begin() as connection:
        table = m.DeliveryQueryFact.__table__
        filters = (table.c.kind == kind, table.c.entity_id == identity)
        value = connection.scalar(select(table.c.data).where(*filters))
        connection.execute(table.update().where(*filters).values(data={**value, "id": "Forged"}))
    proof = client.get("/api/v1/delivery/progress/freeze-proof")
    assert proof.status_code == 409 and proof.json()["detail"]["code"] == "delivery_query_rebuild_required"


@pytest.mark.parametrize("field", ["allocations", "acceptance_criteria", "requirement_criteria_indices", "acceptance"])
@pytest.mark.parametrize("missing", [True, False])
def test_current_plan_fields_are_required_while_legacy_unknowns_remain_historical(env, field, missing):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions.kw["bind"].begin() as connection:
        table = m.DeliveryQueryFact.__table__
        filters = (table.c.kind == "progress_task", table.c.entity_id == "T-0")
        value = connection.scalar(select(table.c.data).where(*filters))
        if missing:
            value.pop(field)
        else:
            value[field] = None
        connection.execute(table.update().where(*filters).values(data=value))
    proof = client.get("/api/v1/delivery/progress/freeze-proof")
    assert proof.status_code == 409 and proof.json()["detail"]["code"] == "delivery_query_rebuild_required"


def test_nullable_independent_task_is_captured_as_empty_progress_parent(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions() as db:
        db.get(m.Task, "T-0").req_id = None
        db.commit()
        fact = db.scalar(select(m.DeliveryQueryFact).where(m.DeliveryQueryFact.kind == "progress_task", m.DeliveryQueryFact.entity_id == "T-0"))
        assert fact.parent_id == "" and fact.data["req_id"] == ""
    response = client.get("/api/v1/delivery/progress/freeze-proof")
    assert response.status_code == 200 and response.json()["available"]
    from test_delivery_workbench import command

    proof = response.json()
    saved = command(client, "baseline.create", {"title": "Nullable independent scope", "task_ids": proof["task_ids"], "basis": proof["basis"]})
    assert saved.status_code == 200, saved.text
    identity = saved.json()["resource"]["id"]
    assert client.get(f"/api/v1/delivery/progress/baselines/{identity}/tasks/T-0").json()["item"]["req_id"] == ""
    assert client.get("/api/v1/delivery/progress").json()["current"]["metrics"]["tasks_total"] == 3
