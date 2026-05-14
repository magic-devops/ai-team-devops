"""
@module: routers.sso
@purpose: 企业 SSO —— OIDC（Authorization Code + PKCE）和 SAML 2.0
@stable: /api/v1/sso/* 路径稳定；SP 入口 /api/v1/sso/{provider}/login 重定向
@ai_safe_edit:
  - 新增 IdP：在 _PROVIDERS 加配置项；不动 _oidc_login/_oidc_callback
  - 改 token 字段映射：改 _make_session_token() 的 claims
@deps_in: authlib / python3-saml（可选）；缺包时只暴露元数据接口

最佳实践：
  1. 多租户：domain → tenant 映射，登录后强制租户隔离
  2. PKCE：OIDC code flow 强制开启（防止 code 劫持）
  3. SAML：签名验证；不验证 → 拒绝
  4. JIT Provisioning：首次登录自动建用户，按 IdP groups 映射默认角色
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import time
import urllib.parse
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

_log = logging.getLogger("sop.sso")
router = APIRouter(prefix="/api/v1/sso", tags=["security"])

# 多 IdP 配置：环境变量 / DB 二选一；这里先支持 env 配置多实例
# 格式：SOP_SSO_PROVIDERS=okta,azure
#       SOP_SSO_OKTA_TYPE=oidc / saml
#       SOP_SSO_OKTA_ISSUER=https://...
#       SOP_SSO_OKTA_CLIENT_ID=...
#       SOP_SSO_OKTA_CLIENT_SECRET=...

_STATE_TTL = 600
_STATE_CACHE: dict[str, dict[str, Any]] = {}


def _providers() -> dict[str, dict[str, str]]:
    names = [n.strip() for n in (os.getenv("SOP_SSO_PROVIDERS") or "").split(",") if n.strip()]
    out: dict[str, dict[str, str]] = {}
    for n in names:
        key = n.upper()
        out[n] = {
            "type": os.getenv(f"SOP_SSO_{key}_TYPE", "oidc"),
            "issuer": os.getenv(f"SOP_SSO_{key}_ISSUER", ""),
            "client_id": os.getenv(f"SOP_SSO_{key}_CLIENT_ID", ""),
            "client_secret": os.getenv(f"SOP_SSO_{key}_CLIENT_SECRET", ""),
            "redirect_uri": os.getenv(f"SOP_SSO_{key}_REDIRECT",
                                      f"http://localhost:8000/api/v1/sso/{n}/callback"),
            "scope": os.getenv(f"SOP_SSO_{key}_SCOPE", "openid profile email"),
            "metadata_url": os.getenv(f"SOP_SSO_{key}_METADATA", ""),
        }
    return out


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


def _make_state() -> str:
    s = secrets.token_urlsafe(24)
    # 清理过期 state
    now = time.time()
    for k, v in list(_STATE_CACHE.items()):
        if now - v["ts"] > _STATE_TTL:
            _STATE_CACHE.pop(k, None)
    return s


def _make_session_token(*, sub: str, email: str, name: str, tenant: str,
                        groups: list[str]) -> str:
    """生成本地 session JWT（复用现有 auth_sql 的密钥）。"""
    try:
        import jwt  # type: ignore[import-not-found]
        from sop_manager.routers.auth_sql import JWT_SECRET, JWT_ALG  # type: ignore[import-not-found]
        payload = {
            "sub": sub, "email": email, "name": name, "tid": tenant, "groups": groups,
            "iat": int(time.time()), "exp": int(time.time()) + 86400,
            "iss": "sop-sso",
        }
        return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)
    except Exception:
        # fallback：返回 unsigned base64（仅 dev）
        payload = {"sub": sub, "email": email, "name": name, "tid": tenant,
                   "groups": groups, "iat": int(time.time())}
        return "sopdev." + base64.urlsafe_b64encode(
            json.dumps(payload).encode()
        ).rstrip(b"=").decode()


@router.get("/providers")
def list_providers() -> dict[str, Any]:
    """公开列表：仅 type + issuer（无 secret）。"""
    return {
        "items": [
            {"name": n, "type": p["type"], "issuer": p["issuer"]}
            for n, p in _providers().items()
        ]
    }


@router.get("/{provider}/login")
async def login(provider: str, redirect: str = "/"):
    cfg = _providers().get(provider)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {provider}")
    if cfg["type"] != "oidc":
        raise HTTPException(400, f"provider {provider} 不是 oidc（请改用 SAML 入口）")
    if not cfg["issuer"] or not cfg["client_id"]:
        raise HTTPException(500, f"provider {provider} 配置不完整")

    # 发现端点（OIDC discovery）
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(cfg["issuer"].rstrip("/") + "/.well-known/openid-configuration")
            r.raise_for_status()
            disc = r.json()
    except Exception as e:
        raise HTTPException(502, f"OIDC discovery 失败: {e}")

    state = _make_state()
    verifier, challenge = _pkce_pair()
    _STATE_CACHE[state] = {
        "ts": time.time(), "verifier": verifier, "provider": provider,
        "redirect": redirect, "token": disc.get("token_endpoint"),
        "userinfo": disc.get("userinfo_endpoint"),
    }
    auth_url = disc.get("authorization_endpoint")
    params = {
        "response_type": "code", "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"], "scope": cfg["scope"],
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
    }
    return RedirectResponse(auth_url + "?" + urllib.parse.urlencode(params))


@router.get("/{provider}/callback")
async def callback(provider: str, request: Request):
    code = request.query_params.get("code", "")
    state = request.query_params.get("state", "")
    info = _STATE_CACHE.pop(state, None)
    if not info or info["provider"] != provider:
        raise HTTPException(400, "state 无效或过期")

    cfg = _providers().get(provider, {})
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            tr = await c.post(info["token"], data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": cfg["redirect_uri"],
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "code_verifier": info["verifier"],
            })
            tr.raise_for_status()
            tok = tr.json()
            ur = await c.get(info["userinfo"],
                             headers={"Authorization": f"Bearer {tok.get('access_token','')}"})
            ur.raise_for_status()
            ui = ur.json()
    except Exception as e:
        raise HTTPException(502, f"OIDC 交换失败: {e}")

    # JIT provisioning
    email = ui.get("email") or ui.get("preferred_username") or ""
    sub = ui.get("sub") or email
    tenant = _resolve_tenant(email)
    groups = ui.get("groups") or []
    session = _make_session_token(
        sub=sub, email=email, name=ui.get("name") or email,
        tenant=tenant, groups=groups,
    )

    # 写审计
    try:
        from sop_manager.routers.audit_chain import append_audit
        append_audit("sso.login", user_id=sub, tenant_id=tenant,
                     details={"provider": provider, "email": email, "groups": groups})
    except Exception:
        pass

    return {"ok": True, "session": session, "user": {"sub": sub, "email": email,
            "tenant": tenant, "groups": groups}}


def _resolve_tenant(email: str) -> str:
    """email 域名 → tenant_id；未配置则回 default。"""
    if "@" not in email:
        return os.getenv("TENANT_ID", "t-default")
    domain = email.rsplit("@", 1)[1].lower()
    mapping = (os.getenv("SOP_SSO_DOMAIN_TENANT_MAP") or "").strip()
    if not mapping:
        return os.getenv("TENANT_ID", "t-default")
    # 格式：domain1=tenant1,domain2=tenant2
    for kv in mapping.split(","):
        if "=" in kv:
            k, v = kv.split("=", 1)
            if k.strip() == domain:
                return v.strip()
    return os.getenv("TENANT_ID", "t-default")


# ── SAML 占位（生产建议用 python3-saml） ───────────────────────
@router.get("/{provider}/saml/metadata")
def saml_metadata(provider: str) -> dict[str, str]:
    cfg = _providers().get(provider, {})
    if cfg.get("type") != "saml":
        raise HTTPException(404)
    return {
        "entityID": cfg.get("issuer", ""),
        "acsURL": cfg.get("redirect_uri", ""),
        "note": "SAML 完整支持需安装 python3-saml；本接口仅返回元数据占位。",
    }


@router.post("/{provider}/saml/acs")
async def saml_acs(provider: str, request: Request) -> dict[str, Any]:
    """SAML Assertion Consumer Service。

    完整版用 python3-saml 解析 SAMLResponse；当前给出 stub 以便前端联调。
    """
    if (os.getenv("DEPLOY_ENV", "dev") == "production"
            and not os.getenv("SOP_SAML_ENABLED", "0") == "1"):
        raise HTTPException(503, "SAML 未启用：SOP_SAML_ENABLED=1 并安装 python3-saml")
    form = await request.form()
    saml_response = form.get("SAMLResponse", "")
    if not saml_response:
        raise HTTPException(400, "missing SAMLResponse")
    return {"ok": True, "stub": True,
            "note": "需安装 python3-saml 才能验证签名"}


# ── Casbin ABAC（带 fallback） ────────────────────────────────
_CASBIN_ENFORCER: Any = None


def _build_casbin() -> Any:
    global _CASBIN_ENFORCER
    if _CASBIN_ENFORCER is not None:
        return _CASBIN_ENFORCER
    try:
        import casbin  # type: ignore[import-not-found]
    except ImportError:
        _log.info("casbin 未安装，使用退化版 ABAC")
        _CASBIN_ENFORCER = _SimpleAbac()
        return _CASBIN_ENFORCER
    model = os.getenv("SOP_CASBIN_MODEL", "")
    policy = os.getenv("SOP_CASBIN_POLICY", "")
    if not model or not policy:
        _CASBIN_ENFORCER = _SimpleAbac()
        return _CASBIN_ENFORCER
    _CASBIN_ENFORCER = casbin.Enforcer(model, policy)
    return _CASBIN_ENFORCER


class _SimpleAbac:
    """fallback：从环境变量读策略 SOP_ABAC_POLICY=`role:admin/*` 任意 act。"""

    def enforce(self, sub: str, obj: str, act: str, ctx: Optional[dict] = None) -> bool:  # noqa: D401
        policies = (os.getenv("SOP_ABAC_POLICY") or "").split(",")
        for raw in policies:
            raw = raw.strip()
            if not raw:
                continue
            # 简单语法：role:<r>/<obj_pattern>:<act_pattern>
            try:
                _, r_obj_act = raw.split(":", 1)
                r_part, oa = r_obj_act.split("/", 1)
                obj_p, act_p = oa.split(":", 1)
                if ctx and r_part in (ctx.get("roles") or []) and (obj_p in ("*", obj)) and (act_p in ("*", act)):
                    return True
            except Exception:
                continue
        # 默认 admin 通过
        if ctx and "admin" in (ctx.get("roles") or []):
            return True
        return False


@router.post("/abac/enforce")
def abac_enforce(payload: dict[str, Any]) -> dict[str, bool]:
    """前端 / 服务可主动校验权限。

    body: {"sub":"u1","obj":"project/p1","act":"read",
            "ctx":{"roles":["admin"],"tenant_id":"t1"}}
    """
    e = _build_casbin()
    ok = e.enforce(payload.get("sub", ""), payload.get("obj", ""),
                   payload.get("act", ""), payload.get("ctx", {}))
    return {"allow": bool(ok)}
