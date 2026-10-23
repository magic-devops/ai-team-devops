"""Release source association behavior definitions; runtime execution is deferred."""
from copy import deepcopy

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sop_manager.routers.delivery_ci_types import CiInput
from sop_manager.routers.delivery_release_sources import prepare_source_packet, validate_source_packet
from sop_manager.routers.delivery_release_sources_contract import ReleaseSourceMapping, ReleaseSourcePacketInput
from sop_manager.routers.delivery_release import quality, apply_release, preview, release_detail
from sop_manager.routers.sql_models import Project, User
from test_delivery_release import env, scope, trusted, signed_ci, candidate_input, import_ci, create_candidate  # noqa: F401


def proposal(current, *, kind="change"):
    return ReleaseSourcePacketInput(
        **current["selected"], scope_basis=current["scope_basis"], policy_generation=1,
        mappings=[{"task_id": row["id"], "kind": kind,
            "base_commit": "a" * 40 if kind == "change" else None,
            "accepted_commit": "b" * 40 if kind == "change" else None,
            "comment": "Reviewed exact implementation" if kind == "change" else "Documentation task, no code change"}
            for row in current["tasks"]],
    )


def test_packet_covers_every_selected_task_and_fixes_current_acceptance(trusted):
    sessions, data, _ = trusted
    original = deepcopy(data)
    with sessions() as db:
        project = db.get(Project, "project")
        current = quality(db, project, data, requirement_ids=["R-release"])
        packet = prepare_source_packet(db, project, data, proposal(current))
        assert packet["bindings"][0]["task_id"] == "T-release"
        assert packet["bindings"][0]["task_basis"] == current["tasks"][0]["basis"]
        assert len(packet["bindings"][0]["proof_basis"]) == 64
        validate_source_packet(packet, current, data["release_policy"], project)
    assert data == original


@pytest.mark.parametrize("field,value", [("proof_basis", "c" * 64), ("task_basis", "d" * 64), ("task_id", "foreign")])
def test_import_rejects_a_packet_for_another_acceptance(trusted, field, value):
    sessions, data, _ = trusted
    with sessions() as db:
        project = db.get(Project, "project")
        current = quality(db, project, data, requirement_ids=["R-release"])
        packet = prepare_source_packet(db, project, data, proposal(current))
        packet["bindings"][0][field] = value
        with pytest.raises(HTTPException) as denied:
            validate_source_packet(packet, current, data["release_policy"], project)
        assert denied.value.status_code == 422


def test_missing_task_duplicate_task_and_stale_scope_are_not_auto_completed(trusted):
    sessions, data, _ = trusted
    with sessions() as db:
        project = db.get(Project, "project")
        current = quality(db, project, data, requirement_ids=["R-release"])
        body = proposal(current)
        for changes in ({"mappings": []}, {"mappings": body.mappings * 2}, {"scope_basis": "c" * 64}):
            changed = body.model_copy(update=changes)
            with pytest.raises(HTTPException):
                prepare_source_packet(db, project, data, changed)


def test_non_code_association_has_an_explicit_reason_and_no_commit(trusted):
    sessions, data, _ = trusted
    with sessions() as db:
        project = db.get(Project, "project")
        current = quality(db, project, data, requirement_ids=["R-release"])
        packet = prepare_source_packet(db, project, data, proposal(current, kind="no_code_change"))
        assert packet["bindings"][0]["base_commit"] is None
        assert packet["bindings"][0]["comment"] == "Documentation task, no code change"


def test_multiline_rationale_survives_current_packet_generation_and_validation(trusted):
    sessions, data, _ = trusted
    comment = "Documentation checked\r\n\tNo runtime code changes 😀"
    with sessions() as db:
        project = db.get(Project, "project")
        current = quality(db, project, data, requirement_ids=["R-release"])
        body = proposal(current, kind="no_code_change").model_dump(mode="json")
        body["mappings"][0]["comment"] = comment
        packet = prepare_source_packet(db, project, data, ReleaseSourcePacketInput.model_validate(body))
        validate_source_packet(packet, current, data["release_policy"], project)
        assert packet["bindings"][0]["comment"] == comment


@pytest.mark.parametrize("invalid", ["Bad\x00", "Bad\x0b", "Bad\x7f", "Bad\ud800", "\n\t"])
def test_source_rationale_still_rejects_invalid_text(invalid):
    with pytest.raises(ValidationError):
        ReleaseSourceMapping(task_id="T-one", kind="no_code_change", comment=invalid)


@pytest.mark.parametrize("control", ["\n", "\r", "\t", "\x00", "\x7f"])
def test_ci_identifiers_and_other_scalar_text_do_not_gain_multiline_permission(control):
    class CiScalar(CiInput):
        text: str

    with pytest.raises(ValidationError):
        CiScalar(text="Fixed" + control + "identity")
    with pytest.raises(ValidationError):
        ReleaseSourceMapping(task_id="T" + control + "one", kind="no_code_change", comment="Valid rationale")


def test_changed_source_packet_is_not_covered_by_the_old_ci_signature(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        body = signed_ci(db, project, data, key)
        body.source_packet.bindings[0].comment = "A different association rationale"
        with pytest.raises(HTTPException) as denied:
            apply_release(db, project, user, data, "release.ci.import", body)
        assert denied.value.detail["code"] == "release_source_trace_mismatch"
        assert not data["ci_evidence"]


def test_old_signed_original_remains_readable_but_cannot_create_or_approve(trusted):
    sessions, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, "project"), db.get(User, "lead")
        ci_id, _ = import_ci(db, project, user, data, key)
        release_id = create_candidate(db, project, user, data, ci_id)
        # Model an actual historical original, without inventing new source proof.
        data["ci_evidence"][0].pop("source_packet")
        data["ci_evidence"][0]["statement"]["predicate"].pop("source_trace")
        data["release_candidates"][0]["snapshot"]["ci"].pop("source_packet")
        detail = release_detail(db, project, data, user, release_id, version=0)
        assert detail["evidence"]["source_packet"] is None
        assert not detail["candidate"]["permissions"]["can_approve"]
        assert any(row["code"] == "release_source_trace_missing" for row in detail["candidate"]["reasons"])
        result = preview(db, project, data, user, candidate_input(ci_id), version=0)
        assert not result["allowed"]
