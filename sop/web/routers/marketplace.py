"""
@module: routers.marketplace
@purpose: 规约 / 技能市场 —— Git 仓库为单元发现、安装、评分、签名验证
@stable: /api/v1/marketplace/* 路径稳定
@ai_safe_edit:
  - 新增 registry：在 _DEFAULT_REGISTRIES 加 URL；自动生效
  - 改签名算法：bump 包 manifest.signature.alg；旧条目仍可装但标记 warning
@deps_in: httpx（已是 manager 依赖）

市场单元（package）描述 manifest.yaml：
  name: java-spring-spec
  version: 1.2.0
  type: spec | skill | template | rule-pack
  description: ...
  authors: [...]
  homepage: https://...
  license: MIT
  files: [specs/backend/JAVA_SPEC.md, ...]
  signature:
    alg: sha256
    digest: <hex>
  rating:
    avg: 4.6
    count: 312
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

_log = logging.getLogger("sop.marketplace")
router = APIRouter(prefix="/api/v1/marketplace", tags=["marketplace"])

_DEFAULT_REGISTRIES = [
    # 官方默认 registry index（部署时可在前端添加私有 registry）
    "https://raw.githubusercontent.com/magic-devops/sop-marketplace/main/index.json",
]
_CACHE_TTL_SECONDS = 600
_INSTALL_DIR = Path(os.getenv("SOP_MARKETPLACE_DIR")
                    or Path(os.getenv("SOP_RUNTIME_DIR", ".sop-runtime")) / "marketplace")


@dataclass
class Package:
    name: str
    version: str
    type: str
    description: str = ""
    authors: list[str] = field(default_factory=list)
    homepage: str = ""
    license: str = "MIT"
    files: list[str] = field(default_factory=list)
    signature: dict[str, str] = field(default_factory=dict)
    rating: dict[str, Any] = field(default_factory=lambda: {"avg": 0.0, "count": 0})
    repo: str = ""
    registry: str = ""


_cache: dict[str, Any] = {"at": 0.0, "items": []}


def _registries() -> list[str]:
    extra = [u.strip() for u in (os.getenv("SOP_MARKETPLACE_REGISTRIES") or "").split(",") if u.strip()]
    return _DEFAULT_REGISTRIES + extra


def _fetch_index(url: str) -> list[dict[str, Any]]:
    try:
        with httpx.Client(timeout=8.0) as c:
            r = c.get(url)
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict):
                data = data.get("packages", [])
            return data
    except Exception as e:
        _log.warning("registry fetch failed %s: %s", url, e)
        return []


def refresh_cache(force: bool = False) -> list[Package]:
    if not force and time.time() - _cache["at"] < _CACHE_TTL_SECONDS and _cache["items"]:
        return _cache["items"]
    items: list[Package] = []
    for reg in _registries():
        for d in _fetch_index(reg):
            try:
                items.append(Package(
                    name=d["name"], version=d.get("version", "0.0.1"),
                    type=d.get("type", "skill"),
                    description=d.get("description", ""),
                    authors=d.get("authors", []),
                    homepage=d.get("homepage", ""),
                    license=d.get("license", "MIT"),
                    files=d.get("files", []),
                    signature=d.get("signature", {}),
                    rating=d.get("rating", {"avg": 0.0, "count": 0}),
                    repo=d.get("repo", ""),
                    registry=reg,
                ))
            except Exception as e:
                _log.warning("skip pkg in %s: %s", reg, e)
    _cache["at"] = time.time()
    _cache["items"] = items
    return items


# ── 路由 ────────────────────────────────────────────────────────
class InstallIn(BaseModel):
    name: str
    version: Optional[str] = None
    target_dir: Optional[str] = None
    verify_signature: bool = True


class RatingIn(BaseModel):
    package: str
    score: int = Field(ge=1, le=5)
    comment: str = ""


@router.get("/registries")
def list_registries() -> dict[str, Any]:
    return {"items": _registries()}


@router.get("/packages")
def list_packages(
    q: str = "",
    type: str = "",
    sort: str = "rating",
    page: int = 1,
    size: int = 30,
) -> dict[str, Any]:
    items = refresh_cache()
    if q:
        ql = q.lower()
        items = [p for p in items if ql in p.name.lower() or ql in p.description.lower()]
    if type:
        items = [p for p in items if p.type == type]
    if sort == "rating":
        items = sorted(items, key=lambda p: p.rating.get("avg", 0), reverse=True)
    elif sort == "name":
        items = sorted(items, key=lambda p: p.name)
    elif sort == "newest":
        items = sorted(items, key=lambda p: p.version, reverse=True)
    total = len(items)
    items = items[(page - 1) * size: page * size]
    return {
        "items": [_to_dict(p) for p in items],
        "total": total, "page": page, "size": size,
    }


@router.get("/packages/{name}")
def get_package(name: str) -> dict[str, Any]:
    items = refresh_cache()
    for p in items:
        if p.name == name:
            return _to_dict(p)
    raise HTTPException(404)


@router.post("/refresh")
def refresh() -> dict[str, int]:
    items = refresh_cache(force=True)
    return {"total": len(items)}


@router.post("/install")
def install(body: InstallIn) -> dict[str, Any]:
    pkg = _find(body.name)
    if not pkg:
        raise HTTPException(404, "package not found")
    if body.version and body.version != pkg.version:
        raise HTTPException(409, f"only latest ({pkg.version}) currently available")
    target = Path(body.target_dir or _INSTALL_DIR / pkg.name)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        shutil.rmtree(target)

    if not pkg.repo:
        raise HTTPException(400, "package 缺少 repo 字段（无法下载）")

    with tempfile.TemporaryDirectory() as tmp:
        rc = subprocess.call(
            ["git", "clone", "--depth", "1", "--branch", "v" + pkg.version, pkg.repo, tmp],
            stdout=subprocess.DEVNULL,
        )
        if rc != 0:
            # 尝试 main 分支
            shutil.rmtree(tmp, ignore_errors=True)
            os.makedirs(tmp, exist_ok=True)
            rc = subprocess.call(["git", "clone", "--depth", "1", pkg.repo, tmp],
                                 stdout=subprocess.DEVNULL)
            if rc != 0:
                raise HTTPException(502, "git clone 失败")

        # 签名校验：sha256 over 所有 files 的连接
        if body.verify_signature and pkg.signature.get("alg") == "sha256":
            digest = _sha256_of_files(Path(tmp), pkg.files)
            expect = pkg.signature.get("digest", "")
            if expect and digest != expect:
                raise HTTPException(400, f"签名不匹配 expected={expect} got={digest}")

        shutil.copytree(tmp, target, dirs_exist_ok=True)

    # 写入安装记录
    record = {
        "name": pkg.name, "version": pkg.version, "type": pkg.type,
        "installed_at": time.time(), "target": str(target),
    }
    rec_path = _INSTALL_DIR / "_installed.json"
    rec_path.parent.mkdir(parents=True, exist_ok=True)
    existing = []
    if rec_path.exists():
        try:
            existing = json.loads(rec_path.read_text(encoding="utf-8"))
        except Exception:
            existing = []
    existing = [r for r in existing if r["name"] != pkg.name] + [record]
    rec_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")

    return record


@router.get("/installed")
def installed() -> list[dict[str, Any]]:
    rec = _INSTALL_DIR / "_installed.json"
    if not rec.exists():
        return []
    try:
        return json.loads(rec.read_text(encoding="utf-8"))
    except Exception:
        return []


@router.delete("/installed/{name}")
def uninstall(name: str) -> dict[str, str]:
    target = _INSTALL_DIR / name
    if target.exists():
        shutil.rmtree(target)
    rec = _INSTALL_DIR / "_installed.json"
    if rec.exists():
        existing = json.loads(rec.read_text(encoding="utf-8"))
        existing = [r for r in existing if r["name"] != name]
        rec.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": "true"}


@router.post("/rate")
def rate(body: RatingIn) -> dict[str, str]:
    """评分聚合落本地 JSON；生产可上送官方 registry。"""
    path = _INSTALL_DIR / "_ratings.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps({
            "ts": time.time(), "id": str(uuid.uuid4()),
            "package": body.package, "score": body.score, "comment": body.comment,
        }, ensure_ascii=False) + "\n")
    return {"ok": "true"}


def _find(name: str) -> Optional[Package]:
    for p in refresh_cache():
        if p.name == name:
            return p
    return None


def _to_dict(p: Package) -> dict[str, Any]:
    return {
        "name": p.name, "version": p.version, "type": p.type,
        "description": p.description, "authors": p.authors,
        "homepage": p.homepage, "license": p.license,
        "repo": p.repo, "files": p.files,
        "rating": p.rating, "signature": p.signature,
        "registry": p.registry,
    }


def _sha256_of_files(root: Path, files: list[str]) -> str:
    h = hashlib.sha256()
    for rel in sorted(files):
        p = root / rel
        if not p.is_file():
            continue
        h.update(rel.encode())
        h.update(b"|")
        h.update(p.read_bytes())
        h.update(b"\n")
    return h.hexdigest()
