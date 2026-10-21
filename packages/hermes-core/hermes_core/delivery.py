from __future__ import annotations

import uuid

from sqlalchemy import insert, update

from .agents import Agents
from .execution_targets import select_execution_plan_target
from .models import CoreError, Principal, TaskDispatch, TaskReview
from .remote import is_paired_device
from .transactional import Store, digest, now


def _device_allows_runtime(device: dict, runtime: str) -> bool:
    allowed = device["data"].get("allowed_runtimes")
    if allowed is None:
        return runtime == "command"
    return isinstance(allowed, list) and runtime in allowed


def _validate_remote_target(store: Store, conn, principal: Principal, workspace: str,
                            body: TaskDispatch, agent_source) -> None:
    device = store._get(conn, principal, workspace, "devices", body.target_device_id)
    if not is_paired_device(store, principal, workspace, body.target_device_id, conn=conn):
        raise CoreError("device_unpaired", "Pair an active device before dispatch", 409)
    if body.isolation != "workspace":
        raise CoreError("remote_unsupported", "Remote delivery requires workspace isolation", 422)
    if any(node.kind == "approval" for node in body.nodes):
        raise CoreError("remote_unsupported", "Remote approval nodes require the server checkpoint path", 422)
    agent_nodes = [node for node in body.nodes if node.kind == "agent"]
    if agent_nodes:
        if not agent_source or agent_source.get("resource") != "agents":
            raise CoreError("remote_unsupported", "Remote delivery supports single-agent dispatch only", 422)
        if not _device_allows_runtime(device, "agent"):
            raise CoreError("device_runtime_unsupported", "Device does not allow remote agent execution", 409)
    if any(node.kind not in {"command", "agent"} for node in body.nodes):
        raise CoreError("remote_unsupported", "Remote delivery supports command and agent nodes only", 422)


def _validate_dispatch_request(task: dict, body: TaskDispatch) -> str:
    if task["version"] != body.expected_version:
        raise CoreError("version_conflict", "Task changed; reload the execution plan", 409)
    if task["status"] in {"completed", "archived"} or task["data"].get("delivery", {}).get("phase") == "executing":
        raise CoreError("delivery_active", "Resolve the current delivery before dispatching again", 409)
    criteria = task["data"].get("acceptance_criteria")
    if not isinstance(criteria, str) or not criteria.strip():
        raise CoreError("acceptance_required", "Add acceptance criteria before dispatching", 422)
    if len({node.id for node in body.nodes}) != len(body.nodes):
        raise CoreError("invalid_graph", "Node IDs must be unique", 422)
    commands = [node for node in body.nodes if node.kind == "command"]
    if not any(node.kind in {"command", "agent"} for node in body.nodes) or any(
        not node.argv or any("\x00" in arg for arg in node.argv) for node in commands
    ):
        raise CoreError("invalid_command", "Delivery requires at least one valid command node", 422)
    return criteria


def _validate_agent_bindings(store: Store, conn, principal: Principal, workspace: str,
                             bindings: dict, agent_source) -> None:
    if bindings and not agent_source:
        raise CoreError("agent_dispatch_required", "Use version-pinned Agent or Squad dispatch", 422)
    if not agent_source:
        return
    target = store._get(conn, principal, workspace, agent_source["resource"], agent_source["id"])
    if target["version"] != agent_source["version"] or target["status"] != "active":
        raise CoreError("configuration_changed", "Agent configuration changed during dispatch", 409)
    versions = {member["agent_id"]: member["agent_version"] for member in agent_source["members"]}
    if any(binding["version"] != versions[binding["agent_id"]] for binding in bindings.values()):
        raise CoreError("configuration_changed", "Squad member changed during dispatch", 409)


class Delivery:
    def __init__(self, store: Store, repository):
        self.store = store
        self.repository = repository

    def detail(self, principal: Principal, workspace: str, task_id: str) -> dict:
        task = self.store.get(principal, workspace, "tasks", task_id)
        link = task["data"].get("delivery", {})
        run = self.store.get(principal, workspace, "runs", link["run_id"]) if link else None
        phase = link.get("phase", "unplanned")
        if phase == "executing" and run:
            phase = {"completed": "awaiting_review", "failed": "blocked", "cancelled": "cancelled"}.get(
                run["status"], run["status"]
            )
        return {
            "id": task_id,
            "task": task,
            "run": run,
            "phase": phase,
            "review": link.get("review"),
            "acceptance_criteria": task["data"].get("acceptance_criteria", ""),
        }

    def _update_task(self, conn, principal, workspace, task, data, status, action, trace):
        changed = {
            **task,
            "data": data,
            "status": status,
            "version": task["version"] + 1,
            "updated_at": now(),
        }
        result = conn.execute(
            update(self.store.entities)
            .where(self.store.entities.c.id == task["id"], self.store.entities.c.version == task["version"])
            .values(data=data, status=status, version=changed["version"], updated_at=changed["updated_at"])
        )
        if result.rowcount != 1:
            raise CoreError("version_conflict", "Task changed; reload before applying", 409)
        self.store._record(
            conn,
            principal,
            workspace,
            changed,
            action,
            trace,
            {"status": status, "run_id": data["delivery"]["run_id"], "phase": data["delivery"]["phase"]},
        )
        return changed

    def _save_receipt(self, conn, receipt_id, request, result):
        conn.execute(
            insert(self.store.receipts).values(
                id=receipt_id, request_hash=digest(request), result=result, created_at=now()
            )
        )

    def dispatch(self, principal: Principal, workspace: str, task_id: str, body: TaskDispatch, trace: str, *, agent_source=None):
        with self.store.transaction() as conn:
            return self.dispatch_in_transaction(conn, principal, workspace, task_id, body, trace, agent_source=agent_source)

    def dispatch_in_transaction(self, conn, principal: Principal, workspace: str, task_id: str, body: TaskDispatch, trace: str, *, agent_source=None):
        """Use one existing transaction for envelope/plan/controlled-handoff composition."""
        if len(body.model_dump_json().encode("utf-8")) > 1_048_576:
            raise CoreError("payload_too_large", "Execution plan must not exceed 1 MiB", 422)
        request = agent_source["request"] if agent_source else body.model_dump()
        operation = "task.agent-dispatch:" if agent_source else "task.dispatch:"
        receipt_id, cached = self.store._receipt(
            conn, principal, workspace, operation + task_id, body.idempotency_key, request
        )
        if cached is not None and not body.dry_run:
            return cached
        # Match Agent/Squad dispatch and scheduling before holding any Task or
        # Agent-profile lock. A workspace serializes its competing new plans.
        current_workspace = self.store._get(conn, principal, "", "workspaces", workspace)
        task = self.store._get(conn, principal, workspace, "tasks", task_id)
        criteria = _validate_dispatch_request(task, body)
        bindings = Agents(self.store).bindings(conn, principal, workspace, body.nodes)
        _validate_agent_bindings(self.store, conn, principal, workspace, bindings, agent_source)
        target_snapshot = None
        if body.target_device_id or body.target_basis:
            target_snapshot = select_execution_plan_target(self.store, getattr(self.repository, "execution", None),
                                                            principal, workspace, body, bindings, conn)
        if body.target_device_id:
            _validate_remote_target(self.store, conn, principal, workspace, body, agent_source)
        if body.isolation == "git_worktree":
            self.repository.validate_base(current_workspace["data"]["root"], body.base_commit)
        elif body.base_commit:
            raise CoreError("invalid_isolation", "A base commit requires Git worktree isolation", 422)
        source = {
            "task_id": task_id,
            "task_version": task["version"],
            "title": task["data"]["title"],
            "acceptance_criteria": criteria,
            "assigned_agent": task["data"].get("assigned_agent", ""),
            "dispatched_by": principal.actor,
        }
        run_data = {
            "title": task["data"]["title"],
            "nodes": [node.model_dump() for node in body.nodes],
            "workspace_root": current_workspace["data"]["root"],
            "workspace_version": current_workspace["version"],
            "task_source": source,
            "isolation": body.isolation,
            "base_commit": body.base_commit,
        }
        managed_source = task["data"].get("source", {})
        if managed_source.get("kind") == "manager.delivery":
            # Preserve the saved original exactly. Missing old plans are readable
            # but cannot later acquire test acceptance by an implicit upgrade.
            run_data["managed_execution_id"] = managed_source.get("execution_id", "")
            if "test_plan" in managed_source:
                from copy import deepcopy
                from .managed_test_quality import valid_test_plan

                if not valid_test_plan(managed_source["test_plan"], run_data["nodes"]):
                    raise CoreError("invalid_test_plan", "Managed test identities must match the actual commands", 422)
                run_data["managed_test_plan"] = deepcopy(managed_source["test_plan"])
        if bindings:
            run_data["agent_bindings"] = bindings
        if body.target_device_id:
            run_data["target_device_id"] = body.target_device_id
        if target_snapshot:
            run_data["target_snapshot"] = target_snapshot
        if agent_source:
            run_data["agent_source"] = {key: value for key, value in agent_source.items() if key != "request"}
        if body.dry_run:
            return {"id": task_id, "task": task, "plan": run_data, "dry_run": True}
        run = dict(
            id=uuid.uuid4().hex,
            kind="runs",
            tenant=principal.tenant,
            business=principal.business,
            workspace=workspace,
            version=1,
            status="planned",
            data=run_data,
            created_at=now(),
            updated_at=now(),
        )
        conn.execute(insert(self.store.entities).values(**run))
        self.store._record(conn, principal, workspace, run, "task.run_planned", trace, source)
        changed = self._update_task(
            conn,
            principal,
            workspace,
            task,
            {**task["data"], "delivery": {"run_id": run["id"], "phase": "executing", "source": source}},
            "in_progress",
            "task.dispatched",
            trace,
        )
        result = {"id": task_id, "task": changed, "run": run, "phase": "planned", "dry_run": False}
        self._save_receipt(conn, receipt_id, request, result)
        return result

    def review(self, principal: Principal, workspace: str, task_id: str, body: TaskReview, trace: str):
        request = body.model_dump()
        with self.store.transaction() as conn:
            receipt_id, cached = self.store._receipt(
                conn, principal, workspace, "task.review:" + task_id, body.idempotency_key, request
            )
            if cached is not None and not body.dry_run:
                return cached
            task = self.store._get(conn, principal, workspace, "tasks", task_id)
            link = task["data"].get("delivery", {})
            if task["version"] != body.expected_version:
                raise CoreError("version_conflict", "Task changed; reload before review", 409)
            if link.get("run_id") != body.run_id or link.get("phase") != "executing":
                raise CoreError("delivery_closed", "This run is not the current task delivery", 409)
            run = self.store._get(conn, principal, workspace, "runs", body.run_id)
            if run["version"] != body.run_version:
                raise CoreError("version_conflict", "Execution evidence changed; reload before review", 409)
            if run["status"] not in {"completed", "failed", "cancelled"}:
                raise CoreError("delivery_running", "Wait for execution or cancel it before review", 409)
            if not body.comment.strip():
                raise CoreError("review_required", "Record a review conclusion", 422)
            if body.decision == "accept":
                if task["data"].get("source", {}).get("kind") == "manager.delivery" or run["data"].get("managed_execution_id"):
                    from .managed_test_quality import managed_run_quality

                    quality = managed_run_quality(task, run)
                    if quality["status"] != "passed":
                        raise CoreError("test_evidence_required", "Managed acceptance requires fixed successful command tests", 409)
                if run["data"].get("isolation") == "git_worktree":
                    evidence = run["data"].get("code_evidence")
                    if not evidence or evidence.get("complete") is not True or evidence.get("truncated") or evidence.get("untracked"):
                        raise CoreError("code_evidence_incomplete", "Complete code evidence is required; stage intended new files and rerun before acceptance", 409)
                results = run["data"].get("node_results", {})
                if run["status"] != "completed" or not all(
                    results.get(node["id"], {}).get("succeeded") is True for node in run["data"]["nodes"]
                ):
                    raise CoreError(
                        "evidence_required",
                        "Only completed runs with successful node evidence can be accepted",
                        409,
                    )
            review = {
                "decision": body.decision,
                "comment": body.comment.strip(),
                "actor": principal.actor,
                "run_version": run["version"],
                "evidence_sha256": digest(run),
                "trace_id": trace,
                "created_at": now(),
            }
            if task["data"].get("source", {}).get("kind") == "manager.delivery" or run["data"].get("managed_execution_id"):
                from .managed_test_quality import managed_run_quality

                review["quality"] = managed_run_quality(task, run)
            phase = "accepted" if body.decision == "accept" else "changes_requested"
            if body.dry_run:
                return {
                    "id": task_id,
                    "task": task,
                    "run": run,
                    "review": review,
                    "phase": phase,
                    "dry_run": True,
                }
            changed = self._update_task(
                conn,
                principal,
                workspace,
                task,
                {**task["data"], "delivery": {**link, "phase": phase, "review": review}},
                "completed" if body.decision == "accept" else "blocked",
                "task.reviewed",
                trace,
            )
            self.store._record(
                conn,
                principal,
                workspace,
                changed,
                "task.review_evidence",
                trace,
                {**review, "run_id": run["id"]},
            )
            result = {
                "id": task_id,
                "task": changed,
                "run": run,
                "phase": phase,
                "review": review,
                "dry_run": False,
            }
            self._save_receipt(conn, receipt_id, request, result)
            return result
