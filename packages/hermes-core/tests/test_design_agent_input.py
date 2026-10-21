"""Real prompt/transport consumers; execution deferred to the shared test window."""
import hashlib
import json

import pytest

from hermes_core.agent_input import compose_agent_prompt, task_context, validate_prompt
from hermes_core.agents import AgentProfile, single_agent_nodes
from hermes_core.models import CoreError, Node


def design_task(content="设计正文\n完整保留"):
    ref = {"slot": "architecture", "adoption_id": "adopt", "document_id": "doc",
           "revision_id": "rev", "revision_number": 2, "revision_digest": "b" * 64,
           "content_sha256": hashlib.sha256(content.encode()).hexdigest(), "content_bytes": len(content.encode()),
           "title": "Architecture", "category": "architecture", "origin_kind": "task", "origin_id": "task"}
    refs = [ref]
    basis = hashlib.sha256(json.dumps(refs, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    context = {key: ref[key] for key in ("slot", "document_id", "revision_id", "revision_digest", "content_sha256")}
    context["content"] = content
    return {"title": "Task", "description": "Requirement\nTask", "acceptance_criteria": "Real test evidence",
            "source": {"kind": "manager.delivery", "execution_id": "E", "snapshot": {"designs": refs, "design_basis": basis}},
            "design_context": [context]}


def test_single_agent_nodes_consumes_the_same_full_frozen_design_original():
    task = design_task("d" * 65536)
    agent = {"id": "agent", "data": AgentProfile(title="Coder", provider="codex").model_dump()}
    node = single_agent_nodes(agent, task, [Node(id="test", argv=["check"])])[0]
    assert len(node.prompt) > 32000
    actual = json.loads(node.prompt.split("Task context:\n", 1)[1])
    assert actual["design_context"] == task["design_context"]
    assert actual["designs"] == task["source"]["snapshot"]["designs"]
    assert actual["design_basis"] == task["source"]["snapshot"]["design_basis"]
    assert "untrusted" in node.prompt


@pytest.mark.parametrize("change", ["body", "id", "basis", "size", "duplicate", "missing"])
def test_real_prompt_builder_rejects_changed_or_missing_design_original(change):
    task = design_task()
    if change == "body":
        task["design_context"][0]["content"] += " altered"
    elif change == "id":
        task["design_context"][0]["revision_id"] = "other"
    elif change == "basis":
        task["source"]["snapshot"]["design_basis"] = "f" * 64
    elif change == "size":
        task = design_task("中" * 21846)
    elif change == "duplicate":
        task["design_context"] *= 2
    else:
        task["design_context"] = []
    with pytest.raises(CoreError):
        task_context(task)


def test_combined_requirement_task_and_profile_use_utf8_budget_without_truncation():
    task = design_task()
    task["description"] = "需" * 20000 + "\n" + "任" * 20000
    context = task_context(task)
    assert "需" * 20000 in context and "任" * 20000 in context
    final = compose_agent_prompt("profile", context, [])
    assert context in final
    with pytest.raises(CoreError, match="512 KiB"):
        validate_prompt("中" * 174763)
    with pytest.raises(CoreError):
        validate_prompt("invalid\ud800")


def test_final_profile_and_previous_evidence_cannot_overflow_after_plan_acceptance():
    with pytest.raises(CoreError, match="512 KiB"):
        compose_agent_prompt("profile", "x" * (512 * 1024 - 10), [{"message": "more"}])


def test_node_prompt_utf8_budget_is_checked_before_any_process():
    assert Node(id="run", kind="agent", prompt="中" * 10000).prompt == "中" * 10000
    with pytest.raises(ValueError):
        Node(id="run", kind="agent", prompt="中" * 174763)
