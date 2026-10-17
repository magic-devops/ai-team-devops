"""Workflow suggestions never substitute for authorized human review."""

import asyncio
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import workflow


@pytest.fixture
def scoped_engine(tmp_path, monkeypatch, isolated_project_sql):
    tokens = set_request_scope("tenant", "project", tmp_path)
    monkeypatch.setattr(workflow, "resolved_ai_memory_root", lambda: tmp_path)
    engine = workflow._InMemoryEngine()
    monkeypatch.setattr(workflow, "_engine", engine)
    yield engine
    reset_request_scope(tokens)


def test_review_timeout_never_approves_or_completes(scoped_engine):
    async def scenario():
        handle = await scoped_engine.start("code_review", "review-timeout", {"timeout_seconds": 0.01})
        await asyncio.sleep(0.1)
        assert handle.status == "timeout_pending"
        assert handle.result["human_decision"] is None
        assert handle.result["review"]["status"] == "missing_diff"
        assert (await scoped_engine.query(handle.workflow_id, "progress"))["phase"] == "timeout_pending"
    asyncio.run(scenario())


def test_registered_review_signal_changes_live_state_and_is_idempotent(scoped_engine):
    async def scenario():
        handle = await scoped_engine.start("code_review", "review-human", {"timeout_seconds": 1})
        await asyncio.sleep(0.01)
        payload = {"comment": "Reviewed the actual changes and checks", "actor_id": "reviewer", "signal_id": "decision-1"}
        await scoped_engine.signal(handle.workflow_id, "approve", payload)
        assert handle.status == "completed"
        assert handle.result["human_decision"] == "approve"
        assert handle.result["decision_record"]["actor_id"] == "reviewer"
        await scoped_engine.signal(handle.workflow_id, "approve", payload)
        assert len(await scoped_engine.query(handle.workflow_id, "signals")) == 1
        with pytest.raises(HTTPException) as error:
            await scoped_engine.signal(handle.workflow_id, "reject", {**payload, "signal_id": "decision-2"})
        assert error.value.status_code == 409
        await asyncio.sleep(0.03)
        assert handle.status == "completed" and handle.result["human_decision"] == "approve"
    asyncio.run(scenario())


def test_review_requires_opinion_and_registered_signal(scoped_engine):
    async def scenario():
        handle = await scoped_engine.start("code_review", "review-validation", {"timeout_seconds": 0})
        await asyncio.sleep(0.01)
        for signal, payload in [("approve", {}), ("merge", {"comment": "No"})]:
            with pytest.raises(HTTPException) as error:
                await scoped_engine.signal(handle.workflow_id, signal, payload)
            assert error.value.status_code in {400, 422}
        assert handle.result["human_decision"] is None
    asyncio.run(scenario())


def test_sprint_timeout_and_reported_tasks_do_not_automatically_accept(scoped_engine):
    async def scenario():
        handle = await scoped_engine.start("sprint_lifecycle", "sprint-human", {"tasks": ["T-1"], "duration_seconds": 0.01})
        await asyncio.sleep(0.1)
        assert handle.status == "timeout_pending"
        assert handle.result["completed"] == []
        await scoped_engine.signal(handle.workflow_id, "complete_task", {"task_id": "T-1", "comment": "checked", "actor_id": "reviewer"})
        assert handle.status == "timeout_pending"
        assert handle.result["pending_phase"] == "reviewing"
        await scoped_engine.signal(handle.workflow_id, "complete_review", {"comment": "Sprint accepted", "actor_id": "reviewer"})
        assert handle.status == "completed"
    asyncio.run(scenario())


def test_model_review_runs_off_event_loop_and_preserves_project_context(scoped_engine, monkeypatch):
    from sop_manager.path_config import resolved_project_id
    from sop_manager.routers import llm_gateway

    observed = []
    def fake_chat(*args, **kwargs):
        observed.append(resolved_project_id())
        time.sleep(0.08)
        return SimpleNamespace(content="Review suggestion", model="configured-review", provider="local-test", usage=SimpleNamespace(model_dump=lambda: {"total_tokens": 3}))
    monkeypatch.setattr(llm_gateway, "llm_chat", fake_chat)

    async def scenario():
        handle = await scoped_engine.start("code_review", "review-async", {"diff": "+ change", "timeout_seconds": 1})
        await asyncio.sleep(0.01)
        assert handle.result["phase"] == "ai_reviewing"
        await asyncio.sleep(0.1)
        assert handle.status == "awaiting_human"
        assert handle.result["review"]["provider"] == "local-test"
        assert observed == ["project"]
    asyncio.run(scenario())


def test_journal_recovers_waiting_review_and_scopes_same_id(scoped_engine, tmp_path):
    async def scenario():
        await scoped_engine.start("code_review", "shared-id", {"timeout_seconds": 0})
        await asyncio.sleep(0.02)
        restarted = workflow._InMemoryEngine()
        restored = await restarted.describe("shared-id")
        assert restored.status == "timeout_pending"
        await restarted.signal("shared-id", "request_changes", {"comment": "Add regression coverage", "actor_id": "reviewer"})
        assert restored.result["human_decision"] is None
        assert (await restarted.describe("shared-id")).result["human_decision"] == "request_changes"
        tokens = set_request_scope("foreign", "other", tmp_path)
        try:
            with pytest.raises(HTTPException) as error:
                await restarted.describe("shared-id")
            assert error.value.status_code == 404
            other = await restarted.start("code_review", "shared-id", {"timeout_seconds": 0})
            await asyncio.sleep(0.02)
            assert other.run_id != restored.run_id
        finally:
            reset_request_scope(tokens)
        assert (await restarted.describe("shared-id")).result["human_decision"] == "request_changes"
    asyncio.run(scenario())


def test_paused_sprint_resumes_deadline_and_cannot_close_paused_review(scoped_engine):
    async def scenario():
        handle = await scoped_engine.start("sprint_lifecycle", "sprint-restart", {"tasks": [], "duration_seconds": 0.02})
        await asyncio.sleep(0.01)
        await scoped_engine.signal(handle.workflow_id, "pause", {"comment": "Awaiting evidence", "actor_id": "writer"})
        with pytest.raises(HTTPException) as error:
            await scoped_engine.signal(handle.workflow_id, "complete_review", {"comment": "Cannot close paused", "actor_id": "reviewer"})
        assert error.value.status_code == 409
        await asyncio.sleep(0.03)
        await scoped_engine.signal(handle.workflow_id, "resume", {"comment": "Continue", "actor_id": "writer"})
        await asyncio.sleep(0.01)
        assert handle.status == "timeout_pending"
    asyncio.run(scenario())


def test_model_failure_is_explicit_and_does_not_auto_accept(scoped_engine, monkeypatch):
    from sop_manager.routers import llm_gateway
    def failing_model(*args):
        raise RuntimeError("https://example.test?api_key=secret-value")
    monkeypatch.setattr(llm_gateway, "llm_chat", failing_model)
    async def scenario():
        handle = await scoped_engine.start("code_review", "review-failed-model", {"diff": "actual diff", "timeout_seconds": 0})
        await asyncio.wait_for(scoped_engine._loop_task[scoped_engine._key(handle.workflow_id)], timeout=2)
        assert handle.status == "timeout_pending"
        assert handle.result["review"]["source"] == "llm_gateway"
        assert handle.result["review"]["status"] == "failed"
        assert handle.result["human_decision"] is None
        assert "secret-value" not in str(handle.result)
    asyncio.run(scenario())


def test_signal_replay_conflict_and_cancel_never_overwrite_decision(scoped_engine):
    async def scenario():
        handle = await scoped_engine.start("code_review", "review-closed", {"timeout_seconds": 0})
        await asyncio.sleep(0.01)
        payload = {"actor_id": "reviewer", "comment": "Approved", "signal_id": "fixed-id"}
        await scoped_engine.signal(handle.workflow_id, "approve", payload)
        for operation in [
            scoped_engine.signal(handle.workflow_id, "approve", {**payload, "comment": "Different"}),
            scoped_engine.cancel(handle.workflow_id),
            scoped_engine.start("code_review", handle.workflow_id, {"timeout_seconds": 1}),
        ]:
            with pytest.raises(HTTPException) as error:
                await operation
            assert error.value.status_code == 409
        assert handle.status == "completed"
        assert handle.result["decision_record"]["comment"] == "Approved"
    asyncio.run(scenario())


def test_review_cancel_during_model_call_cannot_finish_later(scoped_engine, monkeypatch):
    from sop_manager.routers import llm_gateway
    def slow_model(*args):
        time.sleep(0.04)
        return SimpleNamespace(content="Late suggestion", model="test", provider="test", usage=SimpleNamespace(model_dump=lambda: {}))
    monkeypatch.setattr(llm_gateway, "llm_chat", slow_model)
    async def scenario():
        handle = await scoped_engine.start("code_review", "review-cancel-model", {"diff": "actual diff", "timeout_seconds": 0})
        await asyncio.sleep(0.005)
        await scoped_engine.cancel(handle.workflow_id)
        await asyncio.sleep(0.06)
        assert handle.status == "cancelled"
        restored = await workflow._InMemoryEngine().describe(handle.workflow_id)
        assert restored.status == "cancelled" and restored.result["human_decision"] is None
    asyncio.run(scenario())


def test_journal_retains_waiting_runs_beyond_list_page_size(scoped_engine):
    for index in range(502):
        workflow._upsert_run({"workflow_id": f"pending-{index}", "run_id": str(index), "type": "code_review", "status": "timeout_pending", "result": {"phase": "timeout_pending", "human_decision": None}})
    async def scenario():
        restored = await workflow._InMemoryEngine().describe("pending-0")
        assert restored.status == "timeout_pending"
    asyncio.run(scenario())


def test_empty_model_response_is_not_a_successful_review(scoped_engine, monkeypatch):
    from sop_manager.routers import llm_gateway
    monkeypatch.setattr(llm_gateway, "llm_chat", lambda *args: SimpleNamespace(content="  ", model="test", provider="test", usage=SimpleNamespace(model_dump=lambda: {})))
    async def scenario():
        handle = await scoped_engine.start("code_review", "review-empty-model", {"diff": "+ actual change", "timeout_seconds": 0})
        await asyncio.wait_for(scoped_engine._loop_task[scoped_engine._key(handle.workflow_id)], timeout=2)
        assert handle.result["review"]["status"] == "failed"
        assert handle.result["human_decision"] is None
    asyncio.run(scenario())


def test_bug_classification_is_only_a_suggestion_until_explicit_resolution(scoped_engine, monkeypatch):
    from sop_manager.routers import llm_gateway
    monkeypatch.setattr(llm_gateway, "llm_chat", lambda *args: SimpleNamespace(content='{"priority":"P1","category":"bug"}', model="triage-test", provider="local-test", usage=SimpleNamespace(model_dump=lambda: {})))
    async def scenario():
        handle = await scoped_engine.start("bug_triage", "triage-human", {"text": "Error in deployment", "timeout_seconds": 0})
        await asyncio.wait_for(scoped_engine._loop_task[scoped_engine._key(handle.workflow_id)], timeout=2)
        assert handle.status == "timeout_pending"
        assert handle.result["severity"] == "P1"
        assert handle.result["human_decision"] is None
        await scoped_engine.signal(handle.workflow_id, "resolve", {"actor_id": "reviewer", "comment": "Fixed and verified"})
        assert handle.result["human_decision"] == "resolve"
    asyncio.run(scenario())


def test_unimplemented_temporal_worker_cannot_dispatch_unscoped_commands():
    engine = object.__new__(workflow.TemporalEngine)
    async def forbidden_client():
        raise AssertionError("Unimplemented worker contracts must not dispatch unscoped commands")
    engine._client = forbidden_client
    async def scenario():
        operations = [lambda: engine.start("code_review", "review-1", {}), lambda: engine.signal("review-1", "approve", {}),
                      lambda: engine.cancel("review-1"), lambda: engine.query("review-1", "progress"), lambda: engine.describe("review-1")]
        for operation in operations:
            with pytest.raises(HTTPException) as error:
                await operation()
            assert error.value.status_code == 503
    asyncio.run(scenario())


def test_timeout_dag_does_not_invent_completed_sprint_or_model_steps():
    sprint = workflow._build_workflow_dag("sprint_lifecycle", "timeout_pending", {"phase": "timeout_pending", "pending_phase": "in_progress"})
    assert sprint["current_step_id"] == "in_progress"
    assert sprint["steps"][1]["status"] == "awaiting_human"
    assert sprint["steps"][2]["status"] == "pending"
    review = workflow._build_workflow_dag("code_review", "timeout_pending", {"phase": "timeout_pending", "pending_phase": "awaiting_human", "review": {"status": "failed"}})
    assert review["steps"][0]["status"] == "failed"
    missing = workflow._build_workflow_dag("code_review", "awaiting_human", {"phase": "awaiting_human", "review": {"status": "missing_diff"}})
    assert missing["steps"][0]["status"] == "skipped"
