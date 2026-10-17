"""Portfolio facts are current, scoped and counted before pagination."""

from copy import deepcopy
from datetime import datetime, timezone
from importlib import import_module

import pytest
from fastapi import HTTPException
from sop_manager.routers.delivery_service import initial_state
from sop_manager.routers.sql_models import DeliveryWorkspace, Issue, Project, Requirement, Task, User
from sqlalchemy import update
from test_delivery_manual_review import completed, review
from test_delivery_workbench import env as delivery_env

env = delivery_env


def query(sessions, **options):
    module = import_module("sop_manager.routers.project_portfolio")
    with sessions() as db:
        return module.portfolio(db, db.get(User, "lead"), **options)


def test_all_matching_projects_contribute_to_counts_before_risk_filter_and_pagination(env):
    _, sessions, _ = env
    with sessions() as db:
        for number in range(15):
            pid = f"portfolio-{number:02}"
            db.add(Project(id=pid, tenant_id="tenant", name=f"Portfolio {number:02}"))
            db.flush()
            db.add(
                Task(
                    id=f"task-{number:02}",
                    tenant_id="tenant",
                    project_id=pid,
                    title="Blocked work",
                    status="blocked",
                    owner_id="user:lead",
                    acceptance_criteria=["Works"],
                )
            )
        db.commit()
    first = query(sessions, q="Portfolio", risk=["blocked"], limit=5)
    assert first["total"] == first["summary"]["projects_total"] == 15
    assert first["summary"]["metrics"]["tasks_total"] == 15
    assert first["summary"]["risk_counts"]["blocked"] == 15
    assert first["summary_scope"] == "filtered_projects"
    assert [row["project"]["id"] for row in first["rows"]] == [f"portfolio-{n:02}" for n in range(5)]
    second = query(sessions, q="Portfolio", risk=["blocked"], cursor=first["next_cursor"], limit=5)
    assert second["total"] == 15
    assert [row["project"]["id"] for row in second["rows"]] == [f"portfolio-{n:02}" for n in range(5, 10)]
    with pytest.raises(HTTPException) as changed:
        query(sessions, q="Other", cursor=first["next_cursor"], limit=5)
    assert changed.value.status_code == 422


def test_risk_categories_overlap_but_entities_and_precise_targets_are_unique(env):
    _, sessions, _ = env
    with sessions() as db:
        db.add(
            Task(
                id="T/one?&",
                tenant_id="tenant",
                project_id="project",
                title="Needs definition",
                status="blocked",
            )
        )
        db.add(
            Issue(
                id="I/one?&",
                tenant_id="tenant",
                project_id="project",
                title="Actual issue",
                task_id="T/one?&",
                status="open",
            )
        )
        data = initial_state()
        data["task_details"]["T/one?&"] = {"ends_on": "2020-01-01"}
        db.add(DeliveryWorkspace(project_id="project", tenant_id="tenant", version=0, data=data))
        db.commit()
    module = import_module("sop_manager.routers.project_portfolio")
    with sessions() as db:
        detail = module.project_detail(db, db.get(User, "lead"), "project")
    assert detail["risk_counts"]["total_items"] == 2
    assert detail["risk_counts"]["blocked"] == 1
    assert detail["risk_counts"]["overdue_unverified"] == 1
    assert detail["risk_counts"]["acceptance_unavailable"] == 1
    assert detail["risk_counts"]["owner_unavailable"] == 1
    assert detail["risk_counts"]["open_issues"] == 1
    task, issue = sorted(detail["risks"], key=lambda item: item["entity_kind"], reverse=True)
    assert task["entity_id"] == "T/one?&"
    assert task["target"] == {
        "project_id": "project",
        "kind": "task",
        "view": "list",
        "requirement_id": None,
        "detail": "tasks",
        "task_id": "T/one?&",
    }
    assert issue["target"] == {
        "project_id": "project",
        "kind": "issue",
        "view": "issues",
        "detail": "details",
        "issue_id": "I/one?&",
    }


def test_portfolio_authorization_and_unknown_project_never_fall_back(env):
    _, sessions, _ = env
    module = import_module("sop_manager.routers.project_portfolio")
    with sessions() as db:
        user = db.get(User, "reader")
        value = module.portfolio(db, user)
        assert value["total"] == 1
        assert value["rows"][0]["project"]["id"] == "project"
        assert not value["rows"][0]["project"]["permissions"]["can_write"]
        with pytest.raises(HTTPException) as outside:
            module.project_detail(db, user, "other")
        assert outside.value.status_code in {403, 404}
        with pytest.raises(HTTPException) as missing:
            module.project_detail(db, user, "unknown")
        assert missing.value.status_code == 404


def test_project_search_matches_stable_id_as_well_as_current_name(env):
    _, sessions, _ = env
    result = query(sessions, q="project")
    assert result["total"] == 1
    assert result["rows"][0]["project"]["id"] == "project"


def test_archived_current_facts_do_not_reuse_historical_verified_counts(env):
    client, sessions, _ = env
    task = completed(client)
    assert review(client, task["id"]).status_code == 200
    module = import_module("sop_manager.routers.project_portfolio")
    with sessions() as db:
        data = deepcopy(db.get(DeliveryWorkspace, "project").data)
        current = module.project_facts(db, db.get(Project, "project"))
        archive_facts = {
            key: current[key]
            for key in ("as_of", "basis", "metrics", "risk_counts", "unclosed_intents_total")
        }
        data["lifecycle"] = {
            "last_archive": {
                "id": "archive-seed",
                "at": current["as_of"],
                "actor_id": "lead",
                "actor_name": "lead",
                "reason": "Archived delivery",
                "preview_basis": "a" * 64,
                "facts": archive_facts,
            }
        }
    # Seed an existing archived database, rather than invoking a prohibited business write.
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(Project).where(Project.id == "project").values(status="archived"))
        connection.execute(
            update(DeliveryWorkspace).where(DeliveryWorkspace.project_id == "project").values(data=data)
        )
    for state in ("suspended", "active"):
        with sessions() as db:
            db.get(User, "lead").status = state
            db.commit()
    with sessions() as db:
        result = module.project_detail(db, db.get(User, "lead"), "project")
    assert result["facts_source"] == "live"
    assert result["metrics"]["verified_completed"] == 0
    assert result["metrics"]["recorded_completed"] == 1
    assert result["lifecycle"]["last_archive"]["facts"]["metrics"]["verified_completed"] == 1


def test_nearest_milestone_uses_real_dates_and_missing_dates_do_not_create_overdue_work(env):
    _, sessions, _ = env
    with sessions() as db:
        data = initial_state()
        data["milestones"] = [
            {"id": "unknown", "title": "No dates"},
            {"id": "later", "title": "Later", "ends_on": "2026-12-01"},
            {"id": "near", "title": "Near", "starts_on": "2026-10-18", "ends_on": "2026-10-20"},
        ]
        db.add(DeliveryWorkspace(project_id="project", tenant_id="tenant", version=0, data=data))
        db.add(
            Task(
                id="without-date",
                tenant_id="tenant",
                project_id="project",
                title="No deadline",
                acceptance_criteria=["Works"],
                owner_id="user:lead",
            )
        )
        db.commit()
    module = import_module("sop_manager.routers.project_portfolio")
    with sessions() as db:
        result = module.project_facts(
            db, db.get(Project, "project"), as_of=datetime(2026, 10, 17, tzinfo=timezone.utc)
        )
    assert result["nearest_milestone"]["id"] == "near"
    assert result["risk_counts"]["overdue_unverified"] == 0


def test_requirement_block_and_real_deadline_share_one_risk_entity(env):
    _, sessions, _ = env
    with sessions() as db:
        db.add(
            Requirement(
                id="REQ/own?&",
                tenant_id="tenant",
                project_id="project",
                title="Blocked product",
                acceptance_criteria=["Works"],
            )
        )
        data = initial_state()
        from sop_manager.routers.delivery_contract import default_flow

        data["flows"]["REQ/own?&"] = {
            **default_flow(),
            "blocked_reason": "Waiting for a product decision",
            "due_on": "2020-01-01",
        }
        db.add(DeliveryWorkspace(project_id="project", tenant_id="tenant", version=0, data=data))
        db.commit()
    module = import_module("sop_manager.routers.project_portfolio")
    with sessions() as db:
        result = module.project_detail(db, db.get(User, "lead"), "project")
    assert result["risk_counts"]["total_items"] == 1
    assert result["risk_counts"]["blocked"] == result["risk_counts"]["overdue_unverified"] == 1
    item = result["risks"][0]
    assert item["entity_kind"] == "requirement" and item["entity_id"] == "REQ/own?&"
    assert item["categories"] == ["blocked", "overdue_unverified"]
    assert item["target"]["requirement_id"] == "REQ/own?&"
