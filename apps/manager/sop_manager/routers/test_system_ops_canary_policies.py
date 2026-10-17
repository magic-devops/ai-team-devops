"""Legacy metric integers and manual rollback records are not execution APIs."""

from __future__ import annotations

import pytest

from sop_manager.routers import test_legacy_deployment_retirement as retirement

client = retirement.client


@pytest.mark.parametrize(
    "resource",
    [
        "deployment-canary-policies",
        "deployment-canary-metric-sources",
        "deployment-rollback-drills",
        "deployment-rollback-runbooks",
    ],
)
def test_manual_canary_and_rollback_history_stays_on_disk_without_public_api(client, tmp_path, resource):
    path = tmp_path / "runtime" / "deploy" / f"{resource}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    original = b'{"items":[{"id":"historic","status":"completed","current_traffic":100}]}'
    path.write_bytes(original)
    for suffix in ("", "/historic"):
        assert client.get(f"/api/v1/system/ops/{resource}{suffix}").status_code == 404
    for suffix in ("", "/historic/action", "/historic/metric-collection", "/historic/im-briefing"):
        response = client.post(
            f"/api/v1/system/ops/{resource}{suffix}",
            json={"action": "complete", "metrics": {"error_rate": 0, "traffic_percent": 100}},
        )
        assert response.status_code in {404, 405}
    assert path.read_bytes() == original
