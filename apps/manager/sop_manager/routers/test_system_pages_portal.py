from sop_manager.routers.sql_models import User
from sop_manager.routers.system_pages import system_pages_hub


def test_system_pages_hub_exposes_hermes_portal_contract():
    user = User(
        id="u-test",
        tenant_id="default",
        username="admin",
        password_hash="x",
        role="super_admin",
        status="active",
    )

    payload = system_pages_hub(user)

    assert payload["ok"] is True
    assert payload["portal"]["name"] == "Hermes Portal"
    assert payload["portal"]["mode"] == "portal_control_plane"
    assert payload["identity"]["username"] == "admin"
    assert payload["identity"]["role"] == "super_admin"
    assert payload["contracts"]["menu"]["nav_items"] > 0
    assert payload["contracts"]["permission"]["visible"] > 0
    assert payload["readiness"]["score"] >= 80
    assert len(payload["micro_apps"]) >= 5
    assert {item["id"] for item in payload["governance_actions"]} >= {
        "menu-contract",
        "permission-matrix",
        "micro-app-registry",
    }
