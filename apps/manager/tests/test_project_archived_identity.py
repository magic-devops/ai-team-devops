"""Archived proofs cannot revive when global identity availability changes."""

# ruff: noqa: F811 - shared real SQL/API fixtures are injected by pytest.

import pytest
from sop_manager.routers.sql_models import DeliveryTaskReview, DeliveryWorkspace, Project, Task, User
from sqlalchemy import bindparam, update
from test_delivery_manual_review import review
from test_delivery_team_identity import accepted_parent, create
from test_delivery_workbench import command, env  # noqa: F401


@pytest.mark.parametrize("writer", ["orm", "core", "bound", "bulk"])
@pytest.mark.parametrize("proof", ["manual", "collective"])
def test_global_user_disable_and_restore_permanently_invalidates_archived_proof(env, writer, proof):
    client, sessions, _ = env
    if proof == "collective":
        task = accepted_parent(client)
    else:
        task = create(client, owner_id="user:reader")
        assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
        assert review(client, task["id"]).status_code == 200
    with sessions() as db:
        engine = db.get_bind()
    # Provision the archive boundary without depending on Task2's lifecycle API.
    with engine.begin() as connection:
        connection.execute(update(Project).where(Project.id == "project").values(status="archived"))
    for status in ("suspended", "active"):
        with sessions() as db:
            if writer == "orm":
                db.get(User, "reader").status = status
            elif writer == "core":
                db.execute(update(User).where(User.id == "reader").values(status=status))
            elif writer == "bound":
                db.execute(update(User.__table__).where(User.id == bindparam("target"))
                           .values(status=bindparam("next_status")), {"target": "reader", "next_status": status})
            else:
                db.execute(update(User), [{"id": "reader", "status": status}])
            db.commit()
            assert db.get(Project, "project").status == "archived"
            assert db.get(Task, task["id"]).status == "completed"
            if proof == "manual":
                assert db.query(DeliveryTaskReview).filter_by(task_id=task["id"]).one().invalidated
            else:
                flow = db.get(DeliveryWorkspace, "project").data["flows"][task["req_id"]]
                assert flow["stage"] == "intake" and flow["revision"] > 1
