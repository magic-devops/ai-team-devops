"""Bounded original external-delivery commands; no inferred keys or versions.

The Manager's typed contract remains authoritative for evidence content and
acceptance. These helpers only protect the saved transport envelope and budget.
"""
from __future__ import annotations

import json
import math
from collections.abc import Mapping
from pathlib import Path
from typing import Any

MAX_REPORT_BYTES = 48 * 1024
MAX_COMMAND_FILE_BYTES = 256 * 1024


def _json_value(value):
    if value is None or type(value) in {str, int, bool}:
        return value
    if type(value) is float and math.isfinite(value):
        return value
    if isinstance(value, Mapping):
        if any(not isinstance(key, str) for key in value):
            raise ValueError("submission JSON object keys must be strings")
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    raise ValueError("submission must be finite JSON without object coercion")


def submission_command_body(body: Mapping[str, Any]) -> dict[str, Any]:
    """Detach an exact original before transport. Never fetch a replacement basis."""
    if not isinstance(body, Mapping) or set(body) != {"expected_version", "idempotency_key", "payload"}:
        raise ValueError("submission requires exactly expected_version, idempotency_key and payload")
    if type(body["expected_version"]) is not int or body["expected_version"] < 0:
        raise ValueError("expected_version must be the original nonnegative integer")
    key = body["idempotency_key"]
    if not isinstance(key, str) or not 8 <= len(key) <= 100 or key != key.strip() or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in key):
        raise ValueError("idempotency_key must be the original 8 to 100 character key")
    if not isinstance(body["payload"], Mapping):
        raise ValueError("payload must be the fixed report or review object")
    try:
        result = _json_value(body)
        encoded = json.dumps(result["payload"], ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_REPORT_BYTES:
            raise ValueError("the complete external report/review must not exceed 48 KiB")
        return result
    except (TypeError, UnicodeError, RecursionError) as exc:
        raise ValueError("submission must be bounded strict UTF-8 JSON") from exc


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate submission JSON key: " + key)
        result[key] = value
    return result


def _nonfinite(_value):
    raise ValueError("non-finite submission JSON number")


def load_submission_command(path: Path | str) -> dict[str, Any]:
    """Read one saved original. A send failure leaves that file unchanged."""
    with Path(path).open("rb") as handle:
        data = handle.read(MAX_COMMAND_FILE_BYTES + 1)
    if len(data) > MAX_COMMAND_FILE_BYTES:
        raise ValueError("saved submission file exceeds 256 KiB")
    try:
        body = json.loads(data.decode("utf-8", errors="strict"), object_pairs_hook=_unique_pairs, parse_constant=_nonfinite)
        return submission_command_body(body)
    except (UnicodeError, RecursionError) as exc:
        raise ValueError("saved submission must be strict UTF-8 JSON") from exc
