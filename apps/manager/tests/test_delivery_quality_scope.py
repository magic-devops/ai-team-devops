"""Exact scoped canonical proof and its real SQL/ORM read boundaries."""

from collections import Counter
from contextlib import contextmanager
from copy import deepcopy

import pytest
from fastapi import HTTPException
from sop_manager.routers import sql_models as m
from sop_manager.routers.delivery_contract import default_flow
from sop_manager.routers.delivery_progress_facts import evaluate_project
from sop_manager.routers.delivery_query_index import replace_from_evaluation
from sop_manager.routers.delivery_release import quality
from sop_manager.routers.delivery_service import initial_state, remember_basis
from sop_manager.routers.delivery_verification import VerificationContext
from sqlalchemy import create_engine, event, insert, update
from sqlalchemy.orm import Session


def load(db, project, **scope):
    from sop_manager.routers.delivery_quality_scope import load_quality_scope

    return load_quality_scope(db, project, **scope)


@pytest.fixture
def fixture():
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(insert(m.Tenant), {"id": "tenant", "name": "Tenant", "slug": "scoped-proof"})
        conn.execute(
            insert(m.User),
            {
                "id": "lead",
                "tenant_id": "tenant",
                "username": "Lead",
                "password_hash": "unusable",
                "role": "tenant_admin",
                "status": "active",
            },
        )
        conn.execute(
            insert(m.Project),
            [
                {"id": "project", "tenant_id": "tenant", "name": "Project"},
                {"id": "other", "tenant_id": "tenant", "name": "Other"},
            ],
        )
    yield engine
    engine.dispose()


def task(id, req="", status="completed", **fields):
    return {
        "id": id,
        "tenant_id": "tenant",
        "project_id": "project",
        "req_id": req,
        "title": id,
        "status": status,
        "owner_id": "user:lead",
        "acceptance_criteria": ["Explicit condition"],
        **fields,
    }


def seed(engine, *, extras=0, sibling=False):
    state = initial_state()
    state["flows"]["R"] = {
        **default_flow(),
        "stage": "release",
        "reviews": [
            {
                "stage": "acceptance",
                "revision": 1,
                "decision": "approved",
                "actor": "lead",
                "at": "2026-10-18T00:00:00Z",
            }
        ],
        "artifacts": [{"id": "test", "revision": 1, "kind": "test", "result": "passed", "source": "manual"}],
    }
    state["task_details"]["A"] = {"depends_on": ["B"]}
    with engine.begin() as conn:
        conn.execute(
            insert(m.Requirement),
            {
                "id": "R",
                "tenant_id": "tenant",
                "project_id": "project",
                "title": "Scope",
                "acceptance_criteria": ["Requirement condition"],
            },
        )
        conn.execute(insert(m.Task), [task("A"), task("B", "R")])
    with Session(engine) as db:
        project = db.get(m.Project, "project")
        remember_basis(db, project, state)
        context = VerificationContext(db, project, deepcopy(state))
        snapshot, basis = context.snapshot("A"), context.basis("A")
    with engine.begin() as conn:
        conn.execute(
            insert(m.DeliveryTaskReview),
            {
                "id": "manual-A",
                "tenant_id": "tenant",
                "project_id": "project",
                "task_id": "A",
                "reviewer_id": "lead",
                "reviewer_name": "Lead",
                "decision": "accept",
                "task_basis": basis,
                "snapshot": snapshot,
                "comment": "Actual original fixture",
            },
        )
        if sibling:
            conn.execute(insert(m.Task), task("C", "R", "pending"))
        if extras:
            conn.execute(insert(m.Task), [task(f"unrelated-{i}", status="pending") for i in range(extras)])
        conn.execute(
            insert(m.DeliveryWorkspace),
            {"tenant_id": "tenant", "project_id": "project", "version": 5, "data": state},
        )
    index(engine)
    return state


def index(engine):
    with Session(engine) as db:
        project = db.get(m.Project, "project")
        replace_from_evaluation(db, project, evaluate_project(db, project))
        db.commit()


@contextmanager
def observed(db):
    sql, loaded = [], Counter()

    def statement(conn, cursor, query, parameters, context, many):
        sql.append(query + "\n-- parameters " + repr(parameters))

    def entity(session, obj):
        loaded[(type(obj).__name__, getattr(obj, "id", ""))] += 1

    event.listen(db.bind, "before_cursor_execute", statement)
    event.listen(db, "loaded_as_persistent", entity)
    try:
        yield sql, loaded
    finally:
        event.remove(db.bind, "before_cursor_execute", statement)
        event.remove(db, "loaded_as_persistent", entity)


def expected(engine, selected):
    with Session(engine) as db:
        project = db.get(m.Project, "project")
        evaluation = evaluate_project(db, project)
        return quality(db, project, evaluation.state, **selected, verification=evaluation.verification)


def test_one_selected_task_matches_canonical_basis_without_unrelated_body_loads(fixture):
    seed(fixture, extras=1200)
    selected = {"requirement_ids": [], "task_ids": ["A"]}
    truth = expected(fixture, selected)
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        with observed(db) as (sql, loaded):
            context = load(db, project, **selected)
            value = quality(db, project, context.data, **selected, verification=context)
        assert set(context.tasks) == {"A", "B"}
        assert set(context.requirements) == {"R"}
        assert value["eligible"] == truth["eligible"] is True
        assert value["scope_basis"] == truth["scope_basis"]
        assert not any(kind == "Task" and id.startswith("unrelated-") for kind, id in loaded)
        assert not any(query.lstrip().lower().startswith(("insert", "update", "delete")) for query in sql)
        assert all("delivery_workspaces.data \nFROM" not in query for query in sql)


def test_predecessor_requirement_expands_complete_siblings_before_reconciliation(fixture):
    seed(fixture, sibling=True)
    selected = {"requirement_ids": [], "task_ids": ["A"]}
    truth = expected(fixture, selected)
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        context = load(db, project, **selected)
        value = quality(db, project, context.data, **selected, verification=context)
        assert set(context.tasks) == {"A", "B", "C"}
        assert context.data["flows"]["R"]["revision"] == 2
        assert not value["eligible"] and value["scope_basis"] == truth["scope_basis"]


def test_task_budget_is_checked_before_loading_requirement_task_bodies(fixture):
    seed(fixture)
    with fixture.begin() as conn:
        conn.execute(insert(m.Task), [task(f"sibling-{i}", "R") for i in range(20)])
    index(fixture)
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        with observed(db) as (_, loaded), pytest.raises(HTTPException) as denied:
            load(db, project, requirement_ids=["R"], task_ids=[], task_limit=3)
        assert denied.value.status_code == 413
        assert denied.value.detail["code"] == "quality_scope_too_large"
        assert not any(kind == "Task" for kind, _ in loaded)


@pytest.mark.parametrize(
    "selection,status",
    [
        ({}, 422),
        ({"task_ids": ["missing"]}, 404),
        ({"requirement_ids": ["missing"]}, 404),
        ({"task_ids": ["B"]}, 422),
        ({"task_ids": ["A", "A"]}, 422),
    ],
)
def test_scope_is_explicit_and_matches_original_selection_guards(fixture, selection, status):
    seed(fixture)
    with Session(fixture) as db, pytest.raises(HTTPException) as denied:
        load(
            db,
            db.get(m.Project, "project"),
            requirement_ids=selection.get("requirement_ids", []),
            task_ids=selection.get("task_ids", []),
        )
    assert denied.value.status_code == status


def test_foreign_dependency_is_not_loaded_or_assumed_verified(fixture):
    seed(fixture)
    with fixture.begin() as conn:
        conn.execute(update(m.Task).where(m.Task.id == "B").values(project_id="other"))
    with Session(fixture) as db, pytest.raises(HTTPException) as denied:
        load(db, db.get(m.Project, "project"), requirement_ids=[], task_ids=["A"])
    assert denied.value.status_code == 404


def test_current_owner_revocation_is_checked_even_if_query_facts_are_unchanged(fixture):
    seed(fixture)
    with fixture.begin() as conn:
        conn.execute(update(m.User).where(m.User.id == "lead").values(status="suspended"))
    selected = {"requirement_ids": [], "task_ids": ["A"]}
    truth = expected(fixture, selected)
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        context = load(db, project, **selected)
        value = quality(db, project, context.data, **selected, verification=context)
        assert not context.owner(context.tasks["A"])["available"]
        assert not value["eligible"] and value["scope_basis"] == truth["scope_basis"]


def native_quality_entry(entry):
    """Explicit canonical proof fixture; no process execution is claimed here."""
    from hermes_core.managed_test_quality import evidence_binding, make_test_plan, test_quality as evaluate_quality
    from hermes_core.models import Node

    node = Node(id="tests", argv=["python", "-m", "pytest"]).model_dump()
    plan = make_test_plan([node], ["tests"])
    results = {"tests": {"succeeded": True, "exit_code": 0, "expected_exit_code": 0, "attempt": 1,
                         "evidence_binding": evidence_binding(entry["run_id"], node, 1)}}
    entry.update(nodes=[node], agent_id="", test_node_ids=["tests"], test_plan=plan, results=results, attempt=1)
    entry["review"]["quality"] = evaluate_quality({"id": entry["run_id"], "version": entry["run_version"],
        "status": "completed", "data": {"nodes": [node], "node_results": results, "managed_execution_id": entry["id"], "attempt": 1}}, plan)
    return entry


@pytest.mark.parametrize("with_quality", [False, True])
def test_native_latest_entry_and_exact_snapshot_change_match_canonical(fixture, with_quality):
    seed(fixture)
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        state = deepcopy(db.get(m.DeliveryWorkspace, "project").data)
        original = VerificationContext(db, project, state)
        entry = {
            "id": "E-A",
            "task_id": "A",
            "workspace_id": "runtime",
            "status": "accepted",
            "run_id": "run-A",
            "run_version": 2,
            "stale": False,
            "planning_invalidated": False,
            "snapshot": original.definition("A")["snapshot"],
            "review": {
                "decision": "accept",
                "run_version": 2,
                "evidence_sha256": "a" * 64,
                "actor": "lead",
                "at": "2026-10-18T00:00:00Z",
            },
        }
        state["executions"] = [native_quality_entry(entry) if with_quality else entry]
    with fixture.begin() as conn:
        conn.execute(update(m.DeliveryWorkspace).values(data=state))
    index(fixture)
    selected = {"requirement_ids": [], "task_ids": ["A"]}
    for changed in (False, True):
        if changed:
            with fixture.begin() as conn:
                conn.execute(update(m.Task).where(m.Task.id == "A").values(description="Canonical changed"))
        truth = expected(fixture, selected)
        with Session(fixture) as db:
            project = db.get(m.Project, "project")
            context = load(db, project, **selected)
            result = quality(db, project, context.data, **selected, verification=context)
            assert result["scope_basis"] == truth["scope_basis"]
            assert result["eligible"] is (with_quality and not changed)
            assert set(context.executions) == {"A"}


def test_scope_never_fetches_the_selected_flow_lifetime_histories(fixture):
    state = seed(fixture)
    state["flows"]["R"]["artifacts"] += [
        {
            "id": f"old-{i}",
            "revision": 0,
            "kind": "test",
            "result": "failed",
            "content": "UNRELATED LIFETIME ARTIFACT " * 200,
        }
        for i in range(120)
    ]
    state["flows"]["R"]["reviews"] += [
        {
            "stage": "acceptance",
            "revision": 0,
            "decision": "approved",
            "actor": "old",
            "at": "2020-01-01T00:00:00Z",
            "comment": "UNRELATED LIFETIME REVIEW " * 200,
        }
        for _ in range(120)
    ]
    state["flows"]["R"]["releases"] = [
        {"version": str(i), "notes": "UNRELATED LIFETIME RELEASE " * 200} for i in range(120)
    ]
    with fixture.begin() as conn:
        conn.execute(update(m.DeliveryWorkspace).values(data=state))
    index(fixture)
    truth = expected(fixture, {"requirement_ids": [], "task_ids": ["A"]})
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        with observed(db) as (sql, _):
            context = load(db, project, requirement_ids=[], task_ids=["A"])
            result = quality(db, project, context.data, task_ids=["A"], verification=context)
        assert result["scope_basis"] == truth["scope_basis"]
        assert not any(
            "JSON_EXTRACT" in query and '\'$"flows"."R"\''.replace("$", "$.") in query
            for query in sql
        )
        assert "releases" not in context.data["flows"]["R"]
        assert len(context.data["flows"]["R"]["artifacts"]) == len(context.data["flows"]["R"]["reviews"]) == 1


def test_long_recursive_dependency_proof_is_explicitly_incomplete(fixture):
    state = seed(fixture)
    chain = [task(f"chain-{i:03}") for i in range(100)]
    state["task_details"]["A"] = {"depends_on": ["chain-000"]}
    for i in range(99):
        state["task_details"][f"chain-{i:03}"] = {"depends_on": [f"chain-{i + 1:03}"]}
    with fixture.begin() as conn:
        conn.execute(insert(m.Task), chain)
        conn.execute(update(m.DeliveryWorkspace).values(data=state))
    index(fixture)
    with Session(fixture) as db, pytest.raises(HTTPException) as denied:
        load(db, db.get(m.Project, "project"), requirement_ids=[], task_ids=["A"])
    assert denied.value.status_code == 413
    assert denied.value.detail["code"] == "quality_scope_too_large"


def test_explicit_null_planning_is_not_silently_replaced_with_valid_defaults(fixture):
    state = seed(fixture)
    state["task_details"]["B"] = {"requirement_criteria_indices": None}
    with fixture.begin() as conn:
        conn.execute(update(m.DeliveryWorkspace).values(data=state))
    selected = {"requirement_ids": [], "task_ids": ["A"]}
    truth = expected(fixture, selected)
    assert truth["eligible"] is False
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        context = load(db, project, **selected)
        result = quality(db, project, context.data, **selected, verification=context)
        assert result["eligible"] is False
        assert result["scope_basis"] == truth["scope_basis"]


def test_explicit_null_stored_work_hash_does_not_masquerade_as_missing_legacy_basis(fixture):
    state = seed(fixture)
    state["flows"]["R"]["tested_work"] = None
    with fixture.begin() as conn:
        conn.execute(update(m.DeliveryWorkspace).values(data=state))
    selected = {"requirement_ids": [], "task_ids": ["A"]}
    truth = expected(fixture, selected)
    assert truth["eligible"] is False
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        context = load(db, project, **selected)
        result = quality(db, project, context.data, **selected, verification=context)
        assert result["eligible"] is False
        assert result["scope_basis"] == truth["scope_basis"]


def test_selected_source_byte_budget_is_checked_in_sql_before_transfer(fixture):
    state = seed(fixture)
    state["task_details"]["B"] = {"large_ignored_payload": "x" * (1024 * 1024 + 1)}
    with fixture.begin() as conn:
        conn.execute(update(m.DeliveryWorkspace).values(data=state))
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        with observed(db) as (sql, _), pytest.raises(HTTPException) as denied:
            load(db, project, requirement_ids=[], task_ids=["A"])
        assert denied.value.status_code == 413
        assert denied.value.detail["code"] == "quality_scope_too_large"
        assert any("length(CAST" in statement for statement in sql)


def test_runtime_test_artifact_uses_original_run_and_latest_sibling_execution(fixture):
    state = seed(fixture)
    with Session(fixture) as db:
        definition = VerificationContext(db, db.get(m.Project, "project"), state).definition("B")["snapshot"]

    def execution(id, run):
        return native_quality_entry({
            "id": id,
            "task_id": "B",
            "workspace_id": "runtime",
            "status": "accepted",
            "run_id": run,
            "run_version": 1,
            "stale": False,
            "snapshot": definition,
            "review": {
                "decision": "accept",
                "run_version": 1,
                "evidence_sha256": "c" * 64,
                "actor": "lead",
                "at": "2026-10-18T00:00:00Z",
            },
        })

    state["executions"] = [execution("old-E", "old-run"), execution("current-E", "current-run")]
    state["flows"]["R"]["artifacts"] = [
        {
            "id": "test",
            "revision": 1,
            "kind": "test",
            "result": "passed",
            "source": "execution-runtime",
            "run_id": "old-run",
        }
    ]
    with fixture.begin() as conn:
        conn.execute(update(m.DeliveryWorkspace).values(data=state))
    index(fixture)
    selected = {"requirement_ids": ["R"], "task_ids": []}
    truth = expected(fixture, selected)
    assert truth["eligible"] is False
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        context = load(db, project, **selected)
        result = quality(db, project, context.data, **selected, verification=context)
        assert [entry["id"] for entry in context.data["executions"]] == ["old-E", "current-E"]
        assert context.executions["B"]["id"] == "current-E"
        assert context.data["flows"]["R"]["artifacts"][0]["stale"] is True
        assert result["eligible"] is False and result["scope_basis"] == truth["scope_basis"]


@pytest.mark.parametrize("duplicate", [False, True])
def test_agent_registry_uses_exact_original_positions_including_duplicate_identity(fixture, duplicate):
    state = seed(fixture)
    state["members"] = [
        {"id": f"unrelated-agent-{i}", "name": str(i), "kind": "agent", "active": True} for i in range(500)
    ]
    state["members"].append({"id": "agent-A", "name": "Original agent", "kind": "agent", "active": True})
    with fixture.begin() as conn:
        conn.execute(update(m.Task).where(m.Task.id == "A").values(owner_id="agent-A"))
    with Session(fixture) as db:
        context = VerificationContext(db, db.get(m.Project, "project"), state)
        snapshot, basis = context.snapshot("A"), context.basis("A")
    if duplicate:
        state["members"].append(
            {"id": "agent-A", "name": "Conflicting agent", "kind": "agent", "active": True}
        )
    with fixture.begin() as conn:
        conn.execute(update(m.DeliveryTaskReview).values(snapshot=snapshot, task_basis=basis))
        conn.execute(update(m.DeliveryWorkspace).values(data=state))
    index(fixture)
    selected = {"requirement_ids": [], "task_ids": ["A"]}
    truth = expected(fixture, selected)
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        with observed(db) as (sql, _):
            context = load(db, project, **selected)
            result = quality(db, project, context.data, **selected, verification=context)
        assert len(context.data["members"]) == (2 if duplicate else 1)
        assert context.owner(context.tasks["A"])["available"] is (not duplicate)
        assert result["scope_basis"] == truth["scope_basis"]
        assert not any("'$.\"members\"'" in query for query in sql)
