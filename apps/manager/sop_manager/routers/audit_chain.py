"""
@module: routers.audit_chain
@purpose: 审计哈希链 —— 每条审计记录链入前一条 hash，杜绝事后篡改
@stable: 算法 v1：SHA-256(canonical_json(row) || prev_hash)
@ai_safe_edit:
  - 改算法：bump _CHAIN_VERSION + 双链并行迁移期
  - 改 anchor 后端：替换 _anchor_to_object_storage()（默认本地 jsonl）
@deps_in: hashlib, json

数据流：
  写：append_audit(row) → 计算 hash → 写入 audit_logs 表 + 链文件
  验：verify_chain() → 顺序重算 hash，发现断点立即告警

WORM（一次写多次读）实现：
  本地：append-only JSONL（chattr +a 可选）
  云端：S3 Object Lock（Compliance 模式，由 audit_worm.py 同步）
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sop_manager.routers.metrics import current_trace_context

_log = logging.getLogger("sop.audit_chain")
_CHAIN_VERSION = "v1"
_GENESIS = "0" * 64

# 链文件落盘位置（默认 .sop-runtime/audit-chain/）
_CHAIN_DIR = Path(os.getenv("SOP_AUDIT_CHAIN_DIR") or
                  Path(os.getenv("SOP_RUNTIME_DIR", ".sop-runtime")) / "audit-chain")
_lock = threading.RLock()


def _canonical_json(obj: dict) -> str:
    """与服务端验证侧一致：键排序、不带空格、UTF-8。"""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _hash(prev: str, payload: dict) -> str:
    h = hashlib.sha256()
    h.update(prev.encode())
    h.update(b"|")
    h.update(_canonical_json(payload).encode())
    return h.hexdigest()


def _today_path(prefix: str = "chain") -> Path:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _CHAIN_DIR / f"{prefix}-{day}.jsonl"


def _state_path() -> Path:
    return _CHAIN_DIR / "state.json"


def _read_state() -> dict[str, str]:
    p = _state_path()
    if not p.is_file():
        return {"prev_hash": _GENESIS, "version": _CHAIN_VERSION, "count": "0"}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"prev_hash": _GENESIS, "version": _CHAIN_VERSION, "count": "0"}


def _write_state(state: dict[str, str]) -> None:
    _state_path().write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")


def append_audit(action: str, *, user_id: str = "", tenant_id: str = "",
                 project_id: str = "", resource_type: str = "", resource_id: str = "",
                 details: dict[str, Any] | None = None) -> dict[str, str]:
    """写入一条审计链 entry，返回 {hash, prev_hash, ts}。

    线程安全：进程内 lock；多进程部署应改为基于数据库行锁或 advisory lock。
    """
    _CHAIN_DIR.mkdir(parents=True, exist_ok=True)
    trace = current_trace_context()
    normalized_details = details or {}
    payload = {
        "action": action,
        "user_id": user_id,
        "tenant_id": tenant_id,
        "project_id": project_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "trace_id": normalized_details.get("trace_id") or trace["trace_id"],
        "correlation_id": normalized_details.get("correlation_id") or trace["correlation_id"],
        "agent_run_id": normalized_details.get("agent_run_id") or trace.get("agent_run_id", ""),
        "details": normalized_details,
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "v": _CHAIN_VERSION,
    }
    with _lock:
        state = _read_state()
        prev = state.get("prev_hash", _GENESIS)
        h = _hash(prev, payload)
        entry = {"hash": h, "prev_hash": prev, "data": payload}
        # WORM 追加
        with _today_path().open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        # 更新状态
        state["prev_hash"] = h
        state["version"] = _CHAIN_VERSION
        state["count"] = str(int(state.get("count", "0")) + 1)
        _write_state(state)
    return {"hash": h, "prev_hash": prev, "ts": payload["ts"]}


def recent_audit_entries(*, limit: int = 100) -> list[dict[str, Any]]:
    if not _CHAIN_DIR.exists():
        return []
    files = sorted(_CHAIN_DIR.glob("chain-*.jsonl"), reverse=True)
    out: list[dict[str, Any]] = []
    for fp in files:
        try:
            lines = fp.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in reversed(lines):
            try:
                row = json.loads(line)
            except Exception:
                continue
            if isinstance(row, dict):
                out.append(row)
            if len(out) >= limit:
                return out
    return out


def verify_chain(*, max_files: int | None = None) -> dict[str, Any]:
    """顺序重算所有链文件，返回 {ok, total, errors[], head}。"""
    if not _CHAIN_DIR.exists():
        return {"ok": True, "total": 0, "errors": [], "head": _GENESIS}
    files = sorted(p for p in _CHAIN_DIR.glob("chain-*.jsonl"))
    if max_files:
        files = files[-max_files:]
    prev = _GENESIS
    total = 0
    errors: list[dict[str, Any]] = []
    for fp in files:
        with fp.open("r", encoding="utf-8") as f:
            for ln, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except Exception as e:
                    errors.append({"file": fp.name, "line": ln, "err": f"parse: {e}"})
                    continue
                if entry.get("prev_hash") != prev:
                    errors.append({
                        "file": fp.name, "line": ln,
                        "err": "prev_hash mismatch",
                        "expected_prev": prev, "got_prev": entry.get("prev_hash"),
                    })
                expected = _hash(prev, entry.get("data", {}))
                if expected != entry.get("hash"):
                    errors.append({
                        "file": fp.name, "line": ln,
                        "err": "hash mismatch",
                        "expected": expected, "got": entry.get("hash"),
                    })
                prev = entry.get("hash", prev)
                total += 1
    return {"ok": not errors, "total": total, "errors": errors, "head": prev}


def daily_anchor() -> dict[str, str]:
    """每日 anchor：把当天链尾 hash 单独存档（便于外部时间戳服务签名）。"""
    state = _read_state()
    anchor = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "head_hash": state.get("prev_hash", _GENESIS),
        "count": state.get("count", "0"),
        "version": _CHAIN_VERSION,
    }
    p = _CHAIN_DIR / "anchors.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(anchor, ensure_ascii=False) + "\n")
    return anchor


# ── FastAPI 路由 ────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/v1/audit/chain", tags=["audit"])


@router.get("/verify")
def http_verify(max_files: int | None = None) -> dict[str, Any]:
    out = verify_chain(max_files=max_files)
    if not out["ok"]:
        # 仍然返回 200，附带 errors；监控系统需要拿这个字段告警
        return out
    return out


@router.get("/state")
def http_state() -> dict[str, Any]:
    return _read_state()


@router.post("/anchor")
def http_anchor() -> dict[str, Any]:
    return daily_anchor()


@router.post("/test/append")
def http_test_append(action: str = "test") -> dict[str, Any]:
    """开发/测试用；生产应通过其它路由触发审计。"""
    if os.getenv("DEPLOY_ENV", "dev") == "production":
        raise HTTPException(403, "生产禁用：仅供调试")
    return append_audit(action, details={"note": "manual test"})
