import json
from pathlib import Path

from fastapi.testclient import TestClient
from hermes_core.api import create_app
from hermes_core.models import ACTIONS

EXPECTED_PERMISSIONS = {
    "task.dispatch": ["write", "execute"],
    "task.agent-dispatch": ["write", "execute"],
    "schedule.configure": ["config", "execute"],
    "schedule.trigger": ["execute"],
    "schedule.pause": ["config"],
    "schedule.resume": ["config", "execute"],
    "device.pairing": ["config", "execute"],
    "device.revoke": ["config"],
    "workspace.create": ["config"],
    "workspace.update": ["config"],
    "device.create": ["config"],
    "agent.create": ["config"],
    "agent.update": ["config"],
    "squad.create": ["config"],
    "squad.update": ["config"],
}


def _by_id(actions):
    return {action["id"]: action for action in actions}


def test_actions_endpoint_advertises_complete_permissions_matrix(tmp_path):
    app = create_app(tmp_path / "db", "token")
    client = TestClient(app, headers={"Authorization": "Bearer token"})

    response = client.get("/api/hermes/v1/actions")
    assert response.status_code == 200
    actions = response.json()["items"]
    by_id = _by_id(actions)

    assert "create" not in by_id
    assert "update" not in by_id
    assert "schedule.create" not in by_id
    assert "schedule.update" not in by_id
    assert "device.update" not in by_id
    for action in actions:
        assert "permission" not in action
        assert isinstance(action["permissions"], list)
        assert action["permissions"]
    for action_id, permissions in EXPECTED_PERMISSIONS.items():
        assert by_id[action_id]["permissions"] == permissions


def test_static_action_catalog_matches_runtime_actions_and_metadata():
    catalog_path = Path(__file__).resolve().parents[3] / "apis" / "hermes-v1-action-catalog.json"
    catalog = json.loads(catalog_path.read_text())

    assert catalog["action_descriptor"]["permission_contract"].startswith("Every action advertises all required permissions")
    assert catalog["actions"] == ACTIONS
    assert all("permission" not in action for action in catalog["actions"])

    by_id = _by_id(catalog["actions"])
    for action_id, permissions in EXPECTED_PERMISSIONS.items():
        assert by_id[action_id]["permissions"] == permissions

    resource_permissions = catalog["resource_action_permissions"]
    assert resource_permissions["create"]["devices"] == ["config"]
    assert resource_permissions["update"]["workspaces"] == ["config"]
    assert resource_permissions["immutable_or_dedicated"]["schedules"] == "configure/trigger/pause/resume/history only"
