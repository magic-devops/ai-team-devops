"""Strict delivery CommandAck, separate from CloudEvent transport receipts."""
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from urllib.parse import urlsplit

from .task_submission import _json_value, _nonfinite, _unique_pairs, submission_command_body
from .work_order_original import WORK_ORDER_ACTIONS, _digest, _feedback_reference, _identity, _text, work_order_command_body

SUBMISSION_ACTIONS = frozenset({"task.delivery.submit", "task.delivery.review"})
OPERATION_ACTIONS = WORK_ORDER_ACTIONS | SUBMISSION_ACTIONS
MAX_ORIGINAL_BYTES = 256 * 1024
MAX_ACK_BYTES = 64 * 1024


class DeliveryAckError(ValueError):
    """A successful HTTP response did not prove the saved command was applied."""


def canonical(value, maximum=MAX_ORIGINAL_BYTES):
    try:
        detached = _json_value(value)
        raw = json.dumps(detached, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8", errors="strict")
        if len(raw) > maximum:
            raise ValueError("Delivery JSON exceeds its complete source budget")
        return raw
    except (TypeError, UnicodeError, RecursionError) as exc:
        raise ValueError("Delivery data must be bounded finite UTF-8 JSON") from exc


def strict_json(raw, maximum=MAX_ORIGINAL_BYTES):
    if not isinstance(raw, bytes) or len(raw) > maximum:
        raise ValueError("Delivery JSON exceeds its complete source budget")
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=_unique_pairs, parse_constant=_nonfinite)
        canonical(value, maximum)
        return value
    except (UnicodeError, RecursionError) as exc:
        raise ValueError("Delivery JSON requires strict UTF-8 without duplicate keys") from exc


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _exact(value, keys):
    if not isinstance(value, Mapping) or set(value) != set(keys):
        raise ValueError("Retain the complete exact delivery fields")


def _integer(value, minimum=0):
    if type(value) is not int or not minimum <= value <= 9007199254740991:
        raise ValueError("Delivery versions and revisions must be bounded exact integers")


def _evidence_id(value):
    if not isinstance(value, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}", value) is None:
        raise ValueError("Retain the exact canonical evidence identity")


def _url(value):
    _text(value, 2000, required=False)
    if any(char in value for char in "\r\n\t"):
        raise ValueError("Use a bounded HTTP(S) evidence link")
    if value:
        parts = urlsplit(value)
        if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username is not None or parts.password is not None:
            raise ValueError("Use an HTTP(S) link without embedded credentials")


def _submission_payload(action, p):
    required = {"task_id", "task_basis", "native_boundary_digest"}
    required |= {"definition_digest", "source", "summary", "artifacts", "criteria", "tests"} if action.endswith("submit") else {
        "submission_id", "submission_digest", "decision", "comment"}
    optional = {"work_order", "rework_reference", "rework_basis"} if action.endswith("submit") else set()
    if not isinstance(p, Mapping) or not required <= set(p) <= required | optional:
        raise ValueError("Retain the exact complete external submission or review")
    if ("rework_reference" in p) != ("rework_basis" in p):
        raise ValueError("Retain the adopted rework reference and basis together")
    if "rework_reference" in p:
        if p["rework_reference"] is None: raise ValueError("Choose an explicit adopted rework source")
        _feedback_reference(p["rework_reference"]); _digest(p["rework_basis"])
    _identity(p["task_id"])
    for field in ("task_basis", "native_boundary_digest"): _digest(p[field])
    if action.endswith("review"):
        _evidence_id(p["submission_id"]); _digest(p["submission_digest"])
        if p["decision"] not in {"accept", "request_changes"}: raise ValueError("Choose an explicit human review decision")
        _text(p["comment"], 4000)
        return
    _digest(p["definition_digest"])
    source = p["source"]
    if not isinstance(source, Mapping) or set(source) not in ({"kind", "name"}, {"kind", "name", "url"}):
        raise ValueError("Identify the actual report source")
    if source["kind"] not in {"human", "agent", "tool"}: raise ValueError("Identify the actual report source")
    _text(source["name"], 2000); _url(source.get("url", "")); _text(p["summary"], 2000)
    for field, lower, upper in (("artifacts", 1, 40), ("criteria", 1, 160), ("tests", 0, 40)):
        if not isinstance(p[field], list) or not lower <= len(p[field]) <= upper:
            raise ValueError("Provide complete bounded report evidence")
    artifact_ids = set()
    for item in p["artifacts"]:
        if not isinstance(item, Mapping) or not {"id", "title"} <= set(item) <= {"id", "title", "content", "url", "sha256"}:
            raise ValueError("Provide exact evidence artifact fields")
        _evidence_id(item["id"]); _text(item["title"], 2000)
        _text(item.get("content", ""), 8000, required=False); _url(item.get("url", ""))
        if not item.get("content", "").strip() and not item.get("url"): raise ValueError("Artifact evidence is required")
        if item.get("sha256") is not None: _digest(item["sha256"])
        if item["id"] in artifact_ids: raise ValueError("Evidence identities must be unique")
        artifact_ids.add(item["id"])
    criteria_ids, test_ids = set(), set()
    for field in ("criteria", "tests"):
        for item in p[field]:
            if field == "criteria":
                _exact(item, {"source", "index", "text_digest", "result", "evidence_ids"})
                if item["source"] not in {"task", "requirement"} or item["result"] not in {"met", "not_met", "unknown"}:
                    raise ValueError("Report each explicit acceptance result")
                _integer(item["index"]); _digest(item["text_digest"])
                key, seen, reported = (item["source"], item["index"]), criteria_ids, item["result"] != "unknown"
            else:
                _exact(item, {"id", "title", "status", "evidence_ids"})
                _evidence_id(item["id"]); _text(item["title"], 2000)
                if item["status"] not in {"passed", "failed", "skipped", "not_run", "unknown"}: raise ValueError("Report the actual test status")
                key, seen, reported = item["id"], test_ids, item["status"] in {"passed", "failed"}
            if key in seen: raise ValueError("Report each acceptance condition and test once")
            seen.add(key)
            refs = item["evidence_ids"]
            if not isinstance(refs, list) or len(refs) > 40 or any(not isinstance(ref, str) for ref in refs):
                raise ValueError("Provide bounded evidence references")
            if len(set(refs)) != len(refs) or not set(refs) <= artifact_ids or reported and not refs:
                raise ValueError("Reported results require exact artifact evidence references")
    if p.get("work_order") is not None:
        w = p["work_order"]; _exact(w, {"id", "order_revision", "stopped_attestation"})
        _identity(w["id"]); _integer(w["order_revision"], 1)
        if w["stopped_attestation"] is not True: raise ValueError("Explicitly attest that this external work stopped")


def _command_original(body):
    _exact(body, {"action", "expected_version", "idempotency_key", "payload"})
    if not isinstance(body["action"], str) or body["action"] not in OPERATION_ACTIONS:
        raise ValueError("Choose one of the eight typed external delivery actions")
    if body["action"] in WORK_ORDER_ACTIONS:
        result = work_order_command_body(body)
    else:
        result = {"action": body["action"], **submission_command_body({k: body[k] for k in ("expected_version", "idempotency_key", "payload")})}
        _submission_payload(result["action"], result["payload"])
    _integer(result["expected_version"])
    canonical(result)
    return result


def command_original(body):
    """Detach finite JSON before interpreting any typed action fields."""
    try:
        return _command_original(strict_json(canonical(body)))
    except (KeyError, TypeError, UnicodeError, RecursionError) as exc:
        raise ValueError("Provide a complete bounded typed delivery original") from exc


def validate_binding(original, binding):
    """Check saved ACK expectations, independently of a fresh project GET."""
    p, action = original["payload"], original["action"]
    if action in SUBMISSION_ACTIONS:
        _exact(binding, {"task_id"})
        if binding["task_id"] != p["task_id"]: raise ValueError("Submission task binding changed")
        return
    _exact(binding, {"task_id", "work_order_id", "request_digest", "packet_digest", "state"})
    _identity(binding["task_id"]); _digest(binding["packet_digest"])
    if action == "work_order.create":
        if binding["task_id"] != p["task_id"] or any(binding[k] is not None for k in ("work_order_id", "request_digest", "state")):
            raise ValueError("Dispatch binding changed")
    else:
        if binding["work_order_id"] != p["id"] or binding["state"] not in {"queued", "claimed", "cancel_requested", "reported", "closed"}:
            raise ValueError("Work-order binding changed")
        _digest(binding["request_digest"])


def validate_ack(original, value, *, project_id, binding=None):
    """Validate actual public CommandAck; optional fixed W facts strengthen matching."""
    try:
        original = command_original(original)
        value = strict_json(canonical(value, MAX_ACK_BYTES), MAX_ACK_BYTES)
        _exact(value, {"project_id", "action", "resource", "result", "affected_refs", "applied_version", "version", "query_generation", "replayed"})
        if value["project_id"] != project_id or value["action"] != original["action"]: raise ValueError("Receipt scope changed")
        _integer(value["applied_version"], 1); _integer(value["version"])
        if value["applied_version"] != original["expected_version"] + 1 or value["version"] < value["applied_version"] or type(value["replayed"]) is not bool:
            raise ValueError("Receipt version or replay status changed")
        if value["query_generation"] is not None: _integer(value["query_generation"], 1)
        _exact(value["resource"], {"kind", "id"})
        action, p, r = original["action"], original["payload"], value["result"]
        if binding is not None: validate_binding(original, binding)
        if action in WORK_ORDER_ACTIONS:
            _exact(r, {"work_order_id", "task_ids", "request_digest", "packet_digest", "order_revision", "state", "submission_id"})
            _identity(r["work_order_id"]); _digest(r["request_digest"]); _digest(r["packet_digest"]); _integer(r["order_revision"], 1)
            create = action == "work_order.create"
            task_id = p["task_id"] if create else binding["task_id"] if binding else None
            if create:
                if r["order_revision"] != 1 or r["state"] != "queued": raise ValueError("Dispatch receipt changed")
            else:
                if r["work_order_id"] != p["id"] or r["order_revision"] != p["order_revision"] + 1: raise ValueError("Order receipt changed")
                states = {"work_order.claim": {"claimed"}, "work_order.progress": {binding["state"]} if binding else {"claimed", "cancel_requested"},
                    "work_order.cancel": {"closed" if binding["state"] == "queued" else "cancel_requested"} if binding else {"closed", "cancel_requested"},
                    "work_order.release": {"closed"}, "work_order.report": {"reported"}}
                if r["state"] not in states[action]: raise ValueError("Order receipt state changed")
            if binding and (r["packet_digest"] != binding["packet_digest"] or not create and r["request_digest"] != binding["request_digest"]):
                raise ValueError("Fixed work-package receipt changed")
            if r["submission_id"] != (p["submission_id"] if action == "work_order.report" else None): raise ValueError("Report receipt changed")
            kind, resource_id = "work_order", r["work_order_id"]
            expected = {(kind, resource_id)}
            if action == "work_order.report": expected.add(("task_submission", p["submission_id"]))
        else:
            submit, w = action == "task.delivery.submit", p.get("work_order")
            rework = submit and "rework_reference" in p
            _exact(r, {"task_ids", "submission_id", "submission_digest", "issue_id"} | (set() if submit else {"decision_id", "review_id"}) | ({"work_order"} if submit and w else set()) | ({"rework_reference", "rework_basis"} if rework else set()))
            if rework and (r["rework_reference"] != p["rework_reference"] or r["rework_basis"] != p["rework_basis"]):
                raise ValueError("Adopted rework source receipt changed")
            _evidence_id(r["submission_id"]); _digest(r["submission_digest"])
            if r["issue_id"] is not None: _identity(r["issue_id"])
            if not submit:
                _evidence_id(r["decision_id"]); _evidence_id(r["review_id"])
                if r["submission_id"] != p["submission_id"] or r["submission_digest"] != p["submission_digest"]: raise ValueError("Reviewed original changed")
            if submit and w:
                _exact(r["work_order"], {"id", "order_revision", "state"}); _integer(r["work_order"]["order_revision"], 1)
                if r["work_order"] != {"id": w["id"], "order_revision": w["order_revision"] + 1, "state": "reported"}: raise ValueError("Atomic handoff receipt changed")
            task_id = p["task_id"]
            kind, resource_id = ("task_submission", r["submission_id"]) if submit else ("task_review", r["review_id"])
            expected = {(kind, resource_id)}
            if not submit: expected.add(("task_submission", r["submission_id"]))
            if r["issue_id"]: expected.add(("issue", r["issue_id"]))
            if submit and w: expected.add(("work_order", w["id"]))
        if not isinstance(r["task_ids"], list) or len(r["task_ids"]) != 1: raise ValueError("Receipt task closure changed")
        _identity(r["task_ids"][0])
        if task_id is not None and r["task_ids"] != [task_id]: raise ValueError("Receipt task changed")
        expected.add(("task", r["task_ids"][0]))
        if value["resource"] != {"kind": kind, "id": resource_id}: raise ValueError("Receipt resource changed")
        refs = value["affected_refs"]
        if not isinstance(refs, list) or len(refs) != len(expected): raise ValueError("Receipt affected resources changed")
        actual = set()
        for ref in refs:
            _exact(ref, {"kind", "id"})
            if not isinstance(ref["kind"], str) or not isinstance(ref["id"], str): raise ValueError("Invalid receipt resource")
            actual.add((ref["kind"], ref["id"]))
        if actual != expected: raise ValueError("Receipt affected resources changed")
        return value
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError) as exc:
        raise DeliveryAckError("Manager response does not verify this exact delivery original") from exc
