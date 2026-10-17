"""Typed portfolio pages retain complete statistics and accept their own cursors."""

from sop_manager.routers.project_portfolio_routes import router
from sop_manager.routers.sql_models import Project, Task
from test_delivery_workbench import env as delivery_env

env = delivery_env


def test_typed_portfolio_cursor_roundtrip_and_read_permissions(env):
    client, sessions, actor = env
    client.app.include_router(router, prefix="/api/v1/projects")
    with sessions() as db:
        for number in range(13):
            pid = f"page-project-{number:02}"
            db.add(Project(id=pid, tenant_id="tenant", name=f"Page project {number:02}"))
            db.flush()
            db.add(
                Task(
                    id=f"page-task-{number:02}",
                    project_id=pid,
                    tenant_id="tenant",
                    title="Unverified work",
                    status="completed",
                )
            )
        db.commit()
    first = client.get(
        "/api/v1/projects/portfolio", params={"q": "Page project", "risk": "recorded_completed", "limit": 5}
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["total"] == 13 and body["summary"]["metrics"]["verified_completed"] == 0
    assert body["summary"]["risk_counts"]["recorded_completed"] == 13
    second = client.get(
        "/api/v1/projects/portfolio",
        params={"q": "Page project", "risk": "recorded_completed", "limit": 5, "cursor": body["next_cursor"]},
    )
    assert second.status_code == 200, second.text
    assert second.json()["total"] == 13
    assert second.json()["rows"][0]["project"]["id"] == "page-project-05"
    detail = client.get("/api/v1/projects/page-project-00/portfolio")
    assert detail.status_code == 200, detail.text
    assert detail.json()["risks"][0]["target"]["task_id"] == "page-task-00"
    assert detail.json()["facts_source"] == "live"
    actor["id"] = "reader"
    visible = client.get("/api/v1/projects/portfolio")
    assert visible.status_code == 200, visible.text
    assert visible.json()["total"] == 1
    assert not visible.json()["permissions"]["can_create"]
    assert client.get("/api/v1/projects/page-project-00/portfolio").status_code == 404
