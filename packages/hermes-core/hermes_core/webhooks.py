from __future__ import annotations

import hmac
import os
from collections.abc import Mapping
from datetime import datetime, timezone
from hashlib import sha256

from .models import CoreError

TIMESTAMP_TOLERANCE_SECONDS = 300
GLOBAL_MAX_BODY_BYTES = 1_048_576

HEADER_TIMESTAMP = "x-hermes-webhook-timestamp"
HEADER_DELIVERY = "x-hermes-webhook-delivery"
HEADER_SIGNATURE = "x-hermes-webhook-signature"


def verify_webhook(
    trigger_data: dict,
    headers: Mapping[str, str],
    raw_body: bytes,
    *,
    now_utc: datetime | None = None,
) -> dict:
    max_body = int(trigger_data.get("max_body_bytes") or 65_536)
    if len(raw_body) > max_body:
        raise CoreError("webhook_body_too_large", "Webhook body exceeds this schedule's limit", 413)

    secret_ref = str(trigger_data.get("secret_ref") or "")
    secret = os.environ.get(secret_ref, "")
    if not secret:
        raise CoreError("webhook_secret_unavailable", "Webhook secret reference is not available on this host", 409)

    timestamp = _header(headers, HEADER_TIMESTAMP)
    delivery_id = _header(headers, HEADER_DELIVERY)
    provided = _header(headers, HEADER_SIGNATURE)
    if not timestamp or not delivery_id or not provided:
        raise CoreError("webhook_signature_missing", "Webhook timestamp, delivery id, and signature are required", 401)
    if len(delivery_id) > 160 or "\x00" in delivery_id:
        raise CoreError("webhook_delivery_invalid", "Webhook delivery id is invalid", 400)

    try:
        timestamp_seconds = int(timestamp)
    except ValueError as exc:
        raise CoreError("webhook_timestamp_invalid", "Webhook timestamp must be a Unix timestamp", 401) from exc
    now_seconds = int((now_utc or datetime.now(timezone.utc)).timestamp())
    if abs(now_seconds - timestamp_seconds) > TIMESTAMP_TOLERANCE_SECONDS:
        raise CoreError("webhook_timestamp_stale", "Webhook timestamp is outside the accepted tolerance", 401)

    try:
        signed_prefix = timestamp.encode("ascii") + b"." + delivery_id.encode("ascii") + b"."
        normalized = provided.removeprefix("sha256=").lower().encode("ascii").decode("ascii")
    except UnicodeEncodeError as exc:
        raise CoreError("webhook_signature_invalid", "Webhook signed headers must be ASCII", 401) from exc

    expected = hmac.new(secret.encode(), signed_prefix + raw_body, sha256).hexdigest()
    if not hmac.compare_digest(normalized, expected):
        raise CoreError("webhook_signature_invalid", "Webhook signature is invalid", 401)

    return {
        "delivery_id": delivery_id,
        "timestamp": timestamp,
        "body_sha256": sha256(raw_body).hexdigest(),
        "body_bytes": len(raw_body),
    }


def _header(headers: Mapping[str, str], name: str) -> str:
    for key, value in headers.items():
        if key.lower() == name:
            return value.strip()
    return ""
