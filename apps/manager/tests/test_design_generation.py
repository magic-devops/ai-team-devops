"""Real SQL, command and HTTP generation definitions; execution is deferred."""
from copy import deepcopy

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, update

from sop_manager.routers import design_docs, llm_gateway, sql_models as models
from sop_manager.routers.auth_sql import current_user, current_user_or_apikey
from sop_manager.routers.design_generation_model import ProjectDesignGeneration as Generation
from sop_manager.routers.design_model import ProjectDesignRevision as Revision
from test_delivery_workbench import command, env as delivery_env

env = delivery_env


def document(env):
    client, _sessions, _actor = env
    # The fixture already supplies the real user/session and canonical commands.
    client.app.include_router(design_docs.router)
    client.app.dependency_overrides[current_user_or_apikey] = client.app.dependency_overrides[current_user]
    response = command(client, "design.document.create", {"title": "Architecture", "category": "architecture",
        "tags": ["delivery"], "content": "# 原设计\n\n明确边界与验收", "note": "Initial design"})
    assert response.status_code == 200, response.text
    return response.json()["result"]["document_id"]


def request(client, did, *, key="fixed-preview-original", **changes):
    head = client.get(f"/api/v1/design-docs/{did}").json()["document"]
    return {"base_revision_id": head["head_revision_id"], "base_revision_digest": head["head_revision_digest"],
        "mode": "expand", "instructions": "补齐失败恢复", "idempotency_key": key, **changes}


def fake_provider(monkeypatch, calls, *, content="# 完整建议\n\n恢复同一请求", finish_reason="stop"):
    def chat(body, _request):
        calls.append(body.model_dump())
        return llm_gateway.ChatOut(model="configured-model", provider="configured-provider", content=content,
            finish_reason=finish_reason, usage=llm_gateway.ChatUsage())
    monkeypatch.setattr(llm_gateway, "llm_chat", chat)


def test_success_is_private_durable_suggestion_then_explicit_human_save(env, monkeypatch):
    client, sessions, actor = env
    did = document(env); body = request(client, did); calls = []
    fake_provider(monkeypatch, calls)
    before = client.get("/api/v1/delivery/context").json()["version"]
    url = f"/api/v1/design-docs/{did}/previews"
    response = client.post(url, json=body)
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["status"] == "succeeded" and view["can_save"]
    assert view["model"] == "configured-model" and view["provider"] == "configured-provider"
    assert len(calls) == 1 and calls[0]["cache_ttl"] == 0 and calls[0]["model"] is None
    assert "明确边界与验收" in calls[0]["messages"][1]["content"]
    assert client.post(url, json=body).json()["id"] == view["id"] and len(calls) == 1
    assert client.get("/api/v1/delivery/context").json()["version"] == before
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Revision)) == 1
        assert db.scalar(select(func.count()).select_from(Generation)) == 1
    actor["id"] = "reader"
    assert client.get(f"{url}/{view['id']}").status_code == 404
    actor["id"] = "lead"
    head = client.get(f"/api/v1/design-docs/{did}").json()["document"]
    save = {"document_id": did, "document_version": head["document_version"],
        "base_revision_id": body["base_revision_id"], "base_revision_digest": body["base_revision_digest"],
        "title": "Reviewed architecture", "category": "architecture", "tags": [],
        "content": view["content"] + "\n人工补充", "note": "Human reviewed suggestion", "preview_id": view["id"]}
    saved = command(client, "design.revision.save", save)
    assert saved.status_code == 200, saved.text
    current = client.get(f"{url}/{view['id']}").json()
    assert current["content"] == view["content"] and not current["current_basis"] and not current["can_save"]
    assert client.post(url, json=body).json()["id"] == view["id"] and len(calls) == 1
    conflict = client.post(url, json={**body, "instructions": "changed original"})
    assert conflict.status_code == 409


@pytest.mark.parametrize("output,finish", [("", "stop"), ("中" * 22000, "stop"), ("partial", "length"), ("bad\x00output", "stop")])
def test_invalid_or_truncated_output_is_persisted_failed_without_fallback_or_second_provider(env, monkeypatch, output, finish):
    client, sessions, _actor = env
    did = document(env); calls = []; fake_provider(monkeypatch, calls, content=output, finish_reason=finish)
    body = request(client, did); url = f"/api/v1/design-docs/{did}/previews"
    response = client.post(url, json=body)
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["status"] == "failed" and view["content"] is None and not view["can_save"]
    assert view["error"]["code"] == "design_preview_invalid_output"
    assert client.post(url, json=body).json()["id"] == view["id"] and len(calls) == 1
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Revision)) == 1


def test_unknown_durable_intake_never_repeats_provider_on_recovery(env, monkeypatch):
    client, sessions, _actor = env
    did = document(env); body = request(client, did)
    # Simulate process death, outside the service's normal Exception handling.
    def interrupted(*_args): raise KeyboardInterrupt()
    monkeypatch.setattr(llm_gateway, "llm_chat", interrupted)
    with pytest.raises(KeyboardInterrupt): client.post(f"/api/v1/design-docs/{did}/previews", json=body)
    monkeypatch.setattr(llm_gateway, "llm_chat", lambda *_args: pytest.fail("accepted generation was executed twice"))
    response = client.post(f"/api/v1/design-docs/{did}/previews", json=body)
    assert response.status_code == 200 and response.json()["status"] == "generating"
    assert response.json()["content"] is None and not response.json()["can_save"]
    with sessions() as db: assert db.scalar(select(func.count()).select_from(Generation)) == 1


def test_complete_multibyte_result_and_archived_project_keep_original_without_auto_save(env, monkeypatch):
    client, sessions, _actor = env
    did = document(env)
    content = "中" * 21845  # 65535 UTF-8 bytes; stored JSON escaping exceeds 128 KiB.
    calls = []
    def provider(body, _request):
        calls.append(body)
        with sessions() as db:
            db.connection().execute(update(models.Project).where(models.Project.id == "project").values(status="archived"))
            db.commit()
        return llm_gateway.ChatOut(model="configured", provider="configured", content=content)
    monkeypatch.setattr(llm_gateway, "llm_chat", provider)
    body = request(client, did); url = f"/api/v1/design-docs/{did}/previews"
    response = client.post(url, json=body)
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["status"] == "succeeded" and view["content"] == content and not view["can_save"]
    assert client.get(f"{url}/{view['id']}").json()["content"] == content
    assert client.post(url, json=body).json()["id"] == view["id"] and len(calls) == 1
    assert client.post(url, json={**body, "idempotency_key": "new-archived-request"}).status_code in {403, 409}
    with sessions() as db: assert db.scalar(select(func.count()).select_from(Revision)) == 1


def test_invalid_provider_usage_is_failed_and_original_does_not_remain_sending(env, monkeypatch):
    client, sessions, _actor = env
    did = document(env); calls = []
    def provider(*_args):
        calls.append(True)
        return llm_gateway.ChatOut(model="configured", provider="configured", content="# complete",
            usage=llm_gateway.ChatUsage(cost_usd=float("nan")))
    monkeypatch.setattr(llm_gateway, "llm_chat", provider)
    body = request(client, did); url = f"/api/v1/design-docs/{did}/previews"
    response = client.post(url, json=body)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "failed" and response.json()["usage"] == {}
    assert client.post(url, json=body).json()["id"] == response.json()["id"] and len(calls) == 1


@pytest.mark.parametrize("character", ["\n", "\x01"])
def test_full_escaped_terminal_json_is_valid_before_guard_commit(env, monkeypatch, character):
    client, sessions, _actor = env
    did = document(env); calls = []
    content = "# complete" + character * (65536 - len("# complete"))
    fake_provider(monkeypatch, calls, content=content)
    body = request(client, did, instructions="中" * 4000)
    url = f"/api/v1/design-docs/{did}/previews"
    response = client.post(url, json=body)
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["status"] == "succeeded" and view["content"] == content
    assert client.get(f"{url}/{view['id']}").json()["content"] == content
    assert client.post(url, json=body).json()["id"] == view["id"] and len(calls) == 1


def test_original_key_cannot_be_rebound_to_another_document(env, monkeypatch):
    client, sessions, _actor = env
    first = document(env); calls = []; fake_provider(monkeypatch, calls)
    body = request(client, first)
    response = client.post(f"/api/v1/design-docs/{first}/previews", json=body)
    assert response.status_code == 200, response.text
    second = command(client, "design.document.create", {"title": "Another design", "content": "# Complete second design"})
    assert second.status_code == 200, second.text
    did = second.json()["result"]["document_id"]
    conflict = client.post(f"/api/v1/design-docs/{did}/previews", json=request(client, did))
    assert conflict.status_code == 409 and conflict.json()["detail"]["code"] == "design_preview_idempotency_conflict"
    assert len(calls) == 1


def test_original_and_outcome_cannot_be_rewritten_through_ordinary_orm_or_core_sql(env, monkeypatch):
    client, sessions, _actor = env
    did = document(env); calls = []; fake_provider(monkeypatch, calls)
    view = client.post(f"/api/v1/design-docs/{did}/previews", json=request(client, did)).json()
    for core in (False, True):
        with sessions() as db:
            row = db.get(Generation, view["id"])
            changed = {**deepcopy(row.data), "content": "forged"}
            with pytest.raises(HTTPException):
                if core: db.execute(update(Generation).where(Generation.id == row.id).values(data=changed))
                else: row.data = changed; db.flush()
            db.rollback()
    assert client.get(f"/api/v1/design-docs/{did}/previews/{view['id']}").json()["content"] == view["content"]
