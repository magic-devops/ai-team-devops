"""系统管理：脚本、配置、记忆、SOP 文档"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
import json, os, subprocess

router = APIRouter(prefix="/api/system", tags=["system"])
PROJECT_PATH = Path(os.getenv("PROJECT_PATH", "."))
SOP_DIR = Path(__file__).parent.parent.parent  # sop/

# ── 脚本管理 ──────────────────────────────────────────────────────
@router.get("/scripts")
def list_scripts():
    tools_dir = SOP_DIR / "tools"
    if not tools_dir.exists(): return []
    return [{"name": f.name, "size": f.stat().st_size,
             "executable": os.access(f, os.X_OK)}
            for f in sorted(tools_dir.iterdir()) if f.is_file()]

@router.get("/scripts/{name}/content")
def get_script(name: str):
    f = (SOP_DIR / "tools" / name).resolve()
    if not str(f).startswith(str(SOP_DIR / "tools")): raise HTTPException(403, "Access denied")
    if not f.exists(): raise HTTPException(404, "Not found")
    return {"content": f.read_text(errors="replace")}

class ScriptUpdate(BaseModel):
    content: str

@router.put("/scripts/{name}")
def update_script(name: str, body: ScriptUpdate):
    f = (SOP_DIR / "tools" / name).resolve()
    if not str(f).startswith(str(SOP_DIR / "tools")): raise HTTPException(403, "Access denied")
    f.write_text(body.content); return {"ok": True}

@router.post("/scripts/{name}/run")
def run_script(name: str):
    f = SOP_DIR / "tools" / name
    if not f.exists(): raise HTTPException(404, "Not found")
    if not f.suffix == ".sh": raise HTTPException(400, "Only .sh scripts allowed")
    try:
        result = subprocess.run(["bash", str(f)], capture_output=True, text=True, timeout=30,
                                cwd=str(PROJECT_PATH))
        return {"stdout": result.stdout[-2000:], "stderr": result.stderr[-500:], "returncode": result.returncode}
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "超时（30s）", "returncode": -1}

# ── 配置管理 ──────────────────────────────────────────────────────
@router.get("/config")
def get_config():
    settings = PROJECT_PATH / ".claude" / "settings.json"
    opencode = PROJECT_PATH / "opencode.json"
    return {
        "claude_settings": json.loads(settings.read_text()) if settings.exists() else {},
        "opencode": json.loads(opencode.read_text()) if opencode.exists() else {},
    }

@router.patch("/config/claude")
def update_claude_config(body: dict):
    f = PROJECT_PATH / ".claude" / "settings.json"
    if not f.exists(): raise HTTPException(404, "settings.json not found")
    cfg = json.loads(f.read_text()); cfg.update(body)
    f.write_text(json.dumps(cfg, indent=2, ensure_ascii=False)); return {"ok": True}

# ── 记忆管理 ──────────────────────────────────────────────────────
@router.get("/memory")
def list_memory():
    mem_dir = PROJECT_PATH / ".ai-memory"
    if not mem_dir.exists(): return {"rules": [], "snapshots": [], "lancedb_tables": []}
    rules = [f.name for f in sorted((mem_dir / "rules").glob("*.md"))] if (mem_dir / "rules").exists() else []
    snaps = [f.name for f in sorted((PROJECT_PATH / "memory" / "snapshots").glob("*.json"))] if (PROJECT_PATH / "memory" / "snapshots").exists() else []
    try:
        import lancedb
        db = lancedb.connect(str(mem_dir / "lancedb"))
        tables = db.table_names()
    except Exception:
        tables = []
    return {"rules": rules, "snapshots": snaps, "lancedb_tables": tables}

@router.get("/memory/rules/{filename}")
def get_rule_file(filename: str):
    f = (PROJECT_PATH / ".ai-memory" / "rules" / filename).resolve()
    if not f.exists(): raise HTTPException(404, "Not found")
    return {"content": f.read_text(errors="replace")}

@router.delete("/memory/snapshots/{filename}")
def delete_snapshot(filename: str):
    f = PROJECT_PATH / "memory" / "snapshots" / filename
    if f.exists(): f.unlink()
    return {"ok": True}

@router.get("/memory/lancedb/{table}/stats")
def table_stats(table_name: str):
    try:
        import lancedb
        db = lancedb.connect(str(PROJECT_PATH / ".ai-memory" / "lancedb"))
        t = db.open_table(table_name)
        df = t.to_pandas()
        return {"table": table_name, "rows": len(df), "columns": list(df.columns)}
    except Exception as e:
        raise HTTPException(500, str(e))
