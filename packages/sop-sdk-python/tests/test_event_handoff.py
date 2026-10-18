from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

import pytest
from sop_sdk.event_envelope import EventIdentity, EventProtocolError, FrozenEvent, matching_receipts
from sop_sdk.event_outbox import EventOutbox, QueueError


def event(event_id="E", **data):
    return FrozenEvent.create("sop.agent.heartbeat", data, event_id=event_id, time="2026-10-18T00:00:00Z")


def identity(project="P", producer="U"):
    return EventIdentity("T", project, producer, "https://manager.example/base")


def receipt(frozen, **override):
    return {
        "id": frozen.id,
        "digest": frozen.digest,
        "outcome": "stored",
        "receipt_id": "R-" + frozen.id,
        "stored_at": "2026-10-18T00:00:00Z",
        "processing": {
            "state": "pending",
            "revision": 1,
            "handler": None,
            "operation_id": None,
            "attempts": 0,
            "updated_at": "2026-10-18T00:00:00Z",
            "processed_at": None,
            "reason_code": "handler_not_configured",
            "retryable": False,
            "result": None,
        },
        "error": None,
        **override,
    }


def response(*items):
    return {
        "tenant_id": "T",
        "project_id": "P",
        "producer": {"kind": "user", "id": "U"},
        "as_of": "2026-10-18T00:00:00Z",
        "results": list(items),
    }


@pytest.mark.parametrize(
    "payload",
    [
        '{"id":"E","id":"E"}',
        '{"n":NaN}',
        '{"n":1e999}',
        '{"x":"\\ud800"}',
    ],
)
def test_strict_original_json_rejects_duplicates_nonfinite_and_surrogates(payload):
    with pytest.raises(EventProtocolError):
        FrozenEvent.from_json(payload)


def test_frozen_payload_keeps_exact_bytes_and_rejects_digest_and_extra_fields():
    raw = event().event_json.replace('"id":', '"id" : ')
    frozen = FrozenEvent.from_json(raw)
    assert frozen.event_json == raw
    assert frozen.digest == hashlib.sha256(raw.encode()).hexdigest()
    with pytest.raises(EventProtocolError):
        FrozenEvent.from_json(raw, digest="0" * 64)
    with pytest.raises(EventProtocolError):
        FrozenEvent.from_json(raw[:-1] + ',"extra":true}')


@pytest.mark.parametrize("bad", ["unknown", "duplicate", "digest", "scope", "receipt", "timestamp"])
def test_entire_response_validated_before_any_ack(bad):
    first, second = event("A"), event("B")
    out = response(receipt(first), receipt(second))
    if bad == "unknown":
        out["results"][1]["id"] = "C"
    if bad == "duplicate":
        out["results"][1] = receipt(first)
    if bad == "digest":
        out["results"][1]["digest"] = "0" * 64
    if bad == "scope":
        out["tenant_id"] = "Other"
    if bad == "receipt":
        out["results"][1]["receipt_id"] = ""
    if bad == "timestamp":
        out["results"][1]["stored_at"] = "tomorrow"
    with pytest.raises(EventProtocolError):
        matching_receipts([first, second], out, identity())


def test_missing_result_is_not_ack_but_valid_sibling_is():
    first, second = event("A"), event("B")
    assert list(matching_receipts([first, second], response(receipt(first)), identity())) == ["A"]


@pytest.mark.parametrize(
    "case", ["revision_missing", "retryable_null", "updated_at_invalid", "rejection_null"]
)
def test_invalid_sibling_dto_invalidates_whole_response_before_ack(case):
    first, second = event("A"), event("B")
    out = response(receipt(first), receipt(second))
    broken = out["results"][1]
    if case == "revision_missing":
        broken["processing"].pop("revision")
    if case == "retryable_null":
        broken["processing"]["retryable"] = None
    if case == "updated_at_invalid":
        broken["processing"]["updated_at"] = "tomorrow"
    if case == "rejection_null":
        broken.update(
            outcome="rejected",
            receipt_id=None,
            stored_at=None,
            processing=None,
            error={"code": "bad", "message": "invalid", "retryable": None},
        )
    with pytest.raises(EventProtocolError):
        matching_receipts([first, second], out, identity())


def test_sqlite_preserves_last_copy_across_exhaustion_reopen_and_requeue_replay(tmp_path):
    path = tmp_path / "outbox.sqlite"
    frozen = event()
    with EventOutbox(path) as box:
        created = box.enqueue(frozen, "P")
        assert created == {
            "id": "E",
            "digest": frozen.digest,
            "state": "pending",
            "revision": 1,
            "replayed": False,
        }
        bound = box.bind("E", 1, identity())
        dead = box.fail("E", bound["revision"], "unreachable", "offline", max_attempts=1)
        assert dead["state"] == "dead_letter"
    with EventOutbox(path) as box:
        assert box.inspect("E")["event_json"] == frozen.event_json
        result = box.requeue("E", dead["revision"], "连接已修复", "retry-one")
        ack = matching_receipts([frozen], response(receipt(frozen)), identity())["E"]
        box.ack("E", result["revision"], ack)
        replay = box.requeue("E", dead["revision"], "连接已修复", "retry-one")
        assert replay == {**result, "replayed": True}
        assert box.inspect("E")["state"] == "acked"
        assert box.enqueue(frozen, "P")["state"] == "acked"
        with pytest.raises(QueueError, match="idempotency_conflict"):
            box.requeue("E", dead["revision"], "不同原因", "retry-one")
        with pytest.raises(QueueError, match="event_id_conflict"):
            box.enqueue(event("E", different=True), "P")


def test_original_binding_cannot_follow_changed_user_project_or_server(tmp_path):
    with EventOutbox(tmp_path / "box.sqlite") as box:
        box.enqueue(event(), "P")
        bound = box.bind("E", 1, identity())
        for other in [
            identity(producer="Other"),
            identity(project="Other"),
            EventIdentity("T", "P", "U", "https://other.example"),
        ]:
            with pytest.raises(QueueError, match="scope_mismatch"):
                box.bind("E", bound["revision"], other)


def test_metadata_pagination_cas_and_pure_reads(tmp_path):
    with EventOutbox(tmp_path / "box.sqlite") as box:
        for value in range(4):
            box.enqueue(event(str(value)), "P")
        first = box.list(limit=2)
        assert len(first["items"]) == 2 and first["total"] == 4 and first["has_more"]
        assert "event_json" not in first["items"][0]
        assert len(box.list(limit=2, cursor=first["next_cursor"])["items"]) == 2
        before = box.stats()
        box.inspect("0")
        assert box.stats() == before
        box.fail("0", 1, "down", "offline", max_attempts=1)
        with pytest.raises(QueueError, match="revision_conflict"):
            box.fail("0", 1, "down", "offline")
        with pytest.raises(QueueError, match="cursor_stale"):
            box.list(limit=2, cursor=first["next_cursor"])


def test_schema_copies_are_identical():
    root = Path(__file__).resolve().parents[3]
    expected = (root / "apis/sqlite/event_outbox_v1.sql").read_bytes()
    assert (root / "apps/agent-runtime/internal/outbox/schema.sql").read_bytes() == expected
    assert (root / "packages/sop-sdk-python/sop_sdk/event_outbox_v1.sql").read_bytes() == expected


def test_nonempty_v0_never_implicitly_binds_or_mutates(tmp_path):
    path = tmp_path / "old.sqlite"
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE events(id TEXT PRIMARY KEY,type TEXT,subject TEXT,payload TEXT,retries INTEGER,next_at INTEGER,created_at INTEGER)"
        )
        db.execute("INSERT INTO events VALUES('E','legacy','','{}',2,1,1)")
    before = path.read_bytes()
    with pytest.raises(QueueError, match="migration_required"):
        EventOutbox(path)
    assert path.read_bytes() == before
    EventOutbox.migrate_legacy(path, "P")
    with EventOutbox(path) as box:
        row = box.inspect("E")
        assert row["state"] == "dead_letter" and row["event_json"] == "{}"
        assert row["binding_state"] == "unbound" and row["intended_project_id"] == "P"
        with pytest.raises(QueueError, match="invalid_state"):
            box.requeue("E", row["revision"], "不能修改原文", "bad")


def test_ignored_ack_update_cannot_claim_success_or_bump_generation(tmp_path):
    with EventOutbox(tmp_path / "box.sqlite") as box:
        frozen = event()
        box.enqueue(frozen, "P")
        bound = box.bind("E", 1, identity())
        before = box.stats()
        box.db.execute(
            "CREATE TRIGGER fault_ack BEFORE UPDATE ON events WHEN NEW.state='acked' BEGIN SELECT RAISE(IGNORE); END"
        )
        ack = matching_receipts([frozen], response(receipt(frozen)), identity())["E"]
        with pytest.raises(QueueError, match="revision_conflict"):
            box.ack("E", bound["revision"], ack)
        assert box.stats() == before
        assert box.inspect("E")["state"] == "pending"


def test_unknown_empty_schema_is_preserved(tmp_path):
    path = tmp_path / "foreign.sqlite"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE events(custom_user_column TEXT)")
    before = path.read_bytes()
    with pytest.raises(QueueError, match="migration_required"):
        EventOutbox(path)
    assert path.read_bytes() == before


def test_ignored_operation_receipt_rolls_back_requeue(tmp_path):
    with EventOutbox(tmp_path / "box.sqlite") as box:
        box.enqueue(event(), "P")
        dead = box.fail("E", 1, "down", "offline", max_attempts=1)
        before = box.stats()
        box.db.execute(
            "CREATE TRIGGER fault_requeue BEFORE INSERT ON queue_receipts BEGIN SELECT RAISE(IGNORE); END"
        )
        with pytest.raises(QueueError, match="revision_conflict"):
            box.requeue("E", dead["revision"], "连接已修复", "same-key")
        assert box.stats() == before
        assert box.inspect("E")["state"] == "dead_letter"


def test_legacy_migration_preserves_entire_signed_rowid_range(tmp_path):
    path = tmp_path / "legacy.sqlite"
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE events(id TEXT PRIMARY KEY,type TEXT,subject TEXT,payload TEXT,retries INTEGER,next_at INTEGER,created_at INTEGER)"
        )
        for rowid in [-(2**63), -1, 0, 1]:
            frozen = event(str(rowid))
            db.execute(
                "INSERT INTO events(rowid,id,type,subject,payload,retries,next_at,created_at) VALUES(?,?,?,?,?,0,1,1)",
                (rowid, frozen.id, "sop.agent.heartbeat", "", frozen.event_json),
            )
    result = EventOutbox.migrate_legacy(path, "P")
    assert result["migrated"] == 4
    with EventOutbox(path) as box:
        assert box.stats()["pending"] == 4
        for rowid in [-(2**63), -1, 0, 1]:
            assert box.inspect(str(rowid))["event_json"] == event(str(rowid)).event_json


def test_repository_ack_revalidates_public_receipt_against_its_proof(tmp_path):
    from dataclasses import replace

    with EventOutbox(tmp_path / "box.sqlite") as box:
        frozen = event()
        box.enqueue(frozen, "P")
        bound = box.bind("E", 1, identity())
        original = matching_receipts([frozen], response(receipt(frozen)), identity())["E"]
        for invalid in [
            replace(original, receipt_id=""),
            replace(original, stored_at="tomorrow"),
            replace(original, result_json="{}"),
            replace(original, processing_state="processed"),
        ]:
            with pytest.raises(EventProtocolError):
                box.ack("E", bound["revision"], invalid)
            assert box.inspect("E")["state"] == "pending"


@pytest.mark.parametrize("offset", ["+00:99", "+00:60", "+24:00", "-12:99"])
def test_rfc3339_offset_never_normalizes_invalid_minutes(offset):
    with pytest.raises(EventProtocolError):
        FrozenEvent.create("generic.fact", {}, event_id="E", time="2026-10-18T00:00:00" + offset)


def test_foreign_bound_head_defers_original_but_sends_current_producer(tmp_path):
    from sop_sdk.event_sender import flush_outbox

    class Client:
        sent = []

        def events_identity(self):
            return {"tenant_id": "T", "project_id": "P", "producer_id": "U"}

        def events_ingest(self, events, *, identity):
            self.sent.extend(e.id for e in events)
            return response(*(receipt(e) for e in events))

    client = Client()
    with EventOutbox(tmp_path / "box.sqlite") as box:
        box.enqueue(event("A-old"), "P")
        box.bind("A-old", 1, identity(producer="old-user"))
        box.enqueue(event("B-current"), "P")
        flush_outbox(box, client, intended_project_id="P", manager_url=identity().manager_origin)
        assert client.sent == ["B-current"]
        assert box.inspect("A-old")["expected_producer_id"] == "old-user"
        assert box.inspect("A-old")["last_error_code"] == "scope_mismatch"
        assert box.inspect("B-current")["state"] == "acked"


def test_hmac_signs_actual_manager_base_path_and_auth_scope_is_fixed_for_retry(monkeypatch):
    import hmac

    import httpx
    from sop_sdk.client import ManagerClient
    from sop_sdk.security import HmacAuth

    seen = []
    with ManagerClient(
        "https://manager.test/base", auth=HmacAuth("first"), project_id="P", max_retries=1
    ) as client:

        def handle(request):
            seen.append(request)
            canonical = f"GET\n{request.url.path}\n{request.headers['X-Sop-Timestamp']}\n{request.headers['X-Sop-Nonce']}\n{hashlib.sha256(b'').hexdigest()}".encode()
            expected = "sha256=" + hmac.new(b"first", canonical, hashlib.sha256).hexdigest()
            assert request.headers["X-Sop-Signature"] == expected
            assert request.headers["X-Project-Id"] == "P"
            if len(seen) == 1:
                client.auth, client.project_id = HmacAuth("second"), "Other"
                return httpx.Response(503, json={"detail": "retry"})
            return httpx.Response(200, json={})

        client._client.close()
        client._client = httpx.Client(base_url=client.base_url, transport=httpx.MockTransport(handle))
        client.events_identity()
    assert len(seen) == 2
