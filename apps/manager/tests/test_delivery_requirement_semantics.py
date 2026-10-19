"""Differential proof against the original complete canonical change contract."""

from copy import deepcopy

import pytest
from requirement_change_oracle import legacy_change_facts
from sop_manager.routers import sql_models as m
from sop_manager.routers.delivery_service import reconcile
from sqlalchemy import select, update
from test_delivery_bounded_requirements import seed
from test_delivery_deployment_domain import (
    action,
    create,
    domain,  # noqa: F401
)
from test_delivery_execution import bridge, cancel_execution, queue  # noqa: F401
from test_delivery_release import scope, trusted  # noqa: F401
from test_delivery_workbench import env  # noqa: F401


def original(sessions, identity, changes):
    with sessions() as db:
        project = db.get(m.Project, "project")
        state = reconcile(db, project, db.get(m.DeliveryWorkspace, "project").data)
        return legacy_change_facts(db, project, state, db.get(m.Requirement, identity), changes)


def compare(client, sessions, identity, changes):
    basis, digest, differences, impact = original(sessions, identity, changes)
    response = client.post(
        f"/api/v1/delivery/requirements/{identity}/change-preview",
        json={"requirement_basis": basis, "changes": changes},
    )
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["available"] and value["complete"] and value["allowed"], value
    assert value["preview_basis"] == digest and value["changes"] == differences
    assert value["impact"]["invalidates_current_acceptance"] == impact["invalidates_current_acceptance"]
    return value, impact


@pytest.mark.parametrize(
    "scenario", ["ordinary", "empty_changes", "nullable_task_parent", "volatile_heartbeat", "multiple_fields"]
)
def test_complete_proof_keeps_original_semantic_hash_and_omissions(env, scenario):  # noqa: F811
    client, sessions, _ = env
    seed(sessions)
    if scenario == "nullable_task_parent":
        with sessions() as db:
            db.get(m.Task, "T-b").req_id = None
            db.commit()
    if scenario == "volatile_heartbeat":
        with sessions.kw["bind"].begin() as connection:
            state = deepcopy(
                connection.scalar(
                    select(m.DeliveryWorkspace.data).where(m.DeliveryWorkspace.project_id == "project")
                )
            )
            state["project"]["heartbeat"] = {"at": "2026-10-19T00:00:00Z", "run_version": 43}
            connection.execute(
                update(m.DeliveryWorkspace)
                .where(m.DeliveryWorkspace.project_id == "project")
                .values(data=state)
            )
    changes = {} if scenario == "empty_changes" else {"description": "Prospective complete change"}
    if scenario == "multiple_fields":
        changes.update(title="Changed title", acceptance_criteria=["Second first", "First second"])
    compare(client, sessions, "R-main", changes)


def test_all_recorded_execution_ids_participate_even_when_hidden(bridge):  # noqa: F811
    client, sessions, _, _, _, identity, _ = bridge
    first = queue(bridge)
    assert cancel_execution(client, first["id"]).status_code == 200
    second = queue(bridge)
    summary = client.get(f"/api/v1/delivery/requirements/{identity}/impact").json()
    assert summary["counts"]["execution"] == 2
    params = {"kind": "execution", "limit": 1, "query_generation": summary["query_generation"]}
    page = client.get(f"/api/v1/delivery/requirements/{identity}/impact/items", params=params).json()
    outside = next(value for value in (first["id"], second["id"]) if value != page["items"][0]["id"])
    exact = client.get(f"/api/v1/delivery/requirements/{identity}/impact/items/{outside}", params=params)
    assert exact.status_code == 200 and exact.json()["item"]["id"] == outside
    client.app.state.hermes_store = None
    value, impact = compare(client, sessions, identity, {"description": "Complete historical proof"})
    assert impact["execution_ids"] == sorted([first["id"], second["id"]])
    assert (
        value["impact"]["counts"]["execution"] == 0 and value["impact"]["counts"]["restricted_execution"] == 2
    )
    assert first["id"] not in str(value) and second["id"] not in str(value)


def test_all_candidate_states_and_deployment_history_remain_in_hidden_proof(domain, env):  # noqa: F811
    from sop_manager.routers.delivery_release import apply_release, preview, release_detail
    from sop_manager.routers.delivery_release_contract import ReleaseCandidateCreate, ReleaseCandidateReview
    from test_delivery_release import candidate_input

    client, sessions, _ = env
    client.app.state.hermes_store = domain.store
    first = create(domain)
    action(domain, first, "deployment.cancel")
    second = create(domain)
    body = candidate_input(domain.data["ci_evidence"][0]["id"]).model_copy(update={"version": "2.0.0"})
    proposed = preview(domain.db, domain.project, domain.data, domain.user, body, version=1)
    assert proposed["allowed"], proposed
    rejected = apply_release(
        domain.db,
        domain.project,
        domain.user,
        domain.data,
        "release.candidate.create",
        ReleaseCandidateCreate(**body.model_dump(), preview_basis=proposed["preview_basis"]),
    )[0]
    detail = release_detail(domain.db, domain.project, domain.data, domain.user, rejected, version=1)[
        "candidate"
    ]
    apply_release(
        domain.db,
        domain.project,
        domain.user,
        domain.data,
        "release.candidate.review",
        ReleaseCandidateReview(
            id=rejected,
            decision="reject",
            review_basis=detail["review_basis"],
            comment="Original rejected historical candidate",
        ),
    )
    domain.db.add(
        m.DeliveryWorkspace(tenant_id="tenant", project_id="project", version=0, data=deepcopy(domain.data))
    )
    domain.db.commit()
    base = "/api/v1/delivery/requirements/R-release"
    summary = client.get(base + "/impact").json()
    assert summary["counts"]["release_candidate"] == 2 and summary["counts"]["deployment"] == 2
    for kind, identities in (
        ("release_candidate", {domain.candidate, rejected}),
        ("deployment", {first, second}),
    ):
        page = client.get(
            base + "/impact/items", params={"kind": kind, "query_generation": summary["query_generation"]}
        )
        assert page.status_code == 200 and {item["id"] for item in page.json()["items"]} == identities
    client.app.state.hermes_store = None
    value, impact = compare(client, sessions, "R-release", {"description": "Complete deployment proof"})
    assert impact["release_candidate_ids"] == sorted([domain.candidate, rejected])
    assert impact["deployment_ids"] == sorted([first, second])
    assert value["impact"]["counts"]["restricted_deployment"] == 2
    assert first not in str(value) and second not in str(value)
