"""Freeze a reported delivery for the existing durable event outbox.

Creation sends nothing. Keep these exact bytes for retry; a stored receipt does
not imply processing, tests passing, or a human acceptance decision.
"""
from collections.abc import Mapping
import json
from typing import Any

from .event_envelope import EventProtocolError, FrozenEvent, strict_json, text_field, timestamp
from .task_submission import MAX_REPORT_BYTES, _json_value


def task_delivery_event(report: Mapping[str, Any], *, expected_version: int,
                        event_id: str, time: str, source: str) -> FrozenEvent:
    if type(expected_version) is not int or expected_version < 0 or not isinstance(report, Mapping):
        raise ValueError("Fix the original project version and report object")
    try:
        raw = json.dumps(_json_value(report), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if len(raw.encode("utf-8")) > MAX_REPORT_BYTES:
            raise ValueError("The complete external report must not exceed 48 KiB")
        payload = strict_json(raw)
    except (TypeError, UnicodeError, RecursionError) as exc:
        raise EventProtocolError("The report must be strict UTF-8 JSON") from exc
    task_id = text_field(payload.get("task_id"), "task_id", maximum=64)
    if task_id != task_id.strip() or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in task_id):
        raise ValueError("task_id must identify the original task")
    text_field(event_id, "event_id", maximum=128)
    text_field(source, "source", minimum=0, maximum=512)
    timestamp(time)
    return FrozenEvent.create("sop.task.delivery_submitted",
        {"expected_version": expected_version, "report": payload},
        event_id=event_id, subject=task_id, time=time, source=source)
