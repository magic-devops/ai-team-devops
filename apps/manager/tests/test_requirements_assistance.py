"""Requirement suggestions are durable previews, adopted only by an explicit command."""

import json
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sop_manager.routers import delivery, llm_gateway
from sop_manager.routers.sql_models import (
    DeliveryWorkspace,
    ProjectMember,
    Requirement,
    RequirementAssistance,
    User,
)
from test_business_access import env as business_env
from test_business_access import headers

env = business_env


@pytest.fixture
def app_env(env):
    client, sessions = env
    client.app.include_router(delivery.router)
    client.headers.update(headers())
    return client, sessions


def stub(monkeypatch, *, content=None, error=None, during=None):
    calls = []

    def chat(body, request):
        calls.append(body)
        if during:
            during()
        if error:
            raise error
        return llm_gateway.ChatOut(
            model="configured-model",
            provider="configured-provider",
            content=content
            or json.dumps(
                {
                    "requirements": [
                        {
                            "title": "Preview import",
                            "description": "Edited before import",
                            "priority": "P1",
                            "acceptance_criteria": ["Can import"],
                            "tags": ["intake"],
                        }
                    ]
                }
            ),
            usage=llm_gateway.ChatUsage(prompt_tokens=7, completion_tokens=4, total_tokens=11),
        )

    monkeypatch.setattr(llm_gateway, "llm_chat", chat)
    return calls


def parse_body(**changes):
    return {
        "text": "需要支持需求文档导入，用户预览并修改后，再明确确认导入到当前项目。",
        "generator": "ai",
        "idempotency_key": "parse-stable-key",
        **changes,
    }


def test_parse_failure_is_not_rules_success_and_replay_never_rebills(app_env, monkeypatch):
    client, _ = app_env
    calls = stub(monkeypatch, error=HTTPException(503, "Provider disabled"))
    one = client.post("/api/v1/requirements/parse-document", json=parse_body())
    two = client.post("/api/v1/requirements/parse-document", json=parse_body())
    assert one.status_code == two.status_code == 503
    assert "disabled" in one.text
    assert len(calls) == 1
    assert (
        client.post(
            "/api/v1/requirements/parse-document",
            json=parse_body(text="不同的需求内容，需要支持权限审核和任务分派操作，必须保留历史记录。"),
        ).status_code
        == 409
    )


def test_parse_success_is_preview_with_real_usage_and_durable_replay(app_env, monkeypatch):
    client, sessions = app_env
    calls = stub(monkeypatch)
    one = client.post("/api/v1/requirements/parse-document", json=parse_body())
    assert one.status_code == 200, one.text
    result = one.json()
    assert result["generation"]["source"] == "ai"
    assert result["generation"]["model"] == "configured-model"
    assert result["generation"]["usage"]["total_tokens"] == 11
    assert result["source"] == "llm" and result["expected_version"] == 0
    assert client.post("/api/v1/requirements/parse-document", json=parse_body()).json() == result
    assert len(calls) == 1 and calls[0].task_type == "plan" and calls[0].cache_ttl == 0
    with sessions() as db:
        assert db.query(Requirement).count() == 2


def test_rules_generation_is_explicit_and_does_not_call_model(app_env, monkeypatch):
    client, _ = app_env
    calls = stub(monkeypatch)
    result = client.post("/api/v1/requirements/parse-document", json=parse_body(generator="rules")).json()
    assert result["generation"]["source"] == "rules" and result["source"] == "local_rules"
    assert calls == []


def test_prototype_preview_does_not_write_legacy_file_and_images_are_rejected(app_env, monkeypatch):
    client, _ = app_env
    calls = stub(monkeypatch, content="# 可编辑原型\n\n保存按钮展示处理中和失败重试。")
    assert (
        client.post("/api/v1/requirements/REQ-selected/prototype", json={"gen_image": True}).status_code
        == 422
    )
    assert not calls
    result = client.post(
        "/api/v1/requirements/REQ-selected/prototype", json={"idempotency_key": "prototype-first"}
    )
    assert result.status_code == 200, result.text
    assert result.json()["generation"]["source"] == "ai"
    assert client.get("/api/v1/requirements/REQ-selected/prototype").json()["exists"] is False


def test_review_compatibility_rules_and_ai_are_visibly_distinct(app_env, monkeypatch):
    client, _ = app_env
    rules = client.post("/api/v1/requirements/REQ-selected/review")
    assert rules.status_code == 200, rules.text
    assert rules.json()["generation"]["source"] == "rules"
    calls = stub(
        monkeypatch,
        content=json.dumps(
            {
                "score": 70,
                "level": "review",
                "risks": [],
                "suggestions": ["Clarify permission"],
                "suggested_acceptance_criteria": ["Unauthorized users are denied"],
                "duplicates": [],
                "next_actions": ["Review suggestion"],
            }
        ),
    )
    ai = client.post("/api/v1/requirements/REQ-selected/review", json={"generator": "ai"})
    assert ai.status_code == 200, ai.text
    assert ai.json()["generation"]["source"] == "ai" and len(calls) == 1


def test_generated_old_basis_is_rejected_after_provider_returns(app_env, monkeypatch):
    client, sessions = app_env

    def mutate():
        with sessions() as db:
            db.get(Requirement, "REQ-selected").description = "New requirement scope"
            db.commit()

    calls = stub(monkeypatch, content="# Old draft", during=mutate)
    response = client.post(
        "/api/v1/requirements/REQ-selected/prototype", json={"idempotency_key": "prototype-stale"}
    )
    assert response.status_code == 409, response.text
    assert len(calls) == 1


def adoption(result, **changes):
    return {
        "generation_id": result["generation"]["id"],
        "requirement_basis": result["generation"]["basis"],
        "expected_version": result["expected_version"],
        "idempotency_key": "adopt-stable-key",
        **changes,
    }


def test_review_adoption_is_explicit_preserves_pending_status_and_replays_original_basis(
    app_env, monkeypatch
):
    client, sessions = app_env
    stub(
        monkeypatch,
        content=json.dumps(
            {"score": 99, "level": "ready", "suggested_acceptance_criteria": ["Permission denied is visible"]}
        ),
    )
    preview = client.post("/api/v1/requirements/REQ-selected/review", json={"generator": "ai"}).json()
    with sessions() as db:
        assert db.get(Requirement, "REQ-selected").acceptance_criteria == []
    body = adoption(
        preview,
        acceptance_criteria=["Edited before explicit adoption"],
        tags=["reviewed"],
        human_notes="Reviewed by product owner",
    )
    saved = client.post("/api/v1/requirements/REQ-selected/apply-review", json=body)
    assert saved.status_code == 200, saved.text
    again = client.post("/api/v1/requirements/REQ-selected/apply-review", json=body)
    assert again.status_code == 200 and again.json()["replayed"]
    with sessions() as db:
        row = db.get(Requirement, "REQ-selected")
        assert row.acceptance_criteria == ["Edited before explicit adoption"]
        assert row.status == "pending" and row.human_notes == "Reviewed by product owner"
        assert db.get(DeliveryWorkspace, "selected").version == 1
    assert (
        client.post(
            "/api/v1/requirements/REQ-selected/apply-review", json={**body, "tags": ["another"]}
        ).status_code
        == 409
    )
    history = client.get("/api/v1/requirements/REQ-selected/assistance-history").json()
    assert history["items"][0]["generation"]["stale"]
    assert history["items"][0]["adoptions"][0]["version"] == 1
    assert history["requirement_basis"] != preview["generation"]["basis"]


def test_prototype_adoption_appends_versioned_evidence_and_never_advances_stage(app_env, monkeypatch):
    client, _ = app_env
    stub(monkeypatch, content="# Preview only")
    preview = client.post(
        "/api/v1/requirements/REQ-selected/prototype", json={"idempotency_key": "prototype-first"}
    ).json()
    body = adoption(preview, content="# Edited design\n\nFailure is visible.")
    one = client.post("/api/v1/requirements/REQ-selected/prototype/apply", json=body)
    assert one.status_code == 200, one.text
    again = client.post("/api/v1/requirements/REQ-selected/prototype/apply", json=body)
    assert again.status_code == 200 and again.json()["artifact_id"] == one.json()["artifact_id"]
    second = client.post(
        "/api/v1/requirements/REQ-selected/prototype/apply",
        json={
            **body,
            "content": "# Second design",
            "idempotency_key": "adopt-second-key",
            "expected_version": 1,
        },
    )
    assert second.status_code == 200, second.text
    current = client.get("/api/v1/requirements/REQ-selected/prototype").json()
    assert len(current["versions"]) == 2 and current["content"] == "# Second design"
    assert current["versions"][0]["content"].startswith("# Edited")
    assert current["versions"][0]["generation_id"] == preview["generation"]["id"]
    assert client.post("/api/v1/requirements/REQ-other/prototype/apply", json=body).status_code == 409
    workspace = client.get("/api/v1/delivery/workspace").json()
    assert workspace["requirements"][0]["flow"]["stage"] == "intake"


def test_batch_adoption_creates_only_selected_edits_atomically_with_provenance(app_env, monkeypatch):
    client, sessions = app_env
    stub(monkeypatch)
    preview = client.post("/api/v1/requirements/parse-document", json=parse_body()).json()
    body = {
        "generation_id": preview["generation"]["id"],
        "expected_version": 0,
        "idempotency_key": "batch-confirm-key",
        "items": [
            {
                **preview["items"][0],
                "title": "Edited selected item",
                "assigned_agent": "Design agent",
                "dev_tool": "codex",
            }
        ],
    }
    one = client.post("/api/v1/requirements/batch", json=body)
    assert one.status_code == 200, one.text
    again = client.post("/api/v1/requirements/batch", json=body)
    assert again.status_code == 200 and again.json()["ids"] == one.json()["ids"]
    with sessions() as db:
        assert db.query(Requirement).count() == 3
        workspace = db.get(DeliveryWorkspace, "selected")
        source = workspace.data["flows"][one.json()["ids"][0]]["intake_source"]
        assert source["generation_id"] == preview["generation"]["id"] and source["source"] == "ai"
        assert source["assigned_agent"] == "Design agent"
    listed = client.get("/api/v1/requirements").json()
    item = next(item for item in listed if item["id"] == one.json()["ids"][0])
    assert item["assigned_agent"] == "Design agent" and item["dev_tool"] == "codex"


def test_batch_invalid_later_item_rolls_back_entire_workspace_and_import(app_env, monkeypatch):
    client, sessions = app_env
    stub(monkeypatch)
    preview = client.post("/api/v1/requirements/parse-document", json=parse_body()).json()
    response = client.post(
        "/api/v1/requirements/batch",
        json={
            "generation_id": preview["generation"]["id"],
            "expected_version": 0,
            "idempotency_key": "invalid-batch-key",
            "items": [{"title": "Valid selected item"}, {"title": ""}],
        },
    )
    assert response.status_code == 422, response.text
    with sessions() as db:
        assert db.query(Requirement).count() == 2
        assert db.get(DeliveryWorkspace, "selected") is None


def test_adoption_checks_actor_action_project_and_live_basis(app_env, monkeypatch):
    client, sessions = app_env
    stub(monkeypatch, content="# Prototype")
    preview = client.post("/api/v1/requirements/REQ-selected/prototype", json={}).json()
    body = adoption(preview, content="# Edited")
    assert client.post("/api/v1/requirements/REQ-other/prototype/apply", json=body).status_code == 404
    assert (
        client.post(
            "/api/v1/requirements/REQ-selected/prototype/apply", headers=headers("product"), json=body
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/requirements/REQ-selected/apply-review",
            json={k: v for k, v in body.items() if k != "content"},
        ).status_code
        == 404
    )
    with sessions() as db:
        db.get(Requirement, "REQ-selected").acceptance_criteria = ["New scope"]
        db.commit()
    assert client.post("/api/v1/requirements/REQ-selected/prototype/apply", json=body).status_code == 409
    replay = client.post("/api/v1/requirements/REQ-selected/prototype", json={}).json()
    assert replay["generation"]["id"] != preview["generation"]["id"]  # implicit key includes changed basis


def test_adoption_project_version_conflict_can_be_explicitly_reconfirmed(app_env, monkeypatch):
    client, _ = app_env
    stub(monkeypatch, content="# Preview")
    preview = client.post("/api/v1/requirements/REQ-selected/prototype", json={}).json()
    update = client.post(
        "/api/v1/delivery/commands",
        json={
            "action": "project.update",
            "payload": {"goal": "New project goal"},
            "expected_version": 0,
            "idempotency_key": "project-update-key",
        },
    )
    assert update.status_code == 200, update.text
    body = adoption(preview, content="# Edited")
    assert client.post("/api/v1/requirements/REQ-selected/prototype/apply", json=body).status_code == 409
    result = client.post(
        "/api/v1/requirements/REQ-selected/prototype/apply",
        json={**body, "expected_version": 1, "idempotency_key": "reconfirmed-adopt-key"},
    )
    assert result.status_code == 200, result.text


def test_generation_commits_inflight_receipt_before_provider_and_rechecks_access(app_env, monkeypatch):
    client, sessions = app_env

    def inspect():
        with sessions() as db:
            receipt = db.query(RequirementAssistance).one()
            assert receipt.status == "generating"
            actor = db.get(User, "writer")
            actor.status = "disabled"
            db.commit()

    calls = stub(monkeypatch, content="# Preview", during=inspect)
    response = client.post(
        "/api/v1/requirements/REQ-selected/prototype", json={"idempotency_key": "recheck-access-key"}
    )
    assert response.status_code == 403, response.text
    with sessions() as db:
        receipt = db.query(RequirementAssistance).one()
        assert receipt.status == "failed" and receipt.data["usage"]["total_tokens"] == 11
    assert len(calls) == 1


def test_inflight_retry_is_visible_and_does_not_start_a_second_provider_call(app_env, monkeypatch):
    client, _ = app_env
    during = []

    def retry():
        during.append(client.post("/api/v1/requirements/parse-document", json=parse_body()))

    calls = stub(monkeypatch, during=retry)
    done = client.post("/api/v1/requirements/parse-document", json=parse_body())
    assert done.status_code == 200, done.text
    assert during[0].status_code == 409 and "assistance_in_progress" in during[0].text
    assert len(calls) == 1


def test_explicit_generation_key_replays_historical_draft_with_stale_marker(app_env, monkeypatch):
    client, sessions = app_env
    calls = stub(monkeypatch, content="# Original scope")
    body = {"idempotency_key": "historical-prototype-key"}
    first = client.post("/api/v1/requirements/REQ-selected/prototype", json=body).json()
    with sessions() as db:
        db.get(Requirement, "REQ-selected").human_notes = "Current scope clarification"
        db.commit()
    again = client.post("/api/v1/requirements/REQ-selected/prototype", json=body).json()
    assert again["generation"]["id"] == first["generation"]["id"]
    assert again["generation"]["stale"] and len(calls) == 1
    assert (
        client.post(
            "/api/v1/requirements/REQ-selected/prototype/apply",
            json=adoption(again, content=again["content"]),
        ).status_code
        == 409
    )


def test_quota_failure_records_replay_and_never_calls_implicit_rules(app_env, monkeypatch):
    client, _ = app_env
    calls = stub(
        monkeypatch,
        error=HTTPException(429, {"code": "llm_quota_exceeded", "message": "Daily quota exhausted"}),
    )
    first = client.post("/api/v1/requirements/parse-document", json=parse_body())
    again = client.post("/api/v1/requirements/parse-document", json=parse_body())
    assert first.status_code == again.status_code == 429 and first.json() == again.json()
    assert len(calls) == 1


def test_history_scope_denies_cross_project_and_preserves_failed_generation_usage(app_env, monkeypatch):
    client, _ = app_env
    stub(monkeypatch, content="invalid structured review")
    result = client.post(
        "/api/v1/requirements/REQ-selected/review",
        json={"generator": "ai", "idempotency_key": "failed-review-key"},
    )
    assert result.status_code == 502
    history = client.get("/api/v1/requirements/REQ-selected/assistance-history").json()
    assert history["items"][0]["status"] == "failed"
    assert history["items"][0]["generation"]["usage"]["total_tokens"] == 11
    assert history["items"][0]["result"] is None
    assert client.get("/api/v1/requirements/REQ-other/assistance-history").status_code == 404
    assert (
        client.get(
            "/api/v1/requirements/REQ-selected/assistance-history", headers=headers("reader", "other")
        ).status_code
        == 403
    )


def test_partial_adoption_fields_cannot_silently_fall_back_to_legacy_manual_mode(app_env):
    client, _ = app_env
    assert (
        client.post(
            "/api/v1/requirements/REQ-selected/apply-review",
            json={"generation_id": "not-a-preview", "acceptance_criteria": ["No bypass"]},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/requirements/batch", json={"expected_version": 0, "items": [{"title": "No bypass"}]}
        ).status_code
        == 422
    )


def test_rules_intake_source_and_tags_do_not_claim_model_generation(app_env, monkeypatch):
    client, _ = app_env
    calls = stub(monkeypatch)
    result = client.post("/api/v1/requirements/parse-document", json=parse_body(generator="rules")).json()
    assert result["generation"]["source"] == "rules" and not result["generation"]["model"]
    assert "rule-intake" in result["items"][0]["tags"] and "ai-intake" not in result["items"][0]["tags"]
    assert calls == []


def test_review_cannot_accept_invalid_edited_fields_or_forge_provenance(app_env, monkeypatch):
    client, _ = app_env
    preview = client.post("/api/v1/requirements/REQ-selected/review").json()
    invalid = client.post(
        "/api/v1/requirements/REQ-selected/apply-review", json=adoption(preview, acceptance_criteria=[""])
    )
    assert invalid.status_code == 422
    forged = client.post(
        "/api/v1/requirements/REQ-selected/apply-review",
        json=adoption(
            preview, acceptance_criteria=["Edited"], model="forged-model", provider="forged-provider"
        ),
    )
    assert forged.status_code == 422


def test_requirement_parse_uses_actual_saved_gateway_route_and_disabled_provider_is_not_hidden(
    app_env, monkeypatch
):
    client, sessions = app_env
    with sessions() as db:
        db.get(ProjectMember, ("selected", "writer")).role = "project_admin"
        db.commit()
    assert (
        client.put(
            "/api/v1/models/providers/openai",
            json={
                "name": "openai",
                "api_key": "isolated-fixture-key",
                "base_url": "https://models.example.invalid/v1",
            },
        ).status_code
        == 200
    )
    assert client.put("/api/v1/models/default?model_id=gpt-4o-mini").status_code == 200
    assert (
        client.put("/api/v1/models/role-model", json={"role": "plan", "model_id": "gpt-4o"}).status_code
        == 200
    )
    calls = []

    class Client:
        def __init__(self, **settings):
            self.settings = settings
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **request):
            calls.append({"settings": self.settings, "request": request})
            return SimpleNamespace(
                model=request["model"],
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(
                                {
                                    "requirements": [
                                        {
                                            "title": "Configured route preview",
                                            "acceptance_criteria": ["Uses project model"],
                                        }
                                    ]
                                }
                            )
                        ),
                        finish_reason="stop",
                    )
                ],
                usage=SimpleNamespace(prompt_tokens=9, completion_tokens=6, total_tokens=15),
            )

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    monkeypatch.setenv("OPENAI_API_KEY", "environment-must-not-override")
    monkeypatch.setattr(llm_gateway, "_enforce_llm_quota", lambda *args: None)
    monkeypatch.setattr(llm_gateway, "_audit_call", lambda *args: None)
    response = client.post("/api/v1/requirements/parse-document", json=parse_body())
    assert response.status_code == 200, response.text
    assert response.json()["generation"]["model"] == "gpt-4o"
    assert response.json()["generation"]["usage"]["total_tokens"] == 15
    assert calls[0]["settings"]["api_key"] == "isolated-fixture-key"
    assert calls[0]["settings"]["base_url"] == "https://models.example.invalid/v1"
    assert "isolated-fixture-key" not in response.text
    assert (
        client.put("/api/v1/models/providers/openai", json={"name": "openai", "enabled": False}).status_code
        == 200
    )
    disabled = client.post(
        "/api/v1/requirements/parse-document", json=parse_body(idempotency_key="disabled-provider-key")
    )
    assert disabled.status_code == 503 and len(calls) == 1


def test_legacy_tenant_admin_alias_retains_authority_without_rewriting_role(app_env, monkeypatch):
    client, sessions = app_env
    with sessions() as db:
        db.get(User, "writer").role = "admin"
        db.commit()
    calls = stub(monkeypatch)
    response = client.post("/api/v1/requirements/parse-document", json=parse_body())
    assert response.status_code == 200, response.text
    assert len(calls) == 1
    with sessions() as db:
        assert db.get(User, "writer").role == "admin"


def test_project_removed_during_provider_request_returns_scope_error_without_crashing(app_env, monkeypatch):
    from sop_manager.routers.sql_models import Project

    client, sessions = app_env

    def remove_project():
        # Simulate out-of-band database loss. Application Sessions deliberately
        # reject physical project deletion and require explicit archival.
        with sessions.kw["bind"].begin() as connection:
            connection.execute(Project.__table__.delete().where(Project.id == "selected"))

    calls = stub(monkeypatch, during=remove_project)
    result = client.post("/api/v1/requirements/parse-document", json=parse_body())
    assert result.status_code == 404, result.text
    assert len(calls) == 1


@pytest.mark.parametrize(
    "content",
    [
        '{"requirements":[{"title":""}]}',
        '{"requirements":[{"title":"Valid", "priority":"P9"}]}',
        '{"requirements":[{"title":"Valid", "acceptance_criteria":[4]}]}',
        '{"requirements":[{"title":"Valid", "secret":"no"}]}',
    ],
)
def test_invalid_model_structure_fails_without_rules_and_records_charged_usage(app_env, monkeypatch, content):
    client, sessions = app_env
    calls = stub(monkeypatch, content=content)
    response = client.post("/api/v1/requirements/parse-document", json=parse_body())
    assert response.status_code == 502, response.text
    assert client.post("/api/v1/requirements/parse-document", json=parse_body()).status_code == 502
    assert len(calls) == 1
    with sessions() as db:
        receipt = db.query(RequirementAssistance).one()
        assert receipt.status == "failed" and receipt.data["usage"]["total_tokens"] == 11
