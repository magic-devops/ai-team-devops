"""技能仓库：自定义仓库、版本管理、开启/关闭/卸载"""
from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field


from path_config import resolved_ai_memory_root

router = APIRouter(prefix="/api/skill-repo", tags=["skill-repo"])


def _repo_dir() -> Path:
    d = resolved_ai_memory_root() / "skill-repos"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _installed_file() -> Path:
    return _repo_dir() / "installed.json"


def _load_installed():
    p = _installed_file()
    return json.loads(p.read_text()) if p.exists() else {}


def _save_installed(d):
    p = _installed_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, indent=2, ensure_ascii=False))
    id: str; name: str; url: str; description: str = ""; branch: str = "main"

class SkillInstall(BaseModel):
    repo_id: str; skill_id: str; version: str = "latest"

@router.get("/repos")
def list_repos():
    repos = []
    for f in sorted(_repo_dir().glob("repo_*.json")):
        try: repos.append(json.loads(f.read_text()))
        except Exception: pass
    return repos

@router.post("/repos")
def add_repo(body: RepoConfig):
    f = _repo_dir() / f"repo_{body.id}.json"
    f.write_text(json.dumps(body.dict(), ensure_ascii=False, indent=2))
    return {"ok": True, "id": body.id}

@router.delete("/repos/{repo_id}")
def remove_repo(repo_id: str):
    f = _repo_dir() / f"repo_{repo_id}.json"
    if f.exists(): f.unlink()
    return {"ok": True}

@router.post("/repos/{repo_id}/sync")
def sync_repo(repo_id: str):
    """从 git 仓库同步技能列表"""
    f = _repo_dir() / f"repo_{repo_id}.json"
    if not f.exists(): raise HTTPException(404, "Repo not found")
    repo = json.loads(f.read_text())
    clone_dir = _repo_dir() / f"clone_{repo_id}"
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


_SKILL_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$")
_MAX_ZIP_BYTES = 15 * 1024 * 1024


def _validate_skill_id(skill_id: str) -> str:
    sid = (skill_id or "").strip()
    if not _SKILL_ID_RE.match(sid):
        raise HTTPException(400, "技能 ID 须为 1–80 位：字母或数字开头，仅含字母、数字、下划线、点、连字符")
    return sid


def _validate_npm_spec(spec: str) -> str:
    s = (spec or "").strip()
    if not s or len(s) > 200:
        raise HTTPException(400, "npm 包名为空或过长")
    if re.search(r"[\s;&|`$()<>]", s):
        raise HTTPException(400, "npm 包名含非法字符")
    return s


def _persist_imported(skill_id: str, version: str, skill_data: Dict[str, Any]) -> str:
    sid = _validate_skill_id(skill_id)
    ver = (version or "1.0.0").strip()[:32]
    data = dict(skill_data)
    data["_imported"] = True
    data["version"] = ver
    data["skill_id"] = sid
    installed = _load_installed()
    key = f"imported/{sid}"
    installed[key] = {
        "repo_id": "imported",
        "skill_id": sid,
        "version": ver,
        "enabled": True,
        "data": data,
    }
    _save_installed(installed)
    return key


def _find_skill_json_under(root: Path) -> Optional[Path]:
    for p in sorted(root.rglob("skill.json")):
        if p.is_file():
            return p
    return None


def _load_skill_from_npm_pack(spec: str) -> Dict[str, Any]:
    """使用 npm pack 拉取包并解析其中第一个 skill.json（不执行包内脚本）。"""
    tmp = Path(tempfile.mkdtemp(prefix="skill-npm-"))
    try:
        try:
            r = subprocess.run(
                ["npm", "pack", spec, "--pack-destination", str(tmp)],
                capture_output=True,
                text=True,
                timeout=180,
                cwd=str(tmp),
            )
        except FileNotFoundError:
            raise HTTPException(500, "服务器未安装 npm，无法使用 NPM 包导入")
        if r.returncode != 0:
            raise HTTPException(400, f"npm pack 失败: {(r.stderr or r.stdout or '')[:500]}")
        tgzs = list(tmp.glob("*.tgz"))
        if not tgzs:
            raise HTTPException(400, "npm pack 未生成 tgz，请检查包名或 registry 是否可达")
        extract = tmp / "extract"
        extract.mkdir(parents=True)
        with tarfile.open(tgzs[0], "r:gz") as tar:
            tar.extractall(extract)
        sj = _find_skill_json_under(extract)
        if not sj:
            raise HTTPException(400, "包内未找到 skill.json，请改用「技能描述」或上传 ZIP")
        return json.loads(sj.read_text(encoding="utf-8", errors="replace"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _extract_zip_safe(raw: bytes, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        for m in zf.infolist():
            if m.is_dir():
                continue
            name = (m.filename or "").replace("\\", "/")
            if not name or name.startswith("__MACOSX/"):
                continue
            target = (dest / name).resolve()
            if not str(target).startswith(str(root) + os.sep):
                raise HTTPException(400, "ZIP 内路径越界，已拒绝解压")
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(m, "r") as src:
                target.write_bytes(src.read())


class SkillImportVisualBody(BaseModel):
    """可视化导入：表单描述或 npm 包（不含用户手写整段 JSON）。"""

    mode: Literal["descriptor", "npx"] = "descriptor"
    skill_id: str = Field(..., min_length=1, max_length=80)
    version: str = Field("1.0.0", max_length=32)
    name: str = Field("", max_length=200)
    description: str = Field("", max_length=4000)
    agent_role: str = Field("All", max_length=64)
    trigger: str = Field("", max_length=4000)
    execution: str = Field("", max_length=8000)
    npx_package: str = Field("", max_length=200)


@router.post("/import")
def import_skill_visual(body: SkillImportVisualBody):
    """按模式导入技能：descriptor=表单拼装；npx=npm pack 拉包并读取 skill.json。"""
    sid = _validate_skill_id(body.skill_id)
    ver = (body.version or "1.0.0").strip()[:32]

    if body.mode == "descriptor":
        name = (body.name or "").strip() or sid
        skill_data: Dict[str, Any] = {
            "skill_id": sid,
            "name": name,
            "description": (body.description or "").strip(),
            "agent_role": (body.agent_role or "All").strip() or "All",
            "trigger": (body.trigger or "").strip(),
            "execution": (body.execution or "").strip(),
        }
        key = _persist_imported(sid, ver, skill_data)
        return {"ok": True, "key": key, "mode": "descriptor"}

    if body.mode == "npx":
        spec = _validate_npm_spec(body.npx_package)
        skill_data = _load_skill_from_npm_pack(spec)
        if (body.name or "").strip():
            skill_data["name"] = body.name.strip()
        if (body.description or "").strip():
            skill_data["description"] = body.description.strip()
        if (body.agent_role or "").strip():
            skill_data["agent_role"] = body.agent_role.strip()
        if (body.trigger or "").strip():
            skill_data["trigger"] = body.trigger.strip()
        if (body.execution or "").strip():
            skill_data["execution"] = body.execution.strip()
        key = _persist_imported(sid, ver, skill_data)
        return {"ok": True, "key": key, "mode": "npx", "resolved_from": spec}

    raise HTTPException(400, "不支持的 mode")


@router.post("/import/zip")
async def import_skill_zip(
    skill_id: str = Form(...),
    version: str = Form("1.0.0"),
    file: UploadFile = File(...),
):
    """上传 ZIP（内含 skill.json，可位于子目录），解压后导入。"""
    sid = _validate_skill_id(skill_id)
    ver = (version or "1.0.0").strip()[:32]
    raw = await file.read()
    if len(raw) > _MAX_ZIP_BYTES:
        raise HTTPException(400, f"ZIP 超过 {_MAX_ZIP_BYTES // (1024 * 1024)}MB 上限")
    if not raw.startswith(b"PK"):
        raise HTTPException(400, "请上传有效的 ZIP 文件")

    tmp = Path(tempfile.mkdtemp(prefix="skill-zip-"))
    try:
        ext = tmp / "extract"
        _extract_zip_safe(raw, ext)
        sj = _find_skill_json_under(ext)
        if not sj:
            raise HTTPException(400, "ZIP 内未找到 skill.json")
        skill_data = json.loads(sj.read_text(encoding="utf-8", errors="replace"))
        key = _persist_imported(sid, ver, skill_data)
        return {"ok": True, "key": key, "mode": "zip"}
    except zipfile.BadZipFile:
        raise HTTPException(400, "ZIP 文件损坏或格式错误")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
