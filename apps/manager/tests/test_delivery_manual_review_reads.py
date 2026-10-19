"""Manual review history never needs a current project proof or lifetime bodies."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sop_manager.routers import sql_models as m
from sop_manager.routers.delivery_manual_review import current_review
from sop_manager.routers.delivery_service import reconcile
from sop_manager.routers.delivery_verification import VerificationContext
from sqlalchemy import delete, insert, update
from sqlalchemy.orm import Session
from test_delivery_quality_scope import fixture, observed, seed  # noqa: F401
from test_delivery_workbench import env  # noqa: F401


def page(db, project, task_id="A", **options):
    from sop_manager.routers.delivery_manual_review_query import list_reviews

    return list_reviews(db, project, SimpleNamespace(id="lead"), task_id, **options)


def detail(db, project, task_id="A", id="manual-A"):
    from sop_manager.routers.delivery_manual_review_query import review_detail

    return review_detail(db, project, task_id, id)


def append(engine, id, task_id="A"):
    with engine.begin() as conn:
        conn.execute(
            insert(m.DeliveryTaskReview),
            {
                "id": id,
                "tenant_id": "tenant",
                "project_id": "project",
                "task_id": task_id,
                "reviewer_id": "lead",
                "reviewer_name": "Lead",
                "decision": "request_changes",
                "task_basis": "b" * 64,
                "snapshot": {"original": id},
                "comment": "审" * 300,
                "evidence_content": "original-evidence" * 50000,
            },
        )


def test_history_selects_only_small_columns_without_loading_full_project(fixture):  # noqa: F811
    seed(fixture, extras=1200)
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        from sop_manager.routers.delivery_manual_review_query import list_reviews

        with observed(db) as (sql, loaded):
            value = list_reviews(db, project, SimpleNamespace(id="lead"), "A", limit=2)
        assert not loaded
        assert "current" not in value and "version" not in value
        assert set(value["reviews"][0]) == {
            "id",
            "task_id",
            "decision",
            "created_at",
            "reviewer",
            "task_basis",
            "comment_summary",
            "has_evidence",
            "invalidated",
            "invalidated_at",
            "invalidated_reason",
            "source",
        }
        assert all("delivery_workspaces" not in query and "snapshot" not in query for query in sql)
        assert all(query.lstrip().upper().startswith("SELECT") for query in sql)


def test_history_summary_is_cut_in_sql_before_large_original_transfer(fixture):  # noqa: F811
    seed(fixture)
    append(fixture, "long-review")
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        with observed(db) as (sql, loaded):
            value = page(db, project, limit=1)
        row = value["reviews"][0]
        assert row["comment_summary"] == "审" * 240 and row["has_evidence"] is True
        assert not loaded and any("substr(" in query.lower() for query in sql)
        assert "evidence_content" not in row and "snapshot" not in row and "valid" not in row


def test_signed_history_window_is_fixed_and_bound_to_reader_task_project_and_limit(fixture):  # noqa: F811
    seed(fixture)
    append(fixture, "second")
    append(fixture, "third")
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        first = page(db, project, limit=2)
        assert [row["id"] for row in first["reviews"]] == ["third", "second"]
    append(fixture, "new")
    with Session(fixture) as db:
        from sop_manager.routers.delivery_manual_review_query import list_reviews

        project = db.get(m.Project, "project")
        second = page(db, project, limit=2, cursor=first["next_cursor"])
        assert second["total"] == first["total"] == 3
        assert [row["id"] for row in second["reviews"]] == ["manual-A"]
        assert second["next_cursor"] is None
        for chosen, reader, task, limit in [
            (project, "other", "A", 2),
            (project, "lead", "B", 2),
            (project, "lead", "A", 3),
            (db.get(m.Project, "other"), "lead", "A", 2),
            (SimpleNamespace(tenant_id="foreign", id="project"), "lead", "A", 2),
        ]:
            with pytest.raises(HTTPException) as denied:
                list_reviews(
                    db, chosen, SimpleNamespace(id=reader), task, limit=limit, cursor=first["next_cursor"]
                )
            assert denied.value.status_code == 422
        with pytest.raises(HTTPException) as denied:
            page(db, project, limit=2, cursor=first["next_cursor"] + "x")
        assert denied.value.status_code == 422


@pytest.mark.parametrize("damage", ["over_budget", "missing_requirement", "deleted_task", "missing_index"])
def test_history_and_exact_original_remain_readable_when_current_proof_cannot_load(fixture, damage):  # noqa: F811
    state = seed(fixture)
    with fixture.begin() as conn:
        if damage == "over_budget":
            state["task_details"]["B"] = {"huge": "x" * (1024 * 1024 + 1)}
            conn.execute(update(m.DeliveryWorkspace).values(data=state))
        elif damage == "missing_requirement":
            conn.execute(delete(m.Requirement).where(m.Requirement.id == "R"))
        elif damage == "deleted_task":
            conn.execute(delete(m.Task).where(m.Task.id == "A"))
        else:
            conn.execute(delete(m.DeliveryQueryState))
            conn.execute(delete(m.DeliveryQueryFact))
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        with observed(db) as (sql, loaded):
            history, original = page(db, project), detail(db, project)
        assert history["total"] == 1 and original["review"]["snapshot"]["task"]["title"] == "A"
        assert "valid" not in original["review"]
        assert not loaded and all(
            "delivery_workspaces" not in query and "delivery_query_" not in query for query in sql
        )
        from sop_manager.routers.delivery_manual_review_query import review_current

        with pytest.raises(HTTPException) as denied:
            review_current(db, project, "A", can_approve=True)
        assert (
            denied.value.status_code
            == {"over_budget": 413, "missing_requirement": 404, "deleted_task": 404, "missing_index": 409}[
                damage
            ]
        )


def test_exact_original_requires_matching_project_task_and_review(fixture):  # noqa: F811
    seed(fixture)
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        for chosen, task, id in [
            (project, "B", "manual-A"),
            (project, "A", "missing"),
            (db.get(m.Project, "other"), "A", "manual-A"),
            (SimpleNamespace(tenant_id="foreign", id="project"), "A", "manual-A"),
        ]:
            with pytest.raises(HTTPException) as denied:
                detail(db, chosen, task, id)
            assert denied.value.status_code == 404
        assert page(db, project, "B")["reviews"] == []
        with pytest.raises(HTTPException) as denied:
            page(db, project, "unknown")
        assert denied.value.status_code == 404


def test_linked_task_current_uses_complete_siblings_and_matches_full_canonical_basis(fixture):  # noqa: F811
    state = seed(fixture, extras=1200, sibling=True)
    with Session(fixture) as db:
        project = db.get(m.Project, "project")
        expected = current_review(
            VerificationContext(db, project, reconcile(db, project, state)), "B", can_approve=True
        )
    with Session(fixture) as db:
        from sop_manager.routers.delivery_manual_review_query import review_current

        project = db.get(m.Project, "project")
        with observed(db) as (sql, loaded):
            result = review_current(db, project, "B", can_approve=True)
        assert result["current"] == expected and result["query_generation"] > 0
        assert not any(kind == "DeliveryWorkspace" or id.startswith("unrelated-") for kind, id in loaded)
        assert all("delivery_workspaces.data \nFROM" not in query for query in sql)
        assert all(query.lstrip().upper().startswith("SELECT") for query in sql)


def test_latest_manual_snapshot_budget_is_checked_before_orm_transfer(fixture):  # noqa: F811
    seed(fixture)
    with fixture.begin() as conn:
        conn.execute(update(m.DeliveryTaskReview).values(snapshot={"huge": "x" * (1024 * 1024 + 1)}))
    with Session(fixture) as db:
        from sop_manager.routers.delivery_manual_review_query import review_current

        project = db.get(m.Project, "project")
        with observed(db) as (sql, loaded), pytest.raises(HTTPException) as denied:
            review_current(db, project, "A", can_approve=True)
        assert denied.value.status_code == 413
        assert not any(kind == "DeliveryTaskReview" for kind, _ in loaded)
        assert any("length(CAST(delivery_task_reviews.snapshot" in query for query in sql)
        with pytest.raises(HTTPException) as original_denied:
            detail(db, project)
        assert original_denied.value.status_code == 413
        assert page(db, project)["total"] == 1


def test_nullable_independent_parent_commits_and_keeps_canonical_null(env):  # noqa: F811
    client, sessions, _ = env
    with sessions() as db:
        db.add(
            m.Task(
                id="nullable-parent",
                tenant_id="tenant",
                project_id="project",
                title="Independent with no parent",
                req_id="",
                owner_id="user:lead",
                acceptance_criteria=["Explicit independent condition"],
            )
        )
        db.commit()
        db.get(m.Task, "nullable-parent").req_id = None
        db.commit()
        assert db.get(m.Task, "nullable-parent").req_id is None
        fact = (
            db.query(m.DeliveryQueryFact)
            .filter_by(tenant_id="tenant", project_id="project", kind="task", entity_id="nullable-parent")
            .one()
        )
        assert fact.parent_id == ""
    current = client.get("/api/v1/delivery/tasks/nullable-parent/review-current")
    assert current.status_code == 200, current.text
    assert current.json()["current"]["task"]["req_id"] == ""


@pytest.mark.parametrize("explicit_null", [True, False])
def test_explicit_null_task_plan_is_unavailable_while_absent_plan_keeps_defaults(fixture, explicit_null):  # noqa: F811
    state = seed(fixture)
    if explicit_null:
        state["task_details"]["A"] = None
    else:
        state["task_details"].pop("A")
    with fixture.begin() as conn:
        conn.execute(update(m.DeliveryWorkspace).values(data=state))
    with Session(fixture) as db:
        from sop_manager.routers.delivery_manual_review_query import review_current

        project = db.get(m.Project, "project")
        if explicit_null:
            with pytest.raises(HTTPException) as denied:
                review_current(db, project, "A", can_approve=True)
            assert denied.value.status_code == 409
            assert denied.value.detail["code"] == "quality_scope_unavailable"
        else:
            current = review_current(db, project, "A", can_approve=True)["current"]
            assert current["planning"]["depends_on"] == []
        assert page(db, project)["total"] == 1
        assert detail(db, project)["review"]["snapshot"]["planning"]["depends_on"] == ["B"]


@pytest.mark.parametrize("location", ["workspace", "task_details", "flows", "flow", "task"])
@pytest.mark.parametrize("invalid", [None, [], "invalid"])
def test_malformed_proof_containers_cannot_masquerade_as_missing_defaults(fixture, location, invalid):  # noqa: F811
    state = seed(fixture)
    if location == "workspace":
        state = invalid
    elif location == "flow":
        state["flows"]["R"] = invalid
    elif location == "task":
        state["task_details"]["A"] = invalid
    else:
        state[location] = invalid
    with fixture.begin() as conn:
        conn.execute(update(m.DeliveryWorkspace).values(data=state))
    with Session(fixture) as db:
        from sop_manager.routers.delivery_manual_review_query import review_current

        project = db.get(m.Project, "project")
        with observed(db) as (sql, _), pytest.raises(HTTPException) as denied:
            review_current(db, project, "A", can_approve=True)
        assert denied.value.status_code == 409
        assert denied.value.detail["code"] == "quality_scope_unavailable"
        assert all("delivery_workspaces.data \nFROM" not in query for query in sql)
        assert page(db, project)["total"] == 1
        assert detail(db, project)["review"]["snapshot"]["task"]["title"] == "A"


@pytest.mark.parametrize("missing", ["task_details", "flows", "flow"])
def test_missing_optional_proof_sources_keep_canonical_defaults(fixture, missing):  # noqa: F811
    state = seed(fixture)
    if missing == "flow":
        state["flows"].pop("R")
    else:
        state.pop(missing)
    with fixture.begin() as conn:
        conn.execute(update(m.DeliveryWorkspace).values(data=state))
    with Session(fixture) as db:
        from sop_manager.routers.delivery_manual_review_query import review_current

        project = db.get(m.Project, "project")
        current = review_current(db, project, "A", can_approve=True)["current"]
        assert current["task"]["id"] == "A"
