"""Explicit source intake originals and acknowledgments, with no automatic rebase."""
import re
from .delivery_ack import canonical, strict_json, _exact, _integer
from .work_order_original import _identity, _digest, _text


def source_id(value):
    if not isinstance(value, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", value) is None:
        raise ValueError("Provide the exact operational source identity")
    return value


def intake_command(value):
    _exact(value, {"action", "payload", "expected_version", "idempotency_key"})
    if value["action"] not in {"issue.ops.intake", "issue.rca.intake"}:
        raise ValueError("Provide the original operational source intake command")
    _integer(value["expected_version"])
    _identity(value["idempotency_key"], 100)
    if len(value["idempotency_key"]) < 8:
        raise ValueError("Retain the original idempotency key")
    p = value["payload"]
    _exact(p, {"source_id", "source_digest", "title", "description", "severity"})
    source_id(p["source_id"]); _digest(p["source_digest"])
    _text(p["title"], 256); _text(p["description"], 10000, required=False)
    if p["severity"] not in {"P0", "P1", "P2", "P3"}:
        raise ValueError("Choose a canonical problem severity")
    return strict_json(canonical(value, 64 * 1024), 64 * 1024)


def intake_ack(original, value, project_id):
    _identity(project_id)
    original = intake_command(original)
    _exact(value, {"project_id", "action", "resource", "result", "affected_refs", "applied_version", "version", "query_generation", "replayed"})
    _integer(value["applied_version"]); _integer(value["version"])
    if value["project_id"] != project_id or value["action"] != original["action"] or value["applied_version"] != original["expected_version"] + 1 or value["version"] < value["applied_version"] or type(value["replayed"]) is not bool:
        raise ValueError("Receipt does not prove the original scoped intake")
    if value["query_generation"] is not None: _integer(value["query_generation"], 1)
    resource, result = value["resource"], value["result"]
    _exact(resource, {"kind", "id"}); _exact(result, {"issue_id", "source_id", "source_digest"})
    if resource["kind"] != "issue" or not isinstance(resource["id"], str) or re.fullmatch(r"ISSUE-[a-f0-9]{32}", resource["id"]) is None or result != {"issue_id": resource["id"], "source_id": original["payload"]["source_id"], "source_digest": original["payload"]["source_digest"]} or value["affected_refs"] != [resource]:
        raise ValueError("Receipt source or target differs from the saved original")
    return strict_json(canonical(value, 64 * 1024), 64 * 1024)
