"""Exact authenticated event scope and immutable wire validation."""

import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import defer

from . import sql_models as m
from .auth_sql import check_project_access
from .delivery import _role_permissions


def fail(code, message, status=409):
    raise HTTPException(status, {"code": code, "message": message})


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def date(value):
    return value.isoformat() + "Z" if value else None


def identifier():
    return uuid4().hex


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def scope(project, model):
    return model.tenant_id == project.tenant_id, model.project_id == project.id


def scope_key(project, producer, eid):
    return digest(
        json.dumps([project.tenant_id, project.id, producer, eid], ensure_ascii=False, separators=(",", ":"))
    )


def authorize(db, user, pid, request=None):
    if not pid:
        fail("event_project_required", "Select a project using X-Project-Id", 400)
    if user is None:
        fail("event_actor_inactive", "An active account is required", 403)
    actor_id = user.id
    db.expire_all()
    actor = db.get(m.User, actor_id, populate_existing=True)
    if actor is None or actor.status != "active":
        fail("event_actor_inactive", "An active account is required", 403)
    project = db.get(m.Project, pid, populate_existing=True)
    if project is None:
        fail("event_project_missing", "Project not found", 404)
    check_project_access(actor, pid, db)
    credential = None
    if request is not None and not (request.headers.get("Authorization") or "").startswith("Bearer "):
        owner = getattr(request.state, "api_key_owner", None)
        if isinstance(owner, dict) and owner.get("id"):
            key = db.get(m.ApiKey, owner["id"], populate_existing=True)
            if (
                key is None
                or key.status not in {"active", "rotating"}
                or key.user_id != actor.id
                or key.tenant_id != actor.tenant_id
                or key.expires_at
                and key.expires_at <= now()
            ):
                fail("event_credential_invalid", "The credential is no longer active", 401)
            credential = key.id
    return project, actor, _role_permissions(db, actor, project), credential


class CloudEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    specversion: Literal["1.0"]
    id: str = Field(min_length=1, max_length=128)
    type: str = Field(min_length=1, max_length=160)
    source: str = Field(max_length=512)
    subject: str = Field(max_length=256)
    time: str = Field(max_length=64)
    datacontenttype: Literal["application/json"]
    data: dict[str, Any]


def _pairs(values):
    result = {}
    for key, value in values:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _finite(raw):
    value = float(raw)
    if not math.isfinite(value):
        raise ValueError("nonfinite JSON number")
    return value


def _unicode(value):
    if isinstance(value, str):
        value.encode("utf-8")
    elif isinstance(value, dict):
        for key, item in value.items():
            _unicode(key)
            _unicode(item)
    elif isinstance(value, list):
        for item in value:
            _unicode(item)


def parse(item, project):
    try:
        raw = item.event_json.encode("utf-8")
        if len(raw) > 65536:
            fail("event_too_large", "Event exceeds 64KiB", 422)
        if hashlib.sha256(raw).hexdigest() != item.digest:
            fail("event_digest_mismatch", "Frozen event digest does not match", 422)

        def constant(value):
            raise ValueError("nonfinite JSON constant")

        value = json.loads(
            item.event_json, object_pairs_hook=_pairs, parse_float=_finite, parse_constant=constant
        )
        _unicode(value)
        event = CloudEvent.model_validate(value)
        stamp = datetime.fromisoformat(event.time.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            raise ValueError("time needs an offset")
    except (UnicodeError, ValueError, TypeError, RecursionError, ValidationError):
        fail("event_json_invalid", "Invalid frozen JSON event envelope", 422)
    if event.id != item.id:
        fail("event_identity_mismatch", "Inner and outer event IDs must match", 422)
    for key, expected in (("project_id", project.id), ("tenant_id", project.tenant_id)):
        if key in event.data and event.data[key] != expected:
            fail("event_scope_mismatch", "Payload scope conflicts with selected project", 422)
    return event


def processing(row):
    return {
        "state": row.state,
        "revision": row.revision,
        "handler": row.handler,
        "operation_id": row.operation_id,
        "attempts": row.attempts,
        "updated_at": date(row.updated_at),
        "processed_at": date(row.processed_at),
        "reason_code": row.reason_code,
        "retryable": row.retryable,
        "result": row.result,
    }


def inbox(db, project, rid):
    row = db.scalar(select(m.EventInbox).options(defer(m.EventInbox.event_json)).where(*scope(project, m.EventInbox), m.EventInbox.id == rid))
    if row is None:
        fail("event_not_found", "Receipt not found in this project", 404)
    return row
