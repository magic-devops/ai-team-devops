"""Catalog assessment absence remains absence in the actual CLI view."""

from __future__ import annotations

import json

import httpx
import pytest
from typer.testing import CliRunner

from sop_cli.commands import pages
from sop_sdk import ManagerClient


@pytest.mark.parametrize("assessment,average", [
    ({"maturity": None, "assessment_state": "unassessed"}, {"avg_maturity": None}),
    ({}, {}),
])
def test_pages_list_renders_unassessed_catalog_values_without_fabricating_zero(monkeypatch, assessment, average):
    result_body = {
        "items": [{"id": "future-module", "name": "New module", "domain": "ai", "path": "/future",
                   "status": "active", **assessment}],
        "summary": {"total": 1, **average, "assessed_count": 0, "unassessed_count": 1},
    }
    seen = []
    with ManagerClient("https://manager.test", project_id="P", max_retries=0) as manager:
        manager._client.close()
        manager._client = httpx.Client(base_url=manager.base_url, transport=httpx.MockTransport(
            lambda req: seen.append(req) or httpx.Response(200, json=result_body)))
        monkeypatch.setattr(pages, "get_client", lambda: manager)
        result = CliRunner().invoke(pages.app, ["list"])
        assert result.exit_code == 0, result.output
        assert result.output.count("未评估") == 2
        assert "None" not in result.output
        raw = CliRunner().invoke(pages.app, ["list", "--json"])
        assert raw.exit_code == 0 and json.loads(raw.output) == result_body
    assert len(seen) == 2 and all(req.url.path == "/api/v1/system/pages" for req in seen)


def test_pages_list_keeps_an_assessed_numeric_zero_and_original_json(monkeypatch):
    result_body = {
        "items": [{"id": "assessed-module", "name": "Assessed", "maturity": 0,
                   "assessment_state": "assessed"}],
        "summary": {"total": 1, "avg_maturity": 0, "assessed_count": 1, "unassessed_count": 0},
    }
    with ManagerClient("https://manager.test", project_id="P", max_retries=0) as manager:
        manager._client.close()
        manager._client = httpx.Client(base_url=manager.base_url, transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json=result_body)))
        monkeypatch.setattr(pages, "get_client", lambda: manager)
        shown = CliRunner().invoke(pages.app, ["list"])
        assert shown.exit_code == 0, shown.output
        assert "未评估" not in shown.output and "None" not in shown.output
        assert "avg_maturity" in shown.output and "Assessed" in shown.output
        assert shown.output.count("0") == 2
        raw = CliRunner().invoke(pages.app, ["list", "--json"])
        assert raw.exit_code == 0 and json.loads(raw.output) == result_body
