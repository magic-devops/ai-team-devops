"""
@module: routers.hmac_middleware
@purpose: 服务端 HMAC + ts + nonce 鉴权（对应 sop_sdk.security.HmacAuth / Go security/hmac.go）
@stable: 协议头与签名串格式固定（v1）
@ai_safe_edit:
  - 改时间窗 / nonce TTL：调下面常量
  - 改 nonce 后端：替换 _NonceStore（M9 接 Redis SETNX EX）
@deps_in: starlette, sqlalchemy（ApiKey 查询）
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
from threading import RLock
from typing import Awaitable, Callable, Optional

from fastapi import Request
from starlette.responses import JSONResponse, Response

_log = logging.getLogger("sop.hmac")

# 配置项
_TS_WINDOW_SECONDS = int(os.getenv("SOP_HMAC_WINDOW", "300"))     # ±5 min
_NONCE_TTL_SECONDS = int(os.getenv("SOP_HMAC_NONCE_TTL", "600"))  # 10 min
_ENFORCE = (os.getenv("SOP_HMAC_ENFORCE", "0") == "1")  # 默认不强制，给迁移期


class _NonceStore:
    """进程级 LRU + TTL；M9 改为 Redis SET NX EX。"""

    def __init__(self, capacity: int = 100_000) -> None:
        self._d: dict[str, float] = {}
        self._lock = RLock()
        self._cap = capacity

    def seen_or_record(self, nonce: str, ttl: int) -> bool:
        now = time.time()
        with self._lock:
            if len(self._d) > self._cap:
                cutoff = now
                for k in list(self._d.keys())[: self._cap // 2]:
                    if self._d[k] < cutoff:
                        self._d.pop(k, None)
            if nonce in self._d and self._d[nonce] > now:
                return True
            self._d[nonce] = now + ttl
            return False


_nonce_store = _NonceStore()


def _err(status: int, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail})


def _lookup_api_key(raw_key: str) -> Optional[dict[str, str]]:
    """从 ApiKey 表查询 key_hash 匹配；返回 {tenant_id, user_id} 或 None。"""
    try:
        from routers.sql_models import ApiKey, SessionLocal
    except Exception:  # pragma: no cover
        return None
    h = hashlib.sha256(raw_key.encode()).hexdigest()
    db = SessionLocal()
    try:
        row = (
            db.query(ApiKey)
            .filter(ApiKey.key_hash == h, ApiKey.status.in_(("active", "rotating")))
            .first()
        )
        if not row:
            return None
        if row.expires_at and row.expires_at.timestamp() < time.time():
            return None
        return {"tenant_id": row.tenant_id, "user_id": row.user_id, "id": row.id}
    finally:
        db.close()


async def hmac_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """如带 X-Api-Key 头：执行 HMAC 鉴权；否则放行。

    强制模式（SOP_HMAC_ENFORCE=1）下，凡是匹配到 X-Api-Key 但签名错误 → 401。
    宽松模式下，签名失败 / 缺头 仅记录日志，不阻断（兼容老脚本）。
    """
    if request.method == "OPTIONS":
        return await call_next(request)
    api_key = (request.headers.get("X-Api-Key") or "").strip()
    if not api_key:
        return await call_next(request)

    ts = (request.headers.get("X-Sop-Timestamp") or "").strip()
    nonce = (request.headers.get("X-Sop-Nonce") or "").strip()
    sig_header = (request.headers.get("X-Sop-Signature") or "").strip()
    if not (ts and nonce and sig_header):
        msg = "缺少 X-Sop-Timestamp / X-Sop-Nonce / X-Sop-Signature"
        if _ENFORCE:
            return _err(401, msg)
        _log.warning("hmac %s; 放行（非强制模式）", msg)
        return await call_next(request)

    # 时间漂移
    try:
        ts_i = int(ts)
    except ValueError:
        return _err(401, "X-Sop-Timestamp 非整数") if _ENFORCE else await call_next(request)
    skew = abs(time.time() - ts_i)
    if skew > _TS_WINDOW_SECONDS:
        msg = f"时间漂移过大：{skew}s > {_TS_WINDOW_SECONDS}s"
        return _err(401, msg) if _ENFORCE else await call_next(request)

    # 防重放
    if _nonce_store.seen_or_record(nonce, _NONCE_TTL_SECONDS):
        msg = "nonce 重复"
        return _err(401, msg) if _ENFORCE else await call_next(request)

    # body
    body = await request.body()
    body_hash = hashlib.sha256(body or b"").hexdigest()

    # 重建签名
    method = request.method.upper()
    path = request.url.path
    canonical = f"{method}\n{path}\n{ts}\n{nonce}\n{body_hash}".encode()
    expected = "sha256=" + hmac.new(api_key.encode(), canonical, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig_header):
        msg = "签名不匹配"
        if _ENFORCE:
            return _err(401, msg)
        _log.warning("hmac mismatch; path=%s 放行（非强制）", path)
        return await call_next(request)

    # 查 ApiKey 解析租户/用户（可选）
    owner = _lookup_api_key(api_key)
    if owner:
        # 将身份贴到 state 上，下游路由可读取
        request.state.api_key_owner = owner

    # 将 body 重新塞回（FastAPI 默认会缓存，二次读取需要这步）
    async def _receive() -> dict:
        return {"type": "http.request", "body": body, "more_body": False}

    request._receive = _receive  # type: ignore[attr-defined]
    return await call_next(request)
