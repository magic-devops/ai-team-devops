"""系统管理：脚本、配置、记忆、SOP 文档、工作区上下文与产出物书签"""
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
from pathlib import Path
import json, os, re, subprocess, uuid, sys, tarfile
from datetime import datetime as dt

from sop_manager.path_config import (
    repo_root,
    resolved_ai_memory_root,
    resolved_project_path,
    resolved_runtime_dir,
    sop_ops_dir,
)
from sop_manager.routers.productization_contract import probe_call, probe_file, summarize_items, unified_payload

router = APIRouter(prefix="/api/v1/system", tags=["system"])


def _load_json_object_file(path: Path) -> Dict[str, Any]:
    """读取 JSON 对象；文件缺失、空文件、非 JSON 或非 object 时返回 {}。"""
    if not path.is_file():
        return {}
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    if not (raw or "").strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _try_sop_ops() -> Optional[Path]:
    try:
        return sop_ops_dir()
    except FileNotFoundError:
        return None


def _init_script() -> Path:
    return sop_ops_dir() / "init-ai-project.sh"


def _workspace_artifacts_path() -> Path:
    return resolved_ai_memory_root() / "workspace_artifacts.json"


@router.get("/readiness/full")
def system_readiness_full() -> dict[str, Any]:
    project = resolved_project_path()
    items = [
        probe_file("apps/manager/sop_manager/main.py", "Manager FastAPI entry"),
        probe_file("apps/manager-web/src/navigation.tsx", "manager-web navigation"),
        probe_file("apps/manager-web/src/lib/api.ts", "manager-web SDK facade"),
        probe_file("packages/sop-sdk-python/sop_sdk/client.py", "Python SDK client"),
        probe_file("packages/sop-cli/sop_cli/__main__.py", "sop CLI root"),
        probe_file("packages/sop-cli/sop_cli/commands/pages.py", "pages CLI control"),
        probe_file("packages/sop-cli/sop_cli/commands/graph_loop.py", "graph-loop CLI control"),
        probe_file("packages/sop-cli/sop_cli/commands/dev_flow.py", "dev-flow CLI control"),
        probe_file("apps/manager/sop_manager/routers/scope_guard.py", "scope guard"),
        probe_file("apps/manager/sop_manager/routers/graph_loop.py", "Graph Loop typed control plane"),
        probe_file("apps/manager/sop_manager/routers/system_pages.py", "page registry and capability governance"),
        probe_file("Makefile", "operator readiness entry"),
        probe_file("scripts", "scripts directory"),
        probe_file("ai-sop-ops", "SOP ops scripts", required=False),
        probe_file(".ai-memory/ai_capabilities.json", "AI capability registry", required=False),
        probe_call("system_pages", "system pages API", lambda: __import__("sop_manager.routers.system_pages", fromlist=["system_pages"]).system_pages(view="react")),
        probe_call("graph_loop_store", "Graph Loop store/schema", lambda: __import__("sop_manager.routers.graph_loop", fromlist=["get_graph_loop_store"]).get_graph_loop_store().diagnostics()),
        probe_call("graph_loop_slo", "Graph Loop SLO", lambda: __import__("sop_manager.routers.graph_loop", fromlist=["graph_loop_slo"]).graph_loop_slo()),
        probe_call("dev_flow", "dev-flow ops plan", lambda: __import__("sop_manager.routers.dev_flow", fromlist=["dev_flow_ops_plan"]).dev_flow_ops_plan()),
        probe_call("interaction_ops", "interaction ops control room", lambda: __import__("sop_manager.routers.pages_productization", fromlist=["pages_interaction_ops"]).pages_interaction_ops(domain="all", status="watch", limit=20)),
        probe_call("skills", "skills catalog", lambda: __import__("sop_manager.routers.skills", fromlist=["list_skills"]).list_skills()),
    ]
    summary = summarize_items(items)
    summary.update(
        {
            "ok": summary["risk"] == 0,
            "project_path": str(project),
            "coverage": ["backend", "frontend", "cli", "sdk", "permissions", "pages", "scope", "scripts", "deployment"],
            "readiness_command": "sop system readiness --full --json",
        }
    )
    return unified_payload(
        ok=summary["ok"],
        summary=summary,
        items=items,
        actions=[
            {"id": "read", "label": "读取全域 readiness", "method": "GET", "path": "/api/v1/system/readiness/full", "risk": "low"},
            {"id": "pages", "label": "页面产品化治理", "method": "GET", "path": "/api/v1/pages/productization", "risk": "low"},
            {"id": "interaction-ops", "label": "治理交付控制室", "method": "GET", "path": "/api/v1/pages/interaction-ops", "risk": "medium"},
            {"id": "graph-loop", "label": "Graph Loop 控制面", "method": "GET", "path": "/api/v1/graph-loop/summary", "risk": "medium"},
            {"id": "dev-flow", "label": "研发生命周期", "method": "GET", "path": "/api/v1/dev-flow/lifecycle", "risk": "low"},
        ],
        cli=[
            {"id": "read", "command": "sop system readiness --full --json"},
            {"id": "doctor", "command": "sop doctor --json"},
            {"id": "pages", "command": "sop pages health --json"},
            {"id": "interaction-ops", "command": "sop pages interaction-ops --json"},
            {"id": "graph-loop", "command": "sop graph-loop summary --json"},
            {"id": "make", "command": "make full-readiness"},
        ],
        permissions=[
            {"capability": "system.readiness", "actions": ["read", "export"]},
            {"capability": "governance.system-map", "actions": ["read", "write", "execute", "approve"]},
            {"capability": "governance.interaction-ops", "actions": ["read", "write", "execute", "export"]},
            {"capability": "delivery.dev-flow", "actions": ["read", "write", "execute"]},
        ],
        audit={"event": "system_readiness_full", "project_path": str(project)},
        agent_consumption={
            "purpose": "One-shot release-readiness packet for backend, frontend, CLI, SDK, permission, scope, scripts and deployment checks.",
            "followups": [
                "/api/v1/pages/productization",
                "/api/v1/pages/interaction-ops",
                "/api/v1/pages/interaction-ops/tasks",
                "/api/v1/pages/interaction-ops/memory",
                "/api/v1/pages/interaction-ops/export",
                "/api/v1/graph-loop/summary",
                "/api/v1/graph-loop/slo",
                "/api/v1/graph-loop/runs/{run_id}",
                "/api/v1/graph-loop/runs/{run_id}/events",
                "/api/v1/graph-loop/runs/{run_id}/transition",
                "/api/v1/graph-loop/runs/{run_id}/replay",
                "/api/v1/graph-loop/runs/{run_id}/export",
                "/api/v1/skills/runtime",
                "/api/v1/plugins/governance",
                "/api/v1/dev-flow/lifecycle",
            ],
        },
    )
@router.get("/scripts")
def list_scripts():
    tools_dir = _try_sop_ops()
    if tools_dir is None or not tools_dir.exists():
        return []
    return [{"name": f.name, "size": f.stat().st_size,
             "executable": os.access(f, os.X_OK)}
            for f in sorted(tools_dir.iterdir()) if f.is_file()]

@router.get("/scripts/{name}/content")
def get_script(name: str):
    tools_dir = _try_sop_ops()
    if tools_dir is None:
        raise HTTPException(503, "ai-sop-ops 未就绪（git submodule update --init）")
    f = (tools_dir / name).resolve()
    if not str(f).startswith(str(tools_dir.resolve())):
        raise HTTPException(403, "Access denied")
    if not f.exists(): raise HTTPException(404, "Not found")
    return {"content": f.read_text(errors="replace")}

class ScriptUpdate(BaseModel):
    content: str

@router.put("/scripts/{name}")
def update_script(name: str, body: ScriptUpdate):
    tools_dir = _try_sop_ops()
    if tools_dir is None:
        raise HTTPException(503, "ai-sop-ops 未就绪")
    f = (tools_dir / name).resolve()
    if not str(f).startswith(str(tools_dir.resolve())):
        raise HTTPException(403, "Access denied")
    f.write_text(body.content); return {"ok": True}

@router.post("/scripts/{name}/run")
def run_script(name: str):
    tools_dir = _try_sop_ops()
    if tools_dir is None:
        raise HTTPException(503, "ai-sop-ops 未就绪")
    f = tools_dir / name
    if not f.exists(): raise HTTPException(404, "Not found")
    if not f.suffix == ".sh": raise HTTPException(400, "Only .sh scripts allowed")
    try:
        result = subprocess.run(["bash", str(f)], capture_output=True, text=True, timeout=30,
                                cwd=str(resolved_project_path()))
        return {"stdout": result.stdout[-2000:], "stderr": result.stderr[-500:], "returncode": result.returncode}
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "超时（30s）", "returncode": -1}

# ── 配置管理 ──────────────────────────────────────────────────────
@router.get("/config")
def get_config():
    settings = resolved_project_path() / ".claude" / "settings.json"
    opencode = resolved_project_path() / "opencode.json"
    codex_config = resolved_project_path() / ".codex" / "config.toml"
    codex_hooks = resolved_project_path() / ".codex" / "hooks.json"
    return {
        "claude_settings": _load_json_object_file(settings),
        "opencode": _load_json_object_file(opencode),
        "codex_config": codex_config.read_text(encoding="utf-8") if codex_config.exists() else "",
        "codex_hooks": _load_json_object_file(codex_hooks),
    }

@router.patch("/config/claude")
def update_claude_config(body: dict):
    f = resolved_project_path() / ".claude" / "settings.json"
    if not f.exists(): raise HTTPException(404, "settings.json not found")
    cfg = json.loads(f.read_text()); cfg.update(body)
    f.write_text(json.dumps(cfg, indent=2, ensure_ascii=False)); return {"ok": True}

# ── 记忆管理 ──────────────────────────────────────────────────────
@router.get("/memory")
def list_memory():
    mem_dir = resolved_ai_memory_root()
    if not mem_dir.exists(): return {"rules": [], "snapshots": [], "lancedb_tables": []}
    rules = [f.name for f in sorted((mem_dir / "rules").glob("*.md"))] if (mem_dir / "rules").exists() else []
    snaps = [f.name for f in sorted((resolved_project_path() / "memory" / "snapshots").glob("*.json"))] if (resolved_project_path() / "memory" / "snapshots").exists() else []
    try:
        import lancedb
        db = lancedb.connect(str(mem_dir / "lancedb"))
        tables = db.table_names()
    except Exception:
        tables = []
    return {"rules": rules, "snapshots": snaps, "lancedb_tables": tables}

@router.get("/memory/rules/{filename}")
def get_rule_file(filename: str):
    f = (resolved_ai_memory_root() / "rules" / filename).resolve()
    if not f.exists(): raise HTTPException(404, "Not found")
    return {"content": f.read_text(errors="replace")}

@router.delete("/memory/snapshots/{filename}")
def delete_snapshot(filename: str):
    f = resolved_project_path() / "memory" / "snapshots" / filename
    if f.exists(): f.unlink()
    return {"ok": True}

@router.get("/memory/lancedb/{table}/stats")
def table_stats(table: str):
    try:
        import lancedb
        db = lancedb.connect(str(resolved_ai_memory_root() / "lancedb"))
        t = db.open_table(table)
        df = t.to_pandas()
        return {"table": table, "rows": len(df), "columns": list(df.columns)}
    except Exception as e:
        raise HTTPException(500, str(e))


def _load_workspace_artifacts() -> List[Dict[str, Any]]:
    if not _workspace_artifacts_path().exists():
        return []
    try:
        d = json.loads(_workspace_artifacts_path().read_text(encoding="utf-8"))
        arr = d.get("items") if isinstance(d, dict) else d
        return arr if isinstance(arr, list) else []
    except Exception:
        return []


def _save_workspace_artifacts(items: List[Dict[str, Any]]) -> None:
    _workspace_artifacts_path().parent.mkdir(parents=True, exist_ok=True)
    _workspace_artifacts_path().write_text(
        json.dumps({"items": items}, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _safe_rel_under_project(rel: str) -> Path:
    rel = (rel or "").replace("\\", "/").strip("/")
    if not rel or ".." in rel or rel.startswith("/"):
        raise HTTPException(400, "path 须为仓库相对路径，禁止 ..")
    target = (resolved_project_path() / rel).resolve()
    root = resolved_project_path().resolve()
    if not str(target).startswith(str(root) + os.sep) and target != root:
        raise HTTPException(400, "path 越界")
    return target


@router.get("/workspace/context")
def workspace_context(request: Request):
    """供前端展示：项目根、API 基址、管理后台入口、常用页 #hash、产出物书签、可执行脚本列表。"""
    base = str(request.base_url).rstrip("/")
    public = (os.getenv("ADMIN_PUBLIC_BASE_URL") or os.getenv("WEB_PUBLIC_BASE_URL") or "").strip().rstrip("/")
    ui_base = public or base
    api_base = f"{base}/api" if not base.endswith("/api") else base
    # 仅 id + hash；展示文案由前端 i18n（page_<id 下划线化>）统一，避免中英混杂。
    nav = [
        {"id": "dashboard", "hash": "#dashboard"},
        {"id": "dev-flow", "hash": "#dev-flow"},
        {"id": "requirements", "hash": "#requirements"},
        {"id": "plan", "hash": "#plan"},
        {"id": "iteration", "hash": "#iteration"},
        {"id": "vibe", "hash": "#vibe"},
        {"id": "docker", "hash": "#docker"},
        {"id": "orchestration", "hash": "#orchestration"},
        {"id": "design-docs", "hash": "#design-docs"},
        {"id": "issues", "hash": "#issues"},
        {"id": "agents", "hash": "#agents"},
        {"id": "system", "hash": "#system"},
    ]
    arts = _load_workspace_artifacts()
    enriched = []
    for a in arts:
        row = dict(a)
        if row.get("kind") == "path" and row.get("path"):
            try:
                p = _safe_rel_under_project(str(row["path"]))
                row["resolved_path"] = str(p)
                row["exists"] = p.exists()
            except HTTPException:
                row["resolved_path"] = ""
                row["exists"] = False
        enriched.append(row)
    scripts = list_scripts()[:40]
    return {
        "project_path": str(resolved_project_path()),
        "api_base": api_base,
        "admin_ui_base": ui_base,
        "nav": nav,
        "artifacts": enriched,
        "scripts": scripts,
        "docs": {
            "openapi": f"{base}/docs",
            "redoc": f"{base}/redoc",
        },
    }


class WorkspaceArtifactCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    kind: str = Field("url", max_length=16)
    url: str = Field("", max_length=800)
    path: str = Field("", max_length=400)
    notes: str = Field("", max_length=500)


@router.get("/workspace/artifacts")
def workspace_artifacts_list():
    return {"items": _load_workspace_artifacts()}


@router.post("/workspace/artifacts")
def workspace_artifacts_add(body: WorkspaceArtifactCreate):
    k = (body.kind or "url").strip().lower()
    if k not in ("url", "path"):
        raise HTTPException(400, "kind 仅支持 url | path")
    aid = f"wa-{uuid.uuid4().hex[:10]}"
    row: Dict[str, Any] = {"id": aid, "title": body.title.strip()[:120], "kind": k, "notes": (body.notes or "").strip()[:500]}
    if k == "url":
        u = (body.url or "").strip()
        if not u.startswith(("http://", "https://")) or len(u) > 800 or ".." in u or "\n" in u:
            raise HTTPException(400, "非法 url")
        row["url"] = u
    else:
        rel = (body.path or "").strip()
        if not rel:
            raise HTTPException(400, "path 不能为空")
        _ = _safe_rel_under_project(rel)
        row["path"] = rel.replace("\\", "/").strip("/")
    items = _load_workspace_artifacts()
    items.append(row)
    _save_workspace_artifacts(items)
    return {"ok": True, "item": row}


@router.delete("/workspace/artifacts/{artifact_id}")
def workspace_artifacts_delete(artifact_id: str):
    aid = (artifact_id or "").strip()
    if not re.match(r"^wa-[a-f0-9]{10}$", aid):
        raise HTTPException(400, "非法 id")
    raw = _load_workspace_artifacts()
    nxt = [x for x in raw if str(x.get("id")) != aid]
    if len(nxt) == len(raw):
        raise HTTPException(404, "未找到")
    _save_workspace_artifacts(nxt)
    return {"ok": True}


# ── 发布版本 / 备份 / 运维提示（管理后台自身）────────────────────────
def _admin_release_path() -> Path:
    return resolved_ai_memory_root() / "admin_release.json"


def _backup_dir() -> Path:
    return resolved_ai_memory_root() / "admin_backups"


def _reinit_backup_dir() -> Path:
    return resolved_runtime_dir() / "reinit-backups"


_BACKUP_SKIP_DIRS = frozenset(
    {"lancedb", "node_modules", "__pycache__", ".pytest_cache", ".git", "venv", ".venv", "dist", "build", ".mypy_cache"}
)
_BACKUP_MAX_FILE_BYTES = 96 * 1024 * 1024


def _utc_iso() -> str:
    return dt.utcnow().replace(microsecond=0).isoformat() + "Z"


def _load_release() -> Dict[str, Any]:
    if not _admin_release_path().is_file():
        return {"displayVersion": "2.0", "notes": "", "updatedAt": None}
    try:
        d = json.loads(_admin_release_path().read_text(encoding="utf-8"))
        return {
            "displayVersion": str(d.get("displayVersion") or d.get("display_version") or "2.0")[:64],
            "notes": str(d.get("notes") or "")[:2000],
            "updatedAt": d.get("updatedAt") or d.get("updated_at"),
        }
    except Exception:
        return {"displayVersion": "2.0", "notes": "", "updatedAt": None}


def _save_release(display_version: str, notes: str) -> Dict[str, Any]:
    row = {
        "displayVersion": display_version.strip()[:64],
        "notes": (notes or "")[:2000],
        "updatedAt": _utc_iso(),
    }
    _admin_release_path().parent.mkdir(parents=True, exist_ok=True)
    _admin_release_path().write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
    return row


class AdminReleasePut(BaseModel):
    display_version: str = Field(..., min_length=1, max_length=64)
    notes: str = Field("", max_length=2000)


@router.get("/release")
def release_get():
    """当前登记的后台展示版本（写入运行时 ai-memory/admin_release.json；健康检查可读）。"""
    return _load_release()


@router.put("/release")
def release_put(body: AdminReleasePut):
    return {"ok": True, "release": _save_release(body.display_version, body.notes)}


def _backup_safe_name(fn: str) -> bool:
    return bool(re.match(r"^backup-(admin_state|manager_web)-\d{8}-\d{6}\.tar\.gz$", (fn or "").strip()))


def _tar_add_filtered(tf: tarfile.TarFile, base: Path, arc_root: str) -> int:
    """将 base 下文件加入 tar，跳过常见大目录与过大单文件。返回加入文件数。"""
    if not base.is_dir():
        return 0
    root = base.resolve()
    n = 0
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        try:
            rel = path.relative_to(root)
        except ValueError:
            continue
        if any(p in _BACKUP_SKIP_DIRS for p in rel.parts):
            continue
        try:
            if path.stat().st_size > _BACKUP_MAX_FILE_BYTES:
                continue
        except OSError:
            continue
        arcname = f"{arc_root}/" + rel.as_posix()
        tf.add(path, arcname=arcname, recursive=False)
        n += 1
    return n


class BackupCreateBody(BaseModel):
    profile: str = Field("admin_state", max_length=32)


@router.get("/backups")
def backups_list():
    """列出运行时 ai-memory/admin_backups 下由本接口生成的 tar.gz。"""
    _backup_dir().mkdir(parents=True, exist_ok=True)
    items: List[Dict[str, Any]] = []
    root = _backup_dir().resolve()
    for f in sorted(_backup_dir().glob("backup-*.tar.gz"), key=lambda x: x.stat().st_mtime, reverse=True):
        if not _backup_safe_name(f.name):
            continue
        fp = f.resolve()
        if not str(fp).startswith(str(root) + os.sep):
            continue
        st = f.stat()
        items.append(
            {
                "name": f.name,
                "size": st.st_size,
                "updatedAt": dt.utcfromtimestamp(st.st_mtime).replace(microsecond=0).isoformat() + "Z",
            }
        )
    return {"items": items}


@router.post("/backups")
def backup_create(body: BackupCreateBody):
    """打包备份：admin_state=运行时 ai-memory 内配置与托管 Dockerfile 等（跳过大库表目录）；manager_web=apps/manager-web 前端（跳过 node_modules）。"""
    prof = (body.profile or "admin_state").strip().lower()
    if prof not in ("admin_state", "manager_web"):
        raise HTTPException(400, "profile 仅支持 admin_state | manager_web")
    _backup_dir().mkdir(parents=True, exist_ok=True)
    ts = dt.utcnow().strftime("%Y%m%d-%H%M%S")
    name = f"backup-{prof}-{ts}.tar.gz"
    out = (_backup_dir() / name).resolve()
    root_b = _backup_dir().resolve()
    if not str(out).startswith(str(root_b) + os.sep):
        raise HTTPException(500, "备份路径异常")
    added = 0
    with tarfile.open(out, "w:gz") as tf:
        if prof == "admin_state":
            mem = resolved_ai_memory_root()
            if mem.is_dir():
                added += _tar_add_filtered(tf, mem, "ai-memory")
            for extra in (".cursorrules", "ARCHITECTURE.md", "README.md"):
                p = resolved_project_path() / extra
                if p.is_file():
                    try:
                        if p.stat().st_size <= _BACKUP_MAX_FILE_BYTES:
                            tf.add(p, arcname=f"project-root/{extra}", recursive=False)
                            added += 1
                    except OSError:
                        pass
        else:
            root = repo_root()
            mw = root / "apps" / "manager-web"
            if mw.is_dir():
                added += _tar_add_filtered(tf, mw, "apps/manager-web")
    st = out.stat()
    return {"ok": True, "file": name, "size": st.st_size, "fileCount": added, "createdAt": _utc_iso()}


@router.get("/backups/download")
def backup_download(name: str = Query(..., max_length=120)):
    fn = (name or "").strip()
    if not _backup_safe_name(fn):
        raise HTTPException(400, "非法文件名")
    p = (_backup_dir() / fn).resolve()
    if not str(p).startswith(str(_backup_dir().resolve()) + os.sep) or not p.is_file():
        raise HTTPException(404, "不存在")
    return FileResponse(str(p), filename=fn, media_type="application/gzip")


@router.delete("/backups/{filename}")
def backup_delete(filename: str):
    fn = (filename or "").strip()
    if not _backup_safe_name(fn):
        raise HTTPException(400, "非法文件名")
    p = (_backup_dir() / fn).resolve()
    if not str(p).startswith(str(_backup_dir().resolve()) + os.sep) or not p.is_file():
        raise HTTPException(404, "不存在")
    p.unlink()
    return {"ok": True}


@router.get("/ops/process")
def ops_process():
    """当前 uvicorn  worker 进程信息（用于对账与手动重启）。"""
    return {
        "pid": os.getpid(),
        "cwd": str(Path.cwd()),
        "projectPath": str(resolved_project_path()),
        "executable": sys.executable,
    }


@router.get("/ops/restart-hint")
def ops_restart_hint():
    """说明：进程内无法安全自重启，需由外部 supervisor / systemd / 容器编排完成。"""
    return {
        "canRestartInProcess": False,
        "hint": "请在运行环境中重启本服务（例如 systemctl restart …、docker compose restart …、或停止后重新执行 uvicorn）。",
        "pid": os.getpid(),
    }


@router.get("/ops/upgrade-hint")
def ops_upgrade_hint():
    """拉代码与依赖的通用步骤（不涉及外网自动升级）。"""
    return {
        "steps": [
            "在项目根执行 git pull 获取仓库最新代码",
            "若依赖有变更：在部署环境执行 pip install -e apps/manager[all]（以仓库实际路径为准）",
            "创建一次 admin_state 备份后，按运维流程重启管理后台进程",
        ],
        "notes": "升级前建议使用「管理状态」备份（admin_state）。",
    }


# ── 项目初始化 / 重置（封装 ai-sop-ops/init-ai-project.sh）────────────────


def _state_file() -> Path:
    return resolved_project_path() / "memory" / "current_state.json"


_REINIT_TAR_RE = re.compile(r"^reinit-\d{8}-\d{6}\.tar\.gz$")
_PROJECT_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$")


def _run_init_script(argv: List[str], timeout: int) -> Dict[str, Any]:
    init_sh = _init_script()
    if not init_sh.is_file():
        raise HTTPException(
            404,
            "未找到 ai-sop-ops/init-ai-project.sh（请 git submodule update --init --recursive 或设置 SOP_OPS_ROOT）",
        )
    cmd = ["bash", str(init_sh)] + argv
    try:
        r = subprocess.run(cmd, cwd=str(resolved_project_path()), capture_output=True, text=True, timeout=timeout)
        return {
            "ok": r.returncode == 0,
            "returncode": r.returncode,
            "stdout": (r.stdout or "")[-12000:],
            "stderr": (r.stderr or "")[-8000:],
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "returncode": -1, "stdout": "", "stderr": f"命令超时（{timeout}s），脚本可能仍在执行，请到服务器查看。"}
    except Exception as e:
        return {"ok": False, "returncode": -1, "stdout": "", "stderr": str(e)}


@router.get("/project/bootstrap-status")
def project_bootstrap_status():
    """未初始化页用：脚本是否存在、是否已有状态文件、两类备份数量与安全提示。"""
    admin_bak = resolved_ai_memory_root() / "admin_backups"
    n_admin = 0
    if admin_bak.is_dir():
        n_admin = len([x for x in admin_bak.glob("backup-*.tar.gz") if x.is_file()])
    n_reinit = 0
    if _reinit_backup_dir().is_dir():
        n_reinit = len([x for x in _reinit_backup_dir().glob("reinit-*.tar.gz") if x.is_file()])
    init_sh = _init_script()
    try:
        rel_script = str(init_sh.relative_to(resolved_project_path().resolve()))
    except ValueError:
        rel_script = str(init_sh)
    try:
        reinit_dir_rel = str(_reinit_backup_dir().relative_to(resolved_project_path()))
    except ValueError:
        reinit_dir_rel = str(_reinit_backup_dir())
    return {
        "initialized": _state_file().is_file(),
        "statePath": "memory/current_state.json",
        "initScriptReady": _init_script().is_file(),
        "initScriptPath": rel_script,
        "adminBackupsCount": n_admin,
        "reinitBackupsCount": n_reinit,
        "reinitBackupDir": reinit_dir_rel,
        "safetyReminders": [
            "初始化与重置会在服务器上对当前项目根目录执行 shell 脚本，请仅在可信环境使用。",
            "重置（reinit）默认会先打包 memory、运行时 ai-memory（及项目根 .ai-memory 符号链接若存在）、CLAUDE.md 等至运行时 reinit-backups/，再删除并重建；仍建议先在「系统管理 → 运维/版本」创建 admin_state 备份。",
            "重置需手动在确认框输入 REINIT；无法撤销，请确认无未提交的重要改动。",
        ],
    }


@router.get("/project/reinit-backups")
def project_reinit_backups_list():
    """列出 init-ai-project.sh reinit 生成的 tar 包。"""
    items: List[Dict[str, Any]] = []
    if not _reinit_backup_dir().is_dir():
        return {"items": []}
    root = _reinit_backup_dir().resolve()
    for f in sorted(_reinit_backup_dir().glob("reinit-*.tar.gz"), key=lambda x: x.stat().st_mtime, reverse=True):
        if not f.is_file() or not _REINIT_TAR_RE.match(f.name):
            continue
        fp = f.resolve()
        if not str(fp).startswith(str(root) + os.sep):
            continue
        st = f.stat()
        items.append(
            {
                "name": f.name,
                "size": st.st_size,
                "updatedAt": dt.utcfromtimestamp(st.st_mtime).replace(microsecond=0).isoformat() + "Z",
            }
        )
    return {"items": items}


@router.get("/project/reinit-backups/download")
def project_reinit_backup_download(name: str = Query(..., max_length=120)):
    fn = (name or "").strip()
    if not _REINIT_TAR_RE.match(fn):
        raise HTTPException(400, "非法文件名")
    p = (_reinit_backup_dir() / fn).resolve()
    if not str(p).startswith(str(_reinit_backup_dir().resolve()) + os.sep) or not p.is_file():
        raise HTTPException(404, "不存在")
    return FileResponse(str(p), filename=fn, media_type="application/gzip")


class ProjectInitBody(BaseModel):
    project_id: str = Field(..., min_length=2, max_length=64)


@router.post("/project/init")
def project_init_run(body: ProjectInitBody):
    """首次初始化：等价于 bash ai-sop-ops/init-ai-project.sh <project_id>（工作目录为项目根）。"""
    pid = body.project_id.strip()
    if not _PROJECT_ID_RE.match(pid):
        raise HTTPException(400, "project_id 须为 2–64 位：字母或数字开头，仅含字母、数字、下划线、连字符")
    return _run_init_script([pid], timeout=600)


class ProjectReinitBody(BaseModel):
    """重置前必须在 confirm_phrase 填入固定口令 REINIT。"""

    confirm_phrase: str = Field(..., min_length=1, max_length=32)
    project_id: str = Field("", max_length=64)
    keep_claude_md: bool = False


@router.post("/project/reinit")
def project_reinit_run(body: ProjectReinitBody):
    """重新初始化：脚本会先打 reinit 备份包（除非显式关掉），再清理并 init。非 TTY 下自动带 -y。"""
    if (body.confirm_phrase or "").strip() != "REINIT":
        raise HTTPException(400, "confirm_phrase 必须精确为 REINIT 以确认危险操作")
    args: List[str] = ["reinit", "-y"]
    if body.keep_claude_md:
        args.append("--keep-claude-md")
    pid = (body.project_id or "").strip()
    if pid:
        if not _PROJECT_ID_RE.match(pid):
            raise HTTPException(400, "非法 project_id")
        args.append(pid)
    elif not _state_file().is_file():
        raise HTTPException(400, "未填写 project_id 且不存在 memory/current_state.json，无法推断项目名")
    return _run_init_script(args, timeout=900)
