"""Pure packet preparation and current acceptance checks; never writes or runs Git."""
import hashlib
import json

from fastapi import HTTPException
from pydantic import ValidationError

from .delivery_release_sources_contract import ReleaseSourcePacket


def source_packet_digest(packet):
    return hashlib.sha256(json.dumps(packet, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False).encode("utf-8")).hexdigest()


def _deny(code, message, status=422):
    raise HTTPException(status, {"code": code, "message": message})


def _packet(current, policy, project, mappings):
    from .delivery_verification import fingerprint

    if not policy:
        _deny("release_policy_missing", "Configure the CI repository and trust policy first.")
    if not current["eligible"]:
        _deny("release_source_quality_unverified", "Complete effective acceptance for the entire scope first.")
    required = set(current["selected"]["task_ids"])
    required.update(tid for row in current["requirements"]
        if row["id"] in current["selected"]["requirement_ids"] for tid in row["task_ids"])
    tasks = {row["id"]: row for row in current["tasks"] if row["id"] in required}
    if (not required or len(required) > 500 or len(mappings) != len(required)
            or {row["task_id"] for row in mappings} != required or set(tasks) != required):
        _deny("release_source_coverage_invalid", "Choose exactly one explicit source association for every included task.")
    bindings = [{**row, "task_basis": tasks[row["task_id"]]["basis"],
        "proof_basis": fingerprint(tasks[row["task_id"]]["proof"])} for row in mappings]
    return ReleaseSourcePacket.model_validate({
        "schema_version": 1, "tenant_id": project.tenant_id, "project_id": project.id,
        "repository": policy["repository"], "workflow": policy["workflow"], "policy_generation": policy["generation"],
        "scope_basis": current["scope_basis"], **current["selected"],
        "bindings": sorted(bindings, key=lambda row: row["task_id"]),
    }).model_dump(mode="json")


def prepare_source_packet(db, project, data, body, *, current=None):
    from .delivery_release import quality

    current = current or quality(db, project, data, requirement_ids=body.requirement_ids, task_ids=body.task_ids)
    if body.policy_generation != (data.get("release_policy") or {}).get("generation"):
        _deny("release_policy_changed", "Reload the current CI repository and policy before preparing a packet.", 409)
    if body.scope_basis != current["scope_basis"]:
        _deny("release_scope_changed", "Reload and inspect the current acceptance scope before preparing source associations.", 409)
    try:
        return _packet(current, data.get("release_policy"), project, [row.model_dump(mode="json") for row in body.mappings])
    except (ValidationError, ValueError, UnicodeError):
        _deny("release_source_packet_invalid", "Source associations exceed the canonical packet limits.")


def validate_source_packet(packet, current, policy, project):
    try:
        value = ReleaseSourcePacket.model_validate(packet).model_dump(mode="json")
        fields = {"task_id", "kind", "base_commit", "accepted_commit", "comment"}
        mappings = [{key: row[key] for key in fields} for row in value["bindings"]]
        expected = _packet(current, policy, project, mappings)
    except (ValidationError, TypeError, KeyError, ValueError, UnicodeError):
        _deny("release_source_packet_invalid", "The source packet must be complete and canonical.")
    if value != expected:
        _deny("release_source_packet_changed", "Source associations do not match the current repository, scope and effective acceptance.")
    return value


def source_trace_reasons(statement, packet):
    trace = statement["predicate"].get("source_trace")
    if not packet or not trace:
        return [{"code": "release_source_trace_missing", "message": "Signed CI must verify the explicit acceptance-to-source packet.", "target": None}]
    changes = sum(row["kind"] == "change" for row in packet["bindings"])
    if (trace["packet_digest"] != source_packet_digest(packet)
            or trace["verified_bindings"] != len(packet["bindings"])
            or (changes > 0 and trace["checked_paths"] < changes)
            or (changes == 0 and trace["checked_paths"] != 0)):
        return [{"code": "release_source_trace_mismatch", "message": "Signed CI source verification does not match this fixed packet.", "target": None}]
    return []
