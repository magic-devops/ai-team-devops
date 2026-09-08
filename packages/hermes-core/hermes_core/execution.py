from __future__ import annotations

import json
import asyncio
import logging
import os
import shutil
import signal
import subprocess
import time
import uuid
from pathlib import Path
from contextlib import asynccontextmanager, suppress
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from .models import CoreError, Node, Principal
from .transactional import Store, digest


class RunState(TypedDict, total=False):
    results: dict


class Execution:
    lease_seconds = 120

    def __init__(self, store: Store, data_dir: Path, agentd: str = ""):
        self.store, self.data_dir = store, data_dir
        self.agentd = agentd or os.environ.get("HERMES_AGENTD") or shutil.which("sop-agentd") or ""
        self.allowed_roots: tuple[Path, ...] | None = None
        self.allow_commands = True

    def available(self):
        return bool(self.allow_commands and self.agentd and Path(self.agentd).is_file())

    def validate_root(self, root: Path):
        if self.allowed_roots is not None and not any(root == allowed or root.is_relative_to(allowed) for allowed in self.allowed_roots):
            raise CoreError("root_forbidden", "Workspace directory is not registered for execution on this host", 403)

    def patch(self, principal, workspace, run_id, action, change, owner=None):
        def guarded(item):
            if owner is not None and (item["data"].get("execution_owner") != owner or item["status"] != "running"):
                raise CoreError("lease_lost", "Execution ownership changed", 409)
            return change(item)
        return self.store.mutate(principal, workspace, "runs", run_id, operation=action,
            key=uuid.uuid4().hex, request={}, trace=uuid.uuid4().hex, expected=None, transform=guarded)

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
        monitor = asyncio.create_task(self.monitor())
        try:
            yield
        finally:
            monitor.cancel()
            with suppress(asyncio.CancelledError):
                await monitor

    def tool(self, principal, workspace, run_id, node: Node, root: str, owner: str):
        if not self.available():
            raise CoreError("executor_unavailable", "Install or configure HERMES_AGENTD before running tools", 503)
        request = json.dumps({"argv": node.argv, "timeout_seconds": node.timeout_seconds})
        with subprocess.Popen([self.agentd, "run-tool", "--root", root], stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                              start_new_session=os.name != "nt") as proc:
            try:
                proc.stdin.write(request)
                proc.stdin.close()
                proc.stdin = None
                started = time.monotonic()
                heartbeat = started
                while True:
                    run = self.store.get(principal, workspace, "runs", run_id)
                    if run["status"] == "cancelled" or run["data"].get("execution_owner") != owner:
                        raise CoreError("cancelled", "Execution cancelled or lease replaced", 409)
                    if time.monotonic() - started > node.timeout_seconds + 10:
                        raise CoreError("timeout", "Executor did not return within its time budget", 408)
                    if time.monotonic() - heartbeat >= 10:
                        self.patch(principal, workspace, run_id, "run.heartbeat", lambda item: {
                            "data": {**item["data"], "lease_expires_at": time.time() + self.lease_seconds}}, owner)
                        heartbeat = time.monotonic()
                    try:
                        stdout, stderr = proc.communicate(timeout=0.25)
                        break
                    except subprocess.TimeoutExpired:
                        continue
                try:
                    result = json.loads(stdout)
                except (ValueError, TypeError) as exc:
                    raise CoreError("executor_protocol", (stderr or "Executor returned invalid JSON")[:1000], 502) from exc
                if not isinstance(result, dict) or "exit_code" not in result:
                    raise CoreError("executor_protocol", "Missing executor exit evidence", 502)
                result["stdout"] = str(result.get("stdout", ""))[-262144:]
                result["stderr"] = str(result.get("stderr", ""))[-262144:]
                result["expected_exit_code"] = node.expected_exit_code
                result["succeeded"] = result["exit_code"] == node.expected_exit_code and not result.get("error")
                return result
            finally:
                if proc.poll() is None:
                    if os.name == "nt":
                        proc.terminate()
                    else:
                        os.killpg(proc.pid, signal.SIGTERM)
                    try:
                        proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()

    def execute(self, principal: Principal, workspace: str, run_id: str, *, resume=None):
        owner = uuid.uuid4().hex
        run = self.store.get(principal, workspace, "runs", run_id)
        if run["status"] not in {"queued", "interrupted", "retrying"}:
            return
        nodes = [Node.model_validate(node) for node in run["data"]["nodes"]]
        definition_hash = digest({key: run["data"].get(key) for key in ("nodes", "workspace_root", "workspace_version")})

        def claim(item):
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
                "recovery_requires_review": False, "lease_expires_at": time.time() + self.lease_seconds}}

        try:
            run = self.store.mutate(principal, workspace, "runs", run_id, operation="run.claimed", key=owner,
                request={}, trace=owner, expected=run["version"], transform=claim)
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
                        "data": {**item["data"], "active_node": node.id}}, owner)
                    result = self.tool(principal, workspace, run_id, node, root, owner)
                self.patch(principal, workspace, run_id, "node.evidence", lambda item: {
                    "data": {**item["data"], "active_node": None, "node_results": {**item["data"].get("node_results", {}), node.id: result}}}, owner)
                if not result["succeeded"]:
                    raise CoreError("quality_gate_failed", f"Node {node.id} exited {result.get('exit_code')}", 409)
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
                self.patch(principal, workspace, run_id, "run." + status, lambda item: {
                    "status": status,
                    "data": {**item["data"], "execution_owner": None, "lease_expires_at": None}}, owner)
        except Exception as exc:
            message = str(exc)[:2000]
            try:
                self.patch(principal, workspace, run_id, "run.failed", lambda item: {
                    "status": "failed",
                    "data": {**item["data"], "error": message, "execution_owner": None, "lease_expires_at": None,
                             "recovery_requires_review": bool(item["data"].get("active_node"))}}, owner)
            except CoreError as lost:
                if lost.code != "lease_lost":
                    raise
