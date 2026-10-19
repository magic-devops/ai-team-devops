"""Deleted feedback history must not hide an existing canonical requirement."""

import pytest
from sop_manager.routers import delivery
from sop_manager.routers.sql_models import DeliveryWorkspace, Issue, Requirement
from test_business_access import env, headers  # noqa: F401


@pytest.mark.parametrize("mode", ["manual", "diagnosis"])
def test_deleted_old_feedback_never_duplicates_or_overwrites_current_requirement(env, mode):  # noqa: F811
    client, sessions = env
    sessions.configure(autoflush=False)
    client.app.include_router(delivery.router)
    auth = headers("product")

    def current():
        response = client.get("/api/v1/delivery/issues/ISSUE-selected", headers=auth)
        assert response.status_code == 200, response.text
        return response.json()

    def promote(index):
        detail = current()
        criteria = [f"Independently verified acceptance criterion for round {index}"]
        action = "issue.promote"
        payload = {"issue_id": "ISSUE-selected", "acceptance_criteria": criteria}
        proposal_id = None
        if mode == "diagnosis":
            response = client.post(
                "/api/v1/delivery/issues/ISSUE-selected/diagnoses",
                headers=auth,
                json={
                    "expected_version": detail["version"],
                    "issue_basis": detail["issue_basis"],
                    "selected_evidence_ids": ["issue:ISSUE-selected"],
                    "generator": "rules",
                    "idempotency_key": f"replacement-generation-{index}",
                },
            )
            assert response.status_code == 200, response.text
            proposal = response.json()
            proposal_id = proposal["id"]
            action = "issue.diagnosis.adopt"
            payload.update(
                diagnosis_id=proposal_id,
                issue_basis=proposal["issue_basis"],
                comment="Human reviewed the original issue evidence",
                title=f"Human edited requirement {index}",
                description=f"Scope confirmed by the reviewer in round {index}",
                priority="P2",
            )
        response = client.post(
            "/api/v1/delivery/commands",
            headers=auth,
            json={
                "action": action,
                "expected_version": detail["version"],
                "idempotency_key": f"replacement-promote-{index}",
                "payload": payload,
            },
        )
        assert response.status_code == 200, response.text
        ack = response.json()
        assert "requirements" not in ack and ack["resource"]["kind"] == "requirement"
        selected = client.get("/api/v1/delivery/requirements/" + ack["resource"]["id"], headers=auth)
        assert selected.status_code == 200, selected.text
        observed = selected.json()
        row = observed["requirement"]
        definition = client.get(
            "/api/v1/delivery/requirements/" + row["id"] + "/definition",
            headers=auth,
            params={"query_generation": observed["query_generation"]},
        )
        assert definition.status_code == 200, definition.text
        assert definition.json()["requirement_basis"] == row["basis"]
        assert definition.json()["definition"]["id"] == row["id"]
        with sessions() as db:
            source = db.get(DeliveryWorkspace, "selected").data["flows"][row["id"]]
            assert source["source_issue_id"] == "ISSUE-selected"
            source_diagnosis = source.get("source_diagnosis")
        assert current()["requirement_id"] == row["id"]
        return [row], definition.json()["definition"], source_diagnosis, proposal_id

    first, _, _, _ = promote(1)
    assert len(first) == 1
    response = client.delete("/api/v1/requirements/" + first[0]["id"], headers=auth)
    assert response.status_code == 200, response.text
    second, second_definition, second_source, second_proposal = promote(2)
    assert len(second) == 1 and second[0]["id"] != first[0]["id"]
    assert current()["requirement_id"] == second[0]["id"]
    third, third_definition, third_source, _ = promote(3)
    assert len(third) == 1 and third[0]["id"] == second[0]["id"]
    for field in ("title", "priority"):
        assert third[0][field] == second[0][field]
    assert third_definition == second_definition
    assert third_source == second_source
    if mode == "diagnosis":
        assert third[0]["title"] == "Human edited requirement 2"
        assert third_source["id"] == second_proposal
    with sessions() as db:
        assert db.query(Requirement).filter_by(project_id="selected", tenant_id="team").count() == 2
        assert db.get(Issue, "ISSUE-selected").status == "open"


@pytest.mark.parametrize("invalid", ["REQ-other", "REQ-private"])
def test_feedback_candidates_outside_project_or_tenant_cannot_hide_the_real_requirement(env, invalid):  # noqa: F811
    from sop_manager.routers.delivery_contract import IssuePromote
    from sop_manager.routers.delivery_service import _promote_issue, initial_state
    from sop_manager.routers.sql_models import Project

    _, sessions = env
    sessions.configure(autoflush=False)
    with sessions() as db:
        db.add(
            Requirement(
                id="REQ-private", tenant_id="foreign", project_id="private", title="Private requirement"
            )
        )
        db.commit()
        state = initial_state()
        state["flows"] = {
            invalid: {"source_issue_id": "ISSUE-selected"},
            "REQ-selected": {"source_issue_id": "ISSUE-selected"},
        }
        resource, _ = _promote_issue(
            db,
            db.get(Project, "selected"),
            state,
            IssuePromote(
                issue_id="ISSUE-selected",
                acceptance_criteria=["A new criterion must not overwrite existing work"],
            ),
        )
        db.flush()
        assert resource == "REQ-selected"
        row = db.get(Requirement, resource)
        assert row.title == "selected" and row.acceptance_criteria == []
        assert db.query(Requirement).count() == 3
        assert db.get(Issue, "ISSUE-selected").status == "open"
