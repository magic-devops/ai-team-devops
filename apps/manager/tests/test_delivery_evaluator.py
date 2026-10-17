"""One canonical evaluation shares proof while bounding per-requirement work."""

import pytest
from sop_manager.routers import delivery_progress_facts as facts_module
from sop_manager.routers.delivery_contract import default_flow
from sop_manager.routers.delivery_service import initial_state
from sop_manager.routers.sql_models import (
    Base,
    DeliveryWorkspace,
    Project,
    Requirement,
    Task,
    Tenant,
    _configure_sqlite,
)
from sqlalchemy import create_engine, event, insert
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def evaluation_db():
    engine = create_engine("sqlite://")
    event.listen(engine, "connect", _configure_sqlite)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(insert(Tenant), [{"id": "eval-tenant", "name": "Eval", "slug": "eval"}])
        conn.execute(insert(Project), [
            {"id": "eval-project", "tenant_id": "eval-tenant", "name": "Eval"},
            {"id": "other-project", "tenant_id": "eval-tenant", "name": "Other"},
        ])
    with sessionmaker(bind=engine)() as db:
        yield db
    engine.dispose()


def evaluator():
    value = getattr(facts_module, "evaluate_project", None)
    assert callable(value), "The project needs one shared canonical evaluation"
    return value


def seed(db, count=40):
    state = initial_state()
    for index in range(count):
        rid = f"REQ-{index}"
        state["flows"][rid] = default_flow()
    db.execute(insert(Requirement), [
        {"id": f"REQ-{index}", "tenant_id": "eval-tenant", "project_id": "eval-project", "title": str(index), "acceptance_criteria": ["Requirement condition"]}
        for index in range(count)
    ])
    db.execute(insert(Task), [
        {"id": f"T-{index}", "tenant_id": "eval-tenant", "project_id": "eval-project", "req_id": f"REQ-{index}", "title": str(index), "acceptance_criteria": ["Task condition"], "status": "completed" if index % 2 else "pending"}
        for index in range(count)
    ])
    db.add(DeliveryWorkspace(project_id="eval-project", tenant_id="eval-tenant", version=1, data=state))
    db.commit()


def test_evaluation_loads_each_canonical_collection_once_and_shares_task_proof(evaluation_db):
    db = evaluation_db
    seed(db)
    statements = []

    def executed(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())

    event.listen(db.bind, "before_cursor_execute", executed)
    try:
        result = evaluator()(db, db.get(Project, "eval-project"))
    finally:
        event.remove(db.bind, "before_cursor_execute", executed)
    for table in ("tasks", "requirements", "issues"):
        assert sum(f"from {table}\n" in sql or f"from {table} " in sql for sql in statements) == 1
    assert len(result.facts["tasks"]) == 40
    assert result.verification.data is result.state
    assert result.snapshot["tasks"][0]["basis"] == result.verification.basis(result.snapshot["tasks"][0]["id"])
    assert all(result.verification.basis(task["id"]) != task["basis"] for task in result.facts["tasks"])
    assert not db.new and not db.dirty and not db.deleted


def test_requirement_gates_only_receive_their_own_task_scope(evaluation_db, monkeypatch):
    from sop_manager.routers import delivery_service

    db = evaluation_db
    seed(db)
    original = delivery_service.stage_gates
    sizes = []

    def checked(requirement, flow, tasks, issues, **kwargs):
        sizes.append(len(tasks))
        return original(requirement, flow, tasks, issues, **kwargs)

    monkeypatch.setattr(delivery_service, "stage_gates", checked)
    evaluator()(db, db.get(Project, "eval-project"))
    assert sizes == [1] * 40


def test_empty_and_other_project_rows_do_not_enter_effective_metrics(evaluation_db):
    db = evaluation_db
    db.execute(insert(Task), [{"id": "T-outside", "tenant_id": "eval-tenant", "project_id": "other-project", "title": "Other"}])
    db.commit()
    result = evaluator()(db, db.get(Project, "eval-project"))
    assert facts_module.select_scope(result.facts)["metrics"]["tasks_total"] == 0
    assert result.snapshot["requirements"] == []
    assert result.state == initial_state()


def test_recorded_completion_stays_distinct_and_caller_state_is_not_mutated(evaluation_db):
    db = evaluation_db
    seed(db, 2)
    state = initial_state()
    state["task_details"] = {"T-0": {"blocked_reason": "Waiting for approval"}}
    result = evaluator()(db, db.get(Project, "eval-project"), state=state)
    selected = facts_module.select_scope(result.facts)
    assert selected["metrics"]["status_counts"]["blocked"] == 1
    assert selected["metrics"]["recorded_completed"] == 1
    assert selected["metrics"]["verified_completed"] == 0
    assert result.snapshot["summary"]["tasks_done"] == 0
    assert result.snapshot["summary"]["recorded_completed"] == 1
    assert next(row for row in result.snapshot["requirements"] if row["id"] == "REQ-1")["tasks_done"] == 0
    assert state == {**initial_state(), "task_details": {"T-0": {"blocked_reason": "Waiting for approval"}}}


def test_observer_can_reuse_context_after_manual_review_invalidation(evaluation_db):
    from sop_manager.routers.delivery_manual_review import invalidate_reviews
    from sop_manager.routers.delivery_verification import VerificationContext

    db = evaluation_db
    seed(db, 2)
    project = db.get(Project, "eval-project")
    state = initial_state()
    verification = VerificationContext(db, project, state)
    statements = []

    def executed(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())

    event.listen(db.bind, "before_cursor_execute", executed)
    try:
        invalidate_reviews(db, project, verification=verification)
        result = evaluator()(db, project, state=state, verification=verification)
    finally:
        event.remove(db.bind, "before_cursor_execute", executed)
    assert result.verification is verification
    assert not any(f"from {table}\n" in sql or f"from {table} " in sql for table in ("tasks", "requirements", "issues") for sql in statements)
