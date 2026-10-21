"""Actual report event scopes across receipt reads/replay, with a real Core store."""
from sop_manager.routers import events_ingest
from sop_manager.routers.auth_sql import current_user, current_user_or_apikey
from test_delivery_execution import bridge as bridge, cancel_execution, queue
from test_delivery_task_submissions import counts, report, revoke_runtime_membership
from test_delivery_workbench import env as env
from test_event_handoff import frozen, result, send, version


def test_external_report_event_cannot_bypass_original_workspace_revocation(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    client.app.include_router(events_ingest.router)
    client.app.dependency_overrides[current_user_or_apikey] = client.app.dependency_overrides[current_user]
    intent = queue(bridge)
    assert cancel_execution(client, intent["id"]).status_code == 200
    payload = report(client, task["id"])
    original = frozen("scoped-report", "sop.task.delivery_submitted", {
        "expected_version": version(sessions), "report": payload}, task["id"])
    receipt = result(send(client, original))
    assert receipt["processing"]["state"] == "processed", receipt
    rid = receipt["receipt_id"]
    assert client.get(f"/api/v1/events/{rid}").status_code == 200
    before = counts(sessions)
    page = client.get("/api/v1/events", params={"event_type": "sop.task.delivery_submitted"})
    assert page.status_code == 200
    item = next(item for item in page.json()["items"] if item["id"] == rid)
    assert item["source"] == item["subject"] == "" and item["processing"]["result"] is None
    assert counts(sessions) == before
    revoke_runtime_membership(bridge)
    after_revoke = counts(sessions)
    assert client.get(f"/api/v1/events/{rid}").status_code == 403
    assert client.get(f"/api/v1/events/{rid}/attempts").status_code == 403
    assert send(client, original).status_code == 403
    assert client.post(f"/api/v1/events/{rid}:retry", json={
        "expected_revision": receipt["processing"]["revision"], "reason": "Inspect original", "idempotency_key": "same-scope-retry"}).status_code == 403
    assert counts(sessions) == after_revoke
