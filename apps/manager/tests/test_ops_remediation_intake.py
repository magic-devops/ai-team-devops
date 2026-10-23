"""Real HTTP definitions, unrun while the user defers the validation window."""
import json

import pytest
from fastapi import HTTPException
from sop_manager.routers import delivery, ops_center
from sop_manager.routers.sql_models import Issue, OpsIssueSource, Task
from sop_manager.project_write_guard import project_file_write_scope
from test_business_access import env, headers  # noqa: F401


@pytest.fixture
def intake(env, tmp_path, monkeypatch):  # noqa: F811
    client, sessions = env
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path / "runtime"))
    client.app.include_router(delivery.router)
    client.app.include_router(ops_center.router)

    @client.app.post("/api/v1/delivery/_fixture/ops-source")
    def seed_source(body: dict):
        # HTTP middleware establishes exactly the same project scope as the
        # consumer; this route exists only inside this test fixture.
        raw_metric = body.pop("raw_metric", None)
        source_type = body.pop("source_type", "self_heal")
        collection = "rca" if source_type == "rca" else "self_heal_actions"
        source = {"id": "ops-one", "trigger_condition": "error_rate > 3",
                  "action": "restart api", "risk_level": "high", "state": "verified",
                  "verification_result": {"status": "healthy"}, "evidence": {"password": "fixture-secret"},
                  "created_at": "2026-10-23T00:00:00Z", **body}
        ops_center._save(collection, source)
        if raw_metric is not None:
            with project_file_write_scope():
                (ops_center._dir(collection) / "ops-one.json").write_text(
                    json.dumps(source)[:-1] + ', "metric": ' + raw_metric + '}', encoding="utf-8")
        return source

    assert client.post("/api/v1/delivery/_fixture/ops-source", headers=headers(), json={}).status_code == 200
    return client, sessions


def current(client, uid="writer", project="selected", source_type="self_heal"):
    collection = "rca" if source_type == "rca" else "ops-actions"
    return client.get(f"/api/v1/delivery/{collection}/ops-one/intake", headers=headers(uid, project))


def command(view, *, key="ops-intake-original", **changes):
    return {"action": "issue.rca.intake" if view.get("source_type") == "rca" else "issue.ops.intake", "expected_version": view["version"], "idempotency_key": key,
            "payload": {"source_id": view["source_id"], "source_digest": view["source_digest"],
                        "title": "Investigate service regression", "description": "Confirm before executing.",
                        "severity": "P1", **changes}}


def test_intake_fixed_source_creates_one_real_issue_and_replays_after_source_changes(intake):
    client, sessions = intake
    read = current(client); assert read.status_code == 200, read.text
    view = read.json(); assert view["source_kind"] == "reported_only" and view["can_intake"]
    assert "fixture-secret" not in json.dumps(view)
    original = command(view)
    one = client.post("/api/v1/delivery/commands", headers=headers(), json=original)
    assert one.status_code == 200, one.text
    ack = one.json(); assert ack["resource"]["kind"] == "issue"
    iid = ack["resource"]["id"]
    client.post("/api/v1/delivery/_fixture/ops-source", headers=headers(), json={"action": "different suggestion"})
    replay = client.post("/api/v1/delivery/commands", headers=headers(), json=original)
    assert replay.status_code == 200 and replay.json()["resource"]["id"] == iid and replay.json()["replayed"]
    with sessions() as db:
        assert db.query(Issue).filter_by(id=iid, project_id="selected", status="open").count() == 1
        fixed = db.query(OpsIssueSource).filter_by(project_id="selected", source_id="ops-one").one()
        assert fixed.source_digest == view["source_digest"] and fixed.snapshot["action"] == "restart api"
    detail = client.get(f"/api/v1/delivery/issues/{iid}", headers=headers())
    assert detail.status_code == 200, detail.text
    evidence = [item for item in detail.json()["evidence"] if item["kind"] == "ops"]
    assert len(evidence) == 1 and evidence[0]["status"] == "reported_only"


def test_different_keys_do_not_create_duplicate_source_issues(intake):
    client, sessions = intake
    view = current(client).json()
    first = client.post("/api/v1/delivery/commands", headers=headers(), json=command(view)).json()
    fresh = current(client).json(); assert fresh["existing_issue_id"] == first["resource"]["id"]
    again = client.post("/api/v1/delivery/commands", headers=headers(), json=command(fresh, key="different-intake-key"))
    assert again.status_code == 200 and again.json()["resource"] == first["resource"]
    with sessions() as db:
        assert db.query(Issue).filter(Issue.id == first["resource"]["id"]).count() == 1


def test_rca_and_self_heal_with_same_external_id_have_distinct_fixed_sources(intake):
    client, sessions = intake
    assert client.post("/api/v1/delivery/_fixture/ops-source", headers=headers(), json={"source_type": "rca", "root_cause": "Reported API regression", "incident_id": "INC-one"}).status_code == 200
    heal = current(client).json()
    first = client.post("/api/v1/delivery/commands", headers=headers(), json=command(heal)).json()
    rca = current(client, source_type="rca").json()
    assert rca["source_type"] == "rca" and rca["existing_issue_id"] is None
    original = command(rca, key="rca-original-request")
    response = client.post("/api/v1/delivery/commands", headers=headers(), json=original)
    assert response.status_code == 200, response.text
    receipt = response.json()
    assert receipt["resource"]["id"] != first["resource"]["id"]
    assert client.post("/api/v1/delivery/_fixture/ops-source", headers=headers(), json={"source_type": "rca", "root_cause": "Changed"}).status_code == 200
    replay = client.post("/api/v1/delivery/commands", headers=headers(), json=original)
    assert replay.status_code == 200 and replay.json()["replayed"] and replay.json()["resource"] == receipt["resource"]
    with sessions() as db:
        rows = db.query(OpsIssueSource).filter_by(project_id="selected", source_id="ops-one").all()
        assert {row.source_type for row in rows} == {"self_heal", "rca"}
        assert next(row for row in rows if row.source_type == "rca").snapshot["root_cause"] == "Reported API regression"


@pytest.mark.parametrize("path,method", [("verify", "post"), ("resolve", "put"), ("verification-plan", "get")])
def test_reported_rca_cannot_be_verified_or_closed_by_old_routes(intake, path, method):
    client, _ = intake
    response = getattr(client, method)(f"/api/v1/ops-center/rca/ops-one/{path}", headers=headers())
    assert response.status_code in {404, 405}


def test_rca_actual_task_creation_requires_formal_intake(intake, monkeypatch):
    client, sessions = intake
    monkeypatch.setattr(ops_center, "_rca_insight_payload", lambda body: {"candidates": []})
    response = client.post("/api/v1/ops-center/rca/insights/tasks", headers=headers(), json={"dry_run": False})
    assert response.status_code == 410 and response.json()["detail"]["code"] == "ops_canonical_intake_required"
    with sessions() as db:
        assert db.query(Issue).count() == 2
        assert db.query(Task).count() == 2


def test_rca_missing_candidate_does_not_adopt_another_candidate(intake, monkeypatch):
    client, _ = intake
    monkeypatch.setattr(ops_center, "_rca_insight_payload", lambda body: {"candidates": [{"id": "different", "title": "Other source"}]})
    response = client.post("/api/v1/ops-center/rca/insights/rca", headers=headers(), json={"candidate_id": "original-missing"})
    assert response.status_code == 404


def test_changed_source_requires_explicit_new_read_without_creating_an_issue(intake):
    client, sessions = intake; view = current(client).json()
    client.post("/api/v1/delivery/_fixture/ops-source", headers=headers(), json={"action": "changed"})
    response = client.post("/api/v1/delivery/commands", headers=headers(), json=command(view))
    assert response.status_code == 409 and response.json()["detail"]["code"] == "ops_source_changed"
    with sessions() as db:
        assert db.query(Issue).count() == 2


@pytest.mark.parametrize("raw_metric", ["1e400", "-1e400", "NaN", '"\\ud800"', '{"password":"\\ud800"}', '{"\\ud800":"value"}'])
def test_non_finite_or_non_utf8_source_is_rejected_without_writes(intake, raw_metric):
    client, sessions = intake
    assert client.post("/api/v1/delivery/_fixture/ops-source", headers=headers(), json={"raw_metric": raw_metric}).status_code == 200
    response = current(client)
    assert response.status_code == 422 and response.json()["detail"]["code"] == "ops_source_invalid"
    with sessions() as db:
        assert db.query(OpsIssueSource).count() == 0


def test_fixed_source_is_append_only_and_pure_reads_do_not_write(intake):
    client, sessions = intake; view = current(client).json()
    response = client.post("/api/v1/delivery/commands", headers=headers(), json=command(view))
    assert response.status_code == 200, response.text
    with sessions() as db:
        row = db.query(OpsIssueSource).one(); before = json.dumps(row.snapshot, sort_keys=True)
        row.source_digest = "0" * 64
        with pytest.raises(HTTPException): db.flush()
        db.rollback()
    assert current(client).status_code == 200
    with sessions() as db:
        assert json.dumps(db.query(OpsIssueSource).one().snapshot, sort_keys=True) == before


@pytest.mark.parametrize("uid,project,expected", [("reader", "selected", 403), ("writer", "other", 404), ("writer", "private", 403)])
def test_scope_and_write_permissions_are_enforced(intake, uid, project, expected):
    client, _ = intake; view = current(client).json()
    response = client.post("/api/v1/delivery/commands", headers=headers(uid, project), json=command(view))
    # The other project first enforces its viewer-only authority.
    assert response.status_code == (403 if project == "other" else expected)


@pytest.mark.parametrize("suffix", ["approve", "apply", "verify", "rollback"])
def test_manual_success_routes_are_not_registered(intake, suffix):
    client, _ = intake
    response = client.post(f"/api/v1/ops-center/self-heal/actions/ops-one/{suffix}", headers=headers(), json={"result": {"command_exit_code": 0}, "verification": {"status": "healthy"}})
    assert response.status_code in {404, 405}
