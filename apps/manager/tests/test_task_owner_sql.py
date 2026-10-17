"""Typed SQL writers cannot bypass scoped task responsibility validation."""

import pytest
from fastapi import HTTPException
from sqlalchemy import bindparam, insert, literal, select, update
from sop_manager.routers.sql_models import Task
from test_business_access import env as env


@pytest.mark.parametrize("mode", ["static", "bound", "batch", "insert", "orm", "scope", "expression"])
def test_typed_task_owner_writes_reject_invalid_final_identity_atomically(env, mode):
    _, sessions = env
    with sessions() as db:
        if mode == "scope":
            db.get(Task, "T-selected").owner_id = "user:product"
            db.commit()
        with pytest.raises((HTTPException, ValueError)):
            if mode == "static":
                db.execute(update(Task).where(Task.id == "T-selected").values(owner_id="user:missing"))
            elif mode == "bound":
                db.execute(update(Task.__table__).where(Task.id == bindparam("target")).values(owner_id=bindparam("owner")), {"target": "T-selected", "owner": "user:missing"})
            elif mode == "batch":
                db.execute(update(Task), [{"id": "T-selected", "owner_id": "user:writer"}, {"id": "T-other", "owner_id": "user:product"}])
            elif mode == "insert":
                db.execute(insert(Task), [{"id": "T-valid", "tenant_id": "team", "project_id": "selected", "owner_id": "user:writer"}, {"id": "T-invalid", "tenant_id": "team", "project_id": "selected", "owner_id": "user:missing"}])
            elif mode == "orm":
                db.get(Task, "T-selected").owner_id = "user:missing"
            elif mode == "scope":
                db.execute(update(Task).where(Task.id == "T-selected").values(project_id="other"))
            else:
                db.execute(update(Task).where(Task.id == "T-selected").values(owner_id=literal("user:writer") + literal("x")))
            db.commit()
        db.rollback()
        assert db.query(Task).count() == 2
        assert db.get(Task, "T-selected").project_id == "selected"
        assert db.get(Task, "T-selected").owner_id == ("user:product" if mode == "scope" else "")


def test_valid_bound_owner_batch_and_unrelated_write_after_owner_deactivation(env):
    _, sessions = env
    with sessions() as db:
        db.execute(update(Task.__table__).where(Task.id == bindparam("target")).values(owner_id=bindparam("owner")), [
            {"target": "T-selected", "owner": "user:product"},
            {"target": "T-other", "owner": "user:writer"},
        ])
        db.commit()
        from sop_manager.routers.sql_models import User
        db.get(User, "product").status = "disabled"
        db.commit()
        db.execute(update(Task).where(Task.id == "T-selected").values(title="Still editable"))
        db.commit()
        assert db.scalar(select(Task.owner_id).where(Task.id == "T-selected")) == "user:product"


@pytest.mark.parametrize("value", [None, True, 7, "x" * 101, " user:writer"])
def test_core_owner_id_has_the_same_strict_shape(env, value):
    _, sessions = env
    with sessions() as db:
        with pytest.raises((HTTPException, ValueError)):
            db.execute(update(Task).where(Task.id == "T-selected").values(owner_id=value))
            db.commit()
        db.rollback()
        assert db.get(Task, "T-selected").owner_id == ""
