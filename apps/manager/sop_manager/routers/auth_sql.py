"""JWT 认证 + RBAC 权限 — 替换原 auth.json 方案"""
from __future__ import annotations
import os, hashlib, uuid, secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy.orm import Session
import jwt

from .sql_models import get_session, User, Tenant, Project, ProjectMember, ApiKey

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

# HS256：RFC 7518 建议密钥长度 ≥ 256 bit；过短会触发 PyJWT 警告且不符合最佳实践。
# 未设置时使用固定 32+ ASCII 字符默认（仅本地开发）；生产务必设置长随机串（如 openssl rand -hex 32）。
_DEFAULT_JWT_SECRET = "sop-default-insecure-use-env-secret-key"

_RAW_JWT_SECRET = os.getenv("SECRET_KEY", _DEFAULT_JWT_SECRET)


def _normalize_hs256_secret(raw: str) -> str:
    raw_b = raw.encode("utf-8")
    if len(raw_b) >= 32:
        return raw
    # 确定性扩展：同一段短口令得到同一签名密钥；升级后旧 JWT 需重新登录
    return hashlib.sha256(raw_b).hexdigest()


SECRET_KEY = _normalize_hs256_secret(_RAW_JWT_SECRET)
ALGORITHM = "HS256"
# SSO 等模块复用同一签名材料
JWT_SECRET = SECRET_KEY
JWT_ALG = ALGORITHM

if _RAW_JWT_SECRET != SECRET_KEY:
    import logging

    logging.getLogger("sop.auth").warning(
        "SECRET_KEY 的 UTF-8 长度不足 32 字节，已使用 SHA-256 十六进制派生为 HS256 签名密钥；"
        "已有 JWT 将失效，请重新登录。生产环境请设置至少 32 字节的随机 SECRET_KEY（例如 openssl rand -hex 32）。"
    )
TOKEN_EXPIRE_HOURS = int(os.getenv("TOKEN_EXPIRE_HOURS", "72"))
ADMIN_MODE = os.getenv("ADMIN_MODE", "single")

# 权限权重：数值越小权限越高。require_role / check_project_access 在 user_w > min_w 时拒绝。
_ROLE_WEIGHTS: dict[str, int] = {
    "super_admin": 0,
    "tenant_admin": 10,
    "project_admin": 20,
    "developer": 30,
    "devops": 30,
    "product_manager": 32,
    "analyst": 36,
    "viewer": 40,
}
_ROLE_ALIASES = {"admin": "tenant_admin"}

USER_ROLES: tuple[str, ...] = tuple(_ROLE_WEIGHTS.keys())
ROLES = USER_ROLES  # 兼容旧 import 名

# 项目成员可分配角色（不含租户级 super/tenant_admin）
PROJECT_MEMBER_ROLES: tuple[str, ...] = (
    "project_admin",
    "developer",
    "devops",
    "product_manager",
    "analyst",
    "viewer",
)

# 数据港「合并导入」写库：高权限，与产品/分析/只读等职能角色区分
DATA_HUB_IMPORT_ROLES: frozenset[str] = frozenset(
    {"super_admin", "tenant_admin", "project_admin", "devops"}
)


def _norm_role(role: str) -> str:
    if not role:
        return ""
    r = str(role).strip()
    return _ROLE_ALIASES.get(r, r)


def role_weight(role: str) -> int:
    return _ROLE_WEIGHTS.get(_norm_role(role), 99)


def assert_project_member_role(role: str) -> str:
    """校验项目成员 role 字符串，返回规范化后的 id。"""
    r = _norm_role(role)
    if r not in PROJECT_MEMBER_ROLES:
        raise HTTPException(400, f"项目成员 role 须为: {PROJECT_MEMBER_ROLES}")
    return r


def _hash(p: str) -> str:
    return hashlib.sha256(p.encode()).hexdigest()


def _hash_apikey(k: str) -> str:
    return hashlib.sha256(k.encode()).hexdigest()


def _make_token(user_id: str, tenant_id: str, role: str, username: str = "") -> str:
    payload = {
        "sub": user_id, "tid": tenant_id, "role": role, "username": username,
        "exp": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token 已过期")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token 无效")


def current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_session),
) -> User:
    # 优先 Bearer JWT
    if creds:
        payload = _decode_token(creds.credentials)
        user = db.get(User, payload["sub"])
        if user and user.status == "active":
            return user
        raise HTTPException(401, "用户不存在或已禁用")
    raise HTTPException(401, "未提供认证 Token")


def require_data_hub_import(user: User = Depends(current_user)) -> User:
    """POST /api/import：仅管理员线 + 运维 + 项目管理员可合并写入。"""
    if user.role not in DATA_HUB_IMPORT_ROLES:
        raise HTTPException(
            403,
            "合并导入仅限 super_admin、tenant_admin、project_admin 或 devops 角色",
        )
    return user


def current_user_or_apikey(
    request=None,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_session),
) -> User:
    """支持 Bearer JWT 和 X-Api-Key 双认证"""
    from fastapi import Request
    # Bearer JWT
    if creds:
        payload = _decode_token(creds.credentials)
        user = db.get(User, payload["sub"])
        if user and user.status == "active":
            return user
    raise HTTPException(401, "未提供有效认证")


def require_role(min_role: str):
    def _dep(user: User = Depends(current_user)):
        if role_weight(user.role) > role_weight(min_role):
            raise HTTPException(403, f"需要 {min_role} 或更高权限")
        return user
    return _dep


def check_project_access(user: User, project_id: str, db: Session, min_role: str = "viewer"):
    proj = db.query(Project).filter_by(id=project_id).first()
    if not proj and ADMIN_MODE == "single":
        from sop_manager.project_provision import ensure_project_for_user
        proj = ensure_project_for_user(db, project_id, user)
    if not proj:
        raise HTTPException(404, "项目不存在")
    if user.role == "super_admin":
        return
    if proj.tenant_id != user.tenant_id:
        raise HTTPException(403, "无项目访问权限")
    if user.role == "tenant_admin":
        return
    member = db.query(ProjectMember).filter_by(project_id=project_id, user_id=user.id).first()
    if not member:
        raise HTTPException(403, "无项目访问权限")
    if role_weight(member.role) > role_weight(min_role):
        raise HTTPException(403, f"需要项目 {min_role} 权限")


# ── 登录 ──────────────────────────────────────────────────────────
class LoginBody(BaseModel):
    username: str
    password: str
    tenant_slug: Optional[str] = None

@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_session)):
    q = db.query(User).filter_by(username=body.username, password_hash=_hash(body.password))
    if ADMIN_MODE == "saas" and body.tenant_slug:
        tenant = db.query(Tenant).filter_by(slug=body.tenant_slug).first()
        if not tenant:
            raise HTTPException(401, "租户不存在")
        q = q.filter_by(tenant_id=tenant.id)
    user = q.first()
    if not user or user.status != "active":
        raise HTTPException(401, "用户名或密码错误")
    token = _make_token(user.id, user.tenant_id, user.role, user.username)
    default_project_id = ""
    try:
        m = db.query(ProjectMember).filter_by(user_id=user.id).order_by(ProjectMember.project_id).first()
        if m:
            default_project_id = m.project_id
        elif user.role in ("tenant_admin", "super_admin"):
            p0 = (
                db.query(Project)
                .filter_by(tenant_id=user.tenant_id)
                .order_by(Project.created_at.asc())
                .first()
            )
            if p0:
                default_project_id = p0.id
    except Exception:
        default_project_id = ""
    return {
        "access_token": token,
        "token": token,  # 兼容 Web login.html（localStorage sop-token）
        "token_type": "Bearer",
        "user_id": user.id,
        "username": user.username,
        "role": user.role,
        "tenant_id": user.tenant_id,
        "default_project_id": default_project_id,
    }


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"user_id": user.id, "username": user.username, "role": user.role,
            "tenant_id": user.tenant_id, "email": user.email}


@router.post("/logout")
def logout():
    """JWT 无服务端会话；登出以客户端清除 token 为主。保留端点便于前端统一调用与后续扩展（如黑名单）。"""
    return {"ok": True}


# ── 项目配对（sop init / sop login --pair）────────────────────────
class PairCodeCreate(BaseModel):
    local_path: str = ""
    preferred_project_id: str = ""


@router.get("/pair/hint")
def pair_hint(user: User = Depends(current_user)):
    """配对页预填：Manager PROJECT_PATH 与 memory 中的 project_id。"""
    from sop_manager.project_provision import local_project_id_from_memory
    from sop_manager.path_config import project_path

    pp = project_path().resolve()
    return {
        "project_id": local_project_id_from_memory(pp),
        "project_path": str(pp),
    }


@router.post("/pair/codes")
def create_pair_code_endpoint(
    body: PairCodeCreate,
    user: User = Depends(current_user),
):
    """已登录用户生成一次性配对码（供 CLI `sop login --pair` 使用）。"""
    from sop_manager.project_provision import (
        _path_has_memory,
        create_pair_code,
        local_project_id_from_memory,
    )

    preferred = (body.preferred_project_id or "").strip()
    lp = (body.local_path or "").strip()
    stored_lp = ""
    if lp:
        p = Path(lp)
        if p.is_absolute() and p.is_dir():
            stored_lp = str(p.resolve())
            if not preferred and _path_has_memory(p):
                preferred = local_project_id_from_memory(p)
    if not preferred:
        preferred = local_project_id_from_memory()
    code = create_pair_code(
        user_id=user.id,
        tenant_id=user.tenant_id,
        local_path=stored_lp,
        preferred_project_id=preferred,
    )
    return {
        "pair_code": code,
        "expires_in": int(os.getenv("SOP_PAIR_CODE_TTL", "600")),
        "project_id": preferred,
    }


class PairBody(BaseModel):
    pair_code: str
    hostname: str = ""
    local_path: str = ""


@router.post("/pair")
def pair_project(body: PairBody, db: Session = Depends(get_session)):
    """用配对码注册/绑定本地项目，返回 project_id 与 API Key。"""
    from sop_manager.project_provision import (
        consume_pair_code,
        ensure_project,
        resolve_pair_project_id,
    )

    entry = consume_pair_code(body.pair_code)
    if not entry:
        raise HTTPException(401, "配对码无效或已过期")
    user = db.get(User, entry["user_id"])
    if not user or user.status != "active":
        raise HTTPException(401, "配对用户无效")

    pid, local_pp = resolve_pair_project_id(entry, body.local_path or "")

    proj = ensure_project(
        db,
        pid,
        project_path_str=local_pp or None,
        tenant_id=user.tenant_id,
        owner_user=user,
    )
    if not proj:
        raise HTTPException(500, "无法注册项目")

    raw = "sop_" + secrets.token_hex(24)
    prefix = raw[:12]
    key = ApiKey(
        id=f"ak-{uuid.uuid4().hex[:12]}",
        tenant_id=user.tenant_id,
        user_id=user.id,
        name=f"pair-{body.hostname or 'cli'}",
        key_hash=_hash_apikey(raw),
        key_prefix=prefix,
    )
    db.add(key)
    db.commit()

    manager_url = (os.getenv("MANAGER_PUBLIC_URL") or os.getenv("MANAGER_URL") or "").strip()
    if not manager_url:
        manager_url = "http://localhost:8765"

    return {
        "project_id": proj.id,
        "tenant_id": proj.tenant_id,
        "api_key": raw,
        "manager_url": manager_url.rstrip("/"),
        "a2a_port": int(os.getenv("A2A_PORT", "7741")),
    }


# ── 用户管理 ──────────────────────────────────────────────────────
class UserCreate(BaseModel):
    username: str
    password: str
    email: str = ""
    role: str = "developer"

@router.get("/users")
def list_users(user: User = Depends(require_role("tenant_admin")), db: Session = Depends(get_session)):
    users = db.query(User).filter_by(tenant_id=user.tenant_id).all()
    return [{"id": u.id, "username": u.username, "email": u.email,
             "role": u.role, "status": u.status} for u in users]

@router.get("/role-constants")
def role_constants():
    """无需登录：供登录页/管理端下拉框同步可选角色（不含敏感逻辑）。"""
    return {
        "user_roles": list(USER_ROLES),
        "project_member_roles": list(PROJECT_MEMBER_ROLES),
        "data_hub_import_roles": sorted(DATA_HUB_IMPORT_ROLES, key=lambda r: role_weight(r)),
    }


@router.post("/users")
def create_user(body: UserCreate, user: User = Depends(require_role("tenant_admin")),
                db: Session = Depends(get_session)):
    nr = _norm_role(body.role)
    if nr not in USER_ROLES:
        raise HTTPException(400, f"role 须为: {USER_ROLES}")
    if nr == "super_admin" and user.role != "super_admin":
        raise HTTPException(403, "仅 super_admin 可创建该角色")
    if len(body.password) < 8:
        raise HTTPException(400, "密码至少 8 位")
    if db.query(User).filter_by(tenant_id=user.tenant_id, username=body.username).first():
        raise HTTPException(400, "用户名已存在")
    new_user = User(id=f"u-{uuid.uuid4().hex[:12]}", tenant_id=user.tenant_id,
                    username=body.username, email=body.email,
                    password_hash=_hash(body.password), role=nr)
    db.add(new_user); db.commit()
    return {"ok": True, "id": new_user.id}

@router.delete("/users/{user_id}")
def delete_user(user_id: str, user: User = Depends(require_role("tenant_admin")),
                db: Session = Depends(get_session)):
    target = db.get(User, user_id)
    if not target or target.tenant_id != user.tenant_id:
        raise HTTPException(404, "用户不存在")
    if target.role == "super_admin" and user.role != "super_admin":
        raise HTTPException(403, "无权删除 super_admin")
    db.delete(target); db.commit()
    return {"ok": True}

@router.patch("/users/{user_id}")
def update_user(user_id: str, body: dict, user: User = Depends(require_role("tenant_admin")),
                db: Session = Depends(get_session)):
    target = db.get(User, user_id)
    if not target or target.tenant_id != user.tenant_id:
        raise HTTPException(404, "用户不存在")
    if target.role == "super_admin" and user.role != "super_admin":
        raise HTTPException(403, "无权修改 super_admin")
    if "password" in body:
        if len(body["password"]) < 8:
            raise HTTPException(400, "密码至少 8 位")
        target.password_hash = _hash(body.pop("password"))
    if "role" in body:
        nr = _norm_role(str(body["role"]))
        if nr not in USER_ROLES:
            raise HTTPException(400, f"role 须为: {USER_ROLES}")
        if nr == "super_admin" and user.role != "super_admin":
            raise HTTPException(403, "仅 super_admin 可分配 super_admin")
        target.role = nr
        body = {k: v for k, v in body.items() if k != "role"}
    for k in ("email", "status"):
        if k in body:
            setattr(target, k, body[k])
    target.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True}


# ── API Key 管理 ──────────────────────────────────────────────────
@router.get("/api-keys")
def list_api_keys(user: User = Depends(current_user), db: Session = Depends(get_session)):
    keys = db.query(ApiKey).filter_by(user_id=user.id, status="active").all()
    return [{"id": k.id, "name": k.name, "prefix": k.key_prefix,
             "last_used_at": k.last_used_at.isoformat() + "Z" if k.last_used_at else None,
             "expires_at": k.expires_at.isoformat() + "Z" if k.expires_at else None,
             "created_at": k.created_at.isoformat() + "Z"} for k in keys]

class ApiKeyCreate(BaseModel):
    name: str
    expires_days: Optional[int] = None  # None = 永不过期

@router.post("/api-keys")
def create_api_key(body: ApiKeyCreate, user: User = Depends(current_user),
                   db: Session = Depends(get_session)):
    raw = "sop_" + secrets.token_hex(24)
    prefix = raw[:12]
    expires_at = None
    if body.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=body.expires_days)
    key = ApiKey(id=f"ak-{uuid.uuid4().hex[:12]}", tenant_id=user.tenant_id,
                 user_id=user.id, name=body.name,
                 key_hash=_hash_apikey(raw), key_prefix=prefix,
                 expires_at=expires_at)
    db.add(key); db.commit()
    return {"ok": True, "id": key.id, "key": raw, "prefix": prefix,
            "note": "请保存此 Key，之后无法再次查看"}

@router.delete("/api-keys/{key_id}")
def revoke_api_key(key_id: str, user: User = Depends(current_user),
                   db: Session = Depends(get_session)):
    key = db.get(ApiKey, key_id)
    if not key or key.user_id != user.id:
        raise HTTPException(404, "API Key 不存在")
    key.status = "revoked"; db.commit()
    return {"ok": True}


# ── 初始化 ────────────────────────────────────────────────────────
@router.get("/init/status")
def init_status(db: Session = Depends(get_session)):
    """无需认证：检测是否已初始化（供登录页判断显示注册还是登录）"""
    return {"initialized": db.query(User).count() > 0}

class InitBody(BaseModel):
    username: str
    password: str
    tenant_name: str = "default"

@router.post("/init")
def init_admin(body: InitBody, db: Session = Depends(get_session)):
    if db.query(User).count() > 0:
        raise HTTPException(400, "已初始化，请直接登录")
    if len(body.password) < 8:
        raise HTTPException(400, "密码至少 8 位")
    tenant = Tenant(id="t-default", name=body.tenant_name, slug="default")
    db.add(tenant)
    admin = User(id=f"u-{uuid.uuid4().hex[:12]}", tenant_id="t-default",
                 username=body.username, password_hash=_hash(body.password), role="super_admin")
    db.add(admin); db.commit()
    return {"ok": True, "tenant_id": "t-default", "user_id": admin.id}


# ── 重置密码（需提供 super_admin 账号验证身份）────────────────────
class ResetPasswordBody(BaseModel):
    admin_username: str   # 当前任意一个 super_admin 用户名
    admin_password: str   # 当前 super_admin 密码（验证身份）
    target_username: str  # 要重置密码的用户名
    new_password: str

@router.post("/reset-password")
def reset_password(body: ResetPasswordBody, db: Session = Depends(get_session)):
    """无需 token：用 super_admin 账号验证身份后重置任意用户密码"""
    admin = db.query(User).filter_by(
        username=body.admin_username, password_hash=_hash(body.admin_password), role="super_admin"
    ).first()
    if not admin:
        raise HTTPException(401, "管理员账号或密码错误")
    if len(body.new_password) < 8:
        raise HTTPException(400, "新密码至少 8 位")
    target = db.query(User).filter_by(username=body.target_username, tenant_id=admin.tenant_id).first()
    if not target:
        raise HTTPException(404, "用户不存在")
    target.password_hash = _hash(body.new_password)
    target.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True}

