"""Strict public boundary for fixed, scoped execution controls."""

import importlib
import importlib.util

import pytest
from pydantic import ValidationError


def test_execution_controls_require_exact_identity_and_reason():
    name = "sop_manager.routers.delivery_execution_runtime_contract"
    assert importlib.util.find_spec(name) is not None, "Missing fixed execution control contract"
    contract = importlib.import_module(name)
    good = dict(id="execution-one", run_id="run-one", run_version=2, attempt=1,
                control_basis="a" * 64, reason="Reviewed the execution")
    assert contract.ExecutionRuntimeControl.model_validate(good).reason == good["reason"]
    for change in ({"reason": "  "}, {"reason": "bad\x00reason"}, {"reason": "bad\ud800reason"}, {"run_version": True}, {"attempt": True},
                   {"control_basis": "unknown"}, {"workspace_id": "other"}, {"run_id": ""}):
        with pytest.raises(ValidationError):
            contract.ExecutionRuntimeControl.model_validate({**good, **change})
    for change in ({"approval_id": "approval"}, {"decision": "approve"},
                   {"approval_id": "approval", "approval_version": 1, "decision": "yes"}):
        with pytest.raises(ValidationError):
            contract.ExecutionRuntimeControl.model_validate({**good, **change})
    assert contract.ExecutionRuntimeControl.model_validate({**good, "approval_id": "approval",
               "approval_version": 1, "decision": "approve"}).decision == "approve"


def test_usage_projection_rejects_nonfinite_or_unbounded_measurements():
    from sop_manager.routers.delivery_execution_observations import project_result

    value = project_result({"agent": {"usage": {"input_tokens": 10 ** 1000, "cost": float("inf"),
                                                  "output_tokens": 12, "token": "private-value"}}})
    assert value["agent"]["usage"] == {"output_tokens": 12}
