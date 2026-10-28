"""Reflection claims use the real frozen event and durable acknowledgement protocol."""

from __future__ import annotations

import hashlib
import importlib
import importlib.util
import json

import pytest

from sop_sdk.event_envelope import EventIdentity, EventProtocolError, FrozenEvent, matching_receipts
from sop_sdk.event_outbox import EventOutbox, QueueError

AT = "2026-10-19T08:00:00+08:00"


def intake():
    assert importlib.util.find_spec("sop_sdk.reflection_intake") is not None, "Typed reflection producer is missing"
    return importlib.import_module("sop_sdk.reflection_intake")


def data(**changes):
    return {
        "schema_version": 1,
        "category": "testing",
        "title": "测试教训 · e\u0301",
        "observation": "观察到断言失败。\n这是提交者陈述。",
        **changes,
    }


def frozen(data_value=None):
    return intake().freeze_reflection(data() if data_value is None else data_value,
                                     event_id="reflection-original", time=AT, source="developer-tool")


def wire(event, *, effect=None, state="processed"):
    return {
        "tenant_id": "T", "project_id": "P", "producer": {"kind": "user", "id": "U"},
        "as_of": AT,
        "results": [{
            "id": event.id, "digest": event.digest, "outcome": "stored", "receipt_id": "receipt-original",
            "stored_at": AT,
            "processing": {
                "state": state, "revision": 2, "handler": "reflection.record", "operation_id": None,
                "attempts": 1, "updated_at": AT, "processed_at": AT if state == "processed" else None,
                "reason_code": None, "retryable": False,
                "result": effect if effect is not None else {
                    "kind": "reflection_recorded", "target_kind": "reflection", "target_id": "receipt-original",
                },
            }, "error": None,
        }],
    }


def test_typed_producer_freezes_explicit_identity_time_and_exact_unicode_claims():
    event = frozen()
    value = json.loads(event.event_json)
    assert value["id"] == "reflection-original" and value["time"] == AT
    assert value["type"] == "sop.reflection.recorded" and value["subject"] == ""
    assert value["source"] == "developer-tool"
    assert value["data"]["title"] == data()["title"]
    assert value["data"]["observation"] == data()["observation"]
    assert event.digest == hashlib.sha256(event.event_json.encode("utf-8")).hexdigest()
    assert frozen().item() == event.item()


@pytest.mark.parametrize("options", [{}, {"event_id": "original"}, {"time": AT}])
def test_producer_requires_explicit_original_id_and_time(options):
    with pytest.raises(TypeError):
        intake().freeze_reflection(data(), **options)


@pytest.mark.parametrize("changes", [
    {"schema_version": True}, {"schema_version": "1"}, {"schema_version": 2},
    {"category": "reflection"}, {"category": None}, {"title": " "}, {"title": 1},
    {"title": "🙂" * 161}, {"observation": "\t\n"}, {"observation": "x" * 12001},
    {"lesson": None}, {"lesson": "x" * 8001}, {"references": None},
    {"references": {}}, {"references": [{"kind": "issue", "id": "ISS-one"}]},
    {"references": [{"kind": "task", "id": "T-one", "workspace_id": "forged"}]},
    {"references": [{"kind": "task", "id": "T-one"}] * 2},
    {"references": [{"kind": "task", "id": "🙂" * 65}]},
    {"references": [{"kind": "execution", "id": "🙂" * 201}]},
    {"tenant_id": "forged"}, {"producer_id": "forged"}, {"accepted": True},
])
def test_invalid_claim_is_rejected_before_a_frozen_event_exists(changes):
    with pytest.raises(ValueError):
        frozen(data(**changes))


@pytest.mark.parametrize("bad_id", ["", " T-one", "T-one ", "T/other", "T\\other", "T\x00", "T\x85", "\ud800"])
def test_reference_id_rejects_ambiguous_paths_controls_and_invalid_unicode(bad_id):
    with pytest.raises(ValueError):
        frozen(data(references=[{"kind": "task", "id": bad_id}]))


def test_unicode_codepoint_boundaries_and_reference_kind_identity_are_preserved():
    refs = [{"kind": "task", "id": "🙂" * 64}, {"kind": "execution", "id": "🙂" * 200}]
    event = frozen(data(title="🙂" * 160, lesson="x" * 8000, references=refs))
    assert json.loads(event.event_json)["data"]["references"] == refs


def test_references_are_bounded_at_eight_without_merging_or_truncating():
    refs = [{"kind": "task", "id": f"T-{i}"} for i in range(8)]
    assert len(json.loads(frozen(data(references=refs)).event_json)["data"]["references"]) == 8
    with pytest.raises(ValueError):
        frozen(data(references=[*refs, {"kind": "task", "id": "T-over"}]))


def test_existing_original_is_validated_without_reserializing_or_normalizing_it():
    raw = '{ "specversion":"1.0", "id":"original", "type":"sop.reflection.recorded", "source":"tool", "subject":"", "time":"2026-10-19t08:00:00+08:00", "datacontenttype":"application/json", "data": {"schema_version":1,"category":"coding","title":"é","observation":"原文 < & >"}}\n'
    event = intake().parse_reflection_event(raw)
    assert isinstance(event, FrozenEvent)
    assert event.event_json == raw and event.digest == hashlib.sha256(raw.encode()).hexdigest()


@pytest.mark.parametrize("replacement", [
    ('"subject":""', '"subject":"T-one"'),
    ('"type":"sop.reflection.recorded"', '"type":"generic.fact"'),
    ('"schema_version":1', '"schema_version":true'),
])
def test_original_parser_does_not_accept_a_different_event_or_untyped_payload(replacement):
    raw = '{"specversion":"1.0","id":"original","type":"sop.reflection.recorded","source":"tool","subject":"","time":"2026-10-19T00:00:00Z","datacontenttype":"application/json","data":{"schema_version":1,"category":"other","title":"title","observation":"observed"}}'
    with pytest.raises(ValueError):
        intake().parse_reflection_event(raw.replace(*replacement))


def test_original_utf8_budget_is_enforced_without_truncating_valid_fields():
    with pytest.raises(ValueError):
        frozen(data(observation="🙂" * 12000, lesson="🙂" * 8000))


def test_real_sqlite_original_and_processed_receipt_survive_reopen(tmp_path):
    event = frozen()
    identity = EventIdentity("T", "P", "U", "https://manager.test")
    path = tmp_path / "outbox.sqlite"
    with EventOutbox(path) as box:
        first = box.enqueue(event, "P")
        bound = box.bind(event.id, first["revision"], identity)
        receipt = matching_receipts([event], wire(event), identity)[event.id]
        box.ack(event.id, bound["revision"], receipt)
    with EventOutbox(path) as box:
        stored = box.inspect(event.id)
        assert stored["state"] == "acked" and stored["processing_state"] == "processed"
        assert stored["event_json"] == event.event_json
        effect = json.loads(stored["remote_receipt_json"])["processing"]["result"]
        assert effect == {"kind": "reflection_recorded", "target_kind": "reflection", "target_id": "receipt-original"}
        assert box.enqueue(event, "P")["replayed"] is True
        with pytest.raises(QueueError, match="event_id_conflict"):
            box.enqueue(frozen(data(lesson="a different original")), "P")


def test_reflection_processed_ack_is_accepted_by_the_real_repository(tmp_path):
    event = FrozenEvent.create("sop.reflection.recorded", data(), event_id="reflection-original", time=AT)
    identity = EventIdentity("T", "P", "U", "https://manager.test")
    with EventOutbox(tmp_path / "outbox.sqlite") as box:
        queued = box.enqueue(event, "P")
        bound = box.bind(event.id, queued["revision"], identity)
        receipt = matching_receipts([event], wire(event), identity)[event.id]
        box.ack(event.id, bound["revision"], receipt)
        stored = box.inspect(event.id)
        assert stored["state"] == "acked" and stored["processing_state"] == "processed"
        assert stored["event_json"] == event.event_json


@pytest.mark.parametrize("effect", [
    {"kind": "reflection_recorded", "target_kind": "task", "target_id": "receipt-original"},
    {"kind": "reflection_recorded", "target_kind": "reflection", "target_id": "another-receipt"},
    {"kind": "reflection_recorded", "target_kind": None, "target_id": None},
    {"kind": "reflection_recorded_typo", "target_kind": "reflection", "target_id": "receipt-original"},
    {"kind": "fact_recorded", "target_kind": "reflection", "target_id": "receipt-original"},
])
def test_false_reflection_effect_never_acknowledges_the_only_original(tmp_path, effect):
    event = FrozenEvent.create("sop.reflection.recorded", data(), event_id="reflection-original", time=AT)
    identity = EventIdentity("T", "P", "U", "https://manager.test")
    with EventOutbox(tmp_path / "outbox.sqlite") as box:
        queued = box.enqueue(event, "P")
        box.bind(event.id, queued["revision"], identity)
        with pytest.raises(EventProtocolError):
            matching_receipts([event], wire(event, effect=effect), identity)
        assert box.inspect(event.id)["state"] == "pending"
        assert box.inspect(event.id)["event_json"] == event.event_json


@pytest.mark.parametrize("changes", [
    {"handler": "task.status"}, {"state": "pending"}, {"state": "failed"},
    {"attempts": 0}, {"processed_at": None},
])
def test_reflection_effect_requires_the_actual_successful_handler(tmp_path, changes):
    event = FrozenEvent.create("sop.reflection.recorded", data(), event_id="reflection-original", time=AT)
    identity = EventIdentity("T", "P", "U", "https://manager.test")
    with EventOutbox(tmp_path / "outbox.sqlite") as box:
        queued = box.enqueue(event, "P")
        box.bind(event.id, queued["revision"], identity)
        response = wire(event)
        response["results"][0]["processing"].update(changes)
        with pytest.raises(EventProtocolError):
            matching_receipts([event], response, identity)
        assert box.inspect(event.id)["state"] == "pending"
