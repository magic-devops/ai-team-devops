"""Real lifecycle consumers of external ownership; definitions remain unrun."""
from sop_manager.routers.sql_models import Project
from test_delivery_execution import bridge  # noqa: F401
from test_delivery_workbench import command, env  # noqa: F401
from test_external_work_order_native_gates import create_order, order_action
from test_project_lifecycle import preview_value


def test_unclaimed_order_blocks_archive_and_preserves_project_until_cancel(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    before = preview_value(sessions, reason="Archive after all delivery is closed")
    order = create_order(client, task["id"])
    preview = preview_value(sessions, reason="Archive after all delivery is closed")
    blockers = [item for item in preview["blockers"] if item["code"] == "external_work_order_active"]
    assert not preview["allowed"] and len(blockers) == 1
    assert blockers[0]["target"] == {"project_id": "project", "kind": "project", "view": "external-work-orders", "detail": "details"}
    assert before["preview_basis"] != preview["preview_basis"]
    denied = command(client, "project.lifecycle", {"target_status": "archived", "reason": preview["reason"], "preview_basis": preview["preview_basis"]})
    assert denied.status_code == 409 and denied.json()["detail"]["code"] == "project_archive_blocked"
    with sessions() as db:
        assert db.get(Project, "project").status == "active"
    order_action(client, order, "cancel", comment="No external account has claimed the work.")
    closed = preview_value(sessions, reason=preview["reason"])
    assert closed["allowed"] and not any(item["code"] == "external_work_order_active" for item in closed["blockers"])


def test_cancel_requested_keeps_archive_blocked_until_the_same_claimant_reports_stopped(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    order = order_action(client, create_order(client, task["id"]), "claim")
    order = order_action(client, order, "cancel", comment="Stop external work before closing this project.")
    preview = preview_value(sessions)
    assert order["state"] == "cancel_requested" and not preview["allowed"]
    assert "external_work_order_active" in {item["code"] for item in preview["blockers"]}
    released = order_action(client, order, "release", stopped_attestation=True, comment="The external tool has stopped; this is the claimant's report.")
    assert released["state"] == "closed"
    detail = client.get(f"/api/v1/delivery/work-orders/{order['work_order_id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["work_order"]["closure"]["kind"] == "external_reported_stop"
    assert preview_value(sessions)["allowed"]
