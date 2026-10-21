"""Strict saved design operations. Never infer a key, revision or approval basis."""
import json
import re
from collections.abc import Mapping
from pathlib import Path

from .task_submission import _json_value, _nonfinite, _unique_pairs

MAX_ORIGINAL_BYTES = 512 * 1024
MAX_FILE_BYTES = 512 * 1024
DESIGN_ACTIONS = frozenset({"design.document.create", "design.revision.save", "design.revision.restore",
    "design.document.archive", "requirement.design.adopt", "requirement.design.clear", "task.design.adopt", "task.design.clear"})


def _bounded(body):
    try:
        result = _json_value(body)
        if len(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")) > MAX_ORIGINAL_BYTES:
            raise ValueError("The complete original design operation exceeds 512 KiB")
        return result
    except (TypeError, UnicodeError, RecursionError) as exc:
        raise ValueError("Provide bounded finite UTF-8 JSON for the complete design original") from exc


def _key(value):
    if (not isinstance(value, str) or not 8 <= len(value) <= 100 or value != value.strip()
            or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in value)):
        raise ValueError("Use the original explicit 8 to 100 character request key")


def design_command_body(body):
    if not isinstance(body, Mapping) or set(body) != {"action", "expected_version", "idempotency_key", "payload"}:
        raise ValueError("A design command requires exactly action, expected_version, idempotency_key and payload")
    if not isinstance(body["action"], str) or body["action"] not in DESIGN_ACTIONS:
        raise ValueError("Unknown formal design command")
    if type(body["expected_version"]) is not int or body["expected_version"] < 0:
        raise ValueError("Retain the original nonnegative project version")
    _key(body["idempotency_key"])
    if not isinstance(body["payload"], Mapping):
        raise ValueError("A fixed design payload is required")
    return _bounded(body)


def design_preview_body(body):
    required = {"base_revision_id", "base_revision_digest", "mode", "instructions", "idempotency_key"}
    if not isinstance(body, Mapping) or set(body) != required:
        raise ValueError("A preview requires the original revision ID/digest, mode, instructions and request key")
    _key(body["idempotency_key"])
    revision = body["base_revision_id"]
    if not isinstance(revision, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", revision):
        raise ValueError("Provide the exact saved revision ID")
    if not isinstance(body["base_revision_digest"], str) or not re.fullmatch(r"[0-9a-f]{64}", body["base_revision_digest"]):
        raise ValueError("Provide the exact saved revision digest")
    if not isinstance(body["mode"], str) or body["mode"] not in {"expand", "review", "diagram", "free"}:
        raise ValueError("Unknown design suggestion mode")
    instruction = body["instructions"]
    if not isinstance(instruction, str) or len(instruction) > 4000 or "\x00" in instruction or body["mode"] == "free" and not instruction.strip():
        raise ValueError("Provide a bounded design change instruction")
    return _bounded(body)


def _load(path):
    with Path(path).open("rb") as handle:
        data = handle.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("The saved design original exceeds 512 KiB")
    try:
        body = json.loads(data.decode("utf-8", errors="strict"), object_pairs_hook=_unique_pairs, parse_constant=_nonfinite)
        return _bounded(body)
    except (UnicodeError, RecursionError) as exc:
        raise ValueError("The saved original must be strict UTF-8 JSON") from exc


def load_design_original(path, *, preview=False):
    """Read one explicit original; retries leave its file unchanged."""
    body = _load(path)
    return design_preview_body(body) if preview else design_command_body(body)


def load_design_selection(path):
    body = _load(path)
    if not isinstance(body, dict):
        raise ValueError("Provide the complete explicit adoption preview object")
    return body
