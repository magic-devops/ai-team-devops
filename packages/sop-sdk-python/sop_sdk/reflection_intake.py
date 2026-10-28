"""Typed reflection claims backed by the existing immutable event protocol."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .event_envelope import EventProtocolError, FrozenEvent, strict_json, text_field, timestamp

REFLECTION_EVENT_TYPE = "sop.reflection.recorded"
REFLECTION_CATEGORIES = frozenset({"coding", "testing", "security", "workflow", "review", "other"})


def _claim_text(value: Any, name: str, maximum: int, *, required: bool = True) -> str:
    text_field(value, name, minimum=1 if required else 0, maximum=maximum)
    if required and not value.strip():
        raise EventProtocolError(f"{name} must not be blank")
    return value


def validate_reflection_data(data: Any) -> None:
    """Validate without changing a producer's optional fields or original text."""
    required = {"schema_version", "category", "title", "observation"}
    if not isinstance(data, dict) or not required <= set(data) <= required | {"lesson", "references"}:
        raise EventProtocolError("invalid reflection data fields")
    if type(data["schema_version"]) is not int or data["schema_version"] != 1:
        raise EventProtocolError("reflection schema_version must be integer 1")
    if not isinstance(data["category"], str) or data["category"] not in REFLECTION_CATEGORIES:
        raise EventProtocolError("invalid reflection category")
    _claim_text(data["title"], "reflection title", 160)
    _claim_text(data["observation"], "reflection observation", 12000)
    if "lesson" in data:
        _claim_text(data["lesson"], "reflection lesson", 8000, required=False)
    refs = data.get("references", [])
    if not isinstance(refs, list) or len(refs) > 8:
        raise EventProtocolError("reflection references must be an array of at most 8 entries")
    seen = set()
    for ref in refs:
        if not isinstance(ref, dict) or set(ref) != {"kind", "id"}:
            raise EventProtocolError("invalid reflection reference fields")
        kind = ref["kind"]
        if not isinstance(kind, str) or kind not in {"task", "execution"}:
            raise EventProtocolError("reflection reference kind must be task or execution")
        value = text_field(ref["id"], "reflection reference ID", maximum=64 if kind == "task" else 200)
        if value != value.strip() or "/" in value or "\\" in value or any(
            ord(char) < 32 or 127 <= ord(char) <= 159 for char in value
        ):
            raise EventProtocolError("invalid reflection reference ID")
        identity = (kind, value)
        if identity in seen:
            raise EventProtocolError("duplicate reflection reference")
        seen.add(identity)


def freeze_reflection(
    data: dict[str, Any], *, event_id: str, time: str, source: str = "sop-sdk"
) -> FrozenEvent:
    """Freeze an explicit producer intent for the shared durable EventOutbox."""
    validate_reflection_data(data)
    # Generic event creation supports generated identity/time; this typed entry requires both originals.
    text_field(event_id, "reflection event ID")
    timestamp(time)
    return FrozenEvent.create(REFLECTION_EVENT_TYPE, data, event_id=event_id, time=time, source=source)


def parse_reflection_event(event_json: str) -> FrozenEvent:
    """Validate an existing full original and return exactly its bytes and digest."""
    frozen = FrozenEvent.from_json(event_json)
    value = strict_json(frozen.event_json)
    if value["type"] != REFLECTION_EVENT_TYPE or value["subject"] != "":
        raise EventProtocolError("reflection requires sop.reflection.recorded and an empty subject")
    validate_reflection_data(value["data"])
    return frozen


def reflection_query_params(
    *, limit: int, cursor: str, category: str = "", occurred_from: str = "", occurred_to: str = ""
) -> dict[str, Any]:
    """Preserve one explicitly requested window and its original filter strings."""
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("reflection limit must be an integer between 1 and 100")
    text_field(cursor, "reflection cursor", minimum=0, maximum=4000)
    if any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in cursor):
        raise ValueError("invalid opaque reflection cursor")
    if not isinstance(category, str) or (category and category not in REFLECTION_CATEGORIES):
        raise ValueError("invalid reflection category")
    filters = {"category": category, "occurred_from": occurred_from, "occurred_to": occurred_to}
    for value in (occurred_from, occurred_to):
        if not isinstance(value, str):
            raise ValueError("reflection time filters must be RFC3339 strings")
        if value:
            timestamp(value)
    if occurred_from and occurred_to:
        start = datetime.fromisoformat(occurred_from.upper().replace("Z", "+00:00"))
        end = datetime.fromisoformat(occurred_to.upper().replace("Z", "+00:00"))
        if end <= start:
            raise ValueError("occurred_to must be after occurred_from")
    return {"limit": limit, **({"cursor": cursor} if cursor else {}),
            **{key: value for key, value in filters.items() if value}}
