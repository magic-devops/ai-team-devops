"""
@module: routers.key_rotation
@purpose: API Key 生命周期：创建/列出/轮换/吊销/到期提醒
@stable: 路径 /api/v1/keys/* 稳定
@ai_safe_edit:
  - 新增过期策略：改 _expires_at 计算（默认 90 天）
  - 改 hash 算法：bump _HASH_VERSION + 双 hash 比对兼容期
@deps_in: routers.sql_models.ApiKey, routers.crypto_box（可选用于 hash salt）

最佳实践：
  1. 服务端只存 key_hash（sha256），原文一次性返回
  2. 默认 90 天过期；过期前 14 天 webhook 提醒
  3. 轮换流程：创建新 key（双重激活 24h）→ 客户端切换 → 吊销旧 key
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import logging
import secrets
import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request

_log = logging.getLogger("sop.key_rotation")
router = APIRouter(prefix="/api/v1/keys", tags=["security"])

_HASH_VERSION = "v1"
_PREFIX = "sop_"
_DEFAULT_TTL_DAYS = 90
_REMIND_DAYS = 14


def _now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _hash_key(raw: str) -> str:
    """与 hmac_middleware._lookup_api_key 一致：sha256(raw)。"""
    return hashlib.sha256(raw.encode()).hexdigest()


def _generate_raw() -> str:
    return _PREFIX + secrets.token_urlsafe(32)


def _identity_from_request(request: Request) -> dict[str, str]:
    """从 request.state.jwt_payload（由 project_scope_middleware 注入）或环境变量解析。"""
    import os

    p = getattr(request.state, "jwt_payload", None)
    if isinstance(p, dict) and p.get("sub"):
        tid = p.get("tid") or p.get("tenant_id") or os.getenv("TENANT_ID", "t-default")
        return {"user_id": str(p.get("sub")), "tenant_id": str(tid)}
    return {
        "user_id": os.getenv("SOP_CURRENT_USER", "system"),
        "tenant_id": os.getenv("TENANT_ID", "t-default"),
    }


def _session() -> Any:
    from sop_manager.routers.sql_models import SessionLocal  # type: ignore[import-not-found]
    return SessionLocal()


def _ApiKey_model() -> Any:
    from sop_manager.routers.sql_models import ApiKey  # type: ignore[import-not-found]
    return ApiKey


@router.post("")
def create_key(
    request: Request,
    name: str = "default",
    ttl_days: int = _DEFAULT_TTL_DAYS,
    scope: str = "",
) -> dict[str, Any]:
    """创建 API Key；原文一次性返回。"""
    if ttl_days <= 0 or ttl_days > 365:
        raise HTTPException(400, "ttl_days 范围 1-365")
    raw = _generate_raw()
    ApiKey = _ApiKey_model()
    ident = _identity_from_request(request)
    expires = _now() + _dt.timedelta(days=ttl_days)
    db = _session()
    try:
        row = ApiKey(
            id=str(uuid.uuid4()),
            tenant_id=ident["tenant_id"],
            user_id=ident["user_id"],
            name=name,
            key_hash=_hash_key(raw),
            status="active",
            expires_at=expires,
        )
        # scope 字段为可选（旧表无该列时跳过）
        if scope:
            try:
                setattr(row, "scope", scope)
            except Exception:
                pass
        db.add(row)
        db.commit()
        _log.info("api key created tenant=%s user=%s id=%s",
                  ident["tenant_id"], ident["user_id"], row.id)
    finally:
        db.close()

    # 审计
    try:
        from sop_manager.routers.audit_chain import append_audit  # type: ignore[import-not-found]
        append_audit(
            "api_key.created",
            user_id=ident["user_id"], tenant_id=ident["tenant_id"],
            resource_type="api_key", resource_id=row.id,
            details={"name": name, "ttl_days": ttl_days, "scope": scope},
        )
    except Exception:
        pass

    return {
        "id": row.id, "raw": raw,
        "expires_at": expires.isoformat(),
        "note": "原文仅此一次返回，请立刻存入 keyring/secret manager",
    }


@router.get("")
def list_keys(request: Request) -> list[dict[str, Any]]:
    ApiKey = _ApiKey_model()
    ident = _identity_from_request(request)
    db = _session()
    try:
        rows = db.query(ApiKey).filter_by(tenant_id=ident["tenant_id"]).all()
        return [_to_dict(r) for r in rows]
    finally:
        db.close()


def _to_dict(r: Any) -> dict[str, Any]:
    return {
        "id": r.id,
        "name": r.name,
        "status": r.status,
        "user_id": r.user_id,
        "scope": getattr(r, "scope", "") or "",
        "expires_at": r.expires_at.isoformat() if r.expires_at else None,
        "expires_in_days": (
            (r.expires_at - _now().replace(tzinfo=r.expires_at.tzinfo)).days
            if r.expires_at else None
        ),
        "last_used_at": r.last_used_at.isoformat() if getattr(r, "last_used_at", None) else None,
    }


@router.post("/{key_id}:rotate")
def rotate(key_id: str, ttl_days: int = _DEFAULT_TTL_DAYS, overlap_hours: int = 24) -> dict[str, Any]:
    """轮换：创建新 key（含原文返回），旧 key 在 overlap_hours 后失效。

    流程：
      1. 调本接口 → 拿新 raw
      2. 客户端切到新 key
      3. overlap_hours 后旧 key 自动过期（实际由 _expire_overlap 后台任务清理；此处先设 status='rotating'）
    """
    ApiKey = _ApiKey_model()
    db = _session()
    try:
        old = db.query(ApiKey).filter_by(id=key_id).first()
        if not old:
            raise HTTPException(404, "key 不存在")
        raw = _generate_raw()
        new_row = ApiKey(
            id=str(uuid.uuid4()),
            tenant_id=old.tenant_id,
            user_id=old.user_id,
            name=old.name + " (rotated)",
            key_hash=_hash_key(raw),
            status="active",
            expires_at=_now() + _dt.timedelta(days=ttl_days),
        )
        _scope = getattr(old, "scope", None)
        if _scope:
            try:
                setattr(new_row, "scope", _scope)
            except Exception:
                pass
        old.status = "rotating"
        old.expires_at = _now() + _dt.timedelta(hours=overlap_hours)
        db.add(new_row)
        db.commit()
    finally:
        db.close()
    try:
        from sop_manager.routers.audit_chain import append_audit
        append_audit("api_key.rotated", resource_type="api_key",
                     resource_id=key_id, details={"new_id": new_row.id, "overlap_hours": overlap_hours})
    except Exception:
        pass
    return {
        "new_id": new_row.id, "raw": raw, "old_id": key_id,
        "old_expires_at": (_now() + _dt.timedelta(hours=overlap_hours)).isoformat(),
    }


@router.delete("/{key_id}")
def revoke(key_id: str) -> dict[str, str]:
    ApiKey = _ApiKey_model()
    db = _session()
    try:
        row = db.query(ApiKey).filter_by(id=key_id).first()
        if not row:
            raise HTTPException(404)
        row.status = "revoked"
        row.expires_at = _now()
        db.commit()
    finally:
        db.close()
    try:
        from sop_manager.routers.audit_chain import append_audit
        append_audit("api_key.revoked", resource_type="api_key", resource_id=key_id)
    except Exception:
        pass
    return {"ok": "true"}


@router.get("/expiring")
def expiring(days: int = _REMIND_DAYS) -> list[dict[str, Any]]:
    """列出 N 天内即将过期的 key（供前端提醒 / cron 通知）。"""
    ApiKey = _ApiKey_model()
    deadline = _now() + _dt.timedelta(days=days)
    db = _session()
    try:
        rows = (db.query(ApiKey)
                .filter(ApiKey.status == "active")
                .filter(ApiKey.expires_at.isnot(None))
                .filter(ApiKey.expires_at <= deadline)
                .all())
        return [_to_dict(r) for r in rows]
    finally:
        db.close()


@router.post("/_cron/expire")
def cron_expire() -> dict[str, int]:
    """后台任务调用：把所有过期 key 状态置为 expired。"""
    ApiKey = _ApiKey_model()
    db = _session()
    try:
        rows = (db.query(ApiKey)
                .filter(ApiKey.status.in_(["active", "rotating"]))
                .filter(ApiKey.expires_at <= _now())
                .all())
        for r in rows:
            r.status = "expired"
        db.commit()
        return {"expired": len(rows)}
    finally:
        db.close()
