"""模型管理：多模型配置、提供商管理"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
import json
import time
import urllib.request
from sop_manager.path_config import resolved_ai_memory_root

router = APIRouter(prefix="/api/v1/models", tags=["models"])


def _models_file() -> Path:
    return resolved_ai_memory_root() / "models.json"

BUILTIN_MODELS = [
    {"id":"claude-opus-4-7","provider":"anthropic","name":"Claude Opus 4.7","context":200000,"recommended":True},
    {"id":"claude-sonnet-4-5","provider":"anthropic","name":"Claude Sonnet 4.5","context":200000,"recommended":False},
    {"id":"gpt-4o","provider":"openai","name":"GPT-4o","context":128000,"recommended":False},
    {"id":"gpt-4o-mini","provider":"openai","name":"GPT-4o Mini","context":128000,"recommended":False},
    {"id":"gemini-1.5-pro","provider":"google","name":"Gemini 1.5 Pro","context":1000000,"recommended":False},
    {"id":"deepseek-coder","provider":"deepseek","name":"DeepSeek Coder","context":128000,"recommended":False},
    {"id":"qwen2.5-coder","provider":"ollama","name":"Qwen2.5 Coder (本地)","context":32000,"recommended":False},
]

def _load():
    if _models_file().exists(): return json.loads(_models_file().read_text())
    return {"providers": {}, "custom_models": [], "default_model": "claude-opus-4-7",
            "role_models": {}}  # role -> model_id

def _save(d): _models_file().parent.mkdir(parents=True, exist_ok=True); _models_file().write_text(json.dumps(d, indent=2))

def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def _mask_secret(v: str | None) -> str:
    if not v:
        return ""
    if v.startswith("${") and v.endswith("}"):
        return v
    if len(v) <= 8:
        return "***"
    return f"{v[:4]}...{v[-4:]}"

def _all_model_ids(d: dict) -> set[str]:
    return {m["id"] for m in BUILTIN_MODELS} | {m["id"] for m in d.get("custom_models", [])}

def _public_provider(p: dict) -> dict:
    out = dict(p)
    raw = str(out.get("api_key") or "")
    out["api_key"] = _mask_secret(raw)
    out["has_api_key"] = bool(raw)
    return out

def _public_config(d: dict) -> dict:
    return {
        "builtin": BUILTIN_MODELS,
        "custom": d.get("custom_models", []),
        "providers": {k: _public_provider(v) for k, v in d.get("providers", {}).items()},
        "default": d.get("default_model"),
        "role_models": d.get("role_models", {}),
        "updated_at": d.get("updated_at", ""),
    }

class ProviderConfig(BaseModel):
    name: str; api_key: str = ""; base_url: Optional[str] = None; enabled: bool = True

class CustomModel(BaseModel):
    id: str; provider: str; name: str; context: int = 32000; api_key: Optional[str] = None

class RoleModelConfig(BaseModel):
    role: str; model_id: str  # 为特定 Agent 角色指定模型

@router.get("")
def list_models():
    d = _load()
    return _public_config(d)

@router.put("/default")
def set_default(model_id: str):
    d = _load()
    if model_id not in _all_model_ids(d):
        raise HTTPException(404, "model not found")
    d["default_model"] = model_id
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True, "default": model_id}

@router.put("/providers/{name}")
def upsert_provider(name: str, body: ProviderConfig):
    if not name.strip():
        raise HTTPException(400, "provider name required")
    d = _load()
    existing = d.setdefault("providers", {}).get(name, {})
    payload = body.model_dump()
    payload["name"] = payload.get("name") or name
    if not payload.get("api_key") and existing.get("api_key"):
        payload["api_key"] = existing.get("api_key")
    payload["updated_at"] = _now()
    d.setdefault("providers", {})[name] = payload
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True, "provider": _public_provider(payload)}

@router.delete("/providers/{name}")
def delete_provider(name: str):
    d = _load()
    d.get("providers", {}).pop(name, None)
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True}

@router.post("/providers/{name}/test")
def test_provider(name: str):
    d = _load()
    provider = d.get("providers", {}).get(name)
    if not provider:
        raise HTTPException(404, "provider not found")
    if not provider.get("enabled", True):
        return {"ok": False, "status": "disabled", "provider": name}
    base_url = str(provider.get("base_url") or "").strip()
    if not provider.get("api_key"):
        return {"ok": False, "status": "missing_api_key", "provider": name, "base_url": base_url}
    if not base_url:
        return {"ok": True, "status": "configured", "provider": name, "base_url": "", "live": False}
    try:
        req = urllib.request.Request(base_url, method="HEAD")
        with urllib.request.urlopen(req, timeout=5) as res:  # noqa: S310 - operator-provided endpoint
            return {"ok": True, "status": "reachable", "provider": name, "base_url": base_url, "http_status": res.status, "live": True}
    except Exception as e:
        return {"ok": False, "status": "unreachable", "provider": name, "base_url": base_url, "error": str(e), "live": True}

@router.post("/custom")
def add_custom_model(body: CustomModel):
    d = _load()
    if body.id in _all_model_ids(d):
        raise HTTPException(409, "model already exists")
    row = body.model_dump()
    row["created_at"] = _now()
    d.setdefault("custom_models", []).append(row)
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True, "model": row}

@router.delete("/custom/{model_id}")
def remove_custom_model(model_id: str):
    d = _load()
    d["custom_models"] = [m for m in d.get("custom_models", []) if m["id"] != model_id]
    d["role_models"] = {k: v for k, v in d.get("role_models", {}).items() if v != model_id}
    if d.get("default_model") == model_id:
        d["default_model"] = BUILTIN_MODELS[0]["id"]
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True}

@router.put("/role-model")
def set_role_model(body: RoleModelConfig):
    d = _load()
    if body.model_id not in _all_model_ids(d):
        raise HTTPException(404, "model not found")
    if not body.role.strip():
        raise HTTPException(400, "role required")
    d.setdefault("role_models", {})[body.role] = body.model_id
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True, "role": body.role, "model_id": body.model_id}
