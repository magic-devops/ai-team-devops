"""Retirement coverage for the former manual execution and callback stores."""

from __future__ import annotations

import hashlib

import pytest

from sop_manager.routers import test_legacy_deployment_retirement as retirement

client = retirement.client


@pytest.mark.parametrize(
    "resource,filename",
    [
        ("deployment-pipelines", "deployment-pipeline-runs.json"),
        ("deployment-executor-targets", "deployment-executor-targets.json"),
        ("deployment-execution-audits", "deployment-execution-audits.json"),
        ("deployment-package-approvals", "deployment-package-approvals.json"),
    ],
)
def test_retired_execution_history_is_preserved_without_public_execution_api(
    client, tmp_path, resource, filename
):
    path = tmp_path / "runtime" / "deploy" / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    original = b'{"items":[{"id":"historic","status":"success","project_id":"other-project"}]}'
    path.write_bytes(original)
    digest = hashlib.sha256(original).hexdigest()
    assert client.get(f"/api/v1/system/ops/{resource}").status_code == 404
    assert client.get(f"/api/v1/system/ops/{resource}/historic").status_code == 404
    for suffix in ("", "/action", "/execute", "/remediation", "/executions/existing/callback", "/tasks"):
        response = client.post(
            f"/api/v1/system/ops/{resource}/historic{suffix}",
            json={"action": "mark_success", "status": "success"},
        )
        assert response.status_code in {404, 405}
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
