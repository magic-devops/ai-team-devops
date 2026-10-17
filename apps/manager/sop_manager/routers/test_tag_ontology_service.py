from contextlib import contextmanager

import pytest
from fastapi import HTTPException

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import tag_service
from sop_manager.routers.sql_models import Business, Project, SessionLocal, Tenant


@contextmanager
def scoped_project(root, *, tenant="tenant-a", business="biz-a", project="project-a"):
    tokens = set_request_scope(
        tenant_id=tenant,
        project_id=project,
        project_path=root,
        tenant_code=tenant,
        business_code=business,
        project_code=project,
    )
    try:
        yield
    finally:
        reset_request_scope(tokens)


def ensure_sql_scope(tenant="tenant-a", business="biz-a", project="project-a"):
    db = SessionLocal()
    try:
        if not db.get(Tenant, tenant):
            db.add(Tenant(id=tenant, name=tenant, slug=tenant, plan="free", status="active"))
        if not db.get(Business, business):
            db.add(Business(id=business, tenant_id=tenant, name=business, description="test business"))
        if not db.get(Project, project):
            db.add(Project(id=project, tenant_id=tenant, business_id=business, name=project, project_path="", status="active"))
        db.commit()
    finally:
        db.close()


def test_tag_rule_evaluation_assigns_tag_with_explainable_trace(tmp_path):
    with scoped_project(tmp_path):
        entity = tag_service.create_entity(
            tag_service.EntityCreate(
                entity_type="customer",
                name="Customer",
                attributes={"primary_key": "customer_id", "owner": "ProfileOps"},
            )
        )
        tag = tag_service.create_tag(
            tag_service.TagCreate(
                name="High Value Customer",
                category="customer",
                value_type="boolean",
                owner="ProfileOps",
                applies_to=["customer"],
            )
        )
        rule = tag_service.create_rule(
            tag_service.RuleCreate(
                tag_id=tag["id"],
                entity_type="customer",
                condition={"field": "ltv", "operator": ">=", "value": 1000},
                output_value=True,
                priority=90,
            )
        )

        result = tag_service.evaluate_rules(
            tag_service.RuleEvaluateIn(entity_type="customer", sample={"customer_id": "c-1", "ltv": 1200})
        )

    assert result["entity_type"] == entity["entity_type"]
    assert result["matched_count"] == 1
    assert result["matches"][0]["tag_id"] == tag["id"]
    assert result["matches"][0]["rule_id"] == rule["id"]
    assert result["matches"][0]["trace"]["actual"] == 1200
    assert result["matches"][0]["assigned_value"] is True


def test_profile_build_creates_records_and_publish_contract(tmp_path):
    with scoped_project(tmp_path):
        entity = tag_service.create_entity(tag_service.EntityCreate(entity_type="agent", name="Agent Profile"))
        tag = tag_service.create_tag(
            tag_service.TagCreate(name="AI Ready", category="agent", value_type="boolean", applies_to=["agent"])
        )
        tag_service.create_rule(
            tag_service.RuleCreate(
                tag_id=tag["id"],
                entity_type="agent",
                condition={"field": "quality_score", "operator": ">=", "value": 80},
                output_value=True,
            )
        )

        build = tag_service.profile_build(
            tag_service.ProfileBuildIn(
                entity_type="agent",
                profile_name="Agent Readiness Profile",
                records=[
                    {"agent_id": "a-1", "quality_score": 92},
                    {"agent_id": "a-2", "quality_score": 55},
                ],
                publish=True,
            )
        )
        builds = tag_service.list_profile_builds(entity_type="agent")
        contract = tag_service.publish_contract(entity["id"])

    assert build["profile_name"] == "Agent Readiness Profile"
    assert build["records_total"] == 2
    assert build["tagged_records"] == 1
    assert build["status"] == "published"
    assert builds["total"] == 1
    assert contract["entity_id"] == entity["id"]
    assert contract["endpoint"] == f"/api/v1/tag-service/profiles/{entity['entity_type']}"
    assert "AI Ready" in contract["tags"]


def test_tag_ontology_service_is_scoped_by_project(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        tag = tag_service.create_tag(tag_service.TagCreate(name="Project A Tag", applies_to=["customer"]))
        tag_service.create_rule(
            tag_service.RuleCreate(tag_id=tag["id"], entity_type="customer", condition={"field": "tier", "operator": "==", "value": "gold"})
        )
        tag_service.create_entity(tag_service.EntityCreate(entity_type="customer", name="Customer"))
        tag_service.profile_build(tag_service.ProfileBuildIn(entity_type="customer", records=[{"tier": "gold"}]))

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        assert tag_service.list_tags()["items"] == []
        assert tag_service.list_rules()["items"] == []
        assert tag_service.get_ontology()["entities"] == []
        assert tag_service.list_profile_builds()["items"] == []
        with pytest.raises(HTTPException) as exc:
            tag_service.publish_contract(tag["id"])

    assert exc.value.status_code == 404


def test_tag_governance_tasks_preview_and_create(tmp_path):
    with scoped_project(tmp_path):
        ensure_sql_scope()
        entity = tag_service.create_entity(tag_service.EntityCreate(entity_type="customer", name="Customer Profile"))
        tag = tag_service.create_tag(tag_service.TagCreate(name="Lifecycle Segment", category="customer"))
        low_coverage = tag_service.profile_build(
            tag_service.ProfileBuildIn(entity_type="customer", profile_name="Customer Segment Build", records=[{"tier": "gold"}], publish=False)
        )

        preview = tag_service.tag_governance_tasks(
            tag_service.TagGovernanceTasksIn(ids=[tag["id"], entity["id"], low_coverage["id"]], dry_run=True, owner_id="")
        )
        created = tag_service.tag_governance_tasks(
            tag_service.TagGovernanceTasksIn(ids=[tag["id"], entity["id"], low_coverage["id"]], dry_run=False, owner_id="")
        )

    assert preview["dry_run"] is True
    assert preview["planned"] >= 5
    assert preview["created"] == []
    assert {item["source"] for item in preview["items"]} == {"tag_governance"}
    labels = {label for item in preview["items"] for label in item.get("labels", [])}
    assert {"missing-owner", "missing-entity-scope", "missing-rule", "missing-contract", "low-coverage"} & labels
    assert created["dry_run"] is False
    assert created["created_count"] == created["planned"]
    assert created["created_count"] >= 5
    assert all(item.get("source") == "tag_governance" for item in created["items"])


def test_tag_approval_review_can_publish_entity_contract(tmp_path):
    with scoped_project(tmp_path):
        entity = tag_service.create_entity(tag_service.EntityCreate(entity_type="customer", name="Customer Profile"))
        tag = tag_service.create_tag(
            tag_service.TagCreate(
                name="High Value",
                category="customer",
                owner="TagOps",
                applies_to=["customer"],
            )
        )
        tag_service.create_rule(
            tag_service.RuleCreate(
                tag_id=tag["id"],
                entity_type="customer",
                condition={"field": "ltv", "operator": ">=", "value": 1000},
                output_value=True,
            )
        )

        approval = tag_service.create_tag_approval(
            tag_service.TagApprovalCreateIn(
                target_type="entity",
                target_id=entity["id"],
                action="publish_contract",
                reason="publish customer tag contract",
            )
        )
        pending = tag_service.list_tag_approvals(status="pending")
        reviewed = tag_service.review_tag_approval(
            approval["id"],
            tag_service.TagApprovalReviewIn(status="approved", reviewer="Data Steward", note="contract ok"),
        )

    assert approval["status"] == "pending"
    assert pending["total"] == 1
    assert reviewed["status"] == "approved"
    assert reviewed["applied_result"]["entity_id"] == entity["id"]
    assert reviewed["applied_result"]["endpoint"] == "/api/v1/tag-service/profiles/customer"
    assert "High Value" in reviewed["applied_result"]["tags"]
