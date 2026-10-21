"""Actual ManagerClient + durable operation definitions. SOURCE ONLY; not run."""
from copy import deepcopy
import json
import os

import httpx
import pytest

from sop_sdk.delivery_ack import DeliveryAckError
from sop_sdk.delivery_journal import DeliveryJournal, DeliveryJournalError
from sop_sdk.delivery_operations import DeliveryOperations
from sop_sdk.errors import SopConflictError, SopForbiddenError, SopTransportError
from sop_sdk.security import BearerAuth
from test_delivery_task_submissions import client_for


def identity(actor="U"):
    return {"ok": True, "user": {"id": actor, "tenant_id": "TEN"}, "scope": {
        "tenant_id": "TEN", "project_id": "P", "tenant_code": "tenant",
        "business_code": "business", "project_code": "project"}}


def current():
    return {"project_id": "P", "task_id": "T", "version": 7, "task_basis": "a" * 64,
        "definition_digest": "b" * 64, "native_boundary_digest": "c" * 64,
        "can_dispatch": True, "can_submit": True, "reasons": [], "work_order": None,
        "criteria": [{"source": "task", "index": 0, "text": "Explicit review", "text_digest": "d" * 64}]}


def detail(state="queued"):
    return {"project_id": "P", "version": 7, "work_order": {"id": "W", "task_id": "T",
        "order_revision": 2, "state": state, "request_digest": "e" * 64, "packet_digest": "f" * 64},
        "permissions": {"can_claim": state == "queued", "can_progress": state == "claimed", "can_cancel": True,
            "can_release": state == "claimed", "can_report": state == "claimed"}}


def authored():
    return {"source": {"kind": "tool", "name": "Editor", "url": ""}, "summary": "Ready for human review",
        "artifacts": [{"id": "diff", "title": "Diff", "content": "Actual reported diff", "url": "", "sha256": None}],
        "criteria": [{"source": "task", "index": 0, "result": "unknown", "evidence_ids": []}],
        "tests": [{"id": "test", "title": "Suite", "status": "not_run", "evidence_ids": []}]}


def receipt(body, *, replayed=False):
    action, p = body["action"], body["payload"]
    refs = [{"kind": "task", "id": "T"}]
    if action.startswith("work_order."):
        state = {"create": "queued", "claim": "claimed", "progress": "claimed", "cancel": "cancel_requested",
            "release": "closed", "report": "reported"}[action.split(".")[-1]]
        result = {"work_order_id": "W", "task_ids": ["T"], "request_digest": "e" * 64,
            "packet_digest": "f" * 64, "order_revision": 1 if action.endswith("create") else 3,
            "state": state, "submission_id": "S" if action.endswith("report") else None}
        resource = {"kind": "work_order", "id": "W"}
        if action.endswith("report"): refs.append({"kind": "task_submission", "id": "S"})
    else:
        review = action.endswith("review")
        result = {"task_ids": ["T"], "submission_id": "S", "submission_digest": "1" * 64, "issue_id": None}
        resource = {"kind": "task_review" if review else "task_submission", "id": "R" if review else "S"}
        if review:
            result.update(decision_id="D", review_id="R")
            refs.append({"kind": "task_submission", "id": "S"})
        if not review and p.get("work_order"):
            result["work_order"] = {"id": p["work_order"]["id"], "order_revision": p["work_order"]["order_revision"] + 1, "state": "reported"}
            refs.append({"kind": "work_order", "id": p["work_order"]["id"]})
    return {"project_id": "P", "action": action, "resource": resource, "result": result,
        "affected_refs": [resource, *refs], "applied_version": 8, "version": 8,
        "query_generation": 1, "replayed": replayed}


def server(request):
    if request.url.path.endswith("/context/me"): return httpx.Response(200, json=identity())
    if request.url.path.endswith("/work-order-preview"):
        return httpx.Response(200, json={**current(), "complete": True, "allowed": True,
            "preview_basis": "9" * 64, "packet_digest": "f" * 64, "executor": {"id": "agent", "available": True}})
    if request.url.path.endswith("/current"): return httpx.Response(200, json=current())
    if request.url.path.endswith("/delivery-submissions/S"):
        return httpx.Response(200, json={**current(), "submission": {"id": "S", "task_id": "T", "digest": "1" * 64},
            "permissions": {"can_review": True, "can_accept": True}})
    if request.method == "GET": return httpx.Response(200, json=detail())
    return httpx.Response(200, json=receipt(json.loads(request.content)))


@pytest.mark.parametrize("action", ["create", "claim", "progress", "cancel", "release", "report", "submit", "review"])
def test_all_eight_real_preparers_send_exact_saved_original_and_confirm_durably(tmp_path, action):
    requests = []
    def transport(request):
        requests.append(request)
        if request.method == "GET" and request.url.path.endswith("/work-orders/W"):
            return httpx.Response(200, json=detail("queued" if action == "claim" else "claimed"))
        return server(request)
    journal = DeliveryJournal(tmp_path / "journal")
    with client_for(transport) as client:
        operations = DeliveryOperations(client, journal)
        if action == "create": saved = operations.prepare_work_order_create("T", "agent", "Fixed instructions")
        elif action == "submit": saved = operations.prepare_submit("T", authored())
        elif action == "review": saved = operations.prepare_review("T", "S", "accept", "Human verified the exact original")
        else:
            fields = {"claim": {}, "progress": {"percent": None, "status": "blocked", "message": "Environment unavailable"},
                "cancel": {"comment": "Stop requested"}, "release": {"comment": "Stopped", "stopped_attestation": True},
                "report": {"submission_id": "S", "stopped_attestation": True}}[action]
            saved = operations.prepare_work_order_action("W", action, **fields)
        before = deepcopy(saved["original"])
        assert saved["state"] == "prepared" and not any(r.url.path.endswith("/commands") for r in requests)
        result = operations.send(saved["id"])
        writes = [r for r in requests if r.url.path.endswith("/commands")]
        assert len(writes) == 1 and json.loads(writes[0].content) == before
        assert result["state"] == "confirmed" and result["ack"]["applied_version"] == 8
        assert DeliveryJournal(tmp_path / "journal").inspect(saved["id"])["original"] == before
        assert operations.finish(saved["id"])["active"] is False


def test_unknown_replay_keeps_original_after_403_and_409_and_never_reprepares(tmp_path):
    writes, failures = [], [None, 403, 409, 200]
    def transport(request):
        if not request.url.path.endswith("/commands"): return server(request)
        writes.append(bytes(request.content))
        status = failures.pop(0)
        if status is None: raise httpx.ReadError("Secret detail must not be saved", request=request)
        if status != 200: return httpx.Response(status, json={"detail": "private error content"})
        return httpx.Response(200, json=receipt(json.loads(request.content), replayed=True))
    with client_for(transport) as client:
        client.max_retries = 9
        operations = DeliveryOperations(client, DeliveryJournal(tmp_path / "journal"))
        saved = operations.prepare_work_order_action("W", "claim")
        for error in (SopTransportError, SopForbiddenError, SopConflictError):
            with pytest.raises(error): operations.resume(saved["id"])
            assert operations.inspect(saved["id"])["state"] == "unknown"
        assert operations.resume(saved["id"])["state"] == "confirmed"
    assert len(writes) == 4 and len(set(writes)) == 1
    assert "private error" not in (tmp_path / "journal" / (saved["id"] + ".json")).read_text()


@pytest.mark.parametrize("mutation", ["project", "action", "version", "bool", "refs", "digest", "revision", "packet", "state", "extra"])
def test_forged_actual_ack_never_confirms(tmp_path, mutation):
    def transport(request):
        if not request.url.path.endswith("/commands"): return server(request)
        ack = receipt(json.loads(request.content))
        if mutation == "project": ack["project_id"] = "other"
        elif mutation == "action": ack["action"] = "work_order.release"
        elif mutation == "version": ack["applied_version"] = 99
        elif mutation == "bool": ack["replayed"] = 1
        elif mutation == "refs": ack["affected_refs"].append({"kind": "task", "id": "other"})
        elif mutation == "digest": ack["result"]["request_digest"] = "0" * 64
        elif mutation == "revision": ack["result"]["order_revision"] = 2
        elif mutation == "packet": ack["result"]["packet_digest"] = "0" * 64
        elif mutation == "state": ack["result"]["state"] = "closed"
        else: ack["unrecognized"] = True
        return httpx.Response(200, json=ack)
    with client_for(transport) as client:
        operations = DeliveryOperations(client, DeliveryJournal(tmp_path / "journal"))
        saved = operations.prepare_work_order_action("W", "claim")
        with pytest.raises(DeliveryAckError): operations.send(saved["id"])
        assert operations.inspect(saved["id"])["state"] == "unknown"


def test_auth_rotation_is_allowed_but_account_switch_and_failed_identity_get_never_write(tmp_path):
    actor, unavailable, writes = ["U"], [False], []
    def transport(request):
        if request.url.path.endswith("/context/me"):
            return httpx.Response(503 if unavailable[0] else 200, json=identity(actor[0]))
        if request.url.path.endswith("/commands"): writes.append(request)
        return server(request)
    with client_for(transport) as client:
        client.auth = BearerAuth("first-secret")
        operations = DeliveryOperations(client, DeliveryJournal(tmp_path / "journal"))
        saved = operations.prepare_work_order_action("W", "claim")
        actor[0] = "other"
        with pytest.raises(ValueError): operations.send(saved["id"])
        assert operations.inspect(saved["id"])["state"] == "prepared" and not writes
        actor[0], unavailable[0] = "U", True
        with pytest.raises(Exception): operations.send(saved["id"])
        assert operations.inspect(saved["id"])["original"] == saved["original"] and not writes
        unavailable[0] = False
        client.auth = BearerAuth("rotated-secret")
        assert operations.send(saved["id"])["state"] == "confirmed"
        unavailable[0] = True
        assert operations.finish(saved["id"])["active"] is False
    raw = (tmp_path / "journal" / (saved["id"] + ".json")).read_text()
    assert "first-secret" not in raw and "rotated-secret" not in raw


@pytest.mark.parametrize("raw", [b'{"x":1,"x":2}', b'{"x":NaN}', b'\xff', b'"\\ud800"'])
def test_import_and_actual_transport_reject_noncanonical_json_without_success(tmp_path, raw):
    path = tmp_path / "input.json"; path.write_bytes(raw)
    with client_for(server) as client:
        operations = DeliveryOperations(client, DeliveryJournal(tmp_path / "journal"))
        with pytest.raises(ValueError): operations.prepare_file(path)
    assert path.read_bytes() == raw
    with client_for(lambda _r: httpx.Response(200, content=raw, headers={"content-type": "application/json"})) as client:
        with pytest.raises(DeliveryAckError): client.delivery_work_order_command({"action": "work_order.claim", "expected_version": 7,
            "idempotency_key": "fixed-claim-original", "payload": {"id": "W", "order_revision": 2}})


def test_prepare_submit_never_infers_pass_or_stop_and_current_fills_only_fixed_basis(tmp_path):
    with client_for(server) as client:
        operations = DeliveryOperations(client, DeliveryJournal(tmp_path / "journal"))
        saved = operations.prepare_submit("T", authored())
        p = saved["original"]["payload"]
        assert p["task_basis"] == "a" * 64 and p["criteria"][0]["text_digest"] == "d" * 64
        assert p["criteria"][0]["result"] == "unknown" and p["tests"][0]["status"] == "not_run"
        assert "work_order" not in p
        with pytest.raises(ValueError): operations.prepare_work_order_action("W", "release", comment="Stopped")


def test_submit_handoff_requires_this_call_stop_attestation_and_fixed_current_w_revision(tmp_path):
    def transport(request):
        if request.url.path.endswith("/delivery-submissions/current"):
            return httpx.Response(200, json={**current(), "work_order": {"id": "W", "order_revision": 2,
                "executor": {"id": "agent", "name": "Agent", "kind": "agent", "tool": "", "active": True, "available": True, "reasons": []}}})
        return server(request)
    with client_for(transport) as client:
        operations = DeliveryOperations(client, DeliveryJournal(tmp_path / "journal"))
        with pytest.raises(ValueError): operations.prepare_submit("T", authored(), work_order_id="W")
        with pytest.raises(ValueError): operations.prepare_submit("T", authored(), stopped_attestation=True)
        saved = operations.prepare_submit("T", authored(), work_order_id="W", stopped_attestation=True)
        assert saved["original"]["payload"]["work_order"] == {"id": "W", "order_revision": 2, "stopped_attestation": True}
        confirmed = operations.send(saved["id"])
        assert confirmed["ack"]["result"]["work_order"] == {"id": "W", "order_revision": 3, "state": "reported"}


def test_journal_cas_active_slot_damage_and_lock_are_real(tmp_path):
    journal = DeliveryJournal(tmp_path / "journal")
    with client_for(server) as client:
        saved = DeliveryOperations(client, journal).prepare_work_order_action("W", "claim")
        with pytest.raises(DeliveryJournalError): DeliveryOperations(client, journal).prepare_submit("T", authored())
    with journal.transaction():
        with pytest.raises(DeliveryJournalError):
            with DeliveryJournal(tmp_path / "journal").transaction(): pass
    with pytest.raises(DeliveryJournalError): journal.update(saved["id"], saved["revision"] + 1, state="unknown")
    path = tmp_path / "journal" / (saved["id"] + ".json")
    value = json.loads(path.read_text()); value["original"]["payload"]["id"] = "different"
    path.write_text(json.dumps(value))
    with pytest.raises(DeliveryJournalError): journal.inspect(saved["id"])


def test_journal_rejects_symlink_or_hardlink_record_and_never_changes_target(tmp_path):
    journal = DeliveryJournal(tmp_path / "journal")
    with client_for(server) as client: saved = DeliveryOperations(client, journal).prepare_work_order_action("W", "claim")
    path = tmp_path / "journal" / (saved["id"] + ".json")
    outside = tmp_path / "outside.json"; outside.write_bytes(path.read_bytes()); before = outside.read_bytes()
    path.unlink()
    try: os.symlink(outside, path)
    except OSError: os.link(outside, path)
    with pytest.raises(DeliveryJournalError): journal.inspect(saved["id"])
    assert outside.read_bytes() == before


def test_discard_prepared_keeps_original_and_history_but_never_discards_unknown(tmp_path):
    writes = []
    def transport(request):
        if request.url.path.endswith("/commands"):
            writes.append(request)
            raise httpx.ReadError("Lost response", request=request)
        return server(request)
    journal = DeliveryJournal(tmp_path / "journal")
    with client_for(transport) as client:
        operations = DeliveryOperations(client, journal)
        first = operations.prepare_work_order_action("W", "claim")
        cancelled = operations.discard(first["id"])
        assert cancelled["state"] == "cancelled" and cancelled["active"] is False
        assert cancelled["original"] == first["original"] and not writes
        assert journal.list()["items"] == []
        assert journal.list(include_closed=True)["items"] == [{"id": first["id"], "action": "work_order.claim", "task_id": "T", "state": "cancelled", "active": False}]
        second = operations.prepare_submit("T", authored())
        with pytest.raises(SopTransportError): operations.send(second["id"])
        with pytest.raises(DeliveryJournalError): operations.discard(second["id"])
        assert operations.inspect(second["id"])["state"] == "unknown" and len(writes) == 1
        with pytest.raises(DeliveryJournalError): operations.send(first["id"])
        active = journal.list()["items"]
        assert active == [{"id": second["id"], "action": "task.delivery.submit", "task_id": "T", "state": "unknown", "active": True}]
        assert all(set(item) == {"id", "action", "task_id", "state", "active"} for item in journal.list(include_closed=True)["items"])


def test_complete_prepared_import_never_infers_missing_packet_binding_or_resets_unknown(tmp_path):
    with client_for(server) as client:
        operations = DeliveryOperations(client, DeliveryJournal(tmp_path / "one"))
        saved = operations.prepare_work_order_create("T", "agent", "Fixed instructions")
        wire = tmp_path / "wire.json"; wire.write_text(json.dumps(saved["original"]))
        imported = tmp_path / "prepared.json"; imported.write_text(json.dumps(saved))
        other = DeliveryOperations(client, DeliveryJournal(tmp_path / "two"))
        with pytest.raises(ValueError): other.prepare_file(wire)
        restored = other.prepare_file(imported)
        assert restored["original"] == saved["original"] and restored["binding"] == saved["binding"]
        other.journal.update(restored["id"], restored["revision"], state="unknown")
        imported.write_text(json.dumps(other.inspect(restored["id"])))
        with pytest.raises(ValueError): DeliveryOperations(client, DeliveryJournal(tmp_path / "three")).prepare_file(imported)


@pytest.mark.parametrize("status", [422, 500])
def test_typed_direct_consumer_never_implicitly_retries_any_post(tmp_path, status):
    writes = []
    def transport(request):
        writes.append(request)
        return httpx.Response(status, json={"detail": "Explicit failure"})
    body = {"action": "work_order.claim", "expected_version": 7, "idempotency_key": "exact-fixed-key", "payload": {"id": "W", "order_revision": 2}}
    with client_for(transport) as client:
        client.max_retries = 12
        with pytest.raises(Exception): client.delivery_command(body)
    assert len(writes) == 1 and writes[0].method == "POST"


@pytest.mark.parametrize("method", ["delivery_command", "delivery_work_order_command", "delivery_task_submit", "delivery_task_submit_review"])
def test_actual_code_only_consumers_resolve_project_before_post_without_using_ack_as_scope(method):
    calls = []
    def transport(request):
        calls.append(request)
        return server(request)
    with client_for(transport) as client:
        client.project_id = ""
        client.tenant_code, client.business_code, client.project_code = "tenant", "business", "project"
        if method in {"delivery_command", "delivery_work_order_command"}:
            body = {"action": "work_order.claim", "expected_version": 7, "idempotency_key": "fixed-original-key", "payload": {"id": "W", "order_revision": 2}}
        else:
            payload = {**authored(), "task_id": "T", "task_basis": "a" * 64, "definition_digest": "b" * 64, "native_boundary_digest": "c" * 64}
            payload["criteria"][0]["text_digest"] = "d" * 64
            if method.endswith("review"):
                payload = {"task_id": "T", "submission_id": "S", "submission_digest": "1" * 64,
                    "task_basis": "a" * 64, "native_boundary_digest": "c" * 64, "decision": "accept", "comment": "Verified"}
            body = {"expected_version": 7, "idempotency_key": "fixed-original-key", "payload": payload}
        assert getattr(client, method)(body)["project_id"] == "P"
    assert len(calls) == 2 and calls[0].url.path.endswith("/context/me") and calls[1].method == "POST"
    assert calls[1].headers["X-Project-Id"] == "P"
    assert json.loads(calls[1].content)["expected_version"] == 7
    assert json.loads(calls[1].content)["idempotency_key"] == "fixed-original-key"


def test_code_only_identity_failure_never_posts_or_adopts_ack_project():
    calls = []
    with client_for(lambda request: calls.append(request) or httpx.Response(503, json={"detail": "Identity unavailable"})) as client:
        client.project_id = ""
        with pytest.raises(Exception): client.delivery_work_order_command({"action": "work_order.claim", "expected_version": 7,
            "idempotency_key": "fixed-original-key", "payload": {"id": "W", "order_revision": 2}})
    assert len(calls) == 1 and calls[0].method == "GET"


def test_auth_and_scope_are_frozen_between_code_resolution_and_actual_post():
    calls = []
    with client_for(lambda request: transport(request)) as client:
        client.project_id = ""
        client.auth = BearerAuth("old-credential")
        def transport(request):
            calls.append(request)
            if request.url.path.endswith("/context/me"):
                client.project_id = "other-project"
                client.auth = BearerAuth("new-credential")
            return server(request)
        ack = client.delivery_work_order_command({"action": "work_order.claim", "expected_version": 7,
            "idempotency_key": "fixed-original-key", "payload": {"id": "W", "order_revision": 2}})
    assert ack["project_id"] == "P" and len(calls) == 2
    assert calls[1].headers["X-Project-Id"] == "P" and calls[1].headers["Authorization"] == "Bearer old-credential"


def test_failed_original_marker_fsync_prevents_post_and_preserves_prepared_source(tmp_path, monkeypatch):
    import sop_sdk.delivery_journal as journal_module
    writes = []
    def transport(request):
        if request.url.path.endswith("/commands"): writes.append(request)
        return server(request)
    with client_for(transport) as client:
        operations = DeliveryOperations(client, DeliveryJournal(tmp_path / "journal"))
        saved = operations.prepare_work_order_action("W", "claim")
        path = tmp_path / "journal" / (saved["id"] + ".json"); before = path.read_bytes()
        with operations.journal.operation_lock(saved["id"]): pass
        def fail_fsync(_fd): raise OSError("disk unavailable")
        with monkeypatch.context() as patch:
            patch.setattr(journal_module.os, "fsync", fail_fsync)
            with pytest.raises(OSError): operations.send(saved["id"])
        assert not writes and path.read_bytes() == before and operations.inspect(saved["id"])["state"] == "prepared"


def test_different_tasks_can_send_concurrently_but_same_original_has_one_os_locked_attempt(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    entered, release = Event(), Event()
    writes = []
    def transport(request):
        if request.method == "GET" and "/work-orders/W" in request.url.path:
            order = request.url.path.rsplit("/", 1)[1]
            value = detail(); value["work_order"].update(id=order, task_id="T" + order[-1])
            return httpx.Response(200, json=value)
        if request.url.path.endswith("/commands"):
            body = json.loads(request.content); order = body["payload"]["id"]
            writes.append(order)
            if order == "W1":
                entered.set()
                if not release.wait(5): raise RuntimeError("Different task was blocked behind the first HTTP call")
            value = receipt(body)
            value["resource"]["id"] = order
            value["result"].update(work_order_id=order, task_ids=["T" + order[-1]])
            value["affected_refs"] = [{"kind": "work_order", "id": order}, {"kind": "task", "id": "T" + order[-1]}]
            return httpx.Response(200, json=value)
        return server(request)
    with client_for(transport) as client:
        operations = DeliveryOperations(client, DeliveryJournal(tmp_path / "journal"))
        first = operations.prepare_work_order_action("W1", "claim")
        second = operations.prepare_work_order_action("W2", "claim")
        with ThreadPoolExecutor(max_workers=1) as pool:
            running = pool.submit(operations.send, first["id"])
            try:
                assert entered.wait(5)
                with pytest.raises(DeliveryJournalError): operations.send(first["id"])
                assert operations.send(second["id"])["state"] == "confirmed"
                assert writes == ["W1", "W2"]
            finally: release.set()
            assert running.result(timeout=5)["state"] == "confirmed"
