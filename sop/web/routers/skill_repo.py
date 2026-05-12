"""技能仓库：自定义仓库、版本管理、开启/关闭/卸载"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from pathlib import Path
import json, os, subprocess, shutil

router = APIRouter(prefix="/api/skill-repo", tags=["skill-repo"])
REPO_DIR = Path(os.getenv("PROJECT_PATH", ".")) / ".ai-memory" / "skill-repos"
REPO_DIR.mkdir(parents=True, exist_ok=True)
INSTALLED_FILE = REPO_DIR / "installed.json"

def _load_installed():
    return json.loads(INSTALLED_FILE.read_text()) if INSTALLED_FILE.exists() else {}

def _save_installed(d):
    INSTALLED_FILE.write_text(json.dumps(d, indent=2, ensure_ascii=False))

class RepoConfig(BaseModel):
    id: str; name: str; url: str; description: str = ""; branch: str = "main"

class SkillInstall(BaseModel):
    repo_id: str; skill_id: str; version: str = "latest"

@router.get("/repos")
def list_repos():
    repos = []
    for f in sorted(REPO_DIR.glob("repo_*.json")):
        try: repos.append(json.loads(f.read_text()))
        except Exception: pass
    return repos

@router.post("/repos")
def add_repo(body: RepoConfig):
    f = REPO_DIR / f"repo_{body.id}.json"
    f.write_text(json.dumps(body.dict(), ensure_ascii=False, indent=2))
    return {"ok": True, "id": body.id}

@router.delete("/repos/{repo_id}")
def remove_repo(repo_id: str):
    f = REPO_DIR / f"repo_{repo_id}.json"
    if f.exists(): f.unlink()
    return {"ok": True}

@router.post("/repos/{repo_id}/sync")
def sync_repo(repo_id: str):
    """从 git 仓库同步技能列表"""
    f = REPO_DIR / f"repo_{repo_id}.json"
    if not f.exists(): raise HTTPException(404, "Repo not found")
    repo = json.loads(f.read_text())
    clone_dir = REPO_DIR / f"clone_{repo_id}"
    try:
        if clone_dir.exists():
            r = subprocess.run(["git","pull"], capture_output=True, text=True, cwd=str(clone_dir), timeout=30)
        else:
            r = subprocess.run(["git","clone","--depth=1","-b",repo.get("branch","main"),repo["url"],str(clone_dir)],
                               capture_output=True, text=True, timeout=60)
        if r.returncode != 0: return {"ok": False, "error": r.stderr[:300]}
        # 扫描技能文件
        skills = []
        for sf in sorted(clone_dir.rglob("skill.json")):
            try:
                s = json.loads(sf.read_text())
                s["_path"] = str(sf.relative_to(clone_dir))
                s["_repo"] = repo_id
                skills.append(s)
            except Exception: pass
        repo["skills"] = skills; repo["synced"] = True
        f.write_text(json.dumps(repo, ensure_ascii=False, indent=2))
        return {"ok": True, "skills_found": len(skills)}
    except Exception as e: return {"ok": False, "error": str(e)}

@router.get("/installed")
def list_installed():
    return _load_installed()

@router.post("/install")
def install_skill(body: SkillInstall):
    installed = _load_installed()
    key = f"{body.repo_id}/{body.skill_id}"
    installed[key] = {"repo_id": body.repo_id, "skill_id": body.skill_id,
                      "version": body.version, "enabled": True}
    _save_installed(installed); return {"ok": True}

@router.patch("/installed/{key:path}/toggle")
def toggle_skill(key: str):
    installed = _load_installed()
    if key not in installed: raise HTTPException(404, "Not installed")
    installed[key]["enabled"] = not installed[key].get("enabled", True)
    _save_installed(installed); return {"ok": True, "enabled": installed[key]["enabled"]}

@router.delete("/installed/{key:path}")
def uninstall_skill(key: str):
    installed = _load_installed()
    installed.pop(key, None); _save_installed(installed); return {"ok": True}

@router.post("/import")
async def import_skill(content: str, skill_id: str, version: str = "1.0.0"):
    """直接导入技能 JSON"""
    try:
        skill_data = json.loads(content)
        skill_data["_imported"] = True; skill_data["version"] = version
        installed = _load_installed()
        key = f"imported/{skill_id}"
        installed[key] = {"repo_id": "imported", "skill_id": skill_id,
                          "version": version, "enabled": True, "data": skill_data}
        _save_installed(installed); return {"ok": True, "key": key}
    except Exception as e: raise HTTPException(400, str(e))
