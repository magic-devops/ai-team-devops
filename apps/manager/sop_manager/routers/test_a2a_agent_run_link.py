from contextlib import contextmanager

import pytest
from fastapi import HTTPException

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import a2a_gateway as a2a
from sop_manager.routers import agent_runs
from sop_manager.routers.a2a_gateway import AgentRegister, DispatchIn, EvidenceIn, NegotiateIn


@contextmanager
def scoped_project(root, *, tenant="tenant-a", business="biz-a", project="project-a"):
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


def test_a2a_dispatch_creates_traceable_agent_run_and_protocol_packet(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(
            AgentRegister(
                name="External Coder",
                agent_type="workbuddy",
                endpoint="https://agent.example.test",
                capabilities=["code.implement", "test.automation"],
            )
        )

        dispatch = a2a.dispatch_task(
            DispatchIn(
                agent_id=agent["id"],
                task_id="T-a2a-run",
                payload={"title": "Implement A2A evidence loop"},
            )
        )
        run_list = agent_runs.list_runs(agent_id=agent["id"], status="", limit=10)
        packet = a2a.dispatch_packet(dispatch["id"])["packet"]

    assert dispatch["agent_run_id"]
    assert packet["dispatch_id"] == dispatch["id"]
    assert packet["run_id"] == dispatch["agent_run_id"]
    assert packet["callbacks"]["run_heartbeat"].endswith(f"/api/v1/agent-runs/{dispatch['agent_run_id']}/heartbeat")
    linked = next(item for item in run_list["items"] if item["id"] == dispatch["agent_run_id"])
    assert linked["status"] == "running"
    assert linked["task_id"] == "T-a2a-run"
    assert linked["meta"]["source"] == "a2a_dispatch"
    assert linked["meta"]["dispatch_id"] == dispatch["id"]


def test_a2a_evidence_updates_linked_agent_run_quality_result(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="External Tester", capabilities=["test.automation"]))
        dispatch = a2a.dispatch_task(DispatchIn(agent_id=agent["id"], task_id="T-a2a-evidence"))

        updated = a2a.receive_evidence(
            EvidenceIn(
                dispatch_id=dispatch["id"],
                status="success",
                artifact={"summary": "tests passed", "files": ["reports/a2a.md"]},
                confidence=0.91,
                quality_gate_results=[{"id": "unit", "passed": True, "detail": "green"}],
            )
        )
        linked = next(item for item in agent_runs.list_runs(agent_id=agent["id"], status="", limit=10)["items"] if item["id"] == dispatch["agent_run_id"])

    assert updated["status"] == "success"
    assert linked["status"] == "success"
    assert linked["artifact"] == {"summary": "tests passed", "files": ["reports/a2a.md"]}
    assert linked["confidence"] == 0.91
    assert linked["gate_results"]["a2a_quality_gates"][0]["id"] == "unit"
    assert linked["gate_results"]["evidence_quality"]["status"] == "complete"


def test_a2a_evidence_rejects_cross_project_dispatch(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Scoped Agent", capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(DispatchIn(agent_id=agent["id"], task_id="T-scope"))

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        with pytest.raises(HTTPException) as exc:
            a2a.receive_evidence(EvidenceIn(dispatch_id=dispatch["id"], status="success"))

    assert exc.value.status_code == 404


def test_a2a_failed_dispatch_can_retry_with_new_agent_run(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Retry Agent", capabilities=["code.implement"]))
        original = a2a.dispatch_task(
            DispatchIn(
                agent_id=agent["id"],
                task_id="T-a2a-retry",
                payload={"title": "retry failed dispatch", "required_capabilities": ["code.implement"]},
            )
        )
        a2a.receive_evidence(
            EvidenceIn(
                dispatch_id=original["id"],
                status="failed",
                artifact={"summary": "first attempt failed"},
                confidence=0.35,
                quality_gate_results=[{"id": "unit", "passed": False, "detail": "red"}],
            )
        )

        retried = a2a.retry_dispatch(original["id"])
        dispatches = a2a.list_dispatches(agent_id=agent["id"])["items"]
        runs = agent_runs.list_runs(agent_id=agent["id"], status="", limit=10)["items"]
        original_after = next(item for item in dispatches if item["id"] == original["id"])
        retried_run = next(item for item in runs if item["id"] == retried["agent_run_id"])

    assert retried["id"] != original["id"]
    assert retried["status"] == "dispatched"
    assert retried["retry_of_dispatch_id"] == original["id"]
    assert retried["retry_of_agent_run_id"] == original["agent_run_id"]
    assert retried["retry_count"] == 1
    assert retried["payload"]["title"] == "retry failed dispatch"
    assert retried["protocol_packet"]["dispatch_id"] == retried["id"]
    assert retried["protocol_packet"]["run_id"] == retried["agent_run_id"]
    assert original_after["status"] == "retrying"
    assert original_after["retry_dispatch_id"] == retried["id"]
    assert original_after["retry_count"] == 1
    assert retried_run["status"] == "running"
    assert retried_run["meta"]["source"] == "a2a_dispatch_retry"
    assert retried_run["meta"]["retry_of_dispatch_id"] == original["id"]


def test_a2a_retry_rejects_cross_project_dispatch(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Scoped Retry Agent", capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(DispatchIn(agent_id=agent["id"], task_id="T-a2a-scope-retry"))
        a2a.receive_evidence(EvidenceIn(dispatch_id=dispatch["id"], status="failed", artifact={"summary": "x"}))

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        with pytest.raises(HTTPException) as exc:
            a2a.retry_dispatch(dispatch["id"])

    assert exc.value.status_code == 404


def test_a2a_negotiation_session_tracks_dispatch_evidence_and_retry_timeline(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Timeline Agent", capabilities=["code.implement", "test.automation"]))
        negotiation = a2a.negotiate(
            NegotiateIn(
                task_type="code_implement",
                task_description="Implement and test timeline",
                required_capabilities=["code.implement"],
                priority="P1",
            )
        )

        dispatch = a2a.dispatch_task(
            DispatchIn(
                agent_id=agent["id"],
                task_id="T-a2a-session",
                session_id=negotiation["session_id"],
                payload={"title": "timeline dispatch"},
            )
        )
        a2a.receive_evidence(
            EvidenceIn(
                dispatch_id=dispatch["id"],
                status="failed",
                artifact={"summary": "timeline failed"},
                confidence=0.45,
                quality_gate_results=[{"id": "unit", "passed": False}],
            )
        )
        retried = a2a.retry_dispatch(dispatch["id"])
        session = a2a.get_session(negotiation["session_id"])
        sessions = a2a.list_sessions()

    assert negotiation["session_id"]
    assert dispatch["session_id"] == negotiation["session_id"]
    assert retried["session_id"] == negotiation["session_id"]
    assert sessions["total"] == 1
    event_types = [event["type"] for event in session["events"]]
    assert event_types == ["negotiated", "dispatched", "evidence_received", "retry_requested"]
    assert session["summary"]["dispatches"] == 2
    assert session["summary"]["evidence"] == 1
    assert session["events"][0]["candidate_count"] >= 1
    assert session["events"][1]["dispatch_id"] == dispatch["id"]
    assert session["events"][2]["status"] == "failed"
    assert session["events"][3]["dispatch_id"] == retried["id"]
    assert session["events"][3]["retry_of_dispatch_id"] == dispatch["id"]


def test_a2a_session_rejects_cross_project_read(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        a2a.register_agent(AgentRegister(name="Scoped Timeline Agent", capabilities=["code.implement"]))
        negotiation = a2a.negotiate(NegotiateIn(task_type="code_implement", required_capabilities=["code.implement"]))

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        with pytest.raises(HTTPException) as exc:
            a2a.get_session(negotiation["session_id"])

    assert exc.value.status_code == 404


def test_a2a_sla_report_flags_overdue_dispatch_and_generates_governance_task(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="SLA Agent", capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(
            DispatchIn(
                agent_id=agent["id"],
                task_id="T-a2a-sla-overdue",
                payload={"title": "overdue evidence", "sla_minutes": 30},
            )
        )
        dispatch["dispatched_at"] = "2026-05-21T00:00:00+00:00"
        a2a._save("dispatches", dispatch)

        report = a2a.sla_report(now="2026-05-21T00:45:00+00:00")
        tasks = a2a.sla_tasks(a2a.SlaTasksIn(dry_run=True), now="2026-05-21T00:45:00+00:00")

    assert report["summary"]["overdue"] == 1
    assert report["summary"]["missing_evidence"] == 1
    assert report["summary"]["health_score"] < 100
    assert report["items"][0]["dispatch_id"] == dispatch["id"]
    assert report["items"][0]["sla_status"] == "overdue"
    assert report["items"][0]["minutes_overdue"] == 15
    assert report["items"][0]["agent_run_id"] == dispatch["agent_run_id"]
    assert "/api/v1/a2a/sla/tasks" in report["agent_consumption"]["apis"]
    assert tasks["dry_run"] is True
    assert tasks["items"][0]["source"] == "a2a_sla_governance"
    assert tasks["items"][0]["priority"] == "P0"
    assert dispatch["id"] in tasks["items"][0]["description"]


def test_a2a_sla_report_is_scoped_by_project(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Scoped SLA Agent", capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(DispatchIn(agent_id=agent["id"], task_id="T-a2a-sla-scope", payload={"sla_minutes": 30}))
        dispatch["dispatched_at"] = "2026-05-21T00:00:00+00:00"
        a2a._save("dispatches", dispatch)

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        report = a2a.sla_report(now="2026-05-21T00:45:00+00:00")

    assert report["summary"]["total"] == 0
    assert report["summary"]["overdue"] == 0
    assert report["items"] == []


def test_a2a_sla_policy_update_changes_due_soon_threshold_and_is_scoped(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        policy = a2a.update_sla_policy(
            a2a.SlaPolicyIn(default_sla_minutes=60, due_soon_ratio=0.5, priority_sla_minutes={"P0": 10, "P1": 20})
        )
        agent = a2a.register_agent(AgentRegister(name="Policy SLA Agent", capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(
            DispatchIn(agent_id=agent["id"], task_id="T-a2a-sla-policy", payload={"priority": "P1"})
        )
        dispatch["dispatched_at"] = "2026-05-21T00:00:00+00:00"
        a2a._save("dispatches", dispatch)
        report = a2a.sla_report(now="2026-05-21T00:12:00+00:00")

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        other_policy = a2a.get_sla_policy()

    assert policy["default_sla_minutes"] == 60
    assert policy["priority_sla_minutes"]["P1"] == 20
    assert report["policy"]["priority_sla_minutes"]["P1"] == 20
    assert report["items"][0]["sla_minutes"] == 20
    assert report["items"][0]["sla_status"] == "due_soon"
    assert other_policy["default_sla_minutes"] == 30


def test_a2a_sla_escalation_auto_retries_overdue_dispatch_and_records_session_event(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        a2a.update_sla_policy(
            a2a.SlaPolicyIn(default_sla_minutes=30, auto_retry_enabled=True, max_auto_retries=1, im_alert_enabled=True)
        )
        agent = a2a.register_agent(AgentRegister(name="Escalation SLA Agent", capabilities=["code.implement"]))
        negotiation = a2a.negotiate(NegotiateIn(task_type="code_implement", required_capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(
            DispatchIn(
                agent_id=agent["id"],
                task_id="T-a2a-sla-escalate",
                session_id=negotiation["session_id"],
                payload={"priority": "P1", "sla_minutes": 30},
            )
        )
        dispatch["dispatched_at"] = "2026-05-21T00:00:00+00:00"
        a2a._save("dispatches", dispatch)

        preview = a2a.sla_escalations(a2a.SlaEscalationIn(dry_run=True), now="2026-05-21T00:45:00+00:00")
        applied = a2a.sla_escalations(a2a.SlaEscalationIn(dry_run=False), now="2026-05-21T00:45:00+00:00")
        dispatches = a2a.list_dispatches(agent_id=agent["id"])["items"]
        session = a2a.get_session(negotiation["session_id"])

    assert preview["dry_run"] is True
    assert preview["actions"][0]["action"] == "auto_retry"
    assert preview["actions"][0]["dispatch_id"] == dispatch["id"]
    assert applied["dry_run"] is False
    assert applied["applied"][0]["action"] == "auto_retry"
    assert applied["applied"][0]["retry_dispatch_id"]
    original_after = next(item for item in dispatches if item["id"] == dispatch["id"])
    retry = next(item for item in dispatches if item.get("retry_of_dispatch_id") == dispatch["id"])
    assert original_after["status"] == "retrying"
    assert original_after["sla_escalation"]["level"] == "overdue"
    assert retry["retry_count"] == 1
    event_types = [event["type"] for event in session["events"]]
    assert "sla_escalated" in event_types
    assert "retry_requested" in event_types


def test_a2a_agent_registration_issues_credential_and_heartbeat_requires_token(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Trusted Agent", capabilities=["code.implement"]))
        registry_item = a2a.list_registry()["items"][0]

        with pytest.raises(HTTPException) as exc:
            a2a.agent_heartbeat(agent["id"], a2a.AgentHeartbeatIn(credential_token="bad-token", load=2))

        heartbeat = a2a.agent_heartbeat(
            agent["id"],
            a2a.AgentHeartbeatIn(
                credential_token=agent["credential_token"],
                status="active",
                load=2,
                success_rate=0.91,
                capabilities=["code.implement", "test.automation"],
            ),
        )

    assert agent["credential_token"].startswith("a2a_")
    assert agent["credential_id"]
    assert "credential_hash" not in agent
    assert "credential_token" not in registry_item
    assert "credential_hash" not in registry_item
    assert registry_item["credential_status"] == "trusted"
    assert exc.value.status_code == 401
    assert heartbeat["heartbeat_count"] == 1
    assert heartbeat["load"] == 2
    assert heartbeat["success_rate"] == 0.91
    assert heartbeat["capabilities"] == ["code.implement", "test.automation"]
    assert heartbeat["credential_status"] == "trusted"


def test_a2a_agent_credential_rotation_invalidates_old_token_and_trust_report_flags_stale(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Rotating Agent", capabilities=["code.implement"]))
        old_token = agent["credential_token"]
        rotated = a2a.rotate_agent_credential(agent["id"])

        with pytest.raises(HTTPException) as exc:
            a2a.agent_heartbeat(agent["id"], a2a.AgentHeartbeatIn(credential_token=old_token))

        heartbeat = a2a.agent_heartbeat(agent["id"], a2a.AgentHeartbeatIn(credential_token=rotated["credential_token"], load=1))
        raw = a2a._load_item("registry", agent["id"], label="agent")
        raw["last_heartbeat_at"] = "2026-05-21T00:00:00+00:00"
        a2a._save("registry", raw)
        trust = a2a.agent_trust_report(now="2026-05-21T00:45:00+00:00", stale_after_minutes=30)

    assert rotated["credential_token"].startswith("a2a_")
    assert rotated["credential_id"] != agent["credential_id"]
    assert "credential_hash" not in rotated
    assert exc.value.status_code == 401
    assert heartbeat["heartbeat_count"] == 1
    assert trust["summary"]["trusted_agents"] == 1
    assert trust["summary"]["stale_agents"] == 1
    assert trust["items"][0]["heartbeat_status"] == "stale"
    assert trust["items"][0]["heartbeat_lag_minutes"] == 45
    assert "/api/v1/a2a/registry/{id}/heartbeat" in trust["agent_consumption"]["apis"]


def test_a2a_trust_policy_scores_agents_and_is_scoped(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        policy = a2a.update_trust_policy(
            a2a.TrustPolicyIn(
                stale_after_minutes=20,
                min_success_rate=0.9,
                max_load=3,
                require_endpoint=True,
                allowed_agent_types=["workbuddy"],
                allowed_organization_codes=["partner-a"],
                required_capabilities=["code.implement"],
            )
        )
        trusted = a2a.register_agent(
            AgentRegister(
                name="Trusted Org Agent",
                agent_type="workbuddy",
                endpoint="https://partner-a.example/a2a",
                organization_code="partner-a",
                capabilities=["code.implement", "test.automation"],
            )
        )
        blocked = a2a.register_agent(
            AgentRegister(
                name="Blocked Org Agent",
                agent_type="custom",
                organization_code="partner-b",
                capabilities=["code.review"],
            )
        )
        a2a.agent_heartbeat(
            trusted["id"],
            a2a.AgentHeartbeatIn(
                credential_token=trusted["credential_token"],
                load=2,
                success_rate=0.95,
                capabilities=["code.implement", "test.automation"],
            ),
        )
        a2a.agent_heartbeat(
            blocked["id"],
            a2a.AgentHeartbeatIn(
                credential_token=blocked["credential_token"],
                load=6,
                success_rate=0.7,
                capabilities=["code.review"],
            ),
        )

        report = a2a.agent_trust_report(now="2026-05-21T00:20:00+00:00")

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        other_policy = a2a.get_trust_policy()

    by_name = {item["name"]: item for item in report["items"]}
    assert policy["allowed_organization_codes"] == ["partner-a"]
    assert report["policy"]["stale_after_minutes"] == 20
    assert report["summary"]["trusted_agents"] == 2
    assert report["summary"]["policy_allowed_agents"] == 1
    assert report["summary"]["policy_blocked_agents"] == 1
    assert by_name["Trusted Org Agent"]["trust_decision"]["decision"] == "allow"
    assert by_name["Trusted Org Agent"]["eligible_for_dispatch"] is True
    assert by_name["Blocked Org Agent"]["trust_decision"]["decision"] == "deny"
    assert by_name["Blocked Org Agent"]["eligible_for_dispatch"] is False
    assert {"agent_type_not_allowed", "organization_not_allowed", "endpoint_required", "success_rate_below_min", "load_above_max", "missing_required_capability"} <= set(by_name["Blocked Org Agent"]["trust_decision"]["matched_rules"])
    assert other_policy["allowed_organization_codes"] == []


def test_a2a_trust_policy_blocks_pull_and_negotiation_candidates(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        a2a.update_trust_policy(
            a2a.TrustPolicyIn(
                allowed_organization_codes=["partner-a"],
                required_capabilities=["code.implement"],
                enforce_on_pull=True,
                enforce_on_negotiate=True,
            )
        )
        allowed = a2a.register_agent(
            AgentRegister(
                name="Allowed Trust Agent",
                agent_type="workbuddy",
                endpoint="https://partner-a.example/a2a",
                organization_code="partner-a",
                capabilities=["code.implement"],
            )
        )
        blocked = a2a.register_agent(
            AgentRegister(
                name="Blocked Trust Agent",
                agent_type="workbuddy",
                endpoint="https://partner-b.example/a2a",
                organization_code="partner-b",
                capabilities=["code.implement"],
            )
        )
        negotiation = a2a.negotiate(NegotiateIn(task_type="code_implement", required_capabilities=["code.implement"]))
        a2a.dispatch_task(DispatchIn(agent_id=blocked["id"], task_id="T-trust-pull-block"))

        with pytest.raises(HTTPException) as exc:
            a2a.agent_pull_tasks(
                blocked["id"],
                a2a.AgentPullIn(credential_token=blocked["credential_token"], limit=5),
            )

    match_ids = {item["agent_id"] for item in negotiation["matches"]}
    assert allowed["id"] in match_ids
    assert blocked["id"] not in match_ids
    assert exc.value.status_code == 403
    assert "trust policy" in str(exc.value.detail)


def test_a2a_trust_policy_governance_tasks_preview(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        a2a.update_trust_policy(
            a2a.TrustPolicyIn(
                allowed_organization_codes=["partner-a"],
                require_endpoint=True,
                min_success_rate=0.9,
            )
        )
        agent = a2a.register_agent(
            AgentRegister(
                name="Trust Task Agent",
                agent_type="custom",
                organization_code="partner-b",
                capabilities=["code.implement"],
            )
        )
        a2a.agent_heartbeat(
            agent["id"],
            a2a.AgentHeartbeatIn(credential_token=agent["credential_token"], success_rate=0.5),
        )

        tasks = a2a.trust_tasks(a2a.TrustTasksIn(dry_run=True, assigned_to="Agent Platform", dev_tool="codex"))

    assert tasks["dry_run"] is True
    assert tasks["summary"]["policy_blocked_agents"] == 1
    assert tasks["items"][0]["source"] == "a2a_trust_policy_governance"
    assert tasks["items"][0]["priority"] == "P0"
    assert "organization_not_allowed" in tasks["items"][0]["description"]
    assert tasks["created"] == []


def test_a2a_trusted_agent_can_pull_tasks_and_report_progress(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Pull Agent", capabilities=["code.implement"]))
        negotiation = a2a.negotiate(NegotiateIn(task_type="code_implement", required_capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(
            DispatchIn(
                agent_id=agent["id"],
                task_id="T-a2a-pull",
                session_id=negotiation["session_id"],
                payload={"title": "pull this task", "priority": "P1"},
            )
        )

        with pytest.raises(HTTPException) as exc:
            a2a.agent_pull_tasks(agent["id"], a2a.AgentPullIn(credential_token="bad-token"))

        pulled = a2a.agent_pull_tasks(agent["id"], a2a.AgentPullIn(credential_token=agent["credential_token"], limit=5))
        progress = a2a.agent_progress(
            agent["id"],
            a2a.AgentProgressIn(
                credential_token=agent["credential_token"],
                dispatch_id=dispatch["id"],
                status="running",
                progress=60,
                message="implementation halfway",
                artifact={"files": ["src/example.py"]},
            ),
        )
        dispatch_after = next(item for item in a2a.list_dispatches(agent_id=agent["id"])["items"] if item["id"] == dispatch["id"])
        run = next(item for item in agent_runs.list_runs(agent_id=agent["id"], status="", limit=10)["items"] if item["id"] == dispatch["agent_run_id"])
        session = a2a.get_session(negotiation["session_id"])

    assert exc.value.status_code == 401
    assert pulled["total"] == 1
    assert pulled["items"][0]["dispatch_id"] == dispatch["id"]
    assert pulled["items"][0]["status"] == "claimed"
    assert pulled["items"][0]["protocol_packet"]["dispatch_id"] == dispatch["id"]
    assert dispatch_after["status"] == "running"
    assert dispatch_after["claimed_at"]
    assert dispatch_after["progress"]["progress"] == 60
    assert dispatch_after["progress"]["message"] == "implementation halfway"
    assert progress["dispatch_id"] == dispatch["id"]
    assert progress["agent_run_id"] == dispatch["agent_run_id"]
    assert run["status"] == "running"
    assert run["meta"]["a2a_progress"]["progress"] == 60
    event_types = [event["type"] for event in session["events"]]
    assert "task_pulled" in event_types
    assert "progress_reported" in event_types


def test_a2a_agent_pull_assigns_lease_and_ack_moves_dispatch_to_running(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Lease Agent", capabilities=["code.implement"]))
        negotiation = a2a.negotiate(NegotiateIn(task_type="code_implement", required_capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(
            DispatchIn(
                agent_id=agent["id"],
                task_id="T-a2a-lease-ack",
                session_id=negotiation["session_id"],
                payload={"title": "ack this lease", "required_capabilities": ["code.implement"]},
            )
        )

        pulled = a2a.agent_pull_tasks(
            agent["id"],
            a2a.AgentPullIn(credential_token=agent["credential_token"], limit=1, lease_seconds=60),
        )
        task = pulled["items"][0]
        with pytest.raises(HTTPException) as wrong_lease:
            a2a.agent_ack_task(
                agent["id"],
                a2a.AgentAckIn(
                    credential_token=agent["credential_token"],
                    dispatch_id=dispatch["id"],
                    lease_id="wrong-lease",
                ),
            )

        acked = a2a.agent_ack_task(
            agent["id"],
            a2a.AgentAckIn(
                credential_token=agent["credential_token"],
                dispatch_id=dispatch["id"],
                lease_id=task["lease_id"],
                ack="accepted",
            ),
        )
        dispatch_after = next(item for item in a2a.list_dispatches(agent_id=agent["id"])["items"] if item["id"] == dispatch["id"])
        run = next(item for item in agent_runs.list_runs(agent_id=agent["id"], status="", limit=10)["items"] if item["id"] == dispatch["agent_run_id"])
        session = a2a.get_session(negotiation["session_id"])

    assert task["lease_id"]
    assert task["lease_expires_at"]
    assert task["ack_status"] == "pending"
    assert pulled["agent_consumption"]["ack_api"] == "/api/v1/a2a/registry/{id}/tasks/ack"
    assert wrong_lease.value.status_code == 409
    assert acked["ack_status"] == "accepted"
    assert acked["status"] == "running"
    assert dispatch_after["status"] == "running"
    assert dispatch_after["ack_status"] == "accepted"
    assert dispatch_after["acked_at"]
    assert run["status"] == "running"
    assert run["meta"]["a2a_ack"]["lease_id"] == task["lease_id"]
    assert "task_acknowledged" in [event["type"] for event in session["events"]]


def test_a2a_expired_pending_lease_is_requeued_and_pulled_with_new_lease(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Lease Requeue Agent", capabilities=["code.implement"]))
        negotiation = a2a.negotiate(NegotiateIn(task_type="code_implement", required_capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(
            DispatchIn(
                agent_id=agent["id"],
                task_id="T-a2a-lease-expire",
                session_id=negotiation["session_id"],
            )
        )
        first_pull = a2a.agent_pull_tasks(
            agent["id"],
            a2a.AgentPullIn(credential_token=agent["credential_token"], limit=1, lease_seconds=30),
        )
        first_lease_id = first_pull["items"][0]["lease_id"]
        raw_dispatch = a2a._load_item("dispatches", dispatch["id"], label="dispatch")
        raw_dispatch["lease_expires_at"] = "2026-05-21T00:30:00+00:00"
        a2a._save("dispatches", raw_dispatch)

        expired = a2a.expire_leases(now="2026-05-21T00:45:00+00:00")
        second_pull = a2a.agent_pull_tasks(
            agent["id"],
            a2a.AgentPullIn(credential_token=agent["credential_token"], limit=1, lease_seconds=45),
        )
        dispatch_after = next(item for item in a2a.list_dispatches(agent_id=agent["id"])["items"] if item["id"] == dispatch["id"])
        session = a2a.get_session(negotiation["session_id"])

    assert expired["expired"] == 1
    assert expired["items"][0]["dispatch_id"] == dispatch["id"]
    assert expired["items"][0]["previous_lease_id"] == first_lease_id
    assert expired["agent_consumption"]["pull_api"] == "/api/v1/a2a/registry/{id}/tasks/pull"
    assert second_pull["items"][0]["lease_id"] != first_lease_id
    assert second_pull["items"][0]["ack_status"] == "pending"
    assert dispatch_after["status"] == "claimed"
    assert dispatch_after["lease_history"][0]["lease_id"] == first_lease_id
    assert "lease_expired" in [event["type"] for event in session["events"]]


def test_a2a_agent_pull_exposes_long_poll_wait_metadata_when_no_task(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Long Poll Agent", capabilities=["code.implement"]))

        pulled = a2a.agent_pull_tasks(
            agent["id"],
            a2a.AgentPullIn(credential_token=agent["credential_token"], wait_seconds=1),
        )

    assert pulled["total"] == 0
    assert pulled["long_poll"] is True
    assert pulled["wait_seconds"] == 1
    assert pulled["waited_seconds"] >= 1


def test_a2a_agent_can_renew_active_lease_and_session_records_event(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Renew Agent", capabilities=["code.implement"]))
        negotiation = a2a.negotiate(NegotiateIn(task_type="code_implement", required_capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(
            DispatchIn(agent_id=agent["id"], task_id="T-a2a-renew", session_id=negotiation["session_id"])
        )
        pulled = a2a.agent_pull_tasks(
            agent["id"],
            a2a.AgentPullIn(credential_token=agent["credential_token"], limit=1, lease_seconds=60),
        )
        task = pulled["items"][0]

        renewed = a2a.agent_renew_lease(
            agent["id"],
            a2a.AgentLeaseRenewIn(
                credential_token=agent["credential_token"],
                dispatch_id=dispatch["id"],
                lease_id=task["lease_id"],
                extend_seconds=120,
            ),
        )
        dispatch_after = next(item for item in a2a.list_dispatches(agent_id=agent["id"])["items"] if item["id"] == dispatch["id"])
        run = next(item for item in agent_runs.list_runs(agent_id=agent["id"], status="", limit=10)["items"] if item["id"] == dispatch["agent_run_id"])
        session = a2a.get_session(negotiation["session_id"])

    assert renewed["lease_id"] == task["lease_id"]
    assert renewed["renew_count"] == 1
    assert renewed["lease_expires_at"] > task["lease_expires_at"]
    assert dispatch_after["renew_count"] == 1
    assert dispatch_after["lease_expires_at"] == renewed["lease_expires_at"]
    assert run["meta"]["a2a_lease"]["renew_count"] == 1
    assert "lease_renewed" in [event["type"] for event in session["events"]]


def test_a2a_rejected_task_can_be_reassigned_to_another_agent(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        first_agent = a2a.register_agent(AgentRegister(name="Rejecting Agent", capabilities=["code.review"]))
        second_agent = a2a.register_agent(AgentRegister(name="Backup Agent", capabilities=["code.review"]))
        negotiation = a2a.negotiate(NegotiateIn(task_type="code_review", required_capabilities=["code.review"]))
        dispatch = a2a.dispatch_task(
            DispatchIn(
                agent_id=first_agent["id"],
                task_id="T-a2a-reassign",
                session_id=negotiation["session_id"],
                payload={"title": "reassign me", "required_capabilities": ["code.review"]},
            )
        )
        pulled = a2a.agent_pull_tasks(
            first_agent["id"],
            a2a.AgentPullIn(credential_token=first_agent["credential_token"], limit=1, lease_seconds=60),
        )
        rejected = a2a.agent_ack_task(
            first_agent["id"],
            a2a.AgentAckIn(
                credential_token=first_agent["credential_token"],
                dispatch_id=dispatch["id"],
                lease_id=pulled["items"][0]["lease_id"],
                ack="rejected",
                message="capacity exhausted",
            ),
        )

        reassigned = a2a.reassign_dispatch(
            dispatch["id"],
            a2a.DispatchReassignIn(agent_id=second_agent["id"], reason="fallback to backup agent"),
        )
        backup_pull = a2a.agent_pull_tasks(
            second_agent["id"],
            a2a.AgentPullIn(credential_token=second_agent["credential_token"], limit=1, lease_seconds=90),
        )
        dispatches = a2a.list_dispatches()["items"]
        original_after = next(item for item in dispatches if item["id"] == dispatch["id"])
        new_dispatch = next(item for item in dispatches if item["id"] == reassigned["id"])
        old_run = next(item for item in agent_runs.list_runs(agent_id=first_agent["id"], status="", limit=10)["items"] if item["id"] == dispatch["agent_run_id"])
        new_run = next(item for item in agent_runs.list_runs(agent_id=second_agent["id"], status="", limit=10)["items"] if item["id"] == reassigned["agent_run_id"])
        session = a2a.get_session(negotiation["session_id"])

    assert rejected["ack_status"] == "rejected"
    assert rejected["status"] == "blocked"
    assert reassigned["agent_id"] == second_agent["id"]
    assert reassigned["reassign_of_dispatch_id"] == dispatch["id"]
    assert reassigned["previous_agent_id"] == first_agent["id"]
    assert reassigned["payload"]["title"] == "reassign me"
    assert original_after["status"] == "reassigned"
    assert original_after["reassign_dispatch_id"] == reassigned["id"]
    assert new_dispatch["status"] == "claimed"
    assert backup_pull["items"][0]["dispatch_id"] == reassigned["id"]
    assert backup_pull["items"][0]["lease_id"]
    assert old_run["status"] == "failed"
    assert new_run["status"] == "running"
    event_types = [event["type"] for event in session["events"]]
    assert "task_acknowledged" in event_types
    assert "task_reassigned" in event_types


def test_a2a_execution_window_audit_flags_expired_stale_and_blocked_dispatches(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Window Agent", capabilities=["code.implement"]))
        backup = a2a.register_agent(AgentRegister(name="Window Backup", capabilities=["code.implement"]))
        negotiation = a2a.negotiate(NegotiateIn(task_type="code_implement", required_capabilities=["code.implement"]))
        expired_dispatch = a2a.dispatch_task(
            DispatchIn(agent_id=agent["id"], task_id="T-window-expired", session_id=negotiation["session_id"])
        )
        stale_dispatch = a2a.dispatch_task(
            DispatchIn(agent_id=agent["id"], task_id="T-window-stale", session_id=negotiation["session_id"])
        )
        blocked_dispatch = a2a.dispatch_task(
            DispatchIn(agent_id=agent["id"], task_id="T-window-blocked", session_id=negotiation["session_id"])
        )
        a2a.agent_pull_tasks(
            agent["id"],
            a2a.AgentPullIn(credential_token=agent["credential_token"], limit=1, lease_seconds=60),
        )
        a2a.agent_pull_tasks(
            agent["id"],
            a2a.AgentPullIn(credential_token=agent["credential_token"], limit=5, lease_seconds=600),
        )
        stale_raw = a2a._load_item("dispatches", stale_dispatch["id"], label="dispatch")
        a2a.agent_ack_task(
            agent["id"],
            a2a.AgentAckIn(
                credential_token=agent["credential_token"],
                dispatch_id=stale_dispatch["id"],
                lease_id=stale_raw["lease_id"],
                ack="accepted",
            ),
        )
        a2a.agent_progress(
            agent["id"],
            a2a.AgentProgressIn(
                credential_token=agent["credential_token"],
                dispatch_id=stale_dispatch["id"],
                status="running",
                progress=25,
                message="started",
            ),
        )
        blocked_raw = a2a._load_item("dispatches", blocked_dispatch["id"], label="dispatch")
        a2a.agent_ack_task(
            agent["id"],
            a2a.AgentAckIn(
                credential_token=agent["credential_token"],
                dispatch_id=blocked_dispatch["id"],
                lease_id=blocked_raw["lease_id"],
                ack="rejected",
                message="cannot execute",
            ),
        )

        expired_raw = a2a._load_item("dispatches", expired_dispatch["id"], label="dispatch")
        expired_raw["lease_expires_at"] = "2026-05-21T00:05:00+00:00"
        expired_raw["ack_status"] = "pending"
        expired_raw["status"] = "claimed"
        a2a._save("dispatches", expired_raw)
        stale_raw = a2a._load_item("dispatches", stale_dispatch["id"], label="dispatch")
        stale_raw["last_progress_at"] = "2026-05-21T00:00:00+00:00"
        stale_raw["lease_expires_at"] = "2026-05-21T01:00:00+00:00"
        a2a._save("dispatches", stale_raw)

        report = a2a.execution_windows(now="2026-05-21T00:20:00+00:00")
        tasks = a2a.execution_window_tasks(
            a2a.ExecutionWindowTasksIn(dry_run=True, assigned_to="Agent Platform", dev_tool="codex"),
            now="2026-05-21T00:20:00+00:00",
        )

    assert report["summary"]["total"] == 3
    assert report["summary"]["expired_leases"] == 1
    assert report["summary"]["stale_progress"] == 1
    assert report["summary"]["blocked"] == 1
    assert report["summary"]["health_score"] < 100
    by_task = {item["task_id"]: item for item in report["items"]}
    assert by_task["T-window-expired"]["window_status"] == "lease_expired"
    assert by_task["T-window-expired"]["recommended_action"] == "expire_or_reassign"
    assert by_task["T-window-stale"]["window_status"] == "progress_stale"
    assert by_task["T-window-blocked"]["recommended_action"] == "reassign"
    assert backup["id"] in by_task["T-window-blocked"]["candidate_agent_ids"]
    assert "/api/v1/a2a/execution-windows/tasks" in report["agent_consumption"]["apis"]
    assert tasks["dry_run"] is True
    assert tasks["items"][0]["source"] == "a2a_execution_window_governance"
    assert tasks["items"][0]["priority"] == "P0"


def test_a2a_execution_window_actions_preview_and_apply_governance(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        agent = a2a.register_agent(AgentRegister(name="Window Action Agent", capabilities=["code.implement"]))
        backup = a2a.register_agent(AgentRegister(name="Window Action Backup", capabilities=["code.implement"]))
        negotiation = a2a.negotiate(NegotiateIn(task_type="code_implement", required_capabilities=["code.implement"]))
        renew_dispatch = a2a.dispatch_task(
            DispatchIn(agent_id=agent["id"], task_id="T-window-action-renew", session_id=negotiation["session_id"])
        )
        blocked_dispatch = a2a.dispatch_task(
            DispatchIn(
                agent_id=agent["id"],
                task_id="T-window-action-reassign",
                session_id=negotiation["session_id"],
                payload={"required_capabilities": ["code.implement"]},
            )
        )
        a2a.agent_pull_tasks(
            agent["id"],
            a2a.AgentPullIn(credential_token=agent["credential_token"], limit=5, lease_seconds=600),
        )
        renew_raw = a2a._load_item("dispatches", renew_dispatch["id"], label="dispatch")
        a2a.agent_ack_task(
            agent["id"],
            a2a.AgentAckIn(
                credential_token=agent["credential_token"],
                dispatch_id=renew_dispatch["id"],
                lease_id=renew_raw["lease_id"],
                ack="accepted",
            ),
        )
        blocked_raw = a2a._load_item("dispatches", blocked_dispatch["id"], label="dispatch")
        a2a.agent_ack_task(
            agent["id"],
            a2a.AgentAckIn(
                credential_token=agent["credential_token"],
                dispatch_id=blocked_dispatch["id"],
                lease_id=blocked_raw["lease_id"],
                ack="rejected",
                message="no capacity",
            ),
        )
        renew_raw = a2a._load_item("dispatches", renew_dispatch["id"], label="dispatch")
        renew_raw["lease_expires_at"] = "2026-05-21T00:23:00+00:00"
        a2a._save("dispatches", renew_raw)

        preview = a2a.execution_window_actions(
            a2a.ExecutionWindowActionsIn(dry_run=True, renew_seconds=300),
            now="2026-05-21T00:20:00+00:00",
        )
        applied = a2a.execution_window_actions(
            a2a.ExecutionWindowActionsIn(dry_run=False, renew_seconds=300),
            now="2026-05-21T00:20:00+00:00",
        )
        dispatches = a2a.list_dispatches()["items"]
        renew_after = next(item for item in dispatches if item["id"] == renew_dispatch["id"])
        original_after = next(item for item in dispatches if item["id"] == blocked_dispatch["id"])
        new_dispatch = next(item for item in dispatches if item.get("reassign_of_dispatch_id") == blocked_dispatch["id"])
        run = next(item for item in agent_runs.list_runs(agent_id=agent["id"], status="", limit=10)["items"] if item["id"] == renew_dispatch["agent_run_id"])
        session = a2a.get_session(negotiation["session_id"])

    by_action = {item["action"]: item for item in preview["actions"]}
    assert preview["dry_run"] is True
    assert by_action["renew_lease"]["dispatch_id"] == renew_dispatch["id"]
    assert by_action["reassign"]["dispatch_id"] == blocked_dispatch["id"]
    assert by_action["reassign"]["target_agent_id"] == backup["id"]
    assert applied["dry_run"] is False
    assert {item["action"] for item in applied["applied"]} == {"renew_lease", "reassign"}
    assert renew_after["lease_expires_at"] > "2026-05-21T00:23:00+00:00"
    assert renew_after["renew_count"] == 1
    assert run["meta"]["a2a_lease"]["renew_count"] == 1
    assert original_after["status"] == "reassigned"
    assert original_after["reassign_dispatch_id"] == new_dispatch["id"]
    assert new_dispatch["agent_id"] == backup["id"]
    assert new_dispatch["status"] == "dispatched"
    event_types = [event["type"] for event in session["events"]]
    assert "lease_renewed" in event_types
    assert "task_reassigned" in event_types
    assert "/api/v1/a2a/execution-windows/actions" in applied["agent_consumption"]["apis"]


def test_a2a_execution_window_policy_tunes_thresholds_and_is_scoped(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        policy = a2a.update_execution_window_policy(
            a2a.ExecutionWindowPolicyIn(
                stale_after_minutes=5,
                due_soon_seconds=900,
                max_auto_reassign=1,
                action_mode="guarded",
            )
        )
        agent = a2a.register_agent(AgentRegister(name="Policy Window Agent", capabilities=["code.implement"]))
        stale_dispatch = a2a.dispatch_task(DispatchIn(agent_id=agent["id"], task_id="T-window-policy-stale"))
        due_dispatch = a2a.dispatch_task(DispatchIn(agent_id=agent["id"], task_id="T-window-policy-due"))
        a2a.agent_pull_tasks(
            agent["id"],
            a2a.AgentPullIn(credential_token=agent["credential_token"], limit=5, lease_seconds=3600),
        )
        stale_raw = a2a._load_item("dispatches", stale_dispatch["id"], label="dispatch")
        a2a.agent_ack_task(
            agent["id"],
            a2a.AgentAckIn(
                credential_token=agent["credential_token"],
                dispatch_id=stale_dispatch["id"],
                lease_id=stale_raw["lease_id"],
                ack="accepted",
            ),
        )
        a2a.agent_progress(
            agent["id"],
            a2a.AgentProgressIn(
                credential_token=agent["credential_token"],
                dispatch_id=stale_dispatch["id"],
                status="running",
                progress=40,
            ),
        )
        stale_raw = a2a._load_item("dispatches", stale_dispatch["id"], label="dispatch")
        stale_raw["last_progress_at"] = "2026-05-21T00:00:00+00:00"
        stale_raw["lease_expires_at"] = "2026-05-21T01:00:00+00:00"
        a2a._save("dispatches", stale_raw)
        due_raw = a2a._load_item("dispatches", due_dispatch["id"], label="dispatch")
        due_raw["lease_expires_at"] = "2026-05-21T00:34:00+00:00"
        a2a._save("dispatches", due_raw)

        report = a2a.execution_windows(now="2026-05-21T00:20:00+00:00")

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        other_policy = a2a.get_execution_window_policy()

    by_task = {item["task_id"]: item for item in report["items"]}
    assert policy["stale_after_minutes"] == 5
    assert policy["due_soon_seconds"] == 900
    assert report["policy"]["stale_after_minutes"] == 5
    assert report["policy"]["due_soon_seconds"] == 900
    assert report["summary"]["stale_after_minutes"] == 5
    assert report["summary"]["due_soon_seconds"] == 900
    assert by_task["T-window-policy-stale"]["window_status"] == "progress_stale"
    assert by_task["T-window-policy-due"]["window_status"] == "lease_due_soon"
    assert other_policy["stale_after_minutes"] == 15
    assert other_policy["due_soon_seconds"] == 300


def test_a2a_execution_window_actions_explain_policy_blocks(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        a2a.update_execution_window_policy(
            a2a.ExecutionWindowPolicyIn(
                action_mode="preview",
                auto_reassign_enabled=True,
                max_auto_reassign=1,
                require_preview_for_high_risk=True,
            )
        )
        agent = a2a.register_agent(AgentRegister(name="Policy Block Agent", capabilities=["code.implement"]))
        backup = a2a.register_agent(AgentRegister(name="Policy Block Backup", capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(
            DispatchIn(
                agent_id=agent["id"],
                task_id="T-window-policy-block",
                payload={"required_capabilities": ["code.implement"]},
            )
        )
        a2a.agent_pull_tasks(
            agent["id"],
            a2a.AgentPullIn(credential_token=agent["credential_token"], limit=5, lease_seconds=600),
        )
        raw = a2a._load_item("dispatches", dispatch["id"], label="dispatch")
        a2a.agent_ack_task(
            agent["id"],
            a2a.AgentAckIn(
                credential_token=agent["credential_token"],
                dispatch_id=dispatch["id"],
                lease_id=raw["lease_id"],
                ack="rejected",
                message="preview first",
            ),
        )

        result = a2a.execution_window_actions(
            a2a.ExecutionWindowActionsIn(dry_run=False, renew_seconds=300),
            now="2026-05-21T00:20:00+00:00",
        )
        original_after = a2a._load_item("dispatches", dispatch["id"], label="dispatch")

    assert result["policy"]["action_mode"] == "preview"
    assert result["applied"] == []
    assert result["blocked"]
    action = result["blocked"][0]
    assert action["action"] == "reassign"
    assert action["target_agent_id"] == backup["id"]
    assert action["allowed"] is False
    assert action["policy_decision"]["decision"] == "preview_required"
    assert "预览" in action["block_reason"]
    assert original_after["status"] == "blocked"


def test_a2a_execution_window_actions_respect_max_auto_reassign(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        a2a.update_execution_window_policy(
            a2a.ExecutionWindowPolicyIn(
                action_mode="automatic",
                auto_reassign_enabled=True,
                max_auto_reassign=1,
                require_preview_for_high_risk=False,
            )
        )
        agent = a2a.register_agent(AgentRegister(name="Policy Limit Agent", capabilities=["code.implement"]))
        a2a.register_agent(AgentRegister(name="Policy Limit Backup", capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(
            DispatchIn(
                agent_id=agent["id"],
                task_id="T-window-policy-limit",
                payload={"required_capabilities": ["code.implement"]},
            )
        )
        a2a.agent_pull_tasks(
            agent["id"],
            a2a.AgentPullIn(credential_token=agent["credential_token"], limit=5, lease_seconds=600),
        )
        raw = a2a._load_item("dispatches", dispatch["id"], label="dispatch")
        a2a.agent_ack_task(
            agent["id"],
            a2a.AgentAckIn(
                credential_token=agent["credential_token"],
                dispatch_id=dispatch["id"],
                lease_id=raw["lease_id"],
                ack="rejected",
            ),
        )
        raw = a2a._load_item("dispatches", dispatch["id"], label="dispatch")
        raw["auto_reassign_count"] = 1
        a2a._save("dispatches", raw)

        result = a2a.execution_window_actions(
            a2a.ExecutionWindowActionsIn(dry_run=False, renew_seconds=300),
            now="2026-05-21T00:20:00+00:00",
        )

    assert result["applied"] == []
    assert result["blocked"][0]["policy_decision"]["decision"] == "max_reassign_reached"
    assert "重派上限" in result["blocked"][0]["block_reason"]


def test_a2a_agent_pull_rejects_cross_project_and_other_agent_dispatch(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        owner = a2a.register_agent(AgentRegister(name="Owner Agent", capabilities=["code.implement"]))
        other = a2a.register_agent(AgentRegister(name="Other Agent", capabilities=["code.implement"]))
        dispatch = a2a.dispatch_task(DispatchIn(agent_id=owner["id"], task_id="T-a2a-pull-scope"))

        with pytest.raises(HTTPException) as exc:
            a2a.agent_progress(
                other["id"],
                a2a.AgentProgressIn(credential_token=other["credential_token"], dispatch_id=dispatch["id"], status="running"),
            )

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        with pytest.raises(HTTPException) as cross_exc:
            a2a.agent_pull_tasks(owner["id"], a2a.AgentPullIn(credential_token=owner["credential_token"]))

    assert exc.value.status_code == 404
    assert cross_exc.value.status_code == 404
