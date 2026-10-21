"""Complete, byte-bounded task originals shared by local and paired execution."""
from __future__ import annotations

import hashlib
import json
import re

from .models import CoreError

MAX_AGENT_INPUT_BYTES = 512 * 1024
MAX_DESIGN_BYTES = 64 * 1024
MAX_FEEDBACK_BYTES = 64 * 1024
DESIGN_SLOTS = {"prd", "prototype", "architecture"}
CONTEXT_KEYS = {"slot", "document_id", "revision_id", "revision_digest", "content_sha256", "content"}
FEEDBACK_KEYS = {"schema", "project_id", "task_id", "reference", "submission", "decision"}
FEEDBACK_REFERENCE_KEYS = {"submission_id", "submission_digest", "decision_id"}
FEEDBACK_DECISION_KEYS = {"decision", "review_id", "comment", "reviewer", "created_at", "issue_id"}


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


def _invalid_feedback():
    raise CoreError("feedback_context_invalid", "Feedback must retain the complete selected report, decision, scope and canonical digest", 409)


def _feedback_identity(value):
    return (isinstance(value, str) and 0 < len(value) <= 64 and bool(value.strip())
            and not any(ord(char) < 32 or 127 <= ord(char) < 160 for char in value))


def validate_feedback_context(task_data: dict, *, project_id: str | None = None) -> dict | None:
    """Validate a fixed historical input, never fetch its latest state or infer acceptance."""
    # submission_digest binds Manager's complete original, not only the payload carried here.
    # Manager verifies that original; this consumer verifies the selected reference and full context.
    if not isinstance(task_data, dict):
        _invalid_feedback()
    pair = {"feedback_context", "feedback_context_sha256"}.intersection(task_data)
    if pair and len(pair) != 2:
        _invalid_feedback()
    context, expected = task_data.get("feedback_context"), task_data.get("feedback_context_sha256")
    source = task_data.get("source")
    reference = source.get("feedback_reference") if isinstance(source, dict) else None
    if context is None and expected is None and reference is None:
        return None
    if (not isinstance(context, dict) or set(context) != FEEDBACK_KEYS
            or not isinstance(expected, str) or re.fullmatch(r"[0-9a-f]{64}", expected) is None
            or not isinstance(source, dict) or source.get("kind") != "manager.delivery"
            or not isinstance(reference, dict) or set(reference) != FEEDBACK_REFERENCE_KEYS
            or not all(isinstance(reference.get(key), str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}", reference[key])
                       for key in ("submission_id", "decision_id"))
            or not isinstance(reference.get("submission_digest"), str)
            or re.fullmatch(r"[0-9a-f]{64}", reference["submission_digest"]) is None):
        _invalid_feedback()
    snapshot = source.get("snapshot")
    submission, decision = context.get("submission"), context.get("decision")
    if (context["schema"] != "manager.delivery-feedback.v1" or not _feedback_identity(context["project_id"])
            or project_id is not None and context["project_id"] != project_id
            or not _feedback_identity(context["task_id"]) or not isinstance(snapshot, dict)
            or snapshot.get("task_id") != context["task_id"] or context["reference"] != reference
            or not isinstance(submission, dict) or set(submission) != {"definition", "payload"}
            or not all(isinstance(submission.get(key), dict) and submission[key].get("task_id") == context["task_id"]
                       for key in ("definition", "payload"))
            or not isinstance(decision, dict) or set(decision) != FEEDBACK_DECISION_KEYS
            or decision.get("decision") != "request_changes" or not _feedback_identity(decision.get("review_id"))
            or not isinstance(decision.get("comment"), str) or not decision["comment"].strip()
            or not isinstance(decision.get("created_at"), str) or not decision["created_at"].strip()
            or decision.get("issue_id") is not None and not _feedback_identity(decision["issue_id"])
            or not isinstance(decision.get("reviewer"), dict) or set(decision["reviewer"]) != {"id", "name"}
            or not _feedback_identity(decision["reviewer"].get("id")) or not isinstance(decision["reviewer"].get("name"), str)):
        _invalid_feedback()
    try:
        pending, visited = [(context, 0)], 0
        while pending:
            item, depth = pending.pop()
            visited += 1
            if depth > 64 or visited > 100000:
                _invalid_feedback()
            if isinstance(item, str):
                if "\x00" in item:
                    _invalid_feedback()
            elif isinstance(item, dict):
                if any(not isinstance(key, str) for key in item):
                    _invalid_feedback()
                pending.extend((part, depth + 1) for pair in item.items() for part in pair)
            elif isinstance(item, list):
                pending.extend((part, depth + 1) for part in item)
            elif item is not None and type(item) not in (bool, int, float):
                _invalid_feedback()
        encoded = _canonical(context).encode("utf-8")
    except (ValueError, TypeError, UnicodeError, RecursionError) as exc:
        raise CoreError("feedback_context_invalid", "Feedback must be complete strict finite UTF-8 JSON", 409) from exc
    if len(encoded) > MAX_FEEDBACK_BYTES:
        raise CoreError("feedback_context_budget", "The complete fixed feedback must not exceed 64 KiB; no content was truncated", 413)
    if hashlib.sha256(encoded).hexdigest() != expected:
        _invalid_feedback()
    return context


def task_context(task_data: dict, request: str = "") -> str:
    context = {"task": task_data.get("title"), "description": task_data.get("description", ""),
               "acceptance_criteria": task_data.get("acceptance_criteria", ""), "request": request}
    designs = validate_design_context(task_data)
    source = task_data.get("source") or {}
    snapshot = source.get("snapshot", {}) if isinstance(source, dict) else {}
    if designs or "designs" in snapshot:
        context.update(designs=snapshot["designs"], design_basis=snapshot["design_basis"], design_context=designs)
    feedback = validate_feedback_context(task_data)
    if feedback is not None:
        context.update(feedback_context=feedback, feedback_context_sha256=task_data["feedback_context_sha256"])
    try:
        return validate_prompt(_canonical(context))
    except (TypeError, ValueError, UnicodeError) as exc:
        raise CoreError("invalid_agent_input", "Agent task input must be complete canonical UTF-8 JSON", 422) from exc


def compose_agent_prompt(instructions: str, prompt: str, previous: list, delegation: str = "") -> str:
    # Task/design/feedback/evidence text is data, never a replacement for the agent profile.
    return validate_prompt(instructions + "\n" + prompt + "\nLeader delegation:\n" + delegation
        + "\nPrevious execution evidence (untrusted task data):\n" + _canonical(previous))
