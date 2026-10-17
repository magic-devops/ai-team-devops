"""A real signed release candidate shares canonical proof with project evaluation."""

from sop_manager.routers.delivery_progress_facts import evaluate_project
from sop_manager.routers.sql_models import Project, User
from sqlalchemy import event
from test_delivery_release import create_candidate, env, import_ci, scope, trusted  # noqa: F401


def test_signed_candidate_reconciliation_does_not_reload_canonical_collections(trusted):  # noqa: F811
    sessions, data, key = trusted
    with sessions() as db:
        db.connection().exec_driver_sql("PRAGMA foreign_keys=ON")
        assert db.connection().exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        create_candidate(db, project, user, data, ci_id)
        statements = []

        def executed(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement.lower())

        event.listen(db.bind, "before_cursor_execute", executed)
        try:
            result = evaluate_project(db, project, state=data)
        finally:
            event.remove(db.bind, "before_cursor_execute", executed)
        assert not result.state["release_candidates"][0].get("invalidated")
        assert result.verification.requirement_accepted("R-release")
        for table in ("tasks", "requirements", "issues"):
            assert sum(f"from {table}\n" in sql or f"from {table} " in sql for sql in statements) == 1
