"""The attention CLI uses bounded server reads and reports the current page truthfully."""

import json
from contextlib import contextmanager

import httpx
import pytest
from sop_cli.commands import delivery
from sop_sdk.client import ManagerClient
from typer.testing import CliRunner


def use_manager(monkeypatch, response, *, status=200):
    seen = []

    @contextmanager
    def client():
        with ManagerClient("https://manager.example", project_id="selected", max_retries=0) as instance:
            instance._client.close()
            instance._client = httpx.Client(
                base_url=instance.base_url,
                transport=httpx.MockTransport(
                    lambda request: seen.append(request) or httpx.Response(status, json=response)
                ),
            )
            yield instance

    monkeypatch.setattr(delivery, "get_client", client)
    return seen


def inbox_page(**changes):
    return {
        "project_id": "selected",
        "version": 8,
        "query_generation": 12,
        "scope": "team",
        "category": "blocked",
        "counts": {"total": 200, "blocked": 31},
        "total": 31,
        "limit": 7,
        "has_more": True,
        "next_cursor": "next-fixed",
        "items": [
            {
                "id": "task:T-one",
                "resource_id": "T-one",
                "title": "Recorded delivery",
                "status": "recorded_completed",
                "categories": ["blocked", "acceptance"],
            }
        ],
        **changes,
    }


def test_inbox_cli_preserves_category_cursor_and_full_json_without_extra_reads(monkeypatch):
    expected = inbox_page()
    seen = use_manager(monkeypatch, expected)
    output = CliRunner().invoke(
        delivery.app,
        ["inbox", "--scope", "team", "--category", "blocked", "--limit", "7", "--cursor", "original-fixed", "--json"],
    )
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected
    assert len(seen) == 1
    assert dict(seen[0].url.params) == {
        "scope": "team",
        "category": "blocked",
        "limit": "7",
        "cursor": "original-fixed",
    }


def test_inbox_default_text_distinguishes_page_count_matching_total_and_next_cursor(monkeypatch):
    seen = use_manager(monkeypatch, inbox_page(scope="mine", category="all", limit=20))
    output = CliRunner().invoke(delivery.app, ["inbox"])
    assert output.exit_code == 0, output.output
    assert len(seen) == 1 and dict(seen[0].url.params) == {"scope": "mine", "category": "all", "limit": "20"}
    assert "本页 1 项" in output.output and "匹配总数 31 项" in output.output
    assert (
        "has_more=true" in output.output
        and "next_cursor" in output.output
        and "next-fixed" in output.output
        and "--cursor" in output.output
    )
    assert "recorded_completed" in output.output
    assert "匹配总数 200" not in output.output


def test_inbox_empty_filtered_page_does_not_claim_the_entire_inbox_is_empty(monkeypatch):
    use_manager(monkeypatch, inbox_page(items=[], total=0, has_more=False, next_cursor=""))
    output = CliRunner().invoke(delivery.app, ["inbox", "--scope", "team", "--category", "blocked"])
    assert output.exit_code == 0, output.output
    assert "本页 0 项" in output.output and "匹配总数 0 项" in output.output and "has_more=false" in output.output
    assert "当前没有待处理事项" not in output.output and "next_cursor" not in output.output


def test_inbox_text_identifies_external_acceptance_and_the_exact_report_without_extra_reads(monkeypatch):
    item = {"id": "task:T", "resource_id": "T", "title": "External report", "status": "awaiting_review",
            "categories": ["acceptance"], "acceptance_kind": "external",
            "target": {"view": "list", "requirement_id": "R", "detail": "tasks", "task_id": "T", "submission_id": "S-report", "work_order_id": None}}
    seen = use_manager(monkeypatch, inbox_page(items=[item], total=1, has_more=False, next_cursor=None))
    output = CliRunner().invoke(delivery.app, ["inbox", "--category", "acceptance"])
    assert output.exit_code == 0, output.output
    assert "外部交付待验收" in output.output and "报告 S-report" in output.output
    assert "awaiting_review" in output.output and len(seen) == 1
    assert seen[0].url.path == "/api/v1/delivery/inbox"


def test_inbox_json_keeps_active_work_order_and_reported_blocked_classification(monkeypatch):
    item = {"id": "task:T", "resource_id": "T", "title": "Held work", "status": "blocked", "categories": ["work", "blocked"],
            "acceptance_kind": None, "target": {"view": "list", "requirement_id": "", "detail": "tasks", "task_id": "T", "submission_id": None, "work_order_id": "W-held"}}
    expected = inbox_page(items=[item], scope="mine", category="blocked", total=1, has_more=False, next_cursor=None)
    seen = use_manager(monkeypatch, expected)
    output = CliRunner().invoke(delivery.app, ["inbox", "--category", "blocked", "--json"])
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected and len(seen) == 1
    text = CliRunner().invoke(delivery.app, ["inbox", "--category", "blocked"])
    assert text.exit_code == 0 and "工单 W-held" in text.output


@pytest.mark.parametrize(
    "arguments", [["--scope", "all"], ["--category", "wrong"], ["--limit", "0"], ["--limit", "101"]]
)
def test_invalid_inbox_cli_selection_does_not_construct_a_client(monkeypatch, arguments):
    monkeypatch.setattr(delivery, "get_client", lambda: pytest.fail("Invalid selection must not construct client"))
    output = CliRunner().invoke(delivery.app, ["inbox", *arguments])
    assert output.exit_code != 0
    assert not isinstance(output.exception, pytest.fail.Exception)


def test_stale_inbox_cli_cursor_is_an_error_without_automatic_first_page_retry(monkeypatch):
    seen = use_manager(monkeypatch, {"detail": "Reload the first page"}, status=409)
    output = CliRunner().invoke(delivery.app, ["inbox", "--category", "overdue", "--cursor", "stale-fixed", "--json"])
    assert output.exit_code == 1 and "Reload the first page" in output.output
    assert len(seen) == 1 and seen[0].url.params["cursor"] == "stale-fixed"


@pytest.mark.parametrize(
    "arguments,params",
    [
        ([], {}),
        (
            ["--starts-on", "2026-10-15", "--ends-on", "2026-10-19"],
            {"starts_on": "2026-10-15", "ends_on": "2026-10-19"},
        ),
    ],
)
def test_progress_summary_cli_preserves_coverage_and_current_metrics_in_json(monkeypatch, arguments, params):
    expected = {
        "project_id": "selected",
        "version": 8,
        "query_generation": 12,
        "as_of": "2026-10-18T00:00:00Z",
        "timezone": "UTC",
        "range": {"starts_on": "2026-10-15", "ends_on": "2026-10-19"},
        "current": {"metrics": {"tasks_total": 3, "verified_completed": 0}},
        "coverage": {
            "first_observed_at": None,
            "last_observed_at": None,
            "observed_days": [],
            "missing_days": ["2026-10-15"],
            "future_days": ["2026-10-19"],
        },
    }
    seen = use_manager(monkeypatch, expected)
    output = CliRunner().invoke(delivery.app, ["progress-summary", *arguments, "--json"])
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected
    assert (
        len(seen) == 1
        and seen[0].url.path == "/api/v1/delivery/progress/summary"
        and dict(seen[0].url.params) == params
    )


def test_progress_summary_cli_does_not_invent_history_for_forbidden_projects(monkeypatch):
    seen = use_manager(monkeypatch, {"detail": "Project access denied"}, status=403)
    output = CliRunner().invoke(delivery.app, ["progress-summary", "--json"])
    assert output.exit_code == 1 and "Project access denied" in output.output
    assert len(seen) == 1


def test_progress_summary_default_text_keeps_observed_missing_and_future_days_distinct(monkeypatch):
    seen = use_manager(
        monkeypatch,
        {
            "project_id": "selected",
            "version": 8,
            "query_generation": 12,
            "as_of": "2026-10-18T00:00:00Z",
            "timezone": "UTC",
            "range": {"starts_on": "2026-10-15", "ends_on": "2026-10-19"},
            "current": {"metrics": {"tasks_total": 3, "recorded_completed": 1, "verified_completed": 0}},
            "coverage": {
                "first_observed_at": "2026-10-16T00:00:00Z",
                "last_observed_at": "2026-10-16T00:00:00Z",
                "observed_days": ["2026-10-16"],
                "missing_days": ["2026-10-15", "2026-10-17", "2026-10-18"],
                "future_days": ["2026-10-19"],
            },
        },
    )
    output = CliRunner().invoke(delivery.app, ["progress-summary"])
    assert output.exit_code == 0, output.output
    assert "真实观测 1 天" in output.output and "缺失 3 天" in output.output and "未来 1 天" in output.output
    assert "任务 3" in output.output and "已验证 0" in output.output
    assert len(seen) == 1 and seen[0].url.path == "/api/v1/delivery/progress/summary"
