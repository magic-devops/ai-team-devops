"""系统运维配置：环境 Profile、部署模式与运行时自检。"""
from __future__ import annotations

from sop_manager.project_write_guard import project_file_write_scope

import hashlib
import json
import os
import uuid

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from sop_manager.db import oceanbase_migration_plan, oceanbase_migration_smoke
from sop_manager.routers.metrics import current_trace_context
from sop_manager.routers.auth_sql import current_user, require_role

router = APIRouter(prefix="/api/v1/system/ops", tags=["system-ops"])


class EnvProfileIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    mode: str = Field("single", pattern="^(single|saas|local|private)$")
    database: str = Field("sqlite", pattern="^(sqlite|postgresql|mysql|oceanbase)$")
    manager_url: str = ""
    public_url: str = ""
    features: dict[str, bool] = Field(default_factory=dict)
    env: dict[str, str] = Field(default_factory=dict)
    notes: str = ""


class DeploymentPackageIn(BaseModel):
    version: str = ""
    channel: str = Field("manual", pattern="^(manual|staging|production|rollback)$")
    release_notes: str = ""
    created_by: str = "ops-admin"


def _runtime_dir() -> Path:
    return Path(os.getenv("SOP_RUNTIME_DIR", ".sop-runtime")).resolve()


def _log_dir() -> Path:
    return Path(os.getenv("LOG_DIR", Path(os.getenv("PROJECT_PATH", ".")) / "logs")).resolve()


def _profiles_path() -> Path:
    return _runtime_dir() / "env-profiles.json"


def _deployment_packages_path() -> Path:
    return _runtime_dir() / "deploy" / "deployment-packages.json"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_name(name: str) -> str:
    out = "".join(c for c in name.strip().lower() if c.isalnum() or c in "-_")[:64]
    if not out:
        raise HTTPException(400, "profile 名称不能为空")
    return out


def _safe_version(value: str) -> str:
    out = "".join(c for c in value.strip().lower() if c.isalnum() or c in "-_.")[:80]
    if not out:
        out = datetime.now(timezone.utc).strftime("v%Y%m%d.%H%M%S")
    return out


def _load() -> dict[str, Any]:
    path = _profiles_path()
    if not path.is_file():
        return {"active": "local-dev", "profiles": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"active": "local-dev", "profiles": {}}
    except Exception:
        return {"active": "local-dev", "profiles": {}}


def _save(data: dict[str, Any]) -> None:
    with project_file_write_scope():
        path = _profiles_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _load_deployment_packages() -> dict[str, Any]:
    path = _deployment_packages_path()
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"items": []}
    except Exception:
        return {"items": []}


def _save_deployment_packages(data: dict[str, Any]) -> None:
    with project_file_write_scope():
        path = _deployment_packages_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _audit_change(action: str, profile: str, details: dict[str, Any]) -> None:
    try:
        from sop_manager.routers.audit_chain import append_audit

        append_audit(
            action,
            resource_type="system_ops_profile",
            resource_id=profile,
            details=details,
        )
    except Exception:
        pass


def _templates() -> list[dict[str, Any]]:
    return [
        {
            "name": "local-dev",
            "mode": "local",
            "database": "sqlite",
            "manager_url": "http://localhost:8765",
            "public_url": "http://localhost:8765",
            "features": {"billing": False, "sso": False, "worker": False, "temporal": False},
            "env": {"ADMIN_MODE": "single", "DB_TYPE": "sqlite", "WORKFLOW_ENGINE": "memory"},
            "notes": "本地开发和单项目演示。",
        },
        {
            "name": "saas-pg",
            "mode": "saas",
            "database": "postgresql",
            "manager_url": "https://manager.example.com",
            "public_url": "https://manager.example.com",
            "features": {"billing": True, "sso": True, "worker": True, "temporal": True},
            "env": {"ADMIN_MODE": "saas", "DB_TYPE": "postgresql", "WORKFLOW_ENGINE": "temporal"},
            "notes": "SaaS 多租户标准部署模板。",
        },
        {
            "name": "private-oceanbase",
            "mode": "private",
            "database": "oceanbase",
            "manager_url": "https://sop.internal",
            "public_url": "https://sop.internal",
            "features": {"billing": True, "sso": True, "worker": True, "temporal": True, "audit_worm": True},
            "env": {"ADMIN_MODE": "saas", "DB_TYPE": "oceanbase", "WORKFLOW_ENGINE": "temporal"},
            "notes": "企业私有化和 OceanBase 场景。",
        },
    ]


def _is_secret_key(key: str) -> bool:
    k = key.lower()
    return any(x in k for x in ("secret", "password", "token", "key"))


def _mask_env(env: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in env.items():
        text = str(value)
        out[str(key)] = "***" if _is_secret_key(str(key)) and text else text
    return out


def _merge_profiles() -> dict[str, dict[str, Any]]:
    data = _load()
    profiles = data.get("profiles", {}) if isinstance(data.get("profiles"), dict) else {}
    merged = {x["name"]: x for x in _templates()}
    merged.update(profiles)
    return merged


def _public_profile(name: str, row: dict[str, Any], active: str) -> dict[str, Any]:
    return {
        "name": name,
        "mode": row.get("mode", "single"),
        "database": row.get("database", "sqlite"),
        "manager_url": row.get("manager_url", ""),
        "public_url": row.get("public_url", ""),
        "features": row.get("features", {}),
        "env": _mask_env(row.get("env", {}) if isinstance(row.get("env"), dict) else {}),
        "notes": row.get("notes", ""),
        "active": name == active,
        "updated_at": row.get("updated_at", ""),
    }


def _effective_env() -> dict[str, str]:
    keys = [
        "ADMIN_MODE", "DB_TYPE", "DATABASE_URL", "PROJECT_ID", "TENANT_ID",
        "MANAGER_PUBLIC_URL", "WORKFLOW_ENGINE", "TEMPORAL_HOST", "REDIS_URL",
        "MEMORY_BACKEND", "SOP_RUNTIME_DIR", "LANCE_DB_PATH",
    ]
    return {k: os.getenv(k, "") for k in keys if os.getenv(k, "")}


def _compose_override(profile: str, row: dict[str, Any]) -> str:
    env = row.get("env", {}) if isinstance(row.get("env"), dict) else {}
    features = row.get("features", {}) if isinstance(row.get("features"), dict) else {}
    lines = [
        "# Generated by SOP Manager system ops profile",
        f"# profile: {profile}",
        "services:",
        "  manager:",
        "    environment:",
    ]
    for key, value in sorted(env.items()):
        lines.append(f"      {key}: {json.dumps(str(value), ensure_ascii=False)}")
    if row.get("manager_url"):
        lines.append(f"      MANAGER_URL: {json.dumps(str(row.get('manager_url')), ensure_ascii=False)}")
    if row.get("public_url"):
        lines.append(f"      MANAGER_PUBLIC_URL: {json.dumps(str(row.get('public_url')), ensure_ascii=False)}")
    if features.get("worker"):
        lines.extend([
            "  worker:",
            "    environment:",
            f"      WORKER_PROFILE: {json.dumps(profile, ensure_ascii=False)}",
        ])
    if features.get("temporal"):
        lines.extend([
            "  temporal:",
            "    profiles:",
            "      - temporal",
        ])
    return "\n".join(lines) + "\n"


def _env_shell(profile: str, row: dict[str, Any]) -> str:
    env = row.get("env", {}) if isinstance(row.get("env"), dict) else {}
    merged = dict(env)
    if row.get("manager_url"):
        merged["MANAGER_URL"] = str(row.get("manager_url"))
    if row.get("public_url"):
        merged["MANAGER_PUBLIC_URL"] = str(row.get("public_url"))
    return "\n".join(f"export {k}={json.dumps(str(v), ensure_ascii=False)}" for k, v in sorted(merged.items()))


def _masked_env_shell(profile: str, row: dict[str, Any]) -> str:
    env = row.get("env", {}) if isinstance(row.get("env"), dict) else {}
    merged = dict(env)
    if row.get("manager_url"):
        merged["MANAGER_URL"] = str(row.get("manager_url"))
    if row.get("public_url"):
        merged["MANAGER_PUBLIC_URL"] = str(row.get("public_url"))
    return "\n".join(f"export {k}={json.dumps(str(v), ensure_ascii=False)}" for k, v in sorted(_mask_env(merged).items()))


def _runbook(profile: str, row: dict[str, Any]) -> str:
    return "\n".join([
        f"# SOP Deployment Profile: {profile}",
        "",
        f"- mode: {row.get('mode', '-')}",
        f"- database: {row.get('database', '-')}",
        f"- manager_url: {row.get('manager_url', '-')}",
        f"- public_url: {row.get('public_url', '-')}",
        "",
        "## Apply",
        "",
        "```bash",
        f"source .sop-runtime/deploy/{profile}/profile.env",
        f"docker compose -f docker-compose.yml -f .sop-runtime/deploy/{profile}/docker-compose.override.yml up -d",
        "```",
        "",
        "## Notes",
        "",
        str(row.get("notes") or "-"),
        "",
    ])


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _deployment_bundle_files(profile: str, row: dict[str, Any]) -> dict[str, str]:
    return {
        "profile.env": _env_shell(profile, row) + "\n",
        "docker-compose.override.yml": _compose_override(profile, row),
        "README.md": _runbook(profile, row),
    }


def _public_deployment_package(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id", ""),
        "profile": item.get("profile", ""),
        "version": item.get("version", ""),
        "channel": item.get("channel", ""),
        "created_at": item.get("created_at", ""),
        "created_by": item.get("created_by", ""),
        "release_notes": item.get("release_notes", ""),
        "dir": item.get("dir", ""),
        "mode": item.get("mode", ""),
        "database": item.get("database", ""),
        "file_count": len(item.get("files", [])) if isinstance(item.get("files"), list) else 0,
        "checksum": item.get("checksum", ""),
        "configuration_only": True,
        "deployment_evidence": False,
    }


def _configuration_manifest(item: dict[str, Any]) -> dict[str, Any]:
    # Historical package files stay intact, but release claims are no longer exposed.
    manifest = {
        key: value for key, value in item.items()
        if key != "release_status" and not key.startswith(("published_", "canary_"))
    }
    return {**manifest, "configuration_only": True, "deployment_evidence": False}


def _find_deployment_package(package_id: str) -> dict[str, Any]:
    data = _load_deployment_packages()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    for item in items:
        if isinstance(item, dict) and item.get("id") == package_id:
            return item
    raise HTTPException(404, f"unknown deployment package: {package_id}")


def _create_deployment_package(profile: str, row: dict[str, Any], body: DeploymentPackageIn) -> dict[str, Any]:
    with project_file_write_scope():
        version = _safe_version(body.version)
        package_id = f"{profile}-{version}"
        data = _load_deployment_packages()
        items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
        if any(item.get("id") == package_id for item in items):
            package_id = f"{package_id}-{uuid.uuid4().hex[:8]}"
        out_dir = _runtime_dir() / "deploy" / profile / "packages" / package_id
        out_dir.mkdir(parents=True, exist_ok=True)
        files = _deployment_bundle_files(profile, row)
        file_rows = []
        for filename, content in files.items():
            path = out_dir / filename
            path.write_text(content, encoding="utf-8")
            file_rows.append({
                "name": filename,
                "path": str(path),
                "size": len(content.encode("utf-8")),
                "sha256": _sha256_text(content),
            })
        manifest = {
            "id": package_id,
            "configuration_only": True,
            "deployment_evidence": False,
            "profile": profile,
            "version": version,
            "channel": body.channel,
            "created_at": _now(),
            "created_by": body.created_by or "ops-admin",
            "release_notes": body.release_notes,
            "dir": str(out_dir),
            "mode": row.get("mode", "single"),
            "database": row.get("database", "sqlite"),
            "features": row.get("features", {}) if isinstance(row.get("features"), dict) else {},
            "files": file_rows,
            "checksum": _sha256_text("\n".join(f"{item['name']}:{item['sha256']}" for item in file_rows)),
            "agent_consumption": {
                "surface": "settings.profiles.deployment_packages",
                "api": f"/api/v1/system/ops/profiles/{profile}/deployment-packages",
                "purpose": "Versioned configuration export only; this is not deployment execution evidence.",
            },
        }
        (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
        manifest["files"].append({
            "name": "manifest.json",
            "path": str(out_dir / "manifest.json"),
            "size": (out_dir / "manifest.json").stat().st_size,
            "sha256": _sha256_text((out_dir / "manifest.json").read_text(encoding="utf-8")),
        })
        data["items"] = [manifest, *items][:100]
        _save_deployment_packages(data)
        _audit_change("system_ops.deployment_package.create", profile, {"package_id": package_id, "version": version, "channel": body.channel})
        return manifest


def _doctor() -> dict[str, Any]:
    checks = []
    data = _load()
    active = data.get("active", "local-dev")
    profiles = data.get("profiles", {}) if isinstance(data.get("profiles"), dict) else {}
    checks.append({"id": "profile", "ok": active in profiles or active in {x["name"] for x in _templates()}, "message": f"active={active}"})
    checks.append({"id": "runtime_dir", "ok": _runtime_dir().exists(), "message": str(_runtime_dir())})
    checks.append({"id": "database", "ok": bool(os.getenv("DATABASE_URL") or os.getenv("DB_TYPE", "sqlite")), "message": os.getenv("DB_TYPE", "sqlite")})
    checks.append({"id": "worker", "ok": bool(os.getenv("REDIS_URL", "")), "message": "REDIS_URL configured" if os.getenv("REDIS_URL") else "file/memory fallback"})
    checks.append({"id": "temporal", "ok": os.getenv("WORKFLOW_ENGINE", "memory") == "temporal", "message": os.getenv("WORKFLOW_ENGINE", "memory")})
    failed = [c for c in checks if not c["ok"] and c["id"] in {"profile", "runtime_dir", "database"}]
    return {"ok": not failed, "checks": checks, "failed": len(failed)}


def _file_info(path: Path) -> dict[str, Any]:
    try:
        st = path.stat()
        return {
            "name": path.name,
            "path": str(path),
            "size": st.st_size,
            "updated_at": datetime.fromtimestamp(st.st_mtime, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        }
    except OSError:
        return {"name": path.name, "path": str(path), "size": 0, "updated_at": ""}


def _tail_lines(path: Path, limit: int = 200) -> list[str]:
    if not path.is_file():
        return []
    try:
        limit = max(1, min(int(limit or 200), 1000))
    except Exception:
        limit = 200
    try:
        with path.open("rb") as fh:
            fh.seek(0, os.SEEK_END)
            pos = fh.tell()
            chunk = 8192
            data = b""
            while pos > 0 and data.count(b"\n") <= limit:
                step = min(chunk, pos)
                pos -= step
                fh.seek(pos)
                data = fh.read(step) + data
        text = data.decode("utf-8", errors="replace")
        return text.splitlines()[-limit:]
    except OSError:
        return []


def _parse_log_line(line: str, source: str) -> dict[str, Any]:
    parts = line.split(" ", 3)
    ts = parts[0] if parts else ""
    level = parts[1].strip() if len(parts) > 1 else ""
    message = parts[3] if len(parts) > 3 else line
    return {"ts": ts, "level": level, "source": source, "message": message, "raw": line}


def _nested(row: dict[str, Any], *keys: str) -> Any:
    value: Any = row
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _row_ids(row: dict[str, Any]) -> set[str]:
    ids = {
        str(row.get("trace_id") or ""),
        str(row.get("correlation_id") or ""),
        str(row.get("agent_run_id") or ""),
        str(row.get("run_id") or ""),
        str(row.get("id") or ""),
        str(row.get("task_id") or ""),
        str(_nested(row, "meta", "trace_id") or ""),
        str(_nested(row, "meta", "correlation_id") or ""),
        str(_nested(row, "payload", "data", "trace_id") or ""),
        str(_nested(row, "payload", "data", "correlation_id") or ""),
        str(_nested(row, "payload", "data", "agent_run_id") or ""),
        str(_nested(row, "data", "trace_id") or ""),
        str(_nested(row, "data", "correlation_id") or ""),
        str(_nested(row, "data", "agent_run_id") or ""),
    }
    data = row.get("data")
    if isinstance(data, dict):
        ids.update({str(data.get("trace_id") or ""), str(data.get("correlation_id") or ""), str(data.get("agent_run_id") or "")})
        details = data.get("details")
        if isinstance(details, dict):
            ids.update({str(details.get("trace_id") or ""), str(details.get("correlation_id") or ""), str(details.get("agent_run_id") or "")})
    details = row.get("details")
    if isinstance(details, dict):
        ids.update({str(details.get("trace_id") or ""), str(details.get("correlation_id") or ""), str(details.get("agent_run_id") or "")})
    return {x for x in ids if x}


def _matches(row: dict[str, Any], needles: set[str]) -> bool:
    return bool(needles & _row_ids(row))


def _audit_payload(entry: dict[str, Any]) -> dict[str, Any]:
    data = entry.get("data") if isinstance(entry.get("data"), dict) else {}
    return {
        **data,
        "id": entry.get("hash", ""),
        "hash": entry.get("hash", ""),
        "prev_hash": entry.get("prev_hash", ""),
    }


def _node(kind: str, row: dict[str, Any]) -> dict[str, Any]:
    if kind == "agent_run":
        return {
            "type": kind,
            "id": row.get("id", ""),
            "run_id": row.get("id", ""),
            "status": row.get("status", ""),
            "title": f"Agent {row.get('agent_id') or '-'} / {row.get('task_id') or '-'}",
            "timestamp": row.get("finished_at") or row.get("started_at") or "",
            "risk_level": "high" if row.get("status") == "failed" else "medium" if row.get("status") in {"cancelled", "retrying"} else "low",
            "detail": "Historical external report (unverified; not acceptance evidence). " + str(row.get("error_msg") or row.get("cancel_reason") or ""),
            "evidence_source": "legacy_reported",
            "legacy_unverified": True,
            "link": "#/settings/observability",
        }
    if kind == "llm_call":
        latency = int(row.get("latency_ms") or 0)
        return {
            "type": kind,
            "id": row.get("id", ""),
            "run_id": row.get("agent_run_id", ""),
            "status": "slow" if latency >= 5000 else "ok",
            "title": f"LLM {row.get('model_id') or '-'}",
            "timestamp": row.get("created_at") or "",
            "risk_level": "high" if latency >= 5000 else "medium" if float(row.get("cost_usd") or 0) >= 1 else "low",
            "detail": f"latency={latency}ms cost=${row.get('cost_usd', 0)}",
            "link": "#/ai/llm-gateway",
        }
    if kind == "data_job":
        return {
            "type": kind,
            "id": row.get("id", ""),
            "run_id": row.get("agent_run_id") or row.get("run_id") or "",
            "status": row.get("status", ""),
            "title": f"Data ingest {row.get('name') or row.get('job_id') or '-'}",
            "timestamp": row.get("finished_at") or row.get("started_at") or "",
            "risk_level": "high" if row.get("status") == "failed" else "low",
            "detail": row.get("error_msg") or f"rows={row.get('rows_ingested', 0)}",
            "link": "#/data/ingest",
        }
    if kind == "event":
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        return {
            "type": kind,
            "id": row.get("id", ""),
            "run_id": _nested(payload, "data", "agent_run_id") or "",
            "status": row.get("action", ""),
            "title": f"Event {row.get('action') or row.get('module') or '-'}",
            "timestamp": row.get("ts") or "",
            "risk_level": "medium" if "failed" in str(row.get("action") or "") else "low",
            "detail": str(_nested(payload, "data", "reason") or row.get("record_id") or ""),
            "link": "/api/v1/events",
        }
    return {
        "type": kind,
        "id": row.get("hash") or row.get("id") or "",
        "run_id": row.get("agent_run_id", ""),
        "status": row.get("action", ""),
        "title": f"Audit {row.get('action') or '-'}",
        "timestamp": row.get("ts") or "",
        "risk_level": "medium",
        "detail": row.get("resource_type") or "",
        "link": "#/audit",
    }


def _load_trace_sources(limit: int) -> dict[str, list[dict[str, Any]]]:
    try:
        from sop_manager.routers import agent_runs
        runs = agent_runs._all_runs()[:limit]
    except Exception:
        runs = []
    try:
        from sop_manager.routers import llm_gateway_v2
        llm_usage = llm_gateway_v2._load_all("usage")[:limit]
    except Exception:
        llm_usage = []
    try:
        from sop_manager.routers import data_ingest
        data_runs = data_ingest._load_all("runs")[:limit]
    except Exception:
        data_runs = []
    try:
        from sop_manager.sync_journal import recent_events
        events = recent_events(limit=limit)
    except Exception:
        events = []
    try:
        from sop_manager.routers.audit_chain import recent_audit_entries
        audit = [_audit_payload(x) for x in recent_audit_entries(limit=limit)]
    except Exception:
        audit = []
    return {"agent_runs": runs, "llm_usage": llm_usage, "data_runs": data_runs, "events": events, "audit": audit}


def _derive_needles(sources: dict[str, list[dict[str, Any]]], *, run_id: str, trace_id: str, correlation_id: str) -> set[str]:
    needles = {x for x in {run_id, trace_id, correlation_id} if x}
    for run in sources["agent_runs"]:
        if run_id and str(run.get("id") or "") == run_id:
            needles.update(_row_ids(run))
    return {x for x in needles if x}


@router.get("/profiles")
def list_profiles(_: Any = Depends(current_user)) -> dict[str, Any]:
    data = _load()
    active = str(data.get("active") or "local-dev")
    merged = _merge_profiles()
    return {
        "ok": True,
        "active": active,
        "items": [_public_profile(name, row, active) for name, row in sorted(merged.items())],
        "templates": _templates(),
        "effective_env": _mask_env(_effective_env()),
        "config_path": str(_profiles_path()),
        "doctor": _doctor(),
    }


@router.get("/observability")
def observability(_: Any = Depends(current_user)) -> dict[str, Any]:
    log_dir = _log_dir()
    logs = sorted([_file_info(p) for p in log_dir.glob("*.log")], key=lambda x: x.get("updated_at", ""), reverse=True) if log_dir.exists() else []
    events_summary: dict[str, Any] = {"total": 0, "by_action": {}, "latest": []}
    try:
        from sop_manager.sync_journal import recent_events

        events = recent_events(limit=200)
        by_action: dict[str, int] = {}
        for evt in events:
            action = str(evt.get("action") or evt.get("type") or "unknown")
            by_action[action] = by_action.get(action, 0) + 1
        events_summary = {"total": len(events), "by_action": by_action, "latest": events[:20]}
    except Exception:
        pass
    doctor = _doctor()
    return {
        "ok": doctor.get("ok", False),
        "runtime_dir": str(_runtime_dir()),
        "log_dir": str(log_dir),
        "logs": logs,
        "events": events_summary,
        "doctor": doctor,
        "links": {
            "health": "/api/v1/health",
            "metrics": "/metrics",
            "events": "/api/v1/events",
            "audit": "/api/v1/audit/events",
        },
    }


@router.get("/observability/traces")
def observability_trace_summary(
    run_id: str = Query("", max_length=200),
    trace_id: str = Query("", max_length=64),
    correlation_id: str = Query("", max_length=200),
    limit: int = Query(100, ge=1, le=500),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    run_id = run_id if isinstance(run_id, str) else ""
    trace_id = trace_id if isinstance(trace_id, str) else ""
    correlation_id = correlation_id if isinstance(correlation_id, str) else ""
    try:
        limit = max(1, min(int(limit), 500))
    except Exception:
        limit = 100
    sources = _load_trace_sources(limit)
    needles = _derive_needles(sources, run_id=run_id, trace_id=trace_id, correlation_id=correlation_id)
    if not needles and (trace_id or correlation_id or run_id):
        needles = {x for x in {trace_id, correlation_id, run_id} if x}
    if not needles:
        ctx = current_trace_context()
        needles = {ctx["trace_id"], ctx["correlation_id"]}

    runs = [row for row in sources["agent_runs"] if _matches(row, needles)]
    llm = [row for row in sources["llm_usage"] if _matches(row, needles)]
    data = [row for row in sources["data_runs"] if _matches(row, needles)]
    events = [row for row in sources["events"] if _matches(row, needles)]
    audit = [row for row in sources["audit"] if _matches(row, needles)]
    all_rows = runs + llm + data + events + audit
    selected_trace = trace_id or next((str(x.get("trace_id") or _nested(x, "meta", "trace_id") or _nested(x, "payload", "data", "trace_id") or _nested(x, "details", "trace_id") or "") for x in all_rows if _matches(x, needles)), "")
    selected_corr = correlation_id or next((str(x.get("correlation_id") or _nested(x, "meta", "correlation_id") or _nested(x, "payload", "data", "correlation_id") or _nested(x, "details", "correlation_id") or "") for x in all_rows if _matches(x, needles)), "")
    failed_runs = [row for row in runs if row.get("status") == "failed"]
    failed_data = [row for row in data if row.get("status") == "failed"]
    slow_llm = [row for row in llm if int(row.get("latency_ms") or 0) >= 5000]
    nodes = (
        [_node("agent_run", row) for row in runs]
        + [_node("llm_call", row) for row in llm]
        + [_node("data_job", row) for row in data]
        + [_node("event", row) for row in events]
        + [_node("audit", row) for row in audit]
    )
    nodes.sort(key=lambda x: str(x.get("timestamp") or ""))
    risk_level = "high" if failed_runs or failed_data or slow_llm else "medium" if events or audit else "low"
    likely_causes = []
    if slow_llm:
        likely_causes.append("LLM latency exceeded 5000ms")
    if failed_data:
        likely_causes.append("Data ingest job failed")
    if failed_runs:
        likely_causes.append(str(failed_runs[0].get("error_msg") or "Agent run failed"))
    return {
        "ok": True,
        "filters": {"run_id": run_id, "trace_id": trace_id, "correlation_id": correlation_id, "limit": limit},
        "trace": {"trace_id": selected_trace, "correlation_id": selected_corr, "needles": sorted(needles)},
        "summary": {
            "agent_runs": len(runs),
            "failed_runs": len(failed_runs),
            "llm_calls": len(llm),
            "slow_llm_calls": len(slow_llm),
            "data_jobs": len(data),
            "failed_data_jobs": len(failed_data),
            "events": len(events),
            "audit_entries": len(audit),
            "nodes": len(nodes),
        },
        "root_cause": {
            "risk_level": risk_level,
            "likely_causes": likely_causes,
            "recommended_next": ["检查慢模型或 fallback 策略", "查看 Agent Run 证据", "核对数据接入游标与审计链"],
        },
        "root_cause_navigation": nodes,
        "agent_consumption": {
            "api": "/api/v1/system/ops/observability/traces",
            "safe_for_agents": True,
            "purpose": "按 trace_id/correlation_id/run_id 聚合 API、Agent Run、LLM、数据作业、事件和审计链，供失败根因导航。",
        },
    }


@router.get("/logs")
def read_logs(
    name: str = Query("sop.app.log", max_length=120),
    limit: int = Query(200, ge=1, le=1000),
    level: str = Query("", max_length=16),
    q: str = Query("", max_length=200),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    safe = "".join(c for c in name if c.isalnum() or c in "._-")
    if not safe.endswith(".log"):
        safe = f"{safe}.log"
    path = (_log_dir() / safe).resolve()
    if _log_dir() not in path.parents and path != _log_dir():
        raise HTTPException(400, "非法日志文件")
    lines = [_parse_log_line(x, safe) for x in _tail_lines(path, limit=limit)]
    if level:
        lv = level.upper()
        lines = [x for x in lines if str(x.get("level", "")).upper().startswith(lv)]
    if q:
        needle = q.lower()
        lines = [x for x in lines if needle in str(x.get("raw", "")).lower()]
    by_level: dict[str, int] = {}
    for row in lines:
        lv = str(row.get("level") or "UNKNOWN").upper()
        by_level[lv] = by_level.get(lv, 0) + 1
    return {"ok": True, "file": _file_info(path), "items": lines, "total": len(lines), "by_level": by_level}


@router.get("/storage/migration-plan")
def storage_migration_plan(_: Any = Depends(current_user)) -> dict[str, Any]:
    return oceanbase_migration_plan()


@router.post("/storage/migration-smoke")
def storage_migration_smoke(_: Any = Depends(current_user)) -> dict[str, Any]:
    return oceanbase_migration_smoke()


@router.put("/profiles/{profile}")
def upsert_profile(profile: str, body: EnvProfileIn, _: Any = Depends(require_role("tenant_admin"))) -> dict[str, Any]:
    name = _safe_name(profile)
    data = _load()
    profiles = data.setdefault("profiles", {})
    if not isinstance(profiles, dict):
        profiles = {}
        data["profiles"] = profiles
    row = body.model_dump()
    row["name"] = name
    row["updated_at"] = _now()
    profiles[name] = row
    if not data.get("active"):
        data["active"] = name
    _save(data)
    _audit_change("system_ops.profile.upsert", name, {"mode": row.get("mode"), "database": row.get("database"), "features": row.get("features", {})})
    return {"ok": True, "item": _public_profile(name, row, str(data.get("active") or ""))}


@router.post("/profiles/{profile}/activate")
def activate_profile(profile: str, _: Any = Depends(require_role("tenant_admin"))) -> dict[str, Any]:
    name = _safe_name(profile)
    data = _load()
    known = set((data.get("profiles") or {}).keys()) | {x["name"] for x in _templates()}
    if name not in known:
        raise HTTPException(404, f"unknown profile: {name}")
    data["active"] = name
    _save(data)
    _audit_change("system_ops.profile.activate", name, {"active": name})
    return {"ok": True, "active": name}


@router.delete("/profiles/{profile}")
def delete_profile(profile: str, _: Any = Depends(require_role("tenant_admin"))) -> dict[str, Any]:
    name = _safe_name(profile)
    data = _load()
    profiles = data.setdefault("profiles", {})
    if isinstance(profiles, dict):
        profiles.pop(name, None)
    if data.get("active") == name:
        data["active"] = "local-dev"
    _save(data)
    _audit_change("system_ops.profile.delete", name, {"profile": name})
    return {"ok": True}


@router.get("/profiles/{profile}/env")
def export_profile_env(profile: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    name = _safe_name(profile)
    merged = _merge_profiles()
    row = merged.get(name)
    if not row:
        raise HTTPException(404, f"unknown profile: {name}")
    env = row.get("env", {}) if isinstance(row.get("env"), dict) else {}
    return {"ok": True, "profile": name, "env": _mask_env(env), "shell": _env_shell(name, row)}


@router.post("/profiles/{profile}/bundle")
def export_profile_bundle(profile: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    with project_file_write_scope():
        name = _safe_name(profile)
        row = _merge_profiles().get(name)
        if not row:
            raise HTTPException(404, f"unknown profile: {name}")
        out_dir = _runtime_dir() / "deploy" / name
        out_dir.mkdir(parents=True, exist_ok=True)
        env_file = out_dir / "profile.env"
        compose_file = out_dir / "docker-compose.override.yml"
        runbook_file = out_dir / "README.md"
        env_file.write_text(_env_shell(name, row) + "\n", encoding="utf-8")
        compose_file.write_text(_compose_override(name, row), encoding="utf-8")
        runbook_file.write_text(_runbook(name, row), encoding="utf-8")
        _audit_change("system_ops.profile.export_bundle", name, {"dir": str(out_dir)})
        return {
            "ok": True,
            "profile": name,
            "dir": str(out_dir),
            "files": {
                "env": str(env_file),
                "compose": str(compose_file),
                "runbook": str(runbook_file),
            },
            "shell": _env_shell(name, row),
            "compose": _compose_override(name, row),
            "runbook": _runbook(name, row),
        }


@router.get("/profiles/{profile}/compose.override.yml")
def download_compose_override(profile: str, _: Any = Depends(current_user)) -> Response:
    name = _safe_name(profile)
    row = _merge_profiles().get(name)
    if not row:
        raise HTTPException(404, f"unknown profile: {name}")
    return Response(
        _compose_override(name, row),
        media_type="text/yaml; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}.docker-compose.override.yml"'},
    )


@router.get("/profiles/{profile}/deployment-packages")
def list_deployment_packages(
    profile: str,
    limit: int = Query(20, ge=1, le=100),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    name = _safe_name(profile)
    if name not in _merge_profiles():
        raise HTTPException(404, f"unknown profile: {name}")
    data = _load_deployment_packages()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    filtered = [_public_deployment_package(item) for item in items if isinstance(item, dict) and item.get("profile") == name]
    safe_limit = limit if isinstance(limit, int) else 20
    safe_limit = max(1, min(int(safe_limit or 20), 100))
    return {
        "ok": True,
        "profile": name,
        "items": filtered[:safe_limit],
        "total": len(filtered),
        "index_path": str(_deployment_packages_path()),
        "agent_consumption": {
            "surface": "settings.profiles.deployment_packages",
            "api": f"/api/v1/system/ops/profiles/{name}/deployment-packages",
            "purpose": "List versioned configuration exports; these do not prove deployment execution.",
        },
    }


@router.post("/profiles/{profile}/deployment-packages")
def create_deployment_package(
    profile: str,
    body: DeploymentPackageIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_name(profile)
    row = _merge_profiles().get(name)
    if not row:
        raise HTTPException(404, f"unknown profile: {name}")
    item = _create_deployment_package(name, row, body)
    return {"ok": True, "item": _public_deployment_package(item), "manifest": _configuration_manifest(item), "preview": {"shell": _masked_env_shell(name, row), "compose": _compose_override(name, row), "runbook": _runbook(name, row)}}


@router.get("/deployment-packages/{package_id}")
def get_deployment_package(package_id: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    item = _find_deployment_package(package_id)
    profile = str(item.get("profile") or "")
    row = _merge_profiles().get(profile, {})
    files = {str(file.get("name")): Path(str(file.get("path"))) for file in item.get("files", []) if isinstance(file, dict) and file.get("name") and file.get("path")}
    compose = files.get("docker-compose.override.yml")
    runbook = files.get("README.md")
    return {
        "ok": True,
        "item": _public_deployment_package(item),
        "manifest": _configuration_manifest(item),
        "preview": {
            "shell": _masked_env_shell(profile, row) if row else "",
            "compose": compose.read_text(encoding="utf-8") if compose and compose.is_file() else "",
            "runbook": runbook.read_text(encoding="utf-8") if runbook and runbook.is_file() else "",
        },
        "agent_consumption": {
            "surface": "settings.profiles.deployment_package.detail",
            "api": f"/api/v1/system/ops/deployment-packages/{package_id}",
            "purpose": "Inspect configuration export files, checksums, and safe previews.",
        },
    }


@router.get("/deployment-packages/{package_id}/compose.override.yml")
def download_deployment_package_compose(package_id: str, _: Any = Depends(current_user)) -> Response:
    item = _find_deployment_package(package_id)
    files = {str(file.get("name")): Path(str(file.get("path"))) for file in item.get("files", []) if isinstance(file, dict) and file.get("name") and file.get("path")}
    path = files.get("docker-compose.override.yml")
    if not path or not path.is_file():
        raise HTTPException(404, f"compose override missing for package: {package_id}")
    return Response(
        path.read_text(encoding="utf-8"),
        media_type="text/yaml; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{package_id}.docker-compose.override.yml"'},
    )


@router.get("/doctor")
def system_ops_doctor(_: Any = Depends(current_user)) -> dict[str, Any]:
    return {"ok": True, **_doctor()}


settings_router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


@router.get("/hub")
def env_ops_hub(_: Any = Depends(current_user)) -> dict[str, Any]:
    profiles_payload = list_profiles(_)
    obs = observability(_)
    doctor = _doctor()
    items = profiles_payload.get("items") if isinstance(profiles_payload.get("items"), list) else []
    logs = obs.get("logs") if isinstance(obs.get("logs"), list) else []
    toolchain_available = 0
    toolchain_total = 0
    by_category: dict[str, int] = {}
    try:
        from sop_manager.routers.orchestration import list_tools

        for tool in list_tools():
            if not isinstance(tool, dict):
                continue
            toolchain_total += 1
            if tool.get("available"):
                toolchain_available += 1
            cat = str(tool.get("category") or "unknown")
            by_category[cat] = by_category.get(cat, 0) + 1
    except Exception:
        pass

    def _pie(counter: dict[str, int]) -> list[dict[str, Any]]:
        return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]

    return {
        "ok": True,
        "summary": {
            "doctor_ok": bool(doctor.get("ok")),
            "profiles": len(items),
            "active_profile": str(profiles_payload.get("active") or "—"),
            "log_files": len(logs),
            "events_total": int((obs.get("events") or {}).get("total") or 0),
            "toolchain_available": toolchain_available,
            "toolchain_total": toolchain_total,
        },
        "charts": {"toolchain_category": _pie(by_category)},
        "domains": [
            {"id": "workbench", "path": "#/ops/env/workbench", "capability": "system.env-ops.workbench"},
            {"id": "profiles", "path": "#/settings/profiles", "capability": "system.settings.profiles"},
            {"id": "observability", "path": "#/settings/observability", "capability": "system.settings.observability"},
            {"id": "storage", "path": "#/settings/storage", "capability": "system.settings.storage"},
            {"id": "orchestration", "path": "#/orchestration", "capability": "delivery.orchestration"},
        ],
    }


@settings_router.get("/hub")
def settings_hub(_: Any = Depends(current_user)) -> dict[str, Any]:
    from sop_manager.routers.billing import billing_summary
    from sop_manager.routers.health import health_v1

    bill = billing_summary()
    health = health_v1()
    profiles = _load()
    profile_count = len(profiles.get("profiles") or {}) if isinstance(profiles.get("profiles"), dict) else 0
    doctor = _doctor()
    return {
        "ok": True,
        "summary": {
            "health_ok": bool(health.get("ok")),
            "admin_mode": str(health.get("admin_mode") or "single"),
            "invoice_count": bill.get("invoice_count", 0),
            "outstanding_usd": bill.get("outstanding_usd", 0),
            "env_profiles": profile_count,
            "doctor_ok": bool(doctor.get("ok")),
        },
        "domains": [
            {"id": "account", "path": "#/settings/account", "capability": "system.settings.account"},
            {"id": "runtime", "path": "#/settings/runtime", "capability": "system.settings.runtime"},
            {"id": "workspace", "path": "#/settings/workspace", "capability": "system.settings.workspace"},
            {"id": "sso", "path": "#/settings/sso", "capability": "system.settings.sso"},
            {"id": "billing", "path": "#/settings/billing", "capability": "system.settings.billing"},
            {"id": "profiles", "path": "#/settings/profiles", "capability": "system.settings.profiles"},
            {"id": "observability", "path": "#/settings/observability", "capability": "system.settings.observability"},
            {"id": "storage", "path": "#/settings/storage", "capability": "system.settings.storage"},
            {"id": "appearance", "path": "#/settings/appearance", "capability": "system.settings.appearance"},
        ],
    }
