"""Real Store/Delivery handoff regressions; execution is deferred by the user."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import replace
from threading import Barrier

import pytest
from sqlalchemy import event, func, select

from hermes_core.agents import AgentDispatch, Agents, validate_bound_profiles
from hermes_core.delivery import Delivery
from hermes_core.execution import Execution
from hermes_core.execution_targets import workspace_execution_targets
from hermes_core.managed_handoff import ManagedHandoff, managed_handoff_digest
from hermes_core.models import CoreError, Node, Principal, TaskDispatch
from hermes_core.repository import Repository
from hermes_core.transactional import Store


@pytest.fixture
def setup(tmp_path, monkeypatch):
    url = "sqlite:///" + (tmp_path / "core.sqlite").as_posix()
    store = Store(url)
    actor = Principal("requester", tenant="tenant", business="business")
    workspace = store.create(actor, "", "workspaces", {"name": "Workspace", "root": str(tmp_path)},
                             "workspace", "setup", entity_id="W")
    execution = Execution(store, tmp_path)
    execution.agentd = "/unused/sop-agentd"
    monkeypatch.setattr(execution, "available", lambda: True)

    def no_process(*_args, **_kwargs):
        pytest.fail("Creating a managed plan must never start tools or execution")

    monkeypatch.setattr(execution, "execute", no_process)
    monkeypatch.setattr(execution, "tool", no_process)
    monkeypatch.setattr("hermes_core.agents.shutil.which", lambda provider: "/unused/" + provider)
    target = workspace_execution_targets(store, execution, actor, workspace["id"])["local"]
    request = {
        "operation_id": "H", "project_id": "P", "execution_id": "E", "fence": 1,
        "envelope": {"title": "Ship a change", "description": "Implementation",
                     "acceptance_criteria": "Output checked",
                     "source": {"kind": "manager.delivery", "execution_id": "E", "snapshot": {"task_id": "T"}}},
        "body": TaskDispatch(expected_version=1, idempotency_key="E", dry_run=False,
                             nodes=[Node(id="check", argv=["echo", "checked"])], target_basis=target["basis"]),
        "plan_basis": "a" * 64,
    }
    return store, execution, actor, request, url


def facts(store):
    with store.engine.connect() as conn:
        return {name: conn.scalar(select(func.count()).select_from(table)) for name, table in
                (("entities", store.entities), ("events", store.events), ("receipts", store.receipts),
                 ("gates", store.managed_handoffs))}


def probe(service, actor, request):
    return service.probe(actor, "W", **{key: value for key, value in request.items() if key != "fence"})


def test_one_commit_contains_envelope_planned_run_and_all_receipts_without_starting(setup):
    store, execution, actor, request, _ = setup
    before = facts(store)
    result = ManagedHandoff(store, execution).dispatch(actor, "W", **request)
    assert result["state"] == "planned" and result["closed"] is False
    assert result["run_version"] == 1 and result["fence"] == 1 and result["replayed"] is False
    assert store.get(actor, "W", "runs", result["run_id"])["status"] == "planned"
    task = store.get(actor, "W", "tasks", result["runtime_task_id"])
    assert task["data"]["source"]["execution_id"] == "E"
    assert task["data"]["delivery"]["run_id"] == result["run_id"]
    assert facts(store) == {"entities": before["entities"] + 2, "events": before["events"] + 2 + 1,
                            "receipts": before["receipts"] + 3, "gates": 1}
    with store.engine.connect() as conn:
        receipts = {row.id: row.result for row in conn.execute(select(store.receipts))}
    assert receipts[result["envelope_receipt_id"]]["id"] == task["id"]
    assert receipts[result["dispatch_receipt_id"]]["run"]["id"] == result["run_id"]
    assert receipts[result["plan_receipt_id"]]["run_id"] == result["run_id"]


def test_restart_recovers_committed_plan_without_current_execute_or_further_writes(setup):
    store, execution, actor, request, url = setup
    first = ManagedHandoff(store, execution).dispatch(actor, "W", **request)
    reopened = Store(url)
    recovered = ManagedHandoff(reopened, Execution(reopened, execution.data_dir))
    reader = replace(actor, permissions=frozenset({"read"}), workspace_ids=frozenset())
    before = facts(reopened)
    result = probe(recovered, reader, request)
    assert result["run_id"] == first["run_id"] and result["replayed"] is True
    assert facts(reopened) == before
    assert recovered.dispatch(reader, "W", **request)["run_id"] == first["run_id"]
    assert facts(reopened) == before


def test_missing_probe_is_pure_read_and_does_not_reserve_operation(setup):
    store, execution, actor, request, _ = setup
    service = ManagedHandoff(store, execution)
    before = facts(store)
    statements = []

    def observe(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(store.engine, "before_cursor_execute", observe)
    try:
        assert probe(service, actor, request) is None
    finally:
        event.remove(store.engine, "before_cursor_execute", observe)
    assert statements and all(statement.lstrip().upper().startswith("SELECT")
                              and "FOR UPDATE" not in statement.upper() for statement in statements)
    assert facts(store) == before
    assert service.dispatch(actor, "W", **request)["state"] == "planned"


@pytest.mark.parametrize("field,value", [("project_id", "other-project"), ("execution_id", "other-execution"),
                                        ("plan_basis", "b" * 64), ("envelope", "changed"), ("body", "changed")])
def test_same_operation_cannot_be_rebound_to_another_full_request(setup, field, value):
    store, execution, actor, request, _ = setup
    service = ManagedHandoff(store, execution)
    service.close(actor, "W", **request)
    changed = deepcopy(request)
    if field == "envelope":
        changed[field]["description"] = value
    elif field == "body":
        changed[field] = changed[field].model_copy(update={"nodes": [Node(id="other", argv=["echo", "different"])]})
    elif field == "execution_id":
        changed[field] = value
        changed["envelope"]["source"]["execution_id"] = value
        changed["body"] = changed["body"].model_copy(update={"idempotency_key": value})
    else:
        changed[field] = value
    before = facts(store)
    with pytest.raises(CoreError) as error:
        service.dispatch(actor, "W", **changed)
    assert error.value.code == "handoff_conflict"
    assert facts(store) == before


@pytest.mark.parametrize("identity", ["actor", "tenant", "business", "workspace"])
def test_global_operation_identity_conflicts_instead_of_opening_another_namespace(setup, identity):
    store, execution, actor, request, _ = setup
    service = ManagedHandoff(store, execution)
    service.close(actor, "W", **request)
    principal = replace(actor, **{identity: "other"}) if identity != "workspace" else actor
    before = facts(store)
    with pytest.raises(CoreError) as error:
        service.dispatch(principal, "other" if identity == "workspace" else "W", **request)
    assert error.value.code == "handoff_conflict"
    assert facts(store) == before


def test_same_execution_cannot_obtain_a_second_gate_with_a_new_operation_key(setup):
    store, execution, actor, request, _ = setup
    service = ManagedHandoff(store, execution)
    first = service.close(actor, "W", **request)
    with pytest.raises(CoreError) as error:
        service.dispatch(actor, "W", **{**request, "operation_id": "new-H"})
    assert error.value.code == "handoff_conflict"
    assert first["run_id"] is None and store.list(actor, "W", "runs") == []


def test_close_first_is_irreversible_even_for_late_or_higher_fence_dispatch(setup):
    store, execution, actor, request, _ = setup
    service = ManagedHandoff(store, execution)
    closed = service.close(replace(actor, permissions=frozenset()), "W", **{**request, "fence": 3})
    assert closed["state"] == "closed" and closed["closed"] is True
    assert closed["run_id"] is None and closed["runtime_task_id"] is None and closed["run_version"] == 0
    assert closed["close_receipt_id"] and closed["plan_receipt_id"] is None
    before = facts(store)
    for fence in (1, 3, 8):
        result = service.dispatch(actor, "W", **{**request, "fence": fence})
        assert result["state"] == "closed" and result["run_id"] is None
    assert facts(store) == before


def test_close_after_plan_returns_actual_run_and_does_not_claim_no_run_or_cancel_it(setup):
    store, execution, actor, request, _ = setup
    service = ManagedHandoff(store, execution)
    planned = service.dispatch(actor, "W", **request)
    closed = service.close(replace(actor, permissions=frozenset()), "W", **{**request, "fence": 2})
    assert closed["state"] == "planned" and closed["closed"] is True
    assert closed["run_id"] == planned["run_id"] and closed["runtime_task_id"] == planned["runtime_task_id"]
    assert closed["plan_receipt_id"] == planned["plan_receipt_id"] and closed["close_receipt_id"]
    assert store.get(actor, "W", "runs", closed["run_id"])["status"] == "planned"
    assert service.dispatch(actor, "W", **{**request, "fence": 9})["run_id"] == planned["run_id"]
    assert len(store.list(actor, "W", "runs")) == 1


def test_fence_advances_without_changing_original_hash_or_creating_another_run(setup):
    store, execution, actor, request, _ = setup
    service = ManagedHandoff(store, execution)
    first = service.dispatch(actor, "W", **{**request, "fence": 2})
    later = service.dispatch(actor, "W", **{**request, "fence": 4})
    assert later["run_id"] == first["run_id"] and later["request_hash"] == first["request_hash"]
    assert later["fence"] == 4 and later["plan_receipt_id"] == first["plan_receipt_id"]
    with pytest.raises(CoreError) as error:
        service.close(actor, "W", **{**request, "fence": 3})
    assert error.value.code == "stale_handoff_fence"
    assert probe(service, actor, request)["closed"] is False


@pytest.mark.parametrize("fence", [0, -1, True, 1.5, "1", 2**63])
def test_invalid_fence_never_reserves_gate_or_creates_envelope(setup, fence):
    store, execution, actor, request, _ = setup
    before = facts(store)
    with pytest.raises(CoreError) as error:
        ManagedHandoff(store, execution).dispatch(actor, "W", **{**request, "fence": fence})
    assert error.value.status == 422
    assert facts(store) == before


@pytest.mark.parametrize("permissions,workspaces", [(frozenset({"read", "write"}), None),
                                                   (frozenset({"read", "execute"}), None),
                                                   (frozenset({"read", "write", "execute"}), frozenset())])
def test_new_plan_requires_current_execute_write_and_workspace_access(setup, permissions, workspaces):
    store, execution, actor, request, _ = setup
    before = facts(store)
    with pytest.raises(CoreError) as error:
        ManagedHandoff(store, execution).dispatch(replace(actor, permissions=permissions, workspace_ids=workspaces), "W", **request)
    assert error.value.status == 403
    assert facts(store) == before


def test_archived_workspace_rejects_new_plan_but_still_allows_exact_close(setup):
    store, execution, actor, request, _ = setup
    store.mutate(actor, "", "workspaces", "W", operation="archive", key="archive", request={}, trace="archive",
                 expected=1, transform=lambda _item: {"status": "archived"})
    before = facts(store)
    with pytest.raises(CoreError) as error:
        ManagedHandoff(store, execution).dispatch(actor, "W", **request)
    assert error.value.code == "workspace_inactive"
    assert facts(store) == before
    assert ManagedHandoff(store, execution).close(actor, "W", **request)["state"] == "closed"


@pytest.mark.parametrize("failure_point", ["envelope", "dispatch_receipt", "handoff_receipt"])
def test_failure_rolls_back_gate_envelope_run_events_and_receipts_together(setup, monkeypatch, failure_point):
    store, execution, actor, request, _ = setup
    service = ManagedHandoff(store, execution)
    before = facts(store)
    if failure_point == "envelope":
        original = store._create

        def fail(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError("lost after envelope")

        monkeypatch.setattr(store, "_create", fail)
    elif failure_point == "dispatch_receipt":
        original = Delivery._save_receipt

        def fail(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError("lost after dispatch")

        monkeypatch.setattr(Delivery, "_save_receipt", fail)
    else:
        original = service._save_receipt

        def fail(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError("lost after handoff receipt")

        monkeypatch.setattr(service, "_save_receipt", fail)
    with pytest.raises(RuntimeError):
        service.dispatch(actor, "W", **request)
    assert facts(store) == before


def test_two_store_workers_racing_dispatch_and_close_cannot_create_after_negative_close(setup):
    store, execution, actor, request, url = setup
    other_store = Store(url)
    other = ManagedHandoff(other_store, Execution(other_store, execution.data_dir))
    first = ManagedHandoff(store, execution)
    barrier = Barrier(2)

    def invoke(service, action):
        barrier.wait(timeout=5)
        return getattr(service, action)(actor, "W", **request)

    with ThreadPoolExecutor(max_workers=2) as pool:
        dispatch = pool.submit(invoke, first, "dispatch")
        close = pool.submit(invoke, other, "close")
        dispatched, closed = dispatch.result(timeout=30), close.result(timeout=30)
    final = probe(first, actor, request)
    assert final["closed"] is True
    if closed["state"] == "closed":
        assert dispatched["state"] == "closed" and store.list(actor, "W", "runs") == []
    else:
        assert final["run_id"] == dispatched["run_id"] == closed["run_id"]
        assert len(store.list(actor, "W", "runs")) == 1


def test_two_store_workers_replaying_one_handoff_commit_only_one_run(setup, monkeypatch):
    store, execution, actor, request, url = setup
    second_store = Store(url)
    second_execution = Execution(second_store, execution.data_dir)
    second_execution.agentd = execution.agentd
    second_execution.allowed_roots = execution.allowed_roots
    second_execution.allow_commands = execution.allow_commands
    monkeypatch.setattr(second_execution, "available", lambda: True)
    services = [ManagedHandoff(store, execution), ManagedHandoff(second_store, second_execution)]
    barrier = Barrier(2)

    def dispatch(service):
        barrier.wait(timeout=5)
        return service.dispatch(actor, "W", **request)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(dispatch, services))
    assert results[0]["run_id"] == results[1]["run_id"]
    assert sorted(item["replayed"] for item in results) == [False, True]
    assert len(store.list(actor, "W", "runs")) == 1


@pytest.mark.parametrize("already_planned", [False, True])
def test_failed_close_receipt_rolls_back_the_negative_conclusion(setup, monkeypatch, already_planned):
    store, execution, actor, request, _ = setup
    service = ManagedHandoff(store, execution)
    planned = service.dispatch(actor, "W", **request) if already_planned else None
    before = facts(store)
    original = service._save_receipt

    def fail(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("lost before close commit")

    monkeypatch.setattr(service, "_save_receipt", fail)
    with pytest.raises(RuntimeError):
        service.close(actor, "W", **request)
    assert facts(store) == before
    recovered = probe(service, actor, request)
    if already_planned:
        assert recovered["run_id"] == planned["run_id"] and recovered["closed"] is False
    else:
        assert recovered is None


def test_pre_protocol_receipt_cannot_be_misreported_as_verified_no_run(setup):
    store, execution, actor, request, _ = setup
    store.create(actor, "W", "tasks", request["envelope"], "E", "old-protocol")
    before = facts(store)
    with pytest.raises(CoreError) as error:
        ManagedHandoff(store, execution).close(actor, "W", **request)
    assert error.value.code == "handoff_conflict"
    assert facts(store) == before


def test_target_configuration_change_rolls_back_all_new_plan_artifacts(setup):
    store, execution, actor, request, _ = setup
    store.mutate(actor, "", "workspaces", "W", operation="edit", key="edit", request={}, trace="edit",
                 expected=1, transform=lambda item: {"data": {**item["data"], "name": "New configuration"}})
    before = facts(store)
    with pytest.raises(CoreError) as error:
        ManagedHandoff(store, execution).dispatch(actor, "W", **request)
    assert error.value.code == "target_basis_changed"
    assert facts(store) == before
    assert ManagedHandoff(store, execution).close(actor, "W", **request)["state"] == "closed"


@pytest.mark.parametrize("part", ["description", "snapshot", "dispatch"])
def test_complete_request_utf8_budget_rejects_oversized_original_without_reserving_gate(setup, part):
    store, execution, actor, request, _ = setup
    if part == "description":
        request["envelope"]["description"] = "x" * 1_048_576
    elif part == "snapshot":
        request["envelope"]["source"]["snapshot"]["description"] = "汉" * 400_000
    else:
        request["body"] = request["body"].model_copy(update={"nodes": [Node(id="huge", argv=["echo", "x" * 1_048_576])]})
    before = facts(store)
    args = {key: value for key, value in request.items() if key != "fence"}
    with pytest.raises(CoreError) as error:
        managed_handoff_digest(actor, "W", **args)
    assert error.value.code == "payload_too_large" and error.value.status == 422
    with pytest.raises(CoreError) as error:
        ManagedHandoff(store, execution).close(actor, "W", **request)
    assert error.value.code == "payload_too_large"
    assert facts(store) == before


def test_bounded_unicode_original_is_preserved_instead_of_truncated(setup):
    store, execution, actor, request, _ = setup
    request["envelope"]["source"]["snapshot"]["description"] = "汉" * 150_000
    service = ManagedHandoff(store, execution)
    result = service.close(actor, "W", **request)
    assert result["state"] == "closed"
    assert probe(service, actor, request)["request_hash"] == result["request_hash"]
    with store.engine.connect() as conn:
        row = conn.execute(select(store.managed_handoffs)).mappings().one()
    assert row["request"]["envelope"]["source"]["snapshot"]["description"] == "汉" * 150_000


def test_agent_handoff_uses_real_version_pinned_plan_and_standard_agent_receipt(setup):
    store, execution, actor, request, _ = setup
    agent = store.create(actor, "W", "agents", {"title": "Coder", "provider": "codex", "model": "",
                                               "instructions": "", "timeout_seconds": 300, "status": "active"},
                         "agent", "setup")
    request["body"] = AgentDispatch(expected_version=1, idempotency_key="E", dry_run=False,
                                     agent_id=agent["id"], target_version=1,
                                     test_nodes=[Node(id="verify", argv=["echo", "checked"])],
                                     target_basis=request["body"].target_basis)
    result = ManagedHandoff(store, execution).dispatch(actor, "W", **request)
    run = store.get(actor, "W", "runs", result["run_id"])
    assert run["data"]["agent_bindings"]["agent_1"]["agent_id"] == agent["id"]
    assert run["data"]["agent_bindings"]["agent_1"]["version"] == 1
    assert [node["id"] for node in run["data"]["nodes"]] == ["agent_1", "verify"]
    cached = store.receipt(actor, "W", "task.agent-dispatch:" + result["runtime_task_id"], "E", request["body"].model_dump())
    assert cached["run"]["id"] == result["run_id"]


def test_archived_agent_fails_without_leaving_controlled_envelope(setup):
    store, execution, actor, request, _ = setup
    agent = store.create(actor, "W", "agents", {"title": "Coder", "provider": "codex", "model": "",
                                               "instructions": "", "timeout_seconds": 300, "status": "archived"},
                         "agent", "setup", status="archived")
    request["body"] = AgentDispatch(expected_version=1, idempotency_key="E", dry_run=False,
                                     agent_id=agent["id"], target_version=1, target_basis=request["body"].target_basis)
    before = facts(store)
    with pytest.raises(CoreError) as error:
        ManagedHandoff(store, execution).dispatch(actor, "W", **request)
    assert error.value.code == "configuration_changed"
    assert facts(store) == before


def test_full_request_hash_binds_payload_and_scope_while_excluding_permissions_and_fence(setup):
    _, _, actor, request, _ = setup
    args = {key: value for key, value in request.items() if key != "fence"}
    first = managed_handoff_digest(actor, "W", **args)
    assert managed_handoff_digest(replace(actor, permissions=frozenset()), "W", **args) == first
    for changed in ({**args, "plan_basis": "b" * 64},
                    {**args, "envelope": {**args["envelope"], "description": "Different"}},
                    {**args, "project_id": "other"}):
        assert managed_handoff_digest(actor, "W", **changed) != first


@pytest.mark.parametrize("body_change", [{"dry_run": True}, {"expected_version": 2},
                                         {"idempotency_key": "other"},
                                         {"isolation": "git_worktree", "base_commit": "a" * 40}])
def test_noncanonical_body_is_rejected_before_any_gate_or_tool_effect(setup, body_change):
    store, execution, actor, request, _ = setup
    request["body"] = request["body"].model_copy(update=body_change)
    before = facts(store)
    with pytest.raises(CoreError) as error:
        ManagedHandoff(store, execution).dispatch(actor, "W", **request)
    assert error.value.status == 422
    assert facts(store) == before


def test_standalone_command_and_agent_wrappers_keep_preview_and_replay_semantics(setup):
    store, execution, actor, request, _ = setup
    delivery = Delivery(store, Repository(execution))
    for agent_mode in (False, True):
        task = store.create(actor, "W", "tasks", {"title": "Standalone", "acceptance_criteria": "Checked"},
                            "standalone-" + str(agent_mode), "setup")
        if agent_mode:
            agent = store.create(actor, "W", "agents", {"title": "Coder", "provider": "codex", "model": "",
                                                        "instructions": "", "timeout_seconds": 300, "status": "active"},
                                 "standalone-agent", "setup")
            body = AgentDispatch(expected_version=1, idempotency_key="standalone", dry_run=False,
                                 agent_id=agent["id"], target_version=1)
            call = lambda value: Agents(store).dispatch(actor, "W", task["id"], value, "trace", delivery)
        else:
            body = request["body"].model_copy(update={"idempotency_key": "standalone", "target_basis": ""})
            call = lambda value: delivery.dispatch(actor, "W", task["id"], value, "trace")
        before = facts(store)
        assert call(body.model_copy(update={"dry_run": True}))["dry_run"] is True
        assert facts(store) == before
        result = call(body)
        assert result["run"]["status"] == "planned"
        assert call(body) == result


def profile(store, actor, identity):
    return store.create(actor, "W", "agents", {"title": identity, "provider": "codex", "model": "",
                         "instructions": "", "timeout_seconds": 300, "status": "active"},
                        "profile-" + identity, "setup", entity_id=identity)


def squad(store, actor):
    return store.create(actor, "W", "squads", {"title": "Reverse role order", "status": "active", "members": [
        {"agent_id": "B", "role": "leader", "instructions": "Lead", "agent_version": 1},
        {"agent_id": "A", "role": "implementer", "instructions": "Implement", "agent_version": 1},
    ]}, "squad", "setup", entity_id="S")


@pytest.mark.parametrize("target", ["agent", "squad"])
def test_real_agent_dispatch_locks_workspace_then_task_before_profiles_and_keeps_role_plan(setup, monkeypatch, target):
    store, execution, actor, _, _ = setup
    profile(store, actor, "A"); profile(store, actor, "B")
    squad(store, actor)
    task = store.create(actor, "W", "tasks", {"title": "Dispatch", "acceptance_criteria": "Checked"},
                        "lock-task", "setup", entity_id="T")
    reads = []
    actual_get = store._get

    def record(conn, principal, workspace, kind, identity):
        reads.append((kind, identity))
        return actual_get(conn, principal, workspace, kind, identity)

    monkeypatch.setattr(store, "_get", record)
    body = AgentDispatch(expected_version=1, idempotency_key="lock-order", dry_run=False, target_version=1,
                         **({"agent_id": "A"} if target == "agent" else {"squad_id": "S"}))
    result = Agents(store).dispatch(actor, "W", task["id"], body, "trace", Delivery(store, Repository(execution)))
    assert reads[:2] == [("workspaces", "W"), ("tasks", "T")]
    agent_reads = list(dict.fromkeys(identity for kind, identity in reads if kind == "agents"))
    assert agent_reads == (["A"] if target == "agent" else ["A", "B"])
    assert [node["agent_id"] for node in result["run"]["data"]["nodes"]] == (["A"] if target == "agent" else ["B", "A"])
    assert result["run"]["status"] == "planned"


def test_bindings_and_runtime_profile_validation_lock_profiles_in_id_order_without_reordering_nodes(setup, monkeypatch):
    store, _, actor, _, _ = setup
    profile(store, actor, "A"); profile(store, actor, "B")
    nodes = [Node(id="first", kind="agent", agent_id="B", prompt="First role"),
             Node(id="second", kind="agent", agent_id="A", prompt="Second role"),
             Node(id="third", kind="agent", agent_id="B", prompt="Third role")]
    reads = []
    actual_get = store._get

    def record(conn, principal, workspace, kind, identity):
        if kind == "agents":
            reads.append(identity)
        return actual_get(conn, principal, workspace, kind, identity)

    monkeypatch.setattr(store, "_get", record)
    with store.transaction() as conn:
        bindings = Agents(store).bindings(conn, actor, "W", nodes)
    assert list(dict.fromkeys(reads)) == ["A", "B"]
    assert list(bindings) == ["first", "second", "third"]
    assert [entry["agent_id"] for entry in bindings.values()] == ["B", "A", "B"]
    reads.clear()
    with store.transaction() as conn:
        validate_bound_profiles(store, conn, actor, "W", bindings)
    assert list(dict.fromkeys(reads)) == ["A", "B"]


def test_command_dispatch_uses_the_same_workspace_then_task_lock_order(setup, monkeypatch):
    store, execution, actor, request, _ = setup
    task = store.create(actor, "W", "tasks", {"title": "Command task", "acceptance_criteria": "Checked"},
                        "command-lock", "setup", entity_id="T")
    actual_get = store._get
    reads = []

    def record(conn, principal, workspace, kind, identity):
        reads.append((kind, identity))
        return actual_get(conn, principal, workspace, kind, identity)

    monkeypatch.setattr(store, "_get", record)
    body = request["body"].model_copy(update={"idempotency_key": "command-lock"})
    result = Delivery(store, Repository(execution)).dispatch(actor, "W", task["id"], body, "trace")
    assert reads[:2] == [("workspaces", "W"), ("tasks", "T")]
    assert result["run"]["status"] == "planned"


def test_single_agent_and_squad_competing_for_same_task_cannot_both_create_plans(setup):
    store, execution, actor, _, url = setup
    profile(store, actor, "A"); profile(store, actor, "B")
    squad(store, actor)
    task = store.create(actor, "W", "tasks", {"title": "One task", "acceptance_criteria": "Checked"},
                        "competing-task", "setup")
    other = Store(url)
    barrier = Barrier(2)
    bodies = [AgentDispatch(expected_version=1, idempotency_key="single", dry_run=False, target_version=1, agent_id="A"),
              AgentDispatch(expected_version=1, idempotency_key="squad", dry_run=False, target_version=1, squad_id="S")]

    def dispatch(pair):
        current_store, body = pair
        barrier.wait(timeout=5)
        try:
            result = Agents(current_store).dispatch(actor, "W", task["id"], body, "trace",
                                                    Delivery(current_store, Repository(execution)))
            return result["run"]["status"]
        except CoreError as failure:
            return failure.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(dispatch, [(store, bodies[0]), (other, bodies[1])]))
    assert sorted(result) == ["planned", "version_conflict"]
    assert len(store.list(actor, "W", "runs")) == 1
