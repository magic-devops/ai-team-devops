from contextlib import contextmanager

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import graph_loop


@contextmanager
def scoped_project(root, *, tenant="tenant-a", business="biz-a", project="project-a"):
    tokens = set_request_scope(
        tenant_id=tenant,
        project_id=project,
        project_path=root,
        tenant_code=tenant,
        business_code=business,
        project_code=project,
    )
    try:
        yield
    finally:
        reset_request_scope(tokens)


def test_graph_loop_store_deduplicates_bad_lines_and_scope(tmp_path):
    store = graph_loop.GraphLoopStore(tmp_path / "graph_loop_runs.jsonl")
    store.path.write_text("{bad-json\n", encoding="utf-8")

    with scoped_project(tmp_path, project="project-a"):
        run = graph_loop._new_run(graph_loop.GraphLoopPlanIn(goal="TDD graph loop", mode="apply"))
        run["events"].append({"event": "seed", "idempotency_key": "idem-1"})
        first = store.append_snapshot(run, idempotency_key="idem-1")
        second = store.append_snapshot({**run, "status": "failed"}, idempotency_key="idem-1")
        listed = store.list_runs()
        diagnostics = store.diagnostics()

    with scoped_project(tmp_path, project="project-b"):
        isolated = store.list_runs()

    assert first["run_id"] == second["run_id"]
    assert listed[0]["status"] == "running"
    assert diagnostics["bad_lines"] == 1
    assert diagnostics["schema"]["store"] == "scoped-jsonl"
    assert isolated == []


def test_graph_loop_transition_interrupt_replay_and_export(tmp_path):
    with scoped_project(tmp_path):
        created = graph_loop.graph_loop_run(graph_loop.GraphLoopPlanIn(goal="release loop", mode="apply"))
        run_id = created["summary"]["run_id"]

        interrupted = graph_loop.graph_loop_run_transition(
            run_id,
            graph_loop.GraphLoopTransitionIn(action="interrupt", node_id="requirement_intake", actor="Reviewer", idempotency_key="interrupt-1"),
        )
        interrupt_id = interrupted["run"]["interrupts"][0]["id"]

        decided = graph_loop.graph_loop_interrupt_decision(
            run_id,
            interrupt_id,
            graph_loop.GraphLoopInterruptDecisionIn(decision="approve", actor="Reviewer", idempotency_key="approve-1"),
        )
        replay = graph_loop.graph_loop_replay(run_id, graph_loop.GraphLoopReplayIn(mode="dry-run"))
        exported = graph_loop.graph_loop_export(run_id, graph_loop.GraphLoopExportIn())
        events = graph_loop.graph_loop_run_events(run_id)
        slo = graph_loop.graph_loop_run_slo(run_id)

    assert interrupted["run"]["status"] == "interrupted"
    assert decided["run"]["status"] == "running"
    assert replay["summary"]["events"] >= 3
    assert exported["export"]["kind"] == "graph_loop_audit_package"
    assert events["summary"]["events"] >= 3
    assert slo["summary"]["status"] in {"healthy", "watch", "risk"}
