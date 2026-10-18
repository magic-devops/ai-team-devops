"""One frozen intent path; never turn an uncertain HTTP result into a new draft."""

from __future__ import annotations

from sop_sdk.client import build_default_client
from sop_sdk.config import AgentConfig
from sop_sdk.event_envelope import (
    EventIdentity,
    FrozenEvent,
    integer,
    manager_origin,
    strict_json,
    text_field,
)
from sop_sdk.event_outbox import EventOutbox
from sop_sdk.event_sender import flush_outbox
from sop_sdk.record_intents import freeze_record_intent


def submit_frozen(config: AgentConfig, frozen: FrozenEvent, *, local: bool) -> dict:
    text_field(config.project_id, "intended_project_id", maximum=64)
    path = config.project_path / config.outbox_path
    error = None
    scope_verified = False
    with EventOutbox(path) as box:
        enqueued = box.enqueue(frozen, config.project_id)
        original = box.inspect(frozen.id)
        wrong_origin = original["binding_state"] == "bound" and original["manager_origin"] != manager_origin(
            config.manager_url
        )
        if wrong_origin:
            error = "scope_mismatch"
        elif local and original["state"] == "acked":
            error = "identity_verification_required"
        elif not local:
            try:
                retries = integer(config.outbox_max_retries, "outbox_max_retries", 0, 999)
                with build_default_client(config) as client:
                    if original["state"] != "acked":
                        flush_outbox(
                            box,
                            client,
                            intended_project_id=config.project_id,
                            manager_url=config.manager_url,
                            limit=20,
                            max_attempts=retries + 1,
                        )
                    delivered = box.inspect(frozen.id)
                    if delivered["state"] == "acked":
                        current = EventIdentity.from_response(client.events_identity(), config.manager_url)
                        scope_verified = (
                            current.tenant_id,
                            current.project_id,
                            current.producer_id,
                            current.manager_origin,
                        ) == (
                            delivered["expected_tenant_id"],
                            delivered["expected_project_id"],
                            delivered["expected_producer_id"],
                            delivered["manager_origin"],
                        )
                        if not scope_verified:
                            error = "scope_mismatch"
            except Exception as exc:
                # The original may already have committed remotely. Only the same frozen intent may recover it.
                error = type(exc).__name__
        row = box.inspect(frozen.id)
    receipt = strict_json(row["remote_receipt_json"]) if row["state"] == "acked" and scope_verified else None
    processing = receipt.get("processing") if isinstance(receipt, dict) else None
    processed = isinstance(processing, dict) and processing.get("state") == "processed"
    result = {
        "ok": bool(not error and (processed or (local and row["state"] == "pending"))),
        "event_id": frozen.id,
        "digest": frozen.digest,
        "delivery_state": row["state"],
        "receipt_id": receipt.get("receipt_id") if receipt else None,
        "processing": processing,
        "processing_source": "original_receipt" if receipt else None,
        "retained": True,
        "replayed": enqueued["replayed"],
    }
    if error or (not local and row["state"] != "acked"):
        result["delivery_error"] = error or row.get("last_error_code") or "queued_not_yet_sent"
    return result


def submit_record(
    config: AgentConfig,
    module: str,
    record: dict,
    *,
    action: str,
    expected_version: int,
    key: str,
    event_time: str,
    local: bool,
    task_basis: str | None = None,
    requirement_basis: str | None = None,
    change_preview_basis: str | None = None,
) -> dict:
    frozen = freeze_record_intent(
        module,
        record,
        action=action,
        expected_version=expected_version,
        key=key,
        event_time=event_time,
        task_basis=task_basis,
        requirement_basis=requirement_basis,
        change_preview_basis=change_preview_basis,
    )
    return submit_frozen(config, frozen, local=local)
