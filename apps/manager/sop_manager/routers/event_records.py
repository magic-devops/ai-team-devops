"""Strict canonical sync values before any business write."""

import math

from sqlalchemy import JSON, DateTime, Float, Integer, String, Text

from .event_common import fail


def validate_values(model, values):
    checked = {}
    for key, value in values.items():
        column = model.__table__.c[key]
        kind = column.type
        valid = False
        if isinstance(kind, (String, Text)):
            valid = isinstance(value, str) and (
                not getattr(kind, "length", None) or len(value) <= kind.length
            )
        elif isinstance(kind, Integer):
            valid = type(value) is int and value >= 0
        elif isinstance(kind, Float):
            valid = type(value) in {int, float} and math.isfinite(value) and value >= 0
        elif isinstance(kind, DateTime):
            valid = isinstance(value, str)
        elif isinstance(kind, JSON) or key == "acceptance_criteria":
            valid = isinstance(value, list) and all(isinstance(item, str) for item in value)
        if not valid:
            fail("event_record_invalid", "Invalid canonical field type: " + key, 422)
        if key in {"title", "goal"} and not value.strip():
            fail("event_record_invalid", "Canonical text must be nonempty", 422)
        if key == "confidence" and value > 1:
            fail("event_record_invalid", "Confidence must be between zero and one", 422)
        if key == "priority" and value not in {"P0", "P1", "P2", "P3"}:
            fail("event_record_invalid", "Invalid priority", 422)
        if (
            key == "status"
            and model.__tablename__ == "tasks"
            and value not in {"pending", "in_progress", "blocked", "completed"}
        ):
            fail("event_record_invalid", "Invalid Task status", 422)
        checked[key] = value
    return checked
