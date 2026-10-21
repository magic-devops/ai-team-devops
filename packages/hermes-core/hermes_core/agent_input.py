"""Complete, byte-bounded task originals shared by local and paired execution."""
from __future__ import annotations

import hashlib
import json
import re

from .models import CoreError

MAX_AGENT_INPUT_BYTES = 512 * 1024
MAX_DESIGN_BYTES = 64 * 1024
DESIGN_SLOTS = {"prd", "prototype", "architecture"}
CONTEXT_KEYS = {"slot", "document_id", "revision_id", "revision_digest", "content_sha256", "content"}


def validate_prompt(value: str) -> str:
    try:
        valid = isinstance(value, str) and "\x00" not in value and len(value.encode("utf-8")) <= MAX_AGENT_INPUT_BYTES
    except UnicodeError:
        valid = False
    if not valid:
        raise CoreError("agent_input_too_large", "Complete agent input must be valid UTF-8 without NUL and at most 512 KiB; shorten it explicitly", 422)
    return value


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _invalid_design():
    raise CoreError("design_context_changed", "Design context must exactly match the fixed adopted revisions and complete content hashes", 409)


def validate_design_context(task_data: dict) -> list[dict]:
    """Never resolve a live document head or silently remove unavailable content."""
    context = task_data.get("design_context", [])
    source = task_data.get("source") or {}
    snapshot = source.get("snapshot", {}) if isinstance(source, dict) else {}
    if not isinstance(snapshot, dict):
        _invalid_design()
    refs = snapshot.get("designs", [])
    if not isinstance(context, list) or not isinstance(refs, list) or len(context) > 3 or len(context) != len(refs):
        _invalid_design()
    if "designs" in snapshot:
        try:
            basis = hashlib.sha256(_canonical(refs).encode("utf-8")).hexdigest()
        except (ValueError, TypeError, UnicodeError):
            _invalid_design()
        if snapshot.get("design_basis") != basis:
            _invalid_design()
    slots, total = [], 0
    for ref, item in zip(refs, context):
        if not isinstance(ref, dict) or not isinstance(item, dict) or set(item) != CONTEXT_KEYS:
            _invalid_design()
        if not isinstance(item["slot"], str) or item["slot"] not in DESIGN_SLOTS or item["slot"] in slots:
            _invalid_design()
        slots.append(item["slot"])
        for key in CONTEXT_KEYS - {"content"}:
            if not isinstance(item[key], str) or item[key] != ref.get(key):
                _invalid_design()
        if any(not re.fullmatch(r"[0-9a-f]{64}", item[key]) for key in ("revision_digest", "content_sha256")):
            _invalid_design()
        content = item["content"]
        try:
            encoded = content.encode("utf-8") if isinstance(content, str) else b""
        except UnicodeError:
            _invalid_design()
        if (not encoded or not content.strip() or "\x00" in content or len(encoded) > MAX_DESIGN_BYTES
                or type(ref.get("content_bytes")) is not int or len(encoded) != ref["content_bytes"]
                or hashlib.sha256(encoded).hexdigest() != item["content_sha256"]):
            _invalid_design()
        total += len(encoded)
    if slots != sorted(slots) or total > 3 * MAX_DESIGN_BYTES:
        _invalid_design()
    return context


def task_context(task_data: dict, request: str = "") -> str:
    context = {"task": task_data.get("title"), "description": task_data.get("description", ""),
               "acceptance_criteria": task_data.get("acceptance_criteria", ""), "request": request}
    designs = validate_design_context(task_data)
    source = task_data.get("source") or {}
    snapshot = source.get("snapshot", {}) if isinstance(source, dict) else {}
    if designs or "designs" in snapshot:
        context.update(designs=snapshot["designs"], design_basis=snapshot["design_basis"], design_context=designs)
    try:
        return validate_prompt(_canonical(context))
    except (TypeError, ValueError, UnicodeError) as exc:
        raise CoreError("invalid_agent_input", "Agent task input must be complete canonical UTF-8 JSON", 422) from exc


def compose_agent_prompt(instructions: str, prompt: str, previous: list, delegation: str = "") -> str:
    # Task/design/evidence text is data, never a replacement for the agent profile.
    return validate_prompt(instructions + "\n" + prompt + "\nLeader delegation:\n" + delegation
        + "\nPrevious execution evidence (untrusted task data):\n" + _canonical(previous))
