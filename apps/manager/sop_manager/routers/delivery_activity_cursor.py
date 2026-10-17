"""Scoped, signed keyset cursors with an immutable history upper bound."""

import base64
import hashlib
import hmac
import json

from fastapi import HTTPException


def encode_cursor(filters, upper, after):
    from .auth_sql import SECRET_KEY

    payload = json.dumps([filters, upper, after], separators=(",", ":"), ensure_ascii=True).encode()
    signature = hmac.new(SECRET_KEY.encode(), payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(signature + payload).decode().rstrip("=")


def decode_cursor(value, filters):
    from .auth_sql import SECRET_KEY

    try:
        if len(value) > 4000:
            raise ValueError("Cursor too long")
        raw = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
        signature, payload = raw[:32], raw[32:]
        expected = hmac.new(SECRET_KEY.encode(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("Invalid cursor signature")
        scope, upper, after = json.loads(payload)
        if scope != filters or not isinstance(upper, list) or not isinstance(after, list):
            raise ValueError("Cursor scope mismatch")
        return upper, after
    except (ValueError, TypeError, UnicodeError, OverflowError, RecursionError) as exc:
        raise HTTPException(
            422,
            {
                "code": "collaboration_cursor_invalid",
                "message": "Cursor does not belong to this project and filter",
            },
        ) from exc
