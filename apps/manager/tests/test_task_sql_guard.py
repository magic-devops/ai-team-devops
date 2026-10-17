"""Typed SQL writers cannot bypass the canonical Task acceptance contract."""

import pytest
from fastapi import HTTPException
from sop_manager.routers.sql_models import Base, Project, Task, Tenant
from sqlalchemy import bindparam, create_engine, func, insert, select, update
from sqlalchemy.exc import StatementError
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def sessions():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        db.add(Tenant(id="guard", name="Guard", slug="guard"))
        db.flush()
        db.add(Project(id="guard", tenant_id="guard", name="Guard"))
        db.flush()
        db.add_all([Task(id="T-one", tenant_id="guard", project_id="guard", title="One", acceptance_criteria=["Original one"]),
                    Task(id="T-two", tenant_id="guard", project_id="guard", title="Two", acceptance_criteria=["Original two"])])
        db.commit()
    yield sessions
    engine.dispose()


def row(task_id, criteria):
    return {"id": task_id, "tenant_id": "guard", "project_id": "guard", "title": task_id, "acceptance_criteria": criteria}


def write(db, mode, criteria):
    if mode == "static_update":
        db.execute(update(Task).where(Task.id == "T-one").values(acceptance_criteria=criteria))
    elif mode == "bound_update":
        db.execute(update(Task).where(Task.id == "T-one").values(acceptance_criteria=bindparam("criteria")), {"criteria": criteria})
    elif mode == "orm_bulk_update":
        db.execute(update(Task), [{"id": "T-one", "acceptance_criteria": ["First updated"]}, {"id": "T-two", "acceptance_criteria": criteria}])
    elif mode == "core_bulk_update":
        db.execute(update(Task.__table__).where(Task.id == bindparam("task_id")),
                   [{"task_id": "T-one", "acceptance_criteria": ["First updated"]}, {"task_id": "T-two", "acceptance_criteria": criteria}])
    elif mode == "static_insert":
        db.execute(insert(Task).values(**row("T-inserted", criteria)))
    elif mode == "bound_insert":
        db.execute(insert(Task).values(**row("T-inserted", bindparam("criteria"))), {"criteria": criteria})
    elif mode == "orm_bulk_insert":
        db.execute(insert(Task), [row("T-first", ["First inserted"]), row("T-inserted", criteria)])
    elif mode == "multirow_insert":
        db.execute(insert(Task.__table__).values([row("T-first", ["First inserted"]), row("T-inserted", criteria)]))


@pytest.mark.parametrize("mode", ["static_update", "bound_update", "orm_bulk_update", "core_bulk_update", "static_insert", "bound_insert", "orm_bulk_insert", "multirow_insert"])
@pytest.mark.parametrize("criteria", [[0], [True], None])
def test_invalid_typed_sql_write_is_rejected_before_any_task_change(sessions, mode, criteria):
    with sessions() as db:
        with pytest.raises(ValueError, match="acceptance_criteria"):
            write(db, mode, criteria)
        db.rollback()
    with sessions() as db:
        assert db.execute(select(Task.id, Task.acceptance_criteria).order_by(Task.id)).all() == [
            ("T-one", ["Original one"]), ("T-two", ["Original two"]),
        ]


@pytest.mark.parametrize("mode", ["static_update", "bound_update", "orm_bulk_update", "core_bulk_update", "static_insert", "bound_insert", "orm_bulk_insert", "multirow_insert"])
def test_typed_sql_writer_normalizes_text_and_preserves_empty_list(sessions, mode):
    with sessions() as db:
        write(db, mode, ["  Verified output  "])
        db.commit()
    target = "T-inserted" if "insert" in mode else "T-two" if "bulk" in mode else "T-one"
    with sessions() as db:
        assert db.get(Task, target).acceptance_criteria == ["Verified output"]
        db.execute(update(Task).where(Task.id == target).values(acceptance_criteria=[]))
        db.commit()
        assert db.get(Task, target).acceptance_criteria == []


def test_unverifiable_task_criteria_expression_is_rejected_but_other_updates_work(sessions):
    with sessions() as db:
        with pytest.raises(ValueError, match="acceptance_criteria.*expression"):
            db.execute(update(Task).where(Task.id == "T-one").values(acceptance_criteria=func.json_array(0)))
        db.rollback()
        db.execute(update(Task).where(Task.id == "T-one").values(title=func.upper(Task.title)))
        db.commit()
        task = db.get(Task, "T-one")
        assert (task.title, task.acceptance_criteria) == ("ONE", ["Original one"])


def test_bound_criteria_inputs_are_not_mutated_and_insert_default_remains_empty(sessions):
    parameters = {"criteria": ["  Bound criterion  "]}
    with sessions() as db:
        db.execute(update(Task).where(Task.id == "T-one").values(acceptance_criteria=bindparam("criteria")), parameters)
        db.execute(insert(Task).values(id="T-empty", tenant_id="guard", project_id="guard", title="Empty"))
        db.commit()
        assert db.get(Task, "T-one").acceptance_criteria == ["Bound criterion"]
        assert db.get(Task, "T-empty").acceptance_criteria == []
    assert parameters == {"criteria": ["  Bound criterion  "]}


@pytest.mark.parametrize("mode", ["insert", "update", "connection"])
@pytest.mark.parametrize("criteria", [[0], None])
def test_typed_bind_fallback_rejects_legacy_bulk_and_connection_writes(sessions, mode, criteria):
    with sessions() as db:
        with pytest.raises(StatementError, match="acceptance_criteria"):
            if mode == "insert":
                db.bulk_insert_mappings(Task, [row("T-legacy", criteria)])
            elif mode == "update":
                db.bulk_update_mappings(Task, [{"id": "T-one", "acceptance_criteria": criteria}])
            else:
                db.connection().execute(update(Task).where(Task.id == "T-one").values(acceptance_criteria=criteria))
        db.rollback()
        assert db.get(Task, "T-one").acceptance_criteria == ["Original one"]


def test_insert_select_and_upsert_cannot_hide_invalid_criteria_expressions(sessions):
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert

    with sessions() as db:
        with pytest.raises(HTTPException) as raised:
            db.execute(insert(Task).from_select(["id", "tenant_id", "project_id", "title", "acceptance_criteria"],
                       select(Task.id, Task.tenant_id, Task.project_id, Task.title, func.json_array(0))))
        assert raised.value.status_code == 422
        assert raised.value.detail["code"] == "project_sql_scope_unproven"
        statement = sqlite_insert(Task).values(**row("T-one", ["Valid insert"]))
        with pytest.raises(HTTPException) as raised:
            db.execute(statement.on_conflict_do_update(index_elements=[Task.id], set_={"acceptance_criteria": func.json_array(0)}))
        assert raised.value.detail["code"] == "project_sql_scope_unproven"
        db.rollback()
        assert db.get(Task, "T-one").acceptance_criteria == ["Original one"]


def test_acceptance_guard_itself_still_rejects_expressions_in_unsupported_sql_forms():
    """The project guard must not hide a regression in the intrinsic AC guard."""
    from types import SimpleNamespace

    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    from sop_manager.task_sql_guard import _validate_task_write

    bad_select = insert(Task).from_select(
        ["id", "tenant_id", "project_id", "title", "acceptance_criteria"],
        select(Task.id, Task.tenant_id, Task.project_id, Task.title, func.json_array(0)),
    )
    bad_upsert = sqlite_insert(Task).values(**row("T-one", ["Valid insert"]))
    bad_upsert = bad_upsert.on_conflict_do_update(
        index_elements=[Task.id], set_={"acceptance_criteria": func.json_array(0)},
    )
    for statement in (bad_select, bad_upsert):
        state = SimpleNamespace(is_insert=True, is_update=False, statement=statement, parameters=None)
        with pytest.raises(ValueError, match="acceptance_criteria.*expression"):
            _validate_task_write(state)


def test_normalized_criteria_are_visible_to_same_transaction_progress_observers(sessions):
    with sessions() as db:
        task = db.get(Task, "T-one")
        db.execute(update(Task).where(Task.id == task.id).values(acceptance_criteria=[" Trim before observation "]))
        assert task.acceptance_criteria == ["Trim before observation"]
        db.commit()


def test_rejected_batch_does_not_partially_write_even_if_caller_commits_other_work(sessions):
    with sessions() as db:
        project = db.get(Project, "guard")
        project.name = "Other permitted work"
        with pytest.raises(ValueError, match="acceptance_criteria"):
            write(db, "orm_bulk_update", [0])
        db.commit()
    with sessions() as db:
        assert db.get(Project, "guard").name == "Other permitted work"
        assert db.get(Task, "T-one").acceptance_criteria == ["Original one"]
        assert db.get(Task, "T-two").acceptance_criteria == ["Original two"]


def test_conflict_writes_are_explicitly_rejected_and_bound_default_remains_usable(sessions):
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert

    with sessions() as db:
        statement = sqlite_insert(Task).values(**row("T-one", ["Unused insert condition"]))
        with pytest.raises(HTTPException) as raised:
            db.execute(statement.on_conflict_do_update(index_elements=[Task.id], set_={"title": "Renamed"}))
        assert raised.value.detail["code"] == "project_sql_scope_unproven"
        statement = sqlite_insert(Task).values(**row("T-two", ["Unused insert condition"]))
        with pytest.raises(HTTPException) as raised:
            db.execute(statement.on_conflict_do_update(index_elements=[Task.id], set_={"acceptance_criteria": ["  Verified upsert  "]}))
        assert raised.value.detail["code"] == "project_sql_scope_unproven"
        db.execute(update(Task).where(Task.id == "T-one").values(acceptance_criteria=bindparam("criteria", value=["  Verified default  "])))
        db.commit()
        assert db.get(Task, "T-one").title == "One"
        assert db.get(Task, "T-one").acceptance_criteria == ["Verified default"]
        assert db.get(Task, "T-two").acceptance_criteria == ["Original two"]
