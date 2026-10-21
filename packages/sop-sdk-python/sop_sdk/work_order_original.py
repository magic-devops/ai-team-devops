"""Complete external work-order originals; never infer a key, basis or outcome."""
import hashlib
import json
import re
from collections.abc import Mapping
from pathlib import Path

from .task_submission import _json_value, _nonfinite, _unique_pairs

MAX_COMMAND_BYTES = 64 * 1024
MAX_PACKET_BYTES = 512 * 1024
WORK_ORDER_ACTIONS = frozenset({"work_order.create", "work_order.claim", "work_order.progress",
    "work_order.cancel", "work_order.release", "work_order.report"})
WORK_ORDER_STATES = frozenset({"queued", "claimed", "cancel_requested", "reported", "closed"})


def _text(value, maximum, *, required=True):
    if (not isinstance(value, str) or len(value) > maximum or (required and not value.strip())
            or any(ord(char) < 32 and char not in "\n\r\t" or 127 <= ord(char) <= 159 for char in value)):
        raise ValueError("Provide bounded explicit work-order text")
    value.encode("utf-8", errors="strict")


def _identity(value, maximum=64):
    _text(value, maximum)
    if value != value.strip() or value in {".", ".."} or any(char in value for char in "/\\\r\n\t"):
        raise ValueError("Provide the exact work-order resource identity")


def _member_identity(value):
    _text(value, 100)
    if value != value.strip() or any(char in value for char in "\r\n\t"):
        raise ValueError("Provide the exact formal team resource identity")


def _digest(value):
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise ValueError("Retain the exact original source digest")


def _bounded(value, budget=MAX_COMMAND_BYTES):
    try:
        result = _json_value(value)
        encoded = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(encoded) > budget:
            raise ValueError("The complete work-order JSON exceeds its source budget")
        return result, encoded
    except (TypeError, UnicodeError, RecursionError) as exc:
        raise ValueError("Provide bounded finite UTF-8 work-order JSON") from exc


def work_order_preview_body(body):
    if not isinstance(body, Mapping) or set(body) != {"task_basis", "executor_member_id", "instructions"}:
        raise ValueError("A preview requires the complete task basis, executor and instructions")
    try:
        _digest(body["task_basis"])
        _member_identity(body["executor_member_id"])
        _text(body["instructions"], 4000, required=False)
        return _bounded(body)[0]
    except UnicodeError as exc:
        raise ValueError("Provide strict UTF-8 work-order text") from exc


def work_order_command_body(body):
    if not isinstance(body, Mapping) or set(body) != {"action", "expected_version", "idempotency_key", "payload"}:
        raise ValueError("Retain the complete action, project version, request key and payload")
    action = body["action"]
    if not isinstance(action, str) or action not in WORK_ORDER_ACTIONS:
        raise ValueError("Unknown formal work-order action")
    if type(body["expected_version"]) is not int or body["expected_version"] < 0:
        raise ValueError("Retain the original nonnegative project version")
    key = body["idempotency_key"]
    if (not isinstance(key, str) or not 8 <= len(key) <= 100 or key != key.strip()
            or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in key)):
        raise ValueError("Retain the original explicit 8 to 100 character request key")
    payload = body["payload"]
    if not isinstance(payload, Mapping):
        raise ValueError("Retain the complete original work-order payload")
    extra = {"work_order.claim": set(), "work_order.progress": {"percent", "status", "message"},
        "work_order.cancel": {"comment"}, "work_order.release": {"comment", "stopped_attestation"},
        "work_order.report": {"submission_id", "submission_digest", "stopped_attestation"}}
    try:
        if action == "work_order.create":
            expected = {"task_id", "task_basis", "definition_digest", "native_boundary_digest", "executor_member_id", "preview_basis", "instructions"}
            if set(payload) != expected:
                raise ValueError("A dispatch requires the complete approved work-package source")
            _identity(payload["task_id"])
            work_order_preview_body({field: payload[field] for field in ("task_basis", "executor_member_id", "instructions")})
            for field in ("definition_digest", "native_boundary_digest", "preview_basis"): _digest(payload[field])
        else:
            if set(payload) != {"id", "order_revision"} | extra[action]:
                raise ValueError("Retain the exact work-order action fields")
            _identity(payload["id"])
            if type(payload["order_revision"]) is not int or payload["order_revision"] < 1:
                raise ValueError("Retain the original positive order revision")
            if action == "work_order.progress":
                percent = payload["percent"]
                if percent is not None and (type(percent) is not int or not 0 <= percent <= 100):
                    raise ValueError("Report an explicit percentage or null when unknown")
                if payload["status"] not in ("running", "blocked"):
                    raise ValueError("Progress cannot declare acceptance or terminal success")
                _text(payload["message"], 4000)
            if action in {"work_order.cancel", "work_order.release"}: _text(payload["comment"], 4000)
            if action == "work_order.release" and payload["stopped_attestation"] is not True:
                raise ValueError("Release requires an explicit external stop attestation")
            if action == "work_order.report":
                _identity(payload["submission_id"])
                _digest(payload["submission_digest"])
                if payload["stopped_attestation"] is not True:
                    raise ValueError("Linking a report requires an explicit external stop attestation")
        return _bounded(body)[0]
    except UnicodeError as exc:
        raise ValueError("Provide strict UTF-8 work-order text") from exc


def load_work_order_original(path, *, preview=False):
    """Read only; unknown responses never rewrite this saved original."""
    with Path(path).open("rb") as handle:
        data = handle.read(MAX_COMMAND_BYTES + 1)
    if len(data) > MAX_COMMAND_BYTES:
        raise ValueError("The saved work-order original exceeds 64 KiB")
    try:
        body = json.loads(data.decode("utf-8", errors="strict"), object_pairs_hook=_unique_pairs, parse_constant=_nonfinite)
        return work_order_preview_body(body) if preview else work_order_command_body(body)
    except (UnicodeError, RecursionError) as exc:
        raise ValueError("The saved work-order original must be strict UTF-8 JSON") from exc


def verified_work_order_packet(value, *, project_id, work_order_id):
    """Verify the complete exported packet bytes, without asserting execution."""
    if (not isinstance(value, Mapping) or value.get("work_order_id") != work_order_id
            or not isinstance(value.get("project_id"), str) or project_id and value["project_id"] != project_id
            or value.get("max_packet_bytes") != MAX_PACKET_BYTES or not isinstance(value.get("packet"), Mapping)):
        raise ValueError("The work package does not identify the requested project and order")
    packet, encoded = _bounded(value["packet"], MAX_PACKET_BYTES)
    _digest(value.get("request_digest"))
    _digest(value.get("packet_digest"))
    if packet.get("project_id") != value["project_id"] or hashlib.sha256(encoded).hexdigest() != value["packet_digest"]:
        raise ValueError("The complete fixed work-package digest cannot be verified")
    return _json_value(value)
