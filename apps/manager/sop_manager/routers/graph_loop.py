from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_ai_memory_root
from sop_manager.routers.productization_contract import now_iso, summarize_items, trace_id, unified_payload
from sop_manager.routers.scope_guard import attach_scope, current_scope, filter_scope

router = APIRouter(prefix="/api/v1/graph-loop", tags=["graph-loop"])

RunStatus = Literal["planned", "running", "interrupted", "retrying", "rolling_back", "completed", "archived", "failed"]
NodeStatus = Literal[
    "pending",
    "ready",
    "running",
    "blocked",
    "waiting_approval",
    "succeeded",
    "failed",
    "skipped",
    "rolled_back",
]
TransitionAction = Literal["start", "interrupt", "resume", "retry", "rollback", "complete", "archive", "fail"]

RUN_STATUSES = {"planned", "running", "interrupted", "retrying", "rolling_back", "completed", "archived", "failed"}
NODE_STATUSES = {
    "pending",
    "ready",
    "running",
    "blocked",
    "waiting_approval",
    "succeeded",
    "failed",
    "skipped",
    "rolled_back",
}
STATUS_BY_ACTION: dict[str, str] = {
    "start": "running",
    "interrupt": "interrupted",
    "resume": "running",
    "retry": "retrying",
    "rollback": "rolling_back",
    "complete": "completed",
    "archive": "archived",
    "fail": "failed",
}
NODE_STATUS_BY_ACTION: dict[str, str] = {
    "start": "running",
    "interrupt": "waiting_approval",
    "resume": "running",
    "retry": "running",
    "rollback": "rolled_back",
    "complete": "succeeded",
    "archive": "skipped",
    "fail": "failed",
}
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "planned": {"running", "interrupted", "archived", "failed"},
    "running": {"interrupted", "retrying", "rolling_back", "completed", "failed", "archived"},
    "interrupted": {"running", "rolling_back", "failed", "archived"},
    "retrying": {"running", "interrupted", "failed", "archived"},
    "rolling_back": {"running", "failed", "archived"},
    "completed": {"archived"},
    "failed": {"retrying", "rolling_back", "archived"},
    "archived": set(),
}


class GraphLoopPlanIn(BaseModel):
    goal: str = Field("Hermes/SOP AI-native delivery loop", min_length=1, max_length=500)
    mode: Literal["read", "dry-run", "apply"] = "dry-run"
    include_data: bool = True
    include_agent: bool = True
    include_human_review: bool = True
    quality_bar: Literal["standard", "strict", "release"] = "strict"
    owner: str = Field("GraphLoop Agent", max_length=120)


class GraphLoopRunActionIn(BaseModel):
    action: TransitionAction
    note: str = Field("", max_length=1000)
    actor: str = Field("GraphLoop Operator", max_length=120)


class GraphLoopTransitionIn(GraphLoopRunActionIn):
    node_id: str = Field("", max_length=120)
    idempotency_key: str = Field("", max_length=160)


class GraphLoopInterruptDecisionIn(BaseModel):
    decision: Literal["approve", "edit", "reject"]
    actor: str = Field("GraphLoop Approver", max_length=120)
    note: str = Field("", max_length=1000)
    edited_payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field("", max_length=160)


class GraphLoopReplayIn(BaseModel):
    mode: Literal["dry-run", "apply"] = "dry-run"
    actor: str = Field("GraphLoop Operator", max_length=120)
    note: str = Field("", max_length=1000)
    idempotency_key: str = Field("", max_length=160)


class GraphLoopExportIn(BaseModel):
    format: Literal["json"] = "json"
    include_events: bool = True
    actor: str = Field("GraphLoop Operator", max_length=120)


def _runs_path() -> Path:
    path = resolved_ai_memory_root() / "graph_loop_runs.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


class GraphLoopStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or _runs_path()

    def diagnostics(self) -> dict[str, Any]:
        records, bad_lines = self._raw_records_with_bad_lines()
        runs = self.list_runs(limit=200)
        return {
            "path": str(self.path),
            "exists": self.path.exists(),
            "raw_records": len(records),
            "bad_lines": bad_lines,
            "projected_runs": len(runs),
            "schema": {
                "run_statuses": sorted(RUN_STATUSES),
                "node_statuses": sorted(NODE_STATUSES),
                "store": "scoped-jsonl",
            },
        }

    def list_runs(self, *, limit: int = 50, include_archived: bool = True) -> list[dict[str, Any]]:
        records, _bad = self._raw_records_with_bad_lines()
        latest: dict[str, dict[str, Any]] = {}
        for item in filter_scope(records, require_business=True):
            run_id = str(item.get("run_id") or "")
            if not run_id:
                continue
            if not include_archived and item.get("status") == "archived":
                continue
            latest[run_id] = self._normalize_run(item)
        rows = sorted(latest.values(), key=lambda row: str(row.get("updated_at") or row.get("created_at") or ""), reverse=True)
        return rows[: max(1, min(limit, 200))]

    def get_run(self, run_id: str) -> dict[str, Any]:
        run = next((item for item in self.list_runs(limit=200) if str(item.get("run_id")) == run_id), None)
        if not run:
            raise HTTPException(404, "graph loop run not found in current scope")
        return run

    def append_snapshot(self, run: dict[str, Any], *, idempotency_key: str = "") -> dict[str, Any]:
        run = self._normalize_run(run)
        if idempotency_key:
            existing = self.find_by_idempotency(run["run_id"], idempotency_key)
            if existing:
                return existing
        row = attach_scope({**run}, overwrite=False)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        return row

    def find_by_idempotency(self, run_id: str, idempotency_key: str) -> dict[str, Any] | None:
        if not idempotency_key:
            return None
        for run in self.list_runs(limit=200):
            if str(run.get("run_id")) != run_id:
                continue
            for event in run.get("events") or []:
                if isinstance(event, dict) and event.get("idempotency_key") == idempotency_key:
                    return run
        return None

    def transition(self, run_id: str, body: GraphLoopTransitionIn) -> dict[str, Any]:
        existing = self.find_by_idempotency(run_id, body.idempotency_key)
        if existing:
            return existing
        base = self.get_run(run_id)
        next_status = STATUS_BY_ACTION[body.action]
        current_status = str(base.get("status") or "planned")
        if next_status not in ALLOWED_TRANSITIONS.get(current_status, set()):
            raise HTTPException(409, f"illegal graph-loop transition: {current_status} -> {next_status}")
        event = _event(body.action, actor=body.actor, note=body.note, idempotency_key=body.idempotency_key, node_id=body.node_id)
        nodes = _transition_nodes(base.get("nodes") or [], body.action, body.node_id)
        interrupts = list(base.get("interrupts") or [])
        if body.action == "interrupt":
            interrupt_id = f"int-{uuid.uuid4().hex[:10]}"
            event["interrupt_id"] = interrupt_id
            interrupts.append(
                {
                    "id": interrupt_id,
                    "status": "pending",
                    "node_id": body.node_id or _active_node_id(nodes),
                    "reason": body.note or "Sensitive action requires human review",
                    "allowed_decisions": ["approve", "edit", "reject"],
                    "created_at": now_iso(),
                    "created_by": body.actor,
                }
            )
        updated = {
            **base,
            "status": next_status,
            "nodes": nodes,
            "interrupts": interrupts,
            "updated_at": now_iso(),
            "events": [*(base.get("events") or []), event],
            "slo": _slo_for_run({**base, "status": next_status, "nodes": nodes, "interrupts": interrupts}),
        }
        return self.append_snapshot(updated, idempotency_key=body.idempotency_key)

    def decide_interrupt(self, run_id: str, interrupt_id: str, body: GraphLoopInterruptDecisionIn) -> dict[str, Any]:
        existing = self.find_by_idempotency(run_id, body.idempotency_key)
        if existing:
            return existing
        base = self.get_run(run_id)
        interrupts = list(base.get("interrupts") or [])
        interrupt = next((item for item in interrupts if str(item.get("id")) == interrupt_id), None)
        if not interrupt:
            raise HTTPException(404, "graph loop interrupt not found")
        if str(interrupt.get("status")) != "pending":
            raise HTTPException(409, "graph loop interrupt already decided")
        interrupt.update(
            {
                "status": "decided",
                "decision": body.decision,
                "decided_at": now_iso(),
                "decided_by": body.actor,
                "note": body.note,
                "edited_payload": body.edited_payload,
            }
        )
        next_status = "running" if body.decision in {"approve", "edit"} else "failed"
        nodes = _transition_nodes(base.get("nodes") or [], "resume" if next_status == "running" else "fail", str(interrupt.get("node_id") or ""))
        event = _event(
            f"interrupt_{body.decision}",
            actor=body.actor,
            note=body.note,
            idempotency_key=body.idempotency_key,
            interrupt_id=interrupt_id,
            payload=body.edited_payload,
        )
        updated = {
            **base,
            "status": next_status,
            "nodes": nodes,
            "interrupts": interrupts,
            "updated_at": now_iso(),
            "events": [*(base.get("events") or []), event],
        }
        updated["slo"] = _slo_for_run(updated)
        return self.append_snapshot(updated, idempotency_key=body.idempotency_key)

    def _raw_records_with_bad_lines(self) -> tuple[list[dict[str, Any]], int]:
        if not self.path.exists():
            return [], 0
        rows: list[dict[str, Any]] = []
        bad_lines = 0
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                bad_lines += 1
                continue
            if isinstance(item, dict):
                rows.append(item)
            else:
                bad_lines += 1
        return rows, bad_lines

    @staticmethod
    def _normalize_run(run: dict[str, Any]) -> dict[str, Any]:
        status = str(run.get("status") or "planned")
        if status not in RUN_STATUSES:
            status = "failed"
        nodes = [node for node in run.get("nodes") or [] if isinstance(node, dict)]
        if nodes:
            normalized_nodes = []
            for node in nodes:
                node_status = str(node.get("status") or node.get("state") or "pending")
                normalized_nodes.append({**node, "status": node_status if node_status in NODE_STATUSES else "blocked"})
            nodes = normalized_nodes
        return {
            **run,
            "run_id": str(run.get("run_id") or f"gl-{uuid.uuid4().hex[:12]}"),
            "status": status,
            "nodes": nodes,
            "edges": [edge for edge in run.get("edges") or [] if isinstance(edge, dict)],
            "events": [event for event in run.get("events") or [] if isinstance(event, dict)],
            "interrupts": [item for item in run.get("interrupts") or [] if isinstance(item, dict)],
        }


def get_graph_loop_store() -> GraphLoopStore:
    return GraphLoopStore()


def _graph_nodes(body: GraphLoopPlanIn) -> list[dict[str, Any]]:
    nodes = [
        {
            "id": "requirement_intake",
            "label": "需求与上下文接入",
            "type": "human-in-loop",
            "status": "ready",
            "inputs": ["requirements", "current page filters", "memory/kb context"],
            "outputs": ["acceptance criteria", "scope packet"],
            "quality_gate": "需求、范围、权限和审计字段完整",
            "agent_consumption": ["requirements", "memory", "kb", "page_filters"],
        },
        {
            "id": "tdd_plan",
            "label": "TDD 测试先行",
            "type": "quality",
            "status": "pending",
            "inputs": ["acceptance criteria"],
            "outputs": ["red tests", "test commands", "coverage target"],
            "quality_gate": "Red-Green-Refactor 计划可执行",
            "agent_consumption": ["test_plan", "quality_bar"],
        },
        {
            "id": "implementation_agent",
            "label": "Agent 执行包",
            "type": "agent",
            "status": "blocked" if not body.include_agent else "pending",
            "inputs": ["task claim", "tools", "guardrails", "handoff contract"],
            "outputs": ["patch", "evidence", "heartbeat"],
            "quality_gate": "工具白名单、权限、trace、usage 记录完整",
            "agent_consumption": ["task_agent_plan", "agent_runs", "a2a_dispatch"],
        },
        {
            "id": "quality_gate",
            "label": "质量门禁",
            "type": "guardrail",
            "status": "pending",
            "inputs": ["tests", "lint", "typecheck", "scope scan", "review notes"],
            "outputs": ["quality report", "release decision"],
            "quality_gate": f"{body.quality_bar} gate pass or explicit blocker",
            "agent_consumption": ["quality_reports", "readiness_gate", "review"],
        },
        {
            "id": "release_readiness",
            "label": "全域 Readiness",
            "type": "temporal",
            "status": "pending",
            "inputs": ["backend", "frontend", "CLI", "SDK", "permissions", "scripts"],
            "outputs": ["readiness snapshot", "runbook", "rollback note"],
            "quality_gate": "sop system readiness --full --json 可执行",
            "agent_consumption": ["make full-readiness", "sop system readiness"],
        },
        {
            "id": "retrospective_memory",
            "label": "复盘蒸馏与记忆",
            "type": "memory",
            "status": "pending",
            "inputs": ["audit evidence", "quality report", "operator decision"],
            "outputs": ["memory note", "kb facts", "agent consumption packet"],
            "quality_gate": "可追溯、可检索、可复用",
            "agent_consumption": ["memory", "kb", "copilot_context"],
        },
    ]
    if body.include_data:
        nodes.insert(
            4,
            {
                "id": "data_evidence",
                "label": "数据与指标证据",
                "type": "data",
                "status": "pending",
                "inputs": ["SQL/Python/Shell jobs", "lineage", "quality rules"],
                "outputs": ["dataset evidence", "metric definitions", "RCA hints"],
                "quality_gate": "数据源、口径、血缘、治理任务可追溯",
                "agent_consumption": ["data_quality", "lineage", "metrics", "reports"],
            },
        )
    if body.include_human_review:
        nodes.insert(
            3,
            {
                "id": "human_interrupt",
                "label": "人审 Interrupt",
                "type": "approval",
                "status": "pending",
                "inputs": ["diff risk", "sensitive action", "module policy"],
                "outputs": ["approve/edit/reject/resume signal"],
                "quality_gate": "敏感动作按 action policy 审批",
                "agent_consumption": ["module_action_policy", "approval", "audit"],
            },
        )
    return nodes


def _edges(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": f"{nodes[index]['id']}->{nodes[index + 1]['id']}",
            "source": nodes[index]["id"],
            "target": nodes[index + 1]["id"],
            "condition": "previous gate passed or approved interrupt",
        }
        for index in range(len(nodes) - 1)
    ]


def _new_run(body: GraphLoopPlanIn) -> dict[str, Any]:
    nodes = _graph_nodes(body)
    if body.mode == "apply":
        nodes[0]["status"] = "running"
    edges = _edges(nodes)
    run = {
        "run_id": f"gl-{uuid.uuid4().hex[:12]}",
        "goal": body.goal,
        "status": "planned" if body.mode != "apply" else "running",
        "mode": body.mode,
        "owner": body.owner,
        "quality_bar": body.quality_bar,
        "nodes": nodes,
        "edges": edges,
        "interrupts": [],
        "links": _default_links(),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "events": [_event("created", actor=body.owner, note=f"mode={body.mode}")],
    }
    run["slo"] = _slo_for_run(run)
    return run


def _default_links() -> dict[str, Any]:
    return {
        "tasks": {
            "read": "sop work export --json",
            "agent_plan": "sop task agent-plan <task_id> --json",
            "scheduler": "sop task schedule-runs --json",
            "runbook": "sop task schedule-runbook --json",
        },
        "agent": {
            "runs": "sop platforms agent-runs --json",
            "slo": "sop platforms agent-slo --json",
            "rebalance": "sop platforms agent-rebalance-tasks --dry-run --json",
        },
        "data": {
            "quality": "sop data quality summary --json",
            "lineage": "sop analytics lineage --json",
            "reports": "sop analytics reports --json",
        },
        "memory": {
            "write": "sop memory add --kind graph-loop",
            "kb": "sop kb add --kind runbook",
        },
    }


def _event(name: str, **fields: Any) -> dict[str, Any]:
    return {
        "id": f"evt-{uuid.uuid4().hex[:12]}",
        "event": name,
        "at": now_iso(),
        "trace_id": trace_id(),
        **{key: value for key, value in fields.items() if value not in (None, "")},
    }


def _active_node_id(nodes: list[dict[str, Any]]) -> str:
    for status in ("running", "waiting_approval", "ready"):
        for node in nodes:
            if node.get("status") == status:
                return str(node.get("id") or "")
    return str(nodes[0].get("id") or "") if nodes else ""


def _transition_nodes(nodes: list[dict[str, Any]], action: str, node_id: str = "") -> list[dict[str, Any]]:
    if not nodes:
        return nodes
    target = node_id or _active_node_id(nodes)
    next_node_status = NODE_STATUS_BY_ACTION.get(action, "blocked")
    updated: list[dict[str, Any]] = []
    target_seen = False
    for node in nodes:
        if str(node.get("id")) == target:
            target_seen = True
            updated.append({**node, "status": next_node_status, "updated_at": now_iso()})
        else:
            updated.append(dict(node))
    if not target_seen:
        updated[0] = {**updated[0], "status": next_node_status, "updated_at": now_iso()}
    if action in {"complete", "resume", "start", "retry"}:
        for index, node in enumerate(updated):
            if node.get("status") == "succeeded" and index + 1 < len(updated) and updated[index + 1].get("status") == "pending":
                updated[index + 1] = {**updated[index + 1], "status": "ready", "updated_at": now_iso()}
                break
    if action == "rollback":
        updated = [
            {**node, "status": "rolled_back" if node.get("status") in {"running", "failed", "waiting_approval"} else node.get("status")}
            for node in updated
        ]
    return updated


def _slo_for_run(run: dict[str, Any]) -> dict[str, Any]:
    nodes = run.get("nodes") or []
    total = len(nodes)
    succeeded = sum(1 for node in nodes if node.get("status") == "succeeded")
    blocked = sum(1 for node in nodes if node.get("status") in {"blocked", "failed", "waiting_approval"})
    pending_interrupts = sum(1 for item in run.get("interrupts") or [] if item.get("status") == "pending")
    score = max(0, min(100, round((succeeded / max(1, total)) * 100 - blocked * 12 - pending_interrupts * 8)))
    status = "healthy" if score >= 80 else "watch" if score >= 55 else "risk"
    if run.get("status") in {"failed", "rolling_back"}:
        status = "risk"
    elif run.get("status") == "interrupted":
        status = "watch"
    return {
        "score": score,
        "status": status,
        "succeeded_nodes": succeeded,
        "blocked_nodes": blocked,
        "pending_interrupts": pending_interrupts,
        "dora": {
            "change_lead_time": "tracked_by_task_and_run_events",
            "deployment_frequency": "tracked_by_release_readiness_events",
            "failed_deployment_recovery_time": "tracked_by_rollback_events",
        },
        "otel": {"signals": ["traces", "metrics", "logs"], "trace_id": trace_id()},
    }


def _graph_payload(body: GraphLoopPlanIn, *, run: dict[str, Any] | None = None) -> dict[str, Any]:
    persisted = run or _new_run(body)
    items = persisted.get("nodes") or _graph_nodes(body)
    edges = persisted.get("edges") or _edges(items)
    item_summary = summarize_items(items)
    summary = {
        "ok": True,
        "run_id": persisted.get("run_id"),
        "goal": persisted.get("goal") or body.goal,
        "mode": body.mode,
        "status": persisted.get("status"),
        "nodes": len(items),
        "edges": len(edges),
        "quality_bar": persisted.get("quality_bar") or body.quality_bar,
        "slo": persisted.get("slo") or _slo_for_run(persisted),
        **item_summary,
    }
    return unified_payload(
        summary=summary,
        items=items,
        actions=_actions_for_run(str(summary["run_id"])),
        cli=_cli_for_run(str(summary["run_id"]), body.goal),
        permissions=_permissions(),
        audit={"event": "graph_loop_plan", "run_id": summary["run_id"], "persisted": bool(run), "store": str(_runs_path())},
        agent_consumption=_agent_consumption(items, edges, persisted),
        extra={"graph": {"nodes": items, "edges": edges}, "run": persisted},
    )


def _run_payload(run: dict[str, Any], *, event_name: str = "graph_loop_run_detail") -> dict[str, Any]:
    items = run.get("nodes") or []
    return unified_payload(
        summary={
            "ok": True,
            "run_id": run.get("run_id"),
            "goal": run.get("goal"),
            "status": run.get("status"),
            "nodes": len(items),
            "edges": len(run.get("edges") or []),
            "events": len(run.get("events") or []),
            "interrupts": len(run.get("interrupts") or []),
            "slo": run.get("slo") or _slo_for_run(run),
        },
        items=items,
        actions=_actions_for_run(str(run.get("run_id"))),
        cli=_cli_for_run(str(run.get("run_id")), str(run.get("goal") or "")),
        permissions=_permissions(),
        audit={"event": event_name, "run_id": run.get("run_id"), "store": str(_runs_path())},
        agent_consumption=_agent_consumption(items, run.get("edges") or [], run),
        extra={"graph": {"nodes": items, "edges": run.get("edges") or []}, "run": run},
    )


def _actions_for_run(run_id: str) -> list[dict[str, Any]]:
    return [
        {"id": "read", "label": "读取图与运行状态", "method": "GET", "path": "/api/v1/graph-loop/summary", "risk": "low"},
        {"id": "detail", "label": "查看运行详情", "method": "GET", "path": f"/api/v1/graph-loop/runs/{run_id}", "risk": "low"},
        {"id": "transition", "label": "执行状态流转", "method": "POST", "path": f"/api/v1/graph-loop/runs/{run_id}/transition", "risk": "medium"},
        {"id": "interrupt", "label": "人审中断与审批", "method": "POST", "path": f"/api/v1/graph-loop/runs/{run_id}/interrupts/{{interrupt_id}}/decision", "risk": "high"},
        {"id": "replay", "label": "回放运行", "method": "POST", "path": f"/api/v1/graph-loop/runs/{run_id}/replay", "risk": "medium"},
        {"id": "export", "label": "导出审计包", "method": "POST", "path": f"/api/v1/graph-loop/runs/{run_id}/export", "risk": "low"},
    ]


def _cli_for_run(run_id: str, goal: str) -> list[dict[str, str]]:
    quoted_goal = json.dumps(goal or "Hermes/SOP AI-native delivery loop", ensure_ascii=False)
    return [
        {"id": "read", "command": "sop graph-loop summary --json"},
        {"id": "runs", "command": "sop graph-loop runs --json"},
        {"id": "detail", "command": f"sop graph-loop detail {run_id} --json"},
        {"id": "events", "command": f"sop graph-loop events {run_id} --json"},
        {"id": "dry-run", "command": f"sop graph-loop plan --goal {quoted_goal} --json"},
        {"id": "apply", "command": f"sop graph-loop run --goal {quoted_goal} --apply --json"},
        {"id": "transition", "command": f"sop graph-loop transition {run_id} start --json"},
        {"id": "replay", "command": f"sop graph-loop replay {run_id} --dry-run --json"},
        {"id": "export", "command": f"sop graph-loop export {run_id} --json"},
        {"id": "doctor", "command": "sop graph-loop doctor --json"},
    ]


def _permissions() -> list[dict[str, Any]]:
    return [
        {"capability": "governance.graph-loop", "actions": ["read", "write", "execute", "approve", "export", "config"]},
        {"capability": "delivery.tasks", "actions": ["read", "write", "execute"]},
        {"capability": "delivery.task-scheduler", "actions": ["read", "execute"]},
        {"capability": "platform.agent-runs", "actions": ["read", "execute"]},
        {"capability": "data.governance", "actions": ["read", "execute"]},
        {"capability": "ecosystem.plugins", "actions": ["read", "execute", "approve", "configure"]},
    ]


def _agent_consumption(nodes: list[dict[str, Any]], edges: list[dict[str, Any]], run: dict[str, Any]) -> dict[str, Any]:
    return {
        "purpose": "Durable Graph Loop for requirement intake, TDD, agent execution, human review, quality gates, data evidence, scheduling, release readiness and memory distillation.",
        "run_id": run.get("run_id"),
        "graph": {"nodes": nodes, "edges": edges},
        "handoffs": ["Planner -> Executor", "Executor -> Verifier", "Verifier -> Operator", "Operator -> Memory"],
        "guardrails": ["scope_guard", "capability policy", "action policy", "quality gate", "human interrupt"],
        "linked_control_planes": ["tasks", "agent_runs", "task_scheduler", "data_quality", "lineage", "reports", "memory", "kb", "plugins"],
        "trace_id": trace_id(),
    }


@router.get("/summary")
def graph_loop_summary() -> dict[str, Any]:
    store = get_graph_loop_store()
    runs = store.list_runs(limit=20)
    payload = _graph_payload(GraphLoopPlanIn(mode="read"))
    status_counts: dict[str, int] = {}
    slo_counts: dict[str, int] = {}
    for run in runs:
        status = str(run.get("status") or "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
        slo_status = str((run.get("slo") or {}).get("status") or "unknown")
        slo_counts[slo_status] = slo_counts.get(slo_status, 0) + 1
    payload["summary"] = {
        **payload["summary"],
        "persisted_runs": len(runs),
        "status_counts": status_counts,
        "slo_counts": slo_counts,
        "scope": current_scope(),
        "store": store.diagnostics(),
    }
    payload["recent_runs"] = runs[:8]
    return payload


@router.get("/slo")
def graph_loop_slo() -> dict[str, Any]:
    store = get_graph_loop_store()
    runs = store.list_runs(limit=200)
    items = [
        {
            "run_id": run.get("run_id"),
            "goal": run.get("goal"),
            "status": run.get("status"),
            "updated_at": run.get("updated_at"),
            **(run.get("slo") or _slo_for_run(run)),
        }
        for run in runs
    ]
    summary = summarize_items([{"status": item.get("status"), "ok": item.get("status") == "healthy"} for item in items])
    summary.update({"ok": True, "runs": len(runs), "scope": current_scope()})
    return unified_payload(
        summary=summary,
        items=items,
        actions=[{"id": "doctor", "label": "运行体检", "method": "GET", "path": "/api/v1/graph-loop/summary", "risk": "low"}],
        cli=[{"id": "slo", "command": "sop graph-loop slo --json"}, {"id": "doctor", "command": "sop graph-loop doctor --json"}],
        permissions=_permissions(),
        audit={"event": "graph_loop_slo", "store": str(_runs_path())},
        agent_consumption={"purpose": "Graph Loop SLO packet for agent rebalance, DORA tracking and operational recovery."},
    )


@router.get("/runs")
def graph_loop_runs(limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    store = get_graph_loop_store()
    runs = store.list_runs(limit=limit)
    return unified_payload(
        summary={"ok": True, "runs": len(runs), "scope": current_scope(), "store": store.diagnostics()},
        items=runs,
        actions=[
            {"id": "plan", "label": "生成新计划", "method": "POST", "path": "/api/v1/graph-loop/plan", "risk": "low"},
            {"id": "run", "label": "创建运行", "method": "POST", "path": "/api/v1/graph-loop/runs", "risk": "medium"},
        ],
        cli=[{"id": "runs", "command": f"sop graph-loop runs --limit {limit} --json"}, {"id": "plan", "command": "sop graph-loop plan --json"}],
        permissions=_permissions(),
        audit={"event": "graph_loop_runs", "store": str(_runs_path())},
        agent_consumption={"purpose": "Read scoped Graph Loop run ledger for scheduler, agent rebalance and recovery."},
    )


@router.post("/plan")
def graph_loop_plan(body: GraphLoopPlanIn) -> dict[str, Any]:
    return _graph_payload(body)


@router.post("/runs")
def graph_loop_run(body: GraphLoopPlanIn) -> dict[str, Any]:
    run = get_graph_loop_store().append_snapshot(_new_run(body))
    return _graph_payload(body, run=run)


@router.get("/runs/{run_id}")
def graph_loop_run_detail(run_id: str) -> dict[str, Any]:
    return _run_payload(get_graph_loop_store().get_run(run_id))


@router.get("/runs/{run_id}/events")
def graph_loop_run_events(run_id: str) -> dict[str, Any]:
    run = get_graph_loop_store().get_run(run_id)
    events = run.get("events") or []
    return unified_payload(
        summary={"ok": True, "run_id": run_id, "events": len(events), "status": run.get("status")},
        items=events,
        actions=_actions_for_run(run_id),
        cli=[{"id": "events", "command": f"sop graph-loop events {run_id} --json"}],
        permissions=_permissions(),
        audit={"event": "graph_loop_run_events", "run_id": run_id, "store": str(_runs_path())},
        agent_consumption={"purpose": "Append-only Graph Loop event history for replay, audit and RCA."},
    )


@router.get("/runs/{run_id}/slo")
def graph_loop_run_slo(run_id: str) -> dict[str, Any]:
    run = get_graph_loop_store().get_run(run_id)
    slo = run.get("slo") or _slo_for_run(run)
    return unified_payload(
        summary={"ok": True, "run_id": run_id, **slo},
        items=[slo],
        actions=_actions_for_run(run_id),
        cli=[{"id": "slo", "command": f"sop graph-loop slo --run-id {run_id} --json"}],
        permissions=_permissions(),
        audit={"event": "graph_loop_run_slo", "run_id": run_id, "store": str(_runs_path())},
        agent_consumption={"purpose": "Run-level SLO for Graph Loop recovery and agent rebalance decisions."},
    )


@router.post("/runs/{run_id}/action")
def graph_loop_run_action(run_id: str, body: GraphLoopRunActionIn) -> dict[str, Any]:
    transition = GraphLoopTransitionIn(action=body.action, note=body.note, actor=body.actor)
    return graph_loop_run_transition(run_id, transition)


@router.post("/runs/{run_id}/transition")
def graph_loop_run_transition(run_id: str, body: GraphLoopTransitionIn) -> dict[str, Any]:
    run = get_graph_loop_store().transition(run_id, body)
    return _run_payload(run, event_name="graph_loop_run_transition")


@router.post("/runs/{run_id}/interrupts/{interrupt_id}/decision")
def graph_loop_interrupt_decision(run_id: str, interrupt_id: str, body: GraphLoopInterruptDecisionIn) -> dict[str, Any]:
    run = get_graph_loop_store().decide_interrupt(run_id, interrupt_id, body)
    return _run_payload(run, event_name="graph_loop_interrupt_decision")


@router.post("/runs/{run_id}/replay")
def graph_loop_replay(run_id: str, body: GraphLoopReplayIn) -> dict[str, Any]:
    store = get_graph_loop_store()
    run = store.get_run(run_id)
    replay_events = [
        {"step": index + 1, "event": event.get("event"), "at": event.get("at"), "trace_id": event.get("trace_id")}
        for index, event in enumerate(run.get("events") or [])
    ]
    if body.mode == "apply":
        event = _event("replay", actor=body.actor, note=body.note, idempotency_key=body.idempotency_key, replayed_events=len(replay_events))
        run = store.append_snapshot({**run, "updated_at": now_iso(), "events": [*(run.get("events") or []), event]}, idempotency_key=body.idempotency_key)
    return unified_payload(
        summary={"ok": True, "run_id": run_id, "mode": body.mode, "events": len(replay_events), "status": run.get("status")},
        items=replay_events,
        actions=_actions_for_run(run_id),
        cli=[{"id": "replay", "command": f"sop graph-loop replay {run_id} --{body.mode} --json"}],
        permissions=_permissions(),
        audit={"event": "graph_loop_replay", "run_id": run_id, "mode": body.mode, "store": str(_runs_path())},
        agent_consumption={"purpose": "Replay Graph Loop durable event history before retry, rollback or audit export."},
        extra={"run": run},
    )


@router.post("/runs/{run_id}/export")
def graph_loop_export(run_id: str, body: GraphLoopExportIn) -> dict[str, Any]:
    run = get_graph_loop_store().get_run(run_id)
    export = {
        "kind": "graph_loop_audit_package",
        "run": run if body.include_events else {**run, "events": []},
        "scope": current_scope(),
        "permissions": _permissions(),
        "cli": _cli_for_run(run_id, str(run.get("goal") or "")),
        "exported_at": now_iso(),
        "exported_by": body.actor,
    }
    return unified_payload(
        summary={"ok": True, "run_id": run_id, "format": body.format, "include_events": body.include_events},
        items=[export],
        actions=_actions_for_run(run_id),
        cli=[{"id": "export", "command": f"sop graph-loop export {run_id} --json"}],
        permissions=_permissions(),
        audit={"event": "graph_loop_export", "run_id": run_id, "store": str(_runs_path())},
        agent_consumption={"purpose": "Portable Graph Loop audit evidence package for operator review, release readiness and memory distillation."},
        extra={"export": export},
    )
