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
import uuid
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from sop_manager.routers.auth_sql import USER_ROLES, _hash, _make_token, _norm_role, current_user, require_role
from sop_manager.routers.sql_models import Tenant, User, get_session

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


class SsoProviderIn(BaseModel):
    type: str = Field("oidc", pattern="^(oidc|saml)$")
    issuer: str = ""
    client_id: str = ""
    client_secret: str = ""
    redirect_uri: str = ""
    scope: str = "openid profile email"
    metadata_url: str = ""
    enabled: bool = True
    tenant_domain_map: dict[str, str] = Field(default_factory=dict)
    role_map: dict[str, str] = Field(default_factory=dict)


class SsoRolePreviewIn(BaseModel):
    email: str = ""
    groups: list[str] = Field(default_factory=list)
    tenant_domain_map: dict[str, str] = Field(default_factory=dict)
    role_map: dict[str, str] = Field(default_factory=dict)


def _config_path() -> str:
    base = os.getenv("SOP_RUNTIME_DIR", ".sop-runtime")
    return os.path.join(base, "sso-providers.json")


def _load_runtime_config() -> dict[str, Any]:
    path = _config_path()
    if not os.path.isfile(path):
        return {"providers": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {"providers": {}}
    except Exception:
        return {"providers": {}}


def _save_runtime_config(data: dict[str, Any]) -> None:
    path = _config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "***"
    return f"{value[:3]}***{value[-3:]}"


def _safe_provider_name(name: str) -> str:
    out = "".join(c for c in name.strip().lower() if c.isalnum() or c in "-_")[:64]
    if not out:
        raise HTTPException(400, "provider 名称不能为空")
    return out


def _parse_kv_env(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for chunk in (raw or "").replace("\n", ",").split(","):
        item = chunk.strip()
        if not item or "=" not in item:
            continue
        k, v = item.split("=", 1)
        key = k.strip()
        if key:
            out[key] = v.strip()
    return out


def _providers() -> dict[str, dict[str, Any]]:
    names = [n.strip() for n in (os.getenv("SOP_SSO_PROVIDERS") or "").split(",") if n.strip()]
    out: dict[str, dict[str, Any]] = {}
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
            "enabled": "true",
            "source": "env",
            "tenant_domain_map": _parse_kv_env(os.getenv(f"SOP_SSO_{key}_TENANT_DOMAIN_MAP", "")),
            "role_map": _parse_kv_env(os.getenv(f"SOP_SSO_{key}_ROLE_MAP", "")),
        }
    runtime = _load_runtime_config().get("providers", {})
    if isinstance(runtime, dict):
        for name, cfg in runtime.items():
            if not isinstance(cfg, dict) or cfg.get("enabled", True) is False:
                continue
            provider = _safe_provider_name(str(name))
            out[provider] = {
                "type": str(cfg.get("type") or "oidc"),
                "issuer": str(cfg.get("issuer") or ""),
                "client_id": str(cfg.get("client_id") or ""),
                "client_secret": str(cfg.get("client_secret") or ""),
                "redirect_uri": str(cfg.get("redirect_uri") or f"http://localhost:8000/api/v1/sso/{provider}/callback"),
                "scope": str(cfg.get("scope") or "openid profile email"),
                "metadata_url": str(cfg.get("metadata_url") or ""),
                "enabled": "true",
                "source": "runtime",
                "tenant_domain_map": cfg.get("tenant_domain_map", {}),
                "role_map": cfg.get("role_map", {}),
            }
    return out


def _public_provider(name: str, cfg: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": name,
        "type": cfg.get("type", "oidc"),
        "issuer": cfg.get("issuer", ""),
        "client_id": cfg.get("client_id", ""),
        "client_secret_masked": _mask_secret(str(cfg.get("client_secret") or "")),
        "redirect_uri": cfg.get("redirect_uri", ""),
        "scope": cfg.get("scope", ""),
        "metadata_url": cfg.get("metadata_url", ""),
        "source": cfg.get("source", "runtime"),
        "enabled": str(cfg.get("enabled", "true")).lower() != "false",
        "tenant_domain_map": cfg.get("tenant_domain_map", {}),
        "role_map": cfg.get("role_map", {}),
    }


def _normalize_groups(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw = value.replace(";", ",").split(",")
    elif isinstance(value, list):
        raw = value
    elif isinstance(value, tuple) or isinstance(value, set):
        raw = list(value)
    else:
        raw = [str(value)]
    out: list[str] = []
    for item in raw:
        group = str(item).strip()
        if group and group not in out:
            out.append(group)
    return out


def _normalize_map(value: Any) -> dict[str, str]:
    if isinstance(value, dict):
        return {str(k).strip(): str(v).strip() for k, v in value.items() if str(k).strip() and str(v).strip()}
    if isinstance(value, str):
        return _parse_kv_env(value)
    return {}


def _resolve_role(groups: list[str], cfg: Optional[dict[str, Any]] = None) -> str:
    role_map = _normalize_map((cfg or {}).get("role_map", {}))
    candidates = groups + [g.lower() for g in groups] + ["*"]
    for group in candidates:
        mapped = role_map.get(group)
        if not mapped:
            continue
        role = _norm_role(mapped)
        if role in USER_ROLES:
            return role
    return "developer"


def _tenant_code_from_email(email: str, cfg: Optional[dict[str, Any]] = None) -> str:
    default_tenant = os.getenv("TENANT_ID", "t-default")
    if "@" not in email:
        return default_tenant
    domain = email.rsplit("@", 1)[1].strip().lower()
    mapping = _parse_kv_env(os.getenv("SOP_SSO_DOMAIN_TENANT_MAP", ""))
    mapping.update(_normalize_map((cfg or {}).get("tenant_domain_map", {})))
    return mapping.get(domain, default_tenant)


def _slugify(value: str, fallback: str = "default") -> str:
    slug = "".join(c.lower() for c in (value or "").strip() if c.isalnum() or c in "-_")[:48]
    return slug or fallback


def _ensure_tenant(db: Session, tenant_code: str) -> Tenant:
    code = (tenant_code or os.getenv("TENANT_ID", "t-default")).strip()
    tenant = db.get(Tenant, code)
    if tenant:
        return tenant
    tenant = db.query(Tenant).filter_by(slug=code).first()
    if tenant:
        return tenant
    slug = _slugify(code.removeprefix("t-") if code.startswith("t-") else code)
    tenant_id = code if code.startswith("t-") else f"t-{slug}"
    tenant = db.get(Tenant, tenant_id) or db.query(Tenant).filter_by(slug=slug).first()
    if tenant:
        return tenant
    tenant = Tenant(id=tenant_id, slug=slug, name=slug, plan="enterprise", status="active")
    db.add(tenant)
    db.flush()
    return tenant


def _unique_username(db: Session, tenant_id: str, email: str, name: str) -> str:
    base = (email.split("@", 1)[0] if "@" in email else name or "sso-user").strip()
    username = _slugify(base, "sso-user")[:48]
    if not db.query(User).filter_by(tenant_id=tenant_id, username=username).first():
        return username
    for i in range(2, 1000):
        candidate = f"{username}-{i}"[:64]
        if not db.query(User).filter_by(tenant_id=tenant_id, username=candidate).first():
            return candidate
    return f"sso-{uuid.uuid4().hex[:12]}"


def _jit_user(db: Session, *, tenant: Tenant, email: str, name: str, role: str) -> User:
    email_norm = (email or "").strip().lower()
    user = None
    if email_norm:
        user = db.query(User).filter_by(tenant_id=tenant.id, email=email_norm).first()
    if not user and email_norm:
        username = email_norm.split("@", 1)[0]
        user = db.query(User).filter_by(tenant_id=tenant.id, username=username).first()
    if user:
        changed = False
        if user.status != "active":
            user.status = "active"
            changed = True
        if email_norm and user.email != email_norm:
            user.email = email_norm
            changed = True
        resolved_role = _norm_role(role)
        if resolved_role in USER_ROLES and user.role != "super_admin" and user.role != resolved_role:
            user.role = resolved_role
            changed = True
        if changed:
            db.add(user)
            db.flush()
        return user
    username = _unique_username(db, tenant.id, email_norm, name)
    user = User(
        id=f"u-{uuid.uuid4().hex[:12]}",
        tenant_id=tenant.id,
        username=username,
        email=email_norm,
        password_hash=_hash(secrets.token_urlsafe(32)),
        role=_norm_role(role) if _norm_role(role) in USER_ROLES else "developer",
        status="active",
    )
    db.add(user)
    db.flush()
    return user


def _templates() -> list[dict[str, str]]:
    base = os.getenv("SOP_PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    return [
        {
            "id": "okta",
            "name": "Okta OIDC",
            "type": "oidc",
            "issuer_hint": "https://dev-xxxxx.okta.com/oauth2/default",
            "redirect_hint": f"{base}/api/v1/sso/okta/callback",
            "scope": "openid profile email groups",
        },
        {
            "id": "azure",
            "name": "Azure AD / Entra ID",
            "type": "oidc",
            "issuer_hint": "https://login.microsoftonline.com/<tenant-id>/v2.0",
            "redirect_hint": f"{base}/api/v1/sso/azure/callback",
            "scope": "openid profile email User.Read",
        },
        {
            "id": "auth0",
            "name": "Auth0 OIDC",
            "type": "oidc",
            "issuer_hint": "https://<tenant>.auth0.com",
            "redirect_hint": f"{base}/api/v1/sso/auth0/callback",
            "scope": "openid profile email",
        },
        {
            "id": "saml",
            "name": "Generic SAML 2.0",
            "type": "saml",
            "issuer_hint": "https://idp.example.com/metadata",
            "redirect_hint": f"{base}/api/v1/sso/saml/saml/acs",
            "scope": "",
        },
    ]


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


@router.get("/providers")
def list_providers() -> dict[str, Any]:
    """公开列表：仅 type + issuer（无 secret）。"""
    return {
        "items": [
            {"name": n, "type": p["type"], "issuer": p["issuer"], "source": p.get("source", "env")}
            for n, p in _providers().items()
        ]
    }


@router.get("/config")
def sso_config(_: Any = Depends(current_user)) -> dict[str, Any]:
    providers = _providers()
    return {
        "ok": True,
        "enabled": bool(providers),
        "items": [_public_provider(name, cfg) for name, cfg in providers.items()],
        "templates": _templates(),
        "config_path": _config_path(),
        "domain_tenant_map": os.getenv("SOP_SSO_DOMAIN_TENANT_MAP", ""),
        "roles": list(USER_ROLES),
        "role_templates": [
            {"group": "sop-admins", "role": "tenant_admin"},
            {"group": "sop-devops", "role": "devops"},
            {"group": "sop-viewers", "role": "viewer"},
            {"group": "*", "role": "developer"},
        ],
        "saml_enabled": os.getenv("SOP_SAML_ENABLED", "0") == "1",
    }


@router.put("/providers/{provider}")
def upsert_provider(provider: str, body: SsoProviderIn, _: Any = Depends(require_role("tenant_admin"))) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    data = _load_runtime_config()
    providers = data.setdefault("providers", {})
    if not isinstance(providers, dict):
        providers = {}
        data["providers"] = providers
    current = providers.get(name, {}) if isinstance(providers.get(name), dict) else {}
    row = body.model_dump()
    if not row.get("client_secret"):
        row["client_secret"] = current.get("client_secret", "")
    if not row.get("redirect_uri"):
        row["redirect_uri"] = f"http://localhost:8000/api/v1/sso/{name}/callback"
    providers[name] = row
    _save_runtime_config(data)
    return {"ok": True, "item": _public_provider(name, {**row, "source": "runtime"})}


@router.delete("/providers/{provider}")
def delete_provider(provider: str, _: Any = Depends(require_role("tenant_admin"))) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    data = _load_runtime_config()
    providers = data.setdefault("providers", {})
    if isinstance(providers, dict):
        providers.pop(name, None)
    _save_runtime_config(data)
    return {"ok": True}


@router.post("/providers/{provider}/test")
async def test_provider(provider: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    if cfg.get("type") == "saml":
        url = cfg.get("metadata_url") or cfg.get("issuer")
        return {"ok": bool(url), "type": "saml", "metadata_url": url, "message": "SAML 元数据已配置" if url else "缺少 SAML metadata_url"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(str(cfg["issuer"]).rstrip("/") + "/.well-known/openid-configuration")
            r.raise_for_status()
            disc = r.json()
        return {
            "ok": True,
            "type": "oidc",
            "authorization_endpoint": disc.get("authorization_endpoint"),
            "token_endpoint": disc.get("token_endpoint"),
            "userinfo_endpoint": disc.get("userinfo_endpoint"),
        }
    except Exception as e:
        return {"ok": False, "type": "oidc", "error": str(e)}


@router.post("/providers/{provider}/role-preview")
def preview_provider_role(
    provider: str,
    body: SsoRolePreviewIn,
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    effective_cfg = {
        **cfg,
        "tenant_domain_map": body.tenant_domain_map or cfg.get("tenant_domain_map", {}),
        "role_map": body.role_map or cfg.get("role_map", {}),
    }
    groups = _normalize_groups(body.groups)
    tenant_code = _tenant_code_from_email(body.email, effective_cfg)
    role = _resolve_role(groups, effective_cfg)
    return {
        "ok": True,
        "provider": name,
        "email": body.email,
        "tenant": tenant_code,
        "role": role,
        "groups": groups,
        "role_map": _normalize_map(effective_cfg.get("role_map", {})),
        "tenant_domain_map": _normalize_map(effective_cfg.get("tenant_domain_map", {})),
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
async def callback(provider: str, request: Request, db: Session = Depends(get_session)):
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
    external_sub = ui.get("sub") or email
    display_name = ui.get("name") or email or external_sub
    groups = _normalize_groups(ui.get("groups") or ui.get("roles") or [])
    tenant_code = _tenant_code_from_email(email, cfg)
    role = _resolve_role(groups, cfg)
    tenant = _ensure_tenant(db, tenant_code)
    user = _jit_user(db, tenant=tenant, email=email, name=display_name, role=role)
    db.commit()
    session = _make_token(user.id, user.tenant_id, user.role, user.username)

    # 写审计
    try:
        from sop_manager.routers.audit_chain import append_audit
        append_audit(
            "sso.login",
            user_id=user.id,
            tenant_id=user.tenant_id,
            details={
                "provider": provider,
                "external_sub": external_sub,
                "email": email,
                "groups": groups,
                "role": user.role,
                "tenant_slug": tenant.slug,
            },
        )
    except Exception:
        pass

    payload = {
        "token": session,
        "user": {
            "user_id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "tenant_id": user.tenant_id,
            "tenant_slug": tenant.slug,
            "tenant_name": tenant.name,
            "groups": groups,
            "sso_provider": provider,
        },
    }
    target = info.get("redirect") or "/?shell=1#/dashboard"
    html = f"""<!doctype html><meta charset="utf-8"><title>SSO Login</title>
<script>
const payload = {json.dumps(payload, ensure_ascii=False)};
localStorage.setItem("sop-token", payload.token);
localStorage.setItem("sop-user", JSON.stringify(payload.user));
location.replace({json.dumps(target)});
</script>
<p>SSO login succeeded. Redirecting...</p>"""
    return HTMLResponse(html)


def _resolve_tenant(email: str) -> str:
    """email 域名 → tenant_id；未配置则回 default。"""
    return _tenant_code_from_email(email)


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
