"""Real SQL/CAS/source/consumer fault definitions; execution remains deferred."""
from copy import deepcopy
import json

import pytest
from fastapi import HTTPException
from hermes_core.transactional import digest
from sqlalchemy import delete, func, select, update

from sop_manager.routers import design_docs, sql_models as models
from sop_manager.routers.auth_sql import current_user, current_user_or_apikey
from sop_manager.routers.design_model import (
    ProjectDesignDocument as Document, ProjectDesignRevision as Revision, ProjectDesignAdoption as Adoption,
)
from test_delivery_execution import bridge as execution_bridge, finish, queue, queue_payload, sync
from test_delivery_manual_review import completed, make_task, review, review_current
from test_delivery_task_submissions import decide, detail, submit, task_fact
from test_delivery_workbench import command, env as delivery_env, requirement
from test_delivery_release_query import indexed, scope, trusted  # noqa: F401 -- real release fixtures

env = delivery_env
bridge = execution_bridge


def configure(client):
    if not getattr(client.app.state, "design_routes_added", False):
        client.app.include_router(design_docs.router)
        client.app.state.design_routes_added = True
    client.app.dependency_overrides[current_user_or_apikey] = client.app.dependency_overrides[current_user]


def raw(client, action, payload, *, key, version=None):
    return {"action": action, "payload": payload, "idempotency_key": key,
        "expected_version": client.get("/api/v1/delivery/context").json()["version"] if version is None else version}


def create(client, *, content="# Architecture\n\nExact contract and acceptance.", title="Architecture"):
    configure(client)
    response = command(client, "design.document.create", {"title": title, "content": content,
        "category": "architecture", "tags": ["delivery"], "note": "Reviewed source"})
    assert response.status_code == 200, response.text
    return response.json()["result"]["document_id"]


def head(client, did):
    response = client.get(f"/api/v1/design-docs/{did}")
    assert response.status_code == 200, response.text
    return response.json()["document"]


def base(client, did):
    value = head(client, did)
    return {"document_id": did, "document_version": value["document_version"],
        "base_revision_id": value["head_revision_id"], "base_revision_digest": value["head_revision_digest"]}


def save(client, did, *, content="# Revised\n\nAn explicit new design."):
    response = command(client, "design.revision.save", {**base(client, did), "title": "Revised",
        "category": "architecture", "tags": [], "content": content, "note": "Changed deliberately"})
    assert response.status_code == 200, response.text
    return response.json()["result"]


def prepare(client, kind, tid, did=None, *, slot="architecture", operation="adopt", revision=None):
    url = f"/api/v1/delivery/{kind}s/{tid}"
    current = client.get(url + "/designs")
    assert current.status_code == 200, current.text
    selected = current.json()
    source = revision or (head(client, did) if did else None)
    body = {"operation": operation, "slot": slot, "target_basis": selected["target_basis"], "design_basis": selected["design_basis"]}
    if operation == "adopt":
        body.update(document_id=did, revision_id=source["head_revision_id"], revision_digest=source["head_revision_digest"])
    response = client.post(url + "/design-adoption-preview", json=body)
    assert response.status_code == 200, response.text
    return response.json(), body


def adopt(client, kind, tid, did=None, *, slot="architecture", operation="adopt", revision=None, key=None):
    preview, body = prepare(client, kind, tid, did, slot=slot, operation=operation, revision=revision)
    assert preview["complete"] and preview["allowed"], preview
    payload = {key: value for key, value in body.items() if key != "operation"}
    payload.update({kind + "_id": tid, "preview_basis": preview["preview_basis"], "comment": "Reviewed the exact source and complete affected work."})
    request = raw(client, f"{kind}.design.{operation}", payload,
        key=key or f"fixed-design-{kind}-{operation}-{preview['version']}", version=preview["version"])
    response = client.post("/api/v1/delivery/commands", json=request)
    assert response.status_code == 200, response.text
    return response.json(), request


def test_documents_are_sql_originals_with_cas_replay_and_metadata_only_catalogues(env, tmp_path, monkeypatch):
    client, sessions, _actor = env
    configure(client)
    legacy = tmp_path / "tech_design" / "unique-user-document" / "current.md"
    legacy.parent.mkdir(parents=True)
    legacy.write_text("Unique user source must remain", encoding="utf-8")
    from sop_manager import path_config

    monkeypatch.setattr(path_config, "resolved_ai_memory_root", lambda: tmp_path)
    request = raw(client, "design.document.create", {"title": "Original", "content": "# original body marker"}, key="lost-create-response")
    first = client.post("/api/v1/delivery/commands", json=request)
    assert first.status_code == 200, first.text
    ack = first.json(); did = ack["result"]["document_id"]
    assert ack["resource"] == {"kind": "design_document", "id": did}
    assert {ref["kind"] for ref in ack["affected_refs"]} == {"design_document", "design_revision"}
    old = head(client, did)
    stale = {**base(client, did), "title": "Changed", "content": "# stale"}
    save(client, did)
    assert command(client, "design.revision.save", stale).status_code == 409
    replay = client.post("/api/v1/delivery/commands", json=request)
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert replay.json()["result"] == ack["result"]
    assert client.post("/api/v1/delivery/commands", json={**request, "payload": {**request["payload"], "title": "Different"}}).status_code == 409
    assert "original body marker" not in json.dumps(client.get("/api/v1/design-docs").json())
    revisions = client.get(f"/api/v1/design-docs/{did}/revisions").json()
    assert revisions["total"] == 2 and all("content" not in row for row in revisions["items"])
    assert client.get(f"/api/v1/design-docs/{did}/revisions/{old['head_revision_id']}").json()["content"] == "# original body marker"
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Document)) == 1
        assert db.scalar(select(func.count()).select_from(Revision)) == 2
    assert legacy.read_text(encoding="utf-8") == "Unique user source must remain"


def test_new_project_without_query_facts_reads_an_empty_library_without_writes_then_can_create(env):
    client, sessions, _actor = env
    configure(client)
    with sessions() as db:
        # Model the real project bootstrap window before any derived index exists.
        db.connection().execute(delete(models.DeliveryQueryFact).where(models.DeliveryQueryFact.project_id == "project"))
        db.connection().execute(delete(models.DeliveryQueryState).where(models.DeliveryQueryState.project_id == "project"))
        db.commit()
    with sessions() as db:
        assert db.get(models.DeliveryQueryState, "project") is None
        before = {table.name: db.scalar(select(func.count()).select_from(table)) for table in models.Base.metadata.sorted_tables}
    response = client.get("/api/v1/design-docs")
    assert response.status_code == 200, response.text
    assert response.json()["items"] == [] and response.json()["total"] == 0
    assert response.json()["version"] == 0 and response.json()["query_generation"] is None
    assert response.json()["permissions"]["can_write"]
    with sessions() as db:
        after = {table.name: db.scalar(select(func.count()).select_from(table)) for table in models.Base.metadata.sorted_tables}
        assert after == before and db.get(models.DeliveryQueryState, "project") is None
    did = create(client)
    ready = client.get("/api/v1/design-docs")
    assert ready.status_code == 200 and ready.json()["query_generation"] is not None
    assert ready.json()["total"] == 1 and ready.json()["items"][0]["id"] == did


def test_restore_appends_a_revision_and_archived_document_can_be_explicitly_restored(env):
    client, sessions, actor = env
    did = create(client); original = head(client, did)
    save(client, did)
    restore = command(client, "design.revision.restore", {**base(client, did), "revision_id": original["head_revision_id"],
        "revision_digest": original["head_revision_digest"], "note": "Restore the reviewed original"})
    assert restore.status_code == 200, restore.text
    current = head(client, did)
    assert current["revision_number"] == 3 and current["head_revision_id"] != original["head_revision_id"]
    detail_view = client.get(f"/api/v1/design-docs/{did}/revisions/{current['head_revision_id']}").json()
    assert detail_view["revision"]["restored_from"] == original["head_revision_id"]
    assert command(client, "design.document.archive", {**base(client, did), "archived": True}).status_code == 200
    archived = client.get(f"/api/v1/design-docs/{did}").json()
    assert archived["document"]["archived"] and archived["permissions"]["can_write"] and not archived["permissions"]["can_generate"]
    assert client.get("/api/v1/design-docs").json()["total"] == 0
    assert client.get("/api/v1/design-docs?include_archived=true").json()["total"] == 1
    assert client.get(f"/api/v1/design-docs/{did}/revisions/{original['head_revision_id']}").status_code == 200
    actor["id"] = "reader"
    assert not client.get(f"/api/v1/design-docs/{did}").json()["permissions"]["can_write"]
    assert command(client, "design.document.archive", {**base(client, did), "archived": False}).status_code == 403
    actor["id"] = "lead"
    assert command(client, "design.document.archive", {**base(client, did), "archived": False}).status_code == 200
    with sessions() as db: assert db.scalar(select(func.count()).select_from(Revision)) == 3


def test_requirement_fixed_revision_is_official_evidence_without_silent_head_adoption(env):
    client, _sessions, _actor = env
    rid = requirement(client); did = create(client); original = head(client, did)
    ack, request = adopt(client, "requirement", rid, did, slot="prd")
    assert ack["resource"] == {"kind": "design_adoption", "id": ack["result"]["adoption_id"]}
    assert command(client, "stage.advance", {"requirement_id": rid, "comment": "Criteria reviewed"}).status_code == 200
    state = client.get("/api/v1/delivery/workspace").json()
    req = next(row for row in state["requirements"] if row["id"] == rid)
    assert req["flow"]["stage"] == "product" and next(gate for gate in req["flow"]["gates"] if gate["id"] == "prd")["ok"]
    assert command(client, "stage.advance", {"requirement_id": rid, "comment": "Fixed PRD reviewed"}).status_code == 200
    save(client, did)
    current = client.get(f"/api/v1/delivery/requirements/{rid}/designs").json()
    assert current["effective"][0]["revision_id"] == original["head_revision_id"]
    assert "content" not in current["effective"][0]
    duplicate, _ = prepare(client, "requirement", rid, did, slot="prd", revision=original)
    assert not duplicate["allowed"] and any(reason["code"] == "design_already_adopted" for reason in duplicate["reasons"])
    assert client.post("/api/v1/delivery/commands", json=request).json()["result"] == ack["result"]


def test_task_override_clear_exposes_inherited_revision_and_activity_uses_real_targets(env):
    client, sessions, _actor = env
    task = make_task(client); inherited = create(client); override = create(client, title="Task design")
    adopt(client, "requirement", task["req_id"], inherited)
    before = client.get(f"/api/v1/delivery/tasks/{task['id']}/designs").json()
    assert before["own"] == [] and before["effective"][0]["origin_kind"] == "requirement"
    ack, _request = adopt(client, "task", task["id"], override)
    own = client.get(f"/api/v1/delivery/tasks/{task['id']}/designs").json()
    assert own["effective"][0]["document_id"] == override and own["own"][0]["origin_kind"] == "task"
    cleared, _ = adopt(client, "task", task["id"], operation="clear")
    after = client.get(f"/api/v1/delivery/tasks/{task['id']}/designs").json()
    assert after["own"] == [] and after["effective"] == before["effective"]
    with sessions() as db:
        row = db.scalar(select(Adoption).where(Adoption.id == cleared["result"]["adoption_id"]))
        assert row.operation == "clear" and row.revision_id is None and row.reference is None
        event = db.scalar(select(models.DeliveryEvent).where(models.DeliveryEvent.resource_id == ack["result"]["adoption_id"]))
        refs = event.data["activity"]["refs"]
        assert {"kind": "task", "id": task["id"]} in refs
        assert not any(ref["id"] == ack["result"]["adoption_id"] and ref["kind"] in {"task", "requirement"} for ref in refs)
        links = db.scalars(select(models.DeliveryActivityLink.requirement_id).where(models.DeliveryActivityLink.event_id == event.id)).all()
        assert links == [task["req_id"]]


def test_standalone_task_design_change_permanently_invalidates_human_review(env):
    client, sessions, _actor = env
    created = command(client, "task.create", {"title": "Standalone", "owner_id": "user:lead", "acceptance_criteria": ["Exact behavior"]})
    assert created.status_code == 200, created.text
    task = created.json()["tasks"][0]; did = create(client)
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert review(client, task["id"]).status_code == 200
    assert review_current(client, task["id"]).json()["current"]["verified"]
    ack, _ = adopt(client, "task", task["id"], did)
    assert ack["result"]["task_ids"] == [task["id"]] and ack["result"]["requirement_id"] is None
    assert not review_current(client, task["id"]).json()["current"]["verified"]
    adopt(client, "task", task["id"], operation="clear")
    assert not review_current(client, task["id"]).json()["current"]["verified"]
    with sessions() as db: assert db.scalar(select(models.DeliveryTaskReview)).invalidated


def test_adoption_preview_cannot_apply_after_affected_work_changes(env):
    client, _sessions, _actor = env
    task = make_task(client); did = create(client)
    preview, body = prepare(client, "requirement", task["req_id"], did)
    assert preview["complete"] and preview["impact"]["counts"]["direct_task"] == 1
    changed = command(client, "task.create", {"requirement_id": task["req_id"], "title": "Added affected task", "owner_id": "user:lead", "acceptance_criteria": ["Added behavior"]})
    assert changed.status_code == 200
    payload = {key: value for key, value in body.items() if key != "operation"}
    payload.update(requirement_id=task["req_id"], preview_basis=preview["preview_basis"], comment="Stale reviewed scope")
    response = command(client, "requirement.design.adopt", payload)
    assert response.status_code == 409


def test_adoption_invalidates_external_report_and_progress_without_changing_its_original(env):
    client, sessions, _actor = env
    task = make_task(client); did = create(client)
    ack, _request = submit(client, task["id"]); sid = ack["result"]["submission_id"]
    accepted, _ = decide(client, task["id"], sid)
    assert accepted.status_code == 200, accepted.text
    original = detail(client, task["id"], sid).json()["definition"]
    assert task_fact(sessions, task["id"])["status"] == "verified_completed"
    adopt(client, "requirement", task["req_id"], did)
    historical = detail(client, task["id"], sid).json()
    assert historical["submission"]["invalidated"] and historical["definition"] == original
    assert task_fact(sessions, task["id"])["status"] != "verified_completed"
    assert not historical["permissions"]["can_review"]


def test_prepare_queue_and_handoff_consume_fixed_revision_after_new_head_and_archive(bridge):
    client, sessions, _store, _principal, _workspace, rid, _task = bridge
    did = create(client, content="# Fixed architecture\n\nBODY_EXACT_OLD")
    original = head(client, did); adopt(client, "requirement", rid, did)
    save(client, did, content="# New unrelated head\n\nBODY_NEW_HEAD")
    assert command(client, "design.document.archive", {**base(client, did), "archived": True}).status_code == 200
    payload = queue_payload(bridge)
    preview = client.post("/api/v1/delivery/execution-preview", json=payload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["snapshot"]["designs"][0]["revision_id"] == original["head_revision_id"]
    assert "design_context" not in preview.json()
    execution = queue(bridge)
    from sop_manager.routers.delivery_execution_handoff import _validate_original

    with sessions() as db:
        row = db.scalar(select(models.DeliveryExecutionHandoff).where(models.DeliveryExecutionHandoff.execution_id == execution["id"]))
        fixed = deepcopy(row.original)
        request = _validate_original(row)
        assert fixed["design_context"][0]["content"] == "# Fixed architecture\n\nBODY_EXACT_OLD"
        assert request["envelope"]["design_context"] == fixed["design_context"]
        assert "BODY_NEW_HEAD" not in json.dumps(request)
        assert _validate_original(row) == request
    assert "BODY_EXACT_OLD" not in json.dumps(client.get("/api/v1/delivery/workspace").json())


def test_native_review_and_inbox_share_adopted_design_basis_and_re_adoption_invalidates(bridge):
    client, _sessions, _store, _principal, _workspace, rid, task = bridge
    did = create(client); adopt(client, "requirement", rid, did)
    execution = sync(bridge, queue(bridge)); finish(bridge, execution); execution = sync(bridge, execution)
    from sop_manager.routers.delivery_inbox import build_inbox

    workspace = client.get("/api/v1/delivery/workspace").json()
    inbox = build_inbox(workspace, {"id": "lead"})
    assert any(item["task_id"] == task["id"] and "acceptance" in item["categories"] for item in inbox["items"])
    accepted = command(client, "execution.review", {"id": execution["id"], "decision": "accept", "comment": "Verified fixed design", "run_version": execution["run_version"]})
    assert accepted.status_code == 200, accepted.text
    save(client, did); adopt(client, "requirement", rid, did)
    workspace = client.get("/api/v1/delivery/workspace").json()
    old = next(row for row in workspace["executions"] if row["id"] == execution["id"])
    assert old["planning_invalidated"] and old["stale"]
    assert not next(row for row in workspace["tasks"] if row["id"] == task["id"])["verified"]


def test_new_empty_design_context_and_legacy_handoff_four_keys_do_not_change_each_other(bridge):
    client, sessions, _store, _principal, _workspace, _rid, _task = bridge
    execution = queue(bridge)
    from sop_manager.routers.delivery_execution import _envelope_data
    from sop_manager.routers.delivery_execution_handoff import _validate_original

    with sessions() as db:
        row = db.scalar(select(models.DeliveryExecutionHandoff).where(models.DeliveryExecutionHandoff.execution_id == execution["id"]))
        original = deepcopy(row.original)
        assert _validate_original(row)["envelope"]["design_context"] == []
    old = deepcopy(original); old.pop("design_context")
    old["snapshot"].pop("designs"); old["snapshot"].pop("design_basis")
    envelope = _envelope_data(old)
    assert set(envelope) == {"title", "description", "acceptance_criteria", "source"}
    assert "designs" not in envelope["source"]["snapshot"] and old != original


@pytest.mark.parametrize("model,field,value", [(Revision, "content", "forged"), (Adoption, "comment", "forged"), (Document, "title", "forged")])
def test_sql_originals_and_head_require_canonical_service_scope(env, model, field, value):
    client, sessions, _actor = env
    task = make_task(client); did = create(client); ack, _ = adopt(client, "task", task["id"], did)
    with sessions() as db:
        row = db.scalar(select(model).where(model.project_id == "project"))
        with pytest.raises(HTTPException) as raised:
            db.execute(update(model).where(model.project_id == "project", model.id == row.id).values({field: value}))
        assert raised.value.detail["code"] == "design_original_immutable"
        db.rollback()
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}/designs").json()["effective"][0]["adoption_id"] == ack["result"]["adoption_id"]


@pytest.mark.parametrize("corruption", ["request-shape", "clear-source", "reference", "oversized"])
def test_canonical_design_proof_rejects_corrupt_adoption_original_before_trusting_metadata(env, corruption):
    client, sessions, _actor = env
    task = make_task(client); did = create(client); ack, _ = adopt(client, "task", task["id"], did)
    with sessions() as db:
        row = db.scalar(select(Adoption).where(Adoption.id == ack["result"]["adoption_id"]))
        original = deepcopy(row.original)
        if corruption == "request-shape": original["request"] = []
        elif corruption == "clear-source": original["action"] = "task.design.clear"
        elif corruption == "reference": original["reference"]["adoption_id"] = "forged"
        else: original["oversized"] = "x" * (1024 * 1024)
        # Simulate corrupt persisted storage, below ordinary Manager guards.
        db.connection().execute(update(Adoption).where(Adoption.seq == row.seq).values(original=original, digest=digest(original)))
        db.commit()
    response = client.get(f"/api/v1/delivery/tasks/{task['id']}/designs")
    assert response.status_code == (413 if corruption == "oversized" else 409)


def test_revision_detail_rejects_mutated_or_oversized_source_and_cross_project_reads(env):
    client, sessions, actor = env
    did = create(client); fixed = head(client, did)
    actor["id"] = "reader"
    assert client.get(f"/api/v1/design-docs/{did}", headers={"X-Project-Id": "other"}).status_code == 403
    actor["id"] = "lead"
    assert client.get(f"/api/v1/design-docs/{did}", headers={"X-Project-Id": "other"}).status_code == 404
    with sessions() as db:
        db.connection().execute(update(Revision).where(Revision.project_id == "project", Revision.id == fixed["head_revision_id"]).values(content="x" * 65537))
        db.commit()
    response = client.get(f"/api/v1/design-docs/{did}/revisions/{fixed['head_revision_id']}")
    assert response.status_code == 413


def test_ai_task_plan_receipt_uses_exact_adopted_body_without_copying_it_to_metadata(env, monkeypatch):
    client, sessions, _actor = env
    rid = requirement(client); did = create(client, content="# Exact\n\nPLAN_FIXED_SOURCE")
    fixed = head(client, did); adopt(client, "requirement", rid, did)
    save(client, did, content="# Later head\n\nNOT_SELECTED")
    from sop_manager.routers import delivery_plan

    calls = []
    def generated(_requirement, _body, _request, _existing, *, designs, design_context):
        calls.append((deepcopy(designs), deepcopy(design_context)))
        from sop_manager.routers.delivery_contract import TaskDraft

        return [TaskDraft(key="implement", title="Implement", acceptance_criteria=["Exact behavior"])], [], "configured", "configured", {}
    monkeypatch.setattr(delivery_plan, "_generate", generated)
    body = {"requirement_id": rid, "generator": "ai", "mode": "fullstack", "max_items": 4,
        "expected_version": client.get("/api/v1/delivery/context").json()["version"], "idempotency_key": "fixed-design-task-plan"}
    response = client.post("/api/v1/delivery/task-plan-preview", json=body)
    assert response.status_code == 200, response.text
    assert calls[0][0][0]["revision_id"] == fixed["head_revision_id"]
    assert calls[0][1][0]["content"] == "# Exact\n\nPLAN_FIXED_SOURCE"
    assert client.post("/api/v1/delivery/task-plan-preview", json=body).status_code == 200 and len(calls) == 1
    with sessions() as db:
        receipt = db.scalar(select(models.DeliveryPlanPreview))
        assert receipt.data["designs"][0]["revision_id"] == fixed["head_revision_id"]
        assert "PLAN_FIXED_SOURCE" not in json.dumps(receipt.data)


def test_design_adoption_invalidates_real_release_candidate_and_blocks_old_approval(indexed):
    client, _sessions, _actor, ids = indexed
    candidate_id = ids[-1][0]
    initial = client.get(f"/api/v1/delivery/releases/{candidate_id}")
    assert initial.status_code == 200, initial.text
    candidate = initial.json()["candidate"]
    assert candidate["valid"] and candidate["permissions"]["can_approve"]
    original = deepcopy(candidate["snapshot"])
    did = create(client)
    adopt(client, "requirement", "R-release", did)
    changed = client.get(f"/api/v1/delivery/releases/{candidate_id}")
    assert changed.status_code == 200, changed.text
    current = changed.json()["candidate"]
    assert current["invalidated"] and not current["valid"] and not current["permissions"]["can_approve"]
    assert current["snapshot"] == original
    assert {reason["code"] for reason in current["reasons"]} & {"release_scope_changed", "release_quality_unverified"}
    denied = command(client, "release.candidate.review", {"id": candidate_id, "decision": "approve",
        "comment": "Old scope cannot approve the new design", "review_basis": candidate["review_basis"]})
    assert denied.status_code == 409


def test_generation_scope_cannot_rewrite_another_original_or_repeat_a_terminal_outcome(env, monkeypatch):
    client, sessions, _actor = env
    did = create(client)
    from sop_manager.project_write_guard import design_generation_write_scope
    from sop_manager.routers import llm_gateway
    from sop_manager.routers.design_generation_model import ProjectDesignGeneration as Generation

    monkeypatch.setattr(llm_gateway, "llm_chat", lambda *_args: llm_gateway.ChatOut(model="configured", provider="configured", content="# Complete proposal"))
    fixed = head(client, did)
    response = client.post(f"/api/v1/design-docs/{did}/previews", json={
        "base_revision_id": fixed["head_revision_id"], "base_revision_digest": fixed["head_revision_digest"],
        "mode": "expand", "instructions": "Clarify", "idempotency_key": "scoped-fixed-generation"})
    assert response.status_code == 200 and response.json()["status"] == "succeeded"
    gid = response.json()["id"]
    for capability_id in ("another-generation", gid):
        with sessions() as db, design_generation_write_scope(db, "tenant", "project", capability_id):
            row = db.get(Generation, gid)
            with pytest.raises(HTTPException) as rejected:
                db.execute(update(Generation).where(Generation.id == gid).values(status="succeeded", data=deepcopy(row.data)))
            assert rejected.value.detail["code"] == "design_generation_immutable"
            db.rollback()
