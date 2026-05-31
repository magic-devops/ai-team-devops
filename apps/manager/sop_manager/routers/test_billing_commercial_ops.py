from contextlib import contextmanager

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import billing
from sop_manager.routers.usage import UsageIn, record_usage_event


@contextmanager
def scoped_project(root, *, tenant="tenant-billing", business="biz-billing", project="project-billing"):
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


def test_billing_entitlement_check_enforces_plan_feature_quota_and_overage_policy(tmp_path):
    with scoped_project(tmp_path):
        billing.update_subscription(
            billing.SubscriptionIn(
                plan="team",
                billing_email="finance@example.com",
                auto_apply_quota=True,
            )
        )
        record_usage_event(
            UsageIn(
                metric="llm_tokens",
                value=2_000_010,
                unit="tokens",
                source="test",
            )
        )

        policy = billing.upsert_overage_policy(
            billing.OveragePolicyIn(mode="block", grace_percent=0, approval_threshold_percent=100)
        )
        assert policy["policy"]["mode"] == "block"

        check = billing.entitlement_check(
            billing.EntitlementCheckIn(feature="team_rbac", metric="llm_tokens", delta=1)
        )
        assert check["allowed"] is False
        assert check["feature_allowed"] is True
        assert check["quota_allowed"] is False
        assert check["decision"] == "blocked_overage"
        assert check["quota"]["limit"] == 2_000_000

        sso_check = billing.entitlement_check(billing.EntitlementCheckIn(feature="sso"))
        assert sso_check["allowed"] is False
        assert sso_check["decision"] == "feature_not_entitled"


def test_billing_invoice_audit_dunning_and_payment_lifecycle(tmp_path):
    with scoped_project(tmp_path):
        created = billing.snapshot_invoice(period="2026-05")
        invoice_id = created["invoice"]["id"]

        issued = billing.update_invoice_status(invoice_id, billing.InvoiceStatusIn(status="issued", note="sent to customer"))
        assert issued["invoice"]["status"] == "issued"

        dunning = billing.dunning_state()
        assert dunning["summary"]["open_invoices"] == 1
        assert dunning["items"][0]["invoice_id"] == invoice_id
        assert dunning["items"][0]["stage"] in {"notice", "reminder", "final_notice"}

        paid = billing.record_payment(
            billing.PaymentIn(invoice_id=invoice_id, amount_usd=issued["invoice"]["total_due_usd"], method="manual")
        )
        assert paid["invoice"]["status"] == "paid"

        audit = billing.invoice_audit(invoice_id)
        event_types = [item["type"] for item in audit["items"]]
        assert event_types == ["invoice_snapshot_created", "invoice_status_changed", "payment_recorded"]
        assert audit["items"][1]["from_status"] == "draft"
        assert audit["items"][1]["to_status"] == "issued"

        dunning_after_payment = billing.dunning_state()
        assert dunning_after_payment["summary"]["open_invoices"] == 0
