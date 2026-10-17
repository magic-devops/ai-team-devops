"""The former manual records must never provide deployment execution APIs."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import ops_center, system_ops


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path / "runtime"))
    app = FastAPI()
    app.include_router(system_ops.router)
    app.include_router(ops_center.router)
    # The retirement contract applies even to an authenticated administrator.
    for route in app.routes:
        for dependency in getattr(getattr(route, "dependant", None), "dependencies", []):
            app.dependency_overrides[dependency.call] = lambda: object()
    with TestClient(app) as http:
        yield http


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/api/v1/system/ops/deployment-pipelines"),
        ("POST", "/api/v1/system/ops/deployment-pipelines/old/action"),
        ("POST", "/api/v1/system/ops/deployment-pipelines/old/execute"),
        ("POST", "/api/v1/system/ops/deployment-pipelines/old/executions/old/callback"),
        ("POST", "/api/v1/system/ops/deployment-pipelines/old/remediation"),
        ("POST", "/api/v1/system/ops/deployment-canary-policies"),
        ("POST", "/api/v1/system/ops/deployment-canary-policies/old/action"),
        ("POST", "/api/v1/system/ops/deployment-canary-policies/old/metric-collection"),
        ("POST", "/api/v1/system/ops/deployment-canary-policies/old/im-briefing"),
        ("POST", "/api/v1/system/ops/deployment-canary-metric-sources"),
        ("POST", "/api/v1/system/ops/deployment-rollback-drills"),
        ("POST", "/api/v1/system/ops/deployment-rollback-drills/old/action"),
        ("POST", "/api/v1/system/ops/deployment-rollback-runbooks"),
        ("POST", "/api/v1/system/ops/deployment-rollback-runbooks/old/action"),
        ("POST", "/api/v1/system/ops/deployment-execution-audits"),
        ("POST", "/api/v1/system/ops/deployment-execution-audits/old/tasks"),
        ("POST", "/api/v1/system/ops/deployment-package-approvals"),
        ("POST", "/api/v1/system/ops/deployment-package-approvals/old/action"),
        ("POST", "/api/v1/system/ops/deployment-executor-targets"),
        ("PUT", "/api/v1/system/ops/deployment-executor-targets/old"),
        ("POST", "/api/v1/system/ops/deployment-executor-targets/old/action"),
        ("POST", "/api/v1/ops-center/pipelines"),
        ("PUT", "/api/v1/ops-center/pipelines/old/trigger"),
        ("PUT", "/api/v1/ops-center/pipelines/old/status"),
        ("DELETE", "/api/v1/ops-center/pipelines/old"),
    ],
)
def test_legacy_deployment_writes_are_not_registered(client, method, path):
    from starlette.routing import Match

    response = client.request(method, path, json={"action": "mark_success", "status": "success"})
    assert response.status_code in {404, 405}
    scope = {"type": "http", "path": path, "method": method, "root_path": ""}
    assert all(route.matches(scope)[0] != Match.FULL for route in client.app.routes)


@pytest.mark.parametrize(
    "path",
    [
        "deployment-pipelines",
        "deployment-canary-policies",
        "deployment-canary-metric-sources",
        "deployment-rollback-drills",
        "deployment-rollback-runbooks",
        "deployment-package-approvals",
        "deployment-execution-audits",
        "deployment-executor-targets",
        "deployment-pipeline-executors",
    ],
)
def test_unscoped_deployment_history_is_not_exposed(client, path):
    assert client.get(f"/api/v1/system/ops/{path}").status_code == 404


def test_ops_pipeline_history_is_read_only_and_project_scoped(client, tmp_path):
    tokens = set_request_scope(
        tenant_id="tenant-a",
        tenant_code="tenant-a",
        business_code="business-a",
        project_id="project-a",
        project_code="project-a",
        project_path=tmp_path,
    )
    try:
        directory = ops_center._dir("pipelines")
        directory.mkdir(parents=True)
        for name, project in [("mine", "project-a"), ("other-project", "project-b")]:
            row = {
                "id": name,
                "tenant_id": "tenant-a",
                "tenant_code": "tenant-a",
                "business_code": "business-a",
                "project_id": project,
                "project_code": project,
                "name": name,
                "status": "success",
                "created_at": "2025-01-01T00:00:00Z",
            }
            (directory / f"{name}.json").write_text(json.dumps(row), encoding="utf-8")
        (directory / "unscoped.json").write_text(json.dumps({"id": "unscoped", "status": "success"}))
        snapshots = {path.name: path.read_bytes() for path in directory.glob("*.json")}
        result = ops_center.list_pipelines()
        assert [item["id"] for item in result["items"]] == ["mine"]
        assert result["historical_only"] is True
        assert result["deployment_evidence"] is False
        assert result["total"] == 1
        assert {path.name: path.read_bytes() for path in directory.glob("*.json")} == snapshots
    finally:
        reset_request_scope(tokens)


def test_public_capability_map_does_not_advertise_retired_deployment_execution():
    from sop_manager.routers.system_pages import system_pages_readiness

    pages = {item["id"]: item for item in system_pages_readiness()["items"]}
    profiles = pages["settingsProfiles"]
    assert profiles["name"] == "环境配置与导出"
    assert all(
        "deployment-" not in path or "/deployment-packages" in path
        for path in profiles["implementation_contract"]["apis"]
    )
    assert "部署包审批发布" not in profiles["capabilities"]
    assert "只读旧流水线历史" in pages["opsCenterPipeline"]["capabilities"]
