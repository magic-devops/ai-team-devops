from __future__ import annotations

import hmac
import secrets
from datetime import datetime, timezone
from hashlib import sha256

import pytest
from hermes_core.execution import Execution
from hermes_core.models import CoreError, Principal
from hermes_core.scheduling import ScheduleConfigure, Scheduler
from hermes_core.transactional import Store
from hermes_core.webhooks import verify_webhook
from test_scheduling import BASE, config_body, make_client


def trigger_body(trigger: dict, **overrides):
    body = {
        "title": "Triggered checks",
        "trigger": trigger,
        "nodes": [{"id": "test", "argv": ["echo", "ok"], "timeout_seconds": 30}],
        "enabled": True,
        "misfire_coalesce": True,
        "idempotency_key": "configure-triggered",
        "dry_run": False,
    }
    body.update(overrides)
    return body


def webhook_headers(secret: str, delivery_id: str, raw_body: bytes, timestamp: int) -> dict[str, str]:
    signature = hmac.new(secret.encode(), f"{timestamp}.{delivery_id}.".encode() + raw_body, sha256).hexdigest()
    return {
        "X-Hermes-Webhook-Timestamp": str(timestamp),
        "X-Hermes-Webhook-Delivery": delivery_id,
        "X-Hermes-Webhook-Signature": "sha256=" + signature,
    }


def test_preview_route_uses_typed_cron_and_safe_cli_before_dynamic_schedule_route(tmp_path, monkeypatch):
    fixed_now = datetime(2026, 3, 7, 6, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(Scheduler, "_utcnow", staticmethod(lambda: fixed_now))
    _app, client, _store, _execution, _principal, workspace = make_client(tmp_path)

    response = client.post(BASE + "/schedules/preview", params={"runs": 4}, json=trigger_body({
        "type": "cron",
        "cron_expression": "30 2 * * *",
        "timezone": "America/New_York",
    }))

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["cli"] == {"command": "sop schedule preview --json", "workspace_id": workspace}
    assert payload["items"][0]["data"]["trigger"] == {
        "type": "cron",
        "cron_expression": "30 2 * * *",
        "timezone": "America/New_York",
    }
    assert payload["summary"]["next_runs"] == [
        "2026-03-07T07:30:00+00:00",
        "2026-03-08T07:00:00+00:00",
        "2026-03-09T06:30:00+00:00",
        "2026-03-10T06:30:00+00:00",
    ]


def test_cron_due_creates_durable_run_and_advances_with_utc_cursor(tmp_path, monkeypatch):
    configure_now = datetime(2026, 3, 7, 6, 0, tzinfo=timezone.utc)
    due_now = datetime(2026, 3, 7, 7, 31, tzinfo=timezone.utc)
    monkeypatch.setattr(Scheduler, "_utcnow", staticmethod(lambda: configure_now))
    _app, client, store, execution, principal, workspace = make_client(tmp_path)
    schedule = client.post(BASE + "/schedules/cron/configure", json=trigger_body({
        "type": "cron",
        "cron_expression": "30 2 * * *",
        "timezone": "America/New_York",
    })).json()["items"][0]

    monkeypatch.setattr(Scheduler, "_utcnow", staticmethod(lambda: due_now))
    runs = Scheduler(store, execution).due(principal, workspace)

    assert len(runs) == 1
    assert runs[0]["data"]["schedule"]["id"] == "cron"
    assert runs[0]["data"]["schedule"]["trigger_config"]["type"] == "cron"
    updated = store.get(principal, workspace, "schedules", "cron")
    assert updated["version"] == schedule["version"] + 1
    assert updated["data"]["last_run_id"] == runs[0]["id"]
    assert updated["data"]["next_due_at"] == "2026-03-08T07:00:00+00:00"


def test_cron_trigger_rejects_non_five_field_variants_this_stage(tmp_path):
    _app, client, _store, _execution, _principal, _workspace = make_client(tmp_path)
    response = client.post(BASE + "/schedules/preview", json=trigger_body({
        "type": "cron",
        "cron_expression": "0 30 2 * * *",
        "timezone": "UTC",
    }))

    assert response.status_code == 422


def test_webhook_hmac_receipt_is_idempotent_before_runnable_guard_and_audit_safe(tmp_path, monkeypatch):
    secret = secrets.token_urlsafe(24)
    monkeypatch.setenv("HERMES_SCHEDULE_SECRET", secret)
    _app, client, store, _execution, principal, workspace = make_client(tmp_path)
    monkeypatch.setattr(_app.state.hermes_execution, "execute", lambda *_args, **_kwargs: None)
    schedule = client.post(BASE + "/schedules/hook/configure", json=trigger_body({
        "type": "webhook",
        "secret_ref": "HERMES_SCHEDULE_SECRET",
        "max_body_bytes": 64,
    })).json()["items"][0]
    timestamp = int(datetime.now(timezone.utc).timestamp())
    raw_body = b'{"ignored":"not command input"}'

    first = client.post(BASE + "/schedules/hook/webhook", content=raw_body, headers=webhook_headers(secret, "delivery-1", raw_body, timestamp))
    assert first.status_code == 200, first.text
    assert first.json()["trace_id"] == first.json()["audit"]["trace_id"]
    run = first.json()["items"][0]
    assert run["data"]["nodes"] == schedule["data"]["nodes"]
    assert run["data"]["schedule"]["trigger"] == "webhook"

    workspace_row = store.get(principal, "", "workspaces", workspace)
    store.mutate(principal, "", "workspaces", workspace, operation="workspace.bump-after-webhook",
                 key="bump-after-webhook", request={}, trace="trace", expected=workspace_row["version"],
                 transform=lambda item: {"data": {**item["data"], "name": "Changed after webhook"}})
    duplicate = client.post(BASE + "/schedules/hook/webhook", content=raw_body, headers=webhook_headers(secret, "delivery-1", raw_body, timestamp))
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["items"][0] == run

    resigned = client.post(BASE + "/schedules/hook/webhook", content=raw_body,
                           headers=webhook_headers(secret, "delivery-1", raw_body, timestamp + 1))
    assert resigned.status_code == 200, resigned.text
    assert resigned.json()["items"][0] == run

    stale = client.post(BASE + "/schedules/hook/webhook", content=raw_body,
                        headers=webhook_headers(secret, "delivery-1", raw_body, timestamp - 3600))
    assert stale.status_code == 401
    assert stale.json()["error"]["code"] == "webhook_timestamp_stale"

    conflict = client.post(BASE + "/schedules/hook/webhook", content=b'{"changed":true}', headers=webhook_headers(secret, "delivery-1", b'{"changed":true}', timestamp))
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_conflict"

    events = store.stream(principal, workspace, entity_id="hook")
    webhook_event = [event for event in events if event["action"] == "schedule.webhook"][0]
    run_event = store.stream(principal, workspace, entity_id=run["id"])[0]
    assert webhook_event["trace_id"] == first.json()["trace_id"]
    assert run_event["trace_id"] == first.json()["trace_id"]
    assert webhook_event["data"]["delivery_id"] == "delivery-1"
    assert webhook_event["data"]["timestamp"] == str(timestamp)
    assert sum(event["action"] == "schedule.webhook" for event in events) == 1
    assert webhook_event["data"]["body_sha256"] == sha256(raw_body).hexdigest()
    assert "top-secret-value" not in str(webhook_event["data"])
    assert raw_body.decode() not in str(webhook_event["data"])


def test_webhook_rejects_missing_secret_large_body_and_paused_new_delivery(tmp_path, monkeypatch):
    monkeypatch.delenv("HERMES_MISSING_SECRET", raising=False)
    _app, client, store, _execution, principal, workspace = make_client(tmp_path)
    schedule = client.post(BASE + "/schedules/hook/configure", json=trigger_body({
        "type": "webhook",
        "secret_ref": "HERMES_MISSING_SECRET",
        "max_body_bytes": 4,
    })).json()["items"][0]
    timestamp = int(datetime.now(timezone.utc).timestamp())

    missing = client.post(BASE + "/schedules/hook/webhook", content=b"{}", headers=webhook_headers("ignored", "delivery-missing", b"{}", timestamp))
    assert missing.status_code == 409
    assert missing.json()["error"]["code"] == "webhook_secret_unavailable"

    monkeypatch.setenv("HERMES_MISSING_SECRET", "available")
    too_large = client.post(BASE + "/schedules/hook/webhook", content=b"12345", headers=webhook_headers("available", "delivery-large", b"12345", timestamp))
    assert too_large.status_code == 413
    assert too_large.json()["error"]["code"] == "webhook_body_too_large"

    paused = client.post(BASE + "/schedules/hook/pause", json={
        "expected_version": schedule["version"],
        "idempotency_key": "pause-hook",
        "dry_run": False,
    }).json()["items"][0]
    paused_delivery = client.post(BASE + "/schedules/hook/webhook", content=b"{}", headers=webhook_headers("available", "delivery-paused", b"{}", timestamp))
    assert paused["status"] == "paused"
    assert paused_delivery.status_code == 409
    assert paused_delivery.json()["error"]["code"] == "schedule_paused"
    assert store.receipt(principal, workspace, "schedule.webhook:hook", "delivery-paused", {
        "delivery_id": "delivery-paused",
        "body_sha256": sha256(b"{}").hexdigest(),
    }) is None


def test_webhook_route_applies_global_body_bound_before_schedule_max_or_signature(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_BIG_SECRET", "available")
    _app, client, _store, _execution, _principal, _workspace = make_client(tmp_path)
    schedule = client.post(BASE + "/schedules/hook/configure", json=trigger_body({
        "type": "webhook",
        "secret_ref": "HERMES_BIG_SECRET",
        "max_body_bytes": 1_048_576,
    }))
    assert schedule.status_code == 200, schedule.text

    response = client.post(
        BASE + "/schedules/hook/webhook",
        content=b"x",
        headers={"content-length": "1048577"},
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "webhook_body_too_large"


def test_webhook_verifier_rejects_non_ascii_signed_header_material_cleanly(monkeypatch):
    monkeypatch.setenv("HERMES_ASCII_SECRET", "available")
    with pytest.raises(CoreError) as exc:
        verify_webhook({"secret_ref": "HERMES_ASCII_SECRET"}, {
            "X-Hermes-Webhook-Timestamp": str(int(datetime.now(timezone.utc).timestamp())),
            "X-Hermes-Webhook-Delivery": "deliver-e-accent-\xe9",
            "X-Hermes-Webhook-Signature": "sha256=" + "0" * 64,
        }, b"{}")

    assert exc.value.status == 401
    assert exc.value.code == "webhook_signature_invalid"


def test_schedule_configure_uses_one_trace_for_response_and_audit(tmp_path):
    _app, client, store, _execution, principal, workspace = make_client(tmp_path)
    response = client.post(BASE + "/schedules/trace/configure", json=config_body(idempotency_key="trace-configure"))

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["trace_id"] == payload["audit"]["trace_id"]
    events = store.stream(principal, workspace, entity_id="trace")
    assert events[-1]["trace_id"] == payload["trace_id"]


def test_schedule_id_collision_across_workspace_returns_clean_409(tmp_path):
    store = Store("sqlite:///" + str(tmp_path / "workspace.sqlite"))
    execution = Execution(store, tmp_path, "")
    scheduler = Scheduler(store, execution)
    first = Principal("owner")
    second = Principal("owner", tenant="other")
    first_workspace = store.create(first, "", "workspaces", {"name": "First", "root": str(tmp_path)}, "first-workspace", "trace")["id"]
    second_workspace = store.create(second, "", "workspaces", {"name": "Second", "root": str(tmp_path)}, "second-workspace", "trace")["id"]
    body = ScheduleConfigure.model_validate(config_body(idempotency_key="first-daily"))
    scheduler.configure(first, first_workspace, "daily", body, "trace-first")

    with pytest.raises(CoreError) as exc:
        scheduler.configure(second, second_workspace, "daily", ScheduleConfigure.model_validate(config_body(idempotency_key="second-daily")), "trace-second")

    assert exc.value.status == 409
    assert exc.value.code == "schedule_id_conflict"
    assert "daily" not in exc.value.message


def test_authenticated_webhook_test_supports_dry_run_and_normal_run(tmp_path, monkeypatch):
    _app, client, _store, _execution, _principal, _workspace = make_client(tmp_path)
    monkeypatch.setattr(_app.state.hermes_execution, "execute", lambda *_args, **_kwargs: None)
    schedule = client.post(BASE + "/schedules/hook-test/configure", json=trigger_body({
        "type": "webhook",
        "secret_ref": "HERMES_TEST_ONLY_SECRET",
    })).json()["items"][0]

    dry_run = client.post(BASE + "/schedules/hook-test/webhook-test", json={
        "expected_version": schedule["version"],
        "idempotency_key": "test-dry-run",
        "dry_run": True,
    })
    assert dry_run.status_code == 200, dry_run.text
    assert dry_run.json()["summary"] == {"dry_run": True, "queued": False}
    assert dry_run.json()["items"][0]["data"]["schedule"]["trigger"] == "webhook:test"

    normal = client.post(BASE + "/schedules/hook-test/webhook-test", json={
        "expected_version": schedule["version"],
        "idempotency_key": "test-normal",
        "dry_run": False,
    })
    assert normal.status_code == 200, normal.text
    assert normal.json()["summary"] == {"dry_run": False, "queued": True}
    assert normal.json()["items"][0]["status"] == "queued"


def test_schedule_scopes_keep_persisted_authority_restricted_to_workspace(tmp_path):
    _app, client, store, execution, _principal, workspace = make_client(
        tmp_path,
        Principal("planner", permissions=frozenset({"read", "config", "execute"}), workspace_ids=frozenset({"missing"})),
    )
    client.headers["X-Workspace-Id"] = workspace
    denied = client.post(BASE + "/schedules/denied/configure", json=config_body())
    assert denied.status_code == 403

    _app, client, store, execution, principal, workspace = make_client(tmp_path / "allowed")
    client.post(BASE + "/schedules/allowed/configure", json=config_body())
    scopes = Scheduler(store, execution).scopes()
    assert scopes == [(Principal(
        actor=principal.actor,
        tenant=principal.tenant,
        business=principal.business,
        permissions=frozenset({"read", "execute"}),
        workspace_ids=frozenset({workspace}),
    ), workspace)]
