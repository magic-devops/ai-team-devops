from sop_manager.routers.im_integration_core import build_im_briefing, build_im_delivery_plan, build_report_subscription_digest


def test_build_im_briefing_escalates_high_risk_to_error_level():
    briefing = build_im_briefing(
        module="a2a",
        title="A2A 协议健康告警",
        summary={"health_score": 61, "pending_evidence": 3, "active": 1},
        risks=[{"level": "high", "title": "存在未回写证据的分发任务", "recommendation": "追踪 Agent 执行结果并补齐证据。"}],
        recommendations=["追踪 Agent 执行结果并补齐证据。"],
        scope={"tenant_code": "t1", "business_code": "b1", "project_id": "p1"},
        actions=[{"label": "查看 A2A", "href": "#/a2a"}],
    )

    assert briefing["level"] == "error"
    assert briefing["risk_level"] == "high"
    assert "A2A 协议健康告警" in briefing["content"]
    assert "pending_evidence" in briefing["content"]
    assert briefing["payload"]["scope"]["project_id"] == "p1"
    assert briefing["actions"][0]["label"] == "查看 A2A"


def test_build_im_delivery_plan_uses_enabled_requested_channels():
    briefing = build_im_briefing(
        module="llm_gateway",
        title="LLM Gateway 运行简报",
        summary={"health_score": 92, "active_routes": 4},
        risks=[],
        recommendations=[],
        scope={},
        actions=[],
    )
    channels = [
        {"name": "ops", "type": "dingtalk", "enabled": True},
        {"name": "disabled", "type": "wechat_work", "enabled": False},
    ]

    plan = build_im_delivery_plan(briefing, channels, requested_channels=["ops", "missing"])

    assert plan["ready"] is True
    assert plan["missing_channels"] == ["missing"]
    assert plan["targets"][0]["name"] == "ops"
    assert plan["messages"][0]["title"] == "LLM Gateway 运行简报"


def test_build_im_delivery_plan_recommends_config_when_no_channel_available():
    briefing = build_im_briefing(
        module="ops_center",
        title="OpsCenter 自愈审批提醒",
        summary={"health_score": 55},
        risks=[{"level": "critical", "title": "生产回滚需要审批"}],
        recommendations=[],
        scope={},
        actions=[],
    )

    plan = build_im_delivery_plan(briefing, [], requested_channels=[])

    assert plan["ready"] is False
    assert plan["targets"] == []
    assert plan["recommendation"]


def test_build_im_delivery_plan_prefers_event_matching_channels_when_no_requested_channels():
    briefing = build_im_briefing(
        module="a2a",
        title="A2A 协议健康告警",
        summary={"health_score": 72},
        risks=[{"level": "medium", "title": "协商失败率升高"}],
        recommendations=["优先通知 A2A 值班群。"],
        scope={"tenant_code": "t1"},
        actions=[],
    )
    channels = [
        {"name": "a2a-ops", "type": "dingtalk", "enabled": True, "events": ["a2a_risk", "approval_required"]},
        {"name": "all-alerts", "type": "webhook", "enabled": True, "events": ["*"]},
        {"name": "billing", "type": "slack", "enabled": True, "events": ["billing"]},
        {"name": "disabled-a2a", "type": "wechat_work", "enabled": False, "events": ["a2a_risk"]},
    ]

    plan = build_im_delivery_plan(briefing, channels, requested_channels=[], event="a2a_risk")

    assert [item["name"] for item in plan["targets"]] == ["a2a-ops", "all-alerts"]
    assert plan["target_count"] == 2
    assert plan["audit"]["event"] == "a2a_risk"
    assert plan["audit"]["selected_channels"] == ["a2a-ops", "all-alerts"]
    assert plan["selection_mode"] == "event"


def test_build_im_delivery_plan_marks_disabled_requested_channel_as_blocked():
    briefing = build_im_briefing(
        module="ops_center",
        title="OpsCenter 自愈审批提醒",
        summary={"health_score": 57},
        risks=[{"level": "critical", "title": "生产自愈需要审批"}],
        recommendations=[],
        scope={},
        actions=[],
    )
    channels = [
        {"name": "ops-primary", "type": "wechat_work", "enabled": True, "events": ["ops_center_risk"]},
        {"name": "ops-disabled", "type": "dingtalk", "enabled": False, "events": ["approval_required"]},
    ]

    plan = build_im_delivery_plan(
        briefing,
        channels,
        requested_channels=["ops-primary", "ops-disabled", "missing"],
        event="approval_required",
    )

    assert [item["name"] for item in plan["targets"]] == ["ops-primary"]
    assert plan["missing_channels"] == ["missing"]
    assert plan["blocked_channels"] == [{"name": "ops-disabled", "reason": "disabled"}]
    assert plan["audit"]["blocked_channels"] == [{"name": "ops-disabled", "reason": "disabled"}]


def test_build_im_delivery_plan_contains_audit_payload_without_polluting_notify_messages():
    briefing = build_im_briefing(
        module="llm_gateway",
        title="LLM Gateway 模型网关运行简报",
        summary={"health_score": 88, "active_routes": 4},
        risks=[],
        recommendations=[],
        scope={"project_id": "p1"},
        actions=[{"label": "查看模型网关", "href": "#/llm-gateway"}],
    )
    channels = [{"name": "gateway", "type": "webhook", "enabled": True, "events": ["llm_gateway_risk"]}]

    plan = build_im_delivery_plan(
        briefing,
        channels,
        requested_channels=[],
        event="llm_gateway_risk",
    )

    assert plan["audit"]["module"] == "llm_gateway"
    assert plan["audit"]["risk_level"] == "low"
    assert plan["audit"]["message_count"] == 1
    assert set(plan["messages"][0].keys()) == {"channel", "type", "title", "content", "level"}


def test_build_report_subscription_digest_creates_briefings_without_channel_secrets():
    digest = build_report_subscription_digest(
        subscriptions=[
            {
                "id": "weekly_quality:ops",
                "report_type": "weekly_quality",
                "channel": "ops",
                "schedule": "weekly",
                "enabled": True,
                "filters": {"severity": "high"},
            }
        ],
        notify_summary={"health_score": 90, "messages": 12, "last_24h": 3, "failures": 1},
        connector_health={"summary": {"score": 88, "degraded": 0, "disabled": 0}},
        recent_events=[{"title": "质量报告已发布", "channel": "ops"}],
        scope={"tenant_code": "t1", "business_code": "b1", "project_id": "p1"},
        now_iso="2026-05-25T00:00:00Z",
    )

    assert digest["ok"] is True
    assert digest["risk_level"] == "high"
    assert digest["summary"]["enabled_subscriptions"] == 1
    assert digest["items"][0]["subscription_id"] == "weekly_quality:ops"
    assert digest["items"][0]["briefing"]["payload"]["scope"]["project_id"] == "p1"
    assert "webhook_url" not in str(digest)
