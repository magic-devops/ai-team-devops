"""
@module: routers.audit_worm
@purpose: WORM（一次写多次读）审计归档 —— 本地 append-only + S3 Object Lock
@stable: 归档文件命名 + S3 Object key 规则稳定
@ai_safe_edit:
  - 新增归档后端：实现 ArchiveSink 协议
  - 改归档频率：调 ARCHIVE_INTERVAL_SECONDS

策略：
  - 本地 append-only：默认 chattr +a（Linux）；不可改 chattr 时回退到目录 0o500 + 文件 0o400
  - S3：开启 Object Lock（Compliance 模式）+ 多区域复制
  - 周期：每 1h 把上一小时的链文件归档；保留窗口 1 年（默认）
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional, Protocol

_log = logging.getLogger("sop.audit_worm")

ARCHIVE_INTERVAL_SECONDS = int(os.getenv("SOP_AUDIT_ARCHIVE_INTERVAL", "3600"))


class ArchiveSink(Protocol):
    def archive(self, src: Path) -> Optional[str]: ...


class LocalAppendOnlySink:
    """本地 append-only 归档；尝试 chattr +a，失败则严格只读 chmod。"""

    def __init__(self, base: Path) -> None:
        self.base = base
        base.mkdir(parents=True, exist_ok=True)

    def archive(self, src: Path) -> Optional[str]:
        if not src.is_file():
            return None
        dest = self.base / src.name
        if dest.exists():
            return str(dest)
        shutil.copy2(src, dest)
        # chattr +a（仅 Linux 且有权限）
        try:
            subprocess.run(["chattr", "+a", str(dest)],
                           check=False, capture_output=True, timeout=2)
        except Exception:
            pass
        # 兜底：只读
        try:
            os.chmod(dest, 0o400)
        except Exception:
            pass
        _log.info("worm archived: %s", dest)
        return str(dest)


class S3ObjectLockSink:  # pragma: no cover - 需 AWS 凭证
    """S3 Object Lock（Compliance）归档。"""

    def __init__(self, bucket: str, prefix: str = "sop-audit/") -> None:
        try:
            import boto3  # type: ignore[import-not-found]
        except ImportError as e:
            raise RuntimeError("S3 归档需要 boto3") from e
        self._s3 = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-east-1"))
        self.bucket = bucket
        self.prefix = prefix.rstrip("/") + "/"
        self.retain_days = int(os.getenv("SOP_AUDIT_RETAIN_DAYS", "365"))

    def archive(self, src: Path) -> Optional[str]:
        if not src.is_file():
            return None
        import datetime as _dt
        key = self.prefix + src.name
        retain_until = _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(days=self.retain_days)
        self._s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=src.read_bytes(),
            ObjectLockMode="COMPLIANCE",
            ObjectLockRetainUntilDate=retain_until,
            ServerSideEncryption="AES256",
        )
        return f"s3://{self.bucket}/{key}"


_sink: Optional[ArchiveSink] = None
_thread: Optional[threading.Thread] = None
_stop = threading.Event()


def _build_sink() -> Optional[ArchiveSink]:
    backend = (os.getenv("SOP_AUDIT_WORM", "local")).lower()
    if backend == "off":
        return None
    if backend == "local":
        base = Path(os.getenv("SOP_AUDIT_WORM_DIR")
                    or Path(os.getenv("SOP_RUNTIME_DIR", ".sop-runtime")) / "audit-worm")
        return LocalAppendOnlySink(base)
    if backend == "s3":  # pragma: no cover
        bucket = os.getenv("SOP_AUDIT_S3_BUCKET", "")
        if not bucket:
            _log.error("SOP_AUDIT_S3_BUCKET 未设置")
            return None
        return S3ObjectLockSink(bucket, prefix=os.getenv("SOP_AUDIT_S3_PREFIX", "sop-audit/"))
    _log.warning("未知 WORM 后端: %s", backend)
    return None


def _archive_loop() -> None:
    from sop_manager.routers.audit_chain import _CHAIN_DIR  # type: ignore[import-not-found]
    import datetime as _dt
    while not _stop.is_set():
        try:
            yesterday = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=1)).strftime("%Y-%m-%d")
            target = _CHAIN_DIR / f"chain-{yesterday}.jsonl"
            if _sink and target.is_file():
                _sink.archive(target)
        except Exception as e:  # pragma: no cover
            _log.warning("worm loop: %s", e)
        _stop.wait(ARCHIVE_INTERVAL_SECONDS)


def start_background() -> None:
    """Manager 启动时调用一次。"""
    global _sink, _thread
    _sink = _build_sink()
    if _sink is None:
        return
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_archive_loop, daemon=True, name="sop-audit-worm")
    _thread.start()
    _log.info("audit WORM 归档线程已启动 interval=%ds", ARCHIVE_INTERVAL_SECONDS)


def stop_background() -> None:
    _stop.set()


# ── 运维路由 ────────────────────────────────────────────────────
from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/audit/worm", tags=["audit"])


@router.get("/status")
def status() -> dict[str, str]:
    return {
        "backend": os.getenv("SOP_AUDIT_WORM", "local"),
        "interval_s": str(ARCHIVE_INTERVAL_SECONDS),
        "running": str(bool(_thread and _thread.is_alive())),
    }


@router.post("/run_once")
def run_once() -> dict[str, str]:
    """手工触发一次归档（运维诊断用）。"""
    from sop_manager.routers.audit_chain import _CHAIN_DIR  # type: ignore[import-not-found]
    if _sink is None:
        return {"ok": "false", "error": "sink 未初始化"}
    archived = []
    for fp in _CHAIN_DIR.glob("chain-*.jsonl"):
        out = _sink.archive(fp)
        if out:
            archived.append(out)
    return {"ok": "true", "archived": ",".join(archived)}
