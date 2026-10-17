"""Durable issue proposals never replace source evidence or human acceptance."""

import importlib
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sop_manager.routers import llm_gateway
from sop_manager.routers.delivery_service import initial_state
from sop_manager.routers.sql_models import DeliveryWorkspace, Issue, Project, Requirement, User
from test_business_access import env  # noqa: F401


@pytest.fixture
def domain(env, monkeypatch):  # noqa: F811
    _, sessions = env
    module = importlib.import_module("sop_manager.routers.delivery_issue_diagnosis")
    evidence = importlib.import_module("sop_manager.routers.delivery_issue_evidence")
    with sessions() as db:
        db.autoflush = False
        data = initial_state()
        db.add(DeliveryWorkspace(project_id="selected", tenant_id="team", version=0, data=data))
        db.commit()
        obj = SimpleNamespace(module=module, sessions=sessions, db=db, data=data, request=object())
        obj.project = db.get(Project, "selected")
        obj.user = db.get(User, "writer")
        obj.detail = lambda: module.issue_detail(
            db, obj.project, obj.data, obj.user, "ISSUE-selected", version=0
        )
        obj.generate = lambda **changes: module.generate_diagnosis(
            db,
            obj.project,
            obj.user,
            "ISSUE-selected",
            importlib.import_module(
                "sop_manager.routers.delivery_issue_contract"
            ).IssueDiagnosisGenerate.model_validate(
                {
                    "expected_version": 0,
                    "issue_basis": obj.detail()["issue_basis"],
                    "selected_evidence_ids": ["issue:ISSUE-selected"],
                    "idempotency_key": "diagnose-stable-key",
                    **changes,
                }
            ),
            obj.request,
        )
        obj.evidence = evidence
        yield obj


def output(**changes):
    return {
        "summary": "The recorded failure requires investigation",
        "hypotheses": [
            {
                "hypothesis": "The service configuration may be wrong",
                "confidence": "low",
                "evidence_ids": ["issue:ISSUE-selected"],
                "verification_steps": ["Inspect the supplied result and reproduce the failure"],
            }
        ],
        "checks": [
            {
                "title": "Confirm the failing result",
                "instructions": "Inspect the recorded evidence without rerunning a side effect",
                "evidence_ids": ["issue:ISSUE-selected"],
            }
        ],
        "risks": ["The cause remains unconfirmed"],
        "requirement": {
            "title": "Investigate the failure",
            "description": "Reproduce and repair only after confirming the cause",
            "priority": "P1",
            "acceptance_criteria": ["The cause and repair are independently verified"],
        },
        "open_questions": ["Is the recorded failure reproducible?"],
        **changes,
    }


def gateway(monkeypatch, domain, *, content=None, failure=None, during=None):
    calls = []

    def chat(body, request):
        from sop_manager.routers.sql_models import IssueDiagnosis

        with domain.sessions() as observer:
            saved = observer.query(IssueDiagnosis).filter_by(status="generating").one()
            assert saved.status == "generating"
            assert saved.data["snapshot"]["evidence"][0]["id"] == "issue:ISSUE-selected"
        assert request is domain.request and body.task_type == "classify" and body.cache_ttl == 0
        assert len(body.messages) == 2 and body.messages[0].role == "system"
        calls.append(body)
        if during:
            during()
        if failure:
            raise failure
        return llm_gateway.ChatOut(
            model="fixture-model",
            provider="fixture-provider",
            content=content or json.dumps(output()),
            usage=llm_gateway.ChatUsage(prompt_tokens=6, completion_tokens=4, total_tokens=10),
        )

    monkeypatch.setattr(llm_gateway, "llm_chat", chat)
    return calls


def test_provider_receipt_is_committed_and_same_request_replays_without_billing(domain, monkeypatch):
    calls = gateway(monkeypatch, domain)
    one = domain.generate()
    two = domain.generate()
    assert one["status"] == "succeeded" and one == two
    assert one["usage"]["total_tokens"] == 10 and one["result"]["requirement"]["priority"] == "P1"
    assert len(calls) == 1
    assert domain.db.query(Requirement).count() == 2
    with pytest.raises(HTTPException) as exc:
        domain.generate(instructions="Different prompt for the same key")
    assert exc.value.status_code == 409


def test_provider_failure_and_invalid_json_are_durable_safe_outcomes(domain, monkeypatch):
    calls = gateway(monkeypatch, domain, failure=RuntimeError("Bearer secret-provider-token"))
    one = domain.generate()
    assert one["status"] == "failed" and one["result"] is None
    assert "secret-provider-token" not in json.dumps(one)
    assert domain.generate()["status"] == "failed" and len(calls) == 1


@pytest.mark.parametrize(
    "bad",
    [
        '{"summary":"first","summary":"duplicate"}',
        '{"summary":NaN}',
        json.dumps(
            output(
                hypotheses=[
                    {
                        "hypothesis": "Invented source",
                        "confidence": "high",
                        "evidence_ids": ["node:foreign"],
                        "verification_steps": ["Inspect"],
                    }
                ]
            )
        ),
        json.dumps({**output(), "resolve": True}),
        "x" * 32769,
    ],
    ids=["duplicate", "nonfinite", "foreign-reference", "unexpected-action", "oversized"],
)
def test_strict_output_rejects_duplicate_nonfinite_foreign_or_executable_content(domain, monkeypatch, bad):
    gateway(monkeypatch, domain, content=bad)
    value = domain.generate()
    assert value["status"] == "failed" and value["error"]["code"] == "issue_diagnosis_invalid_output"
    assert value["usage"]["total_tokens"] == 10


def test_rules_are_explicit_and_generation_does_not_resolve_or_create_work(domain, monkeypatch):
    monkeypatch.setattr(llm_gateway, "llm_chat", lambda *a: pytest.fail("Rules must not call provider"))
    value = domain.generate(generator="rules")
    assert value["generator"] == "rules" and value["status"] == "succeeded"
    assert value["model"] == value["provider"] == "" and value["usage"] == {}
    assert domain.db.get(Issue, "ISSUE-selected").status == "open"
    assert domain.db.query(Requirement).count() == 2


def test_issue_changed_during_generation_retains_original_snapshot_but_cannot_adopt(domain, monkeypatch):
    def change():
        with domain.sessions() as other:
            other.get(Issue, "ISSUE-selected").title = "Changed while provider was running"
            other.commit()

    gateway(monkeypatch, domain, during=change)
    value = domain.generate()
    assert value["status"] == "succeeded" and value["current"] is False
    assert value["snapshot"]["issue"]["title"] == "selected"
    assert value["actions"]["can_adopt"] is False


def test_pending_replay_and_cancelled_late_result_never_repeat_provider(domain, monkeypatch):
    def cancel():
        from sop_manager.routers.delivery_issue_contract import IssueDiagnosisDismiss
        from sop_manager.routers.sql_models import IssueDiagnosis

        with domain.sessions() as other:
            row = other.query(IssueDiagnosis).one()
            user, project = other.get(User, "writer"), other.get(Project, "selected")
            replay = domain.module.generate_diagnosis(
                other,
                project,
                user,
                row.issue_id,
                importlib.import_module(
                    "sop_manager.routers.delivery_issue_contract"
                ).IssueDiagnosisGenerate.model_validate(
                    {
                        "expected_version": 0,
                        "issue_basis": row.data["issue_basis"],
                        "selected_evidence_ids": ["issue:ISSUE-selected"],
                        "idempotency_key": "diagnose-stable-key",
                    }
                ),
                domain.request,
            )
            assert replay["status"] == "generating"
            domain.module.apply_issue_diagnosis(
                other,
                project,
                user,
                initial_state(),
                "issue.diagnosis.dismiss",
                IssueDiagnosisDismiss(
                    issue_id=row.issue_id,
                    diagnosis_id=row.id,
                    issue_basis=row.data["issue_basis"],
                    comment="Stop using this unfinished proposal",
                ),
            )
            other.commit()

    calls = gateway(monkeypatch, domain, during=cancel)
    value = domain.generate()
    assert value["status"] == "cancelled" and value["result"] is None
    assert value["review"]["decision"] == "cancelled"
    assert domain.generate()["status"] == "cancelled" and len(calls) == 1


def test_cross_actor_approval_creates_one_requirement_without_closing_issue(domain, monkeypatch):
    from sop_manager.routers.delivery_issue_contract import IssueDiagnosisAdopt

    gateway(monkeypatch, domain)
    first = domain.generate()
    second = domain.generate(idempotency_key="diagnose-other-key")

    def body(row):
        return IssueDiagnosisAdopt(
            issue_id="ISSUE-selected",
            diagnosis_id=row["id"],
            issue_basis=row["issue_basis"],
            comment="Reviewed the evidence and edited this requirement",
            title="Human edited repair",
            description="Confirm the cause before implementation",
            priority="P2",
            acceptance_criteria=["The cause and fix pass independent checks"],
        )

    with pytest.raises(HTTPException) as exc:
        domain.module.apply_issue_diagnosis(
            domain.db, domain.project, domain.user, domain.data, "issue.diagnosis.adopt", body(first)
        )
    assert exc.value.status_code == 403
    reviewer = domain.db.get(User, "product")
    one = domain.module.apply_issue_diagnosis(
        domain.db, domain.project, reviewer, domain.data, "issue.diagnosis.adopt", body(first)
    )
    domain.db.flush()
    two = domain.module.apply_issue_diagnosis(
        domain.db, domain.project, reviewer, domain.data, "issue.diagnosis.adopt", body(second)
    )
    assert one[0] == two[0]
    row = domain.db.get(Requirement, one[0])
    assert row.title == "Human edited repair" and row.priority == "P2"
    assert domain.data["flows"][row.id]["source_diagnosis"]["id"] == first["id"]
    assert domain.db.get(Issue, "ISSUE-selected").status == "open"


def test_first_adoption_works_with_production_session_autoflush_disabled(domain):
    from sop_manager.routers.delivery_issue_contract import IssueDiagnosisAdopt

    domain.db.autoflush = False
    value = domain.generate(generator="rules")
    body = IssueDiagnosisAdopt(
        issue_id="ISSUE-selected",
        diagnosis_id=value["id"],
        issue_basis=value["issue_basis"],
        comment="Human checked the fixed evidence",
        title="Actual production-session repair",
        description="Investigate before implementation",
        priority="P1",
        acceptance_criteria=["Independent checks verify the repair"],
    )
    reviewer = domain.db.get(User, "product")
    result = domain.module.apply_issue_diagnosis(
        domain.db, domain.project, reviewer, domain.data, "issue.diagnosis.adopt", body
    )
    domain.db.commit()
    row = domain.db.get(Requirement, result[0], populate_existing=True)
    assert row.title == "Actual production-session repair" and row.priority == "P1"
    assert result[2]["created"] is True and domain.db.get(Issue, "ISSUE-selected").status == "open"


def test_history_scope_cursor_and_original_runtime_access_are_enforced(domain, monkeypatch):
    value = domain.generate(generator="rules")
    from sop_manager.routers.sql_models import IssueDiagnosis

    row = domain.db.get(IssueDiagnosis, value["id"])
    row.data = {**row.data, "runtime_scopes": ["private-source-workspace"]}
    domain.db.commit()

    def deny(*args):
        raise HTTPException(403, "Workspace access revoked")

    monkeypatch.setattr(domain.evidence, "assert_evidence_access", deny)
    history = domain.module.diagnosis_history(
        domain.db, domain.project, domain.data, domain.user, "ISSUE-selected"
    )
    item = history["items"][0]
    assert item["restricted"] is True and item["snapshot"] is item["result"] is item["error"] is None
    assert item["actions"]["can_adopt"] is False
    with pytest.raises(HTTPException) as exc:
        domain.module.diagnosis_history(
            domain.db,
            domain.project,
            domain.data,
            domain.user,
            "ISSUE-selected",
            cursor="not-a-scoped-cursor",
        )
    assert exc.value.status_code == 422


def test_archive_and_version_changes_are_checked_before_provider(domain, monkeypatch):
    calls = gateway(monkeypatch, domain)
    with pytest.raises(HTTPException) as exc:
        domain.generate(expected_version=8)
    assert exc.value.status_code == 409 and not calls
    from sop_manager.project_write_guard import lifecycle_scope

    with lifecycle_scope(domain.db, "team", "selected"):
        domain.project.status = "archived"
        domain.db.commit()
    with pytest.raises(HTTPException) as exc:
        domain.generate()
    assert exc.value.status_code == 409 and not calls


def test_support_table_can_be_created_without_altering_existing_tables():
    from sop_manager.routers.sql_models import Base, IssueDiagnosis
    from sqlalchemy import create_engine, event, inspect
    from sqlalchemy.dialects import postgresql
    from sqlalchemy.schema import CreateTable

    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[table for table in Base.metadata.sorted_tables if table is not IssueDiagnosis.__table__],
    )

    def schema():
        return {
            table: [{**column, "type": str(column["type"])} for column in inspect(engine).get_columns(table)]
            for table in inspect(engine).get_table_names()
            if table != "issue_diagnoses"
        }

    old_columns = schema()
    statements = []
    event.listen(
        engine, "before_cursor_execute", lambda conn, cursor, statement, *args: statements.append(statement)
    )
    Base.metadata.create_all(engine)
    assert schema() == old_columns
    assert not any(statement.lstrip().upper().startswith("ALTER ") for statement in statements)
    columns = {item["name"] for item in inspect(engine).get_columns("issue_diagnoses")}
    assert {
        "id",
        "tenant_id",
        "project_id",
        "issue_id",
        "user_id",
        "request_hash",
        "status",
        "data",
        "created_at",
    } <= columns
    ddl = str(CreateTable(IssueDiagnosis.__table__).compile(dialect=postgresql.dialect()))
    assert "FOREIGN KEY(project_id) REFERENCES projects (id)" in ddl
    assert "data JSON" in ddl and "PRIMARY KEY (id)" in ddl
    engine.dispose()


def test_interrupted_provider_leaves_pending_receipt_and_original_replay_never_calls_again(
    domain, monkeypatch
):
    calls = []

    class ProcessInterrupted(BaseException):
        pass

    def interrupted(*args):
        calls.append("called")
        raise ProcessInterrupted("Process interrupted after provider may have accepted the request")

    monkeypatch.setattr(llm_gateway, "llm_chat", interrupted)
    with pytest.raises(ProcessInterrupted):
        domain.generate()
    value = domain.generate()
    assert value["status"] == "generating" and value["result"] is None
    assert value["actions"]["can_dismiss"] is True and calls == ["called"]
    assert domain.module.active_diagnosis_ids(domain.db, domain.project) == [value["id"]]


def test_selected_scope_and_issue_basis_are_checked_before_creating_receipt(domain, monkeypatch):
    from sop_manager.routers.sql_models import IssueDiagnosis

    calls = gateway(monkeypatch, domain)
    for change in (
        {"selected_evidence_ids": ["issue:ISSUE-other"]},
        {"selected_evidence_ids": ["issue:ISSUE-selected", "node:foreign-run"]},
        {"issue_basis": "b" * 64},
    ):
        with pytest.raises(HTTPException) as exc:
            domain.generate(**change)
        assert exc.value.status_code in {409, 422}
    assert not calls and domain.db.query(IssueDiagnosis).count() == 0


def test_permissions_are_rechecked_after_provider_and_revoked_writer_cannot_generate(domain, monkeypatch):
    from sop_manager.routers.sql_models import ProjectMember

    def revoke():
        with domain.sessions() as other:
            other.get(ProjectMember, ("selected", "writer")).role = "viewer"
            other.commit()

    gateway(monkeypatch, domain, during=revoke)
    value = domain.generate()
    assert value["status"] == "succeeded" and value["actions"]["can_adopt"] is False
    assert value["actions"]["can_dismiss"] is False
    with pytest.raises(HTTPException) as exc:
        domain.generate(idempotency_key="new-after-revocation")
    assert exc.value.status_code == 403


def test_history_is_scoped_paginates_without_duplicates_and_reading_changes_no_tables(domain):
    from sop_manager.routers.sql_models import Base
    from sqlalchemy import select

    for index in range(22):
        domain.generate(generator="rules", idempotency_key=f"history-entry-{index:03}")
    domain.db.commit()
    before = {
        table.name: [tuple(row) for row in domain.db.execute(select(table)).all()]
        for table in Base.metadata.sorted_tables
    }
    detail = domain.detail()
    first = domain.module.diagnosis_history(
        domain.db, domain.project, domain.data, domain.user, "ISSUE-selected"
    )
    second = domain.module.diagnosis_history(
        domain.db, domain.project, domain.data, domain.user, "ISSUE-selected", cursor=first["next_cursor"]
    )
    assert len(detail["diagnoses"]) == len(first["items"]) == 20 and len(second["items"]) == 2
    assert len({item["id"] for item in [*first["items"], *second["items"]]}) == 22
    assert second["next_cursor"] is None
    after = {
        table.name: [tuple(row) for row in domain.db.execute(select(table)).all()]
        for table in Base.metadata.sorted_tables
    }
    assert before == after
    with pytest.raises(HTTPException) as exc:
        domain.module.diagnosis_history(
            domain.db,
            domain.db.get(Project, "other"),
            domain.data,
            domain.user,
            "ISSUE-other",
            cursor=first["next_cursor"],
        )
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException) as exc:
        domain.module.issue_detail(
            domain.db, domain.db.get(Project, "other"), domain.data, domain.user, "ISSUE-selected", version=0
        )
    assert exc.value.status_code == 404


def test_restricted_history_cannot_be_adopted_and_selected_result_change_is_stale(domain, monkeypatch):
    from sop_manager.routers.delivery_issue_contract import IssueDiagnosisAdopt
    from sop_manager.routers.sql_models import IssueDiagnosis

    value = domain.generate(generator="rules")
    row = domain.db.get(IssueDiagnosis, value["id"])
    original = row.data
    row.data = {**row.data, "selected_evidence_digests": {"issue:ISSUE-selected": "a" * 64}}
    domain.db.commit()
    body = IssueDiagnosisAdopt(
        issue_id="ISSUE-selected",
        diagnosis_id=value["id"],
        issue_basis=value["issue_basis"],
        comment="Explicit review",
        title="Repair",
        description="Verify first",
        priority="P1",
        acceptance_criteria=["A repeatable check verifies the result"],
    )
    reviewer = domain.db.get(User, "product")
    with pytest.raises(HTTPException) as exc:
        domain.module.apply_issue_diagnosis(
            domain.db, domain.project, reviewer, domain.data, "issue.diagnosis.adopt", body
        )
    assert exc.value.status_code == 409
    row.data = {**original, "runtime_scopes": ["source-no-longer-readable"]}
    domain.db.commit()

    def deny(*args):
        raise HTTPException(403, "Original evidence access was revoked")

    monkeypatch.setattr(domain.evidence, "assert_evidence_access", deny)
    with pytest.raises(HTTPException) as exc:
        domain.module.apply_issue_diagnosis(
            domain.db, domain.project, reviewer, domain.data, "issue.diagnosis.adopt", body
        )
    assert exc.value.status_code == 403
    assert domain.db.query(Requirement).count() == 2


def test_malformed_deep_cursor_is_a_typed_client_error(domain):
    import base64

    cursor = base64.urlsafe_b64encode(("[" * 2000 + "0" + "]" * 2000).encode()).decode()
    with pytest.raises(HTTPException) as exc:
        domain.module.diagnosis_history(
            domain.db, domain.project, domain.data, domain.user, "ISSUE-selected", cursor=cursor
        )
    assert exc.value.status_code == 422


def test_deleted_issue_does_not_make_pending_proposal_impossible_to_dismiss(domain, monkeypatch):
    from sop_manager.routers.delivery_issue_contract import IssueDiagnosisDismiss
    from sop_manager.routers.sql_models import IssueDiagnosis

    class ProcessInterrupted(BaseException):
        pass

    def interrupted(*args):
        raise ProcessInterrupted()

    monkeypatch.setattr(llm_gateway, "llm_chat", interrupted)
    with pytest.raises(ProcessInterrupted):
        domain.generate()
    row = domain.db.query(IssueDiagnosis).one()
    domain.db.delete(domain.db.get(Issue, "ISSUE-selected"))
    domain.db.commit()
    detail = domain.module.diagnosis_detail(domain.db, domain.project, domain.user, row.issue_id, row.id)
    assert detail["current"] is False and detail["actions"]["can_adopt"] is False
    assert detail["actions"]["can_dismiss"] is True
    assert "issue_diagnosis_source_missing" in {reason["code"] for reason in detail["actions"]["reasons"]}
    assert detail["snapshot"]["issue"]["id"] == "ISSUE-selected"
    result = domain.module.apply_issue_diagnosis(
        domain.db,
        domain.project,
        domain.user,
        domain.data,
        "issue.diagnosis.dismiss",
        IssueDiagnosisDismiss(
            issue_id=row.issue_id,
            diagnosis_id=row.id,
            issue_basis=row.data["issue_basis"],
            comment="Discard unfinished proposal after issue deletion",
        ),
    )
    domain.db.flush()
    assert result[2]["decision"] == "cancelled"
    assert domain.module.active_diagnosis_ids(domain.db, domain.project) == []


def test_concurrent_same_request_observes_committed_intent_while_provider_holds_no_sql_lock(
    domain, monkeypatch, tmp_path
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from sop_manager.routers.delivery_issue_contract import IssueDiagnosisGenerate
    from sop_manager.routers.sql_models import Base, IssueDiagnosis, ProjectMember, Tenant
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(
        "sqlite:///" + str(tmp_path / "receipt-concurrency.sqlite"),
        connect_args={"check_same_thread": False, "timeout": 5},
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    with sessions() as db:
        unusable_hash = "not-a-login"
        db.add(Tenant(id="concurrent", name="concurrent", slug="concurrent"))
        db.add(
            User(
                id="concurrent-user",
                tenant_id="concurrent",
                username="member",
                password_hash=unusable_hash,
                role="developer",
                status="active",
            )
        )
        db.add(
            Project(
                id="concurrent-project",
                tenant_id="concurrent",
                name="Concurrent project",
                project_path=str(tmp_path),
            )
        )
        db.flush()
        db.add(ProjectMember(project_id="concurrent-project", user_id="concurrent-user", role="developer"))
        db.add(
            Issue(
                id="concurrent-issue",
                tenant_id="concurrent",
                project_id="concurrent-project",
                title="Concurrent receipt",
            )
        )
        db.commit()
        project, user = db.get(Project, "concurrent-project"), db.get(User, "concurrent-user")
        detail = domain.module.issue_detail(db, project, initial_state(), user, "concurrent-issue", version=0)
        body = IssueDiagnosisGenerate(
            expected_version=0,
            issue_basis=detail["issue_basis"],
            selected_evidence_ids=["issue:concurrent-issue"],
            idempotency_key="concurrent-original-key",
        )
    entered, release = Event(), Event()
    calls = []

    def delayed_provider(body, request):
        calls.append("provider")
        entered.set()
        if not release.wait(10):
            raise RuntimeError("Test did not release provider")
        result = output()
        for entry in [*result["hypotheses"], *result["checks"]]:
            entry["evidence_ids"] = ["issue:concurrent-issue"]
        return llm_gateway.ChatOut(
            model="fixture",
            provider="fixture",
            content=json.dumps(result),
            usage=llm_gateway.ChatUsage(total_tokens=2),
        )

    monkeypatch.setattr(llm_gateway, "llm_chat", delayed_provider)

    def send():
        with sessions() as db:
            return domain.module.generate_diagnosis(
                db,
                db.get(Project, "concurrent-project"),
                db.get(User, "concurrent-user"),
                "concurrent-issue",
                body,
                domain.request,
            )

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(send)
            try:
                assert entered.wait(10), "Provider was never entered"
                replay = send()
                assert replay["status"] == "generating" and calls == ["provider"]
                # A separate connection can make a project write during provider work.
                with sessions() as db:
                    db.get(
                        Project, "concurrent-project"
                    ).description = "Edited without waiting for the provider"
                    db.commit()
                    assert db.query(IssueDiagnosis).count() == 1
            finally:
                release.set()
            assert future.result(timeout=10)["status"] == "succeeded"
        with sessions() as db:
            assert db.query(IssueDiagnosis).count() == 1
    finally:
        engine.dispose()
