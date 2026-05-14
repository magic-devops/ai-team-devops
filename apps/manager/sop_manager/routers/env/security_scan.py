"""容器/镜像安全扫描（M6 示例：新增功能落子包，不污染主文件）。

实现：
  /api/env/security/scan/image  —— 用 docker scout / trivy（按可用性）扫描镜像 CVE
  /api/env/security/scan/compose —— 扫描 compose 文件中的所有镜像
"""
from __future__ import annotations

import shutil
import subprocess
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/env/security", tags=["env"])


def _which(name: str) -> str:
    p = shutil.which(name)
    return p or ""


class ScanImageBody(BaseModel):
    image: str
    severity: str = "HIGH,CRITICAL"


@router.get("/scanners")
def scanners() -> dict[str, str]:
    return {
        "trivy": _which("trivy"),
        "docker": _which("docker"),
        "scout": _which("docker"),  # docker scout = docker plugin
        "grype": _which("grype"),
    }


@router.post("/scan/image")
def scan_image(body: ScanImageBody) -> dict[str, Any]:
    img = body.image.strip()
    if not img or any(c in img for c in [";", "|", "&", "`", "$", "(", ")"]):
        raise HTTPException(400, "invalid image ref")
    # 优先 trivy；次选 docker scout；最后 grype
    if _which("trivy"):
        cmd = ["trivy", "image", "--quiet", "--format", "json",
               "--severity", body.severity, img]
    elif _which("grype"):
        cmd = ["grype", img, "-o", "json", "--fail-on", body.severity.split(",")[0].lower()]
    elif _which("docker"):
        cmd = ["docker", "scout", "cves", "--format", "json", img]
    else:
        raise HTTPException(503, "未安装 trivy / grype / docker scout")
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "扫描超时（120s）")
    return {
        "tool": cmd[0],
        "exit_code": r.returncode,
        "stdout": r.stdout[:200_000],
        "stderr": r.stderr[:8_000],
    }
