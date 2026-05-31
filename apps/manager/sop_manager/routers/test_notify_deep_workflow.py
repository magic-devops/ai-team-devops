from contextlib import contextmanager

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import notify


@contextmanager
def scoped_project(root, *, tenant="tenant-im", business="biz-im", project="project-im"):
    tokens = set_request_scope(
        tenant_id=tenant,
        project_id=project,
        project_path=root,
        tenant_code=tenant,
        business_code=business,
        project_code=project,
    )
    try:
        yield
    finally:
        reset_request_scope(tokens)


def test_notify_inbound_deduplicates_message_id(tmp_path):
    with scoped_project(tmp_path):
        first = notify.inbound(
            notify.InboundMsg(
                channel="dingtalk",
                sender="u1",
                text="创建一个工单",
                event="message",
                payload={"message_id": "msg-001"},
            )
        )
        second = notify.inbound(
            notify.InboundMsg(
                channel="dingtalk",
                sender="u1",
                text="创建一个工单",
                event="message",
                payload={"message_id": "msg-001"},
            )
        )
        messages = notify.messages(limit=20, direction="inbound")

    assert first["ok"] is True
    assert second["duplicated"] is True
    assert second["original_id"] == first["id"]
    assert messages["total"] == 1


def test_notify_approval_callback_records_review_and_audit(monkeypatch, tmp_path):
    reviewed = {}

    def fake_review(approval_id: str, *, status: str, reviewer: str, note: str = ""):
        reviewed.update({"approval_id": approval_id, "status": status, "reviewer": reviewer, "note": note})
        return {"id": approval_id, "status": status, "reviewer": reviewer, "note": note}

    monkeypatch.setattr("sop_manager.routers.system_pages._review_approval", fake_review)

    with scoped_project(tmp_path):
        out = notify.approval_callback(
            notify.ApprovalCallbackIn(
                approval_id="appr-1",
                status="approved",
                reviewer="ops-lead",
                note="同意执行",
                source_channel="wechat_work",
                callback_message_id="cb-1",
            )
        )
        events = notify.messages(limit=20)

    assert out["ok"] is True
    assert out["approval"]["status"] == "approved"
    assert reviewed["approval_id"] == "appr-1"
    assert any(item.get("event") == "approval_callback" for item in events["items"])


def test_notify_task_status_push_and_report_subscription_are_productized(tmp_path):
    with scoped_project(tmp_path):
        notify.add_channel(
            notify.Channel(
                type="webhook",
                name="ops-webhook",
                webhook_url="https://example.invalid/hook",
                enabled=True,
                events=["task_status_changed", "report_published"],
            )
        )

        dry_run = notify.task_status_push(
            notify.TaskStatusPushIn(
                task_id="TASK-1",
                status="blocked",
                title="任务阻塞",
                content="等待审批",
                channels=["ops-webhook"],
                dry_run=True,
            )
        )
        subscription = notify.upsert_report_subscription(
            notify.ReportSubscriptionIn(
                report_type="weekly_quality",
                channel="ops-webhook",
                schedule="weekly",
                enabled=True,
                filters={"severity": "high"},
            )
        )
        subs = notify.report_subscriptions()
        dry_report_run = notify.run_report_subscriptions(
            notify.ReportSubscriptionRunIn(
                report_type="weekly_quality",
                schedule="weekly",
                channels=["ops-webhook"],
                dry_run=True,
            )
        )
        report_runs = notify.report_subscription_runs(limit=10)
        health = notify.connector_health()

    assert dry_run["dry_run"] is True
    assert dry_run["delivery_plan"]["ready"] is True
    assert dry_run["delivery_plan"]["audit"]["event"] == "task_status_changed"
    assert subscription["item"]["report_type"] == "weekly_quality"
    assert subs["total"] == 1
    assert dry_report_run["ok"] is True
    assert dry_report_run["dry_run"] is True
    assert dry_report_run["run"]["selected_count"] == 1
    assert dry_report_run["run"]["messages_planned"] == 1
    assert dry_report_run["delivery_plans"][0]["plan"]["ready"] is True
    assert report_runs["total"] == 1
    assert report_runs["items"][0]["event"] == "report_subscription_run"
    assert health["summary"]["configured"] == 1
    assert health["items"][0]["status"] in {"healthy", "idle"}
    assert "task_status_changed" in health["items"][0]["events"]


def test_notify_system_pages_contract_exposes_deep_im_workflow():
    from sop_manager.routers.system_pages import system_pages_readiness

    payload = system_pages_readiness(q="消息")
    notify_page = next(item for item in payload["items"] if item["id"] == "notify")

    apis = set(notify_page["implementation_contract"]["apis"])
    assert "/api/v1/notify/connectors/health" in apis
    assert "/api/v1/notify/approvals/callback" in apis
    assert "/api/v1/notify/tasks/status-push" in apis
    assert "/api/v1/notify/report-subscriptions" in apis
    assert "/api/v1/notify/report-subscriptions/runs" in apis
    assert "/api/v1/notify/report-subscriptions/run" in apis
    assert "入站去重" in notify_page["capabilities"]
    assert "审批回调" in notify_page["capabilities"]
    assert "任务状态推送" in notify_page["capabilities"]
    assert "报告订阅" in notify_page["capabilities"]
    assert "订阅运行中心" in notify_page["capabilities"]
