"""Durable control/launch fault definitions; runtime validation is deferred."""

from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import replace
from threading import Barrier

import pytest
from sqlalchemy import event, func, select, delete

from hermes_core.execution import Execution
from hermes_core.execution_targets import workspace_execution_targets
from hermes_core.managed_controls import ManagedControls, control_definition_hash, managed_control_digest
from hermes_core.managed_handoff import ManagedHandoff
from hermes_core.models import CoreError, Node, Principal, TaskDispatch
from hermes_core.transactional import Store, digest


@pytest.fixture
def controlled(tmp_path, monkeypatch):
    return build_controlled(tmp_path, monkeypatch)


def build_controlled(tmp_path, monkeypatch, *, nodes=None):
    store = Store("sqlite:///" + (tmp_path / "controls.sqlite").as_posix())
    principal = Principal("requester", tenant="tenant", business="business")
    store.create(principal, "", "workspaces", {"name": "Workspace", "root": str(tmp_path)},
                 "workspace", "setup", entity_id="W")
    execution = Execution(store, tmp_path)
    execution.agentd = "/unused/sop-agentd"
    monkeypatch.setattr(execution, "available", lambda: True)
    target = workspace_execution_targets(store, execution, principal, "W")["local"]
    handoff = dict(operation_id="H", project_id="P", execution_id="E", fence=1,
        envelope={"title": "Change", "description": "Implement", "acceptance_criteria": "Checked",
                  "source": {"kind": "manager.delivery", "execution_id": "E", "snapshot": {"task_id": "T"}}},
        body=TaskDispatch(expected_version=1, idempotency_key="E", dry_run=False,
                          nodes=nodes or [Node(id="check", argv=["echo", "checked"])], target_basis=target["basis"]),
        plan_basis="a" * 64)
    plan = ManagedHandoff(store, execution).dispatch(principal, "W", **handoff)
    run = store.get(principal, "W", "runs", plan["run_id"])
    original = {"schema": "manager.execution-control.v1", "tenant": principal.tenant,
        "business": principal.business, "workspace": "W", "actor": principal.actor,
        "control_id": "C-start", "project_id": "P", "execution_id": "E", "task_id": "T",
        "action": "execution.start", "original": {"payload": {"id": "E", "run_id": run["id"],
            "run_version": run["version"], "attempt": 1, "control_basis": "b" * 64, "reason": "Start reviewed plan"},
            "version": 1, "key": "start-key"}, "accepted_version": 2,
        "runtime_task_id": plan["runtime_task_id"], "definition_hash": control_definition_hash(run),
        "prior_requests": [], "handoff_request": None, "target_request": None}
    return store, execution, principal, original


def test_missing_control_probe_is_select_only_and_does_not_reserve_identity(controlled):
    store, execution, principal, original = controlled
    statements = []
    event.listen(store.engine, "before_cursor_execute", lambda _c, _q, statement, *_args: statements.append(statement))
    assert ManagedControls(store, execution).probe(principal, "W", request=original) is None
    assert statements and all(statement.lstrip().upper().startswith("SELECT") for statement in statements)


def test_close_before_delayed_apply_is_irreversible_without_execution_authority(controlled):
    store, execution, principal, original = controlled
    reader = replace(principal, permissions=frozenset({"read"}), workspace_ids=frozenset())
    service = ManagedControls(store, execution)
    closed = service.close(reader, "W", request=original)
    assert closed["state"] == "closed" and closed["outcome"] == "closed_no_effect"
    assert service.apply(principal, "W", request=original)["state"] == "closed"
    assert store.get(principal, "W", "runs", original["original"]["payload"]["run_id"])["status"] == "planned"
    assert service.launch_view(reader, "W", request=original) is None


def test_effect_and_launch_recover_after_store_reopen_without_second_transition(controlled):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    first = service.apply(principal, "W", request=original)
    assert first["state"] == "applied" and first["run"]["status"] == "queued"
    assert first["launch"]["state"] == "ready"
    reopened = Store(str(store.engine.url))
    reader = replace(principal, permissions=frozenset({"read"}), workspace_ids=frozenset())
    resumed = ManagedControls(reopened, Execution(reopened, execution.data_dir))
    assert resumed.probe(reader, "W", request=original)["receipt_id"] == first["receipt_id"]
    assert resumed.apply(reader, "W", request=original)["run_version"] == first["run_version"]
    assert resumed.close(reader, "W", request=original)["state"] == "applied"
    assert resumed.dispatch_ready(reader, "W", request=original)["launch_id"] == first["launch"]["id"]


@pytest.mark.parametrize("field,value", [("project_id", "other"), ("execution_id", "other"), ("actor", "other")])
def test_global_control_identity_rejects_scope_rebinding(controlled, field, value):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    service.close(principal, "W", request=original)
    changed = deepcopy(original)
    changed[field] = value
    if field == "execution_id":
        changed["original"]["payload"]["id"] = value
    actor = replace(principal, actor=value) if field == "actor" else principal
    with pytest.raises(CoreError) as failure:
        service.probe(actor, "W", request=changed)
    assert failure.value.status == 409


def test_complete_digest_includes_body_and_original_ack_identity(controlled):
    _store, _execution, principal, original = controlled
    digest = managed_control_digest(principal, "W", request=original)
    for field in ("reason", "control_basis"):
        changed = deepcopy(original)
        changed["original"]["payload"][field] = "c" * 64 if field == "control_basis" else "Different reason"
        assert managed_control_digest(principal, "W", request=changed) != digest


def facts(store):
    with store.engine.connect() as conn:
        return {name: conn.execute(select(table)).fetchall() for name, table in (
            ("entities", store.entities), ("events", store.events), ("receipts", store.receipts),
            ("handoffs", store.managed_handoffs), ("launches", store.managed_launches))}


def control_for(original, run, *, action, control_id, version, approval=None):
    request = deepcopy(original)
    request.update(action=action, control_id=control_id, accepted_version=version + 1,
                   definition_hash=control_definition_hash(run), prior_requests=[], target_request=None, handoff_request=None)
    payload = {"id": original["execution_id"], "run_id": run["id"], "run_version": run["version"],
               "attempt": run["data"].get("attempt", 1), "control_basis": "b" * 64, "reason": "Reviewed exact operation"}
    if approval is not None:
        payload.update(approval_id=approval["id"], approval_version=approval["version"], decision="approve")
    request["original"] = {"payload": payload, "version": version, "key": control_id + "-key"}
    return request


def close_for(original, *, control_id="C-close", version=10, actor=None):
    request = deepcopy(original)
    request.update(action="execution.control.close", control_id=control_id, accepted_version=version + 1,
                   actor=actor or original["actor"], prior_requests=[], target_request=deepcopy(original), handoff_request=None)
    request["original"] = {"version": version, "key": control_id + "-key", "payload": {
        "id": original["execution_id"], "control_operation_id": original["control_id"],
        "request_digest": digest(original), "reason": "End this exact blocked request"}}
    return request


def attach_authority(execution, principal, calls=None, *, allowed=True):
    @contextmanager
    def authority(*, request, ticket):
        assert not execution.store.lock._is_owned(), "Manager authority must precede the Core transaction"
        assert request == ticket["request"] and request["control_id"] == ticket["control_id"]
        if not allowed:
            raise CoreError("forbidden", "Current project execution was revoked", 403)
        if calls is not None:
            calls.append(("enter", ticket["id"]))
        try:
            yield principal
        finally:
            assert not execution.store.lock._is_owned(), "Release the Core claim before Manager authority"
            if calls is not None:
                calls.append(("exit", ticket["id"]))
    execution.managed_launch_authority = authority


def test_control_effect_ticket_and_both_receipts_roll_back_together(controlled, monkeypatch):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    before = facts(store)

    def lose_commit(*_args, **_kwargs):
        raise RuntimeError("Fault after effect and ticket, before terminal receipt")

    monkeypatch.setattr(service, "store_receipt", lose_commit)
    with pytest.raises(RuntimeError, match="before terminal receipt"):
        service.apply(principal, "W", request=original)
    assert facts(store) == before
    assert service.probe(principal, "W", request=original) is None


def test_concurrent_apply_after_reopen_has_one_effect_and_one_ticket(controlled, monkeypatch):
    store, execution, principal, original = controlled
    other = Store(str(store.engine.url))
    other_execution = Execution(other, execution.data_dir)
    other_execution.agentd = execution.agentd
    monkeypatch.setattr(other_execution, "available", lambda: True)
    barrier = Barrier(2)

    def apply(service):
        barrier.wait(timeout=5)
        return service.apply(principal, "W", request=original)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, [ManagedControls(store, execution), ManagedControls(other, other_execution)]))
    assert {result["receipt_id"] for result in results} == {results[0]["receipt_id"]}
    assert {result["run_version"] for result in results} == {results[0]["run_version"]}
    with store.engine.connect() as conn:
        assert conn.scalar(select(func.count()).select_from(store.managed_launches)) == 1
        assert conn.scalar(select(func.count()).select_from(store.events).where(store.events.c.action == "run.start")) == 1


def test_concurrent_apply_and_close_share_one_irreversible_terminal_slot(controlled):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    barrier = Barrier(2)

    def perform(closing):
        barrier.wait(timeout=5)
        return (service.close if closing else service.apply)(principal, "W", request=original)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(perform, [True, False]))
    assert len({item["state"] for item in results}) == 1
    run = store.get(principal, "W", "runs", original["original"]["payload"]["run_id"])
    assert run["status"] == ("planned" if results[0]["state"] == "closed" else "queued")


def test_close_of_applied_control_returns_fact_and_does_not_revoke_launch(controlled):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    applied = service.apply(principal, "W", request=original)
    close = close_for(original, actor="project-product-manager")
    reader = replace(principal, actor=close["actor"], permissions=frozenset({"read"}))
    result = service.apply(reader, "W", request=close)
    assert result["state"] == "applied" and result["outcome"] == "target_applied"
    assert result["target"]["run_id"] == applied["run_id"]
    assert service.launch_view(reader, "W", request=original)["state"] == "ready"


def test_close_can_seal_complete_cancel_with_bounded_prior_without_widening(controlled):
    store, execution, principal, original = controlled
    run = store.get(principal, "W", "runs", original["original"]["payload"]["run_id"])
    cancel = control_for(original, run, action="execution.cancel", control_id="C-cancel", version=2)
    cancel["prior_requests"] = [deepcopy(original)]
    close = close_for(cancel, version=3)
    service = ManagedControls(store, execution)
    result = service.apply(principal, "W", request=close)
    assert result["outcome"] == "target_closed"
    assert service.apply(principal, "W", request=cancel)["state"] == "closed"
    # Closing cancel does not execute its preemptions or silently close start.
    assert service.probe(principal, "W", request=original) is None
    assert store.get(principal, "W", "runs", run["id"])["status"] == "planned"


@pytest.mark.parametrize("start_first", [True, False])
def test_explicit_cancel_preempts_exact_prior_start_and_revokes_ready_ticket(controlled, start_first):
    store, execution, principal, original = controlled
    run = store.get(principal, "W", "runs", original["original"]["payload"]["run_id"])
    cancel = control_for(original, run, action="execution.cancel", control_id="C-cancel", version=2)
    cancel["prior_requests"] = [deepcopy(original)]
    service = ManagedControls(store, execution)
    if start_first:
        service.apply(principal, "W", request=original)
    stopped = service.apply(principal, "W", request=cancel)
    assert stopped["run"]["status"] == "cancelled"
    assert stopped["run"]["data"]["stop_request"]["state"] == "not_started"
    replay = service.apply(principal, "W", request=original)
    assert replay["state"] == ("applied" if start_first else "closed")
    assert service.dispatch_ready(principal, "W", request=original) is None
    launch = service.launch_view(principal, "W", request=original)
    assert launch is None or launch["state"] == "revoked"


def test_cancel_tolerates_progress_but_records_current_owner_and_node(controlled):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    started = service.apply(principal, "W", request=original)
    cancel = control_for(original, started["run"], action="execution.cancel", control_id="C-cancel", version=2)
    store.mutate(principal, "W", "runs", started["run_id"], operation="test.progress", key="heartbeat", request={}, trace="test", expected=None,
        transform=lambda item: {"status": "running", "data": {**item["data"], "execution_owner": "current-owner",
            "active_node": "check", "lease_expires_at": 10**12}})
    stopped = service.apply(principal, "W", request=cancel)
    stop = stopped["run"]["data"]["stop_request"]
    assert stop["state"] == "requested" and stop["owner"] == "current-owner" and stop["node_id"] == "check"
    assert cancel["original"]["payload"]["run_version"] == started["run_version"]


@pytest.mark.parametrize("change", ["attempt", "definition", "source"])
def test_cancel_never_retargets_changed_attempt_definition_or_source(controlled, change):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    started = service.apply(principal, "W", request=original)
    cancel = control_for(original, started["run"], action="execution.cancel", control_id="C-cancel", version=2)
    if change == "source":
        store.mutate(principal, "W", "tasks", original["runtime_task_id"], operation="test.source", key="source", request={}, trace="test", expected=None,
            transform=lambda item: {"data": {**item["data"], "source": {**item["data"]["source"], "execution_id": "other"}}})
    else:
        store.mutate(principal, "W", "runs", started["run_id"], operation="test.progress", key="change", request={}, trace="test", expected=None,
            transform=lambda item: {"data": {**item["data"], **({"attempt": 2} if change == "attempt" else {"base_commit": "c" * 40})}})
    before = facts(store)
    with pytest.raises(CoreError) as caught:
        service.apply(principal, "W", request=cancel)
    assert caught.value.code in {"stale_attempt", "definition_changed", "control_source"}
    assert facts(store) == before and service.probe(principal, "W", request=cancel) is None


def pending_handoff(original, execution, store, principal, *, suffix="pending"):
    target = workspace_execution_targets(store, execution, principal, "W")["local"]
    request = deepcopy(original)
    request.update(control_id="C-" + suffix, execution_id="E-" + suffix, action="execution.cancel", runtime_task_id="",
                   definition_hash=None, prior_requests=[], target_request=None)
    request["original"] = {"version": 2, "key": suffix + "-cancel", "payload": {
        "id": request["execution_id"], "run_id": "", "run_version": 0, "attempt": 1, "control_basis": "b" * 64, "reason": "Cancel pending plan"}}
    request["accepted_version"] = 3
    request["handoff_request"] = {"actor": principal.actor, "operation_id": "H-" + suffix, "project_id": "P", "execution_id": request["execution_id"],
        "envelope": {"title": "Pending", "description": "Change", "acceptance_criteria": "Reviewed",
                     "source": {"kind": "manager.delivery", "execution_id": request["execution_id"], "snapshot": {"task_id": "T"}}},
        "dispatch_kind": "command", "body": TaskDispatch(expected_version=1, idempotency_key=request["execution_id"], dry_run=False,
            nodes=[Node(id="pending", argv=["echo", "pending"])], target_basis=target["basis"]).model_dump(), "plan_basis": "a" * 64}
    return request


def test_pending_cancel_seals_handoff_and_its_c_receipt_in_one_transaction(controlled, monkeypatch):
    store, execution, principal, original = controlled
    pending = pending_handoff(original, execution, store, principal)
    service = ManagedControls(store, execution)
    before = facts(store)
    save = service.store_receipt
    monkeypatch.setattr(service, "store_receipt", lambda *_args: (_ for _ in ()).throw(RuntimeError("receipt fault")))
    with pytest.raises(RuntimeError, match="receipt fault"):
        service.apply(principal, "W", request=pending)
    assert facts(store) == before
    monkeypatch.setattr(service, "store_receipt", save)
    result = service.apply(principal, "W", request=pending)
    assert result["handoff"]["closed"] is True and result["handoff"]["run_id"] is None
    h = pending["handoff_request"]
    late = ManagedHandoff(store, execution).dispatch(principal, "W", fence=1,
        **{key: h[key] for key in ("operation_id", "project_id", "execution_id", "envelope", "plan_basis")},
        body=TaskDispatch.model_validate(h["body"]))
    assert late["closed"] is True and late["run_id"] is None


def test_pending_cancel_returns_actual_plan_when_handoff_won(controlled):
    store, execution, principal, original = controlled
    pending = pending_handoff(original, execution, store, principal)
    h = pending["handoff_request"]
    planned = ManagedHandoff(store, execution).dispatch(principal, "W", fence=1,
        **{key: h[key] for key in ("operation_id", "project_id", "execution_id", "envelope", "plan_basis")},
        body=TaskDispatch.model_validate(h["body"]))
    result = ManagedControls(store, execution).apply(principal, "W", request=pending)
    assert result["outcome"] == "handoff_planned" and result["handoff"]["run_id"] == planned["run_id"]
    assert result["run"] is None and store.get(principal, "W", "runs", planned["run_id"])["status"] == "planned"


def test_local_consumer_requires_callback_and_claims_once_after_restart(controlled, monkeypatch):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    service.apply(principal, "W", request=original)
    dispatch = service.dispatch_ready(principal, "W", request=original)
    tools, authority = [], []
    monkeypatch.setattr(execution, "tool", lambda _p, _w, _r, node, _root, _owner: tools.append(node.id) or {"succeeded": True, "exit_code": 0})
    reader = replace(principal, permissions=frozenset({"read"}))
    execution.execute(reader, "W", **dispatch)
    assert tools == [] and service.launch_view(reader, "W", request=original)["state"] == "ready"
    attach_authority(execution, principal, authority)
    execution.execute(reader, "W", **dispatch)
    execution.execute(reader, "W", **dispatch)
    assert tools == ["check"] and [part[0] for part in authority] == ["enter", "exit"]
    assert service.launch_view(reader, "W", request=original)["state"] == "claimed"
    assert service.dispatch_ready(reader, "W", request=original) is None


def test_launch_without_private_effect_receipt_cannot_be_dispatched_or_claimed(controlled, monkeypatch):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    effect = service.apply(principal, "W", request=original)
    dispatch = service.dispatch_ready(principal, "W", request=original)
    with store.transaction() as conn:
        conn.execute(delete(store.receipts).where(store.receipts.c.id == effect["receipt_id"]))
    with pytest.raises(CoreError, match="effect receipt"):
        service.dispatch_ready(principal, "W", request=original)
    attach_authority(execution, principal)
    monkeypatch.setattr(execution, "tool", lambda *_args: pytest.fail("Orphan ticket must never run"))
    execution.execute(principal, "W", **dispatch)
    assert store.get(principal, "W", "runs", effect["run_id"])["status"] == "queued"


def test_rejected_approval_run_transition_and_private_receipt_are_atomic(tmp_path, monkeypatch):
    store, execution, principal, original = build_controlled(tmp_path, monkeypatch, nodes=[Node(id="gate", kind="approval")])
    attach_authority(execution, principal)
    service = ManagedControls(store, execution)
    service.apply(principal, "W", request=original)
    execution.execute(principal, "W", **service.dispatch_ready(principal, "W", request=original))
    run = store.get(principal, "W", "runs", original["original"]["payload"]["run_id"])
    approval = store.list(principal, "W", "approvals")[0]
    reject = control_for(original, run, action="execution.approval", control_id="C-reject", version=2, approval=approval)
    reject["original"]["payload"]["decision"] = "reject"
    before = facts(store)
    mutate = store._mutate

    def fault(*args, **kwargs):
        if kwargs.get("operation") == "approval.rejected":
            raise RuntimeError("Fault between rejection and run failure")
        return mutate(*args, **kwargs)

    monkeypatch.setattr(store, "_mutate", fault)
    with pytest.raises(RuntimeError, match="between rejection"):
        service.apply(principal, "W", request=reject)
    assert facts(store) == before
    monkeypatch.setattr(store, "_mutate", mutate)
    rejected = service.apply(principal, "W", request=reject)
    assert rejected["run"]["status"] == "failed" and rejected["approval"]["status"] == "rejected"
    reader = replace(principal, permissions=frozenset({"read"}))
    assert service.apply(reader, "W", request=reject)["run_version"] == rejected["run_version"]


def test_same_attempt_second_approval_rotates_activation_and_rejects_old_resume(tmp_path, monkeypatch):
    nodes = [Node(id="first", kind="approval"), Node(id="between", argv=["echo", "between"]),
             Node(id="second", kind="approval"), Node(id="after", argv=["echo", "after"])]
    store, execution, principal, original = build_controlled(tmp_path, monkeypatch, nodes=nodes)
    tools = []
    monkeypatch.setattr(execution, "tool", lambda _p, _w, _r, node, _root, _owner: tools.append(node.id) or {"succeeded": True, "exit_code": 0})
    attach_authority(execution, principal)
    service = ManagedControls(store, execution)
    service.apply(principal, "W", request=original)
    execution.execute(principal, "W", **service.dispatch_ready(principal, "W", request=original))
    resumes = []
    for index in (1, 2):
        run = store.get(principal, "W", "runs", original["original"]["payload"]["run_id"])
        approval = next(row for row in store.list(principal, "W", "approvals") if row["status"] == "pending")
        approved = control_for(original, run, action="execution.approval", control_id=f"C-approve-{index}", version=index + 1, approval=approval)
        effect = service.apply(principal, "W", request=approved)
        launch = service.dispatch_ready(principal, "W", request=approved)
        assert effect["attempt"] == 1 and launch["resume"]["approval_id"] == approval["id"]
        if resumes:
            execution.execute(principal, "W", **resumes[0])
            assert store.get(principal, "W", "runs", run["id"])["status"] == "interrupted"
        resumes.append(launch)
        execution.execute(principal, "W", **launch)
    assert resumes[0]["launch_id"] != resumes[1]["launch_id"] and tools == ["between", "after"]
    assert store.get(principal, "W", "runs", run["id"])["status"] == "completed"


@pytest.mark.parametrize("terminal", ["completed", "failed", "cancelled"])
def test_terminal_cancel_records_actual_fact_without_inventing_stop(controlled, terminal):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    started = service.apply(principal, "W", request=original)
    cancel = control_for(original, started["run"], action="execution.cancel", control_id="C-cancel", version=2)
    run = store.mutate(principal, "W", "runs", started["run_id"], operation="test.terminal", key="terminal", request={}, trace="test", expected=None,
        transform=lambda item: {"status": terminal, "data": {**item["data"], "active_node": "check", "execution_owner": None,
            "stop_request": {"id": "old-stop", "state": "unknown", "owner": "previous-owner", "node_id": "check", "attempt": 1,
                "reason": "lease_expired", "requested_at": item["updated_at"], "confirmed_at": None, "evidence": None}}})
    result = service.apply(principal, "W", request=cancel)
    assert result["outcome"] == "run_terminal" and result["run"] == run
    assert store.get(principal, "W", "runs", run["id"]) == run
    assert result["run"]["data"]["stop_request"]["state"] == "unknown"
    assert service.apply(principal, "W", request=cancel)["run"] == run


def test_crash_after_claim_is_never_reexecuted_as_unclaimed_delivery(controlled, monkeypatch):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    service.apply(principal, "W", request=original)
    dispatch = service.dispatch_ready(principal, "W", request=original)
    attach_authority(execution, principal)
    called = []

    def crash(*_args):
        called.append("entered-tool")
        raise SystemExit("Simulated executor loss after committed owner")

    monkeypatch.setattr(execution, "tool", crash)
    with pytest.raises(SystemExit, match="executor loss"):
        execution.execute(principal, "W", **dispatch)
    assert service.launch_view(principal, "W", request=original)["state"] == "claimed"
    assert service.dispatch_ready(principal, "W", request=original) is None
    store.mutate(principal, "W", "runs", dispatch["run_id"], operation="test.expire", key="expire", request={}, trace="test", expected=None,
        transform=lambda item: {"data": {**item["data"], "lease_expires_at": 0}})
    execution.recover(principal, "W")
    execution.execute(principal, "W", **dispatch)
    run = store.get(principal, "W", "runs", dispatch["run_id"])
    assert run["status"] == "failed" and run["data"]["recovery_requires_review"] is True
    assert run["data"]["stop_request"]["state"] == "unknown" and called == ["entered-tool"]


@pytest.fixture
def remote_controlled(controlled):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hermes_core.api import create_router, install_errors

    store, execution, principal, original = controlled
    app = FastAPI()
    install_errors(app)
    app.include_router(create_router(store, execution, lambda: principal))
    client = TestClient(app, headers={"X-Workspace-Id": "W"})
    base = "/api/hermes/v1"

    def post(path, body, headers=None):
        response = client.post(base + path, json=body, headers=headers)
        assert response.status_code in {200, 201}, response.text
        return response.json()

    device = post("/devices", {"data": {"title": "Worker"}, "idempotency_key": "device"})["items"][0]
    invite = post(f"/devices/{device['id']}/pairing", {"expected_version": device["version"], "idempotency_key": "invite", "dry_run": False})["items"][0]
    paired = post("/devices/pair", {"device_id": device["id"], "secret": invite["pairing_secret"]})["items"][0]
    auth = {"Authorization": "Bearer " + paired["credential"], "X-Hermes-Device-Id": device["id"]}
    post(f"/devices/{device['id']}/runtime-policy", {"expected_version": paired["version"], "idempotency_key": "policy", "dry_run": False,
        "allowed_runtimes": ["command"], "allowed_providers": []})
    post("/remote/presence", {"idempotency_key": "presence", "worker_id": "worker-one", "worker_version": "test",
        "runtime_capabilities": ["command"], "providers": []}, auth)
    target = next(item for item in workspace_execution_targets(store, execution, principal, "W")["devices"] if item["id"] == device["id"])
    plan = ManagedHandoff(store, execution).dispatch(principal, "W", operation_id="H-remote", project_id="P", execution_id="E-remote", fence=1,
        envelope={"title": "Remote change", "description": "Two nodes", "acceptance_criteria": "Both checked",
                  "source": {"kind": "manager.delivery", "execution_id": "E-remote", "snapshot": {"task_id": "T"}}},
        body=TaskDispatch(expected_version=1, idempotency_key="E-remote", dry_run=False, target_device_id=device["id"], target_basis=target["basis"],
                          nodes=[Node(id="first", argv=["echo", "first"]), Node(id="second", argv=["echo", "second"])]), plan_basis="a" * 64)
    run = store.get(principal, "W", "runs", plan["run_id"])
    request = control_for(original, run, action="execution.start", control_id="C-remote", version=2)
    request.update(execution_id="E-remote", runtime_task_id=plan["runtime_task_id"])
    request["original"]["payload"]["id"] = "E-remote"
    yield store, execution, principal, request, post, client, auth
    client.close()


def claim_remote(post, auth, key):
    return post("/remote/claim", {"idempotency_key": key, "worker_version": "test", "worker_id": "worker-one", "runtime_capabilities": ["command"]}, auth)


def finish_remote(post, auth, assignment, key):
    return post("/remote/result", {"run_id": assignment["run_id"], "owner": assignment["owner"], "node_id": assignment["node"]["id"],
        "idempotency_key": key, "result": {"exit_code": 0, "stdout": "checked", "process_tree_stopped": True,
            "wait_completed": True, "output_eof": True, "backend": "posix_process_group"}}, auth)


def test_actual_remote_claim_requires_current_project_authority_and_continues_next_node(remote_controlled):
    store, execution, principal, request, post, _client, auth = remote_controlled
    service = ManagedControls(store, execution)
    service.apply(principal, "W", request=request)
    assert claim_remote(post, auth, "without-callback")["items"] == []
    attach_authority(execution, principal, allowed=False)
    assert claim_remote(post, auth, "revoked-project")["items"] == []
    authority = []
    attach_authority(execution, principal, authority)
    first = claim_remote(post, auth, "first")["items"][0]
    assert first["node"]["id"] == "first" and service.launch_view(principal, "W", request=request)["state"] == "claimed"
    assert claim_remote(post, auth, "first-replay")["items"][0]["owner"] == first["owner"]
    finish_remote(post, auth, first, "first-result")
    second = claim_remote(post, auth, "second")["items"][0]
    assert second["node"]["id"] == "second" and second["owner"] != first["owner"]
    finish_remote(post, auth, second, "second-result")
    assert store.get(principal, "W", "runs", first["run_id"])["status"] == "completed"
    assert claim_remote(post, auth, "after-complete")["items"] == []
    assert [part[0] for part in authority] == ["enter", "exit", "enter", "exit"]
    with store.engine.connect() as conn:
        ticket = conn.execute(select(store.managed_launches).where(store.managed_launches.c.control_id == request["control_id"])).mappings().one()
    assert [claim["node_id"] for claim in ticket["claims"]] == ["first", "second"]


def test_remote_next_node_is_blocked_when_project_authority_changes(remote_controlled):
    store, execution, principal, request, post, _client, auth = remote_controlled
    service = ManagedControls(store, execution)
    service.apply(principal, "W", request=request)
    attach_authority(execution, principal)
    first = claim_remote(post, auth, "first")["items"][0]
    finish_remote(post, auth, first, "first-result")
    attach_authority(execution, principal, allowed=False)
    assert claim_remote(post, auth, "revoked-next-node")["items"] == []
    run = store.get(principal, "W", "runs", first["run_id"])
    assert run["status"] == "queued" and run["data"].get("execution_owner") is None
    assert "second" not in run["data"]["node_results"]


def test_public_resource_routes_cannot_forge_managed_activation(controlled):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hermes_core.api import create_router, install_errors

    store, execution, principal, request = controlled
    app = FastAPI()
    install_errors(app)
    app.include_router(create_router(store, execution, lambda: principal))
    with TestClient(app, headers={"X-Workspace-Id": "W"}) as client:
        created = client.post("/api/hermes/v1/runs", json={"idempotency_key": "forged", "data": {
            "nodes": [{"id": "node", "argv": ["echo", "no"]}], "managed_activation_id": "forged-ticket"}})
        assert created.status_code == 422 and created.json()["error"]["code"] == "server_owned_fields"
        patched = client.patch("/api/hermes/v1/runs/" + request["original"]["payload"]["run_id"], json={
            "expected_version": 1, "idempotency_key": "forged-patch", "data": {"managed_activation_id": "forged-ticket"}})
        assert patched.status_code == 422 and patched.json()["error"]["code"] == "server_owned_fields"


@pytest.mark.parametrize("name", ["tenant", "business", "workspace"])
def test_control_identity_is_global_across_scope_namespaces(controlled, name):
    store, execution, principal, original = controlled
    service = ManagedControls(store, execution)
    service.close(principal, "W", request=original)
    changed = deepcopy(original)
    changed[name] = "other"
    scoped = replace(principal, **{name: "other"}) if name != "workspace" else principal
    with pytest.raises(CoreError) as caught:
        service.probe(scoped, "other" if name == "workspace" else "W", request=changed)
    assert caught.value.code == "control_conflict"


def test_present_probe_does_not_lock_write_or_require_execution_authority(controlled):
    store, execution, principal, request = controlled
    service = ManagedControls(store, execution)
    effect = service.apply(principal, "W", request=request)
    before = facts(store)
    statements = []

    def capture(_conn, _cursor, statement, *_rest):
        statements.append(statement)

    event.listen(store.engine, "before_cursor_execute", capture)
    try:
        result = service.probe(replace(principal, permissions=frozenset({"read"}), workspace_ids=frozenset()), "W", request=request)
    finally:
        event.remove(store.engine, "before_cursor_execute", capture)
    assert result["receipt_id"] == effect["receipt_id"]
    assert statements and all(s.lstrip().upper().startswith("SELECT") and "FOR UPDATE" not in s.upper() for s in statements)
    assert facts(store) == before


def test_complete_utf8_budget_and_embedded_handoff_budget_are_independent(controlled):
    store, execution, principal, original = controlled
    large = deepcopy(original)
    large["original"]["payload"]["reason"] = "界" * 1_500_000
    with pytest.raises(CoreError) as caught:
        managed_control_digest(principal, "W", request=large)
    assert caught.value.code == "payload_too_large"
    handoff = pending_handoff(original, execution, store, principal)
    handoff["handoff_request"]["body"]["nodes"][0]["argv"] = ["echo", "界" * 360_000]
    with pytest.raises(CoreError) as embedded:
        managed_control_digest(principal, "W", request=handoff)
    assert embedded.value.code == "payload_too_large"


def test_close_and_preemption_reject_recursive_or_widened_targets(controlled):
    store, execution, principal, original = controlled
    run = store.get(principal, "W", "runs", original["original"]["payload"]["run_id"])
    cancel = control_for(original, run, action="execution.cancel", control_id="C-cancel", version=2)
    cancel["prior_requests"] = [deepcopy(original)]
    valid = close_for(cancel, version=3)
    assert len(managed_control_digest(principal, "W", request=valid)) == 64
    recursive = close_for(valid, control_id="recursive-close", version=4)
    with pytest.raises(CoreError):
        managed_control_digest(principal, "W", request=recursive)
    widened = deepcopy(valid)
    widened["target_request"]["prior_requests"][0]["execution_id"] = "other"
    widened["target_request"]["prior_requests"][0]["original"]["payload"]["id"] = "other"
    widened["original"]["payload"]["request_digest"] = digest(widened["target_request"])
    with pytest.raises(CoreError):
        managed_control_digest(principal, "W", request=widened)
