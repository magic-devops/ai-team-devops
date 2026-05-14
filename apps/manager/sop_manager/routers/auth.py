"""管理员账号（轻量本地认证，无需数据库）"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import json, hashlib, os, secrets

from sop_manager.path_config import ai_memory_root

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
AUTH_FILE = ai_memory_root() / "auth.json"
security = HTTPBearer(auto_error=False)

def _load(): return json.loads(AUTH_FILE.read_text()) if AUTH_FILE.exists() else {"users": [], "tokens": {}}
def _save(d): AUTH_FILE.parent.mkdir(parents=True, exist_ok=True); AUTH_FILE.write_text(json.dumps(d, indent=2))
def _hash(p): return hashlib.sha256(p.encode()).hexdigest()

class LoginBody(BaseModel):
    username: str; password: str

class UserCreate(BaseModel):
    username: str; password: str; role: str = "admin"

@router.post("/login")
def login(body: LoginBody):
    d = _load()
    user = next((u for u in d["users"] if u["username"] == body.username and u["password"] == _hash(body.password)), None)
    if not user: raise HTTPException(401, "用户名或密码错误")
    token = secrets.token_hex(32)
    d["tokens"][token] = body.username
    _save(d)
    return {"token": token, "username": body.username, "role": user.get("role","admin")}

@router.post("/logout")
def logout(creds: HTTPAuthorizationCredentials = Depends(security)):
    if creds:
        d = _load(); d["tokens"].pop(creds.credentials, None); _save(d)
    return {"ok": True}

@router.get("/users")
def list_users():
    return [{"username": u["username"], "role": u.get("role","admin")} for u in _load()["users"]]

@router.post("/users")
def create_user(body: UserCreate):
    d = _load()
    if any(u["username"] == body.username for u in d["users"]): raise HTTPException(400, "用户已存在")
    d["users"].append({"username": body.username, "password": _hash(body.password), "role": body.role})
    _save(d); return {"ok": True}

@router.delete("/users/{username}")
def delete_user(username: str):
    d = _load()
    d["users"] = [u for u in d["users"] if u["username"] != username]
    _save(d); return {"ok": True}

@router.post("/init")
def init_admin(body: LoginBody):
    """首次初始化管理员账号"""
    d = _load()
    if d["users"]: raise HTTPException(400, "已有用户，请直接登录")
    d["users"].append({"username": body.username, "password": _hash(body.password), "role": "admin"})
    _save(d); return {"ok": True}
