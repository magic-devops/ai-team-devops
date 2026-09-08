from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hermes_core.api import install_errors
from hermes_core.execution import Execution
from hermes_core.models import CoreError, Principal
from hermes_core.scheduling import ScheduleConfigure, Scheduler, create_scheduling_router
from hermes_core.transactional import Store

BASE = "/api/hermes/v1"


def make_client(tmp_path, principal: Principal | None = None, *, agentd: str = ""):
    principal = principal or Principal("owner")
    tmp_path.mkdir(parents=True, exist_ok=True)
    store = Store("sqlite:///" + str(tmp_path / "workspace.sqlite"))
    execution = Execution(store, tmp_path, agentd)
    app = FastAPI()
    app.state.hermes_store = store
    app.state.hermes_execution = execution
    install_errors(app)

    def identity():
        return principal

    app.include_router(create_scheduling_router(store, execution, identity))
    client = TestClient(app)
    workspace = store.create(principal, "", "workspaces", {"name": "W", "root": str(tmp_path)}, "workspace", "trace")
    client.headers["X-Workspace-Id"] = workspace["id"]
    return app, client, store, execution, principal, workspace["id"]


def config_body(**overrides):
    starts_at = overrides.pop("starts_at", datetime(2026, 9, 8, 12, 0, tzinfo=timezone.utc))
    starts_at_value = starts_at if isinstance(starts_at, str) else starts_at.isoformat()
    body = {
        "title": "Nightly checks",
        "interval_seconds": 60,
        "starts_at": starts_at_value,
        "nodes": [{"id": "test", "argv": ["go", "test", "./..."], "timeout_seconds": 30}],
        "enabled": True,
        "misfire_coalesce": True,
        "idempotency_key": "configure",
        "dry_run": False,
    }
    body.update(overrides)
    return body


def assert_cli(payload: dict, command: str, workspace: str):
    assert payload["cli"] == {"command": command, "workspace_id": workspace}
    assert payload["cli"]["command"] != "sop workspace list --json"


def test_configure_persists_authority_workspace_snapshot_and_is_idempotent(tmp_path):
    _app, client, _store, _execution, _principal, workspace = make_client(tmp_path)
    response = client.post(BASE + "/schedules/build/configure", json=config_body())
    assert response.status_code == 200, response.text
    payload = response.json()
    assert_cli(payload, "sop schedule get build --json", workspace)
    schedule = payload["items"][0]
    assert schedule["id"] == "build"
    assert schedule["status"] == "active"
    assert schedule["data"]["workspace_root"] == str(tmp_path.resolve())
    assert schedule["data"]["workspace_version"] == 1
    assert schedule["data"]["authority"]["actor"] == "owner"
    assert schedule["data"]["nodes"][0]["argv"] == ["go", "test", "./..."]

    duplicate = client.post(BASE + "/schedules/build/configure", json=config_body())
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["items"][0] == schedule


def test_configure_rejects_invalid_config_and_missing_execute_authority(tmp_path):
    _app, client, _store, _execution, _principal, _workspace = make_client(tmp_path)
    cases = [
        config_body(interval_seconds=9),
        config_body(starts_at=datetime.now().replace(microsecond=0).isoformat()),
        config_body(title="   "),
        config_body(nodes=[{"id": "dup", "argv": ["echo", "1"]}, {"id": "dup", "argv": ["echo", "2"]}]),
        config_body(nodes=[{"id": "empty", "argv": []}]),
        config_body(nodes=[{"id": "nul", "argv": ["echo", "bad\x00arg"]}]),
        config_body(target_device_id="device-1"),
        config_body(authority={"actor": "forged"}),
    ]
    for body in cases:
        response = client.post(BASE + "/schedules/build/configure", json=body)
        assert response.status_code == 422, response.text

    _app, denied, _store, _execution, _principal, _workspace = make_client(
        tmp_path / "denied",
        Principal("ops", permissions=frozenset({"read", "config"})),
    )
    forbidden = denied.post(BASE + "/schedules/build/configure", json=config_body())
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "forbidden"


def test_trigger_creates_durable_queued_run_and_refuses_overlap_after_reconfigure(tmp_path, monkeypatch):
    app, client, store, _execution, principal, workspace = make_client(tmp_path)
    monkeypatch.setattr(app.state.hermes_execution, "execute", lambda *_args, **_kwargs: None)
    schedule = client.post(BASE + "/schedules/build/configure", json=config_body()).json()["items"][0]
    reconfigured = client.post(BASE + "/schedules/build/configure", json=config_body(
        expected_version=schedule["version"],
        idempotency_key="reconfigure",
        interval_seconds=120,
    )).json()["items"][0]

    trigger = client.post(BASE + "/schedules/build/trigger", json={
        "expected_version": reconfigured["version"],
        "idempotency_key": "trigger",
        "dry_run": False,
    })
    assert trigger.status_code == 200, trigger.text
    payload = trigger.json()
    assert_cli(payload, "sop schedule get build --json", workspace)
    run = payload["items"][0]
    assert run["kind"] == "runs"
    assert run["status"] == "queued"
    assert run["data"]["schedule"]["id"] == "build"
    assert run["data"]["schedule"]["authority"]["actor"] == "owner"

    duplicate = client.post(BASE + "/schedules/build/trigger", json={
        "expected_version": reconfigured["version"],
        "idempotency_key": "trigger",
        "dry_run": False,
    })
    assert duplicate.status_code == 200
    assert duplicate.json()["items"][0] == run

    current_schedule = store.get(principal, workspace, "schedules", "build")
    overlap = client.post(BASE + "/schedules/build/trigger", json={
        "expected_version": current_schedule["version"],
        "idempotency_key": "trigger-2",
        "dry_run": False,
    })
    assert overlap.status_code == 409
    assert overlap.json()["error"]["code"] == "schedule_overlap"

    workspace_row = store.get(principal, "", "workspaces", workspace)
    store.mutate(principal, "", "workspaces", workspace, operation="workspace.bump-after-trigger",
                 key="bump-after-trigger", request={}, trace="trace", expected=workspace_row["version"],
                 transform=lambda item: {"data": {**item["data"], "name": "Changed after trigger"}})
    retry_after_drift = client.post(BASE + "/schedules/build/trigger", json={
        "expected_version": reconfigured["version"],
        "idempotency_key": "trigger",
        "dry_run": False,
    })
    assert retry_after_drift.status_code == 200
    assert retry_after_drift.json()["items"][0] == run


def test_due_processing_is_transactional_o1_coalesces_and_records_stale_schedule_error(tmp_path):
    _app, client, store, execution, principal, workspace = make_client(tmp_path)
    ancient = datetime(2020, 1, 1, tzinfo=timezone.utc)
    schedule = client.post(BASE + "/schedules/build/configure", json=config_body(
        starts_at=ancient,
        interval_seconds=10,
    )).json()["items"][0]
    workspace_row = store.get(principal, "", "workspaces", workspace)
    store.mutate(principal, "", "workspaces", workspace, operation="workspace.bump", key="bump",
                 request={}, trace="trace", expected=workspace_row["version"],
                 transform=lambda item: {"data": {**item["data"], "name": "Changed"}})
    healthy = client.post(BASE + "/schedules/healthy/configure", json=config_body(
        starts_at=ancient,
        interval_seconds=10,
        idempotency_key="healthy",
    )).json()["items"][0]
    scheduler = Scheduler(store, execution)

    runs = scheduler.due(principal, workspace)
    assert len(runs) == 1
    assert runs[0]["data"]["schedule"]["id"] == "healthy"
    stale = store.get(principal, workspace, "schedules", "build")
    assert stale["version"] == schedule["version"]
    updated = store.get(principal, workspace, "schedules", "healthy")
    assert updated["version"] == healthy["version"] + 1
    assert datetime.fromisoformat(updated["data"]["next_due_at"]) > datetime.now(timezone.utc)
    assert updated["data"]["last_run_id"] == runs[0]["id"]
    stale_events = store.stream(principal, workspace, entity_id="build")
    assert stale_events[-1]["action"] == "schedule.error"
    assert stale_events[-1]["data"]["code"] == "workspace_changed"
    assert scheduler.due(principal, workspace) == []


def test_recover_queued_filters_scheduled_runs_before_limit(tmp_path, monkeypatch):
    app, _client, store, execution, principal, workspace = make_client(tmp_path)
    executed = []
    monkeypatch.setattr(app.state.hermes_execution, "execute", lambda _principal, _workspace, run_id: executed.append(run_id))
    for index in range(30):
        store.create(principal, workspace, "runs", {
            "title": f"manual-{index}",
            "nodes": [{"id": "ok", "argv": ["echo", "ok"]}],
        }, f"manual-{index}", "trace", status="queued")
    scheduled = [
        store.create(principal, workspace, "runs", {
            "title": f"scheduled-{index}",
            "nodes": [{"id": "ok", "argv": ["echo", "ok"]}],
            "schedule": {"id": "build"},
        }, f"scheduled-{index}", "trace", status="queued")
        for index in range(2)
    ]

    recovered = Scheduler(store, execution).recover_queued(principal, workspace, limit=2)
    assert [row["id"] for row in recovered] == [row["id"] for row in scheduled]
    assert executed == [row["id"] for row in scheduled]


def test_history_filters_before_limit_and_pause_resume_requires_execute(tmp_path):
    _app, client, store, _execution, principal, workspace = make_client(tmp_path)
    schedule = client.post(BASE + "/schedules/build/configure", json=config_body()).json()["items"][0]
    scheduled = store.create(principal, workspace, "runs", {
        "title": "scheduled",
        "nodes": [{"id": "ok", "argv": ["echo", "ok"]}],
        "schedule": {"id": "build"},
    }, "scheduled-run", "trace", status="completed")
    for index in range(520):
        store.create(principal, workspace, "runs", {
            "title": f"unrelated-{index}",
            "nodes": [{"id": "ok", "argv": ["echo", "ok"]}],
            "schedule": {"id": "other"},
        }, f"unrelated-{index}", "trace", status="completed")
    history = client.get(BASE + "/schedules/build/history", params={"limit": 1})
    assert history.status_code == 200
    history_payload = history.json()
    assert_cli(history_payload, "sop schedule history build --json", workspace)
    assert history_payload["items"][0]["id"] == scheduled["id"]

    _app, denied, _store, _execution, _principal, _workspace = make_client(
        tmp_path / "resume-denied",
        Principal("ops", permissions=frozenset({"read", "config"})),
    )
    denied_schedule = denied.post(BASE + "/schedules/build/configure", json=config_body())
    assert denied_schedule.status_code == 403
    paused = client.post(BASE + "/schedules/build/pause", json={
        "expected_version": schedule["version"],
        "idempotency_key": "pause",
        "dry_run": False,
    })
    assert paused.status_code == 200
    paused_payload = paused.json()
    assert_cli(paused_payload, "sop schedule get build --json", workspace)
    paused = paused_payload["items"][0]
    client.headers["Authorization"] = "ignored"
    resumed = client.post(BASE + "/schedules/build/resume", json={
        "expected_version": paused["version"],
        "idempotency_key": "resume",
        "dry_run": False,
    })
    assert resumed.status_code == 200
    resumed_payload = resumed.json()
    assert_cli(resumed_payload, "sop schedule get build --json", workspace)
    assert resumed_payload["items"][0]["status"] == "active"


def test_agent_schedule_binds_once_and_tick_is_error_guarded(tmp_path, monkeypatch):
    app, client, store, execution, principal, workspace = make_client(tmp_path)
    monkeypatch.setattr(app.state.hermes_execution, "execute", lambda *_args, **_kwargs: None)
    agent = store.create(principal, workspace, "agents", {
        "title": "Coder",
        "provider": "codex",
        "model": "",
        "instructions": "Be concise",
        "timeout_seconds": 60,
    }, "agent", "trace")
    schedule = client.post(BASE + "/schedules/agent-job/configure", json=config_body(
        nodes=[{"id": "agent_step", "kind": "agent", "agent_id": agent["id"], "prompt": "Run checks"}],
    ))
    assert schedule.status_code == 200, schedule.text
    schedule_item = schedule.json()["items"][0]
    assert schedule_item["data"]["agent_bindings"]["agent_step"]["version"] == agent["version"]

    store.mutate(principal, workspace, "agents", agent["id"], operation="agent.bump", key="agent-bump",
                 request={}, trace="trace", expected=agent["version"],
                 transform=lambda item: {"data": {**item["data"], "instructions": "Changed"}})
    run = client.post(BASE + "/schedules/agent-job/trigger", json={
        "expected_version": schedule_item["version"],
        "idempotency_key": "trigger-agent",
        "dry_run": False,
    }).json()["items"][0]
    assert run["data"]["agent_bindings"]["agent_step"]["version"] == agent["version"]

    scheduler = Scheduler(store, execution)
    monkeypatch.setattr(app.state.hermes_execution, "recover", lambda *_args: (_ for _ in ()).throw(CoreError("boom", "recover failed")))
    result = scheduler.tick([(principal, workspace)])
    assert result["errors"]


def test_configure_idempotent_retry_returns_receipt_after_workspace_version_drift(tmp_path):
    _app, _client, store, execution, principal, workspace = make_client(tmp_path)
    scheduler = Scheduler(store, execution)
    body = ScheduleConfigure.model_validate(config_body(idempotency_key="configure-before-drift"))
    created = scheduler.configure(principal, workspace, "stable", body, "trace")
    workspace_row = store.get(principal, "", "workspaces", workspace)
    store.mutate(principal, "", "workspaces", workspace, operation="workspace.bump-after-configure",
                 key="bump-after-configure", request={}, trace="trace", expected=workspace_row["version"],
                 transform=lambda item: {"data": {**item["data"], "name": "Changed after configure"}})

    assert scheduler.configure(principal, workspace, "stable", body, "trace") == created
    changed = ScheduleConfigure.model_validate(config_body(
        idempotency_key="configure-new-key-after-drift",
        expected_version=created["version"],
    ))
    updated = scheduler.configure(principal, workspace, "stable", changed, "trace")
    assert updated["data"]["workspace_version"] == workspace_row["version"] + 1


def test_real_go_agentd_executes_scheduled_run_when_available(tmp_path):
    binary = os.environ.get("HERMES_TEST_AGENTD", "/private/tmp/hermes-v1-agentd")
    if not Path(binary).is_file():
        pytest.skip("Set HERMES_TEST_AGENTD=/private/tmp/hermes-v1-agentd for real Go agentd scheduling execution")
    _app, client, store, _execution, principal, workspace = make_client(tmp_path, agentd=binary)
    target = tmp_path / "scheduled.txt"
    schedule = client.post(BASE + "/schedules/live/configure", json=config_body(
        nodes=[{"id": "write", "argv": [sys.executable, "-c", f"from pathlib import Path; Path({str(target)!r}).write_text('ok')"]}],
    )).json()["items"][0]
    response = client.post(BASE + "/schedules/live/trigger", json={
        "expected_version": schedule["version"],
        "idempotency_key": "live-trigger",
        "dry_run": False,
    })
    assert response.status_code == 200, response.text
    run = store.get(principal, workspace, "runs", response.json()["items"][0]["id"])
    assert run["status"] == "completed", run
    assert target.read_text() == "ok"
