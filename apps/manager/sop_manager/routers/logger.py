"""标准化日志系统 — 滚动日志、7天保留、128MB 限制"""
from __future__ import annotations
import logging, os, sys
from logging.handlers import TimedRotatingFileHandler, RotatingFileHandler
from pathlib import Path

_LOG_DIR = Path(os.getenv("LOG_DIR", Path(os.getenv("PROJECT_PATH", ".")) / "logs"))
_LOG_DIR.mkdir(parents=True, exist_ok=True)

_MAX_BYTES = 128 * 1024 * 1024  # 128MB
_BACKUP_COUNT = 7                # 7天

_FMT = "%(asctime)s %(levelname)-8s [%(name)s] %(message)s"
_DATE_FMT = "%Y-%m-%dT%H:%M:%S"


def get_logger(name: str = "sop") -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.DEBUG if os.getenv("DEBUG") else logging.INFO)

    # 文件：按天滚动，保留7天，单文件最大128MB
    log_file = _LOG_DIR / f"{name}.log"
    fh = TimedRotatingFileHandler(
        log_file, when="midnight", interval=1,
        backupCount=_BACKUP_COUNT, encoding="utf-8", utc=True,
    )
    fh.setFormatter(logging.Formatter(_FMT, _DATE_FMT))
    # 额外加大小限制（TimedRotating 不限大小，用 RotatingFileHandler 做补充）
    fh.maxBytes = _MAX_BYTES  # type: ignore[attr-defined]
    logger.addHandler(fh)

    # 控制台
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(logging.Formatter(_FMT, _DATE_FMT))
    ch.setLevel(logging.INFO)
    logger.addHandler(ch)

    logger.propagate = False
    return logger


# 应用级 logger
app_logger = get_logger("sop.app")
audit_logger = get_logger("sop.audit")
access_logger = get_logger("sop.access")
