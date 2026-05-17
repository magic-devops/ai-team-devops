"""系统运维配置：环境 Profile、部署模式与运行时自检。"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

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


def _runtime_dir() -> Path:
    return Path(os.getenv("SOP_RUNTIME_DIR", ".sop-runtime")).resolve()


def _log_dir() -> Path:
    return Path(os.getenv("LOG_DIR", Path(os.getenv("PROJECT_PATH", ".")) / "logs")).resolve()


def _profiles_path() -> Path:
    return _runtime_dir() / "env-profiles.json"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_name(name: str) -> str:
    out = "".join(c for c in name.strip().lower() if c.isalnum() or c in "-_")[:64]
    if not out:
        raise HTTPException(400, "profile 名称不能为空")
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
    path = _profiles_path()
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


@router.get("/profiles/{profile}/bundle")
def export_profile_bundle(profile: str, _: Any = Depends(current_user)) -> dict[str, Any]:
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
            {"id": "sso", "path": "#/settings/sso", "capability": "system.settings.sso"},
            {"id": "billing", "path": "#/settings/billing", "capability": "system.settings.billing"},
            {"id": "profiles", "path": "#/settings/profiles", "capability": "system.settings.profiles"},
            {"id": "observability", "path": "#/settings/observability", "capability": "system.settings.observability"},
        ],
    }
