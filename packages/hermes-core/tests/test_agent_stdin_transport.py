"""Actual local/remote controller consumers; these definitions have not run yet."""
import hashlib
import json
import subprocess
import sys

import pytest

from hermes_core.agents import AgentProfile, provider_command
from hermes_core.models import CoreError
from hermes_core.remote_worker import _run_agent_task
from hermes_core.stream_runner import run_stream


@pytest.mark.parametrize("provider", ["codex", "claude"])
def test_proven_provider_modes_keep_full_design_out_of_windows_argv(monkeypatch, provider):
    monkeypatch.setattr("hermes_core.agents.shutil.which", lambda _: "provider")
    prompt = "设计正文" * 16000
    argv = provider_command(AgentProfile(title="Agent", provider=provider), prompt)
    assert sum(len(arg) for arg in argv) < 1000
    assert prompt not in argv


@pytest.mark.parametrize("matching", [True, False])
def test_real_stream_consumer_requires_exact_stdin_original_receipt(tmp_path, monkeypatch, matching):
    fixture = tmp_path / "agentd.py"
    fixture.write_text("import hashlib,json,sys\n"
        "request=json.loads(sys.stdin.readline())\n"
        "body=request['stdin_text'].encode('utf-8')\n"
        f"digest=hashlib.sha256(body).hexdigest() if {matching!r} else 'legacy'\n"
        "assert request['stdin_sha256']==hashlib.sha256(body).hexdigest()\n"
        "print(json.dumps({'event':'tool.completed','result':{'ok':True,'exit_code':0,'stdout':str(len(body)),"
        "'stdin_sha256':digest,'process_tree_stopped':True,'output_eof':True,'wait_completed':True}}),flush=True)\n", encoding="utf-8")
    original = subprocess.Popen
    monkeypatch.setattr("hermes_core.stream_runner.subprocess.Popen", lambda argv, **kwargs: original([sys.executable, str(fixture)], **kwargs))
    body = "完整设计正文\n" * 15000
    call = lambda: run_stream("agentd", tmp_path, ["provider", "-"], 10, on_output=lambda _: None, control=lambda: None, stdin_text=body)
    if matching:
        result = call()
        assert result["stdin_sha256"] == hashlib.sha256(body.encode()).hexdigest()
        assert result["stdout"] == str(len(body.encode()))
        assert result["process_tree_stopped"] and result["wait_completed"] and result["output_eof"]
    else:
        with pytest.raises(CoreError, match="complete original stdin"):
            call()


def test_paired_worker_sends_same_complete_design_body_and_preserves_profile_binding(tmp_path, monkeypatch):
    from test_design_agent_input import design_task
    from hermes_core.agents import single_agent_nodes

    task = design_task("架构正文\n" * 4000)
    profile = AgentProfile(title="Worker", provider="codex", instructions="Trusted profile")
    node = single_agent_nodes({"id": "agent", "data": profile.model_dump()}, task, [])[0]
    claim = {"run_id": "R", "owner": "owner", "node": node.model_dump(), "agent_source": {"resource": "agents"},
             "agent_binding": {"agent_id": "agent", "version": 3, "profile": profile.model_dump()}}
    seen = []
    monkeypatch.setattr("hermes_core.agents.shutil.which", lambda _: "provider")
    def stream(*args, **kwargs):
        seen.append(kwargs["stdin_text"])
        assert args[2][-1] == "-"
        return {"ok": True, "exit_code": 0, "stdout": '{"type":"turn.completed"}',
                "process_tree_stopped": True, "wait_completed": True, "output_eof": True}
    monkeypatch.setattr("hermes_core.stream_runner.run_stream", stream)
    result = _run_agent_task("agentd", tmp_path, claim, "unused", {})
    assert result["ok"] and result["agent"]["profile_version"] == 3
    context = json.loads(seen[0].split("Task context:\n", 1)[1].split("\nLeader delegation:", 1)[0])
    assert context["design_context"] == task["design_context"]
    assert seen[0].startswith("Trusted profile\n")


def test_local_execution_agent_consumer_passes_the_identical_frozen_design_original(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from hermes_core.execution import Execution
    from hermes_core.agents import single_agent_nodes
    from test_design_agent_input import design_task

    task = design_task("完整架构\n" * 4000)
    profile = AgentProfile(title="Local", provider="codex", instructions="Trusted profile")
    agent = {"id": "agent", "version": 4, "status": "active", "data": profile.model_dump()}
    node = single_agent_nodes(agent, task, [])[0]
    engine = object.__new__(Execution)
    engine.store = SimpleNamespace(get=lambda *args: agent)
    calls = []
    def tool(*args, **kwargs):
        calls.append((args[3].argv, kwargs["stdin_text"]))
        return {"succeeded": True, "stdout": '{"type":"turn.completed"}'}
    engine.tool = tool
    monkeypatch.setattr("hermes_core.agents.shutil.which", lambda _: "provider")
    result = engine.agent_tool(None, "W", "R", node, str(tmp_path), "owner", {"data": {
        "agent_bindings": {node.id: {"agent_id": "agent", "version": 4, "profile": profile.model_dump()}},
        "node_results": {}, "agent_source": {"resource": "agents"}}})
    assert result["succeeded"] and result["agent"]["profile_version"] == 4
    assert calls[0][0][-1] == "-"
    context = json.loads(calls[0][1].split("Task context:\n", 1)[1].split("\nLeader delegation:", 1)[0])
    assert context["design_context"] == task["design_context"]


def test_opencode_long_unverified_transport_is_blocked_before_new_plan(monkeypatch):
    from hermes_core.agents import single_agent_nodes
    profile = AgentProfile(title="Unverified", provider="opencode")
    monkeypatch.setattr("hermes_core.agents.shutil.which", lambda _: "installed")
    with pytest.raises(CoreError) as caught:
        single_agent_nodes({"id": "agent", "data": profile.model_dump()}, {"title": "Task", "description": "x" * 8192, "acceptance_criteria": "Test"}, [])
    assert caught.value.code == "agent_input_transport_unverified"


def test_opencode_short_complete_argv_remains_available_without_duplicate_stdin(tmp_path, monkeypatch):
    import subprocess
    from hermes_core.agents import single_agent_nodes
    prompt = 'quoted "task" and \\ full input'
    monkeypatch.setattr("hermes_core.agents.shutil.which", lambda _: "opencode")
    profile = AgentProfile(title="Tool", provider="opencode")
    argv = provider_command(profile, prompt)
    assert argv[-1] == prompt
    assert len(subprocess.list2cmdline(argv).encode("utf-16-le")) // 2 <= 30000
    node = single_agent_nodes({"id": "agent", "data": profile.model_dump()}, {"title": "Task", "acceptance_criteria": "Test"}, [])[0]
    claim = {"run_id": "R", "owner": "owner", "node": node.model_dump(), "agent_source": {"resource": "agents"},
             "agent_binding": {"agent_id": "agent", "version": 3, "profile": profile.model_dump()}}
    def stream(*args, **kwargs):
        assert kwargs["stdin_text"] == ""
        assert node.prompt in args[2][-1]
        return {"ok": True, "exit_code": 0, "stdout": '{"type":"step_finish","part":{"reason":"stop"}}'}
    monkeypatch.setattr("hermes_core.stream_runner.run_stream", stream)
    assert _run_agent_task("agentd", tmp_path, claim, "unused", {})["ok"]


def test_opencode_windows_quoted_commandline_limit_is_checked_before_spawn(monkeypatch):
    monkeypatch.setattr("hermes_core.agents.shutil.which", lambda _: "x" * 31000)
    with pytest.raises(CoreError) as caught:
        provider_command(AgentProfile(title="Tool", provider="opencode"), "short complete task")
    assert caught.value.code == "agent_input_transport_unverified"
