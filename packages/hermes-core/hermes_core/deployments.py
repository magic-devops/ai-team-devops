"""Managed command runs: immutable provenance, explicit authorization and stable receipts."""

from __future__ import annotations

import json
import uuid

from sqlalchemy import insert

from .deployment_contract import OperationPlan, validate_argv
from .execution_targets import validate_execution_target_snapshot
from .models import CoreError, Node
from .transactional import digest, now


def receipt_request(plan, runner_argv, target_snapshot, observe=False):
    value = OperationPlan.model_validate(plan).model_dump(mode="json")
    validate_argv(runner_argv, tokens=False)
    if type(observe) is not bool:
        raise ValueError("observe must be a boolean")
    return {"plan": value, "runner_argv": runner_argv, "target_snapshot": target_snapshot, "observe": observe}


class ManagedDeployments:
    def __init__(self, store, execution=None):
        self.store, self.execution = store, execution

    def _authorize(self, principal, workspace, *, active=True, conn=None):
        if "execute" not in principal.permissions:
            raise CoreError("forbidden", "Runtime execute permission required", 403)
        if principal.workspace_ids is not None and workspace not in principal.workspace_ids:
            raise CoreError("forbidden", "Workspace membership required", 403)
        row = (
            self.store._get(conn, principal, "", "workspaces", workspace)
            if conn is not None
            else self.store.get(principal, "", "workspaces", workspace)
        )
        if active and row["status"] != "active":
            raise CoreError("workspace_inactive", "Execution workspace is inactive", 409)
        return row

    def prepare(self, principal, workspace, *, plan, runner_argv, target_snapshot):
        request = receipt_request(plan, runner_argv, target_snapshot)
        row = self._authorize(principal, workspace)
        if request["plan"]["tenant_id"] != principal.tenant:
            raise CoreError("forbidden", "Deployment tenant differs from runtime identity", 403)
        validate_execution_target_snapshot(self.store, self.execution, principal, workspace, target_snapshot)
        return self._data(principal, row, request)

    @staticmethod
    def _data(principal, row, request):
        plan = request["plan"]
        command = [
            *request["runner_argv"],
            "--plan-json",
            json.dumps(plan, ensure_ascii=False, separators=(",", ":")),
        ]
        if request["observe"]:
            command.append("--observe")
        # The JSON envelope is one literal argument, never a placeholder template.
        validate_argv(command, tokens=None)
        node = Node(
            id="deployment",
            title="Observe deployment" if request["observe"] else "Deploy and verify",
            argv=command,
            timeout_seconds=plan["timeout_seconds"] + 30,
        )
        target = request["target_snapshot"]
        return {
            "title": f"{plan['kind']} {plan['operation_id']}"[:120],
            "nodes": [node.model_dump()],
            "workspace_root": row["data"]["root"],
            "workspace_version": row["version"],
            "target_snapshot": target,
            "target_basis": target["basis"],
            "target_device_id": target["id"] if target["kind"] == "device" else "",
            "deployment_source": {
                "plan": plan,
                "plan_digest": digest(plan),
                "observe": request["observe"],
                "requested_by": principal.actor,
            },
            "isolation": "workspace",
        }

    def dispatch(self, principal, workspace, *, plan, runner_argv, target_snapshot, key, observe=False):
        request = receipt_request(plan, runner_argv, target_snapshot, observe)
        self._authorize(principal, workspace, active=False)
        cached = self.store.receipt(principal, workspace, "deployment.dispatch", key, request)
        if cached is not None:
            return cached
        self.prepare(
            principal, workspace, plan=plan, runner_argv=runner_argv, target_snapshot=target_snapshot
        )
        # Configuration and presence are checked again inside the same transaction as the receipt.
        with self.store.transaction() as conn:
            receipt_id, cached = self.store._receipt(
                conn, principal, workspace, "deployment.dispatch", key, request
            )
            if cached is not None:
                return cached
            row = self._authorize(principal, workspace, conn=conn)
            validate_execution_target_snapshot(
                self.store, self.execution, principal, workspace, target_snapshot, conn=conn
            )
            data = self._data(principal, row, request)
            run = dict(
                id=uuid.uuid4().hex,
                kind="runs",
                tenant=principal.tenant,
                business=principal.business,
                workspace=workspace,
                version=1,
                status="planned",
                data=data,
                created_at=now(),
                updated_at=now(),
            )
            conn.execute(insert(self.store.entities).values(**run))
            self.store._record(
                conn,
                principal,
                workspace,
                run,
                "deployment.planned",
                key,
                {"operation_id": plan["operation_id"], "plan_digest": digest(request["plan"])},
            )
            conn.execute(
                insert(self.store.receipts).values(
                    id=receipt_id, request_hash=digest(request), result=run, created_at=now()
                )
            )
            return run

    def _action(self, principal, workspace, run_id, key, action):
        self._authorize(principal, workspace, active=False)
        request = {"run_id": run_id}
        cached = self.store.receipt(principal, workspace, f"deployment.{action}:{run_id}", key, request)
        if cached is not None:
            return cached
        run = self.store.get(principal, workspace, "runs", run_id)
        if not run["data"].get("deployment_source"):
            raise CoreError(
                "managed_run_required", "Use deployment actions only for managed deployments", 409
            )
        if action == "start":
            self._authorize(principal, workspace)

        def guard(conn):
            current_workspace = self._authorize(principal, workspace, active=action == "start", conn=conn)
            if action == "start":
                if current_workspace["version"] != run["data"]["workspace_version"]:
                    raise CoreError("workspace_changed", "Execution workspace changed", 409)
                validate_execution_target_snapshot(
                    self.store,
                    self.execution,
                    principal,
                    workspace,
                    run["data"]["target_snapshot"],
                    conn=conn,
                )

        def transition(item):
            allowed = {"planned"} if action == "start" else {"planned", "queued", "running", "interrupted"}
            if item["status"] not in allowed:
                raise CoreError(
                    "invalid_transition", f"Cannot {action} deployment run in {item['status']}", 409
                )
            return {
                "status": "queued" if action == "start" else "cancelled",
                "data": {**item["data"], "execution_owner": None, "lease_expires_at": None},
            }

        return self.store.mutate(
            principal,
            workspace,
            "runs",
            run_id,
            operation=f"deployment.{action}",
            key=key,
            request=request,
            trace=uuid.uuid4().hex,
            expected=run["version"],
            transform=transition,
            precondition=guard,
        )

    def start(self, principal, workspace, run_id, *, key):
        return self._action(principal, workspace, run_id, key, "start")

    def cancel(self, principal, workspace, run_id, *, key):
        return self._action(principal, workspace, run_id, key, "cancel")
