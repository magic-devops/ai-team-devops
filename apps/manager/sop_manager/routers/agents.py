"""Agent 管理：定义、专家组、A2A 配置与标准接入 Profile。"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_ai_memory_root, resolved_project_id, resolved_tenant_id
from .tasks import TaskCreate, create_task

try:
    from .webhook import notify_webhook
except Exception:  # pragma: no cover - legacy import fallback
    notify_webhook = None

router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$")


def _agents_dir() -> Path:
    d = resolved_ai_memory_root() / "agents"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_id(value: str, label: str = "ID") -> str:
    v = (value or "").strip()
    if not _ID_RE.match(v):
        raise HTTPException(400, f"非法 {label}: {value}")
    return v


def _agent_path(agent_id: str) -> Path:
    return _agents_dir() / f"agent_{_safe_id(agent_id, 'Agent ID')}.json"


def _group_path(group_id: str) -> Path:
    return _agents_dir() / f"group_{_safe_id(group_id, 'Group ID')}.json"


def _agent_claims_path() -> Path:
    return resolved_ai_memory_root() / "task_agent_claims.json"


def _agent_reports_path() -> Path:
    return resolved_ai_memory_root() / "task_agent_reports.jsonl"


def _parse_dt(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None


def _minutes_since(value: Any) -> int | None:
    dt = _parse_dt(value)
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0, int((datetime.now(timezone.utc) - dt).total_seconds() // 60))


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else None
    except Exception:
        return None


def _read_jsonl(path: Path, limit: int = 5000) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except Exception:
            continue
        if isinstance(item, dict):
            rows.append(item)
    return rows[-limit:]


def _load_claim_rows() -> list[dict[str, Any]]:
    data = _read_json(_agent_claims_path()) or {}
    claims = data.get("claims") if isinstance(data.get("claims"), dict) else {}
    return [dict(row) for row in claims.values() if isinstance(row, dict)]


def _active_claim(row: dict[str, Any]) -> bool:
    status = str(row.get("status") or "")
    return status in {"claimed", "running", "heartbeat"}


def _agent_name(row: dict[str, Any]) -> str:
    return str(row.get("agent") or row.get("agent_id") or "unknown").strip() or "unknown"


def _run_rows(*, agent: str = "", status: str = "", limit: int = 100) -> list[dict[str, Any]]:
    claims = _load_claim_rows()
    reports = _read_jsonl(_agent_reports_path(), limit=5000)
    by_claim: dict[str, dict[str, Any]] = {}
    for row in claims:
        cid = str(row.get("claim_id") or "")
        if not cid:
            continue
        by_claim[cid] = {
            "id": cid,
            "kind": "claim",
            "agent": _agent_name(row),
            "task_id": row.get("task_id"),
            "claim_id": cid,
            "status": row.get("status") or "claimed",
            "progress": row.get("progress") or 0,
            "dev_tool": row.get("dev_tool") or "",
            "updated_at": row.get("updated_at") or row.get("claimed_at") or "",
            "lease_expires_at": row.get("lease_expires_at") or "",
            "summary": row.get("status_message") or row.get("note") or "",
            "source": "task-agent-claim",
            "active": _active_claim(row),
        }
    rows: list[dict[str, Any]] = list(by_claim.values())
    for row in reports:
        if row.get("type") == "heartbeat":
            cid = str(row.get("claim_id") or "")
            if cid and cid in by_claim:
                by_claim[cid]["last_heartbeat_at"] = row.get("created_at") or ""
                by_claim[cid]["heartbeat_message"] = row.get("status_message") or ""
            continue
        rows.append(
            {
                "id": row.get("id") or row.get("claim_id") or row.get("task_id"),
                "kind": "report",
                "agent": _agent_name(row),
                "task_id": row.get("task_id"),
                "claim_id": row.get("claim_id") or "",
                "status": row.get("status") or "reported",
                "progress": row.get("progress") or 0,
                "confidence": row.get("confidence"),
                "updated_at": row.get("created_at") or "",
                "summary": row.get("summary") or row.get("block_reason") or "",
                "quality_decision": (row.get("quality") or {}).get("decision") if isinstance(row.get("quality"), dict) else "",
                "failed_gates": row.get("failed_gates") or [],
                "artifact_url": row.get("artifact_url") or "",
                "artifact_path": row.get("artifact_path") or "",
                "source": "task-agent-report",
                "active": False,
            }
        )
    if agent:
        rows = [row for row in rows if _agent_name(row).lower() == agent.lower()]
    if status:
        rows = [row for row in rows if str(row.get("status") or "").lower() == status.lower()]
    rows.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    return rows[:limit]


def _run_summary() -> dict[str, Any]:
    agents = _list_agent_rows()
    claims = _load_claim_rows()
    reports = [row for row in _read_jsonl(_agent_reports_path(), limit=5000) if row.get("type") != "heartbeat"]
    active_claims = [row for row in claims if _active_claim(row)]
    per_agent: dict[str, dict[str, Any]] = {}
    for row in agents:
        aid = str(row.get("id") or "")
        if not aid:
            continue
        per_agent[aid] = {
            "agent": aid,
            "name": row.get("name") or aid,
            "role": row.get("role") or "",
            "enabled": bool(row.get("enabled", True)),
            "skills": row.get("skills") or [],
            "tools": row.get("tools") or [],
            "mcp_servers": row.get("mcp_servers") or [],
            "active_claims": 0,
            "reports": 0,
            "completed": 0,
            "blocked": 0,
            "success_rate": 0,
            "avg_progress": 0,
            "last_seen_at": "",
        }
    progress: dict[str, list[int]] = {}
    for row in claims:
        aid = _agent_name(row)
        per_agent.setdefault(aid, {"agent": aid, "name": aid, "role": "", "enabled": True, "skills": [], "tools": [], "mcp_servers": [], "active_claims": 0, "reports": 0, "completed": 0, "blocked": 0, "success_rate": 0, "avg_progress": 0, "last_seen_at": ""})
        if _active_claim(row):
            per_agent[aid]["active_claims"] += 1
        progress.setdefault(aid, []).append(int(row.get("progress") or 0))
        seen = str(row.get("updated_at") or row.get("claimed_at") or "")
        if seen > str(per_agent[aid].get("last_seen_at") or ""):
            per_agent[aid]["last_seen_at"] = seen
    for row in reports:
        aid = _agent_name(row)
        per_agent.setdefault(aid, {"agent": aid, "name": aid, "role": "", "enabled": True, "skills": [], "tools": [], "mcp_servers": [], "active_claims": 0, "reports": 0, "completed": 0, "blocked": 0, "success_rate": 0, "avg_progress": 0, "last_seen_at": ""})
        per_agent[aid]["reports"] += 1
        if str(row.get("status") or "").lower() == "completed":
            per_agent[aid]["completed"] += 1
        if str(row.get("status") or "").lower() in {"blocked", "failed", "error"}:
            per_agent[aid]["blocked"] += 1
        progress.setdefault(aid, []).append(int(row.get("progress") or 0))
        seen = str(row.get("created_at") or "")
        if seen > str(per_agent[aid].get("last_seen_at") or ""):
            per_agent[aid]["last_seen_at"] = seen
    for aid, item in per_agent.items():
        total = int(item.get("reports") or 0)
        item["success_rate"] = round((int(item.get("completed") or 0) / total) * 100, 1) if total else 0
        vals = progress.get(aid) or []
        item["avg_progress"] = round(sum(vals) / len(vals), 1) if vals else 0
    total_reports = len(reports)
    completed = sum(1 for row in reports if str(row.get("status") or "").lower() == "completed")
    blocked = sum(1 for row in reports if str(row.get("status") or "").lower() in {"blocked", "failed", "error"})
    return {
        "ok": True,
        "summary": {
            "registered_agents": len(agents),
            "enabled_agents": sum(1 for a in agents if a.get("enabled", True)),
            "active_claims": len(active_claims),
            "reports": total_reports,
            "completed": completed,
            "blocked": blocked,
            "success_rate": round((completed / total_reports) * 100, 1) if total_reports else 0,
        },
        "agents": sorted(per_agent.values(), key=lambda row: (-int(row.get("active_claims") or 0), str(row.get("agent") or ""))),
    }


def _dump_model(body: BaseModel) -> dict[str, Any]:
    try:
        return body.model_dump()
    except AttributeError:
        return body.dict()


def _emit(event: str, payload: dict[str, Any]) -> None:
    if notify_webhook is None:
        return
    try:
        notify_webhook(event, payload, tenant_id=resolved_tenant_id(), project_id=resolved_project_id())
    except Exception:
        pass


class AgentDef(BaseModel):
    id: str = Field(..., min_length=2, max_length=64)
    name: str = Field(..., min_length=1, max_length=120)
    role: str = Field(..., min_length=1, max_length=80)
    description: str = Field("", max_length=2000)
    model: str = "claude-opus-4-7"; port: Optional[int] = None
    skills: List[str] = Field(default_factory=list)
    specs_to_load: List[str] = Field(default_factory=list)
    tools: List[str] = Field(default_factory=lambda: ["sop-cli"])
    mcp_servers: List[str] = Field(default_factory=list)
    system_prompt: Optional[str] = Field("", max_length=12000)
    a2a_enabled: bool = False
    enabled: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)

class AgentGroup(BaseModel):
    id: str = Field(..., min_length=2, max_length=64)
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field("", max_length=2000)
    agents: List[str] = Field(default_factory=list)
    mode: str = Field("sequential", pattern="^(sequential|parallel|review-gate|swarm)$")
    entry_agent: Optional[str] = ""


class AgentRebalanceTasksIn(BaseModel):
    dry_run: bool = True
    priority: str = "P1"
    assigned_to: str = "Coder"
    categories: list[str] = Field(default_factory=list)


def _agent_slo_policy() -> dict[str, Any]:
    return {
        "max_active_claims_per_agent": 3,
        "min_success_rate": 70,
        "max_blocked_reports": 1,
        "max_heartbeat_lag_minutes": 30,
        "min_confidence": 0.65,
        "rebalance_mode": "advisory",
        "quality_gate": "blocked/failed/error reports require remediation task; overloaded agents should pause new claims.",
    }


def _agent_slo_payload() -> dict[str, Any]:
    policy = _agent_slo_policy()
    summary = _run_summary()
    runs = _run_rows(limit=500)
    agents = []
    recommendations: list[dict[str, Any]] = []
    stale_by_agent: dict[str, int] = {}
    for row in runs:
        if not row.get("active"):
            continue
        lag = _minutes_since(row.get("last_heartbeat_at") or row.get("updated_at"))
        if lag is not None and lag > int(policy["max_heartbeat_lag_minutes"]):
            agent = str(row.get("agent") or "unknown")
            stale_by_agent[agent] = max(stale_by_agent.get(agent, 0), lag)
    for row in summary.get("agents", []):
        agent = str(row.get("agent") or "unknown")
        active = int(row.get("active_claims") or 0)
        reports = int(row.get("reports") or 0)
        blocked = int(row.get("blocked") or 0)
        success = float(row.get("success_rate") or 0)
        stale = stale_by_agent.get(agent, 0)
        issues: list[str] = []
        score = 100
        if active > int(policy["max_active_claims_per_agent"]):
            issues.append("overloaded")
            score -= min(35, (active - int(policy["max_active_claims_per_agent"])) * 12)
        if reports and success < float(policy["min_success_rate"]):
            issues.append("low_success_rate")
            score -= min(30, int(float(policy["min_success_rate"]) - success))
        if blocked > int(policy["max_blocked_reports"]):
            issues.append("blocked_reports")
            score -= min(25, blocked * 8)
        if stale:
            issues.append("stale_heartbeat")
            score -= min(25, stale // 5)
        score = max(0, score)
        status = "healthy" if score >= 85 and not issues else "watch" if score >= 65 else "risk"
        agent_row = {
            **row,
            "slo_score": score,
            "slo_status": status,
            "issues": issues,
            "heartbeat_lag_minutes": stale,
        }
        agents.append(agent_row)
        if issues:
            recommendations.append(
                {
                    "id": f"agent-slo-{agent}",
                    "agent": agent,
                    "category": "agent_slo",
                    "severity": "high" if status == "risk" else "medium",
                    "title": f"Agent {agent} SLO 需要治理",
                    "summary": "、".join(issues),
                    "actions": [
                        "暂停该 Agent 新领取任务并检查最近 heartbeat/report。",
                        "将 ready 任务优先分配给健康 Agent 或人工复核。",
                        "针对 blocked/failed 报告生成修复任务并补齐质量证据。",
                    ],
                    "agent_packet": {
                        "agent": agent,
                        "slo_status": status,
                        "issues": issues,
                        "commands": [
                            f"sop platforms agent-runs --agent {agent}",
                            "sop task claims --status active",
                            "sop platforms agent-rebalance-tasks --apply",
                        ],
                    },
                }
            )
    healthy = sum(1 for row in agents if row.get("slo_status") == "healthy")
    risk = sum(1 for row in agents if row.get("slo_status") == "risk")
    watch = sum(1 for row in agents if row.get("slo_status") == "watch")
    return {
        "ok": True,
        "policy": policy,
        "summary": {
            **summary.get("summary", {}),
            "slo_score": round(sum(float(row.get("slo_score") or 0) for row in agents) / len(agents), 1) if agents else 100,
            "healthy_agents": healthy,
            "watch_agents": watch,
            "risk_agents": risk,
            "recommendations": len(recommendations),
        },
        "agents": sorted(agents, key=lambda row: (str(row.get("slo_status") == "healthy"), float(row.get("slo_score") or 0), str(row.get("agent") or ""))),
        "recommendations": recommendations,
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 判断自身是否可继续领取任务、是否需要再平衡或生成治理任务。",
            "api": "/api/v1/agents/runs/slo",
            "cli": "sop platforms agent-slo --json",
            "rebalance": "/api/v1/agents/runs/rebalance-tasks",
        },
    }


def _agent_rebalance_tasks(body: AgentRebalanceTasksIn) -> dict[str, Any]:
    slo = _agent_slo_payload()
    categories = set(body.categories or [])
    recommendations = [
        item for item in slo.get("recommendations", [])
        if not categories or str(item.get("category")) in categories or str(item.get("severity")) in categories
    ]
    planned: list[dict[str, Any]] = []
    created: list[dict[str, Any]] = []
    for item in recommendations:
        agent = str(item.get("agent") or "unknown")
        task = {
            "title": f"治理 Agent SLO 与任务再平衡：{agent}",
            "description": "\n".join([
                str(item.get("title") or ""),
                f"问题: {item.get('summary') or '-'}",
                "建议:",
                *[f"- {x}" for x in item.get("actions", [])],
                "",
                "Agent packet:",
                json.dumps(item.get("agent_packet") or {}, ensure_ascii=False, indent=2),
            ]),
            "priority": body.priority,
            "estimate": "S",
            "assigned_to": body.assigned_to or "Coder",
            "dev_tool": "sop-cli",
            "source": "agent_slo_rebalance",
            "source_report_id": str(item.get("id") or ""),
            "source_report_title": str(item.get("title") or ""),
            "debug_notes": "Generated from Agent SLO and rebalance control plane.",
        }
        planned.append(task)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**task)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "items": planned,
        "created": created,
        "summary": {
            "planned": len(planned),
            "created": len(created),
            "skipped": max(0, len(recommendations) - len(planned)),
            "slo_score": slo.get("summary", {}).get("slo_score", 0),
        },
    }


def _builtin_agent_defs() -> list[dict[str, Any]]:
    return [
        {"id":"orchestrator","name":"Orchestrator","role":"编排者","description":"任务分配、进度追踪、用户沟通","model":"claude-opus-4-7","skills":["SKILL-001"],"tools":["sop-cli","manager-api"],"mcp_servers":["tasks","knowledge"],"a2a_enabled":True,"port":8000},
        {"id":"planner","name":"Planner","role":"规划者","description":"需求分析、任务拆解、方案设计","model":"claude-opus-4-7","skills":["SKILL-001","SKILL-010"],"tools":["sop-cli"],"mcp_servers":["requirements","tasks","knowledge"],"a2a_enabled":True,"port":8001},
        {"id":"coder-backend","name":"Coder-Backend","role":"后端编码者","description":"服务端 API、数据模型、权限、同步与可靠性实现","model":"claude-opus-4-7","skills":["SKILL-002","SKILL-011"],"specs_to_load":["specs/backend/JAVA_SPEC.md"],"tools":["sop-cli","pytest","go-test"],"mcp_servers":["tasks","files","knowledge"],"a2a_enabled":True,"port":8002},
        {"id":"coder-frontend","name":"Coder-Frontend","role":"前端编码者","description":"React/Vue 管理端、组件化交互与可视化实现","model":"claude-opus-4-7","skills":["SKILL-002","SKILL-011"],"specs_to_load":["specs/frontend/FRONTEND_SPEC.md"],"tools":["sop-cli","pnpm","playwright"],"mcp_servers":["tasks","files","knowledge"],"a2a_enabled":True,"port":8003},
        {"id":"reviewer","name":"Reviewer","role":"审查者","description":"代码质量、安全、性能、可维护性和测试覆盖把关","model":"claude-opus-4-7","skills":["SKILL-003"],"tools":["sop-cli"],"mcp_servers":["audit","knowledge"],"a2a_enabled":True,"port":8004},
        {"id":"tester","name":"Tester","role":"测试者","description":"测试设计、自动化用例、回归验证与验收报告","model":"claude-opus-4-7","skills":["SKILL-004"],"tools":["sop-cli","pytest","playwright"],"mcp_servers":["tasks","files"],"a2a_enabled":True,"port":8005},
        {"id":"debugger","name":"Debugger","role":"调试者","description":"问题诊断、日志分析、补丁建议与修复验证","model":"claude-opus-4-7","skills":["SKILL-004","SKILL-010"],"tools":["sop-cli","logs"],"mcp_servers":["audit","files","knowledge"],"a2a_enabled":True,"port":8006},
    ]


def _list_agent_rows() -> list[dict[str, Any]]:
    agents = []
    for f in sorted(_agents_dir().glob("agent_*.json")):
        item = _read_json(f)
        if item:
            agents.append(item)
    return agents


def _list_group_rows() -> list[dict[str, Any]]:
    groups = []
    for f in sorted(_agents_dir().glob("group_*.json")):
        item = _read_json(f)
        if item:
            groups.append(item)
    return groups

@router.get("")
def list_agents():
    return _list_agent_rows()


@router.get("/summary")
def agents_summary():
    agents = _list_agent_rows()
    groups = _list_group_rows()
    models = sorted({str(a.get("model") or "") for a in agents if a.get("model")})
    skills = sorted({str(s) for a in agents for s in (a.get("skills") or []) if str(s)})
    tools = sorted({str(s) for a in agents for s in (a.get("tools") or []) if str(s)})
    mcp = sorted({str(s) for a in agents for s in (a.get("mcp_servers") or []) if str(s)})
    return {
        "ok": True,
        "agents": len(agents),
        "enabled": sum(1 for a in agents if a.get("enabled", True)),
        "a2a_enabled": sum(1 for a in agents if a.get("a2a_enabled")),
        "groups": len(groups),
        "models": models,
        "skills": skills,
        "tools": tools,
        "mcp_servers": mcp,
    }

@router.post("")
def create_agent(body: AgentDef):
    body.id = _safe_id(body.id, "Agent ID")
    f = _agent_path(body.id)
    f.write_text(json.dumps(_dump_model(body), ensure_ascii=False, indent=2), encoding="utf-8")
    _emit("agent.upserted", {"agent_id": body.id, "role": body.role})
    return {"ok": True, "id": body.id}

@router.put("/{agent_id}")
def update_agent(agent_id: str, body: AgentDef):
    agent_id = _safe_id(agent_id, "Agent ID")
    body.id = agent_id
    f = _agent_path(agent_id)
    f.write_text(json.dumps(_dump_model(body), ensure_ascii=False, indent=2), encoding="utf-8")
    _emit("agent.upserted", {"agent_id": agent_id, "role": body.role})
    return {"ok": True}

@router.delete("/{agent_id}")
def delete_agent(agent_id: str):
    agent_id = _safe_id(agent_id, "Agent ID")
    f = _agent_path(agent_id)
    if f.exists():
        f.unlink()
    _emit("agent.deleted", {"agent_id": agent_id})
    return {"ok": True}

@router.get("/groups")
def list_groups():
    return _list_group_rows()

@router.post("/groups")
def create_group(body: AgentGroup):
    body.id = _safe_id(body.id, "Group ID")
    body.agents = [_safe_id(a, "Agent ID") for a in body.agents]
    f = _group_path(body.id)
    f.write_text(json.dumps(_dump_model(body), ensure_ascii=False, indent=2), encoding="utf-8")
    _emit("agent.group_upserted", {"group_id": body.id, "agents": body.agents, "mode": body.mode})
    return {"ok": True, "id": body.id}


@router.delete("/groups/{group_id}")
def delete_group(group_id: str):
    group_id = _safe_id(group_id, "Group ID")
    f = _group_path(group_id)
    if f.exists():
        f.unlink()
    _emit("agent.group_deleted", {"group_id": group_id})
    return {"ok": True}

@router.get("/builtin")
def builtin_agents():
    """内置 Agent 角色定义"""
    return _builtin_agent_defs()


@router.post("/bootstrap-builtin")
def bootstrap_builtin(overwrite: bool = False):
    created: list[str] = []
    skipped: list[str] = []
    for item in _builtin_agent_defs():
        path = _agent_path(item["id"])
        if path.exists() and not overwrite:
            skipped.append(item["id"])
            continue
        path.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
        created.append(item["id"])
    group = AgentGroup(
        id="delivery-squad",
        name="Delivery Squad",
        description="需求、开发、测试、审查闭环专家组，适用于日常迭代交付。",
        agents=["orchestrator", "planner", "coder-backend", "coder-frontend", "tester", "reviewer"],
        mode="review-gate",
        entry_agent="orchestrator",
    )
    gpath = _group_path(group.id)
    if overwrite or not gpath.exists():
        gpath.write_text(json.dumps(_dump_model(group), ensure_ascii=False, indent=2), encoding="utf-8")
    _emit("agent.bootstrap_builtin", {"created": created, "skipped": skipped, "overwrite": overwrite})
    return {"ok": True, "created": created, "skipped": skipped, "group": group.id}


@router.get("/runs/summary")
def agent_runs_summary() -> dict[str, Any]:
    return _run_summary()


@router.get("/runs/slo")
def agent_runs_slo() -> dict[str, Any]:
    return _agent_slo_payload()


@router.post("/runs/rebalance-tasks")
def agent_runs_rebalance_tasks(body: AgentRebalanceTasksIn) -> dict[str, Any]:
    return _agent_rebalance_tasks(body)


@router.get("/runs")
def agent_runs(
    agent: str = Query("", description="Agent ID/name"),
    status: str = Query("", description="状态筛选"),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    agent_value = agent if isinstance(agent, str) else ""
    status_value = status if isinstance(status, str) else ""
    limit_value = limit if isinstance(limit, int) else 100
    return {
        "ok": True,
        "items": _run_rows(agent=agent_value, status=status_value, limit=limit_value),
        "total": len(_run_rows(agent=agent_value, status=status_value, limit=500)),
    }


@router.get("/{agent_id}/profile")
def agent_profile(agent_id: str):
    agent_id = _safe_id(agent_id, "Agent ID")
    item = _read_json(_agent_path(agent_id))
    if not item:
        raise HTTPException(404, "Agent 不存在")
    env = {
        "SOP_TENANT_ID": resolved_tenant_id(),
        "SOP_PROJECT_ID": resolved_project_id(),
        "SOP_AGENT_ID": agent_id,
        "SOP_AGENT_ROLE": str(item.get("role") or ""),
    }
    profile = {
        "schema": "sop.agent-profile.v1",
        "agent": item,
        "env": env,
        "commands": {
            "prepare_context": "sop context prepare --flush",
            "work_next": "sop work next --json",
            "sync_flush": "sop sync flush",
            "emit_event": f"sop event emit agent.{agent_id}.heartbeat --source agent/{agent_id}",
        },
        "mcp": {
            "servers": item.get("mcp_servers") or [],
            "hint": "Agent 启动时按 mcp_servers 装配工具；缺失服务从 Marketplace / MCP Hub 安装。",
        },
        "a2a": {
            "enabled": bool(item.get("a2a_enabled")),
            "endpoint": f"http://127.0.0.1:{item.get('port')}/a2a" if item.get("port") else "",
            "protocol": "json-rpc-over-http",
        },
        "guardrails": [
            "先读取 .sop-runtime/agent_context.json 与项目规则，再执行开发任务。",
            "写入需求、任务、问题、记忆、知识和事件时优先使用 sop CLI，离线时进入 outbox。",
            "不得输出或持久化明文密钥；Provider/API Key 仅使用 SecretRef 或本地环境变量。",
        ],
    }
    return {"ok": True, "profile": profile}
