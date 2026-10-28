"""Exact fixed reflection inputs and their small canonical Delivery CommandAck."""

from __future__ import annotations

from .delivery_ack import (
    DeliveryAckError, MAX_ACK_BYTES, _digest, _exact, _identity, _integer, canonical, strict_json,
)

REFLECTION_INPUT_ACTION = "reflection.input.create"


def _version(value, minimum=0):
    if type(value) is not int or value < minimum:
        raise ValueError("Retain the original nonnegative integer version")


def _string(value, maximum, *, nonblank=False):
    if (not isinstance(value, str) or not 1 <= len(value) <= maximum
            or nonblank and not value.strip()):
        raise ValueError("Retain complete bounded reflection input text and identities")
    value.encode("utf-8", errors="strict")


def reflection_input_original(body):
    """Detach and validate the whole original without reading or replacing any source."""
    try:
        original = strict_json(canonical(body))
        fields = {"action", "expected_version", "idempotency_key", "payload"}
        _exact(original, fields | ({"source_reference"} if "source_reference" in original else set()))
        if original.get("source_reference") is not None:
            raise ValueError("Reflection input does not accept discussion provenance")
        if original["action"] != REFLECTION_INPUT_ACTION:
            raise ValueError("Choose the exact reflection.input.create action")
        _version(original["expected_version"])
        key = original["idempotency_key"]
        # The outer Manager command validates the stripped key. Keep the raw
        # caller's bytes and only check its accepted length; never replace it.
        if not isinstance(key, str) or not 8 <= len(key.strip()) <= 100:
            raise ValueError("Retain the original 8 to 100 character idempotency key")
        key.encode("utf-8", errors="strict")
        payload = original["payload"]
        _exact(payload, {"title", "rationale", "sources"})
        _string(payload["title"], 160, nonblank=True)
        _string(payload["rationale"], 2000, nonblank=True)
        sources = payload["sources"]
        if not isinstance(sources, list) or not 1 <= len(sources) <= 32:
            raise ValueError("Retain one to 32 ordered exact reflection sources")
        seen = set()
        for source in sources:
            _exact(source, {"reflection_id", "source_digest", "attempt_id"})
            _string(source["reflection_id"], 64)
            _string(source["attempt_id"], 64)
            _digest(source["source_digest"])
            if source["reflection_id"] in seen:
                raise ValueError("Select each original reflection only once")
            seen.add(source["reflection_id"])
        return original
    except (KeyError, TypeError, UnicodeError, RecursionError) as exc:
        raise ValueError("Provide the complete bounded original reflection input command") from exc


def validate_reflection_input_ack(original, value, *, project_id):
    """Confirm only this command's prepared fact, never the latest input or source view."""
    try:
        original = reflection_input_original(original)
        value = strict_json(canonical(value, MAX_ACK_BYTES), MAX_ACK_BYTES)
        _identity(project_id)
        _exact(value, {"project_id", "action", "resource", "result", "affected_refs",
                       "applied_version", "version", "query_generation", "replayed"})
        if value["project_id"] != project_id or value["action"] != REFLECTION_INPUT_ACTION:
            raise ValueError("Reflection input receipt scope changed")
        _version(value["applied_version"], 1)
        _version(value["version"])
        if (value["applied_version"] != original["expected_version"] + 1
                or value["version"] < value["applied_version"] or type(value["replayed"]) is not bool):
            raise ValueError("Reflection input receipt version or replay status changed")
        if value["query_generation"] is not None:
            _version(value["query_generation"], 1)
        resource = value["resource"]
        _exact(resource, {"kind", "id"})
        _identity(resource["id"])
        if resource["kind"] != "reflection_input":
            raise ValueError("Reflection input receipt resource changed")
        result = value["result"]
        _exact(result, {"status", "source_count"})
        _integer(result["source_count"], 1)
        if result["status"] != "prepared" or result["source_count"] != len(original["payload"]["sources"]):
            raise ValueError("Reflection input receipt selection changed")
        refs = value["affected_refs"]
        if not isinstance(refs, list) or len(refs) != 1:
            raise ValueError("Reflection input receipt must name only the saved input")
        _exact(refs[0], {"kind", "id"})
        if refs[0] != resource:
            raise ValueError("Reflection input receipt affected resource changed")
        return value
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError) as exc:
        raise DeliveryAckError("Manager response does not verify this exact reflection input original") from exc
