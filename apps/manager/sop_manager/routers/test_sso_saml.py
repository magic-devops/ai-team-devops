from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from sop_manager.routers import sso
from sop_manager.routers.sql_models import SessionLocal, Tenant, User


SAML_CERT = "MIICFAKECERTDATA"


def _env_saml_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOP_SSO_PROVIDERS", "corp")
    monkeypatch.setenv("SOP_SSO_CORP_TYPE", "saml")
    monkeypatch.setenv("SOP_SSO_CORP_ISSUER", "https://idp.example.com/entity")
    monkeypatch.setenv("SOP_SSO_CORP_CLIENT_ID", "https://sp.example.com/metadata")
    monkeypatch.setenv("SOP_SSO_CORP_REDIRECT", "https://sp.example.com/api/v1/sso/corp/saml/acs")
    monkeypatch.setenv("SOP_SSO_CORP_SAML_SSO_URL", "https://idp.example.com/sso")
    monkeypatch.setenv("SOP_SSO_CORP_SAML_X509_CERT", SAML_CERT)


def test_saml_metadata_returns_real_sp_descriptor(monkeypatch: pytest.MonkeyPatch) -> None:
    _env_saml_provider(monkeypatch)

    response = sso.saml_metadata("corp")
    body = response.body.decode("utf-8")

    assert response.media_type == "application/samlmetadata+xml"
    assert "EntityDescriptor" in body
    assert "AssertionConsumerService" in body
    assert "https://sp.example.com/api/v1/sso/corp/saml/acs" in body
    assert "stub" not in body.lower()
    assert "占位" not in body


def test_parse_saml_metadata_extracts_idp_contract() -> None:
    parsed = sso._parse_saml_metadata_xml(
        f"""<?xml version="1.0"?>
<EntityDescriptor entityID="https://idp.example.com/entity" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <IDPSSODescriptor>
    <KeyDescriptor><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>
      -----BEGIN CERTIFICATE----- {SAML_CERT} -----END CERTIFICATE-----
    </X509Certificate></X509Data></KeyInfo></KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example.com/post"/>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/redirect"/>
  </IDPSSODescriptor>
</EntityDescriptor>"""
    )

    assert parsed["entity_id"] == "https://idp.example.com/entity"
    assert parsed["sso_url"] == "https://idp.example.com/redirect"
    assert parsed["x509_cert"] == SAML_CERT


def test_saml_provider_test_reports_dependency_and_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    _env_saml_provider(monkeypatch)
    monkeypatch.setattr(sso, "_saml_dependency_status", lambda: {"installed": True, "package": "python3-saml", "version": "test"})

    result = asyncio.run(sso.test_provider("corp", _=object()))

    assert result["ok"] is True
    assert result["type"] == "saml"
    assert result["idp"]["sso_url"] == "https://idp.example.com/sso"
    assert result["sp"]["metadata_url"] == "/api/v1/sso/corp/saml/metadata"
    assert result["missing"] == []


def test_saml_login_requires_mature_dependency(monkeypatch: pytest.MonkeyPatch) -> None:
    _env_saml_provider(monkeypatch)
    monkeypatch.setattr(
        sso,
        "_saml_dependency_status",
        lambda: {"installed": False, "install_hint": "pip install 'sop-manager[sso]'"},
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(sso.saml_login("corp"))

    assert exc.value.status_code == 503
    assert "python3-saml" in exc.value.detail or "sop-manager[sso]" in exc.value.detail


def test_scim_token_is_returned_once_and_public_config_masks_it(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    sso._save_provider_runtime_config("corp", {"type": "saml", "issuer": "https://idp.example.com/entity"})

    result = sso.rotate_scim_token("corp", sso.ScimTokenRotateIn(enabled=True), _=object())
    providers = sso._providers()
    audit = sso.scim_audit_report("corp", _=object())

    assert result["token"].startswith("scim_")
    assert providers["corp"]["scim_token_hash"] != result["token"]
    assert providers["corp"]["scim_enabled"] is True
    public = sso._public_provider("corp", providers["corp"])
    assert public["scim"]["enabled"] is True
    assert public["scim"]["token_configured"] is True
    assert "token" not in public["scim"]
    assert audit["summary"]["by_event"]["token_rotated"] == 1
    assert audit["items"][0]["details"]["token"] == "***"


def test_scim_audit_report_filters_and_caps_events(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    sso._save_provider_runtime_config("corp", {"type": "saml", "issuer": "https://idp.example.com/entity"})

    for idx in range(205):
        sso._record_scim_audit(
            "corp",
            "group_patched" if idx % 2 else "user_patched",
            status="ok" if idx % 3 else "error",
            subject=f"subject-{idx}",
            details={"token": "secret-token", "skipped_count": idx % 4},
        )
    report = sso.scim_audit_report("corp", event_type="group_patched", status="ok", limit=5, _=object())

    assert report["summary"]["total"] == 200
    assert report["summary"]["by_event"]["group_patched"] > 0
    assert report["filtered_summary"]["by_status"] == {"ok": report["filtered_summary"]["total"]}
    assert len(report["items"]) == 5
    assert all(item["event_type"] == "group_patched" for item in report["items"])
    assert all(item["details"]["token"] == "***" for item in report["items"])


def test_sso_risk_report_uses_config_and_scim_audit(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    old_rotated_at = "2025-01-01T00:00:00Z"
    sso._save_provider_runtime_config(
        "corp",
        {
            "type": "oidc",
            "issuer": "https://idp.example.com",
            "client_id": "client-id",
            "client_secret": "secret",
            "scim_enabled": True,
            "scim_token_hash": sso._hash_secret("scim-token"),
            "scim_token_rotated_at": old_rotated_at,
            "tenant_domain_map": {},
            "role_map": {"sop-admins": "tenant_admin"},
        },
    )
    sso._record_scim_audit("corp", "user_patched", status="error", details={"token": "secret-token"})
    sso._record_scim_audit("corp", "group_patched", status="ok", details={"skipped_count": 2})

    report = sso.sso_risk_report("corp", _=object())
    kinds = {item["kind"] for item in report["findings"]}

    assert report["status"] == "risk"
    assert report["score"] < 65
    assert "scim_token_critical_age" in kinds
    assert "tenant_domain_map_missing" in kinds
    assert "role_map_fallback_missing" in kinds
    assert "scim_audit_failures" in kinds
    assert "scim_group_skips" in kinds
    assert report["summary"]["audit_failed"] == 1
    assert all("secret-token" not in str(item) for item in report["findings"])


def test_sso_risk_tasks_preview_and_create_use_structured_findings(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    sso._save_provider_runtime_config(
        "corp",
        {
            "type": "oidc",
            "issuer": "",
            "client_id": "",
            "client_secret": "",
            "scim_enabled": True,
            "role_map": {},
            "tenant_domain_map": {},
        },
    )
    preview = sso.sso_risk_tasks("corp", sso.SsoRiskTasksIn(dry_run=True, limit=3), _=object())
    created_payloads: list[object] = []

    def fake_create_task(body: object) -> dict[str, object]:
        created_payloads.append(body)
        return {"ok": True, "id": f"T-SSO-{len(created_payloads)}"}

    monkeypatch.setattr(sso, "create_task", fake_create_task)
    created = sso.sso_risk_tasks("corp", sso.SsoRiskTasksIn(dry_run=False, limit=2, assigned_to="SecurityOps"), _=object())

    assert preview["dry_run"] is True
    assert preview["summary"]["planned"] == 3
    assert preview["created"] == []
    assert all(item["source"] == "sso_risk_governance" for item in preview["items"])
    assert created["dry_run"] is False
    assert created["summary"]["created"] == 2
    assert len(created_payloads) == 2
    assert created["created"][0]["id"] == "T-SSO-1"


def test_sso_risk_im_briefing_reuses_notify_channels_and_sends(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    from sop_manager.routers import notify

    sso._save_provider_runtime_config(
        "corp",
        {
            "type": "oidc",
            "issuer": "",
            "client_id": "",
            "client_secret": "",
            "scim_enabled": True,
            "role_map": {},
            "tenant_domain_map": {},
        },
    )
    notify.add_channel(notify.Channel(type="webhook", name="security-im", webhook_url="https://im.example/hook", enabled=True, events=["sso_risk"]))
    preview = sso.sso_risk_im_briefing("corp", sso.SsoRiskImBriefingIn(dry_run=True, limit=3), _=object())
    sent_payloads: list[object] = []

    def fake_send_msg(body: object) -> dict[str, object]:
        sent_payloads.append(body)
        return {"ok": True, "id": f"MSG-{len(sent_payloads)}", "channel": getattr(body, "channel", "")}

    monkeypatch.setattr(notify, "send_msg", fake_send_msg)
    sent = sso.sso_risk_im_briefing(
        "corp",
        sso.SsoRiskImBriefingIn(dry_run=False, channels=["security-im"], limit=2),
        _=object(),
    )

    assert preview["dry_run"] is True
    assert preview["delivery_plan"]["selection_mode"] == "event"
    assert preview["delivery_plan"]["target_count"] == 1
    assert preview["briefing"]["risk_level"] in {"high", "critical"}
    assert sent["dry_run"] is False
    assert sent["audit"]["sent_count"] == 1
    assert sent["sent"][0]["id"] == "MSG-1"
    assert sent_payloads


def test_sso_risk_subscription_config_test_and_history(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    from sop_manager.routers import notify

    sso._save_provider_runtime_config(
        "corp",
        {
            "type": "oidc",
            "issuer": "",
            "client_id": "",
            "client_secret": "",
            "scim_enabled": True,
            "role_map": {},
            "tenant_domain_map": {},
        },
    )
    notify.add_channel(notify.Channel(type="webhook", name="security-im", webhook_url="https://im.example/hook", enabled=True, events=["sso_risk_subscription"]))
    saved = sso.upsert_sso_risk_subscription(
        "corp",
        sso.SsoRiskSubscriptionIn(
            enabled=True,
            channels=["security-im"],
            min_severity="medium",
            score_threshold=90,
            frequency="daily",
            include_low=True,
            limit=4,
            owner="SecurityOps",
            title="Daily SSO risk digest",
        ),
        _=object(),
    )
    preview = sso.test_sso_risk_subscription("corp", sso.SsoRiskSubscriptionTestIn(dry_run=True, actor="secops"), _=object())
    sent_payloads: list[object] = []

    def fake_send_msg(body: object) -> dict[str, object]:
        sent_payloads.append(body)
        return {"ok": True, "id": f"MSG-{len(sent_payloads)}", "channel": getattr(body, "channel", "")}

    monkeypatch.setattr(notify, "send_msg", fake_send_msg)
    sent = sso.test_sso_risk_subscription("corp", sso.SsoRiskSubscriptionTestIn(dry_run=False, actor="secops"), _=object())
    current = sso.get_sso_risk_subscription("corp", _=object())

    assert saved["subscription"]["enabled"] is True
    assert saved["subscription"]["frequency"] == "daily"
    assert preview["dry_run"] is True
    assert preview["triggered"] is True
    assert preview["delivery_plan"]["target_count"] == 1
    assert sent["dry_run"] is False
    assert sent["audit"]["sent_count"] == 1
    assert sent_payloads
    assert current["history"]["total"] == 1
    assert current["history"]["items"][0]["sent_count"] == 1
    assert current["subscription"]["last_sent_at"]


def test_sso_risk_escalation_policy_runs_tasks_im_and_history(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    from sop_manager.routers import notify

    sso._save_provider_runtime_config(
        "corp",
        {
            "type": "oidc",
            "issuer": "",
            "client_id": "",
            "client_secret": "",
            "scim_enabled": True,
            "role_map": {},
            "tenant_domain_map": {},
        },
    )
    notify.add_channel(notify.Channel(type="webhook", name="security-im", webhook_url="https://im.example/hook", enabled=True, events=["sso_risk_escalation"]))
    saved = sso.upsert_sso_risk_escalation(
        "corp",
        sso.SsoRiskEscalationPolicyIn(
            enabled=True,
            min_severity="medium",
            score_threshold=90,
            actions=["create_tasks", "send_im"],
            channels=["security-im"],
            priority="P1",
            assigned_to="SecurityOps",
            dev_tool="codex",
            include_low=True,
            limit=3,
            cooldown_minutes=30,
            title="SSO escalation",
            owner="SecurityOps",
        ),
        _=object(),
    )
    preview = sso.run_sso_risk_escalation("corp", sso.SsoRiskEscalationRunIn(dry_run=True, actor="secops"), _=object())
    created_payloads: list[object] = []
    sent_payloads: list[object] = []

    def fake_create_task(body: object) -> dict[str, object]:
        created_payloads.append(body)
        return {"ok": True, "id": f"T-SSO-ESC-{len(created_payloads)}"}

    def fake_send_msg(body: object) -> dict[str, object]:
        sent_payloads.append(body)
        return {"ok": True, "id": f"MSG-{len(sent_payloads)}", "channel": getattr(body, "channel", "")}

    monkeypatch.setattr(sso, "create_task", fake_create_task)
    monkeypatch.setattr(notify, "send_msg", fake_send_msg)
    sent = sso.run_sso_risk_escalation("corp", sso.SsoRiskEscalationRunIn(dry_run=False, actor="secops"), _=object())
    cooldown = sso.run_sso_risk_escalation("corp", sso.SsoRiskEscalationRunIn(dry_run=True, actor="secops"), _=object())
    current = sso.get_sso_risk_escalation("corp", _=object())

    assert saved["policy"]["enabled"] is True
    assert preview["dry_run"] is True
    assert preview["triggered"] is True
    assert preview["task_result"]["summary"]["planned"] == 3
    assert preview["im_result"]["delivery_plan"]["target_count"] == 1
    assert sent["dry_run"] is False
    assert sent["triggered"] is True
    assert sent["task_result"]["summary"]["created"] == 3
    assert sent["im_result"]["audit"]["sent_count"] == 1
    assert created_payloads and sent_payloads
    assert cooldown["triggered"] is False
    assert cooldown["reason"] == "cooldown"
    assert current["history"]["total"] == 1
    assert current["history"]["items"][0]["created_count"] == 3
    assert current["policy"]["last_triggered_at"]


def test_sso_risk_escalation_disabled_skips_without_force(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    sso._save_provider_runtime_config(
        "corp",
        {
            "type": "oidc",
            "issuer": "",
            "client_id": "",
            "client_secret": "",
            "scim_enabled": True,
            "role_map": {},
            "tenant_domain_map": {},
        },
    )
    sso.upsert_sso_risk_escalation("corp", sso.SsoRiskEscalationPolicyIn(enabled=False, actions=["create_tasks"], limit=2), _=object())

    skipped = sso.run_sso_risk_escalation("corp", sso.SsoRiskEscalationRunIn(dry_run=True, actor="secops"), _=object())
    forced = sso.run_sso_risk_escalation("corp", sso.SsoRiskEscalationRunIn(dry_run=True, actor="secops", force=True), _=object())

    assert skipped["triggered"] is False
    assert skipped["reason"] == "policy_disabled"
    assert skipped["actions"] == []
    assert forced["triggered"] is True
    assert forced["reason"] == "forced"
    assert forced["task_result"]["summary"]["planned"] == 2


def test_sso_risk_runbook_generates_tasks_and_im(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    from sop_manager.routers import notify

    sso._save_provider_runtime_config(
        "corp",
        {
            "type": "oidc",
            "issuer": "",
            "client_id": "",
            "client_secret": "",
            "scim_enabled": True,
            "role_map": {},
            "tenant_domain_map": {},
        },
    )
    notify.add_channel(notify.Channel(type="webhook", name="security-im", webhook_url="https://im.example/hook", enabled=True, events=["sso_risk_runbook"]))

    created = sso.create_sso_risk_runbook(
        "corp",
        sso.SsoRiskRunbookIn(
            include_low=True,
            limit=3,
            priority="P1",
            assigned_to="SecurityOps",
            dev_tool="codex",
            owner="SecurityOps",
            channels=["security-im"],
            title="SSO security remediation",
        ),
        _=object(),
    )
    runbook_id = created["item"]["id"]
    listed = sso.list_sso_risk_runbooks("corp", _=object())
    detail = sso.get_sso_risk_runbook("corp", runbook_id, _=object())
    preview = sso.sso_risk_runbook_action(
        "corp",
        runbook_id,
        sso.SsoRiskRunbookActionIn(action="preview_tasks", dry_run=True, include_low=True),
        _=object(),
    )
    task_payloads: list[object] = []
    sent_payloads: list[object] = []

    def fake_create_task(body: object) -> dict[str, object]:
        task_payloads.append(body)
        return {"ok": True, "id": f"T-RUNBOOK-{len(task_payloads)}"}

    def fake_send_msg(body: object) -> dict[str, object]:
        sent_payloads.append(body)
        return {"ok": True, "id": f"MSG-RUNBOOK-{len(sent_payloads)}", "channel": getattr(body, "channel", "")}

    monkeypatch.setattr(sso, "create_task", fake_create_task)
    monkeypatch.setattr(notify, "send_msg", fake_send_msg)
    task_result = sso.sso_risk_runbook_action(
        "corp",
        runbook_id,
        sso.SsoRiskRunbookActionIn(action="create_tasks", dry_run=False, include_low=True, assigned_to="SecurityOps"),
        _=object(),
    )
    im_result = sso.sso_risk_runbook_action(
        "corp",
        runbook_id,
        sso.SsoRiskRunbookActionIn(action="send_im", dry_run=False, channels=["security-im"], actor="secops"),
        _=object(),
    )

    assert created["item"]["status"] == "draft"
    assert created["item"]["finding_count"] == 3
    assert created["item"]["step_total"] >= 6
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == runbook_id
    assert detail["runbook"]["events"][0]["kind"] == "created"
    assert preview["result"]["planned"]
    assert all(item["source"] == "sso_risk_runbook" for item in preview["result"]["planned"])
    assert task_result["item"]["task_count"] == len(task_result["result"]["created"])
    assert task_payloads
    assert im_result["result"]["im"]["audit"]["sent_count"] == 1
    assert sent_payloads
    assert any(step["id"] == "notify_security_channels" and step["status"] == "completed" for step in im_result["runbook"]["steps"])


def test_sso_risk_runbook_step_verify_and_archive(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    sso._save_provider_runtime_config(
        "corp",
        {
            "type": "oidc",
            "issuer": "https://idp.example.com",
            "client_id": "client-id",
            "client_secret": "secret",
            "scim_enabled": False,
            "role_map": {"sop-admins": "tenant_admin", "*": "developer"},
            "tenant_domain_map": {"example.com": "t-default"},
        },
    )
    created = sso.create_sso_risk_runbook("corp", sso.SsoRiskRunbookIn(include_low=False, limit=3), _=object())
    runbook_id = created["item"]["id"]

    verified = sso.sso_risk_runbook_action(
        "corp",
        runbook_id,
        sso.SsoRiskRunbookActionIn(action="verify", dry_run=False, actor="secops"),
        _=object(),
    )
    verify_step = next(step for step in verified["runbook"]["steps"] if step["id"] == "verify_sso_config")
    failed = sso.sso_risk_runbook_action(
        "corp",
        runbook_id,
        sso.SsoRiskRunbookActionIn(action="mark_step_failed", step_id="notify_security_channels", dry_run=False, note="channel maintenance"),
        _=object(),
    )
    archived = sso.sso_risk_runbook_action(
        "corp",
        runbook_id,
        sso.SsoRiskRunbookActionIn(action="archive", dry_run=False, actor="secops"),
        _=object(),
    )

    assert created["item"]["finding_count"] == 0
    assert verify_step["status"] == "completed"
    assert verified["result"]["risk"]["summary"]["high"] == 0
    assert failed["item"]["status"] == "risk"
    assert archived["item"]["status"] == "archived"
    assert archived["runbook"]["archived_by"] == "secops"


def test_scim_user_provision_dry_run_resolves_tenant_role_and_active(monkeypatch: pytest.MonkeyPatch) -> None:
    cfg = {
        "tenant_domain_map": {"example.com": "t-scim-dry-run"},
        "role_map": {"sop-admins": "tenant_admin", "*": "developer"},
    }
    db = SessionLocal()
    try:
        result = sso._provision_scim_user(
            db,
            cfg,
            {
                "userName": "scim.admin@example.com",
                "displayName": "SCIM Admin",
                "active": False,
                "groups": [{"display": "sop-admins"}],
            },
            dry_run=True,
        )
    finally:
        db.close()

    assert result["dry_run"] is True
    assert result["email"] == "scim.admin@example.com"
    assert result["tenant"] == "t-scim-dry-run"
    assert result["role"] == "tenant_admin"
    assert result["active"] is False


def test_scim_user_provision_creates_and_deactivates_user(monkeypatch: pytest.MonkeyPatch) -> None:
    email = "scim-create@example.com"
    cfg = {"tenant_domain_map": {"example.com": "t-scim-create"}, "role_map": {"sop-viewers": "viewer"}}
    db = SessionLocal()
    try:
        result = sso._provision_scim_user(
            db,
            cfg,
            {
                "userName": email,
                "displayName": "SCIM Create",
                "active": False,
                "groups": [{"display": "sop-viewers"}],
            },
        )
        user = db.query(User).filter_by(email=email).first()
        assert user is not None
        assert user.status == "disabled"
        assert user.role == "viewer"
        assert result["resource"]["active"] is False
    finally:
        user = db.query(User).filter_by(email=email).first()
        if user is not None:
            db.delete(user)
            db.commit()
        db.close()


def test_scim_group_membership_replace_and_remove_is_scoped() -> None:
    cfg = {"tenant_domain_map": {"example.com": "t-scim-group"}, "_provider": "corp"}
    db = SessionLocal()
    created_ids: list[str] = []
    try:
        tenant = sso._ensure_tenant(db, "t-scim-group")
        other = db.get(Tenant, "t-scim-other") or Tenant(id="t-scim-other", slug="scim-other", name="scim-other", plan="enterprise", status="active")
        db.add(other)
        users = [
            User(id="u-scim-g-1", tenant_id=tenant.id, username="scim-g-1", email="scim-g-1@example.com", password_hash="x", role="developer", status="active"),
            User(id="u-scim-g-2", tenant_id=tenant.id, username="scim-g-2", email="scim-g-2@example.com", password_hash="x", role="viewer", status="active"),
            User(id="u-scim-g-other", tenant_id=other.id, username="scim-g-other", email="scim-g-other@other.com", password_hash="x", role="developer", status="active"),
        ]
        for user in users:
            existing = db.get(User, user.id)
            if existing is not None:
                db.delete(existing)
                db.flush()
            db.add(user)
            created_ids.append(user.id)
        db.commit()

        result = sso._sync_scim_group_members(db, cfg, "analyst", ["u-scim-g-1", "u-scim-g-other"], mode="replace")
        assert "u-scim-g-1" in result["changed"]
        assert "u-scim-g-other" in result["skipped"]
        assert db.get(User, "u-scim-g-1").role == "analyst"
        assert db.get(User, "u-scim-g-other").role == "developer"

        result = sso._sync_scim_group_members(db, cfg, "analyst", ["u-scim-g-1"], mode="remove")
        assert "u-scim-g-1" in result["changed"]
        assert db.get(User, "u-scim-g-1").role == "developer"
    finally:
        for user_id in created_ids:
            user = db.get(User, user_id)
            if user is not None:
                db.delete(user)
        db.commit()
        db.close()
