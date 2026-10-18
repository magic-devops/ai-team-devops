"""Canonical record intent inputs shared by local producers and HTTP/IPC clients."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from .event_envelope import EventProtocolError, FrozenEvent, integer, text_field

RECORD_MODULES = frozenset({"tasks", "requirements", "issues", "sprints"})
ASSET_MODULES = frozenset({"rules", "specs", "templates"})


def sync_record_data(
    module: str,
    record: Mapping[str, Any],
    *,
    action: str,
    expected_version: int,
    task_basis: str | None = None,
    requirement_basis: str | None = None,
    change_preview_basis: str | None = None,
) -> dict[str, Any]:
    integer(expected_version, "expected_version")
    if module not in RECORD_MODULES | ASSET_MODULES:
        raise EventProtocolError("invalid sync module")
    if action not in (
        {"create", "update", "upsert", "delete"} if module in RECORD_MODULES else {"upsert", "delete"}
    ):
        raise EventProtocolError("invalid sync action")
    if not isinstance(record, Mapping):
        raise EventProtocolError("record must be an object")
    value = dict(record)
    if module in RECORD_MODULES:
        text_field(value.get("id"), "record.id", maximum=64)
    else:
        text_field(value.get("path") or value.get("id"), "record.path", maximum=1024)
        if "expected_sha256" not in value:
            raise EventProtocolError(
                "asset original expected_sha256 is required; use explicit null only for absent"
            )
        basis = value["expected_sha256"]
        if basis is not None and (not isinstance(basis, str) or not re.fullmatch("[0-9a-f]{64}", basis)):
            raise EventProtocolError("invalid asset original expected_sha256")
    result: dict[str, Any] = {
        "expected_version": expected_version,
        "module": module,
        "action": action,
        "record": value,
    }
    for name, basis in (
        ("task_basis", task_basis),
        ("requirement_basis", requirement_basis),
        ("change_preview_basis", change_preview_basis),
    ):
        if basis is None:
            continue
        allowed = module == ("tasks" if name == "task_basis" else "requirements")
        if not allowed or not isinstance(basis, str) or not re.fullmatch("[0-9a-f]{64}", basis):
            raise EventProtocolError("invalid " + name + " for module")
        result[name] = basis
    return result


def freeze_record_intent(
    module: str,
    record: Mapping[str, Any],
    *,
    action: str,
    expected_version: int,
    key: str,
    event_time: str,
    source: str = "sop-cli",
    task_basis: str | None = None,
    requirement_basis: str | None = None,
    change_preview_basis: str | None = None,
) -> FrozenEvent:
    text_field(key, "idempotency_key")
    text_field(event_time, "time")
    data = sync_record_data(
        module,
        record,
        action=action,
        expected_version=expected_version,
        task_basis=task_basis,
        requirement_basis=requirement_basis,
        change_preview_basis=change_preview_basis,
    )
    return FrozenEvent.create("sop.sync.push", data, event_id=key, time=event_time, source=source)
