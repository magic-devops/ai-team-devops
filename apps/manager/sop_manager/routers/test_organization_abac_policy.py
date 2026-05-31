from contextlib import contextmanager

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import organization
from sop_manager.routers.sql_models import User


@contextmanager
def _scope(tmp_path, project_id: str = "proj-abac"):
    tokens = set_request_scope(
        "tenant-abac",
        project_id,
        tmp_path,
        tenant_code="tenant-abac",
        business_code="biz-abac",
        project_code=project_id,
    )
    try:
        yield
    finally:
        reset_request_scope(tokens)


def _admin() -> User:
    return User(id="u-admin", tenant_id="tenant-abac", username="admin", email="admin@example.com", password_hash="x", role="tenant_admin", status="active")


def test_abac_policy_masks_fields_and_denies_rows_with_audit(tmp_path):
    with _scope(tmp_path):
        user = _admin()
        updated = organization.organization_policy_update(
            organization.RolePolicyUpdateIn(
                user_capability_map={"viewer": ["workspace.read"]},
                project_capability_map={"viewer": ["project.read"]},
                notes="ABAC policy test",
                field_security_rules=[
                    {
                        "id": "mask-user-email",
                        "resource": "organization.users",
                        "fields": ["email", "password_hash"],
                        "roles": ["viewer"],
                        "action": "mask",
                        "mask": "partial",
                    }
                ],
                row_filter_rules=[
                    {
                        "id": "deny-disabled-users",
                        "resource": "organization.users",
                        "roles": ["viewer"],
                        "effect": "deny",
                        "conditions": {"status": "disabled"},
                    }
                ],
            ),
            user=user,
        )

        assert updated["abac_policy"]["field_security_rules"][0]["id"] == "mask-user-email"
        assert updated["abac_policy"]["row_filter_rules"][0]["id"] == "deny-disabled-users"

        decision = organization.organization_policy_check(
            organization.RolePolicyCheckIn(
                scope="tenant",
                role="viewer",
                capability="workspace.read",
                resource="organization.users",
                action="read",
                fields=["username", "email", "password_hash"],
                row={"id": "u-disabled", "username": "viewer", "email": "viewer@example.com", "password_hash": "secret", "status": "disabled"},
            ),
            user=user,
        )

        assert decision["allowed"] is False
        assert decision["row_decision"]["allowed"] is False
        assert "deny-disabled-users" in decision["row_decision"]["matched_rules"]
        assert decision["masked_row"]["email"].startswith("vi")
        assert decision["masked_row"]["password_hash"] == "***masked***"
        assert decision["field_decisions"]["email"]["decision"] == "mask"

        history = organization.organization_policy_history(user=user)
        assert any(item.get("action") == "abac_check" and item.get("decision") == "deny" for item in history["items"])


def test_abac_dynamic_scope_condition_uses_current_project(tmp_path):
    with _scope(tmp_path, "proj-current"):
        user = _admin()
        organization.organization_policy_update(
            organization.RolePolicyUpdateIn(
                user_capability_map={"developer": ["delivery.execute"]},
                project_capability_map={"developer": ["task.claim"]},
                notes="project scope row filter",
                row_filter_rules=[
                    {
                        "id": "project-scope-only",
                        "resource": "delivery.tasks",
                        "roles": ["developer"],
                        "effect": "deny",
                        "conditions": {"project_id": {"neq": "$current_project_id"}},
                    }
                ],
            ),
            user=user,
        )

        allowed = organization.organization_policy_check(
            organization.RolePolicyCheckIn(
                scope="tenant",
                role="developer",
                capability="delivery.execute",
                resource="delivery.tasks",
                row={"id": "TASK-ok", "project_id": "proj-current"},
            ),
            user=user,
        )
        denied = organization.organization_policy_check(
            organization.RolePolicyCheckIn(
                scope="tenant",
                role="developer",
                capability="delivery.execute",
                resource="delivery.tasks",
                row={"id": "TASK-other", "project_id": "proj-other"},
            ),
            user=user,
        )

        assert allowed["allowed"] is True
        assert allowed["row_decision"]["allowed"] is True
        assert denied["allowed"] is False
        assert denied["row_decision"]["matched_rules"] == ["project-scope-only"]
