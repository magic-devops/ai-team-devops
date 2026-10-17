"""Diagnosis inputs must not accept duplicate scope, blank work or executable actions."""

import pytest
from pydantic import ValidationError


def test_generation_rejects_duplicate_evidence_and_requires_issue_selection():
    from sop_manager.routers.delivery_issue_contract import IssueDiagnosisGenerate

    valid = {
        "expected_version": 0,
        "issue_basis": "a" * 64,
        "selected_evidence_ids": ["issue:ISS-1"],
        "idempotency_key": "diagnose-first",
    }
    assert IssueDiagnosisGenerate.model_validate(valid).generator == "ai"
    for change in (
        {"selected_evidence_ids": ["issue:ISS-1", "issue:ISS-1"]},
        {"selected_evidence_ids": []},
        {"issue_basis": "x" * 64},
        {"expected_version": True},
        {"instructions": "bad\x00input"},
    ):
        with pytest.raises(ValidationError):
            IssueDiagnosisGenerate.model_validate({**valid, **change})


def test_diagnosis_schema_refuses_invented_actions_and_blank_acceptance():
    from sop_manager.routers.delivery_issue_contract import DiagnosisSuggestion

    value = {
        "summary": "Recorded failure needs inspection",
        "hypotheses": [
            {
                "hypothesis": "Service configuration may be incorrect",
                "confidence": "low",
                "evidence_ids": ["issue:ISS-1"],
                "verification_steps": ["Inspect the supplied failure evidence"],
            }
        ],
        "checks": [],
        "risks": [],
        "requirement": {
            "title": "Investigate failure",
            "description": "Inspect and verify",
            "priority": "P1",
            "acceptance_criteria": ["The cause is confirmed using a repeatable check"],
        },
        "open_questions": [],
    }
    assert DiagnosisSuggestion.model_validate(value).requirement.priority == "P1"
    for change in (
        {"resolve": True},
        {"summary": "   "},
        {"hypotheses": [{**value["hypotheses"][0], "evidence_ids": []}]},
        {"requirement": {**value["requirement"], "acceptance_criteria": [" "]}},
        {"requirement": {**value["requirement"], "acceptance_criteria": ["bad\x00criteria"]}},
    ):
        with pytest.raises(ValidationError):
            DiagnosisSuggestion.model_validate({**value, **change})
