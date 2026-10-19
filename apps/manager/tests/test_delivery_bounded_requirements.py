"""Bounded requirement reads retain exact originals and complete change semantics."""

from copy import deepcopy

import pytest
from fastapi import HTTPException
from sop_manager.routers import sql_models as m
from sop_manager.routers.delivery_contract import default_flow
from sop_manager.routers.delivery_service import initial_state
from sqlalchemy import delete, event, insert, select, update
from sqlalchemy.orm import Session
from test_delivery_workbench import env  # noqa: F401


@pytest.mark.parametrize("maximum", [64, 200])
@pytest.mark.parametrize("separator", ["/", "\\"])
def test_resource_logical_ids_reject_path_separators_in_input_and_source(maximum, separator):
    from sop_manager.routers.delivery_requirement_impact import invalid_id
    from sop_manager.routers.delivery_requirement_read import valid_id
    from sqlalchemy import create_engine, literal

    identity = "R" + separator + "child"
    with pytest.raises(HTTPException) as error:
        valid_id(identity, maximum)
    assert error.value.status_code == 422
    with create_engine("sqlite://").connect() as connection:
        assert connection.scalar(select(invalid_id(literal(identity), literal("text"), maximum))) is True


@pytest.mark.parametrize("maximum", [64, 200])
def test_resource_logical_ids_keep_unicode_codepoint_boundaries(maximum):
    from sop_manager.routers.delivery_requirement_impact import invalid_id
    from sop_manager.routers.delivery_requirement_read import valid_id
    from sqlalchemy import create_engine, literal

    identity = "😀" * maximum
    assert valid_id(identity, maximum) == identity
    with pytest.raises(HTTPException):
        valid_id(identity + "😀", maximum)
    with create_engine("sqlite://").connect() as connection:
        assert connection.scalar(select(invalid_id(literal(identity), literal("text"), maximum))) is False
        assert (
            connection.scalar(select(invalid_id(literal(identity + "😀"), literal("text"), maximum))) is True
        )


def seed(sessions):
    state = initial_state()
    state["flows"]["R-main"] = default_flow()
    state["flows"]["R-main"]["reviews"] = [
        {
            "stage": "planning",
            "revision": 1,
            "decision": "approved",
            "actor": "lead",
            "comment": "Original review prose " * 100,
            "at": "2026-01-01T00:00:00Z",
        }
        for _ in range(80)
    ]
    state["task_details"] = {"T-b": {"depends_on": ["T-a"]}, "T-c": {"depends_on": ["T-b"]}}
    with sessions() as db:
        db.add_all(
            [
                m.Requirement(
                    id="R-main",
                    tenant_id="tenant",
                    project_id="project",
                    title="First",
                    description="Original definition",
                    acceptance_criteria=["Reviewed condition"],
                ),
                m.Requirement(id="R-other", tenant_id="tenant", project_id="project", title="Other"),
            ]
        )
        db.flush()
        db.add_all(
            [
                m.Task(id="T-a", tenant_id="tenant", project_id="project", req_id="R-main", title="Direct"),
                m.Task(id="T-b", tenant_id="tenant", project_id="project", title="Dependent"),
                m.Task(
                    id="T-c", tenant_id="tenant", project_id="project", req_id="R-other", title="Transitive"
                ),
                *[
                    m.Task(
                        id=f"T-unrelated-{i}",
                        tenant_id="tenant",
                        project_id="project",
                        title="Unrelated",
                        description="Unused Task prose " * 100,
                    )
                    for i in range(24)
                ],
            ]
        )
        db.add(m.DeliveryWorkspace(tenant_id="tenant", project_id="project", version=0, data=state))
        db.commit()
        db.get(m.Requirement, "R-main").title = "Second"
        db.commit()


def measured(sessions, action):
    loaded, sql = [], []

    def onload(session, instance):
        loaded.append(type(instance).__name__)

    def onsql(connection, cursor, statement, parameters, context, many):
        sql.append(statement)

    event.listen(Session, "loaded_as_persistent", onload)
    event.listen(sessions.kw["bind"], "before_cursor_execute", onsql)
    try:
        response = action()
    finally:
        event.remove(Session, "loaded_as_persistent", onload)
        event.remove(sessions.kw["bind"], "before_cursor_execute", onsql)
    return response, loaded, sql


def head(client):
    response = client.get("/api/v1/delivery/requirements/R-main")
    assert response.status_code == 200, response.text
    return response.json()


def original_fixture_hash(sessions, description, state=None):
    """Independent original contract oracle for this fixed three-Task impact."""
    from sop_manager.routers.delivery_plan import requirement_basis
    from sop_manager.routers.delivery_service import _fingerprint

    with sessions() as db:
        requirement = db.get(m.Requirement, "R-main")
        state = state if state is not None else db.get(m.DeliveryWorkspace, "project").data
        flow = state["flows"][requirement.id]
        impact = dict(
            task_ids=["T-a"],
            dependent_task_ids=["T-b", "T-c"],
            execution_ids=[],
            release_candidate_ids=[],
            deployment_ids=[],
            invalidates_current_acceptance=bool(
                flow.get("accepted_work")
                or flow.get("tested_work")
                or flow["stage"] in {"testing", "acceptance", "release", "operations"}
            ),
        )
        tasks = [
            {
                **{
                    key: getattr(row, key)
                    for key in ("id", "req_id", "title", "description", "acceptance_criteria", "owner_id")
                },
                "depends_on": state["task_details"].get(row.id, {}).get("depends_on", []),
            }
            for row in db.scalars(
                select(m.Task).where(m.Task.id.in_(["T-a", "T-b", "T-c"])).order_by(m.Task.id)
            )
        ]
        basis = requirement_basis(requirement)
        return basis, _fingerprint(
            dict(
                project_id="project",
                requirement_basis=basis,
                changes=[dict(field="description", before=requirement.description, after=description)],
                impact=dict(
                    tasks=tasks, flows={"stage": flow["stage"], "revision": flow["revision"]}, impact=impact
                ),
            )
        )


def test_current_head_has_real_gates_and_counts_without_flow_history_or_definition(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    response, loaded, sql = measured(sessions, lambda: client.get("/api/v1/delivery/requirements/R-main"))
    assert response.status_code == 200, response.text
    value = response.json()
    row = value["requirement"]
    assert "description" not in row and "acceptance_criteria" not in row
    assert set(row["flow"]["record_counts"]) == {"artifacts", "reviews", "releases"}
    assert row["flow"]["record_counts"]["reviews"] == 81
    assert not {"reviews", "artifacts", "releases"}.intersection(row["flow"])
    assert row["flow"]["gates"] and row["tasks_total"] == 1
    assert row["accepted"] is False and row["deployment_verified"] is False
    assert len(response.content) < 5000
    assert "DeliveryWorkspace" not in loaded and "Task" not in loaded
    assert all(statement.lstrip().upper().startswith(("SELECT", "WITH", "PRAGMA")) for statement in sql)


def test_history_metadata_does_not_load_current_impact_or_original_definitions(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    response, loaded, _ = measured(
        sessions, lambda: client.get("/api/v1/delivery/requirements/R-main/history?limit=1")
    )
    assert response.status_code == 200, response.text
    value = response.json()
    assert "current_links" not in value and "current_basis" not in value
    assert "definition" not in value["items"][0] and value["limit"] == 1
    assert not {"DeliveryWorkspace", "Task", "Requirement", "DeliveryRequirementVersion"}.intersection(loaded)
    exact = client.get(f"/api/v1/delivery/requirements/R-main/history/{value['items'][0]['id']}")
    assert exact.status_code == 200 and exact.json()["item"]["definition"]["title"] == "Second"


def test_definition_and_record_positions_require_explicit_generation(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    generation = head(client)["query_generation"]
    base = "/api/v1/delivery/requirements/R-main"
    assert client.get(base + "/definition").status_code == 422
    definition = client.get(base + "/definition", params={"query_generation": generation})
    assert definition.status_code == 200, definition.text
    assert definition.json()["definition"]["acceptance_criteria"] == ["Reviewed condition"]
    params = {"collection": "reviews", "query_generation": generation, "limit": 1}
    page = client.get(base + "/records", params=params)
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["total"] == 81 and len(body["items"]) == 1 and body["items"][0]["position"] == 0
    assert "comment" not in body["items"][0]
    exact = client.get(base + "/records/0", params={"collection": "reviews", "query_generation": generation})
    assert exact.status_code == 200 and exact.json()["record"]["comment"].startswith("Original review prose")
    assert client.get(base + "/records/0", params={"collection": "reviews"}).status_code == 422
    assert (
        client.get(
            base + "/records/0", params={"collection": "reviews", "query_generation": generation + 1}
        ).status_code
        == 409
    )


def test_impact_has_exact_direct_and_transitive_membership_without_write_preview(env):  # noqa: F811
    client, sessions, actor = env
    seed(sessions)
    actor["id"] = "reader"
    response = client.get("/api/v1/delivery/requirements/R-main/impact")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["complete"] and body["counts"]["direct_task"] == 1 and body["counts"]["dependent_task"] == 2
    params = {"kind": "dependent_task", "query_generation": body["query_generation"], "limit": 1}
    page = client.get("/api/v1/delivery/requirements/R-main/impact/items", params=params)
    assert page.status_code == 200 and page.json()["items"][0]["id"] == "T-b"
    exact = client.get("/api/v1/delivery/requirements/R-main/impact/items/T-c", params=params)
    assert exact.status_code == 200 and exact.json()["item"]["target"]["id"] == "T-c"
    assert (
        client.get(
            "/api/v1/delivery/requirements/R-main/impact/items/T-unrelated-0", params=params
        ).status_code
        == 404
    )


def test_preview_is_explicit_complete_proof_not_an_unbounded_id_catalogue(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    response = client.post(
        "/api/v1/delivery/requirements/R-main/change-preview",
        json={
            "requirement_basis": head(client)["requirement"]["basis"],
            "changes": {"description": "Prospective"},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["available"] and body["complete"] and body["allowed"]
    assert body["budget"]["max_bytes"] == 16777216 and body["budget"]["bytes_used"] > 0
    assert body["impact"]["counts"]["dependent_task"] == 2
    assert "task_ids" not in body["impact"] and body["preview_basis"]


@pytest.mark.parametrize("operation", ["insert", "update", "delete"])
def test_observed_versions_are_append_only_for_ordinary_core_sessions(env, operation):  # noqa: F811
    _, sessions, _ = env
    seed(sessions)
    table = m.DeliveryRequirementVersion.__table__
    with sessions() as db:
        row = db.execute(select(table).where(table.c.requirement_id == "R-main")).mappings().first()
        filters = (table.c.tenant_id == "tenant", table.c.project_id == "project", table.c.id == row["id"])
        if operation == "insert":
            values = {**row, "id": "forged-version", "number": 900}
            values.pop("seq")
            statement = insert(m.DeliveryRequirementVersion).values(**values)
        elif operation == "update":
            statement = (
                update(m.DeliveryRequirementVersion).where(*filters).values(definition={"id": "forged"})
            )
        else:
            statement = delete(m.DeliveryRequirementVersion).where(*filters)
        with pytest.raises(HTTPException) as denied:
            db.execute(statement)
        expected = (
            "requirement_version_capture_required"
            if operation == "insert"
            else "requirement_version_immutable"
        )
        assert denied.value.detail["code"] == expected


def test_complete_change_write_checks_actual_source_budget_before_any_cas(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions() as db:
        db.get(m.Task, "T-a").description = "😀" * 300000
        db.commit()
        workspace = db.get(m.DeliveryWorkspace, "project")
        version = workspace.version
    basis, preview_basis = original_fixture_hash(sessions, "Reviewed change")
    statements = []

    def onsql(connection, cursor, statement, parameters, context, many):
        statements.append(statement)

    event.listen(sessions.kw["bind"], "before_cursor_execute", onsql)
    try:
        response = client.post(
            "/api/v1/delivery/commands",
            json={
                "action": "requirement.update",
                "expected_version": version,
                "idempotency_key": "actual-input-budget",
                "payload": {
                    "id": "R-main",
                    "description": "Reviewed change",
                    "requirement_basis": basis,
                    "change_preview_basis": preview_basis,
                },
            },
        )
    finally:
        event.remove(sessions.kw["bind"], "before_cursor_execute", onsql)
    assert response.status_code == 413, response.text
    assert not any(
        statement.lstrip().upper().startswith("UPDATE DELIVERY_WORKSPACES SET VERSION")
        for statement in statements
    )
    with sessions() as db:
        assert db.get(m.DeliveryWorkspace, "project").version == version
        assert db.get(m.Requirement, "R-main").description == "Original definition"


@pytest.mark.parametrize("stage", ["intake", "release"])
def test_complete_preview_matches_original_reconcile_after_stale_acceptance(env, stage):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions.kw["bind"].begin() as connection:
        state = deepcopy(
            connection.scalar(
                select(m.DeliveryWorkspace.data).where(m.DeliveryWorkspace.project_id == "project")
            )
        )
        state["flows"]["R-main"].update(
            stage=stage,
            accepted_work="expired-acceptance",
            definition="expired-definition",
            tested_work="expired-tested-work",
        )
        connection.execute(
            update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "project").values(data=state)
        )
    from sop_manager.routers.delivery_service import reconcile

    with sessions() as db:
        canonical = reconcile(db, db.get(m.Project, "project"), state)
    basis, expected = original_fixture_hash(sessions, "Prospective complete change", canonical)
    assert "accepted_work" not in canonical["flows"]["R-main"]
    response = client.post(
        "/api/v1/delivery/requirements/R-main/change-preview",
        json={"requirement_basis": basis, "changes": {"description": "Prospective complete change"}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["preview_basis"] == expected
    assert response.json()["impact"]["invalidates_current_acceptance"] is False


@pytest.mark.parametrize(
    "field,value", [("stale", "false"), ("stale", {}), ("revision", True), ("title", {"hidden": "object"})]
)
def test_record_summary_never_coerces_unknown_scalar_shapes(env, field, value):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    generation = head(client)["query_generation"]
    with sessions.kw["bind"].begin() as connection:
        state = deepcopy(
            connection.scalar(
                select(m.DeliveryWorkspace.data).where(m.DeliveryWorkspace.project_id == "project")
            )
        )
        state["flows"]["R-main"]["reviews"][0][field] = value
        connection.execute(
            update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "project").values(data=state)
        )
    response = client.get(
        "/api/v1/delivery/requirements/R-main/records",
        params={"collection": "reviews", "query_generation": generation},
    )
    assert response.status_code == 409, response.text


@pytest.mark.parametrize("damage", ["identity", "basis"])
def test_exact_version_checks_its_saved_identity_and_definition_digest(env, damage):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions.kw["bind"].begin() as connection:
        row = connection.execute(
            select(m.DeliveryRequirementVersion.id, m.DeliveryRequirementVersion.definition).where(
                m.DeliveryRequirementVersion.requirement_id == "R-main"
            )
        ).first()
        values = (
            {"definition": {**row.definition, "id": "R-other"}}
            if damage == "identity"
            else {"basis": "f" * 64}
        )
        connection.execute(
            update(m.DeliveryRequirementVersion)
            .where(m.DeliveryRequirementVersion.id == row.id)
            .values(**values)
        )
    response = client.get(f"/api/v1/delivery/requirements/R-main/history/{row.id}")
    assert response.status_code == 409, response.text


@pytest.mark.parametrize("damage", ["workspace_null", "flows_null", "flows_array"])
def test_head_does_not_guess_zero_records_from_invalid_parent_containers(env, damage):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions.kw["bind"].begin() as connection:
        state = deepcopy(
            connection.scalar(
                select(m.DeliveryWorkspace.data).where(m.DeliveryWorkspace.project_id == "project")
            )
        )
        if damage == "workspace_null":
            state = None
        else:
            state["flows"] = None if damage == "flows_null" else []
        connection.execute(
            update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "project").values(data=state)
        )
    response = client.get("/api/v1/delivery/requirements/R-main")
    assert response.status_code == 409, response.text


def test_current_cursors_bind_reader_limit_collection_and_generation_but_history_is_independent(env):  # noqa: F811
    client, sessions, actor = env
    seed(sessions)
    base = "/api/v1/delivery/requirements/R-main"
    generation = head(client)["query_generation"]
    queries = [
        (base + "/records", {"collection": "reviews", "query_generation": generation, "limit": 1}),
        (base + "/impact/items", {"kind": "dependent_task", "query_generation": generation, "limit": 1}),
        (base + "/history", {"limit": 1}),
    ]
    cursors = []
    for url, params in queries:
        first = client.get(url, params=params)
        assert first.status_code == 200, first.text
        cursor = first.json()["next_cursor"]
        assert cursor
        cursors.append(cursor)
        following = client.get(url, params={**params, "cursor": cursor})
        assert following.status_code == 200 and following.json()["items"] != first.json()["items"]
        assert client.get(url, params={**params, "limit": 2, "cursor": cursor}).status_code == 422
        actor["id"] = "reader"
        assert client.get(url, params={**params, "cursor": cursor}).status_code == 422
        actor["id"] = "lead"
    assert (
        client.get(
            queries[0][0], params={**queries[0][1], "collection": "artifacts", "cursor": cursors[0]}
        ).status_code
        == 422
    )
    assert (
        client.get(
            queries[1][0], params={**queries[1][1], "kind": "direct_task", "cursor": cursors[1]}
        ).status_code
        == 422
    )
    with sessions() as db:
        db.get(m.Task, "T-a").title = "Current Task changed"
        db.commit()
    for url, params in queries[:2]:
        assert client.get(url, params=params).status_code == 409
    assert client.get(base, params={"query_generation": generation}).status_code == 409
    assert client.get(base + "/definition", params={"query_generation": generation}).status_code == 409
    assert (
        client.get(
            base + "/records/0", params={"collection": "reviews", "query_generation": generation}
        ).status_code
        == 409
    )
    assert (
        client.get(
            base + "/impact/items/T-b", params={"kind": "dependent_task", "query_generation": generation}
        ).status_code
        == 409
    )
    assert client.get(base + "/history", params={"limit": 1, "cursor": cursors[2]}).status_code == 200


def test_all_requirement_reads_are_zero_write_and_never_materialize_project_bodies(env):  # noqa: F811
    from test_delivery_bounded_progress import snapshot

    client, sessions, _ = env
    seed(sessions)
    base = "/api/v1/delivery/requirements/R-main"
    generation = head(client)["query_generation"]
    version = client.get(base + "/history").json()["items"][0]["id"]
    before = snapshot(sessions)
    paths = [
        (base, {}),
        (base + "/definition", {"query_generation": generation}),
        (base + "/history", {"limit": 1}),
        (base + "/history/" + version, {}),
        (base + "/records", {"collection": "reviews", "query_generation": generation, "limit": 1}),
        (base + "/records/0", {"collection": "reviews", "query_generation": generation}),
        (base + "/impact", {}),
        (base + "/impact/items", {"kind": "dependent_task", "query_generation": generation, "limit": 1}),
        (base + "/impact/items/T-c", {"kind": "dependent_task", "query_generation": generation}),
    ]
    responses, loaded, sql = measured(
        sessions, lambda: [client.get(url, params=params) for url, params in paths]
    )
    assert all(response.status_code == 200 for response in responses), [
        response.text for response in responses
    ]
    assert snapshot(sessions) == before
    assert not {"Task", "Requirement", "DeliveryWorkspace", "DeliveryRequirementVersion"}.intersection(loaded)
    assert all(statement.lstrip().upper().startswith(("SELECT", "WITH", "PRAGMA")) for statement in sql)
    record_projection = [
        statement for statement in sql if "requirement_records" in statement and " AS position" in statement
    ]
    assert len(record_projection) == 1 and "LIMIT" in record_projection[0]
