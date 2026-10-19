"""Every real requirement writer budgets canonical inputs before global work."""

import pytest
from sop_manager.routers import delivery
from sop_manager.routers import sql_models as m
from sqlalchemy import event
from test_business_access import env as business_env  # noqa: F401
from test_business_access import headers
from test_delivery_bounded_requirements import original_fixture_hash, seed
from test_event_handoff import env as event_env  # noqa: F401
from test_event_handoff_business import flow_client
from test_local_intents_backend import push


@pytest.fixture
def assistance_env(business_env):  # noqa: F811
    client, sessions = business_env
    client.app.include_router(delivery.router)
    client.headers.update(headers())
    return client, sessions


def measured_sql(sessions, action):
    statements = []

    def onsql(connection, cursor, statement, parameters, context, many):
        statements.append(statement)

    event.listen(sessions.kw["bind"], "before_cursor_execute", onsql)
    try:
        response = action()
    finally:
        event.remove(sessions.kw["bind"], "before_cursor_execute", onsql)
    return response, statements


def no_global_work_before_rejection(statements):
    assert not any(
        statement.lstrip().upper().startswith("UPDATE DELIVERY_WORKSPACES SET VERSION")
        for statement in statements
    )
    assert not any(
        "delivery_workspaces.data AS delivery_workspaces_data" in statement for statement in statements
    )


def test_sync_requirement_budget_rejects_before_workspace_or_cas(event_env):  # noqa: F811
    flow_client(event_env)
    sessions = event_env[1]
    seed(sessions)
    with sessions() as db:
        db.get(m.Task, "T-a").description = "😀" * 300000
        db.commit()
    basis, preview_basis = original_fixture_hash(sessions, "Reviewed change")
    response, statements = measured_sql(
        sessions,
        lambda: push(
            event_env,
            "requirements",
            {"id": "R-main", "description": "Reviewed change"},
            eid="bounded-source-sync",
            requirement_basis=basis,
            change_preview_basis=preview_basis,
        ),
    )
    assert response["processing"]["reason_code"] == "requirement_proof_bytes_budget", response
    no_global_work_before_rejection(statements)
    with sessions() as db:
        assert db.get(m.Requirement, "R-main").description == "Original definition"


def test_assistance_review_budget_rejects_before_workspace_or_cas(assistance_env):
    client, sessions = assistance_env
    with sessions() as db:
        db.get(m.Task, "T-selected").req_id = "REQ-selected"
        db.get(m.Task, "T-selected").description = "😀" * 300000
        db.commit()
    generation = client.post("/api/v1/requirements/REQ-selected/review").json()
    body = {
        "generation_id": generation["generation"]["id"],
        "requirement_basis": generation["generation"]["basis"],
        "expected_version": generation["expected_version"],
        "idempotency_key": "bounded-assistance-review",
        "acceptance_criteria": ["Reviewed new condition"],
    }
    response, statements = measured_sql(
        sessions, lambda: client.post("/api/v1/requirements/REQ-selected/apply-review", json=body)
    )
    assert response.status_code == 413, response.text
    no_global_work_before_rejection(statements)
    with sessions() as db:
        assert db.get(m.Requirement, "REQ-selected").acceptance_criteria == []
