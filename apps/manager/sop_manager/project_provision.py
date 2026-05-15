"""single 模式：将 memory/current_state.json 中的 project_id 同步到 Manager projects 表。"""
from __future__ import annotations

import json
import os
import secrets
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from sop_manager.path_config import project_path

ADMIN_MODE = (os.getenv("ADMIN_MODE", "single") or "single").strip().lower()

_PAIR_LOCK = threading.Lock()
_PAIR_CODES: dict[str, dict[str, Any]] = {}
_PAIR_TTL_SEC = int(os.getenv("SOP_PAIR_CODE_TTL", "600"))


def _path_has_memory(pp: Path) -> bool:
    return (pp.expanduser().resolve() / "memory" / "current_state.json").is_file()


def local_project_id_from_memory(pp: Path | None = None) -> str:
    """读取项目根 memory/current_state.json 的 project_id；否则 PROJECT_ID / default。"""
    root = (pp or project_path()).expanduser().resolve()
    state_file = root / "memory" / "current_state.json"
    if state_file.is_file():
        try:
            data = json.loads(state_file.read_text(encoding="utf-8"))
            pid = str(data.get("project_id") or "").strip()
            if pid:
                return pid
        except (OSError, json.JSONDecodeError, TypeError):
            pass
    env_pid = (os.getenv("PROJECT_ID", "") or "").strip()
    return env_pid or "default"


def local_project_name(project_id: str, pp: Path | None = None) -> str:
    root = (pp or project_path()).expanduser().resolve()
    state_file = root / "memory" / "current_state.json"
    if state_file.is_file():
        try:
            data = json.loads(state_file.read_text(encoding="utf-8"))
            name = str(data.get("project_name") or data.get("name") or "").strip()
            if name:
                return name
        except (OSError, json.JSONDecodeError, TypeError):
            pass
    return project_id


def ensure_project(
    db: Session,
    project_id: str,
    *,
    name: str | None = None,
    project_path_str: str | None = None,
    tenant_id: str | None = None,
    owner_user: Any | None = None,
) -> Any | None:
    """若 projects 中无此 id 则创建并绑定成员（single 模式）。"""
    from sop_manager.routers.sql_models import Project, ProjectMember, User

    pid = (project_id or "").strip()
    if not pid:
        return None

    existing = db.query(Project).filter_by(id=pid).first()
    if existing:
        return existing

    if ADMIN_MODE == "saas":
        return None

    tid = (tenant_id or os.getenv("TENANT_ID", "t-default") or "t-default").strip()
    pp = (project_path_str or os.getenv("PROJECT_PATH", ".") or ".").strip()
    pp_resolved = str(Path(pp).expanduser().resolve())
    display = (name or local_project_name(pid, Path(pp_resolved))).strip() or pid

    owner = owner_user
    if owner is None:
        owner = (
            db.query(User)
            .filter(User.role.in_(("super_admin", "tenant_admin")))
            .order_by(User.created_at.asc())
            .first()
        )
    if owner is None:
        return None

    proj = Project(
        id=pid,
        tenant_id=tid,
        name=display,
        description="本地项目（sop init / 自动注册）",
        project_path=pp_resolved,
        vector_db=os.getenv("VECTOR_DB_TYPE", "lance") or "lance",
        status="active",
    )
    db.add(proj)
    member = db.query(ProjectMember).filter_by(project_id=pid, user_id=owner.id).first()
    if not member:
        db.add(ProjectMember(project_id=pid, user_id=owner.id, role="project_admin"))
    db.flush()
    return proj


def ensure_default_project_on_startup() -> None:
    """Manager 启动时：single 模式且 projects 为空则按 memory 注册。"""
    if ADMIN_MODE != "single":
        return
    from sop_manager.routers.sql_models import SessionLocal, Project, User

    db = SessionLocal()
    try:
        if db.query(Project).count() > 0:
            return
        admin = (
            db.query(User)
            .filter(User.role.in_(("super_admin", "tenant_admin")))
            .first()
        )
        if not admin:
            return
        pid = local_project_id_from_memory()
        if ensure_project(db, pid, owner_user=admin):
            db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def ensure_project_for_user(db: Session, project_id: str, user: Any) -> Any | None:
    """API 请求路径：缺失项目时尝试自动注册（single）。"""
    from sop_manager.routers.sql_models import Project

    proj = db.query(Project).filter_by(id=project_id).first()
    if proj:
        return proj
    if ADMIN_MODE != "single":
        return None
    return ensure_project(db, project_id, owner_user=user)


def resolve_pair_project_id(
    entry: dict[str, Any],
    cli_local_path: str = "",
) -> tuple[str, str]:
    """解析配对 project_id：优先 CLI 本机路径上的 memory，再 Manager PROJECT_PATH，最后配对码快照。"""
    roots: list[Path] = []
    cli = (cli_local_path or "").strip()
    if cli:
        roots.append(Path(cli))
    ent_lp = (entry.get("local_path") or "").strip()
    if ent_lp:
        ep = Path(ent_lp)
        if ep.is_absolute() or _path_has_memory(ep):
            roots.append(ep)
    roots.append(project_path())

    seen: set[str] = set()
    resolved_pp = ""
    for root in roots:
        r = root.expanduser().resolve()
        key = str(r)
        if key in seen:
            continue
        seen.add(key)
        if _path_has_memory(r):
            pid = local_project_id_from_memory(r)
            if pid and pid != "default":
                return pid, str(r)
            if pid:
                resolved_pp = str(r)
                # 继续尝试其它 root，可能找到非 default 的 id

    pref = (entry.get("preferred_project_id") or "").strip()
    if pref and pref != "default":
        pp = cli or ent_lp or resolved_pp or str(project_path().resolve())
        return pref, pp

    if resolved_pp:
        return local_project_id_from_memory(Path(resolved_pp)), resolved_pp

    pp = str(project_path().resolve())
    pid = local_project_id_from_memory(Path(pp))
    if pid:
        return pid, pp
    return pref or "default", pp


def create_pair_code(
    *,
    user_id: str,
    tenant_id: str,
    local_path: str = "",
    preferred_project_id: str = "",
) -> str:
    code = secrets.token_urlsafe(24)
    expires = time.time() + _PAIR_TTL_SEC
    with _PAIR_LOCK:
        _prune_pair_codes()
        _PAIR_CODES[code] = {
            "user_id": user_id,
            "tenant_id": tenant_id,
            "local_path": local_path,
            "preferred_project_id": preferred_project_id,
            "expires": expires,
        }
    return code


def consume_pair_code(code: str) -> dict[str, Any] | None:
    c = (code or "").strip()
    if not c:
        return None
    with _PAIR_LOCK:
        _prune_pair_codes()
        entry = _PAIR_CODES.pop(c, None)
    if not entry or entry.get("expires", 0) < time.time():
        return None
    return entry


def _prune_pair_codes() -> None:
    now = time.time()
    expired = [k for k, v in _PAIR_CODES.items() if v.get("expires", 0) < now]
    for k in expired:
        _PAIR_CODES.pop(k, None)
