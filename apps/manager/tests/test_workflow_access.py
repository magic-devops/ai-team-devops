"""Workflow HTTP routes authenticate, authorize and isolate real project runs."""

import json

import pytest
import test_business_access
from sop_manager.routers import copilot, llm_gateway, sql_models, workflow
from test_business_access import headers, signed_headers

business_env = test_business_access.env


@pytest.fixture
def env(business_env, monkeypatch):
    client, sessions = business_env
    client.app.include_router(workflow.router)
    monkeypatch.setattr(workflow, "_engine", workflow._InMemoryEngine())
    monkeypatch.setenv("WORKFLOW_ENGINE", "memory")

    def forbidden_model_call(*args, **kwargs):
        pytest.fail("Access tests must not call any model provider")

    monkeypatch.setattr(llm_gateway, "llm_chat", forbidden_model_call)
    monkeypatch.setattr(copilot, "_chat", forbidden_model_call)
    return client, sessions


def start_review(client, workflow_id="review-access", uid="writer", project="selected"):
    return client.post("/api/v1/workflows/start", headers=headers(uid, project), json={
        "type": "code_review", "workflow_id": workflow_id, "args": {"timeout_seconds": 0},
    })


def test_start_retry_reuses_original_run_and_rejects_another_actor(env):
    client, _ = env
    started = start_review(client)
    assert started.status_code == 200, started.text
    replay = start_review(client)
    assert replay.status_code == 200, replay.text
    assert replay.json()["run_id"] == started.json()["run_id"]
    assert len(client.get("/api/v1/workflows/instances", headers=headers()).json()["items"]) == 1
    assert start_review(client, uid="product").status_code == 409
    body = {"type": "code_review", "workflow_id": "review-access", "args": {"timeout_seconds": 1}}
    assert client.post("/api/v1/workflows/start", headers=headers(), json=body).status_code == 409
    decided = client.post("/api/v1/workflows/review-access/signal", headers=headers("product"), json={
        "signal": "approve", "payload": {"comment": "Verified", "signal_id": "accepted"}})
    assert decided.status_code == 200, decided.text
    replay_after_decision = start_review(client)
    assert replay_after_decision.json()["run_id"] == started.json()["run_id"]
    assert replay_after_decision.json()["decision"] == "approve"


@pytest.mark.parametrize("path", [
    "types", "engine/status", "instances", "summary", "charts", "hub", "events", "ops-plan",
    "missing/status", "missing/detail",
])
@pytest.mark.parametrize("identity", ["anonymous", "invalid", "disabled"])
def test_workflow_reads_require_active_identity(env, path, identity):
    client, _ = env
    auth = {"X-Project-Id": "selected"}
    if identity == "invalid":
        auth["Authorization"] = "Bearer invalid"
    elif identity == "disabled":
        auth = headers("disabled")
    response = client.get(f"/api/v1/workflows/{path}", headers=auth)
    assert response.status_code == 401, response.text


@pytest.mark.parametrize("path", ["types", "instances", "summary", "events", "ops-plan"])
def test_workflow_reads_require_explicit_authorized_project(env, path):
    client, _ = env
    url = f"/api/v1/workflows/{path}"
    assert client.get(url, headers={"Authorization": headers()["Authorization"]}).status_code == 400
    assert client.get(url, headers=headers(project="private")).status_code == 403
    assert client.get(url, headers=headers("reader", "other")).status_code == 403
    assert client.get(url, headers=headers("reader")).status_code == 200


def test_reader_can_inspect_but_cannot_start_cancel_or_generate_tasks(env):
    client, _ = env
    assert start_review(client, uid="reader").status_code == 403
    assert start_review(client).status_code == 200
    assert client.get("/api/v1/workflows/review-access/detail", headers=headers("reader")).status_code == 200
    assert client.post("/api/v1/workflows/review-access/cancel", headers=headers("reader")).status_code == 403
    assert client.post("/api/v1/workflows/bulk-cancel", headers=headers("reader"),
                       json={"workflow_ids": ["review-access"]}).status_code == 403
    assert client.post("/api/v1/workflows/ops-tasks", headers=headers("reader"),
                       json={"dry_run": False}).status_code == 403


@pytest.mark.parametrize("signal", ["approve", "request_changes", "reject"])
def test_developer_cannot_issue_human_review_decisions(env, signal):
    client, _ = env
    assert start_review(client).status_code == 200
    response = client.post("/api/v1/workflows/review-access/signal", headers=headers(), json={
        "signal": signal, "payload": {"comment": "Developer cannot accept own work", "signal_id": signal},
    })
    assert response.status_code == 403, response.text
    result = client.get("/api/v1/workflows/review-access/status", headers=headers()).json()
    assert result["status"] in {"awaiting_human", "timeout_pending"}
    assert not (result.get("result") or {}).get("human_decision")


@pytest.mark.parametrize("signal", ["approve", "request_changes", "reject"])
def test_product_manager_review_records_server_authenticated_actor(env, signal):
    client, _ = env
    assert start_review(client).status_code == 200
    url = "/api/v1/workflows/review-access/signal"
    body = {"signal": signal, "payload": {"comment": "Inspected the change and checks", "signal_id": "human-1"}}
    response = client.post(url, headers=headers("product"), json=body)
    assert response.status_code == 200, response.text
    replay = client.post(url, headers=headers("product"), json=body)
    assert replay.status_code == 200, replay.text
    detail = client.get("/api/v1/workflows/review-access/detail", headers=headers()).json()
    decision = detail["instance"]["result"]
    assert decision["human_decision"] == signal
    assert decision["decision_record"]["actor_id"] == "product"
    assert decision["decision_record"]["comment"] == body["payload"]["comment"]
    assert len(detail["signals"]) == 1


def test_developer_can_cancel_own_project_review_without_accepting_it(env):
    client, _ = env
    assert start_review(client).status_code == 200
    response = client.post("/api/v1/workflows/review-access/cancel", headers=headers())
    assert response.status_code == 200, response.text
    status = client.get("/api/v1/workflows/review-access/status", headers=headers()).json()
    assert status["status"] == "cancelled"
    assert not (status.get("result") or {}).get("human_decision")


@pytest.mark.parametrize("role", ["product_manager", "project_admin", "devops", "admin", "tenant_admin"])
def test_human_review_uses_current_database_role(env, role):
    client, sessions = env
    assert start_review(client).status_code == 200
    with sessions() as db:
        db.get(sql_models.User, "writer").role = role
        db.get(sql_models.ProjectMember, ("selected", "writer")).role = role
        db.commit()
    # The token still says developer; current membership and user records decide access.
    response = client.post("/api/v1/workflows/review-access/signal", headers=headers(), json={
        "signal": "approve", "payload": {"comment": "Authorized review", "signal_id": "role-review"},
    })
    assert response.status_code == 200, response.text
    decision = client.get("/api/v1/workflows/review-access/detail", headers=headers()).json()["instance"]["result"]
    assert decision["decision_record"]["actor_id"] == "writer"
    assert decision["human_decision"] == "approve"


@pytest.mark.parametrize("method,suffix,body", [
    ("GET", "status", None), ("GET", "detail", None),
    ("POST", "signal", {"signal": "approve", "payload": {"comment": "No", "signal_id": "foreign"}}),
    ("POST", "cancel", None),
])
def test_workflow_id_in_other_project_is_not_readable_or_mutable(env, method, suffix, body):
    client, sessions = env
    assert start_review(client, "selected-only").status_code == 200
    with sessions() as db:
        db.get(sql_models.ProjectMember, ("other", "writer")).role = "project_admin"
        db.commit()
    response = client.request(method, f"/api/v1/workflows/selected-only/{suffix}",
                              headers=headers(project="other"), json=body)
    assert response.status_code == 404, response.text
    assert client.get("/api/v1/workflows/instances", headers=headers(project="other")).json()["items"] == []
    assert client.get("/api/v1/workflows/events", headers=headers(project="other")).json()["items"] == []


def test_same_workflow_id_is_independent_in_each_project(env):
    client, sessions = env
    with sessions() as db:
        db.get(sql_models.ProjectMember, ("other", "writer")).role = "project_admin"
        db.commit()
    first = start_review(client, "shared-review").json()
    second_response = start_review(client, "shared-review", project="other")
    assert second_response.status_code == 200, second_response.text
    second = second_response.json()
    assert first["run_id"] != second["run_id"]
    assert client.post("/api/v1/workflows/shared-review/cancel", headers=headers(project="other")).status_code == 200
    selected = client.get("/api/v1/workflows/shared-review/status", headers=headers()).json()
    other = client.get("/api/v1/workflows/shared-review/status", headers=headers(project="other")).json()
    assert selected["status"] in {"awaiting_human", "timeout_pending"}
    assert other["status"] == "cancelled"
    for project in ("selected", "other"):
        rows = client.get("/api/v1/workflows/instances", headers=headers(project=project)).json()["items"]
        assert len(rows) == 1 and rows[0]["workflow_id"] == "shared-review"
        assert client.get("/api/v1/workflows/summary", headers=headers(project=project)).json()["total"] == 1


@pytest.mark.parametrize("key,value", [
    ("tenant_id", "foreign"), ("project_id", "other"), ("actor_id", "product"), ("user_id", "product"),
])
def test_start_args_cannot_override_authenticated_scope_or_actor(env, key, value):
    client, _ = env
    response = client.post("/api/v1/workflows/start", headers=headers(), json={
        "type": "code_review", "workflow_id": "forged-start", "args": {key: value, "timeout_seconds": 0},
    })
    assert response.status_code == 400, response.text
    assert client.get("/api/v1/workflows/instances", headers=headers()).json()["items"] == []


@pytest.mark.parametrize("key,value", [
    ("tenant_id", "foreign"), ("project_id", "other"), ("actor_id", "writer"), ("user_id", "writer"),
])
def test_signal_payload_cannot_override_authenticated_scope_or_actor(env, key, value):
    client, _ = env
    assert start_review(client).status_code == 200
    response = client.post("/api/v1/workflows/review-access/signal", headers=headers("product"), json={
        "signal": "approve", "payload": {"comment": "No forged attribution", "signal_id": "forged", key: value},
    })
    assert response.status_code == 400, response.text
    detail = client.get("/api/v1/workflows/review-access/detail", headers=headers()).json()
    assert not (detail["instance"].get("result") or {}).get("human_decision")
    assert detail["signals"] == []


def test_verified_hmac_uses_owner_scope_but_bare_or_invalid_key_is_denied(env):
    client, _ = env
    path = "/api/v1/workflows/start"
    body = json.dumps({"type": "code_review", "workflow_id": "signed-review", "args": {"timeout_seconds": 0}}).encode()
    signed = signed_headers("POST", path, body)
    signed["Content-Type"] = "application/json"
    response = client.post(path, headers=signed, content=body)
    assert response.status_code == 200, response.text
    read_path = "/api/v1/workflows/signed-review/detail"
    assert client.get(read_path, headers=signed_headers("GET", read_path)).status_code == 200
    assert client.get(read_path, headers={"X-Api-Key": "local-test-key", "X-Project-Id": "selected"}).status_code == 401
    bad = signed_headers("GET", read_path)
    bad["X-Sop-Signature"] = "sha256=invalid"
    assert client.get(read_path, headers=bad).status_code == 401


@pytest.mark.parametrize("path", ["types", "instances", "events", "summary"])
def test_single_mode_workflow_reads_never_provision_unknown_project(env, monkeypatch, path):
    from sop_manager import project_provision

    client, sessions = env
    monkeypatch.setenv("ADMIN_MODE", "single")
    calls = []
    original = project_provision.ensure_project

    def track(*args, **kwargs):
        calls.append(args)
        return original(*args, **kwargs)

    monkeypatch.setattr(project_provision, "ensure_project", track)
    response = client.get(f"/api/v1/workflows/{path}", headers=headers(project="random-unknown"))
    assert response.status_code == 404, response.text
    assert calls == []
    with sessions() as db:
        assert db.get(sql_models.Project, "random-unknown") is None
