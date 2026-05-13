"""统一运行时目录：SOP_RUNTIME_DIR（默认 PROJECT_PATH/.sop-runtime）。

物理数据：{runtime}/db/sop.db、{runtime}/logs、{runtime}/ai-memory/…
项目根保留 .ai-memory → .sop-runtime/ai-memory 的符号链接（Unix），供 CLI / 文档路径兼容。
启动前调用 apply_startup_defaults()。"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

_WEB_DIR = Path(__file__).resolve().parent


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
    if "sop/web/sop.db" in u:
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
    """在导入 logger / sql_models 之前调用：创建目录、迁移旧路径、补全环境变量。"""
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
    """供健康检查或调试 API 使用。"""
    return {
        "projectPath": str(project_path()),
        "runtimeDir": str(runtime_dir()),
        "aiMemoryRoot": str(ai_memory_root()),
        "logDir": os.getenv("LOG_DIR", ""),
    }
