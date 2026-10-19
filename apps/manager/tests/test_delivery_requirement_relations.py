"""Unknown canonical relationships cannot silently shrink an approval scope."""

from copy import deepcopy

import pytest
from sop_manager.routers import sql_models as m
from sqlalchemy import delete, select, update
from test_delivery_bounded_requirements import head, seed
from test_delivery_deployment_domain import (
    create,
    domain,  # noqa: F401
)
from test_delivery_release import scope, trusted  # noqa: F401
from test_delivery_workbench import env  # noqa: F401


def mutate(sessions, change):
    with sessions.kw["bind"].begin() as connection:
        state = deepcopy(
            connection.scalar(
                select(m.DeliveryWorkspace.data).where(m.DeliveryWorkspace.project_id == "project")
            )
        )
        change(state)
        connection.execute(
            update(m.DeliveryWorkspace).where(m.DeliveryWorkspace.project_id == "project").values(data=state)
        )


def assert_unavailable(client, identity):
    base = f"/api/v1/delivery/requirements/{identity}"
    current = client.get(base)
    assert current.status_code == 200, current.text
    summary = client.get(base + "/impact")
    assert (
        summary.status_code == 200 and not summary.json()["complete"] and summary.json()["counts"] is None
    ), summary.text
    response = client.post(
        base + "/change-preview",
        json={
            "requirement_basis": current.json()["requirement"]["basis"],
            "changes": {"description": "Do not approve incomplete scope"},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (
        not body["available"]
        and not body["complete"]
        and not body["allowed"]
        and body["preview_basis"] is None
    ), body


@pytest.mark.parametrize(
    "damage",
    [
        "missing_fact",
        "task_fact_scalar",
        "task_execution_alias",
        "dependency_nonstring",
        "dependency_missing",
    ],
)
def test_current_task_graph_must_be_complete_before_counts_or_approval(env, damage):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    assert head(client)["requirement"]["tasks_total"] == 1
    if damage in {"missing_fact", "task_fact_scalar", "task_execution_alias"}:
        with sessions.kw["bind"].begin() as connection:
            filters = (
                m.DeliveryQueryFact.project_id == "project",
                m.DeliveryQueryFact.kind == "task",
                m.DeliveryQueryFact.entity_id == "T-c",
            )
            if damage == "missing_fact":
                connection.execute(delete(m.DeliveryQueryFact).where(*filters))
            else:
                value = connection.scalar(select(m.DeliveryQueryFact.data).where(*filters))
                value = [] if damage == "task_fact_scalar" else {**value, "execution_id": "unknown-execution"}
                connection.execute(update(m.DeliveryQueryFact).where(*filters).values(data=value))
    else:
        mutate(
            sessions,
            lambda state: state["task_details"]["T-b"].update(
                depends_on=["T-a", 17 if damage == "dependency_nonstring" else "T-missing"]
            ),
        )
    assert_unavailable(client, "R-main")


@pytest.mark.parametrize(
    "damage",
    [
        "selected_object",
        "selected_nonstring",
        "candidate_scalar",
        "candidate_control",
        "deployment_scalar",
        "deployment_ref_object",
        "deployment_null_id",
    ],
)
def test_all_historical_release_relationships_require_real_shapes(domain, env, damage):  # noqa: F811
    client, sessions, _ = env
    client.app.state.hermes_store = domain.store
    create(domain)
    domain.db.add(
        m.DeliveryWorkspace(tenant_id="tenant", project_id="project", version=0, data=deepcopy(domain.data))
    )
    domain.db.commit()
    initial = client.get("/api/v1/delivery/requirements/R-release/impact")
    assert initial.status_code == 200 and initial.json()["complete"], initial.text

    def corrupt(state):
        candidate = state["release_candidates"][0]
        if damage == "selected_object":
            candidate["snapshot"]["selected"]["requirement_ids"] = {"R-release": True}
        elif damage == "selected_nonstring":
            candidate["snapshot"]["selected"]["requirement_ids"].append(17)
        elif damage == "candidate_scalar":
            state["release_candidates"].append(17)
        elif damage == "candidate_control":
            candidate["id"] = "bad\x01candidate"
        elif damage == "deployment_scalar":
            state["deployments"].append(17)
        elif damage == "deployment_ref_object":
            state["deployments"][0]["candidate_id"] = {"bad": "object"}
        else:
            state["deployments"][0]["id"] = None

    mutate(sessions, corrupt)
    assert_unavailable(client, "R-release")
