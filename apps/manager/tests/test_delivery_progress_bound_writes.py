"""Bound SQL batches keep exact progress scopes and native owner invalidation."""

# ruff: noqa: F811 - shared pytest fixtures are imported and injected by name.

from sop_manager.routers.sql_models import DeliveryProgressObservation, DeliveryWorkspace, Project, Task, User
from sqlalchemy import bindparam, insert, update
from test_delivery_execution import bridge, queue, sync  # noqa: F401
from test_delivery_progress_capture import sessions  # noqa: F401
from test_delivery_workbench import env  # noqa: F401


def count(db, project):
    return db.query(DeliveryProgressObservation).filter_by(project_id=project).count()


def test_bound_core_task_batch_captures_only_affected_projects_and_normalized_conditions(sessions):
    with sessions() as db:
        db.add_all(
            [
                Project(id="second", tenant_id="tenant", name="Second"),
                Project(id="unrelated", tenant_id="tenant", name="Unrelated"),
            ]
        )
        db.flush()
        db.add_all(
            [
                Task(id=tid, tenant_id="tenant", project_id=pid, title=tid, acceptance_criteria=["Original"])
                for tid, pid in (("one", "project"), ("two", "second"), ("unrelated", "unrelated"))
            ]
        )
        db.commit()
        before = {pid: count(db, pid) for pid in ("project", "second", "unrelated")}
        db.execute(
            update(Task.__table__).where(Task.id == bindparam("target_id")),
            [
                {"target_id": "one", "acceptance_criteria": ["  First checked  "]},
                {"target_id": "two", "acceptance_criteria": ["  Second checked  "]},
            ],
        )
        db.commit()
        assert db.get(Task, "one").acceptance_criteria == ["First checked"]
        assert db.get(Task, "two").acceptance_criteria == ["Second checked"]
        assert {pid: count(db, pid) - before[pid] for pid in before} == {
            "project": 1,
            "second": 1,
            "unrelated": 0,
        }
        latest = (
            db.query(DeliveryProgressObservation)
            .filter_by(project_id="project")
            .order_by(DeliveryProgressObservation.seq.desc())
            .first()
        )
        assert latest.data["tasks"][0]["acceptance_criteria"] == ["First checked"]


def test_bound_core_insert_keeps_static_identity_scope_when_parameters_only_contain_conditions(sessions):
    with sessions() as db:
        before = count(db, "project")
        db.execute(
            insert(Task).values(
                id="bound",
                tenant_id="tenant",
                project_id="project",
                title="Bound insert",
                acceptance_criteria=bindparam("criteria"),
            ),
            {"criteria": ["  Checked  "]},
        )
        db.commit()
        assert db.get(Task, "bound").acceptance_criteria == ["Checked"]
        assert count(db, "project") == before + 1


def test_bound_core_user_batch_tracks_old_and_new_identity_without_reviving_native_receipt(bridge):
    _, sessions, _, _, _, _, _ = bridge
    intent = sync(bridge, queue(bridge))
    for lead_name, reader_name in (("Changed lead", "Changed reader"), ("lead", "reader")):
        with sessions() as db:
            db.execute(
                update(User.__table__)
                .where(User.id == bindparam("target_id"))
                .values(username=bindparam("new_name")),
                [
                    {"target_id": "lead", "new_name": lead_name},
                    {"target_id": "reader", "new_name": reader_name},
                ],
            )
            db.commit()
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project").data["executions"][-1]["planning_invalidated"]
    assert sync(bridge, intent)["stale"]
