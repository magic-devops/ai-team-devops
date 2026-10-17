"""Public binding and executor inputs reject ambiguous identities."""

import pytest
from pydantic import ValidationError
from sop_manager.routers.delivery_contract import PAYLOADS, Command
from sop_manager.routers.delivery_execution_contract import ExecutionQueue


def proposal(**changes):
    return {
        "task_id": "T-one", "task_basis": "a" * 64,
        "workspace_id": "ws", "target_kind": "local", "target_basis": "b" * 64,
        "agent_id": "agent", "agent_version": 1,
        **changes,
    }


@pytest.mark.parametrize("changes", [
    {"executor_member_id": "member-one"},
    {"executor_binding_basis": "c" * 64},
    {"executor_member_id": True, "executor_binding_basis": "c" * 64},
    {"executor_member_id": None, "executor_binding_basis": "c" * 64},
    {"executor_member_id": " member-one", "executor_binding_basis": "c" * 64},
    {"executor_member_id": "member-one", "executor_binding_basis": "bad"},
    {"executor_member_id": "member-one", "executor_binding_basis": "c" * 64,
     "agent_id": "", "nodes": [{"id": "test", "argv": ["python"]}]},
])
def test_executor_pair_is_strict_and_agent_only(changes):
    with pytest.raises(ValidationError):
        ExecutionQueue.model_validate(proposal(**changes))


def test_executor_pair_is_optional_or_fixed():
    direct = ExecutionQueue.model_validate(proposal())
    assert direct.executor_member_id == direct.executor_binding_basis == ""
    associated = ExecutionQueue.model_validate(proposal(
        executor_member_id="member-one", executor_binding_basis="c" * 64,
    ))
    assert associated.executor_member_id == "member-one"


@pytest.mark.parametrize("changes", [
    {"member_id": " member-one"}, {"member_id": None}, {"member_id": 42},
    {"workspace_id": "ws\n"}, {"agent_id": ""},
    {"agent_version": True}, {"agent_version": 0}, {"agent_version": "1"},
    {"profile_digest": "forged"},
])
def test_binding_input_does_not_normalize_or_accept_server_facts(changes):
    model = PAYLOADS["member.runtime.bind"]
    with pytest.raises(ValidationError):
        model.model_validate({
            "member_id": "member-one", "workspace_id": "ws",
            "agent_id": "agent", "agent_version": 1, **changes,
        })


def test_both_binding_commands_are_public_and_configure_scoped():
    from sop_manager.routers.delivery import _command_permission

    for action, payload in [
        ("member.runtime.bind", {"member_id": "member-one", "workspace_id": "ws",
                                 "agent_id": "agent", "agent_version": 2}),
        ("member.runtime.unbind", {"member_id": "member-one"}),
    ]:
        command = Command(action=action, payload=payload, expected_version=1,
                          idempotency_key="binding-contract")
        assert PAYLOADS[action].model_validate(command.payload).member_id == "member-one"
        assert _command_permission(action, payload) == "configure"
