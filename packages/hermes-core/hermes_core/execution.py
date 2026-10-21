from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import time
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from .agents import AgentProfile, provider_command, provider_evidence, squad_route, validate_bound_profiles
from .execution_targets import validate_execution_target_snapshot
from .models import CoreError, Node, Principal
from .repository import Repository
from .run_controls import stop_request_data
from .transactional import Store, digest


class RunState(TypedDict, total=False):
    results: dict


def _validate_handoff_attempt(item, expected_attempt):
    if expected_attempt is not None and item["data"].get("attempt", 1) != expected_attempt:
        raise CoreError("stale_attempt", "Execution handoff belongs to a previous attempt", 409)


class Execution:
    lease_seconds = 120

    def __init__(self, store: Store, data_dir: Path, agentd: str = ""):
        self.store, self.data_dir = store, data_dir
        self.agentd = agentd or os.environ.get("HERMES_AGENTD") or shutil.which("sop-agentd") or ""
        self.allowed_roots: tuple[Path, ...] | None = None
        self.allow_commands = True

    def available(self):
        return bool(self.allow_commands and self.agentd and Path(self.agentd).is_file() and os.access(self.agentd, os.X_OK))

    def validate_root(self, root: Path):
        if self.allowed_roots is not None and not any(root == allowed or root.is_relative_to(allowed) for allowed in self.allowed_roots):
            raise CoreError("root_forbidden", "Workspace directory is not registered for execution on this host", 403)

    def patch(self, principal, workspace, run_id, action, change, owner=None, audit_data=None):
        def guarded(item):
            if owner is not None and (item["data"].get("execution_owner") != owner or item["status"] != "running"):
                raise CoreError("lease_lost", "Execution ownership changed", 409)
            return change(item)
        return self.store.mutate(principal, workspace, "runs", run_id, operation=action,
            key=uuid.uuid4().hex, request={}, trace=uuid.uuid4().hex, expected=None, transform=guarded, audit_data=audit_data)

    def recover(self, principal, workspace):
        cursor = ""
        while True:
            rows = self.store.list(principal, workspace, "runs", status="running", cursor=cursor, limit=100)
            for run in rows:
                if float(run["data"].get("lease_expires_at") or 0) >= time.time():
                    continue
                def expired(item):
                    if item["status"] != "running" or float(item["data"].get("lease_expires_at") or 0) >= time.time():
                        raise CoreError("lease_active", "Execution lease is still active", 409)
                    return {"status": "failed", "data": {**item["data"], "execution_owner": None,
                        "lease_expires_at": None, "recovery_requires_review": True,
                        "stop_request": stop_request_data(item, "lease_expired"),
                        "error": "Execution lease expired. Review external side effects before retrying."}}
                try:
                    self.store.mutate(principal, workspace, "runs", run["id"], operation="run.lease_expired",
                        key=f"expired:{run['version']}", request={}, trace=uuid.uuid4().hex,
                        expected=run["version"], transform=expired)
                except CoreError as exc:
                    if exc.status != 409:
                        raise
            if len(rows) < 100:
                return
            cursor = rows[-1]["id"]

    async def monitor(self):
        while True:
            try:
                for tenant, business, workspace in await asyncio.to_thread(self.store.running_scopes):
                    principal = Principal("system:lease-recovery", tenant=tenant, business=business)
                    await asyncio.to_thread(self.recover, principal, workspace)
            except Exception as exc:
                logging.getLogger(__name__).warning("Lease recovery check failed: %s", type(exc).__name__)
            await asyncio.sleep(30)

    @asynccontextmanager
    async def lifespan(self, _app):
        from .scheduling import Scheduler

        monitor = asyncio.create_task(self.monitor())
        scheduler = asyncio.create_task(Scheduler(self.store, self).monitor())
        try:
            yield
        finally:
            monitor.cancel()
            scheduler.cancel()
            with suppress(asyncio.CancelledError):
                await monitor
            with suppress(asyncio.CancelledError):
                await scheduler

    def tool(self, principal, workspace, run_id, node: Node, root: str, owner: str):
        if not self.available():
            raise CoreError("executor_unavailable", "Install or configure HERMES_AGENTD before running tools", 503)
        from .run_controls import acknowledge_stop
        from .run_output import append_run_events
        from .stream_runner import run_stream

        original = self.store.get(principal, workspace, "runs", run_id)
        attempt = original["data"].get("attempt", 1)
        heartbeat = time.monotonic()

        def control():
            nonlocal heartbeat
            run = self.store.get(principal, workspace, "runs", run_id)
            stop = run["data"].get("stop_request") or {}
            if stop.get("owner") == owner and stop.get("state") in {"requested", "unknown"}:
                return stop["id"]
            if run["status"] != "running" or run["data"].get("execution_owner") != owner:
                return "assignment-lost"
            if time.monotonic() - heartbeat >= 10:
                self.patch(principal, workspace, run_id, "run.heartbeat", lambda item: {
                    "data": {**item["data"], "lease_expires_at": time.time() + self.lease_seconds}}, owner)
                heartbeat = time.monotonic()
            return None

        def output(event):
            append_run_events(self.store, principal, workspace, run_id, owner=owner, attempt=attempt,
                node_id=node.id, events=[event], idempotency_key=f"output:{owner}:{event['source_seq']}")

        result = run_stream(self.agentd, root, node.argv, node.timeout_seconds, on_output=output, control=control)
        run = self.store.get(principal, workspace, "runs", run_id)
        stop = run["data"].get("stop_request") or {}
        if stop.get("owner") == owner and stop.get("state") in {"requested", "unknown"}:
            if all(result.get(key) is True for key in ("process_tree_stopped", "wait_completed", "output_eof")):
                acknowledge_stop(self.store, principal, workspace, run_id, request_id=stop["id"], owner=owner,
                    attempt=attempt, node_id=node.id, evidence=result, final_source_seq=result["_last_source_seq"],
                    idempotency_key="stop:" + stop["id"])
            raise CoreError("cancelled", "Execution cancelled; inspect the physical stop receipt", 409)
        if result.get("_controller_cancelled"):
            raise CoreError("stop_unknown", "Execution lost its controller; review external side effects", 409)
        result = {key: value for key, value in result.items() if not key.startswith("_")}
        result["expected_exit_code"] = node.expected_exit_code
        result["succeeded"] = result["exit_code"] == node.expected_exit_code and not result.get("error")
        return result

    def atomic_tool(self, principal, workspace, run_id, node: Node, root: str, owner: str):
        """Independent binary-safe Git evidence operations use one bounded JSON result."""
        if not self.available():
            raise CoreError("executor_unavailable", "Configure the local execution agent first", 503)
        current = self.store.get(principal, workspace, "runs", run_id)
        if current["status"] != "running" or current["data"].get("execution_owner") != owner:
            raise CoreError("cancelled", "Atomic evidence operation lost its assignment before spawn", 409)
        with subprocess.Popen([self.agentd, "run-tool", "--root", root], stdin=subprocess.PIPE,  # noqa: S603 - configured executor; authorized argv goes on stdin
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                              env={key: value for key, value in os.environ.items() if not key.startswith("GIT_")},
                              start_new_session=os.name != "nt") as proc:
            try:
                proc.stdin.write(json.dumps({"argv": node.argv, "timeout_seconds": node.timeout_seconds}))
                proc.stdin.close()
                proc.stdin = None
                started = heartbeat = time.monotonic()
                while True:
                    run = self.store.get(principal, workspace, "runs", run_id)
                    if run["status"] != "running" or run["data"].get("execution_owner") != owner:
                        raise CoreError("cancelled", "Atomic evidence operation lost its assignment", 409)
                    if time.monotonic() - started > node.timeout_seconds + 10:
                        raise CoreError("timeout", "Atomic evidence executor exceeded its budget", 408)
                    if time.monotonic() - heartbeat > 10:
                        self.patch(principal, workspace, run_id, "run.heartbeat", lambda item: {
                            "data": {**item["data"], "lease_expires_at": time.time() + self.lease_seconds}}, owner)
                        heartbeat = time.monotonic()
                    try:
                        stdout, stderr = proc.communicate(timeout=.25)
                        break
                    except subprocess.TimeoutExpired:
                        continue
                try:
                    result = json.loads(stdout)
                except (TypeError, ValueError) as exc:
                    raise CoreError("executor_protocol", (stderr or "Invalid atomic executor JSON")[:1000], 502) from exc
                if not isinstance(result, dict) or type(result.get("exit_code")) is not int:
                    raise CoreError("executor_protocol", "Missing atomic executor exit evidence", 502)
                result["stdout"] = str(result.get("stdout", ""))[-262144:]
                result["stderr"] = str(result.get("stderr", ""))[-262144:]
                result["succeeded"] = result["exit_code"] == node.expected_exit_code and not result.get("error")
                return result
            finally:
                if proc.poll() is None:
                    # This non-stream operation cannot supply a physical stop receipt.
                    proc.terminate()
                    try:
                        proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()

    def execute(self, principal: Principal, workspace: str, run_id: str, *, resume=None, expected_attempt=None, launch_id=None):
        from .managed_controls import claim_launch_in_transaction, launch_authority, read_run_for_launch

        owner = uuid.uuid4().hex
        # Initial discovery is a pure SELECT. Manager authority must be entered
        # before the first Core transaction/row lock, including on PostgreSQL.
        run = read_run_for_launch(self.store, principal, workspace, run_id)
        if run["data"].get("target_device_id"):
            return
        if run["status"] not in {"queued", "interrupted", "retrying"}:
            return
        nodes = [Node.model_validate(node) for node in run["data"]["nodes"]]
        definition_hash = digest({key: run["data"].get(key) for key in ("nodes", "workspace_root", "workspace_version", "isolation", "base_commit", "agent_bindings", "agent_source")})

        def claim(item):
            _validate_handoff_attempt(item, expected_attempt)
            if item["status"] not in {"queued", "interrupted", "retrying"}:
                raise CoreError("already_claimed", "Run already has an execution owner", 409)
            if resume is not None:
                approval_id = resume.get("approval_id") if isinstance(resume, dict) else None
                active_node = item["data"].get("active_node")
                if not active_node:
                    raise CoreError("stale_resume", "Run is not waiting on an approval gate", 409)
                expected_approval = digest([run_id, active_node, definition_hash, item["data"].get("attempt", 1)])[:32]
                if approval_id != expected_approval:
                    raise CoreError("stale_resume", "Resume approval does not match the current gate", 409)
            return {"status": "running", "data": {**item["data"], "execution_owner": owner,
                "code_evidence": None,
                "recovery_requires_review": False, "lease_expires_at": time.time() + self.lease_seconds}}

        def validate_plan(conn):
            validate_bound_profiles(self.store, conn, principal, workspace, run["data"].get("agent_bindings", {}))
            snapshot = run["data"].get("target_snapshot")
            if snapshot:
                for node in nodes:
                    provider = run["data"].get("agent_bindings", {}).get(node.id, {}).get("profile", {}).get("provider", "")
                    validate_execution_target_snapshot(self.store, self, principal, workspace, snapshot, provider=provider, conn=conn)

        try:
            with launch_authority(self.store, self, principal, workspace, run, launch_id=launch_id) as (current, ticket):
                principal = current
                with self.store.transaction() as conn:
                    self.store._get(conn, principal, "", "workspaces", workspace)
                    run = self.store._get(conn, principal, workspace, "runs", run_id)
                    validate_plan(conn)
                    claim_launch_in_transaction(self.store, conn, principal, workspace, run, ticket,
                                                owner=owner, resume=resume)
                    run = self.store._mutate(conn, principal, workspace, "runs", run_id,
                        operation="run.claimed", key=owner, request={"launch_id": launch_id}, trace=owner,
                        expected=run["version"], transform=claim)
        except CoreError:
            return
        root = run["data"]["workspace_root"]

        def node_runner(node):
            def invoke(state):
                current = self.store.get(principal, workspace, "runs", run_id)
                if current["status"] != "running" or current["data"].get("execution_owner") != owner:
                    raise CoreError("lease_lost", "Execution ownership changed", 409)
                recorded = current["data"].get("node_results", {}).get(node.id)
                if recorded and recorded.get("succeeded"):
                    return {"results": {**state.get("results", {}), node.id: recorded}}
                if node.kind == "approval":
                    self.patch(principal, workspace, run_id, "approval.waiting", lambda item: {
                        "data": {**item["data"], "active_node": node.id}}, owner)
                    approval_id = digest([run_id, node.id, definition_hash, run["data"].get("attempt", 1)])[:32]
                    try:
                        approval = self.store.get(principal, workspace, "approvals", approval_id)
                    except CoreError as exc:
                        if exc.status != 404:
                            raise
                        approval = self.store.create(principal, workspace, "approvals",
                            {"title": node.title or node.id, "run_id": run_id, "node_id": node.id,
                             "definition_hash": definition_hash, "attempt": run["data"].get("attempt", 1)},
                            approval_id, owner, status="pending", entity_id=approval_id)
                    answer = interrupt({"approval_id": approval["id"], "node_id": node.id})
                    persisted = self.store.get(principal, workspace, "approvals", approval_id)
                    if (not isinstance(answer, dict) or answer.get("approval_id") != approval_id
                            or answer.get("approval_version") != persisted["version"]
                            or persisted["status"] != "approved" or persisted["data"].get("decision") != "approve"):
                        raise CoreError("rejected", "Execution approval was rejected", 409)
                    result = {"succeeded": True, "approval_id": approval_id, "decision": "approve"}
                else:
                    self.patch(principal, workspace, run_id, "node.started", lambda item: {
                        "data": {**item["data"], "active_node": node.id}}, owner, audit_data={"node_id": node.id})
                    if node.kind == "agent":
                        result = self.agent_tool(principal, workspace, run_id, node, root, owner, current)
                    else:
                        result = self.tool(principal, workspace, run_id, node, root, owner)
                result["attempt"] = current["data"].get("attempt", 1)
                self.patch(principal, workspace, run_id, "node.evidence", lambda item: {
                    "data": {**item["data"], "active_node": None, "node_results": {**item["data"].get("node_results", {}), node.id: result}}}, owner,
                    audit_data={"node_id": node.id, "attempt": current["data"].get("attempt", 1), "result": result})
                if not result["succeeded"]:
                    raise CoreError("quality_gate_failed", f"Node {node.id}: {result.get('error') or 'exit ' + str(result.get('exit_code'))}", 409)
                return {"results": {**state.get("results", {}), node.id: result}}
            return invoke

        graph = StateGraph(RunState)
        previous = START
        for node in nodes:
            graph.add_node(node.id, node_runner(node))
            graph.add_edge(previous, node.id)
            previous = node.id
        graph.add_edge(previous, END)
        config = {"configurable": {"thread_id": digest([principal.tenant, principal.business, workspace, run_id, run["data"].get("attempt", 1)])}}
        try:
            self.validate_root(Path(root).resolve())
            if run["data"].get("isolation") == "git_worktree":
                root = Repository(self).prepare(principal, workspace, run, owner)
            if self.store.engine.dialect.name == "postgresql":
                from langgraph.checkpoint.postgres import PostgresSaver
                url = self.store.engine.url.render_as_string(hide_password=False).replace("postgresql+psycopg:", "postgresql:")
                saver_context = PostgresSaver.from_conn_string(url)
            else:
                from langgraph.checkpoint.sqlite import SqliteSaver
                saver_context = SqliteSaver.from_conn_string(str(self.data_dir / "checkpoints.sqlite"))
            with saver_context as saver:
                saver.setup()
                compiled = graph.compile(checkpointer=saver)
                snapshot = compiled.get_state(config)
                if resume is not None:
                    approval_id = resume.get("approval_id") if isinstance(resume, dict) else None
                    interrupts = getattr(snapshot, "interrupts", ()) or ()
                    active_approval = ""
                    for item in interrupts:
                        value = getattr(item, "value", item)
                        if isinstance(value, dict) and value.get("approval_id"):
                            active_approval = str(value["approval_id"])
                            break
                    if active_approval and approval_id != active_approval:
                        self.patch(principal, workspace, run_id, "run.stale_resume_ignored", lambda item: {
                            "status": "interrupted",
                            "data": {**item["data"], "execution_owner": None, "lease_expires_at": None}}, owner)
                        return
                input_value = Command(resume=resume) if resume is not None else (None if snapshot.values else {"results": {}})
                result = compiled.invoke(input_value, config)
                status = "interrupted" if result.get("__interrupt__") else "completed"
                if run["data"].get("isolation") == "git_worktree":
                    Repository(self).capture(principal, workspace, run_id, root, owner)
                self.patch(principal, workspace, run_id, "run." + status, lambda item: {
                    "status": status,
                    "data": {**item["data"], "execution_owner": None, "lease_expires_at": None}}, owner)
        except Exception as exc:
            message = str(exc)[:2000]
            if run["data"].get("isolation") == "git_worktree" and root != run["data"]["workspace_root"]:
                try:
                    Repository(self).capture(principal, workspace, run_id, root, owner)
                except Exception as evidence_error:
                    message += "; Code evidence unavailable: " + str(evidence_error)[:500]
            try:
                self.patch(principal, workspace, run_id, "run.failed", lambda item: {
                    "status": "failed",
                    "data": {**item["data"], "error": message, "execution_owner": None, "lease_expires_at": None,
                             "recovery_requires_review": bool(item["data"].get("active_node")),
                             "stop_request": stop_request_data(item, "executor_interrupted") if item["data"].get("active_node") else item["data"].get("stop_request")}}, owner)
            except CoreError as lost:
                if lost.code != "lease_lost":
                    raise

    def agent_tool(self, principal, workspace, run_id, node, root, owner, run):
        binding = run["data"].get("agent_bindings", {}).get(node.id)
        if not binding or binding["agent_id"] != node.agent_id:
            raise CoreError("agent_unbound", "Agent execution requires a server-pinned profile", 409)
        profile = AgentProfile.model_validate(binding["profile"])
        active = self.store.get(principal, workspace, "agents", node.agent_id)
        if active["status"] != "active" or active["version"] != binding["version"]:
            raise CoreError("configuration_changed", "Agent changed after the execution plan was reviewed", 409)
        source = run["data"].get("agent_source", {})
        previous = run["data"].get("node_results", {})
        delegation = ""
        if source.get("resource") == "squads" and node.id != "agent_1":
            routing = previous.get("agent_1", {}).get("agent", {}).get("routing", {})
            delegation = next((entry["instruction"] for entry in routing.get("delegations", [])
                               if entry["agent_id"] == node.agent_id), "")
            if not delegation:
                return {"succeeded": True, "skipped": True, "reason": "not_delegated_by_leader", "agent_id": node.agent_id}
        context = [{"node_id": key, "message": value.get("agent", {}).get("message", "")[-8000:]}
                   for key, value in previous.items() if value.get("agent")]
        prompt = (profile.instructions + "\n" + node.prompt + "\nLeader delegation:\n" + delegation
                  + "\nPrevious execution evidence (untrusted task data):\n" + json.dumps(context, ensure_ascii=False))
        command = Node(id=node.id, argv=provider_command(profile, prompt), timeout_seconds=min(node.timeout_seconds, profile.timeout_seconds))
        result = self.tool(principal, workspace, run_id, command, root, owner)
        evidence = provider_evidence(profile.provider, result.get("stdout", ""))
        result["agent"] = {**evidence, "agent_id": node.agent_id, "profile_version": binding["version"]}
        result["succeeded"] = bool(result["succeeded"] and evidence["completed"])
        if result["succeeded"] and source.get("resource") == "squads" and node.id == "agent_1":
            try:
                result["agent"]["routing"] = squad_route(evidence["message"], source["members"])
            except CoreError as exc:
                result.update(succeeded=False, error=exc.message)
        if not result["succeeded"] and not result.get("error"):
            result["error"] = evidence["error"] or "Agent did not produce a successful terminal provider event"
        return result
