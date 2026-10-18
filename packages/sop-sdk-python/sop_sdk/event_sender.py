"""Shared CLI/SDK sender. Persist, bind once, send frozen bytes, then verify all acknowledgements."""

from __future__ import annotations

from .event_envelope import EventIdentity, EventProtocolError, FrozenEvent, matching_receipts
from .event_outbox import EventOutbox, QueueError


def flush_outbox(
    box: EventOutbox, client, *, intended_project_id: str, manager_url: str, limit=20, max_attempts=4
):
    rows = box.pending_batch(limit)
    if not rows:
        return {"selected": 0, "acked": 0, "rejected": 0, "stats": box.stats()}
    identity = EventIdentity.from_response(client.events_identity(), manager_url)
    if identity.project_id != intended_project_id:
        raise QueueError("scope_mismatch", "current identity project differs from intended project")
    batch, total = [], 0
    for row in rows:
        if total + len(row["event_json"].encode("utf-8")) > 1048576:
            break
        bound = _bind_current(box, row, identity, max_attempts)
        if bound is None:
            continue
        row["revision"] = bound["revision"]
        batch.append(row)
        total += len(row["event_json"].encode("utf-8"))
    frozen = [FrozenEvent(row["id"], row["event_json"], row["digest"]) for row in batch]
    if not batch:
        return {"selected": 0, "acked": 0, "rejected": 0, "deferred": len(rows), "stats": box.stats()}
    try:
        response = client.events_ingest(frozen, identity=identity)
        receipts = matching_receipts(frozen, response, identity)
    except Exception:
        # Response may have been lost after commit. Preserve the original intent and retry it.
        for row in batch:
            _unconfirmed(box, row, max_attempts)
        raise
    return _settle_batch(box, batch, response, receipts, max_attempts)


def _bind_current(box, row, identity, max_attempts):
    try:
        bound = box.bind(row["id"], row["revision"], identity)
        return bound if bound["state"] == "pending" else None
    except QueueError as exc:
        if exc.code in {"revision_conflict", "invalid_state"}:
            return None
        if exc.code != "scope_mismatch":
            raise
    try:
        box.fail(
            row["id"],
            row["revision"],
            "scope_mismatch",
            "Current identity/origin differs from the original event",
            max_attempts=max_attempts,
        )
    except QueueError as exc:
        if exc.code not in {"revision_conflict", "invalid_state"}:
            raise
    return None


def _unconfirmed(box, row, max_attempts):
    try:
        box.fail(
            row["id"],
            row["revision"],
            "delivery_unconfirmed",
            "No matching durable receipt was confirmed",
            max_attempts=max_attempts,
        )
    except QueueError as exc:
        if exc.code not in {"revision_conflict", "invalid_state"}:
            raise


def _settle_batch(box, batch, response, receipts, max_attempts):
    rejected = {item["id"]: item for item in response["results"] if item["outcome"] == "rejected"}
    acked = 0
    for row in batch:
        try:
            if row["id"] in receipts:
                box.ack(row["id"], row["revision"], receipts[row["id"]])
                acked += 1
            else:
                error = rejected.get(row["id"], {}).get("error")
                retryable = error.get("retryable") if isinstance(error, dict) else True
                if type(retryable) is not bool:
                    raise EventProtocolError("invalid rejected error")
                box.fail(
                    row["id"],
                    row["revision"],
                    str(error.get("code", "receipt_missing"))
                    if isinstance(error, dict)
                    else "receipt_missing",
                    "Manager rejected the original event"
                    if error
                    else "Manager omitted the original event receipt",
                    retryable=retryable,
                    max_attempts=max_attempts,
                )
        except QueueError as exc:
            if exc.code not in {"revision_conflict", "invalid_state"}:
                raise
    return {"selected": len(batch), "acked": acked, "rejected": len(rejected), "stats": box.stats()}
