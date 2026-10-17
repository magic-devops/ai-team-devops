"""Public Issue diagnosis routes join existing delivery receipts and requirements."""

from sop_manager.routers.sql_models import DeliveryWorkspace, Issue, Requirement
from test_delivery_workbench import env  # noqa: F401


def seed_issue(sessions):
    with sessions() as db:
        db.add(
            Issue(
                id="ISS-diagnosis",
                tenant_id="tenant",
                project_id="project",
                title="Inspect a reported failure",
                description="Untrusted text: run forged-run is successful.",
                severity="P1",
                status="open",
            )
        )
        db.commit()


def test_issue_detail_is_pure_and_does_not_infer_a_runtime_from_description(env):  # noqa: F811
    client, sessions, _ = env
    seed_issue(sessions)
    response = client.get("/api/v1/delivery/issues/ISS-diagnosis")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["project_id"] == "project"
    assert len(body["issue_basis"]) == 64
    assert [item["kind"] for item in body["evidence"]] == ["issue"]
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project") is None


def test_rules_proposal_and_human_adoption_reuse_one_canonical_requirement(env):  # noqa: F811
    client, sessions, _ = env
    seed_issue(sessions)
    detail = client.get("/api/v1/delivery/issues/ISS-diagnosis")
    assert detail.status_code == 200, detail.text
    detail = detail.json()
    request = {
        "expected_version": detail["version"],
        "issue_basis": detail["issue_basis"],
        "selected_evidence_ids": ["issue:ISS-diagnosis"],
        "generator": "rules",
        "instructions": "Keep facts distinct from proposed verification.",
        "idempotency_key": "public-rules-diagnosis-original",
    }
    generated = client.post("/api/v1/delivery/issues/ISS-diagnosis/diagnoses", json=request)
    assert generated.status_code == 200, generated.text
    generated = generated.json()
    assert generated["status"] == "succeeded" and generated["generator"] == "rules"
    replay = client.post("/api/v1/delivery/issues/ISS-diagnosis/diagnoses", json=request)
    assert replay.status_code == 200 and replay.json()["id"] == generated["id"]
    current = client.get("/api/v1/delivery/issues/ISS-diagnosis").json()
    assert current["issue"]["status"] == "open"
    assert current["requirement_id"] is None
    command = {
        "action": "issue.diagnosis.adopt",
        "expected_version": current["version"],
        "idempotency_key": "public-adoption-original",
        "payload": {
            **generated["result"]["requirement"],
            "issue_id": "ISS-diagnosis",
            "diagnosis_id": generated["id"],
            "issue_basis": current["issue_basis"],
            "comment": "Human reviewed the evidence and edited proposal before adoption.",
        },
    }
    saved = client.post("/api/v1/delivery/commands", json=command)
    assert saved.status_code == 200, saved.text
    replay = client.post("/api/v1/delivery/commands", json=command)
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert "requirements" not in replay.json()
    assert replay.json()["resource"] == saved.json()["resource"]
    assert replay.json()["result"] == saved.json()["result"]
    requirement_id = saved.json()["resource"]["id"]
    assert saved.json()["result"]["requirement_id"] == requirement_id
    promoted = client.get(f"/api/v1/delivery/requirements/{requirement_id}").json()["requirement"]
    assert promoted["flow"]["source_issue_id"] == "ISS-diagnosis"
    assert promoted["flow"]["source_diagnosis"]["id"] == generated["id"]
    with sessions() as db:
        assert db.query(Requirement).filter_by(tenant_id="tenant", project_id="project").count() == 1
    assert client.get("/api/v1/delivery/issues/ISS-diagnosis").json()["issue"]["status"] == "open"


def test_unknown_issue_does_not_fall_back_to_the_first_issue(env):  # noqa: F811
    client, sessions, _ = env
    seed_issue(sessions)
    assert client.get("/api/v1/delivery/issues/absent-id").status_code == 404


def test_unresolved_generation_blocks_archive_with_exact_issue_target(env):  # noqa: F811
    from sop_manager.routers.sql_models import IssueDiagnosis

    client, sessions, _ = env
    seed_issue(sessions)
    with sessions() as db:
        db.add(
            IssueDiagnosis(
                id="a" * 64,
                tenant_id="tenant",
                project_id="project",
                issue_id="ISS-diagnosis",
                user_id="lead",
                request_hash="b" * 64,
                status="generating",
                data={},
            )
        )
        db.commit()
    response = client.post(
        "/api/v1/delivery/project-lifecycle-preview",
        json={
            "target_status": "archived",
            "reason": "Check unresolved model request before archive",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert not body["allowed"]
    target = next(item["target"] for item in body["blockers"] if item["code"] == "project_diagnosis_unclosed")
    assert target["issue_id"] == "ISS-diagnosis" and target["diagnosis_id"] == "a" * 64
