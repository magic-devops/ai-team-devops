from __future__ import annotations

import hmac
import json
import uuid
from collections.abc import Callable
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from . import __version__
from .agents import AgentDispatch, Agents, validate_bound_profiles
from .collaboration import COLLAB_ACTIONS, create_collaboration_router, filter_collaboration_events
from .delivery import Delivery
from .diagnostics import runtime_checks
from .execution import Execution
from .execution_targets import select_execution_target, validate_execution_target_snapshot
from .models import (
    ACTIONS,
    API_BASE,
    RESOURCE_DATA_FIELDS,
    RESOURCE_STATUS_OPTIONS,
    RESOURCES,
    CoreError,
    Decision,
    Envelope,
    Mutation,
    Node,
    Principal,
    RunAction,
    TaskDispatch,
    TaskReview,
    payload,
)
from .remote import _public_device, create_remote_router, is_paired_device
from .repository import Repository
from .scheduling import create_scheduling_router
from .transactional import Store, digest


def resource_contracts() -> dict[str, dict[str, object]]:
    return {
        resource: {
            "title_max_length": 120,
            "title_required": True,
            "title_aliases": ["name"] if "name" in RESOURCE_DATA_FIELDS.get(resource, ()) else [],
            "statuses": list(statuses),
            "fields": list(RESOURCE_DATA_FIELDS.get(resource, ())),
        }
        for resource, statuses in RESOURCE_STATUS_OPTIONS.items()
    }


def create_router(store: Store, execution: Execution, identity: Callable, *, actor_directory: Callable | None = None):
    router = APIRouter(prefix=API_BASE, tags=["Hermes Workspace"])
    repository = Repository(execution)
    delivery = Delivery(store, repository)
    agents = Agents(store)
    run_internal_fields = {"node_results", "attempt", "active_node", "error", "execution_owner", "lease_expires_at", "recovery_requires_review", "replay_of", "code_workspace", "code_evidence", "agent_bindings", "agent_source", "schedule", "remote_worker_version", "remote_claim_key", "target_snapshot"}

    def require(principal: Principal, action: str):
        if action not in principal.permissions:
            raise CoreError("forbidden", f"Missing {action} permission", 403)

    def workspace_id(request: Request, principal: Principal):
        workspace = request.headers.get("X-Workspace-Id", "")
        if not workspace:
            raise CoreError("workspace_required", "Select a workspace first", 400)
        if principal.workspace_ids is not None and workspace not in principal.workspace_ids:
            raise CoreError("forbidden", "Workspace access denied", 403)
        row = store.get(principal, "", "workspaces", workspace)
        if row["status"] != "active":
            raise CoreError("workspace_inactive", "Workspace is inactive", 409)
        return workspace

    def response(principal, workspace, items, **extra):
        public = [_public_device(item) if item.get("kind") == "devices" else item for item in items]
        return payload(principal, workspace, public, trace=uuid.uuid4().hex, **extra)

    def clean_title(resource: str, data: dict):
        title = data.get("title")
        if title is None and "name" in data:
            title = data["name"]
            data["title"] = title
        if not isinstance(title, str) or not title.strip():
            raise CoreError("title_required", f"{resource} title is required", 422)
        data["title"] = title.strip()
        if len(data["title"]) > 120:
            raise CoreError("title_too_long", f"{resource} title must be 120 characters or fewer", 422)

    def validate_status(resource: str, status: str):
        allowed = RESOURCE_STATUS_OPTIONS.get(resource)
        if allowed is not None and status not in allowed:
            raise CoreError("invalid_status", f"{resource} status must be one of {', '.join(allowed)}", 422)

    def validate_data_fields(resource: str, data: dict):
        allowed = RESOURCE_DATA_FIELDS.get(resource)
        if allowed is None:
            return
        extras = sorted(set(data) - set(allowed) - {"status"})
        if extras:
            raise CoreError("unknown_field", f"{resource} does not accept fields: {', '.join(extras)}", 422)

    @router.get("/health")
    def health():
        return {"ok": True, "version": __version__, "service": "hermes-core"}

    @router.get("/actions", response_model=Envelope)
    def actions(principal: Principal = Depends(identity)):
        return response(principal, "", ACTIONS + COLLAB_ACTIONS)

    @router.get("/system/readiness", response_model=Envelope)
    def readiness(principal: Principal = Depends(identity)):
        require(principal, "read")
        checks = runtime_checks(store, execution)
        return response(principal, "", checks,
                        summary={"ready": all(c["status"] == "passed" for c in checks),
                                 "resource_contracts": resource_contracts()},
                        cli={"command": "sop hermes readiness --json"},
                        ok=all(c["status"] == "passed" for c in checks))

    @router.get("/system/diagnostics", response_model=Envelope)
    def diagnostics(principal: Principal = Depends(identity)):
        require(principal, "read")
        checks = runtime_checks(store, execution)
        passed = sum(check["status"] == "passed" for check in checks)
        return response(principal, "", checks, ok=passed == len(checks),
                        summary={"version": __version__, "total": len(checks), "passed": passed,
                                 "failed": len(checks) - passed, "ready": passed == len(checks)},
                        cli={"command": "sop hermes diagnostics --json"},
                        agent_consumption={"read_only": True, "checks": [check["id"] for check in checks]})

    @router.get("/sync", response_model=Envelope)
    def sync(request: Request, after: int = Query(0, ge=0), principal: Principal = Depends(identity)):
        require(principal, "read")
        workspace = workspace_id(request, principal)
        rows = store.stream(principal, workspace, after=after)
        cursor = rows[-1]["seq"] if rows else after
        rows = filter_collaboration_events(store, principal, workspace, rows)
        return response(principal, workspace, rows, summary={"total": len(rows), "cursor": cursor})

    @router.get("/runs/{run_id}/events", response_model=Envelope)
    def events(run_id: str, request: Request, after: int = Query(0, ge=0), principal: Principal = Depends(identity)):
        require(principal, "read")
        workspace = workspace_id(request, principal)
        store.get(principal, workspace, "runs", run_id)
        rows = store.stream(principal, workspace, entity_id=run_id, after=after)
        return response(principal, workspace, rows, summary={"total": len(rows), "cursor": rows[-1]["seq"] if rows else after})

    @router.post("/runs/{run_id}/{action}", response_model=Envelope)
    def run_action(run_id: str, action: str, body: RunAction, request: Request, background: BackgroundTasks,
                   principal: Principal = Depends(identity)):
        require(principal, "export" if action == "export" else "execute")
        workspace = workspace_id(request, principal)
        run = store.get(principal, workspace, "runs", run_id)
        if action not in {"start", "cancel", "retry", "replay", "export"}:
            raise CoreError("unknown_action", "Unsupported run action", 404)
        operation = f"run.{action}:{run_id}"
        if not body.dry_run:
            cached = store.receipt(principal, workspace, operation, body.idempotency_key, body.model_dump())
            if cached is not None:
                if action in {"start", "retry"} and run["status"] in {"queued", "retrying"}:
                    background.add_task(execution.execute, principal, workspace, run_id)
                return response(principal, workspace, [cached])
        if run["version"] != body.expected_version:
            raise CoreError("version_conflict", "Run changed; reload before applying this action", 409)
        if action in {"start", "retry"}:
            source = run["data"].get("task_source")
            if source:
                task = store.get(principal, workspace, "tasks", source["task_id"])
                link = task["data"].get("delivery", {})
                if link.get("run_id") != run_id or link.get("phase") != "executing":
                    raise CoreError("delivery_closed", "Dispatch a new plan from the task before executing", 409)
            current_workspace = store.get(principal, "", "workspaces", workspace)
            if run["data"].get("workspace_version") != current_workspace["version"]:
                raise CoreError("workspace_changed", "Workspace configuration changed; create a newly reviewed run", 409)
            snapshot = run["data"].get("target_snapshot")
            if snapshot:
                for node in run["data"].get("nodes", []):
                    provider = run["data"].get("agent_bindings", {}).get(node["id"], {}).get("profile", {}).get("provider", "")
                    validate_execution_target_snapshot(store, execution, principal, workspace, snapshot, provider=provider)
        if action == "export":
            evidence = []
            while True:
                batch = store.stream(principal, workspace, entity_id=run_id, after=evidence[-1]["seq"] if evidence else 0, limit=1000)
                evidence.extend(batch)
                if len(batch) < 1000:
                    break
            package = {"kind": "hermes.audit-package", "run": run, "events": evidence, "sha256": digest([run, evidence])}
            source = run["data"].get("task_source")
            if source:
                task = store.get(principal, workspace, "tasks", source["task_id"])
                task_events = []
                while True:
                    batch = store.stream(principal, workspace, entity_id=task["id"], after=task_events[-1]["seq"] if task_events else 0, limit=1000)
                    task_events.extend(batch)
                    if len(batch) < 1000:
                        break
                package.update(task=task, task_events=task_events, sha256=digest([run, evidence, task, task_events]))
            if body.dry_run:
                return response(principal, workspace, [package], summary={"dry_run": True})
            artifact = store.create(principal, workspace, "artifacts", package, body.idempotency_key, uuid.uuid4().hex,
                                    operation=operation, request=body.model_dump())
            return response(principal, workspace, [artifact])
        allowed = {"start": {"planned"}, "retry": {"failed"}, "cancel": {"planned", "queued", "running", "interrupted", "retrying"}}
        if action in allowed and run["status"] not in allowed[action]:
            raise CoreError("invalid_transition", f"Cannot {action} a {run['status']} run", 409)
        if action == "retry" and run["data"].get("recovery_requires_review"):
            require(principal, "approve")
        if body.dry_run:
            return response(principal, workspace, [run], summary={"dry_run": True, "action": action, "would_execute": action in {"start", "retry"}, "executor_available": execution.available()})
        if action == "replay":
            if run["data"].get("task_source"):
                raise CoreError("task_dispatch_required", "Create the next delivery from its task to retain review history", 409)
            data = {key: value for key, value in run["data"].items() if key not in run_internal_fields}
            if data.get("target_device_id"):
                data["target_snapshot"] = select_execution_target(
                    store, execution, principal, workspace, target_kind="device",
                    target_device_id=data["target_device_id"], expected_basis=data.get("target_basis"))
            result = store.create(principal, workspace, "runs", {**data, "replay_of": run_id}, body.idempotency_key, uuid.uuid4().hex,
                                  status="planned", operation=operation, request=body.model_dump())
            return response(principal, workspace, [result])
        target = {"start": "queued", "retry": "retrying", "cancel": "cancelled"}[action]

        def transition(item):
            if item["status"] not in allowed[action]:
                raise CoreError("invalid_transition", f"Cannot {action} a {item['status']} run", 409)
            if action in {"start", "retry"} and not item["data"].get("target_device_id") and not execution.available():
                raise CoreError("executor_unavailable", "Configure the local execution agent first", 503)
            if action == "retry":
                return {"status": target, "data": {**item["data"], "attempt": item["data"].get("attempt", 1) + 1}}
            if action == "cancel":
                return {"status": target, "data": {**item["data"], "execution_owner": None, "lease_expires_at": None}}
            return {"status": target}

        def guard_delivery(conn):
            if action in {"start", "retry"}:
                validate_bound_profiles(store, conn, principal, workspace, run["data"].get("agent_bindings", {}))
            source = run["data"].get("task_source")
            if source and action in {"start", "retry"}:
                task = store._get(conn, principal, workspace, "tasks", source["task_id"])
                link = task["data"].get("delivery", {})
                if link.get("run_id") != run_id or link.get("phase") != "executing":
                    raise CoreError("delivery_closed", "The task delivery is no longer executable", 409)
            if action in {"start", "retry"} and run["data"].get("target_snapshot"):
                for node in run["data"].get("nodes", []):
                    provider = run["data"].get("agent_bindings", {}).get(node["id"], {}).get("profile", {}).get("provider", "")
                    validate_execution_target_snapshot(store, execution, principal, workspace, run["data"]["target_snapshot"], provider=provider, conn=conn)

        result = store.mutate(principal, workspace, "runs", run_id, operation="run." + action,
            key=body.idempotency_key, request=body.model_dump(), trace=uuid.uuid4().hex,
            expected=body.expected_version, transform=transition, precondition=guard_delivery)
        if action in {"start", "retry"}:
            background.add_task(execution.execute, principal, workspace, run_id)
        return response(principal, workspace, [result])

    @router.post("/approvals/{approval_id}/decision", response_model=Envelope)
    def decision(approval_id: str, body: Decision, request: Request, background: BackgroundTasks,
                 principal: Principal = Depends(identity)):
        require(principal, "approve")
        workspace = workspace_id(request, principal)
        approval = store.get(principal, workspace, "approvals", approval_id)
        run_id = approval["data"]["run_id"]
        run = store.get(principal, workspace, "runs", run_id)
        definition = {key: run["data"].get(key) for key in ("nodes", "workspace_root", "workspace_version", "isolation", "base_commit", "agent_bindings", "agent_source")}
        if digest(definition) != approval["data"]["definition_hash"]:
            raise CoreError("approval_stale", "Run definition changed after approval was requested", 409)
        if approval["data"].get("attempt", 1) != run["data"].get("attempt", 1):
            raise CoreError("approval_stale", "Approval belongs to a previous execution attempt", 409)
        if body.decision == "approve" and approval["status"] == "pending":
            current_workspace = store.get(principal, "", "workspaces", workspace)
            if run["data"].get("workspace_version") != current_workspace["version"]:
                raise CoreError("approval_stale", "Workspace changed after approval was requested", 409)
        if body.dry_run:
            if approval["version"] != body.expected_version or approval["status"] != "pending" or run["status"] != "interrupted":
                raise CoreError("approval_closed", "Approval changed or is no longer pending", 409)
            return response(principal, workspace, [approval], summary={"dry_run": True})

        def should_resume(approved):
            current = store.get(principal, workspace, "runs", run_id)
            return (current["status"] == "interrupted"
                    and current["data"].get("active_node") == approved["data"].get("node_id")
                    and approved["status"] == "approved"
                    and approved["data"].get("decision") == "approve")

        def decide(item):
            if item["status"] != "pending" or run["status"] != "interrupted":
                raise CoreError("approval_closed", "Approval is no longer pending", 409)
            return {"status": "approved" if body.decision == "approve" else "rejected",
                    "data": {**item["data"], "decision": body.decision, "decided_by": principal.actor}}

        result = store.mutate(principal, workspace, "approvals", approval_id, operation="approval.decision",
            key=body.idempotency_key, request=body.model_dump(), trace=uuid.uuid4().hex,
            expected=body.expected_version, transform=decide)
        if should_resume(result):
            background.add_task(execution.execute, principal, workspace, run_id,
                                resume={"approval_id": approval_id, "approval_version": result["version"]})
        elif result["status"] == "rejected":
            current = store.get(principal, workspace, "runs", run_id)
            if current["status"] == "interrupted" and current["data"].get("active_node") == result["data"].get("node_id"):
                store.mutate(principal, workspace, "runs", run_id, operation="approval.rejected",
                    key=uuid.uuid4().hex, request={}, trace=uuid.uuid4().hex, expected=current["version"],
                    transform=lambda item: {"status": "failed", "data": {**item["data"],
                        "error": "Execution approval was rejected", "execution_owner": None,
                        "lease_expires_at": None, "recovery_requires_review": False}})
        return response(principal, workspace, [result])

    @router.get("/tasks/{task_id}/delivery", response_model=Envelope)
    def task_delivery(task_id: str, request: Request, principal: Principal = Depends(identity)):
        require(principal, "read")
        workspace = workspace_id(request, principal)
        return response(principal, workspace, [delivery.detail(principal, workspace, task_id)],
                        cli={"command": f"sop task v1 delivery {task_id} --json"})

    @router.get("/workspaces/{entity_id}/repository", response_model=Envelope)
    def repository_info(entity_id: str, request: Request, principal: Principal = Depends(identity)):
        require(principal, "read")
        workspace = workspace_id(request, principal)
        if workspace != entity_id:
            raise CoreError("scope_mismatch", "Repository must belong to the selected workspace", 403)
        row = store.get(principal, "", "workspaces", workspace)
        return response(principal, workspace, [repository.inspect(row["data"]["root"], workspace)],
                        cli={"command": f"sop workspace repository {workspace} --json"})

    @router.get("/runs/{run_id}/changes", response_model=Envelope)
    def run_changes(run_id: str, request: Request, principal: Principal = Depends(identity)):
        require(principal, "read")
        workspace = workspace_id(request, principal)
        run = store.get(principal, workspace, "runs", run_id)
        evidence = run["data"].get("code_evidence")
        return response(principal, workspace, [{"id": run_id, "run_version": run["version"],
            "code_workspace": run["data"].get("code_workspace"), "code_evidence": evidence}],
            summary={"available": evidence is not None, "snapshot": True},
            cli={"command": f"sop run changes {run_id} --json"})

    @router.post("/tasks/{task_id}/dispatch", response_model=Envelope)
    def task_dispatch(task_id: str, body: TaskDispatch, request: Request, principal: Principal = Depends(identity)):
        require(principal, "write")
        require(principal, "execute")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        result = delivery.dispatch(principal, workspace, task_id, body, trace)
        return payload(principal, workspace, [result], trace=trace,
                       summary={"dry_run": body.dry_run, "would_execute": False},
                       cli={"command": f"sop task v1 dispatch {task_id} --plan plan.json --expected-version {body.expected_version} --dry-run --json"})

    @router.post("/tasks/{task_id}/review", response_model=Envelope)
    def task_review(task_id: str, body: TaskReview, request: Request, principal: Principal = Depends(identity)):
        require(principal, "approve")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        result = delivery.review(principal, workspace, task_id, body, trace)
        return payload(principal, workspace, [result], trace=trace, summary={"dry_run": body.dry_run})

    @router.get("/agents/catalog", response_model=Envelope)
    def agent_catalog(request: Request, principal: Principal = Depends(identity)):
        require(principal, "read")
        return response(principal, workspace_id(request, principal), agents.catalog(),
                        cli={"command": "sop agent catalog --json"})

    @router.post("/tasks/{task_id}/agent-dispatch", response_model=Envelope)
    def agent_dispatch(task_id: str, body: AgentDispatch, request: Request, principal: Principal = Depends(identity)):
        require(principal, "write")
        require(principal, "execute")
        workspace = workspace_id(request, principal)
        trace = uuid.uuid4().hex
        result = agents.dispatch(principal, workspace, task_id, body, trace, delivery)
        return payload(principal, workspace, [result], trace=trace, summary={"dry_run": body.dry_run},
                       cli={"command": f"sop task v1 delivery {task_id} --json"})

    @router.get("/{resource}", response_model=Envelope)
    def list_resources(resource: str, request: Request, q: str = "", status: str = "", kind: str = "",
                       limit: int = Query(100, ge=1, le=500), cursor: str = "", principal: Principal = Depends(identity)):
        require(principal, "read")
        if resource not in RESOURCES:
            raise CoreError("unknown_resource", "Unknown resource", 404)
        workspace = "" if resource == "workspaces" else workspace_id(request, principal)
        rows = store.list(principal, workspace, resource, q=q, status=status, kind_filter=kind, limit=limit, cursor=cursor)
        if resource == "workspaces" and principal.workspace_ids is not None:
            rows = [row for row in rows if row["id"] in principal.workspace_ids]
        return response(principal, workspace, rows, summary={"total": len(rows), "cursor": rows[-1]["id"] if len(rows) == limit else ""})

    def validate(resource, data, principal, workspace):
        if len(json.dumps(data)) > 1024 * 1024:
            raise CoreError("payload_too_large", "Resource exceeds 1 MiB", 413)
        if resource in {"agents", "squads"}:
            return agents.validate(principal, workspace, resource, data)
        if resource == "devices":
            if set(data) - {"title", "name", "platform"}:
                raise CoreError("server_owned_fields", "Device credentials and pairing are server-managed", 422)
            clean_title(resource, data)
        if resource in RESOURCE_STATUS_OPTIONS:
            validate_data_fields(resource, data)
            clean_title(resource, data)
            if "status" in data:
                validate_status(resource, str(data["status"]))
        if resource == "workspaces":
            if not str(data.get("name", "")).strip():
                raise CoreError("name_required", "Workspace name is required")
            if not isinstance(data.get("root"), str) or not data["root"].strip():
                raise CoreError("root_required", "Choose an explicit workspace directory")
            root = Path(data["root"]).expanduser().resolve()
            if not root.is_dir():
                raise CoreError("invalid_root", "Choose an existing workspace directory")
            execution.validate_root(root)
            data["root"] = str(root)
        if resource == "runs":
            if data.get("isolation", "workspace") != "workspace" or data.get("base_commit"):
                raise CoreError("task_dispatch_required", "Create isolated code runs through task dispatch", 422)
            raw = data.get("nodes", [])
            if not isinstance(raw, list) or not 1 <= len(raw) <= 64:
                raise CoreError("invalid_graph", "A run requires 1 to 64 execution nodes")
            nodes = [Node.model_validate(node) for node in raw]
            if len({node.id for node in nodes}) != len(nodes):
                raise CoreError("invalid_graph", "Node IDs must be unique")
            for node in nodes:
                if node.kind == "command" and (not node.argv or any("\x00" in arg for arg in node.argv)):
                    raise CoreError("invalid_command", "Command nodes require a valid argument list")
                if node.kind == "agent":
                    raise CoreError("task_dispatch_required", "Dispatch agents from a task with acceptance criteria", 422)
            data["nodes"] = [node.model_dump() for node in nodes]
            if data.get("target_device_id"):
                if not data.get("target_basis"):
                    raise CoreError("target_basis_required", "Review the current execution target before creating a remote run", 422)
                data["target_snapshot"] = select_execution_target(
                    store, execution, principal, workspace, target_kind="device",
                    target_device_id=data["target_device_id"], expected_basis=data["target_basis"])
                if not is_paired_device(store, principal, workspace, str(data["target_device_id"])):
                    raise CoreError("device_unpaired", "Pair an active device before remote execution", 409)
                if any(node.kind != "command" for node in nodes):
                    raise CoreError("remote_unsupported", "Remote runs require command nodes", 422)
            current_workspace = store.get(principal, "", "workspaces", workspace)
            data["workspace_root"] = current_workspace["data"]["root"]
            data["workspace_version"] = current_workspace["version"]
            session_id = data.get("session_id")
            if session_id:
                store.get(principal, workspace, "sessions", session_id)
        return data

    @router.post("/{resource}", status_code=201, response_model=Envelope)
    def create_resource(resource: str, body: Mutation, request: Request, principal: Principal = Depends(identity)):
        require(principal, "config" if resource in {"devices", "workspaces", "agents", "squads"} else "write")
        if resource not in RESOURCES or resource in {"approvals", "artifacts", "schedules"}:
            raise CoreError("unknown_resource", "Resource cannot be created directly", 404)
        workspace = "" if resource == "workspaces" else workspace_id(request, principal)
        if resource == "runs" and run_internal_fields.intersection(body.data):
            raise CoreError("server_owned_fields", "Run execution evidence and ownership are server-managed", 422)
        if resource == "runs" and "task_source" in body.data:
            raise CoreError("server_owned_fields", "Task provenance is managed by task dispatch", 422)
        data = validate(resource, dict(body.data), principal, workspace)
        if resource == "workspaces":
            data["owner"] = principal.actor
        status = "planned" if resource == "runs" else "active"
        if resource == "devices":
            status = "unpaired"
        if resource in {"agents", "squads"}:
            status = data.pop("status", "active")
        original_request = body.model_dump()
        if resource in RESOURCE_STATUS_OPTIONS and "status" in data:
            status = str(data.pop("status"))
        row = store.create(principal, workspace, resource, data, body.idempotency_key, uuid.uuid4().hex,
                           status=status, request=original_request)
        return response(principal, workspace, [row])

    @router.get("/{resource}/{entity_id}", response_model=Envelope)
    def detail(resource: str, entity_id: str, request: Request, principal: Principal = Depends(identity)):
        require(principal, "read")
        if resource not in RESOURCES:
            raise CoreError("unknown_resource", "Unknown resource", 404)
        workspace = "" if resource == "workspaces" else workspace_id(request, principal)
        if resource == "workspaces" and principal.workspace_ids is not None and entity_id not in principal.workspace_ids:
            raise CoreError("forbidden", "Workspace access denied", 403)
        return response(principal, workspace, [store.get(principal, workspace, resource, entity_id)])

    @router.patch("/{resource}/{entity_id}", response_model=Envelope)
    def patch(resource: str, entity_id: str, body: Mutation, request: Request, principal: Principal = Depends(identity)):
        require(principal, "config" if resource in {"devices", "workspaces", "agents", "squads"} else "write")
        if resource not in RESOURCES or resource in {"approvals", "artifacts", "devices", "schedules"}:
            raise CoreError("immutable_resource", "Use the dedicated resource action", 409)
        if body.expected_version is None:
            raise CoreError("version_required", "expected_version is required")
        workspace = "" if resource == "workspaces" else workspace_id(request, principal)

        if resource == "runs" and run_internal_fields.intersection(body.data):
            raise CoreError("server_owned_fields", "Run execution evidence and ownership are server-managed", 422)
        if (resource == "runs" and "task_source" in body.data) or (resource == "tasks" and "delivery" in body.data):
            raise CoreError("server_owned_fields", "Task delivery evidence is server-managed", 422)

        def transform(item):
            if resource == "tasks" and item["data"].get("delivery", {}).get("phase") in {"executing", "accepted"}:
                raise CoreError("delivery_active", "Dispatched and accepted tasks are immutable; request changes on an open delivery or create a follow-up task", 409)
            if resource == "tasks" and item["data"].get("delivery") and body.data.get("status") == "completed":
                raise CoreError("review_required", "Delivered tasks must be completed through evidence review", 409)
            if resource == "runs" and item["data"].get("task_source"):
                raise CoreError("immutable_run", "Task execution plans cannot be edited after dispatch", 409)
            if resource == "workspaces" and principal.workspace_ids is not None and entity_id not in principal.workspace_ids:
                raise CoreError("forbidden", "Workspace access denied", 403)
            if resource == "runs" and item["status"] != "planned":
                raise CoreError("immutable_run", "Running definitions cannot be edited", 409)
            if resource == "runs" and item["data"].get("target_snapshot") and any(
                field in body.data and body.data[field] != item["data"].get(field)
                for field in ("target_device_id", "target_basis")
            ):
                raise CoreError("immutable_target", "Create a newly reviewed plan to change the execution target", 409)
            if resource == "workspaces" and "owner" in body.data and body.data["owner"] != item["data"].get("owner"):
                raise CoreError("owner_immutable", "Ownership cannot be transferred through a generic update", 403)
            merged = {**item["data"], **body.data}
            link = merged.pop("delivery", None) if resource == "tasks" else None
            data = validate(resource, merged, principal, workspace)
            if link:
                data["delivery"] = link
            changes = {"data": data}
            if resource not in {"runs", "workspaces"} and "status" in body.data:
                changes["status"] = str(body.data["status"])
            return changes

        row = store.mutate(principal, workspace, resource, entity_id, operation=resource + ".updated",
            key=body.idempotency_key, request=body.model_dump(), trace=uuid.uuid4().hex,
            expected=body.expected_version, transform=transform)
        return response(principal, workspace, [row])

    @router.delete("/{resource}/{entity_id}", response_model=Envelope)
    def remove(resource: str, entity_id: str, body: RunAction, request: Request, principal: Principal = Depends(identity)):
        require(principal, "config" if resource == "devices" else "write")
        if resource not in {"assets"}:
            raise CoreError("unsupported_delete", "Resource cannot be deleted", 409)
        workspace = workspace_id(request, principal)
        if body.dry_run:
            item = store.get(principal, workspace, resource, entity_id)
            if item["version"] != body.expected_version:
                raise CoreError("version_conflict", "Resource changed; reload before preview", 409)
            return response(principal, workspace, [item], summary={"dry_run": True})
        row = store.mutate(principal, workspace, resource, entity_id, operation=resource + ".revoked",
            key=body.idempotency_key, request=body.model_dump(), trace=uuid.uuid4().hex,
            expected=body.expected_version, transform=lambda item: {"status": "revoked" if resource == "devices" else "archived"})
        return response(principal, workspace, [row])

    combined = APIRouter()
    combined.include_router(create_collaboration_router(store, identity, actor_directory=actor_directory))
    combined.include_router(create_remote_router(store, identity))
    combined.include_router(create_scheduling_router(store, execution, identity))
    combined.include_router(router)
    return combined


def install_errors(app):
    def error_payload(code, message):
        result = payload(Principal("", tenant="", business="", permissions=frozenset()), "", [], trace=uuid.uuid4().hex,
                         ok=False, error={"code": code, "message": message})
        result["actions"] = []
        return result

    @app.exception_handler(CoreError)
    async def core_error(_request, exc):
        return JSONResponse(status_code=exc.status, content=error_payload(exc.code, exc.message))

    @app.exception_handler(RequestValidationError)
    @app.exception_handler(ValidationError)
    async def validation_error(_request, exc):
        message = "; ".join(f"{'.'.join(map(str, issue['loc']))}: {issue['msg']}" for issue in exc.errors())[:2000]
        return JSONResponse(status_code=422, content=error_payload("validation_error", message))


def create_app(data_dir: Path, token: str, *, database_url: str = "", principals: dict[str, Principal] | None = None, agentd: str = ""):
    data_dir.mkdir(parents=True, exist_ok=True)
    store = Store(database_url or "sqlite:///" + str((data_dir / "workspace.sqlite").resolve()))
    execution = Execution(store, data_dir, agentd)
    credentials = principals if principals is not None else {token: Principal(actor="local-owner")}

    def identity(request: Request):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            raise CoreError("unauthorized", "Connect with a workspace access token", 401)
        for secret, principal in credentials.items():
            if secret and hmac.compare_digest(auth[7:], secret):
                return principal
        raise CoreError("unauthorized", "Workspace token is invalid", 401)

    def workspace_actor_directory(principal: Principal, workspace: str) -> list[str]:
        return sorted({
            candidate.actor
            for secret, candidate in credentials.items()
            if secret and candidate.actor
            and candidate.tenant == principal.tenant
            and candidate.business == principal.business
            and (candidate.workspace_ids is None or workspace in candidate.workspace_ids)
        })

    app = FastAPI(title="Hermes Workspace", version=__version__, lifespan=execution.lifespan)
    app.state.hermes_store, app.state.hermes_execution = store, execution
    app.add_middleware(CORSMiddleware, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:[0-9]+)?",
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type", "X-Workspace-Id"])
    install_errors(app)
    app.include_router(create_router(store, execution, identity, actor_directory=workspace_actor_directory))
    return app
