"""Deleted feedback history must not hide an existing canonical requirement."""

import pytest
from sop_manager.routers import delivery
from sop_manager.routers.sql_models import Issue, Requirement
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
        rows = [
            row
            for row in response.json()["requirements"]
            if row["flow"].get("source_issue_id") == "ISSUE-selected"
        ]
        return rows, proposal_id

    first, _ = promote(1)
    assert len(first) == 1
    response = client.delete("/api/v1/requirements/" + first[0]["id"], headers=auth)
    assert response.status_code == 200, response.text
    second, second_proposal = promote(2)
    assert len(second) == 1 and second[0]["id"] != first[0]["id"]
    assert current()["requirement_id"] == second[0]["id"]
    third, _ = promote(3)
    assert len(third) == 1 and third[0]["id"] == second[0]["id"]
    for field in ("title", "description", "priority", "acceptance_criteria"):
        assert third[0][field] == second[0][field]
    if mode == "diagnosis":
        assert third[0]["title"] == "Human edited requirement 2"
        assert third[0]["flow"]["source_diagnosis"]["id"] == second_proposal
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
