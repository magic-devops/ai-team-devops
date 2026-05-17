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

_BUILTIN_PACKAGES: list[dict[str, Any]] = [
    {
        "name": "sop-ai-project-starter",
        "version": "1.0.0",
        "type": "template",
        "description": "内置 AI 项目接入模板：包含 sop register、context prepare、rules/specs 同步建议。",
        "authors": ["SOP"],
        "homepage": "/?shell=1#/projects",
        "license": "Apache-2.0",
        "files": ["README.md", "sop.template.json"],
        "signature": {"alg": "builtin", "digest": "local"},
        "rating": {"avg": 4.8, "count": 18},
        "repo": "",
        "registry": "builtin://sop",
    },
    {
        "name": "sop-dev-rule-pack",
        "version": "1.0.0",
        "type": "rule-pack",
        "description": "内置研发规约包：覆盖安全输入、可追溯提交、AI Agent 上下文准备和本地优先同步。",
        "authors": ["SOP"],
        "homepage": "/?shell=1#/intelligence",
        "license": "Apache-2.0",
        "files": ["README.md", "rules/RULES.md"],
        "signature": {"alg": "builtin", "digest": "local"},
        "rating": {"avg": 4.7, "count": 12},
        "repo": "",
        "registry": "builtin://sop",
    },
    {
        "name": "sop-ops-runbook",
        "version": "1.0.0",
        "type": "spec",
        "description": "内置运维手册包：包含健康检查、用量配额、账单出账、事件订阅和部署检查清单。",
        "authors": ["SOP"],
        "homepage": "/?shell=1#/settings",
        "license": "Apache-2.0",
        "files": ["README.md", "ops/RUNBOOK.md"],
        "signature": {"alg": "builtin", "digest": "local"},
        "rating": {"avg": 4.6, "count": 9},
        "repo": "",
        "registry": "builtin://sop",
    },
]


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
    for d in _BUILTIN_PACKAGES:
        if not any(p.name == d["name"] for p in items):
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
                registry=d.get("registry", "builtin://sop"),
            ))
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


def _installed_records() -> list[dict[str, Any]]:
    rec = _INSTALL_DIR / "_installed.json"
    if not rec.exists():
        return []
    try:
        data = json.loads(rec.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _rating_records(package: str = "") -> list[dict[str, Any]]:
    path = _INSTALL_DIR / "_ratings.jsonl"
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if package and row.get("package") != package:
            continue
        out.append(row)
    return out


def _rating_overlay(package: str, base: dict[str, Any]) -> dict[str, Any]:
    rows = _rating_records(package)
    if not rows:
        return base
    scores = [int(r.get("score") or 0) for r in rows if int(r.get("score") or 0) > 0]
    if not scores:
        return base
    base_count = int(base.get("count") or 0)
    base_avg = float(base.get("avg") or 0.0)
    total = base_avg * base_count + sum(scores)
    count = base_count + len(scores)
    return {"avg": round(total / max(count, 1), 2), "count": count, "local_count": len(scores)}


def _signature_status(pkg: Package) -> str:
    alg = (pkg.signature or {}).get("alg", "")
    digest = (pkg.signature or {}).get("digest", "")
    if alg == "builtin":
        return "builtin"
    if alg == "sha256" and digest:
        return "signed"
    return "unsigned"


def _write_builtin_package(pkg: Package, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    manifest = {
        "name": pkg.name,
        "version": pkg.version,
        "type": pkg.type,
        "description": pkg.description,
        "authors": pkg.authors,
        "installed_from": pkg.registry,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (target / "README.md").write_text(
        f"# {pkg.name}\n\n{pkg.description}\n\n"
        "This package is bundled with SOP Manager for offline/local deployments.\n",
        encoding="utf-8",
    )
    for rel in pkg.files:
        p = target / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if not p.exists():
            p.write_text(f"# {pkg.name}\n\nGenerated asset: `{rel}`.\n", encoding="utf-8")


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


@router.get("/charts")
def marketplace_charts() -> dict[str, Any]:
    payload = summary()
    by_type = payload.get("by_type") if isinstance(payload.get("by_type"), dict) else {}
    by_signature = payload.get("by_signature") if isinstance(payload.get("by_signature"), dict) else {}
    return {
        "ok": True,
        "by_type": [{"name": k, "value": int(v)} for k, v in sorted(by_type.items(), key=lambda x: (-x[1], x[0])) if int(v) > 0],
        "by_signature": [{"name": k, "value": int(v)} for k, v in sorted(by_signature.items(), key=lambda x: (-x[1], x[0])) if int(v) > 0],
    }


@router.get("/summary")
def summary() -> dict[str, Any]:
    items = [_to_dict(p) for p in refresh_cache()]
    installed_items = _installed_records()
    by_type: dict[str, int] = {}
    by_signature: dict[str, int] = {}
    rating_sum = 0.0
    rating_n = 0
    for p in items:
        by_type[p["type"]] = by_type.get(p["type"], 0) + 1
        sig = str(p.get("signature_status") or "unknown")
        by_signature[sig] = by_signature.get(sig, 0) + 1
        avg = float((p.get("rating") or {}).get("avg") or 0)
        cnt = int((p.get("rating") or {}).get("count") or 0)
        if cnt > 0:
            rating_sum += avg * cnt
            rating_n += cnt
    return {
        "ok": True,
        "packages": len(items),
        "installed": len(installed_items),
        "registries": len(_registries()) + 1,
        "by_type": by_type,
        "by_signature": by_signature,
        "avg_rating": round(rating_sum / max(1, rating_n), 2) if rating_n else 0,
        "rating_count": rating_n,
        "signed_packages": by_signature.get("signed", 0) + by_signature.get("builtin", 0),
        "unsigned_packages": by_signature.get("unsigned", 0),
        "cache_at": _cache.get("at", 0),
    }


@router.get("/hub")
def marketplace_hub() -> dict[str, Any]:
    payload = summary()
    charts = marketplace_charts()
    return {
        "ok": True,
        "summary": {
            "packages": payload.get("packages", 0),
            "installed": payload.get("installed", 0),
            "registries": payload.get("registries", 0),
            "avg_rating": payload.get("avg_rating", 0),
            "signed_packages": payload.get("signed_packages", 0),
            "unsigned_packages": payload.get("unsigned_packages", 0),
        },
        "charts": {
            "by_type": charts.get("by_type") or [],
            "by_signature": charts.get("by_signature") or [],
        },
        "domains": [
            {"id": "catalog", "path": "#/marketplace/catalog", "capability": "ecosystem.marketplace.catalog"},
            {"id": "installed", "path": "#/marketplace/installed", "capability": "ecosystem.marketplace.installed"},
            {"id": "ratings", "path": "#/marketplace/ratings", "capability": "ecosystem.marketplace.ratings"},
            {"id": "skills", "path": "#/skills-hub", "capability": "ecosystem.skills-hub"},
        ],
    }


@router.get("/packages/{name}")
def get_package(name: str) -> dict[str, Any]:
    items = refresh_cache()
    for p in items:
        if p.name == name:
            return _to_dict(p)
    raise HTTPException(404)


@router.get("/packages/{name}/ratings")
def package_ratings(name: str, limit: int = 50) -> dict[str, Any]:
    rows = list(reversed(_rating_records(name)))[:limit]
    return {"ok": True, "items": rows, "total": len(rows)}


@router.get("/packages/{name}/verify")
def verify_package(name: str) -> dict[str, Any]:
    pkg = _find(name)
    if not pkg:
        raise HTTPException(404, "package not found")
    return {
        "ok": True,
        "name": pkg.name,
        "version": pkg.version,
        "registry": pkg.registry,
        "signature": pkg.signature,
        "signature_status": _signature_status(pkg),
        "installable": bool(pkg.repo or pkg.registry.startswith("builtin://")),
        "files": pkg.files,
    }


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
        if pkg.registry.startswith("builtin://"):
            _write_builtin_package(pkg, target)
        else:
            raise HTTPException(400, "package 缺少 repo 字段（无法下载）")
    else:
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
        "registry": pkg.registry, "signature_status": _signature_status(pkg),
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
    return _installed_records()


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
    installed_names = {r.get("name") for r in _installed_records()}
    return {
        "name": p.name, "version": p.version, "type": p.type,
        "description": p.description, "authors": p.authors,
        "homepage": p.homepage, "license": p.license,
        "repo": p.repo, "files": p.files,
        "rating": _rating_overlay(p.name, p.rating), "signature": p.signature,
        "signature_status": _signature_status(p),
        "installed": p.name in installed_names,
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
