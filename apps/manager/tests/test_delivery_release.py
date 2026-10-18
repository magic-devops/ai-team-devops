"""Immutable project releases consume canonical quality and verified CI evidence."""

import base64
import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException
from sop_manager.routers.delivery_ci import pae
from sop_manager.routers.delivery_ci_contract import ReleaseCiImport, ReleasePolicySave
from sop_manager.routers.delivery_contract import default_flow
from sop_manager.routers.delivery_release import (
    _candidate_view,
    _permissions,
    apply_release,
    preview,
    quality,
    reconcile_releases,
    release_detail,
)
from sop_manager.routers.delivery_release_contract import (
    QualityRequirement,
    QualityTask,
    ReleaseCandidate,
    ReleaseCandidateCreate,
    ReleaseCandidateReview,
    ReleaseCandidateRevoke,
    ReleaseCiEvidence,
    ReleasePreviewInput,
    ReleasePreviewResponse,
)
from sop_manager.routers.delivery_service import initial_state, remember_basis
from sop_manager.routers.delivery_verification import VerificationContext
from sop_manager.routers.sql_models import (
    DeliveryTaskReview,
    DeliveryWorkspace,
    Issue,
    Project,
    ProjectMember,
    Requirement,
    Task,
    User,
)
from sqlalchemy import update
from test_delivery_workbench import env as delivery_env

env = delivery_env


@pytest.fixture
def scope(env):
    _, sessions, _ = env
    data = initial_state()
    with sessions() as db:
        db.add(
            Requirement(
                id="R-release",
                tenant_id="tenant",
                project_id="project",
                title="Release scope",
                description="Current requirement",
                acceptance_criteria=["Accepted condition"],
                status="completed",
            )
        )
        db.flush()
        db.add(
            Task(
                id="T-release",
                tenant_id="tenant",
                project_id="project",
                req_id="R-release",
                title="Accepted work",
                owner_id="user:lead",
                acceptance_criteria=["Task condition"],
                status="completed",
            )
        )
        db.commit()
    data["flows"]["R-release"] = {
        **default_flow(),
        "stage": "release",
        "reviews": [
            {
                "stage": "acceptance",
                "revision": 1,
                "decision": "approved",
                "actor": "lead",
                "at": "2026-10-17T00:00:00Z",
                "comment": "Accepted",
            }
        ],
        "artifacts": [
            {"id": "manual-test", "revision": 1, "kind": "test", "result": "passed", "source": "manual"}
        ],
    }
    return sessions, data


def test_quality_catalogue_never_implicitly_selects_a_scope(scope):
    sessions, data = scope
    before = deepcopy(data)
    with sessions() as db:
        result = quality(db, db.get(Project, "project"), data)
    assert result["scope_basis"] is None
    assert result["selected"] == {"requirement_ids": [], "task_ids": []}
    assert result["requirements"][0]["id"] == "R-release"
    assert data == before


def test_selected_requirement_contains_every_task_and_rejects_omission(scope):
    sessions, data = scope
    with sessions() as db:
        db.add(
            Task(
                id="T-unverified",
                tenant_id="tenant",
                project_id="project",
                req_id="R-release",
                title="Not done",
                owner_id="user:lead",
                acceptance_criteria=["Pending condition"],
                status="pending",
            )
        )
        db.commit()
        result = quality(db, db.get(Project, "project"), data, requirement_ids=["R-release"])
    assert not result["eligible"]
    assert len(result["scope_basis"]) == 64
    assert result["requirements"][0]["task_ids"] == ["T-release", "T-unverified"]
    assert any(reason["code"] == "task_unverified" for reason in result["reasons"])


def test_scope_rejects_missing_foreign_and_linked_task_ids(scope):
    sessions, data = scope
    with sessions() as db:
        project = db.get(Project, "project")
        for values in (
            {"requirement_ids": ["missing"]},
            {"task_ids": ["T-release"]},
            {"requirement_ids": ["R-release", "R-release"]},
        ):
            with pytest.raises(HTTPException) as denied:
                quality(db, project, data, **values)
            assert denied.value.status_code in {404, 422}


def test_high_priority_issue_changes_scope_basis_and_blocks_quality(scope):
    sessions, data = scope
    with sessions() as db:
        project = db.get(Project, "project")
        before = quality(db, project, data, requirement_ids=["R-release"])
        assert before["eligible"]
        db.add(
            Issue(
                id="I-critical",
                tenant_id="tenant",
                project_id="project",
                task_id="T-release",
                title="Regression",
                severity="P1",
                status="open",
            )
        )
        db.commit()
        after = quality(db, project, data, requirement_ids=["R-release"])
    assert not after["eligible"]
    assert after["scope_basis"] != before["scope_basis"]
    assert after["requirements"][0]["issues"][0]["id"] == "I-critical"


@pytest.fixture
def trusted(scope):
    sessions, data = scope
    key = Ed25519PrivateKey.from_private_bytes(bytes(range(32)))
    with sessions() as db:
        apply_release(
            db,
            db.get(Project, "project"),
            db.get(User, "lead"),
            data,
            "release.policy.save",
            policy_body(key),
        )
    return sessions, data, key


def policy_body(key, workflow="release-build"):
    return ReleasePolicySave(
        repository="https://example.test/team/repository",
        workflow=workflow,
        public_keys=[base64.b64encode(key.public_key().public_bytes_raw()).decode()],
    )


def signed_ci(
    db,
    project,
    data,
    key,
    *,
    run=1,
    attempt=1,
    passed=True,
    selected=None,
    commit="b" * 40,
    artifact="a" * 64,
):
    selected = selected or {"requirement_ids": ["R-release"], "task_ids": []}
    current = quality(db, project, data, **selected)
    policy = data["release_policy"]
    statement = {
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [{"name": "release.tar.gz", "digest": {"sha256": artifact}}],
        "predicateType": "urn:sop:delivery:ci-evidence:v1",
        "predicate": {
            "tenant_id": project.tenant_id,
            "project_id": project.id,
            "policy_generation": policy["generation"],
            "repository": policy["repository"],
            "workflow": policy["workflow"],
            "commit_sha": commit,
            "run_uri": f"https://example.test/ci/{run}/{attempt}",
            "run_number": run,
            "run_attempt": attempt,
            "scope_basis": current["scope_basis"],
            "build_result": "passed" if passed else "failed",
            "tests": {"total": 3, "failed": 0 if passed else 1, "errors": 0, "skipped": 0},
            "finished_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    raw = json.dumps(statement, ensure_ascii=False).encode()
    public = key.public_key().public_bytes_raw()
    envelope = json.dumps(
        {
            "payloadType": "application/vnd.in-toto+json",
            "payload": base64.b64encode(raw).decode(),
            "signatures": [
                {
                    "keyid": hashlib.sha256(public).hexdigest(),
                    "sig": base64.b64encode(key.sign(pae("application/vnd.in-toto+json", raw))).decode(),
                }
            ],
        }
    )
    return ReleaseCiImport(envelope=envelope, **selected)


def import_ci(db, project, user, data, key, **options):
    body = signed_ci(db, project, data, key, **options)
    resource_id, _, _ = apply_release(db, project, user, data, "release.ci.import", body)
    return resource_id, body


def candidate_input(ci_id, **changes):
    return ReleasePreviewInput(
        requirement_ids=["R-release"],
        task_ids=[],
        version="1.0.0",
        environment="staging",
        ci_evidence_id=ci_id,
        artifact_url="https://example.test/artifacts/release.tar.gz",
        release_notes="Current accepted scope",
        rollback_plan="Restore previous verified artifact",
        **changes,
    )


def create_candidate(db, project, user, data, ci_id):
    body = candidate_input(ci_id)
    proposal = preview(db, project, data, user, body, version=9)
    assert proposal["allowed"], proposal["reasons"]
    ReleasePreviewResponse.model_validate(proposal)
    resource_id, _, _ = apply_release(
        db,
        project,
        user,
        data,
        "release.candidate.create",
        ReleaseCandidateCreate(**body.model_dump(), preview_basis=proposal["preview_basis"]),
    )
    return resource_id


def test_signed_ci_to_candidate_review_has_typed_history_and_never_deploys(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        release_id = create_candidate(db, project, user, data, ci_id)
        original = deepcopy(data["release_candidates"][0]["snapshot"])
        detail = release_detail(db, project, data, user, release_id, version=10)
        ReleaseCandidate.model_validate(detail["candidate"])
        ReleaseCiEvidence.model_validate(detail["evidence"])
        assert detail["candidate"]["permissions"]["can_approve"]
        apply_release(
            db,
            project,
            user,
            data,
            "release.candidate.review",
            ReleaseCandidateReview(
                id=release_id,
                decision="approve",
                comment="Verified current signed build",
                review_basis=detail["candidate"]["review_basis"],
            ),
        )
        candidate = _candidate_view(db, project, data, user, data["release_candidates"][0])
        ReleaseCandidate.model_validate(candidate)
        current = quality(db, project, data, requirement_ids=["R-release"])
        for item in current["tasks"]:
            QualityTask.model_validate(item)
        for item in current["requirements"]:
            QualityRequirement.model_validate(item)
    assert candidate["status"] == "approved" and candidate["valid"]
    assert candidate["snapshot"] == original
    assert candidate["deployment"] == {"status": "not_handed_off", "verified": False, "deployment_id": None}
    assert candidate["reviews"][0]["actor"] == {"id": "lead", "name": "lead"}
    assert data["flows"]["R-release"]["stage"] == "release"


def test_ci_duplicate_same_envelope_returns_existing_record_and_sequence_is_monotonic(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, body = import_ci(db, project, user, data, key, run=3)
        assert apply_release(db, project, user, data, "release.ci.import", body)[0] == ci_id
        assert len(data["ci_evidence"]) == 1
        for options in ({"run": 2}, {"run": 3, "artifact": "d" * 64}):
            with pytest.raises(HTTPException) as denied:
                import_ci(db, project, user, data, key, **options)
            assert denied.value.status_code == 409
        import_ci(db, project, user, data, key, run=3, attempt=2)
    assert len(data["ci_evidence"]) == 2


def test_new_failed_ci_permanently_invalidates_old_candidate_even_after_new_pass(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        release_id = create_candidate(db, project, user, data, ci_id)
        original = deepcopy(data["release_candidates"][0]["snapshot"])
        failed_id, _ = import_ci(db, project, user, data, key, run=2, passed=False)
        assert not data["ci_evidence"][-1]["passed"]
        failed_preview = preview(db, project, data, user, candidate_input(failed_id), version=0)
        assert any(reason["code"] == "release_ci_failed" for reason in failed_preview["reasons"])
        import_ci(db, project, user, data, key, run=3)
        result = release_detail(db, project, data, user, release_id, version=0)["candidate"]
    assert result["status"] == "stale" and result["invalidated"]
    assert result["snapshot"] == original
    assert not result["permissions"]["can_approve"]


def test_policy_aba_is_new_generation_and_cannot_revive_candidate(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        create_candidate(db, project, user, data, ci_id)
        with pytest.raises(HTTPException) as unchanged:
            apply_release(db, project, user, data, "release.policy.save", policy_body(key))
        assert unchanged.value.detail["code"] == "release_policy_unchanged"
        apply_release(db, project, user, data, "release.policy.save", policy_body(key, "different-workflow"))
        apply_release(db, project, user, data, "release.policy.save", policy_body(key))
    assert data["release_policy"]["generation"] == 3
    assert data["release_candidates"][0]["invalidated"]


def test_task_scope_aba_invalidates_candidate_without_mutating_original_snapshot(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        create_candidate(db, project, user, data, ci_id)
        original = deepcopy(data["release_candidates"][0]["snapshot"])
        task = db.get(Task, "T-release")
        task.acceptance_criteria = ["Changed condition"]
        db.flush()
        reconcile_releases(db, project, data)
        task.acceptance_criteria = ["Task condition"]
        db.flush()
        reconcile_releases(db, project, data)
    assert data["release_candidates"][0]["invalidated"]
    assert data["release_candidates"][0]["snapshot"] == original


def test_renaming_owner_keeps_scope_preview_and_original_candidate_labels(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        body = candidate_input(ci_id)
        original = preview(db, project, data, user, body, version=1)
        user.username = "Renamed lead"
        db.flush()
        changed = preview(db, project, data, user, body, version=500)
        assert changed["preview_basis"] == original["preview_basis"]
        assert changed["snapshot"]["quality"]["scope_basis"] == original["snapshot"]["quality"]["scope_basis"]
        release_id = create_candidate(db, project, user, data, ci_id)
        snapshot = deepcopy(data["release_candidates"][0]["snapshot"])
        user.username = "lead"
        db.flush()
        reconcile_releases(db, project, data)
        assert release_detail(db, project, data, user, release_id, version=0)["candidate"]["valid"]
        assert data["release_candidates"][0]["snapshot"] == snapshot


def test_fixed_preview_and_review_basis_reject_changed_input_or_prior_review(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        body = candidate_input(ci_id)
        proposal = preview(db, project, data, user, body, version=0)
        with pytest.raises(HTTPException) as stale:
            apply_release(
                db,
                project,
                user,
                data,
                "release.candidate.create",
                ReleaseCandidateCreate(
                    **{**body.model_dump(), "release_notes": "Different content"},
                    preview_basis=proposal["preview_basis"],
                ),
            )
        assert stale.value.detail["code"] == "release_preview_changed"
        release_id = create_candidate(db, project, user, data, ci_id)
        detail = release_detail(db, project, data, user, release_id, version=0)
        review = ReleaseCandidateReview(
            id=release_id,
            decision="approve",
            comment="Reviewed",
            review_basis=detail["candidate"]["review_basis"],
        )
        apply_release(db, project, user, data, "release.candidate.review", review)
        with pytest.raises(HTTPException) as repeated:
            apply_release(db, project, user, data, "release.candidate.review", review)
        assert repeated.value.detail["code"] == "release_review_changed"


def test_candidate_version_environment_stays_reserved_after_rejection_and_revoke_is_terminal(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        release_id = create_candidate(db, project, user, data, ci_id)
        view = release_detail(db, project, data, user, release_id, version=0)["candidate"]
        apply_release(
            db,
            project,
            user,
            data,
            "release.candidate.revoke",
            ReleaseCandidateRevoke(
                id=release_id, comment="Withdraw for another version", review_basis=view["review_basis"]
            ),
        )
        latest = release_detail(db, project, data, user, release_id, version=0)["candidate"]
        assert latest["status"] == "revoked" and not any(latest["permissions"].values())
        proposal = preview(db, project, data, user, candidate_input(ci_id), version=0)
        assert any(reason["code"] == "release_version_used" for reason in proposal["reasons"])


def test_approver_role_revocation_aba_is_permanent_and_preserves_signed_and_human_history(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        unusable_hash = "not-a-login"
        approver = User(
            id="release-reviewer",
            tenant_id="tenant",
            username="Release reviewer",
            role="developer",
            status="active",
            password_hash=unusable_hash,
        )
        db.add(approver)
        db.flush()
        membership = ProjectMember(project_id=project.id, user_id=approver.id, role="project_admin")
        db.add(membership)
        db.flush()
        ci_id, _ = import_ci(db, project, user, data, key)
        release_id = create_candidate(db, project, user, data, ci_id)
        view = release_detail(db, project, data, approver, release_id, version=0)["candidate"]
        apply_release(
            db,
            project,
            approver,
            data,
            "release.candidate.review",
            ReleaseCandidateReview(
                id=release_id,
                decision="approve",
                comment="Independent review",
                review_basis=view["review_basis"],
            ),
        )
        original = deepcopy(data["release_candidates"][0])
        membership.role = "viewer"
        db.flush()
        reconcile_releases(db, project, data)
        membership.role = "project_admin"
        db.flush()
        reconcile_releases(db, project, data)
    changed = data["release_candidates"][0]
    assert changed["invalidated"] and changed["decision"] == "approved"
    assert changed["snapshot"] == original["snapshot"] and changed["reviews"] == original["reviews"]
    assert any(reason["code"] == "release_approver_unavailable" for reason in changed["invalidated_reasons"])


def test_independent_task_requires_current_real_manual_acceptance(scope):
    sessions, data = scope
    with sessions() as db:
        project = db.get(Project, "project")
        task = Task(
            id="T-independent",
            tenant_id="tenant",
            project_id="project",
            title="Independent",
            owner_id="user:lead",
            acceptance_criteria=["Own condition"],
            status="completed",
        )
        db.add(task)
        db.flush()
        assert not quality(db, project, data, task_ids=[task.id])["eligible"]
        context = VerificationContext(db, project, data)
        db.add(
            DeliveryTaskReview(
                id="manual-independent",
                tenant_id="tenant",
                project_id="project",
                task_id=task.id,
                reviewer_id="lead",
                reviewer_name="lead",
                decision="accept",
                task_basis=context.basis(task.id),
                snapshot=context.snapshot(task.id),
                comment="Checked own conditions",
                evidence_content="Human evidence",
            )
        )
        db.flush()
        current = quality(db, project, data, task_ids=[task.id])
    assert current["eligible"] and current["independent_tasks"][0]["proof"]["source"] == "manual"


def test_legacy_release_history_never_becomes_candidate_or_deployment(trusted):
    from sop_manager.routers.delivery_progress_facts import evaluate_project
    from sop_manager.routers.delivery_query_index import replace_from_evaluation
    from sop_manager.routers.delivery_release_query import release_page

    sessions, data, _ = trusted
    data["flows"]["R-release"]["releases"] = [
        {"revision": 1, "version": "old", "verification": "Manual text"}
    ]
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        db.add(DeliveryWorkspace(project_id=project.id, tenant_id=project.tenant_id, data=deepcopy(data), version=0))
        db.flush()
        replace_from_evaluation(db, project, evaluate_project(db, project, data))
        result = release_page(db, project, user, "legacy")
        assert release_page(db, project, user, "candidate")["total"] == 0
    assert result["total"] == 1
    assert result["items"][0]["kind"] == "legacy"
    assert not {"snapshot", "review_basis", "deployment", "record"} & result["items"][0].keys()


def test_index_and_unknown_detail_are_pure_and_do_not_choose_first_candidate(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        create_candidate(db, project, user, data, ci_id)
        before = deepcopy(data)
        _candidate_view(db, project, data, user, data["release_candidates"][0])
        with pytest.raises(HTTPException) as missing:
            release_detail(db, project, data, user, "unknown-nonempty-id", version=0)
        assert missing.value.status_code == 404
        assert data == before


@pytest.mark.parametrize("archived", [False, True])
def test_real_user_disable_restore_hook_latches_approval_without_task_or_membership_identity(
    trusted, archived
):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        unusable_hash = "not-a-login"
        approver = User(
            id="approval-only-admin",
            tenant_id="tenant",
            username="Release admin",
            role="tenant_admin",
            status="active",
            password_hash=unusable_hash,
        )
        db.add(approver)
        db.commit()
        assert db.get(ProjectMember, (project.id, approver.id)) is None
        ci_id, _ = import_ci(db, project, user, data, key)
        release_id = create_candidate(db, project, user, data, ci_id)
        view = release_detail(db, project, data, approver, release_id, version=0)["candidate"]
        apply_release(
            db,
            project,
            approver,
            data,
            "release.candidate.review",
            ReleaseCandidateReview(
                id=release_id,
                decision="approve",
                comment="Approved by a project-authorized admin",
                review_basis=view["review_basis"],
            ),
        )
        remember_basis(db, project, data)
        db.add(DeliveryWorkspace(project_id=project.id, tenant_id="tenant", version=1, data=deepcopy(data)))
        db.commit()
        original = deepcopy(db.get(DeliveryWorkspace, project.id).data["release_candidates"][0])
    if archived:
        with sessions.kw["bind"].begin() as connection:
            connection.execute(update(Project).where(Project.id == "project").values(status="archived"))
    with sessions() as db:
        db.get(User, "approval-only-admin").status = "disabled"
        db.commit()
    with sessions() as db:
        changed = deepcopy(db.get(DeliveryWorkspace, "project").data["release_candidates"][0])
        assert changed["invalidated"]
        assert any(
            reason["code"] == "release_approver_unavailable" for reason in changed["invalidated_reasons"]
        )
        db.get(User, "approval-only-admin").status = "active"
        db.commit()
    with sessions() as db:
        final = db.get(DeliveryWorkspace, "project").data["release_candidates"][0]
        assert final == changed
        assert final["snapshot"] == original["snapshot"] and final["reviews"] == original["reviews"]
        assert db.get(Task, "T-release").owner_id == "user:lead"
        assert db.get(Project, "project").status == ("archived" if archived else "active")


def test_archived_direct_domain_write_is_409_and_history_remains_readable(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        create_candidate(db, project, user, data, ci_id)
        db.connection().execute(
            update(Project.__table__).where(Project.id == project.id).values(status="archived")
        )
        db.expire(project)
        original = deepcopy(data)
        with pytest.raises(HTTPException) as denied:
            apply_release(db, project, user, data, "release.policy.save", policy_body(key, "different"))
        assert denied.value.status_code == 409
        assert denied.value.detail["code"] == "project_archived"
        assert data == original
        assert not any(_permissions(db, project, user).values())
        assert _candidate_view(db, project, data, user, data["release_candidates"][0])["valid"]


def test_unrelated_commit_and_plain_date_change_preserve_candidate(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        release_id = create_candidate(db, project, user, data, ci_id)
        original = deepcopy(data["release_candidates"][0])
        data.setdefault("task_details", {})["T-release"] = {
            "starts_on": "2026-10-18",
            "ends_on": "2026-10-19",
        }
        import_ci(db, project, user, data, key, commit="e" * 40)
        current = release_detail(db, project, data, user, release_id, version=0)["candidate"]
    assert current["valid"] and data["release_candidates"][0] == original


def test_release_permissions_never_grant_runtime_or_write_access_to_reader(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        create_candidate(db, project, user, data, ci_id)
        reader = db.get(User, "reader")
        original = deepcopy(data)
        assert not any(_permissions(db, project, reader).values())
        assert not preview(db, project, data, reader, candidate_input(ci_id), version=0)["allowed"]
        with pytest.raises(HTTPException) as denied:
            apply_release(db, project, reader, data, "release.policy.save", policy_body(key, "different"))
        assert denied.value.status_code == 403
        assert data == original


@pytest.mark.parametrize("action", ["release.candidate.revoke", "release.candidate.review"])
def test_pure_stale_projection_can_be_explicitly_closed_using_fixed_review_basis(trusted, action):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        release_id = create_candidate(db, project, user, data, ci_id)
        # An external direct Engine write has no application capture hook.
        db.connection().execute(
            update(Task.__table__).where(Task.id == "T-release").values(description="External change")
        )
        db.expire_all()
        read_projection = deepcopy(data)
        reconcile_releases(db, project, read_projection)
        current = release_detail(db, project, read_projection, user, release_id, version=1)["candidate"]
        assert current["status"] == "stale"
        command_state = deepcopy(data)
        body = {
            "id": release_id,
            "comment": "Close obsolete candidate",
            "review_basis": current["review_basis"],
        }
        if action == "release.candidate.revoke":
            body = ReleaseCandidateRevoke(**body)
        else:
            body = ReleaseCandidateReview(**body, decision="reject")
        apply_release(db, project, user, command_state, action, body)
        assert command_state["release_candidates"][0]["decision"] == (
            "revoked" if action.endswith("revoke") else "rejected"
        )
        assert data["release_candidates"][0]["decision"] == "pending"
