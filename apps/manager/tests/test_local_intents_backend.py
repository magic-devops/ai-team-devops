"""Original local write intent, reviewed bases and exact asset preconditions."""

import hashlib
import json
import shlex

import pytest
from pydantic import ValidationError
from sop_manager.routers import delivery_contract as c
from sop_manager.routers import sql_models as m
from sqlalchemy import select
from test_delivery_workbench import command, requirement
from test_event_handoff import env as env
from test_event_handoff import frozen, result, send, version
from test_event_handoff_business import flow_client


def push(env, module, record, *, action="update", eid="local-write", **metadata):
    return result(
        send(
            env[0],
            frozen(
                eid,
                "sop.sync.push",
                {
                    "module": module,
                    "action": action,
                    "record": record,
                    "expected_version": version(env[1]),
                    **metadata,
                },
            ),
        )
    )


def task_basis(env, tid="T-task"):
    from sop_manager.routers.delivery_service import initial_state, reconcile
    from sop_manager.routers.delivery_verification import VerificationContext

    with env[1]() as db:
        project = db.get(m.Project, "project")
        workspace = db.get(m.DeliveryWorkspace, "project")
        state = reconcile(db, project, workspace.data) if workspace else initial_state()
        return VerificationContext(db, project, state).basis(tid)


def test_explicit_create_update_and_original_replay_are_distinct(env):
    created = push(env, "issues", {"id": "I-fixed", "title": "Original"}, action="create")
    assert created["processing"]["state"] == "processed", created
    old_version = version(env[1])
    conflict = push(
        env, "issues", {"id": "I-fixed", "title": "Overwrite"}, action="create", eid="other-create"
    )
    assert conflict["processing"]["reason_code"] == "event_target_exists"
    assert version(env[1]) == old_version
    changed = push(env, "issues", {"id": "I-fixed", "description": "Only patch"}, eid="patch")
    assert changed["processing"]["state"] == "processed", changed
    with env[1]() as db:
        row = db.get(m.Issue, "I-fixed")
        assert row.title == "Original" and row.description == "Only patch"
        original = db.scalar(select(m.EventInbox).where(m.EventInbox.id == created["receipt_id"]))
        item = {"id": original.event_id, "event_json": original.event_json, "digest": original.digest}
    replay = result(send(env[0], item))
    assert replay["outcome"] == "duplicate" and replay["receipt_id"] == created["receipt_id"]
    with env[1]() as db:
        assert db.query(m.Issue).count() == 1
        assert db.get(m.Issue, "I-fixed").description == "Only patch"
    missing = push(env, "issues", {"id": "missing", "title": "Never create"}, eid="missing-update")
    assert missing["processing"]["reason_code"] == "event_target_missing"
    with env[1]() as db:
        assert db.get(m.Issue, "missing") is None


@pytest.mark.parametrize("module", ["tasks", "requirements", "issues", "sprints"])
def test_explicit_create_and_update_support_every_canonical_entity(env, module):
    required = {"goal": "Sprint"} if module == "sprints" else {"title": "Created"}
    made = push(env, module, {"id": "fixed-entity", **required}, action="create")
    assert made["processing"]["state"] == "processed", made
    patch = (
        {"goal": "Next goal"}
        if module == "sprints"
        else {"priority": "P2"}
        if module in {"tasks", "requirements"}
        else {"severity": "P3"}
    )
    updated = push(env, module, {"id": "fixed-entity", **patch}, eid="update")
    assert updated["processing"]["state"] == "processed", updated
    from sop_manager.routers.event_business import MODELS

    with env[1]() as db:
        row = db.get(MODELS[module], "fixed-entity")
        for field, value in patch.items():
            assert getattr(row, field) == value


@pytest.mark.parametrize("changes", [{"acceptance_criteria": ["New scope"]}, {"owner_id": "user:lead"}])
def test_existing_task_definition_write_requires_original_task_basis(env, changes):
    before = version(env[1])
    denied = push(env, "tasks", {"id": "T-task", **changes}, action="upsert")
    assert denied["processing"]["state"] == "failed", denied
    assert denied["processing"]["reason_code"] == "task_basis_required"
    assert version(env[1]) == before
    accepted = push(env, "tasks", {"id": "T-task", **changes}, eid="reviewed", task_basis=task_basis(env))
    assert accepted["processing"]["state"] == "processed", accepted
    with env[1]() as db:
        for field, value in changes.items():
            assert getattr(db.get(m.Task, "T-task"), field) == value


def test_supplied_task_basis_is_checked_even_for_ordinary_patch_and_delete(env):
    original = task_basis(env)
    first = push(env, "tasks", {"id": "T-task", "description": "First edit"}, task_basis=original)
    assert first["processing"]["state"] == "processed", first
    before = version(env[1])
    for action, record in [("update", {"id": "T-task", "priority": "P2"}), ("delete", {"id": "T-task"})]:
        denied = push(env, "tasks", record, action=action, eid="stale-" + action, task_basis=original)
        assert denied["processing"]["reason_code"] == "task_basis_changed", denied
        assert version(env[1]) == before
    with env[1]() as db:
        assert db.get(m.Task, "T-task").description == "First edit"


@pytest.mark.parametrize(
    "module,metadata",
    [
        ("issues", {"task_basis": "a" * 64}),
        ("sprints", {"requirement_basis": "a" * 64}),
        ("tasks", {"change_preview_basis": "a" * 64}),
        ("requirements", {"task_basis": None}),
        ("tasks", {"task_basis": True}),
        ("requirements", {"requirement_basis": "A" * 64}),
        ("requirements", {"change_preview_basis": "short"}),
    ],
)
def test_basis_metadata_rejects_wrong_module_and_invalid_digest(module, metadata):
    with pytest.raises(ValidationError):
        c.SyncRecordApply(module=module, record={"id": "unchanged"}, **metadata)


def test_requirement_sync_preserves_reviewed_preview_and_rejects_stale_basis(env):
    client = flow_client(env)
    rid = requirement(client)
    approved = command(client, "stage.advance", {"requirement_id": rid, "comment": "Reviewed"}).json()
    original = next(row for row in approved["requirements"] if row["id"] == rid)
    changes = {"acceptance_criteria": ["Reviewed new scope"]}
    preview = client.post(
        f"/api/v1/delivery/requirements/{rid}/change-preview",
        json={"requirement_basis": original["basis"], "changes": changes},
    )
    assert preview.status_code == 200, preview.text
    accepted = push(
        env,
        "requirements",
        {"id": rid, **changes},
        requirement_basis=original["basis"],
        change_preview_basis=preview.json()["preview_basis"],
    )
    assert accepted["processing"]["state"] == "processed", accepted
    with env[1]() as db:
        assert db.get(m.Requirement, rid).acceptance_criteria == changes["acceptance_criteria"]
        flow = db.get(m.DeliveryWorkspace, "project").data["flows"][rid]
        assert flow["stage"] == "intake" and flow["revision"] > original["flow"]["revision"]
    stale = push(
        env,
        "requirements",
        {"id": rid, "priority": "P3"},
        eid="stale-requirement",
        requirement_basis=original["basis"],
    )
    assert stale["processing"]["reason_code"] == "requirement_basis_changed", stale


def test_requirement_sync_rejects_changed_preview_without_mutating_original(env):
    client = flow_client(env)
    rid = requirement(client)
    observed = client.get(f"/api/v1/delivery/requirements/{rid}").json()["requirement"]
    bad = push(
        env,
        "requirements",
        {"id": rid, "title": "Unreviewed"},
        requirement_basis=observed["basis"],
        change_preview_basis="0" * 64,
    )
    assert bad["processing"]["reason_code"] == "requirement_change_preview_changed", bad
    with env[1]() as db:
        assert db.get(m.Requirement, rid).title == observed["title"]


@pytest.mark.parametrize("expected", [None, "0" * 64])
def test_asset_original_hash_conflict_is_stored_failed_and_never_overwritten(env, expected):
    target = env[3] / ".ai-memory/rules/original.md"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"original\r\n")
    receipt = push(
        env,
        "rules",
        {"path": "original.md", "content": "replacement", "expected_sha256": expected},
        action="upsert",
    )
    assert receipt["outcome"] == "stored"
    assert receipt["processing"]["reason_code"] == "event_asset_basis_changed", receipt
    assert target.read_bytes() == b"original\r\n"
    with env[1]() as db:
        original = db.scalar(select(m.EventInbox).where(m.EventInbox.id == receipt["receipt_id"]))
        assert '"expected_sha256"' in original.event_json


def test_asset_matching_hash_updates_and_explicit_absent_creates_exact_bytes(env):
    target = env[3] / ".ai-memory/rules/original.md"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"original\r\n")
    accepted = push(
        env,
        "rules",
        {
            "path": "original.md",
            "content": "替换\r\n",
            "expected_sha256": hashlib.sha256(b"original\r\n").hexdigest(),
        },
        action="upsert",
    )
    assert accepted["processing"]["state"] == "processed", accepted
    assert target.read_bytes() == "替换\r\n".encode()
    made = push(
        env,
        "specs",
        {"path": "new.md", "content": "new\r\n", "expected_sha256": None},
        action="upsert",
        eid="absent",
    )
    assert made["processing"]["state"] == "processed", made
    assert (env[3] / "sop/custom/specs/new.md").read_bytes() == b"new\r\n"


def test_missing_asset_basis_cannot_overwrite_existing_target(env):
    target = env[3] / ".ai-memory/rules/original.md"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"original")
    denied = push(env, "rules", {"path": "original.md", "content": "overwrite"}, action="upsert")
    assert denied["processing"]["state"] == "failed", denied
    assert target.read_bytes() == b"original"


@pytest.mark.parametrize(
    "record",
    [
        {"path": "new.md", "content": "new"},
        {"path": "new.md", "content": "new", "expected_sha256": True},
        {"path": "new.md", "content": "new", "expected_sha256": "g" * 64},
        {"path": "new.md", "content": "new", "expected_sha256": "short"},
    ],
)
def test_asset_requires_known_original_digest_not_unknown(env, record):
    denied = push(env, "rules", record, action="upsert")
    assert denied["processing"]["state"] == "failed", denied
    assert not denied["processing"]["retryable"]
    assert not (env[3] / ".ai-memory/rules/new.md").exists()


def test_new_business_actions_record_actual_activity_targets(env):
    client = flow_client(env)
    issue = result(
        send(
            client, frozen(etype="sop.issue.opened", data={"expected_version": 0, "title": "Observed issue"})
        )
    )
    iid = issue["processing"]["result"]["target_id"]
    updated = push(env, "tasks", {"id": "T-task", "description": "Progress"}, action="upsert")
    assert updated["processing"]["state"] == "processed", updated
    page = client.get("/api/v1/delivery/activity").json()
    values = {row["action"]: row for row in page["items"]}
    assert values["issue.create"]["target"]["kind"] == "issue"
    assert values["issue.create"]["target"]["id"] == iid
    assert values["sync.record.apply"]["target"]["kind"] == "task"
    assert values["sync.record.apply"]["target"]["id"] == "T-task"


def test_agent_profile_emits_canonical_frozen_heartbeat_instruction(tmp_path, monkeypatch):
    from sop_manager.routers import agents

    monkeypatch.setattr(agents, "_agent_path", lambda _: tmp_path / "agent.json")
    monkeypatch.setattr(agents, "_read_json", lambda _: {"id": "agent-proof", "name": "Proof"})
    profile = agents.agent_profile("agent-proof")["profile"]
    argv = shlex.split(profile["commands"]["emit_event"])
    assert argv[:4] == ["sop", "event", "emit", "sop.agent.heartbeat"]
    assert argv[argv.index("--subject") + 1] == "agent-proof"
    assert argv[argv.index("--id") + 1] and argv[argv.index("--time") + 1]
    assert any("原" in value and "ID" in value for value in profile["guardrails"])


def test_direct_sync_accepts_original_create_update_and_sparse_basis_metadata(env):
    from sop_manager.routers import sync_api

    env[4].include_router(sync_api.router)
    body = {
        "module": "tasks",
        "action": "create",
        "record": {"id": "direct-fixed", "title": "Direct"},
        "expected_version": version(env[1]),
        "idempotency_key": "direct-original",
    }
    first = env[0].post("/api/v1/sync/push", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["processing"]["state"] == "processed", first.text
    with env[1]() as db:
        original = db.scalar(select(m.EventInbox).where(m.EventInbox.id == first.json()["receipt_id"]))
        data = json.loads(original.event_json)["data"]
        assert not {"task_basis", "requirement_basis", "change_preview_basis"} & data.keys()
        stamp = original.event_time
    replay = env[0].post("/api/v1/sync/push", json=body)
    assert replay.json()["receipt_id"] == first.json()["receipt_id"]
    basis = task_basis(env, "direct-fixed")
    patch = env[0].post(
        "/api/v1/sync/push",
        json={
            **body,
            "action": "update",
            "expected_version": version(env[1]),
            "idempotency_key": "direct-patch",
            "record": {"id": "direct-fixed", "owner_id": "user:lead"},
            "task_basis": basis,
        },
    )
    assert patch.status_code == 200 and patch.json()["processing"]["state"] == "processed", patch.text
    with env[1]() as db:
        assert db.get(m.Task, "direct-fixed").owner_id == "user:lead"
        original = db.scalar(select(m.EventInbox).where(m.EventInbox.id == first.json()["receipt_id"]))
        assert original.event_time == stamp
    malformed = env[0].post("/api/v1/sync/push", json={**body, "requirement_basis": None})
    assert malformed.status_code == 422
