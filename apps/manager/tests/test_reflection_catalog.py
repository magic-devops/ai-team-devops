"""Unknown catalogue assessment never becomes a fabricated numeric score."""

import pytest
from sop_manager.routers import system_pages as pages


def unknown():
    return {"id": "new-unassessed-module", "name": "New capability", "domain": "ai", "path": "#/new-capability",
            "status": "active", "maturity": None, "assessment_state": "unassessed", "apis": [], "capabilities": [], "next": []}


def test_new_reflection_catalogue_has_no_invented_maturity_percentage():
    row = next(item for item in pages.REACT_PAGES if item["id"] == "reflectionIntake")
    assert row["maturity"] is None
    assert row["assessment_state"] == "unassessed"


def test_unknown_catalogue_assessment_is_excluded_from_summary_and_domain_average():
    known = {**unknown(), "id": "assessed", "maturity": 90, "assessment_state": "assessed"}
    rows = [known, unknown()]
    summary = pages._summary(rows)
    assert summary["avg_maturity"] == 90
    assert summary["assessed_count"] == 1 and summary["unassessed_count"] == 1
    domain = next(row for row in pages._domain_matrix(rows, []) if row["id"] == "ai")
    assert domain["avg_maturity"] == 90
    assert domain["assessed_count"] == 1 and domain["unassessed_count"] == 1
    only_unknown = pages._summary([unknown()])
    assert only_unknown["avg_maturity"] is None and only_unknown["unassessed_count"] == 1


@pytest.mark.parametrize("value", [None, True, "90", float("nan"), float("inf"), -1, 101])
def test_missing_or_invalid_assessment_never_becomes_zero_or_a_score(value):
    result = pages._summary([{**unknown(), "maturity": value, "assessment_state": "assessed"}])
    assert result["avg_maturity"] is None and result["unassessed_count"] == 1


def test_real_numeric_zero_remains_an_assessed_zero():
    row = {**unknown(), "maturity": 0, "assessment_state": "assessed"}
    result = pages._summary([row])
    assert result["avg_maturity"] == 0 and result["assessed_count"] == 1 and result["unassessed_count"] == 0


def test_microapp_average_excludes_unknown_and_reports_assessment_counts(monkeypatch):
    known = {**unknown(), "id": "assessed", "maturity": 90, "assessment_state": "assessed"}
    monkeypatch.setattr(pages, "REACT_PAGES", [known, unknown()])
    monkeypatch.setattr(pages, "MICRO_APPS", [{"id": "test-app", "module_ids": ["assessed", "new-unassessed-module"], "domains": ["ai"]}])
    row = pages._micro_app_registry()[0]
    assert row["avg_maturity"] == 90
    assert row["assessed_count"] == 1 and row["unassessed_count"] == 1
    monkeypatch.setattr(pages, "REACT_PAGES", [unknown()])
    row = pages._micro_app_registry()[0]
    assert row["avg_maturity"] is None and row["status"] == "unassessed"


def test_unknown_assessment_does_not_create_fake_low_maturity_governance_tasks(monkeypatch):
    monkeypatch.setattr(pages, "REACT_PAGES", [unknown()])
    monkeypatch.setattr(pages, "LEGACY_PAGES", [])
    status = pages._governance_status([unknown()], [])
    assert status["completion_status"]["react_need_improvement"] == 0
    assert status["completion_status"]["unassessed_count"] == 1
    generated = pages._governance_task_payloads(scope="module_maturity", priority="P2", owner_id="", max_items=10)
    assert generated == []


@pytest.mark.parametrize(
    "matrix,payload,score,average",
    [
        ("_module_readiness_matrix", "_module_readiness_payload", "readiness_score", "avg_score"),
        ("_production_readiness_matrix", "_module_production_readiness_payload", "production_score", "avg_production_score"),
        ("_module_experience_review_matrix", "_module_experience_review_payload", "experience_score", "avg_experience_score"),
    ],
)
def test_unassessed_module_does_not_receive_derived_scores_or_failed_dimensions(monkeypatch, matrix, payload, score, average):
    monkeypatch.setattr(pages, "REACT_PAGES", [unknown()])
    rows = getattr(pages, matrix)()
    assert len(rows) == 1
    assert rows[0][score] is None
    assert rows[0]["assessment_state"] == "unassessed"
    assert rows[0].get("status", rows[0].get("stage")) == "unassessed"
    assert not rows[0]["dimensions"]
    result = getattr(pages, payload)()
    assert result["summary"][average] is None
    assert result["summary"]["assessed_count"] == 0
    assert result["summary"]["unassessed_count"] == 1


@pytest.mark.parametrize(
    "handler,body,existing,filter_field",
    [
        ("system_page_readiness_tasks", "ReadinessTaskIn", "_existing_readiness_task_ids", "status"),
        ("system_pages_production_readiness_tasks", "ProductionReadinessTaskIn", "_existing_production_readiness_task_ids", "stage"),
        ("system_page_experience_tasks", "ExperienceTaskIn", "_existing_experience_task_ids", "status"),
    ],
)
def test_unassessed_module_does_not_generate_fake_readiness_or_experience_tasks(monkeypatch, handler, body, existing, filter_field):
    monkeypatch.setattr(pages, "REACT_PAGES", [unknown()])
    monkeypatch.setattr(pages, existing, lambda: set())
    request = getattr(pages, body)(ids=["new-unassessed-module"], **{filter_field: "all"}, dry_run=True)
    result = getattr(pages, handler)(request)
    assert result["planned"] == [] and result["created"] == []
