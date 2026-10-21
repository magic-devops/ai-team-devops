"""Frozen event bytes and verified durable-receipt protocol. No inferred business versions."""

from __future__ import annotations

import hashlib
import json
import math
import re
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit


class EventProtocolError(ValueError):
    pass


def _unique_pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise EventProtocolError("duplicate JSON key")
        result[key] = value
    return result


def _nonfinite(value):
    raise EventProtocolError("non-finite JSON number")


def _check_json(value):
    if isinstance(value, str):
        value.encode("utf-8", errors="strict")
    elif isinstance(value, float) and not math.isfinite(value):
        _nonfinite(value)
    elif isinstance(value, dict):
        for key, item in value.items():
            _check_json(key)
            _check_json(item)
    elif isinstance(value, list):
        for item in value:
            _check_json(item)


def strict_json(text: str) -> Any:

    try:
        text.encode("utf-8", errors="strict")
        result = json.loads(text, object_pairs_hook=_unique_pairs, parse_constant=_nonfinite)
        _check_json(result)
        return result
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise EventProtocolError("invalid strict UTF-8 JSON") from exc


def integer(value: Any, name: str, minimum=0, maximum=2**63 - 1) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise EventProtocolError(f"{name} must be an integer in {minimum}..{maximum}")
    return value


def text_field(value: Any, name: str, minimum=1, maximum=128) -> str:
    if not isinstance(value, str) or not minimum <= len(value) <= maximum:
        raise EventProtocolError(f"invalid {name}")
    try:
        value.encode("utf-8")
    except UnicodeError as exc:
        raise EventProtocolError(f"invalid {name} Unicode") from exc
    return value


def timestamp(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})", value
    ):
        raise EventProtocolError("invalid RFC3339 timestamp")
    if not value.upper().endswith("Z") and (int(value[-5:-3]) > 23 or int(value[-2:]) > 59):
        raise EventProtocolError("invalid RFC3339 offset")
    try:
        parsed = datetime.fromisoformat(value.upper().replace("Z", "+00:00"))
        if parsed.utcoffset() is None:
            raise ValueError("offset required")
    except ValueError as exc:
        raise EventProtocolError("invalid RFC3339 timestamp") from exc
    return value


def manager_origin(value: str) -> str:
    value = value.strip().rstrip("/")
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise EventProtocolError("invalid Manager origin")
    return value


@dataclass(frozen=True)
class EventIdentity:
    tenant_id: str
    project_id: str
    producer_id: str
    manager_origin: str

    def __post_init__(self):
        for name in ("tenant_id", "project_id", "producer_id"):
            text_field(getattr(self, name), name, maximum=64)
        object.__setattr__(self, "manager_origin", manager_origin(self.manager_origin))

    @classmethod
    def from_response(cls, response: Mapping[str, Any], origin: str) -> EventIdentity:
        if not isinstance(response, dict) or set(response) != {"tenant_id", "project_id", "producer_id"}:
            raise EventProtocolError("invalid identity response")
        return cls(**response, manager_origin=origin)

    def request_scope(self) -> dict[str, str]:
        return {
            "expected_tenant_id": self.tenant_id,
            "expected_project_id": self.project_id,
            "expected_producer_id": self.producer_id,
        }


@dataclass(frozen=True)
class FrozenEvent:
    id: str
    event_json: str
    digest: str

    def __post_init__(self):
        value = self._parse(self.event_json)
        if (
            value["id"] != self.id
            or hashlib.sha256(self.event_json.encode("utf-8")).hexdigest() != self.digest
        ):
            raise EventProtocolError("event identity/digest mismatch")

    @staticmethod
    def _parse(raw: str) -> dict[str, Any]:
        try:
            if not isinstance(raw, str) or len(raw.encode("utf-8")) > 65536:
                raise EventProtocolError("event too large")
        except UnicodeError as exc:
            raise EventProtocolError("invalid Unicode") from exc
        value = strict_json(raw)
        fields = {"specversion", "id", "type", "source", "subject", "time", "datacontenttype", "data"}
        if (
            not isinstance(value, dict)
            or set(value) != fields
            or value["specversion"] != "1.0"
            or value["datacontenttype"] != "application/json"
            or not isinstance(value["data"], dict)
        ):
            raise EventProtocolError("invalid full event envelope")
        for key, minimum, maximum in (
            ("id", 1, 128),
            ("type", 1, 160),
            ("source", 0, 512),
            ("subject", 0, 256),
        ):
            text_field(value[key], key, minimum, maximum)
        timestamp(value["time"])
        return value

    @classmethod
    def from_json(cls, event_json: str, *, digest: str | None = None) -> FrozenEvent:
        parsed = cls._parse(event_json)
        actual = hashlib.sha256(event_json.encode("utf-8")).hexdigest()
        if digest is not None and digest != actual:
            raise EventProtocolError("digest mismatch")
        return cls(parsed["id"], event_json, actual)

    @classmethod
    def create(
        cls,
        event_type: str,
        data: Mapping[str, Any],
        *,
        event_id: str | None = None,
        subject="",
        source="sop-sdk",
        time: str | None = None,
    ) -> FrozenEvent:
        value = {
            "specversion": "1.0",
            "id": event_id if event_id is not None else f"evt-{uuid.uuid4().hex}",
            "type": event_type,
            "source": source,
            "subject": subject,
            "time": time if time is not None else datetime.now(timezone.utc).isoformat(),
            "datacontenttype": "application/json",
            "data": dict(data),
        }
        try:
            raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise EventProtocolError("event data must be finite JSON") from exc
        return cls.from_json(raw)

    def item(self) -> dict[str, str]:
        return {"id": self.id, "event_json": self.event_json, "digest": self.digest}


@dataclass(frozen=True)
class DurableReceipt:
    """Parsed receipt value; the repository independently validates its proof before acknowledgement."""

    identity: EventIdentity
    id: str
    digest: str
    receipt_id: str
    outcome: str
    stored_at: str
    processing_state: str | None
    result_json: str


def _object_fields(value, fields, name):
    if not isinstance(value, dict) or set(value) != set(fields.split()):
        raise EventProtocolError(f"invalid {name} fields")


def _nullable_text(value, name):
    if value is not None:
        text_field(value, name, minimum=0, maximum=4000)


def _validate_effect(value):
    if value is None:
        return
    _object_fields(value, "kind target_kind target_id", "effect")
    if value["kind"] not in {
        "fact_recorded",
        "task_updated",
        "task_delivery_submitted",
        "issue_created",
        "record_upserted",
        "record_deleted",
        "asset_materialized",
    }:
        raise EventProtocolError("invalid effect kind")
    if value["target_kind"] not in {None, "task", "issue", "requirement", "sprint", "asset", "task_submission"}:
        raise EventProtocolError("invalid effect target kind")
    if value["target_kind"] == "task_submission" and value["kind"] != "task_delivery_submitted":
        raise EventProtocolError("submission target requires a submitted report effect")
    _nullable_text(value["target_id"], "effect.target_id")


def _validate_processing(value):
    _object_fields(
        value,
        "state revision handler operation_id attempts updated_at processed_at reason_code retryable result",
        "processing",
    )
    if value["state"] not in {"pending", "processed", "failed"} or type(value["retryable"]) is not bool:
        raise EventProtocolError("invalid processing state/retryable")
    integer(value["revision"], "processing.revision", 1)
    integer(value["attempts"], "processing.attempts")
    timestamp(value["updated_at"])
    if value["processed_at"] is not None:
        timestamp(value["processed_at"])
    for key in ("handler", "operation_id", "reason_code"):
        _nullable_text(value[key], "processing." + key)
    _validate_effect(value["result"])
    return value["state"]


def matching_receipts(
    events: Sequence[FrozenEvent], response: Any, identity: EventIdentity
) -> dict[str, DurableReceipt]:
    if (
        not isinstance(response, dict)
        or response.get("tenant_id") != identity.tenant_id
        or response.get("project_id") != identity.project_id
        or response.get("producer") != {"kind": "user", "id": identity.producer_id}
        or not isinstance(response.get("results"), list)
    ):
        raise EventProtocolError("receipt scope/shape mismatch")
    timestamp(response.get("as_of"))
    requested = {event.id: event for event in events}
    if len(requested) != len(events):
        raise EventProtocolError("duplicate request ID")
    result = {}
    seen = set()
    for item in response["results"]:
        _object_fields(item, "id digest outcome receipt_id stored_at processing error", "result")
        event_id = item.get("id")
        if not isinstance(event_id, str) or event_id not in requested or event_id in seen:
            raise EventProtocolError("unknown/duplicate result ID")
        seen.add(event_id)
        if item.get("digest") != requested[event_id].digest:
            raise EventProtocolError("receipt digest mismatch")
        outcome = item.get("outcome")
        if outcome == "rejected":
            if (
                item.get("receipt_id") is not None
                or item.get("stored_at") is not None
                or item.get("processing") is not None
            ):
                raise EventProtocolError("rejected result carries receipt")
            error = item.get("error")
            _object_fields(error, "code message retryable", "error")
            if not isinstance(error, dict) or type(error.get("retryable")) is not bool:
                raise EventProtocolError("invalid rejected error")
            text_field(error.get("code"), "error.code", maximum=256)
            text_field(error.get("message"), "error.message", minimum=0, maximum=4000)
            continue
        if outcome not in {"stored", "duplicate"}:
            raise EventProtocolError("invalid receipt outcome")
        if item["error"] is not None:
            raise EventProtocolError("stored receipt carries error")
        receipt_id = text_field(item.get("receipt_id"), "receipt_id", maximum=256)
        stored_at = timestamp(item.get("stored_at"))
        state = _validate_processing(item["processing"])
        effect = item["processing"]["result"]
        if effect is not None and effect["kind"] == "task_delivery_submitted":
            processing = item["processing"]
            if (effect["target_kind"] != "task_submission" or not isinstance(effect["target_id"], str)
                    or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}", effect["target_id"]) is None
                    or processing["handler"] != "task.delivery.submit"
                    or state != "processed" or processing["attempts"] < 1 or processing["processed_at"] is None):
                raise EventProtocolError("submission effect must identify an actual saved report")
        result[event_id] = DurableReceipt(
            identity,
            event_id,
            requested[event_id].digest,
            receipt_id,
            outcome,
            stored_at,
            state,
            json.dumps(item, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        )
    return result
