"""统一运行时目录：SOP_RUNTIME_DIR（默认 PROJECT_PATH/.sop-runtime）。

物理数据：{runtime}/db/sop.db、{runtime}/logs、{runtime}/ai-memory/…
项目根保留 .ai-memory → .sop-runtime/ai-memory 的符号链接（Unix），供 CLI / 文档路径兼容。
启动前调用 apply_startup_defaults()。"""
from __future__ import annotations

import os
import shutil
import sys
from contextvars import ContextVar, Token
from pathlib import Path
from typing import Optional, Tuple

# ── 请求级项目作用域（SaaS / 多项目：由中间件在 JWT 解析后注入）──────────────
_ctx_project_path: ContextVar[Optional[Path]] = ContextVar("sop_ctx_project_path", default=None)
_ctx_tenant_id: ContextVar[Optional[str]] = ContextVar("sop_ctx_tenant_id", default=None)
_ctx_project_id: ContextVar[Optional[str]] = ContextVar("sop_ctx_project_id", default=None)


def set_request_scope(tenant_id: str, project_id: str, project_path: Path) -> Tuple[Token, Token, Token]:
    """返回三个 reset token，须在请求结束时 reset_request_scope。"""
    pp = Path(project_path).expanduser().resolve()
    return (
        _ctx_tenant_id.set(str(tenant_id)),
        _ctx_project_id.set(str(project_id)),
        _ctx_project_path.set(pp),
    )


def reset_request_scope(tokens: Tuple[Token, Token, Token]) -> None:
    _ctx_tenant_id.reset(tokens[0])
    _ctx_project_id.reset(tokens[1])
    _ctx_project_path.reset(tokens[2])


def request_scope_active() -> bool:
    return _ctx_project_path.get() is not None


def resolved_tenant_id() -> str:
    t = _ctx_tenant_id.get()
    if t:
        return str(t)
    return (os.environ.get("TENANT_ID", "t-default") or "t-default").strip()


def resolved_project_id() -> str:
    t = _ctx_project_id.get()
    if t:
        return str(t)
    return (os.environ.get("PROJECT_ID", "default") or "default").strip()


def resolved_project_path() -> Path:
    """有请求作用域时用 DB 中的 project_path；否则用环境变量 PROJECT_PATH。"""
    p = _ctx_project_path.get()
    if p is not None:
        return p
    return project_path()


def resolved_runtime_dir() -> Path:
    """有请求作用域时固定为 {项目根}/.sop-runtime（忽略全局 SOP_RUNTIME_DIR，避免多租串路径）。"""
    if _ctx_project_path.get() is not None:
        return resolved_project_path() / ".sop-runtime"
    raw = os.environ.get("SOP_RUNTIME_DIR", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return project_path() / ".sop-runtime"


def resolved_ai_memory_root() -> Path:
    """有请求作用域时用该项目 runtime 下 ai-memory；否则沿用原 env / 默认逻辑。"""
    if _ctx_project_path.get() is not None:
        return resolved_runtime_dir() / "ai-memory"
    return ai_memory_root()

_WEB_DIR = Path(__file__).resolve().parent


def repo_root() -> Path:
    """本 monorepo 根目录（含 `apps/`、`ai-sop/`、`ai-sop-ops/` 等）。"""
    # path_config.py → sop_manager → manager → apps → repo
    return Path(__file__).resolve().parents[3]


def sop_dir() -> Path:
    """规约 Markdown 树（``magic-devops/ai-sop``）：仅解析 ``<repo>/ai-sop`` 或环境变量显式路径。

    可用环境变量 ``SOP_SPEC_ROOT`` 或 ``SOP_SOP_DIR`` 显式覆盖（须指向含 ``specs/`` 的目录）。
    不再回退已删除的内嵌规约目录；未找到时抛出 ``FileNotFoundError`` 并提示初始化 submodule。
    """
    raw = os.environ.get("SOP_SPEC_ROOT", "").strip() or os.environ.get("SOP_SOP_DIR", "").strip()
    if raw:
        p = Path(raw).expanduser().resolve()
        if not (p / "specs").is_dir():
            raise FileNotFoundError(
                f"SOP_SPEC_ROOT / SOP_SOP_DIR 指向的目录缺少 specs/: {p}"
            )
        return p
    root = repo_root()
    cand = root / "ai-sop"
    if cand.is_dir() and (cand / "specs").is_dir():
        return cand
    raise FileNotFoundError(
        "未找到规约目录（需要 <repo>/ai-sop/specs）。请执行: git submodule update --init --recursive，"
        "或设置 SOP_SPEC_ROOT / SOP_SOP_DIR 指向含 specs/ 的规约根（通常为 ai-sop 检出目录）。"
    )


_lance_ops_path_prepared = False


def ensure_lance_ops_import_path() -> None:
    """将 ``ai-sop-ops`` 根加入 ``sys.path``，以便 ``from knowledge.lancedb_ops import LanceOps`` 等导入。"""
    global _lance_ops_path_prepared
    if _lance_ops_path_prepared:
        return
    root = str(sop_ops_dir())
    if root not in sys.path:
        sys.path.insert(0, root)
    _lance_ops_path_prepared = True


def sop_ops_dir() -> Path:
    """可执行运维工具根（``magic-devops/ai-sop-ops``；本 monorepo 内为 ``ai-sop-ops/`` submodule）。

    解析顺序：环境变量 ``SOP_OPS_ROOT``；否则 ``<repo>/ai-sop-ops``（须含 ``include/sop-platform-root.sh``）。
    """
    raw = os.environ.get("SOP_OPS_ROOT", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    root = repo_root()
    cand = root / "ai-sop-ops"
    if cand.is_dir() and (cand / "include" / "sop-platform-root.sh").is_file():
        return cand
    raise FileNotFoundError(
        "未找到 ai-sop-ops（缺少 ai-sop-ops/include/sop-platform-root.sh）。"
        "请执行: git submodule update --init --recursive，或设置 SOP_OPS_ROOT。"
    )


def project_path() -> Path:
    return Path(os.environ.get("PROJECT_PATH", ".")).expanduser().resolve()


def runtime_dir() -> Path:
    raw = os.environ.get("SOP_RUNTIME_DIR", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return project_path() / ".sop-runtime"


def ai_memory_root() -> Path:
    raw = os.environ.get("AI_MEMORY_ROOT", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return runtime_dir() / "ai-memory"


def _sqlite_url_for_file(db_file: Path) -> str:
    p = db_file.resolve()
    return "sqlite:///" + p.as_posix()


def _is_legacy_sqlite_url(url: str) -> bool:
    u = (url or "").strip().replace("\\", "/")
    if ".sop-runtime/db/sop.db" in u:
        return False
    if not u:
        return True
    if u in ("sqlite:///./sop.db", "sqlite:///sop.db"):
        return True
    return False


def _migrate_sqlite(runtime: Path) -> None:
    runtime.joinpath("db").mkdir(parents=True, exist_ok=True)
    dest_db = runtime / "db" / "sop.db"
    if dest_db.exists():
        return
    for base in (_WEB_DIR, project_path()):
        src = base / "sop.db"
        if not src.exists():
            continue
        shutil.move(str(src), str(dest_db))
        for suffix in ("-wal", "-shm"):
            w = base / f"sop.db{suffix}"
            if w.exists():
                shutil.move(str(w), str(runtime / "db" / f"sop.db{suffix}"))
        return


def _migrate_ai_memory(project: Path, runtime: Path) -> None:
    legacy = project / ".ai-memory"
    target = runtime / "ai-memory"
    if legacy.is_symlink():
        target.mkdir(parents=True, exist_ok=True)
        return
    if legacy.is_dir():
        if not target.exists():
            shutil.move(str(legacy), str(target))
        else:
            for child in list(legacy.iterdir()):
                d = target / child.name
                if not d.exists():
                    shutil.move(str(child), str(d))
            shutil.rmtree(legacy, ignore_errors=True)
    target.mkdir(parents=True, exist_ok=True)
    if os.environ.get("SOP_RUNTIME_NO_SYMLINK", "").strip() in ("1", "true", "yes"):
        return
    if sys.platform == "win32":
        return
    rel = os.path.relpath(target, project)
    if legacy.exists():
        return
    try:
        os.symlink(rel, legacy, target_is_directory=True)
    except OSError:
        pass


def _migrate_logs(runtime: Path) -> None:
    new_logs = runtime / "logs"
    new_logs.mkdir(parents=True, exist_ok=True)
    pp = project_path()
    for legacy_logs in (pp / "logs", _WEB_DIR / "logs"):
        if not legacy_logs.is_dir():
            continue
        for f in legacy_logs.glob("*.log"):
            dest = new_logs / f.name
            if not dest.exists():
                try:
                    shutil.move(str(f), str(dest))
                except OSError:
                    pass


def _migrate_reinit(runtime: Path) -> None:
    legacy = project_path() / ".ai-reinit-backups"
    dest = runtime / "reinit-backups"
    if not legacy.exists():
        return
    dest.mkdir(parents=True, exist_ok=True)
    for child in list(legacy.iterdir()):
        d = dest / child.name
        if not d.exists():
            try:
                shutil.move(str(child), str(d))
            except OSError:
                pass
    shutil.rmtree(legacy, ignore_errors=True)


def apply_startup_defaults() -> None:
    """在导入 logger / sql_models 之前调用：创建 `.sop-runtime`、落位 SQLite / ai-memory / 日志，并补全 `DATABASE_URL` 等环境变量。"""
    pp = Path(os.environ.get("PROJECT_PATH", ".")).expanduser().resolve()
    os.environ["PROJECT_PATH"] = str(pp)

    rt = runtime_dir()
    rt.mkdir(parents=True, exist_ok=True)
    (rt / "db").mkdir(parents=True, exist_ok=True)

    if os.environ.get("DB_TYPE", "sqlite").lower() == "sqlite":
        _migrate_sqlite(rt)

    _migrate_ai_memory(pp, rt)
    _migrate_logs(rt)
    _migrate_reinit(rt)

    db_url = os.environ.get("DATABASE_URL", "").strip()
    if os.environ.get("DB_TYPE", "sqlite").lower() == "sqlite" and _is_legacy_sqlite_url(db_url):
        os.environ["DATABASE_URL"] = _sqlite_url_for_file(rt / "db" / "sop.db")

    if not os.environ.get("LOG_DIR", "").strip():
        os.environ["LOG_DIR"] = str((rt / "logs").resolve())
    Path(os.environ["LOG_DIR"]).mkdir(parents=True, exist_ok=True)

    elp = os.environ.get("LANCE_DB_PATH", "").strip().replace("\\", "/")
    if not elp or elp in (".ai-memory/lancedb", "ai-memory/lancedb"):
        os.environ["LANCE_DB_PATH"] = str((ai_memory_root() / "lancedb").resolve())


def runtime_paths_summary() -> dict:
    """供健康检查或调试 API 使用（请求内若有作用域则反映当前项目）。"""
    out = {
        "projectPath": str(resolved_project_path()),
        "runtimeDir": str(resolved_runtime_dir()),
        "aiMemoryRoot": str(resolved_ai_memory_root()),
        "logDir": os.getenv("LOG_DIR", ""),
    }
    if request_scope_active():
        out["scope"] = "request"
        out["scopedTenantId"] = resolved_tenant_id()
        out["scopedProjectId"] = resolved_project_id()
    else:
        out["scope"] = "process"
    return out
