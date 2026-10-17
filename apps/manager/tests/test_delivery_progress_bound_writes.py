"""Bound SQL batches keep exact progress scopes and native owner invalidation."""

# ruff: noqa: F811 - shared pytest fixtures are imported and injected by name.

import pytest
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


@pytest.mark.parametrize(
    "field,values,invalidated",
    [
        ("username", (("Changed lead", "Changed reader"), ("lead", "reader")), False),
        ("status", (("suspended", "suspended"), ("active", "active")), True),
    ],
)
def test_bound_core_user_batch_preserves_renamed_receipts_but_invalidates_disable_restore(
    bridge, field, values, invalidated
):
    _, sessions, _, _, _, _, _ = bridge
    intent = sync(bridge, queue(bridge))
    original_snapshot = intent["snapshot"]
    for lead_value, reader_value in values:
        with sessions() as db:
            db.execute(
                update(User.__table__)
                .where(User.id == bindparam("target_id"))
                .values(**{field: bindparam("new_value")}),
                [
                    {"target_id": "lead", "new_value": lead_value},
                    {"target_id": "reader", "new_value": reader_value},
                ],
            )
            db.commit()
            entry = db.get(DeliveryWorkspace, "project").data["executions"][-1]
            assert bool(entry.get("planning_invalidated")) is invalidated
            assert entry["snapshot"] == original_snapshot
            assert db.get(Task, entry["task_id"]).owner_id == "user:lead"
            assert getattr(db.get(User, "lead"), field) == lead_value
    assert sync(bridge, intent)["stale"] is invalidated
