"""Actual canonical byte, count and closure-depth limits, without patched caps."""

from copy import deepcopy

import pytest
from sop_manager.routers import sql_models as m
from sqlalchemy import LargeBinary, cast, func, insert, select, update
from test_delivery_bounded_requirements import head, seed
from test_delivery_workbench import env  # noqa: F401


def add_original_tasks(connection, rows):
    prototype = connection.scalar(
        select(m.DeliveryQueryFact.data).where(
            m.DeliveryQueryFact.kind == "task", m.DeliveryQueryFact.entity_id == "T-a"
        )
    )
    connection.execute(insert(m.Task), rows)
    connection.execute(
        insert(m.DeliveryQueryFact),
        [
            dict(
                tenant_id="tenant",
                project_id="project",
                kind="task",
                entity_id=row["id"],
                parent_id=row.get("req_id") or "",
                status="pending",
                data=deepcopy(prototype),
            )
            for row in rows
        ],
    )


def preview(client):
    response = client.post(
        "/api/v1/delivery/requirements/R-main/change-preview",
        json={
            "requirement_basis": head(client)["requirement"]["basis"],
            "changes": {"description": "Complete proof"},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_real_10001_canonical_scope_never_yields_partial_change_basis(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions.kw["bind"].begin() as connection:
        add_original_tasks(
            connection,
            [
                dict(
                    id=f"T-limit-{index}",
                    tenant_id="tenant",
                    project_id="project",
                    req_id="R-main",
                    title="Actual Task",
                )
                for index in range(10000)
            ],
        )
        assert (
            connection.scalar(select(func.count()).select_from(m.Task).where(m.Task.req_id == "R-main"))
            == 10001
        )
    value = preview(client)
    assert not value["complete"] and not value["allowed"] and value["preview_basis"] is None
    assert any(reason["code"] == "requirement_proof_record_budget" for reason in value["reasons"])


def test_real_total_necessary_inputs_over_16mib_are_prechecked_before_decode(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    identities = [f"T-unrelated-{index}" for index in range(21)]
    with sessions.kw["bind"].begin() as connection:
        connection.execute(
            update(m.Task).where(m.Task.id.in_(identities)).values(req_id="R-main", description="x" * 800000)
        )
        connection.execute(
            update(m.DeliveryQueryFact)
            .where(m.DeliveryQueryFact.kind == "task", m.DeliveryQueryFact.entity_id.in_(identities))
            .values(parent_id="R-main")
        )
        total, largest = connection.execute(
            select(
                func.sum(func.length(cast(m.Task.description, LargeBinary))),
                func.max(func.length(cast(m.Task.description, LargeBinary))),
            ).where(m.Task.id.in_(identities))
        ).one()
        assert total > 16777216 and largest < 1048576
    value = preview(client)
    assert not value["available"] and not value["complete"] and value["preview_basis"] is None
    assert any(reason["code"] == "requirement_proof_bytes_budget" for reason in value["reasons"])


@pytest.mark.parametrize("depth,complete", [(64, True), (65, False)])
def test_actual_necessary_dependency_depth_matches_public_64_limit(env, depth, complete):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    # T-c -> T-b -> T-a already accounts for three nodes in the longest path.
    extra = depth - 3
    with sessions.kw["bind"].begin() as connection:
        add_original_tasks(
            connection,
            [
                dict(
                    id=f"T-depth-{index}",
                    tenant_id="tenant",
                    project_id="project",
                    title="Forward dependency",
                )
                for index in range(extra)
            ],
        )
        state = connection.scalar(
            select(m.DeliveryWorkspace.data).where(m.DeliveryWorkspace.project_id == "project")
        )
        state["task_details"]["T-a"] = {"depends_on": ["T-depth-0"]}
        for index in range(extra):
            state["task_details"][f"T-depth-{index}"] = {
                "depends_on": [f"T-depth-{index + 1}"] if index + 1 < extra else []
            }
        connection.execute(
            update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "project").values(data=state)
        )
    value = preview(client)
    assert value["budget"]["max_dependency_depth"] == 64
    assert value["complete"] is complete and value["allowed"] is complete
    assert (value["preview_basis"] is not None) is complete


def test_legal_empty_requirement_scope_is_complete_without_fabricated_work(env):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    with sessions() as db:
        db.add(
            m.Requirement(id="R-empty", tenant_id="tenant", project_id="project", title="Empty requirement")
        )
        db.commit()
    current = client.get("/api/v1/delivery/requirements/R-empty").json()
    response = client.post(
        "/api/v1/delivery/requirements/R-empty/change-preview",
        json={"requirement_basis": current["requirement"]["basis"], "changes": {}},
    )
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["available"] and value["complete"] and value["allowed"]
    assert value["impact"]["counts"]["direct_task"] == 0 and value["impact"]["counts"]["dependent_task"] == 0
    assert value["impact"]["invalidates_current_acceptance"] is False
