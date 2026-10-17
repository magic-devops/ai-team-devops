"""The assistance writer preserves real SQLite event-to-link foreign keys."""

from test_requirements_assistance import adoption
from test_requirements_assistance import app_env as app_env  # noqa: F401
from test_requirements_assistance import env as env  # noqa: F401


def test_assistance_event_precedes_links_with_foreign_keys_enabled(app_env):
    client, sessions = app_env
    with sessions() as db:
        db.connection().exec_driver_sql("PRAGMA foreign_keys=ON")
        db.commit()
    preview = client.post("/api/v1/requirements/REQ-selected/review", json={"generator": "rules"})
    assert preview.status_code == 200, preview.text
    saved = client.post(
        "/api/v1/requirements/REQ-selected/apply-review",
        json=adoption(
            preview.json(),
            acceptance_criteria=["Actual enforced foreign-key adoption"],
        ),
    )
    assert saved.status_code == 200, saved.text
    events = client.get(
        "/api/v1/delivery/activity", params={"scope": "requirement", "scope_id": "REQ-selected"}
    )
    assert events.status_code == 200 and len(events.json()["items"]) == 1
